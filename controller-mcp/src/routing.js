// 요청 경로·주소 판정의 순수 규칙(2026-11-13, inbox 11-05/11-10/11-11) — 파일·소켓·MCP SDK 없음.
//
// 왜: index.js 는 이미 3000줄이라 판정 로직을 거기 더 쌓지 않는다. 여기서는 (1) 전송하지 못한 실패의 원인 상태 이름,
// (2) 세션 대상의 창 고르기와 "엉뚱한 창을 읽었다" 경고, (3) 서버·확장 버전 불일치 경고를 계산한다.

import { matchWorkspaceInstances, workspaceMatchTier } from './extensionBridge.js';

/**
 * 보내지 못한(`not-sent`) 실패의 원인 상태. 종전 controller_status 는 이런 실패에도 ICMP 프로브를 돌려
 * `host-unreachable` 로 적었다 — 실제로는 접속을 시도하지도 않았으므로 원인을 그대로 이름 붙인다(11-10 #1).
 * - `err.preSendCause.state` 가 있으면 그것(예: extension-disconnected)
 * - GPL_BRIDGE=only 에서 브리지 사유가 host-mismatch 면 `bridge-host-mismatch`
 * - 그 밖에는 null(= 실제 접속 실패이므로 도달성 프로브 대상)
 * @returns {null|{state:string, detail:string, nextStep:string|null}}
 */
export function preSendCauseOf(err) {
  if (!err) return null;
  const c = err.preSendCause;
  if (c && typeof c.state === 'string') {
    return { state: c.state, detail: String(c.detail ?? err.message ?? ''), nextStep: c.nextStep ?? null };
  }
  if (err.bridgeReason === 'host-mismatch' || (err.hostMismatch && err.sendOutcome === 'not-sent')) {
    return {
      state: 'bridge-host-mismatch',
      detail: String(err.message ?? '확장 창과 제어기 주소가 다르다'),
      nextStep: '확장 창의 IP 와 이 MCP 의 대상이 다르다 — extension_resolve {extensionInstanceId} 로 이 세션의 창을 고정하거나 VS Code 에서 연결을 확인할 것.',
    };
  }
  return null;
}

/**
 * 세션 대상(project_target) 폴더의 창 — 작업 폴더와 겹치는 창 중 제어기에 연결된 창, 여럿이면 가장 먼저 뜬 창.
 * 겹치는 창이 없으면 null(호출측이 종전 경로를 쓴다).
 */
export function pickSessionWindow(instances, sessionDir) {
  const matched = matchWorkspaceInstances(instances, sessionDir);
  if (matched.length === 0) return null;
  const connected = matched.filter((p) => p.connected === true);
  const pool = connected.length > 0 ? connected : matched;
  const instance = [...pool].sort((a, b) => (a.since ?? 0) - (b.since ?? 0)
    || String(a.extensionInstanceId).localeCompare(String(b.extensionInstanceId)))[0];
  return { instance, via: 'workspace-match' };
}

/**
 * 세션 대상과 다른 창(다른 제어기일 수 있다)을 읽었는가 — 그렇다면 `routeMismatch` 를 돌려준다(11-11).
 * 세션 대상이 없거나 폴더가 없으면 판단 근거가 없어 null. `readInstance` 가 없으면(구버전 레거시 큐) null.
 * @returns {null|{sessionTarget:{project:string|null, dir:string}, readFrom:{extensionInstanceId:string|null, workspace:string|null, ip:string|null, connected:boolean}, detail:string}}
 */
export function routeMismatchOf({ sessionTarget, readInstance }) {
  const dir = sessionTarget?.dir;
  if (!dir || !readInstance) return null;
  if (workspaceMatchTier(dir, readInstance.workspaceFolders) > 0) return null;
  return {
    sessionTarget: { project: sessionTarget.project ?? null, dir },
    readFrom: {
      extensionInstanceId: readInstance.extensionInstanceId ?? null,
      workspace: readInstance.workspace ?? null,
      ip: readInstance.ip ?? null,
      connected: !!readInstance.connected,
    },
    detail: `세션 대상(${sessionTarget.project ?? dir})의 창이 아니라 다른 창(${readInstance.workspace ?? readInstance.extensionInstanceId}, ${readInstance.ip ?? '?'})을 읽었다 — `
      + '출력이 없는 것은 대상 제어기의 무출력이 아닐 수 있다. extensionInstanceId 로 대상 창을 지정해 다시 읽을 것.',
  };
}

function parseSemver(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v ?? '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** semver 비교 — 둘 중 하나라도 해석할 수 없으면 null(모름). a>b 면 1, 같으면 0, 작으면 -1. */
export function compareSemver(a, b) {
  const x = parseSemver(a);
  const y = parseSemver(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  }
  return 0;
}

/**
 * MCP 서버 버전과 연결된 확장 창의 버전이 다르면 경고(11-10 #2) — globalStorage 사본이 옛 확장에 덮여
 * 세션마다 서버 버전이 달랐다. 소스 직접 실행(`dev`)이거나 버전을 알 수 없으면 null.
 * @returns {null|{serverVersion:string, extensionVersion:string, relation:'server-older'|'server-newer', detail:string}}
 */
export function serverVersionWarning(serverVersion, extensionVersion) {
  const cmp = compareSemver(serverVersion, extensionVersion);
  if (cmp === null || cmp === 0) return null;
  return {
    serverVersion: String(serverVersion),
    extensionVersion: String(extensionVersion),
    relation: cmp < 0 ? 'server-older' : 'server-newer',
    detail: `MCP 서버(v${serverVersion})와 연결된 확장(v${extensionVersion})의 버전이 다르다 — `
      + (cmp < 0
        ? '서버가 더 옛 버전이라 최신 기능(주소 자동 추종 등)이 빠졌을 수 있다. 확장 활성화 때 globalStorage 사본이 갱신되므로 Claude Code 에서 /mcp 로 재연결할 것.'
        : '확장이 더 옛 버전이다. VS Code 확장을 업데이트할 것.'),
  };
}
