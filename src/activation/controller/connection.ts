/**
 * 제어기 연결 — 연결 건강 모니터 배선(2026-08-28), 유실 처리·사후 스냅샷(#22), connect/disconnect
 * (대화형 + 비대화형, GitHub #25), launch.json 생성·빠른 attach·프로젝트 지정 디버그.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { EXTENSION_VERSION, isGplDocument } from '../../config';
import { ciEq } from '../../language/syntax/identifiers';
import { readGprIdentityInDir } from '../../project/sources/compileUnitTarget';
import {
	ConnectionHealthMonitor,
	DEFAULT_CONNECTION_HEALTH_POLICY,
	ConnectionHealthPolicy,
	ConnectionHealthProber,
	HealthSnapshot,
	LossSummary,
	describeLoss,
	describeRecovering,
	recoveryGuidanceForLoss,
} from '../../controller/connection/connectionHealth';
import {
	ControllerConfig,
	clearSessionControllerOverride,
	closeControllerConnection,
	getConnectionProbeTimeoutMs,
	getConnectionRecoveryWindowMs,
	getConnectionStats,
	getControllerConfig,
	getRecentStateChangingCommands,
	getRecentTraffic,
	getSessionControllerOverride,
	noteCommandChannelLoss,
	probeControllerCommand,
	saveControllerIpSetting,
	sendCommand,
	setDisruptiveCommandObserver,
	setHeldSocketObserver,
	setIdlePingActive,
	setIdlePingObserver,
	setLastConnectedIp,
	setSessionControllerOverride,
	setThreadStateCommandObserver,
	testConnection,
} from '../../controller/connection/controllerConnection';
import { onDebugProbeResult } from '../../controller/debugging/debugBridge';
import { DEPLOY_LOCK_DIR_NAME, describeDeployLock, getDeployLock } from '../../controller/deployment/deployLock';
import { buildTargetCandidates, projectNameOf } from '../../controller/projects/projectPicker';
import { listRemoteDir } from '../../controller/files/ftpClient';
import { clearUnloadRisk, judgeRebootEvidence, noteChannelLoss } from '../../controller/commands/unloadRisk';
import { readUnloadRiskState, updateUnloadRiskState } from '../../controller/commands/unloadRiskStore';
import { setProjectKindResolver, setUnloadRiskLogger, unloadFailureGuidance } from '../../controller/commands/unloadRiskGuard';
import { probeReachability } from '../../controller/connection/reachability';
import { EventLoopStallMonitor, describeStall, stallOverlapMs, stallsWithin } from '../../controller/connection/eventLoopStall';
import type { EventLoopStall } from '../../controller/connection/eventLoopStall';
import { commandsBefore, describeRecentCommand, PRECEDING_COMMAND_WINDOW_MS } from '../../controller/connection/recentCommands';
import type { RecentCommandRecord } from '../../controller/connection/recentCommands';
import { PC_POWER_LOOKBACK_MINUTES, describePcResume, matchPcResume, readPcPowerEvents } from '../../controller/connection/pcPowerEvents';
import type { PcPowerEvent, PcResumeMatch } from '../../controller/connection/pcPowerEvents';
import { RECONNECT_ACTION, composeLossNotice } from '../../controller/connection/lossNotice';
import { SHOW_THREAD_LIST_CMD } from '../../controller/protocol/responseParser';
import {
	describeHardwareId, describeIdentityMismatch, evaluateExpectedSerial, readControllerHardwareId,
} from '../../controller/connection/controllerHardwareId';
import { setDashboardConnectionObserver } from '../../views/dashboard/controllerDashboardPanel';
import type { ExtensionHost } from '../host';

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
	/** 원격 소스 Attach의 최초 연결에서는 기존 에디터 BP를 제어기에 동기화하지 않는다. */
	preserveBreakpoints?: boolean;
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
/** 이 세션에서 이미 알린 서브넷 겹침 경고(한 번만 알린다). */
const warnedSubnetOverlaps = new Set<string>();

/** 유실 판정 소요 중 확장 호스트 정지가 이만큼 이상이면 로그·알림에 그 사실을 밝힌다. */
const STALL_NOTE_MIN_MS = 5000;
/** 사후 스냅샷에 남길 이벤트 루프 정지의 범위(유실 시각 기준 과거). */
const POSTMORTEM_STALL_WINDOW_MS = 10 * 60_000;

/** 유실 정황(2026-11-03) — 의심 전 상태 변경 명령과 PC 절전/복귀 기록. 절전 조회는 수 초 걸려 Promise 로 받는다. */
interface LossContext {
	preceding: readonly RecentCommandRecord[];
	powerEvents: Promise<PcPowerEvent[]>;
	resume: Promise<PcResumeMatch | undefined>;
}

const isoClock = (ms: number) => new Date(ms).toISOString();
const localClock = (ms: number) => new Date(ms).toLocaleTimeString();

async function writeConnectionLostPostmortem(host: ExtensionHost, cfg: ControllerConfig, lostAt: Date, loss: LossSummary | undefined, health?: HealthSnapshot, stalls: readonly EventLoopStall[] = [], lossContext?: LossContext): Promise<string | undefined> {
	try {
		const recent = getRecentTraffic(400);
		const stats = getConnectionStats();
		const rc = host.currentRuntimeConsoleStatus();
		const lock = getDeployLock(cfg.ip).current()?.record;
		// 명령 콘솔이 거부되면 FTP 배너·런타임 콘솔도 본다(핸드셰이크만). 직전 교란 명령은 재부팅 후보 확신도의 근거다.
		const prior = health?.disruptiveOperation;
		const [reach, powerEvents, resume] = await Promise.all([
			probeReachability(cfg.ip, cfg.port, undefined, {
				runtimeConsolePort: cfg.consolePort,
				...(prior ? { priorDisruptive: { command: prior.command, kind: prior.kind, at: prior.at } } : {}),
			}),
			lossContext?.powerEvents ?? Promise.resolve([]),
			lossContext?.resume ?? Promise.resolve(undefined),
		]);
		const suspectAt = loss?.suspectSince ?? lostAt.getTime();
		const overlap = reach.assessment.observations.subnetOverlap;
		if (overlap && !warnedSubnetOverlaps.has(overlap)) {
			// 같은 경고를 유실마다 반복하지 않는다(세션 한 번) — 구성 문제라 한 번 알면 충분하다.
			warnedSubnetOverlaps.add(overlap);
			host.log(`[Controller] ⚠ 네트워크 구성: ${overlap}`);
		}
		const lines: string[] = [
			`# GPL Controller 연결 유실 사후 스냅샷 — ${lostAt.toISOString()} (local ${lostAt.toLocaleString()})`,
			`target: 명령 콘솔 ${cfg.ip}:${cfg.port} · 런타임 콘솔 ${cfg.consolePort}  extension: v${EXTENSION_VERSION}  pid: ${process.pid}`,
			'',
			'## 판정: 명령 콘솔 채널 유실 (connectionHealth) — 제어기 런타임 상태는 이 파일만으로 확정되지 않는다',
			loss ? describeLoss(loss) : '(요약 없음)',
			...(resume ? [`계기: ${describePcResume(resume, isoClock)} 직후 — PC 가 자는 동안 직결 네트워크가 내려간 것으로, 제어기 문제로 보지 않는다(아래 PC 절전/복귀 절)`] : []),
			loss ? JSON.stringify(loss, null, 1) : '',
			'',
			// 채널 교란 가능 명령이 앞섰는지(recovering 을 거쳤는지)는 원인 해석에 결정적이다 — 다만 인과는 미확정.
			'## 직전 관측: 채널 교란 가능 명령 (있으면. precededBy 이지 causedBy 가 아니다)',
			health?.disruptiveOperation
				? `${health.disruptiveOperation.command} (${health.disruptiveOperation.kind}) @ ${new Date(health.disruptiveOperation.at).toISOString()} — 그 명령의 실제 결과는 미확정`
				: '(없음 — 응답 없이 끝난 교란 가능 명령은 없었다. 정상 응답한 명령은 아래 절)',
			health ? JSON.stringify(health, null, 1) : '',
			'',
			// 정상 응답한 명령도 시간 관계로는 원인 해석에 필요하다(2026-11-03 — Stop -all·Start·Execute 뒤 2분 안 유실 8건이 "없음"으로 찍혔다).
			`## 직전 상태 변경 명령 (의심 전 ${PRECEDING_COMMAND_WINDOW_MS / 60_000}분 — 시간 관계일 뿐 인과는 미확정)`,
			...(lossContext && lossContext.preceding.length > 0
				? lossContext.preceding.map(r => `- ${isoClock(r.at)} ${describeRecentCommand(r, suspectAt)}`)
				: ['(없음)']),
			'',
			// 절전 중 직결 NIC 가 내려가 깨어나는 순간 끊긴 사례가 5건(2026-11-03, Kernel-Power 507 과 초 단위 일치) — 제어기 무관.
			`## PC 절전/복귀 (Windows 이벤트 로그, 최근 ${PC_POWER_LOOKBACK_MINUTES}분)`,
			resume ? `유실과 맞물림: ${describePcResume(resume, isoClock)} (${resume.resumeSource})` : '(유실과 맞물린 절전 복귀 없음)',
			...powerEvents.map(e => `- ${isoClock(e.at)} ${e.kind === 'sleep' ? '절전 진입' : '절전 복귀'} (${e.source})`),
			'',
			// 판정 지연이 규칙 때문인지, 확장 호스트가 멈춰 타이머·소켓 처리가 밀렸기 때문인지 가른다(2026-10-27 — 10건 중 3건이 후자).
			'## 확장 호스트 이벤트 루프 정지 (최근 10분, 2 s 이상 — VS Code 확장 호스트는 모든 확장이 함께 쓴다)',
			...(stalls.length > 0 ? stalls.map(s => `- ${describeStall(s, ms => new Date(ms).toISOString())}`) : ['(없음)']),
			'',
			'## 도달성 (ping TTL / TCP / arp) — observations / assessment / controllerHealth 분리',
			`verdict: ${reach.verdict}`,
			JSON.stringify(reach, null, 1),
			'',
			'## 명령 콘솔 연결 통계 (keep-alive)',
			JSON.stringify(stats, null, 1),
			'',
			'## 런타임 콘솔 상태',
			JSON.stringify(rc, null, 1),
			'',
			`## 배포 잠금: ${lock ? describeDeployLock(lock) : '(없음)'}`,
			'',
			`## 최근 트래픽 (마지막 ${recent.length}줄 — 명령 콘솔 >>>/ | /<<< 및 런타임 콘솔 라인, 오래된 순)`,
			...recent,
			'',
		];
		const dir = path.join(os.tmpdir(), DEPLOY_LOCK_DIR_NAME);
		fs.mkdirSync(dir, { recursive: true });
		const stamp = lostAt.toISOString().replace(/[:.]/g, '-');
		const file = path.join(dir, `postmortem-${stamp}.log`);
		fs.writeFileSync(file, lines.join('\n'), 'utf8');
		host.log(`[Controller] reachability: ${reach.verdict}`);
		host.log(`[Controller] 사후 스냅샷 저장: ${file} (트래픽 ${recent.length}줄, 명령 콘솔 connects=${stats.connects} reuses=${stats.reuses})`);
		return file;
	} catch (err: any) {
		host.log(`[Controller] 사후 스냅샷 저장 실패: ${err?.message ?? err}`);
		return undefined;
	}
}


// ── 디버그 세션 종료 (연결 해제 전 선행 단계) ────────────────────────────────
/**
 * 어댑터가 종료 과정에서 보내는 1402 명령(등록 BP 수만큼의 `Nobreak` + 구성에 따라 `Stop -all` 정착 확인)이
 * 끝나기를 기다리는 상한. 넘겨도 실패로 보지 않고 로그만 남기고 진행한다 — `closeControllerConnection()` 은
 * in-flight 명령을 중단하지 않으므로 먼저 진행해도 응답은 정상적으로 회수된다.
 */
const DEBUG_SESSION_STOP_TIMEOUT_MS = 15000;

/**
 * `brooks-gpl` 디버그 세션을 끝내고 **실제 종료(terminated 이벤트)까지** 기다린다.
 *
 * 왜 기다리는가: `vscode.debug.stopDebugging()` 은 요청 전달까지만 보장한다. 기다리지 않고 소켓을 닫으면
 * 어댑터의 종료 명령(`Nobreak`·`Stop -all`)이 곧바로 새 1402 연결을 열어 "해제했는데 포트가 다시 잡히는"
 * 상태가 된다.
 */
async function stopDebugSessionAndWait(
	session: vscode.DebugSession,
	timeoutMs: number,
): Promise<'terminated' | 'timeout' | 'failed'> {
	let sub: vscode.Disposable | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		// 구독을 먼저 걸어 stopDebugging 과 종료 이벤트 사이의 경합을 없앤다.
		const terminated = new Promise<'terminated'>(resolve => {
			sub = vscode.debug.onDidTerminateDebugSession(s => {
				if (s.id === session.id) { resolve('terminated'); }
			});
		});
		const timedOut = new Promise<'timeout'>(resolve => {
			timer = setTimeout(() => resolve('timeout'), timeoutMs);
		});
		try {
			await vscode.debug.stopDebugging(session);
		} catch {
			// 이미 사라진 세션 등 — 종료 이벤트를 기다려 봐야 오지 않으므로 바로 돌려준다(해제는 계속한다).
			return 'failed';
		}
		return await Promise.race([terminated, timedOut]);
	} finally {
		sub?.dispose();
		if (timer) { clearTimeout(timer); }
	}
}

/** 이 워크스페이스에서 마지막으로 연결에 성공한 제어기 IP — workspaceState 키(controller/connection/ipSource.ts 해석 순서). */
const LAST_CONNECTED_IP_KEY = 'gpl.controller.lastConnectedIp';

export function activateConnection(host: ExtensionHost): ConnectionApi {
	const { context, outputChannel } = host;

	// ── 제어기 IP 의 워크스페이스별 기억 (2026-11-13, inbox 11-05 #2) ────────────────────────────────
	// 워크스페이스 파일을 만들지 않고 workspaceState 에 둔다. 해석 순서는 ipSource.resolveControllerIp.
	setLastConnectedIp(context.workspaceState.get<string>(LAST_CONNECTED_IP_KEY));
	/** IP 를 기억한다(메모리 + workspaceState). 상태바가 곧바로 다시 그려지도록 호출측이 연결 상태 갱신과 함께 부른다. */
	const rememberControllerIp = (ip: string): void => {
		setLastConnectedIp(ip);
		void context.workspaceState.update(LAST_CONNECTED_IP_KEY, ip);
	};

	// ── 그룹 Compile 뒤 Unload 위험 (controller/commands/unloadRisk.ts) ─────────────────────────────
	// 그룹 판정(ProjectStart 유무)은 워크스페이스 .gpr 로 한다. 제어기 명령 인자는 .gpr ProjectName 이지만 배포가 폴더명 후보로
	// 컴파일하기도 하므로 둘 다 본다. 같은 이름이 여러 과제 폴더에 있으면 하나라도 실행 가능하면 실행 가능으로 본다(그룹으로
	// 단정하지 않는다). 워크스페이스에 없는 이름은 모름(표시·Start 거부 없음).
	setUnloadRiskLogger(line => host.log(line));
	setProjectKindResolver({
		lookup: async name => {
			const key = name.trim().toLowerCase();
			const candidates = await buildTargetCandidates();
			const byName = candidates.filter(c => c.projectName.trim().toLowerCase() === key);
			const same = byName.length > 0 ? byName : candidates.filter(c => path.basename(c.dir).trim().toLowerCase() === key);
			return same.length === 0 ? undefined : { runnable: same.some(c => c.runnable) };
		},
		runnableProjects: async () => [...new Set((await buildTargetCandidates()).filter(c => c.runnable).map(c => c.projectName))],
	});
	context.subscriptions.push({ dispose: () => { setProjectKindResolver(undefined); setUnloadRiskLogger(undefined); } });

	/**
	 * 재부팅 근거 확인 — 표시 뒤 명령 콘솔 유실이 있었고 재연결 뒤 /GPL 에 그룹 폴더가 없으면 위험 표시를 지운다.
	 * 근거가 모자라면 그대로 둔다(판정: unloadRisk.judgeRebootEvidence). 배포 중이면 FTP 를 더 열지 않는다.
	 */
	async function checkUnloadRiskRebootEvidence(trigger: string): Promise<void> {
		try {
			const cfg = getControllerConfig();
			const state = readUnloadRiskState(cfg.ip);
			if (!state || state.marks.length === 0 || state.channelLossAt === undefined) { return; }
			if (host.currentDeployLockHolder()) { return; }
			let names: string[] | null;
			try {
				names = (await listRemoteDir(cfg.ip, cfg.ftpBasePath)).map(e => e.name);
			} catch {
				names = null;
			}
			const judgement = judgeRebootEvidence(state, names);
			host.log(`[UnloadRisk] ${trigger}: ${judgement.detail}`);
			if (judgement.rebooted) {
				updateUnloadRiskState(cfg.ip, s => clearUnloadRisk(s, Date.now(), judgement.reason));
				host.log('[UnloadRisk] 그룹 Compile 뒤 Unload 위험 표시를 해제했습니다(재부팅 근거).');
			}
		} catch (err: any) {
			host.log(`[UnloadRisk] 재부팅 근거 확인 실패(표시 유지): ${err?.message ?? err}`);
		}
	}

	/**
	 * 연결 직후 제어기 정체(serial 110·ID 114·이름 109·모델 101)를 읽어 Output 에 남기고, 설정 `gpl.controller.expectedSerial` 과
	 * 다르면 비모달 경고를 띄운다(포커스를 뺏지 않는다). 읽기 전용 pd 4건, 실패는 로그만 남기고 연결에 영향 없음.
	 * 같은 IP 에 다른 제어기가 붙는 사고(2026-11-06 보고)를 사람이 알아채게 하려는 것이다.
	 */
	async function checkControllerIdentity(cfg: ControllerConfig): Promise<void> {
		try {
			const id = await readControllerHardwareId(command => sendCommand(command, cfg, getConnectionProbeTimeoutMs()).catch(() => null));
			host.log(`[Controller] Identity ${cfg.ip}: ${id ? describeHardwareId(id) : '읽지 못했습니다(pd 110·114·109·101)'}`);
			const expected = vscode.workspace.getConfiguration('gpl.controller', vscode.workspace.workspaceFolders?.[0]?.uri).get<unknown>('expectedSerial');
			const mismatch = evaluateExpectedSerial(id, expected);
			if (mismatch) {
				const message = describeIdentityMismatch(mismatch, cfg.ip);
				host.log(`[Controller] WARNING ${message}`);
				void vscode.window.showWarningMessage(message);
			}
		} catch (err: any) {
			host.log(`[Controller] Identity 확인 실패(연결은 유지): ${err?.message ?? err}`);
		}
	}

	// ── 연결 건강 모니터 (2026-08-28, controller/connection/connectionHealth.ts) ──────────────────────────────
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
		// 유실 정황(2026-11-03): 의심 전 상태 변경 명령은 지금 떠 두고(이후 명령이 섞이지 않게), 절전 기록 조회(약 4 s)는 바로 시작한다.
		const preceding = commandsBefore(getRecentStateChangingCommands(), summary.suspectSince);
		const powerEvents = readPcPowerEvents().catch(() => [] as PcPowerEvent[]);
		const resume = powerEvents.then(events => matchPcResume(events, summary.suspectSince));
		// 위험 표시가 있으면 유실 시각을 남긴다 — 재연결 뒤 재부팅 판정의 전제다(unloadRisk.judgeRebootEvidence).
		updateUnloadRiskState(cfg.ip, s => noteChannelLoss(s, summary.lostAt));
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
		host.log(`[Controller] 명령 콘솔 채널 유실 — ${cfg.ip}:${cfg.port} @ ${lostAt.toLocaleTimeString()} — ${describeLoss(summary)} (제어기 런타임 상태는 미확정)`);
		// 판정 소요 중 확장 호스트가 멈춰 있던 시간 — 첫 실패 프로브가 시작된 시점(의심 진입 - 프로브 타임아웃)부터 센다.
		const judgedFrom = summary.suspectSince - getConnectionProbeTimeoutMs();
		const stalledMs = stallOverlapMs(stallMonitor.recent(), judgedFrom, summary.lostAt);
		const stallNote = stalledMs >= STALL_NOTE_MIN_MS
			? `판정이 늦어진 ${(stalledMs / 1000).toFixed(0)} s 는 VS Code 확장 호스트가 멈춰 있던 시간입니다(이 확장 밖의 원인일 수 있음 — 사후 스냅샷의 이벤트 루프 정지 절).`
			: undefined;
		if (stallNote) { host.log(`[Health] ${stallNote}`); }
		if (preceding.length > 0) {
			host.log(`[Controller] 의심 전 상태 변경 명령(시간 관계일 뿐 인과 미확정): ${preceding.map(r => describeRecentCommand(r, summary.suspectSince)).join(' · ')}`);
		}
		// 업로드 전 정체 확인·재부팅 정황 안내(/GPL 이 비었을 때)가 이 시각을 쓴다.
		noteCommandChannelLoss(cfg.ip, summary.lostAt);
		// 복구 대기 창(기본 180 s)이 지나도 거부로 끝났으면 실측 조치(PC 어댑터 재연결)를 안내한다(2026-10-22 두 번 실측).
		const guidance = recoveryGuidanceForLoss(summary);
		if (guidance) { host.log(`[Controller] ${guidance}`); }
		// 사후 스냅샷(#22 제안 4): 알림은 스냅샷이 준비된 뒤 한 번만 — 파일 열기 버튼 제공.
		const recentStalls = stallsWithin(stallMonitor.recent(), summary.lostAt - POSTMORTEM_STALL_WINDOW_MS, summary.lostAt);
		void Promise.all([
			writeConnectionLostPostmortem(host, cfg, lostAt, summary, healthSnapshotAtLoss, recentStalls, { preceding, powerEvents, resume }),
			resume,
		]).then(([file, resumeMatch]) => {
			if (resumeMatch) {
				host.log(`[Controller] 계기: ${describePcResume(resumeMatch, localClock)} 직후 — PC 가 자는 동안 직결 네트워크가 내려간 것으로, 제어기 문제로 보지 않습니다(${resumeMatch.resumeSource}).`);
			}
			const actions = file ? [RECONNECT_ACTION, '사후 스냅샷 열기', '출력 보기'] : [RECONNECT_ACTION, '출력 보기'];
			void vscode.window.showWarningMessage(
				composeLossNotice({
					ip: cfg.ip, failures: summary.failures, guidance, stallNote, resume: resumeMatch,
					hasPostmortem: file !== undefined, clock: localClock,
				}),
				...actions,
			).then(pick => {
				// 자동 재접속은 하지 않는다(2026-08-28 결정) — 버튼은 사용자의 명시적 Connect 다. 유실 당시 설정 그대로 다시 붙는다.
				if (pick === RECONNECT_ACTION && !host.isControllerConnected) { void finishConnect('interactive', false); }
				if (pick === '사후 스냅샷 열기' && file) { void vscode.window.showTextDocument(vscode.Uri.file(file), { preview: false }); }
				if (pick === '출력 보기') { outputChannel.show(true); }
			});
		});
	}

	// 확장 호스트 이벤트 루프 정지 감지(controller/connection/eventLoopStall.ts) — 판정을 바꾸지 않고 관측만 남긴다.
	// 연결 중일 때만 Output 에 남긴다(그 밖의 정지는 이 확장의 판정과 무관하다). 기록은 유실 로그·사후 스냅샷이 쓴다.
	const stallMonitor = new EventLoopStallMonitor({
		onStall: stall => {
			if (!host.isControllerConnected) { return; }
			host.log(`[Health] 확장 호스트 이벤트 루프 정지 ${describeStall(stall)} — 이 사이 프로브·재연결 타이머와 소켓 처리가 밀립니다`
				+ '(VS Code 확장 호스트는 모든 확장이 함께 씀 — 원인이 이 확장 밖일 수 있음)');
		},
	});
	stallMonitor.start();
	context.subscriptions.push({ dispose: () => stallMonitor.stop() });

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
			host.statusBar?.refreshHealth();
		},
		onRecovering: (info, snapshot) => {
			const p = connectionHealthPolicy();
			host.log(`[Health] 채널 복구 대기 — ${describeRecovering(info)} `
				+ `→ ${p.recoveryProbeDelayMs}ms 간격 Show Thread 재프로브(이전 상태: ${info.fromState}, 실패 ${snapshot.consecutiveFailures}회는 폐기)`);
			host.healthProber?.start();
			host.statusBar?.refreshHealth();
		},
		onRecovered: info => {
			const what = info.fromState === 'recovering'
				? `채널 복구 확인 — ${info.disruptiveOperation?.command ?? '(명령 미확인)'} 뒤 일시적 사용 불가였음(그 명령의 실제 결과는 여전히 미확정)`
				: '연결 복구';
			host.log(`[Health] ${what} — ${info.failuresBeforeRecovery}회 실패 뒤 응답 재확인 (${(info.durationMs / 1000).toFixed(1)} s, 사유: ${info.suspectReason})`);
			host.statusBar?.refreshHealth();
			void checkUnloadRiskRebootEvidence('채널 복구');
		},
		onLost: summary => handleConnectionLost(summary),
	});
	// 상태바 연결 항목이 suspect/recovering 을 첫 신호부터 보인다(종전: 유실 확정까지 정상 표시).
	host.statusBar?.setHealthSource(() => host.healthMonitor
		? { snapshot: host.healthMonitor.snapshot(), policy: connectionHealthPolicy() }
		: undefined);
	host.healthProber = new ConnectionHealthProber(host.healthMonitor, timeoutMs => probeControllerCommand(SHOW_THREAD_LIST_CMD, undefined, timeoutMs));
	context.subscriptions.push({
		dispose: () => {
			host.healthProber?.stop();
			host.healthProber = undefined;
			host.healthMonitor = undefined;
			host.statusBar?.setHealthSource(undefined);
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
	// 그룹 Compile 뒤의 Unload 가 응답 없이 끝났으면 복구 대기(최대 180 s)만 안내하지 말고 바로 알린다 — 이 조합은
	// 지금까지 재부팅이 필요했다(inbox unload-guard-request ③). 안내만 하고 판정·상태는 바꾸지 않는다.
	const announceUnloadRisk = (command: string): void => {
		const guidance = unloadFailureGuidance(command, getControllerConfig().ip);
		if (!guidance) { return; }
		host.log(`[UnloadRisk] ${guidance}`);
		void vscode.window.showWarningMessage(guidance, '출력 보기').then(pick => { if (pick === '출력 보기') { outputChannel.show(true); } });
	};
	setDisruptiveCommandObserver(failure => {
		announceUnloadRisk(failure.command);
		if (getConnectionRecoveryWindowMs() <= 0) { return; }
		host.healthMonitor?.noteDisruptiveTimeout({ command: failure.command, kind: failure.kind, detail: failure.detail, at: failure.at });
	});
	context.subscriptions.push({ dispose: () => setDisruptiveCommandObserver(null) });
	// 쓰레드를 움직이는 명령(Start·Stop·Execute 등)의 응답 → 트리가 전이가 끝날 때까지 짧은 간격으로 다시 조회(2026-11-04).
	setThreadStateCommandObserver(command => { host.controllerTree?.requestThreadRefresh(`${command} 뒤`, 'burst'); });
	context.subscriptions.push({ dispose: () => setThreadStateCommandObserver(null) });
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
	async function finishConnect(mode: ConnectResult['mode'], silent: boolean, preserveBreakpoints = false): Promise<ConnectResult> {
		const expected = await host.project.resolveExpectedProjectName();
		const projectContext = await host.project.detectWorkspaceProjectContext();
		host.controllerTree?.setExpectedProjectContext(projectContext.projectName || expected, projectContext.folderName || expected);
		const cfg = getControllerConfig();
		host.log(`[Controller] Connecting to ${cfg.ip}:${cfg.port} …${mode === 'args' ? ' (non-interactive)' : ''}`);
		try {
			const ok = await testConnection(cfg);
			if (ok) {
				host.log(`[Controller] Connected: ${cfg.ip}:${cfg.port}`);
				// "이번만 사용"(세션 오버라이드)은 기억하지 않는다 — 그 외 연결 성공은 이 워크스페이스의 마지막 연결 IP 로 남긴다.
				if (!getSessionControllerOverride().ip) { rememberControllerIp(cfg.ip); }
				if (!silent) { vscode.window.showInformationMessage(`GPL Controller 연결 성공: ${cfg.ip}`); }
				host.setControllerConnected(true, { syncBreakpoints: !preserveBreakpoints });
				void checkUnloadRiskRebootEvidence('연결');
				void checkControllerIdentity(cfg);
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
			// 지금 유효한 값이 있는 범위에 쓴다(워크스페이스 값이 있으면 거기) — 마지막 연결 IP 도 같이 맞춰 저장값이 가려지지 않게 한다.
			const scope = await saveControllerIpSetting(ip);
			rememberControllerIp(ip);
			host.log(`[Controller] IP 저장: ${ip} → ${scope === 'workspace' ? '워크스페이스' : 'User'} 설정`);
			if (port !== (section.get<number>('port') ?? currentCfg.port)) {
				await section.update('port', port, vscode.ConfigurationTarget.Global);
			}
			clearSessionControllerOverride();
		} else {
			// 기본 'session': 디스크에 쓰지 않고 이 세션의 후속 명령에만 적용한다.
			setSessionControllerOverride(ip, port);
		}
		return finishConnect('args', args.silent === true, args.preserveBreakpoints === true);
	}

	/** 대화형 연결(종전 동작). 취소하면 { ok: false, error: 'cancelled' }. */
	async function connectControllerInteractive(): Promise<ConnectResult> {
		const currentCfg = getControllerConfig();
		const launchInfo = host.project.readLaunchControllerInfo();
		const cancelled = (): ConnectResult => ({
			ok: false, ip: currentCfg.ip, port: currentCfg.port,
			connected: host.isControllerConnected, error: 'cancelled', mode: 'interactive',
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
				const scope = await saveControllerIpSetting(inputIp);
				rememberControllerIp(inputIp);
				host.log(`[Controller] IP 저장: ${inputIp} → ${scope === 'workspace' ? '워크스페이스' : 'User'} 설정`);
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

	/**
	 * launch.json 없이 즉석 구성으로 디버그 세션을 연다 — `gpl.debug.attachOnly`(배포 없이 붙기)의 본체.
	 *
	 * 대상 프로젝트는 `resolveExpectedProjectName()`(launch.json → 워크스페이스 자동 탐지)으로 정한다.
	 * **배포를 동반하는 경로는 이 자동 탐지를 쓰지 않는다** — 과제별로 같은 이름의 프로젝트를 복제해 두는
	 * 배치에서는 엉뚱한 것을 고를 수 있고, 배포는 되돌리기 어렵기 때문이다. 그쪽은 대상을 명시적으로
	 * 고르는 `gpl.debugProject`(QuickPick·탐색기 우클릭) 하나로 합쳤다(2026-09-10 사용자 결정, §1-DQ).
	 * 여기 남은 경로는 이미 돌고 있는 프로그램에 **붙기만** 하므로 제어기 상태를 바꾸지 않는다.
	 */
	async function startQuickAttachSession(opts: { deployBeforeAttach: boolean }): Promise<void> {
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
		const label = opts.deployBeforeAttach ? 'GPL Quick Attach' : 'GPL Attach Only';
		// 세션 대상 폴더가 이 프로젝트의 것이면 함께 넘긴다 — 동명 프로젝트가 여럿인 워크스페이스에서 디버거의
		// 소스 매핑이 이름 일치 폴더 전부가 아니라 그 폴더로 좁혀진다(project/sources/compileUnitTarget.ts).
		const targetIdentity = readGprIdentityInDir(host.sessionTargetDir);
		const projectDir = targetIdentity && (!projectName || ciEq(targetIdentity.projectName, projectName))
			? host.sessionTargetDir
			: undefined;

		const dynamicConfig: vscode.DebugConfiguration = {
			type: 'brooks-gpl',
			request: 'attach',
			name: projectName ? `${label} (${projectName})` : label,
			controllerIp: launchInfo?.ip || cfg.ip,
			controllerPort: launchInfo?.port || cfg.port,
			projectName,
			...(projectDir ? { projectDir } : {}),
			deployBeforeAttach: opts.deployBeforeAttach,
			startOnAttach: opts.deployBeforeAttach,
			// 붙기만 하는 경로에서는 실행 중인 프로그램을 건드리지 않는다 — Stop 도 Start 도 보내지 않는다.
			// (제어기 쪽 잔재 브레이크포인트 정리는 세션 기본값 clearProjectBreakpointsOnAttach 가 담당한다.)
			stopAllBeforeAttach: false,
			stopOnEntry: false,
		};

		const started = await vscode.debug.startDebugging(undefined, dynamicConfig);
		if (!started) {
			vscode.window.showErrorMessage('디버깅 시작 실패: 구성 또는 제어기 상태를 확인하세요.');
		}
	}

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.debug.attachOnly', () => startQuickAttachSession({ deployBeforeAttach: false })),
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
		vscode.commands.registerCommand('gpl.controller.disconnect', async (args?: unknown) => {
			// 싱글톤 인스턴스는 보존하고 연결만 끊는다 (v0.5.48 일관성).
			// 반환값·silent 인자는 AI/URI 진입점용(GitHub #25) — 사람이 누를 때(인자 없음)는 종전과 동일하게 알림을 띄운다.
			const silent = !!args && typeof args === 'object' && (args as { silent?: boolean }).silent === true;
			const cfg = getControllerConfig();

			// ① 디버그 세션이 살아 있으면 먼저 끝낸다.
			// 어댑터는 attach 시점에 복사한 자기 _config 로 Show Thread 를 폴할 뿐 확장의 연결 상태를 참조하지 않는다.
			// 그래서 소켓만 닫으면 다음 폴(기본 1 s)이 1402 를 다시 열고 keep-alive 로 보관해 사실상 영구 점유가 되고,
			// 제어기는 단일 클라이언트라 GDE 등 다른 도구가 붙지 못한다. 세션을 끝내야 폴이 멎고 포트가 실제로 빈다.
			const debugSession = host.isDebugSessionActive ? host.gplDebugSession : undefined;
			let debugSessionEnded = false;
			if (debugSession) {
				// 구성에 따라 세션 종료가 제어기 프로그램까지 멈춘다(Stop -all) — 모션 영향이므로 사람에게는 먼저 확인받는다
				// (하드 규칙 9). silent(AI/URI)는 묻지 않고 진행하되 결과에 무엇이 일어났는지 담아 돌려준다.
				const stopsProgram = debugSession.configuration?.stopAllOnDisconnect === true;
				if (!silent && stopsProgram) {
					const proceed = '세션 종료 후 해제';
					const pick = await vscode.window.showWarningMessage(
						`연결을 해제하려면 디버그 세션(${debugSession.name})을 먼저 끝내야 합니다.`,
						{
							modal: true,
							detail: '이 세션은 stopAllOnDisconnect=true 구성이라 종료할 때 제어기 프로그램도 정지합니다(Stop -all)'
								+ ' — 실행 중인 동작이 멈춥니다.',
						},
						proceed,
					);
					if (pick !== proceed) {
						host.log('[Controller] 연결 해제 취소 — 디버그 세션 종료를 사용자가 취소했습니다.');
						return { ok: false, cancelled: true, connected: true, ip: cfg.ip, port: cfg.port };
					}
				}
				host.log(`[Controller] 연결 해제 — 디버그 세션 종료 중: ${debugSession.name}`
					+ `${stopsProgram ? ' (stopAllOnDisconnect=true → Stop -all)' : ' (제어기 프로그램은 그대로 실행)'}`);
				const stopOutcome = await stopDebugSessionAndWait(debugSession, DEBUG_SESSION_STOP_TIMEOUT_MS);
				debugSessionEnded = stopOutcome === 'terminated';
				if (!debugSessionEnded) {
					host.log('[Controller] 디버그 세션 종료 미확인 — '
						+ (stopOutcome === 'failed'
							? 'stopDebugging 요청이 거부됐습니다(이미 사라진 세션일 수 있음).'
							: `${DEBUG_SESSION_STOP_TIMEOUT_MS}ms 안에 terminated 이벤트가 오지 않았습니다.`)
						+ ' 해제는 계속하지만 폴이 남아 있으면 명령 콘솔이 다시 열릴 수 있습니다.');
				}
			}

			host.stopRuntimeConsoleAndSyncTree();
			closeControllerConnection('disconnect');
			clearSessionControllerOverride();
			host.setControllerConnected(false);
			host.lastRuntimeErrorContext = undefined;
			host.controllerTree?.setRuntimeErrorContext(undefined);
			host.log(`[Controller] Disconnected: ${cfg.ip}:${cfg.port}${silent ? ' (silent)' : ''}`
				+ `${debugSessionEnded ? ' — 디버그 세션 종료됨' : ''}`);
			if (!silent) {
				vscode.window.showInformationMessage(debugSessionEnded
					? 'GPL Controller 연결 해제 — 디버그 세션도 종료했습니다'
					: 'GPL Controller 연결 해제');
			}
			return { ok: true, connected: false, ip: cfg.ip, port: cfg.port, debugSessionEnded };
		})
	);

	// ── 시작 시 자동 연결(선택, 기본 꺼짐) ─────────────────────────────────────────────────────────
	// 연결하면 단일 클라이언트인 명령 콘솔을 쥐게 되어 다른 창·GDE 가 쓰던 세션을 빼앗을 수 있으므로 기본값은 false 다.
	// 켜면 활성화 직후 현재 대상 IP(ipSource 해석 결과)로 조용히 연결하고, 실패하면 알린다.
	if (vscode.workspace.getConfiguration('gpl.controller').get<boolean>('autoConnectOnStartup', false) === true) {
		const timer = setTimeout(() => {
			if (host.isControllerConnected) { return; }
			void finishConnect('args', true).then(r => {
				if (!r.ok) {
					void vscode.window.showWarningMessage(`시작 시 자동 연결에 실패했습니다: ${r.ip}:${r.port} (${r.error ?? '원인 미상'}). 상태 표시줄에서 다시 연결할 수 있습니다.`);
				}
			});
		}, 1500);
		context.subscriptions.push({ dispose: () => clearTimeout(timer) });
	}

	return { connectControllerWithArgs };
}
