import * as assert from 'assert';
import { test } from './harness';
import { chooseCompileUnitGprs, GprIdentity } from '../project/compileUnitTarget';

// 2026-09-18 실측 배치: 과제별 동명 프로젝트 3개(Antibody/Binder/Dilution 의 MergeCode) + 옛 프로젝트들.
const WS: GprIdentity[] = [
    { gprPath: '/ws/장비 구성/Antibody/projects/MergeCode/Project.gpr', projectName: 'MergeCode' },
    { gprPath: '/ws/장비 구성/Binder/projects/MergeCode/Project.gpr', projectName: 'MergeCode' },
    { gprPath: '/ws/장비 구성/Dilution/projects/MergeCode/Project.gpr', projectName: 'MergeCode' },
    { gprPath: '/ws/projects(제거예정)/BioR5_ADP/Project.gpr', projectName: 'BioR5_ADP' },
];
const DILUTION = WS[2];

test('compileUnit: 세션 대상 폴더의 .gpr 이 프로젝트명과 같으면 그 하나로 확정, 스캔 생략', () => {
    let scanned = 0;
    const r = chooseCompileUnitGprs('MergeCode', DILUTION, () => { scanned++; return WS; });
    assert.deepStrictEqual(r, { gprPaths: [DILUTION.gprPath], via: 'target-dir' });
    assert.strictEqual(scanned, 0, '대상이 확정되면 워크스페이스 스캔을 하지 않는다');
});

test('compileUnit: 프로젝트명을 아직 모르면 대상 폴더를 그대로 믿는다', () => {
    const r = chooseCompileUnitGprs('', DILUTION, () => WS);
    assert.deepStrictEqual(r, { gprPaths: [DILUTION.gprPath], via: 'target-dir' });
});

test('compileUnit: 프로젝트명 비교는 대소문자 무시', () => {
    const r = chooseCompileUnitGprs('mergecode', DILUTION, () => WS);
    assert.strictEqual(r.via, 'target-dir');
});

test('compileUnit: 대상 폴더 없음 → 프로젝트명 일치 .gpr 전부(종전 동작)', () => {
    const r = chooseCompileUnitGprs('MergeCode', undefined, () => WS);
    assert.strictEqual(r.via, 'name');
    assert.deepStrictEqual(r.gprPaths, WS.slice(0, 3).map(g => g.gprPath));
});

test('compileUnit: 대상 폴더의 이름이 어긋나면 무시하고 이름 일치로 가되 mismatch 로 알린다', () => {
    const stale: GprIdentity = { gprPath: '/ws/projects(제거예정)/BioR5_ADP/Project.gpr', projectName: 'BioR5_ADP' };
    const r = chooseCompileUnitGprs('MergeCode', stale, () => WS);
    assert.strictEqual(r.via, 'target-dir-mismatch');
    assert.deepStrictEqual(r.gprPaths, WS.slice(0, 3).map(g => g.gprPath));
});

test('compileUnit: 같은 .gpr 이 표기만 다르게 두 번 오면 하나로 합친다', () => {
    const dup: GprIdentity[] = [
        { gprPath: '/ws/A/Project.gpr', projectName: 'X' },
        { gprPath: '/ws/A/PROJECT.GPR', projectName: 'X' },
    ];
    const r = chooseCompileUnitGprs('X', undefined, () => dup);
    assert.strictEqual(r.gprPaths.length, 1);
});

test('compileUnit: 근거가 하나도 없으면 빈 목록 + none (호출자가 워크스페이스 전체로 폴백)', () => {
    assert.deepStrictEqual(chooseCompileUnitGprs('', undefined, () => WS), { gprPaths: [], via: 'none' });
    assert.deepStrictEqual(chooseCompileUnitGprs('Nope', undefined, () => WS), { gprPaths: [], via: 'none' });
});
