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
    ProberTimers,
} from '../controller/connectionHealth';

// ── 픽스처 ─────────────────────────────────────────────────────────────────

const POLICY: ConnectionHealthPolicy = { ...DEFAULT_CONNECTION_HEALTH_POLICY };

const TIMEOUT: ProbeOutcome = { ok: false, kind: 'timeout', detail: 'Command timeout (8000ms): Show Thread -web' };
const REFUSED: ProbeOutcome = { ok: false, kind: 'refused', detail: 'connect ECONNREFUSED 192.168.0.1:1402' };
const UNREACHABLE: ProbeOutcome = { ok: false, kind: 'unreachable', detail: 'connect EHOSTUNREACH 192.168.0.1:1402' };
const OK: ProbeOutcome = { ok: true, raw: '<DATA>\r\n</DATA>\r\n<STATUS>0</STATUS>' };

function makeMonitor(policy: ConnectionHealthPolicy = POLICY) {
    const events: string[] = [];
    const state = { lost: undefined as LossSummary | undefined, recovered: undefined as RecoveryInfo | undefined, now: 1_000_000 };
    const monitor = new ConnectionHealthMonitor(() => policy, {
        onSuspect: reason => events.push(`suspect:${reason}`),
        onRecovered: info => { state.recovered = info; events.push(`recovered:${info.failuresBeforeRecovery}`); },
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

// ── ConnectionHealthProber ────────────────────────────────────────────────

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
