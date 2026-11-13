import test from 'node:test';
import assert from 'node:assert/strict';
import { DEBUG_SESSION_REFUSAL, debugSessionRefusal } from '../src/debugSessionGuard.js';

test('debugSessionActive 가 true 이고 동의가 없으면 구조화 거부', () => {
  const r = debugSessionRefusal({ tool: 'unload_project', debugSessionActive: true });
  assert.equal(r.ok, false);
  assert.equal(r.refused, DEBUG_SESSION_REFUSAL);
  assert.equal(r.refused, 'debug-session-active');
  assert.equal(r.sent, false);
  assert.equal(r.outcome, 'not-sent');
  assert.deepEqual(r.recovery.retryWith, { confirmDebugSession: true });
  assert.match(r.detail, /unload_project/);
});

test('동의가 있거나 디버그 세션이 아니거나 모르면(undefined/null) 통과', () => {
  assert.equal(debugSessionRefusal({ tool: 'stop_threads', debugSessionActive: true, confirmDebugSession: true }), null);
  assert.equal(debugSessionRefusal({ tool: 'stop_threads', debugSessionActive: false }), null);
  assert.equal(debugSessionRefusal({ tool: 'stop_threads', debugSessionActive: undefined }), null);
  assert.equal(debugSessionRefusal({ tool: 'stop_threads', debugSessionActive: null }), null);
});

test('action 이 있으면 문구에 싣는다', () => {
  assert.match(debugSessionRefusal({ tool: 'stop_threads', action: 'Stop -all', debugSessionActive: true }).detail, /stop_threads\(Stop -all\)/);
});
