/**
 * 제어기 실시간 상태 대시보드 (Webview Panel).
 *
 * 사이드바 TreeView 대신, 편집기 영역(ViewColumn.Beside)에 코드와 나란히 띄우는
 * "한눈에 보는" 상태 화면. 제어기 웹 Operator 화면(master/jog)을 참고해 기능 중심으로
 * 구성: 통신 상태 · 고전원(서보) ON/OFF · 축별 위치 · 로그.
 *
 * HTML은 media/dashboard.html에서 로드하며, 데이터는 postMessage로 주입한다.
 */

import * as vscode from 'vscode';
import { fetchControllerStatus, ControllerStatusSnapshot } from '../controller/controllerStatus';

const VIEW_TYPE = 'gplControllerDashboard';
const DEFAULT_POLL_MS = 1500;
const MIN_POLL_MS = 500;

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
				case 'refresh':
					this.scheduleNextPoll(0);
					break;
				case 'setInterval':
					// 향후 UI에서 폴링 주기 조절용. 현재는 무시 가능.
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
		const cfg = vscode.workspace.getConfiguration('gpl.controller');
		const raw = cfg.get<number>('dashboardPollIntervalMs') ?? DEFAULT_POLL_MS;
		return Math.max(MIN_POLL_MS, raw);
	}

	private async pollOnce(): Promise<void> {
		if (this.pollInFlight || this.disposed) {
			return;
		}
		this.pollInFlight = true;
		try {
			const snapshot = await fetchControllerStatus();
			this.post({ type: 'status', snapshot });
		} catch (err) {
			this.log?.appendLine(`[Dashboard] 상태 수집 실패: ${err}`);
			this.post({ type: 'error', message: String(err) });
		} finally {
			this.pollInFlight = false;
		}
	}

	private post(message: { type: string; snapshot?: ControllerStatusSnapshot; message?: string }): void {
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
