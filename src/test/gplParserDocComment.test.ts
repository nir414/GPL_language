import * as assert from 'assert';
import { test } from './harness';
import { GPLParser, GPLSymbolKind } from '../gplParser';

// 선언 위의 연속 `'` 주석 블록이 docComment로 수집되는지 회귀 검사.
// 대상은 Module/Class/Sub/Function/Property/변수/상수 **모든 선언 종류**다
// (hover / completion / signature help가 사용자 정의 심볼 설명을 보여주기 위한 기반)

function parse(src: string) {
    return GPLParser.parseDocument(src, '/virtual/doc.gpl');
}
function find(src: string, name: string) {
    return parse(src).find(s => s.name === name);
}

test('docComment: Function 바로 위 연속 주석 블록을 수집한다', () => {
    const src = [
        'Module M',
        "    ' Adds two integers.",
        "    ' Returns the sum.",
        '    Public Function Add(a As Integer, b As Integer) As Integer',
        '        Return a + b',
        '    End Function',
        'End Module'
    ].join('\n');
    const sym = find(src, 'Add');
    assert.ok(sym, 'Add 심볼이 파싱되어야 한다');
    assert.strictEqual(sym!.kind, GPLSymbolKind.Function);
    assert.strictEqual(sym!.docComment, 'Adds two integers.\nReturns the sum.');
});

test('docComment: 주석이 없으면 undefined', () => {
    const src = [
        'Module M',
        '    Public Sub NoDoc()',
        '    End Sub',
        'End Module'
    ].join('\n');
    assert.strictEqual(find(src, 'NoDoc')!.docComment, undefined);
});

test('docComment: 주석과 선언 사이 빈 줄이 있으면 붙지 않는다', () => {
    const src = [
        'Module M',
        "    ' Separated by a blank line.",
        '',
        '    Public Sub HasBlankAbove()',
        '    End Sub',
        'End Module'
    ].join('\n');
    assert.strictEqual(find(src, 'HasBlankAbove')!.docComment, undefined);
});

test('docComment: 앞선 다른 선언으로 인해 주석이 누수되지 않는다', () => {
    const src = [
        'Module M',
        "    ' doc for variable",
        '    Public Dim x As Integer',
        '    Public Function AfterVar() As Integer',
        '    End Function',
        'End Module'
    ].join('\n');
    assert.strictEqual(find(src, 'AfterVar')!.docComment, undefined);
});

test('docComment: Property에도 주석이 수집된다', () => {
    const src = [
        'Module M',
        '    Public Class C',
        "        ' Current speed in mm/s.",
        '        Public ReadOnly Property Speed As Double',
        '        End Property',
        '    End Class',
        'End Module'
    ].join('\n');
    const sym = find(src, 'Speed');
    assert.ok(sym, 'Speed 심볼이 파싱되어야 한다');
    assert.strictEqual(sym!.docComment, 'Current speed in mm/s.');
});

test('docComment: Module 선언에도 주석이 수집된다', () => {
    const src = [
        "' Robot motion helpers.",
        "' Shared by every station task.",
        'Module Motion',
        'End Module'
    ].join('\n');
    const sym = find(src, 'Motion');
    assert.ok(sym, 'Motion 심볼이 파싱되어야 한다');
    assert.strictEqual(sym!.kind, GPLSymbolKind.Module);
    assert.strictEqual(sym!.docComment, 'Robot motion helpers.\nShared by every station task.');
});

test('docComment: Class 선언에도 주석이 수집된다', () => {
    const src = [
        'Module M',
        "    ' One pick-and-place step.",
        '    Public Class StepBatch',
        '    End Class',
        'End Module'
    ].join('\n');
    const sym = find(src, 'StepBatch');
    assert.ok(sym, 'StepBatch 심볼이 파싱되어야 한다');
    assert.strictEqual(sym!.kind, GPLSymbolKind.Class);
    assert.strictEqual(sym!.docComment, 'One pick-and-place step.');
});

test('docComment: 중첩 클래스에도 주석이 수집된다', () => {
    const src = [
        'Module M',
        '    Public Class Outer',
        "        ' Inner detail holder.",
        '        Public Class Inner',
        '        End Class',
        '    End Class',
        'End Module'
    ].join('\n');
    assert.strictEqual(find(src, 'Inner')!.docComment, 'Inner detail holder.');
});

test('docComment: 모듈/클래스 멤버 변수에도 주석이 수집된다', () => {
    const src = [
        'Module M',
        "    ' Echo every console command.",
        '    Public Shared Dim echoMode As Boolean',
        "    ' Cached station poses.",
        '    Public Shared poses(10) As Location',
        "    ' Lazily created store.",
        '    Public Dim storeA As New XmlStore',
        'End Module'
    ].join('\n');
    assert.strictEqual(find(src, 'echoMode')!.docComment, 'Echo every console command.');
    assert.strictEqual(find(src, 'poses')!.docComment, 'Cached station poses.');
    assert.strictEqual(find(src, 'storeA')!.docComment, 'Lazily created store.');
});

test('docComment: 상수 선언에도 주석이 수집된다', () => {
    const src = [
        'Module M',
        "    ' DataID of the gripper output signal.",
        '    Const GripperSignal As Integer = 1869',
        'End Module'
    ].join('\n');
    const sym = find(src, 'GripperSignal');
    assert.ok(sym, 'GripperSignal 심볼이 파싱되어야 한다');
    assert.strictEqual(sym!.kind, GPLSymbolKind.Constant);
    assert.strictEqual(sym!.docComment, 'DataID of the gripper output signal.');
});

test('docComment: 로컬 선언에도 주석이 수집된다 (includeLocals)', () => {
    const src = [
        'Module M',
        '    Public Sub Run()',
        "        ' Retry budget for the pick attempt.",
        '        Dim retries As Integer = 3',
        "        ' Scratch pose reused per loop.",
        '        Dim here As New Location',
        '    End Sub',
        'End Module'
    ].join('\n');
    const symbols = GPLParser.parseDocument(src, '/virtual/local.gpl', { includeLocals: true });
    assert.strictEqual(symbols.find(s => s.name === 'retries')!.docComment, 'Retry budget for the pick attempt.');
    assert.strictEqual(symbols.find(s => s.name === 'here')!.docComment, 'Scratch pose reused per loop.');
});

test('docComment: 구조화 머리글이 있는 Class 주석도 원문 그대로 수집된다', () => {
    const src = [
        'Module M',
        "    ' Batch of motion steps.",
        "    '",
        "    ' # Remarks",
        "    ' Not thread-safe.",
        '    Public Class Batch',
        '    End Class',
        'End Module'
    ].join('\n');
    assert.strictEqual(
        find(src, 'Batch')!.docComment,
        'Batch of motion steps.\n\n# Remarks\nNot thread-safe.'
    );
});
