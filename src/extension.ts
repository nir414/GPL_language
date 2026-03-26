import * as vscode from 'vscode';
import { SymbolCache } from './symbolCache';
import { GPLDefinitionProvider } from './providers/definitionProvider';
import { GPLReferenceProvider } from './providers/referenceProvider';
import { GPLCompletionProvider } from './providers/completionProvider';
import { GPLDocumentSymbolProvider } from './providers/documentSymbolProvider';
import { GPLWorkspaceSymbolProvider } from './providers/workspaceSymbolProvider';
import { GPLFoldingRangeProvider } from './providers/foldingRangeProvider';
import { GPLDiagnosticProvider } from './providers/diagnosticProvider';
import { GPLCodeActionProvider } from './providers/codeActionProvider';
import { GPLHoverProvider } from './providers/hoverProvider';
import { isTraceOn } from './config';

const GPL_MODE: vscode.DocumentFilter[] = [
    { language: 'gpl', scheme: 'file', pattern: '**/*.gpl' },
    { language: 'vb', scheme: 'file', pattern: '**/*.gpl' },
    { scheme: 'file', pattern: '**/*.gpl' },
    { language: 'gpl', scheme: 'file', pattern: '**/*.gpo' },
    { language: 'vb', scheme: 'file', pattern: '**/*.gpo' },
    { scheme: 'file', pattern: '**/*.gpo' }
];

let symbolCache: SymbolCache;
let outputChannel: vscode.OutputChannel;
let diagnosticProvider: GPLDiagnosticProvider;

export async function activate(context: vscode.ExtensionContext) {
    const startTime = Date.now();
    
    // Create output channel
    outputChannel = vscode.window.createOutputChannel('GPL Language Support');
    context.subscriptions.push(outputChannel);

    if (isTraceOn(vscode.workspace)) {
        outputChannel.appendLine(`[GPL Extension] Activation started...`);
    }

    // Initialize Symbol Cache
    symbolCache = new SymbolCache(outputChannel);
    
    if (isTraceOn(vscode.workspace)) {
        outputChannel.appendLine(`[GPL Extension] Indexing workspace symbols...`);
    }

    await symbolCache.indexWorkspace();

    const indexTime = Date.now() - startTime;
    if (isTraceOn(vscode.workspace)) {
        outputChannel.appendLine(`[GPL Extension] Symbol cache built in ${indexTime}ms`);
    }

    // Register Definition Provider
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(
            GPL_MODE,
            new GPLDefinitionProvider(symbolCache, outputChannel)
        )
    );

    // Register Reference Provider
    context.subscriptions.push(
        vscode.languages.registerReferenceProvider(
            GPL_MODE,
            new GPLReferenceProvider(symbolCache, outputChannel)
        )
    );

    // Register Completion Provider
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            GPL_MODE,
            new GPLCompletionProvider(symbolCache),
            '.' // Trigger character
        )
    );

    // Register Hover Provider (e.g., show Const values)
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            GPL_MODE,
            new GPLHoverProvider(symbolCache, outputChannel)
        )
    );

    // Register Document Symbol Provider
    context.subscriptions.push(
        vscode.languages.registerDocumentSymbolProvider(
            GPL_MODE,
            new GPLDocumentSymbolProvider()
        )
    );

    // Register Workspace Symbol Provider
    context.subscriptions.push(
        vscode.languages.registerWorkspaceSymbolProvider(
            new GPLWorkspaceSymbolProvider(symbolCache)
        )
    );

    // Register Folding Range Provider
    context.subscriptions.push(
        vscode.languages.registerFoldingRangeProvider(
            GPL_MODE,
            new GPLFoldingRangeProvider()
        )
    );

    // Register Diagnostic Provider
    diagnosticProvider = new GPLDiagnosticProvider();
    context.subscriptions.push(diagnosticProvider);

    // Register Code Action Provider
    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            GPL_MODE,
            new GPLCodeActionProvider(),
            {
                providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
            }
        )
    );

    // Register Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('gpl.refreshSymbols', async () => {
            outputChannel.appendLine('[Command] Refreshing symbol cache...');
            await symbolCache.indexWorkspace();
            outputChannel.appendLine('[Command] Symbol cache refreshed');
            vscode.window.showInformationMessage('GPL: Symbol cache refreshed');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('gpl.debugSymbolCache', () => {
            outputChannel.clear();
            outputChannel.appendLine('=== GPL Symbol Cache Debug ===\n');
            
            const allSymbols = symbolCache.getAllSymbols();
            outputChannel.appendLine(`Total symbols: ${allSymbols.length}\n`);

            const byKind: { [kind: string]: number } = {};
            const byFile: { [file: string]: number } = {};

            for (const symbol of allSymbols) {
                byKind[symbol.kind] = (byKind[symbol.kind] || 0) + 1;
                byFile[symbol.filePath] = (byFile[symbol.filePath] || 0) + 1;
            }

            outputChannel.appendLine('Symbols by kind:');
            for (const [kind, count] of Object.entries(byKind)) {
                outputChannel.appendLine(`  ${kind}: ${count}`);
            }

            outputChannel.appendLine('\nSymbols by file:');
            const sortedFiles = Object.entries(byFile)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 20);
            
            for (const [file, count] of sortedFiles) {
                outputChannel.appendLine(`  ${file}: ${count}`);
            }

            outputChannel.appendLine('\n=== Sample Symbols ===');
            const sampleCount = Math.min(50, allSymbols.length);
            for (let i = 0; i < sampleCount; i++) {
                const s = allSymbols[i];
                const details = [
                    `kind: ${s.kind}`,
                    s.module ? `module: ${s.module}` : null,
                    s.className ? `class: ${s.className}` : null,
                    s.returnType ? `type: ${s.returnType}` : null
                ].filter(Boolean).join(', ');
                
                outputChannel.appendLine(`${i + 1}. ${s.name} (${details})`);
            }

            outputChannel.show();
            vscode.window.showInformationMessage('GPL: Symbol cache debug info printed to output');
        })
    );

    // File change handlers
    const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*.{gpl,gpo}');

    fileWatcher.onDidChange(async (uri) => {
        if (isTraceOn(vscode.workspace)) {
            outputChannel.appendLine(`[FileWatcher] Changed: ${uri.fsPath}`);
        }
        await symbolCache.updateFile(uri.fsPath);
    });

    fileWatcher.onDidCreate(async (uri) => {
        if (isTraceOn(vscode.workspace)) {
            outputChannel.appendLine(`[FileWatcher] Created: ${uri.fsPath}`);
        }
        await symbolCache.updateFile(uri.fsPath);
    });

    fileWatcher.onDidDelete((uri) => {
        if (isTraceOn(vscode.workspace)) {
            outputChannel.appendLine(`[FileWatcher] Deleted: ${uri.fsPath}`);
        }
        symbolCache.removeFile(uri.fsPath);
    });

    context.subscriptions.push(fileWatcher);

    // Document event handlers
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument((document) => {
            if (isGplDocument(document)) {
                diagnosticProvider.updateDiagnostics(document);
            }
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((event) => {
            if (isGplDocument(event.document)) {
                diagnosticProvider.scheduleDiagnostics(event.document);
            }
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(async (document) => {
            if (isGplDocument(document)) {
                await symbolCache.updateFile(document.uri.fsPath);
                diagnosticProvider.updateDiagnostics(document);
            }
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument((document) => {
            if (isGplDocument(document)) {
                diagnosticProvider.clearDiagnostics(document.uri);
            }
        })
    );

    // Update diagnostics for already open documents
    for (const document of vscode.workspace.textDocuments) {
        if (isGplDocument(document)) {
            diagnosticProvider.updateDiagnostics(document);
        }
    }

    const totalTime = Date.now() - startTime;
    if (isTraceOn(vscode.workspace)) {
        outputChannel.appendLine(`[GPL Extension] Activation completed in ${totalTime}ms`);
    }

    outputChannel.appendLine(`GPL Language Support v0.2.12 activated`);
}

export function deactivate() {
    if (outputChannel) {
        outputChannel.appendLine('[GPL Extension] Deactivating...');
    }
}

/**
 * Check if document is a GPL file (*.gpl or *.gpo)
 */
function isGplDocument(document: vscode.TextDocument): boolean {
    if (document.uri.scheme !== 'file') {
        return false;
    }
    
    const fsPath = document.uri.fsPath.toLowerCase();
    return fsPath.endsWith('.gpl') || fsPath.endsWith('.gpo');
}
