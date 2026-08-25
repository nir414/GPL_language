# GPL Language Support

**[Brooks Automation](https://www2.brooksautomation.com/)(구 Precise Automation) PreciseFlex 로봇 제어기 개발을 VS Code에서 끝내기 위한 확장**입니다.

PreciseFlex 제어기의 프로그램은 [GPL(Guidance Programming Language)](https://www2.brooksautomation.com/Controller_Software/Introduction_To_The_Software/Guidance_Programming_Language/)이라는
VB.NET 유사 언어로 작성하는데, 공식 개발 환경(GDE)은 코드 탐색·자동완성 같은 현대적 편집
기능이 부족합니다. 이 확장은 그 간극을 메웁니다:

- **제어기 연동** — TCP(1402 명령)·FTP(업로드)·1403(런타임 출력) 통신으로 VS Code 안에서
  업로드 → 컴파일 → 실행 → 모니터링까지 수행
- **디버깅** — `brooks-gpl` 디버그 어댑터(DAP)로 브레이크포인트, 스텝 실행, 변수 조회
- **AI 에이전트 연동** — AI가 확장 명령만으로 배포/디버깅 루프를 돌릴 수 있는 명령 API 제공
- **언어 지원** — IntelliSense, 정의/참조 탐색, 호버, Outline, 코드 폴딩, 내장 API 문서

> GPL 언어 공식 레퍼런스: [Brooks Automation GPL Reference](https://www2.brooksautomation.com/Controller_Software/Introduction_To_The_Software/Guidance_Programming_Language/)

## 빠른 시작 (5분)

### 1) 제어기 연결하기

1. 확장 설치 후 프로젝트(`.gpl` 파일) 열기
2. `settings.json`에 `gpl.controller.ip` 설정
3. 명령 팔레트(`Ctrl+Shift+P`) → `GPL: Connect to Controller`

### 2) 배포·컴파일 확인하기

1. `GPL: Deploy (/GPL 업로드 + Compile, Start 없음)` 실행
2. 컴파일 에러가 있으면 Problems 패널에서 확인 (에러 위치로 자동 점프)

### 3) 디버깅 시작하기

1. `.gpl` 파일에 브레이크포인트 설정
2. F5 → **Attach to GPL Controller**
3. `stopOnEntry` 또는 브레이크포인트에서 정지 확인

> 처음에는 **Deploy(Build Only)** 로 통신/컴파일 경로부터 확인하고, 이후 Attach 디버깅으로
> 넘어가면 가장 안정적입니다.

## 설치

1. [Releases](https://github.com/nir414/GPL_language/releases)에서 최신 `.vsix` 파일을 다운로드합니다.
2. VS Code → Extensions(`Ctrl+Shift+X`) → **…** → **Install from VSIX…** → 파일 선택
3. Reload 후 `.gpl`/`.gpo` 파일을 열면 자동 활성화

## 기능

### 제어기 통합

Brooks PreciseFlex 제어기에 직접 연결하여 VS Code 안에서 배포·실행·모니터링:

- **TCP 명령**(포트 1402) · **FTP 업로드**(포트 21) · **런타임 출력 스트림**(포트 1403) ·
  **UDP 제어기 자동 검색**(포트 51417)
- **배포 워크플로**: UPLOAD ∥ STOP → COMPILE — FTP 업로드와 정지(`Stop -all` + 정지 완료 확인)를 동시에
  진행하고 둘 다 끝난 뒤 Compile(소요 시간 = max(업로드, 정지)). 컴파일 에러는 Problems 패널에 자동 연동,
  실행(START)과 flash 저장은 별도 명령으로 분리(Compile과 Start는 한 번에 하나만).
  업로드/배포 중에는 배포 잠금으로 다른 창·MCP의 Compile/Start를 차단(잠금 보유자·단계·경과를 경고에 표시)
- **사이드바 GPL Controller 패널**: 연결 정보, 쓰레드 실시간 상태/개별 제어, 제어기
  브레이크포인트 목록, FTP 파일 관리(컴파일/실행/다운로드/삭제), 시스템 정보, 에러 로그
- **실시간 로그 터미널**: 1402/1403 트래픽을 VS Code 터미널에 미러링 (파일 미생성, 메모리 버퍼만 사용)

> ⚠️ **알려진 제한 — 1403 수신**: 1403 출력 이벤트 수신은 실기기에서 안정 동작을 확보하지
> 못했습니다(연결은 되지만 payload가 없는 경우가 많음). `[1403]` 출력은 as-is로 제공되며,
> `[1402]` 명령 트래픽 미러링은 정상 사용 가능합니다.

### 디버거 (DAP)

`brooks-gpl` 디버그 어댑터로 Attach 모드 디버깅: 행 브레이크포인트, Step Over/Into(F10/F11),
Continue(F5), 변수 조회(Variables/Hover/Debug Console), Call Stack·다중 쓰레드 표시.
런타임 Error 발생 시 해당 파일/라인을 자동으로 열고 이동합니다.

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

| 옵션 | 효과 |
|---|---|
| `deployBeforeAttach` | F5 시점에 UPLOAD ∥ STOP → COMPILE 후 attach |
| `projectDir` | 다중 프로젝트 워크스페이스에서 배포 대상 고정 |
| `stopAllBeforeAttach` | attach 직전 `Stop -all`로 다른 프로젝트 쓰레드 간섭 차단 |
| `clearProjectBreakpointsOnAttach` | attach 직전 대상 프로젝트의 기존 제어기 브레이크포인트 정리 |

### 언어 기능

| 기능 | 단축키 | 설명 |
|---|---|---|
| Go to Definition | `F12` | 함수, 클래스, 변수 정의로 이동 (`New Thread("Class.Proc",...)` 문자열 참조 포함) |
| Find All References | `Shift+F12` | 심볼 사용 위치 전체 검색 |
| IntelliSense | `Ctrl+Space` | GPL 심볼·멤버·로컬 변수 자동완성, Signature Help |
| Hover Info | 마우스 올리기 | 심볼 타입·파라미터 정보 + 내장 함수 시그니처 |
| Outline | `Ctrl+Shift+O` | 문서 내 심볼 구조 |
| Symbol Search | `Ctrl+T` | 워크스페이스 전체 심볼 검색 |
| Code Folding | — | Module/Class/Sub/Function 블록 접기 |
| Quick Fix | `Ctrl+.` | XML 개선·호환성 대안 제안 |

- `Project.gpr`이 있으면 `ProjectSource`에 등록된 파일만 우선 인덱싱 (대형 워크스페이스 최적화)
- GPL/VB.NET은 대소문자 무시 언어 — 심볼 비교에 자동 반영
- `Math.Abs`, `CInt`, `Thread.Sleep`, `Controller.Timer` 등 주요 내장 API에 시그니처·요약·참고 링크 제공

## 명령어

### 연결·배포·실행

| 명령 | 설명 |
|---|---|
| `GPL: Connect to Controller` / `Disconnect Controller` | 제어기 연결/해제 |
| `GPL: Deploy (/GPL 업로드 + Compile, Start 없음)` | UPLOAD ∥ STOP → COMPILE — 로컬 코드 업로드 후 검증 |
| `GPL: 빠른 컴파일` | 변경분만 /GPL에 직접 업로드 + Compile (STOP/START 생략) |
| `GPL: Start` | 실행만 (배포 없음) |
| `GPL: Save to Flash` | `/flash/projects`에 영구 저장만 |
| `GPL: 모든 쓰레드 중지` | `Stop -all` 전체 정지 |

> **FTP 패널의 "업로드된 복사본 컴파일 & 실행" 주의**: 제어기에 **이미 업로드된 복사본만**
> 대상으로 하며 로컬 변경사항을 업로드하지 않습니다. 최신 로컬 코드 검증은 Deploy를 사용하세요.

### 디버깅·모니터링

| 명령 | 설명 |
|---|---|
| `GPL: Quick Debug Attach (No launch.json)` | launch.json 없이 즉시 Attach |
| `GPL: Create/Update Debug launch.json` | Attach 구성 자동 생성 |
| `GPL: Push/Pull Controller Breakpoints` | 에디터 ↔ 제어기 브레이크포인트 동기화 |
| `GPL: Start/Stop Runtime Console` | 1403 런타임 콘솔 시작/중지 |
| `GPL: Start/Stop Live Log Terminal` | 1402/1403 실시간 로그 터미널 |
| `GPL: Show Traffic Monitor` | TCP 트래픽 모니터 |
| `GPL: Send Command to Controller` | 콘솔 명령 직접 전송 |
| `GPL: 전역변수 보기/편집` / `DIO 조회/설정` | 전역변수·DIO 조회/변경 |
| `GPL: Refresh All` | 쓰레드·FTP·시스템 정보 전체 새로고침 |

### AI 에이전트용

| 명령 | 설명 |
|---|---|
| `GPL: Copy Situation for Chat` | 현재 상태(연결/쓰레드/최근 배포 결과/에러)를 Markdown으로 클립보드 복사 |
| `GPL: Diagnostic Snapshot` | 진단 스냅샷 |
| `GPL: AI Debug Assist` | 연결 → 스냅샷 → Build Only → (옵션)콘솔/Attach를 모드별 일괄 실행 |
| `gpl.ai.debug.*` | Break/Step/Continue/변수평가/상태수집/조건 루프 — AI 자율 디버깅 API |

AI 에이전트는 직접 FTP/TCP 자동화로 확장 경로를 우회하지 않고 위 명령과 DAP 세션을
사용합니다. 전체 Command ID 목록, 권장 실행 순서, STATUS 코드 판단표는
[ai-controller-debugging-runbook.md](docs/development/ai-controller-debugging-runbook.md) 참고.

## 설정

`settings.json`에서 `gpl.*` 키로 설정. 주요 키:

| 설정 | 기본값 | 설명 |
| --- | --- | --- |
| `gpl.controller.ip` | `192.168.0.1` | Brooks 제어기 IP |
| `gpl.controller.port` | `1402` | TCP 명령 포트 |
| `gpl.controller.consolePort` | `1403` | 런타임 출력 이벤트 포트 |
| `gpl.controller.timeoutMs` | `10000` | 명령 타임아웃 (ms) |
| `gpl.controller.ftpBasePath` | `/GPL` | FTP 기본 경로 |
| `gpl.trace.server` | `off` | 로그 수준 (`off` / `messages` / `verbose`) |

이 외 전체 설정(1403 재연결 튜닝 `gpl.runtimeConsole.*`, 자동 시작, 폴링 간격 등)은
Settings UI에서 `gpl.` 검색으로 확인할 수 있습니다.

- 제어기 연결 성공 시 1403 출력 이벤트 소비자도 함께 연결되고, 연결 해제 시 함께 정리됩니다.

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
  - 먼저 Deploy(Build Only)로 실패 단계(STOP/UPLOAD/COMPILE) 분리 확인
  - Output 패널의 "GPL Language Support" 로그 확인

## 문서

- 변경 이력: [CHANGELOG.md](CHANGELOG.md)
- 제어기 디버깅 절차·Command ID·STATUS 판단표: [docs/development/ai-controller-debugging-runbook.md](docs/development/ai-controller-debugging-runbook.md)
- 설계 원칙: [docs/development/design-principles.md](docs/development/design-principles.md)
- GPL 언어/레퍼런스 문서: `docs/gpl-language/`, `docs/reference/`
- 릴리스 절차(버전 관리 규칙 포함): `docs/releases/`
- 문서 사이트: `mkdocs serve` (또는 `npm run docs:serve`) — Material for MkDocs

## 개발

요구사항: Node.js 16+, VS Code `^1.74.0`

```bash
npm install           # 의존성 설치
npm run compile       # TypeScript → out/
npm run watch         # 감시 모드
npm run package       # 버전 bump + VSIX 생성 (dist/)
npm test              # 컴파일 + 테스트
```

확장 디버그 실행: 터미널에서 `npm run dev:watch`(감시 컴파일) 실행 후 F5 →
**"Run Extension (no compile)"**. 처음이거나 재시작이 필요하면 F5 → **"Run Extension"**(자동 컴파일).
로그는 Output 패널 **"GPL Language Support"** 채널, 배포 상세는 **"GPL Deploy (Debug)"** 채널에서 확인합니다.

## 기여

이슈 리포트와 Pull Request를 환영합니다.
[GitHub Issues](https://github.com/nir414/GPL_language/issues)
