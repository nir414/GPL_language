import * as vscode from 'vscode';
import { SymbolCache } from '../symbolCache';
import { GPLParser, GPLSymbol } from '../gplParser';
import { isTraceVerbose } from '../config';

export class GPLDefinitionProvider implements vscode.DefinitionProvider {
    private static readonly PROVIDER_VERSION = '0.2.12-local-text-fallback';

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

    private getEnclosingProcedureRange(
        document: vscode.TextDocument,
        atLine: number
    ): { startLine: number; endLine: number } | undefined {
        const total = document.lineCount;

        // Find nearest procedure header above.
        let headerLine = -1;
        let headerKind: 'Sub' | 'Function' | 'Property' | undefined;

        for (let i = atLine; i >= 0; i--) {
            const text = document.lineAt(i).text;
            const trimmed = text.trim();
            if (trimmed.startsWith("'")) {
                continue;
            }

            const m = trimmed.match(/^\s*(Public|Private|Shared|\s)*\b(Sub|Function|Property)\b/i);
            if (m) {
                headerLine = i;
                headerKind = (m[2] as any) as 'Sub' | 'Function' | 'Property';
                break;
            }

            // Stop if we hit a new type/module boundary before any header.
            if (/^\s*(Module|Class)\b/i.test(trimmed)) {
                break;
            }
        }

        if (headerLine < 0 || !headerKind) {
            return undefined;
        }

        // Find matching End <Kind>.
        let endLine = headerLine;
        const endRe = new RegExp(`^\\s*End\\s+${headerKind}\\b`, 'i');
        for (let i = headerLine + 1; i < total; i++) {
            const trimmed = document.lineAt(i).text.trim();
            if (trimmed.startsWith("'")) {
                continue;
            }
            if (endRe.test(trimmed)) {
                endLine = i;
                break;
            }
        }

        return { startLine: headerLine, endLine };
    }

    private pickBestScopedCandidate(
        candidates: GPLSymbol[],
        document: vscode.TextDocument,
        atLine: number
    ): GPLSymbol | undefined {
        if (candidates.length === 0) {
            return undefined;
        }

        const proc = this.getEnclosingProcedureRange(document, atLine);
        let scoped = candidates;

        if (proc) {
            const inProc = candidates.filter(c => c.line >= proc.startLine && c.line <= proc.endLine);
            if (inProc.length > 0) {
                scoped = inProc;
            }
        }

        // Prefer definitions at or above the usage line; otherwise pick the closest below.
        const above = scoped
            .filter(c => c.line <= atLine)
            .sort((a, b) => b.line - a.line);
        if (above.length > 0) {
            return above[0];
        }

        const below = scoped.sort((a, b) => a.line - b.line);
        return below[0];
    }

    private findLocalSymbol(
        document: vscode.TextDocument,
        symbolName: string,
        atLine: number
    ): GPLSymbol | undefined {
        try {
            const localSymbols = GPLParser.parseDocument(document.getText(), document.uri.fsPath, {
                includeLocals: true,
                includeParameters: true
            });

            const candidates = localSymbols.filter(s => s.name === symbolName);
            return this.pickBestScopedCandidate(candidates, document, atLine);
        } catch (error) {
            this.log(`[Local Parse Error - findLocalSymbol] ${error}`);
            return undefined;
        }
    }

    private findLocalDeclarationByText(
        document: vscode.TextDocument,
        symbolName: string,
        atLine: number
    ): vscode.Location | undefined {
        const proc = this.getEnclosingProcedureRange(document, atLine);
        const scanStartLine = atLine;
        const scanEndLine = proc ? proc.startLine : 0;

        if (!proc) {
            this.log(`[Local Text Fallback] procedure range not found. Expanding scan to file top.`);
        }

        const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const declPatterns = [
            new RegExp(`^\\s*Const\\s+(${escaped})\\b`, 'i'),
            new RegExp(`^\\s*(?:Dim|Static)\\s+(?:Const\\s+)?(${escaped})\\b`, 'i'),
            new RegExp(`^\\s*(?:Public|Private)\\s+Dim\\s+(?:Const\\s+)?(${escaped})\\b`, 'i'),
            new RegExp(`^\\s*(?:Public|Private)\\s+(?:Const\\s+)?(${escaped})\\b`, 'i')
        ];

        for (let lineNo = scanStartLine; lineNo >= scanEndLine; lineNo--) {
            const text = document.lineAt(lineNo).text;
            const trimmed = text.trim();
            if (!trimmed || trimmed.startsWith("'")) {
                continue;
            }

            for (const p of declPatterns) {
                const m = p.exec(text);
                if (!m) {
                    continue;
                }
                const name = m[1] || symbolName;
                const col = Math.max(0, text.toLowerCase().indexOf(name.toLowerCase()));
                const pos = new vscode.Position(lineNo, col);
                this.log(`[Local Text Fallback] Found "${symbolName}" @ line ${lineNo + 1}`);
                return new vscode.Location(document.uri, new vscode.Range(pos, pos));
            }
        }

        this.log(`[Local Text Fallback] "${symbolName}" not found in text scan range (${scanEndLine + 1}..${scanStartLine + 1})`);

        return undefined;
    }

    private formatCandidate(symbol: GPLSymbol): string {
        const fileName = symbol.filePath.split('\\').pop() || symbol.filePath;
        const paramCount = symbol.parameters ? symbol.parameters.length : 0;
        return `${symbol.name} [${symbol.kind}] params=${paramCount} file=${fileName} line=${symbol.line + 1} class=${symbol.className || 'N/A'} module=${symbol.module || 'N/A'}`;
    }

    private logMemberCandidates(context: string, candidates: GPLSymbol[], argCount?: number): void {
        const argText = typeof argCount === 'number' ? String(argCount) : 'N/A';
        this.log(`[Candidates:${context}] count=${candidates.length} | callArgCount=${argText}`);
        if (candidates.length > 0) {
            for (const c of candidates) {
                this.log(`  - ${this.formatCandidate(c)}`);
            }
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
        const afterWord = line.substring(wordRange.end.character);
        const callArgCount = this.countCallArgumentsFromSuffix(afterWord);
        
        this.log(`\n[Definition Request] v${GPLDefinitionProvider.PROVIDER_VERSION} | Word: "${word}" | Line: "${line.trim()}"`);
        this.log(`[Call Context] afterWord="${afterWord.trim()}" | callArgCount=${typeof callArgCount === 'number' ? callArgCount : 'N/A'}`);

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

            const ctorArgCount = this.countCallArgumentsFromSuffix(afterWord);
            this.log(`[Constructor Call Context] class=${word} | ctorArgCount=${typeof ctorArgCount === 'number' ? ctorArgCount : 'N/A'}`);

            // Try cache-based constructor lookup
            const ctorCandidates = this.symbolCache.findMemberCandidatesInClass('New', word);
            this.logMemberCandidates(`Ctor:${word}.New`, ctorCandidates, ctorArgCount);

            const ctorSymbol = this.symbolCache.findConstructorInClass(word, ctorArgCount, document.uri.fsPath);
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
            
            this.log(`[Member Access] Object: "${objectName}" | Member: "${memberName}" | callArgCount=${typeof callArgCount === 'number' ? callArgCount : 'N/A'}`);
            
            // Find the variable/object definition to get its type
            // NOTE: objectName may be a local Dim variable, which is intentionally NOT indexed in SymbolCache.
            const objectSymbol =
                this.symbolCache.findDefinition(objectName, document.uri.fsPath) ??
                this.findLocalSymbol(document, objectName, position.line);
            
            if (objectSymbol) {
                this.log(`[Object Found] Name: ${objectSymbol.name} | Type: ${objectSymbol.returnType || 'N/A'} | Kind: ${objectSymbol.kind}`);
                
                if (objectSymbol.kind === 'module') {
                    this.log(`[Branch] Module member resolution path`);
                    // Module.Member access - search in module
                    const moduleCandidates = this.symbolCache.findMemberCandidatesInModule(memberName, objectSymbol.name);
                    this.logMemberCandidates(`Module:${objectSymbol.name}.${memberName}`, moduleCandidates, callArgCount);

                    const memberSymbol = this.symbolCache.findMemberInModule(memberName, objectSymbol.name, document.uri.fsPath, callArgCount);
                    
                    if (memberSymbol) {
                        const fileName = memberSymbol.filePath.split('\\').pop() || memberSymbol.filePath;
                        this.log(`[Module Member Found] ${memberName} in module ${objectSymbol.name}`);
                        this.log(`[Selected] ${this.formatCandidate(memberSymbol)}`);
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

                    const classCandidates = this.symbolCache.findMemberCandidatesInClass(memberName, objectSymbol.name);
                    this.logMemberCandidates(`ClassStatic:${objectSymbol.name}.${memberName}`, classCandidates, callArgCount);

                    const memberSymbol = this.symbolCache.findMemberInClass(memberName, objectSymbol.name, document.uri.fsPath, callArgCount);
                    if (memberSymbol) {
                        const fileName = memberSymbol.filePath.split('\\').pop() || memberSymbol.filePath;
                        this.log(`[Member Found] ${memberName} in class ${objectSymbol.name}`);
                        this.log(`[Selected] ${this.formatCandidate(memberSymbol)}`);
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
                    const instanceCandidates = this.symbolCache.findMemberCandidatesInClass(memberName, objectSymbol.returnType);
                    this.logMemberCandidates(`ClassInstance:${objectSymbol.returnType}.${memberName}`, instanceCandidates, callArgCount);

                    const memberSymbol = this.symbolCache.findMemberInClass(memberName, objectSymbol.returnType, document.uri.fsPath, callArgCount);
                    
                    if (memberSymbol) {
                        const fileName = memberSymbol.filePath.split('\\').pop() || memberSymbol.filePath;
                        this.log(`[Member Found] ${memberName} in class ${objectSymbol.returnType}`);
                        this.log(`[Selected] ${this.formatCandidate(memberSymbol)}`);
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

            const local = this.findLocalSymbol(document, word, position.line);

            if (!local) {
                const textLocal = this.findLocalDeclarationByText(document, word, position.line);
                if (textLocal) {
                    return textLocal;
                }

                // Try a non-local parse (still useful for stale cache and top-level consts/classes)
                try {
                    const localSymbols = GPLParser.parseDocument(document.getText(), document.uri.fsPath);
                    const any = localSymbols.find(s => s.name === word);
                    if (!any) {
                        this.log(`[Not Found] Symbol "${word}" not found (cache + scoped local parse)`);
                        return undefined;
                    }

                    this.log(`[Local Symbol Found - NonLocalParse] ${any.name} | Line: ${any.line + 1} | Kind: ${any.kind} | ClassName: ${any.className || 'N/A'}`);
                    const definitionPosition = new vscode.Position(any.line, Math.max(0, any.range?.start ?? 0));
                    const definitionRange = new vscode.Range(definitionPosition, definitionPosition);
                    return new vscode.Location(document.uri, definitionRange);
                } catch (error) {
                    this.log(`[Local Parse Error] ${error}`);
                    return undefined;
                }
            }

            this.log(`[Local Symbol Found] ${local.name} | Line: ${local.line + 1} | Kind: ${local.kind} | Local: ${local.isLocal ? 'yes' : 'no'} | ClassName: ${local.className || 'N/A'}`);

            const definitionPosition = new vscode.Position(
                local.line,
                Math.max(0, local.range?.start ?? 0)
            );
            const definitionRange = new vscode.Range(definitionPosition, definitionPosition);
            return new vscode.Location(document.uri, definitionRange);
        }

        const fileName = symbol.filePath.split('\\').pop() || symbol.filePath;
        this.log(`[Symbol Found] ${symbol.name} | File: ${fileName} | Line: ${symbol.line + 1} | ClassName: ${symbol.className || 'N/A'}`);
        
        const uri = vscode.Uri.file(symbol.filePath);
        const definitionPosition = new vscode.Position(symbol.line, 0);
        const definitionRange = new vscode.Range(definitionPosition, definitionPosition);

        return new vscode.Location(uri, definitionRange);
    }
}
