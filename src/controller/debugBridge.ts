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

// ─── 1403 이벤트 → 즉시 폴 트리거 ───────────────────────

const _onDebugPollTrigger = new vscode.EventEmitter<void>();

/**
 * 1403 런타임 콘솔이 데이터를 수신했을 때 구독. 제어기 상태 변경(스텝 완료, 중단점 도달 등)
 * 신호로 활용해 폴링 타이머 대기 없이 즉시 Show Thread를 트리거한다.
 */
export const onDebugPollTrigger: vscode.Event<void> = _onDebugPollTrigger.event;

/** extension.ts가 1403 데이터 수신 시 호출. 활성 디버그 세션에 즉시 폴을 요청한다. */
export function fireDebugPollTrigger(): void {
    _onDebugPollTrigger.fire();
}
