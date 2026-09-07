/**
 * 제어기 직접 조작 명령 — 포트 테스트·트래픽 모니터·임의 명령 전송·전체 정지·에러 로그·전역변수/DIO.
 */

import * as vscode from 'vscode';
import {
	formatTrafficTimestamp,
	getControllerConfig,
	getTrafficLogOptions,
	isPolicyError,
	recordTrafficLine,
	sendCommand,
	sendCommandDetailed,
	setTrafficResponseBodyEnabled,
} from '../controller/controllerConnection';
import { isBusyStatus } from '../controller/controllerStatusCodes';
import {
	SHOW_THREAD_LIST_CMD,
	extractErrorCodeFromEntry,
	getErrorCodeHint,
	isSuccess,
	parseControllerErrorEntry,
	parseStack,
	parseStatus,
	parseThreadList,
} from '../controller/responseParser';
import { sendCommandWithBusyRetry, showRuntimeConsoleUserMessage, trySoftEStopRecovery, verifyAllStopped } from './controllerOps';
import type { ExtensionHost } from './host';

async function normalizeControllerCommandInput(rawCommand: string): Promise<string | undefined> {
	const command = rawCommand.trim();
	if (!command) {
		return undefined;
	}

	if (command.startsWith('<')) {
		await vscode.window.showWarningMessage(
			'컨트롤러 명령은 XML이 아니라 plain text + CRLF 형식으로 전송됩니다. 예: Show Thread',
			'확인',
		);
		return undefined;
	}

	if (/^show\s+project\b/i.test(command)) {
		return confirmDirectorySuggestion(command,
			'Show Project는 컨트롤러 명령이 아닙니다. 프로젝트 목록은 FTP 프로젝트 경로를 Directory로 확인합니다.');
	}

	if (/^directory\s*$/i.test(command)) {
		return confirmDirectorySuggestion(command,
			'Directory는 path 인자가 필요합니다. 프로젝트 목록 확인에는 설정된 flash projects 경로를 사용합니다.');
	}

	return command;
}

/**
 * flash projects 경로 기반 `Directory ...` 명령을 제안하고 사용자의 선택을 받는다.
 * 반환: 제안 명령 / 원래 명령(그대로 실행) / undefined(취소).
 */
async function confirmDirectorySuggestion(command: string, message: string): Promise<string | undefined> {
	const projectDir = getControllerConfig().ftpFlashProjectsPath;
	const suggested = `Directory ${projectDir}`;
	const action = await vscode.window.showWarningMessage(message, suggested, '그대로 실행', '취소');
	if (action === suggested) {
		return suggested;
	}
	if (action === '그대로 실행') {
		return command;
	}
	return undefined;
}

export function activateControllerCommands(host: ExtensionHost): void {
	const { context, outputChannel, consoleChannel, trafficChannel } = host;

	// 포트 클릭 → 통신 테스트
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.pingPort', async (portType: string, ip: string, port: number) => {
			const label = portType === 'command' ? '명령 포트' : '콘솔 포트';
			const start = Date.now();

			if (portType === 'command') {
				// TCP 명령 포트: Show Thread 명령으로 왕복 측정
				try {
					const resp = await sendCommand('Show Thread', { ip, port }, 5000);
					const elapsed = Date.now() - start;
					if (resp) {
						vscode.window.showInformationMessage(`${label} (${ip}:${port}) 응답 OK — ${elapsed}ms`);
					} else {
						vscode.window.showWarningMessage(`${label} (${ip}:${port}) 응답 없음`);
					}
				} catch (err: any) {
					vscode.window.showErrorMessage(`${label} (${ip}:${port}) 실패: ${err.message ?? err}`);
				}
			} else {
				// 콘솔 포트: 런타임 콘솔 열기(항상 시작/재사용)
				// ⚠ 사용자가 "1403 포트 클릭"을 상태 확인으로 인식하는 경우가 많아
				//   토글 동작은 의도치 않은 중지를 유발한다.
				const console = host.ensureRuntimeConsole();
				await console.waitUntilReady(800);
				const hasPayload = await console.waitForPayload(1500);
				const snapshot = console.getStatusSnapshot();
				host.controllerTree?.setRuntimeConsoleStatus(snapshot);
				consoleChannel.show(true);
				showRuntimeConsoleUserMessage(snapshot, hasPayload, `${label} (${ip}:${port})`);
			}
		})
	);

	// 연결 섹션 클릭 → 트래픽 모니터 열기
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.showTraffic', () => {
			trafficChannel.show(true);
		})
	);

	// 1402 응답 본문 표시(GPL Traffic ` | ` 라인) 켜기/끄기 — 트리 '1402 통신 모니터' 항목 설명도 갱신
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.toggleTrafficResponseBody', async () => {
			const next = !getTrafficLogOptions().responseBody;
			await setTrafficResponseBodyEnabled(next);
			const marker = `[${formatTrafficTimestamp()}] --- 1402 응답 본문 표시: ${next ? 'ON' : 'OFF'}`;
			trafficChannel.appendLine(marker);
			recordTrafficLine(marker);
			host.controllerTree?.redraw();
			vscode.window.setStatusBarMessage(`GPL Traffic: 1402 응답 본문 표시 ${next ? '켬' : '끔'}`, 3000);
		})
	);

	// GPL Traffic 채널 비우기 (실시간 관찰 시작 전 정리용)
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.clearTraffic', () => {
			trafficChannel.clear();
			const marker = `[${formatTrafficTimestamp()}] --- (cleared)`;
			trafficChannel.appendLine(marker);
			recordTrafficLine(marker);
		})
	);

	// 설정 UI에서 바꿔도 트리 항목 설명이 따라오도록
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('gpl.controller.trafficLogResponseBody') ||
				e.affectsConfiguration('gpl.controller.trafficLogMaxResponseChars')) {
				host.controllerTree?.redraw();
			}
			if (e.affectsConfiguration('gpl.agentBridge.enabled') ||
				e.affectsConfiguration('gpl.controller.ip') ||
				e.affectsConfiguration('gpl.controller.port')) {
				host.ensureAgentBridge();
			}
		})
	);

	// 제어기에 임의 명령 전송.
	// 인자를 주면 비대화형(입력 상자 없음)으로 실행하고 결과를 반환한다 — MCP/Agent Bridge·URI·스크립트가 확장의
	// 1402 세션(직렬 큐·keep-alive·명령 정책)을 그대로 쓰게 하는 진입점(§1-BQ). 인자 없으면 종전 대화형.
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.sendCommand', async (args?: unknown) => {
			const argCommand = typeof args === 'string'
				? args
				: typeof (args as { command?: unknown })?.command === 'string'
					? (args as { command: string }).command
					: undefined;
			if (argCommand !== undefined) {
				const command = argCommand.trim();
				if (!command) { return { ok: false, error: 'missing-command' }; }
				if (command.startsWith('<')) {
					return { ok: false, error: 'xml-command', detail: '제어기 명령은 XML이 아니라 plain text + CRLF로 보냅니다. 예: Show Thread' };
				}
				const timeoutMs = typeof (args as { timeoutMs?: unknown })?.timeoutMs === 'number'
					? Math.max(1000, Math.floor((args as { timeoutMs: number }).timeoutMs)) : undefined;
				try {
					const detailed = await sendCommandDetailed(command, undefined, {
						timeoutMs,
						// 컴파일처럼 pass 사이에 침묵하는 명령은 종결자까지 기다려야 STATUS/에러 라인을 놓치지 않는다.
						waitForStatusClose: (args as { waitForStatusClose?: boolean })?.waitForStatusClose === true || /^compile\b/i.test(command),
					});
					const status = parseStatus(detailed.raw);
					outputChannel.appendLine(`[Command] >>> ${command} (agent)`);
					// 외부(MCP·URI·에이전트)가 원시 명령으로 건 `Set Break`/`Nobreak`를 에디터에도 반영한다
					// (§1-CO). in-process 호출자(DAP·EditorBreakpointSync)는 이 명령을 거치지 않으므로
					// 여기서만 미러가 걸린다. 임시 BP는 호출 측이 `mirrorBreakpoints: false`로 제외한다.
					const mirror = status.code === 0
						&& (args as { mirrorBreakpoints?: boolean })?.mirrorBreakpoints !== false
						? host.breakpointMirror.applyCommand(command)
						: undefined;
					return {
						ok: status.code === 0,
						command,
						status,
						raw: detailed.raw,
						statusTagReceived: detailed.meta.statusTagReceived,
						...(mirror && mirror.reason !== 'not-breakpoint-command'
							? { editorBreakpoint: mirror.mirrored ? 'updated' : mirror.reason }
							: {}),
					};
				} catch (err: any) {
					return isPolicyError(err)
						? { ok: false, error: 'policy-hold', code: err.code, detail: err.message, sentToController: false, command }
						: { ok: false, error: 'command-failed', detail: err?.message ?? String(err), command };
				}
			}
			const cmd = await vscode.window.showInputBox({
				prompt: '제어기에 보낼 명령을 입력하세요',
				placeHolder: 'Show Thread, ErrorLog, Directory /flash/projects, …',
			});
			if (!cmd) { return undefined; }
			const normalizedCommand = await normalizeControllerCommandInput(cmd);
			if (!normalizedCommand) { return undefined; }
			try {
				const resp = await sendCommand(normalizedCommand);
				outputChannel.appendLine(`[Command] >>> ${normalizedCommand}`);
				outputChannel.appendLine(resp);
				outputChannel.show(true);
				// 손으로 친 `Set Break`/`Nobreak`도 에디터에 반영한다 — 콘솔로 걸었다는 이유로
				// 빨간 점 없이 제어기에만 남는 중단점을 만들지 않는다(§1-CO).
				if (isSuccess(resp)) { host.breakpointMirror.applyCommand(normalizedCommand); }
			} catch (err: any) {
				vscode.window.showErrorMessage(`명령 실패: ${err.message ?? err}`);
			}
			return undefined;
		})
	);

	// 전체 정지 (Stop -all)
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.stopAll', async () => {
			try {
				const stopResp = await sendCommandWithBusyRetry(host, 'Stop -all', { maxAttempts: 5, baseDelayMs: 500 });
				const status = parseStatus(stopResp);
				if (status.code !== 0 && !isBusyStatus(status.code)) {
					vscode.window.showErrorMessage(`전체 정지 실패: STATUS ${status.code} ${status.message}`);
					return;
				}

				const stopped = await verifyAllStopped(host, 8);
				if (stopped) {
					vscode.window.showWarningMessage('전체 정지 완료 (Stop -all)');
				} else {
					const recovered = await trySoftEStopRecovery(host);
					if (!recovered) {
						vscode.window.showWarningMessage('Stop -all 전송됨. 제어기 바쁨/재시작으로 정지 확인이 지연되고 있습니다. 상태를 다시 확인해줘.');
					}
				}
				host.controllerTree?.refresh();
			} catch (err: any) {
				vscode.window.showErrorMessage(`전체 정지 실패: ${err.message ?? err}`);
			}
		})
	);

	// 명령 ID 별칭: gpl.stopAll -> gpl.controller.stopAll
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.stopAll', async () => {
			await vscode.commands.executeCommand('gpl.controller.stopAll');
		})
	);

	// 콘솔 토글 (시작/중지)
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.consoleToggle', () => {
			if (host.runtimeConsole?.isConnected) {
				host.runtimeConsole.stop();
				host.controllerTree?.setRuntimeConsoleStatus(host.runtimeConsole.getStatusSnapshot());
				vscode.window.showInformationMessage('런타임 콘솔 중지');
			} else {
				const console = host.ensureRuntimeConsole();
				host.controllerTree?.setRuntimeConsoleStatus(console.getStatusSnapshot());
				consoleChannel.show(true);
				vscode.window.showInformationMessage('런타임 콘솔 시작');
			}
		})
	);

	// 에러 로그 초기화
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.clearErrors', async () => {
			try {
				await sendCommand('ErrorLog -clear');
				vscode.window.showInformationMessage('에러 로그 초기화 완료');
				host.controllerTree?.refresh();
			} catch (err: any) {
				vscode.window.showErrorMessage(`에러 로그 초기화 실패: ${err.message ?? err}`);
			}
		})
	);

	// 에러 항목 복사
	// inline view/item/context 명령은 VS Code가 TreeItem 자체를 arg[0]으로 주입하므로
	// 문자열 직접 전달과 TreeItem 객체 전달 두 경우 모두 처리한다.
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.copyError', async (arg: unknown) => {
			let text: string;
			if (typeof arg === 'string') {
				text = arg;
			} else if (arg && typeof (arg as { label?: unknown }).label === 'string') {
				text = (arg as { label: string }).label;
			} else {
				return;
			}
			if (!text) { return; }
			await vscode.env.clipboard.writeText(text);
			vscode.window.showInformationMessage('에러 텍스트가 클립보드에 복사되었습니다.');
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.showErrorDetail', async (arg: unknown) => {
			const payload = (arg && typeof arg === 'object')
				? (arg as { raw?: string; code?: number; category?: string })
				: {};
			const raw = (payload.raw || '').trim();
			const parsed = raw ? parseControllerErrorEntry(raw) : null;
			const code = typeof payload.code === 'number'
				? payload.code
				: (parsed?.code ?? extractErrorCodeFromEntry(raw));
			const hint = typeof code === 'number' ? getErrorCodeHint(code) : undefined;

			let errorThreadName = host.lastRuntimeErrorContext?.threadName || '';
			let stackLines: string[] = host.lastRuntimeErrorContext?.stackFrames ? [...host.lastRuntimeErrorContext.stackFrames] : [];
			if (!errorThreadName) {
				try {
					const showThreadResp = await sendCommand(SHOW_THREAD_LIST_CMD);
					const threads = parseThreadList(showThreadResp);
					const thread = threads.find(t => t.state === 'Error') || threads.find(t => t.state === 'Break' || t.state === 'Paused');
					if (thread) {
						errorThreadName = thread.name;
					}
				} catch {
					// ignore detail fetch failures
				}
			}

			if (errorThreadName && stackLines.length === 0) {
				try {
					const stackResp = await sendCommand(`Show Stack ${errorThreadName}`);
					stackLines = parseStack(stackResp)
						.slice(0, 8)
						.map(f => `${f.process || '(unknown)'} @ ${f.file || '?'}:${f.fileLine || 0}`);
				} catch {
					// ignore stack read failures
				}
			}

			const relatedFunctions = stackLines
				.map(line => line.split('@')[0].trim())
				.filter(Boolean)
				.filter((v, idx, arr) => arr.indexOf(v) === idx)
				.slice(0, 6);

			const recentLines = host.recentDebugLogLines.slice(-10);

			const lines: string[] = [];
			lines.push('## 오류 상세');
			lines.push(`- 원문: ${raw || '(없음)'}`);
			lines.push(`- 코드: ${typeof code === 'number' ? code : '(미상)'}`);
			lines.push(`- 분류: ${payload.category || hint?.category || '(미상)'}`);
			lines.push(`- 에러 스레드: ${errorThreadName || '(미확인)'}`);
			lines.push(`- 직전 실행 명령: ${host.lastRuntimeErrorContext?.lastCommand || '(미확인)'}`);
			lines.push(`- 첫 에러 시각: ${parsed?.timestamp || host.lastRuntimeErrorContext?.firstSeenAt || '(미확인)'}`);
			if (hint) {
				lines.push(`- 해석: ${hint.title} — ${hint.meaning}`);
				lines.push(`- 권장: ${hint.action}`);
			}
			if (code === -782) {
				lines.push('- -782 후보: 초기화 안 된 필드, 생성자 누락, getter에서 Nothing 반환 경로 점검');
			}

			lines.push('');
			lines.push('### 호출 경로/프레임');
			if (stackLines.length === 0) {
				lines.push('- (스택 정보 없음)');
			} else {
				for (const s of stackLines) { lines.push(`- ${s}`); }
			}

			lines.push('');
			lines.push('### 관련 함수');
			if (relatedFunctions.length === 0) {
				lines.push('- (식별 실패)');
			} else {
				for (const fn of relatedFunctions) { lines.push(`- ${fn}`); }
			}

			lines.push('');
			lines.push('### 직전 로그 (최근 10줄)');
			if (recentLines.length === 0) {
				lines.push('- (로그 없음)');
			} else {
				for (const l of recentLines) { lines.push(`- ${l}`); }
			}

			outputChannel.show(true);
			host.log('');
			host.log('── [오류 상세 보기] ────────────────────────────────────');
			for (const line of lines) {
				host.log(line);
			}
			host.log('─────────────────────────────────────────────────────────');
		})
	);
	// 전역변수 보기/편집 — Show Global → (편집) Execute name = value, project
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.showGlobal', async () => {
			const varName = await vscode.window.showInputBox({ prompt: '조회할 전역변수 이름', placeHolder: '예: GPL.i1, Robot.Speed' });
			if (!varName) { return; }
			const proj = host.controllerTree?.getExpectedProjectName?.() || '';
			try {
				const cmd = proj ? `Show Global ${varName}, ${proj}` : `Show Global ${varName}`;
				const resp = await sendCommand(cmd);
				outputChannel.appendLine(`[Global] >>> ${cmd}`);
				outputChannel.appendLine(resp || '(empty)');
				outputChannel.show(true);
				const cleaned = (resp || '').replace(/<[^>]+>/g, '').trim();
				const action = await vscode.window.showInformationMessage(`${varName} = ${cleaned || '(빈 응답)'}`, '값 편집', '닫기');
				if (action === '값 편집') {
					const newVal = await vscode.window.showInputBox({ prompt: `${varName}에 설정할 값`, placeHolder: '예: 123, "text", 12.5' });
					if (newVal === undefined) { return; }
					const setExpr = `${varName} = ${newVal}`;
					const setCmd = proj ? `Execute ${setExpr}, ${proj}` : `Execute ${setExpr}`;
					const setResp = await sendCommand(setCmd);
					outputChannel.appendLine(`[Global] >>> ${setCmd}`);
					outputChannel.appendLine(setResp || '(empty)');
					const st = parseStatus(setResp);
					if (st.code === 0) { vscode.window.showInformationMessage(`${varName} 설정 완료`); host.controllerTree?.refresh?.(); }
					else { vscode.window.showWarningMessage(`설정 결과 STATUS ${st.code}: ${st.message}`); }
				}
			} catch (err: any) {
				vscode.window.showErrorMessage(`전역변수 조회 실패: ${err.message ?? err}`);
			}
		})
	);

	// DIO 조회 — Show DIO [signals]
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.showDio', async () => {
			const input = await vscode.window.showInputBox({ prompt: 'Show DIO — 조회할 신호 번호(쉼표 구분, 비우면 전체)', placeHolder: '예: 13, 14, 10001 (비우면 전체)' });
			if (input === undefined) { return; }
			const arg = input.trim() ? ` ${input.trim()}` : '';
			try {
				const resp = await sendCommand(`Show DIO${arg}`);
				outputChannel.appendLine(`[DIO] >>> Show DIO${arg}`);
				outputChannel.appendLine(resp || '(empty)');
				outputChannel.show(true);
			} catch (err: any) {
				vscode.window.showErrorMessage(`DIO 조회 실패: ${err.message ?? err}`);
			}
		})
	);

	// Set DIO — 출력 강제 (안전 확인 모달)
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.setDio', async (presetSignal?: number) => {
			const signalStr = typeof presetSignal === 'number'
				? String(presetSignal)
				: await vscode.window.showInputBox({ prompt: 'Set DIO — 신호 번호', placeHolder: '예: 13' });
			if (!signalStr) { return; }
			const signal = parseInt(String(signalStr), 10);
			if (Number.isNaN(signal)) { vscode.window.showWarningMessage('유효한 신호 번호가 아닙니다.'); return; }
			const pick = await vscode.window.showQuickPick(
				[
					{ label: '$(circle-filled) 강제 ON (force on)', value: '1' },
					{ label: '$(circle-outline) 강제 OFF (force off)', value: '-1' },
					{ label: '$(clear-all) 강제 해제 (clear force)', value: '0' },
				],
				{ placeHolder: `신호 ${signal} — Set DIO 동작 선택 (장비 출력에 영향)` }
			);
			if (!pick) { return; }
			const confirm = await vscode.window.showWarningMessage(
				`Set DIO ${signal} ${pick.value} 실행 — 디지털 신호가 강제되어 장비가 동작할 수 있습니다. 계속할까요?`,
				{ modal: true },
				'실행',
			);
			if (confirm !== '실행') { return; }
			try {
				const cmd = `Set DIO ${signal} ${pick.value}`;
				const resp = await sendCommand(cmd);
				outputChannel.appendLine(`[DIO] >>> ${cmd}`);
				outputChannel.appendLine(resp || '(empty)');
				outputChannel.show(true);
				const st = parseStatus(resp);
				if (st.code === 0) { vscode.window.showInformationMessage(`Set DIO ${signal} 적용됨`); }
				else { vscode.window.showWarningMessage(`Set DIO 결과 STATUS ${st.code}: ${st.message}`); }
			} catch (err: any) {
				vscode.window.showErrorMessage(`Set DIO 실패: ${err.message ?? err}`);
			}
		})
	);
}
