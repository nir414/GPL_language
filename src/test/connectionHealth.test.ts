import * as assert from 'assert';
import { test } from './harness';
import {
    ConnectionHealthMonitor,
    ConnectionHealthProber,
    DEFAULT_CONNECTION_HEALTH_POLICY,
    classifyCommandFailure,
    probeOutcomeFromResponse,
    describeLoss,
    ConnectionHealthPolicy,
    ProbeOutcome,
    LossSummary,
    RecoveryInfo,
    RecoveringInfo,
    ProberTimers,
    describeRecovering,
    describeDisruptiveOperation,
} from '../controller/connectionHealth';

// ── 픽스처 ─────────────────────────────────────────────────────────────────

const POLICY: ConnectionHealthPolicy = { ...DEFAULT_CONNECTION_HEALTH_POLICY };

const TIMEOUT: ProbeOutcome = { ok: false, kind: 'timeout', detail: 'Command timeout (8000ms): Show Thread -web' };
const REFUSED: ProbeOutcome = { ok: false, kind: 'refused', detail: 'connect ECONNREFUSED 192.168.0.1:1402' };
const UNREACHABLE: ProbeOutcome = { ok: false, kind: 'unreachable', detail: 'connect EHOSTUNREACH 192.168.0.1:1402' };
const OK: ProbeOutcome = { ok: true, raw: '<DATA>\r\n</DATA>\r\n<STATUS>0</STATUS>' };

function makeMonitor(policy: ConnectionHealthPolicy = POLICY) {
    const events: string[] = [];
    const state = {
        lost: undefined as LossSummary | undefined,
        recovered: undefined as RecoveryInfo | undefined,
        recovering: undefined as RecoveringInfo | undefined,
        now: 1_000_000,
    };
    const monitor = new ConnectionHealthMonitor(() => policy, {
        onSuspect: reason => events.push(`suspect:${reason}`),
        onRecovering: info => { state.recovering = info; events.push(`recovering:${info.operation.command}`); },
        onRecovered: info => { state.recovered = info; events.push(`recovered:${info.fromState}:${info.failuresBeforeRecovery}`); },
        onLost: summary => { state.lost = summary; events.push(`lost:${summary.trigger}`); },
    }, () => state.now);
    return { monitor, events, state, advance: (ms: number) => { state.now += ms; } };
}

/** setTimeout 을 손으로 발화시키는 가짜 타이머. */
class FakeTimers implements ProberTimers {
    private seq = 0;
    readonly pending: Array<{ id: number; fn: () => void; ms: number }> = [];
    setTimeout(fn: () => void, ms: number): unknown {
        const id = ++this.seq;
        this.pending.push({ id, fn, ms });
        return id;
    }
    clearTimeout(handle: unknown): void {
        const idx = this.pending.findIndex(p => p.id === handle);
        if (idx >= 0) { this.pending.splice(idx, 1); }
    }
    /** 가장 먼저 등록된 타이머 1개를 발화. */
    fireNext(): void {
        const next = this.pending.shift();
        if (!next) { throw new Error('no pending timer'); }
        next.fn();
    }
}

/** await 체인이 끝나도록 매크로태스크 몇 틱을 흘린다. */
async function settle(): Promise<void> {
    for (let i = 0; i < 4; i++) {
        await new Promise<void>(resolve => setImmediate(resolve));
    }
}

// ── classifyCommandFailure ────────────────────────────────────────────────

test('classifyCommandFailure: code 우선 — ECONNREFUSED/EHOSTUNREACH/ECONNRESET/COMMAND_TIMEOUT/ECONNCLOSED', () => {
    const coded = (message: string, code: string) => Object.assign(new Error(message), { code });
    assert.strictEqual(classifyCommandFailure(coded('Connection error (192.168.0.1:1402): connect ECONNREFUSED', 'ECONNREFUSED')).kind, 'refused');
    assert.strictEqual(classifyCommandFailure(coded('x', 'EHOSTUNREACH')).kind, 'unreachable');
    assert.strictEqual(classifyCommandFailure(coded('x', 'ENETUNREACH')).kind, 'unreachable');
    assert.strictEqual(classifyCommandFailure(coded('x', 'ECONNRESET')).kind, 'reset');
    assert.strictEqual(classifyCommandFailure(coded('Command timeout (8000ms): Show Thread -web', 'COMMAND_TIMEOUT')).kind, 'timeout');
    assert.strictEqual(classifyCommandFailure(coded('x', 'ETIMEDOUT')).kind, 'timeout');
    assert.strictEqual(classifyCommandFailure(coded('Connection closed without response: Show Thread -web', 'ECONNCLOSED')).kind, 'closed');
});

test('classifyCommandFailure: code 없으면 메시지의 errno 토큰/문구로 판정, 그 외 other', () => {
    assert.strictEqual(classifyCommandFailure(new Error('Connection error (192.168.0.1:1402): connect ECONNREFUSED 192.168.0.1:1402')).kind, 'refused');
    assert.strictEqual(classifyCommandFailure(new Error('connect EHOSTUNREACH 192.168.0.1:1402')).kind, 'unreachable');
    assert.strictEqual(classifyCommandFailure(new Error('Command timeout (8000ms): Show Thread -web')).kind, 'timeout');
    assert.strictEqual(classifyCommandFailure(new Error('Connection closed without response: Show Thread -web')).kind, 'closed');
    assert.strictEqual(classifyCommandFailure(new Error('something odd')).kind, 'other');
    const nonError = classifyCommandFailure('boom');
    assert.strictEqual(nonError.kind, 'other');
    assert.strictEqual(nonError.detail, 'boom');
    assert.strictEqual(classifyCommandFailure(undefined).detail, 'unknown error');
});

// ── probeOutcomeFromResponse ──────────────────────────────────────────────

test('probeOutcomeFromResponse: <STATUS> 가 있으면 성공(코드가 0 이 아니어도), 없으면 incomplete', () => {
    assert.deepStrictEqual(probeOutcomeFromResponse('<DATA></DATA><STATUS>0</STATUS>'), { ok: true, raw: '<DATA></DATA><STATUS>0</STATUS>' });
    assert.strictEqual(probeOutcomeFromResponse('<STATUS>-1006, "Invalid thread"</STATUS>').ok, true);
    const empty = probeOutcomeFromResponse('');
    assert.strictEqual(empty.ok, false);
    assert.strictEqual(!empty.ok && empty.kind, 'incomplete');
    const http = probeOutcomeFromResponse('HTTP/1.1 400 Bad Request\r\n\r\n');
    assert.strictEqual(http.ok, false);
    assert.ok(!http.ok && /bytes/.test(http.detail));
});

// ── ConnectionHealthMonitor ───────────────────────────────────────────────

test('monitor: disconnected 상태에서는 프로브·힌트를 모두 무시한다', () => {
    const { monitor, events } = makeMonitor();
    assert.strictEqual(monitor.state, 'disconnected');
    assert.strictEqual(monitor.reportProbe(TIMEOUT), 'ignored');
    assert.strictEqual(monitor.reportProbe(OK), 'ignored');
    assert.strictEqual(monitor.reportHint('runtime-console', 'connect-failed'), 'ignored');
    assert.deepStrictEqual(events, []);
});

test('monitor: 타임아웃 3회 연속이면 유실 — 첫 실패에 onSuspect 1회, 3회째에 onLost(failure-threshold) 후 disconnected', () => {
    const { monitor, events, state, advance } = makeMonitor();
    monitor.setConnected(true);
    assert.strictEqual(monitor.reportProbe(TIMEOUT), 'suspect');
    assert.strictEqual(monitor.state, 'suspect');
    advance(9000);
    assert.strictEqual(monitor.reportProbe(TIMEOUT), 'suspect');
    advance(9000);
    assert.strictEqual(monitor.reportProbe(TIMEOUT), 'lost');
    assert.strictEqual(monitor.state, 'disconnected');
    assert.deepStrictEqual(events, ['suspect:probe: timeout — Command timeout (8000ms): Show Thread -web', 'lost:failure-threshold']);
    assert.ok(state.lost);
    assert.strictEqual(state.lost!.failures, 3);
    assert.strictEqual(state.lost!.definitiveFailures, 0);
    assert.strictEqual(state.lost!.durationMs, 18_000);
    assert.strictEqual(state.lost!.lastFailure.kind, 'timeout');
    // 유실 뒤 카운터는 비워진다
    assert.strictEqual(monitor.snapshot().consecutiveFailures, 0);
    assert.strictEqual(monitor.snapshot().suspectSince, undefined);
});

test('monitor: 연결 거부/도달 불가(확정적)는 2회면 유실(definitive-threshold)', () => {
    const { monitor, events, state } = makeMonitor();
    monitor.setConnected(true);
    assert.strictEqual(monitor.reportProbe(REFUSED), 'suspect');
    assert.strictEqual(monitor.reportProbe(UNREACHABLE), 'lost');
    assert.deepStrictEqual(events.map(e => e.split(':')[0]), ['suspect', 'lost']);
    assert.strictEqual(state.lost!.trigger, 'definitive-threshold');
    assert.strictEqual(state.lost!.definitiveFailures, 2);
});

test('monitor: 타임아웃이 끼면 확정적 연속 카운터는 끊기고 일반 임계(3)로만 유실된다', () => {
    const { monitor, state } = makeMonitor();
    monitor.setConnected(true);
    assert.strictEqual(monitor.reportProbe(REFUSED), 'suspect');
    assert.strictEqual(monitor.reportProbe(TIMEOUT), 'suspect');
    assert.strictEqual(monitor.snapshot().consecutiveDefinitiveFailures, 0);
    assert.strictEqual(monitor.reportProbe(REFUSED), 'lost');
    assert.strictEqual(state.lost!.trigger, 'failure-threshold');
    assert.strictEqual(state.lost!.failures, 3);
    assert.strictEqual(state.lost!.definitiveFailures, 1);
});

test('monitor: suspect 중 프로브 성공이면 connected 복구 + onRecovered, 카운터 초기화', () => {
    const { monitor, events, state, advance } = makeMonitor();
    monitor.setConnected(true);
    monitor.reportProbe(TIMEOUT);
    advance(1500);
    monitor.reportProbe(TIMEOUT);
    advance(1500);
    assert.strictEqual(monitor.reportProbe(OK), 'connected');
    assert.strictEqual(monitor.state, 'connected');
    assert.deepStrictEqual(events.map(e => e.split(':')[0]), ['suspect', 'recovered']);
    assert.strictEqual(state.recovered!.fromState, 'suspect');
    assert.strictEqual(state.recovered!.failuresBeforeRecovery, 2);
    assert.strictEqual(state.recovered!.durationMs, 3000);
    const snap = monitor.snapshot();
    assert.strictEqual(snap.consecutiveFailures, 0);
    assert.strictEqual(snap.lastProbeOkAt, state.now);
    // 복구 뒤 다시 3회 실패해야 유실 — 이전 실패는 이어지지 않는다
    assert.strictEqual(monitor.reportProbe(TIMEOUT), 'suspect');
    assert.strictEqual(monitor.reportProbe(TIMEOUT), 'suspect');
    assert.strictEqual(monitor.reportProbe(TIMEOUT), 'lost');
});

test('monitor: connected 에서 프로브 성공은 무해(카운터 0 유지, 훅 없음)', () => {
    const { monitor, events } = makeMonitor();
    monitor.setConnected(true);
    assert.strictEqual(monitor.reportProbe(OK), 'connected');
    assert.strictEqual(monitor.reportProbe(OK), 'connected');
    assert.deepStrictEqual(events, []);
});

test('monitor: 힌트는 connected → suspect 만 옮기고(onSuspect), suspect 중 힌트는 무시, 판정은 프로브가 한다', () => {
    const { monitor, events } = makeMonitor();
    monitor.setConnected(true);
    assert.strictEqual(monitor.reportHint('runtime-console', 'connect-failed ECONNREFUSED'), 'suspect');
    assert.strictEqual(monitor.state, 'suspect');
    assert.strictEqual(monitor.reportHint('keep-alive-socket', 'read ECONNRESET'), 'ignored');
    assert.deepStrictEqual(events, ['suspect:runtime-console: connect-failed ECONNREFUSED']);
    // 힌트만으로는 유실되지 않는다 — 프로브 실패가 임계에 닿아야 한다
    assert.strictEqual(monitor.reportProbe(TIMEOUT), 'suspect');
    assert.strictEqual(monitor.reportProbe(TIMEOUT), 'suspect');
    assert.strictEqual(monitor.reportProbe(TIMEOUT), 'lost');
    assert.strictEqual(events.filter(e => e.startsWith('suspect')).length, 1);
});

test('monitor: 힌트 → 프로브 성공이면 복구, 복구 직후 hintCooldownMs 안의 힌트는 무시, 지나면 다시 suspect', () => {
    const { monitor, events, advance } = makeMonitor();
    monitor.setConnected(true);
    monitor.reportHint('dashboard', '제어기 응답 없음');
    assert.strictEqual(monitor.reportProbe(OK), 'connected');
    assert.deepStrictEqual(events.map(e => e.split(':')[0]), ['suspect', 'recovered']);
    advance(POLICY.hintCooldownMs - 1);
    assert.strictEqual(monitor.reportHint('runtime-console', 'connect-failed'), 'ignored');
    advance(2);
    assert.strictEqual(monitor.reportHint('runtime-console', 'connect-failed'), 'suspect');
});

test('monitor: setConnected(false)(명시적 해제)는 suspect 를 끊고 이후 보고를 무시한다; setConnected(true)는 쿨다운을 지운다', () => {
    const { monitor, events } = makeMonitor();
    monitor.setConnected(true);
    monitor.reportProbe(TIMEOUT);
    monitor.setConnected(false);
    assert.strictEqual(monitor.state, 'disconnected');
    assert.strictEqual(monitor.reportProbe(TIMEOUT), 'ignored');
    assert.strictEqual(monitor.snapshot().lastFailure, undefined);
    // 재연결 직후 힌트는 (복구 쿨다운이 아니므로) 즉시 suspect
    monitor.setConnected(true);
    assert.strictEqual(monitor.reportHint('runtime-console', 'x'), 'suspect');
    assert.strictEqual(events.filter(e => e.startsWith('suspect')).length, 2);
});

test('describeLoss: 횟수·임계 종류·마지막 실패·의심 경과를 한 줄로', () => {
    const { monitor, state, advance } = makeMonitor();
    monitor.setConnected(true);
    monitor.reportProbe(REFUSED);
    advance(1200);
    monitor.reportProbe(REFUSED);
    const line = describeLoss(state.lost!);
    assert.ok(/2회 연속 실패\(확정적 2회, 연결 거부\/도달 불가 확정\)/.test(line), line);
    assert.ok(/마지막 refused — connect ECONNREFUSED/.test(line), line);
    assert.ok(/의심 1\.2 s/.test(line), line);
});


// -- recovering (채널 교란 뒤 복구 대기, 2026-08-31) -----------------------

const UNLOAD_TIMEOUT = { command: 'Unload GPL_Code', kind: 'timeout' as const, detail: 'Command timeout (15000ms): Unload GPL_Code' };

test('monitor: 채널 교란 명령 타임아웃 → recovering, 그 뒤 거부 2회로는 유실되지 않는다 (2026-08-31 실측 재현)', () => {
    const { monitor, events, state, advance } = makeMonitor();
    monitor.setConnected(true);
    assert.strictEqual(monitor.noteDisruptiveTimeout(UNLOAD_TIMEOUT), 'recovering');
    assert.strictEqual(monitor.state, 'recovering');

    // 실측 타임라인: 타임아웃 뒤 2 s·6 s·12 s·46 s 에 ECONNREFUSED — 종전에는 두 번째에 definitive-threshold 유실.
    for (const gap of [2000, 4000, 6000, 34_000]) {
        advance(gap);
        assert.strictEqual(monitor.reportProbe(REFUSED), 'recovering');
    }
    assert.strictEqual(monitor.state, 'recovering');
    assert.strictEqual(state.lost, undefined, '유실이 확정되어서는 안 된다');
    assert.strictEqual(monitor.snapshot().recoveryProbeFailures, 4);
    assert.strictEqual(monitor.snapshot().consecutiveDefinitiveFailures, 0, '거부를 definitive 카운터에 넣지 않는다');
    assert.deepStrictEqual(events, ['recovering:Unload GPL_Code']);
});

test('monitor: recovering 중 프로브 성공 → connected 복구, fromState=recovering + 근거 명령 유지', () => {
    const { monitor, events, state, advance } = makeMonitor();
    monitor.setConnected(true);
    monitor.noteDisruptiveTimeout(UNLOAD_TIMEOUT);
    advance(3000);
    monitor.reportProbe(REFUSED);
    advance(169_000);   // 실측 복구 172 s
    assert.strictEqual(monitor.reportProbe(OK), 'connected');
    assert.strictEqual(monitor.state, 'connected');
    assert.strictEqual(state.recovered!.fromState, 'recovering');
    assert.strictEqual(state.recovered!.durationMs, 172_000);
    assert.strictEqual(state.recovered!.failuresBeforeRecovery, 1);
    assert.strictEqual(state.recovered!.disruptiveOperation?.command, 'Unload GPL_Code');
    assert.deepStrictEqual(events, ['recovering:Unload GPL_Code', 'recovered:recovering:1']);
    assert.strictEqual(monitor.snapshot().recoveringSince, undefined);
});

test('monitor: recoveryWindowMs 초과 → suspect 로 강등하고 그 뒤 일반 임계로 유실 (진짜 다운도 결국 감지)', () => {
    const { monitor, events, state, advance } = makeMonitor();
    monitor.setConnected(true);
    monitor.noteDisruptiveTimeout(UNLOAD_TIMEOUT);
    advance(POLICY.recoveryWindowMs - 1);
    assert.strictEqual(monitor.reportProbe(REFUSED), 'recovering');
    advance(2);   // 창을 넘김
    // 강등되는 이 프로브가 새 카운터의 1회째 — 확정적 실패 1회이므로 아직 유실 아님.
    assert.strictEqual(monitor.reportProbe(REFUSED), 'suspect');
    assert.strictEqual(monitor.state, 'suspect');
    assert.ok(monitor.snapshot().suspectReason!.startsWith('recovery-window-expired: Unload GPL_Code(timeout) 뒤 '), monitor.snapshot().suspectReason);
    assert.strictEqual(monitor.snapshot().consecutiveDefinitiveFailures, 1);
    // 강등 뒤에는 종전 규칙대로 거부 2회면 유실.
    advance(1000);
    assert.strictEqual(monitor.reportProbe(REFUSED), 'lost');
    assert.strictEqual(state.lost!.trigger, 'definitive-threshold');
    assert.deepStrictEqual(events.map(e => e.split(':')[0]), ['recovering', 'suspect', 'lost']);
});

test('monitor: suspect 중 교란 명령 타임아웃이 오면 recovering 으로 올라가고 종전 카운터는 폐기된다', () => {
    const { monitor, state } = makeMonitor();
    monitor.setConnected(true);
    monitor.reportProbe(REFUSED);   // definitive 1회
    assert.strictEqual(monitor.state, 'suspect');
    assert.strictEqual(monitor.noteDisruptiveTimeout(UNLOAD_TIMEOUT), 'recovering');
    assert.strictEqual(state.recovering!.fromState, 'suspect');
    assert.strictEqual(monitor.snapshot().consecutiveDefinitiveFailures, 0);
    // 종전이라면 이 거부가 2회째로 유실이었을 것.
    assert.strictEqual(monitor.reportProbe(REFUSED), 'recovering');
    assert.strictEqual(state.lost, undefined);
});

test('monitor: disconnected 에서의 교란 통지는 무시한다(끊긴 뒤 잔향)', () => {
    const { monitor, events } = makeMonitor();
    assert.strictEqual(monitor.noteDisruptiveTimeout(UNLOAD_TIMEOUT), 'ignored');
    assert.strictEqual(monitor.state, 'disconnected');
    assert.deepStrictEqual(events, []);
});

test('monitor: setConnected 는 recovering 근거 명령까지 지운다', () => {
    const { monitor } = makeMonitor();
    monitor.setConnected(true);
    monitor.noteDisruptiveTimeout(UNLOAD_TIMEOUT);
    monitor.setConnected(false);
    assert.strictEqual(monitor.state, 'disconnected');
    assert.strictEqual(monitor.snapshot().disruptiveOperation, undefined);
    assert.strictEqual(monitor.snapshot().recoveryProbeFailures, 0);
});

test('describeRecovering / describeDisruptiveOperation: 관측만 적고 인과를 단정하지 않는다', () => {
    const line = describeRecovering({ operation: { ...UNLOAD_TIMEOUT, at: 0 }, windowMs: 180_000, fromState: 'connected' });
    assert.ok(line.includes('Unload GPL_Code 가 응답 없이 끝남(timeout'), line);
    assert.ok(line.includes('실제 결과는 미확정'), line);
    assert.ok(line.includes('최대 180 s'), line);
    // "제어기가 죽었다"/"이 명령이 채널을 닫았다" 같은 확정 서술이 없어야 한다.
    assert.ok(!/다운|죽|재투입|일으켰/.test(line), line);
    assert.strictEqual(describeDisruptiveOperation({ ...UNLOAD_TIMEOUT, at: 0 }), 'Unload GPL_Code(timeout)');
    assert.strictEqual(describeDisruptiveOperation(undefined), '(명령 미확인)');
});

test('prober: recovering 동안은 recoveryProbeDelayMs 간격으로 프로브한다(거부 포트에 connect 를 쌓지 않음)', async () => {
    const { monitor, prober, timers, calls } = makeProber([REFUSED, OK]);
    monitor.setConnected(true);
    monitor.noteDisruptiveTimeout(UNLOAD_TIMEOUT);
    prober.start();
    assert.strictEqual(timers.pending[0].ms, POLICY.recoveryProbeDelayMs);
    timers.fireNext();
    await settle();
    assert.strictEqual(monitor.state, 'recovering');
    assert.strictEqual(timers.pending[0].ms, POLICY.recoveryProbeDelayMs);
    timers.fireNext();
    await settle();
    assert.strictEqual(monitor.state, 'connected');
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(prober.active, false);
});

// -- ConnectionHealthProber ------------------------------------------------

function makeProber(outcomes: Array<ProbeOutcome | Error>, policy: ConnectionHealthPolicy = POLICY) {
    const timers = new FakeTimers();
    const calls: number[] = [];
    let idx = 0;
    const m = makeMonitor(policy);
    const probe = async (timeoutMs: number): Promise<ProbeOutcome> => {
        calls.push(timeoutMs);
        const next = outcomes[Math.min(idx++, outcomes.length - 1)];
        if (next instanceof Error) { throw next; }
        return next;
    };
    const prober = new ConnectionHealthProber(m.monitor, probe, timers);
    return { ...m, timers, calls, prober };
}

test('prober: suspect 진입 후 reprobeDelayMs 간격으로 프로브 → 임계 도달 시 유실, 루프 종료', async () => {
    const { monitor, prober, timers, calls, events } = makeProber([TIMEOUT, TIMEOUT]);
    monitor.setConnected(true);
    // 트리 폴이 첫 실패를 보고 → onSuspect → (extension.ts 가 하는 대로) prober.start()
    monitor.reportProbe(TIMEOUT);
    prober.start();
    assert.strictEqual(prober.active, true);
    assert.strictEqual(timers.pending.length, 1);
    assert.strictEqual(timers.pending[0].ms, POLICY.reprobeDelayMs);

    timers.fireNext();
    await settle();
    assert.deepStrictEqual(calls, [POLICY.probeTimeoutMs]);
    assert.strictEqual(monitor.state, 'suspect');
    assert.strictEqual(timers.pending.length, 1, '실패 뒤 재프로브가 다시 예약된다');

    timers.fireNext();
    await settle();
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(monitor.state, 'disconnected');
    assert.deepStrictEqual(events.map(e => e.split(':')[0]), ['suspect', 'lost']);
    assert.strictEqual(prober.active, false);
    assert.strictEqual(timers.pending.length, 0, '유실 뒤에는 재프로브를 예약하지 않는다(자동 재접속 없음)');
});

test('prober: 재프로브 성공이면 복구하고 루프를 멈춘다', async () => {
    const { monitor, prober, timers, calls, events } = makeProber([OK]);
    monitor.setConnected(true);
    monitor.reportHint('runtime-console', 'socket-error ECONNRESET');
    prober.start();
    timers.fireNext();
    await settle();
    assert.deepStrictEqual(calls, [POLICY.probeTimeoutMs]);
    assert.strictEqual(monitor.state, 'connected');
    assert.deepStrictEqual(events.map(e => e.split(':')[0]), ['suspect', 'recovered']);
    assert.strictEqual(prober.active, false);
    assert.strictEqual(timers.pending.length, 0);
});

test('prober: start 는 멱등(진행 중 재호출 시 타이머 중복 없음), stop 은 예약을 취소하고 늦은 결과를 버린다', async () => {
    let resolveProbe: ((o: ProbeOutcome) => void) | undefined;
    const timers = new FakeTimers();
    const m = makeMonitor();
    const prober = new ConnectionHealthProber(m.monitor, () => new Promise<ProbeOutcome>(r => { resolveProbe = r; }), timers);
    m.monitor.setConnected(true);
    m.monitor.reportProbe(TIMEOUT);
    prober.start();
    prober.start();
    assert.strictEqual(timers.pending.length, 1);

    timers.fireNext();
    await settle();
    assert.ok(resolveProbe, '프로브가 진행 중');
    prober.stop();
    assert.strictEqual(prober.active, false);
    resolveProbe!(TIMEOUT);
    await settle();
    // stop 뒤 도착한 결과는 보고되지 않는다 — 실패 카운터는 1 그대로
    assert.strictEqual(m.monitor.snapshot().consecutiveFailures, 1);
    assert.strictEqual(m.monitor.state, 'suspect');
    assert.strictEqual(timers.pending.length, 0);
});

test('prober: 프로브 함수가 예외를 내면 실패로 분류한다(ECONNREFUSED 2회 → 확정 유실)', async () => {
    const refusedErr = Object.assign(new Error('connect ECONNREFUSED 192.168.0.1:1402'), { code: 'ECONNREFUSED' });
    const { monitor, prober, timers, state } = makeProber([refusedErr, refusedErr]);
    monitor.setConnected(true);
    monitor.reportHint('keep-alive-socket', 'read ECONNRESET (ECONNRESET)');
    prober.start();
    timers.fireNext();
    await settle();
    assert.strictEqual(monitor.state, 'suspect');
    timers.fireNext();
    await settle();
    assert.strictEqual(monitor.state, 'disconnected');
    assert.strictEqual(state.lost!.trigger, 'definitive-threshold');
    assert.strictEqual(state.lost!.lastFailure.kind, 'refused');
});

test('prober: 타이머 발화 시점에 이미 suspect 가 아니면(트리 폴이 먼저 복구) 프로브를 보내지 않는다', async () => {
    const { monitor, prober, timers, calls } = makeProber([TIMEOUT]);
    monitor.setConnected(true);
    monitor.reportProbe(TIMEOUT);
    prober.start();
    // 트리 폴이 먼저 성공 보고
    monitor.reportProbe(OK);
    timers.fireNext();
    await settle();
    assert.deepStrictEqual(calls, []);
    assert.strictEqual(prober.active, false);
});
