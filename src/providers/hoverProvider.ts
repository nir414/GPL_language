import * as vscode from 'vscode';
import { SymbolCache } from '../symbolCache';
import { GPLParser, GPLSymbolKind } from '../gplParser';
import { isTraceVerbose, EXTENSION_VERSION, ciEq, isInCommentOrString } from '../config';
import { findGplBuiltin, getGplBuiltinReferenceUrl } from '../gplBuiltins';

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

    private getSymbolKindTitle(kind: GPLSymbolKind): string {
        switch (kind) {
            case GPLSymbolKind.Module:
                return 'Module';
            case GPLSymbolKind.Class:
                return 'Class';
            case GPLSymbolKind.Function:
                return 'Function';
            case GPLSymbolKind.Sub:
                return 'Sub';
            case GPLSymbolKind.Property:
                return 'Property';
            case GPLSymbolKind.Constant:
                return 'Const';
            case GPLSymbolKind.Variable:
            default:
                return 'Variable';
        }
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
        if (token.isCancellationRequested) {
            return undefined;
        }

        const ident = this.getIdentifierAtPosition(document, position);
        if (!ident) {
            return undefined;
        }

        const word = ident.text;
        const wordRange = ident.range;

        const line = document.lineAt(position.line).text;

        // 주석(')·문자열("...") 내부에서는 호버를 띄우지 않는다 (2026-07-03).
        if (isInCommentOrString(line, wordRange.start.character)) {
            return undefined;
        }

        this.log(`\n[Hover Request] v${EXTENSION_VERSION} | Word: "${word}" | Line: "${line.trim()}"`);

        // 1) Built-in hover (문서 기반)
        const builtin = findGplBuiltin(word);
        if (builtin) {
            const md = new vscode.MarkdownString();
            md.appendMarkdown(`**GPL Built-in** · ${builtin.category}\n\n`);
            md.appendCodeblock(builtin.signature, 'gpl');
            md.appendMarkdown(`\n${builtin.summary}`);
            const refUrl = getGplBuiltinReferenceUrl(builtin);
            const refLabel = builtin.sourceUrl ? 'Reference' : 'GPL Dictionary';
            md.appendMarkdown(`\n\n[${refLabel}](${refUrl})`);
            md.isTrusted = false;
            return new vscode.Hover(md, wordRange);
        }

        // Prefer cache definition
        const lookupName = word.includes('.') ? word.split('.').pop()! : word;
        let sym = this.symbolCache.findDefinition(lookupName, document.uri.fsPath);

        // Fallback: parse current document (works even outside workspace indexing)
        if (!sym && !token.isCancellationRequested) {
            try {
                const localSymbols = GPLParser.parseDocument(document.getText(), document.uri.fsPath);
                sym = localSymbols.find(s => ciEq(s.name, lookupName));
            } catch (e) {
                this.log(`[Hover Local Parse Error] ${e}`);
            }
        }

        if (!sym) {
            return undefined;
        }

        const kindTitle = this.getSymbolKindTitle(sym.kind);
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**${kindTitle}** \`${sym.name}\``);

        if (sym.kind === GPLSymbolKind.Function || sym.kind === GPLSymbolKind.Sub) {
            const params = sym.parameters?.join(', ') ?? '';
            const signature = sym.kind === GPLSymbolKind.Function
                ? `Function ${sym.name}(${params})${sym.returnType ? ` As ${sym.returnType}` : ''}`
                : `Sub ${sym.name}(${params})`;
            md.appendMarkdown('\n\n');
            md.appendCodeblock(signature, 'gpl');
        } else {
            const typeText = sym.returnType ? `: \`${sym.returnType}\`` : '';
            md.appendMarkdown(typeText);
        }

        if (sym.kind === GPLSymbolKind.Constant) {
            const valueText = sym.value ? this.stripComment(sym.value) : '(초기값 없음)';
            md.appendMarkdown(`\n\n값: \`${valueText}\``);
        }

        if (sym.module || sym.className) {
            const scopes: string[] = [];
            if (sym.module) {
                scopes.push(`Module: \`${sym.module}\``);
            }
            if (sym.className) {
                scopes.push(`Class: \`${sym.className}\``);
            }
            md.appendMarkdown(`\n\n${scopes.join(' · ')}`);
        }

        md.isTrusted = false;

        return new vscode.Hover(md, wordRange);
    }
}
