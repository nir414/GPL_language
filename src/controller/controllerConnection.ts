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
	const line = `[${ts}] ${direction} ${message}`;
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
	const cfg = { ...getControllerConfig(), ...config };
	const timeout = timeoutMs ?? cfg.timeoutMs;

	return new Promise<string>((resolve, reject) => {
		const socket = new net.Socket();
		let responseBuffer = '';
		let settled = false;
		let gracefulCloseTimer: ReturnType<typeof setTimeout> | null = null;
		const startMs = Date.now();

		logTraffic('>>>', `${cfg.ip}:${cfg.port}  ${command}`);

		const timer = setTimeout(() => {
			if (!settled) {
				settled = true;
				socket.destroy();
				logTraffic('---', `TIMEOUT (${timeout}ms): ${command}`);
				reject(new Error(`Command timeout (${timeout}ms): ${command}`));
			}
		}, timeout);

		const connectOptions = cfg.preferIPv4
			? { host: cfg.ip, port: cfg.port, family: 4 }
			: { host: cfg.ip, port: cfg.port };

		socket.connect(connectOptions, () => {
			const payload = Buffer.from(command + '\r\n', 'ascii');
			socket.write(payload);
		});

		socket.on('data', (data: Buffer) => {
			responseBuffer += data.toString('ascii').replace(/\0/g, '');
			if (responseBuffer.includes('</STATUS>')) {
				settled = true;
				clearTimeout(timer);
				const elapsed = Date.now() - startMs;
				// 응답에서 STATUS 코드만 추출하여 간결하게 로깅
				const statusMatch = responseBuffer.match(/<STATUS>\s*(-?\d+)(?:,\s*"([^"]*)")?/);
				const statusStr = statusMatch ? `STATUS ${statusMatch[1]}` : 'OK';
				const lines = responseBuffer.split(/\r?\n/).filter(l => l.trim() && !l.includes('<STATUS>') && !l.includes('</STATUS>') && !l.includes('<DATA>') && !l.includes('</DATA>')).length;
				logTraffic('<<<', `${statusStr}  ${lines} lines  ${elapsed}ms`);
				gracefulCloseTimer = setTimeout(() => {
					logTraffic('---', `FIN wait over (${cfg.ip}:${cfg.port}) after STATUS for ${command}`);
				}, 1000);
				socket.end();
				resolve(responseBuffer.trim());
			}
		});

		socket.on('error', (err: Error) => {
			if (gracefulCloseTimer) {
				clearTimeout(gracefulCloseTimer);
				gracefulCloseTimer = null;
			}
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
			if (!settled) {
				settled = true;
				clearTimeout(timer);
				if (responseBuffer.length > 0) {
					const elapsed = Date.now() - startMs;
					logTraffic('<<<', `(closed) ${responseBuffer.length} bytes  ${elapsed}ms`);
					resolve(responseBuffer.trim());
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
