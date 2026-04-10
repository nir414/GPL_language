import * as vscode from 'vscode';

/**
 * Folding provider for GPL files.
 *
 * Why this exists:
 * - In this repo, *.gpl files are typically opened as VB (languageId=vb) for built-in syntax coloring.
 * - VS Code's default folding heuristics for VB can behave oddly on GPL style code.
 * - Provide explicit, deterministic folding ranges based on control-structure pairs.
 */
export class GPLFoldingRangeProvider implements vscode.FoldingRangeProvider {
    provideFoldingRanges(
        document: vscode.TextDocument,
        _context: vscode.FoldingContext,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.FoldingRange[]> {
        const ranges: vscode.FoldingRange[] = [];

        // Stack entry tracks current section start for mid-block separator folding
        interface StackEntry {
            kind: string;
            startLine: number;
            sectionStart: number;   // start of current section (If/ElseIf/Else, Case, Catch/Finally)
            hasMidBlocks: boolean;  // true if any mid-block separator was encountered
        }

        const stack: StackEntry[] = [];

        const lineCount = document.lineCount;

        // Helper: push fold range if it spans at least 1 line.
        const addRange = (startLine: number, endLine: number, kind?: vscode.FoldingRangeKind) => {
            if (endLine > startLine) {
                ranges.push(new vscode.FoldingRange(startLine, endLine, kind));
            }
        };

        const normalize = (s: string) => s.trim().replace(/\s+/g, ' ');

        // Basic region support: "' #region" / "' #endregion" (case-insensitive)
        const regionStart = /^\s*'\s*#region\b/i;
        const regionEnd = /^\s*'\s*#endregion\b/i;

        // We intentionally keep matching conservative and anchored to avoid false positives
        // such as folding on "Public Const ...".
        const beginPatterns: Array<{ kind: string; re: RegExp }> = [
            { kind: 'module', re: /^\s*Module\b/i },
            { kind: 'class', re: /^\s*(Public\s+|Private\s+|Friend\s+)?Class\b/i },
            { kind: 'type', re: /^\s*Type\b/i },
            { kind: 'enum', re: /^\s*Enum\b/i },
            { kind: 'sub', re: /^\s*(?:(?:Public|Private|Friend|Shared)\s+)*Sub\b/i },
            { kind: 'function', re: /^\s*(?:(?:Public|Private|Friend|Shared)\s+)*Function\b/i },
            { kind: 'property', re: /^\s*(?:(?:Public|Private|Friend|ReadOnly|WriteOnly)\s+)*Property\b/i },
            { kind: 'get', re: /^\s*Get\b/i },
            { kind: 'set', re: /^\s*Set\b/i },
            // Block forms only (single-line If should not fold)
            { kind: 'if', re: /^\s*If\b.*\bThen\s*(?:'.*)?$/i },
            // GPL uses "Select expr" (without Case keyword), e.g. "Select setupOrder(i)"
            // VB.NET uses "Select Case expr" — support both forms.
            { kind: 'select', re: /^\s*Select\b(?:\s+Case\b)?\s+/i },
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
            { kind: 'property', re: /^\s*End\s+Property\b/i },
            { kind: 'get', re: /^\s*End\s+Get\b/i },
            { kind: 'set', re: /^\s*End\s+Set\b/i },
            { kind: 'if', re: /^\s*End\s+If\b/i },
            { kind: 'select', re: /^\s*End\s+Select\b/i },
            { kind: 'for', re: /^\s*Next\b/i },
            { kind: 'while', re: /^\s*Wend\b/i },
            { kind: 'do', re: /^\s*Loop\b/i },
            { kind: 'with', re: /^\s*End\s+With\b/i },
            { kind: 'try', re: /^\s*End\s+Try\b/i }
        ];

        // Mid-block separators: close previous section, start new section within parent block.
        // Order matters: ElseIf must be checked before Else.
        const midBlockPatterns: Array<{ parentKind: string; re: RegExp }> = [
            { parentKind: 'if', re: /^\s*Else\s*If\b/i },           // ElseIf / Else If
            { parentKind: 'if', re: /^\s*Else\b(?!\s*If\b)/i },     // Else (not ElseIf)
            { parentKind: 'select', re: /^\s*Case\b/i },             // Case / Case Else
            { parentKind: 'try', re: /^\s*Catch\b/i },               // Catch
            { parentKind: 'try', re: /^\s*Finally\b/i },             // Finally
        ];

        const isSingleLineIf = (text: string): boolean => {
            // Single-line If pattern: If ... Then <stmt>
            // We treat it as non-foldable. We accept that this is heuristic.
            const t = normalize(text);
            if (!/^if\b/i.test(t) || !/\bthen\b/i.test(t)) {
                return false;
            }
            // If it contains "End If" on same line, it's also single-line-ish.
            if (/\bend if\b/i.test(t)) {
                return true;
            }
            // After Then, if there's any non-comment token, consider it single-line.
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
            let text = document.lineAt(line).text;
            const logicalStartLine = line;

            // Handle VB/GPL line continuation: " _" at end of line joins with next line.
            // e.g. "If condition1 And _\n     condition2 Then" → single logical line.
            while (line + 1 < lineCount && /\s_\s*$/.test(text)) {
                line++;
                text = text.replace(/\s_\s*$/, ' ') + document.lineAt(line).text.trimStart();
            }

            // Region folding
            if (regionStart.test(text)) {
                stack.push({ kind: 'region', startLine: logicalStartLine, sectionStart: logicalStartLine, hasMidBlocks: false });
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

            // 1. Close blocks (End ... / Next / Wend / Loop)
            let handled = false;
            for (const ep of endPatterns) {
                if (ep.re.test(text)) {
                    for (let i = stack.length - 1; i >= 0; i--) {
                        if (stack[i].kind === ep.kind) {
                            const open = stack.splice(i, 1)[0];
                            // Close last section if mid-block separators were used
                            if (open.hasMidBlocks) {
                                addRange(open.sectionStart, Math.max(open.sectionStart, line - 1));
                            }
                            // Fold the whole block
                            addRange(open.startLine, Math.max(open.startLine, line - 1));
                            handled = true;
                            break;
                        }
                    }
                    break;
                }
            }
            if (handled) { continue; }

            // 2. Mid-block separators (ElseIf, Else, Case, Catch, Finally)
            for (const mb of midBlockPatterns) {
                if (mb.re.test(text)) {
                    for (let i = stack.length - 1; i >= 0; i--) {
                        if (stack[i].kind === mb.parentKind) {
                            const parent = stack[i];
                            // Close previous section
                            addRange(parent.sectionStart, Math.max(parent.sectionStart, logicalStartLine - 1));
                            // Start new section
                            parent.sectionStart = logicalStartLine;
                            parent.hasMidBlocks = true;
                            handled = true;
                            break;
                        }
                    }
                    break;
                }
            }
            if (handled) { continue; }

            // 3. Open blocks
            for (const bp of beginPatterns) {
                if (bp.kind === 'if' && isSingleLineIf(text)) {
                    continue;
                }

                if (bp.re.test(text)) {
                    stack.push({ kind: bp.kind, startLine: logicalStartLine, sectionStart: logicalStartLine, hasMidBlocks: false });
                    break;
                }
            }
        }

        // No auto-close at EOF; unfinished blocks are ignored to avoid weird folds.
        return ranges;
    }
}
