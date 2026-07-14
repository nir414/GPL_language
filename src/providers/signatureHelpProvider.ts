import * as vscode from 'vscode';
import { SymbolCache } from '../symbolCache';
import { GPLParser, GPLSymbol, GPLSymbolKind } from '../gplParser';
import { findGplBuiltin, GPLBuiltinEntry } from '../gplBuiltins';
import { splitParameters } from '../language/cursorExpression';
import { ciEq } from '../config';

/**
 * Signature Help (parameter hints) for GPL.
 *
 * Shows the parameter list — and highlights the active parameter — while typing a
 * call `foo(` / `Move.Approach(` / `obj.Method(`. Works for:
 *   - GPL built-ins (data-driven from gplBuiltins; signature string is parsed), and
 *   - user-defined Sub / Function symbols (from the workspace symbol cache, with a
 *     fallback parse of the current document so it also works outside indexing).
 *
 * The active parameter is derived by scanning the code before the cursor (strings and
 * comments neutralized) for the innermost still-open '(' and counting the top-level
 * commas that follow it.
 */
export class GPLSignatureHelpProvider implements vscode.SignatureHelpProvider {
    constructor(private symbolCache: SymbolCache) {}

    provideSignatureHelp(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        _context: vscode.SignatureHelpContext
    ): vscode.ProviderResult<vscode.SignatureHelp> {
        if (token.isCancellationRequested) {
            return undefined;
        }

        const beforeCursor = document.lineAt(position.line).text.substring(0, position.character);
        const call = this.findCallContext(beforeCursor);
        if (!call) {
            return undefined;
        }

        const resolved = this.resolveSignature(call.name, document);
        if (!resolved) {
            return undefined;
        }

        const help = new vscode.SignatureHelp();
        help.signatures = [resolved.info];
        help.activeSignature = 0;
        help.activeParameter = resolved.paramCount > 0
            ? Math.min(call.activeParameter, resolved.paramCount - 1)
            : 0;
        return help;
    }

    /**
     * Locate the innermost currently-open call in the text before the cursor.
     * Returns the callee name (dotted names allowed) and the 0-based active parameter.
     */
    private findCallContext(beforeCursor: string): { name: string; activeParameter: number } | undefined {
        // Neutralize string literals / inline comments so their parens & commas don't count.
        const code = GPLParser.stripToCode(beforeCursor);

        const stack: { openIndex: number; commas: number }[] = [];
        for (let i = 0; i < code.length; i++) {
            const ch = code[i];
            if (ch === '(') {
                stack.push({ openIndex: i, commas: 0 });
            } else if (ch === ')') {
                if (stack.length > 0) {
                    stack.pop();
                }
            } else if (ch === ',') {
                if (stack.length > 0) {
                    stack[stack.length - 1].commas++;
                }
            }
        }

        if (stack.length === 0) {
            return undefined;
        }

        const top = stack[stack.length - 1];
        const head = code.slice(0, top.openIndex);
        const m = head.match(/([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*$/);
        if (!m) {
            return undefined;
        }

        return { name: m[1], activeParameter: top.commas };
    }

    private resolveSignature(
        name: string,
        document: vscode.TextDocument
    ): { info: vscode.SignatureInformation; paramCount: number } | undefined {
        // 1) Built-in (properties have no call signature).
        const builtin = findGplBuiltin(name);
        if (builtin && builtin.kind !== 'property') {
            return this.buildBuiltinSignature(builtin);
        }

        // 2) User-defined Sub/Function (cache first, then fall back to parsing this doc).
        const lookup = name.includes('.') ? name.split('.').pop()! : name;
        let sym: GPLSymbol | undefined = this.symbolCache.findDefinition(lookup, document.uri.fsPath);
        const isCallable = (s?: GPLSymbol) =>
            !!s && (s.kind === GPLSymbolKind.Function || s.kind === GPLSymbolKind.Sub);

        if (!isCallable(sym)) {
            try {
                const locals = GPLParser.parseDocument(document.getText(), document.uri.fsPath);
                const found = locals.find(s => ciEq(s.name, lookup) && isCallable(s));
                if (found) {
                    sym = found;
                }
            } catch {
                /* ignore parse errors — best effort */
            }
        }

        if (isCallable(sym)) {
            return this.buildUserSignature(sym!);
        }

        return undefined;
    }

    private buildBuiltinSignature(b: GPLBuiltinEntry): { info: vscode.SignatureInformation; paramCount: number } {
        const params = this.extractSignatureParams(b.signature);
        const info = new vscode.SignatureInformation(b.signature);
        info.parameters = this.makeParameters(b.signature, params);

        const doc = new vscode.MarkdownString(`**GPL Built-in** · ${b.category}\n\n${b.summary}`);
        doc.isTrusted = false;
        info.documentation = doc;

        return { info, paramCount: params.length };
    }

    private buildUserSignature(sym: GPLSymbol): { info: vscode.SignatureInformation; paramCount: number } {
        const params = sym.parameters ?? [];
        const paramList = params.join(', ');
        const label = sym.kind === GPLSymbolKind.Function
            ? `Function ${sym.name}(${paramList})${sym.returnType ? ` As ${sym.returnType}` : ''}`
            : `Sub ${sym.name}(${paramList})`;

        const info = new vscode.SignatureInformation(label);
        info.parameters = this.makeParameters(label, params);

        if (sym.docComment) {
            const doc = new vscode.MarkdownString(
                sym.docComment.split('\n').map(l => l.trimEnd()).join('  \n')
            );
            doc.isTrusted = false;
            info.documentation = doc;
        }

        return { info, paramCount: params.length };
    }

    /**
     * Build ParameterInformation using [start,end] offsets into the signature label so
     * the active parameter highlights precisely (robust against one param name being a
     * substring of another). Falls back to the raw string label if not found.
     */
    private makeParameters(label: string, params: string[]): vscode.ParameterInformation[] {
        const out: vscode.ParameterInformation[] = [];
        let searchFrom = 0;
        for (const p of params) {
            const idx = label.indexOf(p, searchFrom);
            if (idx >= 0) {
                out.push(new vscode.ParameterInformation([idx, idx + p.length]));
                searchFrom = idx + p.length;
            } else {
                out.push(new vscode.ParameterInformation(p));
            }
        }
        return out;
    }

    /** Extract parameter labels from a signature like 'Move.Approach(location, profile)'. */
    private extractSignatureParams(signature: string): string[] {
        const open = signature.indexOf('(');
        const close = signature.lastIndexOf(')');
        if (open < 0 || close < 0 || close <= open + 1) {
            return [];
        }
        return splitParameters(signature.slice(open + 1, close));
    }
}
