import * as assert from 'assert';
import { test } from './harness';
import { extractBaseObjectName, escapeRegExp, splitParameters, getParameterArity, argCountMatchesArity, matchProcedureHeaderKind, extractQualifierChainBefore } from '../language/cursorExpression';

test('extractBaseObjectName: 대입 + 배열 인덱싱에서 기준 객체', () => {
    assert.strictEqual(extractBaseObjectName('returnError = armList(0)'), 'armList');
});

test('extractBaseObjectName: 단순 호출', () => {
    assert.strictEqual(extractBaseObjectName('myRobot(index)'), 'myRobot');
});

test('extractBaseObjectName: 단순 식별자', () => {
    assert.strictEqual(extractBaseObjectName('obj'), 'obj');
});

test('extractBaseObjectName: 연쇄 인덱싱', () => {
    assert.strictEqual(extractBaseObjectName('arr(0)(1)'), 'arr');
});

test('extractBaseObjectName: 끝쪽 공백 허용', () => {
    assert.strictEqual(extractBaseObjectName('  foo(1)   '), 'foo');
});

test('extractBaseObjectName: 빈 문자열 → undefined', () => {
    assert.strictEqual(extractBaseObjectName(''), undefined);
});

test('extractBaseObjectName: 숫자로 시작 → undefined', () => {
    assert.strictEqual(extractBaseObjectName('123'), undefined);
});

test('escapeRegExp: 정규식 메타문자 이스케이프', () => {
    assert.strictEqual(escapeRegExp('a.b*c'), 'a\\.b\\*c');
    assert.strictEqual(escapeRegExp('arr[0]'), 'arr\\[0\\]');
    assert.strictEqual(escapeRegExp('f(x)'), 'f\\(x\\)');
});

test('escapeRegExp: 일반 식별자는 그대로', () => {
    assert.strictEqual(escapeRegExp('myRobot'), 'myRobot');
});

test('splitParameters: 공백뿐인 괄호는 0개', () => {
    assert.deepStrictEqual(splitParameters('   '), []);
    assert.deepStrictEqual(splitParameters(''), []);
});

test('splitParameters: 기본값 속 콤마는 분리하지 않음', () => {
    assert.deepStrictEqual(
        splitParameters('a As Integer, Optional p As Foo = Bar(1, 2)'),
        ['a As Integer', 'Optional p As Foo = Bar(1, 2)']
    );
});

test('getParameterArity: Optional은 required에서 제외', () => {
    assert.deepStrictEqual(
        getParameterArity(['stage As Integer', 'slot As Integer', 'Optional flip As Boolean = False']),
        { required: 2, max: 3 }
    );
});

test('getParameterArity: ParamArray는 max 무제한(undefined)', () => {
    assert.deepStrictEqual(
        getParameterArity(['prefix As String', 'ParamArray items() As String']),
        { required: 1, max: undefined }
    );
});

test('argCountMatchesArity: Optional/ParamArray 호출 매칭', () => {
    assert.strictEqual(argCountMatchesArity(2, { required: 2, max: 3 }), true);
    assert.strictEqual(argCountMatchesArity(3, { required: 2, max: 3 }), true);
    assert.strictEqual(argCountMatchesArity(1, { required: 2, max: 3 }), false);
    assert.strictEqual(argCountMatchesArity(4, { required: 2, max: 3 }), false);
    assert.strictEqual(argCountMatchesArity(9, { required: 1, max: undefined }), true);
    assert.strictEqual(argCountMatchesArity(undefined, { required: 3, max: 3 }), true);
});

test('matchProcedureHeaderKind: 수식어 다중이어도 인식', () => {
    assert.strictEqual(matchProcedureHeaderKind('Public Overrides Sub Bar()'), 'Sub');
    assert.strictEqual(matchProcedureHeaderKind('Friend Shared Function Baz() As Integer'), 'Function');
    assert.strictEqual(matchProcedureHeaderKind('Public ReadOnly Property P() As Integer'), 'Property');
    assert.strictEqual(matchProcedureHeaderKind('Dim x As Integer'), undefined);
});

test('extractBaseObjectName: 인덱서 qualifier는 인덱스가 아니라 기준 객체', () => {
    assert.strictEqual(extractBaseObjectName('steps(i)'), 'steps');
});

// ─── extractQualifierChainBefore (멤버 자동완성 한정자 체인) ───

test('extractQualifierChainBefore: 단순 한정자 "loc." → chain [loc], partial 빈문자열', () => {
    assert.deepStrictEqual(extractQualifierChainBefore('x = loc.'), { chain: ['loc'], partial: '' });
});

test('extractQualifierChainBefore: 입력 중 partial "Move.App"', () => {
    assert.deepStrictEqual(extractQualifierChainBefore('Move.App'), { chain: ['Move'], partial: 'App' });
});

test('extractQualifierChainBefore: 인덱싱/호출 세그먼트 "a.b(0).C"', () => {
    assert.deepStrictEqual(extractQualifierChainBefore('a.b(0).C'), { chain: ['a', 'b(0)'], partial: 'C' });
});

test('extractQualifierChainBefore: 호출 인자 속 "foo(bar."', () => {
    assert.deepStrictEqual(extractQualifierChainBefore('foo(bar.'), { chain: ['bar'], partial: '' });
});

test('extractQualifierChainBefore: 중첩 괄호 호출 "obj.method(f(1), 2)."', () => {
    assert.deepStrictEqual(
        extractQualifierChainBefore('obj.method(f(1), 2).'),
        { chain: ['obj', 'method(f(1), 2)'], partial: '' });
});

test('extractQualifierChainBefore: 숫자 리터럴 "1."과 점 없는 입력은 undefined', () => {
    assert.strictEqual(extractQualifierChainBefore('x = 1.'), undefined);
    assert.strictEqual(extractQualifierChainBefore('x = 1.5'), undefined);
    assert.strictEqual(extractQualifierChainBefore('x = ident'), undefined);
});

test('extractQualifierChainBefore: 괄호식 "(x)."은 체인으로 취급하지 않음', () => {
    assert.strictEqual(extractQualifierChainBefore('(x).'), undefined);
});

// ─── extractDebugExpressionAt / 인덱스 치환 (디버그 hover용) ───

import {
    extractDebugExpressionAt,
    buildDebugExpression,
    extractIndexIdentifierTokens,
    replaceIndexIdentifierTokens,
} from '../language/cursorExpression';

function exprAt(line: string, ch: number): string | undefined {
    const c = extractDebugExpressionAt(line, ch);
    return c ? buildDebugExpression(c.segments) : undefined;
}

test('debugExpr: 배열 요소 — 커서가 이름 위면 인덱스 그룹 포함', () => {
    // RobotModule.gpl 실사례: armList(i).isCanFlip
    const line = '\t\t\tIf armList(i).isCanFlip = True Then';
    const col = line.indexOf('armList') + 3; // armList 중간
    assert.strictEqual(exprAt(line, col), 'armList(i)');
});

test('debugExpr: 멤버 커서 — 앞 체인(인덱스 포함)까지 확장', () => {
    const line = '\t\t\tIf armList(i).isCanFlip = True Then';
    const col = line.indexOf('isCanFlip') + 2;
    assert.strictEqual(exprAt(line, col), 'armList(i).isCanFlip');
});

test('debugExpr: 단순 변수/문자열·주석 제외', () => {
    const line = 'x = count \' comment count';
    assert.strictEqual(exprAt(line, line.indexOf('count') + 1), 'count');
    assert.strictEqual(exprAt(line, line.indexOf('comment') + 1), undefined); // 주석 안
    const strLine = 's = "armList(i)"';
    assert.strictEqual(exprAt(strLine, strLine.indexOf('armList') + 1), undefined); // 문자열 안
});

test('debugExpr: 시작/끝 컬럼이 식 전체를 커버', () => {
    const line = 'armList(i).SetGripTypeIndex(a, b)';
    const c = extractDebugExpressionAt(line, line.indexOf('SetGripTypeIndex') + 1);
    assert.ok(c);
    assert.strictEqual(line.slice(c!.startColumn, c!.endColumn), 'armList(i).SetGripTypeIndex(a, b)');
    assert.strictEqual(buildDebugExpression(c!.segments), 'armList(i).SetGripTypeIndex(a, b)');
    // ※ 호출 여부 판단은 provider가 심볼로 검증 — 여기서는 구조만 추출된다.
});

test('indexTokens: 식별자만 추출(숫자/점 경로/중복 처리)', () => {
    assert.deepStrictEqual(extractIndexIdentifierTokens('armList(i)'), ['i']);
    assert.deepStrictEqual(extractIndexIdentifierTokens('m(i, j)'), ['i', 'j']);
    assert.deepStrictEqual(extractIndexIdentifierTokens('a(i).b(i)'), ['i']);
    assert.deepStrictEqual(extractIndexIdentifierTokens('arr(0,1)'), []);
    assert.deepStrictEqual(extractIndexIdentifierTokens('a(obj.idx)'), ['obj.idx']);
    assert.deepStrictEqual(extractIndexIdentifierTokens('plain'), []);
});

test('indexTokens: 중첩 괄호/문자열은 치환 불가(undefined)', () => {
    assert.strictEqual(extractIndexIdentifierTokens('a(b(i))'), undefined);
    assert.strictEqual(extractIndexIdentifierTokens('a("x")'), undefined);
});

test('replaceIndexTokens: 괄호 안만 치환, 밖 이름은 보존', () => {
    const values = new Map([['i', '3'], ['obj.idx', '7']]);
    assert.strictEqual(replaceIndexIdentifierTokens('armList(i)', values), 'armList(3)');
    assert.strictEqual(replaceIndexIdentifierTokens('a(obj.idx).b(i)', values), 'a(7).b(3)');
    // 'i'라는 이름의 배열이 밖에 있어도 밖은 치환하지 않는다
    assert.strictEqual(replaceIndexIdentifierTokens('i(i)', values), 'i(3)');
});
