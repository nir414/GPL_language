# GPL 개발 시 흔한 실수와 해결책

## 빠른 체크리스트

개발 중 오류가 발생했을 때 이 목록을 먼저 확인하세요:

- [ ] **변수 선언 규칙을 지켰는지?** (타입 명시, 절차 최외곽 `Dim`, 초기화/`New` 제약 확인)
- [ ] **클래스 생성자는 `Sub New()`를 사용했는지?** (`Class_Initialize()` 아님)
- [ ] **파일명과 모듈명이 일치하는지?** (예: `Entry_Main.gpl` → `Module Entry_Main`)
- [ ] **Thread 생성 시 StartProcedure 형식을 지켰는지?** (모듈 Public Sub 또는 클래스 Public Shared Sub)
- [ ] **Project.gpr의 컴파일 순서가 의존성을 고려했는지?** (사용하는 모듈이 먼저)
- [ ] XML/텍스트 파일 생성 시 적절한 줄바꿈 문자 사용했는지? (LF vs CRLF)
- [ ] `EndOfStream()` 대신 `Peek() >= 0` 사용했는지?
- [ ] 모든 `End If`, `Exit Function`, `End Sub` 뒤에 줄바꿈이 있는지?
- [ ] `ReadLine() = ""`로 EOF 판정하지 않았는지?
- [ ] `Catch` 블록에 예외 변수를 명시했는지?
- [ ] `Catch`에서 예외를 조용히 무시하지 않았는지? (최소 `Core_ErrorHandler.logException` 또는 상위 전파)
- [ ] `On Error GoTo` 대신 `Try...Catch` 사용했는지?
- [ ] `Optional` 매개변수 대신 함수 오버로드 사용했는지?
- [ ] `Left()`, `Right()`, `InStrRev()` 대신 대체 함수 사용했는지?
- [ ] 모듈 스코프 변수를 `Private Dim`으로 선언했는지 (Shared 제거)?
- [ ] Project.gpr에 모든 모듈을 ProjectSource로 등록했는지?
- [ ] `Continue For/While`를 쓰지 않았는지? (GPL 미지원 → 조건 분기로 대체)
- [ ] `A++`/`A--`를 쓰지 않았는지? (GPL 미지원 → `A += 1`, `A -= 1` 사용)
- [ ] VB 전역 상수 `vbTab`, `vbCrLf` 등을 사용하지 않았는지? (`Utils.TAB`, `Utils.CRLF` 사용)
- [ ] **문자열 리터럴에서 따옴표("")를 `\"`로 이스케이프하지 않았는지?** (GPL은 `"` 스타일 미지원 → `""`로 표현)
- [ ] VS Code에서 `*.gpl`이 `일반 텍스트`로 열리고 있진 않은지? (기본은 `vb`로 연결해 하이라이팅 유지, 폴딩은 확장에서 보정)
- [ ] **편집기 진단(Problems)이 실제 컴파일러와 불일치할 수 있음을 인지했는지?** (GPL 특성상 파서/진단 오탐 가능 → 실제 컴파일 로그를 우선 기준으로 판단)

---

## 0. 변수 선언 규칙 (공식 문서 기준)

### ❌ 잘못된 코드
```vb
' (1) 절차 블록 내부 선언 (최외곽만 선언 가능)
For ii = 1 To 10
        Dim jj As Integer   ' Not allowed
Next ii

' (2) initializer와 변수 리스트 동시 사용
Dim a, b As Integer = 1   ' -761 가능

' (3) 정적 초기화에서 사용자 정의 함수 호출
Public Shared S As String = BuildText()  ' -790 가능
```

### ✅ 올바른 코드
```vb
' 절차 최외곽에서 선언
Dim ii As Integer
Dim jj As Integer

' initializer를 쓸 때는 단일 변수만 선언
Dim a As Integer = 1
Dim b As Integer = 2

' 복잡한 초기화는 분리하면 디버깅이 쉬움
Dim result As String
result = BuildText()
```

### 설명
- 공식 `Variable Declarations` 문서 기준:
    - 선언은 `Dim/Static/Private/Public`으로 수행
    - **절차 내부 선언은 최외곽 레벨에서만 허용**
    - 타입은 `As`로 명시하는 것이 안전
    - initializer(`=`)는 문법적으로 허용되나, **initializer가 있는 선언은 변수 1개만 가능**
    - `New`는 `As New` 또는 `= New` 중 하나만 사용
- initializer에 사용자 정의 함수 호출은 가능하지만, 문맥에 따라 초기화 순서 이슈가 생길 수 있어 실무에서는 분리 대입을 권장합니다.

### 관련 에러
- `-726 Data type required`
- `-761 Cannot have list of variables`
- `-790 Invalid static initializer`

---

## 0-0. `Throw` 사용 규칙 (`-807`, `-786`, `-1038`)

### 핵심

- `Throw exception_object`
- `Try` 블록 밖에서도 사용 가능 (해당 스레드 종료 + 예외 보고)
- `Catch`에서 재던지기(rethrow) 가능

### ❌ 잘못된 코드

```vb
Dim ex As New Exception
' ErrorCode 기본값은 0 -> Throw 시 -807 가능
Throw ex
```

### ✅ 올바른 코드

```vb
Dim ex As New Exception
ex.ErrorCode = -786           ' Project generated error
ex.Qualifier = 1001           ' 선택: 부가 정보
Throw ex
```

### 설명

- `Throw` 대상 `Exception.ErrorCode`는 **반드시 음수**여야 함
- 음수가 아니면 `-807 Invalid exception`
- 사용자 정의 예외 용도로 문서가 명시한 코드:
    - `-786 Project generated error`
    - `-1038 Project generated robot error`

### 관련 에러

- `-807 Invalid exception`
- `-785 Branch not permitted` (Try/Catch/Finally 경계로 부적절한 GoTo 분기)
- `-808 Branch out of Finally block not permitted`

### Language Related Errors 빠른 매핑

이번 문서와 직접 연관된 코드만 추렸습니다.

| 코드 | 의미(공식) | 실무 해석 |
|---|---|---|
| `-722` | Unexpected text at end of line | 라인 끝에 문법상 불필요한 텍스트/구문이 남음 (`:` 연쇄, 누락된 주석 기호 등) |
| `-781` | Missing string | `&` 뒤에 문자열이 와야 하는데 타입/식이 맞지 않음 |
| `-742` | Compilation errors | 상위 요약 에러(세부 에러 먼저 해결 필요) |
| `-726` | Data type required | 선언에서 `As 타입` 누락 |
| `-761` | Cannot have list of variables | initializer와 변수 목록 동시 사용 |
| `-790` | Invalid static initializer | 정적 초기화에서 사용자 정의 메서드 호출 |
| `-807` | Invalid exception | `Throw` 대상 `Exception.ErrorCode`가 음수가 아님 |

공식 레퍼런스:
- https://www2.brooksautomation.com/#Controller_Software/Software_Reference/GPL_Error_Code/language_errors.htm

---

## 0-1. 클래스 생성자 패턴

### ❌ 잘못된 코드
```vb
Public Class XmlStore
    Private m_enableMetadata As Integer
    
    ' VB6/VBA 스타일 생성자 (GPL에서는 비표준)
    Public Sub Class_Initialize()
        m_enableMetadata = 1
    End Sub
End Class
```

### ✅ 올바른 코드
```vb
Public Class XmlStore
    Private m_enableMetadata As Integer
    
    ' .NET 스타일 생성자 (GPL 표준)
    Public Sub New()
        m_enableMetadata = 1
    End Sub
End Class
```

### 설명
- GPL은 VB.NET 기반이므로 생성자는 `Sub New()`를 사용합니다.
- `Class_Initialize()`는 VB6/VBA 스타일로 GPL에서는 비표준입니다.
- 클래스 인스턴스 생성 시 `New()`가 자동 호출되어 초기화를 수행합니다.
- 매개변수가 필요한 경우 `Sub New(param As Type)` 형태로 오버로드 가능합니다.

### 참고 사례
```vb
' TcpCommunication.gpl 참고
Public Sub New(IP As String, PORT As String)
    index = TcpCount
    TcpCount += 1
    ' 초기화 로직...
End Sub
```

### 관련 에러
- 생성자가 호출되지 않음
- 초기화되지 않은 멤버 변수

---

## 0-2. 파일명과 모듈명 일치

### 규칙
도메인 기반 접두사를 사용하여 파일명과 모듈명을 일치시킵니다.

### ✅ 올바른 예시
```
파일명: Entry_Main.gpl         → Module Entry_Main
파일명: Storage_File_Manager.gpl → Module Storage_File_Manager
파일명: Data_XmlStore.gpl      → Module Data_XmlStore
파일명: Robot_AirSolCylinder.gpl → Module Robot_AirSolCylinder
```

### 도메인 분류
- **Core_**: 시스템 핵심 (Entry/Main, ErrorHandler, Utils)
- **Storage_**: 저수준 파일 I/O (Flash-safe)
- **Net_**: 네트워크(TCP 등)
- **Data_**: 데이터 저장/처리 (XmlStore, DatStore, AsyncSave)
- **Robot_**: 로봇 동작 로직 (CeramicJig, SimulatedAction)
- **Entry_**: 엔트리/메인 루프

### 이유
- GPL은 폴더/네임스페이스를 지원하지 않아 모든 파일이 단일 디렉토리에 위치
- 접두사로 모듈 간 관계와 계층을 표현
- 파일 목록에서 도메인별 그룹핑이 자동으로 이루어짐

---

## 0-3. Thread 생성 시 모듈명 사용

### ✅ 올바른 코드
```vb
Module Net_Tcp_Communication
    Public Class TcpCommunication
        Public Sub New(IP As String, PORT As String)
            ' Thread 생성: (권장) class Public Shared procedure를 직접 지정
            Dim thread As New Thread("TcpCommunication.TcpCommunicationThreadFunc", , "TCPCOM")
            thread.Start()
        End Sub
        
        ' Thread Entry 함수
        Public Shared Sub TcpCommThreadEntry()
            TcpCommunicationThreadFunc()
        End Sub
    End Class
End Module
```

### ❌ 잘못된 코드
```vb
' Public/Shared 조건을 만족하지 않는 클래스 메서드 사용 (오류 가능)
Dim thread As New Thread("TcpCommunication.NonSharedMethod", , "TCPCOM")

' 모듈명 없이 함수명만 사용 (오류 발생)
Dim thread As New Thread("TcpCommThreadEntry", , "TCPCOM")
```

### 설명
- 공식 문서(Thread.New) 기준 StartProcedure는 아래 중 하나여야 함
    - **모듈명.함수명** (Module 내 Public Sub)
    - **클래스명.함수명** (Class 내 Public Shared Sub)
- 위 조건(Public / (Module 또는 Class+Shared) / 이름 지정 형식)을 지키면 안정적으로 동작합니다.

---

## 0-4. 컴파일 순서 (Project.gpr)

### ✅ 올바른 순서
```plaintext
ProjectSource="Core_SpinLock.gpl"         ' 1. 동시성 유틸
ProjectSource="Core_ErrorHandler.gpl"     ' 2. 기본 유틸리티
ProjectSource="Core_Utils.gpl"
ProjectSource="Core_StringUtils.gpl"
ProjectSource="Storage_File_Manager.gpl" ' 3. Storage 계층
ProjectSource="Net_Tcp_CommandQueue.gpl"
ProjectSource="Net_Tcp_SocketSend.gpl"
ProjectSource="Net_Tcp_SocketReceive.gpl"
ProjectSource="Net_Tcp_Session.gpl"
ProjectSource="Net_Tcp_CommandHandler.gpl"
ProjectSource="Net_Tcp_ServerLoop.gpl"
ProjectSource="Net_Tcp_Communication.gpl"
ProjectSource="Data_AsyncSave.gpl"        ' Data 계층 (Storage 의존)
ProjectSource="Data_XmlStore.gpl"         '    - XmlStore/DatStore는 AsyncSave 사용
ProjectSource="Data_DatStore.gpl"
ProjectSource="Robot_AirSolCylinder.gpl"
ProjectSource="Robot_SimulatedAction.gpl"
ProjectSource="Entry_Main.gpl"            ' Main (모든 모듈 사용)
```

### ❌ 잘못된 순서
```plaintext
ProjectSource="Storage_File_Manager.gpl" ' Data_AsyncSave 미정의 오류 가능
ProjectSource="Data_XmlStore.gpl"         ' (XmlStore가 Data_AsyncSave를 참조)
ProjectSource="Data_AsyncSave.gpl"
```

### 규칙
- **사용되는 모듈이 먼저, 사용하는 모듈이 나중에**
- 의존성 순서: Core → IO → Data → Robot → Test → Main
- 순서가 잘못되면 "Undefined symbol" 컴파일 오류 발생

### 증상
```
*Undefined symbol* Data_AsyncSave
*Undefined symbol* Enqueue
```
→ Project.gpr에서 해당 모듈이 사용되는 위치보다 뒤에 선언됨

---

## 0-5. (-782) *Object value is Nothing* (문자열 Nothing 비교/Len/Mid)

### 증상

아래와 같은 런타임 오류가 발생할 수 있습니다.

```
(-782) *Object value is Nothing*
```

### 원인

- GPL에서 `String` 변수가 `Nothing`(null)인 상태가 발생할 수 있음
- 그리고 **`Or`/`And`가 단락평가(Short-circuit)를 보장하지 않는 환경**이면,
  `A Or B`에서 `A`가 참이더라도 `B`가 평가되어 `Nothing` 접근으로 -782가 날 수 있음

특히 다음 패턴이 위험합니다.

### ❌ 잘못된 코드(위험)

```vb
' s가 Nothing이면 두 번째 비교에서 -782 가능
If s Is Nothing Or s = "" Then
    ' ...
End If

' s가 Nothing이면 Len/Mid에서 -782 가능
If Len(s) > 0 Then
    ch = Mid(s, 1, 1)
End If
```

### ✅ 올바른 코드(권장)

**단계적으로 검사**하여 `Nothing`인 경우에는 절대 `=`/`Len`/`Mid`를 호출하지 않도록 합니다.

```vb
If s Is Nothing Then
    ' nothing 처리
ElseIf s = "" Then
    ' empty 처리
Else
    ' 정상 처리
End If
```

또는 입력을 바로 정규화합니다.

```vb
If s Is Nothing Then s = ""
' 이후 s 사용
If s <> "" Then
    ' ...
End If
```

### 체크 포인트

- `If x = "" Or ...` / `If x <> "" And ...` 형태는 단계적 체크로 교체
- `Len(x)`, `Mid(x, ...)`, `x.Substring(...)`, `x.IndexOf(...)` 호출 전 `x Is Nothing` 방어
- 로그/파일 경로 같은 핵심 문자열(`logFilePath` 등)은 기본값 세팅 함수(예: `InitDefaults`)를 먼저 호출

---

## 0-5-1. GPL은 블록 스코프(Block Scope)를 허용하지 않음

### 요약

GPL에서는 `If / For / While / Try / Catch` 같은 **블록 내부에서 변수를 선언(Dim)** 하더라도,
그 변수가 블록에만 한정되는 “블록 스코프”로 동작하지 않는다고 가정하고 작성하는 것이 안전합니다.

즉, VB.NET처럼 블록마다 같은 이름을 재선언하는 스타일은:

- 중복 선언/컴파일 오류를 만들거나
- “블록을 나가면 변수가 사라진다”는 잘못된 가정으로 디버깅을 어렵게 만들 수 있습니다.

### ✅ 권장 패턴

- 로컬 변수는 **Sub/Function 상단에서 1회 선언**
- 블록에서는 값만 갱신

---

## 0-5-2. `Return Me`/Property 파서 이슈 (실전 메모)

### 요약

- 일부 환경에서 `Return Me`와 `Property` 구문이 파서를 흔들어 **`Not a top-level statement`** 계열 오류가 연쇄 발생.
- 특히 **Property + Get/Set** 또는 **배열 반환 함수** 조합에서 오류가 재현된 사례가 있음.

### 권장 회피 패턴

**(1) `Return Me` 대신 함수명 대입 + `Exit Function` 사용**

```vb
Public Function Clear() As AxisZeroPlan
    plan.Clear()
    Clear = Me
    Exit Function
End Function
```

**(2) 배열 반환은 `ByRef` 출력 파라미터로 전달**

```vb
Public Sub GetItems(ByRef outItems() As AxisZeroSetting)
    outItems = settings
End Sub
```

### 메모

- GPL 문서상 Property는 지원되지만, 실제 컴파일러/프로젝트 구성에 따라 불안정할 수 있음.
- 문제가 재현되면 **함수/서브 기반 API로 치환**하는 편이 안정적.

#### ❌ (혼동/오류 위험) 블록마다 같은 이름으로 Dim

```vb
If condA Then
    Dim i As Integer
    i = 1
End If

If condB Then
    Dim i As Integer  ' 중복 선언 문제가 될 수 있음
    i = 2
End If
```

#### ✅ (권장) 프로시저 상단에서 1회 선언

```vb
Dim i As Integer
i = 0

If condA Then
    i = 1
End If

If condB Then
    i = 2
End If
```

### 실무 팁

- “블록 안에서만 쓸 변수”라도, 선언은 위로 올리고 **블록에서 초기화/대입만** 하는 습관이 안전합니다.

---

## 0-6. 외부 코드 이식(Porting) 시 체크리스트

외부 프로젝트의 VB/GPL 유사 코드를 가져올 때는 아래 항목을 우선 점검합니다.

- 조건문은 **단계적 평가**로 바꾸기 (`Or`/`And` 단락평가 미보장 가능)
- 개행/탭 상수는 `Utils.CRLF`, `Utils.LF`, `Utils.TAB`만 사용 (vbCrLf 등 금지)
- `Optional` 매개변수는 금지 → 오버로드로 대체
- 전역 심볼 의존성은 최소화
    - 예: 외부 코드에 있던 `DisableCheckSensors` 같은 플래그는 클래스 내부 `Shared`로 포함해 단독 재현 가능하게

---

## 0-6-1. CreateDirectory의 (-510) *File already exists* 처리

### 증상

로그 디렉토리를 `File.CreateDirectory()`로 매번 보장하는 코드에서 아래와 같은 경고가 반복될 수 있습니다.

```
WARN(-510): ... CreateDirectory failed | *File already exists*
```

### 해결

- 디렉토리가 이미 존재하는 예외(`ex.ErrorCode = -510`)는 **정상/성공 케이스로 처리**해 로그 스팸을 막습니다.
- 가능하면 한 번 성공하면 같은 경로에 대해 재호출을 피하도록 캐시(플래그)로 최적화합니다.

---

## 0-7. Socket Property에 `Nothing` 대입 금지 (컨트롤러 크래시/버그성)

### 주의(중요)

- `Socket`을 **Property로 감싸서** 보관하는 구조에서 `session.Socket = Nothing`처럼
    **Property에 `Nothing`을 대입하는 순간 컨트롤러가 멈추는(크래시하는) 버그가 재현됨**.
- 이 케이스는 **Try/Catch로 방지/처리 불가** → 코딩/리뷰 단계에서 **금지 패턴으로 차단**할 것.

### 코드 리뷰 체크 포인트

- [ ] `Socket`(또는 Session 내부 Socket) **Property에 `Nothing` 대입 코드가 없는지?**
- [ ] 소켓 해제 의도를 **값 대입으로 표현하지 않았는지?**

---

## 1. 파일 출력 시 줄바꿈 문제

### 핵심 규칙

- 개행/탭 상수는 **반드시 `Core_Utils.Utils`의 상수만** 사용합니다.
  - `Utils.CRLF`, `Utils.LF`, `Utils.TAB`
- 모듈별로 `CRLF` 등을 재정의하지 않습니다.

### 권장 패턴

기본값은 `Utils.CRLF`를 사용합니다.

```vb
' 기본값: CRLF 사용
Public Function BuildXmlString() As String
    Dim s As String
    s = "<?xml version=""1.0"" encoding=""UTF-8""?>"
    s = s & Utils.CRLF
    s = s & "<root>" & Utils.CRLF
    ' ...
End Function
```

**증상(각 줄 사이에 빈 줄이 추가됨)** 이 특정 포맷(XML/텍스트)에서 재현되면,
해당 포맷을 생성하는 함수에서만 `Utils.LF`로 전환할 수 있습니다.

```vb
' 예외: 이중 줄바꿈(빈 줄) 재현 시 LF로 전환 (이유를 주석으로 기록)
Public Function BuildXmlString_LF() As String
    Dim s As String
    s = "<?xml version=""1.0"" encoding=""UTF-8""?>"
    s = s & Utils.LF
    s = s & "<root>" & Utils.LF
    ' ...
End Function
```

### 증상
- XML 파일의 각 태그 사이에 빈 줄이 하나씩 추가로 삽입됨.
- 파일 크기가 예상보다 커짐.
- 가독성이 떨어지고 파싱 시 불필요한 공백 처리 필요.

### 관련 상수
```vb
' Core_Utils.gpl 참고
Public Const CR As String = Chr(13)    ' \r
Public Const LF As String = Chr(10)    ' \n
Public Const CRLF As String = CR & LF  ' \r\n
```

---

## 1. StreamReader EOF 감지 오류

### ❌ 잘못된 코드
```vb
' EndOfStream() 미지원
Do While Not reader.EndOfStream()
    line = reader.ReadLine()
Loop

' 빈 줄과 EOF 구분 불가
Do While hasMore = 1
    line = reader.ReadLine()
    If line = "" Then hasMore = 0  ' 빈 줄에서 조기 종료!
Loop
```

### ✅ 올바른 코드
```vb
' Peek()으로 EOF 감지 (권장)
Do While reader.Peek() >= 0
    line = reader.ReadLine()
    ' 처리...
Loop
```

### 설명
- GPL의 `StreamReader`는 `EndOfStream()` 메서드를 지원하지 않습니다.
- `Peek()`는 다음 읽을 문자를 반환하며, EOF일 때 음수(-1)를 반환합니다.
- `ReadLine() = ""`로 EOF를 판정하면 파일 중간의 빈 줄에서 읽기가 중단됩니다.

### 관련 에러
- `Undefined symbol EndOfStream`
- 파일 읽기 조기 종료
- 불완전한 데이터 로드

---

## 2. 줄바꿈 누락 오류

### ❌ 잘못된 코드
```vb
If path = "" Then
    Exit Function
End If        If Not FileExists(path) Then  ' ← End If와 같은 줄!
    ' ...
End If
```

### ✅ 올바른 코드
```vb
If path = "" Then
    Exit Function
End If

If Not FileExists(path) Then
    ' ...
End If
```

### 설명
- 각 문장은 반드시 별도의 줄에 작성해야 합니다.
- 특히 `End If`, `End Sub`, `Exit Function`, `End Try` 등 제어문 종료 뒤에는 줄바꿈 필수.
- 줄바꿈이 없으면 컴파일러가 한 문장으로 인식해 파싱 오류 발생.

### 관련 에러
- `Unexpected text at end of line`
- `End of statement expected`
- `Undefined symbol` (줄바꿈 누락으로 후속 변수 인식 실패)

---

## 2-1. 문자열 리터럴의 따옴표 이스케이프(\" 금지)

### 증상

- 아래 같은 컴파일 오류가 날 수 있습니다.

```
(-722) Unexpected text at end of line
```

### 원인

- GPL의 문자열 리터럴은 C/Java 스타일의 `\"` 이스케이프를 지원하지 않습니다.
- 문자열 내부에 쌍따옴표를 넣고 싶으면 **따옴표를 두 번(`""`)** 써서 표현해야 합니다.

### ❌ 잘못된 코드

```vb
' " 형태는 GPL에서 파서가 깨질 수 있음
logLine = logLine & " | \"" & context & "\""
```

### ✅ 올바른 코드

```vb
' 문자열 안의 따옴표는 "" 로 표현
logLine = logLine & " | """ & context & """"
```

### 체크 포인트

- 전역 검색으로 `\"` 패턴이 남아있는지 확인
- 로그 메시지/CSV/JSON/XML 문자열 조립 시 특히 자주 발생

---

## 2-2. Location Cartesian 작성 시 `(-722)` / `(-781)`

### 증상

- `(-722) Unexpected text at end of line`
- `(-781) Missing string DPdistance`

### 원인

1) GPL 문법상 **한 줄에는 문장 1개만 허용**되며, `:`는 **라인 라벨 구분자**로 사용됩니다.

즉, 아래처럼 `:`로 여러 문장을 연결하는 작성은 비권장 수준이 아니라 문법 충돌을 유발할 수 있습니다.

```vb
Loc1.X = 100 : Loc1.Y = 100 : Loc1.Z = 50
```

공식 근거: Statement Structure
- "Only one statement is permitted per line"
- 라벨 문법: `Label: Statement`

2) 로그 문자열 연결 시 숫자값을 문자열로 명시 변환하지 않아 타입 해석이 꼬일 수 있음

```vb
Core_ErrorHandler.log("Distance from point to segment: " & DPdistance, "MAIN")
```

### 권장 패턴

```vb
Dim Loc1 As New Location
Dim Loc2 As New Location
Dim LocP As New Location

Loc1.XYZ(100, 100, 50, 0, 0, 0)
Loc2.XYZ(250, 120, 50, 0, 0, 0)
LocP.XYZ(180, 220, 50, 0, 0, 0)

Dim DPdistance As Double
DPdistance = point_segment_distance(Loc1, Loc2, LocP)
Core_ErrorHandler.log("Distance from point to segment: " & CStr(DPdistance), "MAIN")
```

### 추가 참고

- 상세 배경 문서: `gpl-language/location-cartesian.md`

---

## 3. 예외 처리 문법 오류

### ❌ 잘못된 코드
```vb
' On Error 사용 금지
On Error GoTo ErrorHandler

' Catch 변수 누락
Try
    ' ...
Catch
    Console.WriteLine("Error occurred")
End Try

' VB.NET 스타일 변수 선언
Catch ex As Exception
    Console.WriteLine(ex.Message)  ' Message는 메서드!
End Try
```

### ✅ 올바른 코드
```vb
' Try...Catch...End Try만 사용
Dim exc As New Exception
Try
    ' ...
Catch exc
    Console.WriteLine("Error: " & exc.Message())  ' Message()는 메서드
    Console.WriteLine("Code: " & CStr(exc.ErrorCode))
End Try
```

### 설명
- GPL은 `On Error GoTo` 구문을 지원하지 않습니다.
- `Catch` 블록에는 반드시 예외 변수를 명시해야 합니다.
- `Exception.Message`는 속성이 아닌 메서드(`Message()`)입니다.
- 예외 변수는 `Try` 블록 전에 미리 선언해야 합니다.

### 관련 에러
- `Illegal use of keyword On`
- `Catch requires exception variable`
- `Undefined symbol ex`

---

## 4. Optional 매개변수 사용

### ❌ 잘못된 코드
```vb
Public Function Test(param As String, Optional count As Integer = 1) As Integer
    ' ...
End Function
```

### ✅ 올바른 코드
```vb
' 함수 오버로드로 기본값 구현
Public Function Test(param As String, count As Integer) As Integer
    ' ...
End Function

Public Function Test(param As String) As Integer
    Test = Test(param, 1)  ' 기본값 1 사용
End Function
```

### 설명
- GPL은 `Optional` 키워드를 지원하지 않습니다.
- 기본값이 필요한 경우 함수 오버로드를 사용합니다.

### 관련 에러
- `Illegal use of keyword Optional`

---

## 5. VB.NET 함수 사용 오류

### ❌ 잘못된 코드
```vb
' Left, Right, InStrRev 미지원
version = Left(gitCommit, 7)
extension = Right(fileName, 4)
pos = InStrRev(path, "/")

' Val 미지원
versionMajor = Val(versionStr)

' UBound 미지원
For i = 0 To UBound(array)
```

### ✅ 올바른 코드
```vb
' Mid로 대체
version = Mid(gitCommit, 1, 7)
extension = Mid(fileName, Len(fileName) - 3)

' InStrRev 대체 - 수동 검색
pos = 0
For i = 1 To Len(path)
    If Mid(path, i, 1) = "/" Then
        pos = i
    End If
Next

' CInt, CDbl로 대체
versionMajor = CInt(versionStr)

' array.Length 사용
For i = 0 To array.Length - 1
```

### 설명
- GPL은 VB.NET의 많은 문자열/배열 함수를 지원하지 않습니다.
- 지원되는 함수: `Mid`, `InStr`, `Len`, `UCase`, `LCase`, `array.Length`
- 미지원 함수: `Left`, `Right`, `InStrRev`, `Val`, `UBound`, `LBound`

### 관련 에러
- `Undefined symbol Left/Right/InStrRev/Val/UBound`

---

## 6. Shared 키워드 오류

### ❌ 잘못된 코드
```vb
Module MyModule
    Private Shared Dim counter As Integer
    Private Shared Dim queue(100) As String
End Module
```

### ✅ 올바른 코드
```vb
Module MyModule
    Private Dim counter As Integer
    Private Dim queue(100) As String
End Module
```

### 설명
- GPL의 모듈 스코프 변수는 `Shared` 키워드를 사용하지 않습니다.
- 모듈 내 변수는 기본적으로 공유되므로 `Private Dim`만 사용합니다.

### 관련 에러
- `Illegal use of keyword Shared`

---

## 7. 타입 인스턴스화 오류

### ❌ 잘못된 코드
```vb
' Module을 네임스페이스처럼 사용
Dim store As New Data_XmlStore.XmlStore
```

### ✅ 올바른 코드
```vb
' 클래스명만 사용
Dim store As New XmlStore
```

### 설명
- GPL의 Module은 네임스페이스가 아닙니다.
- 타입 참조 시 클래스명만 사용합니다.

### 관련 에러
- `Invalid data type Data_XmlStore`

---

## 8. Project.gpr 참조 누락

### ❌ 문제 상황
```
Undefined symbol MyModule
```

### ✅ 해결 방법
```xml
<!-- Project.gpr에 모듈 추가 -->
<ProjectSource>MyModule.gpl</ProjectSource>
```

### 설명
- 모든 `.gpl` 파일은 `Project.gpr`의 `ProjectSource`에 등록되어야 합니다.
- 등록되지 않은 모듈의 함수/클래스는 `Undefined symbol` 오류 발생.

---

## 9. `Continue For/While` 미지원

### ❌ 잘못된 코드
```vb
Dim i As Integer
For i = 0 To items.Length - 1
    If items(i) = "" Then
        Continue For	' GPL에서 미지원
    End If
    Process(items(i))
Next
```

### ✅ 올바른 코드
```vb
Dim i As Integer
For i = 0 To items.Length - 1
    If items(i) <> "" Then
        Process(items(i))
    End If
Next
```

### 설명
- GPL은 `Continue For`, `Continue While` 키워드를 지원하지 않습니다.
- 조건 분기(`If ... Then`)로 건너뛰기 로직을 표현하세요.
- 중첩 루프에서는 `shouldProcess` 같은 플래그를 사용해 가독성을 높입니다.

### 관련 에러
- `Unexpected text at end of line`
- `No matching control structure` (제어문 파싱 실패 시)

---

## 10. VB 상수(vbTab, vbCrLf 등) 사용

### ❌ 잘못된 코드
```vb
Dim line As String
line = "Key" & vbTab & "Value"   ' vbTab 미지원
line = line & vbCrLf              ' vbCrLf 대신 Utils.CRLF 사용
```

### ✅ 올바른 코드
```vb
Dim line As String
line = "Key" & Utils.TAB & "Value"
line = line & Utils.CRLF
```

### 설명
- GPL은 VB 전역 상수 `vbTab`, `vbCr`, `vbLf`, `vbCrLf`를 제공하지 않습니다.
- 공통 개행/탭 상수는 `Core_Utils.Utils`에 정의된 값을 사용합니다.
- 탭이 필요할 때는 `Utils.TAB`(= Chr(9)), 개행은 `Utils.CRLF`(또는 `Utils.LF`)만 사용해 일관성을 유지합니다.

### 관련 에러
- `Undefined symbol vbTab/vbCrLf`

---

## 디버깅 팁

### 컴파일 오류 해결 순서
1. **첫 번째 오류부터 해결**: 선행 오류가 후속 오류를 유발할 수 있음
2. **편집기 진단은 참고용**: 실제 컴파일러 로그가 더 정확할 수 있으므로, 최종 판단은 컴파일 결과로
2. **줄바꿈 확인**: `Unexpected text` 오류는 대부분 줄바꿈 누락
3. **지원 함수 확인**: VB.NET 함수 사용 시 GPL 지원 여부 확인
4. **예외 처리 점검**: `On Error` 사용 여부, `Catch` 변수 확인
5. **Project.gpr 확인**: 모듈 등록 여부 확인

### 자주 발생하는 에러 패턴
- `Unexpected text at end of line` → 줄바꿈 누락
- `Undefined symbol EndOfStream` → `Peek()` 사용
- `Illegal use of keyword On/Optional/Shared` → GPL 미지원 키워드
- `Undefined symbol Left/Right/Val` → 대체 함수 사용
- `Invalid data type ModuleName` → 클래스명만 사용

---

## 참고 문서

- **GPL_언어_실무_가이드.md**: GPL 언어 전반적인 가이드
- **INCIDENTS.md**: 과거 오류 사례 및 해결 방법
- **FILE_IO_IMPLEMENTATION.md**: 파일 I/O 구현 패턴
- **ERROR_HANDLING_GUIDE.md**: 에러 처리 표준
- **STRING_API_GUIDE.md**: 문자열 처리 가이드
