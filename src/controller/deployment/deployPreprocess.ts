/**
 * 배포 전처리(preprocess) 계획 — 설정 해석, 파일 단위 미사용 제외(tree-shaking) 계획, 라이브러리 `.gpr` 목록 고쳐 쓰기.
 * vscode 무의존 순수 모듈(파일 읽기는 주입). 실제 사본 만들기·업로드 배선은 `deployPreprocessStage.ts`.
 *
 * 왜(2026-11-05·11-06 수신함 Sample Prep): 실행 중 여유 메모리가 0.40 MB 까지 떨어진 장비에서, `/GPL` 에 올린 소스(2.42 MB)와
 * 컴파일 결과(4.20 MB)가 메모리 대부분을 차지했다. 범용 라이브러리는 저장소에 통째로 두기로 했으므로(사용자 결정 11-06)
 * **워크스페이스를 건드리지 않고 배포할 때 만드는 사본에서만** 줄인다. 사본은 워크스페이스 밖(OS 임시 폴더)에 둔다 —
 * 워크스페이스 안에 있으면 같은 모듈 정의가 두 벌이 된다.
 *
 * 무엇을 하나(모두 기본 꺼짐, 프로젝트별로 켠다 — 설정 `gpl.deploy.preprocess`):
 * - `stripComments`·`trimWhitespace`: 줄 번호를 지키는 경량화(`project/sources/sourceMinify.ts`).
 * - `excludeUnreachableLibraryFiles`: 실행 프로젝트의 소스에서 이름으로 닿지 않는 **라이브러리** 파일을 올리지 않고, 사본의
 *   라이브러리 `.gpr` 에서도 그 `ProjectSource` 줄을 뺀다(판정: `project/sources/sourceReachability.ts`). 실행 프로젝트 자신의
 *   파일과 이 배포가 올리지 않는 라이브러리의 파일은 빼지 않는다(그쪽 `.gpr` 은 우리가 고칠 수 없다).
 * - `keepFiles`: 늘 포함할 라이브러리 파일(파일 이름·확장자 뺀 이름·라이브러리 폴더 기준 경로·Module/Class 이름).
 */

import * as path from 'path';
import { parseGprText } from '../../project/gpr/gprSync';
import type { LibraryGraphNode } from '../../project/sources/projectSources';
import { analyzeSourceReferences, computeReachableSources } from '../../project/sources/sourceReachability';
import type { SourceReferenceInfo } from '../../project/sources/sourceReachability';
import { isPathUnder, normalizePathKey } from '../../util/pathKey';

export interface DeployPreprocessOptions {
    stripComments: boolean;
    trimWhitespace: boolean;
    excludeUnreachableLibraryFiles: boolean;
    /** 늘 포함할 라이브러리 파일(머리말 참고). 설정·프로젝트별·호출 인자가 합쳐진다. */
    keepFiles: string[];
}

export function disabledPreprocess(): DeployPreprocessOptions {
    return { stripComments: false, trimWhitespace: false, excludeUnreachableLibraryFiles: false, keepFiles: [] };
}

export function isPreprocessActive(opts: DeployPreprocessOptions | undefined): boolean {
    return !!opts && (opts.stripComments || opts.trimWhitespace || opts.excludeUnreachableLibraryFiles);
}

/** 켜진 항목 이름 — 트레이스·보고용(`stripComments+excludeUnreachableLibraryFiles`). */
export function describePreprocessOptions(opts: DeployPreprocessOptions): string {
    const on = (['stripComments', 'trimWhitespace', 'excludeUnreachableLibraryFiles'] as const).filter(k => opts[k]);
    return on.length > 0 ? on.join('+') : 'off';
}

const FLAG_KEYS = ['stripComments', 'trimWhitespace', 'excludeUnreachableLibraryFiles'] as const;

function readPartial(raw: unknown): Partial<DeployPreprocessOptions> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { return {}; }
    const o = raw as Record<string, unknown>;
    const out: Partial<DeployPreprocessOptions> = {};
    for (const key of FLAG_KEYS) {
        if (typeof o[key] === 'boolean') { out[key] = o[key] as boolean; }
    }
    if (Array.isArray(o.keepFiles)) {
        out.keepFiles = o.keepFiles.filter((v): v is string => typeof v === 'string').map(v => v.trim()).filter(Boolean);
    }
    return out;
}

function merge(base: DeployPreprocessOptions, over: Partial<DeployPreprocessOptions>): DeployPreprocessOptions {
    const keep = [...base.keepFiles];
    for (const k of over.keepFiles ?? []) {
        if (!keep.some(e => e.toLowerCase() === k.toLowerCase())) { keep.push(k); }
    }
    return { ...base, ...over, keepFiles: keep };
}

/**
 * 설정값 → 이 프로젝트의 전처리 옵션. 우선순위: 호출 인자(`override`) > `projects.<ProjectName>`(대소문자 무시) > 공통 값.
 * `keepFiles` 는 덮어쓰지 않고 합친다. `override === false` 면 설정과 무관하게 끈다. 모르는 모양은 무시한다(꺼짐 쪽).
 */
export function resolvePreprocessOptions(setting: unknown, projectName: string, override?: unknown): DeployPreprocessOptions {
    if (override === false) { return disabledPreprocess(); }
    let opts = merge(disabledPreprocess(), readPartial(setting));
    const projects = setting && typeof setting === 'object' ? (setting as Record<string, unknown>).projects : undefined;
    if (projects && typeof projects === 'object' && !Array.isArray(projects)) {
        const hit = Object.keys(projects).find(k => k.toLowerCase() === projectName.toLowerCase());
        if (hit) { opts = merge(opts, readPartial((projects as Record<string, unknown>)[hit])); }
    }
    return merge(opts, readPartial(override));
}

// ─── 파일 단위 미사용 제외 계획 ──────────────────────────────────────────────

/** 업로드 단위 하나 — 로컬 폴더와 그것이 올라가는 원격 폴더. */
export interface PreprocessRoot {
    localDir: string;
    remoteDir: string;
}

export interface ExcludedSource {
    /** 로컬 절대 경로. */
    file: string;
    /** 원격 경로(올렸다면 놓였을 자리). */
    remotePath: string;
    bytes: number;
    lines: number;
    /** 그 파일이 선언한 이름(소문자) — 컴파일 `-729` 안내에서 원인 파일을 집을 때 쓴다. */
    declared: string[];
}

export interface TreeShakeInput {
    /** 컴파일 단위 그래프의 노드(루트 포함, `buildLibraryGraph(...).nodes`). */
    nodes: ReadonlyMap<string, LibraryGraphNode>;
    /** 배포하는 프로젝트의 폴더(= 그래프 루트). */
    rootDir: string;
    /** `.gpr` 에 ProjectStart 가 있는가 — 없으면(그룹) 출발점을 알 수 없어 건너뛴다. */
    runnable: boolean;
    /** 이 프로젝트가 자기 컴파일 루트인가 — 내장형 하위 패키지면 건너뛴다. */
    compileRootIsSelf: boolean;
    /** 이 배포가 올리는 폴더들(프로젝트 폴더 + 함께 올리는 라이브러리). 이 안의 라이브러리 파일만 뺄 수 있다. */
    roots: readonly PreprocessRoot[];
    keepFiles: readonly string[];
    isSource(file: string): boolean;
    /** 파일 내용(latin1 로 읽은 텍스트). 못 읽으면 undefined — 그 파일은 빼지 않는다. */
    readText(file: string): string | undefined;
}

export interface TreeShakePlan {
    /** 건너뛴 이유(실행 불가·내장형). 있으면 아래 목록은 비어 있다. */
    skipped?: string;
    /** 뺄 수 있는 후보(분석한 라이브러리 파일) 수. */
    candidates: number;
    excluded: ExcludedSource[];
    /** `.gpr` 경로 키(`normalizePathKey`) → 그 경로와 제외 파일의 `ProjectSource` 줄을 뺀 텍스트(latin1). */
    gprRewrites: Map<string, { gprPath: string; text: string }>;
    /** 어느 후보에도 맞지 않은 keepFiles 항목 — 오타 알림용. */
    unmatchedKeep: string[];
}

/** 파일이 들어 있는 업로드 단위(가장 깊은 것)와 원격 경로. */
export function remotePathFor(file: string, roots: readonly PreprocessRoot[]): string | undefined {
    const owner = roots
        .filter(r => isPathUnder(file, r.localDir))
        .sort((a, b) => normalizePathKey(b.localDir).length - normalizePathKey(a.localDir).length)[0];
    if (!owner) { return undefined; }
    const rel = path.relative(owner.localDir, file).replace(/\\/g, '/');
    return `${owner.remoteDir.replace(/\/+$/, '')}/${rel}`;
}

function keepMatches(entry: string, file: string, nodeDir: string, info: SourceReferenceInfo): boolean {
    const e = entry.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
    const base = path.basename(file).toLowerCase();
    if (e === base || e === base.replace(/\.[^.]*$/, '')) { return true; }
    const rel = path.relative(nodeDir, file).replace(/\\/g, '/').toLowerCase();
    if (e === rel || rel.endsWith(`/${e}`)) { return true; }
    return info.containers.some(c => c.toLowerCase() === e);
}

function countTextLines(text: string): number {
    return text.length === 0 ? 0 : text.split(/\r\n|\n|\r/).length;
}

export function planTreeShake(input: TreeShakeInput): TreeShakePlan {
    const plan: TreeShakePlan = { candidates: 0, excluded: [], gprRewrites: new Map(), unmatchedKeep: [] };
    if (!input.runnable) {
        plan.skipped = '.gpr 에 ProjectStart 가 없어(그룹) 출발점을 정할 수 없습니다 — 미사용 제외를 건너뜁니다.';
        return plan;
    }
    if (!input.compileRootIsSelf) {
        plan.skipped = '내장형 하위 패키지는 컴파일 루트가 따로 있어 미사용 제외를 건너뜁니다.';
        return plan;
    }
    const rootKey = normalizePathKey(input.rootDir);
    const infos = new Map<string, SourceReferenceInfo>();
    const texts = new Map<string, { file: string; text: string; node: LibraryGraphNode }>();
    const candidateKeys: string[] = [];
    const roots: string[] = [];

    for (const [nodeKey, node] of input.nodes) {
        const canExclude = nodeKey !== rootKey && input.roots.some(r => isPathUnder(node.dir, r.localDir));
        for (const file of node.sources) {
            if (!input.isSource(file)) { continue; }
            const key = normalizePathKey(file);
            if (infos.has(key)) { continue; }
            const text = input.readText(file);
            if (text === undefined) {
                // 출발점 쪽 파일을 못 읽으면 그 참조를 놓쳐 필요한 파일을 뺄 수 있다 — 통째로 건너뛴다(후보는 그냥 남긴다).
                if (!canExclude) {
                    plan.skipped = `소스를 읽지 못해 참조를 확인할 수 없습니다(${path.basename(file)}) — 미사용 제외를 건너뜁니다.`;
                    plan.candidates = 0;
                    return plan;
                }
                continue;
            }
            infos.set(key, analyzeSourceReferences(text, file));
            texts.set(key, { file, text, node });
            if (canExclude) { candidateKeys.push(key); } else { roots.push(key); }
        }
    }
    plan.candidates = candidateKeys.length;

    const matchedKeep = new Set<string>();
    for (const key of candidateKeys) {
        const { file, node } = texts.get(key)!;
        for (const entry of input.keepFiles) {
            if (keepMatches(entry, file, node.dir, infos.get(key)!)) {
                roots.push(key);
                matchedKeep.add(entry);
            }
        }
    }
    plan.unmatchedKeep = input.keepFiles.filter(e => !matchedKeep.has(e));

    const reach = computeReachableSources(infos, roots);
    const excludedKeys = new Set<string>();
    for (const key of candidateKeys) {
        if (reach.has(key)) { continue; }
        const { file, text } = texts.get(key)!;
        excludedKeys.add(key);
        plan.excluded.push({
            file,
            remotePath: remotePathFor(file, input.roots) ?? file,
            bytes: Buffer.byteLength(text, 'latin1'),
            lines: countTextLines(text),
            declared: infos.get(key)!.declared,
        });
    }
    if (excludedKeys.size === 0) { return plan; }

    for (const node of input.nodes.values()) {
        if (!node.sources.some(s => excludedKeys.has(normalizePathKey(s)))) { continue; }
        const text = input.readText(node.gprPath);
        const rewritten = text === undefined ? undefined : rewriteGprWithout(node.gprPath, text, excludedKeys);
        if (rewritten !== undefined) { plan.gprRewrites.set(normalizePathKey(node.gprPath), { gprPath: node.gprPath, text: rewritten }); }
    }
    return plan;
}

/**
 * `.gpr` 텍스트에서 제외 파일을 가리키는 `ProjectSource` 줄만 뺀다 — 나머지 줄·줄바꿈·파일 끝 개행은 그대로.
 * 뺄 줄이 없으면 undefined. 경로 해석은 `resolveGprSourcePaths` 와 같은 규칙(.gpr 폴더 기준, `\`·`/` 허용).
 */
export function rewriteGprWithout(gprPath: string, gprText: string, excludedKeys: ReadonlySet<string>): string | undefined {
    const parsed = parseGprText(gprText);
    const baseDir = path.dirname(path.resolve(gprPath));
    const drop = new Set<number>();
    for (const entry of parsed.sources) {
        const native = entry.path.trim().replace(/[\\/]+/g, path.sep);
        if (!native) { continue; }
        const full = path.isAbsolute(native) ? path.resolve(native) : path.resolve(baseDir, native);
        if (excludedKeys.has(normalizePathKey(full))) { drop.add(entry.line); }
    }
    if (drop.size === 0) { return undefined; }
    const kept = parsed.lines.filter((_, i) => !drop.has(i));
    return kept.join(parsed.eol) + (parsed.endsWithNewline ? parsed.eol : '');
}

// ─── 결과 요약(작업 기록·MCP 응답) ──────────────────────────────────────────

export interface DeployPreprocessSummary {
    /** 사본을 만들어 그것을 올렸는가. false 면 원본을 올렸다(`note` 가 이유). */
    applied: boolean;
    options: DeployPreprocessOptions;
    /** 사본 위치(워크스페이스 밖). */
    stageDir?: string;
    /** 사본의 소스 파일 수(제외 파일 빼고). */
    sourceFiles: number;
    /** 원본 소스 바이트(제외 파일 포함)와 사본 소스 바이트. */
    sourceBytesBefore: number;
    sourceBytesAfter: number;
    savedBytes: number;
    excluded: { remotePath: string; bytes: number; lines: number }[];
    excludedBytes: number;
    excludedLines: number;
    /** 사본에서 `ProjectSource` 줄을 뺀 `.gpr` 의 원격 경로. */
    rewrittenGpr: string[];
    treeShakeSkipped?: string;
    unmatchedKeepFiles?: string[];
    /** 라이브러리 원격 폴더에 남아 있던 제외 파일을 지운 수(정지 확인 뒤, Upload Only 는 보류). */
    remoteDeleted?: number;
    note?: string;
}

/** `-729 Undefined symbol <name>` 이 제외한 파일의 선언 이름이면 그 파일을, 아니면 일반 안내를 돌려준다. 제외가 없으면 undefined. */
export function preprocessUndefinedSymbolHint(message: string, excluded: readonly Pick<ExcludedSource, 'remotePath' | 'declared'>[]): string | undefined {
    if (excluded.length === 0) { return undefined; }
    const name = /Undefined symbol\*?\s*([A-Za-z_]\w*)/i.exec(message)?.[1]?.toLowerCase();
    const owners = name ? excluded.filter(e => e.declared.includes(name)) : [];
    if (owners.length > 0) {
        return `배포 전처리(미사용 제외)가 이 이름을 선언한 ${owners.map(o => o.remotePath).join(', ')} 을(를) 뺐습니다 — `
            + 'gpl.deploy.preprocess 의 keepFiles 에 추가하거나 excludeUnreachableLibraryFiles 를 끄세요.';
    }
    return `배포 전처리가 라이브러리 파일 ${excluded.length}개를 뺐습니다 — 이 오류가 그 때문이면 gpl.deploy.preprocess 의 keepFiles 에 `
        + '추가하거나 excludeUnreachableLibraryFiles 를 끄세요.';
}
