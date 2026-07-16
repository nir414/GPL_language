import * as vscode from 'vscode';
import { SymbolCache } from '../symbolCache';
import { XmlUtils } from '../xmlUtils';
import { getAllGplBuiltins, getGplBuiltinReferenceUrl, GPLBuiltinEntry } from '../gplBuiltins';
import { GPLParser } from '../gplParser';
import { extractQualifierChainBefore, findEnclosingProcedureRange } from '../language/cursorExpression';

/** 한정자(`obj.`) 타입 해석 결과. */
type QualifierTarget =
    | { kind: 'builtinClass'; name: string }   // GPL Dictionary 내장 클래스 (Move, XmlDoc, String, …)
    | { kind: 'userClass'; name: string }      // 워크스페이스에 정의된 클래스
    | { kind: 'module'; name: string }         // 워크스페이스 모듈 (Module.Member 접근)
    | { kind: 'none' };                        // 타입은 알지만 멤버가 없음(원시 타입) → 빈 목록으로 소음 억제

/** 멤버가 없는 원시 타입 — 이 타입의 변수 뒤 '.'에서는 완성 목록을 비운다. */
const PRIMITIVE_TYPES = new Set(['integer', 'double', 'single', 'boolean', 'byte', 'short', 'long', 'object']);

export class GPLCompletionProvider implements vscode.CompletionItemProvider {
    constructor(private symbolCache: SymbolCache) {}

    // 정적(런타임 불변) 내장/딕셔너리 완성 항목은 한 번만 만들어 재사용한다.
    // getAllGplBuiltins() 등은 상수 데이터이므로 키 입력마다 CompletionItem을
    // 새로 생성할 필요가 없다. (공백 트리거 시의 전량 재생성 비용 제거)
    private static _builtinCompletionsCache: vscode.CompletionItem[] | undefined;
    private static _dictionaryCompletionsCache: vscode.CompletionItem[] | undefined;
    /** 내장(사전) 클래스 이름 소문자 집합 — "Move", "XmlDoc", "String" 등 dotted 이름의 접두부. */
    private static _builtinClassNames: Set<string> | undefined;

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
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
            return this.isXmlContext(beforeCursor, currentLine) ? this.getXmlCompletions() : [];
        }

        // ── 멤버 접근 컨텍스트: `obj.` / `Move.` 뒤에서는 해당 한정자의 멤버만 제공 ──
        // (전역 목록 전체가 뜨던 노이즈 제거 + dotted 내장의 접두부 중복 삽입 방지)
        const chainInfo = extractQualifierChainBefore(beforeCursor);
        if (chainInfo) {
            const memberItems = this.getMemberCompletions(document, position, chainInfo.chain);
            if (memberItems) {
                return memberItems;
            }
            // 한정자 타입을 해석하지 못하면 기존 전역 목록으로 폴백한다.
        }

        const completionItems: vscode.CompletionItem[] = [];

        // 현재 프로시저의 로컬 변수/파라미터 — 가장 관련성이 높으므로 최상단 정렬
        completionItems.push(...this.getLocalCompletions(document, position));

        // 워크스페이스 심볼 완성
        completionItems.push(...this.symbolCache.getCompletionItems());

        // XML 관련 컨텍스트 감지 및 특화 완성 제공
        if (this.isXmlContext(beforeCursor, currentLine)) {
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

    /** 한정자 체인의 멤버 완성 목록. 타입 해석 실패 시 undefined(전역 목록 폴백). */
    private getMemberCompletions(
        document: vscode.TextDocument,
        position: vscode.Position,
        chain: string[]
    ): vscode.CompletionItem[] | undefined {
        const target = this.resolveQualifierType(document, position, chain);
        if (!target) {
            return undefined;
        }
        switch (target.kind) {
            case 'none':
                return []; // 원시 타입: 멤버 없음 — 전역 목록 노이즈 대신 빈 목록
            case 'builtinClass':
                return this.getBuiltinClassMemberCompletions(target.name);
            case 'userClass':
                return this.getUserSymbolMemberCompletions(this.symbolCache.getClassMembers(target.name));
            case 'module':
                return this.getUserSymbolMemberCompletions(this.symbolCache.getModuleMembers(target.name));
        }
    }

    /** 한정자 체인의 최종 타입을 해석한다. 1세그먼트: 내장 클래스 → 로컬/파라미터 → 워크스페이스 심볼 순. */
    private resolveQualifierType(
        document: vscode.TextDocument,
        position: vscode.Position,
        chain: string[]
    ): QualifierTarget | undefined {
        const first = chain[0];
        const firstName = first.replace(/\(.*\)$/, '');
        const firstHasCall = firstName !== first;
        let current: QualifierTarget | undefined;

        // 1) 내장(사전) 클래스 정적 접근: Move. / XmlDoc. / String. …
        if (!firstHasCall && this.getBuiltinClassNames().has(firstName.toLowerCase())) {
            current = { kind: 'builtinClass', name: firstName };
        }

        // 2) 현재 프로시저의 로컬/파라미터 타입
        if (!current) {
            const localType = this.resolveLocalType(document, position, firstName);
            if (localType) {
                current = this.typeNameToTarget(localType, firstHasCall);
            }
        }

        // 3) 워크스페이스 심볼: 클래스/모듈(정적 접근) → 타입 있는 심볼(returnType)
        if (!current) {
            const candidates = this.symbolCache.findAllByName(firstName);
            const cls = candidates.find(s => s.kind === 'class');
            const mod = candidates.find(s => s.kind === 'module');
            if (cls && !firstHasCall) {
                current = { kind: 'userClass', name: cls.name };
            } else if (mod && !firstHasCall) {
                current = { kind: 'module', name: mod.name };
            } else {
                const typed = candidates.find(s => s.returnType);
                if (typed?.returnType) {
                    current = this.typeNameToTarget(typed.returnType, firstHasCall);
                }
            }
        }
        if (!current) {
            return undefined;
        }

        // 4) 나머지 세그먼트는 사용자 심볼의 returnType으로 체이닝 (내장 반환 타입 체이닝은 미지원)
        for (let k = 1; k < chain.length; k++) {
            if (current.kind !== 'userClass' && current.kind !== 'module') {
                return undefined;
            }
            const segRaw = chain[k];
            const segName = segRaw.replace(/\(.*\)$/, '');
            const segHasCall = segName !== segRaw;
            const holder: QualifierTarget = current;
            const member = holder.kind === 'userClass'
                ? this.symbolCache.findMemberInClass(segName, holder.name)
                : this.symbolCache.findAllByName(segName).find(
                    s => !s.className && s.module?.toLowerCase() === holder.name.toLowerCase());
            if (!member?.returnType) {
                return undefined;
            }
            current = this.typeNameToTarget(member.returnType, segHasCall);
            if (!current) {
                return undefined;
            }
        }
        return current;
    }

    /** 타입 이름 문자열을 완성 대상으로 변환. 배열은 인덱싱 여부에 따라 요소 타입/Array 클래스로. */
    private typeNameToTarget(typeName: string, hasCallOrIndex: boolean): QualifierTarget | undefined {
        let t = typeName.trim();
        if (t.endsWith('[]')) {
            if (hasCallOrIndex) {
                t = t.slice(0, -2); // arr(0). → 요소 타입의 멤버
            } else {
                t = 'Array';        // arr. → 내장 Array 클래스의 멤버
            }
        }
        const lower = t.toLowerCase();
        if (PRIMITIVE_TYPES.has(lower)) {
            return { kind: 'none' };
        }
        if (this.getBuiltinClassNames().has(lower)) {
            return { kind: 'builtinClass', name: t };
        }
        const candidates = this.symbolCache.findAllByName(t);
        if (candidates.some(s => s.kind === 'class')) {
            return { kind: 'userClass', name: t };
        }
        if (candidates.some(s => s.kind === 'module')) {
            return { kind: 'module', name: t };
        }
        return undefined;
    }

    /** 현재 프로시저 스코프에서 이름이 일치하는 로컬/파라미터의 타입을 찾는다. */
    private resolveLocalType(
        document: vscode.TextDocument,
        position: vscode.Position,
        name: string
    ): string | undefined {
        try {
            const range = findEnclosingProcedureRange(
                line => document.lineAt(line).text, document.lineCount, position.line);
            if (!range) {
                return undefined;
            }
            const symbols = GPLParser.parseDocument(document.getText(), document.uri.fsPath, {
                includeLocals: true,
                includeParameters: true,
            });
            const lower = name.toLowerCase();
            const match = symbols.find(s => (s.isLocal || s.isParameter)
                && s.line >= range.startLine && s.line <= range.endLine
                && s.name.toLowerCase() === lower);
            return match?.returnType;
        } catch {
            return undefined;
        }
    }

    /** 내장 클래스 이름 집합(소문자). dotted 내장 이름의 접두부에서 1회 구축. */
    private getBuiltinClassNames(): Set<string> {
        if (!GPLCompletionProvider._builtinClassNames) {
            const names = new Set<string>();
            for (const b of getAllGplBuiltins()) {
                const dot = b.name.indexOf('.');
                if (dot > 0) {
                    names.add(b.name.slice(0, dot).toLowerCase());
                }
            }
            GPLCompletionProvider._builtinClassNames = names;
        }
        return GPLCompletionProvider._builtinClassNames;
    }

    /** 내장 클래스의 멤버 완성 — tail만 삽입해 `Move.Move.Approach` 중복을 방지한다. */
    private getBuiltinClassMemberCompletions(className: string): vscode.CompletionItem[] {
        const prefixLen = className.length + 1;
        const prefixLower = className.toLowerCase() + '.';
        const items: vscode.CompletionItem[] = [];
        for (const builtin of getAllGplBuiltins()) {
            if (!builtin.name.toLowerCase().startsWith(prefixLower)) {
                continue;
            }
            const tail = builtin.name.slice(prefixLen);
            const item = new vscode.CompletionItem(tail, this.mapBuiltinKindToCompletionKind(builtin));
            item.detail = `GPL Built-in · ${builtin.category}`;
            item.documentation = this.buildBuiltinDocumentation(builtin);
            let insert = builtin.insertSnippet ?? builtin.name;
            if (insert.toLowerCase().startsWith(prefixLower)) {
                insert = insert.slice(prefixLen);
            } else if (!builtin.insertSnippet) {
                insert = tail;
            }
            item.insertText = new vscode.SnippetString(insert);
            item.sortText = `0_member_${tail}`;
            items.push(item);
        }
        return items;
    }

    /** 사용자 클래스/모듈 멤버 완성 항목 구성. */
    private getUserSymbolMemberCompletions(members: readonly import('../gplParser').GPLSymbol[]): vscode.CompletionItem[] {
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

    /**
     * XML 관련 컨텍스트인지 확인
     */
    private isXmlContext(beforeCursor: string, fullLine: string): boolean {
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
            `\`${builtin.signature}\``,
            '',
            builtin.summary
        ];

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
