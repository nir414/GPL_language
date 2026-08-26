import * as assert from 'assert';
import * as net from 'net';
import { test } from './harness';
import {
    sendConsoleCommand,
    closeControllerConnection,
    getConnectionStats,
    isCleanlyTerminated,
    formatSeconds,
    LineRingBuffer,
    recordTrafficLine,
    getRecentTraffic,
    TRAFFIC_RING_CAPACITY,
    ConsoleSendOptions,
    ConsoleEndpoint,
    TrafficDirection,
} from '../controller/consoleSocket';

// ── 순수 헬퍼 ──────────────────────────────────────────────────────────────

test('isCleanlyTerminated: 버퍼 끝 </STATUS>(공백/개행 허용)만 true', () => {
    assert.strictEqual(isCleanlyTerminated('<DATA>x</DATA>\r\n<STATUS>0,"Success"</STATUS>\r\n'), true);
    assert.strictEqual(isCleanlyTerminated('<STATUS>-742,"err"</STATUS>'), true);
    assert.strictEqual(isCleanlyTerminated('<DATA>partial'), false);
    assert.strictEqual(isCleanlyTerminated(''), false);
    // DATA 본문 중간에 STATUS 텍스트가 있어도(로그 덤프 등) 끝이 아니면 false
    assert.strictEqual(isCleanlyTerminated('<DATA>log: <STATUS>0,""</STATUS> seen</DATA>\r\nmore'), false);
    assert.strictEqual(isCleanlyTerminated('<STATUS>0,""</STATUS>\r\n<DATA>trailing'), false);
});

test('formatSeconds', () => {
    assert.strictEqual(formatSeconds(30000), '30s');
    assert.strictEqual(formatSeconds(1500), '1.5s');
    assert.strictEqual(formatSeconds(120), '0.1s');
});

test('LineRingBuffer: 상한 초과 시 오래된 줄부터 버리고 recent(n)은 마지막 n줄', () => {
    const ring = new LineRingBuffer(5);
    for (let i = 1; i <= 8; i++) { ring.push(`L${i}`); }
    assert.strictEqual(ring.length, 5);
    assert.deepStrictEqual(ring.recent(3), ['L6', 'L7', 'L8']);
    assert.deepStrictEqual(ring.recent(100), ['L4', 'L5', 'L6', 'L7', 'L8']);
    assert.deepStrictEqual(ring.recent(0), []);
    assert.throws(() => new LineRingBuffer(0));
});

test('트래픽 링버퍼: 상한 600줄, getRecentTraffic 기본 300줄', () => {
    assert.strictEqual(TRAFFIC_RING_CAPACITY, 600);
    for (let i = 0; i < 700; i++) { recordTrafficLine(`[00:00:00.000] --- ring ${i}`); }
    const all = getRecentTraffic(10_000);
    assert.strictEqual(all.length, 600);
    assert.strictEqual(all[0], '[00:00:00.000] --- ring 100');
    assert.strictEqual(all[all.length - 1], '[00:00:00.000] --- ring 699');
    assert.strictEqual(getRecentTraffic().length, 300);
    assert.strictEqual(getRecentTraffic()[0], '[00:00:00.000] --- ring 400');
});

// ── 가짜 1402 서버 ──────────────────────────────────────────────────────────

const OK_RESPONSE = '<DATA>x</DATA>\r\n<STATUS>0,"Success"</STATUS>\r\n';

interface FakeConsole {
    port: number;
    /** accept 된 연결 수 */
    connections: number;
    /** 연결별 수신 명령 */
    received: string[][];
    close(): Promise<void>;
}

type LineHandler = (line: string, socket: net.Socket, connIndex: number, lineIndex: number) => void;

function startFakeConsole(onLine: LineHandler = (_l, s) => s.write(OK_RESPONSE)): Promise<FakeConsole> {
    return new Promise((resolve, reject) => {
        const sockets = new Set<net.Socket>();
        const fake: FakeConsole = {
            port: 0,
            connections: 0,
            received: [],
            close: () => new Promise<void>(done => {
                for (const s of sockets) { s.destroy(); }
                server.close(() => done());
            }),
        };
        const server = net.createServer(socket => {
            const connIndex = fake.connections++;
            fake.received[connIndex] = [];
            sockets.add(socket);
            socket.on('close', () => sockets.delete(socket));
            socket.on('error', () => { /* 테스트 서버: 클라이언트 RST 무시 */ });
            let buf = '';
            socket.on('data', chunk => {
                buf += chunk.toString('ascii');
                let idx: number;
                while ((idx = buf.indexOf('\r\n')) >= 0) {
                    const line = buf.slice(0, idx);
                    buf = buf.slice(idx + 2);
                    const lineIndex = fake.received[connIndex].push(line) - 1;
                    onLine(line, socket, connIndex, lineIndex);
                }
            });
        });
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            fake.port = (server.address() as net.AddressInfo).port;
            resolve(fake);
        });
    });
}

function endpointOf(fake: FakeConsole): ConsoleEndpoint {
    return { ip: '127.0.0.1', port: fake.port, preferIPv4: true };
}

function opts(overrides: Partial<ConsoleSendOptions> = {}): ConsoleSendOptions {
    return {
        timeoutMs: 2000,
        idleMs: 60,
        minResponseBytes: 1,
        extraIdleMsOnIncomplete: 0,
        waitForStatusClose: false,
        keepAlive: true,
        keepAliveIdleCloseMs: 5000,
        ...overrides,
    };
}

function logCollector(): { lines: string[]; log: (d: TrafficDirection, m: string) => void } {
    const lines: string[] = [];
    return { lines, log: (d, m) => lines.push(`${d} ${m}`) };
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** 서버 측에서 연결이 모두 닫힐 때까지(최대 waitMs) 기다린다. */
async function waitUntil(cond: () => boolean, waitMs = 1500, stepMs = 10): Promise<boolean> {
    const until = Date.now() + waitMs;
    while (Date.now() < until) {
        if (cond()) { return true; }
        await sleep(stepMs);
    }
    return cond();
}

// ── 통합 테스트(로컬 net 서버) ──────────────────────────────────────────────

test('keep-alive: 연속 3개 명령이 같은 TCP 연결로 나가고 소켓이 보관된다', async () => {
    closeControllerConnection('test-reset');
    const fake = await startFakeConsole();
    const { lines, log } = logCollector();
    const before = getConnectionStats();
    try {
        const r1 = await sendConsoleCommand('Show Thread', endpointOf(fake), opts(), { log });
        const r2 = await sendConsoleCommand('ErrorLog', endpointOf(fake), opts(), { log });
        const r3 = await sendConsoleCommand('Show Break', endpointOf(fake), opts(), { log });

        assert.strictEqual(fake.connections, 1, '서버가 accept 한 연결은 하나');
        assert.deepStrictEqual(fake.received[0], ['Show Thread', 'ErrorLog', 'Show Break']);
        for (const r of [r1, r2, r3]) {
            assert.strictEqual(r.raw, OK_RESPONSE.trim());
            assert.strictEqual(r.meta.responseComplete, true);
            assert.strictEqual(r.meta.statusTagReceived, true);
            assert.strictEqual(r.meta.socketKept, true);
        }
        assert.deepStrictEqual([r1.meta.socketReused, r2.meta.socketReused, r3.meta.socketReused], [false, true, true]);

        const after = getConnectionStats();
        assert.strictEqual(after.connects - before.connects, 1);
        assert.strictEqual(after.reuses - before.reuses, 2);
        assert.strictEqual(after.retries - before.retries, 0);
        assert.strictEqual(after.keepAliveActive, true);
        assert.ok(typeof after.heldSinceMs === 'number' && after.heldSinceMs <= Date.now());
        assert.ok(typeof after.lastConnectAt === 'number');

        assert.strictEqual(lines.filter(l => l.startsWith('--- 1402 CONNECT #')).length, 1);
        assert.ok(lines.some(l => /^--- 1402 CONNECT #\d+ 127\.0\.0\.1:\d+ \(keep-alive\)$/.test(l)), lines.join('\n'));
        assert.strictEqual(lines.filter(l => l.startsWith('>>> ')).length, 3);
        assert.strictEqual(lines.filter(l => l.startsWith('<<< STATUS 0')).length, 3);
        assert.strictEqual(lines.filter(l => l.includes('1402 CLOSE')).length, 0, '아직 닫힌 연결 없음');

        closeControllerConnection('disconnect');
        assert.strictEqual(getConnectionStats().keepAliveActive, false);
        assert.ok(lines.includes('--- 1402 CLOSE (disconnect)'), lines.join('\n'));
        assert.ok(await waitUntil(() => fake.received.length === 1 && fake.connections === 1));
    } finally {
        closeControllerConnection('test-cleanup');
        await fake.close();
    }
});

test('keep-alive off(single-shot): 명령마다 새 연결, 소켓 보관 없음 — 종전 동작', async () => {
    closeControllerConnection('test-reset');
    const fake = await startFakeConsole();
    const { lines, log } = logCollector();
    const before = getConnectionStats();
    try {
        const r1 = await sendConsoleCommand('Show Thread', endpointOf(fake), opts({ keepAlive: false }), { log });
        const r2 = await sendConsoleCommand('ErrorLog', endpointOf(fake), opts({ keepAlive: false }), { log });
        assert.strictEqual(fake.connections, 2);
        assert.strictEqual(r1.meta.socketKept, false);
        assert.strictEqual(r2.meta.socketReused, false);
        const after = getConnectionStats();
        assert.strictEqual(after.connects - before.connects, 2);
        assert.strictEqual(after.reuses - before.reuses, 0);
        assert.strictEqual(after.keepAliveActive, false);
        assert.ok(lines.some(l => /CONNECT #\d+ .* \(single-shot\)$/.test(l)), lines.join('\n'));
        assert.ok(await waitUntil(() => lines.filter(l => l === '--- 1402 CLOSE (single-shot)').length === 2), lines.join('\n'));
    } finally {
        closeControllerConnection('test-cleanup');
        await fake.close();
    }
});

test('stale 소켓: 재사용 소켓이 0바이트 상태로 닫히면 새 연결로 같은 명령을 1회 재시도한다', async () => {
    closeControllerConnection('test-reset');
    // 연결#0: 첫 명령엔 응답, 두 번째 명령은 응답 없이 끊는다(제어기가 유휴 연결을 먼저 닫은 경합 재현). 연결#1: 정상.
    const fake = await startFakeConsole((_line, socket, connIndex, lineIndex) => {
        if (connIndex === 0 && lineIndex >= 1) { socket.destroy(); return; }
        socket.write(OK_RESPONSE);
    });
    const { lines, log } = logCollector();
    const before = getConnectionStats();
    try {
        await sendConsoleCommand('Show Thread', endpointOf(fake), opts(), { log });
        const r2 = await sendConsoleCommand('Show Break', endpointOf(fake), opts(), { log });
        assert.strictEqual(r2.raw, OK_RESPONSE.trim());
        assert.strictEqual(r2.meta.responseComplete, true);
        assert.strictEqual(r2.meta.socketReused, false, '재시도 결과는 새 연결');
        assert.strictEqual(r2.meta.socketKept, true);
        assert.strictEqual(fake.connections, 2);
        assert.deepStrictEqual(fake.received[1], ['Show Break'], '두 번째 연결에 같은 명령이 한 번 재전송');
        const after = getConnectionStats();
        assert.strictEqual(after.retries - before.retries, 1);
        assert.strictEqual(after.connects - before.connects, 2);
        assert.strictEqual(after.reuses - before.reuses, 1);
        assert.ok(lines.some(l => l.startsWith('--- 1402 CLOSE (stale-retry')), lines.join('\n'));
        assert.ok(lines.some(l => l.includes('retrying once on a fresh connection: Show Break')), lines.join('\n'));
    } finally {
        closeControllerConnection('test-cleanup');
        await fake.close();
    }
});

test('미완결 응답(idle 조기 완료, STATUS 없음) 뒤에는 소켓을 폐기하고 다음 명령은 새 연결', async () => {
    closeControllerConnection('test-reset');
    const fake = await startFakeConsole((_line, socket, connIndex) => {
        socket.write(connIndex === 0 ? '<DATA>partial without status\r\n' : OK_RESPONSE);
    });
    const { lines, log } = logCollector();
    try {
        const r1 = await sendConsoleCommand('Show Thread', endpointOf(fake), opts({ idleMs: 60 }), { log });
        assert.strictEqual(r1.meta.responseComplete, false);
        assert.strictEqual(r1.meta.statusTagReceived, false);
        assert.strictEqual(r1.meta.socketKept, false, '잔류 바이트 위험 — 보관 금지');
        assert.strictEqual(r1.raw, '<DATA>partial without status');
        assert.strictEqual(getConnectionStats().keepAliveActive, false);
        assert.ok(await waitUntil(() => lines.includes('--- 1402 CLOSE (incomplete-response)')), lines.join('\n'));

        const r2 = await sendConsoleCommand('Show Thread', endpointOf(fake), opts(), { log });
        assert.strictEqual(fake.connections, 2);
        assert.strictEqual(r2.meta.socketReused, false);
        assert.strictEqual(r2.meta.socketKept, true);
    } finally {
        closeControllerConnection('test-cleanup');
        await fake.close();
    }
});

test('waitForStatusClose: 종결자가 두 chunk로 갈라져 와도 </STATUS>까지 기다린 뒤 완료하고 소켓을 보관', async () => {
    closeControllerConnection('test-reset');
    const fake = await startFakeConsole((_line, socket) => {
        socket.write('<DATA>pass 1\r\n');
        setTimeout(() => socket.write('pass 2</DATA>\r\n<STATUS>0,""</STATUS>\r\n'), 150);
    });
    const { log } = logCollector();
    try {
        const r = await sendConsoleCommand('Compile Foo', endpointOf(fake), opts({ waitForStatusClose: true, idleMs: 50 }), { log });
        assert.strictEqual(r.meta.responseComplete, true);
        assert.strictEqual(r.meta.socketKept, true);
        assert.ok(r.raw.endsWith('</STATUS>'));
    } finally {
        closeControllerConnection('test-cleanup');
        await fake.close();
    }
});

test('idle 타이머: 유휴 시간이 지나면 소켓을 닫고(CLOSE idle) 다음 명령은 새 연결', async () => {
    closeControllerConnection('test-reset');
    const fake = await startFakeConsole();
    const { lines, log } = logCollector();
    try {
        await sendConsoleCommand('Show Thread', endpointOf(fake), opts({ keepAliveIdleCloseMs: 120 }), { log });
        assert.strictEqual(getConnectionStats().keepAliveActive, true);
        assert.ok(await waitUntil(() => !getConnectionStats().keepAliveActive, 1000));
        assert.ok(lines.includes('--- 1402 CLOSE (idle 0.1s)'), lines.join('\n'));
        await sendConsoleCommand('Show Thread', endpointOf(fake), opts({ keepAliveIdleCloseMs: 120 }), { log });
        assert.strictEqual(fake.connections, 2);
    } finally {
        closeControllerConnection('test-cleanup');
        await fake.close();
    }
});

test('상대측 종료: 보관 중 제어기가 먼저 끊으면 CLOSE (by peer) 후 다음 명령은 재시도 없이 새 연결', async () => {
    closeControllerConnection('test-reset');
    const fake = await startFakeConsole((_line, socket) => {
        socket.write(OK_RESPONSE);
        setTimeout(() => socket.end(), 40);
    });
    const { lines, log } = logCollector();
    const before = getConnectionStats();
    try {
        await sendConsoleCommand('Show Thread', endpointOf(fake), opts(), { log });
        assert.ok(await waitUntil(() => !getConnectionStats().keepAliveActive, 1000));
        assert.ok(lines.some(l => /^--- 1402 CLOSE \(by peer, held \d+s\)$/.test(l)), lines.join('\n'));
        await sendConsoleCommand('Show Thread', endpointOf(fake), opts(), { log });
        assert.strictEqual(fake.connections, 2);
        assert.strictEqual(getConnectionStats().retries - before.retries, 0);
    } finally {
        closeControllerConnection('test-cleanup');
        await fake.close();
    }
});

test('유휴 소켓에 예기치 않은 바이트가 오면 로그 후 폐기하고, 공백만 오면 유지', async () => {
    closeControllerConnection('test-reset');
    const fake = await startFakeConsole((line, socket) => {
        socket.write(OK_RESPONSE);
        if (line === 'A') { setTimeout(() => socket.write('\r\n'), 30); }           // 종결자 뒤 늦게 온 개행 → 무해
        if (line === 'B') { setTimeout(() => socket.write('<E>unsolicited\r\n'), 30); }  // 정체 불명 → 폐기
    });
    const { lines, log } = logCollector();
    try {
        await sendConsoleCommand('A', endpointOf(fake), opts(), { log });
        await sleep(120);
        assert.strictEqual(getConnectionStats().keepAliveActive, true, '공백은 무시하고 유지');
        assert.ok(lines.some(l => l.includes('trailing whitespace — ignored')), lines.join('\n'));

        await sendConsoleCommand('B', endpointOf(fake), opts(), { log });
        assert.ok(await waitUntil(() => !getConnectionStats().keepAliveActive, 1000));
        assert.ok(lines.includes('--- 1402 unexpected data on idle socket (16 bytes) — drop'), lines.join('\n'));
        assert.ok(lines.includes('--- 1402 CLOSE (unexpected-data)'), lines.join('\n'));
        assert.strictEqual(fake.connections, 1, 'A·B는 같은 연결');
    } finally {
        closeControllerConnection('test-cleanup');
        await fake.close();
    }
});

test('endpoint 변경: 다른 ip:port 로 보내면 기존 보관 소켓을 닫고 새로 연결', async () => {
    closeControllerConnection('test-reset');
    const a = await startFakeConsole();
    const b = await startFakeConsole();
    const { lines, log } = logCollector();
    try {
        await sendConsoleCommand('Show Thread', endpointOf(a), opts(), { log });
        await sendConsoleCommand('Show Thread', endpointOf(b), opts(), { log });
        assert.strictEqual(a.connections, 1);
        assert.strictEqual(b.connections, 1);
        assert.ok(lines.includes('--- 1402 CLOSE (endpoint changed)'), lines.join('\n'));
        assert.strictEqual(getConnectionStats().keepAliveActive, true);
    } finally {
        closeControllerConnection('test-cleanup');
        await a.close();
        await b.close();
    }
});

test('TIMEOUT: 무응답이면 reject + 소켓 폐기(재시도 없음 — 이중 실행 위험)', async () => {
    closeControllerConnection('test-reset');
    const fake = await startFakeConsole((line, socket) => { if (line !== 'Hang') { socket.write(OK_RESPONSE); } });
    const { lines, log } = logCollector();
    const before = getConnectionStats();
    try {
        await sendConsoleCommand('Show Thread', endpointOf(fake), opts(), { log });
        await assert.rejects(
            sendConsoleCommand('Hang', endpointOf(fake), opts({ timeoutMs: 150 }), { log }),
            /Command timeout \(150ms\): Hang/,
        );
        assert.strictEqual(getConnectionStats().keepAliveActive, false);
        assert.strictEqual(getConnectionStats().retries - before.retries, 0);
        assert.ok(lines.includes('--- TIMEOUT (150ms): Hang'), lines.join('\n'));
        assert.ok(await waitUntil(() => lines.includes('--- 1402 CLOSE (timeout)')), lines.join('\n'));
        assert.strictEqual(fake.received[0].length, 2, 'Hang 은 한 번만 전송됨');
    } finally {
        closeControllerConnection('test-cleanup');
        await fake.close();
    }
});

test('HTTP 교차 응답: 종결자 없이 닫혀도 부분 버퍼를 반환한다(responseComplete=false, 소켓 미보관)', async () => {
    closeControllerConnection('test-reset');
    const fake = await startFakeConsole((_line, socket) => {
        socket.end('HTTP/1.0 400 Bad Request\r\nContent-Type: text/html\r\n\r\n');
    });
    const { lines, log } = logCollector();
    try {
        const r = await sendConsoleCommand('Show Thread', endpointOf(fake), opts({ waitForStatusClose: true }), { log });
        assert.ok(r.raw.startsWith('HTTP/'), r.raw);
        assert.strictEqual(r.meta.responseComplete, false);
        assert.strictEqual(r.meta.socketKept, false);
        assert.strictEqual(getConnectionStats().keepAliveActive, false);
        assert.ok(lines.some(l => l.startsWith('<<< (closed, INCOMPLETE — no </STATUS>)')), lines.join('\n'));
        assert.ok(lines.includes('--- 1402 CLOSE (by peer)'), lines.join('\n'));
    } finally {
        closeControllerConnection('test-cleanup');
        await fake.close();
    }
});

test('연결 거부(서버 없음): 첫 연결 실패는 종전과 같이 reject, 재시도 없음', async () => {
    closeControllerConnection('test-reset');
    const fake = await startFakeConsole();
    const port = fake.port;
    await fake.close();
    const { lines, log } = logCollector();
    const before = getConnectionStats();
    await assert.rejects(
        sendConsoleCommand('Show Thread', { ip: '127.0.0.1', port, preferIPv4: true }, opts(), { log }),
        /Connection error \(127\.0\.0\.1:\d+\): /,
    );
    assert.strictEqual(getConnectionStats().retries - before.retries, 0);
    assert.strictEqual(getConnectionStats().keepAliveActive, false);
    assert.ok(lines.some(l => l.startsWith('--- ERROR: ')), lines.join('\n'));
    assert.ok(await waitUntil(() => lines.some(l => l.startsWith('--- 1402 CLOSE (error: '))), lines.join('\n'));
});

test('응답 본문 sink: chunk 가 push 되고 완료 시 flush 가 한 번 불린다(재시도 경로 포함)', async () => {
    closeControllerConnection('test-reset');
    const fake = await startFakeConsole((_line, socket, connIndex, lineIndex) => {
        if (connIndex === 0 && lineIndex >= 1) { socket.destroy(); return; }
        socket.write(OK_RESPONSE);
    });
    const { log } = logCollector();
    try {
        await sendConsoleCommand('Show Thread', endpointOf(fake), opts(), { log });
        const pushed: string[] = [];
        let flushes = 0;
        const body = { push: (c: string) => { pushed.push(c); }, flush: () => { flushes++; } };
        const r = await sendConsoleCommand('Show Break', endpointOf(fake), opts(), { log, body });
        assert.strictEqual(r.meta.responseComplete, true);
        assert.strictEqual(pushed.join(''), OK_RESPONSE);
        assert.strictEqual(flushes, 1, 'stale 경로에서는 flush 하지 않고 재시도 완료 시 한 번만');
    } finally {
        closeControllerConnection('test-cleanup');
        await fake.close();
    }
});
