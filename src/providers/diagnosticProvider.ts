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

        // GPL에서 미지원되는 VB.NET 함수들
        const unsupportedFunctions = [
            // UI 함수
            'InputBox', 'MsgBox', 'MessageBox.Show',
            // 콘솔 (제한적)
            'Console.WriteLine', 'Console.ReadLine', 'Console.Write',
            // 문자열 함수 (VB 스타일)
            'Left', 'Right', 'InStrRev', 'Val', 'UBound',
            // 스트림 속성
            'EndOfStream'
        ];

        // GPL에서 미지원되는 타입들
        const unsupportedTypes = ['Long', 'Int64', 'Decimal', 'Char', 'Date', 'Variant'];

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

            // Check unsupported types
            for (const type of unsupportedTypes) {
                const typeRegex = new RegExp(`\\bAs\\s+${type}\\b`, 'i');
                if (typeRegex.test(line)) {
                    const match = line.match(typeRegex);
                    if (match) {
                        const index = (match.index || 0) + 3;
                        const diagnostic = new vscode.Diagnostic(
                            new vscode.Range(i, index, i, index + type.length),
                            `${type} 타입은 GPL에서 지원되지 않습니다. Integer, Double, String 등을 사용하세요`,
                            vscode.DiagnosticSeverity.Warning
                        );
                        diagnostic.source = 'GPL VB.NET Compatibility';
                        diagnostic.code = 'unsupported-type';
                        diagnostics.push(diagnostic);
                    }
                }
            }

            // Check string concatenation in loops (성능 이슈)
            if (/\b(For|While|Do)\b/i.test(line)) {
                // Check next few lines for string concatenation
                for (let j = i + 1; j < Math.min(i + 20, lines.length); j++) {
                    const nextLine = lines[j];
                    if (/\b(Next|Wend|Loop|End)\b/i.test(nextLine)) break;
                    
                    // Detect pattern: str = str & something
                    if (/\w+\s*=\s*\w+\s*&/i.test(nextLine)) {
                        const match = nextLine.match(/(\w+)\s*=\s*\1\s*&/i);
                        if (match) {
                            const diagnostic = new vscode.Diagnostic(
                                new vscode.Range(j, 0, j, nextLine.length),
                                '반복문 내 문자열 연결은 성능 이슈를 일으킬 수 있습니다. StreamWriter를 고려하세요',
                                vscode.DiagnosticSeverity.Information
                            );
                            diagnostic.source = 'GPL Performance';
                            diagnostics.push(diagnostic);
                            break;
                        }
                    }
                }
            }

            // Check Left/Right usage with alternative suggestion
            if (/\bLeft\s*\(/i.test(line)) {
                const match = line.match(/\bLeft\s*\(/i);
                if (match) {
                    const index = match.index || 0;
                    const diagnostic = new vscode.Diagnostic(
                        new vscode.Range(i, index, i, index + 4),
                        'Left()는 GPL에서 지원되지 않습니다. Mid(s, 1, n)을 사용하세요',
                        vscode.DiagnosticSeverity.Warning
                    );
                    diagnostic.source = 'GPL VB.NET Compatibility';
                    diagnostic.code = 'use-mid-instead-of-left';
                    diagnostics.push(diagnostic);
                }
            }

            if (/\bRight\s*\(/i.test(line)) {
                const match = line.match(/\bRight\s*\(/i);
                if (match) {
                    const index = match.index || 0;
                    const diagnostic = new vscode.Diagnostic(
                        new vscode.Range(i, index, i, index + 5),
                        'Right()는 GPL에서 지원되지 않습니다. Mid(s, Len(s) - n + 1)을 사용하세요',
                        vscode.DiagnosticSeverity.Warning
                    );
                    diagnostic.source = 'GPL VB.NET Compatibility';
                    diagnostic.code = 'use-mid-instead-of-right';
                    diagnostics.push(diagnostic);
                }
            }

            // Check Val usage
            if (/\bVal\s*\(/i.test(line)) {
                const match = line.match(/\bVal\s*\(/i);
                if (match) {
                    const index = match.index || 0;
                    const diagnostic = new vscode.Diagnostic(
                        new vscode.Range(i, index, i, index + 3),
                        'Val()은 GPL에서 지원되지 않습니다. CInt() 또는 CDbl()을 사용하세요',
                        vscode.DiagnosticSeverity.Warning
                    );
                    diagnostic.source = 'GPL VB.NET Compatibility';
                    diagnostic.code = 'use-cint-cdbl-instead-of-val';
                    diagnostics.push(diagnostic);
                }
            }

            // Check Nothing comparison without IsNothing
            if (/\w+\s*=\s*Nothing\b/i.test(line) && !/\bIs\s+Nothing\b/i.test(line)) {
                const match = line.match(/(\w+)\s*=\s*Nothing\b/i);
                if (match) {
                    const diagnostic = new vscode.Diagnostic(
                        new vscode.Range(i, 0, i, line.length),
                        'Nothing 비교는 "Is Nothing" 또는 "IsNothing()"를 사용하는 것이 안전합니다',
                        vscode.DiagnosticSeverity.Information
                    );
                    diagnostic.source = 'GPL Best Practice';
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
