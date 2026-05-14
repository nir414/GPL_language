import * as net from 'net';
import * as vscode from 'vscode';
import { appendLiveLog } from '../log/liveLogTerminal';

export interface ControllerConfig {
	ip: string;
	port: number;
	consolePort: number;
	timeoutMs: number;
	ftpBasePath: string;
	ftpFlashProjectsPath: string;
	preferIPv4: boolean;
}

export interface CommandResponseMeta {
	responseComplete: boolean;
	bytesReceived: number;
	lastChunkAt: string;
	idleTimeoutMs: number;
	statusTagReceived: boolean;
	dataTagClosed: boolean;
	extraIdleApplied: boolean;
	durationMs: number;
}

export interface CommandResponse {
	raw: string;
	meta: CommandResponseMeta;
}

export interface SendCommandOptions {
	timeoutMs?: number;
	idleMs?: number;
	minResponseBytes?: number;
	extraIdleMsOnIncomplete?: number;
}

// Brooks 제어기 고정 포트 (하드웨어 결정, 변경 불가)
const DEFAULT_PORT = 1402;
const DEFAULT_CONSOLE_PORT = 1403;
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_FTP_BASE_PATH = '/GPL';
const DEFAULT_FTP_FLASH_PROJECTS_PATH = '/flash/projects';

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

function logTraffic(direction: '>>>' | '<<<' | '---', message: string): void {
	const now = new Date();
	const ts = now.toLocaleTimeString('ko-KR', { hour12: false }) + '.' + String(now.getMilliseconds()).padStart(3, '0');
	
	// 명령 포맷 라벨 추가 (송신 시 자동 판단)
	let labeledMsg = message;
	if (direction === '>>>') {
		// 포맷 판단: XML은 < 시작, 나머지는 plain text
		const isXml = message.includes('<') || message.includes('/>');
		const format = isXml ? '[XML]' : '[PLAIN]';
		labeledMsg = `${format} ${message}`;
	}
	
	const line = `[${ts}] ${direction} ${labeledMsg}`;
	if (_trafficChannel) {
		_trafficChannel.appendLine(line);
	}
	appendLiveLog(`[1402] ${line}`);
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
 * Each call opens a new connection (the controller uses request-response style).
 */
export function sendCommand(
	command: string,
	config?: Partial<ControllerConfig>,
	timeoutMs?: number
): Promise<string> {
	return sendCommandDetailed(command, config, { timeoutMs }).then(r => r.raw);
}

let controllerCommandQueue: Promise<void> = Promise.resolve();

function enqueueControllerCommand<T>(task: () => Promise<T>): Promise<T> {
	const run = controllerCommandQueue.then(task, task);
	controllerCommandQueue = run.then(() => undefined, () => undefined);
	return run;
}

export function sendCommandDetailed(
	command: string,
	config?: Partial<ControllerConfig>,
	options?: SendCommandOptions,
): Promise<CommandResponse> {
	return enqueueControllerCommand(() => sendCommandDetailedInternal(command, config, options));
}

function sendCommandDetailedInternal(
	command: string,
	config?: Partial<ControllerConfig>,
	options?: SendCommandOptions,
): Promise<CommandResponse> {
	const cfg = { ...getControllerConfig(), ...config };
	const timeout = options?.timeoutMs ?? cfg.timeoutMs;
	const minResponseBytes = Math.max(1, options?.minResponseBytes ?? 10);
	const idleMs = Math.max(50, options?.idleMs ?? 300);
	const extraIdleMsOnIncomplete = Math.max(0, options?.extraIdleMsOnIncomplete ?? 0);

	// 응답 누적 수신: <STATUS> 찾을 때까지 기다리되,
	// 최소 바이트 수 && idle 조건으로도 완성 응답으로 판단
	return new Promise<CommandResponse>((resolve, reject) => {
		const socket = new net.Socket();
		let responseBuffer = '';
		let settled = false;
		let gracefulCloseTimer: ReturnType<typeof setTimeout> | null = null;
		let idleTimer: ReturnType<typeof setTimeout> | null = null;
		const startMs = Date.now();
		let lastChunkAtMs = startMs;
		let extraIdleApplied = false;

		const buildMeta = (): CommandResponseMeta => {
			const raw = responseBuffer || '';
			const statusTagReceived = raw.includes('</STATUS>');
			const dataTagClosed = raw.includes('</DATA>');
			return {
				responseComplete: statusTagReceived || dataTagClosed,
				bytesReceived: Buffer.byteLength(raw, 'utf8'),
				lastChunkAt: new Date(lastChunkAtMs).toISOString(),
				idleTimeoutMs: idleMs,
				statusTagReceived,
				dataTagClosed,
				extraIdleApplied,
				durationMs: Date.now() - startMs,
			};
		};

		logTraffic('>>>', `${cfg.ip}:${cfg.port}  ${command}`);

		const timer = setTimeout(() => {
			if (!settled) {
				settled = true;
				if (idleTimer) clearTimeout(idleTimer);
				socket.destroy();
				logTraffic('---', `TIMEOUT (${timeout}ms): ${command}`);
				reject(new Error(`Command timeout (${timeout}ms): ${command}`));
			}
		}, timeout);

		const completeResponse = () => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (idleTimer) clearTimeout(idleTimer);

			const elapsed = Date.now() - startMs;
			const statusMatch = responseBuffer.match(/<STATUS>\s*(-?\d+)(?:,\s*"([^"]*)")?/);
			const statusStr = statusMatch ? `STATUS ${statusMatch[1]}` : 'OK';
			const lines = responseBuffer.split(/\r?\n/).filter(l => l.trim() && !l.includes('<STATUS>') && !l.includes('</STATUS>') && !l.includes('<DATA>') && !l.includes('</DATA>')).length;
			logTraffic('<<<', `${statusStr}  ${lines} lines  ${elapsed}ms`);
			gracefulCloseTimer = setTimeout(() => {
				logTraffic('---', `FIN wait over (${cfg.ip}:${cfg.port}) after STATUS for ${command}`);
			}, 1000);
			socket.end();
			resolve({ raw: responseBuffer.trim(), meta: buildMeta() });
		};

		const connectOptions = cfg.preferIPv4
			? { host: cfg.ip, port: cfg.port, family: 4 }
			: { host: cfg.ip, port: cfg.port };

		socket.connect(connectOptions, () => {
			const payload = Buffer.from(command + '\r\n', 'ascii');
			socket.write(payload);
		});

		socket.on('data', (data: Buffer) => {
			lastChunkAtMs = Date.now();
			responseBuffer += data.toString('ascii').replace(/\0/g, '');

			// 이전 idle timer 취소
			if (idleTimer) {
				clearTimeout(idleTimer);
				idleTimer = null;
			}

			// 완성 응답 조건 1: <STATUS> 태그 감지
			if (responseBuffer.includes('</STATUS>')) {
				completeResponse();
				return;
			}

			// 완성 응답 조건 2: 최소 바이트 수 && idle 대기
			// (부분 수신으로 인한 "무응답" 오해 방지)
			if (responseBuffer.length >= minResponseBytes) {
				idleTimer = setTimeout(() => {
					if (!responseBuffer.includes('</STATUS>') && extraIdleMsOnIncomplete > 0 && !extraIdleApplied) {
						extraIdleApplied = true;
						idleTimer = setTimeout(() => {
							if (!settled) {
								completeResponse();
							}
						}, extraIdleMsOnIncomplete);
						return;
					}
					if (!settled) {
						completeResponse();
					}
				}, idleMs);
			}
		});

		socket.on('error', (err: Error) => {
			if (gracefulCloseTimer) {
				clearTimeout(gracefulCloseTimer);
				gracefulCloseTimer = null;
			}
			if (idleTimer) clearTimeout(idleTimer);
			if (!settled) {
				settled = true;
				clearTimeout(timer);
				logTraffic('---', `ERROR: ${err.message}`);
				reject(new Error(`Connection error (${cfg.ip}:${cfg.port}): ${err.message}`));
			}
		});

		socket.on('close', () => {
			if (gracefulCloseTimer) {
				clearTimeout(gracefulCloseTimer);
				gracefulCloseTimer = null;
			}
			if (idleTimer) clearTimeout(idleTimer);
			if (!settled) {
				settled = true;
				clearTimeout(timer);
				if (responseBuffer.length > 0) {
					const elapsed = Date.now() - startMs;
					logTraffic('<<<', `(closed) ${responseBuffer.length} bytes  ${elapsed}ms`);
					resolve({ raw: responseBuffer.trim(), meta: buildMeta() });
				} else {
					logTraffic('---', `CLOSED without response: ${command}`);
					reject(new Error(`Connection closed without response: ${command}`));
				}
			}
		});
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

/**
 * Test connectivity to the controller (lightweight probe).
 */
export async function testConnection(config?: Partial<ControllerConfig>): Promise<boolean> {
	try {
		const resp = await sendCommand('ErrorLog', config, 5000);
		return resp.includes('<STATUS>');
	} catch {
		return false;
	}
}
