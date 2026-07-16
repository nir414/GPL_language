import * as vscode from 'vscode';
import { SymbolCache } from '../symbolCache';
import { GPLParser, GPLSymbol } from '../gplParser';
import { isTraceVerbose, EXTENSION_VERSION, ciEq, getQualifiedWordAtPosition, isInCommentOrString, GPL_CONTROL_KEYWORDS } from '../config';
import { extractBaseObjectName, escapeRegExp, findEnclosingProcedureRange, extractCallArgumentsFromSuffix } from '../language/cursorExpression';
import { CallContext, inferLiteralArgType, rankOverloadMatches } from '../language/overloadResolution';

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

    /**
     * 호출부 인자 표현식들로 CallContext를 만든다.
     *
     * 인자 타입 추론은 lazy — 오버로드 후보가 arity로 걸러도 2개 이상 동점일 때만
     * (rankOverloadMatches 내부에서) 실행되고, 결과는 요청 내에서 캐시된다.
     */
    private buildCallContext(
        document: vscode.TextDocument,
        atLine: number,
        callArgs: string[] | undefined
    ): CallContext | undefined {
        if (!callArgs) {
            return undefined;
        }
        if (callArgs.length === 0) {
            return { argCount: 0 };
        }
        let cached: ReadonlyArray<string | undefined> | undefined;
        return {
            argCount: callArgs.length,
            getArgTypes: () => (cached ??= this.inferCallArgTypes(document, atLine, callArgs))
        };
    }

    /**
     * 인자 표현식별 타입 추론(가벼운 경로만).
     *   - 리터럴: "..." → String, True/False → Boolean, 숫자/&H/&O → NUMERIC_LITERAL_TYPE
     *   - `New Foo(...)` → Foo
     *   - 단순 식별자 → 로컬/파라미터/캐시 심볼의 returnType (배열은 `Type[]`)
     *   - `ident(...)` → 배열 변수면 요소 타입, 함수면 반환 타입
     *   - 그 외(멤버 접근 등 복합식)는 undefined(중립) — 오판 대신 판단 보류.
     */
    private inferCallArgTypes(
        document: vscode.TextDocument,
        atLine: number,
        callArgs: string[]
    ): Array<string | undefined> {
        return callArgs.map(raw => {
            const expr = raw.trim();

            const literal = inferLiteralArgType(expr);
            if (literal) {
                return literal;
            }

            const ctorMatch = expr.match(/^New\s+(\w+)/i);
            if (ctorMatch) {
                return ctorMatch[1];
            }

            const idMatch = expr.match(/^([A-Za-z_]\w*)\s*(\(.*\))?$/s);
            if (!idMatch) {
                return undefined;
            }
            const name = idMatch[1];
            const hasCallOrIndex = !!idMatch[2];

            const sym = this.findLocalSymbol(document, name, atLine)
                ?? this.symbolCache.findDefinition(name, document.uri.fsPath);
            const type = sym?.returnType;
            if (!type) {
                return undefined;
            }
            if (!hasCallOrIndex) {
                return type;
            }
            // `name(...)`: 배열 변수 인덱싱이면 요소 타입, 함수 호출이면 반환 타입.
            if (type.endsWith('[]') && sym!.kind !== 'function') {
                return type.slice(0, -2);
            }
            return type;
        });
    }

    private getEnclosingProcedureRange(
        document: vscode.TextDocument,
        atLine: number
    ): { startLine: number; endLine: number } | undefined {
        // 공용 정본(cursorExpression.findEnclosingProcedureRange)에 위임한다.
        // 헤더보다 먼저 End Sub/Function/Property를 만나면(=프로시저 사이, 모듈 레벨)
        // undefined를 돌려주므로, 직전 프로시저에 잘못 귀속되던 문제가 함께 고쳐졌다.
        return findEnclosingProcedureRange(i => document.lineAt(i).text, document.lineCount, atLine);
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

            const candidates = localSymbols.filter(s => ciEq(s.name, symbolName));
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

        const escaped = escapeRegExp(symbolName);
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

    /**
     * 같은 이름의 후보 여러 개 중 호출 문맥(인자 개수·타입)에 맞는 것을 고른다.
     * 온디맨드 파싱(캐시 미스) 경로용 — symbolCache와 동일한 rankOverloadMatches
     * (공용 정본)를 사용해 두 경로의 선택 규칙이 갈라지지 않게 한다.
     * 호출 문맥이 없거나 호출 가능한(Sub/Function) 후보가 없으면 [첫 후보].
     */
    private pickLocalMatches(candidates: GPLSymbol[], ctx?: CallContext): GPLSymbol[] {
        if (candidates.length === 1 || !ctx || typeof ctx.argCount !== 'number') {
            return [candidates[0]];
        }
        const callable = candidates.filter(s => s.kind === 'function' || s.kind === 'sub');
        if (callable.length === 0) {
            return [candidates[0]];
        }
        return rankOverloadMatches(callable, ctx);
    }

    private buildLocation(symbol: GPLSymbol): vscode.Location {
        const uri = vscode.Uri.file(symbol.filePath);
        const definitionPosition = new vscode.Position(symbol.line, 0);
        const definitionRange = new vscode.Range(definitionPosition, definitionPosition);
        return new vscode.Location(uri, definitionRange);
    }

    /**
     * 랭킹 결과를 vscode.Definition으로 변환한다.
     * 동점 오버로드가 여럿이면 전부 돌려줘 VS Code가 peek 목록을 띄우게 한다
     * (틀린 곳으로 조용히 점프하는 대신 사용자가 고르게 하는 안전망).
     */
    private buildDefinitionResult(symbols: GPLSymbol[]): vscode.Definition {
        if (symbols.length > 1) {
            this.log(`[Ambiguous Overload] ${symbols.length} equally-ranked candidates → returning all as peek list`);
            for (const s of symbols) {
                this.log(`  = ${this.formatCandidate(s)}`);
            }
            return symbols.map(s => this.buildLocation(s));
        }
        return this.buildLocation(symbols[0]);
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
        if (token.isCancellationRequested) {
            return undefined;
        }

        const ident = getQualifiedWordAtPosition(document, position);
        if (!ident) {
            return undefined;
        }

        const word = ident.word;
        const wordRange = ident.range;
        const line = document.lineAt(position.line).text;

        // 주석(')·문자열("...") 내부는 정의 대상이 아니다 — 오검색/엉뚱한 점프 방지 (2026-07-03).
        if (isInCommentOrString(line, wordRange.start.character)) {
            return undefined;
        }
        // 제어 키워드(If/Then/Dim...)는 심볼이 될 수 없다 — 멤버 해석/캐시 미스 낭비 제거.
        if (GPL_CONTROL_KEYWORDS.has(word.toLowerCase())) {
            return undefined;
        }

        const afterWord = line.substring(wordRange.end.character);
        const callArgs = extractCallArgumentsFromSuffix(afterWord);
        const callArgCount = callArgs ? callArgs.length : undefined;
        const callCtx = this.buildCallContext(document, position.line, callArgs);

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
                constructorArgCount = extractCallArgumentsFromSuffix(m[2])?.length;
            }
        } else {
            // Cursor on a word — check if preceded by "New"
            const escapedWord = escapeRegExp(word);
            const ctorRegex = new RegExp(`\\b(?:As\\s+)?New\\s+${escapedWord}\\s*\\(`, 'i');
            if (ctorRegex.test(line)) {
                constructorClassName = word;
                constructorArgCount = callArgCount;
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
            const baseObjectName = extractBaseObjectName(objectExpression);
            const memberName = word;

            this.log(`[Member Access] Expression: "${objectExpression}" | Base: "${baseObjectName}" | Member: "${memberName}" | callArgCount=${typeof callArgCount === 'number' ? callArgCount : 'N/A'}`);

            if (!baseObjectName) {
                this.log(`[Member Access] Failed to extract base object name from "${objectExpression}"`);
            } else {
                // Find the variable/object definition to get its type.
                // Prefer local/parameter symbol first — it has accurate type info
                // (e.g., "armList() As RobotArm" parameter has returnType "RobotArm").
                // Cache symbols for same-named variables may lack type info.
                const localSymbol = this.findLocalSymbol(document, baseObjectName, position.line);
                const cacheSymbol = this.symbolCache.findDefinition(baseObjectName, document.uri.fsPath);

                // Pick local if it has type info, or if cache has no result;
                // otherwise prefer whichever has returnType.
                let objectSymbol: GPLSymbol | undefined;
                if (localSymbol && localSymbol.returnType) {
                    objectSymbol = localSymbol;
                } else if (cacheSymbol && cacheSymbol.returnType) {
                    objectSymbol = cacheSymbol;
                } else {
                    // Neither has type — prefer local (closer scope), then cache
                    objectSymbol = localSymbol ?? cacheSymbol;
                }

                if (objectSymbol) {
                    this.log(`[Object Found] Name: ${objectSymbol.name} | Type: ${objectSymbol.returnType || 'N/A'} | Kind: ${objectSymbol.kind}`);

                    if (objectSymbol.kind === 'module') {
                        this.log(`[Resolution Path] Module.Member → searching "${memberName}" in module "${objectSymbol.name}"`);
                        // Module.Member access - search in module
                        const moduleCandidates = this.symbolCache.findMemberCandidatesInModule(memberName, objectSymbol.name);
                        this.logMemberCandidates(`Module:${objectSymbol.name}.${memberName}`, moduleCandidates, callArgCount);

                        const memberMatches = this.symbolCache.findMemberInModuleMatches(memberName, objectSymbol.name, document.uri.fsPath, callCtx);

                        if (memberMatches.length > 0) {
                            const memberSymbol = memberMatches[0];
                            const fileName = memberSymbol.filePath.split('\\').pop() || memberSymbol.filePath;
                            this.log(`[Member Found] ${memberName} in module ${objectSymbol.name}`);
                            this.log(`[Selected] ${this.formatCandidate(memberSymbol)}`);
                            this.log(`[Location] File: ${fileName} | Line: ${memberSymbol.line + 1}`);
                            return this.buildDefinitionResult(memberMatches);
                        } else {
                            this.log(`[Member NOT Found] "${memberName}" in module "${objectSymbol.name}"`);
                        }
                    } else if (objectSymbol.kind === 'class') {
                        // Static access: ClassName.Member
                        this.log(`[Resolution Path] ClassName.Member → static member "${memberName}" in class "${objectSymbol.name}"`);

                        const classCandidates = this.symbolCache.findMemberCandidatesInClass(memberName, objectSymbol.name);
                        this.logMemberCandidates(`ClassStatic:${objectSymbol.name}.${memberName}`, classCandidates, callArgCount);

                        const memberMatches = this.symbolCache.findMemberInClassMatches(memberName, objectSymbol.name, document.uri.fsPath, callCtx);
                        if (memberMatches.length > 0) {
                            const memberSymbol = memberMatches[0];
                            const fileName = memberSymbol.filePath.split('\\').pop() || memberSymbol.filePath;
                            this.log(`[Member Found] ${memberName} in class ${objectSymbol.name}`);
                            this.log(`[Selected] ${this.formatCandidate(memberSymbol)}`);
                            this.log(`[Location] File: ${fileName} | Line: ${memberSymbol.line + 1} | ClassName: ${memberSymbol.className || 'N/A'}`);
                            return this.buildDefinitionResult(memberMatches);
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

                        const memberMatches = this.symbolCache.findMemberInClassMatches(memberName, resolvedType, document.uri.fsPath, callCtx);

                        if (memberMatches.length > 0) {
                            const memberSymbol = memberMatches[0];
                            const fileName = memberSymbol.filePath.split('\\').pop() || memberSymbol.filePath;
                            this.log(`[Member Found] ${memberName} in class ${resolvedType}`);
                            this.log(`[Selected] ${this.formatCandidate(memberSymbol)}`);
                            this.log(`[Location] File: ${fileName} | Line: ${memberSymbol.line + 1} | ClassName: ${memberSymbol.className || 'N/A'}`);
                            return this.buildDefinitionResult(memberMatches);
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

        if (token.isCancellationRequested) {
            return undefined;
        }

        // Fallback to regular definition search (when member access path didn't find anything)
        // 호출부 인자 개수(callArgCount)를 함께 넘겨, 한정자 없는 호출 `getWafer(a, b, c)`도
        // 이름만이 아니라 인자 개수(Optional/ParamArray 포함)에 맞는 오버로드로 이동하게 한다.
        this.log(`[Fallback Search] Member access resolution did not return. Looking for simple definition of "${word}" | callArgCount=${typeof callArgCount === 'number' ? callArgCount : 'N/A'}`);
        const matches = this.symbolCache.findDefinitionMatches(word, document.uri.fsPath, callCtx);
        const symbol: GPLSymbol | undefined = matches[0];

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
                    const nameMatches = localSymbols.filter(s => ciEq(s.name, word));
                    if (nameMatches.length === 0) {
                        this.log(`[Not Found] Symbol "${word}" not found (cache + scoped local parse)`);
                        return undefined;
                    }

                    // 캐시 미스 상태에서도 오버로드를 인자 개수·타입에 맞춰 선택한다.
                    const picked = this.pickLocalMatches(nameMatches, callCtx);
                    const any = picked[0];
                    this.log(`[Local Symbol Found - NonLocalParse] ${any.name} | Line: ${any.line + 1} | Kind: ${any.kind} | ClassName: ${any.className || 'N/A'}`);
                    return this.buildDefinitionResult(picked);
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
        return this.buildDefinitionResult(matches);
    }
}
