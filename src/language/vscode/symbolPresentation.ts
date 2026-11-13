import * as vscode from 'vscode';
import type { GPLSymbol } from '../syntax/gplParser';
import type { SymbolIndex } from '../symbols/symbolIndex';
import { renderResolvedDocMarkdown, resolveOverloadDoc } from '../documentation/docCommentOverloads';

/**
 * 워크스페이스 심볼 완성 목록 캐시 — 인덱스 변경 번호(`generation`)가 같으면 같은 배열을 돌려준다.
 * 식별자 완성 요청마다 모든 심볼로 항목을 다시 만들고 문서(Markdown)까지 렌더링하던 비용이 요청 시간의 대부분이었다
 * (2026-11-13 측정: 심볼 4,068개에서 요청 34 ms 중 32 ms, 심볼 수에 비례). 문서는 항목이 목록에서 선택될 때
 * `resolveSymbolCompletionItem` 이 채운다. 돌려준 배열·항목은 여러 요청이 함께 쓰므로 호출측이 고치지 않는다.
 */
const completionCache = new WeakMap<SymbolIndex, { generation: number; items: vscode.CompletionItem[] }>();
/** 캐시된 완성 항목 → 그 항목을 만든 심볼과 인덱스(문서를 나중에 채울 때 쓴다). */
const completionSymbols = new WeakMap<vscode.CompletionItem, { symbol: GPLSymbol; index: SymbolIndex }>();

/** 워크스페이스 심볼 완성 항목이면 문서를 채우고 true. 다른 출처의 항목(내장·키워드·지역)이면 손대지 않고 false. */
export function resolveSymbolCompletionItem(item: vscode.CompletionItem): boolean {
    const origin = completionSymbols.get(item);
    if (!origin) { return false; }
    if (item.documentation === undefined) { item.documentation = buildSymbolDocumentation(origin.symbol, origin.index); }
    return true;
}

export function getCompletionItems(index: SymbolIndex): vscode.CompletionItem[] {
    const cached = completionCache.get(index);
    if (cached && cached.generation === index.generation) { return cached.items; }
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

        // 문서(시그니처 코드블록 + 문서화 주석)는 선택될 때 채운다 — resolveSymbolCompletionItem.
        completionSymbols.set(item, { symbol, index });

        // Add snippet for functions/subs
        if ((symbol.kind === 'function' || symbol.kind === 'sub') && symbol.parameters) {
            const params = symbol.parameters.map((param, index) => `\${${index + 1}:${param}}`).join(', ');
            item.insertText = new vscode.SnippetString(`${symbol.name}(${params})`);
        }

        items.push(item);
    }

    completionCache.set(index, { generation: index.generation, items });
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
