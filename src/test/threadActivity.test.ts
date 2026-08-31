import * as assert from 'assert';
import { test } from './harness';
import {
    describeThreadActivity,
    executeThreadProject,
    isControllerIdle,
    isProjectRunning,
    isSettledState,
    projectThreads,
    threadBelongsToProject,
    ThreadLike,
} from '../controller/threadActivity';

const t = (name: string, state = 'Running', project = ''): ThreadLike => ({ name, state, project });

test('threadActivity: 빈 목록만 완전 정지', () => {
    assert.strictEqual(isControllerIdle([]), true);
    assert.strictEqual(isControllerIdle([t('MergeCode', 'Idle')]), false);
    assert.strictEqual(isControllerIdle([t('MergeCode', 'Stopped')]), false);
});

test('threadActivity: project 컬럼으로 소속 판정', () => {
    assert.strictEqual(threadBelongsToProject(t('worker1', 'Running', 'MergeCode'), 'MergeCode'), true);
    assert.strictEqual(threadBelongsToProject(t('worker1', 'Running', 'Other'), 'MergeCode'), false);
});

test('threadActivity: 기본 이름 규칙(쓰레드명 = 프로젝트명)', () => {
    assert.strictEqual(threadBelongsToProject(t('MergeCode'), 'MergeCode'), true);
});

test('threadActivity: 대소문자를 구분하지 않는다(GPL 규칙)', () => {
    assert.strictEqual(threadBelongsToProject(t('mergecode'), 'MergeCode'), true);
    assert.strictEqual(threadBelongsToProject(t('x', 'Running', 'MERGECODE'), 'MergeCode'), true);
});

test('threadActivity: Execute 쓰레드 `_Cmd_<project>`도 그 프로젝트로 본다', () => {
    assert.strictEqual(executeThreadProject('_Cmd_MergeCode'), 'MergeCode');
    assert.strictEqual(executeThreadProject('_cmd_MergeCode'), 'MergeCode');
    assert.strictEqual(executeThreadProject('MergeCode'), undefined);
    assert.strictEqual(executeThreadProject('_Cmd_'), undefined);
    assert.strictEqual(threadBelongsToProject(t('_Cmd_MergeCode', 'Running', ''), 'MergeCode'), true);
});

test('threadActivity: 프로젝트 동작 판정 — 정지 계열 상태도 존재하면 동작 중', () => {
    assert.strictEqual(isProjectRunning([t('MergeCode', 'Idle')], 'MergeCode'), true);
    assert.strictEqual(isProjectRunning([t('MergeCode', 'Error')], 'MergeCode'), true);
    assert.strictEqual(isProjectRunning([t('Other', 'Running', 'Other')], 'MergeCode'), false);
    assert.strictEqual(isProjectRunning([], 'MergeCode'), false);
});

test('threadActivity: 빈 프로젝트명은 어떤 쓰레드에도 소속되지 않는다(오탐 방지)', () => {
    assert.strictEqual(threadBelongsToProject(t('MergeCode'), ''), false);
    assert.strictEqual(isProjectRunning([t('MergeCode')], '   '), false);
});

test('threadActivity: projectThreads는 소속 쓰레드만 추린다', () => {
    const list = [t('MergeCode'), t('_Cmd_MergeCode'), t('other', 'Running', 'Other')];
    assert.deepStrictEqual(projectThreads(list, 'MergeCode').map(x => x.name), ['MergeCode', '_Cmd_MergeCode']);
});

test('threadActivity: isSettledState는 idle/stopped/error만', () => {
    assert.strictEqual(isSettledState('Idle'), true);
    assert.strictEqual(isSettledState('stopped'), true);
    assert.strictEqual(isSettledState('Error'), true);
    assert.strictEqual(isSettledState('Running'), false);
    assert.strictEqual(isSettledState('Stopping'), false);
    assert.strictEqual(isSettledState('Paused'), false);
    assert.strictEqual(isSettledState(undefined), false);
});

test('threadActivity: 설명 문구는 Execute 쓰레드와 "정지 계열이지만 존재"를 밝힌다', () => {
    assert.strictEqual(describeThreadActivity([]), '');
    const desc = describeThreadActivity([t('_Cmd_MergeCode', 'Idle')]);
    assert.ok(desc.includes('Execute 쓰레드(MergeCode)'), desc);
    assert.ok(desc.includes('동작 중으로 판정'), desc);
    const running = describeThreadActivity([t('MergeCode', 'Running')]);
    assert.ok(!running.includes('동작 중으로 판정'), running);
});
