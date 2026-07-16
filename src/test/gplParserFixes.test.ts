import * as assert from 'assert';
import { test } from './harness';
import { GPLParser, GPLSymbolKind } from '../gplParser';
import {
    extractCallArgumentsFromSuffix,
    findEnclosingProcedureRange,
    getParameterArity,
    argCountMatchesArity
} from '../language/cursorExpression';

// 2026-07-14 리뷰 수정 회귀 테스트:
// 파서 이름 컬럼(단어 경계), 배열 반환 타입(`As T()` → `T[]`), 주석 안전 파라미터 추출,
// cursorExpression 주석 절단, 생성자 arity(Optional) 규칙, 감싸는 프로시저 범위 판정.

function parse(src: string, opts?: { includeLocals?: boolean; includeParameters?: boolean }) {
    return GPLParser.parseDocument(src, '/virtual/fixes.gpl', opts);
}

test('이름 컬럼: `Function Fun()`의 Fun은 키워드 부분문자열(col 0)이 아니라 col 9', () => {
    const f = parse('Function Fun()\nEnd Function').find(s => s.name === 'Fun');
    assert.ok(f, 'Fun 심볼이 파싱되어야 한다');
    assert.strictEqual(f!.range.start, 9);
});

test('이름 컬럼: 프로시저와 같은 이름(대소문자만 다름)의 파라미터는 괄호 뒤에서 찾는다', () => {
    const syms = parse('Sub Process(process As Integer)\nEnd Sub', { includeLocals: true, includeParameters: true });
    const sub = syms.find(s => s.name === 'Process' && s.kind === GPLSymbolKind.Sub);
    const param = syms.find(s => s.name === 'process' && s.isParameter);
    assert.ok(sub && param, 'Sub와 파라미터 심볼이 모두 파싱되어야 한다');
    assert.strictEqual(sub!.range.start, 4);
    assert.strictEqual(param!.range.start, 12);
});

test('이름 컬럼: `Static tic`의 tic이 Static 안(col 7)이 아니라 col 11', () => {
    const src = ['Sub S()', '    Static tic As Integer', 'End Sub'].join('\n');
    const v = parse(src, { includeLocals: true }).find(s => s.name === 'tic');
    assert.ok(v, 'tic 로컬 심볼이 파싱되어야 한다');
    assert.strictEqual(v!.range.start, 11);
});

test('반환 타입: `As Integer()`는 Integer[]로 기록되고 파라미터도 보존된다', () => {
    const f = parse('Public Function GetArr(a As Integer) As Integer()\nEnd Function')
        .find(s => s.name === 'GetArr');
    assert.ok(f, 'GetArr 심볼이 파싱되어야 한다');
    assert.strictEqual(f!.returnType, 'Integer[]');
    assert.deepStrictEqual(f!.parameters, ['a As Integer']);
});

test('반환 타입: Property의 `As Double()`도 Double[]', () => {
    const src = [
        'Public Class C',
        '    Public ReadOnly Property Items As Double()',
        '    End Property',
        'End Class'
    ].join('\n');
    const p = parse(src).find(s => s.name === 'Items');
    assert.ok(p, 'Items 프로퍼티가 파싱되어야 한다');
    assert.strictEqual(p!.returnType, 'Double[]');
});

test('주석 안전: 파라미터 캡처가 후행 주석의 괄호/콤마를 삼키지 않는다', () => {
    const f = parse("Sub Foo(a As Integer) ' note (x, y)\nEnd Sub").find(s => s.name === 'Foo');
    assert.ok(f, 'Foo 심볼이 파싱되어야 한다');
    assert.deepStrictEqual(f!.parameters, ['a As Integer']);
});

test('주석 안전: 문자열 기본값(콤마 포함)은 원문 그대로, 반환 타입은 주석에 속지 않는다', () => {
    const f = parse('Function Bar(s As String = "a,b") As String \' c(1,2)\nEnd Function')
        .find(s => s.name === 'Bar');
    assert.ok(f, 'Bar 심볼이 파싱되어야 한다');
    assert.deepStrictEqual(f!.parameters, ['s As String = "a,b"']);
    assert.strictEqual(f!.returnType, 'String');
});

test('extractCallArgumentsFromSuffix: 미완성 호출의 주석 내용은 인자에서 제외', () => {
    assert.deepStrictEqual(extractCallArgumentsFromSuffix("(a ' x, y"), ['a']);
});

test('extractCallArgumentsFromSuffix: 문자열 속 아포스트로피는 주석이 아니다', () => {
    assert.deepStrictEqual(extractCallArgumentsFromSuffix('("don\'t", b)'), ['"don\'t"', 'b']);
});

test('생성자 arity: Optional 파라미터는 0-인자/1-인자 호출 모두 매칭(findConstructorInClass 규칙)', () => {
    const arity = getParameterArity(['Optional timeoutMs As Integer = 500']);
    assert.strictEqual(argCountMatchesArity(0, arity), true);
    assert.strictEqual(argCountMatchesArity(1, arity), true);
    assert.strictEqual(argCountMatchesArity(2, arity), false);
});

test('findEnclosingProcedureRange: 프로시저 사이(모듈 레벨)는 undefined, 내부는 정확한 범위', () => {
    const lines = [
        'Module M',            // 0
        'Sub A()',             // 1
        'End Sub',             // 2
        'Dim gap As Integer',  // 3 — 프로시저 "사이"
        'Sub B()',             // 4
        'End Sub',             // 5
        'End Module'           // 6
    ];
    const get = (i: number) => lines[i];
    assert.strictEqual(findEnclosingProcedureRange(get, lines.length, 3), undefined);
    assert.deepStrictEqual(findEnclosingProcedureRange(get, lines.length, 1), { startLine: 1, endLine: 2 });
    // End Sub 라인 자신은 그 프로시저 내부로 취급한다.
    assert.deepStrictEqual(findEnclosingProcedureRange(get, lines.length, 2), { startLine: 1, endLine: 2 });
});

test('endsWithLineContinuation: `_`로 끝나는 주석은 연속줄이 아니다 (folding 재사용 근거)', () => {
    assert.strictEqual(GPLParser.endsWithLineContinuation("' comment _"), false);
    assert.strictEqual(GPLParser.endsWithLineContinuation('If a And _'), true);
    assert.strictEqual(GPLParser.endsWithLineContinuation('x = foo_'), false);
});
