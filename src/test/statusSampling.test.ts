import * as assert from 'assert';
import { test } from './harness';
import { ControllerStatusSampler, StatusSamplerIO, PROBE_POWER_CMD, PROBE_ANGLES_CMD, PROBE_CART_CMD, PROBE_ERRORLOG_CMD, PROBE_MEMORY_CMD, PROBE_NET_TCP_CMD, PROBE_NET_MBUF_CMD } from '../controller/diagnostics/statusSampling';
import { PROBE_TEMPERATURE_CMD } from '../controller/diagnostics/temperature';
import { SHOW_THREAD_LIST_CMD } from '../controller/protocol/responseParser';

const target = { ip: 'test-controller', port: 1402 };
const options = { includeResources: true, includeTemperature: true };
const ok = (body: string) => `<DATA>${body}</DATA><STATUS>0,"Success"</STATUS>`;
function setup() {
	let now = 100;
	let active = true;
	const sent: string[] = [];
	const responses = new Map<string, string | null>([
		[SHOW_THREAD_LIST_CMD, ok('')], [PROBE_POWER_CMD, ok('True')],
		[PROBE_ANGLES_CMD, ok('1,2,3,4')], [PROBE_CART_CMD, ok('1,2,3,4,5,6')],
		[PROBE_ERRORLOG_CMD, ok('')], [PROBE_TEMPERATURE_CMD, ok('CPU 1: 57.1 C')],
		[PROBE_MEMORY_CMD, ok('Free 5.0 Mb, Used 8.0 Mb, Segments 7')],
		[PROBE_NET_TCP_CMD, ok('connections accepted 100, established 20, closed 80')],
		[PROBE_NET_MBUF_CMD, ok('mbufs 3072 free 2000 clusters 512 free 200')],
	]);
	const io: StatusSamplerIO = { send: async command => { sent.push(command); return responses.get(command) ?? null; }, now: () => now, isActive: () => active };
	return { sampler: new ControllerStatusSampler(), io, sent, responses, setNow: (value: number) => { now = value; }, cancel: () => { active = false; } };
}

test('status sampling: 첫 조회 9명령, 빠른 재조회는 4명령, 진단은 10초 후 재조회', async () => {
	const s = setup();
	const first = await s.sampler.sample(target, s.io, options);
	assert.strictEqual(s.sent.length, 9);
	assert.strictEqual(first.temperature?.readings[0].celsius, 57.1);
	assert.strictEqual(first.resources?.memory?.freeMb, 5);
	s.sent.length = 0;
	s.setNow(1600);
	const next = await s.sampler.sample(target, s.io, options);
	assert.deepStrictEqual(s.sent, [SHOW_THREAD_LIST_CMD, PROBE_POWER_CMD, PROBE_ANGLES_CMD, PROBE_CART_CMD]);
	assert.strictEqual(next.temperature?.sampledAt, 100);
	assert.strictEqual(next.timestamp, 1600);
	s.sent.length = 0;
	s.setNow(10100);
	await s.sampler.sample(target, s.io, options);
	assert.strictEqual(s.sent.length, 9);
});

test('status sampling: 수동 갱신과 설정 간격, 자원 비활성 시 온도 유지', async () => {
	const s = setup();
	await s.sampler.sample(target, s.io, options);
	s.sent.length = 0;
	await s.sampler.sample(target, s.io, { ...options, forceDiagnostics: true });
	assert.strictEqual(s.sent.length, 9);
	s.sent.length = 0;
	s.setNow(2100);
	const next = await s.sampler.sample(target, s.io, { includeTemperature: true, diagnosticIntervalMs: 2000 });
	assert.ok(s.sent.includes(PROBE_TEMPERATURE_CMD));
	assert.ok(!s.sent.includes(PROBE_MEMORY_CMD));
	assert.strictEqual(next.resources, undefined);
});

test('status sampling: 제어기 전환·연결 세션 초기화 후 이전 진단을 재사용하지 않는다', async () => {
	const s = setup();
	await s.sampler.sample(target, s.io, options);
	s.responses.set(PROBE_TEMPERATURE_CMD, ok('CPU 1: 42 C'));
	const next = await s.sampler.sample({ ...target, ip: 'other-controller' }, s.io, options);
	assert.strictEqual(next.temperature?.readings[0].celsius, 42);
	s.sampler.clear();
	s.sent.length = 0;
	await s.sampler.sample(target, s.io, options);
	assert.strictEqual(s.sent.length, 9);
});

test('status sampling: 불완전·오류 응답을 정상 상태나 유효 센서값으로 사용하지 않는다', async () => {
	const s = setup();
	s.responses.set(PROBE_POWER_CMD, '<DATA>True</DATA><STATUS>0,"Success"');
	s.responses.set(PROBE_ERRORLOG_CMD, '<STATUS>-714,"Unknown"</STATUS>');
	s.responses.set(PROBE_MEMORY_CMD, '<DATA>Free 5.0 Mb</DATA><STATUS>0,"Success"');
	s.responses.set(PROBE_TEMPERATURE_CMD, '<DATA>CPU 1: 57 C</DATA><STATUS>0,"Success"');
	const next = await s.sampler.sample(target, s.io, options);
	assert.strictEqual(next.powerEnabled, null);
	assert.strictEqual(next.resources?.memory, null);
	assert.strictEqual(next.temperature?.readings.length, 0);
	assert.ok(next.errorsNote);
	s.responses.set(SHOW_THREAD_LIST_CMD, '<DATA></DATA><STATUS>0,"Success"');
	s.sent.length = 0;
	assert.strictEqual((await s.sampler.sample(target, s.io, options)).connected, false);
	assert.deepStrictEqual(s.sent, [SHOW_THREAD_LIST_CMD]);
});

test('status sampling: 실패한 최신 온도 조회가 이전 성공값을 덮어 미확인으로 표시한다', async () => {
	const s = setup();
	await s.sampler.sample(target, s.io, options);
	s.setNow(10100);
	s.responses.set(PROBE_TEMPERATURE_CMD, null);
	const next = await s.sampler.sample(target, s.io, options);
	assert.deepStrictEqual(next.temperature?.readings, []);
	assert.strictEqual(next.temperature?.sampledAt, 10100);
});

test('status sampling: 명령 거부 응답은 연결 유실이나 빈 쓰레드 성공으로 오인하지 않는다', async () => {
	const s = setup();
	s.responses.set(SHOW_THREAD_LIST_CMD, '<STATUS>-714,"Unknown command"</STATUS>');
	const next = await s.sampler.sample(target, s.io, options);
	assert.strictEqual(next.connected, true);
	assert.strictEqual(next.threadsAvailable, false);
	assert.ok(next.note?.includes('-714'));
});

test('status sampling: 진행 중 해제되면 뒤에 남은 조회를 전송하거나 캐시하지 않는다', async () => {
	const s = setup();
	const original = s.io.send;
	s.io.send = async command => { const raw = await original(command); s.cancel(); return raw; };
	await assert.rejects(() => s.sampler.sample(target, s.io, options), /취소/);
	assert.deepStrictEqual(s.sent, [SHOW_THREAD_LIST_CMD]);
});

test('status sampling: 명령을 한꺼번에 큐에 넣지 않고 직전 응답 뒤 다음 명령을 보낸다', async () => {
	const s = setup();
	const original = s.io.send;
	let release!: () => void;
	const gate = new Promise<void>(resolve => { release = resolve; });
	s.io.send = async command => { if (command === PROBE_POWER_CMD) { await gate; } return original(command); };
	const pending = s.sampler.sample(target, s.io, options);
	await new Promise(resolve => setImmediate(resolve));
	assert.deepStrictEqual(s.sent, [SHOW_THREAD_LIST_CMD]);
	release();
	await pending;
	assert.strictEqual(s.sent.length, 9);
});
