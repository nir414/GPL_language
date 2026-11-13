import * as assert from 'assert';
import { test } from '../../harness';
import { LaneQueue } from '../../../debug/session/commandLanes';

/** 수동으로 완료시키는 작업 — 큐 순서를 결정적으로 검사하기 위한 도구. */
function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

const tick = () => new Promise<void>(r => setImmediate(r));

test('commandLanes: control 작업은 먼저 등록된 data 작업보다 앞서 나간다', async () => {
    const q = new LaneQueue({ failureCooldownMs: 0 });
    const order: string[] = [];
    const first = deferred<void>();
    // 실행 중인 작업 하나가 큐를 잡고 있는 동안 data 2개 → control 1개 순으로 등록
    const running = q.enqueue('data', async () => { order.push('d0'); await first.promise; });
    await tick();
    const d1 = q.enqueue('data', async () => { order.push('d1'); });
    const d2 = q.enqueue('data', async () => { order.push('d2'); });
    const c1 = q.enqueue('control', async () => { order.push('c1'); });
    assert.deepStrictEqual(q.stats(), { controlPending: 1, dataPending: 2, running: true, generation: 0 });
    first.resolve();
    await Promise.all([running, d1, d2, c1]);
    assert.deepStrictEqual(order, ['d0', 'c1', 'd1', 'd2']);
});

test('commandLanes: invalidateData 는 시작하지 않은 data 작업을 보내지 않고 staleValue 로 끝낸다', async () => {
    const q = new LaneQueue({ failureCooldownMs: 0 });
    const sent: string[] = [];
    const gate = deferred<void>();
    const running = q.enqueue('control', async () => { sent.push('step'); await gate.promise; return 'ok'; });
    await tick();
    const stale = q.enqueue('data', async () => { sent.push('var'); return 'value'; }, { staleValue: null });
    q.invalidateData();
    const fresh = q.enqueue('data', async () => { sent.push('var2'); return 'value2'; }, { staleValue: null });
    gate.resolve();
    assert.strictEqual(await stale, null);
    assert.strictEqual(await running, 'ok');
    assert.strictEqual(await fresh, 'value2');
    assert.deepStrictEqual(sent, ['step', 'var2']);
});

test('commandLanes: 실행 중인 작업은 invalidateData 로 중단되지 않는다', async () => {
    const q = new LaneQueue({ failureCooldownMs: 0 });
    const gate = deferred<string>();
    const running = q.enqueue('data', async () => gate.promise, { staleValue: null });
    await tick();
    q.invalidateData();
    gate.resolve('late');
    assert.strictEqual(await running, 'late');
});

test('commandLanes: 실패한 작업은 reject 되고 다음 작업 전에 cooldown 을 둔다', async () => {
    const slept: number[] = [];
    const q = new LaneQueue({ failureCooldownMs: 100, sleep: async ms => { slept.push(ms); } });
    const failing = q.enqueue('control', async () => { throw new Error('boom'); });
    const after = q.enqueue('control', async () => 'next');
    await assert.rejects(failing, /boom/);
    assert.strictEqual(await after, 'next');
    assert.deepStrictEqual(slept, [100]);
});

test('commandLanes: 작업 컨텍스트에 큐 대기 시간과 앞서 실행된 작업 수가 실린다', async () => {
    let now = 1000;
    const q = new LaneQueue({ failureCooldownMs: 0, now: () => now });
    const gate = deferred<void>();
    const first = q.enqueue('control', async () => { await gate.promise; });
    await tick();
    const second = q.enqueue('control', async ctx => ctx);
    now = 1250;
    gate.resolve();
    await first;
    const ctx = await second;
    assert.strictEqual(ctx.waitedMs, 250);
    assert.strictEqual(ctx.ranAhead, 1);
});

test('commandLanes: pump 가 끝나는 사이 등록된 작업도 실행된다', async () => {
    const q = new LaneQueue({ failureCooldownMs: 0 });
    const results: number[] = [];
    await q.enqueue('control', async () => { results.push(1); });
    await q.enqueue('data', async () => { results.push(2); });
    await q.enqueue('control', async () => { results.push(3); });
    assert.deepStrictEqual(results, [1, 2, 3]);
    await tick(); // 작업 결과는 pump 의 finally 보다 먼저 전달된다 — running 해제는 한 틱 뒤
    assert.strictEqual(q.stats().running, false);
});
