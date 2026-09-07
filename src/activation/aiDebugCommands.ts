/**
 * AI 자율 디버깅 API(`gpl.ai.debug.*`) + AI 디버그 어시스트.
 *
 * 규약: 모든 `gpl.ai.debug.*` 명령은 예외를 밖으로 던지지 않고 `{ ok: false, error, detail }` 로 반환하며,
 * 결과 JSON 을 Output 에 `[AI Debug]` 접두어로 기록한다(registerAiDebugCommand).
 */

import * as vscode from 'vscode';
import * as path from 'path';
import {
	getCommandPolicySnapshot,
	getConnectionProbeTimeoutMs,
	getControllerConfig,
	isPolicyError,
	sendCommand,
} from '../controller/controllerConnection';
import { describeDeployLock } from '../controller/deployLock';
import { deploy } from '../controller/deployService';
import { SHOW_THREAD_LIST_CMD, parseBreakList, parseStack, parseStatus, parseThreadList } from '../controller/responseParser';
import { buildStepCommand } from '../controller/stepCommand';
import type { StepMode } from '../controller/stepCommand';
import { AI_PAUSED_STATES, waitForThreadPause } from './controllerOps';
import { normalizeEvalValue } from '../debug/showVariableParser';
import { SituationDeploySnapshot } from '../views/controllerTreeProvider';
import { formatBreakpointCommand } from '../controller/breakpointCommand';
import type { ConnectArgs } from './connection';
import type { ExtensionHost } from './host';

export function activateAiDebugCommands(host: ExtensionHost): void {
	const { context } = host;

	// AI 디버그 어시스트 — 확장 명령만 사용해 안전한 기본 순서를 한 번에 실행.
	// (직접 FTP/TCP 우회 금지, 상태 변경은 기존 명령의 게이트를 그대로 사용)
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.ai.debugAssist', async () => {
			type AssistMode = 'diagnose-only' | 'build-only' | 'build-and-console' | 'build-and-attach';
			const modePick = await vscode.window.showQuickPick(
				[
					{ label: '진단만 (연결 + 스냅샷)', description: '상태만 수집하고 코드 변경 실행은 하지 않음', mode: 'diagnose-only' as AssistMode },
					{ label: 'Build Only + 진단', description: '최신 로컬 코드 업로드/컴파일 검증 후 스냅샷', mode: 'build-only' as AssistMode },
					{ label: 'Build Only + 콘솔', description: 'Build Only 후 1403 콘솔 연결 확인', mode: 'build-and-console' as AssistMode },
					{ label: 'Build Only + Attach', description: 'Build Only 성공 시 빠른 Attach 시작', mode: 'build-and-attach' as AssistMode },
				],
				{ placeHolder: 'AI 디버그 어시스트 실행 모드를 선택하세요' },
			);
			if (!modePick) {
				return { ok: false, cancelled: true, reason: 'user-cancelled' };
			}

			const startedAt = Date.now();
			const steps: string[] = [];
			const mode = modePick.mode;

			const recordStep = (line: string): void => {
				steps.push(line);
				host.log(`[AI Assist] ${line}`);
			};

			const summary = {
				ok: false,
				cancelled: false,
				mode,
				startedAt,
				finishedAt: 0,
				durationMs: 0,
				steps,
				deploy: undefined as SituationDeploySnapshot | undefined,
				error: undefined as string | undefined,
			};

			try {
				recordStep('시작');

				if (!(host.controllerTree?.isConnected ?? false)) {
					recordStep('제어기 연결 시도');
					await vscode.commands.executeCommand('gpl.controller.connect');
				}

				if (!(host.controllerTree?.isConnected ?? false)) {
					throw new Error('제어기 연결이 완료되지 않았습니다.');
				}
				recordStep('제어기 연결 확인 완료');

				recordStep('초기 상태 스냅샷 수집');
				await vscode.commands.executeCommand('gpl.controller.copySituationForChat');

				if (mode !== 'diagnose-only') {
					recordStep('Build Only 실행');
					await vscode.commands.executeCommand('gpl.deploy');
					summary.deploy = host.lastDeploySnapshot;
					if (!host.lastDeploySnapshot?.success) {
						throw new Error(`Build Only 실패 (${host.lastDeploySnapshot?.lastStage ?? 'unknown'})`);
					}
					recordStep('Build Only 성공');
				}

				if (mode === 'build-and-console' || mode === 'build-and-attach') {
					recordStep('런타임 콘솔 연결 확인');
					await vscode.commands.executeCommand('gpl.console.start');
				}

				recordStep('최종 진단 스냅샷 수집');
				await vscode.commands.executeCommand('gpl.diagnosticSnapshot');

				if (mode === 'build-and-attach') {
					recordStep('빠른 Attach 시작');
					await vscode.commands.executeCommand('gpl.debug.attachNow');
				}

				summary.ok = true;
				recordStep('완료');
				vscode.window.showInformationMessage('AI 디버그 어시스트 완료');
			} catch (err: any) {
				summary.error = err?.message ?? String(err);
				recordStep(`실패: ${summary.error}`);
				vscode.window.showErrorMessage(`AI 디버그 어시스트 실패: ${summary.error}`);
			} finally {
				summary.finishedAt = Date.now();
				summary.durationMs = summary.finishedAt - startedAt;

				const lines: string[] = [];
				lines.push('# AI Debug Assist Result');
				lines.push('');
				lines.push(`- mode: ${summary.mode}`);
				lines.push(`- ok: ${summary.ok}`);
				lines.push(`- durationMs: ${summary.durationMs}`);
				if (summary.deploy) {
					lines.push(`- deploy.success: ${summary.deploy.success}`);
					lines.push(`- deploy.lastStage: ${summary.deploy.lastStage}`);
					lines.push(`- deploy.summary: ${summary.deploy.summary}`);
				}
				if (summary.error) {
					lines.push(`- error: ${summary.error}`);
				}
				lines.push('');
				lines.push('## steps');
				for (const step of summary.steps) {
					lines.push(`- ${step}`);
				}

				host.log('');
				host.log('── [AI Debug Assist] ───────────────────────────────────');
				for (const line of lines) {
					host.log(line);
				}
				host.log('─────────────────────────────────────────────────────────');
			}

			return summary;
		})
	);
	// ─── AI 자율 디버깅 API 공통 규약 ─────────────────────────────
	// 1) 모든 `gpl.ai.debug.*` 명령은 예외를 밖으로 던지지 않고 `{ ok: false, error, detail }`로 반환한다.
	//    (자율 루프를 도는 호출자가 항상 같은 형태의 결과를 받도록 하는 계약)
	// 2) 결과 JSON을 Output(`GPL Language Support`)에 `[AI Debug]` 접두어로 기록한다.
	//    executeCommand 반환값을 직접 받지 못하는 호출자(Output 채널만 읽는 AI 포함)도 결과를 확인할 수 있다.

	type AiDebugResult = { ok: boolean; [key: string]: unknown };

	function logAiDebugResult(commandId: string, result: AiDebugResult): void {
		let serialized: string;
		try {
			serialized = JSON.stringify(result);
		} catch {
			serialized = '(unserializable result)';
		}
		if (serialized.length > 4000) {
			serialized = `${serialized.slice(0, 4000)}…(truncated)`;
		}
		host.log(`[AI Debug] ${commandId} => ${serialized}`);
	}

	function registerAiDebugCommand<TArgs>(
		commandId: string,
		handler: (args?: TArgs) => Promise<AiDebugResult>,
	): void {
		context.subscriptions.push(
			vscode.commands.registerCommand(commandId, async (args?: TArgs) => {
				let result: AiDebugResult;
				try {
					result = await handler(args);
				} catch (err: any) {
					// 명령 정책(controller/commandPolicy.ts)이 한도 안에 안전 조건을 충족시키지 못해 제어기에 보내지 않은 경우는
					// 통신 실패와 구분해 알린다 — 호출자(AI)가 "기다렸다 다시" 판단을 할 수 있게.
					result = isPolicyError(err)
						? { ok: false, error: 'policy-hold', code: err.code, detail: err.message, sentToController: false }
						: { ok: false, error: 'command-failed', detail: err?.message ?? String(err) };
				}
				logAiDebugResult(commandId, result);
				return result;
			})
		);
	}
	registerAiDebugCommand('gpl.ai.debug.getState', async (args?: { includeStackForThread?: string; includeBreakpoints?: boolean }) => {
		if (!(host.controllerTree?.isConnected ?? false)) {
			return { ok: false, error: 'not-connected' };
		}

		const threadResp = await sendCommand(SHOW_THREAD_LIST_CMD);
		const threads = parseThreadList(threadResp);
		let stack: ReturnType<typeof parseStack> = [];
		if (args?.includeStackForThread) {
			const stackResp = await sendCommand(`Show Stack ${args.includeStackForThread}`);
			stack = parseStack(stackResp);
		}
		let breakpoints: ReturnType<typeof parseBreakList> = [];
		if (args?.includeBreakpoints ?? true) {
			const breakResp = await sendCommand('Show Break');
			breakpoints = parseBreakList(breakResp);
		}

		return {
			ok: true,
			timestamp: Date.now(),
			connected: host.controllerTree?.isConnected ?? false,
			threads,
			stack,
			breakpoints,
		};
	});

	// `mirror: false`를 주면 에디터 반영을 건너뛴다 — 스스로 정리하는 임시 BP(run_to_line 등)가
	// 빨간 점을 깜빡이게 하거나 사용자가 같은 줄에 찍어 둔 중단점을 지우지 않게 하는 탈출구다.
	type AiBreakpointArgs = { file: string; line: number; projectName?: string; mirror?: boolean };

	async function aiApplyBreakpoint(args: AiBreakpointArgs | undefined, clear: boolean): Promise<AiDebugResult> {
		if (!args?.file || !args?.line) {
			return { ok: false, error: 'missing-file-or-line' };
		}
		const projectName = (args.projectName || await host.project.resolveExpectedProjectName() || '').trim();
		if (!projectName) {
			return { ok: false, error: 'missing-projectName' };
		}
		const fileName = path.basename(args.file);
		const line = Math.max(1, Math.floor(args.line));
		const cmd = formatBreakpointCommand(clear ? 'Nobreak' : 'Break', projectName, fileName, line);
		const raw = await sendCommand(cmd);
		const status = parseStatus(raw);
		const ok = status.code === 0;
		// 제어기가 받아들였을 때만 에디터에 반영한다 — 실패한 BP를 빨간 점으로 남기면 거짓 표시가 된다.
		const mirror = ok && args.mirror !== false
			? host.breakpointMirror.apply(clear ? 'Nobreak' : 'Break', fileName, line)
			: undefined;
		return {
			ok,
			command: cmd,
			status,
			...(mirror ? { editorBreakpoint: mirror.mirrored ? 'updated' : mirror.reason } : {}),
		};
	}

	registerAiDebugCommand('gpl.ai.debug.setBreakpoint',
		(args?: AiBreakpointArgs) => aiApplyBreakpoint(args, false));

	registerAiDebugCommand('gpl.ai.debug.clearBreakpoint',
		(args?: AiBreakpointArgs) => aiApplyBreakpoint(args, true));

	registerAiDebugCommand('gpl.ai.debug.breakThread', async (args?: { threadName: string; waitForPause?: boolean; waitTimeoutMs?: number }) => {
		if (!args?.threadName) {
			return { ok: false, error: 'missing-threadName' };
		}
		const cmd = `Break ${args.threadName}`;
		const raw = await sendCommand(cmd);
		const status = parseStatus(raw);
		if (status.code !== 0) {
			return { ok: false, command: cmd, status };
		}
		// STATUS 0은 "접수"로 보고, 기본은 실제 정지 진입까지 확인한다. 종전 동작은 waitForPause=false.
		if (args.waitForPause ?? true) {
			const wait = await waitForThreadPause(args.threadName, args.waitTimeoutMs ?? 5000);
			if (!wait.paused) {
				return { ok: false, error: 'pause-timeout', command: cmd, status, state: wait.state };
			}
			return { ok: true, command: cmd, status, state: wait.state };
		}
		return { ok: true, command: cmd, status };
	});

	registerAiDebugCommand('gpl.ai.debug.stepThread', async (args?: { threadName: string; mode?: StepMode; waitForPause?: boolean; waitTimeoutMs?: number }) => {
		if (!args?.threadName) {
			return { ok: false, error: 'missing-threadName' };
		}
		const mode: StepMode = args.mode ?? 'over';
		const cmd = buildStepCommand(args.threadName, mode);
		const raw = await sendCommand(cmd);
		const status = parseStatus(raw);
		if (status.code !== 0) {
			return { ok: false, mode, command: cmd, status };
		}
		// 스텝 완료(다음 정지 위치 도달)까지 확인해야 이어지는 Show Stack/evaluate가 이전 위치를 읽지 않는다.
		if (args.waitForPause ?? true) {
			const wait = await waitForThreadPause(args.threadName, args.waitTimeoutMs ?? 5000);
			if (!wait.paused) {
				return { ok: false, error: 'pause-timeout', mode, command: cmd, status, state: wait.state };
			}
			return { ok: true, mode, command: cmd, status, state: wait.state };
		}
		return { ok: true, mode, command: cmd, status };
	});

	registerAiDebugCommand('gpl.ai.debug.continueThread', async (args?: { threadName: string; noError?: boolean }) => {
		if (!args?.threadName) {
			return { ok: false, error: 'missing-threadName' };
		}
		const cmd = args.noError ? `Continue ${args.threadName} -noerror` : `Continue ${args.threadName}`;
		const raw = await sendCommand(cmd);
		const status = parseStatus(raw);
		return { ok: status.code === 0, command: cmd, status };
	});

	registerAiDebugCommand('gpl.ai.debug.evaluate', async (args?: { threadName: string; frameIndex?: number; expression: string }) => {
		if (!args?.threadName || !args?.expression) {
			return { ok: false, error: 'missing-threadName-or-expression' };
		}
		const frameIndex = Math.max(0, Math.floor(args.frameIndex ?? 0));
		const cmd = `Show Variable -eval ${args.threadName} ${frameIndex} ${args.expression}`;
		const raw = await sendCommand(cmd);
		const status = parseStatus(raw);
		const value = normalizeEvalValue(raw);
		return {
			ok: status.code === 0,
			command: cmd,
			status,
			value,
			raw,
		};
	});

	// ── 연결 상태 계층 (GitHub #25 A): AI가 확장의 연결 상태를 만들고 읽을 수 있게 ──
	registerAiDebugCommand('gpl.ai.debug.connect', async (args?: ConnectArgs) => {
		// 기본은 silent(팝업 없음). 명시적으로 silent:false 를 주면 사람용 알림도 띄운다.
		const result = await host.connection.connectControllerWithArgs({ silent: true, ...(args ?? {}) });
		return { ...result };
	});

	registerAiDebugCommand('gpl.ai.debug.disconnect', async () => {
		const result = await vscode.commands.executeCommand<{ ok: boolean; connected: boolean; ip: string; port: number }>(
			'gpl.controller.disconnect', { silent: true });
		return { ...(result ?? {}), ok: true, connected: false };
	});

	registerAiDebugCommand('gpl.ai.debug.getConnectionState', async () => {
		const cfg = getControllerConfig();
		const rc = host.currentRuntimeConsoleStatus();
		const session = vscode.debug.activeDebugSession;
		const lock = host.currentDeployLockHolder();
		return {
			ok: true,
			timestamp: Date.now(),
			connected: host.controllerTree?.isConnected ?? false,
			ip: cfg.ip,
			port: cfg.port,
			consolePort: cfg.consolePort,
			debugSessionActive: host.isDebugSessionActive,
			debugSession: session?.type === 'brooks-gpl'
				? { name: session.name, projectName: String(session.configuration?.projectName ?? '') || undefined }
				: undefined,
			runtimeConsole: { active: rc.connected, state: rc.state, reason: rc.reason, lastPayloadAt: rc.lastPayloadAt },
			// 연결 건강(2026-08-28): state connected/suspect/disconnected, 연속 실패 수, 의심 사유 — AI가 "connected 인데 응답 없음"을 가릴 수 있게
			health: host.healthMonitor ? { ...host.healthMonitor.snapshot(), probeTimeoutMs: getConnectionProbeTimeoutMs() } : undefined,
			// 명령 정책(commandPolicy.ts) 상태 — AI 가 "왜 기다렸는지/policy-hold 가 왜 났는지" 해석할 때 참고.
			commandPolicy: getCommandPolicySnapshot(),
			expectedProject: (await host.project.resolveExpectedProjectName()) || undefined,
			deployLock: lock ? { owner: lock.owner, stage: lock.stage, describe: describeDeployLock(lock) } : null,
			compileStale: host.compileStaleProjects.list(),
		};
	});

	registerAiDebugCommand('gpl.ai.debug.loop', async (args?: {
		threadName?: string;
		stepMode?: StepMode;
		maxSteps?: number;
		watchExpressions?: string[];
		stopWhen?: { expression: string; equals?: string; contains?: string; matches?: string };
		stepWaitTimeoutMs?: number;
	}) => {
		if (!(host.controllerTree?.isConnected ?? false)) {
			// AI 자율 루프에서 입력 상자가 뜨면 멈춰 버린다 — 현재 설정으로 비대화형 연결(GitHub #25).
			await host.connection.connectControllerWithArgs({ silent: true });
		}
		if (!(host.controllerTree?.isConnected ?? false)) {
			return { ok: false, error: 'not-connected' };
		}

		// stopWhen.matches는 루프 진입 전에 1회만 검증 — 잘못된 정규식이 루프 도중 예외로 터지지 않게 한다.
		let stopWhenRegex: RegExp | undefined;
		if (args?.stopWhen?.matches) {
			try {
				stopWhenRegex = new RegExp(args.stopWhen.matches);
			} catch (err: any) {
				return { ok: false, error: 'invalid-stopWhen-matches', detail: err?.message ?? String(err) };
			}
		}

		const mode: StepMode = args?.stepMode ?? 'over';
		const maxSteps = Math.max(1, Math.min(50, Math.floor(args?.maxSteps ?? 10)));
		const stepWaitTimeoutMs = Math.max(500, Math.floor(args?.stepWaitTimeoutMs ?? 5000));
		const watches = (args?.watchExpressions ?? []).filter(Boolean);
		const trace: Array<{
			step: number;
			threadName: string;
			threadState?: string;
			location?: { file: string; line: number; process: string };
			watches: Array<{ expression: string; ok: boolean; value: string; statusCode: number }>;
			stopWhen?: { expression: string; ok: boolean; value: string; statusCode: number; matched: boolean };
			action: string;
		}> = [];

		let targetThread = (args?.threadName || '').trim();
		// 시작 시점부터 Error인 스레드는 -noerror 스텝 진행을 허용하고,
		// 루프 도중 Error로 "전이"한 경우에만 에러 정보와 함께 중단한다.
		let allowErrorState = true;
		for (let i = 1; i <= maxSteps; i++) {
			const threadResp = await sendCommand(SHOW_THREAD_LIST_CMD);
			const threads = parseThreadList(threadResp);
			if (!targetThread) {
				const candidate = threads.find(t => AI_PAUSED_STATES.has(t.state));
				targetThread = candidate?.name || '';
			}
			if (!targetThread) {
				return { ok: false, error: 'no-paused-or-error-thread', trace };
			}
			const current = threads.find(t => t.name === targetThread);
			if (!current) {
				return { ok: false, error: 'thread-not-found', threadName: targetThread, steps: i - 1, trace };
			}
			if (current.state === 'Error' && !allowErrorState) {
				trace.push({
					step: i,
					threadName: targetThread,
					threadState: current.state,
					watches: [],
					action: `thread entered Error state (lastStatus: ${current.lastStatus || 'n/a'})`,
				});
				return { ok: true, stoppedBy: 'thread-error', mode, steps: i, lastStatus: current.lastStatus, trace };
			}
			allowErrorState = false;

			const stackResp = await sendCommand(`Show Stack ${targetThread}`);
			const frames = parseStack(stackResp);
			const top = frames[0];

			const watchResults: Array<{ expression: string; ok: boolean; value: string; statusCode: number }> = [];
			for (const exp of watches) {
				const evalResp = await sendCommand(`Show Variable -eval ${targetThread} 0 ${exp}`);
				const st = parseStatus(evalResp);
				const value = normalizeEvalValue(evalResp);
				watchResults.push({ expression: exp, ok: st.code === 0, value, statusCode: st.code });
			}

			// stopWhen 평가 결과는 성공/실패와 무관하게 trace에 남긴다 —
			// 표현식 오타(-eval 실패)를 호출자가 알아챌 수 있어야 한다.
			let stopWhenResult: { expression: string; ok: boolean; value: string; statusCode: number; matched: boolean } | undefined;
			if (args?.stopWhen?.expression) {
				const condResp = await sendCommand(`Show Variable -eval ${targetThread} 0 ${args.stopWhen.expression}`);
				const condStatus = parseStatus(condResp);
				const condValue = normalizeEvalValue(condResp);
				const equalsOk = args.stopWhen.equals !== undefined ? condValue === args.stopWhen.equals : false;
				const containsOk = args.stopWhen.contains ? condValue.includes(args.stopWhen.contains) : false;
				const regexOk = stopWhenRegex ? stopWhenRegex.test(condValue) : false;
				const stopMatched = condStatus.code === 0 && (equalsOk || containsOk || regexOk);
				stopWhenResult = {
					expression: args.stopWhen.expression,
					ok: condStatus.code === 0,
					value: condValue,
					statusCode: condStatus.code,
					matched: stopMatched,
				};
				if (stopMatched) {
					trace.push({
						step: i,
						threadName: targetThread,
						threadState: current.state,
						location: top ? { file: top.file, line: top.fileLine, process: top.process } : undefined,
						watches: watchResults,
						stopWhen: stopWhenResult,
						action: `stopWhen matched: ${args.stopWhen.expression}=${condValue}`,
					});
					return { ok: true, stoppedBy: 'condition', mode, steps: i, trace };
				}
			}

			const stepCmd = buildStepCommand(targetThread, mode);
			const stepResp = await sendCommand(stepCmd);
			const stepStatus = parseStatus(stepResp);
			trace.push({
				step: i,
				threadName: targetThread,
				threadState: current.state,
				location: top ? { file: top.file, line: top.fileLine, process: top.process } : undefined,
				watches: watchResults,
				stopWhen: stopWhenResult,
				action: `${stepCmd} => STATUS ${stepStatus.code}`,
			});

			if (stepStatus.code !== 0) {
				return { ok: false, error: `step-failed-${stepStatus.code}`, mode, steps: i, trace };
			}

			// Step STATUS 0은 접수 신호일 수 있어(§0.6 패턴), 실제 정지 복귀까지 확인 후 다음 반복으로 진행.
			const wait = await waitForThreadPause(targetThread, stepWaitTimeoutMs);
			if (!wait.paused) {
				return { ok: false, error: 'step-pause-timeout', mode, steps: i, lastState: wait.state, trace };
			}
		}

		return { ok: true, stoppedBy: 'maxSteps', mode, steps: maxSteps, trace };
	});
}
