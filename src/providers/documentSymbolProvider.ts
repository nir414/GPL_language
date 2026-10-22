import * as vscode from 'vscode';
import { GPLParser } from '../language/gplParser';
import { buildOutlineTree, OutlineNode } from '../language/outlineModel';
import { toVsCodeSymbolKind } from './symbolKinds';

/**
 * 개요(Outline)·빵 부스러기·`Ctrl+Shift+O`·sticky scroll 이 쓰는 DocumentSymbol provider.
 * 계층·분류·detail·범위 계산은 전부 `language/outlineModel`(순수)이 하고, 여기서는 그 트리를
 * VS Code 객체로 옮기며 범위를 문서 안으로 보정하는 일만 한다.
 */
export class GPLDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
    provideDocumentSymbols(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DocumentSymbol[]> {
        // 파싱/변환 중 예외가 나면 개요 전체가 사라지므로, 최상위에서 방어한다.
        try {
            const symbols = GPLParser.parseDocument(document.getText(), document.uri.fsPath);
            const tree = buildOutlineTree(symbols, document.lineCount);
            return this.toDocumentSymbols(tree, document);
        } catch (err) {
            console.warn(`[GPL Outline] provideDocumentSymbols 실패 (${document.uri.fsPath}):`, err);
            return [];
        }
    }

    private toDocumentSymbols(nodes: OutlineNode[], document: vscode.TextDocument): vscode.DocumentSymbol[] {
        const out: vscode.DocumentSymbol[] = [];
        for (const node of nodes) {
            try {
                out.push(this.toDocumentSymbol(node, document));
            } catch (err) {
                // 한 심볼의 오류가 개요 전체를 무너뜨리지 않도록 해당 심볼만 건너뛴다.
                console.warn(`[GPL Outline] 심볼 "${node?.name}" 변환 실패 — 건너뜀:`, err);
            }
        }
        return out;
    }

    private toDocumentSymbol(node: OutlineNode, document: vscode.TextDocument): vscode.DocumentSymbol {
        const lastLine = document.lineCount - 1;
        // 줄 번호를 문서 범위 안으로 보정한다 — 범위를 벗어난 줄이 lineAt 에 가면 예외가 난다.
        const line = Math.max(0, Math.min(node.line, lastLine));
        const endLine = Math.max(line, Math.min(node.endLine, lastLine));
        const declLen = document.lineAt(line).text.length;

        // selectionRange 는 선언 줄 안의 이름 — 개요 클릭이 커서를 이름 위로 옮긴다.
        const selStart = Math.max(0, Math.min(node.nameStart, declLen));
        const selEnd = Math.max(selStart, Math.min(node.nameEnd, declLen));
        const selectionRange = new vscode.Range(line, selStart, line, selEnd);

        // range 는 선언 줄 처음 ~ 끝 줄(블록이면 짝 `End …` 줄) 끝까지 — 그 줄에 커서가 있어도 이 심볼로 잡힌다.
        // ⚠ VS Code 는 selectionRange 가 range 밖이면 개요 결과 '전체'를 버리므로 빈/역전 범위를 피한다.
        let range = endLine > line
            ? new vscode.Range(line, 0, endLine, document.lineAt(endLine).text.length)
            : new vscode.Range(line, 0, line, Math.max(declLen, selEnd));
        if (!range.contains(selectionRange)) {
            range = selectionRange;
        }

        const symbol = new vscode.DocumentSymbol(
            node.name,
            node.detail,
            toVsCodeSymbolKind(node.category),
            range,
            selectionRange
        );
        symbol.children = this.toDocumentSymbols(node.children, document);
        return symbol;
    }
}
