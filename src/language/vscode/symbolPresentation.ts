import * as vscode from 'vscode';
import type { GPLSymbol } from '../gplParser';
import type { SymbolIndex } from '../symbols/symbolIndex';
import { renderResolvedDocMarkdown, resolveOverloadDoc } from '../docCommentOverloads';

export function getCompletionItems(index: SymbolIndex): vscode.CompletionItem[] {
    const items: vscode.CompletionItem[] = [];
    const seenNames = new Set<string>();

    for (const symbol of index.getAllSymbols()) {
        const lowerName = symbol.name.toLowerCase();
        if (seenNames.has(lowerName)) {
            continue;
        }
        seenNames.add(lowerName);

        const item = new vscode.CompletionItem(symbol.name, getCompletionItemKind(symbol.kind));

        // Add detail information
        let detail: string = symbol.kind;
        if (symbol.module) {
            detail += ` (${symbol.module}`;
            if (symbol.className) {
                detail += `.${symbol.className}`;
            }
            detail += ')';
        }
        item.detail = detail;

        // Add documentation (signature codeblock + doc-comment when available)
        item.documentation = buildSymbolDocumentation(symbol, index);

        // Add snippet for functions/subs
        if ((symbol.kind === 'function' || symbol.kind === 'sub') && symbol.parameters) {
            const params = symbol.parameters.map((param, index) => `\${${index + 1}:${param}}`).join(', ');
            item.insertText = new vscode.SnippetString(`${symbol.name}(${params})`);
        }

        items.push(item);
    }

    return items;
}

/**
 * Build rich completion documentation: a GPL signature codeblock for callables
 * (or `name : type` for fields/consts), followed by the symbol's `'` doc-comment.
 */
export function buildSymbolDocumentation(symbol: GPLSymbol, index: SymbolIndex): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    if (symbol.kind === 'function' || symbol.kind === 'sub') {
        const params = symbol.parameters?.join(', ') ?? '';
        const sig = symbol.kind === 'function'
            ? `Function ${symbol.name}(${params})${symbol.returnType ? ` As ${symbol.returnType}` : ''}`
            : `Sub ${symbol.name}(${params})`;
        md.appendCodeblock(sig, 'gpl');
    } else if (symbol.kind === 'delegate') {
        // Delegate 는 시그니처가 본질 — 반환 타입이 있으면 Function 형(§1-DU)
        const params = symbol.parameters?.join(', ') ?? '';
        md.appendCodeblock(symbol.returnType
            ? `Delegate Function ${symbol.name}(${params}) As ${symbol.returnType}`
            : `Delegate Sub ${symbol.name}(${params})`, 'gpl');
    } else if (symbol.returnType) {
        md.appendMarkdown(`\`${symbol.name}\` : \`${symbol.returnType}\``);
    }
    // 구조화된 문서화 주석(`# Parameters` 등)은 섹션째, 옛 주석은 서술 그대로 렌더링된다.
    // 오버로드면 빠진 조각을 형제 주석에서 채운다(docCommentOverloads — 공통 문서는 이름 단위로 공유, 차이만 개별 문서화).
    const resolved = resolveOverloadDoc(symbol, index.findOverloadSiblings(symbol));
    const doc = resolved ? renderResolvedDocMarkdown(resolved, { descriptionMode: 'full' }) : undefined;
    if (doc) {
        // Module/Class처럼 앞에 붙일 시그니처·타입 줄이 없는 종류는 구분용 빈 줄을 넣지 않는다.
        md.appendMarkdown(md.value ? `\n\n${doc}` : doc);
    }
    md.isTrusted = false;
    return md;
}

export function getCompletionItemKind(symbolKind: string): vscode.CompletionItemKind {
    switch (symbolKind) {
        case 'module': return vscode.CompletionItemKind.Module;
        case 'class': return vscode.CompletionItemKind.Class;
        case 'delegate': return vscode.CompletionItemKind.Class; // Delegate 는 타입 선언(§1-DU)
        case 'function': return vscode.CompletionItemKind.Function;
        case 'sub': return vscode.CompletionItemKind.Method;
        case 'variable': return vscode.CompletionItemKind.Variable;
        case 'property': return vscode.CompletionItemKind.Property;
        case 'constant': return vscode.CompletionItemKind.Constant;
        default: return vscode.CompletionItemKind.Text;
    }
}
