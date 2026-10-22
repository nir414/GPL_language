import * as assert from 'assert';
import { buildSetDioCommand, describeDioForce, parseDioSignals } from '../controller/dio';
import { test } from './harness';

test('DIO: Show DIO 응답의 ON/OFF와 강제 상태를 파싱한다', () => {
	const raw = '<DATA>\r\n   13: 0\r\n   14: 1 *\r\n10001: 0\r\n</DATA>\r\n<STATUS>0,""</STATUS>';
	assert.deepStrictEqual(parseDioSignals(raw), [
		{ signal: 13, on: false, forced: false },
		{ signal: 14, on: true, forced: true },
		{ signal: 10001, on: false, forced: false },
	]);
});

test('DIO: 파이프 구분·중복 신호를 허용하고 마지막 상태를 번호순으로 돌려준다', () => {
	const raw = '<DATA>14: 0 | 13: 1 * | 14: 1</DATA><STATUS>0,""</STATUS>';
	assert.deepStrictEqual(parseDioSignals(raw), [
		{ signal: 13, on: true, forced: true },
		{ signal: 14, on: true, forced: false },
	]);
});

test('DIO: 설명·STATUS·잡음 행은 신호로 오인하지 않는다', () => {
	const raw = '<DATA>signal: status\nnot a row\n13: 2\n14: 1 forced</DATA><STATUS>0,""</STATUS>';
	assert.deepStrictEqual(parseDioSignals(raw), []);
});

test('DIO: Set DIO 명령은 안전한 정수 신호와 세 값만 허용한다', () => {
	assert.strictEqual(buildSetDioCommand(13, 1), 'Set DIO 13 1');
	assert.strictEqual(buildSetDioCommand(10001, -1), 'Set DIO 10001 -1');
	assert.strictEqual(buildSetDioCommand(0, 0), 'Set DIO 0 0');
	for (const [signal, value] of [[-1, 1], [1.5, 1], ['13', 1], [13, 2], [13, '1']]) {
		assert.strictEqual(buildSetDioCommand(signal, value), undefined);
	}
});

test('DIO: 강제 해제 설명은 현재 값을 바꾸지 않는다는 의미를 보존한다', () => {
	assert.ok(describeDioForce(0).detail.includes('ON/OFF 값은 그대로'));
});
