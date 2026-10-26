import * as assert from 'assert';
import { test } from './harness';
import { GPLParser, GPLSymbol } from '../language/gplParser';
import { CompilerCheckCode, CompilerSymbolLookup, findCompilerCheckFindings } from '../language/compilerChecks';

// ─── 실기 확인 컴파일러·제어기 사실 검사 (inbox 2026-10-22~25 보고) ───

function src(...lines: string[]): string {
    return lines.join('\n');
}

function codes(content: string, lookup?: CompilerSymbolLookup, file = 'Main.gpl'): CompilerCheckCode[] {
    return findCompilerCheckFindings(content, file, lookup).map(f => f.code);
}

function only(content: string, code: CompilerCheckCode, lookup?: CompilerSymbolLookup) {
    return findCompilerCheckFindings(content, 'Main.gpl', lookup).filter(f => f.code === code);
}

/** 다른 파일들을 파싱해 SymbolCache 처럼 이름으로 돌려주는 조회. */
function lookupOf(files: Record<string, string>, sameUnit: (candidate: string) => boolean = () => true): CompilerSymbolLookup {
    const all: GPLSymbol[] = [];
    for (const [file, text] of Object.entries(files)) {
        all.push(...GPLParser.parseDocument(text, file));
    }
    return {
        findAllByName: name => all.filter(s => s.name.toLowerCase() === name.toLowerCase()),
        isSameCompileUnit: candidate => sameUnit(candidate),
    };
}

// ① 반환형이 다른 오버로드 — -741 은 뒤 선언에서

test('compilerChecks: 반환형이 다른 오버로드는 뒤 선언에 warning', () => {
    const text = src(
        'Module LRS',
        '    Public Function ReadFeedback(ByRef a As Integer, ByRef b As Integer) As Integer',
        '        Return 0',
        '    End Function',
        '    Public Function ReadFeedback() As LeadshineFeedbackResult',
        '        Return Nothing',
        '    End Function',
        'End Module',
    );
    const found = only(text, 'overload-return-type-mismatch');
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].line, 4);
    assert.strictEqual(found[0].severity, 'warning');
    assert.strictEqual(text.split('\n')[4].slice(found[0].start, found[0].end), 'ReadFeedback');
    assert.ok(found[0].message.includes('-741'));
    assert.ok(found[0].message.includes('2행'));
});

test('compilerChecks: 반환형이 같고 인자 수만 다른 오버로드는 합법', () => {
    const text = src(
        'Module HFM',
        '    Public Function Fail(a As Integer, b As String) As Integer',
        '    End Function',
        '    Public Function Fail(a As Integer, b As String, c As String) As integer',
        '    End Function',
        '    Public Class Other',
        '        Public Function Fail() As String',
        '        End Function',
        '    End Class',
        'End Module',
    );
    assert.deepStrictEqual(only(text, 'overload-return-type-mismatch'), []);
});

// ② Sub New 없는 클래스의 New X()

const NO_CTOR = src(
    'Module LRS',
    '    Public Class LeadshineFeedbackResult',
    '        Public ok As Boolean',
    '    End Class',
    '    Public Class WithCtor',
    '        Public Sub New()',
    '        End Sub',
    '    End Class',
    '    Public Sub Main()',
    '        Dim result As LeadshineFeedbackResult',
    '        result = New LeadshineFeedbackResult()',
    '        result = New LeadshineFeedbackResult',
    '        Dim w As New WithCtor()',
    '        Dim m As New Mutex()',
    '        Dim s As String = "New LeadshineFeedbackResult()" \' New LeadshineFeedbackResult()',
    '    End Sub',
    'End Module',
);

test('compilerChecks: Sub New 없는 사용자 클래스의 New X() 만 warning, 범위는 괄호', () => {
    const found = only(NO_CTOR, 'new-parens-without-constructor');
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].line, 10);
    assert.strictEqual(found[0].severity, 'warning');
    assert.strictEqual(NO_CTOR.split('\n')[10].slice(found[0].start, found[0].end), '()');
    assert.ok(found[0].message.includes('-722'));
});

test('compilerChecks: 다른 파일 클래스도 조회로 판정 — 생성자가 있으면 넘어간다', () => {
    const user = src('Module App', '    Public Sub Main()', '        Dim a As Foo = New Foo()', '        Dim b As Bar = New Bar()', '    End Sub', 'End Module');
    const lookup = lookupOf({
        'Lib.gpl': src('Module L', '    Public Class Foo', '    End Class', '    Public Class Bar', '        Public Sub New()', '        End Sub', '    End Class', 'End Module'),
    });
    const found = only(user, 'new-parens-without-constructor', lookup);
    assert.strictEqual(found.length, 1);
    assert.ok(found[0].message.includes('Lib.gpl:2'));
    assert.strictEqual(found[0].line, 2);
    // 다른 컴파일 단위의 클래스는 보지 않는다
    assert.deepStrictEqual(only(user, 'new-parens-without-constructor', lookupOf({ 'Lib.gpl': src('Module L', '    Public Class Foo', '    End Class', 'End Module') }, () => false)), []);
});

// ③ 멤버 이름이 Module 이름을 가림

const ROBOT_UNIT = src(
    'Module RBU',
    '    Public Class RobotUnit',
    '        Public Function Num() As Integer',
    '            Return 1',
    '        End Function',
    '        Public Function Text(j As Integer) As String',
    '            Return NUM.FixedText(j, 3)',
    '        End Function',
    '    End Class',
    '    Public Function Outside() As String',
    '        Return NUM.FixedText(1, 3)',
    '    End Function',
    'End Module',
);
const NUMBERS = { 'Numbers.gpl': src('Module NUM', '    Public Function FixedText(v As Double, d As Integer) As String', '    End Function', 'End Module') };

test('compilerChecks: 클래스 멤버 Num 이 Module NUM 을 가리면 그 클래스 안 NUM.x 에 warning', () => {
    const found = only(ROBOT_UNIT, 'member-shadows-module', lookupOf(NUMBERS));
    assert.strictEqual(found.length, 1, JSON.stringify(found));
    assert.strictEqual(found[0].line, 6);
    assert.strictEqual(ROBOT_UNIT.split('\n')[6].slice(found[0].start, found[0].end), 'NUM');
    assert.ok(found[0].message.includes('Numbers.gpl:1'));
    assert.ok(found[0].message.includes('-781'));
    // 모듈 정보가 없으면 판정하지 않는다
    assert.deepStrictEqual(only(ROBOT_UNIT, 'member-shadows-module'), []);
});

test('compilerChecks: 멤버 타입이 그 멤버를 가지면 의도한 필드 접근이라 넘어간다', () => {
    const text = src(
        'Module App',
        '    Public Class Worker',
        '        Private log As Logger',
        '        Public Sub Run()',
        '            log.Write("a")',
        '        End Sub',
        '    End Class',
        '    Public Class Logger',
        '        Public Sub Write(s As String)',
        '        End Sub',
        '    End Class',
        'End Module',
    );
    const lookup = lookupOf({ 'Log.gpl': src('Module LOG', '    Public Sub Write(s As String)', '    End Sub', 'End Module') });
    assert.deepStrictEqual(only(text, 'member-shadows-module', lookup), []);
});

// ④ 긴 문자열 리터럴

test('compilerChecks: 100바이트 초과 리터럴만 information', () => {
    const ok = 'a'.repeat(100);
    const long = 'b'.repeat(118);
    const text = src(
        'Module M',
        '    Public Sub Main()',
        `        Dim a As String = "${ok}"`,
        `        Dim b As String = "${long}" & "${ok}"`,
        `        ' "${long}"`,
        '    End Sub',
        'End Module',
    );
    const found = only(text, 'string-literal-too-long');
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].line, 3);
    assert.strictEqual(found[0].severity, 'information');
    assert.strictEqual(text.split('\n')[3].slice(found[0].start, found[0].end), `"${long}"`);
    assert.ok(found[0].message.includes('118바이트'));
    assert.ok(found[0].message.includes('확인되지 않았습니다'));
});

// ⑤ Stop 으로 멈출 수 없는 쓰레드 이름

test('compilerChecks: New Thread 이름 리터럴에 [ ] : 공백이 있으면 warning', () => {
    const text = src(
        'Module M',
        '    Public Sub Main()',
        '        Dim t1 As New Thread("Worker.Run", , "RWK[" & CStr(i) & "]")',
        '        Dim t2 As New Thread("Server.Listen", , "TCPLSN:" & CStr(port))',
        '        Dim t3 As New Thread("Pump.Run", , "TCPCMD")',
        '        Dim t4 As New Thread("Pump.Run", , "RWK_" & CStr(i))',
        '        Dim t5 As New Thread("Pump.Run", , name)',
        '        Dim t6 As New Thread("Pump.Run", "Proj", "AB CD", 4)',
        '        Dim t7 As New Thread("Pump.Run", , _',
        '            "X:1")',
        '    End Sub',
        'End Module',
    );
    const found = only(text, 'thread-name-unstoppable');
    assert.deepStrictEqual(found.map(f => f.line), [2, 3, 7, 9]);
    assert.ok(found[0].message.includes('`[`') && found[0].message.includes('`]`'));
    assert.ok(found[2].message.includes('공백'));
    assert.ok(found.every(f => f.severity === 'warning' && f.message.includes('-712')));
    // 이어진 줄의 인자는 그 줄 위치로 되돌린다
    assert.strictEqual(text.split(/\n/)[9].slice(found[3].start, found[3].end), '"X:1"');
});

// ⑥ 다른 클래스의 Private Shared

const POSE = src(
    'Module RPS',
    '    Public Class JointPose',
    '        Private Shared Function ClampCount(n As Integer) As Integer',
    '            Return n',
    '        End Function',
    '        Public Sub Use()',
    '            Dim k As Integer = ClampCount(3)',
    '        End Sub',
    '    End Class',
    '    Public Class JointPoseTable',
    '        Public Sub New()',
    '            Dim a As Integer = JointPose.ClampCount(1)',
    '            Dim b As Integer = ClampCount(2)',
    '        End Sub',
    '    End Class',
    'End Module',
);

test('compilerChecks: 다른 클래스의 Private Shared 접근(한정·비한정)은 warning, 자기 클래스는 넘어간다', () => {
    const found = only(POSE, 'private-shared-outside-class');
    assert.deepStrictEqual(found.map(f => f.line), [11, 12]);
    assert.strictEqual(POSE.split('\n')[11].slice(found[0].start, found[0].end), 'JointPose.ClampCount');
    assert.ok(found[0].message.includes('-729'));
    assert.ok(found[0].message.includes('Private Function'));
});

test('compilerChecks: Public Shared·같은 이름 지역 변수·다른 파일 Private Shared', () => {
    const text = src(
        'Module RPS',
        '    Public Class A',
        '        Public Shared Function Helper() As Integer',
        '        End Function',
        '        Private Shared Function Hidden() As Integer',
        '        End Function',
        '    End Class',
        '    Public Class B',
        '        Public Sub Run()',
        '            Dim Hidden As Integer',
        '            Hidden = A.Helper()',
        '            Hidden = Ext.Secret()',
        '        End Sub',
        '    End Class',
        'End Module',
    );
    const lookup = lookupOf({ 'Ext.gpl': src('Module X', '    Public Class Ext', '        Private Shared Function Secret() As Integer', '        End Function', '    End Class', 'End Module') });
    const found = only(text, 'private-shared-outside-class', lookup);
    assert.deepStrictEqual(found.map(f => f.line), [11]);
    assert.ok(found[0].message.includes('Ext.gpl:3'));
});

// ⑦ ByVal String 매개변수의 Is Nothing

test('compilerChecks: ByVal(생략 포함) String 매개변수의 Is Nothing 은 information, ByRef 는 넘어간다', () => {
    const text = src(
        'Module PRS',
        '    Public Function IsNullOrEmpty(s As String) As Boolean',
        '        If s Is Nothing Then Return True',
        '        Return Len(s) = 0',
        '    End Function',
        '    Public Function SafeStr(ByVal s As String) As String',
        '        If Not s Is Nothing Then Return s',
        '        Return ""',
        '    End Function',
        '    Public Function HasText(ByRef s As String) As Boolean',
        '        If s Is Nothing Then Return False',
        '    End Function',
        '    Public Function Arr(s() As String) As Boolean',
        '        If s Is Nothing Then Return False',
        '    End Function',
        '    Public Function Reassigned(s As String) As Boolean',
        '        s = ReadIt()',
        '        If s Is Nothing Then Return False',
        '    End Function',
        'End Module',
    );
    const found = only(text, 'byval-string-nothing-check');
    assert.deepStrictEqual(found.map(f => f.line), [2, 6]);
    assert.strictEqual(text.split('\n')[2].slice(found[0].start, found[0].end), 's Is Nothing');
    assert.ok(found.every(f => f.severity === 'information' && f.message.includes('-782') && f.message.includes('ByRef s As String')));
});

// ⑧ tick 모드 조그 속도

test('compilerChecks: SetJogCommand 속도 리터럴 0 초과 5 이하만 information', () => {
    const text = src(
        'Module M',
        '    Public Sub Jog(axis As Integer, speed As Double)',
        '        Move.SetJogCommand(1, axis, -1.43)',
        '        Move.SetJogCommand(1, axis, 5)',
        '        Move.SetJogCommand(1, axis, 5.5)',
        '        Move.SetJogCommand(1, axis, 0)',
        '        Move.SetJogCommand(1, axis, speed)',
        '        Move.SetJogCommand(1, axis, -7.14)',
        '    End Sub',
        'End Module',
    );
    const found = only(text, 'jog-tick-mode-speed');
    assert.deepStrictEqual(found.map(f => f.line), [2, 3]);
    assert.strictEqual(text.split('\n')[2].slice(found[0].start, found[0].end), '-1.43');
    assert.ok(found[0].message.includes('1.43%') && found[0].message.includes('tick'));
});

test('compilerChecks: 깨끗한 소스는 결과가 없다', () => {
    const text = src(
        'Module Main',
        '    Public Class Pt',
        '        Public Sub New()',
        '        End Sub',
        '    End Class',
        '    Public Sub Main()',
        '        Dim p As New Pt()',
        '        Dim t As New Thread("Main.Worker", , "WORKER_0")',
        '        Move.SetJogCommand(1, 2, 10)',
        '    End Sub',
        'End Module',
    );
    assert.deepStrictEqual(codes(text), []);
});
