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
 *  - 상태 전이는 순수 함수처럼 동기적으로 일어나고 훅(onSuspect/onRecovering/onRecovered/onLost)으로만 밖에 알린다 — 테스트 대상.
 *
 * recovering 상태 (2026-08-31 추가):
 *  - 실측: `Unload GPL_Code` 가 응답 없이 타임아웃한 뒤 약 2.5분간 1402 새 연결이 ECONNREFUSED 되다가, 재부팅 없이
 *    정상 복귀했다(복귀 직후 ErrorLog/Show Thread/Show Memory 모두 STATUS 0). 종전 규칙에서는 그 거부 2회로
 *    definitive-threshold 가 걸려 3초 만에 유실이 확정됐다 — **TCP 연결 실패는 관측값이고 제어기 장애는 여러 독립
 *    증거를 종합한 판단**이라는 원칙에 반한다.
 *  - 그래서 채널을 일시적으로 못 쓰게 만들 수 있는 명령(commandPolicy.mayDisruptCommandChannel — Unload/Load/
 *    Compile/Start)이 **응답 없이** 끝나면 noteDisruptiveTimeout() 으로 recovering 에 들어간다. recovering 동안의
 *    refused/unreachable 은 definitive 카운터에 넣지 않고 recoveryProbeFailures 로 따로 센다 → 유실이 확정되지 않는다.
 *  - recovering 은 무한하지 않다. recoveryWindowMs(기본 180 s — 실측 172 s 를 덮는 값) 안에 프로브가 성공하면
 *    connected 로 복귀하고(사건 종결), 창을 넘기면 suspect 로 **강등**해 그때부터 종전 임계 판정을 받는다.
 *    즉 진짜 제어기 다운도 결국 감지되며, 늦어지는 상한이 recoveryWindowMs 다.
 *  - recovering 동안의 재프로브 간격은 reprobeDelayMs(1 s)가 아니라 recoveryProbeDelayMs(기본 5 s)다 — 거부하는
 *    포트에 1 s 간격 connect 를 180회 쌓는 것 자체가 제어기 TCP 자원을 압박한다(GitHub #22 가설 1).
 *    지수 백오프+지터는 후속(P1).
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

export type HealthState =
    /** 연결되지 않음(명시적 해제·유실 처리 완료). 보고를 모두 무시한다. */
    | 'disconnected'
    /** 정상. */
    | 'connected'
    /** 끊김 의심 — 재프로브로 확인 중이고, 임계에 닿으면 유실 확정. */
    | 'suspect'
    /**
     * 채널 교란 가능 명령이 응답 없이 끝난 뒤의 복구 대기 — 실패를 유실 임계에 넣지 않는다.
     * recoveryWindowMs 를 넘기면 suspect 로 강등된다.
     */
    | 'recovering';

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
    /**
     * recovering 으로 머무는 상한. 이 시간을 넘겨서도 프로브가 실패하면 suspect 로 강등해 종전 임계 판정을 받는다.
     * 설정 `gpl.controller.connectionRecoveryWindowMs`(기본 180000 — 2026-08-31 실측 복구 172 s 를 덮는 값).
     */
    recoveryWindowMs: number;
    /** recovering 동안의 재프로브 간격(거부하는 포트에 connect 를 쌓지 않기 위해 reprobeDelayMs 보다 크게). */
    recoveryProbeDelayMs: number;
}

export const DEFAULT_CONNECTION_HEALTH_POLICY: Readonly<ConnectionHealthPolicy> = {
    probeTimeoutMs: 8000,
    failureThreshold: 3,
    definitiveFailureThreshold: 2,
    reprobeDelayMs: 1000,
    hintCooldownMs: 10_000,
    recoveryWindowMs: 180_000,
    recoveryProbeDelayMs: 5000,
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

/**
 * 채널 교란 가능 명령이 응답 없이 끝난 사실 — recovering 의 근거. `causalRelation` 을 두지 않는 이유:
 * 이 명령이 채널 불가를 **일으켰다**는 것은 확정된 인과가 아니라 시간 관계일 뿐이다(추정과 관측을 섞지 않는다).
 */
export interface DisruptiveOperation {
    /** 응답 없이 끝난 명령 원문(`Unload GPL_Code`). */
    command: string;
    /** 왜 결과를 모르는지(`timeout` / `closed` / `reset`). */
    kind: ProbeFailureKind;
    detail: string;
    /** 관측 시각(epoch ms). */
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
    /** recovering 진입 시각(epoch ms). recovering 이 아니면 undefined. */
    recoveringSince?: number;
    /** recovering 동안의 프로브 실패 수 — 유실 임계에는 넣지 않는 별도 카운터. */
    recoveryProbeFailures: number;
    /** recovering 의 근거가 된 명령(결과 미확정). recovering 을 벗어나면 마지막 관측으로 남는다. */
    disruptiveOperation?: DisruptiveOperation;
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
    /** suspect/recovering 진입 → 복구까지(ms). */
    durationMs: number;
    /** 어느 상태에서 복구했는지 — 'recovering' 이면 채널 교란 뒤의 일시적 사용 불가였다는 뜻(사건 종결). */
    fromState: 'suspect' | 'recovering';
    /** fromState='recovering' 일 때 그 근거였던 명령. 그 명령의 실제 결과는 여전히 미확정임에 주의. */
    disruptiveOperation?: DisruptiveOperation;
}

/** recovering 진입 정보 — 호출자는 재프로브를 시작하고(정규 폴은 이 상태를 보고 스스로 줄일 수 있다) 사용자에게 알린다. */
export interface RecoveringInfo {
    operation: DisruptiveOperation;
    /** 이 상태에 머무는 상한(ms). 넘기면 suspect 로 강등된다. */
    windowMs: number;
    /** 어느 상태에서 들어왔는지. */
    fromState: HealthState;
}

export interface ConnectionHealthHooks {
    /** connected → suspect. 호출자는 재프로브를 시작한다(ConnectionHealthProber.start). */
    onSuspect(reason: string, snapshot: HealthSnapshot): void;
    /** → recovering (채널 교란 가능 명령이 응답 없이 끝남). 호출자는 재프로브를 시작한다. */
    onRecovering?(info: RecoveringInfo, snapshot: HealthSnapshot): void;
    /** suspect/recovering → connected (프로브 성공). */
    onRecovered(info: RecoveryInfo): void;
    /** suspect → 유실 확정. 호출자는 연결 상태를 끊는다. 모니터 자신은 disconnected 로 돌아간다. */
    onLost(summary: LossSummary): void;
}

export type ProbeReport = 'ignored' | 'connected' | 'suspect' | 'recovering' | 'lost';
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
    private _recoveringSince = 0;
    private _recoveryFailures = 0;
    private _operation: DisruptiveOperation | undefined;

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
            recoveringSince: this._state === 'recovering' ? this._recoveringSince : undefined,
            recoveryProbeFailures: this._recoveryFailures,
            disruptiveOperation: this._operation,
        };
    }

    /** 명시적 연결/해제(connect 성공·Disconnect 명령·유실 처리 완료). 카운터를 초기화한다. */
    setConnected(connected: boolean): void {
        this._state = connected ? 'connected' : 'disconnected';
        this.resetCounters();
        this._lastRecoveredAt = 0;
        this._operation = undefined;
        if (!connected) { this._lastFailure = undefined; }
    }

    /**
     * 채널 교란 가능 명령(commandPolicy.mayDisruptCommandChannel)이 **응답 없이** 끝났음을 보고한다 →
     * recovering 진입. 이 명령의 실제 결과는 미확정이며(제어기가 실행했을 수도, 안 했을 수도 있다) 이 보고는
     * 인과를 확정하지 않는다 — recovering 동안의 연결 거부를 유실 임계에 넣지 않는 것이 전부다.
     *
     * disconnected 면 무시한다(끊긴 뒤의 잔향). connected/suspect/recovering 에서는 창을 새로 연다.
     */
    noteDisruptiveTimeout(operation: Omit<DisruptiveOperation, 'at'> & { at?: number }): 'ignored' | 'recovering' {
        if (this._state === 'disconnected') { return 'ignored'; }
        const now = this.now();
        const op: DisruptiveOperation = { ...operation, at: operation.at ?? now };
        const fromState = this._state;
        this._operation = op;
        this._state = 'recovering';
        this._recoveringSince = now;
        this._recoveryFailures = 0;
        // 종전 suspect 카운터는 버린다 — 이제 이 사건은 "명령 뒤 채널 복구 대기"로 다시 분류됐다.
        this._failures = 0;
        this._definitive = 0;
        this._suspectSince = 0;
        this._suspectReason = '';
        const windowMs = this.policyOf().recoveryWindowMs;
        this.hooks.onRecovering?.({ operation: op, windowMs, fromState }, this.snapshot());
        return 'recovering';
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
            if (this._state === 'suspect' || this._state === 'recovering') {
                const fromRecovering = this._state === 'recovering';
                const info: RecoveryInfo = {
                    failuresBeforeRecovery: fromRecovering ? this._recoveryFailures : this._failures,
                    suspectReason: fromRecovering ? describeDisruptiveOperation(this._operation) : this._suspectReason,
                    durationMs: Math.max(0, now - (fromRecovering ? this._recoveringSince : this._suspectSince)),
                    fromState: fromRecovering ? 'recovering' : 'suspect',
                    disruptiveOperation: fromRecovering ? this._operation : undefined,
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

        // recovering: 실패를 유실 임계에 넣지 않는다. 창을 넘기면 suspect 로 강등해 아래의 종전 규칙을 그때부터 적용한다.
        if (this._state === 'recovering') {
            this._recoveryFailures++;
            const windowMs = this.policyOf().recoveryWindowMs;
            const elapsed = Math.max(0, now - this._recoveringSince);
            if (elapsed < windowMs) {
                return 'recovering';
            }
            const failures = this._recoveryFailures;
            this._state = 'suspect';
            this._suspectSince = now;
            this._suspectReason = `recovery-window-expired: ${describeDisruptiveOperation(this._operation)} 뒤 `
                + `${(elapsed / 1000).toFixed(0)} s(${failures}회 프로브) 동안 복구되지 않음 — 여기서부터 일반 임계 판정`;
            this._recoveringSince = 0;
            this._recoveryFailures = 0;
            this._failures = 0;
            this._definitive = 0;
            this.hooks.onSuspect(this._suspectReason, this.snapshot());
        }

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
        this._recoveringSince = 0;
        this._recoveryFailures = 0;
    }
}

/** 로그용 한 마디: `Unload GPL_Code(timeout)`. 관측이 없으면 `(명령 미확인)`. */
export function describeDisruptiveOperation(op: DisruptiveOperation | undefined): string {
    return op ? `${op.command}(${op.kind})` : '(명령 미확인)';
}

/**
 * recovering 을 사람이 읽을 한 줄. **관측만** 적는다 — "이 명령이 채널을 닫았다"고 쓰지 않는다(인과 미확정).
 */
export function describeRecovering(info: RecoveringInfo): string {
    const { operation: op, windowMs } = info;
    return `${op.command} 가 응답 없이 끝남(${op.kind}${op.detail ? ` — ${op.detail}` : ''}) — 명령의 실제 결과는 미확정. `
        + `최대 ${(windowMs / 1000).toFixed(0)} s 동안 채널 복구를 기다린다(이 사이의 연결 거부는 유실로 세지 않음).`;
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

/** 재프로브가 도는 상태 — suspect(임계 판정) 또는 recovering(복구 대기). */
const PROBING_STATES: ReadonlySet<HealthState> = new Set<HealthState>(['suspect', 'recovering']);

/**
 * suspect/recovering 동안 프로브를 보내 모니터에 보고한다. 모니터가 connected 로 복귀하거나
 * disconnected(유실 확정·명시적 해제)가 되면 멈춘다. start()는 멱등(진행 중이면 무시).
 * 간격은 상태에 따라 다르다 — suspect 는 reprobeDelayMs(1 s, 빨리 판정), recovering 은 recoveryProbeDelayMs(5 s,
 * 거부하는 포트에 connect 를 쌓지 않는다). 매 회 상태를 다시 보므로 강등/복구 시 간격이 곧바로 바뀐다.
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
        const policy = this.monitor.policy;
        const delay = Math.max(0, this.monitor.state === 'recovering' ? policy.recoveryProbeDelayMs : policy.reprobeDelayMs);
        this._timer = this.timers.setTimeout(() => {
            this._timer = null;
            void this.runOnce(gen);
        }, delay);
    }

    private async runOnce(gen: number): Promise<void> {
        if (gen !== this._generation) { return; }
        if (!PROBING_STATES.has(this.monitor.state)) {
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
        if (PROBING_STATES.has(this.monitor.state)) {
            this.scheduleNext(gen);
        } else {
            this._running = false;
        }
    }
}
