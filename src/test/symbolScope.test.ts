import * as assert from 'assert';
import { test } from './harness';
import { isVisibleFrom, pickVisibleDeclaration } from '../language/symbolScope';

/**
 * 2026-09-02: "다른 프로시저의 동명 로컬"을 커서 스코프의 선언으로 고르던 회귀 테스트.
 *
 * 아래 배치에서 Sub B의 `count`는 모듈 레벨 변수(line 1)를 가리킨다.
 * 종전 규칙("커서 위쪽에서 가장 가까운 후보")은 Sub A의 로컬(line 3)을 골라,
 * 정의 이동은 엉뚱한 곳으로 점프하고 이름 바꾸기는 Sub B 안에서만 이름을 바꿨다.
 *
 *   1  Public count As Integer     ← 모듈 레벨
 *   2  Public Sub A()
 *   3      Dim count As Integer    ← 무관한 로컬
 *   4  End Sub
 *   5  Public Sub B()
 *   6      count = count + 1       ← 커서
 *   7  End Sub
 */
const MODULE_LEVEL = { name: 'count', line: 1, isLocal: false };
const LOCAL_IN_A = { name: 'count', line: 3, isLocal: true };
const PROC_A = { startLine: 2, endLine: 4 };
const PROC_B = { startLine: 5, endLine: 7 };

test('symbolScope: 다른 프로시저의 로컬은 보이지 않는다', () => {
    assert.strictEqual(isVisibleFrom(LOCAL_IN_A, PROC_B), false);
    assert.strictEqual(isVisibleFrom(LOCAL_IN_A, PROC_A), true);
    assert.strictEqual(isVisibleFrom(LOCAL_IN_A, undefined), false, '프로시저 밖에서는 로컬이 보이지 않는다');
    assert.strictEqual(isVisibleFrom(MODULE_LEVEL, PROC_B), true, '모듈 레벨은 어디서나 보인다');
});

test('symbolScope: Sub B의 사용처는 모듈 레벨 선언으로 해석된다', () => {
    const picked = pickVisibleDeclaration([MODULE_LEVEL, LOCAL_IN_A], PROC_B, 6);
    assert.strictEqual(picked, MODULE_LEVEL);
});

test('symbolScope: 같은 프로시저의 로컬이 모듈 레벨을 가린다(섀도잉)', () => {
    const picked = pickVisibleDeclaration([MODULE_LEVEL, LOCAL_IN_A], PROC_A, 3);
    assert.strictEqual(picked, LOCAL_IN_A);
});

test('symbolScope: 로컬 선언이 커서보다 아래여도 프로시저 전체가 스코프다', () => {
    const declBelow = { name: 'x', line: 6, isLocal: true };
    const moduleLevel = { name: 'x', line: 1, isLocal: false };
    const picked = pickVisibleDeclaration([moduleLevel, declBelow], { startLine: 5, endLine: 7 }, 5);
    assert.strictEqual(picked, declBelow);
});

test('symbolScope: 모듈 레벨 후보가 여럿이면 커서 위쪽에서 가장 가까운 것', () => {
    const a = { name: 'v', line: 1, isLocal: false };
    const b = { name: 'v', line: 4, isLocal: false };
    assert.strictEqual(pickVisibleDeclaration([a, b], undefined, 6), b);
    assert.strictEqual(pickVisibleDeclaration([a, b], undefined, 2), a);
});

test('symbolScope: 위쪽에 없으면 아래쪽에서 가장 가까운 선언', () => {
    const below = { name: 'v', line: 9, isLocal: false };
    assert.strictEqual(pickVisibleDeclaration([below], undefined, 2), below);
});

test('symbolScope: 보이는 후보가 없으면 undefined', () => {
    assert.strictEqual(pickVisibleDeclaration([LOCAL_IN_A], PROC_B, 6), undefined);
    assert.strictEqual(pickVisibleDeclaration([], PROC_B, 6), undefined);
});
