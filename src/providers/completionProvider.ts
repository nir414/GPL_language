import * as vscode from 'vscode';
import { SymbolCache } from '../symbolCache';
import { XmlUtils } from '../xmlUtils';

export class GPLCompletionProvider implements vscode.CompletionItemProvider {
    constructor(private symbolCache: SymbolCache) {}

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): vscode.ProviderResult<vscode.CompletionItem[]> {
        const completionItems: vscode.CompletionItem[] = [];
        
        // Get current context (module/class)
        const text = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
        const moduleMatch = text.match(/Module\s+(\w+)/);
        const classMatch = text.match(/.*Class\s+(\w+)/);
        
        const currentModule = moduleMatch ? moduleMatch[1] : undefined;
        const currentClass = classMatch ? classMatch[1] : undefined;

        // 기본 심볼 완성
        const symbolCompletions = this.symbolCache.getCompletionItems(currentModule, currentClass);
        completionItems.push(...symbolCompletions);

        // 현재 줄의 텍스트 분석
        const currentLine = document.lineAt(position).text;
        const beforeCursor = currentLine.substring(0, position.character);
        
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
        const items: vscode.CompletionItem[] = [];
        
        // 문자열 함수들
        const stringFunctions = [
            { name: 'Mid', params: '${1:string}, ${2:start}, ${3:length}', description: '문자열의 부분 문자열 추출' },
            { name: 'InStr', params: '${1:start}, ${2:string}, ${3:searchString}', description: '문자열 내에서 부분 문자열의 위치 찾기' },
            { name: 'Len', params: '${1:string}', description: '문자열의 길이 반환' },
            { name: 'UCase', params: '${1:string}', description: '문자열을 대문자로 변환' },
            { name: 'LCase', params: '${1:string}', description: '문자열을 소문자로 변환' },
            { name: 'Trim', params: '${1:string}', description: '문자열 양쪽 공백 제거' },
            { name: 'Replace', params: '${1:string}, ${2:find}, ${3:replacement}', description: '문자열 치환' }
        ];
        
        // 변환 함수들
        const conversionFunctions = [
            { name: 'CStr', params: '${1:value}', description: '값을 문자열로 변환' },
            { name: 'CInt', params: '${1:value}', description: '값을 정수로 변환' },
            { name: 'CDbl', params: '${1:value}', description: '값을 실수로 변환' },
            { name: 'CBool', params: '${1:value}', description: '값을 불린으로 변환' },
            { name: 'CByte', params: '${1:value}', description: '값을 바이트로 변환' }
        ];
        
        // XML 관련 함수들
        const xmlFunctions = [
            { name: 'XmlDoc.LoadFile', params: '${1:filePath}', description: 'XML 파일 로드' },
            { name: 'XmlDoc.LoadString', params: '${1:xmlString}', description: 'XML 문자열 파싱' },
            { name: 'DocumentElement', params: '', description: 'XML 문서의 루트 요소 가져오기' },
            { name: 'ChildNodeCount', params: '', description: '자식 노드 개수 반환' },
            { name: 'ChildNodes', params: '${1:index}', description: '지정된 인덱스의 자식 노드 가져오기' }
        ];
        
        // 모든 함수들을 completion items로 변환
        [...stringFunctions, ...conversionFunctions, ...xmlFunctions].forEach(func => {
            const item = new vscode.CompletionItem(func.name, vscode.CompletionItemKind.Function);
            item.detail = func.description;
            item.insertText = new vscode.SnippetString(`${func.name}(${func.params})`);
            item.documentation = new vscode.MarkdownString(`**${func.name}**\n\n${func.description}`);
            items.push(item);
        });
        
        return items;
    }

    /**
     * GPL 내장/유틸 퀵 레퍼런스 자동완성
     */
    private getGPLDictionaryCompletions(): vscode.CompletionItem[] {
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
                label: 'Chr(9)  ' + '\t',
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

        return items;
    }
}
