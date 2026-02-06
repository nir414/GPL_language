import * as vscode from 'vscode';

export class GPLDiagnosticProvider {
    private diagnosticCollection: vscode.DiagnosticCollection;
    private pendingTimers: Map<string, NodeJS.Timeout> = new Map();

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('gpl');
    }

    public updateDiagnostics(document: vscode.TextDocument): void {
        if (document.languageId !== 'gpl') {
            return;
        }

        const diagnostics: vscode.Diagnostic[] = [];
        
        // VB.NET 호환성 검사
        diagnostics.push(...this.detectVBCompatibilityIssues(document));

        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    public scheduleDiagnostics(document: vscode.TextDocument, delayMs: number = 500): void {
        if (document.languageId !== 'gpl') {
            return;
        }

        const key = document.uri.toString();
        const existing = this.pendingTimers.get(key);
        if (existing) {
            clearTimeout(existing);
        }

        const timer = setTimeout(() => {
            this.pendingTimers.delete(key);
            this.updateDiagnostics(document);
        }, delayMs);

        this.pendingTimers.set(key, timer);
    }

    public clearDiagnostics(uri: vscode.Uri): void {
        const key = uri.toString();
        const existing = this.pendingTimers.get(key);
        if (existing) {
            clearTimeout(existing);
            this.pendingTimers.delete(key);
        }

        this.diagnosticCollection.delete(uri);
    }

    private detectVBCompatibilityIssues(document: vscode.TextDocument): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        const content = document.getText();
        const lines = content.split('\n');

        const unsupportedFunctions = [
            'InputBox', 'MsgBox', 'MessageBox.Show',
            'Console.WriteLine', 'Console.ReadLine'
        ];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmedLine = line.trim();

            // Skip comments
            if (trimmedLine.startsWith("'")) {
                continue;
            }

            // Check unsupported functions
            for (const func of unsupportedFunctions) {
                if (line.includes(func)) {
                    const index = line.indexOf(func);
                    const diagnostic = new vscode.Diagnostic(
                        new vscode.Range(i, index, i, index + func.length),
                        `VB.NET 호환성: ${func}는 GPL에서 지원되지 않을 수 있습니다`,
                        vscode.DiagnosticSeverity.Warning
                    );
                    diagnostic.source = 'GPL VB.NET Compatibility';
                    diagnostics.push(diagnostic);
                }
            }

            // Check Optional parameters
            if (/\bOptional\b/i.test(line)) {
                const match = line.match(/\bOptional\b/i);
                if (match) {
                    const index = match.index || 0;
                    const diagnostic = new vscode.Diagnostic(
                        new vscode.Range(i, index, i, index + 8),
                        'Optional 파라미터는 GPL에서 제한적으로 지원됩니다',
                        vscode.DiagnosticSeverity.Information
                    );
                    diagnostic.source = 'GPL VB.NET Compatibility';
                    diagnostics.push(diagnostic);
                }
            }

            // Check On Error
            if (/\bOn\s+Error\b/i.test(line)) {
                const match = line.match(/\bOn\s+Error\b/i);
                if (match) {
                    const index = match.index || 0;
                    const diagnostic = new vscode.Diagnostic(
                        new vscode.Range(i, index, i, index + 8),
                        'On Error 구문은 GPL에서 Try-Catch로 변경하는 것을 권장합니다',
                        vscode.DiagnosticSeverity.Information
                    );
                    diagnostic.source = 'GPL VB.NET Compatibility';
                    diagnostics.push(diagnostic);
                }
            }

            // Check Dictionary/Object type usage
            if (/\bAs\s+(Dictionary|Object)\b/i.test(line)) {
                const match = line.match(/\bAs\s+(Dictionary|Object)\b/i);
                if (match) {
                    const index = (match.index || 0) + 3; // "As " 이후
                    const diagnostic = new vscode.Diagnostic(
                        new vscode.Range(i, index, i, index + match[1].length),
                        `${match[1]} 타입은 GPL에서 제한적으로 지원됩니다`,
                        vscode.DiagnosticSeverity.Information
                    );
                    diagnostic.source = 'GPL VB.NET Compatibility';
                    diagnostics.push(diagnostic);
                }
            }
        }

        return diagnostics;
    }

    dispose() {
        this.diagnosticCollection.dispose();
        for (const timer of this.pendingTimers.values()) {
            clearTimeout(timer);
        }
        this.pendingTimers.clear();
    }
}
