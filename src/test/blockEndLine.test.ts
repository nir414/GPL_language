import * as assert from 'assert';
import { test } from './harness';
import { GPLParser, GPLSymbolKind } from '../language/gplParser';

// ─── 블록 심볼의 endLine (개요 「커서 따르기」 오동작 수정, 2026-09-29) ─────────────
// 종전 개요는 블록 끝을 "다음 동급 심볼 직전"으로 추정해, 중첩 클래스와 클래스 뒤
// 모듈 멤버에서 형제 범위가 겹쳤다(안쪽 클래스 범위가 문서 끝까지 늘어남 등).
// 그 결과 개요 클릭 → 커서 이동 → 커서 따르기가 "커서를 감싸는 심볼"을 잘못 찾아
// 선택이 엉뚱한 항목으로 되돌아갔다. 파서가 짝 `End …` 줄을 endLine으로 기록한다.

const SRC = [
    /* 0 */ 'Module Shapes',
    /* 1 */ '    Public Class Counter',
    /* 2 */ '        Private current As Integer',
    /* 3 */ '        Public Class Snapshot',
    /* 4 */ '            Public taken As Integer',
    /* 5 */ '        End Class',
    /* 6 */ '        Public Property Count As Integer',
    /* 7 */ '            Get',
    /* 8 */ '                Return current',
    /* 9 */ '            End Get',
    /* 10 */ '        End Property',
    /* 11 */ '        Public Sub Init(ByVal text As String)',
    /* 12 */ '            current = 0',
    /* 13 */ '        End Sub',
    /* 14 */ '        Public Function Bump() As Integer',
    /* 15 */ '            Return current',
    /* 16 */ '        End Function',
    /* 17 */ '    End Class',
    /* 18 */ '    Public Sub Tour()',
    /* 19 */ '    End Sub',
    /* 20 */ 'End Module',
].join('\n');

test('파서: Module/Class/Sub/Function/Property의 endLine이 짝 End 줄을 가리킨다(중첩 클래스 포함)', () => {
    const syms = GPLParser.parseDocument(SRC, '/virtual/BlockEnd.gpl');
    const byName = (name: string) => syms.find(s => s.name === name)!;

    assert.strictEqual(byName('Shapes').endLine, 20, 'Module → End Module');
    assert.strictEqual(byName('Counter').endLine, 17, '바깥 Class → 자신의 End Class(안쪽 End Class가 아니다)');
    assert.strictEqual(byName('Snapshot').endLine, 5, '중첩 Class → 안쪽 End Class');
    assert.strictEqual(byName('Snapshot').parentClassName, 'Counter', '중첩 클래스의 바깥 클래스');
    assert.strictEqual(byName('Count').endLine, 10, 'Property → End Property(End Get에 닫히지 않는다)');
    assert.strictEqual(byName('Init').endLine, 13, 'Sub → End Sub');
    assert.strictEqual(byName('Bump').endLine, 16, 'Function → End Function');
    assert.strictEqual(byName('Tour').endLine, 19, '클래스 뒤 모듈 레벨 Sub');
    // 한 줄 선언은 블록이 아니다
    assert.strictEqual(byName('current').endLine, undefined);
});

test('파서: 짝이 안 맞는 소스에서는 endLine을 지어내지 않는다', () => {
    // End Sub가 없는 Sub — End Class가 Sub를 닫은 것처럼 기록하면 안 된다.
    const broken = [
        'Module M',
        '    Class C',
        '        Sub Broken()',
        '    End Class',
        '    Sub After()',
        '    End Sub',
        'End Module',
    ].join('\n');
    const syms = GPLParser.parseDocument(broken, '/virtual/BlockEndBroken.gpl');
    const byName = (name: string) => syms.find(s => s.name === name)!;
    assert.strictEqual(byName('Broken').endLine, undefined, 'End 누락 → undefined(휴리스틱으로 대체)');
    assert.strictEqual(byName('C').endLine, 3, '클래스 자체는 정상적으로 닫힌다');
    assert.strictEqual(byName('After').endLine, 5, '이후 블록은 오염되지 않는다');
    assert.strictEqual(byName('M').endLine, 6);

    // End Module 없이 다음 Module이 시작되면 앞 모듈은 undefined로 남는다.
    const twoModules = ['Module A', 'Module B', 'End Module'].join('\n');
    const syms2 = GPLParser.parseDocument(twoModules, '/virtual/BlockEndTwoModules.gpl');
    assert.strictEqual(syms2.find(s => s.name === 'A')!.endLine, undefined);
    assert.strictEqual(syms2.find(s => s.name === 'B')!.endLine, 2);

    // 종류가 다른 End(Function을 End Sub로 닫음)는 짝으로 치지 않는다.
    const mismatched = [
        'Module M2',
        '    Function F() As Integer',
        '    End Sub',
        'End Module',
    ].join('\n');
    const syms3 = GPLParser.parseDocument(mismatched, '/virtual/BlockEndMismatch.gpl');
    assert.strictEqual(syms3.find(s => s.name === 'F')!.endLine, undefined);
});

test('파서: Kind 검사 없이도 GPLSymbolKind 문자열이 End 키워드 소문자와 일치한다(endLine 짝 판정의 전제)', () => {
    // endLine 짝 판정은 `End <키워드>`의 소문자와 GPLSymbolKind 값(문자열)을 비교한다.
    // enum 값이 바뀌면 짝 판정이 조용히 전부 실패하므로 여기서 고정한다.
    assert.strictEqual(GPLSymbolKind.Sub, 'sub');
    assert.strictEqual(GPLSymbolKind.Function, 'function');
    assert.strictEqual(GPLSymbolKind.Property, 'property');
});
