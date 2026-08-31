// Agent Bridge 클라이언트 — MCP 서버가 **VS Code 확장의 명령을 호출**하는 통로.
//
// 왜(2026-08-28): MCP는 제어기 1402에 직접 TCP로 붙는 별도 프로세스라, 확장이 keep-alive 세션을 쥐고 있으면
// 두 세션이 경쟁했다. 그 결과 AI가 "제어기는 정상인데 1402를 VS Code가 점유 중"이라고만 보고하고 **확장을 통한
// 테스트를 하지 못했다**. 이제 확장이 살아 있으면 1402 명령과 확장 기능(Deploy/Quick Compile/브레이크포인트 동기화…)을
// 이 브리지로 보낸다 → 트래픽이 확장의 단일 직렬 큐·keep-alive 세션·명령 정책(R1/R2/R3)을 그대로 타고,
// GPL Traffic/Output에도 함께 남는다. 확장이 없으면 종전처럼 직접 접속으로 자동 폴백한다.
//
// 파일 계약(확장 src/controller/agentBridge.ts와 동일하게 유지):
//   presence : <dir>/<ip>.extension.json
//   요청     : <dir>/bridge/<ip>/req/<id>.json
//   응답     : <dir>/bridge/<ip>/res/<id>.json
// dir 기본값은 배포 잠금과 같은 %TEMP%/gpl-controller (GPL_LOCK_DIR로 재정의 가능).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

export const AGENT_BRIDGE_VERSION = 1;
export const PRESENCE_STALE_MS = 15_000;
export const BRIDGE_DIR_NAME = 'gpl-controller';
/** 확장 URI 진입점 — presence가 없을 때(확장 미활성화) 깨우는 데 쓴다. */
export const EXTENSION_URI_PREFIX = 'vscode://nir414.gpl-language-support';
export const BRIDGE_COMMAND_ID_PATTERN = /^gpl\.[A-Za-z0-9_.]+$/;

export function bridgeRootDir(env = process.env) {
  return env.GPL_LOCK_DIR || path.join(os.tmpdir(), BRIDGE_DIR_NAME);
}

export function sanitizeIpForPath(ip) {
  const safe = String(ip || 'default').trim().replace(/[^A-Za-z0-9._-]/g, '_');
  return safe || 'default';
}

export function presenceFilePath(ip, dir = bridgeRootDir()) {
  return path.join(dir, `${sanitizeIpForPath(ip)}.extension.json`);
}

export function bridgeDirs(ip, dir = bridgeRootDir()) {
  const base = path.join(dir, 'bridge', sanitizeIpForPath(ip));
  return { base, reqDir: path.join(base, 'req'), resDir: path.join(base, 'res') };
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
 * 확장 presence. 없거나 stale이면 null(이유는 두 번째 반환값).
 * @returns {{ presence: object|null, reason: string|null }}
 */
export function readExtensionPresence(ip, { dir, now = Date.now(), staleMs = PRESENCE_STALE_MS, pidAlive = isPidAlive } = {}) {
  const file = presenceFilePath(ip, dir);
  let rec;
  try {
    rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return { presence: null, reason: err?.code === 'ENOENT' ? 'presence-missing' : 'presence-unreadable' };
  }
  if (!rec || typeof rec !== 'object' || rec.version !== AGENT_BRIDGE_VERSION) {
    return { presence: null, reason: 'presence-version' };
  }
  if (typeof rec.heartbeat !== 'number' || now - rec.heartbeat > staleMs) {
    return { presence: null, reason: 'presence-stale' };
  }
  if (typeof rec.pid === 'number' && rec.pid > 0 && !pidAlive(rec.pid)) {
    return { presence: null, reason: 'presence-dead-pid' };
  }
  if (!rec.bridge?.enabled) {
    return { presence: null, reason: 'bridge-disabled' };
  }
  return { presence: { ...rec, file }, reason: null };
}

let seq = 0;
/** 요청 id — 파일명으로 안전한 문자만(확장의 requestIdFromFileName 규칙과 맞춤). */
export function makeRequestId(now = Date.now(), pid = process.pid) {
  seq = (seq + 1) % 100000;
  return `${now}-${pid}-${seq}-${Math.random().toString(36).slice(2, 8)}`;
}

function writeFileAtomic(file, content) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content);
  try {
    fs.renameSync(tmp, file);
  } catch {
    try { fs.writeFileSync(file, content); } finally { try { fs.unlinkSync(tmp); } catch { /* noop */ } }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 확장 명령 1건 실행. 응답 파일이 올 때까지 폴링한다.
 * @returns {Promise<{ok:boolean, result?:any, error?:string, detail?:string, code?:string, ms:number}>}
 *          ok=true는 "확장이 명령을 실행했다"는 뜻이고, 명령 자체의 성공/실패는 result 안에 있다.
 */
export async function callExtensionCommand(ip, command, args, { dir, timeoutMs = 20_000, pollMs = 25, from = 'gpl-controller-mcp' } = {}) {
  if (!BRIDGE_COMMAND_ID_PATTERN.test(String(command || ''))) {
    return { ok: false, error: 'unsupported-command', detail: `'${command}' — 확장 명령(gpl.*)만 브리지로 실행할 수 있다`, ms: 0 };
  }
  const { reqDir, resDir } = bridgeDirs(ip, dir);
  const id = makeRequestId();
  const reqFile = path.join(reqDir, `${id}.json`);
  const resFile = path.join(resDir, `${id}.json`);
  const startedAt = Date.now();
  try {
    fs.mkdirSync(reqDir, { recursive: true });
    fs.mkdirSync(resDir, { recursive: true });
    writeFileAtomic(reqFile, JSON.stringify({
      version: AGENT_BRIDGE_VERSION, id, command, args, createdAt: startedAt, from: `${from} pid ${process.pid}`, timeoutMs,
    }));
  } catch (err) {
    return { ok: false, error: 'request-write-failed', detail: err?.message ?? String(err), ms: Date.now() - startedAt };
  }

  const deadline = startedAt + timeoutMs;
  for (;;) {
    let text = null;
    try {
      text = fs.readFileSync(resFile, 'utf8');
    } catch { /* 아직 없음 */ }
    if (text) {
      try { fs.unlinkSync(resFile); } catch { /* noop */ }
      try {
        const res = JSON.parse(text);
        return { ...res, ms: Date.now() - startedAt };
      } catch (err) {
        return { ok: false, error: 'response-parse-failed', detail: err?.message ?? String(err), ms: Date.now() - startedAt };
      }
    }
    if (Date.now() >= deadline) {
      // 요청이 남아 있으면 치운다 — 확장이 나중에 뒤늦게 실행하지 않도록.
      try { fs.unlinkSync(reqFile); } catch { /* noop */ }
      return {
        ok: false, error: 'bridge-timeout',
        detail: `확장이 ${timeoutMs}ms 안에 응답하지 않음 (요청 ${reqFile})`,
        ms: Date.now() - startedAt,
      };
    }
    await sleep(pollMs);
  }
}

/**
 * 확장을 URI로 깨운다(비활성 상태면 VS Code가 확장을 활성화하고, 활성화되면 브리지가 켜진다).
 * `code` CLI가 없으면 조용히 실패한다 — 브리지 없이도 직접 접속으로 동작하므로 치명적이지 않다.
 */
export function wakeExtension({ cli = process.env.GPL_VSCODE_CLI || 'code', timeoutMs = 8000 } = {}) {
  return new Promise((resolve) => {
    const url = `${EXTENSION_URI_PREFIX}/gpl.ai.debug.getConnectionState`;
    try {
      execFile(cli, ['--open-url', url], { timeout: timeoutMs, windowsHide: true, shell: process.platform === 'win32' }, (err) => {
        resolve({ ok: !err, detail: err ? (err.message ?? String(err)) : null, cli });
      });
    } catch (err) {
      resolve({ ok: false, detail: err?.message ?? String(err), cli });
    }
  });
}

/**
 * 브리지 사용 가능 여부 판정 + (필요하면) 확장 깨우기.
 * mode: 'auto'(기본, 없으면 직접 접속) | 'only'(브리지 필수) | 'off'(항상 직접 접속)
 */
export async function resolveBridge(ip, { dir, mode = 'auto', wake = true, wakeWaitMs = 4000, now = Date.now } = {}) {
  if (mode === 'off') {
    return { available: false, reason: 'bridge-off', presence: null };
  }
  let read = readExtensionPresence(ip, { dir });
  if (read.presence) {
    return { available: true, reason: null, presence: read.presence };
  }
  if (wake && (read.reason === 'presence-missing' || read.reason === 'presence-stale' || read.reason === 'presence-dead-pid')) {
    // 확장이 아직 활성화되지 않았을 수 있다 — URI로 깨우고 잠깐 기다린다.
    const woke = await wakeExtension();
    if (woke.ok) {
      const deadline = now() + wakeWaitMs;
      while (now() < deadline) {
        await sleep(150);
        read = readExtensionPresence(ip, { dir });
        if (read.presence) {
          return { available: true, reason: null, presence: read.presence, woken: true };
        }
      }
    } else {
      return { available: false, reason: read.reason, presence: null, wakeError: woke.detail };
    }
  }
  return { available: false, reason: read.reason, presence: null };
}

/**
 * 브리지 전송이 **모호하게** 실패했을 때(타임아웃·확장 내부 실패) 직접 접속으로 다시 보내도 안전한 명령인가.
 * 조회 명령은 반복해도 무해하지만, 상태 변경 명령은 확장이 이미 보냈을 수 있어 중복 전송이 위험하다
 * (Step 중복 = 두 줄 진행, Start 중복 = 컴파일 중복 — ai-handoff §0.6/§0.7).
 */
export function isRetrySafeCommand(command) {
  const c = String(command || '').trim();
  if (/(^|\s)-clear\b/i.test(c)) return false;   // ErrorLog -clear 는 상태 변경
  return /^(show|errorlog|dir|directory|pd|pdx|type|memory)\b/i.test(c);
}

/** 브리지가 안 될 때 AI에게 줄 설명 — "1402 점유"로 결론짓지 말고 무엇을 할지 알려 준다. */
export function bridgeUnavailableHint(reason) {
  switch (reason) {
    case 'bridge-off':
      return 'GPL_BRIDGE=off 로 브리지가 꺼져 있어 제어기에 직접 접속했다. 확장 경로를 쓰려면 GPL_BRIDGE=auto 로 둘 것.';
    case 'bridge-disabled':
      return '확장은 살아 있으나 Agent Bridge가 꺼져 있다(설정 gpl.agentBridge.enabled). 켜면 확장 세션을 공유해 1402 경쟁이 없어진다.';
    case 'presence-missing':
    case 'presence-stale':
    case 'presence-dead-pid':
      return 'VS Code에서 GPL 확장이 실행 중이 아니거나 활성화되지 않았다. VS Code를 열어 두면 확장 명령(Deploy/Quick Compile/디버그)까지 MCP로 쓸 수 있다. 직접 접속으로도 1402 명령은 가능하다.';
    default:
      return '확장 브리지를 쓸 수 없어 제어기에 직접 접속했다. 1402는 단일 채널이므로 확장이 동시에 폴링 중이면 응답이 늦을 수 있다 — extension_status로 확인할 것.';
  }
}
