/**
 * 1402 유휴 세션 유지(idle ping) — vscode/net 무의존 (2026-08-28, GDE 1403 캡처 판독 후속).
 *
 * 배경: GDE는 1402 세션을 한 번 열어 끝까지 유지하고 유휴 시에도 5 s마다 가벼운 읽기 명령(`PD …`)을 보낸다.
 * 제어기는 그 세션을 쥔 클라이언트에게 1403 런타임 스트림을 계속 열어 두는 것으로 관측된다
 * (GDE: 1403 36.7 s 연속 수신 / 확장 keep-alive 도입 후 08-27 로그: 1403 세션 44.4분 유지 /
 *  종전 단명 1402 시절: 1403이 배치마다 FIN). 즉 1403 안정성의 열쇠는 1403에 무언가를 보내는 것이 아니라
 *  **1402 세션을 놓지 않는 것**이다 — 상세는 docs/ai-handoff.md §1-BM.
 *
 * 이 모듈은 "마지막 1402 명령 뒤 intervalMs 동안 명령이 없으면 읽기 전용 명령 1개를 보낸다"는 판정만 담당한다.
 * 실제 송신은 controllerConnection.ts 가 직렬 큐(sendCommandDetailed)로 수행하므로 다른 명령과 병렬로 나가지 않는다.
 */

export interface IdlePingDecisionInput {
    /** 설정상 사용 여부(keepAlive1402 && intervalMs > 0). */
    enabled: boolean;
    /** 유휴 판정 간격(ms). GDE 실측 5 s. */
    intervalMs: number;
    /** 현재 진행 중인 1402 명령 수 — 0이 아니면 유휴가 아니다. */
    inFlight: number;
    /** 마지막 명령 시작/종료 시각(ms epoch). */
    lastActivityAt: number;
    now: number;
}

/** 순수 판정: 지금 ping 을 보내야 하는가. */
export function shouldIdlePing(i: IdlePingDecisionInput): boolean {
    if (!i.enabled || !(i.intervalMs > 0)) { return false; }
    if (i.inFlight > 0) { return false; }
    return i.now - i.lastActivityAt >= i.intervalMs;
}

export interface IdlePingStats {
    pings: number;
    failures: number;
    lastPingAt: number | null;
    lastFailureMessage: string | null;
}

export interface IdlePingSchedulerOptions {
    /** 설정을 매 tick 읽는다(설정 변경 즉시 반영). */
    intervalMs: () => number;
    enabled: () => boolean;
    /** ping 명령 1회 송신. 실패는 throw 로 알린다. */
    send: () => Promise<void>;
    log?: (message: string) => void;
    /** 타이머 주기(ms). 기본 1000. 테스트에서 tick() 을 직접 부르면 타이머는 필요 없다. */
    tickMs?: number;
    now?: () => number;
}

/**
 * 유휴 ping 스케줄러. 명령 활동은 noteCommandStart/End 로 보고받고, start()~stop() 사이에만 타이머가 돈다.
 * ping 자체도 명령이므로(큐를 지나며 noteCommand* 가 호출됨) 연속 ping 은 자연히 intervalMs 간격이 된다.
 */
export class IdlePingScheduler {
    private timer: ReturnType<typeof setInterval> | null = null;
    private inFlight = 0;
    private lastActivityAt: number;
    private pingInFlight = false;
    private readonly stats: IdlePingStats = { pings: 0, failures: 0, lastPingAt: null, lastFailureMessage: null };
    private readonly now: () => number;

    constructor(private readonly opts: IdlePingSchedulerOptions) {
        this.now = opts.now ?? (() => Date.now());
        this.lastActivityAt = this.now();
    }

    get running(): boolean { return this.timer !== null; }
    get inFlightCount(): number { return this.inFlight; }
    getStats(): IdlePingStats { return { ...this.stats }; }

    noteCommandStart(now: number = this.now()): void {
        this.inFlight++;
        this.lastActivityAt = now;
    }

    noteCommandEnd(now: number = this.now()): void {
        this.inFlight = Math.max(0, this.inFlight - 1);
        this.lastActivityAt = now;
    }

    start(): void {
        if (this.timer) { return; }
        this.lastActivityAt = this.now();
        const tickMs = Math.max(100, this.opts.tickMs ?? 1000);
        this.timer = setInterval(() => { void this.tick(); }, tickMs);
        this.timer.unref?.();
    }

    stop(): void {
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
    }

    /** 타이머 콜백. 테스트에서는 직접 호출한다. ping 을 보냈으면 true. */
    async tick(now: number = this.now()): Promise<boolean> {
        if (this.pingInFlight) { return false; }
        const fire = shouldIdlePing({
            enabled: this.opts.enabled(),
            intervalMs: this.opts.intervalMs(),
            inFlight: this.inFlight,
            lastActivityAt: this.lastActivityAt,
            now,
        });
        if (!fire) { return false; }
        this.pingInFlight = true;
        this.lastActivityAt = now;
        this.stats.pings++;
        this.stats.lastPingAt = now;
        try {
            await this.opts.send();
        } catch (err) {
            this.stats.failures++;
            const msg = err instanceof Error ? err.message : String(err);
            this.stats.lastFailureMessage = msg;
            // 첫 실패와 10회마다만 기록 — 제어기 무응답 중 5 s마다 같은 줄이 쌓이는 것 방지.
            if (this.stats.failures === 1 || this.stats.failures % 10 === 0) {
                this.opts.log?.(`1402 idle ping failed (${this.stats.failures}): ${msg}`);
            }
        } finally {
            this.pingInFlight = false;
        }
        return true;
    }
}
