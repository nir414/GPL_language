import * as assert from 'assert';
import { test } from './harness';
import { parseDeclaratorList } from '../language/declarationList';
import { GPLParser, GPLSymbolKind } from '../gplParser';

/**
 * 2026-09-02: 콤마 다중 선언(`Dim i, j As Integer`) 미지원 + 선언 심볼 range가
 * "줄 전체"였던 문제의 회귀 테스트.
 *
 * 전자는 해당 변수를 호버·정의 이동·이름 바꾸기에서 "정의 없음"으로 만들었고,
 * 후자는 이름 바꾸기가 선언 줄 앞부분을 덮어써 코드를 깨뜨렸다.
 */

function names(tail: string): string[] {
    return (parseDeclaratorList(tail) ?? []).map(d => d.name);
}

// ── 선언자 목록 파싱 ──────────────────────────────────────────────────────

test('declarationList: 콤마로 묶인 이름들은 뒤따르는 As 타입을 공유한다', () => {
    const list = parseDeclaratorList('ii, jj As Integer, x As Double');
    assert.ok(list, '선언자 목록이 해석되어야 한다');
    assert.deepStrictEqual(list!.map(d => `${d.name}:${d.type}`), ['ii:Integer', 'jj:Integer', 'x:Double']);
});

test('declarationList: 이름 오프셋은 각 이름의 실제 위치', () => {
    const list = parseDeclaratorList('i, j As Integer')!;
    assert.deepStrictEqual(list.map(d => d.offset), [0, 3]);
});

test('declarationList: 배열 첨자·As type() 은 배열, New의 생성자 인자는 배열이 아니다', () => {
    assert.strictEqual(parseDeclaratorList('arr(10, 4) As Integer')![0].isArray, true);
    assert.strictEqual(parseDeclaratorList('arr() As Integer')![0].isArray, true);
    assert.strictEqual(parseDeclaratorList('x As Integer()')![0].isArray, true);

    const t = parseDeclaratorList('t As New Thread("Motion.Run")')![0];
    assert.strictEqual(t.isArray, false, '생성자 인자 괄호를 배열로 오인하면 안 된다');
    assert.strictEqual(t.type, 'Thread');
    assert.strictEqual(t.isNew, true);
});

test('declarationList: 문자열 안 콤마는 선언 구분자가 아니다', () => {
    const list = parseDeclaratorList('s As String = "a,b"')!;
    assert.deepStrictEqual(list.map(d => d.name), ['s']);
    assert.strictEqual(list[0].init, '"a,b"');
});

test('declarationList: 초기값은 자기 선언자 구간까지만', () => {
    const list = parseDeclaratorList('a As Integer = 1, b As Integer = 2')!;
    assert.deepStrictEqual(list.map(d => d.init), ['1', '2']);
});

test('declarationList: 선언이 아니면 undefined (호출부가 다른 해석으로 넘어가게)', () => {
    // GPL은 `As type`이 필수 — 타입 없는 이름만 있으면 선언으로 보지 않는다.
    assert.strictEqual(parseDeclaratorList('x'), undefined);
    assert.strictEqual(parseDeclaratorList('x, y'), undefined);
    // 선언자 형태가 아닌 줄(Type/Enum 정의 등)
    assert.strictEqual(parseDeclaratorList('Type Recipe'), undefined);
    assert.strictEqual(parseDeclaratorList('Enum Color'), undefined);
    assert.strictEqual(parseDeclaratorList('   '), undefined);
    assert.deepStrictEqual(names('p As New Location'), ['p']);
});

// ── 파서 통합 ─────────────────────────────────────────────────────────────

const SRC = [
    'Module Motion',
    '    Public count As Integer',
    '    Public gA, gB As Integer, gC As Double',
    '    Public kvs(100) As KeyValue',
    '    Public Const MAXV As Integer = 5',
    '    Private note As String = "a,b"   \' 콤마 포함 문자열 + 주석',
    '    Public Type Recipe',
    '    End Type',
    '    Public ReadOnly Property LogText() As String',
    '    End Property',
    '    Public Sub Run(ByVal cycles As Integer)',
    '        Dim i, j As Integer, sum As Double',
    '        Dim t As New Thread("Motion.Run")',
    '        Dim Const LIMIT As Integer = 9',
    '    End Sub',
    'End Module',
].join('\n');

function parseAll() {
    return GPLParser.parseDocument(SRC, '/virtual/motion.gpl', {
        includeLocals: true,
        includeParameters: true
    });
}

test('파서: 모듈 레벨 콤마 다중 선언의 모든 이름이 심볼로 잡힌다', () => {
    const syms = parseAll();
    for (const name of ['gA', 'gB', 'gC']) {
        assert.ok(syms.some(s => s.name === name), `${name} 심볼이 있어야 한다`);
    }
    assert.strictEqual(syms.find(s => s.name === 'gC')!.returnType, 'Double');
});

test('파서: 로컬 콤마 다중 선언의 모든 이름이 로컬 심볼로 잡힌다', () => {
    const syms = parseAll();
    for (const name of ['i', 'j', 'sum']) {
        const s = syms.find(x => x.name === name);
        assert.ok(s, `${name} 심볼이 있어야 한다`);
        assert.strictEqual(s!.isLocal, true, `${name}은 로컬이어야 한다`);
    }
});

test('파서: 모든 선언 심볼의 range가 이름 위치를 가리킨다 (줄 전체 아님)', () => {
    const lines = SRC.split('\n');
    for (const s of parseAll()) {
        const got = lines[s.line].substring(s.range.start, s.range.end);
        assert.strictEqual(
            got.toLowerCase(),
            s.name.toLowerCase(),
            `${s.kind} ${s.name}의 range(${s.range.start}..${s.range.end})가 이름을 가리켜야 한다 (실제: ${JSON.stringify(got)})`
        );
    }
});

test('파서: 기존 단일 선언의 타입·상수 값 해석은 그대로', () => {
    const syms = parseAll();
    assert.strictEqual(syms.find(s => s.name === 'count')!.returnType, 'Integer');
    assert.strictEqual(syms.find(s => s.name === 'kvs')!.returnType, 'KeyValue[]');
    assert.strictEqual(syms.find(s => s.name === 'note')!.returnType, 'String');
    assert.strictEqual(syms.find(s => s.name === 't')!.returnType, 'Thread');

    const maxv = syms.find(s => s.name === 'MAXV')!;
    assert.strictEqual(maxv.kind, GPLSymbolKind.Constant);
    assert.strictEqual(maxv.value, '5');

    const limit = syms.find(s => s.name === 'LIMIT')!;
    assert.strictEqual(limit.kind, GPLSymbolKind.Constant);
    assert.strictEqual(limit.value, '9');
    assert.strictEqual(limit.isLocal, true);
});

test('파서: Type/Property 선언도 선언자 목록에 먹히지 않고 제 종류로 남는다', () => {
    const syms = parseAll();
    assert.strictEqual(syms.find(s => s.name === 'Recipe')!.kind, GPLSymbolKind.Class);
    assert.strictEqual(syms.find(s => s.name === 'LogText')!.kind, GPLSymbolKind.Property);
});
