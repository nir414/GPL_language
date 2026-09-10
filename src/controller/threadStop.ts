/**
 * 쓰레드 전체 정지 — "안전한 한 동작"의 단일 정본 (vscode 무의존, 주입형 IO).
 *
 * ## 왜 이 모듈이 있는가
 *
 * 제어기의 `Stop -all` 은 **정지 요청 접수**까지만 보장한다(§0.6). 그래서 "프로그램을 멈춘다"라는
 * 하나의 안전한 동작은 명령 한 줄이 아니라 아래 절차 **전체**다.
 *
 *   1. `Stop -all` 전송 — 무응답이면 재전송한다.
 *   2. STATUS 판정 — `0` 은 "접수", `-752`(Timeout stopping thread)는 **실패가 아니라 정지 진행 중**이다
 *      (GPL 에러 문서: "This is not a critical error"). 그 외 코드만 실패로 본다.
 *   3. 정지 완료 확인 — `Show Thread  -web` 을 폴링해 **목록이 비거나 모두 정지 상태**가 될 때까지 기다린다.
 *      인자 없는 `Show Thread` 는 실행 중에도 빈 응답을 줄 수 있어 게이트가 항상 통과하는 false-pass 가 된다.
 *   4. 그래도 안 멈췄으면 `Stop -all` 을 한 번 더 보내고 다시 확인한다(가끔 나는 -752 타임아웃 때문에
 *      사용자가 손으로 재시도하지 않도록, 2026-08-05).
 *   5. 응답이 아예 없으면(STATUS 종결자 미수신) **"정지됐다"고 단정하지 않는다** — `unconfirmed` 로 알린다.
 *
 * 이 절차가 호출부마다 다시 조립되면서 배포·패널·FTP·디버그가 서로 다른 기준을 갖게 됐고,
 * 디버그 attach preflight 는 정지 확인이 아예 빠져 있었다(2026-09-10 §1-DC 조사). 그래서 절차를 여기 하나로
 * 모으고, 호출부는 전송 수단(IO)만 주입한다 — 제어기의 부실한 원시 명령 위에 확장이 얹는 API 한 겹이다.
 *
 * ## 쓰는 법
 *
 * ```ts
 * const outcome = await stopAllAndSettle({
 *     send: async cmd => { const raw = await sendCommand(cmd); return { raw }; },
 *     log: line => channel.appendLine(line),
 *     sleep,
 * });
 * // 실패 사유는 outcome.failure, "왜 아직 도는지"는 outcome.settle.activeDesc 로 설명한다.
 * if (!outcome.ok) { showFailure(outcome); }
 * ```
 *
 * 단위 테스트: `src/test/threadStop.test.ts` (가짜 IO 로 시나리오를 재현한다).
 */

import { NO_STATUS_CODE, SHOW_THREAD_LIST_CMD, ThreadInfo, parseStatus, parseThreadList } from './responseParser';
import { isBusyStatus } from './controllerStatusCodes';
import { isSettledState } from './threadActivity';

/** 전체 정지 명령 — 표기 단일 출처(공백/대소문자를 호출부마다 다르게 쓰지 않는다). */
export const STOP_ALL_CMD = 'Stop -all';

/** IO 가 돌려주는 1402 응답. */
export interface ThreadStopResponse {
    /** 응답 원문. */
    raw: string;
    /**
     * `</STATUS>` 종결자까지 받았는가. 판별할 수 없는 전송 경로는 생략한다(생략 = 받은 것으로 본다).
     * `false` 면 응답이 잘린 것이므로 그 조회는 **확인 불가**로 취급한다(하드 규칙 2).
     */
    statusComplete?: boolean;
}

/**
 * 전송·로그·대기를 호출부가 주입한다. 배포 트레이스·확장 Output·DAP 콘솔 등 목적지가 다르고,
 * 재시도 정책(busy 백오프 등)도 호출부의 전송 계층에 이미 있기 때문이다.
 */
export interface ThreadStopIo {
    /** 1402 명령 전송. 타임아웃·연결 실패는 예외 대신 `null` 로 돌려준다(예외를 던져도 null 로 다룬다). */
    send(command: string): Promise<ThreadStopResponse | null>;
    /** 진행 로그 한 줄. 접두(`logPrefix`)는 이 모듈이 붙여서 넘긴다. */
    log(line: string): void;
    sleep(ms: number): Promise<void>;
    /** 취소 신호(배포 취소 토큰 등). 없으면 취소 없음. */
    isCancelled?(): boolean;
    /** 시각 주입(테스트용). 기본 `Date.now`. */
    now?(): number;
}

export interface ThreadStopOptions {
    /** 정지 완료를 기다리는 상한(기본 8000ms). */
    settleTimeoutMs?: number;
    /** 정지 확인 폴링 간격(기본 500ms). */
    pollIntervalMs?: number;
    /** `Stop -all` 최대 전송 횟수 — settle 실패 시의 자동 재시도 포함(기본 2). */
    maxStopAttempts?: number;
    /** 무응답 시 같은 전송을 다시 시도할 횟수(기본 1). */
    resendOnNoResponse?: number;
    /** 로그 줄 접두(예: 배포 트레이스의 `'│ '`). 기본 빈 문자열. */
    logPrefix?: string;
}

interface ResolvedOptions {
    settleTimeoutMs: number;
    pollIntervalMs: number;
    maxStopAttempts: number;
    resendOnNoResponse: number;
    logPrefix: string;
}

function resolveOptions(opts?: ThreadStopOptions): ResolvedOptions {
    return {
        settleTimeoutMs: Math.max(0, opts?.settleTimeoutMs ?? 8000),
        pollIntervalMs: Math.max(50, opts?.pollIntervalMs ?? 500),
        maxStopAttempts: Math.max(1, opts?.maxStopAttempts ?? 2),
        resendOnNoResponse: Math.max(0, opts?.resendOnNoResponse ?? 1),
        logPrefix: opts?.logPrefix ?? '',
    };
}

/** `Show Thread  -web` 한 번의 결과. */
export interface ThreadProbe {
    threads: ThreadInfo[];
    /** 정지 계열(Idle/Stopped/Error)이 아닌 쓰레드 — "왜 아직인지" 설명용. */
    active: ThreadInfo[];
    /** 목록의 전체 쓰레드 수. 완전 정지 후에는 0 이 된다. */
    total: number;
}

/** `Stop -all` 전송 한 건의 결과. */
export type StopSendOutcome =
    /** STATUS 0 — 정지 요청 접수(완료 아님). */
    | { kind: 'accepted'; statusCode: number }
    /** STATUS -752 등 busy — 정지 진행 중(비치명). 실제 정지는 settle 로 판정한다. */
    | { kind: 'stopping'; statusCode: number; message: string }
    /** 응답 없음 또는 그 외 STATUS — 실패. */
    | { kind: 'failed'; command: string; statusCode?: number; message: string };

/** 정지 완료 확인의 결과. */
export interface SettleOutcome {
    /** 모든 쓰레드가 정지됐거나(관측), 확인 불가로 통과시킨 경우 true. */
    settled: boolean;
    /** `Show Thread` 응답을 받지 못해 **실제로 확인하지는 못했다**(settled=true 여도 관측은 아님). */
    unconfirmed: boolean;
    /** 취소 신호로 중단됐다. */
    cancelled?: boolean;
    /** 마지막으로 관측된 활성 쓰레드 설명(`이름(상태)` 나열). */
    activeDesc?: string;
    /** 마지막 관측 목록. */
    threads?: ThreadInfo[];
    elapsedMs: number;
}

/** 전체 정지(전송 + 확인 + 재시도)의 결과. */
export interface StopAllOutcome {
    /** 정지가 확인됐는가(확인 불가 통과 포함 — 그 경우 `settle.unconfirmed` 가 true). */
    ok: boolean;
    /** 실제로 `Stop -all` 을 보낸 횟수. */
    attempts: number;
    /** 마지막 전송의 결과. */
    send: StopSendOutcome;
    /** 마지막 정지 확인의 결과(전송이 실패해 확인까지 가지 않았으면 undefined). */
    settle?: SettleOutcome;
    cancelled?: boolean;
    /** 실패 사유 — 호출부가 사용자 문구·`failedPhase` 로 옮겨 쓴다. */
    failure?: { command: string; statusCode?: number; message: string };
}

function describeActive(threads: ThreadInfo[]): string {
    return threads.map(t => `${t.name}(${t.state})`).join(', ');
}

/**
 * `Show Thread  -web` 으로 현재 쓰레드 목록을 읽는다. **읽기 전용**이라 모션에 영향이 없다.
 * 응답을 받지 못했거나 STATUS 가 잘렸으면 `null`(확인 불가) — 빈 목록과 구분해야 한다.
 */
export async function probeThreads(io: ThreadStopIo): Promise<ThreadProbe | null> {
    let resp: ThreadStopResponse | null;
    try {
        resp = await io.send(SHOW_THREAD_LIST_CMD);
    } catch {
        return null;
    }
    if (!resp || resp.statusComplete === false) { return null; }
    const threads = parseThreadList(resp.raw);
    return { threads, active: threads.filter(t => !isSettledState(t.state)), total: threads.length };
}

/**
 * 모든 쓰레드가 정지될 때까지 폴링한다.
 *
 * 활성 판정은 **상태 문자열**(Idle/Stopped/Error 가 아닌 것)로 한다 — 목록이 비는 것이 최종형이지만,
 * 정지 직후 잠깐 `Stopped` 항목이 남는 것까지 "안 멈췄다"로 보면 영영 통과하지 못한다.
 * 목록의 존재 자체를 활성으로 보는 더 엄격한 판정이 필요한 곳(autoOnSave 게이트)은 `probeThreads` 를
 * 직접 쓴다(`total > 0` 검사).
 */
export async function waitThreadsSettle(io: ThreadStopIo, opts?: ThreadStopOptions): Promise<SettleOutcome> {
    const o = resolveOptions(opts);
    const now = io.now ?? Date.now;
    const startedAt = now();
    const deadline = startedAt + o.settleTimeoutMs;
    let lastProbe: ThreadProbe | undefined;
    let lastActiveDesc = '';
    let lastLoggedDesc = '';
    let lastLoggedAt = 0;

    // 상한이 0 이어도 최소 한 번은 확인하고(0 = "지금 상태만 본다"), 상한 직전에도 한 번 더 본다 —
    // 남은 시간이 폴링 간격보다 짧으면 그만큼만 쉬고 마지막 관측을 한다(예산을 남기고 끝내지 않는다).
    for (;;) {
        if (io.isCancelled?.()) {
            return { settled: false, unconfirmed: false, cancelled: true, elapsedMs: now() - startedAt };
        }
        const probe = await probeThreads(io);
        if (probe === null) {
            io.log(`${o.logPrefix}⚠ Show Thread 무응답 — 정지 완료 확인 불가(계속 진행)`);
            return { settled: true, unconfirmed: true, elapsedMs: now() - startedAt };
        }
        lastProbe = probe;
        const elapsed = `${((now() - startedAt) / 1000).toFixed(1)}s`;
        if (probe.active.length === 0) {
            io.log(`${o.logPrefix}✔ 모든 쓰레드 정지 확인 (${elapsed}${probe.total > 0 ? `, 정지 상태 ${probe.total}개` : ''})`);
            return { settled: true, unconfirmed: false, threads: probe.threads, elapsedMs: now() - startedAt };
        }
        lastActiveDesc = describeActive(probe.active);
        // 폴링 주기대로 찍으면 같은 줄이 십수 번 반복된다 — 상태가 바뀌면 즉시, 같으면 2초에 한 번만.
        if (lastActiveDesc !== lastLoggedDesc || now() - lastLoggedAt >= 2000) {
            io.log(`${o.logPrefix}… 정지 대기 ${elapsed}: ${lastActiveDesc}`);
            lastLoggedDesc = lastActiveDesc;
            lastLoggedAt = now();
        }
        const remaining = deadline - now();
        if (remaining <= 0) { break; }
        await io.sleep(Math.min(o.pollIntervalMs, remaining));
    }

    return {
        settled: false,
        unconfirmed: false,
        activeDesc: lastActiveDesc,
        threads: lastProbe?.threads,
        elapsedMs: now() - startedAt,
    };
}

/**
 * `Stop -all` 을 한 번 보낸다(무응답이면 `resendOnNoResponse` 만큼 재전송).
 * **정지 완료를 판정하지 않는다** — 그건 `waitThreadsSettle` 의 몫이다.
 */
export async function sendStopAll(io: ThreadStopIo, opts?: ThreadStopOptions): Promise<StopSendOutcome> {
    const o = resolveOptions(opts);
    let resp: ThreadStopResponse | null = null;
    for (let attempt = 0; attempt <= o.resendOnNoResponse; attempt++) {
        if (attempt > 0) {
            io.log(`${o.logPrefix}⚠ ${STOP_ALL_CMD} 응답 없음 — 재전송합니다`);
        }
        io.log(`${o.logPrefix}CMD ${STOP_ALL_CMD}`);
        try {
            resp = await io.send(STOP_ALL_CMD);
        } catch {
            resp = null;
        }
        if (resp) { break; }
    }
    if (!resp) {
        io.log(`${o.logPrefix}✘ ${STOP_ALL_CMD} 실패 — 응답 없음(타임아웃 또는 연결 실패)`);
        return { kind: 'failed', command: STOP_ALL_CMD, message: 'No response (timeout or connection failure)' };
    }

    const status = parseStatus(resp.raw);
    if (status.code === 0) {
        io.log(`${o.logPrefix}✔ ${STOP_ALL_CMD} 접수 — 실제 정지는 확인 게이트에서 판정`);
        return { kind: 'accepted', statusCode: status.code };
    }
    if (isBusyStatus(status.code)) {
        io.log(`${o.logPrefix}⚠ STATUS ${status.code}: ${status.message} — 정지 진행 중(비치명, 하던 일을 마치면 정지). 정지 완료 게이트로 실제 상태를 확인합니다`);
        return { kind: 'stopping', statusCode: status.code, message: status.message };
    }
    // STATUS 자체가 없으면(잘린 응답) 성공으로 추정하지 않는다.
    const message = status.code === NO_STATUS_CODE
        ? 'STATUS 없음 — 정지 결과 미확인(응답이 잘렸을 수 있음)'
        : status.message || 'Unknown error';
    io.log(`${o.logPrefix}✘ ${STOP_ALL_CMD} 실패: STATUS ${status.code}: ${message}`);
    return { kind: 'failed', command: STOP_ALL_CMD, statusCode: status.code, message };
}

/**
 * **전체 정지의 정본** — `Stop -all` → 정지 완료 확인, 안 멈췄으면 자동 재시도.
 *
 * 성공(`ok: true`)은 "모든 쓰레드가 정지 상태로 관측됐다" 또는 "확인할 수 없었다(`settle.unconfirmed`)"
 * 둘 중 하나다. 후자를 정지로 단정하면 안 되는 호출부는 `settle.unconfirmed` 를 함께 본다.
 */
export async function stopAllAndSettle(io: ThreadStopIo, opts?: ThreadStopOptions): Promise<StopAllOutcome> {
    const o = resolveOptions(opts);
    let lastSend: StopSendOutcome = { kind: 'failed', command: STOP_ALL_CMD, message: '전송하지 않음' };
    let lastSettle: SettleOutcome | undefined;

    for (let attempt = 1; attempt <= o.maxStopAttempts; attempt++) {
        if (io.isCancelled?.()) {
            return { ok: false, attempts: attempt - 1, send: lastSend, settle: lastSettle, cancelled: true };
        }
        lastSend = await sendStopAll(io, opts);
        if (lastSend.kind === 'failed') {
            return {
                ok: false,
                attempts: attempt,
                send: lastSend,
                settle: lastSettle,
                failure: { command: lastSend.command, statusCode: lastSend.statusCode, message: lastSend.message },
            };
        }

        lastSettle = await waitThreadsSettle(io, opts);
        if (lastSettle.cancelled) {
            return { ok: false, attempts: attempt, send: lastSend, settle: lastSettle, cancelled: true };
        }
        if (lastSettle.settled) {
            return { ok: true, attempts: attempt, send: lastSend, settle: lastSettle };
        }
        if (attempt < o.maxStopAttempts) {
            io.log(`${o.logPrefix}↻ 정지 미확인(${lastSettle.activeDesc}) — ${STOP_ALL_CMD} 자동 재시도 (${attempt + 1}/${o.maxStopAttempts})`);
        }
    }

    const activeDesc = lastSettle?.activeDesc ?? '(확인 불가)';
    io.log(`${o.logPrefix}✘ ${STOP_ALL_CMD} 후에도 쓰레드가 정지되지 않음: ${activeDesc}`);
    return {
        ok: false,
        attempts: o.maxStopAttempts,
        send: lastSend,
        settle: lastSettle,
        failure: {
            command: 'Show Thread (stop settle gate)',
            message: `${STOP_ALL_CMD} 후에도 활성 쓰레드 존재: ${activeDesc}`,
        },
    };
}
