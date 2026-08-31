/**
 * 제어기 연결 건강 판정(vscode 무의존) — "연결 끊김을 자동 감지하지 못한다" 검토(2026-08-28) 대응.
 *
 * 배경(종전):
 *  - 유실 판정은 트리 폴링(controllerTreeProvider.doRefresh)의 `Show Thread` 3회 연속 실패 한 곳뿐이었다. 실패 1회가
 *    timeoutMs(10 s)에, 실패 뒤에도 그대로 보내던 ErrorLog/Show Break(각 10 s)까지 겹쳐 최대 30 s → 상태바가 바뀌기까지
 *    100 s 이상(쓰레드 0개면 폴 간격 15 s라 더 늦음).
 *  - 디버그 세션 중엔 트리 폴링이 꺼지고(enterDebugMode) 어댑터는 자체 5회 실패로 세션만 끊었다 — 확장의 연결 상태는 그대로.
 *  - 1403 connect-failed·keep-alive 소켓 error·대시보드 프로브 실패처럼 끊김을 먼저 아는 신호가 판정에 연결돼 있지 않았다.
 *
 * 설계:
 *  - 판정은 ConnectionHealthMonitor 하나로 모은다. 트리 폴·디버그 어댑터 폴·재프로브는 **프로브 결과**(reportProbe)를,
 *    1403·keep-alive 소켓·대시보드·어댑터 종료는 **힌트**(reportHint)를 보고만 한다.
 *  - 힌트는 유실을 단정하지 않는다 — connected → suspect 로만 옮기고, 판정은 1402 `Show Thread` 프로브(probeTimeoutMs,
 *    기본 8 s) 결과로만 한다(간접 신호로 단정 금지 — ai-handoff §0 하드 규칙의 취지).
 *  - suspect 동안 ConnectionHealthProber 가 reprobeDelayMs(1 s) 간격으로 재프로브한다(정규 폴 간격을 기다리지 않음).
 *    성공하면 connected 복귀(제어기가 돌아온 경우). 연속 실패가 failureThreshold(3)에 이르거나 확정적 실패
 *    (ECONNREFUSED/EHOSTUNREACH/ENETUNREACH — 제어기 부재·서비스 다운)가 definitiveFailureThreshold(2)에 이르면 lost →
 *    호출자가 연결 상태를 끊는다. 유실 뒤 자동 재접속 루프는 두지 않는다(사용자 결정 2026-08-28: "다시 연결이 안 되는 경우
 *    연결 상태를 끊어라" — 재연결은 명시적 Connect).
 *  - 상태 전이는 순수 함수처럼 동기적으로 일어나고 훅(onSuspect/onRecovered/onLost)으로만 밖에 알린다 — 테스트 대상.
 */

export type ProbeFailureKind =
    /** 새 연결이 거부됨(ECONNREFUSED) — 호스트는 있으나 1402 서비스가 없음(재부팅 중·소프트웨어 다운·게이트웨이가 대신 응답). */
    | 'refused'
    /** 호스트/네트워크 도달 불가(EHOSTUNREACH/ENETUNREACH/EHOSTDOWN/ENETDOWN). */
    | 'unreachable'
    /** 응답 없이 프로브 타임아웃(우리 타이머) 또는 OS 연결 타임아웃(ETIMEDOUT). */
    | 'timeout'
    /** 연결이 리셋됨(ECONNRESET/EPIPE). */
    | 'reset'
    /** 응답 바이트 없이 소켓이 닫힘. */
    | 'closed'
    /** 바이트는 왔으나 `<STATUS>`가 없음(잘린 응답·HTTP 교차 응답 등). */
    | 'incomplete'
    | 'other';

export type ProbeOutcome =
    | { ok: true; raw: string }
    | { ok: false; kind: ProbeFailureKind; detail: string };

export type HealthHintSource = 'runtime-console' | 'keep-alive-socket' | 'dashboard' | 'debug-adapter' | 'command';

export type HealthState = 'disconnected' | 'connected' | 'suspect';

export interface ConnectionHealthPolicy {
    /** 프로브(Show Thread 폴·재프로브)의 응답 대기 시간. 설정 `gpl.controller.connectionProbeTimeoutMs`(기본 8000). */
    probeTimeoutMs: number;
    /** 연속 실패 이 횟수면 유실 확정(실패 종류 무관). */
    failureThreshold: number;
    /** 확정적 실패(refused/unreachable) 연속 이 횟수면 유실 확정 — 제어기 부재는 더 빨리 결론낸다. */
    definitiveFailureThreshold: number;
    /** suspect 상태에서 재프로브까지의 지연. */
    reprobeDelayMs: number;
    /** 복구 직후 이 시간 안의 힌트는 무시한다(1403 백오프 재시도 등 잔향으로 프로브가 반복되는 것 방지). */
    hintCooldownMs: number;
}

export const DEFAULT_CONNECTION_HEALTH_POLICY: Readonly<ConnectionHealthPolicy> = {
    probeTimeoutMs: 8000,
    failureThreshold: 3,
    definitiveFailureThreshold: 2,
    reprobeDelayMs: 1000,
    hintCooldownMs: 10_000,
};

export const DEFINITIVE_FAILURE_KINDS: ReadonlySet<ProbeFailureKind> = new Set<ProbeFailureKind>(['refused', 'unreachable']);

// ── 순수 헬퍼 ──────────────────────────────────────────────────────────────

/**
 * 1402 명령 실패(reject 사유)를 프로브 실패 종류로 분류한다. consoleSocket 이 붙여 주는 `code`를 우선하고,
 * 없으면 메시지의 errno 토큰/문구로 판정한다(`Connection error (ip:port): connect ECONNREFUSED …` 형식 포함).
 */
export function classifyCommandFailure(err: unknown): { kind: ProbeFailureKind; detail: string } {
    const e = (err ?? {}) as { code?: unknown; message?: unknown };
    const code = typeof e.code === 'string' ? e.code : '';
    const message = typeof e.message === 'string' ? e.message : String(err ?? '');
    const detail = message || code || 'unknown error';
    const text = `${code} ${message}`;
    if (/\bECONNREFUSED\b/.test(text)) { return { kind: 'refused', detail }; }
    if (/\b(EHOSTUNREACH|ENETUNREACH|EHOSTDOWN|ENETDOWN)\b/.test(text)) { return { kind: 'unreachable', detail }; }
    if (/\b(ECONNRESET|EPIPE)\b/.test(text)) { return { kind: 'reset', detail }; }
    if (/\b(ETIMEDOUT|COMMAND_TIMEOUT)\b/.test(text) || /\btimeout\b/i.test(message)) { return { kind: 'timeout', detail }; }
    if (/\bECONNCLOSED\b/.test(text) || /closed without response/i.test(message)) { return { kind: 'closed', detail }; }
    return { kind: 'other', detail };
}

/**
 * 프로브 응답 raw → 결과. 살아 있음의 기준은 `<STATUS>` 존재(STATUS 코드가 0이 아니어도 제어기가 응답한 것).
 * 소켓 종료로 잘린 부분 응답·HTTP 교차 응답은 실패('incomplete') — 종전 trySendCommand 기준(null 만 실패)에서는
 * 이런 응답이 "성공"으로 카운터를 리셋했다.
 */
export function probeOutcomeFromResponse(raw: string): ProbeOutcome {
    if (typeof raw === 'string' && raw.includes('<STATUS>')) {
        return { ok: true, raw };
    }
    const bytes = typeof raw === 'string' ? raw.length : 0;
    return { ok: false, kind: 'incomplete', detail: `<STATUS> 없는 응답 (${bytes} bytes)` };
}

export function isDefinitiveFailure(kind: ProbeFailureKind): boolean {
    return DEFINITIVE_FAILURE_KINDS.has(kind);
}

// ── 모니터 ────────────────────────────────────────────────────────────────

export interface HealthFailureRecord {
    kind: ProbeFailureKind;
    detail: string;
    at: number;
}

export interface HealthSnapshot {
    state: HealthState;
    consecutiveFailures: number;
    consecutiveDefinitiveFailures: number;
    /** suspect 진입 시각(epoch ms). connected/disconnected 면 undefined. */
    suspectSince?: number;
    /** suspect 진입 사유(`probe: timeout — …` / `runtime-console: connect-failed …`). */
    suspectReason?: string;
    lastFailure?: HealthFailureRecord;
    lastProbeOkAt?: number;
}

export interface LossSummary {
    failures: number;
    definitiveFailures: number;
    lastFailure: HealthFailureRecord;
    suspectSince: number;
    suspectReason: string;
    lostAt: number;
    /** suspect 진입 → 유실 확정까지(ms). */
    durationMs: number;
    /** 어느 임계에 걸렸는지. */
    trigger: 'failure-threshold' | 'definitive-threshold';
}

export interface RecoveryInfo {
    failuresBeforeRecovery: number;
    suspectReason: string;
    /** suspect 진입 → 복구까지(ms). */
    durationMs: number;
}

export interface ConnectionHealthHooks {
    /** connected → suspect. 호출자는 재프로브를 시작한다(ConnectionHealthProber.start). */
    onSuspect(reason: string, snapshot: HealthSnapshot): void;
    /** suspect → connected (프로브 성공). */
    onRecovered(info: RecoveryInfo): void;
    /** suspect → 유실 확정. 호출자는 연결 상태를 끊는다. 모니터 자신은 disconnected 로 돌아간다. */
    onLost(summary: LossSummary): void;
}

export type ProbeReport = 'ignored' | 'connected' | 'suspect' | 'lost';
export type HintReport = 'ignored' | 'suspect';

export class ConnectionHealthMonitor {
    private _state: HealthState = 'disconnected';
    private _failures = 0;
    private _definitive = 0;
    private _suspectSince = 0;
    private _suspectReason = '';
    private _lastFailure: HealthFailureRecord | undefined;
    private _lastProbeOkAt = 0;
    private _lastRecoveredAt = 0;

    constructor(
        private readonly policyOf: () => ConnectionHealthPolicy,
        private readonly hooks: ConnectionHealthHooks,
        private readonly now: () => number = Date.now,
    ) {}

    get state(): HealthState { return this._state; }

    get policy(): ConnectionHealthPolicy { return this.policyOf(); }

    snapshot(): HealthSnapshot {
        return {
            state: this._state,
            consecutiveFailures: this._failures,
            consecutiveDefinitiveFailures: this._definitive,
            suspectSince: this._state === 'suspect' ? this._suspectSince : undefined,
            suspectReason: this._state === 'suspect' ? this._suspectReason : undefined,
            lastFailure: this._lastFailure,
            lastProbeOkAt: this._lastProbeOkAt || undefined,
        };
    }

    /** 명시적 연결/해제(connect 성공·Disconnect 명령·유실 처리 완료). 카운터를 초기화한다. */
    setConnected(connected: boolean): void {
        this._state = connected ? 'connected' : 'disconnected';
        this.resetCounters();
        this._lastRecoveredAt = 0;
        if (!connected) { this._lastFailure = undefined; }
    }

    /**
     * 프로브(Show Thread 폴·재프로브·디버그 어댑터 폴) 결과 보고.
     * disconnected 면 무시. 성공은 suspect → connected 복구, 실패는 카운터 증가 후 임계 판정.
     */
    reportProbe(outcome: ProbeOutcome): ProbeReport {
        if (this._state === 'disconnected') { return 'ignored'; }
        const now = this.now();
        if (outcome.ok) {
            this._lastProbeOkAt = now;
            if (this._state === 'suspect') {
                const info: RecoveryInfo = {
                    failuresBeforeRecovery: this._failures,
                    suspectReason: this._suspectReason,
                    durationMs: Math.max(0, now - this._suspectSince),
                };
                this._state = 'connected';
                this.resetCounters();
                this._lastRecoveredAt = now;
                this.hooks.onRecovered(info);
            } else {
                this.resetCounters();
            }
            return 'connected';
        }

        this._lastFailure = { kind: outcome.kind, detail: outcome.detail, at: now };
        this._failures++;
        this._definitive = isDefinitiveFailure(outcome.kind) ? this._definitive + 1 : 0;

        if (this._state === 'connected') {
            this._state = 'suspect';
            this._suspectSince = now;
            this._suspectReason = `probe: ${outcome.kind}${outcome.detail ? ` — ${outcome.detail}` : ''}`;
            this.hooks.onSuspect(this._suspectReason, this.snapshot());
        }

        const policy = this.policyOf();
        const trigger: LossSummary['trigger'] | undefined =
            this._definitive >= policy.definitiveFailureThreshold ? 'definitive-threshold'
                : this._failures >= policy.failureThreshold ? 'failure-threshold'
                    : undefined;
        if (!trigger) { return 'suspect'; }

        const summary: LossSummary = {
            failures: this._failures,
            definitiveFailures: this._definitive,
            lastFailure: this._lastFailure,
            suspectSince: this._suspectSince,
            suspectReason: this._suspectReason,
            lostAt: now,
            durationMs: Math.max(0, now - this._suspectSince),
            trigger,
        };
        this._state = 'disconnected';
        this.resetCounters();
        this._lastRecoveredAt = 0;
        this.hooks.onLost(summary);
        return 'lost';
    }

    /**
     * 간접 신호 보고(1403 connect-failed/socket-error, keep-alive 소켓 error, 대시보드 프로브 실패, 어댑터 실패 종료).
     * connected 에서만 suspect 로 옮긴다 — 이미 suspect 면 재프로브가 진행 중이고, disconnected 면 무의미.
     * 복구 직후 hintCooldownMs 안의 힌트는 잔향으로 보고 무시한다.
     */
    reportHint(source: HealthHintSource, detail: string): HintReport {
        if (this._state !== 'connected') { return 'ignored'; }
        const now = this.now();
        if (this._lastRecoveredAt > 0 && now - this._lastRecoveredAt < this.policyOf().hintCooldownMs) {
            return 'ignored';
        }
        this._state = 'suspect';
        this._suspectSince = now;
        this._suspectReason = `${source}: ${detail}`;
        this.hooks.onSuspect(this._suspectReason, this.snapshot());
        return 'suspect';
    }

    private resetCounters(): void {
        this._failures = 0;
        this._definitive = 0;
        this._suspectSince = 0;
        this._suspectReason = '';
    }
}

/** 로그용 한 줄: `3회 연속 실패(확정적 0회) · 마지막 timeout — Command timeout (8000ms): Show Thread -web · 의심 27.3 s (probe: timeout — …)`. */
export function describeLoss(summary: LossSummary): string {
    const secs = (summary.durationMs / 1000).toFixed(1);
    const why = summary.trigger === 'definitive-threshold' ? '연결 거부/도달 불가 확정' : '연속 실패 임계';
    return `${summary.failures}회 연속 실패(확정적 ${summary.definitiveFailures}회, ${why}) · 마지막 ${summary.lastFailure.kind} — ${summary.lastFailure.detail} · 의심 ${secs} s (${summary.suspectReason})`;
}

// ── 재프로브 루프 ─────────────────────────────────────────────────────────

export interface ProberTimers {
    setTimeout(fn: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
}

const defaultTimers: ProberTimers = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: h => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/**
 * suspect 동안 reprobeDelayMs 간격으로 프로브를 보내 모니터에 보고한다. 모니터가 connected 로 복귀하거나
 * disconnected(유실 확정·명시적 해제)가 되면 멈춘다. start()는 멱등(진행 중이면 무시).
 * 프로브 함수는 예외를 내지 않는 것이 원칙이나(controllerConnection.probeControllerCommand), 내더라도 실패로 분류한다.
 */
export class ConnectionHealthProber {
    private _generation = 0;
    private _timer: unknown = null;
    private _running = false;

    constructor(
        private readonly monitor: ConnectionHealthMonitor,
        private readonly probe: (timeoutMs: number) => Promise<ProbeOutcome>,
        private readonly timers: ProberTimers = defaultTimers,
    ) {}

    get active(): boolean { return this._running; }

    start(): void {
        if (this._running) { return; }
        this._running = true;
        this.scheduleNext(++this._generation);
    }

    stop(): void {
        this._generation++;
        if (this._timer !== null) {
            this.timers.clearTimeout(this._timer);
            this._timer = null;
        }
        this._running = false;
    }

    private scheduleNext(gen: number): void {
        const delay = Math.max(0, this.monitor.policy.reprobeDelayMs);
        this._timer = this.timers.setTimeout(() => {
            this._timer = null;
            void this.runOnce(gen);
        }, delay);
    }

    private async runOnce(gen: number): Promise<void> {
        if (gen !== this._generation) { return; }
        if (this.monitor.state !== 'suspect') {
            this._running = false;
            return;
        }
        let outcome: ProbeOutcome;
        try {
            outcome = await this.probe(this.monitor.policy.probeTimeoutMs);
        } catch (err) {
            outcome = { ok: false, ...classifyCommandFailure(err) };
        }
        if (gen !== this._generation) { return; }
        this.monitor.reportProbe(outcome);
        if (this.monitor.state === 'suspect') {
            this.scheduleNext(gen);
        } else {
            this._running = false;
        }
    }
}
