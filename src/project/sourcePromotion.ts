/**
 * "이 라이브러리 소스에 브레이크포인트를 걸 수 있게 만들려면 메인 `.gpr`을 어떻게 고쳐야 하는가"
 * — 순수 로직(vscode·fs 쓰기 의존 없음, 단위 테스트 대상).
 *
 * 배경(실측 2026-08-31 / 2026-09-02, 시뮬레이터 192.168.0.1):
 * 제어기의 `Set Break <project> "<file>" <line>` 은 파일을 **그 프로젝트가 직접 선언한
 * `ProjectSource`** 안에서만 찾는다. `ProjectLibrary` 로 접혀 들어온 소스는 실행되고
 * `Show Stack` 에도 `GPL_Code\Lib_Core\LogFile/LogFile.gpl` 처럼 나오지만, 어떤 표기를 써도
 * `-508 *File not found*` 다. 반대로 같은 파일을 메인 `.gpr` 에
 * `ProjectSource="Lib_Core\LogFile\LogFile.gpl"` 로 직접 등재하면 BP 가 걸리고 실제로 히트한다
 * (2026-09-02 확인: `Show Stack` 프레임 0 이 그 줄에서 정지).
 *
 * 문제는 그 편집이 손으로 하기 까다롭다는 것이다. 라이브러리를 그냥 `ProjectSource` 로 **추가**하면
 * 그 파일이 라이브러리 경유로도 여전히 컴파일되어 **모듈 중복 정의**가 된다. 실제 구조
 * (`projects/GPL_Code`, 라이브러리 17개·`.gpr` 18개의 중첩 DAG)에서는 대상 파일을 끌어오는
 * 그룹 참조(`ProjectLibrary="GPL_Code\Lib_Core"`)를 빼고, 그 그룹이 제공하던 **나머지** 하위
 * 라이브러리를 개별로 다시 적어야 한다.
 *
 * 이 모듈은 그 최소 편집을 그래프에서 계산한다.
 *
 *   1. 대상 파일을 `ProjectSource` 로 선언한 라이브러리 노드 `L` 을 찾는다.
 *   2. 루트(메인)에서 `L` 로 가는 경로의 **첫 홉**을 메인의 `ProjectLibrary` 에서 제거한다
 *      (다른 프로젝트의 `.gpr` 은 공유 자산이므로 건드리지 않는다 — 메인만 편집한다).
 *   3. 그 제거로 도달 불가가 된 노드 중 **`L` 에 도달하는** 노드는 소스를 메인으로 승격하고,
 *      `L` 에 도달하지 않는 노드는 라이브러리 참조로 다시 적어 컴파일 집합을 보존한다.
 *   4. 편집 결과 텍스트로 그래프를 **다시 풀어** 컴파일 집합이 보존됐는지 검증한다
 *      (사라진 파일 / 중복 컴파일되는 파일). 검증이 실패하면 계획을 적용 대상으로 내놓지 않는다.
 *
 * 편집은 `controller/gprSync.applyGprSync` 를 그대로 쓴다 — 줄바꿈·파일 끝 개행·주석 등
 * "다른 줄은 보존" 규칙의 단일 출처다.
 *
 * 단위 테스트: src/test/sourcePromotion.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { applyGprSync, parseGprText, sourceKey } from '../controller/gprSync';
import { normalizeDirKey } from '../controller/projectPickerCore';
import {
    LibraryGraph,
    LibraryGraphNode,
    ResolveLibraryOptions,
    buildLibraryGraph,
} from './projectSources';

/** 파일 경로 비교 키 — 구분자·대소문자 차이를 무시한다(`sourceKey` 와 같은 규칙). */
function fileKey(p: string): string {
    return sourceKey(path.resolve(p));
}

/** `.gpr` 에 적을 경로 표기 — GDE 관측 형식(역슬래시). */
function gprStyle(rel: string): string {
    return rel.replace(/[\\/]+/g, '\\');
}

/** 기본 `.gpr` 읽기 — 실패는 빈 문자열(projectSources 와 같은 규칙). */
function defaultReadGprText(filePath: string): string {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch {
        return '';
    }
}

export type PromotionStatus =
    /** 이미 메인 프로젝트의 `ProjectSource` — 편집할 것이 없다(BP 가 걸려야 정상). */
    | 'already-source'
    /** 이 컴파일 단위의 어떤 `.gpr` 에도 `ProjectSource` 로 선언돼 있지 않다 — 애초에 컴파일되지 않는 파일. */
    | 'not-compiled'
    /** 승격해야 할 파일이 메인 프로젝트 폴더 밖에 있어 `ProjectSource` 상대 경로로 적을 수 없다. */
    | 'outside-main-dir'
    /** 계획을 세웠으나 컴파일 집합 보존 검증에 실패했다 — 적용하면 안 된다. */
    | 'unsafe'
    /** 적용 가능한 계획. */
    | 'ready';

export interface PromotionVerification {
    ok: boolean;
    /** 편집 후 컴파일 집합에서 사라지는 파일(메인 폴더 기준 상대 경로 또는 절대 경로) */
    lost: string[];
    /** 편집 후 두 번 컴파일되는 파일(메인 `ProjectSource` + 도달 가능한 라이브러리 양쪽) */
    duplicated: string[];
    /** 편집 후에도 해석되지 않는 `ProjectLibrary` 값 */
    unresolved: string[];
}

export interface PromotionPlan {
    status: PromotionStatus;
    /** 사람이 읽을 사유 — 상태가 `ready` 가 아닐 때 왜인지. */
    reason?: string;
    /** 메인 폴더 기준 상대 경로(역슬래시) — `Set Break` 의 파일 표기와 같은 값 */
    targetRel?: string;
    /** 대상 파일을 `ProjectSource` 로 선언한 라이브러리 프로젝트 폴더 */
    owningLibraryDir?: string;
    /** 그 라이브러리의 `ProjectName` */
    owningLibraryName?: string;
    /** 메인에서 지울 `ProjectLibrary` 값(원문) */
    removeLibraries: string[];
    /** 메인에 새로 넣을 `ProjectLibrary` 값 */
    addLibraries: string[];
    /** 메인에 새로 넣을 `ProjectSource` 값(메인 폴더 기준 상대 경로) */
    addSources: string[];
    /** 적용 결과 `.gpr` 텍스트 — `status`가 `ready`/`unsafe` 일 때만 있다 */
    newText?: string;
    verification: PromotionVerification;
    /** 적용해도 되지만 알아야 할 것(그룹 참조가 개별 참조로 풀렸다 등) */
    warnings: string[];
}

export interface PlanPromotionOptions extends ResolveLibraryOptions {
    /** 메인 프로젝트 `.gpr` 경로(절대) */
    mainGprPath: string;
    /** 메인 `.gpr` 본문 */
    mainGprText: string;
    /** BP 를 걸려는 소스 파일(절대 경로) */
    targetFile: string;
    /**
     * 되돌리기용으로 원래 `ProjectLibrary` 줄을 주석으로 남길지. 기본 `true`.
     * (사용자가 손으로 할 때 쓰던 관례와 같다 — 실제 파일에서 관측.)
     */
    keepOriginalAsComment?: boolean;
}

/** 이 소스를 컴파일하는 프로젝트 후보 하나. */
export interface PromotionHost {
    gprPath: string;
    projectName: string;
    /** 이미 이 프로젝트의 `ProjectSource` 라 승격이 필요 없다 */
    alreadySource: boolean;
    /** 다른 `.gpr` 이 이 프로젝트를 라이브러리로 참조한다 — 그러면 "메인"이 아니다 */
    referencedAsLibrary: boolean;
}

/**
 * 이 소스 파일을 컴파일 집합에 포함하는 프로젝트를 워크스페이스 `.gpr` 목록에서 찾는다.
 *
 * `Set Break` 의 프로젝트 인자는 **제어기에 로드된 메인 프로젝트**여야 하므로, 승격 대상 `.gpr` 도
 * 그 메인이어야 한다. 라이브러리 자신의 `.gpr` 에 올려 봐야 제어기는 그 프로젝트를 로드하지 않는다.
 * 그래서 "다른 `.gpr` 이 라이브러리로 참조하지 않는 것"을 앞에 둔다(호출측이 그대로 쓰거나 물어본다).
 */
export function findPromotionHosts(
    targetFile: string,
    gprPaths: readonly string[],
    opts: ResolveLibraryOptions & { readText?: (p: string) => string } = {},
): PromotionHost[] {
    const readText = opts.readText ?? defaultReadGprText;
    const targetK = fileKey(targetFile);
    const graphs = new Map<string, LibraryGraph>();
    for (const gprPath of gprPaths) {
        const abs = path.resolve(gprPath);
        const text = readText(abs);
        if (!text) { continue; }
        graphs.set(abs.toLowerCase(), buildLibraryGraph(abs, text, { ...opts, knownGprPaths: gprPaths, readText }));
    }

    // 라이브러리로 참조되는 폴더 집합
    const referenced = new Set<string>();
    for (const graph of graphs.values()) {
        for (const dir of graph.dirs) { referenced.add(normalizeDirKey(dir)); }
    }

    const hosts: PromotionHost[] = [];
    for (const graph of graphs.values()) {
        if (!compileSet(graph).has(targetK)) { continue; }
        const rootNode = graph.nodes.get(normalizeDirKey(graph.rootDir));
        if (!rootNode) { continue; }
        hosts.push({
            gprPath: rootNode.gprPath,
            projectName: rootNode.projectName,
            alreadySource: rootNode.sources.some(s => fileKey(s) === targetK),
            referencedAsLibrary: referenced.has(normalizeDirKey(graph.rootDir)),
        });
    }
    return hosts.sort((a, b) =>
        Number(a.referencedAsLibrary) - Number(b.referencedAsLibrary)
        || normalizeDirKey(a.gprPath).length - normalizeDirKey(b.gprPath).length
        || a.gprPath.localeCompare(b.gprPath));
}

/** 노드에서 `refs` 를 따라 `targetDir` 에 도달할 수 있는가(자기 자신 포함). */
function reaches(graph: LibraryGraph, fromDir: string, targetKey: string): boolean {
    const seen = new Set<string>();
    const stack = [normalizeDirKey(fromDir)];
    while (stack.length > 0) {
        const key = stack.pop()!;
        if (key === targetKey) { return true; }
        if (seen.has(key)) { continue; }
        seen.add(key);
        for (const ref of graph.nodes.get(key)?.refs ?? []) {
            if (ref.dir) { stack.push(normalizeDirKey(ref.dir)); }
        }
    }
    return false;
}

/** 루트에서 `refs` 를 따라 도달 가능한 라이브러리 폴더 키 집합(루트 제외). */
function reachableFromRoot(graph: LibraryGraph, skipRefRaw: ReadonlySet<string>): Set<string> {
    const rootKey = normalizeDirKey(graph.rootDir);
    const out = new Set<string>();
    const seen = new Set<string>([rootKey]);
    const stack: string[] = [rootKey];
    while (stack.length > 0) {
        const key = stack.pop()!;
        const node = graph.nodes.get(key);
        if (!node) { continue; }
        for (const ref of node.refs) {
            // 메인에서 지운 참조는 루트에서만 끊는다(라이브러리 사이 참조는 그대로다).
            if (key === rootKey && skipRefRaw.has(ref.raw)) { continue; }
            if (!ref.dir) { continue; }
            const childKey = normalizeDirKey(ref.dir);
            out.add(childKey);
            if (seen.has(childKey)) { continue; }
            seen.add(childKey);
            stack.push(childKey);
        }
    }
    return out;
}

/**
 * 메인 `.gpr` 에서 이 라이브러리 폴더를 가리킬 `ProjectLibrary` 값을 고른다.
 *
 * 값의 기준점은 `projectSources.libraryDirCandidates` 와 같다 — 프로젝트 폴더, 그리고 그 부모
 * (projects 루트). 원문(`raw`)이 메인에서도 같은 폴더로 풀리면 그대로 쓰고(표기 통일),
 * 아니면 메인 기준으로 다시 계산한다.
 */
function libraryValueForMain(mainDir: string, raw: string, dir: string): string {
    const bases = [mainDir, path.dirname(mainDir)];
    const native = raw.replace(/[\\/]+/g, path.sep).replace(/[\\/]+$/, '').trim();
    if (native && !path.isAbsolute(native)) {
        for (const base of bases) {
            if (normalizeDirKey(path.resolve(base, native)) === normalizeDirKey(dir)) { return gprStyle(raw); }
        }
    }
    for (const base of bases) {
        const rel = path.relative(base, dir);
        if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) { return gprStyle(rel); }
    }
    return gprStyle(raw);
}

/** 그래프의 컴파일 집합 — 루트 + 도달 가능한 라이브러리가 선언한 모든 `ProjectSource`. */
function compileSet(graph: LibraryGraph): Map<string, string> {
    const out = new Map<string, string>();
    const rootKey = normalizeDirKey(graph.rootDir);
    const keys = [rootKey, ...reachableFromRoot(graph, new Set()).values()];
    for (const key of keys) {
        for (const src of graph.nodes.get(key)?.sources ?? []) {
            out.set(fileKey(src), src);
        }
    }
    return out;
}

/**
 * 대상 파일에 BP 를 걸 수 있게 하는 메인 `.gpr` 최소 편집 계획.
 * 어떤 파일도 쓰지 않는다 — 호출측이 `newText` 를 미리보기로 보여 주고 승인 후 저장한다.
 */
export function planSourcePromotion(opts: PlanPromotionOptions): PromotionPlan {
    const mainGprPath = path.resolve(opts.mainGprPath);
    const mainDir = path.dirname(mainGprPath);
    const target = path.resolve(opts.targetFile);
    const targetK = fileKey(target);
    const empty: PromotionVerification = { ok: false, lost: [], duplicated: [], unresolved: [] };
    const base = { removeLibraries: [], addLibraries: [], addSources: [], warnings: [] };

    const graph = buildLibraryGraph(mainGprPath, opts.mainGprText, opts);
    const rootKey = normalizeDirKey(graph.rootDir);
    const rootNode = graph.nodes.get(rootKey)!;

    if (rootNode.sources.some(s => fileKey(s) === targetK)) {
        return {
            ...base,
            status: 'already-source',
            reason: `${path.basename(target)} 은 이미 메인 프로젝트(${rootNode.projectName})의 ProjectSource 입니다.`,
            targetRel: gprStyle(path.relative(mainDir, target)),
            verification: { ok: true, lost: [], duplicated: [], unresolved: graph.unresolved },
        };
    }

    // 대상 파일을 선언한 라이브러리 노드
    let owning: LibraryGraphNode | undefined;
    for (const key of reachableFromRoot(graph, new Set())) {
        const node = graph.nodes.get(key);
        if (node?.sources.some(s => fileKey(s) === targetK)) { owning = node; break; }
    }
    if (!owning) {
        return {
            ...base,
            status: 'not-compiled',
            reason: `${path.basename(target)} 은 이 컴파일 단위의 어떤 .gpr 에도 ProjectSource 로 없습니다`
                + ' — 제어기에서 컴파일되지 않는 파일이라 BP 대상이 아닙니다.'
                + ' 먼저 이 파일을 소유한 프로젝트의 .gpr 에 등재하세요.',
            verification: empty,
        };
    }
    const owningKey = normalizeDirKey(owning.dir);

    // 루트에서 owning 으로 가는 경로의 첫 홉 = 메인에서 지울 참조
    const removeRaw = new Set<string>();
    for (const ref of rootNode.refs) {
        if (ref.dir && reaches(graph, ref.dir, owningKey)) { removeRaw.add(ref.raw); }
    }
    if (removeRaw.size === 0) {
        return {
            ...base,
            status: 'not-compiled',
            reason: `${path.basename(target)} 을 끌어오는 ProjectLibrary 참조를 메인 .gpr 에서 찾지 못했습니다.`,
            verification: empty,
        };
    }

    // 제거로 도달 불가가 된 노드 — owning 에 도달하는 것은 소스 승격, 아닌 것은 참조로 복구
    const before = reachableFromRoot(graph, new Set());
    const after = reachableFromRoot(graph, removeRaw);
    // 순서는 `graph.dirs`(참조 선언 순서)를 따른다 — 같은 입력에 같은 편집 결과가 나오도록.
    const lostNodes = graph.dirs.map(normalizeDirKey).filter(k => before.has(k) && !after.has(k));

    // 폴더 → 부모 `.gpr`에 적힌 원문 참조값. 표기를 그대로 재사용해 diff 를 최소화한다.
    const rawByDir = new Map<string, string>();
    for (const node of graph.nodes.values()) {
        for (const ref of node.refs) {
            if (ref.dir && !rawByDir.has(normalizeDirKey(ref.dir))) {
                rawByDir.set(normalizeDirKey(ref.dir), ref.raw);
            }
        }
    }

    const addSources: string[] = [];
    const addLibraries: string[] = [];
    const outsideMain: string[] = [];
    const seenLib = new Set<string>(rootNode.refs.filter(r => !removeRaw.has(r.raw)).map(r => sourceKey(r.raw)));
    const seenSrc = new Set<string>(rootNode.sources.map(fileKey));

    for (const key of lostNodes) {
        const node = graph.nodes.get(key);
        if (!node) { continue; }
        if (reaches(graph, node.dir, owningKey)) {
            // 이 노드를 라이브러리로 되살리면 대상 파일이 다시 라이브러리 경유로 들어온다 → 소스 승격.
            for (const src of node.sources) {
                const k = fileKey(src);
                if (seenSrc.has(k)) { continue; }
                seenSrc.add(k);
                const rel = path.relative(mainDir, src);
                if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) { outsideMain.push(src); continue; }
                addSources.push(gprStyle(rel));
            }
            // 이 노드의 의존 라이브러리는 대상에 도달하지 않는 한 그대로 유지해야 한다.
            // 편집 후에도 다른 참조로 도달 가능한 것은 다시 적지 않는다(diff 최소화).
            for (const ref of node.refs) {
                if (!ref.dir || reaches(graph, ref.dir, owningKey)) { continue; }
                if (after.has(normalizeDirKey(ref.dir))) { continue; }
                const value = libraryValueForMain(mainDir, ref.raw, ref.dir);
                if (seenLib.has(sourceKey(value))) { continue; }
                seenLib.add(sourceKey(value));
                addLibraries.push(value);
            }
        } else {
            // 대상과 무관한 노드 — 라이브러리 참조로 다시 적어 컴파일 집합을 보존한다.
            const value = libraryValueForMain(mainDir, rawByDir.get(key) ?? '', node.dir);
            if (seenLib.has(sourceKey(value))) { continue; }
            seenLib.add(sourceKey(value));
            addLibraries.push(value);
        }
    }

    const removeLibraries = [...removeRaw];
    if (outsideMain.length > 0) {
        return {
            ...base,
            status: 'outside-main-dir',
            removeLibraries,
            reason: '승격해야 할 소스가 메인 프로젝트 폴더 밖에 있어 ProjectSource 상대 경로로 적을 수 없습니다: '
                + outsideMain.map(f => path.basename(f)).join(', ')
                + '. 라이브러리 폴더를 메인 프로젝트 폴더 안으로 옮기거나, 그 라이브러리에서 직접 디버그하세요.',
            verification: empty,
        };
    }

    // ── 편집 텍스트 ─────────────────────────────
    const parsed = parseGprText(opts.mainGprText);
    const removeLines = parsed.libraries.filter(l => removeRaw.has(l.path)).map(l => l.line);
    const prependLines = (opts.keepOriginalAsComment ?? true)
        ? [
            `' [GPL 확장] ${path.basename(target)} 에 브레이크포인트를 걸기 위해 ProjectSource 로 승격했습니다.`,
            "' 되돌릴 때는 아래 줄을 지우고 원래 참조를 복원하세요:",
            ...removeLibraries.map(r => `'   ProjectLibrary="${r}"`),
        ]
        : [];
    const newText = applyGprSync(opts.mainGprText, {
        add: addSources,
        addLibraries,
        removeLines,
        prependLines,
    });

    // ── 검증: 컴파일 집합이 보존됐는가 ───────────
    const beforeSet = compileSet(graph);
    const afterGraph = buildLibraryGraph(mainGprPath, newText, opts);
    const afterSet = compileSet(afterGraph);
    const lost = [...beforeSet.entries()]
        .filter(([k]) => !afterSet.has(k))
        .map(([, v]) => path.relative(mainDir, v) || v);

    // 중복: 메인 ProjectSource 로 올린 파일이 편집 후에도 도달 가능한 라이브러리에서 또 선언되는가
    const afterRootKey = normalizeDirKey(afterGraph.rootDir);
    const mainSources = new Set((afterGraph.nodes.get(afterRootKey)?.sources ?? []).map(fileKey));
    const duplicated: string[] = [];
    for (const key of reachableFromRoot(afterGraph, new Set())) {
        for (const src of afterGraph.nodes.get(key)?.sources ?? []) {
            if (mainSources.has(fileKey(src))) { duplicated.push(path.relative(mainDir, src) || src); }
        }
    }

    const verification: PromotionVerification = {
        ok: lost.length === 0 && duplicated.length === 0 && afterGraph.unresolved.length === 0,
        lost,
        duplicated,
        unresolved: afterGraph.unresolved,
    };

    const warnings: string[] = [];
    if (addLibraries.length > 0) {
        warnings.push(
            `그룹 참조 ${removeLibraries.join(', ')} 를 빼면서 그 그룹이 제공하던 라이브러리 `
            + `${addLibraries.length}개를 개별 참조로 다시 적었습니다 — 컴파일 집합을 그대로 유지하기 위한 것입니다.`,
        );
    }
    if (addSources.length > 1) {
        warnings.push(
            `${owning.projectName} 을 컴파일 집합에서 빼면 그 참조 경로에 있던 라이브러리의 소스도 함께 빠지므로, `
            + `소스 ${addSources.length}개가 메인 ProjectSource 로 승격됩니다`
            + `(대상 ${path.basename(target)} 포함). 라이브러리 경계가 그만큼 메인으로 흡수됩니다 — `
            + '되돌리려면 주석에 남긴 원래 참조를 복원하세요.',
        );
    }
    if (graph.unresolved.length > 0) {
        warnings.push(`편집 전부터 해석되지 않는 ProjectLibrary 값이 있습니다: ${graph.unresolved.join(', ')}`);
    }

    return {
        status: verification.ok ? 'ready' : 'unsafe',
        reason: verification.ok
            ? undefined
            : '편집 결과가 컴파일 집합을 보존하지 못합니다'
            + (lost.length > 0 ? ` — 빠지는 파일: ${lost.join(', ')}` : '')
            + (duplicated.length > 0 ? ` — 중복 컴파일: ${duplicated.join(', ')}` : '')
            + (afterGraph.unresolved.length > 0 ? ` — 해석 실패: ${afterGraph.unresolved.join(', ')}` : ''),
        targetRel: gprStyle(path.relative(mainDir, target)),
        owningLibraryDir: owning.dir,
        owningLibraryName: owning.projectName,
        removeLibraries,
        addLibraries,
        addSources,
        newText,
        verification,
        warnings,
    };
}
