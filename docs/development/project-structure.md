# Test_robot 프로젝트 구조 (v2 - 전문가 수준 재설계)

## 🏗️ 모듈 분류 체계

### Core Layer (핵심 유틸)
**목적:** 모든 모듈이 공유하는 기본 기능 제공

```
Core_ErrorHandler.gpl     [로깅/에러 핸들링]
- logWithContext()
- logException()
- logErrorMessage()

Core_Utils.gpl            [공통 상수/함수]
- timeString()
- CRLF (개행 상수)

Core_StringUtils.gpl      [문자열 파싱/처리]
- SplitOnce()
- SafeTrim(), TrimAll()
- ParseConfigLine()
- Parse1DArray(), Parse2DArray()
- SafeSubstring()
- StartsWith(), EndsWith()
- ParseJsonArray()       ← 최적화 2-Pass
```

---

### Persistence Layer (데이터 영속성)
**목적:** 파일 저장/로드 및 포맷 관리

#### IO (저수준 파일 I/O)
```
Storage_File_Manager.gpl [Flash 안전 저장]
- SafeSaveFile()           (임시파일 → 백업 → 원자적 이동)
- FileExists()
- ReadFileContent()
- RestoreFromBackup()
- DeleteFileWithBackup()
```

#### Data_AsyncSave (범용 비동기/동기 저장 큐) ⭐ 계층 통합
```
Data_AsyncSave.gpl        [파일 I/O 래퍼]
- Enqueue(path, content)   (비동기 저장 → 큐)
- SaveSync(path, content)  (동기 저장, 즉시 반환) ← 래퍼
- ReadFile(path)           (파일 읽기) ← 래퍼
- FileExists(path)         (파일 존재 확인) ← 래퍼
- RestoreFromBackup(path)  (백업 복구) ← 래퍼
- Flush(timeout)
- PendingCount()

주요 변경:
        • XmlStore/DatStore가 Storage_File_Manager를 직접 호출하지 않음
  • 모든 파일 I/O가 Data_AsyncSave를 통과 (계층 통합)
        • Storage_File_Manager는 Data_AsyncSave 내부에서만 사용
```

#### Store (저수준 포맷 저장소)
```
Data_XmlStore.gpl         [XML 키-값 저장소]
- XmlStore 클래스
  - SetValue/GetValue()
  - SaveAsync/SaveSync()
  - LoadFromFile()
  - 메타데이터 추적

Data_DatStore.gpl         [DAT 키-값 저장소]
- DatStore 클래스
  - SetValue/GetValue()
  - GetArrayValue()        (JSON 배열 파싱)
  - SaveAsync/SaveSync()
  - LoadFromFile()
  - 메타데이터 추적
```

---

### Network Layer (통신)
```
Net_Tcp_CommandQueue.gpl    [TCP 수신 라인 전달 큐]
- 채널(sourceIndex)별 고정 크기 ring buffer
- producer: Net_Tcp_Communication
- consumer: Entry_Main(또는 메인 루프)

추가(객체화):
- 채널별 큐 상태를 `TcpCommandQueueChannel` 객체로 캡슐화
- `Net_Tcp_CommandQueue.GetChannel(i)`로 채널 객체를 얻어 `q.TryDequeue(line)` 형태로 polling 가능
- `Net_Tcp_Communication.TcpCommunication` 생성 시 `tcp.Queue` 프로퍼티로 채널 큐를 바인딩

Net_Tcp_SocketSend.gpl      [TCP 송신 래퍼]
- per-socket lock(Thread.TestAndSet 기반) + best-effort send
- CRLF 라인 전송 유틸 포함
- 세션 객체화를 위한 소켓 기반 오버로드 제공:
    - SendSocket(sock, data, sendLock)
    - SendSocketLine(sock, line, sendLock)

Net_Tcp_SocketReceive.gpl   [TCP 수신 래퍼]
- Receive 예외 처리/디버그 로그 정책 분리
- CRLF split(라인 파싱)은 호출자에서 수행

Net_Tcp_CommandHandler.gpl  [수신 라인 파싱/분기]
- PING/HELP/ECHO/QUEUE 등 built-in command 처리 결정
- 실제 송신/큐 적재는 호출자(Net_Tcp_Communication)에서 수행

Net_Tcp_ServerLoop.gpl      [TCP 서버 루프 + 세션 객체]
- accept/session/receive/CRLF split
- TcpSession 클래스(연결별 상태 캡슐화): Ip/Port/Socket/EchoMode/Queue + Send/Close

Net_Tcp_Communication.gpl   [TCP 세션/스레드 오케스트레이션]
- 세션(slot) 할당 및 TcpSession 배열 관리
- worker thread 시작 및 ServerLoop 호출
- 외부 API: Reply/ReplyLine/StopAll 등 (내부적으로 session.Send/Close로 위임)
```

---

### Robot Layer (로봇 제어)
```
Robot_AirSolCylinder.gpl  [공용 액추에이터(포팅) - AirSolCylinderClass]
Robot_SimulatedAction.gpl [시뮬레이션]
```

- `Robot_AirSolCylinder.gpl`은 외부 프로젝트에서 이식한 `AirSolCylinderClass`를 보관합니다.
    - 목적: 외부 의존성을 줄이고, 이 저장소 단독으로 재현 가능한(확정성) 동작을 확보
    - 포팅 규칙: `Or`/`And` 단락평가 미보장 가능 → 조건을 단계적으로 평가(가드 후 API 호출)

---

### Application Layer (애플리케이션)
```
Entry_Main.gpl            [엔트리 포인트]
- MAIN()
```

---

## 📊 의존성 관계 (Dependency Graph) - 계층 통합 후

```
Entry_Main
├── Core_ErrorHandler
├── Core_Utils
├── Core_StringUtils
│
├── Net_Tcp_Communication
│   ├── Net_Tcp_CommandHandler
│   ├── Net_Tcp_CommandQueue
│   ├── Net_Tcp_SocketReceive
│   └── Net_Tcp_SocketSend
│
├── Data_XmlStore
│   ├── Core_StringUtils
│   ├── Core_ErrorHandler
│   └── Data_AsyncSave  ← 모든 파일 I/O 여기를 통과
│
├── Data_DatStore
│   ├── Core_StringUtils
│   ├── Core_ErrorHandler
│   └── Data_AsyncSave  ← 모든 파일 I/O 여기를 통과
│
└── Data_AsyncSave
    ├── Core_ErrorHandler
    └── Storage_File_Manager  ← 저수준 I/O 전담

Robot_SimulatedAction
└── Core_ErrorHandler

👉 변경점:
    • XmlStore/DatStore가 Storage_File_Manager를 직접 호출하지 않음 (이전: 직접 호출)
    • Storage_File_Manager는 Data_AsyncSave 내부에서만 사용
   • 계층이 명확히 분리됨 (Layer Separation)
```

---

## 🔄 Persistence Flow (데이터 저장 흐름)

### XmlStore 기반
```
XmlStore.SetValue()
    ↓
XmlStore.SaveAsync()
    ↓
Data_AsyncSave.Enqueue(path, xml)
    ↓
[비동기 워커 스레드]
    ↓
Storage_File_Manager.SafeSaveFile()
    ├─ 1) 임시파일에 쓰기 (ROMDISK)
    ├─ 2) 백업 생성 (.bak)
    └─ 3) 원자적 이동 (temp → final)
    ↓
메타데이터 업데이트 (SaveCount, LastSaveTime)
```

### DatStore 기반
```
DatStore.SetValue("key", "value")
    ↓
DatStore.SetValue("Position", "[1,2,3]")  ← JSON 배열
    ↓
DatStore.SaveAsync()
    ↓
[동일한 Data_AsyncSave 공용 큐 사용 (구 XmlAsyncSave)]
    ↓
Storage_File_Manager.SafeSaveFile()
    ↓
메타데이터 업데이트
```

---

## 📝 Project.gpr 구성 순서 (로드 순서)

```
1. GModule.gpo            (외부 라이브러리)
2. Core_SpinLock          (동시성 유틸)
3. Core_ErrorHandler      (의존성: 거의 모든 모듈)
4. Core_Utils             (의존성: 거의 모든 모듈)
5. Core_StringUtils       (의존성: Core_ErrorHandler, Core_Utils)
6. Storage_File_Manager   (의존성: Core_ErrorHandler)
7. Net_Tcp_CommandQueue   (의존성: Core_Utils/Core_StringUtils)
8. Net_Tcp_SocketSend     (의존성: Core_Utils)
9. Net_Tcp_SocketReceive  (의존성: Core_ErrorHandler)
10. Net_Tcp_Session       (의존성: 위 TCP 모듈들)
11. Net_Tcp_CommandHandler (의존성: Core_StringUtils)
12. Net_Tcp_ServerLoop     (의존성: 위 TCP 모듈들)
13. Net_Tcp_Communication  (의존성: 위 TCP 모듈들)
14. Data_AsyncSave         (의존성: Core_ErrorHandler, Storage_File_Manager)
15. Data_XmlStore          (의존성: ↑ 모두)
16. Data_DatStore          (의존성: ↑ 모두)
17. Robot_AirSolCylinder   (의존성: Core_ErrorHandler)
19. Robot_SimulatedAction (의존성: Core_ErrorHandler)
20. Entry_Main            (엔트리 포인트, 마지막)
```

---

## 🎯 모듈별 책임 (SOLID 원칙)

| 모듈 | 단일책임 | 확장성 | 테스트 |
|------|--------|--------|--------|
| Core_ErrorHandler | 로깅만 | ✅ 좋음 | ✅ 쉬움 |
| Core_StringUtils | 문자열 처리만 | ✅ 좋음 | ✅ 쉬움 |
| Storage_File_Manager | 파일 I/O만 | ✅ 좋음 | ⚠️ 어려움 |
| Data_AsyncSave | 비동기 큐만 | ✅ 좋음 | ⚠️ 어려움 |
| Data_XmlStore | XML 포맷 관리 | ✅ 좋음 | ✅ 쉬움 |
| Data_DatStore | DAT 포맷 관리 | ✅ 좋음 | ✅ 쉬움 |

---

## 🔒 스레드 안전성 보장

### Shared State 보호 (Thread.TestAndSet(TAS) 기반 스핀락/락)

```
Data_AsyncSave
├── q_lock (큐 접근 보호; TAS 기반 스핀락)
└── started (락이 아니라, 1회 시작 보장용 원자적 플래그)

Data_XmlStore
└── 불변 (각 인스턴스가 독립적)

Data_DatStore
└── 불변 (각 인스턴스가 독립적)

Net_Tcp_CommandQueue
└── q_lock(channel별) / rr_lock / overflow_lock (TAS 기반 스핀락)
```

### 스레드 패턴

- **Core_* 모듈**: 상태 없음 (stateless) → 안전
- **XmlStore/DatStore**: 인스턴스별 격리 → 안전
- **Data_AsyncSave**: 세마포어 보호 → 안전

---

## 📌 Key Design Decisions

1. **Why Data_AsyncSave (not XmlAsyncSave)?**
   - XML/DAT 모두 지원하는 범용 큐
   - 향후 JSON, CSV 등 포맷 추가 가능

2. **Why 2-Pass JSON Parser?**
   - O(n²) → O(n) 성능 개선
   - ReDim Preserve 제거로 메모리 효율 향상

3. **Why Circular Queue in AsyncSave?**
   - 고정 메모리 사용 (메모리 누수 방지)
   - 임베디드 시스템 특성 고려

4. **Why Separate XmlStore & DatStore?**
   - 각 포맷의 특성 반영 (XML은 구조적, DAT는 단순)
   - 향후 파일 포맷 변경 시 영향 최소화

---

## 🚀 향후 확장 가능성

```
향후 추가 가능:
├── JsonStore.gpl         (JSON 포맷)
├── CsvStore.gpl          (CSV 포맷)
├── Data_CacheLayer.gpl   (메모리 캐시)
├── Data_Compression.gpl  (압축)
└── Monitoring/
    ├── Metrics.gpl       (성능 지표)
    └── HealthCheck.gpl   (헬스 체크)
```

모든 새 포맷은 `Data_AsyncSave`와 통합 가능하도록 설계!

---

**최종 목표:** 
- ✅ 단일책임 원칙 (SRP)
- ✅ 개방-폐쇄 원칙 (OCP)
- ✅ 의존성 역전 원칙 (DIP)
- ✅ 스레드 안전성
- ✅ 확장 가능한 아키텍처
