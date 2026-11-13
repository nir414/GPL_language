import * as assert from 'assert';
import { test } from '../../harness';
import {
    callSiteLine,
    breakpointCandidateLines,
    buildProcedureRanges,
    enclosingProcedure,
    isBlankOrComment,
    parseCallTargets,
    resolveBreakpointLine,
    stripToCode,
} from '../../../debug/execution/sourceTargets';

// ─── 픽스처: 프로시저 2개 + 빈 줄·주석 ───────────────────────────────────────
const SRC = [
    "Module TestModule",          // 1
    "    Dim g As Integer",       // 2
    "",                           // 3
    "    Public Sub Alpha()",     // 4
    "        ' 주석만 있는 줄",     // 5
    "",                           // 6
    "        g = 1",              // 7
    "        Beta(g)",            // 8
    "    End Sub",                // 9
    "",                           // 10
    "    Public Sub Beta(v As Integer)", // 11
    "        Rem 다른 형식의 주석",  // 12
    "        robot.Move(v)",      // 13
    "    End Sub",                // 14
    "End Module",                 // 15
];

const PROCS = [
    { name: 'Alpha', line: 4 },
    { name: 'Beta', line: 11 },
];

test('sourceTargets: stripToCode는 문자열·주석을 제거한다', () => {
    const stripped = stripToCode(`Foo("it's", 1) ' 주석`);
    assert.ok(!stripped.includes("'"), stripped);
    assert.ok(!stripped.includes('주석'), stripped);
    assert.strictEqual(stripped.replace(/\s+/g, ''), 'Foo(,1)');
    assert.strictEqual(stripToCode(`' 전체 주석`).trim(), '');
});

test('sourceTargets: 빈 줄·주석 판정(Rem 포함, Remove는 코드)', () => {
    assert.strictEqual(isBlankOrComment(''), true);
    assert.strictEqual(isBlankOrComment('    '), true);
    assert.strictEqual(isBlankOrComment("   ' hello"), true);
    assert.strictEqual(isBlankOrComment('   Rem hello'), true);
    assert.strictEqual(isBlankOrComment('   Remove(1)'), false);
    assert.strictEqual(isBlankOrComment('   g = 1'), false);
});

test('sourceTargets: 프로시저 범위는 다음 헤더 직전까지', () => {
    assert.deepStrictEqual(buildProcedureRanges(PROCS, SRC.length), [
        { name: 'Alpha', start: 4, end: 10 },
        { name: 'Beta', start: 11, end: 15 },
    ]);
    // 소스를 주면 End Sub 를 실제 끝으로 잡는다 — End Module(15)이 Beta 범위에 들어가지 않는다
    assert.deepStrictEqual(buildProcedureRanges(PROCS, SRC.length, SRC), [
        { name: 'Alpha', start: 4, end: 9 },
        { name: 'Beta', start: 11, end: 14 },
    ]);
});

test('sourceTargets: 정렬되지 않은 심볼도 처리한다', () => {
    const ranges = buildProcedureRanges([{ name: 'Beta', line: 11 }, { name: 'Alpha', line: 4 }], 15);
    assert.deepStrictEqual(ranges.map(r => r.name), ['Alpha', 'Beta']);
});

test('sourceTargets: enclosingProcedure — 프로시저 밖은 undefined', () => {
    const ranges = buildProcedureRanges(PROCS, SRC.length);
    assert.strictEqual(enclosingProcedure(ranges, 7)?.name, 'Alpha');
    assert.strictEqual(enclosingProcedure(ranges, 13)?.name, 'Beta');
    assert.strictEqual(enclosingProcedure(ranges, 2), undefined);
});

test('sourceTargets: 빈 줄·주석 지정 시 다음 실행 줄로 내린다(문서 규칙)', () => {
    assert.strictEqual(resolveBreakpointLine(SRC, 7), 7);
    assert.strictEqual(resolveBreakpointLine(SRC, 5), 7, '주석 줄 5 → 7');
    assert.strictEqual(resolveBreakpointLine(SRC, 6), 7, '빈 줄 6 → 7');
    assert.strictEqual(resolveBreakpointLine(SRC, 12), 13, 'Rem 줄 12 → 13');
});

test('sourceTargets: 프로시저 범위를 넘어가면 옮기지 않는다', () => {
    const ranges = buildProcedureRanges(PROCS, SRC.length);
    const alpha = ranges[0];
    // 줄 10은 Alpha 범위의 마지막이고 빈 줄 → 범위 안에 실행 줄이 없으므로 undefined
    assert.strictEqual(resolveBreakpointLine(SRC, 10, alpha), undefined);
    assert.strictEqual(resolveBreakpointLine(SRC, 5, alpha), 7);
});

test('sourceTargets: 범위를 벗어난 줄 번호는 undefined', () => {
    assert.strictEqual(resolveBreakpointLine(SRC, 0), undefined);
    assert.strictEqual(resolveBreakpointLine(SRC, 999), undefined);
});

test('sourceTargets: BP 후보 줄은 프로시저 안의 실행 줄만', () => {
    const ranges = buildProcedureRanges(PROCS, SRC.length, SRC);
    // 헤더(4·11)·빈 줄·주석·프로시저 밖(2·15)은 제외, End Sub(9·14)는 문장이므로 포함
    assert.deepStrictEqual(breakpointCandidateLines(SRC, ranges), [7, 8, 9, 13, 14]);
});

test('sourceTargets: BP 후보 줄 구간 제한', () => {
    const ranges = buildProcedureRanges(PROCS, SRC.length, SRC);
    assert.deepStrictEqual(breakpointCandidateLines(SRC, ranges, 11, 13), [13]);
});

test('sourceTargets: 호출 후보 — 괄호 호출과 점 표기', () => {
    const targets = parseCallTargets('        robot.Move(v)');
    assert.strictEqual(targets.length, 1);
    assert.strictEqual(targets[0].name, 'Move');
    assert.strictEqual(targets[0].receiver, 'robot');
    assert.strictEqual(targets[0].label, 'robot.Move');
});

test('sourceTargets: 호출 후보 — Call 키워드(괄호 없음)', () => {
    const targets = parseCallTargets('        Call Beta');
    assert.deepStrictEqual(targets.map(t => t.label), ['Beta']);
});

test('sourceTargets: 호출 후보 — 한 줄에 여러 호출, 중첩 포함', () => {
    const targets = parseCallTargets('        x = Alpha(Beta(1), robot.Speed(2))');
    assert.deepStrictEqual(targets.map(t => t.label), ['Alpha', 'Beta', 'robot.Speed']);
});

test('sourceTargets: 제어 구문 키워드는 호출로 보지 않는다', () => {
    assert.deepStrictEqual(parseCallTargets('        If Foo(1) Then').map(t => t.label), ['Foo']);
    assert.deepStrictEqual(parseCallTargets('        For i = 1 To Count(3)').map(t => t.label), ['Count']);
    assert.deepStrictEqual(parseCallTargets('        Dim t As New Thread("A.B")').map(t => t.label), []);
});

test('sourceTargets: 주석·문자열 안의 호출은 무시한다', () => {
    assert.deepStrictEqual(parseCallTargets(`        ' Beta(1)`).map(t => t.label), []);
    assert.deepStrictEqual(parseCallTargets('        s = "Beta(1)"').map(t => t.label), []);
});

test('sourceTargets: 같은 이름이 두 번 나오면 한 번만', () => {
    assert.deepStrictEqual(parseCallTargets('        Beta(Beta(1))').map(t => t.label), ['Beta']);
});

// 호출자 프레임 줄 — 실측(2026-11-13 captures/probe-callerline): Show Stack 은 호출자에 "돌아가 실행할 다음 문장" 줄을 준다.
test('callSiteLine: 보고 줄 → 바로 앞 코드 줄(빈 줄·주석·End If·Next 사례, 실측 표 그대로)', () => {
    const src = [
        'Module Main',                                   // 1
        '    Public Sub Callee(ByVal tag As Integer)',   // 2
        '        Console.WriteLine("CS " & CStr(tag))',  // 3
        '    End Sub',                                   // 4
        '    Public Sub Main()',                         // 5
        '        Dim i As Integer',                      // 6
        '        Callee(1)',                             // 7
        '',                                              // 8
        "        ' comment",                             // 9
        '        i = 1',                                 // 10
        '        If i = 1 Then',                         // 11
        '            Callee(2)',                         // 12
        '        End If',                                // 13
        '        i = 2',                                 // 14
        '        For i = 0 To 0',                        // 15
        '            Callee(3)',                         // 16
        '        Next i',                                // 17
        '        i = 3',                                 // 18
        '        Callee(4)',                             // 19
        '        i = Twice(5)',                          // 20
        '        Console.WriteLine("CS done")',          // 21
    ];
    const observed: Array<[number, number]> = [[10, 7], [13, 12], [17, 16], [20, 19], [21, 20]];
    for (const [reported, call] of observed) {
        assert.strictEqual(callSiteLine(src, reported), call, `reported ${reported}`);
    }
});

test('callSiteLine: `_` 연속 줄이면 논리 줄 첫 줄, 소스 없음·첫 줄은 undefined', () => {
    const src = ['    x = Foo(1, _', '            2)', '    y = 1'];
    assert.strictEqual(callSiteLine(src, 3), 1);
    assert.strictEqual(callSiteLine(undefined, 3), undefined);
    assert.strictEqual(callSiteLine(src, 1), undefined);
});
