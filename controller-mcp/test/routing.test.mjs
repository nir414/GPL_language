import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  AGENT_BRIDGE_VERSION,
  instanceBridgeDirs,
  instancePresenceDir,
  resolveControllerAddress,
  resolveExtensionInstance,
  assessWindowAddress,
  describeAddressSource,
  describeHostMismatch,
  pickAddressInstance,
  matchWorkspaceInstances,
  workspaceMatchTier,
} from '../src/extensionBridge.js';
import { preSendCauseOf, pickSessionWindow, routeMismatchOf, compareSemver, serverVersionWarning } from '../src/routing.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-routing-test-'));
}

function writeWindow(dir, id, ip, overrides = {}) {
  const rec = {
    version: AGENT_BRIDGE_VERSION,
    extensionInstanceId: id,
    pid: process.pid,
    extensionVersion: '0.27.16',
    ip,
    port: 1402,
    connected: true,
    since: Date.now(),
    heartbeat: Date.now(),
    bridge: { enabled: true, ...instanceBridgeDirs(id, dir) },
    workspaceFolders: [],
    ...overrides,
  };
  fs.mkdirSync(instancePresenceDir(dir), { recursive: true });
  fs.writeFileSync(path.join(instancePresenceDir(dir), `${id}.json`), JSON.stringify(rec));
  return rec;
}

// ── 11-05 #1: 미연결 창 ─────────────────────────────────────────────────────
test('미연결 창: 마지막 IP 가 GPL_HOST 와 다르면 extension-disconnected 로 이름을 붙인다', () => {
  const dir = tmpDir();
  writeWindow(dir, 'w1', '192.168.0.102', { connected: false, workspace: 'Binder' });
  const a = resolveControllerAddress({ configuredHost: '192.168.0.1', mode: 'only', dir });
  assert.deepEqual([a.host, a.via, a.connected, a.configuredHost, a.workspace], ['192.168.0.102', 'sole-instance', false, '192.168.0.1', 'Binder']);
  const w = assessWindowAddress(a);
  assert.equal(w.reason, 'extension-disconnected');
  assert.equal(w.windowIp, '192.168.0.102');
  assert.equal(w.configuredHost, '192.168.0.1');
  assert.equal(w.nextStep, 'VS Code 에서 GPL 연결');
  assert.match(w.detail, /192\.168\.0\.102/);
  assert.match(w.detail, /192\.168\.0\.1 /);
});

test('미연결 창: IP 가 GPL_HOST 와 같거나, 연결됐거나, GPL_HOST 가 없거나, 창을 명시했으면 종전 동작(null)', () => {
  const base = { source: 'extension', via: 'sole-instance', host: '10.0.0.2', port: 1402, connected: false, configuredHost: '10.0.0.2' };
  assert.equal(assessWindowAddress(base), null);                                                      // 같은 IP(대소문자 무시)
  assert.equal(assessWindowAddress({ ...base, configuredHost: '10.0.0.9', connected: true }), null);  // 연결됨
  assert.equal(assessWindowAddress({ ...base, configuredHost: '10.0.0.9', connected: null }), null);  // 모름(옛 presence)
  assert.equal(assessWindowAddress({ ...base, configuredHost: null }), null);                         // 비교 대상 없음
  assert.equal(assessWindowAddress({ ...base, configuredHost: '10.0.0.9', via: 'explicit-instance' }), null);
  assert.equal(assessWindowAddress({ ...base, configuredHost: '10.0.0.9', source: 'configured' }), null);
  assert.notEqual(assessWindowAddress({ ...base, configuredHost: '10.0.0.9' }), null);
});

test('세션 시작 로그 문구: 출처·연결 여부·GPL_HOST', () => {
  const dir = tmpDir();
  writeWindow(dir, 'w1', '192.168.0.102', { connected: false });
  const a = resolveControllerAddress({ configuredHost: '192.168.0.1', mode: 'only', dir });
  assert.equal(describeAddressSource(a), 'source: extension presence/sole-instance, connected:false; GPL_HOST 192.168.0.1');
  assert.equal(describeAddressSource(resolveControllerAddress({ dir: tmpDir() })), 'source: default; GPL_HOST (없음)');
});

// ── 11-10: 연결된 창을 따라간다 ──────────────────────────────────────────────
test('연결된 단일 창이 GPL_HOST 와 다른 IP 여도 GPL_BRIDGE=only 에서 그 창을 따르고 창 해석도 성공한다', () => {
  const dir = tmpDir();
  writeWindow(dir, 'w1', '192.168.0.1', { workspace: 'V2', workspaceFolders: ['c:\\SVN\\trunk\\34. Sample Prep\\V2'] });
  // .mcp.json 은 .102, cwd 는 상위 폴더 — 종전에는 host-mismatch 였다.
  const a = resolveControllerAddress({ configuredHost: '192.168.0.102', mode: 'only', projectDir: 'c:\\SVN\\trunk\\34. Sample Prep', dir });
  assert.deepEqual([a.host, a.source, a.via, a.connected], ['192.168.0.1', 'extension', 'sole-instance', true]);
  assert.equal(assessWindowAddress(a), null);
  const r = resolveExtensionInstance(a.host, { projectDir: 'c:\\SVN\\trunk\\34. Sample Prep', dir });
  assert.equal(r.ok, true);
  assert.equal(r.via, 'workspace-match');   // 상위 폴더 cwd 도 일치로 본다
  // 창이 둘이면 연결된 쪽 → 그래도 둘이면 pin(extensionInstanceId) 으로 고른다.
  writeWindow(dir, 'w2', '192.168.0.101', { workspace: 'Other', workspaceFolders: ['d:\\other'] });
  const pinned = resolveControllerAddress({ configuredHost: '192.168.0.102', mode: 'only', instanceId: 'w2', projectDir: 'c:\\SVN\\trunk\\34. Sample Prep', dir });
  assert.deepEqual([pinned.host, pinned.via, pinned.instanceId], ['192.168.0.101', 'explicit-instance', 'w2']);
  assert.equal(resolveExtensionInstance(undefined, { instanceId: 'w2', dir }).ok, true);   // IP 가 달라도 id 로 해석
  assert.equal(resolveExtensionInstance('192.168.0.1', { instanceId: 'w2', dir }).ok, false);
});

test('작업 폴더 일치는 어느 한쪽이 다른 쪽을 포함하면 성립하고, 더 정확한 쪽이 이긴다', () => {
  assert.equal(workspaceMatchTier('c:\\a\\b\\V2', ['c:\\a\\b\\V2']), 2);
  assert.equal(workspaceMatchTier('c:\\a\\b\\V2\\proj', ['c:\\a\\b\\V2']), 2);
  assert.equal(workspaceMatchTier('c:\\a\\b', ['c:\\a\\b\\V2']), 1);
  assert.equal(workspaceMatchTier('c:\\a\\b', ['c:\\a\\bc']), 0);
  const inst = [
    { extensionInstanceId: 'v1', workspaceFolders: ['c:\\a\\b\\V1'] },
    { extensionInstanceId: 'v2', workspaceFolders: ['c:\\a\\b\\V2'] },
  ];
  assert.deepEqual(matchWorkspaceInstances(inst, 'c:\\a\\b').map((p) => p.extensionInstanceId), ['v1', 'v2']);   // 둘 다 하위 — 모호
  assert.deepEqual(matchWorkspaceInstances(inst, 'c:\\a\\b\\V2\\x').map((p) => p.extensionInstanceId), ['v2']);
  assert.equal(pickAddressInstance(inst.map((p) => ({ ...p, ip: '1.1.1.1', connected: false })), { projectDir: 'c:\\a\\b\\V2' }).instance.extensionInstanceId, 'v2');
  const dir = tmpDir();
  writeWindow(dir, 'v2', '10.0.0.2', { workspaceFolders: ['c:\\a\\b\\V2'] });
  assert.equal(describeHostMismatch('10.0.0.9', { projectDir: 'c:\\a\\b', dir }).extensions[0].workspaceMatch, true);
});

test('보내지 못한 실패의 원인 상태 — host-unreachable 로 적지 않는다', () => {
  assert.equal(preSendCauseOf(null), null);
  assert.equal(preSendCauseOf(new Error('ECONNREFUSED')), null);
  const disc = Object.assign(new Error('x'), { preSendCause: { state: 'extension-disconnected', detail: 'd', nextStep: 'VS Code 에서 GPL 연결' } });
  assert.deepEqual(preSendCauseOf(disc), { state: 'extension-disconnected', detail: 'd', nextStep: 'VS Code 에서 GPL 연결' });
  const mm = Object.assign(new Error('only'), { bridgeReason: 'host-mismatch', sendOutcome: 'not-sent' });
  assert.equal(preSendCauseOf(mm).state, 'bridge-host-mismatch');
  assert.match(preSendCauseOf(mm).nextStep, /extension_resolve/);
  const mm2 = Object.assign(new Error('x'), { hostMismatch: { mcp: 'a', extensions: [] }, sendOutcome: 'not-sent' });
  assert.equal(preSendCauseOf(mm2).state, 'bridge-host-mismatch');
});

// ── 11-11: 런타임 콘솔 경로 ──────────────────────────────────────────────────
test('세션 대상의 창 고르기: 작업 폴더가 겹치는 창, 연결된 창 우선', () => {
  const binder = { extensionInstanceId: 'binder', ip: '192.168.0.101', connected: true, since: 2, workspace: 'Binder', workspaceFolders: ['C:\\SVN\\V1\\Binder'] };
  const antibody = { extensionInstanceId: 'antibody', ip: '192.168.0.102', connected: true, since: 1, workspace: 'Antibody', workspaceFolders: ['C:\\SVN\\V1\\Antibody'] };
  const w = pickSessionWindow([antibody, binder], 'C:\\SVN\\V1\\Binder\\projects\\MergeCode');
  assert.deepEqual([w.instance.extensionInstanceId, w.via], ['binder', 'workspace-match']);
  assert.equal(pickSessionWindow([antibody, binder], 'D:\\none'), null);
  const idle = { ...binder, connected: false, since: 0 };
  assert.equal(pickSessionWindow([idle, { ...binder, extensionInstanceId: 'b2', connected: true }], 'C:\\SVN\\V1\\Binder').instance.extensionInstanceId, 'b2');
});

test('routeMismatch: 세션 대상과 다른 창을 읽었을 때만 돌려준다', () => {
  const target = { project: 'MergeCode', dir: 'C:\\SVN\\V1\\Binder\\projects\\MergeCode' };
  const antibody = { extensionInstanceId: 'antibody', ip: '192.168.0.102', connected: true, workspace: 'Antibody', workspaceFolders: ['C:\\SVN\\V1\\Antibody'] };
  const binder = { extensionInstanceId: 'binder', ip: '192.168.0.101', connected: true, workspace: 'Binder', workspaceFolders: ['C:\\SVN\\V1\\Binder'] };
  const m = routeMismatchOf({ sessionTarget: target, readInstance: antibody });
  assert.equal(m.sessionTarget.project, 'MergeCode');
  assert.deepEqual([m.readFrom.workspace, m.readFrom.ip], ['Antibody', '192.168.0.102']);
  assert.equal(routeMismatchOf({ sessionTarget: target, readInstance: binder }), null);
  assert.equal(routeMismatchOf({ sessionTarget: null, readInstance: antibody }), null);
  assert.equal(routeMismatchOf({ sessionTarget: { project: 'x', dir: null }, readInstance: antibody }), null);
  assert.equal(routeMismatchOf({ sessionTarget: target, readInstance: null }), null);
});

// ── 11-10 #2: 버전 ──────────────────────────────────────────────────────────
test('semver 비교와 서버·확장 버전 경고', () => {
  assert.equal(compareSemver('0.27.16', '0.18.1'), 1);
  assert.equal(compareSemver('0.18.1', '0.27.16'), -1);
  assert.equal(compareSemver('0.27.16', 'v0.27.16'), 0);
  assert.equal(compareSemver('dev', '0.1.0'), null);
  assert.equal(serverVersionWarning('0.27.16', '0.27.16'), null);
  assert.equal(serverVersionWarning('dev', '0.27.16'), null);
  assert.equal(serverVersionWarning('0.27.16', undefined), null);
  const w = serverVersionWarning('0.18.1', '0.27.16');
  assert.equal(w.relation, 'server-older');
  assert.match(w.detail, /\/mcp/);
  assert.equal(serverVersionWarning('0.28.0', '0.27.16').relation, 'server-newer');
});
