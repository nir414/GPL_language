/**
 * AI 자율 디버깅 API(`gpl.ai.debug.*`) + AI 디버그 어시스트.
 *
 * 규약: 모든 `gpl.ai.debug.*` 명령은 예외를 밖으로 던지지 않고 `{ ok: false, error, detail }` 로 반환하며,
 * 결과 JSON 을 Output 에 `[AI Debug]` 접두어로 기록한다(registerAiDebugCommand).
 */

import * as vscode from 'vscode';
import {
	getCommandPolicySnapshot,
	getConnectionProbeTimeoutMs,
	getControllerConfig,
	isPolicyError,
	sendCommand,
	sendCommandDetailed,
} from '../controller/connection/controllerConnection';
import { AI_BLOCKED_ERROR } from '../controller/automation/aiCommandPolicy';
import { describeDeployLock } from '../controller/deployment/deployLock';
import { listRemoteDir, listRemoteDirs, normalizeAbsoluteRemoteDir } from '../controller/files/ftpClient';
import { classifyRemoteClearRoot, clearRemoteFolderEntries, selectRemoteClearTargets } from '../controller/files/remoteFolderClear';
import { verifyControllerForFtpWrite } from '../controller/connection/controllerIdentityIo';
import { getCompiledRecord } from '../controller/deployment/deployRecord';
import { compileUntilPattern } from '../controller/runtime/runtimeConsoleBuffer';
import { SHOW_THREAD_LIST_CMD, parseBreakList, parseStack, parseStatus, parseThreadList } from '../controller/protocol/responseParser';
import { buildStepCommand } from '../controller/commands/stepCommand';
import type { StepMode } from '../controller/commands/stepCommand';
import { waitForThreadPause } from './controllerOps';
import { describeThreadActivity, isPausedState } from '../controller/threads/threadActivity';
import { normalizeEvalValue } from '../debug/showVariableParser';
import type { SituationDeploySnapshot } from '../controller/deployment/deployOutcome';
import { formatBreakpointCommand, normalizeBreakpointCommandFile } from '../controller/debugging/breakpointCommand';
import { isResolvedBreakpointRecord } from '../controller/debugging/breakpointReconcile';
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
					{ label: 'Build Only + 콘솔', description: 'Build Only 후 런타임 콘솔 연결 확인', mode: 'build-and-console' as AssistMode },
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

				if (!host.isControllerConnected) {
					recordStep('제어기 연결 시도');
					await vscode.commands.executeCommand('gpl.controller.connect');
				}

				if (!host.isControllerConnected) {
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
					// 바로 위에서 Build Only(gpl.deploy)가 성공한 뒤이므로 배포 없이 붙는다 —
					// 배포를 동반하는 경로(gpl.debugProject / deployBeforeAttach)를 쓰면 같은 업로드+Compile이 한 번 더 돈다 (2026-09-10).
					recordStep('Attach 시작 (배포 없이 — Build Only 직후)');
					await vscode.commands.executeCommand('gpl.debug.attachOnly');
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
					// 명령 정책(controller/commands/commandPolicy.ts)이 한도 안에 안전 조건을 충족시키지 못해 제어기에 보내지 않은 경우는
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
		if (!host.isControllerConnected) {
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
			connected: host.isControllerConnected,
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
		const line = Math.max(1, Math.floor(args.line));
		const target = host.project.resolveBreakpointTarget(args.file, line, projectName);
		if (!target) {
			return { ok: false, error: 'breakpoint-source-unresolved', file: args.file, line };
		}
		if (target.kind === 'library-source') {
			return {
				ok: false,
				error: 'library-source-breakpoint-unsupported',
				file: args.file,
				line,
				message: target.message,
				suggestedCommand: 'gpl.project.promoteSourceForBreakpoint',
			};
		}
		if (target.kind !== 'direct-source' || !target.file) {
			return { ok: false, error: 'outside-project', file: args.file, line, message: target.message };
		}

		const fileName = target.file;
		const cmd = formatBreakpointCommand(clear ? 'Nobreak' : 'Break', target.projectName, fileName, line);
		let raw = await sendCommand(cmd);
		let status = parseStatus(raw);
		let ok = status.code === 0;
		let controllerBreakpoint: ReturnType<typeof parseBreakList>[number] | undefined;
		if (!clear && (ok || status.code === -775)) {
			const fileKey = normalizeBreakpointCommandFile(fileName).toLowerCase();
			const readControllerBreakpoint = async () => {
				const list = parseBreakList(await sendCommand('Show Break'));
				return list.find(bp => bp.project.toLowerCase() === target.projectName.toLowerCase()
					&& normalizeBreakpointCommandFile(bp.file).toLowerCase() === fileKey
					&& bp.fileLine === line);
			};
			controllerBreakpoint = await readControllerBreakpoint();
			const resolved = !!controllerBreakpoint && isResolvedBreakpointRecord(controllerBreakpoint);
			if (status.code === -775 && !resolved) {
				await sendCommand(formatBreakpointCommand('Nobreak', target.projectName, fileName, line));
				raw = await sendCommand(cmd);
				status = parseStatus(raw);
				controllerBreakpoint = status.code === 0 ? await readControllerBreakpoint() : undefined;
			}
			ok = status.code === 0
				&& !!controllerBreakpoint
				&& isResolvedBreakpointRecord(controllerBreakpoint);
		}
		// 제어기가 받아들였을 때만 에디터에 반영한다 — 실패한 BP를 빨간 점으로 남기면 거짓 표시가 된다.
		const mirror = ok && args.mirror !== false
			? host.breakpointMirror.apply(clear ? 'Nobreak' : 'Break', fileName, line)
			: undefined;
		return {
			ok,
			...(!ok && !clear && status.code === 0 ? { error: 'breakpoint-unresolved' } : {}),
			command: cmd,
			status,
			...(controllerBreakpoint ? { controllerBreakpoint } : {}),
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
		// debugSessionEnded: 해제 전에 살아 있던 디버그 세션을 끝냈는지 — 끝내야 어댑터 폴이 멎고 1402 소켓이 실제로 비워진다.
		const result = await vscode.commands.executeCommand<{ ok: boolean; connected: boolean; ip: string; port: number; debugSessionEnded?: boolean }>(
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
			connected: host.isControllerConnected,
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

	// ── 런타임 콘솔 스트림 읽기 (§1-EP) — MCP `runtime_console_read` 의 뒷단 ─────────────────────
	// 확장이 수신한 런타임 콘솔(1403) 줄을 커서로 읽고, 패턴/새 줄을 여기서 기다렸다가 한 번에 돌려준다.
	// 호출자(AI)가 "언제 읽을지" 를 정하려고 1402 조회나 이 명령을 반복하지 않게 하는 것이 목적이다.
	registerAiDebugCommand('gpl.ai.debug.runtimeConsoleRead', async (args?: { cursor?: number; maxLines?: number; waitMs?: number; untilPattern?: string }) => {
		const pattern = compileUntilPattern(args?.untilPattern);
		if (pattern === null) {
			return { ok: false, error: 'bad-pattern', detail: `untilPattern 이 올바른 정규식이 아닙니다: ${args?.untilPattern}` };
		}
		let runtimeConsole = host.runtimeConsole;
		if (!runtimeConsole && host.isControllerConnected) {
			try {
				runtimeConsole = host.ensureRuntimeConsole();
			} catch (err: any) {
				return { ok: false, error: 'runtime-console-unavailable', detail: err?.message ?? String(err) };
			}
		}
		if (!runtimeConsole) {
			return {
				ok: true,
				lines: [], nextCursor: 0, dropped: 0, buffered: 0, matched: false, timedOut: false, waitedMs: 0,
				status: { active: false, state: 'idle', reason: '런타임 콘솔이 시작되지 않았습니다 — 제어기에 연결되어 있지 않습니다' },
				captureFile: undefined,
				note: '제어기에 연결되면 런타임 콘솔이 자동으로 시작됩니다(gpl.ai.debug.connect 또는 사용자 연결).',
			};
		}
		const waitMs = Math.min(Math.max(0, Math.floor(args?.waitMs ?? 0)), 120_000);
		const r = await runtimeConsole.lineBuffer.waitFor({
			cursor: args?.cursor,
			maxLines: args?.maxLines,
			untilPattern: pattern ?? undefined,
			timeoutMs: waitMs,
		});
		const rc = runtimeConsole.getStatusSnapshot();
		return {
			ok: true,
			...r,
			status: { active: rc.connected, state: rc.state, reason: rc.reason, lastPayloadAt: rc.lastPayloadAt },
			captureFile: runtimeConsole.captureFilePath,
			...(r.dropped > 0 ? { note: `커서 이후 ${r.dropped}줄이 버퍼에서 밀려 빠졌습니다 — 더 자주 읽거나 captureFile 을 보십시오.` } : {}),
		};
	});

	// ── 제어기 /GPL 폴더 목록 (§1-EP, 개선 요청 §8) — MCP `list_remote_projects` 의 뒷단 ───────────
	// Unload 뒤에도 메모리가 모자라 Start 가 -200 이던 사건의 원인은 /GPL 에 남아 있던 다른 프로젝트였다. 콘솔에는
	// 로드/잔존 프로젝트를 보는 명령이 없으므로(`Show Project` 는 -714) FTP LIST 로 폴더 목록을 읽는다(읽기 전용).
	registerAiDebugCommand('gpl.ai.debug.listRemoteProjects', async (args?: { root?: string }) => {
		const cfg = getControllerConfig();
		const root = normalizeAbsoluteRemoteDir((args?.root ?? '').trim() || cfg.ftpBasePath);
		const lock = host.currentDeployLockHolder();
		if (lock) {
			return {
				ok: false,
				error: 'deploy-busy',
				detail: `배포/업로드 중(${describeDeployLock(lock)})이라 FTP 를 추가로 열지 않습니다. 끝난 뒤 다시 호출하십시오.`,
				recovery: { action: 'CHECK_OPERATION', retryCurrentCommand: false, detail: 'wait_operation 으로 진행 중 작업이 끝나길 기다린 뒤 다시 호출할 것.' },
			};
		}
		let entries;
		try {
			entries = await listRemoteDir(cfg.ip, root);
		} catch (err: any) {
			return { ok: false, error: 'ftp-failed', detail: `${root} 목록 조회 실패: ${err?.message ?? String(err)}`, host: cfg.ip, root };
		}
		const dirs = entries.filter(e => e.isDirectory);
		const listings = dirs.length > 0 ? await listRemoteDirs(cfg.ip, dirs.map(d => `${root}/${d.name}`)) : [];
		const projects = dirs.map((d, i) => {
			const listing = listings[i];
			const files = listing?.entries?.filter(e => !e.isDirectory) ?? [];
			const totalBytes = files.reduce((sum, f) => sum + (f.size || 0), 0);
			const newest = files.reduce<number>((max, f) => Math.max(max, f.modifiedAt?.getTime() ?? 0), 0);
			const rec = getCompiledRecord(cfg.ip, d.name);
			return {
				name: d.name,
				path: `${root}/${d.name}`,
				fileCount: listing?.entries ? files.length : null,
				totalBytes: listing?.entries ? totalBytes : null,
				recursive: false,
				sizeScope: 'immediate-files-only',
				newestModifiedAt: newest > 0 ? new Date(newest).toISOString() : null,
				...(listing?.error ? { error: listing.error } : {}),
				// 확장이 이 창에서 마지막으로 컴파일 확정한 출처 — 다른 과제 폴더의 동명 프로젝트인지 가린다.
				lastCompiledFrom: rec ? { projectDir: rec.projectDir, compiledAt: new Date(rec.compiledAt).toISOString() } : null,
			};
		});
		const looseFiles = entries.filter(e => !e.isDirectory).map(e => e.name);
		return {
			ok: true,
			host: cfg.ip,
			root,
			projectCount: projects.length,
			projects,
			looseFiles,
			hint: projects.length > 1
				? `${root} 에 프로젝트 폴더가 ${projects.length}개 있습니다 — 로드되지 않은 폴더도 메모리를 차지할 수 있습니다. `
					+ '정리가 필요하면 사용자 동의를 받은 뒤 clear_remote_folder 로 지웁니다(/GPL 만 — flash 는 사람 전용).'
				: undefined,
		};
	});

	// ── 제어기 /GPL 비우기 (2026-10-21 사용자 결정) — MCP `clear_remote_folder` 의 뒷단 ─────────────
	// 사람의 트리 명령(gpl.controller.ftpClearFolder)은 모달로 확인받지만, 이 경로는 모달을 띄우지 않는다 — 동의는 AI 가
	// 사용자에게 받고 `confirm:true` 로 넘긴다(모달이 떠 있는 동안 브리지가 멈추는 문제도 피한다). `confirm` 이 없으면 지울
	// 목록만 돌려준다(dry run). 범위는 설정된 로드 폴더(/GPL)뿐이고, flash 영구 사본은 되돌릴 수 없으므로 AI_BLOCKED 다.
	// 쓰레드 게이트는 묻지 않고 거절한다 — 정지는 별개의 동의가 필요한 조작이라 AI 가 stop_threads 로 따로 한다.
	registerAiDebugCommand('gpl.ai.debug.clearRemoteFolder', async (args?: { root?: string; names?: string[]; confirm?: boolean }) => {
		// 이 호출 안에서 받은 명령 콘솔 STATUS(쓰레드 게이트)·FTP 배너(목록 조회)를 정체 확인에 재사용한다 — 왕복 추가 없음.
		const startedAt = Date.now();
		const cfg = getControllerConfig();
		const root = normalizeAbsoluteRemoteDir((args?.root ?? '').trim() || cfg.ftpBasePath);
		const kind = classifyRemoteClearRoot(root, { gplBasePath: cfg.ftpBasePath, flashBasePath: cfg.ftpFlashProjectsPath });
		if (kind === 'flash') {
			return {
				ok: false,
				error: AI_BLOCKED_ERROR,
				root,
				sentToController: false,
				detail: `${root} 는 flash 영구 사본이라 AI 가 지울 수 없습니다(재부팅으로도 복구되지 않음). 필요하면 사용자에게 제어기 트리 Flash Projects 섹션의 「폴더 비우기」를 요청하십시오.`,
				recovery: { action: 'ASK_USER', retryCurrentCommand: false },
			};
		}
		if (kind !== 'gpl') {
			return {
				ok: false,
				error: 'root-not-allowed',
				root,
				detail: `비우기는 설정된 로드 폴더(${normalizeAbsoluteRemoteDir(cfg.ftpBasePath)})만 허용합니다. 그 안의 일부만 지우려면 names 로 고르십시오.`,
			};
		}
		const lock = host.currentDeployLockHolder();
		if (lock) {
			return {
				ok: false,
				error: 'deploy-busy',
				detail: `배포/업로드 중(${describeDeployLock(lock)})에는 원격 파일을 지우지 않습니다 — 반쯤 지워진 소스가 컴파일됩니다.`,
				recovery: { action: 'CHECK_OPERATION', retryCurrentCommand: false, detail: 'wait_operation 으로 진행 중 작업이 끝나길 기다린 뒤 다시 호출할 것.' },
			};
		}
		let entries;
		try {
			entries = await listRemoteDir(cfg.ip, root);
		} catch (err: any) {
			return { ok: false, error: 'ftp-failed', detail: `${root} 목록 조회 실패: ${err?.message ?? String(err)}`, host: cfg.ip, root };
		}
		const { targets, missing } = selectRemoteClearTargets(entries, args?.names);
		const targetNames = targets.map(e => (e.isDirectory ? `${e.name}/` : e.name));
		if (targets.length === 0) {
			return { ok: true, root, dryRun: args?.confirm !== true, targets: [], deleted: [], failed: [], missing, note: `${root} 에 지울 항목이 없습니다.` };
		}
		if (args?.confirm !== true) {
			return {
				ok: true,
				dryRun: true,
				root,
				targets: targetNames,
				missing,
				next: '이 목록을 사용자에게 보여 주고 동의를 받은 뒤 confirm:true 와 동의받은 names 로 다시 호출하십시오. 동의 없이 confirm 하지 마십시오.',
			};
		}

		// 쓰레드 게이트 — 트리 명령과 같은 기준(Show Thread 에 쓰레드가 하나라도 있으면 동작 중). 확인 불가도 거절한다(§0.2).
		if (!host.isControllerConnected) {
			return { ok: false, error: 'not-connected', root, detail: '쓰레드 상태를 확인할 수 없어 지우지 않았습니다 — 제어기에 연결한 뒤 다시 호출하십시오.' };
		}
		let threads: ReturnType<typeof parseThreadList> | null = null;
		try {
			const resp = await sendCommandDetailed(SHOW_THREAD_LIST_CMD);
			threads = resp.meta.statusTagReceived ? parseThreadList(resp.raw) : null;
		} catch {
			threads = null;
		}
		if (threads === null) {
			return { ok: false, error: 'thread-state-unknown', root, detail: 'Show Thread 에 응답이 없어 지우지 않았습니다(동작 중일 수 있음). show_threads 로 확인한 뒤 다시 호출하십시오.' };
		}
		if (threads.length > 0) {
			return {
				ok: false,
				error: 'threads-running',
				root,
				threads: threads.map(t => ({ name: t.name, state: t.state })),
				detail: `${describeThreadActivity(threads)} — 실행 중에 원격 파일을 지우면 파일 충돌·자원 누수가 생길 수 있습니다.`,
				recovery: { action: 'ASK_USER', retryCurrentCommand: false, detail: '정지도 사용자 동의를 받아 stop_threads 로 한 뒤 다시 호출할 것.' },
			};
		}

		// FTP 쓰기(삭제) 전 제어기 정체 확인 — AI 경로는 묻지 않고 구조화 거부한다(모달은 브리지를 막는다).
		const controllerCheck = await verifyControllerForFtpWrite(cfg, startedAt,
			vscode.workspace.getConfiguration('gpl').get<boolean>('controller.verifyControllerIdentity', true) !== false);
		if (!controllerCheck.verified) {
			host.log(`[FTP] AI 요청 ${root} 비우기 거부 — 제어기 미확인: ${controllerCheck.reasons.join(' / ')}`);
			return {
				ok: false,
				error: 'CONTROLLER_UNVERIFIED',
				sent: false,
				root,
				reasons: controllerCheck.reasons,
				controllerCheck,
				detail: `${cfg.ip} 이 PA 제어기인지 확인하지 못해 지우지 않았습니다: ${controllerCheck.reasons.join(' ')}`,
				recovery: { action: 'ASK_USER', retryCurrentCommand: false, detail: 'controller_status 로 명령 콘솔·경로를 관측하고 사용자에게 확인할 것. 우회 삭제 금지.' },
			};
		}

		host.log(`[FTP] AI 요청으로 ${root} 비우기 시작 — 대상 ${targets.length}개: ${targetNames.join(', ')}`);
		const result = await clearRemoteFolderEntries(cfg.ip, root, targets, (name, isDirectory) => {
			host.log(`[FTP] − del ${root}/${name}${isDirectory ? '/' : ''}`);
		});
		for (const f of result.failed) {
			host.log(`[FTP] ✘ ${root}/${f.name} 삭제 실패: ${f.error}`);
		}
		void host.controllerTree?.refreshFtp();
		// 사람이 모르는 사이에 지워지지 않게 결과를 알림으로도 남긴다(모달 아님 — 브리지를 막지 않는다).
		void vscode.window.showInformationMessage(result.failed.length > 0
			? `AI 요청: ${root} 비우기 부분 완료 — 삭제 ${result.deleted.length}개, 실패 ${result.failed.length}개`
			: `AI 요청: ${root} 비우기 완료 — ${result.deleted.length}개 삭제`);
		return {
			ok: result.failed.length === 0,
			...(result.failed.length > 0 ? { error: 'partial' } : {}),
			root,
			targets: targetNames,
			deleted: result.deleted,
			failed: result.failed,
			missing,
			next: 'none',
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
		if (!host.isControllerConnected) {
			// AI 자율 루프에서 입력 상자가 뜨면 멈춰 버린다 — 현재 설정으로 비대화형 연결(GitHub #25).
			await host.connection.connectControllerWithArgs({ silent: true });
		}
		if (!host.isControllerConnected) {
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
				const candidate = threads.find(t => isPausedState(t.state));
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
