import * as assert from 'assert';
import { test } from './harness';
import { pendingPollDelayMs, formatResumeTiming, DEFAULT_CONTINUE_FAST_WINDOW_MS } from '../debug/pollSchedule';

const base = { pendingSinceMs: 10_000, backupPollMs: 1000, continueFastWindowMs: DEFAULT_CONTINUE_FAST_WINDOW_MS };

test('pollSchedule: step/pause/entry 는 정지 확인까지 백업 폴 간격을 유지한다', () => {
    for (const pendingAction of ['step', 'pause', 'entry'] as const) {
        assert.strictEqual(pendingPollDelayMs({ ...base, pendingAction, nowMs: 12_000 }), 1000, pendingAction);
        assert.strictEqual(pendingPollDelayMs({ ...base, pendingAction, nowMs: 10_000 + 10 * 60_000 }), 1000, `${pendingAction} (오래 걸려도)`);
    }
});

test('pollSchedule: continue 는 창 안에서만 백업 폴, 창이 지나면 일반 정책(null)', () => {
    assert.strictEqual(pendingPollDelayMs({ ...base, pendingAction: 'continue', nowMs: 10_000 + 19_999 }), 1000);
    assert.strictEqual(pendingPollDelayMs({ ...base, pendingAction: 'continue', nowMs: 10_000 + 20_000 }), null);
});

test('pollSchedule: pending 이 없으면 null, 백업 간격은 1ms 하한', () => {
    assert.strictEqual(pendingPollDelayMs({ ...base, pendingAction: null, nowMs: 10_000 }), null);
    assert.strictEqual(pendingPollDelayMs({ ...base, pendingAction: 'step', nowMs: 10_000, backupPollMs: 0 }), 1);
});

test('pollSchedule: 타이밍 요약은 명령·큐 대기·감지 구간을 한 줄로 적는다', () => {
    const line = formatResumeTiming(
        { kind: 'Step', threadName: 'Main', requestedAt: 1000, queueWaitMs: 3, commandMs: 14, commandDoneAt: 1017, polls: 2 },
        1092, '1403',
    );
    assert.strictEqual(line, '⏱ Step 총 92ms — 명령 14ms(큐 대기 3ms) · 정지 감지 +75ms(1403 트리거, 폴 2회)');
    const noCmd = formatResumeTiming({ kind: 'Continue', threadName: 'Main', requestedAt: 1000, polls: 1 }, 1500, 'pending');
    assert.strictEqual(noCmd, '⏱ Continue 총 500ms — 명령 ? · 정지 감지 +500ms(대기 백업 폴, 폴 1회)');
});
