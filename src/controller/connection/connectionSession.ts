/**
 * 제어기 연결 세션 상태의 정본(SSOT) — "사용자가 이 창을 제어기에 연결해 두었는가" (vscode 무의존).
 *
 * 배경(2026-10-14 실측): 연결 해제 뒤에도 제어기 대시보드 탭이 1.5 s 폴링을 계속해 1402 keep-alive 소켓을 다시 열고
 * 쥐고 있었다. 화면(상태바·트리·presence)은 모두 "해제됨"이었는데 OS 에는 Established 소켓이 남아, 다른 VS Code 창의
 * 새 1402 연결이 ECONNREFUSED 로 거부됐다. 원인은 두 가지였다.
 *  - 연결 상태를 뷰(`controllerTree.isConnected`)가 들고 있었고, `host.setControllerConnected` 가 소비자에게 손으로
 *    나눠 주는 구조라 그 목록에 없던 대시보드는 상태를 몰랐다.
 *  - 전송 계층(consoleSocket)은 연결 의도를 몰라, 해제 상태에서 누가 명령을 보내도 소켓을 보관(park)했다.
 *
 * 그래서 연결 의도를 여기 한 곳에 두고,
 *  - 쓰기는 `activation/host.setControllerConnected` 만 한다(구조 테스트 R7 이 강제).
 *  - 주기 작업(대시보드 폴링 등)은 `onControllerSessionChange` 를 구독해 스스로 멈추고 재개한다.
 *  - 전송 계층은 `effectiveKeepAlive` 로 "해제 상태에서는 1402 소켓을 보관하지 않는다"를 경로와 무관하게 보장한다.
 *    해제 상태의 명령(MCP 단발 조회, 연결 절차의 testConnection)은 막지 않고 단발 연결로만 보낸다.
 */

/** 연결 세션 상태가 바뀐 이유 — 'lost' 는 연결 건강 모니터가 확정한 유실, 'disconnect' 는 명시적 해제. */
export type ControllerSessionChangeReason = 'connect' | 'disconnect' | 'lost';

export interface ControllerSessionChange {
    connected: boolean;
    reason: ControllerSessionChangeReason;
}

export type ControllerSessionListener = (change: ControllerSessionChange) => void;

let _connected = false;
const _listeners = new Set<ControllerSessionListener>();

/** 이 창이 제어기에 연결된 상태인가(사용자 연결 의도 + 유실 판정 반영). */
export function isControllerSessionConnected(): boolean {
    return _connected;
}

/**
 * 연결 세션 상태를 바꾼다. 값이 실제로 바뀐 경우에만 구독자에게 알리고 true 를 돌려준다.
 * 호출자는 `activation/host.setControllerConnected` 하나뿐이어야 한다(R7).
 */
export function setControllerSessionConnected(connected: boolean, reason?: 'disconnect' | 'lost'): boolean {
    if (_connected === connected) { return false; }
    _connected = connected;
    const change: ControllerSessionChange = { connected, reason: connected ? 'connect' : (reason ?? 'disconnect') };
    for (const listener of [..._listeners]) {
        try { listener(change); } catch { /* 구독자 예외가 상태 전파를 막지 않게 */ }
    }
    return true;
}

/** 연결 세션 상태 변화를 구독한다. 반환값의 dispose 로 해지한다(vscode.Disposable 과 호환). */
export function onControllerSessionChange(listener: ControllerSessionListener): { dispose(): void } {
    _listeners.add(listener);
    return { dispose: () => { _listeners.delete(listener); } };
}

/**
 * 이번 명령에 1402 keep-alive(소켓 보관)를 쓸지. 설정이 켜져 있어도 연결 해제 상태면 단발 연결로 보낸다 —
 * 해제된 창이 제어기 세션을 쥐고 있으면 다른 클라이언트의 연결이 거부되기 때문이다.
 */
export function effectiveKeepAlive(settingEnabled: boolean): boolean {
    return settingEnabled && _connected;
}

/** 테스트 전용 — 모듈 상태를 초기값으로 되돌린다. */
export function resetControllerSessionForTest(): void {
    _connected = false;
    _listeners.clear();
}
