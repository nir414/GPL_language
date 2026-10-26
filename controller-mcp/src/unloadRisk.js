// 그룹 Compile 뒤 Unload 위험 — 확장 src/controller/commands/unloadRisk.ts(판정 정본)·unloadRiskStore.ts(파일)의 MCP 쪽 구현.
//
// 왜 MCP 에도 있는가: 확장 브리지가 있으면 확장의 전송 가드가 같은 판정을 하지만, 확장이 없을 때(직접 접속) 이 서버가
// `Unload` 를 그대로 보내면 가드가 없다. 같은 파일(%TEMP%/gpl-controller/unload-risk-<ip>.json)을 읽어 **같은 판정**을
// 먼저 하고, 직접 접속으로 그룹을 컴파일했을 때는 표시를 켠다. 브리지 경로에서는 확인(confirm)을 확장에 그대로 넘긴다.
//
// 파일 계약(확장과 반드시 동일):
//   { "version": 1, "controllerId": string, "marks": [{ "project", "at", "via" }], "channelLossAt"?: ms,
//     "updatedAt": ms, "lastClearedAt"?: ms, "lastClearedReason"?: string }
// 표시 해제(재부팅 근거 판정)는 FTP 를 여는 확장이 맡는다 — 이 서버는 지우지 않는다.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseStatus, parseCompileErrors } from './parse.js';
import { DEPLOY_LOCK_DIR_NAME } from './deployLock.js';

export const UNLOAD_RISK_REFUSAL = 'unload-after-group-compile';
export const PROJECT_NOT_RUNNABLE = 'PROJECT_NOT_RUNNABLE';
export const STATUS_INVALID_START_PROCEDURE = -744;
export const UNLOAD_RISK_EVIDENCE = Object.freeze({ disrupted: 6, observed: 6, period: '2026-10-22~23' });

const sameName = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

export function unloadRiskDir(env = process.env) {
  return env.GPL_LOCK_DIR || path.join(os.tmpdir(), DEPLOY_LOCK_DIR_NAME);
}

export function unloadRiskFilePath(host, dir = unloadRiskDir()) {
  const safe = String(host ?? '').trim().replace(/[^A-Za-z0-9._-]/g, '_') || 'unknown';
  return path.join(dir, `unload-risk-${safe}.json`);
}

/** 현재 상태. 없거나 깨졌으면 null(= 표시 없음). */
export function readUnloadRiskState(host, { dir } = {}) {
  try {
    const raw = JSON.parse(fs.readFileSync(unloadRiskFilePath(host, dir), 'utf8'));
    if (!raw || typeof raw !== 'object') return null;
    const marks = Array.isArray(raw.marks)
      ? raw.marks
        .filter((m) => m && typeof m === 'object' && typeof m.project === 'string' && m.project.trim() && typeof m.at === 'number')
        .map((m) => ({ project: m.project.trim(), at: m.at, via: typeof m.via === 'string' ? m.via : 'unknown' }))
      : [];
    return { ...raw, controllerId: raw.controllerId || host, marks };
  } catch {
    return null;
  }
}

/** 그룹 Compile 표시를 켠다(같은 프로젝트면 시각만 갱신). 쓰기 실패는 false. */
export function markGroupCompile(host, project, via, { dir, now = Date.now() } = {}) {
  const current = readUnloadRiskState(host, { dir }) ?? { version: 1, controllerId: host, marks: [], updatedAt: now };
  const marks = current.marks.filter((m) => !sameName(m.project, project));
  const next = { ...current, version: 1, controllerId: host, marks: [...marks, { project: String(project).trim(), at: now, via }], updatedAt: now };
  const file = unloadRiskFilePath(host, dir);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${now}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

/** `Unload …` 면 { all, target }, 아니면 null. */
export function parseUnloadCommand(command) {
  const tokens = String(command ?? '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length || tokens[0].toLowerCase() !== 'unload') return null;
  const rest = tokens.slice(1);
  return { all: rest.some((t) => /^-all$/i.test(t)), target: rest.find((t) => !t.startsWith('-')) };
}

/** Unload 위험 판정 — Unload 가 아니면 null. 표시가 하나라도 있으면 대상이 앱이든 -all 이든 위험. */
export function assessUnloadRisk(state, command) {
  const unload = parseUnloadCommand(command);
  if (!unload) return null;
  const marks = [...(state?.marks ?? [])].sort((a, b) => a.at - b.at);
  return {
    risky: marks.length > 0,
    command: String(command).trim(),
    scope: unload.all ? 'all' : 'project',
    ...(unload.target && !unload.all ? { target: unload.target } : {}),
    groupProjects: marks.map((m) => m.project),
    ...(marks.length ? { lastGroupCompileAt: marks[marks.length - 1].at } : {}),
  };
}

const groupLabel = (a) => (a.groupProjects.length ? a.groupProjects.join(', ') : '(미상)');
const EVIDENCE_LINE = `이 조합은 지금까지 ${UNLOAD_RISK_EVIDENCE.observed}번 중 ${UNLOAD_RISK_EVIDENCE.disrupted}번 명령 콘솔을 끊었고`
  + ` (${UNLOAD_RISK_EVIDENCE.period} 실측), 최근 사례는 제어기 재부팅으로만 복구됐다.`;

export function unloadRiskRefusalDetail(a) {
  return `${a.command} 를 보내지 않았다 — 같은 부팅에서 그룹 프로젝트(ProjectStart 없는 .gpr: ${groupLabel(a)})를 `
    + `Compile 한 뒤의 Unload 다. ${EVIDENCE_LINE} `
    + '사용자에게 이 위험을 알리고 **동의를 받은 뒤에만** confirm:true 로 다시 호출할 것. '
    + '메모리 회수가 목적이면 제어기 재부팅이 더 빠를 수 있다.';
}

export function unloadTimeoutGuidance(a) {
  return `그룹 프로젝트(${groupLabel(a)}) Compile 뒤의 ${a.command} 가 응답 없이 끝났다. `
    + '이 조합은 지금까지 복구에 제어기 재부팅이 필요했다 — 채널 복구 대기(최대 180초)를 기다리기보다 '
    + '진행 중 작업과 모션 상태를 확인한 뒤 제어기 재부팅을 사용자에게 제안할 것. 같은 Unload 를 다시 보내지 말 것.';
}

/** 확인 없이 보내려던 위험 Unload 의 거부 결과(보내지 않음). */
export function unloadRiskRefusalResult(a, extra = {}) {
  return {
    command: a.command,
    ok: false,
    refused: UNLOAD_RISK_REFUSAL,
    error: UNLOAD_RISK_REFUSAL,
    sent: false,
    outcome: 'not-sent',
    detail: unloadRiskRefusalDetail(a),
    groupProjects: a.groupProjects,
    lastGroupCompileAt: a.lastGroupCompileAt ? new Date(a.lastGroupCompileAt).toISOString() : null,
    recovery: { action: 'ASK_USER', retryCurrentCommand: false, retryWith: { confirm: true } },
    ...extra,
  };
}

/** 응답이 "프로젝트 컴파일 성공"을 증명하면 그 이름 — Compile STATUS 0 / Start -compile STATUS 0·-744, 에러 줄 없음. */
export function compiledProjectFromResponse(command, raw) {
  const tokens = String(command ?? '').trim().split(/\s+/).filter(Boolean);
  const verb = (tokens[0] ?? '').toLowerCase();
  const rest = tokens.slice(1);
  const target = rest.find((t) => !t.startsWith('-'));
  if (!target) return null;
  const isStartCompile = verb === 'start' && rest.some((t) => /^-compile$/i.test(t));
  if (verb !== 'compile' && !isStartCompile) return null;
  const status = parseStatus(raw ?? '');
  if (!status.complete) return null;
  if (parseCompileErrors(raw ?? '').errors.length > 0) return null;
  const ok = status.code === 0 || (isStartCompile && status.code === STATUS_INVALID_START_PROCEDURE);
  return ok ? target : null;
}

/** 프로젝트 폴더의 `.gpr` — { projectName, runnable }. `.gpr` 가 없거나 읽지 못하면 null(모름). */
export function readGprInfo(dir) {
  if (!dir) return null;
  try {
    const gpr = fs.readdirSync(dir).find((f) => f.toLowerCase().endsWith('.gpr'));
    if (!gpr) return null;
    const text = fs.readFileSync(path.join(dir, gpr), 'utf8');
    const name = (text.match(/ProjectName\s*=\s*"([^"]*)"/i)?.[1] ?? '').trim();
    const start = (text.match(/ProjectStart\s*=\s*"([^"]*)"/i)?.[1] ?? '').trim();
    return { projectName: name || path.basename(dir), runnable: start.length > 0 };
  } catch {
    return null;
  }
}

export function notRunnableStartDetail(project, runnableCandidates = []) {
  const list = runnableCandidates.length ? ` 실행 가능한 후보: ${runnableCandidates.join(', ')}.` : '';
  return `'${project}' 는 .gpr 에 ProjectStart 가 없는 그룹(라이브러리) 프로젝트라 Start 할 수 없다 — `
    + '보내면 그룹 Compile 뒤 -744(*Invalid start procedure*)로 끝나고, 그 Compile 이 이 부팅을 Unload 위험 상태로 만든다. '
    + `정지·업로드·컴파일 전에 멈췄다(제어기에 보내지 않음). 실행 가능한 프로젝트를 지정할 것.${list}`;
}

/** 배포의 START 단계 실패가 -744(실행 불가 프로젝트)인가 — 되풀이하면 그룹 Compile 만 또 일어난다. */
export function isNotRunnableStartFailure(failedPhase, statusCode) {
  return failedPhase === 'START' && statusCode === STATUS_INVALID_START_PROCEDURE;
}
