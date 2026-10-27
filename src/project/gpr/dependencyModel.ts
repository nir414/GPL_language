/**
 * 패키지 의존 검사의 입력 만들기 — 컴파일 루트 `.gpr` 찾기와, 루트 아래 `.gpr` 들의 소스·ProjectLibrary 해석(디스크 읽기).
 * 판정은 `dependencyCheck`(순수)가 한다. ProjectLibrary 해석 규칙의 정본은 `projectSources.buildLibraryGraph`.
 *
 * 단위 테스트: src/test/project/gpr/dependencyCheck.test.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { normalizeDirKey, normalizePathKey } from '../../util/pathKey';
import { buildLibraryGraph, gprPathInDir, isSkippedScanDir, resolveGprSourcePaths } from '../sources/projectSources';
import { parseGprText } from './gprSync';
import type { PackageInput } from './dependencyCheck';

export interface DependencyModelOptions {
    readText?: (gprPath: string) => string;
    /** 워크스페이스 `.gpr` 목록 — ProjectLibrary 디스크 후보가 빗나갔을 때의 폴백 */
    knownGprPaths?: readonly string[];
    /** 루트 아래 `.gpr` 탐색 깊이 상한(기본 12) */
    maxDepth?: number;
}

const defaultRead = (p: string): string => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };

/**
 * 파일(또는 `.gpr`)의 **컴파일 루트** — 위로 올라가며 만나는 `.gpr` 중 ProjectStart 가 있는 가장 가까운 것,
 * 없으면 이 파일을 ProjectSource 로 나열한 가장 바깥 것, 그것도 없으면 가장 가까운 것.
 * (BinderR4: `Lib\Motion\System\MotionSystem.gpl` → 리프 Lib_MotionSystem 이 아니라 루트 BinderR4)
 */
export function findCompileRootGpr(filePath: string, readText: (p: string) => string = defaultRead): string | undefined {
    const target = path.resolve(filePath);
    let dir = path.dirname(target);
    let nearest: string | undefined;
    let outerLister: string | undefined;
    for (let level = 0; level < 16; level++) {
        const gpr = gprPathInDir(dir);
        if (gpr) {
            nearest = nearest ?? gpr;
            const text = readText(gpr);
            if (parseGprText(text).projectStart) { return gpr; }
            if (resolveGprSourcePaths(gpr, text).some(s => normalizePathKey(s) === normalizePathKey(target))) { outerLister = gpr; }
        }
        const parent = path.dirname(dir);
        if (parent === dir) { break; }
        dir = parent;
    }
    return outerLister ?? nearest;
}

/** 루트 폴더 아래 `.gpr`(루트 포함) + 그 ProjectLibrary 가 가리키는 루트 밖 패키지까지 해석한다. */
export function buildPackageInputs(rootGprPath: string, opts: DependencyModelOptions = {}): PackageInput[] {
    const readText = memo(opts.readText ?? defaultRead);
    const findGprInDir = memo((dir: string) => gprPathInDir(dir) ?? '');
    const queue: string[] = [path.resolve(rootGprPath), ...findGprsUnder(path.dirname(path.resolve(rootGprPath)), opts.maxDepth ?? 12)];
    const seen = new Set<string>();
    const out: PackageInput[] = [];
    while (queue.length > 0) {
        const gpr = queue.shift()!;
        const key = normalizeDirKey(path.dirname(gpr));
        if (seen.has(key)) { continue; }
        seen.add(key);
        const text = readText(gpr);
        const graph = buildLibraryGraph(gpr, text, {
            readText, knownGprPaths: opts.knownGprPaths, findGprInDir: d => findGprInDir(d) || undefined,
        });
        const node = graph.nodes.get(key);
        out.push({
            gprPath: gpr,
            text,
            sources: node?.sources ?? resolveGprSourcePaths(gpr, text),
            refs: node?.refs ?? [],
            closureDirs: graph.dirs,
        });
        for (const n of graph.nodes.values()) {
            if (!seen.has(normalizeDirKey(n.dir))) { queue.push(n.gprPath); }
        }
    }
    return out;
}

function findGprsUnder(root: string, maxDepth: number): string[] {
    const out: string[] = [];
    const walk = (dir: string, depth: number): void => {
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            if (e.isDirectory()) {
                if (depth < maxDepth && !isSkippedScanDir(e.name)) { walk(path.join(dir, e.name), depth + 1); }
            } else if (/\.gpr$/i.test(e.name) && dir !== root) {
                const gpr = gprPathInDir(dir); // 같은 폴더에 여러 .gpr 이면 Project.gpr 우선(소유 규칙과 같게)
                if (gpr && !out.includes(gpr)) { out.push(gpr); }
            }
        }
    };
    walk(root, 0);
    return out;
}

function memo<T>(fn: (key: string) => T): (key: string) => T {
    const cache = new Map<string, T>();
    return key => {
        const k = key.toLowerCase();
        if (!cache.has(k)) { cache.set(k, fn(key)); }
        return cache.get(k)!;
    };
}
