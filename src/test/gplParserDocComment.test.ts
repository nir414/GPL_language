import * as assert from 'assert';
import { test } from './harness';
import { GPLParser, GPLSymbolKind } from '../gplParser';

// 함수/Sub/Property 위의 연속 `'` 주석 블록이 docComment로 수집되는지 회귀 검사.
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
