/**
 * 제어기 상태 통합 TreeView — 연결 정보, 쓰레드, FTP 파일, 시스템 정보, 에러 로그를 사이드바에 표시.
 * 연결 후 주기적 폴링으로 실시간 상태를 갱신한다.
 *
 * 이 파일은 **조율자**다(2026-10-27 분리): 제어기와의 송수신·폴링·캐시·이벤트만 맡고,
 * 노드 모델은 treeNodes, 섹션 구성은 treeSections, TreeItem 변환은 treeItems, 쓰레드 행 표시는 threadRowPresentation,
 * 시스템 정보 행은 systemInfoItems, 상황/진단 보고서는 snapshotMarkdown(모두 vscode 무의존, treeItems 제외)이 맡는다.
 */

import * as vscode from 'vscode';
import { trySendCommand, getControllerConfig, getTrafficLogOptions, getConnectionStats, probeControllerCommand } from '../../controller/connection/controllerConnection';
import type { ProbeOutcome } from '../../controller/connection/controllerConnection';
import {
	parseThreadList,
	SHOW_THREAD_LIST_CMD,
	SHOW_THREAD_LIST_STACK_CMD,
	ThreadInfo,
	parseErrorLog,
	parseBreakList,
	BreakpointInfo,
} from '../../controller/protocol/responseParser';
import { EXTENSION_VERSION } from '../../config';
import type { RuntimeStateSnapshot } from '../../controller/debugging/executionMarks';
import { BreakpointTarget } from '../../controller/debugging/breakpointReconcile';
import { editorBreakpointTargets } from '../../controller/debugging/breakpointSync';
import { FtpEntry, listRemoteDir, listRemoteDirs } from '../../controller/files/ftpClient';
import { isFlashFtpContext, isFtpFolderContext } from '../../controller/files/ftpNodeTarget';
import { onDebugThreadsUpdated } from '../../controller/debugging/debugBridge';
import {
	FTP_AUTO_REFRESH_MIN_INTERVAL_MS,
	SYSTEM_INFO_AUTO_REFRESH_MIN_INTERVAL_MS,
	decideAutoRefresh,
} from './refreshThrottle';
import type { CompileStaleInfo } from '../../controller/deployment/compileStale';
import type { SituationDeploySnapshot } from '../../controller/deployment/deployOutcome';
import { renderThreadListReport } from '../../controller/threads/threadReport';
import { RuntimeConsoleStatusSnapshot } from '../../controller/runtime/runtimeConsole';
import { parseTemperatureResponse, PROBE_TEMPERATURE_CMD } from '../../controller/diagnostics/temperature';
import { ControllerNode, InfoNode, SectionNode } from './treeNodes';
import type { ControllerStatusSnapshot, RuntimeErrorContext, SystemInfoItem } from './treeSnapshot';
import {
	SECTION_LAYOUT_EPOCH,
	buildConnectedRoot,
	buildDisconnectedRoot,
	ftpNodes,
} from './treeSections';
import { toInfoItem, toSectionItem, toThreadItem } from './treeItems';
import { buildSystemInfoItems } from './systemInfoItems';
import { detectPauseTransition } from './threadPauseTransition';
import {
	buildDiagnosticSnapshotMarkdown as renderDiagnosticSnapshotMarkdown,
	buildSituationSnapshotMarkdown as renderSituationSnapshotMarkdown,
} from './snapshotMarkdown';

export type { RuntimeErrorContext } from './treeSnapshot';

// ── Provider ────────────────────────────────────────────

/** threadPollIntervalMs 설정 미지정 시 기본 폴링 간격 */
const DEFAULT_THREAD_POLL_MS = 5000;
/** 실행 중 쓰레드가 없을 때 폴링 간격 배수 (1402 부하 완화) */
const IDLE_POLL_MULTIPLIER = 3;
/** 상세(ErrorLog/Show Break) 폴링 간격 배수 */
const DETAIL_POLL_MULTIPLIER = 2;

export class ControllerTreeProvider implements vscode.TreeDataProvider<ControllerNode>, vscode.Disposable {
	private readonly ftpChildren = new Map<string, Promise<ControllerNode[]>>();
	private ftpBrowseOnly = false;
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<ControllerNode | undefined>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
	private _refreshInFlight = false;
	private _refreshAllInFlight = false;
	private _refreshFtpInFlight = false;
	private _refreshSystemInFlight = false;

	/**
	 * Show Thread 폴(프로브) 결과 — 성공/실패 종류. 유실 판정은 트리가 하지 않고 extension.ts 의
	 * ConnectionHealthMonitor(controller/connection/connectionHealth.ts)가 한다(2026-08-28: 종전 "3회 연속 실패" 자체 판정을
	 * 이관 — 디버그 중 트리 폴링이 꺼져도 어댑터 폴·재프로브로 같은 판정이 이어지게).
	 */
	private readonly _onDidProbe = new vscode.EventEmitter<ProbeOutcome>();
	readonly onDidProbe = this._onDidProbe.event;

	/**
	 * 일반 폴링에서 스레드가 실행→정지(Paused/Break/Error) 전이하거나 정지 상태로 새로
	 * 나타난 것(stopOnEntry)을 감지하면 발생. 외부(MCP AI/GDE)가 세운 정지를 에디터가
	 * 따라가는 용도(ai-handoff §1-AP). 디버그 세션 중에는 bridge 경로(enterDebugMode)로
	 * 갱신되므로 이 이벤트는 발생하지 않는다.
	 */
	private readonly _onDidThreadPause = new vscode.EventEmitter<{ name: string; state: string }>();
	readonly onDidThreadPause = this._onDidThreadPause.event;

	/**
	 * 쓰레드 목록(과 마지막 ErrorLog 건수)이 바뀔 때마다 발생 — 폴링·디버그 브리지·연결 해제(빈 목록) 모두 같은 경로.
	 * 에디터의 실행 위치 강조(정지 줄·에러 줄)가 "주인 쓰레드가 아직 그 상태인가"를 여기서 확인해 낡은 강조를 지운다
	 * (`ExecutionDecorations.reconcile`, §1-EP). 디버그 세션 중에는 ErrorLog 를 재조회하지 않으므로 `errorCount` 는 마지막 값이다.
	 */
	private readonly _onDidChangeRuntimeState = new vscode.EventEmitter<RuntimeStateSnapshot>();
	readonly onDidChangeRuntimeState = this._onDidChangeRuntimeState.event;

	private _connected = false;
	private threads: ThreadInfo[] = [];
	private errors: string[] = [];
	private ftpEntries: FtpEntry[] = [];
	private ftpError: string | null = null;
	private ftpFlashEntries: FtpEntry[] = [];
	private ftpFlashError: string | null = null;
	/** 마지막 FTP 목록 조회 성공 시각(epoch ms, 0=없음) — 자동 재조회 억제 판정·설명 표기용 (#22) */
	private lastFtpRefreshAt = 0;
	/** FTP 캐시가 어느 제어기/경로의 것인지(`ip|/GPL|flash`). 바뀌면 억제 없이 재조회한다. */
	private ftpCacheKey = '';
	private sysInfo: SystemInfoItem[] = [];
	/** 마지막 시스템 정보 조회 성공 시각(epoch ms, 0=없음) */
	private lastSystemInfoRefreshAt = 0;
	/** 시스템 정보 캐시의 제어기 IP */
	private systemInfoCacheKey = '';
	private pollTimer: ReturnType<typeof setTimeout> | null = null;
	/** 폴링 루프 세대 토큰 — stop/start/디버그 진입 시 증가시켜 낡은 콜백의 재스케줄을 차단 */
	private pollGeneration = 0;
	/** 진행 중인 refresh 본문 promise — 강제 갱신이 완료를 기다릴 수 있게 보관 */
	private _refreshPromise: Promise<void> | null = null;
	private lastDetailPollAt = 0;
	/** 연결 후 Show Thread 목록을 한 번이라도 수신했는지 — 첫 목록은 정지 전이 비교에서 제외 */
	private hasReceivedThreadList = false;
	private breakpoints: BreakpointInfo[] = [];
	private expectedProjectName = '';
	private expectedProjectFolderName = '';
	private runtimeConsoleStatus: RuntimeConsoleStatusSnapshot = {
		state: 'idle',
		connected: false,
		reason: '미연결',
		noPayloadStreak: 0,
		immediateEofStreak: 0,
		lastChangedAt: Date.now(),
	};
	/** 런타임 레이아웃 초기화 횟수 — SECTION_LAYOUT_EPOCH 와 함께 섹션 id 를 이루어, 사용자가 명령으로
	 *  접힘 상태를 기본값으로 되돌릴 수 있게 한다(gpl.controller.resetPanelLayout). */
	private sectionLayoutSalt = 0;
	private runtimeErrorContext?: RuntimeErrorContext;
	/** "컴파일 검증 필요" 목록 — 현재 제어기 것(정본은 host 의 CompileStaleTracker — 여기는 표시만). */
	private compileStale?: readonly CompileStaleInfo[];
	private editorBreakpointTargetResolver?: (fsPath: string, line: number) => BreakpointTarget | undefined;

	/** 디버그 세션 중 bridge 이벤트 구독 핸들 */
	private _debugModeSubscription: vscode.Disposable | undefined;

	get isConnected(): boolean { return this._connected; }

	setEditorBreakpointTargetResolver(
		resolver: (fsPath: string, line: number) => BreakpointTarget | undefined,
	): void {
		this.editorBreakpointTargetResolver = resolver;
	}

	/**
	 * 섹션 접힘 상태를 기본값으로 되돌린다(gpl.controller.resetPanelLayout).
	 * salt 를 올리면 섹션 TreeItem.id 가 바뀌어 VS Code 가 저장해 둔 접기 상태를 잃고,
	 * provider 가 주는 기본 collapsibleState 를 다시 따른다.
	 */
	resetSectionLayout(): void {
		this.sectionLayoutSalt++;
		this._onDidChangeTreeData.fire(undefined);
	}

	/** "컴파일 검증 필요" 목록 표시(프로젝트 상태 섹션, 프로젝트마다 한 줄). 빈 목록·undefined면 해제. */
	setCompileStale(items?: readonly CompileStaleInfo[]): void {
		this.compileStale = items && items.length > 0 ? items : undefined;
		this._onDidChangeTreeData.fire(undefined);
	}

	setExpectedProjectName(name?: string): void {
		this.setExpectedProjectContext(name, name);
	}

	setExpectedProjectContext(projectName?: string, folderName?: string): void {
		this.expectedProjectName = (projectName || '').trim();
		this.expectedProjectFolderName = (folderName || '').trim();
		this._onDidChangeTreeData.fire(undefined);
	}

	getExpectedProjectName(): string {
		return this.expectedProjectName;
	}

	/** 데이터 변경 없이 트리만 다시 그린다(설정 변경 등으로 라벨/설명이 바뀔 때). 1402 폴링을 유발하지 않는다. */
	redraw(): void {
		this._onDidChangeTreeData.fire(undefined);
	}

	setRuntimeConsoleStatus(status: RuntimeConsoleStatusSnapshot): void {
		this.runtimeConsoleStatus = status;
		this._onDidChangeTreeData.fire(undefined);
	}

	setRuntimeErrorContext(context?: RuntimeErrorContext): void {
		this.runtimeErrorContext = context;
		this._onDidChangeTreeData.fire(undefined);
	}

	/**
	 * 연결 상태 변경 — 연결 시 즉시 폴링 시작, 해제 시 정리.
	 *
	 * - 연결 시 FTP 목록·시스템 정보는 **조건부** 재조회(refreshFtpIfStale/refreshSystemInfoIfStale):
	 *   유실→재연결 플랩마다 전부 재조회하던 것을, 5분 이내 성공 캐시가 있으면 건너뛴다(GitHub #22 제안 7).
	 *   쓰레드/에러/BP 폴링(refresh)은 종전대로 즉시 시작한다.
	 * - 해제 시 `reason`이 'lost'(연결 유실 — extension.ts 의 연결 건강 모니터가 확정)면 FTP/시스템 정보 캐시를
	 *   보존하고, 'disconnect'(명시적 해제, 기본값)면 종전처럼 모두 비운다.
	 */
	setConnected(connected: boolean, options?: { refresh?: boolean; reason?: 'disconnect' | 'lost' }): void {
		this._connected = connected;
		this.lastDetailPollAt = 0;
		this.hasReceivedThreadList = false; // 새 연결마다 정지 전이 비교 기준을 다시 잡는다
		if (connected) {
			this._onDidChangeTreeData.fire(undefined);
			if (options?.refresh !== false) {
				this.refresh();
				this.refreshFtpIfStale();
				this.refreshSystemInfoIfStale();
				this.startPolling();
			}
		} else {
			const reason = options?.reason ?? 'disconnect';
			this.stopPolling();
			this.clearCachedControllerState({ keepOnDemandCaches: reason === 'lost' });
			this._onDidChangeTreeData.fire(undefined);
		}
	}

	/**
	 * 제어기에서 받아온 캐시 상태 일괄 초기화 (연결 해제/유실 시).
	 * keepOnDemandCaches=true(연결 유실)면 폴링 데이터(쓰레드/에러/BP)만 비우고, 온디맨드 캐시
	 * (FTP 목록·시스템 정보·마지막 조회 시각)는 보존한다 — 재연결 시 5분 억제 판정의 근거가 된다(#22).
	 * 유실 때도 비우면 플랩 뒤 항상 재조회가 돼 억제가 무의미해지므로, 명시적 disconnect에서만 비운다.
	 */
	private clearCachedControllerState(options?: { keepOnDemandCaches?: boolean }): void {
		this.hasReceivedThreadList = false;
		this.threads = [];
		this.errors = [];
		this.breakpoints = [];
		this.fireRuntimeStateChanged();
		if (options?.keepOnDemandCaches) { return; }
		this.ftpEntries = [];
		this.ftpError = null;
		this.ftpFlashEntries = [];
		this.ftpFlashError = null;
		this.lastFtpRefreshAt = 0;
		this.ftpCacheKey = '';
		this.sysInfo = [];
		this.lastSystemInfoRefreshAt = 0;
		this.systemInfoCacheKey = '';
	}

	startPolling(): void {
		this.stopPolling();
		if (!this._connected) { return; }
		this.scheduleNextPoll();
	}

	/**
	 * 적응형 폴링 스케줄러. 실행 중인 쓰레드가 없으면 간격을 3배로 늘려
	 * 제어기 1402 포트 부하를 줄인다.
	 */
	private scheduleNextPoll(): void {
		if (!this._connected) { return; }
		const baseInterval = this.baseThreadPollIntervalMs();
		const interval = this.threads.length > 0 ? baseInterval : baseInterval * IDLE_POLL_MULTIPLIER;
		const generation = this.pollGeneration;
		this.pollTimer = setTimeout(async () => {
			this.pollTimer = null;
			await this.refresh();
			// refresh 대기 중 stopPolling/enterDebugMode/startPolling이 호출됐다면 이 콜백은
			// 낡은 세대다 — 재스케줄하지 않는다 (디버그 중 폴링 지속·이중 루프 방지).
			if (generation !== this.pollGeneration || this._debugModeSubscription) { return; }
			this.scheduleNextPoll();
		}, interval);
	}

	/** 설정된 기본 폴링 간격(ms) 조회. */
	private baseThreadPollIntervalMs(): number {
		const cfg = vscode.workspace.getConfiguration('gpl.controller');
		return cfg.get<number>('threadPollIntervalMs') ?? DEFAULT_THREAD_POLL_MS;
	}

	stopPolling(): void {
		// 세대 토큰 증가 — 진행 중(await refresh) 콜백이 완료돼도 재스케줄하지 못하게 한다.
		// (enterDebugMode/startPolling도 이 메서드를 거치므로 함께 무효화된다)
		this.pollGeneration++;
		if (this.pollTimer) {
			clearTimeout(this.pollTimer);
			this.pollTimer = null;
		}
	}

	/**
	 * 디버그 세션 시작 시 호출. 독립 폴링을 중단하고 debugBridge 이벤트를 구독하여
	 * 디버그 세션의 Show Thread 결과로 쓰레드 섹션을 실시간 갱신한다.
	 * TCP 추가 호출 없이 사이드바 쓰레드 뷰가 살아 있게 된다.
	 * (이 동안 연결 유실 프로브도 어댑터 폴이 대신 공급한다 — debugBridge.onDebugProbeResult.)
	 */
	enterDebugMode(): void {
		this.stopPolling();
		this._debugModeSubscription?.dispose();
		this._debugModeSubscription = onDebugThreadsUpdated(threads => {
			this.threads = threads;
			this.fireRuntimeStateChanged();
			this._onDidChangeTreeData.fire(undefined);
		});
	}

	/** 쓰레드 목록·ErrorLog 건수 스냅샷을 구독자(실행 위치 강조)에 알린다. */
	private fireRuntimeStateChanged(): void {
		this._onDidChangeRuntimeState.fire({ threads: this.threads, errorCount: this.errors.length });
	}

	/**
	 * 디버그 세션 종료 시 호출. bridge 구독을 해제하고 일반 폴링을 재개한다.
	 */
	exitDebugMode(): void {
		this._debugModeSubscription?.dispose();
		this._debugModeSubscription = undefined;
		this.startPolling();
	}

	/**
	 * 전체 갱신 — 쓰레드 → 에러 → BP → FTP → 시스템 정보 순차 요청.
	 * TCP 충돌 방지를 위해 직렬화.
	 */
	async refreshAll(): Promise<void> {
		if (this._refreshAllInFlight) { return; }
		this._refreshAllInFlight = true;
		try {
		await this.refresh(true);
		await this.refreshFtp();
		await this.refreshSystemInfo();
		} finally {
			this._refreshAllInFlight = false;
		}
	}

	/**
	 * 쓰레드 + 에러 로그 + 브레이크포인트 갱신 (순차).
	 */
	async refresh(forceDetails: boolean = false): Promise<void> {
		if (!this._connected) { return; }
		if (this._refreshInFlight) {
			// 폴링 refresh가 진행 중일 때: 일반 폴링 호출은 스킵하되, 강제 갱신(forceDetails)은
			// 진행 중인 refresh 완료를 기다렸다가 1회 재실행한다 — copySituationForChat/
			// diagnosticSnapshot이 낡은 스냅샷을 조용히 복사하지 않도록.
			if (!forceDetails || !this._refreshPromise) { return; }
			try { await this._refreshPromise; } catch { /* noop */ }
			if (this._refreshInFlight || !this._connected) { return; }
		}
		this._refreshPromise = this.doRefresh(forceDetails);
		await this._refreshPromise;
	}

	private async doRefresh(forceDetails: boolean): Promise<void> {
		this._refreshInFlight = true;
		try {

		// 경량 주기 폴링: 기본은 경량 Show Thread, 수동 전체 새로고침(forceDetails)일 때만
		// -stack 상세형으로 thread별 timing까지 받는다(고빈도 폴 페이로드 경량 유지).
		// 프로브 타임아웃(gpl.controller.connectionProbeTimeoutMs, 기본 8 s)으로 보내고 결과를 연결 건강 모니터에
		// 보고한다(onDidProbe). 성공 기준은 `<STATUS>` 존재 — 소켓 종료로 잘린 부분 응답은 실패로 친다.
		const probe = await probeControllerCommand(forceDetails ? SHOW_THREAD_LIST_STACK_CMD : SHOW_THREAD_LIST_CMD);
		// 연결 해제(disconnect/유실) 후 도착한 늦은 응답 가드 — 해제 상태에서
		// this.threads 재할당이나 후속 명령(ErrorLog/Show Break) 전송을 막는다.
		if (!this._connected) { return; }

		this._onDidProbe.fire(probe);
		if (!probe.ok) {
			// 실패하면 상세 폴(ErrorLog/Show Break)을 보내지 않는다 — 종전엔 실패 뒤에도 그대로 보내 응답 없는
			// 제어기에 타임아웃 2회(각 10 s)를 더 기다렸고 그만큼 유실 감지가 늦어졌다(2026-08-28 검토).
			// 유실 판정·재프로브는 모니터(extension.ts)가 한다; 폴링은 연결 상태가 바뀔 때까지 정규 간격으로 계속된다.
			return;
		}
		const nextThreads = parseThreadList(probe.raw);
		// 첫 수신 목록은 비교 기준이 없으므로 전이 감지에서 제외한다
		// (연결 직후 이미 정지돼 있던 스레드로 점프 방지).
		if (this.hasReceivedThreadList) {
			this.firePauseTransitions(this.threads, nextThreads);
		}
		this.hasReceivedThreadList = true;
		this.threads = nextThreads;

		const now = Date.now();
		const baseInterval = this.baseThreadPollIntervalMs();
		const detailPollIntervalMs = Math.max(baseInterval * DETAIL_POLL_MULTIPLIER, DEFAULT_THREAD_POLL_MS);
		const shouldPollDetailsByState = this.threads.some(
			t => t.state === 'Error' || t.state === 'Break' || t.state === 'Paused',
		);
		const shouldPollDetails =
			forceDetails ||
			shouldPollDetailsByState ||
			(now - this.lastDetailPollAt >= detailPollIntervalMs);

		if (shouldPollDetails) {
			const errorResp = await trySendCommand('ErrorLog');
			if (!this._connected) { return; }
			const breakResp = await trySendCommand('Show Break');
			if (!this._connected) { return; }
			if (errorResp !== null) {
				this.errors = parseErrorLog(errorResp);
			}
			if (breakResp !== null) {
				this.breakpoints = parseBreakList(breakResp);
			}
			this.lastDetailPollAt = now;
		}

		this.fireRuntimeStateChanged();
		this._onDidChangeTreeData.fire(undefined);
		} finally {
			this._refreshInFlight = false;
		}
	}

	/**
	 * FTP /GPL·Flash Projects 디렉터리 목록 갱신 (강제 — 사용자 새로고침·배포 후·refreshAll).
	 * 두 경로를 **한 FTP 세션**(listRemoteDirs)으로 조회한다 — 종전엔 경로마다 세션을 열어
	 * 제어 연결(로그인) 2회 + 데이터 연결 2개가 들었다(GitHub #22 제안 7).
	 */
	async refreshFtp(): Promise<void> {
		if (!this._connected && !this.ftpBrowseOnly) { return; }
		if (this._refreshFtpInFlight) { return; }
		this.ftpChildren.clear();
		this._refreshFtpInFlight = true;
		try {
		const cfg = getControllerConfig();
		const cacheKey = ControllerTreeProvider.ftpCacheKeyFor(cfg.ip, cfg.ftpBasePath, cfg.ftpFlashProjectsPath);
		try {
			const [gpl, flash] = await listRemoteDirs(cfg.ip, [cfg.ftpBasePath, cfg.ftpFlashProjectsPath]);
			const latest = getControllerConfig();
			if (cacheKey !== ControllerTreeProvider.ftpCacheKeyFor(latest.ip, latest.ftpBasePath, latest.ftpFlashProjectsPath)) { return; }
			this.ftpEntries = gpl.entries ?? [];
			this.ftpError = gpl.error ?? null;
			this.ftpFlashEntries = flash.entries ?? [];
			this.ftpFlashError = flash.error ?? null;
		} catch (err: any) {
			// 세션 자체(접속/로그인) 실패 — 두 목록 모두 같은 사유로 실패 표시
			const msg = err?.message ?? String(err);
			this.ftpEntries = [];
			this.ftpError = msg;
			this.ftpFlashEntries = [];
			this.ftpFlashError = msg;
		}
		// '성공 조회' = 세션이 열려 목록을 하나라도 받은 경우. 시각·키는 억제 판정과 설명 표기에 쓴다.
		if (this.ftpError === null || this.ftpFlashError === null) {
			this.lastFtpRefreshAt = Date.now();
			this.ftpCacheKey = cacheKey;
		}
		this._onDidChangeTreeData.fire(undefined);
		} finally {
			this._refreshFtpInFlight = false;
		}
	}

	/**
	 * 연결 확립 시의 조건부 FTP 재조회(#22). 캐시가 없거나, 다른 제어기/경로의 것이거나, 마지막 성공 조회가
	 * FTP_AUTO_REFRESH_MIN_INTERVAL_MS 이상 지났을 때만 refreshFtp()를 부른다. 건너뛰면 트리는 보존된
	 * 캐시를 "마지막 조회 HH:mm"과 함께 보여 준다(툴팁에 새로고침 안내).
	 */
	private refreshFtpIfStale(): Promise<void> {
		const cfg = getControllerConfig();
		const decision = decideAutoRefresh(
			{
				lastSuccessAt: this.lastFtpRefreshAt,
				hasCache: this.ftpError === null || this.ftpFlashError === null,
				cacheKey: this.ftpCacheKey,
			},
			Date.now(),
			{
				minIntervalMs: FTP_AUTO_REFRESH_MIN_INTERVAL_MS,
				currentKey: ControllerTreeProvider.ftpCacheKeyFor(cfg.ip, cfg.ftpBasePath, cfg.ftpFlashProjectsPath),
			},
		);
		// 건너뛸 때 트리 재그리기는 불필요 — setConnected(true)가 직전에 fire 했고 buildRoot가 보존 캐시를 읽는다.
		if (!decision.refresh) { return Promise.resolve(); }
		return this.refreshFtp();
	}

	private static ftpCacheKeyFor(ip: string, basePath: string, flashPath: string): string {
		return `${ip}|${basePath}|${flashPath}`;
	}

	/**
	 * 시스템 정보 갱신 (강제 — 사용자 새로고침·refreshAll). 연결 확립 시에는 refreshSystemInfoIfStale가 대신 불린다.
	 * 행 구성(핵심 지표·툴팁)은 systemInfoItems 가 맡는다.
	 */
	async refreshSystemInfo(): Promise<void> {
		if (!this._connected) { return; }
		if (this._refreshSystemInFlight) { return; }
		this._refreshSystemInFlight = true;
		try {
		// TCP 직렬화
		const memResp = await trySendCommand('Show Memory');
		const flashResp = await trySendCommand('Show Flash Free');
		const cpuResp = await trySendCommand('Show CPU Profile');
		if (!this._connected) { return; }
		const temperature = parseTemperatureResponse(await trySendCommand(PROBE_TEMPERATURE_CMD));
		if (!this._connected) { return; }

		// 세 명령 중 하나라도 응답이 왔으면 '성공 조회'로 보고 시각을 기록한다(억제 판정·설명 표기용, #22).
		// 모두 null(연결 불량)이면 시각을 갱신하지 않아 다음 연결 확립 시 다시 조회된다.
		if (memResp !== null || flashResp !== null || cpuResp !== null || temperature.complete) {
			this.lastSystemInfoRefreshAt = Date.now();
			this.systemInfoCacheKey = getControllerConfig().ip;
		}

		this.sysInfo = buildSystemInfoItems({ memResp, flashResp, cpuResp, temperature });
		this._onDidChangeTreeData.fire(undefined);
		} finally {
			this._refreshSystemInFlight = false;
		}
	}

	/**
	 * 연결 확립 시의 조건부 시스템 정보 재조회(#22) — refreshFtpIfStale와 같은 규칙(5분·캐시·IP 일치).
	 * 메모리·Flash·CPU·온도 조회를 플랩마다 반복하지 않기 위함.
	 */
	private refreshSystemInfoIfStale(): Promise<void> {
		const decision = decideAutoRefresh(
			{
				lastSuccessAt: this.lastSystemInfoRefreshAt,
				hasCache: this.sysInfo.length > 0,
				cacheKey: this.systemInfoCacheKey,
			},
			Date.now(),
			{ minIntervalMs: SYSTEM_INFO_AUTO_REFRESH_MIN_INTERVAL_MS, currentKey: getControllerConfig().ip },
		);
		if (!decision.refresh) { return Promise.resolve(); }
		return this.refreshSystemInfo();
	}

	// ── TreeDataProvider ────────────────────────────────

	getTreeItem(element: ControllerNode): vscode.TreeItem {
		switch (element.type) {
			case 'section': return toSectionItem(element, `${SECTION_LAYOUT_EPOCH}.${this.sectionLayoutSalt}`);
			case 'thread': return toThreadItem(element);
			case 'info': return toInfoItem(element);
		}
	}

	getChildren(element?: ControllerNode): vscode.ProviderResult<ControllerNode[]> {
		if (!element) { return this.buildRoot(); }
		if (element.type === 'section') { return element.children; }
		if (element.type === 'info' && element.remotePath && element.controllerHost && isFtpFolderContext(element.contextValue)) {
			const key = JSON.stringify([element.controllerHost, element.remotePath]);
			let pending = this.ftpChildren.get(key);
			if (!pending) {
				pending = listRemoteDir(element.controllerHost, element.remotePath).then(entries =>
					ftpNodes(entries, element.remotePath!, element.controllerHost!, isFlashFtpContext(element.contextValue), true))
					.catch(error => { this.ftpChildren.delete(key); return [new InfoNode(`조회 실패: ${String(error)}`, 'error')]; });
				this.ftpChildren.set(key, pending);
			}
			return pending;
		}
		return [];
	}

	/** 명령 콘솔 연결 없이 FTP 목록만 표시한다. */
	async browseFtp(): Promise<void> {
		this.ftpBrowseOnly = true;
		await this.refreshFtp();
	}

	dispose(): void {
		this._debugModeSubscription?.dispose();
		this._debugModeSubscription = undefined;
		this.stopPolling();
		this._onDidChangeTreeData.dispose();
		this._onDidProbe.dispose();
		this._onDidThreadPause.dispose();
	}

	/**
	 * Show Break만 즉시 재조회해 브레이크포인트 섹션을 갱신한다.
	 * 수동 새로고침 버튼과 에디터 중단점 동기화 직후 즉시 반영용(전체 refresh보다 가볍다).
	 * 성공 시 파싱된 목록을, 미연결/실패 시 null을 돌려준다(pull 명령이 재사용).
	 */
	async refreshBreakpointsNow(): Promise<BreakpointInfo[] | null> {
		if (!this._connected) { return null; }
		const resp = await trySendCommand('Show Break');
		if (resp === null || !this._connected) { return null; }
		this.breakpoints = parseBreakList(resp);
		this._onDidChangeTreeData.fire(undefined);
		return this.breakpoints;
	}

	/** 정지 전이 판정은 threadPauseTransition 이 맡고, 여기서는 이벤트만 발화한다(한 폴 주기에 최대 1건). */
	private firePauseTransitions(previous: ThreadInfo[], next: ThreadInfo[]): void {
		const transition = detectPauseTransition(previous, next);
		if (transition) { this._onDidThreadPause.fire(transition); }
	}

	// ── Build tree ──────────────────────────────────────

	/** 섹션 순서의 정본은 treeSections 의 루트 빌더. 여기는 상태를 모아 넘기는 접착 계층이다. */
	private buildRoot(): SectionNode[] {
		const snapshot = this.statusSnapshot();
		const cfg = snapshot.config;
		const ftpCacheMatches = this.ftpCacheKey === ControllerTreeProvider.ftpCacheKeyFor(cfg.ip, cfg.ftpBasePath, cfg.ftpFlashProjectsPath);
		if (!this._connected) {
			return buildDisconnectedRoot(snapshot, this.ftpBrowseOnly, ftpCacheMatches);
		}
		return buildConnectedRoot({
			...snapshot,
			ftpCacheMatches,
			editorBreakpointTargets: editorBreakpointTargets(false, this.editorBreakpointTargetResolver),
			trafficOptions: getTrafficLogOptions(),
			connectionStats: getConnectionStats(),
			toResource: (dir: string) => vscode.Uri.file(dir),
		});
	}

	// ── Reports ─────────────────────────────────────────

	/** 보고서(snapshotMarkdown)가 읽는 평문 상태. `runtimeConsoleStatus` 를 주면 트리의 값 대신 쓴다. */
	private statusSnapshot(runtimeConsoleStatus?: RuntimeConsoleStatusSnapshot): ControllerStatusSnapshot {
		const cfg = getControllerConfig();
		return {
			connected: this._connected,
			config: cfg,
			expectedProjectName: this.expectedProjectName,
			expectedProjectFolderName: this.expectedProjectFolderName,
			threads: this.threads,
			breakpoints: this.breakpoints,
			errors: this.errors,
			ftpEntries: this.ftpEntries,
			ftpFlashEntries: this.ftpFlashEntries,
			ftpError: this.ftpError,
			ftpFlashError: this.ftpFlashError,
			lastFtpRefreshAt: this.lastFtpRefreshAt,
			sysInfo: this.sysInfo,
			lastSystemInfoRefreshAt: this.lastSystemInfoRefreshAt,
			runtimeConsoleStatus: runtimeConsoleStatus ?? this.runtimeConsoleStatus,
			runtimeErrorContext: this.runtimeErrorContext,
			compileStale: this.compileStale,
		};
	}

	/**
	 * 「전체 쓰레드 복사」가 클립보드에 넣는 보고서. 상황 스냅샷의 `## 쓰레드` 절과 같은 표를 쓴다
	 * (렌더러 정본: `controller/threads/threadReport`).
	 */
	buildThreadReportMarkdown(): string {
		const cfg = getControllerConfig();
		return renderThreadListReport({
			threads: this.threads,
			connected: this._connected,
			endpoint: `${cfg.ip}:${cfg.port}`,
			expectedProject: this.expectedProjectName,
			extensionVersion: EXTENSION_VERSION,
		});
	}

	buildSituationSnapshotMarkdown(extra?: {
		runtimeConsoleStatus?: RuntimeConsoleStatusSnapshot;
		deploySnapshot?: SituationDeploySnapshot;
	}): string {
		return renderSituationSnapshotMarkdown(this.statusSnapshot(extra?.runtimeConsoleStatus), { deploySnapshot: extra?.deploySnapshot });
	}

	buildDiagnosticSnapshotMarkdown(extra?: {
		runtimeConsoleStatus?: RuntimeConsoleStatusSnapshot;
		deploySnapshot?: SituationDeploySnapshot;
	}): string {
		return renderDiagnosticSnapshotMarkdown(this.statusSnapshot(extra?.runtimeConsoleStatus), { deploySnapshot: extra?.deploySnapshot });
	}
}
