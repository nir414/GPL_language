# Changelog

이 프로젝트의 주요 변경 사항은 이 파일에 기록한다.

## [0.6.0] - 2026-05-29

### Changed

- 패키징 버전을 `0.6.0`으로 재정렬했습니다.
- npm/VS Code SemVer 호환성을 유지하기 위해 실제 버전 문자열에는 16진수 리터럴 표기 대신 `major.minor.patch` 형식을 유지합니다.

## [0.5.109] - 2026-05-29

### Changed

- FTP Run은 기본적으로 Compile 전에 `Load <resolvedPath>`를 선행하지 않도록 변경했습니다.
- 필요한 환경에서만 `gpl.controller.ftpRunLoadBeforeCompile=true`로 Load 선행 동작을 켤 수 있도록 설정을 추가했습니다.

## [0.5.108] - 2026-05-29

### Fixed

- FTP Run이 `/GPL/<project>`와 `/flash/projects/<project>` 사이에서 오래된 `/GPL` 복사본을 선택할 수 있던 경로 정합성 문제를 완화했습니다.
  - 설정된 `gpl.controller.ftpFlashProjectsPath`에 같은 프로젝트가 있으면 Flash Projects 경로를 우선 사용합니다.
  - Compile 전에 `Load <resolvedPath>`를 명시적으로 수행해 컴파일 대상 복사본을 확정합니다.

## [0.5.107] - 2026-05-29

### Fixed

- FTP Run의 `Compile <project>` 경로에도 STATUS 누락 보강 판정을 적용했습니다.
  - `Compile successful` 마커가 있으면 성공으로 처리합니다.
  - pass 로그만 있고 STATUS가 없으면 `Show Thread` 후속 정상 응답으로 성공 여부를 보강 판정합니다.
- FTP Run Compile 응답의 RAW preview와 불완전 수신 메타 로그를 출력해 `STATUS -9999 No STATUS found` 분석성을 개선했습니다.

## [0.5.106] - 2026-05-29

### Changed

- 디버깅 중 `F9`로 Continue를 실행할 수 있도록 기본 키바인딩을 추가했습니다.
- hover/watch 변수 평가에 짧은 TTL 캐시를 추가해 같은 변수의 반복 조회 응답성을 개선했습니다.
- GPL Controller 뷰의 연결 상태 상단 액션에서 Disconnect 위치를 `Stop -all`로 교체했습니다.

## [0.5.105] - 2026-05-29

### Changed

- `GPL: Send Command to Controller` 입력 가드를 추가해 XML 형식, `Show Project`, `Directory` 단독 호출을 감지하고 올바른 plain command 사용을 안내합니다.
- README와 console command reference에 1402 wire format(plain text + CRLF), `Directory <path>`, `STATUS -505/-714` 해석을 보강했습니다.

## [0.5.102] - 2026-05-28

### Fixed

- **디버거 안정성 — 제어기 단일 명령 스트림 가정 강화**: 폴링이 사용자 명령보다 1402 큐를 점유해 Step/Continue 반응이 지연되던 문제 수정
  - 사용자 액션(step/continue/pause/disconnect) 진행 중에는 `Show Thread` 폴링을 보류 (`_userActionInFlight` 가드)
  - 명령 간 최소 idle gap(정상 15ms / 실패 후 100ms) 도입으로 매 명령 connect/close 부담을 분산 → ECONNRESET/idle EOF 빈도 감소
- **Continue 후 오정지 해소**: paused→paused 2회 휴리스틱 대신 "Running 한 번이라도 관측 + 다시 Paused" 명시적 상태 전이로 정지 이벤트 발사
  - Continue 직후 폴 누락으로 인해 직전 정지 상태를 새 BP 도달로 오인하던 케이스 제거

### Changed

- **Disconnect 시 자동 `Stop <project>` 호출 제거**: 디버거 분리는 "VS Code 측 세션 종료"만 의미하며 제어기 측 프로젝트 실행은 보존
  - 좀비 쓰레드 정리는 사용자가 명시적으로 `GPL: 모든 쓰레드 중지` / 개별 쓰레드 중지 명령을 사용해야 함
  - 브레이크포인트 정리는 그대로 수행

## [0.5.101] - 2026-05-20

### Changed

- GPL 문법 하이라이팅 확장: 표준 TextMate 스코프 기반으로 선언부/타입명 색상을 강화
  - `Class`, `Module`, `Sub`, `Function`, `Property`, `Const` 선언 이름에 의미 스코프 부여
  - `As Type`, `New TypeName` 위치의 타입명도 별도 스코프로 표시
  - 커스텀 전용 스코프보다 테마 호환성이 좋은 표준 계열(`entity.name.*`, `storage.type.*`, `storage.modifier.*`) 우선 사용

## [0.5.100] - 2026-05-20

### Fixed

- `Go to Definition`이 `Public Shared steps() As StepBatch` 같이 `Dim` 없는 `Shared` 배열 선언을 심볼 캐시에 인덱싱하지 못하던 문제 수정
  - 파서에 `Public/Private Shared name() As Type` 패턴 분기가 없어 해당 선언이 파싱에서 누락되었음

## [0.5.99] - 2026-05-20

### Fixed

- `Find All References`가 `steps(i).RunZeroStep(...)` 같은 배열/인덱서 기반 클래스 멤버 호출을 놓치던 문제 수정
  - 기존 참조 검색 패턴이 `obj.Member` 형태만 주로 인식해 `arr(index).Member`, `arr(0)(1).Member`, `foo.bar(i).Member` 호출이 누락될 수 있었음
  - 멤버 접근 정규식을 확장해 인덱서/체이닝이 포함된 qualifier도 검색 대상으로 포함

## [0.5.95] - 2026-05-18

### Changed

- 배포 COMPILE 단계에서 `STATUS -742/-746/-752`가 발생하고 컴파일 에러가 파싱되지 않은 경우 자동 1회 재시도
  - 일시적인 컨트롤러 상태 변동으로 인한 간헐 실패를 완화
  - 실제 컴파일 에러가 있는 경우는 즉시 실패 처리 유지

## [0.5.98] - 2026-05-20

### Fixed

- GPL 문법: `Public Class ClassName` 형태에서 클래스 이름이 무색이던 문제 수정
  - 원인: 내장 VB.NET 문법의 `storage.type.asp` 패턴이 `\\s*` 접두로 `Class` 이전 공백부터 매칭 선점
  - 수정: 클래스 선언 패턴에 `\\s*` 추가로 동일 위치 경쟁 시 GPL 패턴 우선 적용

## [0.5.97] - 2026-05-20

### Changed

- GPL 문법 하이라이팅: `Class` / `Module` 선언 이름에 `entity.name.type` 스코프 부여
  - `Class StepData` → `StepData`가 타입 이름 색상으로 표시됨
  - `Module AutoAging` → `AutoAging`이 모듈 이름 색상으로 표시됨

## [0.5.96] - 2026-05-18

### Fixed

- `Deploy (Build Only)` / `Deploy & Run`의 COMPILE 대상 동기화 강화
  - 업로드 후 COMPILE 전에 대상 프로젝트를 `Unload -> Load(/flash/projects/<project>)`로 강제 동기화
  - 이미 로드된 `/GPL/<project>`의 구버전 복사본을 컴파일해 과거 오류가 재발견되는 오판정 가능성을 완화

## [0.5.94] - 2026-05-18

### Changed

- 1403 무출력 종료를 `Immediate EOF / Idle timeout / Empty batch`로 분리 판정
  - `Idle timeout`(기본 1500ms 이상 유지 후 payload 없이 종료)은 정상 이벤트 대기 폴링으로 처리
  - 정상 idle 세션이 `noPayloadStreak`에 누적되어 `UNSTABLE`로 과대 경보되는 문제를 완화
- `Idle timeout` 경로 재연결은 고정 idle 지연(기본 5000ms)으로 유지
  - 빈 세션 누적만으로 재연결 지연이 30000ms까지 커지는 현상을 줄여 가시성과 반응성 균형 개선

## [0.5.93] - 2026-05-18

### Changed

- 1403 세션에서 payload가 없어도 `GPL Console` 채널에 상태 힌트를 출력하도록 개선
  - `CONNECTED_NO_PAYLOAD`, `Immediate EOF` 폴링, `no-payload streak` 상황을 `[RT] [1403] ...` 라인으로 표시
  - 런타임 이벤트가 없는 구간에서도 콘솔이 완전히 비어 보이지 않아 운영자가 상태를 즉시 판단 가능

## [0.5.92] - 2026-05-18

### Changed

- `GPL: Deploy (Build Only)`가 오류/시스템 경고 없이 정상 완료되면 `GPL Console` 채널을 자동으로 표시
  - 1403 런타임 콘솔 연결 직후 출력 확인 동선 단축

## [0.5.91] - 2026-05-18

### Performance

- **1403 재연결 루프 완화(2차)**: `RuntimeConsole.start()` 기본 경로가 대기 중 재연결 타이머를 취소하지 않도록 조정
  - 자동 `ensure/start` 호출로 `RECONNECT timer canceled by explicit start()`가 반복되며 connect/close가 가속되는 패턴을 억제
  - no-payload/immediate-EOF 누적 streak 카운터가 자동 호출마다 리셋되지 않도록 보존해 적응형 지연 정책이 안정적으로 작동

### Changed

- 사용자 명령(`gpl.console.start`, `gpl.console.ensure`)만 강제 즉시 재연결 옵션을 사용하도록 분리
  - 수동 액션 반응성은 유지
  - 내부 자동 경로는 비침습(idempotent) 유지

## [0.5.90] - 2026-05-18

### Performance

- **디버그 폴링 부하 완화**: 디버그 세션의 `Show Thread` 폴링 간격을 사용자 설정(`gpl.controller.threadPollIntervalMs`) 기반으로 적용하고, 안전 범위(1000~5000ms)로 제한
  - 기존처럼 500ms로 강제되지 않아 1402 트래픽 스팸을 크게 줄임
  - `Step/Continue` 즉시성은 기존 `_fastPoll` 및 1403 데이터 트리거 경로로 유지
- **1403 장기 no-payload 루프 완화**: `Immediate EOF` 재연결 최대 지연 기본값을 `5000ms -> 15000ms`로 상향
  - 장시간 이벤트 부재 구간에서 불필요한 connect/close 반복 빈도를 낮춤

### Added

- attach 시 적용된 디버그 폴링 간격(`user/effective`)을 Debug Console에 기록해 현장 진단 가시성 강화

## [0.5.89] - 2026-05-15

### Performance

- **디버그 응답성 대폭 개선**: `Step -over` 실행 중 직렬 큐 혼잡 문제 해결
  - `pendingAction`이 `step`/`continue`인 동안 `stackTraceRequest`, `variablesRequest`, `evaluateRequest`에서 TCP 명령을 전송하지 않고 즉시 반환 (캐시 프레임 또는 빈 결과)
  - 이로써 Watch 패널/변수 패널의 자동 폴링이 직렬 큐를 막지 않아 `Show Thread` 폴링 지연 해소
  - 예상 step latency: 5~8초 → 1~2초
- **1403 이벤트 즉시 폴 트리거**: `RuntimeConsole.onDidReceiveData` 이벤트 추가
  - 1403에서 raw 데이터(step 완료 `<E>N,N</E>` 포함) 수신 시 `fireDebugPollTrigger()` 호출
  - 디버그 세션이 즉시 `_pollThreadStates()` 실행 → 폴링 타이머 대기 없이 StoppedEvent 발송
- **`_cachedFrames`**: `_getThreadFrames()` 결과를 쓰레드별로 캐싱, step 실행 중 직전 위치 정보 제공
- **`_fastPoll` 경량화**: 5회×300ms → 2회×500ms (1403 즉시 트리거가 백업을 담당)

## [0.5.88] - 2026-05-14

- 디버그 CALL STACK 패널의 쓰레드 항목에 실시간 상태 표시 추가
  - 형식: `ThreadName  [▶ Running]`, `ThreadName  [⏸ Break]`, `ThreadName  [⚠ Error]` 등
  - 상태 변경 시 `InvalidatedEvent(['threads'])` 전송 → VS Code가 자동으로 쓰레드 목록 갱신

## [0.5.87] - 2026-05-14

- `Show Thread` 폴링을 고정 주기 `setInterval`에서 적응형 `setTimeout` 재귀 방식으로 교체
- 실행 중인 쓰레드가 없을 때(idle) 폴링 간격을 기본값의 3배로 자동 지연해 제어기 1402 포트 부하 감소
- 쓰레드가 감지되면 즉시 `threadPollIntervalMs` 설정 주기로 복귀

### Added

### Changed

### Fixed

### Removed

## [0.5.86] - 2026-05-14

- 1403 콘솔 트리 항목을 `상태 + 최근 payload/재연결 요약` 중심으로 재구성해 한 줄에서 현재 상황을 더 바로 읽을 수 있게 개선
- 1403 항목 툴팁에 마지막 연결 시도, payload, 오류 코드, 재연결 대기 정보를 묶어 표시
- 상태 뷰 상단과 1403 항목 hover 액션에 `GPL Traffic` 버튼을 추가해 트래픽 채널을 바로 열 수 있게 개선

## [0.5.85] - 2026-05-14

- 사이드바 연결 섹션에서 `1403 콘솔 상태`와 `1403 연결/재연결/로그 보기`를 하나의 클릭 가능한 항목으로 병합
- 병합된 1403 항목에 현재 상태, 상세 사유, 포트 정보, 클릭 동작 안내를 함께 표시해 UI를 더 간결하게 정리

## [0.5.84] - 2026-05-14

- 1403 런타임 콘솔 상태를 `connecting / connected-no-payload / reconnecting / connect-failed` 등으로 세분화하고, 마지막 연결 시도/마지막 payload/최근 오류 코드 같은 증거를 스냅샷에 포함
- `GPL: Start Runtime Console`, `1403 연결/재연결/로그 보기`, 포트 핑 UX를 개선해 `연결됨이지만 payload 없음`과 `연결 거부/재연결 대기`를 구분해 안내
- 진단 스냅샷과 사이드바 연결 섹션에 1403 관찰 증거와 가설(예: ECONNREFUSED, 빈 세션)을 함께 표시해 제어기 문제와 UI/표시 문제를 분리 진단하기 쉽게 개선

## [0.5.83] - 2026-05-13

- COMPILE 응답에 `<STATUS>`가 누락되어도 `Compile successful` 문자열이 있으면 성공으로 판정하도록 개선
- COMPILE 응답이 pass 로그 중심(DATA-only)이고 STATUS 미검출인 경우 즉시 `-9999` 실패 처리하지 않고, 짧은 보강 수신 window 후 `Show Thread` 1회 보강 판정을 수행하도록 개선
- `Compile by name -> -508` 이후 `Load <absolute FTP path>` + COMPILE 성공 시 `-508`을 최종 실패 원인에서 제외하고 전처리 경고로만 기록
- COMPILE 원문 로그에 미완 응답 진단 메타(`responseComplete`, `bytesReceived`, `lastChunkAt`, `idleTimeoutMs`) 출력 추가

## [0.5.82] - 2026-05-12

- 배포 경로 자동 판별 추가: `/flash/projects`와 `/GPL`를 프로빙해 프로젝트 폴더 존재 기준으로 우선 경로를 선택하고 배포에 사용
- 배포 결과/알림에 선택된 원격 경로를 명시해 현재 어떤 경로로 컴파일/실행했는지 즉시 확인 가능
- 스냅샷 강화: `Error Thread 상세`에 오류 스레드명/ID, 직전 명령, 최초 발생 시각, 스택 프레임, 관련 함수를 자동 포함

## [0.5.81] - 2026-05-12

- 사이드바 UI 간소화: 연결 섹션에서 `통신 트래픽 보기`, `명령 보내기`, 중복 콘솔 관련 항목을 제거해 핵심 정보 위주로 축소
- 1403 조작 단일화: `1403 연결/재연결/로그 보기` 액션(`gpl.console.ensure`) 하나로 통합
- 프로젝트 컨텍스트 섹션 축약: 기대/실행, FTP 요약만 표시하고 기본 접힘으로 변경
- 상단 액션 버튼 단순화: 연결 상태 기준 `Connect/Disconnect + Refresh` 중심으로 축소

## [0.5.80] - 2026-05-12

- 런타임 오류 발생 시 디버그 이벤트에 오류 스레드명/ID, 직전 실행 명령, 최초 발생 시각, 스택 프레임 요약, 관련 함수 목록을 포함하도록 확장
- 사이드바에 `런타임 오류 컨텍스트` 섹션 추가: 오류 스레드, 직전 명령, 최초 시각, 프레임을 자동 표시
- 에러 항목 클릭 동작을 `오류 상세 보기`로 변경하여 해당 오류의 스레드/호출 경로/관련 함수/최근 로그(10줄)를 즉시 출력
- `-782` 코드 상세에서 초기화 누락/생성자 누락/getter 반환 경로 후보를 자동 힌트로 표시
- 에러 체인(`-782 -> -508 -> -2`)을 접을 수 있는 `에러 체인` 하위 섹션으로 그룹화
- 진단 스냅샷에 `판정(환경/코드/UI)` 한 줄 요약 추가

## [0.5.79] - 2026-05-12

- 배포 실패 시 `COMPILE 원문 로그` 섹션을 출력 채널에 추가해 `-738/-742` 등 실제 컨텍스트를 직접 확인 가능하도록 개선
- `ErrorLog` 출력을 `환경 경고` / `코드·배포 에러`로 더 강하게 분리하고, 코드별 해석/권장 조치를 함께 표시
- COMPILE 단계에서 시스템 환경 에러(예: `-1521`) 동반 시 알림 문구를 `코드 수정 효과 검증 불가` 우선 문구로 강화
- 동일 실패 시그니처를 세션 히스토리로 비교해 `회귀 아님: 동일 실패 패턴 N회 관측` 메시지 자동 부여
- `gpl.diagnosticSnapshot` 명령 추가: 1402/1403 상태, 단계 판정, 코드 TopN, 체인, 비교 판정, COMPILE 원문 요약을 클립보드/출력 채널로 생성

## [0.5.78] - 2026-05-12

- 디버깅 중 쓰레드가 `Error` 상태로 전이되면 에러 위치 이벤트(`gpl.errorLocation`)를 발행하도록 DAP 세션 개선
- 확장에서 에러 위치 이벤트를 수신하면 해당 소스 파일/라인을 자동으로 열고 중앙으로 스크롤하도록 개선
- 같은 시점의 에러 위치/쓰레드 정보를 `GPL Language Support` Output 채널에 함께 기록해 로그와 위치를 한눈에 확인 가능

## [0.5.77] - 2026-05-12

- `Copy Situation for Chat` 스냅샷에 **최근 배포 결과** 섹션 추가
  - 성공/실패
  - 마지막 단계(`STOP`/`UPLOAD`/`COMPILE`/`START`/`SUCCESS`)
  - 컴파일 에러 코드 목록
  - 제어기 시스템 에러 코드 목록
- 트리뷰 연결 섹션에 1403 콘솔 상태 원인 표시 추가
  - 연결 거부(`ECONNREFUSED`), 빈 세션, 즉시 EOF, 소켓 에러 구분
  - `1403 재시도 연결` 액션 노출
- 명령 ID 별칭 `gpl.stopAll` 추가 (`gpl.controller.stopAll`와 동일 동작)
- 설정 기본값 변경: `gpl.runtimeConsole.autoStartOnDeploy = true`

## [0.5.76] - 2026-05-12

### Added

- `responseParser.ts`에 `classifyErrorEntry()` / `parseControllerErrorEntry()` 공유 함수 추가 — 제어기 시스템 에러 코드 목록(`-1521`, `-1520`, `-1519`, `-1518`) 포함
- 컨트롤러 트리뷰 에러 섹션을 두 그룹으로 분리 표시: `⚙ 제어기 시스템` (경고 아이콘) vs 코드 에러 (빨간 아이콘)
- 배포 결과 출력 채널에 `[⚠ 제어기 시스템]` / `[✘ 배포 에러]` 구분 섹션 출력

### Changed

- `extension.ts`의 지역 에러 분류 함수 3개를 `responseParser.ts` 공유 함수로 교체
- 배포 실패 시 실패 단계(STOP/UPLOAD/COMPILE/START) 메시지에 포함
- `-1521` 등 알려진 시스템 에러가 있어도 배포/GPL 코드 실패 원인으로 귀속하지 않도록 메시지 분리

### Fixed

- `gpl.controller.copyError` 인라인 명령이 TreeItem 객체를 인자로 받아 변환 실패하던 문제 수정 (`label` 프로퍼티 fallback 추가)

## [0.5.75] - 2026-05-12

- `GPL: Copy Situation for Chat` 실행 시 클립보드 복사만 수행하고 Markdown 문서를 자동으로 열지 않도록 조정
- 상태 공유 명령 실행 후 에디터 포커스를 빼앗지 않게 UX 단순화

## [0.5.74] - 2026-05-12

- UI 전역 상태 컨텍스트(`gpl.ui.connected`, `gpl.ui.debugging`)를 도입해 연결/디버그 상태를 일관 공유
- `GPL Controller > Status` 상단 액션을 연결 상태 기반으로 노출하도록 조정
  - 미연결: `Connect` 노출
  - 연결됨: `Stop All`, `Deploy`, `Deploy & Run`, `Refresh`, `Quick Attach` 노출
- 디버깅 중에는 상단의 `Deploy`/`Deploy & Run` 버튼을 숨겨 상충 동작 가능성 완화

## [0.5.73] - 2026-05-12

- Attach 전 배포 실패 시 실패 단계(`STOP/UPLOAD/COMPILE/START`)를 명시적으로 출력
- 실패 명령, STATUS 코드/메시지, 후보 프로젝트명 시도 순서를 Debug Console에 출력
- attach 실패 시 배포 raw trace를 Debug Console에 자동 덤프
- `GPL Deploy (Debug)` Output 채널에 동일 배포 trace가 누적되어 사후 분석 강화

## [0.5.72] - 2026-05-12

- `GPL Controller > Status` 상단 버튼을 10개에서 5개로 축소해 UI 혼잡도 완화
- 상단 유지 버튼: `stopAll`, `deploy`, `deployRun`, `threads.refresh`, `debug.attachNow`
- 상단에서 제외 버튼: `consoleToggle`, `logs.liveTerminal.start`, `showTraffic`, `copySituationForChat`, `debug.generateLaunch`
- README 현재 버전을 `v0.5.72`로 업데이트

## [0.5.71] - 2026-05-12

- TCP 응답 수신 로직을 개선해 부분 수신 이후에도 누적 응답을 완성으로 판단할 수 있게 조정
- 트래픽 로그에서 송신 명령 형식을 `[PLAIN]` / `[XML]`로 자동 표시
- 에러 섹션에서 Error 상태 쓰레드의 이름, 파일, 마지막 상태를 우선 노출하도록 UI 개선
- README 상단 현재 버전 표기를 `v0.5.71`로 정합성 맞춤
- 패킷 분할 상황에서 `</STATUS>`만 기다리며 무응답처럼 보이던 UX 문제 완화
- 릴리즈 파이프라인이 기대하는 `CHANGELOG.md` 부재 문제 해결

## [0.5.70] - 2026-05-12

- 디버그 세션의 쓰레드 상태를 사이드바에 실시간 동기화하는 브리지 추가
- `Run Extension (no compile)` 런치 구성과 `npm: watch` 기반 빠른 개발 루프 문서화
- README 디버깅 가이드를 확장해 F5 흐름과 watch 기반 재실행 흐름을 명확히 설명
- 디버그 중 별도 TCP 추가 호출 없이 쓰레드 상태를 보도록 동작 개선
