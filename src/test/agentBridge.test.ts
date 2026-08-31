import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from './harness';
import {
    AGENT_BRIDGE_VERSION,
    AgentBridgeServer,
    bridgeDirs,
    isPresenceStale,
    presenceFilePath,
    requestIdFromFileName,
    sanitizeIpForPath,
    validateBridgeRequest,
} from '../controller/agentBridge';

const IP = '192.168.0.1';

function tmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-agentbridge-test-'));
}

/** 요청 파일을 쓰고 서버를 한 번 돌린 뒤 응답을 읽어 돌려준다. */
async function roundTrip(
    server: AgentBridgeServer,
    id: string,
    body: unknown,
): Promise<any> {
    fs.mkdirSync(server.requestDir, { recursive: true });
    fs.writeFileSync(path.join(server.requestDir, `${id}.json`), typeof body === 'string' ? body : JSON.stringify(body));
    await server.drain();
    const res = path.join(server.responseDir, `${id}.json`);
    return fs.existsSync(res) ? JSON.parse(fs.readFileSync(res, 'utf8')) : undefined;
}

function makeServer(overrides: Partial<ConstructorParameters<typeof AgentBridgeServer>[0]> = {}) {
    const dir = tmpDir();
    const calls: Array<{ command: string; args: unknown }> = [];
    const server = new AgentBridgeServer({
        ip: IP,
        port: 1402,
        extensionVersion: '0.0.0-test',
        dir,
        heartbeatIntervalMs: 0,
        scanIntervalMs: 0,
        execute: async (command, args) => { calls.push({ command, args }); return { ok: true, echoed: args }; },
        ...overrides,
    });
    return { server, dir, calls };
}

test('agentBridge: 경로 규칙 — ip 를 파일명 안전 문자로, presence/req/res 분리', () => {
    assert.strictEqual(sanitizeIpForPath('192.168.0.1'), '192.168.0.1');
    assert.strictEqual(sanitizeIpForPath('a/b:c'), 'a_b_c');
    assert.strictEqual(sanitizeIpForPath(''), 'default');
    assert.ok(presenceFilePath(IP, '/tmp/x').endsWith(`${IP}.extension.json`));
    const d = bridgeDirs(IP, '/tmp/x');
    assert.ok(d.reqDir.endsWith(path.join('bridge', IP, 'req')));
});

test('agentBridge: presence staleness 는 heartbeat 기준', () => {
    assert.strictEqual(isPresenceStale({ heartbeat: 1000 }, 5000, 15000), false);
    assert.strictEqual(isPresenceStale({ heartbeat: 1000 }, 20000, 15000), true);
    assert.strictEqual(isPresenceStale({ heartbeat: NaN }, 1000, 15000), true);
});

test('agentBridge: 요청 파일명 → id (안전한 이름만)', () => {
    assert.strictEqual(requestIdFromFileName('abc-123.json'), 'abc-123');
    assert.strictEqual(requestIdFromFileName('abc.txt'), undefined);
    assert.strictEqual(requestIdFromFileName('../evil.json'), undefined);
});

test('agentBridge: 요청 검증 — 버전·id 일치·gpl.* 범위·TTL', () => {
    const now = 1_000_000;
    const base = { version: AGENT_BRIDGE_VERSION, id: 'x1', command: 'gpl.ai.debug.getState', createdAt: now };
    assert.strictEqual(validateBridgeRequest(base, 'x1', now).ok, true);
    assert.strictEqual((validateBridgeRequest({ ...base, version: 2 }, 'x1', now) as any).error, 'invalid-request');
    assert.strictEqual((validateBridgeRequest(base, 'other', now) as any).error, 'invalid-request');
    assert.strictEqual((validateBridgeRequest({ ...base, command: 'workbench.action.quit' }, 'x1', now) as any).error, 'unsupported-command');
    assert.strictEqual((validateBridgeRequest({ ...base, createdAt: now - 120_000 }, 'x1', now) as any).error, 'stale-request');
    // timeoutMs 를 주면 그것이 TTL — 아직 유효
    assert.strictEqual(validateBridgeRequest({ ...base, createdAt: now - 120_000, timeoutMs: 300_000 }, 'x1', now).ok, true);
});

test('agentBridge: 정상 요청 → 명령 실행 + 응답 파일, 요청 파일은 소비된다', async () => {
    const { server, calls } = makeServer();
    server.start();
    try {
        const res = await roundTrip(server, 'r1', {
            version: AGENT_BRIDGE_VERSION, id: 'r1', command: 'gpl.controller.sendCommand',
            args: { command: 'Show Thread' }, createdAt: Date.now(),
        });
        assert.strictEqual(res.ok, true);
        assert.deepStrictEqual(res.result, { ok: true, echoed: { command: 'Show Thread' } });
        assert.strictEqual(res.extensionVersion, '0.0.0-test');
        assert.deepStrictEqual(calls, [{ command: 'gpl.controller.sendCommand', args: { command: 'Show Thread' } }]);
        assert.strictEqual(fs.readdirSync(server.requestDir).length, 0);
    } finally {
        server.stop();
    }
});

test('agentBridge: 명령이 도메인 실패를 돌려줘도 브리지는 ok=true, code 로 전달한다', async () => {
    const { server } = makeServer({ execute: async () => ({ ok: false, error: 'policy-hold', detail: '정지 대기' }) });
    server.start();
    try {
        const res = await roundTrip(server, 'r2', { version: AGENT_BRIDGE_VERSION, id: 'r2', command: 'gpl.ai.debug.stepThread', createdAt: Date.now() });
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.code, 'policy-hold');
        assert.strictEqual(res.result.error, 'policy-hold');
    } finally {
        server.stop();
    }
});

test('agentBridge: 실행 중 예외는 command-failed 응답으로', async () => {
    const { server } = makeServer({ execute: async () => { throw new Error('boom'); } });
    server.start();
    try {
        const res = await roundTrip(server, 'r3', { version: AGENT_BRIDGE_VERSION, id: 'r3', command: 'gpl.deploy', createdAt: Date.now() });
        assert.strictEqual(res.ok, false);
        assert.strictEqual(res.error, 'command-failed');
        assert.strictEqual(res.detail, 'boom');
    } finally {
        server.stop();
    }
});

test('agentBridge: gpl.* 밖 명령·미등록 명령·깨진 JSON 은 실행하지 않고 사유를 돌려준다', async () => {
    const { server, calls } = makeServer({ isKnownCommand: (c) => c !== 'gpl.notRegistered' });
    server.start();
    try {
        const a = await roundTrip(server, 'r4', { version: AGENT_BRIDGE_VERSION, id: 'r4', command: 'workbench.action.quit', createdAt: Date.now() });
        assert.strictEqual(a.error, 'unsupported-command');
        const b = await roundTrip(server, 'r5', { version: AGENT_BRIDGE_VERSION, id: 'r5', command: 'gpl.notRegistered', createdAt: Date.now() });
        assert.strictEqual(b.error, 'unknown-command');
        const c = await roundTrip(server, 'r6', '{broken');
        assert.strictEqual(c.error, 'invalid-request');
        assert.strictEqual(calls.length, 0, '거부된 요청은 실행되지 않는다');
    } finally {
        server.stop();
    }
});

test('agentBridge: 만료된 요청은 실행하지 않고 stale-request 로 답한다', async () => {
    const { server, calls } = makeServer();
    server.start();
    try {
        const res = await roundTrip(server, 'r7', {
            version: AGENT_BRIDGE_VERSION, id: 'r7', command: 'gpl.start', createdAt: Date.now() - 120_000,
        });
        assert.strictEqual(res.error, 'stale-request');
        assert.strictEqual(calls.length, 0);
    } finally {
        server.stop();
    }
});

test('agentBridge: 요청은 순차 처리된다(동시 실행 없음)', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const { server } = makeServer({
        execute: async () => {
            inFlight++;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise(r => setTimeout(r, 5));
            inFlight--;
            return { ok: true };
        },
    });
    server.start();
    try {
        fs.mkdirSync(server.requestDir, { recursive: true });
        for (const id of ['a1', 'a2', 'a3']) {
            fs.writeFileSync(path.join(server.requestDir, `${id}.json`), JSON.stringify({ version: AGENT_BRIDGE_VERSION, id, command: 'gpl.ai.debug.getState', createdAt: Date.now() }));
        }
        await server.drain();
        assert.strictEqual(maxInFlight, 1);
        assert.strictEqual(fs.readdirSync(server.responseDir).length, 3);
    } finally {
        server.stop();
    }
});

test('agentBridge: presence 파일은 start 에서 생기고 setState 를 반영하며 stop 에서 지워진다', () => {
    const { server } = makeServer();
    server.start();
    try {
        const read = () => JSON.parse(fs.readFileSync(server.presencePath, 'utf8'));
        assert.strictEqual(read().bridge.enabled, true);
        assert.strictEqual(read().connected, false);
        server.setState({ connected: true, debugSessionActive: true });
        assert.strictEqual(read().connected, true);
        assert.strictEqual(read().debugSessionActive, true);
        assert.strictEqual(read().version, AGENT_BRIDGE_VERSION);
    } finally {
        server.stop();
    }
    assert.strictEqual(fs.existsSync(server.presencePath), false);
});
