# GPL Language Support

현재 버전: **v0.5.19**
GPL (Guidance Programming Language) 지원 VS Code 확장.
IntelliSense, 정의/참조 탐색, 호버, 코드 폴딩, **제어기 연결·배포·디버깅**까지 통합 제공합니다.

> GPL은 [Brooks Automation](https://www.brooksautomation.com/) PreciseFlex 로봇 제어기용 VB.NET 유사 언어입니다.

## 설치

1. [Releases](https://github.com/nir414/GPL_language/releases)에서 최신 `.vsix` 파일을 다운로드합니다.
2. VS Code → Extensions(`Ctrl+Shift+X`) → **…** → **Install from VSIX…** → 파일 선택
3. Reload 후 `.gpl` 파일을 열면 자동 활성화

> `npm run package` 실행 시 `dist/gpl-language-support-<version>.vsix`가 생성됩니다.

## 기능 요약

### 언어 기능

| 기능 | 단축키 | 설명 |
|---|---|---|
| Go to Definition | `F12` | 함수, 클래스, 변수 정의로 이동 |
| Find All References | `Shift+F12` | 심볼 사용 위치 전체 검색 |
| IntelliSense | `Ctrl+Space` | GPL 심볼 자동완성 |
| Hover Info | 마우스 올리기 | 심볼 타입·파라미터 정보 |
| Outline | `Ctrl+Shift+O` | 문서 내 심볼 구조 |
| Symbol Search | `Ctrl+T` | 워크스페이스 전체 심볼 검색 |
| Code Folding | — | Module/Class/Sub/Function 블록 접기 |
| Quick Fix | `Ctrl+.` | XML 개선·호환성 대안 제안 |

- `Project.gpr`이 있으면 `ProjectSource`에 등록된 파일만 우선 인덱싱 (대형 워크스페이스 최적화)
- GPL/VB.NET은 대소문자 무시 언어 — 심볼 비교에 자동 반영

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
    "projectName": "GPL_Code",
    "stopOnEntry": true
}
```

| 기능 | 지원 |
|---|---|
| 행 브레이크포인트 | `.gpl` 파일에서 설정 |
| Step Over / Step Into / Continue | F10 / F11 / F5 |
| 변수 조회 | Variables 패널, Hover, Debug Console |
| Call Stack / 쓰레드 | 다중 쓰레드 표시 |
| stopOnEntry | 첫 줄 자동 정지 |

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

## 설정

`settings.json`에서 `gpl.*` 키로 설정:

| 설정 | 기본값 | 설명 |
|---|---|---|
| `gpl.trace.server` | `off` | 로그 수준 (`off` / `messages` / `verbose`) |
| `gpl.controller.ip` | `192.168.0.2` | Brooks 제어기 IP |
| `gpl.controller.port` | `1402` | TCP 명령 포트 |
| `gpl.controller.consolePort` | `1403` | 런타임 콘솔 포트 |
| `gpl.controller.timeoutMs` | `10000` | 명령 타임아웃 (ms) |
| `gpl.controller.ftpBasePath` | `/GPL` | FTP 기본 경로 |
| `gpl.controller.threadPollIntervalMs` | `5000` | 쓰레드 폴링 간격 (ms) |

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
