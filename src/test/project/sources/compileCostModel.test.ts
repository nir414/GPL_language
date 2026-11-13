import * as assert from 'assert';
import { test } from '../../harness';
import { COMPILE_COST, estimateSourceCompileBytes } from '../../../project/sources/compileCostModel';

const lines = (...l: string[]): string => l.join('\r\n');

test('compileCostModel: 실측 단가 합 — Module 껍데기·Sub·인자·Function·문장·지역 Dim·Const·변수·Class', () => {
    const c = COMPILE_COST;
    // 보고서의 변형과 같은 꼴: 빈 Sub 165, 인자 1개 386, 인자 4개 691(±2), 인자 없는 Function + Return 1.
    assert.strictEqual(estimateSourceCompileBytes(lines('Module M', '    Sub A()', '    End Sub', 'End Module')), c.moduleShell + 165);
    assert.strictEqual(estimateSourceCompileBytes(lines('Module M', '    Sub A(ByVal x As Integer)', '    End Sub', 'End Module')) - c.moduleShell, 386);
    assert.ok(Math.abs(estimateSourceCompileBytes(lines('Module M', '    Sub A(a As Integer, b As Integer, c As Integer, d As Integer)', '    End Sub', 'End Module')) - c.moduleShell - 691) <= 3);
    const fn = estimateSourceCompileBytes(lines('Module M', '    Function F() As Integer', '        Dim d As Double', '        Return 1', '    End Function', 'End Module'));
    assert.strictEqual(fn, c.moduleShell + c.procedureHead + c.functionExtra + c.localDim + c.statement);
    const decls = estimateSourceCompileBytes(lines(
        'Module M',
        '    Private Const N As Integer = 3',
        '    Public Const NAME As String = "abcdefghijklmnopqrstuvwxy"',
        '    Private d As Double, e As Double',
        '    Public Class K',
        '        Public x As Integer',
        '    End Class',
        'End Module',
    ));
    assert.strictEqual(decls, c.moduleShell + c.constant + (c.stringConstantBase + 25) + 2 * c.variable + c.classShell + c.variable);
});

test('compileCostModel: 주석·빈 줄은 0, 구조를 못 읽는 파일은 코드 줄 × 문장 평균', () => {
    const base = estimateSourceCompileBytes(lines('Module M', '    Sub A()', '        x = 1', '    End Sub', 'End Module'));
    assert.strictEqual(estimateSourceCompileBytes(lines("' 머리 주석", 'Module M', '', '    Sub A() \' 설명', "        ' 주석 줄", '        x = 1', '    End Sub', 'End Module')), base);
    assert.strictEqual(estimateSourceCompileBytes(lines('Module M', '    Public Event E()', 'End Module')), 3 * COMPILE_COST.statement);
});
