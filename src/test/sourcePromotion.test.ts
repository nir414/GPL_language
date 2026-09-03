import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from './harness';
import { buildLibraryGraph } from '../project/projectSources';
import { planSourcePromotion } from '../project/sourcePromotion';
import { normalizeDirKey } from '../controller/projectPickerCore';

/**
 * 실제 구조 픽스처 — `projects/GPL_Code`(2026-09-02 확인)의 형태를 줄인 것.
 *
 *   GPL_Code/Project.gpr        ProjectLibrary="GPL_Code\Lib_Core" / "GPL_Code\Lib_Net"
 *                              ProjectSource="Main.gpl"
 *   Lib_Core/Project.gpr       그룹(소스 없음) → Base / Log / LogFile
 *   Lib_Core/Base/…            Lib_Base       ProjectSource="Base.gpl"
 *   Lib_Core/Log/…             Lib_Log        → Base,  ProjectSource="Logger.gpl"
 *   Lib_Core/LogFile/…         Lib_LogFile    → Base, Log,  ProjectSource="LogFile.gpl"
 *   Lib_Net/Project.gpr        그룹(소스 없음) → Server
 *   Lib_Net/Server/…           Lib_NetServer  → Log,  ProjectSource="Loop.gpl","Server.gpl"
 *
 * 부모를 되참조하는 형태(LogFile → Log → Base, Server → Log)와 그룹 참조가 함께 있는 것이
 * 이 구조의 핵심이다 — 승격 계획은 그 DAG를 풀어야 나온다.
 */
function gpr(name: string, libraries: readonly string[], sources: readonly string[]): string {
    return [
        'ProjectBegin',
        `ProjectName="${name}"`,
        ...libraries.map(l => `ProjectLibrary="${l}"`),
        ...sources.map(s => `ProjectSource="${s}"`),
        'ProjectEnd',
    ].join('\r\n') + '\r\n';
}

interface Fixture {
    root: string;
    mainDir: string;
    mainGpr: string;
    mainText: string;
    gprPaths: string[];
    file(rel: string): string;
    cleanup(): void;
}

function makeNestedLibraryTree(mainLibraries: readonly string[]): Fixture {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-promote-test-'));
    const mainDir = path.join(root, 'projects', 'GPL_Code');
    const gprPaths: string[] = [];
    const write = (rel: string, content: string): void => {
        const full = path.join(mainDir, ...rel.split('/'));
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content, 'utf8');
        if (full.toLowerCase().endsWith('.gpr')) { gprPaths.push(full); }
    };

    const mainText = gpr('GPL_Code', mainLibraries, ['Main.gpl']);
    write('Project.gpr', mainText);
    write('Main.gpl', 'Module Main\r\nEnd Module\r\n');

    write('Lib_Core/Project.gpr', gpr('Lib_Core', [
        'GPL_Code\\Lib_Core\\Base', 'GPL_Code\\Lib_Core\\Log', 'GPL_Code\\Lib_Core\\LogFile',
    ], []));
    write('Lib_Core/Base/Project.gpr', gpr('Lib_Base', [], ['Base.gpl']));
    write('Lib_Core/Base/Base.gpl', 'Module FND\r\nEnd Module\r\n');
    write('Lib_Core/Log/Project.gpr', gpr('Lib_Log', ['GPL_Code\\Lib_Core\\Base'], ['Logger.gpl']));
    write('Lib_Core/Log/Logger.gpl', 'Module LOG\r\nEnd Module\r\n');
    write('Lib_Core/LogFile/Project.gpr', gpr('Lib_LogFile',
        ['GPL_Code\\Lib_Core\\Base', 'GPL_Code\\Lib_Core\\Log'], ['LogFile.gpl']));
    write('Lib_Core/LogFile/LogFile.gpl', 'Module LGF\r\nEnd Module\r\n');

    write('Lib_Net/Project.gpr', gpr('Lib_Net', ['GPL_Code\\Lib_Net\\Server'], []));
    write('Lib_Net/Server/Project.gpr', gpr('Lib_NetServer',
        ['GPL_Code\\Lib_Core\\Log'], ['Loop.gpl', 'Server.gpl']));
    write('Lib_Net/Server/Loop.gpl', 'Module NSL\r\nEnd Module\r\n');
    write('Lib_Net/Server/Server.gpl', 'Module NET\r\nEnd Module\r\n');

    // 등재되지 않은 파일 — "컴파일되지 않는 파일" 판정용
    write('Lib_Core/Base/Orphan.gpl', 'Module ORP\r\nEnd Module\r\n');

    return {
        root,
        mainDir,
        mainGpr: path.join(mainDir, 'Project.gpr'),
        mainText,
        gprPaths,
        file(rel: string) { return path.join(mainDir, ...rel.split('/')); },
        cleanup() { removeTree(root); },
    };
}

/**
 * 재귀 삭제 — `fs.rmSync`를 쓰지 않는다. 경로에 비ASCII가 섞이면 Node(Win)가 예외 없이
 * 죽는 사례가 있어(0xC0000409) 테스트가 조용히 중단된다. `unlinkSync`/`rmdirSync`는 안전하다.
 */
function removeTree(dir: string): void {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { removeTree(full); } else { try { fs.unlinkSync(full); } catch { /* 무시 */ } }
    }
    try { fs.rmdirSync(dir); } catch { /* 무시 */ }
}

const BOTH_GROUPS = ['GPL_Code\\Lib_Core', 'GPL_Code\\Lib_Net'];

test('buildLibraryGraph: 중첩 그룹·되참조 DAG를 순환 없이 풀고 간선을 노드에 남긴다', () => {
    const p = makeNestedLibraryTree(BOTH_GROUPS);
    try {
        const graph = buildLibraryGraph(p.mainGpr, p.mainText, { knownGprPaths: p.gprPaths });
        assert.deepStrictEqual(graph.unresolved, []);
        assert.deepStrictEqual(
            graph.dirs.map(d => path.relative(p.mainDir, d).replace(/\\/g, '/')),
            ['Lib_Core', 'Lib_Core/Base', 'Lib_Core/Log', 'Lib_Core/LogFile', 'Lib_Net', 'Lib_Net/Server'],
            '참조 선언 순서를 유지하고 중복 방문은 한 번만 센다',
        );

        // 재방문(공유) 노드의 간선도 그래프에 남아야 경로 탐색이 된다 —
        // Lib_Log 는 Lib_Core·Lib_LogFile·Lib_NetServer 세 곳에서 참조된다.
        const server = graph.nodes.get(normalizeDirKey(p.file('Lib_Net/Server')))!;
        assert.deepStrictEqual(server.refs.map(r => r.raw), ['GPL_Code\\Lib_Core\\Log']);
        assert.ok(server.refs[0].dir, '두 번째로 만난 참조도 해석된 폴더를 갖는다');
        assert.strictEqual(server.projectName, 'Lib_NetServer');
        assert.deepStrictEqual(
            server.sources.map(s => path.basename(s)),
            ['Loop.gpl', 'Server.gpl'],
        );

        const logFile = graph.nodes.get(normalizeDirKey(p.file('Lib_Core/LogFile')))!;
        assert.deepStrictEqual(logFile.refs.map(r => r.raw),
            ['GPL_Code\\Lib_Core\\Base', 'GPL_Code\\Lib_Core\\Log']);
    } finally {
        p.cleanup();
    }
});

test('sourcePromotion: 이미 메인 ProjectSource면 편집할 것이 없다', () => {
    const p = makeNestedLibraryTree(BOTH_GROUPS);
    try {
        const plan = planSourcePromotion({
            mainGprPath: p.mainGpr, mainGprText: p.mainText,
            targetFile: p.file('Main.gpl'), knownGprPaths: p.gprPaths,
        });
        assert.strictEqual(plan.status, 'already-source');
        assert.strictEqual(plan.targetRel, 'Main.gpl');
        assert.strictEqual(plan.newText, undefined, '편집안을 내놓지 않는다');
    } finally {
        p.cleanup();
    }
});

test('sourcePromotion: 어떤 .gpr에도 등재되지 않은 파일은 BP 대상이 아니라고 알린다', () => {
    const p = makeNestedLibraryTree(BOTH_GROUPS);
    try {
        const plan = planSourcePromotion({
            mainGprPath: p.mainGpr, mainGprText: p.mainText,
            targetFile: p.file('Lib_Core/Base/Orphan.gpl'), knownGprPaths: p.gprPaths,
        });
        assert.strictEqual(plan.status, 'not-compiled');
        assert.match(plan.reason ?? '', /ProjectSource 로 없습니다/);
    } finally {
        p.cleanup();
    }
});

test('sourcePromotion: 다른 참조로 여전히 도달하는 라이브러리는 다시 적지 않는다 (최소 diff)', () => {
    // Lib_Net → Server → Log → Base 경로가 살아 있으므로 Lib_Core 를 빼도 Base/Log 는 그대로 온다.
    const p = makeNestedLibraryTree(BOTH_GROUPS);
    try {
        const plan = planSourcePromotion({
            mainGprPath: p.mainGpr, mainGprText: p.mainText,
            targetFile: p.file('Lib_Core/LogFile/LogFile.gpl'), knownGprPaths: p.gprPaths,
        });
        assert.strictEqual(plan.status, 'ready');
        assert.strictEqual(plan.owningLibraryName, 'Lib_LogFile');
        assert.strictEqual(plan.targetRel, 'Lib_Core\\LogFile\\LogFile.gpl');
        assert.deepStrictEqual(plan.removeLibraries, ['GPL_Code\\Lib_Core']);
        assert.deepStrictEqual(plan.addSources, ['Lib_Core\\LogFile\\LogFile.gpl']);
        assert.deepStrictEqual(plan.addLibraries, [], 'Base/Log 는 Lib_Net 경유로 이미 도달한다');
        assert.deepStrictEqual(plan.verification,
            { ok: true, lost: [], duplicated: [], unresolved: [] });
    } finally {
        p.cleanup();
    }
});

test('sourcePromotion: 그룹 참조를 빼면 그 그룹의 나머지 하위를 개별 참조로 복구한다 (실사용 편집과 일치)', () => {
    // 메인이 Lib_Core 만 참조 → Base/Log 는 그 그룹으로만 도달한다. 사용자가 손으로 한 편집과 같은 결과.
    const p = makeNestedLibraryTree(['GPL_Code\\Lib_Core']);
    try {
        const plan = planSourcePromotion({
            mainGprPath: p.mainGpr, mainGprText: p.mainText,
            targetFile: p.file('Lib_Core/LogFile/LogFile.gpl'), knownGprPaths: p.gprPaths,
        });
        assert.strictEqual(plan.status, 'ready');
        assert.deepStrictEqual(plan.removeLibraries, ['GPL_Code\\Lib_Core']);
        assert.deepStrictEqual(plan.addLibraries,
            ['GPL_Code\\Lib_Core\\Base', 'GPL_Code\\Lib_Core\\Log']);
        assert.deepStrictEqual(plan.addSources, ['Lib_Core\\LogFile\\LogFile.gpl']);
        assert.strictEqual(plan.verification.ok, true);

        // 편집 결과 텍스트: 원본 줄바꿈(CRLF)·되돌리기 주석·ProjectEnd 앞 삽입
        const text = plan.newText!;
        const lines = text.split('\r\n');
        assert.ok(text.includes('\r\n'), 'CRLF 를 유지한다');
        assert.ok(
            !lines.includes('ProjectLibrary="GPL_Code\\Lib_Core"'),
            '그룹 참조 줄이 지워졌다 (주석으로 남은 같은 문자열과 구분해 줄 단위로 본다)',
        );
        assert.ok(
            lines.includes('\'   ProjectLibrary="GPL_Code\\Lib_Core"'),
            '되돌리기용 원본을 주석으로 남긴다',
        );
        assert.ok(text.includes('ProjectSource="Lib_Core\\LogFile\\LogFile.gpl"'));
        assert.ok(text.trimEnd().endsWith('ProjectEnd'), '삽입은 ProjectEnd 앞에');
    } finally {
        p.cleanup();
    }
});

test('sourcePromotion: 한 라이브러리의 소스는 전부 함께 승격된다 (일부만 옮기면 나머지가 빠지므로)', () => {
    const p = makeNestedLibraryTree(BOTH_GROUPS);
    try {
        const plan = planSourcePromotion({
            mainGprPath: p.mainGpr, mainGprText: p.mainText,
            targetFile: p.file('Lib_Net/Server/Loop.gpl'), knownGprPaths: p.gprPaths,
        });
        assert.strictEqual(plan.status, 'ready');
        assert.strictEqual(plan.owningLibraryName, 'Lib_NetServer');
        assert.deepStrictEqual(plan.removeLibraries, ['GPL_Code\\Lib_Net']);
        assert.deepStrictEqual(plan.addSources,
            ['Lib_Net\\Server\\Loop.gpl', 'Lib_Net\\Server\\Server.gpl']);
        assert.strictEqual(plan.verification.ok, true);
        assert.ok(plan.warnings.some(w => /소스 2개/.test(w)), '함께 승격되는 사실을 경고로 알린다');
    } finally {
        p.cleanup();
    }
});

test('sourcePromotion: 계획을 적용하면 컴파일 집합이 그대로 유지된다 (그래프 재검증)', () => {
    for (const mainLibs of [BOTH_GROUPS, ['GPL_Code\\Lib_Core']]) {
        const p = makeNestedLibraryTree(mainLibs);
        try {
            const before = new Set(
                [...buildLibraryGraph(p.mainGpr, p.mainText, { knownGprPaths: p.gprPaths }).nodes.values()]
                    .flatMap(n => n.sources).map(s => path.basename(s).toLowerCase()),
            );
            for (const target of ['Lib_Core/LogFile/LogFile.gpl', 'Lib_Core/Log/Logger.gpl']) {
                const plan = planSourcePromotion({
                    mainGprPath: p.mainGpr, mainGprText: p.mainText,
                    targetFile: p.file(target), knownGprPaths: p.gprPaths,
                });
                assert.strictEqual(plan.status, 'ready', `${target} (${mainLibs.length}개 참조)`);
                const after = buildLibraryGraph(p.mainGpr, plan.newText!, { knownGprPaths: p.gprPaths });
                const afterFiles = new Set(
                    [...after.nodes.values()].flatMap(n => n.sources).map(s => path.basename(s).toLowerCase()),
                );
                assert.deepStrictEqual([...before].sort(), [...afterFiles].sort(),
                    `${target}: 컴파일 집합이 바뀌면 안 된다`);
                assert.strictEqual(plan.verification.ok, true, `${target}: 자체 검증도 통과`);
                // 대상이 메인 ProjectSource 로 올라갔는가 = BP 가 걸릴 조건
                assert.ok(
                    plan.newText!.includes(`ProjectSource="${plan.targetRel}"`),
                    `${target}: 대상이 메인 ProjectSource 에 있어야 Set Break 가 해석한다`,
                );
            }
        } finally {
            p.cleanup();
        }
    }
});

test('sourcePromotion: 메인 폴더 밖 라이브러리는 ProjectSource 로 적을 수 없다고 막는다', () => {
    const p = makeNestedLibraryTree(['Shared_Lib']);
    try {
        // projects/Shared_Lib — 메인(projects/GPL_Code) 폴더 밖의 형제 라이브러리
        const sharedDir = path.join(p.root, 'projects', 'Shared_Lib');
        fs.mkdirSync(sharedDir, { recursive: true });
        fs.writeFileSync(path.join(sharedDir, 'Project.gpr'), gpr('Shared_Lib', [], ['Shared.gpl']), 'utf8');
        fs.writeFileSync(path.join(sharedDir, 'Shared.gpl'), 'Module SHR\r\nEnd Module\r\n', 'utf8');

        const plan = planSourcePromotion({
            mainGprPath: p.mainGpr, mainGprText: p.mainText,
            targetFile: path.join(sharedDir, 'Shared.gpl'),
            knownGprPaths: [...p.gprPaths, path.join(sharedDir, 'Project.gpr')],
        });
        assert.strictEqual(plan.status, 'outside-main-dir');
        assert.match(plan.reason ?? '', /Shared\.gpl/);
        assert.strictEqual(plan.newText, undefined, '적용안을 내놓지 않는다');
    } finally {
        p.cleanup();
    }
});
