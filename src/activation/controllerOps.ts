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
import { sendCommand } from '../controller/controllerConnection';
import { parseStatus, parseThreadList, SHOW_THREAD_LIST_CMD } from '../controller/responseParser';
import { isBusyStatus } from '../controller/controllerStatusCodes';
import { buildRuntimeConsoleUserMessage } from '../controller/runtimeConsolePresentation';
import type { RuntimeConsoleStatusSnapshot } from '../controller/runtimeConsole';
import type { ExtensionHost } from './host';

// settled(비활성) 쓰레드 상태 집합 — deployService.threadSettled와 동일하게 유지할 것
const SETTLED_THREAD_STATE = /^(idle|stopped|error)$/i;

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

export async function verifyThreadStopped(host: ExtensionHost, threadName: string, maxAttempts = 6): Promise<boolean> {
	const target = threadName.toLowerCase();
	for (let i = 1; i <= maxAttempts; i++) {
		try {
			const resp = await sendCommandWithBusyRetry(host, SHOW_THREAD_LIST_CMD, { maxAttempts: 2, baseDelayMs: 250 });
			const threads = parseThreadList(resp);
			const found = threads.find(t => t.name.toLowerCase() === target);
			if (!found) {
				return true;
			}

			// settled 판정은 deployService.threadSettled와 동일 집합(Idle/Stopped/Error).
			// 'stopp' 부분 일치는 'Stopped'(정지 완료)까지 활성으로 오판했다 —
			// 집합 밖 상태(Running/Stopping 등)만 활성으로 본다.
			const state = (found.state || '').toString().trim();
			if (SETTLED_THREAD_STATE.test(state)) {
				return true;
			}
		} catch {
			// transient failure: continue polling window
		}

		await sleep(250 * i);
	}

	return false;
}

export async function verifyAllStopped(host: ExtensionHost, maxAttempts = 6): Promise<boolean> {
	for (let i = 1; i <= maxAttempts; i++) {
		try {
			const resp = await sendCommandWithBusyRetry(host, SHOW_THREAD_LIST_CMD, { maxAttempts: 2, baseDelayMs: 250 });
			const threads = parseThreadList(resp);
			if (threads.length === 0) {
				return true;
			}

			// verifyThreadStopped와 동일한 settled 집합 — 'Stopped'를 활성으로 오판하지 않는다.
			const hasActive = threads.some(t => !SETTLED_THREAD_STATE.test((t.state || '').toString().trim()));
			if (!hasActive) {
				return true;
			}
		} catch {
			// transient failure: retry within window
		}

		await sleep(300 * i);
	}

	return false;
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
