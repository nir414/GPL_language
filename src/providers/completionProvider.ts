import * as vscode from 'vscode';
import { SymbolCache } from '../symbolCache';
import { XmlUtils } from '../language/xmlUtils';
import {
    getAllGplBuiltins,
    getGplBuiltinReferenceUrl,
    getGplClassMembers,
    GPLBuiltinEntry,
} from '../language/gplBuiltins';
import { GPLParser } from '../language/gplParser';
import { extractQualifierChainBefore, findEnclosingProcedureRange, parseChainSegment } from '../language/cursorExpression';
import { resolveReceiverTarget, ReceiverLookup, ReceiverSegment } from '../language/receiverType';
import { buildReceiverContext } from './receiverContext';
import { analyzeBlockContext, GplBlockContext } from '../language/blockContext';
import { getApplicableStatements, GPL_KEYWORDS, GplKeywordKind } from '../language/gplStatements';

export class GPLCompletionProvider implements vscode.CompletionItemProvider {
    constructor(private symbolCache: SymbolCache) {}

    // 정적(런타임 불변) 내장/딕셔너리 완성 항목은 한 번만 만들어 재사용한다.
    // getAllGplBuiltins() 등은 상수 데이터이므로 키 입력마다 CompletionItem을
    // 새로 생성할 필요가 없다. (공백 트리거 시의 전량 재생성 비용 제거)
    private static _builtinCompletionsCache: vscode.CompletionItem[] | undefined;
    private static _dictionaryCompletionsCache: vscode.CompletionItem[] | undefined;
    /** 한정자 미해석 시의 멤버 후보(내장 dotted 멤버의 tail) — 상수 데이터라 1회만 만든다. */
    private static _anyMemberCompletionsCache: vscode.CompletionItem[] | undefined;

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        _context: vscode.CompletionContext
    ): vscode.ProviderResult<vscode.CompletionItem[]> {
        if (token.isCancellationRequested) {
            return undefined;
        }

        const currentLine = document.lineAt(position).text;
        const beforeCursor = currentLine.substring(0, position.character);

        // 주석/문자열 안에서는 언어 완성을 띄우지 않는다 ('.' 트리거 소음 방지).
        // 단 문자열 안에서는 XML 엔티티 완성('&' 트리거의 존재 이유)만 유지한다.
        const posKind = this.classifyPosition(currentLine, position.character);
        if (posKind === 'comment') {
            return [];
        }
        if (posKind === 'string') {
            return this.isXmlContext(currentLine) ? this.getXmlCompletions() : [];
        }

        // ── 멤버 접근 컨텍스트: `obj.` / `Move.` 뒤에서는 해당 한정자의 멤버만 제공 ──
        // (전역 목록 전체가 뜨던 노이즈 제거 + dotted 내장의 접두부 중복 삽입 방지)
        const chainInfo = extractQualifierChainBefore(beforeCursor);
        if (chainInfo) {
            return this.getMemberCompletions(document, position, chainInfo.chain)
                ?? this.getUnresolvedMemberCompletions();
        }

        const completionItems: vscode.CompletionItem[] = [];

        // 현재 프로시저의 로컬 변수/파라미터 — 가장 관련성이 높으므로 최상단 정렬
        completionItems.push(...this.getLocalCompletions(document, position));

        // 문(statement) 스니펫 — 줄 시작에서만, 현재 블록 스코프에서 유효한 것만
        completionItems.push(...this.getStatementCompletions(document, position, beforeCursor));

        // 키워드/원시 타입/낱말 연산자 — 위치 제약이 없어 항상 제공(우선순위는 낮게)
        completionItems.push(...GPLCompletionProvider.getKeywordCompletions());

        // 워크스페이스 심볼 완성
        completionItems.push(...this.symbolCache.getCompletionItems());

        // XML 관련 컨텍스트 감지 및 특화 완성 제공
        if (this.isXmlContext(currentLine)) {
            completionItems.push(...this.getXmlCompletions());
        }

        // 함수/Sub 정의 컨텍스트에서 XML 베스트 프랙티스 제안
        if (this.isXmlFunctionContext(beforeCursor)) {
            completionItems.push(...this.getXmlFunctionCompletions());
        }

        // EscapeXml 관련 함수 호출 시 개선된 버전 제안
        if (this.isEscapeXmlCallContext(beforeCursor)) {
            completionItems.push(...this.getImprovedEscapeXmlCompletions());
        }

        // VB.NET 호환성 관련 완성
        completionItems.push(...this.getVBCompatibilityCompletions(beforeCursor));

        // GPL 기본 함수 완성
        completionItems.push(...this.getGPLBuiltinCompletions());

        // GPL 내장 딕셔너리/퀵 레퍼런스
        completionItems.push(...this.getGPLDictionaryCompletions());

        return completionItems;
    }

    // ─── 위치 분류 (주석/문자열 억제) ─────────────────────────────

    /** 커서 위치가 코드/문자열/주석 중 어디인지 판별한다. GPL 문자열 이스케이프("")를 인식. */
    private classifyPosition(lineText: string, character: number): 'code' | 'string' | 'comment' {
        let inString = false;
        const end = Math.min(character, lineText.length);
        for (let i = 0; i < end; i++) {
            const ch = lineText[i];
            if (inString) {
                if (ch === '"') {
                    if (i + 1 < end && lineText[i + 1] === '"') {
                        i++; // "" 이스케이프
                    } else {
                        inString = false;
                    }
                }
            } else if (ch === '"') {
                inString = true;
            } else if (ch === "'") {
                return 'comment';
            }
        }
        return inString ? 'string' : 'code';
    }

    // ─── 멤버 완성 (`obj.` / `Move.`) ─────────────────────────────

    /**
     * 한정자 체인의 멤버 완성 목록. 타입 해석 실패 시 undefined(멤버 폴백 목록 사용).
     *
     * 체인 해석은 receiverType의 공용 해석기에 맡긴다 — 자체 구현을 두었을 때
     * 내장 멤버의 반환 타입을 따라가지 못해 `Thread.CurrentThread().` 뒤가 미해석으로 떨어졌고,
     * 그 폴백(전역 목록)이 dotted 내장 항목을 통째로 삽입해 `….Thread.Abort()`가 만들어졌다
     * (2026-09-10 사용자 보고).
     */
    private getMemberCompletions(
        document: vscode.TextDocument,
        position: vscode.Position,
        chain: string[]
    ): vscode.CompletionItem[] | undefined {
        const segments: ReceiverSegment[] = [];
        for (const raw of chain) {
            const seg = parseChainSegment(raw);
            if (!seg) {
                return undefined;
            }
            segments.push(seg);
        }
        const lookup = this.buildReceiverLookup(document, position);
        if (!lookup) {
            return undefined;
        }
        const target = resolveReceiverTarget(segments, lookup);
        if (!target) {
            return undefined;
        }
        switch (target.kind) {
            case 'primitive':
                return []; // 멤버 없음 — 전역 목록 노이즈 대신 빈 목록
            case 'builtinClass':
                return this.getBuiltinClassMemberCompletions(target.name);
            case 'class':
                return this.getUserSymbolMemberCompletions(this.symbolCache.getClassMembers(target.name));
            case 'module':
                return this.getUserSymbolMemberCompletions(this.symbolCache.getModuleMembers(target.name));
        }
    }

    /** 현재 문서·커서 위치의 수신자 해석 컨텍스트(조립 정본은 `receiverContext.ts`). */
    private buildReceiverLookup(
        document: vscode.TextDocument,
        position: vscode.Position
    ): ReceiverLookup | undefined {
        try {
            return buildReceiverContext(
                document, position.line, name => this.symbolCache.findAllByName(name)).lookup;
        } catch {
            return undefined;
        }
    }

    /**
     * 한정자 타입을 해석하지 못한 `x.` 뒤의 완성 목록.
     *
     * 전역 목록으로 폴백하면 멤버 자리에 올 수 없는 것들(키워드·문 스니펫·전역 함수)이 뜨고,
     * 특히 dotted 내장 항목이 이름 그대로 삽입돼 `x.Thread.Abort()` 같은 코드가 만들어진다.
     * 그래서 여기서는 **멤버가 될 수 있는 후보만**, 그것도 tail만 삽입되도록 돌려준다.
     * 어느 클래스의 멤버인지는 detail에 남겨 고를 때 구분할 수 있게 한다.
     */
    private getUnresolvedMemberCompletions(): vscode.CompletionItem[] {
        if (!GPLCompletionProvider._anyMemberCompletionsCache) {
            const items: vscode.CompletionItem[] = [];
            for (const builtin of getAllGplBuiltins()) {
                const dot = builtin.name.lastIndexOf('.');
                if (dot <= 0) {
                    continue; // 전역 함수(CInt, Mid …)는 멤버 자리에 올 수 없다
                }
                items.push(this.buildBuiltinMemberItem(builtin, '1_anymember_'));
            }
            GPLCompletionProvider._anyMemberCompletionsCache = items;
        }
        // 워크스페이스 심볼은 이름 그대로 삽입되므로(dotted 아님) 멤버 자리에서도 안전하다.
        return [...GPLCompletionProvider._anyMemberCompletionsCache, ...this.symbolCache.getCompletionItems()];
    }

    /** 내장 클래스의 멤버 완성 — tail만 삽입해 `Move.Move.Approach` 중복을 방지한다. */
    private getBuiltinClassMemberCompletions(className: string): vscode.CompletionItem[] {
        return getGplClassMembers(className).map(builtin => this.buildBuiltinMemberItem(builtin, '0_member_'));
    }

    /**
     * 내장 dotted 항목(`Thread.Abort`)을 **멤버 자리에 그대로 넣을 수 있는** 완성 항목으로 만든다.
     * 라벨·삽입 텍스트에서 `클래스.` 접두부를 떼는 것이 핵심이다 — 붙은 채로 삽입되면
     * `Thread.CurrentThread().Thread.Abort()`가 된다.
     * 접두부 길이는 수신자 이름이 아니라 **항목 이름의 점 위치**로 정한다(대소문자·표기 차이에 무관).
     */
    private buildBuiltinMemberItem(builtin: GPLBuiltinEntry, sortPrefix: string): vscode.CompletionItem {
        const prefixLen = builtin.name.lastIndexOf('.') + 1;
        const tail = builtin.name.slice(prefixLen);
        const item = new vscode.CompletionItem(tail, this.mapBuiltinKindToCompletionKind(builtin));
        item.detail = `GPL Built-in · ${builtin.name}`;
        item.documentation = this.buildBuiltinDocumentation(builtin);
        const snippet = builtin.insertSnippet ?? builtin.name;
        // insertSnippet은 `Thread.Sleep(${1:ms})`처럼 접두부를 포함한다 — 접두부만 떼고 인자는 살린다.
        const insert = snippet.length >= prefixLen && snippet.slice(0, prefixLen).toLowerCase() === builtin.name.slice(0, prefixLen).toLowerCase()
            ? snippet.slice(prefixLen)
            : tail;
        item.insertText = new vscode.SnippetString(insert);
        // dotted 전체 이름으로도 검색되게 한다(`Thread.Ab`로 좁히는 사용자 습관 지원).
        item.filterText = `${tail} ${builtin.name}`;
        item.sortText = `${sortPrefix}${tail}`;
        return item;
    }

    /** 사용자 클래스/모듈 멤버 완성 항목 구성. */
    private getUserSymbolMemberCompletions(members: readonly import('../language/gplParser').GPLSymbol[]): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];
        for (const symbol of members) {
            const item = new vscode.CompletionItem(
                symbol.name, this.symbolCache.getCompletionItemKind(symbol.kind));
            let detail: string = symbol.kind;
            if (symbol.module) {
                detail += ` (${symbol.module}${symbol.className ? `.${symbol.className}` : ''})`;
            }
            item.detail = detail;
            item.documentation = this.symbolCache.buildSymbolDocumentation(symbol);
            if ((symbol.kind === 'function' || symbol.kind === 'sub') && symbol.parameters) {
                const params = symbol.parameters.map((param, index) => `\${${index + 1}:${param}}`).join(', ');
                item.insertText = new vscode.SnippetString(`${symbol.name}(${params})`);
            }
            item.sortText = `0_member_${symbol.name}`;
            items.push(item);
        }
        return items;
    }

    // ─── 로컬 변수/파라미터 완성 ──────────────────────────────────

    /** 현재 프로시저의 로컬/파라미터 완성 항목 (메모이즈 파서 재사용 — 입력당 비용 낮음). */
    private getLocalCompletions(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
        try {
            const range = findEnclosingProcedureRange(
                line => document.lineAt(line).text, document.lineCount, position.line);
            if (!range) {
                return [];
            }
            const symbols = GPLParser.parseDocument(document.getText(), document.uri.fsPath, {
                includeLocals: true,
                includeParameters: true,
            });
            const seen = new Set<string>();
            const items: vscode.CompletionItem[] = [];
            for (const s of symbols) {
                if (!s.isLocal && !s.isParameter) {
                    continue;
                }
                if (s.line < range.startLine || s.line > range.endLine) {
                    continue;
                }
                const key = s.name.toLowerCase();
                if (seen.has(key)) {
                    continue;
                }
                seen.add(key);
                const item = new vscode.CompletionItem(s.name, vscode.CompletionItemKind.Variable);
                item.detail = `${s.isParameter ? 'parameter' : 'local'}${s.returnType ? ` : ${s.returnType}` : ''}`;
                item.sortText = `00_local_${s.name}`;
                items.push(item);
            }
            return items;
        } catch {
            return [];
        }
    }

    // ─── 문(statement) 스니펫 · 키워드 ────────────────────────────

    /**
     * 커서 앞이 "줄 시작 + 낱말 하나"뿐인지 — 문 스니펫을 띄울 위치인지 판별한다.
     *
     * `x = ` 뒤나 인자 목록 안에서 `If ... End If` 블록을 제안하면 소음이므로,
     * 들여쓰기 뒤에 식별자 글자만 있는 상태에서만 문 스니펫을 제공한다.
     */
    private static isStatementStart(beforeCursor: string): boolean {
        return /^[ \t]*[A-Za-z]*$/.test(beforeCursor);
    }

    // 블록 컨텍스트 분석은 문서 앞부분을 훑으므로 (문서 버전, 줄) 단위로 1회만 계산한다.
    private static _blockContextCache: { key: string; context: GplBlockContext } | undefined;

    /** 커서 위치의 블록 컨텍스트 (같은 문서 버전·같은 줄이면 캐시 재사용). */
    private getBlockContext(document: vscode.TextDocument, position: vscode.Position): GplBlockContext {
        const key = `${document.uri.toString()}|${document.version}|${position.line}`;
        const cached = GPLCompletionProvider._blockContextCache;
        if (cached && cached.key === key) {
            return cached.context;
        }
        const context = analyzeBlockContext(
            line => document.lineAt(line).text, document.lineCount, position.line);
        GPLCompletionProvider._blockContextCache = { key, context };
        return context;
    }

    /**
     * 제어 구조/선언 문 스니펫 완성 항목.
     *
     * 현재 열린 블록 스택으로 스코프를 판정해, 그 위치에서 문법적으로 유효한 문만
     * 제안한다 (프로시저 밖에서 `If`, 프로시저 안에서 `Sub`를 띄우지 않는다).
     */
    private getStatementCompletions(
        document: vscode.TextDocument,
        position: vscode.Position,
        beforeCursor: string
    ): vscode.CompletionItem[] {
        if (!GPLCompletionProvider.isStatementStart(beforeCursor)) {
            return [];
        }

        let context: GplBlockContext;
        try {
            context = this.getBlockContext(document, position);
        } catch {
            return [];
        }

        // 스니펫 본문의 들여쓰기(\t)는 VS Code가 에디터 설정에 맞춰 변환하지만,
        // 삽입 위치의 기존 들여쓰기는 첫 줄에만 적용되므로 그대로 둔다.
        return getApplicableStatements(context).map(stmt => {
            const item = new vscode.CompletionItem(stmt.label, vscode.CompletionItemKind.Snippet);
            item.detail = stmt.detail;
            const doc = new vscode.MarkdownString(stmt.documentation);
            if (stmt.sourceUrl) {
                doc.appendMarkdown(`\n\n[공식 문서 열기](${stmt.sourceUrl})`);
            }
            item.documentation = doc;
            item.insertText = new vscode.SnippetString(stmt.body.join('\n'));
            item.sortText = `01_stmt_${stmt.label}`;
            return item;
        });
    }

    // 키워드 항목은 런타임 불변이므로 한 번만 만들어 재사용한다.
    private static _keywordCompletionsCache: vscode.CompletionItem[] | undefined;

    /** 키워드/원시 타입/낱말 연산자 완성 항목. */
    private static getKeywordCompletions(): vscode.CompletionItem[] {
        if (GPLCompletionProvider._keywordCompletionsCache) {
            return GPLCompletionProvider._keywordCompletionsCache;
        }
        const kindMap: Record<GplKeywordKind, vscode.CompletionItemKind> = {
            keyword: vscode.CompletionItemKind.Keyword,
            operator: vscode.CompletionItemKind.Operator,
            type: vscode.CompletionItemKind.Class,
            constant: vscode.CompletionItemKind.Constant
        };
        const items = GPL_KEYWORDS.map(kw => {
            const item = new vscode.CompletionItem(kw.name, kindMap[kw.kind]);
            item.detail = kw.detail;
            item.sortText = `02_kw_${kw.name}`;
            return item;
        });
        GPLCompletionProvider._keywordCompletionsCache = items;
        return items;
    }

    /**
     * XML 관련 컨텍스트인지 확인
     */
    private isXmlContext(fullLine: string): boolean {
        return /xml|XML|escape|encode|entity|&amp;|&lt;|&gt;|&quot;|&apos;/i.test(fullLine);
    }

    /**
     * XML 함수 정의 컨텍스트인지 확인
     */
    private isXmlFunctionContext(beforeCursor: string): boolean {
        return /Function\s+.*xml|xml.*Function/i.test(beforeCursor) ||
               /Function\s+.*escape|escape.*Function/i.test(beforeCursor);
    }

    /**
     * EscapeXml 함수 호출 컨텍스트인지 확인
     */
    private isEscapeXmlCallContext(beforeCursor: string): boolean {
        return /EscapeXml\s*\(/i.test(beforeCursor);
    }

    /**
     * XML 관련 자동완성 항목들
     */
    private getXmlCompletions(): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];

        // 내장 XML 함수들
        const xmlBuiltins = [
            {
                label: 'XmlDoc.EncodeEntities',
                detail: 'GPL 내장 XML 인코딩 함수',
                documentation: '안전하고 표준적인 XML 엔티티 인코딩을 수행합니다.',
                insertText: 'XmlDoc.EncodeEntities(${1:value})',
                kind: vscode.CompletionItemKind.Function
            },
            {
                label: 'XmlDoc.DecodeEntities', 
                detail: 'GPL 내장 XML 디코딩 함수',
                documentation: 'XML 엔티티를 원래 문자로 디코딩합니다.',
                insertText: 'XmlDoc.DecodeEntities(${1:encodedValue})',
                kind: vscode.CompletionItemKind.Function
            }
        ];

        for (const builtin of xmlBuiltins) {
            const item = new vscode.CompletionItem(builtin.label, builtin.kind);
            item.detail = builtin.detail;
            item.documentation = new vscode.MarkdownString(builtin.documentation);
            item.insertText = new vscode.SnippetString(builtin.insertText);
            item.sortText = '0_' + builtin.label; // 우선순위 높게
            items.push(item);
        }

        // XML 엔티티들
        const xmlEntities = [
            { label: '&amp;', detail: '&ampersand entity', insertText: '&amp;' },
            { label: '&lt;', detail: 'less than entity', insertText: '&lt;' },
            { label: '&gt;', detail: 'greater than entity', insertText: '&gt;' },
            { label: '&quot;', detail: 'quotation mark entity', insertText: '&quot;' },
            { label: '&apos;', detail: 'apostrophe entity', insertText: '&apos;' }
        ];

        for (const entity of xmlEntities) {
            const item = new vscode.CompletionItem(entity.label, vscode.CompletionItemKind.Constant);
            item.detail = entity.detail;
            item.insertText = entity.insertText;
            items.push(item);
        }

        return items;
    }

    /**
     * XML 함수 정의 시 자동완성
     */
    private getXmlFunctionCompletions(): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];
        const snippets = XmlUtils.getXmlCodeSnippets();

        for (const [key, snippet] of Object.entries(snippets)) {
            const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Snippet);
            
            switch (key) {
                case 'xml-escape-safe':
                    item.detail = '안전한 XML 이스케이프 함수 (멱등성 보장)';
                    item.documentation = new vscode.MarkdownString(
                        '재인코딩을 방지하고 멱등성을 보장하는 XML 이스케이프 함수입니다.\n\n' +
                        '**장점:**\n- 재호출해도 결과 동일\n- 내장 인코더 사용으로 높은 안정성\n- 유지보수 최소화'
                    );
                    break;
                case 'xml-escape-fast':
                    item.detail = '고성능 XML 이스케이프 함수';
                    item.documentation = new vscode.MarkdownString(
                        '성능 최적화된 XML 이스케이프 함수입니다.\n\n' +
                        '**특징:**\n- 빠른 탈출 로직\n- 청크 기반 처리로 O(n²) 방지\n- 불필요한 처리 최소화'
                    );
                    break;
                case 'xml-test-suite':
                    item.detail = 'XML 인코딩 테스트 스위트';
                    item.documentation = new vscode.MarkdownString(
                        'XML 인코딩 함수의 정확성을 검증하는 테스트 코드입니다.\n\n' +
                        '**테스트 케이스:**\n- 빈 문자열\n- 일반 텍스트\n- 특수문자 포함\n- 이미 인코딩된 텍스트\n- 제어문자'
                    );
                    break;
            }
            
            item.insertText = new vscode.SnippetString(snippet);
            item.sortText = '0_xml_' + key; // XML 관련 항목을 위로
            items.push(item);
        }

        return items;
    }

    /**
     * EscapeXml 함수 사용 시 개선된 버전 제안
     */
    private getImprovedEscapeXmlCompletions(): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];

        // 내장 인코더 사용 권장
        const builtinItem = new vscode.CompletionItem(
            'XmlDoc.EncodeEntities 사용 권장',
            vscode.CompletionItemKind.Text
        );
        builtinItem.detail = '⚠️ 베스트 프랙티스 권장사항';
        builtinItem.documentation = new vscode.MarkdownString(
            '**권장사항:** 수동 구현 대신 내장 XML 인코더를 사용하세요.\n\n' +
            '```gpl\n' +
            'XmlDoc.EncodeEntities(value)\n' +
            '```\n\n' +
            '**장점:**\n- 안정성과 호환성 최고\n- 유지보수 최소화\n- 표준 준수'
        );
        builtinItem.kind = vscode.CompletionItemKind.Text;
        builtinItem.sortText = '0_recommendation';
        items.push(builtinItem);

        return items;
    }

    /**
     * VB.NET 호환성 관련 완성 항목 제공
     */
    private getVBCompatibilityCompletions(beforeCursor: string): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];
        
        // Left 함수를 위한 Mid 대안 제안
        if (/\bLe$/i.test(beforeCursor)) {
            const item = new vscode.CompletionItem('Mid (Left 대안)', vscode.CompletionItemKind.Function);
            item.detail = 'GPL에서 Left 함수 대신 사용';
            item.documentation = new vscode.MarkdownString(
                '**Left 함수 대안**\n\n' +
                '```gpl\n' +
                '\'Left(string, length) 대신:\n' +
                'Mid(string, 1, length)\n' +
                '```'
            );
            item.insertText = new vscode.SnippetString('Mid(${1:string}, 1, ${2:length})');
            item.filterText = 'Left';
            items.push(item);
        }
        
        // Right 함수를 위한 Mid 대안 제안
        if (/\bRi$/i.test(beforeCursor)) {
            const item = new vscode.CompletionItem('Mid (Right 대안)', vscode.CompletionItemKind.Function);
            item.detail = 'GPL에서 Right 함수 대신 사용';
            item.documentation = new vscode.MarkdownString(
                '**Right 함수 대안**\n\n' +
                '```gpl\n' +
                '\'Right(string, length) 대신:\n' +
                'Mid(string, Len(string) - length + 1)\n' +
                '```'
            );
            item.insertText = new vscode.SnippetString('Mid(${1:string}, Len(${1:string}) - ${2:length} + 1)');
            item.filterText = 'Right';
            items.push(item);
        }
        
        // Val 함수를 위한 CInt/CDbl 대안 제안
        if (/\bVal$/i.test(beforeCursor)) {
            const item = new vscode.CompletionItem('CInt (Val 대안)', vscode.CompletionItemKind.Function);
            item.detail = 'GPL에서 Val 함수 대신 사용';
            item.documentation = new vscode.MarkdownString(
                '**Val 함수 대안**\n\n' +
                '```gpl\n' +
                '\'Val(string) 대신:\n' +
                'CInt(string)  \'정수 변환\n' +
                'CDbl(string)  \'실수 변환\n' +
                '```'
            );
            item.insertText = new vscode.SnippetString('CInt(${1:string})');
            item.filterText = 'Val';
            items.push(item);
        }
        
        return items;
    }

    /**
     * GPL 내장 함수 완성 항목 제공
     */
    private getGPLBuiltinCompletions(): vscode.CompletionItem[] {
        if (GPLCompletionProvider._builtinCompletionsCache) {
            return GPLCompletionProvider._builtinCompletionsCache;
        }

        const items: vscode.CompletionItem[] = [];

        for (const builtin of getAllGplBuiltins()) {
            const itemKind = this.mapBuiltinKindToCompletionKind(builtin);
            const item = new vscode.CompletionItem(builtin.name, itemKind);

            item.detail = `GPL Built-in · ${builtin.category}`;
            item.documentation = this.buildBuiltinDocumentation(builtin);

            const insert = builtin.insertSnippet ?? builtin.name;
            item.insertText = new vscode.SnippetString(insert);
            item.sortText = `0_builtin_${builtin.name}`;

            // foo.Bar 형태도 baz 입력으로 검색되도록 보조 필터 제공
            const tail = builtin.name.includes('.') ? builtin.name.split('.').pop()! : builtin.name;
            item.filterText = `${builtin.name} ${tail}`;

            items.push(item);
        }

        GPLCompletionProvider._builtinCompletionsCache = items;
        return items;
    }

    private mapBuiltinKindToCompletionKind(builtin: GPLBuiltinEntry): vscode.CompletionItemKind {
        switch (builtin.kind) {
            case 'property':
                return vscode.CompletionItemKind.Constant;
            case 'method':
            case 'function':
            default:
                return vscode.CompletionItemKind.Function;
        }
    }

    private buildBuiltinDocumentation(builtin: GPLBuiltinEntry): vscode.MarkdownString {
        const parts = [
            `**${builtin.name}**`,
            '',
            `\`${builtin.usage ?? builtin.signature}\``,
            '',
            builtin.summary
        ];

        if (builtin.details) {
            parts.push('', '---', '', builtin.details);
        }

        const refUrl = getGplBuiltinReferenceUrl(builtin);
        const refLabel = builtin.sourceUrl ? 'Reference' : 'GPL Dictionary';
        parts.push('', `[${refLabel}](${refUrl})`);

        const md = new vscode.MarkdownString(parts.join('\n'));
        md.isTrusted = false;
        return md;
    }

    /**
     * GPL 내장/유틸 퀵 레퍼런스 자동완성
     */
    private getGPLDictionaryCompletions(): vscode.CompletionItem[] {
        if (GPLCompletionProvider._dictionaryCompletionsCache) {
            return GPLCompletionProvider._dictionaryCompletionsCache;
        }

        const items: vscode.CompletionItem[] = [];

        const quickRefs = [
            {
                label: 'GPL Builtins Quick Ref',
                detail: '주요 내장/유틸 요약',
                documentation:
                    'Thread, Controller, Utils, XmlDoc, IO_FileManager 등 핵심 API를 한눈에 보는 주석 스니펫',
                snippet:
`' === GPL Builtins Quick Ref ===
' Thread.Sleep(ms), Thread.TestAndSet(var, val)
' Controller.Timer(mode)  ' mode=1 -> 초(Double)
' Utils.CRLF, Utils.timeString(), Utils.now()
' XmlDoc.EncodeEntities(value), XmlDoc.DecodeEntities(value)
' IO_FileManager.SafeSaveFile(path, data, 1)
' IO_FileManager.FileExists(path), IO_FileManager.ReadFileContent(path)
' Data_XmlAsyncSave.Enqueue(path, xml)
' Core_StringUtils.ParseConfigLine(line, key, value)
' Core_StringUtils.ParseJsonArray(json, outArr)
`
            },
            {
                label: 'Utils.CRLF',
                detail: '표준 개행 상수',
                documentation: 'GPL에서 vbCrLf 대신 사용하는 표준 개행 상수',
                snippet: 'Utils.CRLF'
            },
            {
                label: 'Chr(9)',
                detail: '탭 문자',
                documentation: 'vbTab 대신 Chr(9) 사용',
                snippet: 'Chr(9)'
            }
        ];

        for (const ref of quickRefs) {
            const item = new vscode.CompletionItem(ref.label, vscode.CompletionItemKind.Snippet);
            item.detail = ref.detail;
            item.documentation = new vscode.MarkdownString(ref.documentation);
            item.insertText = new vscode.SnippetString(ref.snippet);
            item.sortText = '1_dict_' + ref.label; // 기본 함수보다 살짝 낮은 우선순위
            items.push(item);
        }

        GPLCompletionProvider._dictionaryCompletionsCache = items;
        return items;
    }
}
