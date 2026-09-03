import * as assert from 'assert';
import * as path from 'path';
import { test } from './harness';
import {
    disambiguateDirLabels,
    normalizeDirKey,
    orderProjectDirs,
    projectDirFromResource,
    filterDirsByProjectName,
} from '../controller/projectPickerCore';

const ROOT = path.resolve('/ws/projects');
const A = path.join(ROOT, 'MergeCode');
const B = path.join(ROOT, 'MergeCode Beta');
const C = path.join(ROOT, 'Other');

test('projectPicker: 최근 선택이 맨 위, 나머지는 경로 정렬, 중복 제거', () => {
    const ordered = orderProjectDirs([C, A, B, A.toUpperCase()], B);
    assert.deepStrictEqual(ordered, [B, A, C]);
});

test('projectPicker: 최근 선택이 후보에 없으면 정렬만', () => {
    assert.deepStrictEqual(orderProjectDirs([C, A], path.join(ROOT, 'Gone')), [A, C]);
});

test('projectPicker: 폴더 우클릭 — 프로젝트 폴더 자체만 인정(상위 폴더는 미인정)', () => {
    assert.strictEqual(projectDirFromResource(A, [A, B], true), A);
    assert.strictEqual(projectDirFromResource(A.toLowerCase(), [A, B], true), A);
    assert.strictEqual(projectDirFromResource(ROOT, [A, B], true), undefined);
});

test('projectPicker: 접두어가 같은 폴더(MergeCode vs MergeCode Beta)를 혼동하지 않음', () => {
    const fileInBeta = path.join(B, 'Main.gpl');
    assert.strictEqual(projectDirFromResource(fileInBeta, [A, B], false), B);
    const fileInA = path.join(A, 'Main.gpl');
    assert.strictEqual(projectDirFromResource(fileInA, [A, B], false), A);
});

test('projectPicker: .gpr 파일 우클릭은 그 폴더, 중첩 프로젝트는 가장 깊은 폴더', () => {
    assert.strictEqual(projectDirFromResource(path.join(B, 'Project.gpr'), [A, B], false), B);
    const nested = path.join(A, 'Sub');
    assert.strictEqual(projectDirFromResource(path.join(nested, 'x.gpl'), [A, nested], false), nested);
    assert.strictEqual(projectDirFromResource(path.join(ROOT, 'stray.gpl'), [A, B], false), undefined);
});

test('projectPicker: projectName 필터는 폴더명 또는 .gpr ProjectName 일치(대소문자 무시)', () => {
    const gprName = (d: string): string | undefined => (d === B ? 'MergeCode' : d === C ? 'Other' : undefined);
    // Beta 폴더의 .gpr가 여전히 "MergeCode"면 두 폴더가 모두 후보 → 호출측이 QuickPick으로 묻게 된다.
    assert.deepStrictEqual(filterDirsByProjectName([A, B, C], 'mergecode', gprName), [A, B]);
    assert.deepStrictEqual(filterDirsByProjectName([A, B, C], 'Other', gprName), [C]);
    assert.deepStrictEqual(filterDirsByProjectName([A, B, C], 'Nope', gprName), []);
    assert.deepStrictEqual(filterDirsByProjectName([A, B, C], '  ', gprName), []);
});

// 사용자 실작업 구조: 과제 폴더마다 같은 이름의 프로젝트를 복제해 둔다
// (…/과제/시뮬레이션/projects/<프로젝트>). 폴더명만으로는 목록에서 구분되지 않는다.
const TASK_A = path.resolve('/svn/pa/07. Others/37. 핵산 Oligo 합성과제/시뮬레이션/projects');
const TASK_B = path.resolve('/svn/pa/07. Others/41. 다른 과제/시뮬레이션/projects');

test('projectPicker: 폴더명이 유일하면 위치 표기를 붙이지 않는다 (잡음 방지)', () => {
    const hints = disambiguateDirLabels([A, B, C]);
    assert.strictEqual(hints.size, 0);
});

test('projectPicker: 동명 프로젝트는 구분에 필요한 최소 상위 폴더를 얻는다', () => {
    const a = path.join(TASK_A, 'GPL_Code');
    const b = path.join(TASK_B, 'GPL_Code');
    const hints = disambiguateDirLabels([a, b, path.join(TASK_A, 'MergeCode')]);
    // projects·시뮬레이션 이 양쪽 같으므로 과제 폴더까지 올라가야 구분된다.
    assert.strictEqual(hints.get(normalizePathKeyOf(a)), path.join('37. 핵산 Oligo 합성과제', '시뮬레이션', 'projects'));
    assert.strictEqual(hints.get(normalizePathKeyOf(b)), path.join('41. 다른 과제', '시뮬레이션', 'projects'));
    // 이름이 겹치지 않는 MergeCode 에는 표기가 없다.
    assert.strictEqual(hints.get(normalizePathKeyOf(path.join(TASK_A, 'MergeCode'))), undefined);
});

test('projectPicker: 바로 위 폴더만으로 구분되면 거기서 멈춘다', () => {
    const a = path.join(ROOT, 'alpha', 'GPL_Code');
    const b = path.join(ROOT, 'beta', 'GPL_Code');
    const hints = disambiguateDirLabels([a, b]);
    assert.strictEqual(hints.get(normalizePathKeyOf(a)), 'alpha');
    assert.strictEqual(hints.get(normalizePathKeyOf(b)), 'beta');
});

test('projectPicker: 동명 그룹이 셋 이상이어도 같은 깊이로 표기한다 (눈으로 비교되도록)', () => {
    const a = path.join(ROOT, 'x', 'p', 'GPL_Code');
    const b = path.join(ROOT, 'y', 'p', 'GPL_Code');
    const c = path.join(ROOT, 'z', 'q', 'GPL_Code');
    const hints = disambiguateDirLabels([a, b, c]);
    assert.strictEqual(hints.get(normalizePathKeyOf(a)), path.join('x', 'p'));
    assert.strictEqual(hints.get(normalizePathKeyOf(b)), path.join('y', 'p'));
    assert.strictEqual(hints.get(normalizePathKeyOf(c)), path.join('z', 'q'));
});

test('projectPicker: 대소문자만 다른 동명 폴더도 같은 그룹으로 본다 (Windows)', () => {
    const a = path.join(ROOT, 'alpha', 'GPL_Code');
    const b = path.join(ROOT, 'beta', 'gpl_code');
    const hints = disambiguateDirLabels([a, b]);
    assert.strictEqual(hints.get(normalizePathKeyOf(a)), 'alpha');
    assert.strictEqual(hints.get(normalizePathKeyOf(b)), 'beta');
});

/** 테스트 안에서 반환 Map 의 키를 만드는 helper — 구현과 같은 정규화를 쓴다. */
function normalizePathKeyOf(dir: string): string {
    return normalizeDirKey(dir);
}
