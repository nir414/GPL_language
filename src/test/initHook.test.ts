import * as assert from 'assert';
import { test } from './harness';
import { GPLParser } from '../language/gplParser';
import { findInitHookFindings } from '../language/initHook';

// ─── `Init` 모듈 초기화 훅 규칙 (§1-EA, samples/init-probe 로 2026-09-21 실기 재현) ───

const STAGE_B = [
    'Module ProbeLib',
    '    Public Class Probe',
    '        Private Dim m_buf As String',
    '        Public Sub New()',
    '            Init()',
    '        End Sub',
    '        Private Sub Init()',
    '            m_buf = ""',
    '        End Sub',
    '    End Class',
    'End Module',
    'Module Main',
    '    Public Sub Main()',
    '        Dim p As New Probe()',
    '    End Sub',
    'End Module',
].join('\n');

test('initHook: 클래스 멤버 Init 은 warning — GenAdp/-757 사고 경로', () => {
    const findings = findInitHookFindings(GPLParser.parseDocument(STAGE_B, 'StageB.gpl'));
    assert.strictEqual(findings.length, 1);
    const f = findings[0];
    assert.strictEqual(f.code, 'init-hook-class-member');
    assert.strictEqual(f.severity, 'warning');
    assert.strictEqual(f.symbol.className, 'Probe');
    assert.strictEqual(f.symbol.line, 6, '`Private Sub Init()` 선언 줄(0 기반)');
    assert.ok(f.message.includes('-757') && f.message.includes('인스턴스 없이'));
});

test('initHook: 모듈 수준 Sub Init 은 hint — 문서화된 합법 훅(레거시의 빈 Init 은 소음이 아니다)', () => {
    const legacy = [
        'Module Main',
        '    Public Sub Init',
        "        ' All Thread run this Init....",
        '    End Sub',
        '    Public Sub MAIN()',
        '    End Sub',
        'End Module',
    ].join('\n');
    const findings = findInitHookFindings(GPLParser.parseDocument(legacy, 'Main.gpl'));
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].code, 'init-hook-module');
    assert.strictEqual(findings[0].severity, 'hint', 'Problems 패널에 올라가지 않는 수준이어야 한다');
    assert.ok(findings[0].message.includes('자동 호출'));
});

test('initHook: _Init 은 error — 컴파일러 내부 이름', () => {
    const src = ['Module M', '    Public Sub _Init()', '    End Sub', 'End Module'].join('\n');
    const findings = findInitHookFindings(GPLParser.parseDocument(src, 'M.gpl'));
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].code, 'init-hook-internal-name');
    assert.strictEqual(findings[0].severity, 'error');
});

test('initHook: 대소문자 무시, 다른 이름·변수·호출은 무시', () => {
    const src = [
        'Module M',
        '    Public Dim Init As Integer',        // 변수 — 프로시저가 아니다
        '    Public Sub InitDefaults()',          // 개명된 형태 — 훅이 아니다
        '        Init = 1',                       // 호출/대입 — 선언이 아니다
        '    End Sub',
        '    Public Class C',
        '        Public Function INIT() As Integer',   // 대소문자 달라도 클래스 멤버 Init
        '            Return 0',
        '        End Function',
        '    End Class',
        'End Module',
    ].join('\n');
    const findings = findInitHookFindings(GPLParser.parseDocument(src, 'M.gpl'));
    assert.deepStrictEqual(findings.map(f => f.code), ['init-hook-class-member']);
    assert.strictEqual(findings[0].symbol.name, 'INIT');
});
