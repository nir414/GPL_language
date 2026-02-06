import * as vscode from 'vscode';
import { GPLParser, GPLSymbol, GPLSymbolKind } from '../gplParser';

export class GPLDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
    provideDocumentSymbols(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DocumentSymbol[]> {
        const symbols = GPLParser.parseDocument(document.getText(), document.uri.fsPath);
        const documentSymbols = this.convertToDocumentSymbols(symbols, document);
        return documentSymbols;
    }

    private convertToDocumentSymbols(symbols: GPLSymbol[], document: vscode.TextDocument): vscode.DocumentSymbol[] {
        const documentSymbols: vscode.DocumentSymbol[] = [];
        const moduleSymbols = new Map<string, vscode.DocumentSymbol>();
        const classSymbols = new Map<string, vscode.DocumentSymbol>();

        for (const symbol of symbols) {
            const line = document.lineAt(symbol.line);
            const range = new vscode.Range(
                symbol.line, 
                0, 
                this.findSymbolEndLine(symbols, symbol, document), 
                0
            );
            const selectionRange = new vscode.Range(
                symbol.line, 
                symbol.range.start, 
                symbol.line, 
                symbol.range.end
            );
            
            const documentSymbol = new vscode.DocumentSymbol(
                symbol.name,
                symbol.returnType || '',
                this.getSymbolKind(symbol.kind),
                range,
                selectionRange
            );

            if (symbol.kind === GPLSymbolKind.Module) {
                documentSymbols.push(documentSymbol);
                moduleSymbols.set(symbol.name, documentSymbol);
            } else if (symbol.kind === GPLSymbolKind.Class) {
                if (symbol.module && moduleSymbols.has(symbol.module)) {
                    moduleSymbols.get(symbol.module)!.children.push(documentSymbol);
                    classSymbols.set(symbol.name, documentSymbol);
                } else {
                    documentSymbols.push(documentSymbol);
                    classSymbols.set(symbol.name, documentSymbol);
                }
            } else {
                if (symbol.className && classSymbols.has(symbol.className)) {
                    classSymbols.get(symbol.className)!.children.push(documentSymbol);
                } else if (symbol.module && moduleSymbols.has(symbol.module)) {
                    moduleSymbols.get(symbol.module)!.children.push(documentSymbol);
                } else {
                    documentSymbols.push(documentSymbol);
                }
            }
        }

        return documentSymbols;
    }

    private findSymbolEndLine(symbols: GPLSymbol[], currentSymbol: GPLSymbol, document: vscode.TextDocument): number {
        const currentIndex = symbols.indexOf(currentSymbol);
        
        for (let i = currentIndex + 1; i < symbols.length; i++) {
            const nextSymbol = symbols[i];
            
            if (currentSymbol.kind === GPLSymbolKind.Module) {
                if (nextSymbol.kind === GPLSymbolKind.Module) {
                    return Math.max(nextSymbol.line - 1, currentSymbol.line);
                }
            } else if (currentSymbol.kind === GPLSymbolKind.Class) {
                if (nextSymbol.kind === GPLSymbolKind.Class || 
                    (nextSymbol.kind === GPLSymbolKind.Module && nextSymbol.module !== currentSymbol.module)) {
                    return Math.max(nextSymbol.line - 1, currentSymbol.line);
                }
            } else {
                if (nextSymbol.className !== currentSymbol.className || 
                    nextSymbol.module !== currentSymbol.module ||
                    nextSymbol.kind === GPLSymbolKind.Class ||
                    nextSymbol.kind === GPLSymbolKind.Module) {
                    return Math.max(nextSymbol.line - 1, currentSymbol.line);
                }
            }
        }
        
        return document.lineCount - 1;
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
