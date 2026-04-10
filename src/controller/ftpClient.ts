/**
 * FTP 클라이언트 — Node.js net 모듈 기반 최소 구현.
 * basic-ftp 등 외부 의존성 없이 동작한다.
 * Brooks 제어기 FTP 서버는 anonymous 접속만 지원한다.
 */

import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';

const FTP_PORT = 21;
const TIMEOUT_MS = 10000;

interface FtpResponse {
    code: number;
    message: string;
}

/**
 * 단일 FTP 세션을 관리하는 클라이언트.
 */
export class FtpClient {
    private socket: net.Socket | null = null;
    private host: string;
    private port: number;
    private dataBuffer = '';

    constructor(host: string, port: number = FTP_PORT) {
        this.host = host;
        this.port = port;
    }

    async connect(): Promise<void> {
        this.socket = new net.Socket();
        await this.socketConnect(this.host, this.port);
        await this.readResponse(); // 220 welcome
        await this.command('USER anonymous');
        // 서버가 331을 보내면 PASS 필요
        try { await this.command('PASS anonymous'); } catch { /* 일부 서버는 PASS 불필요 */ }
    }

    async disconnect(): Promise<void> {
        if (this.socket) {
            try { await this.command('QUIT'); } catch { /* best-effort */ }
            this.socket.destroy();
            this.socket = null;
        }
    }

    /**
     * 제어기에 파일 업로드.
     */
    async uploadFile(localPath: string, remotePath: string): Promise<void> {
        // 디렉터리 재귀 생성
        const dir = remotePath.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
        if (dir) {
            await this.mkdirRecursive(dir);
        }

        // Passive 모드로 데이터 연결
        const dataConn = await this.enterPassive();
        await this.sendRaw(`STOR ${remotePath}`);

        const fileData = fs.readFileSync(localPath);
        await this.writeData(dataConn, fileData);
        dataConn.destroy();

        await this.readResponse(); // 226 Transfer complete
    }

    /**
     * 원격 파일 크기 조회.
     * 실패 시 -1 반환.
     */
    async getFileSize(remotePath: string): Promise<number> {
        try {
            const resp = await this.command(`SIZE ${remotePath}`);
            if (resp.code === 213) {
                return parseInt(resp.message.trim(), 10);
            }
        } catch { /* ignore */ }
        return -1;
    }

    /**
     * 원격 파일의 특정 오프셋부터 다운로드.
     */
    async downloadFrom(remotePath: string, offset: number = 0): Promise<Buffer> {
        if (offset > 0) {
            await this.command(`REST ${offset}`);
        }
        const dataConn = await this.enterPassive();
        await this.sendRaw(`RETR ${remotePath}`);

        const chunks: Buffer[] = [];
        return new Promise<Buffer>((resolve, reject) => {
            const timer = setTimeout(() => {
                dataConn.destroy();
                resolve(Buffer.concat(chunks));
            }, TIMEOUT_MS);

            dataConn.on('data', (chunk: Buffer) => chunks.push(chunk));
            dataConn.on('end', () => {
                clearTimeout(timer);
                resolve(Buffer.concat(chunks));
            });
            dataConn.on('error', (err) => {
                clearTimeout(timer);
                reject(err);
            });
        }).finally(() => {
            // 226 Transfer complete 소비
            this.readResponse().catch(() => {});
        });
    }

    // ── 내부 헬퍼 ──────────────────────────────

    private socketConnect(host: string, port: number): Promise<void> {
        return new Promise((resolve, reject) => {
            const sock = this.socket!;
            const timer = setTimeout(() => {
                sock.destroy();
                reject(new Error(`FTP connect timeout: ${host}:${port}`));
            }, TIMEOUT_MS);

            sock.connect(port, host, () => {
                clearTimeout(timer);
                resolve();
            });
            sock.on('error', (err) => {
                clearTimeout(timer);
                reject(err);
            });
        });
    }

    private async command(cmd: string): Promise<FtpResponse> {
        await this.sendRaw(cmd);
        return this.readResponse();
    }

    private sendRaw(cmd: string): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.socket) { return reject(new Error('Not connected')); }
            this.socket.write(cmd + '\r\n', 'ascii', (err) => {
                if (err) { reject(err); } else { resolve(); }
            });
        });
    }

    private readResponse(): Promise<FtpResponse> {
        return new Promise((resolve, reject) => {
            if (!this.socket) { return reject(new Error('Not connected')); }

            const timer = setTimeout(() => reject(new Error('FTP response timeout')), TIMEOUT_MS);

            const onData = (data: Buffer) => {
                this.dataBuffer += data.toString('ascii');
                const lines = this.dataBuffer.split('\r\n');

                for (let i = 0; i < lines.length - 1; i++) {
                    const line = lines[i];
                    // FTP 응답: "NNN text" (3자리 숫자 + 공백)
                    const match = line.match(/^(\d{3})\s(.*)$/);
                    if (match) {
                        this.dataBuffer = lines.slice(i + 1).join('\r\n');
                        this.socket!.removeListener('data', onData);
                        clearTimeout(timer);
                        resolve({ code: parseInt(match[1], 10), message: match[2] });
                        return;
                    }
                }
            };

            this.socket.on('data', onData);
        });
    }

    private async enterPassive(): Promise<net.Socket> {
        const resp = await this.command('PASV');
        // 227 Entering Passive Mode (h1,h2,h3,h4,p1,p2)
        const m = resp.message.match(/\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/);
        if (!m) { throw new Error(`Cannot parse PASV response: ${resp.message}`); }

        const dataPort = parseInt(m[5], 10) * 256 + parseInt(m[6], 10);

        return new Promise<net.Socket>((resolve, reject) => {
            const sock = new net.Socket();
            const timer = setTimeout(() => {
                sock.destroy();
                reject(new Error('PASV data connection timeout'));
            }, TIMEOUT_MS);

            sock.connect(dataPort, this.host, () => {
                clearTimeout(timer);
                resolve(sock);
            });
            sock.on('error', (err) => {
                clearTimeout(timer);
                reject(err);
            });
        });
    }

    private writeData(sock: net.Socket, data: Buffer): Promise<void> {
        return new Promise((resolve, reject) => {
            sock.write(data, (err) => {
                if (err) { reject(err); } else { resolve(); }
            });
        });
    }

    private async mkdirRecursive(dirPath: string): Promise<void> {
        const parts = dirPath.replace(/\\/g, '/').split('/').filter(p => p.length > 0);
        let current = '';
        for (const part of parts) {
            current += '/' + part;
            try {
                await this.command(`MKD ${current}`);
            } catch {
                // 이미 존재 (550) 등은 무시
            }
        }
    }
}

/**
 * 프로젝트 폴더 전체를 제어기에 업로드.
 * 반환: { uploaded, skipped, totalBytes }
 */
export async function uploadProject(
    host: string,
    localDir: string,
    remoteDir: string,
    options?: { skipUnchanged?: boolean; onProgress?: (current: number, total: number, file: string) => void }
): Promise<{ uploaded: number; skipped: number; totalBytes: number }> {
    const client = new FtpClient(host);
    await client.connect();

    try {
        const files = getAllFiles(localDir);
        let uploaded = 0;
        let skipped = 0;
        let totalBytes = 0;

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const relative = path.relative(localDir, file).replace(/\\/g, '/');
            const remotePath = `${remoteDir}/${relative}`;
            const stat = fs.statSync(file);
            totalBytes += stat.size;

            let skip = false;
            if (options?.skipUnchanged) {
                const remoteSize = await client.getFileSize(remotePath);
                if (remoteSize === stat.size) {
                    skip = true;
                }
            }

            if (skip) {
                skipped++;
            } else {
                await client.uploadFile(file, remotePath);
                uploaded++;
            }

            options?.onProgress?.(i + 1, files.length, relative);
        }

        return { uploaded, skipped, totalBytes };
    } finally {
        await client.disconnect();
    }
}

function getAllFiles(dir: string): string[] {
    const results: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...getAllFiles(full));
        } else {
            results.push(full);
        }
    }
    return results;
}
