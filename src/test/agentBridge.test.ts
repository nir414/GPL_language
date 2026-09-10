import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from './harness';
import {
    AGENT_BRIDGE_VERSION,
    AgentBridgeServer,
    bridgeDirs,
    electLeaderInstanceId,
    instanceBridgeDirs,
    instancePresenceFilePath,
    isPresenceStale,
    listInstancePresences,
    presenceFilePath,
    requestIdFromFileName,
    sanitizeInstanceId,
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

// ── 인스턴스 분리(개선안 §4·§5) ────────────────────────────────────────────

test('agentBridge: 인스턴스 경로 — presence 는 extensions/, 큐는 bridge/inst/<id>/', () => {
    assert.strictEqual(sanitizeInstanceId('a/b:c'), 'a_b_c');
    assert.strictEqual(sanitizeInstanceId(''), 'unknown');
    assert.ok(instancePresenceFilePath('inst-1', '/tmp/x').endsWith(path.join('extensions', 'inst-1.json')));
    const d = instanceBridgeDirs('inst-1', '/tmp/x');
    assert.ok(d.reqDir.endsWith(path.join('bridge', 'inst', 'inst-1', 'req')));
    // 인스턴스가 다르면 큐도 다르다 — 이것이 "남의 창이 내 배포를 집어 가는" 문제를 없앤다.
    assert.notStrictEqual(instanceBridgeDirs('a', '/tmp/x').reqDir, instanceBridgeDirs('b', '/tmp/x').reqDir);
});

test('agentBridge: 리더 선출은 가장 먼저 뜬 인스턴스, 동률이면 id 순', () => {
    const p = (id: string, since: number, enabled = true) => ({
        version: AGENT_BRIDGE_VERSION, extensionInstanceId: id, pid: 1, extensionVersion: 'x',
        ip: IP, port: 1402, connected: false, debugSessionActive: false, since, heartbeat: since,
        bridge: { enabled, reqDir: '', resDir: '' },
    });
    assert.strictEqual(electLeaderInstanceId([p('b', 200), p('a', 100)]), 'a');
    assert.strictEqual(electLeaderInstanceId([p('b', 100), p('a', 100)]), 'a');
    // 브리지가 꺼진 인스턴스는 후보가 아니다.
    assert.strictEqual(electLeaderInstanceId([p('a', 100, false), p('b', 200)]), 'b');
    assert.strictEqual(electLeaderInstanceId([]), undefined);
});

/** 같은 디렉터리를 공유하는 두 확장 호스트(= 같은 제어기를 보는 VS Code 창 2개). */
function makeTwoInstances(dir: string) {
    const calls: Record<string, string[]> = { a: [], b: [] };
    const mk = (id: 'a' | 'b', now: number) => new AgentBridgeServer({
        ip: IP,
        port: 1402,
        extensionVersion: '0.0.0-test',
        dir,
        instanceId: id,
        now: () => now,
        pid: process.pid,
        heartbeatIntervalMs: 0,
        scanIntervalMs: 0,
        execute: async (command) => { calls[id].push(command); return { ok: true }; },
    });
    return { a: mk('a', 1000), b: mk('b', 2000), calls };
}

function writeRequest(reqDir: string, id: string, createdAt: number, command = 'gpl.ping'): void {
    fs.mkdirSync(reqDir, { recursive: true });
    fs.writeFileSync(path.join(reqDir, `${id}.json`), JSON.stringify({
        version: AGENT_BRIDGE_VERSION, id, command, createdAt,
    }));
}

test('agentBridge: 두 인스턴스는 서로의 요청을 집어 가지 않는다(§5 — 창이 뒤섞이던 원인)', async () => {
    const dir = tmpDir();
    const { a, b, calls } = makeTwoInstances(dir);
    a.start();
    b.start();
    try {
        writeRequest(b.requestDir, 'for-b', 2000, 'gpl.deploy');
        // 먼저 A 를 돌려도 B 의 요청은 남아 있어야 한다.
        await a.drain();
        assert.deepStrictEqual(calls.a, []);
        await b.drain();
        assert.deepStrictEqual(calls.b, ['gpl.deploy']);
    } finally {
        a.stop();
        b.stop();
    }
});

test('agentBridge: 레거시(IP) 큐는 리더만 처리한다 — 구버전 MCP 호환', async () => {
    const dir = tmpDir();
    const { a, b, calls } = makeTwoInstances(dir);
    a.start();   // 먼저 떴으므로 리더
    b.start();
    try {
        assert.strictEqual(a.isLeader, true, 'A 가 리더여야 한다');
        assert.strictEqual(b.isLeader, false, 'B 는 리더가 아니어야 한다');
        writeRequest(a.legacyRequestDir, 'legacy-1', 1000, 'gpl.legacy');
        await b.drain();
        assert.deepStrictEqual(calls.b, [], '비리더는 레거시 큐를 건드리지 않는다');
        await a.drain();
        assert.deepStrictEqual(calls.a, ['gpl.legacy']);
        // 레거시 presence 는 리더가 쓴다 — 구버전 MCP 가 보는 파일.
        const legacy = JSON.parse(fs.readFileSync(a.legacyPresencePath, 'utf8'));
        assert.strictEqual(legacy.extensionInstanceId, 'a');
        assert.ok(legacy.bridge.reqDir.endsWith(path.join('bridge', IP, 'req')), '레거시 presence 는 레거시 큐를 가리킨다');
    } finally {
        a.stop();
        b.stop();
    }
});

test('agentBridge: 비리더가 멈춰도 리더의 레거시 presence 를 지우지 않는다', () => {
    const dir = tmpDir();
    const { a, b } = makeTwoInstances(dir);
    a.start();
    b.start();
    try {
        assert.ok(fs.existsSync(a.legacyPresencePath));
        b.stop();
        assert.ok(fs.existsSync(a.legacyPresencePath), '남의 presence 를 지우면 구버전 MCP 가 확장을 잃는다');
    } finally {
        a.stop();
    }
    assert.strictEqual(fs.existsSync(a.legacyPresencePath), false, '리더가 멈추면 자기 것은 치운다');
});

test('agentBridge: listInstancePresences 는 살아 있는 것만·ip 로 거른다', () => {
    const dir = tmpDir();
    const { a, b } = makeTwoInstances(dir);
    a.start();
    b.start();
    try {
        const live = listInstancePresences({ dir, ip: IP, now: 2000 });
        assert.deepStrictEqual(live.map(p => p.extensionInstanceId).sort(), ['a', 'b']);
        // heartbeat 가 오래되면 목록에서 빠진다.
        assert.strictEqual(listInstancePresences({ dir, ip: IP, now: 2000 + 60_000 }).length, 0);
        // 다른 제어기를 보는 창은 이 제어기 목록에 없다.
        assert.strictEqual(listInstancePresences({ dir, ip: '10.0.0.9', now: 2000 }).length, 0);
        // 죽은 pid 는 제외한다.
        assert.strictEqual(listInstancePresences({ dir, ip: IP, now: 2000, pidAlive: () => false }).length, 0);
    } finally {
        a.stop();
        b.stop();
    }
});
