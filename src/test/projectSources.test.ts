import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from './harness';
import {
    GPR_PATH_SEPARATOR,
    collectProjectSourcePaths,
    collectRelatedGprPaths,
    findNearestGprOnDisk,
    listSourceFilesRecursive,
    pickOwningGprPath,
    resolveGprSourcePaths,
    resolveProjectLibraryDirs,
} from '../project/projectSources';
import { parseGprText, planGprSync } from '../controller/gprSync';
import { pickSourceCandidate } from '../controller/responseParser';

/**
 * 실제 파일 확인(2026-08-28, TEST_GPL)에서 온 중첩 구조 픽스처.
 *
 *   TEST_GPL/Project.gpr  ProjectSource="Main.gpl" / "T1\T1.gpl" / "T1\T2\T2.gpl"
 *   TEST_GPL/Main.gpl
 *   TEST_GPL/T1/T1.gpl
 *   TEST_GPL/T1/T2/T2.gpl
 */
const GPR_TEXT = [
    `'08/28/2026, 03:58:19 PM`,
    'ProjectBegin',
    'ProjectName="TEST_GPL"',
    'ProjectStart="Main"',
    'ProjectSource="Main.gpl"',
    'ProjectSource="T1\\T1.gpl"',
    'ProjectSource="T1\\T2\\T2.gpl"',
    'ProjectEnd',
].join('\r\n') + '\r\n';

function makeNestedProject() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-projectsources-test-'));
    const dir = path.join(root, 'projects', 'TEST_GPL');
    const write = (rel: string, content: string) => {
        const full = path.join(dir, ...rel.split('/'));
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content, 'utf8');
    };
    write('Project.gpr', GPR_TEXT);
    write('Main.gpl', 'Module Main\r\nEnd Module\r\n');
    write('T1/T1.gpl', 'Module T1\r\nEnd Module\r\n');
    write('T1/T2/T2.gpl', 'Module T2\r\nEnd Module\r\n');
    write('T1/T2/notes.txt', 'not a source');
    write('T1/T2/Legacy.gpo', 'binary-ish');
    write('.history/Main.gpl', 'stale copy');
    write('node_modules/pkg/Main.gpl', 'dependency copy');
    write('out/Main.gpl', 'build output copy');
    return {
        root,
        dir,
        gprPath: path.join(dir, 'Project.gpr'),
        write,
        cleanup() { fs.rmSync(root, { recursive: true, force: true }); },
    };
}

test('projectSources: listSourceFilesRecursive — 하위 폴더 재귀 + 제외 규칙 + GDE 구분자', () => {
    const p = makeNestedProject();
    try {
        const listed = listSourceFilesRecursive(p.dir);
        assert.strictEqual(listed.truncated, false);
        assert.deepStrictEqual(listed.files, [
            'Main.gpl',
            `T1${GPR_PATH_SEPARATOR}T1.gpl`,
            `T1${GPR_PATH_SEPARATOR}T2${GPR_PATH_SEPARATOR}T2.gpl`,
        ], '.history/node_modules/out 사본과 .txt/.gpo는 제외되어야 한다');

        // 구분자 옵션 + 확장자 옵션
        const withGpo = listSourceFilesRecursive(p.dir, { extensions: ['.gpl', '.gpo'], separator: '/' });
        assert.deepStrictEqual(withGpo.files, ['Main.gpl', 'T1/T1.gpl', 'T1/T2/Legacy.gpo', 'T1/T2/T2.gpl']);
    } finally {
        p.cleanup();
    }
});

test('projectSources: listSourceFilesRecursive — 상한 초과는 truncated 로 알린다(조용히 자르지 않음)', () => {
    const p = makeNestedProject();
    try {
        const capped = listSourceFilesRecursive(p.dir, { maxFiles: 2 });
        assert.strictEqual(capped.truncated, true);
        assert.ok(capped.files.length <= 2);

        const shallow = listSourceFilesRecursive(p.dir, { maxDepth: 1 });
        assert.strictEqual(shallow.truncated, true, 'maxDepth 로 하위 폴더를 못 봤으면 truncated');
        assert.deepStrictEqual(shallow.files, ['Main.gpl']);
    } finally {
        p.cleanup();
    }
});

test('projectSources: resolveGprSourcePaths — `\\`·`/`·절대 경로 항목을 절대 경로로 해석', () => {
    const p = makeNestedProject();
    try {
        const resolved = resolveGprSourcePaths(p.gprPath, GPR_TEXT);
        assert.deepStrictEqual(resolved, [
            path.join(p.dir, 'Main.gpl'),
            path.join(p.dir, 'T1', 'T1.gpl'),
            path.join(p.dir, 'T1', 'T2', 'T2.gpl'),
        ]);

        // 슬래시 표기와 중복 항목도 같은 파일로 본다.
        const mixed = [
            'ProjectBegin',
            'ProjectSource="T1/T2/T2.gpl"',
            'ProjectSource="T1\\T2\\T2.gpl"',
            'ProjectEnd',
        ].join('\n');
        assert.deepStrictEqual(resolveGprSourcePaths(p.gprPath, mixed), [path.join(p.dir, 'T1', 'T2', 'T2.gpl')]);

        // 확장자 필터
        const withGpo = 'ProjectSource="T1\\T2\\Legacy.gpo"\nProjectSource="Main.gpl"\n';
        assert.deepStrictEqual(
            resolveGprSourcePaths(p.gprPath, withGpo, { extensions: ['.gpl'] }),
            [path.join(p.dir, 'Main.gpl')],
        );
    } finally {
        p.cleanup();
    }
});

test('projectSources: collectProjectSourcePaths — .gpr 목록 ∪ 폴더 재귀 스캔', () => {
    const p = makeNestedProject();
    try {
        // .gpr에 아직 없는 새 파일도 포함(합집합)
        p.write('T1/T2/T3/New.gpl', 'Module New\r\nEnd Module\r\n');
        // 폴더 스캔에서는 빠지지만 .gpr에는 있는 항목(out/ 제외 규칙)도 포함
        const gprWithExcluded = GPR_TEXT.replace('ProjectEnd', 'ProjectSource="out\\Main.gpl"\r\nProjectEnd');

        const collected = collectProjectSourcePaths(p.gprPath, gprWithExcluded);
        const rels = collected.files
            .map(f => path.relative(p.dir, f).replace(/\\/g, '/'))
            .sort();
        assert.deepStrictEqual(rels, [
            'Main.gpl',
            'T1/T1.gpl',
            'T1/T2/T2.gpl',
            'T1/T2/T3/New.gpl',
            'out/Main.gpl',
        ]);
    } finally {
        p.cleanup();
    }
});

test('projectSources: pickOwningGprPath — 가장 가까운(깊은) 프로젝트, 같은 폴더면 Project.gpr 우선', () => {
    const outer = path.join('C:', 'ws', 'projects', 'Outer', 'Project.gpr');
    const innerA = path.join('C:', 'ws', 'projects', 'Outer', 'Sub', 'Project.gpr');
    const innerB = path.join('C:', 'ws', 'projects', 'Outer', 'Sub', 'Alt.gpr');

    const nested = path.join('C:', 'ws', 'projects', 'Outer', 'Sub', 'T1', 'T1.gpl');
    assert.strictEqual(pickOwningGprPath(nested, [outer, innerA]), innerA);
    assert.strictEqual(pickOwningGprPath(nested, [innerB, innerA]), innerA, 'Project.gpr 우선');

    const shallow = path.join('C:', 'ws', 'projects', 'Outer', 'T1', 'T2', 'T2.gpl');
    assert.strictEqual(pickOwningGprPath(shallow, [outer, innerA]), outer);

    const outside = path.join('C:', 'ws', 'other', 'X.gpl');
    assert.strictEqual(pickOwningGprPath(outside, [outer, innerA]), undefined);
});

test('projectSources: findNearestGprOnDisk — 하위 폴더 파일에서 위로 올라가 .gpr를 찾는다', () => {
    const p = makeNestedProject();
    try {
        assert.strictEqual(findNearestGprOnDisk(path.join(p.dir, 'T1', 'T2', 'T2.gpl')), p.gprPath);
        assert.strictEqual(findNearestGprOnDisk(path.join(p.dir, 'T1')), p.gprPath);
        // .gpr가 없는 트리에서는 undefined (탐색 상한 안에서)
        const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-nogpr-test-'));
        try {
            assert.strictEqual(findNearestGprOnDisk(path.join(bare, 'a.gpl'), { maxLevels: 1 }), undefined);
        } finally {
            fs.rmSync(bare, { recursive: true, force: true });
        }
    } finally {
        p.cleanup();
    }
});

test('gprSync: 하위 폴더 항목을 제거 대상으로 오판하지 않는다(재귀 목록 + 디스크 확인)', () => {
    const p = makeNestedProject();
    try {
        const parsed = parseGprText(GPR_TEXT);
        const files = listSourceFilesRecursive(p.dir).files;

        const plan = planGprSync(parsed, files);
        assert.deepStrictEqual(plan.toAdd, []);
        assert.deepStrictEqual(plan.toRemove.map(e => e.path), [], '재귀 목록이면 하위 폴더 항목이 유지된다');
        assert.strictEqual(plan.kept, 3);

        // 목록이 하위 폴더를 못 봤더라도(비재귀·상한·제외 규칙) 디스크에 있으면 제거하지 않는다.
        const existsOnDisk = (rel: string) => fs.existsSync(path.join(p.dir, rel.replace(/[\\/]+/g, path.sep)));
        const guarded = planGprSync(parsed, ['Main.gpl'], { existsOnDisk });
        assert.deepStrictEqual(guarded.toRemove.map(e => e.path), []);

        // 진짜로 사라진 항목은 여전히 제거 대상이다.
        const withGhost = parseGprText(GPR_TEXT.replace('ProjectEnd', 'ProjectSource="T1\\Gone.gpl"\r\nProjectEnd'));
        const real = planGprSync(withGhost, files, { existsOnDisk });
        assert.deepStrictEqual(real.toRemove.map(e => e.path), ['T1\\Gone.gpl']);
    } finally {
        p.cleanup();
    }
});

// ─── 중첩 프로젝트 · ProjectLibrary ──────────────────────────────────────────

/**
 * 실제 파일 확인(2026-08-31, GDS가 저장한 MyProject)에서 온 중첩 라이브러리 픽스처.
 *
 *   projects/MyProject/Project.gpr            ProjectLibrary="MyProject\MyLibrary"
 *   projects/MyProject/MyProject.gpl          Main() 에서 T1() 호출
 *   projects/MyProject/MyLibrary/Project.gpr  ProjectName="MyLibrary" (중첩 프로젝트)
 *   projects/MyProject/MyLibrary/Project.gpl  Public Sub T1()
 */
const MAIN_GPR = [
    'ProjectBegin',
    'ProjectName="MyProject"',
    'ProjectStart="Main"',
    'ProjectLibrary="MyProject\\MyLibrary"',
    'ProjectSource="MyProject.gpl"',
    'ProjectEnd',
].join('\r\n') + '\r\n';

const LIB_GPR = [
    'ProjectBegin',
    'ProjectName="MyLibrary"',
    'ProjectSource="Project.gpl"',
    'ProjectEnd',
].join('\r\n') + '\r\n';

function makeLibraryProject() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-library-test-'));
    const write = (rel: string, content: string): string => {
        const full = path.join(root, ...rel.split('/'));
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content, 'utf8');
        return full;
    };
    const mainGpr = write('projects/MyProject/Project.gpr', MAIN_GPR);
    write('projects/MyProject/MyProject.gpl', 'Module MainModule\r\nEnd Module\r\n');
    const libGpr = write('projects/MyProject/MyLibrary/Project.gpr', LIB_GPR);
    write('projects/MyProject/MyLibrary/Project.gpl', 'Module T1Module\r\nEnd Module\r\n');
    return {
        root,
        write,
        mainGpr,
        libGpr,
        mainDir: path.dirname(mainGpr),
        libDir: path.dirname(libGpr),
        cleanup() { fs.rmSync(root, { recursive: true, force: true }); },
    };
}

test('projectSources: listSourceFilesRecursive — 자기 .gpr를 가진 하위 폴더는 다른 프로젝트로 보고 멈춘다', () => {
    const p = makeLibraryProject();
    try {
        const listed = listSourceFilesRecursive(p.mainDir);
        assert.deepStrictEqual(listed.files, ['MyProject.gpl'], '라이브러리 소스는 상위 프로젝트 목록에 없다');
        assert.deepStrictEqual(listed.nestedProjects, [p.libDir], '어디서 멈췄는지 알려 준다');

        // 경계를 끄면 종전 동작(라이브러리 소스가 섞여 들어옴) — 이 차이가 회귀의 원인이었다.
        const merged = listSourceFilesRecursive(p.mainDir, { stopAtNestedProject: false, separator: '/' });
        assert.deepStrictEqual(merged.files, ['MyLibrary/Project.gpl', 'MyProject.gpl']);
        assert.deepStrictEqual(merged.nestedProjects, []);

        // 라이브러리 자신을 기준으로 부르면 루트이므로 자기 소스는 그대로 나온다.
        assert.deepStrictEqual(listSourceFilesRecursive(p.libDir).files, ['Project.gpl']);
    } finally {
        p.cleanup();
    }
});

test('gprSync: 중첩 라이브러리 소스를 상위 프로젝트의 ProjectSource로 추가하지 않는다 — 핵심 회귀', () => {
    const p = makeLibraryProject();
    try {
        const parsed = parseGprText(MAIN_GPR);
        const plan = planGprSync(parsed, listSourceFilesRecursive(p.mainDir).files);
        assert.deepStrictEqual(plan.toAdd, [], '라이브러리 파일은 추가 후보가 아니다(이미 함께 컴파일됨)');
        assert.deepStrictEqual(plan.toRemove.map(e => e.path), []);
        assert.strictEqual(plan.kept, 1);
    } finally {
        p.cleanup();
    }
});

test('projectSources: resolveProjectLibraryDirs — projects 루트 기준·프로젝트 폴더 기준 두 표기를 모두 해석', () => {
    const p = makeLibraryProject();
    try {
        // ① 실측 표기: projects 루트 기준 상대 경로
        const observed = resolveProjectLibraryDirs(p.mainGpr, MAIN_GPR);
        assert.deepStrictEqual(observed.dirs, [p.libDir]);
        assert.deepStrictEqual(observed.unresolved, []);

        // ② 프로젝트 폴더 기준 표기도 같은 폴더로 해석된다
        const relative = MAIN_GPR.replace('MyProject\\MyLibrary', 'MyLibrary');
        assert.deepStrictEqual(resolveProjectLibraryDirs(p.mainGpr, relative).dirs, [p.libDir]);

        // ③ 어느 후보로도 못 찾으면 조용히 무시하지 않고 원문을 돌려준다
        const missing = MAIN_GPR.replace('MyProject\\MyLibrary', 'NoSuchLibrary');
        const unresolved = resolveProjectLibraryDirs(p.mainGpr, missing);
        assert.deepStrictEqual(unresolved.dirs, []);
        assert.deepStrictEqual(unresolved.unresolved, ['NoSuchLibrary']);
    } finally {
        p.cleanup();
    }
});

test('projectSources: resolveProjectLibraryDirs — 형제 라이브러리·중첩 참조·순환 참조', () => {
    const p = makeLibraryProject();
    try {
        // 형제 프로젝트(projects/Lib_Apps)를 라이브러리로 참조 — 부모 기준 후보로 해석된다.
        const siblingGpr = p.write('projects/Lib_Apps/Project.gpr',
            'ProjectBegin\r\nProjectName="Lib_Apps"\r\nProjectSource="Lib.gpl"\r\nProjectEnd\r\n');
        p.write('projects/Lib_Apps/Lib.gpl', 'Module Lib\r\nEnd Module\r\n');
        const withSibling = MAIN_GPR.replace(
            'ProjectSource="MyProject.gpl"',
            'ProjectLibrary="Lib_Apps"\r\nProjectSource="MyProject.gpl"',
        );
        assert.deepStrictEqual(
            resolveProjectLibraryDirs(p.mainGpr, withSibling).dirs,
            [p.libDir, path.dirname(siblingGpr)],
            '참조 순서를 유지한다',
        );

        // 라이브러리가 또 다른 라이브러리를 참조하면 따라 내려간다(문서상 가능).
        p.write('projects/MyProject/MyLibrary/Project.gpr',
            LIB_GPR.replace('ProjectSource=', 'ProjectLibrary="Lib_Apps"\r\nProjectSource='));
        assert.deepStrictEqual(
            resolveProjectLibraryDirs(p.mainGpr, MAIN_GPR).dirs,
            [p.libDir, path.dirname(siblingGpr)],
        );

        // 라이브러리가 자신을 참조하는 프로젝트를 되참조해도 무한 루프에 빠지지 않는다.
        p.write('projects/MyProject/MyLibrary/Project.gpr',
            LIB_GPR.replace('ProjectSource=', 'ProjectLibrary="MyProject"\r\nProjectSource='));
        assert.deepStrictEqual(resolveProjectLibraryDirs(p.mainGpr, MAIN_GPR).dirs, [p.libDir]);
    } finally {
        p.cleanup();
    }
});

test('projectSources: resolveProjectLibraryDirs — 상대 경로가 빗나가면 알려진 .gpr 중 경로 끝이 맞는 것으로 폴백', () => {
    const p = makeLibraryProject();
    try {
        const sharedGpr = p.write('apps/Shared/Project.gpr',
            'ProjectBegin\r\nProjectName="Shared"\r\nProjectSource="S.gpl"\r\nProjectEnd\r\n');
        p.write('apps/Shared/S.gpl', 'Module S\r\nEnd Module\r\n');
        const text = MAIN_GPR.replace('MyProject\\MyLibrary', 'Shared');

        // projects/ 아래에도, 프로젝트 폴더 아래에도 없다 → 폴백 없이는 미해결
        assert.deepStrictEqual(resolveProjectLibraryDirs(p.mainGpr, text).unresolved, ['Shared']);

        const withKnown = resolveProjectLibraryDirs(p.mainGpr, text, {
            knownGprPaths: [p.mainGpr, p.libGpr, sharedGpr],
        });
        assert.deepStrictEqual(withKnown.dirs, [path.dirname(sharedGpr)]);
        assert.deepStrictEqual(withKnown.unresolved, []);
    } finally {
        p.cleanup();
    }
});

test('projectSources: collectRelatedGprPaths — 라이브러리(정방향)와 참조하는 프로젝트(역방향)를 모두 모은다', () => {
    const p = makeLibraryProject();
    try {
        const known = [p.mainGpr, p.libGpr];

        // 메인에서 보면: 자기 + 참조 라이브러리
        assert.deepStrictEqual(
            collectRelatedGprPaths(p.mainGpr, MAIN_GPR, { knownGprPaths: known }),
            [p.mainGpr, p.libGpr],
        );

        // 라이브러리에서 보면: 자기 + 자기를 참조하는 프로젝트 — 없으면 Public 루틴의 호출부를 놓친다.
        assert.deepStrictEqual(
            collectRelatedGprPaths(p.libGpr, LIB_GPR, { knownGprPaths: known }),
            [p.libGpr, p.mainGpr],
        );

        // 역방향을 끄면 자기 자신만
        assert.deepStrictEqual(
            collectRelatedGprPaths(p.libGpr, LIB_GPR, { knownGprPaths: known, includeReferrers: false }),
            [p.libGpr],
        );
    } finally {
        p.cleanup();
    }
});

test('responseParser: pickSourceCandidate — .gpr 목록에 있는 후보가 얕은 경로보다 우선', () => {
    const projectDir = path.join('C:', 'ws', 'projects', 'TEST_GPL');
    const shallowDecoy = path.join(projectDir, 'T2.gpl');            // 목록에 없는 동명 파일
    const listedNested = path.join(projectDir, 'T1', 'T2', 'T2.gpl'); // .gpr가 가리키는 실제 소스

    const withoutList = pickSourceCandidate([shallowDecoy, listedNested], [projectDir]);
    assert.strictEqual(withoutList?.path, shallowDecoy, '기존 동작: 얕은 경로 우선');

    const withList = pickSourceCandidate([shallowDecoy, listedNested], [projectDir], [listedNested]);
    assert.strictEqual(withList?.path, listedNested);
    assert.deepStrictEqual(withList?.ambiguous, [], '컴파일 집합으로 유일하게 좁혀졌으면 모호하지 않다');
});
