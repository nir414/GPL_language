import * as assert from 'assert';
import { test } from '../../harness';
import { analyzeSourceReferences, computeReachableSources } from '../../../project/sources/sourceReachability';

const lines = (...l: string[]): string => l.join('\r\n');

test('sourceReachability: 선언 이름 = Module·Class 이름 + 모듈 직속 비-Private 멤버(클래스 멤버·지역·Private 제외)', () => {
    const info = analyzeSourceReferences(lines(
        'Module PRA',
        '    Public Const MaxLen As Integer = 10',
        '    Public Dim Shared_Buf As String',
        '    Private Dim hidden As Integer',
        '    Public Sub ParseLine(s As String)',
        '        Dim localVar As Integer',
        '    End Sub',
        '    Public Class Token',
        '        Public Sub Advance()',
        '        End Sub',
        '    End Class',
        'End Module',
    ), 'C:\\t\\Core_Parse.gpl');
    assert.deepStrictEqual(info.declared.sort(), ['maxlen', 'parseline', 'pra', 'shared_buf', 'token']);
    assert.deepStrictEqual(info.containers, ['PRA', 'Token']);
});

test('sourceReachability: 낱말은 주석을 빼고 문자열 안 이름은 포함한다', () => {
    const info = analyzeSourceReferences(lines(
        'Module App',
        '    Public Sub Main()',
        '        Dim t As New Thread("FLR.RecorderLoop", 1) \' NLG.Write 는 주석이라 참조 아님',
        '    End Sub',
        'End Module',
    ), 'C:\\t\\App.gpl');
    assert.ok(info.words.has('flr'), '문자열 안 모듈 이름');
    assert.ok(!info.words.has('recorderloop'), '점 뒤 멤버 이름은 수식된 접근이라 참조 낱말이 아니다');
    assert.ok(!info.words.has('nlg'));
    const member = analyzeSourceReferences(lines('Module M', '    Public Sub F()', '        EXC.ThrowError(RWK.ERR_TIMEOUT, "x")', '        obj . Start()', '    End Sub', 'End Module'), 'C:/t/M.gpl');
    assert.ok(member.words.has('rwk') && member.words.has('exc') && member.words.has('obj'));
    assert.ok(!member.words.has('err_timeout') && !member.words.has('start') && !member.words.has('throwerror'));
});

test('sourceReachability: 전이적으로 닿는 파일만, 모듈 이름 생략 호출·문자열 진입점도 따라간다', () => {
    const files = new Map([
        ['app', analyzeSourceReferences(lines('Module App', '    Public Sub Main()', '        PRA.ParseLine("x")', '        StartRecorder()', '    End Sub', 'End Module'), 'C:\\r\\App.gpl')],
        ['pra', analyzeSourceReferences(lines('Module PRA', '    Public Sub ParseLine(s As String)', '        TXT.Trim2(s)', '    End Sub', 'End Module'), 'C:\\r\\PRA.gpl')],
        ['txt', analyzeSourceReferences(lines('Module TXT', '    Public Function Trim2(s As String) As String', '        Return s', '    End Function', 'End Module'), 'C:\\r\\TXT.gpl')],
        // 모듈 이름을 생략한 호출(StartRecorder) — 문서상 이름이 유일하면 허용된다.
        ['rec', analyzeSourceReferences(lines('Module REC', '    Public Sub StartRecorder()', '        Dim t As New Thread("FLR.RecorderLoop", 1)', '    End Sub', 'End Module'), 'C:\\r\\REC.gpl')],
        ['flr', analyzeSourceReferences(lines('Module FLR', '    Public Sub RecorderLoop()', '    End Sub', 'End Module'), 'C:\\r\\FLR.gpl')],
        ['unused', analyzeSourceReferences(lines('Module NTC', '    Public Sub Connect()', '    End Sub', 'End Module'), 'C:\\r\\NTC.gpl')],
        ['empty', analyzeSourceReferences("' 빈 파일\r\n", 'C:\\r\\Empty.gpl')],
    ]);
    const reach = computeReachableSources(files, ['app']);
    assert.deepStrictEqual([...reach].sort(), ['app', 'empty', 'flr', 'pra', 'rec', 'txt']);
});

test('sourceReachability: 자기 파일이 모듈 직속으로 선언한 이름은 다른 파일 참조가 아니다(흔한 상수 이름 오포함 방지)', () => {
    const files = new Map([
        ['app', analyzeSourceReferences(lines('Module App', '    Private Const POLL_MS As Integer = 10', '    Public Sub Main()', '        Thread.Sleep(POLL_MS)', '        CYL2.Extend()', '    End Sub', 'End Module'), 'C:/s/App.gpl')],
        ['cyl', analyzeSourceReferences(lines('Module CYL', '    Public Const POLL_MS As Integer = 20', 'End Module'), 'C:/s/Cyl.gpl')],
        ['cyl2', analyzeSourceReferences(lines('Module CYL2', '    Public Sub Extend()', '    End Sub', 'End Module'), 'C:/s/Cyl2.gpl')],
    ]);
    assert.deepStrictEqual([...computeReachableSources(files, ['app'])].sort(), ['app', 'cyl2']);
});

test('sourceReachability: 같은 Module 을 나눠 쓴 파일은 함께 닿는다', () => {
    const files = new Map([
        ['app', analyzeSourceReferences(lines('Module App', '    Public Sub Main()', '        PRA.A()', '    End Sub', 'End Module'), 'C:/m/App.gpl')],
        ['pra1', analyzeSourceReferences(lines('Module PRA', '    Public Sub A()', '        B()', '    End Sub', 'End Module'), 'C:/m/Pra1.gpl')],
        ['pra2', analyzeSourceReferences(lines('Module PRA', '    Private Sub B()', '    End Sub', 'End Module'), 'C:/m/Pra2.gpl')],
    ]);
    assert.deepStrictEqual([...computeReachableSources(files, ['app'])].sort(), ['app', 'pra1', 'pra2']);
});
