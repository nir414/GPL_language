import test from 'node:test';
import assert from 'node:assert/strict';
import { deployTargetArgs, projectForCommand, resolveUnloadTarget } from '../src/configuredTarget.js';

test('명시 프로젝트나 세션 대상만 사용한다', () => {
  assert.deepEqual(projectForCommand('MergeCode', null), { ok: true, project: 'MergeCode' });
  assert.deepEqual(projectForCommand(undefined, { project: 'GenAdp' }), { ok: true, project: 'GenAdp' });
});

test('대상이 없으면 영구 기본값으로 폴백하지 않는다', () => {
  const result = projectForCommand(undefined, null);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'PROJECT_TARGET_REQUIRED');
  assert.match(result.detail, /project_target/);
});

test('명시 프로젝트는 세션 대상보다 우선한다', () => {
  const target = { project: 'MergeCode', dir: 'C:\\Sample Prep\\Dilution\\MergeCode', verified: true };
  assert.deepEqual(projectForCommand('Other', target), { ok: true, project: 'Other' });
});

test('deploy 대상: 명시 projectDir에는 세션의 다른 프로젝트 이름을 섞지 않는다', () => {
  const session = { project: 'COM_Probe', dir: 'C:\\Sample Prep\\COM_Probe', verified: true };
  assert.deepEqual(
    deployTargetArgs({ projectDir: 'C:\\Sample Prep\\V2\\Lib' }, session),
    { project: undefined, projectDir: 'C:\\Sample Prep\\V2\\Lib', projectFile: undefined },
  );
});

test('deploy 대상: 명시 이름과 무인자 호출은 각각 이름만·세션 이름+폴더를 보낸다', () => {
  const session = { project: 'COM_Probe', dir: 'C:\\Sample Prep\\COM_Probe', verified: true };
  assert.deepEqual(
    deployTargetArgs({ project: 'Other' }, session),
    { project: 'Other', projectDir: undefined, projectFile: undefined },
  );
  assert.deepEqual(
    deployTargetArgs({}, session),
    { project: 'COM_Probe', projectDir: 'C:\\Sample Prep\\COM_Probe', projectFile: undefined },
  );
});

test('resolveUnloadTarget: 인자 없으면 세션 대상, 없으면 거부 — -all 은 명시할 때만', () => {
  const pinned = { project: 'App', via: 'extension' };
  assert.deepEqual(resolveUnloadTarget({}, pinned), { ok: true, all: false, name: 'App', targetSource: 'session-target' });
  assert.deepEqual(resolveUnloadTarget({}, { project: 'App', via: 'deploy' }),
    { ok: true, all: false, name: 'App', targetSource: 'session-target-from-deploy' });
  const none = resolveUnloadTarget({}, null);
  assert.equal(none.ok, false);
  assert.equal(none.error, 'UNLOAD_TARGET_REQUIRED');
  assert.equal(resolveUnloadTarget({ project: '  ' }, null).error, 'UNLOAD_TARGET_REQUIRED');
});

test('resolveUnloadTarget: 명시 이름은 세션 대상보다 우선, all:true·"-all" 은 전체', () => {
  const pinned = { project: 'App', via: 'extension' };
  assert.deepEqual(resolveUnloadTarget({ project: 'Lib' }, pinned), { ok: true, all: false, name: 'Lib', targetSource: 'argument' });
  assert.deepEqual(resolveUnloadTarget({ all: true }, pinned), { ok: true, all: true, name: '-all', targetSource: 'all-argument' });
  assert.deepEqual(resolveUnloadTarget({ project: '-ALL' }, null), { ok: true, all: true, name: '-all', targetSource: 'all-argument' });
  assert.deepEqual(resolveUnloadTarget({ project: '-all', all: true }, null), { ok: true, all: true, name: '-all', targetSource: 'all-argument' });
  assert.equal(resolveUnloadTarget({ project: 'App', all: true }, pinned).error, 'UNLOAD_TARGET_CONFLICT');
});
