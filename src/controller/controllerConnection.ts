import * as net from 'net';
import * as vscode from 'vscode';

const DEFAULT_TIMEOUT_MS = 10000;

export interface ControllerConfig {
    ip: string;
    port: number;
    consolePort: number;
    timeoutMs: number;
    ftpBasePath: string;
}

export function getControllerConfig(): ControllerConfig {
    const cfg = vscode.workspace.getConfiguration('gpl.controller');
    return {
        ip: cfg.get<string>('ip', '192.168.0.2'),
        port: cfg.get<number>('port', 1402),
        consolePort: cfg.get<number>('consolePort', 1403),
        timeoutMs: cfg.get<number>('timeoutMs', DEFAULT_TIMEOUT_MS),
        ftpBasePath: cfg.get<string>('ftpBasePath', '/GPL'),
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

        const timer = setTimeout(() => {
            if (!settled) {
                settled = true;
                socket.destroy();
                reject(new Error(`Command timeout (${timeout}ms): ${command}`));
            }
        }, timeout);

        socket.connect(cfg.port, cfg.ip, () => {
            const payload = Buffer.from(command + '\r\n', 'ascii');
            socket.write(payload);
        });

        socket.on('data', (data: Buffer) => {
            responseBuffer += data.toString('ascii');
            if (responseBuffer.includes('</STATUS>')) {
                settled = true;
                clearTimeout(timer);
                socket.destroy();
                resolve(responseBuffer.trim());
            }
        });

        socket.on('error', (err: Error) => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                reject(new Error(`Connection error (${cfg.ip}:${cfg.port}): ${err.message}`));
            }
        });

        socket.on('close', () => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                if (responseBuffer.length > 0) {
                    resolve(responseBuffer.trim());
                } else {
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
