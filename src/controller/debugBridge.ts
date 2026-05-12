/**
 * Debug Bridge — GPLDebugSession이 폴링한 쓰레드 상태를 사이드바 트리에 push하는
 * 경량 이벤트 버스. TCP 추가 호출 없이 디버깅 중 쓰레드 뷰 실시간 갱신을 가능하게 한다.
 */

import * as vscode from 'vscode';
import { ThreadInfo } from './responseParser';

const _onDebugThreadsUpdated = new vscode.EventEmitter<ThreadInfo[]>();

/** 디버그 세션 폴링 결과 구독. 디버그 세션이 활성인 동안만 발생한다. */
export const onDebugThreadsUpdated: vscode.Event<ThreadInfo[]> = _onDebugThreadsUpdated.event;

/** GPLDebugSession이 Show Thread 폴링 후 호출한다. */
export function fireDebugThreadsUpdated(threads: ThreadInfo[]): void {
    _onDebugThreadsUpdated.fire(threads);
}
