/**
 * 제어기 연결 — 연결 건강 모니터 배선(2026-08-28), 유실 처리·사후 스냅샷(#22), connect/disconnect
 * (대화형 + 비대화형, GitHub #25), launch.json 생성·빠른 attach·프로젝트 지정 디버그.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { EXTENSION_VERSION, isGplDocument } from '../config';
import {
	ConnectionHealthMonitor,
	DEFAULT_CONNECTION_HEALTH_POLICY,
	ConnectionHealthPolicy,
	ConnectionHealthProber,
	HealthSnapshot,
	LossSummary,
	describeLoss,
	describeRecovering,
} from '../controller/connectionHealth';
import {
	ControllerConfig,
	clearSessionControllerOverride,
	closeControllerConnection,
	getConnectionProbeTimeoutMs,
	getConnectionRecoveryWindowMs,
	getConnectionStats,
	getControllerConfig,
	getRecentTraffic,
	probeControllerCommand,
	setDisruptiveCommandObserver,
	setHeldSocketObserver,
	setIdlePingActive,
	setIdlePingObserver,
	setSessionControllerOverride,
	testConnection,
} from '../controller/controllerConnection';
import { onDebugProbeResult } from '../controller/debugBridge';
import { DEPLOY_LOCK_DIR_NAME, describeDeployLock, getDeployLock } from '../controller/deployLock';
import { projectNameOf } from '../controller/projectPicker';
import { probeReachability } from '../controller/reachability';
import { SHOW_THREAD_LIST_CMD } from '../controller/responseParser';
import { setDashboardConnectionObserver } from '../views/controllerDashboardPanel';
import type { ExtensionHost } from './host';

export interface ConnectionApi {
	connectControllerWithArgs(args: ConnectArgs): Promise<ConnectResult>;
}

/** `gpl.controller.connect` 비대화형 인자(GitHub #25). */
export interface ConnectArgs {
	/** 생략 시 현재 값(launch.json > 세션 오버라이드 > settings) 그대로 */
	ip?: string;
	port?: number;
	/** 'session'(기본): 세션 오버라이드만 / 'settings': settings.json(Global)에 저장 */
	save?: 'session' | 'settings';
	/** true면 알림 팝업 대신 Output 로그만 남긴다 */
	silent?: boolean;
}

export interface ConnectResult {
	ok: boolean;
	ip: string;
	port: number;
	connected: boolean;
	error?: string;
	/** 'interactive' = 입력 상자 경로, 'args' = 비대화형 */
	mode: 'interactive' | 'args';
}

/**
* 연결 유실 사후 스냅샷(GitHub #22 제안 4). 제어기가 죽으면 1402가 닫혀 ErrorLog를 읽을 수 없고 재부팅하면 지워지므로,
* PC 쪽에 남은 증거 — 마지막 트래픽(1402 >>>/ | /<<< + 1403 라인 링버퍼), 1402 연결 통계, 1403 상태, 배포 잠금,
* ping TTL/arp MAC 기반 도달성 판정(직결 NIC 임대 상실 시 사무실 게이트웨이가 응답하는 함정 포함) — 를 한 파일로 묶는다.
* 파일: %TEMP%/gpl-controller/postmortem-<시각>.log. 실패해도 예외를 밖으로 내지 않는다(undefined).
*/
async function writeConnectionLostPostmortem(host: ExtensionHost, cfg: ControllerConfig, lostAt: Date, loss: LossSummary | undefined, health?: HealthSnapshot): Promise<string | undefined> {
	try {
		const recent = getRecentTraffic(400);
		const stats = getConnectionStats();
		const rc = host.currentRuntimeConsoleStatus();
		const lock = getDeployLock(cfg.ip).current()?.record;
		const reach = await probeReachability(cfg.ip, cfg.port);
		const lines: string[] = [
			`# GPL Controller 연결 유실 사후 스냅샷 — ${lostAt.toISOString()} (local ${lostAt.toLocaleString()})`,
			`target: ${cfg.ip}:${cfg.port} (1403: ${cfg.consolePort})  extension: v${EXTENSION_VERSION}  pid: ${process.pid}`,
			'',
			'## 판정: 1402 명령 채널 유실 (connectionHealth) — 제어기 런타임 상태는 이 파일만으로 확정되지 않는다',
			loss ? describeLoss(loss) : '(요약 없음)',
			loss ? JSON.stringify(loss, null, 1) : '',
			'',
			// 채널 교란 가능 명령이 앞섰는지(recovering 을 거쳤는지)는 원인 해석에 결정적이다 — 다만 인과는 미확정.
			'## 직전 관측: 채널 교란 가능 명령 (있으면. precededBy 이지 causedBy 가 아니다)',
			health?.disruptiveOperation
				? `${health.disruptiveOperation.command} (${health.disruptiveOperation.kind}) @ ${new Date(health.disruptiveOperation.at).toISOString()} — 그 명령의 실제 결과는 미확정`
				: '(없음 — 교란 가능 명령 직후가 아니었다)',
			health ? JSON.stringify(health, null, 1) : '',
			'',
			'## 도달성 (ping TTL / TCP / arp) — observations / assessment / controllerHealth 분리',
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
		host.log(`[Controller] reachability: ${reach.verdict}`);
		host.log(`[Controller] 사후 스냅샷 저장: ${file} (트래픽 ${recent.length}줄, 1402 connects=${stats.connects} reuses=${stats.reuses})`);
		return file;
	} catch (err: any) {
		host.log(`[Controller] 사후 스냅샷 저장 실패: ${err?.message ?? err}`);
		return undefined;
	}
}


export function activateConnection(host: ExtensionHost): ConnectionApi {
	const { context, outputChannel } = host;

	// ── 연결 건강 모니터 (2026-08-28, controller/connectionHealth.ts) ──────────────────────────────
	// 연결 유실 판정의 단일 출처. 프로브(트리 Show Thread 폴·디버그 어댑터 폴·재프로브) 결과와 힌트(1403 connect-failed/
	// socket-error·keep-alive 소켓 error·대시보드 프로브 실패·어댑터 실패 종료)를 받아 connected → suspect → lost 로 판정한다.
	// 힌트는 단정하지 않고 재프로브(connectionProbeTimeoutMs 기본 8 s, 1 s 간격)로 확인한다. 유실 확정 시 연결 상태를 끊고
	// 자동 재접속은 하지 않는다(사용자 결정 2026-08-28 — 재연결은 명시적 Connect).

	/** 유실 확정 처리 — 상태를 끊고 1403 정지·keep-alive 폐기·사후 스냅샷·알림(종전 onDidLoseConnection 핸들러). */
	function handleConnectionLost(summary: LossSummary): void {
		const cfg = getControllerConfig();
		const lostAt = new Date(summary.lostAt);
		// setConnected(false) 가 모니터 상태를 초기화하기 전에 스냅샷을 떠 둔다(교란 명령 관측이 사후 파일에 남게).
		const healthSnapshotAtLoss = host.healthMonitor?.snapshot();
		host.stopRuntimeConsoleAndSyncTree();
		// 'lost' 이유를 넘겨 트리가 FTP/시스템 정보 캐시를 보존하게 한다(#22 재연결 플랩 억제).
		host.setControllerConnected(false, { reason: 'lost' });
		// keep-alive 1402 소켓도 폐기 — 죽은 제어기에 stale 재시도를 쌓지 않는다(GitHub #22).
		closeControllerConnection('connection lost');
		// disconnect 명령과 동일하게 낡은 런타임 에러 컨텍스트를 정리한다.
		host.lastRuntimeErrorContext = undefined;
		host.controllerTree?.setRuntimeErrorContext(undefined);
		// 문구 원칙(2026-08-31): 확장이 "1402 명령 채널을 놓았다"는 것이 우리가 아는 사실이고, 제어기/런타임이 죽었다는
		// 것은 여러 독립 증거를 종합해야 하는 판단이다. 알림에서 후자를 단정하지 않는다.
		host.log(`[Controller] 1402 명령 채널 유실 — ${cfg.ip}:${cfg.port} @ ${lostAt.toLocaleTimeString()} — ${describeLoss(summary)} (제어기 런타임 상태는 미확정)`);
		// 사후 스냅샷(#22 제안 4): 알림은 스냅샷이 준비된 뒤 한 번만 — 파일 열기 버튼 제공.
		void writeConnectionLostPostmortem(host, cfg, lostAt, summary, healthSnapshotAtLoss).then(file => {
			const actions = file ? ['사후 스냅샷 열기', '출력 보기'] : ['출력 보기'];
			void vscode.window.showWarningMessage(
				`GPL Controller 1402 명령 채널을 놓았습니다 (${cfg.ip}) — ${summary.failures}회 연속 무응답으로 연결 상태를 해제했습니다. `
				+ '제어기가 다운됐다는 뜻은 아닙니다(런타임 상태 미확정) — 다시 Connect 해 보세요. '
				+ (file ? '마지막 트래픽·도달성 판정은 사후 스냅샷 파일에 있습니다.' : ''),
				...actions,
			).then(pick => {
				if (pick === '사후 스냅샷 열기' && file) { void vscode.window.showTextDocument(vscode.Uri.file(file), { preview: false }); }
				if (pick === '출력 보기') { outputChannel.show(true); }
			});
		});
	}

	const connectionHealthPolicy = (): ConnectionHealthPolicy => ({
		...DEFAULT_CONNECTION_HEALTH_POLICY,
		probeTimeoutMs: getConnectionProbeTimeoutMs(),
		recoveryWindowMs: getConnectionRecoveryWindowMs(),
	});
	host.healthMonitor = new ConnectionHealthMonitor(connectionHealthPolicy, {
		onSuspect: (reason, snapshot) => {
			const p = connectionHealthPolicy();
			host.log(`[Health] 연결 의심 — ${reason} → ${p.reprobeDelayMs}ms 뒤부터 Show Thread 재프로브(타임아웃 ${p.probeTimeoutMs}ms; 연속 ${p.failureThreshold}회 또는 거부/도달불가 ${p.definitiveFailureThreshold}회면 유실) · 현재 실패 ${snapshot.consecutiveFailures}회`);
			host.healthProber?.start();
		},
		onRecovering: (info, snapshot) => {
			const p = connectionHealthPolicy();
			host.log(`[Health] 채널 복구 대기 — ${describeRecovering(info)} `
				+ `→ ${p.recoveryProbeDelayMs}ms 간격 Show Thread 재프로브(이전 상태: ${info.fromState}, 실패 ${snapshot.consecutiveFailures}회는 폐기)`);
			host.healthProber?.start();
		},
		onRecovered: info => {
			const what = info.fromState === 'recovering'
				? `채널 복구 확인 — ${info.disruptiveOperation?.command ?? '(명령 미확인)'} 뒤 일시적 사용 불가였음(그 명령의 실제 결과는 여전히 미확정)`
				: '연결 복구';
			host.log(`[Health] ${what} — ${info.failuresBeforeRecovery}회 실패 뒤 응답 재확인 (${(info.durationMs / 1000).toFixed(1)} s, 사유: ${info.suspectReason})`);
		},
		onLost: summary => handleConnectionLost(summary),
	});
	host.healthProber = new ConnectionHealthProber(host.healthMonitor, timeoutMs => probeControllerCommand(SHOW_THREAD_LIST_CMD, undefined, timeoutMs));
	context.subscriptions.push({
		dispose: () => {
			host.healthProber?.stop();
			host.healthProber = undefined;
			host.healthMonitor = undefined;
			setHeldSocketObserver(null);
			setDashboardConnectionObserver(undefined);
		},
	});

	// 프로브 공급자: 트리 폴(비디버그) + 디버그 어댑터 폴(디버그 중 — 트리 폴링은 꺼짐)
	context.subscriptions.push(
		host.controllerTree.onDidProbe(outcome => { host.healthMonitor?.reportProbe(outcome); }),
		onDebugProbeResult(outcome => { host.healthMonitor?.reportProbe(outcome); }),
	);
	// 1402 유휴 ping(§1-BM) 결과도 프로브다 — 트리/대시보드가 닫혀 폴이 없는 유휴 상태에서도 5 s 주기로 끊김이 드러난다.
	setIdlePingObserver(outcome => { host.healthMonitor?.reportProbe(outcome); });
	context.subscriptions.push({ dispose: () => { setIdlePingObserver(null); setIdlePingActive(false); } });
	// 채널 교란 가능 명령(Unload/Load/Compile/Start)이 응답 없이 끝나면 recovering 으로 흡수한다(2026-08-31).
	// 설정 connectionRecoveryWindowMs=0 이면 종전 판정(교란 뒤 거부 2회 → 유실)으로 되돌아간다.
	setDisruptiveCommandObserver(failure => {
		if (getConnectionRecoveryWindowMs() <= 0) { return; }
		host.healthMonitor?.noteDisruptiveTimeout({ command: failure.command, kind: failure.kind, detail: failure.detail, at: failure.at });
	});
	context.subscriptions.push({ dispose: () => setDisruptiveCommandObserver(null) });
	// 힌트 공급자: keep-alive 보관 소켓 오류 / 대시보드 프로브 실패 (1403 은 ensureRuntimeConsole 의 상태 구독에서)
	setHeldSocketObserver(event => {
		// FIN(by-peer)은 제어기의 정상 유휴 종료일 수 있어 힌트로 쓰지 않는다 — error(ECONNRESET·keepalive ETIMEDOUT)만.
		if (event.kind === 'error') {
			host.healthMonitor?.reportHint('keep-alive-socket', `${event.detail} (held ${Math.round(event.heldMs / 1000)}s)`);
		}
	});
	setDashboardConnectionObserver((connected, note) => {
		if (!connected) { host.healthMonitor?.reportHint('dashboard', note ?? 'Show Thread 응답 없음'); }
	});
	// ── Controller commands ──────────────────────────────────

	// ── 제어기 연결: 대화형 + 비대화형 (GitHub #25) ──────────────────────────
	// 인자 없이 부르면(트리/상태바/팔레트) 종전과 같은 대화형 흐름(IP 입력 상자 → 저장 여부 QuickPick)이고,
	// ConnectArgs 객체가 오면 UI 없이 연결을 시도해 결과를 반환값으로 돌려준다(AI 계층·URI 핸들러·다른 확장 진입점용).
	const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

	function isConnectArgs(v: unknown): v is ConnectArgs {
		if (!v || typeof v !== 'object') { return false; }
		const a = v as Record<string, unknown>;
		return 'ip' in a || 'port' in a || 'save' in a || 'silent' in a;
	}

	/** IP/port 확정 뒤 공통 절차: 프로젝트 컨텍스트 → testConnection(ErrorLog 1회) → 상태 반영 → 1403 자동 시작. */
	async function finishConnect(mode: ConnectResult['mode'], silent: boolean): Promise<ConnectResult> {
		const expected = await host.project.resolveExpectedProjectName();
		const projectContext = await host.project.detectWorkspaceProjectContext();
		host.controllerTree?.setExpectedProjectContext(projectContext.projectName || expected, projectContext.folderName || expected);
		const cfg = getControllerConfig();
		host.log(`[Controller] Connecting to ${cfg.ip}:${cfg.port} …${mode === 'args' ? ' (non-interactive)' : ''}`);
		try {
			const ok = await testConnection(cfg);
			if (ok) {
				host.log(`[Controller] Connected: ${cfg.ip}:${cfg.port}`);
				if (!silent) { vscode.window.showInformationMessage(`GPL Controller 연결 성공: ${cfg.ip}`); }
				host.setControllerConnected(true);
				// controller 연결 성공 시 1403도 바로 유지 연결한다.
				try { host.ensureRuntimeConsole(); } catch (err: any) {
					host.log(`[Console] auto-start on connect failed: ${err?.message ?? err}`);
				}
				return { ok: true, ip: cfg.ip, port: cfg.port, connected: true, mode };
			}
			host.log(`[Controller] Connection failed: ${cfg.ip}:${cfg.port} (ErrorLog 프로브에 <STATUS> 없음)`);
			if (!silent) { vscode.window.showErrorMessage(`GPL Controller 연결 실패: ${cfg.ip}`); }
			host.setControllerConnected(false);
			return { ok: false, ip: cfg.ip, port: cfg.port, connected: false, error: 'probe-failed', mode };
		} catch (err: any) {
			const detail = err?.message ?? String(err);
			host.log(`[Controller] Connection error: ${detail}`);
			if (!silent) { vscode.window.showErrorMessage(`연결 오류: ${detail}`); }
			host.setControllerConnected(false);
			return { ok: false, ip: cfg.ip, port: cfg.port, connected: false, error: detail, mode };
		}
	}

	/** 비대화형 연결(GitHub #25 A). ip 생략 시 launch.json > 세션 오버라이드 > settings 순의 현재 값을 쓴다. */
	async function connectControllerWithArgs(args: ConnectArgs): Promise<ConnectResult> {
		const currentCfg = getControllerConfig();
		const launchInfo = host.project.readLaunchControllerInfo();
		const ip = String(args.ip ?? launchInfo?.ip ?? currentCfg.ip).trim();
		const port = args.port ?? (args.ip ? currentCfg.port : (launchInfo?.port ?? currentCfg.port));
		if (!IPV4_RE.test(ip)) {
			host.log(`[Controller] connect 거부 — 잘못된 IP: ${ip}`);
			return { ok: false, ip, port, connected: false, error: 'invalid-ip', mode: 'args' };
		}
		if (!Number.isInteger(port) || port <= 0 || port > 65535) {
			host.log(`[Controller] connect 거부 — 잘못된 port: ${port}`);
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
		const launchInfo = host.project.readLaunchControllerInfo();
		const cancelled = (): ConnectResult => ({
			ok: false, ip: currentCfg.ip, port: currentCfg.port,
			connected: host.controllerTree?.isConnected ?? false, error: 'cancelled', mode: 'interactive',
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
				host.project.scheduleExpectedProjectSync('active GPL document changed');
			}
		}),
		vscode.workspace.onDidChangeWorkspaceFolders(() => {
			host.project.scheduleExpectedProjectSync('workspace folders changed');
		}),
		vscode.workspace.onDidSaveTextDocument((doc) => {
			if (isGplDocument(doc)) {
				host.project.scheduleExpectedProjectSync('GPL document saved');
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.debug.generateLaunch', async () => {
			const launchPath = await host.project.createOrUpdateLaunchJson();
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
			const projectName = await host.project.resolveExpectedProjectName();
			const launchInfo = host.project.readLaunchControllerInfo();

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

	// gpl.debugProject — 프로젝트를 지정해 Deploy(Upload ∥ Stop → Compile) 후 attach.
	// 탐색기 우클릭(Uri)이면 그 프로젝트, 팔레트면 QuickPick(공용 규칙). launch.json 없이도 동작하며
	// 중복 세션 처리와 projectName 보정은 DebugConfigurationProvider.resolveDebugConfiguration이 맡는다.
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.debugProject', async (resource?: unknown) => {
			const projectDir = await host.deploy.pickWorkspaceProjectDir('디버그할 프로젝트를 선택하세요', resource);
			if (!projectDir) { return; }
			const projectName = projectNameOf(projectDir);
			const cfg = getControllerConfig();
			const launchInfo = host.project.readLaunchControllerInfo();
			const dynamicConfig: vscode.DebugConfiguration = {
				type: 'brooks-gpl',
				request: 'attach',
				name: `GPL Debug (${projectName})`,
				controllerIp: launchInfo?.ip || cfg.ip,
				controllerPort: launchInfo?.port || cfg.port,
				projectName,
				projectDir,
				deployBeforeAttach: true,
				stopOnEntry: false,
			};
			const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(projectDir));
			const started = await vscode.debug.startDebugging(folder, dynamicConfig);
			if (!started) {
				vscode.window.showErrorMessage(`디버깅 시작 실패 (${projectName}): 구성 또는 제어기 상태를 확인하세요.`);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.disconnect', (args?: unknown) => {
			// 싱글톤 인스턴스는 보존하고 연결만 끊는다 (v0.5.48 일관성).
			// 반환값·silent 인자는 AI/URI 진입점용(GitHub #25) — 사람이 누를 때(인자 없음)는 종전과 동일하게 알림을 띄운다.
			const silent = !!args && typeof args === 'object' && (args as { silent?: boolean }).silent === true;
			const cfg = getControllerConfig();
			host.stopRuntimeConsoleAndSyncTree();
			closeControllerConnection('disconnect');
			clearSessionControllerOverride();
			host.setControllerConnected(false);
			host.lastRuntimeErrorContext = undefined;
			host.controllerTree?.setRuntimeErrorContext(undefined);
			host.log(`[Controller] Disconnected: ${cfg.ip}:${cfg.port}${silent ? ' (silent)' : ''}`);
			if (!silent) { vscode.window.showInformationMessage('GPL Controller 연결 해제'); }
			return { ok: true, connected: false, ip: cfg.ip, port: cfg.port };
		})
	);

	return { connectControllerWithArgs };
}
