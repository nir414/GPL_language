import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from './harness';

const { pruneBuildOutputs } = require(path.resolve(__dirname, '../../scripts/prune-build-outputs.js')) as {
    pruneBuildOutputs(projectDir: string): string[];
};

function fixture(run: (root: string, write: (file: string, text?: string) => string) => void): void {
    const tempRoot = fs.realpathSync(os.tmpdir());
    const root = fs.mkdtempSync(path.join(tempRoot, 'gpl-build-outputs-'));
    const write = (file: string, text = '') => {
        const target = path.join(root, file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, text);
        return target;
    };
    write('tsconfig.json', JSON.stringify({
        compilerOptions: { outDir: 'out', rootDir: 'src', sourceMap: true, target: 'ES2020', module: 'commonjs' },
        include: ['src/**/*.ts'],
    }));
    write('src/Main.ts', 'export const value = 1;');
    try { run(root, write); }
    finally {
        const relative = path.relative(tempRoot, fs.realpathSync(root));
        assert.ok(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
        fs.rmSync(root, { recursive: true, force: true });
    }
}

test('빌드 정리: tsconfig의 현재 JS·맵과 별도 번들·리소스는 보존하고 옛 산출물만 제거한다', () => {
    fixture((root, write) => {
        const kept = ['out/Main.js', 'out/Main.js.map', 'out/mcp/server.cjs', 'out/mcp/server.cjs.map', 'out/data.json'];
        const stale = ['out/Old.js', 'out/Old.js.map', 'out/nested/orphan.js.map'];
        for (const file of [...kept, ...stale]) { write(file, file); }
        assert.deepStrictEqual(pruneBuildOutputs(root).sort(), stale.map(file => path.normalize(file)).sort());
        for (const file of kept) { assert.strictEqual(fs.readFileSync(path.join(root, file), 'utf8'), file); }
        for (const file of stale) { assert.strictEqual(fs.existsSync(path.join(root, file)), false); }
        assert.deepStrictEqual(pruneBuildOutputs(root), []);
    });
});

test('빌드 정리: 출력 폴더가 아직 없으면 생성하거나 다른 파일을 지우지 않는다', () => {
    fixture((root) => {
        assert.deepStrictEqual(pruneBuildOutputs(root), []);
        assert.strictEqual(fs.existsSync(path.join(root, 'src/Main.ts')), true);
        assert.strictEqual(fs.existsSync(path.join(root, 'out')), false);
    });
});

test('빌드 정리: 잘못된 설정과 프로젝트 밖·소스와 겹친 출력 폴더는 삭제 전에 거부한다', () => {
    fixture((root, write) => {
        const old = write('out/Old.js', 'keep');
        for (const config of [
            '{ invalid',
            JSON.stringify({ compilerOptions: { outDir: '../outside' }, include: ['src/**/*.ts'] }),
            JSON.stringify({ compilerOptions: { outDir: '.' }, include: ['src/**/*.ts'] }),
            JSON.stringify({ compilerOptions: { outDir: 'src' }, include: ['src/**/*.ts'], exclude: [] }),
        ]) {
            write('tsconfig.json', config);
            assert.throws(() => pruneBuildOutputs(root));
            assert.strictEqual(fs.readFileSync(old, 'utf8'), 'keep');
        }
    });
});

test('빌드 정리: 출력 폴더의 junction을 만나면 대상과 앞서 찾은 잔여 파일 모두 보존한다', () => {
    fixture((root, write) => {
        const old = write('out/aaa-old.js', 'keep');
        const target = write('external/target.js', 'target');
        fs.symlinkSync(path.dirname(target), path.join(root, 'out/zzz-linked'), 'junction');
        assert.throws(() => pruneBuildOutputs(root), /link/i);
        assert.strictEqual(fs.readFileSync(old, 'utf8'), 'keep');
        assert.strictEqual(fs.readFileSync(target, 'utf8'), 'target');
    });
});

test('빌드 정리: 출력 폴더 자체가 junction이면 대상 산출물을 보존한다', () => {
    fixture((root, write) => {
        const target = write('external/Old.js', 'target');
        fs.symlinkSync(path.dirname(target), path.join(root, 'out'), 'junction');
        assert.throws(() => pruneBuildOutputs(root), /link/i);
        assert.strictEqual(fs.readFileSync(target, 'utf8'), 'target');
    });
});

test('빌드 정리: 출력 폴더의 상위 junction도 따라가지 않는다', () => {
    fixture((root, write) => {
        const target = write('external/out/Old.js', 'target');
        fs.symlinkSync(path.join(root, 'external'), path.join(root, 'linked'), 'junction');
        write('tsconfig.json', JSON.stringify({
            compilerOptions: { outDir: 'linked/out', rootDir: 'src' }, include: ['src/**/*.ts'],
        }));
        assert.throws(() => pruneBuildOutputs(root), /link/i);
        assert.strictEqual(fs.readFileSync(target, 'utf8'), 'target');
    });
});
