import * as assert from 'assert';
import { test } from './harness';
import {
    AGENT_OUTPUT_REVEAL_QUIET_MS,
    createRevealGate,
    formatAgentCommandFailure,
    formatAgentCommandLines,
    formatAgentCommandSummary,
} from '../controller/agentCommandLog';

// ─── AI 경유 명령을 Output 에서 보이게 (§1-EO) ───

test('agentCommandLog: 요약 줄은 사람 경로의 [Command] >>> 형식에 (agent)·STATUS·소요 시간을 붙인다', () => {
    assert.strictEqual(
        formatAgentCommandSummary({ command: 'Show Thread', statusCode: 0, durationMs: 84.6 }),
        '[Command] >>> Show Thread (agent) → STATUS 0 · 85 ms',
    );
    assert.strictEqual(
        formatAgentCommandSummary({ command: 'Compile X', statusCode: -1001 }),
        '[Command] >>> Compile X (agent) → STATUS -1001',
        '소요 시간이 없으면 생략',
    );
});

test('agentCommandLog: 응답 본문은 빈 줄을 빼고 들여써 싣는다', () => {
    const lines = formatAgentCommandLines(
        { command: 'Show Thread', raw: '<DATA>\r\nMain Idle\r\n\r\n</DATA>\r\n<STATUS>0</STATUS>\r\n', statusCode: 0 },
        { maxChars: 0 },
    );
    assert.deepStrictEqual(lines, [
        '[Command] >>> Show Thread (agent) → STATUS 0',
        '    <DATA>',
        '    Main Idle',
        '    </DATA>',
        '    <STATUS>0</STATUS>',
    ]);
});

test('agentCommandLog: 상한을 넘는 본문은 줄 경계에서 끊고 생략 요약 한 줄을 남긴다 (GPL Traffic 과 같은 상한 설정)', () => {
    const raw = ['aaaaaaaaaa', 'bbbbbbbbbb', 'cccccccccc', 'dd'].join('\n');
    const lines = formatAgentCommandLines({ command: 'pd 2703', raw, statusCode: 0 }, { maxChars: 25 });
    assert.deepStrictEqual(lines.slice(1), [
        '    aaaaaaaaaa',
        '    bbbbbbbbbb',
        '    … (2줄 12자 생략 — 전체는 GPL Traffic)',
    ]);
    assert.strictEqual(formatAgentCommandLines({ command: 'x', raw: '', statusCode: 0 }, { maxChars: 10 }).length, 1, '빈 응답은 요약만');
});

test('agentCommandLog: 실패도 같은 자리에 — 정책 보류는 "보내지 않음" 을 분명히 한다', () => {
    assert.strictEqual(
        formatAgentCommandFailure('Step Main', 'policy-hold', 'R1: 직전 정지 미확인'),
        '[Command] >>> Step Main (agent) → 정책 보류(제어기에 보내지 않음): R1: 직전 정지 미확인',
    );
    assert.match(formatAgentCommandFailure('Show Thread', 'command-failed', 'ECONNREFUSED'), /전송 실패: ECONNREFUSED$/);
});

test('agentCommandLog: 패널 열기는 조용한 뒤 첫 요청에만 — 연속 폴링은 열지 않는다', () => {
    const due = createRevealGate(1000);
    assert.strictEqual(due(10_000), true, '첫 요청');
    assert.strictEqual(due(10_500), false, '0.5초 뒤 연속 요청');
    assert.strictEqual(due(11_400), false, '마지막 요청 기준으로 잰다(첫 요청 기준이 아님)');
    assert.strictEqual(due(12_400), true, '1초 조용한 뒤');
    assert.ok(AGENT_OUTPUT_REVEAL_QUIET_MS >= 10_000, '기본 조용 구간은 AI 폴링 간격보다 충분히 길어야 한다');
});
