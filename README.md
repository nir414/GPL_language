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
- **사이드바 GPL Controller 패널**: 연결 정보, 쓰레드 실시간 상태/개별 제어(정지·일시정지·재개·
  Step Over/Into/Out·스택 보기), 제어기 브레이크포인트 목록, FTP 파일 관리(컴파일/실행/다운로드/삭제 · 폴더 통째로 비우기),
  시스템 정보, 에러 로그
- **실시간 로그 터미널**: 1402/1403 트래픽을 VS Code 터미널에 미러링 (파일 미생성, 메모리 버퍼만 사용)
- **제어기 대시보드 탭**: 연결·고전원·스레드·에러 상태 배지, 스레드 표, 축 위치 게이지, XY 미니 플롯, 에러 로그를
  새 탭에서 실시간 표시(주기 선택·일시정지). 연결 중 상태바의 대시보드 아이콘으로 진입

> ⚠️ **알려진 제한 — 1403 수신**: 1403 출력 이벤트 수신은 실기기에서 안정 동작을 확보하지
> 못했습니다(연결은 되지만 payload가 없는 경우가 많음). `[1403]` 출력은 as-is로 제공되며,
> `[1402]` 명령 트래픽 미러링은 정상 사용 가능합니다.

### 디버거 (DAP)

`brooks-gpl` 디버그 어댑터로 Attach 모드 디버깅: 행 브레이크포인트, Step Over/Into/Out(F10/F11/Shift+F11),
Continue(F5), Pause(F6), 변수 조회(Variables/Hover/Debug Console), Call Stack·다중 쓰레드 표시.
런타임 Error 발생 시 해당 파일/라인을 자동으로 열고 이동합니다.

- 단축키는 VS Code 표준 그대로입니다(F9 = 브레이크포인트 토글). GDE 습관(F9 = Continue)이 필요하면
  `gpl.keybindings.gdeStyle`을 켭니다.
- **스레드 단일 실행 잠금**: CALL STACK에서 스레드 우클릭 → `GPL: 스레드 실행 잠금`(팔레트: `GPL: 스레드 실행 잠금 토글`).
  잠금 중에는 Continue/Step이 포커스와 무관하게 잠근 스레드에만 나가고, 다른 스레드가 정지해도 디버그 포커스를
  가져가지 않습니다. 상태바 `$(lock) 스레드 잠금: <이름>`을 클릭하면 해제됩니다. 추가로 재개되는 스레드는 없습니다
  (제어기 실행 명령은 원래 스레드 단위이며, 잠금은 대상을 좁히기만 합니다).
- **커서까지 이동(Jump to Cursor)**: 정지 중 편집기 우클릭 → `커서까지 이동`으로 다음 실행 문장을 옮깁니다
  (제어기 `Set Thread <스레드> -line <줄>`). **건너뛴 문장은 실행되지 않으므로** 초기화·안전 조건이 빠진 채
  진행될 수 있어 기본값은 실행 직전 경고 확인입니다(`gpl.debug.jumpToCursor`: `warn`/`on`/`off`).
  대상 줄은 문서 제약대로 같은 프로시저 안의 실행 문장이어야 하며, 확장이 파서로 미리 확인합니다.
- **Step Into Target**: 한 줄에 호출이 여러 개면 F11 대신 우클릭 → `Step Into Target`으로 들어갈 호출을 고릅니다.
  제어기 Step에는 대상 지정이 없어 정의 위치에 임시 브레이크포인트를 걸고 Continue한 뒤 정리합니다(실패 시 기본 Step).
- **프로시저 이름 브레이크포인트**: BREAKPOINTS 뷰의 함수 중단점에 `Class.Proc`을 입력하면 파서가 정의 위치를 찾아
  그 프로시저 첫 실행 줄에 설정합니다.
- **브레이크포인트 줄 보정**: 빈 줄·주석에 BP를 찍으면 제어기가 다음 실행 문장으로 옮기는데(공식 문서 규칙),
  확장이 그 줄을 미리 계산해 같은 위치에 설정하고 이유를 BP 메시지로 알려 줍니다. 동시 BP 상한(문서상 32개)을
  넘으면 경고합니다.
- **조건부 BP·히트 조건·로그포인트**(기본 꺼짐, `gpl.debug.clientSideBreakpointLogic`): 제어기에 조건 개념이 없어
  확장이 적중 시 조건을 평가하고 **불일치하면 자동으로 Continue**합니다. 자동 재개는 모션을 다시 움직이므로
  기본값을 꺼짐으로 두었고, 켜면 VS Code의 조건·히트 수·로그 메시지 입력이 나타납니다.
- 변수 값에 16진수를 함께 보려면 `gpl.debug.integerHex`(비트마스크 DataID 읽을 때 유용). VARIABLES/WATCH의
  '값 복사'는 표시용 접미 없이 원문을 복사합니다.
- 이전 Step/Continue의 정지가 확인되기 전에 들어온 같은 쓰레드의 Step/Continue 요청은 무시됩니다
  (키 자동 반복으로 Step이 수백 건 연속 송신되어 제어기가 다운된 사고 방지, `gpl.debug.minStepIntervalMs`).
  디버거 밖(트리·AI 명령·URI)에서 보내는 Step/Continue도 확장의 명령 정책이 정지 확인 뒤에만 보냅니다.
- **Attach only(`deployBeforeAttach: false`)** 로 붙을 때 마지막 Compile 이후 편집된 소스가 있으면 상태바에
  `⚠ 소스 변경됨 N — BP 신뢰 불가` 배지가 뜨고 해당 파일의 브레이크포인트는 회색(unverified)으로 표시됩니다
  (제어기는 시작 시점 컴파일 코드를 실행하므로 줄 번호가 어긋남). 배지를 클릭해 Stop + Upload + Run 으로 재시작할 수 있습니다.

**디버그 단축키 (VS Code 표준)** — 확장이 표준 키를 덮어쓰지 않습니다.

| 단축키 | 기능 | 이 확장에서의 동작 |
|---|---|---|
| `F5` | Start / Continue | 세션 없으면 attach(설정에 따라 Deploy 후), 정지 중이면 `Continue <스레드>` |
| `F6` | Pause | 대상 스레드에 `Break <스레드>` (전체 정지가 아님) |
| `F9` | Toggle Breakpoint | `Set Break <프로젝트> "<파일>"<줄>` / 해제는 `Set Nobreak …` (GDE 캡처 구문) |
| `F10` | Step Over | `Step <스레드> -over -noerror` |
| `F11` | Step Into | `Step <스레드> -noerror` |
| `Shift+F11` | Step Out | `Step <스레드> -out -noerror` |
| `Shift+F5` | Stop | 디버거만 분리하고 제어기 BP를 전부 해제합니다. 프로젝트 실행은 유지 — 함께 정지하려면 launch 구성에 `stopAllOnDisconnect: true`, 개별 스레드 중지는 CALL STACK 우클릭 "스레드 종료"(`Stop <스레드>`) |
| `Ctrl+Shift+F5` | Restart | 어댑터에 재시작 요청이 없어 VS Code가 종료 후 다시 attach합니다(`deployBeforeAttach: true`면 재배포·재컴파일이 따라옵니다 — 주의) |
| `Ctrl+F5` | Run Without Debugging | attach 전용 구성이라 의미가 없습니다. 디버거 없는 실행은 `GPL: Start` |
| `Ctrl+Shift+D` | Run and Debug View | VS Code 표준 |

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
| `projectName` | 제어기 쪽 프로젝트 이름(`Start`/브레이크포인트 명령에 사용). 생략하면 `.gpr`에서 결정 |
| `projectDir` | 배포 대상 폴더 고정. 생략하고 프로젝트가 여러 개면 F5 시점에 QuickPick으로 묻습니다 |
| `stopAllBeforeAttach` | attach 직전 `Stop -all`로 다른 프로젝트 쓰레드 간섭 차단 |
| `clearProjectBreakpointsOnAttach` | attach 직전 대상 프로젝트의 기존 제어기 브레이크포인트 정리 |
| `startStackSizeKb` | `Start -stack <KB>` — 시작 쓰레드의 프로시저 스택 크기(문서 기본 4 KB, 1~1024) |
| `startShowInitStatements` | `Start -init` — 스텝/트레이스 중 초기화 문장도 표시 |
| `startTrace` | `Start -trace` — 실행 문장을 콘솔에 표시(문서가 성능 저하를 경고 — 진단용) |

- `Start`에는 기본으로 `-event`가 붙습니다(`gpl.controller.startEventMode`). 공식 문서상 `-event`는 쓰레드 상태
  변경을 콘솔 메시지가 아니라 **이벤트로** 보내며, GDE도 항상 이 형태를 사용합니다. `-compile`은 어떤 경우에도
  붙이지 않습니다(제어기 Start가 자체 컴파일).

### 언어 기능

| 기능 | 단축키 | 설명 |
|---|---|---|
| Go to Definition | `F12` | 함수, 클래스, 변수 정의로 이동 (`New Thread("Class.Proc",...)` 문자열 참조 포함) |
| Find All References | `Shift+F12` | 심볼 사용 위치 전체 검색 |
| IntelliSense | `Ctrl+Space` | GPL 심볼·멤버·로컬 변수 자동완성, Signature Help |
| 문 스니펫 | 줄 시작에서 키워드 입력 | `Try`·`Select`·`For`·`While`·`Do`·`If` 제어 구조와 `Sub`/`Function`/`Property`/`Module`/`Class`/`Dim`/`Const`/`ReDim`/`Delegate` 선언 골격을 `Tab` 이동 자리와 함께 삽입. 공식 Statement Dictionary 구문을 따르고(`End While`, `Select match_value`, `Set (value As …)`), 그 자리에서 유효한 문만 제안(`Else`는 `If` 안, `Exit For`는 `For` 안) |
| 키워드 완성 | `Ctrl+Space` | 키워드·원시 타입(`Integer`, `Single` …)·낱말 연산자(`Mod`, `AndAlso`, `Is` …)를 설명과 함께 제안 |
| Hover Info | 마우스 올리기 | 심볼 타입·파라미터 정보 + 내장 함수 시그니처. 클릭 뒤 마우스를 멈춰도 다시 표시하려면 `gpl.hover.showAfterClick` |
| 문서화 주석 | `'''` | 선언 위 `'` 주석에 `# Parameters` / `# Returns` / `# Examples`를 쓰면 호버·자동완성·시그니처 도움말이 구조로 표시. `'''` 입력·전구 메뉴·`GPL: 문서화 주석 생성`으로 골격 생성(있으면 빠진 항목만 보완) |
| Outline | `Ctrl+Shift+O` | 문서 내 심볼 구조 |
| Symbol Search | `Ctrl+T` | 워크스페이스 전체 심볼 검색 |
| Code Folding | — | Module/Class/Sub/Function·If/Select/For/While/Do/Try 블록과 `' #region` 접기 |
| Quick Fix | `Ctrl+.` | XML 개선·호환성 대안 제안 |

- `Project.gpr`이 있으면 `ProjectSource`에 등록된 파일만 우선 인덱싱 (대형 워크스페이스 최적화)
- GPL/VB.NET은 대소문자 무시 언어 — 심볼 비교에 자동 반영
- `Math.Abs`, `CInt`, `Thread.Sleep`, `Controller.Timer` 등 주요 내장 API에 시그니처·요약·참고 링크 제공
- 문서화 주석 형식 — 설명은 항상, 나머지는 해당될 때만 씁니다:

  ```gpl
  ' 값을 지정된 범위로 제한합니다.
  '
  ' # Parameters
  ' - `value`: 제한할 값
  ' - `min`: 최솟값
  ' - `max`: 최댓값
  '
  ' # Returns
  ' 범위가 적용된 값
  Public Function Clamp(value As Number, min As Number, max As Number) As Number
  ```

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

- 대상 프로젝트는 `.gpr`가 있는 폴더입니다. 워크스페이스에 여러 개면 QuickPick으로 고르고(최근 선택이 맨 위),
  **탐색기에서 프로젝트 폴더(`.gpr`가 들어 있는 폴더)를 우클릭**하면 선택 없이 그 프로젝트로 Deploy/빠른 컴파일/
  Debug Project/Start/Save to Flash를 실행할 수 있습니다. 제어기 쪽 프로젝트 이름은 `.gpr`의 `ProjectName`입니다.
- **`Project.gpr` 우클릭 → `GPL: Project.gpr 소스 목록 동기화`**: 폴더의 `.gpl`과 `ProjectSource` 목록을 대조해
  누락된 파일 추가·없는 파일 항목 제거를 확인 후 반영합니다(GDE 형식 유지). `.gpl`을 새로 만들거나 이름 변경·삭제하면
  반영할지 물어봅니다(`gpl.project.autoSyncSources`).

> **FTP 패널의 "업로드된 복사본 컴파일 & 실행" 주의**: 제어기에 **이미 업로드된 복사본만**
> 대상으로 하며 로컬 변경사항을 업로드하지 않습니다. 최신 로컬 코드 검증은 Deploy를 사용하세요.

### 디버깅·모니터링

| 명령 | 설명 |
|---|---|
| `GPL: Quick Debug Attach (No launch.json)` | launch.json 없이 즉시 Attach |
| `GPL: Debug Project (Deploy + Attach)` | 프로젝트를 골라(또는 탐색기 우클릭) 배포 후 Attach — launch.json 불필요 |
| `GPL: Create/Update Debug launch.json` | Attach 구성 자동 생성 |
| `GPL: Push/Pull Controller Breakpoints` | 에디터 ↔ 제어기 브레이크포인트 동기화 |
| `GPL: Start/Stop Runtime Console` | 1403 런타임 콘솔 시작/중지 |
| `GPL: Start/Stop Live Log Terminal` | 1402/1403 실시간 로그 터미널 |
| `GPL: Show Traffic Monitor` | 1402 송신 명령·수신 응답 본문(실시간, 줄 단위)과 1403 트래픽 모니터. 트리 `1402 통신 모니터` 항목에서 본문 표시 켜기/끄기·지우기 |
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
| `gpl.ai.debug.connect` / `disconnect` / `getConnectionState` | 비대화형 연결·해제·연결 상태 조회(`{ ok, connected, ip, port, debugSessionActive, runtimeConsole, deployLock, … }`) |
| `gpl.controller.connect({ ip?, port?, save?, silent? })` | 인자를 주면 입력 상자 없이 연결하고 결과를 반환(인자 없으면 종전 대화형) |
| URI `vscode://nir414.gpl-language-support/<gpl.command.id>?args=<JSON>` | 외부 진입점(`code --open-url`) — 이 확장의 **모든 명령**을 실행(`?key=value` 평면 인자, `/command?id=…`도 가능). 별칭 `/connect?ip&port`, `/disconnect`, `/getState`, `/dashboard`. 결과는 Output `[URI]`로 확인 |

**MCP 서버(`controller-mcp`)는 이 확장을 통해 제어기를 다룹니다.** 확장이 실행 중이면 MCP의 1402 명령이 확장 세션으로
라우팅되어(Agent Bridge, `gpl.agentBridge.enabled`) 세션 경쟁이 없고, MCP 도구 `extension_command`로 Deploy·Quick Compile·
브레이크포인트 동기화 같은 **확장 기능 자체**를 쓸 수 있습니다. 현재 경로는 `extension_status`로 확인합니다.

접근은 제한하지 않습니다. 제어기 안전 조건(Step/Continue 연타 방지, 정지 정착 전 Compile/Start 금지, Compile 직후
Start 완충)은 어느 경로로 명령을 보내든 확장의 **명령 정책**이 대신 기다려서 충족시킵니다(`gpl.controller.commandPolicyEnabled`,
개입 내용은 GPL Traffic `--- policy:` 줄). 한도 안에 충족되지 않으면 명령을 보내지 않고 `{ ok: false, error: "policy-hold" }`로 알립니다.

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
