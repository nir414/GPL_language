/**
 * 제어기 조작 공통 절차 — 여러 명령 그룹(트리·FTP·전체 정지·AI API)이 함께 쓰는 1402 명령 보조 함수.
 *
 * - `sendCommandWithBusyRetry`: busy STATUS(-752/-742 …)와 네트워크 오류를 지수 백오프로 재시도.
 * - `verifyThreadStopped`/`verifyAllStopped`: **정지 요청 접수(STATUS 0)와 정지 완료는 다르다**(하드 규칙 §0.6) —
 *   `Show Thread` 로 settled(Idle/Stopped/Error) 를 확인한다.
 * - `trySoftEStopRecovery`: 정지가 확인되지 않을 때 사용자 확인 후 SoftEStop.
 * - `waitForThreadPause`: Break/Step 의 STATUS 0 도 "접수"일 수 있어 실제 정지 진입을 스레드 상태로 확인.
 *
 * `extension.ts` 의 activate() 클로저에서 분리(2026-09-07). 로그·알림이 필요한 함수는 host 를 첫 인자로 받는다.
 */
import * as vscode from 'vscode';
import { sendCommand, sendCommandDetailed } from '../controller/controllerConnection';
import { parseStatus, parseThreadList, SHOW_THREAD_LIST_CMD } from '../controller/responseParser';
import { isSettledState } from '../controller/threadActivity';
import { probeThreads, stopAllAndSettle, waitThreadsSettle } from '../controller/threadStop';
import type { StopAllOutcome, ThreadStopIo, ThreadStopOptions } from '../controller/threadStop';
import { isBusyStatus } from '../controller/controllerStatusCodes';
import { buildRuntimeConsoleUserMessage } from '../controller/runtimeConsolePresentation';
import type { RuntimeConsoleStatusSnapshot } from '../controller/runtimeConsole';
import type { ExtensionHost } from './host';

/**
 * 접착 계층용 `ThreadStopIo` — 전체 정지 절차(controller/threadStop.ts)에 확장의 전송·로그·대기를 물린다.
 *
 * 정지 절차 자체(전송·STATUS 판정·정지 확인 폴링·재시도)는 그 모듈이 정본이고, 여기서는 목적지만 정한다.
 * `logTo`를 주면 그 채널로(배포/FTP 진행 로그), 없으면 확장 Output(`host.log`)으로 남긴다.
 */
export function createThreadStopIo(host: ExtensionHost, logTo?: (line: string) => void): ThreadStopIo {
	return {
		send: async (command) => {
			try {
				const resp = await sendCommandDetailed(command);
				// STATUS 종결자를 못 받은 응답은 "확인 불가"다 — 정지됐다고 추정하지 않는다(하드 규칙 2).
				return { raw: resp.raw, statusComplete: resp.meta.statusTagReceived };
			} catch {
				return null;
			}
		},
		log: logTo ?? host.log,
		sleep,
	};
}

/**
 * **전체 정지의 접착 계층 진입점** — `Stop -all` + 정지 완료 확인 + 자동 재시도.
 * 패널 「전체 정지」·FTP 삭제/실행 게이트가 모두 이것을 쓴다(디버그 세션은 자체 전송을 쓰므로 모듈을 직접 부른다).
 */
export function stopAllThreads(
	host: ExtensionHost,
	opts?: ThreadStopOptions & { logTo?: (line: string) => void },
): Promise<StopAllOutcome> {
	return stopAllAndSettle(createThreadStopIo(host, opts?.logTo), opts);
}

/** 정지 계열로 간주하는 스레드 상태 (Error 포함 — 위치/변수 확인이 가능한 상태) */
export const AI_PAUSED_STATES: ReadonlySet<string> = new Set(['Paused', 'Break', 'Error']);

export function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

export async function sendCommandWithBusyRetry(
	host: ExtensionHost,
	command: string,
	options?: { maxAttempts?: number; baseDelayMs?: number },
): Promise<string> {
	const maxAttempts = Math.max(1, options?.maxAttempts ?? 4);
	const baseDelayMs = Math.max(100, options?.baseDelayMs ?? 400);
	let lastError: any;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			const resp = await sendCommand(command);
			const status = parseStatus(resp);
			if (status.code === 0) {
				return resp;
			}

			if (isBusyStatus(status.code) && attempt < maxAttempts) {
				const delay = baseDelayMs * attempt;
				host.log(`[Retry] ${command} -> STATUS ${status.code} (busy), retry in ${delay}ms (${attempt}/${maxAttempts})`);
				await sleep(delay);
				continue;
			}

			return resp;
		} catch (err: any) {
			lastError = err;
			if (attempt >= maxAttempts) { break; }
			const delay = baseDelayMs * attempt;
			host.log(`[Retry] ${command} -> network error: ${err?.message ?? err}, retry in ${delay}ms (${attempt}/${maxAttempts})`);
			await sleep(delay);
		}
	}

	throw lastError ?? new Error(`Command failed after retries: ${command}`);
}

/**
 * 지정 쓰레드가 정지될 때까지 `Show Thread` 폴링. 목록에서 사라져도 정지로 본다.
 * settled 판정은 `controller/threadActivity.isSettledState` 하나만 쓴다(집합을 여기 따로 두지 않는다).
 */
export async function verifyThreadStopped(host: ExtensionHost, threadName: string, maxAttempts = 6): Promise<boolean> {
	const io = createThreadStopIo(host);
	const target = threadName.toLowerCase();
	for (let i = 1; i <= maxAttempts; i++) {
		const probe = await probeThreads(io);
		if (probe) {
			const found = probe.threads.find(t => t.name.toLowerCase() === target);
			// 없으면 끝난 것, 있으면 상태가 정지 계열(Idle/Stopped/Error)일 때만 정지로 본다.
			if (!found || isSettledState(found.state)) { return true; }
		}
		await sleep(250 * i);
	}
	return false;
}

/**
 * 모든 쓰레드의 정지를 **관측으로** 확인한다 — 확인 불가(Show Thread 무응답)는 실패로 본다.
 *
 * 배포 경로는 확인 불가를 "경고 후 통과"로 다루지만(기존 동작 수준 유지), 이 함수를 쓰는 곳
 * (패널 전체 정지·FTP 삭제/실행 게이트)은 정지를 확인하지 못하면 **진행하지 않는** 것이 규약이다.
 * 그 차이를 `threadStop` 모듈이 `unconfirmed` 로 드러내 주므로 여기서 정책만 고른다.
 * 대기 예산은 종전의 증가 지연(300·600·900…)의 총합과 같게 맞춘다.
 */
export async function verifyAllStopped(host: ExtensionHost, maxAttempts = 6): Promise<boolean> {
	const settleTimeoutMs = 300 * ((maxAttempts * (maxAttempts + 1)) / 2);
	const outcome = await waitThreadsSettle(createThreadStopIo(host), { settleTimeoutMs });
	return outcome.settled && !outcome.unconfirmed;
}

export async function trySoftEStopRecovery(host: ExtensionHost, targetName?: string): Promise<boolean> {
	const targetLabel = targetName ? `${targetName}` : '전체 스레드';
	const choice = await vscode.window.showWarningMessage(
		`${targetLabel} 정지가 확인되지 않았어. SoftEStop을 실행해서 제어된 감속 정지를 시도할까?`,
		{ modal: true },
		'SoftEStop 실행',
		'취소',
	);
	if (choice !== 'SoftEStop 실행') {
		return false;
	}

	try {
		await sendCommandWithBusyRetry(host, 'SoftEStop', { maxAttempts: 3, baseDelayMs: 500 });
		host.log('[Recovery] SoftEStop executed');
		await sleep(800);
		const ok = targetName ? await verifyThreadStopped(host, targetName, 8) : await verifyAllStopped(host, 8);
		if (ok) {
			vscode.window.showWarningMessage(`SoftEStop 후 ${targetLabel} 정지 확인 완료`);
			return true;
		}

		vscode.window.showWarningMessage(`SoftEStop 후에도 ${targetLabel} 정지 확인이 안 됐어. 컨트롤러 상태 점검이 필요해.`);
		return false;
	} catch (err: any) {
		vscode.window.showErrorMessage(`SoftEStop 실패: ${err?.message ?? err}`);
		return false;
	}
}

/**
 * 스레드가 정지 계열 상태로 들어올 때까지 `Show Thread` 폴링.
 * `Break`/`Step`의 STATUS 0은 "접수"일 수 있어(§0.6 `Stop -all`과 같은 패턴),
 * 실제 정지 완료는 스레드 상태로 확인한다. (STATUS 의미는 실기기 실측으로 확정 전 — 방어적 처리)
 */
export async function waitForThreadPause(
	threadName: string,
	timeoutMs = 5000,
	pollIntervalMs = 150,
): Promise<{ paused: boolean; state?: string; thread?: ReturnType<typeof parseThreadList>[number] }> {
	const deadline = Date.now() + Math.max(0, timeoutMs);
	for (;;) {
		const resp = await sendCommand(SHOW_THREAD_LIST_CMD);
		const threads = parseThreadList(resp);
		const found = threads.find(t => t.name === threadName);
		if (found && AI_PAUSED_STATES.has(found.state)) {
			return { paused: true, state: found.state, thread: found };
		}
		if (Date.now() >= deadline) {
			return { paused: false, state: found?.state, thread: found };
		}
		await sleep(pollIntervalMs);
	}
}

/** 런타임 콘솔 상태를 사용자 알림으로 — 문구·수준 판정은 runtimeConsolePresentation(순수)에 있다. */
export function showRuntimeConsoleUserMessage(
	status: RuntimeConsoleStatusSnapshot,
	hasPayload: boolean,
	label: string,
): void {
	const result = buildRuntimeConsoleUserMessage(status, hasPayload, label);
	switch (result.level) {
		case 'info':
			vscode.window.showInformationMessage(result.message);
			break;
		case 'error':
			vscode.window.showErrorMessage(result.message);
			break;
		default:
			vscode.window.showWarningMessage(result.message);
			break;
	}
}
