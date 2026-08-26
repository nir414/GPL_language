import * as assert from 'assert';
import { test } from './harness';
import { shouldGateStepRequest, StepGateInput } from '../debug/stepGate';

/** 기본: pending 없음, 마지막 재개 1초 전, 최소 간격 100ms → 허용되는 상태. 필요한 필드만 덮어쓴다. */
function input(overrides: Partial<StepGateInput> = {}): StepGateInput {
    return {
        pendingAction: null,
        pendingThreadId: undefined,
        requestThreadId: 1,
        lastResumeAt: 10_000,
        now: 11_000,
        minIntervalMs: 100,
        ...overrides,
    };
}

test('stepGate: 같은 쓰레드의 pending step → gate (pending-same-thread)', () => {
    assert.strictEqual(
        shouldGateStepRequest(input({ pendingAction: 'step', pendingThreadId: 1, requestThreadId: 1 })),
        'pending-same-thread',
    );
});

test('stepGate: 같은 쓰레드의 pending continue → gate', () => {
    assert.strictEqual(
        shouldGateStepRequest(input({ pendingAction: 'continue', pendingThreadId: 1, requestThreadId: 1 })),
        'pending-same-thread',
    );
});

test('stepGate: 다른 쓰레드에 대한 요청은 pending step 중에도 허용', () => {
    assert.strictEqual(
        shouldGateStepRequest(input({ pendingAction: 'step', pendingThreadId: 1, requestThreadId: 2 })),
        null,
    );
});

test('stepGate: pending entry 는 쓰레드와 무관하게 gate (pending-entry)', () => {
    assert.strictEqual(
        shouldGateStepRequest(input({ pendingAction: 'entry', pendingThreadId: undefined, requestThreadId: 7 })),
        'pending-entry',
    );
});

test('stepGate: pending pause 는 게이트하지 않는다 (Break 뒤 Continue 허용)', () => {
    assert.strictEqual(
        shouldGateStepRequest(input({ pendingAction: 'pause', pendingThreadId: 1, requestThreadId: 1 })),
        null,
    );
});

test('stepGate: 최소 간격 미달 → gate (min-interval)', () => {
    assert.strictEqual(
        shouldGateStepRequest(input({ lastResumeAt: 10_000, now: 10_031, minIntervalMs: 100 })),
        'min-interval',
    );
});

test('stepGate: 간격이 정확히 최소값이면 허용 (경계: < 만 gate)', () => {
    assert.strictEqual(
        shouldGateStepRequest(input({ lastResumeAt: 10_000, now: 10_100, minIntervalMs: 100 })),
        null,
    );
});

test('stepGate: pending 없음 + 간격 충족 → 허용', () => {
    assert.strictEqual(shouldGateStepRequest(input()), null);
});

test('stepGate: minIntervalMs 0 이면 간격을 무시한다', () => {
    assert.strictEqual(
        shouldGateStepRequest(input({ lastResumeAt: 10_000, now: 10_000, minIntervalMs: 0 })),
        null,
    );
});

test('stepGate: 아직 재개한 적 없으면(lastResumeAt 0) 간격 판정을 생략한다', () => {
    assert.strictEqual(
        shouldGateStepRequest(input({ lastResumeAt: 0, now: 50, minIntervalMs: 100 })),
        null,
    );
});

test('stepGate: pending 판정이 간격 판정보다 우선한다', () => {
    // 간격은 충족(1초 경과)이지만 같은 쓰레드 pending step → 사유는 pending 쪽
    assert.strictEqual(
        shouldGateStepRequest(input({ pendingAction: 'step', pendingThreadId: 3, requestThreadId: 3 })),
        'pending-same-thread',
    );
    // 간격 미달 + entry → entry 가 우선
    assert.strictEqual(
        shouldGateStepRequest(input({ pendingAction: 'entry', lastResumeAt: 10_000, now: 10_010 })),
        'pending-entry',
    );
});
