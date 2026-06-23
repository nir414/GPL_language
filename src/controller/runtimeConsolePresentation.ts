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
