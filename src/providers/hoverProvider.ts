import * as vscode from 'vscode';
import { SymbolCache } from '../symbolCache';
import { GPLParser, GPLSymbolKind } from '../gplParser';
import { isTraceVerbose, EXTENSION_VERSION, ciEq } from '../config';
import { findGplBuiltin } from '../gplBuiltins';

export class GPLHoverProvider implements vscode.HoverProvider {

    constructor(
        private symbolCache: SymbolCache,
        private outputChannel?: vscode.OutputChannel
    ) {}

    private log(message: string) {
        if (!isTraceVerbose(vscode.workspace)) {
            return;
        }
        this.outputChannel?.appendLine(message);
    }

    private stripComment(line: string): string {
        const idx = line.indexOf("'");
        return idx >= 0 ? line.slice(0, idx) : line;
    }

    private getIdentifierAtPosition(document: vscode.TextDocument, position: vscode.Position): { text: string; range: vscode.Range } | undefined {
        const line = document.lineAt(position.line).text;
        if (!line) {
            return undefined;
        }

        const isIdentChar = (ch: string) => /[A-Za-z0-9_.]/.test(ch);
        let start = position.character;
        let end = position.character;

        while (start > 0 && isIdentChar(line[start - 1])) {
            start--;
        }
        while (end < line.length && isIdentChar(line[end])) {
            end++;
        }

        if (start === end) {
            return undefined;
        }

        const raw = line.slice(start, end);
        const trimmed = raw.replace(/^\.+|\.+$/g, '');
        if (!trimmed || !/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(trimmed)) {
            return undefined;
        }

        const leftTrim = raw.indexOf(trimmed);
        const range = new vscode.Range(position.line, start + leftTrim, position.line, start + leftTrim + trimmed.length);
        return { text: trimmed, range };
    }

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | undefined> {
        const ident = this.getIdentifierAtPosition(document, position);
        if (!ident) {
            return undefined;
        }

        const word = ident.text;
        const wordRange = ident.range;

        const line = document.lineAt(position.line).text;
        this.log(`\n[Hover Request] v${EXTENSION_VERSION} | Word: "${word}" | Line: "${line.trim()}"`);

        // 1) Built-in hover (문서 기반)
        const builtin = findGplBuiltin(word);
        if (builtin) {
            const md = new vscode.MarkdownString();
            md.appendMarkdown(`**GPL Built-in** · ${builtin.category}\n\n`);
            md.appendCodeblock(builtin.signature, 'gpl');
            md.appendMarkdown(`\n${builtin.summary}`);
            if (builtin.sourceUrl) {
                md.appendMarkdown(`\n\n[Reference](${builtin.sourceUrl})`);
            }
            md.isTrusted = false;
            return new vscode.Hover(md, wordRange);
        }

        // Prefer cache definition
        const lookupName = word.includes('.') ? word.split('.').pop()! : word;
        let sym = this.symbolCache.findDefinition(lookupName, document.uri.fsPath);

        // Fallback: parse current document (works even outside workspace indexing)
        if (!sym) {
            try {
                const localSymbols = GPLParser.parseDocument(document.getText(), document.uri.fsPath);
                sym = localSymbols.find(s => ciEq(s.name, lookupName));
            } catch (e) {
                this.log(`[Hover Local Parse Error] ${e}`);
            }
        }

        if (!sym) return undefined;

        // Only show stable values for constants.
        if (sym.kind !== GPLSymbolKind.Constant) {
            return undefined;
        }

        const typeText = sym.returnType ? `: \`${sym.returnType}\`` : '';
        const valueText = sym.value ? `\n\n값: \`${this.stripComment(sym.value)}\`` : `\n\n값: (초기값 없음)`;

        const md = new vscode.MarkdownString(
            `**Const** \`${sym.name}\`${typeText}${valueText}`
        );
        md.isTrusted = false;

        return new vscode.Hover(md, wordRange);
    }
}
