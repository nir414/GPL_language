/**
 * 배포 단계 — 라이브러리 출처 검사(preflight)와 업로드 뒤 출처 기록의 얇은 접착. 판정은 `libraryPreflight.ts`, SVN 해석은 `libraryVcs.ts`,
 * 출처·해시는 `libraryProvenance.ts`(모두 순수 + 단위 테스트). 이 모듈은 폴더 존재 확인·svn 호출·결과/트레이스 기록만 한다.
 *
 * 위치: 대상 확정(`resolveDeployTarget`) 뒤, 업로드·정지 전. 제어기에 쓰기를 하지 않는 로컬 검사이고(메모리 사전 검사와 같은 자리의 패턴),
 * 기본은 경고만 한다. 설정 `gpl.deploy.libraryPreflight.blockOn` 이 고른 항목만 배포를 멈춘다.
 * svn 이 없거나 실패하면 `vcs:null` 로 두고 계속한다 — 라이브러리 계획 자체가 실패해도 배포를 막지 않는다.
 */

import * as fs from 'fs';
import * as path from 'path';
import { gprPathInDir } from '../../project/sources/projectSources';
import { normalizePathKey } from '../../util/pathKey';
import type { DeployContext } from './deployContext';
import type { DeployProjectInfo } from './deployPrecheck';
import { resolveLibraryUploadPlan } from './deployTargetStage';
import type { DeployTarget } from './deployTargetStage';
import { evaluatePreflight, judgeLibrary, preflightWarning, resolveLibraryPreflightSetting } from './libraryPreflight';
import { buildLibraryProvenance, describeLibraries, summarizeUploadDir } from './libraryProvenance';
import { collectLibraryVcs, createSvnRunner } from './libraryVcs';
import type { LibraryVcsInfo } from './libraryVcs';

interface PreflightLibrary { name: string; localDir: string; remoteDir?: string; folderExists: boolean }

/** 이 배포가 볼 라이브러리 — 함께 올리는 것(계획의 uploads)과 로컬에서 찾지 못한 값(unresolved). 계획을 못 세우면 없음. */
function librariesOf(ctx: DeployContext, project: DeployProjectInfo, target: DeployTarget): PreflightLibrary[] {
    let plan = target.libraryPlan;
    if (!plan && project.gprInfo.libraries.length > 0) {
        try { plan = resolveLibraryUploadPlan(project, ctx.options.projectDir, '/GPL'); } catch { plan = undefined; }
    }
    if (!plan) { return []; }
    return [
        ...plan.uploads.map(u => ({ name: u.raw, localDir: u.localDir, remoteDir: u.remoteDir, folderExists: true })),
        ...plan.unresolved.map(raw => ({ name: raw, localDir: raw, folderExists: false })),
    ];
}

function dirExists(dir: string): boolean {
    try { return fs.statSync(dir).isDirectory(); } catch { return false; }
}

/** true 면 계속, false 면 `ctx.result` 가 확정된 상태(설정이 막은 경우만). */
export async function runLibraryPreflight(ctx: DeployContext, project: DeployProjectInfo, target: DeployTarget): Promise<boolean> {
    const { cfg, result, pushTrace, host, io, options } = ctx;
    // autoOnSave 게이트 경로는 저장마다 돈다 — 라이브러리마다 svn 을 여러 번 부르면 저장이 느려지므로 건너뛴다(명시 배포에서만 검사).
    if (options.autoGate) { return true; }
    let libs: PreflightLibrary[];
    try { libs = librariesOf(ctx, project, target); } catch { return true; }
    if (libs.length === 0) { return true; }
    try {
        const run = host.svnRunner ?? createSvnRunner();
        const vcsList = await Promise.all(libs.map(l => (l.folderExists && dirExists(l.localDir) ? collectLibraryVcs(l.localDir, run) : Promise.resolve(null))));
        ctx.libraryVcs = new Map(libs.map((l, i) => [normalizePathKey(l.localDir), vcsList[i]] as [string, LibraryVcsInfo | null]));
        const entries = libs.map((l, i) => judgeLibrary({
            name: l.name,
            localPath: l.localDir,
            folderExists: l.folderExists && dirExists(l.localDir),
            gprExists: l.folderExists && dirExists(l.localDir) && !!gprPathInDir(l.localDir),
            vcs: vcsList[i],
            previous: l.remoteDir ? io.getLibraryProvenance?.(cfg.ip, l.remoteDir) : undefined,
        }));
        const evaluated = evaluatePreflight(entries, resolveLibraryPreflightSetting(host.readLibraryPreflightSetting?.(options.projectDir)));
        result.preflight = evaluated;
        const summary = describeLibraries(libs.map((l, i) => ({ name: l.name, vcs: vcsList[i] ? { ...vcsList[i]!, kind: 'svn' as const } : null })));
        if (summary) { result.librarySummary = summary; pushTrace(`│ ${summary}`); }
        for (const e of entries) {
            const warning = preflightWarning(e);
            if (warning) { result.precheckWarnings.push(warning); pushTrace(`│ ⚠ ${warning}`); }
            if (e.previousUpload === 'unknown' && e.issues.length === 0) { pushTrace(`│   ${e.name}: 이전 업로드 출처 확인 불가(unknown) — 일치로 보지 않습니다.`); }
        }
        if (evaluated.blocked) {
            const message = `라이브러리 검사가 배포를 막았습니다(설정 gpl.deploy.libraryPreflight.blockOn: ${evaluated.blocked.on.join(', ')}) — ${evaluated.blocked.reasons.join(' / ')}`;
            pushTrace(`✘ ${message}`);
            result.failedPhase = 'UPLOAD';
            result.failedCommand = 'Library preflight';
            result.failedStatusMessage = message;
            return false;
        }
    } catch (err: any) {
        pushTrace(`│ ⚠ 라이브러리 검사 실패(무시하고 진행): ${err?.message ?? err}`);
    }
    return true;
}

/**
 * 함께 올린 라이브러리 하나의 출처를 결과에 더하고 기록한다(업로드 성공 직후). `uploadDir` 은 **실제로 올린 폴더**(전처리 사본이면 사본)다.
 * 해시를 못 구해도 배포는 계속한다(트레이스 한 줄).
 */
export function recordUploadedLibrary(ctx: DeployContext, lib: { raw: string; localDir: string; remoteDir: string }, uploadDir: string): void {
    const { cfg, result, pushTrace, io } = ctx;
    try {
        const vcs = ctx.libraryVcs?.get(normalizePathKey(lib.localDir)) ?? null;
        const prov = buildLibraryProvenance({
            name: lib.raw, localPath: path.resolve(lib.localDir), remoteDir: lib.remoteDir, vcs, uploaded: summarizeUploadDir(uploadDir),
        });
        (result.libraries ??= []).push(prov);
        io.recordLibraryProvenance?.(cfg.ip, lib.remoteDir, prov);
    } catch (err: any) {
        pushTrace(`│ ⚠ 라이브러리 ${lib.raw} 출처 기록 실패(무시): ${err?.message ?? err}`);
    }
}
