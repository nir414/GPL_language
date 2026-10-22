import * as assert from 'assert';
import { waitForFlashSafe } from '../controller/deployment/flashSafety';
import { presentFlashSafety } from '../views/flashSafetyPresentation';
import { test } from './harness';

test('flashSafety: Sync STATUS 0 뒤 10초 안정화 카운트다운을 모두 기다린다', async () => {
	const states: string[] = [];
	const waits: number[] = [];
	const result = await waitForFlashSafe({
		sendSync: async () => '<DATA></DATA>\r\n<STATUS>0,""</STATUS>',
		onState: state => states.push(state.phase === 'settling' ? `${state.phase}:${state.remainingSeconds}` : state.phase),
		sleep: async ms => { waits.push(ms); },
		settleMs: 10_000,
		tickMs: 1_000,
	});

	assert.deepStrictEqual(result, { ok: true, statusCode: 0 });
	assert.deepStrictEqual(states, [
		'syncing',
		'settling:10', 'settling:9', 'settling:8', 'settling:7', 'settling:6',
		'settling:5', 'settling:4', 'settling:3', 'settling:2', 'settling:1',
	]);
	assert.strictEqual(waits.reduce((sum, ms) => sum + ms, 0), 10_000);
});

test('flashSafety: Sync 오류나 STATUS 누락은 안전 미확인으로 남긴다', async () => {
	const statusStates: string[] = [];
	const badStatus = await waitForFlashSafe({
		sendSync: async () => '<STATUS>-508,"File not found"</STATUS>',
		onState: state => statusStates.push(state.phase),
		sleep: async () => undefined,
	});
	assert.strictEqual(badStatus.ok, false);
	assert.strictEqual(badStatus.statusCode, -508);
	assert.deepStrictEqual(statusStates, ['syncing', 'unknown']);

	const noStatus = await waitForFlashSafe({
		sendSync: async () => '<DATA></DATA>',
		sleep: async () => undefined,
	});
	assert.strictEqual(noStatus.ok, false);
	assert.strictEqual(noStatus.statusCode, -9999);
});

test('flashSafety: Sync 통신 실패는 예외를 던지지 않고 안전 미확인으로 보고한다', async () => {
	let last = '';
	const result = await waitForFlashSafe({
		sendSync: async () => { throw new Error('ECONNRESET'); },
		onState: state => { last = state.phase; },
	});
	assert.strictEqual(result.ok, false);
	assert.strictEqual(result.detail, 'ECONNRESET');
	assert.strictEqual(last, 'unknown');
});

test('flashSafety: 단계별 상태바 문구가 전원 차단 금지를 명시한다', () => {
	for (const state of [
		{ phase: 'writing' } as const,
		{ phase: 'syncing' } as const,
		{ phase: 'settling', remainingSeconds: 7 } as const,
		{ phase: 'unknown', detail: 'timeout' } as const,
	]) {
		const shown = presentFlashSafety(state, 'Probe');
		assert.ok(shown.text.includes('전원 끄지 마세요'));
		assert.ok(shown.tooltip.includes('Probe'));
	}
});
