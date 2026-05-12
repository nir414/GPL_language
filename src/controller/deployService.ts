/**
 * 배포 서비스: STOP → UPLOAD → COMPILE (→ START) 워크플로.
 * skipStart 옵션으로 Start 단계를 생략하여 디버그 준비용으로 사용 가능.
 * controller-f5.ps1의 핵심 로직을 TypeScript로 포팅.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { sendCommand, trySendCommand, getControllerConfig, ControllerConfig } from './controllerConnection';
import { uploadProject } from './ftpClient';
import { parseCompileErrors, parseStatus, isSuccess, parseGpr, parseErrorLog, CompileError } from './responseParser';

export interface DeployOptions {
    projectDir: string;
    skipUnchanged?: boolean;
    skipStart?: boolean;
}

export interface DeployResult {
    success: boolean;
    projectName: string;
    compileErrors: CompileError[];
    errorLog: string[];
    uploadStats?: { uploaded: number; skipped: number; totalBytes: number };
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
        errorLog: [],
    };

    output.show(true);
    diagnosticCollection.clear();

    // ── .gpr 파싱 ──────────────────────────────

    const gprFiles = fs.readdirSync(options.projectDir).filter(f => f.toLowerCase().endsWith('.gpr'));
    if (gprFiles.length === 0) {
        output.appendLine('✘ No .gpr file found in project directory');
        return result;
    }

    const gprText = fs.readFileSync(path.join(options.projectDir, gprFiles[0]), 'utf8');
    const gprInfo = parseGpr(gprText);
    const folderName = path.basename(options.projectDir);
    const projectName = gprInfo.projectName || folderName;
    result.projectName = projectName;

    const ftpProjectDir = `${cfg.ftpBasePath}/${folderName}`;
    const loadPath = ftpProjectDir;
    const totalPhases = options.skipStart ? 4 : 5;
    let phase = 0;

    output.appendLine(`╭──────────────────────────────────────────────────────╮`);
    output.appendLine(`│  ◆ ${projectName}${options.skipStart ? ' (Build Only)' : ''}`);
    output.appendLine(`├──────────────────────────────────────────────────────┤`);
    output.appendLine(`│  Local:  ${options.projectDir}`);
    output.appendLine(`│  FTP:    ${ftpProjectDir}`);
    output.appendLine(`│  Target: ${cfg.ip}:${cfg.port}`);
    output.appendLine(`╰──────────────────────────────────────────────────────╯`);

    // ── Phase 1: STOP ─────────────────────────────

    output.appendLine('');
    phase++;
    output.appendLine(`━━ [${phase}/${totalPhases}] STOP ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    output.appendLine('│ Stop -all');

    if (token?.isCancellationRequested) { return result; }

    const stopResp = await trySendCommand('Stop -all', cfg);
    if (stopResp === null) {
        output.appendLine('│ ⚠ Stop -all failed or timed out. Retrying...');
        await trySendCommand('Stop -all', cfg);
    }
    output.appendLine('│ ✔ Stop complete');

    // ── Phase 2: UPLOAD ───────────────────────────

    output.appendLine('');
    phase++;
    output.appendLine(`━━ [${phase}/${totalPhases}] UPLOAD ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    if (token?.isCancellationRequested) { return result; }

    try {
        const stats = await uploadProject(cfg.ip, options.projectDir, ftpProjectDir, {
            skipUnchanged: options.skipUnchanged,
            onProgress: (current, total, file) => {
                const pct = Math.floor((current / total) * 100);
                output.appendLine(`│ [${current}/${total}] (${pct}%) ${file}`);
            },
        });
        result.uploadStats = stats;
        output.appendLine(`│ ✔ Upload done: ${stats.uploaded} sent, ${stats.skipped} skipped`);
        output.appendLine(`│   Compile below validates the uploaded controller copy at ${ftpProjectDir}`);
    } catch (e: any) {
        output.appendLine(`│ ✘ Upload failed: ${e.message}`);
        return result;
    }

    // ── Phase 3: COMPILE ──────────────────────────

    output.appendLine('');
    phase++;
    output.appendLine(`━━ [${phase}/${totalPhases}] COMPILE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    if (token?.isCancellationRequested) { return result; }

    const compileCandidates = [...new Set([projectName, gprInfo.projectName, folderName].filter(Boolean))];
    let compiled = false;

    /** Compile 명령 실행 후 응답의 STATUS와 에러를 검사하는 헬퍼. */
    async function tryCompile(candidate: string): Promise<{ ok: boolean; statusCode: number; errors: CompileError[]; raw: string }> {
        try {
            const resp = await sendCommand(`Compile ${candidate}`, cfg);
            const status = parseStatus(resp);
            const errors = parseCompileErrors(resp);
            if (status.code === 0 && errors.length === 0) {
                return { ok: true, statusCode: status.code, errors, raw: resp };
            }
            return { ok: false, statusCode: status.code, errors, raw: resp };
        } catch (e: any) {
            const errText = e.message || '';
            return { ok: false, statusCode: -9999, errors: parseCompileErrors(errText), raw: errText };
        }
    }

    async function runStatusCommand(command: string): Promise<{ ok: boolean; statusCode: number; message: string; raw: string }> {
        try {
            const raw = await sendCommand(command, cfg);
            const status = parseStatus(raw);
            return {
                ok: status.code === 0,
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
        output.appendLine(`│ Load ${loadPath}`);
        const load = await runStatusCommand(`Load ${loadPath}`);
        if (load.ok) {
            output.appendLine(`│ ✔ Load success: ${candidate} ← ${loadPath}`);
            return true;
        }
        if (load.statusCode === -745) {
            output.appendLine(`│ ✔ Load skipped: already loaded (${candidate})`);
            return true;
        }
        output.appendLine(`│ ✘ Load failed: STATUS ${load.statusCode}: ${load.message || 'Unknown error'}`);
        return false;
    }

    async function tryUnload(candidate: string): Promise<boolean> {
        output.appendLine(`│ Unload ${candidate}`);
        const unload = await runStatusCommand(`Unload ${candidate}`);
        if (unload.ok) {
            output.appendLine(`│ ✔ Unload success: ${candidate}`);
            return true;
        }
        if (unload.statusCode === -508 || unload.statusCode === -743) {
            output.appendLine(`│ ✔ Unload skipped: project not loaded (${candidate})`);
            return true;
        }
        output.appendLine(`│ ✘ Unload failed: STATUS ${unload.statusCode}: ${unload.message || 'Unknown error'}`);
        return false;
    }

    for (const candidate of compileCandidates) {
        output.appendLine(`│ Compile ${candidate}`);
        const cr = await tryCompile(candidate);

        if (cr.ok) {
            result.projectName = candidate;
            compiled = true;
            output.appendLine(`│ ✔ Compile success: ${candidate}`);
            break;
        }

        result.compileErrors = cr.errors;
        const errText = cr.raw;

        // -745: project already loaded → Unload + Load + Compile
        if (cr.statusCode === -745 || errText.includes('-745')) {
            output.appendLine(`│ ⚠ Already loaded. Unload → Load → Compile`);
            const unloaded = await tryUnload(candidate);
            if (!unloaded) {
                continue;
            }
            const loaded = await ensureLoadedFromFtpPath(candidate);
            if (!loaded) {
                continue;
            }
            const cr2 = await tryCompile(candidate);
            if (cr2.ok) {
                result.projectName = candidate;
                result.compileErrors = [];
                compiled = true;
                output.appendLine(`│ ✔ Compile success (after reload): ${candidate}`);
                break;
            }
            result.compileErrors = cr2.errors;
        }
        // -508/-743: missing/invalid → Load + Compile
        else if (cr.statusCode === -508 || cr.statusCode === -743
            || errText.includes('-508') || errText.includes('-743')) {
            output.appendLine(`│ ⚠ Not loaded. Load → Compile`);
            const loaded = await ensureLoadedFromFtpPath(candidate);
            if (!loaded) {
                continue;
            }
            const cr2 = await tryCompile(candidate);
            if (cr2.ok) {
                result.projectName = candidate;
                result.compileErrors = [];
                compiled = true;
                output.appendLine(`│ ✔ Compile success (after load): ${candidate}`);
                break;
            }
            result.compileErrors = cr2.errors;
        }

        output.appendLine(`│ ✘ Compile failed: ${candidate}`);
        if (cr.statusCode !== 0) {
            const status = parseStatus(cr.raw);
            output.appendLine(`│   STATUS ${status.code}: ${status.message}`);
        }
    }

    // 컴파일 에러 → vscode.Diagnostic 주입
    if (result.compileErrors.length > 0) {
        applyCompileDiagnostics(result.compileErrors, options.projectDir, diagnosticCollection);
        for (const err of result.compileErrors) {
            output.appendLine(`│   ${err.file}:${err.line} (${err.code}): ${err.message}`);
        }
    }

    if (!compiled) {
        output.appendLine('│ ✘ All compile attempts failed');
        return result;
    }

    // ── Phase 4: START ────────────────────────────

    if (!options.skipStart) {
        output.appendLine('');
        phase++;
        output.appendLine(`━━ [${phase}/${totalPhases}] START ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

        if (token?.isCancellationRequested) { return result; }

        output.appendLine(`│ Start ${result.projectName}`);
        const start = await runStatusCommand(`Start ${result.projectName}`);
        if (start.ok) {
            output.appendLine(`│ ✔ Start success`);
        } else {
            output.appendLine(`│ ✘ Start failed: STATUS ${start.statusCode}: ${start.message || 'Unknown error'}`);
            return result;
        }
    }

    // ── Phase: ERROR CHECK ─────────────────

    output.appendLine('');
    phase++;
    output.appendLine(`━━ [${phase}/${totalPhases}] ERROR CHECK ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    const errorLogResp = await trySendCommand('ErrorLog', cfg);
    if (errorLogResp) {
        result.errorLog = parseErrorLog(errorLogResp);
        if (result.errorLog.length === 0) {
            output.appendLine('│ ✔ No active errors');
        } else {
            output.appendLine(`│ ⚠ ${result.errorLog.length} error(s):`);
            for (const el of result.errorLog) {
                output.appendLine(`│   ${el}`);
            }
        }
    }

    result.success = compiled;

    const doneLabel = options.skipStart ? 'Build' : 'Deploy';
    output.appendLine('');
    output.appendLine('══════════════════════════════════════════════════════');
    output.appendLine(`✔ ${doneLabel} ${result.success ? 'complete' : 'failed'}: ${result.projectName}`);
    output.appendLine('══════════════════════════════════════════════════════');

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
