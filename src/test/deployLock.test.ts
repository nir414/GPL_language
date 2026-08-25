import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from './harness';
import { DeployLock, DeployLockRecord, describeDeployLock, deployLockFileName, DEPLOY_LOCK_STALE_MS } from '../controller/deployLock';

/** 테스트 전용 임시 디렉터리 + 주입 가능한 시계/pid/생존 판정. */
function makeEnv(overrides: { pid?: number; alive?: Set<number>; startAt?: number } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-deploylock-test-'));
    let clock = overrides.startAt ?? 1_700_000_000_000;
    const alive = overrides.alive ?? new Set<number>([overrides.pid ?? 1001]);
    const env = {
        dir,
        now: () => clock,
        pid: overrides.pid ?? 1001,
        host: 'TEST-PC',
        pidAlive: (pid: number) => alive.has(pid),
        heartbeatIntervalMs: 0,
    };
    return {
        env,
        dir,
        alive,
        tick(ms: number) { clock += ms; },
        readRaw(ip = '10.0.0.1'): DeployLockRecord {
            return JSON.parse(fs.readFileSync(path.join(dir, deployLockFileName(ip)), 'utf8'));
        },
        writeRaw(rec: Partial<DeployLockRecord>, ip = '10.0.0.1') {
            const full = { version: 1, owner: 'other', stage: 'UPLOAD', since: clock, heartbeat: clock, pid: 2002, host: 'OTHER', ...rec };
            fs.writeFileSync(path.join(dir, deployLockFileName(ip)), JSON.stringify(full));
        },
        exists(ip = '10.0.0.1') { return fs.existsSync(path.join(dir, deployLockFileName(ip))); },
        cleanup() { fs.rmSync(dir, { recursive: true, force: true }); },
    };
}

test('deployLock: 획득하면 파일에 owner/stage/pid가 기록되고 current()는 local=true', () => {
    const t = makeEnv();
    try {
        const lock = new DeployLock('10.0.0.1', t.env);
        const r = lock.acquire('Deploy', 'PREPARE');
        assert.ok(r.ok);
        const raw = t.readRaw();
        assert.strictEqual(raw.owner, 'Deploy');
        assert.strictEqual(raw.stage, 'PREPARE');
        assert.strictEqual(raw.pid, 1001);
        assert.strictEqual(raw.version, 1);
        const cur = lock.current();
        assert.ok(cur && cur.local);
        assert.strictEqual(cur!.record.owner, 'Deploy');
    } finally { t.cleanup(); }
});

test('deployLock: setStage는 메모리와 파일 모두 갱신하고 heartbeat를 올린다', () => {
    const t = makeEnv();
    try {
        const lock = new DeployLock('10.0.0.1', t.env);
        const r = lock.acquire('Quick Compile', 'PREPARE');
        assert.ok(r.ok);
        t.tick(4000);
        r.handle.setStage('UPLOAD');
        assert.strictEqual(r.handle.record.stage, 'UPLOAD');
        const raw = t.readRaw();
        assert.strictEqual(raw.stage, 'UPLOAD');
        assert.strictEqual(raw.heartbeat, raw.since + 4000);
    } finally { t.cleanup(); }
});

test('deployLock: 같은 프로세스의 이중 획득은 local=true로 거부', () => {
    const t = makeEnv();
    try {
        const lock = new DeployLock('10.0.0.1', t.env);
        const a = lock.acquire('Deploy', 'UPLOAD');
        assert.ok(a.ok);
        const b = lock.acquire('Quick Compile', 'PREPARE');
        assert.ok(!b.ok);
        if (!b.ok) {
            assert.strictEqual(b.local, true);
            assert.strictEqual(b.holder.owner, 'Deploy');
        }
    } finally { t.cleanup(); }
});

test('deployLock: 다른 살아 있는 프로세스가 잡고 있으면 local=false로 거부', () => {
    const t = makeEnv({ pid: 1001, alive: new Set([1001, 2002]) });
    try {
        t.writeRaw({ owner: 'autoOnSave Quick Compile', stage: 'UPLOAD', pid: 2002 });
        const lock = new DeployLock('10.0.0.1', t.env);
        const r = lock.acquire('Deploy', 'PREPARE');
        assert.ok(!r.ok);
        if (!r.ok) {
            assert.strictEqual(r.local, false);
            assert.strictEqual(r.holder.owner, 'autoOnSave Quick Compile');
            assert.strictEqual(r.holder.stage, 'UPLOAD');
        }
        const cur = lock.current();
        assert.ok(cur && !cur.local && cur.record.pid === 2002);
    } finally { t.cleanup(); }
});

test('deployLock: 죽은 pid의 잠금은 stale → 지우고 획득', () => {
    const t = makeEnv({ pid: 1001, alive: new Set([1001]) });
    try {
        t.writeRaw({ owner: 'Deploy', pid: 4040 }); // 4040은 alive 집합에 없음
        const lock = new DeployLock('10.0.0.1', t.env);
        assert.strictEqual(lock.current(), undefined, 'stale 잠금은 current()에서도 보이지 않아야 함');
        const r = lock.acquire('Quick Compile', 'PREPARE');
        assert.ok(r.ok);
        assert.strictEqual(t.readRaw().pid, 1001);
    } finally { t.cleanup(); }
});

test('deployLock: heartbeat가 STALE_MS를 넘긴 잠금은 살아 있는 pid라도 stale', () => {
    const t = makeEnv({ pid: 1001, alive: new Set([1001, 2002]) });
    try {
        t.writeRaw({ owner: 'Deploy', pid: 2002 });
        t.tick(DEPLOY_LOCK_STALE_MS + 1);
        const lock = new DeployLock('10.0.0.1', t.env);
        const r = lock.acquire('Quick Compile', 'PREPARE');
        assert.ok(r.ok);
    } finally { t.cleanup(); }
});

test('deployLock: heartbeat 이내의 잠금은 유지된다', () => {
    const t = makeEnv({ pid: 1001, alive: new Set([1001, 2002]) });
    try {
        t.writeRaw({ owner: 'Deploy', pid: 2002 });
        t.tick(DEPLOY_LOCK_STALE_MS - 1000);
        const lock = new DeployLock('10.0.0.1', t.env);
        const r = lock.acquire('Quick Compile', 'PREPARE');
        assert.ok(!r.ok);
    } finally { t.cleanup(); }
});

test('deployLock: release는 파일을 지우고 멱등이며, 새 보유자의 파일은 지우지 않는다(세대 보호)', () => {
    const t = makeEnv();
    try {
        const lock = new DeployLock('10.0.0.1', t.env);
        const a = lock.acquire('Deploy', 'UPLOAD');
        assert.ok(a.ok);
        a.handle.release();
        assert.strictEqual(t.exists(), false);
        assert.strictEqual(a.handle.released, true);
        assert.strictEqual(lock.current(), undefined);

        t.tick(10);
        const b = lock.acquire('Save to Flash', 'FTP_MIRROR');
        assert.ok(b.ok);
        a.handle.release(); // 뒤늦은 finally 재호출
        assert.strictEqual(t.exists(), true, '이전 핸들의 release가 새 보유자의 잠금을 지우면 안 됨');
        assert.strictEqual(t.readRaw().owner, 'Save to Flash');
        assert.ok(lock.current()?.local);
        b.handle.release();
        assert.strictEqual(t.exists(), false);
    } finally { t.cleanup(); }
});

test('deployLock: 이 프로세스의 잔재 파일(메모리 보유 없음)은 stale로 보고 재획득', () => {
    const t = makeEnv({ pid: 1001 });
    try {
        t.writeRaw({ owner: 'Deploy', pid: 1001 }); // 이전 세션에서 남은 내 pid의 파일
        const lock = new DeployLock('10.0.0.1', t.env);
        assert.strictEqual(lock.current(), undefined);
        const r = lock.acquire('Quick Compile', 'PREPARE');
        assert.ok(r.ok);
    } finally { t.cleanup(); }
});

test('deployLock: 손상된 파일 — 최근이면 알 수 없는 보유자로 거부, 오래됐으면 획득', () => {
    const t = makeEnv({ startAt: Date.now() });
    try {
        const file = path.join(t.dir, deployLockFileName('10.0.0.1'));
        fs.writeFileSync(file, '{"owner": "Deplo'); // 부분 기록
        const lock = new DeployLock('10.0.0.1', t.env);
        const r1 = lock.acquire('Deploy', 'PREPARE');
        assert.ok(!r1.ok);
        if (!r1.ok) { assert.strictEqual(r1.holder.owner, '(알 수 없는 프로세스)'); }
        // 손상 파일의 stale 판정은 실제 mtime 기준이라 startAt~write 사이 수 ms 오차가 있다 — 여유를 두고 넘긴다.
        t.tick(DEPLOY_LOCK_STALE_MS + 5000);
        const r2 = lock.acquire('Deploy', 'PREPARE');
        assert.ok(r2.ok);
    } finally { t.cleanup(); }
});

test('deployLock: describeDeployLock — 초/분 표기', () => {
    const rec: DeployLockRecord = { version: 1, owner: 'autoOnSave Quick Compile', stage: 'UPLOAD', since: 1000, heartbeat: 1000, pid: 1, host: '' };
    assert.strictEqual(describeDeployLock(rec, 1000 + 37_000), 'autoOnSave Quick Compile — UPLOAD, 37초 경과');
    assert.strictEqual(describeDeployLock(rec, 1000 + 97_000), 'autoOnSave Quick Compile — UPLOAD, 1분 37초 경과');
});

test('deployLock: IP별 파일명 정규화', () => {
    assert.strictEqual(deployLockFileName('192.168.0.1'), '192.168.0.1.lock.json');
    assert.strictEqual(deployLockFileName('fe80::1'), 'fe80__1.lock.json');
    assert.strictEqual(deployLockFileName(''), 'default.lock.json');
});
