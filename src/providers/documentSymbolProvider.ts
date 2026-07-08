import * as vscode from 'vscode';
import { GPLParser, GPLSymbol, GPLSymbolKind } from '../gplParser';

export class GPLDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
    provideDocumentSymbols(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DocumentSymbol[]> {
        // 파싱/변환 중 예외가 나면 개요 전체가 사라지므로, 최상위에서 방어한다.
        // (한 파일의 문제로 Outline 기능 전체가 죽는 것을 막는다.)
        try {
            const symbols = GPLParser.parseDocument(document.getText(), document.uri.fsPath);
            return this.convertToDocumentSymbols(symbols, document);
        } catch (err) {
            console.warn(`[GPL Outline] provideDocumentSymbols 실패 (${document.uri.fsPath}):`, err);
            return [];
        }
    }

    private convertToDocumentSymbols(symbols: GPLSymbol[], document: vscode.TextDocument): vscode.DocumentSymbol[] {
        const documentSymbols: vscode.DocumentSymbol[] = [];
        const moduleSymbols = new Map<string, vscode.DocumentSymbol>();
        const classSymbols = new Map<string, vscode.DocumentSymbol>();

        const lineCount = document.lineCount;

        for (const symbol of symbols) {
            try {
                // 줄 번호를 문서 범위 안으로 보정한다. 범위를 벗어난 줄이 document.lineAt에
                // 전달되면 예외가 나고 개요 전체가 사라지기 때문이다.
                const line = Math.max(0, Math.min(symbol.line ?? 0, lineCount - 1));
                const declLen = document.lineAt(line).text.length;

                // 블록 구문(Module/Class/Function/Sub)만 여러 줄 범위를 갖고,
                // 변수/상수/속성 등 한 줄 선언은 해당 줄로 범위를 한정한다.
                const isBlockSymbol =
                    symbol.kind === GPLSymbolKind.Module ||
                    symbol.kind === GPLSymbolKind.Class ||
                    symbol.kind === GPLSymbolKind.Function ||
                    symbol.kind === GPLSymbolKind.Sub;

                // selectionRange 컬럼을 선언 줄 안으로 보정.
                const selStart = Math.max(0, Math.min(symbol.range?.start ?? 0, declLen));
                const selEnd = Math.max(selStart, Math.min(symbol.range?.end ?? declLen, declLen));
                const selectionRange = new vscode.Range(line, selStart, line, selEnd);

                // range 계산. 블록 심볼은 다음 동급 심볼 직전까지 확장하되,
                // 끝줄이 시작줄과 같아지면(= 빈 범위) 선언 줄 전체로 대체한다.
                // ⚠ VSCode는 selectionRange가 range에 포함되지 않으면 개요 결과 '전체'를
                //   폐기하므로, 빈/역전 범위는 반드시 피해야 한다.
                let range: vscode.Range;
                if (isBlockSymbol) {
                    const endLine = this.findSymbolEndLine(symbols, symbol, document);
                    range = endLine > line
                        ? new vscode.Range(line, 0, endLine, 0)
                        : new vscode.Range(line, 0, line, Math.max(declLen, selEnd));
                } else {
                    range = new vscode.Range(line, 0, line, Math.max(declLen, selEnd));
                }

                // 최종 안전장치: 그래도 포함 관계가 깨지면 range를 selectionRange로 맞춘다.
                if (!range.contains(selectionRange)) {
                    range = selectionRange;
                }

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
            } catch (err) {
                // 한 심볼의 오류가 개요 전체를 무너뜨리지 않도록 해당 심볼만 건너뛴다.
                console.warn(`[GPL Outline] 심볼 "${symbol?.name}" 변환 실패 — 건너뜀:`, err);
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
