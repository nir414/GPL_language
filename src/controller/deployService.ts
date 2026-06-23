/**
 * 배포 서비스: STOP → UPLOAD → COMPILE (→ START) 워크플로.
 * skipStart 옵션으로 Start 단계를 생략하여 디버그 준비용으로 사용 가능.
 * controller-f5.ps1의 핵심 로직을 TypeScript로 포팅.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { sendCommand, sendCommandDetailed, trySendCommand, getControllerConfig, ControllerConfig, CommandResponseMeta } from './controllerConnection';
import { uploadProject, listRemoteDir } from './ftpClient';
import { parseCompileErrors, parseStatus, isSuccess, parseGpr, parseErrorLog, CompileError, isControllerNonBlockingStatus } from './responseParser';
import { isTransientCompileStatus, isProjectAlreadyLoaded, isProjectNotLoaded } from './controllerStatusCodes';

export interface DeployOptions {
    projectDir: string;
    skipUnchanged?: boolean;
    skipStart?: boolean;
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
    uploadStats?: { uploaded: number; skipped: number; totalBytes: number };
    failedPhase?: 'STOP' | 'UPLOAD' | 'COMPILE' | 'START' | 'ERROR_CHECK';
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

    const remotePath = await chooseRemoteProjectPath(folderName);
    const ftpProjectDir = remotePath.projectPath;
    const loadPath = ftpProjectDir;
    result.selectedRemoteBasePath = remotePath.basePath;
    result.selectedRemoteProjectPath = remotePath.projectPath;
    result.candidateRemoteProjectPaths = remotePath.candidates;
    const totalPhases = options.skipStart ? 4 : 5;
    let phase = 0;

    pushTrace(`╭──────────────────────────────────────────────────────╮`);
    pushTrace(`│  ◆ ${projectName}${options.skipStart ? ' (Build Only)' : ''}`);
    pushTrace(`├──────────────────────────────────────────────────────┤`);
    pushTrace(`│  Local:  ${options.projectDir}`);
    pushTrace(`│  FTP:    ${ftpProjectDir}`);
    pushTrace(`│  Selected base path: ${remotePath.basePath}`);
    pushTrace(`│  Path candidates: ${remotePath.candidates.join(' | ')}`);
    pushTrace(`│  Target: ${cfg.ip}:${cfg.port}`);
    pushTrace(`╰──────────────────────────────────────────────────────╯`);

    // ── Phase 1: STOP ─────────────────────────────

    pushTrace('');
    phase++;
    pushTrace(`━━ [${phase}/${totalPhases}] STOP ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    pushTrace('│ CMD Stop -all');

    if (token?.isCancellationRequested) { return result; }

    const stopResp = await trySendCommand('Stop -all', cfg);
    if (stopResp === null) {
        pushTrace('│ ⚠ Stop -all failed or timed out. Retrying...');
        const stopRespRetry = await trySendCommand('Stop -all', cfg);
        if (stopRespRetry === null) {
            pushTrace('│ ✘ Stop -all failed after retry');
            result.failedPhase = 'STOP';
            result.failedCommand = 'Stop -all';
            result.failedStatusMessage = 'No response (timeout or connection failure)';
            return result;
        }
        const stopStatusRetry = parseStatus(stopRespRetry);
        pushTrace(`│ RAW ${rawPreview(stopRespRetry) || '(empty)'}`);
        if (stopStatusRetry.code !== 0) {
            pushTrace(`│ ✘ Stop -all failed: STATUS ${stopStatusRetry.code}: ${stopStatusRetry.message}`);
            result.failedPhase = 'STOP';
            result.failedCommand = 'Stop -all';
            result.failedStatusCode = stopStatusRetry.code;
            result.failedStatusMessage = stopStatusRetry.message;
            return result;
        }
    } else {
        const stopStatus = parseStatus(stopResp);
        pushTrace(`│ RAW ${rawPreview(stopResp) || '(empty)'}`);
        if (stopStatus.code !== 0) {
            pushTrace(`│ ✘ Stop -all failed: STATUS ${stopStatus.code}: ${stopStatus.message}`);
            result.failedPhase = 'STOP';
            result.failedCommand = 'Stop -all';
            result.failedStatusCode = stopStatus.code;
            result.failedStatusMessage = stopStatus.message;
            return result;
        }
    }
    pushTrace('│ ✔ Stop complete');

    // ── Phase 2: UPLOAD ───────────────────────────

    pushTrace('');
    phase++;
    pushTrace(`━━ [${phase}/${totalPhases}] UPLOAD ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    if (token?.isCancellationRequested) { return result; }

    try {
        const stats = await uploadProject(cfg.ip, options.projectDir, ftpProjectDir, {
            skipUnchanged: options.skipUnchanged,
            onProgress: (current, total, file) => {
                const pct = Math.floor((current / total) * 100);
                pushTrace(`│ [${current}/${total}] (${pct}%) ${file}`);
            },
        });
        result.uploadStats = stats;
        pushTrace(`│ ✔ Upload done: ${stats.uploaded} sent, ${stats.skipped} skipped`);
        pushTrace(`│   Compile below validates the uploaded controller copy at ${ftpProjectDir}`);
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

    const compileCandidates = [...new Set([projectName, gprInfo.projectName, folderName].filter(Boolean))];
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
                idleMs: 300,
                minResponseBytes: 10,
                // STATUS 누락/분할 수신 완화용 보강 수신 window
                extraIdleMsOnIncomplete: 250,
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

            // P0: STATUS 누락 내성
            if (statusMissing && errors.length === 0) {
                if (hasCompileSuccessful) {
                    return {
                        ok: true,
                        statusCode: 0,
                        errors,
                        raw: resp,
                        responseMeta: detailed.meta,
                        note: 'STATUS missing tolerated by compile-success marker',
                        needsFollowUp: false,
                    };
                }

                if (hasCompilePassLog) {
                    return {
                        ok: false,
                        statusCode: status.code,
                        errors,
                        raw: resp,
                        responseMeta: detailed.meta,
                        note: 'STATUS missing with compile-pass logs; follow-up required',
                        needsFollowUp: true,
                    };
                }
            }

            return {
                ok: false,
                statusCode: status.code,
                errors,
                raw: resp,
                responseMeta: detailed.meta,
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

    // 업로드된 /flash 프로젝트 복사본을 실제 컴파일 대상으로 강제 동기화한다.
    // 이유: 이미 로드된 /GPL 프로젝트가 남아 있으면, Compile <name>이 로컬 최신 업로드가 아닌
    //      이전 로드본을 대상으로 실행될 수 있어 오판정(예: 과거 컴파일 에러 재발견)이 발생한다.
    const reloadTargets = [...new Set(compileCandidates)];
    pushTrace(`│ Sync loaded project with uploaded copy`);
    for (const target of reloadTargets) {
        const unloaded = await tryUnload(target);
        if (!unloaded) {
            pushTrace(`│ ⚠ Unload failed but continue: ${target}`);
        }
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

    for (const candidate of compileCandidates) {
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
            compiled = true;
            pushTrace(`│ ✔ Compile success: ${candidate}`);
            break;
        }

        // STATUS 누락 + pass 로그 케이스는 즉시 실패하지 않고 보강 판정 1회 수행
        if (cr.needsFollowUp) {
            pushTrace('│ ⚠ Compile STATUS 누락 감지: 보강 판정(Show Thread 1회)');
            const follow = await runStatusCommand('Show Thread');
            pushTrace(`│ RAW ${rawPreview(follow.raw) || '(empty)'}`);
            if (follow.ok) {
                const warning = `Compile ${candidate}: STATUS 누락 응답을 보강 판정(Show Thread)으로 성공 처리`;
                result.precheckWarnings.push(warning);
                result.projectName = candidate;
                result.compileErrors = [];
                compiled = true;
                pushTrace(`│ ✔ Compile success (STATUS missing tolerated): ${candidate}`);
                pushTrace(`│ ⚠ ${warning}`);
                break;
            }
            pushTrace(`│ ⚠ Follow-up failed: STATUS ${follow.statusCode}: ${follow.message || 'Unknown error'}`);
        }

        result.compileErrors = cr.errors;
        const errText = cr.raw;

        // -745: project already loaded → Unload + Load + Compile
        if (isProjectAlreadyLoaded(cr.statusCode) || errText.includes('-745')) {
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
        }
        // -508/-743: missing/invalid → Load + Compile
        else if (isProjectNotLoaded(cr.statusCode)
            || errText.includes('-508') || errText.includes('-743')) {
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
        }

        pushTrace(`│ ✘ Compile failed: ${candidate}`);
        if (cr.statusCode !== 0) {
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
            pushTrace(`│   ${err.file}:${err.line} (${err.code}): ${err.message}`);
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
    const byFile = new Map<string, vscode.Diagnostic[]>();

    for (const err of errors) {
        const filePath = path.isAbsolute(err.file)
            ? err.file
            : path.join(projectDir, err.file);

        const uri = vscode.Uri.file(filePath).toString();
        if (!byFile.has(uri)) {
            byFile.set(uri, []);
        }

        const line = Math.max(0, err.line - 1);
        const range = new vscode.Range(line, 0, line, 1000);
        const diag = new vscode.Diagnostic(range, err.message, vscode.DiagnosticSeverity.Error);
        diag.source = 'GPL Compiler';
        diag.code = err.code;
        byFile.get(uri)!.push(diag);
    }

    for (const [uriStr, diags] of byFile) {
        collection.set(vscode.Uri.parse(uriStr), diags);
    }
}

/**
 * 워크스페이스에서 프로젝트 폴더 자동 감지.
 * .gpr 파일이 있는 폴더를 찾아 반환한다.
 */
export async function findProjectDirs(): Promise<string[]> {
    const gprFiles = await vscode.workspace.findFiles(
        '**/*.gpr',
        '{**/node_modules/**,**/bin/**,**/.git/**}'
    );

    // 동일 폴더 내 여러 .gpr가 있어도 폴더는 중복 없이 반환
    return [...new Set(gprFiles.map(uri => path.dirname(uri.fsPath)))];
}
