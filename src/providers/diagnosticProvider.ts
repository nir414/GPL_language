import * as vscode from 'vscode';
import { GPLParser } from '../gplParser';

export class GPLDiagnosticProvider {
    private diagnosticCollection: vscode.DiagnosticCollection;
    private pendingTimers: Map<string, NodeJS.Timeout> = new Map();

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('gpl');
    }

    /**
     * 문서의 진단 정보를 업데이트
     */
    public updateDiagnostics(document: vscode.TextDocument): void {
        if (document.languageId !== 'gpl') {
            return;
        }

        const diagnostics: vscode.Diagnostic[] = [];
        const content = document.getText();
        const lines = content.split('\n');

        // XML 관련 함수들 분석
        const symbols = GPLParser.parseDocument(content, document.uri.fsPath);
        const xmlFunctions = symbols.filter(symbol => 
            symbol.isXmlRelated && 
            (symbol.kind === 'function' || symbol.kind === 'sub')
        );

        for (const func of xmlFunctions) {
            if (func.hasXmlIssues && func.hasXmlIssues.length > 0) {
                for (const issue of func.hasXmlIssues) {
                    const diagnostic = new vscode.Diagnostic(
                        new vscode.Range(func.line, 0, func.line, lines[func.line]?.length || 0),
                        issue,
                        this.mapIssueToSeverity(issue)
                    );
                    diagnostic.source = 'GPL XML Analysis';
                    diagnostic.code = 'xml-issue';
                    diagnostics.push(diagnostic);
                }
            }
        }

        // 위험한 XML 패턴 검사
        diagnostics.push(...this.detectDangerousXmlPatterns(document));
        
        // 성능 이슈 검사
        diagnostics.push(...this.detectPerformanceIssues(document));
        
        // 재인코딩 위험 검사
        diagnostics.push(...this.detectReencodingRisks(document));
        
        // VB.NET 호환성 이슈 검사
        diagnostics.push(...this.detectVBCompatibilityIssues(document));

        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    /**
     * Debounced diagnostics scheduling to avoid frequent recomputation
     */
    public scheduleDiagnostics(document: vscode.TextDocument, delayMs: number = 500): void {
        if (document.languageId !== 'gpl') {
            return;
        }

        const key = document.uri.toString();
        const existing = this.pendingTimers.get(key);
        if (existing) {
            clearTimeout(existing);
        }

        const timer = setTimeout(() => {
            this.pendingTimers.delete(key);
            this.updateDiagnostics(document);
        }, delayMs);

        this.pendingTimers.set(key, timer);
    }

    /**
     * Clear diagnostics and any pending timer for a given document URI.
     * Useful when files are deleted or renamed to avoid stale ("garbage") diagnostics.
     */
    public clearDiagnostics(uri: vscode.Uri): void {
        const key = uri.toString();
        const existing = this.pendingTimers.get(key);
        if (existing) {
            clearTimeout(existing);
            this.pendingTimers.delete(key);
        }

        this.diagnosticCollection.delete(uri);
    }

    /**
     * 위험한 XML 패턴 검사
     */
    private detectDangerousXmlPatterns(document: vscode.TextDocument): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        const content = document.getText();
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmedLine = line.trim();

            // 수동 XML 이스케이프 패턴 감지
            const manualEscapePattern = /outStr\s*=\s*outStr\s*&\s*"&(amp|lt|gt|quot|apos);"/gi;
            let match;
            while ((match = manualEscapePattern.exec(line)) !== null) {
                const diagnostic = new vscode.Diagnostic(
                    new vscode.Range(i, match.index, i, match.index + match[0].length),
                    '수동 XML 이스케이프 감지: 내장 XmlDoc.EncodeEntities 사용을 권장합니다',
                    vscode.DiagnosticSeverity.Information
                );
                diagnostic.source = 'GPL XML Analysis';
                diagnostic.code = 'manual-xml-escape';
                diagnostics.push(diagnostic);
            }

            // 잘못된 엔티티 순서 검사
            if (this.hasWrongEntityOrder(line)) {
                const diagnostic = new vscode.Diagnostic(
                    new vscode.Range(i, 0, i, line.length),
                    '엔티티 치환 순서 오류: & 문자를 다른 엔티티보다 먼저 처리해야 합니다',
                    vscode.DiagnosticSeverity.Error
                );
                diagnostic.source = 'GPL XML Analysis';
                diagnostic.code = 'wrong-entity-order';
                diagnostics.push(diagnostic);
            }

            // 재인코딩 위험 패턴
            if (this.hasReencodingRisk(line)) {
                const diagnostic = new vscode.Diagnostic(
                    new vscode.Range(i, 0, i, line.length),
                    '재인코딩 위험: 이미 인코딩된 텍스트가 다시 인코딩될 수 있습니다',
                    vscode.DiagnosticSeverity.Warning
                );
                diagnostic.source = 'GPL XML Analysis';
                diagnostic.code = 'reencode-risk';
                diagnostics.push(diagnostic);
            }
        }

        return diagnostics;
    }

    /**
     * 성능 이슈 검사
     */
    private detectPerformanceIssues(document: vscode.TextDocument): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        const content = document.getText();
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // O(n²) 문자열 연결 패턴
            const stringConcatPattern = /(\w+)\s*=\s*\1\s*&/gi;
            let match;
            while ((match = stringConcatPattern.exec(line)) !== null) {
                // XML 관련 변수명인지 확인
                if (/xml|escape|encode|out/i.test(match[1])) {
                    const diagnostic = new vscode.Diagnostic(
                        new vscode.Range(i, match.index, i, match.index + match[0].length),
                        `O(n²) 성능 이슈: 반복적인 문자열 연결로 인한 성능 저하 (변수: ${match[1]})`,
                        vscode.DiagnosticSeverity.Warning
                    );
                    diagnostic.source = 'GPL Performance Analysis';
                    diagnostic.code = 'string-concat-performance';
                    diagnostics.push(diagnostic);
                }
            }

            // 불필요한 문자별 처리 감지
            if (/For\s+i\s+=.*Len\(.*\).*Mid\(/i.test(line) && /xml|escape/i.test(content)) {
                const diagnostic = new vscode.Diagnostic(
                    new vscode.Range(i, 0, i, line.length),
                    '성능 최적화 기회: 빠른 탈출 로직과 청크 기반 처리를 고려하세요',
                    vscode.DiagnosticSeverity.Information
                );
                diagnostic.source = 'GPL Performance Analysis';
                diagnostic.code = 'optimization-opportunity';
                diagnostics.push(diagnostic);
            }
        }

        return diagnostics;
    }

    /**
     * 재인코딩 위험 검사
     */
    private detectReencodingRisks(document: vscode.TextDocument): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        const content = document.getText();
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // 이미 인코딩된 텍스트를 다시 인코딩하는 패턴
            if (line.includes('&amp;') && /Replace.*&.*&amp;/i.test(line)) {
                const diagnostic = new vscode.Diagnostic(
                    new vscode.Range(i, 0, i, line.length),
                    '재인코딩 위험: &amp; → &amp;amp; 변환 가능성',
                    vscode.DiagnosticSeverity.Warning
                );
                diagnostic.source = 'GPL XML Analysis';
                diagnostic.code = 'double-encoding-risk';
                diagnostics.push(diagnostic);
            }

            // 멱등성 부족 감지
            if (this.lacksIdempotency(line)) {
                const diagnostic = new vscode.Diagnostic(
                    new vscode.Range(i, 0, i, line.length),
                    '멱등성 부족: 동일한 입력에 대해 여러 번 호출 시 다른 결과 가능',
                    vscode.DiagnosticSeverity.Information
                );
                diagnostic.source = 'GPL XML Analysis';
                diagnostic.code = 'lack-idempotency';
                diagnostics.push(diagnostic);
            }
        }

        return diagnostics;
    }

    /**
     * 이슈를 심각도로 매핑
     */
    private mapIssueToSeverity(issue: string): vscode.DiagnosticSeverity {
        if (issue.includes('O(n²)')) {
            return vscode.DiagnosticSeverity.Warning;
        }
        if (issue.includes('재인코딩') || issue.includes('순서 오류')) {
            return vscode.DiagnosticSeverity.Error;
        }
        if (issue.includes('Null 안전성')) {
            return vscode.DiagnosticSeverity.Warning;
        }
        return vscode.DiagnosticSeverity.Information;
    }

    /**
     * 잘못된 엔티티 순서 검사
     */
    private hasWrongEntityOrder(line: string): boolean {
        const ampIndex = line.indexOf('&amp;');
        const otherEntityIndex = Math.max(
            line.indexOf('&lt;'),
            line.indexOf('&gt;'),
            line.indexOf('&quot;'),
            line.indexOf('&apos;')
        );
        
        return ampIndex > -1 && otherEntityIndex > -1 && ampIndex > otherEntityIndex;
    }

    /**
     * 재인코딩 위험 검사
     */
    private hasReencodingRisk(line: string): boolean {
        return line.includes('&amp;') && 
               /Replace.*&.*&amp;/i.test(line) && 
               !line.includes('DecodeEntities');
    }

    /**
     * 멱등성 부족 검사
     */
    private lacksIdempotency(line: string): boolean {
        return /escape.*xml|xml.*escape/i.test(line) && 
               !line.includes('DecodeEntities') && 
               (line.includes('&amp;') || line.includes('Replace'));
    }

    /**
     * VB.NET 호환성 이슈 검사
     */
    private detectVBCompatibilityIssues(document: vscode.TextDocument): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        const lines = document.getText().split('\n');
        
        // 지원되지 않는 VB.NET 함수들
        const unsupportedFunctions = [
            'Left', 'Right', 'InStrRev', 'Val', 'UBound', 'LBound', 
            'EndOfStream', 'getCurrentTick', 'IsNumeric', 'IsDate', 
            'Format', 'DateAdd', 'DateDiff', 'Now', 'Today'
        ];
        
        // Optional 매개변수 패턴
        const optionalPattern = /\bOptional\b/i;
        
        // On Error GoTo 패턴
        const onErrorPattern = /\bOn\s+Error\s+(GoTo|Resume)\b/i;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmedLine = line.trim();
            
            // 주석 건너뛰기
            if (trimmedLine.startsWith("'") || trimmedLine === '') {
                continue;
            }
            
            // 지원되지 않는 VB.NET 함수 검사
            for (const func of unsupportedFunctions) {
                const pattern = new RegExp(`\\b${func}\\s*\\(`, 'i');
                if (pattern.test(line)) {
                    const diagnostic = new vscode.Diagnostic(
                        new vscode.Range(i, 0, i, line.length),
                        `지원되지 않는 VB.NET 함수: ${func}. GPL 지원 함수로 교체해주세요.`,
                        vscode.DiagnosticSeverity.Error
                    );
                    diagnostic.source = 'GPL VB Compatibility';
                    diagnostic.code = `unsupported-function-${func.toLowerCase()}`;
                    diagnostics.push(diagnostic);
                }
            }
            
            // Optional 매개변수 검사
            if (optionalPattern.test(line)) {
                const diagnostic = new vscode.Diagnostic(
                    new vscode.Range(i, 0, i, line.length),
                    'GPL에서는 Optional 매개변수를 지원하지 않습니다. 함수 오버로드로 구현해주세요.',
                    vscode.DiagnosticSeverity.Error
                );
                diagnostic.source = 'GPL VB Compatibility';
                diagnostic.code = 'optional-parameter';
                diagnostics.push(diagnostic);
            }
            
            // On Error GoTo 검사
            if (onErrorPattern.test(line)) {
                const diagnostic = new vscode.Diagnostic(
                    new vscode.Range(i, 0, i, line.length),
                    'GPL에서는 On Error GoTo를 지원하지 않습니다. Try...Catch 구문을 사용해주세요.',
                    vscode.DiagnosticSeverity.Error
                );
                diagnostic.source = 'GPL VB Compatibility';
                diagnostic.code = 'on-error-goto';
                diagnostics.push(diagnostic);
            }
            
            // Dictionary 타입 사용 검사
            if (/\bDictionary\b/i.test(line)) {
                const diagnostic = new vscode.Diagnostic(
                    new vscode.Range(i, 0, i, line.length),
                    'GPL에서는 Dictionary 타입을 지원하지 않습니다. 배열이나 사용자 정의 타입을 사용해주세요.',
                    vscode.DiagnosticSeverity.Warning
                );
                diagnostic.source = 'GPL VB Compatibility';
                diagnostic.code = 'dictionary-not-supported';
                diagnostics.push(diagnostic);
            }
            
            // Object 타입 사용 검사 (다형성 제한)
            if (/\bAs\s+Object\b/i.test(line)) {
                const diagnostic = new vscode.Diagnostic(
                    new vscode.Range(i, 0, i, line.length),
                    'GPL에서는 Object 타입의 다형적 사용이 제한됩니다. 구체적인 타입을 사용하세요.',
                    vscode.DiagnosticSeverity.Warning
                );
                diagnostic.source = 'GPL VB Compatibility';
                diagnostic.code = 'object-type-limitation';
                diagnostics.push(diagnostic);
            }
        }
        
        return diagnostics;
    }

    /**
     * 진단 컬렉션 정리
     */
    public dispose(): void {
        for (const [, timer] of this.pendingTimers) {
            clearTimeout(timer);
        }
        this.pendingTimers.clear();
        this.diagnosticCollection.dispose();
    }

    /**
     * 코드 액션 제공자와 연동을 위한 진단 정보 가져오기
     */
    public getDiagnostics(uri: vscode.Uri): readonly vscode.Diagnostic[] {
        return this.diagnosticCollection.get(uri) || [];
    }
}
