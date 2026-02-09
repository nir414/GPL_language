import * as vscode from 'vscode';
import { SymbolCache } from '../symbolCache';
import { GPLParser, GPLSymbolKind } from '../gplParser';
import { isTraceVerbose } from '../config';

export class GPLHoverProvider implements vscode.HoverProvider {
    private static readonly PROVIDER_VERSION = '0.2.14';

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

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | undefined> {
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) return undefined;

        const word = document.getText(wordRange);
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(word)) {
            return undefined;
        }

        const line = document.lineAt(position.line).text;
        this.log(`\n[Hover Request] v${GPLHoverProvider.PROVIDER_VERSION} | Word: "${word}" | Line: "${line.trim()}"`);

        // Prefer cache definition
        let sym = this.symbolCache.findDefinition(word, document.uri.fsPath);

        // Fallback: parse current document (works even outside workspace indexing)
        if (!sym) {
            try {
                const localSymbols = GPLParser.parseDocument(document.getText(), document.uri.fsPath);
                sym = localSymbols.find(s => s.name === word);
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
