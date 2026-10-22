import * as assert from 'assert';
import { test } from './harness';
import { GPLParser } from '../language/gplParser';
import {
    buildOutlineTree, compactParameter, matchesSymbolQuery, outlineCategoryOf, OutlineNode, symbolDetail,
} from '../language/outlineModel';

// ─── 개요 모델 (ai-handoff §1-EI, 2026-10-02) ──────────────────────────────────────
// 개요·Ctrl+Shift+O·워크스페이스 심볼이 공유하는 분류·detail·계층·범위 계산을 Node 단독으로 고정한다.

const SRC = [
    /* 0 */ 'Module Shapes',
    /* 1 */ '    Public Class Counter',
    /* 2 */ '        Public Const Ceiling As Integer = 1000',
    /* 3 */ '        Private Shared created As Integer',
    /* 4 */ '        Private current As Integer',
    /* 5 */ '        Public Class Snapshot',
    /* 6 */ '            Public taken As Integer',
    /* 7 */ '        End Class',
    /* 8 */ '        Public Property Count As Integer',
    /* 9 */ '            Get',
    /* 10 */ '                Return current',
    /* 11 */ '            End Get',
    /* 12 */ '        End Property',
    /* 13 */ '        Public ReadOnly Property CreatedCount As Integer',
    /* 14 */ '            Get',
    /* 15 */ '                Return created',
    /* 16 */ '            End Get',
    /* 17 */ '        End Property',
    /* 18 */ '        Public WriteOnly Property Label As String',
    /* 19 */ '            Set (text As String)',
    /* 20 */ '            End Set',
    /* 21 */ '        End Property',
    /* 22 */ '        Public Sub Init(ByVal text As String, ByRef count As Integer)',
    /* 23 */ '        End Sub',
    /* 24 */ '        Public Shared Function Bump() As Integer()',
    /* 25 */ '        End Function',
    /* 26 */ '    End Class',
    /* 27 */ '    Public Delegate Sub LogSink(ByVal text As String)',
    /* 28 */ '    Public Delegate Function BinaryOp(ByVal a As Integer, ByVal b As Integer) As Integer',
    /* 29 */ '    Private hits, misses As Integer',
    /* 30 */ '    Public Sub ShapeTour()',
    /* 31 */ '    End Sub',
    /* 32 */ '    Public Function Describe(ByVal a As Integer) As String',
    /* 33 */ '    End Function',
    /* 34 */ '    Public Function Describe(ByVal a As Integer, ByVal b As String) As String',
    /* 35 */ '    End Function',
    /* 36 */ 'End Module',
].join('\n');

const LINE_COUNT = SRC.split('\n').length;

function parse(src: string) {
    return GPLParser.parseDocument(src, '/virtual/Outline-' + Math.random().toString(36).slice(2) + '.gpl');
}

function find(nodes: OutlineNode[], name: string): OutlineNode | undefined {
    for (const n of nodes) {
        if (n.name === name) { return n; }
        const inner = find(n.children, name);
        if (inner) { return inner; }
    }
    return undefined;
}

function findAll(nodes: OutlineNode[], name: string): OutlineNode[] {
    const out: OutlineNode[] = [];
    for (const n of nodes) {
        if (n.name === name) { out.push(n); }
        out.push(...findAll(n.children, name));
    }
    return out;
}

test('개요 분류: 클래스 멤버 Sub/Function 은 method, 모듈 프로시저는 function, 멤버 변수는 field', () => {
    const syms = parse(SRC);
    const byName = (name: string) => syms.find(s => s.name === name)!;
    assert.strictEqual(outlineCategoryOf(byName('Shapes')), 'module');
    assert.strictEqual(outlineCategoryOf(byName('Counter')), 'class');
    assert.strictEqual(outlineCategoryOf(byName('Snapshot')), 'class');
    assert.strictEqual(outlineCategoryOf(byName('Init')), 'method', '클래스 안 Sub');
    assert.strictEqual(outlineCategoryOf(byName('Bump')), 'method', '클래스 안 Function');
    assert.strictEqual(outlineCategoryOf(byName('ShapeTour')), 'function', '모듈 Sub');
    assert.strictEqual(outlineCategoryOf(byName('Describe')), 'function', '모듈 Function');
    assert.strictEqual(outlineCategoryOf(byName('Count')), 'property');
    assert.strictEqual(outlineCategoryOf(byName('Ceiling')), 'constant');
    assert.strictEqual(outlineCategoryOf(byName('current')), 'field', '클래스 멤버 변수');
    assert.strictEqual(outlineCategoryOf(byName('hits')), 'field', '모듈 멤버 변수');
    assert.strictEqual(outlineCategoryOf(byName('LogSink')), 'delegate');

    // 로컬·파라미터(옵션으로 파싱했을 때)는 variable — 개요에는 싣지 않지만 분류는 구별한다.
    const withLocals = GPLParser.parseDocument(
        'Module M\nPublic Sub S(ByVal p As Integer)\nDim x As Integer\nEnd Sub\nEnd Module', '/virtual/Locals.gpl',
        { includeLocals: true });
    assert.strictEqual(outlineCategoryOf(withLocals.find(s => s.name === 'x')!), 'variable');
    assert.strictEqual(outlineCategoryOf(withLocals.find(s => s.name === 'p')!), 'variable');
});

test('개요 detail: 시그니처·타입·상수 값·Shared·ReadOnly/WriteOnly — 오버로드가 구별된다', () => {
    const syms = parse(SRC);
    const detailOf = (name: string, nth = 0) => symbolDetail(syms.filter(s => s.name === name)[nth]);

    assert.strictEqual(detailOf('Shapes'), '');
    assert.strictEqual(detailOf('Counter'), '');
    assert.strictEqual(detailOf('Init'), '(text As String, ByRef count As Integer)', 'ByVal 은 지우고 ByRef 는 남긴다');
    assert.strictEqual(detailOf('Bump'), 'Shared () As Integer()', '배열 반환은 GPL 표기 `()`');
    assert.strictEqual(detailOf('ShapeTour'), '()');
    assert.strictEqual(detailOf('Describe', 0), '(a As Integer) As String');
    assert.strictEqual(detailOf('Describe', 1), '(a As Integer, b As String) As String');
    assert.strictEqual(detailOf('Count'), 'As Integer');
    assert.strictEqual(detailOf('CreatedCount'), 'As Integer (ReadOnly)');
    assert.strictEqual(detailOf('Label'), 'As String (WriteOnly)');
    assert.strictEqual(detailOf('Ceiling'), 'As Integer = 1000');
    assert.strictEqual(detailOf('created'), 'Shared As Integer');
    assert.strictEqual(detailOf('current'), 'As Integer');
    assert.strictEqual(detailOf('misses'), 'As Integer', '콤마 다중 선언의 두 번째 이름');
    assert.strictEqual(detailOf('LogSink'), 'Delegate Sub (text As String)');
    assert.strictEqual(detailOf('BinaryOp'), 'Delegate Function (a As Integer, b As Integer) As Integer');

    assert.strictEqual(compactParameter('  ByVal   items()   As  String '), 'items() As String');
    assert.strictEqual(compactParameter('ByRef x As Integer'), 'ByRef x As Integer');
});

test('개요 계층·범위: 모듈 > 클래스 > 중첩 클래스/멤버, 블록 끝은 파서의 짝 End 줄', () => {
    const tree = buildOutlineTree(parse(SRC), LINE_COUNT);

    assert.deepStrictEqual(tree.map(n => n.name), ['Shapes'], '루트는 모듈 하나');
    const shapes = tree[0];
    assert.deepStrictEqual(shapes.children.map(n => n.name),
        ['Counter', 'LogSink', 'BinaryOp', 'hits', 'misses', 'ShapeTour', 'Describe', 'Describe'],
        '클래스 뒤 모듈 멤버는 모듈 직속(클래스 안으로 삼키지 않는다)');
    const counter = find(tree, 'Counter')!;
    assert.deepStrictEqual(counter.children.map(n => n.name),
        ['Ceiling', 'created', 'current', 'Snapshot', 'Count', 'CreatedCount', 'Label', 'Init', 'Bump']);
    const snapshot = find(tree, 'Snapshot')!;
    assert.deepStrictEqual(snapshot.children.map(n => n.name), ['taken'], '중첩 클래스의 멤버는 그 아래');

    const span = (name: string) => { const n = find(tree, name)!; return [n.line, n.endLine, n.endLineParsed]; };
    assert.deepStrictEqual(span('Shapes'), [0, 36, true]);
    assert.deepStrictEqual(span('Counter'), [1, 26, true], '바깥 클래스는 자신의 End Class(안쪽 것이 아니다)');
    assert.deepStrictEqual(span('Snapshot'), [5, 7, true]);
    assert.deepStrictEqual(span('Count'), [8, 12, true], 'Property 도 블록');
    assert.deepStrictEqual(span('Init'), [22, 23, true]);
    assert.deepStrictEqual(span('ShapeTour'), [30, 31, true]);
    assert.deepStrictEqual(span('taken'), [6, 6, false], '한 줄 선언은 선언 줄만');
    assert.deepStrictEqual(span('LogSink'), [27, 27, false], 'Delegate 는 한 줄 타입 선언');
    const describes = findAll(tree, 'Describe');
    assert.deepStrictEqual(describes.map(n => [n.line, n.endLine]), [[32, 33], [34, 35]], '동명 오버로드가 각각 남는다');

    // 이름 컬럼 — 개요 클릭이 이름 위로 간다.
    assert.strictEqual(SRC.split('\n')[counter.line].slice(counter.nameStart, counter.nameEnd), 'Counter');
});

test('개요 범위 폴백: 짝 End 가 없으면 다음 비-자손 심볼 직전까지, 부모 범위를 넘지 않는다', () => {
    const src = [
        /* 0 */ 'Module M',
        /* 1 */ '    Public Class A',
        /* 2 */ '        Public Sub Unfinished()',       // End Sub 없음 — 입력 중
        /* 3 */ '            x = 1',
        /* 4 */ '        Public Sub Next()',
        /* 5 */ '        End Sub',
        /* 6 */ '        Public Sub Tail()',             // End Sub 없음, 클래스 끝까지
        /* 7 */ '            x = 2',
        /* 8 */ '    End Class',
        /* 9 */ '    Public Sub Later()',
        /* 10 */ '    End Sub',
        /* 11 */ 'End Module',
    ].join('\n');
    const tree = buildOutlineTree(parse(src), 12);
    const span = (name: string) => { const n = find(tree, name)!; return [n.line, n.endLine, n.endLineParsed]; };

    assert.deepStrictEqual(span('Unfinished'), [2, 3, false], '다음 형제(Next) 직전까지');
    assert.deepStrictEqual(span('Next'), [4, 5, true]);
    assert.deepStrictEqual(span('Tail'), [6, 7, false], '형제가 없으면 부모의 End Class 앞까지');
    assert.deepStrictEqual(span('A'), [1, 8, true]);
    assert.deepStrictEqual(span('Later'), [9, 10, true], '클래스 뒤 모듈 프로시저는 클래스에 안 삼킨다');

    // 모듈·클래스 자체가 안 닫힌 경우(파일 끝까지 입력 중)
    const open = buildOutlineTree(parse(['Module M', '    Public Class A', '        Public Sub S()', '        End Sub'].join('\n')), 4);
    assert.deepStrictEqual([find(open, 'M')!.endLine, find(open, 'A')!.endLine, find(open, 'S')!.endLine], [3, 3, 3]);
    assert.strictEqual(find(open, 'S')!.endLineParsed, true);
});

test('개요 모델: 로컬·파라미터 심볼은 트리에 싣지 않는다', () => {
    const syms = GPLParser.parseDocument(
        'Module M\nPublic Sub S(ByVal p As Integer)\nDim x As Integer\nEnd Sub\nEnd Module', '/virtual/Locals2.gpl',
        { includeLocals: true });
    const tree = buildOutlineTree(syms, 5);
    assert.deepStrictEqual(find(tree, 'S')!.children, []);
    assert.strictEqual(find(tree, 'x'), undefined);
    assert.strictEqual(find(tree, 'p'), undefined);
});

test('워크스페이스 심볼 질의: 글자가 순서대로 나타나면 통과(대소문자 무시), 빈 질의는 전부', () => {
    assert.strictEqual(matchesSymbolQuery('RegisterLogSink', 'rlog'), true);
    assert.strictEqual(matchesSymbolQuery('RegisterLogSink', 'LogSink'), true);
    assert.strictEqual(matchesSymbolQuery('RegisterLogSink', 'sinklog'), false, '순서가 어긋나면 탈락');
    assert.strictEqual(matchesSymbolQuery('RegisterLogSink', ''), true);
    assert.strictEqual(matchesSymbolQuery('RegisterLogSink', '  '), true);
    assert.strictEqual(matchesSymbolQuery('abc', 'abcd'), false);
});
