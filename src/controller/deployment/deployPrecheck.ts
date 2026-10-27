/**
 * 배포 단계 1 — 사전 검사: `.gpr` 읽기/파싱, Project.gpr ↔ 폴더 대조, 프로젝트명 검증(제어기를 건드리지 않는 로컬 검사)과
 * 업로드 전 메모리 측정(`Show Memory`, 경고만). 2026-10-27 `deployService.ts` 의 `deployLocked` 에서 분리.
 * 순수 판정(경고 문구 조립·메모리 메모)은 함수로 노출해 Node 단독 테스트로 고정한다.
 */

import * as path from 'path';
import * as fs from 'fs';
import type { MemoryPrecheck } from '../diagnostics/memoryGuard';
import { parseGpr } from '../protocol/responseParser';
import type { GprInfo } from '../protocol/responseParser';
import { checkProjectName, describeProjectNameProblem } from '../projects/projectNameGuard';
import { checkGprFolderSync, describeGprSyncPlan, sourceExtensionsFrom } from '../../project/gpr/gprFolderSync';
import type { GprSyncPlan } from '../../project/gpr/gprSync';
import type { DeployContext } from './deployContext';

/** 사전 검사가 확정한 로컬 프로젝트 — 이후 단계(대상 결정·헤더·컴파일 후보)가 그대로 쓴다. */
export interface DeployProjectInfo {
    /** 폴더에서 찾은 첫 `.gpr` 의 절대 경로. */
    gprPath: string;
    gprText: string;
    gprInfo: GprInfo;
    /** 로컬 폴더명 — 클래식 경로의 Load 인자·Compile 후보. */
    folderName: string;
    /** `.gpr` 의 프로젝트명(없으면 폴더명) — Compile/Load/Start/Unload 인자. */
    projectName: string;
}

/** Project.gpr 목록이 폴더와 다를 때의 경고 문구(결과 `precheckWarnings` 와 트레이스에 같은 문장). */
export function gprSyncMismatchNote(plan: GprSyncPlan): string {
    return `Project.gpr 소스 목록이 폴더와 다릅니다 — ${describeGprSyncPlan(plan)}. 목록에 없는 파일은 컴파일되지 않고, `
        + '목록에만 있는 파일은 Compile 을 실패시킵니다. 「GPL: Project.gpr 소스 목록 동기화」(.gpr 우클릭)로 맞추세요.';
}

/**
 * 업로드 전 메모리 측정의 경고 메모. warning/critical 은 "실행 중 앱 포함" 단서를 붙이고, unknown 은 측정 실패 문장 그대로,
 * ok 는 undefined(아무것도 남기지 않는다).
 */
export function preUploadMemoryNote(check: MemoryPrecheck): string | undefined {
    if (check.level === 'warning' || check.level === 'critical') {
        return `업로드 전 측정 — ${check.message} (실행 중인 앱이 쓰는 메모리가 포함된 값입니다. 정지 뒤 Compile 직전에 다시 측정합니다.)`;
    }
    if (check.level === 'unknown') {
        return check.message;
    }
    return undefined;
}

/**
 * `.gpr` 파싱 → Project.gpr 대조(경고) → 프로젝트명 검증. 실패하면 `ctx.result` 에 failedPhase 'UPLOAD' 를 적고 undefined.
 * FTP 업로드나 1402 명령을 하나도 보내기 전의 로컬 검사다.
 */
export function readProjectForDeploy(ctx: DeployContext): DeployProjectInfo | undefined {
    const { options, result, pushTrace } = ctx;

    // ── .gpr 파싱 ──────────────────────────────

    const gprFiles = fs.readdirSync(options.projectDir).filter(f => f.toLowerCase().endsWith('.gpr'));
    if (gprFiles.length === 0) {
        pushTrace('✘ No .gpr file found in project directory');
        result.failedPhase = 'UPLOAD';
        result.failedCommand = 'Read .gpr';
        result.failedStatusMessage = 'No .gpr file found in project directory';
        return undefined;
    }

    const gprPath = path.join(options.projectDir, gprFiles[0]);
    const gprText = fs.readFileSync(gprPath, 'utf8');
    const gprInfo = parseGpr(gprText);
    // Project.gpr 소스 목록 ↔ 폴더 대조(2026-10-27) — 제어기는 목록만 컴파일한다. 사람 경로는 업로드 전에 이미 물었고(activation
    // reconcileProjectGprBeforeDeploy), 여기서는 어느 경로든 남은 차이를 결과(`precheckWarnings`·`gprSyncMismatch`)로 알린다.
    try {
        const sync = checkGprFolderSync(options.projectDir, gprPath, {
            extensions: sourceExtensionsFrom(ctx.host.readSourceExtensionsSetting()),
            gprText,
        });
        if (!sync.inSync) {
            result.gprSyncMismatch = { toAdd: sync.plan.toAdd, toRemove: sync.plan.toRemove.map(e => e.path) };
            const note = gprSyncMismatchNote(sync.plan);
            result.precheckWarnings.push(note);
            pushTrace(`│ ⚠ ${note}`);
        }
    } catch (err: any) {
        pushTrace(`│ ⚠ Project.gpr 대조 실패(무시하고 진행): ${err?.message ?? err}`);
    }
    const folderName = path.basename(options.projectDir);
    const projectName = gprInfo.projectName || folderName;
    result.projectName = projectName;

    // 프로젝트명은 Compile/Load/Start/Unload 인자에 그대로 들어간다. 제어기 콘솔은 인자를 공백으로
    // 구분하고 인용 문법이 없으므로(Brooks 문서 Compile·Load·Start) 공백이 있으면 명령이 끊긴다 —
    // FTP 업로드나 1402 명령을 하나도 보내기 전에 여기서 막는다(제어기를 건드리지 않음).
    {
        const nameCheck = checkProjectName(projectName);
        if (!nameCheck.ok) {
            const reason = describeProjectNameProblem(projectName, gprInfo.projectName ? 'project' : 'folder', nameCheck);
            pushTrace(`✘ ${reason}`);
            result.failedPhase = 'UPLOAD';
            result.failedCommand = 'Validate project name';
            result.failedStatusMessage = reason;
            return undefined;
        }
    }

    return { gprPath, gprText, gprInfo, folderName, projectName };
}

/**
 * 업로드 전 메모리 사전 검사 — **경고만** 한다(2026-10-26 사용자 결정 — 종전엔 criticalMb 미만·측정 실패가 배포를 막았다).
 * 이 시점은 Stop 전이라 실행 중인 앱의 런타임 메모리(실측 ~3 MB)가 포함된 값이다 — 정지 뒤 Compile 직전 큐 슬롯의
 * 검사(controllerConnection.needsMemoryGuard)가 다시 재고, 그 값이 result.memoryPrecheck 를 덮어쓴다.
 * 측정 실패(unknown)로 STATUS 가 없으면 바로 뒤의 정체 확인이 자체 프로브로 판단한다.
 * (Upload Only 는 호출하지 않는다 — 오케스트레이터가 가른다.)
 */
export async function checkMemoryBeforeUpload(ctx: DeployContext): Promise<void> {
    const { cfg, lock, result, pushTrace, io } = ctx;
    lock.setStage('MEMORY_CHECK');
    const preUpload = await io.checkMemoryBeforeOperation(cfg);
    result.memoryPrecheck = preUpload;
    const note = preUploadMemoryNote(preUpload);
    if (note !== undefined) {
        result.precheckWarnings.push(note);
        pushTrace(`│ ⚠ ${note}`);
    }
}
