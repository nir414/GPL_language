import * as assert from 'assert';
import { test } from './harness';
import { buildRuntimeConsoleUserMessage, formatRuntimeConsoleStateLabel } from '../controller/runtimeConsolePresentation';
import type { RuntimeConsoleStatusSnapshot } from '../controller/runtimeConsole';

function snap(partial: Partial<RuntimeConsoleStatusSnapshot>): RuntimeConsoleStatusSnapshot {
    return {
        state: 'idle',
        connected: false,
        reason: '',
        noPayloadStreak: 0,
        immediateEofStreak: 0,
        lastChangedAt: 0,
        ...partial,
    } as RuntimeConsoleStatusSnapshot;
}

test('runtimeConsole 메시지: payload 를 받았으면 상태와 무관하게 info + "payload 수신 확인"', () => {
    const r = buildRuntimeConsoleUserMessage(snap({ state: 'connect-failed', reason: 'ECONNREFUSED' }), true, '콘솔');
    assert.deepStrictEqual(r, { level: 'info', message: '콘솔 — payload 수신 확인' });
});

test('runtimeConsole 메시지: 소켓만 붙었으면 info + payload 대기(detail 포함)', () => {
    const r = buildRuntimeConsoleUserMessage(snap({ state: 'connected-no-payload', connected: true, detail: '3 s' }), false, '콘솔');
    assert.strictEqual(r.level, 'info');
    assert.strictEqual(r.message, '콘솔 — 소켓 연결됨, payload 대기 중 — 3 s');
});

test('runtimeConsole 메시지: reconnecting 은 이벤트 대기 폴링이면 info, 그 외는 warning', () => {
    const polling = buildRuntimeConsoleUserMessage(snap({ state: 'reconnecting', reason: '이벤트 대기 폴링' }), false, 'L');
    assert.strictEqual(polling.level, 'info');
    assert.ok(polling.message.endsWith('자동 폴링 유지 중'), polling.message);
    const failing = buildRuntimeConsoleUserMessage(snap({ state: 'reconnecting', reason: 'ECONNRESET' }), false, 'L');
    assert.strictEqual(failing.level, 'warning');
    assert.ok(failing.message.endsWith('자동 재연결 대기 중'), failing.message);
});

test('runtimeConsole 메시지: connect-failed / socket-error 는 error', () => {
    for (const state of ['connect-failed', 'socket-error'] as const) {
        const r = buildRuntimeConsoleUserMessage(snap({ state, reason: 'x' }), false, 'L');
        assert.strictEqual(r.level, 'error', state);
    }
});

test('runtimeConsole 메시지: reason 이 비면 상태 라벨 정본(formatRuntimeConsoleStateLabel)을 쓴다', () => {
    const s = snap({ state: 'stopped', reason: '' });
    const r = buildRuntimeConsoleUserMessage(s, false, 'L');
    assert.strictEqual(r.message, `L — ${formatRuntimeConsoleStateLabel(s)}`);
    assert.strictEqual(r.level, 'warning');
});
