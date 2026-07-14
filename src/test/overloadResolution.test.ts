import * as assert from 'assert';
import { test } from './harness';
import {
    parseParameterDecl, inferLiteralArgType, scoreCandidateByTypes,
    rankOverloadMatches, NUMERIC_LITERAL_TYPE, CallContext
} from '../language/overloadResolution';
import { extractCallArgumentsFromSuffix } from '../language/cursorExpression';

// ── parseParameterDecl ─────────────────────────────────────────────────────
test('parseParameterDecl: 스칼라 파라미터', () => {
    assert.deepStrictEqual(parseParameterDecl('stage As Integer'), {
        name: 'stage', typeName: 'Integer', isArray: false, isOptional: false, isParamArray: false
    });
});

test('parseParameterDecl: 배열 파라미터(이름 뒤 괄호)', () => {
    const p = parseParameterDecl('armlist() As RobotArm');
    assert.strictEqual(p.name, 'armlist');
    assert.strictEqual(p.typeName, 'RobotArm');
    assert.strictEqual(p.isArray, true);
});

test('parseParameterDecl: 배열 파라미터(타입 뒤 괄호) + ByRef', () => {
    const p = parseParameterDecl('ByRef vals As Integer()');
    assert.strictEqual(p.name, 'vals');
    assert.strictEqual(p.typeName, 'Integer');
    assert.strictEqual(p.isArray, true);
});

test('parseParameterDecl: Optional + 기본값(콤마 포함)은 타입 판정에 영향 없음', () => {
    const p = parseParameterDecl('Optional speed As Integer = 10');
    assert.strictEqual(p.isOptional, true);
    assert.strictEqual(p.typeName, 'Integer');
    assert.strictEqual(p.isArray, false);
});

test('parseParameterDecl: ParamArray', () => {
    const p = parseParameterDecl('ParamArray vals() As Integer');
    assert.strictEqual(p.isParamArray, true);
    assert.strictEqual(p.isArray, true);
});

// ── inferLiteralArgType ────────────────────────────────────────────────────
test('inferLiteralArgType: 리터럴 분류', () => {
    assert.strictEqual(inferLiteralArgType('"abc"'), 'String');
    assert.strictEqual(inferLiteralArgType('True'), 'Boolean');
    assert.strictEqual(inferLiteralArgType('0'), NUMERIC_LITERAL_TYPE);
    assert.strictEqual(inferLiteralArgType('-1.5e3'), NUMERIC_LITERAL_TYPE);
    assert.strictEqual(inferLiteralArgType('&H1F'), NUMERIC_LITERAL_TYPE);
    assert.strictEqual(inferLiteralArgType('someVar'), undefined);
});

// ── scoreCandidateByTypes ──────────────────────────────────────────────────
test('scoreCandidateByTypes: 배열 인자는 배열 파라미터 오버로드가 우선', () => {
    const scalar = ['stage As Integer', 'slot As Integer', 'arm As RobotArm'];
    const arr = ['stage As Integer', 'slot As Integer', 'armlist() As RobotArm'];
    const argTypes = [NUMERIC_LITERAL_TYPE, NUMERIC_LITERAL_TYPE, 'RobotArm[]'];
    assert.ok(scoreCandidateByTypes(arr, argTypes) > scoreCandidateByTypes(scalar, argTypes));
});

test('scoreCandidateByTypes: unknown 인자는 중립(0)', () => {
    assert.strictEqual(scoreCandidateByTypes(['a As Integer'], [undefined]), 0);
});

test('scoreCandidateByTypes: ParamArray는 초과 스칼라 인자를 요소 타입으로 대조', () => {
    const decls = ['msg As String', 'ParamArray vals() As Integer'];
    const score = scoreCandidateByTypes(decls, ['String', NUMERIC_LITERAL_TYPE, NUMERIC_LITERAL_TYPE]);
    assert.ok(score > 0);
});

// ── rankOverloadMatches: getWafer 시나리오 (RobotModule.gpl 오버로딩 사례) ──
function mkSym(line: number, params: string[]) {
    return { kind: 'sub', parameters: params, filePath: 'C:\\p\\RobotModule.gpl', line };
}
const getWaferScalar = mkSym(3760, ['stage As Integer', 'slot As Integer', 'arm As RobotArm']);
const getWaferArray = mkSym(3804, ['stage As Integer', 'slot As Integer', 'armlist() As RobotArm']);
const getWafer4 = mkSym(3810, ['stage As Integer', 'slot As Integer', 'armlist() As RobotArm', 'opt As Integer']);

test('rankOverloadMatches: 배열 인자 → 배열 오버로드 단독 선택 (getWafer 사례)', () => {
    const ctx: CallContext = {
        argCount: 3,
        getArgTypes: () => ['Integer', 'Integer', 'RobotArm[]']
    };
    const got = rankOverloadMatches([getWaferScalar, getWaferArray, getWafer4], ctx);
    assert.deepStrictEqual(got, [getWaferArray]);
});

test('rankOverloadMatches: 스칼라 인자 → 스칼라 오버로드 단독 선택', () => {
    const ctx: CallContext = {
        argCount: 3,
        getArgTypes: () => ['Integer', 'Integer', 'RobotArm']
    };
    const got = rankOverloadMatches([getWaferScalar, getWaferArray, getWafer4], ctx);
    assert.deepStrictEqual(got, [getWaferScalar]);
});

test('rankOverloadMatches: 4번째 인자가 있으면 4-인자 오버로드', () => {
    const ctx: CallContext = {
        argCount: 4,
        getArgTypes: () => ['Integer', 'Integer', 'RobotArm[]', NUMERIC_LITERAL_TYPE]
    };
    const got = rankOverloadMatches([getWaferScalar, getWaferArray, getWafer4], ctx);
    assert.deepStrictEqual(got, [getWafer4]);
});

test('rankOverloadMatches: 타입 불명이면 같은 arity 후보 전부 동점 반환(peek 대상)', () => {
    const ctx: CallContext = { argCount: 3 };
    const got = rankOverloadMatches([getWaferScalar, getWaferArray, getWafer4], ctx);
    assert.strictEqual(got.length, 2);
});

test('rankOverloadMatches: 타입 공급자는 동점 후보 2개 이상일 때만 호출(lazy)', () => {
    let called = 0;
    const ctx: CallContext = { argCount: 3, getArgTypes: () => { called++; return ['Integer']; } };
    rankOverloadMatches([getWaferScalar], ctx);
    assert.strictEqual(called, 0);
});

test('rankOverloadMatches: 문자열 리터럴은 String 오버로드', () => {
    const fnInt = mkSym(10, ['v As Integer']);
    const fnStr = mkSym(20, ['v As String']);
    const ctx: CallContext = { argCount: 1, getArgTypes: () => ['String'] };
    assert.deepStrictEqual(rankOverloadMatches([fnInt, fnStr], ctx), [fnStr]);
});

test('rankOverloadMatches: pathScore가 타입 동점을 가른다(가까운 파일 우선)', () => {
    const near = { kind: 'sub', parameters: ['v As Integer'], filePath: 'C:\\p\\A.gpl', line: 1 };
    const far = { kind: 'sub', parameters: ['v As Integer'], filePath: 'C:\\q\\A.gpl', line: 1 };
    const ctx: CallContext = { argCount: 1 };
    const got = rankOverloadMatches([far, near], ctx, c => (c.filePath.startsWith('C:\\p') ? 100 : 0));
    assert.deepStrictEqual(got, [near]);
});

// ── extractCallArgumentsFromSuffix ─────────────────────────────────────────
test('extractCallArgumentsFromSuffix: 미완성 호출(닫는 괄호 없음)도 인자 추출', () => {
    assert.deepStrictEqual(
        extractCallArgumentsFromSuffix('(stage,slot,robotArmList'),
        ['stage', 'slot', 'robotArmList']
    );
});

test('extractCallArgumentsFromSuffix: 빈 괄호 → [], 괄호 아님 → undefined', () => {
    assert.deepStrictEqual(extractCallArgumentsFromSuffix('( )'), []);
    assert.strictEqual(extractCallArgumentsFromSuffix(' = 3'), undefined);
});

test('extractCallArgumentsFromSuffix: 중첩 호출/문자열 속 콤마는 분리하지 않음', () => {
    assert.deepStrictEqual(
        extractCallArgumentsFromSuffix('(Foo(1, 2), "a,b", x)'),
        ['Foo(1, 2)', '"a,b"', 'x']
    );
});
