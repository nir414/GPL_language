import * as vscode from 'vscode';
import { SymbolCache } from '../symbolCache';
import { GPLParser } from '../gplParser';
import { isTraceVerbose } from '../config';

export class GPLDefinitionProvider implements vscode.DefinitionProvider {
    private static readonly PROVIDER_VERSION = '0.2.4-scope-aware-vars';

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

    private countCallArgumentsFromSuffix(afterWord: string): number | undefined {
        // afterWord begins right after the identifier under cursor.
        // We only handle the common pattern: Identifier( ... )
        const s = afterWord.trimStart();
        if (!s.startsWith('(')) {
            return undefined;
        }

        let depth = 0;
        let inString = false;
        let args = 0;
        let sawAnyToken = false;

        for (let i = 0; i < s.length; i++) {
            const ch = s[i];

            if (ch === '"') {
                // Toggle string mode. GPL/VB style string escaping isn't handled here;
                // this is good enough for typical single-line constructor calls.
                inString = !inString;
                sawAnyToken = true;
                continue;
            }

            if (inString) {
                continue;
            }

            if (ch === '(') {
                depth++;
                continue;
            }
            if (ch === ')') {
                depth--;
                if (depth === 0) {
                    break;
                }
                continue;
            }

            if (depth === 1) {
                if (ch === ',') {
                    args++;
                    continue;
                }
                if (!/\s/.test(ch)) {
                    sawAnyToken = true;
                }
            }
        }

        if (!sawAnyToken) {
            return 0;
        }
        return args + 1;
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

        // Special case: constructor call.
        // If the cursor is on a class name used in a "New ClassName(...)" expression,
        // users typically expect Go-to-Definition to jump to the constructor (Sub New)
        // rather than the class declaration.
        // Examples:
        // - Dim x As New TcpCommunication("", "1400")
        // - Set x = New TcpCommunication("", "1400")
        // - New TcpCommunication(...)
        const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const ctorRegex = new RegExp(`\\b(?:As\\s+)?New\\s+${escapedWord}\\s*\\(`, 'i');
        if (ctorRegex.test(line)) {
            this.log(`[Constructor Call] Detected "New ${word}". Resolving constructor "Sub New" in class ${word}`);

            // Try cache-based constructor lookup
            const ctorSymbol = this.symbolCache.findMemberInClass('New', word, document.uri.fsPath);
            if (ctorSymbol) {
                const fileName = ctorSymbol.filePath.split('\\').pop() || ctorSymbol.filePath;
                this.log(`[Constructor Found] New in class ${word}`);
                this.log(`[Location] File: ${fileName} | Line: ${ctorSymbol.line + 1} | ClassName: ${ctorSymbol.className || 'N/A'}`);

                const uri = vscode.Uri.file(ctorSymbol.filePath);
                const definitionPosition = new vscode.Position(ctorSymbol.line, 0);
                const definitionRange = new vscode.Range(definitionPosition, definitionPosition);
                return new vscode.Location(uri, definitionRange);
            }

            // As a fallback, parse the current document on demand.
            try {
                const localSymbols = GPLParser.parseDocument(document.getText(), document.uri.fsPath);
                const localCtor = localSymbols.find(s => s.name === 'New' && s.className === word);
                if (localCtor) {
                    this.log(`[Constructor Found - Local] New in class ${word} @line ${localCtor.line + 1}`);
                    const definitionPosition = new vscode.Position(localCtor.line, Math.max(0, localCtor.range?.start ?? 0));
                    const definitionRange = new vscode.Range(definitionPosition, definitionPosition);
                    return new vscode.Location(document.uri, definitionRange);
                }
            } catch (error) {
                this.log(`[Constructor Local Parse Error] ${error}`);
            }

            // Additional fallback: parse the class-definition file directly (cache may be stale)
            try {
                const classDef = this.symbolCache.findDefinition(word, document.uri.fsPath);
                if (classDef && classDef.kind === 'class') {
                    const classDoc = await vscode.workspace.openTextDocument(classDef.filePath);
                    const classSymbols = GPLParser.parseDocument(classDoc.getText(), classDef.filePath);
                    const fileCtor = classSymbols.find(s => s.name === 'New' && s.className === word);
                    if (fileCtor) {
                        const fileName = fileCtor.filePath.split('\\').pop() || fileCtor.filePath;
                        this.log(`[Constructor Found - ClassFile] New in class ${word} @line ${fileCtor.line + 1}`);
                        const definitionPosition = new vscode.Position(fileCtor.line, Math.max(0, fileCtor.range?.start ?? 0));
                        const definitionRange = new vscode.Range(definitionPosition, definitionPosition);
                        return new vscode.Location(vscode.Uri.file(fileCtor.filePath), definitionRange);
                    }
                }
            } catch (error) {
                this.log(`[Constructor ClassFile Parse Error] ${error}`);
            }

            this.log(`[Constructor NOT Found] Sub New not found for class ${word}`);
            // Continue with other resolution paths
        }
        
        // Check if there's a dot before the current word (member access)
        // Look for pattern: objectName.memberName where cursor is on memberName
        const beforeWord = line.substring(0, wordRange.start.character).trimEnd();
        const dotMatch = beforeWord.match(/(\w+)\s*\.$/);
        
        if (dotMatch) {
            const objectName = dotMatch[1];
            const memberName = word;
            
            this.log(`[Member Access] Object: "${objectName}" | Member: "${memberName}"`);
            
            // Find the variable/object definition to get its type
            const objectSymbol = this.symbolCache.findDefinition(objectName, document.uri.fsPath);
            
            if (objectSymbol) {
                this.log(`[Object Found] Name: ${objectSymbol.name} | Type: ${objectSymbol.returnType || 'N/A'} | Kind: ${objectSymbol.kind}`);
                
                if (objectSymbol.kind === 'module') {
                    this.log(`[Branch] Module member resolution path`);
                    // Module.Member access - search in module
                    const memberSymbol = this.symbolCache.findMemberInModule(memberName, objectSymbol.name, document.uri.fsPath);
                    
                    if (memberSymbol) {
                        const fileName = memberSymbol.filePath.split('\\').pop() || memberSymbol.filePath;
                        this.log(`[Module Member Found] ${memberName} in module ${objectSymbol.name}`);
                        this.log(`[Location] File: ${fileName} | Line: ${memberSymbol.line + 1}`);
                        
                        const uri = vscode.Uri.file(memberSymbol.filePath);
                        const definitionPosition = new vscode.Position(memberSymbol.line, 0);
                        const definitionRange = new vscode.Range(definitionPosition, definitionPosition);
                        return new vscode.Location(uri, definitionRange);
                    } else {
                        this.log(`[Module Member NOT Found] "${memberName}" in module "${objectSymbol.name}"`);
                    }
                } else if (objectSymbol.kind === 'class') {
                    // Static access: ClassName.Member
                    this.log(`[Branch] Class static member resolution path`);

                    const memberSymbol = this.symbolCache.findMemberInClass(memberName, objectSymbol.name, document.uri.fsPath);
                    if (memberSymbol) {
                        const fileName = memberSymbol.filePath.split('\\').pop() || memberSymbol.filePath;
                        this.log(`[Member Found] ${memberName} in class ${objectSymbol.name}`);
                        this.log(`[Location] File: ${fileName} | Line: ${memberSymbol.line + 1} | ClassName: ${memberSymbol.className || 'N/A'}`);

                        const uri = vscode.Uri.file(memberSymbol.filePath);
                        const definitionPosition = new vscode.Position(memberSymbol.line, 0);
                        const definitionRange = new vscode.Range(definitionPosition, definitionPosition);
                        return new vscode.Location(uri, definitionRange);
                    } else {
                        this.log(`[Member NOT Found] "${memberName}" in class "${objectSymbol.name}"`);
                    }
                } else if (objectSymbol.returnType) {
                    // Class instance.Member access - search in class
                    const memberSymbol = this.symbolCache.findMemberInClass(memberName, objectSymbol.returnType, document.uri.fsPath);
                    
                    if (memberSymbol) {
                        const fileName = memberSymbol.filePath.split('\\').pop() || memberSymbol.filePath;
                        this.log(`[Member Found] ${memberName} in class ${objectSymbol.returnType}`);
                        this.log(`[Location] File: ${fileName} | Line: ${memberSymbol.line + 1} | ClassName: ${memberSymbol.className || 'N/A'}`);
                        
                        const uri = vscode.Uri.file(memberSymbol.filePath);
                        const definitionPosition = new vscode.Position(memberSymbol.line, 0);
                        const definitionRange = new vscode.Range(definitionPosition, definitionPosition);
                        return new vscode.Location(uri, definitionRange);
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

        // Fallback to regular definition search
        this.log(`[Fallback Search] Looking for "${word}"`);
        const symbol = this.symbolCache.findDefinition(word, document.uri.fsPath);

        if (!symbol) {
            // As a safety net, parse the current document on-demand.
            // This prevents "Not Found" when the cache is stale (e.g., files copied/created after initial indexing,
            // or when VS Code treats *.gpl as 'vb' and cache updates were missed).
            this.log(`[Cache Miss] Symbol "${word}" not found in cache. Trying local parse fallback...`);

            try {
                const localSymbols = GPLParser.parseDocument(document.getText(), document.uri.fsPath);
                const local = localSymbols.find(s => s.name === word);

                if (!local) {
                    this.log(`[Not Found] Symbol "${word}" not found (cache + local parse)`);
                    return undefined;
                }

                this.log(`[Local Symbol Found] ${local.name} | Line: ${local.line + 1} | Kind: ${local.kind} | ClassName: ${local.className || 'N/A'}`);

                const definitionPosition = new vscode.Position(
                    local.line,
                    Math.max(0, local.range?.start ?? 0)
                );
                const definitionRange = new vscode.Range(definitionPosition, definitionPosition);
                return new vscode.Location(document.uri, definitionRange);
            } catch (error) {
                this.log(`[Local Parse Error] ${error}`);
                return undefined;
            }
        }

        const fileName = symbol.filePath.split('\\').pop() || symbol.filePath;
        this.log(`[Symbol Found] ${symbol.name} | File: ${fileName} | Line: ${symbol.line + 1} | ClassName: ${symbol.className || 'N/A'}`);
        
        const uri = vscode.Uri.file(symbol.filePath);
        const definitionPosition = new vscode.Position(symbol.line, 0);
        const definitionRange = new vscode.Range(definitionPosition, definitionPosition);

        return new vscode.Location(uri, definitionRange);
    }
}
