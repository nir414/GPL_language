# 🤖 Developer Handover Guide

## Test_robot GPL 프로젝트 인수인계 문서

---

## 📌 Part 1: GitHub Copilot의 역할 정의

### 현재 AI 어시스턴트의 역할

```gpl
너는 GPL(Guidance Programming Language) 자체 어셈블리 언어 전문가로써,
함께 학습하며 전문가 수준의 코드를 작성하는 개발자이다.
```

### 일일 작업 흐름


1. **코드 검토 & 설계 검증** - custom_prompt.txt의 설계 원칙 준수 확인
2. **코드 작성** - GPL 언어 특성 반영 (Thread.TestAndSet, Try/Catch 등)
3. **즉시 학습 기록** - 새로운 정보/오류는 즉시 docs에 추가
4. **파일 구조 동기화** - 파일 추가/삭제 시 Project.gpr 동시 수정

---

## 📌 Part 2: 프로젝트 핵심 설계 철학

### 2.1 왜 이렇게 설계했는가? (Design Rationale)

#### **비동기 저장 (Data_AsyncSave, 구 XmlAsyncSave)**

```
이유: Flash 메모리 수명 관리 (쓰기 횟수 제한)
원칙: 즉시 저장이 아닌, 배치 처리로 쓰기 빈도 최소화
결과: SaveCount 메타데이터로 실제 저장 횟수 추적
```

#### **메타데이터 자동 추적 (SaveCount, LastSaveTime)**

```
이유: 문제 발생 시 "언제 마지막으로 저장했나" 파악
원칙: 데이터 변경 시마다 메타데이터 갱신
결과: 오류 원인 분석 시간 단축
```

#### **스레드-세이프 설계 (TestAndSet 세마포어)**

```
이유: 로봇 제어는 실시간성 요구 → 동시성 버그 치명적
원칙: 공유 상태는 반드시 락으로 보호
결과: 예측 가능한 동작, 타이밍 버그 방지
```

#### **모듈 분리 (단일 책임 원칙)**

```
XmlStore = 데이터 영속성만 담당
Data_AsyncSave = 비동기 큐 관리만 담당
Storage_File_Manager = Flash 안전 저장만 담당
Core_ErrorHandler = 로깅만 담당


이유: 각 모듈을 독립적으로 테스트/수정 가능
결과: 버그 범위 축소, 유지보수 용이
```

### 2.2 코딩 우선순위 (Priority)

```gpl
1. 명확성 > 간결성
   - 읽기 쉬운 코드가 빠른 코드보다 우선
   - 주석/함수명으로 의도 명확히
   - 복잡한 논리는 작은 함수로 분리

2. 정확성 > 성능
   - 빠르지만 틀린 것보다 느리지만 정확한 것
   - 에러 처리 생략하지 말 것
   - 스레드-세이프를 절대 우회하지 말 것

3. 테스트 가능성 > 편리성
   - 나중에 검증 가능하게 설계
   - 의존성은 주입받도록 (느슨한 결합)
   - 글로벌 상태 최소화

4. 문서화 > 영리한 코드
   - 훗날 다른 개발자가 이해 가능하도록
   - 왜 이렇게 했는지 주석으로 남길 것
   - 가독성을 위해 의도적으로 "비효율적인" 코드 작성 가능

### 2.4 (초입 단계) 단순 위임 래퍼 지양

현재 프로젝트는 아직 초입 단계이므로, 다음 원칙을 기본으로 합니다.

- **의미 없는 1줄 위임(thin wrapper)은 만들지 않는다.**
   - 호출부에 "한 번 더 점프"가 생겨 해석이 어려워지기 때문
- 대신 **책임이 있는 모듈/객체를 직접 호출**한다.
   - 예: `Net_Tcp_CommandQueue.PendingCountFor(i)` / `tcp.Queue.PendingCount()`
- 퍼사드/래퍼는 아래 가치가 생길 때만 도입한다.
   - 정책(로깅/계측/권한/검증), 공통 예외 처리, 호환성 유지, 호출부 대량 변경 방지
```

### 2.3 품질 기준 (Quality Gate)

코드 작성 후 스스로 점검:

```
- [ ] 의도가 명확한가? (주석/함수명만으로 이해 가능?)
- [ ] 예외 처리가 빠지지 않았나? (모든 Try/Catch 완료?)
- [ ] 스레드-세이프한가? (공유 상태 모두 보호?)
- [ ] 테스트 가능한가? (외부 의존성 주입 가능?)
- [ ] 한 모듈이 한 가지만 담당하나? (책임 분리?)
- [ ] 메타데이터/로깅이 충분한가? (나중에 원인 파악 가능?)
```

---

## 📌 Part 3: GPL 제어 구조 실수 방지 체크리스트

```gpl
1. 모든 While, For, If, Sub, Function, Class, Module의 
   시작과 끝(End 키워드)을 주석으로 표시
   
   예시:
   While ... ' [BEGIN While loop_name]
   ...
   End While ' [END While loop_name]
   
   중첩이 많을 때는 블록 이름/레벨을 주석으로 명확히 표시

2. 저장/커밋 전, 각 End 키워드가 대응되는 블록이 있는지 직접 눈으로 확인
   - 블록별로 접기/펼치기 기능 활용
   - End 키워드가 한 줄에 여러 개 나오지 않도록, 각 블록마다 줄바꿈 명확히

3. 들여쓰기와 줄바꿈(LF/CRLF) 일관성 유지
   - 혼용 시 구조 오류 발생 가능

4. 예외 처리 시 Catch 변수 명시, Try-End Try 구조 명확히

5. 실무에서 자주 발생하는 패턴
   - End 키워드 누락/과다, 중첩 구조 꼬임, 들여쓰기 불일치
   - 컴파일러 오진 시, 블록 구조와 줄바꿈을 우선 점검

6. VS Code 확장(gpl-language-extension 등)에서 
   블록 매칭 오류 실시간 표시 기능 활용
```

---

## 📌 Part 4: GPL 언어 제약 & 패턴

### 4.1 Try/Catch 패턴 (필수)

```gpl
' ✅ 올바른 패턴
Dim ex As New Exception
Try
    ' 코드...
Catch ex
    Core_ErrorHandler.logException(ex, "Context message")
Finally
    ' 정리 작업
End Try

' ❌ 금지 패턴
On Error GoTo ...           ' 사용 금지
Catch ex As RobotError      ' 타입 지정 금지 (모두 Exception)
```

### 4.2 Optional 매개변수 (금지) - 오버로드 사용

```gpl
' ❌ 금지
Function SaveFile(path As String, Optional useBackup As Integer = 1) As Integer

' ✅ 올바른 패턴 (오버로드)
Function SaveFile(path As String) As Integer
    SaveFile = SaveFile(path, 1)
End Function

Function SaveFile(path As String, useBackup As Integer) As Integer
    ' 실제 구현
End Function
```

### 4.3 스레드 락 패턴 (TestAndSet 사용)

```gpl
' 세마포어 선언
Private Dim lock_var As Integer

' Acquire
While Thread.TestAndSet(lock_var, 1) <> 0
    Thread.Sleep(0)
End While

' Critical section
' ...

' Release
lock_var = 0
```

### 4.4 워커 스레드 시작 (단 1회만)

```gpl
Private Dim started As Integer
Private Dim workerThread As Thread = New Thread("ModuleName.WorkerFunc", , "WorkerName")

Private Sub EnsureWorkerStarted()
    If Thread.TestAndSet(started, 1) = 0 Then
        workerThread.Start
    End If
End Sub
```

### 4.5 예외 메시지 호출 (괄호 필수)

```gpl
Dim ex As New Exception
Try
    ' 코드
Catch ex
    ' ✅ 올바름
    Console.WriteLine(ex.Message())
    Console.WriteLine("ErrorCode: " & CStr(ex.ErrorCode))
    
    ' ❌ 잘못됨
    ' Console.WriteLine(ex.Message)  ' 괄호 없음
End Try
```

### 4.6 공통 개행 문자 (Utils.CRLF 통일)

```gpl
' ✅ 올바름 (통일된 사용)
Dim s As String
s = "Line1" & Utils.CRLF & "Line2"

' ❌ 금지 (각 모듈에서 중복 정의)
' Private Const CRLF As String = Chr(13) & Chr(10)
```

---

## 📌 Part 5: 작업 프로세스 & 체크리스트

### 5.1 파일 추가 시
```
1. [ ] 새 파일 생성 (Module/Class 정의)
2. [ ] Module/Class 선언 및 주석 추가
3. [ ] Test_robot/Project.gpr의 ProjectSource에 추가
4. [ ] docs 폴더에 사용 설명서 작성
5. [ ] custom_prompt.txt에 규칙 추가
6. [ ] 빌드 테스트 실행
```

### 5.2 파일 삭제 시
```
1. [ ] 물리적 파일 삭제
2. [ ] 다른 파일에서 해당 모듈 호출 grep 검색
3. [ ] 호출 코드 모두 제거/리팩토링
4. [ ] Test_robot/Project.gpr의 ProjectSource 항목 제거
5. [ ] 빌드 테스트 실행
```

### 5.3 코드 리뷰 전 체크리스트
```
- [ ] 모든 End 키워드가 대응되는 블록 있는가?
- [ ] 예외 처리(Try/Catch) 완료했는가?
- [ ] 세마포어로 공유 상태 보호했는가?
- [ ] 로그 메시지의 모듈명 일관성 있는가?
- [ ] 공통 개행 (Utils.CRLF) 사용했는가?
- [ ] 함수 주석에 파라미터 설명 있는가?
```

---

## 📌 Part 6: 문제 상황 대응 원칙

### 6.1 컴파일 에러 (GPL 제약 반영)

```gpl
1. 예외 처리
   - Try...Catch...Finally...End Try만 사용
   - Catch 뒤엔 반드시 예외 객체 변수(Catch ex) 지정
   - On Error 구문 사용 금지

2. 메서드 호출
   - 예외 메시지는 ex.Message() 처럼 메서드 형태 (괄호 필수)
   - ErrorCode, RobotError 등 속성은 Try/Catch로 가드

3. 스코프/선언
   - 모든 코드는 Sub/Function/Module 블록 안에만
   - 모듈 스코프 변수는 Private Dim 기본

4. 스레드/락
   - .NET Mutex 대신 Thread.TestAndSet 기반 세마포어
   - 워커 스레드는 started 플래그(TestAndSet)로 1회만 시작

5. 배열
   - 동적 배열(ReDim)은 다른 스레드 접근 불가 상태에서만
```

### 6.2 문제 발생 시 순서

```
1. 즉시 기록
   - 에러 메시지, 라인 번호, 재현 절차 간단히 남기기

2. 최소 재현/격리
   - 최근 수정 파일 범위를 좁혀 원인 후보 줄이기
   - 변경 전후 차이 확인

3. 컴파일러 에러 우선 규칙 적용
   - 위의 "컴파일 에러" 섹션 참고

4. 해결 후 docs에 추가
   - 해결 방법을 docs 폴더에 기록
   - custom_prompt.txt에 유사 오류 방지 규칙 추가
```

---

## 📌 Part 7: 현재 모듈 구성

### 7.1 XML 모듈 최종 구성

```gpl
Test_robot/
├── Core_Main.gpl              [엔트리 포인트]
│
├── Core_ErrorHandler.gpl      [로깅]
├── Core_Utils.gpl             [공통 유틸 - Utils.CRLF, Utils.timeString()]
│
├── Data_XmlStore.gpl          [✅ 핵심 - Class 기반]
│   └── XmlStore
│       - SetValue/GetValue
│       - SaveAsync/SaveSync
│       - LoadFromFile
│       - 메타데이터 자동 추적
│
├── Data_AsyncSave.gpl         [범용 비동기 큐 관리]
│   - Enqueue(path, content)    (XML/DAT 모두 지원)
│   - Flush(timeout)
│   - PendingCount()
│
├── Storage_File_Manager.gpl  [Flash 안전 저장]
│   - SafeSaveFile (임시파일 → 백업 → 원자적 이동)
│   - FileExists/ReadFileContent
│   - RestoreFromBackup
│
├── Net_Tcp_Communication.gpl [TCP/IP 통신]
│
├── Robot_AirSolCylinder.gpl   [공용 액추에이터(포팅)]
   - AirSolCylinderClass: 외부 코드 이식본 (확정성/의존성 최소화 목적)
├── Robot_SimulatedAction.gpl  [시뮬레이션]
│
└── Project.gpr                [⚠️ 필수 - 빌드 설정]
```

### 7.2 XmlStore 사용 예시

```gpl
' 1. 인스턴스 생성
Dim store As New XmlStore

' 2. 경로 설정
store.Path = "/ROMDISK/tmp/data.xml"

' 3. 파일 로드 (있으면 불러오고, 없으면 새로 생성)
store.LoadFromFile()

' 4. 데이터 저장
store.SetValue("key1", "value1")
store.SetValue("timestamp", Utils.timeString())

' 5. 비동기 저장 (권장)
store.SaveAsync()

' 또는 동기 저장
' Dim result As Integer
' result = store.SaveSync()

' 6. 비동기 완료 대기
Data_AsyncSave.Flush(2000)

' 7. 메타데이터 확인
Console.WriteLine("SaveCount: " & CStr(store.GetSaveCount()))
```

---

## 📌 Part 8: 다음 작업 (Core_StringUtils 모듈)

### 설계 목표

```gpl
Split 남발 제한 → IndexOf/Substring 중심 처리
한 번 스캔으로 모든 파싱 완료
안전한 부분 문자열 추출 (SafeSubstring)
설정 파일/프로토콜 파싱 코드 간결화
```

### 구현할 함수들

#### 1. SplitOnce

```gpl
' 첫 구분자만 잘라내기 (key=value 형식)
Function SplitOnce(line As String, sep As String, _
                   ByRef left As String, ByRef right As String) As Boolean
    ' pos = line.IndexOf(sep)
    ' pos < 0 → False
    ' left  = line.Substring(0, pos)
    ' right = line.Substring(pos + Len(sep))
    ' 반환 True
End Function
```

#### 2. SafeTrim / TrimAll

```gpl
Function SafeTrim(s As String) As String
    ' s = Nothing → "" 반환
    ' Else → s.Trim
End Function

Sub TrimAll(ByRef arr() As String)
    ' 모든 arr(i)에 Trim 적용
End Sub
```

#### 3. ParseConfigLine

```gpl
Function ParseConfigLine(line As String, _
                         ByRef key As String, _
                         ByRef value As String) As Integer
    ' SafeTrim(line)
    ' If 시작이 ';' or '#' → 반환 2 (주석)
    ' If 빈 문자열 → 반환 0 (무시)
    ' If SplitOnce(line, "=") 성공 → 반환 1 (키값)
End Function
```

#### 4. Parse1DArray

```gpl
Function Parse1DArray(data As String, _
                      ByRef outVal() As Double) As Integer
    ' tokens = Split(data, ",")
    ' TrimAll(tokens)
    ' 각 token을 Double로 변환
    ' outVal 크기 = tokens 수
    ' 반환 = outVal 크기
End Function
```

#### 5. Parse2DArray

```gpl
Function Parse2DArray(data As String, _
                      ByRef outVal() As Double, _
                      ByRef rows As Integer, _
                      ByRef cols As Integer) As Boolean
    ' rowList = Split(data, ";")
    ' 첫 행에서 ',' split → cols 계산
    ' rows = rowList 개수
    ' outVal 크기 = rows * cols
    ' 2중 루프로 Double 변환
    ' 반환 True/False
End Function
```

#### 6. SafeSubstring

```gpl
Function SafeSubstring(s As String, start As Integer, length As Integer) As String
    ' start < 0 → 0으로 조정
    ' length > 남은 길이 → 남은 길이로 조정
    ' s = Nothing → "" 반환
    ' Substring 반환
End Function
```

#### 7. StartsWith / EndsWith

```gpl
Function StartsWith(s As String, prefix As String) As Boolean
    ' Len(s) < Len(prefix) → False
    ' s.Substring(0, Len(prefix)) = prefix
End Function

Function EndsWith(s As String, suffix As String) As Boolean
    ' Len(s) < Len(suffix) → False
    ' s.Substring(Len(s)-Len(suffix)) = suffix
End Function
```

#### 8. IndexOfAny

```gpl
Function IndexOfAny(s As String, chars As String) As Integer
    ' chars 내 모든 문자 반복
    ' s에서 IndexOf 수행
    ' 최소값 반환 (없으면 -1)
End Function
```

### Core_StringUtils 모듈 활용 컨셉

```gpl
✅ 설정 파일 파싱
   - "key=value" 형식 → SplitOnce
   - 주석/빈줄 필터링 → ParseConfigLine

✅ 데이터 배열 파싱
   - "1,2,3" → Parse1DArray
   - "1,2,3;4,5,6" → Parse2DArray

✅ 프로토콜/로그 분석
   - 상태 체크 → StartsWith/EndsWith
   - 다중 구분자 찾기 → IndexOfAny

✅ 일반 텍스트 처리
   - 안전한 부분 문자열 → SafeSubstring
   - 배열 정규화 → TrimAll
```

---

## 📌 최종 체크리스트 (인수 인계 완료 확인)

```gpl
다음 개발자가 이 문서를 읽고:

- [ ] GPL 언어의 제약 사항 이해했는가?
- [ ] 설계 원칙 5가지 이해했는가?
  (명확성, 정확성, 테스트 가능성, 문서화, 단일 책임)
- [ ] 현재 XML 모듈 구조 파악했는가?
- [ ] Project.gpr의 중요성 이해했는가?
- [ ] 파일 추가/삭제 시 체크리스트 숙지했는가?
- [ ] Try/Catch, TestAndSet 패턴 이해했는가?
- [ ] Utils.CRLF 통일 규칙 이해했는가?
- [ ] 문제 상황 발생 시 대응 프로세스 이해했는가?

위 항목 모두 확인되면 인수 인계 완료! ✅
```

---

## 📞 문의 및 피드백

문제 발생 시:
1. 이 문서의 "문제 상황 대응 원칙" 섹션 참고
2. docs 폴더의 관련 가이드 검색
3. custom_prompt.txt의 최신 규칙 확인
4. 해결 후 docs에 기록하여 나중 참고 자료로 활용

---

**마지막 갱신:** 2025년 12월 9일
**작성자:** GitHub Copilot (GPL 전문가)
**상태:** ✅ 인수 인계 준비 완료
