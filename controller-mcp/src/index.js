#!/usr/bin/env node
// GPL Controller MCP server.
// Brooks / Precise Automation PA 제어기를 1402 ASCII 콘솔로 조작한다.
// Claude(Desktop/Cowork/Code)가 compile / run / debug 도구를 호출할 수 있게 노출.
//
// 설정(환경변수):
//   GPL_HOST       제어기 IP            (기본 192.168.0.1)
//   GPL_PORT       콘솔 포트            (기본 1402)
//   GPL_PROJECT    기본 프로젝트명      (기본 MergeCode)
//   GPL_TIMEOUT_MS 명령 타임아웃(ms)    (기본 15000)
//   GPL_LOCK_WAIT_MS 배포 잠금 대기 상한(ms) (기본 20000) — VS Code 확장이 FTP 업로드/배포 중이면
//                  Compile/Start/Load/Unload를 이 시간까지 기다렸다 진행, 초과 시 거부 (src/deployLock.js)
//
// 주의: stdout은 MCP 전송 채널이다. 로그는 반드시 stderr(console.error)로만.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ControllerConsole } from './console.js';
import {
  parseStatus,
  extractData,
  parseCompileErrors,
  parseThreadList,
  parseThreadDetail,
  normalizeThreadState,
  PAUSED_STATES,
  statusHint,
  isSuccess,
} from './parse.js';
import { readDeployLock, waitForDeployLockRelease, describeDeployLock, DEPLOY_GUARDED_COMMAND_RE } from './deployLock.js';

const HOST = process.env.GPL_HOST || '192.168.0.1';
const PORT = parseInt(process.env.GPL_PORT || '1402', 10);
const DEFAULT_PROJECT = process.env.GPL_PROJECT || 'MergeCode';
const TIMEOUT = parseInt(process.env.GPL_TIMEOUT_MS || '15000', 10);
const IDLE_CLOSE = parseInt(process.env.GPL_IDLE_CLOSE_MS || '30000', 10);
const LOCK_WAIT_MS = parseInt(process.env.GPL_LOCK_WAIT_MS || '20000', 10);

// ── 세션 로그 ─────────────────────────────────────────────────────────────
// 모든 도구 호출과 1402 명령을 타임스탬프/소요시간/STATUS와 함께 기록한다.
// 목적: ① 사용자가 파일을 tail 하면 AI가 지금 뭘 하는지 실시간으로 보인다
//       ② 왕복 낭비 분석용 원본을 그대로 복사해 공유할 수 있다
//       ③ get_session_log로 AI 스스로 호출 횟수를 점검할 수 있다.
const LOG_DIR = process.env.GPL_MCP_LOG_DIR || path.join(os.tmpdir(), 'gpl-mcp');
let LOG_FILE = null;
try {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  LOG_FILE = path.join(LOG_DIR, `gpl-mcp-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.log`);
} catch { /* 파일 로그 실패 시 링버퍼만 사용 */ }

const logRing = [];
let cmdSeq = 0; // 1402 명령 누적 수(도구별 왕복 수 계산용)

function logLine(text) {
  const line = `${new Date().toISOString()} ${text}`;
  logRing.push(line);
  if (logRing.length > 2000) logRing.shift();
  if (LOG_FILE) {
    try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch { /* noop */ }
  }
}

const clip = (s, n = 300) => (s.length > n ? `${s.slice(0, n)}…` : s);

const consoleClient = new ControllerConsole({
  host: HOST,
  port: PORT,
  commandTimeoutMs: TIMEOUT,
  idleCloseMs: IDLE_CLOSE,
  onCommand: ({ command, ms, raw, error }) => {
    cmdSeq++;
    const tag = error ? `ERROR ${error.message}` : `STATUS ${parseStatus(raw).code}`;
    logLine(`  1402> ${command} | ${ms}ms | ${tag}`);
  },
});

const server = new McpServer({ name: 'gpl-controller-mcp', version: '0.1.0' });

function textResult(payload) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  return { content: [{ type: 'text', text }] };
}

// ── 배포 잠금 가드 ────────────────────────────────────────────────────────
// VS Code 확장이 FTP 업로드/배포 중이면 %TEMP%/gpl-controller/<ip>.lock.json을 잡고 있다(확장 deployLock.ts와
// 파일 계약 공유). 업로드 도중 Compile/Start(그리고 /GPL 폴더를 건드리는 Load/Unload)가 겹치면 제어기가 죽을
// 수 있어(2026-08-20 관찰, GitHub #17) 해당 명령은 잠금이 풀릴 때까지 유한 대기 후 진행하고, 초과 시 거부한다.
// 대기를 서버가 내장하므로 AI가 폴링 왕복을 반복할 필요가 없다(§1-AS와 같은 취지).
async function guardDeployLock(command) {
  if (!DEPLOY_GUARDED_COMMAND_RE.test(command)) return;
  const first = readDeployLock(HOST);
  if (!first) return;
  logLine(`  lock  배포 잠금 대기: ${describeDeployLock(first)} (최대 ${LOCK_WAIT_MS}ms) ← ${command}`);
  const wait = await waitForDeployLockRelease(HOST, { maxMs: LOCK_WAIT_MS });
  if (wait.released) {
    logLine(`  lock  해제 확인 (${wait.waitedMs}ms 대기) → ${command}`);
    return;
  }
  throw new Error(
    `배포 잠금 보유 중 — ${describeDeployLock(wait.holder)}. VS Code 확장의 업로드/배포가 끝나기 전에는 ` +
    'Compile/Start/Load/Unload를 보내지 않는다(업로드 도중 겹치면 제어기 이상 유발). 우회하지 말고 잠시 후 ' +
    `재시도하거나 사용자에게 알린다. 잠금 파일: ${wait.file}`,
  );
}

/** 잠금 가드를 거친 전송(Compile/Start/Load/Unload만 실제로 대기·거부된다). */
async function sendGuarded(command, opts) {
  await guardDeployLock(command);
  return consoleClient.send(command, opts);
}

async function runCommand(command, opts) {
  const raw = await sendGuarded(command, opts);
  const status = parseStatus(raw);
  const ok = isSuccess(status);
  const result = { command, status, ok, data: extractData(raw) };
  if (!ok) {
    // 실패 시 "무엇을 바꿔 재시도할지"를 응답에 함께 실어, 같은 부류의
    // 재시도 낭비(-780 eval 반복, -714 없는 명령 추측 등)를 그 자리에서 끊는다.
    const hint = statusHint(status.code);
    if (hint) result.hint = hint;
  }
  return result;
}

// 모든 핸들러를 try/catch로 감싸 에러를 도구 결과로 반환(서버 크래시 방지).
// 도구 호출마다 세션 로그에 시작/종료(소요시간·1402 왕복 수)를 남긴다.
function tool(name, description, shape, handler) {
  server.tool(name, description, shape, async (args) => {
    const t0 = Date.now();
    const c0 = cmdSeq;
    logLine(`tool ${name} ${clip(JSON.stringify(args ?? {}))}`);
    try {
      const res = await handler(args ?? {});
      logLine(`tool ${name} 완료 | ${Date.now() - t0}ms | 1402 ${cmdSeq - c0}회`);
      return res;
    } catch (err) {
      logLine(`tool ${name} 실패 | ${Date.now() - t0}ms | ${err?.message ?? String(err)}`);
      return {
        content: [{ type: 'text', text: `ERROR (${name}): ${err?.message ?? String(err)}` }],
        isError: true,
      };
    }
  });
}

const proj = (p) => (p && p.trim()) || DEFAULT_PROJECT;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Break/Step/Continue의 STATUS 0은 "접수"일 수 있다(접수≠완료 — 확장 waitForThreadPause와
 * 같은 근거). 실제 정지는 `Show Thread <thread>` 상세를 폴링해 정지 계열 상태
 * (Paused/Break/Error)로 확인한다. 이 확인을 서버가 내장하므로 호출측(AI)이 스텝/재개마다
 * show_thread를 따로 부를 필요가 없다 — MCP 왕복이 절반으로 준다.
 *
 * staleLocation: 직전 정지 위치. Step/Continue 접수 직후엔 제어기가 아직 움직이기 전이라
 * 옛 위치의 Paused가 관측될 수 있어, staleGraceMs 동안은 같은 위치의 Paused를 무시한다.
 */
async function waitForThreadPause(
  thread,
  { timeoutMs = 5000, pollMs = 150, staleLocation = null, staleGraceMs = 600 } = {},
) {
  const start = Date.now();
  const deadline = start + Math.max(0, timeoutMs);
  let last = null;
  for (;;) {
    const raw = await consoleClient.send(`Show Thread ${thread}`);
    const detail = parseThreadDetail(raw);
    if (detail) {
      last = detail;
      if (PAUSED_STATES.has(detail.state)) {
        const isStale = staleLocation
          && Date.now() - start < staleGraceMs
          && detail.file === staleLocation.file
          && detail.fileLine === staleLocation.fileLine;
        if (!isStale) return { paused: true, detail };
      }
    }
    if (Date.now() >= deadline) return { paused: false, detail: last };
    await sleep(pollMs);
  }
}

/** 현재 스레드 상세(정지 위치 비교용 스냅샷). 실패해도 null로 계속 진행. */
async function snapshotThread(thread) {
  try {
    return parseThreadDetail(await consoleClient.send(`Show Thread ${thread}`));
  } catch {
    return null;
  }
}

const EVAL_LIMIT_RE = /\(-7(?:29|80)\)/;

/** 정지 직후 여러 변수를 한 번에 평가(관측 배치). 각 결과에 실패 힌트 포함. */
async function evalMany(thread, frame, expressions) {
  const out = [];
  for (const expression of expressions) {
    const r = await runCommand(`Show Variable -eval ${thread} ${frame} ${expression}`);
    const entry = { expression, ok: r.ok, value: r.data, status: r.status };
    const hint = r.hint ?? (EVAL_LIMIT_RE.test(String(r.data)) ? statusHint(-780) : undefined);
    if (hint) entry.hint = hint;
    out.push(entry);
  }
  return out;
}

/** 정지 확인 결과를 도구 응답용 위치 요약으로 변환. */
function locationOf(detail) {
  if (!detail) return undefined;
  return {
    state: detail.state,
    file: detail.file || undefined,
    line: detail.fileLine || undefined,
    process: detail.process || undefined,
    procLine: detail.procLine || undefined,
    project: detail.project || undefined,
  };
}

// 연속 스텝 감시: 같은 스레드에 스텝만 반복하는 것은 LLM 에이전트의 알려진 낭비
// 패턴(unproductive loop)이다. 금지하지는 않되, 임계 이상이면 응답에 넛지를 실어
// run_to_line/정적 분석으로 전환을 유도한다.
const STEP_STREAK_NUDGE_AT = 3;
const stepStreak = { thread: null, count: 0 };
function noteStep(thread) {
  stepStreak.count = stepStreak.thread === thread ? stepStreak.count + 1 : 1;
  stepStreak.thread = thread;
  return stepStreak.count;
}
function resetStepStreak() {
  stepStreak.thread = null;
  stepStreak.count = 0;
}

// ── 기본/에스케이프 ───────────────────────────────────────────────────────
tool('controller_command',
  '임의의 1402 콘솔 명령을 그대로 전송한다(에스케이프 해치). 구조화 도구로 안 되는 명령에만 사용.',
  { command: z.string().describe('보낼 콘솔 명령 한 줄') },
  async ({ command }) => textResult(await runCommand(command)));

tool('get_session_log',
  '이 MCP 세션의 도구 호출/1402 명령 로그(타임스탬프·소요시간·STATUS·도구별 왕복 수)를 반환한다. ' +
  '왕복 낭비 자가 점검과 사용자 공유용. 같은 내용이 로그 파일에도 기록된다.',
  { tail: z.number().int().min(1).max(2000).optional().describe('마지막 N줄(기본 200)') },
  async ({ tail }) => textResult({
    logFile: LOG_FILE,
    hint: LOG_FILE ? `사용자는 PowerShell에서 'Get-Content "${LOG_FILE}" -Wait'로 실시간 관찰 가능` : '파일 로그 비활성(링버퍼만)',
    entries: logRing.slice(-(tail ?? 200)),
  }));

tool('controller_status',
  '제어기 연결/스레드 상태를 빠르게 확인한다(Show Thread -web).',
  {},
  async () => {
    const raw = await consoleClient.send('Show Thread -web');
    const status = parseStatus(raw);
    const { threads } = parseThreadList(raw);
    // 배포 잠금(VS Code 확장이 업로드/배포 중이면 존재) — 있으면 Compile/Start는 대기·거부된다.
    const lock = readDeployLock(HOST);
    const deployLock = lock ? { holder: lock.owner, stage: lock.stage, since: new Date(lock.since).toISOString(), describe: describeDeployLock(lock) } : null;
    return textResult({ host: HOST, port: PORT, ok: isSuccess(status), status, threadCount: threads.length, threads, deployLock });
  });

// ── 컴파일/실행 ───────────────────────────────────────────────────────────
tool('compile_project',
  '프로젝트를 컴파일한다(Compile). 성공/실패는 STATUS로만 판정하고, 실패 시 에러 라인을 파싱해 돌려준다.',
  { project: z.string().optional().describe(`프로젝트명(기본 ${DEFAULT_PROJECT})`) },
  async ({ project }) => {
    const raw = await sendGuarded(`Compile ${proj(project)}`, { timeoutMs: Math.max(TIMEOUT, 60000) });
    const status = parseStatus(raw);
    const { errors, aggregate } = parseCompileErrors(raw);
    return textResult({ command: `Compile ${proj(project)}`, ok: isSuccess(status), status, errorCount: errors.length, errors, aggregate });
  });

tool('start_project',
  '프로젝트 실행을 시작한다(Start). stopOnEntry=true면 진입점에서 정지(-break -bex). [시뮬레이션 모드 권장]',
  {
    project: z.string().optional(),
    stopOnEntry: z.boolean().optional().describe('진입점에서 멈춤(디버그 시작용)'),
  },
  async ({ project, stopOnEntry }) => {
    const cmd = stopOnEntry ? `Start ${proj(project)} -break -bex` : `Start ${proj(project)}`;
    return textResult(await runCommand(cmd));
  });

tool('unload_project',
  '프로젝트를 메모리에서 제거한다(Unload).',
  { project: z.string().optional() },
  async ({ project }) => textResult(await runCommand(`Unload ${proj(project)}`)));

// ── 실행 제어(디버그) ─────────────────────────────────────────────────────
tool('pause_thread',
  '실행 중인 스레드를 일시정지한다(Break <thread>). 사전(이미 정지면 명령 생략)·사후(실제 정지+위치) 상태 확인이 내장되어 있으니 이 도구 앞뒤에 show_thread를 끼워 넣지 말 것.',
  { thread: z.string().describe('스레드 이름(보통 프로젝트명과 동일)') },
  async ({ thread }) => {
    resetStepStreak();
    const before = await snapshotThread(thread);
    if (before && PAUSED_STATES.has(before.state)) {
      return textResult({ ok: true, alreadyPaused: true, location: locationOf(before) });
    }
    const r = await runCommand(`Break ${thread}`);
    if (!r.ok) return textResult(r);
    const wait = await waitForThreadPause(thread);
    return textResult({ ...r, stopped: wait.paused, location: locationOf(wait.detail) });
  });

tool('continue_thread',
  '일시정지된 스레드를 재개한다(Continue). 사전 상태 확인(비정지면 거부)과 재개 후 waitForStopMs 동안의 다음 정지 폴링이 내장 — 이 도구 앞뒤에 show_thread를 끼워 넣지 말 것. ' +
  'ignoreErrors=true면 -noerror. 특정 줄 도달이 목적이면 run_to_line을 쓸 것. [실행 재개 — 모션 영향 가능]',
  {
    thread: z.string(),
    ignoreErrors: z.boolean().optional(),
    waitForStopMs: z.number().int().min(0).max(120000).optional()
      .describe('다음 정지를 기다리는 시간(ms, 기본 3000). 브레이크포인트 도달을 기다릴 땐 크게'),
  },
  async ({ thread, ignoreErrors, waitForStopMs }) => {
    resetStepStreak();
    const before = await snapshotThread(thread);
    if (before && !PAUSED_STATES.has(before.state)) {
      return textResult({
        ok: false, refused: 'thread-not-paused', state: before.state, location: locationOf(before),
        hint: `Continue는 정지 상태에서만 의미가 있다(현재 ${before.state}). 사전 확인은 이 도구에 내장 — 별도 show_thread 불필요.`,
      });
    }
    const r = await runCommand(`Continue ${thread}${ignoreErrors ? ' -noerror' : ''}`);
    if (!r.ok) return textResult(r);
    const wait = await waitForThreadPause(thread, {
      timeoutMs: waitForStopMs ?? 3000,
      staleLocation: before && PAUSED_STATES.has(before.state)
        ? { file: before.file, fileLine: before.fileLine } : null,
    });
    return textResult({
      ...r,
      stopped: wait.paused,
      location: locationOf(wait.detail),
      ...(wait.paused ? {} : {
        note: `waitForStopMs 내 정지 없음 — 계속 실행 중일 수 있다(마지막 관측 상태: ${wait.detail?.state ?? '불명'}). 성공/실패 판정에 이 응답을 그대로 쓰지 말 것.`,
      }),
    });
  });

tool('step_thread',
  '한 줄 스텝(Step, mode: into(기본)/over/out, 항상 -noerror). 사전(비정지면 거부)·사후(실제 정지+위치) 상태 확인이 내장 — 이 도구 앞뒤에 show_thread를 끼워 넣지 말 것. ' +
  'evals로 정지 직후 변수 관측을 배치로 묶을 수 있다. 주의: 특정 줄/분기 도달 확인이 목적이면 스텝을 반복하지 말고 run_to_line 1회를 사용할 것.',
  {
    thread: z.string(),
    mode: z.enum(['into', 'over', 'out']).optional(),
    evals: z.array(z.string()).optional()
      .describe('정지 확인 후 프레임 0에서 평가할 필드/로컬 변수 목록(점 표기·메서드 호출 불가)'),
  },
  async ({ thread, mode, evals }) => {
    const before = await snapshotThread(thread);
    if (before && !PAUSED_STATES.has(before.state)) {
      return textResult({
        ok: false, refused: 'thread-not-paused', state: before.state, location: locationOf(before),
        hint: `Step은 정지 상태에서만 가능하다(현재 ${before.state}). 실행 중이면 pause_thread 또는 run_to_line을 사용할 것. 사전 확인은 이 도구에 내장 — 별도 show_thread 불필요.`,
      });
    }
    const flag = mode === 'over' ? ' -over' : mode === 'out' ? ' -out' : '';
    const r = await runCommand(`Step ${thread}${flag} -noerror`);
    if (!r.ok) return textResult(r);
    const wait = await waitForThreadPause(thread, {
      staleLocation: before && PAUSED_STATES.has(before.state)
        ? { file: before.file, fileLine: before.fileLine } : null,
    });
    const result = { ...r, before: locationOf(before), stopped: wait.paused, location: locationOf(wait.detail) };
    if (wait.paused && evals?.length) {
      result.evals = await evalMany(thread, 0, evals);
    }
    const streak = noteStep(thread);
    if (streak >= STEP_STREAK_NUDGE_AT) {
      result.advice = `연속 스텝 ${streak}회째 — 정보를 주지 않는 줄을 한 줄씩 지나는 것은 낭비다. ` +
        '목적지가 정해져 있으면 run_to_line(중단점+Continue+정지확인을 1회 호출로 수행)을 사용하고, ' +
        '분기 결과가 코드만으로 결정되면 정적 분석으로 결론 낼 것.';
    }
    return textResult(result);
  });

tool('run_to_line',
  '지정 줄까지 실행: 임시 중단점 설정 → Continue → 실제 정지 확인 → (옵션) 변수 배치 평가 → 중단점 정리를 한 번의 호출로 수행한다. ' +
  '여러 줄을 지나 특정 지점에 도달할 때는 step_thread 반복 대신 이 도구를 사용할 것. [실행 재개 — 모션 영향 가능]',
  {
    thread: z.string(),
    file: z.string().describe('예: ProtocolModule.gpl'),
    line: z.number().int().positive(),
    project: z.string().optional(),
    evals: z.array(z.string()).optional()
      .describe('정지 확인 후 프레임 0에서 평가할 필드/로컬 변수 목록(점 표기·메서드 호출 불가)'),
    keepBreakpoint: z.boolean().optional().describe('true면 중단점을 남긴다(기본: 종료 시 해제)'),
    timeoutMs: z.number().int().min(500).max(600000).optional().describe('정지 대기 한도(ms, 기본 20000)'),
  },
  async ({ thread, file, line, project, evals, keepBreakpoint, timeoutMs }) => {
    resetStepStreak();
    const bp = await runCommand(`Set Break ${proj(project)} "${file}"${line}`);
    if (!bp.ok) return textResult({ phase: 'set_breakpoint', ...bp });

    const before = await snapshotThread(thread);
    // 이미 실행 중(Running 등)이면 Continue가 불필요 — 중단점 히트만 기다린다.
    const needContinue = !before || PAUSED_STATES.has(before.state);
    const cont = needContinue
      ? await runCommand(`Continue ${thread}`)
      : { ok: true, skipped: 'thread-already-running' };
    let wait = { paused: false, detail: null };
    if (cont.ok) {
      wait = await waitForThreadPause(thread, {
        timeoutMs: timeoutMs ?? 20000,
        staleLocation: before && PAUSED_STATES.has(before.state)
          ? { file: before.file, fileLine: before.fileLine } : null,
      });
    }

    const atRequestedLine = !!(wait.paused && wait.detail
      && String(wait.detail.file).toLowerCase() === file.toLowerCase()
      && wait.detail.fileLine === line);
    const result = {
      requested: { file, line },
      continueOk: cont.ok,
      ...(cont.skipped ? { continueSkipped: cont.skipped } : {}),
      ...(cont.ok ? {} : { continueStatus: cont.status, ...(cont.hint ? { hint: cont.hint } : {}) }),
      stopped: wait.paused,
      atRequestedLine,
      location: locationOf(wait.detail),
    };
    if (wait.paused && evals?.length) {
      result.evals = await evalMany(thread, 0, evals);
    }
    if (!keepBreakpoint) {
      const clear = await runCommand(`Set Nobreak ${proj(project)} "${file}"${line}`);
      result.breakpointCleared = clear.ok;
    }
    if (wait.paused && !atRequestedLine) {
      result.note = '요청한 줄이 아닌 다른 지점에서 정지했다(다른 브레이크포인트/에러 가능). location을 확인할 것.';
    } else if (!wait.paused && cont.ok) {
      result.note = `${timeoutMs ?? 20000}ms 내 정지 없음 — 해당 줄이 이 실행 경로에서 실행되지 않거나 오래 걸릴 수 있다. ` +
        (keepBreakpoint ? '중단점은 남아 있으니 이후 show_thread로 재확인할 것.' : '임시 중단점은 해제했다.');
    }
    return textResult(result);
  });

tool('softestop',
  '모든 로봇 모션을 급정지한다(SoftEStop, 모터 전원은 유지). 안전 정지용.',
  {},
  async () => textResult(await runCommand('SoftEStop')));

// ── 브레이크포인트 ────────────────────────────────────────────────────────
// 주의: Set Break/Nobreak는 따옴표와 줄번호 사이에 공백이 없다(GDE 캡처로 검증).
tool('set_breakpoint',
  '브레이크포인트 설정(Set Break <project> "<file>"<line>). file은 따옴표 안 파일명.',
  { file: z.string().describe('예: ProtocolModule.gpl'), line: z.number().int().positive(), project: z.string().optional() },
  async ({ file, line, project }) => {
    resetStepStreak();
    return textResult(await runCommand(`Set Break ${proj(project)} "${file}"${line}`));
  });

tool('clear_breakpoint',
  '브레이크포인트 해제(Set Nobreak <project> "<file>"<line>).',
  { file: z.string(), line: z.number().int().positive(), project: z.string().optional() },
  async ({ file, line, project }) => textResult(await runCommand(`Set Nobreak ${proj(project)} "${file}"${line}`)));

tool('list_breakpoints',
  '설정된 모든 브레이크포인트 표시(Show Break).',
  {},
  async () => textResult(await runCommand('Show Break')));

// ── 관찰(스레드/스택/변수) ────────────────────────────────────────────────
tool('debug_snapshot',
  '디버깅 상황 파악 원샷: 전체 스레드 목록 + (지정/자동 선택한 정지 스레드의) 위치 상세 + 호출 스택 + 선택 변수 평가를 한 호출로 반환한다. ' +
  '세션 시작 직후·정지 직후 "지금 어디서 뭘 하고 있나"는 show_threads/show_thread/show_stack을 따로 부르지 말고 이걸 먼저 쓸 것.',
  {
    thread: z.string().optional().describe('생략 시 정지(Paused/Break/Error) 상태인 첫 스레드 자동 선택'),
    evals: z.array(z.string()).optional().describe('정지 스레드에서 평가할 필드/로컬 변수 목록'),
    frame: z.number().int().min(0).optional().describe('evals 평가 프레임(기본 0)'),
  },
  async ({ thread, evals, frame }) => {
    const raw = await consoleClient.send('Show Thread -web');
    const status = parseStatus(raw);
    const { threads } = parseThreadList(raw);
    const summary = threads.map((t) => ({
      name: t.name,
      state: normalizeThreadState(t.fields[1] ?? ''),
      raw: t.raw,
    }));
    const result = { ok: isSuccess(status), status, threads: summary };
    const focus = thread
      ?? summary.find((t) => PAUSED_STATES.has(t.state))?.name
      ?? null;
    if (focus) {
      const detail = await snapshotThread(focus);
      result.focusThread = focus;
      result.location = locationOf(detail);
      const stack = await runCommand(`Show Stack ${focus}`);
      result.stack = stack.ok ? stack.data : stack;
      if (evals?.length && detail && PAUSED_STATES.has(detail.state)) {
        result.evals = await evalMany(focus, frame ?? 0, evals);
      }
    } else {
      result.note = '정지 상태의 스레드가 없다. 필요하면 pause_thread 또는 run_to_line으로 정지점을 만들 것.';
    }
    return textResult(result);
  });

tool('show_threads',
  '전체 스레드 목록(Show Thread -web)을 구조화해 반환.',
  {},
  async () => {
    const raw = await consoleClient.send('Show Thread -web');
    const status = parseStatus(raw);
    const { threads, rawLines } = parseThreadList(raw);
    return textResult({ ok: isSuccess(status), status, threads, rawLines });
  });

tool('show_thread',
  '특정 스레드 상세(Show Thread <thread>) — 현재 위치/상태.',
  { thread: z.string() },
  async ({ thread }) => textResult(await runCommand(`Show Thread ${thread}`)));

tool('show_stack',
  '스레드의 호출 스택(Show Stack <thread>).',
  { thread: z.string() },
  async ({ thread }) => textResult(await runCommand(`Show Stack ${thread}`)));

tool('eval_expression',
  '정지된 스레드의 특정 프레임에서 변수를 평가한다(Show Variable -eval <thread> <frame> <expr>). ' +
  '평가 가능(GPL 4.2K5 실측): 그 프레임의 로컬/파라미터, 모듈 전역, 모듈전역.public필드(theMotionLoger.lastStage 형태), 배열 인덱스 arr(i), 객체명(필드 덤프 반환). ' +
  '평가 불가: 프로퍼티/메서드 호출(-780, 인자 유무 무관), 객체 멤버 점 표기(-729), 다른 프레임의 로컬(-729). 실패하면 같은 부류로 재시도하지 말고 응답 hint를 따를 것. ' +
  '여러 값은 debug_snapshot/step_thread/run_to_line의 evals로 배치하면 왕복을 아낀다.',
  {
    thread: z.string(),
    frame: z.number().int().min(0).describe('스택 프레임 인덱스(0=최상단). 로컬이 -729면 show_stack으로 프레임 확인'),
    expression: z.string().describe('로컬/필드/배열요소(프로퍼티·메서드 호출 불가)'),
  },
  async ({ thread, frame, expression }) => {
    const r = await runCommand(`Show Variable -eval ${thread} ${frame} ${expression}`);
    if (!r.hint && EVAL_LIMIT_RE.test(String(r.data))) r.hint = statusHint(-780);
    return textResult(r);
  });

tool('set_variable',
  '변수/식에 값을 대입한다(Execute <expression>, <project>). 예: expression="myVar = 1". [시뮬레이션 모드 권장]',
  { expression: z.string().describe('예: someVar = 123'), project: z.string().optional() },
  async ({ expression, project }) => textResult(await runCommand(`Execute ${expression}, ${proj(project)}`)));

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[gpl-controller-mcp] ready — target ${HOST}:${PORT}, default project "${DEFAULT_PROJECT}"`);
  if (LOG_FILE) {
    console.error(`[gpl-controller-mcp] session log: ${LOG_FILE}`);
    console.error(`[gpl-controller-mcp] 실시간 관찰: Get-Content "${LOG_FILE}" -Wait`);
  }
  logLine(`session start — target ${HOST}:${PORT}, project "${DEFAULT_PROJECT}", idleClose ${IDLE_CLOSE}ms`);
}

main().catch((err) => {
  console.error('[gpl-controller-mcp] fatal:', err);
  process.exit(1);
});
