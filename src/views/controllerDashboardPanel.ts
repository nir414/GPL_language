/**
 * 제어기 실시간 상태 대시보드 (Webview Panel).
 *
 * 사이드바 TreeView 대신, 편집기 영역(ViewColumn.Beside)에 코드와 나란히 띄우는
 * "한눈에 보는" 상태 화면. 제어기 웹 Operator 화면(master/jog)을 참고해 기능 중심으로
 * 구성: 상태 배지(연결·고전원·스레드·에러) · 스레드 표 · 축 게이지 · 직교 좌표/XY 플롯 · 로그 (GitHub #18).
 *
 * HTML은 media/dashboard.html에서 로드하며, 데이터는 postMessage로 주입한다.
 * 웹뷰 → 확장 메시지: `ready`/`refresh`(즉시 1회 폴링), `setInterval {ms}`(이 탭이 열려 있는 동안 폴링 주기 덮어쓰기),
 * `pause {paused}`(자동 갱신 일시정지 — 새로고침 버튼은 여전히 1회 폴링). 확장 → 웹뷰: `status {snapshot}`, `config {pollMs, paused}`, `error`.
 *
 * 자원 지표(GitHub #22 제안 8): 설정 `gpl.controller.dashboardResourceProbes`(기본 true)가 켜져 있으면 폴링마다
 * Show Memory / Show Network -tcp / -mbuf 를 함께 조회한다. 패널이 관측 이력(ResourceHistory, 120점 링 ≥ 5분)을
 * 보관해 `status` 메시지에 `snapshot.resources.rates`(accepted/s·closed/s)와 `resourceHistory`(시계열),
 * `resourceProbes`(이번 폴링에 프로브가 포함됐는지)를 덧붙인다. 탭을 닫으면 이력은 사라진다.
 */

import * as vscode from 'vscode';
import { fetchControllerStatus, ControllerStatusSnapshot } from '../controller/controllerStatus';
import { ResourceHistory, ResourceHistoryPoint, ResourceRates, ResourceSnapshot } from '../controller/resourceProbes';
import { getConnectionStats, ConnectionStats } from '../controller/controllerConnection';

/**
 * 대시보드 폴링의 연결 판정(fetchControllerStatus.connected)을 밖으로 알리는 관찰자 — extension.ts 가 연결 건강 모니터
 * (controller/connectionHealth.ts)의 힌트로 쓴다(2026-08-28). 패널은 판정하지 않고 보고만 한다.
 */
export type DashboardConnectionObserver = (connected: boolean, note?: string) => void;
let _connectionObserver: DashboardConnectionObserver | undefined;

export function setDashboardConnectionObserver(fn?: DashboardConnectionObserver): void {
	_connectionObserver = fn;
}

const VIEW_TYPE = 'gplControllerDashboard';
const DEFAULT_POLL_MS = 1500;
const MIN_POLL_MS = 500;
const MAX_POLL_MS = 60000;
/** 설정 `gpl.controller.dashboardResourceProbes` 기본값(스키마는 package.json). */
const DEFAULT_RESOURCE_PROBES = true;

/** 확장 → 웹뷰 `status` 메시지의 스냅샷: 자원 지표에 증가율이 덧붙는다. */
type DashboardSnapshot = Omit<ControllerStatusSnapshot, 'resources'> & {
	resources?: ResourceSnapshot & { rates: ResourceRates | null };
};

interface DashboardMessage {
	type: 'status' | 'error';
	snapshot?: DashboardSnapshot;
	/** 자원 지표 시계열(accepted/s · clustersFree · freeMb). */
	resourceHistory?: ResourceHistoryPoint[];
	/** 이번 폴링에 자원 프로브가 포함됐는지(false = 설정으로 꺼짐). */
	resourceProbes?: boolean;
	/** 확장 측 1402 keep-alive 연결 통계(connects/reuses/retries) — 제어기 TCP accept 카운터와 대조용(GitHub #22). */
	connectionStats?: ConnectionStats;
	message?: string;
}

export class ControllerDashboardPanel {
	private static current: ControllerDashboardPanel | undefined;

	private readonly panel: vscode.WebviewPanel;
	private readonly context: vscode.ExtensionContext;
	private readonly log: vscode.OutputChannel | undefined;
	private disposables: vscode.Disposable[] = [];
	private pollTimer: ReturnType<typeof setTimeout> | null = null;
	private pollInFlight = false;
	private visible = true;
	private disposed = false;
	/** 웹뷰 주기 선택으로 덮어쓴 폴링 주기(ms). 탭을 닫으면 사라지고 설정값으로 돌아간다. */
	private pollOverrideMs: number | undefined;
	/** 자동 갱신 일시정지(수동 새로고침은 계속 동작). */
	private paused = false;
	/** 자원 지표 관측 이력(증가율 기준 샘플 + 시계열 링). 패널 수명 동안 유지. */
	private readonly resourceHistory = new ResourceHistory();

	static show(context: vscode.ExtensionContext, log?: vscode.OutputChannel): void {
		const column = vscode.ViewColumn.Beside;
		if (ControllerDashboardPanel.current) {
			ControllerDashboardPanel.current.panel.reveal(column);
			return;
		}
		const panel = vscode.window.createWebviewPanel(
			VIEW_TYPE,
			'제어기 대시보드',
			column,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
			},
		);
		ControllerDashboardPanel.current = new ControllerDashboardPanel(panel, context, log);
	}

	private constructor(
		panel: vscode.WebviewPanel,
		context: vscode.ExtensionContext,
		log?: vscode.OutputChannel,
	) {
		this.panel = panel;
		this.context = context;
		this.log = log;

		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

		this.panel.onDidChangeViewState(() => {
			this.visible = this.panel.visible;
			if (this.visible) {
				this.scheduleNextPoll(0);
			} else {
				this.stopPolling();
			}
		}, null, this.disposables);

		this.panel.webview.onDidReceiveMessage((msg) => {
			if (!msg || typeof msg.type !== 'string') {
				return;
			}
			switch (msg.type) {
				case 'ready':
					this.postConfig();
					this.scheduleNextPoll(0);
					break;
				case 'refresh':
					// 일시정지 중에도 수동 새로고침은 1회 폴링한다(이후 자동 재예약은 paused가 막는다).
					this.scheduleNextPoll(0);
					break;
				case 'setInterval': {
					const ms = Number(msg.ms);
					if (Number.isFinite(ms) && ms > 0) {
						this.pollOverrideMs = Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, Math.round(ms)));
						this.postConfig();
						if (!this.paused) {
							this.scheduleNextPoll();
						}
					}
					break;
				}
				case 'pause':
					this.paused = !!msg.paused;
					this.postConfig();
					if (this.paused) {
						this.stopPolling();
					} else {
						this.scheduleNextPoll(0);
					}
					break;
			}
		}, null, this.disposables);

		void this.render();
	}

	private async render(): Promise<void> {
		try {
			this.panel.webview.html = await this.buildHtml();
		} catch (err) {
			this.log?.appendLine(`[Dashboard] HTML 로드 실패: ${err}`);
			this.panel.webview.html = this.fallbackHtml(String(err));
		}
	}

	private async buildHtml(): Promise<string> {
		const webview = this.panel.webview;
		const htmlUri = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'dashboard.html');
		const bytes = await vscode.workspace.fs.readFile(htmlUri);
		let html = Buffer.from(bytes).toString('utf8');

		const nonce = makeNonce();
		html = html
			.replace(/\$\{nonce\}/g, nonce)
			.replace(/\$\{cspSource\}/g, webview.cspSource);
		return html;
	}

	private fallbackHtml(reason: string): string {
		return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"></head>
<body style="font-family:sans-serif;padding:1rem;">
<h3>제어기 대시보드</h3>
<p>media/dashboard.html을 로드하지 못했습니다.</p>
<pre>${escapeHtml(reason)}</pre>
</body></html>`;
	}

	// ── 폴링 ────────────────────────────────────────────────

	private scheduleNextPoll(delayMs?: number): void {
		if (this.disposed || !this.visible) {
			return;
		}
		// 자동 재예약(delay 미지정)은 일시정지 중엔 하지 않는다. 명시적 즉시 폴링(0)은 허용.
		if (this.paused && delayMs === undefined) {
			return;
		}
		this.stopPolling();
		const interval = delayMs ?? this.pollIntervalMs();
		this.pollTimer = setTimeout(() => {
			this.pollTimer = null;
			void this.pollOnce().finally(() => this.scheduleNextPoll());
		}, interval);
	}

	private stopPolling(): void {
		if (this.pollTimer) {
			clearTimeout(this.pollTimer);
			this.pollTimer = null;
		}
	}

	private pollIntervalMs(): number {
		if (this.pollOverrideMs !== undefined) {
			return this.pollOverrideMs;
		}
		const cfg = vscode.workspace.getConfiguration('gpl.controller');
		const raw = cfg.get<number>('dashboardPollIntervalMs') ?? DEFAULT_POLL_MS;
		return Math.max(MIN_POLL_MS, raw);
	}

	/** 웹뷰의 주기 선택/일시정지 버튼 표시를 확장 쪽 실제 상태와 맞춘다. */
	private postConfig(): void {
		if (!this.disposed) {
			void this.panel.webview.postMessage({ type: 'config', pollMs: this.pollIntervalMs(), paused: this.paused });
		}
	}

	private async pollOnce(): Promise<void> {
		if (this.pollInFlight || this.disposed) {
			return;
		}
		this.pollInFlight = true;
		try {
			// 설정은 폴링마다 읽는다 — 탭을 다시 열지 않고도 켜고 끌 수 있게.
			const includeResources = this.resourceProbesEnabled();
			const snapshot = await fetchControllerStatus(undefined, { includeResources });
			try { _connectionObserver?.(snapshot.connected, snapshot.note); } catch { /* 관찰자 예외가 폴링을 막지 않게 */ }
			const { resources, ...rest } = snapshot;
			const message: DashboardMessage = { type: 'status', snapshot: rest, resourceProbes: includeResources, connectionStats: getConnectionStats() };
			if (resources) {
				const { rates, history } = this.resourceHistory.record(resources);
				message.snapshot = { ...rest, resources: { ...resources, rates } };
				message.resourceHistory = history;
			}
			this.post(message);
		} catch (err) {
			this.log?.appendLine(`[Dashboard] 상태 수집 실패: ${err}`);
			this.post({ type: 'error', message: String(err) });
		} finally {
			this.pollInFlight = false;
		}
	}

	private resourceProbesEnabled(): boolean {
		return vscode.workspace.getConfiguration('gpl.controller')
			.get<boolean>('dashboardResourceProbes', DEFAULT_RESOURCE_PROBES);
	}

	private post(message: DashboardMessage): void {
		if (!this.disposed) {
			void this.panel.webview.postMessage(message);
		}
	}

	private dispose(): void {
		this.disposed = true;
		this.stopPolling();
		ControllerDashboardPanel.current = undefined;
		while (this.disposables.length) {
			this.disposables.pop()?.dispose();
		}
	}
}

function makeNonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let text = '';
	for (let i = 0; i < 32; i++) {
		text += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return text;
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}
