import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AI_BLOCKED_COMMANDS, AI_BLOCKED_ERROR, findAiBlockedCommand, aiBlockedDetail, aiBlockedResult } from '../src/aiPolicy.js';
import { SERVER_INSTRUCTIONS } from '../src/guidelines.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

test('flash 영구 저장은 AI 차단 목록에 있다', () => {
  const entry = findAiBlockedCommand('gpl.saveToFlash');
  assert.ok(entry, 'gpl.saveToFlash 가 목록에 없음');
  assert.equal(entry.title, 'GPL: Save to Flash');
  assert.match(entry.reason, /되돌릴 수 없|flash/);
  assert.ok(entry.humanPath.length > 0, '사람이 실행할 경로 안내 누락');
});

test('표기를 바꿔도(대소문자·공백) 우회되지 않는다', () => {
  assert.ok(findAiBlockedCommand('GPL.SaveToFlash'));
  assert.ok(findAiBlockedCommand('  gpl.savetoflash  '));
});

test('차단 대상이 아닌 명령은 통과한다', () => {
  for (const ok of ['gpl.deploy', 'gpl.quickCompile', 'gpl.start', 'gpl.ai.debug.getState', '']) {
    assert.equal(findAiBlockedCommand(ok), undefined, `${ok} 가 잘못 차단됨`);
  }
});

test('차단 결과는 전송하지 않았음(sent:false)과 사유·대안을 함께 준다', () => {
  const res = aiBlockedResult('gpl.saveToFlash');
  assert.equal(res.ok, false);
  assert.equal(res.sent, false, '제어기/확장에 보내지 않았음을 명시해야 한다');
  assert.equal(res.error, AI_BLOCKED_ERROR);
  assert.match(res.detail, /gpl\.saveToFlash/);
  assert.match(res.recommendedAction, /재시도하지 않는다/);
  assert.equal(aiBlockedResult('gpl.deploy'), null);
});

test('거부 사유는 재시도·우회를 막는 문구를 포함한다', () => {
  const detail = aiBlockedDetail(AI_BLOCKED_COMMANDS[0]);
  assert.match(detail, /사용자에게 실행을 요청/);
  assert.match(detail, /우회 경로로 재시도하지 마세요/);
});

test('서버 instructions 가 flash 저장 금지를 알린다 (도구 호출 전에 읽히는 경로)', () => {
  assert.match(SERVER_INSTRUCTIONS, /gpl\.saveToFlash/);
  assert.match(SERVER_INSTRUCTIONS, /AI_BLOCKED/);
});

// 확장(src/controller/aiCommandPolicy.ts)과 이 파일은 같은 목록을 들고 있어야 한다 —
// 한쪽만 늘리면 "MCP 는 막는데 URI 는 뚫리는" 구멍이 생긴다.
test('확장 쪽 차단 목록과 명령 ID 가 일치한다', () => {
  const src = fs.readFileSync(path.join(REPO, 'src', 'controller', 'aiCommandPolicy.ts'), 'utf8');
  const ids = [...src.matchAll(/command:\s*'([^']+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(AI_BLOCKED_COMMANDS.map((c) => c.command).sort(), ids);
});
