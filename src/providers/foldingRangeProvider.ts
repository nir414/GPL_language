import * as vscode from 'vscode';

/**
 * Folding provider for GPL files.
 */
export class GPLFoldingRangeProvider implements vscode.FoldingRangeProvider {
    provideFoldingRanges(
        document: vscode.TextDocument,
        _context: vscode.FoldingContext,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.FoldingRange[]> {
        const ranges: vscode.FoldingRange[] = [];
        const stack: Array<{ kind: string; startLine: number }> = [];
        const lineCount = document.lineCount;

        const addRange = (startLine: number, endLine: number, kind?: vscode.FoldingRangeKind) => {
            if (endLine > startLine) {
                ranges.push(new vscode.FoldingRange(startLine, endLine, kind));
            }
        };

        const normalize = (s: string) => s.trim().replace(/\s+/g, ' ');

        const regionStart = /^\s*'\s*#region\b/i;
        const regionEnd = /^\s*'\s*#endregion\b/i;

        const beginPatterns: Array<{ kind: string; re: RegExp }> = [
            { kind: 'module', re: /^\s*Module\b/i },
            { kind: 'class', re: /^\s*(Public\s+|Private\s+|Friend\s+)?Class\b/i },
            { kind: 'type', re: /^\s*Type\b/i },
            { kind: 'enum', re: /^\s*Enum\b/i },
            { kind: 'sub', re: /^\s*(Public\s+|Private\s+|Friend\s+)?(Shared\s+)?Sub\b/i },
            { kind: 'function', re: /^\s*(Public\s+|Private\s+|Friend\s+)?(Shared\s+)?Function\b/i },
            { kind: 'if', re: /^\s*If\b.*\bThen\s*(?:'.*)?$/i },
            { kind: 'select', re: /^\s*Select\s+Case\b/i },
            { kind: 'for', re: /^\s*For\b/i },
            { kind: 'while', re: /^\s*While\b/i },
            { kind: 'do', re: /^\s*Do\b/i },
            { kind: 'with', re: /^\s*With\b/i },
            { kind: 'try', re: /^\s*Try\b/i }
        ];

        const endPatterns: Array<{ kind: string; re: RegExp }> = [
            { kind: 'module', re: /^\s*End\s+Module\b/i },
            { kind: 'class', re: /^\s*End\s+Class\b/i },
            { kind: 'type', re: /^\s*End\s+Type\b/i },
            { kind: 'enum', re: /^\s*End\s+Enum\b/i },
            { kind: 'sub', re: /^\s*End\s+Sub\b/i },
            { kind: 'function', re: /^\s*End\s+Function\b/i },
            { kind: 'if', re: /^\s*End\s+If\b/i },
            { kind: 'select', re: /^\s*End\s+Select\b/i },
            { kind: 'for', re: /^\s*Next\b/i },
            { kind: 'while', re: /^\s*Wend\b/i },
            { kind: 'do', re: /^\s*Loop\b/i },
            { kind: 'with', re: /^\s*End\s+With\b/i },
            { kind: 'try', re: /^\s*End\s+Try\b/i }
        ];

        const isSingleLineIf = (text: string): boolean => {
            const t = normalize(text);
            if (!/^if\b/i.test(t) || !/\bthen\b/i.test(t)) {
                return false;
            }
            if (/\bend if\b/i.test(t)) {
                return true;
            }
            const thenIndex = t.toLowerCase().indexOf(' then ');
            if (thenIndex >= 0) {
                const after = t.substring(thenIndex + 6).trim();
                if (after !== '' && !after.startsWith("'")) {
                    return true;
                }
            }
            return false;
        };

        for (let line = 0; line < lineCount; line++) {
            const text = document.lineAt(line).text;

            if (regionStart.test(text)) {
                stack.push({ kind: 'region', startLine: line });
                continue;
            }
            if (regionEnd.test(text)) {
                for (let i = stack.length - 1; i >= 0; i--) {
                    if (stack[i].kind === 'region') {
                        const open = stack.splice(i, 1)[0];
                        addRange(open.startLine, Math.max(open.startLine, line - 1), vscode.FoldingRangeKind.Region);
                        break;
                    }
                }
                continue;
            }

            const trimmed = text.trim();
            if (trimmed === '' || trimmed.startsWith("'")) {
                continue;
            }

            let closed = false;
            for (const ep of endPatterns) {
                if (ep.re.test(text)) {
                    for (let i = stack.length - 1; i >= 0; i--) {
                        if (stack[i].kind === ep.kind) {
                            const open = stack.splice(i, 1)[0];
                            addRange(open.startLine, Math.max(open.startLine, line - 1));
                            closed = true;
                            break;
                        }
                    }
                    break;
                }
            }
            if (closed) {
                continue;
            }

            for (const bp of beginPatterns) {
                if (bp.kind === 'if' && isSingleLineIf(text)) {
                    continue;
                }

                if (bp.re.test(text)) {
                    stack.push({ kind: bp.kind, startLine: line });
                    break;
                }
            }
        }

        return ranges;
    }
}
