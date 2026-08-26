/**
 * 런타임 콘솔(1403)의 순수 보조 로직 — vscode/net 무의존 (GitHub #22).
 *
 * runtimeConsole.ts 의 소켓·타이머 부수효과와 분리해 단위 테스트 가능하게 둔 부분:
 *   - SlidingWindowCounter : 최근 N ms 슬라이딩 윈도우 이벤트 카운터 (connects/min 산출)
 *   - ConnectStats         : 누적 접속 수 + 이유별 카운트 + 주기 요약 문자열
 *   - decideWatchdogAction : 재연결 워치독 판정 (상태만 보고 "무엇을 해야 하는지"만 돌려준다)
 *
 * 배경: 1403은 서버가 이벤트 배치를 보내고 FIN 하는 구조라 클라이언트가 계속 재접속한다.
 * 2026-08-25 사고에서 (1) 배치 직후 즉시 재접속으로 30~40 connect/분의 churn, (2) `CLOSE (empty=2)`
 * 뒤 3분간 재연결 로그가 전무한 채 폴러가 멈춘 현상이 관측됐다. 이 모듈은 그 두 가지를
 * 관측(카운터)하고 복구(워치독)하기 위한 판단 로직이다.
 */

/** 최근 `windowMs` 안에 기록된 이벤트 수를 세는 슬라이딩 윈도우 카운터. */
export class SlidingWindowCounter {
    private readonly stamps: number[] = [];

    constructor(readonly windowMs: number) {
        if (!(windowMs > 0)) {
            throw new RangeError(`windowMs must be > 0 (got ${windowMs})`);
        }
    }

    /** 이벤트 1건 기록. `now` 는 ms epoch (Date.now()). */
    record(now: number): void {
        this.stamps.push(now);
        this.prune(now);
    }

    /** `now` 기준 최근 windowMs 안(`> now - windowMs`)의 이벤트 수. */
    count(now: number): number {
        this.prune(now);
        return this.stamps.length;
    }

    reset(): void {
        this.stamps.length = 0;
    }

    private prune(now: number): void {
        const cutoff = now - this.windowMs;
        let drop = 0;
        while (drop < this.stamps.length && this.stamps[drop] <= cutoff) {
            drop++;
        }
        if (drop > 0) {
            this.stamps.splice(0, drop);
        }
    }
}

/**
 * connect 를 유발한 스케줄 이유. 접속 카운터의 이유별 집계 키.
 *  - start         : start()/forceImmediateReconnect 등 사용자·확장 진입점의 직접 연결
 *  - startup-prime : primeForRuntimeStart 윈도우 안의 빠른 폴링 재연결
 *  - batch         : 이벤트 배치 수신 후 FIN → 재연결
 *  - immediate-eof : payload 없이 즉시 FIN(이벤트 큐 비어 있음) → 적응형 폴링 재연결
 *  - idle-timeout  : payload 없이 idle timeout 으로 FIN → 고정 간격 재연결
 *  - empty-batch   : payload 없는 짧은 세션(Immediate EOF 와 Idle 사이) → 고정 간격 재연결
 *  - no-payload    : 그 외 무페이로드 이상 후보 → 적응형 재연결
 *  - error         : 소켓 에러/연결 실패 → 지수 백오프 재연결
 *  - watchdog      : 재연결 워치독의 강제 재연결
 */
export type ConnectReason =
    | 'start'
    | 'startup-prime'
    | 'batch'
    | 'immediate-eof'
    | 'idle-timeout'
    | 'empty-batch'
    | 'no-payload'
    | 'error'
    | 'watchdog';

/** 요약 로그에 쓰는 표시 순서/라벨 (관심도 순: 배치·폴링 churn → 에러 → 진입점·워치독). */
const CONNECT_REASON_ORDER: ReadonlyArray<[ConnectReason, string]> = [
    ['batch', 'batch'],
    ['immediate-eof', 'immediateEof'],
    ['idle-timeout', 'idle'],
    ['empty-batch', 'emptyBatch'],
    ['no-payload', 'noPayload'],
    ['error', 'error'],
    ['startup-prime', 'startupPrime'],
    ['start', 'start'],
    ['watchdog', 'watchdog'],
];

/** 접속 카운터: 누적 connect 수, 최근 60초 connect 수, 이유별 카운트. */
export class ConnectStats {
    /** 분당 접속 수 산출 윈도우. 이름(perMinute)과 의미를 맞추기 위해 60초 고정. */
    static readonly WINDOW_MS = 60_000;

    private _total = 0;
    private readonly byReason = new Map<ConnectReason, number>();
    private readonly window = new SlidingWindowCounter(ConnectStats.WINDOW_MS);

    /**
     * @param summaryEvery 요약 로그를 낼 주기(누적 N회마다). 1 미만이면 요약 없음.
     */
    constructor(readonly summaryEvery = 50) {}

    /** 누적 connect 시도 수 (프로세스 수명 기준, stop/start 로 초기화되지 않음). */
    get total(): number {
        return this._total;
    }

    record(reason: ConnectReason, now: number): void {
        this._total++;
        this.byReason.set(reason, (this.byReason.get(reason) ?? 0) + 1);
        this.window.record(now);
    }

    /** 최근 60초 안의 connect 수. */
    perMinute(now: number): number {
        return this.window.count(now);
    }

    count(reason: ConnectReason): number {
        return this.byReason.get(reason) ?? 0;
    }

    /** 누적 수가 summaryEvery 의 배수에 도달한 직후(record 직후 호출 기준) true. */
    shouldEmitSummary(): boolean {
        return this.summaryEvery >= 1 && this._total > 0 && this._total % this.summaryEvery === 0;
    }

    /**
     * `1403 connects: N total, M/min (batch=…, immediateEof=…, error=…)` 형식.
     * 0인 이유는 생략해 한 줄을 짧게 유지한다.
     */
    formatSummary(now: number): string {
        const parts: string[] = [];
        for (const [reason, label] of CONNECT_REASON_ORDER) {
            const n = this.count(reason);
            if (n > 0) {
                parts.push(`${label}=${n}`);
            }
        }
        const breakdown = parts.length > 0 ? ` (${parts.join(', ')})` : '';
        return `1403 connects: ${this._total} total, ${this.perMinute(now)}/min${breakdown}`;
    }
}

// ── 재연결 워치독 판정 ────────────────────────────────────────────────────────

/** 재연결 타이머가 예정 시각을 이만큼 넘겨도 발화하지 않으면 워치독이 대신 발화한다. */
export const WATCHDOG_TIMER_OVERDUE_MS = 10_000;
/** connect 콜백 없는 'connecting' 이 (connect timeout + 이 값) 을 넘기면 고착으로 본다. */
export const WATCHDOG_CONNECTING_GRACE_MS = 10_000;

export interface WatchdogInput {
    /** 판정 시각 (ms epoch) */
    now: number;
    /** start() 이후 stop()/dispose() 전인지. false 면 어떤 행동도 하지 않는다. */
    active: boolean;
    /** 소켓이 연결 성립 상태(connect 콜백 이후, close 전) */
    connected: boolean;
    /** 소켓 객체가 존재하는지 (connected=false 인데 true 면 'connecting' 중) */
    hasSocket: boolean;
    /** 마지막 connect 시도 시각 (0 = 없음) */
    connectAttemptAt: number;
    /** connect 자체 타임아웃 (runtimeConsole 의 CONNECT_TIMEOUT_MS) */
    connectTimeoutMs: number;
    /** 재연결 타이머가 걸려 있는지 */
    hasReconnectTimer: boolean;
    /** 재연결 타이머의 예정 발화 시각 (0 = 기록 없음) */
    reconnectDueAt: number;
    /** 최대 재시도 도달로 자동 재연결이 멈춘 상태 (사용자 조작으로만 재개) */
    reconnectStopped: boolean;
}

export type WatchdogAction =
    /** 정상 — 개입 없음 */
    | 'none'
    /** RECONNECT_STOPPED 상태 — 개입하지 않음(로그만 1회) */
    | 'skip-reconnect-stopped'
    /** connect 콜백 없이 connecting 이 너무 오래 지속 → 소켓 destroy 후 재스케줄 */
    | 'destroy-stuck-connecting'
    /** 재연결 타이머가 예정 시각을 크게 넘겨도 발화하지 않음 → 타이머 취소 후 즉시 연결 */
    | 'fire-overdue-timer'
    /** 소켓도 타이머도 없이 멈춘 상태 → 강제 재연결 */
    | 'force-reconnect';

export interface WatchdogDecision {
    action: WatchdogAction;
    /** 로그용 짧은 근거 */
    detail: string;
}

/**
 * 워치독 한 틱의 판정. 부수효과 없음 — 호출자가 action 에 따라 소켓/타이머를 다룬다.
 *
 * 우선순위: 비활성 → 연결됨 → connecting 고착 → 타이머 지연 → RECONNECT_STOPPED → 스케줄 부재.
 */
export function decideWatchdogAction(input: WatchdogInput): WatchdogDecision {
    if (!input.active) {
        return { action: 'none', detail: 'inactive' };
    }
    if (input.connected) {
        return { action: 'none', detail: 'connected' };
    }
    if (input.hasSocket) {
        // connecting 중. connect 자체 타임아웃(destroy → close → 재스케줄)이 1차 방어이고,
        // 그 경로까지 막힌 경우만 워치독이 정리한다.
        const limit = input.connectTimeoutMs + WATCHDOG_CONNECTING_GRACE_MS;
        const elapsed = input.connectAttemptAt > 0 ? input.now - input.connectAttemptAt : 0;
        if (input.connectAttemptAt > 0 && elapsed > limit) {
            return { action: 'destroy-stuck-connecting', detail: `connecting ${elapsed}ms > ${limit}ms` };
        }
        return { action: 'none', detail: 'connecting' };
    }
    if (input.hasReconnectTimer) {
        if (input.reconnectDueAt > 0) {
            const overdue = input.now - input.reconnectDueAt;
            if (overdue > WATCHDOG_TIMER_OVERDUE_MS) {
                return { action: 'fire-overdue-timer', detail: `timer overdue ${overdue}ms` };
            }
        }
        return { action: 'none', detail: 'reconnect scheduled' };
    }
    if (input.reconnectStopped) {
        return { action: 'skip-reconnect-stopped', detail: 'RECONNECT_STOPPED' };
    }
    return { action: 'force-reconnect', detail: 'no socket, no reconnect timer' };
}
