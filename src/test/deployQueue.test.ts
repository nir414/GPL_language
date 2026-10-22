import * as assert from 'assert';
import { KeyedSerialQueue } from '../controller/deployQueue';
import { test } from './harness';

test('deployQueue: 같은 제어기는 등록 순서대로, 다른 제어기는 병행한다', async () => {
	const queue = new KeyedSerialQueue();
	const order: string[] = [];
	let releaseFirst!: () => void;
	const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });

	const first = queue.enqueue('192.168.0.1', async () => {
		order.push('first:start');
		await firstGate;
		order.push('first:end');
		return 1;
	});
	const second = queue.enqueue('192.168.0.1', async () => {
		order.push('second');
		return 2;
	});
	const other = queue.enqueue('10.0.0.9', async () => {
		order.push('other');
		return 3;
	});

	assert.strictEqual(first.ahead, 0);
	assert.strictEqual(second.ahead, 1);
	assert.strictEqual(queue.depth('192.168.0.1'), 2);
	assert.strictEqual(await other.result, 3, '다른 제어기는 첫 작업을 기다리지 않는다');
	assert.deepStrictEqual(order, ['first:start', 'other']);

	releaseFirst();
	assert.deepStrictEqual(await Promise.all([first.result, second.result]), [1, 2]);
	assert.deepStrictEqual(order, ['first:start', 'other', 'first:end', 'second']);
	assert.strictEqual(queue.depth('192.168.0.1'), 0);
});

test('deployQueue: 앞 작업 실패가 다음 작업을 막지 않는다', async () => {
	const queue = new KeyedSerialQueue();
	const failed = queue.enqueue('controller', async () => { throw new Error('expected'); });
	const next = queue.enqueue('controller', async () => 'continued');
	await assert.rejects(failed.result, /expected/);
	assert.strictEqual(await next.result, 'continued');
});

