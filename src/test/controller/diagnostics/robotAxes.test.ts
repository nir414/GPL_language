import * as assert from 'assert';
import { test } from '../../harness';
import {
	cartesianRobotOf,
	normalizeLimits,
	parseDataIdNumbers,
	parseDataIdString,
	parseDataIdValues,
	readPowerState,
	robotsFromTypes,
	PROBE_ROBOT_TYPES_CMD,
} from '../../../controller/diagnostics/robotAxes';
import { ControllerStatusSampler, StatusSamplerIO, PROBE_POWER_CMD, probeCartesianCmd, probeJointAnglesCmd } from '../../../controller/diagnostics/statusSampling';
import { SHOW_THREAD_LIST_CMD } from '../../../controller/protocol/responseParser';

const ok = (body: string) => `<DATA>${body}</DATA><STATUS>0,"Success"</STATUS>`;
const fail = (code: number, message: string) => `<STATUS>${code},"${message}"</STATUS>`;

// 실측 원문(2026-11-04, 5축 단일 축 로봇 5대 구성 제어기) — 형식 고정용
const REAL = {
	types: ok('116, 1, 1, 0, "Robot types" = 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0'),
	name1: ok('2002, 1, 1, 0, "Robot name" = "Track"'),
	max1: ok('16077, 1, 1, 0, "Joint max soft stop limit" = 288.5901'),
	min1: ok('16078, 1, 1, 0, "Joint min soft stop limit" = -8.111301'),
	angles1: ok('3504, 1, 1, 0, "Actual joint angles in deg or mm" = 129.924'),
	cart1: ok('3506, 1, 1, 0, "Actual Cartesian position in mm and deg" = 0, 0, 0, 0, 0, 0'),
	power: ok('230, 1, 1, 0, "Power state" = 12'),
	undefinedRobot: fail(-1001, '*Undefined robot*: 6'),
};

test('robot axes: pd 응답의 = 뒤 값만 읽고 설명 문자열의 콤마·= 는 무시한다', () => {
	assert.deepStrictEqual(parseDataIdValues(REAL.cart1), ['0', '0', '0', '0', '0', '0']);
	assert.deepStrictEqual(parseDataIdNumbers(ok('2703, 1, 1, 0, "100% Cartesian accels in (mm or deg)/sec^2, a=b" = 1200, 400,\n     0')), [1200, 400, 0]);
	assert.deepStrictEqual(parseDataIdNumbers(REAL.max1), [288.5901]);
	assert.strictEqual(parseDataIdString(REAL.name1), 'Track');
	assert.strictEqual(parseDataIdString(ok('2002, 2, 1, 0, "Robot name" = "H1 evZ"')), 'H1 evZ');
	assert.strictEqual(parseDataIdValues(ok('no equals here')), null);
	assert.strictEqual(parseDataIdValues(null), null);
	assert.deepStrictEqual(parseDataIdNumbers(ok('9, 1, 1, 0, "x" = 1, abc, 3')), [1, null, 3]);
});

test('robot axes: 116 은 0 에서 끝나는 연속 목록이고 type 1·7 은 직교 좌표가 없다', () => {
	assert.deepStrictEqual(robotsFromTypes(parseDataIdNumbers(REAL.types)!).map(r => r.robot), [1, 2, 3, 4, 5]);
	assert.deepStrictEqual(robotsFromTypes([4, 0, 1]), [{ robot: 1, type: 4 }]);
	const cfg = (types: Array<number | null>) => ({ sampledAt: 0, robots: types.map((type, i) => ({ robot: i + 1, type, name: null, limits: [] })) });
	assert.strictEqual(cartesianRobotOf(cfg([1, 1, 1])), null);
	assert.strictEqual(cartesianRobotOf(cfg([1, 5])), 2);
	assert.strictEqual(cartesianRobotOf(cfg([null])), 1);
	assert.strictEqual(cartesianRobotOf(undefined), 1);
});

test('robot axes: 소프트 리밋은 max > min 이고 무제한 크기가 아닐 때만 쓴다', () => {
	assert.deepStrictEqual(normalizeLimits([10, 5, 1e32, null], [-10, 5, -1e32, 0]), [
		{ min: -10, max: 10 }, { min: null, max: null }, { min: null, max: null }, { min: null, max: null },
	]);
	assert.deepStrictEqual(normalizeLimits(null, [1]), [{ min: null, max: null }]);
});

test('robot axes: 230 Power state 는 8~12 를 켜짐, 0~7 을 꺼짐으로 본다', () => {
	assert.deepStrictEqual(readPowerState(REAL.power), { state: 12, enabled: true, text: '켜짐 · 자동 모드 실행' });
	assert.strictEqual(readPowerState(ok('230, 1, 1, 0, "Power state" = 7')).enabled, false);
	assert.strictEqual(readPowerState(ok('230, 1, 1, 0, "Power state" = 9')).text, '켜는 중 · 커뮤테이션');
	assert.deepStrictEqual(readPowerState(null), { state: null, enabled: null, text: '조회 실패' });
});

function setup(responses: Map<string, string | null>) {
	let now = 100;
	const sent: string[] = [];
	const io: StatusSamplerIO = { send: async c => { sent.push(c); return responses.has(c) ? responses.get(c)! : fail(-1001, '*Undefined robot*'); }, now: () => now };
	return { sampler: new ControllerStatusSampler(), io, sent, setNow: (v: number) => { now = v; } };
}

function realController(): Map<string, string | null> {
	const m = new Map<string, string | null>([[SHOW_THREAD_LIST_CMD, ok('')], [PROBE_ROBOT_TYPES_CMD, REAL.types], [PROBE_POWER_CMD, REAL.power]]);
	const pos = [129.924, 0, 7.5, 0, 7.5];
	for (let r = 1; r <= 5; r++) {
		m.set(`pd 2002, ${r}`, ok(`2002, ${r}, 1, 0, "Robot name" = "R${r}"`));
		m.set(`pd 16077, ${r}`, r === 1 ? REAL.max1 : ok(`16077, ${r}, 1, 0, "Joint max soft stop limit" = 10`));
		m.set(`pd 16078, ${r}`, r === 1 ? REAL.min1 : ok(`16078, ${r}, 1, 0, "Joint min soft stop limit" = -140`));
		m.set(probeJointAnglesCmd(r), ok(`3504, ${r}, 1, 0, "Actual joint angles in deg or mm" = ${pos[r - 1]}`));
	}
	return m;
}

test('status sampling: 로봇 전체의 축 위치와 리밋을 DataID 로 읽고 조인트 전용 구성은 직교 좌표를 건너뛴다', async () => {
	const s = setup(realController());
	const snap = await s.sampler.sample({ ip: 'c', port: 1402 }, s.io, {});
	assert.strictEqual(snap.robots?.length, 5);
	assert.deepStrictEqual(snap.robots?.[0], { robot: 1, name: 'R1', type: 1, limits: [{ min: -8.111301, max: 288.5901 }], angles: [129.924] });
	assert.deepStrictEqual(snap.robots?.map(r => r.angles[0]), [129.924, 0, 7.5, 0, 7.5]);
	assert.deepStrictEqual(snap.jointAngles, [129.924]);
	assert.strictEqual(snap.cartesianRobot, null);
	assert.ok(!s.sent.some(c => c.startsWith('pd 3506')));
	assert.ok(!s.sent.some(c => /^Execute\b/i.test(c)), 'Execute 를 보내지 않는다(_Cmd_ 쓰레드를 만들지 않게)');
	assert.strictEqual(snap.powerEnabled, true);
	assert.strictEqual(snap.powerState?.state, 12);
	// 빠른 재조회는 구성을 다시 읽지 않는다: 쓰레드 + 전원 + 로봇 5
	s.sent.length = 0;
	s.setNow(1100);
	await s.sampler.sample({ ip: 'c', port: 1402 }, s.io, {});
	assert.deepStrictEqual(s.sent, [SHOW_THREAD_LIST_CMD, PROBE_POWER_CMD, ...[1, 2, 3, 4, 5].map(probeJointAnglesCmd)]);
});

test('status sampling: 구성 실패는 로봇 1 을 가정하고 진단 주기마다 다시 읽으며, 연결이 끊기면 구성을 버린다', async () => {
	const m = realController();
	m.set(PROBE_ROBOT_TYPES_CMD, fail(-1509, '*Invalid data index*'));
	m.set(probeCartesianCmd(1), REAL.cart1);
	const s = setup(m);
	const snap = await s.sampler.sample({ ip: 'c', port: 1402 }, s.io, {});
	assert.deepStrictEqual(snap.robots?.map(r => r.robot), [1]);
	assert.strictEqual(snap.robots?.[0].type, null);
	assert.ok(snap.robotsNote?.includes('116'));
	assert.strictEqual(snap.cartesianRobot, 1);
	assert.strictEqual(snap.cartesian.x, 0);
	s.sent.length = 0;
	s.setNow(1100);
	await s.sampler.sample({ ip: 'c', port: 1402 }, s.io, {});
	assert.ok(!s.sent.includes(PROBE_ROBOT_TYPES_CMD), '간격 전에는 다시 읽지 않는다');
	s.setNow(20000);
	m.set(PROBE_ROBOT_TYPES_CMD, REAL.types);
	const healed = await s.sampler.sample({ ip: 'c', port: 1402 }, s.io, {});
	assert.strictEqual(healed.robots?.length, 5);
	assert.strictEqual(healed.robotsNote, undefined);
	// 연결 유실 → 재연결이면 구성을 다시 읽는다
	m.set(SHOW_THREAD_LIST_CMD, null);
	await s.sampler.sample({ ip: 'c', port: 1402 }, s.io, {});
	m.set(SHOW_THREAD_LIST_CMD, ok(''));
	s.sent.length = 0;
	s.setNow(20500);
	await s.sampler.sample({ ip: 'c', port: 1402 }, s.io, {});
	assert.ok(s.sent.includes(PROBE_ROBOT_TYPES_CMD));
});

test('status sampling: 한 로봇의 위치 조회 실패는 그 로봇에만 메모로 남는다', async () => {
	const m = realController();
	m.set(probeJointAnglesCmd(3), fail(-1001, '*Undefined robot*: 3'));
	const s = setup(m);
	const snap = await s.sampler.sample({ ip: 'c', port: 1402 }, s.io, {});
	assert.deepStrictEqual(snap.robots?.[2].angles, []);
	assert.ok(snap.robots?.[2].note?.includes('-1001'));
	assert.deepStrictEqual(snap.robots?.[3].angles, [0]);
});
