import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from '../../harness';
import { checkGprFolderSync, describeGprSyncPlan, detectStartProcedure, findGprFile, makeExistsOnDisk, sourceExtensionsFrom } from '../../../project/gpr/gprFolderSync';
import { applyGprSync, createGprText } from '../../../project/gpr/gprSync';

// 중첩 폴더 소스를 .gpr 하나로 묶는 라이브러리(project-file-gpr.md §4.1) — 2026-11-13 실제 Sample Prep Lib/v1 사본으로 확인한 동작을 고정한다.
test('gprFolderSync: 라이브러리 루트 .gpr 하나 — 하위 폴더 소스를 역슬래시 경로로 채우고 다시 대조하면 동기화됨', () => {
    const root = makeProject({
        'Project.gpr': ['ProjectBegin', 'ProjectName="Lib"', 'ProjectEnd', ''].join('\r\n'),
        'Core/Log/Logger.gpl': 'Module LOG\r\nEnd Module\r\n',
        'Core/Text/StringUtils.gpl': 'Module PRS\r\nEnd Module\r\n',
        'Util/Util.gpl': 'Module UTL\r\nEnd Module\r\n',
    });
    try {
        const gpr = path.join(root, 'Project.gpr');
        const check = checkGprFolderSync(root, gpr);
        assert.deepStrictEqual(check.plan.toAdd, ['Core\\Log\\Logger.gpl', 'Core\\Text\\StringUtils.gpl', 'Util\\Util.gpl']);
        assert.deepStrictEqual(check.nestedProjects, []);
        fs.writeFileSync(gpr, applyGprSync(check.text, { add: check.plan.toAdd }), 'utf8');
        assert.ok(fs.readFileSync(gpr, 'utf8').includes('ProjectSource="Core\\Log\\Logger.gpl"'));
        assert.strictEqual(checkGprFolderSync(root, gpr).inSync, true);
    } finally { cleanup(root); }
});

test('gprFolderSync: 하위 폴더에 리프 .gpr 가 남아 있으면 그 폴더는 루트 .gpr 대상에서 빠진다(중첩 프로젝트)', () => {
    const root = makeProject({
        'Project.gpr': ['ProjectBegin', 'ProjectName="Lib"', 'ProjectEnd', ''].join('\r\n'),
        'Core/Log/Project.gpr': ['ProjectBegin', 'ProjectName="Lib_Log"', 'ProjectSource="Logger.gpl"', 'ProjectEnd', ''].join('\r\n'),
        'Core/Log/Logger.gpl': 'Module LOG\r\nEnd Module\r\n',
        'Frame/Tool/ToolTable.gpl': 'Module TOOL\r\nEnd Module\r\n',
    });
    try {
        const check = checkGprFolderSync(root, path.join(root, 'Project.gpr'));
        assert.deepStrictEqual(check.plan.toAdd, ['Frame\\Tool\\ToolTable.gpl']);
        assert.strictEqual(check.nestedProjects.length, 1);
    } finally { cleanup(root); }
});

test('gprFolderSync: detectStartProcedure — Sub Main 선언이 있을 때만 Main, 없으면 null 이고 새 .gpr 에 ProjectStart 줄이 없다', () => {
    const root = makeProject({
        'App/Main.gpl': 'Module Main\r\n    Public Sub Main()\r\n    End Sub\r\nEnd Module\r\n',
        'Lib/Core/Log/Logger.gpl': "Module LOG\r\n    ' Sub Main 은 여기 없다\r\n    Public Sub Write()\r\n        Console.WriteLine(\"Sub Main\")\r\n    End Sub\r\n    Public Sub MainLoop()\r\n    End Sub\r\nEnd Module\r\n",
    });
    try {
        assert.strictEqual(detectStartProcedure(path.join(root, 'App'), ['Main.gpl']), 'Main');
        assert.strictEqual(detectStartProcedure(path.join(root, 'Lib'), ['Core\\Log\\Logger.gpl', 'Missing.gpl']), null);
        const lib = createGprText({ projectName: 'Lib', sources: ['Core\\Log\\Logger.gpl'], projectStart: null });
        assert.ok(!/ProjectStart/.test(lib));
        assert.ok(lib.includes('ProjectSource="Core\\Log\\Logger.gpl"'));
        assert.ok(/ProjectStart="Main"/.test(createGprText({ projectName: 'App', sources: ['Main.gpl'] })));
    } finally { cleanup(root); }
});

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
