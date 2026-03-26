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

## 연결 문서

- `docs/Project/GPL_THREAD_SAFETY.md` (스레드 안전 가이드)
- `.copilot/custom_prompt.txt` (문제·정책·치트시트)
