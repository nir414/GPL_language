# GPL Language Support

현재 버전: **v0.8.0**
GPL (Guidance Programming Language) 지원 VS Code 확장.
IntelliSense, 정의/참조 탐색, 호버, 코드 폴딩, **제어기 연결·배포·디버깅**까지 통합 제공합니다.

> GPL은 [Brooks Automation](https://www.brooksautomation.com/) PreciseFlex 로봇 제어기용 VB.NET 유사 언어입니다.

## 빠른 시작 (5분)

### 1) 언어 기능만 먼저 쓰기

1. 확장 설치 후 `.gpl` 파일 열기
2. `Ctrl+Space`로 자동완성 확인
3. `F12` / `Shift+F12`로 정의·참조 탐색

### 2) 제어기까지 바로 연결하기

1. `settings.json`에 `gpl.controller.ip` 설정
2. 명령 팔레트(`Ctrl+Shift+P`) → `GPL: Connect to Controller`
3. `GPL: Deploy (Build Only)` 실행으로 업로드/컴파일 확인

### 3) 디버깅 시작하기

1. `.gpl` 파일에 브레이크포인트 설정
2. F5 → **Attach to GPL Controller**
3. `stopOnEntry` 또는 브레이크포인트에서 정지 확인

> 처음에는 **Build Only**로 통신/컴파일 경로부터 확인하고, 이후 Attach 디버깅으로 넘어가면 가장 안정적입니다.

## 문서 탐색 가이드

- 사용자/기능 관점 개요: `README.md` (이 문서)
- 상세 개발 문서: `docs/development/`
    - `project-structure.md`: 구조/역할
    - `workflow-improvements.md`: 개발 흐름 개선 이력
    - `version-management.md`: 버전 관리 규칙
- GPL 언어/레퍼런스 문서: `docs/gpl-language/`, `docs/reference/`
- 릴리즈 절차: `docs/releases/process.md`, `docs/releases/quick-guide.md`

## 설치

1. [Releases](https://github.com/nir414/GPL_language/releases)에서 최신 `.vsix` 파일을 다운로드합니다.
2. VS Code → Extensions(`Ctrl+Shift+X`) → **…** → **Install from VSIX…** → 파일 선택
3. Reload 후 `.gpl`/`.gpo` 파일을 열면 자동 활성화

> `npm run package` 실행 시 `dist/gpl-language-support-<version>.vsix`가 생성됩니다.
> [!tip]
> 설치 후 동작 확인은 **`F12`(정의 찾기)** 와 **`Ctrl+Space`(자동완성)** 두 가지만 먼저 테스트하면 빠르게 성공 여부를 판단할 수 있습니다.

## 기능 요약

### 언어 기능

| 기능 | 단축키 | 설명 |
|---|---|---|
| Go to Definition | `F12` | 함수, 클래스, 변수 정의로 이동 |
| Find All References | `Shift+F12` | 심볼 사용 위치 전체 검색 |
| IntelliSense | `Ctrl+Space` | GPL 심볼 자동완성 |
| Hover Info | 마우스 올리기 | 심볼 타입·파라미터 정보 + 내장 함수 시그니처 |
| Outline | `Ctrl+Shift+O` | 문서 내 심볼 구조 |
| Symbol Search | `Ctrl+T` | 워크스페이스 전체 심볼 검색 |
| Code Folding | — | Module/Class/Sub/Function 블록 접기 |
| Quick Fix | `Ctrl+.` | XML 개선·호환성 대안 제안 |

- `Project.gpr`이 있으면 `ProjectSource`에 등록된 파일만 우선 인덱싱 (대형 워크스페이스 최적화)
- GPL/VB.NET은 대소문자 무시 언어 — 심볼 비교에 자동 반영
- **내장 함수/클래스 레퍼런스 강화**: `Fuxnctions`, `Math Class`, `Thread`, `Controller`, `XML` 주요 API를 자동완성/호버에서 문서형으로 표시
- `Math.Abs`, `Math.PI`, `CInt`, `CDbl`, `Thread.Sleep`, `Controller.Timer` 등 자주 쓰는 내장 API에 시그니처·요약·참고 링크 제공

### 제어기 통합

Brooks PreciseFlex 제어기에 직접 연결하여 VS Code 안에서 배포·실행·모니터링:

- **TCP 통신** (기본 포트 1402) — GDE editor/명령 포트 기반 명령 송수신, 상태 조회
- **FTP 업로드** (포트 21) — 프로젝트 파일 자동 전송
- **런타임 콘솔** (기본 포트 1403) — 로컬 구현/실측 기준의 GDE 출력 이벤트 스트리밍
- **UDP 검색** (포트 51417) — 네트워크 내 제어기 자동 검색
- **배포 워크플로**: STOP → UPLOAD → COMPILE → START (Build Only / Deploy & Run 선택)
- **컴파일 에러** → VS Code Problems 패널 자동 연동
- **실시간 로그 터미널** — 1402/1403 트래픽을 VS Code 터미널에 미러링

### 사이드바 — GPL Controller 패널

Activity Bar의 **GPL Controller** 아이콘으로 접근:

| 섹션 | 내용 |
|---|---|
| 연결 정보 | IP, 포트, 트래픽 모니터, 명령 보내기 |
| 쓰레드 | 실시간 상태 (Running/Paused/Break/Error), 개별 제어 |
| 브레이크포인트 | 제어기에 설정된 BP 목록, hit count |
| FTP 파일 | 제어기 `/GPL` 디렉터리 파일 목록, 컴파일/실행/다운로드/삭제 |
| 시스템 정보 | 메모리, 플래시, CPU 사용률 |
| 에러 로그 | 활성 에러 목록, 초기화 |

- 상태바는 GPL 파일이 열려 있거나 제어기에 연결된 경우에만 표시

### 디버거 (DAP)

`brooks-gpl` 디버그 어댑터로 Attach 모드 디버깅 지원:

```json
{
    "type": "brooks-gpl",
    "request": "attach",
    "name": "Attach to GPL Controller",
    "deployBeforeAttach": true,
    "projectName": "GPL_Code",
    "stopOnEntry": true
}
```

- `deployBeforeAttach: true`를 사용하면 F5 시점에 **STOP → UPLOAD → COMPILE**을 먼저 수행한 뒤 디버거가 attach 됩니다.
- `projectDir`를 지정하면 다중 프로젝트 워크스페이스에서 배포 대상을 고정할 수 있습니다.
- `stopAllBeforeAttach: true`를 사용하면 attach 직전에 `Stop -all`을 실행해 다른 프로젝트 쓰레드 간섭을 줄입니다.
- `clearProjectBreakpointsOnAttach: true`를 사용하면 attach 직전에 대상 프로젝트의 기존 제어기 브레이크포인트를 정리합니다.
- 런타임 Error 상태 전환 시 에러 위치 이벤트를 받아 **해당 파일/라인을 자동으로 열고 중앙으로 이동**하며, Output 채널에 같은 정보를 남깁니다.

| 기능 | 지원 |
|---|---|
| 행 브레이크포인트 | `.gpl` 파일에서 설정 |
| Step Over / Step Into / Continue | F10 / F11 / F5 |
| 변수 조회 | Variables 패널, Hover, Debug Console |
| Call Stack / 쓰레드 | 다중 쓰레드 표시 |
| stopOnEntry | 첫 줄 자동 정지 |
| deployBeforeAttach | Attach 전 자동 배포(Build Only) |
| stopAllBeforeAttach | Attach 전 전체 쓰레드 정지(클린 세션) |
| clearProjectBreakpointsOnAttach | Attach 전 대상 프로젝트 BP 자동 정리 |

## 명령어

### 언어

| 명령 | 설명 |
|---|---|
| `GPL: Refresh Symbols` | 심볼 캐시 수동 새로고침 |
| `GPL: Debug Symbol Cache` | 심볼 캐시 상태 점검 |
| `GPL: Show XML Best Practices` | XML 인코딩 최적화 안내 |
| `GPL: Analyze XML Encoding` | XML 인코딩 분석 |

### 제어기

| 명령 | 설명 |
|---|---|
| `GPL: Connect to Controller` | 제어기 연결 |
| `GPL: Disconnect Controller` | 제어기 해제 |
| `GPL: Deploy (Build Only)` | STOP → UPLOAD → COMPILE — 최신 로컬 코드를 제어기에 업로드한 뒤 검증 |
| `GPL: Deploy & Run` | STOP → UPLOAD → COMPILE → START |
| `GPL: Start Runtime Console` | 런타임 콘솔 시작 |
| `GPL: Stop Runtime Console` | 런타임 콘솔 중지 |
| `GPL: 전체 정지` | 모든 쓰레드 정지 |
| `gpl.stopAll` (별칭 ID) | `gpl.controller.stopAll`과 동일 동작 (자동화/에이전트 호출 호환) |
| `GPL: Send Command to Controller` | 명령어 직접 전송 |
| `GPL: Show Traffic Monitor` | TCP 트래픽 모니터 |
| `GPL: Refresh All` | 쓰레드·FTP·시스템 정보 전체 새로고침 |
| `GPL: Copy Situation for Chat` | 현재 상태를 Markdown으로 클립보드에 복사 (AI 공유용, 최근 배포 결과/실패 단계/에러 코드 포함) |
| `GPL: Start Live Log Terminal` | 실시간 로그 터미널 시작 + 1403 출력 이벤트 연결 시도 |
| `GPL: Stop Live Log Terminal` | 실시간 로그 터미널 중지 + 1403 출력 이벤트 소비자 정리 |

### AI/Agent 디버깅 진입점

AI 에이전트가 제어기 디버깅을 보조할 때는 확장 명령과 DAP 세션을 우선 사용합니다. 직접 FTP 업로드나 별도 TCP 자동화로 확장 경로를 우회하지 않습니다.

| 목적 | Command Palette | Command ID |
|---|---|---|
| 현재 상태 공유 | `GPL: Copy Situation for Chat` | `gpl.controller.copySituationForChat` |
| 진단 스냅샷 | `GPL: Diagnostic Snapshot` | `gpl.diagnosticSnapshot` |
| 트래픽 확인 | `GPL: Show Traffic Monitor` | `gpl.controller.showTraffic` |
| 연결 | `GPL: Connect to Controller` | `gpl.controller.connect` |
| Build Only 검증 | `GPL: Deploy (Build Only)` | `gpl.deploy` |
| Attach 구성 생성 | `GPL: Create/Update Debug launch.json` | `gpl.debug.generateLaunch` |
| 빠른 Attach | `GPL: Quick Debug Attach (No launch.json)` | `gpl.debug.attachNow` |
| 런타임 콘솔 | `GPL: Start Runtime Console` | `gpl.console.start` |
| 라이브 로그 | `GPL: Start Live Log Terminal` | `gpl.logs.liveTerminal.start` |
| 직접 명령 | `GPL: Send Command to Controller` | `gpl.controller.sendCommand` |
| 전체 정지 | `GPL: 모든 쓰레드 중지` | `gpl.controller.stopAll` / `gpl.stopAll` |

권장 순서:

1. `GPL: Copy Situation for Chat`로 현재 증거를 확보합니다.
2. `GPL: Deploy (Build Only)`로 최신 로컬 코드의 업로드/컴파일 경로를 먼저 검증합니다.
3. 성공 후 `GPL: Start Runtime Console` 또는 `GPL: Start Live Log Terminal`로 1403 출력을 봅니다.
4. `.gpl` 파일에 breakpoint를 설정하고 `brooks-gpl` Attach 디버깅을 시작합니다.
5. 실패 시 Debug Console의 `[GPL Debug] [deploy]` 블록, `GPL Deploy (Debug)` Output, `GPL Console`을 함께 확인합니다.

자세한 절차는 [`docs/development/ai-controller-debugging-runbook.md`](docs/development/ai-controller-debugging-runbook.md)를 참고하세요.

### FTP 패널의 `업로드된 복사본 컴파일 & 실행`에 대한 주의

- 이 명령은 **제어기 FTP 경로(`/GPL/...`)에 이미 업로드된 프로젝트 복사본만** 대상으로 `Load → Compile → Start`를 수행합니다.
- 즉, **로컬 워크스페이스 변경사항은 자동 업로드하지 않습니다.**
- 최신 로컬 패치 검증이 목적이면 반드시 **`GPL: Deploy (Build Only)`** 또는 **`GPL: Deploy & Run`** 을 사용해야 합니다.
- 제어기 응답상 `Load GPL_Code` 같은 상대 경로는 `-508 File not found`가 날 수 있으며, 확장은 FTP 절대 경로(예: `/GPL/GPL_Code`) 기준으로 처리합니다.
- 절대 경로 `Load /GPL/GPL_Code` 후 `-745 Project already exists`가 나오면, 이는 보통 **이미 로드된 상태**이므로 치명적 실패로 보지 않습니다.

## 설정

`settings.json`에서 `gpl.*` 키로 설정:

| 설정 | 기본값 | 설명 |
| --- | --- | --- |
| `gpl.trace.server` | `off` | 로그 수준 (`off` / `messages` / `verbose`) |
| `gpl.controller.ip` | `192.168.0.1` | Brooks 제어기 IP |
| `gpl.controller.port` | `1402` | TCP 명령 포트 |
| `gpl.controller.consolePort` | `1403` | 로컬 구현/실측 기준의 런타임 출력 이벤트 포트 |
| `gpl.controller.preferIPv4` | `true` | 제어기 1402/1403 연결 시 IPv4 우선 사용 (주소 계열 이슈 완화) |
| `gpl.controller.timeoutMs` | `10000` | 명령 타임아웃 (ms) |
| `gpl.controller.ftpBasePath` | `/GPL` | FTP 기본 경로 |
| `gpl.controller.ftpFlashProjectsPath` | `/flash/projects` | Flash 프로젝트 FTP 경로 |
| `gpl.controller.ftpRunLoadBeforeCompile` | `false` | FTP Run 시 Compile 전에 `Load <resolved path>`를 선행할지 여부 |
| `gpl.controller.threadPollIntervalMs` | `5000` | 쓰레드 폴링 간격 (ms) |
| `gpl.trace.liveTerminal.autoStart` | `false` | 확장 활성화 시 실시간 로그 터미널 자동 시작 |
| `gpl.runtimeConsole.autoStartOnDeploy` | `true` | 배포 성공 시 1403 출력 이벤트 소비자 자동 시작 |
| `gpl.runtimeConsole.autoStartOnDebug` | `true` | `brooks-gpl` 디버그 세션 시작 시 1403 출력 이벤트 소비자 자동 시작 |
| `gpl.runtimeConsole.noPayloadWarnThreshold` | `3` | no-payload 연속 횟수 경고 임계치 |
| `gpl.runtimeConsole.unstableWarnCooldownMs` | `60000` | no-payload 경고 재출력 쿨다운(ms) |
| `gpl.runtimeConsole.emptyNoticeEvery` | `5` | 반복 no-payload 상세 로그를 N회마다 출력 |
| `gpl.runtimeConsole.immediateEofReconnectBaseMs` | `1000` | `Immediate EOF` no-payload 세션의 재연결 base 지연(ms) |
| `gpl.runtimeConsole.immediateEofReconnectMaxMs` | `15000` | 반복 `Immediate EOF` 세션의 재연결 최대 지연(ms) |
| `gpl.runtimeConsole.idleReconnectBaseMs` | `5000` | 빈 세션 재연결 적응형 base 지연(ms) |
| `gpl.runtimeConsole.idleReconnectMaxMs` | `30000` | 빈 세션 재연결 적응형 최대 지연(ms) |

- 제어기 **연결 성공 시 1403 출력 이벤트 소비자도 즉시 연결**됩니다.
- 제어기 **연결 해제 또는 연결 유실 시 1403도 함께 정리**됩니다.

## 실시간 로그 터미널

1402(명령) · 1403(출력 이벤트) 포트 트래픽을 **VS Code 터미널**에 실시간으로 미러링합니다.  
파일을 생성하지 않으며, 메모리 내 버퍼만 사용합니다.

### 사용 방법

1. 명령 팔레트(`Ctrl+Shift+P`) → **`GPL: Start Live Log Terminal`** 실행
2. 터미널 패널에 **GPL Live Logs** 탭이 열리고, 1403 출력 이벤트 연결을 즉시 시도함
3. 제어기 연결·배포·디버깅을 수행하면 트래픽이 실시간으로 출력됨
4. 중지할 때는 **`GPL: Stop Live Log Terminal`** 실행 (1403 소비자도 함께 정리)

```text
[1402] >>> [PLAIN] 192.168.0.2:1402  Show Thread
[1402] <<< STATUS 0  3 lines  8ms
[1403] <E>3,GPL_Code<L>52</L>Hello from robot</E>
```

- `[1402]` — TCP 명령 포트 트래픽 (송신 `>>>` / 수신 `<<<`)
- 1402 wire format은 plain text command + CRLF이며, XML wrapper를 사용하지 않습니다.
- `[1403]` — 확장 실측 기준의 출력/event batch (쓰레드 상태 변경, `Print`/console 출력 등)
- 1403 상태 메시지는 아래처럼 구분됩니다:
  - `Connected, but no payload yet ...` : 연결은 되었지만 아직 payload가 없음 (Idle 또는 불안정 가능)
  - `Disconnected ... Empty batch (payload 0)` : 빈 배치 세션
  - `Disconnected ... Immediate EOF (payload 0)` : 즉시 EOF 종료
  - `연결 실패: Connection refused` : 1403 서비스가 연결을 거절
  - `⚠ 1403 비정상 징후: no payload N회 연속` : 반복 무페이로드 경고 (1403 서비스 상태/런타임 출력 경로 점검 권장)
- no-payload 반복 구간에서는 콘솔 출력이 과도해지지 않도록 상세 로그를 샘플링(`emptyNoticeEvery`)하며,
  `Immediate EOF`와 일반 idle 세션을 분리해서 적응형 재연결을 적용합니다.
- `Immediate EOF`는 짧은 블라인드 구간이 치명적일 수 있어 빠른 재접속(`immediateEofReconnectBaseMs`~`immediateEofReconnectMaxMs`)을 사용하고,
  일반 idle 세션은 완만한 재연결(`idleReconnectBaseMs`~`idleReconnectMaxMs`)을 유지합니다.
- 현재 정책은 **활성 쓰레드 유무를 추정해서 1403을 멈추지 않습니다.**
  제어기 연결이 유지되는 동안은 1403도 계속 유지하려고 시도합니다.

### Brooks 포트/콘솔 근거 정리

공식 문서와 확장 실측 근거를 분리해서 해석합니다.

| 대상 | 근거 수준 | 정리 |
| --- | --- | --- |
| `1402~1404` | Brooks 공식 FAQ | GDE 포트 범위 |
| `1402` | Brooks PDB 공식 문서 | GDE editor port |
| `1403` | 확장 구현 + 실기 로그 | 런타임 출력/event batch 수신 포트로 동작 |
| `/dev/com1` | Brooks serial 공식 문서 | primary serial console port이며 일반 serial I/O와 console이 충돌 가능 |
| `Console.Write`/`Console.WriteLine` | Brooks GPL Dictionary | 실행 컨텍스트에 따라 `/dev/com1`, GDE output window, TELNET 등으로 destination이 달라질 수 있음 |

참고 문서:
- Brooks FAQ: `Controller_Software/FAQ/Setup_Upgrading/ethernet_ports.htm`
- Brooks PDB: `Controller_Software/Software_Reference/PDB/Controller_Settings/debug_and_trace.htm`
- Brooks serial communications: `Controller_Software/Introduction_To_The_Software/Communications/com_serial.htm`
- Brooks serial I/O: `Controller_Software/Introduction_To_The_Software/Guidance_Programming_Language/File_Serial_Streams/serialio.htm`
- Brooks `Console.Write`: `Controller_Software/Software_Reference/GPL_Dictionary/Console/c_write.htm`

### 자동 시작

`settings.json`에 아래 키를 추가하면 **확장 활성화 시** 자동으로 터미널 시작을 시도합니다.
단, 실제 자동 시작은 **열린 `.gpl`/`.gpo` 문서가 있을 때만** 동작합니다:

```json
"gpl.trace.liveTerminal.autoStart": true
```

---

## 문제 해결 빠른 체크리스트

- 확장이 활성화되지 않음
  - 파일 확장자가 `.gpl` 또는 `.gpo`인지 확인
  - VS Code를 Reload한 뒤 다시 열기
- 자동완성/정의 찾기가 약함
  - 명령 팔레트에서 `GPL: Refresh Symbols` 실행
  - 워크스페이스 루트에 `Project.gpr` 존재 여부 확인
- 제어기 연결 실패
  - `gpl.controller.ip`, 포트(기본 1402/1403/21) 확인
  - 네트워크 연결 및 방화벽 점검
- 배포/컴파일 실패
  - 먼저 `GPL: Deploy (Build Only)`로 실패 단계(STOP/UPLOAD/COMPILE) 분리 확인
  - Output 패널의 "GPL Language Support" 로그 확인

## GPL 언어 참고 자료

- [Brooks Automation GPL Reference](https://www2.brooksautomation.com/Controller_Software/Introduction_To_The_Software/Guidance_Programming_Language/) — 공식 언어 레퍼런스
- [GPL 자동 실행 모드](https://www2.brooksautomation.com/Controller_Software/Introduction_To_The_Software/Controller_Automatic_Execution_Modes/mode_gpl.htm)

## 프로젝트 구조

```text
src/
├── extension.ts                # 확장 진입점
├── gplParser.ts                # GPL/VB 코드 파서
├── symbolCache.ts              # 워크스페이스 심볼 인덱싱
├── config.ts                   # 설정·유틸리티
├── xmlUtils.ts                 # XML 인코딩 분석
├── providers/                  # 언어 기능 프로바이더
│   ├── definitionProvider.ts       # Go to Definition
│   ├── referenceProvider.ts        # Find All References
│   ├── completionProvider.ts       # IntelliSense
│   ├── hoverProvider.ts            # Hover 정보
│   ├── documentSymbolProvider.ts   # Outline
│   ├── workspaceSymbolProvider.ts  # Ctrl+T 심볼 검색
│   ├── foldingRangeProvider.ts     # 코드 폴딩
│   ├── codeActionProvider.ts       # Quick Fix
│   └── diagnosticProvider.ts       # 진단 (비활성화 상태)
├── controller/                 # 제어기 통신
│   ├── controllerConnection.ts     # TCP 명령 (포트 1402)
│   ├── responseParser.ts           # 응답 파싱
│   ├── ftpClient.ts                # FTP 업로드/다운로드 (basic-ftp)
│   ├── deployService.ts            # 배포 워크플로
│   ├── runtimeConsole.ts           # 콘솔 스트리밍 (포트 1403)
│   └── controllerDiscovery.ts      # UDP 제어기 검색
├── debug/                      # 디버그 어댑터
│   ├── activateDebug.ts            # DAP 등록
│   └── gplDebugSession.ts         # 디버그 세션 구현
└── views/                      # UI 컴포넌트
    ├── controllerTreeProvider.ts   # 사이드바 통합 패널
    ├── threadTreeProvider.ts       # 쓰레드 TreeView
    └── connectionStatusBar.ts      # 하단 상태바
```

## 개발

### 요구사항

- Node.js 16+, npm, VS Code `^1.74.0`

### 빌드·패키징

```bash
npm install           # 의존성 설치
npm run compile       # TypeScript → out/
npm run watch         # 감시 모드
npm run package       # compile + VSIX 생성 (dist/)
npm run dev:cycle     # package alias
npm run dev:watch     # watch alias (디버그 시작 전에 실행)
```

### 디버그 실행

#### 방법 1: F5 (자동 컴파일)

1. **F5** → Debug 패널 열림 → **"Run Extension"** 선택 실행
   - 자동으로 TypeScript 컴파일 후 Extension Development Host 실행
   - 처음 시작이나 재시작이 필요할 때 사용

#### 방법 2: 빠른 재실행 (권장)

1. **터미널에서** `npm run dev:watch` 실행 (백그라운드 감시 모드)
2. **F5** → **"Run Extension (no compile)"** 선택 실행
   - 컴파일 생략 → 빠른 시작
   - 파일 변경 시 watch가 자동으로 컴파일
   - 재실행할 때마다 이전 Extension Host 종료 후 새로 시작

#### 디버그 콘솔에서 확인

1. `.gpl` 파일 열어 기능 테스트 (symbol completion, goto definition 등)
2. **Output 패널** → **"GPL Language Support"** 채널에서 로그 확인
3. **Debug Console**에서 변수 조회 및 스택 추적 가능

#### Attach 전 배포 실패 시 로그 확인 포인트 (v0.5.73+)

`deployBeforeAttach: true`에서 실패하면 Debug Console에 아래 정보가 자동 출력됩니다.

- 실패 단계: `STOP / UPLOAD / COMPILE / START`
- 실패 명령: 예) `Compile GPL_Code`, `Load /GPL/GPL_Code`
- STATUS 코드/메시지: 예) `STATUS -508`, `STATUS -745`
- 후보 프로젝트명 시도 순서: `projectName -> Project.gpr -> folderName`
- raw trace 자동 덤프: 명령/응답 요약 포함

실제 확인 순서:

1. **Debug Console**에서 `[GPL Debug] [deploy] 실패 단계` 라인 확인
2. 같은 블록의 `[deploy] --- raw trace begin ---` ~ `end` 확인
3. 필요 시 **Output 패널 → `GPL Deploy (Debug)`** 채널에서 동일 trace 확인

#### 로그 출력 상세 모드

```json
{
    "gpl.trace.server": "verbose"
}
```

설정 시 상세 로그 출력. `.vscode/settings.json`에 추가하거나 Settings UI에서 `gpl.trace` 검색.

## 기여

이슈 리포트와 Pull Request를 환영합니다.
[GitHub Issues](https://github.com/nir414/GPL_language/issues)

---

### 주요 변경 이력

#### v0.8.0 (현재)

- **문자열 속 프로시저 참조 정의 찾기**: `New Thread("Class.Proc",, ...)` 형태의 문자열 참조에서도 F12가 동작
- **멤버 변수 파싱 보강**: `Shared Public Dim ...` 수식어 순서도 올바르게 인덱싱되어 정의 찾기/호버 정확도 개선

#### v0.7.7

- 멤버 자동완성, 로컬 변수/파라미터 자동완성, Signature Help 추가
- 디버그/배포 안전 게이트 및 STATUS 기반 판정 강화
- 디버그 hover/Variables/브레이크 감지/1403 안정성 개선

#### v0.5.109

- **FTP Run Load 선행 기본 비활성화**: Compile 전에 `Load <resolvedPath>`를 강제하지 않도록 기본값 변경
- **옵션 추가**: 필요한 환경에서는 `gpl.controller.ftpRunLoadBeforeCompile=true`로 기존 Load 선행 동작을 켤 수 있음

#### v0.5.108

- **FTP Run 경로 선택 정합성 개선**: `/GPL` 노드에서 실행해도 설정된 Flash Projects 경로에 같은 프로젝트가 있으면 `/flash/projects/<project>`를 우선 선택
- **FTP Run Load 선행**: Compile 전에 `Load <resolvedPath>`를 명시적으로 수행해 어떤 제어기 복사본을 컴파일하는지 확정

#### v0.5.107

- **FTP Run 컴파일 판정 보강**: `Compile <project>` 응답에 `<STATUS>`가 누락되어도 compile success/pass 로그와 `Show Thread` 후속 정상 응답으로 성공 여부를 보강 판정
- **FTP Run 원문 로그 강화**: Compile 응답 RAW preview와 불완전 수신 메타 정보를 출력해 `STATUS -9999 No STATUS found` 원인 추적성을 개선

#### v0.5.106

- **디버그 키바인딩 보강**: 디버깅 중 `F9`로 Continue를 실행할 수 있도록 기본 키바인딩 추가
- **변수 hover/watch 응답 개선**: 짧은 TTL 캐시를 도입해 같은 변수의 반복 hover/watch 조회가 제어기 명령 큐를 매번 기다리지 않도록 개선
- **GPL Controller 뷰 액션 정리**: 연결 상태의 상단 Disconnect 버튼 위치를 `Stop -all` 버튼으로 교체해 실행 중인 쓰레드를 더 빠르게 중지할 수 있도록 조정

#### v0.5.105

- **직접 명령 UX 보강**: `GPL: Send Command to Controller` 입력에서 XML 형식, `Show Project`, `Directory` 단독 호출을 감지해 올바른 plain command와 `Directory <path>` 사용을 안내
- **제어기 디버깅 문서 보강**: raw TCP fallback wire format, `Directory /flash/projects`, STATUS `-505/-714` 해석을 문서화

#### v0.5.101

- **구문 강조 호환성 개선**: GPL 선언부/타입명에 표준 TextMate 스코프를 적용해 다양한 테마에서 색 구분이 더 잘 보이도록 개선
  - `Class`, `Module`, `Sub`, `Function`, `Property`, `Const` 선언 이름 강조
  - `As Type`, `New TypeName`의 타입명 강조

#### v0.5.98

- **배포 COMPILE 대상 정합성 보강**: 업로드 직후 `Unload -> Load(/flash/projects/<project>)` 동기화를 선행하여, 이미 로드된 `/GPL/<project>` 구버전 복사본을 컴파일하는 오판정을 완화
- 결과적으로 `Deploy (Build Only)`/`Deploy & Run`이 "방금 업로드한 복사본" 기준으로 컴파일 검증되도록 일관성 개선

#### v0.5.95

- **배포 COMPILE 안정성 개선**: `Compile`에서 `STATUS -742/-746/-752`가 발생하고 컴파일 에러가 파싱되지 않으면 일시 상태로 간주해 자동 1회 재시도
  - 짧은 컨트롤러 상태 변동으로 인한 간헐적 배포 실패를 완화
  - 실제 컴파일 에러가 있는 경우는 기존처럼 즉시 실패 처리 유지

#### v0.5.94

- **1403 idle 판정 정교화**: payload 없이 종료된 세션 중 장시간 유지(기본 1500ms 이상)는 `Idle timeout` 정상 폴링으로 분류
  - 기존처럼 모두 `Empty batch`로 누적하지 않아 `UNSTABLE noPayloadStreak` 과다 경보를 줄임
  - `Idle timeout` 경로는 재연결 지연을 기본 idle 값으로 유지해(과도한 30초 확장 방지) 폴링 리듬 안정화

#### v0.5.93

- **1403 무출력 가시성 개선**: payload가 없어도 `GPL Console`에 상태 힌트를 출력
  - `연결됨, payload 대기 중`, `Immediate EOF 폴링`, `no-payload streak` 등을 `[RT] [1403] ...` 형태로 표시
  - 이제 콘솔이 완전히 비어 보이지 않아, "정상 idle인지 / 비정상 무출력인지"를 즉시 구분 가능

#### v0.5.92

- **Build Only 완료 UX 개선**: `GPL: Deploy (Build Only)`가 오류/시스템 경고 없이 정상 완료되면 1403 런타임 콘솔(`GPL Console`)을 자동으로 표시
  - 업로드/컴파일 성공 직후 콘솔 출력 확인 흐름으로 바로 이어져 현장 확인 속도 개선

#### v0.5.91

- **1403 재연결 루프 완화(2차)**: 자동 `ensure/start` 호출은 더 이상 대기 중 재연결 타이머를 취소하지 않도록 조정
  - `RECONNECT timer canceled by explicit start()` 패턴으로 인한 connect-close 가속 루프 억제
  - `No payload/Immediate EOF` 누적 streak가 자동 호출에 의해 불필요하게 리셋되지 않도록 보존
- **명시 사용자 액션 분리**: 사용자가 직접 실행하는 `GPL: Start Runtime Console`, `GPL: Ensure Runtime Console (1403)`만 강제 즉시 재연결 경로 사용
  - 수동 조작의 반응성은 유지하면서, 내부/자동 경로는 비침습적으로 동작

#### v0.5.90

- **디버그 폴링 부하 최적화**: 디버그 세션 `Show Thread` 폴링 간격을 사용자 설정 우선(안전 범위 1000~5000ms)으로 조정해 과도한 1402 트래픽을 완화
- **1403 무페이로드 재접속 완화**: `Immediate EOF` 반복 시 재연결 최대 지연 기본값을 `15000ms`로 상향해 장시간 빈 세션에서 연결 폭주를 억제
- **진단 로그 강화**: attach 시 적용된 디버그 폴링 간격(`user/effective`)을 Debug Console에 명시 출력

#### v0.5.77

- **Copy Situation 강화(P1)**: 스냅샷에 최근 배포 결과(성공/실패, 마지막 단계, 컴파일 코드, 제어기 시스템 코드) 섹션 추가
- **1403 상태 가시화(P1)**: 연결 섹션에 콘솔 상태/원인(연결 거부·빈 세션·즉시 EOF·소켓 에러) 표시 및 `1403 재시도 연결` 액션 추가
- **명령 ID 호환(P2)**: `gpl.stopAll` 별칭 등록 (`gpl.controller.stopAll`과 동일)
- **워크플로 기본값 조정(P3)**: `gpl.runtimeConsole.autoStartOnDeploy` 기본값을 `true`로 변경

#### v0.5.76

- **에러 분류 분리**: 제어기 시스템 에러(-1521 PDB 등)와 GPL 코드 에러를 트리뷰·출력 채널·알림 모두에서 별도 표시
- **배포 실패 안내 개선**: 실패 단계(STOP/UPLOAD/COMPILE/START) 표시 및 시스템 에러를 실패 원인에서 분리
- **에러 복사 버그 수정**: 트리 인라인 버튼 클릭 시 인자 변환 실패 문제 해결

#### v0.5.75

- **상황 복사 UX 정리**: `GPL: Copy Situation for Chat`가 클립보드 복사만 수행하고 Markdown 문서를 자동으로 열지 않음
- **존재감 최소화**: 상태 공유용 명령 실행 후 에디터 포커스를 빼앗지 않도록 조정

#### v0.5.74

- **상호작용 일관성 개선**: UI 전역 컨텍스트(`gpl.ui.connected`, `gpl.ui.debugging`)를 도입해 연결/디버그 상태를 공통으로 사용
- **상단 버튼 상태 연동**: 연결 전에는 Connect만 노출, 연결 후에는 실행 액션 노출로 오동작 유도 감소
- **디버그 중 배포 버튼 보호**: 디버그 세션 활성 시 Deploy/Deploy & Run 타이틀 버튼 자동 숨김

#### v0.5.73

- **Attach 전 배포 실패 가시화 강화**: 실패 단계(STOP/UPLOAD/COMPILE/START), 실패 명령, STATUS 코드/메시지 출력
- **원문 응답 trace 자동 첨부**: attach 실패 시 Debug Console에 배포 raw trace 자동 덤프
- **대체 이름 시도 결과 출력**: projectName / Project.gpr / 폴더명 후보 시도 순서 로깅

#### v0.5.72

- **상단 버튼 UI 단순화**: `GPL Controller > Status` 타이틀 액션을 10개에서 5개로 축소
  - 유지: 전체 정지, Deploy, Deploy & Run, Refresh All, Quick Debug Attach
  - 이동: 콘솔 토글, 라이브 로그 시작, 트래픽 모니터, 상황 복사, launch 생성/업데이트

#### v0.5.71

- **TCP 응답 누적 수신**: 최소 바이트 + idle timeout으로 부분 수신 완성 판단 → "무응답" 오해 해결 (P0)
- **명령 포맷 힌트**: [PLAIN]/[XML] 라벨 자동 표시 → 명령 형식 혼동 디버깅 용이 (P1)
- **Error 쓰레드 컨텍스트**: 에러 섹션에 쓰레드 정보(name, file, lastStatus) 우선 표시 → 원인 파악 강화 (P1)

#### v0.5.70

- **디버그 중 쓰레드 뷰**: debug 세션의 Show Thread 폴링 결과를 사이드바에 실시간 반영 (TCP 추가 호출 없음)
- **개발 디버그 개선**: Launch config 2가지 + npm:watch 태스크 + 상세 가이드
- **디버거 (DAP)**: `brooks-gpl` Attach 모드, 브레이크포인트, 스텝 실행, 변수 조회
- **사이드바 통합 패널**: 쓰레드·FTP·시스템 정보·에러 로그를 하나의 TreeView로 통합
- **쓰레드 개별 제어**: 시작/정지/일시정지/재개/스텝/에러 건너뛰기
- **FTP 파일 관리**: 컴파일·실행·다운로드·삭제·Unload
- **시스템 정보 조회**: 메모리, 플래시, CPU 사용률 (tooltip으로 상세 정보)
- **연결 상태바 자동 숨김**: GPL 파일 열림 또는 연결 시에만 표시
- **Hover Provider**: 심볼 위에 마우스 올려 정보 확인
- **폴링 최적화**: 디버그 세션 시 500ms fast poll

#### v0.3.0

- **제어기 통합**: TCP/FTP/UDP 통신, 배포 워크플로, 런타임 콘솔, 쓰레드 모니터링
- 컴파일 에러 → VS Code Diagnostics 연동
- VSIX 패키징 최적화 (180MB → 76KB)

#### v0.2.x

- 참조 검색·파서 개선 (토큰 기반 파싱, unqualified 호출 탐색)
- `Project.gpr` 기반 선택적 인덱싱 최적화
- VB.NET 호환성 진단
- IntelliSense, Quick Fix, 심볼 검색

#### v0.1.x

- 핵심 언어 지원: 정의 찾기, 참조 찾기, 자동완성, Outline
