import test from 'node:test';
import assert from 'node:assert/strict';
import { isFtpTimeoutMessage, isUploadTimeoutFailure, uploadTimeoutRecovery } from '../src/deployRecovery.js';

test('업로드 단계의 FTP 타임아웃만 재시도 금지 복구로 바뀐다', () => {
  const msg = '/GPL 목록 조회 실패: Timeout (control socket) — /flash/projects로 폴백하지 않고 업로드를 중단합니다.';
  assert.equal(isUploadTimeoutFailure('UPLOAD', msg), true);
  assert.equal(isUploadTimeoutFailure('UPLOAD', '550 DELE failed.'), false);
  assert.equal(isUploadTimeoutFailure('COMPILE', msg), false);
  assert.equal(isFtpTimeoutMessage('connect ETIMEDOUT 192.168.0.1:21'), true);
  assert.equal(isFtpTimeoutMessage(undefined), false);
});

test('복구 지시: 재시도 금지 + controller_status 로 먼저 관측', () => {
  const r = uploadTimeoutRecovery();
  assert.equal(r.action, 'CHECK_OPERATION');
  assert.equal(r.retryCurrentCommand, false);
  assert.equal(r.safeToRepeat, false);
  assert.equal(r.retryable, false);
  assert.match(r.detail, /곧바로 다시 보내지 말 것/);
  assert.match(r.detail, /controller_status/);
});
