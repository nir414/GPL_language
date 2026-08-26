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

// ─── 1403 런타임 콘솔 건강 상태 공급 (GitHub #22) ───────────────

/**
 * 1403 런타임 콘솔의 건강 상태 요약. 디버그 세션이 Running 쓰레드 백업 폴 간격을 정할 때 참조한다:
 * alive 면 정지/BP 히트는 1403 트리거가 먼저 알려주므로 백업 폴을 사용자 간격(threadPollIntervalMs)으로
 * 완화하고, 아니면 gpl.debug.runningBackupPollMs 로 촘촘히 폴링한다.
 * (배경: 1Hz 백업 폴이 부팅 후 77분간 Show Thread -web 922회를 만들었다 — GitHub #22 '5번째 다운' 제안 2)
 *
 * alive 판정은 공급자(extension.ts)가 runtimeConsole.getStatusSnapshot() 으로 한다:
 * state 가 'idle' | 'stopped' | 'connect-failed' | 'socket-error' 가 아니고
 * (lastConnectAt 또는 lastPayloadAt) 이 60초 이내.
 */
export interface RuntimeConsoleHealth {
    alive: boolean;
    state: string;
    lastConnectAt?: number;
    lastPayloadAt?: number;
}

let _runtimeConsoleHealthProvider: (() => RuntimeConsoleHealth | undefined) | undefined;

/** extension.ts 가 공급자를 등록한다(undefined 로 해제). 디버그 세션은 매 백업 폴 스케줄 시점에 호출한다. */
export function setRuntimeConsoleHealthProvider(
    fn: (() => RuntimeConsoleHealth | undefined) | undefined,
): void {
    _runtimeConsoleHealthProvider = fn;
}

/** 현재 1403 건강 상태. 공급자가 없거나 예외를 내면 undefined(호출측은 '1403 부재'로 취급). */
export function getRuntimeConsoleHealth(): RuntimeConsoleHealth | undefined {
    try {
        return _runtimeConsoleHealthProvider?.();
    } catch {
        return undefined;
    }
}
