/**
 * 배포 서비스: STOP → UPLOAD → COMPILE (→ START) 워크플로.
 * skipStart 옵션으로 Start 단계를 생략하여 디버그 준비용으로 사용 가능.
 * controller-f5.ps1의 핵심 로직을 TypeScript로 포팅.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { sendCommand, sendCommandDetailed, trySendCommand, getControllerConfig, ControllerConfig, CommandResponseMeta } from './controllerConnection';
import { uploadProject, mirrorProject, listRemoteDir } from './ftpClient';
import { parseCompileErrors, parseStatus, isSuccess, parseGpr, parseErrorLog, parseThreadList, ThreadInfo, CompileError, isControllerNonBlockingStatus, SHOW_THREAD_LIST_CMD } from './responseParser';
import { isTransientCompileStatus, isProjectAlreadyLoaded, isProjectNotLoaded } from './controllerStatusCodes';

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
     * Quick Compile용 직접 /GPL 업로드 모드.
     * Load 문서 Remarks("an external file-copy utility such as FTP can be used to create
     * the folder and copy the files")에 따라 /GPL/<projectName>에 FTP로 직접 파일을 써서
     * Unload(-750 쓰레드 락)와 Load("대상 폴더가 이미 존재하면 안 됨") 제약을 모두 우회한다.
     * /GPL/<projectName> 폴더가 원격에 없으면 자동으로 기존(flash 업로드 + Unload/Load) 경로로 폴백.
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
}

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
    failedPhase?: 'STOP' | 'THREAD_CHECK' | 'UPLOAD' | 'COMPILE' | 'START' | 'ERROR_CHECK';
    failedCommand?: string;
    failedStatusCode?: number;
    failedStatusMessage?: string;
    attemptedProjectNames?: string[];
    trace: string[];
}

/**
 * 프로젝트를 제어기에 배포한다.
 * Output channel에 단계별 진행 상태를 출력한다.
 */
export async function deploy(
    options: DeployOptions,
    output: vscode.OutputChannel,
    diagnosticCollection: vscode.DiagnosticCollection,
    token?: vscode.CancellationToken,
    controllerOverride?: Partial<ControllerConfig>
): Promise<DeployResult> {
    const cfg = { ...getControllerConfig(), ...controllerOverride };
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

    output.show(true);
    diagnosticCollection.clear();

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
    if (options.directGpl) {
        try {
            const gplEntries = await listRemoteDir(cfg.ip, '/GPL');
            const hit = gplEntries.find(e => e.isDirectory && e.name.toLowerCase() === projectName.toLowerCase());
            if (hit) {
                directGplName = hit.name;
                directGplDir = `/GPL/${hit.name}`;
            }
        } catch (e: any) {
            directProbeError = e?.message || String(e);
        }
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
    // UPLOAD + COMPILE + ERROR CHECK(항상 수행) = 3, STOP/START는 옵션.
    const totalPhases = 3 + (options.skipStop ? 0 : 1) + (options.skipStart ? 0 : 1);
    let phase = 0;

    pushTrace(`╭──────────────────────────────────────────────────────╮`);
    pushTrace(`│  ◆ ${projectName}${options.skipStop ? ' (Quick Compile)' : options.skipStart ? ' (Build Only)' : ''}`);
    pushTrace(`├──────────────────────────────────────────────────────┤`);
    pushTrace(`│  Local:  ${options.projectDir}`);
    pushTrace(`│  FTP:    ${ftpProjectDir}`);
    if (directActive) {
        pushTrace(`│  Mode:   direct /GPL upload — Unload/Load 생략`);
    } else if (options.directGpl) {
        pushTrace(`│  Mode:   classic (direct /GPL 폴백${directProbeError ? `: probe 실패 ${directProbeError}` : ': /GPL에 프로젝트 폴더 없음 — 최초 1회는 전체 배포 필요'})`);
    }
    pushTrace(`│  Selected base path: ${result.selectedRemoteBasePath}`);
    pushTrace(`│  Path candidates: ${(result.candidateRemoteProjectPaths ?? []).join(' | ')}`);
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

    /** Stop -all 전송(무응답 시 1회 재시도). 성공이면 null, 실패면 실패 정보를 반환. */
    async function sendStopAll(): Promise<{ command: string; code?: number; message: string } | null> {
        pushTrace('│ CMD Stop -all');
        let resp = await trySendCommand('Stop -all', cfg);
        if (resp === null) {
            pushTrace('│ ⚠ Stop -all failed or timed out. Retrying...');
            resp = await trySendCommand('Stop -all', cfg);
            if (resp === null) {
                pushTrace('│ ✘ Stop -all failed after retry');
                return { command: 'Stop -all', message: 'No response (timeout or connection failure)' };
            }
        }
        const status = parseStatus(resp);
        pushTrace(`│ RAW ${rawPreview(resp) || '(empty)'}`);
        if (status.code !== 0) {
            pushTrace(`│ ✘ Stop -all failed: STATUS ${status.code}: ${status.message}`);
            return { command: 'Stop -all', code: status.code, message: status.message };
        }
        pushTrace('│ ✔ Stop complete (요청 접수)');
        return null;
    }

    /**
     * Stop 완료 게이트: 모든 쓰레드가 Idle/Stopped/Error가 될 때까지 폴링 대기.
     * Show Thread 무응답 시에는 확인 불가로 보고 경고 후 통과시킨다(기존 동작 수준 유지).
     */
    async function waitThreadsSettle(timeoutMs = 8000): Promise<{ ok: boolean; cancelled?: boolean; activeDesc?: string }> {
        const deadline = Date.now() + timeoutMs;
        let lastActiveDesc = '';
        while (Date.now() < deadline) {
            if (token?.isCancellationRequested) { return { ok: false, cancelled: true }; }
            const probe = await probeActiveThreads();
            if (probe === null) {
                pushTrace('│ ⚠ Show Thread 무응답 — 정지 완료 확인 불가(계속 진행)');
                return { ok: true };
            }
            if (probe.active.length === 0) {
                pushTrace(`│ ✔ 모든 쓰레드 정지 확인 (${probe.total}개)`);
                return { ok: true };
            }
            lastActiveDesc = probe.active.map(t => `${t.name}(${t.state})`).join(', ');
            pushTrace(`│ … 정지 대기: ${lastActiveDesc}`);
            await sleep(500);
        }
        return { ok: false, activeDesc: lastActiveDesc };
    }

    /** Stop -all → 정지 완료 게이트를 수행하고, 실패 시 result에 기록한다. true면 계속 진행 가능. */
    async function stopAllAndSettle(): Promise<boolean> {
        const stopFail = await sendStopAll();
        if (stopFail) {
            result.failedPhase = 'STOP';
            result.failedCommand = stopFail.command;
            result.failedStatusCode = stopFail.code;
            result.failedStatusMessage = stopFail.message;
            return false;
        }
        const settle = await waitThreadsSettle();
        if (settle.cancelled) { return false; }
        if (!settle.ok) {
            pushTrace(`│ ✘ Stop -all 후에도 쓰레드가 정지되지 않음: ${settle.activeDesc}`);
            pushTrace('│   → 정지 미완료 상태에서 Compile/Start를 보내지 않고 중단합니다.');
            result.failedPhase = 'STOP';
            result.failedCommand = 'Show Thread (stop settle gate)';
            result.failedStatusMessage = `Stop -all 후에도 활성 쓰레드 존재: ${settle.activeDesc}`;
            return false;
        }
        return true;
    }

    // ── Phase 1: STOP ─────────────────────────────

    if (!options.skipStop) {
        pushTrace('');
        phase++;
        pushTrace(`━━ [${phase}/${totalPhases}] STOP ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

        if (token?.isCancellationRequested) { return result; }

        if (!(await stopAllAndSettle())) {
            return result;
        }
    } else {
        // STOP 단계 생략(빠른 컴파일). phase는 올리지 않아 UPLOAD가 [1/N]이 되도록 한다.
        // 대신 활성 쓰레드가 있으면 업로드/Compile 전에 사용자에게 Stop 여부를 확인한다
        // (정지 미완료 상태의 Compile/Start는 제어기 이상을 유발할 수 있음, §0.6).
        pushTrace('');
        pushTrace('━━ [SKIP] STOP 생략 (빠른 컴파일) — 쓰레드 상태 확인 ━━━━━━━━━━━━');
        const probe = await probeActiveThreads();
        if (probe === null) {
            pushTrace('│ ⚠ Show Thread 무응답 — 쓰레드 상태 확인 불가(계속 진행)');
        } else if (probe.active.length > 0) {
            const desc = probe.active.map(t => `${t.name}(${t.state})`).join(', ');
            pushTrace(`│ ⚠ 활성 쓰레드 존재: ${desc}`);

            let stopApproved = false;
            if (options.confirmStopOnActive) {
                pushTrace('│ … 사용자에게 Stop -all 실행 여부 확인 중');
                try {
                    stopApproved = await options.confirmStopOnActive(desc);
                } catch {
                    stopApproved = false;
                }
            }

            if (!stopApproved) {
                pushTrace('│ ✘ 중단: 활성 쓰레드 존재 (사용자 미승인 또는 확인 경로 없음)');
                pushTrace('│   → 프로그램 STOP 후 재시도하거나, STOP이 포함된 전체 배포를 사용하세요.');
                result.failedPhase = 'THREAD_CHECK';
                result.failedCommand = 'Show Thread';
                result.failedStatusMessage = `활성 쓰레드 존재: ${desc} — STOP 후 재시도하세요.`;
                return result;
            }

            pushTrace('│ ✔ 사용자 승인 — Stop -all 실행 후 정지 확인');
            if (!(await stopAllAndSettle())) {
                return result;
            }
        } else {
            pushTrace(`│ ✔ 활성 쓰레드 없음 (총 ${probe.total}개 모두 정지 상태)`);
        }
    }

    // ── Phase 2: UPLOAD ───────────────────────────

    pushTrace('');
    phase++;
    pushTrace(`━━ [${phase}/${totalPhases}] UPLOAD ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    if (token?.isCancellationRequested) { return result; }

    const changedFiles = (options.changedFiles ?? []).filter(Boolean);
    const useChangedOnly = changedFiles.length > 0;
    if (useChangedOnly) {
        pushTrace(`│ 변경 파일만 업로드(${changedFiles.length}개): ${changedFiles.map(f => path.basename(f)).join(', ')}`);
    }

    // Direct /GPL 모드에서 changedFiles 제약이 없는 경우(수동 Quick Compile, 디버그 F5)는
    // 미러 동기화한다: 크기가 다르거나 새로 생긴 파일만 올리고, 로컬에 없는 원격 파일은 삭제한다.
    // Unload로 /GPL 폴더를 통째로 비우는 대신 파일 단위로 맞춰 왕복을 줄이고(속도),
    // 로컬에서 지운/이름 바꾼 파일이 원격에 남아 오컴파일되는 것도 막는다(정확성).
    // autoOnSave(useChangedOnly)는 저장 파일만 올리는 초경량 경로라 전체 목록 조회/삭제가 있는 미러를 쓰지 않는다.
    const useMirror = directActive && !useChangedOnly;

    try {
        if (useMirror) {
            pushTrace('│ Mode: mirror sync (변경분만 업로드 + 원격 전용 파일 삭제, Unload 생략)');
            const stats = await mirrorProject(cfg.ip, options.projectDir, ftpProjectDir, {
                onProgress: (current, total, file) => {
                    const pct = Math.floor((current / total) * 100);
                    pushTrace(`│ [${current}/${total}] (${pct}%) ${file}`);
                },
                onDelete: (file) => {
                    pushTrace(`│ ✘ del ${file} (원격 전용 — 로컬에 없어 삭제)`);
                },
            });
            result.uploadStats = {
                uploaded: stats.uploaded,
                skipped: stats.skipped,
                totalBytes: stats.totalBytes,
                deleted: stats.deleted,
            };
            pushTrace(`│ ✔ Mirror done: ${stats.uploaded} sent, ${stats.skipped} skipped, ${stats.deleted} deleted`);
            pushTrace(`│   Compile below validates the mirrored controller copy at ${ftpProjectDir}`);
        } else {
            const stats = await uploadProject(cfg.ip, options.projectDir, ftpProjectDir, {
                skipUnchanged: options.skipUnchanged,
                onlyFiles: useChangedOnly ? changedFiles : undefined,
                onProgress: (current, total, file) => {
                    const pct = Math.floor((current / total) * 100);
                    pushTrace(`│ [${current}/${total}] (${pct}%) ${file}`);
                },
            });
            result.uploadStats = stats;
            pushTrace(`│ ✔ Upload done: ${stats.uploaded} sent, ${stats.skipped} skipped`);
            pushTrace(`│   Compile below validates the uploaded controller copy at ${ftpProjectDir}`);
        }
    } catch (e: any) {
        pushTrace(`│ ✘ Upload failed: ${e.message}`);
        result.failedPhase = 'UPLOAD';
        result.failedCommand = `Upload ${ftpProjectDir}`;
        result.failedStatusMessage = e?.message || 'Upload failed';
        return result;
    }

    // ── Phase 3: COMPILE ──────────────────────────

    pushTrace('');
    phase++;
    pushTrace(`━━ [${phase}/${totalPhases}] COMPILE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    if (token?.isCancellationRequested) { return result; }

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
        needsFollowUp: boolean;
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
            const statusMissing = status.code === -9999;
            const hasCompileSuccessful = /\bcompile\s+successful\b/i.test(resp);
            const hasCompilePassLog = /\bpass\s*1\b|\bpass\s*2\b|\bpass\s*3\b/i.test(resp);

            if (isControllerNonBlockingStatus(status.code) && errors.length === 0) {
                return {
                    ok: true,
                    statusCode: status.code,
                    errors,
                    raw: resp,
                    responseMeta: detailed.meta,
                    needsFollowUp: false,
                };
            }
            if (status.code === 0 && errors.length === 0) {
                return {
                    ok: true,
                    statusCode: status.code,
                    errors,
                    raw: resp,
                    responseMeta: detailed.meta,
                    needsFollowUp: false,
                };
            }

            // STATUS 종결자까지 대기했는데도 STATUS가 없으면(연결 끊김/타임아웃 등)
            // 컴파일 결과를 확인하지 못한 것이다. 과거에는 'compile successful' 텍스트나
            // pass 로그 + Show Thread 응답으로 성공 처리했으나, 이는 실제 컴파일 에러를
            // 가리는 오판의 직접 원인이었다(예: -742를 성공으로 보고). 따라서 절대 성공으로
            // 간주하지 않고, 결과 미확인으로서 실패 처리한다.
            void hasCompileSuccessful;
            void hasCompilePassLog;

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
                needsFollowUp: false,
            };
        } catch (e: any) {
            const errText = e.message || '';
            return {
                ok: false,
                statusCode: -9999,
                errors: parseCompileErrors(errText),
                raw: errText,
                needsFollowUp: false,
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
                command: `Compile ${candidate} (retry transient)` ,
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
        // 전체 배포로 초기화가 필요하다.
        if (directActive && (isProjectAlreadyLoaded(cr.statusCode) || isProjectNotLoaded(cr.statusCode)
            || hasCode(errText, -745) || hasCode(errText, -508) || hasCode(errText, -743))) {
            pushTrace('│ ✘ Direct /GPL 모드에서 로드 상태 이상 — 전체 배포(Deploy)로 다시 시도하세요.');
            lastCompileFailure = {
                command: `Compile ${candidate}`,
                code: cr.statusCode,
                message: `${parseStatus(cr.raw).message || 'Load-state error in direct /GPL mode'} — 전체 배포로 재시도 필요`,
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

    const errorLogResp = await trySendCommand('ErrorLog', cfg);
    if (errorLogResp) {
        pushTrace(`│ RAW ${rawPreview(errorLogResp) || '(empty)'}`);
        result.errorLog = parseErrorLog(errorLogResp);
        if (result.errorLog.length === 0) {
            pushTrace('│ ✔ No active errors');
        } else {
            pushTrace(`│ ⚠ ${result.errorLog.length} error(s):`);
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
    pushTrace(`✔ ${doneLabel} ${result.success ? 'complete' : 'failed'}: ${result.projectName}`);
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
