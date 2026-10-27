import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from '../../harness';
import { sourceOrderFor } from '../../../project/sources/sourceOrder';

function makeProject(files: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-srcorder-'));
    for (const [rel, text] of Object.entries(files)) {
        const full = path.join(root, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, text, 'utf8');
    }
    return root;
}

function cleanup(root: string): void {
    // fs.rmSync 는 경로에 비ASCII 가 있으면 Node 가 죽는 사례가 있어 쓰지 않는다.
    const walk = (dir: string): void => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) { walk(full); fs.rmdirSync(full); } else { fs.unlinkSync(full); }
        }
    };
    try { walk(root); fs.rmdirSync(root); } catch { /* noop */ }
}

const GPR = (sources: string[]): string =>
    ['ProjectBegin', 'ProjectName="X"', ...sources.map(s => `ProjectSource="${s}"`), 'ProjectEnd'].join('\r\n') + '\r\n';

test('sourceOrder: 리프 .gpr 보다 찾는 파일을 더 많이 나열한 루트 .gpr 순서를 쓰고, 같으면 바깥쪽', () => {
    const root = makeProject({
        'Project.gpr': GPR(['Lib\\B.gpl', 'Lib\\A.gpl', 'App\\M.gpl']),
        'Lib/Project.gpr': GPR(['A.gpl']),
        'Lib/A.gpl': '', 'Lib/B.gpl': '', 'App/M.gpl': '',
    });
    try {
        const a = path.join(root, 'Lib', 'A.gpl');
        const b = path.join(root, 'Lib', 'B.gpl');
        const fromLib = sourceOrderFor(a, [b]);
        assert.strictEqual(fromLib(b), 0, '리프는 B 를 모른다 → 루트 순서');
        assert.strictEqual(sourceOrderFor(a, [a])(a), 1, '둘 다 1개면 바깥쪽(루트)');
        const fromApp = sourceOrderFor(path.join(root, 'App', 'M.gpl'), [a, b]);
        assert.ok(fromApp(b)! < fromApp(a)!);
        assert.strictEqual(fromApp(path.join(root, 'Lib', 'None.gpl')), undefined);
    } finally { cleanup(root); }
});
