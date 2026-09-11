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
import { parseStatus } from '../controller/responseParser';
import type { ThreadInfo } from '../controller/responseParser';
import { isPausedState, isSettledState } from '../controller/threadActivity';
import { probeThreads, stopAllAndSettle, stopThreadAndSettle, waitThreadsSettle } from '../controller/threadStop';
import type { StopAllOutcome, ThreadStopIo, ThreadStopOptions } from '../controller/threadStop';
import { isBusyStatus } from '../controller/controllerStatusCodes';
import { buildRuntimeConsoleUserMessage } from '../controller/runtimeConsolePresentation';
import type { RuntimeConsoleStatusSnapshot } from '../controller/runtimeConsole';
import type { ExtensionHost } from './host';

/**
 * 접착 계층용 `ThreadStopIo` — 전체 정지 절차(controller/threadStop.ts)에 확장의 전송·로그·대기를 물린다.
 *
 * 정지 절차 자체(전송·STATUS 판정·정지 확인 폴링·재시도)는 그 모듈이 정본이고, 여기서는 목적지만 정한다.
 * 진행 로그의 목적지(`log`)만 호출부가 정한다 — 확장 Output(`host.log`), FTP 실행 로그, 또는 버림.
 */
export function createThreadStopIo(log: (line: string) => void): ThreadStopIo {
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
		log,
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
	return stopAllAndSettle(createThreadStopIo(opts?.logTo ?? host.log), opts);
}

/**
 * **개별 쓰레드 정지 + 사용자 안내** — 트리의 「쓰레드 정지」와 FTP 폴더 「중지」가 함께 쓴다.
 *
 * 두 명령은 문구만 다르고 절차(Stop → 정지 확인 → 실패 시 SoftEStop 제안 → 트리 새로고침)가 같아
 * 같은 코드가 두 벌 있었다(2026-09-10 §1-DD). 정지 절차 자체는 controller/threadStop.ts 가 맡고,
 * 여기서는 그 결과를 알림으로 옮기는 일만 한다.
 *
 * @param label 사용자에게 보일 대상 이름(쓰레드명·프로젝트명).
 */
export async function stopThreadWithRecovery(host: ExtensionHost, threadName: string, label = threadName): Promise<boolean> {
	const outcome = await stopThreadAndSettle(createThreadStopIo(host.log), threadName, { logPrefix: `[Stop ${label}] ` });
	if (outcome.send.kind === 'failed') {
		const code = outcome.send.statusCode;
		vscode.window.showErrorMessage(`${label} 정지 실패: ${code === undefined ? '' : `STATUS ${code} `}${outcome.send.message}`);
		host.controllerTree?.refresh();
		return false;
	}
	// 확인 불가(Show Thread 무응답)를 "정지됨"으로 보고하지 않는다 — SoftEStop 안내 경로로 보낸다.
	const stopped = outcome.ok && outcome.settle?.unconfirmed !== true;
	if (stopped) {
		vscode.window.showInformationMessage(`${label} 정지 완료`);
	} else if (!(await trySoftEStopRecovery(host, threadName))) {
		vscode.window.showWarningMessage(`${label} 정지 명령은 전송됐지만 아직 실행 중일 수 있습니다. 잠시 후 다시 확인하세요.`);
	}
	host.controllerTree?.refresh();
	return stopped;
}

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
	const io = createThreadStopIo(host.log);
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
	const outcome = await waitThreadsSettle(createThreadStopIo(host.log), { settleTimeoutMs });
	return outcome.settled && !outcome.unconfirmed;
}

export async function trySoftEStopRecovery(host: ExtensionHost, targetName?: string): Promise<boolean> {
	const targetLabel = targetName ? `${targetName}` : '전체 스레드';
	// 모달은 VS Code 가 취소 버튼을 자동으로 붙인다 — '취소' 를 항목으로 넘기면 버튼이 두 개가 된다.
	const choice = await vscode.window.showWarningMessage(
		`${targetLabel} 정지가 확인되지 않았습니다. SoftEStop으로 제어된 감속 정지를 시도할까요?`,
		{ modal: true },
		'SoftEStop 실행',
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

		vscode.window.showWarningMessage(`SoftEStop 후에도 ${targetLabel} 정지가 확인되지 않았습니다. 제어기 상태를 점검하세요.`);
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
): Promise<{ paused: boolean; state?: string; thread?: ThreadInfo }> {
	// 폴링 로그는 남기지 않는다 — Break/Step 마다 Output 에 수십 줄이 쌓인다.
	const io = createThreadStopIo(() => { /* no log */ });
	const target = threadName.trim().toLowerCase();
	const deadline = Date.now() + Math.max(0, timeoutMs);
	let last: ThreadInfo | undefined;
	for (;;) {
		// probeThreads 는 잘린 응답(STATUS 미수신)을 null 로 준다 — 종전 구현은 그것을 "쓰레드 없음"으로
		// 읽어 조용히 계속 폴링했다(§1-DD). 확인 불가는 그냥 다음 폴로 넘긴다.
		const probe = await probeThreads(io);
		if (probe) {
			last = probe.threads.find(t => t.name.trim().toLowerCase() === target);
			if (last && isPausedState(last.state)) {
				return { paused: true, state: last.state, thread: last };
			}
		}
		if (Date.now() >= deadline) {
			return { paused: false, state: last?.state, thread: last };
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
