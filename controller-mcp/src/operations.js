// 장시간 작업 기록(Operation) 읽기 — 확장 `src/controller/operationStore.ts` 와 파일 계약을 공유한다.
//
// 왜(2026-09-10 개선안 §8~§11): Deploy/Quick Compile 은 브리지 RPC 한 번으로 수 분을 기다렸고, 응답 대기가
// 끝나면 **결과 불명**이 됐다. 그 상태에서 같은 명령을 다시 보내면 중복 배포이고, 잠금에 막히면 "LOCKED" 만
// 보고하게 된다. 이제 확장이 작업 상태를 파일로 남기므로, 이쪽은 **확장을 거치지 않고** 그 파일을 읽어
// 진행 상황과 결과를 확인한다 — 확장이 배포로 바빠도, 이 MCP 서버가 재시작돼도 조회가 된다.
//
// 파일 계약(양쪽 동일 유지):
//   <dir>/operations/<operationId>.json
//   { version:1, operationId, type, state, phase, controllerId, extensionInstanceId, pid, host,
//     projectDir?, projectName?, idempotencyKey?, requestId?,
//     createdAt, startedAt?, finishedAt?, heartbeat, result?, error? }
//   RUNNING/QUEUED 인데 heartbeat 가 끊겼거나 pid 가 죽었으면 **읽는 쪽이** 'UNKNOWN' 으로 본다.
//   UNKNOWN 은 실패가 아니라 결과 미확정이다 — 자동 재실행 금지(§11).
//
// 이 파일은 로그가 아니라 조회 프리미티브다 — 제어기 상태 판단에는 쓰지 않는다.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const OPERATION_VERSION = 1;
export const OPERATION_STALE_MS = 60_000;
export const OPERATION_DIR_NAME = 'gpl-controller';

export function operationRootDir(env = process.env) {
  return env.GPL_LOCK_DIR || path.join(os.tmpdir(), OPERATION_DIR_NAME);
}

export function operationsDir(dir) {
  return path.join(dir || operationRootDir(), 'operations');
}

export function sanitizeOperationId(id) {
  const safe = String(id || '').trim().replace(/[^A-Za-z0-9._-]/g, '_');
  return safe || 'unknown';
}

export function operationFilePath(operationId, { dir } = {}) {
  return path.join(operationsDir(dir), `${sanitizeOperationId(operationId)}.json`);
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

/** 파일에 적힌 state 를 관측으로 보정한다 — 진행 중이라는데 보유자가 사라졌으면 UNKNOWN. */
export function withObservedState(rec, { now = Date.now(), staleMs = OPERATION_STALE_MS, pidAlive = isPidAlive } = {}) {
  if (rec.state !== 'RUNNING' && rec.state !== 'QUEUED') return rec;
  const fresh = now - (rec.heartbeat || rec.createdAt || 0) <= staleMs;
  if (pidAlive(rec.pid) && fresh) return rec;
  return { ...rec, state: 'UNKNOWN' };
}

function parseRecord(text) {
  try {
    const rec = JSON.parse(text);
    if (!rec || typeof rec !== 'object') return null;
    if (rec.version !== OPERATION_VERSION || typeof rec.operationId !== 'string') return null;
    return rec;
  } catch {
    return null;
  }
}

export function readOperation(operationId, opts = {}) {
  let text;
  try {
    text = fs.readFileSync(operationFilePath(operationId, opts), 'utf8');
  } catch {
    return null;
  }
  const rec = parseRecord(text);
  return rec ? withObservedState(rec, opts) : null;
}

/** 기록 전체(최근 것부터). `controllerId` 를 주면 그 제어기의 것만. */
export function listOperations({ dir, controllerId, now, staleMs, pidAlive } = {}) {
  const base = operationsDir(dir);
  let names;
  try {
    names = fs.readdirSync(base).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    let rec;
    try {
      rec = parseRecord(fs.readFileSync(path.join(base, name), 'utf8'));
    } catch {
      continue;
    }
    if (!rec) continue;
    if (controllerId && rec.controllerId !== controllerId) continue;
    out.push(withObservedState(rec, { now, staleMs, pidAlive }));
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export function activeOperations(opts = {}) {
  return listOperations(opts).filter((r) => r.state === 'RUNNING' || r.state === 'QUEUED');
}

/** 사람이 읽는 한 줄: `deploy-… DEPLOY COMPILE 진행 중 37초` */
export function describeOperation(rec, now = Date.now()) {
  const base = rec.finishedAt ?? now;
  const sec = Math.max(0, Math.round((base - (rec.startedAt ?? rec.createdAt)) / 1000));
  const elapsed = sec >= 60 ? `${Math.floor(sec / 60)}분 ${sec % 60}초` : `${sec}초`;
  return `${rec.operationId} · ${rec.type} · ${rec.state}${rec.state === 'RUNNING' ? ` (${rec.phase})` : ''} · ${elapsed}`;
}

/**
 * 상태별 다음 행동 — AI 가 문장을 해석해 행동을 만들지 않게 한다(§15·§17).
 * @returns {{action:string, retryCurrentCommand:boolean, detail:string}}
 */
export function operationRecovery(rec) {
  switch (rec?.state) {
    case 'RUNNING':
    case 'QUEUED':
      return {
        action: 'CHECK_OPERATION',
        retryCurrentCommand: false,
        detail: `아직 진행 중이다(${rec.phase}). 같은 배포를 다시 보내지 말고 이 도구로 다시 확인할 것.`,
      };
    case 'COMPLETED':
      return { action: 'NONE', retryCurrentCommand: false, detail: '완료됐다. 결과는 result 에 있다.' };
    case 'FAILED':
      return {
        action: rec.error?.retryMode ?? 'NONE',
        retryCurrentCommand: rec.error?.retryable === true && rec.error?.safeToRepeat === true,
        detail: rec.error?.message ?? '실패했다.',
      };
    case 'CANCELLED':
      return { action: 'NONE', retryCurrentCommand: false, detail: '취소됐다.' };
    case 'UNKNOWN':
      return {
        action: 'CHECK_OPERATION',
        retryCurrentCommand: false,
        detail: '작업을 수행하던 프로세스의 생존 신호가 끊겼다 — **결과 미확정**이지 실패가 아니다. '
          + 'show_threads·controller_status 로 제어기 상태를 관측하고, 사용자에게 VS Code 창 상태를 확인할 것. '
          + '자동으로 다시 배포하지 말 것(업로드가 이미 끝났을 수 있다).',
      };
    default:
      return { action: 'NONE', retryCurrentCommand: false, detail: '알 수 없는 상태.' };
  }
}
