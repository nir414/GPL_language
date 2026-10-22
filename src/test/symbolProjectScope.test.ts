import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from './harness';
import { SymbolProjectScope } from '../project/symbols/symbolProjectScope';
import { GPLSymbol } from '../language/gplParser';

function fixture(run: (root: string, scope: SymbolProjectScope) => void): void {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-symbol-scope-'));
    try { run(root, new SymbolProjectScope(() => root)); }
    finally {
        assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
        fs.rmSync(root, { recursive: true, force: true });
    }
}

test('SymbolProjectScope: 파일·폴더·프로젝트·라이브러리 우선순위를 유지한다', () => fixture((root, scope) => {
    const mainDir = path.join(root, 'task/main');
    const libDir = path.join(root, 'task/lib');
    fs.mkdirSync(mainDir, { recursive: true });
    fs.mkdirSync(libDir, { recursive: true });
    const mainGpr = path.join(mainDir, 'Project.gpr');
    const libGpr = path.join(libDir, 'Project.gpr');
    fs.writeFileSync(mainGpr, 'ProjectBegin\nProjectName="Main"\nProjectLibrary="../lib"\nProjectEnd');
    fs.writeFileSync(libGpr, 'ProjectBegin\nProjectName="Lib"\nProjectEnd');
    scope.setGprPaths([mainGpr, libGpr]);
    const reference = path.join(mainDir, 'Main.gpl');
    const sameFile = scope.scoreFilePath(reference.toUpperCase(), reference);
    const sameDir = scope.scoreFilePath(path.join(mainDir, 'Other.gpl'), reference);
    const sameProject = scope.scoreFilePath(path.join(mainDir, 'nested/Part.gpl'), reference);
    const related = scope.scoreFilePath(path.join(libDir, 'Part.gpl'), reference);
    const sameTask = scope.scoreFilePath(path.join(root, 'task/other/Part.gpl'), reference);
    const unrelated = scope.scoreFilePath(path.join(root, 'unrelated/Part.gpl'), reference);
    assert.ok(sameFile > sameDir && sameDir > sameProject && sameProject > related && related > sameTask && sameTask > unrelated);
    assert.ok(scope.isSameCompileUnit(path.join(libDir, 'Part.gpl'), reference));
    assert.ok(!scope.isSameCompileUnit(path.join(root, 'unrelated/Part.gpl'), reference));
}));

test('SymbolProjectScope: 단위 안 후보가 없거나 단위를 모르면 원본을 보존한다', () => fixture((root, scope) => {
    const candidates = [{ name: 'Run', kind: 'sub', filePath: path.join(root, 'A.gpl'), line: 1 }] as GPLSymbol[];
    assert.strictEqual(scope.narrowCandidates(candidates, path.join(root, 'Unknown.gpl')), candidates);
    assert.strictEqual(scope.narrowCandidates(candidates), candidates);
    assert.strictEqual(scope.isSameCompileUnit(candidates[0].filePath, path.join(root, 'Unknown.gpl')), true);
}));

test('SymbolProjectScope: 관계 무효화 뒤 변경된 라이브러리 경계를 반영한다', () => fixture((root, scope) => {
    const mainDir = path.join(root, 'main');
    const libDir = path.join(root, 'lib');
    fs.mkdirSync(mainDir);
    fs.mkdirSync(libDir);
    const mainGpr = path.join(mainDir, 'Project.gpr');
    const libGpr = path.join(libDir, 'Project.gpr');
    fs.writeFileSync(mainGpr, 'ProjectBegin\nProjectName="Main"\nProjectEnd');
    fs.writeFileSync(libGpr, 'ProjectBegin\nProjectName="Lib"\nProjectEnd');
    scope.setGprPaths([mainGpr, libGpr]);
    const reference = path.join(mainDir, 'Main.gpl');
    const candidate = path.join(libDir, 'Lib.gpl');
    assert.strictEqual(scope.isSameCompileUnit(candidate, reference), false);
    fs.writeFileSync(mainGpr, 'ProjectBegin\nProjectName="Main"\nProjectLibrary="../lib"\nProjectEnd');
    scope.invalidateProjectRelations();
    assert.strictEqual(scope.isSameCompileUnit(candidate, reference), true);
}));
