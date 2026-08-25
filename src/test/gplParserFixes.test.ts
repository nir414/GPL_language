import * as assert from 'assert';
import { test } from './harness';
import { GPLParser, GPLSymbolKind } from '../gplParser';
import {
    extractCallArgumentsFromSuffix,
    findEnclosingProcedureRange,
    getParameterArity,
    argCountMatchesArity,
    getStringLiteralContentAt
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

// ─── 중첩 클래스 (2026-07-16, KDY_AutoAging.gpl 구조) ───

const NESTED_SRC = [
    'Module M',
    '\tConst TOP_CONST As Integer = 1',
    '\tPublic Class Outer',
    '\t\tPublic outerVar As Integer',
    '\t\tClass Inner',
    '\t\t\tPublic innerVar As Double',
    '\t\t\tPublic Sub InnerSub()',
    '\t\t\tEnd Sub',
    '\t\tEnd Class',
    "\t\tPublic Sub AfterInner()", // ← 안쪽 End Class 뒤 — Outer로 복귀해야 함
    '\t\tEnd Sub',
    '\tEnd Class',
    '\tPublic Sub ModuleSub()', // ← 바깥 End Class 뒤 — 모듈 직속
    '\tEnd Sub',
    'End Module',
].join('\n');

test('중첩 클래스: 안쪽 End Class 뒤 멤버가 바깥 클래스로 귀속된다', () => {
    const syms = GPLParser.parseDocument(NESTED_SRC, 'nested.gpl');
    const afterInner = syms.find(s => s.name === 'AfterInner');
    assert.ok(afterInner, 'AfterInner 파싱됨');
    assert.strictEqual(afterInner!.className, 'Outer');
});

test('중첩 클래스: 바깥 End Class 뒤 멤버는 모듈 직속', () => {
    const syms = GPLParser.parseDocument(NESTED_SRC, 'nested.gpl');
    const moduleSub = syms.find(s => s.name === 'ModuleSub');
    assert.ok(moduleSub);
    assert.strictEqual(moduleSub!.className, undefined);
    assert.strictEqual(moduleSub!.module, 'M');
});

test('중첩 클래스: parentClassName이 기록된다 (Inner.parent = Outer)', () => {
    const syms = GPLParser.parseDocument(NESTED_SRC, 'nested.gpl');
    const inner = syms.find(s => s.name === 'Inner' && s.kind === 'class');
    const outer = syms.find(s => s.name === 'Outer' && s.kind === 'class');
    assert.strictEqual(inner!.parentClassName, 'Outer');
    assert.strictEqual(outer!.parentClassName, undefined);
});

test('중첩 클래스: 안쪽 멤버는 안쪽 클래스에 귀속', () => {
    const syms = GPLParser.parseDocument(NESTED_SRC, 'nested.gpl');
    assert.strictEqual(syms.find(s => s.name === 'innerVar')!.className, 'Inner');
    assert.strictEqual(syms.find(s => s.name === 'InnerSub')!.className, 'Inner');
    assert.strictEqual(syms.find(s => s.name === 'outerVar')!.className, 'Outer');
    assert.strictEqual(syms.find(s => s.name === 'TOP_CONST')!.className, undefined);
});

// ─── 멤버 변수 수식어 순서 (2026-07-22, MergeCode/DataModule.gpl 구조) ───
// GPL은 "Public Shared Dim"뿐 아니라 "Shared Public Dim" 순서도 유효하다.

const MODIFIER_ORDER_SRC = [
    'Module DataModule',
    '\tPublic Class DataFile',
    '\t\tShared Public Dim SaveReservationMutex As New Mutex',
    '\t\tShared Public Dim SaveReservationThread As Thread = New Thread("DataFile.SaveReservationThreadFunction",,"SaveReservationThreadFunction")',
    '\t\tShared Public Dim SaveReservationDataFileList(30) As DataFile',
    '\t\tShared Public Dim SaveReservationPDB As Boolean = False',
    '\t\tPublic Shared Dim legacyOrder As Integer',
    '\t\tShared Private hidden As Double',
    '\tEnd Class',
    'End Module',
].join('\n');

test('수식어 순서: "Shared Public Dim x As New Mutex" (New형)', () => {
    const v = GPLParser.parseDocument(MODIFIER_ORDER_SRC, 'order.gpl')
        .find(s => s.name === 'SaveReservationMutex');
    assert.ok(v, 'SaveReservationMutex가 파싱되어야 한다');
    assert.strictEqual(v!.returnType, 'Mutex');
    assert.strictEqual(v!.isShared, true);
    assert.strictEqual(v!.accessModifier, 'public');
    assert.strictEqual(v!.className, 'DataFile');
});

test('수식어 순서: "Shared Public Dim t As Thread = New Thread(...)" (초기화식 포함 스칼라형)', () => {
    const v = GPLParser.parseDocument(MODIFIER_ORDER_SRC, 'order.gpl')
        .find(s => s.name === 'SaveReservationThread');
    assert.ok(v, 'SaveReservationThread가 파싱되어야 한다');
    assert.strictEqual(v!.kind, GPLSymbolKind.Variable);
    assert.strictEqual(v!.returnType, 'Thread');
    assert.strictEqual(v!.isShared, true);
});

test('수식어 순서: "Shared Public Dim xs(30) As DataFile" (배열형)', () => {
    const v = GPLParser.parseDocument(MODIFIER_ORDER_SRC, 'order.gpl')
        .find(s => s.name === 'SaveReservationDataFileList');
    assert.ok(v, 'SaveReservationDataFileList가 파싱되어야 한다');
    assert.strictEqual(v!.returnType, 'DataFile[]');
    assert.strictEqual(v!.isShared, true);
});

test('수식어 순서: 기존 "Public Shared Dim" / "Shared Private" 순서도 계속 파싱된다', () => {
    const syms = GPLParser.parseDocument(MODIFIER_ORDER_SRC, 'order.gpl');
    const legacy = syms.find(s => s.name === 'legacyOrder');
    assert.ok(legacy, 'legacyOrder가 파싱되어야 한다');
    assert.strictEqual(legacy!.isShared, true);
    assert.strictEqual(legacy!.accessModifier, 'public');
    const hidden = syms.find(s => s.name === 'hidden');
    assert.ok(hidden, 'hidden이 파싱되어야 한다 (Dim 없이 Shared Private)');
    assert.strictEqual(hidden!.accessModifier, 'private');
    assert.strictEqual(hidden!.isShared, true);
});

test('수식어 순서: bare "x As Integer"는 멤버 선언으로 오인하지 않는다', () => {
    const src = ['Module M', 'x As Integer', 'End Module'].join('\n');
    const v = GPLParser.parseDocument(src, 'bare.gpl').find(s => s.name === 'x');
    assert.strictEqual(v, undefined);
});

// ─── 문자열 리터럴 속 프로시저 참조 (2026-07-22, New Thread("Class.Proc")) ───

test('getStringLiteralContentAt: 커서를 감싸는 리터럴 내용을 돌려준다', () => {
    const line = 'Dim t As Thread = New Thread("DataFile.Proc",,"ThreadName")';
    const first = line.indexOf('DataFile');
    const second = line.indexOf('ThreadName');
    assert.deepStrictEqual(getStringLiteralContentAt(line, first)?.text, 'DataFile.Proc');
    assert.deepStrictEqual(getStringLiteralContentAt(line, second)?.text, 'ThreadName');
});

test('getStringLiteralContentAt: 문자열 밖/주석은 undefined', () => {
    const line = 'Call Foo("abc") \' comment "not a string"';
    assert.strictEqual(getStringLiteralContentAt(line, line.indexOf('Foo')), undefined);
    assert.strictEqual(getStringLiteralContentAt(line, line.indexOf('not a string')), undefined);
});

test('getStringLiteralContentAt: 닫히지 않은 문자열은 줄 끝까지를 내용으로 본다', () => {
    const line = 'x = "unterminated';
    assert.strictEqual(getStringLiteralContentAt(line, line.indexOf('unterminated'))?.text, 'unterminated');
});

// ─── Property getter 반환식 기록 (GitHub #26, 2026-08-25) ─────────────────
// 디버거가 제어기 -eval의 -780(프로퍼티 참조 평가 불가)을 백킹 필드 평가로 우회하는 근거.

test('Property: Get 본문이 `Return <식>` 한 문장이면 getterReturnExpr에 기록', () => {
    const src = [
        'Class RNDRobot',
        '    Private m_armCount As Integer',
        "    ' 암 개수",
        '    Public ReadOnly Property armCount As Integer',
        '        Get',
        "            Return m_armCount ' 백킹 필드",
        '        End Get',
        '    End Property',
        'End Class',
    ].join('\n');
    const p = parse(src).find(s => s.name === 'armCount' && s.kind === GPLSymbolKind.Property);
    assert.ok(p, 'Property 심볼이 파싱되어야 한다');
    assert.strictEqual(p!.getterReturnExpr, 'm_armCount');
    assert.strictEqual(p!.hasGetter, true);
    assert.strictEqual(p!.className, 'RNDRobot');
    assert.strictEqual(p!.returnType, 'Integer');
});

test('Property: 분기/계산이 있는 getter·Set만 있는 프로퍼티는 getterReturnExpr 없음', () => {
    const src = [
        'Class C',
        '    Public Property total As Integer',
        '        Get',
        '            If m_a > 0 Then',
        '                Return m_a',
        '            End If',
        '            Return m_b',
        '        End Get',
        '        Set(ByVal value As Integer)',
        '            m_a = value',
        '        End Set',
        '    End Property',
        '    Public WriteOnly Property sink As Integer',
        '        Set(ByVal value As Integer)',
        '            m_b = value',
        '        End Set',
        '    End Property',
        '    Public Property loc As Location',
        '        Get',
        '            Return m_loc',
        '        End Get',
        '        Set(ByVal value As Location)',
        '            m_loc = value',
        '        End Set',
        '    End Property',
        'End Class',
    ].join('\n');
    const syms = parse(src);
    const total = syms.find(s => s.name === 'total')!;
    assert.strictEqual(total.getterReturnExpr, undefined);
    assert.strictEqual(total.hasGetter, true);
    const sink = syms.find(s => s.name === 'sink')!;
    assert.strictEqual(sink.getterReturnExpr, undefined);
    assert.strictEqual(sink.hasGetter, false);
    // Set 블록이 뒤따라도 Get의 단일 Return은 인식된다
    const loc = syms.find(s => s.name === 'loc')!;
    assert.strictEqual(loc.getterReturnExpr, 'm_loc');
    assert.strictEqual(loc.returnType, 'Location');
});
