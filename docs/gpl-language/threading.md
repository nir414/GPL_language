# GPL Thread 클래스 요약 (KR+EN)

본 문서는 Guidance Programming Language(GPL)의 Thread 사용 규칙과 API 패턴을 요약합니다. 코드와 문서는 KR 설명 + EN 식별자 형태로 표기합니다.

## Thread 모델 개요

- 동시 실행: 최대 64개의 program thread 동시 실행
- 스케줄링: 각 thread는 최대 1ms quantum 실행 후 문맥 전환
- 메인 절차: 프로젝트 설정의 main procedure가 시스템에 의해 시작
- 추가 스레드: main이 `New Thread(...)`로 별도 절차를 시작 가능

## StartProcedure 규칙 (핵심)

- 공식 문서(Thread.New) 기준 StartProcedure는 아래 2가지를 지원합니다.
  1) **모듈(Module) 내 Public Sub**
      - 예: `New Thread("Data_AsyncSave.WorkerFunc", , "AsyncSave")`
  2) **클래스(Class) 내 Public Shared Sub** (top-level user class)
     - 예: `New Thread("MyClass.Start")`

위 규칙을 만족하면 클래스/모듈 어느 쪽이든 StartProcedure로 사용할 수 있습니다.

## 생성 시그니처 패턴

- 관찰된 사용 예: `New Thread("StartProcName", <Argument or empty>, "ThreadName")`
  - StartProcName: 문자열로 fully-qualified 모듈.서브 이름
  - Argument: (옵션) 스레드로 전달할 인자(환경에 따라 미사용 가능)
  - ThreadName: (옵션) 스레드 식별자/디버그용 이름
    - **영문자·숫자·`_`만 쓴다.** `New Thread`는 `RWK[0]`·`TCPLSN:4000` 같은 이름도 받고 `Show Thread`에도 그대로 나오지만,
      명령 콘솔의 `Stop <이름>`은 `[`·`]`·`:`가 든 이름을 `-712` *Invalid syntax*로 거부한다(따옴표 인용도 안 됨).
      그런 스레드는 이름으로 멈출 수 없어 프로젝트 단위 정지 뒤에도 남고 `Unload`가 `-750`이 된다
      (2026-10-23 Sample Prep 실측, GPL 4.2K5). 예: `RWK_0`, `TCPLSN_8000`.
  - StackSize를 생략하면 프로젝트 기본값(관측 4 KB)이 잡힌다(`Show Thread -stack`, 2026-10-23 실측).

## 공통 API 및 유틸리티

- Thread.TestAndSet(lockVar, 1): interlock(세마포어) 구현에 사용
- Thread.Sleep(ms): 양보(yield) 또는 대기(backoff) 구현

### 세마포어 패턴 (요약)

```vb
Public Sub acquire_sem(ByRef sem_var As Integer)
    While Thread.TestAndSet(sem_var, 1) <> 0
        Thread.Sleep(0)
    End While
End Sub

Public Sub release_sem(ByRef sem_var As Integer)
    sem_var = 0
End Sub
```

## 베스트 프랙티스

- Ensure() idempotent: worker 1회만 시작 (TestAndSet으로 started 플래그 보호)
- Flush(timeout): 종료 시 큐 drain 대기 제공
- 문자열/배열 조작은 항상 interlock 보호
- 디버그 로그는 rate limit 적용 또는 developer flag로 제한

## 예제 모음

1. Data_AsyncSave worker 시작

```vb
Private Dim worker As Thread = New Thread("Data_AsyncSave.WorkerFunc", , "AsyncSave")
```

1. TcpCommunication worker 시작 (Class Public Shared Sub)

```vb
Private Dim tcpThread As Thread = New Thread("TcpCommunication.TcpCommunicationThreadFunc", , "TCPCOM")
```

1. TcpCommunication module-level entry

```vb
' Module TcpCommunicationModule
Public Sub TcpCommThreadEntry()
    TcpCommunication.TcpCommunicationThreadFunc()
End Sub
```

## 주의사항

- 동적 배열(ReDim)과 문자열 변경은 race에 취약 → interlock 필수
- read-modify-write(증감/누산)는 절대로 락 없이 수행하지 말 것
- StartProcedure는 **모듈 Public Sub** 또는 **클래스 Public Shared Sub** 중 하나로 노출
- **기본 스택 4 KB 는 파일 저장·깊은 파서 호출을 하는 스레드에는 모자랄 수 있다(`-755 Thread stack too small`).**
  2026-11-06 Sample Prep 실측: 명령 펌프 스레드(TCPCMD, 프로젝트 기본 4 KB)가 저장 호출(`AponTree.Save`)을 돌리다 `Show Thread TCPCMD -stack` 최대 3.984 / 4.000 KB 에서 -755 가 났고,
  `Thread` 생성자에 8 KB 를 주자 같은 작업이 4.148 KB 로 성공했다. 같은 머신의 TCPCLI 스레드도 4 KB 중 3.25 KB 를 썼다.
  문서상 [language_errors.htm](https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Error_Code/language_errors.htm)은 스택보다 많이 쓰면 생성자로 늘리라 하고,
  [Thread/new.htm](https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Thread/new.htm)은 `stack_size` 를 KB 로 받는다.
  스택은 KB 그대로 메모리를 쓰므로([memory-costs](memory-costs.md) §4) 실측 최대 사용량을 보고 필요한 만큼만 늘린다.
- **잠금(`Acquire`)을 잡은 뒤 예외를 던질 수 있는 호출이 있으면 해제는 `Finally` 에 둔다.** 2026-11-06 Sample Prep 실측: `AponTree.Save` 가 잡은 쓰기 잠금을
  예외 경로(-755)에서 풀지 않아 뒤따른 펌프 스레드가 `SNC Acquire` 에서 영영 멈췄다(큐 명령 4000개 전부 무응답, 2회 재현).
  `-755` 도 `Finally` 를 실행하므로([common-mistakes](common-mistakes.md) Try…Finally 절) `Try … Finally : Release : End Try` 로 감싸면 풀린다.
  이 잠금 누수는 정적 진단으로 잡지 않는다(호출이 던질 수 있는지 정적으로 알 수 없어 소음이 크다).

## 연결 문서

- `docs/Project/GPL_THREAD_SAFETY.md` (스레드 안전 가이드)
- `.copilot/custom_prompt.txt` (문제·정책·치트시트)
