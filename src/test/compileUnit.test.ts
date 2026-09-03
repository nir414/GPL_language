import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from './harness';
import { CompileUnitIndex, narrowToCompileUnit } from '../project/compileUnit';
import { walkTree, isSkippedScanDir } from '../project/projectSources';

/**
 * 사용자 실제 구조(2026-09-02) — 워크스페이스를 **프로젝트 상위 폴더에서 여는** 배치.
 *
 *   develop/07. Others/37. 핵산 Oligo 합성과제/시뮬레이션/projects/GPL_Code/Project.gpr
 *                                                                        /Main.gpl
 *                                                                        /Lib_Core/Project.gpr
 *                                                                        /Lib_Core/Core.gpl
 *   develop/07. Others/38. 다른 합성과제/시뮬레이션/projects/GPL_Code/Project.gpr
 *                                                                  /Main.gpl
 *
 * 두 과제의 프로젝트가 **폴더명·ProjectName·소스 파일명까지 같다**(사내 템플릿을 복제해 쓰는 구조).
 * 공백·한글·`37.`처럼 점이 포함된 폴더명도 그대로 재현한다.
 */
const GPR_MAIN = [
    'ProjectBegin',
    'ProjectName="GPL_Code"',
    'ProjectStart="Main.MAIN"',
    'ProjectSource="Main.gpl"',
    'ProjectLibrary="GPL_Code\\Lib_Core"',
    'ProjectEnd',
].join('\r\n') + '\r\n';

const GPR_LIB = [
    'ProjectBegin',
    'ProjectName="Lib_Core"',
    'ProjectSource="Core.gpl"',
    'ProjectEnd',
].join('\r\n') + '\r\n';

const GPR_PLAIN = [
    'ProjectBegin',
    'ProjectName="GPL_Code"',
    'ProjectStart="Main.MAIN"',
    'ProjectSource="Main.gpl"',
    'ProjectEnd',
].join('\r\n') + '\r\n';

interface Fixture {
    root: string;
    /** 37번 과제(라이브러리 보유) */
    a: { dir: string; gpr: string; main: string; libDir: string; libGpr: string; core: string };
    /** 38번 과제(같은 이름의 별개 프로젝트) */
    b: { dir: string; gpr: string; main: string };
    gprPaths: string[];
}

function makeTwoTasks(): Fixture {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-compileunit-'));
    const write = (full: string, content: string): string => {
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content, 'utf8');
        return full;
    };
    const taskDir = (name: string): string =>
        path.join(root, 'develop', '07. Others', name, '시뮬레이션', 'projects', 'GPL_Code');

    const aDir = taskDir('37. 핵산 Oligo 합성과제');
    const bDir = taskDir('38. 다른 합성과제');
    const aLibDir = path.join(aDir, 'Lib_Core');

    const a = {
        dir: aDir,
        gpr: write(path.join(aDir, 'Project.gpr'), GPR_MAIN),
        main: write(path.join(aDir, 'Main.gpl'), "' a\r\n"),
        libDir: aLibDir,
        libGpr: write(path.join(aLibDir, 'Project.gpr'), GPR_LIB),
        core: write(path.join(aLibDir, 'Core.gpl'), "' core\r\n"),
    };
    const b = {
        dir: bDir,
        gpr: write(path.join(bDir, 'Project.gpr'), GPR_PLAIN),
        main: write(path.join(bDir, 'Main.gpl'), "' b\r\n"),
    };
    return { root, a, b, gprPaths: [a.gpr, a.libGpr, b.gpr] };
}

/**
 * 픽스처 정리. 인자는 항상 `mkdtemp`가 만든 **ASCII 경로**여야 한다 —
 * Node v24.11.1(Windows)의 `fs.rmSync`는 경로 인자에 비ASCII 문자가 있으면 프로세스를 죽인다
 * (하위 폴더 이름이 한글인 것은 괜찮다. 재귀 삭제 자체는 정상 동작한다).
 */
function cleanup(root: string): void {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* 정리 실패는 무시 */ }
}

const keys = (dirs: readonly string[]): string[] =>
    dirs.map(d => path.resolve(d).toLowerCase()).sort();

// ── CompileUnitIndex ───────────────────────────────────────────────────────

test('CompileUnitIndex: 한글·공백·점이 든 깊은 경로에서도 소유 .gpr를 찾는다', () => {
    const fx = makeTwoTasks();
    try {
        const index = new CompileUnitIndex();
        index.setGprPaths(fx.gprPaths);
        assert.strictEqual(index.owningGpr(fx.a.main)?.toLowerCase(), fx.a.gpr.toLowerCase());
        // 중첩 프로젝트의 파일은 상위가 아니라 **가장 가까운** .gpr에 귀속된다.
        assert.strictEqual(index.owningGpr(fx.a.core)?.toLowerCase(), fx.a.libGpr.toLowerCase());
        assert.strictEqual(index.owningGpr(fx.b.main)?.toLowerCase(), fx.b.gpr.toLowerCase());
    } finally {
        cleanup(fx.root);
    }
});

test('CompileUnitIndex: 컴파일 단위 = 자기 프로젝트 + ProjectLibrary 관계(양방향)', () => {
    const fx = makeTwoTasks();
    try {
        const index = new CompileUnitIndex();
        index.setGprPaths(fx.gprPaths);

        // 메인 → 라이브러리를 포함한다.
        assert.deepStrictEqual(keys(index.unitDirsFor(fx.a.main)), keys([fx.a.dir, fx.a.libDir]));
        // 라이브러리 → 자기를 참조하는 메인도 포함한다(라이브러리 Public 루틴의 호출부가 거기 있다).
        assert.deepStrictEqual(keys(index.unitDirsFor(fx.a.core)), keys([fx.a.libDir, fx.a.dir]));
        // 다른 과제는 폴더명·ProjectName이 같아도 별개 단위다.
        assert.deepStrictEqual(keys(index.unitDirsFor(fx.b.main)), keys([fx.b.dir]));
    } finally {
        cleanup(fx.root);
    }
});

test('CompileUnitIndex.isSameUnit: 다른 과제의 동명 프로젝트는 같은 단위가 아니다', () => {
    const fx = makeTwoTasks();
    try {
        const index = new CompileUnitIndex();
        index.setGprPaths(fx.gprPaths);

        assert.strictEqual(index.isSameUnit(fx.a.core, fx.a.main), true);
        assert.strictEqual(index.isSameUnit(fx.a.main, fx.a.core), true);
        assert.strictEqual(index.isSameUnit(fx.b.main, fx.a.main), false);
        assert.strictEqual(index.isSameUnit(fx.a.main, fx.b.main), false);
        assert.strictEqual(index.isSameUnit(fx.a.core, fx.b.main), false);
    } finally {
        cleanup(fx.root);
    }
});

test('CompileUnitIndex: .gpr 목록이 비어도 디스크에서 소유 프로젝트를 찾는다(워크스페이스 밖 파일)', () => {
    const fx = makeTwoTasks();
    try {
        const index = new CompileUnitIndex();
        index.setGprPaths([]);
        assert.strictEqual(index.owningGpr(fx.a.main)?.toLowerCase(), fx.a.gpr.toLowerCase());
        // 참조자(referrer) 탐색은 알려진 .gpr 목록이 있어야 하므로 여기선 자기 단위만 나온다.
        assert.deepStrictEqual(keys(index.unitDirsFor(fx.a.main)), keys([fx.a.dir, fx.a.libDir]));
    } finally {
        cleanup(fx.root);
    }
});

test('CompileUnitIndex: 소유 .gpr가 없으면 판정 불가 — isSameUnit은 true(배제하지 않는다)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-compileunit-none-'));
    try {
        // `findNearestGprOnDisk`는 16단계까지 거슬러 올라간다. 그 범위에 `.gpr`가 하나도 없어야
        // "판정 불가"가 재현되는데, 임시 폴더 상위에 남의 `Project.gpr`가 굴러다니는 머신이 있다
        // (2026-09-02 실측: `%TEMP%\Project.gpr`). 상한보다 깊이 묻어 환경 의존을 없앤다.
        const deep = path.join(root, ...Array.from({ length: 18 }, (_v, i) => `d${i}`));
        fs.mkdirSync(deep, { recursive: true });
        const loose = path.join(deep, 'Scratch.gpl');
        fs.writeFileSync(loose, "' x\r\n", 'utf8');

        const index = new CompileUnitIndex();
        index.setGprPaths([]);
        assert.deepStrictEqual(index.unitDirsFor(loose), []);
        assert.strictEqual(index.isSameUnit(path.join(deep, 'Other.gpl'), loose), true);
        // 완전히 무관한 경로도 배제하지 않는다 — 경계를 모를 때 지우면 정의를 통째로 놓친다.
        assert.strictEqual(index.isSameUnit(path.join(root, 'Far.gpl'), loose), true);
    } finally {
        cleanup(root);
    }
});

test('CompileUnitIndex.isInUnitDirs: 단위가 비면(판정 불가) 무조건 통과시킨다', () => {
    const index = new CompileUnitIndex();
    assert.strictEqual(index.isInUnitDirs(path.join('c:', 'anywhere', 'X.gpl'), []), true);
    // 라이브러리가 메인 프로젝트 폴더 **안에** 있는 배치(GPL_Code\Lib_Net) — 사용자 확정 구조.
    const unit = [path.join('c:', 'ws', 'projects', 'GPL_Code')];
    assert.strictEqual(index.isInUnitDirs(path.join('c:', 'ws', 'projects', 'GPL_Code', 'Lib_Net', 'N.gpl'), unit), true);
    assert.strictEqual(index.isInUnitDirs(path.join('c:', 'ws', 'projects', 'Other', 'N.gpl'), unit), false);
});

test('CompileUnitIndex.setGprPaths: 목록이 같으면 캐시를 유지하고, 바뀌면 버린다', () => {
    const fx = makeTwoTasks();
    try {
        const index = new CompileUnitIndex();
        index.setGprPaths(fx.gprPaths);
        assert.deepStrictEqual(keys(index.unitDirsFor(fx.a.main)), keys([fx.a.dir, fx.a.libDir]));

        // 같은 목록 재설정 → 캐시 유지. .gpr를 지워도 캐시된 답이 그대로 나온다(캐시가 살아 있다는 증거).
        index.setGprPaths([...fx.gprPaths]);
        // `fs.rmSync`가 아니라 `unlinkSync`인 이유: Node v24.11.1(Windows)에서 **경로에 비ASCII
        // 문자가 있으면 `fs.rmSync`가 프로세스를 즉시 죽인다**(0xC0000409 STATUS_STACK_BUFFER_OVERRUN,
        // 예외도 exit 이벤트도 없음 — 2026-09-02 실측). 이 픽스처 경로에는 한글이 들어 있다.
        // `unlinkSync`는 같은 경로에서 정상 동작한다.
        fs.unlinkSync(fx.a.libGpr);
        assert.deepStrictEqual(keys(index.unitDirsFor(fx.a.main)), keys([fx.a.dir, fx.a.libDir]));

        // 목록이 바뀌면 캐시를 버리고 다시 해석 → 사라진 라이브러리는 빠진다.
        index.setGprPaths([fx.a.gpr, fx.b.gpr]);
        assert.deepStrictEqual(keys(index.unitDirsFor(fx.a.main)), keys([fx.a.dir]));
    } finally {
        cleanup(fx.root);
    }
});

// ── narrowToCompileUnit ────────────────────────────────────────────────────

interface Cand { filePath: string; tag: string }
const pathOf = (c: Cand): string => c.filePath;

test('narrowToCompileUnit: 같은 단위 후보가 있으면 다른 과제의 동명 심볼을 버린다', () => {
    const fx = makeTwoTasks();
    try {
        const index = new CompileUnitIndex();
        index.setGprPaths(fx.gprPaths);

        const candidates: Cand[] = [
            { filePath: fx.b.main, tag: 'other-task' },
            { filePath: fx.a.core, tag: 'library' },
            { filePath: fx.a.main, tag: 'own' },
        ];
        const narrowed = narrowToCompileUnit(candidates, fx.a.main, pathOf, index);
        assert.deepStrictEqual(narrowed.map(c => c.tag), ['library', 'own']);
    } finally {
        cleanup(fx.root);
    }
});

test('narrowToCompileUnit: 단위 안 후보가 하나도 없으면 원본을 유지한다(정의 누락 방지)', () => {
    const fx = makeTwoTasks();
    try {
        const index = new CompileUnitIndex();
        index.setGprPaths(fx.gprPaths);

        const candidates: Cand[] = [{ filePath: fx.b.main, tag: 'other-task' }];
        const narrowed = narrowToCompileUnit(candidates, fx.a.main, pathOf, index);
        assert.deepStrictEqual(narrowed.map(c => c.tag), ['other-task']);
    } finally {
        cleanup(fx.root);
    }
});

test('narrowToCompileUnit: 기준 파일이 없거나 후보가 1개면 그대로 둔다', () => {
    const fx = makeTwoTasks();
    try {
        const index = new CompileUnitIndex();
        index.setGprPaths(fx.gprPaths);
        const candidates: Cand[] = [
            { filePath: fx.b.main, tag: 'other-task' },
            { filePath: fx.a.main, tag: 'own' },
        ];
        assert.strictEqual(narrowToCompileUnit(candidates, undefined, pathOf, index), candidates);
        const single: Cand[] = [{ filePath: fx.b.main, tag: 'other-task' }];
        assert.strictEqual(narrowToCompileUnit(single, fx.a.main, pathOf, index), single);
    } finally {
        cleanup(fx.root);
    }
});

// ── walkTree — 상한 있는 공용 재귀 순회 ────────────────────────────────────

test('isSkippedScanDir: dot 폴더(.svn/.git/.history)와 빌드 폴더를 제외한다', () => {
    for (const name of ['.svn', '.git', '.history', '.vscode', 'node_modules', 'bin', 'out', 'dist']) {
        assert.strictEqual(isSkippedScanDir(name), true, name);
    }
    for (const name of ['Lib_Core', 'projects', '시뮬레이션', '37. 핵산 Oligo 합성과제']) {
        assert.strictEqual(isSkippedScanDir(name), false, name);
    }
});

test('walkTree: 한글·공백 경로를 훑고 .svn/bin 아래는 건너뛴다', () => {
    const fx = makeTwoTasks();
    try {
        const skipped = path.join(fx.a.dir, '.svn', 'pristine');
        fs.mkdirSync(skipped, { recursive: true });
        fs.writeFileSync(path.join(skipped, 'Main.gpl'), "' stale\r\n", 'utf8');
        const binDir = path.join(fx.a.dir, 'bin');
        fs.mkdirSync(binDir, { recursive: true });
        fs.writeFileSync(path.join(binDir, 'Main.gpl'), "' build\r\n", 'utf8');

        const found: string[] = [];
        const r = walkTree(fx.root, (full, name) => {
            if (name.toLowerCase().endsWith('.gpl')) { found.push(full); }
        });
        assert.strictEqual(r.truncated, false);
        assert.deepStrictEqual(keys(found), keys([fx.a.main, fx.a.core, fx.b.main]));
    } finally {
        cleanup(fx.root);
    }
});

test('walkTree: 깊이 상한에 걸리면 truncated로 알린다(조용히 자르지 않는다)', () => {
    const fx = makeTwoTasks();
    try {
        const found: string[] = [];
        const r = walkTree(fx.root, (_full, name) => {
            if (name.toLowerCase().endsWith('.gpl')) { found.push(name); }
        }, { maxDepth: 3 });
        assert.strictEqual(r.truncated, true);
        assert.strictEqual(found.length, 0); // 소스는 훨씬 더 깊은 곳에 있다
    } finally {
        cleanup(fx.root);
    }
});

test('walkTree: 디렉터리 수 상한에 걸리면 truncated로 알린다', () => {
    const fx = makeTwoTasks();
    try {
        const r = walkTree(fx.root, () => { /* noop */ }, { maxDirs: 2 });
        assert.strictEqual(r.truncated, true);
        assert.strictEqual(r.dirs, 2);
    } finally {
        cleanup(fx.root);
    }
});
