import * as net from 'net';
import * as vscode from 'vscode';

export interface ControllerConfig {
	ip: string;
	port: number;
	consolePort: number;
	timeoutMs: number;
	ftpBasePath: string;
}

// Brooks 제어기 고정 포트 (하드웨어 결정, 변경 불가)
const DEFAULT_PORT = 1402;
const DEFAULT_CONSOLE_PORT = 1403;
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_FTP_BASE_PATH = '/GPL';

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
	if (!_trafficChannel) { return; }
	const now = new Date();
	const ts = now.toLocaleTimeString('ko-KR', { hour12: false }) + '.' + String(now.getMilliseconds()).padStart(3, '0');
	_trafficChannel.appendLine(`[${ts}] ${direction} ${message}`);
}

export function getControllerConfig(): ControllerConfig {
	const cfg = vscode.workspace.getConfiguration('gpl.controller');
	const rawIp = cfg.get('ip');
	const ip = typeof rawIp === 'string' ? rawIp : (rawIp as any)?.ip ?? '192.168.0.1';
	return {
		ip,
		port: cfg.get<number>('port') ?? DEFAULT_PORT,
		consolePort: cfg.get<number>('consolePort') ?? DEFAULT_CONSOLE_PORT,
		timeoutMs: cfg.get<number>('timeoutMs') ?? DEFAULT_TIMEOUT_MS,
		ftpBasePath: cfg.get<string>('ftpBasePath') ?? DEFAULT_FTP_BASE_PATH,
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

		socket.connect(cfg.port, cfg.ip, () => {
			const payload = Buffer.from(command + '\r\n', 'ascii');
			socket.write(payload);
		});

		socket.on('data', (data: Buffer) => {
			responseBuffer += data.toString('ascii').replace(/\0/g, '');
			if (responseBuffer.includes('</STATUS>')) {
				settled = true;
				clearTimeout(timer);
				socket.destroy();
				const elapsed = Date.now() - startMs;
				// 응답에서 STATUS 코드만 추출하여 간결하게 로깅
				const statusMatch = responseBuffer.match(/<STATUS>\s*(-?\d+)(?:,\s*"([^"]*)")?/);
				const statusStr = statusMatch ? `STATUS ${statusMatch[1]}` : 'OK';
				const lines = responseBuffer.split(/\r?\n/).filter(l => l.trim() && !l.includes('<STATUS>') && !l.includes('</STATUS>') && !l.includes('<DATA>') && !l.includes('</DATA>')).length;
				logTraffic('<<<', `${statusStr}  ${lines} lines  ${elapsed}ms`);
				resolve(responseBuffer.trim());
			}
		});

		socket.on('error', (err: Error) => {
			if (!settled) {
				settled = true;
				clearTimeout(timer);
				logTraffic('---', `ERROR: ${err.message}`);
				reject(new Error(`Connection error (${cfg.ip}:${cfg.port}): ${err.message}`));
			}
		});

		socket.on('close', () => {
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
