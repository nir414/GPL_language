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

        const resolved = this.resolveSignatures(call.name, document);
        if (!resolved || resolved.length === 0) {
            return undefined;
        }

        const help = new vscode.SignatureHelp();
        help.signatures = resolved.map(r => r.info);

        // 활성 시그니처: 현재 인자 인덱스를 수용할 수 있는(파라미터 수 > activeParameter)
        // 첫 오버로드를 고른다(단순 arity 우선 규칙). 없으면 0번.
        let activeSignature = resolved.findIndex(r => r.paramCount > call.activeParameter);
        if (activeSignature < 0) {
            activeSignature = 0;
        }
        help.activeSignature = activeSignature;

        const active = resolved[activeSignature];
        help.activeParameter = active.paramCount > 0
            ? Math.min(call.activeParameter, active.paramCount - 1)
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

    private resolveSignatures(
        name: string,
        document: vscode.TextDocument
    ): { info: vscode.SignatureInformation; paramCount: number }[] | undefined {
        // 1) Built-in (properties have no call signature).
        const builtin = findGplBuiltin(name);
        if (builtin && builtin.kind !== 'property') {
            return [this.buildBuiltinSignature(builtin)];
        }

        // 2) User-defined Sub/Function — findDefinition은 임의의 오버로드 1개만 돌려주므로,
        //    이름이 같은 "모든" 호출 가능 심볼을 모아 오버로드별 SignatureInformation을 만든다.
        const lookup = name.includes('.') ? name.split('.').pop()! : name;
        const isCallable = (s: GPLSymbol) =>
            s.kind === GPLSymbolKind.Function || s.kind === GPLSymbolKind.Sub;

        let syms = this.symbolCache.findAllByName(lookup).filter(isCallable);

        // 캐시에 없으면 현재 문서를 파싱해 보완(워크스페이스 인덱싱 밖에서도 동작).
        if (syms.length === 0) {
            try {
                const locals = GPLParser.parseDocument(document.getText(), document.uri.fsPath);
                syms = locals.filter(s => ciEq(s.name, lookup) && isCallable(s));
            } catch {
                /* ignore parse errors — best effort */
            }
        }

        if (syms.length === 0) {
            return undefined;
        }

        // 현재 파일의 정의를 앞으로(활성 후보가 현재 파일 오버로드부터 보이게).
        const fsLower = document.uri.fsPath.toLowerCase();
        const ordered = [
            ...syms.filter(s => s.filePath.toLowerCase() === fsLower),
            ...syms.filter(s => s.filePath.toLowerCase() !== fsLower)
        ];

        // 중복 사본(동일 시그니처 라벨)은 하나만 남긴다.
        const out: { info: vscode.SignatureInformation; paramCount: number }[] = [];
        const seen = new Set<string>();
        for (const s of ordered) {
            const built = this.buildUserSignature(s);
            if (seen.has(built.info.label)) {
                continue;
            }
            seen.add(built.info.label);
            out.push(built);
        }
        return out;
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
