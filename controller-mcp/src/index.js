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
//   GPL_BRIDGE     확장 브리지 사용     (auto 기본 | only | off) — auto: VS Code GPL 확장이 살아 있으면 1402 명령을
//                  확장 세션으로 보내고(세션 경쟁 없음·확장의 명령 정책 적용), 없으면 직접 접속. only: 브리지 필수.
//                  off: 항상 직접 접속(종전 동작). (src/extensionBridge.js)
//   GPL_VSCODE_CLI 확장을 깨울 때 쓸 VS Code CLI (기본 code)
//
// 주의: stdout은 MCP 전송 채널이다. 로그는 반드시 stderr(console.error)로만.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
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
  compactThread,
  summarizeThreads,
  parseShowVariable,
  parseBreakList,
  hasBreakpointAt,
  parseDataIdResponse,
  parseResourceProbes,
  acceptedRate,
  PAUSED_STATES,
  statusHint,
  isSuccess,
} from './parse.js';
import { readDeployLock, waitForDeployLockRelease, describeDeployLock, DEPLOY_GUARDED_COMMAND_RE } from './deployLock.js';
import {
  resolveBridge,
  readExtensionPresence,
  callExtensionCommand,
  bridgeUnavailableHint,
  isRetrySafeCommand,
  BRIDGE_COMMAND_ID_PATTERN,
} from './extensionBridge.js';
import { runBatch, normalizeCommandInput, BATCH_MAX } from './batch.js';
import { SERVER_INSTRUCTIONS, DOC_COMMENT_GUIDE } from './guidelines.js';
import {
  SEND_OUTCOME_NOT_SENT,
  SEND_OUTCOME_UNKNOWN,
  taggedError,
  sendOutcomeOf,
  commandFailureResult,
  classifyReachability,
  UnknownCommandMemory,
  unknownCommandResult,
  UNKNOWN_COMMAND_STATUS,
} from './outcome.js';

const HOST = process.env.GPL_HOST || '192.168.0.1';
const PORT = parseInt(process.env.GPL_PORT || '1402', 10);
const DEFAULT_PROJECT = process.env.GPL_PROJECT || 'MergeCode';
const TIMEOUT = parseInt(process.env.GPL_TIMEOUT_MS || '15000', 10);
const IDLE_CLOSE = parseInt(process.env.GPL_IDLE_CLOSE_MS || '30000', 10);
const LOCK_WAIT_MS = parseInt(process.env.GPL_LOCK_WAIT_MS || '20000', 10);

// ── 빌드 스탬프 ───────────────────────────────────────────────────────────
// scripts/bundle-mcp.js가 esbuild define으로 JSON 문자열을 주입한다(확장 버전·빌드 시각·git sha). 소스를 직접 실행하면
// 식별자가 없으므로 'dev'. 목적(GitHub #23): globalStorage 사본이 구버전으로 남아도 "지금 어느 번들이 돌고 있나"를
// stderr ready 줄·get_session_log·controller_status.server로 즉시 알 수 있게 한다(McpServer version 문자열도 이 값).
const BUILD = (() => {
  try {
    // eslint-disable-next-line no-undef
    if (typeof __GPL_MCP_BUILD_JSON__ === 'string') return JSON.parse(__GPL_MCP_BUILD_JSON__);
  } catch { /* noop */ }
  return { version: 'dev', builtAt: null, gitSha: null, bundled: false };
})();
const BUILD_LABEL = `v${BUILD.version}${BUILD.gitSha ? ` ${BUILD.gitSha}` : ''}${BUILD.builtAt ? ` (${BUILD.builtAt})` : ' (unbundled source)'}`;

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

// instructions는 initialize 응답으로 나가 도구 호출 **전에** 읽힌다 — 제어기 안전 규칙과
// GPL 문서화 주석 규약(코드를 쓰거나 고칠 때)을 여기서 알린다. 본문은 src/guidelines.js.
const server = new McpServer(
  { name: 'gpl-controller-mcp', version: String(BUILD.version) },
  { instructions: SERVER_INSTRUCTIONS },
);

function textResult(payload) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  return { content: [{ type: 'text', text }] };
}

// instructions를 쓰지 않는 클라이언트에서도 규약을 가져갈 수 있게 리소스로도 노출한다.
// (도구 목록은 매 요청에 실리므로 참고 문서는 도구가 아니라 리소스로 둔다.)
server.resource(
  'gpl-doc-comment-guide',
  'gpl://guidelines/doc-comment',
  {
    title: 'GPL 문서화 주석 규약',
    description: 'GPL 소스를 쓰거나 고칠 때 선언 위에 남기는 문서화 주석 형식(설명 · # Parameters · # Returns · # Examples)과 골격 생성 방법.',
    mimeType: 'text/markdown',
  },
  async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: DOC_COMMENT_GUIDE }] }),
);

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
  throw taggedError(
    `배포 잠금 보유 중 — ${describeDeployLock(wait.holder)}. VS Code 확장의 업로드/배포가 끝나기 전에는 ` +
    'Compile/Start/Load/Unload를 보내지 않는다(업로드 도중 겹치면 제어기 이상 유발). 우회하지 말고 잠시 후 ' +
    `재시도하거나 사용자에게 알린다. 잠금 파일: ${wait.file}`,
    SEND_OUTCOME_NOT_SENT,
  );
}

// ── Agent Bridge 라우팅 (2026-08-28) ──────────────────────────────────────
// VS Code 확장이 살아 있으면 1402 명령을 **확장 세션으로** 보낸다(extensionBridge.js). 확장이 keep-alive 세션을 쥔 채
// MCP가 따로 접속하면 두 세션이 경쟁해 "제어기는 정상인데 1402를 VS Code가 점유 중"이라는 막다른 결론이 나왔다.
// 확장 경로로 보내면 같은 직렬 큐·keep-alive 세션·명령 정책(Step 연타/정지 정착/Compile→Start 완충)을 그대로 쓴다.
// GPL_BRIDGE: auto(기본, 없으면 직접 접속) | only(브리지 필수 — 세션 단일화 보장) | off(항상 직접 접속).
const BRIDGE_MODE = (process.env.GPL_BRIDGE || 'auto').trim().toLowerCase();
const BRIDGE_RECHECK_MS = 3000;
let bridgeState = { available: false, reason: 'unchecked', presence: null, checkedAt: 0 };

async function currentBridge({ force = false, wake = false } = {}) {
  const now = Date.now();
  if (!force && now - bridgeState.checkedAt < BRIDGE_RECHECK_MS) return bridgeState;
  const r = await resolveBridge(HOST, { mode: BRIDGE_MODE, wake });
  bridgeState = { ...r, checkedAt: now };
  return bridgeState;
}

/** 확장 명령 1건 호출(브리지). 결과는 확장 명령의 반환값 그대로. */
async function callExtension(command, args, { timeoutMs } = {}) {
  const b = await currentBridge();
  if (!b.available) {
    const err = new Error(
      `확장 브리지를 쓸 수 없다 (${b.reason}). ${bridgeUnavailableHint(b.reason)}`,
    );
    err.bridgeReason = b.reason;
    err.sendOutcome = SEND_OUTCOME_NOT_SENT;
    throw err;
  }
  return callExtensionCommand(HOST, command, args, { timeoutMs: timeoutMs ?? 30_000 });
}

/**
 * 잠금 가드를 거친 전송. 확장 브리지가 있으면 그쪽으로, 없으면 직접 접속.
 * 폴백 규칙: 브리지가 **명령을 실행하지 않았음이 확실한** 실패(요청 거부·확장 미존재)면 직접 전송으로 넘어가고,
 * 모호한 실패(타임아웃·확장 내부 오류)는 조회 명령만 재전송한다 — 상태 변경 명령 중복 전송 금지.
 */
async function sendGuarded(command, opts) {
  await guardDeployLock(command);
  const b = await currentBridge();
  if (b.available) {
    const cmdTimeout = opts?.timeoutMs ?? TIMEOUT;
    const res = await callExtensionCommand(HOST, 'gpl.controller.sendCommand', {
      command,
      timeoutMs: cmdTimeout,
      waitForStatusClose: opts?.waitForStatusClose === true,
      // 확장은 `Set Break`/`Nobreak`를 에디터 중단점에도 반영한다(빨간 점). 스스로 정리하는
      // 임시 BP만 여기서 제외한다 — 안 그러면 빨간 점이 깜빡인다.
      ...(opts?.mirrorBreakpoints === false ? { mirrorBreakpoints: false } : {}),
    }, { timeoutMs: cmdTimeout + 20_000 });

    if (res.ok && res.result && typeof res.result.raw === 'string') {
      cmdSeq++;
      logLine(`  1402> ${command} | ${res.ms}ms | via extension | STATUS ${parseStatus(res.result.raw).code}`);
      return res.result.raw;
    }
    // 확장의 명령 정책이 안전 조건을 채우지 못해 **보내지 않은** 경우 — 직접 접속으로 우회하지 않는다(정책 무력화 방지).
    if (res.ok && res.result?.error === 'policy-hold') {
      logLine(`  1402> ${command} | via extension | policy-hold ${res.result.code}`);
      throw taggedError(
        `확장 명령 정책이 보류했다(${res.result.code}): ${res.result.detail} ` +
        '제어기에는 보내지 않았다. 조건이 풀린 뒤(스레드 정지/정착) 다시 시도할 것 — 직접 접속으로 우회하지 말 것.',
        SEND_OUTCOME_NOT_SENT,
        { policyCode: res.result.code },
      );
    }
    const ambiguous = res.error === 'bridge-timeout' || res.error === 'command-failed' || res.error === 'response-parse-failed';
    if (ambiguous && !isRetrySafeCommand(command)) {
      throw taggedError(
        `확장 브리지 전송 결과를 확인하지 못했다(${res.error}: ${res.detail}). '${command}'는 상태 변경 명령이라 ` +
        '중복 전송 위험이 있어 직접 재전송하지 않는다. show_threads 등으로 현재 상태를 확인한 뒤 판단할 것.',
        SEND_OUTCOME_UNKNOWN,
        { bridgeError: res.error },
      );
    }
    if (BRIDGE_MODE === 'only') {
      // 브리지가 명령을 보냈는지는 res.error 에 달렸다 — 모호한 실패면 결과 미확정.
      throw taggedError(
        `GPL_BRIDGE=only — 확장 브리지 실패(${res.error}: ${res.detail}). 직접 접속으로 폴백하지 않는다.`,
        ambiguous ? SEND_OUTCOME_UNKNOWN : SEND_OUTCOME_NOT_SENT,
        { bridgeError: res.error },
      );
    }
    logLine(`  bridge 실패(${res.error}: ${res.detail}) → 직접 접속으로 폴백: ${command}`);
    bridgeState.checkedAt = 0;   // 다음 호출에서 presence 재확인
  } else if (BRIDGE_MODE === 'only') {
    throw taggedError(
      `GPL_BRIDGE=only — 확장 브리지를 쓸 수 없다(${b.reason}). ${bridgeUnavailableHint(b.reason)}`,
      SEND_OUTCOME_NOT_SENT,
      { bridgeReason: b.reason },
    );
  }
  return consoleClient.send(command, opts);
}

/** 현재 전송 경로 요약 — 응답에 실어 AI가 "누가 1402를 쓰는지" 추측하지 않게 한다. */
function transportInfo() {
  const p = bridgeState.presence;
  return {
    mode: BRIDGE_MODE,
    using: bridgeState.available ? 'extension-bridge' : 'direct-tcp',
    reason: bridgeState.available ? null : bridgeState.reason,
    extension: p ? { version: p.extensionVersion, pid: p.pid, connected: p.connected, debugSessionActive: p.debugSessionActive, workspace: p.workspace ?? null } : null,
    hint: bridgeState.available
      ? '1402 명령이 확장 세션(직렬 큐·keep-alive·명령 정책)을 통해 나간다 — 세션 경쟁 없음.'
      : bridgeUnavailableHint(bridgeState.reason),
  };
}

// 이 세션에서 STATUS -714(존재하지 않는 명령)를 받은 명령 기억 — 같은 명령의 재전송을 캐시로 끊고,
// 같은 계열의 다른 표기에는 "이미 없다고 확인된 형제 명령" 목록을 실어 추측 재시도를 줄인다(개선안 §4·§5).
const unknownCommands = new UnknownCommandMemory();

async function runCommand(command, opts) {
  const known = unknownCommands.check(command);
  if (known.blocked) {
    logLine(`  1402> ${command} | 전송 생략 | 이미 STATUS ${UNKNOWN_COMMAND_STATUS} (${known.previous.count}회)`);
    return unknownCommandResult(command, known);
  }
  let raw;
  try {
    raw = await sendGuarded(command, opts);
  } catch (err) {
    return commandFailureResult(command, err);
  }
  const status = parseStatus(raw);
  const ok = isSuccess(status);
  const result = { command, status, ok, data: extractData(raw) };
  if (!ok) {
    // 실패 시 "무엇을 바꿔 재시도할지"를 응답에 함께 실어, 같은 부류의
    // 재시도 낭비(-780 eval 반복, -714 없는 명령 추측 등)를 그 자리에서 끊는다.
    // 여기는 제어기가 STATUS 로 거부한 **확정된 실패**다(outcome='completed').
    result.outcome = 'completed';
    if (status.code === UNKNOWN_COMMAND_STATUS) { unknownCommands.note(command); }
    const hint = statusHint(status.code);
    if (hint) result.hint = hint;
    if (known.relatedUnknown && known.relatedUnknown.length > 0) {
      result.relatedUnknownCommands = known.relatedUnknown;
      result.relatedUnknownNote = '같은 계열에서 이미 존재하지 않는 것으로 확인된 표기들이다 — 표기를 바꿔 계속 추측하지 말고 레퍼런스를 확인할 것.';
    }
  }
  return result;
}

/**
 * 현재 제어기 중단점 목록.
 *
 * `Show Break`는 `<STATUS>`가 목록 **앞**에 오는 응답이라 `runCommand`의 `data`
 * (= STATUS 이후를 잘라 내는 `extractData`)에는 아무것도 남지 않는다 — 그래서 원시 응답을
 * 직접 파싱한다. 조회에 실패하면 `list: null`(모른다)이며, "중단점이 없다"로 바꿔 말하지 않는다.
 */
async function showBreakpoints() {
  try {
    const raw = await sendGuarded('Show Break');
    const status = parseStatus(raw);
    const ok = isSuccess(status);
    return { ok, status, list: ok ? parseBreakList(raw) : null };
  } catch (err) {
    return { ok: false, status: null, list: null, error: err?.message ?? String(err) };
  }
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

/**
 * 프로젝트명 인자. 제어기 콘솔 명령(Compile/Load/Start/Unload)은 인자를 공백으로 구분하고 인용 문법이
 * 없으므로(Brooks 문서) 공백·제어 문자가 든 이름은 명령이 끊긴다 — 보내기 전에 오류로 돌려준다
 * (확장의 controller/projectNameGuard.ts와 같은 규칙).
 */
// ── 세션 대상 프로젝트 (2026-08-31 개선안 §18·§19) ─────────────────────────
// 종전에는 프로젝트명 인자를 생략하면 곧바로 환경변수 기본값(GPL_PROJECT)으로 떨어졌고, 확장 명령(gpl.deploy 등)은
// 아예 대상 인자를 받지 못해 QuickPick 이 열렸다. 한 작업 세션의 대상은 하나로 고정되는 것이 정상이므로
// `project_target` 로 한 번 정하면 이후 모든 도구가 같은 대상을 쓴다. 우선순위: 인자 > 세션 대상 > GPL_PROJECT.
let sessionProject = null;

/** 이 세션의 대상 프로젝트가 어디서 왔는지 — 응답에 실어 "왜 이 프로젝트가 쓰였지"를 추론하지 않게 한다(§27). */
function targetProjectInfo(explicit) {
  const name = (explicit && explicit.trim()) || sessionProject || DEFAULT_PROJECT;
  const source = (explicit && explicit.trim()) ? 'argument' : sessionProject ? 'session-target' : 'env-default';
  return { project: name, source };
}

const proj = (p) => {
  const name = targetProjectInfo(p).project;
  if (/[\s\u0000-\u001F\u007F]/u.test(name)) {
    throw taggedError(
      `프로젝트명 '${name}'에 공백/제어 문자가 있어 제어기 명령을 보내지 않았습니다 — ` +
      '제어기 콘솔 명령은 인자를 공백으로 구분하므로 이름이 끊깁니다. Project.gpr의 ProjectName을 공백 없는 이름으로 바꾸세요.',
      SEND_OUTCOME_NOT_SENT,
    );
  }
  return name;
};

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
    const raw = await sendGuarded(`Show Thread ${thread}`);
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
    return parseThreadDetail(await sendGuarded(`Show Thread ${thread}`));
  } catch {
    return null;
  }
}

const EVAL_LIMIT_RE = /\(-7(?:29|80)\)/;

/**
 * 변수 1회 평가 → 구조화 결과 `{ expression, ok, name, type, value, kind, members?, status, resolvedAs?, hint? }`.
 *  - 원문 재파싱을 없앤다(GitHub #24 ③). 파싱 실패 시에만 `data` 원문.
 *  - `Me.` 접두는 -712라 미리 벗긴다.
 *  - 프로퍼티 -780 자동 우회(GitHub #24 ④/#26): 마지막 요소가 식별자면 관례 백킹 필드 `m_<이름>`으로 재시도하고, 그것이
 *    -729(다른 클래스 프레임의 Private 점 표기)이며 부모 식이 있으면 부모 객체 덤프(프레임 무관, Private 포함)에서
 *    `.m_<이름>` 멤버 줄을 추출한다. 우회로 얻은 값은 `resolvedAs`에 출처를 표시한다.
 */
async function evalOne(thread, frame, expression) {
  const expr = String(expression).replace(/^Me\.(?=[A-Za-z_])/i, '');
  const cmd = (e) => `Show Variable -eval ${thread} ${frame} ${e}`;
  const r = await runCommand(cmd(expr));
  const out = { expression, ok: r.ok, status: r.status };
  const attach = (res, resolvedAs) => {
    const parsed = parseShowVariable(res.data);
    if (parsed) {
      out.name = parsed.name; out.type = parsed.type; out.value = parsed.value; out.kind = parsed.kind;
      if (parsed.members.length) out.members = parsed.members;
    } else {
      out.data = res.data;
    }
    if (resolvedAs) out.resolvedAs = resolvedAs;
  };
  if (r.ok) { attach(r); return out; }

  if (r.status.code === -780) {
    const lastDot = expr.lastIndexOf('.');
    const leaf = lastDot >= 0 ? expr.slice(lastDot + 1) : expr;
    const parent = lastDot > 0 ? expr.slice(0, lastDot) : null;
    if (/^[A-Za-z_]\w*$/.test(leaf)) {
      const backing = `m_${leaf}`;
      const backingExpr = parent ? `${parent}.${backing}` : backing;
      const r2 = await runCommand(cmd(backingExpr));
      if (r2.ok) { out.ok = true; out.status = r2.status; attach(r2, backingExpr); return out; }
      if (parent && r2.status.code === -729) {
        const dump = await runCommand(cmd(parent));
        const parsed = dump.ok ? parseShowVariable(dump.data) : null;
        const want = `.${backing.toLowerCase()}`;
        const m = parsed?.members.find((e) => e.name.toLowerCase().endsWith(want));
        if (m) {
          Object.assign(out, { ok: true, status: dump.status, name: m.name, type: m.type, value: m.value, kind: 'simple',
            resolvedAs: `${parent} 덤프의 ${m.name}` });
          return out;
        }
      }
    }
  }
  const hint = r.hint ?? (EVAL_LIMIT_RE.test(String(r.data)) ? statusHint(-780) : undefined);
  if (hint) out.hint = hint;
  if (r.data) out.data = r.data;
  return out;
}

/** 정지 직후 여러 변수를 한 번에 평가(관측 배치). 각 결과는 evalOne과 같은 구조. */
async function evalMany(thread, frame, expressions) {
  const out = [];
  for (const expression of expressions) out.push(await evalOne(thread, frame, expression));
  return out;
}

/** 고전원 상태(Execute Controller.PowerEnabled — 확장 controllerStatus.ts와 같은 프로브). 실패/해석 불가면 null. */
async function probePowerEnabled() {
  try {
    const raw = await sendGuarded('Execute Controller.PowerEnabled', { timeoutMs: 4000 });
    if (!isSuccess(parseStatus(raw))) return null;
    const payload = extractData(raw);
    if (/\b(true|on|enabled)\b/i.test(payload)) return true;
    if (/\b(false|off|disabled)\b/i.test(payload)) return false;
    const m = payload.match(/-?\d+/);
    return m ? parseInt(m[0], 10) !== 0 : null;
  } catch {
    return null;
  }
}

/** ICMP 1회(best-effort). ping 미지원/실패면 alive:null. Windows ping은 "Destination host unreachable"에도 종료코드 0이라 TTL= 응답으로 판정. */
function pingOnce(host, timeoutMs = 2500) {
  const isWin = process.platform === 'win32';
  const args = isWin ? ['-n', '1', '-w', '1000', host] : ['-c', '1', '-W', '1', host];
  const t0 = Date.now();
  return new Promise((resolve) => {
    try {
      execFile('ping', args, { timeout: timeoutMs, windowsHide: true }, (err, stdout) => {
        const alive = isWin ? /TTL=/i.test(String(stdout || '')) : !err;
        resolve({ alive, ms: Date.now() - t0 });
      });
    } catch {
      resolve({ alive: null, ms: Date.now() - t0 });
    }
  });
}

/**
 * 1402 접속 실패를 **관측 / 추론 / 확신도**로 갈라 돌려준다(GitHub #24 ②, #22 사고 교훈, 2026-08-31 개정).
 *
 * 종전 판정 문장은 `ECONNREFUSED` 하나로 '제어기 소프트웨어 다운/재시작 중'을 단정했다. 실측 2026-08-31:
 * Unload 타임아웃 뒤 약 2.5분간 refused 였다가 재부팅 없이 복귀했다(복귀 직후 ErrorLog/Show Thread/Show Memory
 * 모두 STATUS 0). 즉 refused 는 "지금 새 연결을 만들 수 없다"는 관측일 뿐이고, 제어기 런타임 상태는 이것만으로
 * 확정할 수 없다. `controllerHealth` 는 이 프로브만으로는 절대 'healthy' 가 되지 않는다 — 살아 있음의 증거는
 * 명령의 `<STATUS>` 응답이다(확장 controller/reachability.ts assessReachability 와 같은 규칙).
 *
 * 전원 재투입·재부팅 같은 강한 권고는 만들지 않는다 — 여러 독립 증거를 종합해야 하는 판단이다.
 */
async function probeReachability(err) {
  const code = err?.code ?? (/timed out/i.test(err?.message ?? '') ? 'ETIMEDOUT' : undefined);
  const icmp = await pingOnce(HOST);
  return {
    tcp1402: false,
    error: code ?? String(err?.message ?? err),
    icmp,
    ...classifyReachability({ host: HOST, code, icmpAlive: icmp.alive }),
  };
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
// 배치(GitHub #16): commands 배열을 받아 서버 직렬 큐에서 **순차** 실행하고 결과 배열을 한 번에 돌려준다(MCP 왕복 N→1 —
// 호출당 고정 오버헤드 ≈1.5 s가 제어기 왕복 13~85 ms의 100배라 병목은 호출 횟수였다). 각 항목은 runCommand → sendGuarded를
// 그대로 거치므로 배포 잠금 가드(Compile/Start/Load/Unload 대기·거부)가 항목별로 적용된다. 단건(command)은 종전 응답과 동일.
tool('controller_command',
  '임의의 1402 콘솔 명령을 그대로 전송한다(에스케이프 해치). 구조화 도구로 안 되는 명령에만 사용. ' +
  `단건은 command, 여러 명령은 commands(1~${BATCH_MAX}개) — 둘 중 정확히 하나만 지정. 배치는 서버가 순서대로 순차 실행해(1402 단일 채널, 병렬 없음) ` +
  '결과 배열 {count, okCount, failCount, stoppedAt?, results:[{index, command, status, ok, data, hint?, error?}]}를 한 번에 돌려준다 — ' +
  'DataID/상태 항목 여러 개 조회는 호출 1회로 끝낼 것(호출당 고정 오버헤드 ≈1.5 s). 항목별로 기존 안전 규칙(배포 잠금 가드: Compile/Start/Load/Unload 대기·거부)이 ' +
  '그대로 적용되고, 타임아웃/연결 오류 항목은 {ok:false, error}로 기록된다. stopOnError=true면 첫 실패(ok=false 또는 오류)에서 멈추고 stoppedAt(인덱스)을 준다(기본: 계속). ' +
  'DataID 조회는 read_dataids가 값을 구조화해 주므로 그쪽을 우선할 것.',
  {
    command: z.string().optional().describe('보낼 콘솔 명령 한 줄(단건). commands와 동시 지정 불가'),
    commands: z.array(z.string()).min(1).max(BATCH_MAX).optional()
      .describe(`순차 실행할 명령 목록(1~${BATCH_MAX}개, 빈 항목 불가). command와 동시 지정 불가`),
    stopOnError: z.boolean().optional().describe('배치 전용: true면 첫 실패 항목에서 중단(기본 false=끝까지 계속)'),
  },
  async ({ command, commands, stopOnError }) => {
    const input = normalizeCommandInput({ command, commands });
    if (input.mode === 'single') return textResult(await runCommand(input.command)); // 종전과 동일한 응답(하위 호환)
    return textResult(await runBatch(input.commands, (c) => runCommand(c), { stopOnError: !!stopOnError }));
  });

tool('read_dataids',
  '파라미터 DB(DataID) 여러 개를 한 번에 읽는다 — `pd <id>`는 파라미터 DB 읽기(읽기 전용, 값 변경 없음; 쓰기 `pc`는 제공하지 않음). ' +
  '각 id를 서버 직렬 큐에서 순차 조회해 {id, ok, status, description, meta, values, raw}로 구조화한다(실측 형식 ' +
  '`2703, 1, 1, 0, "100% Cartesian accels in (mm or deg)/sec^2" = 1200, 400, 0` → meta [1,1,0], values ["1200","400","0"]; values는 원문 토큰이라 문자열 값은 따옴표 유지). ' +
  'DataID를 하나씩 controller_command로 읽지 말고 이 도구 1회로 끝낼 것(호출당 고정 오버헤드 ≈1.5 s, GitHub #16). 파싱 실패 시에도 raw는 채워지고 ok는 STATUS 기준.',
  {
    ids: z.array(z.number().int().min(0)).min(1).max(100).describe('DataID 목록(1~100개), 예: [2703, 2704, 2705]'),
    hex: z.boolean().optional()
      .describe('true면 `pdx`로 읽어 정수를 16진수로 표시한다(공식 문서: Pdx = hexadecimal). 비트마스크 DataID(예: 2003 Axis mask)에 유용'),
    unit: z.number().int().optional().describe('unit 번호(문서상 생략 시 1). 지정하면 `pd <id>, <unit>` 형태로 보낸다'),
    unit2: z.number().int().optional().describe('sub unit 번호(문서상 생략 시 1, 거의 쓰이지 않음). unit과 함께 지정할 것'),
    arrayIndex: z.number().int().optional().describe('배열 인덱스(문서상 생략/0 = 전체 값 표시)'),
    node: z.number().int().optional()
      .describe('서보 네트워크 노드 번호 — 문서가 테스트/디버깅 용도로 명시. 지정하면 그 노드에서 명령을 수행한다'),
  },
  async ({ ids, hex, unit, unit2, arrayIndex, node }) => {
    // 공식 문서 구문: `Pd dataid, unit, unit2, array_index, node` (Pdx는 정수를 16진수로 표시).
    // 뒤쪽 인자를 쓰려면 앞 인자가 필요하므로 지정된 가장 뒤 인자까지 기본값(unit 1 / unit2 1 / index 0)으로 채운다.
    const verb = hex ? 'pdx' : 'pd';
    const tail = [];
    if (node !== undefined) {
      tail.push(unit ?? 1, unit2 ?? 1, arrayIndex ?? 0, node);
    } else if (arrayIndex !== undefined) {
      tail.push(unit ?? 1, unit2 ?? 1, arrayIndex);
    } else if (unit2 !== undefined) {
      tail.push(unit ?? 1, unit2);
    } else if (unit !== undefined) {
      tail.push(unit);
    }
    const suffix = tail.length ? `, ${tail.join(', ')}` : '';
    const batch = await runBatch(ids.map((id) => `${verb} ${id}${suffix}`), (c) => runCommand(c));
    const results = batch.results.map((r, i) => {
      const id = ids[i];
      const item = { id, ok: r.ok };
      if (r.status) item.status = r.status;
      if (r.error) item.error = r.error;
      const parsed = r.ok && r.data ? parseDataIdResponse(r.data) : null;
      if (parsed) {
        item.description = parsed.description;
        item.meta = parsed.meta;
        item.values = parsed.values;
        if (parsed.id !== id) item.note = `응답의 id(${parsed.id})가 요청(${id})과 다르다 — raw 확인`;
      }
      item.raw = r.data ?? null;
      if (r.hint) item.hint = r.hint;
      return item;
    });
    return textResult({ count: batch.count, okCount: batch.okCount, failCount: batch.failCount, results });
  });

tool('get_session_log',
  '이 MCP 세션의 도구 호출/1402 명령 로그(타임스탬프·소요시간·STATUS·도구별 왕복 수)를 반환한다. ' +
  '왕복 낭비 자가 점검과 사용자 공유용. 같은 내용이 로그 파일에도 기록된다.',
  { tail: z.number().int().min(1).max(2000).optional().describe('마지막 N줄(기본 200)') },
  async ({ tail }) => textResult({
    server: BUILD,
    logFile: LOG_FILE,
    hint: LOG_FILE ? `사용자는 PowerShell에서 'Get-Content "${LOG_FILE}" -Wait'로 실시간 관찰 가능` : '파일 로그 비활성(링버퍼만)',
    entries: logRing.slice(-(tail ?? 200)),
  }));

// ── 자원 프로브(GitHub #22 가설 1: TCP 접속 churn → 스택 자원 고갈 관찰) ─────────────────────────
// 읽기 전용 3명령(Show Memory / Show Network -tcp / -mbuf)을 배치로 보내 parseResourceProbes로 구조화한다(원문 형식은 parse.js 주석 참조 —
// 2026-08-25 실측 1회분 기준, 다른 펌웨어는 미확정이라 매칭 실패 필드는 null·raw 동봉). 직전 tcp 샘플(accepted, 시각)을 서버 메모리에
// 보관해 acceptedPerSec(접속 churn 증가율)를 계산한다 — 첫 호출·재부팅(카운터 감소)·서버 재시작 직후는 null.
const RESOURCE_PROBE_COMMANDS = { memory: 'Show Memory', tcp: 'Show Network -tcp', mbuf: 'Show Network -mbuf' };
let lastTcpSample = null;
async function probeResources() {
  const keys = Object.keys(RESOURCE_PROBE_COMMANDS);
  const batch = await runBatch(
    keys.map((k) => RESOURCE_PROBE_COMMANDS[k]),
    (c) => runCommand(c, { timeoutMs: Math.min(TIMEOUT, 5000) }), // 실측 5~60 ms — 상태 요약이 프로브 때문에 오래 매달리지 않게
  );
  const texts = {};
  const errors = {};
  batch.results.forEach((r, i) => {
    texts[keys[i]] = r.ok ? r.data : null;
    if (!r.ok) errors[keys[i]] = r.error ?? r.status;
  });
  const parsed = parseResourceProbes(texts);
  const now = Date.now();
  if (parsed.tcp) {
    const sample = { accepted: parsed.tcp.accepted, at: now };
    parsed.tcp.acceptedPerSec = acceptedRate(lastTcpSample, sample);
    parsed.tcp.sampleIntervalSec = lastTcpSample ? Math.round((now - lastTcpSample.at) / 100) / 10 : null;
    if (sample.accepted != null) lastTcpSample = sample;
  }
  parsed.sampledAt = new Date(now).toISOString();
  if (Object.keys(errors).length) parsed.errors = errors;
  parsed.note = '형식은 GPL 4.2K5 실측(2026-08-25) 1회분 기준(다른 펌웨어 미확정) — 필드가 null이면 raw를 참고해 사용자에게 보고. ' +
    'tcp.acceptedPerSec는 이 서버의 직전 detail 호출 대비 accept 카운터 증가율(첫 호출 null) — 접속 churn 관찰용(GitHub #22 가설 1).';
  return parsed;
}

/** 배포 잠금(VS Code 확장이 업로드/배포 중이면 존재) — 있으면 Compile/Start는 대기·거부된다. */
function deployLockInfo() {
  const lock = readDeployLock(HOST);
  return lock
    ? { holder: lock.owner, stage: lock.stage, since: new Date(lock.since).toISOString(), describe: describeDeployLock(lock) }
    : null;
}

tool('controller_status',
  '제어기 상태 요약 1회: 연결(1402 도달성)·스레드 상태별 개수와 정지 스레드 위치·고전원(Controller.PowerEnabled)·배포 잠금·서버 빌드. ' +
  '연결 실패 시 응답은 **관측(observations)과 추론(assessment)을 분리**해 돌려준다 — observations는 icmp/tcp1402/route(측정값), ' +
  'assessment는 {state, confidence, alternativeExplanations, controllerCrashConfirmed}, controllerHealth는 런타임 상태다. ' +
  '**1402 실패만으로 제어기 다운·전원 재투입을 결론내지 말 것** — controllerHealth.state="unconfirmed"는 "모른다"는 뜻이고, ' +
  'ECONNREFUSED는 채널 교란 명령(Unload/Load/Compile/Start) 뒤의 일시적 사용 불가일 수 있다(실측 2026-08-31: 약 2.5분 뒤 재부팅 없이 복귀). ' +
  'recommendedAction을 그대로 따를 것(단명 연결 반복 금지). ' +
  'detail=true면 스레드 전체 목록(compact)·최근 ErrorLog 10줄·resources(읽기 전용 Show Memory / Show Network -tcp / -mbuf를 구조화: ' +
  'memory.freeMb/usedMb/segments, tcp.accepted/established/closed + acceptedPerSec, mbuf.total/free/clusters/clustersFree/drops/waits/drains)를 덧붙인다. ' +
  'acceptedPerSec는 제어기 TCP accept 카운터의 직전 호출 대비 증가율로 접속 churn을 관찰하는 값(GitHub #22 가설 1 검증용) — 첫 호출은 null, ' +
  '원문 형식은 실측 1회분 기준이라 파싱 실패 필드는 null이며 raw를 참고. 시뮬레이션/실기 판별 명령은 실측 확인 전이라 simulation은 항상 null — 사용자에게 확인할 것.',
  { detail: z.boolean().optional().describe('true면 스레드 전체 목록(compact)·최근 ErrorLog 10줄·resources(메모리/TCP/mbuf 자원 프로브) 포함') },
  async ({ detail }) => {
    await currentBridge({ force: true });
    const base = { host: HOST, port: PORT, server: BUILD, deployLock: deployLockInfo(), transport: transportInfo() };
    let raw;
    try {
      raw = await sendGuarded('Show Thread -web');
    } catch (err) {
      const reachable = await probeReachability(err);
      const sendOutcome = sendOutcomeOf(err);
      return textResult({
        ...base,
        ok: false,
        // connected=false 는 "이 조회가 1402 채널을 쓸 수 없었다"는 뜻이다. 제어기 상태는 controllerHealth 를 볼 것.
        connected: false,
        channel: { port: PORT, state: reachable.assessment.state, lastError: { kind: reachable.error, message: String(err?.message ?? err) } },
        observations: reachable.observations,
        assessment: reachable.assessment,
        controllerHealth: reachable.controllerHealth,
        recommendedAction: reachable.recommendedAction,
        reachable,
        hint: `${reachable.verdict} ${base.transport.using === 'extension-bridge'
          ? '이 조회는 확장 세션을 통해 나갔으므로 "VS Code가 1402를 점유해서 실패"가 아니다.'
          : `현재 직접 접속 경로다(${base.transport.reason}). VS Code에서 확장이 실행 중이면 extension_status로 브리지를 켜 같은 세션을 쓸 수 있다.`} `
          + `이 조회의 전송 결과: ${sendOutcome}. 제어기 다운/전원 재투입을 결론내지 말고 recommendedAction 을 따를 것.`,
      });
    }
    const status = parseStatus(raw);
    const { threads } = parseThreadList(raw);
    const powerEnabled = await probePowerEnabled();
    const result = {
      ...base, ok: isSuccess(status), connected: true, status, powerEnabled, simulation: null,
      threads: summarizeThreads(threads),
      channel: { port: PORT, state: 'command-channel-open' },
      observations: { tcp1402: 'open', statusResponse: true },
      // <STATUS> 응답을 받았다 = 런타임이 명령을 처리했다. 이것이 'healthy' 를 말할 수 있는 유일한 증거다.
      controllerHealth: { state: 'healthy', reason: 'Show Thread -web 에 <STATUS> 응답 — 런타임이 명령을 처리했다.' },
    };
    if (detail) {
      result.threadList = threads.map(compactThread);
      const log = await runCommand('ErrorLog -web ,10');
      result.errorLog = log.ok ? log.data.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : (log.error ?? log.status);
      result.resources = await probeResources(); // GitHub #22 — 자원 시계열이 상태 조회마다 자동으로 남게
    }
    return textResult(result);
  });

// ── VS Code 확장 연동 (Agent Bridge) ──────────────────────────────────────
tool('extension_status',
  'VS Code GPL 확장과의 브리지 상태: 확장 실행 여부·버전·pid·제어기 연결 상태·디버그 세션 여부와, 지금 1402 명령이 ' +
  '어느 경로로 나가는지(extension-bridge / direct-tcp). **"1402를 VS Code가 점유 중"이라고 추측하지 말고 이 도구로 확인할 것** — ' +
  '브리지가 켜져 있으면 MCP 명령이 확장의 같은 세션으로 나가므로 경쟁 자체가 없다. wake=true면 확장이 비활성 상태일 때 ' +
  'URI(code --open-url)로 활성화를 시도한다.',
  { wake: z.boolean().optional().describe('확장이 감지되지 않을 때 VS Code URI로 깨우기 시도(기본 false)') },
  async ({ wake }) => {
    const b = await currentBridge({ force: true, wake: wake === true });
    const raw = readExtensionPresence(HOST);
    return textResult({
      host: HOST,
      transport: transportInfo(),
      bridgeMode: BRIDGE_MODE,
      presenceFile: raw.presence?.file ?? null,
      woken: b.woken ?? false,
      wakeError: b.wakeError ?? null,
      available: b.available,
      nextStep: b.available
        ? 'extension_command로 확장 기능(Deploy·Quick Compile·브레이크포인트 동기화·진단 스냅샷 등)을 그대로 사용할 수 있다.'
        : bridgeUnavailableHint(b.reason),
    });
  });

tool('extension_command',
  'VS Code GPL 확장의 명령(gpl.*)을 실행하고 결과를 받는다 — 제어기 콘솔 명령이 아니라 **확장 기능 자체**를 쓰는 도구다. ' +
  '자주 쓰는 것: gpl.deploy(/GPL 업로드+Compile, Start 없음) · gpl.quickCompile(변경분만) · gpl.start(실행) · ' +
  'gpl.controller.pushBreakpoints/pullBreakpoints · gpl.ai.debug.getState/getConnectionState/setBreakpoint/evaluate/loop · ' +
  'gpl.diagnosticSnapshot · gpl.controller.showDashboard · gpl.controller.threadBreak({threadName}) 등. ' +
  '인자 형식은 확장 런북(Command ID 표)을 따른다. 제어기 안전 조건(Step 연타·정지 정착·Compile→Start 완충)은 확장의 명령 정책이 ' +
  '자동으로 지키며, 보류되면 result.error="policy-hold"로 돌아온다(제어기에 보내지 않은 상태).',
  {
    command: z.string().describe('확장 명령 ID (gpl.* 형식)'),
    args: z.any().optional().describe('명령 인자(객체/문자열). 생략하면 인자 없이 호출'),
    timeoutMs: z.number().int().min(1000).max(600000).optional().describe('응답 대기(ms, 기본 30000). Deploy처럼 오래 걸리는 명령은 크게'),
  },
  async ({ command, args, timeoutMs }) => {
    if (!BRIDGE_COMMAND_ID_PATTERN.test(command)) {
      return textResult({ ok: false, error: 'unsupported-command', hint: `'${command}' — 이 확장의 명령(gpl.*)만 실행할 수 있다.` });
    }
    const res = await callExtension(command, args, { timeoutMs });
    return textResult({ command, ...res, transport: transportInfo() });
  });

// ── 자동화 대상 프로젝트 (2026-08-31 개선안 §15~§27) ──────────────────────
// 확장의 `gpl.deploy`/`gpl.uploadStart`/`gpl.quickCompile`/`gpl.start`/`gpl.saveToFlash` 는 인자로 대상을 받으면
// **UI 를 띄우지 않고** 구조화된 결과를 돌려준다(그 전에는 QuickPick 이 열려 자동화가 멈췄다). 여기서는 그 인자를
// 항상 채워 보내고, 대상을 세션에 고정해 배포·컴파일·실행·Unload 가 전부 같은 프로젝트로 나가게 한다.

tool('project_target',
  '이 세션의 대상 프로젝트를 조회/고정/해제한다. **작업 시작 시 한 번 고정할 것** — 이후 모든 도구(compile_project·' +
  'start_project·unload_project·deploy_project·show_thread …)가 인자를 생략해도 같은 대상을 쓴다. ' +
  '인자 없이 부르면 현재 상태만 돌려준다: 세션 대상·출처(argument/session-target/env-default)·워크스페이스 후보 목록' +
  '(각 후보의 runnable = `.gpr` 에 ProjectStart 가 있는 실행 가능 프로젝트인지, 라이브러리면 참조하는 프로젝트명)·설정 기본값. ' +
  '**"왜 이 프로젝트가 올라갔지"를 추론하지 말고 이 도구로 확인할 것.** ' +
  'clear=true 면 고정을 푼다. 확장 브리지가 켜져 있으면 확장 쪽 세션 대상도 함께 고정된다.',
  {
    project: z.string().optional().describe('프로젝트 이름(.gpr ProjectName 또는 폴더명)'),
    projectDir: z.string().optional().describe('프로젝트 폴더 경로(이름이 겹칠 때 이것으로 특정)'),
    projectFile: z.string().optional().describe('.gpr 또는 프로젝트 안의 소스 파일 경로'),
    clear: z.boolean().optional().describe('true면 세션 대상 고정을 해제'),
  },
  async ({ project, projectDir, projectFile, clear }) => {
    let extension = null;
    let extensionError = null;
    const b = await currentBridge();
    if (b.available) {
      try {
        const res = await callExtension('gpl.automation.target', { project, projectDir, projectFile, clear });
        extension = res?.ok ? (res.result ?? null) : null;
        if (!res?.ok) extensionError = res?.detail ?? res?.error ?? 'unknown';
      } catch (err) {
        extensionError = err?.message ?? String(err);
      }
    }
    if (clear === true) {
      sessionProject = null;
    } else {
      // 확장이 해석한 이름을 우선 쓴다(.gpr ProjectName 이 폴더명과 다를 수 있다 — 제어기 명령 인자는 ProjectName).
      const resolved = extension?.target?.project ?? (project && project.trim() ? project.trim() : null);
      if (resolved) sessionProject = resolved;
    }
    const info = targetProjectInfo(undefined);
    return textResult({
      ok: true,
      target: sessionProject,
      effectiveProject: info.project,
      source: info.source,
      envDefault: DEFAULT_PROJECT,
      extension,
      extensionError,
      transport: transportInfo(),
      hint: sessionProject
        ? `이후 도구는 project 인자를 생략하면 '${sessionProject}' 를 씁니다. 다른 프로젝트는 그 호출에 project 를 직접 주세요.`
        : '세션 대상이 없습니다 — 인자를 생략한 도구는 GPL_PROJECT 기본값을 씁니다. 워크스페이스에 프로젝트가 여럿이면 확장 명령은 PROJECT_AMBIGUOUS 를 돌려줍니다. 먼저 이 도구로 대상을 고정할 것.',
    });
  });

/** 확장 배포 계열 명령의 결과 판정 — 구조화 오류(PROJECT_AMBIGUOUS 등)를 그대로 올려 보낸다. */
function deployOutcome(mode, command, res) {
  if (!res?.ok) {
    return {
      ok: false,
      mode,
      command,
      error: res?.error ?? 'bridge-failed',
      detail: res?.detail ?? '확장 명령 호출에 실패했다.',
      hint: '확장이 실행 중인지 extension_status 로 확인할 것. 확장 없이 배포(파일 업로드)는 이 서버로 할 수 없다 — 1402 콘솔은 파일을 올리지 못한다.',
    };
  }
  const r = res.result;
  // 확장이 UI 없이 돌려주는 구조화 실패 — 그대로 전달한다(사용자에게 클릭을 요구하지 않기 위한 설계).
  if (r && typeof r === 'object' && r.ok === false && typeof r.error === 'string') {
    return { ok: false, mode, command, ...r, ms: res.ms };
  }
  return { ok: true, mode, command, result: r ?? null, ms: res.ms };
}

tool('deploy_project',
  '로컬 프로젝트를 제어기에 올린다(확장 경유 — FTP 업로드는 1402 콘솔로 불가). **대상은 인자/세션 대상으로 결정되고 UI 는 뜨지 않는다.** ' +
  'mode: `build`(기본 — 정지 후 /GPL 전체 업로드 + Compile, Start 없음) · `quick`(변경분만 업로드 + Compile, 정지 생략 — 에러 확인용) · ' +
  '`upload-start`(업로드 + Start, Compile 생략 — Start 가 자체 컴파일). ' +
  '대상을 정할 수 없으면 `{ok:false, error:"PROJECT_AMBIGUOUS", candidates:[…]}` 가 오므로 사용자에게 묻거나 project 를 지정할 것. ' +
  '미저장 편집기 문서가 있으면 `UNSAVED_FILES` 로 멈춘다(업로드는 디스크 내용을 올리므로) — 저장해도 되면 saveDirty=true. ' +
  '`upload-start` 는 로봇이 움직일 수 있어 사용자 확인이 필요하다: 확인을 받은 뒤 confirmStart=true 로 호출하지 않으면 ' +
  '`INTERACTIVE_UI_REQUIRED` 가 온다(모달을 띄우지 않는다). [upload-start 는 모션 영향 가능]',
  {
    mode: z.enum(['build', 'quick', 'upload-start']).optional().describe('기본 build'),
    project: z.string().optional().describe('프로젝트 이름. 생략하면 세션 대상(project_target) 또는 확장의 자동 결정'),
    projectDir: z.string().optional().describe('프로젝트 폴더 경로'),
    projectFile: z.string().optional().describe('.gpr 또는 프로젝트 안의 소스 파일 경로'),
    saveDirty: z.boolean().optional().describe('true면 대상 폴더의 미저장 편집기 문서를 저장하고 계속(기본 false → UNSAVED_FILES)'),
    confirmStart: z.boolean().optional().describe('upload-start 전용 — 사용자에게 실행 확인을 이미 받았음을 단언'),
    ignoreCompileStale: z.boolean().optional().describe('컴파일 미검증 상태여도 진행'),
    timeoutMs: z.number().int().min(5000).max(600000).optional().describe('확장 명령 응답 대기(ms, 기본 240000 — 업로드+컴파일은 오래 걸린다)'),
  },
  async ({ mode, project, projectDir, projectFile, saveDirty, confirmStart, ignoreCompileStale, timeoutMs }) => {
    const m = mode ?? 'build';
    const command = m === 'quick' ? 'gpl.quickCompile' : m === 'upload-start' ? 'gpl.uploadStart' : 'gpl.deploy';
    const args = {
      // 대상을 항상 명시해 보낸다 — 확장이 active editor 를 보거나 QuickPick 을 열 이유를 없앤다(§18·§22).
      project: project ?? sessionProject ?? undefined,
      projectDir: projectDir ?? undefined,
      projectFile: projectFile ?? undefined,
      saveDirty: saveDirty === true ? true : undefined,
      confirmStart: confirmStart === true ? true : undefined,
      ignoreCompileStale: ignoreCompileStale === true ? true : undefined,
    };
    if (!args.project && !args.projectDir && !args.projectFile) {
      // 대상 키가 하나도 없으면 확장이 "자동화 인자"로 인식하지 못해 대화형 경로로 간다 — projectDir 자리에 빈 값을
      // 넣는 대신 project 를 환경 기본값으로 채워 보낸다(확장이 못 찾으면 PROJECT_NOT_FOUND 로 돌려준다).
      args.project = DEFAULT_PROJECT;
    }
    let res;
    try {
      res = await callExtension(command, args, { timeoutMs: timeoutMs ?? 240_000 });
    } catch (err) {
      return textResult({
        ok: false, mode: m, command,
        error: 'bridge-unavailable',
        detail: err?.message ?? String(err),
        hint: 'extension_status 로 확장 브리지를 확인할 것. 확장 없이는 파일 업로드가 불가하다(1402 콘솔은 Compile/Start 만 가능).',
      });
    }
    const out = deployOutcome(m, command, res);
    if (out.ok && args.project) sessionProject = args.project;   // 성공한 대상을 세션에 고정
    return textResult({ ...out, targetSent: args, transport: transportInfo() });
  });

// ── 컴파일/실행 ───────────────────────────────────────────────────────────
tool('compile_project',
  '프로젝트를 컴파일한다(Compile) — 에러 확인용. 성공/실패는 STATUS로만 판정하고, 실패 시 에러 라인을 파싱해 돌려준다. ' +
  '실행이 목적이면 이 도구 대신 start_project만 호출할 것(Start가 자체 컴파일 — Compile 직후 Start 연속 호출 금지).',
  { project: z.string().optional().describe(`프로젝트명(기본 ${DEFAULT_PROJECT})`) },
  async ({ project }) => {
    const raw = await sendGuarded(`Compile ${proj(project)}`, { timeoutMs: Math.max(TIMEOUT, 60000) });
    const status = parseStatus(raw);
    const { errors, aggregate } = parseCompileErrors(raw);
    return textResult({ command: `Compile ${proj(project)}`, ok: isSuccess(status), status, errorCount: errors.length, errors, aggregate });
  });

tool('start_project',
  '프로젝트 실행을 시작한다(Start). stopOnEntry=true면 진입점에서 정지(-break -bex). [시뮬레이션 모드 권장] ' +
  'PA 제어기의 Start는 자체적으로 Compile을 수행하므로 compile_project 직후 연속 호출하지 말 것(한 번에 하나만).',
  {
    project: z.string().optional(),
    stopOnEntry: z.boolean().optional().describe('진입점에서 멈춤(디버그 시작용)'),
  },
  async ({ project, stopOnEntry }) => {
    const cmd = stopOnEntry ? `Start ${proj(project)} -break -bex` : `Start ${proj(project)}`;
    return textResult(await runCommand(cmd));
  });

tool('unload_project',
  '프로젝트를 메모리에서 제거한다(Unload). ' +
  '**응답이 없어 타임아웃하면 실패가 아니라 결과 미확정(outcome="unknown")으로 돌아온다** — 제어기가 실행했을 수도 있다. ' +
  '실측 2026-08-31: Unload 타임아웃 뒤 약 2.5분간 1402 새 연결이 거부되다가 재부팅 없이 정상 복귀했다. ' +
  '그 사이의 ECONNREFUSED를 제어기 다운의 증거로 쓰지 말고, 같은 명령을 곧바로 재전송하지 말 것 — ' +
  'recommendedAction(wait-and-probe)대로 기다린 뒤 show_threads / controller_status 로 관측할 것. ' +
  '오래 걸릴 수 있으므로 필요하면 timeoutMs를 크게 줄 것(기본은 GPL_TIMEOUT_MS).',
  {
    project: z.string().optional(),
    timeoutMs: z.number().int().min(1000).max(600000).optional()
      .describe('응답 대기(ms). 생략하면 GPL_TIMEOUT_MS(기본 15000). Unload가 느린 환경이면 크게 줄 것'),
  },
  async ({ project, timeoutMs }) => textResult(await runCommand(`Unload ${proj(project)}`, timeoutMs ? { timeoutMs } : undefined)));

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
    keepBreakpoint: z.boolean().optional().describe(
      'true면 중단점을 남긴다(기본: 종료 시 해제). 그 줄에 원래 있던 중단점은 기본값에서도 지우지 않는다.'),
    timeoutMs: z.number().int().min(500).max(600000).optional().describe('정지 대기 한도(ms, 기본 20000)'),
  },
  async ({ thread, file, line, project, evals, keepBreakpoint, timeoutMs }) => {
    resetStepStreak();
    // 그 줄에 이미 중단점이 있으면(사용자가 찍은 빨간 점·이전 호출의 잔재) 끝나고 지우지 않는다 —
    // 남의 중단점을 소리 없이 없애면 이후 실행이 서야 할 곳에서 서지 않는다.
    const shown = await showBreakpoints();
    const preexisting = !!shown.list && hasBreakpointAt(shown.list, file, line);
    const temporary = !keepBreakpoint && !preexisting;
    // 임시 BP는 에디터에 반영하지 않는다(빨간 점 깜빡임 방지). 남길 BP는 반영해 눈에 보이게 한다.
    const bpOpts = temporary ? { mirrorBreakpoints: false } : undefined;
    const bp = await runCommand(`Set Break ${proj(project)} "${file}"${line}`, bpOpts);
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
    if (temporary) {
      const clear = await runCommand(`Set Nobreak ${proj(project)} "${file}"${line}`, { mirrorBreakpoints: false });
      result.breakpointCleared = clear.ok;
    } else if (preexisting) {
      result.breakpointCleared = false;
      result.breakpointKept = 'preexisting — 원래 있던 중단점이라 지우지 않았다(에디터 빨간 점일 수 있음).';
    }
    if (wait.paused && !atRequestedLine) {
      result.note = '요청한 줄이 아닌 다른 지점에서 정지했다(다른 브레이크포인트/에러 가능). location을 확인할 것.';
    } else if (!wait.paused && cont.ok) {
      result.note = `${timeoutMs ?? 20000}ms 내 정지 없음 — 해당 줄이 이 실행 경로에서 실행되지 않거나 오래 걸릴 수 있다. ` +
        (temporary ? '임시 중단점은 해제했다.' : '중단점은 남아 있으니 이후 show_thread로 재확인할 것.');
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
  '브레이크포인트 설정(Set Break <project> "<file>"<line>). file은 따옴표 안 파일명. ' +
  '확장 브리지를 거치면 VS Code 에디터의 같은 줄에도 중단점(빨간 점)이 생겨 사용자가 무엇을 걸었는지 보고 F9로 지울 수 있다.',
  { file: z.string().describe('예: ProtocolModule.gpl'), line: z.number().int().positive(), project: z.string().optional() },
  async ({ file, line, project }) => {
    resetStepStreak();
    return textResult(await runCommand(`Set Break ${proj(project)} "${file}"${line}`));
  });

tool('clear_breakpoint',
  '브레이크포인트 해제(Set Nobreak <project> "<file>"<line>). 에디터에 같은 위치의 빨간 점이 있으면 함께 지워진다.',
  { file: z.string(), line: z.number().int().positive(), project: z.string().optional() },
  async ({ file, line, project }) => textResult(await runCommand(`Set Nobreak ${proj(project)} "${file}"${line}`)));

tool('list_breakpoints',
  '설정된 모든 브레이크포인트 표시(Show Break) — 프로젝트·파일·줄·히트수를 구조화해 돌려준다.',
  {},
  async () => {
    const r = await showBreakpoints();
    return textResult({
      command: 'Show Break',
      ok: r.ok,
      status: r.status,
      ...(r.error ? { error: r.error } : {}),
      ...(r.list ? { count: r.list.length, breakpoints: r.list } : {}),
    });
  });

// ── 관찰(스레드/스택/변수) ────────────────────────────────────────────────
tool('debug_snapshot',
  '디버깅 상황 파악 원샷: 전체 스레드 목록 + (지정/자동 선택한 정지 스레드의) 위치 상세 + 호출 스택 + 선택 변수 평가를 한 호출로 반환한다. ' +
  '세션 시작 직후·정지 직후 "지금 어디서 뭘 하고 있나"는 show_threads/show_thread/show_stack을 따로 부르지 말고 이걸 먼저 쓸 것.',
  {
    thread: z.string().optional().describe('생략 시 정지(Paused/Break/Error) 상태인 첫 스레드 자동 선택'),
    evals: z.array(z.string()).optional().describe('정지 스레드에서 평가할 필드/로컬 변수 목록(프로퍼티는 m_백킹 필드로 자동 재시도)'),
    frame: z.number().int().min(0).optional().describe('evals 평가 프레임(기본 0)'),
    listLocals: z.boolean().optional()
      .describe('true면 정지 스레드의 해당 프레임 변수 전체 덤프(`Show Variable <thread> <frame>`, 이름 생략)를 원문으로 포함 — Brooks 문서상 구문, 실기기 미검증. 어떤 이름이 있는지 몰라 evals 이름을 추측하는 왕복을 없애는 용도'),
  },
  async ({ thread, evals, frame, listLocals }) => {
    const raw = await sendGuarded('Show Thread -web');
    const status = parseStatus(raw);
    const { threads } = parseThreadList(raw);
    const result = { ok: isSuccess(status), status, summary: summarizeThreads(threads), threads: threads.map(compactThread) };
    const focus = thread
      ?? threads.find((t) => PAUSED_STATES.has(t.state))?.name
      ?? null;
    if (focus) {
      const detail = await snapshotThread(focus);
      result.focusThread = focus;
      result.location = locationOf(detail);
      const stack = await runCommand(`Show Stack ${focus}`);
      result.stack = stack.ok ? stack.data : stack;
      const isPaused = !!(detail && PAUSED_STATES.has(detail.state));
      if (listLocals && isPaused) {
        const locals = await runCommand(`Show Variable ${focus} ${frame ?? 0}`);
        result.locals = locals.ok ? locals.data : locals;
        result.localsNote = '`Show Variable <thread> <frame>`(변수명 생략) — Brooks 문서상 "해당 레벨 변수 전체 표시", 실기기 미검증. 형식이 다르면 사용자에게 보고할 것.';
      }
      if (evals?.length && isPaused) {
        result.evals = await evalMany(focus, frame ?? 0, evals);
      }
    } else {
      result.note = '정지 상태의 스레드가 없다. 필요하면 pause_thread 또는 run_to_line으로 정지점을 만들 것.';
    }
    return textResult(result);
  });

tool('show_threads',
  '전체 스레드 목록(Show Thread -web) — 이름 있는 키(name/state/project/procedure/file/line)로 구조화해 반환. ' +
  'verbose=true일 때만 원문 줄(rawLines)과 열 배열(fields)을 함께 준다(기본은 compact — 토큰 절약).',
  { verbose: z.boolean().optional().describe('원문 줄·fields 포함') },
  async ({ verbose }) => {
    const raw = await sendGuarded('Show Thread -web');
    const status = parseStatus(raw);
    const { threads, rawLines } = parseThreadList(raw);
    return textResult({
      ok: isSuccess(status), status,
      summary: summarizeThreads(threads),
      threads: verbose ? threads : threads.map(compactThread),
      ...(verbose ? { rawLines } : {}),
    });
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
  '정지된 스레드의 특정 프레임에서 변수를 평가한다(Show Variable -eval <thread> <frame> <expr>). 결과는 `{name,type,value,kind,members?}`로 구조화된다. ' +
  '평가 가능(GPL 4.2K5 실측): 그 프레임의 로컬/파라미터, 모듈 전역, 모듈전역.public필드(theMotionLoger.lastStage 형태), 배열 인덱스 arr(i), 객체명(필드 덤프 반환), ' +
  '체인 중간의 사용자 Property/Function(마지막이 시스템 멤버여야 함: `x.loc.X`, `x.loc.Pos`). ' +
  '평가 불가: 마지막 요소가 사용자 프로퍼티/메서드(-780 — 관례 백킹 필드 m_<이름>으로 자동 재시도하고 성공하면 resolvedAs 표시), 다른 클래스 프레임의 Private 점 표기(-729), 다른 프레임의 로컬(-729), ' +
  '`Me.`(자동 제거)·CStr() 감싸기·산술(-712). 실패하면 같은 부류로 재시도하지 말고 응답 hint를 따를 것. ' +
  '여러 값은 debug_snapshot/step_thread/run_to_line의 evals로 배치하면 왕복을 아낀다.',
  {
    thread: z.string(),
    frame: z.number().int().min(0).describe('스택 프레임 인덱스(0=최상단). 로컬이 -729면 show_stack으로 프레임 확인'),
    expression: z.string().describe('로컬/필드/배열요소/객체명(프로퍼티는 m_백킹 필드 자동 재시도)'),
  },
  async ({ thread, frame, expression }) => textResult(await evalOne(thread, frame, expression)));

tool('set_variable',
  '변수/식에 값을 대입한다(Execute <expression>, <project>). 예: expression="myVar = 1". [시뮬레이션 모드 권장]',
  { expression: z.string().describe('예: someVar = 123'), project: z.string().optional() },
  async ({ expression, project }) => textResult(await runCommand(`Execute ${expression}, ${proj(project)}`)));

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[gpl-controller-mcp] ready — ${BUILD_LABEL} — target ${HOST}:${PORT}, default project "${DEFAULT_PROJECT}"`);
  // 시작 시 확장 브리지 상태를 한 줄 알린다(깨우지는 않는다 — 사용자가 VS Code를 열지 않았을 수 있으므로).
  void currentBridge({ force: true }).then((b) => {
    console.error(b.available
      ? `[gpl-controller-mcp] extension bridge: ON — v${b.presence.extensionVersion} pid ${b.presence.pid} (1402 명령이 확장 세션으로 나감)`
      : `[gpl-controller-mcp] extension bridge: OFF (${b.reason}) — 제어기에 직접 접속. GPL_BRIDGE=${BRIDGE_MODE}`);
  }).catch(() => { /* noop */ });
  if (LOG_FILE) {
    console.error(`[gpl-controller-mcp] session log: ${LOG_FILE}`);
    console.error(`[gpl-controller-mcp] 실시간 관찰: Get-Content "${LOG_FILE}" -Wait`);
  }
  logLine(`session start — ${BUILD_LABEL} — target ${HOST}:${PORT}, project "${DEFAULT_PROJECT}", idleClose ${IDLE_CLOSE}ms`);
}

main().catch((err) => {
  console.error('[gpl-controller-mcp] fatal:', err);
  process.exit(1);
});
