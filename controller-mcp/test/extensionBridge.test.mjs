// Agent Bridge 클라이언트 단위 테스트 — 확장 없이 파일 계약만으로 검증한다.
// 실행: npm test (node --test)

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  AGENT_BRIDGE_VERSION,
  readExtensionPresence,
  presenceFilePath,
  bridgeDirs,
  sanitizeIpForPath,
  makeRequestId,
  callExtensionCommand,
  isRetrySafeCommand,
  bridgeUnavailableHint,
  resolveBridge,
  listExtensionInstances,
  resolveExtensionInstance,
  instanceBridgeDirs,
  instancePresenceDir,
  takeLateResponse,
  pickConsoleRouteInstance,
  describeHostMismatch,
  hostMismatchFix,
  bridgeHealthSummary,
  describeBridgeFailure,
} from '../src/extensionBridge.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-bridge-test-'));
}

function writePresence(dir, ip, overrides = {}) {
  const rec = {
    version: AGENT_BRIDGE_VERSION,
    pid: process.pid,
    extensionVersion: '0.8.20',
    ip,
    port: 1402,
    connected: true,
    debugSessionActive: false,
    since: Date.now(),
    heartbeat: Date.now(),
    bridge: { enabled: true, ...bridgeDirs(ip, dir) },
    ...overrides,
  };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(presenceFilePath(ip, dir), JSON.stringify(rec));
  return rec;
}

test('경로: ip를 파일명 안전 문자로 바꾸고 presence/req/res 경로를 만든다', () => {
  assert.equal(sanitizeIpForPath('192.168.0.1'), '192.168.0.1');
  assert.equal(sanitizeIpForPath('a/b:c'), 'a_b_c');
  assert.equal(sanitizeIpForPath(''), 'default');
  const d = bridgeDirs('192.168.0.1', '/tmp/x');
  assert.ok(d.reqDir.endsWith(path.join('bridge', '192.168.0.1', 'req')));
  assert.ok(d.resDir.endsWith(path.join('bridge', '192.168.0.1', 'res')));
});

test('presence: 없음/버전 불일치/stale/죽은 pid/브리지 꺼짐을 각각 구분한다', () => {
  const dir = tmpDir();
  const ip = '10.0.0.5';
  assert.equal(readExtensionPresence(ip, { dir }).reason, 'presence-missing');

  writePresence(dir, ip, { version: 99 });
  assert.equal(readExtensionPresence(ip, { dir }).reason, 'presence-version');

  writePresence(dir, ip, { heartbeat: Date.now() - 60_000 });
  assert.equal(readExtensionPresence(ip, { dir }).reason, 'presence-stale');

  writePresence(dir, ip, { pid: 999_999 });
  assert.equal(readExtensionPresence(ip, { dir, pidAlive: () => false }).reason, 'presence-dead-pid');

  writePresence(dir, ip, { bridge: { enabled: false, ...bridgeDirs(ip, dir) } });
  assert.equal(readExtensionPresence(ip, { dir }).reason, 'bridge-disabled');

  writePresence(dir, ip);
  const ok = readExtensionPresence(ip, { dir });
  assert.equal(ok.reason, null);
  assert.equal(ok.presence.extensionVersion, '0.8.20');
});

test('presence: 손상된 JSON은 읽기 실패로 처리한다(브리지 없음으로 폴백)', () => {
  const dir = tmpDir();
  const ip = '10.0.0.6';
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(presenceFilePath(ip, dir), '{broken');
  assert.equal(readExtensionPresence(ip, { dir }).reason, 'presence-unreadable');
});

test('presence: 브리지 큐 상태를 고정 모양으로 요약한다', () => {
  assert.deepEqual(bridgeHealthSummary({ bridge: { busy: true, pendingRequests: 2, bridgeStalled: true,
    activeRequest: { id: 'a', command: 'gpl.quickCompile', startedAt: 10 }, lastRequestCollectedAt: 10 } }), {
    busy: true,
    activeRequest: { id: 'a', command: 'gpl.quickCompile', startedAt: 10 },
    lastRequestCollectedAt: 10,
    lastResponseWrittenAt: null,
    pendingRequests: 2,
    oldestPendingRequestAt: null,
    oldestPendingRequestAgeMs: null,
    bridgeStalled: true,
  });
  assert.equal(bridgeHealthSummary({ bridge: { enabled: true } }).bridgeStalled, false);
});

test('브리지 실패 설명: 필드가 빠져도 undefined 문구를 만들지 않는다', () => {
  assert.deepEqual(describeBridgeFailure(undefined), {
    error: 'unexpected-bridge-response',
    detail: '브리지 응답에 실패 상세가 없습니다.',
  });
  assert.deepEqual(describeBridgeFailure({ ok: true, result: { ok: false, error: 'E', detail: 'D' } }), { error: 'E', detail: 'D' });
});

test('요청 id는 파일명으로 안전한 문자만 쓴다', () => {
  for (let i = 0; i < 5; i++) {
    assert.match(makeRequestId(), /^[A-Za-z0-9._-]{1,128}$/);
  }
  assert.notEqual(makeRequestId(), makeRequestId());
});

test('call: 요청 파일을 쓰고, 응답 파일이 생기면 읽어 지운다', async () => {
  const dir = tmpDir();
  const ip = '10.0.0.7';
  const { reqDir, resDir } = bridgeDirs(ip, dir);
  fs.mkdirSync(reqDir, { recursive: true });
  fs.mkdirSync(resDir, { recursive: true });

  // 가짜 확장: 요청이 보이면 응답을 쓴다.
  const timer = setInterval(() => {
    for (const name of fs.readdirSync(reqDir)) {
      const req = JSON.parse(fs.readFileSync(path.join(reqDir, name), 'utf8'));
      fs.unlinkSync(path.join(reqDir, name));
      fs.writeFileSync(path.join(resDir, name), JSON.stringify({
        version: AGENT_BRIDGE_VERSION, id: req.id, ok: true,
        result: { ok: true, command: req.args.command, raw: '<STATUS>0</STATUS>' },
        startedAt: Date.now(), finishedAt: Date.now(),
      }));
    }
  }, 10);
  try {
    const res = await callExtensionCommand(ip, 'gpl.controller.sendCommand', { command: 'Show Thread' }, { dir, timeoutMs: 3000, pollMs: 10 });
    assert.equal(res.ok, true);
    assert.equal(res.result.raw, '<STATUS>0</STATUS>');
    assert.equal(fs.readdirSync(resDir).length, 0, '응답 파일은 읽은 뒤 지워진다');
    assert.equal(fs.readdirSync(reqDir).length, 0);
  } finally {
    clearInterval(timer);
  }
});

test('call: 응답이 없으면 타임아웃 + 요청 파일을 치운다(뒤늦은 실행 방지)', async () => {
  const dir = tmpDir();
  const ip = '10.0.0.8';
  const res = await callExtensionCommand(ip, 'gpl.ai.debug.getState', undefined, { dir, timeoutMs: 120, pollMs: 20 });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'bridge-timeout');
  assert.equal(fs.readdirSync(bridgeDirs(ip, dir).reqDir).length, 0);
});

test('call: gpl.* 밖의 명령은 요청을 만들지 않는다', async () => {
  const dir = tmpDir();
  const res = await callExtensionCommand('10.0.0.9', 'workbench.action.terminal.sendSequence', {}, { dir, timeoutMs: 100 });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'unsupported-command');
});

test('resolveBridge: off 모드는 확장이 있어도 직접 접속, auto 는 presence 를 따른다', async () => {
  const dir = tmpDir();
  const ip = '10.0.0.10';
  writePresence(dir, ip);
  assert.equal((await resolveBridge(ip, { dir, mode: 'off' })).available, false);
  assert.equal((await resolveBridge(ip, { dir, mode: 'auto', wake: false })).available, true);
});

test('resolveBridge: presence 가 없고 wake 를 끄면 깨우지 않고 사유를 돌려준다', async () => {
  const dir = tmpDir();
  const r = await resolveBridge('10.0.0.11', { dir, mode: 'auto', wake: false });
  assert.equal(r.available, false);
  assert.equal(r.reason, 'presence-missing');
});

test('재전송 안전 판정: 조회는 안전, 상태 변경/-clear 는 아님', () => {
  for (const c of ['Show Thread  -web', 'ErrorLog', 'Directory /flash/projects', 'pd 2703', 'Memory']) {
    assert.equal(isRetrySafeCommand(c), true, c);
  }
  for (const c of ['Step MainThread -over', 'Continue Main', 'Start MergeCode', 'Compile X', 'Stop -all', 'ErrorLog -clear', 'Set Break X "f"10']) {
    assert.equal(isRetrySafeCommand(c), false, c);
  }
});

test('힌트: 사유마다 "무엇을 하면 되는지"를 알려 준다(점유 결론 금지)', () => {
  assert.match(bridgeUnavailableHint('presence-missing'), /확장/);
  assert.match(bridgeUnavailableHint('bridge-disabled'), /gpl\.agentBridge\.enabled/);
  assert.match(bridgeUnavailableHint('bridge-off'), /GPL_BRIDGE/);
});

// ── 인스턴스 분리(2026-09-10 개선안 §4·§5·§6) ─────────────────────────────

function writeInstancePresence(dir, ip, instanceId, overrides = {}) {
  const rec = {
    version: AGENT_BRIDGE_VERSION,
    extensionInstanceId: instanceId,
    pid: process.pid,
    extensionVersion: '0.9.4',
    ip,
    port: 1402,
    connected: true,
    debugSessionActive: false,
    since: Date.now(),
    heartbeat: Date.now(),
    bridge: { enabled: true, ...instanceBridgeDirs(instanceId, dir) },
    workspaceFolders: [],
    ...overrides,
  };
  fs.mkdirSync(instancePresenceDir(dir), { recursive: true });
  fs.writeFileSync(path.join(instancePresenceDir(dir), `${instanceId}.json`), JSON.stringify(rec));
  return rec;
}

test('인스턴스 목록: 살아 있는 것만, ip 로 거르고 리더를 계산한다', () => {
  const dir = tmpDir();
  const ip = '10.0.0.20';
  writeInstancePresence(dir, ip, 'first', { since: 1000, heartbeat: Date.now() });
  writeInstancePresence(dir, ip, 'second', { since: 2000, heartbeat: Date.now() });
  writeInstancePresence(dir, '10.0.0.99', 'other');
  writeInstancePresence(dir, ip, 'dead', { heartbeat: Date.now() - 60_000 });

  const list = listExtensionInstances(ip, { dir });
  assert.deepEqual(list.map((p) => p.extensionInstanceId), ['first', 'second']);
  assert.equal(list.find((p) => p.extensionInstanceId === 'first').leader, true);
  assert.equal(list.find((p) => p.extensionInstanceId === 'second').leader, false);
  // ip 를 주지 않으면 다른 제어기를 보는 창까지 나온다.
  assert.equal(listExtensionInstances(undefined, { dir }).length, 3);
});

test('인스턴스 선택: projectDir 로 워크스페이스를 특정하고, 애매하면 임의로 고르지 않는다(§6)', () => {
  const dir = tmpDir();
  const ip = '10.0.0.21';
  writeInstancePresence(dir, ip, 'antibody', { workspaceFolders: ['C:\\SVN\\pa\\Antibody'] });
  writeInstancePresence(dir, ip, 'binder', { workspaceFolders: ['C:\\SVN\\pa\\Binder'] });

  const hit = resolveExtensionInstance(ip, { dir, projectDir: 'C:\\SVN\\pa\\Binder\\projects\\MergeCode' });
  assert.equal(hit.ok, true);
  assert.equal(hit.instance.extensionInstanceId, 'binder');
  assert.equal(hit.via, 'workspace-match');

  // 같은 이름의 프로젝트가 두 워크스페이스에 있어도 폴더가 다르면 창이 갈린다.
  const other = resolveExtensionInstance(ip, { dir, projectDir: 'C:/SVN/pa/Antibody/projects/MergeCode' });
  assert.equal(other.instance.extensionInstanceId, 'antibody');

  // 근거가 없으면 애매하다고 답한다 — 먼저 집는 창에 맡기지 않는다.
  const amb = resolveExtensionInstance(ip, { dir });
  assert.equal(amb.ok, false);
  assert.equal(amb.error, 'EXTENSION_AMBIGUOUS');
  assert.equal(amb.candidates.length, 2);

  // 명시 지정은 최우선. 살아 있지 않은 id 는 NOT_FOUND.
  assert.equal(resolveExtensionInstance(ip, { dir, instanceId: 'binder' }).ok, true);
  assert.equal(resolveExtensionInstance(ip, { dir, instanceId: 'ghost' }).error, 'EXTENSION_NOT_FOUND');
});

test('인스턴스 선택: 후보가 둘이면 제어기에 연결된 창으로 좁힌다', () => {
  const dir = tmpDir();
  const ip = '10.0.0.22';
  writeInstancePresence(dir, ip, 'idle', { connected: false });
  writeInstancePresence(dir, ip, 'live', { connected: true });
  const r = resolveExtensionInstance(ip, { dir });
  assert.equal(r.ok, true);
  assert.equal(r.instance.extensionInstanceId, 'live');
  assert.equal(r.via, 'connected');
});

test('요청 라우팅: instanceId 를 주면 그 창의 큐에만 쓴다', async () => {
  const dir = tmpDir();
  const ip = '10.0.0.23';
  const call = callExtensionCommand(ip, 'gpl.deploy', {}, { dir, instanceId: 'win-a', timeoutMs: 300, pollMs: 10 });
  // 요청이 인스턴스 큐에 생겼는지 — 레거시 큐는 비어 있어야 한다.
  await new Promise((r) => setTimeout(r, 60));
  const instReq = fs.readdirSync(instanceBridgeDirs('win-a', dir).reqDir);
  assert.equal(instReq.length, 1);
  const legacyReq = bridgeDirs(ip, dir).reqDir;
  const legacyCount = fs.existsSync(legacyReq) ? fs.readdirSync(legacyReq).length : 0;
  assert.equal(legacyCount, 0, '레거시 큐로는 새지 않아야 한다');
  const res = await call;
  assert.equal(res.error, 'bridge-timeout');
  assert.equal(res.instanceId, 'win-a');
  assert.ok(res.requestId, '타임아웃에도 requestId 를 돌려줘야 나중에 결과를 회수할 수 있다');
});

test('타임아웃 뒤 도착한 응답은 requestId 로 회수한다(§11 — 재실행 금지)', async () => {
  const dir = tmpDir();
  const ip = '10.0.0.24';
  const { reqDir, resDir } = instanceBridgeDirs('win-b', dir);
  fs.mkdirSync(reqDir, { recursive: true });
  const res = await callExtensionCommand(ip, 'gpl.deploy', {}, { dir, instanceId: 'win-b', requestId: 'req-1', timeoutMs: 120, pollMs: 10 });
  assert.equal(res.error, 'bridge-timeout');
  assert.equal(res.requestId, 'req-1');
  // 확장이 뒤늦게 결과를 쓴 상황.
  fs.mkdirSync(resDir, { recursive: true });
  fs.writeFileSync(path.join(resDir, 'req-1.json'), JSON.stringify({ version: AGENT_BRIDGE_VERSION, id: 'req-1', ok: true, result: { success: true } }));
  const late = takeLateResponse(ip, 'req-1', { dir, instanceId: 'win-b' });
  assert.equal(late.ok, true);
  assert.equal(late.result.success, true);
  // 한 번 회수하면 사라진다.
  assert.equal(takeLateResponse(ip, 'req-1', { dir, instanceId: 'win-b' }), null);
});

test('resolveBridge: 인스턴스 presence 가 있고 모두 연결돼 있으면 리더를 기본 경로로 쓴다(레거시는 폴백)', async () => {
  const dir = tmpDir();
  const ip = '10.0.0.25';
  writeInstancePresence(dir, ip, 'late', { since: 5000 });
  writeInstancePresence(dir, ip, 'early', { since: 1000 });
  const r = await resolveBridge(ip, { dir, mode: 'auto', wake: false });
  assert.equal(r.available, true);
  assert.equal(r.presence.extensionInstanceId, 'early');
  assert.equal(r.routeVia, 'connected');
  assert.equal(r.instances.length, 2);
  assert.notEqual(r.legacy, true);

  // 구버전 확장(인스턴스 presence 없음)은 레거시 presence 로 계속 동작한다.
  const dir2 = tmpDir();
  writePresence(dir2, ip);
  const legacy = await resolveBridge(ip, { dir: dir2, mode: 'auto', wake: false });
  assert.equal(legacy.available, true);
  assert.equal(legacy.legacy, true);
});

// ── 콘솔 경로: 리더가 아니라 연결된 창(2026-10-14, §1-EK) ──────────────────

test('콘솔 경로: 리더가 미접속이고 다른 창이 연결돼 있으면 연결된 창으로 보낸다', () => {
  const leaderIdle = { extensionInstanceId: 'leader-idle', since: 1000, connected: false, leader: true };
  const liveLate = { extensionInstanceId: 'live-late', since: 2000, connected: true, leader: false };
  const r = pickConsoleRouteInstance([leaderIdle, liveLate]);
  assert.equal(r.instance.extensionInstanceId, 'live-late');
  assert.equal(r.via, 'connected');
});

test('콘솔 경로: 명시 instanceId 가 최우선이고, 살아 있지 않으면 일반 규칙으로 돌아간다', () => {
  const a = { extensionInstanceId: 'a', since: 1000, connected: false, leader: true };
  const b = { extensionInstanceId: 'b', since: 2000, connected: true, leader: false };
  assert.equal(pickConsoleRouteInstance([a, b], { instanceId: 'a' }).via, 'explicit-instance');
  assert.equal(pickConsoleRouteInstance([a, b], { instanceId: 'a' }).instance.extensionInstanceId, 'a');
  const ghost = pickConsoleRouteInstance([a, b], { instanceId: 'ghost' });
  assert.equal(ghost.instance.extensionInstanceId, 'b');
  assert.equal(ghost.via, 'connected');
});

test('콘솔 경로: 연결된 창이 없으면 리더, 창이 하나면 그 창(sole)', () => {
  const a = { extensionInstanceId: 'a', since: 1000, connected: false, leader: true };
  const b = { extensionInstanceId: 'b', since: 2000, connected: false, leader: false };
  const r = pickConsoleRouteInstance([a, b]);
  assert.equal(r.instance.extensionInstanceId, 'a');
  assert.equal(r.via, 'leader');
  const sole = pickConsoleRouteInstance([{ extensionInstanceId: 'only', since: 1, connected: false, leader: false }]);
  assert.equal(sole.via, 'sole-instance');
  assert.equal(pickConsoleRouteInstance([]), null);
});

test('콘솔 경로: 연결된 창이 여럿(stale presence 등)이면 그중 리더, 리더가 없으면 가장 먼저 뜬 것', () => {
  const x = { extensionInstanceId: 'x', since: 3000, connected: true, leader: false };
  const y = { extensionInstanceId: 'y', since: 2000, connected: true, leader: false };
  const z = { extensionInstanceId: 'z', since: 1000, connected: false, leader: true };
  assert.equal(pickConsoleRouteInstance([x, y, z]).instance.extensionInstanceId, 'y');
  const yLeader = { ...y, leader: true };
  assert.equal(pickConsoleRouteInstance([x, yLeader]).instance.extensionInstanceId, 'y');
});

test('resolveBridge: 리더 창이 미접속이면 presence 파일 기준으로도 연결된 창이 기본 경로다(§1-EK 실측 재현)', async () => {
  const dir = tmpDir();
  const ip = '10.0.0.26';
  // 34. Sample Prep 창 = 먼저 떠서 리더, 제어기 미접속 / GPL_language 창 = 나중에 떠서 접속 중.
  writeInstancePresence(dir, ip, 'sample-prep', { since: 1000, connected: false });
  writeInstancePresence(dir, ip, 'gpl-language', { since: 2000, connected: true });
  const r = await resolveBridge(ip, { dir, mode: 'auto', wake: false });
  assert.equal(r.available, true);
  assert.equal(r.presence.extensionInstanceId, 'gpl-language');
  assert.equal(r.routeVia, 'connected');
  // 리더 계산 자체는 종전대로(레거시 큐 담당) — 콘솔 경로와 분리돼 있다.
  assert.equal(r.instances.find((p) => p.extensionInstanceId === 'sample-prep').leader, true);
  // 명시 instanceId 는 그대로 존중한다.
  const explicit = await resolveBridge(ip, { dir, mode: 'auto', wake: false, instanceId: 'sample-prep' });
  assert.equal(explicit.presence.extensionInstanceId, 'sample-prep');
  assert.equal(explicit.routeVia, 'explicit-instance');
});

// ── 주소 불일치: 확장은 다른 IP 에 떠 있는데 GPL_HOST 가 옛 값(2026-10-19, §1-ES) ──────────

test('주소 불일치: 다른 IP 의 살아 있는 창을 찾고 projectDir 로 같은 작업의 창을 표시한다', () => {
  const dir = tmpDir();
  const projectDir = path.join(dir, 'ws', 'projects', 'MergeCode');
  writeInstancePresence(dir, '192.168.0.102', 'sample-prep', { workspace: '34. Sample Prep', workspaceFolders: [path.join(dir, 'ws')] });
  writeInstancePresence(dir, '10.0.0.99', 'other-robot', { workspaceFolders: [path.join(dir, 'elsewhere')] });
  const hm = describeHostMismatch('192.168.0.1', { dir, projectDir });
  assert.equal(hm.mcp, '192.168.0.1');
  assert.deepEqual(hm.extensions.map((e) => e.ip).sort(), ['10.0.0.99', '192.168.0.102']);
  assert.equal(hm.extensions.find((e) => e.ip === '192.168.0.102').workspaceMatch, true);
  assert.equal(hm.extensions.find((e) => e.ip === '10.0.0.99').workspaceMatch, false);
  assert.equal(hm.workspaceMatched, true);
  // 같은 IP 만 떠 있으면 불일치가 아니다.
  const dir2 = tmpDir();
  writeInstancePresence(dir2, '192.168.0.1', 'same');
  assert.equal(describeHostMismatch('192.168.0.1', { dir: dir2 }), null);
  // 조치 문구에는 두 IP 와 고칠 곳(.mcp.json GPL_HOST)이 이름으로 들어간다.
  const fix = hostMismatchFix(hm);
  assert.match(fix, /192\.168\.0\.102/);
  assert.match(fix, /192\.168\.0\.1 /);
  assert.match(fix, /GPL_HOST/);
  assert.match(fix, /확장 미실행이 아니/);
  assert.match(bridgeUnavailableHint('host-mismatch'), /GPL_HOST/);
});

test('resolveBridge: 확장이 다른 IP 에 떠 있으면 presence-missing 이 아니라 host-mismatch 다(§1-ES 재현)', async () => {
  const dir = tmpDir();
  const projectDir = path.join(dir, 'ws', 'projects', 'MergeCode');
  writeInstancePresence(dir, '192.168.0.102', 'sample-prep', { workspaceFolders: [path.join(dir, 'ws')] });
  const r = await resolveBridge('192.168.0.1', { dir, mode: 'auto', wake: false, projectDir });
  assert.equal(r.available, false);
  assert.equal(r.reason, 'host-mismatch');
  assert.equal(r.hostMismatch.extensions[0].ip, '192.168.0.102');
  assert.equal(r.hostMismatch.extensions[0].workspaceMatch, true);
  assert.equal(r.instances.length, 0);
});

test('resolveBridge: 같은 작업의 창이 다른 IP 에 살아 있으면 wake 를 시도하지 않는다(깨워도 IP 는 안 바뀐다)', async () => {
  const dir = tmpDir();
  const projectDir = path.join(dir, 'ws', 'projects', 'MergeCode');
  const prevCli = process.env.GPL_VSCODE_CLI;
  process.env.GPL_VSCODE_CLI = 'gpl-no-such-cli-for-test';   // 실제 code 를 띄우지 않게 — 호출되면 wakeError 가 남는다
  try {
    writeInstancePresence(dir, '192.168.0.102', 'sample-prep', { workspaceFolders: [path.join(dir, 'ws')] });
    const skipped = await resolveBridge('192.168.0.1', { dir, mode: 'auto', wake: true, wakeWaitMs: 50, projectDir });
    assert.equal(skipped.reason, 'host-mismatch');
    assert.equal(skipped.wakeError, undefined);
    // 같은 작업인지 모르면(projectDir 없음) 종전처럼 깨우기를 시도하되, 사유는 그대로 host-mismatch 다.
    const tried = await resolveBridge('192.168.0.1', { dir, mode: 'auto', wake: true, wakeWaitMs: 50 });
    assert.equal(tried.reason, 'host-mismatch');
    assert.equal(typeof tried.wakeError, 'string');
  } finally {
    if (prevCli === undefined) delete process.env.GPL_VSCODE_CLI; else process.env.GPL_VSCODE_CLI = prevCli;
  }
});

test('인스턴스 선택: 이 IP 의 창이 없고 다른 IP 의 창만 있으면 EXTENSION_HOST_MISMATCH 와 후보 IP 를 돌려준다', () => {
  const dir = tmpDir();
  const projectDir = path.join(dir, 'ws', 'projects', 'MergeCode');
  writeInstancePresence(dir, '192.168.0.102', 'sample-prep', { workspaceFolders: [path.join(dir, 'ws')] });
  const r = resolveExtensionInstance('192.168.0.1', { dir, projectDir });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'EXTENSION_HOST_MISMATCH');
  assert.equal(r.candidates[0].ip, '192.168.0.102');
  assert.equal(r.candidates[0].workspaceMatch, true);
  assert.match(r.detail, /192\.168\.0\.102/);
  // 아무 창도 없으면 종전대로 EXTENSION_NOT_FOUND.
  const none = resolveExtensionInstance('192.168.0.1', { dir: tmpDir(), projectDir });
  assert.equal(none.error, 'EXTENSION_NOT_FOUND');
});
