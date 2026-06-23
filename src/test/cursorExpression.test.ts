import * as assert from 'assert';
import { test } from './harness';
import { extractBaseObjectName, escapeRegExp } from '../language/cursorExpression';

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
