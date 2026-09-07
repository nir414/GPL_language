/**
 * ExtensionHost — activate() 가 만들고 모든 명령 그룹(`activation/*.ts`)이 공유하는 확장 런타임 컨텍스트.
 *
 * 종전에는 `extension.ts` 의 activate() 한 함수(5,300줄) 안에 명령 핸들러 72개·헬퍼 70여 개·공유 클로저
 * 변수 50여 개가 함께 있었다(2026-09-07 분해). 이 객체는 그 클로저가 공유하던 것을 **명시적으로** 담는다:
 *
 * - 서비스(불변): 출력 채널 3개·배포 진단 컬렉션·심볼 캐시·진단 provider·ExtensionContext.
 * - 상태(가변): 트리/상태바/런타임 콘솔/연결 건강 모니터, 디버그 세션 활성 여부, 마지막 배포·에러 스냅샷 등.
 *   여러 명령 그룹이 읽고 쓰므로 필드로 두고 **항상 `host.x` 로 접근**한다(활성화 시점에 복사해 두면 낡은 값을 본다).
 * - 헬퍼: 로그·배포 잠금·컴파일 검증 상태·런타임 콘솔 싱글톤·연결 상태 반영·Agent Bridge — 두 그룹 이상이 쓰는 것만.
 * - 하위 API(`project`·`connection`·`deploy`·`decorations`): 그 그룹의 활성화 함수가 돌려준 객체. activate() 가
 *   동기적으로 끝나기 전에 모두 대입되고 명령 핸들러는 그 뒤에만 실행되므로 정의 대입(`!`)으로 둔다 — 활성화
 *   함수 안에서 이 필드를 **구조 분해로 복사하지 말고** 호출 시점에 `host.project.x()` 로 읽는다.
 */
import * as vscode from 'vscode';
import { SymbolCache } from '../symbolCache';
import { GPLDiagnosticProvider } from '../providers/diagnosticProvider';
import { getControllerConfig, setIdlePingActive } from '../controller/controllerConnection';
import { AgentBridgeServer } from '../controller/agentBridge';
import { ConnectionHealthMonitor, ConnectionHealthProber } from '../controller/connectionHealth';
import { EditorBreakpointSync } from '../controller/breakpointSync';
import { ControllerBreakpointMirror } from '../controller/breakpointMirror';
import { checkProjectName, checkRemotePath, describeProjectNameProblem } from '../controller/projectNameGuard';
import { getDeployLock, describeDeployLock, DeployLockRecord } from '../controller/deployLock';
import { CompileStaleInfo, CompileStaleTracker } from '../controller/compileStale';
import { RuntimeConsole, RuntimeConsoleStatusSnapshot } from '../controller/runtimeConsole';
import { ControllerTreeProvider, RuntimeErrorContext, SituationDeploySnapshot } from '../views/controllerTreeProvider';
import { ConnectionStatusBar } from '../views/connectionStatusBar';
import { appendLiveLog } from '../log/liveLogTerminal';
import { fireDebugPollTrigger } from '../controller/debugBridge';
import { EXTENSION_VERSION } from '../config';
import type { ProjectContextApi } from './projectContext';
import type { ConnectionApi } from './connection';
import type { DeployApi } from './deploy';
import type { ExecutionDecorations } from './debugDecorations';

// recentDebugLogLines 보관 상한 — 초과 시 오래된 라인부터 잘라낸다
const RECENT_DEBUG_LOG_MAX = 240;

export class ExtensionHost {
	// ── 서비스(불변) ──────────────────────────────────────────────────────────────
	readonly context: vscode.ExtensionContext;
	/** Output: "GPL Language Support" — 확장 로그. */
	readonly outputChannel: vscode.OutputChannel;
	/** Output: "GPL Traffic" — 1402 트래픽 모니터. */
	readonly trafficChannel: vscode.OutputChannel;
	/** Output: "GPL Console" — 1403 런타임 콘솔 출력. */
	readonly consoleChannel: vscode.OutputChannel;
	/** 배포(Compile) 에러를 Problems 에 올리는 컬렉션. */
	readonly deployDiagnostics: vscode.DiagnosticCollection;
	readonly symbolCache: SymbolCache;
	readonly diagnosticProvider: GPLDiagnosticProvider;

	// ── 상태(가변) — 항상 host.x 로 읽는다 ─────────────────────────────────────────
	runtimeConsole: RuntimeConsole | undefined;
	private runtimeConsoleHooksBound = false;
	statusBar: ConnectionStatusBar | undefined;
	/** 제어기 트리 — activate() 가 언어 기능 배선 직후 만든다(그 전에는 markCompileStale 등이 `?.` 로 건너뛴다). */
	controllerTree!: ControllerTreeProvider;
	/** 연결 건강 모니터/재프로브(controller/connectionHealth.ts) — 연결 유실 판정의 단일 출처(2026-08-28). */
	healthMonitor: ConnectionHealthMonitor | undefined;
	healthProber: ConnectionHealthProber | undefined;
	isDebugSessionActive = false;
	lastDeploySnapshot: SituationDeploySnapshot | undefined;
	/** 디버그 어댑터가 gpl.sourceStale 이벤트로 알린 "소스가 제어기 컴파일 코드보다 새로움" 상태(GitHub #21). */
	lastSourceStale: { projectName: string; files: string[]; compiledAt?: number } | undefined;
	sourceStaleNotifiedSessionId: string | undefined;
	lastRuntimeErrorContext: RuntimeErrorContext | undefined;
	/** `[main]` 로그의 최근 라인 — 오류 상세 보기에서 "직전 로그"로 보여 준다. */
	readonly recentDebugLogLines: string[] = [];
	/**
	 * "컴파일 검증 필요" 상태 — /GPL 소스는 업로드됐지만 Compile로 검증되지 않은 프로젝트.
	 * 상태와 규칙은 `controller/compileStale.ts`(순수 모듈)에 있고, 여기서는 로그·UI 반영만 얹는다.
	 * 해제는 `onDidRecordCompiled` 구독으로도 일어나므로 F5(deployBeforeAttach)·MCP 경로에서도 배지가 남지 않는다.
	 */
	readonly compileStaleProjects = new CompileStaleTracker();
	/** 에디터 중단점 → 제어기 실시간 동기화(§1-AP). activateBreakpointCommands 가 만든다. */
	breakpointSync: EditorBreakpointSync | undefined;
	/** 제어기 → 에디터 중단점 미러(§1-CO). activateBreakpointCommands 가 만든다. */
	breakpointMirror!: ControllerBreakpointMirror;

	// ── 하위 API — 각 활성화 함수의 반환값. activate() 가 끝나기 전에 모두 대입된다 ────────
	project!: ProjectContextApi;
	connection!: ConnectionApi;
	deploy!: DeployApi;
	decorations!: ExecutionDecorations;

	constructor(context: vscode.ExtensionContext) {
		this.context = context;
		// 채널 생성 순서는 종전(activate 진행 순)과 같다 — 시점만 활성화 맨 앞으로 모았다.
		this.outputChannel = vscode.window.createOutputChannel('GPL Language Support');
		this.trafficChannel = vscode.window.createOutputChannel('GPL Traffic');
		this.consoleChannel = vscode.window.createOutputChannel('GPL Console');
		this.deployDiagnostics = vscode.languages.createDiagnosticCollection('gpl-deploy');
		this.symbolCache = new SymbolCache(this.outputChannel);
		this.diagnosticProvider = new GPLDiagnosticProvider();
		context.subscriptions.push(this.outputChannel, this.trafficChannel, this.consoleChannel, this.deployDiagnostics);
	}

	// ── 로그 ─────────────────────────────────────────────────────────────────────
	/**
	 * 확장 로그 한 줄 — Output 채널 + 라이브 로그 터미널 + 최근 라인 링버퍼.
	 * 콜백 인자로 그대로 넘길 수 있게(`{ log: host.log }`) 화살표 프로퍼티다.
	 */
	readonly log = (msg: string): void => {
		this.recentDebugLogLines.push(`[main] ${msg}`);
		if (this.recentDebugLogLines.length > RECENT_DEBUG_LOG_MAX) {
			this.recentDebugLogLines.splice(0, this.recentDebugLogLines.length - RECENT_DEBUG_LOG_MAX);
		}
		this.outputChannel.appendLine(msg);
		appendLiveLog(`[main] ${msg}`);
	};

	// ── 배포 잠금 / 프로젝트명 가드 ───────────────────────────────────────────────
	// 배포 잠금 — 구 boolean `deployInFlight`를 대체(2026-08-25, 이슈 #15·#17). 획득/해제는 deploy()(deployService)와
	// gpl.saveToFlash가 하고, 여기서는 조회만 한다. 잠금 파일(%TEMP%/gpl-controller/<ip>.lock.json)은 다른 VS Code 창과
	// controller-mcp도 읽으므로 "업로드 도중 Compile/Start" 차단이 프로세스 경계를 넘는다 (controller/deployLock.ts).
	/** 현재 배포 잠금 보유자(이 창·다른 창·살아 있는 다른 프로세스). 없으면 undefined. */
	currentDeployLockHolder(): DeployLockRecord | undefined {
		return getDeployLock(getControllerConfig().ip).current()?.record;
	}

	/** 배포 잠금 보유 중 경고 — 누가·어느 단계·언제부터인지 함께 보여 준다(이슈 #15). */
	warnDeployBusy(action: string, holder: DeployLockRecord, hint?: string): void {
		const msg = `${action} 불가 — 배포가 진행 중입니다 (${describeDeployLock(holder)})${hint ? `. ${hint}` : ''}`;
		this.log(`[Lock] ${msg}`);
		void vscode.window.showWarningMessage(msg, '출력 보기').then(pick => {
			if (pick === '출력 보기') { this.outputChannel.show(true); }
		});
	}

	/**
	 * 프로젝트명/원격 경로가 1402 명령 인자로 안전한지 확인하고, 아니면 오류 메시지를 띄운 뒤 false.
	 * 제어기 콘솔 명령은 인자를 공백으로 구분하고 인용 문법이 없어(Brooks 문서 Compile·Load·Start) 공백이 든
	 * 이름은 명령을 끊는다 — 이름을 명령에 끼워 넣는 모든 진입점이 이 한 함수를 거친다.
	 */
	ensureProjectNameSafe(name: string, kind: 'project' | 'folder' | 'remote', action: string): boolean {
		const check = kind === 'remote' ? checkRemotePath(name) : checkProjectName(name);
		if (check.ok) { return true; }
		const reason = describeProjectNameProblem(name, kind, check);
		this.log(`[${action}] 중단: ${reason}`);
		void vscode.window.showErrorMessage(`${action} 중단 — ${reason}`);
		return false;
	}

	// ── "컴파일 검증 필요" 상태 ──────────────────────────────────────────────────
	findCompileStale(projectName: string): CompileStaleInfo | undefined {
		return this.compileStaleProjects.find(projectName);
	}

	markCompileStale(projectName: string, reason: string, projectDir?: string): void {
		const info = this.compileStaleProjects.mark(projectName, reason, projectDir);
		if (!info) { return; }
		this.log(`[Deploy] 컴파일 검증 필요: ${projectName} — ${reason} (Start는 제어기가 자체 컴파일 — 소스 에러가 있으면 Start 실패, 먼저 Quick Compile 권장)`);
		this.controllerTree?.setCompileStale(info);
		this.statusBar?.setCompileStale(info);
	}

	clearCompileStale(projectName: string): void {
		const done = this.compileStaleProjects.clear(projectName);
		// 없던 항목이면 조용히 끝낸다 — 같은 Compile이 직접 호출과 onDidRecordCompiled로 두 번 들어와도 로그가 겹치지 않는다.
		if (!done) { return; }
		this.log(`[Deploy] 컴파일 검증 필요 상태 해제: ${projectName}`);
		this.controllerTree?.setCompileStale(done.next);
		this.statusBar?.setCompileStale(done.next);
	}

	// ── 런타임 콘솔(1403) 싱글톤 ───────────────────────────────────────────────────
	/** 런타임 콘솔 상태 스냅샷 (콘솔 미생성 시 '미연결' idle 스냅샷). */
	currentRuntimeConsoleStatus(): RuntimeConsoleStatusSnapshot {
		return this.runtimeConsole?.getStatusSnapshot() ?? {
			state: 'idle',
			connected: false,
			reason: '미연결',
			noPayloadStreak: 0,
			immediateEofStreak: 0,
			lastChangedAt: Date.now(),
		};
	}

	/** 런타임 콘솔을 중지하고 트리 뷰의 콘솔 상태 표시를 갱신한다. */
	stopRuntimeConsoleAndSyncTree(): void {
		this.runtimeConsole?.stop();
		if (this.runtimeConsole) {
			this.controllerTree?.setRuntimeConsoleStatus(this.runtimeConsole.getStatusSnapshot());
		}
	}

	/**
	 * RuntimeConsole 싱글톤 확보.
	 *
	 * 인스턴스를 재사용한다. start()가 idempotent하므로 idle/연결 중/재연결 대기
	 * 어떤 상태에서 호출되어도 좀비 인스턴스나 중복 소켓이 생기지 않는다.
	 * (이전: 끊긴 인스턴스를 stop+재생성 → 좀비의 reconnect timer가 1403을 두고 경쟁)
	 */
	ensureRuntimeConsole(): RuntimeConsole {
		if (!this.runtimeConsole) {
			this.runtimeConsole = new RuntimeConsole(this.consoleChannel, this.outputChannel);
		}
		const runtimeConsole = this.runtimeConsole;
		if (!this.runtimeConsoleHooksBound) {
			runtimeConsole.onDidConnect(() => {
				this.controllerTree?.setRuntimeConsoleStatus(runtimeConsole.getStatusSnapshot());
			});
			runtimeConsole.onDidDisconnect(() => {
				this.controllerTree?.setRuntimeConsoleStatus(runtimeConsole.getStatusSnapshot());
			});
			runtimeConsole.onDidStatusChanged((status) => {
				this.controllerTree?.setRuntimeConsoleStatus(status);
				// 1403 연결 실패/소켓 에러는 제어기 부재의 조기 신호(TCP keepalive 5 s) — 유실을 단정하지 않고
				// 연결 건강 모니터에 힌트로 넘겨 1402 프로브로 확인하게 한다(2026-08-28). 빈 세션·Immediate EOF 는 정상 폴링이라 제외.
				if (status.state === 'connect-failed' || status.state === 'socket-error') {
					this.healthMonitor?.reportHint('runtime-console', `${status.state}${status.lastErrorCode ? ` ${status.lastErrorCode}` : ''} — ${status.reason}`);
				}
			});
			runtimeConsole.onDidReceiveData(() => {
				if (this.isDebugSessionActive) {
					fireDebugPollTrigger();
				}
			});
			this.runtimeConsoleHooksBound = true;
		}
		runtimeConsole.start();
		this.controllerTree?.setRuntimeConsoleStatus(runtimeConsole.getStatusSnapshot());
		return runtimeConsole;
	}

	// ── 연결 상태 반영 ───────────────────────────────────────────────────────────
	updateUiContexts(connected: boolean): void {
		void vscode.commands.executeCommand('setContext', 'gpl.ui.connected', connected);
		void vscode.commands.executeCommand('setContext', 'gpl.ui.debugging', this.isDebugSessionActive);
	}

	setControllerConnected(connected: boolean, options?: { refreshTree?: boolean; reason?: 'disconnect' | 'lost' }): void {
		const wasConnected = this.controllerTree?.isConnected ?? false;
		this.statusBar?.setConnected(connected);
		this.updateUiContexts(connected);
		this.controllerTree?.setConnected(connected, { refresh: options?.refreshTree, reason: options?.reason });
		// 연결 건강 모니터도 같은 상태로 맞춘다 — 해제(명시적/유실)면 진행 중인 재프로브를 멈춘다.
		this.healthMonitor?.setConnected(connected);
		if (!connected) { this.healthProber?.stop(); }
		// 1402 유휴 ping(GDE 방식 세션 유지, §1-BM): 연결 중에만 돈다. 결과는 setIdlePingObserver 로 건강 모니터에 전달.
		setIdlePingActive(connected);
		if (connected && !wasConnected) {
			// 연결 확립 에지에서 에디터 중단점으로 제어기를 따라잡는다 (설정 켜진 경우만, §1-AP)
			this.breakpointSync?.onControllerConnected();
		}
		// 외부 에이전트(MCP)가 확장의 연결 상태를 알 수 있게 presence 갱신(§1-BQ).
		this.ensureAgentBridge()?.setState({ connected, debugSessionActive: this.isDebugSessionActive });
	}

	// ── Agent Bridge (MCP → 확장 명령 호출, §1-BQ) ─────────────────────────────────
	// MCP 서버가 제어기에 직접 붙는 대신 이 브리지로 확장 명령을 호출하면 1402 트래픽이 확장의 단일 세션/직렬 큐/명령 정책을
	// 그대로 타므로 세션 경쟁("1402를 VS Code가 점유 중")이 사라진다. 파일 계약은 controller/agentBridge.ts 머리말 참조.
	private agentBridge: AgentBridgeServer | undefined;
	private agentBridgeKey = '';

	ensureAgentBridge(): AgentBridgeServer | undefined {
		if (vscode.workspace.getConfiguration('gpl.agentBridge').get<boolean>('enabled', true) === false) {
			if (this.agentBridge) { this.agentBridge.stop(); this.agentBridge = undefined; this.agentBridgeKey = ''; }
			return undefined;
		}
		const cfg = getControllerConfig();
		const key = `${cfg.ip}:${cfg.port}`;
		if (this.agentBridge && this.agentBridgeKey === key) { return this.agentBridge; }
		// 제어기 주소가 바뀌면 presence/요청 경로가 달라지므로 새로 시작한다.
		this.agentBridge?.stop();
		this.agentBridge = new AgentBridgeServer({
			ip: cfg.ip,
			port: cfg.port,
			extensionVersion: EXTENSION_VERSION,
			workspace: vscode.workspace.workspaceFolders?.[0]?.name,
			execute: (command, args) => Promise.resolve(
				args === undefined
					? vscode.commands.executeCommand(command)
					: vscode.commands.executeCommand(command, args),
			),
			isKnownCommand: async command => (await vscode.commands.getCommands(true)).includes(command),
			log: this.log,
		});
		this.agentBridgeKey = key;
		this.agentBridge.start();
		this.agentBridge.setState({ connected: this.controllerTree?.isConnected ?? false, debugSessionActive: this.isDebugSessionActive });
		return this.agentBridge;
	}

	/** deactivate/dispose 시 브리지 정리(presence 파일 제거). */
	stopAgentBridge(): void {
		this.agentBridge?.stop();
		this.agentBridge = undefined;
	}
}
