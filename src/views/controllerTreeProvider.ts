/**
 * 제어기 상태 통합 TreeView — 연결 정보, 쓰레드, FTP 파일, 시스템 정보, 에러 로그를 사이드바에 표시.
 * 연결 후 주기적 폴링으로 실시간 상태를 갱신한다.
 */

import * as vscode from 'vscode';
import { trySendCommand, getControllerConfig } from '../controller/controllerConnection';
import { parseThreadList, ThreadInfo, parseErrorLog, parseBreakList, BreakpointInfo } from '../controller/responseParser';
import { FtpEntry, listRemoteDir } from '../controller/ftpClient';

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
	) {}
}

// ── Provider ────────────────────────────────────────────

export class ControllerTreeProvider implements vscode.TreeDataProvider<ControllerNode>, vscode.Disposable {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<ControllerNode | undefined>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	/** 연결 유실 감지 시 발생 (3회 연속 실패) */
	private readonly _onDidLoseConnection = new vscode.EventEmitter<void>();
	readonly onDidLoseConnection = this._onDidLoseConnection.event;

	private _connected = false;
	private threads: ThreadInfo[] = [];
	private errors: string[] = [];
	private ftpEntries: FtpEntry[] = [];
	private ftpError: string | null = null;
	private sysInfo: { label: string; value: string; tooltip?: string; iconId?: string }[] = [];
	private pollTimer: ReturnType<typeof setInterval> | null = null;
	private consecutiveFailures = 0;
	private breakpoints: BreakpointInfo[] = [];

	get isConnected(): boolean { return this._connected; }

	/**
	 * 연결 상태 변경 — 연결 시 즉시 폴링 시작, 해제 시 정리.
	 */
	setConnected(connected: boolean): void {
		this._connected = connected;
		this.consecutiveFailures = 0;
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
			this.sysInfo = [];
			this._onDidChangeTreeData.fire(undefined);
		}
	}

	startPolling(): void {
		this.stopPolling();
		if (!this._connected) { return; }
		const cfg = vscode.workspace.getConfiguration('gpl.controller');
		const interval = cfg.get<number>('threadPollIntervalMs') ?? 5000;
		this.pollTimer = setInterval(() => this.refresh(), interval);
	}

	stopPolling(): void {
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
	}

	/**
	 * 전체 갱신 — 쓰레드 → 에러 → BP → FTP → 시스템 정보 순차 요청.
	 * TCP 충돌 방지를 위해 직렬화.
	 */
	async refreshAll(): Promise<void> {
		await this.refresh();
		await this.refreshFtp();
		await this.refreshSystemInfo();
	}

	/**
	 * 쓰레드 + 에러 로그 + 브레이크포인트 갱신 (순차).
	 */
	async refresh(): Promise<void> {
		if (!this._connected) { return; }

		// TCP 직렬화 — 동시 소켓 방지
		const threadResp = await trySendCommand('Show Thread');
		const errorResp = await trySendCommand('ErrorLog');
		const breakResp = await trySendCommand('Show Break');

		// 연결 유실 감지: 3회 연속 실패 시 자동 해제
		if (threadResp === null && errorResp === null) {
			this.consecutiveFailures++;
			if (this.consecutiveFailures >= 3) {
				this._connected = false;
				this.stopPolling();
				this.threads = [];
				this.errors = [];
				this.breakpoints = [];
				this.ftpEntries = [];
				this.ftpError = null;
				this.sysInfo = [];
				this._onDidChangeTreeData.fire(undefined);
				this._onDidLoseConnection.fire();
				return;
			}
		} else {
			this.consecutiveFailures = 0;
		}

		this.threads = threadResp ? parseThreadList(threadResp) : [];
		this.errors = errorResp ? parseErrorLog(errorResp) : [];
		this.breakpoints = breakResp ? parseBreakList(breakResp) : [];
		this._onDidChangeTreeData.fire(undefined);
	}

	/**
	 * FTP /GPL 디렉터리 목록 갱신 (수동).
	 */
	async refreshFtp(): Promise<void> {
		if (!this._connected) { return; }
		const cfg = getControllerConfig();
		try {
			this.ftpEntries = await listRemoteDir(cfg.ip, cfg.ftpBasePath);
			this.ftpError = null;
		} catch (err: any) {
			this.ftpEntries = [];
			this.ftpError = err.message ?? String(err);
		}
		this._onDidChangeTreeData.fire(undefined);
	}

	/**
	 * 시스템 정보 갱신 (수동).
	 */
	async refreshSystemInfo(): Promise<void> {
		if (!this._connected) { return; }
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
					command: 'gpl.connect',
					title: 'Connect to Controller',
				}),
			];
			return [sec];
		}

		const cfg = getControllerConfig();
		const sections: SectionNode[] = [];

		// ── 연결 정보 (기본 접힘)
		const conn = new SectionNode('connection', cfg.ip, 'plug', '연결됨');
		conn.collapsed = true;
		conn.children = [
			new InfoNode(`명령 포트: ${cfg.port}`, 'server', undefined, {
				command: 'gpl.controller.pingPort',
				title: '포트 통신 테스트',
				arguments: ['command', cfg.ip, cfg.port],
			}),
			new InfoNode(`콘솔 포트: ${cfg.consolePort}`, 'terminal', undefined, {
				command: 'gpl.controller.pingPort',
				title: '포트 통신 테스트',
				arguments: ['console', cfg.ip, cfg.consolePort],
			}),
			new InfoNode('통신 트래픽 보기', 'radio-tower', undefined, {
				command: 'gpl.controller.showTraffic',
				title: '통신 트래픽 보기',
			}),
			new InfoNode('명령 보내기…', 'debug-console', undefined, {
				command: 'gpl.controller.sendCommand',
				title: '명령 보내기',
			}),
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
				return new InfoNode(e.name, icon, desc, undefined, ctx);
			});
		}
		sections.push(ftpSec);

		// ── 시스템 정보
		const sysSec = new SectionNode('system', '시스템 정보', 'dashboard',
			this.sysInfo.length > 0 ? undefined : '조회 안됨');
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

		// ── 에러 로그
		const errSec = new SectionNode('errors',
			this.errors.length > 0 ? `에러 (${this.errors.length})` : '에러 없음',
			this.errors.length > 0 ? 'warning' : 'pass');
		errSec.children = this.errors.length > 0
			? this.errors.map(e => new InfoNode(e, 'error', undefined, undefined, 'errorItem'))
			: [new InfoNode('활성 에러 없음', 'pass')];
		sections.push(errSec);

		return sections;
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
