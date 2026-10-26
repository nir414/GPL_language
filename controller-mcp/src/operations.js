// 장시간 작업 기록(Operation) 읽기 — 확장 `src/controller/automation/operationStore.ts` 와 파일 계약을 공유한다.
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
import { NO_STATUS_CODE } from './parse.js';

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

// ── 결과 전달 기억 · 요약 · 축약 (2026-10-14 §1-EP) ─────────────────────────────────────
//
// 배경: deploy_project 가 완료 결과를 동기로 돌려줬는데도 AI 가 operation_status 목록 → 상세 → Show Memory 로
// 같은 사실을 세 번 더 확인하는 패턴이 반복됐다(호출당 고정 오버헤드 ≈1.5 s + 응답마다 수천 토큰). 데이터가
// 없어서가 아니라 "확인 습관"이 낭비를 만든 것이라, 서버가 **이미 전달한 완료 결과**를 기억해 두고 재조회에는
// 본문 없는 짧은 응답(`redundant:true`)을 돌려준다. 정보 손실은 없다 — 처음 전달 때 본문을 이미 받았다.

/** 더 바뀌지 않는 상태 — 이 상태의 결과는 한 번 전달하면 다시 읽을 이유가 없다. */
export function isTerminalOperationState(state) {
  return state === 'COMPLETED' || state === 'FAILED' || state === 'CANCELLED';
}

export class DeliveredResultMemory {
  constructor() {
    /** @type {Map<string, {state: string, firstAt: number, deliveries: number}>} */
    this._map = new Map();
  }

  /** 완료 결과 본문을 호출자에게 돌려줬음을 기록한다(진행 중 상태는 기록하지 않는다 — 다음 조회에 새 정보가 있다). */
  mark(operationId, state, now = Date.now()) {
    if (!operationId || !isTerminalOperationState(state)) return;
    const prev = this._map.get(operationId);
    if (prev && prev.state === state) {
      prev.deliveries += 1;
    } else {
      this._map.set(operationId, { state, firstAt: now, deliveries: 1 });
    }
  }

  /**
   * 같은 완료 결과를 이미 전달했는가.
   * @returns {{ redundant: boolean, deliveries: number, firstAt: number|null }}
   */
  check(operationId, state) {
    const prev = operationId ? this._map.get(operationId) : undefined;
    if (!prev || prev.state !== state || !isTerminalOperationState(state)) {
      return { redundant: false, deliveries: 0, firstAt: null };
    }
    return { redundant: true, deliveries: prev.deliveries, firstAt: prev.firstAt };
  }
}

/**
 * 결과 한 줄 요약 — 목록에서 상세를 다시 조회하지 않아도 "무엇이 어떻게 끝났는지" 읽히게(개선 요청 §7).
 * 확장 DeployResult 의 필드명을 그대로 쓴다. 모르는 모양이면 null.
 */
export function summarizeOperationResult(rec) {
  const r = rec?.result;
  if (!r || typeof r !== 'object') {
    return rec?.error?.message ? `error: ${rec.error.message}` : null;
  }
  const parts = [];
  if (r.uploadStats && typeof r.uploadStats === 'object') {
    const u = r.uploadStats;
    parts.push(`uploaded ${u.uploaded ?? '?'} · skipped ${u.skipped ?? '?'}${u.deleted ? ` · deleted ${u.deleted}` : ''}`);
  }
  if (typeof r.compileErrorCount === 'number') parts.push(`compileErrors ${r.compileErrorCount}`);
  if (r.provenance && typeof r.provenance === 'object' && typeof r.provenance.inSync === 'boolean') {
    const changed = Array.isArray(r.provenance.changedSinceUpload) ? r.provenance.changedSinceUpload.length : null;
    parts.push(r.provenance.inSync ? 'inSync' : `notInSync${changed != null ? ` (changed ${changed})` : ''}`);
  }
  if (typeof r.failedPhase === 'string') parts.push(`failedPhase ${r.failedPhase}`);
  // Start 뒤 메인 쓰레드 Error(§1-EU) — 목록만 보고도 "성공했지만 프로그램은 멈췄다" 를 알 수 있게.
  if (r.runtimeError && typeof r.runtimeError === 'object') {
    const e = r.runtimeError;
    parts.push(`runtimeError ${e.statusCode ?? '?'}${e.file ? ` @ ${e.file}:${e.line ?? '?'}` : ''}`);
  }
  // Compile 이 소켓 리셋으로 끊김(컴파일 에러와 구분, 2026-10-22 사고) + 생존 확인 결과.
  if (r.compileAborted && typeof r.compileAborted === 'object') {
    const a = r.compileAborted;
    parts.push(`compileAborted ${a.reason ?? '?'} (${typeof a.elapsedMs === 'number' ? `${(a.elapsedMs / 1000).toFixed(1)} s` : '?'}, 출력 ${a.outputLines ?? '?'}줄)`);
  }
  if (r.controllerHealth && typeof r.controllerHealth === 'object' && typeof r.controllerHealth.state === 'string') {
    parts.push(`controller ${r.controllerHealth.state}`);
  }
  // FTP 쓰기 전 제어기 정체 확인(확장 controller/connection/controllerIdentity.ts).
  if (r.controllerCheck && typeof r.controllerCheck === 'object' && typeof r.controllerCheck.verified === 'boolean') {
    const c = r.controllerCheck;
    parts.push(c.disabled ? 'controllerCheck off' : c.verified ? 'controllerCheck ok' : `controllerCheck unverified${c.overridden ? '(사용자 진행)' : ''}`);
  }
  if (typeof r.success === 'boolean' && parts.length === 0) parts.push(r.success ? 'success' : 'failed');
  return parts.length ? parts.join(' · ') : null;
}

/**
 * 확장이 보낸 제어기 명령(배포의 Compile)을 MCP 세션 로그 줄로 — 종전에는 deploy 항목이 `1402 0회` 로 찍혀
 * Compile 이 언제 나가서 몇 ms 뒤 끊겼는지 MCP 로그에서 볼 수 없었다(2026-10-22 보고 ③-2).
 * 확장 DeployResult(`compileAttemptLogs`) 와 작업 기록 요약(`compileCommands`) 모양을 모두 받는다. 모르는 모양이면 [].
 * 반환: `Compile BINDER_Probe | 22010ms | ABORTED ECONNRESET` 같은 줄(앞에 붙일 접두는 호출측 몫).
 */
export function extensionCommandLogLines(result) {
  if (!result || typeof result !== 'object') return [];
  const aborted = result.compileAborted && typeof result.compileAborted === 'object' ? result.compileAborted : null;
  const list = Array.isArray(result.compileCommands) ? result.compileCommands
    : Array.isArray(result.compileAttemptLogs) ? result.compileAttemptLogs : [];
  return list
    .filter((c) => c && typeof c.command === 'string')
    .map((c) => {
      const ms = typeof c.elapsedMs === 'number' ? `${c.elapsedMs}ms`
        : typeof c.responseMeta?.durationMs === 'number' ? `${c.responseMeta.durationMs}ms` : '?ms';
      const outcome = typeof c.outcome === 'string' ? c.outcome
        : aborted && aborted.command === c.command && c.statusCode === NO_STATUS_CODE ? `ABORTED ${aborted.reason}`
          : typeof c.statusCode === 'number' ? (c.statusCode === NO_STATUS_CODE ? 'NO STATUS' : `STATUS ${c.statusCode}`) : '?';
      return `${c.command} | ${ms} | ${outcome}`;
    });
}

/** 축약에서 버리는 키 — 사람이 읽을 일이 없는 내부 식별자/해시(결과 본문의 1/3 을 차지했다). */
const RESULT_DROP_KEYS = new Set(['localRevision', 'uploadedRevision', 'compiledSnapshotFiles', 'idempotencyKey', 'requestId']);
const RESULT_ARRAY_LIMIT = 10;

/**
 * 결과 본문 축약 — 알려진 잡음 키를 빼고 긴 배열은 앞 N개 + 개수로 줄인다. 구조·나머지 키는 그대로라
 * 어떤 모양의 결과든(DEPLOY/QUICK_COMPILE/확장이 새로 추가한 필드) 안전하다. `verbose` 요청이면 쓰지 않는다.
 */
export function compactOperationResult(result, { arrayLimit = RESULT_ARRAY_LIMIT } = {}) {
  if (!result || typeof result !== 'object') return result ?? null;
  if (Array.isArray(result)) {
    return result.length > arrayLimit
      ? [...result.slice(0, arrayLimit).map((v) => compactOperationResult(v, { arrayLimit })), `…(+${result.length - arrayLimit})`]
      : result.map((v) => compactOperationResult(v, { arrayLimit }));
  }
  const out = {};
  for (const [k, v] of Object.entries(result)) {
    if (RESULT_DROP_KEYS.has(k)) continue;
    out[k] = v && typeof v === 'object' ? compactOperationResult(v, { arrayLimit }) : v;
  }
  return out;
}

/** 목록 한 항목 — 식별·상태·요약만(projectDir·pid·host·instance 는 verbose 에서만). */
export function compactOperation(rec, now = Date.now()) {
  return {
    operationId: rec.operationId,
    type: rec.type,
    state: rec.state,
    phase: rec.phase,
    projectName: rec.projectName ?? null,
    createdAt: rec.createdAt,
    finishedAt: rec.finishedAt ?? null,
    summary: describeOperation(rec, now),
    resultSummary: summarizeOperationResult(rec),
  };
}

/** 상세 기록 축약 — 생존 신호·식별자 같은 내부 필드를 빼고 결과 본문은 compactOperationResult 로. */
export function compactOperationRecord(rec) {
  return {
    operationId: rec.operationId,
    type: rec.type,
    state: rec.state,
    phase: rec.phase,
    projectName: rec.projectName ?? null,
    projectDir: rec.projectDir ?? null,
    createdAt: rec.createdAt,
    finishedAt: rec.finishedAt ?? null,
    ...(rec.result !== undefined ? { result: compactOperationResult(rec.result) } : {}),
    ...(rec.error !== undefined ? { error: rec.error } : {}),
  };
}
