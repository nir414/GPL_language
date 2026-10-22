import * as assert from 'assert';
import { test } from './harness';
import { isErrorMarkStale, isStoppedMarkStale, RuntimeStateSnapshot } from '../controller/executionMarks';
import { ThreadLike } from '../controller/threadActivity';

// ─── 실행 위치 강조 유효성 (ai-handoff §1-EP, 2026-10-14) ──────────────────────────────
// 에러 난 쓰레드를 재시작해 에러가 사라진 뒤에도 붉은 줄이 남던 문제 — "주인 쓰레드가 아직 그 상태인가"로 판정.

const t = (name: string, state: string): ThreadLike => ({ name, state, project: 'MergeCode' });
const snap = (threads: ThreadLike[], errorCount = 0): RuntimeStateSnapshot => ({ threads, errorCount });

test('executionMarks: 주인 쓰레드가 Error 로 남아 있으면 에러 줄 유지', () => {
    assert.strictEqual(isErrorMarkStale({ threadName: 'MergeCode' }, snap([t('MergeCode', 'Error')], 1)), false);
    // ErrorLog 가 비어도 쓰레드가 Error 면 유지(로그 초기화와 무관하게 그 위치에 서 있다)
    assert.strictEqual(isErrorMarkStale({ threadName: 'MergeCode' }, snap([t('MergeCode', 'Error')], 0)), false);
});

test('executionMarks: 주인 쓰레드가 재시작(Running)·정지(Idle)·소멸하면 에러 줄 해제', () => {
    const owner = { threadName: 'MergeCode' };
    assert.strictEqual(isErrorMarkStale(owner, snap([t('MergeCode', 'Running')], 1)), true);
    assert.strictEqual(isErrorMarkStale(owner, snap([t('MergeCode', 'Idle')])), true);
    assert.strictEqual(isErrorMarkStale(owner, snap([t('LOG_SOCKET', 'Running')])), true);
    assert.strictEqual(isErrorMarkStale(owner, snap([])), true);
});

test('executionMarks: 쓰레드 이름은 대소문자 무시, 다른 쓰레드의 Error 는 주인 판정에 영향 없음', () => {
    assert.strictEqual(isErrorMarkStale({ threadName: 'mergecode' }, snap([t('MergeCode', 'Error')])), false);
    assert.strictEqual(isErrorMarkStale({ threadName: 'MergeCode' }, snap([t('MergeCode', 'Running'), t('Other', 'Error')])), true);
});

test('executionMarks: 주인을 모르는 에러 줄은 Error 쓰레드도 ErrorLog 도 없을 때만 해제', () => {
    assert.strictEqual(isErrorMarkStale({}, snap([t('MergeCode', 'Running')], 0)), true);
    assert.strictEqual(isErrorMarkStale({}, snap([], 0)), true);
    assert.strictEqual(isErrorMarkStale({}, snap([t('MergeCode', 'Running')], 2)), false);
    assert.strictEqual(isErrorMarkStale({}, snap([t('Other', 'Error')], 0)), false);
});

test('executionMarks: 정지 줄은 주인이 Paused/Break/Error 인 동안 유지, 떠나면 해제', () => {
    const owner = { threadName: 'MergeCode' };
    for (const state of ['Paused', 'Break', 'Error']) {
        assert.strictEqual(isStoppedMarkStale(owner, snap([t('MergeCode', state)])), false, state);
    }
    assert.strictEqual(isStoppedMarkStale(owner, snap([t('MergeCode', 'Running')])), true);
    assert.strictEqual(isStoppedMarkStale(owner, snap([t('MergeCode', 'Stopped')])), true);
    assert.strictEqual(isStoppedMarkStale(owner, snap([])), true);
});

test('executionMarks: 주인을 모르는 정지 줄은 정지 쓰레드가 하나도 없을 때 해제', () => {
    assert.strictEqual(isStoppedMarkStale({}, snap([t('Other', 'Break')])), false);
    assert.strictEqual(isStoppedMarkStale({}, snap([t('MergeCode', 'Running')])), true);
    assert.strictEqual(isStoppedMarkStale({}, snap([])), true);
});
