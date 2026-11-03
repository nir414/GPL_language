import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from '../../harness';
import { isLibraryProjectDir, readCompiledLibraryValues } from '../../../controller/deployment/compiledLibraries';

// ─── 컴파일 범위의 ProjectLibrary 값 — "컴파일 검증 필요" 라이브러리 항목 해제의 입력 (2026-11-03 inbox ①) ───
// Sample Prep 배치: projects/App → PaL·Gantry, Gantry → PaL(전이). tools/Probe → PaL 은 로컬에서 못 찾아도 값은 남는다.

function writeGpr(dir: string, body: string): void {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'Project.gpr'), body);
}

function withLayout(run: (root: string) => void): void {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-compiled-libs-'));
    try {
        writeGpr(path.join(root, 'projects', 'App'), 'ProjectName="App"\r\nProjectStart="Main"\r\nProjectLibrary="PaL"\r\nProjectLibrary="Gantry"\r\n');
        writeGpr(path.join(root, 'projects', 'Gantry'), 'ProjectName="Gantry"\r\nProjectLibrary="PaL"\r\n');
        writeGpr(path.join(root, 'projects', 'PaL'), 'ProjectName="PaL"\r\n');
        writeGpr(path.join(root, 'projects', 'Solo'), 'ProjectName="Solo"\r\nProjectStart="Main"\r\nProjectLibrary="Gantry"\r\n');
        writeGpr(path.join(root, 'tools', 'Probe'), 'ProjectName="Probe"\r\nProjectStart="Main"\r\nProjectLibrary="PaL"\r\n');
        run(root);
    } finally {
        // fs.rmSync 는 쓰지 않는다(비ASCII 경로 크래시 이력) — 파일을 지운 뒤 빈 폴더를 깊은 것부터 지운다.
        const walk = (dir: string): void => {
            for (const name of fs.readdirSync(dir)) {
                const p = path.join(dir, name);
                if (fs.statSync(p).isDirectory()) { walk(p); fs.rmdirSync(p); } else { fs.unlinkSync(p); }
            }
        };
        walk(root);
        fs.rmdirSync(root);
    }
}

test('compiledLibraries: 값을 전이로 모은다 — Solo → Gantry → PaL', () => {
    withLayout(root => {
        assert.deepStrictEqual(readCompiledLibraryValues(path.join(root, 'projects', 'App')), ['PaL', 'Gantry']);
        assert.deepStrictEqual(readCompiledLibraryValues(path.join(root, 'projects', 'Solo')), ['Gantry', 'PaL']);
    });
});

test('compiledLibraries: 로컬에서 폴더를 못 찾은 값도 원문 그대로(제어기는 /GPL/<값> 을 컴파일했다)', () => {
    withLayout(root => {
        assert.deepStrictEqual(readCompiledLibraryValues(path.join(root, 'tools', 'Probe')), ['PaL']);
        assert.deepStrictEqual(readCompiledLibraryValues(path.join(root, 'missing')), []);
    });
});

test('compiledLibraries: isLibraryProjectDir — ProjectStart 없으면 true, 있으면 false, .gpr 없으면 undefined', () => {
    withLayout(root => {
        assert.strictEqual(isLibraryProjectDir(path.join(root, 'projects', 'PaL')), true);
        assert.strictEqual(isLibraryProjectDir(path.join(root, 'projects', 'App')), false);
        assert.strictEqual(isLibraryProjectDir(path.join(root, 'missing')), undefined);
    });
});
