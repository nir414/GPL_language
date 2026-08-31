import * as vscode from 'vscode';
import { SymbolCache } from '../symbolCache';
import { GPLParser, GPLSymbol, GPLSymbolKind } from '../gplParser';
import { isTraceVerbose, EXTENSION_VERSION, ciEq, isInCommentOrString, getHoverConfig, HoverConfig } from '../config';
import { findEnclosingProcedureRange, extractDebugExpressionAt } from '../language/cursorExpression';
import {
    buildDocumentReceiverLookup,
    membersNamed,
    resolveReceiverHolder,
    resolveReceiverTypeName,
    ReceiverSegment,
} from '../language/receiverType';
import { renderDocCommentMarkdown } from '../language/docComment';
import {
    findGplBuiltin,
    findGplBuiltinMember,
    findGplClassDoc,
    getGplBuiltinReferenceUrl,
    getGplClassMembers,
    GPLBuiltinEntry,
    GPLClassDoc,
} from '../gplBuiltins';

export class GPLHoverProvider implements vscode.HoverProvider {

    constructor(
        private symbolCache: SymbolCache,
        private outputChannel?: vscode.OutputChannel
    ) {}

    // GitHub #19: (uri, version) 단위 문서 심볼 캐시. GPLParser.parseDocument 는 내용 기준으로 메모이즈되어
    // 있어(ai-handoff §1-B E) 재파싱은 이미 없었지만, 호버(마우스 이동)마다 document.getText()로 수천 줄 문자열을
    // 새로 만들고 캐시 키(전체 내용)를 비교하는 비용이 반복됐다. 문서 버전이 같으면 그 비용까지 건너뛴다.
    // includeLocals 파싱 결과는 모듈 심볼의 상위 집합이므로 로컬 해석과 폴백 파싱이 같은 결과를 공유한다.
    private _docSymbolsCache?: { uri: string; version: number; symbols: GPLSymbol[] };

    private getDocumentSymbols(document: vscode.TextDocument): GPLSymbol[] {
        const uri = document.uri.toString();
        const cached = this._docSymbolsCache;
        if (cached && cached.uri === uri && cached.version === document.version) {
            return cached.symbols;
        }
        const symbols = GPLParser.parseDocument(document.getText(), document.uri.fsPath, {
            includeLocals: true,
            includeParameters: true
        });
        this._docSymbolsCache = { uri, version: document.version, symbols };
        return symbols;
    }

    private log(message: string) {
        if (!isTraceVerbose(vscode.workspace)) {
            return;
        }
        this.outputChannel?.appendLine(message);
    }

    private stripComment(line: string): string {
        const idx = line.indexOf("'");
        return idx >= 0 ? line.slice(0, idx) : line;
    }

    /**
     * Render a captured `'` doc-comment block as markdown.
     * 구조화된 주석(`# Parameters` / `# Returns` / `# Examples` …)은 섹션째 보여 주고,
     * 구조가 없는 옛 주석은 종전처럼 서술만 보여 준다(docComment.ts 참조).
     *
     * 표시량은 gpl.hover.docComment(summary|full|off) + docCommentMaxLines로 조절한다:
     *  - summary(기본): **설명**은 첫 문단(빈 줄 전까지)만, maxLines 초과분은 잘라내고 '…' 표시.
     *  - full: 설명 전체를 표시하되 maxLines(0=무제한)까지만.
     *  - off: 호출부에서 표시 자체를 생략.
     *  섹션은 작성자가 스스로 길이를 정한 구조이므로 두 모드 모두 그대로 표시한다.
     */
    private formatDocComment(doc: string, config: HoverConfig): string | undefined {
        if (config.docComment === 'off') {
            return undefined;
        }
        return renderDocCommentMarkdown(doc, {
            descriptionMode: config.docComment === 'full' ? 'full' : 'summary',
            maxDescriptionLines: config.docCommentMaxLines,
        });
    }

    /** brooks-gpl 디버그 세션이 활성인지 (duringDebug 모드 적용 대상 판별). */
    private isGplDebugActive(): boolean {
        return vscode.debug.activeDebugSession?.type === 'brooks-gpl';
    }

    /** Function/Sub 심볼의 표시용 시그니처 문자열 생성 (`Function name(params) As T` / `Sub name(params)`). */
    private buildCallableSignature(sym: GPLSymbol): string {
        const params = sym.parameters?.join(', ') ?? '';
        return sym.kind === GPLSymbolKind.Function
            ? `Function ${sym.name}(${params})${sym.returnType ? ` As ${sym.returnType}` : ''}`
            : `Sub ${sym.name}(${params})`;
    }

    private getSymbolKindTitle(kind: GPLSymbolKind): string {
        switch (kind) {
            case GPLSymbolKind.Module:
                return 'Module';
            case GPLSymbolKind.Class:
                return 'Class';
            case GPLSymbolKind.Function:
                return 'Function';
            case GPLSymbolKind.Sub:
                return 'Sub';
            case GPLSymbolKind.Property:
                return 'Property';
            case GPLSymbolKind.Constant:
                return 'Const';
            case GPLSymbolKind.Variable:
            default:
                return 'Variable';
        }
    }

    /**
     * 커서를 감싸는 프로시저 스코프의 로컬 변수/파라미터를 찾는다.
     *
     * 캐시(모듈 레벨 심볼)를 먼저 조회하면 동명의 로컬/파라미터가 모듈 레벨 심볼에
     * 가려지므로, definitionProvider와 동일하게 로컬을 먼저 해석한다
     * (같은 스코프 안에서는 사용 위치보다 위의 가장 가까운 선언 우선).
     */
    private findEnclosingLocalSymbol(
        document: vscode.TextDocument,
        name: string,
        atLine: number
    ): GPLSymbol | undefined {
        try {
            const localSymbols = this.getDocumentSymbols(document);
            const locals = localSymbols.filter(s => ciEq(s.name, name) && s.isLocal);
            if (locals.length === 0) {
                return undefined;
            }

            const proc = findEnclosingProcedureRange(
                i => document.lineAt(i).text,
                document.lineCount,
                atLine
            );
            if (!proc) {
                return undefined;
            }

            const inScope = locals.filter(s => s.line >= proc.startLine && s.line <= proc.endLine);
            if (inScope.length === 0) {
                return undefined;
            }

            const above = inScope.filter(s => s.line <= atLine).sort((a, b) => b.line - a.line);
            return above[0] ?? inScope.sort((a, b) => a.line - b.line)[0];
        } catch {
            return undefined;
        }
    }

    /**
     * GPL Dictionary 내장 항목 호버 카드.
     * 문서의 구문 표기(`usage`)가 있으면 그것을 보여 Shared/인스턴스 구분과 반환값 형태를 드러내고,
     * 값 표·매개변수 범위 같은 상세(`details`)는 gpl.hover.builtinDetails가 켜져 있을 때만 덧붙인다.
     */
    private buildBuiltinHover(
        entry: GPLBuiltinEntry,
        compact: boolean,
        config: HoverConfig,
        range: vscode.Range,
    ): vscode.Hover {
        const md = new vscode.MarkdownString();
        if (compact) {
            // 디버깅 중: 구문 한 줄만.
            md.appendCodeblock(entry.usage ?? entry.signature, 'gpl');
        } else {
            md.appendMarkdown(`**GPL Built-in** · ${entry.category}\n\n`);
            md.appendCodeblock(entry.usage ?? entry.signature, 'gpl');
            md.appendMarkdown(`\n${entry.summary}`);
            if (config.builtinDetails && entry.details) {
                md.appendMarkdown(`\n\n---\n\n${entry.details}`);
            }
            const refUrl = getGplBuiltinReferenceUrl(entry);
            const refLabel = entry.sourceUrl ? 'Reference' : 'GPL Dictionary';
            md.appendMarkdown(`\n\n[${refLabel}](${refUrl})`);
        }
        md.isTrusted = false;
        return new vscode.Hover(md, range);
    }

    /**
     * 내장 클래스 이름(`Thread`) 자체의 호버 카드 — GPL Dictionary 클래스 소개 페이지 기반.
     * 생성자 구문(`New Thread(...)`)과 멤버 목록을 함께 보여 준다.
     */
    private buildClassDocHover(
        doc: GPLClassDoc,
        compact: boolean,
        config: HoverConfig,
        range: vscode.Range,
    ): vscode.Hover {
        const md = new vscode.MarkdownString();
        if (compact) {
            md.appendCodeblock(doc.constructorSignature ?? doc.name, 'gpl');
        } else {
            md.appendMarkdown(`**GPL Built-in Class** · ${doc.name}\n\n`);
            if (doc.constructorSignature) {
                md.appendCodeblock(doc.constructorSignature, 'gpl');
            }
            md.appendMarkdown(`\n${doc.summary}`);
            if (doc.constructorSummary) {
                md.appendMarkdown(`\n\n${doc.constructorSummary}`);
            }
            if (config.builtinDetails && doc.details) {
                md.appendMarkdown(`\n\n---\n\n${doc.details}`);
            }
            const members = getGplClassMembers(doc.name);
            if (members.length > 0) {
                const names = members.map(m => `\`${m.name.slice(doc.name.length + 1)}\``).join(', ');
                md.appendMarkdown(`\n\n---\n\n**멤버**: ${names}`);
            }
            md.appendMarkdown(`\n\n[Reference](${doc.sourceUrl})`);
        }
        md.isTrusted = false;
        return new vscode.Hover(md, range);
    }

    /**
     * 내장 클래스 타입 인스턴스의 멤버(`Dim t As Thread` → `t.Abort`)를 GPL Dictionary에서 찾는다.
     * resolveReceiverHolder는 사용자 클래스/모듈만 해석하므로 내장 타입에는 타입 이름 해석기를 쓴다.
     */
    private findBuiltinReceiverMember(
        document: vscode.TextDocument,
        atLine: number,
        receiver: ReceiverSegment[],
        memberName: string,
    ): GPLBuiltinEntry | undefined {
        try {
            const docSymbols = this.getDocumentSymbols(document);
            const range = findEnclosingProcedureRange(i => document.lineAt(i).text, document.lineCount, atLine);
            const lookup = buildDocumentReceiverLookup(docSymbols, range, atLine, n => this.symbolCache.findAllByName(n));
            const typeName = resolveReceiverTypeName(receiver, lookup);
            if (!typeName) {
                return undefined;
            }
            const entry = findGplBuiltinMember(typeName, memberName);
            if (entry) {
                this.log(`[Hover Receiver] 내장 클래스 ${typeName} → ${entry.name}`);
            }
            return entry;
        } catch (e) {
            this.log(`[Hover Builtin Receiver Error] ${e}`);
            return undefined;
        }
    }

    /**
     * 멤버 접근 `receiver.member`의 `member`를 수신자 클래스/모듈에서 찾는다(GitHub #32).
     * 수신자 타입은 로컬/파라미터 → 클래스·모듈 이름 → 캐시 심볼의 returnType 체이닝으로 해석(receiverType.ts).
     * 정확한 className 일치(현재 문서 포함)를 우선하고, 없으면 캐시의 findMemberInClass/Module(오버로드 선택 포함).
     */
    private findReceiverMember(
        document: vscode.TextDocument,
        atLine: number,
        receiver: ReceiverSegment[],
        memberName: string,
    ): GPLSymbol | undefined {
        try {
            const docSymbols = this.getDocumentSymbols(document);
            const range = findEnclosingProcedureRange(i => document.lineAt(i).text, document.lineCount, atLine);
            const lookup = buildDocumentReceiverLookup(docSymbols, range, atLine, n => this.symbolCache.findAllByName(n));
            const holder = resolveReceiverHolder(receiver, lookup);
            const chain = receiver.map(s => (s.args !== undefined ? `${s.name}(${s.args})` : s.name)).join('.');
            if (!holder) {
                this.log(`[Hover Receiver] ${chain}.${memberName}: 수신자 타입 해석 실패 → 이름 기반 조회`);
                return undefined;
            }
            const exact = membersNamed(lookup, holder, memberName)[0];
            const found = exact ?? (holder.kind === 'class'
                ? this.symbolCache.findMemberInClass(memberName, holder.name, document.uri.fsPath)
                : this.symbolCache.findMemberInModule(memberName, holder.name, document.uri.fsPath));
            this.log(`[Hover Receiver] ${chain}.${memberName}: ${holder.kind} ${holder.name} → ${found ? `${found.kind} ${found.name}` : '멤버 없음'}`);
            return found;
        } catch (e) {
            this.log(`[Hover Receiver Error] ${e}`);
            return undefined;
        }
    }

    private getIdentifierAtPosition(document: vscode.TextDocument, position: vscode.Position): { text: string; range: vscode.Range } | undefined {
        const line = document.lineAt(position.line).text;
        if (!line) {
            return undefined;
        }

        const isIdentChar = (ch: string) => /[A-Za-z0-9_.]/.test(ch);
        let start = position.character;
        let end = position.character;

        while (start > 0 && isIdentChar(line[start - 1])) {
            start--;
        }
        while (end < line.length && isIdentChar(line[end])) {
            end++;
        }

        if (start === end) {
            return undefined;
        }

        const raw = line.slice(start, end);
        const trimmed = raw.replace(/^\.+|\.+$/g, '');
        if (!trimmed || !/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(trimmed)) {
            return undefined;
        }

        const leftTrim = raw.indexOf(trimmed);
        const range = new vscode.Range(position.line, start + leftTrim, position.line, start + leftTrim + trimmed.length);
        return { text: trimmed, range };
    }

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | undefined> {
        if (token.isCancellationRequested) {
            return undefined;
        }

        // 표시량 설정 (gpl.hover.*) — 스팸성 대형 팝업 방지 (2026-07-14).
        const config = getHoverConfig(vscode.workspace);
        if (!config.enabled) {
            return undefined;
        }
        // 디버깅 중에는 변수 값 호버가 주인공이므로 언어 호버를 간소화/억제한다.
        const debugActive = this.isGplDebugActive();
        if (debugActive && config.duringDebug === 'off') {
            return undefined;
        }
        const compact = debugActive && config.duringDebug === 'compact';

        const ident = this.getIdentifierAtPosition(document, position);
        if (!ident) {
            return undefined;
        }

        const word = ident.text;
        const wordRange = ident.range;

        const line = document.lineAt(position.line).text;

        // 주석(')·문자열("...") 내부에서는 호버를 띄우지 않는다 (2026-07-03).
        if (isInCommentOrString(line, wordRange.start.character)) {
            return undefined;
        }

        this.log(`\n[Hover Request] v${EXTENSION_VERSION} | Word: "${word}" | Line: "${line.trim()}"`);

        // 1) Built-in hover (문서 기반)
        const builtin = findGplBuiltin(word);
        if (builtin) {
            return this.buildBuiltinHover(builtin, compact, config, wordRange);
        }

        const lookupName = word.includes('.') ? word.split('.').pop()! : word;

        // 멤버 접근의 수신자 체인(GitHub #32). `word`는 `[\w.]`만 모으므로 `robotArmList(0).controlAxis`처럼
        // 괄호가 끼면 `controlAxis`만 남는다 — 커서 식 추출기(괄호 그룹 인식)로 `.` 앞 체인을 되찾는다.
        const cursorExpr = extractDebugExpressionAt(line, position.character);
        const receiverSegs = cursorExpr && cursorExpr.segments.length > 1
            && ciEq(cursorExpr.segments[cursorExpr.cursorSegment].name, lookupName)
            ? cursorExpr.segments.slice(0, cursorExpr.cursorSegment)
            : undefined;

        // 로컬 변수/파라미터가 동명의 모듈 레벨 캐시 심볼에 가려지지 않도록, 감싸는
        // 프로시저 스코프의 로컬을 먼저 해석한다(definitionProvider와 동일 규칙).
        // 멤버 접근(`obj.Member`)은 로컬 스코프 대상이 아니므로 제외.
        let sym = !word.includes('.') && !receiverSegs
            ? this.findEnclosingLocalSymbol(document, lookupName, position.line)
            : undefined;

        // 멤버 접근이면 수신자 클래스를 정적으로 해석해 **그 클래스의 멤버**를 먼저 찾는다(GitHub #32).
        // 종전에는 마지막 이름만으로 findDefinition(현재 파일 우선)해 다른 클래스의 동명 Function 시그니처가 표시됐다.
        // 해석에 실패하면 종전 이름 기반 조회로 폴백한다.
        if (!sym && receiverSegs && !token.isCancellationRequested) {
            sym = this.findReceiverMember(document, position.line, receiverSegs, lookupName);
        }

        // 수신자 타입이 내장 클래스면 GPL Dictionary 멤버를 보여 준다(`Dim t As Thread` → `t.Abort`).
        // 이름 기반 findDefinition보다 먼저 봐야 다른 클래스의 동명 멤버가 잘못 표시되지 않는다.
        if (!sym && receiverSegs && !token.isCancellationRequested) {
            const builtinMember = this.findBuiltinReceiverMember(document, position.line, receiverSegs, lookupName);
            if (builtinMember) {
                return this.buildBuiltinHover(builtinMember, compact, config, wordRange);
            }
        }

        // Prefer cache definition
        if (!sym) {
            sym = this.symbolCache.findDefinition(lookupName, document.uri.fsPath);
        }

        // Fallback: parse current document (works even outside workspace indexing)
        // includeLocals 캐시를 재사용하되 비-로컬(모듈 레벨) 심볼만 대상으로 해 종전 의미를 유지한다(GitHub #19).
        if (!sym && !token.isCancellationRequested) {
            try {
                const docSymbols = this.getDocumentSymbols(document);
                sym = docSymbols.find(s => !s.isLocal && ciEq(s.name, lookupName));
            } catch (e) {
                this.log(`[Hover Local Parse Error] ${e}`);
            }
        }

        // 사용자 심볼이 전혀 없을 때만 내장 클래스 개요를 보여 준다(동명 사용자 심볼이 우선).
        if (!sym && !word.includes('.')) {
            const classDoc = findGplClassDoc(word);
            if (classDoc) {
                return this.buildClassDocHover(classDoc, compact, config, wordRange);
            }
        }

        if (!sym) {
            return undefined;
        }

        const kindTitle = this.getSymbolKindTitle(sym.kind);
        const md = new vscode.MarkdownString();

        const isCallable = sym.kind === GPLSymbolKind.Function || sym.kind === GPLSymbolKind.Sub;

        if (compact && isCallable) {
            // 디버깅 중: 시그니처 한 줄만 (변수 값 호버를 가리지 않게).
            md.appendCodeblock(this.buildCallableSignature(sym), 'gpl');
            md.isTrusted = false;
            return new vscode.Hover(md, wordRange);
        }

        md.appendMarkdown(`**${kindTitle}** \`${sym.name}\``);

        if (isCallable) {
            md.appendMarkdown('\n\n');
            md.appendCodeblock(this.buildCallableSignature(sym), 'gpl');
        } else {
            const typeText = sym.returnType ? `: \`${sym.returnType}\`` : '';
            md.appendMarkdown(typeText);
        }

        if (sym.kind === GPLSymbolKind.Constant) {
            const valueText = sym.value ? this.stripComment(sym.value) : '(초기값 없음)';
            md.appendMarkdown(`\n\n값: \`${valueText}\``);
        }

        if (!compact && (sym.module || sym.className)) {
            const scopes: string[] = [];
            if (sym.module) {
                scopes.push(`Module: \`${sym.module}\``);
            }
            if (sym.className) {
                scopes.push(`Class: \`${sym.className}\``);
            }
            md.appendMarkdown(`\n\n${scopes.join(' · ')}`);
        }

        if (!compact && sym.docComment) {
            const docMd = this.formatDocComment(sym.docComment, config);
            if (docMd) {
                md.appendMarkdown(`\n\n---\n\n${docMd}`);
            }
        }

        md.isTrusted = false;

        return new vscode.Hover(md, wordRange);
    }
}
