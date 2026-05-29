---
description: "Use when an AI agent helps debug a Brooks GPL controller through GPL Language Support. Covers safe command order, VS Code command IDs, DAP attach flow, evidence collection, and forbidden direct-control paths."
---

# AI Controller Debugging Workflow

이 지침은 AI 에이전트가 GPL Language Support 확장을 사용해 제어기 상태를 진단하거나 디버깅을 보조할 때 적용한다.

## 핵심 원칙

- 제어기 조작은 GPL Language Support 확장의 VS Code 명령, DAP 세션, TreeView 액션을 우선 사용한다.
- 제어기 TCP 명령은 병렬로 보내지 않는다.
- Stop, Deploy, Compile, Start, Continue, Step 같은 상태 변경 명령은 사용자의 의도를 확인한 뒤 실행한다.
- 직접 FTP 업로드, 별도 PowerShell 업로드 스크립트, 임의 TCP/FTP 자동화로 확장 경로를 우회하지 않는다.
- 확장으로 얻은 증거를 우선한다: Debug Console, GPL Language Support Output, GPL Deploy (Debug), GPL Console, GPL Live Logs, Copy Situation for Chat.
- Brooks 공식 문서, `docs/reference/console-commands.md`, 로컬 코드/로그 순으로 근거 우선순위를 둔다.

## 먼저 수집할 증거

1. `GPL: Copy Situation for Chat` (`gpl.controller.copySituationForChat`)
2. `GPL: Diagnostic Snapshot` (`gpl.diagnosticSnapshot`)
3. `GPL: Show Traffic Monitor` (`gpl.controller.showTraffic`)
4. `GPL: Start Live Log Terminal` (`gpl.logs.liveTerminal.start`)
5. Debug Console의 `[GPL Debug]` 로그
6. Output 패널의 `GPL Language Support`, `GPL Deploy (Debug)`, `GPL Console`

## 권장 진행 순서

1. 연결 확인
   - 설정: `gpl.controller.ip`, `gpl.controller.port`, `gpl.controller.consolePort`
   - 명령: `GPL: Connect to Controller` (`gpl.controller.connect`)
   - 실패하면 포트/IP/방화벽/제어기 상태부터 확인한다.

2. 최신 코드 검증
   - 먼저 `GPL: Deploy (Build Only)` (`gpl.deploy`)로 STOP -> UPLOAD -> COMPILE 단계만 확인한다.
   - 성공 전에는 Attach 디버깅으로 넘어가지 않는다.
   - 실패하면 실패 단계, 실패 명령, STATUS 코드, raw trace를 먼저 읽는다.

3. 런타임 로그 확보
   - `GPL: Start Runtime Console` (`gpl.console.start`)
   - 필요 시 `GPL: Start Live Log Terminal` (`gpl.logs.liveTerminal.start`)
   - 1403 no-payload는 즉시 코드 오류로 단정하지 않는다. Idle, Immediate EOF, 연결 거절을 구분한다.

4. Attach 디버깅
   - `GPL: Create/Update Debug launch.json` (`gpl.debug.generateLaunch`)로 구성을 만든다.
   - 권장 launch 옵션:

```json
{
    "type": "brooks-gpl",
    "request": "attach",
    "name": "Attach to GPL Controller",
    "deployBeforeAttach": true,
    "stopOnEntry": true,
    "stopAllBeforeAttach": false,
    "clearProjectBreakpointsOnAttach": true,
    "projectName": ""
}
```

5. 중단점/스텝 분석
   - `.gpl` 파일에 브레이크포인트를 설정한다.
   - F5, F10, F11 또는 Debug UI를 사용한다.
   - Thread TreeView의 `Break`, `Continue`, `Step`, `Stop` 액션은 현재 상태와 대상 thread를 확인한 뒤 실행한다.

6. 에러 분석
   - Error thread가 있으면 `Show Thread`, `Show Stack`, `ErrorLog` 증거를 비교한다.
   - 시스템 에러 코드(-1521, -1520, -1519, -1518)는 GPL 코드 오류로 단정하지 않는다.
   - `Continue -noerror`는 실패한 instruction을 건너뛰므로 원인 분석용으로만 조심해서 사용한다.

## VS Code command ID quick reference

| 목적 | Command Palette | Command ID | 주의 |
| --- | --- | --- | --- |
| 연결 | GPL: Connect to Controller | `gpl.controller.connect` | 설정 IP/포트 확인 |
| 연결 해제 | GPL: Disconnect Controller | `gpl.controller.disconnect` | 1403도 함께 정리 |
| Build Only | GPL: Deploy (Build Only) | `gpl.deploy` | 최신 로컬 코드 검증 기본 경로 |
| 배포 후 실행 | GPL: Deploy & Run | `gpl.deployRun` | 실행 상태 변경 |
| launch 생성 | GPL: Create/Update Debug launch.json | `gpl.debug.generateLaunch` | Attach 구성 생성 |
| 빠른 Attach | GPL: Quick Debug Attach (No launch.json) | `gpl.debug.attachNow` | 임시 디버깅 |
| 런타임 콘솔 시작 | GPL: Start Runtime Console | `gpl.console.start` | 1403 payload 확인 |
| 라이브 로그 시작 | GPL: Start Live Log Terminal | `gpl.logs.liveTerminal.start` | 1402/1403 관찰 |
| 상태 복사 | GPL: Copy Situation for Chat | `gpl.controller.copySituationForChat` | AI 공유 우선 증거 |
| 진단 스냅샷 | GPL: Diagnostic Snapshot | `gpl.diagnosticSnapshot` | 상태 캡처 |
| 트래픽 보기 | GPL: Show Traffic Monitor | `gpl.controller.showTraffic` | 명령/응답 확인 |
| 전체 정지 | GPL: 모든 쓰레드 중지 | `gpl.controller.stopAll` / `gpl.stopAll` | 상태 변경, 확인 필요 |
| 직접 명령 | GPL: Send Command to Controller | `gpl.controller.sendCommand` | read-only 우선 |

## 상태 변경 명령 가드

아래 명령은 실행 전 대상과 의도를 확인한다.

- `gpl.deployRun`
- `gpl.controller.stopAll`
- `gpl.controller.threadStart`
- `gpl.controller.threadStop`
- `gpl.controller.threadBreak`
- `gpl.controller.threadContinue`
- `gpl.controller.threadContinueNoError`
- `gpl.controller.threadStep`
- `gpl.controller.ftpRun`
- `gpl.controller.ftpStop`
- `gpl.controller.ftpDelete`
- `gpl.controller.ftpUnload`
- `gpl.controller.clearErrors`

## 직접 콘솔 명령 사용 기준

`GPL: Send Command to Controller`를 사용할 때는 read-only 명령부터 사용한다.

- 우선 허용: `Show Thread`, `Show Stack <thread>`, `Show Break`, `Show Variable ...`, `Show Global ...`, `ErrorLog`, `Show StartupLog`, `Directory`
- 주의 필요: `Break`, `Continue`, `Step`, `Stop`, `Start`, `Load`, `Compile`, `Unload`, `Set Break`, `Set NoBreak`
- 금지에 가까움: `Format`, `Shutdown`, `SoftEStop`은 사용자가 명시적으로 요청한 상황이 아니면 실행하지 않는다.

## 실패 해석 체크

- `STATUS -508`: 파일/경로 없음. FTP 경로, `/GPL` vs `/flash/projects`, 프로젝트명 대소문자 확인.
- `STATUS -745`: 이미 로드된 프로젝트일 수 있다. 문맥 없이 치명 실패로 단정하지 않는다.
- `STATUS -742/-746/-752`: 컴파일/로드 일시 상태 가능. raw trace와 재시도 로그를 확인한다.
- 1403 `Immediate EOF`: 이벤트 큐가 비어 있을 수 있다. 반복 횟수와 active thread를 같이 본다.
- 1403 `Connection refused`: 런타임 콘솔 서비스/포트 상태를 우선 확인한다.
- ErrorLog의 제어기 시스템 코드와 GPL 코드 예외를 분리한다.

## 보고 형식

AI가 사용자에게 보고할 때는 다음 순서를 선호한다.

```text
- 핵심:
- 증거:
- 판단:
- 다음 액션:
- Confidence:
```

증거에는 명령 이름, command ID, STATUS 코드, 로그 채널 이름, thread/file/line을 포함한다.
