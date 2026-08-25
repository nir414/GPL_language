// 배포 잠금(Deploy Lock) 읽기 — VS Code 확장(src/controller/deployLock.ts)과 파일 계약을 공유한다.
//
// 확장이 FTP 업로드/배포 중이면 `%TEMP%/gpl-controller/<ip>.lock.json`을 잡는다. 업로드 도중
// Compile/Start(그리고 /GPL 폴더를 건드리는 Load/Unload)가 겹치면 제어기가 죽을 수 있어
// (2026-08-20 사용자 관찰, GitHub #17), MCP는 이 파일을 읽어 해당 명령을 유한 대기 후 진행하거나 거부한다.
// MCP 서버는 FTP 업로드를 하지 않으므로 잠금을 *쓰지* 않고 *읽기만* 한다.
//
// 파일 계약(양쪽 동일 유지):
//   { version: 1, owner, stage, since(ms), heartbeat(ms), pid, host }
//   stale = (pid > 0 && 프로세스 없음) || now - heartbeat > STALE_MS
// 이 파일은 로그가 아니라 조정 프리미티브다 — 제어기 상태 판단에는 쓰지 않는다.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEPLOY_LOCK_STALE_MS = 30_000;
export const DEPLOY_LOCK_DIR_NAME = 'gpl-controller';

/** 잠금 대상 명령: 첫 단어가 Compile/Start/Load/Unload (대소문자 무시). */
export const DEPLOY_GUARDED_COMMAND_RE = /^\s*(compile|start|load|unload)\b/i;

export function deployLockDir(env = process.env) {
  return env.GPL_LOCK_DIR || path.join(os.tmpdir(), DEPLOY_LOCK_DIR_NAME);
}

export function deployLockFileName(ip) {
  const safe = String(ip || 'default').trim().replace(/[^A-Za-z0-9._-]/g, '_');
  return `${safe || 'default'}.lock.json`;
}

export function deployLockFile(ip, { dir } = {}) {
  return path.join(dir || deployLockDir(), deployLockFileName(ip));
}

export function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

/**
 * 현재 유효한 잠금 레코드 또는 null. stale이면 null(파일은 건드리지 않는다 — 정리는 획득 측 몫).
 * 손상/부분 기록 파일은 최근이면 "알 수 없는 보유자"로 보수적으로 취급한다.
 */
export function readDeployLock(ip, { dir, now = Date.now(), pidAlive = isPidAlive, staleMs = DEPLOY_LOCK_STALE_MS } = {}) {
  const file = deployLockFile(ip, { dir });
  let text;
  let mtimeMs = now;
  try {
    text = fs.readFileSync(file, 'utf8');
    try { mtimeMs = fs.statSync(file).mtimeMs; } catch { /* noop */ }
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  }
  let rec;
  try {
    rec = JSON.parse(text);
  } catch {
    rec = null;
  }
  if (!rec || typeof rec !== 'object' || typeof rec.owner !== 'string' || typeof rec.since !== 'number') {
    if (now - mtimeMs > staleMs) return null;
    return { version: 1, owner: '(알 수 없는 프로세스)', stage: '(단계 미상)', since: mtimeMs, heartbeat: mtimeMs, pid: -1, host: '', file };
  }
  const heartbeat = typeof rec.heartbeat === 'number' ? rec.heartbeat : rec.since;
  const pid = typeof rec.pid === 'number' ? rec.pid : -1;
  if (Number.isInteger(pid) && pid > 0 && !pidAlive(pid)) return null;
  if (now - heartbeat > staleMs) return null;
  return {
    version: typeof rec.version === 'number' ? rec.version : 1,
    owner: rec.owner,
    stage: typeof rec.stage === 'string' ? rec.stage : '(단계 미상)',
    since: rec.since,
    heartbeat,
    pid,
    host: typeof rec.host === 'string' ? rec.host : '',
    file,
  };
}

/** 경고/오류 문구용: `autoOnSave Quick Compile — UPLOAD, 37초 경과` */
export function describeDeployLock(rec, now = Date.now()) {
  const sec = Math.max(0, Math.round((now - rec.since) / 1000));
  const elapsed = sec >= 60 ? `${Math.floor(sec / 60)}분 ${sec % 60}초` : `${sec}초`;
  return `${rec.owner} — ${rec.stage}, ${elapsed} 경과`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 잠금이 풀릴 때까지 최대 maxMs 대기. 풀리면 { released: true, waitedMs },
 * 아니면 { released: false, holder, waitedMs, file }.
 */
export async function waitForDeployLockRelease(ip, { maxMs = 20_000, pollMs = 500, dir, now, pidAlive, staleMs } = {}) {
  const clock = now || (() => Date.now());
  const start = clock();
  for (;;) {
    const holder = readDeployLock(ip, { dir, now: clock(), pidAlive, staleMs });
    if (!holder) return { released: true, waitedMs: clock() - start };
    if (clock() - start >= maxMs) return { released: false, holder, waitedMs: clock() - start, file: holder.file };
    await sleep(pollMs);
  }
}
