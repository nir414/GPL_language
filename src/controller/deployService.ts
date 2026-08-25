/**
 * 배포 서비스: UPLOAD ∥ STOP(+정지 완료 게이트) 동시 진행 → COMPILE (→ START) 워크플로.
 * skipStart 옵션으로 Start 단계를 생략하여 디버그 준비용으로 사용 가능.
 * controller-f5.ps1의 핵심 로직을 TypeScript로 포팅.
 *
 * 2026-08-25(이슈 #17 + 보충 코멘트) 재구성 — 목적은 속도: 사용자 관찰상 "쓰레드 실행 중 FTP 업로드"는 무해하고,
 * 업로드(FTP 21)와 Stop -all/정지 확인(1402)은 별 채널이라 **동시에** 진행해도 문제가 없다. Stop은 한 번에 안 멈추면
 * settle 폴링·재시도를 반복하느라 오래 걸리므로 업로드와 겹쳐 총 소요를 max(업로드, 정지)로 줄인다.
 * 진짜 위험은 ① 업로드 도중 Compile/Start(제어기 사망) ② 정지 미완료 상태의 Compile/Start(§0.6)다. 두 작업이
 * *모두* 끝난 뒤에만 COMPILE로 가고(②), ①은 deploy() 전체를 감싸는 배포 잠금(deployLock.ts, 프로세스 간 파일)으로 막는다.
 * COMPILE과 START는 한 번에 하나만 보낸다 — PA 제어기의 Start는 자체적으로 Compile을 수행하므로(사용자 실사용 사실,
 * ai-handoff §0.7) Compile 직후 Start는 컴파일 중복이다(연속 실행 안전성은 추후 테스트; Start는 gpl.start가 별도 담당).
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { sendCommand, sendCommandDetailed, trySendCommand, getControllerConfig, ControllerConfig, CommandResponseMeta } from './controllerConnection';
import { uploadProject, mirrorProject, listRemoteDir, removeRemoteFiles, RemoteFileRef } from './ftpClient';
import { parseCompileErrors, parseStatus, parseGpr, parseErrorLog, parseThreadList, ThreadInfo, CompileError, isControllerNonBlockingStatus, SHOW_THREAD_LIST_CMD, NO_STATUS_CODE } from './responseParser';
import { isBusyStatus, isTransientCompileStatus, isProjectAlreadyLoaded, isProjectNotLoaded } from './controllerStatusCodes';
import { getDeployLock, describeDeployLock, DeployLockHandle, DeployLockRecord } from './deployLock';

export interface DeployOptions {
    projectDir: string;
    skipUnchanged?: boolean;
    skipStart?: boolean;
    skipStop?: boolean;
    /**
     * 지정 시 이 파일들(로컬 절대경로)만 업로드한다. 저장 파일만 올리는 빠른 컴파일 경로에서 사용.
     * projectDir 하위 파일만 대상이 되며, 변경을 확신하는 것으로 보고 크기 비교 없이 업로드한다.
     * 업로드 후 Compile은 평소대로 프로젝트 전체를 대상으로 수행된다.
     */
    changedFiles?: string[];
    /**
     * 직접 /GPL 업로드 모드 (Deploy/Quick Compile/디버그 F5 공통 기본 경로).
     * Load 문서 Remarks("an external file-copy utility such as FTP can be used to create
     * the folder and copy the files")에 따라 /GPL/<projectName>에 FTP로 직접 파일을 써서
     * Unload(-750 쓰레드 락)와 Load("대상 폴더가 이미 존재하면 안 됨") 제약을 모두 우회한다.
     * /GPL/<projectName> 폴더가 원격에 없으면 FTP로 생성해 직접 업로드한다(최초 배포).
     * 단, changedFiles 지정 경로(autoOnSave)에서는 불완전한 폴더 생성을 막기 위해
     * 기존(flash 업로드 + Unload/Load) 경로로 폴백한다. flash 저장은 Save to Flash가 담당.
     */
    directGpl?: boolean;
    /**
     * 빠른 컴파일(skipStop)에서 활성 쓰레드 감지 시 호출된다.
     * true를 반환하면 Stop -all + 정지 완료 확인을 거쳐 계속 진행하고,
     * false 반환 또는 미지정이면 THREAD_CHECK로 중단한다.
     * (autoOnSave처럼 사용자 개입이 부적절한 경로에서는 지정하지 않는다.)
     */
    confirmStopOnActive?: (activeThreadsDesc: string) => Promise<boolean> | boolean;
    beforeStart?: () => Promise<void> | void;
    /**
     * autoOnSave 자동 게이트 (gpl.quickCompile.autoOnSave = "auto").
     * 1. /GPL/<projectName> 폴더가 원격에 이미 존재해야 업로드한다 (없어도 생성하지 않고 classic 폴백도 없음
     *    → failedPhase 'AUTO_GATE', 제어기를 건드리지 않음).
     * 2. Compile은 Show Thread 목록이 완전히 비어 있을 때만 — 정지 상태(Idle/Stopped/Error) 쓰레드도 없어야 한다.
     *    쓰레드가 있으면 업로드는 그대로 두고 Compile만 보류한다(failedPhase 'COMPILE_DEFERRED', 2026-08-25 재배치).
     *    호출측은 "컴파일 필요" 상태로 표시하고 팝업 없이 로그만 남긴다.
     * 확인 불가(프로브 무응답)도 미충족으로 취급한다 — 판단은 live 데이터로만(§0 하드 규칙).
     */
    autoGate?: boolean;
    /**
     * 배포 잠금 레코드의 owner 라벨(경고·MCP 거부 문구에 표시). 미지정 시 옵션에서 유추
     * ('autoOnSave Quick Compile' / 'Quick Compile' / 'Deploy').
     */
    lockOwner?: string;
}

/** 배포 단계/결과 분류. 실패 단계뿐 아니라 LOCKED·AUTO_GATE·COMPILE_DEFERRED 같은 "중단" 결과도 담는다. */
export type DeployPhase =
    | 'LOCKED'            // 배포 잠금을 다른 배포/창/프로세스가 보유 중 — 제어기를 건드리지 않음
    | 'AUTO_GATE'         // autoOnSave: /GPL 폴더 없음 등으로 업로드 전 스킵
    | 'UPLOAD'
    | 'STOP'
    | 'THREAD_CHECK'      // 활성 쓰레드 + 사용자 미승인 → 업로드는 완료, Compile 미수행
    | 'COMPILE_DEFERRED'  // autoOnSave: 업로드 완료, 쓰레드 존재로 Compile 보류
    | 'COMPILE'
    | 'START'
    | 'ERROR_CHECK';

export interface CompileAttemptLog {
    command: string;
    statusCode: number;
    raw: string;
    errors: CompileError[];
    responseMeta?: CommandResponseMeta;
    note?: string;
}

export interface DeployResult {
    success: boolean;
    projectName: string;
    compileErrors: CompileError[];
    compileAttemptLogs: CompileAttemptLog[];
    precheckWarnings: string[];
    errorLog: string[];
    selectedRemoteBasePath?: string;
    selectedRemoteProjectPath?: string;
    candidateRemoteProjectPaths?: string[];
    uploadStats?: { uploaded: number; skipped: number; totalBytes: number; deleted?: number };
    failedPhase?: DeployPhase;
    failedCommand?: string;
    failedStatusCode?: number;
    failedStatusMessage?: string;
    attemptedProjectNames?: string[];
    /** failedPhase === 'LOCKED'일 때 잠금 보유자(경고 문구용) */
    lockHolder?: DeployLockRecord;
    trace: string[];
}

function emptyResult(): DeployResult {
    return {
        success: false,
        projectName: '',
        compileErrors: [],
        compileAttemptLogs: [],
        precheckWarnings: [],
        errorLog: [],
        trace: [],
    };
}

/** 배포 잠금 보유 중이라 시작하지 못했을 때의 결과(호출측 사전 검사에서도 재사용). */
export function makeLockedResult(holder: DeployLockRecord): DeployResult {
    return {
        ...emptyResult(),
        failedPhase: 'LOCKED',
        failedCommand: 'DeployLock acquire',
        failedStatusMessage: `배포가 이미 진행 중입니다 (${describeDeployLock(holder)})`,
        lockHolder: holder,
    };
}

function defaultLockOwner(options: DeployOptions): string {
    if ((options.changedFiles ?? []).length > 0) { return 'autoOnSave Quick Compile'; }
    if (options.skipStop) { return 'Quick Compile'; }
    return options.skipStart ? 'Deploy' : 'Deploy & Run';
}

/**
 * 프로젝트를 제어기에 배포한다.
 * Output channel에 단계별 진행 상태를 출력한다.
 *
 * 진입 시 배포 잠금(deployLock.ts)을 획득하고 종료 시 해제한다 — 호출측은 프로젝트 선택·미저장 확인 같은
 * UI를 *먼저* 끝내고 이 함수를 불러야 UI 대기 중 잠금이 잡히지 않는다(이슈 #15). 잠금이 이미 잡혀 있으면
 * 제어기를 건드리지 않고 failedPhase 'LOCKED'로 즉시 돌아온다. 디버그 F5 경로도 같은 함수를 쓰므로 자동 참여.
 */
export async function deploy(
    options: DeployOptions,
    output: vscode.OutputChannel,
    diagnosticCollection: vscode.DiagnosticCollection,
    token?: vscode.CancellationToken,
    controllerOverride?: Partial<ControllerConfig>
): Promise<DeployResult> {
    const cfg: ControllerConfig = { ...getControllerConfig(), ...controllerOverride };
    const owner = options.lockOwner ?? defaultLockOwner(options);
    const acquired = getDeployLock(cfg.ip).acquire(owner, 'PREPARE');
    if (!acquired.ok) {
        output.appendLine(`[Lock] 배포 잠금 획득 실패 — ${describeDeployLock(acquired.holder)}${acquired.local ? '' : ' (다른 창/프로세스)'}`);
        return makeLockedResult(acquired.holder);
    }
    // autoOnSave는 저장마다 도니 잠금 로그로 채널을 채우지 않는다.
    const quiet = !!options.autoGate;
    const startedAt = Date.now();
    if (!quiet) { output.appendLine(`[Lock] 배포 잠금 획득: ${owner} (pid ${process.pid})`); }
    try {
        return await deployLocked(options, output, diagnosticCollection, token, cfg, acquired.handle);
    } finally {
        acquired.handle.release();
        if (!quiet) { output.appendLine(`[Lock] 배포 잠금 해제: ${owner} (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`); }
    }
}

async function deployLocked(
    options: DeployOptions,
    output: vscode.OutputChannel,
    diagnosticCollection: vscode.DiagnosticCollection,
    token: vscode.CancellationToken | undefined,
    cfg: ControllerConfig,
    lock: DeployLockHandle,
): Promise<DeployResult> {
    const result: DeployResult = {
        success: false,
        projectName: '',
        compileErrors: [],
        compileAttemptLogs: [],
        precheckWarnings: [],
        errorLog: [],
        trace: [],
    };

    const pushTrace = (line: string) => {
        result.trace.push(line);
        output.appendLine(line);
    };

    const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

    const rawPreview = (raw: string): string => {
        const compact = raw.replace(/\r/g, '').replace(/\n+/g, ' | ').trim();
        return compact.length > 260 ? `${compact.slice(0, 260)}…` : compact;
    };

    async function chooseRemoteProjectPath(projectFolderName: string): Promise<{
        basePath: string;
        projectPath: string;
        candidates: string[];
    }> {
        const uniqueBasePaths = [...new Set([
            cfg.ftpFlashProjectsPath,
            cfg.ftpBasePath,
        ].map(p => (p || '').trim()).filter(Boolean))];

        const scored: Array<{ basePath: string; projectPath: string; exists: boolean; rank: number }> = [];
        for (const basePath of uniqueBasePaths) {
            const projectPath = `${basePath}/${projectFolderName}`;
            let exists = false;
            try {
                const entries = await listRemoteDir(cfg.ip, basePath);
                exists = entries.some(e => e.isDirectory && e.name.toLowerCase() === projectFolderName.toLowerCase());
            } catch {
                // ignore: probe failure means existence unknown
            }

            const rank = exists
                ? (basePath === cfg.ftpFlashProjectsPath ? 300 : 200)
                : (basePath === cfg.ftpFlashProjectsPath ? 120 : 100);
            scored.push({ basePath, projectPath, exists, rank });
        }

        scored.sort((a, b) => b.rank - a.rank);
        const chosen = scored[0] ?? {
            basePath: cfg.ftpBasePath,
            projectPath: `${cfg.ftpBasePath}/${projectFolderName}`,
            exists: false,
            rank: 0,
        };

        return {
            basePath: chosen.basePath,
            projectPath: chosen.projectPath,
            candidates: scored.map(s => s.projectPath),
        };
    }

    if (!options.autoGate) {
        // autoOnSave 게이트 경로는 저장마다 실행된다 — 출력 패널 포커스 강탈 금지,
        // 게이트 미충족 스킵 시 기존 컴파일 진단(빨간 줄)도 지우지 않는다(UPLOAD 진입 시 clear).
        output.show(true);
        diagnosticCollection.clear();
    }

    // ── .gpr 파싱 ──────────────────────────────

    const gprFiles = fs.readdirSync(options.projectDir).filter(f => f.toLowerCase().endsWith('.gpr'));
    if (gprFiles.length === 0) {
        pushTrace('✘ No .gpr file found in project directory');
        result.failedPhase = 'UPLOAD';
        result.failedCommand = 'Read .gpr';
        result.failedStatusMessage = 'No .gpr file found in project directory';
        return result;
    }

    const gprText = fs.readFileSync(path.join(options.projectDir, gprFiles[0]), 'utf8');
    const gprInfo = parseGpr(gprText);
    const folderName = path.basename(options.projectDir);
    const projectName = gprInfo.projectName || folderName;
    result.projectName = projectName;

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
    if (options.directGpl) {
        try {
            const gplEntries = await listRemoteDir(cfg.ip, '/GPL');
            const hit = gplEntries.find(e => e.isDirectory && e.name.toLowerCase() === projectName.toLowerCase());
            if (hit) {
                directGplName = hit.name;
                directGplDir = `/GPL/${hit.name}`;
            } else if ((options.changedFiles ?? []).length === 0) {
                // 폴더 없음(최초 배포): FTP로 /GPL/<projectName>을 생성해 직접 업로드한다.
                // Load 문서 Remarks("an external file-copy utility such as FTP can be used to
                // create the folder and copy the files")가 허용하는 공식 경로.
                // ※ 최초 FTP 생성 폴더를 제어기가 로드본으로 인식하는지는 실기기(G2400C) 검증 전.
                //   Compile이 -508/-743을 주면 인식 실패 → Save to Flash + Load로 복구 안내.
                directGplName = projectName;
                directGplDir = `/GPL/${projectName}`;
                directGplCreate = true;
            }
            // changedFiles만 올리는 경로(autoOnSave)는 폴더가 없으면 생성하지 않는다 —
            // 변경 파일 1개만 담긴 불완전한 /GPL 폴더가 만들어지는 것을 막기 위해 클래식 폴백.
        } catch (e: any) {
            directProbeError = e?.message || String(e);
        }
    }

    // autoGate 조건 1: /GPL/<projectName>이 이미 존재해야 한다.
    // 없거나(생성 필요 포함) 프로브가 실패하면 제어기를 건드리지 않고 조용히 중단한다.
    if (options.autoGate && (!directGplDir || directGplCreate)) {
        const reason = directProbeError
            ? `/GPL 프로브 실패: ${directProbeError}`
            : `/GPL/${projectName} 폴더 없음 (자동 모드에서는 생성하지 않음 — 최초 1회는 수동 Deploy로 올리세요)`;
        pushTrace(`│ [autoOnSave] 게이트 미충족 — 건너뜀: ${reason}`);
        result.failedPhase = 'AUTO_GATE';
        result.failedCommand = 'AutoGate /GPL probe';
        result.failedStatusMessage = reason;
        return result;
    }

    const directActive = !!directGplDir;

    let ftpProjectDir: string;
    let loadPath = '';
    if (directActive) {
        ftpProjectDir = directGplDir!;
        result.selectedRemoteBasePath = '/GPL';
        result.selectedRemoteProjectPath = directGplDir;
        result.candidateRemoteProjectPaths = [directGplDir!];
    } else {
        const remotePath = await chooseRemoteProjectPath(folderName);
        ftpProjectDir = remotePath.projectPath;
        loadPath = ftpProjectDir;
        result.selectedRemoteBasePath = remotePath.basePath;
        result.selectedRemoteProjectPath = remotePath.projectPath;
        result.candidateRemoteProjectPaths = remotePath.candidates;
    }
    // (UPLOAD ∥ STOP/게이트) + COMPILE + ERROR CHECK(항상 수행) = 3, START는 옵션.
    const totalPhases = 3 + (options.skipStart ? 0 : 1);
    let phase = 0;

    pushTrace(`╭──────────────────────────────────────────────────────╮`);
    pushTrace(`│  ◆ ${projectName}${options.skipStop ? ' (Quick Compile)' : options.skipStart ? ' (Build Only)' : ''}`);
    pushTrace(`├──────────────────────────────────────────────────────┤`);
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
    pushTrace(`│  Target: ${cfg.ip}:${cfg.port}`);
    pushTrace(`╰──────────────────────────────────────────────────────╯`);

    // ── 쓰레드 상태 프로브 (read-only) ─────────────
    // Stop -all의 STATUS 0은 "정지 요청 접수"이지 완전 정지 보장이 아니다.
    // 정지 완료 전에 Compile/Start를 보내면 제어기 이상 현상(메모리 누수 의심,
    // 2026-07-08 사용자 관찰)이 발생할 수 있어, Show Thread로 실제 상태를 확인한다.
    const threadSettled = (state: string): boolean => /^(idle|stopped|error)$/i.test((state || '').trim());
    async function probeActiveThreads(): Promise<{ active: ThreadInfo[]; total: number } | null> {
        // GDE 캡처 실측(runbook): 인자 없는 `Show Thread`는 스레드가 실행 중이어도
        // <DATA></DATA> 빈 응답을 줄 수 있다 → 게이트가 항상 통과하는 false-pass.
        // 전체 열거는 반드시 `Show Thread  -web`(SHOW_THREAD_LIST_CMD)로 한다.
        try {
            const resp = await sendCommandDetailed(SHOW_THREAD_LIST_CMD, cfg);
            // idle/close로 잘린(STATUS 미수신) 응답은 "확인 불가"로 처리한다(하드 규칙 2).
            if (!resp.meta.statusTagReceived) { return null; }
            const threads = parseThreadList(resp.raw);
            return { active: threads.filter(t => !threadSettled(t.state)), total: threads.length };
        } catch {
            return null;
        }
    }

    type StopAllOutcome =
        | { kind: 'accepted' }   // STATUS 0 — 정지 요청 접수(완료 아님, §0.6)
        | { kind: 'stopping' }   // STATUS -752 — 정지 진행 중(비치명), settle 게이트로 판정
        | { kind: 'failed'; command: string; code?: number; message: string };

    /**
     * Stop -all 전송(무응답 시 1회 재전송).
     *
     * STATUS -752 "Timeout stopping thread"는 정지 요청 후 3초(제어기 내부 대기) 안에
     * 쓰레드가 멈추지 않았다는 뜻일 뿐, 요청 자체는 접수되어 하던 일(모션/I/O)을 마치면
     * 멈춘다(GPL 에러 문서: "This is not a critical error"). 실패로 판정하지 않고
     * 'stopping'으로 분류해, 호출측이 settle 게이트(Show Thread 폴링)로 실제 정지를
     * 판정하게 한다 — Compile 쪽 transient(-742/-746/-752) 처리와 대칭 (2026-08-05).
     */
    async function sendStopAll(): Promise<StopAllOutcome> {
        pushTrace('│ CMD Stop -all');
        let resp = await trySendCommand('Stop -all', cfg);
        if (resp === null) {
            pushTrace('│ ⚠ Stop -all failed or timed out. Retrying...');
            resp = await trySendCommand('Stop -all', cfg);
            if (resp === null) {
                pushTrace('│ ✘ Stop -all failed after retry');
                return { kind: 'failed', command: 'Stop -all', message: 'No response (timeout or connection failure)' };
            }
        }
        const status = parseStatus(resp);
        pushTrace(`│ RAW ${rawPreview(resp) || '(empty)'}`);
        if (status.code === 0) {
            pushTrace('│ ✔ Stop -all 접수 — 실제 정지는 아래 게이트에서 확인');
            return { kind: 'accepted' };
        }
        if (isBusyStatus(status.code)) {
            pushTrace(`│ ⚠ STATUS ${status.code}: ${status.message} — 정지 진행 중(비치명, 하던 일을 마치면 정지). 정지 완료 게이트로 실제 상태를 확인합니다`);
            return { kind: 'stopping' };
        }
        pushTrace(`│ ✘ Stop -all failed: STATUS ${status.code}: ${status.message}`);
        return { kind: 'failed', command: 'Stop -all', code: status.code, message: status.message };
    }

    /**
     * Stop 완료 게이트: 모든 쓰레드가 Idle/Stopped/Error가 될 때까지 폴링 대기.
     * Show Thread 무응답 시에는 확인 불가로 보고 경고 후 통과시킨다(기존 동작 수준 유지).
     */
    async function waitThreadsSettle(timeoutMs = 8000): Promise<{ ok: boolean; cancelled?: boolean; activeDesc?: string }> {
        const startedAt = Date.now();
        const deadline = startedAt + timeoutMs;
        let lastActiveDesc = '';
        let lastLoggedDesc = '';
        let lastLoggedAt = 0;
        while (Date.now() < deadline) {
            if (token?.isCancellationRequested) { return { ok: false, cancelled: true }; }
            const probe = await probeActiveThreads();
            if (probe === null) {
                pushTrace('│ ⚠ Show Thread 무응답 — 정지 완료 확인 불가(계속 진행)');
                return { ok: true };
            }
            const elapsed = `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
            if (probe.active.length === 0) {
                // total은 Show Thread 목록의 쓰레드 수 — 완전 정지 후에는 목록이 비어 0이 된다.
                pushTrace(`│ ✔ 모든 쓰레드 정지 확인 (${elapsed}${probe.total > 0 ? `, 정지 상태 ${probe.total}개` : ''})`);
                return { ok: true };
            }
            lastActiveDesc = probe.active.map(t => `${t.name}(${t.state})`).join(', ');
            // 500ms 폴링을 그대로 찍으면 같은 줄이 십수 번 반복된다 — 상태가 바뀌면 즉시,
            // 같은 상태면 2초에 한 번만 경과 시간과 함께 남긴다.
            if (lastActiveDesc !== lastLoggedDesc || Date.now() - lastLoggedAt >= 2000) {
                pushTrace(`│ … 정지 대기 ${elapsed}: ${lastActiveDesc}`);
                lastLoggedDesc = lastActiveDesc;
                lastLoggedAt = Date.now();
            }
            await sleep(500);
        }
        return { ok: false, activeDesc: lastActiveDesc };
    }

    /**
     * Stop -all → 정지 완료 게이트를 수행하고, 실패 시 result에 기록한다. true면 계속 진행 가능.
     *
     * STATUS 0도 -752(stopping)도 "정지 완료"가 아니므로 실제 정지는 항상 settle
     * 게이트(Show Thread 폴링)로 판정한다. 게이트에서 정지가 확인되지 않으면
     * Stop -all을 1회 자동 재시도한 뒤 다시 게이트를 돌린다 — 가끔 나는 -752
     * 타임아웃 때문에 사용자가 손으로 재시도할 필요가 없도록 (2026-08-05).
     */
    async function stopAllAndSettle(): Promise<boolean> {
        const maxStopAttempts = 2;
        for (let attempt = 1; attempt <= maxStopAttempts; attempt++) {
            const stop = await sendStopAll();
            if (stop.kind === 'failed') {
                result.failedPhase = 'STOP';
                result.failedCommand = stop.command;
                result.failedStatusCode = stop.code;
                result.failedStatusMessage = stop.message;
                return false;
            }
            const settle = await waitThreadsSettle();
            if (settle.cancelled) { return false; }
            if (settle.ok) { return true; }
            if (attempt < maxStopAttempts) {
                pushTrace(`│ ↻ 정지 미확인(${settle.activeDesc}) — Stop -all 자동 재시도 (${attempt + 1}/${maxStopAttempts})`);
                continue;
            }
            pushTrace(`│ ✘ Stop -all 후에도 쓰레드가 정지되지 않음: ${settle.activeDesc}`);
            pushTrace('│   → 정지 미완료 상태에서 Compile/Start를 보내지 않고 중단합니다.');
            result.failedPhase = 'STOP';
            result.failedCommand = 'Show Thread (stop settle gate)';
            result.failedStatusMessage = `Stop -all 후에도 활성 쓰레드 존재: ${settle.activeDesc}`;
        }
        return false;
    }

    // ── Phase 1: UPLOAD ∥ STOP(정지 게이트) — 동시 진행 ─────────────────────
    // 2026-08-25(이슈 #17 + 보충 코멘트): 목적은 속도. "쓰레드 실행 중 FTP 업로드"는 무해(사용자 관찰)하고, 업로드(FTP 21)와
    // Stop -all/정지 확인(1402)은 별 채널이라 동시에 진행해도 문제가 없다. Stop은 한 번에 안 멈추면 settle 폴링·재시도를
    // 반복하느라 오래 걸리므로 업로드와 겹쳐 총 소요를 max(업로드, 정지)로 줄인다.
    // 두 작업이 *모두* 끝난 뒤에만 다음(원격 전용 파일 삭제 → COMPILE)으로 간다 — "정지 확인 전 Compile/Start 금지"(§0.6)와
    // "업로드 도중 Compile/Start 금지"(배포 잠금)는 그대로다. 원격 전용 파일 삭제는 실행 중 무해가 미검증이라 정지 확인 뒤로 지연.

    pushTrace('');
    phase++;
    const gateLabel = options.skipStop ? '쓰레드 상태 확인' : 'STOP';
    pushTrace(`━━ [${phase}/${totalPhases}] UPLOAD ∥ ${gateLabel} (동시 진행) ━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    lock.setStage(options.skipStop ? 'UPLOAD+THREAD_CHECK' : 'UPLOAD+STOP');

    if (token?.isCancellationRequested) { return result; }

    const changedFiles = (options.changedFiles ?? []).filter(Boolean);
    const useChangedOnly = changedFiles.length > 0;
    if (useChangedOnly) {
        pushTrace(`│ 변경 파일만 업로드(${changedFiles.length}개): ${changedFiles.map(f => path.basename(f)).join(', ')}`);
    }

    // Direct /GPL 모드에서 changedFiles 제약이 없는 경우(수동 Quick Compile, 디버그 F5)는
    // 미러 동기화한다: 크기가 다르거나 새로 생긴 파일만 올리고, 로컬에 없는 원격 파일은 (정지 확인 뒤) 삭제한다.
    // Unload로 /GPL 폴더를 통째로 비우는 대신 파일 단위로 맞춰 왕복을 줄이고(속도),
    // 로컬에서 지운/이름 바꾼 파일이 원격에 남아 오컴파일되는 것도 막는다(정확성).
    // autoOnSave(useChangedOnly)는 저장 파일만 올리는 초경량 경로라 전체 목록 조회/삭제가 있는 미러를 쓰지 않는다.
    const useMirror = directActive && !useChangedOnly;

    type UploadOutcome = { ok: true; pendingDeletes: RemoteFileRef[] } | { ok: false; message: string };
    /** 업로드 작업. 예외를 던지지 않고 결과로 돌려준다(Promise.all에서 다른 쪽을 끝까지 기다리기 위해). */
    async function runUpload(): Promise<UploadOutcome> {
        try {
            if (useMirror) {
                pushTrace('│ ↑ Mode: mirror sync (변경분만 업로드, 원격 전용 파일 삭제는 정지 확인 뒤, Unload 생략)');
                const stats = await mirrorProject(cfg.ip, options.projectDir, ftpProjectDir, {
                    deferDelete: true,
                    // 스킵 파일까지 전부 나열하면 파일 수만큼 로그가 쏟아진다 — 실제 전송분만 남긴다.
                    onProgress: (current, total, file, action) => {
                        lock.heartbeat();
                        if (action === 'uploaded') {
                            pushTrace(`│ ↑ [${current}/${total}] ${file}`);
                        }
                    },
                });
                result.uploadStats = {
                    uploaded: stats.uploaded,
                    skipped: stats.skipped,
                    totalBytes: stats.totalBytes,
                    deleted: 0,
                };
                pushTrace(`│ ✔ Mirror done: ${stats.uploaded} sent, ${stats.skipped} skipped${stats.pendingDeletes.length > 0 ? `, ${stats.pendingDeletes.length} remote-only (정지 확인 뒤 삭제)` : ''}`);
                return { ok: true, pendingDeletes: stats.pendingDeletes };
            }
            const stats = await uploadProject(cfg.ip, options.projectDir, ftpProjectDir, {
                skipUnchanged: options.skipUnchanged,
                onlyFiles: useChangedOnly ? changedFiles : undefined,
                onProgress: (current, total, file, action) => {
                    lock.heartbeat();
                    if (action === 'uploaded') {
                        pushTrace(`│ ↑ [${current}/${total}] ${file}`);
                    }
                },
            });
            result.uploadStats = stats;
            pushTrace(`│ ✔ Upload done: ${stats.uploaded} sent, ${stats.skipped} skipped`);
            return { ok: true, pendingDeletes: [] };
        } catch (e: any) {
            pushTrace(`│ ✘ Upload failed: ${e?.message ?? e}`);
            return { ok: false, message: e?.message || 'Upload failed' };
        }
    }

    /**
     * 정지 게이트(§0.6) — Compile 전에 반드시 통과해야 한다. 'proceed'가 아니면 result.failedPhase가 기록된 상태.
     * - !skipStop(전체 Deploy): Stop -all + settle(재시도 포함).
     * - skipStop(빠른 컴파일): Show Thread 프로브 → autoGate면 쓰레드 0개일 때만 통과(아니면 COMPILE_DEFERRED),
     *   수동 경로는 활성 쓰레드 시 사용자에게 Stop 여부 확인(거부 → THREAD_CHECK). 업로드는 병행 중이라 그대로 완료된다.
     */
    async function runStopGate(): Promise<'proceed' | 'abort'> {
        if (!options.skipStop) {
            return (await stopAllAndSettle()) ? 'proceed' : 'abort';
        }
        pushTrace('│ ⏸ STOP 생략(빠른 컴파일) — Show Thread로 쓰레드 상태 확인');
        const probe = await probeActiveThreads();
        // autoGate 조건 2: Compile은 쓰레드 목록이 완전히 비어 있을 때만(정지 상태 쓰레드도 불허). 확인 불가(무응답)도 미충족.
        if (options.autoGate) {
            if (probe === null) {
                pushTrace('│ [autoOnSave] Compile 보류: Show Thread 무응답(정지 상태 확인 불가)');
                result.failedPhase = 'COMPILE_DEFERRED';
                result.failedCommand = 'AutoGate Show Thread';
                result.failedStatusMessage = '업로드 완료, Compile 보류 — Show Thread 무응답으로 제어기 정지 상태를 확인할 수 없음';
                return 'abort';
            }
            if (probe.total > 0) {
                const desc = probe.active.length > 0
                    ? `활성 쓰레드 ${probe.active.map(t => `${t.name}(${t.state})`).join(', ')}`
                    : `정지 상태 쓰레드 ${probe.total}개 존재`;
                pushTrace(`│ [autoOnSave] Compile 보류: ${desc} — 쓰레드가 없는 완전 STOP 상태에서 Compile`);
                result.failedPhase = 'COMPILE_DEFERRED';
                result.failedCommand = 'AutoGate Show Thread';
                result.failedStatusMessage = `업로드 완료, Compile 보류 — ${desc}`;
                return 'abort';
            }
            pushTrace('│ ✔ [autoOnSave] 게이트 통과: 쓰레드 없음(완전 STOP 상태)');
            return 'proceed';
        }
        if (probe === null) {
            pushTrace('│ ⚠ Show Thread 무응답 — 쓰레드 상태 확인 불가(계속 진행)');
            return 'proceed';
        }
        if (probe.active.length === 0) {
            pushTrace(`│ ✔ 활성 쓰레드 없음 (총 ${probe.total}개 모두 정지 상태)`);
            return 'proceed';
        }
        const desc = probe.active.map(t => `${t.name}(${t.state})`).join(', ');
        pushTrace(`│ ⚠ 활성 쓰레드 존재: ${desc}`);
        let stopApproved = false;
        if (options.confirmStopOnActive) {
            pushTrace('│ … 사용자에게 Stop -all 실행 여부 확인 중 (업로드는 병행 진행)');
            try {
                stopApproved = await options.confirmStopOnActive(desc);
            } catch {
                stopApproved = false;
            }
        }
        if (!stopApproved) {
            pushTrace('│ ✘ 중단: 활성 쓰레드 존재 (사용자 미승인 또는 확인 경로 없음) — Compile 미수행');
            pushTrace('│   → 프로그램 STOP 후 Quick Compile을 다시 실행하거나, STOP이 포함된 전체 배포를 사용하세요.');
            result.failedPhase = 'THREAD_CHECK';
            result.failedCommand = 'Show Thread';
            result.failedStatusMessage = `활성 쓰레드 존재: ${desc} — 업로드는 완료됨, Compile은 STOP 후 다시 실행하세요.`;
            return 'abort';
        }
        pushTrace('│ ✔ 사용자 승인 — Stop -all 실행 후 정지 확인');
        return (await stopAllAndSettle()) ? 'proceed' : 'abort';
    }

    // 두 작업을 동시에 시작하고 둘 다 끝날 때까지 기다린다. 한쪽이 먼저 실패해도 다른 쪽을 끝까지 기다려야 한다 —
    // 특히 업로드가 진행 중인데 돌아가 배포 잠금을 풀면 "업로드 도중 Compile/Start" 창이 열린다.
    const [upload, gate] = await Promise.all([runUpload(), runStopGate()]);

    const pendingDeletes: RemoteFileRef[] = upload.ok ? upload.pendingDeletes : [];
    const deferNote = pendingDeletes.length > 0 ? ` (원격 전용 파일 ${pendingDeletes.length}개 삭제는 보류)` : '';

    if (!upload.ok) {
        // 게이트 결과와 무관하게 업로드 실패가 우선 — 컴파일 대상(/GPL 사본)이 불완전하다.
        if (gate === 'proceed' && !options.skipStop) {
            pushTrace('│ ⚠ 쓰레드는 정지됨(Stop 완료) — 업로드 실패로 Compile은 하지 않습니다.');
        }
        result.failedPhase = 'UPLOAD';
        result.failedCommand = `Upload ${ftpProjectDir}`;
        result.failedStatusMessage = upload.message;
        return result;
    }
    if (gate === 'abort') {
        // failedPhase(STOP/THREAD_CHECK/COMPILE_DEFERRED)는 게이트가 기록했다. 업로드는 완료 —
        // "/GPL 소스는 최신, 컴파일본은 이전" 상태이므로 호출측이 '컴파일 필요'로 표시한다.
        pushTrace(`│   업로드는 완료됨 — /GPL 소스는 최신, 컴파일본은 이전 상태(컴파일 필요)${deferNote}`);
        return result;
    }
    pushTrace(`│ ✔ 업로드·정지 확인 모두 완료 → Compile 진행 (mirrored/uploaded copy: ${ftpProjectDir})`);

    // ── 지연된 원격 전용 파일 삭제 (정지 확인 뒤) ──
    if (pendingDeletes.length > 0) {
        lock.setStage('UPLOAD');
        pushTrace(`│ 원격 전용 파일 ${pendingDeletes.length}개 삭제 (정지 확인 후)`);
        // ✘는 실패 기호로 오독된다 — 미러 삭제는 정상 동작이므로 −로 표기.
        const deleted = await removeRemoteFiles(cfg.ip, pendingDeletes, file => pushTrace(`│ − del ${file} (원격 전용 — 로컬에 없어 삭제)`));
        if (result.uploadStats) { result.uploadStats.deleted = deleted; }
        if (deleted < pendingDeletes.length) {
            pushTrace(`│ ⚠ 삭제 실패 ${pendingDeletes.length - deleted}개 (non-fatal — 남은 파일은 Compile 결과로 드러남)`);
        }
    }

    // ── Phase 3: COMPILE ──────────────────────────

    pushTrace('');
    phase++;
    pushTrace(`━━ [${phase}/${totalPhases}] COMPILE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    lock.setStage('COMPILE');

    if (token?.isCancellationRequested) { return result; }

    if (options.autoGate) {
        // 게이트 통과 → 실제 컴파일 진행이 확정된 시점에 이전 진단을 비운다
        // (게이트 스킵/보류 시 기존 빨간 줄을 지우지 않기 위해 entry가 아닌 여기서 clear).
        diagnosticCollection.clear();
    }

    // Direct 모드에서는 /GPL의 실제 폴더명(=로드된 프로젝트명)을 최우선 후보로 사용한다.
    const compileCandidates = directActive
        ? [...new Set([directGplName!, projectName].filter(Boolean))]
        : [...new Set([projectName, gprInfo.projectName, folderName].filter(Boolean))];
    const transientCompileRetryDelayMs = Math.max(250, Math.floor(cfg.timeoutMs / 20));
    result.attemptedProjectNames = compileCandidates;
    pushTrace(`│ Candidates: ${compileCandidates.join(' -> ')}`);
    let compiled = false;
    let lastCompileFailure: { command: string; code: number; message: string; raw: string } | undefined;

    /** Compile 명령 실행 후 응답의 STATUS와 에러를 검사하는 헬퍼. */
    async function tryCompile(candidate: string): Promise<{
        ok: boolean;
        statusCode: number;
        errors: CompileError[];
        raw: string;
        responseMeta?: CommandResponseMeta;
        note?: string;
    }> {
        try {
            const detailed = await sendCommandDetailed(`Compile ${candidate}`, cfg, {
                // 컴파일은 pass 사이에 수 초간 침묵할 수 있다. idle로 조기 완료하면 응답이
                // 잘려 STATUS/에러 라인을 놓치고 거짓 성공이 난다(GDE는 종결자까지 받음).
                // 따라서 반드시 종결자 </STATUS>까지 수신하고, 대형 프로젝트 대비 충분한 상한을 둔다.
                waitForStatusClose: true,
                timeoutMs: Math.max(cfg.timeoutMs, 60000),
            });
            const resp = detailed.raw;
            const status = parseStatus(resp);
            const errors = parseCompileErrors(resp);
            const statusMissing = status.code === NO_STATUS_CODE;

            if (isControllerNonBlockingStatus(status.code) && errors.length === 0) {
                return {
                    ok: true,
                    statusCode: status.code,
                    errors,
                    raw: resp,
                    responseMeta: detailed.meta,
                };
            }
            if (status.code === 0 && errors.length === 0) {
                return {
                    ok: true,
                    statusCode: status.code,
                    errors,
                    raw: resp,
                    responseMeta: detailed.meta,
                };
            }

            // STATUS 종결자까지 대기했는데도 STATUS가 없으면(연결 끊김/타임아웃 등)
            // 컴파일 결과를 확인하지 못한 것이다. 과거에는 'compile successful' 텍스트나
            // pass 로그 + Show Thread 응답으로 성공 처리했으나, 이는 실제 컴파일 에러를
            // 가리는 오판의 직접 원인이었다(예: -742를 성공으로 보고). 따라서 절대 성공으로
            // 간주하지 않고, 결과 미확인으로서 실패 처리한다.
            return {
                ok: false,
                statusCode: status.code,
                errors,
                raw: resp,
                responseMeta: detailed.meta,
                note: statusMissing
                    ? (errors.length > 0
                        ? 'STATUS 미수신이나 에러 라인 검출 → 실패'
                        : 'STATUS 미수신: 컴파일 결과 확인 실패(성공 간주 안 함)')
                    : undefined,
            };
        } catch (e: any) {
            const errText = e.message || '';
            return {
                ok: false,
                statusCode: NO_STATUS_CODE,
                errors: parseCompileErrors(errText),
                raw: errText,
            };
        }
    }

    async function runStatusCommand(command: string): Promise<{ ok: boolean; statusCode: number; message: string; raw: string }> {
        try {
            const raw = await sendCommand(command, cfg);
            const status = parseStatus(raw);
            return {
                ok: status.code === 0 || isControllerNonBlockingStatus(status.code),
                statusCode: status.code,
                message: status.message,
                raw,
            };
        } catch (e: any) {
            const raw = e?.message || String(e);
            const status = parseStatus(raw);
            return {
                ok: false,
                statusCode: status.code,
                message: status.message,
                raw,
            };
        }
    }

    async function ensureLoadedFromFtpPath(candidate: string): Promise<boolean> {
        pushTrace(`│ CMD Load ${loadPath}`);
        const load = await runStatusCommand(`Load ${loadPath}`);
        pushTrace(`│ RAW ${rawPreview(load.raw) || '(empty)'}`);
        // 응답이 HTTP면 명령이 콘솔이 아니라 제어기 웹서버(GoAhead)에 닿은 것 —
        // 제어기 이상 징후일 수 있다(2026-07-03 무응답 사례, docs/ai-handoff.md §1-F).
        // 재시도로 상태를 더 자극하지 않고 즉시 중단한다.
        if ((load.raw || '').trimStart().startsWith('HTTP/')) {
            pushTrace('│ ✘ HTTP 응답 감지 — 콘솔이 아닌 웹서버가 응답함. 제어기 상태 이상 가능성, 즉시 중단.');
            pushTrace('│   → 제어기 웹 UI/GDE 접속 가능 여부를 확인하고, 필요 시 재부팅 후 다시 시도하세요.');
            lastCompileFailure = {
                command: `Load ${loadPath}`,
                code: load.statusCode,
                message: 'HTTP response detected on 1402 (controller may be unhealthy)',
                raw: load.raw,
            };
            return false;
        }
        if (load.ok) {
            pushTrace(`│ ✔ Load success: ${candidate} ← ${loadPath}`);
            return true;
        }
        if (isProjectAlreadyLoaded(load.statusCode)) {
            pushTrace(`│ ✔ Load skipped: already loaded (${candidate})`);
            return true;
        }
        pushTrace(`│ ✘ Load failed: STATUS ${load.statusCode}: ${load.message || 'Unknown error'}`);
        lastCompileFailure = {
            command: `Load ${loadPath}`,
            code: load.statusCode,
            message: load.message || 'Unknown error',
            raw: load.raw,
        };
        return false;
    }

    async function tryUnload(candidate: string): Promise<boolean> {
        pushTrace(`│ CMD Unload ${candidate}`);
        const unload = await runStatusCommand(`Unload ${candidate}`);
        pushTrace(`│ RAW ${rawPreview(unload.raw) || '(empty)'}`);
        if (unload.ok) {
            pushTrace(`│ ✔ Unload success: ${candidate}`);
            return true;
        }
        if (isProjectNotLoaded(unload.statusCode)) {
            pushTrace(`│ ✔ Unload skipped: project not loaded (${candidate})`);
            return true;
        }
        pushTrace(`│ ✘ Unload failed: STATUS ${unload.statusCode}: ${unload.message || 'Unknown error'}`);
        lastCompileFailure = {
            command: `Unload ${candidate}`,
            code: unload.statusCode,
            message: unload.message || 'Unknown error',
            raw: unload.raw,
        };
        return false;
    }

    if (directActive) {
        // Direct /GPL 모드: 컴파일 대상(/GPL 로드본)에 이미 직접 업로드했으므로
        // Unload/Load 동기화가 불필요하다. (Unload -750 락, Load "폴더 존재 불가" 제약 회피)
        pushTrace(`│ Direct /GPL 모드: Unload/Load 생략 — ${ftpProjectDir}의 소스를 그대로 컴파일`);
    } else {
        // 업로드된 /flash 프로젝트 복사본을 실제 컴파일 대상으로 강제 동기화한다.
        // 이유: 이미 로드된 /GPL 프로젝트가 남아 있으면, Compile <name>이 로컬 최신 업로드가 아닌
        //      이전 로드본을 대상으로 실행될 수 있어 오판정(예: 과거 컴파일 에러 재발견)이 발생한다.
        const reloadTargets = [...new Set(compileCandidates)];
        pushTrace(`│ Sync loaded project with uploaded copy`);
        let unloadBlockedByActiveThread = false;
        for (const target of reloadTargets) {
            const unloaded = await tryUnload(target);
            if (!unloaded) {
                // -750(*Invalid when thread active*): 쓰레드 실행 중에는 Unload/Load 동기화가
                // 원천적으로 불가하다. 이 상태로 Load를 강행하면 이전 로드본을 컴파일하거나
                // (2026-07-03 §1-F) 제어기 이상 상황을 더 자극할 수 있어 여기서 명확히 중단한다.
                if (lastCompileFailure?.code === -750) {
                    unloadBlockedByActiveThread = true;
                    break;
                }
                pushTrace(`│ ⚠ Unload failed but continue: ${target}`);
            }
        }
        if (unloadBlockedByActiveThread) {
            pushTrace('│ ✘ 쓰레드 실행 중(-750) — Unload/Load 동기화 불가. Load를 생략하고 중단합니다.');
            pushTrace('│   → 프로그램 STOP 후 다시 시도하거나, STOP이 포함된 전체 배포를 사용하세요.');
            result.failedPhase = 'COMPILE';
            result.failedCommand = 'Unload (threads active)';
            result.failedStatusCode = -750;
            result.failedStatusMessage = '*Invalid when thread active* — 실행 중에는 Quick Compile 동기화가 불가합니다. STOP 후 재시도하세요.';
            return result;
        }
        const synced = await ensureLoadedFromFtpPath(reloadTargets[0] || projectName);
        if (!synced) {
            pushTrace('│ ✘ Failed to load uploaded project copy before compile');
            result.failedPhase = 'COMPILE';
            result.failedCommand = `Load ${loadPath}`;
            result.failedStatusCode = lastCompileFailure?.code;
            result.failedStatusMessage = lastCompileFailure?.message || 'Failed to sync uploaded copy before compile';
            return result;
        }
    }

    // raw 텍스트에서 상태 코드 존재를 확인할 때 부분 문자열 오탐(-745가 -7450에 걸림 등)을 막는다.
    const hasCode = (text: string, code: number): boolean => new RegExp(`(^|\\D)${code}\\b`).test(text);

    for (const candidate of compileCandidates) {
        let recoveryFailureRecorded = false; // 복구 분기(cr2)가 실패를 기록했는지 (§1-L cr 덮어쓰기 방지)
        pushTrace(`│ CMD Compile ${candidate}`);
        let cr = await tryCompile(candidate);
        result.compileAttemptLogs.push({
            command: `Compile ${candidate}`,
            statusCode: cr.statusCode,
            raw: cr.raw,
            errors: cr.errors,
            responseMeta: cr.responseMeta,
            note: cr.note,
        });
        pushTrace(`│ RAW ${rawPreview(cr.raw) || '(empty)'}`);
        if (cr.note) {
            pushTrace(`│ NOTE ${cr.note}`);
        }

        if (cr.responseMeta && !cr.responseMeta.responseComplete) {
            pushTrace(`│ META responseComplete=false bytesReceived=${cr.responseMeta.bytesReceived} lastChunkAt=${cr.responseMeta.lastChunkAt} idleTimeoutMs=${cr.responseMeta.idleTimeoutMs}`);
        }

        // STATUS -742/-746/-752이면서 컴파일 에러가 파싱되지 않은 경우는
        // 일시적 컨트롤러 상태일 수 있어 1회 재시도한다.
        if (!cr.ok && isTransientCompileStatus(cr.statusCode) && cr.errors.length === 0) {
            pushTrace(`│ ⚠ Transient STATUS ${cr.statusCode}. retry in ${transientCompileRetryDelayMs}ms`);
            await sleep(transientCompileRetryDelayMs);
            const retry = await tryCompile(candidate);
            result.compileAttemptLogs.push({
                command: `Compile ${candidate} (retry transient)`,
                statusCode: retry.statusCode,
                raw: retry.raw,
                errors: retry.errors,
                responseMeta: retry.responseMeta,
                note: retry.note,
            });
            pushTrace(`│ RAW ${rawPreview(retry.raw) || '(empty)'}`);
            if (retry.note) {
                pushTrace(`│ NOTE ${retry.note}`);
            }
            cr = retry;
        }

        if (cr.ok) {
            if (isControllerNonBlockingStatus(cr.statusCode)) {
                pushTrace(`│ ⚠ Compile STATUS ${cr.statusCode} non-blocking (controller environment warning)`);
            }
            result.projectName = candidate;
            result.compileErrors = []; // 이전 후보의 컴파일 에러가 성공 결과에 남지 않도록 초기화
            compiled = true;
            pushTrace(`│ ✔ Compile success: ${candidate}`);
            break;
        }

        // NOTE: 과거 여기서 STATUS 누락 시 `Show Thread` 응답을 성공으로 간주했으나,
        // 그것은 "제어기가 다시 응답하는가"만 확인할 뿐 컴파일 성공과 무관하여
        // 실제 컴파일 에러(-742 등)를 가렸다. 이제 컴파일 응답은 waitForStatusClose로
        // 종결자 </STATUS>까지 수신하므로, 성공/실패는 오직 STATUS와 파싱된 에러로 판정한다.

        result.compileErrors = cr.errors;
        const errText = cr.raw;

        // Direct 모드: 복구용 Unload/Load는 목적(락 회피)에 반하므로 시도하지 않는다.
        // -508/-743(not loaded)이 나온다면 /GPL 폴더는 있으나 로드본이 인식되지 않는 상태 —
        // Save to Flash로 /flash/projects에 저장 후 콘솔에서 Unload <name> → Load로 복구한다.
        if (directActive && (isProjectAlreadyLoaded(cr.statusCode) || isProjectNotLoaded(cr.statusCode)
            || hasCode(errText, -745) || hasCode(errText, -508) || hasCode(errText, -743))) {
            pushTrace('│ ✘ Direct /GPL 모드에서 로드 상태 이상 — Save to Flash 후 콘솔에서 Unload/Load로 복구하세요.');
            lastCompileFailure = {
                command: `Compile ${candidate}`,
                code: cr.statusCode,
                message: `${parseStatus(cr.raw).message || 'Load-state error in direct /GPL mode'} — Save to Flash + Load로 복구 필요`,
                raw: cr.raw,
            };
            recoveryFailureRecorded = true;
        }
        // -745: project already loaded → Unload + Load + Compile
        else if (!directActive && (isProjectAlreadyLoaded(cr.statusCode) || hasCode(errText, -745))) {
            pushTrace(`│ ⚠ Already loaded. Unload → Load → Compile`);
            const unloaded = await tryUnload(candidate);
            if (!unloaded) {
                continue;
            }
            const loaded = await ensureLoadedFromFtpPath(candidate);
            if (!loaded) {
                continue;
            }
            const cr2 = await tryCompile(candidate);
            result.compileAttemptLogs.push({
                command: `Compile ${candidate} (after reload)`,
                statusCode: cr2.statusCode,
                raw: cr2.raw,
                errors: cr2.errors,
                responseMeta: cr2.responseMeta,
                note: cr2.note,
            });
            if (cr2.ok) {
                result.projectName = candidate;
                result.compileErrors = [];
                compiled = true;
                pushTrace(`│ ✔ Compile success (after reload): ${candidate}`);
                break;
            }
            result.compileErrors = cr2.errors;
            lastCompileFailure = {
                command: `Compile ${candidate}`,
                code: cr2.statusCode,
                message: parseStatus(cr2.raw).message || 'Compile failed after reload',
                raw: cr2.raw,
            };
            recoveryFailureRecorded = true;
        }
        // -508/-743: missing/invalid → Load + Compile
        else if (!directActive && (isProjectNotLoaded(cr.statusCode)
            || hasCode(errText, -508) || hasCode(errText, -743))) {
            pushTrace(`│ ⚠ Not loaded. Load → Compile`);
            const loaded = await ensureLoadedFromFtpPath(candidate);
            if (!loaded) {
                continue;
            }
            const cr2 = await tryCompile(candidate);
            result.compileAttemptLogs.push({
                command: `Compile ${candidate} (after load)`,
                statusCode: cr2.statusCode,
                raw: cr2.raw,
                errors: cr2.errors,
                responseMeta: cr2.responseMeta,
                note: cr2.note,
            });
            if (cr2.ok) {
                const warning = `Pre-check warning: Compile by name returned ${cr.statusCode}, but Load ${loadPath} + Compile succeeded`;
                result.precheckWarnings.push(warning);
                pushTrace(`│ ⚠ ${warning}`);
                result.projectName = candidate;
                result.compileErrors = [];
                compiled = true;
                pushTrace(`│ ✔ Compile success (after load): ${candidate}`);
                break;
            }
            result.compileErrors = cr2.errors;
            lastCompileFailure = {
                command: `Compile ${candidate}`,
                code: cr2.statusCode,
                message: parseStatus(cr2.raw).message || 'Compile failed after load',
                raw: cr2.raw,
            };
            recoveryFailureRecorded = true;
        }

        pushTrace(`│ ✘ Compile failed: ${candidate}`);
        // 복구 분기(-745/-508 등)가 이미 cr2 기준 실패를 기록했다면 원본 cr로 덮어쓰지 않는다(§1-L 해소).
        if (!recoveryFailureRecorded && cr.statusCode !== 0) {
            const status = parseStatus(cr.raw);
            pushTrace(`│   STATUS ${status.code}: ${status.message}`);
            lastCompileFailure = {
                command: `Compile ${candidate}`,
                code: status.code,
                message: status.message,
                raw: cr.raw,
            };
        }
    }

    // 컴파일 에러 → vscode.Diagnostic 주입
    if (result.compileErrors.length > 0) {
        applyCompileDiagnostics(result.compileErrors, options.projectDir, diagnosticCollection);
        for (const err of result.compileErrors) {
            // 절대경로 `파일:줄:열` 형식으로 출력하면 출력 패널에서 클릭 시 해당 위치로 이동된다.
            const abs = path.isAbsolute(err.file)
                ? err.file
                : path.join(options.projectDir, err.file);
            pushTrace(`│   ${abs}:${err.line}:1 (${err.code}) ${err.message}`);
        }
    }

    if (!compiled) {
        pushTrace('│ ✘ All compile attempts failed');
        result.failedPhase = 'COMPILE';
        result.failedCommand = lastCompileFailure?.command || 'Compile <candidate>';
        result.failedStatusCode = lastCompileFailure?.code;
        result.failedStatusMessage = lastCompileFailure?.message || 'All compile attempts failed';
        if (lastCompileFailure?.raw) {
            pushTrace(`│ LAST RAW ${rawPreview(lastCompileFailure.raw)}`);
        }
        return result;
    }

    // ── Phase 4: START ────────────────────────────

    if (!options.skipStart) {
        pushTrace('');
        phase++;
        pushTrace(`━━ [${phase}/${totalPhases}] START ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        lock.setStage('START');

        if (token?.isCancellationRequested) { return result; }

        if (options.beforeStart) {
            pushTrace('│ Preparing runtime console before Start');
            try {
                await options.beforeStart();
                pushTrace('│ ✔ Runtime console ready for Start');
            } catch (err: any) {
                pushTrace(`│ ⚠ Runtime console pre-start failed: ${err?.message ?? err}`);
            }
        }

        // B2(§3-B): 자동 Start 확인 게이트 — Start는 로봇 모션을 유발할 수 있다(§0.6).
        const requireStartConfirm = vscode.workspace.getConfiguration('gpl')
            .get<boolean>('controller.requireStartConfirmation', true);
        if (requireStartConfirm) {
            const pick = await vscode.window.showWarningMessage(
                `'${result.projectName}' 프로그램을 시작합니다. 로봇이 움직일 수 있습니다.`,
                { modal: true },
                'Start'
            );
            if (pick !== 'Start') {
                pushTrace('│ ✘ 사용자가 Start를 취소했습니다 (gpl.controller.requireStartConfirmation)');
                result.failedPhase = 'START';
                result.failedCommand = `Start ${result.projectName}`;
                result.failedStatusMessage = '사용자가 Start 실행을 취소했습니다';
                return result;
            }
        }
        pushTrace(`│ CMD Start ${result.projectName}`);
        const start = await runStatusCommand(`Start ${result.projectName}`);
        pushTrace(`│ RAW ${rawPreview(start.raw) || '(empty)'}`);
        if (start.ok) {
            if (isControllerNonBlockingStatus(start.statusCode)) {
                pushTrace(`│ ⚠ Start STATUS ${start.statusCode} non-blocking (controller environment warning)`);
            }
            pushTrace(`│ ✔ Start success`);
        } else {
            pushTrace(`│ ✘ Start failed: STATUS ${start.statusCode}: ${start.message || 'Unknown error'}`);
            result.failedPhase = 'START';
            result.failedCommand = `Start ${result.projectName}`;
            result.failedStatusCode = start.statusCode;
            result.failedStatusMessage = start.message || 'Unknown error';
            return result;
        }
    }

    // ── Phase: ERROR CHECK ─────────────────

    pushTrace('');
    phase++;
    pushTrace(`━━ [${phase}/${totalPhases}] ERROR CHECK ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    lock.setStage('ERROR_CHECK');

    const errorLogResp = await trySendCommand('ErrorLog', cfg);
    if (errorLogResp) {
        pushTrace(`│ RAW ${rawPreview(errorLogResp) || '(empty)'}`);
        result.errorLog = parseErrorLog(errorLogResp);
        if (result.errorLog.length === 0) {
            pushTrace('│ ✔ No active errors');
        } else {
            // 과거 누적 항목이 섞일 수 있으므로 "에러 N개" 단정 대신 ErrorLog 항목 수로 표기.
            pushTrace(`│ ⚠ ErrorLog ${result.errorLog.length}건:`);
            for (const el of result.errorLog) {
                pushTrace(`│   ${el}`);
            }
        }
    } else {
        pushTrace('│ ⚠ ErrorLog read failed (non-fatal)');
    }

    result.success = compiled;

    const doneLabel = options.skipStart ? 'Build' : 'Deploy';
    pushTrace('');
    pushTrace('══════════════════════════════════════════════════════');
    pushTrace(`${result.success ? '✔' : '✘'} ${doneLabel} ${result.success ? 'complete' : 'failed'}: ${result.projectName}`);
    pushTrace('══════════════════════════════════════════════════════');

    return result;
}

/**
 * 컴파일 에러를 VS Code Diagnostic으로 변환.
 */
function applyCompileDiagnostics(
    errors: CompileError[],
    projectDir: string,
    collection: vscode.DiagnosticCollection
): void {
    // fsPath 문자열을 키로 사용해 동일 파일의 진단을 묶는다.
    // (Uri.toString() ↔ Uri.parse() 왕복 인코딩으로 인한 경로 불일치를 피하기 위해 Uri를 직접 보관한다.)
    const byFile = new Map<string, { uri: vscode.Uri; diags: vscode.Diagnostic[] }>();

    for (const err of errors) {
        const filePath = resolveErrorFilePath(err.file, projectDir);
        const uri = vscode.Uri.file(filePath);
        const key = uri.fsPath;
        if (!byFile.has(key)) {
            byFile.set(key, { uri, diags: [] });
        }

        const line = Math.max(0, err.line - 1);
        const range = new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER);
        const diag = new vscode.Diagnostic(range, err.message, vscode.DiagnosticSeverity.Error);
        diag.source = 'GPL Compiler';
        diag.code = err.code;
        byFile.get(key)!.diags.push(diag);
    }

    for (const { uri, diags } of byFile.values()) {
        collection.set(uri, diags);
    }
}

/**
 * 컴파일러가 보고한 파일명을 로컬 절대경로로 해석한다.
 * 1) 절대경로면 그대로, 2) projectDir 바로 아래에 있으면 그 경로,
 * 3) 못 찾으면 projectDir 하위에서 동일 파일명을 한 번 탐색(최선 노력),
 * 4) 그래도 없으면 projectDir 기준 경로를 반환(진단은 Problems 패널에 표시됨).
 */
export function resolveErrorFilePath(file: string, projectDir: string): string {
    if (path.isAbsolute(file)) {
        return file;
    }
    const direct = path.join(projectDir, file);
    if (fs.existsSync(direct)) {
        return direct;
    }
    try {
        const base = path.basename(file);
        const stack = [projectDir];
        while (stack.length > 0) {
            const dir = stack.pop()!;
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                if (entry.isDirectory()) {
                    if (entry.name === 'node_modules' || entry.name === '.git') { continue; }
                    stack.push(path.join(dir, entry.name));
                } else if (entry.name.toLowerCase() === base.toLowerCase()) {
                    return path.join(dir, entry.name);
                }
            }
        }
    } catch {
        // 탐색 실패는 무시하고 기본 경로 사용
    }
    return direct;
}

/**
 * 첫 번째 컴파일 에러 위치로 포커스·커서를 이동하고 Problems 패널을 표시한다.
 * (수동 Deploy/Quick Compile과 디버그 F5 배포 경로 공통 UX.
 *  설정 gpl.deploy.jumpToFirstError로 토글, 기본 켜짐.)
 */
export async function jumpToFirstCompileError(
    errors: CompileError[],
    projectDir: string,
    logError: (message: string) => void
): Promise<void> {
    if (errors.length === 0) { return; }
    const jumpEnabled = vscode.workspace
        .getConfiguration('gpl')
        .get<boolean>('deploy.jumpToFirstError', true);
    if (!jumpEnabled) { return; }

    const first = errors[0];
    // Problems 패널 명령은 키보드 포커스를 패널로 가져가므로 편집기 점프보다
    // 먼저 실행해야 최종 포커스·커서가 에러 줄의 편집기에 남는다.
    await vscode.commands.executeCommand('workbench.actions.view.problems');
    try {
        const filePath = resolveErrorFilePath(first.file, projectDir);
        const doc = await vscode.workspace.openTextDocument(filePath);
        const editor = await vscode.window.showTextDocument(doc, { preview: false });
        const lineIdx = Math.min(Math.max(0, first.line - 1), doc.lineCount - 1);
        const lineInfo = doc.lineAt(lineIdx);
        // 컴파일러는 파일:줄만 보고하므로(컬럼 없음) 들여쓰기 뒤 첫 문자에 커서를 둔다.
        const cursor = new vscode.Position(lineIdx, lineInfo.firstNonWhitespaceCharacterIndex);
        editor.selection = new vscode.Selection(cursor, cursor);
        editor.revealRange(lineInfo.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    } catch (jumpErr: any) {
        logError(`첫 에러 파일 열기 실패: ${jumpErr?.message ?? jumpErr}`);
    }
}

/**
 * 워크스페이스에서 프로젝트 폴더 자동 감지.
 * .gpr 파일이 있는 폴더를 찾아 반환한다.
 */
export async function findProjectDirs(): Promise<string[]> {
    const gprFiles = await vscode.workspace.findFiles(
        '**/*.gpr',
        // .history(Local History 확장)에는 과거 이름의 stale .gpr 사본이 쌓여 프로젝트
        // 오인식을 유발하므로 dist/out과 함께 제외한다.
        '{**/node_modules/**,**/bin/**,**/.git/**,**/.history/**,**/dist/**,**/out/**}'
    );

    // 동일 폴더 내 여러 .gpr가 있어도 폴더는 중복 없이 반환
    return [...new Set(gprFiles.map(uri => path.dirname(uri.fsPath)))];
}
