# GPL 스레드 안전(Thread-Safety) 가이드

본 문서는 GPL(Guidance Programming Language)에서의 스레드 안전 개념과 주의사항, 그리고 실전 패턴(세마포어 Interlock)을 요약합니다. 마지막에는 본 리포지토리의 Data_AsyncSave/XmlStore(Data_XmlStore) 설계에 어떻게 적용하는지 팁을 덧붙입니다.

## 1) 스레드 전환과 데이터 경합

운영체제는 여러 사용자 프로그램 스레드를 시분할로 실행합니다. 명령 수행 도중에도 스레드가 교체될 수 있어, 두 스레드가 같은 데이터를 동시에 읽고/쓰면 예상치 못한 결과(잃어버린 업데이트)가 발생할 수 있습니다.

예: a = 0에서 두 스레드가 각각 a = a + 1 수행 시, 최종 a가 2가 아닌 1이 되는 경쟁 조건 발생.

## 2) GPL의 타입별 스레드 안전성

- 숫자/불리언 읽기: 항상 스레드-세이프(누군가가 쓴 값 중 하나를 읽음)
- 숫자 단순 쓰기: 스레드-세이프(최종값은 누군가 쓴 값 중 하나)
- 읽고-쓴다(read-modify-write) 연산: 비-세이프 (증감, 누산 등)
- 묶음 데이터(배열/객체 복합 필드): 비-세이프 (부분 갱신을 볼 수 있음)
- 문자열: 비-세이프 (읽는 중 쓰기 발생 시 깨진 문자열 가능). 단순 대입은 세이프
- 동적 배열(ReDim): 비-세이프. 다른 스레드가 접근 중 사이즈 변경 시 크래시 위험

## 3) 세마포어로 Interlock 만들기

Thread.TestAndSet를 이용해 간단한 스핀락(semaphore)을 구현할 수 있습니다.

```vb
' 잠금: 1 설정에 성공할 때까지 반복
Public Sub acquire_sem(ByRef sem_var As Integer)
    While Thread.TestAndSet(sem_var, 1) <> 0
        Thread.Sleep(0)
    End While
End Sub

' 잠금 해제
Public Sub release_sem(ByRef sem_var As Integer)
    sem_var = 0
End Sub
```

예시: 숫자 누산 보호

```vb
Public my_lock As Integer
Public my_array(1) As Integer

Public Sub AddArray(ByVal inc As Integer)
    acquire_sem(my_lock)
    my_array(0) = my_array(0) + inc
    release_sem(my_lock)
End Sub
```

예시: 문자열 읽기/쓰기 보호

```vb
Public my_lock As Integer

Public Sub AppendString(ByRef sg As String, ByVal app As String)
    acquire_sem(my_lock)
    sg &= app
    release_sem(my_lock)
End Sub

Public Function ReadString(ByRef sg As String) As String
    Dim ret_string As String
    acquire_sem(my_lock)
    ret_string = sg
    release_sem(my_lock)
    Return ret_string
End Function
```

## 4) Data_AsyncSave/XmlStore(Data_XmlStore)에의 적용 팁

- 공유 상태(큐 인덱스/카운터, 경로/XML 버퍼)는 반드시 Interlock으로 보호
- 문자열 큐에 넣기/빼기, 인덱스 갱신은 acquire_sem / release_sem 범위 내에서 실행
- 동적 배열은 피하고 고정 길이(원형 큐)를 사용
- 시작/중지 제어는 상태 플래그도 Interlock으로 관리
- 읽기 전용 조회(PendingCount)는 반드시 락을 걸어 일관성 보장

### 권장 보강 사항

- Ensure(): 워커 스레드가 정확히 1회만 시작되도록 상태 플래그를 TestAndSet로 보호
- Flush(timeout): 큐가 빌 때까지 대기하는 API 제공 (테스트/종료 단계 유용)
- TryEnqueue(): 큐 풀 시 버리기 정책 대신 실패를 호출자에 알리거나 최신만 유지하는 정책 분리
- 로그 최소화: 워커 루프 내 과도한 콘솔 출력은 속도 저하. 레이트 리밋 또는 디버그 모드 사용

---

본 문서는 제공된 벤더 문서 조각을 바탕으로 정리되었으며, 본 리포지토리 코드 스타일(원형 큐, 세마포어)을 기준으로 작성되었습니다.

## 부록 A: 벤더 문서 기반 스레드 모델 요약

- 동시 실행: 최대 64개의 GPL program thread 동시 실행.
- 스케줄링: 각 thread는 최대 1ms 동안 실행 후 다음 ready thread로 전환.
- 메인 절차: 프로젝트 설정의 main procedure가 시스템/인터페이스에 의해 시작.
- 추가 스레드: main procedure가 독립 thread로 추가 절차를 시작할 수 있음.

### Thread 시작 규칙(중요)

- 공식 문서(Thread.New) 기준, 스레드 시작 프로시저는 아래 중 하나여야 함
    - "모듈 레벨 Public Sub"
    - "클래스 레벨 Public Shared Sub" (top-level user class)

예시:

```text
New Thread("Data_AsyncSave.WorkerFunc", , "AsyncSave")   ' Module Data_AsyncSave 내 Public Sub
New Thread("TcpCommunication.TcpCommunicationThreadFunc", , "TCPCOM") ' Class TcpCommunication 내 Public Shared Sub
```

우회(모듈 wrapper Sub 사용):

```vb
' Module TcpCommunicationModule
Public Sub TcpCommThreadEntry()
        TcpCommunication.TcpCommunicationThreadFunc()
End Sub
```

### Thread.TestAndSet 요약

- 목적: 공유 데이터에 대한 atomic read-modify-write 보장.
- 패턴: `acquire_sem`/`release_sem`로 스핀락 구현, 숫자 누산/문자열 조작/큐 인덱스 갱신 보호.

### 안전하지 않은 연산 예시(주의)

- read-modify-write(증감, 누산), 묶음 데이터 부분 갱신, 문자열 변경, ReDim 등은 interlock 없이는 안전하지 않음.

