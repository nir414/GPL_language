# GPL Language Support

현재 버전: **v0.5.71**
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

- **TCP 통신** (기본 포트 1402) — 명령 송수신, 상태 조회
- **FTP 업로드** (포트 21) — 프로젝트 파일 자동 전송
- **런타임 콘솔** (포트 1403) — 실시간 출력 스트리밍
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
| `GPL: Send Command to Controller` | 명령어 직접 전송 |
| `GPL: Show Traffic Monitor` | TCP 트래픽 모니터 |
| `GPL: Refresh All` | 쓰레드·FTP·시스템 정보 전체 새로고침 |
| `GPL: Copy Situation for Chat` | 현재 상태를 Markdown으로 복사하고 문서로 열기 (AI 공유용) |
| `GPL: Start Live Log Terminal` | 실시간 로그 터미널 시작 + 1403 런타임 콘솔 연결 시도 |
| `GPL: Stop Live Log Terminal` | 실시간 로그 터미널 중지 + 1403 런타임 콘솔 정리 |

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
| `gpl.controller.consolePort` | `1403` | 런타임 콘솔 포트 |
| `gpl.controller.preferIPv4` | `true` | 제어기 1402/1403 연결 시 IPv4 우선 사용 (주소 계열 이슈 완화) |
| `gpl.controller.timeoutMs` | `10000` | 명령 타임아웃 (ms) |
| `gpl.controller.ftpBasePath` | `/GPL` | FTP 기본 경로 |
| `gpl.controller.ftpFlashProjectsPath` | `/flash/projects` | Flash 프로젝트 FTP 경로 |
| `gpl.controller.threadPollIntervalMs` | `5000` | 쓰레드 폴링 간격 (ms) |
| `gpl.trace.liveTerminal.autoStart` | `false` | 확장 활성화 시 실시간 로그 터미널 자동 시작 |
| `gpl.runtimeConsole.autoStartOnDeploy` | `false` | 배포 성공 시 1403 런타임 콘솔 자동 시작 |
| `gpl.runtimeConsole.autoStartOnDebug` | `true` | `brooks-gpl` 디버그 세션 시작 시 1403 런타임 콘솔 자동 시작 |
| `gpl.runtimeConsole.noPayloadWarnThreshold` | `3` | no-payload 연속 횟수 경고 임계치 |
| `gpl.runtimeConsole.unstableWarnCooldownMs` | `60000` | no-payload 경고 재출력 쿨다운(ms) |
| `gpl.runtimeConsole.emptyNoticeEvery` | `5` | 반복 no-payload 상세 로그를 N회마다 출력 |
| `gpl.runtimeConsole.immediateEofReconnectBaseMs` | `1000` | `Immediate EOF` no-payload 세션의 재연결 base 지연(ms) |
| `gpl.runtimeConsole.immediateEofReconnectMaxMs` | `5000` | 반복 `Immediate EOF` 세션의 재연결 최대 지연(ms) |
| `gpl.runtimeConsole.idleReconnectBaseMs` | `5000` | 빈 세션 재연결 적응형 base 지연(ms) |
| `gpl.runtimeConsole.idleReconnectMaxMs` | `30000` | 빈 세션 재연결 적응형 최대 지연(ms) |

- 제어기 **연결 성공 시 1403 런타임 콘솔도 즉시 연결**됩니다.
- 제어기 **연결 해제 또는 연결 유실 시 1403도 함께 정리**됩니다.

## 실시간 로그 터미널

1402(명령) · 1403(런타임 콘솔) 포트 트래픽을 **VS Code 터미널**에 실시간으로 미러링합니다.  
파일을 생성하지 않으며, 메모리 내 버퍼만 사용합니다.

### 사용 방법

1. 명령 팔레트(`Ctrl+Shift+P`) → **`GPL: Start Live Log Terminal`** 실행
2. 터미널 패널에 **GPL Live Logs** 탭이 열리고, 1403 런타임 콘솔 연결을 즉시 시도함
3. 제어기 연결·배포·디버깅을 수행하면 트래픽이 실시간으로 출력됨
4. 중지할 때는 **`GPL: Stop Live Log Terminal`** 실행 (1403 소비자도 함께 정리)

```text
[1402] >>> <COMMAND><NAME>GetProjectList</NAME></COMMAND>
[1402] <<< <STATUS><CODE>0</CODE>...</STATUS>
[1403] <E>3,GPL_Code<L>52</L>Hello from robot</E>
```

- `[1402]` — TCP 명령 포트 트래픽 (송신 `>>>` / 수신 `<<<`)
- `[1403]` — 런타임 콘솔 이벤트 (쓰레드 상태 변경, `Print` 출력 등)
- 1403 상태 메시지는 아래처럼 구분됩니다:
  - `Connected, but no payload yet ...` : 연결은 되었지만 아직 payload가 없음 (Idle 또는 불안정 가능)
  - `Disconnected ... Empty batch (payload 0)` : 빈 배치 세션
  - `Disconnected ... Immediate EOF (payload 0)` : 즉시 EOF 종료
  - `연결 실패: Connection refused` : 1403 서비스가 연결을 거절
  - `⚠ 1403 비정상 징후: no payload N회 연속` : 반복 무페이로드 경고 (Robot.log 교차 검증 권장)
- no-payload 반복 구간에서는 콘솔 출력이 과도해지지 않도록 상세 로그를 샘플링(`emptyNoticeEvery`)하며,
  `Immediate EOF`와 일반 idle 세션을 분리해서 적응형 재연결을 적용합니다.
- `Immediate EOF`는 짧은 블라인드 구간이 치명적일 수 있어 빠른 재접속(`immediateEofReconnectBaseMs`~`immediateEofReconnectMaxMs`)을 사용하고,
  일반 idle 세션은 완만한 재연결(`idleReconnectBaseMs`~`idleReconnectMaxMs`)을 유지합니다.
- 현재 정책은 **활성 쓰레드 유무를 추정해서 1403을 멈추지 않습니다.**
  제어기 연결이 유지되는 동안은 1403도 계속 유지하려고 시도합니다.

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

#### v0.5.71 (현재)

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
