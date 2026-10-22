import * as assert from 'assert';
import { test } from './harness';
import { parseTemperatureResponse, TemperatureHistory, TemperatureHistoryPoint } from '../controller/diagnostics/temperature';

const ok = (data: string) => `<DATA>${data}</DATA><STATUS>0,"Success"</STATUS>`;
// G2400C의 2026-10-22 읽기 전용 실측. 0인 앰프를 CPU와 같은 유효값으로 사용하지 않는다.
const measured = 'CPU 1:      57.1 C\r\n\r\nRobot 1\r\n    Amp  1:  0.0 C\r\n    Amp  2:  0.0 C\r\n    Amp  3:  0.0 C\r\n    Amp  4:  0.0 C';

test('temperature: 실측 CPU와 네 앰프를 분리하고 0 반환값을 보존한다', () => {
	const result = parseTemperatureResponse(ok(measured), 123);
	assert.strictEqual(result.sampledAt, 123);
	assert.strictEqual(result.complete, true);
	assert.strictEqual(result.readings.length, 5);
	assert.strictEqual(result.readings[0].celsius, 57.1);
	assert.strictEqual(result.readings[1].celsius, null);
	assert.strictEqual(result.readings[1].reportedCelsius, 0);
	assert.strictEqual(result.readings[1].key, 'robot-1-amp-1');
});

test('temperature: 다중 CPU·Robot·음수·섭씨 기호를 독립적으로 해석한다', () => {
	const result = parseTemperatureResponse(ok('CPU 1: -2.5 °C\nCPU 2: 60 C\nRobot 2:\nAmp 1: 42 C\nRobot 3\nAmplifier 1: 43 C'));
	assert.deepStrictEqual(result.readings.map(r => r.celsius), [-2.5, 60, 42, 43]);
	assert.notStrictEqual(result.readings[2].key, result.readings[3].key);
});

test('temperature: STATUS 오류·종결 누락·빈 응답을 온도값으로 표시하지 않는다', () => {
	for (const raw of [null, '', `<DATA>${measured}</DATA>`, `<DATA>${measured}</DATA><STATUS>0,"Success"`, `<DATA>${measured}</DATA><STATUS>-714,"Unknown"</STATUS>`]) {
		const result = parseTemperatureResponse(raw);
		assert.deepStrictEqual(result.readings, []);
		assert.ok(result.note);
	}
});

test('temperature: 알 수 없는 형식·화씨·단위 누락은 원문으로 남긴다', () => {
	const result = parseTemperatureResponse(ok('CPU 1: 140 F\nCPU 2: 58\nRobot 1\n57.1'));
	assert.strictEqual(result.readings.length, 0);
	assert.ok(result.note);
	assert.ok(result.raw.includes('140 F'));
});

test('temperature history: 중복 캐시는 추가하지 않고 실패·최고값·초기화를 보존한다', () => {
	const history = new TemperatureHistory();
	const first = parseTemperatureResponse(ok('CPU 1: 57 C\nCPU 2: 59 C\nRobot 1\nAmp 1: 0 C'), 1);
	history.record(first);
	assert.strictEqual(history.record(first).length, 1);
	const points = history.record(parseTemperatureResponse(null, 2));
	assert.deepStrictEqual(points, [
		{ t: 1, cpuMaxC: 59, amplifierMaxC: null },
		{ t: 2, cpuMaxC: null, amplifierMaxC: null },
	]);
	points.length = 0;
	assert.strictEqual(history.record(parseTemperatureResponse(null, 3)).length, 3);
	history.clear();
	assert.strictEqual(history.record(first).length, 1);
});

test('temperature history: 탭 장기 사용 시 360점 상한', () => {
	const history = new TemperatureHistory();
	let points: TemperatureHistoryPoint[] = [];
	for (let t = 0; t < 400; t++) { points = history.record(parseTemperatureResponse(ok('CPU 1: 57 C'), t)); }
	assert.strictEqual(points!.length, 360);
	assert.strictEqual(points![0].t, 40);
});
