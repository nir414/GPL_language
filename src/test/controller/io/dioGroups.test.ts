import * as assert from 'assert';
import { parseDioSignals } from '../../../controller/io/dio';
import {
	buildShowDioCommands, classifyDioSignal, forcedSignalsFor, groupDioSignals, SOFT_DIO_SIGNALS,
	STANDARD_REMOTE_GROUPS, toggleForceValue,
} from '../../../controller/io/dioGroups';
import { test } from '../../harness';

const groupOf = (signal: number) => classifyDioSignal(signal).group.id;

test('DIO 분류: 문서의 신호 번호 범위대로 그룹과 입출력을 정한다', () => {
	const cases: Array<[number, string, 'input' | 'output']> = [
		[13, 'local', 'output'], [96, 'local', 'output'], [10001, 'local', 'input'], [10096, 'local', 'input'],
		[101, 'rio-1', 'output'], [10496, 'rio-4', 'input'], [1501, 'rio-15', 'output'],
		[8081, 'dedicated', 'output'], [18032, 'dedicated', 'input'],
		[8131, 'axis-1', 'output'], [18633, 'axis-6', 'input'],
		[20001, 'soft', 'output'], [20064, 'soft', 'output'],
		[200013, 'node-2', 'output'], [810012, 'node-8', 'input'],
	];
	for (const [signal, group, direction] of cases) {
		assert.deepStrictEqual([signal, groupOf(signal), classifyDioSignal(signal).direction], [signal, group, direction]);
	}
});

test('DIO 분류: bank 의 97~100번째 자리·범위 밖 번호는 기타로 둔다', () => {
	for (const signal of [97, 100, 8097, 1601, 9999, 17999, 20065, 150001]) {
		assert.strictEqual(groupOf(signal), 'other', String(signal));
	}
});

test('DIO 분류: 실기 Show DIO 응답을 Local 그룹 순서·입력 먼저로 묶는다', () => {
	// 2026-10-27 G2400C 응답 발췌 — 8000번대 다수는 제어기·축 dedicated 출력이다.
	const raw = '<DATA>13: 0\r\n 18: 1\r\n10001: 0\r\n 8081: 1\r\n 8131: 0\r\n18001: 0\r\n18110: 1 *\r\n20001: 1</DATA><STATUS>0,"Success"</STATUS>';
	const groups = groupDioSignals(parseDioSignals(raw));
	assert.deepStrictEqual(groups.map(g => [g.id, g.signals.map(s => s.signal), g.on, g.forced]), [
		['local', [10001, 13, 18], 1, 0],
		['soft', [20001], 1, 0],
		['dedicated', [18001, 8081], 1, 0],
		['axis-1', [18110, 8131], 1, 1],
	]);
});

test('DIO 분류: Remote 그룹은 Local 뒤에 RIO → Node 순으로 온다', () => {
	const groups = groupDioSignals([200013, 101, 13].map(signal => ({ signal, on: false, forced: false })));
	assert.deepStrictEqual(groups.map(g => [g.id, g.section]), [['local', 'local'], ['rio-1', 'remote'], ['node-2', 'remote']]);
	assert.deepStrictEqual(STANDARD_REMOTE_GROUPS.map(g => g.id),
		['rio-1', 'rio-2', 'rio-3', 'rio-4', 'node-2', 'node-3', 'node-4', 'node-5', 'node-6', 'node-7', 'node-8']);
});

test('DIO Soft 조회: 64개를 길이 상한 안의 Show DIO 여러 줄로 나눈다', () => {
	const commands = buildShowDioCommands(SOFT_DIO_SIGNALS);
	assert.ok(commands.length > 1);
	assert.ok(commands.every(c => c.startsWith('Show DIO ') && c.length <= 160), commands.join('\n'));
	const listed = commands.flatMap(c => c.slice('Show DIO '.length).split(',').map(Number));
	assert.deepStrictEqual(listed, [...SOFT_DIO_SIGNALS]);
	assert.deepStrictEqual(buildShowDioCommands([13, -1, 0, 1.5, 14], 1000), ['Show DIO 13,14']);
	assert.deepStrictEqual(buildShowDioCommands([]), []);
});

test('DIO 토글·일괄 해제: 반대 값으로 강제하고 강제된 신호만 고른다', () => {
	assert.strictEqual(toggleForceValue({ on: true }), -1);
	assert.strictEqual(toggleForceValue({ on: false }), 1);
	const signals = [
		{ signal: 20002, on: true, forced: true },
		{ signal: 13, on: false, forced: true },
		{ signal: 14, on: true, forced: false },
	];
	assert.deepStrictEqual(forcedSignalsFor(signals), [13, 20002]);
	assert.deepStrictEqual(forcedSignalsFor(signals, 'soft'), [20002]);
	assert.deepStrictEqual(forcedSignalsFor(signals, 'rio-1'), []);
});
