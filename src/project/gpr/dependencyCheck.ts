/**
 * 패키지(.gpr) 의존 검사 — `ProjectLibrary`/`ProjectSource` 선언 ↔ 실제 사용, 그리고 계층 규칙(vscode 무의존 순수 모듈).
 *
 * 다른 언어의 패키지 도구(`go mod tidy`·depcheck·Bazel strict deps)와 같은 역할이다. GPL 에는 소스 안의 import 가 없고
 * 의존 선언은 `.gpr` 뿐이라, 실제 사용(`moduleDependencies` — 정의 이동과 같은 이름 해석)과 선언을 대조한다.
 *
 * 패키지 하나(= `.gpr` 하나, ProjectSource 가 있는 것)마다:
 * - **library-missing** (warning): 쓰는 파일이 자기 소스에도, ProjectLibrary 를 따라간 어느 패키지에도 없다 — 이 패키지만
 *   컴파일하면 이름을 못 찾는다. 그 파일을 가진 패키지를 ProjectLibrary 로 더하는 빠른 수정.
 * - **source-missing** (warning): 위와 같지만 그 파일이 어느 패키지에도 속하지 않았거나, 이 `.gpr` 이 하위 패키지 소스를
 *   평탄하게 나열하는 루트(BinderR4)다 — ProjectSource 로 더하는 빠른 수정.
 * - **library-indirect** (information): 다른 라이브러리를 거쳐서만 들어온다. 컴파일은 되지만 그 라이브러리가 선언을 바꾸면
 *   깨진다 — 직접 쓰는 패키지는 직접 선언한다(strict deps). 그룹(.gpr 에 ProjectSource 없이 ProjectLibrary 만)을 참조하면
 *   그 그룹 아래 패키지는 모두 직접 선언으로 본다.
 * - **library-unused** (information): 선언했지만 이 패키지의 소스가 그 패키지(그룹이면 그 아래)의 파일을 쓰지 않는다.
 * - **library-unresolved** (warning): ProjectLibrary 경로를 어느 폴더로도 풀지 못했다.
 *
 * 모든 `.gpr`(그룹·루트 포함)에 대해:
 * - **project-name-mismatch** (warning): `ProjectName` 이 `.gpr` 이 있는 폴더 이름과 정확히(대소문자까지) 같지 않거나 없다.
 *   문서상 "폴더 이름과 프로젝트 이름은 동의어"이고 제어기 플래시 이름은 대소문자를 가린다(docs/reference/project-file-gpr.md §1·§5).
 *   2026-10-28 사용자 규칙 "ProjectName 은 폴더명과 같아야 한다". 빠른 수정은 ProjectName 을 폴더 이름으로 바꾼다 —
 *   폴더 이름을 바꾸면 다른 `.gpr` 의 ProjectLibrary 경로가 깨지므로 그쪽은 제안하지 않는다.
 *
 * 계층 규칙은 루트 `.gpr` 주석 `' Dependencies: App -> Config/Gantry/Lib; Config -> Gantry/Lib; Gantry -> Lib.` 를 읽는다.
 * 그룹 = 루트 폴더 바로 아래 폴더 이름. 규칙에 나오는 그룹은 자기 자신과 화살표 오른쪽 그룹만 참조할 수 있다
 * (왼쪽에 없는 그룹 — 위 예의 Lib — 은 다른 그룹을 참조할 수 없다). 규칙에 나오지 않는 폴더는 검사하지 않는다.
 *
 * 단위 테스트: src/test/project/gpr/dependencyCheck.test.ts
 */
import * as path from 'path';
import type { RequiredFile } from '../../language/analysis/moduleDependencies';
import { isPathUnder, normalizeDirKey, normalizePathKey } from '../../util/pathKey';
import { parseGprText } from './gprSync';
import { GPR_PATH_SEPARATOR } from '../sources/projectSources';

/** 검사 대상 `.gpr` 하나. 경로는 모두 절대 경로. */
export interface PackageInput {
    gprPath: string;
    text: string;
    /** 직접 선언한 ProjectSource(선언 순) */
    sources: string[];
    /** 직접 선언한 ProjectLibrary — 해석 실패면 `dir` 없음 */
    refs: ReadonlyArray<{ raw: string; dir?: string }>;
    /** ProjectLibrary 를 재귀로 따라간 패키지 폴더(자기 제외) */
    closureDirs: string[];
}

export interface DependencyCheckInput {
    /** 컴파일 루트 `.gpr`(계층 규칙·경로 기준) */
    rootGprPath: string;
    packages: readonly PackageInput[];
    /** 파일이 쓰는 다른 파일(moduleDependencies) */
    depsOf(filePath: string): readonly RequiredFile[];
}

export type GprFindingCode =
    | 'library-missing' | 'source-missing' | 'library-indirect' | 'library-unused' | 'library-unresolved'
    | 'project-name-mismatch';

/** `.gpr` 텍스트 줄 편집 — `insertLine` 앞에 줄을 넣거나, `removeLine` 을 지우거나, `replaceLine` 의 내용을 바꾼다. */
export type GprFix =
    | { kind: 'insert'; insertLine: number; text: string; title: string }
    | { kind: 'remove'; removeLine: number; title: string }
    | { kind: 'replace'; replaceLine: number; text: string; title: string };

export interface GprFinding {
    code: GprFindingCode;
    severity: 'warning' | 'information';
    gprPath: string;
    /** 진단 줄(0-기준) */
    line: number;
    message: string;
    fix?: GprFix;
}

export interface LayerFinding {
    code: 'layer-violation';
    filePath: string;
    line: number;
    character: number;
    message: string;
}

export interface DependencyCheckResult {
    gprFindings: GprFinding[];
    layerFindings: LayerFinding[];
    /** 검사한 소스 파일 수 */
    fileCount: number;
    rules?: LayerRules;
}

// ─── 계층 규칙 ─────────────────────────────────────────────────────────────────────────

export interface LayerRules {
    /** 규칙 줄(0-기준) */
    line: number;
    /** 그룹(소문자) → 참조해도 되는 그룹(소문자, 자기 제외) */
    allowed: Map<string, Set<string>>;
    /** 규칙에 나오는 모든 그룹(소문자 → 표기) */
    groups: Map<string, string>;
}

const RULE_LINE = /^\s*'\s*Dependencies\s*:\s*(.+?)\s*$/i;

/** `' Dependencies: A -> B/C; D -> E.` — 형식에 맞는 줄이 없으면 undefined. */
export function parseLayerRules(gprText: string): LayerRules | undefined {
    const lines = gprText.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const m = RULE_LINE.exec(lines[i]);
        if (!m) { continue; }
        const allowed = new Map<string, Set<string>>();
        const groups = new Map<string, string>();
        const note = (g: string): string => { const k = g.toLowerCase(); if (!groups.has(k)) { groups.set(k, g); } return k; };
        for (const clause of m[1].replace(/\.\s*$/, '').split(';')) {
            const arrow = /^\s*([A-Za-z_][\w]*)\s*->\s*(.+?)\s*$/.exec(clause);
            if (!arrow) { continue; }
            const from = note(arrow[1]);
            const set = allowed.get(from) ?? new Set<string>();
            for (const to of arrow[2].split(/[/,]/).map(x => x.trim()).filter(Boolean)) { set.add(note(to)); }
            allowed.set(from, set);
        }
        if (allowed.size > 0) { return { line: i, allowed, groups }; }
    }
    return undefined;
}

// ─── 검사 ─────────────────────────────────────────────────────────────────────────────

interface Pkg extends PackageInput {
    dir: string;
    dirKey: string;
    sourceKeys: Set<string>;
    parsed: ReturnType<typeof parseGprText>;
}

const fileLabel = (p: string): string => path.basename(p);

export function checkPackageDependencies(input: DependencyCheckInput): DependencyCheckResult {
    const rootDir = path.dirname(path.resolve(input.rootGprPath));
    const pkgs: Pkg[] = input.packages.map(p => ({
        ...p,
        dir: path.dirname(path.resolve(p.gprPath)),
        dirKey: normalizeDirKey(path.dirname(path.resolve(p.gprPath))),
        sourceKeys: new Set(p.sources.map(normalizePathKey)),
        parsed: parseGprText(p.text),
    }));
    const byDir = new Map(pkgs.map(p => [p.dirKey, p]));

    // 파일의 소유 패키지 = 그 파일을 ProjectSource 로 직접 나열한 가장 깊은 .gpr (루트가 평탄하게 나열해도 리프가 이긴다)
    const owner = new Map<string, Pkg>();
    for (const p of pkgs) {
        for (const key of p.sourceKeys) {
            const cur = owner.get(key);
            if (!cur || p.dirKey.length > cur.dirKey.length) { owner.set(key, p); }
        }
    }
    const closureFiles = (p: Pkg): Set<string> => {
        const out = new Set<string>();
        for (const d of p.closureDirs) { for (const k of byDir.get(normalizeDirKey(d))?.sourceKeys ?? []) { out.add(k); } }
        return out;
    };
    /** 참조 하나가 직접 제공하는 패키지 폴더 — 리프면 자기, 그룹(소스 없음)이면 그 아래 전부. */
    const provided = (dir: string): Set<string> => {
        const node = byDir.get(normalizeDirKey(dir));
        const out = new Set<string>([normalizeDirKey(dir)]);
        if (node && node.sources.length === 0) { for (const d of node.closureDirs) { out.add(normalizeDirKey(d)); } }
        return out;
    };

    const depsMemo = new Map<string, readonly RequiredFile[]>();
    const deps = (file: string): readonly RequiredFile[] => {
        const key = normalizePathKey(file);
        let d = depsMemo.get(key);
        if (!d) { d = input.depsOf(file); depsMemo.set(key, d); }
        return d;
    };

    // 폴더 이름이 같은 패키지 — ProjectName 을 폴더 이름으로 맞추면 이름이 겹친다(BinderR4: Gantry\Data·Lib\Data, Motion\Cmd·Robot\Cmd)
    const sameFolderName = new Map<string, string[]>();
    for (const p of pkgs) { push(sameFolderName, path.basename(p.dir).toLowerCase(), [] as string[]).push(p.gprPath); }

    const gprFindings: GprFinding[] = [];
    for (const p of pkgs) {
        const nameFinding = projectNameMismatch(p, sameFolderName.get(path.basename(p.dir).toLowerCase())?.filter(o => o !== p.gprPath));
        if (nameFinding) { gprFindings.push(nameFinding); }
        if (p.sources.length === 0) {
            for (const [i, r] of p.refs.entries()) {
                if (!r.dir) { gprFindings.push(unresolved(p, i, r.raw)); }
            }
            continue;
        }
        const closure = closureFiles(p);
        const flattenedRoot = p.refs.length === 0
            && Array.from(p.sourceKeys).some(k => owner.get(k) !== p);
        const direct = new Set<string>();
        for (const r of p.refs) { if (r.dir) { for (const d of provided(r.dir)) { direct.add(d); } } }

        // 대상 파일 → 처음 쓰는 소스
        const targets = new Map<string, { file: string; by: string }>();
        for (const s of p.sources) {
            for (const d of deps(s)) {
                const key = normalizePathKey(d.filePath);
                if (p.sourceKeys.has(key) || targets.has(key)) { continue; }
                targets.set(key, { file: d.filePath, by: s });
            }
        }

        const usedOwners = new Set<string>();
        const missingLib = new Map<string, { owner: Pkg; files: string[]; by: string }>();
        const indirect = new Map<string, { owner: Pkg; files: string[] }>();
        for (const [key, t] of targets) {
            const o = owner.get(key);
            if (o) { usedOwners.add(o.dirKey); }
            if (closure.has(key)) {
                if (o && !direct.has(o.dirKey)) { push(indirect, o.dirKey, { owner: o, files: [] }).files.push(t.file); }
                continue;
            }
            // 소유 패키지가 자기 바깥 폴더(루트처럼 이 패키지를 품은 것)면 라이브러리로 참조할 수 없다 — 목록 누락으로 알린다
            if (o && o !== p && !flattenedRoot && !isPathUnder(p.dir, o.dir)) {
                push(missingLib, o.dirKey, { owner: o, files: [], by: t.by }).files.push(t.file);
            } else {
                gprFindings.push(sourceMissing(p, t.file, t.by, rootDir));
            }
        }
        for (const m of missingLib.values()) { gprFindings.push(libraryMissing(p, m.owner, m.files, m.by, rootDir)); }
        for (const m of indirect.values()) { gprFindings.push(libraryIndirect(p, m.owner, m.files, rootDir)); }
        for (const [i, r] of p.refs.entries()) {
            if (!r.dir) { gprFindings.push(unresolved(p, i, r.raw)); continue; }
            const prov = provided(r.dir);
            if (!Array.from(prov).some(d => usedOwners.has(d))) {
                gprFindings.push({
                    code: 'library-unused', severity: 'information', gprPath: p.gprPath, line: p.parsed.libraries[i].line,
                    message: `ProjectLibrary "${r.raw}" — 이 패키지의 소스가 그 라이브러리를 쓰지 않습니다.`,
                    fix: { kind: 'remove', removeLine: p.parsed.libraries[i].line, title: `ProjectLibrary "${r.raw}" 줄 지우기` },
                });
            }
        }
    }

    // 계층 규칙
    const rootPkg = byDir.get(normalizeDirKey(rootDir));
    const rules = rootPkg ? parseLayerRules(rootPkg.text) : undefined;
    const layerFindings: LayerFinding[] = [];
    const allFiles = new Map<string, string>();
    for (const p of pkgs) { for (const s of p.sources) { allFiles.set(normalizePathKey(s), s); } }
    if (rules) {
        const groupOf = (file: string): string | undefined => {
            if (!isPathUnder(file, rootDir)) { return undefined; }
            const rel = path.relative(rootDir, file).split(/[\\/]/);
            return rel.length > 1 ? rel[0].toLowerCase() : undefined;
        };
        for (const file of allFiles.values()) {
            const from = groupOf(file);
            if (!from || !rules.groups.has(from)) { continue; }
            const allowed = rules.allowed.get(from) ?? new Set<string>();
            for (const d of deps(file)) {
                const to = groupOf(d.filePath);
                if (!to || to === from || allowed.has(to)) { continue; }
                const fromName = rules.groups.get(from)!;
                const toName = rules.groups.get(to) ?? path.relative(rootDir, d.filePath).split(/[\\/]/)[0];
                layerFindings.push({
                    code: 'layer-violation', filePath: file, line: d.firstUse.line, character: d.firstUse.character,
                    message: `계층 규칙 위반: ${fromName} → ${toName} (${d.fileName}) — ${path.basename(input.rootGprPath)} 의 Dependencies 에 `
                        + (allowed.size > 0 ? `${fromName} -> ${[...allowed].map(g => rules.groups.get(g)).join('/')} 만 있습니다.` : `${fromName} 은 다른 그룹을 참조하지 않습니다.`),
                });
            }
        }
    }
    return { gprFindings, layerFindings, fileCount: allFiles.size, rules };
}

function push<K, V>(map: Map<K, V>, key: K, init: V): V {
    let v = map.get(key);
    if (!v) { v = init; map.set(key, v); }
    return v;
}

const list = (files: readonly string[]): string =>
    files.slice(0, 3).map(fileLabel).join(', ') + (files.length > 3 ? ` 외 ${files.length - 3}` : '');

/** 진단 자리 — ProjectName 줄(없으면 0). */
/**
 * ProjectName ↔ 폴더 이름. 같으면 undefined. 값 앞뒤 공백도 차이로 본다(제어기 명령 인자가 된다).
 * `sameFolderName` 은 같은 이름의 폴더를 가진 다른 `.gpr` — 고치면 이름이 겹친다는 사실을 문구에 덧붙인다
 * (겹친 라이브러리 이름을 제어기가 어떻게 다루는지는 미확인).
 */
export function projectNameMismatch(p: { gprPath: string; text: string }, sameFolderName: readonly string[] = []): GprFinding | undefined {
    const folder = path.basename(path.dirname(path.resolve(p.gprPath)));
    const lines = p.text.split(/\r?\n/);
    const line = lines.findIndex(l => /^\s*ProjectName\s*=/i.test(l));
    const wanted = `ProjectName="${folder}"`;
    if (line < 0) {
        const begin = lines.findIndex(l => /^\s*ProjectBegin\s*$/i.test(l));
        return {
            code: 'project-name-mismatch', severity: 'warning', gprPath: p.gprPath, line: Math.max(0, begin),
            message: `ProjectName 이 없습니다 — 폴더 이름 "${folder}" 와 같은 ProjectName 이 있어야 합니다.`,
            fix: { kind: 'insert', insertLine: begin + 1, text: wanted, title: `${wanted} 추가` },
        };
    }
    const value = /^\s*ProjectName\s*=\s*["']([^"']*)["']/i.exec(lines[line])?.[1];
    if (value === folder) { return undefined; }
    const caseOnly = value !== undefined && value.toLowerCase() === folder.toLowerCase();
    return {
        code: 'project-name-mismatch', severity: 'warning', gprPath: p.gprPath, line,
        message: `ProjectName "${value ?? lines[line].trim()}" 이(가) 폴더 이름 "${folder}" 와 ${caseOnly ? '대소문자가 ' : ''}다릅니다 — `
            + 'ProjectName 은 폴더 이름과 같아야 합니다(문서상 동의어, 제어기 플래시 이름은 대소문자를 가림).'
            + (sameFolderName.length > 0
                ? ` 주의: 같은 이름의 폴더가 ${sameFolderName.map(g => path.basename(path.dirname(path.dirname(g))) + '\\' + folder).join(', ')} 에도 있어 고치면 ProjectName 이 겹칩니다 — 폴더 이름을 구분되게 바꾸는 것도 검토하세요.`
                : ''),
        fix: { kind: 'replace', replaceLine: line, text: lines[line].replace(/^(\s*)ProjectName\s*=.*$/i, `$1${wanted}`), title: `${wanted} 로 바꾸기` },
    };
}

function headLine(p: Pkg): number {
    const i = p.parsed.lines.findIndex(l => /^\s*ProjectName\s*=/i.test(l));
    return i >= 0 ? i : 0;
}

/**
 * 새 ProjectLibrary 값 — 같은 `.gpr` 의 기존 참조가 쓰는 기준 폴더를 따른다(BinderR4 리프는 루트 기준 `Lib\Core\Text`).
 * 기존 참조가 없으면 루트 기준, 루트 밖이면 이 패키지 부모 기준.
 */
function libraryValue(p: Pkg, target: Pkg, rootDir: string): string {
    for (const r of p.refs) {
        if (!r.dir) { continue; }
        const rawNative = r.raw.replace(/[\\/]+/g, path.sep).replace(/[\\/]+$/, '');
        const dir = path.resolve(r.dir);
        if (dir.toLowerCase().endsWith(path.sep + rawNative.toLowerCase())) {
            const base = dir.slice(0, dir.length - rawNative.length - 1);
            if (isPathUnder(target.dir, base)) { return toGpr(path.relative(base, target.dir)); }
        }
    }
    const base = isPathUnder(target.dir, rootDir) ? rootDir : path.dirname(p.dir);
    return toGpr(path.relative(base, target.dir));
}

const toGpr = (rel: string): string => rel.split(/[\\/]+/).join(GPR_PATH_SEPARATOR);

function insertLibrary(p: Pkg, value: string): GprFix {
    const libs = p.parsed.libraries;
    const at = libs.length > 0 ? libs[libs.length - 1].line + 1
        : p.parsed.sources.length > 0 ? p.parsed.sources[0].line
            : p.parsed.projectEndLine >= 0 ? p.parsed.projectEndLine : p.parsed.lines.length;
    return { kind: 'insert', insertLine: at, text: `ProjectLibrary="${value}"`, title: `ProjectLibrary="${value}" 추가` };
}

function libraryMissing(p: Pkg, target: Pkg, files: string[], by: string, rootDir: string): GprFinding {
    const value = libraryValue(p, target, rootDir);
    return {
        code: 'library-missing', severity: 'warning', gprPath: p.gprPath, line: headLine(p),
        message: `ProjectLibrary 누락: "${value}" — ${fileLabel(by)} 이(가) ${list(files)} 을(를) 쓰는데 이 패키지의 라이브러리에 없습니다(이 .gpr 만 컴파일하면 이름을 못 찾습니다).`,
        fix: insertLibrary(p, value),
    };
}

function libraryIndirect(p: Pkg, target: Pkg, files: string[], rootDir: string): GprFinding {
    const value = libraryValue(p, target, rootDir);
    return {
        code: 'library-indirect', severity: 'information', gprPath: p.gprPath, line: headLine(p),
        message: `간접 의존: ${list(files)} 은(는) 다른 ProjectLibrary 를 거쳐서만 들어옵니다 — 직접 쓰므로 "${value}" 를 직접 선언하는 것을 권합니다.`,
        fix: insertLibrary(p, value),
    };
}

function sourceMissing(p: Pkg, file: string, by: string, rootDir: string): GprFinding {
    // 평탄한 루트는 쓰는 소스보다 앞에 둔다(목록 순서를 유지하는 관례 — BinderR4 주석 "Preserve source order")
    const byLine = p.parsed.sources.find(s => normalizePathKey(path.resolve(p.dir, s.path.replace(/[\\/]+/g, path.sep))) === normalizePathKey(by))?.line;
    const at = byLine ?? (p.parsed.projectEndLine >= 0 ? p.parsed.projectEndLine : p.parsed.lines.length);
    const value = toGpr(path.relative(p.dir, file));
    const outside = !isPathUnder(file, p.dir);
    return {
        code: 'source-missing', severity: 'warning', gprPath: p.gprPath, line: byLine ?? headLine(p),
        message: `ProjectSource 누락: ${fileLabel(by)} 이(가) ${fileLabel(file)} 을(를) 쓰는데 이 .gpr 의 목록·라이브러리 어디에도 없습니다(제어기는 목록에 있는 파일만 컴파일합니다).`
            + (outside ? ` (${path.relative(rootDir, file)} — 이 패키지 폴더 밖)` : ''),
        fix: outside ? undefined : { kind: 'insert', insertLine: at, text: `ProjectSource="${value}"`, title: `ProjectSource="${value}" 추가` },
    };
}

function unresolved(p: Pkg, index: number, raw: string): GprFinding {
    return {
        code: 'library-unresolved', severity: 'warning', gprPath: p.gprPath, line: p.parsed.libraries[index]?.line ?? headLine(p),
        message: `ProjectLibrary "${raw}" 을(를) 어느 폴더로도 풀지 못했습니다(.gpr 이 있는 폴더여야 합니다).`,
    };
}
