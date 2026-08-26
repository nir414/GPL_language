import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBatch, normalizeCommandInput, BATCH_MAX } from '../src/batch.js';

/** runCommand 모사: 응답 지연을 섞어 순차 실행이 아니면 순서가 깨지도록 한다. */
function fakeRunner(behaviour = {}) {
  const calls = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const runOne = async (command, index) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    calls.push(command);
    const b = behaviour[command] ?? {};
    await new Promise((r) => setTimeout(r, b.delayMs ?? (index % 2 === 0 ? 8 : 1)));
    inFlight--;
    if (b.throws) throw new Error(b.throws);
    const ok = b.ok !== false;
    const res = { command, status: { code: ok ? 0 : (b.code ?? -714), message: ok ? 'Success' : 'fail', complete: true }, ok, data: b.data ?? `data:${command}` };
    if (!ok && b.hint) res.hint = b.hint;
    return res;
  };
  return { runOne, calls, get maxInFlight() { return maxInFlight; } };
}

test('runBatch: 순서 보장 + 순차 실행(동시 in-flight 1) + 항목 구조', async () => {
  const cmds = ['pd 2703', 'pd 2704', 'pd 2705', 'Show Memory'];
  const f = fakeRunner();
  const out = await runBatch(cmds, f.runOne);
  assert.deepEqual(f.calls, cmds); // 보낸 순서 = 배열 순서
  assert.equal(f.maxInFlight, 1); // Promise.all 금지 — 1402 단일 채널
  assert.equal(out.count, 4);
  assert.equal(out.okCount, 4);
  assert.equal(out.failCount, 0);
  assert.equal(out.stoppedAt, undefined);
  assert.equal(out.skipped, undefined);
  assert.deepEqual(out.results.map((r) => r.index), [0, 1, 2, 3]);
  assert.deepEqual(out.results.map((r) => r.command), cmds);
  const r0 = out.results[0];
  assert.equal(r0.ok, true);
  assert.equal(r0.status.code, 0);
  assert.equal(r0.data, 'data:pd 2703'); // runOne 결과 {command,status,ok,data}가 그대로 펼쳐진다
});

test('runBatch: stopOnError=false(기본) — 실패/throw 뒤에도 계속, hint 보존', async () => {
  const f = fakeRunner({
    'Bogus 1': { ok: false, code: -714, hint: '없는 명령' },
    'Show Thread -web': { throws: 'Command timed out after 15000ms: Show Thread -web' },
  });
  const out = await runBatch(['pd 1', 'Bogus 1', 'Show Thread -web', 'pd 2'], f.runOne);
  assert.equal(f.calls.length, 4);
  assert.equal(out.okCount, 2);
  assert.equal(out.failCount, 2);
  assert.equal(out.stoppedAt, undefined);
  assert.equal(out.results[1].ok, false);
  assert.equal(out.results[1].status.code, -714);
  assert.equal(out.results[1].hint, '없는 명령');
  assert.equal(out.results[2].ok, false);
  assert.match(out.results[2].error, /timed out/); // throw는 {ok:false,error}로 포착 — 배치가 죽지 않는다
  assert.equal(out.results[2].status, undefined);
  assert.equal(out.results[3].ok, true);
});

test('runBatch: stopOnError=true — 첫 실패(ok=false)에서 중단, stoppedAt/skipped 기록', async () => {
  const f = fakeRunner({ 'pd 2': { ok: false } });
  const out = await runBatch(['pd 1', 'pd 2', 'pd 3', 'pd 4'], f.runOne, { stopOnError: true });
  assert.deepEqual(f.calls, ['pd 1', 'pd 2']); // 3·4는 보내지 않았다
  assert.equal(out.count, 4);
  assert.equal(out.okCount, 1);
  assert.equal(out.failCount, 1);
  assert.equal(out.stoppedAt, 1);
  assert.equal(out.skipped, 2);
  assert.equal(out.results.length, 2);
});

test('runBatch: stopOnError=true — throw(타임아웃/연결 오류)도 중단 사유', async () => {
  const f = fakeRunner({ 'pd 1': { throws: 'ECONNREFUSED' } });
  const out = await runBatch(['pd 1', 'pd 2'], f.runOne, { stopOnError: true });
  assert.deepEqual(f.calls, ['pd 1']);
  assert.equal(out.stoppedAt, 0);
  assert.equal(out.skipped, 1);
  assert.equal(out.results[0].error, 'ECONNREFUSED');
});

test('runBatch: 마지막 항목 실패로 중단되면 skipped는 생략(0)', async () => {
  const f = fakeRunner({ 'pd 2': { ok: false } });
  const out = await runBatch(['pd 1', 'pd 2'], f.runOne, { stopOnError: true });
  assert.equal(out.stoppedAt, 1);
  assert.equal(out.skipped, undefined);
});

test('runBatch: 빈 배열/비배열/runOne 누락 거부', async () => {
  await assert.rejects(() => runBatch([], async () => ({ ok: true })), /1개 이상/);
  await assert.rejects(() => runBatch('pd 1', async () => ({ ok: true })), /1개 이상/);
  await assert.rejects(() => runBatch(['pd 1'], null), /runOne/);
});

test('runBatch: runOne이 ok 없는 값을 돌려주면 실패로 취급(성공 추정 금지)', async () => {
  const out = await runBatch(['x'], async () => ({ data: 'no status' }));
  assert.equal(out.results[0].ok, false);
  assert.equal(out.failCount, 1);
});

test('normalizeCommandInput: 단건/배치 정확히 하나 — 둘 다/둘 다 없음/빈 항목/초과 거부', () => {
  assert.deepEqual(normalizeCommandInput({ command: '  Show Thread -web ' }), { mode: 'single', command: 'Show Thread -web' });
  assert.deepEqual(normalizeCommandInput({ commands: ['pd 1', ' pd 2 '] }), { mode: 'batch', commands: ['pd 1', 'pd 2'] });
  assert.throws(() => normalizeCommandInput({ command: 'a', commands: ['b'] }), /동시에/);
  assert.throws(() => normalizeCommandInput({}), /command\(단건 문자열\) 또는 commands/);
  assert.throws(() => normalizeCommandInput({ command: '   ' }), /비어/);
  assert.throws(() => normalizeCommandInput({ commands: [] }), /빈 배열/);
  assert.throws(() => normalizeCommandInput({ commands: ['pd 1', '  '] }), /commands\[1\]가 비어/);
  assert.throws(() => normalizeCommandInput({ commands: ['pd 1', 5] }), /commands\[1\]가 문자열이 아니다/);
  assert.throws(() => normalizeCommandInput({ commands: 'pd 1' }), /문자열 배열/);
  assert.throws(() => normalizeCommandInput({ commands: Array.from({ length: BATCH_MAX + 1 }, (_, i) => `pd ${i}`) }), /최대 50개/);
  assert.equal(normalizeCommandInput({ commands: Array.from({ length: BATCH_MAX }, (_, i) => `pd ${i}`) }).commands.length, BATCH_MAX);
});
