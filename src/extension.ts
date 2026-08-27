import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { URLSearchParams } from 'url';
import { GPLDefinitionProvider } from './providers/definitionProvider';
import { GPLReferenceProvider } from './providers/referenceProvider';
import { GPLRenameProvider } from './providers/renameProvider';
import { GPLCompletionProvider } from './providers/completionProvider';
import { GPLDocumentSymbolProvider } from './providers/documentSymbolProvider';
import { GPLWorkspaceSymbolProvider } from './providers/workspaceSymbolProvider';
import { GPLDiagnosticProvider } from './providers/diagnosticProvider';
import { GPLCodeActionProvider } from './providers/codeActionProvider';
import { GPLFoldingRangeProvider } from './providers/foldingRangeProvider';
import { GPLHoverProvider } from './providers/hoverProvider';
import { GPLEvaluatableExpressionProvider } from './providers/evaluatableExpressionProvider';
import { GPLSignatureHelpProvider } from './providers/signatureHelpProvider';
import { SymbolCache } from './symbolCache';
import { getTraceServerLevel, isTraceOn, isTraceVerbose, isGplDocument, isGplFile, EXTENSION_VERSION } from './config';

// Controller integration
import { testConnection, getControllerConfig, sendCommand, sendCommandDetailed, setTrafficChannel, setSessionControllerOverride, clearSessionControllerOverride, formatTrafficTimestamp, getTrafficLogOptions, setTrafficResponseBodyEnabled, closeControllerConnection, getConnectionStats, getRecentTraffic, recordTrafficLine, ControllerConfig } from './controller/controllerConnection';
import { probeReachability } from './controller/reachability';
import { parseJsonc, upsertLaunchConfiguration } from './launchJsonc';
import { exportAiAgentSetup, inspectAiAgentSetup, syncStableBundleIfStale } from './ai/exportAgentSetup';
import { EditorBreakpointSync } from './controller/breakpointSync';
import { deploy, findProjectDirs, jumpToFirstCompileError, makeLockedResult, DeployResult } from './controller/deployService';
import { getDeployLock, describeDeployLock, DeployLockRecord, DEPLOY_LOCK_DIR_NAME } from './controller/deployLock';
import { attachDeployRecordStore } from './controller/deployRecord';
import { listRemoteDir, removeRemoteDir, removeRemoteFile, downloadProject, mirrorProject } from './controller/ftpClient';
import { RuntimeConsole, RuntimeConsoleStatusSnapshot } from './controller/runtimeConsole';
import { ControllerTreeProvider, RuntimeErrorContext, SituationDeploySnapshot } from './views/controllerTreeProvider';
import { ConnectionStatusBar } from './views/connectionStatusBar';
import { ControllerDashboardPanel } from './views/controllerDashboardPanel';
import { activateDebug } from './debug/activateDebug';
import {
	parseCompileErrors,
	parseStack,
	parseThreadDetail,
	parseGpr,
	parseStatus,
	parseThreadList,
	parseBreakList,
	SHOW_THREAD_LIST_CMD,
	classifyErrorEntry,
	parseControllerErrorEntry,
	extractErrorCodeFromEntry,
	getErrorCodeHint,
	isControllerNonBlockingStatus,
	pickSourceCandidate,
} from './controller/responseParser';
import { startLiveLogTerminal, stopLiveLogTerminal, appendLiveLog, isLiveLogTerminalEnabled } from './log/liveLogTerminal';
import { fireDebugPollTrigger, setRuntimeConsoleHealthProvider, RuntimeConsoleHealth } from './controller/debugBridge';
import { formatRuntimeConsoleStateLabel } from './controller/runtimeConsolePresentation';
import { isBusyStatus } from './controller/controllerStatusCodes';

// Global output channel for GPL extension logging
let outputChannel: vscode.OutputChannel;
let consoleChannel: vscode.OutputChannel;
let trafficChannel: vscode.OutputChannel;
let runtimeConsole: RuntimeConsole | undefined;
let statusBar: ConnectionStatusBar | undefined;
let controllerTree: ControllerTreeProvider | undefined;
let deployDiagnostics: vscode.DiagnosticCollection;
let runtimeConsoleHooksBound = false;
let lastDeploySnapshot: SituationDeploySnapshot | undefined;
let isDebugSessionActive = false;
/** 디버그 어댑터가 gpl.sourceStale 이벤트로 알린 "소스가 제어기 컴파일 코드보다 새로움" 상태(GitHub #21). */
let lastSourceStale: { projectName: string; files: string[]; compiledAt?: number } | undefined;
let sourceStaleNotifiedSessionId: string | undefined;
// 현재는 signature만 중복 알림 억제에 사용된다. mode/timestamp/summary는 향후 진단용 기록.
const deployOutcomeHistory: Array<{ mode: 'Build' | 'Deploy & Run'; signature: string; timestamp: number; summary: string }> = [];
// 히스토리 상한 — 장시간 세션에서 무한 증가 방지 (초과 시 오래된 항목부터 제거)
const DEPLOY_OUTCOME_HISTORY_MAX = 50;
function pushDeployOutcome(entry: (typeof deployOutcomeHistory)[number]): void {
	deployOutcomeHistory.push(entry);
	while (deployOutcomeHistory.length > DEPLOY_OUTCOME_HISTORY_MAX) {
		deployOutcomeHistory.shift();
	}
}
const recentDebugLogLines: string[] = [];
// recentDebugLogLines 보관 상한 — 초과 시 오래된 라인부터 잘라낸다
const RECENT_DEBUG_LOG_MAX = 240;
let lastRuntimeErrorContext: RuntimeErrorContext | undefined;
// 배포 잠금 — 구 boolean `deployInFlight`를 대체(2026-08-25, 이슈 #15·#17). 획득/해제는 deploy()(deployService)와
// gpl.saveToFlash가 하고, 여기서는 조회만 한다. 잠금 파일(%TEMP%/gpl-controller/<ip>.lock.json)은 다른 VS Code 창과
// controller-mcp도 읽으므로 "업로드 도중 Compile/Start" 차단이 프로세스 경계를 넘는다 (controller/deployLock.ts).
/** 현재 배포 잠금 보유자(이 창·다른 창·살아 있는 다른 프로세스). 없으면 undefined. */
function currentDeployLockHolder(): DeployLockRecord | undefined {
	return getDeployLock(getControllerConfig().ip).current()?.record;
}
/**
 * "컴파일 검증 필요" 상태 — /GPL 소스는 업로드됐지만 Compile로 검증되지 않은 프로젝트(소문자 키).
 * PA 제어기의 `Start`는 자체적으로 Compile을 수행하므로(사용자 실사용 사실, ai-handoff §0.7 — Brooks 문서와 다름)
 * 옛 바이너리가 도는 문제는 아니지만, 소스에 에러가 있으면 Start가 실패하고 Problems 연동도 없다 → Start 전 안내.
 * 업로드 후 Compile 보류(autoOnSave/THREAD_CHECK)·Compile 실패 시 set, Compile 성공 시 clear.
 */
interface CompileStaleInfo { projectName: string; projectDir?: string; since: number; reason: string }
const compileStaleProjects = new Map<string, CompileStaleInfo>();
// settled(비활성) 쓰레드 상태 집합 — deployService.threadSettled와 동일하게 유지할 것
const SETTLED_THREAD_STATE = /^(idle|stopped|error)$/i;

/**
* 연결 유실 사후 스냅샷(GitHub #22 제안 4). 제어기가 죽으면 1402가 닫혀 ErrorLog를 읽을 수 없고 재부팅하면 지워지므로,
* PC 쪽에 남은 증거 — 마지막 트래픽(1402 >>>/ | /<<< + 1403 라인 링버퍼), 1402 연결 통계, 1403 상태, 배포 잠금,
* ping TTL/arp MAC 기반 도달성 판정(직결 NIC 임대 상실 시 사무실 게이트웨이가 응답하는 함정 포함) — 를 한 파일로 묶는다.
* 파일: %TEMP%/gpl-controller/postmortem-<시각>.log. 실패해도 예외를 밖으로 내지 않는다(undefined).
*/
async function writeConnectionLostPostmortem(cfg: ControllerConfig, lostAt: Date, log: (line: string) => void): Promise<string | undefined> {
	try {
		const recent = getRecentTraffic(400);
		const stats = getConnectionStats();
		const rc = currentRuntimeConsoleStatus();
		const lock = getDeployLock(cfg.ip).current()?.record;
		const reach = await probeReachability(cfg.ip, cfg.port);
		const lines: string[] = [
			`# GPL Controller 연결 유실 사후 스냅샷 — ${lostAt.toISOString()} (local ${lostAt.toLocaleString()})`,
			`target: ${cfg.ip}:${cfg.port} (1403: ${cfg.consolePort})  extension: v${EXTENSION_VERSION}  pid: ${process.pid}`,
			'',
			'## 도달성 (ping TTL / TCP / arp)',
			`verdict: ${reach.verdict}`,
			JSON.stringify(reach, null, 1),
			'',
			'## 1402 연결 통계 (keep-alive)',
			JSON.stringify(stats, null, 1),
			'',
			'## 1403 런타임 콘솔 상태',
			JSON.stringify(rc, null, 1),
			'',
			`## 배포 잠금: ${lock ? describeDeployLock(lock) : '(없음)'}`,
			'',
			`## 최근 트래픽 (마지막 ${recent.length}줄 — 1402 >>>/ | /<<< 및 1403 라인, 오래된 순)`,
			...recent,
			'',
		];
		const dir = path.join(os.tmpdir(), DEPLOY_LOCK_DIR_NAME);
		fs.mkdirSync(dir, { recursive: true });
		const stamp = lostAt.toISOString().replace(/[:.]/g, '-');
		const file = path.join(dir, `postmortem-${stamp}.log`);
		fs.writeFileSync(file, lines.join('\n'), 'utf8');
		log(`[Controller] reachability: ${reach.verdict}`);
		log(`[Controller] 사후 스냅샷 저장: ${file} (트래픽 ${recent.length}줄, 1402 connects=${stats.connects} reuses=${stats.reuses})`);
		return file;
	} catch (err: any) {
		log(`[Controller] 사후 스냅샷 저장 실패: ${err?.message ?? err}`);
		return undefined;
	}
}

/** 런타임 콘솔 상태 스냅샷 (콘솔 미생성 시 '미연결' idle 스냅샷). */
function currentRuntimeConsoleStatus(): RuntimeConsoleStatusSnapshot {
	return runtimeConsole?.getStatusSnapshot() ?? {
		state: 'idle',
		connected: false,
		reason: '미연결',
		noPayloadStreak: 0,
		immediateEofStreak: 0,
		lastChangedAt: Date.now(),
	};
}

/** 런타임 콘솔을 중지하고 트리 뷰의 콘솔 상태 표시를 갱신한다. */
function stopRuntimeConsoleAndSyncTree(): void {
	runtimeConsole?.stop();
	if (runtimeConsole) {
		controllerTree?.setRuntimeConsoleStatus(runtimeConsole.getStatusSnapshot());
	}
}

/**
 * RuntimeConsole 싱글톤 확보.
 *
 * 인스턴스를 재사용한다. start()가 idempotent하므로 idle/연결 중/재연결 대기
 * 어떤 상태에서 호출되어도 좀비 인스턴스나 중복 소켓이 생기지 않는다.
 * (이전: 끊긴 인스턴스를 stop+재생성 → 좀비의 reconnect timer가 1403을 두고 경쟁)
 */
function ensureRuntimeConsole(): RuntimeConsole {
	if (!runtimeConsole) {
		runtimeConsole = new RuntimeConsole(consoleChannel, outputChannel);
	}
	if (!runtimeConsoleHooksBound) {
		runtimeConsole.onDidConnect(() => {
			controllerTree?.setRuntimeConsoleStatus(runtimeConsole!.getStatusSnapshot());
		});
		runtimeConsole.onDidDisconnect(() => {
			controllerTree?.setRuntimeConsoleStatus(runtimeConsole!.getStatusSnapshot());
		});
		runtimeConsole.onDidStatusChanged((status) => {
			controllerTree?.setRuntimeConsoleStatus(status);
		});
		runtimeConsole.onDidReceiveData(() => {
			if (isDebugSessionActive) {
				fireDebugPollTrigger();
			}
		});
		runtimeConsoleHooksBound = true;
	}
	runtimeConsole.start();
	controllerTree?.setRuntimeConsoleStatus(runtimeConsole.getStatusSnapshot());
	return runtimeConsole;
}

function buildRuntimeConsoleUserMessage(
	status: RuntimeConsoleStatusSnapshot,
	hasPayload: boolean,
	label: string,
): { level: 'info' | 'warning' | 'error'; message: string } {
	const reason = status.reason || formatRuntimeConsoleStateLabel(status);
	const detail = status.detail ? ` — ${status.detail}` : '';
	if (hasPayload) {
		return { level: 'info', message: `${label} — payload 수신 확인` };
	}
	if (status.connected) {
		return { level: 'info', message: `${label} — 소켓 연결됨, payload 대기 중${detail}` };
	}
	if (status.state === 'reconnecting') {
		const isRuntimePolling = status.reason === '이벤트 대기 폴링'
			|| /이벤트|빈 이벤트|Idle timeout/i.test(`${status.reason} ${status.detail ?? ''}`);
		const level = isRuntimePolling ? 'info' : 'warning';
		const suffix = isRuntimePolling ? '자동 폴링 유지 중' : '자동 재연결 대기 중';
		return { level, message: `${label} — ${reason}${detail}. ${suffix}` };
	}
	if (status.state === 'polling') {
		return { level: 'info', message: `${label} — 이벤트 큐 비어 있음, 자동 폴링 중${detail}` };
	}
	if (status.state === 'batch-complete' || status.state === 'connected-no-payload') {
		return { level: 'info', message: `${label} — ${reason}${detail}` };
	}
	if (status.state === 'connect-failed' || status.state === 'socket-error') {
		return { level: 'error', message: `${label} — ${reason}${detail}` };
	}
	return { level: 'warning', message: `${label} — ${reason}${detail}` };
}

function showRuntimeConsoleUserMessage(
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

export function activate(context: vscode.ExtensionContext) {
	outputChannel = vscode.window.createOutputChannel('GPL Language Support');
	context.subscriptions.push(outputChannel);

	trafficChannel = vscode.window.createOutputChannel('GPL Traffic');
	context.subscriptions.push(trafficChannel);
	setTrafficChannel(trafficChannel);

	function logOutput(msg: string): void {
		recentDebugLogLines.push(`[main] ${msg}`);
		if (recentDebugLogLines.length > RECENT_DEBUG_LOG_MAX) {
			recentDebugLogLines.splice(0, recentDebugLogLines.length - RECENT_DEBUG_LOG_MAX);
		}
		outputChannel.appendLine(msg);
		appendLiveLog(`[main] ${msg}`);
	}

	/** 배포 잠금 보유 중 경고 — 누가·어느 단계·언제부터인지 함께 보여 준다(이슈 #15). */
	function warnDeployBusy(action: string, holder: DeployLockRecord, hint?: string): void {
		const msg = `${action} 불가 — 배포가 진행 중입니다 (${describeDeployLock(holder)})${hint ? `. ${hint}` : ''}`;
		logOutput(`[Lock] ${msg}`);
		void vscode.window.showWarningMessage(msg, '출력 보기').then(pick => {
			if (pick === '출력 보기') { outputChannel.show(true); }
		});
	}

	function findCompileStale(projectName: string): CompileStaleInfo | undefined {
		return compileStaleProjects.get(projectName.trim().toLowerCase());
	}

	function markCompileStale(projectName: string, reason: string, projectDir?: string): void {
		const key = projectName.trim().toLowerCase();
		if (!key) { return; }
		const prev = compileStaleProjects.get(key);
		const info: CompileStaleInfo = { projectName, projectDir: projectDir ?? prev?.projectDir, since: prev?.since ?? Date.now(), reason };
		compileStaleProjects.set(key, info);
		logOutput(`[Deploy] 컴파일 검증 필요: ${projectName} — ${reason} (Start는 제어기가 자체 컴파일 — 소스 에러가 있으면 Start 실패, 먼저 Quick Compile 권장)`);
		controllerTree?.setCompileStale(info);
		statusBar?.setCompileStale(info);
	}

	function clearCompileStale(projectName: string): void {
		const key = projectName.trim().toLowerCase();
		if (!compileStaleProjects.delete(key)) { return; }
		logOutput(`[Deploy] 컴파일 검증 필요 상태 해제: ${projectName}`);
		const next = compileStaleProjects.values().next();
		controllerTree?.setCompileStale(next.done ? undefined : next.value);
		statusBar?.setCompileStale(next.done ? undefined : next.value);
	}

	function sleep(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	async function sendCommandWithBusyRetry(
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
					logOutput(`[Retry] ${command} -> STATUS ${status.code} (busy), retry in ${delay}ms (${attempt}/${maxAttempts})`);
					await sleep(delay);
					continue;
				}

				return resp;
			} catch (err: any) {
				lastError = err;
				if (attempt >= maxAttempts) { break; }
				const delay = baseDelayMs * attempt;
				logOutput(`[Retry] ${command} -> network error: ${err?.message ?? err}, retry in ${delay}ms (${attempt}/${maxAttempts})`);
				await sleep(delay);
			}
		}

		throw lastError ?? new Error(`Command failed after retries: ${command}`);
	}

	async function verifyThreadStopped(threadName: string, maxAttempts = 6): Promise<boolean> {
		const target = threadName.toLowerCase();
		for (let i = 1; i <= maxAttempts; i++) {
			try {
				const resp = await sendCommandWithBusyRetry(SHOW_THREAD_LIST_CMD, { maxAttempts: 2, baseDelayMs: 250 });
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

	async function verifyAllStopped(maxAttempts = 6): Promise<boolean> {
		for (let i = 1; i <= maxAttempts; i++) {
			try {
				const resp = await sendCommandWithBusyRetry(SHOW_THREAD_LIST_CMD, { maxAttempts: 2, baseDelayMs: 250 });
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

	async function trySoftEStopRecovery(targetName?: string): Promise<boolean> {
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
			await sendCommandWithBusyRetry('SoftEStop', { maxAttempts: 3, baseDelayMs: 500 });
			logOutput('[Recovery] SoftEStop executed');
			await sleep(800);
			const ok = targetName ? await verifyThreadStopped(targetName, 8) : await verifyAllStopped(8);
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

	const thisExtension = vscode.extensions.all.find(ext => ext.extensionPath === context.extensionPath);
	const extVersion = thisExtension?.packageJSON?.version ?? 'unknown';
	logOutput(`GPL Language Support extension is now active! (v${extVersion})`);

	// Debug/trace logging (workspace/user settings)
	// - gpl.trace.server = off | messages | verbose
	const traceLevel = getTraceServerLevel(vscode.workspace);
	if (isTraceOn(vscode.workspace)) {
		logOutput(`[Trace] gpl.trace.server = ${traceLevel}`);
		outputChannel.show(true);
	}

	async function normalizeGplDocumentLanguage(document: vscode.TextDocument, reason: string): Promise<vscode.TextDocument> {
		if (!isGplFile(document) || document.languageId === 'gpl') {
			return document;
		}

		try {
			const normalized = await vscode.languages.setTextDocumentLanguage(document, 'gpl');
			if (isTraceVerbose(vscode.workspace)) {
				logOutput(`[Language] Normalized ${path.basename(document.uri.fsPath)}: ${document.languageId} -> gpl (${reason})`);
			}
			return normalized;
		} catch (err: any) {
			logOutput(`[Language] Failed to normalize ${path.basename(document.uri.fsPath)} (${reason}): ${err?.message ?? err}`);
			return document;
		}
	}

	async function normalizeOpenGplDocuments(reason: string): Promise<void> {
		for (const document of vscode.workspace.textDocuments) {
			// 대상 여부 판정은 normalizeGplDocumentLanguage 진입부에서 수행한다.
			await normalizeGplDocumentLanguage(document, reason);
		}
	}

	void normalizeOpenGplDocuments('activation');

	function hasOpenGplContext(): boolean {
		return vscode.workspace.textDocuments.some(doc => isGplDocument(doc));
	}

	// 설정은 activate 1회 스냅샷이 아니라 사용 시점에 읽는다 — 변경이 재시작 없이 반영되도록.
	// autoStartOnDeploy 코드 폴백은 package.json 기본값(true)과 일치시킨다.
	const getAutoStartConsoleOnDeploy = (): boolean => vscode.workspace
		.getConfiguration('gpl.runtimeConsole')
		.get<boolean>('autoStartOnDeploy', true);
	const getAutoStartConsoleOnDebug = (): boolean => vscode.workspace
		.getConfiguration('gpl.runtimeConsole')
		.get<boolean>('autoStartOnDebug', true);

	const autoStartLiveTerminal = vscode.workspace
		.getConfiguration('gpl.trace')
		.get<boolean>('liveTerminal.autoStart', false);
	if (autoStartLiveTerminal) {
		if (hasOpenGplContext()) {
			startLiveLogTerminal();
			logOutput('[Trace] live terminal auto-start enabled');
		} else {
			logOutput('[Trace] live terminal auto-start skipped (no open GPL document)');
		}
	}

	const symbolCache = new SymbolCache(outputChannel);
	const diagnosticProvider = new GPLDiagnosticProvider();
	let symbolCacheInitPromise: Promise<void> | null = null;

	function ensureSymbolCacheInitialized(reason: string): Promise<void> {
		if (symbolCacheInitPromise) { return symbolCacheInitPromise; }
		outputChannel.appendLine(`Initializing symbol cache... (${reason})`);
		symbolCacheInitPromise = symbolCache.refresh()
			.then(() => {
				outputChannel.appendLine('Symbol cache initialized!');
				if (isTraceOn(vscode.workspace)) {
					outputChannel.show(true);
				}
			})
			.catch((err) => {
				outputChannel.appendLine(`[SymbolCache] Initialization failed: ${err}`);
				symbolCacheInitPromise = null;
			});
		return symbolCacheInitPromise;
	}
	
	// Register language providers
	// .gpl 파일은 (권장) gpl 언어로 열고, 호환을 위해 vb로 열린 경우도 지원한다.
	const gplSelectors: vscode.DocumentSelector = [
		{ language: 'gpl', scheme: 'file', pattern: '**/*.gpl' },
		{ language: 'vb', scheme: 'file', pattern: '**/*.gpl' },
		{ scheme: 'file', pattern: '**/*.gpl' },
		{ language: 'gpl', scheme: 'file', pattern: '**/*.gpo' },
		{ language: 'vb', scheme: 'file', pattern: '**/*.gpo' },
		{ scheme: 'file', pattern: '**/*.gpo' }
	];

	// Definition provider (Go to Definition)
	context.subscriptions.push(
		vscode.languages.registerDefinitionProvider(
			gplSelectors,
			new GPLDefinitionProvider(symbolCache, outputChannel)
		)
	);

	// Reference provider (Find All References) — Rename provider가 재사용하므로 인스턴스 공유
	const referenceProvider = new GPLReferenceProvider(symbolCache, outputChannel);
	context.subscriptions.push(
		vscode.languages.registerReferenceProvider(
			gplSelectors,
			referenceProvider
		)
	);

	// Rename provider (F2) — 참조 검색 재사용 + 반환값 대입/문자열 프로시저 참조/섀도잉 보정
	context.subscriptions.push(
		vscode.languages.registerRenameProvider(
			gplSelectors,
			new GPLRenameProvider(symbolCache, referenceProvider, outputChannel)
		)
	);

	// Completion provider (IntelliSense)
	context.subscriptions.push(
		vscode.languages.registerCompletionItemProvider(
			gplSelectors,
			new GPLCompletionProvider(symbolCache),
			// 멤버 접근('.')과 XML 엔티티('&')에서만 자동완성을 트리거한다.
			// 공백(' ') 트리거는 일반 입력마다 팝업을 띄워 소음/지연을 유발하므로 제외.
			// (식별자 입력 시의 기본 IntelliSense는 그대로 동작한다.)
			'.', '&'
		)
	);

	// Document symbol provider (Outline view)
	context.subscriptions.push(
		vscode.languages.registerDocumentSymbolProvider(
			gplSelectors,
			new GPLDocumentSymbolProvider()
		)
	);

	// Workspace symbol provider (Go to Symbol in Workspace)
	context.subscriptions.push(
		vscode.languages.registerWorkspaceSymbolProvider(
			new GPLWorkspaceSymbolProvider(symbolCache)
		)
	);

	// Folding provider (fix odd folding behavior on *.gpl)
	context.subscriptions.push(
		vscode.languages.registerFoldingRangeProvider(
			gplSelectors,
			new GPLFoldingRangeProvider()
		)
	);

	// Hover provider (Const value display)
	context.subscriptions.push(
		vscode.languages.registerHoverProvider(
			gplSelectors,
			new GPLHoverProvider(symbolCache, outputChannel)
		)
	);

	// 디버그 hover 식 결정: `armList(i)`처럼 인덱스 포함 식을 통째로 평가하고,
	// Sub/Function 이름 위 hover는 차단(-eval이 프로시저를 실행해 버리는 사고 방지).
	context.subscriptions.push(
		vscode.languages.registerEvaluatableExpressionProvider(
			gplSelectors,
			new GPLEvaluatableExpressionProvider(symbolCache)
		)
	);

	// Signature Help provider (parameter hints for built-ins + user Sub/Function)
	// Triggered on '(' and ',' so the active-parameter highlight advances as the user types.
	context.subscriptions.push(
		vscode.languages.registerSignatureHelpProvider(
			gplSelectors,
			new GPLSignatureHelpProvider(symbolCache),
			{ triggerCharacters: ['(', ','], retriggerCharacters: [','] }
		)
	);

	// Code Action provider (Quick fixes and refactoring)
	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider(
			gplSelectors,
			new GPLCodeActionProvider(),
			{
				providedCodeActionKinds: [
					vscode.CodeActionKind.QuickFix,
					vscode.CodeActionKind.Refactor,
					vscode.CodeActionKind.RefactorRewrite,
					vscode.CodeActionKind.Source
				]
			}
		)
	);

	// Diagnostic provider registration
	context.subscriptions.push(diagnosticProvider);

	// Refresh symbols command
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.refreshSymbols', async () => {
			await ensureSymbolCacheInitialized('manual refresh');
			await symbolCache.refresh();
			outputChannel.appendLine('GPL symbols cache refreshed!');
			outputChannel.show();
			vscode.window.showInformationMessage('GPL symbols refreshed!');
		})
	);
	
	// Debug command to check symbol cache
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.debugSymbolCache', () => {
			const allSymbols = symbolCache.getAllSymbols();
			outputChannel.appendLine('=== GPL Symbol Cache Debug ===');
			outputChannel.appendLine(`Total symbols: ${allSymbols.length}`);
			
			// Group by file and class
			const byFile = new Map<string, any[]>();
			for (const sym of allSymbols) {
				const fileName = sym.filePath.split('\\').pop() || sym.filePath;
				if (!byFile.has(fileName)) {
					byFile.set(fileName, []);
				}
				byFile.get(fileName)!.push(sym);
			}
			
			for (const [file, symbols] of byFile) {
				outputChannel.appendLine(`\n${file}:`);
				for (const sym of symbols) {
					const classInfo = sym.className ? ` (in class ${sym.className})` : '';
					const typeInfo = sym.returnType ? ` : ${sym.returnType}` : '';
					outputChannel.appendLine(`  [${sym.kind}] ${sym.name}${typeInfo}${classInfo} @line ${sym.line + 1}`);
				}
			}
			
			outputChannel.show();
			vscode.window.showInformationMessage('Symbol cache debug info written to output channel');
		})
	);

	// 제어기 실시간 상태 대시보드 (Webview Panel)
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.showDashboard', () => {
			ControllerDashboardPanel.show(context, outputChannel);
		})
	);

	// XML 베스트 프랙티스 보기 명령
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.showXmlBestPractices', () => {
			const panel = vscode.window.createWebviewPanel(
				'gplXmlBestPractices',
				'GPL XML 베스트 프랙티스',
				vscode.ViewColumn.Two,
				{}
			);

			// Load HTML from media/ instead of hardcoding a huge template string in TS.
			// This improves maintainability and keeps src/ focused on logic.
			loadXmlBestPracticesHtml(context)
				.then(html => {
					panel.webview.html = html;
				})
				.catch(err => {
					outputChannel.appendLine(`[Webview] Failed to load xmlBestPractices.html: ${err}`);
					panel.webview.html = getXmlBestPracticesFallbackHtml();
				});
		})
	);

	// XML 인코딩 분석 명령
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.analyzeXmlEncoding', () => {
			const activeEditor = vscode.window.activeTextEditor;
			if (!activeEditor || !isGplDocument(activeEditor.document)) {
				vscode.window.showWarningMessage('GPL 파일에서만 XML 분석이 가능합니다.');
				return;
			}

			// 진단 게이트(gpl.diagnostics.experimental, 기본 false)가 꺼져 있으면 updateDiagnostics는
			// 아무것도 표시하지 않는다 — "분석 완료"로 오인시키지 않고 비활성 상태를 그대로 안내한다.
			const diagnosticsEnabled = vscode.workspace
				.getConfiguration('gpl.diagnostics')
				.get<boolean>('experimental', false);
			if (!diagnosticsEnabled) {
				vscode.window.showInformationMessage(
					'GPL 진단이 비활성화되어 있어 XML 인코딩 분석 결과가 표시되지 않습니다. 설정 gpl.diagnostics.experimental을 켜면 Problems에 결과가 표시됩니다.',
				);
				return;
			}

			// 현재 문서의 진단 업데이트
			diagnosticProvider.updateDiagnostics(activeEditor.document);
			vscode.window.showInformationMessage('XML 인코딩 분석이 완료되었습니다. 문제점을 확인하세요.');
		})
	);

	// Auto-refresh symbols and diagnostics when GPL files change
	// 심볼 재파싱은 키 입력마다가 아니라 타이핑이 멈춘 뒤 1회만 수행한다 (400ms 디바운스).
	// (기존: 매 키 입력마다 전체 재파싱 + "[SymbolCache] Updated" 로그 폭주)
	const symbolUpdateTimers = new Map<string, ReturnType<typeof setTimeout>>();
	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument((event) => {
			if (isGplDocument(event.document)) {
				const key = event.document.uri.fsPath;
				const prev = symbolUpdateTimers.get(key);
				if (prev) { clearTimeout(prev); }
				symbolUpdateTimers.set(key, setTimeout(() => {
					symbolUpdateTimers.delete(key);
					if (!event.document.isClosed) {
						symbolCache.updateDocument(event.document);
					}
				}, 400));
				diagnosticProvider.scheduleDiagnostics(event.document, 500);
			}
		}),
		{ dispose: () => { for (const t of symbolUpdateTimers.values()) { clearTimeout(t); } symbolUpdateTimers.clear(); } }
	);

	// Keep caches clean on delete/rename to avoid stale symbols/diagnostics.
	context.subscriptions.push(
		vscode.workspace.onDidDeleteFiles((event) => {
			for (const uri of event.files) {
				symbolCache.removeFile(uri.fsPath);
				// 폴더 삭제는 폴더 경로 1건만 온다 — 하위 파일 심볼도 prefix로 제거해 stale 정의 방지.
				symbolCache.deleteByFsPathPrefix(uri.fsPath);
				diagnosticProvider.clearDiagnostics(uri);
			}
		})
	);

	context.subscriptions.push(
		vscode.workspace.onDidRenameFiles(async (event) => {
			for (const f of event.files) {
				// Remove old cache/diagnostics
				symbolCache.removeFile(f.oldUri.fsPath);
				// 폴더 rename 시 옛 경로 하위 파일 심볼도 prefix로 제거 (stale 정의 방지)
				symbolCache.deleteByFsPathPrefix(f.oldUri.fsPath);
				diagnosticProvider.clearDiagnostics(f.oldUri);

				// Re-index the new file path so symbol filePath stays correct
				try {
					const document = await vscode.workspace.openTextDocument(f.newUri);
					if (isGplDocument(document)) {
						symbolCache.updateDocument(document);
						diagnosticProvider.scheduleDiagnostics(document, 0);
					}
				} catch (e) {
					outputChannel.appendLine(`[Rename] Failed to re-index ${f.newUri.fsPath}: ${e}`);
				}
			}
		})
	);

	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument((document) => {
			if (isGplDocument(document)) {
				if (document.languageId !== 'gpl') {
					void normalizeGplDocumentLanguage(document, 'document opened');
					return;
				}
				void ensureSymbolCacheInitialized('GPL document opened');
				// Skip during refresh — indexWorkspace already calls updateDocument
				if (!symbolCache.isRefreshing) {
					symbolCache.updateDocument(document);
				}
				diagnosticProvider.scheduleDiagnostics(document, 0);
			}
		})
	);

	// 문서 저장 시 진단 업데이트
	context.subscriptions.push(
		vscode.workspace.onDidSaveTextDocument((document) => {
			if (isGplDocument(document)) {
				diagnosticProvider.scheduleDiagnostics(document, 0);
			}
		})
	);

	// 파일시스템 워처: 에디터 밖에서 바뀐 .gpl/.gpo(예: git pull, 외부 도구, 빌드 산출물)도
	// 심볼 캐시에 반영해 "정의를 찾을 수 없음"이 수동 새로고침 전까지 발생하지 않도록 한다.
	const gplFileWatcher = vscode.workspace.createFileSystemWatcher('**/*.{gpl,gpo}');
	const reindexFromWatcher = async (uri: vscode.Uri) => {
		try {
			const document = await vscode.workspace.openTextDocument(uri);
			if (isGplDocument(document) && !symbolCache.isRefreshing) {
				symbolCache.updateDocument(document);
			}
		} catch (e) {
			outputChannel.appendLine(`[Watcher] Failed to index ${uri.fsPath}: ${e}`);
		}
	};
	gplFileWatcher.onDidCreate(reindexFromWatcher);
	gplFileWatcher.onDidChange(reindexFromWatcher);
	gplFileWatcher.onDidDelete((uri) => {
		symbolCache.removeFile(uri.fsPath);
		diagnosticProvider.clearDiagnostics(uri);
	});
	context.subscriptions.push(gplFileWatcher);

	// ════════════════════════════════════════════════════════════
	// Controller integration – initialization
	// ════════════════════════════════════════════════════════════
	consoleChannel = vscode.window.createOutputChannel('GPL Console');
	context.subscriptions.push(consoleChannel);

	// RuntimeConsole 싱글톤은 지연 생성되므로 dispose 시점에 존재하면 함께 정리한다
	// (소켓/재연결 타이머/EventEmitter 해제).
	context.subscriptions.push({
		dispose: () => {
			try { runtimeConsole?.dispose(); } catch { /* noop */ }
		},
	});

	deployDiagnostics = vscode.languages.createDiagnosticCollection('gpl-deploy');
	context.subscriptions.push(deployDiagnostics);

	statusBar = new ConnectionStatusBar();
	context.subscriptions.push(statusBar);

	isDebugSessionActive = false; // reset on activate (declared at module level)
	function updateUiContexts(connected: boolean): void {
		void vscode.commands.executeCommand('setContext', 'gpl.ui.connected', connected);
		void vscode.commands.executeCommand('setContext', 'gpl.ui.debugging', isDebugSessionActive);
	}

	let breakpointSync: EditorBreakpointSync | undefined;

	function setControllerConnected(connected: boolean, options?: { refreshTree?: boolean }): void {
		const wasConnected = controllerTree?.isConnected ?? false;
		statusBar?.setConnected(connected);
		updateUiContexts(connected);
		controllerTree?.setConnected(connected, { refresh: options?.refreshTree });
		if (connected && !wasConnected) {
			// 연결 확립 에지에서 에디터 중단점으로 제어기를 따라잡는다 (설정 켜진 경우만, §1-AP)
			breakpointSync?.onControllerConnected();
		}
	}

	updateUiContexts(false);

	// 컴파일 스냅샷 레코드(#21) — Deploy/F5 Compile 성공 시 deployService가 기록, 디버그 어댑터가 attach 시 대조.
	// projectDir 이 워크스페이스 종속이라 globalState 가 아닌 workspaceState 에 둔다.
	attachDeployRecordStore(context.workspaceState);

	// 1403 건강 상태 공급(#22 제안 2): 디버그 어댑터가 Running 백업 폴 간격을 정할 때 참조한다.
	// alive = 콘솔이 살아 있는 상태(idle/stopped/실패 상태 아님)이고 최근 60 s 안에 연결 또는 페이로드가 있었음.
	const RUNTIME_CONSOLE_ALIVE_WINDOW_MS = 60_000;
	setRuntimeConsoleHealthProvider((): RuntimeConsoleHealth => {
		const s = currentRuntimeConsoleStatus();
		const dead = s.state === 'idle' || s.state === 'stopped' || s.state === 'connect-failed' || s.state === 'socket-error';
		const recent = Math.max(s.lastConnectAt ?? 0, s.lastPayloadAt ?? 0);
		const alive = !dead && recent > 0 && Date.now() - recent <= RUNTIME_CONSOLE_ALIVE_WINDOW_MS;
		return { alive, state: s.state, lastConnectAt: s.lastConnectAt, lastPayloadAt: s.lastPayloadAt };
	});
	context.subscriptions.push({ dispose: () => setRuntimeConsoleHealthProvider(undefined) });

	controllerTree = new ControllerTreeProvider();
	controllerTree.setRuntimeConsoleStatus(currentRuntimeConsoleStatus());
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('gplThreads', controllerTree)
	);

	// 에디터 중단점 → 제어기 실시간 동기화 (설정 gpl.controller.syncEditorBreakpoints, §1-AP).
	// VS Code 중단점을 단일 원본으로 삼아, 외부 AI(MCP)는 실행 제어만 담당하게 한다.
	breakpointSync = new EditorBreakpointSync({
		isConnected: () => controllerTree?.isConnected ?? false,
		isDebugSessionActive: () => isDebugSessionActive,
		resolveProjectName: () => resolveExpectedProjectName(),
		log: line => logOutput(line),
		// 동기화 배치 직후 트리의 중단점 섹션을 즉시 갱신 (다음 상세 폴링까지 기다리지 않음)
		onDidSync: () => { void controllerTree?.refreshBreakpointsNow(); },
	});
	context.subscriptions.push(breakpointSync);

	// 트리 중단점 섹션 인라인 새로고침 — Show Break 1회만 재조회 (전체 새로고침보다 가볍다)
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.refreshBreakpoints', async () => {
			const list = await controllerTree?.refreshBreakpointsNow();
			if (!list) {
				vscode.window.showWarningMessage('GPL: 제어기 미연결 — 브레이크포인트를 조회할 수 없습니다.');
			}
		})
	);

	// 트리 중단점 항목 클릭 → 해당 위치 열기 (줄 번호는 배포본 기준 — 로컬 수정 시 어긋날 수 있음)
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.openBreakpointLocation', async (args?: { file?: string; line?: number }) => {
			const file = args?.file;
			const line = args?.line ?? 0;
			if (!file || line <= 0) { return; }
			const filePath = resolveGplFilePath(file);
			if (!filePath) {
				vscode.window.showWarningMessage(`GPL: "${file}"을 워크스페이스에서 찾을 수 없습니다.`);
				return;
			}
			const doc = await vscode.workspace.openTextDocument(filePath);
			const editor = await vscode.window.showTextDocument(doc, { preview: false });
			const lineIdx = Math.min(line - 1, doc.lineCount - 1);
			editor.revealRange(new vscode.Range(lineIdx, 0, lineIdx, 0), vscode.TextEditorRevealType.InCenter);
			editor.selection = new vscode.Selection(lineIdx, 0, lineIdx, 0);
		})
	);

	// 제어기 중단점 → 에디터 가져오기 (단발 pull — 사용자가 명시 실행할 때만, 상시 미러링 아님).
	// 에디터에 이미 있는 위치는 건너뛰므로 동기화 리스너와의 에코는 신규 항목에만 발생(멱등이라 무해).
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.pullBreakpoints', async () => {
			const list = await controllerTree?.refreshBreakpointsNow();
			if (!list) {
				vscode.window.showWarningMessage('GPL: 제어기 미연결 — 중단점을 가져올 수 없습니다.');
				return { ok: false, error: 'not-connected' };
			}
			let added = 0, existing = 0, unresolved = 0;
			const toAdd: vscode.SourceBreakpoint[] = [];
			for (const bp of list) {
				if (!bp.file || bp.fileLine <= 0) { unresolved++; continue; }
				const filePath = resolveGplFilePath(bp.file);
				if (!filePath) {
					unresolved++;
					logOutput(`[BP Pull] 파일 미해석: ${bp.file}:${bp.fileLine} (${bp.project})`);
					continue;
				}
				const uri = vscode.Uri.file(filePath);
				const lineIdx = bp.fileLine - 1;
				const already = vscode.debug.breakpoints.some(b =>
					b instanceof vscode.SourceBreakpoint &&
					b.location.uri.fsPath.toLowerCase() === uri.fsPath.toLowerCase() &&
					b.location.range.start.line === lineIdx);
				if (already) { existing++; continue; }
				toAdd.push(new vscode.SourceBreakpoint(new vscode.Location(uri, new vscode.Position(lineIdx, 0))));
				added++;
			}
			if (toAdd.length > 0) {
				vscode.debug.addBreakpoints(toAdd);
			}
			const msg = `제어기 중단점 가져오기: 추가 ${added}, 이미 있음 ${existing}, 해석 불가 ${unresolved}` +
				(added > 0 ? ' (줄 번호는 배포본 기준)' : '');
			logOutput(`[BP Pull] ${msg}`);
			vscode.window.showInformationMessage(`GPL: ${msg}`);
			return { ok: true, added, existing, unresolved };
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.pushBreakpoints', async () => {
			const result = await breakpointSync!.pushAll();
			const msg = `에디터 중단점 push: 성공 ${result.sent}, 실패 ${result.failed}, 제외 ${result.skipped}`;
			logOutput(`[BP Sync] ${msg}`);
			if (result.failed > 0) {
				vscode.window.showWarningMessage(`GPL: ${msg} — 자세한 내용은 GPL Output 확인`);
			} else {
				vscode.window.showInformationMessage(`GPL: ${msg}`);
			}
			return result;
		})
	);

	// 외부(MCP AI/GDE)가 세운 스레드 정지를 에디터가 따라간다 (설정 gpl.controller.autoShowPausedLocation).
	// 디버그 세션 중에는 DAP가 정지 위치를 표시하므로 개입하지 않는다.
	context.subscriptions.push(
		controllerTree.onDidThreadPause(async ({ name, state }) => {
			if (isDebugSessionActive) { return; }
			const cfg = vscode.workspace.getConfiguration('gpl.controller');
			if (cfg.get<boolean>('autoShowPausedLocation') === false) { return; }
			logOutput(`[Thread] ${name} → ${state} 전이 감지 — 정지 위치 자동 표시`);
			await vscode.commands.executeCommand('gpl.controller.threadShowLocation', { thread: { name } });
		})
	);
	// 트리 등록뿐 아니라 provider 인스턴스 자체도 정리 대상에 등록한다.
	// (pollTimer / EventEmitter / _debugModeSubscription 등이 deactivate 시 해제되도록)
	context.subscriptions.push(controllerTree);

	async function detectWorkspaceProjectContext(): Promise<{ projectName: string; folderName: string }> {
		const dirs = await findProjectDirs();
		if (dirs.length === 0) {
			return { projectName: '', folderName: '' };
		}

		const activePath = vscode.window.activeTextEditor?.document?.uri.scheme === 'file'
			? vscode.window.activeTextEditor.document.uri.fsPath
			: '';

		const sortedDirs = [...dirs].sort((a, b) => b.length - a.length);
		let preferred = sortedDirs[0];
		if (activePath) {
			const matched = sortedDirs.find(d => {
				try {
					const rel = path.relative(path.resolve(d), path.resolve(activePath));
					return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
				} catch {
					return false;
				}
			});
			if (matched) { preferred = matched; }
		}

		const folderName = path.basename(preferred).trim();
		try {
			const gprPath = path.join(preferred, 'Project.gpr');
			const text = fs.readFileSync(gprPath, 'utf-8');
			const info = parseGpr(text);
			return {
				projectName: (info.projectName || folderName).trim(),
				folderName,
			};
		} catch {
			return { projectName: folderName, folderName };
		}
	}

	async function detectWorkspaceProjectName(): Promise<string> {
		const context = await detectWorkspaceProjectContext();
		return context.projectName;
	}

	let expectedProjectSyncTimer: ReturnType<typeof setTimeout> | undefined;
	function scheduleExpectedProjectSync(reason: string): void {
		if (isDebugSessionActive) {
			return;
		}
		if (expectedProjectSyncTimer) {
			clearTimeout(expectedProjectSyncTimer);
		}
		expectedProjectSyncTimer = setTimeout(() => {
			void detectWorkspaceProjectContext().then(projectContext => {
				controllerTree?.setExpectedProjectContext(projectContext.projectName, projectContext.folderName);
				if (projectContext.projectName) {
					logOutput(`[ProjectContext] expected project (${reason}): ${projectContext.projectName} / ftp folder: ${projectContext.folderName}`);
				}
			});
		}, 150);
	}

	scheduleExpectedProjectSync('startup');
	// deactivate 시 디바운스 타이머 해제 (좀비 콜백 방지)
	context.subscriptions.push({ dispose: () => { if (expectedProjectSyncTimer) { clearTimeout(expectedProjectSyncTimer); expectedProjectSyncTimer = undefined; } } });

	function getPreferredWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders || folders.length === 0) { return undefined; }

		const activeUri = vscode.window.activeTextEditor?.document?.uri;
		if (activeUri && activeUri.scheme === 'file') {
			const fromActive = vscode.workspace.getWorkspaceFolder(activeUri);
			if (fromActive) { return fromActive; }
		}

		return folders[0];
	}

	/**
	 * .vscode/launch.json에서 첫 brooks-gpl 구성을 읽어 controller 정보를 추출.
	 * launch.json이 없거나 파싱 실패하면 undefined.
	 */
	function readLaunchControllerInfo(): { ip?: string; port?: number; projectName?: string } | undefined {
		const folder = getPreferredWorkspaceFolder();
		if (!folder) { return undefined; }
		const launchPath = path.join(folder.uri.fsPath, '.vscode', 'launch.json');
		if (!fs.existsSync(launchPath)) { return undefined; }
		try {
			const text = fs.readFileSync(launchPath, 'utf8');
			// launch.json은 JSONC(주석·trailing comma 허용). VS Code와 같은 jsonc-parser로 읽는다(GitHub #30 —
			// 종전 정규식 주석 제거는 줄 끝 주석·문자열 안 '/*'·trailing comma에 취약했다).
			const { value: parsed, errors } = parseJsonc<{ configurations?: unknown }>(text);
			if (errors.length > 0) { return undefined; }
			const configs: any[] = Array.isArray(parsed?.configurations) ? (parsed!.configurations as any[]) : [];
			const gplCfg = configs.find(c => c?.type === 'brooks-gpl');
			if (!gplCfg) { return undefined; }
			const rawIp = typeof gplCfg.controllerIp === 'string' ? gplCfg.controllerIp.trim() : '';
			const rawPort = gplCfg.controllerPort;
			const rawProject = typeof gplCfg.projectName === 'string' ? gplCfg.projectName.trim() : '';

			const ip = resolveLaunchVariables(rawIp, folder);
			const projectName = resolveLaunchVariables(rawProject, folder);
			let port: number | undefined;
			if (typeof rawPort === 'number') {
				port = rawPort;
			} else if (typeof rawPort === 'string') {
				const resolvedPort = resolveLaunchVariables(rawPort.trim(), folder);
				const n = Number(resolvedPort);
				if (Number.isFinite(n) && n > 0) { port = n; }
			}
			return {
				ip: ip || undefined,
				port,
				projectName: projectName || undefined,
			};
		} catch {
			return undefined;
		}
	}

	/**
	 * launch.json 값에 포함된 VS Code 변수 placeholder를 해석한다.
	 * 지원: ${config:NAMESPACE.KEY}, ${env:VAR}, ${workspaceFolder}, ${workspaceFolderBasename}.
	 * 해석 실패 또는 빈 결과면 빈 문자열 반환 (자기참조 ${config:gpl.controller.ip} 같은 케이스 안전 처리).
	 */
	function resolveLaunchVariables(value: string, folder: vscode.WorkspaceFolder): string {
		if (!value) { return ''; }
		// placeholder가 없으면 그대로 반환
		if (!value.includes('${')) { return value; }

		const replaced = value.replace(/\$\{([^}]+)\}/g, (_match, expr: string) => {
			const trimmed = expr.trim();
			if (trimmed === 'workspaceFolder') {
				return folder.uri.fsPath;
			}
			if (trimmed === 'workspaceFolderBasename') {
				return path.basename(folder.uri.fsPath);
			}
			if (trimmed.startsWith('config:')) {
				const key = trimmed.slice('config:'.length).trim();
				const v = vscode.workspace.getConfiguration().get<unknown>(key);
				return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
			}
			if (trimmed.startsWith('env:')) {
				const name = trimmed.slice('env:'.length).trim();
				return process.env[name] ?? '';
			}
			// 미지원 placeholder는 빈 문자열 (사이드바에 ${...} 리터럴이 노출되는 것 방지)
			return '';
		});

		// 해석 후에도 ${ 가 남아있으면 부분 실패로 간주 — 호출자가 폴백하도록 빈 문자열
		if (replaced.includes('${')) { return ''; }
		return replaced.trim();
	}

	/**
	 * expected project 이름 결정: launch.json 우선 → Project.gpr 기반 폴백.
	 */
	async function resolveExpectedProjectName(): Promise<string> {
		const fromLaunch = readLaunchControllerInfo()?.projectName;
		if (fromLaunch) { return fromLaunch; }
		return await detectWorkspaceProjectName();
	}

	async function createOrUpdateLaunchJson(): Promise<string | undefined> {
		const folder = getPreferredWorkspaceFolder();
		if (!folder) {
			vscode.window.showWarningMessage('워크스페이스 폴더가 없어 launch.json을 만들 수 없습니다.');
			return undefined;
		}

		const cfg = getControllerConfig();
		const detectedProjectName = await detectWorkspaceProjectName();
		const projectName = detectedProjectName || path.basename(folder.uri.fsPath);
		const vscodeDir = path.join(folder.uri.fsPath, '.vscode');
		const launchPath = path.join(vscodeDir, 'launch.json');

		const attachConfig = {
			name: `GPL: Attach (${projectName})`,
			type: 'brooks-gpl',
			request: 'attach',
			controllerIp: cfg.ip,
			controllerPort: cfg.port,
			projectName,
			deployBeforeAttach: true,
			stopOnEntry: false,
		};

		const stopOnEntryConfig = {
			name: `GPL: Attach (${projectName}) — Stop on Entry`,
			type: 'brooks-gpl',
			request: 'attach',
			controllerIp: cfg.ip,
			controllerPort: cfg.port,
			projectName,
			deployBeforeAttach: true,
			stopOnEntry: true,
		};

		// GitHub #30: launch.json 은 JSONC 다. 종전에는 엄격한 JSON.parse 로 읽어 주석 한 줄에도 "파싱 실패"로 중단했고,
		// 갱신은 JSON.stringify 로 파일 전체를 다시 써 사용자의 주석·${config:…} 참조·들여쓰기를 지웠다.
		// 이제 jsonc-parser 로 읽고, 같은 name 의 GPL 구성 항목만 modify/applyEdits 로 부분 갱신해 나머지를 보존한다.
		let currentText = '';
		if (fs.existsSync(launchPath)) {
			currentText = fs.readFileSync(launchPath, 'utf8');
		}
		let nextText: string;
		const actions: string[] = [];
		try {
			const first = upsertLaunchConfiguration(currentText, attachConfig);
			const second = upsertLaunchConfiguration(first.text, stopOnEntryConfig);
			nextText = second.text;
			actions.push(`${attachConfig.name}: ${first.action}`, `${stopOnEntryConfig.name}: ${second.action}`);
		} catch (err: any) {
			// 메시지에 줄/열이 들어 있다(launchJsonc.describeJsoncErrors). 파일은 건드리지 않는다.
			vscode.window.showErrorMessage(`${err?.message ?? err} — ${launchPath}`);
			logOutput(`[launch.json] ${err?.message ?? err}`);
			return undefined;
		}

		fs.mkdirSync(vscodeDir, { recursive: true });
		if (nextText !== currentText) {
			fs.writeFileSync(launchPath, nextText, 'utf8');
		}
		logOutput(`[launch.json] ${actions.join(' / ')} (${nextText === currentText ? '변경 없음' : '주석·다른 구성 보존, GPL 항목만 갱신'})`);
		return launchPath;
	}

	// 연결 유실 감지 → 상태바 + 알림 갱신 (구독 해제를 위해 subscriptions에 등록)
	context.subscriptions.push(
		controllerTree.onDidLoseConnection(() => {
			const cfg = getControllerConfig();
			const lostAt = new Date();
			stopRuntimeConsoleAndSyncTree();
			setControllerConnected(false);
			// keep-alive 1402 소켓도 폐기 — 죽은 제어기에 stale 재시도를 쌓지 않는다(GitHub #22).
			closeControllerConnection('connection lost');
			// disconnect 명령과 동일하게 낡은 런타임 에러 컨텍스트를 정리한다.
			lastRuntimeErrorContext = undefined;
			controllerTree?.setRuntimeErrorContext(undefined);
			logOutput(`[Controller] Connection lost (3 consecutive failures) — ${cfg.ip}:${cfg.port} @ ${lostAt.toLocaleTimeString()}`);
			// 사후 스냅샷(#22 제안 4): 알림은 스냅샷이 준비된 뒤 한 번만 — 파일 열기 버튼 제공.
			void writeConnectionLostPostmortem(cfg, lostAt, logOutput).then(file => {
				const actions = file ? ['사후 스냅샷 열기', '출력 보기'] : ['출력 보기'];
				void vscode.window.showWarningMessage(
					`GPL Controller 연결이 끊어졌습니다 (${cfg.ip}). ` + (file ? '마지막 트래픽·도달성 판정을 사후 스냅샷 파일로 남겼습니다.' : ''),
					...actions,
				).then(pick => {
					if (pick === '사후 스냅샷 열기' && file) { void vscode.window.showTextDocument(vscode.Uri.file(file), { preview: false }); }
					if (pick === '출력 보기') { outputChannel.show(true); }
				});
			});
		})
	);

	// ── Controller commands ──────────────────────────────────

	// ── 제어기 연결: 대화형 + 비대화형 (GitHub #25) ──────────────────────────
	// 인자 없이 부르면(트리/상태바/팔레트) 종전과 같은 대화형 흐름(IP 입력 상자 → 저장 여부 QuickPick)이고,
	// ConnectArgs 객체가 오면 UI 없이 연결을 시도해 결과를 반환값으로 돌려준다(AI 계층·URI 핸들러·다른 확장 진입점용).
	interface ConnectArgs {
		/** 생략 시 현재 값(launch.json > 세션 오버라이드 > settings) 그대로 */
		ip?: string;
		port?: number;
		/** 'session'(기본): 세션 오버라이드만 / 'settings': settings.json(Global)에 저장 */
		save?: 'session' | 'settings';
		/** true면 알림 팝업 대신 Output 로그만 남긴다 */
		silent?: boolean;
	}
	interface ConnectResult {
		ok: boolean;
		ip: string;
		port: number;
		connected: boolean;
		error?: string;
		/** 'interactive' = 입력 상자 경로, 'args' = 비대화형 */
		mode: 'interactive' | 'args';
	}
	const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

	function isConnectArgs(v: unknown): v is ConnectArgs {
		if (!v || typeof v !== 'object') { return false; }
		const a = v as Record<string, unknown>;
		return 'ip' in a || 'port' in a || 'save' in a || 'silent' in a;
	}

	/** IP/port 확정 뒤 공통 절차: 프로젝트 컨텍스트 → testConnection(ErrorLog 1회) → 상태 반영 → 1403 자동 시작. */
	async function finishConnect(mode: ConnectResult['mode'], silent: boolean): Promise<ConnectResult> {
		const expected = await resolveExpectedProjectName();
		const projectContext = await detectWorkspaceProjectContext();
		controllerTree?.setExpectedProjectContext(projectContext.projectName || expected, projectContext.folderName || expected);
		const cfg = getControllerConfig();
		logOutput(`[Controller] Connecting to ${cfg.ip}:${cfg.port} …${mode === 'args' ? ' (non-interactive)' : ''}`);
		try {
			const ok = await testConnection(cfg);
			if (ok) {
				logOutput(`[Controller] Connected: ${cfg.ip}:${cfg.port}`);
				if (!silent) { vscode.window.showInformationMessage(`GPL Controller 연결 성공: ${cfg.ip}`); }
				setControllerConnected(true);
				// controller 연결 성공 시 1403도 바로 유지 연결한다.
				try { ensureRuntimeConsole(); } catch (err: any) {
					logOutput(`[Console] auto-start on connect failed: ${err?.message ?? err}`);
				}
				return { ok: true, ip: cfg.ip, port: cfg.port, connected: true, mode };
			}
			logOutput(`[Controller] Connection failed: ${cfg.ip}:${cfg.port} (ErrorLog 프로브에 <STATUS> 없음)`);
			if (!silent) { vscode.window.showErrorMessage(`GPL Controller 연결 실패: ${cfg.ip}`); }
			setControllerConnected(false);
			return { ok: false, ip: cfg.ip, port: cfg.port, connected: false, error: 'probe-failed', mode };
		} catch (err: any) {
			const detail = err?.message ?? String(err);
			logOutput(`[Controller] Connection error: ${detail}`);
			if (!silent) { vscode.window.showErrorMessage(`연결 오류: ${detail}`); }
			setControllerConnected(false);
			return { ok: false, ip: cfg.ip, port: cfg.port, connected: false, error: detail, mode };
		}
	}

	/** 비대화형 연결(GitHub #25 A). ip 생략 시 launch.json > 세션 오버라이드 > settings 순의 현재 값을 쓴다. */
	async function connectControllerWithArgs(args: ConnectArgs): Promise<ConnectResult> {
		const currentCfg = getControllerConfig();
		const launchInfo = readLaunchControllerInfo();
		const ip = String(args.ip ?? launchInfo?.ip ?? currentCfg.ip).trim();
		const port = args.port ?? (args.ip ? currentCfg.port : (launchInfo?.port ?? currentCfg.port));
		if (!IPV4_RE.test(ip)) {
			logOutput(`[Controller] connect 거부 — 잘못된 IP: ${ip}`);
			return { ok: false, ip, port, connected: false, error: 'invalid-ip', mode: 'args' };
		}
		if (!Number.isInteger(port) || port <= 0 || port > 65535) {
			logOutput(`[Controller] connect 거부 — 잘못된 port: ${port}`);
			return { ok: false, ip, port, connected: false, error: 'invalid-port', mode: 'args' };
		}
		if (args.save === 'settings') {
			const section = vscode.workspace.getConfiguration('gpl.controller');
			await section.update('ip', ip, vscode.ConfigurationTarget.Global);
			if (port !== (section.get<number>('port') ?? currentCfg.port)) {
				await section.update('port', port, vscode.ConfigurationTarget.Global);
			}
			clearSessionControllerOverride();
		} else {
			// 기본 'session': 디스크에 쓰지 않고 이 세션의 후속 명령에만 적용한다.
			setSessionControllerOverride(ip, port);
		}
		return finishConnect('args', args.silent === true);
	}

	/** 대화형 연결(종전 동작). 취소하면 { ok: false, error: 'cancelled' }. */
	async function connectControllerInteractive(): Promise<ConnectResult> {
		const currentCfg = getControllerConfig();
		const launchInfo = readLaunchControllerInfo();
		const cancelled = (): ConnectResult => ({
			ok: false, ip: currentCfg.ip, port: currentCfg.port,
			connected: controllerTree?.isConnected ?? false, error: 'cancelled', mode: 'interactive',
		});
		// 기본값 우선순위: launch.json > 현재 cfg(세션 오버라이드 포함) > settings
		const defaultIp = launchInfo?.ip || currentCfg.ip;
		const inputIp = await vscode.window.showInputBox({
			prompt: launchInfo?.ip
				? `제어기 IP (launch.json 기본값: ${launchInfo.ip})`
				: '제어기 IP 주소를 입력하세요',
			value: defaultIp,
			placeHolder: '192.168.0.1',
			validateInput: (v) => IPV4_RE.test(v) ? null : '올바른 IP 형식이 아닙니다 (예: 192.168.0.1)',
		});
		if (!inputIp) { return cancelled(); }

		// IP 변경 시 저장 여부 확인. launch.json IP를 그대로 받아들인 경우는
		// settings에 굳이 쓰지 않고 세션 오버라이드만 적용한다.
		if (inputIp !== currentCfg.ip) {
			const fromLaunch = launchInfo?.ip === inputIp;
			const choices: vscode.QuickPickItem[] = fromLaunch
				? [
					{ label: '이번만 사용', description: 'launch.json 값을 세션 한정으로 사용' },
					{ label: '저장', description: `settings.json에 ${inputIp} 저장` },
				]
				: [
					{ label: '저장', description: `settings.json에 ${inputIp} 저장` },
					{ label: '이번만 사용', description: '이 세션 동안만 적용 (재시작 시 초기화)' },
				];
			const save = await vscode.window.showQuickPick(choices, {
				placeHolder: `IP를 ${inputIp}(으)로 변경합니다`,
			});
			if (!save) { return cancelled(); }
			if (save.label === '저장') {
				await vscode.workspace.getConfiguration('gpl.controller').update('ip', inputIp, vscode.ConfigurationTarget.Global);
				clearSessionControllerOverride();
			} else {
				setSessionControllerOverride(inputIp, launchInfo?.port);
			}
		} else if (launchInfo?.port && launchInfo.port !== currentCfg.port) {
			// IP는 같지만 launch.json이 다른 port를 지정한 경우 세션 오버라이드 적용
			setSessionControllerOverride(inputIp, launchInfo.port);
		}
		return finishConnect('interactive', false);
	}

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.connect', async (args?: unknown): Promise<ConnectResult> => {
			// 인자가 ConnectArgs 형태일 때만 비대화형 — 트리/상태바/팔레트 호출(인자 없음)은 종전과 동일한 대화형.
			return isConnectArgs(args) ? connectControllerWithArgs(args) : connectControllerInteractive();
		})
	);

	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor((editor) => {
			if (editor?.document && isGplDocument(editor.document)) {
				scheduleExpectedProjectSync('active GPL document changed');
			}
		}),
		vscode.workspace.onDidChangeWorkspaceFolders(() => {
			scheduleExpectedProjectSync('workspace folders changed');
		}),
		vscode.workspace.onDidSaveTextDocument((doc) => {
			if (isGplDocument(doc)) {
				scheduleExpectedProjectSync('GPL document saved');
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.debug.generateLaunch', async () => {
			const launchPath = await createOrUpdateLaunchJson();
			if (!launchPath) { return; }

			const choice = await vscode.window.showInformationMessage(
				'디버깅 구성을 생성/업데이트했습니다.',
				'파일 열기',
			);
			if (choice === '파일 열기') {
				const doc = await vscode.workspace.openTextDocument(launchPath);
				await vscode.window.showTextDocument(doc, { preview: false });
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.debug.attachNow', async () => {
			// 중복 세션 방지: 이미 brooks-gpl 세션이 살아있으면 사용자에게 처리 방식 선택을 요청
			const existing = vscode.debug.activeDebugSession;
			const hasGplSession = existing?.type === 'brooks-gpl';
			if (hasGplSession) {
				const pick = await vscode.window.showWarningMessage(
					'GPL 디버그 세션이 이미 실행 중입니다.',
					{ modal: false },
					'기존 세션 유지',
					'중단하고 다시 시작',
				);
				if (pick === '기존 세션 유지' || pick === undefined) {
					return;
				}
				// 중단하고 다시 시작
				try {
					await vscode.debug.stopDebugging(existing);
					// 세션 정리 시간을 짧게 대기 (DAP terminated 이벤트 처리)
					await new Promise(r => setTimeout(r, 400));
				} catch {
					// 무시: stopDebugging이 실패해도 새 세션 시작은 시도
				}
			}

			const cfg = getControllerConfig();
			const projectName = await resolveExpectedProjectName();
			const launchInfo = readLaunchControllerInfo();

			const dynamicConfig: vscode.DebugConfiguration = {
				type: 'brooks-gpl',
				request: 'attach',
				name: projectName ? `GPL Quick Attach (${projectName})` : 'GPL Quick Attach',
				controllerIp: launchInfo?.ip || cfg.ip,
				controllerPort: launchInfo?.port || cfg.port,
				projectName,
				deployBeforeAttach: true,
				stopOnEntry: false,
			};

			const started = await vscode.debug.startDebugging(undefined, dynamicConfig);
			if (!started) {
				vscode.window.showErrorMessage('디버깅 시작 실패: 구성 또는 제어기 상태를 확인해줘.');
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.disconnect', (args?: unknown) => {
			// 싱글톤 인스턴스는 보존하고 연결만 끊는다 (v0.5.48 일관성).
			// 반환값·silent 인자는 AI/URI 진입점용(GitHub #25) — 사람이 누를 때(인자 없음)는 종전과 동일하게 알림을 띄운다.
			const silent = !!args && typeof args === 'object' && (args as { silent?: boolean }).silent === true;
			const cfg = getControllerConfig();
			stopRuntimeConsoleAndSyncTree();
			closeControllerConnection('disconnect');
			clearSessionControllerOverride();
			setControllerConnected(false);
			lastRuntimeErrorContext = undefined;
			controllerTree?.setRuntimeErrorContext(undefined);
			logOutput(`[Controller] Disconnected: ${cfg.ip}:${cfg.port}${silent ? ' (silent)' : ''}`);
			if (!silent) { vscode.window.showInformationMessage('GPL Controller 연결 해제'); }
			return { ok: true, connected: false, ip: cfg.ip, port: cfg.port };
		})
	);

	// --- Deploy helper (공통 로직) ---
	type QuickDeployOpts = { skipStop?: boolean; skipUnchanged?: boolean; quick?: boolean; changedFiles?: string[]; overrideProjectDir?: string; noStopPrompt?: boolean; autoGate?: boolean };

	/**
	 * 배포 진입점. 잠금은 deploy() 안에서 — 프로젝트 선택/미저장 확인 UI가 끝난 뒤 — 획득한다(UI 대기 중 잠금 금지, 이슈 #15).
	 * 여기서는 이미 잡혀 있으면 컨텍스트와 함께 경고하고 바로 끝낸다. 결과는 호출측(autoOnSave 재예약, Start 전 Compile)이 쓴다.
	 */
	async function runDeploy(skipStart: boolean, quickOpts?: QuickDeployOpts): Promise<DeployResult | undefined> {
		const holder = currentDeployLockHolder();
		if (holder) {
			if (quickOpts?.changedFiles?.length) {
				logOutput(`[QuickCompile] autoOnSave 대기 — 배포 잠금 보유 중 (${describeDeployLock(holder)})`);
			} else {
				warnDeployBusy(quickOpts?.quick ? 'Quick Compile' : 'Deploy', holder, '완료 후 다시 시도하세요');
			}
			return makeLockedResult(holder);
		}
		return runDeployCore(skipStart, quickOpts);
	}

	/**
	 * Start 전 "컴파일 검증 필요" 상태 확인. PA 제어기의 Start는 자체적으로 Compile을 수행하므로(§0.7) 소스에 에러가
	 * 있으면 Start가 실패하고 Problems 연동도 없다 — 먼저 Compile로 검증할지 묻는다. 단 Compile 직후 Start를 연속으로
	 * 보내지 않으므로(한 번에 하나만, 컴파일 중복 회피) "Compile만 실행"을 고르면 Start는 하지 않는다. true면 Start 진행.
	 */
	async function confirmStartWhenCompileStale(projectName: string, projectDir?: string): Promise<boolean> {
		const stale = findCompileStale(projectName);
		if (!stale) { return true; }
		const dir = projectDir ?? stale.projectDir;
		const choices = dir ? ['Compile만 실행', '그대로 Start'] : ['그대로 Start'];
		const pick = await vscode.window.showWarningMessage(
			`'${projectName}'의 /GPL 소스가 아직 Compile로 검증되지 않았습니다. Start는 제어기가 자체 컴파일하므로 소스에 에러가 있으면 Start가 실패합니다(Problems 연동 없음).`,
			{
				modal: true,
				detail: `사유: ${stale.reason}\n발생: ${new Date(stale.since).toLocaleString()}\n\n` +
					'"Compile만 실행"은 에러를 확인만 하고 Start하지 않습니다(Compile 직후 Start 연속 실행은 피함 — 한 번에 하나만).',
			},
			...choices,
		);
		if (pick === 'Compile만 실행') {
			await runDeploy(true, { skipStop: true, skipUnchanged: true, quick: true, overrideProjectDir: dir });
			return false;
		}
		return pick === '그대로 Start';
	}

	/**
	 * projectDir 하위의 저장되지 않은(dirty) 파일이 있으면 저장 여부를 모달로 확인하고 저장한다.
	 * 업로드는 디스크 내용을 올리므로, 미저장 편집분이 있으면 이전 내용이 올라가 혼동을 유발한다
	 * (Start 확인 모달과 같은 패턴 — '저장 후 계속' + 취소).
	 * 반환: ok=false면 사용자가 취소했거나 저장 실패 — 호출측은 업로드를 시작하지 말 것.
	 * ※ autoOnSave 같은 저장-트리거 경로에서는 호출 금지(저장 경로에서는 UI를 띄우지 않는다).
	 */
	async function confirmSaveDirtyProjectDocs(projectDir: string): Promise<{ ok: boolean; savedFiles: string[] }> {
		const root = path.resolve(projectDir);
		const dirtyDocs = vscode.workspace.textDocuments.filter(doc => {
			if (doc.uri.scheme !== 'file' || !doc.isDirty) { return false; }
			const rel = path.relative(root, path.resolve(doc.uri.fsPath));
			return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
		});
		if (dirtyDocs.length === 0) { return { ok: true, savedFiles: [] }; }

		const names = dirtyDocs.map(d => path.basename(d.uri.fsPath)).join('\n');
		const pick = await vscode.window.showWarningMessage(
			`저장되지 않은 파일 ${dirtyDocs.length}개가 있습니다. 저장 후 업로드할까요?`,
			{ modal: true, detail: `저장하지 않으면 디스크의 이전 내용이 업로드됩니다.\n\n${names}` },
			'저장 후 계속'
		);
		if (pick !== '저장 후 계속') { return { ok: false, savedFiles: [] }; }

		const savedFiles: string[] = [];
		for (const doc of dirtyDocs) {
			if (await doc.save()) {
				savedFiles.push(doc.uri.fsPath);
			} else {
				vscode.window.showErrorMessage(`파일 저장 실패: ${path.basename(doc.uri.fsPath)} — 업로드를 중단합니다.`);
				return { ok: false, savedFiles };
			}
		}
		return { ok: true, savedFiles };
	}

	async function runDeployCore(skipStart: boolean, quickOpts?: QuickDeployOpts): Promise<DeployResult | undefined> {
		const modeLabel: SituationDeploySnapshot['mode'] = skipStart ? 'Build' : 'Deploy & Run';
		const uniqueCodes = (values: number[]): number[] => [...new Set(values)];
		const buildOutcomeSignature = (result: Awaited<ReturnType<typeof deploy>>, controllerSystemCodes: number[]): string => {
			const compileCodes = uniqueCodes(result.compileErrors.map(e => e.code)).sort((a, b) => a - b);
			const systemCodes = uniqueCodes(controllerSystemCodes).sort((a, b) => a - b);
			const status = typeof result.failedStatusCode === 'number' ? result.failedStatusCode : 'none';
			return [
				result.success ? 'success' : 'fail',
				result.failedPhase ?? 'SUCCESS',
				result.failedCommand ?? '-',
				`status:${status}`,
				`compile:${compileCodes.join(',') || 'none'}`,
				`system:${systemCodes.join(',') || 'none'}`,
			].join('|');
		};
		const makeRawCompileSummary = (result: Awaited<ReturnType<typeof deploy>>): string[] => {
			return result.compileAttemptLogs.map(attempt => {
				const firstLine = attempt.raw.replace(/\r/g, '').split('\n').map(l => l.trim()).find(Boolean) || '(empty)';
				const incompleteMeta = attempt.responseMeta && !attempt.responseMeta.responseComplete
					? ` / responseComplete=false bytes=${attempt.responseMeta.bytesReceived} idle=${attempt.responseMeta.idleTimeoutMs}ms`
					: '';
				const note = attempt.note ? ` / note=${attempt.note}` : '';
				return `${attempt.command} / STATUS ${attempt.statusCode}${incompleteMeta}${note} / ${firstLine}`;
			});
		};
		const makeDeploySnapshot = (
			success: boolean,
			lastStage: SituationDeploySnapshot['lastStage'],
			summary: string,
			compileErrorCodes: number[],
			controllerSystemCodes: number[],
			comparisonNote?: string,
			unverifiableReason?: string,
			compileRawSummary?: string[],
		): SituationDeploySnapshot => ({
			mode: modeLabel,
			success,
			lastStage,
			compileErrorCodes: uniqueCodes(compileErrorCodes),
			controllerSystemCodes: uniqueCodes(controllerSystemCodes),
			updatedAt: Date.now(),
			summary,
			comparisonNote,
			unverifiableReason,
			compileRawSummary,
		});

		const cfg = getControllerConfig();

		let projectDir: string;
		if (quickOpts?.overrideProjectDir) {
			// 저장 파일이 속한 프로젝트가 이미 결정된 경우(autoOnSave 등) QuickPick 없이 그대로 사용.
			projectDir = quickOpts.overrideProjectDir;
		} else {
			const picked = await pickWorkspaceProjectDir('배포할 프로젝트를 선택하세요');
			if (!picked) { return; }
			projectDir = picked;
		}

		// 업로드 전 미저장 파일 확인 — 수동 경로(Deploy/Quick Compile)만.
		// autoOnSave(changedFiles) 경로는 저장이 트리거라 대상 파일이 방금 저장됐고, 저장 경로에서는 UI를 띄우지 않는다.
		if (!quickOpts?.changedFiles?.length) {
			const dirty = await confirmSaveDirtyProjectDocs(projectDir);
			if (!dirty.ok) {
				logOutput('[Deploy] 미저장 파일 확인에서 취소됨 — 업로드를 시작하지 않음');
				return;
			}
			// 방금 저장한 파일이 autoOnSave pending에 들어갔다면 이번 업로드가 함께 처리하므로 제거(중복 컴파일 방지).
			for (const f of dirty.savedFiles) { quickCompilePendingFiles.delete(f); }
		}

		const mode = quickOpts?.quick ? 'Quick Compile' : skipStart ? 'Build' : 'Deploy & Run';
		logOutput(`[Deploy] Starting ${mode}: ${projectDir} → ${cfg.ip}`);
		outputChannel.show(true);

		let deployRuntimeConsole: RuntimeConsole | undefined;
		if (!skipStart) {
			try {
				deployRuntimeConsole = ensureRuntimeConsole();
				await deployRuntimeConsole.waitUntilReady(800);
				logOutput('[Deploy] Runtime console primed before Start');
			} catch (err: any) {
				logOutput(`[Console] pre-start failed: ${err?.message ?? err}`);
			}
		}

		try {
			const result = await deploy({
				projectDir,
				skipStart,
				skipStop: quickOpts?.skipStop,
				skipUnchanged: quickOpts?.skipUnchanged,
				changedFiles: quickOpts?.changedFiles,
				autoGate: quickOpts?.autoGate,
				// 배포 잠금 레코드의 owner — 다른 창/MCP가 "누가 잡고 있는지" 볼 수 있게 경로별로 구분.
				lockOwner: quickOpts?.changedFiles?.length ? 'autoOnSave Quick Compile' : (quickOpts?.quick ? 'Quick Compile' : 'Deploy'),
				// 모든 배포는 /GPL 직접 업로드가 기본 (테스트는 /GPL, flash 저장은 gpl.saveToFlash 담당).
				// /GPL/<name>이 없으면 FTP로 생성 — 단 changedFiles(autoOnSave) 경로는 클래식 폴백.
				directGpl: true,
				// 활성 쓰레드 감지 시 사용자에게 Stop -all 여부를 모달로 확인.
				// autoOnSave 경로(noStopPrompt)는 저장마다 팝업이 뜨면 방해되므로 조용히 중단 유지.
				confirmStopOnActive: quickOpts?.quick && !quickOpts?.noStopPrompt
					? async (activeDesc: string) => {
						const pick = await vscode.window.showWarningMessage(
							'실행 중인 쓰레드가 있습니다. Stop -all로 정지한 후 Quick Compile을 계속할까요?',
							{ modal: true, detail: `활성 쓰레드: ${activeDesc}` },
							'Stop 후 계속'
						);
						return pick === 'Stop 후 계속';
					}
					: undefined,
				beforeStart: skipStart ? undefined : async () => {
					const console = ensureRuntimeConsole();
					console.primeForRuntimeStart();
					await console.waitUntilReady(1200);
					controllerTree?.setRuntimeConsoleStatus(console.getStatusSnapshot());
				},
			}, outputChannel, deployDiagnostics);

			// 배포 잠금 보유 중(UI 확인이 끝난 사이 다른 창/autoOnSave가 먼저 잡은 경우) — 컨텍스트와 함께 안내.
			if (result.failedPhase === 'LOCKED') {
				if (quickOpts?.changedFiles?.length) {
					logOutput(`[QuickCompile] autoOnSave 대기 — ${result.failedStatusMessage ?? '배포 잠금 보유 중'}`);
				} else if (result.lockHolder) {
					warnDeployBusy(mode, result.lockHolder, '완료 후 다시 시도하세요');
				}
				return result;
			}

			// autoOnSave 자동 게이트 미충족 — 실패가 아니라 "스킵"이다.
			// 저장마다 팝업/패널 포커스/스냅샷 기록이 생기면 방해되므로 로그 한 줄만 남긴다.
			if (!result.success && result.failedPhase === 'AUTO_GATE') {
				logOutput(`[QuickCompile] autoOnSave 건너뜀: ${result.failedStatusMessage ?? '게이트 미충족'}`);
				return result;
			}

			// 업로드는 됐지만 Compile은 보류(autoOnSave: 쓰레드 존재) — 팝업 없이 "컴파일 필요" 상태로만 표시(이슈 #17).
			if (!result.success && result.failedPhase === 'COMPILE_DEFERRED') {
				markCompileStale(result.projectName, 'autoOnSave 업로드 후 Compile 보류(쓰레드 존재)', projectDir);
				logOutput(`[QuickCompile] autoOnSave: ${result.failedStatusMessage ?? '업로드 완료, Compile 보류'}`);
				return result;
			}

			// 활성 쓰레드 + Stop 미승인(또는 자동 경로) — 업로드는 완료, Compile 미수행. 실패가 아닌 "중단"으로 다룬다.
			if (!result.success && result.failedPhase === 'THREAD_CHECK') {
				markCompileStale(result.projectName, `${mode} 업로드 후 Compile 미수행(활성 쓰레드)`, projectDir);
				const msg = `${mode} 중단: ${result.failedStatusMessage ?? '활성 쓰레드 존재'}`;
				logOutput(`[Deploy] ${msg}`);
				lastDeploySnapshot = makeDeploySnapshot(false, 'THREAD_CHECK', msg, [], []);
				if (!quickOpts?.changedFiles?.length) { vscode.window.showWarningMessage(msg); }
				return result;
			}

			// errorLog를 제어기 시스템 에러 / GPL 배포 에러로 분류해 출력 채널에 기록한다.
			// 이 함수는 성공·실패 경로 공통으로 호출된다.
			function logErrorLogSections(): { sysCount: number; deployErrCount: number } {
				let sysCount = 0;
				let deployErrCount = 0;
				if (result.errorLog.length === 0) { return { sysCount, deployErrCount }; }

				logOutput('');
				logOutput('── [ErrorLog 분류] ──────────────────────────────────────');
				// 같은 코드가 연달아 나오면(예: Trj/AutoEx 동시 -1600) 동일한 설명이 항목마다
				// 반복돼 로그가 부푼다 — 부가 설명(detail/해석/권장)은 코드당 한 번만 출력한다.
				const printedNotes = new Set<string>();
				for (const entry of result.errorLog) {
					const c = classifyErrorEntry(entry);
					const code = extractErrorCodeFromEntry(entry) ?? c.parsedCode;
					const hint = typeof code === 'number' ? getErrorCodeHint(code) : undefined;
					const noteKey = typeof code === 'number' ? `code:${code}` : `text:${c.summary}`;
					const firstOfCode = !printedNotes.has(noteKey);
					printedNotes.add(noteKey);
					if (c.isControllerSystem) {
						sysCount++;
						logOutput(`[⚠ 환경 경고] ${typeof code === 'number' ? `[${code}] ` : ''}${c.summary}`);
						if (firstOfCode) {
							if (c.detail) { logOutput(`          ${c.detail}`); }
							if (hint) {
								logOutput(`          해석: ${hint.meaning}`);
								logOutput(`          권장: ${hint.action}`);
							}
						}
					} else {
						deployErrCount++;
						logOutput(`[✘ 코드/배포 에러] ${typeof code === 'number' ? `[${code}] ` : ''}${c.summary}`);
						if (firstOfCode && hint) {
							logOutput(`          해석: ${hint.meaning}`);
							logOutput(`          권장: ${hint.action}`);
						}
					}
				}
				logOutput('─────────────────────────────────────────────────────────');
				return { sysCount, deployErrCount };
			}

			function logCompileRawSection(): void {
				if (result.compileAttemptLogs.length === 0) { return; }
				logOutput('');
				logOutput('── [COMPILE 원문 로그] ──────────────────────────────────');
				for (const attempt of result.compileAttemptLogs) {
					logOutput(`[${attempt.command}] STATUS ${attempt.statusCode}`);
					if (attempt.note) {
						logOutput(`  note: ${attempt.note}`);
					}
					if (attempt.responseMeta && (!attempt.responseMeta.responseComplete || !attempt.responseMeta.statusTagReceived || !attempt.responseMeta.dataTagClosed)) {
						logOutput(`  responseComplete=${attempt.responseMeta.responseComplete}`);
						logOutput(`  bytesReceived=${attempt.responseMeta.bytesReceived}`);
						logOutput(`  lastChunkAt=${attempt.responseMeta.lastChunkAt}`);
						logOutput(`  idleTimeoutMs=${attempt.responseMeta.idleTimeoutMs}`);
					}
					logOutput(attempt.raw || '(empty)');
					if (attempt.errors.length > 0) {
						for (const ce of attempt.errors) {
							logOutput(`  -> ${ce.file}:${ce.line} (${ce.code}) ${ce.message}`);
						}
					}
				}
				if (result.precheckWarnings.length > 0) {
					logOutput('  precheckWarnings:');
					for (const w of result.precheckWarnings) {
						logOutput(`  - ${w}`);
					}
				}
				logOutput('─────────────────────────────────────────────────────────');
			}

			if (result.success) {
				clearCompileStale(result.projectName);
				const controllerSystemCodes = result.errorLog
					.map(e => classifyErrorEntry(e).parsedCode)
					.filter((code): code is number => typeof code === 'number');
				const signature = buildOutcomeSignature(result, controllerSystemCodes);
				const samePattern = deployOutcomeHistory.filter(h => h.signature === signature);
				const comparisonNote = samePattern.length > 0
					? `회귀 아님: 동일 결과 패턴 ${samePattern.length + 1}회 관측`
					: undefined;
				pushDeployOutcome({ mode: modeLabel, signature, timestamp: Date.now(), summary: result.success ? '성공' : '실패' });
				const deployedFolderName = path.basename(projectDir).trim();
				const remotePathInfo = result.selectedRemoteProjectPath
					? ` / 경로: ${result.selectedRemoteProjectPath}`
					: '';
				controllerTree?.setExpectedProjectContext(result.projectName, deployedFolderName);
				await controllerTree?.refreshAll();

				if (skipStart) {
					// Build Only 성공 후에도 1403 콘솔을 즉시 유지 연결한다.
					try {
						deployRuntimeConsole = ensureRuntimeConsole();
						await deployRuntimeConsole.waitUntilReady(800);
						logOutput('[Deploy] Runtime console auto-start after Build Only');
					} catch (err: any) {
						logOutput(`[Console] build-only auto-start failed: ${err?.message ?? err}`);
					}
					const { sysCount } = logErrorLogSections();
					if (sysCount > 0) {
						// Build Only이므로 START는 미실행. 제어기 시스템 에러는 배포와 무관하므로 경고만 표시.
						outputChannel.show(true);
						await vscode.window.showWarningMessage(
							`빌드 완료: ${result.projectName}. 제어기 시스템 경고 ${sysCount}건 (배포/GPL 오류 아님) → 출력 채널 확인`,
							'출력 보기',
						);
					} else {
						vscode.window.showInformationMessage(`빌드 완료: ${result.projectName}${remotePathInfo} (FTP/컨텍스트 갱신 완료, Start 미실행)`);
						consoleChannel.show(true);
					}
					lastDeploySnapshot = makeDeploySnapshot(
						true,
						'SUCCESS',
						sysCount > 0
							? `빌드 성공 / 제어기 시스템 경고 ${sysCount}건${remotePathInfo}`
							: `빌드 성공${remotePathInfo}`,
						[],
						controllerSystemCodes,
						comparisonNote,
					);
				} else {
					const { sysCount, deployErrCount } = logErrorLogSections();
					if (sysCount > 0 || deployErrCount > 0) {
						outputChannel.show(true);
						const parts: string[] = [];
						if (deployErrCount > 0) { parts.push(`배포 에러 ${deployErrCount}건`); }
						if (sysCount > 0) { parts.push(`제어기 시스템 경고 ${sysCount}건 (배포 원인 아님)`); }
						const action = await vscode.window.showWarningMessage(
							`배포 완료: ${result.projectName} — ${parts.join(' / ')}`,
							'출력 보기',
							'콘솔 보기',
						);
						if (action === '콘솔 보기') {
							if (!deployRuntimeConsole) {
								deployRuntimeConsole = ensureRuntimeConsole();
								await deployRuntimeConsole.waitUntilReady(800);
							}
							consoleChannel.show(true);
						} else {
							outputChannel.show(true);
						}
					} else {
						vscode.window.showInformationMessage(`배포 완료: ${result.projectName}${remotePathInfo}`);
						if (!deployRuntimeConsole && getAutoStartConsoleOnDeploy()) {
							deployRuntimeConsole = ensureRuntimeConsole();
							await deployRuntimeConsole.waitUntilReady(800);
						}
						consoleChannel.show(true);
					}
					lastDeploySnapshot = makeDeploySnapshot(
						true,
						'SUCCESS',
						sysCount > 0 || deployErrCount > 0
							? `배포 성공 / 배포 에러 ${deployErrCount}건 / 시스템 경고 ${sysCount}건${remotePathInfo}`
							: `배포 성공${remotePathInfo}`,
						[],
						controllerSystemCodes,
						comparisonNote,
					);
				}
			} else {
				logErrorLogSections();
				logCompileRawSection();
				outputChannel.show(true);
				if (result.uploadStats) {
					// 업로드는 됐고 Compile이 실패 — 컴파일본은 이전 상태이므로 Start 전 확인 대상.
					markCompileStale(result.projectName, `${mode} 업로드 후 Compile 실패(${result.failedPhase ?? 'FAIL'})`, projectDir);
				}
				const phaseLabel = result.failedPhase ? ` (${result.failedPhase} 단계)` : '';
				const sysErrors = result.errorLog.filter(e => classifyErrorEntry(e).isControllerSystem);
				const sysCodes = sysErrors
					.map(e => classifyErrorEntry(e).parsedCode)
					.filter((code): code is number => typeof code === 'number');
				const signature = buildOutcomeSignature(result, sysCodes);
				const samePattern = deployOutcomeHistory.filter(h => h.signature === signature);
				const comparisonNote = samePattern.length > 0
					? `회귀 아님: 동일 실패 패턴 ${samePattern.length + 1}회 관측`
					: undefined;
				pushDeployOutcome({ mode: modeLabel, signature, timestamp: Date.now(), summary: result.failedPhase ?? 'FAIL' });
				const sysLabel = sysErrors.length > 0
					? ` / 제어기 시스템 경고 ${sysErrors.length}건 (배포 원인 아님)`
					: '';
				const envBlocking = (result.failedPhase === 'COMPILE') && sysErrors.length > 0;
				const unverifiableReason = envBlocking ? '제어기 환경 오류가 COMPILE 단계에 존재' : undefined;
				const commandLabel = result.failedCommand ? ` / ${result.failedCommand}` : '';
				const statusLabel = typeof result.failedStatusCode === 'number'
					? ` / STATUS ${result.failedStatusCode}${result.failedStatusMessage ? ` (${result.failedStatusMessage})` : ''}`
					: '';

				let errMsg: string;
				if (envBlocking) {
					errMsg = `코드 수정 효과 검증 불가: COMPILE 환경 블로커 감지${phaseLabel}${commandLabel}${statusLabel}${sysLabel} — COMPILE 원문 로그 확인`;
				} else if (result.compileErrors.length > 0) {
					errMsg = `${result.compileErrors.length}개 컴파일 에러${phaseLabel}${commandLabel}${statusLabel}${sysLabel} — COMPILE 원문 로그 확인`;
					await jumpToFirstCompileError(result.compileErrors, projectDir,
						msg => outputChannel.appendLine(`[Deploy] ${msg}`));
				} else if (sysErrors.length > 0 && result.errorLog.length === sysErrors.length) {
					// 에러 로그 전체가 제어기 시스템 에러인 경우 — GPL 코드 원인 없음을 명시
					const firstSys = classifyErrorEntry(sysErrors[0]);
					errMsg = `${result.failedPhase ?? '단계 미상'} 단계 실패${commandLabel}${statusLabel} — GPL 코드 오류 없음, 제어기 시스템 경고 ${sysErrors.length}건: ${firstSys.summary}`;
				} else {
					errMsg = `알 수 없는 오류${phaseLabel}${commandLabel}${statusLabel}${sysLabel} — COMPILE 원문 로그 확인`;
				}
				if (comparisonNote) {
					errMsg = `${errMsg} / ${comparisonNote}`;
				}
				if (result.selectedRemoteProjectPath) {
					errMsg = `${errMsg} / 경로: ${result.selectedRemoteProjectPath}`;
				}

				vscode.window.showErrorMessage(`배포 실패: ${errMsg}`);
				lastDeploySnapshot = makeDeploySnapshot(
					false,
					(result.failedPhase ?? 'COMPILE') as SituationDeploySnapshot['lastStage'],
					errMsg,
					result.compileErrors.map(e => e.code),
					sysCodes,
					comparisonNote,
					unverifiableReason,
					makeRawCompileSummary(result),
				);
			}
			return result;
		} catch (err: any) {
			lastDeploySnapshot = {
				mode: modeLabel,
				success: false,
				lastStage: 'COMPILE',
				compileErrorCodes: [],
				controllerSystemCodes: [],
				updatedAt: Date.now(),
				summary: `배포 예외: ${err?.message ?? err}`,
			};
			vscode.window.showErrorMessage(`배포 오류: ${err.message ?? err}`);
			outputChannel.appendLine(`[Deploy] Error: ${err.stack ?? err}`);
		}
	}

	/** 워크스페이스에서 .gpr 프로젝트 폴더를 선택한다 (1개면 즉시, 여러 개면 QuickPick). */
	async function pickWorkspaceProjectDir(placeHolder: string): Promise<string | undefined> {
		const projectDirs = await findProjectDirs();
		if (projectDirs.length === 0) {
			vscode.window.showWarningMessage('워크스페이스에서 .gpr 프로젝트 파일을 찾을 수 없습니다.');
			return undefined;
		}
		if (projectDirs.length === 1) { return projectDirs[0]; }
		const pick = await vscode.window.showQuickPick(
			projectDirs.map(d => ({ label: d })),
			{ placeHolder }
		);
		return pick?.label;
	}

	/** 프로젝트 폴더의 .gpr에서 프로젝트명을 읽는다 (실패 시 undefined → 호출부에서 폴더명 폴백). */
	function readGprProjectName(projectDir: string): string | undefined {
		try {
			const gprFile = fs.readdirSync(projectDir).find(f => f.toLowerCase().endsWith('.gpr'));
			if (!gprFile) { return undefined; }
			return parseGpr(fs.readFileSync(path.join(projectDir, gprFile), 'utf8')).projectName || undefined;
		} catch {
			return undefined;
		}
	}

	// gpl.deploy — Stop + /GPL 직접 업로드 + Compile (Start 안 함, 디버그 친화)
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.deploy', () => runDeploy(true))
	);

	// gpl.start — 배포 없이 Start만 전송. (구 gpl.deployRun의 START 단계를 분리한 것.
	// Deploy와 Start를 합치지 않는다는 2026-07-24 결정 — 확인 모달은 동일하게 적용, §0.6)
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.start', async () => {
			// 업로드/컴파일 도중 Start가 겹치면 제어기 이상(사망)을 유발할 수 있다 — 배포 잠금(다른 창/프로세스 포함)으로 차단.
			const busy = currentDeployLockHolder();
			if (busy) {
				warnDeployBusy('Start', busy, '완료 후 Start를 실행하세요 (업로드 중 Start는 제어기 이상을 유발할 수 있음)');
				return;
			}
			const projectDir = await pickWorkspaceProjectDir('시작할 프로젝트를 선택하세요');
			if (!projectDir) { return; }
			const projectName = readGprProjectName(projectDir) ?? path.basename(projectDir);
			// /GPL 소스가 Compile로 검증되지 않았으면 안내(Start는 제어기가 자체 컴파일 — 소스 에러 시 Start 실패, §0.7).
			if (!(await confirmStartWhenCompileStale(projectName, projectDir))) { return; }
			// 모달 대기 동안 다른 배포가 시작됐을 수 있으므로 잠금을 다시 확인한다.
			const busyAfter = currentDeployLockHolder();
			if (busyAfter) { warnDeployBusy('Start', busyAfter); return; }

			const requireStartConfirm = vscode.workspace.getConfiguration('gpl')
				.get<boolean>('controller.requireStartConfirmation', true);
			if (requireStartConfirm) {
				const pick = await vscode.window.showWarningMessage(
					`'${projectName}' 프로그램을 시작합니다. 로봇이 움직일 수 있습니다.`,
					{ modal: true },
					'Start'
				);
				if (pick !== 'Start') { return; }
			}

			// Start 전 런타임 콘솔 준비 (구 Deploy & Run의 beforeStart와 동일 처리)
			try {
				const console = ensureRuntimeConsole();
				console.primeForRuntimeStart();
				await console.waitUntilReady(1200);
				controllerTree?.setRuntimeConsoleStatus(console.getStatusSnapshot());
			} catch (err: any) {
				logOutput(`[Start] runtime console pre-start failed: ${err?.message ?? err}`);
			}

			try {
				logOutput(`[Start] CMD Start ${projectName}`);
				const raw = await sendCommand(`Start ${projectName}`);
				const status = parseStatus(raw);
				if (status.code === 0 || isControllerNonBlockingStatus(status.code)) {
					if (status.code !== 0) {
						logOutput(`[Start] STATUS ${status.code} non-blocking (controller environment warning)`);
					}
					vscode.window.showInformationMessage(`Start 완료: ${projectName}`);
					consoleChannel.show(true);
				} else {
					vscode.window.showErrorMessage(`Start 실패: STATUS ${status.code}: ${status.message || 'Unknown error'}`);
				}
				controllerTree?.refresh();
			} catch (err: any) {
				vscode.window.showErrorMessage(`Start 실패: ${err.message ?? err}`);
			}
		})
	);

	// gpl.saveToFlash — 로컬 프로젝트를 /flash/projects/<projectName>에 FTP 저장만 수행.
	// 제어기 상태는 건드리지 않는다 (Stop/Unload/Load/Compile 없음 — 2026-07-24 결정).
	// 미러 동기화: 크기 다른 파일만 업로드 + 원격 전용 파일 삭제(낡은 소스가 이후 Load에 섞이는 것 방지).
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.saveToFlash', async () => {
			const busy = currentDeployLockHolder();
			if (busy) {
				warnDeployBusy('Save to Flash', busy, '완료 후 flash 저장을 실행하세요');
				return;
			}
			const projectDir = await pickWorkspaceProjectDir('flash에 저장할 프로젝트를 선택하세요');
			if (!projectDir) { return; }
			// 업로드 전 미저장 파일 확인. savedFiles는 pending에서 지우지 않는다 —
			// flash 업로드는 /GPL을 갱신하지 않으므로 /GPL 동기화는 이후 autoOnSave가 자체 게이트로 처리.
			if (!(await confirmSaveDirtyProjectDocs(projectDir)).ok) {
				logOutput('[SaveToFlash] 미저장 파일 확인에서 취소됨 — 업로드를 시작하지 않음');
				return;
			}
			const cfg = getControllerConfig();
			const projectName = readGprProjectName(projectDir) ?? path.basename(projectDir);
			const remoteDir = `${cfg.ftpFlashProjectsPath}/${projectName}`;
			outputChannel.show(true);
			logOutput(`[SaveToFlash] ${projectDir} → ftp://${cfg.ip}${remoteDir} (미러 동기화, Load/Compile 없음)`);
			// FTP 미러(원격 파일 삭제 포함) 중 autoOnSave/배포/MCP의 Compile·Start가 겹치지 않도록 배포 잠금에 포함.
			// 프로젝트 선택·미저장 확인 UI가 끝난 뒤에 잡는다(UI 대기 중 잠금 금지, 이슈 #15).
			const acquired = getDeployLock(cfg.ip).acquire('Save to Flash', 'FTP_MIRROR');
			if (!acquired.ok) {
				warnDeployBusy('Save to Flash', acquired.holder, '완료 후 flash 저장을 실행하세요');
				return;
			}
			try {
				const stats = await mirrorProject(cfg.ip, projectDir, remoteDir, {
					onProgress: (current, total, file) => {
						acquired.handle.heartbeat();
						logOutput(`[SaveToFlash] [${current}/${total}] ${file}`);
					},
					onDelete: (file) => logOutput(`[SaveToFlash] del ${file} (원격 전용 — 로컬에 없어 삭제)`),
				});
				logOutput(`[SaveToFlash] 완료: ${stats.uploaded} sent, ${stats.skipped} skipped, ${stats.deleted} deleted`);
				vscode.window.showInformationMessage(
					`flash 저장 완료: ${remoteDir} (${stats.uploaded} 업로드, ${stats.skipped} 스킵${stats.deleted ? `, ${stats.deleted} 삭제` : ''})`
				);
				await controllerTree?.refreshAll();
			} catch (err: any) {
				vscode.window.showErrorMessage(`flash 저장 실패: ${err.message ?? err}`);
			} finally {
				acquired.handle.release();
			}
		})
	);

	// gpl.quickCompile — 변경분만 업로드 + Compile (STOP/START 생략), 빠른 에러 확인
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.quickCompile', () => runDeploy(true, { skipStop: true, skipUnchanged: true, quick: true }))
	);

	// .gpl 저장 시 자동 빠른 컴파일 (설정 gpl.quickCompile.autoOnSave, 기본 "auto"). 600ms 디바운스 + 동시실행 방지.
	// 저장된 파일만 업로드 후 Compile하여, 매 저장마다 프로젝트 전체를 스캔/조회하는 비효율을 제거한다.
	// "auto"(기본): 제어기가 완전 STOP(쓰레드 없음)이고 /GPL/<project>가 존재할 때만 조용히 실행(AUTO_GATE).
	// "on"(구 true): 게이트 없이 항상 시도(활성 쓰레드 시 조용히 중단, /GPL 없으면 classic 폴백) / "off"(구 false): 사용 안 함.
	type AutoOnSaveMode = 'off' | 'on' | 'auto';
	function getAutoOnSaveMode(): AutoOnSaveMode {
		// 구버전 boolean 설정값 호환: true → "on", false → "off". 미설정 시 스키마 기본값 "auto".
		const raw = vscode.workspace.getConfiguration('gpl').get<unknown>('quickCompile.autoOnSave');
		if (raw === true || raw === 'on') { return 'on'; }
		if (raw === false || raw === 'off') { return 'off'; }
		return 'auto';
	}

	let quickCompileTimer: ReturnType<typeof setTimeout> | undefined;
	let quickCompileInFlight = false;
	const quickCompilePendingFiles = new Set<string>();
	// deactivate 시 디바운스 타이머 해제 (좀비 콜백 방지)
	context.subscriptions.push({ dispose: () => { if (quickCompileTimer) { clearTimeout(quickCompileTimer); quickCompileTimer = undefined; } } });

	/** 저장된 파일이 속한 프로젝트 폴더(.gpr 보유)를 찾는다. 여러 후보 중 가장 깊은(구체적인) 경로를 선택. */
	async function resolveProjectDirForFile(fsPath: string): Promise<string | undefined> {
		const projectDirs = await findProjectDirs();
		const normalized = path.resolve(fsPath);
		const matches = projectDirs.filter(dir => {
			const rel = path.relative(path.resolve(dir), normalized);
			return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
		});
		if (matches.length === 0) { return undefined; }
		// 가장 깊은(경로가 긴) 프로젝트 폴더를 우선.
		return matches.sort((a, b) => b.length - a.length)[0];
	}

	/** autoOnSave 디바운스 타이머 (재)예약. */
	function scheduleQuickCompileFlush(delayMs: number): void {
		if (quickCompileTimer) { clearTimeout(quickCompileTimer); }
		quickCompileTimer = setTimeout(() => {
			quickCompileTimer = undefined;
			void flushQuickCompilePending();
		}, delayMs);
	}

	/**
	 * pending 저장 파일 처리. 저장 경로에서는 절대 UI(QuickPick/모달)를 띄우지 않는다.
	 * - 컴파일/배포가 진행 중이면 pending을 버리지 않고 재예약해 이후에 처리한다.
	 * - 프로젝트 폴더별로 그룹화해 첫 그룹만 이번에 처리하고, 다른 프로젝트 파일은
	 *   pending에 남겨 재예약한다 (업로드 필터에서 조용히 탈락하던 문제 방지).
	 * - 프로젝트(.gpr)를 못 찾는 파일은 로그만 남기고 조용히 건너뛴다.
	 */
	async function flushQuickCompilePending(): Promise<void> {
		if (quickCompilePendingFiles.size === 0) { return; }
		const mode = getAutoOnSaveMode();
		if (mode === 'off') {
			// 저장~flush 사이에 설정이 꺼졌으면 pending을 버린다.
			quickCompilePendingFiles.clear();
			return;
		}
		if (mode === 'auto' && vscode.debug.activeDebugSession?.type === 'brooks-gpl') {
			// 디버그 세션 중 자동 업로드 금지 — 정지 중 쓰레드와의 충돌 방지(프로브 왕복도 생략).
			quickCompilePendingFiles.clear();
			logOutput('[QuickCompile] autoOnSave 건너뜀: brooks-gpl 디버그 세션 진행 중');
			return;
		}
		if (quickCompileInFlight || currentDeployLockHolder()) {
			// 다른 배포(이 창/다른 창/Save to Flash)가 진행 중 — pending을 버리지 않고 재예약.
			scheduleQuickCompileFlush(1000);
			return;
		}
		quickCompileInFlight = true;
		try {
			const groups = new Map<string, string[]>();
			for (const file of [...quickCompilePendingFiles]) {
				const dir = await resolveProjectDirForFile(file);
				if (!dir) {
					quickCompilePendingFiles.delete(file);
					logOutput(`[QuickCompile] autoOnSave: 프로젝트(.gpr) 미해석 — 건너뜀: ${file}`);
					continue;
				}
				const list = groups.get(dir);
				if (list) { list.push(file); } else { groups.set(dir, [file]); }
			}

			const firstGroup = groups.entries().next();
			if (firstGroup.done) { return; }
			const [projectDir, changedFiles] = firstGroup.value;
			for (const file of changedFiles) { quickCompilePendingFiles.delete(file); }

			const r = await runDeploy(true, {
				skipStop: true,
				skipUnchanged: true,
				quick: true,
				changedFiles,
				overrideProjectDir: projectDir,
				// 저장마다 모달이 뜨면 방해되므로 autoOnSave는 활성 쓰레드 시 조용히 중단.
				noStopPrompt: true,
				// "auto" 모드: /GPL/<project>가 있으면 업로드, Compile은 쓰레드가 하나도 없을 때만(없으면 COMPILE_DEFERRED → 컴파일 필요 표시).
				autoGate: mode === 'auto',
			});
			if (r?.failedPhase === 'LOCKED') {
				// 다른 배포가 잠금을 잡고 있었다 — 저장분을 버리지 않고 pending에 되돌려 finally에서 재예약한다.
				for (const file of changedFiles) { quickCompilePendingFiles.add(file); }
			}
		} finally {
			quickCompileInFlight = false;
			if (quickCompilePendingFiles.size > 0) {
				// 남은 프로젝트 그룹/처리 중 새로 저장된 파일을 이어서 처리
				scheduleQuickCompileFlush(1000);
			}
		}
	}

	context.subscriptions.push(
		vscode.workspace.onDidSaveTextDocument((doc) => {
			if (doc.languageId !== 'gpl') { return; }
			if (getAutoOnSaveMode() === 'off') { return; }
			if (!controllerTree?.isConnected) { return; }
			quickCompilePendingFiles.add(doc.uri.fsPath);
			scheduleQuickCompileFlush(600);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.console.start', async () => {
			const console = ensureRuntimeConsole();
			console.start(0, { forceImmediateReconnect: true });
			await console.waitUntilReady();
			const hasPayload = await console.waitForPayload(1500);
			const snapshot = console.getStatusSnapshot();
			controllerTree?.setRuntimeConsoleStatus(snapshot);
			consoleChannel.show(true);
			showRuntimeConsoleUserMessage(snapshot, hasPayload, 'GPL 런타임 콘솔 시작');
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.console.stop', () => {
			stopRuntimeConsoleAndSyncTree();
			vscode.window.showInformationMessage('GPL 런타임 콘솔 중지');
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.console.ensure', async () => {
			const console = ensureRuntimeConsole();
			console.start(0, { forceImmediateReconnect: true });
			await console.waitUntilReady(1200);
			const hasPayload = await console.waitForPayload(1500);
			const snapshot = console.getStatusSnapshot();
			controllerTree?.setRuntimeConsoleStatus(snapshot);
			consoleChannel.show(true);
			showRuntimeConsoleUserMessage(snapshot, hasPayload, '1403 콘솔 확인');
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.logs.liveTerminal.start', async () => {
			startLiveLogTerminal();
			try {
				const console = ensureRuntimeConsole();
				await console.waitUntilReady();
				const hasPayload = await console.waitForPayload(1500);
				const snapshot = console.getStatusSnapshot();
				controllerTree?.setRuntimeConsoleStatus(snapshot);
				logOutput(`[Console] ${buildRuntimeConsoleUserMessage(snapshot, hasPayload, 'live log start').message}`);
			} catch (err: any) {
				logOutput(`[Console] live log start -> runtime console start failed: ${err?.message ?? err}`);
			}
			logOutput('Live log terminal started');
			vscode.window.showInformationMessage('GPL Live Logs 터미널 시작 (1403 런타임 콘솔 연결 시도)');
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.logs.liveTerminal.stop', () => {
			if (!isLiveLogTerminalEnabled()) {
				vscode.window.showInformationMessage('GPL Live Logs 터미널이 이미 중지 상태야.');
				return;
			}
			// Live Log 세션 종료 시 1403 소비자도 함께 정리해 소켓/타이머/리스너를 완전 해제한다.
			runtimeConsole?.stop();
			logOutput('Live log terminal stopped');
			stopLiveLogTerminal();
			vscode.window.showInformationMessage('GPL Live Logs 터미널 중지 (1403 런타임 콘솔도 정리됨)');
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.threads.refresh', () => {
			controllerTree?.refreshAll();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.copySituationForChat', async () => {
			if (!controllerTree) { return; }
			await controllerTree.refreshAll();
			const expected = controllerTree.getExpectedProjectName();
			const header = [
				'다음은 GPL Controller 현재 상태입니다. 실행 프로젝트/FTP 프로젝트 불일치 여부를 우선 분석해 주세요.',
				expected ? `기대 프로젝트: ${expected}` : '기대 프로젝트: (미설정)',
				'',
			].join('\n');
			const body = controllerTree.buildSituationSnapshotMarkdown({
				runtimeConsoleStatus: currentRuntimeConsoleStatus(),
				deploySnapshot: lastDeploySnapshot,
			});
			const text = `${header}${body}`;

			await vscode.env.clipboard.writeText(text);
			vscode.window.showInformationMessage('AI 공유용 상태 스냅샷을 클립보드에 복사했습니다.');
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.diagnosticSnapshot', async () => {
			if (!controllerTree) { return; }
			await controllerTree.refreshAll();
			const markdown = controllerTree.buildDiagnosticSnapshotMarkdown({
				runtimeConsoleStatus: currentRuntimeConsoleStatus(),
				deploySnapshot: lastDeploySnapshot,
			});

			await vscode.env.clipboard.writeText(markdown);
			logOutput('');
			logOutput('── [진단 스냅샷] ───────────────────────────────────────');
			for (const line of markdown.split(/\r?\n/)) {
				logOutput(line);
			}
			logOutput('─────────────────────────────────────────────────────────');
			outputChannel.show(true);
			vscode.window.showInformationMessage('진단 스냅샷을 클립보드에 복사했어.');
		})
	);

	// AI Agent Setup 내보내기 — 현재 워크스페이스에 .mcp.json(동봉 MCP 서버 등록) +
	// CLAUDE.md 가드 섹션을 생성해, 외부 AI(Claude Code)가 제어기를 안전하게 다룰 수 있게 한다.
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.ai.exportAgentSetup', async () => {
			const config = getControllerConfig();
			const projectName = (await detectWorkspaceProjectName())?.trim() || undefined;
			const result = await exportAiAgentSetup(context, { ip: config.ip, port: config.port, projectName });
			logOutput(`[AI Setup] gpl.ai.exportAgentSetup => ${JSON.stringify(result)}`);
			return result;
		})
	);

	// AI Agent Setup 점검(GitHub #23) — .mcp.json 등록 경로, globalStorage 사본/동봉 번들 sha256 일치, CLAUDE.md 안내 블록 버전을
	// 한 번에 보고한다. 문제가 있으면 Export 재실행 버튼을 함께 준다.
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.ai.checkAgentSetup', async () => {
			const report = inspectAiAgentSetup(context);
			logOutput(`[AI Setup] gpl.ai.checkAgentSetup => ${JSON.stringify(report, null, 2)}`);
			const bundleVer = report.bundled.build?.version ?? report.extensionVersion;
			const summary = report.ok
				? `GPL AI Agent Setup 정상 — MCP 번들 v${bundleVer}${report.stableCopy.exists ? ', globalStorage 사본 최신' : ''}${report.mcpJson.registered ? ', .mcp.json 등록됨' : ''}${report.claudeMd.hasBlock ? ', CLAUDE.md 안내 최신' : ''}.`
				: `GPL AI Agent Setup 점검 ${report.problems.length}건: ${report.problems.join(' / ')}`;
			const pick = report.ok
				? await vscode.window.showInformationMessage(summary, '출력 보기')
				: await vscode.window.showWarningMessage(summary, 'Export 재실행', '출력 보기');
			if (pick === 'Export 재실행') {
				await vscode.commands.executeCommand('gpl.ai.exportAgentSetup');
			} else if (pick === '출력 보기') {
				outputChannel.show(true);
			}
			return report;
		})
	);

	// 활성화 시 globalStorage MCP 사본 자동 갱신(GitHub #23): Export를 한 번이라도 실행한 PC에서 확장이 업데이트되면
	// 사본이 구버전으로 남아 Claude Code가 옛 서버(keep-alive·debug_snapshot 없는 08-05판 등)를 계속 띄우던 문제.
	// 사본이 없으면 아무것도 하지 않는다. 실행 중인 MCP 프로세스는 다음 시작 때 새 파일을 읽으므로 /mcp 재연결을 안내한다.
	if (vscode.workspace.getConfiguration('gpl.ai').get<boolean>('autoRefreshMcpBundle', true)) {
		const sync = syncStableBundleIfStale(context);
		if (sync.action !== 'absent' && sync.action !== 'up-to-date') {
			logOutput(`[AI Setup] MCP 사본 동기화: ${JSON.stringify(sync)}`);
		}
		if (sync.action === 'updated') {
			const report = inspectAiAgentSetup(context);
			const from = sync.previous?.version ? `v${sync.previous.version}` : '구버전(스탬프 없음)';
			const to = sync.current?.version ? `v${sync.current.version}` : '현재 번들';
			const needExport = report.claudeMd.hasBlock && report.claudeMd.upToDate === false;
			const buttons = needExport ? ['Export 재실행', '확인'] : ['확인'];
			void vscode.window.showInformationMessage(
				`gpl-controller MCP 서버 사본을 ${from} → ${to}로 갱신했습니다. 실행 중인 Claude Code에서는 /mcp로 gpl-controller를 재연결해야 새 서버가 뜹니다.` +
				(needExport ? ' 워크스페이스 CLAUDE.md의 안내 블록은 구버전입니다 — Export 재실행을 권장합니다.' : ''),
				...buttons,
			).then(pick => {
				if (pick === 'Export 재실행') { void vscode.commands.executeCommand('gpl.ai.exportAgentSetup'); }
			});
		}
	}

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
				logOutput(`[AI Assist] ${line}`);
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

				if (!(controllerTree?.isConnected ?? false)) {
					recordStep('제어기 연결 시도');
					await vscode.commands.executeCommand('gpl.controller.connect');
				}

				if (!(controllerTree?.isConnected ?? false)) {
					throw new Error('제어기 연결이 완료되지 않았습니다.');
				}
				recordStep('제어기 연결 확인 완료');

				recordStep('초기 상태 스냅샷 수집');
				await vscode.commands.executeCommand('gpl.controller.copySituationForChat');

				if (mode !== 'diagnose-only') {
					recordStep('Build Only 실행');
					await vscode.commands.executeCommand('gpl.deploy');
					summary.deploy = lastDeploySnapshot;
					if (!lastDeploySnapshot?.success) {
						throw new Error(`Build Only 실패 (${lastDeploySnapshot?.lastStage ?? 'unknown'})`);
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

				logOutput('');
				logOutput('── [AI Debug Assist] ───────────────────────────────────');
				for (const line of lines) {
					logOutput(line);
				}
				logOutput('─────────────────────────────────────────────────────────');
			}

			return summary;
		})
	);

	/** AI 디버그 루프용 평가값 정규화: STATUS/태그 제거 후 핵심 payload를 한 줄 값으로 정리 */
	function normalizeEvalValue(raw: string): string {
		const dataMatch = raw.match(/<DATA>([\s\S]*?)<\/DATA>/i);
		const base = (dataMatch ? dataMatch[1] : raw)
			.replace(/<STATUS>[\s\S]*?<\/STATUS>/gi, '')
			.replace(/<[^>]+>/g, '')
			.trim();
		const lines = base.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
		if (lines.length === 0) { return ''; }
		const first = lines[0];
		const csv = first.split(',').map(s => s.trim());
		if (csv.length >= 3) {
			return csv.slice(2).join(', ').trim();
		}
		return first;
	}

	function aiBreakpointCommand(projectName: string, fileName: string, line: number, clear = false): string {
		return `${clear ? 'Set Nobreak' : 'Set Break'} ${projectName} "${fileName}"${line}`;
	}

	type AIDebugStepMode = 'into' | 'over' | 'out';

	function aiBuildStepCommand(threadName: string, mode: AIDebugStepMode): string {
		if (mode === 'over') { return `Step ${threadName} -over -noerror`; }
		if (mode === 'out') { return `Step ${threadName} -out -noerror`; }
		return `Step ${threadName} -noerror`;
	}

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
		logOutput(`[AI Debug] ${commandId} => ${serialized}`);
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
					result = { ok: false, error: 'command-failed', detail: err?.message ?? String(err) };
				}
				logAiDebugResult(commandId, result);
				return result;
			})
		);
	}

	/** 정지 계열로 간주하는 스레드 상태 (Error 포함 — 위치/변수 확인이 가능한 상태) */
	const AI_PAUSED_STATES: ReadonlySet<string> = new Set(['Paused', 'Break', 'Error']);

	/**
	 * 스레드가 정지 계열 상태로 들어올 때까지 `Show Thread` 폴링.
	 * `Break`/`Step`의 STATUS 0은 "접수"일 수 있어(§0.6 `Stop -all`과 같은 패턴),
	 * 실제 정지 완료는 스레드 상태로 확인한다. (STATUS 의미는 실기기 실측으로 확정 전 — 방어적 처리)
	 */
	async function waitForThreadPause(
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

	registerAiDebugCommand('gpl.ai.debug.getState', async (args?: { includeStackForThread?: string; includeBreakpoints?: boolean }) => {
		if (!(controllerTree?.isConnected ?? false)) {
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
			connected: controllerTree?.isConnected ?? false,
			threads,
			stack,
			breakpoints,
		};
	});

	registerAiDebugCommand('gpl.ai.debug.setBreakpoint', async (args?: { file: string; line: number; projectName?: string }) => {
		if (!args?.file || !args?.line) {
			return { ok: false, error: 'missing-file-or-line' };
		}
		const projectName = (args.projectName || await resolveExpectedProjectName() || '').trim();
		if (!projectName) {
			return { ok: false, error: 'missing-projectName' };
		}
		const fileName = path.basename(args.file);
		const cmd = aiBreakpointCommand(projectName, fileName, Math.max(1, Math.floor(args.line)), false);
		const raw = await sendCommand(cmd);
		const status = parseStatus(raw);
		return {
			ok: status.code === 0,
			command: cmd,
			status,
		};
	});

	registerAiDebugCommand('gpl.ai.debug.clearBreakpoint', async (args?: { file: string; line: number; projectName?: string }) => {
		if (!args?.file || !args?.line) {
			return { ok: false, error: 'missing-file-or-line' };
		}
		const projectName = (args.projectName || await resolveExpectedProjectName() || '').trim();
		if (!projectName) {
			return { ok: false, error: 'missing-projectName' };
		}
		const fileName = path.basename(args.file);
		const cmd = aiBreakpointCommand(projectName, fileName, Math.max(1, Math.floor(args.line)), true);
		const raw = await sendCommand(cmd);
		const status = parseStatus(raw);
		return {
			ok: status.code === 0,
			command: cmd,
			status,
		};
	});

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

	registerAiDebugCommand('gpl.ai.debug.stepThread', async (args?: { threadName: string; mode?: AIDebugStepMode; waitForPause?: boolean; waitTimeoutMs?: number }) => {
		if (!args?.threadName) {
			return { ok: false, error: 'missing-threadName' };
		}
		const mode: AIDebugStepMode = args.mode ?? 'over';
		const cmd = aiBuildStepCommand(args.threadName, mode);
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
		const result = await connectControllerWithArgs({ silent: true, ...(args ?? {}) });
		return { ...result };
	});

	registerAiDebugCommand('gpl.ai.debug.disconnect', async () => {
		const result = await vscode.commands.executeCommand<{ ok: boolean; connected: boolean; ip: string; port: number }>(
			'gpl.controller.disconnect', { silent: true });
		return { ...(result ?? {}), ok: true, connected: false };
	});

	registerAiDebugCommand('gpl.ai.debug.getConnectionState', async () => {
		const cfg = getControllerConfig();
		const rc = currentRuntimeConsoleStatus();
		const session = vscode.debug.activeDebugSession;
		const lock = currentDeployLockHolder();
		return {
			ok: true,
			timestamp: Date.now(),
			connected: controllerTree?.isConnected ?? false,
			ip: cfg.ip,
			port: cfg.port,
			consolePort: cfg.consolePort,
			debugSessionActive: isDebugSessionActive,
			debugSession: session?.type === 'brooks-gpl'
				? { name: session.name, projectName: String(session.configuration?.projectName ?? '') || undefined }
				: undefined,
			runtimeConsole: { active: rc.connected, state: rc.state, reason: rc.reason, lastPayloadAt: rc.lastPayloadAt },
			expectedProject: (await resolveExpectedProjectName()) || undefined,
			deployLock: lock ? { owner: lock.owner, stage: lock.stage, describe: describeDeployLock(lock) } : null,
			compileStale: [...compileStaleProjects.values()],
		};
	});

	registerAiDebugCommand('gpl.ai.debug.loop', async (args?: {
		threadName?: string;
		stepMode?: AIDebugStepMode;
		maxSteps?: number;
		watchExpressions?: string[];
		stopWhen?: { expression: string; equals?: string; contains?: string; matches?: string };
		stepWaitTimeoutMs?: number;
	}) => {
		if (!(controllerTree?.isConnected ?? false)) {
			// AI 자율 루프에서 입력 상자가 뜨면 멈춰 버린다 — 현재 설정으로 비대화형 연결(GitHub #25).
			await connectControllerWithArgs({ silent: true });
		}
		if (!(controllerTree?.isConnected ?? false)) {
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

		const mode: AIDebugStepMode = args?.stepMode ?? 'over';
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

			const stepCmd = aiBuildStepCommand(targetThread, mode);
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
				const console = ensureRuntimeConsole();
				await console.waitUntilReady(800);
				const hasPayload = await console.waitForPayload(1500);
				const snapshot = console.getStatusSnapshot();
				controllerTree?.setRuntimeConsoleStatus(snapshot);
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
			controllerTree?.redraw();
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
				controllerTree?.redraw();
			}
		})
	);

	// 제어기에 임의 명령 전송
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.sendCommand', async () => {
			const cmd = await vscode.window.showInputBox({
				prompt: '제어기에 보낼 명령을 입력하세요',
				placeHolder: 'Show Thread, ErrorLog, Directory /flash/projects, …',
			});
			if (!cmd) { return; }
			const normalizedCommand = await normalizeControllerCommandInput(cmd);
			if (!normalizedCommand) { return; }
			try {
				const resp = await sendCommand(normalizedCommand);
				outputChannel.appendLine(`[Command] >>> ${normalizedCommand}`);
				outputChannel.appendLine(resp);
				outputChannel.show(true);
			} catch (err: any) {
				vscode.window.showErrorMessage(`명령 실패: ${err.message ?? err}`);
			}
		})
	);

	// 전체 정지 (Stop -all)
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.stopAll', async () => {
			try {
				const stopResp = await sendCommandWithBusyRetry('Stop -all', { maxAttempts: 5, baseDelayMs: 500 });
				const status = parseStatus(stopResp);
				if (status.code !== 0 && !isBusyStatus(status.code)) {
					vscode.window.showErrorMessage(`전체 정지 실패: STATUS ${status.code} ${status.message}`);
					return;
				}

				const stopped = await verifyAllStopped(8);
				if (stopped) {
					vscode.window.showWarningMessage('전체 정지 완료 (Stop -all)');
				} else {
					const recovered = await trySoftEStopRecovery();
					if (!recovered) {
						vscode.window.showWarningMessage('Stop -all 전송됨. 제어기 바쁨/재시작으로 정지 확인이 지연되고 있습니다. 상태를 다시 확인해줘.');
					}
				}
				controllerTree?.refresh();
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
			if (runtimeConsole?.isConnected) {
				runtimeConsole.stop();
				controllerTree?.setRuntimeConsoleStatus(runtimeConsole.getStatusSnapshot());
				vscode.window.showInformationMessage('런타임 콘솔 중지');
			} else {
				const console = ensureRuntimeConsole();
				controllerTree?.setRuntimeConsoleStatus(console.getStatusSnapshot());
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
				controllerTree?.refresh();
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

			let errorThreadName = lastRuntimeErrorContext?.threadName || '';
			let stackLines: string[] = lastRuntimeErrorContext?.stackFrames ? [...lastRuntimeErrorContext.stackFrames] : [];
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

			const recentLines = recentDebugLogLines.slice(-10);

			const lines: string[] = [];
			lines.push('## 오류 상세');
			lines.push(`- 원문: ${raw || '(없음)'}`);
			lines.push(`- 코드: ${typeof code === 'number' ? code : '(미상)'}`);
			lines.push(`- 분류: ${payload.category || hint?.category || '(미상)'}`);
			lines.push(`- 에러 스레드: ${errorThreadName || '(미확인)'}`);
			lines.push(`- 직전 실행 명령: ${lastRuntimeErrorContext?.lastCommand || '(미확인)'}`);
			lines.push(`- 첫 에러 시각: ${parsed?.timestamp || lastRuntimeErrorContext?.firstSeenAt || '(미확인)'}`);
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
			logOutput('');
			logOutput('── [오류 상세 보기] ────────────────────────────────────');
			for (const line of lines) {
				logOutput(line);
			}
			logOutput('─────────────────────────────────────────────────────────');
		})
	);

	// FTP 파일 목록 새로고침
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.refreshFtp', () => {
			controllerTree?.refreshFtp();
		})
	);

	// 시스템 정보 새로고침
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.refreshSystemInfo', () => {
			controllerTree?.refreshSystemInfo();
		})
	);

	// 개별 쓰레드 시작/정지
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.threadStart', async (node: any) => {
			if (!node?.thread?.name) { return; }
			// 업로드/컴파일 도중 Start가 겹치면 제어기 이상을 유발할 수 있다 — 배포 잠금(다른 창/프로세스 포함)으로 차단.
			const busy = currentDeployLockHolder();
			if (busy) {
				warnDeployBusy('쓰레드 시작', busy, '완료 후 쓰레드를 시작하세요');
				return;
			}
			// /GPL 소스가 Compile로 검증되지 않은 프로젝트면 안내(Start는 제어기가 자체 컴파일 — 소스 에러 시 Start 실패, §0.7).
			if (!(await confirmStartWhenCompileStale(node.thread.project || node.thread.name))) { return; }
			const busyAfter = currentDeployLockHolder();
			if (busyAfter) { warnDeployBusy('쓰레드 시작', busyAfter); return; }
			try {
				await sendCommand(`Start ${node.thread.name}`);
				controllerTree?.refresh();
			} catch (err: any) {
				vscode.window.showErrorMessage(`쓰레드 시작 실패: ${err.message ?? err}`);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.threadStop', async (node: any) => {
			if (!node?.thread?.name) { return; }
			try {
				const threadName = node.thread.name;
				const stopResp = await sendCommandWithBusyRetry(`Stop ${threadName}`, { maxAttempts: 5, baseDelayMs: 400 });
				const status = parseStatus(stopResp);
				if (status.code !== 0 && !isBusyStatus(status.code)) {
					vscode.window.showErrorMessage(`쓰레드 정지 실패: STATUS ${status.code} ${status.message}`);
					return;
				}

				const stopped = await verifyThreadStopped(threadName, 7);
				if (!stopped) {
					const recovered = await trySoftEStopRecovery(threadName);
					if (!recovered) {
						vscode.window.showWarningMessage(`${threadName} 정지 명령은 전송됐지만 아직 실행 중일 수 있습니다. 잠시 후 다시 확인해줘.`);
					}
				} else {
					vscode.window.showInformationMessage(`${threadName} 정지 완료`);
				}
				controllerTree?.refresh();
			} catch (err: any) {
				vscode.window.showErrorMessage(`쓰레드 정지 실패: ${err.message ?? err}`);
			}
		})
	);

	// ─── 트리 쓰레드 제어(Break/Continue/Step) 공통 ─────────────────────
	// 하드 규칙 2: 성공/실패는 그 명령의 <STATUS>로 판정한다(이전엔 전송 후 바로 refresh만 했음).
	// Break/Step의 STATUS 0은 "접수"일 수 있어(§0.6 패턴) 실제 정지 복귀는 waitForThreadPause로 확인한다.
	async function sendThreadCommandChecked(cmd: string, failLabel: string): Promise<boolean> {
		const resp = await sendCommand(cmd);
		const status = parseStatus(resp);
		outputChannel.appendLine(`[Thread] >>> ${cmd} => STATUS ${status.code}${status.message ? ` ${status.message}` : ''}`);
		if (status.code !== 0) {
			vscode.window.showErrorMessage(`${failLabel} 실패: STATUS ${status.code} ${status.message}`);
			return false;
		}
		return true;
	}

	const TREE_STEP_LABEL: Record<AIDebugStepMode, string> = { over: '스텝 오버', into: '스텝 인투', out: '스텝 아웃' };

	/**
	 * 트리 인라인/컨텍스트 메뉴의 Step. 명령 문자열은 디버그 어댑터·AI API와 같은 `aiBuildStepCommand`로 만든다
	 * (GDE 실측: over=`-over -noerror`, into=`-noerror`; out=`-out -noerror`는 Brooks 문서상 스위치 — 실기기 미검증).
	 * 정지 복귀가 확인되면 정지 위치를 에디터에 표시한다(설정 gpl.controller.autoShowPausedLocation, 기본 true).
	 */
	async function runTreeThreadStep(node: any, mode: AIDebugStepMode): Promise<void> {
		const name: string | undefined = node?.thread?.name;
		if (!name) { return; }
		const label = TREE_STEP_LABEL[mode];
		try {
			if (!(await sendThreadCommandChecked(aiBuildStepCommand(name, mode), `${name} ${label}`))) { return; }
			const wait = await waitForThreadPause(name, 5000);
			controllerTree?.refresh();
			if (!wait.paused) {
				// 긴 모션 한 줄을 스텝하면 정지 복귀가 늦을 수 있다 — 팝업 대신 상태바/Output로만 알린다(트리 폴링이 이어서 갱신).
				vscode.window.setStatusBarMessage(`${name} ${label}: 접수됨, 정지 복귀 대기 중 (${wait.state ?? '상태 미확인'})`, 5000);
				outputChannel.appendLine(`[Thread] ${name} ${label}: 5초 내 정지 복귀 미확인 (state=${wait.state ?? '?'})`);
				return;
			}
			if (vscode.workspace.getConfiguration('gpl.controller').get<boolean>('autoShowPausedLocation') !== false) {
				await vscode.commands.executeCommand('gpl.controller.threadShowLocation', node);
			}
		} catch (err: any) {
			vscode.window.showErrorMessage(`${label} 실패: ${err.message ?? err}`);
		}
	}

	// 쓰레드 일시정지 (Break)
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.threadBreak', async (node: any) => {
			const name: string | undefined = node?.thread?.name;
			if (!name) { return; }
			try {
				if (!(await sendThreadCommandChecked(`Break ${name}`, `${name} 일시정지`))) { return; }
				const wait = await waitForThreadPause(name, 5000);
				controllerTree?.refresh();
				if (wait.paused) {
					vscode.window.showInformationMessage(`${name} 일시정지 (${wait.state})`);
				} else {
					vscode.window.showWarningMessage(`${name} 일시정지 명령은 접수됐지만 아직 ${wait.state ?? '상태 미확인'} 상태입니다. 잠시 후 트리에서 다시 확인하세요.`);
				}
			} catch (err: any) {
				vscode.window.showErrorMessage(`일시정지 실패: ${err.message ?? err}`);
			}
		})
	);

	// 쓰레드 재개 (Continue)
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.threadContinue', async (node: any) => {
			const name: string | undefined = node?.thread?.name;
			if (!name) { return; }
			try {
				await sendThreadCommandChecked(`Continue ${name}`, `${name} 재개`);
				controllerTree?.refresh();
			} catch (err: any) {
				vscode.window.showErrorMessage(`재개 실패: ${err.message ?? err}`);
			}
		})
	);

	// 쓰레드 에러 건너뛰기 계속 (Continue -noerror)
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.threadContinueNoError', async (node: any) => {
			const name: string | undefined = node?.thread?.name;
			if (!name) { return; }
			try {
				if (await sendThreadCommandChecked(`Continue ${name} -noerror`, `${name} 재개`)) {
					vscode.window.showInformationMessage(`${name} 에러 건너뛰고 재개`);
				}
				controllerTree?.refresh();
			} catch (err: any) {
				vscode.window.showErrorMessage(`재개 실패: ${err.message ?? err}`);
			}
		})
	);

	// 쓰레드 스텝 — 인라인 버튼(아이콘 $(debug-step-over))은 Step Over. Into/Out은 컨텍스트 메뉴에서.
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.threadStep', (node: any) => runTreeThreadStep(node, 'over')),
		vscode.commands.registerCommand('gpl.controller.threadStepInto', (node: any) => runTreeThreadStep(node, 'into')),
		vscode.commands.registerCommand('gpl.controller.threadStepOut', (node: any) => runTreeThreadStep(node, 'out')),
	);

	// FTP 프로젝트 다운로드
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.ftpDownload', async (node: any) => {
			const name: string | undefined = node?.projectName || node?.label;
			const remotePath: string | undefined = node?.remotePath;
			if (!name || !remotePath) { return; }

			// 저장 위치 선택
			const targetUri = await vscode.window.showOpenDialog({
				canSelectFolders: true,
				canSelectFiles: false,
				canSelectMany: false,
				openLabel: '여기에 다운로드',
				title: `"${name}" 프로젝트 다운로드 위치 선택`,
			});
			if (!targetUri?.[0]) { return; }

			const localDir = path.join(targetUri[0].fsPath, name);
			const cfg = getControllerConfig();
			const host = cfg.ip;

			await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: `${name} 다운로드 중...`, cancellable: false },
				async (progress) => {
					try {
						const result = await downloadProject(host, remotePath, localDir, (cur, total, file) => {
							progress.report({ increment: (1 / total) * 100, message: file });
						});
						const openChoice = await vscode.window.showInformationMessage(
							`"${name}" 다운로드 완료 (${result.downloaded}개 파일)`,
							'폴더 열기', '워크스페이스에 추가',
						);
						if (openChoice === '폴더 열기') {
							await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(localDir));
						} else if (openChoice === '워크스페이스에 추가') {
							vscode.workspace.updateWorkspaceFolders(
								vscode.workspace.workspaceFolders?.length ?? 0, 0,
								{ uri: vscode.Uri.file(localDir), name },
							);
						}
					} catch (err: any) {
						vscode.window.showErrorMessage(`다운로드 실패: ${err.message ?? err}`);
					}
				},
			);
		})
	);

	// FTP 항목 삭제
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.ftpDelete', async (node: any) => {
			const name: string | undefined = node?.projectName || node?.label;
			const ctx: string | undefined = node?.contextValue;
			const remotePath: string | undefined = node?.remotePath;
			if (!name || !ctx || !remotePath) { return; }

			const isDir = ctx === 'ftpFolder' || ctx === 'ftpFlashFolder';
			const confirm = await vscode.window.showWarningMessage(
				`${isDir ? '폴더' : '파일'} "${name}"을(를) 제어기에서 삭제하시겠습니까?`,
				{ modal: true }, '삭제'
			);
			if (confirm !== '삭제') { return; }

			const cfg = getControllerConfig();
			try {
				if (isDir) {
					await removeRemoteDir(cfg.ip, remotePath);
				} else {
					await removeRemoteFile(cfg.ip, remotePath);
				}
				vscode.window.showInformationMessage(`"${name}" 삭제 완료`);
				controllerTree?.refreshFtp();
			} catch (err: any) {
				vscode.window.showErrorMessage(`삭제 실패: ${err.message ?? err}`);
			}
		})
	);

	// FTP 폴더 컴파일 & 실행 (Load 에러 핸들링 포함)
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.ftpRun', async (node: any) => {
			const name: string | undefined = node?.projectName || node?.label;
			const loadPath: string | undefined = node?.remotePath;
			if (!name || !loadPath) { return; }
			// 업로드 도중 Compile/Start가 겹치면 제어기 이상을 유발할 수 있다 — 배포 잠금(다른 창/프로세스 포함)으로 차단.
			const busy = currentDeployLockHolder();
			if (busy) {
				warnDeployBusy('컴파일 & 실행', busy, '완료 후 컴파일 & 실행을 사용하세요');
				return;
			}

			const cfg = getControllerConfig();
			const loadBeforeCompile = vscode.workspace
				.getConfiguration('gpl.controller')
				.get<boolean>('ftpRunLoadBeforeCompile', false);

			outputChannel.show(true);

			const resolveFtpRunPath = async (): Promise<{
				loadPath: string;
				basePath: string;
				candidates: string[];
				switched: boolean;
			}> => {
				const configuredBases = [
					cfg.ftpFlashProjectsPath,
					cfg.ftpBasePath,
					path.posix.dirname(loadPath),
				];
				const uniqueBases = [...new Set(configuredBases
					.map(p => (p || '').replace(/\/+$/, ''))
					.filter(Boolean))];

				const scored: Array<{ basePath: string; projectPath: string; exists: boolean; rank: number }> = [];
				for (const basePath of uniqueBases) {
					const projectPath = `${basePath}/${name}`;
					let exists = false;
					try {
						const entries = await listRemoteDir(cfg.ip, basePath);
						exists = entries.some(e => e.isDirectory && e.name.toLowerCase() === name.toLowerCase());
					} catch {
						// Probe failure leaves the path as a candidate, but not a confirmed one.
					}

					const isSelected = projectPath.toLowerCase() === loadPath.toLowerCase();
					const isFlash = basePath.toLowerCase() === cfg.ftpFlashProjectsPath.toLowerCase();
					const rank = (exists ? 200 : 0) + (isFlash ? 80 : 0) + (isSelected ? 20 : 0);
					scored.push({ basePath, projectPath, exists, rank });
				}

				scored.sort((a, b) => b.rank - a.rank);
				const chosen = scored[0] ?? {
					basePath: path.posix.dirname(loadPath),
					projectPath: loadPath,
					exists: false,
					rank: 0,
				};
				return {
					loadPath: chosen.projectPath,
					basePath: chosen.basePath,
					candidates: scored.map(s => `${s.projectPath}${s.exists ? ' (exists)' : ''}`),
					switched: chosen.projectPath.toLowerCase() !== loadPath.toLowerCase(),
				};
			};

			const resolvedPath = await resolveFtpRunPath();
			const effectiveLoadPath = resolvedPath.loadPath;

			logOutput('');
			logOutput(`━━ [FTP Run v${extVersion}] ${name} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
			logOutput(`│ Note: FTP Run uses the uploaded controller copy at ${effectiveLoadPath}`);
			logOutput(`│       Local edits are NOT uploaded here. Use GPL: Deploy (Build Only) to verify latest local code.`);
			logOutput(`│ Path candidates: ${resolvedPath.candidates.join(' | ') || effectiveLoadPath}`);
			if (resolvedPath.switched) {
				logOutput(`│ Path selected: ${loadPath} → ${effectiveLoadPath}`);
			}
			logOutput(`│ Load before Compile: ${loadBeforeCompile ? 'enabled' : 'skipped'}`);

			type FtpCompileAttempt = {
				raw: string;
				status: ReturnType<typeof parseStatus>;
				errors: ReturnType<typeof parseCompileErrors>;
				ok: boolean;
				note?: string;
				responseMeta?: {
					responseComplete: boolean;
					bytesReceived: number;
					lastChunkAt: string;
					idleTimeoutMs: number;
				};
			};

			const rawPreview = (raw: string): string => {
				const compact = raw.replace(/\r/g, '').replace(/\n+/g, ' | ').trim();
				return compact.length > 260 ? `${compact.slice(0, 260)}...` : compact;
			};

			const runStatusCommand = async (command: string) => {
				const raw = await sendCommand(command);
				const status = parseStatus(raw);
				return {
					raw,
					status,
					ok: status.code === 0 || isControllerNonBlockingStatus(status.code),
				};
			};

			const logCompileAttempt = (compile: FtpCompileAttempt): void => {
				logOutput(`│ RAW ${rawPreview(compile.raw) || '(empty)'}`);
				if (compile.note) {
					logOutput(`│ NOTE ${compile.note}`);
				}
				if (compile.responseMeta && !compile.responseMeta.responseComplete) {
					logOutput(`│ META responseComplete=false bytesReceived=${compile.responseMeta.bytesReceived} lastChunkAt=${compile.responseMeta.lastChunkAt} idleTimeoutMs=${compile.responseMeta.idleTimeoutMs}`);
				}
			};

			const tryCompile = async (): Promise<FtpCompileAttempt> => {
				// 컴파일은 pass 사이에 수 초간 침묵할 수 있어 idle 기반 조기 완료는 응답이 잘려
				// STATUS/에러 라인을 놓친다. deployService.tryCompile과 동일하게 종결자
				// </STATUS>까지 대기하고 대형 프로젝트 대비 충분한 상한을 둔다 (§0.2).
				const detailed = await sendCommandDetailed(`Compile ${name}`, cfg, {
					waitForStatusClose: true,
					timeoutMs: Math.max(cfg.timeoutMs, 60000),
				});
				const raw = detailed.raw;
				const status = parseStatus(raw);
				const errors = parseCompileErrors(raw);

				if ((status.code === 0 || isControllerNonBlockingStatus(status.code)) && errors.length === 0) {
					return {
						raw,
						status,
						errors,
						ok: true,
						responseMeta: detailed.meta,
					};
				}

				// STATUS가 없으면(-9999) 컴파일 결과를 확인하지 못한 것이다. 'compile successful'
				// 텍스트 마커나 Show Thread 응답으로 성공을 추정하지 않는다 — 실제 컴파일 에러를
				// 가리는 오판의 직접 원인이었다. 성공 판정은 STATUS 0 + 에러 없음뿐이다 (§0.2/§0.3).
				return {
					raw,
					status,
					errors,
					ok: false,
					note: status.code === -9999 ? 'STATUS 누락 — 컴파일 결과 미확인(성공 추정 금지)' : undefined,
					responseMeta: detailed.meta,
				};
			};

			const ensureStoppedBeforeCompile = async (): Promise<boolean> => {
				logOutput('│ Phase: Stop before Compile');
				logOutput('│ Stop -all');
				const stopResp = await sendCommandWithBusyRetry('Stop -all', { maxAttempts: 5, baseDelayMs: 500 });
				const stopStatus = parseStatus(stopResp);
				if (stopStatus.code !== 0 && !isBusyStatus(stopStatus.code)) {
					throw new Error(`Stop -all failed: STATUS ${stopStatus.code} ${stopStatus.message || ''}`.trimEnd());
				}

				const stopped = await verifyAllStopped(8);
				if (stopped) {
					logOutput('│ ✔ Stop complete');
					return true;
				}

				logOutput('│ ⚠ Stop sent, but thread stop confirmation is delayed');
				return false;
			};

			const ensureLoadedFromFtp = async (): Promise<boolean> => {
				logOutput(`│ Load ${effectiveLoadPath}`);
				const { status } = await runStatusCommand(`Load ${effectiveLoadPath}`);
				if (status.code === 0) {
					logOutput(`│ ✔ Load success`);
					return true;
				}
				if (status.code === -745) {
					logOutput(`│ ✔ Load skipped (already loaded)`);
					return true;
				}
				logOutput(`│ ✘ Load failed: STATUS ${status.code} ${status.message || ''}`.trimEnd());
				return false;
			};

			try {
				// §0.6: Stop -all의 STATUS 0은 "정지 요청 수리"일 뿐 정지 완료가 아니다.
				// 전체 정지가 확인되지 않으면 Load/Compile/Start를 진행하지 않고 중단한다.
				const stoppedBeforeRun = await ensureStoppedBeforeCompile();
				if (!stoppedBeforeRun) {
					throw new Error('Stop -all 후 전체 정지가 확인되지 않았습니다. 스레드 상태를 확인한 뒤 다시 시도하세요 (Load/Compile/Start 중단).');
				}
				if (loadBeforeCompile) {
					const loadedBeforeCompile = await ensureLoadedFromFtp();
					if (!loadedBeforeCompile) {
						throw new Error(`Load failed: ${effectiveLoadPath}`);
					}
				}

				// 1) Compile 시도
				logOutput('│ Phase: Compile uploaded controller copy');
				logOutput(`│ Compile ${name}`);
				let compile = await tryCompile();
				logCompileAttempt(compile);
				if (!compile.ok) {
					const statusCode = compile.status.code;
					if (statusCode === -746) {
						logOutput('│ ⚠ STATUS -746 Interlocked for read');
						logOutput('│ ⚠ Retry path: Stop → wait → Compile');
						const stoppedForRetry = await ensureStoppedBeforeCompile();
						if (!stoppedForRetry) {
							throw new Error('Stop -all 후 전체 정지가 확인되지 않아 Compile 재시도를 중단했습니다 (§0.6).');
						}
						await sleep(500);
						compile = await tryCompile();
						logCompileAttempt(compile);
						if (!compile.ok) {
							throw new Error(`Compile failed after retry: STATUS ${compile.status.code} ${compile.status.message || ''}${compile.note ? ` — ${compile.note}` : ''}`.trimEnd());
						}
						logOutput('│ ✔ Compile success (after interlock retry)');
					} else if (statusCode === -745) {
						logOutput(`│ ⚠ Already loaded → Unload → Load → Compile`);
						const { status: unloadStatus } = await runStatusCommand(`Unload ${name}`);
						if (unloadStatus.code === 0) {
							logOutput(`│ ✔ Unload success`);
						} else if (unloadStatus.code === -508 || unloadStatus.code === -743) {
							logOutput(`│ ✔ Unload skipped (project not loaded)`);
						} else {
							throw new Error(`Unload failed: STATUS ${unloadStatus.code} ${unloadStatus.message || ''}`.trimEnd());
						}
						const loaded = await ensureLoadedFromFtp();
						if (!loaded) {
							throw new Error(`Load failed: ${effectiveLoadPath}`);
						}
						compile = await tryCompile();
						logCompileAttempt(compile);
						if (!compile.ok) {
							throw new Error(`Compile failed: STATUS ${compile.status.code} ${compile.status.message || ''}${compile.note ? ` — ${compile.note}` : ''}`.trimEnd());
						}
						logOutput(`│ ✔ Compile success (after reload)`);
					} else if (statusCode === -508 || statusCode === -743) {
						logOutput(`│ ⚠ Not loaded → Load → Compile`);
						const loaded = await ensureLoadedFromFtp();
						if (!loaded) {
							throw new Error(`Load failed: ${effectiveLoadPath}`);
						}
						compile = await tryCompile();
						logCompileAttempt(compile);
						if (!compile.ok) {
							throw new Error(`Compile failed: STATUS ${compile.status.code} ${compile.status.message || ''}${compile.note ? ` — ${compile.note}` : ''}`.trimEnd());
						}
						logOutput(`│ ✔ Compile success (after load)`);
					} else {
						const compileError = compile.errors[0];
						if (compileError) {
							throw new Error(`Compile failed: ${compileError.file}:${compileError.line} (${compileError.code}) ${compileError.message}`);
						}
						throw new Error(`Compile failed: STATUS ${compile.status.code} ${compile.status.message || ''}${compile.note ? ` — ${compile.note}` : ''}`.trimEnd());
					}
				} else {
					logOutput(`│ ✔ Compile success`);
				}

				// Compile이 성공했으니 "컴파일 필요" 상태가 있었다면 해제.
				clearCompileStale(name);

				// 2) 콘솔 자동 시작/재연결 (Start 직전 블라인드 구간 완화)
				const console = ensureRuntimeConsole();
				console.primeForRuntimeStart();
				await console.waitUntilReady(1200);
				consoleChannel.show(true);

				// 3) Start
				logOutput(`│ Start ${name}`);
				const { status: startStatus } = await runStatusCommand(`Start ${name}`);
				if (startStatus.code !== 0) {
					throw new Error(`Start failed: STATUS ${startStatus.code} ${startStatus.message || ''}`.trimEnd());
				}
				logOutput(`│ ✔ Start success`);
				vscode.window.showInformationMessage(`${name} 업로드된 제어기 복사본 기준 컴파일 & 실행 완료`);
				controllerTree?.refresh();
			} catch (err: any) {
				logOutput(`│ ✘ 실패: ${err.message ?? err}`);
				vscode.window.showErrorMessage(`${name} 실행 실패: ${err.message ?? err}`);
			}
		})
	);

	// FTP 폴더 중지
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.ftpStop', async (node: any) => {
			const name: string | undefined = node?.projectName || node?.label;
			if (!name) { return; }

			try {
				const stopResp = await sendCommandWithBusyRetry(`Stop ${name}`, { maxAttempts: 5, baseDelayMs: 400 });
				const status = parseStatus(stopResp);
				if (status.code !== 0 && !isBusyStatus(status.code)) {
					vscode.window.showErrorMessage(`${name} 중지 실패: STATUS ${status.code} ${status.message}`);
					return;
				}

				const stopped = await verifyThreadStopped(name, 7);
				if (!stopped) {
					const recovered = await trySoftEStopRecovery(name);
					if (!recovered) {
						vscode.window.showWarningMessage(`${name} 정지 명령은 전송됐지만 아직 실행 중일 수 있습니다. 잠시 후 다시 확인해줘.`);
					}
				} else {
					vscode.window.showInformationMessage(`${name} 중지 완료`);
				}
				controllerTree?.refresh();
			} catch (err: any) {
				vscode.window.showErrorMessage(`${name} 중지 실패: ${err.message ?? err}`);
			}
		})
	);

	// FTP 폴더 Unload (메모리 해제)
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.ftpUnload', async (node: any) => {
			const name: string | undefined = node?.projectName || node?.label;
			if (!name) { return; }

			try {
				await sendCommand(`Unload ${name}`);
				vscode.window.showInformationMessage(`${name} Unload 완료`);
				controllerTree?.refresh();
			} catch (err: any) {
				vscode.window.showErrorMessage(`Unload 실패: ${err.message ?? err}`);
			}
		})
	);

	// ════════════════════════════════════════════════════════════
	// Thread stopped-location indicator (click paused thread → show line)
	// ════════════════════════════════════════════════════════════

	// Decoration: yellow arrow + line highlight for the stopped position
	const stoppedLineDecoration = vscode.window.createTextEditorDecorationType({
		isWholeLine: true,
		backgroundColor: new vscode.ThemeColor('editor.stackFrameHighlightBackground'),
			overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.warningForeground'),
		overviewRulerLane: vscode.OverviewRulerLane.Center,
	});
	context.subscriptions.push(stoppedLineDecoration);

	const errorLineDecoration = vscode.window.createTextEditorDecorationType({
		isWholeLine: true,
		backgroundColor: 'rgba(255, 40, 40, 0.22)',
		border: '1px solid rgba(255, 80, 80, 0.9)',
		overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.errorForeground'),
		overviewRulerLane: vscode.OverviewRulerLane.Right,
	});
	context.subscriptions.push(errorLineDecoration);

	// Track the current decoration so we can clear it
	let stoppedDecorationEditor: vscode.TextEditor | undefined;
	let errorDecorationEditor: vscode.TextEditor | undefined;

	/** Clear the stopped-line highlight */
	function clearStoppedDecoration(): void {
		if (stoppedDecorationEditor) {
			stoppedDecorationEditor.setDecorations(stoppedLineDecoration, []);
			stoppedDecorationEditor = undefined;
		}
	}

	function clearErrorDecoration(): void {
		if (errorDecorationEditor) {
			errorDecorationEditor.setDecorations(errorLineDecoration, []);
			errorDecorationEditor = undefined;
		}
	}

	// Clear highlight when user starts editing or switches away
	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument(() => {
			clearStoppedDecoration();
			clearErrorDecoration();
		}),
	);

	/**
	 * 재귀 스캔에서 제외할 디렉터리 판별 — gplDebugSession._isSkippedScanDir와 같은 규칙.
	 * dot 디렉터리(.history/.git 등)와 빌드/출력 폴더 제외 — 특히 .history(Local History
	 * 확장)의 stale 사본이 열리는 문제를 방지한다.
	 */
	function isSkippedScanDir(name: string): boolean {
		return name.startsWith('.')
			|| name === 'node_modules'
			|| name === 'out'
			|| name === 'dist'
			|| name === 'bin';
	}

	/** 워크스페이스에서 이름이 target(대소문자 무시)인 파일 전부를 수집한다. */
	function findWorkspaceFilesByName(target: string): string[] {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders) { return []; }
		const lower = target.toLowerCase();
		const results: string[] = [];
		const scan = (dir: string): void => {
			try {
				const entries = fs.readdirSync(dir, { withFileTypes: true });
				for (const entry of entries) {
					const full = path.join(dir, entry.name);
					if (entry.isDirectory()) {
						if (isSkippedScanDir(entry.name)) { continue; }
						scan(full);
					} else if (entry.name.toLowerCase() === lower) {
						results.push(full);
					}
				}
			} catch { /* skip */ }
		};
		for (const folder of folders) { scan(folder.uri.fsPath); }
		return results;
	}

	/**
	 * 제어기 트리의 기대 프로젝트와 이름이 일치하는 Project.gpr 폴더들을 수집한다.
	 * 동명 소스 경합 시 우선 선택 기준 (gplDebugSession._updateProjectDirs와 같은 역할).
	 */
	function findExpectedProjectDirs(): string[] {
		const expected = controllerTree?.getExpectedProjectName?.()?.trim();
		if (!expected) { return []; }
		const want = expected.toLowerCase();
		const dirs: string[] = [];
		for (const gprPath of findWorkspaceFilesByName('Project.gpr')) {
			try {
				const info = parseGpr(fs.readFileSync(gprPath, 'utf-8'));
				if (info.projectName && info.projectName.toLowerCase() === want) {
					dirs.push(path.dirname(gprPath));
				}
			} catch { /* skip */ }
		}
		return dirs;
	}

	/**
	 * Resolve a GPL filename (basename) to a workspace file path.
	 *
	 * 디버그 어댑터(gplDebugSession._resolveSourcePath/_pickSourcePath)와 같은 규칙:
	 * .history 등 dot 폴더 제외 + 동명 경합 시 기대 프로젝트 폴더 우선. 예전에는
	 * 첫 매치를 그대로 반환해 .history의 stale 사본이 열렸다 (디버그 패널과 트리
	 * 명령의 동작 불일치 원인).
	 */
	function resolveGplFilePath(filename: string): string | undefined {
		// 제어기가 전체 경로를 줄 수 있으므로 베이스네임만 비교 대상으로 삼는다.
		const target = filename.replace(/^.*[\\/]/, '');
		const candidates = findWorkspaceFilesByName(target);
		if (candidates.length === 0) { return undefined; }

		const pick = pickSourceCandidate(candidates, findExpectedProjectDirs())!;
		if (pick.ambiguous.length > 0) {
			logOutput(
				`⚠ 동명 소스 ${candidates.length}개 경합: "${target}" → ${pick.path} 선택 ` +
				`(제외: ${pick.ambiguous.join(' | ')}). 엉뚱한 파일이 열리면 워크스페이스에서 ` +
				`사본/백업 폴더를 정리하세요.`,
			);
		}
		return pick.path;
	}

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.threadShowLocation', async (node: any) => {
			const threadName: string | undefined = node?.thread?.name;
			if (!threadName) { return; }

			try {
				let topFrame = undefined as ReturnType<typeof parseStack>[number] | undefined;

				const resp = await sendCommand(`Show Stack ${threadName}`);
				if (resp) {
					const frames = parseStack(resp);
					topFrame = frames[0];
				}

				if (!topFrame) {
					const detailResp = await sendCommand(`Show Thread ${threadName}`);
					const detail = detailResp ? parseThreadDetail(detailResp) : null;
					if (detail?.file && detail.fileLine > 0) {
						topFrame = {
							frameIndex: 0,
							project: detail.project,
							process: detail.process || threadName,
							procLine: detail.procLine,
							file: detail.file,
							fileLine: detail.fileLine,
							size: 0,
						};
						outputChannel.appendLine(
							`[Thread] ${threadName} 위치 복구: Show Thread fallback → ${detail.file}:${detail.fileLine} (${detail.process || threadName})`,
						);
					}
				}

				if (!topFrame) {
					vscode.window.showWarningMessage(`${threadName}: 스택 프레임이 없습니다.`);
					outputChannel.appendLine(`[Thread] ${threadName} 위치 조회 실패: Show Stack / Show Thread fallback 모두 실패`);
					return;
				}

				// Top frame = current execution position
				if (!topFrame.file || topFrame.fileLine <= 0) {
					vscode.window.showWarningMessage(`${threadName}: 파일/줄 정보 없음 (${topFrame.process || 'unknown'})`);
					return;
				}

				// Resolve file path
				const filePath = resolveGplFilePath(topFrame.file);
				if (!filePath) {
					vscode.window.showWarningMessage(`${threadName}: 파일 "${topFrame.file}"을 워크스페이스에서 찾을 수 없습니다.`);
					return;
				}

				// Open the file and reveal the stopped line
				const doc = await vscode.workspace.openTextDocument(filePath);
				const editor = await vscode.window.showTextDocument(doc, { preview: false });
				const line = topFrame.fileLine - 1; // 0-based
				const range = new vscode.Range(line, 0, line, 0);
				editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
				editor.selection = new vscode.Selection(line, 0, line, 0);

				// Apply stopped-line decoration
				clearStoppedDecoration();
				const lineRange = doc.lineAt(line).range;
				editor.setDecorations(stoppedLineDecoration, [{ range: lineRange }]);
				stoppedDecorationEditor = editor;

				outputChannel.appendLine(
					`[Thread] ${threadName} 정지 위치: ${topFrame.file}:${topFrame.fileLine} (${topFrame.process})`,
				);

				// brooks-gpl 디버그 세션이 활성이면 디버거 포커스도 이 쓰레드로 전환한다
				// (CALL STACK/Variables/Watch가 해당 쓰레드 기준으로 갱신 — 디버그 패널과의 동작 병합).
				// 부가 기능이므로 실패해도 위치 표시에는 영향 없음.
				const dbgSession = vscode.debug.activeDebugSession;
				if (dbgSession?.type === 'brooks-gpl') {
					try {
						await dbgSession.customRequest('gplFocusThread', { name: threadName });
					} catch (focusErr: any) {
						outputChannel.appendLine(`[Thread] ${threadName} 디버거 포커스 연동 실패(무시): ${focusErr?.message ?? focusErr}`);
					}
				}
			} catch (err: any) {
				vscode.window.showErrorMessage(`스택 조회 실패: ${err.message ?? err}`);
			}
		})
	);

	// CALL STACK에서 Running 쓰레드 클릭 → 현재 실행 위치 열기 (Show Stack 스냅샷).
	// 정지 쓰레드는 VS Code가 스택 프레임으로 기본 처리하므로 여기서는 다루지 않는다.
	// onDidChangeActiveStackItem은 VS Code 1.90+ API — engines(^1.74)보다 새 API라
	// 존재 여부를 확인하고 등록한다(구버전에서는 이 기능만 조용히 비활성).
	const debugApi = vscode.debug as any;
	if (typeof debugApi.onDidChangeActiveStackItem === 'function') {
		context.subscriptions.push(debugApi.onDidChangeActiveStackItem(async (item: any) => {
			// DebugStackFrame(frameId 보유)은 정지 쓰레드 포커스 — 기본 동작에 맡긴다.
			if (!item || typeof item.threadId !== 'number' || 'frameId' in item) { return; }
			if (item.session?.type !== 'brooks-gpl') { return; }
			try {
				const info = await item.session.customRequest('gplThreadInfo', { threadId: item.threadId });
				if (!info?.name || info.state !== 'Running') { return; }
				// Continue/Step 직후 VS Code가 포커스를 쓰레드로 자동 전환하며 오는
				// 이벤트는 사용자 클릭이 아니므로 무시한다.
				if (typeof info.msSinceResume === 'number' && info.msSinceResume < 2000) { return; }
				await vscode.commands.executeCommand('gpl.controller.threadShowLocation', { thread: { name: info.name } });
			} catch (err: any) {
				outputChannel.appendLine(`[Thread] CALL STACK Running 쓰레드 위치 열기 실패(무시): ${err?.message ?? err}`);
			}
		}));
	}

	// 쓰레드 클릭 → 액션 QuickPick (상세/스택/위치/제어/복사)
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.threadActions', async (node: any) => {
			const t = node?.thread;
			if (!t?.name) { return; }
			const name: string = t.name;
			const state: string = t.state;
			type ActItem = vscode.QuickPickItem & { action: string };
			const items: ActItem[] = [];
			// 현재 실행/정지 위치는 모든 상태에서 조회 가능 (Running은 스냅샷)
			items.push({ label: '$(go-to-file) 현재 실행 위치 보기', action: 'location' });
			items.push({ label: '$(list-tree) 스택 보기 (Show Stack)', action: 'stack' });
			items.push({ label: '$(info) 상세 보기 (Show Thread)', action: 'detail' });
			if (state === 'Running') {
				items.push({ label: '$(debug-pause) 일시정지 (Break)', action: 'break' });
				items.push({ label: '$(debug-stop) 정지 (Stop)', action: 'stop' });
			} else if (state === 'Paused' || state === 'Break') {
				items.push({ label: '$(debug-continue) 재개 (Continue)', action: 'continue' });
				items.push({ label: '$(debug-step-over) 스텝 오버 (Step -over)', action: 'step' });
				items.push({ label: '$(debug-step-into) 스텝 인투 (Step -into)', action: 'stepInto' });
				items.push({ label: '$(debug-step-out) 스텝 아웃 (Step -out)', action: 'stepOut' });
				items.push({ label: '$(debug-stop) 정지 (Stop)', action: 'stop' });
			} else if (state === 'Error') {
				items.push({ label: '$(debug-continue) 에러 건너뛰고 재개', action: 'continueNoError' });
				items.push({ label: '$(debug-stop) 정지 (Stop)', action: 'stop' });
			} else {
				items.push({ label: '$(play) 시작 (Start)', action: 'start' });
			}
			items.push({ label: '$(copy) 정보 복사', action: 'copy' });
			const pick = await vscode.window.showQuickPick(items, { placeHolder: `${name} [${state}] — 동작 선택` });
			if (!pick) { return; }
			switch (pick.action) {
				case 'location': await vscode.commands.executeCommand('gpl.controller.threadShowLocation', node); break;
				case 'stack': await vscode.commands.executeCommand('gpl.controller.threadShowStack', node); break;
				case 'detail': {
					const resp = await sendCommand(`Show Thread ${name}`);
					outputChannel.appendLine(`[Thread] >>> Show Thread ${name}`);
					outputChannel.appendLine(resp || '(empty)');
					outputChannel.show(true);
					break;
				}
				case 'break': await vscode.commands.executeCommand('gpl.controller.threadBreak', node); break;
				case 'continue': await vscode.commands.executeCommand('gpl.controller.threadContinue', node); break;
				case 'continueNoError': await vscode.commands.executeCommand('gpl.controller.threadContinueNoError', node); break;
				case 'step': await vscode.commands.executeCommand('gpl.controller.threadStep', node); break;
				case 'stepInto': await vscode.commands.executeCommand('gpl.controller.threadStepInto', node); break;
				case 'stepOut': await vscode.commands.executeCommand('gpl.controller.threadStepOut', node); break;
				case 'stop': await vscode.commands.executeCommand('gpl.controller.threadStop', node); break;
				case 'start': await vscode.commands.executeCommand('gpl.controller.threadStart', node); break;
				case 'copy': {
					const info = [`Thread: ${name}`, `State: ${state}`, t.project ? `Project: ${t.project}` : '', t.file ? `File: ${t.file}${t.fileLine ? ':' + t.fileLine : ''}` : '', t.lastStatus ? `Status: ${t.lastStatus}` : ''].filter(Boolean).join('\n');
					await vscode.env.clipboard.writeText(info);
					vscode.window.showInformationMessage(`${name} 정보 복사됨`);
					break;
				}
			}
		})
	);

	// 쓰레드 스택 인스펙터 — Show Stack → 프레임 QuickPick → 소스 위치 이동
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.threadShowStack', async (node: any) => {
			const name: string | undefined = node?.thread?.name;
			if (!name) { return; }
			try {
				const resp = await sendCommand(`Show Stack ${name}`);
				const frames = resp ? parseStack(resp) : [];
				outputChannel.appendLine(`[Thread] >>> Show Stack ${name}`);
				outputChannel.appendLine(resp || '(empty)');
				if (frames.length === 0) {
					vscode.window.showWarningMessage(`${name}: 스택 프레임이 없습니다.`);
					outputChannel.show(true);
					return;
				}
				const items = frames.map((f, i) => ({
					label: `$(list-tree) #${i} ${f.process || '(unknown)'}`,
					description: f.file ? `${f.file}:${f.fileLine}` : '(위치 없음)',
					frame: f,
				}));
				const pick = await vscode.window.showQuickPick(items, { placeHolder: `${name} 스택 — 프레임 선택 시 소스로 이동` });
				if (!pick) { return; }
				const f = pick.frame;
				if (!f.file || f.fileLine <= 0) { vscode.window.showWarningMessage('해당 프레임에 파일/줄 정보가 없습니다.'); return; }
				const filePath = resolveGplFilePath(f.file);
				if (!filePath) { vscode.window.showWarningMessage(`파일 "${f.file}"을 워크스페이스에서 찾을 수 없습니다.`); return; }
				const doc = await vscode.workspace.openTextDocument(filePath);
				const editor = await vscode.window.showTextDocument(doc, { preview: false });
				const line = Math.max(0, f.fileLine - 1);
				const range = new vscode.Range(line, 0, line, 0);
				editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
				editor.selection = new vscode.Selection(line, 0, line, 0);
			} catch (err: any) {
				vscode.window.showErrorMessage(`스택 조회 실패: ${err.message ?? err}`);
			}
		})
	);

	// 전역변수 보기/편집 — Show Global → (편집) Execute name = value, project
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.showGlobal', async () => {
			const varName = await vscode.window.showInputBox({ prompt: '조회할 전역변수 이름', placeHolder: '예: GPL.i1, Robot.Speed' });
			if (!varName) { return; }
			const proj = controllerTree?.getExpectedProjectName?.() || '';
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
					if (st.code === 0) { vscode.window.showInformationMessage(`${varName} 설정 완료`); controllerTree?.refresh?.(); }
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

	// ════════════════════════════════════════════════════════════
	// Debug Adapter Protocol (DAP) — brooks-gpl debugger
	// ════════════════════════════════════════════════════════════
	activateDebug(context);

	// ── 디버그 중 클릭 즉시 변수 값 표시 ──────────────────────────
	// 호버는 editor.hover.delay + 마우스 정지 대기 때문에 체감이 느리다.
	// 마우스 클릭으로 커서를 식별자 위에 놓으면 내장 debug hover를 즉시 띄운다.
	// 키보드 커서 이동은 제외(kind !== Mouse). gpl.debug.showValueOnCursorClick로 끌 수 있음.
	context.subscriptions.push(
		vscode.window.onDidChangeTextEditorSelection(e => {
			if (!isDebugSessionActive) { return; }
			if (e.kind !== vscode.TextEditorSelectionChangeKind.Mouse) { return; }
			const editor = e.textEditor;
			if (editor.document.languageId !== 'gpl') { return; }
			const sel = e.selections[0];
			if (!sel || !sel.isSingleLine) { return; }
			// 클릭(빈 선택)·더블클릭(단어 선택)만 처리 — 긴 드래그 선택은 제외
			if (!sel.isEmpty && editor.document.getText(sel).length > 64) { return; }
			// 식별자 위가 아니면 무시 (빈 공간 클릭 시 불필요한 hover 방지)
			if (!editor.document.getWordRangeAtPosition(sel.active)) { return; }
			const cfg = vscode.workspace.getConfiguration('gpl.debug');
			if (!cfg.get<boolean>('showValueOnCursorClick', true)) { return; }
			// showDebugHover는 focus=true가 하드코딩되어(VS Code debugEditorActions.ts)
			// 키보드 포커스가 hover 위젯으로 이동 → editorTextFocus가 꺼져서
			// editorTextFocus 조건의 키바인딩(F9/F8 toggleBreakpoint 등)이 클릭 직후
			// 동작하지 않는 부작용이 있었다. debug hover는 포커스를 잃어도 닫히지 않으므로
			// (에디터 keydown/스크롤/클릭 시 닫힘) 표시 직후 포커스를 에디터로 되돌려
			// 값 표시와 키바인딩을 모두 살린다.
			void vscode.commands.executeCommand('editor.debug.action.showDebugHover')
				.then(() => vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup'))
				.then(undefined, () => undefined);
		})
	);

	// ── 외부 진입점: URI 핸들러 (GitHub #25 B) ──────────────────────────────
	//   vscode://nir414.gpl-language-support/connect?ip=192.168.0.1&port=1402[&save=settings]
	//   vscode://nir414.gpl-language-support/disconnect | /getState | /dashboard
	//   터미널/에이전트: code --open-url "vscode://nir414.gpl-language-support/connect"
	// 모션을 일으키지 않는 동작만 연다(step/continue/start 는 열지 않는다). 결과는 URI로 돌려줄 수 없으므로
	// Output([URI]/[AI Debug]) + gpl.ai.debug.getConnectionState 로 확인하는 구조.
	context.subscriptions.push(
		vscode.window.registerUriHandler({
			handleUri: async (uri: vscode.Uri) => {
				const action = uri.path.replace(/^\/+|\/+$/g, '').toLowerCase();
				const q = new URLSearchParams(uri.query);
				logOutput(`[URI] ${uri.scheme}://${uri.authority}${uri.path}${uri.query ? `?${uri.query}` : ''}`);
				try {
					switch (action) {
						case 'connect': {
							const portRaw = q.get('port');
							const result = await connectControllerWithArgs({
								ip: q.get('ip') ?? undefined,
								port: portRaw ? Number(portRaw) : undefined,
								save: q.get('save') === 'settings' ? 'settings' : 'session',
								silent: true,
							});
							logOutput(`[URI] connect => ${JSON.stringify(result)}`);
							vscode.window.setStatusBarMessage(
								result.ok ? `GPL Controller 연결 성공: ${result.ip}` : `GPL Controller 연결 실패: ${result.ip} (${result.error})`, 5000);
							return;
						}
						case 'disconnect': {
							const result = await vscode.commands.executeCommand('gpl.controller.disconnect', { silent: true });
							logOutput(`[URI] disconnect => ${JSON.stringify(result)}`);
							vscode.window.setStatusBarMessage('GPL Controller 연결 해제', 5000);
							return;
						}
						case 'getstate':
						case 'getconnectionstate':
							// 결과는 registerAiDebugCommand 규약에 따라 Output 에 [AI Debug] 로 기록된다.
							await vscode.commands.executeCommand('gpl.ai.debug.getConnectionState');
							return;
						case 'dashboard':
							await vscode.commands.executeCommand('gpl.controller.showDashboard');
							return;
						default:
							logOutput(`[URI] 알 수 없는 action '${action}' — 지원: connect, disconnect, getState, dashboard`);
							vscode.window.showWarningMessage(`GPL: 알 수 없는 URI 동작 '${action}' (지원: connect, disconnect, getState, dashboard)`);
					}
				} catch (err: any) {
					logOutput(`[URI] ${action} 실패: ${err?.message ?? err}`);
				}
			},
		})
	);

	// ── 클릭 후 마우스 정지 시 언어 호버 재표시 (GitHub #19, 옵트인 gpl.hover.showAfterClick) ──
	// VS Code 코어는 클릭으로 닫힌 호버를 마우스가 움직이기 전까지 다시 열지 않는다. 클릭 직후에는
	// 커서 위치 = 마우스 위치이므로 editor.action.showHover 를 커서에 띄우면 같은 지점에 호버가 열린다.
	// 디버그 세션 중에는 아래 debug hover 경로(gpl.debug.showValueOnCursorClick)가 담당하므로 제외.
	let hoverAfterClickTimer: ReturnType<typeof setTimeout> | undefined;
	context.subscriptions.push(
		vscode.window.onDidChangeTextEditorSelection(e => {
			if (hoverAfterClickTimer) { clearTimeout(hoverAfterClickTimer); hoverAfterClickTimer = undefined; }
			if (isDebugSessionActive) { return; }
			if (e.kind !== vscode.TextEditorSelectionChangeKind.Mouse) { return; }
			const editor = e.textEditor;
			if (editor.document.languageId !== 'gpl') { return; }
			if (!vscode.workspace.getConfiguration('gpl.hover').get<boolean>('showAfterClick', false)) { return; }
			const sel = e.selections[0];
			// 단일 클릭(빈 선택)만 — 드래그/더블클릭 선택은 제외
			if (!sel || !sel.isEmpty) { return; }
			if (!editor.document.getWordRangeAtPosition(sel.active)) { return; }
			const delay = Math.max(0, vscode.workspace.getConfiguration('editor').get<number>('hover.delay', 300));
			hoverAfterClickTimer = setTimeout(() => {
				hoverAfterClickTimer = undefined;
				if (vscode.window.activeTextEditor !== editor) { return; }
				if (!editor.selection.active.isEqual(sel.active)) { return; }
				// focus 인자는 VS Code 1.8x+ 에서 인식(구버전은 무시) — 포커스를 호버 위젯으로 빼앗지 않게 한다.
				void vscode.commands.executeCommand('editor.action.showHover', { focus: 'noAutoFocus' })
					.then(undefined, () => undefined);
			}, delay);
		}),
		{ dispose: () => { if (hoverAfterClickTimer) { clearTimeout(hoverAfterClickTimer); hoverAfterClickTimer = undefined; } } },
	);

	// ── 소스 변경(BP 신뢰 불가) 상태 보기/조치 (GitHub #21) — 상태바 배지 클릭 ──
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.debug.showSourceStale', async () => {
			const s = lastSourceStale;
			if (!s || s.files.length === 0) {
				vscode.window.showInformationMessage('소스 변경(BP 신뢰 불가) 상태가 아닙니다.');
				return;
			}
			const session = vscode.debug.activeDebugSession;
			type Pick = vscode.QuickPickItem & { action: 'restart' | 'dismiss' | 'open'; file?: string };
			const restartItem: Pick = {
				action: 'restart',
				label: '$(debug-restart) Stop + Upload + Run 으로 재시작',
				description: '현재 세션을 끊고 deployBeforeAttach·stopAllBeforeAttach 구성으로 다시 시작',
				detail: `변경된 파일 ${s.files.length}개를 업로드·Compile 한 뒤 attach — 프로그램이 정지·재시작됩니다(저속/시뮬레이션 권장)`,
			};
			const dismissItem: Pick = { action: 'dismiss', label: '$(eye-closed) 이 세션 동안 배지 숨기기' };
			const fileItems: Pick[] = s.files.map(f => ({ action: 'open', label: `$(file-code) ${f}`, description: '열기', file: f }));
			const pick = await vscode.window.showQuickPick<Pick>([restartItem, ...fileItems, dismissItem], {
				placeHolder: `${s.projectName}: 제어기 컴파일 코드보다 새로운 소스 ${s.files.length}개 — BP가 실제 코드 줄에 걸리지 않을 수 있습니다` +
					(s.compiledAt ? ` (마지막 Compile ${new Date(s.compiledAt).toLocaleString()})` : ''),
			});
			if (!pick) { return; }
			if (pick.action === 'dismiss') {
				statusBar?.setSourceStale(undefined);
				return;
			}
			if (pick.action === 'restart') {
				if (!session || session.type !== 'brooks-gpl') {
					vscode.window.showWarningMessage('활성 brooks-gpl 디버그 세션이 없습니다. F5 로 "Stop + Upload + Run" 구성을 직접 시작하세요.');
					return;
				}
				const confirm = await vscode.window.showWarningMessage(
					'디버그 세션을 끊고 Stop + Upload + Run(재배포) 구성으로 다시 시작할까요?',
					{
						modal: true,
						detail: '실행 중인 쓰레드가 있으면 정지 확인 후 Compile 하고 attach 합니다. 정지·재시작으로 모션 프로그램이 처음부터 다시 실행될 수 있습니다.',
					},
					'재시작',
				);
				if (confirm !== '재시작') { return; }
				const folder = session.workspaceFolder;
				const config = { ...session.configuration, deployBeforeAttach: true, stopAllBeforeAttach: true };
				await vscode.debug.stopDebugging(session);
				const started = await vscode.debug.startDebugging(folder, config);
				logOutput(`[Debug] 소스 변경 → 재배포 재시작(${config.name ?? 'attach'}): ${started ? '시작됨' : '시작 실패'}`);
				return;
			}
			if (pick.file) {
				// 이벤트의 경로는 프로젝트 폴더 기준 상대 경로 — 워크스페이스에서 끝부분이 일치하는 파일을 찾아 연다.
				const rel = pick.file.replace(/\\/g, '/');
				const base = rel.split('/').pop() ?? rel;
				const found = await vscode.workspace.findFiles(`**/${base}`, '**/node_modules/**', 20);
				const match = found.find(u => u.fsPath.replace(/\\/g, '/').toLowerCase().endsWith(rel.toLowerCase())) ?? found[0];
				if (match) {
					await vscode.window.showTextDocument(match, { preview: false });
				} else {
					vscode.window.showWarningMessage(`파일을 찾지 못했습니다: ${pick.file}`);
				}
			}
		})
	);

	// 디버그 세션 중 사이드바 폴링 일시 중지 (TCP 충돌 방지)
	context.subscriptions.push(
		vscode.debug.onDidStartDebugSession(session => {
			if (session.type === 'brooks-gpl') {
				isDebugSessionActive = true;
				updateUiContexts(controllerTree?.isConnected ?? statusBar?.isConnected ?? false);
				const projectFromDebugConfig = (session.configuration?.projectName || '').toString().trim();
				if (projectFromDebugConfig) {
					controllerTree?.setExpectedProjectName(projectFromDebugConfig);
					logOutput(`[ProjectContext] expected project (debug config): ${projectFromDebugConfig}`);
				} else {
					scheduleExpectedProjectSync('debug session started');
				}
				controllerTree?.enterDebugMode();
				if (getAutoStartConsoleOnDebug()) {
					// 디버그 attach 시 1403 런타임 콘솔 자동 시작 (start()는 idempotent).
					try { ensureRuntimeConsole(); } catch (err: any) {
						logOutput(`[Console] auto-start on debug failed: ${err?.message ?? err}`);
					}
				}
			}
		}),
		vscode.debug.onDidTerminateDebugSession(session => {
			if (session.type === 'brooks-gpl') {
				isDebugSessionActive = false;
				updateUiContexts(controllerTree?.isConnected ?? statusBar?.isConnected ?? false);
				controllerTree?.exitDebugMode();
				lastSourceStale = undefined;
				statusBar?.setSourceStale(undefined);
				lastRuntimeErrorContext = undefined;
				controllerTree?.setRuntimeErrorContext(undefined);
			}
		}),
		vscode.debug.onDidReceiveDebugSessionCustomEvent(async event => {
			if (event.session.type !== 'brooks-gpl') { return; }
			if (event.event === 'gpl.sourceStale') {
				// Attach only 디버깅: 제어기 컴파일 코드보다 새로운 소스 파일 목록(빈 목록 = 해소). GitHub #21.
				const body = (event.body ?? {}) as { projectName?: string; compiledAt?: number; staleFiles?: string[]; trigger?: string };
				const files = Array.isArray(body.staleFiles) ? body.staleFiles.map(String) : [];
				lastSourceStale = files.length ? { projectName: String(body.projectName ?? ''), files, compiledAt: body.compiledAt } : undefined;
				statusBar?.setSourceStale(lastSourceStale);
				if (files.length) {
					logOutput(`[Debug] 소스 변경됨 — BP 신뢰 불가 ${files.length}개 (${body.trigger ?? 'attach'}): ${files.join(', ')}`);
					if (sourceStaleNotifiedSessionId !== event.session.id) {
						sourceStaleNotifiedSessionId = event.session.id;
						void vscode.window.showWarningMessage(
							`소스 변경됨 — 브레이크포인트 신뢰 불가 (${files.length}개 파일이 제어기 컴파일 코드보다 새로움)`,
							'조치 보기',
						).then(pick => { if (pick === '조치 보기') { void vscode.commands.executeCommand('gpl.debug.showSourceStale'); } });
					}
				} else if (body.trigger === 'recompiled') {
					logOutput('[Debug] 소스 변경 상태 해소 — 재컴파일로 BP 신뢰성 복원');
				}
				return;
			}
			if (event.event === 'gpl.controllerConnectionChanged') {
				const body = (event.body ?? {}) as {
					connected?: boolean;
					ip?: string;
					port?: number;
					projectName?: string;
				};

				if (body.connected) {
					const ip = (body.ip || '').trim();
					if (ip) {
						setSessionControllerOverride(ip, body.port);
					}
					const projectName = (body.projectName || '').trim();
					if (projectName) {
						controllerTree?.setExpectedProjectName(projectName);
					}
					setControllerConnected(true, { refreshTree: !isDebugSessionActive });
					if (isDebugSessionActive) {
						controllerTree?.enterDebugMode();
					}
					logOutput(`[Controller] Connected via debug adapter${ip ? `: ${ip}${body.port ? `:${body.port}` : ''}` : ''}`);
				} else {
					setControllerConnected(false);
				}
				return;
			}
			if (event.event !== 'gpl.errorLocation') { return; }

			const body = (event.body ?? {}) as {
				threadId?: number;
				threadName?: string;
				file?: string;
				line?: number;
				process?: string;
				statusText?: string;
				errorCode?: number;
				errorMessage?: string;
				errorLogLines?: string[];
				lastCommand?: string;
				firstSeenAt?: string;
				stackFrames?: string[];
				relatedFunctions?: string[];
			};

			const threadName = body.threadName || 'unknown-thread';
			const statusText = body.statusText || 'Error';
			const errorSummary = formatDebugErrorSummary(body.errorMessage, body.errorCode, statusText);
			const line = typeof body.line === 'number' ? body.line : 0;
			const file = (body.file || '').trim();
			lastRuntimeErrorContext = {
				threadName,
				threadId: body.threadId,
				lastCommand: body.lastCommand,
				firstSeenAt: body.firstSeenAt,
				statusText: errorSummary,
				stackFrames: body.stackFrames,
				relatedFunctions: body.relatedFunctions,
			};
			controllerTree?.setRuntimeErrorContext(lastRuntimeErrorContext);

			let targetPath = '';
			if (file) {
				if (path.isAbsolute(file) && fs.existsSync(file)) {
					targetPath = file;
				} else {
					targetPath = resolveGplFilePath(path.basename(file)) || '';
				}
			}

			if (targetPath && line > 0) {
				try {
					const doc = await vscode.workspace.openTextDocument(targetPath);
					const editor = await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: false });
					const lineIndex = Math.max(0, line - 1);
					const targetLine = doc.lineAt(Math.min(lineIndex, Math.max(0, doc.lineCount - 1))).range;
					clearStoppedDecoration();
					clearErrorDecoration();
					editor.setDecorations(errorLineDecoration, [{ range: targetLine }]);
					errorDecorationEditor = editor;
					editor.selection = new vscode.Selection(targetLine.start, targetLine.start);
					editor.revealRange(targetLine, vscode.TextEditorRevealType.InCenterIfOutsideViewport);

					logOutput(`[Debug Error] ${threadName} @ ${path.basename(targetPath)}:${line} (${body.process || '-'}) - ${errorSummary}`);
					if (Array.isArray(body.errorLogLines) && body.errorLogLines.length > 0) {
						for (const errorLine of body.errorLogLines.slice(0, 3)) {
							logOutput(`[Debug ErrorLog] ${errorLine}`);
						}
					}
					outputChannel.show(true);
					void vscode.window.showWarningMessage(
						`디버그 에러: ${errorSummary} @ ${path.basename(targetPath)}:${line} (${threadName})`,
					);
					return;
				} catch (err: any) {
					logOutput(`[Debug Error] 위치 표시 실패: ${err?.message ?? err}`);
				}
			}

			logOutput(`[Debug Error] ${threadName} - ${errorSummary} (소스 위치 해석 실패)`);
			if (Array.isArray(body.errorLogLines) && body.errorLogLines.length > 0) {
				for (const errorLine of body.errorLogLines.slice(0, 3)) {
					logOutput(`[Debug ErrorLog] ${errorLine}`);
				}
			}
			outputChannel.show(true);
		}),
	);

	// ════════════════════════════════════════════════════════════
	// Symbol cache & diagnostics initialization
	// ════════════════════════════════════════════════════════════

	// Initialize symbol cache lazily only when GPL context exists.
	if (hasOpenGplContext()) {
		setTimeout(() => {
			void ensureSymbolCacheInitialized('open GPL documents detected');
		}, 300);
	}
	
	// 열려있는 GPL 문서들에 대해 진단 실행
	vscode.workspace.textDocuments.forEach(document => {
		if (isGplDocument(document)) {
			diagnosticProvider.scheduleDiagnostics(document, 0);
		}
	});
}

export function deactivate() {
	// Controller cleanup — dispose()가 stop()을 포함해 소켓/타이머/EventEmitter까지 해제한다.
	try { runtimeConsole?.dispose(); } catch { /* noop */ }
	try { closeControllerConnection('deactivate'); } catch { /* noop */ }
	controllerTree?.stopPolling();
	stopLiveLogTerminal();

	if (outputChannel) {
		outputChannel.appendLine('GPL Language Support extension is now deactivated!');
		outputChannel.dispose();
	}
}

// Export logging function for use in other modules
export function logMessage(message: string) {
	if (outputChannel) {
		outputChannel.appendLine(message);
	}
}

/**
 * XML 베스트 프랙티스 HTML 로드
 */
async function loadXmlBestPracticesHtml(context: vscode.ExtensionContext): Promise<string> {
	try {
		const uri = vscode.Uri.joinPath(context.extensionUri, 'media', 'xmlBestPractices.html');
		const bytes = await vscode.workspace.fs.readFile(uri);
		return Buffer.from(bytes).toString('utf8');
	} catch (error) {
		if (outputChannel) {
			const message =
				'Failed to load media/xmlBestPractices.html; falling back to inline XML best practices HTML.'
				+ (error instanceof Error && error.message ? ` Reason: ${error.message}` : '');
			outputChannel.appendLine(message);
		}
		return getXmlBestPracticesFallbackHtml();
	}
}

/**
 * 폴백 HTML (리소스 파일 로드 실패 시)
 */
function getXmlBestPracticesFallbackHtml(): string {
	return `<!DOCTYPE html>
<html lang="ko">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>GPL XML 베스트 프랙티스</title>
</head>
<body>
	<h2>GPL XML 베스트 프랙티스</h2>
	<p>가이드 파일을 로드하지 못했습니다. 확장 로그(Output: "GPL Language Support")를 확인하세요.</p>
</body>
</html>`;
}

function formatDebugErrorSummary(errorMessage: unknown, errorCode: unknown, fallback: string): string {
	const message = typeof errorMessage === 'string' ? errorMessage.trim() : '';
	const code = typeof errorCode === 'number' && Number.isFinite(errorCode) ? errorCode : undefined;
	if (message && code !== undefined && !message.includes(String(code))) {
		return `${message} (STATUS ${code})`;
	}
	if (message) {
		return message;
	}
	if (code !== undefined) {
		return `STATUS ${code}`;
	}
	return fallback || 'Error';
}
