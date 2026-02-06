import * as vscode from 'vscode';
import { SymbolCache } from '../symbolCache';
import { GPLParser } from '../gplParser';
import { isTraceVerbose } from '../config';

export class GPLDefinitionProvider implements vscode.DefinitionProvider {
    private static readonly PROVIDER_VERSION = '0.2.13-local-scope';

    constructor(
        private symbolCache: SymbolCache,
        private outputChannel?: vscode.OutputChannel
    ) {}

    private log(message: string) {
        if (!isTraceVerbose(vscode.workspace)) {
            return;
        }
        if (this.outputChannel) {
            this.outputChannel.appendLine(message);
        }
    }

    private stripComment(line: string): string {
        const commentIndex = line.indexOf("'");
        return commentIndex >= 0 ? line.slice(0, commentIndex) : line;
    }

    private isIdentifierLike(word: string): boolean {
        return /^[A-Za-z_][A-Za-z0-9_]*$/.test(word);
    }

    private findEnclosingProcedureStartLine(document: vscode.TextDocument, fromLine: number): number | undefined {
        // Scan upwards to find the nearest containing Sub/Function/Property header.
        // Use a simple depth counter to skip over any completed blocks below.
        let depth = 0;
        for (let i = fromLine; i >= 0; i--) {
            const raw = document.lineAt(i).text;
            const line = this.stripComment(raw).trim();
            if (!line) continue;

            if (/^End\s+(Sub|Function|Property)\b/i.test(line)) {
                depth++;
                continue;
            }

            // Allow any modifier order (Public/Private/Shared/ReadOnly/WriteOnly/etc.).
            // Property header may include parentheses: Property Items() As Foo
            const isProcHeader = /\b(Sub|Function|Property)\s+\w+\s*(\([^)]*\))?/i.test(line);
            if (isProcHeader) {
                if (depth === 0) {
                    return i;
                }
                depth--;
            }
        }
        return undefined;
    }

    private findProcedureEndLine(document: vscode.TextDocument, startLine: number): number | undefined {
        for (let i = startLine + 1; i < document.lineCount; i++) {
            const raw = document.lineAt(i).text;
            const line = this.stripComment(raw).trim();
            if (!line) continue;
            if (/^End\s+(Sub|Function|Property)\b/i.test(line)) {
                return i;
            }
        }
        return undefined;
    }

    private findLocalDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        word: string
    ): vscode.Location | undefined {
        // Only attempt local resolution for identifier-like tokens.
        if (!this.isIdentifierLike(word)) {
            return undefined;
        }

        const startLine = this.findEnclosingProcedureStartLine(document, position.line);
        if (startLine === undefined) {
            this.log(`[Local Scope] No enclosing Sub/Function/Property found for "${word}" (line ${position.line + 1})`);
            return undefined;
        }
        const endLine = this.findProcedureEndLine(document, startLine) ?? document.lineCount - 1;

        this.log(`[Local Scope] Searching "${word}" in procedure block: ${startLine + 1}..${endLine + 1}`);

        // 1) Parameters in the procedure signature
        const headerRaw = document.lineAt(startLine).text;
        const header = this.stripComment(headerRaw);
        const open = header.indexOf('(');
        const close = open >= 0 ? header.indexOf(')', open + 1) : -1;
        if (open >= 0 && close > open) {
            const paramText = header.slice(open + 1, close);
            const parts = paramText.split(',').map(p => p.trim()).filter(Boolean);
            for (const p of parts) {
                // Common tokens: ByRef/ByVal/Optional/ParamArray
                const cleaned = p.replace(/\b(ByRef|ByVal|Optional|ParamArray)\b/gi, ' ').trim();
                const m = cleaned.match(/\b([A-Za-z_][A-Za-z0-9_]*)\b/);
                if (m && m[1].toLowerCase() === word.toLowerCase()) {
                    const idx = headerRaw.toLowerCase().indexOf(m[1].toLowerCase());
                    if (idx >= 0) {
                        return new vscode.Location(document.uri, new vscode.Position(startLine, idx));
                    }
                    return new vscode.Location(document.uri, new vscode.Position(startLine, 0));
                }
            }
        }

        // 2) Local definitions inside the procedure up to the current position
        // Prefer the closest preceding definition (simple shadowing support).
        let bestLine: number | undefined;
        let bestChar: number | undefined;
        const maxScanLine = Math.min(position.line, endLine);
        for (let i = startLine + 1; i <= maxScanLine; i++) {
            const raw = document.lineAt(i).text;
            const lineNoComment = this.stripComment(raw);
            const trimmed = lineNoComment.trim();
            if (!trimmed) continue;

            // Dim/Const declarations (supports multiple vars per line: Dim a As Integer, b As String)
            const dimMatch = trimmed.match(/^Dim\s+(.+)$/i);
            const constMatch = trimmed.match(/^Const\s+(.+)$/i);
            const declTail = dimMatch?.[1] ?? constMatch?.[1];
            if (declTail) {
                const declParts = declTail.split(',').map(p => p.trim()).filter(Boolean);
                for (const decl of declParts) {
                    const m = decl.match(/^([A-Za-z_][A-Za-z0-9_]*)\b/);
                    if (m && m[1].toLowerCase() === word.toLowerCase()) {
                        const idx = raw.toLowerCase().indexOf(m[1].toLowerCase());
                        if (idx >= 0) {
                            bestLine = i;
                            bestChar = idx;
                        } else {
                            bestLine = i;
                            bestChar = 0;
                        }
                    }
                }
            }

            // For / For Each loop variables
            const forEachMatch = trimmed.match(/^For\s+Each\s+([A-Za-z_][A-Za-z0-9_]*)\b/i);
            if (forEachMatch && forEachMatch[1].toLowerCase() === word.toLowerCase()) {
                const idx = raw.toLowerCase().indexOf(forEachMatch[1].toLowerCase());
                bestLine = i;
                bestChar = idx >= 0 ? idx : 0;
            }
            const forMatch = trimmed.match(/^For\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/i);
            if (forMatch && forMatch[1].toLowerCase() === word.toLowerCase()) {
                const idx = raw.toLowerCase().indexOf(forMatch[1].toLowerCase());
                bestLine = i;
                bestChar = idx >= 0 ? idx : 0;
            }

            // Catch variable: Catch ex
            const catchMatch = trimmed.match(/^Catch\s+([A-Za-z_][A-Za-z0-9_]*)\b/i);
            if (catchMatch && catchMatch[1].toLowerCase() === word.toLowerCase()) {
                const idx = raw.toLowerCase().indexOf(catchMatch[1].toLowerCase());
                bestLine = i;
                bestChar = idx >= 0 ? idx : 0;
            }
        }

        if (bestLine !== undefined) {
            return new vscode.Location(document.uri, new vscode.Position(bestLine, bestChar ?? 0));
        }

        return undefined;
    }

    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Definition | undefined> {
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return undefined;
        }

        const word = document.getText(wordRange);
        const line = document.lineAt(position.line).text;
        
        this.log(`\n[Definition Request] v${GPLDefinitionProvider.PROVIDER_VERSION} | Word: "${word}" | Line: "${line.trim()}"`);

        // Skip numeric literals (e.g. 0, 1, 100, 3.14) - they are not symbols
        if (/^\d+(\.\d+)?$/.test(word)) {
            this.log(`[Skip] Numeric literal "${word}"`);
            return undefined;
        }

        // Special case: constructor call
        const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const ctorRegex = new RegExp(`\\b(?:As\\s+)?New\\s+${escapedWord}\\s*\\(`, 'i');
        if (ctorRegex.test(line)) {
            this.log(`[Constructor Call] Detected "New ${word}"`);

            const ctorSymbol = this.symbolCache.findMemberInClass('New', word, document.uri.fsPath);
            if (ctorSymbol) {
                this.log(`[Constructor Found] New in class ${word} @line ${ctorSymbol.line + 1}`);
                const uri = vscode.Uri.file(ctorSymbol.filePath);
                const definitionPosition = new vscode.Position(ctorSymbol.line, 0);
                return new vscode.Location(uri, definitionPosition);
            }

            // Fallback: parse current document
            try {
                const localSymbols = GPLParser.parseDocument(document.getText(), document.uri.fsPath);
                const localCtor = localSymbols.find(s => s.name === 'New' && s.className === word);
                if (localCtor) {
                    this.log(`[Constructor Found - Local] @line ${localCtor.line + 1}`);
                    return new vscode.Location(document.uri, new vscode.Position(localCtor.line, 0));
                }
            } catch (error) {
                this.log(`[Constructor Local Parse Error] ${error}`);
            }

            // Additional fallback: parse class file
            try {
                const classDef = this.symbolCache.findDefinition(word, document.uri.fsPath);
                if (classDef && classDef.kind === 'class') {
                    const classDoc = await vscode.workspace.openTextDocument(classDef.filePath);
                    const classSymbols = GPLParser.parseDocument(classDoc.getText(), classDef.filePath);
                    const fileCtor = classSymbols.find(s => s.name === 'New' && s.className === word);
                    if (fileCtor) {
                        this.log(`[Constructor Found - ClassFile] @line ${fileCtor.line + 1}`);
                        return new vscode.Location(vscode.Uri.file(fileCtor.filePath), new vscode.Position(fileCtor.line, 0));
                    }
                }
            } catch (error) {
                this.log(`[Constructor ClassFile Parse Error] ${error}`);
            }

            this.log(`[Constructor NOT Found] for class ${word}`);
        }
        
        // Check member access (objectName.memberName)
        const beforeWord = line.substring(0, wordRange.start.character).trimEnd();
        const dotMatch = beforeWord.match(/(\w+)\s*\.$/);
        
        if (dotMatch) {
            const objectName = dotMatch[1];
            const memberName = word;
            
            this.log(`[Member Access] Object: "${objectName}" | Member: "${memberName}"`);
            
            const objectSymbol = this.symbolCache.findDefinition(objectName, document.uri.fsPath);
            
            if (objectSymbol) {
                this.log(`[Object Found] Name: ${objectSymbol.name} | Type: ${objectSymbol.returnType || 'N/A'} | Kind: ${objectSymbol.kind}`);
                
                if (objectSymbol.kind === 'module') {
                    this.log(`[Branch] Module member resolution`);
                    const memberSymbol = this.symbolCache.findMemberInModule(memberName, objectSymbol.name, document.uri.fsPath);
                    
                    if (memberSymbol) {
                        this.log(`[Module Member Found] ${memberName} @line ${memberSymbol.line + 1}`);
                        const uri = vscode.Uri.file(memberSymbol.filePath);
                        return new vscode.Location(uri, new vscode.Position(memberSymbol.line, 0));
                    } else {
                        this.log(`[Module Member NOT Found] "${memberName}" in module "${objectSymbol.name}"`);
                    }
                } else if (objectSymbol.kind === 'class') {
                    this.log(`[Branch] Class static member resolution`);
                    const memberSymbol = this.symbolCache.findMemberInClass(memberName, objectSymbol.name, document.uri.fsPath);
                    
                    if (memberSymbol) {
                        this.log(`[Member Found] ${memberName} @line ${memberSymbol.line + 1}`);
                        const uri = vscode.Uri.file(memberSymbol.filePath);
                        return new vscode.Location(uri, new vscode.Position(memberSymbol.line, 0));
                    } else {
                        this.log(`[Member NOT Found] "${memberName}" in class "${objectSymbol.name}"`);
                    }
                } else if (objectSymbol.returnType) {
                    this.log(`[Branch] Instance member resolution (type: ${objectSymbol.returnType})`);
                    const memberSymbol = this.symbolCache.findMemberInClass(memberName, objectSymbol.returnType, document.uri.fsPath);
                    
                    if (memberSymbol) {
                        this.log(`[Member Found] ${memberName} @line ${memberSymbol.line + 1}`);
                        const uri = vscode.Uri.file(memberSymbol.filePath);
                        return new vscode.Location(uri, new vscode.Position(memberSymbol.line, 0));
                    } else {
                        this.log(`[Member NOT Found] "${memberName}" in class "${objectSymbol.returnType}"`);
                    }
                } else {
                    this.log(`[No Type Info] Object "${objectName}" has no returnType`);
                }
            } else {
                this.log(`[Object NOT Found] "${objectName}"`);
            }
        }

        // Scope-aware local resolution (procedure parameters / local variables)
        const local = this.findLocalDefinition(document, position, word);
        if (local) {
            this.log(`[Local Scope] Resolved "${word}" within enclosing procedure`);
            return local;
        }

        // Fallback: regular definition search
        this.log(`[Fallback Search] Looking for "${word}"`);
        const symbol = this.symbolCache.findDefinition(word, document.uri.fsPath);

        if (!symbol) {
            this.log(`[Cache Miss] Symbol "${word}" not found. Trying local parse...`);

            try {
                const localSymbols = GPLParser.parseDocument(document.getText(), document.uri.fsPath);
                const local = localSymbols.find(s => s.name === word);

                if (!local) {
                    this.log(`[Not Found] Symbol "${word}"`);
                    return undefined;
                }

                this.log(`[Local Symbol Found] ${local.name} | Line: ${local.line + 1} | Kind: ${local.kind}`);
                return new vscode.Location(document.uri, new vscode.Position(local.line, 0));
            } catch (error) {
                this.log(`[Local Parse Error] ${error}`);
                return undefined;
            }
        }

        this.log(`[Symbol Found] ${symbol.name} | Line: ${symbol.line + 1}`);
        
        const uri = vscode.Uri.file(symbol.filePath);
        return new vscode.Location(uri, new vscode.Position(symbol.line, 0));
    }
}
