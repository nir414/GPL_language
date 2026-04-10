import * as vscode from 'vscode';
import { GPLDefinitionProvider } from './providers/definitionProvider';
import { GPLReferenceProvider } from './providers/referenceProvider';
import { GPLCompletionProvider } from './providers/completionProvider';
import { GPLDocumentSymbolProvider } from './providers/documentSymbolProvider';
import { GPLWorkspaceSymbolProvider } from './providers/workspaceSymbolProvider';
import { GPLDiagnosticProvider } from './providers/diagnosticProvider';
import { GPLCodeActionProvider } from './providers/codeActionProvider';
import { GPLFoldingRangeProvider } from './providers/foldingRangeProvider';
import { GPLHoverProvider } from './providers/hoverProvider';
import { SymbolCache } from './symbolCache';
import { getTraceServerLevel, isTraceOn, isGplDocument } from './config';

// Controller integration
import { testConnection, getControllerConfig } from './controller/controllerConnection';
import { deploy, findProjectDirs } from './controller/deployService';
import { RuntimeConsole } from './controller/runtimeConsole';
import { showControllerPicker } from './controller/controllerDiscovery';
import { ThreadTreeProvider } from './views/threadTreeProvider';
import { ConnectionStatusBar } from './views/connectionStatusBar';

// Global output channel for GPL extension logging
let outputChannel: vscode.OutputChannel;
let consoleChannel: vscode.OutputChannel;
let runtimeConsole: RuntimeConsole | undefined;
let statusBar: ConnectionStatusBar | undefined;
let threadProvider: ThreadTreeProvider | undefined;
let deployDiagnostics: vscode.DiagnosticCollection;

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('GPL Language Support');
    context.subscriptions.push(outputChannel);

    const thisExtension = vscode.extensions.all.find(ext => ext.extensionPath === context.extensionPath);
    const extVersion = thisExtension?.packageJSON?.version ?? 'unknown';
    outputChannel.appendLine(`GPL Language Support extension is now active! (v${extVersion})`);

    // Debug/trace logging (workspace/user settings)
    // - gpl.trace.server = off | messages | verbose
    const traceLevel = getTraceServerLevel(vscode.workspace);
    if (isTraceOn(vscode.workspace)) {
        outputChannel.appendLine(`[Trace] gpl.trace.server = ${traceLevel}`);
        outputChannel.show(true);
    }

    const symbolCache = new SymbolCache(outputChannel);
    const diagnosticProvider = new GPLDiagnosticProvider();
    
    // Register language providers
    // .gpl 파일은 (권장) gpl 언어로 열고, 호환을 위해 vb로 열린 경우도 지원한다.
    const gplSelectors: vscode.DocumentSelector = [
        { language: 'gpl', scheme: 'file', pattern: '**/*.gpl' },
        { language: 'vb', scheme: 'file', pattern: '**/*.gpl' },
        { scheme: 'file', pattern: '**/*.gpl' },
        { language: 'gpl', scheme: 'file', pattern: '**/*.gpo' },
        { language: 'vb', scheme: 'file', pattern: '**/*.gpo' },
        { scheme: 'file', pattern: '**/*.gpo' }
    ];

    // Definition provider (Go to Definition)
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(
            gplSelectors,
            new GPLDefinitionProvider(symbolCache, outputChannel)
        )
    );

    // Reference provider (Find All References)
    context.subscriptions.push(
        vscode.languages.registerReferenceProvider(
            gplSelectors,
            new GPLReferenceProvider(symbolCache, outputChannel)
        )
    );

    // Completion provider (IntelliSense)
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            gplSelectors,
            new GPLCompletionProvider(symbolCache),
            '.', ' ', '&'
        )
    );

    // Document symbol provider (Outline view)
    context.subscriptions.push(
        vscode.languages.registerDocumentSymbolProvider(
            gplSelectors,
            new GPLDocumentSymbolProvider()
        )
    );

    // Workspace symbol provider (Go to Symbol in Workspace)
    context.subscriptions.push(
        vscode.languages.registerWorkspaceSymbolProvider(
            new GPLWorkspaceSymbolProvider(symbolCache)
        )
    );

    // Folding provider (fix odd folding behavior on *.gpl)
    context.subscriptions.push(
        vscode.languages.registerFoldingRangeProvider(
            gplSelectors,
            new GPLFoldingRangeProvider()
        )
    );

    // Hover provider (Const value display)
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            gplSelectors,
            new GPLHoverProvider(symbolCache, outputChannel)
        )
    );

    // Code Action provider (Quick fixes and refactoring)
    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            gplSelectors,
            new GPLCodeActionProvider(),
            {
                providedCodeActionKinds: [
                    vscode.CodeActionKind.QuickFix,
                    vscode.CodeActionKind.Refactor,
                    vscode.CodeActionKind.RefactorRewrite,
                    vscode.CodeActionKind.Source
                ]
            }
        )
    );

    // Diagnostic provider registration
    context.subscriptions.push(diagnosticProvider);

    // Refresh symbols command
    context.subscriptions.push(
        vscode.commands.registerCommand('gpl.refreshSymbols', async () => {
            await symbolCache.refresh();
            outputChannel.appendLine('GPL symbols cache refreshed!');
            outputChannel.show();
            vscode.window.showInformationMessage('GPL symbols refreshed!');
        })
    );
    
    // Debug command to check symbol cache
    context.subscriptions.push(
        vscode.commands.registerCommand('gpl.debugSymbolCache', () => {
            const allSymbols = symbolCache.getAllSymbols();
            outputChannel.appendLine('=== GPL Symbol Cache Debug ===');
            outputChannel.appendLine(`Total symbols: ${allSymbols.length}`);
            
            // Group by file and class
            const byFile = new Map<string, any[]>();
            for (const sym of allSymbols) {
                const fileName = sym.filePath.split('\\').pop() || sym.filePath;
                if (!byFile.has(fileName)) {
                    byFile.set(fileName, []);
                }
                byFile.get(fileName)!.push(sym);
            }
            
            for (const [file, symbols] of byFile) {
                outputChannel.appendLine(`\n${file}:`);
                for (const sym of symbols) {
                    const classInfo = sym.className ? ` (in class ${sym.className})` : '';
                    const typeInfo = sym.returnType ? ` : ${sym.returnType}` : '';
                    outputChannel.appendLine(`  [${sym.kind}] ${sym.name}${typeInfo}${classInfo} @line ${sym.line + 1}`);
                }
            }
            
            outputChannel.show();
            vscode.window.showInformationMessage('Symbol cache debug info written to output channel');
        })
    );

    // XML 베스트 프랙티스 보기 명령
    context.subscriptions.push(
        vscode.commands.registerCommand('gpl.showXmlBestPractices', () => {
            const panel = vscode.window.createWebviewPanel(
                'gplXmlBestPractices',
                'GPL XML 베스트 프랙티스',
                vscode.ViewColumn.Two,
                {}
            );

            // Load HTML from media/ instead of hardcoding a huge template string in TS.
            // This improves maintainability and keeps src/ focused on logic.
            loadXmlBestPracticesHtml(context)
                .then(html => {
                    panel.webview.html = html;
                })
                .catch(err => {
                    outputChannel.appendLine(`[Webview] Failed to load xmlBestPractices.html: ${err}`);
                    panel.webview.html = getXmlBestPracticesFallbackHtml();
                });
        })
    );

    // XML 인코딩 분석 명령
    context.subscriptions.push(
        vscode.commands.registerCommand('gpl.analyzeXmlEncoding', () => {
            const activeEditor = vscode.window.activeTextEditor;
            if (!activeEditor || !isGplDocument(activeEditor.document)) {
                vscode.window.showWarningMessage('GPL 파일에서만 XML 분석이 가능합니다.');
                return;
            }

            // 현재 문서의 진단 업데이트
            diagnosticProvider.updateDiagnostics(activeEditor.document);
            vscode.window.showInformationMessage('XML 인코딩 분석이 완료되었습니다. 문제점을 확인하세요.');
        })
    );

    // Auto-refresh symbols and diagnostics when GPL files change
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((event) => {
            if (isGplDocument(event.document)) {
                symbolCache.updateDocument(event.document);
                diagnosticProvider.scheduleDiagnostics(event.document, 500);
            }
        })
    );

    // Keep caches clean on delete/rename to avoid stale symbols/diagnostics.
    context.subscriptions.push(
        vscode.workspace.onDidDeleteFiles((event) => {
            for (const uri of event.files) {
                symbolCache.removeFile(uri.fsPath);
                diagnosticProvider.clearDiagnostics(uri);
            }
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidRenameFiles(async (event) => {
            for (const f of event.files) {
                // Remove old cache/diagnostics
                symbolCache.removeFile(f.oldUri.fsPath);
                diagnosticProvider.clearDiagnostics(f.oldUri);

                // Re-index the new file path so symbol filePath stays correct
                try {
                    const document = await vscode.workspace.openTextDocument(f.newUri);
                    if (isGplDocument(document)) {
                        symbolCache.updateDocument(document);
                        diagnosticProvider.scheduleDiagnostics(document, 0);
                    }
                } catch (e) {
                    outputChannel.appendLine(`[Rename] Failed to re-index ${f.newUri.fsPath}: ${e}`);
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument((document) => {
            if (isGplDocument(document)) {
                // Skip during refresh — indexWorkspace already calls updateDocument
                if (!symbolCache.isRefreshing) {
                    symbolCache.updateDocument(document);
                }
                diagnosticProvider.scheduleDiagnostics(document, 0);
            }
        })
    );

    // 문서 저장 시 진단 업데이트
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument((document) => {
            if (isGplDocument(document)) {
                diagnosticProvider.scheduleDiagnostics(document, 0);
            }
        })
    );

    // ════════════════════════════════════════════════════════════
    // Controller integration – initialization
    // ════════════════════════════════════════════════════════════
    consoleChannel = vscode.window.createOutputChannel('GPL Console');
    context.subscriptions.push(consoleChannel);

    deployDiagnostics = vscode.languages.createDiagnosticCollection('gpl-deploy');
    context.subscriptions.push(deployDiagnostics);

    statusBar = new ConnectionStatusBar();
    context.subscriptions.push(statusBar);

    threadProvider = new ThreadTreeProvider();
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('gplThreads', threadProvider)
    );

    // ── Controller commands ──────────────────────────────────

    context.subscriptions.push(
        vscode.commands.registerCommand('gpl.controller.connect', async () => {
            const cfg = getControllerConfig();
            outputChannel.appendLine(`[Controller] Connecting to ${cfg.ip}:${cfg.port} …`);
            try {
                const ok = await testConnection(cfg);
                if (ok) {
                    vscode.window.showInformationMessage(`GPL Controller 연결 성공: ${cfg.ip}`);
                    statusBar?.setConnected(true);
                    statusBar?.startHeartbeat();
                    threadProvider?.startPolling();
                } else {
                    vscode.window.showErrorMessage(`GPL Controller 연결 실패: ${cfg.ip}`);
                    statusBar?.setConnected(false);
                }
            } catch (err: any) {
                vscode.window.showErrorMessage(`연결 오류: ${err.message ?? err}`);
                statusBar?.setConnected(false);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('gpl.controller.disconnect', () => {
            runtimeConsole?.stop();
            runtimeConsole = undefined;
            statusBar?.stopHeartbeat();
            statusBar?.setConnected(false);
            threadProvider?.stopPolling();
            vscode.window.showInformationMessage('GPL Controller 연결 해제');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('gpl.controller.discover', async () => {
            const ip = await showControllerPicker();
            if (ip) {
                const config = vscode.workspace.getConfiguration('gpl.controller');
                await config.update('ip', ip, vscode.ConfigurationTarget.Workspace);
                vscode.window.showInformationMessage(`Controller IP 설정됨: ${ip}`);
                // Auto-connect after discovery
                vscode.commands.executeCommand('gpl.controller.connect');
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('gpl.deploy', async () => {
            const cfg = getControllerConfig();
            const projectDirs = await findProjectDirs();
            if (projectDirs.length === 0) {
                vscode.window.showWarningMessage('워크스페이스에서 .gpr 프로젝트 파일을 찾을 수 없습니다.');
                return;
            }

            let projectDir: string;
            if (projectDirs.length === 1) {
                projectDir = projectDirs[0];
            } else {
                const pick = await vscode.window.showQuickPick(
                    projectDirs.map(d => ({ label: d })),
                    { placeHolder: '배포할 프로젝트를 선택하세요' }
                );
                if (!pick) { return; }
                projectDir = pick.label;
            }

            outputChannel.appendLine(`[Deploy] Starting deploy: ${projectDir} → ${cfg.ip}`);
            outputChannel.show(true);

            try {
                const result = await deploy({ projectDir }, outputChannel, deployDiagnostics);
                if (result.success) {
                    vscode.window.showInformationMessage(`배포 완료: ${result.projectName}`);
                } else {
                    const errMsg = result.compileErrors.length > 0
                        ? `${result.compileErrors.length}개 컴파일 에러`
                        : '알 수 없는 오류';
                    vscode.window.showErrorMessage(`배포 실패: ${errMsg}`);
                }
            } catch (err: any) {
                vscode.window.showErrorMessage(`배포 오류: ${err.message ?? err}`);
                outputChannel.appendLine(`[Deploy] Error: ${err.stack ?? err}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('gpl.console.start', () => {
            const cfg = getControllerConfig();
            if (runtimeConsole) {
                runtimeConsole.stop();
            }
            runtimeConsole = new RuntimeConsole(consoleChannel);
            runtimeConsole.onDidConnect(() => {
                outputChannel.appendLine(`[Console] Connected to ${cfg.ip}:${cfg.consolePort}`);
            });
            runtimeConsole.onDidDisconnect(() => {
                outputChannel.appendLine('[Console] Disconnected');
            });
            runtimeConsole.start();
            consoleChannel.show(true);
            vscode.window.showInformationMessage('GPL 런타임 콘솔 시작');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('gpl.console.stop', () => {
            runtimeConsole?.stop();
            runtimeConsole = undefined;
            vscode.window.showInformationMessage('GPL 런타임 콘솔 중지');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('gpl.threads.refresh', () => {
            threadProvider?.refresh();
        })
    );

    // ════════════════════════════════════════════════════════════
    // Symbol cache & diagnostics initialization
    // ════════════════════════════════════════════════════════════

    // Initialize symbol cache and diagnostics for open documents
    outputChannel.appendLine('Initializing symbol cache...');
    symbolCache.refresh().then(() => {
        outputChannel.appendLine('Symbol cache initialized!');
        if (isTraceOn(vscode.workspace)) {
            outputChannel.show(true);
        }
    });
    
    // 열려있는 GPL 문서들에 대해 진단 실행
    vscode.workspace.textDocuments.forEach(document => {
        if (isGplDocument(document)) {
            diagnosticProvider.scheduleDiagnostics(document, 0);
        }
    });
}

export function deactivate() {
    // Controller cleanup
    runtimeConsole?.stop();
    statusBar?.stopHeartbeat();
    threadProvider?.stopPolling();

    if (outputChannel) {
        outputChannel.appendLine('GPL Language Support extension is now deactivated!');
        outputChannel.dispose();
    }
}

// Export logging function for use in other modules
export function logMessage(message: string) {
    if (outputChannel) {
        outputChannel.appendLine(message);
    }
}

/**
 * XML 베스트 프랙티스 HTML 로드
 */
async function loadXmlBestPracticesHtml(context: vscode.ExtensionContext): Promise<string> {
    try {
        const uri = vscode.Uri.joinPath(context.extensionUri, 'media', 'xmlBestPractices.html');
        const bytes = await vscode.workspace.fs.readFile(uri);
        return Buffer.from(bytes).toString('utf8');
    } catch (error) {
        if (outputChannel) {
            const message =
                'Failed to load media/xmlBestPractices.html; falling back to inline XML best practices HTML.'
                + (error instanceof Error && error.message ? ` Reason: ${error.message}` : '');
            outputChannel.appendLine(message);
        }
        return getXmlBestPracticesFallbackHtml();
    }
}

/**
 * 폴백 HTML (리소스 파일 로드 실패 시)
 */
function getXmlBestPracticesFallbackHtml(): string {
    return `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GPL XML 베스트 프랙티스</title>
</head>
<body>
    <h2>GPL XML 베스트 프랙티스</h2>
    <p>가이드 파일을 로드하지 못했습니다. 확장 로그(Output: "GPL Language Support")를 확인하세요.</p>
</body>
</html>`;
}
