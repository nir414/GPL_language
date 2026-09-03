/**
 * "프로젝트에 속한 소스 파일은 무엇인가" — 순수 로직 (vscode 의존 없음, 단위 테스트 대상).
 *
 * GPL 프로젝트의 소스는 프로젝트 폴더 **직속 파일만이 아니다**. 실제 파일 확인(2026-08-28, TEST_GPL):
 *
 *   ProjectBegin
 *   ProjectName="TEST_GPL"
 *   ProjectStart="Main"
 *   ProjectSource="Main.gpl"
 *   ProjectSource="T1\T1.gpl"
 *   ProjectSource="T1\T2\T2.gpl"      ← 임의 깊이로 중첩된다
 *   ProjectEnd
 *
 * `ProjectSource`는 .gpr 폴더 기준 **상대 경로**이고, GDE는 구분자로 `\`를 쓴다.
 *
 * 또 프로젝트 폴더 안에 **다른 프로젝트가 들어 있을 수 있다**(2026-08-31 실제 파일 확인, MyProject):
 *
 *   projects/MyProject/Project.gpr        ProjectLibrary="MyProject\MyLibrary"
 *   projects/MyProject/MyProject.gpl
 *   projects/MyProject/MyLibrary/Project.gpr   ← 중첩 프로젝트(라이브러리)
 *   projects/MyProject/MyLibrary/Project.gpl
 *
 * 그래서 이 모듈은 서로 다른 두 질문을 **구분해서** 답한다.
 *   - "이 프로젝트가 **소유한** 파일" — 중첩 `.gpr`에서 멈춘다(`listSourceFilesRecursive`,
 *     `collectProjectSourcePaths`). `.gpr` 소스 목록 동기화가 쓰는 답이다.
 *   - "이 프로젝트와 **함께 컴파일되는** 파일" — `ProjectLibrary`를 따라간다
 *     (`resolveProjectLibraryDirs`, `collectRelatedGprPaths`). 심볼·참조 검색이 쓰는 답이다.
 * 둘을 섞으면 라이브러리 소스가 상위 프로젝트의 `ProjectSource`로 등록되거나(이중 컴파일),
 * 반대로 라이브러리의 `Public` 루틴 참조를 놓친다.
 *
 * 이 규칙을 확장 여러 곳(참조 검색·심볼 인덱싱·.gpr 동기화·디버그 소스 매핑)이 각자 판단하면
 * 어떤 기능은 하위 폴더를 보고 어떤 기능은 못 보는 어긋남이 생긴다(실제로 그랬다 — 참조 검색의
 * 폴백은 "같은 폴더의 형제 파일"만 훑어 중첩 폴더의 참조를 통째로 놓쳤다). 판단 기준을 여기 한 곳에 둔다.
 *
 * .gpr 텍스트 파싱 자체는 `controller/gprSync.ts`(단일 출처)를 그대로 쓴다.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseGprText, sourceKey } from '../controller/gprSync';
import { isPathUnder, normalizeDirKey } from '../controller/projectPickerCore';

/** 소스로 볼 기본 확장자(소문자, 점 포함). */
export const DEFAULT_SOURCE_EXTENSIONS: readonly string[] = ['.gpl'];

/** GDE가 .gpr에 기록하는 경로 구분자(관측 형식). */
export const GPR_PATH_SEPARATOR = '\\';

/**
 * 소스 탐색에서 제외할 디렉터리 이름(dot 항목은 별도로 항상 제외).
 * 디버그 소스맵 스캔(`gplDebugSession._isSkippedScanDir`)·배포 스냅샷과 같은 규칙 —
 * 특히 `.history`(Local History 확장)의 stale 사본이 소스 집합을 오염시킨다.
 */
export const DEFAULT_EXCLUDED_DIR_NAMES: ReadonlySet<string> = new Set([
    'node_modules', 'bin', 'out', 'dist',
]);

/**
 * 재귀 스캔에서 건너뛸 디렉터리인가 — dot 항목(`.git`/`.svn`/`.history`/`.vscode`)과 빌드/출력 폴더.
 * 확장 전체가 이 한 규칙을 쓴다(디버그 소스맵·트리 명령·소스 목록).
 */
export function isSkippedScanDir(name: string, excludeDirs: ReadonlySet<string> = DEFAULT_EXCLUDED_DIR_NAMES): boolean {
    return name.startsWith('.') || excludeDirs.has(name.toLowerCase());
}

export interface WalkTreeOptions {
    /** 루트 기준 최대 깊이(루트 직속=1). 기본 24. */
    maxDepth?: number;
    /** 방문할 최대 디렉터리 수. 기본 20000. */
    maxDirs?: number;
    /** 제외할 디렉터리 이름. 기본 `DEFAULT_EXCLUDED_DIR_NAMES`. */
    excludeDirs?: ReadonlySet<string>;
}

export interface WalkTreeResult {
    /** 방문한 디렉터리 수. */
    dirs: number;
    /** 깊이/개수 상한에 걸려 일부를 못 봤는가 — 호출측이 **반드시 알려야** 한다(조용한 절단 금지). */
    truncated: boolean;
}

/**
 * 워크스페이스 트리를 재귀 순회하며 파일마다 `onFile`을 부른다.
 *
 * 종전에는 디버그 소스맵(`_scanDir`)과 트리 명령(`findWorkspaceFilesByName`)이 **상한 없는**
 * 동기 재귀를 각자 갖고 있었다. 워크스페이스를 프로젝트가 아니라 저장소 상위 폴더에서 여는 구조
 * (`C:\SVN\pa	runk\develop\…`)에서는 수만 개 폴더를 확장 호스트 스레드에서 훑어 UI가 멈춘다.
 * 상한은 정상 사용에서는 걸리지 않을 만큼 넉넉하게 두고, 걸리면 `truncated`로 알린다.
 *
 * 심볼릭 링크 디렉터리는 순환 방지를 위해 건너뛴다(`listSourceFilesRecursive`와 같은 규칙).
 */
export function walkTree(
    root: string,
    onFile: (fullPath: string, name: string) => void,
    opts: WalkTreeOptions = {},
): WalkTreeResult {
    const maxDepth = opts.maxDepth ?? 24;
    const maxDirs = opts.maxDirs ?? 20000;
    const excludeDirs = opts.excludeDirs ?? DEFAULT_EXCLUDED_DIR_NAMES;
    let dirs = 0;
    let truncated = false;

    const stack: Array<{ dir: string; depth: number }> = [{ dir: path.resolve(root), depth: 1 }];
    while (stack.length > 0) {
        const { dir, depth } = stack.pop()!;
        if (dirs >= maxDirs) { truncated = true; break; }
        dirs++;
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            continue; // 권한 없음 등 — 그 하위만 건너뛴다
        }
        for (const entry of entries) {
            if (entry.isSymbolicLink()) { continue; }
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (isSkippedScanDir(entry.name, excludeDirs)) { continue; }
                if (depth >= maxDepth) { truncated = true; continue; }
                stack.push({ dir: full, depth: depth + 1 });
            } else if (entry.isFile()) {
                onFile(full, entry.name);
            }
        }
    }
    return { dirs, truncated };
}

function normalizeExtensions(extensions?: readonly string[]): Set<string> {
    const list = (extensions && extensions.length > 0 ? extensions : DEFAULT_SOURCE_EXTENSIONS);
    return new Set(list.map(e => (e.startsWith('.') ? e : `.${e}`).toLowerCase()));
}

function hasExtension(name: string, exts: ReadonlySet<string>): boolean {
    const dot = name.lastIndexOf('.');
    return dot >= 0 && exts.has(name.slice(dot).toLowerCase());
}

export interface ListSourceFilesOptions {
    /** 소스로 볼 확장자. 기본 `.gpl`. */
    extensions?: readonly string[];
    /** 반환 경로의 구분자. 기본 `\`(GDE .gpr 관측 형식). */
    separator?: '\\' | '/';
    /** 안전 상한 — 넘으면 `truncated=true`로 알린다(조용히 자르지 않는다). 기본 5000. */
    maxFiles?: number;
    /** 하위 폴더 최대 깊이(프로젝트 폴더 직속=1). 기본 16. */
    maxDepth?: number;
    /** 제외할 디렉터리 이름. 기본 `DEFAULT_EXCLUDED_DIR_NAMES`. */
    excludeDirs?: ReadonlySet<string>;
    /**
     * 하위 폴더에 자기 `.gpr`가 있으면 **다른 프로젝트로 보고 내려가지 않는다**. 기본 `true`.
     *
     * 중첩 프로젝트(`projects/MyProject/MyLibrary/Project.gpr`, 2026-08-31 실측)에서 이 경계가 없으면
     * 라이브러리 소스가 상위 프로젝트의 폴더 목록에 섞여 `.gpr` 동기화가 그 파일들을 상위 프로젝트의
     * `ProjectSource`로 추가하려 든다 — 라이브러리는 이미 컴파일에 논리적으로 포함되므로 이중 등록이 된다.
     * "이 프로젝트가 직접 소유한 파일"과 "함께 컴파일되는 파일"은 다른 질문이고, 후자는
     * `collectRelatedGprPaths`로 라이브러리를 명시적으로 합쳐서 답한다.
     */
    stopAtNestedProject?: boolean;
}

export interface ListedSourceFiles {
    /** 프로젝트 폴더 기준 상대 경로(하위 폴더 포함). 대소문자 무시 정렬로 결정적. */
    files: string[];
    /** `maxFiles`/`maxDepth`에 걸려 일부를 빼놓았는가 */
    truncated: boolean;
    /** 경계에서 멈춘 중첩 프로젝트 폴더(절대 경로). 호출측이 "왜 이 파일이 빠졌는지" 알릴 수 있게. */
    nestedProjects: string[];
}

/** 폴더 직속에 `.gpr` 파일이 있는가 — "여기부터 다른 프로젝트"의 판정 기준. */
function hasGprFile(entries: readonly fs.Dirent[]): boolean {
    return entries.some(e => !e.isDirectory() && e.name.toLowerCase().endsWith('.gpr'));
}

/**
 * 프로젝트 폴더 아래 소스 파일을 **재귀** 수집해 폴더 기준 상대 경로로 돌려준다.
 *
 * - dot 항목(`.git`/`.history`/`.vscode`)과 `DEFAULT_EXCLUDED_DIR_NAMES`는 제외.
 * - 자기 `.gpr`를 가진 하위 폴더는 별개 프로젝트로 보고 내려가지 않는다(`stopAtNestedProject`, 기본 켬).
 * - 심볼릭 링크는 순환 방지를 위해 건너뛴다.
 * - 폴더를 읽을 수 없으면(권한 등) 그 하위만 건너뛰고 나머지는 그대로 수집한다.
 */
export function listSourceFilesRecursive(dir: string, opts: ListSourceFilesOptions = {}): ListedSourceFiles {
    const exts = normalizeExtensions(opts.extensions);
    const excludeDirs = opts.excludeDirs ?? DEFAULT_EXCLUDED_DIR_NAMES;
    const maxFiles = opts.maxFiles ?? 5000;
    const maxDepth = opts.maxDepth ?? 16;
    const separator = opts.separator ?? GPR_PATH_SEPARATOR;
    const stopAtNested = opts.stopAtNestedProject ?? true;
    const root = path.resolve(dir);

    // 내부적으로는 '/' 상대 경로로 모아 정렬한 뒤 마지막에 구분자를 적용한다(정렬 결과가 OS·옵션과 무관).
    const rels: string[] = [];
    const nestedProjects: string[] = [];
    let truncated = false;

    const walk = (current: string, depth: number): void => {
        if (truncated) { return; }
        if (depth > maxDepth) { truncated = true; return; }
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            return;
        }
        // 루트(depth=1)는 이 프로젝트 자신이므로 경계 판정에서 제외한다.
        if (stopAtNested && depth > 1 && hasGprFile(entries)) {
            nestedProjects.push(current);
            return;
        }
        const dirs: string[] = [];
        for (const entry of entries) {
            if (entry.name.startsWith('.')) { continue; }
            if (entry.isSymbolicLink()) { continue; }
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                if (excludeDirs.has(entry.name.toLowerCase())) { continue; }
                dirs.push(full);
                continue;
            }
            if (!entry.isFile() || !hasExtension(entry.name, exts)) { continue; }
            if (rels.length >= maxFiles) { truncated = true; return; }
            rels.push(path.relative(root, full).replace(/\\/g, '/'));
        }
        for (const sub of dirs) {
            walk(sub, depth + 1);
            if (truncated) { return; }
        }
    };
    walk(root, 1);

    rels.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()) || a.localeCompare(b));
    const files = separator === '/' ? rels : rels.map(r => r.replace(/\//g, separator));
    nestedProjects.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    return { files, truncated, nestedProjects };
}

/**
 * `.gpr`의 `ProjectSource` 항목을 절대 경로로 해석한다(하위 폴더·`/`·`\`·절대 경로 모두 허용).
 * 존재하지 않는 파일도 그대로 돌려준다 — "목록에 있다"와 "디스크에 있다"는 호출측이 구분해야 한다.
 */
export function resolveGprSourcePaths(
    gprPath: string,
    gprText: string,
    opts?: { extensions?: readonly string[] },
): string[] {
    const baseDir = path.dirname(path.resolve(gprPath));
    const exts = opts?.extensions ? normalizeExtensions(opts.extensions) : undefined;
    const out: string[] = [];
    const seen = new Set<string>();

    for (const entry of parseGprText(gprText).sources) {
        const raw = entry.path.trim();
        if (!raw) { continue; }
        const native = raw.replace(/[\\/]+/g, path.sep);
        const full = path.isAbsolute(native) ? path.resolve(native) : path.resolve(baseDir, native);
        if (exts && !hasExtension(full, exts)) { continue; }
        const key = full.toLowerCase();
        if (seen.has(key)) { continue; }
        seen.add(key);
        out.push(full);
    }
    return out;
}

/**
 * 이 파일이 속한 프로젝트의 `.gpr` 경로 — 파일을 포함하는 가장 **깊은**(가장 가까운) `.gpr` 폴더.
 * 중첩 프로젝트(프로젝트 폴더 안에 또 다른 .gpr 폴더)에서도 가장 가까운 것을 고른다.
 * 같은 폴더에 여러 .gpr가 있으면 `Project.gpr`를 우선하고, 그 외에는 경로 사전순(결정적)이다.
 */
export function pickOwningGprPath(filePath: string, gprPaths: readonly string[]): string | undefined {
    const owning = gprPaths.filter(g => isPathUnder(filePath, path.dirname(g)));
    if (owning.length === 0) { return undefined; }
    return owning.sort((a, b) => {
        const depth = normalizeDirKey(path.dirname(b)).length - normalizeDirKey(path.dirname(a)).length;
        if (depth !== 0) { return depth; }
        const aPreferred = path.basename(a).toLowerCase() === 'project.gpr' ? 0 : 1;
        const bPreferred = path.basename(b).toLowerCase() === 'project.gpr' ? 0 : 1;
        return aPreferred - bPreferred || a.localeCompare(b);
    })[0];
}

/**
 * 파일에서 위로 올라가며 가장 가까운 `.gpr`를 디스크에서 찾는다 —
 * 워크스페이스 밖에서 열린 파일(참조 검색은 이 경우도 지원한다)의 프로젝트를 알아내는 경로.
 * `Project.gpr`를 우선하고, 없으면 그 폴더의 첫 `.gpr`(이름순)를 쓴다.
 */
export function findNearestGprOnDisk(startPath: string, opts?: { maxLevels?: number }): string | undefined {
    const maxLevels = opts?.maxLevels ?? 16;
    let dir = path.resolve(startPath);
    try {
        if (fs.statSync(dir).isFile()) { dir = path.dirname(dir); }
    } catch {
        dir = path.dirname(dir);
    }

    for (let level = 0; level < maxLevels; level++) {
        const hit = gprPathInDir(dir);
        if (hit) { return hit; }
        const parent = path.dirname(dir);
        if (parent === dir) { break; }
        dir = parent;
    }
    return undefined;
}

/**
 * 폴더 직속의 `.gpr` 경로 — `Project.gpr`를 우선하고, 없으면 이름순 첫 `.gpr`(결정적).
 * `.gpr`가 없으면 undefined → "이 폴더는 프로젝트가 아니다"의 판정에도 쓴다.
 */
export function gprPathInDir(dir: string): string | undefined {
    let names: string[];
    try {
        names = fs.readdirSync(dir).filter(n => n.toLowerCase().endsWith('.gpr'));
    } catch {
        return undefined;
    }
    if (names.length === 0) { return undefined; }
    names.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    const preferred = names.find(n => n.toLowerCase() === 'project.gpr') ?? names[0];
    return path.join(path.resolve(dir), preferred);
}

/**
 * **한 프로젝트가 직접 소유한** 파일 집합 — `.gpr` 목록 ∪ 폴더 재귀 스캔.
 *
 * 합집합인 이유: `.gpr`에 아직 추가하지 않은 파일(방금 만든 파일)도 사용자는 검색 결과에 기대하고,
 * 반대로 `.gpr`에만 있고 폴더 스캔 제외 규칙에 걸린 파일도 빠뜨리지 않아야 한다(누락 방지 우선).
 *
 * 중첩 프로젝트(하위 폴더의 별도 `.gpr`)는 폴더 스캔에서 **제외**된다. 라이브러리까지 포함한
 * "함께 컴파일되는 집합"이 필요하면 `collectRelatedGprPaths`로 관련 `.gpr`를 모아 이 함수를 각각 부른다.
 */
export function collectProjectSourcePaths(
    gprPath: string,
    gprText: string,
    opts: ListSourceFilesOptions = {},
): { files: string[]; truncated: boolean } {
    const projectDir = path.dirname(path.resolve(gprPath));
    const exts = normalizeExtensions(opts.extensions);
    const listed = listSourceFilesRecursive(projectDir, { ...opts, separator: '/' });

    const out: string[] = [];
    const seen = new Set<string>();
    const push = (full: string): void => {
        const key = full.toLowerCase();
        if (seen.has(key)) { return; }
        seen.add(key);
        out.push(full);
    };

    for (const rel of listed.files) {
        push(path.resolve(projectDir, rel.replace(/\//g, path.sep)));
    }
    for (const full of resolveGprSourcePaths(gprPath, gprText)) {
        if (!hasExtension(full, exts)) { continue; }
        push(full);
    }
    return { files: out, truncated: listed.truncated };
}

/**
 * `.gpr` 목록의 항목과 디스크 상대 경로가 같은 파일을 가리키는지 — 구분자·대소문자 차이를 무시한다.
 * (`sourceKey`와 같은 규칙을 쓴다 — .gpr 동기화의 비교 기준과 어긋나지 않게.)
 */
export function isSameSourcePath(a: string, b: string): boolean {
    return sourceKey(a) === sourceKey(b);
}

// ─── ProjectLibrary — 라이브러리 프로젝트 참조 ────────────────────────────────

/**
 * `ProjectLibrary="…"` 값이 가리키는 폴더 후보를 **기준점 순서대로** 만든다.
 *
 * 값의 기준점이 무엇인지는 공식 문서에 없다. 실측된 것은 하나뿐이다 —
 * `projects/MyProject/Project.gpr`의 `ProjectLibrary="MyProject\MyLibrary"`가
 * `projects/MyProject/MyLibrary/`를 가리켰다(2026-08-31). 즉 **projects 루트(프로젝트 폴더의 부모) 기준**이다.
 * 다만 표본이 하나라 단정하지 않고, 프로젝트 폴더 기준 표기(`ProjectLibrary="MyLibrary"`)도 함께 시도한다.
 * 실제로 `.gpr`를 가진 폴더가 나오는 첫 후보를 채택하므로, 두 표기 중 무엇이든 맞으면 해석된다.
 *
 * 기준점은 중첩 참조를 따라 내려갈 때 **누적된다**(`resolveProjectLibraryDirs`) — 값이 projects 루트
 * 기준이라면 라이브러리 안의 `ProjectLibrary`도 같은 루트를 기준으로 읽어야 하기 때문이다.
 */
function libraryDirCandidates(bases: readonly string[], raw: string): string[] {
    const native = raw.replace(/[\\/]+/g, path.sep).replace(/[\\/]+$/, '').trim();
    if (!native) { return []; }
    if (path.isAbsolute(native)) { return [path.resolve(native)]; }
    const out: string[] = [];
    const seen = new Set<string>();
    for (const base of bases) {
        const full = path.resolve(base, native);
        const key = normalizeDirKey(full);
        if (seen.has(key)) { continue; }
        seen.add(key);
        out.push(full);
    }
    return out;
}

/** 기준점 목록에 새 폴더를 앞에서부터 중복 없이 이어 붙인다(우선순위 유지). */
function extendBases(bases: readonly string[], ...add: string[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const dir of [...add, ...bases]) {
        const key = normalizeDirKey(dir);
        if (seen.has(key)) { continue; }
        seen.add(key);
        out.push(dir);
    }
    return out;
}

/**
 * 디스크 후보가 모두 빗나갔을 때의 폴백 — 이미 알고 있는 `.gpr` 중 폴더 경로 **끝이 일치**하는 것.
 * (`"MyProject\MyLibrary"` → `…/projects/MyProject/MyLibrary/Project.gpr`, `"Lib_Apps"` → `…/projects/Lib_Apps/…`)
 * 여러 개면 가장 얕은(위쪽) 것을 고른다 — 사본 폴더보다 원본을 잡을 가능성이 높다.
 */
function matchKnownGprByPath(raw: string, knownGprPaths: readonly string[]): string | undefined {
    const wanted = raw.replace(/[\\/]+/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase().trim();
    if (!wanted) { return undefined; }
    const hits = knownGprPaths
        .map(g => ({ gpr: path.resolve(g), dir: path.dirname(path.resolve(g)).replace(/\\/g, '/').toLowerCase() }))
        .filter(x => x.dir === wanted || x.dir.endsWith(`/${wanted}`))
        .sort((a, b) => a.dir.length - b.dir.length || a.gpr.localeCompare(b.gpr));
    return hits[0]?.gpr;
}

function defaultReadGprText(filePath: string): string {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch {
        return '';
    }
}

export interface ResolveLibraryOptions {
    /** 워크스페이스에서 수집한 `.gpr` 경로 — 디스크 후보가 빗나갔을 때의 폴백 검색 대상. */
    knownGprPaths?: readonly string[];
    /** 라이브러리가 다른 라이브러리를 참조하는 깊이 상한(문서상 가능). 기본 8. */
    maxDepth?: number;
    /** 테스트 주입용 `.gpr` 읽기. 기본은 `fs.readFileSync(utf8)`, 실패는 빈 문자열. */
    readText?: (filePath: string) => string;
}

export interface ResolvedLibraries {
    /** 해석된 라이브러리 프로젝트 폴더(절대 경로, 중복 없음, 자기 자신 제외). 참조 순서를 유지한다. */
    dirs: string[];
    /** 어느 후보로도 폴더를 찾지 못한 `ProjectLibrary` 값(원문) — 호출측이 경고로 알린다. */
    unresolved: string[];
}

/** `ProjectLibrary` 한 줄 — 원문 값과 해석된 폴더(해석 실패면 `dir` 없음). */
export interface LibraryRef {
    /** 부모 `.gpr`에 적힌 값 그대로 */
    raw: string;
    /** 해석된 라이브러리 프로젝트 폴더(절대 경로) */
    dir?: string;
}

/** 컴파일 단위 그래프의 노드 하나 = `.gpr` 하나. */
export interface LibraryGraphNode {
    /** 프로젝트 폴더(절대 경로) */
    dir: string;
    /** 이 프로젝트의 `.gpr` 경로(절대) */
    gprPath: string;
    /** `.gpr`의 `ProjectName`(없으면 폴더명) */
    projectName: string;
    /** 이 프로젝트가 **직접 선언한** `ProjectSource`의 절대 경로(선언 순서) */
    sources: string[];
    /** 이 프로젝트의 `ProjectLibrary` 참조(선언 순서, 중복 제거 없음) */
    refs: LibraryRef[];
}

/**
 * 컴파일 단위의 **참조 그래프**. `dirs`는 종전 `resolveProjectLibraryDirs`와 같은 값이고,
 * `nodes`가 추가 정보다 — 어느 참조가 어느 파일을 끌어오는지 알아야 하는 기능
 * (BP용 소스 승격 계획 — `project/sourcePromotion.ts`)이 쓴다.
 *
 * 간선은 노드마다 자기 `refs`로 갖고 있으므로, 중복/순환으로 재방문하지 않은 참조도
 * 그래프에서는 빠지지 않는다(경로 탐색이 가능하다).
 */
export interface LibraryGraph {
    /** 루트(= 인자로 준 `.gpr`)의 폴더 */
    rootDir: string;
    /** `normalizeDirKey(dir)` → 노드. 루트를 포함한다. */
    nodes: Map<string, LibraryGraphNode>;
    /** 참조 순서대로의 라이브러리 폴더(루트 제외, 중복 없음) */
    dirs: string[];
    /** 어느 후보로도 폴더를 찾지 못한 `ProjectLibrary` 값(원문) */
    unresolved: string[];
}

/**
 * `.gpr`가 참조하는 라이브러리 프로젝트를 **재귀로** 해석해 참조 그래프를 만든다.
 *
 * 문서상 참조된 라이브러리의 모든 파일은 메인 프로젝트에 **논리적으로 포함되어 함께 컴파일**된다.
 * 그래서 "이 프로젝트와 함께 컴파일되는 파일 집합"을 묻는 기능(심볼·참조 검색·소스 매핑)은
 * 자기 폴더만으로는 답이 틀린다. 순환 참조는 방문 집합으로 끊는다(간선은 노드에 남는다).
 */
export function buildLibraryGraph(
    gprPath: string,
    gprText: string,
    opts: ResolveLibraryOptions = {},
): LibraryGraph {
    const readText = opts.readText ?? defaultReadGprText;
    const maxDepth = opts.maxDepth ?? 8;
    const known = opts.knownGprPaths ?? [];
    const rootGpr = path.resolve(gprPath);
    const rootDir = path.dirname(rootGpr);
    const dirs: string[] = [];
    const unresolved: string[] = [];
    const nodes = new Map<string, LibraryGraphNode>();
    const visited = new Set<string>([normalizeDirKey(rootDir)]);

    const visit = (fromGpr: string, text: string, depth: number, inherited: readonly string[]): void => {
        const projectDir = path.dirname(path.resolve(fromGpr));
        const parsed = parseGprText(text);
        const node: LibraryGraphNode = {
            dir: projectDir,
            gprPath: path.resolve(fromGpr),
            projectName: parsed.projectName?.trim() || path.basename(projectDir),
            sources: resolveGprSourcePaths(fromGpr, text),
            refs: [],
        };
        nodes.set(normalizeDirKey(projectDir), node);
        if (depth > maxDepth) { return; }

        // 자기 폴더 → 자기 부모(projects 루트) → 조상에서 물려받은 기준점 순.
        const bases = extendBases(inherited, projectDir, path.dirname(projectDir));

        for (const entry of parsed.libraries) {
            const raw = entry.path.trim();
            if (!raw) { continue; }

            let libGpr: string | undefined;
            for (const candidate of libraryDirCandidates(bases, raw)) {
                libGpr = gprPathInDir(candidate);
                if (libGpr) { break; }
            }
            libGpr = libGpr ?? matchKnownGprByPath(raw, known);
            if (!libGpr) {
                node.refs.push({ raw });
                if (!unresolved.includes(raw)) { unresolved.push(raw); }
                continue;
            }

            const libDir = path.dirname(libGpr);
            node.refs.push({ raw, dir: libDir });
            const key = normalizeDirKey(libDir);
            if (visited.has(key)) { continue; } // 순환 참조·중복 참조 — 간선은 위에 남겼다
            visited.add(key);
            dirs.push(libDir);
            visit(libGpr, readText(libGpr), depth + 1, bases);
        }
    };
    visit(rootGpr, gprText, 1, []);
    return { rootDir, nodes, dirs, unresolved };
}

/**
 * `.gpr`가 참조하는 라이브러리 프로젝트 폴더 목록 — `buildLibraryGraph`의 얇은 래퍼.
 * 참조 관계까지 필요하면 그래프 쪽을 쓴다.
 */
export function resolveProjectLibraryDirs(
    gprPath: string,
    gprText: string,
    opts: ResolveLibraryOptions = {},
): ResolvedLibraries {
    const { dirs, unresolved } = buildLibraryGraph(gprPath, gprText, opts);
    return { dirs, unresolved };
}

export interface RelatedGprOptions extends ResolveLibraryOptions {
    /**
     * 이 프로젝트를 **라이브러리로 참조하는** 프로젝트도 포함할지. 기본 `true`.
     *
     * 라이브러리 안에서 `Public` 루틴의 참조를 찾거나 이름을 바꿀 때, 호출부는 라이브러리가 아니라
     * 그것을 참조하는 메인 프로젝트에 있다. 이 역방향이 없으면 참조 검색이 호출부를 통째로 놓친다.
     */
    includeReferrers?: boolean;
}

/**
 * 이 `.gpr`와 **함께 다뤄야 할 프로젝트들**의 `.gpr` 경로 — 자기 자신 → 참조하는 라이브러리(재귀)
 * → 자기를 라이브러리로 참조하는 프로젝트 순서.
 *
 * 참조 검색·이름 바꾸기의 파일 범위는 이 목록의 합집합이어야 중첩/형제 라이브러리 구조에서 맞는다.
 */
export function collectRelatedGprPaths(
    gprPath: string,
    gprText: string,
    opts: RelatedGprOptions = {},
): string[] {
    const readText = opts.readText ?? defaultReadGprText;
    const known = opts.knownGprPaths ?? [];
    const selfGpr = path.resolve(gprPath);
    const selfDirKey = normalizeDirKey(path.dirname(selfGpr));

    const out: string[] = [selfGpr];
    const seen = new Set<string>([selfGpr.toLowerCase()]);
    const push = (g: string): void => {
        const abs = path.resolve(g);
        const key = abs.toLowerCase();
        if (seen.has(key)) { return; }
        seen.add(key);
        out.push(abs);
    };

    for (const dir of resolveProjectLibraryDirs(selfGpr, gprText, opts).dirs) {
        const g = gprPathInDir(dir);
        if (g) { push(g); }
    }

    if (opts.includeReferrers ?? true) {
        for (const candidate of known) {
            const abs = path.resolve(candidate);
            if (seen.has(abs.toLowerCase())) { continue; }
            const text = readText(abs);
            // 라이브러리 줄이 없는 .gpr는 어차피 참조자가 아니다 — 해석 비용을 아낀다.
            if (!text || !/ProjectLibrary/i.test(text)) { continue; }
            const refs = resolveProjectLibraryDirs(abs, text, opts).dirs;
            if (refs.some(d => normalizeDirKey(d) === selfDirKey)) { push(abs); }
        }
    }
    return out;
}
