import * as assert from 'assert';
import { test } from './harness';
import { IdlePingScheduler, shouldIdlePing } from '../controller/idlePing';

// ── shouldIdlePing (순수 판정) ─────────────────────────────────────────────

test('shouldIdlePing: 유휴 간격이 지나고 진행 중 명령이 없을 때만 true', () => {
    const base = { enabled: true, intervalMs: 5000, inFlight: 0, lastActivityAt: 10_000 };
    assert.strictEqual(shouldIdlePing({ ...base, now: 14_999 }), false);
    assert.strictEqual(shouldIdlePing({ ...base, now: 15_000 }), true);
    assert.strictEqual(shouldIdlePing({ ...base, now: 15_000, inFlight: 1 }), false);
    assert.strictEqual(shouldIdlePing({ ...base, now: 15_000, enabled: false }), false);
    assert.strictEqual(shouldIdlePing({ ...base, now: 15_000, intervalMs: 0 }), false);
});

// ── IdlePingScheduler ─────────────────────────────────────────────────────

function makeScheduler(sendImpl?: () => Promise<void>) {
    let now = 100_000;
    const sent: number[] = [];
    const logs: string[] = [];
    const s = new IdlePingScheduler({
        intervalMs: () => 5000,
        enabled: () => true,
        send: sendImpl ?? (async () => { sent.push(now); }),
        log: m => logs.push(m),
        now: () => now,
    });
    return { s, sent, logs, setNow: (t: number) => { now = t; }, getNow: () => now };
}

test('IdlePingScheduler: 명령 활동이 있으면 유휴 타이머가 리셋된다', async () => {
    const { s, sent, setNow } = makeScheduler();
    setNow(103_000); s.noteCommandStart(); s.noteCommandEnd();
    setNow(105_000);
    assert.strictEqual(await s.tick(), false, '마지막 활동(103 s) 뒤 2 s — 아직 유휴 아님');
    setNow(108_000);
    assert.strictEqual(await s.tick(), true, '마지막 활동 뒤 5 s — ping');
    assert.deepStrictEqual(sent, [108_000]);
});

test('IdlePingScheduler: 진행 중 명령이 있으면 ping 하지 않는다', async () => {
    const { s, sent, setNow } = makeScheduler();
    s.noteCommandStart();
    setNow(200_000);
    assert.strictEqual(await s.tick(), false);
    s.noteCommandEnd();
    setNow(205_000);
    assert.strictEqual(await s.tick(), true);
    assert.strictEqual(sent.length, 1);
});

test('IdlePingScheduler: ping 자체가 활동으로 간주되어 다음 ping 은 interval 뒤에만 나간다', async () => {
    const { s, sent, setNow } = makeScheduler();
    setNow(105_000);
    assert.strictEqual(await s.tick(), true);
    setNow(106_000);
    assert.strictEqual(await s.tick(), false);
    setNow(109_999);
    assert.strictEqual(await s.tick(), false);
    setNow(110_000);
    assert.strictEqual(await s.tick(), true);
    assert.deepStrictEqual(sent, [105_000, 110_000]);
});

test('IdlePingScheduler: 실패는 통계와 로그(첫 회·10회마다)에 남고 스케줄은 계속된다', async () => {
    const { s, logs, setNow } = makeScheduler(async () => { throw new Error('Command timeout'); });
    let t = 105_000;
    for (let i = 0; i < 12; i++) {
        setNow(t);
        assert.strictEqual(await s.tick(), true);
        t += 5000;
    }
    const st = s.getStats();
    assert.strictEqual(st.pings, 12);
    assert.strictEqual(st.failures, 12);
    assert.strictEqual(st.lastFailureMessage, 'Command timeout');
    assert.strictEqual(logs.length, 2, '1회차 + 10회차');
    assert.ok(logs[0].includes('idle ping failed (1)'));
    assert.ok(logs[1].includes('idle ping failed (10)'));
});

test('IdlePingScheduler: send 가 끝나기 전에는 tick 이 겹쳐 ping 하지 않는다', async () => {
    let release: (() => void) | null = null;
    const { s, setNow } = makeScheduler(() => new Promise<void>(r => { release = r; }));
    setNow(105_000);
    const first = s.tick();
    setNow(120_000);
    assert.strictEqual(await s.tick(), false, 'ping 진행 중 — 중복 금지');
    release!();
    assert.strictEqual(await first, true);
    assert.strictEqual(s.getStats().pings, 1);
});

test('IdlePingScheduler: start/stop 이 타이머를 켜고 끈다', () => {
    const { s } = makeScheduler();
    assert.strictEqual(s.running, false);
    s.start();
    assert.strictEqual(s.running, true);
    s.start(); // idempotent
    s.stop();
    assert.strictEqual(s.running, false);
});
