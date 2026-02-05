/**
 * XML 처리를 위한 유틸리티 모듈
 * GPL 코드에서 XML 인코딩/디코딩 관련 베스트 프랙티스를 제공
 */

export interface XmlEncodingAnalysis {
    hasIssues: boolean;
    issues: XmlIssue[];
    suggestions: XmlSuggestion[];
}

export interface XmlIssue {
    type: 'performance' | 'safety' | 'correctness' | 'idempotency';
    severity: 'error' | 'warning' | 'info';
    message: string;
    line?: number;
    column?: number;
}

export interface XmlSuggestion {
    type: 'replacement' | 'addition' | 'refactor';
    message: string;
    code?: string;
}

export class XmlUtils {
    
    /**
     * XML 인코딩 함수 분석
     */
    static analyzeXmlEncoding(code: string, functionName: string): XmlEncodingAnalysis {
        const analysis: XmlEncodingAnalysis = {
            hasIssues: false,
            issues: [],
            suggestions: []
        };

        // 성능 이슈 검사
        if (this.hasPerformanceIssue(code)) {
            analysis.hasIssues = true;
            analysis.issues.push({
                type: 'performance',
                severity: 'warning',
                message: 'O(n²) 성능 이슈: 반복적인 문자열 연결로 인한 성능 저하'
            });
            
            analysis.suggestions.push({
                type: 'replacement',
                message: '성능 최적화를 위한 청크 기반 처리 방식 사용',
                code: this.generateOptimizedXmlEscapeFunction(functionName)
            });
        }

        // 재인코딩 위험 검사
        if (this.hasReencodingRisk(code)) {
            analysis.hasIssues = true;
            analysis.issues.push({
                type: 'idempotency',
                severity: 'error',
                message: '재인코딩 위험: 이미 인코딩된 입력이 다시 인코딩될 수 있음'
            });
            
            analysis.suggestions.push({
                type: 'replacement',
                message: '멱등성을 보장하는 안전한 XML 인코딩 함수 사용',
                code: this.generateSafeXmlEscapeFunction(functionName)
            });
        }

        // 순서 이슈 검사
        if (this.hasOrderingIssue(code)) {
            analysis.hasIssues = true;
            analysis.issues.push({
                type: 'correctness',
                severity: 'error',
                message: '엔티티 치환 순서 오류: & 문자를 다른 엔티티보다 먼저 처리해야 함'
            });
            
            analysis.suggestions.push({
                type: 'refactor',
                message: '올바른 순서로 엔티티 치환 수행',
                code: this.generateCorrectOrderFunction(functionName)
            });
        }

        // Null 안전성 검사
        if (!this.hasNullSafety(code)) {
            analysis.hasIssues = true;
            analysis.issues.push({
                type: 'safety',
                severity: 'warning',
                message: 'Null 안전성 부족: Nothing/빈 값에 대한 방어 코드 필요'
            });
        }

        // 내장 인코더 사용 권장
        if (!this.usesBuiltinEncoder(code)) {
            analysis.suggestions.push({
                type: 'refactor',
                message: '내장 XML 인코더 사용 권장 (XmlDoc.EncodeEntities)',
                code: this.generateBuiltinEncoderFunction(functionName)
            });
        }

        return analysis;
    }

    /**
     * 성능 이슈 검사 (outStr = outStr & ... 패턴)
     */
    private static hasPerformanceIssue(code: string): boolean {
        return /outStr\s*=\s*outStr\s*&/gi.test(code);
    }

    /**
     * 재인코딩 위험 검사
     */
    private static hasReencodingRisk(code: string): boolean {
        return code.includes('&amp;') && !code.includes('DecodeEntities');
    }

    /**
     * 순서 이슈 검사
     */
    private static hasOrderingIssue(code: string): boolean {
        const ampIndex = code.indexOf('&amp;');
        const otherEntityIndex = Math.max(
            code.indexOf('&lt;'),
            code.indexOf('&gt;'),
            code.indexOf('&quot;'),
            code.indexOf('&apos;')
        );
        
        return ampIndex > -1 && otherEntityIndex > -1 && ampIndex > otherEntityIndex;
    }

    /**
     * Null 안전성 검사
     */
    private static hasNullSafety(code: string): boolean {
        return code.includes('Nothing') || code.includes('Is Nothing');
    }

    /**
     * 내장 인코더 사용 검사
     */
    private static usesBuiltinEncoder(code: string): boolean {
        return /XmlDoc\.EncodeEntities|EncodeEntities/i.test(code);
    }

    /**
     * 최적화된 XML 이스케이프 함수 생성
     */
    private static generateOptimizedXmlEscapeFunction(functionName: string): string {
        return `Private Function ${functionName}Fast(value As String) As String
    If value Is Nothing Or Len(value) = 0 Then Return ""

    ' 빠른 탈출: 특수문자가 하나도 없으면 바로 반환
    If InStr(value, "&") = 0 And InStr(value, "<") = 0 And InStr(value, ">") = 0 _
       And InStr(value, Chr(34)) = 0 And InStr(value, "'") = 0 Then
        Return value
    End If

    Dim n As Integer: n = Len(value)
    Dim i As Integer, start As Integer, ch As String, outStr As String
    start = 1

    For i = 1 To n
        ch = Mid(value, i, 1)
        Select Case ch
            Case "&", "<", ">", Chr(34), "'"
                ' 앞쪽 원문 청크를 한 번에 복사
                If i > start Then outStr = outStr & Mid(value, start, i - start)
                ' 엔티티 추가
                Select Case ch
                    Case "&":      outStr = outStr & "&amp;"
                    Case "<":      outStr = outStr & "&lt;"
                    Case ">":      outStr = outStr & "&gt;"
                    Case Chr(34):  outStr = outStr & "&quot;"
                    Case "'":      outStr = outStr & "&apos;"
                End Select
                start = i + 1
        End Select
    Next

    If start <= n Then outStr = outStr & Mid(value, start)
    ${functionName}Fast = outStr
End Function`;
    }

    /**
     * 안전한 XML 이스케이프 함수 생성 (멱등성 보장)
     */
    private static generateSafeXmlEscapeFunction(functionName: string): string {
        return `Private Function ${functionName}Safe(value As String) As String
    If value Is Nothing Or Len(value) = 0 Then Return ""

    ' 1) 이미 인코딩된 시퀀스를 원문으로 되돌림(순서 중요: 긴 토큰부터)
    Dim s As String: s = value
    s = Replace(s, "&quot;", Chr(34))
    s = Replace(s, "&apos;", "'")
    s = Replace(s, "&lt;", "<")
    s = Replace(s, "&gt;", ">")
    s = Replace(s, "&amp;", "&")

    ' 2) 그 후 안전한 인코딩 실행
    Return ${functionName}Fast(s)
End Function`;
    }

    /**
     * 올바른 순서의 XML 이스케이프 함수 생성
     */
    private static generateCorrectOrderFunction(functionName: string): string {
        return `Private Function ${functionName}Correct(value As String) As String
    If value Is Nothing Or Len(value) = 0 Then Return ""
    
    ' 올바른 순서: & 를 가장 먼저 처리
    Dim result As String: result = value
    result = Replace(result, "&", "&amp;")      ' 반드시 첫 번째
    result = Replace(result, "<", "&lt;")
    result = Replace(result, ">", "&gt;")
    result = Replace(result, Chr(34), "&quot;")
    result = Replace(result, "'", "&apos;")
    
    ${functionName}Correct = result
End Function`;
    }

    /**
     * 내장 인코더 사용 함수 생성
     */
    private static generateBuiltinEncoderFunction(functionName: string): string {
        return `' 표준 인코딩만
Private Function ${functionName}(value As String) As String
    If value Is Nothing Or Len(value) = 0 Then Return ""
    ${functionName} = XmlDoc.EncodeEntities(value)
End Function

' 멱등성 보장(재인코딩 방지)
Private Function ${functionName}Stable(value As String) As String
    If value Is Nothing Or Len(value) = 0 Then Return ""
    ${functionName}Stable = XmlDoc.EncodeEntities(XmlDoc.DecodeEntities(value))
End Function`;
    }

    /**
     * GPL XML 베스트 프랙티스 가이드
     */
    static getXmlBestPractices(): string[] {
        return [
            "내장 XML 인코더(XmlDoc.EncodeEntities) 사용 권장",
            "멱등성 보장을 위해 디코드 후 인코드 패턴 사용",
            "성능 최적화를 위한 빠른 탈출 로직 구현",
            "& 문자를 다른 엔티티보다 먼저 처리",
            "Nothing/빈 값에 대한 방어 코드 추가",
            "문자열 연결 시 청크 기반 처리로 O(n²) 방지",
            "XML 1.0 불허 문자 제거/대체 고려",
            "속성 값과 텍스트 노드 컨텍스트 구분"
        ];
    }

    /**
     * XML 관련 코드 스니펫
     */
    static getXmlCodeSnippets(): { [key: string]: string } {
        return {
            "xml-escape-safe": `Private Function EscapeXmlSafe(value As String) As String
    If value Is Nothing Or Len(value) = 0 Then Return ""
    EscapeXmlSafe = XmlDoc.EncodeEntities(XmlDoc.DecodeEntities(value))
End Function`,

            "xml-escape-fast": `Private Function EscapeXmlFast(value As String) As String
    If value Is Nothing Or Len(value) = 0 Then Return ""
    
    ' 빠른 탈출: 특수문자가 하나도 없으면 바로 반환
    If InStr(value, "&") = 0 And InStr(value, "<") = 0 And InStr(value, ">") = 0 _
       And InStr(value, Chr(34)) = 0 And InStr(value, "'") = 0 Then
        Return value
    End If
    
    ' 청크 기반 처리로 성능 최적화
    ' ... 상세 구현 ...
End Function`,

            "xml-test-suite": `Sub Test_XmlEscape()
    Dim cases() As String = {
        "", _
        "plain text", _
        "A & B", _
        "<tag>text</tag>", _
        "already &amp; encoded", _
        "control" & Chr(1) & "char"
    }
    
    For Each testCase In cases
        Console.WriteLine("Test: " & testCase)
        Console.WriteLine("Result: " & EscapeXmlSafe(testCase))
    Next
End Sub`
        };
    }
}