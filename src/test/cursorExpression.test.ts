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
