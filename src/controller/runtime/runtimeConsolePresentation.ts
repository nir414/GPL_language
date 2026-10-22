/**
 * 런타임 콘솔(1403) 상태의 사용자 표시 라벨 정본.
 *
 * 이전에는 extension.ts와 controllerTreeProvider.ts가 같은 enum(state)에 대해
 * 서로 다른 영문 라벨을 각자 생성하여, 알림과 사이드바가 다른 문구를 보였다
 * (예: "Connected (No payload)" vs "Connected (Waiting)"). 이 모듈이 단일
 * 진실원천이며, 더 설명적인(연결 유지 의미가 분명한) 라벨로 통일한다.
 *
 * 타입만 import하므로(런타임 의존 없음) Node 단독으로 테스트 가능하다.
 */
import type { RuntimeConsoleStatusSnapshot } from './runtimeConsole';

export function formatRuntimeConsoleStateLabel(status: RuntimeConsoleStatusSnapshot): string {
    switch (status.state) {
        case 'connected':
            return 'Connected';
        case 'connected-no-payload':
            return 'Connected (Waiting)';
        case 'connecting':
            return 'Connecting';
        case 'reconnecting':
            return status.immediateEofStreak > 0 ? 'Polling' : 'Reconnecting';
        case 'connect-failed':
            return 'Connect failed';
        case 'no-payload':
            return 'No payload';
        case 'polling':
            return 'Connected (Polling)';
        case 'stopped':
            return 'Stopped';
        case 'batch-complete':
            return 'Connected (Batch complete)';
        case 'socket-error':
            return 'Socket error';
        default:
            return status.connected ? 'Connected' : 'Disconnected';
    }
}

export interface RuntimeConsoleUserMessage {
    level: 'info' | 'warning' | 'error';
    message: string;
}

/**
 * 런타임 콘솔 시작/확인 뒤 사용자에게 보일 한 줄과 알림 수준.
 * payload 수신이 확인되면 info, 소켓만 붙었거나 정상 폴링이면 info, 재연결 대기면 warning,
 * 연결 실패/소켓 에러면 error. (extension.ts activate() 에서 분리 — 2026-09-07, 동작 동일)
 */
export function buildRuntimeConsoleUserMessage(
    status: RuntimeConsoleStatusSnapshot,
    hasPayload: boolean,
    label: string,
): RuntimeConsoleUserMessage {
    const reason = status.reason || formatRuntimeConsoleStateLabel(status);
    const detail = status.detail ? ` — ${status.detail}` : '';
    if (hasPayload) {
        return { level: 'info', message: `${label} — payload 수신 확인` };
    }
    if (status.connected) {
        return { level: 'info', message: `${label} — 소켓 연결됨, payload 대기 중${detail}` };
    }
    if (status.state === 'reconnecting') {
        const isRuntimePolling = status.reason === '이벤트 대기 폴링'
            || /이벤트|빈 이벤트|Idle timeout/i.test(`${status.reason} ${status.detail ?? ''}`);
        const level = isRuntimePolling ? 'info' : 'warning';
        const suffix = isRuntimePolling ? '자동 폴링 유지 중' : '자동 재연결 대기 중';
        return { level, message: `${label} — ${reason}${detail}. ${suffix}` };
    }
    if (status.state === 'polling') {
        return { level: 'info', message: `${label} — 이벤트 큐 비어 있음, 자동 폴링 중${detail}` };
    }
    if (status.state === 'batch-complete' || status.state === 'connected-no-payload') {
        return { level: 'info', message: `${label} — ${reason}${detail}` };
    }
    if (status.state === 'connect-failed' || status.state === 'socket-error') {
        return { level: 'error', message: `${label} — ${reason}${detail}` };
    }
    return { level: 'warning', message: `${label} — ${reason}${detail}` };
}
