/**
 * 디버그 세션 협력자(소스 맵·변수 평가·중단점·stale 판정·폴 일정 등)가 세션을 보는 창.
 *
 * `GPLDebugSession` 이 2026-10-27 에 책임별 모듈로 나뉘면서 생겼다. 모듈은 세션 필드를 직접 만지지 않고
 * 이 인터페이스의 getter(읽기 전용)와 명령 전송·로그·DAP 이벤트 전송만 쓴다 — 세션 상태의 정본은 여전히
 * 세션 하나이고, 모듈은 vscode 없이 가짜 io 로 단위 테스트할 수 있다.
 */

import type { DebugProtocol } from '@vscode/debugprotocol';
import type { ControllerConfig } from '../../controller/connection/controllerConnection';
import type { CommandLane } from './commandLanes';
import type { ThreadInfo } from '../../controller/protocol/responseParser';

export interface DebugSessionIo {
    /** attach 에서 확정한 제어기 접속 정보(없으면 아직 attach 전). */
    readonly config: ControllerConfig | undefined;
    /** 디버그 대상 프로젝트 이름('' = 미확정). */
    readonly projectName: string;
    /** 세션이 제어기와 연결돼 있는가(disconnect·연속 폴 실패로 false). */
    readonly isConnected: boolean;
    /** 마지막으로 보낸 제어기 명령(에러 위치 이벤트의 lastCommand). */
    readonly lastControllerCommand: string;
    /** 사용자 재개 액션(step/continue/pause/entry)의 정지 확인 대기 중이면 그 종류, 아니면 null. */
    readonly pendingAction: 'step' | 'pause' | 'entry' | 'continue' | null;
    /** 마지막 정지 감지 폴의 쓰레드 목록(위치 포함). 프레임 캐시가 "같은 곳에 정지 중"인지 볼 때 쓴다. */
    readonly lastThreadList?: readonly ThreadInfo[] | null;
    /** 제어기 명령 1회(차선 큐 경유). 미연결이면 null. */
    sendCmd(command: string, lane?: CommandLane): Promise<string | null>;
    /** Debug Console 한 줄. */
    log(message: string): void;
    /** DAP 이벤트 전송. */
    sendEvent(event: DebugProtocol.Event): void;
}
