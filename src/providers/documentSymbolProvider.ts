import * as vscode from 'vscode';
import { GPLParser, GPLSymbol, GPLSymbolKind } from '../gplParser';

export class GPLDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
    provideDocumentSymbols(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DocumentSymbol[]> {
        // Debug logging removed for production - use GPL Language Support output channel if needed
        const symbols = GPLParser.parseDocument(document.getText(), document.uri.fsPath);
        const documentSymbols = this.convertToDocumentSymbols(symbols, document);
        return documentSymbols;
    }

    private convertToDocumentSymbols(symbols: GPLSymbol[], document: vscode.TextDocument): vscode.DocumentSymbol[] {
        const documentSymbols: vscode.DocumentSymbol[] = [];
        const moduleSymbols = new Map<string, vscode.DocumentSymbol>();
        const classSymbols = new Map<string, vscode.DocumentSymbol>();

        for (const symbol of symbols) {
            // 더 정확한 range 계산 - 전체 라인을 포함하고 끝까지 확장
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
                // Functions, subs, properties, variables
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
        // 현재 심볼과 같은 레벨의 다음 심볼을 찾아서 그 전 라인까지를 범위로 설정
        const currentIndex = symbols.indexOf(currentSymbol);
        
        for (let i = currentIndex + 1; i < symbols.length; i++) {
            const nextSymbol = symbols[i];
            
            // 같은 모듈/클래스 레벨의 다음 심볼을 찾으면 그 전 라인까지
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
                // Function, Sub, Property, Variable의 경우
                if (nextSymbol.className !== currentSymbol.className || 
                    nextSymbol.module !== currentSymbol.module ||
                    nextSymbol.kind === GPLSymbolKind.Class ||
                    nextSymbol.kind === GPLSymbolKind.Module) {
                    return Math.max(nextSymbol.line - 1, currentSymbol.line);
                }
            }
        }
        
        // 마지막 심볼인 경우 문서 끝까지
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
