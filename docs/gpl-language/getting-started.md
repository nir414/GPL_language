# Guidance Programming Language(GPL) 실무 가이드 및 VB.NET 비교

# 작업 원칙
- GPL 언어에 대한 새로운 정보(제약, 지원/미지원 기능, 실무 패턴, 오류 및 해결 등)를 깨닫거나 문제가 생기고 해결할 때마다, 해당 내용을 즉시 docs 폴더 내 관련 문서와 .copilot/custom_prompt.txt에 정리한다.
- 이 원칙은 모든 개발/테스트/문서화 과정에서 항상 적용한다.
- 정리 내용은 최신 상태를 유지하며, 중복/불필요한 정보는 주기적으로 통합·정리한다.

## 개요
Guidance Programming Language(GPL)은 Brooks Automation Guidance 컨트롤러 및 PreciseFlex 로봇에 내장된 자동화/로봇 제어용 언어입니다. Visual Basic .NET과 유사한 문법을 제공하지만, .NET 타입 및 일부 고급 기능은 지원하지 않습니다.

## 주요 특징
- 임베디드 언어: 컨트롤러에 내장, 독립 실행
- 자동화 최적화: 모션, 위치, 프로파일 등

- 제어 명령어: If, For, While, Sub, Function, 예외 처리
- 통신: MODBUS/TCP, TCP/UDP, 시리얼, XML
- 안전: E-Stop, Soft E-Stop, 토크 제한

	Robot.Home()
	Move.Linear(homeLoc)


- 바이오/의료: 샘플 핸들링
- 전자/기계: 피킹 앤 플레이싱, 나사 조임

## XML 파싱 예시(GPL)
```vb
Dim xmldoc As XmlDoc
xmldoc = XmlDoc.LoadFile("파일경로")
Dim root As XmlNode
root = xmldoc.DocumentElement()
Dim nodeCount As Integer
nodeCount = root.ChildNodeCount()
Dim i As Integer
For i = 0 To nodeCount - 1
	Dim child As XmlNode
	child = root.ChildNodes(i)
	' child.Name, child.Value 등 사용
Next
```

## 배열 기반 데이터 구조 예시
```vb
Public Type KeyValue
	Key As String
	Value As String
End Type

Dim kvs(100) As KeyValue
Dim count As Integer
count = 0
' 값 추가 시 kvs(count).Key = ... kvs(count).Value = ... count = count + 1
```

## 함수/모듈 선언 예시
```vb
Module XMLHandler
	' Sub/Function 선언 및 구현
End Module
```

## XML 처리 기본 흐름
1. XmlDoc.LoadFile/LoadString으로 문서 로드
- 인덱스 접근 전 Count 확인
- 로봇 명령 전 Attach/PowerOn/Home 순서 유지
- 파일 IO/통신 등 예외 발생 구간 에러코드/메시지 점검

## 명명 규칙(권장)
- PascalCase: Sub, Function, Type, Module
- camelCase: 지역 변수
- UPPER_SNAKE: 상수

## 스코프(중요): 블록 스코프 없음

GPL은 `If/For/While/Try/Catch` 같은 **블록 단위 지역 스코프**를 허용하지 않는 것으로 가정하고 코드를 작성하는 것이 안전합니다.

- `Dim`은 되도록 **Sub/Function 상단에서 한 번만** 선언
- 블록에서는 값만 갱신
- 같은 이름을 블록마다 `Dim`으로 재선언하려고 하면 중복 선언/컴파일 오류 또는 혼동이 생기기 쉽습니다.

자세한 예시는 **[common-mistakes.md](common-mistakes.md)** 의 “블록 스코프 없음” 섹션을 참고하세요.

## 로그/출력
- Console.WriteLine으로 단계별 로그
- 중요 상태만 최소 출력

## 객체/Property(속성) 관련 핵심 정리 (우선)

> 출처(공식):
> - Objects, Fields, Properties and Methods: https://www2.brooksautomation.com/Controller_Software/Introduction_To_The_Software/Guidance_Programming_Language/objectsfieldspropertiesmethods.htm
> - The Dot "." Operator: https://www2.brooksautomation.com/Controller_Software/Introduction_To_The_Software/Guidance_Programming_Language/thedotoperator.htm
> - Object Variables and the New Clause: https://www2.brooksautomation.com/Controller_Software/Introduction_To_The_Software/Guidance_Programming_Language/objectvariablenewclause.htm
> - Copying Object Variables and Values: https://www2.brooksautomation.com/Controller_Software/Introduction_To_The_Software/Guidance_Programming_Language/copyingobjectvalues.htm
> - Objects as Procedure Arguments: https://www2.brooksautomation.com/Controller_Software/Introduction_To_The_Software/Guidance_Programming_Language/objectsasprocedurearguments.htm
> - User-Defined Classes: https://www2.brooksautomation.com/Controller_Software/Introduction_To_The_Software/Guidance_Programming_Language/user_classes.htm
> - Limitations: https://www2.brooksautomation.com/Controller_Software/Introduction_To_The_Software/Guidance_Programming_Language/limitations.htm

### 1) Field / Property / Method 용어 정리
- **Object**: 관련 데이터 + 그 데이터를 다루는 절차(프로시저)를 묶은 것
- **Field**: object 내부에 저장된 데이터 값(내부 상태)
- **Property**: field에 대한 읽기/쓰기 인터페이스(형식화/가공/그룹화 가능)
- **Method**: object의 field를 다루는 절차(서브/함수 형태 모두 가능)

실무에선 field를 직접 만지는 것보다 **property/method만 사용**하게 되는 구조가 대부분입니다.

### 2) Dot(".") operator: object.member / class.member
GPL에서 멤버 접근은 다음 형태를 씁니다.
- `object.member`
- `class.member`

예시(공식 문서 의미 기준, 아래 코드는 프로젝트 스타일로 재작성):
```vb
Dim posX As Double
posX = loc.X + 2

loc.X = 3

Dim v As Double
v = Math.Sqrt(3)

' method가 object를 반환하면 점을 연속으로 사용 가능
posX = loc.Inverse.X
```

### 3) 가장 중요한 규칙: “객체 변수는 값이 아니라 참조(pointer)다”
GPL의 객체 변수는 **객체 값을 담는 게 아니라**, 객체 값이 저장된 메모리를 가리키는 **참조(pointer)** 를 담습니다.

따라서 다음이 핵심입니다.
- 객체 변수를 `Dim x As Location`처럼 선언하면, 기본값은 **Nothing**(아직 값이 없음)
- Nothing 상태에서 `x.X` 같은 멤버 접근을 하면 런타임 에러
- 값을 만들려면 `New`로 **할당(allocate)** 해야 함

```vb
Dim loc As Location
' 이 시점의 loc = Nothing

loc = New Location
' 이제 loc.X 같은 멤버 접근 가능
```

### 4) 대입(=)은 “복사”가 아니라 “같은 값을 가리키게 함”
객체는 포인터이므로 아래는 값 복사가 아니라 **포인터 복사**입니다.

```vb
Dim a As New Location
Dim b As Location
b = a

a.X = 10
' b.X도 10으로 보임(같은 값을 가리키기 때문)
```

값 자체를 독립적으로 복사하고 싶으면, 많은 클래스가 제공하는 `Clone`을 사용합니다.

```vb
Dim a As New Location
Dim b As Location
a.X = 10

b = a.Clone
a.X = 20
' b.X는 10 유지(독립 복사)
```

### 5) Nothing: “값 없음” + (필요 시) 메모리 해제 트리거
- 객체 변수에 `Nothing`을 대입하면 이전 포인터를 제거하고, 멤버 접근은 에러가 됩니다.
- 해당 객체 값을 가리키는 포인터가 더 이상 없으면 메모리가 해제됩니다(문서 설명).

실무 패턴(And/Or 단락평가 불확실 이슈 때문에 단계적으로 체크 권장):
```vb
If obj Is Nothing Then
        Exit Sub
End If

' 여기서부터 obj.Member 접근
```

### 6) 객체 인자를 넘길 때: ByVal / ByRef 차이(중요)
객체는 항상 포인터로 전달되기 때문에, ByVal/ByRef의 체감이 일반 타입과 다릅니다.

- **ByVal obj**: "값(포인터)은 전달" → 호출된 곳에서 `obj.X = ...` 같은 **값 변경은 호출자도 영향**
    - 하지만 `obj = New ...`처럼 변수 자체를 다른 포인터로 바꿔도, 그 변경은 호출자에게 반영되지 않음

- **ByRef obj**: "변수(포인터 변수) 자체를 전달" → 값 변경도 반영되고, `obj = New ...` 같은 변수 변경도 호출자에 반영

프로젝트 관점 권장:
- 함수가 **내부 상태만 수정**하면 `ByVal`(의도: 값 수정은 허용, 변수 교체는 금지)
- 함수가 **재할당/초기화까지 해야** 하면 `ByRef`

### 7) User-Defined Class에서 Property를 쓰는 이유
Property는 외부에선 “대입문처럼” 보이지만, 내부에선 Get/Set 절차가 실행됩니다.

- 읽기: `x.Prop` → Get 블록 실행
- 쓰기: `x.Prop = value` → Set 블록 실행

이걸 이용해서:
- field를 `Private`로 숨기고
- Set에서 범위 제한(clip)/검증/로그 등을 강제할 수 있습니다.

또한 문서에 따르면:
- `Shared` 변수/프로시저는 **클래스 단위로 1개만 존재** (권장 표기: `ClassName.Member`)
- 내부적으로 `_Init`, `_New` 같은 이름의 초기화 프로시저가 자동 생성될 수 있으니 사용자 정의로 만들지 말 것

### 8) Limitations(제약) — Late binding 불가
GPL에서는 `Dim x As Object` 같은 **late binding**이 불가능합니다.
즉, 모든 객체는 **명시적인 class type**으로 선언되어야 합니다.

## 주의 사항

- "GPL"은 Guidance Programming Language를 의미하며, GNU General Public License와는 관련이 없습니다.
- 같은 함수 스코프 내에서 동일한 변수명을 중복 선언할 수 없습니다.
- On Error GoTo 구문은 완전히 금지됩니다. 반드시 Try...Catch...End Try 구문만 사용해야 합니다.
- Optional 매개변수는 지원되지 않습니다. 함수 오버로드로 기본값 동작을 구현해야 합니다.
- VB.NET 호환 함수가 제한적입니다. Left, Right, InStrRev, Val, EndOfStream, UBound 등은 지원되지 않습니다.
- Project.gpr 파일에 모든 참조 모듈(.gpl 파일)을 ProjectSource로 등록해야 합니다.

## 지원되는 문자열 함수

- **지원됨**: Mid, InStr, Len, UCase, LCase
- **지원되지 않음**: Left, Right, InStrRev
- **대체방법**:
  - `Left(str, n)` → `Mid(str, 1, n)`
  - `Right(str, n)` → `Mid(str, Len(str) - n + 1)`
 
자세한 문자열 처리 표준과 추가 예시는 `STRING_API_GUIDE.md` 문서를 참고한다.

## 지원되는 StreamReader 함수

- **지원됨**: ReadLine(), Peek(), Close()
- **지원되지 않음**: EndOfStream()
- **대체방법**: 
  - `reader.EndOfStream()` → `reader.Peek() >= 0` (EOF일 때 Peek()은 음수 반환)
  - 빈 줄과 EOF 구분 필요 시 반드시 Peek() 사용

```vb
' 잘못된 예 - EndOfStream() 미지원
Do While Not reader.EndOfStream()
    line = reader.ReadLine()
Loop

' 올바른 예 1 - Peek() 사용 (권장)
Do While reader.Peek() >= 0
    line = reader.ReadLine()
    ' 처리...
Loop

' 올바른 예 2 - 빈 문자열을 EOF로 오판하는 잘못된 패턴 (비권장)
' 파일에 빈 줄이 있으면 조기 종료됨!
Do While hasMore = 1
    line = reader.ReadLine()
    If line = "" Then hasMore = 0  ' ← 빈 줄과 EOF 구분 불가
Loop
```

## 파일 출력 시 줄바꿈 처리

- **권장**: LF(`\n`, `Core_Utils.LF`) 사용
- **주의**: CRLF(`\r\n`, `Core_Utils.CRLF`) 사용 시 이중 줄바꿈 발생 가능
- **이유**: GPL의 StreamWriter 또는 파일 시스템이 줄바꿈을 추가로 처리할 수 있음

```vb
' 잘못된 예 - CRLF 사용으로 빈 줄 이중 생성 가능
Public Function BuildXmlString() As String
    Dim s As String
    s = "<?xml version=""1.0"" encoding=""UTF-8""?>"
    s = s & Core_Utils.CRLF  ' ← 빈 줄이 추가로 생길 수 있음
    s = s & "<root>" & Core_Utils.CRLF
    ' ...
End Function

' 올바른 예 - LF만 사용
Public Function BuildXmlString() As String
    Dim s As String
    s = "<?xml version=""1.0"" encoding=""UTF-8""?>"
    s = s & Core_Utils.LF  ' ← 단일 줄바꿈 보장
    s = s & "<root>" & Core_Utils.LF
    ' ...
End Function
```

**참고 상수 (UtilsModule.gpl)**:
```vb
Public Const CR As String = Chr(13)    ' \r (캐리지 리턴)
Public Const LF As String = Chr(10)    ' \n (라인 피드)
Public Const CRLF As String = CR & LF  ' \r\n (Windows 스타일)
```

## 지원되는 배열 함수

- **지원됨**: array.Length
- **지원되지 않음**: UBound, LBound
- **대체방법**: `UBound(array)` → `array.Length - 1`

## 지원되는 변환 함수

- **지원됨**: CInt, CDbl, CStr, CBool, CByte, CShort, CSng
- **지원되지 않음**: Val
- **대체방법**: `Val(str)` → `CInt(str)` 또는 `CDbl(str)`

## InStr 함수 사용법

```vb
' GPL에서는 시작 위치를 명시해야 함
If InStr(1, text, "search") > 0 Then
    ' 찾음
End If
```

## 컴파일 오류 패턴과 해결책

### Cannot redefine symbol

- **원인**: 같은 함수 스코프 내에서 동일 변수명 중복 선언
- **해결**: 함수 시작 부분에서 한 번만 선언하고 블록 내에서 재사용

### Undefined symbol

- **원인**: Project.gpr에서 참조하는 모듈이 누락됨
- **해결**: Project.gpr에 ProjectSource="모듈명.gpl" 추가

### Illegal use of keyword Optional

- **원인**: Optional 매개변수 사용 (`Optional param As Type = defaultValue`)
- **해결**: 함수 오버로드로 기본값 동작 구현

```vb
' 잘못된 예
Public Function Test(param As String, Optional count As Integer = 1) As Integer
    ' ...
End Function

' 올바른 예 - 오버로드 사용
Public Function Test(param As String, count As Integer) As Integer
    ' ...
End Function

Public Function Test(param As String) As Integer
    Test = Test(param, 1)  ' 기본값 1 사용
End Function
```

### Illegal use of keyword On

- **원인**: On Error GoTo 구문 사용
- **해결**: Try...Catch excVariable 구문으로 교체

### Undefined symbol (VB.NET 함수들)

- **원인**: GPL에서 지원하지 않는 VB.NET 함수 사용 (Left, InStrRev, Val, EndOfStream 등)
- **해결**: GPL 지원 함수로 교체

```vb
' 잘못된 예
version = version & "+" & Left(gitCommit, 7)
pos = InStrRev(originalPath, "/")  
versionMajor = Val(GetNodeValue(root, "major"))
Do While Not reader.EndOfStream()

' 올바른 예  
version = version & "+" & Mid(gitCommit, 1, 7)
' InStrRev 대체 - 수동 뒤에서부터 검색
pos = 0
For i = 1 To Len(originalPath)
    If Mid(originalPath, i, 1) = "/" Then
        pos = i
    End If
Next
versionMajor = CInt(GetNodeValue(root, "major"))
' EndOfStream 대체 - Peek() 사용
Do While reader.Peek() >= 0
    line = reader.ReadLine()
    ' 처리...
Loop
```

### Unexpected text at end of line

- **원인**: 문장 끝에 줄바꿈이 누락되어 다음 문장과 붙어있음
- **해결**: 각 문장 끝(특히 End If, Exit Function, End Sub 등) 후 반드시 줄바꿈 확인

```vb
' 잘못된 예 - 줄바꿈 누락
If path = "" Then
    Exit Function
End If        If Not FileExists(path) Then  ' ← End If와 같은 줄

' 올바른 예 - 적절한 줄바꿈
If path = "" Then
    Exit Function
End If

If Not FileExists(path) Then
    ' ...
End If
```

---
이 문서는 GPL 실무 개발 시 참고할 수 있는 핵심 가이드와 VB.NET과의 차이, 주요 예시를 통합 정리한 문서입니다.
