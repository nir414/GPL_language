import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from '../../harness';
import { checkGprFolderSync, describeGprSyncPlan, findGprFile, makeExistsOnDisk, sourceExtensionsFrom } from '../../../project/gpr/gprFolderSync';

function makeProject(files: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-gprsync-'));
    for (const [rel, text] of Object.entries(files)) {
        const full = path.join(root, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, text, 'utf8');
    }
    return root;
}

function cleanup(root: string): void {
    // fs.rmSync 는 경로에 비ASCII 가 있으면 Node 가 죽는 사례가 있어 쓰지 않는다 — 여기 경로는 ASCII 지만 같은 습관을 유지.
    const walk = (dir: string): void => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) { walk(full); fs.rmdirSync(full); } else { fs.unlinkSync(full); }
        }
    };
    try { walk(root); fs.rmdirSync(root); } catch { /* noop */ }
}

const GPR = (sources: string[]) => [
    'ProjectBegin',
    'ProjectName="BinderR3"',
    'ProjectStart="BR3_Main.MAIN"',
    ...sources.map(s => `ProjectSource="${s}"`),
    'ProjectEnd',
].join('\r\n') + '\r\n';

test('gprFolderSync: 폴더에만 있는 파일은 추가, 목록에만 있는 항목은 제거, 하위 폴더는 \\ 구분자', () => {
    const root = makeProject({
        'Project.gpr': GPR(['BR3_Main.gpl', 'Old.gpl']),
        'BR3_Main.gpl': 'Module BR3_Main\nEnd Module\n',
        'Sub/New.gpl': 'Module N\nEnd Module\n',
        'Notes.txt': 'x',
    });
    try {
        const c = checkGprFolderSync(root, path.join(root, 'Project.gpr'));
        assert.strictEqual(c.inSync, false);
        assert.deepStrictEqual(c.plan.toAdd, ['Sub\\New.gpl']);
        assert.deepStrictEqual(c.plan.toRemove.map(e => e.path), ['Old.gpl']);
        assert.strictEqual(c.plan.kept, 1);
        assert.strictEqual(c.parsed.projectName, 'BinderR3');
        assert.strictEqual(describeGprSyncPlan(c.plan), '추가 1 (Sub\\New.gpl) · 제거 1 (Old.gpl)');
        assert.strictEqual(findGprFile(root), path.join(root, 'Project.gpr'));
        assert.strictEqual(makeExistsOnDisk(root)('Sub/New.gpl'), true, '구분자가 달라도 디스크 확인은 통과');
        assert.strictEqual(makeExistsOnDisk(root)('Old.gpl'), false);
    } finally { cleanup(root); }
});

test('gprFolderSync: 일치하면 inSync, 중첩 프로젝트 소스는 제외, 본문을 넘기면 파일 대신 그 본문으로 대조', () => {
    const root = makeProject({
        'Project.gpr': GPR(['Main.gpl']),
        'Main.gpl': '',
        'Lib/Project.gpr': GPR(['L.gpl']),
        'Lib/L.gpl': '',
    });
    try {
        const c = checkGprFolderSync(root, path.join(root, 'Project.gpr'));
        assert.strictEqual(c.inSync, true, JSON.stringify(c.plan));
        assert.deepStrictEqual(c.nestedProjects, [path.join(root, 'Lib')]);
        assert.strictEqual(describeGprSyncPlan(c.plan), '변경 없음');
        // 열려 있는(더티) 문서 본문으로 대조 — 디스크의 .gpr 와 달라도 넘긴 본문이 기준이다.
        const dirty = checkGprFolderSync(root, path.join(root, 'Project.gpr'), { gprText: GPR([]) });
        assert.deepStrictEqual(dirty.plan.toAdd, ['Main.gpl']);
        assert.strictEqual(dirty.text, GPR([]));
    } finally { cleanup(root); }
});

test('gprFolderSync: 확장자 설정 — 비어 있거나 모양이 다르면 기본 .gpl, 긴 목록 요약은 5개 뒤 "외 N개"', () => {
    assert.deepStrictEqual(sourceExtensionsFrom(undefined), ['.gpl']);
    assert.deepStrictEqual(sourceExtensionsFrom([]), ['.gpl']);
    assert.deepStrictEqual(sourceExtensionsFrom(['.gpl', ' ', 3]), ['.gpl']);
    assert.deepStrictEqual(sourceExtensionsFrom(['.gpl', '.txt']), ['.gpl', '.txt']);
    const many = { toAdd: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], toRemove: [], kept: 0 };
    assert.strictEqual(describeGprSyncPlan(many), '추가 7 (a, b, c, d, e 외 2개)');
});
