/**
 * 제어기 상태 통합 TreeView — 연결 정보, 쓰레드, FTP 파일, 시스템 정보, 에러 로그를 사이드바에 표시.
 * 연결 후 주기적 폴링으로 실시간 상태를 갱신한다.
 */

import * as vscode from 'vscode';
import { trySendCommand, getControllerConfig } from '../controller/controllerConnection';
import {
	parseThreadList,
	ThreadInfo,
	parseErrorLog,
	parseBreakList,
	BreakpointInfo,
	classifyErrorEntry,
	extractErrorCodeFromEntry,
	getErrorCodeHint,
	findKnownErrorChains,
} from '../controller/responseParser';
import { FtpEntry, listRemoteDir } from '../controller/ftpClient';
import { onDebugThreadsUpdated } from '../controller/debugBridge';
import { RuntimeConsoleStatusSnapshot } from '../controller/runtimeConsole';

export interface SituationDeploySnapshot {
	mode: 'Build' | 'Deploy & Run';
	success: boolean;
	lastStage: 'STOP' | 'UPLOAD' | 'COMPILE' | 'START' | 'ERROR_CHECK' | 'SUCCESS';
	compileErrorCodes: number[];
	controllerSystemCodes: number[];
	updatedAt: number;
	summary: string;
	comparisonNote?: string;
	unverifiableReason?: string;
	compileRawSummary?: string[];
}

export interface RuntimeErrorContext {
	threadName: string;
	threadId?: number;
	lastCommand?: string;
	firstSeenAt?: string;
	statusText?: string;
	stackFrames?: string[];
	relatedFunctions?: string[];
}

// ── Node types ──────────────────────────────────────────

type ControllerNode = SectionNode | ThreadNode | InfoNode;

class SectionNode {
	readonly type = 'section' as const;
	children: ControllerNode[] = [];
	collapsed = false;
	constructor(
		public readonly id: string,
		public label: string,
		public iconId: string,
		public description?: string,
	) {}
}

class ThreadNode {
	readonly type = 'thread' as const;
	constructor(public readonly thread: ThreadInfo) {}
}

class InfoNode {
	readonly type = 'info' as const;
	constructor(
		public readonly label: string,
		public readonly iconId: string,
		public readonly description?: string,
		public readonly command?: vscode.Command,
		public readonly contextValue?: string,
		public readonly tooltip?: string,
		public readonly remotePath?: string,
		public readonly projectName?: string,
	) {}
}

// ── Provider ────────────────────────────────────────────

export class ControllerTreeProvider implements vscode.TreeDataProvider<ControllerNode>, vscode.Disposable {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<ControllerNode | undefined>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
	private _refreshInFlight = false;
	private _refreshAllInFlight = false;
	private _refreshFtpInFlight = false;
	private _refreshSystemInFlight = false;

	/** 연결 유실 감지 시 발생 (3회 연속 실패) */
	private readonly _onDidLoseConnection = new vscode.EventEmitter<void>();
	readonly onDidLoseConnection = this._onDidLoseConnection.event;

	private _connected = false;
	private threads: ThreadInfo[] = [];
	private errors: string[] = [];
	private ftpEntries: FtpEntry[] = [];
	private ftpError: string | null = null;
	private ftpFlashEntries: FtpEntry[] = [];
	private ftpFlashError: string | null = null;
	private sysInfo: { label: string; value: string; tooltip?: string; iconId?: string }[] = [];
	private pollTimer: ReturnType<typeof setTimeout> | null = null;
	private consecutiveFailures = 0;
	private lastDetailPollAt = 0;
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
	private runtimeErrorContext?: RuntimeErrorContext;

	/** 디버그 세션 중 bridge 이벤트 구독 핸들 */
	private _debugModeSubscription: vscode.Disposable | undefined;

	get isConnected(): boolean { return this._connected; }

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

	getExpectedProjectFolderName(): string {
		return this.expectedProjectFolderName;
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
	 */
	setConnected(connected: boolean): void {
		this._connected = connected;
		this.consecutiveFailures = 0;
		this.lastDetailPollAt = 0;
		if (connected) {
			this.refresh();
			this.refreshFtp();
			this.refreshSystemInfo();
			this.startPolling();
		} else {
			this.stopPolling();
			this.threads = [];
			this.errors = [];
			this.breakpoints = [];
			this.ftpEntries = [];
			this.ftpError = null;
			this.ftpFlashEntries = [];
			this.ftpFlashError = null;
			this.sysInfo = [];
			this._onDidChangeTreeData.fire(undefined);
		}
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
		const cfg = vscode.workspace.getConfiguration('gpl.controller');
		const baseInterval = cfg.get<number>('threadPollIntervalMs') ?? 5000;
		const interval = this.threads.length > 0 ? baseInterval : baseInterval * 3;
		this.pollTimer = setTimeout(async () => {
			this.pollTimer = null;
			await this.refresh();
			this.scheduleNextPoll();
		}, interval);
	}

	stopPolling(): void {
		if (this.pollTimer) {
			clearTimeout(this.pollTimer);
			this.pollTimer = null;
		}
	}

	/**
	 * 디버그 세션 시작 시 호출. 독립 폴링을 중단하고 debugBridge 이벤트를 구독하여
	 * 디버그 세션의 Show Thread 결과로 쓰레드 섹션을 실시간 갱신한다.
	 * TCP 추가 호출 없이 사이드바 쓰레드 뷰가 살아 있게 된다.
	 */
	enterDebugMode(): void {
		this.stopPolling();
		this._debugModeSubscription?.dispose();
		this._debugModeSubscription = onDebugThreadsUpdated(threads => {
			this.threads = threads;
			this._onDidChangeTreeData.fire(undefined);
		});
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
		if (this._refreshInFlight) { return; }
		this._refreshInFlight = true;
		try {

		// 경량 주기 폴링: 기본은 Show Thread만, 상세(Error/Break)는 적응형으로 조회
		const threadResp = await trySendCommand('Show Thread');

		// 연결 유실 감지: 핵심 상태(Show Thread) 3회 연속 실패 시 자동 해제
		if (threadResp === null) {
			this.consecutiveFailures++;
			if (this.consecutiveFailures >= 3) {
				this._connected = false;
				this.stopPolling();
				this.threads = [];
				this.errors = [];
				this.breakpoints = [];
				this.ftpEntries = [];
				this.ftpError = null;
				this.ftpFlashEntries = [];
				this.ftpFlashError = null;
				this.sysInfo = [];
				this._onDidChangeTreeData.fire(undefined);
				this._onDidLoseConnection.fire();
				return;
			}
		} else {
			this.consecutiveFailures = 0;
			this.threads = parseThreadList(threadResp);
		}

		const now = Date.now();
		const cfg = vscode.workspace.getConfiguration('gpl.controller');
		const baseInterval = cfg.get<number>('threadPollIntervalMs') ?? 5000;
		const detailPollIntervalMs = Math.max(baseInterval * 2, 5000);
		const shouldPollDetailsByState = this.threads.some(
			t => t.state === 'Error' || t.state === 'Break' || t.state === 'Paused',
		);
		const shouldPollDetails =
			forceDetails ||
			shouldPollDetailsByState ||
			(now - this.lastDetailPollAt >= detailPollIntervalMs);

		if (shouldPollDetails) {
			const errorResp = await trySendCommand('ErrorLog');
			const breakResp = await trySendCommand('Show Break');
			if (errorResp !== null) {
				this.errors = parseErrorLog(errorResp);
			}
			if (breakResp !== null) {
				this.breakpoints = parseBreakList(breakResp);
			}
			this.lastDetailPollAt = now;
		}

		this._onDidChangeTreeData.fire(undefined);
		} finally {
			this._refreshInFlight = false;
		}
	}

	/**
	 * FTP /GPL 디렉터리 목록 갱신 (수동).
	 */
	async refreshFtp(): Promise<void> {
		if (!this._connected) { return; }
		if (this._refreshFtpInFlight) { return; }
		this._refreshFtpInFlight = true;
		try {
		const cfg = getControllerConfig();
		try {
			this.ftpEntries = await listRemoteDir(cfg.ip, cfg.ftpBasePath);
			this.ftpError = null;
		} catch (err: any) {
			this.ftpEntries = [];
			this.ftpError = err.message ?? String(err);
		}

		try {
			this.ftpFlashEntries = await listRemoteDir(cfg.ip, cfg.ftpFlashProjectsPath);
			this.ftpFlashError = null;
		} catch (err: any) {
			this.ftpFlashEntries = [];
			this.ftpFlashError = err.message ?? String(err);
		}
		this._onDidChangeTreeData.fire(undefined);
		} finally {
			this._refreshFtpInFlight = false;
		}
	}

	/**
	 * 시스템 정보 갱신 (수동).
	 */
	async refreshSystemInfo(): Promise<void> {
		if (!this._connected) { return; }
		if (this._refreshSystemInFlight) { return; }
		this._refreshSystemInFlight = true;
		try {
		const items: { label: string; value: string; tooltip?: string; iconId?: string }[] = [];

		// TCP 직렬화
		const memResp = await trySendCommand('Show Memory');
		const flashResp = await trySendCommand('Show Flash Free');
		const cpuResp = await trySendCommand('Show CPU Profile');

		const memRaw = memResp ? this.extractRaw(memResp) : '';
		const flashRaw = flashResp ? this.extractRaw(flashResp) : '';
		const cpuRaw = cpuResp ? this.extractRaw(cpuResp) : '';

		if (memRaw) {
			items.push({ label: '메모리', value: this.formatMemory(memRaw), tooltip: memRaw, iconId: 'database' });
		}
		if (flashRaw) {
			items.push({ label: '플래시', value: this.formatFlash(flashRaw), tooltip: flashRaw, iconId: 'save-all' });
		}
		items.push({
			label: 'CPU',
			value: cpuRaw ? this.formatCpu(cpuRaw) : '데이터 없음',
			tooltip: cpuRaw || 'Show CPU Profile 응답 없음',
			iconId: 'pulse',
		});

		this.sysInfo = items;
		this._onDidChangeTreeData.fire(undefined);
		} finally {
			this._refreshSystemInFlight = false;
		}
	}

	/** 응답에서 <DATA> 또는 본문 추출 (원시 텍스트) */
	private extractRaw(resp: string): string {
		const dataMatch = resp.match(/<DATA>([\s\S]*?)<\/DATA>/);
		if (dataMatch) {
			return dataMatch[1].trim();
		}
		return resp.replace(/<\/?STATUS[^>]*>.*?<\/STATUS>/gs, '').trim();
	}

	/** 메모리: "Free: X.XX MB" 핵심 지표만 */
	private formatMemory(raw: string): string {
		const freeMatch = raw.match(/Free[:\s]+(\d[\d.]*\s*\w+)/i);
		if (freeMatch) { return `Free: ${freeMatch[1]}`; }
		return raw.split(/\r?\n/)[0]?.trim() || raw;
	}

	/** 플래시: "타입, 크기 · Free: X" */
	private formatFlash(raw: string): string {
		const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
		const typeLine = lines[0] || '';
		const freeMatch = raw.match(/Free[:\s]+(\d[\d.]*\s*\w+)/i);
		if (freeMatch && typeLine) {
			// 타입라인이 Free 정보를 이미 포함하면 그대로
			if (/free/i.test(typeLine)) { return typeLine; }
			return `${typeLine} · Free: ${freeMatch[1]}`;
		}
		return typeLine || raw;
	}

	/** CPU: 퍼센트 또는 첫 줄 */
	private formatCpu(raw: string): string {
		const pctMatch = raw.match(/(\d[\d.]*)\s*%/);
		if (pctMatch) { return `${pctMatch[1]}%`; }
		return raw.split(/\r?\n/)[0]?.trim() || raw;
	}

	// ── TreeDataProvider ────────────────────────────────

	getTreeItem(element: ControllerNode): vscode.TreeItem {
		switch (element.type) {
			case 'section': return this.toSectionItem(element);
			case 'thread': return this.toThreadItem(element);
			case 'info': return this.toInfoItem(element);
		}
	}

	getChildren(element?: ControllerNode): ControllerNode[] {
		if (!element) { return this.buildRoot(); }
		if (element.type === 'section') { return element.children; }
		return [];
	}

	dispose(): void {
		this._debugModeSubscription?.dispose();
		this._debugModeSubscription = undefined;
		this.stopPolling();
		this._onDidChangeTreeData.dispose();
		this._onDidLoseConnection.dispose();
	}

	// ── Build tree ──────────────────────────────────────

	private buildRoot(): SectionNode[] {
		if (!this._connected) {
			const sec = new SectionNode('disconnected', '연결되지 않음', 'debug-disconnect');
			sec.children = [
				new InfoNode('제어기에 연결하기', 'plug', '클릭하여 연결', {
					command: 'gpl.controller.connect',
					title: 'Connect to Controller',
				}),
			];
			return [sec];
		}

		const cfg = getControllerConfig();
		const sections: SectionNode[] = [];

		if (this.runtimeErrorContext) {
			const errCtx = this.runtimeErrorContext;
			const threadLabel = errCtx.threadId !== undefined
				? `${errCtx.threadName} (#${errCtx.threadId})`
				: errCtx.threadName;
			const runtimeErrSec = new SectionNode(
				'runtimeErrorContext',
				'런타임 오류 컨텍스트',
				'error',
				errCtx.statusText || '최근 오류',
			);
			runtimeErrSec.collapsed = false;
			runtimeErrSec.children = [
				new InfoNode(`오류 스레드: ${threadLabel}`, 'debug-stop', errCtx.statusText || undefined),
				new InfoNode(`직전 명령: ${errCtx.lastCommand || '(없음)'}`, 'terminal', undefined),
				new InfoNode(`최초 발생 시각: ${errCtx.firstSeenAt || '(미확인)'}`, 'history', undefined),
				...(errCtx.stackFrames && errCtx.stackFrames.length > 0
					? errCtx.stackFrames.map((frame, idx) => new InfoNode(`프레임 ${idx + 1}: ${frame}`, 'list-tree'))
					: [new InfoNode('스택 프레임 정보 없음', 'info')]),
			];
			sections.push(runtimeErrSec);
		}

		// ── 프로젝트 컨텍스트 (불일치 가시화)
		const runningProjects = [...new Set(
			this.threads.map(t => (t.project || '').trim()).filter(Boolean),
		)];
		const ftpDirs = [
			...this.ftpEntries.filter(e => e.isDirectory).map(e => e.name),
			...this.ftpFlashEntries.filter(e => e.isDirectory).map(e => e.name),
		];
		const expected = this.expectedProjectName;
		const expectedFolder = this.expectedProjectFolderName || expected;
		const hasExpectedRunning = expected
			? runningProjects.some(p => p.toLowerCase() === expected.toLowerCase())
			: false;
		const hasExpectedFtp = expectedFolder
			? ftpDirs.some(p => p.toLowerCase() === expectedFolder.toLowerCase())
			: false;
		const hasUnexpectedRunning = !!expected && runningProjects.length > 0 && !hasExpectedRunning;
		const missingExpectedFtp = !!expectedFolder && !hasExpectedFtp;
		const buildOnlyReady = !!expected && hasExpectedFtp && runningProjects.length === 0;
		const mismatch = missingExpectedFtp || hasUnexpectedRunning;
		const contextDescription = mismatch
			? '불일치 감지'
			: buildOnlyReady
				? '빌드 전용 상태'
				: '정상';

		const ctxSec = new SectionNode(
			'projectContext',
			mismatch ? '프로젝트 상태 ⚠' : '프로젝트 상태',
			mismatch ? 'warning' : 'pass',
			contextDescription,
		);
		ctxSec.collapsed = true;
		const runSummary = runningProjects.length > 0 ? runningProjects.join(', ') : '(없음)';
		ctxSec.children = [
			new InfoNode(`기대: ${expected || '(미설정)'} / 실행: ${runSummary}`, 'target',
				hasUnexpectedRunning
					? `${expected} 대신 다른 프로젝트가 실행 중`
					: buildOnlyReady
						? 'Build Only 후 미실행 상태일 수 있음'
						: hasExpectedRunning || !expected
							? undefined
							: `${expected} 미실행`),
			new InfoNode(`FTP: ${expectedFolder || '(미설정)'} / 현재: ${ftpDirs.length > 0 ? ftpDirs.join(', ') : '(없음)'}`, 'folder-library',
				hasExpectedFtp || !expectedFolder ? undefined : `${expectedFolder} 폴더 없음`),
		];
		sections.push(ctxSec);

		// ── 연결 정보 (간소화)
		const conn = new SectionNode('connection', cfg.ip, 'plug', '연결됨');
		conn.collapsed = false;
		conn.children = [
			new InfoNode(`1402 명령 포트: ${cfg.port}`, 'server', undefined, {
				command: 'gpl.controller.pingPort',
				title: '포트 통신 테스트',
				arguments: ['command', cfg.ip, cfg.port],
			}),
			new InfoNode(
				'1403 콘솔',
				getRuntimeConsoleTreeIcon(this.runtimeConsoleStatus),
				buildRuntimeConsoleTreeDescription(this.runtimeConsoleStatus),
				{
					command: 'gpl.console.ensure',
					title: '1403 연결/재연결/로그 보기',
				},
				'runtimeConsoleItem',
				buildRuntimeConsoleTreeTooltip(this.runtimeConsoleStatus, cfg.ip, cfg.consolePort),
			),
		];
		sections.push(conn);

		// ── 쓰레드
		const running = this.threads.filter(t => t.state === 'Running').length;
		const paused = this.threads.filter(t => t.state === 'Paused' || t.state === 'Break').length;
		const idle = this.threads.filter(t => t.state === 'Idle').length;
		const errCount = this.threads.filter(t => t.state === 'Error').length;

		let threadDesc: string;
		if (this.threads.length === 0) {
			threadDesc = '없음';
		} else {
			const parts: string[] = [];
			if (running > 0) { parts.push(`실행 ${running}`); }
			if (paused > 0) { parts.push(`일시정지 ${paused}`); }
			if (idle > 0) { parts.push(`대기 ${idle}`); }
			if (errCount > 0) { parts.push(`에러 ${errCount}`); }
			threadDesc = parts.join(' · ') || '모두 정지';
		}

		const threadSec = new SectionNode('threads',
			`쓰레드 (${this.threads.length})`, 'symbol-event', threadDesc);
		threadSec.collapsed = true;
		threadSec.children = this.threads.length > 0
			? this.threads.map(t => new ThreadNode(t))
			: [new InfoNode('쓰레드 없음', 'info')];
		sections.push(threadSec);

		// ── 브레이크포인트
		if (this.breakpoints.length > 0) {
			const bpSec = new SectionNode('breakpoints',
				`브레이크포인트 (${this.breakpoints.length})`, 'debug-breakpoint',
				`${this.breakpoints.reduce((s, b) => s + b.hitCount, 0)} hits`);
			bpSec.children = this.breakpoints.map(bp => {
				const loc = `${bp.file}:${bp.fileLine}`;
				const desc = bp.hitCount > 0 ? `${bp.proc} · ${bp.hitCount} hits` : bp.proc;
				return new InfoNode(loc, 'debug-breakpoint-data', desc, undefined, 'breakpointItem');
			});
			sections.push(bpSec);
		}

		// ── FTP 파일 (/GPL)
		const ftpSec = new SectionNode('ftp',
			`FTP 파일 (${cfg.ftpBasePath})`, 'folder-library',
			this.ftpError ? '조회 실패' : `${this.ftpEntries.length}개`);
		if (this.ftpError) {
			ftpSec.children = [new InfoNode(this.ftpError, 'error')];
		} else if (this.ftpEntries.length === 0) {
			ftpSec.children = [new InfoNode('파일 없음', 'info')];
		} else {
			ftpSec.children = this.ftpEntries.map(e => {
				const icon = e.isDirectory ? 'folder' : 'file';
				const parts: string[] = [];
				if (!e.isDirectory) { parts.push(formatSize(e.size)); }
				if (e.modifiedAt) { parts.push(formatDate(e.modifiedAt)); }
				const desc = parts.join(' · ');
				const ctx = e.isDirectory ? 'ftpFolder' : 'ftpFile';
				const remotePath = `${cfg.ftpBasePath}/${e.name}`;
				return new InfoNode(e.name, icon, desc, undefined, ctx, undefined, remotePath, e.name);
			});
		}
		sections.push(ftpSec);

		// ── Flash Projects (/flash/projects)
		const flashSec = new SectionNode('ftpFlash',
			`Flash Projects (${cfg.ftpFlashProjectsPath})`, 'archive',
			this.ftpFlashError ? '조회 실패' : `${this.ftpFlashEntries.length}개`);
		if (this.ftpFlashError) {
			flashSec.children = [new InfoNode(this.ftpFlashError, 'error')];
		} else if (this.ftpFlashEntries.length === 0) {
			flashSec.children = [new InfoNode('파일 없음', 'info')];
		} else {
			flashSec.children = this.ftpFlashEntries.map(e => {
				const icon = e.isDirectory ? 'folder' : 'file';
				const parts: string[] = [];
				if (!e.isDirectory) { parts.push(formatSize(e.size)); }
				if (e.modifiedAt) { parts.push(formatDate(e.modifiedAt)); }
				const desc = parts.join(' · ');
				const ctx = e.isDirectory ? 'ftpFlashFolder' : 'ftpFlashFile';
				const remotePath = `${cfg.ftpFlashProjectsPath}/${e.name}`;
				return new InfoNode(e.name, icon, desc, undefined, ctx, undefined, remotePath, e.name);
			});
		}
		sections.push(flashSec);

		// ── 시스템 정보
		const sysSec = new SectionNode('system', '시스템 정보', 'dashboard',
			this.sysInfo.length > 0 ? undefined : '조회 안됨');
		sysSec.collapsed = true;
		if (this.sysInfo.length === 0) {
			sysSec.children = [
				new InfoNode('새로고침으로 조회하세요', 'info', undefined, {
					command: 'gpl.controller.refreshSystemInfo',
					title: '시스템 정보 새로고침',
				}),
			];
		} else {
			sysSec.children = this.sysInfo.map(s =>
				new InfoNode(s.label, s.iconId || 'info', s.value, undefined, undefined, s.tooltip));
		}
		sections.push(sysSec);

		// ── 에러 로그: 코드 오류 / 환경 경고 분리 뷰
		const classifiedEntries = this.errors.map(raw => {
			const classified = classifyErrorEntry(raw);
			const code = extractErrorCodeFromEntry(raw) ?? classified.parsedCode;
			const hint = typeof code === 'number' ? getErrorCodeHint(code) : undefined;
			const isEnvironment = classified.isControllerSystem || hint?.category === 'environment';
			return { raw, classified, code, hint, isEnvironment };
		});
		const envErrors = classifiedEntries.filter(e => e.isEnvironment);
		const codeErrors = classifiedEntries.filter(e => !e.isEnvironment);
		const errorThreads = this.threads.filter(t => t.state === 'Error');
		const chainHints = findKnownErrorChains(
			classifiedEntries
				.map(e => e.code)
				.filter((code): code is number => typeof code === 'number'),
		);

		const codeSec = new SectionNode(
			'errorsCode',
			`코드 오류 (${codeErrors.length + errorThreads.length})`,
			codeErrors.length > 0 || errorThreads.length > 0 ? 'error' : 'pass',
			errorThreads.length > 0 ? `Thread Error ${errorThreads.length}` : (codeErrors.length > 0 ? '확인 필요' : '정상'),
		);
		const codeChildren: ControllerNode[] = [];

		for (const et of errorThreads) {
			codeChildren.push(new InfoNode(
				`🔴 ${et.name}`,
				'debug-stop',
				`${et.file}  [${et.lastStatus}]`,
				undefined,
				'errorThread',
				`${et.name}: ${et.file} - ${et.lastStatus}`,
			));
		}

		for (const e of codeErrors) {
			const codeLabel = typeof e.code === 'number' ? `${e.code}` : 'N/A';
			const hintDesc = e.hint
				? `${e.hint.title} — ${e.hint.action}`
				: (e.classified.detail ?? '클릭: 클립보드에 복사');
			const line = typeof e.code === 'number'
				? `[${codeLabel}] ${e.classified.summary}`
				: e.classified.summary;
			codeChildren.push(new InfoNode(
				line,
				'error',
				hintDesc,
				{
					command: 'gpl.controller.showErrorDetail',
					title: '오류 상세 보기',
					arguments: [{ raw: e.raw, code: e.code, category: 'code' }],
				},
				'errorItem',
				e.hint
					? `${line}\n해석: ${e.hint.meaning}\n권장 조치: ${e.hint.action}`
					: line,
			));
		}

		if (chainHints.length > 0) {
			const chainSec = new SectionNode('errorChains', `에러 체인 (${chainHints.length})`, 'git-commit', '연쇄 오류');
			chainSec.collapsed = true;
			chainSec.children = chainHints.map(chain => new InfoNode(
				`추정 체인: ${chain}`,
				'git-commit',
				'연속 에러 패턴 감지',
				undefined,
				'errorChainItem',
				`추정 원인 체인: ${chain}`,
			));
			codeChildren.push(chainSec);
		}

		if (codeChildren.length === 0) {
			codeChildren.push(new InfoNode('활성 코드 오류 없음', 'pass'));
		}
		codeSec.children = codeChildren;
		sections.push(codeSec);

		const envSec = new SectionNode(
			'errorsEnv',
			`환경 경고 (${envErrors.length})`,
			envErrors.length > 0 ? 'warning' : 'pass',
			envErrors.length > 0 ? '코드와 분리 진단 권장' : '정상',
		);
		const envChildren: InfoNode[] = [];
		for (const e of envErrors) {
			const prefix = typeof e.code === 'number' ? `[${e.code}] ` : '';
			envChildren.push(new InfoNode(
				`${prefix}${e.classified.summary}`,
				'warning',
				e.hint
					? `${e.hint.title} — ${e.hint.action}`
					: (e.classified.detail ?? '제어기 시스템/환경 경고'),
				{
					command: 'gpl.controller.showErrorDetail',
					title: '오류 상세 보기',
					arguments: [{ raw: e.raw, code: e.code, category: 'environment' }],
				},
				'sysErrorItem',
				e.hint
					? `${e.classified.summary}\n해석: ${e.hint.meaning}\n권장 조치: ${e.hint.action}`
					: `[제어기 시스템] ${e.classified.summary}\n${e.classified.detail ?? ''}`,
			));
		}
		if (envChildren.length === 0) {
			envChildren.push(new InfoNode('활성 환경 경고 없음', 'pass'));
		}
		envSec.children = envChildren;
		sections.push(envSec);

		return sections;
	}

	buildSituationSnapshotMarkdown(extra?: {
		runtimeConsoleStatus?: RuntimeConsoleStatusSnapshot;
		deploySnapshot?: SituationDeploySnapshot;
	}): string {
		const cfg = getControllerConfig();
		const running = this.threads.filter(t => t.state === 'Running').length;
		const paused = this.threads.filter(t => t.state === 'Paused' || t.state === 'Break').length;
		const idle = this.threads.filter(t => t.state === 'Idle').length;
		const errCount = this.threads.filter(t => t.state === 'Error').length;

		const expected = this.expectedProjectName || '(미설정)';
		const expectedFolder = this.expectedProjectFolderName || this.expectedProjectName || '(미설정)';
		const runningProjects = [...new Set(this.threads.map(t => t.project).filter(Boolean))];
		const ftpDirs = [
			...this.ftpEntries.filter(e => e.isDirectory).map(e => e.name),
			...this.ftpFlashEntries.filter(e => e.isDirectory).map(e => e.name),
		];

		const lines: string[] = [];
		lines.push('# GPL Controller 상황 스냅샷');
		lines.push('');

		// ── 연결 상태
		const consoleStatus = extra?.runtimeConsoleStatus ?? this.runtimeConsoleStatus;
		lines.push('## 연결');
		lines.push(`- 명령 포트: ${this._connected ? `Connected (${cfg.ip}:${cfg.port})` : 'Disconnected'}`);
		lines.push(`- 콘솔 포트: ${formatRuntimeConsoleStatusLabel(consoleStatus)} (${cfg.ip}:${cfg.consolePort})`);
		lines.push(`- 콘솔 상세: ${formatRuntimeConsoleStatusDetail(consoleStatus)}`);
		if (consoleStatus.lastPayloadAt) {
			lines.push(`- 마지막 payload: ${formatDateTimeFromTs(consoleStatus.lastPayloadAt)} (${consoleStatus.lastPayloadBytes ?? 0} bytes)`);
		}
		lines.push(`- 시각: ${new Date().toLocaleString('ko-KR')}`);
		lines.push('');

		// ── 최근 배포 결과
		lines.push('## 최근 배포 결과');
		if (!extra?.deploySnapshot) {
			lines.push('- 최근 배포 기록 없음');
		} else {
			const d = extra.deploySnapshot;
			lines.push(`- 결과: ${d.success ? '성공' : '실패'}`);
			lines.push(`- 모드: ${d.mode}`);
			lines.push(`- 마지막 단계: ${d.lastStage}`);
			lines.push(`- 컴파일 에러 코드: ${d.compileErrorCodes.length > 0 ? d.compileErrorCodes.join(', ') : '(없음)'}`);
			lines.push(`- 제어기 시스템 코드: ${d.controllerSystemCodes.length > 0 ? d.controllerSystemCodes.join(', ') : '(없음)'}`);
			lines.push(`- 요약: ${d.summary}`);
			lines.push(`- 기록 시각: ${new Date(d.updatedAt).toLocaleString('ko-KR')}`);
		}
		lines.push('');

		// ── 프로젝트 컨텍스트
		const hasExpectedRunning = expected !== '(미설정)' && runningProjects.some(p => p.toLowerCase() === expected.toLowerCase());
		const hasExpectedFtp = expectedFolder !== '(미설정)' && ftpDirs.some(p => p.toLowerCase() === expectedFolder.toLowerCase());
		const hasUnexpectedRunning = expected !== '(미설정)' && runningProjects.length > 0 && !hasExpectedRunning;
		const mismatch = (expectedFolder !== '(미설정)' && !hasExpectedFtp) || hasUnexpectedRunning;

		lines.push('## 프로젝트 컨텍스트');
		lines.push(`- 기대 프로젝트: ${expected}${mismatch ? ' ⚠ 불일치' : ''}`);
		lines.push(`- 기대 FTP 폴더: ${expectedFolder}`);
		lines.push(`- 실행 프로젝트: ${runningProjects.length > 0 ? runningProjects.join(', ') : '(없음)'}${hasUnexpectedRunning ? ' ⚠ 다른 프로젝트 실행 중' : expected !== '(미설정)' && !hasExpectedRunning && hasExpectedFtp ? ' (Build Only 가능)' : expected !== '(미설정)' && !hasExpectedRunning ? ' ⚠ 기대 프로젝트 미실행' : ''}`);
		lines.push(`- FTP 프로젝트 폴더: ${ftpDirs.length > 0 ? ftpDirs.join(', ') : '(없음)'}${expectedFolder !== '(미설정)' && !hasExpectedFtp ? ' ⚠ 기대 프로젝트 폴더 없음' : ''}`);
		lines.push('');

		// ── 쓰레드
		lines.push('## 쓰레드');
		lines.push(`- 전체 ${this.threads.length}: Running ${running}, Paused ${paused}, Idle ${idle}, Error ${errCount}`);
		if (this.threads.length > 0) {
			lines.push('');
			lines.push('| 이름 | 상태 | 프로젝트 | 파일 |');
			lines.push('|------|------|----------|------|');
			for (const t of this.threads) {
				lines.push(`| ${t.name} | ${t.state} | ${t.project || '-'} | ${t.file || '-'} |`);
			}
		}
		lines.push('');

		// ── 브레이크포인트
		lines.push('## 브레이크포인트');
		if (this.breakpoints.length === 0) {
			lines.push('- 없음');
		} else {
			lines.push('');
			lines.push('| 파일:줄 | 프로시저 | hit 횟수 |');
			lines.push('|---------|----------|----------|');
			for (const b of this.breakpoints) {
				lines.push(`| ${b.file}:${b.fileLine} | ${b.proc} | ${b.hitCount} |`);
			}
		}
		lines.push('');

		// ── FTP 파일 상세
		lines.push('## FTP 파일');
		if (this.ftpEntries.length === 0) {
			lines.push('- 파일 없음');
		} else {
			lines.push('');
			lines.push('| 이름 | 유형 | 크기 | 수정일 |');
			lines.push('|------|------|------|--------|');
			for (const e of this.ftpEntries) {
				const type = e.isDirectory ? '폴더' : '파일';
				const size = e.isDirectory ? '-' : formatSize(e.size);
				const date = e.modifiedAt ? formatDate(e.modifiedAt) : '-';
				lines.push(`| ${e.name} | ${type} | ${size} | ${date} |`);
			}
		}
		if (this.ftpError) {
			lines.push(`- ⚠ FTP 조회 실패: ${this.ftpError}`);
		}
		lines.push('');

		// ── 시스템 정보
		lines.push('## 시스템 정보');
		if (this.sysInfo.length === 0) {
			lines.push('- 조회 안됨');
		} else {
			for (const s of this.sysInfo) {
				lines.push(`- ${s.label}: ${s.value}`);
			}
		}
		lines.push('');

		// ── 에러 로그
		lines.push('## 에러 로그');
		if (this.errors.length === 0) {
			lines.push('- 활성 에러 없음');
		} else {
			for (const e of this.errors) {
				lines.push(`- ${e}`);
			}
		}

		if (this.runtimeErrorContext) {
			lines.push('');
			lines.push('## 오류 스레드 상세');
			const ctx = this.runtimeErrorContext;
			lines.push(`- 스레드: ${ctx.threadId !== undefined ? `${ctx.threadName} (#${ctx.threadId})` : ctx.threadName}`);
			lines.push(`- 상태: ${ctx.statusText || '(미상)'}`);
			lines.push(`- 직전 실행 명령: ${ctx.lastCommand || '(미상)'}`);
			lines.push(`- 최초 발생 시각: ${ctx.firstSeenAt || '(미상)'}`);
			if (ctx.stackFrames && ctx.stackFrames.length > 0) {
				lines.push('- 스택:');
				for (const frame of ctx.stackFrames) {
					lines.push(`  - ${frame}`);
				}
			}
			if (ctx.relatedFunctions && ctx.relatedFunctions.length > 0) {
				lines.push(`- 관련 함수: ${ctx.relatedFunctions.join(', ')}`);
			}
		}

		return lines.join('\n');
	}

	buildDiagnosticSnapshotMarkdown(extra?: {
		runtimeConsoleStatus?: RuntimeConsoleStatusSnapshot;
		deploySnapshot?: SituationDeploySnapshot;
	}): string {
		const cfg = getControllerConfig();
		const runtime = extra?.runtimeConsoleStatus ?? this.runtimeConsoleStatus;
		const deploy = extra?.deploySnapshot;

		const codes = this.errors
			.map(e => extractErrorCodeFromEntry(e))
			.filter((code): code is number => typeof code === 'number');
		const codeCounts = new Map<number, number>();
		for (const code of codes) {
			codeCounts.set(code, (codeCounts.get(code) ?? 0) + 1);
		}
		const topCodes = [...codeCounts.entries()]
			.sort((a, b) => b[1] - a[1])
			.slice(0, 5);
		const chains = findKnownErrorChains(codes);

		const stageMap: Record<string, 'OK' | 'FAIL' | 'SKIP' | 'N/A'> = {
			STOPPING: 'N/A',
			UPLOADING: 'N/A',
			COMPILE: 'N/A',
			RUNNING: 'N/A',
		};
		if (deploy) {
			if (deploy.success) {
				stageMap.STOPPING = 'OK';
				stageMap.UPLOADING = 'OK';
				stageMap.COMPILE = 'OK';
				stageMap.RUNNING = deploy.mode === 'Build' ? 'SKIP' : 'OK';
			} else {
				stageMap.STOPPING = deploy.lastStage === 'STOP' ? 'FAIL' : 'OK';
				stageMap.UPLOADING = deploy.lastStage === 'UPLOAD' ? 'FAIL' : (deploy.lastStage === 'STOP' ? 'N/A' : 'OK');
				stageMap.COMPILE = deploy.lastStage === 'COMPILE' ? 'FAIL' : ((deploy.lastStage === 'START' || deploy.lastStage === 'ERROR_CHECK') ? 'OK' : 'N/A');
				stageMap.RUNNING = deploy.mode === 'Build'
					? 'SKIP'
					: (deploy.lastStage === 'START' ? 'FAIL' : ((deploy.lastStage === 'ERROR_CHECK' || deploy.lastStage === 'SUCCESS') ? 'OK' : 'N/A'));
			}
		}

		const envErrors = this.errors.filter(e => classifyErrorEntry(e).isControllerSystem).length;
		const codeErrors = this.errors.length - envErrors;
		const threadErrors = this.threads.filter(t => t.state === 'Error').length;
		const runtimeReason = runtime.reason || '미연결';
		const runtimeUnstable = isRuntimeConsoleUnstable(runtime);

		let verdict: '정상' | '간헐' | '실패' = '정상';
		let verdictReason = '이상 징후 없음';
		if (!this._connected) {
			verdict = '실패';
			verdictReason = '1402 미연결';
		} else if (codeErrors > 0 || threadErrors > 0) {
			verdict = '실패';
			verdictReason = `코드 오류 ${codeErrors}건 / Error thread ${threadErrors}건`;
		} else if (runtimeUnstable) {
			verdict = '간헐';
			verdictReason = `1403 불안정 (${runtimeReason}${runtime.detail ? `, ${runtime.detail}` : ''})`;
		} else if (envErrors > 0) {
			verdict = '간헐';
			verdictReason = `환경 경고 ${envErrors}건`; 
		}

		const lines: string[] = [];
		lines.push('# GPL 원클릭 진단 스냅샷');
		lines.push('');
		lines.push(`- 생성 시각: ${new Date().toLocaleString('ko-KR')}`);
		lines.push(`- 1402 상태: ${this._connected ? `Connected (${cfg.ip}:${cfg.port})` : 'Disconnected'}`);
		lines.push(`- 1403 상태: ${formatRuntimeConsoleStatusLabel(runtime)} (${cfg.ip}:${cfg.consolePort})`);
		lines.push(`- 1403 상세: ${formatRuntimeConsoleStatusDetail(runtime)}`);
		lines.push('');

		lines.push('## 1403 관찰 증거');
		lines.push(`- 마지막 상태 변경: ${formatDateTimeFromTs(runtime.lastChangedAt)}`);
		lines.push(`- noPayloadStreak: ${runtime.noPayloadStreak}`);
		lines.push(`- pollEmptyStreak: ${runtime.immediateEofStreak}`);
		if (runtime.lastConnectAt) {
			lines.push(`- 마지막 연결 시도: ${formatDateTimeFromTs(runtime.lastConnectAt)}`);
		}
		if (runtime.lastPayloadAt) {
			lines.push(`- 마지막 payload: ${formatDateTimeFromTs(runtime.lastPayloadAt)} (${runtime.lastPayloadBytes ?? 0} bytes)`);
		} else {
			lines.push('- 마지막 payload: 없음');
		}
		if (runtime.lastErrorCode) {
			lines.push(`- 마지막 소켓 오류 코드: ${runtime.lastErrorCode}`);
		}
		if (runtime.reconnectDelayMs) {
			lines.push(`- ${runtime.immediateEofStreak > 0 ? '폴링 대기' : '재연결 대기'}: ${runtime.reconnectDelayMs}ms${runtime.reconnectAttempt ? ` (attempt ${runtime.reconnectAttempt})` : ''}`);
		}
		const runtimeHypothesis = getRuntimeConsoleHypothesis(runtime);
		if (runtimeHypothesis) {
			lines.push(`- 가설: ${runtimeHypothesis}`);
		}
		lines.push('');

		lines.push('## Deploy 단계 판정');
		lines.push(`- STOPPING: ${stageMap.STOPPING}`);
		lines.push(`- UPLOADING: ${stageMap.UPLOADING}`);
		lines.push(`- COMPILE: ${stageMap.COMPILE}`);
		lines.push(`- RUNNING: ${stageMap.RUNNING}`);
		if (deploy) {
			lines.push(`- 최근 배포 요약: ${deploy.summary}`);
			if (deploy.unverifiableReason) {
				lines.push(`- 검증 상태: 코드 수정 효과 검증 불가 (${deploy.unverifiableReason})`);
			}
			if (deploy.comparisonNote) {
				lines.push(`- 비교 판정: ${deploy.comparisonNote}`);
			}
		}
		lines.push('');

		if (deploy?.compileRawSummary && deploy.compileRawSummary.length > 0) {
			lines.push('## COMPILE 원문 로그 요약');
			for (const raw of deploy.compileRawSummary) {
				lines.push(`- ${raw}`);
			}
			lines.push('');
		}

		if (this.runtimeErrorContext) {
			const errCtx = this.runtimeErrorContext;
			lines.push('## Error Thread 상세');
			lines.push(`- 스레드: ${errCtx.threadId !== undefined ? `${errCtx.threadName} (#${errCtx.threadId})` : errCtx.threadName}`);
			lines.push(`- 상태: ${errCtx.statusText || '(미상)'}`);
			lines.push(`- 직전 실행 명령: ${errCtx.lastCommand || '(미상)'}`);
			lines.push(`- 최초 발생 시각: ${errCtx.firstSeenAt || '(미상)'}`);
			if (errCtx.stackFrames && errCtx.stackFrames.length > 0) {
				for (const frame of errCtx.stackFrames) {
					lines.push(`- 프레임: ${frame}`);
				}
			}
			if (errCtx.relatedFunctions && errCtx.relatedFunctions.length > 0) {
				lines.push(`- 관련 함수: ${errCtx.relatedFunctions.join(', ')}`);
			}
			lines.push('');
		}

		lines.push('## 최근 에러 코드 Top N');
		if (topCodes.length === 0) {
			lines.push('- 없음');
		} else {
			for (const [code, count] of topCodes) {
				const hint = getErrorCodeHint(code);
				const meaning = hint ? `${hint.title} — ${hint.meaning}` : '해석 없음';
				lines.push(`- ${code}: ${count}회 · ${meaning}`);
			}
		}
		lines.push('');

		lines.push('## 원인 체인 (추정)');
		if (chains.length === 0) {
			lines.push('- 감지된 대표 체인 없음');
		} else {
			for (const chain of chains) {
				lines.push(`- ${chain}`);
			}
		}
		lines.push('');

		lines.push('## 최종 판정');
		lines.push(`- ${verdict} (${verdictReason})`);
		const judgment = [
			`환경 이슈: ${envErrors > 0 ? '있음' : '없음'}`,
			`코드 이슈: ${(codeErrors > 0 || threadErrors > 0) ? '있음' : '없음'}`,
			`표시/UI 이슈: ${runtimeUnstable ? '가능성 높음' : '낮음'}`,
		].join(' / ');
		lines.push(`- 판정(환경/코드/UI): ${judgment}`);

		return lines.join('\n');
	}

	// ── TreeItem converters ─────────────────────────────

	private toSectionItem(node: SectionNode): vscode.TreeItem {
		const state = node.collapsed
			? vscode.TreeItemCollapsibleState.Collapsed
			: vscode.TreeItemCollapsibleState.Expanded;
		const item = new vscode.TreeItem(node.label, state);
		item.iconPath = new vscode.ThemeIcon(node.iconId);
		item.description = node.description;
		item.contextValue = `section-${node.id}`;
		return item;
	}

	private toThreadItem(node: ThreadNode): vscode.TreeItem {
		const t = node.thread;
		const item = new vscode.TreeItem(t.name, vscode.TreeItemCollapsibleState.None);

		// description: 상태 + 파일 + 상태 메시지
		const descParts: string[] = [t.state];
		if (t.file) { descParts.push(t.file); }
		if (t.lastStatus && t.lastStatus !== '0') { descParts.push(t.lastStatus); }
		item.description = descParts.join(' · ');

		item.tooltip = [
			t.name,
			`State: ${t.state}`,
			t.lastStatus ? `Status: ${t.lastStatus}` : '',
			t.project ? `Project: ${t.project}` : '',
			t.file ? `File: ${t.file}` : '',
		].filter(Boolean).join('\n');
		item.iconPath = this.threadIcon(t.state);
		// Granular contextValue for different thread states
		switch (t.state) {
			case 'Running':
				item.contextValue = 'gplThread-running';
				break;
			case 'Paused':
			case 'Break':
				item.contextValue = 'gplThread-paused';
				// Click → navigate to stopped line
				item.command = {
					command: 'gpl.controller.threadShowLocation',
					title: '정지 위치 보기',
					arguments: [node],
				};
				break;
			case 'Error':
				item.contextValue = 'gplThread-error';
				// Click → navigate to error line
				item.command = {
					command: 'gpl.controller.threadShowLocation',
					title: '에러 위치 보기',
					arguments: [node],
				};
				break;
			default:
				item.contextValue = 'gplThread-stopped';
				break;
		}
		return item;
	}

	private toInfoItem(node: InfoNode): vscode.TreeItem {
		const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
		item.iconPath = new vscode.ThemeIcon(node.iconId);
		item.description = node.description;
		if (node.tooltip) {
			item.tooltip = node.tooltip;
		}
		if (node.command) {
			item.command = node.command;
		}
		if (node.contextValue) {
			item.contextValue = node.contextValue;
		}
		(item as any).remotePath = node.remotePath;
		(item as any).projectName = node.projectName;
		return item;
	}

	private threadIcon(state: string): vscode.ThemeIcon {
		switch (state) {
			case 'Running': return new vscode.ThemeIcon('run-all', new vscode.ThemeColor('testing.runAction'));
			case 'Idle': return new vscode.ThemeIcon('clock', new vscode.ThemeColor('charts.yellow'));
			case 'Error': return new vscode.ThemeIcon('bug', new vscode.ThemeColor('errorForeground'));
			case 'Stopped': return new vscode.ThemeIcon('stop-circle', new vscode.ThemeColor('charts.orange'));
			case 'Paused': return new vscode.ThemeIcon('debug-pause', new vscode.ThemeColor('debugIcon.pauseForeground'));
			case 'Break': return new vscode.ThemeIcon('debug-breakpoint-data', new vscode.ThemeColor('debugIcon.breakpointForeground'));
			default: return new vscode.ThemeIcon('circle-outline');
		}
	}
}

function formatSize(bytes: number): string {
	if (bytes < 1024) { return `${bytes} B`; }
	if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(1)} KB`; }
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(date: Date): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	const h = String(date.getHours()).padStart(2, '0');
	const min = String(date.getMinutes()).padStart(2, '0');
	return `${y}-${m}-${d} ${h}:${min}`;
}

function formatDateTimeFromTs(timestamp?: number): string {
	if (!timestamp) { return '(없음)'; }
	return new Date(timestamp).toLocaleString('ko-KR');
}

function formatRuntimeConsoleStatusLabel(status: RuntimeConsoleStatusSnapshot): string {
	switch (status.state) {
		case 'connected':
			return 'Connected';
		case 'connected-no-payload':
			return 'Connected (No payload)';
		case 'connecting':
			return 'Connecting';
		case 'reconnecting':
			if (status.immediateEofStreak > 0) {
				return 'Polling';
			}
			return 'Reconnecting';
		case 'connect-failed':
			return 'Connect failed';
		case 'no-payload':
			return 'No payload';
		case 'polling':
			return 'Polling';
		case 'stopped':
			return 'Stopped';
		case 'batch-complete':
			return 'Batch complete';
		case 'socket-error':
			return 'Socket error';
		default:
			return status.connected ? 'Connected' : 'Disconnected';
	}
}

function formatRuntimeConsoleStatusDetail(status: RuntimeConsoleStatusSnapshot): string {
	const parts: string[] = [];
	if (status.reason) {
		parts.push(status.reason);
	}
	if (status.detail) {
		parts.push(status.detail);
	}
	if (status.noPayloadStreak > 0) {
		parts.push(`noPayloadStreak=${status.noPayloadStreak}`);
	}
	if (status.immediateEofStreak > 0) {
		parts.push(`pollEmptyStreak=${status.immediateEofStreak}`);
	}
	if (status.reconnectDelayMs) {
		parts.push(`reconnect=${status.reconnectDelayMs}ms`);
	}
	if (parts.length === 0) {
		return status.connected ? '정상 연결' : '상세 없음';
	}
	return parts.join(' / ');
}

function formatRuntimeConsoleTreeState(status: RuntimeConsoleStatusSnapshot): string {
	switch (status.state) {
		case 'connected':
			return '연결됨';
		case 'connected-no-payload':
			return '연결됨 · payload 없음';
		case 'connecting':
			return '연결 중';
		case 'reconnecting':
			if (status.immediateEofStreak > 0) {
				return '이벤트 대기 폴링';
			}
			return '재연결 대기';
		case 'connect-failed':
			return '연결 실패';
		case 'no-payload':
			return 'payload 없음';
		case 'polling':
			return '이벤트 대기 폴링';
		case 'stopped':
			return '중지됨';
		case 'batch-complete':
			return '배치 완료';
		case 'socket-error':
			return '소켓 오류';
		default:
			return status.connected ? '연결됨' : '미연결';
	}
}

function buildRuntimeConsoleTreeDescription(status: RuntimeConsoleStatusSnapshot): string {
	const parts: string[] = [formatRuntimeConsoleTreeState(status)];
	if (status.reconnectDelayMs) {
		parts.push(status.immediateEofStreak > 0
			? `${status.reconnectDelayMs}ms 뒤 폴링`
			: `${status.reconnectDelayMs}ms 뒤 재연결`);
	} else if (status.lastPayloadAt) {
		const payloadSummary = status.lastPayloadBytes
			? `${formatDateTimeFromTs(status.lastPayloadAt)} · ${status.lastPayloadBytes}B`
			: formatDateTimeFromTs(status.lastPayloadAt);
		parts.push(`마지막 payload ${payloadSummary}`);
	} else if (status.noPayloadStreak > 0) {
		parts.push(`payload 없음 x${status.noPayloadStreak}`);
	} else if (status.reason && status.reason !== '미연결') {
		parts.push(status.reason);
	}
	return parts.join(' · ');
}

function getRuntimeConsoleTreeIcon(status: RuntimeConsoleStatusSnapshot): string {
	if (status.connected && status.state === 'connected') {
		return 'pass';
	}
	if (status.state === 'connecting' || status.state === 'reconnecting' || status.state === 'polling') {
		return 'refresh';
	}
	return 'warning';
}

function buildRuntimeConsoleTreeTooltip(
	status: RuntimeConsoleStatusSnapshot,
	ip: string,
	port: number,
): string {
	const lines = [
		`1403 콘솔: ${formatRuntimeConsoleTreeState(status)} (${ip}:${port})`,
		`상세: ${formatRuntimeConsoleStatusDetail(status)}`,
	];
	if (status.lastConnectAt) {
		lines.push(`마지막 연결 시도: ${formatDateTimeFromTs(status.lastConnectAt)}`);
	}
	if (status.lastPayloadAt) {
		lines.push(`마지막 payload: ${formatDateTimeFromTs(status.lastPayloadAt)}${status.lastPayloadBytes ? ` (${status.lastPayloadBytes}B)` : ''}`);
	}
	if (status.lastErrorCode) {
		lines.push(`마지막 오류 코드: ${status.lastErrorCode}`);
	}
	if (status.reconnectDelayMs) {
		lines.push(`${status.immediateEofStreak > 0 ? '폴링 대기' : '재연결 대기'}: ${status.reconnectDelayMs}ms${status.reconnectAttempt ? ` (attempt ${status.reconnectAttempt})` : ''}`);
	}
	lines.push('클릭: 연결/재연결 후 로그 보기');
	lines.push('버튼: 트래픽 보기');
	return lines.join('\n');
}

function isRuntimeConsoleUnstable(status: RuntimeConsoleStatusSnapshot): boolean {
	if (status.connected) { return false; }
	if (status.state === 'stopped' || status.state === 'idle' || status.state === 'polling') { return false; }
	if (status.immediateEofStreak > 0 && status.noPayloadStreak === 0 && status.lastErrorCode === undefined) { return false; }
	if (status.noPayloadStreak >= 2) { return true; }
	return /refused|timeout/i.test(`${status.reason} ${status.detail ?? ''}`);
}

function getRuntimeConsoleHypothesis(status: RuntimeConsoleStatusSnapshot): string | undefined {
	if (status.lastErrorCode === 'ECONNREFUSED' || /ECONNREFUSED/i.test(status.detail ?? '')) {
		return '다른 1403 소비자가 포트를 점유했거나, 제어기 쪽 콘솔 서비스가 비활성일 가능성이 있습니다.';
	}
	if (status.state === 'polling') {
		return '1403 이벤트 큐가 비어 있어 payload 없는 짧은 세션을 반복하는 정상 폴링 상태입니다.';
	}
	if (status.state === 'no-payload' || status.state === 'connected-no-payload') {
		return '실제 런타임이 Idle 상태이거나, 1403이 빈 배치 세션만 반환하는 상태일 수 있습니다.';
	}
	return undefined;
}
