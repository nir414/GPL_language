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

        for (const symbol of symbols) {
            if (symbol.kind !== GPLSymbolKind.Module) {
                continue;
            }

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
                '',
                vscode.SymbolKind.Module,
                range,
                selectionRange
            );

            documentSymbols.push(documentSymbol);
        }

        return documentSymbols;
    }

    private findSymbolEndLine(symbols: GPLSymbol[], currentSymbol: GPLSymbol, document: vscode.TextDocument): number {
        const currentIndex = symbols.indexOf(currentSymbol);
        
        for (let i = currentIndex + 1; i < symbols.length; i++) {
            if (symbols[i].kind === GPLSymbolKind.Module) {
                return Math.max(symbols[i].line - 1, currentSymbol.line);
            }
        }
        
        return document.lineCount - 1;
    }
}
