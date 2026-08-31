import * as assert from 'assert';
import { test } from './harness';
import { analyzeBlockContext, GplBlockContext } from '../language/blockContext';

/**
 * blockContext(커서 위치의 열린 블록 스택) 회귀 테스트.
 *
 * 문 스니펫의 스코프 필터가 이 분석에 전적으로 의존한다. 프로시저 밖을 프로시저로
 * 착각하면 `Sub` 제안이 사라지고, 한 줄 If를 블록으로 세면 스택이 어긋난다.
 */

/** 소스 문자열의 마지막 줄(입력 중인 줄) 위치로 컨텍스트를 계산한다. */
function contextAtEnd(source: string): GplBlockContext {
    const lines = source.split('\n');
    return analyzeBlockContext(i => lines[i], lines.length, lines.length - 1);
}

test('blockContext: 파일 최상위는 file 스코프', () => {
    const ctx = contextAtEnd(["' 주석만 있는 파일", ''].join('\n'));
    assert.strictEqual(ctx.scope, 'file');
    assert.deepStrictEqual(ctx.openBlocks, []);
});

test('blockContext: Module 본문은 type 스코프', () => {
    const ctx = contextAtEnd(['Module Main', '    '].join('\n'));
    assert.strictEqual(ctx.scope, 'type');
    assert.deepStrictEqual(ctx.openBlocks, ['module']);
});

test('blockContext: Sub 본문은 procedure 스코프', () => {
    const ctx = contextAtEnd([
        'Module Main',
        '    Public Sub Run()',
        '        '
    ].join('\n'));
    assert.strictEqual(ctx.scope, 'procedure');
    assert.strictEqual(ctx.procedureKind, 'sub');
    assert.deepStrictEqual(ctx.openBlocks, ['module', 'sub']);
});

test('blockContext: End Sub 뒤는 다시 type 스코프', () => {
    const ctx = contextAtEnd([
        'Module Main',
        '    Public Sub Run()',
        '    End Sub',
        '    '
    ].join('\n'));
    assert.strictEqual(ctx.scope, 'type');
    assert.strictEqual(ctx.procedureKind, undefined);
});

test('blockContext: 중첩 제어 구조가 스택에 쌓인다', () => {
    const ctx = contextAtEnd([
        'Module Main',
        '    Public Sub Run()',
        '        For i = 0 To 9',
        '            If i > 3 Then',
        '                '
    ].join('\n'));
    assert.deepStrictEqual(ctx.openBlocks, ['module', 'sub', 'for', 'if']);
});

test('blockContext: 한 줄 If는 블록으로 세지 않는다', () => {
    const ctx = contextAtEnd([
        'Module Main',
        '    Public Sub Run()',
        '        If done = 1 Then Exit Sub',
        '        '
    ].join('\n'));
    assert.deepStrictEqual(ctx.openBlocks, ['module', 'sub']);
});

test('blockContext: Next / End While / Loop 가 각 블록을 닫는다', () => {
    const ctx = contextAtEnd([
        'Module Main',
        '    Public Sub Run()',
        '        For i = 0 To 9',
        '        Next i',
        '        While busy',
        '        End While',
        '        Do While busy',
        '        Loop',
        '        '
    ].join('\n'));
    assert.deepStrictEqual(ctx.openBlocks, ['module', 'sub']);
});

test('blockContext: Wend 도 While 을 닫는다 (이식 코드 관용)', () => {
    const ctx = contextAtEnd([
        'Module Main',
        '    Public Sub Run()',
        '        While busy',
        '        Wend',
        '        '
    ].join('\n'));
    assert.deepStrictEqual(ctx.openBlocks, ['module', 'sub']);
});

test('blockContext: Delegate 선언은 블록이 아니다', () => {
    const ctx = contextAtEnd([
        'Module Main',
        '    Public Delegate Sub Handler(code As Integer)',
        '    '
    ].join('\n'));
    assert.strictEqual(ctx.scope, 'type');
    assert.deepStrictEqual(ctx.openBlocks, ['module']);
});

test('blockContext: Property 의 Get 안은 accessor 를 보고한다', () => {
    const ctx = contextAtEnd([
        'Public Class Cc',
        '    Public ReadOnly Property Size As Integer',
        '        Get',
        '            '
    ].join('\n'));
    assert.strictEqual(ctx.scope, 'procedure');
    assert.strictEqual(ctx.procedureKind, 'property');
    assert.strictEqual(ctx.accessor, 'get');
    assert.deepStrictEqual(ctx.openBlocks, ['class', 'property', 'get']);
});

test('blockContext: GPL 의 Set (value As …) 절을 블록으로 인식한다', () => {
    const ctx = contextAtEnd([
        'Public Class Cc',
        '    Public Property Size As Integer',
        '        Set (value As Integer)',
        '            '
    ].join('\n'));
    assert.strictEqual(ctx.accessor, 'set');
    assert.deepStrictEqual(ctx.openBlocks, ['class', 'property', 'set']);
});

test('blockContext: 주석과 주석 속 키워드는 무시한다', () => {
    const ctx = contextAtEnd([
        'Module Main',
        "    ' If x Then",
        '    Public Sub Run()   ' + "' For i = 0 To 9",
        '        '
    ].join('\n'));
    assert.deepStrictEqual(ctx.openBlocks, ['module', 'sub']);
});

test('blockContext: 문자열 안의 어퍼스트로피를 주석으로 오해하지 않는다', () => {
    const ctx = contextAtEnd([
        'Module Main',
        '    Public Sub Run()',
        '        Console.WriteLine("it\'s fine")',
        '        If x Then',
        '            '
    ].join('\n'));
    assert.deepStrictEqual(ctx.openBlocks, ['module', 'sub', 'if']);
});

test('blockContext: 줄 연속(_)으로 이어진 If 헤더도 블록으로 센다', () => {
    const ctx = contextAtEnd([
        'Module Main',
        '    Public Sub Run()',
        '        If a = 1 And _',
        '           b = 2 Then',
        '            '
    ].join('\n'));
    assert.deepStrictEqual(ctx.openBlocks, ['module', 'sub', 'if']);
});

test('blockContext: 짝이 맞지 않는 End 로 스택이 통째로 비워지지 않는다', () => {
    const ctx = contextAtEnd([
        'Module Main',
        '    Public Sub Run()',
        '        End If',   // 짝 없는 End If (편집 중 흔한 상태)
        '        '
    ].join('\n'));
    assert.deepStrictEqual(ctx.openBlocks, ['module', 'sub']);
});
