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
