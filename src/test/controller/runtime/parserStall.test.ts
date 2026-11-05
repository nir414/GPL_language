import * as assert from 'assert';
import { test } from '../../harness';
import { ParserStallTracker, STALL_NO_PROGRESS_MS, STALL_PAYLOAD_FRESH_MS } from '../../../controller/runtime/parserStall';

const T0 = 1_000_000;

test('ParserStallTracker: 하트비트만 오고 파서가 쥔 바이트가 없으면 정체가 아니다', () => {
    const t = new ParserStallTracker();
    for (let i = 0; i < 100; i++) { t.onPayload(T0 + i * 1000); t.onPending(0, T0 + i * 1000); }
    assert.strictEqual(t.evaluate(T0 + 100_000).stalled, false);
});

test('ParserStallTracker: 바이트를 쥔 채 진전 없이 payload 만 계속 오면 정체로 본다', () => {
    const t = new ParserStallTracker();
    t.onPayload(T0); t.onPending(120, T0);
    const late = T0 + STALL_NO_PROGRESS_MS;
    t.onPayload(late - 1000);
    const v = t.evaluate(late);
    assert.strictEqual(v.stalled, true);
    assert.strictEqual(v.pendingBytes, 120);
    assert.strictEqual(v.noProgressMs, STALL_NO_PROGRESS_MS);
    // 임계 직전은 아직 아니다
    assert.strictEqual(t.evaluate(late - 1).stalled, false);
});

test('ParserStallTracker: 줄이 적재되면 진전으로 보고 시계를 다시 시작한다', () => {
    const t = new ParserStallTracker();
    t.onPayload(T0); t.onPending(50, T0);
    t.onLine(T0 + 20_000); t.onPayload(T0 + 20_000);
    assert.strictEqual(t.lastLine, T0 + 20_000);
    t.onPayload(T0 + STALL_NO_PROGRESS_MS);
    assert.strictEqual(t.evaluate(T0 + STALL_NO_PROGRESS_MS).stalled, false); // 진전 후 10 s
    t.onPayload(T0 + 50_000);
    assert.strictEqual(t.evaluate(T0 + 50_000).stalled, true);                // 진전 후 30 s
});

test('ParserStallTracker: payload 가 끊겼으면(더는 듣지 못함) 정체가 아니라 연결 문제다', () => {
    const t = new ParserStallTracker();
    t.onPayload(T0); t.onPending(10, T0);
    assert.strictEqual(t.evaluate(T0 + STALL_NO_PROGRESS_MS + STALL_PAYLOAD_FRESH_MS + 1).stalled, false);
});

test('ParserStallTracker: resetPending 은 쥔 바이트를 비우되 마지막 줄 시각은 남긴다', () => {
    const t = new ParserStallTracker();
    t.onLine(T0); t.onPayload(T0); t.onPending(10, T0);
    t.resetPending();
    t.onPayload(T0 + 60_000);
    assert.deepStrictEqual(t.evaluate(T0 + 60_000), { stalled: false, pendingBytes: 0, noProgressMs: 0 });
    assert.strictEqual(t.lastLine, T0);
});
