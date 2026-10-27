/**
 * 배포 단계 2 — 대상 결정: 제어기 정체 확인(명령 콘솔 ① → FTP 배너 ②, controllerIdentity.ts 가 정본), `/GPL` 프로브로
 * direct `/GPL/<프로젝트>` 모드 또는 클래식(`/flash/projects` 업로드 → Load) 경로 선택, autoOnSave 게이트 ①, 재부팅 정황 안내,
 * 그리고 트레이스 헤더(대상·모드·라이브러리 포함 범위). 2026-10-27 `deployService.ts` 의 `deployLocked` 에서 분리.
 * FTP 쓰기는 아직 하지 않는다 — 여기서 멈추면 제어기에 아무것도 올라가지 않은 상태다.
 */

import * as path from 'path';
import {
    decideControllerIdentity,
    disabledControllerCheck,
    formatControllerCheckTarget,
    observeCommandConsole,
    observeFtpBanner,
    rebootSuspicionHint,
} from '../connection/controllerIdentity';
import type { ConsoleObservation, ControllerCheckRecord } from '../connection/controllerIdentity';
import { listRemoteDir } from '../files/ftpClient';
import { checkProjectName, describeProjectNameProblem } from '../projects/projectNameGuard';
import { describeRemotePathCandidates, resolveRemoteProjectPath } from '../projects/remoteProjectPath';
import { isPathUnder } from '../../util/pathKey';
import { resolveProjectLibraryDirs } from '../../project/sources/projectSources';
import type { DeployContext } from './deployContext';
import type { DeployProjectInfo } from './deployPrecheck';
import { modeSuffixFor } from './deployModes';

/** 대상 결정의 산출 — 업로드·컴파일·Start 단계가 그대로 쓴다. */
export interface DeployTarget {
    /** direct `/GPL/<프로젝트>` 모드인가(아니면 클래식 경로). */
    directActive: boolean;
    /** `/GPL` 목록에서 찾은(또는 새로 만들) 실제 폴더명 — 대소문자가 로드된 프로젝트명이다. direct 모드에서만. */
    directGplName?: string;
    /** `/GPL/<directGplName>`. direct 모드에서만. */
    directGplDir?: string;
    /** 폴더가 없어 FTP 로 새로 만드는 최초 배포인가. */
    directGplCreate: boolean;
    /** `/GPL` 목록 조회 실패 사유(있으면 업로드 전에 중단된다 — 트레이스 모드 줄에도 쓴다). */
    directProbeError?: string;
    /** FTP 업로드 대상 디렉터리. */
    ftpProjectDir: string;
    /** 클래식 경로의 `Load` 인자(direct 모드면 빈 문자열). */
    loadPath: string;
}

/** `/GPL` 목록 한 번의 판독 — 어느 폴더를 direct 대상으로 삼을지. */
export interface DirectGplPlan {
    /** `/GPL` 목록에 이 프로젝트 폴더가 없었는가. */
    gplFolderMissing: boolean;
    /** `/GPL` 에 폴더가 하나도 없었는가 — 재부팅 정황 안내용. */
    gplEmpty: boolean;
    directGplName?: string;
    directGplDir?: string;
    directGplCreate: boolean;
}

/**
 * `/GPL` 목록으로 direct 대상을 정한다(순수).
 * 폴더명은 Project.gpr의 프로젝트명으로 결정되며 대소문자를 구분하므로, 원격 목록에서 실제 폴더명을 찾아 그대로 사용한다.
 * 폴더가 없으면 전체 업로드 경로만 FTP 로 생성한다(최초 배포) — changedFiles 경로(autoOnSave)는 변경 파일 1개만 담긴
 * 불완전한 /GPL 폴더가 만들어지는 것을 막기 위해 생성하지 않는다(클래식 폴백).
 */
export function planDirectGpl(
    gplEntries: ReadonlyArray<{ name: string; isDirectory: boolean }>,
    projectName: string,
    changedFilesOnly: boolean,
): DirectGplPlan {
    const hit = gplEntries.find(e => e.isDirectory && e.name.toLowerCase() === projectName.toLowerCase());
    const plan: DirectGplPlan = {
        gplFolderMissing: !hit,
        gplEmpty: !gplEntries.some(e => e.isDirectory && e.name !== '.' && e.name !== '..'),
        directGplCreate: false,
    };
    if (hit) {
        plan.directGplName = hit.name;
        plan.directGplDir = `/GPL/${hit.name}`;
    } else if (!changedFilesOnly) {
        // 폴더 없음(최초 배포): FTP로 /GPL/<projectName>을 생성해 직접 업로드한다.
        // Load 문서 Remarks("an external file-copy utility such as FTP can be used to
        // create the folder and copy the files")가 허용하는 공식 경로.
        // ※ 최초 FTP 생성 폴더를 제어기가 로드본으로 인식하는지는 실기기(G2400C) 검증 전.
        //   Compile이 -508/-743을 주면 인식 실패 → Save to Flash + Load로 복구 안내.
        plan.directGplName = projectName;
        plan.directGplDir = `/GPL/${projectName}`;
        plan.directGplCreate = true;
    }
    // changedFiles만 올리는 경로(autoOnSave)는 폴더가 없으면 생성하지 않는다 —
    // 변경 파일 1개만 담긴 불완전한 /GPL 폴더가 만들어지는 것을 막기 위해 클래식 폴백.
    return plan;
}

/** autoOnSave 게이트 ① 미충족 사유(프로브 실패가 폴더 없음보다 우선). */
export function autoGateSkipReason(directProbeError: string | undefined, projectName: string): string {
    return directProbeError
        ? `/GPL 프로브 실패: ${directProbeError}`
        : `/GPL/${projectName} 폴더 없음 (자동 모드에서는 생성하지 않음 — 최초 1회는 수동 Deploy로 올리세요)`;
}

/**
 * 정체 확인 → `/GPL` 프로브 → 경로 확정. 실패·취소면 `ctx.result` 를 채우고 undefined.
 */
export async function resolveDeployTarget(ctx: DeployContext, project: DeployProjectInfo): Promise<DeployTarget | undefined> {
    const { options, cfg, lock, result, pushTrace, isCancelled, cancelResult, operationStartedAt, io } = ctx;
    const { folderName, projectName } = project;

    /** 어느 원격 사본을 대상으로 삼을지 — 규칙은 controller/projects/remoteProjectPath.ts 가 정본이다(§1-DE). */
    async function chooseRemoteProjectPath(projectFolderName: string): Promise<{
        basePath: string;
        projectPath: string;
        candidates: string[];
        confirmed: boolean;
    }> {
        const choice = await resolveRemoteProjectPath({
            projectFolderName,
            flashBasePath: cfg.ftpFlashProjectsPath,
            gplBasePath: cfg.ftpBasePath,
            listDir: base => listRemoteDir(cfg.ip, base),
        });
        return {
            basePath: choice.basePath,
            projectPath: choice.projectPath,
            candidates: describeRemotePathCandidates(choice.candidates),
            confirmed: choice.confirmed,
        };
    }

    // ── 제어기 정체 확인 IO (controller/connection/controllerIdentity.ts 가 정본) ──
    // 같은 작업 안에서 이미 받은 명령 콘솔 STATUS(배포의 Show Memory 사전 검사)와 FTP 세션 배너(/GPL 목록 조회)를
    // 재사용한다 — 확인 때문에 왕복을 더 만들지 않는다. Upload Only 처럼 앞선 STATUS 가 없을 때만 읽기 전용 명령 하나를 보낸다.
    const identityEnabled = options.verifyControllerIdentity !== false;
    const identityIo = io.createIdentityIo(cfg);
    const recentReachability = () => io.recentReachabilityEvidence(cfg.ip);
    let consoleObservation: ConsoleObservation | undefined;
    let identityOverridden = false;

    /**
     * 정체 확인 실패 처리. UI 경로(confirmUnverifiedController 지정)는 「그래도 진행」을 물을 수 있고,
     * 그 밖(AI·자동화·autoOnSave)은 묻지 않고 CONTROLLER_CHECK 로 멈춘다. true 면 계속 진행.
     */
    async function gateUnverifiedController(check: ControllerCheckRecord): Promise<boolean> {
        result.controllerCheck = check;
        pushTrace(`│  ⚠ 제어기 확인 실패 — ${check.reasons.join(' / ')}`);
        if (options.confirmUnverifiedController) {
            let proceed = false;
            try { proceed = await options.confirmUnverifiedController(check); } catch { proceed = false; }
            if (proceed) {
                check.overridden = true;
                identityOverridden = true;
                pushTrace('│  ⚠ 사용자가 「그래도 진행」을 선택 — 제어기 미확인 상태로 업로드합니다.');
                return true;
            }
        }
        result.failedPhase = 'CONTROLLER_CHECK';
        result.failedCommand = 'Controller identity preflight';
        result.failedStatusMessage = `CONTROLLER_UNVERIFIED: ${check.reasons.join(' ')} — 업로드하지 않았습니다.`;
        pushTrace(`✘ ${result.failedStatusMessage}`);
        return false;
    }

    // ── 정체 확인 ① 명령 콘솔 — FTP 를 건드리기 전에(Upload Only 도 생략하지 않는다) ──
    if (identityEnabled) {
        lock.setStage('CONTROLLER_CHECK');
        consoleObservation = await observeCommandConsole(identityIo, operationStartedAt);
        if (consoleObservation.state === 'lost') {
            const check = decideControllerIdentity({ console: consoleObservation, reachability: recentReachability(), now: Date.now() });
            if (!(await gateUnverifiedController(check))) { return undefined; }
        }
        if (isCancelled()) { cancelResult('제어기 확인 후'); return undefined; }
    }

    // ── Direct /GPL 모드 프로브 ────────────────────
    // Load 문서 Remarks: "an external file-copy utility such as FTP can be used to
    // create the folder and copy the files" — /GPL 직접 쓰기는 공식 허용 경로.
    // /GPL/<projectName>이 이미 존재할 때만 활성화하고, 없으면 클래식 경로로 폴백한다.
    // (폴더명은 Project.gpr의 프로젝트명으로 결정되며 대소문자를 구분하므로,
    //  원격 목록에서 실제 폴더명을 찾아 그대로 사용한다.)
    let directGplDir: string | undefined;
    let directGplName: string | undefined;
    let directProbeError: string | undefined;
    let directGplCreate = false;
    /** `/GPL` 목록에 이 프로젝트 폴더가 없었는가(목록을 읽은 경우만) · `/GPL` 에 폴더가 하나도 없었는가 — 재부팅 정황 안내용. */
    let gplFolderMissing = false;
    let gplEmpty = false;
    if (options.directGpl) {
        try {
            const gplEntries = await listRemoteDir(cfg.ip, '/GPL');
            const plan = planDirectGpl(gplEntries, projectName, (options.changedFiles ?? []).length > 0);
            gplFolderMissing = plan.gplFolderMissing;
            gplEmpty = plan.gplEmpty;
            directGplName = plan.directGplName;
            directGplDir = plan.directGplDir;
            directGplCreate = plan.directGplCreate;
        } catch (e: any) {
            directProbeError = e?.message || String(e);
        }
    }

    // ── 정체 확인 ② FTP 220 배너 — 첫 FTP 쓰기 전에. /GPL 목록 조회(읽기)가 연 세션의 배너를 재사용한다. ──
    // 목록 조회가 실패했어도 여기서 먼저 판정한다 — 상대가 제어기가 아니면 "/GPL 목록 실패" 보다 그것이 원인이다.
    if (identityEnabled) {
        const ftpObservation = await observeFtpBanner(identityIo, operationStartedAt);
        const check = decideControllerIdentity({
            console: consoleObservation,
            ftp: ftpObservation,
            reachability: recentReachability(),
            now: Date.now(),
        });
        if (identityOverridden) { check.overridden = true; }
        result.controllerCheck = check;
        if (!check.verified && !identityOverridden) {
            if (!(await gateUnverifiedController(check))) { return undefined; }
        }
        if (isCancelled()) { cancelResult('제어기 확인 후'); return undefined; }
    } else {
        result.controllerCheck = disabledControllerCheck(Date.now());
    }

    // `/GPL/<프로젝트>` 가 없고 직전에 채널 유실이 있었으면 재부팅 정황 — 다른 프로젝트·라이브러리도 다시 올려야 한다.
    result.rebootHint = rebootSuspicionHint({
        folderMissing: gplFolderMissing && !directProbeError,
        projectName,
        lastChannelLossAt: io.getLastCommandChannelLoss(cfg.ip),
        gplEmpty,
        now: Date.now(),
    });

    // `/GPL` 목록 조회 실패는 "폴더 없음"이 아니다. 이 상태에서 classic 경로로 내려가면 공용 경로
    // 선택기의 flash 가점만으로 `/flash/projects` 영구 사본을 고를 수 있다(2026-10-16 실측).
    // 업로드 대상을 확인하지 못했으므로 어떤 FTP 쓰기도 시작하기 전에 중단한다.
    if (options.directGpl && directProbeError) {
        const reason = `/GPL 목록 조회 실패: ${directProbeError} — /flash/projects로 폴백하지 않고 업로드를 중단합니다.`;
        pushTrace(`✘ ${reason}`);
        result.failedPhase = 'UPLOAD';
        result.failedCommand = 'Probe /GPL';
        result.failedStatusMessage = reason;
        return undefined;
    }

    // autoGate 조건 1: /GPL/<projectName>이 이미 존재해야 한다.
    // 없거나(생성 필요 포함) 프로브가 실패하면 제어기를 건드리지 않고 조용히 중단한다.
    if (options.autoGate && (!directGplDir || directGplCreate)) {
        const reason = autoGateSkipReason(directProbeError, projectName);
        pushTrace(`│ [autoOnSave] 게이트 미충족 — 건너뜀: ${reason}`);
        result.failedPhase = 'AUTO_GATE';
        result.failedCommand = 'AutoGate /GPL probe';
        result.failedStatusMessage = reason;
        return undefined;
    }

    const directActive = !!directGplDir;

    // 클래식 경로(/flash/projects/<폴더명> 업로드 → Load <경로>)에서는 로컬 폴더명이 Load 인자·Compile 후보로
    // 쓰인다. 폴더명에 공백이 있으면 그 경로의 명령이 끊기므로 업로드 전에 막는다(Direct /GPL 모드는 폴더명을 쓰지 않음).
    if (!directActive) {
        const folderCheck = checkProjectName(folderName);
        if (!folderCheck.ok) {
            const reason = describeProjectNameProblem(folderName, 'folder', folderCheck);
            pushTrace(`✘ ${reason}`);
            result.failedPhase = 'UPLOAD';
            result.failedCommand = 'Validate project folder name';
            result.failedStatusMessage = reason;
            return undefined;
        }
    }

    let ftpProjectDir: string;
    let loadPath = '';
    if (directActive) {
        ftpProjectDir = directGplDir!;
        result.selectedRemoteBasePath = '/GPL';
        result.selectedRemoteProjectPath = directGplDir;
        result.candidateRemoteProjectPaths = [directGplDir!];
    } else {
        const remotePath = await chooseRemoteProjectPath(folderName);
        result.candidateRemoteProjectPaths = remotePath.candidates;
        if (!remotePath.confirmed) {
            const reason = `원격 프로젝트 경로 목록을 확인할 수 없어 업로드를 중단합니다: ${remotePath.candidates.join(' | ')}`;
            pushTrace(`✘ ${reason}`);
            result.failedPhase = 'UPLOAD';
            result.failedCommand = 'Resolve remote project path';
            result.failedStatusMessage = reason;
            return undefined;
        }
        ftpProjectDir = remotePath.projectPath;
        loadPath = ftpProjectDir;
        result.selectedRemoteBasePath = remotePath.basePath;
        result.selectedRemoteProjectPath = remotePath.projectPath;
    }

    return { directActive, directGplName, directGplDir, directGplCreate, directProbeError, ftpProjectDir, loadPath };
}

/** 배포 트레이스 헤더 — 프로젝트·모드·경로·대상 제어기·라이브러리 포함 범위. 제어기를 건드리지 않는다. */
export function traceDeployHeader(ctx: DeployContext, project: DeployProjectInfo, target: DeployTarget): void {
    const { options, cfg, result, pushTrace } = ctx;
    const { projectName, gprInfo, gprPath, gprText } = project;
    const { directActive, directGplCreate, directProbeError, ftpProjectDir } = target;

    // 헤더는 왼쪽 `│` 거터만 쓴다 — 오른쪽 테두리는 한글(전각)·긴 경로 때문에 줄마다 어긋나 닫힌 상자가 깨졌다.
    const modeSuffix = modeSuffixFor(options);
    pushTrace(`│  ◆ ${projectName}${modeSuffix}`);
    pushTrace(`│  Local:  ${options.projectDir}`);
    pushTrace(`│  FTP:    ${ftpProjectDir}`);
    if (directActive) {
        pushTrace(`│  Mode:   direct /GPL upload — Unload/Load 생략${directGplCreate ? ' (최초: /GPL 폴더 FTP 생성)' : ''}`);
        if (directGplCreate) {
            pushTrace(`│  ⚠ /GPL/${projectName} 폴더가 없어 FTP로 새로 생성합니다. 제어기가 이를 로드본으로`);
            pushTrace(`│    인식하는지 실기기 검증 전 — Compile이 -508/-743이면 Save to Flash 후 Load로 복구하세요.`);
        }
    } else if (options.directGpl) {
        pushTrace(`│  Mode:   classic (direct /GPL 폴백${directProbeError ? `: probe 실패 ${directProbeError}` : ': 변경 파일 전용 경로(autoOnSave)에서 /GPL 폴더 없음'})`);
    }
    if (!directActive) {
        // direct 모드에서는 base(/GPL)와 후보 경로가 위 FTP 줄과 동일해 중복 — classic에서만 출력.
        pushTrace(`│  Selected base path: ${result.selectedRemoteBasePath}`);
        pushTrace(`│  Path candidates: ${(result.candidateRemoteProjectPaths ?? []).join(' | ')}`);
    }
    // 확인하지 않은 대상을 확정된 것처럼 쓰지 않는다 — 정체 확인 결과를 그대로 적는다(2026-10-23 보고 1번).
    pushTrace(`│  Target: ${result.controllerCheck ? formatControllerCheckTarget(cfg.ip, result.controllerCheck) : `${cfg.ip}:${cfg.port}`}`);
    if (result.rebootHint) {
        pushTrace(`│  ⚠ ${result.rebootHint}`);
    }
    // ProjectLibrary 참조가 있으면 어디까지 이 배포에 포함되는지 밝힌다. 업로드 대상은 종전과 같이
    // **프로젝트 폴더 하나**다(제어기 쪽 라이브러리 배치 규칙은 실기기 미검증 — 임의로 넓히지 않는다).
    // 폴더 안의 중첩 라이브러리는 재귀 업로드에 자연히 포함되고, 폴더 밖 라이브러리는 포함되지 않는다.
    if (gprInfo.libraries.length > 0) {
        const resolved = resolveProjectLibraryDirs(gprPath, gprText);
        const inside = resolved.dirs.filter(d => isPathUnder(d, options.projectDir));
        const outside = resolved.dirs.filter(d => !isPathUnder(d, options.projectDir));
        pushTrace(`│  Library: ${gprInfo.libraries.join(' | ')}`);
        if (inside.length > 0) {
            const names = inside.map(d => path.relative(options.projectDir, d));
            pushTrace(`│    ↳ 폴더 안의 라이브러리(함께 업로드됨): ${names.join(', ')}`);
        }
        if (outside.length > 0) {
            pushTrace(`│    ⚠ 폴더 밖 — 이 배포에 포함되지 않습니다: ${outside.join(', ')}`);
            pushTrace(`│      해당 프로젝트를 따로 Deploy 하세요(제어기가 라이브러리를 못 찾으면 Compile 실패).`);
        }
        if (resolved.unresolved.length > 0) {
            pushTrace(`│    ⚠ 로컬에서 폴더를 찾지 못한 라이브러리: ${resolved.unresolved.join(', ')}`);
        }
    }
}
