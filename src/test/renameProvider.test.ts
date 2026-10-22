import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { createRequire } from 'module';
import { SymbolIndex } from '../language/symbols/symbolIndex';
import { test } from './harness';

/** VS Code 경계만 대체하고 실제 Rename Provider의 충돌 검사를 실행한다. */
function setup(libraryInUnit = false) {
    const root = path.resolve('rename-fixture');
    const targetFile = path.join(root, 'app', 'Before.gpl');
    const otherFile = path.join(root, 'other', 'Taken.gpl');
    const libraryFile = path.join(root, 'library', 'Taken.gpl');
    const index = new SymbolIndex({
        narrowCandidates: candidates => candidates,
        scoreFilePath: () => 0,
        isSameCompileUnit: (candidate, target) => path.dirname(candidate) === path.dirname(target)
            || (libraryInUnit && candidate === libraryFile),
    });
    index.updateFileText(targetFile, 'Module Before\nEnd Module');
    index.rebuildNameIndex();
    const vscode = { workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) }, debug: {} };
    const loaded = new Map<string, { exports: any }>();
    function load(filename: string): any {
        const cached = loaded.get(filename);
        if (cached) { return cached.exports; }
        const module = { exports: {} as any };
        loaded.set(filename, module);
        const realRequire = createRequire(filename);
        vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
            module, exports: module.exports, process, Buffer, console, setTimeout, clearTimeout,
            require: (id: string) => {
                if (id === 'vscode') { return vscode; }
                const resolved = realRequire.resolve(id);
                return id.startsWith('.') && resolved.endsWith('.js') ? load(resolved) : realRequire(id);
            },
        }, { filename });
        return module.exports;
    }
    const { GPLRenameProvider } = load(path.resolve(__dirname, '../providers/renameProvider.js'));
    const provider = new GPLRenameProvider(index, {});
    const target = { scope: 'global', symbol: index.findAllByName('Before')[0] };
    return {
        check: () => provider.checkCollision(target, 'Taken', {}),
        add: (file: string) => { index.updateFileText(file, 'Module Taken\nEnd Module'); index.rebuildNameIndex(); },
        targetFile, otherFile, libraryFile,
    };
}

test('renameProvider: 다른 프로젝트의 동명 모듈은 이름 변경을 막지 않는다', () => {
    const s = setup();
    s.add(s.otherFile);
    assert.doesNotThrow(s.check);
});

test('renameProvider: 같은 프로젝트의 모듈 충돌은 계속 차단한다', () => {
    const s = setup();
    s.add(path.join(path.dirname(s.targetFile), 'Taken.gpl'));
    assert.throws(s.check, /Taken/);
});

test('renameProvider: 같은 컴파일 단위의 라이브러리 충돌도 차단한다', () => {
    const s = setup(true);
    s.add(s.libraryFile);
    assert.throws(s.check, /Taken/);
});
