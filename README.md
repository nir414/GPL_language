# GPL Language Support

현재 버전: **v0.5.20**
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
| `GPL: Deploy (Build Only)` | STOP → UPLOAD → COMPILE |
| `GPL: Deploy & Run` | STOP → UPLOAD → COMPILE → START |
| `GPL: Start Runtime Console` | 런타임 콘솔 시작 |
| `GPL: Stop Runtime Console` | 런타임 콘솔 중지 |
| `GPL: 전체 정지` | 모든 쓰레드 정지 |
| `GPL: Send Command to Controller` | 명령어 직접 전송 |
| `GPL: Show Traffic Monitor` | TCP 트래픽 모니터 |
| `GPL: Refresh All` | 쓰레드·FTP·시스템 정보 전체 새로고침 |
| `GPL: Copy Situation for Chat` | 현재 상태를 Markdown으로 복사하고 문서로 열기 (AI 공유용) |

## 설정

`settings.json`에서 `gpl.*` 키로 설정:

| 설정 | 기본값 | 설명 |
|---|---|---|
| `gpl.trace.server` | `off` | 로그 수준 (`off` / `messages` / `verbose`) |
| `gpl.controller.ip` | `192.168.0.1` | Brooks 제어기 IP |
| `gpl.controller.port` | `1402` | TCP 명령 포트 |
| `gpl.controller.consolePort` | `1403` | 런타임 콘솔 포트 |
| `gpl.controller.timeoutMs` | `10000` | 명령 타임아웃 (ms) |
| `gpl.controller.ftpBasePath` | `/GPL` | FTP 기본 경로 |
| `gpl.controller.ftpFlashProjectsPath` | `/flash/projects` | Flash 프로젝트 FTP 경로 |
| `gpl.controller.threadPollIntervalMs` | `5000` | 쓰레드 폴링 간격 (ms) |

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

```
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
```

### 디버그 실행

1. F5 → Extension Development Host 실행
2. `.gpl` 파일 열어 테스트
3. Output → "GPL Language Support" 채널에서 로그 확인

> `"gpl.trace.server": "verbose"` 설정 시 상세 로그 출력

## 기여

이슈 리포트와 Pull Request를 환영합니다.
[GitHub Issues](https://github.com/nir414/GPL_language/issues)

---

### 주요 변경 이력

#### v0.5.x (현재)
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
