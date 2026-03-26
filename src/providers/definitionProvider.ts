import * as vscode from 'vscode';
import { SymbolCache } from '../symbolCache';
import { GPLParser, GPLSymbol } from '../gplParser';
import { isTraceVerbose, EXTENSION_VERSION } from '../config';

export class GPLDefinitionProvider implements vscode.DefinitionProvider {

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

    private extractBaseObjectName(expression: string): string | undefined {
        // Extract the base object name from complex expressions
        // Examples:
        //   "myRobot(index)" → "myRobot"
        //   "myRobot(index)(subIndex)" → "myRobot"
        //   "obj.prop" → "obj"
        //   "array[0]" → "array"
        const match = expression.match(/^([a-zA-Z_]\w*)/);
        return match ? match[1] : undefined;
    }

    private buildLocation(symbol: GPLSymbol): vscode.Location {
        const uri = vscode.Uri.file(symbol.filePath);
        const definitionPosition = new vscode.Position(symbol.line, 0);
        const definitionRange = new vscode.Range(definitionPosition, definitionPosition);
        return new vscode.Location(uri, definitionRange);
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
        
        this.log(`\n[Definition Request] v${EXTENSION_VERSION} | Word: "${word}" | Line: "${line.trim()}"`);
        this.log(`[Call Context] afterWord="${afterWord.trim()}" | callArgCount=${typeof callArgCount === 'number' ? callArgCount : 'N/A'}`);

        // Special case: constructor call.
        // Detect "New ClassName(...)" whether cursor is on "New" keyword or on "ClassName".
        // Examples:
        // - Dim x As New TcpCommunication("", "1400")
        // - Set x = New TcpCommunication("", "1400")
        // - New TcpCommunication(...)
        let constructorClassName: string | undefined;
        let constructorArgCount: number | undefined;

        if (/^New$/i.test(word)) {
            // Cursor is on the "New" keyword — extract class name from what follows
            const m = afterWord.match(/^\s+(\w+)\s*(\(.*)/s);
            if (m) {
                constructorClassName = m[1];
                constructorArgCount = this.countCallArgumentsFromSuffix(m[2]);
            }
        } else {
            // Cursor on a word — check if preceded by "New"
            const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const ctorRegex = new RegExp(`\\b(?:As\\s+)?New\\s+${escapedWord}\\s*\\(`, 'i');
            if (ctorRegex.test(line)) {
                constructorClassName = word;
                constructorArgCount = this.countCallArgumentsFromSuffix(afterWord);
            }
        }

        if (constructorClassName) {
            this.log(`[Constructor Call] Detected "New ${constructorClassName}". Resolving constructor "Sub New" in class ${constructorClassName}`);
            this.log(`[Constructor Call Context] class=${constructorClassName} | ctorArgCount=${typeof constructorArgCount === 'number' ? constructorArgCount : 'N/A'}`);

            // Try cache-based constructor lookup
            const ctorCandidates = this.symbolCache.findMemberCandidatesInClass('New', constructorClassName);
            this.logMemberCandidates(`Ctor:${constructorClassName}.New`, ctorCandidates, constructorArgCount);

            const ctorSymbol = this.symbolCache.findConstructorInClass(constructorClassName, constructorArgCount, document.uri.fsPath);
            if (ctorSymbol) {
                const fileName = ctorSymbol.filePath.split('\\').pop() || ctorSymbol.filePath;
                this.log(`[Constructor Found] New in class ${constructorClassName}`);
                this.log(`[Location] File: ${fileName} | Line: ${ctorSymbol.line + 1} | ClassName: ${ctorSymbol.className || 'N/A'}`);

                const uri = vscode.Uri.file(ctorSymbol.filePath);
                const definitionPosition = new vscode.Position(ctorSymbol.line, 0);
                const definitionRange = new vscode.Range(definitionPosition, definitionPosition);
                return new vscode.Location(uri, definitionRange);
            }

            // As a fallback, parse the current document on demand.
            try {
                const localSymbols = GPLParser.parseDocument(document.getText(), document.uri.fsPath);
                const localCtor = localSymbols.find(s => s.name === 'New' && s.className === constructorClassName);
                if (localCtor) {
                    this.log(`[Constructor Found - Local] New in class ${constructorClassName} @line ${localCtor.line + 1}`);
                    const definitionPosition = new vscode.Position(localCtor.line, Math.max(0, localCtor.range?.start ?? 0));
                    const definitionRange = new vscode.Range(definitionPosition, definitionPosition);
                    return new vscode.Location(document.uri, definitionRange);
                }
            } catch (error) {
                this.log(`[Constructor Local Parse Error] ${error}`);
            }

            // Additional fallback: parse the class-definition file directly (cache may be stale)
            try {
                const classDef = this.symbolCache.findDefinition(constructorClassName, document.uri.fsPath);
                if (classDef && classDef.kind === 'class') {
                    const classDoc = await vscode.workspace.openTextDocument(classDef.filePath);
                    const classSymbols = GPLParser.parseDocument(classDoc.getText(), classDef.filePath);
                    const fileCtor = classSymbols.find(s => s.name === 'New' && s.className === constructorClassName);
                    if (fileCtor) {
                        const fileName = fileCtor.filePath.split('\\').pop() || fileCtor.filePath;
                        this.log(`[Constructor Found - ClassFile] New in class ${constructorClassName} @line ${fileCtor.line + 1}`);
                        const definitionPosition = new vscode.Position(fileCtor.line, Math.max(0, fileCtor.range?.start ?? 0));
                        const definitionRange = new vscode.Range(definitionPosition, definitionPosition);
                        return new vscode.Location(vscode.Uri.file(fileCtor.filePath), definitionRange);
                    }
                }
            } catch (error) {
                this.log(`[Constructor ClassFile Parse Error] ${error}`);
            }

            this.log(`[Constructor NOT Found] Sub New not found for class ${constructorClassName}`);
            // Continue with other resolution paths
        }
        
        // Check if there's a dot before the current word (member access)
        // Look for pattern: objectExpression.memberName where cursor is on memberName
        // Handles: obj.member, myRobot(index).member, array[0].member, etc.
        const beforeWord = line.substring(0, wordRange.start.character).trimEnd();
        const lastDotIndex = beforeWord.lastIndexOf('.');

        if (lastDotIndex !== -1) {
            // Extract everything before the last dot
            const objectExpression = beforeWord.substring(0, lastDotIndex).trim();
            const baseObjectName = this.extractBaseObjectName(objectExpression);
            const memberName = word;

            this.log(`[Member Access] Expression: "${objectExpression}" | Base: "${baseObjectName}" | Member: "${memberName}" | callArgCount=${typeof callArgCount === 'number' ? callArgCount : 'N/A'}`);

            if (!baseObjectName) {
                this.log(`[Member Access] Failed to extract base object name from "${objectExpression}"`);
            } else {
                // Find the variable/object definition to get its type
                const objectSymbol =
                    this.symbolCache.findDefinition(baseObjectName, document.uri.fsPath) ??
                    this.findLocalSymbol(document, baseObjectName, position.line);

                if (objectSymbol) {
                    this.log(`[Object Found] Name: ${objectSymbol.name} | Type: ${objectSymbol.returnType || 'N/A'} | Kind: ${objectSymbol.kind}`);

                    if (objectSymbol.kind === 'module') {
                        this.log(`[Resolution Path] Module.Member → searching "${memberName}" in module "${objectSymbol.name}"`);
                        // Module.Member access - search in module
                        const moduleCandidates = this.symbolCache.findMemberCandidatesInModule(memberName, objectSymbol.name);
                        this.logMemberCandidates(`Module:${objectSymbol.name}.${memberName}`, moduleCandidates, callArgCount);

                        const memberSymbol = this.symbolCache.findMemberInModule(memberName, objectSymbol.name, document.uri.fsPath, callArgCount);

                        if (memberSymbol) {
                            const fileName = memberSymbol.filePath.split('\\').pop() || memberSymbol.filePath;
                            this.log(`[Member Found] ${memberName} in module ${objectSymbol.name}`);
                            this.log(`[Selected] ${this.formatCandidate(memberSymbol)}`);
                            this.log(`[Location] File: ${fileName} | Line: ${memberSymbol.line + 1}`);
                            return this.buildLocation(memberSymbol);
                        } else {
                            this.log(`[Member NOT Found] "${memberName}" in module "${objectSymbol.name}"`);
                        }
                    } else if (objectSymbol.kind === 'class') {
                        // Static access: ClassName.Member
                        this.log(`[Resolution Path] ClassName.Member → static member "${memberName}" in class "${objectSymbol.name}"`);

                        const classCandidates = this.symbolCache.findMemberCandidatesInClass(memberName, objectSymbol.name);
                        this.logMemberCandidates(`ClassStatic:${objectSymbol.name}.${memberName}`, classCandidates, callArgCount);

                        const memberSymbol = this.symbolCache.findMemberInClass(memberName, objectSymbol.name, document.uri.fsPath, callArgCount);
                        if (memberSymbol) {
                            const fileName = memberSymbol.filePath.split('\\').pop() || memberSymbol.filePath;
                            this.log(`[Member Found] ${memberName} in class ${objectSymbol.name}`);
                            this.log(`[Selected] ${this.formatCandidate(memberSymbol)}`);
                            this.log(`[Location] File: ${fileName} | Line: ${memberSymbol.line + 1} | ClassName: ${memberSymbol.className || 'N/A'}`);
                            return this.buildLocation(memberSymbol);
                        } else {
                            this.log(`[Member NOT Found] "${memberName}" in class "${objectSymbol.name}"`);
                        }
                    } else if (objectSymbol.returnType) {
                        // Class instance.Member access - search in class
                        // This handles: Dim obj As MyClass; obj.member
                        // Also: Dim arr(...) As MyClass; arr(index).member
                        // Strip array suffix "[]" so "RNDRobot[]" → "RNDRobot"
                        const resolvedType = objectSymbol.returnType.replace(/\[\]$/, '');
                        this.log(`[Resolution Path] ClassInstance.Member → instance of class "${resolvedType}" | searching "${memberName}"`);
                        this.log(`[Type Resolution] Variable "${baseObjectName}" has type "${objectSymbol.returnType}"${resolvedType !== objectSymbol.returnType ? ` → stripped to "${resolvedType}"` : ''}`);

                        const instanceCandidates = this.symbolCache.findMemberCandidatesInClass(memberName, resolvedType);
                        this.logMemberCandidates(`ClassInstance:${resolvedType}.${memberName}`, instanceCandidates, callArgCount);

                        const memberSymbol = this.symbolCache.findMemberInClass(memberName, resolvedType, document.uri.fsPath, callArgCount);

                        if (memberSymbol) {
                            const fileName = memberSymbol.filePath.split('\\').pop() || memberSymbol.filePath;
                            this.log(`[Member Found] ${memberName} in class ${resolvedType}`);
                            this.log(`[Selected] ${this.formatCandidate(memberSymbol)}`);
                            this.log(`[Location] File: ${fileName} | Line: ${memberSymbol.line + 1} | ClassName: ${memberSymbol.className || 'N/A'}`);
                            return this.buildLocation(memberSymbol);
                        } else {
                            this.log(`[Member NOT Found] "${memberName}" in class "${resolvedType}"`);
                        }
                    } else {
                        this.log(`[No Type Info] Object "${baseObjectName}" has no returnType and is not a class/module. Cannot resolve member access.`);
                    }
                } else {
                    this.log(`[Object NOT Found] "${baseObjectName}" not found in cache or local scope`);
                }
            }
        }

        // Fallback to regular definition search (when member access path didn't find anything)
        this.log(`[Fallback Search] Member access resolution did not return. Looking for simple definition of "${word}"`);
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
                    return this.buildLocation(any);
                } catch (error) {
                    this.log(`[Local Parse Error] ${error}`);
                    return undefined;
                }
            }

            this.log(`[Local Symbol Found] ${local.name} | Line: ${local.line + 1} | Kind: ${local.kind} | Local: ${local.isLocal ? 'yes' : 'no'} | ClassName: ${local.className || 'N/A'}`);
            return this.buildLocation(local);
        }

        const fileName = symbol.filePath.split('\\').pop() || symbol.filePath;
        this.log(`[Symbol Found] ${symbol.name} | File: ${fileName} | Line: ${symbol.line + 1} | ClassName: ${symbol.className || 'N/A'}`);
        return this.buildLocation(symbol);
    }
}
