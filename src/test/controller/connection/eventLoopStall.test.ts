import * as assert from 'assert';
import { test } from '../../harness';
import {
    EventLoopStallMonitor,
    describeStall,
    stallOverlapMs,
    stallsWithin,
    type EventLoopStall,
    type StallTimers,
} from '../../../controller/connection/eventLoopStall';

function fakeTimers(): StallTimers & { active: number } {
    const t = {
        active: 0,
        setInterval: () => { t.active++; return t.active; },
        clearInterval: () => { t.active--; },
    };
    return t;
}

test('EventLoopStallMonitor: 예정보다 thresholdMs 이상 늦은 틱만 정지로 기록한다', () => {
    let now = 10_000;
    const seen: EventLoopStall[] = [];
    const m = new EventLoopStallMonitor({ tickMs: 500, thresholdMs: 2000, now: () => now, timers: fakeTimers(), onStall: s => seen.push(s) });
    m.start();
    assert.strictEqual(m.tick(10_500), undefined, '정시');
    assert.strictEqual(m.tick(12_900), undefined, '1.9 s 늦음 — 임계 미만');
    // 2026-10-26 17:48 재현: 71 s 동안 틱이 돌지 않음
    const stall = m.tick(12_900 + 500 + 71_000);
    assert.deepStrictEqual(stall, { startedAt: 13_400, endedAt: 84_400, durationMs: 71_000 });
    assert.deepStrictEqual(seen, [stall]);
    assert.strictEqual(m.tick(84_900), undefined, '풀린 뒤에는 다시 정상');
    assert.deepStrictEqual(m.recent(), [stall]);
});

test('EventLoopStallMonitor: start/stop 멱등, capacity 를 넘으면 오래된 기록부터 버린다, onStall 예외는 삼킨다', () => {
    const timers = fakeTimers();
    let now = 0;
    const m = new EventLoopStallMonitor({ tickMs: 100, thresholdMs: 100, capacity: 2, now: () => now, timers, onStall: () => { throw new Error('log fail'); } });
    m.start(); m.start();
    assert.strictEqual(timers.active, 1);
    assert.strictEqual(m.running, true);
    for (const at of [1000, 2000, 3000]) { now = at; m.tick(at); }
    assert.deepStrictEqual(m.recent().map(s => s.endedAt), [2000, 3000]);
    m.stop(); m.stop();
    assert.strictEqual(timers.active, 0);
    assert.strictEqual(m.running, false);
});

test('stallsWithin/stallOverlapMs: 구간과 겹치는 부분만 센다', () => {
    const stalls: EventLoopStall[] = [
        { startedAt: 0, endedAt: 10, durationMs: 10 },
        { startedAt: 100, endedAt: 200, durationMs: 100 },
        { startedAt: 300, endedAt: 400, durationMs: 100 },
    ];
    assert.deepStrictEqual(stallsWithin(stalls, 150, 350).map(s => s.startedAt), [100, 300]);
    assert.strictEqual(stallOverlapMs(stalls, 150, 350), 50 + 50);
    assert.strictEqual(stallOverlapMs(stalls, 0, 1000), 210);
    assert.strictEqual(stallOverlapMs(stalls, 500, 600), 0);
    assert.strictEqual(stallOverlapMs([], 0, 1), 0);
});

test('describeStall: 초 한 자리와 시작→끝 시각', () => {
    const s: EventLoopStall = { startedAt: 1000, endedAt: 72_400, durationMs: 71_400 };
    assert.strictEqual(describeStall(s, ms => `t${ms}`), '71.4 s (t1000 → t72400)');
    assert.match(describeStall(s), /^71\.4 s \(\d{2}:\d{2}:\d{2} → \d{2}:\d{2}:\d{2}\)$/);
});
