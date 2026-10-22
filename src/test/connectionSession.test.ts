import * as assert from 'assert';
import { test } from './harness';
import {
    ControllerSessionChange,
    effectiveKeepAlive,
    isControllerSessionConnected,
    onControllerSessionChange,
    resetControllerSessionForTest,
    setControllerSessionConnected,
} from '../controller/connectionSession';

test('connectionSession: 초기값은 해제 상태', () => {
    resetControllerSessionForTest();
    assert.strictEqual(isControllerSessionConnected(), false);
});

test('connectionSession: 값이 바뀔 때만 구독자에게 알리고 사유를 붙인다', () => {
    resetControllerSessionForTest();
    const seen: ControllerSessionChange[] = [];
    onControllerSessionChange(c => seen.push(c));
    assert.strictEqual(setControllerSessionConnected(true), true);
    assert.strictEqual(setControllerSessionConnected(true), false, '같은 값은 무시');
    assert.strictEqual(setControllerSessionConnected(false, 'lost'), true);
    setControllerSessionConnected(true);
    setControllerSessionConnected(false);
    assert.deepStrictEqual(seen, [
        { connected: true, reason: 'connect' },
        { connected: false, reason: 'lost' },
        { connected: true, reason: 'connect' },
        { connected: false, reason: 'disconnect' },
    ]);
});

test('connectionSession: dispose 뒤에는 알림이 오지 않고, 구독자 예외가 전파를 막지 않는다', () => {
    resetControllerSessionForTest();
    let late = 0;
    const sub = onControllerSessionChange(() => { late++; });
    onControllerSessionChange(() => { throw new Error('boom'); });
    let after = 0;
    onControllerSessionChange(() => { after++; });
    setControllerSessionConnected(true);
    sub.dispose();
    setControllerSessionConnected(false);
    assert.strictEqual(late, 1);
    assert.strictEqual(after, 2, '예외를 던진 구독자 뒤의 구독자도 받는다');
});

// 2026-10-14 회귀: 해제 상태의 명령(대시보드 폴링·MCP 단발 조회)이 1402 소켓을 보관하면 다른 창의 연결이 거부됐다.
test('connectionSession: 해제 상태에서는 설정과 무관하게 keep-alive 를 쓰지 않는다', () => {
    resetControllerSessionForTest();
    assert.strictEqual(effectiveKeepAlive(true), false);
    setControllerSessionConnected(true);
    assert.strictEqual(effectiveKeepAlive(true), true);
    assert.strictEqual(effectiveKeepAlive(false), false, '설정이 꺼져 있으면 연결 중에도 단발');
    setControllerSessionConnected(false, 'lost');
    assert.strictEqual(effectiveKeepAlive(true), false);
    resetControllerSessionForTest();
});
