/**
 * 확장 진입점 — activate()/deactivate().
 *
 * 2026-09-07 분해: 종전에는 activate() 한 함수(5,300줄)에 명령 핸들러 72개·헬퍼 70여 개·공유 클로저 변수
 * 50여 개가 함께 있었다. 이제 이 파일은 **배선만** 한다 — `ExtensionHost`(activation/host.ts)를 만들고,
 * 명령 그룹별 활성화 함수(activation/*.ts)를 종전과 같은 순서로 부른다. 각 그룹의 본문은 옮기기 전과 같다.
 *
 * 순서가 뜻을 갖는 지점:
 * - 트리(`controllerTree`)와 프로젝트 컨텍스트(`host.project`)는 이를 쓰는 명령 그룹보다 먼저 만든다.
 * - 하위 API(`host.connection`·`host.deploy`·`host.decorations`)는 활성화 중에 대입되고 명령 핸들러는 그 뒤에만
 *   실행된다(activate 는 동기적으로 끝난다).
 * - 언어 기능 마무리(심볼 캐시 지연 초기화·열린 문서 진단)는 종전처럼 맨 끝에서 한다.
 */
import * as vscode from 'vscode';
import { EXTENSION_VERSION, getTraceServerLevel, isTraceOn } from './config';
import { setTrafficChannel, setHeldSocketObserver, closeControllerConnection } from './controller/connection/controllerConnection';
import { attachDeployRecordStore, onDidRecordCompiled } from './controller/deployment/deployRecord';
import { getControllerConfig } from './controller/connection/controllerConnection';
import { normalizeAbsoluteRemoteDir } from './controller/files/ftpClient';
import { onRemoteFolderCleared } from './controller/files/remoteFolderClear';
import { attachSyncManifestStore } from './controller/files/syncManifest';
import { setRuntimeConsoleHealthProvider, RuntimeConsoleHealth } from './controller/debugging/debugBridge';
import { activateProjectPicker } from './controller/projects/projectPicker';
import { activateGprSync } from './controller/projects/gprSyncCommand';
import { activatePromoteSource } from './project/gpr/promoteSourceCommand';
import { ControllerTreeProvider } from './views/tree/controllerTreeProvider';
import { ConnectionStatusBar } from './views/statusbar/connectionStatusBar';
import { setDashboardConnectionObserver } from './views/dashboard/controllerDashboardPanel';
import { stopLiveLogTerminal } from './log/liveLogTerminal';
import { activateDebug } from './debug/session/activateDebug';

import { ExtensionHost } from './activation/host';
import { ExecutionDecorations } from './activation/debug/debugDecorations';
import { activateLanguageFeatures } from './activation/language/languageFeatures';
import { activateXmlCommands } from './activation/language/xmlCommands';
import { activateProjectContext } from './activation/deploy/projectContext';
import { activateBreakpointCommands } from './activation/debug/breakpointCommands';
import { activateConnection } from './activation/controller/connection';
import { activateDeployCommands } from './activation/deploy/deploy';
import { activateConsoleCommands } from './activation/controller/consoleCommands';
import { activateAiAgentSetup } from './activation/ai/aiAgentSetup';
import { activateAiDebugCommands } from './activation/ai/aiDebugCommands';
import { activateControllerCommands } from './activation/controller/controllerCommands';
import { activateClockSync } from './activation/controller/clockSync';
import { activateTreeCommands } from './activation/controller/treeCommands';
import { activateFtpCommands } from './activation/remote/ftpCommands';
import { activateDebugIntegration } from './activation/debug/debugIntegration';
import { activateUriHandler } from './activation/ai/uriHandler';
import { activateControllerProjectDebug } from './activation/remote/controllerProjectDebug';

/** 활성화된 호스트 — deactivate()·logMessage() 가 쓴다. */
let host: ExtensionHost | undefined;

export function activate(context: vscode.ExtensionContext) {
	const h = new ExtensionHost(context);
	host = h;
	setTrafficChannel(h.trafficChannel);

	h.log(`GPL Language Support extension is now active! (v${EXTENSION_VERSION})`);

	// Debug/trace logging (workspace/user settings)
	// - gpl.trace.server = off | messages | verbose (베타 기간 기본 verbose — 분석용 로그는 늘 남긴다)
	// 트레이스 레벨은 "얼마나 자세히 남길지"이지 "패널을 열지"가 아니다 — 종전에는 켜져 있으면 활성화 때 Output 을 강제로 열어
	// 사용자가 보던 패널(GPL Console·터미널)을 덮었다(2026-10-27 지적). 패널은 사용자가 열 때만 연다.
	const traceLevel = getTraceServerLevel(vscode.workspace);
	if (isTraceOn(vscode.workspace)) {
		h.log(`[Trace] gpl.trace.server = ${traceLevel}`);
	}

	// ── 언어 기능 ─────────────────────────────────────────────────────────────
	const primeLanguageFeatures = activateLanguageFeatures(h);
	activateXmlCommands(h);

	// ════════════════════════════════════════════════════════════
	// Controller integration – initialization
	// ════════════════════════════════════════════════════════════
	// RuntimeConsole 싱글톤은 지연 생성되므로 dispose 시점에 존재하면 함께 정리한다
	// (소켓/재연결 타이머/EventEmitter 해제).
	context.subscriptions.push({
		dispose: () => {
			try { h.runtimeConsole?.dispose(); } catch { /* noop */ }
		},
	});

	h.statusBar = new ConnectionStatusBar();
	context.subscriptions.push(h.statusBar);

	// Agent Bridge (MCP → 확장 명령 호출, §1-BQ) — 본체는 host.ensureAgentBridge().
	context.subscriptions.push({ dispose: () => h.stopAgentBridge() });
	h.ensureAgentBridge();

	h.updateUiContexts(false);

	// 컴파일 스냅샷 레코드(#21) — Deploy/F5 Compile 성공 시 deployService가 기록, 디버그 어댑터가 attach 시 대조.
	// projectDir 이 워크스페이스 종속이라 globalState 가 아닌 workspaceState 에 둔다.
	attachDeployRecordStore(context.workspaceState);

	// "컴파일 검증 필요" 배지 해제를 배포 경로와 분리한다(§1-CT 원인 ①). 종전에는 runDeploy 래퍼만 해제해서
	// F5 의 deployBeforeAttach(deployService.deploy() 직접 호출)나 MCP 경유 배포는 Compile 이 성공해도 배지가 남았다.
	// recordCompiled 는 Compile 성공 확정 지점·업로드 스타트의 Start 성공 지점·`GPL: Start`(-compile) 성공 지점에서만 발화하므로
	// 해제 조건과 일치한다. 상태는 제어기별이라 기록의 ip 로 해제한다(§1-GN).
	// 그 Compile 에 함께 포함된 ProjectLibrary(전이 포함)도 함께 해제한다 — 라이브러리를 Upload Only 한 뒤 쓰는 쪽이 Compile 에
	// 성공해도 라이브러리 항목이 남던 문제(2026-11-03 inbox ①).
	context.subscriptions.push(onDidRecordCompiled(rec => h.clearCompileStaleAfterCompile(rec.projectName, rec.ip, rec.projectDir)));
	// /GPL 에서 프로젝트 폴더가 지워지면(트리 비우기·Unload -all 전 비우기·AI clear_remote_folder) 제어기에 그 소스가 없다 — 해제(inbox ④).
	context.subscriptions.push(onRemoteFolderCleared(e => {
		if (e.base.toLowerCase() !== normalizeAbsoluteRemoteDir(getControllerConfig().ftpBasePath).toLowerCase()) { return; }
		h.releaseCompileStale(e.deleted, `${e.base} 에서 폴더를 지움(제어기에 소스 없음)`, e.host);
	}));
	// "컴파일 검증 필요" 상태도 같은 workspaceState 에 영속한다 — 창을 다시 열어도 "아직 검증 안 됨"은 사실 그대로다(§1-GN).
	h.compileStaleProjects.attach(context.workspaceState);
	h.backfillCompileStaleLibraryFlags();

	// 업로드 동기화 지문(syncManifest) — 미러/업로드의 스킵 판정을 크기뿐 아니라 내용(SHA-1) 기준으로 만든다.
	// 기록 대상이 "그 제어기 경로에 올려 둔 내용"이라 워크스페이스에 매이지 않는다 → globalState.
	attachSyncManifestStore(context.globalState);

	// 1403 건강 상태 공급(#22 제안 2): 디버그 어댑터가 Running 백업 폴 간격을 정할 때 참조한다.
	// alive = 콘솔이 살아 있는 상태(idle/stopped/실패 상태 아님)이고 최근 60 s 안에 연결 또는 페이로드가 있었음.
	const RUNTIME_CONSOLE_ALIVE_WINDOW_MS = 60_000;
	setRuntimeConsoleHealthProvider((): RuntimeConsoleHealth => {
		const s = h.currentRuntimeConsoleStatus();
		const dead = s.state === 'idle' || s.state === 'stopped' || s.state === 'connect-failed' || s.state === 'socket-error';
		const recent = Math.max(s.lastConnectAt ?? 0, s.lastPayloadAt ?? 0);
		const alive = !dead && recent > 0 && Date.now() - recent <= RUNTIME_CONSOLE_ALIVE_WINDOW_MS;
		return { alive, state: s.state, lastConnectAt: s.lastConnectAt, lastPayloadAt: s.lastPayloadAt };
	});
	context.subscriptions.push({ dispose: () => setRuntimeConsoleHealthProvider(undefined) });

	const controllerTree = new ControllerTreeProvider();
	h.controllerTree = controllerTree;
	controllerTree.setRuntimeConsoleStatus(h.currentRuntimeConsoleStatus());
	// 영속된 "컴파일 검증 필요" 목록을 트리·상태바에 올린다(상태바는 연결 전까지 숨김).
	h.syncCompileStaleViews();
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('gplThreads', controllerTree)
	);

	// 프로젝트 컨텍스트(기대 프로젝트·launch.json·파일명 해석) — 아래 그룹들이 host.project 로 쓴다.
	h.project = activateProjectContext(h);

	activateBreakpointCommands(h);

	// 외부(MCP AI/GDE)가 세운 스레드 정지를 에디터가 따라간다 (설정 gpl.controller.autoShowPausedLocation).
	// 디버그 세션 중에는 DAP가 정지 위치를 표시하므로 개입하지 않는다.
	context.subscriptions.push(
		controllerTree.onDidThreadPause(async ({ name, state }) => {
			if (h.isDebugSessionActive) { return; }
			const cfg = vscode.workspace.getConfiguration('gpl.controller');
			if (cfg.get<boolean>('autoShowPausedLocation') === false) { return; }
			h.log(`[Thread] ${name} → ${state} 전이 감지 — 정지 위치 자동 표시`);
			await vscode.commands.executeCommand('gpl.controller.threadShowLocation', { thread: { name } });
		})
	);
	// 트리 등록뿐 아니라 provider 인스턴스 자체도 정리 대상에 등록한다.
	// (pollTimer / EventEmitter / _debugModeSubscription 등이 deactivate 시 해제되도록)
	context.subscriptions.push(controllerTree);

	// ── Controller commands ──────────────────────────────────
	h.connection = activateConnection(h);
	h.deploy = activateDeployCommands(h);
	activateConsoleCommands(h);
	activateAiAgentSetup(h);
	activateAiDebugCommands(h);
	activateControllerCommands(h);
	activateClockSync(h);

	// 실행 위치 데코레이션(정지 줄·에러 줄) — 트리 명령과 디버그 이벤트가 함께 쓴다.
	h.decorations = new ExecutionDecorations();
	context.subscriptions.push(h.decorations);
	// 강조는 제어기 상태의 표시 — 쓰레드 목록이 갱신될 때마다 주인 쓰레드가 그 상태를 벗어났으면 지운다(§1-EP).
	context.subscriptions.push(controllerTree.onDidChangeRuntimeState(snapshot => h.decorations.reconcile(snapshot)));
	activateTreeCommands(h);
	activateFtpCommands(h);

	// ════════════════════════════════════════════════════════════
	// Debug Adapter Protocol (DAP) — brooks-gpl debugger
	// ════════════════════════════════════════════════════════════
	// 프로젝트 선택 공용 모듈(최근 선택 기억 + 탐색기 메뉴 context key `gpl.projectDirs`) — 디버그 구성 해석도 이를 쓴다.
	activateProjectPicker(context);
	// Project.gpr 소스 목록 동기화(.gpr 우클릭 명령 + .gpl 생성/이름 변경/삭제 시 반영 제안). 목록이 바뀌면 Project.gpr 기반 인덱스를 다시 만든다.
	activateGprSync(context, { log: h.log, refreshSymbols: () => h.symbolCache.refresh() });
	// 라이브러리 소스 BP 승격 — 제어기가 -508 로 거부하는 ProjectLibrary 소스를 메인 ProjectSource 로 올린다(§1-CK·§1-CT).
	activatePromoteSource(context, { log: h.log, refreshSymbols: () => h.symbolCache.refresh() });
	activateDebug(context);

	activateDebugIntegration(h);
	activateUriHandler(h);
	activateControllerProjectDebug(h);

	// ════════════════════════════════════════════════════════════
	// Symbol cache & diagnostics initialization
	// ════════════════════════════════════════════════════════════
	primeLanguageFeatures();
}

export function deactivate() {
	const h = host;
	host = undefined;
	// Controller cleanup — dispose()가 stop()을 포함해 소켓/타이머/EventEmitter까지 해제한다.
	try { h?.runtimeConsole?.dispose(); } catch { /* noop */ }
	try { closeControllerConnection('deactivate'); } catch { /* noop */ }
	try { h?.healthProber?.stop(); } catch { /* noop */ }
	setHeldSocketObserver(null);
	setDashboardConnectionObserver(undefined);
	h?.controllerTree?.stopPolling();
	stopLiveLogTerminal();

	if (h) {
		h.outputChannel.appendLine('GPL Language Support extension is now deactivated!');
		h.outputChannel.dispose();
	}
}

// Export logging function for use in other modules
export function logMessage(message: string) {
	host?.outputChannel.appendLine(message);
}
