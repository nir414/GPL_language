import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readDeployLock,
  describeDeployLock,
  deployLockFileName,
  waitForDeployLockRelease,
  DEPLOY_GUARDED_COMMAND_RE,
  DEPLOY_LOCK_STALE_MS,
} from '../src/deployLock.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-mcp-lock-test-'));
}

function writeLock(dir, ip, rec) {
  fs.writeFileSync(path.join(dir, deployLockFileName(ip)), JSON.stringify(rec));
}

const NOW = 1_700_000_000_000;

test('readDeployLock: 파일 없음 → null', () => {
  const dir = tmpDir();
  try {
    assert.equal(readDeployLock('192.168.0.1', { dir, now: NOW }), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('readDeployLock: 살아 있는 pid + 신선한 heartbeat → 레코드 반환', () => {
  const dir = tmpDir();
  try {
    writeLock(dir, '192.168.0.1', { version: 1, owner: 'Deploy', stage: 'UPLOAD', since: NOW - 5000, heartbeat: NOW - 1000, pid: 4242, host: 'PC' });
    const rec = readDeployLock('192.168.0.1', { dir, now: NOW, pidAlive: () => true });
    assert.ok(rec);
    assert.equal(rec.owner, 'Deploy');
    assert.equal(rec.stage, 'UPLOAD');
    assert.equal(rec.pid, 4242);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('readDeployLock: 죽은 pid → null (stale)', () => {
  const dir = tmpDir();
  try {
    writeLock(dir, '192.168.0.1', { version: 1, owner: 'Deploy', stage: 'UPLOAD', since: NOW, heartbeat: NOW, pid: 4242, host: 'PC' });
    assert.equal(readDeployLock('192.168.0.1', { dir, now: NOW, pidAlive: () => false }), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('readDeployLock: heartbeat 만료 → null (stale)', () => {
  const dir = tmpDir();
  try {
    writeLock(dir, '192.168.0.1', { version: 1, owner: 'Deploy', stage: 'UPLOAD', since: NOW - 60000, heartbeat: NOW - DEPLOY_LOCK_STALE_MS - 1, pid: 4242, host: 'PC' });
    assert.equal(readDeployLock('192.168.0.1', { dir, now: NOW, pidAlive: () => true }), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('readDeployLock: 손상 파일은 최근이면 알 수 없는 보유자, 오래됐으면 null', () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, deployLockFileName('192.168.0.1'));
    fs.writeFileSync(file, '{"owner": "Dep');
    const mtime = fs.statSync(file).mtimeMs;
    const fresh = readDeployLock('192.168.0.1', { dir, now: mtime + 1000 });
    assert.ok(fresh);
    assert.equal(fresh.owner, '(알 수 없는 프로세스)');
    assert.equal(readDeployLock('192.168.0.1', { dir, now: mtime + DEPLOY_LOCK_STALE_MS + 1 }), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('describeDeployLock: 초/분 표기', () => {
  const rec = { owner: 'autoOnSave Quick Compile', stage: 'UPLOAD', since: 1000 };
  assert.equal(describeDeployLock(rec, 1000 + 37_000), 'autoOnSave Quick Compile — UPLOAD, 37초 경과');
  assert.equal(describeDeployLock(rec, 1000 + 97_000), 'autoOnSave Quick Compile — UPLOAD, 1분 37초 경과');
});

test('DEPLOY_GUARDED_COMMAND_RE: Compile/Start/Load/Unload만 잡고 Show/Stop 등은 통과', () => {
  for (const cmd of ['Compile MergeCode', 'start MergeCode -break -bex', '  Load /flash/projects/X', 'UNLOAD X']) {
    assert.ok(DEPLOY_GUARDED_COMMAND_RE.test(cmd), cmd);
  }
  for (const cmd of ['Show Thread -web', 'Stop -all', 'Starter', 'ErrorLog', 'Show Variable -eval t 0 x']) {
    assert.ok(!DEPLOY_GUARDED_COMMAND_RE.test(cmd), cmd);
  }
});

test('waitForDeployLockRelease: 잠금이 없으면 즉시, 있으면 풀릴 때 반환, 초과 시 holder 반환', async () => {
  const dir = tmpDir();
  try {
    const none = await waitForDeployLockRelease('192.168.0.1', { dir, maxMs: 200, pollMs: 10 });
    assert.equal(none.released, true);

    writeLock(dir, '192.168.0.1', { version: 1, owner: 'Deploy', stage: 'UPLOAD', since: Date.now(), heartbeat: Date.now(), pid: process.pid, host: 'PC' });
    setTimeout(() => fs.unlinkSync(path.join(dir, deployLockFileName('192.168.0.1'))), 60);
    const freed = await waitForDeployLockRelease('192.168.0.1', { dir, maxMs: 2000, pollMs: 10 });
    assert.equal(freed.released, true);

    writeLock(dir, '192.168.0.1', { version: 1, owner: 'Deploy', stage: 'COMPILE', since: Date.now(), heartbeat: Date.now(), pid: process.pid, host: 'PC' });
    const stuck = await waitForDeployLockRelease('192.168.0.1', { dir, maxMs: 80, pollMs: 10 });
    assert.equal(stuck.released, false);
    assert.equal(stuck.holder.stage, 'COMPILE');
    assert.ok(stuck.file.endsWith('192.168.0.1.lock.json'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
