import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseIdentity, evaluateIdentity, parseExpectedSerials, powerEnabledFromDataId, createIdentityProbe, firstDataIdString,
} from '../src/identity.js';
import { buildStackReport, stackNumbersFromFields, summarizeStack } from '../src/stackUsage.js';
import { parseThreadList } from '../src/parse.js';

const ok = (data) => ({ ok: true, data });

test('parseIdentity: 110/114/109/101 문자열 값의 따옴표를 벗긴다', () => {
  const id = parseIdentity({
    serial: ok('110, 1, 1, 0, "Controller serial number" = "0014FF-02300289"'),
    id: ok('114, 1, 1, 0, "Controller ID" = "410c-01be-49c4-e3b5"'),
    name: ok('109, 1, 1, 0, "Controller name" = "102. Antibody 96Ch"'),
    model: ok('101, 1, 1, 0, "Controller model" = "G2400C"'),
  });
  assert.deepEqual(id, { serial: '0014FF-02300289', id: '410c-01be-49c4-e3b5', name: '102. Antibody 96Ch', model: 'G2400C' });
});

test('parseIdentity: 전부 실패하면 null, 일부만 읽어도 나머지는 null', () => {
  assert.equal(parseIdentity({ serial: { ok: false } }), null);
  assert.deepEqual(parseIdentity({ serial: ok('110, 1, 1, 0, "x" = "S1"') }), { serial: 'S1', id: null, name: null, model: null });
  assert.equal(firstDataIdString('garbage'), null);
});

test('evaluateIdentity: 기대값 없음/일치/불일치/읽기 실패', () => {
  const id = { serial: '0014FF-02300289' };
  assert.equal(evaluateIdentity(id, undefined), null);
  assert.equal(evaluateIdentity(id, ''), null);
  assert.equal(evaluateIdentity(id, '0014ff-02300289'), null); // 대소문자 무시
  assert.equal(evaluateIdentity(id, ['A', '0014FF-02300289']), null);
  const diff = evaluateIdentity(id, 'AAA-1');
  assert.equal(diff.reason, 'serial-differs');
  assert.deepEqual(diff.expected, ['AAA-1']);
  assert.equal(evaluateIdentity(null, 'AAA-1').reason, 'serial-unreadable');
  assert.deepEqual(parseExpectedSerials('A, B;C  D'), ['A', 'B', 'C', 'D']);
});

test('powerEnabledFromDataId: 230 — 8~12 켜짐, 0~7 꺼짐, 해석 불가 null', () => {
  assert.equal(powerEnabledFromDataId('230, 1, 1, 0, "Power state" = 12'), true);
  assert.equal(powerEnabledFromDataId('230, 1, 1, 0, "Power state" = 8'), true);
  assert.equal(powerEnabledFromDataId('230, 1, 1, 0, "Power state" = 7'), false);
  assert.equal(powerEnabledFromDataId('230, 1, 1, 0, "Power state" = 0'), false);
  assert.equal(powerEnabledFromDataId('-712 *error*'), null);
  assert.equal(powerEnabledFromDataId(''), null);
});

test('createIdentityProbe: 연결 키별 1회 캐시, 실패는 캐시하지 않음, 불일치 필드', async () => {
  let reads = 0;
  let key = 'a:1402';
  let next = { serial: 'S1', id: 'I1', name: 'n', model: 'm' };
  const probe = createIdentityProbe({
    key: () => key, readIdentity: async () => { reads++; return next; }, expected: () => 'S2',
  });
  const f1 = await probe.fields();
  assert.equal(f1.controllerIdentity.serial, 'S1');
  assert.equal(f1.identityMismatch.reason, 'serial-differs');
  await probe.fields();
  assert.equal(reads, 1);
  key = 'b:1402';
  await probe.fields();
  assert.equal(reads, 2);
  next = null; probe.reset();
  const f3 = await probe.fields();
  assert.equal(f3.controllerIdentity, null);
  assert.equal(f3.identityMismatch.reason, 'serial-unreadable');
  await probe.fields();
  assert.equal(reads, 4); // 실패는 재시도
});

test('createIdentityProbe: maxAge 지나면 다시 읽는다', async () => {
  let t = 0; let reads = 0;
  const probe = createIdentityProbe({ key: () => 'k', readIdentity: async () => { reads++; return { serial: 'S' }; }, expected: () => '', now: () => t }, { maxAgeMs: 100 });
  await probe.fields(); t = 50; await probe.fields(); assert.equal(reads, 1);
  t = 200; await probe.fields(); assert.equal(reads, 2);
});

test('스택 사용량: 파이프 행 끝 3수치 → % 와 경고(90%)', () => {
  const raw = [
    'MAIN| Running| 0| ""| P| Main| 3| a.gpl| 5| 0.094| 4.000| 1.289',
    'TCPCMD| Idle| 0| ""| P| Pump| 1| b.gpl| 2| 0.2| 4.000| 3.984',
    'NOSTACK| Idle| 0| ""| P| X| 1| c.gpl| 2',
  ].join('\n');
  const { threads } = parseThreadList(raw);
  assert.deepEqual(stackNumbersFromFields(threads[2].fields), null);
  const rep = buildStackReport(threads);
  assert.equal(rep.threads.length, 2);
  assert.equal(rep.threads[0].name, 'TCPCMD');
  assert.equal(rep.threads[0].percent, 99.6);
  assert.equal(rep.threads[0].warn, true);
  assert.equal(rep.threads[1].warn, false);
  assert.equal(rep.warnings.length, 1);
  assert.match(rep.warnings[0], /TCPCMD/);
});

test('summarizeStack: size 0 또는 max>size 이면 비율 계산 안 함', () => {
  assert.equal(summarizeStack([1, 0, 0]).percent, null);
  assert.equal(summarizeStack([1, 4, 5]).percent, null);
  assert.equal(summarizeStack([1, 4]), null);
});
