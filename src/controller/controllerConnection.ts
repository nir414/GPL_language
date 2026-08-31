import * as vscode from 'vscode';
import { appendLiveLog } from '../log/liveLogTerminal';
import { formatConsoleCommandClassification } from './consoleCommandClassifier';
import { ResponseBodyStreamer } from './trafficResponseBody';
import { sendConsoleCommand, recordTrafficLine, TrafficDirection } from './consoleSocket';
import type { CommandResponse } from './consoleSocket';
import { classifyCommandFailure, probeOutcomeFromResponse } from './connectionHealth';
import type { ProbeOutcome } from './connectionHealth';
import { IdlePingScheduler } from './idlePing';
import type { IdlePingStats } from './idlePing';
import { ControllerCommandPolicy, DEFAULT_COMMAND_POLICY_OPTIONS } from './commandPolicy';
import type { CommandPolicyOptions } from './commandPolicy';
import { parseThreadList, SHOW_THREAD_LIST_CMD } from './responseParser';

export { isPolicyError, PolicyError } from './commandPolicy';
export type { PolicyErrorCode } from './commandPolicy';

// 1402 소켓 계층(consoleSocket.ts, vscode 무의존 — GitHub #22)의 공개 API 재노출.
// 호출자는 종전처럼 이 모듈만 import 한다.
export type { CommandResponse, CommandResponseMeta, ConnectionStats, HeldSocketEvent } from './consoleSocket';
export { closeControllerConnection, getConnectionStats, recordTrafficLine, getRecentTraffic, isCleanlyTerminated, setHeldSocketObserver } from './consoleSocket';
export type { ProbeOutcome, ProbeFailureKind } from './connectionHealth';

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
// 명령 공백이 intervalMs 를 넘으면 읽기 전용 명령 1개를 같은 직렬 큐로 보낸다. 판정 로직은 controller/idlePing.ts.
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

// ── 명령 정책 (controller/commandPolicy.ts, 2026-08-28) ─────────────────────
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
		const response = await sendCommandDetailedInternal(command, config, options);
		if (policyOn) {
			commandPolicy.after(command, response.raw, response.meta.statusTagReceived, Date.now());
		}
		return response;
	});
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

	return sendConsoleCommand(
		command,
		{ ip: cfg.ip, port: cfg.port, preferIPv4: cfg.preferIPv4 },
		{
			timeoutMs: options?.timeoutMs ?? cfg.timeoutMs,
			idleMs: Math.max(50, options?.idleMs ?? 300),
			minResponseBytes: Math.max(1, options?.minResponseBytes ?? 10),
			extraIdleMsOnIncomplete: Math.max(0, options?.extraIdleMsOnIncomplete ?? 0),
			waitForStatusClose: options?.waitForStatusClose === true,
			keepAlive: keepAlive.enabled,
			keepAliveIdleCloseMs: keepAlive.idleCloseMs,
		},
		{ log: logTraffic, body: bodyLog },
	);
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

// ── 연결 건강 프로브 (controller/connectionHealth.ts, 2026-08-28) ──────────
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
