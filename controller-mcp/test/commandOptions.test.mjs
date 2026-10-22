import test from 'node:test';
import assert from 'node:assert/strict';
import { compilerCommandOptions, controllerResponseOutcome } from '../src/commandOptions.js';

test('Compile/Start -compile은 60초 이상, </STATUS> 종결자까지 기다린다', () => {
  assert.deepEqual(compilerCommandOptions(15_000), { timeoutMs: 60_000, waitForStatusClose: true });
  assert.deepEqual(compilerCommandOptions(90_000), { timeoutMs: 90_000, waitForStatusClose: true });
});

test('종결 STATUS가 없는 부분 응답은 실패가 아니라 unknown이다', () => {
  assert.equal(controllerResponseOutcome({ code: 0, complete: true }), 'completed');
  assert.equal(controllerResponseOutcome({ code: -742, complete: true }), 'completed');
  assert.equal(controllerResponseOutcome({ code: -9999, complete: false }), 'unknown');
  assert.equal(controllerResponseOutcome(undefined), 'unknown');
});
