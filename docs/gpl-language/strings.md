# GPL 문자열(String) API 가이드

본 문서는 Guidance Programming Language(GPL)에서 사용 가능한 문자열 관련 속성, 메서드, 함수들을 한눈에 정리하고 VB 계열 관습과의 차이 및 주의사항을 제공한다. 제공 내용은 벤더 매뉴얼 발췌(요약) + 실무 관찰 기반이다.

## 1. 개요

GPL의 String은 내부적으로 기본 Class 인프라를 공유하며 다음과 같은 두 가지 형태로 조작 가능하다.

- (1) 문자열 인스턴스의 속성/메서드: `string.Length`, `string.Substring(...)` 등
- (2) 전역 함수 형태의 전통적 Basic 스타일: `Len()`, `Mid()`, `InStr()` 등

두 방식은 일부 기능이 중복되며, 프로젝트에서는 가독성과 일관성을 위해 다음 권장 규칙을 따른다.

- 길이 조회: `Len(str)` 대신 `str.Length` 둘 중 하나를 택해 일관 유지 (본 프로젝트는 `Len()`을 주로 사용, 객체 메서드 혼용 허용)
- 부분 문자열: `Mid()` 사용 (VB.NET의 `Left`, `Right`는 미지원 → Mid + Len 조합으로 대체)
- 검색: `InStr(1, text, target)` (시작 인덱스 명시 필수 패턴)

## 2. 인덱스 / 위치 규칙 요약

| 항목 | 규칙 | 비고 |
|------|------|------|
| 문자열 길이 | `Len(str)` 또는 `str.Length` | 결과는 문자 개수(Integer) |
| `Mid(str, first, length)` | first는 1-based | length가 경계를 넘으면 남은 부분까지 반환 |
| `InStr(start, source, sub)` | start는 1부터 시작 | 찾지 못하면 0 반환 |
| 배열 인덱스 | 0-based | `array.Length` 사용 (`UBound` 미지원) |

## 3. 문자열 속성 및 메서드 표

아래 표는 제공된 매뉴얼의 Table 23-95 요약이다.

| 멤버 | 분류 | 설명 | 사용 예 |
|------|------|------|---------|
| `string.Length` | Property | 문자열의 문자 수 반환 | `Dim n As Integer: n = s.Length` |
| `string.Substring(start, length)` | Method | 지정 시작 위치(0-based 추정)부터 length 길이의 부분 문자열 | (필요 시 `Mid()` 우선 권장) |
| `string.Split(sep)` | Method | 구분자 문자 기준 분할 후 배열 반환 | `parts = s.Split(",")` |
| `string.ToLower()` | Method | 소문자 문자열 복사본 반환 | `lower = s.ToLower()` |
| `string.ToUpper()` | Method | 대문자 문자열 복사본 반환 | `upper = s.ToUpper()` |
| `string.Trim()` | Method | 앞뒤 공백/지정 문자 제거 | `trimmed = s.Trim()` |
| `string.TrimStart()` | Method | 앞쪽 트림 |  |
| `string.TrimEnd()` | Method | 뒤쪽 트림 |  |
| `String.Compare(a, b, caseSensitive)` | Method | 두 문자열 비교(대소문자 옵션) | `If String.Compare(a, b, 0) = 0 Then ...` |
| `string.IndexOf(sub)` | Method | 부분 문자열 첫 위치(0-n) | (프로젝트 내 주로 `InStr` 패턴 사용) |

> 주: 벤더 문서상 `Substring`/`IndexOf`는 0-based 가능성이 높으나, 현재 프로젝트는 `Mid` (1-based) + `InStr(1,...)` 패턴을 표준으로 사용. 혼용 시 인덱스 기준 차이를 명확히 주석 처리.

## 4. 문자열 전역 함수 표

매뉴얼의 Table 23-96 요약 + 실무 대체 패턴.

| 함수 | 설명 | 반환/특징 | 비고/예시 |
|------|------|-----------|-----------|
| `Len(string)` | 문자열 길이 | Integer | `If Len(s)=0 Then ...` |
| `Mid(string, first, length)` | 부분 문자열 | 1-based first | `seg = Mid(code, 1, 7)` |
| `InStr(start, string_t, string_s)` | 부분 문자열 검색 | 1-based 위치 또는 0 | `If InStr(1, path, "/") > 0 Then ...` |
| `LCase(string)` | 소문자 변환 | 새 String |  |
| `UCase(string)` | 대문자 변환 | 새 String |  |
| `Asc(string)` | 첫 문자 ASCII 코드 | Integer | 0 길이면 호출 피함 |
| `Chr(code)` | 코드값을 문자로 | 1 문자 String |  |
| `Format(expr, fmt)` | 숫자 → 문자열 포맷 | | 사용 시 fmt 사양 문서 참고 |
| `CStr(expr)` | 표현식 문자열화 | |  |
| `CInt(expr)` | 문자열/숫자 → Integer | 예외 시 Catch 필요 | `valInt = CInt(numText)` |
| `CDbl(expr)` | 표현식 → Double |  |  |
| `CSng(expr)` | 표현식 → Single |  |  |
| `CByte(expr)` | 표현식 → Byte |  |  |
## 5. 미지원 / 주의 대상 함수 및 대체

| 미지원 | 대체 | 설명 |
|--------|------|------|
| `Left(str, n)` | `Mid(str, 1, n)` | Left 미지원 → Mid 사용 |
| `Right(str, n)` | `Mid(str, Len(str) - n + 1)` | 끝 부분 추출 |
| `InStrRev(str, sub)` | 수동 역탐색 For 루프 | 뒤에서부터 검색 필요 시 루프 구현 |
| `Val(str)` | `CInt(str)` / `CDbl(str)` | 타입 명확히 구분 |
| `EndOfStream` | 수동 sentinel / 조건 | 루프에서 빈 문자열/EOF 조건 직접 관리 |
| `UBound(arr)` | `arr.Length - 1` | 배열 상한 |

## 6. 역방향(InStrRev) 수동 구현 예시

```vb
Dim pos As Integer
pos = 0
Dim i As Integer
For i = 1 To Len(path)
    If Mid(path, i, 1) = "/" Then
        pos = i ' 마지막으로 발견된 위치 저장
    End If
Next
If pos > 0 Then
    dirPart = Mid(path, 1, pos - 1)
End If
```

## 7. Right 대체 패턴 예시

```vb
' 마지막 3글자
Dim tail As String

```

## 8. 문자열 + 숫자 변환 주의사항

- `CInt`, `CDbl` 사용 시 변환 실패 가능성이 있는 외부 입력은 Try...Catch로 감싸 예외 처리.
- 파일/네트워크로부터 읽은 값은 길이/포맷 검증 후 변환.
- `Asc` 호출 전 길이 0 여부 확인.

## 9. 비트 문자열 함수(ToBitString / FromBitString)

| Type 키워드 | 바이트 수 | 변환 의미 |
|-------------|-----------|-----------|
| Byte | 1 | 0~255 Unsigned |
| Short | 2 | 16-bit signed |
| Integer | 4 | 32-bit signed |
| Single | 4 | IEEE 754 단정밀도 |
| Double | 8 | IEEE 754 배정밀도 |

엔디안(big_endian) = 0 → little endian(LSB first), 1 → big endian(MSB first).

예시:

```vb
Dim stg As String
stg = ToBitString(23, Byte, 1)
Console.WriteLine(FromBitString(stg, Byte, 1))

stg = ToBitString(-321, Short, 1)
Console.WriteLine(FromBitString(stg, Short, 1))
```

 
## 10. 선택 기준 & 베스트 프랙티스

| 상황 | 권장 함수/패턴 | 이유 |
|------|----------------|------|
| 부분 문자열 추출 | Mid | 일관된 1-based, Left/Right 대체 |
| 경로 구분자 탐색 | For + Mid 루프 | InStrRev 미지원 |
| 확장자 제거/추출 | 뒤에서 `/` 탐색 후 Mid | 경계 안전성 |
| 길이 체크 후 슬라이스 | If Len(s) >= n Then Mid(...) | 인덱스 오류 방지 |

## 11. 빠른 레퍼런스(치트시트)

```vb
' 앞 7글자
## 12. 문서 변경 이력

' 마지막 슬래시 위치 찾기
Dim pos As Integer
pos = 0
For i = 1 To Len(path)
    If Mid(path, i, 1) = "/" Then pos = i
Next
If pos > 0 Then baseDir = Mid(path, 1, pos - 1)

' 배열 마지막 인덱스
lastIdx = arr.Length - 1

' 마지막 n글자
| 날짜 | 내용 | 작성 |

' 부분 포함 여부
If InStr(1, text, keyword) > 0 Then found = 1
```

## 12. 문서 변경 이력

| 날짜 | 내용 | 작성 |
|------|------|------|
| 2025-09-18 | 최초 작성 | 자동화(Assistant) |
|------|------|------|
| 2025-09-18 | 최초 작성 | 자동화(Assistant) |

---
이 문서는 GPL 문자열 처리 시 반복되는 패턴을 표준화하여 오류 감소 및 유지보수성을 높이기 위한 참조 문서이다.
