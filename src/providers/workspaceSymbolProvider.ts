import * as vscode from 'vscode';
import { SymbolCache } from '../symbolCache';
import { matchesSymbolQuery, outlineCategoryOf } from '../language/outlineModel';
import { toVsCodeSymbolKind } from './symbolKinds';

/**
 * 워크스페이스 심볼(`Ctrl+T` / `#이름`) provider. 분류는 개요와 같은 표(`providers/symbolKinds`)를 쓰고,
 * 위치는 선언 줄의 **이름 컬럼**이라 이동하면 커서가 이름 위에 놓인다(종전: 줄 머리 0열).
 */
export class GPLWorkspaceSymbolProvider implements vscode.WorkspaceSymbolProvider {
    constructor(private symbolCache: SymbolCache) {}

    provideWorkspaceSymbols(
        query: string,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.SymbolInformation[]> {
        const result: vscode.SymbolInformation[] = [];
        for (const symbol of this.symbolCache.getAllSymbols()) {
            // 로컬·파라미터는 워크스페이스 단위 탐색 대상이 아니다(캐시 옵션과 무관하게 거른다).
            if (symbol.isLocal || symbol.isParameter) { continue; }
            if (!matchesSymbolQuery(symbol.name, query)) { continue; }

            const start = Math.max(0, symbol.range?.start ?? 0);
            const end = Math.max(start, symbol.range?.end ?? start);
            const location = new vscode.Location(
                vscode.Uri.file(symbol.filePath),
                new vscode.Range(symbol.line, start, symbol.line, end)
            );
            const containerName = symbol.className ?? symbol.module ?? '';
            result.push(new vscode.SymbolInformation(
                symbol.name,
                toVsCodeSymbolKind(outlineCategoryOf(symbol)),
                containerName,
                location
            ));
        }
        return result;
    }
}
