// Agent Bridge 클라이언트 — MCP 서버가 **VS Code 확장의 명령을 호출**하는 통로.
//
// 왜(2026-08-28): MCP는 제어기 1402에 직접 TCP로 붙는 별도 프로세스라, 확장이 keep-alive 세션을 쥐고 있으면
// 두 세션이 경쟁했다. 그 결과 AI가 "제어기는 정상인데 1402를 VS Code가 점유 중"이라고만 보고하고 **확장을 통한
// 테스트를 하지 못했다**. 이제 확장이 살아 있으면 1402 명령과 확장 기능(Deploy/Quick Compile/브레이크포인트 동기화…)을
// 이 브리지로 보낸다 → 트래픽이 확장의 단일 직렬 큐·keep-alive 세션·명령 정책(R1/R2/R3)을 그대로 타고,
// GPL Traffic/Output에도 함께 남는다. 확장이 없으면 종전처럼 직접 접속으로 자동 폴백한다.
//
// 인스턴스 분리(2026-09-10 개선안 §4·§5·§6): presence 와 큐가 제어기 IP 하나를 네임스페이스로 쓰던 때에는
// 같은 제어기를 보는 VS Code 창이 둘이면 두 창이 같은 요청 디렉터리를 읽어 **아무 창이나** 명령을 실행했고,
// presence 도 서로 덮어써 어느 창인지 알 수 없었다. 이제 확장이 창마다 `extensionInstanceId` 로 presence 와
// 큐를 분리하고, 이쪽은 대상 인스턴스를 먼저 고른 뒤(§6) 그 큐로만 보낸다.
//
// 파일 계약(확장 src/controller/agentBridge.ts와 동일하게 유지):
//   presence(인스턴스) : <dir>/extensions/<instanceId>.json
//   presence(레거시)   : <dir>/<ip>.extension.json          — 리더 인스턴스만 쓴다(구버전 호환)
//   요청     : <dir>/bridge/inst/<instanceId>/req/<id>.json  (레거시: <dir>/bridge/<ip>/req/<id>.json)
//   응답     : 같은 큐의 res/<id>.json
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

// ── 인스턴스 네임스페이스(§4·§5) ──────────────────────────────────────────

export function sanitizeInstanceId(id) {
  const safe = String(id || '').trim().replace(/[^A-Za-z0-9._-]/g, '_');
  return safe || 'unknown';
}

export function instancePresenceDir(dir = bridgeRootDir()) {
  return path.join(dir, 'extensions');
}

export function instanceBridgeDirs(instanceId, dir = bridgeRootDir()) {
  const base = path.join(dir, 'bridge', 'inst', sanitizeInstanceId(instanceId));
  return { base, reqDir: path.join(base, 'req'), resDir: path.join(base, 'res') };
}

/** presence 레코드가 지금 살아 있는가(heartbeat·pid·브리지 사용 가능). */
function presenceIsLive(rec, { now, staleMs, pidAlive }) {
  if (!rec || typeof rec !== 'object' || rec.version !== AGENT_BRIDGE_VERSION) return false;
  if (typeof rec.heartbeat !== 'number' || now - rec.heartbeat > staleMs) return false;
  if (typeof rec.pid === 'number' && rec.pid > 0 && !pidAlive(rec.pid)) return false;
  return !!rec.bridge?.enabled;
}

/**
 * 살아 있는 확장 인스턴스 목록(§21). `ip` 를 주면 그 제어기를 보는 것만 남긴다.
 * `leader` 는 계산값이다 — 레거시(IP) 큐를 맡은 인스턴스로, 확장과 같은 규칙(가장 먼저 뜬 것)으로 정한다.
 */
export function listExtensionInstances(ip, { dir, now = Date.now(), staleMs = PRESENCE_STALE_MS, pidAlive = isPidAlive } = {}) {
  const base = instancePresenceDir(dir);
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
      rec = JSON.parse(fs.readFileSync(path.join(base, name), 'utf8'));
    } catch {
      continue;
    }
    if (!presenceIsLive(rec, { now, staleMs, pidAlive })) continue;
    if (typeof rec.extensionInstanceId !== 'string' || !rec.extensionInstanceId) continue;
    if (ip && rec.ip !== ip) continue;
    out.push({ ...rec, file: path.join(base, name) });
  }
  const leaderId = electLeaderInstanceId(out);
  return out
    .map((p) => ({ ...p, leader: p.extensionInstanceId === leaderId }))
    .sort((a, b) => a.since - b.since);
}

/** 레거시(IP) 큐를 맡은 인스턴스 — 확장 `electLeaderInstanceId` 와 같은 규칙(가장 먼저 뜬 것, 동률이면 id 순). */
export function electLeaderInstanceId(presences) {
  const live = (presences || []).filter((p) => p?.bridge?.enabled && typeof p.extensionInstanceId === 'string');
  if (live.length === 0) return undefined;
  let best = live[0];
  for (const p of live.slice(1)) {
    if (p.since < best.since || (p.since === best.since && String(p.extensionInstanceId) < String(best.extensionInstanceId))) {
      best = p;
    }
  }
  return best.extensionInstanceId;
}

/** 경로 비교용 정규화 — Windows 대소문자·구분자 차이를 없앤다. */
function normalizePathKey(p) {
  const s = String(p || '').trim().replace(/[\\/]+/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? s.toLowerCase() : s;
}

/** `child` 가 `parent` 안(또는 같은 폴더)인가. */
export function pathIsInside(child, parent) {
  const c = normalizePathKey(child);
  const p = normalizePathKey(parent);
  if (!c || !p) return false;
  return c === p || c.startsWith(`${p}/`);
}

/**
 * 명령을 보낼 확장 인스턴스를 고른다(§6). **후보가 하나로 좁혀지지 않으면 임의로 고르지 않는다** —
 * 엉뚱한 창이 배포를 수행하는 것이 원래 문제였다.
 *
 * 우선순위: 명시 instanceId → projectDir 를 품은 워크스페이스 → 그 제어기에 connected → 유일 후보.
 * @returns {{ok:true, instance, via}|{ok:false, error:'EXTENSION_NOT_FOUND'|'EXTENSION_AMBIGUOUS', detail, candidates}}
 */
export function resolveExtensionInstance(ip, { instanceId, projectDir, dir, now, staleMs, pidAlive } = {}) {
  const all = listExtensionInstances(ip, { dir, now, staleMs, pidAlive });
  const summarize = (list) => list.map((p) => ({
    extensionInstanceId: p.extensionInstanceId,
    pid: p.pid,
    workspace: p.workspace ?? null,
    workspaceFolders: p.workspaceFolders ?? [],
    connected: !!p.connected,
    leader: !!p.leader,
  }));
  if (all.length === 0) {
    return {
      ok: false,
      error: 'EXTENSION_NOT_FOUND',
      detail: '살아 있는 확장 인스턴스가 없다(VS Code 에서 GPL 확장이 실행 중이 아니거나 활성화되지 않음).',
      candidates: [],
    };
  }
  if (instanceId) {
    const hit = all.find((p) => p.extensionInstanceId === instanceId);
    if (hit) return { ok: true, instance: hit, via: 'explicit-instance' };
    return {
      ok: false,
      error: 'EXTENSION_NOT_FOUND',
      detail: `extensionInstanceId '${instanceId}' 인 확장 인스턴스가 살아 있지 않다(창이 닫혔거나 id 가 바뀌었다).`,
      candidates: summarize(all),
    };
  }
  let pool = all;
  let via = 'sole-instance';
  if (projectDir) {
    const inWorkspace = all.filter((p) => (p.workspaceFolders ?? []).some((f) => pathIsInside(projectDir, f)));
    if (inWorkspace.length > 0) {
      pool = inWorkspace;
      via = 'workspace-match';
    }
  }
  if (pool.length > 1) {
    const connected = pool.filter((p) => p.connected);
    if (connected.length > 0 && connected.length < pool.length) {
      pool = connected;
      via = 'connected';
    }
  }
  if (pool.length === 1) return { ok: true, instance: pool[0], via };
  return {
    ok: false,
    error: 'EXTENSION_AMBIGUOUS',
    detail: `대상 확장 인스턴스를 하나로 정할 수 없다(후보 ${pool.length}개). `
      + 'projectDir 로 워크스페이스를 특정하거나 extensionInstanceId 를 직접 지정할 것 — 임의로 고르지 않는다.',
    candidates: summarize(pool),
  };
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
export async function callExtensionCommand(ip, command, args, { dir, timeoutMs = 20_000, pollMs = 25, from = 'gpl-controller-mcp', instanceId, requestId } = {}) {
  if (!BRIDGE_COMMAND_ID_PATTERN.test(String(command || ''))) {
    return { ok: false, error: 'unsupported-command', detail: `'${command}' — 확장 명령(gpl.*)만 브리지로 실행할 수 있다`, ms: 0 };
  }
  // 대상 인스턴스가 정해졌으면 그 창의 큐로만 보낸다(§5). 없으면 레거시(IP) 큐 — 구버전 확장 호환.
  const { reqDir, resDir } = instanceId ? instanceBridgeDirs(instanceId, dir) : bridgeDirs(ip, dir);
  const id = requestId || makeRequestId();
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
        return { ...res, requestId: id, instanceId: instanceId ?? null, ms: Date.now() - startedAt };
      } catch (err) {
        return { ok: false, error: 'response-parse-failed', detail: err?.message ?? String(err), requestId: id, ms: Date.now() - startedAt };
      }
    }
    if (Date.now() >= deadline) {
      // 아직 집어 가지 않은 요청이면 치운다 — 확장이 한참 뒤에 뒤늦게 실행하지 않도록.
      // 이미 집어 갔다면(파일 없음) 확장은 계속 실행 중이고 결과는 응답 파일로 온다 — 그래서
      // requestId 를 함께 돌려준다. 같은 명령을 다시 보내지 말고 `takeLateResponse` 로 회수할 것(§9·§11).
      let stillQueued = true;
      try { fs.unlinkSync(reqFile); } catch { stillQueued = false; }
      return {
        ok: false, error: 'bridge-timeout',
        detail: stillQueued
          ? `확장이 ${timeoutMs}ms 안에 요청을 집어 가지 않아 요청을 취소했다 (${reqFile}) — 실행되지 않았다.`
          : `확장이 요청을 실행 중이지만 ${timeoutMs}ms 안에 끝나지 않았다 — 결과는 나중에 응답 파일로 온다. 같은 명령을 다시 보내지 말 것.`,
        sent: !stillQueued,
        requestId: id,
        instanceId: instanceId ?? null,
        responseFile: resFile,
        ms: Date.now() - startedAt,
      };
    }
    await sleep(pollMs);
  }
}

/**
 * 타임아웃 뒤에 도착한 응답 회수(§11). 있으면 소비하고 돌려주고, 없으면 null.
 * 확장은 응답 파일을 RESPONSE_SWEEP_MS(5분) 동안 보관하므로 그 사이에는 결과를 되찾을 수 있다.
 */
export function takeLateResponse(ip, requestId, { dir, instanceId } = {}) {
  if (!requestId) return null;
  const { resDir } = instanceId ? instanceBridgeDirs(instanceId, dir) : bridgeDirs(ip, dir);
  const file = path.join(resDir, `${String(requestId).replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  try { fs.unlinkSync(file); } catch { /* noop */ }
  try {
    return JSON.parse(text);
  } catch {
    return null;
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
export async function resolveBridge(ip, { dir, mode = 'auto', wake = true, wakeWaitMs = 4000, now = Date.now, instanceId } = {}) {
  if (mode === 'off') {
    return { available: false, reason: 'bridge-off', presence: null, instances: [] };
  }
  /**
   * 인스턴스 presence 가 있으면 그쪽이 정본이다. 여러 창이 떠 있어도 **기본 경로는 리더**로 정해 둔다 —
   * 임의 선택이 아니라 확장과 같은 규칙으로 계산한 값이라 양쪽이 같은 창을 가리킨다. 1402 콘솔 명령은
   * 어느 창을 거치든 같은 제어기로 나가므로 이것으로 충분하고, **대상이 중요한 배포/프로젝트 명령은**
   * 호출측이 `resolveExtensionInstance(projectDir)` 로 창을 특정한다(§6).
   */
  const pick = () => {
    const instances = listExtensionInstances(ip, { dir });
    if (instances.length === 0) return null;
    const chosen = (instanceId && instances.find((p) => p.extensionInstanceId === instanceId))
      || instances.find((p) => p.leader)
      || instances[0];
    return { available: true, reason: null, presence: chosen, instances };
  };

  const first = pick();
  if (first) return first;

  let read = readExtensionPresence(ip, { dir });
  if (read.presence) {
    // 구버전 확장(인스턴스 presence 없음) — 레거시 경로로 계속 동작한다.
    return { available: true, reason: null, presence: read.presence, instances: [], legacy: true };
  }
  if (wake && (read.reason === 'presence-missing' || read.reason === 'presence-stale' || read.reason === 'presence-dead-pid')) {
    // 확장이 아직 활성화되지 않았을 수 있다 — URI로 깨우고 잠깐 기다린다.
    const woke = await wakeExtension();
    if (woke.ok) {
      const deadline = now() + wakeWaitMs;
      while (now() < deadline) {
        await sleep(150);
        const again = pick();
        if (again) return { ...again, woken: true };
        read = readExtensionPresence(ip, { dir });
        if (read.presence) {
          return { available: true, reason: null, presence: read.presence, instances: [], legacy: true, woken: true };
        }
      }
    } else {
      return { available: false, reason: read.reason, presence: null, instances: [], wakeError: woke.detail };
    }
  }
  return { available: false, reason: read.reason, presence: null, instances: [] };
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
