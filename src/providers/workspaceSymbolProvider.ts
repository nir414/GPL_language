import * as vscode from 'vscode';
import { SymbolCache } from '../symbolCache';
import { GPLSymbolKind } from '../gplParser';

export class GPLWorkspaceSymbolProvider implements vscode.WorkspaceSymbolProvider {
    constructor(private symbolCache: SymbolCache) {}

    provideWorkspaceSymbols(
        query: string,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.SymbolInformation[]> {
        const allSymbols = this.symbolCache.getAllSymbols();
        const filteredSymbols = query 
            ? allSymbols.filter(symbol => symbol.name.toLowerCase().includes(query.toLowerCase()))
            : allSymbols;

        return filteredSymbols.map(symbol => {
            const location = new vscode.Location(
                vscode.Uri.file(symbol.filePath),
                new vscode.Position(symbol.line, 0)
            );

            let containerName = '';
            if (symbol.className) {
                containerName = symbol.className;
            } else if (symbol.module) {
                containerName = symbol.module;
            }

            return new vscode.SymbolInformation(
                symbol.name,
                this.getSymbolKind(symbol.kind),
                containerName,
                location
            );
        });
    }

    private getSymbolKind(symbolKind: GPLSymbolKind): vscode.SymbolKind {
        switch (symbolKind) {
            case GPLSymbolKind.Module: return vscode.SymbolKind.Module;
            case GPLSymbolKind.Class: return vscode.SymbolKind.Class;
            case GPLSymbolKind.Function: return vscode.SymbolKind.Function;
            case GPLSymbolKind.Sub: return vscode.SymbolKind.Method;
            case GPLSymbolKind.Variable: return vscode.SymbolKind.Variable;
            case GPLSymbolKind.Property: return vscode.SymbolKind.Property;
            case GPLSymbolKind.Constant: return vscode.SymbolKind.Constant;
            default: return vscode.SymbolKind.Variable;
        }
    }
}