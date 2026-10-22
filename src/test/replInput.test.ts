import * as assert from 'assert';
import { test } from './harness';
import {
    formatBlockedReplInput,
    formatReplBatchResults,
    parseReplInput,
} from '../debug/replInput';

test('repl input: 여러 줄과 CRLF를 빈 줄 없이 원래 순서로 나눈다', () => {
    assert.deepStrictEqual(parseReplInput(' Show Thread -web\r\n\r\n> Stop -all\n  count  '), [
        { source: 'Show Thread -web', expression: 'Show Thread -web', forceRaw: false },
        { source: '> Stop -all', expression: 'Stop -all', forceRaw: true },
        { source: 'count', expression: 'count', forceRaw: false },
    ]);
});

test('repl input: 상태 변경 명령을 보내지 않았음을 변수 실패보다 먼저 알린다', () => {
    assert.strictEqual(
        formatBlockedReplInput('Break Worker', 'Worker: -729 Undefined symbol'),
        [
            "이 입력을 제어기 명령으로 보내지 않았습니다 — 'Break'는 상태 변경 명령으로 인식했습니다.",
            "전송하려면 '>Break Worker'처럼 '>' 접두사를 사용하세요.",
        ].join('\n'),
    );
});

test('repl input: 미분류 입력은 평가 실패와 미전송 사실을 함께 표시한다', () => {
    assert.strictEqual(
        formatBlockedReplInput('unknownThing', 'unknownThing: -729 Undefined symbol'),
        [
            'unknownThing: -729 Undefined symbol',
            "이 입력을 제어기 명령으로 보내지 않았습니다. 임의 명령으로 전송하려면 '>' 접두사를 사용하세요.",
        ].join('\n'),
    );
});

test('repl input: 여러 줄 결과를 입력별로 구분하고 응답 줄을 들여쓴다', () => {
    assert.strictEqual(formatReplBatchResults([
        {
            entry: { source: 'Show Thread -web', expression: 'Show Thread -web', forceRaw: false },
            result: 'A,Running\nB,Idle',
        },
        {
            entry: { source: '> Stop -all', expression: 'Stop -all', forceRaw: true },
            result: '0,"Success"',
        },
    ]), [
        'Show Thread -web',
        '  A,Running',
        '  B,Idle',
        '',
        '> Stop -all',
        '  0,"Success"',
    ].join('\n'));
});
