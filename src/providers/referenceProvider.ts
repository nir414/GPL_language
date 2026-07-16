import * as vscode from 'vscode';
import * as path from 'path';
import { SymbolCache } from '../symbolCache';
import { GPLParser, GPLSymbol } from '../gplParser';
import { isTraceVerbose, ciEq, getQualifiedWordAtPosition, isInCommentOrString } from '../config';
import { extractBaseObjectName, escapeRegExp } from '../language/cursorExpression';

export class GPLReferenceProvider implements vscode.ReferenceProvider {
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

    private buildQualifiedMemberPattern(escapedQualifier: string, escapedWord: string): string {
        return `\\b${escapedQualifier}\\s*\\.\\s*${escapedWord}\\b`;
    }

    private buildAnyQualifierPattern(escapedWord: string): string {
        // Match member access ending in ".Member" while allowing GPL array/index suffixes
        // in qualifier segments, e.g.:
        // - obj.Member
        // - steps(i).RunZeroStep
        // - arr(0)(1).Member
        // - foo.bar(i).Member
        const qualifierSegment = `\\b\\w+(?:\\s*\\([^\\r\\n()]*\\))*`;
        return `${qualifierSegment}(?:\\s*\\.\\s*${qualifierSegment})*\\s*\\.\\s*${escapedWord}\\b`;
    }

    private tryGetDefinitionSymbolAtPosition(
        document: vscode.TextDocument,
        position: vscode.Position,
        word: string,
        wordRange: vscode.Range
    ): GPLSymbol | undefined {
        try {
            const localSymbols = GPLParser.parseDocument(document.getText(), document.uri.fsPath);
            const inLine = localSymbols.filter(s => ciEq(s.name, word) && s.line === position.line);

            // Prefer the symbol whose indexed range covers the cursor.
            const covering = inLine.find(s => {
                const start = Math.max(0, s.range?.start ?? 0);
                const end = Math.max(start, s.range?.end ?? start);
                return wordRange.start.character >= start && wordRange.start.character <= end;
            });
            if (covering) {
                return covering;
            }

            // Fallback: if there's exactly one symbol with that name on the line, use it.
            if (inLine.length === 1) {
                return inLine[0];
            }

            return undefined;
        } catch {
            return undefined;
        }
    }

    /**
     * 식별자가 "문장 맨 앞의 좌변 대입"인지 판별한다.
     * 즉 같은 줄에서 식별자 앞에는 공백뿐이고, 식별자 뒤에는 (공백 후) 단일 `=`가 오는 형태.
     *
     * GPL/VB에서 함수 본문의 `FunctionName = value`는 반환값 대입문이며,
     * 이는 함수 호출/사용 참조가 아니라 반환값 설정이므로 참조 결과에서 제외한다.
     * `result = FunctionName(...)`처럼 우변 호출은 식별자 앞에 다른 토큰이 있으므로 제외되지 않는다.
     * `If FunctionName = 0 Then`처럼 비교문도 앞에 `If`가 있어 제외되지 않는다.
     */
    private isStatementLeadingAssignmentLHS(text: string, identifierStart: number, identifierLen: number): boolean {
        // 식별자 앞이 줄 시작까지 공백뿐인지 확인.
        let i = identifierStart - 1;
        while (i >= 0 && text[i] !== '\n') {
            const ch = text[i];
            if (ch !== ' ' && ch !== '\t' && ch !== '\r') {
                return false;
            }
            i--;
        }

        // 식별자 뒤: 공백을 건너뛴 다음 문자가 단일 `=`여야 한다.
        let j = identifierStart + identifierLen;
        while (j < text.length && (text[j] === ' ' || text[j] === '\t')) {
            j++;
        }
        if (text[j] !== '=') {
            return false;
        }
        // `==`, `=<` 등 합성 연산자는 제외(VB는 단일 `=`만 쓰지만 방어적으로 처리).
        if (text[j + 1] === '=') {
            return false;
        }
        return true;
    }

    /**
     * 커서가 정의 라인이 아닌 "호출부"에 있을 때, 캐시에서 정의의 스코프를 복원한다.
     *
     * 보수적으로 동작한다(참조 누락 방지 우선):
     *   - 모듈 레벨 프로시저(Sub/Function, className 없음)만 복원 대상으로 한다.
     *     클래스 멤버는 `With` 블록의 `.member` 같은 비한정 접근을 놓칠 위험이 있어 기존 광역 검색을 유지한다.
     *   - 같은 이름의 프로시저 후보가 여러 모듈/파일에 흩어져 스코프가 모호하면 복원하지 않는다.
     *   - 한정자(qualifier)가 있으면 그 모듈 스코프의 후보를 우선 사용한다.
     *
     * 복원 결과는 public 모듈 멤버에서는 (광역 검색을 유지하므로) 사실상 추가 정보로만 쓰이고,
     * private 모듈 멤버에서는 정의 파일로 검색을 좁혀 오탐(다른 파일의 동명 심볼)을 줄인다.
     */
    private recoverDefinitionScope(
        word: string,
        qualifier: string | undefined,
        document: vscode.TextDocument
    ): GPLSymbol | undefined {
        const byName = this.symbolCache.findAllByName(word)
            .filter(s => s.kind === 'sub' || s.kind === 'function');

        if (byName.length === 0) {
            return undefined;
        }

        // 클래스 멤버가 하나라도 섞여 있으면 복원하지 않는다(광역 검색 유지).
        if (byName.some(s => !!s.className)) {
            return undefined;
        }

        // 한정자가 모듈이면 해당 모듈 후보로 좁힌다.
        let pool = byName;
        if (qualifier) {
            const qSym = this.symbolCache.findDefinition(qualifier, document.uri.fsPath);
            if (qSym?.kind === 'module') {
                const inModule = byName.filter(s => s.module && ciEq(s.module, qSym.name));
                if (inModule.length > 0) {
                    pool = inModule;
                }
            }
        }

        // 스코프 합의: 남은 후보가 모두 같은 모듈이어야 한다(모호하면 포기).
        const firstModule = pool[0].module || '';
        const sameModule = pool.every(s => (s.module || '') === firstModule);
        if (!sameModule) {
            return undefined;
        }

        // 접근제한자 합의: 하나라도 private면 private로 본다(정의 파일로 좁히는 쪽이 안전).
        const anyPrivate = pool.some(s => s.accessModifier === 'private');
        const chosen = anyPrivate ? (pool.find(s => s.accessModifier === 'private') || pool[0]) : pool[0];
        return chosen;
    }

    private isQualifiedAt(text: string, matchIndex: number): boolean {
        // True if the identifier at matchIndex is preceded (ignoring whitespace) by a dot.
        for (let i = matchIndex - 1; i >= 0; i--) {
            const ch = text[i];
            if (ch === ' ' || ch === '\t') {
                continue;
            }
            return ch === '.';
        }
        return false;
    }

    private isInWorkspace(uri: vscode.Uri): boolean {
        try {
            return !!vscode.workspace.getWorkspaceFolder(uri);
        } catch {
            return false;
        }
    }

    private getQualifierBefore(text: string, identifierIndex: number): string | undefined {
        // 점(.)이 식별자 "바로 앞"(사이에 공백만 허용)에 있을 때만 한정자로 인정한다
        // — isQualifiedAt와 동일 기준. 종전에는 앞쪽 전체 텍스트의 lastIndexOf('.')를 써서
        // 몇 줄 위의 무관한 `foo.bar`가 한정자로 잡혔고, shouldAcceptByMemberScope가
        // 유효한 비한정 참조를 조용히 걸러내는 원인이 됐다.
        let i = identifierIndex - 1;
        while (i >= 0 && (text[i] === ' ' || text[i] === '\t')) {
            i--;
        }
        if (i < 0 || text[i] !== '.') {
            return undefined;
        }

        // Extract everything before the dot
        const objectExpression = text.substring(0, i).trim();

        // Get the base object name from the expression (handles array indexing, etc.)
        return extractBaseObjectName(objectExpression);
    }

    private shouldAcceptByMemberScope(
        doc: vscode.TextDocument,
        text: string,
        identifierIndex: number,
        targetClass?: string
    ): boolean {
        // Only apply strict qualification filtering for class-member reference search.
        if (!targetClass) {
            return true;
        }

        const qualifier = this.getQualifierBefore(text, identifierIndex);
        if (!qualifier) {
            // Unqualified member usage in same class/method body.
            return true;
        }

        const qSym = this.symbolCache.findDefinition(qualifier, doc.uri.fsPath);
        if (!qSym) {
            // Local variables may not be indexed in cache; keep to avoid false negatives.
            return true;
        }

        // Module.Member (e.g., CSL.Acquire) should not be counted as class member reference.
        if (qSym.kind === 'module') {
            return false;
        }

        // Static class usage: keep only same class.
        if (qSym.kind === 'class') {
            return ciEq(qSym.name, targetClass);
        }

        // Instance usage: keep only matching returnType.
        // 배열 타입(`Foo[]`)은 요소 타입으로 비교한다 — 파라미터/Dim 배열 표기 일관화(2026-07-13).
        if (qSym.returnType) {
            return ciEq(qSym.returnType.replace(/\[\]$/, ''), targetClass);
        }

        return true;
    }

    // NOTE:
    // - `workspace.findTextInFiles` is available in newer VS Code versions, but some @types/vscode
    //   versions used by this repo don't include its typings.
    // - We therefore use runtime feature detection + lightweight local typings.
    private async findTextInWorkspace(
        query: { pattern: string; isRegExp?: boolean; isCaseSensitive?: boolean; isWordMatch?: boolean },
        token: vscode.CancellationToken,
        onMatch: (r: { uri: vscode.Uri; ranges: vscode.Range[] }) => void,
        opts?: { include?: string; exclude?: string; useIgnoreFiles?: boolean; maxResults?: number }
    ): Promise<boolean> {
        return new Promise((resolve) => {
            try {
                const wsAny: any = vscode.workspace as any;
                if (typeof wsAny.findTextInFiles !== 'function') {
                    resolve(false);
                    return;
                }

                wsAny.findTextInFiles(
                    query,
                    {
                        // GPL 프로젝트는 엔트리/라이브러리로 .gpo를 함께 쓰는 경우가 많음.
                        // 참조 검색은 .gpl 뿐 아니라 .gpo도 함께 스캔해야 누락이 줄어든다.
                        include: '{**/*.gpl,**/*.gpo}',
                        exclude: '{**/bin/**,**/node_modules/**,**/.git/**}',
                        useIgnoreFiles: true,
                        ...opts
                    },
                    (result: any) => {
                        if (token.isCancellationRequested) {
                            return;
                        }
                        if (!result || !result.uri || !result.ranges || !result.ranges[0]) {
                            return;
                        }
                        onMatch({ uri: result.uri, ranges: result.ranges });
                    }
                ).then(
                    () => resolve(true),
                    () => resolve(true)
                );
            } catch {
                resolve(false);
            }
        });
    }

    async provideReferences(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.ReferenceContext,
        token: vscode.CancellationToken
    ): Promise<vscode.Location[]> {
        const ident = getQualifiedWordAtPosition(document, position);
        if (!ident) {
            return [];
        }

        const word = ident.word;
        const wordRange = ident.range;

        // Detect qualified access like Module.Member where the cursor is on Member.
        const lineText = document.lineAt(position.line).text;
        const beforeWord = lineText.substring(0, wordRange.start.character).trimEnd();
        const lastDotIndex = beforeWord.lastIndexOf('.');
        const qualifier = lastDotIndex !== -1
            ? extractBaseObjectName(beforeWord.substring(0, lastDotIndex).trim())
            : undefined;

        // If the cursor is on a qualified member access like obj.Member, the "obj" part is usually
        // a variable, not the defining type/module. Restricting references to only "obj.Member" is
        // not what users expect for class members.
        // We only treat qualifiers as authoritative when they resolve to a Module or Class symbol.
        const qualifierSymbol = qualifier
            ? this.symbolCache.findDefinition(qualifier, document.uri.fsPath)
            : undefined;
        const isAuthoritativeQualifier = qualifierSymbol?.kind === 'module' || qualifierSymbol?.kind === 'class';

        // If cursor is on a procedure definition, capture its module/class scope.
        let defSymbol = this.tryGetDefinitionSymbolAtPosition(document, position, word, wordRange);

        // 커서가 정의 라인이 아니라 "호출부"에 있는 경우에도 정의의 스코프(module/class/access)를
        // 캐시에서 복원한다. 이렇게 하면 정의에서 실행하든 호출부에서 실행하든 "참조 찾기" 결과가 일관된다.
        // 단, 같은 이름이 서로 다른 스코프에 흩어져 모호하면(예: 다른 클래스의 동명 멤버) 복원을 포기하고
        // 기존의 이름 기반 광역 검색으로 남겨, 참조가 누락되지 않도록 한다(false negative 방지 우선).
        if (!defSymbol) {
            defSymbol = this.recoverDefinitionScope(word, qualifier, document);
        }

        const targetFilePath = defSymbol?.filePath;
        const targetModule = defSymbol?.module;
        const targetClass = defSymbol?.className;
        const targetAccess = defSymbol?.accessModifier;

        this.log(
            `[References] word="${word}" qualifier=${qualifier || 'N/A'} defScope=` +
                `${targetModule || 'N/A'}${targetClass ? '.' + targetClass : ''}` +
                ` access=${targetAccess || 'N/A'} file=${targetFilePath ? targetFilePath.split('\\').pop() : 'N/A'}`
        );

        // Scope-aware search strategy:
        // - If cursor is on Module.Member (qualified), search ONLY for that qualified pattern.
        // - If cursor is on a module-level definition (e.g., Private Sub X), search:
        //   - unqualified "X" only within the defining file (to avoid mixing other modules)
        //   - qualified "Module.X" across the workspace for external callers
        // - Otherwise (ambiguous), fall back to name-only search.

        const escapedWord = escapeRegExp(word);
        const escapedQualifier = qualifier ? escapeRegExp(qualifier) : undefined;
        const escapedModule = targetModule ? escapeRegExp(targetModule) : undefined;
        const escapedClass = targetClass ? escapeRegExp(targetClass) : undefined;

        const qualifiedRegex = (q: string) => new RegExp(this.buildQualifiedMemberPattern(q, escapedWord), 'gi');
        const qualifiedPattern = (q: string) => this.buildQualifiedMemberPattern(q, escapedWord);
        const anyQualifierPattern = this.buildAnyQualifierPattern(escapedWord);
        const unqualifiedRegex = new RegExp(`\\b${escapedWord}\\b`, 'gi');
        const unqualifiedPattern = `\\b${escapedWord}\\b`;

        const isClassMember = !!targetClass;

        const isModuleLevelMember = !!targetModule && !targetClass;
        const isPrivateModuleLevelMember = isModuleLevelMember && targetAccess === 'private';

        // Scoping rules (GPL/VB-style):
        // - Class members are commonly referenced via instance-qualified syntax across files,
        //   but unqualified matches for the member name are often only meaningful within the class/defining file.
        // - Module members are effectively global; *public* module procedures are frequently called unqualified
        //   from other files, so restricting to the defining file causes false negatives.
        // - Private module-level members, however, should remain file-local.
        const shouldRestrictUnqualifiedToDefFile =
            !!targetFilePath && (isClassMember || isPrivateModuleLevelMember);

        const shouldPreferQualifiedOnly = !!escapedQualifier && isAuthoritativeQualifier;
        const shouldAlsoSearchModuleQualified = !shouldPreferQualifiedOnly && !!escapedModule && !targetClass;
        const shouldAlsoSearchClassQualified = !shouldPreferQualifiedOnly && !!escapedClass && !!targetClass;

        const locations: vscode.Location[] = [];
        const seen = new Set<string>();
        let localHits = 0;
        let workspaceHits = 0;
        let folderFallbackHits = 0;
        let folderFallbackRan = false;

        const addLocation = (uri: vscode.Uri, range: vscode.Range): boolean => {
            const key = `${uri.toString()}:${range.start.line}:${range.start.character}:${range.end.line}:${range.end.character}`;
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            locations.push(new vscode.Location(uri, range));
            return true;
        };

        // 멤버 접근/식별자 패턴은 모두 단일 라인 기준이므로(파라미터 안에서도 \r\n 제외),
        // 정규식을 문서 전체가 아니라 "라인별"로 실행한다. 이렇게 하면 정규식 입력 길이가
        // 한 줄로 제한되어, anyQualifierPattern의 중첩 수량자로 인한 catastrophic
        // backtracking(ReDoS) 위험이 구조적으로 사라진다. 헬퍼들이 기대하는 절대 오프셋은
        // doc.offsetAt(...)으로 그대로 복원한다.
        const MAX_SCAN_LINE_LENGTH = 5000; // 비정상적으로 긴(생성·압축) 라인은 스캔에서 제외
        const scanDocumentText = (doc: vscode.TextDocument, re: RegExp, opts: { unqualifiedOnly?: boolean }): number => {
            const text = doc.getText();
            let added = 0;
            const lineCount = doc.lineCount;
            for (let lineIdx = 0; lineIdx < lineCount; lineIdx++) {
                if (token.isCancellationRequested) {
                    break;
                }
                const lineText = doc.lineAt(lineIdx).text;
                if (lineText.length === 0 || lineText.length > MAX_SCAN_LINE_LENGTH) {
                    continue;
                }

                re.lastIndex = 0;
                let match: RegExpExecArray | null;
                while ((match = re.exec(lineText)) !== null) {
                    // zero-width 매치 방어(이론상 발생하지 않지만 무한 루프 방지)
                    if (match[0].length === 0) {
                        re.lastIndex++;
                        continue;
                    }

                    const full = match[0];
                    const memberOffset = full.toLowerCase().lastIndexOf(word.toLowerCase());
                    const colInLine = match.index + (memberOffset >= 0 ? memberOffset : 0);
                    const startPos = new vscode.Position(lineIdx, colInLine);
                    const startIndex = doc.offsetAt(startPos);
                    const endIndex = startIndex + word.length;

                    if (opts.unqualifiedOnly && this.isQualifiedAt(text, startIndex)) {
                        continue;
                    }

                    if (!this.shouldAcceptByMemberScope(doc, text, startIndex, targetClass)) {
                        continue;
                    }

                    const range = new vscode.Range(startPos, doc.positionAt(endIndex));

                    // 주석(')뿐 아니라 문자열("...") 내부의 매치도 참조가 아니다 (config 공용 헬퍼).
                    if (isInCommentOrString(lineText, range.start.character)) {
                        continue;
                    }

                    // 함수 본문의 반환값 대입문(FunctionName = ...)은 참조에서 제외.
                    if (
                        defSymbol?.kind === 'function' &&
                        doc.uri.fsPath === defSymbol.filePath &&
                        this.isStatementLeadingAssignmentLHS(text, startIndex, word.length)
                    ) {
                        continue;
                    }

                    if (shouldSkipAsDeclaration(doc.uri, range, doc)) {
                        continue;
                    }
                    if (addLocation(doc.uri, range)) {
                        added += 1;
                    }
                }
            }
            return added;
        };

        const shouldSkipAsDeclaration = (uri: vscode.Uri, range: vscode.Range, doc: vscode.TextDocument): boolean => {
            if (context.includeDeclaration) {
                return false;
            }
            if (!defSymbol) {
                return false;
            }
            if (uri.fsPath !== defSymbol.filePath) {
                return false;
            }
            if (range.start.line !== defSymbol.line) {
                return false;
            }

            // Best-effort: skip the first occurrence of the word on the defining line.
            const lineText = doc.lineAt(defSymbol.line).text;
            const firstIdx = lineText.toLowerCase().indexOf(word.toLowerCase());
            if (firstIdx < 0) {
                return false;
            }
            return range.start.character === firstIdx;
        };

        // Always scan the current document directly (covers files outside the workspace).
        // We keep the old local scan semantics but limit it to the most relevant patterns.
        try {
            const scanLocal = (re: RegExp, opts: { unqualifiedOnly?: boolean }) => {
                localHits += scanDocumentText(document, re, opts);
            };

            if (shouldPreferQualifiedOnly && escapedQualifier) {
                scanLocal(qualifiedRegex(escapedQualifier), {});
            } else {
                if (shouldAlsoSearchModuleQualified && escapedModule) {
                    scanLocal(qualifiedRegex(escapedModule), {});
                }
                if (shouldAlsoSearchClassQualified && escapedClass) {
                    scanLocal(qualifiedRegex(escapedClass), {});
                }
                if (shouldRestrictUnqualifiedToDefFile && targetFilePath && document.uri.fsPath === targetFilePath) {
                    scanLocal(unqualifiedRegex, { unqualifiedOnly: true });
                }
                if (isClassMember) {
                    // For class members, instance-qualified usages are the common cross-file pattern.
                    scanLocal(new RegExp(anyQualifierPattern, 'gi'), {});
                }
                if (!shouldRestrictUnqualifiedToDefFile && !isClassMember) {
                    scanLocal(unqualifiedRegex, { unqualifiedOnly: false });
                }
            }
        } catch {
            // ignore local scan errors
        }

        // Workspace-wide search using VS Code's search engine (ripgrep) for performance.
        try {
            const matchedDocs = new Map<string, vscode.TextDocument>();
            const getDoc = async (uri: vscode.Uri): Promise<vscode.TextDocument> => {
                const key = uri.toString();
                const cached = matchedDocs.get(key);
                if (cached) {
                    return cached;
                }
                const d = await vscode.workspace.openTextDocument(uri);
                matchedDocs.set(key, d);
                return d;
            };

            const handleMatch = async (r: { uri: vscode.Uri; ranges: vscode.Range[] }, opts: { unqualifiedOnly?: boolean }) => {
                if (token.isCancellationRequested) {
                    return;
                }

                const uri = r.uri;

                // Private/module-local rules: avoid scanning other files for unqualified matches.
                const isDefFile = targetFilePath && uri.fsPath === targetFilePath;
                if (
                    targetAccess === 'private' &&
                    shouldRestrictUnqualifiedToDefFile &&
                    !isDefFile &&
                    opts.unqualifiedOnly
                ) {
                    return;
                }

                const doc = await getDoc(uri);
                const text = doc.getText();
                const range = r.ranges[0];
                const startOffset = doc.offsetAt(range.start);

                const matchedText = doc.getText(range);
                const memberOffset = matchedText.toLowerCase().lastIndexOf(word.toLowerCase());
                const memberStartOffset = startOffset + (memberOffset >= 0 ? memberOffset : 0);
                const memberEndOffset = memberStartOffset + word.length;
                const normalizedRange = new vscode.Range(
                    doc.positionAt(memberStartOffset),
                    doc.positionAt(memberEndOffset)
                );

                if (!this.shouldAcceptByMemberScope(doc, text, memberStartOffset, targetClass)) {
                    return;
                }

                const lineText = doc.lineAt(normalizedRange.start.line).text;
                // 주석(')뿐 아니라 문자열("...") 내부의 매치도 참조가 아니다 (config 공용 헬퍼).
                if (isInCommentOrString(lineText, normalizedRange.start.character)) {
                    return;
                }

                // 함수 본문의 반환값 대입문(FunctionName = ...)은 참조에서 제외.
                if (
                    defSymbol?.kind === 'function' &&
                    uri.fsPath === defSymbol.filePath &&
                    this.isStatementLeadingAssignmentLHS(text, memberStartOffset, word.length)
                ) {
                    return;
                }

                if (opts.unqualifiedOnly && this.isQualifiedAt(text, memberStartOffset)) {
                    return;
                }
                if (shouldSkipAsDeclaration(uri, normalizedRange, doc)) {
                    return;
                }
                if (addLocation(uri, normalizedRange)) {
                    workspaceHits += 1;
                }
            };

            // Collect results synchronously-ish by awaiting the overall search promise.
            const pending: Promise<void>[] = [];
            const enqueue = (p: Promise<void>) => {
                pending.push(p.catch(() => undefined));
            };

            const runQuery = async (pattern: string, opts: { unqualifiedOnly?: boolean }) => {
                const ok = await this.findTextInWorkspace(
                    { pattern, isRegExp: true, isCaseSensitive: false },
                    token,
                    (r) => enqueue(handleMatch(r, opts)),
                    { maxResults: 5000 }
                );
                return ok;
            };

            // If the API isn't available, we'll skip this whole fast-path and rely on cache fallback.
            // (Local scan above still helps for out-of-workspace files.)
            let anySearchRan = false;

            if (shouldPreferQualifiedOnly && escapedQualifier) {
                anySearchRan = (await runQuery(qualifiedPattern(escapedQualifier), {})) || anySearchRan;
            } else {
                // 1) Scope-aware qualified patterns
                if (shouldAlsoSearchModuleQualified && escapedModule) {
                    anySearchRan = (await runQuery(qualifiedPattern(escapedModule), {})) || anySearchRan;
                }
                if (shouldAlsoSearchClassQualified && escapedClass) {
                    anySearchRan = (await runQuery(qualifiedPattern(escapedClass), {})) || anySearchRan;
                }

                // 2) Class member: instance-qualified pattern across workspace
                if (isClassMember) {
                    anySearchRan = (await runQuery(anyQualifierPattern, {})) || anySearchRan;
                }

                // 3) Unqualified pattern, restricted to defining file when scope is known
                if (shouldRestrictUnqualifiedToDefFile && targetFilePath) {
                    anySearchRan = (await runQuery(unqualifiedPattern, { unqualifiedOnly: true })) || anySearchRan;
                } else if (!isClassMember) {
                    // Ambiguous: name-only scan (older behavior)
                    anySearchRan = (await runQuery(unqualifiedPattern, { unqualifiedOnly: false })) || anySearchRan;
                }
            }

            if (anySearchRan) {
                await Promise.all(pending);
            }
        } catch {
            // Ignore and fall back to cache-based approach.
        }

        // Folder fallback: if workspace search returned no results outside current document,
        // try scanning the same directory for sibling .gpl files.
        try {
            const targetUri = targetFilePath ? vscode.Uri.file(targetFilePath) : document.uri;
            const targetInWorkspace = this.isInWorkspace(targetUri);
            const docInWorkspace = this.isInWorkspace(document.uri);

            const hasNonDocumentLocations = locations.some(l => l.uri.fsPath !== document.uri.fsPath);
            this.log(
                `[References] workspaceCheck: targetInWorkspace=${targetInWorkspace}, docInWorkspace=${docInWorkspace}, ` +
                    `hasNonDocumentLocations=${hasNonDocumentLocations}, target=${targetUri.fsPath}, doc=${document.uri.fsPath}`
            );
            
            // Run folder fallback if no external references were found yet
            if (!token.isCancellationRequested && !hasNonDocumentLocations) {
                folderFallbackRan = true;
                const dirFsPath = path.dirname(targetUri.fsPath);
                const dirUri = vscode.Uri.file(dirFsPath);
                const entries = await vscode.workspace.fs.readDirectory(dirUri);

                // Limit to avoid accidentally scanning huge directories.
                const gplFiles = entries
                    .filter(([name, type]) => {
                        if (type !== vscode.FileType.File) {
                            return false;
                        }
                        const lower = name.toLowerCase();
                        // Skip .gpo — binary compiled files, useless for text search
                        return lower.endsWith('.gpl');
                    })
                    .slice(0, 200)
                    .map(([name]) => vscode.Uri.file(path.join(dirFsPath, name)));

                this.log(`[References] Workspace scan=0; running folder fallback in: ${dirFsPath} (files=${gplFiles.length})`);

                for (const uri of gplFiles) {
                    if (token.isCancellationRequested) {
                        break;
                    }
                    // Avoid re-scanning the current document; it was already scanned.
                    if (uri.fsPath === document.uri.fsPath) {
                        continue;
                    }

                    let doc: vscode.TextDocument;
                    try {
                        doc = await vscode.workspace.openTextDocument(uri);
                    } catch {
                        // Skip files that cannot be opened (binary, encoding issues, etc.)
                        continue;
                    }

                    if (shouldPreferQualifiedOnly && escapedQualifier) {
                        folderFallbackHits += scanDocumentText(doc, qualifiedRegex(escapedQualifier), {});
                        continue;
                    }

                    if (shouldAlsoSearchModuleQualified && escapedModule) {
                        folderFallbackHits += scanDocumentText(doc, qualifiedRegex(escapedModule), {});
                    }
                    if (shouldAlsoSearchClassQualified && escapedClass) {
                        folderFallbackHits += scanDocumentText(doc, qualifiedRegex(escapedClass), {});
                    }
                    if (isClassMember) {
                        folderFallbackHits += scanDocumentText(doc, new RegExp(anyQualifierPattern, 'gi'), {});
                    }

                    // Unqualified scans: follow the same restriction rules.
                    if (shouldRestrictUnqualifiedToDefFile && targetFilePath) {
                        if (doc.uri.fsPath === targetFilePath) {
                            folderFallbackHits += scanDocumentText(doc, unqualifiedRegex, { unqualifiedOnly: true });
                        }
                    } else if (!isClassMember) {
                        folderFallbackHits += scanDocumentText(doc, unqualifiedRegex, { unqualifiedOnly: false });
                    }
                }
            }
        } catch {
            // ignore folder fallback errors
        }

        this.log(
            `[References] results: local=${localHits}, workspace=${workspaceHits}, folderFallback=${folderFallbackHits}, ` +
                `folderFallbackRan=${folderFallbackRan}, total=${locations.length}`
        );

        // Fallback: if workspace scan yields nothing (or was cancelled), use the existing cache-based approach.
        // Note: cache-based approach is less accurate because it is name-only and may include duplicates.
        if (!token.isCancellationRequested && locations.length === 0) {
            this.log('[References] Workspace scan returned 0. Falling back to cache-based search.');
            const refs = await this.symbolCache.findReferences(word, token);
            for (const ref of refs) {
                const uri = vscode.Uri.file(ref.filePath);

                for (const usage of ref.usages) {
                    const p = new vscode.Position(usage.line, usage.character);
                    const range = new vscode.Range(p, new vscode.Position(usage.line, usage.character + word.length));
                    const key = `${uri.toString()}:${range.start.line}:${range.start.character}:${range.end.line}:${range.end.character}`;
                    if (seen.has(key)) {
                        continue;
                    }
                    seen.add(key);
                    locations.push(new vscode.Location(uri, range));
                }
            }
        }

        return locations;
    }
}
