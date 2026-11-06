import * as assert from 'assert';
import { test } from '../../harness';
import { GPLParser, GPLSymbol } from '../../../language/syntax/gplParser';
import { CompilerCheckCode, CompilerSymbolLookup, findCompilerCheckFindings } from '../../../language/checks/compilerChecks';

// ─── Delegate(AddressOf)·Mid 검사 (inbox 2026-11-04~05 Sample Prep 실측 보고) ───

function src(...lines: string[]): string {
    return lines.join('\n');
}

const DELEGATE_CODES: CompilerCheckCode[] = [
    'addressof-without-delegate', 'addressof-me-prefix', 'delegate-signature-mismatch',
    'delegate-parameter-direct-call', 'mid-member-access',
];

function found(content: string, lookup?: CompilerSymbolLookup) {
    return findCompilerCheckFindings(content, 'Main.gpl', lookup).filter(f => DELEGATE_CODES.includes(f.code));
}

function codes(content: string, lookup?: CompilerSymbolLookup): CompilerCheckCode[] {
    return found(content, lookup).map(f => f.code);
}

/** 보고 `delegates_v1` §1 프로브와 같은 꼴. */
const PROBE_HEAD = [
    'Module AOP_Main',
    '    Public Delegate Sub ProbeSub(ByVal n As Integer)',
    '    Public Class Registry',
    '        Public Handler As ProbeSub',
    '        Public Sub Add(ByVal name As String, ByVal h As ProbeSub, ByVal usage As String)',
    '        End Sub',
    '    End Class',
    '    Private Sub Take(ByVal h As ProbeSub)',
    '    End Sub',
    '    Private Sub Reg(ByVal name As String, ByVal h As ProbeSub)',
    '    End Sub',
    '    Private Sub Reg(ByVal name As String, ByVal h As ProbeSub, ByVal usage As String)',
    '    End Sub',
    '    Public Sub Target(ByVal n As Integer)',
    '    End Sub',
];

function inMain(...body: string[]): string {
    return src(...PROBE_HEAD, '    Public Sub Main()', ...body.map(l => '        ' + l), '    End Sub', 'End Module');
}

// ① 감싸지 않은 AddressOf

test('delegateChecks: 호출 인자의 bare AddressOf 는 error + New 로 감싸는 빠른 수정', () => {
    const [f] = found(inMain('Take(AddressOf AOP_Main.Target)'));
    assert.strictEqual(f.code, 'addressof-without-delegate');
    assert.strictEqual(f.severity, 'error');
    assert.ok(f.message.includes('-205') && f.message.includes('-712'));
    assert.deepStrictEqual(f.fix, {
        title: '`New ProbeSub(AddressOf AOP_Main.Target)` 로 감싸기',
        newText: 'New ProbeSub(AddressOf AOP_Main.Target)',
    });
});

test('delegateChecks: 오버로드 두 개(Reg)와 클래스 메서드(Add)의 인자도 같은 delegate 형이면 감싸기 수정을 준다', () => {
    const f = found(inMain(
        'Dim r As New Registry',
        'Reg("A", AddressOf AOP_Main.Target)',
        'Reg("B", AddressOf AOP_Main.Target, "usage")',
        'r.Add("C", AddressOf AOP_Main.Target, "usage")',
    ));
    assert.deepStrictEqual(f.map(x => x.code), Array(3).fill('addressof-without-delegate'));
    assert.ok(f.every(x => x.fix?.newText === 'New ProbeSub(AddressOf AOP_Main.Target)'));
});

test('delegateChecks: delegate 필드·지역 변수 대입의 bare AddressOf 도 error + 수정', () => {
    const f = found(inMain(
        'Dim r As New Registry',
        'Dim d As ProbeSub',
        'r.Handler = AddressOf AOP_Main.Target',
        'd = AddressOf Target',
    ));
    assert.deepStrictEqual(f.map(x => x.fix?.newText), [
        'New ProbeSub(AddressOf AOP_Main.Target)',
        'New ProbeSub(AddressOf Target)',
    ]);
});

test('delegateChecks: 대상 형을 모르는 자리는 error 만 내고 수정은 없다', () => {
    const [f] = found(inMain('Unknown(AddressOf AOP_Main.Target)'));
    assert.strictEqual(f.code, 'addressof-without-delegate');
    assert.strictEqual(f.fix, undefined);
});

test('delegateChecks: New <Delegate>(AddressOf X) 는 경고하지 않는다(대조 T0)', () => {
    assert.deepStrictEqual(codes(inMain(
        'Take(New ProbeSub(AddressOf AOP_Main.Target))',
        'Dim r As New Registry',
        'r.Handler = New ProbeSub(AddressOf Target)',
        'Reg("A", New ProbeSub(AddressOf AOP_Main.Target))',
    )), []);
});

test('delegateChecks: 사용자 클래스 생성자 인자 AddressOf 는 판정하지 않는다(미실측)', () => {
    const text = src(
        'Module M',
        '    Public Delegate Sub D()',
        '    Public Class Holder',
        '        Public Sub New(ByVal h As D)',
        '        End Sub',
        '    End Class',
        '    Public Sub T()',
        '    End Sub',
        '    Public Sub Main()',
        '        Dim x As New Holder(AddressOf T)',
        '    End Sub',
        'End Module',
    );
    assert.deepStrictEqual(codes(text), []);
});

test('delegateChecks: 주석·문자열 속 AddressOf 는 무시한다', () => {
    assert.deepStrictEqual(codes(inMain(
        "' Take(AddressOf Target)",
        'Console.WriteLine("Take(AddressOf Target)")',
    )), []);
});

// ② AddressOf Me.X

const SINK = (bind: string) => src(
    'Module DLP',
    '    Public Delegate Sub LineSub(ByVal line As String)',
    '    Public Class Sink',
    '        Public Sub OnLine(ByVal line As String)',
    '        End Sub',
    '        Public Function Bind() As LineSub',
    '            Dim d As LineSub',
    '            Dim self As Sink',
    '            self = Me',
    `            ${bind}`,
    '            Return d',
    '        End Function',
    '    End Class',
    'End Module',
);

test('delegateChecks: AddressOf Me.X 는 error(-741) + Me. 삭제 수정', () => {
    const text = SINK('d = New LineSub(AddressOf Me.OnLine)');
    const f = found(text);
    assert.deepStrictEqual(f.map(x => x.code), ['addressof-me-prefix']);
    assert.strictEqual(f[0].severity, 'error');
    assert.ok(f[0].message.includes('-741'));
    assert.deepStrictEqual(f[0].fix, { title: '`Me.` 제거 — 클래스 안에서는 `AddressOf X` 가 이 객체에 묶입니다', newText: '' });
    const line = text.split('\n')[f[0].line];
    assert.strictEqual(line.slice(f[0].start, f[0].end), 'Me.');
});

test('delegateChecks: 클래스 안 AddressOf X, AddressOf 지역변수.M 은 경고하지 않는다(D4·D5)', () => {
    assert.deepStrictEqual(codes(SINK('d = New LineSub(AddressOf OnLine)')), []);
    assert.deepStrictEqual(codes(SINK('d = New LineSub(AddressOf self.OnLine)')), []);
});

test('delegateChecks: 감싸지 않은 AddressOf Me.X 는 Me. 와 감싸기 둘 다 알린다', () => {
    const f = found(SINK('d = AddressOf Me.OnLine'));
    assert.deepStrictEqual(f.map(x => x.code).sort(), ['addressof-me-prefix', 'addressof-without-delegate']);
    assert.strictEqual(f.find(x => x.code === 'addressof-without-delegate')?.fix?.newText, 'New LineSub(AddressOf OnLine)');
});

// ⑤ 시그니처 불일치

const NEG = (extra: string[], ...use: string[]) => src(
    'Module DLP_Neg',
    '    Public Delegate Sub LineSub(ByVal line As String)',
    '    Public Sub IntTarget(ByVal n As Integer)',
    '    End Sub',
    '    Public Sub RefTarget(ByRef line As String)',
    '    End Sub',
    '    Public Function FnTarget(ByVal line As String) As Integer',
    '        Return 0',
    '    End Function',
    '    Public Sub GoodTarget(ByVal line As String)',
    '    End Sub',
    '    Public Sub TwoTarget(ByVal line As String, ByVal n As Integer)',
    '    End Sub',
    ...extra,
    '    Public Sub Main()',
    '        Dim d As LineSub',
    ...use.map(l => `        ${l}`),
    '    End Sub',
    'End Module',
);

test('delegateChecks: 형·ByRef·Function·개수가 다른 대상은 error(-741)', () => {
    for (const target of ['IntTarget', 'RefTarget', 'FnTarget', 'TwoTarget']) {
        const f = found(NEG([], `d = New LineSub(AddressOf DLP_Neg.${target})`));
        assert.deepStrictEqual(f.map(x => x.code), ['delegate-signature-mismatch'], target);
        assert.strictEqual(f[0].severity, 'error');
        assert.ok(f[0].message.includes('-741') && f[0].message.includes(target));
    }
});

test('delegateChecks: 이유 문구가 원인을 짚는다', () => {
    const why = (target: string) => found(NEG([], `d = New LineSub(AddressOf DLP_Neg.${target})`))[0].message;
    assert.ok(why('IntTarget').includes('형이 다름'));
    assert.ok(why('RefTarget').includes('ByVal/ByRef'));
    assert.ok(why('FnTarget').includes('Sub 템플릿에 Function'));
    assert.ok(why('TwoTarget').includes('개수'));
});

test('delegateChecks: 시그니처가 맞는 대상·bare 이름·private 모듈 Sub 는 경고하지 않는다(D0·D7)', () => {
    assert.deepStrictEqual(codes(NEG([], 'd = New LineSub(AddressOf DLP_Neg.GoodTarget)')), []);
    assert.deepStrictEqual(codes(NEG([], 'd = New LineSub(AddressOf GoodTarget)')), []);
    assert.deepStrictEqual(codes(NEG(['    Private Sub Hidden(ByVal line As String)', '    End Sub'], 'd = New LineSub(AddressOf DLP_Neg.Hidden)')), []);
});

test('delegateChecks: 오버로드 중 하나라도 맞으면 통과(34행), 모두 다르면 error', () => {
    const over = [
        '    Public Class Over',
        '        Public Sub OnLine(ByVal line As String)',
        '        End Sub',
        '        Public Sub OnLine(ByVal line As String, ByVal n As Integer)',
        '        End Sub',
        '    End Class',
    ];
    const use = (name: string) => NEG(over, 'Dim ov As New Over', `d = New LineSub(AddressOf ov.${name})`);
    assert.deepStrictEqual(codes(use('OnLine')), []);
    const noMatch = [
        '    Public Class Bad',
        '        Public Sub Run(ByVal n As Integer)',
        '        End Sub',
        '        Public Sub Run(ByVal a As String, ByVal b As String)',
        '        End Sub',
        '    End Class',
    ];
    const f = found(NEG(noMatch, 'Dim b As New Bad', 'd = New LineSub(AddressOf b.Run)'));
    assert.deepStrictEqual(f.map(x => x.code), ['delegate-signature-mismatch']);
    assert.ok(f[0].message.includes('2개 모두'));
});

test('delegateChecks: ByRef String 매개변수를 가진 Delegate Function 과 맞는 대상은 경고하지 않는다', () => {
    const text = src(
        'Module HC',
        '    Public Delegate Function HandCheckFn(ByVal job As Integer, ByRef codeText As String, ByRef err As String) As Boolean',
        '    Public Function Check(ByVal job As Integer, ByRef codeText As String, ByRef err As String) As Boolean',
        '        Return True',
        '    End Function',
        '    Public Sub Main()',
        '        Dim f As HandCheckFn',
        '        f = New HandCheckFn(AddressOf Check)',
        '    End Sub',
        'End Module',
    );
    assert.deepStrictEqual(codes(text), []);
});

test('delegateChecks: 대상을 풀 수 없으면(없는 이름·다른 파일 미조회) 조용히 넘어간다', () => {
    assert.deepStrictEqual(codes(NEG([], 'd = New LineSub(AddressOf Nowhere.Missing)')), []);
    assert.deepStrictEqual(codes(NEG([], 'd = New LineSub(AddressOf unknownVar.Run)')), []);
});

test('delegateChecks: 다른 파일의 delegate·대상도 조회로 해석한다', () => {
    const other = src(
        'Module Lib',
        '    Public Delegate Sub LineSub(ByVal line As String)',
        '    Public Sub IntTarget(ByVal n As Integer)',
        '    End Sub',
        'End Module',
    );
    const all: GPLSymbol[] = GPLParser.parseDocument(other, 'Lib.gpl');
    const lookup: CompilerSymbolLookup = {
        findAllByName: n => all.filter(s => s.name.toLowerCase() === n.toLowerCase()),
        isSameCompileUnit: () => true,
    };
    const main = src(
        'Module Main2',
        '    Public Sub Run()',
        '        Dim d As LineSub',
        '        d = New LineSub(AddressOf Lib.IntTarget)',
        '    End Sub',
        'End Module',
    );
    assert.deepStrictEqual(codes(main, lookup), ['delegate-signature-mismatch']);
    assert.deepStrictEqual(codes(main), []);
});

// ③ Delegate 매개변수 직접 호출

const PARAM_CALL = (call: string, paramDecl = 'ByVal h As SomeDelegate') => src(
    'Module M',
    '    Public Delegate Sub SomeDelegate(ByVal n As Integer)',
    `    Public Sub CallHook(${paramDecl}, ByVal sel As Integer)`,
    '        Dim fn As SomeDelegate',
    `        ${call}`,
    '    End Sub',
    'End Module',
);

test('delegateChecks: delegate 형 매개변수를 이름으로 바로 호출하면 error(-729)', () => {
    const f = found(PARAM_CALL('h(sel)'));
    assert.deepStrictEqual(f.map(x => x.code), ['delegate-parameter-direct-call']);
    assert.strictEqual(f[0].severity, 'error');
    assert.ok(f[0].message.includes('-729'));
    assert.strictEqual('        h(sel)'.slice(f[0].start, f[0].end), 'h');
    assert.deepStrictEqual(codes(PARAM_CALL('h(sel)', 'ByRef h As SomeDelegate')), ['delegate-parameter-direct-call']);
});

test('delegateChecks: 지역 변수에 복사한 delegate 호출은 경고하지 않는다', () => {
    assert.deepStrictEqual(codes(PARAM_CALL('fn = h : fn(sel)')), []);
});

test('delegateChecks: delegate 가 아닌 매개변수·배열 매개변수·점 뒤 이름은 경고하지 않는다', () => {
    assert.deepStrictEqual(codes(PARAM_CALL('h(sel)', 'ByVal h As Integer')), []);
    assert.deepStrictEqual(codes(PARAM_CALL('h(sel)', 'ByVal h() As SomeDelegate')), []);
    assert.deepStrictEqual(codes(PARAM_CALL('x.h(sel)')), []);
});

// ④ Mid(...).멤버

test('delegateChecks: Mid(...) 결과에 바로 멤버 접근은 warning(-712)', () => {
    const [f] = found(src('Module M', '    Public Sub T(ByVal s As String, ByVal p As Integer)', '        Dim axes As String()', '        axes = Mid(s, p).Split("+")', '    End Sub', 'End Module'));
    assert.strictEqual(f.code, 'mid-member-access');
    assert.strictEqual(f.severity, 'warning');
    assert.ok(f.message.includes('-712'));
    assert.strictEqual('        axes = Mid(s, p).Split("+")'.slice(f.start, f.end), 'Mid(s, p)');
});

test('delegateChecks: 다른 내장 함수·Mid 의 일반 사용은 경고하지 않는다', () => {
    const body = (line: string) => src('Module M', '    Public Sub T(ByVal s As String, ByVal p As Integer)', '        Dim x As String', `        ${line}`, '    End Sub', 'End Module');
    assert.deepStrictEqual(codes(body('x = UCase(s).Trim()')), []);
    assert.deepStrictEqual(codes(body('x = Mid(s, p) & "a"')), []);
    assert.deepStrictEqual(codes(body('x = Mid(Mid(s, 1, 4), p)')), []);
    assert.deepStrictEqual(codes(body('x = a.Mid(s, p).Length')), []);
    assert.deepStrictEqual(codes(body('x = Mid(s, p) \' .Split')), []);
});

// ⑤ Mid(<임시 문자열 식>, …) — 메모리 누수 (inbox 2026-11-06 mid-temp-leak-and-memory-costs §1)

function midTemp(line: string, extra: string[] = []) {
    const content = src('Module M', ...extra, '    Public Sub T(ByVal s As String, ByVal i As Integer)', '        Dim x As String', `        ${line}`, '    End Sub', 'End Module');
    return findCompilerCheckFindings(content, 'Main.gpl').filter(f => f.code === 'mid-temporary-argument');
}

test('delegateChecks: Mid 첫 인자가 & 연결·문자열 함수 결과면 information, 범위는 첫 인자', () => {
    const line = 'x = Mid(CStr(i) & s, 1, 10)';
    const [f] = midTemp(line);
    assert.strictEqual(f.severity, 'information');
    assert.ok(f.message.includes('120자') && f.message.includes('320 B'));
    assert.strictEqual(`        ${line}`.slice(f.start, f.end), 'CStr(i) & s');
    assert.strictEqual(midTemp('x = Mid(UCase(s), 2, 250)').length, 1);
    assert.strictEqual(midTemp('x = Mid(CStr(i) & s, 5)').length, 1, '길이 인자를 생략해도 샌다(실측)');
    // 사용자 Function 의 결과는 새지 않았다(2026-11-06 실측 표) — 그 안에서 만든 임시값도.
    const build = ['    Public Function Build(ByVal a As String) As String', '        Return a', '    End Function'];
    assert.strictEqual(midTemp('x = Mid(Build(s), 1, 5)', build).length, 0, '사용자 String 함수');
    assert.strictEqual(midTemp('x = Mid(Build(s & "a"), 1, 5)', build).length, 0, '괄호 안의 & 는 사용자 함수가 받는다');
});

test('delegateChecks: Mid 첫 인자가 변수·배열 요소·숫자 함수면 조용히 넘어간다(보고의 새지 않는 형태)', () => {
    assert.deepStrictEqual(midTemp('x = Mid(s, 2, 250)'), []);
    assert.deepStrictEqual(midTemp('x = Mid(arr(i), 1, 3)'), []);
    assert.deepStrictEqual(midTemp('x = Mid(s, Len(s & "a"), 1)'), [], '& 가 첫 인자가 아니면 아님');
    assert.deepStrictEqual(midTemp('x = Mid(s, Count(i), 1)', ['    Public Function Count(ByVal a As Integer) As Integer', '        Return a', '    End Function']), []);
    assert.deepStrictEqual(midTemp('x = UCase(CStr(i) & s)'), []);
});

// 메모리 실측 정보 진단 (memoryChecks.ts, Sample Prep 2026-11-06 cost-table §2.2)

test('memoryChecks: 클래스 인스턴스 String 필드의 = "" 초기화만 information, Shared·모듈 변수·Nothing 은 조용히', () => {
    const content = src(
        'Module M',
        '    Private Dim moduleText As String = ""',
        '    Public Class Node',
        '        Public Name As String = ""',
        '        Private Dim note As String = "" \' 주석',
        '        Public Shared Pool As String = ""',
        '        Public Label As String',
        '        Public Code As String = "A"',
        '    End Class',
        'End Module',
    );
    const f = findCompilerCheckFindings(content, 'Main.gpl').filter(x => x.code === 'string-field-empty-init');
    assert.deepStrictEqual(f.map(x => x.line), [3, 4]);
    assert.strictEqual(f[0].severity, 'information');
    assert.ok(f[0].message.includes('183 B') && f[0].message.includes('-782'));
    assert.strictEqual('        Public Name As String = ""'.slice(f[0].start, f[0].end), '= ""');
});
