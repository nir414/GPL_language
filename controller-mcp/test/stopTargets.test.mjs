import test from 'node:test';
import assert from 'node:assert/strict';
import { isConsoleStopThreadName, partitionStopTargets } from '../src/stopTargets.js';

test('Stop 대상: 일반 식별자는 전송하고 대괄호 이름은 건너뛴다', () => {
  assert.equal(isConsoleStopThreadName('LOG_SOCKET'), true);
  assert.equal(isConsoleStopThreadName('TCPCLI[0]'), false);
  const r = partitionStopTargets(['Main', 'TCPCLI[0]', 'LOG_SOCKET']);
  assert.deepEqual(r.commands, ['Stop Main', 'Stop LOG_SOCKET']);
  assert.deepEqual(r.names, ['Main', 'LOG_SOCKET']);
  assert.deepEqual(r.skipped.map((x) => x.name), ['TCPCLI[0]']);
});

test('Stop 대상: 공백·따옴표·-all 가장을 보내지 않는다', () => {
  for (const name of ['two words', 'bad"name', "bad'name", '-all', '', 'TCPLSN:8013']) {
    assert.equal(isConsoleStopThreadName(name), false, name);
  }
});
