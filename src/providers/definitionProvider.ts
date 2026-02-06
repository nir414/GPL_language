import * as vscode from 'vscode';
import { SymbolCache } from '../symbolCache';
import { GPLParser } from '../gplParser';
import { isTraceVerbose } from '../config';

export class GPLDefinitionProvider implements vscode.DefinitionProvider {
    private static readonly PROVIDER_VERSION = '0.2.11';

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
