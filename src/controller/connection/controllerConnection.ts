import * as vscode from 'vscode';
import { appendLiveLog } from '../../log/liveLogTerminal';
import { affectsThreadState, formatConsoleCommandClassification, isReadOnlyConsoleCommand } from '../commands/consoleCommandClassifier';
import { ResponseBodyStreamer } from './trafficResponseBody';
import { sendConsoleCommand, recordTrafficLine, TrafficDirection } from './consoleSocket';
import type { CommandResponse } from './consoleSocket';
import { classifyCommandFailure, probeOutcomeFromResponse } from './connectionHealth';
import type { ProbeOutcome, ProbeFailureKind } from './connectionHealth';
import { IdlePingScheduler } from './idlePing';
import type { IdlePingStats } from './idlePing';
import { ControllerCommandPolicy, DEFAULT_COMMAND_POLICY_OPTIONS, commandChannelTraits } from '../commands/commandPolicy';
import type { CommandPolicyOptions, CommandChannelTraits } from '../commands/commandPolicy';
import { parseStatus, parseThreadList, SHOW_THREAD_LIST_CMD } from '../protocol/responseParser';
import { effectiveKeepAlive } from './connectionSession';
import { assessMemory, checkMemory, DEFAULT_MEMORY_GUARD, needsMemoryGuard, MemoryGuardOptions, MemoryPrecheck } from '../diagnostics/memoryGuard';
import { guardBeforeSend, observeAfterResponse, unloadFailureGuidance } from '../commands/unloadRiskGuard';
import { MemoryNoticeTracker, formatMemoryDetail, formatMemoryToast, memoryBadge } from '../diagnostics/memoryNotice';
import { PROBE_MEMORY_CMD } from '../diagnostics/resourceProbes';
import { controllerMemoryReadings, isMemoryProbeCommand } from '../diagnostics/memoryReadings';
import type { MemoryReading } from '../diagnostics/memoryReadings';
import { RecentCommandLog } from './recentCommands';
import type { RecentCommandRecord } from './recentCommands';

export { isPolicyError, PolicyError } from '../commands/commandPolicy';
export type { PolicyErrorCode } from '../commands/commandPolicy';

// 1402 소켓 계층(consoleSocket.ts, vscode 무의존 — GitHub #22)의 공개 API 재노출.
// 호출자는 종전처럼 이 모듈만 import 한다.
export type { CommandResponse, CommandResponseMeta, ConnectionStats, HeldSocketEvent } from './consoleSocket';
export { closeControllerConnection, getConnectionStats, recordTrafficLine, getRecentTraffic, isCleanlyTerminated, setHeldSocketObserver } from './consoleSocket';
export type { ProbeOutcome, ProbeFailureKind } from './connectionHealth';
export { commandChannelTraits, mayDisruptCommandChannel } from '../commands/commandPolicy';
export type { CommandChannelTraits } from '../commands/commandPolicy';

export interface ControllerConfig {
	ip: string;
	port: number;
	consolePort: number;
	timeoutMs: number;
	ftpBasePath: string;
	ftpFlashProjectsPath: string;
	preferIPv4: boolean;
}

export interface SendCommandOptions {
	timeoutMs?: number;
	idleMs?: number;
	minResponseBytes?: number;
	extraIdleMsOnIncomplete?: number;
	/**
	 * true면 idle 기반 조기 완료를 비활성화하고, 종결자 `</STATUS>` 수신(또는 소켓 종료/하드
	 * 타임아웃)까지 응답을 기다린다. 컴파일처럼 pass 사이에 수 초간 침묵하는 명령에서
	 * 응답이 잘려 STATUS/에러 라인을 놓치는 것을 막는다. 이때 timeoutMs를 충분히 크게 줄 것.
	 */
	waitForStatusClose?: boolean;
	/**
	 * 그룹 Compile 뒤 Unload 위험(controller/commands/unloadRisk.ts)을 사람이 모달로, 또는 AI 호출자가 사용자 동의를 받아
	 * `confirm:true` 로 확인했다. 없으면 위험 상태의 Unload 는 보내지 않고 UnloadRiskError 를 던진다.
	 */
	confirmUnloadRisk?: boolean;
	/**
	 * 직렬 큐 슬롯을 얻고 안전 검사·명령 정책 대기를 마친 **뒤**, 실제 전송 직전에 보낼 명령 문자열을 만든다.
	 * 시계 설정(`date mm-dd-yyyy hh:mm:ss`)처럼 값이 전송 시각에 묶인 명령용이다 — 큐 앞의 긴 Compile 뒤에 밀려도
	 * 낡은 값을 보내지 않는다. 함수가 기다리는 동안에도 슬롯을 쥐고 있어 다른 명령이 끼어들지 않으므로 짧게 끝낸다.
	 * 결과의 첫 단어(명령 이름)는 `command` 와 같아야 한다 — 검사·정책은 `command` 로 이미 판정했기 때문이다(다르면 보내지 않는다).
	 */
	composeInSlot?: () => Promise<string>;
}

/** `composeInSlot` 결과 — 명령 이름이 예약한 명령과 같을 때만 보낸다. */
async function composeCommandInSlot(reserved: string, compose: () => Promise<string>): Promise<string> {
	const wire = await compose();
	const verb = (s: string) => s.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
	if (!wire.trim() || verb(wire) !== verb(reserved)) {
		throw Object.assign(new Error(`전송 직전 만든 명령 "${wire}" 이 예약한 명령 "${reserved}" 과 달라 보내지 않았습니다.`), { sent: false });
	}
	return wire;
}

// Brooks 제어기 고정 포트 (하드웨어 결정, 변경 불가)
const DEFAULT_PORT = 1402;
const DEFAULT_CONSOLE_PORT = 1403;
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_FTP_BASE_PATH = '/GPL';
const DEFAULT_FTP_FLASH_PROJECTS_PATH = '/flash/projects';

// ── 1402 keep-alive (GitHub #22) ────────────────────────
// 종전엔 명령마다 새 TCP 연결을 열어 1402만 1~3 conn/s 였다(제어기 TCP 자원 고갈 가설). 기본 on.
// 끄면 종전과 완전히 동일한 단명 연결 동작(설정 키 스키마는 package.json).
const DEFAULT_KEEP_ALIVE_1402 = true;
const DEFAULT_KEEP_ALIVE_IDLE_CLOSE_MS = 30000;
const MIN_KEEP_ALIVE_IDLE_CLOSE_MS = 1000;

export interface KeepAliveOptions {
	/** `gpl.controller.keepAlive1402` — false면 명령마다 새 연결(종전 동작). */
	enabled: boolean;
	/** `gpl.controller.keepAliveIdleCloseMs` — 유휴 소켓을 닫기까지의 시간(하한 1000). */
	idleCloseMs: number;
}

/** 1402 keep-alive 설정. 명령마다 읽으므로 설정 변경이 다음 명령부터 즉시 반영된다. */
export function getKeepAliveOptions(): KeepAliveOptions {
	const cfg = vscode.workspace.getConfiguration('gpl.controller');
	const idle = cfg.get<number>('keepAliveIdleCloseMs', DEFAULT_KEEP_ALIVE_IDLE_CLOSE_MS);
	return {
		enabled: cfg.get<boolean>('keepAlive1402', DEFAULT_KEEP_ALIVE_1402),
		idleCloseMs: Number.isFinite(idle)
			? Math.max(MIN_KEEP_ALIVE_IDLE_CLOSE_MS, Math.floor(idle))
			: DEFAULT_KEEP_ALIVE_IDLE_CLOSE_MS,
	};
}

// ── 1402 유휴 ping — GDE 방식 세션 유지 (2026-08-28, docs/ai-handoff.md §1-BM) ─────────
// GDE는 1402 세션을 끝까지 유지하며 유휴 5 s마다 파라미터 읽기를 보낸다. 제어기는 1402 세션을 쥔 클라이언트에게
// 1403 런타임 스트림을 계속 열어 두는 것으로 관측되므로(단명 1402 시절 1403이 배치마다 FIN), 연결된 동안
// 명령 공백이 intervalMs 를 넘으면 읽기 전용 명령 1개를 같은 직렬 큐로 보낸다. 판정 로직은 controller/connection/idlePing.ts.
const DEFAULT_KEEP_ALIVE_IDLE_PING_MS = 5000;
const DEFAULT_KEEP_ALIVE_IDLE_PING_COMMAND = 'Show Thread';

export interface IdlePingOptions {
	/** `gpl.controller.keepAliveIdlePingMs` — 0 이면 끔. keepAlive1402 가 꺼져 있으면 무조건 끔. */
	intervalMs: number;
	/** `gpl.controller.keepAliveIdlePingCommand` — 읽기 전용 명령(기본 `Show Thread`, 빈 <DATA></DATA> 응답). */
	command: string;
}

export function getIdlePingOptions(): IdlePingOptions {
	const cfg = vscode.workspace.getConfiguration('gpl.controller');
	const raw = cfg.get<number>('keepAliveIdlePingMs', DEFAULT_KEEP_ALIVE_IDLE_PING_MS);
	const cmd = (cfg.get<string>('keepAliveIdlePingCommand', DEFAULT_KEEP_ALIVE_IDLE_PING_COMMAND) ?? '').trim();
	return {
		intervalMs: typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.max(1000, Math.floor(raw)) : 0,
		command: cmd || DEFAULT_KEEP_ALIVE_IDLE_PING_COMMAND,
	};
}

let _idlePingObserver: ((outcome: ProbeOutcome) => void) | null = null;

const idlePing = new IdlePingScheduler({
	intervalMs: () => getIdlePingOptions().intervalMs,
	enabled: () => getKeepAliveOptions().enabled && getIdlePingOptions().intervalMs > 0,
	send: async () => {
		// 프로브와 같은 타임아웃·분류로 보내고 결과를 관찰자(연결 건강 모니터)에 넘긴다 — 유휴 중에도 끊김이 5 s 주기로 드러난다.
		const outcome = await probeControllerCommand(getIdlePingOptions().command, undefined, getConnectionProbeTimeoutMs());
		try { _idlePingObserver?.(outcome); } catch { /* 관찰자 예외는 무시 */ }
		if (!outcome.ok) {
			throw new Error(`${outcome.kind}${outcome.detail ? ` — ${outcome.detail}` : ''}`);
		}
	},
	log: message => logTraffic('---', message),
});

/** 제어기 연결 상태 에지에서 호출(extension.ts setControllerConnected). 연결 중에만 유휴 ping 타이머가 돈다. */
export function setIdlePingActive(active: boolean): void {
	if (active) {
		if (!idlePing.running) {
			const o = getIdlePingOptions();
			logTraffic('---', getKeepAliveOptions().enabled && o.intervalMs > 0
				? `1402 idle ping ON (every ${formatIdleMs(o.intervalMs)} idle → ${o.command})`
				: '1402 idle ping OFF (keepAlive1402 또는 keepAliveIdlePingMs 설정)');
		}
		idlePing.start();
	} else if (idlePing.running) {
		idlePing.stop();
		const s = idlePing.getStats();
		logTraffic('---', `1402 idle ping stopped (pings=${s.pings}, failures=${s.failures})`);
	}
}

/** 유휴 ping 결과(ProbeOutcome) 관찰자 — 연결 건강 모니터가 reportProbe 로 받는다. */
export function setIdlePingObserver(fn: ((outcome: ProbeOutcome) => void) | null): void {
	_idlePingObserver = fn;
}

export function getIdlePingStats(): IdlePingStats & { running: boolean } {
	return { ...idlePing.getStats(), running: idlePing.running };
}

function formatIdleMs(ms: number): string {
	return ms % 1000 === 0 ? `${ms / 1000} s` : `${ms} ms`;
}

// ── Traffic Logger ──────────────────────────────────────

let _trafficChannel: vscode.OutputChannel | null = null;

/** 트래픽 로그 채널 설정. extension.ts에서 한 번 호출. */
export function setTrafficChannel(ch: vscode.OutputChannel): void {
	_trafficChannel = ch;
}

/** 트래픽 로그 채널 반환 (없으면 null). */
export function getTrafficChannel(): vscode.OutputChannel | null {
	return _trafficChannel;
}

/** 1402 응답 본문 표시 상한 기본값(문자). 0 = 무제한. */
const DEFAULT_TRAFFIC_MAX_RESPONSE_CHARS = 4000;

export interface TrafficLogOptions {
	/** true면 1402 응답 본문을 GPL Traffic에 줄 단위(` | ` 라인)로 표시. false면 `<<<` STATUS 요약만. */
	responseBody: boolean;
	/** 응답 하나당 본문 표시 상한(문자). 0 = 무제한. */
	maxResponseChars: number;
}

/** GPL Traffic 표시 옵션 (설정 `gpl.controller.trafficLog*`). 명령마다 읽으므로 변경이 즉시 반영된다. */
export function getTrafficLogOptions(): TrafficLogOptions {
	const cfg = vscode.workspace.getConfiguration('gpl.controller');
	const max = cfg.get<number>('trafficLogMaxResponseChars', DEFAULT_TRAFFIC_MAX_RESPONSE_CHARS);
	return {
		responseBody: cfg.get<boolean>('trafficLogResponseBody', true),
		maxResponseChars: Number.isFinite(max) && max > 0 ? Math.floor(max) : 0,
	};
}

/** 응답 본문 표시 설정을 바꾼다. 워크스페이스에 값이 있으면 그곳을, 아니면 사용자 설정을 갱신한다. */
export async function setTrafficResponseBodyEnabled(enabled: boolean): Promise<void> {
	const cfg = vscode.workspace.getConfiguration('gpl.controller');
	const info = cfg.inspect<boolean>('trafficLogResponseBody');
	const target = info?.workspaceValue !== undefined
		? vscode.ConfigurationTarget.Workspace
		: vscode.ConfigurationTarget.Global;
	await cfg.update('trafficLogResponseBody', enabled, target);
}

/** 트래픽 로그용 타임스탬프 (`HH:mm:ss.SSS`, ko-KR 24시간제) — 1402/1403 로거 공용. */
export function formatTrafficTimestamp(now: Date = new Date()): string {
	return now.toLocaleTimeString('ko-KR', { hour12: false }) + '.' + String(now.getMilliseconds()).padStart(3, '0');
}

/**
 * 방향 표식: `>>>` 송신 명령 / ` | ` 수신 본문 줄(실시간, 설정 on일 때) / `<<<` 수신 완료 요약 / `---` 이벤트·오류.
 * 최종 라인은 GPL Traffic 채널·Live Log Terminal에 찍히고, 사후 스냅샷용 링버퍼(recordTrafficLine)에도 남는다.
 */
function logTraffic(direction: TrafficDirection, message: string): void {
	const ts = formatTrafficTimestamp();

	// 명령 포맷 라벨 추가 (송신 시 자동 판단)
	let labeledMsg = message;
	if (direction === '>>>') {
		// 포맷 판단: XML은 < 시작, 나머지는 plain text
		const isXml = message.includes('<') || message.includes('/>');
		const format = isXml ? '[XML]' : '[PLAIN]';
		const commandText = message.replace(/^\S+:\d+\s+/, '');
		const commandClass = isXml ? '' : `[${formatConsoleCommandClassification(commandText)}]`;
		labeledMsg = `${format}${commandClass} ${message}`;
	}

	const line = `[${ts}] ${direction} ${labeledMsg}`;
	if (_trafficChannel) {
		_trafficChannel.appendLine(line);
	}
	appendLiveLog(`[1402] ${line}`);
	recordTrafficLine(line);
}

// 세션 한정 controller 오버라이드 (메모리 전용, 디스크 미저장).
// "이번만 사용" 같은 일회성 IP 선택이나 launch.json에서 들어온 IP를
// 같은 세션의 후속 명령에도 적용하기 위함.
let _sessionIpOverride: string | undefined;
let _sessionPortOverride: number | undefined;

export function setSessionControllerOverride(ip?: string, port?: number): void {
	_sessionIpOverride = ip && ip.trim() ? ip.trim() : undefined;
	_sessionPortOverride = typeof port === 'number' && port > 0 ? port : undefined;
}

export function clearSessionControllerOverride(): void {
	_sessionIpOverride = undefined;
	_sessionPortOverride = undefined;
}

export function getSessionControllerOverride(): { ip?: string; port?: number } {
	return { ip: _sessionIpOverride, port: _sessionPortOverride };
}

export function getControllerConfig(): ControllerConfig {
	const cfg = vscode.workspace.getConfiguration('gpl.controller');
	const rawIp = cfg.get('ip');
	const settingsIp = typeof rawIp === 'string' ? rawIp : (rawIp as any)?.ip ?? '192.168.0.1';
	const settingsPort = cfg.get<number>('port') ?? DEFAULT_PORT;
	return {
		ip: _sessionIpOverride ?? settingsIp,
		port: _sessionPortOverride ?? settingsPort,
		consolePort: cfg.get<number>('consolePort') ?? DEFAULT_CONSOLE_PORT,
		timeoutMs: cfg.get<number>('timeoutMs') ?? DEFAULT_TIMEOUT_MS,
		ftpBasePath: cfg.get<string>('ftpBasePath') ?? DEFAULT_FTP_BASE_PATH,
		ftpFlashProjectsPath: cfg.get<string>('ftpFlashProjectsPath') ?? DEFAULT_FTP_FLASH_PROJECTS_PATH,
		preferIPv4: cfg.get<boolean>('preferIPv4') ?? true,
	};
}

/**
 * Send a single command to the controller via TCP and return the raw response.
 * 명령은 직렬 큐로 한 번에 하나씩 나가며, keep-alive(기본 on)면 직전 명령이 깨끗하게 끝난 소켓을 재사용한다.
 * (종전 "명령마다 새 연결" 동작은 `gpl.controller.keepAlive1402: false` — GitHub #22)
 */
export function sendCommand(
	command: string,
	config?: Partial<ControllerConfig>,
	timeoutMs?: number
): Promise<string> {
	return sendCommandDetailed(command, config, { timeoutMs }).then(r => r.raw);
}

let controllerCommandQueue: Promise<void> = Promise.resolve();

// 명령 간 최소 idle gap. 제어기는 단일 클라이언트/단일 명령 스트림을 가정하므로
// 명령 사이에 짧은 휴식 시간을 두어 ECONNRESET/idle EOF를 줄인다(keep-alive 재사용 시에도 유지 — 제어기가
// 직전 응답 뒤처리를 끝낼 여유). 정상 완료 후: 15ms / 실패 후: 100ms (재시도 시 부담 완화).
const INTER_COMMAND_GAP_MS = 15;
const INTER_COMMAND_GAP_AFTER_FAIL_MS = 100;

function enqueueControllerCommand<T>(task: () => Promise<T>): Promise<T> {
	// 유휴 ping 스케줄러에 활동을 알린다 — 명령이 큐를 기다리는 동안도 "진행 중"으로 세어 ping 이 끼어들지 않게 한다.
	idlePing.noteCommandStart();
	const tracked = () => task().finally(() => idlePing.noteCommandEnd());
	const run = controllerCommandQueue.then(tracked, tracked);
	controllerCommandQueue = run.then(
		() => new Promise<void>(r => setTimeout(r, INTER_COMMAND_GAP_MS)),
		() => new Promise<void>(r => setTimeout(r, INTER_COMMAND_GAP_AFTER_FAIL_MS)),
	);
	return run;
}

// ── 명령 정책 (controller/commands/commandPolicy.ts, 2026-08-28) ─────────────────────
// 모든 1402 명령이 이 직렬 큐를 지나므로 안전 조건(Step 연타 #28·정지 정착 §0.6·Compile→Start 완충 §0.7)을 경로와 무관하게
// 한 곳에서 충족시킨다 — AI(MCP·URI·gpl.ai.debug.*)·트리·팔레트·디버그 어댑터 모두 동일. 승인 모달/거부 목록은 두지 않는다
// (사용자 결정: 접근을 막지 않는다). 정책이 개입하면 GPL Traffic 에 `--- policy: R1/R2/R3 …` 로 남는다.
const commandPolicy = new ControllerCommandPolicy();

function isCommandPolicyEnabled(): boolean {
	return vscode.workspace.getConfiguration('gpl.controller').get<boolean>('commandPolicyEnabled', true) !== false;
}

function readCommandPolicyOptions(): Partial<CommandPolicyOptions> {
	const ctl = vscode.workspace.getConfiguration('gpl.controller');
	const dbg = vscode.workspace.getConfiguration('gpl.debug');
	const num = (v: unknown, fallback: number, min = 0): number =>
		typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.floor(v)) : fallback;
	return {
		minResumeIntervalMs: num(dbg.get<number>('minStepIntervalMs'), DEFAULT_COMMAND_POLICY_OPTIONS.minResumeIntervalMs),
		settleWaitMs: num(ctl.get<number>('transitionSettleWaitMs'), DEFAULT_COMMAND_POLICY_OPTIONS.settleWaitMs, 500),
		startAfterCompileGapMs: num(ctl.get<number>('startAfterCompileGapMs'), DEFAULT_COMMAND_POLICY_OPTIONS.startAfterCompileGapMs),
	};
}

const sleepMs = (ms: number) => new Promise<void>(r => setTimeout(r, Math.max(0, ms)));

/** 진단용 — 현재 정책 옵션(설정 반영 후). */
export function getCommandPolicySnapshot(): { enabled: boolean; options: Readonly<CommandPolicyOptions> } {
	commandPolicy.updateOptions(readCommandPolicyOptions());
	return { enabled: isCommandPolicyEnabled(), options: commandPolicy.getOptions() };
}

export function sendCommandDetailed(
	command: string,
	config?: Partial<ControllerConfig>,
	options?: SendCommandOptions,
): Promise<CommandResponse> {
	return enqueueControllerCommand(async () => {
		// 그룹 Compile 뒤 Unload 확인·실행 불가 프로젝트 Start 거부 — 명령 정책 설정과 무관하게 모든 경로에 건다
		// (controller/commands/unloadRiskGuard.ts). 거부하면 제어기에는 아무것도 보내지 않는다.
		const controllerId = config?.ip ?? getControllerConfig().ip;
		await guardBeforeSend(command, controllerId, { confirmUnloadRisk: options?.confirmUnloadRisk });
		const policyOn = isCommandPolicyEnabled();
		if (policyOn) {
			commandPolicy.updateOptions(readCommandPolicyOptions());
			// 정책의 상태 조회는 큐 슬롯을 이미 쥔 채로 보내야 하므로 enqueue 하지 않고 내부 전송을 직접 쓴다(재진입 교착 방지).
			await commandPolicy.before(command, {
				now: Date.now,
				sleep: sleepMs,
				listThreads: async () => {
					try {
						const r = await sendCommandDetailedInternal(SHOW_THREAD_LIST_CMD, config, { timeoutMs: getConnectionProbeTimeoutMs() });
						return r.meta.statusTagReceived ? parseThreadList(r.raw) : null;
					} catch {
						return null;
					}
				},
				log: message => logTraffic('---', `policy: ${message}`),
			});
		}
		if (needsMemoryGuard(command)) {
			await checkMemoryBeforeOperation(config, true);
		}
		// 전송 시점에 값을 정하는 명령(시계 설정) — 슬롯을 쥔 채 만들므로 그 사이 다른 명령이 끼어들지 않는다.
		const wire = options?.composeInSlot ? await composeCommandInSlot(command, options.composeInSlot) : command;
		let response: CommandResponse;
		try {
			response = await sendCommandDetailedInternal(wire, config, options);
		} catch (err) {
			noteThreadStateCommand(wire);
			noteRecentCommand(wire, undefined, err);
			// 채널 교란 가능 명령이 응답 없이 끝났으면 연결 건강 모니터에 알린다 → recovering (2026-08-31).
			// 정책이 보류한 경우(PolicyError)는 여기 오지 않는다 — 제어기에 아무것도 보내지 않았으므로.
			notifyDisruptiveFailure(wire, err);
			attachUnloadRiskGuidance(wire, controllerId, err);
			throw err;
		}
		noteThreadStateCommand(wire);
		noteRecentCommand(wire, response);
		if (policyOn) {
			commandPolicy.after(wire, response.raw, response.meta.statusTagReceived, Date.now());
		}
		await observeAfterResponse(wire, controllerId, response.raw);
		return response;
	});
}

// ── 메모리 경고 알림 (2026-10-23 Sample Prep 「경고 알림이 Compile·Start·배포마다 쌓임」) ──────────────
// 판정(차단·AI 결과 필드)은 종전 그대로이고, 사람 화면의 알림만 controller/diagnostics/memoryNotice.ts 규칙으로 줄인다:
// 나빠질 때만 알림 · 같은 경고 반복은 Output 한 줄 · 한 작업 안에서는 최대 1회 · 지속 상태는 상태 표시줄 항목.
//
// 측정값은 controller/diagnostics/memoryReadings 가 정본이다(2026-11-03). 누가 보냈든 `Show Memory` 응답은 내부 송신
// (sendCommandDetailedInternal)이 기록하고, 상태 표시줄 배지·상세는 그 기록을 따른다 — 트리 시스템 정보·대시보드가 잰 값과
// Compile/Start 검사가 잰 값이 서로 다른 화면에 따로 보이지 않게. 알림(토스트)만 작업 검사가 정한다.
const memoryNotices = new MemoryNoticeTracker();
let _memoryStatusObserver: ((ip: string, check: MemoryPrecheck, badge: { text: string; tooltip: string } | null | undefined) => void) | null = null;
/** 작업 검사(checkMemoryBeforeOperation)의 마지막 결과. `at` = 검사 시각, `measuredAt` = 그 값을 잰 시각(재사용이면 더 이르다). */
let _lastMemoryCheck: { ip: string; check: MemoryPrecheck; at: number; measuredAt: number } | undefined;
/** 누가 쟀든 마지막 측정의 판정(상태 표시줄 상세용). */
let _latestMemoryAssessment: { ip: string; check: MemoryPrecheck; at: number; command: string } | undefined;

function readMemoryGuardOptions(): MemoryGuardOptions {
	const settings = vscode.workspace.getConfiguration('gpl.controller');
	// `criticalMb` 가 종전 `blockMb`(deprecated) 를 대체한다 — 사용자가 옛 키만 설정해 뒀으면 그 값을 심각 기준으로 쓴다.
	const legacyBlock = settings.inspect<number>('memoryGuard.blockMb');
	const legacyValue = legacyBlock?.workspaceFolderValue ?? legacyBlock?.workspaceValue ?? legacyBlock?.globalValue;
	const criticalInspect = settings.inspect<number>('memoryGuard.criticalMb');
	const criticalSet = criticalInspect?.workspaceFolderValue ?? criticalInspect?.workspaceValue ?? criticalInspect?.globalValue;
	return {
		warnMb: settings.get<number>('memoryGuard.warnMb', DEFAULT_MEMORY_GUARD.warnMb),
		criticalMb: criticalSet ?? legacyValue ?? DEFAULT_MEMORY_GUARD.criticalMb,
	};
}

controllerMemoryReadings.onDidRecord((reading: MemoryReading) => {
	const check = assessMemory(reading.raw, readMemoryGuardOptions());
	_latestMemoryAssessment = { ip: reading.ip, check, at: reading.at, command: reading.command };
	try { _memoryStatusObserver?.(reading.ip, check, memoryBadge(check) ?? null); } catch { /* 관찰자 예외는 무시 */ }
});

/** 메모리 측정 관찰자 — 상태 표시줄 경고 항목이 받는다(badge: null 숨김 / undefined 유지). 모든 측정마다 불린다. */
export function setMemoryStatusObserver(fn: ((ip: string, check: MemoryPrecheck, badge: { text: string; tooltip: string } | null | undefined) => void) | null): void {
	_memoryStatusObserver = fn;
}

/** 마지막 작업 검사(배포가 「정지 뒤 Compile 직전 측정」을 고를 때 쓴다). */
export function getLastMemoryCheck(): { ip: string; check: MemoryPrecheck; at: number; measuredAt: number } | undefined {
	return _lastMemoryCheck;
}

/** 누가 쟀든 마지막 측정의 판정 — 상태 표시줄 상세·트리와 같은 값. */
export function getLatestMemoryAssessment(): { ip: string; check: MemoryPrecheck; at: number; command: string } | undefined {
	return _latestMemoryAssessment;
}

/** 상세 문구(임계값·안내) — 상태 표시줄 클릭·알림의 「자세히」가 쓴다. 문구 정본은 memoryNotice.formatMemoryDetail. */
export function describeMemoryCheck(check: MemoryPrecheck): string {
	return formatMemoryDetail(check);
}

/**
 * 한 작업(배포 등)의 메모리 알림 범위를 연다 — 그 안의 검사는 알림을 최대 1회만 띄운다(업로드 전 검사 + Start 큐 검사).
 * 반환 함수로 닫는다(finally 에서).
 */
export function beginMemoryNoticeScope(ip: string): () => void {
	memoryNotices.beginScope(ip);
	let closed = false;
	return () => {
		if (closed) { return; }
		closed = true;
		memoryNotices.endScope(ip);
	};
}

/**
 * 배포는 업로드 전, Compile/Start는 해당 명령의 직렬 큐 슬롯에서 각각 현재 Free를 확인한다.
 * 측정 뒤 상태 변경(상태 변경 명령·FTP 쓰기)이 없고 MEMORY_READING_REUSE_MS 안의 측정이 있으면 다시 재지 않는다
 * (2026-11-03 — 「심각이면 묻기」 검사 직후의 큐 슬롯 검사가 같은 값을 한 번 더 재던 중복). Stop·Compile·업로드 뒤에는 값이
 * 실제로 달라지므로 그때는 새로 잰다.
 */
export async function checkMemoryBeforeOperation(config?: Partial<ControllerConfig>, insideQueue = false): Promise<MemoryPrecheck> {
	const options = readMemoryGuardOptions();
	const send = insideQueue ? sendCommandDetailedInternal : sendCommandDetailed;
	const ip = { ...getControllerConfig(), ...config }.ip;
	const reused = controllerMemoryReadings.reusable(ip, Date.now());
	const probe = reused
		? async () => reused.raw
		: async () => (await send(PROBE_MEMORY_CMD, config, { waitForStatusClose: true })).raw;
	return checkMemory(probe, options, check => {
		const at = Date.now();
		// Output 에는 매번 전문(긴 안내 포함)을 남긴다 — AI 결과 필드(memoryPrecheck.message)와 같은 문장.
		const reuseNote = reused ? ` (재사용 — ${at - reused.at} ms 전 ${reused.command} 측정, 그 뒤 상태 변경 없음)` : '';
		logTraffic('---', `memory: ${check.level} — ${check.message}${reuseNote}`);
		_lastMemoryCheck = { ip, check, at, measuredAt: reused ? reused.at : at };
		const decision = memoryNotices.evaluate(ip, check);
		if ((check.level === 'warning' || check.level === 'critical') && !decision.toast) {
			logTraffic('---', `memory: 알림 생략(${decision.reason}) — 상태 표시줄에 표시 중`);
		}
		// 배지는 측정 기록(controllerMemoryReadings.onDidRecord)이 갱신한다 — 여기서 다시 부르지 않는다.
		if (decision.toast) {
			// 「Unload…」: 메모리 회수 수단을 알림에서 바로 — Unload 로 상당 부분 회복됨을 사용자가 확인(2026-10-27). 위험 판정은 그 명령이 한다.
			void vscode.window.showWarningMessage(formatMemoryToast(check), 'Unload…', '자세히').then(pick => {
				if (pick === '자세히') { void vscode.commands.executeCommand(SHOW_MEMORY_STATUS_COMMAND); }
				else if (pick === 'Unload…') { void vscode.commands.executeCommand(UNLOAD_PROJECT_COMMAND); }
			});
		}
	});
}

/** 상태 표시줄 메모리 경고 항목·알림의 「자세히」가 여는 명령(activation 에서 등록). */
export const SHOW_MEMORY_STATUS_COMMAND = 'gpl.controller.showMemoryStatus';
/** 메모리 알림·상세·배포 중단 안내의 「Unload…」가 여는 명령(activation/remote/ftpCommands 에서 등록) — /GPL 프로젝트를 골라 내린다. */
export const UNLOAD_PROJECT_COMMAND = 'gpl.controller.unloadProject';

// ── 정체 확인용 관측 기록 (controller/connection/controllerIdentity.ts) ─────────────────────
// 업로드 전 정체 확인이 "같은 작업 안에서 이미 받은 STATUS" 를 재사용하려면 마지막 STATUS 수신을 알아야 한다.
let _lastConsoleStatus: { ip: string; at: number; command: string; statusCode: number } | undefined;
let _lastChannelLoss: { ip: string; at: number } | undefined;

/** `ip` 에서 `sinceMs` 이후 받은 마지막 `<STATUS>`(없으면 undefined). */
export function getLastConsoleStatus(ip: string, sinceMs = 0): { at: number; command: string; statusCode: number } | undefined {
	const s = _lastConsoleStatus;
	return s && s.ip === ip && s.at >= sinceMs ? { at: s.at, command: s.command, statusCode: s.statusCode } : undefined;
}

/** 명령 콘솔 채널 유실 확정 시각을 기록한다(activation 의 유실 처리). `/GPL` 이 비었을 때 재부팅 정황 안내에 쓴다. */
export function noteCommandChannelLoss(ip: string, at: number = Date.now()): void {
	_lastChannelLoss = { ip, at };
}

export function getLastCommandChannelLoss(ip: string): number | undefined {
	return _lastChannelLoss && _lastChannelLoss.ip === ip ? _lastChannelLoss.at : undefined;
}

// ── 최근 상태 변경 명령 (controller/connection/recentCommands.ts, 2026-11-03) ──────────────────────
// 유실 사후 스냅샷의 "직전 상태 변경 명령" 근거. 응답 없이 끝난 교란 명령(아래 관찰자)만으로는 `Stop -all` 처럼 정상 응답한
// 뒤 채널이 끊긴 사례(2026-11-02 09:18 등 8건)가 "직전 명령 없음"으로 찍혔다. 읽기 전용 폴링은 넣지 않는다.
const recentCommands = new RecentCommandLog();

function noteRecentCommand(command: string, response: CommandResponse | undefined, err?: unknown): void {
	if (isReadOnlyConsoleCommand(command)) { return; }
	const at = Date.now();
	if (!response) {
		recentCommands.add({ command, at, outcome: 'failed', failure: classifyCommandFailure(err).kind });
	} else if (response.meta.statusTagReceived) {
		recentCommands.add({ command, at, outcome: 'status', statusCode: parseStatus(response.raw).code });
	} else {
		recentCommands.add({ command, at, outcome: 'no-status' });
	}
}

// ── 쓰레드를 움직이는 명령의 응답 관찰자 (2026-11-04) ──────────────────────
// Start·Stop·Execute·Continue 등은 응답 뒤 수백 ms~수 초에 걸쳐 쓰레드 상태가 바뀐다. 보낸 경로(트리·명령 팔레트·배포·
// AI 브리지)가 저마다 갱신을 부르지 않아도, 응답(실패 포함 — 실행됐을 수 있다)을 여기서 한 번 알려 트리가 짧은 간격으로
// 다시 조회하게 한다. 판정 정본은 consoleCommandClassifier.affectsThreadState.
let _threadStateCommandObserver: ((command: string) => void) | null = null;

export function setThreadStateCommandObserver(fn: ((command: string) => void) | null): void {
	_threadStateCommandObserver = fn;
}

function noteThreadStateCommand(command: string): void {
	if (!affectsThreadState(command)) { return; }
	try { _threadStateCommandObserver?.(command.trim().replace(/\s+/g, ' ')); } catch { /* 관찰자 예외는 무시 */ }
}

/** 이 창에서 보낸 최근 상태 변경 명령(오래된 순, 최대 30건). */
export function getRecentStateChangingCommands(): readonly RecentCommandRecord[] {
	return recentCommands.list();
}

// ── 채널 교란 관찰자 (2026-08-31) ───────────────────────────────────────────
// 배경(실측 2026-08-31): `Unload GPL_Code` 가 15 s 안에 응답하지 않고, 그 뒤 약 2.5분간 1402 새 연결이 ECONNREFUSED
// 되다가 재부팅 없이 정상 복귀했다. 종전에는 그 거부 2회가 definitive-threshold 에 걸려 3초 만에 "연결 유실"로
// 확정됐다. 이 관찰자는 "결과를 모르는 채 끝난 교란 가능 명령"이라는 **관측**만 전달하고, 인과를 확정하지 않는다.
//
// 통지 조건: mayDisruptChannel 명령(Unload/Load/Compile/Start) + 실패 종류가 timeout/closed/reset(= 명령이 제어기에
// 도달해 실행됐을 수 있어 결과가 미확정인 경우)일 때만. refused/unreachable 은 **보내기 전에** 채널이 이미 닫혀
// 있었다는 뜻이므로 "명령 뒤 교란"이 아니다 — 통지하지 않고 종전 판정에 맡긴다.
const DISRUPTIVE_OUTCOME_UNKNOWN_KINDS: ReadonlySet<ProbeFailureKind> = new Set<ProbeFailureKind>(['timeout', 'closed', 'reset']);

export interface DisruptiveCommandFailure {
	command: string;
	kind: ProbeFailureKind;
	detail: string;
	traits: CommandChannelTraits;
	at: number;
}

let _disruptiveObserver: ((failure: DisruptiveCommandFailure) => void) | null = null;

/** 채널 교란 가능 명령의 결과 미확정 실패 관찰자 — extension.ts 가 연결 건강 모니터에 연결한다. */
export function setDisruptiveCommandObserver(fn: ((failure: DisruptiveCommandFailure) => void) | null): void {
	_disruptiveObserver = fn;
}

function notifyDisruptiveFailure(command: string, err: unknown): void {
	const traits = commandChannelTraits(command);
	if (!traits.mayDisruptChannel) { return; }
	const { kind, detail } = classifyCommandFailure(err);
	if (!DISRUPTIVE_OUTCOME_UNKNOWN_KINDS.has(kind)) { return; }
	logTraffic('---', `channel: ${command} 가 응답 없이 끝남(${kind}) — 명령 결과 미확정. 채널 복구 대기로 처리한다(유실 판정 보류).`);
	try {
		_disruptiveObserver?.({ command, kind, detail, traits, at: Date.now() });
	} catch { /* 관찰자 예외는 무시 */ }
}

/**
 * 위험 상태(그룹 Compile 뒤)의 Unload 가 결과 미확정으로 끝났으면 "이 조합은 재부팅이 필요했다" 를 오류 문구에 붙인다 —
 * 일반 채널 복구 대기(최대 180 s) 안내만 보고 기다리지 않게(inbox unload-guard-request ③). 보내지 못한 실패(refused)는 제외.
 */
function attachUnloadRiskGuidance(command: string, controllerId: string, err: unknown): void {
	if (!(err instanceof Error)) { return; }
	if (!DISRUPTIVE_OUTCOME_UNKNOWN_KINDS.has(classifyCommandFailure(err).kind)) { return; }
	const guidance = unloadFailureGuidance(command, controllerId);
	if (!guidance) { return; }
	logTraffic('---', `unload-risk: ${guidance}`);
	(err as Error & { unloadRiskGuidance?: string }).unloadRiskGuidance = guidance;
	err.message = `${err.message} — ${guidance}`;
}

/**
 * 소켓 처리 본체는 consoleSocket.ts(vscode 무의존, 테스트 가능)로 옮겼다(GitHub #22).
 * 여기서는 설정(제어기 주소·타임아웃·keep-alive·트래픽 표시)을 읽어 옵션으로 넘기고 로거를 연결만 한다.
 */
function sendCommandDetailedInternal(
	command: string,
	config?: Partial<ControllerConfig>,
	options?: SendCommandOptions,
): Promise<CommandResponse> {
	const cfg = { ...getControllerConfig(), ...config };
	const keepAlive = getKeepAliveOptions();

	// 응답 본문 실시간 표시(설정 on일 때): chunk 도착 즉시 완성된 줄을 ` | ` 라인으로 흘려보낸다.
	// 모든 종료 경로(정상/타임아웃/에러/소켓 종료)에서 flush 해 도착한 부분까지는 반드시 보이게 한다.
	const trafficOpts = getTrafficLogOptions();
	const bodyLog = trafficOpts.responseBody
		? new ResponseBodyStreamer(line => logTraffic(' | ', line), { maxChars: trafficOpts.maxResponseChars })
		: null;

	// 메모리 측정값 정본(memoryReadings): 상태를 바꿀 수 있는 명령은 보내는 순간 그 전 측정을 재사용 불가로 만든다
	// (응답 실패여도 제어기가 실행했을 수 있다). 분류가 unknown 인 명령도 읽기 전용이 아니므로 바꾼 것으로 친다.
	if (!isReadOnlyConsoleCommand(command)) {
		controllerMemoryReadings.noteChange(cfg.ip, Date.now(), command.trim());
	}

	return sendConsoleCommand(
		command,
		{ ip: cfg.ip, port: cfg.port, preferIPv4: cfg.preferIPv4 },
		{
			timeoutMs: options?.timeoutMs ?? cfg.timeoutMs,
			idleMs: Math.max(50, options?.idleMs ?? 300),
			minResponseBytes: Math.max(1, options?.minResponseBytes ?? 10),
			extraIdleMsOnIncomplete: Math.max(0, options?.extraIdleMsOnIncomplete ?? 0),
			waitForStatusClose: options?.waitForStatusClose === true,
			// 연결 해제 상태에서는 설정과 무관하게 단발 연결 — 해제된 창이 1402 세션을 쥐지 않게(connectionSession.ts).
			keepAlive: effectiveKeepAlive(keepAlive.enabled),
			keepAliveIdleCloseMs: keepAlive.idleCloseMs,
			connectTimeoutMs: getConnectTimeoutMs(),
			// 보관 소켓이 명령 전달 뒤 끊겼을 때 재전송은 조회 명령만(§1-GZ) — 상태 변경 명령은 실행됐을 수 있다.
			retryAfterDeliveryIsSafe: isReadOnlyConsoleCommand(command),
		},
		{ log: logTraffic, body: bodyLog },
	).then(response => {
		// 정체 확인(controllerIdentity)이 같은 작업 안의 STATUS 를 재사용할 수 있게 마지막 수신을 기억한다.
		if (response.meta.statusTagReceived) {
			_lastConsoleStatus = { ip: cfg.ip, at: Date.now(), command, statusCode: parseStatus(response.raw).code };
			// 누가 보냈든(작업 검사·트리 시스템 정보·대시보드·AI 상태 조회) `Show Memory` 응답은 여기서 한 번 기록한다.
			if (isMemoryProbeCommand(command)) {
				controllerMemoryReadings.record(cfg.ip, response.raw, Date.now(), command.trim().replace(/\s+/g, ' '));
			}
		}
		return response;
	});
}

/**
 * Send a command, suppressing errors (best-effort).
 * Returns null on failure.
 */
export async function trySendCommand(
	command: string,
	config?: Partial<ControllerConfig>,
	timeoutMs?: number
): Promise<string | null> {
	try {
		return await sendCommand(command, config, timeoutMs);
	} catch {
		return null;
	}
}

// ── 연결 건강 프로브 (controller/connection/connectionHealth.ts, 2026-08-28) ──────────
// 연결 끊김 감지에 쓰는 Show Thread 폴·재프로브의 타임아웃. 명령 timeoutMs(기본 10 s)와 분리해 8 s 로 둔다
// (사용자 결정 2026-08-28: "5 s 는 짧다, 8 s"). 판정 규칙은 connectionHealth.ts 머리말.
const DEFAULT_CONNECTION_PROBE_TIMEOUT_MS = 8000;
const MIN_CONNECTION_PROBE_TIMEOUT_MS = 1000;

/** `gpl.controller.connectionProbeTimeoutMs` — 프로브마다 읽으므로 설정 변경이 다음 프로브부터 반영된다(하한 1000). */
export function getConnectionProbeTimeoutMs(): number {
	const raw = vscode.workspace.getConfiguration('gpl.controller').get<number>('connectionProbeTimeoutMs', DEFAULT_CONNECTION_PROBE_TIMEOUT_MS);
	return typeof raw === 'number' && Number.isFinite(raw)
		? Math.max(MIN_CONNECTION_PROBE_TIMEOUT_MS, Math.floor(raw))
		: DEFAULT_CONNECTION_PROBE_TIMEOUT_MS;
}

// 새 1402 연결의 TCP 핸드셰이크 상한(consoleSocket connectTimeoutMs). 직결 제어기 실측 p50 8 ms·최대 1.1 s(2026-10-27,
// 사후 스냅샷 25건) — 답 없는 SYN 에 명령 타임아웃(8~10 s) 전체를 쓰지 않게 3 s 로 둔다. 0 이면 끔(종전).
const DEFAULT_CONNECT_TIMEOUT_MS = 3000;
const MIN_CONNECT_TIMEOUT_MS = 500;

/** `gpl.controller.connectTimeoutMs` — 명령마다 읽는다. 0 = 끔, 그 외 하한 500. */
export function getConnectTimeoutMs(): number {
	const raw = vscode.workspace.getConfiguration('gpl.controller').get<number>('connectTimeoutMs', DEFAULT_CONNECT_TIMEOUT_MS);
	if (typeof raw !== 'number' || !Number.isFinite(raw)) { return DEFAULT_CONNECT_TIMEOUT_MS; }
	const v = Math.floor(raw);
	return v <= 0 ? 0 : Math.max(MIN_CONNECT_TIMEOUT_MS, v);
}

// 채널 교란 뒤 복구 대기 상한(connectionHealth.recoveryWindowMs). 0 이면 recovering 을 쓰지 않는다(= 종전 판정 그대로).
const DEFAULT_CONNECTION_RECOVERY_WINDOW_MS = 180_000;
const MIN_CONNECTION_RECOVERY_WINDOW_MS = 5000;

/** `gpl.controller.connectionRecoveryWindowMs` — 0 = 끔(종전 판정), 그 외 하한 5000. */
export function getConnectionRecoveryWindowMs(): number {
	const raw = vscode.workspace.getConfiguration('gpl.controller').get<number>('connectionRecoveryWindowMs', DEFAULT_CONNECTION_RECOVERY_WINDOW_MS);
	if (typeof raw !== 'number' || !Number.isFinite(raw)) { return DEFAULT_CONNECTION_RECOVERY_WINDOW_MS; }
	const v = Math.floor(raw);
	return v <= 0 ? 0 : Math.max(MIN_CONNECTION_RECOVERY_WINDOW_MS, v);
}

/**
 * 연결 건강 프로브 — 명령을 프로브 타임아웃으로 보내고 결과를 ProbeOutcome 으로 분류한다(예외를 내지 않음).
 * 성공 = 응답에 `<STATUS>`가 있음. 부분 응답(소켓 종료로 잘림·HTTP 교차 응답)은 'incomplete' 실패로 친다 —
 * trySendCommand 의 "null 만 실패" 기준과 다르다. 트리 폴·디버그 어댑터 폴·재프로브(ConnectionHealthProber)가 공용으로 쓴다.
 */
export async function probeControllerCommand(
	command: string,
	config?: Partial<ControllerConfig>,
	timeoutMs: number = getConnectionProbeTimeoutMs(),
): Promise<ProbeOutcome> {
	try {
		const response = await sendCommandDetailed(command, config, { timeoutMs });
		return probeOutcomeFromResponse(response.raw);
	} catch (err) {
		return { ok: false, ...classifyCommandFailure(err) };
	}
}

/**
 * Test connectivity to the controller (lightweight probe).
 */
export async function testConnection(config?: Partial<ControllerConfig>): Promise<boolean> {
	try {
		const merged = { ...getControllerConfig(), ...(config ?? {}) };
		const probeTimeoutMs = Math.max(5000, merged.timeoutMs);
		const resp = await sendCommand('ErrorLog', merged, probeTimeoutMs);
		return resp.includes('<STATUS>');
	} catch {
		return false;
	}
}
