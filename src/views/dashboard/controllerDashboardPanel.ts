/**
 * 제어기 실시간 상태 대시보드 (Webview Panel).
 *
 * 사이드바 TreeView 대신, 편집기 영역(ViewColumn.Beside)에 코드와 나란히 띄우는
 * "한눈에 보는" 상태 화면. 제어기 웹 Operator 화면(master/jog)을 참고해 기능 중심으로
 * 구성: 상태 배지(연결·고전원·스레드·에러) · 스레드 표 · 축 게이지 · 직교 좌표/XY 플롯 · 로그 (GitHub #18),
 * I/O 탭(Show DIO 를 웹 Operator 처럼 Local I/O · Remote I/O 그룹으로 묶은 칩 그리드 — 더블클릭 강제 토글,
 * 우클릭 메뉴로 강제 해제·그룹/전체 해제. Set DIO 는 확인 모달 없이 바로 보낸다 — 2026-10-27 사용자 요청).
 *
 * HTML은 assets/webview/dashboard.html에서 로드하며, 데이터는 postMessage로 주입한다.
 * 웹뷰 → 확장 메시지: `ready`/`refresh`(즉시 1회 폴링), `setInterval {ms}`(이 탭이 열려 있는 동안 폴링 주기 덮어쓰기),
 * `setDiagnosticInterval {ms}`(온도·자원·과거 에러 조회 간격 덮어쓰기),
 * `pause {paused}`(자동 갱신 일시정지 — 새로고침 버튼은 여전히 1회 폴링), `showPage {page}`,
 * `setDio {signal,value}`, `toggleDio {signal}`(마지막 관측값의 반대로 강제), `releaseDio {group?}`(강제된 신호 일괄 해제).
 * 확장 → 웹뷰: `status`, `dio`, `dioAction`, `config`, `navigate`, `error`.
 *
 * 온도·자원·과거 에러는 dashboardDiagnosticIntervalMs(기본 10초)마다 조회하고 시각을 함께 보낸다.
 * 자원 지표(GitHub #22 제안 8)는 설정 `gpl.controller.dashboardResourceProbes`(기본 true)가 켜져 있으면
 * Show Memory / Show Network -tcp / -mbuf 를 조회한다. 패널이 관측 이력(ResourceHistory, 120점 링 ≥ 5분)을
 * 보관해 `status` 메시지에 `snapshot.resources.rates`(accepted/s·closed/s)와 `resourceHistory`(시계열),
 * `resourceProbes`(이번 폴링에 프로브가 포함됐는지)를 덧붙인다. 탭을 닫으면 이력은 사라진다.
 *
 * 연결 세션(controller/connection/connectionSession)이 해제 상태면 폴링하지 않는다 — 자동 갱신도, 새로고침 버튼도 제어기에
 * 명령을 보내지 않고 "연결 해제됨" 스냅샷만 그린다. 연결되면 세션 구독으로 즉시 재개한다. (2026-10-14: 해제 뒤에도
 * 이 패널이 1402 를 다시 열어 쥐고 있어 다른 창의 연결이 거부됐다.)
 */

import * as vscode from 'vscode';
import { emptyControllerStatusSnapshot, fetchControllerStatus, ControllerStatusSnapshot } from '../../controller/diagnostics/controllerStatus';
import { ResourceHistory, ResourceHistoryPoint, ResourceRates, ResourceSnapshot } from '../../controller/diagnostics/resourceProbes';
import { getConnectionStats, getControllerConfig, sendCommand, ConnectionStats } from '../../controller/connection/controllerConnection';
import { isControllerSessionConnected, onControllerSessionChange } from '../../controller/connection/connectionSession';
import { buildSetDioCommand, describeDioForce, DioForceValue, DioSignalState, parseDioSignals } from '../../controller/io/dio';
import {
	buildShowDioCommands, DioGroupInfo, DioGroupView, forcedSignalsFor, groupDioSignals, SOFT_DIO_SIGNALS,
	STANDARD_REMOTE_GROUPS, toggleForceValue,
} from '../../controller/io/dioGroups';
import { parseStatus } from '../../controller/protocol/responseParser';
import { ControllerStatusSampler, DEFAULT_DIAGNOSTIC_INTERVAL_MS } from '../../controller/diagnostics/statusSampling';
import { TemperatureHistory, TemperatureHistoryPoint } from '../../controller/diagnostics/temperature';

/**
 * 대시보드 폴링의 연결 판정(fetchControllerStatus.connected)을 밖으로 알리는 관찰자 — extension.ts 가 연결 건강 모니터
 * (controller/connection/connectionHealth.ts)의 힌트로 쓴다(2026-08-28). 패널은 판정하지 않고 보고만 한다.
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
/** 진단(온도·자원·과거 에러) 조회 간격 범위 — 설정 스키마(package.json)와 같다. */
const MIN_DIAGNOSTIC_MS = 1000;
const MAX_DIAGNOSTIC_MS = 60000;
/** 설정 `gpl.controller.dashboardResourceProbes` 기본값(스키마는 package.json). */
const DEFAULT_RESOURCE_PROBES = true;
type DashboardPage = 'status' | 'io';

/** 확장 → 웹뷰 `status` 메시지의 스냅샷: 자원 지표에 증가율이 덧붙는다. */
type DashboardSnapshot = Omit<ControllerStatusSnapshot, 'resources'> & {
	resources?: ResourceSnapshot & { rates: ResourceRates | null };
};

interface DashboardMessage {
	type: 'status' | 'dio' | 'dioAction' | 'error';
	snapshot?: DashboardSnapshot;
	dio?: {
		connected: boolean;
		target: { ip: string; port: number };
		timestamp: number;
		/** Local → Remote, 그룹 순서로 묶은 신호. */
		groups: DioGroupView[];
		/** 웹 Operator 가 늘 나열하지만 이번 응답에 신호가 없는 Remote 그룹. */
		absent: DioGroupInfo[];
		note?: string;
	};
	busy?: boolean;
	ok?: boolean;
	/** dioAction: 처리 중인 신호(웹뷰가 칩에 진행 표시). */
	signals?: number[];
	/** 자원 지표 시계열(accepted/s · clustersFree · freeMb). */
	resourceHistory?: ResourceHistoryPoint[];
	/** 이번 폴링에 자원 프로브가 포함됐는지(false = 설정으로 꺼짐). */
	resourceProbes?: boolean;
	temperatureHistory?: TemperatureHistoryPoint[];
	cpuTemperatureWarningC?: number;
	diagnosticIntervalMs?: number;
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
	private webviewReady = false;
	private activePage: DashboardPage;
	private dioActionInFlight = false;
	/** 마지막 DIO 관측값 — 더블클릭 토글·일괄 해제가 웹뷰가 아닌 확장 쪽 관측을 근거로 삼게 한다. */
	private lastDioSignals: DioSignalState[] = [];
	/** 웹뷰 주기 선택으로 덮어쓴 폴링 주기(ms). 탭을 닫으면 사라지고 설정값으로 돌아간다. */
	private pollOverrideMs: number | undefined;
	/** 웹뷰에서 덮어쓴 진단 조회 간격(ms). 탭을 닫으면 설정값으로 돌아간다. */
	private diagnosticOverrideMs: number | undefined;
	/** 자동 갱신 일시정지(수동 새로고침은 계속 동작). */
	private paused = false;
	/** 자원 지표 관측 이력(증가율 기준 샘플 + 시계열 링). 패널 수명 동안 유지. */
	private readonly resourceHistory = new ResourceHistory();
	private readonly sampler = new ControllerStatusSampler();
	private readonly temperatureHistory = new TemperatureHistory();
	private lastResourceSampleAt: number | undefined;
	private resourceRates: ResourceRates | null = null;
	private targetKey = '';
	private pollGeneration = 0;
	private refreshRequested = false;

	static show(context: vscode.ExtensionContext, log?: vscode.OutputChannel, page: DashboardPage = 'status'): void {
		const column = vscode.ViewColumn.Beside;
		if (ControllerDashboardPanel.current) {
			ControllerDashboardPanel.current.panel.reveal(column);
			ControllerDashboardPanel.current.selectPage(page);
			return;
		}
		const panel = vscode.window.createWebviewPanel(
			VIEW_TYPE,
			'제어기 대시보드',
			column,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'assets', 'webview')],
			},
		);
		ControllerDashboardPanel.current = new ControllerDashboardPanel(panel, context, log, page);
	}

	private constructor(
		panel: vscode.WebviewPanel,
		context: vscode.ExtensionContext,
		log?: vscode.OutputChannel,
		initialPage: DashboardPage = 'status',
	) {
		this.panel = panel;
		this.context = context;
		this.log = log;
		this.activePage = initialPage;

		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

		// 연결 세션 에지: 연결되면 즉시 1회 폴링 후 주기 재개, 해제·유실되면 타이머를 멈추고 해제 상태를 그린다.
		this.disposables.push(onControllerSessionChange(change => {
			this.pollGeneration++;
			this.resetDiagnostics();
			if (change.connected) {
				this.scheduleNextPoll(0);
			} else {
				this.stopPolling();
				this.postDisconnected(change.reason === 'lost' ? '연결 유실' : '연결 해제됨');
			}
		}));

		this.panel.onDidChangeViewState(() => {
			this.pollGeneration++;
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
					this.webviewReady = true;
					this.postConfig();
					this.postNavigation();
					this.scheduleNextPoll(0);
					break;
				case 'refresh':
					this.refreshRequested = true;
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
				case 'setDiagnosticInterval': {
					const ms = Number(msg.ms);
					if (Number.isFinite(ms) && ms > 0) {
						this.diagnosticOverrideMs = Math.min(MAX_DIAGNOSTIC_MS, Math.max(MIN_DIAGNOSTIC_MS, Math.round(ms)));
						this.postConfig();
					}
					break;
				}
				case 'pause':
					this.pollGeneration++;
					this.paused = !!msg.paused;
					this.postConfig();
					if (this.paused) {
						this.stopPolling();
					} else {
						this.scheduleNextPoll(0);
					}
					break;
				case 'showPage':
					if (msg.page === 'status' || msg.page === 'io') {
						this.selectPage(msg.page);
					}
					break;
				case 'setDio':
					void this.forceDio([{ signal: msg.signal, value: msg.value }]);
					break;
				case 'toggleDio': {
					const known = this.lastDioSignals.find(item => item.signal === msg.signal);
					if (!known) {
						this.post({ type: 'dioAction', ok: false, message: `DIO ${msg.signal} — 마지막 조회에 없는 신호라 토글할 수 없습니다.` });
						break;
					}
					void this.forceDio([{ signal: known.signal, value: toggleForceValue(known) }]);
					break;
				}
				case 'releaseDio': {
					const group = typeof msg.group === 'string' ? msg.group : undefined;
					const targets = forcedSignalsFor(this.lastDioSignals, group);
					if (targets.length === 0) {
						this.post({ type: 'dioAction', ok: true, message: '강제된 신호가 없습니다.' });
						break;
					}
					void this.forceDio(targets.map(signal => ({ signal, value: 0 })));
					break;
				}
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
		const htmlUri = vscode.Uri.joinPath(this.context.extensionUri, 'assets', 'webview', 'dashboard.html');
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
<p>assets/webview/dashboard.html을 로드하지 못했습니다.</p>
<pre>${escapeHtml(reason)}</pre>
</body></html>`;
	}

	// ── 폴링 ────────────────────────────────────────────────

	private scheduleNextPoll(delayMs?: number): void {
		if (this.disposed || !this.visible) {
			return;
		}
		// 자동 재예약(delay 미지정)은 일시정지 중이거나 연결 해제 상태면 하지 않는다. 명시적 즉시 폴링(0)은 허용
		// (해제 상태면 pollOnce 가 명령 없이 해제 스냅샷만 그린다).
		if (delayMs === undefined && (this.paused || !isControllerSessionConnected())) {
			return;
		}
		this.stopPolling();
		const interval = this.refreshRequested ? 0 : delayMs ?? this.pollIntervalMs();
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
		return Number.isFinite(raw) ? Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, raw)) : DEFAULT_POLL_MS;
	}

	private diagnosticIntervalMs(): number {
		if (this.diagnosticOverrideMs !== undefined) {
			return this.diagnosticOverrideMs;
		}
		const raw = vscode.workspace.getConfiguration('gpl.controller').get<number>('dashboardDiagnosticIntervalMs', DEFAULT_DIAGNOSTIC_INTERVAL_MS);
		return Number.isFinite(raw) ? Math.max(MIN_DIAGNOSTIC_MS, Math.min(MAX_DIAGNOSTIC_MS, raw)) : DEFAULT_DIAGNOSTIC_INTERVAL_MS;
	}

	/** 웹뷰의 주기 선택/일시정지 버튼 표시를 확장 쪽 실제 상태와 맞춘다. */
	private postConfig(): void {
		if (!this.disposed) {
			void this.panel.webview.postMessage({
				type: 'config', pollMs: this.pollIntervalMs(), diagnosticMs: this.diagnosticIntervalMs(), paused: this.paused,
			});
		}
	}

	private selectPage(page: DashboardPage): void {
		this.pollGeneration++;
		this.activePage = page;
		this.postNavigation();
		this.scheduleNextPoll(0);
	}

	private postNavigation(): void {
		if (this.webviewReady && !this.disposed) {
			void this.panel.webview.postMessage({ type: 'navigate', page: this.activePage });
		}
	}

	private async pollOnce(): Promise<void> {
		if (this.pollInFlight || this.disposed) {
			return;
		}
		// 해제 상태에서는 제어기에 아무것도 보내지 않는다 — 해제된 창이 1402 를 다시 열면 다른 클라이언트가 거부된다.
		if (!isControllerSessionConnected()) {
			this.postDisconnected('연결 해제됨');
			return;
		}
		this.pollInFlight = true;
		const generation = this.pollGeneration;
		const cfg = getControllerConfig();
		const page = this.activePage;
		const active = (): boolean => !this.disposed && this.visible && isControllerSessionConnected()
			&& this.pollGeneration === generation && this.activePage === page
			&& getControllerConfig().ip === cfg.ip && getControllerConfig().port === cfg.port;
		const forceDiagnostics = this.refreshRequested;
		this.refreshRequested = false;
		try {
			if (this.activePage === 'io') {
				await this.pollDio();
				return;
			}
			// 설정은 폴링마다 읽는다 — 탭을 다시 열지 않고도 켜고 끌 수 있게.
			const key = `${cfg.ip}:${cfg.port}`;
			if (this.targetKey !== key) { this.resetDiagnostics(); this.targetKey = key; }
			const settings = vscode.workspace.getConfiguration('gpl.controller');
			const diagnosticIntervalMs = this.diagnosticIntervalMs();
			const includeResources = this.resourceProbesEnabled();
			const snapshot = await fetchControllerStatus(cfg, { includeResources, includeTemperature: true, diagnosticIntervalMs, forceDiagnostics }, this.sampler, active);
			if (!active()) { return; }
			try { _connectionObserver?.(snapshot.connected, snapshot.note); } catch { /* 관찰자 예외가 폴링을 막지 않게 */ }
			const { resources, ...rest } = snapshot;
			const warningC = settings.get<number>('dashboardCpuTemperatureWarningC', 0);
			const message: DashboardMessage = {
				type: 'status', snapshot: rest, resourceProbes: includeResources, connectionStats: getConnectionStats(),
				diagnosticIntervalMs, cpuTemperatureWarningC: Number.isFinite(warningC) ? Math.max(0, warningC) : 0,
			};
			if (snapshot.temperature) { message.temperatureHistory = this.temperatureHistory.record(snapshot.temperature); }
			if (resources) {
				if (resources.sampledAt !== this.lastResourceSampleAt) {
					this.resourceRates = this.resourceHistory.record(resources).rates;
					this.lastResourceSampleAt = resources.sampledAt;
				}
				message.snapshot = { ...rest, resources: { ...resources, rates: this.resourceRates } };
				message.resourceHistory = this.resourceHistory.points();
			}
			this.post(message);
		} catch (err) {
			if (!active()) { return; }
			this.log?.appendLine(`[Dashboard] 상태 수집 실패: ${err}`);
			this.post({ type: 'error', message: String(err) });
		} finally {
			this.pollInFlight = false;
			if (this.refreshRequested) { this.scheduleNextPoll(0); }
		}
	}

	private resetDiagnostics(): void {
		this.sampler.clear();
		this.resourceHistory.clear();
		this.temperatureHistory.clear();
		this.lastResourceSampleAt = undefined;
		this.resourceRates = null;
		this.targetKey = '';
	}

	private async pollDio(): Promise<void> {
		const cfg = getControllerConfig();
		const postDio = (connected: boolean, signals: DioSignalState[], note?: string) => {
			const groups = groupDioSignals(signals);
			const present = new Set(groups.map(group => group.id));
			this.post({
				type: 'dio',
				dio: {
					connected,
					target: { ip: cfg.ip, port: cfg.port },
					timestamp: Date.now(),
					groups,
					absent: connected ? STANDARD_REMOTE_GROUPS.filter(group => !present.has(group.id)) : [],
					note,
				},
			});
		};
		try {
			const response = await sendCommand('Show DIO');
			const status = parseStatus(response);
			if (status.code !== 0) {
				this.lastDioSignals = [];
				postDio(true, [], `Show DIO STATUS ${status.code}: ${status.message}`);
				return;
			}
			const signals = parseDioSignals(response);
			// 인자 없는 Show DIO 는 Software I/O 를 내주지 않는다(dioGroups.ts 머리 주석) — 번호를 지정해 따로 묻는다.
			const known = new Set(signals.map(item => item.signal));
			let softNote: string | undefined;
			for (const command of buildShowDioCommands(SOFT_DIO_SIGNALS.filter(signal => !known.has(signal)))) {
				const softResponse = await sendCommand(command);
				const softStatus = parseStatus(softResponse);
				if (softStatus.code !== 0) {
					softNote = `Soft DIO 조회 STATUS ${softStatus.code}: ${softStatus.message}`;
					break;
				}
				signals.push(...parseDioSignals(softResponse));
			}
			signals.sort((a, b) => a.signal - b.signal);
			this.lastDioSignals = signals;
			postDio(true, signals, softNote);
		} catch (err) {
			this.log?.appendLine(`[Dashboard][DIO] 상태 수집 실패: ${err}`);
			this.lastDioSignals = [];
			postDio(false, [], String(err));
		}
	}

	/**
	 * Set DIO 를 순서대로 보낸다. 확인 모달은 없다 — 더블클릭·우클릭 메뉴 선택이 곧 의사 표시다(2026-10-27 사용자 요청).
	 * 하나라도 실패하면 그 자리에서 멈추고 STATUS 를 보인다. 끝나면 즉시 다시 조회해 실제 상태를 그린다.
	 */
	private async forceDio(requests: Array<{ signal: unknown; value: unknown }>): Promise<void> {
		if (this.dioActionInFlight) {
			this.post({ type: 'dioAction', busy: true, message: '이전 Set DIO 를 처리하는 중입니다.' });
			return;
		}
		const commands = requests.map(request => buildSetDioCommand(request.signal, request.value));
		if (commands.length === 0 || commands.some(command => !command)) {
			this.post({ type: 'dioAction', ok: false, message: '유효하지 않은 DIO 신호 또는 동작입니다.' });
			return;
		}
		if (!isControllerSessionConnected()) {
			this.post({ type: 'dioAction', ok: false, message: '제어기에 연결되어 있지 않습니다.' });
			return;
		}
		const single = requests.length === 1;
		const first = requests[0];
		const label = single
			? `DIO ${first.signal} — ${describeDioForce(first.value as DioForceValue).label}`
			: `강제 해제 ${requests.length}개`;
		const progress = (done: number) => (single ? '' : ` (${done}/${commands.length} 완료 후 중단)`);
		this.dioActionInFlight = true;
		this.post({ type: 'dioAction', busy: true, signals: requests.map(request => request.signal as number), message: `${label} 적용 중…` });
		let done = 0;
		try {
			for (const command of commands as string[]) {
				const response = await sendCommand(command);
				this.log?.appendLine(`[DIO] >>> ${command}`);
				this.log?.appendLine(response || '(empty)');
				const status = parseStatus(response);
				if (status.code !== 0) {
					this.post({ type: 'dioAction', busy: false, ok: false, message: `${command} → STATUS ${status.code}: ${status.message}${progress(done)}` });
					return;
				}
				done++;
			}
			this.post({ type: 'dioAction', busy: false, ok: true, message: `${label} 적용됨` });
		} catch (err) {
			this.post({ type: 'dioAction', busy: false, ok: false, message: `Set DIO 실패: ${err}${progress(done)}` });
		} finally {
			this.dioActionInFlight = false;
			this.scheduleNextPoll(0);
		}
	}

	private resourceProbesEnabled(): boolean {
		return vscode.workspace.getConfiguration('gpl.controller')
			.get<boolean>('dashboardResourceProbes', DEFAULT_RESOURCE_PROBES);
	}

	/** 명령 없이 "통신 안 함" 스냅샷을 그린다(배지 OFFLINE + 사유). 자원 이력은 그대로 둔다. */
	private postDisconnected(reason: string): void {
		if (this.activePage === 'io') {
			const cfg = getControllerConfig();
			this.post({
				type: 'dio',
				dio: {
					connected: false,
					target: { ip: cfg.ip, port: cfg.port },
					timestamp: Date.now(),
					groups: [],
					absent: [],
					note: `${reason} — 제어기에 연결하면 자동 갱신을 다시 시작합니다`,
				},
			});
			return;
		}
		const empty = emptyControllerStatusSnapshot(getControllerConfig(), `${reason} — 제어기에 연결하면 자동 갱신을 다시 시작합니다`);
		this.post({ type: 'status', snapshot: { ...empty, resources: undefined }, resourceProbes: false, connectionStats: getConnectionStats() });
	}

	private post(message: DashboardMessage): void {
		if (!this.disposed) {
			void this.panel.webview.postMessage(message);
		}
	}

	private dispose(): void {
		this.pollGeneration++;
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
