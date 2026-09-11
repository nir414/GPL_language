import * as assert from 'assert';
import { test } from './harness';
import {
    AI_BLOCKED_COMMANDS,
    AI_BLOCKED_ERROR,
    aiBlockReasonFor,
    aiBlockedDetail,
    findAiBlockedCommand,
} from '../controller/aiCommandPolicy';
import { validateBridgeRequest, AGENT_BRIDGE_VERSION } from '../controller/agentBridge';

// AI 경로 차단(2026-09-07 사용자 결정) — 되돌릴 수 없는 명령만 막고 사람의 UI 경로는 그대로 둔다.

test('aiCommandPolicy: flash 영구 저장이 목록에 있고 사유·대안을 갖췄다', () => {
    const entry = findAiBlockedCommand('gpl.saveToFlash');
    assert.ok(entry, 'gpl.saveToFlash 가 차단 목록에 없음');
    assert.ok(/되돌릴 수 없/.test(entry!.reason), '왜 막는지 설명 누락');
    assert.ok(entry!.humanPath.includes('명령 팔레트'), '사람이 실행할 경로 안내 누락');
});

// 차단 항목의 `title` 은 AI 에게 "사람에게 이 이름으로 부탁하라"고 알려주는 값이다 —
// package.json 의 실제 표시 이름과 어긋나면 사용자가 팔레트에서 찾지 못한다(2026-09-10 §1-DQ).
test('aiCommandPolicy: 차단 항목의 title 이 package.json 표시 이름과 일치한다', () => {
    const pkg = require('../../package.json') as {
        contributes: { commands: { command: string; title: string; category?: string }[] };
    };
    for (const entry of AI_BLOCKED_COMMANDS) {
        const declared = pkg.contributes.commands.find(c => c.command === entry.command);
        assert.ok(declared, `${entry.command} 가 package.json 에 없음`);
        const shown = declared!.category ? `${declared!.category}: ${declared!.title}` : declared!.title;
        assert.strictEqual(entry.title, shown, `${entry.command} 의 title 이 표시 이름과 다름`);
    }
});

test('aiCommandPolicy: 대소문자·공백을 바꾼 표기로 우회되지 않는다', () => {
    assert.ok(findAiBlockedCommand('GPL.SaveToFlash'));
    assert.ok(findAiBlockedCommand('  gpl.savetoflash  '));
});

test('aiCommandPolicy: 나머지 명령은 막지 않는다 (접근 제한이 아니라 예외 목록)', () => {
    for (const ok of ['gpl.deploy', 'gpl.quickCompile', 'gpl.start', 'gpl.ai.debug.getState', '', '  ']) {
        assert.strictEqual(findAiBlockedCommand(ok), undefined, `${ok} 가 잘못 차단됨`);
        assert.strictEqual(aiBlockReasonFor(ok), undefined);
    }
});

test('aiCommandPolicy: 거부 사유가 명령 ID·사유·사람 경로를 모두 담는다', () => {
    const detail = aiBlockedDetail(AI_BLOCKED_COMMANDS[0]);
    assert.ok(detail.includes('gpl.saveToFlash'));
    assert.ok(detail.includes('flash'));
    assert.ok(detail.includes('사용자에게 실행을 요청'));
    assert.strictEqual(AI_BLOCKED_ERROR, 'AI_BLOCKED');
});

// 브리지는 MCP `extension_command` 를 포함한 모든 외부 에이전트가 지나는 지점이다.
test('agentBridge: 차단 명령 요청은 command-blocked 로 거부한다(실행하지 않음)', () => {
    const now = 1_000_000;
    const req = { version: AGENT_BRIDGE_VERSION, id: 'abc', command: 'gpl.saveToFlash', createdAt: now };
    const r = validateBridgeRequest(req, 'abc', now);
    assert.strictEqual(r.ok, false);
    if (!r.ok) {
        assert.strictEqual(r.error, 'command-blocked');
        assert.ok(r.detail.includes('gpl.saveToFlash'));
    }
});

test('agentBridge: 차단 대상이 아닌 명령은 종전대로 통과한다', () => {
    const now = 1_000_000;
    const req = { version: AGENT_BRIDGE_VERSION, id: 'abc', command: 'gpl.deploy', args: { project: 'X' }, createdAt: now };
    const r = validateBridgeRequest(req, 'abc', now);
    assert.strictEqual(r.ok, true);
});
