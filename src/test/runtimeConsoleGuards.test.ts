import * as assert from 'assert';
import { test } from './harness';
import {
    ConnectStats,
    decideWatchdogAction,
    SlidingWindowCounter,
    WatchdogInput,
    WATCHDOG_CONNECTING_GRACE_MS,
    WATCHDOG_TIMER_OVERDUE_MS,
} from '../controller/runtimeConsoleGuards';

// ── SlidingWindowCounter ─────────────────────────────────────────────────────

test('SlidingWindowCounter: 윈도우 안의 이벤트만 센다', () => {
    const c = new SlidingWindowCounter(60_000);
    const t0 = 1_000_000;
    c.record(t0);
    c.record(t0 + 10_000);
    c.record(t0 + 59_000);
    assert.strictEqual(c.count(t0 + 59_000), 3);
    // t0 이벤트는 정확히 60초가 지나면(cutoff 와 같으면) 윈도우에서 빠진다
    assert.strictEqual(c.count(t0 + 60_000), 2);
    assert.strictEqual(c.count(t0 + 70_000), 1);
    assert.strictEqual(c.count(t0 + 119_001), 0);
});

test('SlidingWindowCounter: record 시점에도 오래된 항목을 정리하고 reset 이 비운다', () => {
    const c = new SlidingWindowCounter(1_000);
    c.record(0);
    c.record(500);
    c.record(1_400); // cutoff=400 → 0 은 잘려 나가고 500 은 남는다
    assert.strictEqual(c.count(1_400), 2);
    c.reset();
    assert.strictEqual(c.count(1_400), 0);
});

test('SlidingWindowCounter: windowMs 가 0 이하면 RangeError', () => {
    assert.throws(() => new SlidingWindowCounter(0), RangeError);
    assert.throws(() => new SlidingWindowCounter(-5), RangeError);
});

// ── ConnectStats ─────────────────────────────────────────────────────────────

test('ConnectStats: 누적/이유별/분당 카운트', () => {
    const s = new ConnectStats(50);
    const t0 = 10_000_000;
    s.record('start', t0);
    s.record('batch', t0 + 1_000);
    s.record('batch', t0 + 2_000);
    s.record('immediate-eof', t0 + 3_000);
    assert.strictEqual(s.perMinute(t0 + 3_000), 4);
    // 시계는 단조 증가를 가정한다(prune 은 파괴적) — 조회는 시간 순서대로만.
    s.record('error', t0 + 70_000);
    assert.strictEqual(s.total, 5);
    assert.strictEqual(s.count('batch'), 2);
    assert.strictEqual(s.count('immediate-eof'), 1);
    assert.strictEqual(s.count('watchdog'), 0);
    // t0+70s 기준 60초 윈도우(cutoff=t0+10s): t0~t0+3s 는 모두 제외, error 만 남는다
    assert.strictEqual(s.perMinute(t0 + 70_000), 1);
});

test('ConnectStats: summaryEvery 배수에 도달한 직후에만 shouldEmitSummary', () => {
    const s = new ConnectStats(3);
    assert.strictEqual(s.shouldEmitSummary(), false);
    s.record('batch', 0);
    s.record('batch', 0);
    assert.strictEqual(s.shouldEmitSummary(), false);
    s.record('batch', 0);
    assert.strictEqual(s.shouldEmitSummary(), true);
    s.record('batch', 0);
    assert.strictEqual(s.shouldEmitSummary(), false);
    for (let i = 0; i < 2; i++) { s.record('error', 0); }
    assert.strictEqual(s.total, 6);
    assert.strictEqual(s.shouldEmitSummary(), true);
});

test('ConnectStats: summaryEvery 가 1 미만이면 요약을 내지 않는다', () => {
    const s = new ConnectStats(0);
    s.record('batch', 0);
    assert.strictEqual(s.shouldEmitSummary(), false);
});

test('ConnectStats: formatSummary 는 0인 이유를 생략하고 고정 순서로 나열한다', () => {
    const s = new ConnectStats();
    const t0 = 5_000_000;
    s.record('watchdog', t0);
    s.record('batch', t0 + 100);
    s.record('batch', t0 + 200);
    s.record('immediate-eof', t0 + 300);
    s.record('error', t0 + 400);
    assert.strictEqual(
        s.formatSummary(t0 + 400),
        '1403 connects: 5 total, 5/min (batch=2, immediateEof=1, error=1, watchdog=1)',
    );
});

test('ConnectStats: 기록이 없으면 요약에 괄호 없이 0 total', () => {
    const s = new ConnectStats();
    assert.strictEqual(s.formatSummary(0), '1403 connects: 0 total, 0/min');
});

// ── decideWatchdogAction ─────────────────────────────────────────────────────

const CONNECT_TIMEOUT_MS = 5_000;

function base(overrides: Partial<WatchdogInput> = {}): WatchdogInput {
    return {
        now: 1_000_000,
        active: true,
        connected: false,
        hasSocket: false,
        connectAttemptAt: 0,
        connectTimeoutMs: CONNECT_TIMEOUT_MS,
        hasReconnectTimer: false,
        reconnectDueAt: 0,
        reconnectStopped: false,
        ...overrides,
    };
}

test('watchdog: 비활성(stop/dispose 후)이면 어떤 상태든 none', () => {
    assert.strictEqual(decideWatchdogAction(base({ active: false })).action, 'none');
    assert.strictEqual(
        decideWatchdogAction(base({ active: false, hasSocket: true, connectAttemptAt: 1 })).action,
        'none',
    );
});

test('watchdog: 연결 중(connected)이면 none — 서버가 세션을 유지하는 정상 idle 포함', () => {
    const d = decideWatchdogAction(base({ connected: true, hasSocket: true, connectAttemptAt: 1 }));
    assert.strictEqual(d.action, 'none');
    assert.strictEqual(d.detail, 'connected');
});

test('watchdog: connecting 이 (connect timeout + grace) 이내면 none, 넘으면 destroy-stuck-connecting', () => {
    const now = 1_000_000;
    const limit = CONNECT_TIMEOUT_MS + WATCHDOG_CONNECTING_GRACE_MS;
    const within = decideWatchdogAction(base({ now, hasSocket: true, connectAttemptAt: now - limit }));
    assert.strictEqual(within.action, 'none');
    assert.strictEqual(within.detail, 'connecting');
    const stuck = decideWatchdogAction(base({ now, hasSocket: true, connectAttemptAt: now - limit - 1 }));
    assert.strictEqual(stuck.action, 'destroy-stuck-connecting');
    assert.ok(stuck.detail.includes(`${limit}ms`));
});

test('watchdog: connecting 인데 시도 시각 기록이 없으면(0) 판단을 보류한다', () => {
    const d = decideWatchdogAction(base({ hasSocket: true, connectAttemptAt: 0 }));
    assert.strictEqual(d.action, 'none');
});

test('watchdog: 재연결 타이머가 예정 시각 이내/살짝 지남이면 none, 10초 넘게 지나면 fire-overdue-timer', () => {
    const now = 2_000_000;
    const notYet = decideWatchdogAction(base({ now, hasReconnectTimer: true, reconnectDueAt: now + 5_000 }));
    assert.strictEqual(notYet.action, 'none');
    const slightlyLate = decideWatchdogAction(base({
        now, hasReconnectTimer: true, reconnectDueAt: now - WATCHDOG_TIMER_OVERDUE_MS,
    }));
    assert.strictEqual(slightlyLate.action, 'none');
    const overdue = decideWatchdogAction(base({
        now, hasReconnectTimer: true, reconnectDueAt: now - WATCHDOG_TIMER_OVERDUE_MS - 1,
    }));
    assert.strictEqual(overdue.action, 'fire-overdue-timer');
});

test('watchdog: 타이머는 있는데 예정 시각 기록이 없으면(0) none', () => {
    const d = decideWatchdogAction(base({ hasReconnectTimer: true, reconnectDueAt: 0 }));
    assert.strictEqual(d.action, 'none');
    assert.strictEqual(d.detail, 'reconnect scheduled');
});

test('watchdog: 소켓·타이머 모두 없고 RECONNECT_STOPPED 면 skip-reconnect-stopped (개입 금지)', () => {
    const d = decideWatchdogAction(base({ reconnectStopped: true }));
    assert.strictEqual(d.action, 'skip-reconnect-stopped');
});

test('watchdog: 소켓·타이머 모두 없는 멈춤 상태면 force-reconnect (2026-08-25 17:45 침묵 시나리오)', () => {
    const d = decideWatchdogAction(base());
    assert.strictEqual(d.action, 'force-reconnect');
    assert.strictEqual(d.detail, 'no socket, no reconnect timer');
});

test('watchdog: RECONNECT_STOPPED 이어도 소켓/타이머가 있으면 그 판정이 우선한다', () => {
    // 사용자가 start() 로 재개하는 순간 reconnectStopped 는 해제되지만, 혹시 순서가 어긋나도
    // 타이머/소켓이 살아 있으면 개입하지 않아야 한다.
    const d = decideWatchdogAction(base({ reconnectStopped: true, hasReconnectTimer: true, reconnectDueAt: 1_000_000 + 1 }));
    assert.strictEqual(d.action, 'none');
});
