/**
 * 제어기 직접 조작 명령 — 포트 테스트·트래픽 모니터·임의 명령 전송·전체 정지·에러 로그·전역변수/DIO.
 */

import * as vscode from 'vscode';
import {
	formatTrafficTimestamp,
	getControllerConfig,
	getTrafficLogOptions,
	isPolicyError,
	isCleanlyTerminated,
	recordTrafficLine,
	sendCommand,
	sendCommandDetailed,
	setTrafficResponseBodyEnabled,
} from '../controller/connection/controllerConnection';
import {
	SHOW_THREAD_LIST_CMD,
	extractErrorCodeFromEntry,
	getErrorCodeHint,
	isSuccess,
	parseControllerErrorEntry,
	parseStack,
	parseStatus,
	parseThreadList,
} from '../controller/protocol/responseParser';
import { getGplErrorGroup } from '../controller/protocol/responseParser';
import type { ErrorCodeCategory } from '../controller/protocol/responseParser';
import { probeThreads } from '../controller/threads/threadStop';
import { isSettledState } from '../controller/threads/threadActivity';
import { createFileSourceLookup, diagnoseStuckThread } from '../controller/threads/threadStuckDiagnosis';
import { buildTargetCandidates, projectNameOf, readGprProjectStart } from '../controller/projects/projectPicker';
import { describeStartProcedureMismatch } from '../controller/commands/startProcedureCheck';
import { renderErrorReport } from '../controller/diagnostics/errorReport';
import { asThreadNode } from '../controller/threads/threadArgs';
import { formatAgentCommandFailure, formatAgentCommandLines } from '../controller/automation/agentCommandLog';
import { buildSetDioCommand, describeDioForce, DioForceValue } from '../controller/io/dio';
import { EXTENSION_VERSION } from '../config';
import { isStopAllCommand } from '../controller/deployment/deployCancellation';
import { createThreadStopIo, requestActiveDeployCancellation, showRuntimeConsoleUserMessage, stopAllThreads, trySoftEStopRecovery } from './controllerOps';
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
			const marker = `[${formatTrafficTimestamp()}] --- 명령 콘솔 응답 본문 표시: ${next ? 'ON' : 'OFF'}`;
			trafficChannel.appendLine(marker);
			recordTrafficLine(marker);
			host.controllerTree?.redraw();
			vscode.window.setStatusBarMessage(`GPL Traffic: 명령 콘솔 응답 본문 표시 ${next ? '켬' : '끔'}`, 3000);
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
				const cancellations = isStopAllCommand(command)
					? requestActiveDeployCancellation(host, '원시 명령 Stop -all 요청')
					: [];
				try {
					const detailed = await sendCommandDetailed(command, undefined, {
						timeoutMs,
						// 컴파일처럼 pass 사이에 침묵하는 명령은 종결자까지 기다려야 STATUS/에러 라인을 놓치지 않는다.
						waitForStatusClose: (args as { waitForStatusClose?: boolean })?.waitForStatusClose === true || /^compile\b/i.test(command),
					});
					const status = parseStatus(detailed.raw);
					// 사람이 보낸 명령처럼 응답까지 Output 에 남긴다(§1-EO) — 본문 상한은 GPL Traffic 과 같은 설정.
					for (const line of formatAgentCommandLines(
						{ command, raw: detailed.raw, statusCode: status.code, durationMs: detailed.meta.durationMs },
						{ maxChars: getTrafficLogOptions().maxResponseChars },
					)) { outputChannel.appendLine(line); }
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
						...(cancellations.length > 0 ? { cancelledOperationIds: cancellations.map(item => item.operationId) } : {}),
						...(mirror && mirror.reason !== 'not-breakpoint-command'
							? { editorBreakpoint: mirror.mirrored ? 'updated' : mirror.reason }
							: {}),
					};
				} catch (err: any) {
					if (err?.code === 'LOW_MEMORY' || err?.code === 'MEMORY_UNVERIFIED') {
						outputChannel.appendLine(formatAgentCommandFailure(command, err.code, err.message));
						return { ok: false, error: err.code, detail: err.message, precheck: err.precheck, sentToController: false, command };
					}
					const policy = isPolicyError(err);
					outputChannel.appendLine(formatAgentCommandFailure(command, policy ? 'policy-hold' : 'command-failed', err?.message ?? String(err)));
					return policy
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
			if (isStopAllCommand(normalizedCommand)) {
				requestActiveDeployCancellation(host, '명령 팔레트 Stop -all 요청');
			}
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
				const cancellations = requestActiveDeployCancellation(host, 'GPL 전체 정지 요청');
				// 전송·STATUS 판정·정지 확인 폴링·자동 재시도는 controller/threads/threadStop.ts 가 한다(§1-DD).
				// -752(정지 진행 중)는 실패가 아니라는 판정도 그 안에 있다 — 여기서는 결과만 사용자에게 옮긴다.
				const outcome = await stopAllThreads(host, { logTo: line => host.log(`[Stop] ${line}`) });
				if (outcome.send.kind === 'failed') {
					const code = outcome.send.statusCode;
					vscode.window.showErrorMessage(`전체 정지 실패: ${code === undefined ? '' : `STATUS ${code} `}${outcome.send.message}`);
					return;
				}

				// 확인 불가(Show Thread 무응답)는 "정지됨"으로 단정하지 않는다 — SoftEStop 안내 경로로 보낸다.
				const stopped = outcome.ok && outcome.settle?.unconfirmed !== true;
				if (stopped) {
					vscode.window.showWarningMessage(cancellations.length > 0
						? '전체 정지 완료 (Stop -all) — 진행 중이던 업로드/배포도 취소 요청됨'
						: '전체 정지 완료 (Stop -all)');
				} else {
					const recovered = await trySoftEStopRecovery(host);
					if (!recovered) {
						vscode.window.showWarningMessage('Stop -all 전송됨. 제어기 바쁨/재시작으로 정지 확인이 지연되고 있습니다. 상태를 다시 확인하세요.');
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

	// 정지 불가 쓰레드 진단 (읽기 전용) — Stop/Break 가 -752 만 돌려줄 때 "왜 안 멈추는지"를 캔다.
	// 배포 실패 경로는 자동으로 같은 진단을 남기고(deployService), 이 명령은 그 밖에서 손으로 부르는 입구다.
	// 복구 명령은 **만들어 보여 주기만** 한다 — 대상 식별이 정적 분석이라 사람의 확인이 필요하고,
	// Execute 는 임의 GPL 문장 실행 경로다(ai-handoff §3, 2026-09-10 실측).
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.diagnoseStuckThread', async (arg?: unknown) => {
			try {
				const io = createThreadStopIo(line => outputChannel.appendLine(line));
				const probe = await probeThreads(io);
				if (!probe) {
					vscode.window.showWarningMessage('Show Thread 응답을 받지 못했습니다 — 제어기 연결을 확인하세요.');
					return;
				}
				const active = probe.threads.filter(t => !isSettledState(t.state));
				if (active.length === 0) {
					vscode.window.showInformationMessage('활성 쓰레드가 없습니다 — 진단할 대상이 없습니다.');
					return;
				}

				// 팔레트는 인자 없음, 트리 우클릭은 TreeItem(`node.thread.name`), 자동화는 문자열로 부른다.
				let target = typeof arg === 'string'
					? arg
					: (arg as { thread?: { name?: string } } | undefined)?.thread?.name;
				if (!target && active.length === 1) { target = active[0].name; }
				if (!target) {
					const picked = await vscode.window.showQuickPick(
						active.map(t => ({
							label: t.name,
							description: `${t.state}${t.file ? ` @ ${t.file}:${t.fileLine ?? '?'}` : ''}`,
						})),
						{ placeHolder: '진단할 쓰레드를 선택하세요' },
					);
					if (!picked) { return; }
					target = picked.label;
				}

				// 소스 탐색 범위: 그 쓰레드의 프로젝트와 이름이 같은 워크스페이스 프로젝트를 우선한다.
				// 같은 이름의 프로젝트가 여러 벌 복제된 배치가 실제로 있어서(중첩 워크스페이스), 못 좁히면
				// 전체 후보로 넓히되 엉뚱한 사본을 집을 수 있음을 리포트가 아니라 탐색 범위로만 흡수한다.
				const info = active.find(t => t.name.trim().toLowerCase() === target!.trim().toLowerCase());
				const allCandidates = await buildTargetCandidates();
				const owner = (info?.project ?? '').trim().toLowerCase();
				const matched = owner ? allCandidates.filter(c => c.projectName.trim().toLowerCase() === owner) : [];
				const searchDirs = (matched.length > 0 ? matched : allCandidates).map(c => c.dir);

				outputChannel.show(true);
				const diagnosis = await diagnoseStuckThread(io, target, createFileSourceLookup(searchDirs));

				if (diagnosis.candidates.length === 0) {
					vscode.window.showInformationMessage(`정지 불가 진단 완료: ${target} — 출력 패널을 확인하세요.`);
					return;
				}
				const pick = await vscode.window.showWarningMessage(
					`${target}: 복구 후보 ${diagnosis.candidates.length}건을 만들었습니다. 전송하지 않았습니다 — 확인 후 직접 보내세요.`,
					'첫 후보 복사',
					'출력 보기',
				);
				if (pick === '첫 후보 복사') {
					await vscode.env.clipboard.writeText(diagnosis.candidates[0].command);
					vscode.window.showInformationMessage('복사했습니다. 디버그 콘솔에서는 앞에 `>` 를 붙여 보내세요.');
				} else if (pick === '출력 보기') {
					outputChannel.show(true);
				}
			} catch (err: any) {
				vscode.window.showErrorMessage(`정지 불가 진단 실패: ${err?.message ?? err}`);
			}
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

	// ── 오류 상세 — 재료 수집(접착) + 렌더(controller/diagnostics/errorReport, 순수) ──────────────────────────
	// 「오류 상세 보기」(Output + 위치 이동)와 「에러 복사」(클립보드)가 **같은 재료·같은 줄**을 쓴다(§1-EA).
	// 종전 복사는 트리 항목 툴팁(쓰레드 행 4~6줄, 에러 항목 1~3줄)만 담아 스택·시각·분류·직전 사건이 빠졌다.
	interface ErrorDetailPayload {
		raw?: string;
		code?: number;
		category?: ErrorCodeCategory;
		groupTitle?: string;
		threadName?: string;
		/** 재료가 없을 때 종전처럼 복사할 텍스트(툴팁/라벨) — 추정 체인 항목 등. */
		fallbackText?: string;
	}

	/**
	 * 트리 노드(InfoNode/ThreadNode)·문자열·payload 객체를 하나의 payload 로 정규화한다.
	 * view/item/context 명령은 VS Code 가 트리 **요소**(우리 노드 객체)를 arg[0] 으로 준다.
	 */
	function toErrorDetailPayload(arg: unknown): ErrorDetailPayload {
		if (typeof arg === 'string') {
			return parseControllerErrorEntry(arg) ? { raw: arg } : { fallbackText: arg };
		}
		if (!arg || typeof arg !== 'object') { return {}; }
		const o = arg as {
			raw?: unknown; code?: unknown; category?: unknown; groupTitle?: unknown;
			thread?: { name?: unknown; lastStatus?: unknown };
			command?: { arguments?: unknown[] };
			tooltip?: unknown; label?: unknown;
		};
		// 에러 항목 노드: 클릭 명령 인자에 payload 가 실려 있다.
		const cmdArg = o.command?.arguments?.[0];
		if (cmdArg && typeof cmdArg === 'object' && ('raw' in (cmdArg as object) || 'code' in (cmdArg as object))) {
			return cmdArg as ErrorDetailPayload;
		}
		// payload 객체가 직접 온 경우(명령 인자).
		if (typeof o.raw === 'string' || typeof o.code === 'number') {
			return { raw: o.raw as string | undefined, code: o.code as number | undefined, category: o.category as ErrorCodeCategory | undefined, groupTitle: o.groupTitle as string | undefined };
		}
		// 쓰레드 노드(Error 쓰레드 행).
		const tn = asThreadNode(arg);
		if (tn?.thread?.name) {
			const status = typeof o.thread?.lastStatus === 'string' ? o.thread.lastStatus : '';
			const m = /^\s*(-?\d+)/.exec(status);
			return { threadName: tn.thread.name, code: m ? Number(m[1]) : undefined };
		}
		const text = typeof o.tooltip === 'string' && o.tooltip.trim() ? o.tooltip : typeof o.label === 'string' ? o.label : '';
		return text ? { fallbackText: text } : {};
	}

	interface GatheredErrorReport {
		lines: string[];
		location?: { file: string; line: number; procedure?: string };
		threadName?: string;
	}

	/** 1402 읽기 명령(Show Thread/Show Stack)·.gpr·링버퍼에서 재료를 모아 보고서 줄을 만든다. 실패한 조회는 "(미확인)" 으로 남는다. */
	async function gatherErrorReport(payload: ErrorDetailPayload): Promise<GatheredErrorReport> {
		const raw = (payload.raw || '').trim();
		const parsed = raw ? parseControllerErrorEntry(raw) : null;
		const code = typeof payload.code === 'number'
			? payload.code
			: (parsed?.code ?? extractErrorCodeFromEntry(raw));
		const hint = typeof code === 'number' ? getErrorCodeHint(code) : undefined;
		const group = typeof code === 'number' ? getGplErrorGroup(code) : undefined;
		const category: ErrorCodeCategory = payload.category ?? hint?.category ?? group?.category ?? 'unknown';
		const groupTitle = payload.groupTitle ?? group?.title;

		// 쓰레드 — 지정된 이름 > 디버그 이벤트가 알려 준 에러 쓰레드 > 목록에서 Error/Break/Paused 첫 항목.
		let threadName = payload.threadName || host.lastRuntimeErrorContext?.threadName || '';
		let thread: ReturnType<typeof parseThreadList>[number] | undefined;
		try {
			const threads = parseThreadList(await sendCommand(SHOW_THREAD_LIST_CMD));
			thread = threadName ? threads.find(t => t.name === threadName) : undefined;
			if (!thread) {
				thread = threads.find(t => t.state === 'Error') || threads.find(t => t.state === 'Break' || t.state === 'Paused');
				if (thread) { threadName = thread.name; }
			}
		} catch {
			// 목록 조회 실패 — 쓰레드 상태는 (미확인) 으로 남긴다.
		}

		// 스택 — 디버그 이벤트가 같은 쓰레드의 프레임을 남겼으면 그것, 아니면 Show Stack, 그것도 없으면 목록의 위치.
		const ctx = host.lastRuntimeErrorContext;
		let stackLines: string[] = ctx && ctx.threadName === threadName && ctx.stackFrames ? [...ctx.stackFrames] : [];
		let stackComplete = false;
		let location: GatheredErrorReport['location'];
		if (threadName && stackLines.length === 0) {
			try {
				const stackRaw = await sendCommand(`Show Stack ${threadName}`);
				const frames = parseStack(stackRaw);
				stackComplete = isCleanlyTerminated(stackRaw) && isSuccess(stackRaw);
				stackLines = frames.map(f => `${f.process || '(unknown)'} @ ${f.file || '?'}:${f.fileLine || 0}`);
				const top = frames[0];
				if (top?.file && top.fileLine > 0) { location = { file: top.file, line: top.fileLine, procedure: top.process || undefined }; }
			} catch {
				// 스택 조회 실패 — "(스택 정보 없음)" 으로 남긴다.
			}
		}
		if (!location && stackLines.length > 0) {
			const m = /^(.*?)\s*@\s*(.+):(\d+)$/.exec(stackLines[0]);
			if (m && m[2] !== '?' && Number(m[3]) > 0) { location = { file: m[2], line: Number(m[3]), procedure: m[1] || undefined }; }
		}
		if (!location && thread?.file && (thread.fileLine ?? 0) > 0) {
			location = { file: thread.file, line: thread.fileLine as number, procedure: thread.func };
		}

		const relatedFunctions = stackLines
			.map(line => line.split('@')[0].trim())
			.filter(Boolean)
			.filter((v, idx, arr) => arr.indexOf(v) === idx)
			.slice(0, 6);

		const targetProject = host.sessionTargetDir ? projectNameOf(host.sessionTargetDir) : undefined;
		const projectStart = host.sessionTargetDir && targetProject?.toLowerCase() === thread?.project.toLowerCase()
			? readGprProjectStart(host.sessionTargetDir) : undefined;
		// 보고서를 만들기 **전에** 스냅샷을 뜬다. 출력은 host.report 로 나가 링버퍼를 건드리지 않으므로 보고서 자신이 섞이지 않는다(§1-EA).
		const recentEvents = host.recentControllerEvents.recent(10);

		const lines = renderErrorReport({
			raw: raw || undefined,
			code: typeof code === 'number' ? code : undefined,
			category,
			groupTitle,
			hint,
			threadName: threadName || undefined,
			threadState: thread?.state,
			threadStatus: thread?.lastStatus && thread.lastStatus !== '0' ? thread.lastStatus : undefined,
			project: thread?.project || parsed?.source || undefined,
			projectStart,
			lastCommand: ctx?.lastCommand,
			firstSeenAt: parsed?.timestamp || ctx?.firstSeenAt,
			location,
			stackLines: stackLines.slice(0, 8),
			relatedFunctions,
			// 완결된 전체 스택과 대상 프로젝트의 메인 쓰레드가 확인될 때만 대조한다.
			startMismatch: describeStartProcedureMismatch(projectStart, stackLines, {
				threadName, threadProject: thread?.project, targetProject, stackComplete,
			}),
			recentEvents,
			extensionVersion: EXTENSION_VERSION,
		});
		return { lines, location, threadName: threadName || undefined };
	}

	/**
	 * 에러 위치로 이동 + 붉은 강조. 파일을 못 찾으면 조용히 건너뛴다(보고서는 그대로 나간다).
	 * `threadName` 은 강조의 주인 — 그 쓰레드가 `Error` 를 벗어나면(재시작·Stop) 강조가 자동으로 지워진다(§1-EP).
	 */
	async function revealErrorLocation(location: GatheredErrorReport['location'], threadName?: string): Promise<boolean> {
		if (!location) { return false; }
		const filePath = host.project.resolveGplFilePath(location.file);
		if (!filePath) {
			host.log(`[Error Detail] 파일 "${location.file}" 을 워크스페이스에서 찾을 수 없어 위치 이동을 건너뜁니다.`);
			return false;
		}
		try {
			const doc = await vscode.workspace.openTextDocument(filePath);
			const editor = await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });
			const lineIndex = Math.min(Math.max(0, location.line - 1), Math.max(0, doc.lineCount - 1));
			const range = doc.lineAt(lineIndex).range;
			editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
			editor.selection = new vscode.Selection(range.start, range.start);
			host.decorations.showError(editor, range, { threadName });
			return true;
		} catch (err: any) {
			host.log(`[Error Detail] 위치 이동 실패: ${err?.message ?? err}`);
			return false;
		}
	}

	// 에러 복사 — 상세 보기와 같은 보고서를 마크다운으로 클립보드에. 재료가 없는 항목(추정 체인 등)은 종전처럼 툴팁/라벨.
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.copyError', async (arg: unknown) => {
			const payload = toErrorDetailPayload(arg);
			if (!payload.raw && payload.code === undefined && !payload.threadName) {
				if (!payload.fallbackText) { return; }
				await vscode.env.clipboard.writeText(payload.fallbackText);
				vscode.window.showInformationMessage('에러 텍스트를 클립보드에 복사했습니다.');
				return;
			}
			const report = await gatherErrorReport(payload);
			await vscode.env.clipboard.writeText(report.lines.join('\n'));
			vscode.window.showInformationMessage(`오류 상세 ${report.lines.length}줄을 클립보드에 복사했습니다 (마크다운 — 채팅·이슈에 그대로 붙일 수 있습니다).`);
		})
	);

	// 오류 상세 보기 — 에러 위치로 이동(붉은 강조)하고 같은 보고서를 Output 에 찍는다.
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.showErrorDetail', async (arg: unknown) => {
			const report = await gatherErrorReport(toErrorDetailPayload(arg));
			await revealErrorLocation(report.location, report.threadName);
			outputChannel.show(true);
			// host.log 가 아니라 host.report 로 — 보고서는 링버퍼에 남기지 않는다(§1-EA).
			host.report([
				'',
				'── [오류 상세 보기] ────────────────────────────────────',
				...report.lines,
				'─────────────────────────────────────────────────────────',
			]);
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

	// Set DIO — 신호 강제 (안전 확인 모달). 기본 UI는 대시보드의 I/O 탭이고 이 명령은 팔레트/외부 호출 호환용.
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.setDio', async (presetSignal?: number) => {
			const signalStr = typeof presetSignal === 'number'
				? String(presetSignal)
				: await vscode.window.showInputBox({ prompt: 'Set DIO — 신호 번호', placeHolder: '예: 13' });
			if (!signalStr) { return; }
			const signalText = String(signalStr).trim();
			if (!/^\d+$/.test(signalText)) { vscode.window.showWarningMessage('유효한 신호 번호가 아닙니다.'); return; }
			const signal = Number(signalText);
			const pick = await vscode.window.showQuickPick(
				[
					{ label: '$(circle-filled) 강제 ON (force on)', value: '1' },
					{ label: '$(circle-outline) 강제 OFF (force off)', value: '-1' },
					{ label: '$(clear-all) 강제 해제 (clear force)', value: '0' },
				],
				{ placeHolder: `신호 ${signal} — Set DIO 동작 선택 (장비 출력에 영향)` }
			);
			if (!pick) { return; }
			const value = Number(pick.value) as DioForceValue;
			const action = describeDioForce(value);
			const confirm = await vscode.window.showWarningMessage(
				`DIO ${signal} — ${action.label}\n${action.detail}\n\n장비 동작에 영향을 줄 수 있습니다. 실행할까요?`,
				{ modal: true },
				'실행',
			);
			if (confirm !== '실행') { return; }
			try {
				const cmd = buildSetDioCommand(signal, value);
				if (!cmd) { throw new Error('유효하지 않은 DIO 신호 또는 동작입니다.'); }
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
