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
 * - `removeUnusedMembers`: 남은 라이브러리 파일 안에서 닿지 않는 선언(Sub·Function·Property·Class·Const·변수·Delegate)의 줄을 빈 줄로
 *   바꾼다(판정: `project/sources/memberScan.ts`·`memberReachability.ts`). 줄 번호는 그대로다.
 * - `keepFiles`: 늘 포함할 라이브러리 파일(파일 이름·확장자 뺀 이름·라이브러리 폴더 기준 경로·Module/Class 이름)과 선언(`Name`·`Container.Name`).
 */

import * as path from 'path';
import { parseGprText } from '../../project/gpr/gprSync';
import type { LibraryGraphNode } from '../../project/sources/projectSources';
import { analyzeSourceReferences, computeReachableSources } from '../../project/sources/sourceReachability';
import type { ReachReason, SourceReferenceInfo } from '../../project/sources/sourceReachability';
import { scanSourceMembers } from '../../project/sources/memberScan';
import { computeMemberReachability } from '../../project/sources/memberReachability';
import type { MemberUnitFile, RemovedMember } from '../../project/sources/memberReachability';
import { isPathUnder, normalizePathKey } from '../../util/pathKey';

export interface DeployPreprocessOptions {
    stripComments: boolean;
    trimWhitespace: boolean;
    excludeUnreachableLibraryFiles: boolean;
    removeUnusedMembers: boolean;
    /** 늘 포함할 라이브러리 파일(머리말 참고). 설정·프로젝트별·호출 인자가 합쳐진다. */
    keepFiles: string[];
}

const FLAG_KEYS = ['stripComments', 'trimWhitespace', 'excludeUnreachableLibraryFiles', 'removeUnusedMembers'] as const;

export function disabledPreprocess(): DeployPreprocessOptions {
    return { stripComments: false, trimWhitespace: false, excludeUnreachableLibraryFiles: false, removeUnusedMembers: false, keepFiles: [] };
}

export function isPreprocessActive(opts: DeployPreprocessOptions | undefined): boolean {
    return !!opts && (opts.stripComments || opts.trimWhitespace || opts.excludeUnreachableLibraryFiles || opts.removeUnusedMembers);
}

/** 켜진 항목 이름 — 트레이스·보고용(`stripComments+excludeUnreachableLibraryFiles`). */
export function describePreprocessOptions(opts: DeployPreprocessOptions): string {
    const on = FLAG_KEYS.filter(k => opts[k]);
    return on.length > 0 ? on.join('+') : 'off';
}


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

/**
 * 소스 파일 끝에 줄바꿈이 없으면 그 파일의 줄바꿈 방식(첫 줄바꿈 기준, 없으면 CRLF)으로 하나 붙인다 — 제어기 Compile 이 마지막 줄 뒤 LF 가 없는
 * 파일에서 `-505 Unexpected end of file` 로 실패한다(Sample Prep 2026-11-05 실측 보고). 빈 내용·이미 줄바꿈으로 끝나면 그대로.
 * 줄 수는 변하지 않는다(마지막 줄의 끝을 닫을 뿐).
 */
export function ensureTrailingNewline(content: Buffer): Buffer {
    if (content.length === 0) { return content; }
    const last = content[content.length - 1];
    if (last === 0x0a || last === 0x0d) { return content; }
    const lf = content.indexOf(0x0a);
    const eol = lf > 0 && content[lf - 1] === 0x0d ? '\r\n' : (lf >= 0 ? '\n' : '\r\n');
    return Buffer.concat([content, Buffer.from(eol, 'latin1')]);
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

/** 빼지 않고 남긴 라이브러리 후보 파일과 그 이유("왜 남았나" 보고용). */
export interface KeptSource {
    /** 로컬 절대 경로. */
    file: string;
    remotePath: string;
    /** 예: `name CodeText referenced from /GPL/Gantry/Gantry_Host.gpl:112`. */
    reason: string;
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
    /** 후보 중 남긴 파일과 이유(전체 — 요약에는 상한을 둔다). */
    kept: KeptSource[];
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
    const plan: TreeShakePlan = { candidates: 0, excluded: [], kept: [], gprRewrites: new Map(), unmatchedKeep: [] };
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
            const info = analyzeSourceReferences(text, file);
            infos.set(key, info);
            texts.set(key, { file, text, node });
            // 모듈 Init 은 참조 없이 자동 호출되므로(부작용이 있을 수 있다) 그 파일은 빼지 않는다.
            if (canExclude && !info.hasModuleInit) { candidateKeys.push(key); } else { roots.push(key); }
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

    const reasons = new Map<string, ReachReason>();
    const reach = computeReachableSources(infos, roots, reasons);
    const remoteOf = (key: string): string => {
        const f = texts.get(key)?.file;
        return f ? (remotePathFor(f, input.roots) ?? f) : key;
    };
    const excludedKeys = new Set<string>();
    for (const key of candidateKeys) {
        if (reach.has(key)) {
            const { file } = texts.get(key)!;
            plan.kept.push({ file, remotePath: remotePathFor(file, input.roots) ?? file, reason: describeKeepReason(reasons.get(key), remoteOf) });
            continue;
        }
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

/** 남긴 이유를 사람이 읽는 한 줄로. */
export function describeKeepReason(why: ReachReason | undefined, remoteOf: (key: string) => string): string {
    if (!why) { return 'reachable'; }
    switch (why.kind) {
        case 'root': return 'keepFiles';
        case 'no-declarations': return 'no declarations found (always kept)';
        case 'sibling-module': return `same Module ${why.module} as ${remoteOf(why.via)}`;
        case 'name': return `name ${why.name} referenced from ${remoteOf(why.by)}${why.line ? `:${why.line}` : ''}`;
    }
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

// ─── 선언 단위 미사용 제거 계획 ──────────────────────────────────────────────

export interface PlannedMemberRemoval extends RemovedMember {
    file: string;
    remotePath: string;
}

export interface MemberShakePlan {
    skipped?: string;
    /** 분석한 라이브러리 선언 수(지울 수 있는 파일 기준). */
    candidateMembers: number;
    removed: PlannedMemberRemoval[];
    /** 파일 경로 키(`normalizePathKey`) → 빈 줄로 바꿀 물리 줄 범위. */
    ranges: Map<string, [number, number][]>;
    /** 구조를 읽지 못해 손대지 않은 라이브러리 파일(원격 경로)과 이유. */
    irregular: { remotePath: string; reason: string }[];
}

/** keepFiles 항목이 파일 자체를 가리키는가(파일 이름·확장자 뺀 이름·폴더 기준 경로). 선언 이름은 따로 본다. */
function keepNamesFile(entry: string, file: string, nodeDir: string): boolean {
    const e = entry.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
    const base = path.basename(file).toLowerCase();
    if (e === base || e === base.replace(/\.[^.]*$/, '')) { return true; }
    const rel = path.relative(nodeDir, file).replace(/\\/g, '/').toLowerCase();
    return e === rel || rel.endsWith(`/${e}`);
}

/**
 * 남은(미사용 제외되지 않은) 소스 전체로 선언 그래프를 만들어, 라이브러리 파일 안의 닿지 않는 선언을 고른다.
 * 출발점·후보 규칙은 `planTreeShake` 와 같다 — 실행 프로젝트 소스와 이 배포가 올리지 않는 라이브러리는 손대지 않는다.
 * keepFiles 의 파일 항목은 그 파일 전체를, 이름 항목(`Name`·`Container.Name`)은 그 선언을 남긴다.
 */
export function planMemberShake(input: TreeShakeInput, excludedKeys: ReadonlySet<string> = new Set()): MemberShakePlan {
    const plan: MemberShakePlan = { candidateMembers: 0, removed: [], ranges: new Map(), irregular: [] };
    if (!input.runnable || !input.compileRootIsSelf) {
        plan.skipped = !input.runnable
            ? '.gpr 에 ProjectStart 가 없어(그룹) 출발점을 정할 수 없습니다 — 선언 단위 제거를 건너뜁니다.'
            : '내장형 하위 패키지는 컴파일 루트가 따로 있어 선언 단위 제거를 건너뜁니다.';
        return plan;
    }
    const rootKey = normalizePathKey(input.rootDir);
    const files = new Map<string, MemberUnitFile>();
    const paths = new Map<string, string>();
    for (const [nodeKey, node] of input.nodes) {
        const canRemove = nodeKey !== rootKey && input.roots.some(r => isPathUnder(node.dir, r.localDir));
        for (const file of node.sources) {
            const key = normalizePathKey(file);
            if (!input.isSource(file) || files.has(key) || excludedKeys.has(key)) { continue; }
            const text = input.readText(file);
            if (text === undefined) {
                if (canRemove) { continue; }
                plan.skipped = `소스를 읽지 못해 참조를 확인할 수 없습니다(${path.basename(file)}) — 선언 단위 제거를 건너뜁니다.`;
                return { ...plan, candidateMembers: 0 };
            }
            const scan = scanSourceMembers(text);
            const pinned = input.keepFiles.some(e => keepNamesFile(e, file, node.dir));
            const candidate = canRemove && !pinned && !scan.irregular;
            if (canRemove && scan.irregular) { plan.irregular.push({ remotePath: remotePathFor(file, input.roots) ?? file, reason: scan.irregular }); }
            files.set(key, { scan, candidate });
            paths.set(key, file);
        }
    }
    const result = computeMemberReachability(files, input.keepFiles);
    plan.candidateMembers = result.candidateMembers;
    plan.ranges = result.ranges;
    plan.removed = result.removed.map(r => {
        const file = paths.get(r.fileKey)!;
        return { ...r, file, remotePath: remotePathFor(file, input.roots) ?? file };
    });
    return plan;
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
    /** 후보 중 빼지 않고 남긴 라이브러리 파일과 이유(앞쪽 `SUMMARY_KEPT_LIMIT` 개) — 왜 안 빠졌나를 보고 keepFiles·코드를 조정한다. */
    kept?: { remotePath: string; reason: string }[];
    keptCount?: number;
    excludedBytes: number;
    excludedLines: number;
    /** 사본에서 `ProjectSource` 줄을 뺀 `.gpr` 의 원격 경로. */
    rewrittenGpr: string[];
    treeShakeSkipped?: string;
    unmatchedKeepFiles?: string[];
    /** 라이브러리 원격 폴더에 남아 있던 제외 파일을 지운 수(정지 확인 뒤, Upload Only 는 보류). */
    remoteDeleted?: number;
    /** 선언 단위 제거(`removeUnusedMembers`) — 지운 선언 수·줄 수와 앞쪽 일부 목록(전체는 트레이스). */
    removedMemberCount?: number;
    removedMemberLines?: number;
    removedMembers?: { remotePath: string; kind: string; name: string; container?: string; lines: number }[];
    memberShakeSkipped?: string;
    /**
     * 컴파일 단위 전체의 컴파일 메모리 **추정**(바이트) — 원본·사본. 단가는 `project/sources/compileCostModel.ts`(Sample Prep 2026-11-06 실측).
     * 미사용 제외·선언 단위 제거를 켰을 때만 있다. 실제 값은 Compile 전후 Show Memory 로 확인한다.
     */
    estimatedCompile?: { before: number; after: number; saved: number };
    /** 구조를 읽지 못해 선언 단위 제거를 하지 않은 라이브러리 파일. */
    memberShakeIrregular?: { remotePath: string; reason: string }[];
    note?: string;
}

/** 요약에 싣는 남긴 파일 목록 상한(작업 기록 크기). */
export const SUMMARY_KEPT_LIMIT = 60;

/** 요약에 싣는 지운 선언 목록 상한(작업 기록 크기). */
export const SUMMARY_MEMBER_LIMIT = 100;

/**
 * `-729 Undefined symbol <name>` 이 전처리로 뺀 것(파일 또는 선언)의 이름이면 그것을, 아니면 일반 안내를 돌려준다. 뺀 것이 없으면 undefined.
 * `excluded` 항목: 뺀 파일(선언 이름들) 또는 지운 선언(그 이름 하나, remotePath 에 `파일 (Container.Name)`).
 * `declaredInOriginal` 을 주면, 정의되지 않은 이름(점 표기면 마지막 낱말)이 **전처리 전 원본 소스 어디에도 선언돼 있지 않을 때** 안내를 내지 않는다 —
 * 전처리와 무관한 원본의 미완성 편집이라 "그 때문이면 keepFiles" 가 오히려 헷갈린다(Sample Prep 2026-11-10).
 */
export function preprocessUndefinedSymbolHint(
    message: string,
    excluded: readonly Pick<ExcludedSource, 'remotePath' | 'declared'>[],
    declaredInOriginal?: (name: string) => boolean,
): string | undefined {
    if (excluded.length === 0) { return undefined; }
    const dotted = /Undefined symbol\*?:?\s*([A-Za-z_][\w.]*)/i.exec(message)?.[1]?.toLowerCase();
    const segments = dotted ? dotted.split('.').filter(Boolean) : [];
    const last = segments[segments.length - 1];
    if (last && declaredInOriginal && !declaredInOriginal(last)) { return undefined; }
    const name = segments[0];
    const owners = name ? excluded.filter(e => e.declared.includes(name) || (last !== undefined && e.declared.includes(last))) : [];
    if (owners.length > 0) {
        return `배포 전처리(미사용 제외)가 이 이름을 선언한 ${owners.slice(0, 5).map(o => o.remotePath).join(', ')} 을(를) 뺐습니다 — `
            + 'gpl.deploy.preprocess 의 keepFiles 에 이름을 추가하거나 excludeUnreachableLibraryFiles·removeUnusedMembers 를 끄세요.';
    }
    return `배포 전처리가 라이브러리에서 파일·선언 ${excluded.length}개를 뺐습니다 — 이 오류가 그 때문이면 gpl.deploy.preprocess 의 keepFiles 에 `
        + '추가하거나 excludeUnreachableLibraryFiles·removeUnusedMembers 를 끄세요.';
}
