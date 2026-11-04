/**
 * basic-ftp 6.x 호환 회귀(2026-11-04 §1-GZ) — 5.3 → 6.2 로 올리면서(보안 권고 2건), 확장이 쓰는 동작(PASV·LIST·STOR·SIZE·RETR·
 * DELE·MKD)이 제어기 FTP(RTEMS FTP server)처럼 최소 응답만 하는 서버에서도 그대로 도는지 본다. 확장의 createClient 와 같은
 * 옵션(allowSeparateTransferHost:true)으로 접속한다. 실제 제어기 확인은 ai-handoff-verification 의 FTP 항목.
 */
import * as assert from 'assert';
import * as net from 'net';
import { Readable, Writable } from 'stream';
import { Client as FtpClient } from 'basic-ftp';
import { test } from '../../harness';

interface MiniFtp { port: number; files: Map<string, Buffer>; commands: string[]; close(): Promise<void> }

/** RTEMS FTP 처럼 FEAT/EPSV/MLSD 를 모르는 최소 서버(127.0.0.1, PASV 만). */
function startMiniFtp(): Promise<MiniFtp> {
    return new Promise(resolve => {
        const files = new Map<string, Buffer>();
        const commands: string[] = [];
        const sockets = new Set<net.Socket>();
        const servers: net.Server[] = [];
        const control = net.createServer(sock => {
            sockets.add(sock);
            sock.on('close', () => sockets.delete(sock));
            sock.on('error', () => undefined);
            let cwd = '/';
            let pending: { server: net.Server; conn: Promise<net.Socket> } | undefined;
            const reply = (line: string) => sock.write(`${line}\r\n`);
            const abs = (p: string) => (p.startsWith('/') ? p : `${cwd.replace(/\/$/, '')}/${p}`).replace(/\/+/g, '/');
            const withData = async (fn: (d: net.Socket) => Promise<void> | void) => {
                if (!pending) { reply('425 No data connection'); return; }
                const { server, conn } = pending;
                pending = undefined;
                reply('150 Opening data connection');
                const d = await conn;
                await fn(d);
                server.close();
                reply('226 Transfer complete');
            };
            reply('220 RTEMS FTP server (Version 1.0) ready.');
            let buf = '';
            sock.on('data', async chunk => {
                buf += chunk.toString('utf8');
                let idx: number;
                while ((idx = buf.indexOf('\r\n')) >= 0) {
                    const line = buf.slice(0, idx);
                    buf = buf.slice(idx + 2);
                    commands.push(line);
                    const [verb, ...rest] = line.split(' ');
                    const arg = rest.join(' ');
                    switch (verb.toUpperCase()) {
                        case 'USER': reply('331 User name okay, need password.'); break;
                        case 'PASS': reply('230 User logged in.'); break;
                        case 'TYPE': reply('200 Type set.'); break;
                        case 'STRU': reply('200 OK'); break;
                        case 'PWD': reply(`257 "${cwd}" is current directory.`); break;
                        case 'CWD': cwd = abs(arg); reply('250 CWD command successful.'); break;
                        case 'MKD': reply(`257 "${abs(arg)}" created.`); break;
                        case 'SIZE': {
                            const f = files.get(abs(arg));
                            reply(f ? `213 ${f.length}` : '550 No such file.');
                            break;
                        }
                        case 'PASV': {
                            const server = net.createServer();
                            servers.push(server);
                            const conn = new Promise<net.Socket>(ok => server.once('connection', s => { s.on('error', () => undefined); ok(s); }));
                            await new Promise<void>(ok => server.listen(0, '127.0.0.1', () => ok()));
                            const p = (server.address() as net.AddressInfo).port;
                            pending = { server, conn };
                            reply(`227 Entering Passive Mode (127,0,0,1,${p >> 8},${p & 255}).`);
                            break;
                        }
                        case 'LIST': {
                            const pathArg = arg.split(' ').filter(a => a && !a.startsWith('-')).join(' '); // `LIST -a /GPL/x`
                            const dir = abs(pathArg || '.').replace(/\/\.$/, '') || '/';
                            await withData(d => new Promise<void>(ok => {
                                const rows = [...files.entries()]
                                    .filter(([k]) => k.startsWith(dir === '/' ? '/' : `${dir}/`))
                                    .map(([k, v]) => `-rw-r--r-- 1 root root ${v.length} Jan 1 00:00 ${k.slice(dir.length).replace(/^\//, '')}`);
                                d.end(rows.join('\r\n') + (rows.length ? '\r\n' : ''), () => ok());
                            }));
                            break;
                        }
                        case 'STOR': {
                            const target = abs(arg);
                            await withData(d => new Promise<void>(ok => {
                                const parts: Buffer[] = [];
                                d.on('data', c => parts.push(c));
                                d.on('end', () => { files.set(target, Buffer.concat(parts)); ok(); });
                            }));
                            break;
                        }
                        case 'RETR': {
                            const f = files.get(abs(arg));
                            if (!f) { reply('550 No such file.'); break; }
                            await withData(d => new Promise<void>(ok => d.end(f, () => ok())));
                            break;
                        }
                        case 'DELE': files.delete(abs(arg)); reply('250 DELE command successful.'); break;
                        case 'QUIT': reply('221 Goodbye.'); sock.end(); break;
                        default: reply('502 Command not implemented.');
                    }
                }
            });
        });
        control.listen(0, '127.0.0.1', () => resolve({
            port: (control.address() as net.AddressInfo).port,
            files,
            commands,
            close: () => new Promise<void>(done => {
                for (const s of sockets) { s.destroy(); }
                for (const s of servers) { try { s.close(); } catch { /* 이미 닫힘 */ } }
                control.close(() => done());
            }),
        }));
    });
}

test('basic-ftp 6 호환: 최소 FTP 서버(PASV 만)에서 업로드·크기·목록·내려받기·삭제가 된다', async () => {
    const ftp = await startMiniFtp();
    const client = new FtpClient(5000, { allowSeparateTransferHost: true });
    try {
        const welcome = await client.access({ host: '127.0.0.1', port: ftp.port, user: 'anonymous', password: 'anonymous' });
        assert.match(welcome.message, /RTEMS FTP server/);
        await client.ensureDir('/GPL/Probe');
        await client.cd('/');
        await client.uploadFrom(Readable.from([Buffer.from('Module Main\r\nEnd Module\r\n', 'utf8')]), '/GPL/Probe/Main.gpl');
        assert.strictEqual(await client.size('/GPL/Probe/Main.gpl'), 25);
        const list = await client.list('/GPL/Probe');
        assert.deepStrictEqual(list.map(e => [e.name, e.size]), [['Main.gpl', 25]]);
        const chunks: Buffer[] = [];
        await client.downloadTo(new Writable({ write(c, _e, cb) { chunks.push(c); cb(); } }), '/GPL/Probe/Main.gpl');
        assert.strictEqual(Buffer.concat(chunks).toString('utf8'), 'Module Main\r\nEnd Module\r\n');
        await client.remove('/GPL/Probe/Main.gpl');
        assert.strictEqual(ftp.files.size, 0);
        assert.ok(ftp.commands.some(c => c === 'PASV'), '데이터 연결은 PASV');
    } finally {
        client.close();
        await ftp.close();
    }
});
