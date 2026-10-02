import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfiguredTarget, projectForCommand } from '../src/configuredTarget.js';

test('legacy 설정은 종전 기본값을 유지하고 빈 값은 MergeCode로 폴백하지 않는다', () => {
  assert.equal(projectForCommand(undefined, null, readConfiguredTarget({})).project, 'MergeCode');
  assert.equal(projectForCommand(undefined, null, readConfiguredTarget({ GPL_PROJECT: '' })).error, 'PROJECT_TARGET_REQUIRED');
});

test('Export 대상은 명시 이름으로도 폴더 확인을 우회하지 못한다', () => {
  const configured = readConfiguredTarget({ GPL_PROJECT: 'MergeCode', GPL_PROJECT_DIR: 'C:\\Sample Prep\\Dilution\\MergeCode' });
  for (const explicit of [undefined, 'MergeCode', 'GenAdp']) {
    const result = projectForCommand(explicit, null, configured);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'PROJECT_TARGET_REQUIRED');
  }
});

test('미확정 Export도 대상 확인을 요구하고 확인 후 고정된 이름을 사용한다', () => {
  const configured = readConfiguredTarget({ GPL_PROJECT: '', GPL_PROJECT_DIR: '' });
  assert.equal(projectForCommand('MergeCode', { project: 'MergeCode', verified: false }, configured).ok, false);
  const target = { project: 'MergeCode', dir: 'C:\\Sample Prep\\Dilution\\MergeCode', verified: true };
  assert.deepEqual(projectForCommand(undefined, target, configured), { ok: true, project: 'MergeCode' });
  assert.equal(projectForCommand('Other', target, configured).ok, false);
});

test('target clear 후에는 다시 폴더 확인을 요구한다', () => {
  const configured = readConfiguredTarget({ GPL_PROJECT: 'GenAdp', GPL_PROJECT_DIR: 'C:\\GenAdp' });
  assert.equal(projectForCommand(undefined, { project: 'GenAdp', dir: 'C:\\GenAdp', verified: true }, configured).ok, true);
  assert.equal(projectForCommand(undefined, null, configured).ok, false);
});
