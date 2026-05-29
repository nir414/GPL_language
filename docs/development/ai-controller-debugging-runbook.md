# AI Controller Debugging Runbook

GPL Language Support 확장을 통해 AI 에이전트가 Brooks GPL 제어기 디버깅을 보조할 때 쓰는 실행 절차다.

## 목표

- 최신 로컬 코드가 제어기에 올라갔는지 확인한다.
- 컴파일/로드/실행/중단점/런타임 로그를 같은 증거 묶음으로 본다.
- 직접 FTP/임의 TCP 자동화 대신 확장의 명령, DAP, 로그 채널을 사용한다.
- 상태 변경 명령은 대상 thread/project와 사용자 의도를 확인한 뒤 실행한다.

## 빠른 경로

1. `GPL: Connect to Controller`
2. `GPL: Copy Situation for Chat`
3. `GPL: Deploy (Build Only)`
4. 실패 시 Debug Console의 `[deploy]` 블록과 `GPL Deploy (Debug)` Output 확인
5. 성공 시 `GPL: Start Runtime Console`
6. `.gpl` 파일에 breakpoint 설정
7. F5 `Attach to GPL Controller`
8. 정지 시 Call Stack, Variables, Debug Console, GPL Console을 함께 확인

## 준비 체크

| 항목 | 확인 위치 |
| --- | --- |
| 제어기 IP | `gpl.controller.ip` |
| 명령 포트 | `gpl.controller.port` 기본 1402. 공식 문서상 GDE editor port |
| 런타임 콘솔 포트 | `gpl.controller.consolePort` 기본 1403. 공식 GDE 범위 안에서 로컬 구현/실측상 runtime event stream으로 사용 |
| FTP 경로 | `gpl.controller.ftpBasePath`, `gpl.controller.ftpFlashProjectsPath` |
| 프로젝트명 | `Project.gpr`의 `ProjectName` 또는 launch `projectName` |
| 최신 빌드 | `GPL: Deploy (Build Only)` 성공 여부 |

## Command ID 목록

AI 도구가 VS Code extension command를 실행할 수 있는 환경이면 아래 ID를 사용한다. 사람이 실행할 때는 Command Palette 제목을 사용한다.

| 목적 | 제목 | Command ID |
| --- | --- | --- |
| 연결 | GPL: Connect to Controller | `gpl.controller.connect` |
| 연결 해제 | GPL: Disconnect Controller | `gpl.controller.disconnect` |
| Build Only | GPL: Deploy (Build Only) | `gpl.deploy` |
| 배포 후 실행 | GPL: Deploy & Run | `gpl.deployRun` |
| launch 생성 | GPL: Create/Update Debug launch.json | `gpl.debug.generateLaunch` |
| 빠른 Attach | GPL: Quick Debug Attach (No launch.json) | `gpl.debug.attachNow` |
| 런타임 콘솔 시작 | GPL: Start Runtime Console | `gpl.console.start` |
| 런타임 콘솔 중지 | GPL: Stop Runtime Console | `gpl.console.stop` |
| 런타임 콘솔 보장 | GPL: Ensure Runtime Console (1403) | `gpl.console.ensure` |
| 라이브 로그 시작 | GPL: Start Live Log Terminal | `gpl.logs.liveTerminal.start` |
| 라이브 로그 중지 | GPL: Stop Live Log Terminal | `gpl.logs.liveTerminal.stop` |
| 전체 새로고침 | GPL: Refresh All | `gpl.threads.refresh` |
| 트래픽 보기 | GPL: Show Traffic Monitor | `gpl.controller.showTraffic` |
| 직접 명령 | GPL: Send Command to Controller | `gpl.controller.sendCommand` |
| 상태 복사 | GPL: Copy Situation for Chat | `gpl.controller.copySituationForChat` |
| 진단 스냅샷 | GPL: Diagnostic Snapshot | `gpl.diagnosticSnapshot` |
| 전체 정지 | GPL: 모든 쓰레드 중지 | `gpl.controller.stopAll` / `gpl.stopAll` |

## 권장 launch 구성

```json
{
    "type": "brooks-gpl",
    "request": "attach",
    "name": "Attach to GPL Controller",
    "deployBeforeAttach": true,
    "projectName": "",
    "stopOnEntry": true,
    "stopAllBeforeAttach": false,
    "clearProjectBreakpointsOnAttach": true
}
```

다중 프로젝트 워크스페이스에서는 `projectDir`를 지정해 배포 대상을 고정한다.

```json
{
    "type": "brooks-gpl",
    "request": "attach",
    "name": "Attach GPL_Code",
    "deployBeforeAttach": true,
    "projectName": "GPL_Code",
    "projectDir": "${workspaceFolder}/GPL_Code",
    "clearProjectBreakpointsOnAttach": true
}
```

## 디버깅 절차

### 1. 연결

- `GPL: Connect to Controller` 실행
- 실패 시 `gpl.controller.ip`, 1402 포트, 네트워크/방화벽을 확인한다.
- 연결 직후 `GPL: Copy Situation for Chat`로 현재 상태를 캡처한다.

### 2. Build Only

- `GPL: Deploy (Build Only)`를 먼저 실행한다.
- 이 단계는 STOP -> UPLOAD -> COMPILE까지 수행하고 START는 하지 않는다.
- 실패하면 아래 순서로 본다.

```text
1. Debug Console: [GPL Debug] [deploy] 실패 단계
2. Debug Console: 실패 명령 / STATUS 코드
3. Debug Console: raw trace begin/end
4. Output: GPL Deploy (Debug)
5. Problems 패널의 컴파일 에러
```

### 3. 런타임 콘솔

- `GPL: Start Runtime Console` 또는 `GPL: Ensure Runtime Console (1403)` 실행
- 더 넓게 보려면 `GPL: Start Live Log Terminal` 실행
- 1403 no-payload는 코드 오류로 단정하지 않는다.
- Brooks 공식 문서 기준으로는 `1402~1404`가 GDE 포트 범위이고, `1402`가 GDE editor port다.
- `1403 = runtime console` 역할은 확장 구현과 실기 로그에서 검증한 동작으로 다루며, 공식 개별 역할 명시와는 분리해서 표현한다.
- `Console.WriteLine` 출력 destination은 실행 컨텍스트에 따라 GDE output window, `/dev/com1`, TELNET 등으로 달라질 수 있다.

| 1403 상태 | 해석 |
| --- | --- |
| payload 출력 | GPL `Console.WriteLine`/런타임 이벤트 수신 |
| Immediate EOF | 이벤트 큐가 비었거나 짧은 빈 세션 |
| Empty batch | payload 없는 배치 |
| Connection refused | 1403 서비스/포트 연결 실패 |
| no-payload streak | 반복 빈 세션, active thread와 함께 판단 |

### 4. Attach

- `.gpl` 파일에 breakpoint를 설정한다.
- F5로 `Attach to GPL Controller`를 실행한다.
- `deployBeforeAttach: true`이면 attach 전 배포 trace를 함께 본다.
- `clearProjectBreakpointsOnAttach: true`를 기본으로 둬 이전 세션 BP 잔재를 줄인다.

### 5. 정지 상태 분석

정지하면 아래를 함께 확인한다.

| 증거 | 확인 위치 |
| --- | --- |
| 현재 파일/라인 | 에디터, Call Stack |
| thread 상태 | GPL Controller > Status |
| 변수 | Variables 패널, Hover, Debug Console |
| stack | Call Stack, `Show Stack <thread>` |
| console 출력 | GPL Console, GPL Live Logs |
| controller error | ErrorLog, Error 섹션 |

### 6. Step/Continue

- Step Over/Into/Out은 Debug UI 또는 F10/F11을 사용한다.
- Continue 후 바로 다시 멈추면 위치, breakpoint hit count, 1403 이벤트를 같이 확인한다.
- 같은 위치 재정지는 루프 재히트, breakpoint 잔재, Continue 반영 지연을 구분한다.

### 7. Error thread

- Error thread는 먼저 위치와 ErrorLog를 복사한다.
- `Continue -noerror`는 실패한 instruction을 건너뛴다. 원인 분석 전 반복 사용하지 않는다.
- 시스템 에러와 GPL 코드 에러를 분리한다.

## 직접 콘솔 명령 기준

`GPL: Send Command to Controller`는 필요한 경우에만 사용한다.

VS Code 확장 명령을 사용할 수 없어서 raw TCP로 확인해야 할 때는 컨트롤러 명령을 XML로 감싸지 말고, plain text 명령 뒤에 CRLF를 붙여 ASCII로 보낸다. 예: `Show Thread` + `\r\n`. 응답은 보통 `</STATUS>`까지 읽는다.

PowerShell inline 명령에 XML처럼 보이는 angle-bracket 리터럴을 넣으면 일부 AI 실행 환경의 sandbox가 명령 실행 전 차단할 수 있다. raw TCP fallback이 꼭 필요하면 inline one-liner보다 workspace-local script file을 만들고 실행하는 패턴을 권장한다. 예시는 `tools/probe-controller.ps1` 형태처럼 host/port/command를 파라미터화하고, payload는 `Command + CRLF`로 구성한다.

### Read-only 우선 명령

```text
Show Thread
Show Thread <thread_name>
Show Stack <thread_name>
Show Break
Show Variable <thread_name> <frame> <name>
Show Global <name>
ErrorLog
Show StartupLog
Directory <path>
```

프로젝트 목록은 `Show Project`가 아니라 `Directory /flash/projects` 또는 설정된 FTP 프로젝트 경로로 확인한다. `Directory`는 path 인자가 필요하며, 단독 호출은 `-505`가 날 수 있다.

### 상태 변경 명령

아래 명령은 사용자 의도와 대상 확인 후 사용한다.

```text
Break <thread_name>
Continue <thread_name>
Continue <thread_name> -noerror
Step <thread_name>
Stop <thread_name>
Stop -all
Start <project_name>
Load <path>
Compile <project_name>
Unload <project_name>
Set Break ...
Set NoBreak ...
ErrorLog -clear
```

### 위험 명령

```text
Format
Shutdown
SoftEStop
```

사용자가 명시적으로 요청하지 않으면 실행하지 않는다.

## STATUS 코드 판단표

| 코드 | 1차 해석 | 다음 확인 |
| --- | --- | --- |
| `0` | 성공 | 응답 payload 확인 |
| `-508` | file not found | FTP 경로, `/GPL` vs `/flash/projects`, 프로젝트명 |
| `-505` | Directory 인자 누락 등 입력 부족 | `Directory <path>` 형태로 재시도 |
| `-714` | unknown command | 명령명 확인, 프로젝트 목록은 `Directory /flash/projects` 사용 |
| `-745` | project already exists 가능 | 이미 로드된 상태인지 확인 |
| `-742` / `-746` / `-752` | compile/load 일시 상태 가능 | raw trace, 자동 재시도 로그, 실제 compile error |
| `-1521` / `-1520` / `-1519` / `-1518` | controller 환경/parameter DB 문제 | GPL 코드 수정 전 제어기 환경 확인 |

## 보고 템플릿

```text
- 핵심:
- 증거:
- 판단:
- 다음 액션:
- Confidence:
```

예:

```text
- 핵심: Build Only는 COMPILE 단계에서 실패했고, 코드 컴파일 에러보다 경로 문제 가능성이 커.
- 증거: Debug Console [deploy] 실패 명령 `Load /GPL/GPL_Code`, STATUS -508.
- 판단: 제어기 FTP 경로에 프로젝트 복사본이 없거나 경로 기준이 다름.
- 다음 액션: `GPL: Refresh FTP Files` 후 `/GPL/GPL_Code` 존재 확인, 다시 Build Only.
- Confidence: 78%
```

## 금지/제약

- 제어기 명령을 병렬 실행하지 않는다.
- 직접 FTP 업로드 스크립트로 확장의 Deploy 경로를 우회하지 않는다.
- `out/` 산출물을 직접 수정하지 않는다.
- 로그/캐시/상태 파일을 워크스페이스에 자동 생성하지 않는다.
- 제어기 포트 역할(1402/1403/21/51417)을 바꾸지 않는다.


