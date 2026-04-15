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
import { parseCompileErrors, parseStatus, parseGpr, parseErrorLog, CompileError } from './responseParser';

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
    token?: vscode.CancellationToken
): Promise<DeployResult> {
    const cfg = getControllerConfig();
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

    for (const candidate of compileCandidates) {
        output.appendLine(`│ Compile ${candidate}`);
        try {
            await sendCommand(`Compile ${candidate}`, cfg);
            result.projectName = candidate;
            compiled = true;
            output.appendLine(`│ ✔ Compile success: ${candidate}`);
            break;
        } catch (e: any) {
            const errText = e.message || '';
            result.compileErrors = parseCompileErrors(errText);

            // -745: project already loaded → Unload + Load + Compile
            if (errText.includes('-745')) {
                output.appendLine(`│ ⚠ Already loaded. Unload → Load → Compile`);
                try {
                    await sendCommand(`Unload ${candidate}`, cfg);
                    await sendCommand(`Load ${loadPath}`, cfg);
                    await sendCommand(`Compile ${candidate}`, cfg);
                    result.projectName = candidate;
                    compiled = true;
                    output.appendLine(`│ ✔ Compile success (after reload): ${candidate}`);
                    break;
                } catch (e2: any) {
                    result.compileErrors = parseCompileErrors(e2.message || '');
                }
            }
            // -508/-743: missing/invalid → Load + Compile
            else if (errText.includes('-508') || errText.includes('-743')) {
                output.appendLine(`│ ⚠ Not loaded. Load → Compile`);
                try {
                    await sendCommand(`Load ${loadPath}`, cfg);
                    await sendCommand(`Compile ${candidate}`, cfg);
                    result.projectName = candidate;
                    compiled = true;
                    output.appendLine(`│ ✔ Compile success (after load): ${candidate}`);
                    break;
                } catch (e2: any) {
                    result.compileErrors = parseCompileErrors(e2.message || '');
                }
            }

            output.appendLine(`│ ✘ Compile failed: ${candidate}`);
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
        try {
            await sendCommand(`Start ${result.projectName}`, cfg);
            output.appendLine(`│ ✔ Start success`);
        } catch (e: any) {
            output.appendLine(`│ ✘ Start failed: ${e.message}`);
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
        '**/Project.gpr',
        '{**/node_modules/**,**/bin/**,**/.git/**}'
    );

    return gprFiles.map(uri => path.dirname(uri.fsPath));
}
