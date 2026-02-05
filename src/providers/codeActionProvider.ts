import * as vscode from 'vscode';
import { XmlUtils } from '../xmlUtils';

export class GPLCodeActionProvider implements vscode.CodeActionProvider {
    
    provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<(vscode.CodeAction | vscode.Command)[]> {
        const actions: vscode.CodeAction[] = [];

        // 진단 정보 기반 코드 액션
        for (const diagnostic of context.diagnostics) {
            if (diagnostic.source === 'GPL XML Analysis' || diagnostic.source === 'GPL Performance Analysis') {
                const action = this.createFixAction(document, diagnostic, range);
                if (action) {
                    actions.push(action);
                }
            }
        }

        // 선택된 영역에서 XML 함수 개선 제안
        const selectedText = document.getText(range);
        if (this.isXmlFunction(selectedText)) {
            actions.push(...this.createXmlFunctionImprovements(document, range, selectedText));
        }

        // EscapeXml 함수 발견 시 개선 제안
        if (selectedText.includes('EscapeXml') || selectedText.includes('escapeXml')) {
            actions.push(...this.createEscapeXmlImprovements(document, range));
        }

        return actions;
    }

    /**
     * 진단 정보 기반 수정 액션 생성
     */
    private createFixAction(
        document: vscode.TextDocument,
        diagnostic: vscode.Diagnostic,
        range: vscode.Range
    ): vscode.CodeAction | null {
        const action = new vscode.CodeAction(
            `수정: ${diagnostic.message}`,
            vscode.CodeActionKind.QuickFix
        );

        action.diagnostics = [diagnostic];
        action.isPreferred = true;

        switch (diagnostic.code) {
            case 'manual-xml-escape':
                action.edit = this.createManualEscapeFixEdit(document, diagnostic.range);
                break;
            case 'string-concat-performance':
                action.edit = this.createPerformanceFixEdit(document, diagnostic.range);
                break;
            case 'wrong-entity-order':
                action.edit = this.createEntityOrderFixEdit(document, diagnostic.range);
                break;
            case 'reencode-risk':
                action.edit = this.createReencodeRiskFixEdit(document, diagnostic.range);
                break;
            case 'double-encoding-risk':
                action.edit = this.createDoubleEncodingFixEdit(document, diagnostic.range);
                break;
            default:
                return null;
        }

        return action;
    }

    /**
     * XML 함수 개선 제안
     */
    private createXmlFunctionImprovements(
        document: vscode.TextDocument,
        range: vscode.Range,
        selectedText: string
    ): vscode.CodeAction[] {
        const actions: vscode.CodeAction[] = [];

        // 내장 인코더 사용 제안
        if (!selectedText.includes('XmlDoc.EncodeEntities')) {
            const action = new vscode.CodeAction(
                '내장 XML 인코더로 교체',
                vscode.CodeActionKind.Refactor
            );
            action.edit = this.createBuiltinEncoderReplacement(document, range, selectedText);
            actions.push(action);
        }

        // 성능 최적화 제안
        if (selectedText.includes('outStr = outStr &')) {
            const action = new vscode.CodeAction(
                '성능 최적화 (청크 기반 처리)',
                vscode.CodeActionKind.RefactorRewrite
            );
            action.edit = this.createPerformanceOptimization(document, range, selectedText);
            actions.push(action);
        }

        // 멱등성 보장 제안
        if (selectedText.includes('&amp;') && !selectedText.includes('DecodeEntities')) {
            const action = new vscode.CodeAction(
                '멱등성 보장 (재인코딩 방지)',
                vscode.CodeActionKind.RefactorRewrite
            );
            action.edit = this.createIdempotentVersion(document, range, selectedText);
            actions.push(action);
        }

        return actions;
    }

    /**
     * EscapeXml 함수 개선 제안
     */
    private createEscapeXmlImprovements(
        document: vscode.TextDocument,
        range: vscode.Range
    ): vscode.CodeAction[] {
        const actions: vscode.CodeAction[] = [];

        // 전체 함수를 안전한 버전으로 교체
        const action1 = new vscode.CodeAction(
            'EscapeXml을 안전한 버전으로 교체',
            vscode.CodeActionKind.RefactorRewrite
        );
        action1.edit = this.createSafeEscapeXmlReplacement(document, range);
        actions.push(action1);

        // 고성능 버전으로 교체
        const action2 = new vscode.CodeAction(
            'EscapeXml을 고성능 버전으로 교체',
            vscode.CodeActionKind.RefactorRewrite
        );
        action2.edit = this.createFastEscapeXmlReplacement(document, range);
        actions.push(action2);

        // 테스트 코드 추가
        const action3 = new vscode.CodeAction(
            'XML 인코딩 테스트 코드 추가',
            vscode.CodeActionKind.Source
        );
        action3.edit = this.createTestCodeInsertion(document, range);
        actions.push(action3);

        return actions;
    }

    /**
     * 수동 이스케이프 수정
     */
    private createManualEscapeFixEdit(document: vscode.TextDocument, range: vscode.Range): vscode.WorkspaceEdit {
        const edit = new vscode.WorkspaceEdit();
        const newText = 'XmlDoc.EncodeEntities(value)';
        edit.replace(document.uri, range, newText);
        return edit;
    }

    /**
     * 성능 문제 수정
     */
    private createPerformanceFixEdit(document: vscode.TextDocument, range: vscode.Range): vscode.WorkspaceEdit {
        const edit = new vscode.WorkspaceEdit();
        const line = document.lineAt(range.start.line);
        const variableName = line.text.match(/(\w+)\s*=\s*\1\s*&/)?.[1] || 'outStr';
        
        const suggestion = `' 성능 최적화: 청크 기반 처리 사용
        ' ${line.text.trim()}
        ' 위 코드를 다음과 같이 개선하는 것을 권장:
        ' If i > start Then ${variableName} = ${variableName} & Mid(value, start, i - start)`;
        
        edit.replace(document.uri, range, suggestion);
        return edit;
    }

    /**
     * 엔티티 순서 수정
     */
    private createEntityOrderFixEdit(document: vscode.TextDocument, range: vscode.Range): vscode.WorkspaceEdit {
        const edit = new vscode.WorkspaceEdit();
        const line = document.lineAt(range.start.line);
        
        const correctedCode = `' 올바른 엔티티 치환 순서 (& 를 가장 먼저)
        result = Replace(result, "&", "&amp;")      ' 반드시 첫 번째
        result = Replace(result, "<", "&lt;")
        result = Replace(result, ">", "&gt;")
        result = Replace(result, Chr(34), "&quot;")
        result = Replace(result, "'", "&apos;")`;
        
        edit.replace(document.uri, range, correctedCode);
        return edit;
    }

    /**
     * 재인코딩 위험 수정
     */
    private createReencodeRiskFixEdit(document: vscode.TextDocument, range: vscode.Range): vscode.WorkspaceEdit {
        const edit = new vscode.WorkspaceEdit();
        
        const safeCode = `' 재인코딩 방지 (멱등성 보장)
        ' 먼저 디코드한 후 인코드
        s = XmlDoc.DecodeEntities(value)
        result = XmlDoc.EncodeEntities(s)`;
        
        edit.replace(document.uri, range, safeCode);
        return edit;
    }

    /**
     * 이중 인코딩 위험 수정
     */
    private createDoubleEncodingFixEdit(document: vscode.TextDocument, range: vscode.Range): vscode.WorkspaceEdit {
        const edit = new vscode.WorkspaceEdit();
        
        const fixedCode = `' 이중 인코딩 방지
        ' 내장 인코더 사용으로 안전하게 처리
        result = XmlDoc.EncodeEntities(XmlDoc.DecodeEntities(value))`;
        
        edit.replace(document.uri, range, fixedCode);
        return edit;
    }

    /**
     * 내장 인코더 교체
     */
    private createBuiltinEncoderReplacement(
        document: vscode.TextDocument,
        range: vscode.Range,
        selectedText: string
    ): vscode.WorkspaceEdit {
        const edit = new vscode.WorkspaceEdit();
        const functionName = selectedText.match(/Function\s+(\w+)/)?.[1] || 'EscapeXml';
        
        const builtinVersion = XmlUtils.getXmlCodeSnippets()['xml-escape-safe'];
        edit.replace(document.uri, range, builtinVersion);
        return edit;
    }

    /**
     * 성능 최적화
     */
    private createPerformanceOptimization(
        document: vscode.TextDocument,
        range: vscode.Range,
        selectedText: string
    ): vscode.WorkspaceEdit {
        const edit = new vscode.WorkspaceEdit();
        const functionName = selectedText.match(/Function\s+(\w+)/)?.[1] || 'EscapeXml';
        
        const optimizedVersion = XmlUtils.getXmlCodeSnippets()['xml-escape-fast'];
        edit.replace(document.uri, range, optimizedVersion);
        return edit;
    }

    /**
     * 멱등성 보장 버전
     */
    private createIdempotentVersion(
        document: vscode.TextDocument,
        range: vscode.Range,
        selectedText: string
    ): vscode.WorkspaceEdit {
        const edit = new vscode.WorkspaceEdit();
        const functionName = selectedText.match(/Function\s+(\w+)/)?.[1] || 'EscapeXml';
        
        const idempotentCode = `Private Function ${functionName}Stable(value As String) As String
    If value Is Nothing Or Len(value) = 0 Then Return ""
    ' 멱등성 보장: 디코드 후 인코드
    ${functionName}Stable = XmlDoc.EncodeEntities(XmlDoc.DecodeEntities(value))
End Function`;
        
        edit.replace(document.uri, range, idempotentCode);
        return edit;
    }

    /**
     * 안전한 EscapeXml 교체
     */
    private createSafeEscapeXmlReplacement(
        document: vscode.TextDocument,
        range: vscode.Range
    ): vscode.WorkspaceEdit {
        const edit = new vscode.WorkspaceEdit();
        const safeVersion = XmlUtils.getXmlCodeSnippets()['xml-escape-safe'];
        edit.replace(document.uri, range, safeVersion);
        return edit;
    }

    /**
     * 고성능 EscapeXml 교체
     */
    private createFastEscapeXmlReplacement(
        document: vscode.TextDocument,
        range: vscode.Range
    ): vscode.WorkspaceEdit {
        const edit = new vscode.WorkspaceEdit();
        const fastVersion = XmlUtils.getXmlCodeSnippets()['xml-escape-fast'];
        edit.replace(document.uri, range, fastVersion);
        return edit;
    }

    /**
     * 테스트 코드 삽입
     */
    private createTestCodeInsertion(
        document: vscode.TextDocument,
        range: vscode.Range
    ): vscode.WorkspaceEdit {
        const edit = new vscode.WorkspaceEdit();
        const testCode = XmlUtils.getXmlCodeSnippets()['xml-test-suite'];
        
        // 함수 정의 뒤에 테스트 코드 추가
        const insertPosition = new vscode.Position(range.end.line + 1, 0);
        edit.insert(document.uri, insertPosition, '\n' + testCode + '\n');
        return edit;
    }

    /**
     * XML 함수인지 확인
     */
    private isXmlFunction(text: string): boolean {
        return /Function.*xml|xml.*Function|Function.*escape|escape.*Function/i.test(text);
    }
}