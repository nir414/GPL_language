import * as assert from 'assert';
import * as path from 'path';
import { test } from './harness';
import {
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
