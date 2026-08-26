import * as vscode from 'vscode';
import { appendLiveLog } from '../log/liveLogTerminal';
import { formatConsoleCommandClassification } from './consoleCommandClassifier';
import { ResponseBodyStreamer } from './trafficResponseBody';
import { sendConsoleCommand, recordTrafficLine, TrafficDirection } from './consoleSocket';
import type { CommandResponse } from './consoleSocket';

// 1402 소켓 계층(consoleSocket.ts, vscode 무의존 — GitHub #22)의 공개 API 재노출.
// 호출자는 종전처럼 이 모듈만 import 한다.
export type { CommandResponse, CommandResponseMeta, ConnectionStats } from './consoleSocket';
export { closeControllerConnection, getConnectionStats, recordTrafficLine, getRecentTraffic, isCleanlyTerminated } from './consoleSocket';

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
	const run = controllerCommandQueue.then(task, task);
	controllerCommandQueue = run.then(
		() => new Promise<void>(r => setTimeout(r, INTER_COMMAND_GAP_MS)),
		() => new Promise<void>(r => setTimeout(r, INTER_COMMAND_GAP_AFTER_FAIL_MS)),
	);
	return run;
}

export function sendCommandDetailed(
	command: string,
	config?: Partial<ControllerConfig>,
	options?: SendCommandOptions,
): Promise<CommandResponse> {
	return enqueueControllerCommand(() => sendCommandDetailedInternal(command, config, options));
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
