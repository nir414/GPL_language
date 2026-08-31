import * as assert from 'assert';
import { test } from './harness';
import {
    isAllThreadsResumeRequest,
    resolveExecutionThread,
    shouldPreserveFocus,
} from '../debug/threadLock';

/** 픽스처: 제어기에 세 스레드(Main=1, Aux=2, Vision=3)가 있는 상태. */
const THREADS = new Map<string, number>([
    ['Main', 1],
    ['Aux', 2],
    ['Vision', 3],
]);

test('threadLock: 잠금 없음 → 요청 스레드 그대로', () => {
    const d = resolveExecutionThread({ lockedName: undefined, requestedThreadId: 2, threadNameToId: THREADS });
    assert.strictEqual(d.targetThreadId, 2);
    assert.strictEqual(d.redirected, false);
    assert.strictEqual(d.staleLock, false);
    assert.strictEqual(d.lockedName, undefined);
});

test('threadLock: 빈 문자열도 잠금 없음으로 취급', () => {
    const d = resolveExecutionThread({ lockedName: '', requestedThreadId: 3, threadNameToId: THREADS });
    assert.strictEqual(d.targetThreadId, 3);
    assert.strictEqual(d.redirected, false);
});

test('threadLock: 잠긴 스레드와 요청이 같으면 되돌림 없음', () => {
    const d = resolveExecutionThread({ lockedName: 'Main', requestedThreadId: 1, threadNameToId: THREADS });
    assert.strictEqual(d.targetThreadId, 1);
    assert.strictEqual(d.redirected, false);
    assert.strictEqual(d.lockedName, 'Main');
});

test('threadLock: 다른 스레드 요청은 잠긴 스레드로 되돌린다', () => {
    const d = resolveExecutionThread({ lockedName: 'Main', requestedThreadId: 3, threadNameToId: THREADS });
    assert.strictEqual(d.targetThreadId, 1);
    assert.strictEqual(d.redirected, true);
    assert.strictEqual(d.lockedName, 'Main');
    assert.strictEqual(d.staleLock, false);
});

test('threadLock: 잠긴 스레드가 사라지면 stale — 요청 그대로 두고 해제 신호', () => {
    const d = resolveExecutionThread({ lockedName: 'Gone', requestedThreadId: 2, threadNameToId: THREADS });
    assert.strictEqual(d.targetThreadId, 2);
    assert.strictEqual(d.redirected, false);
    assert.strictEqual(d.staleLock, true);
    assert.strictEqual(d.lockedName, 'Gone');
});

test('threadLock: 스레드 목록이 비어 있어도 요청을 그대로 통과(stale)', () => {
    const d = resolveExecutionThread({ lockedName: 'Main', requestedThreadId: 7, threadNameToId: new Map() });
    assert.strictEqual(d.targetThreadId, 7);
    assert.strictEqual(d.staleLock, true);
});

test('threadLock: 포커스 보존 — 잠금 없으면 항상 false', () => {
    assert.strictEqual(shouldPreserveFocus(undefined, 'Aux'), false);
});

test('threadLock: 포커스 보존 — 잠긴 스레드 자신의 정지는 포커스를 준다', () => {
    assert.strictEqual(shouldPreserveFocus('Main', 'Main'), false);
});

test('threadLock: 포커스 보존 — 다른 스레드의 정지는 포커스를 훔치지 않는다', () => {
    assert.strictEqual(shouldPreserveFocus('Main', 'Aux'), true);
});

test('threadLock: 포커스 보존 — 정지 스레드 이름을 모르면 기본 동작(false)', () => {
    assert.strictEqual(shouldPreserveFocus('Main', undefined), false);
});

test('threadLock: singleThread 인자 해석 — 명시적 false 만 전체 재개 요청', () => {
    assert.strictEqual(isAllThreadsResumeRequest(false), true);
    assert.strictEqual(isAllThreadsResumeRequest(true), false);
    assert.strictEqual(isAllThreadsResumeRequest(undefined), false);
});
