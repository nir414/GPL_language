/**
 * XML 처리를 위한 유틸리티 모듈
 * GPL 코드에서 XML 인코딩/디코딩 관련 베스트 프랙티스를 제공
 *
 * 참고: 과거 이 모듈에 있던 XML 인코딩 분석기(analyzeXmlEncoding 등)는
 * 어디서도 사용되지 않아 제거됨. 실제 XML 진단은 diagnosticProvider와
 * gplParser.detectXmlFunctionIssues가 담당한다.
 */

export class XmlUtils {

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
