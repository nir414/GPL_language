import * as vscode from 'vscode';
import { SymbolCache } from '../symbolCache';
import { GPLParser, GPLSymbol } from '../language/gplParser';
import { isTraceVerbose, EXTENSION_VERSION, getQualifiedWordAtPosition, isInCommentOrString, GPL_CONTROL_KEYWORDS } from '../config';
import { ciEq } from '../language/identifiers';
import { escapeRegExp, findEnclosingProcedureRange, extractCallArgumentsFromSuffix, extractQualifierChainBefore, parseChainSegment, getStringLiteralContentAt } from '../language/cursorExpression';
import { CallContext, inferLiteralArgType, rankOverloadMatches } from '../language/overloadResolution';
import { findGplBuiltinMember } from '../language/gplBuiltins';
import { elementTypeOf, ownedByHolder, resolveReceiverTarget, ReceiverHolder, ReceiverLookup, ReceiverSegment } from '../language/receiverType';
import { buildReceiverContext } from './receiverContext';
import { dedupeSymbolLocations, preferExistingFiles, fileExists } from '../language/symbolLocations';
import { pickVisibleDeclaration } from '../language/symbolScope';

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
            // 요소 타입 규칙은 공용 정본(receiverType.elementTypeOf).
            if (sym!.kind !== 'function') {
                return elementTypeOf(type, true) ?? type;
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

    /**
     * 동명 후보 중 커서 스코프에서 실제로 보이는 선언을 고른다.
     * 판정 규칙은 공용 정본(language/symbolScope)에 있다 — 이름 바꾸기와 같은 규칙을 쓴다.
     */
    private pickBestScopedCandidate(
        candidates: GPLSymbol[],
        document: vscode.TextDocument,
        atLine: number
    ): GPLSymbol | undefined {
        if (candidates.length === 0) {
            return undefined;
        }
        return pickVisibleDeclaration(candidates, this.getEnclosingProcedureRange(document, atLine), atLine);
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

    /** 수신자 체인의 최종 대상(사용자 클래스/모듈 · 내장 클래스 · 원시 타입). 조립은 공용 정본에 맡긴다. */
    private resolveReceiver(
        document: vscode.TextDocument,
        atLine: number,
        receiver: ReceiverSegment[]
    ): ReturnType<typeof resolveReceiverTarget> {
        try {
            const { lookup } = buildReceiverContext(
                document, atLine, name => this.symbolCache.findAllByName(name));
            return resolveReceiverTarget(receiver, lookup);
        } catch (error) {
            this.log(`[Receiver Resolve Error] ${error}`);
            return undefined;
        }
    }

    /**
     * 해석된 홀더(클래스/모듈) 안에서 멤버 정의를 찾는다.
     *
     * 종전에는 모듈·정적 클래스·클래스 인스턴스가 각각 같은 조회를 복제하고 있었다(로그 문구만 달랐다).
     * 홀더 종류는 조회 대상 API 선택에만 쓰이므로 한 곳으로 합친다.
     * 홀더가 인덱스에 있다는 것은 해석기가 확인한 사실이므로, 멤버를 못 찾으면 소속 확인 조회까지만 하고
     * 전역 이름 폴백은 막는다(조용히 틀린 곳으로 가느니 "정의 없음"이 안전하다).
     */
    private findMemberDefinitionIn(
        holder: ReceiverHolder,
        memberName: string,
        document: vscode.TextDocument,
        callCtx: CallContext | undefined,
        callArgCount: number | undefined
    ): vscode.Definition | undefined {
        const isClass = holder.kind === 'class';
        const candidates = isClass
            ? this.symbolCache.findMemberCandidatesInClass(memberName, holder.name)
            : this.symbolCache.findMemberCandidatesInModule(memberName, holder.name);
        this.logMemberCandidates(`${isClass ? 'Class' : 'Module'}:${holder.name}.${memberName}`, candidates, callArgCount);

        const matches = isClass
            ? this.symbolCache.findMemberInClassMatches(memberName, holder.name, document.uri.fsPath, callCtx)
            : this.symbolCache.findMemberInModuleMatches(memberName, holder.name, document.uri.fsPath, callCtx);
        if (matches.length > 0) {
            this.log(`[Member Found] ${memberName} in ${holder.kind} ${holder.name} | ${this.formatCandidate(matches[0])}`);
            return this.buildDefinitionResult(matches);
        }
        return this.resolveOwnedMemberOrBlock(memberName, holder.name, holder.kind, callCtx);
    }

    /**
     * 멤버 해석이 실패했을 때의 마지막 단계.
     *
     * findMemberCandidatesInModule/Class는 종류(kind)를 좁게 거르므로 모듈 안의 클래스
     * (`MyModule.MyClass`)·중첩 클래스(`Outer.Inner`)·모듈 수준 Property를 놓친다. 종전에는
     * 그런 접근이 "한정자를 버리는 전역 이름 폴백" 덕에 우연히 동작했는데, 그 폴백이 동명의
     * 남의 심볼로 점프하는 원인이기도 했다. 그래서 폴백을 막는 대신 소속을 검사하는
     * 공용 규칙(receiverType.ownedByHolder)으로 한 번 더 찾고, 그래도 없으면 undefined —
     * 호출부는 이 결과를 그대로 돌려줘 전역 이름 폴백을 차단한다.
     */
    private resolveOwnedMemberOrBlock(
        memberName: string,
        containerName: string,
        containerKind: 'class' | 'module',
        callCtx?: CallContext
    ): vscode.Definition | undefined {
        const lookup: ReceiverLookup = {
            findLocal: () => undefined,
            findAllByName: name => this.symbolCache.findAllByName(name)
        };
        const owned = ownedByHolder(lookup, { kind: containerKind, name: containerName }, memberName);
        if (owned.length > 0) {
            const picked = this.pickLocalMatches(owned, callCtx);
            this.log(`[Member Found - Owned] ${containerName}.${memberName} → ${this.formatCandidate(picked[0])}`);
            return this.buildDefinitionResult(picked);
        }
        // 컨테이너는 인덱스에 확실히 존재하는데 그 안에 이 이름이 없다 → 전역 이름 폴백으로 흘려보내면
        // 한정자를 무시한 채 동명의 다른 심볼로 점프한다. 조용히 틀린 곳으로 가느니 "정의 없음"이 안전하다.
        this.log(`[Member NOT Found] "${memberName}" in ${containerKind} "${containerName}" → 전역 폴백 차단`);
        return undefined;
    }

    private formatCandidate(symbol: GPLSymbol): string {
        const paramCount = symbol.parameters ? symbol.parameters.length : 0;
        return `${symbol.name} [${symbol.kind}] params=${paramCount} file=${symbol.filePath} line=${symbol.line + 1} class=${symbol.className || 'N/A'} module=${symbol.module || 'N/A'}`;
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
     *
     * 단, "여럿"은 **서로 다른 선언**일 때만 의미가 있다. 같은 선언이 표기만 다르게 인덱싱됐거나
     * 이미 사라진 파일의 잔류 항목이면 목록만 지저분해지므로 여기서 걸러낸다
     * (규칙 정본: `language/symbolLocations.ts`).
     */
    private buildDefinitionResult(symbols: GPLSymbol[]): vscode.Definition {
        const picked = this.narrowToDistinctLocations(symbols);

        if (picked.length > 1) {
            this.log(`[Ambiguous Overload] ${picked.length} equally-ranked candidates → returning all as peek list`);
            for (const s of picked) {
                this.log(`  = ${this.formatCandidate(s)}`);
            }
            return picked.map(s => this.buildLocation(s));
        }
        return this.buildLocation(picked[0]);
    }

    /**
     * peek 목록에 올릴 후보를 "실제로 서로 다른, 열 수 있는 선언"으로 줄인다.
     * 후보가 하나면 아무것도 하지 않는다(불필요한 동기 I/O 회피).
     */
    private narrowToDistinctLocations(symbols: GPLSymbol[]): GPLSymbol[] {
        if (symbols.length <= 1) {
            return symbols;
        }

        const unique = dedupeSymbolLocations(symbols);
        if (unique.length < symbols.length) {
            this.log(`[Duplicate Locations] ${symbols.length} → ${unique.length} (같은 파일·줄을 가리키는 항목 병합)`);
        }

        const alive = preferExistingFiles(unique, fileExists);
        if (alive.length < unique.length) {
            this.log(`[Stale Locations] ${unique.length} → ${alive.length} (디스크에 없는 파일 제외 — 캐시 잔류)`);
            // 여기서만 걸러내면 호버·자동완성·참조 검색은 계속 사라진 파일의 심볼을 본다.
            // 잔류를 발견한 자리에서 인덱스까지 정리한다(자가 치유 — 워처가 놓친 삭제/이동 대비).
            const dropped = unique.filter(u => !alive.includes(u)).map(u => u.filePath);
            const pruned = this.symbolCache.pruneMissingFiles(dropped);
            if (pruned > 0) {
                this.log(`[Stale Locations] 인덱스에서 파일 항목 ${pruned}개 제거 (자가 치유)`);
            }
        }

        return alive;
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

    /**
     * 문자열 리터럴 속 프로시저 참조 해석.
     *
     * GPL은 Thread 생성자 등에서 실행할 프로시저를 문자열로 받는다:
     *   New Thread("DataFile.SaveReservationThreadFunction",,"SaveReservationThreadFunction")
     * 문자열 전체가 식별자 형태("Name" / "Class.Proc")일 때만 해석을 시도한다:
     *   - 커서 segment 앞에 qualifier가 있으면 → 그 클래스/모듈의 Sub/Function
     *   - 커서 segment 뒤에 '.'이 이어지면 → 클래스/모듈 정의
     *   - 단일 식별자면 → 이름이 일치하는 Sub/Function
     * 해석 실패 시 undefined — 기존의 "문자열 내부 차단"과 같은 결과라서
     * 일반 문장/경로 등의 문자열에서 엉뚱한 곳으로 점프하지 않는다.
     */
    private resolveStringLiteralReference(
        document: vscode.TextDocument,
        ident: { range: vscode.Range; word: string; qualifier?: string },
        line: string
    ): vscode.Definition | undefined {
        const literal = getStringLiteralContentAt(line, ident.range.start.character);
        if (!literal || !/^[A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)*$/.test(literal.text.trim())) {
            return undefined;
        }

        const word = ident.word;
        const isCallable = (s: GPLSymbol) => s.kind === 'sub' || s.kind === 'function';
        this.log(`[String Ref] literal="${literal.text.trim()}" | word="${word}" | qualifier="${ident.qualifier ?? 'N/A'}"`);

        if (ident.qualifier) {
            // "Class.Proc"에서 커서가 Proc 위 — 클래스 멤버 → 모듈 멤버 순으로 탐색
            const inClass = this.symbolCache
                .findMemberInClassMatches(word, ident.qualifier, document.uri.fsPath)
                .filter(isCallable);
            if (inClass.length > 0) {
                this.log(`[String Ref Found] ${ident.qualifier}.${word} → class member`);
                return this.buildDefinitionResult(inClass);
            }
            const inModule = this.symbolCache
                .findMemberInModuleMatches(word, ident.qualifier, document.uri.fsPath)
                .filter(isCallable);
            if (inModule.length > 0) {
                this.log(`[String Ref Found] ${ident.qualifier}.${word} → module member`);
                return this.buildDefinitionResult(inModule);
            }
        } else if (/^\s*\./.test(line.substring(ident.range.end.character))) {
            // "Class.Proc"에서 커서가 첫 segment 위 — 클래스/모듈 정의로
            const containers = this.symbolCache
                .findDefinitionMatches(word, document.uri.fsPath)
                .filter(s => s.kind === 'class' || s.kind === 'module');
            if (containers.length > 0) {
                this.log(`[String Ref Found] ${word} → ${containers[0].kind}`);
                return this.buildDefinitionResult([containers[0]]);
            }
        } else {
            // 단일 식별자 — Sub/Function만 허용 (변수 등과의 우연한 이름 일치는 배제)
            const procs = this.symbolCache
                .findDefinitionMatches(word, document.uri.fsPath)
                .filter(isCallable);
            if (procs.length > 0) {
                this.log(`[String Ref Found] ${word} → ${procs[0].kind}`);
                return this.buildDefinitionResult(procs);
            }
        }

        // 캐시 미스 대비: 현재 문서 온디맨드 파싱 폴백 (스레드 프로시저는 같은 파일에 있는 경우가 많다)
        try {
            const localSymbols = GPLParser.parseDocument(document.getText(), document.uri.fsPath);
            const matches = localSymbols.filter(s => ciEq(s.name, word) && isCallable(s)
                && (!ident.qualifier
                    || ciEq(s.className ?? '', ident.qualifier)
                    || ciEq(s.module ?? '', ident.qualifier)));
            if (matches.length > 0) {
                this.log(`[String Ref Found - Local] ${matches[0].name} @line ${matches[0].line + 1}`);
                return this.buildDefinitionResult([matches[0]]);
            }
        } catch (error) {
            this.log(`[String Ref Parse Error] ${error}`);
        }

        this.log(`[String Ref] "${literal.text.trim()}" did not resolve — string stays blocked`);
        return undefined;
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

        // 주석(')·문자열("...") 내부는 원칙적으로 정의 대상이 아니다 — 오검색/엉뚱한 점프 방지 (2026-07-03).
        // 단, GPL은 프로시저를 문자열로 참조하는 관용구가 있으므로
        // (예: New Thread("DataFile.SaveReservationThreadFunction")), 문자열 전체가
        // 식별자 형태이고 Sub/Function 등으로 해석될 때만 예외적으로 점프한다 (2026-07-22).
        if (isInCommentOrString(line, wordRange.start.character)) {
            return this.resolveStringLiteralReference(document, ident, line);
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
                this.log(`[Constructor Found] New in class ${constructorClassName}`);
                this.log(`[Location] File: ${ctorSymbol.filePath} | Line: ${ctorSymbol.line + 1} | ClassName: ${ctorSymbol.className || 'N/A'}`);

                return this.buildLocation(ctorSymbol);
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
                        this.log(`[Constructor Found - ClassFile] New in class ${constructorClassName} @line ${fileCtor.line + 1} | File: ${fileCtor.filePath}`);
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
        
        // ── 멤버 접근(`receiver.member`) — 수신자 체인은 공용 해석기가 푼다 ──────────────
        // 종전에는 점 **바로 앞 식의 첫 이름만**(extractBaseObjectName) 보고 타입을 정했다. 그래서
        // `a.b.member` 는 b 가 아니라 a 에서 멤버를 찾았고, `Me.` 나 내장 멤버를 거친 체인
        // (`Thread.CurrentThread().Name`)은 아예 해석하지 못한 채 **한정자를 버린 전역 이름 폴백**으로
        // 흘러 동명의 남의 심볼로 점프했다. hover·완성과 같은 정본(receiverType)을 쓰면 그 편차가 사라진다.
        const chainInfo = extractQualifierChainBefore(line.substring(0, wordRange.start.character).trimEnd());
        if (chainInfo) {
            const memberName = word;
            const parsed = chainInfo.chain.map(parseChainSegment);
            const receiver = parsed.every(seg => seg !== undefined) ? parsed as ReceiverSegment[] : undefined;
            const target = receiver ? this.resolveReceiver(document, position.line, receiver) : undefined;
            const chainText = chainInfo.chain.join('.');
            this.log(`[Member Access] Receiver: "${chainText}" | Member: "${memberName}" | Target: ${target ? `${target.kind} ${target.name}` : '미해석'} | callArgCount=${typeof callArgCount === 'number' ? callArgCount : 'N/A'}`);

            if (target?.kind === 'builtinClass') {
                // 내장(GPL Dictionary) 클래스가 수신자면 이동할 소스 정의가 없다
                // (Move.Loc, Console.WriteLine, Dim t As Thread → t.Start ...).
                // 전역 폴백으로 흘려보내면 한정자를 버린 채 동명 사용자 심볼로 점프한다
                // (예: Move.Run → Lib_MoveQueue.Run). 해석기는 동명 사용자 클래스/모듈을 먼저
                // 보므로, 여기 도달했다는 것은 그런 사용자 정의가 없다는 뜻이다. (2026-08-31)
                const builtinMember = findGplBuiltinMember(target.name, memberName);
                const memberDesc = builtinMember ? `내장 ${builtinMember.kind}` : '내장 클래스에 없는 멤버';
                this.log(`[Builtin Receiver] "${target.name}.${memberName}" → ${memberDesc} | 소스 정의 없음 → 전역 폴백 차단`);
                return undefined;
            }
            if (target?.kind === 'class' || target?.kind === 'module') {
                return this.findMemberDefinitionIn(target, memberName, document, callCtx, callArgCount);
            }
            // 원시 타입·미해석(캐시 stale·미인덱싱 파일 포함)은 종전처럼 전역 이름 폴백에 맡긴다 —
            // 여기서 막으면 "파일을 방금 복사해 와 캐시가 낡은" 경우를 못 찾는다.
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

        this.log(`[Symbol Found] ${symbol.name} | File: ${symbol.filePath} | Line: ${symbol.line + 1} | ClassName: ${symbol.className || 'N/A'}`);
        return this.buildDefinitionResult(matches);
    }
}
