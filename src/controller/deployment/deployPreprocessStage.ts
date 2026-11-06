/**
 * 배포 전처리 단계 — 업로드 직전에 워크스페이스 밖(OS 임시 폴더)에 전처리한 사본을 만들고, 업로드가 원본 대신 그 사본을
 * 올리게 한다. 계획(설정 해석·미사용 제외·`.gpr` 고쳐 쓰기)은 `deployPreprocess.ts`, 줄 경량화는 `project/sources/sourceMinify.ts`.
 *
 * 경계:
 * - direct `/GPL` 업로드에서만 한다. 클래식 경로(flash 업로드 + Load)는 사본이 `/flash/projects` 에 남으므로 하지 않는다.
 * - 워크스페이스·로컬 `.gpr` 는 읽기만 한다. Save to Flash 는 이 사본이 아니라 로컬 원본을 미러한다(`saveToFlashCommand.ts`).
 * - 사본을 만들지 못하면 원본을 올리고 경고만 남긴다 — 원본은 언제나 올바른 입력이다.
 * - 줄 수를 지키므로 컴파일 오류·중단점·Show Stack 의 줄은 원본과 같다. 컴파일 스냅샷(GitHub #21)도 원본 기준 그대로다.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { sourceExtensionsFrom } from '../../project/gpr/gprFolderSync';
import { findCompileRootGpr } from '../../project/gpr/dependencyModel';
import { buildLibraryGraph } from '../../project/sources/projectSources';
import { minifyGplBuffer } from '../../project/sources/sourceMinify';
import { estimateSourceCompileBytes } from '../../project/sources/compileCostModel';
import { formatBytes } from '../../util/formatBytes';
import { normalizePathKey } from '../../util/pathKey';
import { manifestFileKey } from '../files/syncManifest';
import type { SyncManifestFiles } from '../files/syncManifest';
import type { RemoteFileRef } from '../files/ftpClient';
import type { DeployContext } from './deployContext';
import type { DeployProjectInfo } from './deployPrecheck';
import type { DeployTarget } from './deployTargetStage';
import { snapshotProjectFiles } from './deployRecordCore';
import type { FileStamp } from './deployRecordCore';
import {
    describePreprocessOptions,
    isPreprocessActive,
    planMemberShake,
    planTreeShake,
    remotePathFor,
    resolvePreprocessOptions,
    SUMMARY_MEMBER_LIMIT,
} from './deployPreprocess';
import type {
    DeployPreprocessOptions, DeployPreprocessSummary, ExcludedSource, MemberShakePlan, PreprocessRoot, TreeShakeInput, TreeShakePlan,
} from './deployPreprocess';

/** 업로드 단계가 쓰는 전처리 결과 — 원본 폴더 → 사본 폴더 대응과 제외 목록. */
export interface PreparedPreprocess {
    readonly options: DeployPreprocessOptions;
    readonly summary: DeployPreprocessSummary;
    readonly excluded: readonly ExcludedSource[];
    /** 컴파일 `-729` 안내용 — 뺀 파일과 지운 선언(이름). */
    readonly hintEntries: readonly Pick<ExcludedSource, 'remotePath' | 'declared'>[];
    /** 원본 업로드 폴더 → 올릴 폴더(사본). 모르는 폴더면 원본 그대로. */
    uploadDirFor(localDir: string): string;
    /** 원격 경로가 미사용 제외 파일인가(미러 삭제 로그 구분용). */
    isExcludedRemote(remotePath: string): boolean;
    /**
     * 라이브러리 원격 폴더에 예전 업로드로 남아 있는 제외 파일 — 동기화 기록에 있는 것만(없으면 원격에 있다고 말할 수 없다).
     * `relativePath` 는 기록 키(`manifestFileKey`)다.
     */
    staleExcludedRefs(remoteDir: string, manifest: Readonly<SyncManifestFiles>): RemoteFileRef[];
    /** 배포 증적용 — 원본 폴더의 지금 파일을 같은 규칙으로 전처리했을 때의 지문(제외 파일 없음). */
    snapshot(localDir: string): Record<string, FileStamp>;
}

/** 사본 위치 — `<tmp>/gpl-controller/preprocess/<제어기>/<원격 경로>`. 원격 폴더마다 하나라 배포끼리 겹치지 않는다(배포 잠금이 제어기 단위). */
export function preprocessStageDir(ip: string, remoteDir: string, base = os.tmpdir()): string {
    const host = ip.replace(/[^A-Za-z0-9._-]/g, '_') || 'controller';
    return path.join(base, 'gpl-controller', 'preprocess', host, ...remoteDir.split('/').filter(p => p && p !== '.' && p !== '..'));
}

/** 폴더를 비운다 — `fs.rmSync` 는 비ASCII 경로에서 Node 가 예외 없이 죽는 사례가 있어(Win, v24) unlink/rmdir 로 직접 지운다. */
function clearDir(dir: string): void {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.isSymbolicLink()) {
            clearDir(full);
            fs.rmdirSync(full);
        } else {
            fs.unlinkSync(full);
        }
    }
}

/** 업로드 대상 파일 목록 — `ftpClient.getAllFiles` 와 같은 규칙(점으로 시작하는 항목 제외, 재귀). */
function listUploadFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) { continue; }
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { out.push(...listUploadFiles(full)); } else { out.push(full); }
    }
    return out;
}

function readLatin1(file: string): string | undefined {
    try { return fs.readFileSync(file).toString('latin1'); } catch { return undefined; }
}

/**
 * 전처리 사본을 만든다. 옵션이 꺼져 있으면 undefined(아무 기록도 남기지 않음). 켜져 있지만 할 수 없거나(클래식 경로) 실패하면
 * `result.preprocess.applied=false` 와 이유를 남기고 undefined — 호출측은 원본을 올린다.
 */
export function preparePreprocess(ctx: DeployContext, project: DeployProjectInfo, target: DeployTarget): PreparedPreprocess | undefined {
    const { options, result, pushTrace, host } = ctx;
    const opts = resolvePreprocessOptions(host.readPreprocessSetting?.(options.projectDir), project.projectName, options.preprocessOverride);
    if (!isPreprocessActive(opts)) { return undefined; }
    const label = describePreprocessOptions(opts);
    const notApplied = (note: string): undefined => {
        result.preprocess = {
            applied: false, options: opts, sourceFiles: 0, sourceBytesBefore: 0, sourceBytesAfter: 0, savedBytes: 0,
            excluded: [], excludedBytes: 0, excludedLines: 0, rewrittenGpr: [], note,
        };
        pushTrace(`│ ⚠ 전처리(${label}) 생략 — ${note}`);
        return undefined;
    };
    if (!target.directActive) {
        return notApplied('클래식 경로(flash 업로드 + Load)에는 전처리 사본을 올리지 않습니다 — 원본을 올립니다.');
    }
    try {
        return buildPrepared(ctx, project, target, opts);
    } catch (err: any) {
        const note = `전처리 사본을 만들지 못해 원본을 올립니다: ${err?.message ?? err}`;
        result.precheckWarnings.push(note);
        return notApplied(note);
    }
}

/** 미사용 제외(파일)·선언 단위 제거 계획 — 켜진 것만. 그래프는 한 번만 만든다. */
function planShakes(project: DeployProjectInfo, roots: PreprocessRoot[], opts: DeployPreprocessOptions, isSource: (f: string) => boolean)
    : { shake?: TreeShakePlan; members?: MemberShakePlan; unitSources?: string[] } {
    if (!opts.excludeUnreachableLibraryFiles && !opts.removeUnusedMembers) { return {}; }
    const graph = buildLibraryGraph(project.gprPath, project.gprText);
    const compileRoot = findCompileRootGpr(project.gprPath);
    const input: TreeShakeInput = {
        nodes: graph.nodes,
        rootDir: graph.rootDir,
        runnable: !!project.gprInfo.projectStart,
        compileRootIsSelf: !compileRoot || normalizePathKey(compileRoot) === normalizePathKey(project.gprPath),
        roots,
        keepFiles: opts.keepFiles,
        isSource,
        readText: readLatin1,
    };
    const shake = opts.excludeUnreachableLibraryFiles ? planTreeShake(input) : undefined;
    const excludedKeys = new Set((shake?.excluded ?? []).map(e => normalizePathKey(e.file)));
    const members = opts.removeUnusedMembers ? planMemberShake(input, excludedKeys) : undefined;
    const unitSources = [...new Set([...graph.nodes.values()].flatMap(n => n.sources).filter(isSource))];
    return { shake, members, unitSources };
}

function buildPrepared(ctx: DeployContext, project: DeployProjectInfo, target: DeployTarget, opts: DeployPreprocessOptions): PreparedPreprocess {
    const { options, cfg, result, pushTrace, host } = ctx;
    const roots: PreprocessRoot[] = [
        { localDir: path.resolve(options.projectDir), remoteDir: target.ftpProjectDir },
        ...(target.libraryPlan?.uploads ?? []).map(u => ({ localDir: path.resolve(u.localDir), remoteDir: u.remoteDir })),
    ];
    const exts = sourceExtensionsFrom(host.readSourceExtensionsSetting()).map(e => e.toLowerCase());
    const isSource = (file: string): boolean => exts.includes(path.extname(file).toLowerCase());
    const minifyOpts = { stripComments: opts.stripComments, trimWhitespace: opts.trimWhitespace };
    const { shake, members, unitSources } = planShakes(project, roots, opts, isSource);
    const excluded = shake?.excluded ?? [];
    const excludedKeys = new Set(excluded.map(e => normalizePathKey(e.file)));
    const excludedRemote = new Set(excluded.map(e => e.remotePath.toLowerCase()));

    /** 원본 파일 → 올릴 내용. null 이면 올리지 않는다(미사용 제외). */
    const transform = (file: string): Buffer | null => {
        const key = normalizePathKey(file);
        if (excludedKeys.has(key)) { return null; }
        const gpr = shake?.gprRewrites.get(key);
        if (gpr !== undefined) { return Buffer.from(gpr.text, 'latin1'); }
        const content = fs.readFileSync(file);
        return isSource(file) ? minifyGplBuffer(content, minifyOpts, members?.ranges.get(key) ?? []) : content;
    };

    const stageOf = new Map<string, string>();
    const bytes = { sourceFiles: 0, before: 0, after: 0 };
    for (const root of roots) {
        const stageDir = preprocessStageDir(cfg.ip, root.remoteDir);
        fs.mkdirSync(stageDir, { recursive: true });
        clearDir(stageDir);
        for (const file of listUploadFiles(root.localDir)) {
            const source = isSource(file);
            if (source) { bytes.before += fs.statSync(file).size; }
            const out = transform(file);
            if (out === null) { continue; }
            const dest = path.join(stageDir, path.relative(root.localDir, file));
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, out);
            if (source) { bytes.sourceFiles++; bytes.after += out.length; }
        }
        stageOf.set(normalizePathKey(root.localDir), stageDir);
    }

    const summary = buildSummary(cfg.ip, opts, roots, bytes, shake, members);
    if (unitSources) { summary.estimatedCompile = estimateUnitCompile(unitSources, transform); }
    result.preprocess = summary;
    tracePreprocess(pushTrace, summary, shake, members);

    const hintEntries = [
        ...excluded,
        ...(members?.removed ?? []).map(r => ({
            remotePath: `${r.remotePath}:${r.startLine + 1} (${r.container ? `${r.container}.` : ''}${r.name})`,
            declared: [r.name.toLowerCase()],
        })),
    ];
    return {
        options: opts,
        summary,
        excluded,
        hintEntries,
        uploadDirFor: localDir => stageOf.get(normalizePathKey(localDir)) ?? localDir,
        isExcludedRemote: remotePath => excludedRemote.has(remotePath.toLowerCase()),
        staleExcludedRefs: (remoteDir, manifest) => {
            const prefix = `${remoteDir.replace(/\/+$/, '')}/`.toLowerCase();
            const refs: RemoteFileRef[] = [];
            for (const e of excluded) {
                if (!e.remotePath.toLowerCase().startsWith(prefix)) { continue; }
                const key = manifestFileKey(e.remotePath.slice(prefix.length));
                if (key in manifest) { refs.push({ remotePath: e.remotePath, relativePath: key }); }
            }
            return refs;
        },
        snapshot: localDir => {
            const stamps = snapshotProjectFiles(localDir);
            for (const rel of Object.keys(stamps)) {
                const out = transform(path.join(localDir, rel));
                if (out === null) { delete stamps[rel]; continue; }
                stamps[rel] = { size: out.length, mtimeMs: stamps[rel].mtimeMs, sha1: crypto.createHash('sha1').update(out).digest('hex') };
            }
            return stamps;
        },
    };
}

/**
 * 컴파일 단위 전체의 컴파일 메모리 추정 — 원본과 사본(제외 파일은 0). 단가는 compileCostModel(Sample Prep 실측)이고 **추정**이다.
 * 못 읽는 파일은 양쪽에서 뺀다.
 */
function estimateUnitCompile(sources: readonly string[], transform: (file: string) => Buffer | null): NonNullable<DeployPreprocessSummary['estimatedCompile']> {
    let before = 0;
    let after = 0;
    for (const file of sources) {
        const text = readLatin1(file);
        if (text === undefined) { continue; }
        before += estimateSourceCompileBytes(text);
        let out: Buffer | null;
        try { out = transform(file); } catch { out = Buffer.from(text, 'latin1'); }
        if (out !== null) { after += estimateSourceCompileBytes(out.toString('latin1')); }
    }
    return { before, after, saved: before - after };
}

/** 범위들의 합집합 줄 수(겹치는 범위 — Module 껍데기와 그 안 선언 — 를 두 번 세지 않는다). */
function unionLineCount(ranges: ReadonlyMap<string, [number, number][]>): number {
    let total = 0;
    for (const list of ranges.values()) {
        const sorted = [...list].sort((a, b) => a[0] - b[0]);
        let end = -1;
        for (const [s, e] of sorted) {
            if (e <= end) { continue; }
            total += e - Math.max(s, end + 1) + 1;
            end = e;
        }
    }
    return total;
}

function buildSummary(
    ip: string,
    opts: DeployPreprocessOptions,
    roots: PreprocessRoot[],
    bytes: { sourceFiles: number; before: number; after: number },
    shake: TreeShakePlan | undefined,
    members: MemberShakePlan | undefined,
): DeployPreprocessSummary {
    const excluded = shake?.excluded ?? [];
    const removed = members?.removed ?? [];
    return {
        applied: true,
        options: opts,
        stageDir: preprocessStageDir(ip, ''),
        sourceFiles: bytes.sourceFiles,
        sourceBytesBefore: bytes.before,
        sourceBytesAfter: bytes.after,
        savedBytes: bytes.before - bytes.after,
        excluded: excluded.map(e => ({ remotePath: e.remotePath, bytes: e.bytes, lines: e.lines })),
        excludedBytes: excluded.reduce((n, e) => n + e.bytes, 0),
        excludedLines: excluded.reduce((n, e) => n + e.lines, 0),
        rewrittenGpr: [...(shake?.gprRewrites.values() ?? [])].map(g => remotePathFor(g.gprPath, roots) ?? g.gprPath),
        ...(shake?.skipped ? { treeShakeSkipped: shake.skipped } : {}),
        // 선언 단위 제거가 켜져 있으면 keepFiles 에 선언 이름이 섞이므로 "맞는 파일 없음" 경고를 내지 않는다.
        ...(shake && shake.unmatchedKeep.length > 0 && !opts.removeUnusedMembers ? { unmatchedKeepFiles: shake.unmatchedKeep } : {}),
        ...(members ? {
            removedMemberCount: removed.length,
            removedMemberLines: unionLineCount(members.ranges),
            removedMembers: removed.slice(0, SUMMARY_MEMBER_LIMIT).map(r => ({
                remotePath: r.remotePath, kind: r.kind, name: r.name, ...(r.container ? { container: r.container } : {}), lines: r.endLine - r.startLine + 1,
            })),
            ...(members.skipped ? { memberShakeSkipped: members.skipped } : {}),
            ...(members.irregular.length > 0 ? { memberShakeIrregular: members.irregular } : {}),
        } : {}),
    };
}

function tracePreprocess(pushTrace: (line: string) => void, s: DeployPreprocessSummary, shake: TreeShakePlan | undefined, members: MemberShakePlan | undefined): void {
    const pct = s.sourceBytesBefore > 0 ? ` (−${Math.round((s.savedBytes / s.sourceBytesBefore) * 100)}%)` : '';
    pushTrace(`│ ✂ 전처리(${describePreprocessOptions(s.options)}): 소스 ${formatBytes(s.sourceBytesBefore)} → ${formatBytes(s.sourceBytesAfter)}${pct}, `
        + `사본 ${s.stageDir} (워크스페이스는 그대로)`);
    if (shake?.skipped) { pushTrace(`│   미사용 제외 생략 — ${shake.skipped}`); }
    if (shake && !shake.skipped) {
        pushTrace(`│   미사용 제외: 라이브러리 파일 ${shake.candidates}개 중 ${s.excluded.length}개 뺌`
            + (s.excluded.length > 0 ? ` (${s.excludedLines}줄, ${formatBytes(s.excludedBytes)})` : ''));
        for (const e of s.excluded.slice(0, 12)) { pushTrace(`│   − ${e.remotePath}`); }
        if (s.excluded.length > 12) { pushTrace(`│   … 외 ${s.excluded.length - 12}개`); }
        for (const g of s.rewrittenGpr) { pushTrace(`│   ✎ ${g} — 사본에서 제외 파일의 ProjectSource 줄을 뺌`); }
    }
    if (members?.skipped) { pushTrace(`│   선언 단위 제거 생략 — ${members.skipped}`); }
    if (members && !members.skipped) {
        pushTrace(`│   선언 단위 제거: 라이브러리 선언 ${members.candidateMembers}개 중 ${s.removedMemberCount ?? 0}개를 빈 줄로(${s.removedMemberLines ?? 0}줄, 줄 번호 유지)`);
        for (const r of members.removed.slice(0, 20)) {
            pushTrace(`│   − ${r.remotePath}:${r.startLine + 1} ${r.kind} ${r.container ? `${r.container}.` : ''}${r.name}`);
        }
        if (members.removed.length > 20) { pushTrace(`│   … 외 ${members.removed.length - 20}개(전체는 결과 preprocess.removedMembers, 상한 ${SUMMARY_MEMBER_LIMIT})`); }
        for (const f of members.irregular) { pushTrace(`│   ⚠ 구조를 읽지 못해 손대지 않음: ${f.remotePath} — ${f.reason}`); }
    }
    if (s.estimatedCompile) {
        pushTrace(`│   컴파일 메모리 추정: ${formatBytes(s.estimatedCompile.before)} → ${formatBytes(s.estimatedCompile.after)} (−${formatBytes(s.estimatedCompile.saved)}, 실측 단가 기반 추정)`);
    }
    if (s.unmatchedKeepFiles) { pushTrace(`│   ⚠ keepFiles 중 맞는 라이브러리 파일이 없는 항목: ${s.unmatchedKeepFiles.join(', ')}`); }
}
