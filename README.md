# Brooks GPL

현재 로컬 패키지: **0.14.0**

**[Brooks Automation](https://www2.brooksautomation.com/)(구 Precise Automation) PreciseFlex 로봇 제어기 개발을 VS Code에서 끝내기 위한 확장**입니다.

PreciseFlex 제어기의 프로그램은 [GPL(Guidance Programming Language)](https://www2.brooksautomation.com/Controller_Software/Introduction_To_The_Software/Guidance_Programming_Language/)이라는
VB.NET 유사 언어로 작성하는데, 공식 개발 환경(GDE)은 코드 탐색·자동완성 같은 현대적 편집
기능이 부족합니다. 이 확장은 그 간극을 메웁니다:

- **제어기 연동** — 명령 콘솔·런타임 콘솔·FTP(업로드) 통신으로 VS Code 안에서
  업로드 → 컴파일 → 실행 → 모니터링까지 수행
- **디버깅** — `brooks-gpl` 디버그 어댑터(DAP)로 브레이크포인트, 스텝 실행, 변수 조회
- **AI 에이전트 연동** — AI가 확장 명령만으로 배포/디버깅 루프를 돌릴 수 있는 명령 API 제공
- **언어 지원** — IntelliSense, 정의/참조 탐색, 호버, Outline, 코드 폴딩, 내장 API 문서

> GPL 언어 공식 레퍼런스: [Brooks Automation GPL Reference](https://www2.brooksautomation.com/Controller_Software/Introduction_To_The_Software/Guidance_Programming_Language/)

## 설치와 업데이트

Marketplace 게시 후에는 VS Code 확장 화면(`Ctrl+Shift+X`)에서
`@id:nir414.gpl-language-support`를 검색해 설치할 수 있습니다.
게시 여부는 Marketplace 검색 결과에서 확인하세요.

설치한 확장의 **Auto Update**가 켜져 있으면 새 버전을 자동으로 받습니다.
기존 VSIX로 설치했다면 Auto Update가 기본으로 꺼져 있으므로 확장 메뉴에서 확인하세요.
회사에서 관리하는 VS Code는 조직의 업데이트 정책이 적용될 수 있습니다.
오프라인 설치용 VSIX는 [GitHub Releases](https://github.com/nir414/GPL_language/releases)에서 제공합니다.

## 기능

### 디버거 (DAP)

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

- `Start`에는 기본으로 `-compile`과 `-event`가 붙습니다(`-event`는 `gpl.controller.startEventMode`로 조절).
  `-compile`이 없으면 제어기는 컴파일하지 않고 직전에 컴파일된 **옛 바이너리를 그대로 실행**하므로, 방금 올린
  소스가 반영되지 않습니다. `-event`는 쓰레드 상태 변경을 콘솔 메시지가 아니라 **이벤트로** 보내며(런타임 콘솔 스트림),
  GDE도 항상 이 형태를 사용합니다.

### 언어 기능

| 기능 | 단축키 | 설명 |
|---|---|---|
| Go to Definition | `F12` | 함수, 클래스, 변수 정의로 이동 (`New Thread("Class.Proc",...)` 문자열 참조 포함) |
| Find All References | `Shift+F12` | 심볼 사용 위치 전체 검색 |
| Rename Symbol | `F2` | 선언과 사용처를 한 번에 바꿉니다. 로컬 변수·파라미터는 감싸는 프로시저 안에서만, 모듈/클래스 심볼은 그 프로젝트와 참조 라이브러리 범위에서 바꾸고, `New Thread("Mod.Proc", …)` 같은 문자열 프로시저 참조와 함수 반환값 대입(`FunctionName = …`)도 함께 반영합니다. **F12로 정의에 갈 수 없는 식별자는 거부**하고(이름만 같은 무관한 코드를 텍스트 치환으로 망가뜨리지 않기 위해), 예약어·내장 심볼·같은 범위의 이름 충돌도 미리 막습니다 |
| IntelliSense | `Ctrl+Space` | GPL 심볼·멤버·로컬 변수 자동완성, Signature Help |
| 문 스니펫 | 줄 시작에서 키워드 입력 | `Try`·`Select`·`For`·`While`·`Do`·`If` 제어 구조와 `Sub`/`Function`/`Property`/`Module`/`Class`/`Dim`/`Const`/`ReDim`/`Delegate` 선언 골격을 `Tab` 이동 자리와 함께 삽입. 공식 Statement Dictionary 구문을 따르고(`End While`, `Select match_value`, `Set (value As …)`), 그 자리에서 유효한 문만 제안(`Else`는 `If` 안, `Exit For`는 `For` 안) |
| 키워드 완성 | `Ctrl+Space` | 키워드·원시 타입(`Integer`, `Single` …)·낱말 연산자(`Mod`, `AndAlso`, `Is` …)를 설명과 함께 제안 |
| Hover Info | 마우스 올리기 | 심볼 타입·파라미터 정보 + 내장 함수 시그니처. 클릭 뒤 마우스를 멈춰도 다시 표시하려면 `gpl.hover.showAfterClick` |
| 문서화 주석 | `'''` | 선언 위 `'` 주석에 `# Parameters` / `# Returns` / `# Examples`를 쓰면 호버·자동완성·시그니처 도움말이 구조로 표시. Module·Class·변수·상수 선언도 대상. `'''` 입력·전구 메뉴·`GPL: Insert Documentation Comment`으로 골격 생성(있으면 빠진 항목만 보완) |
| Outline | `Ctrl+Shift+O` | 문서 내 심볼 구조 |
| Symbol Search | `Ctrl+T` | 워크스페이스 전체 심볼 검색 |
| Code Folding | — | Module/Class/Sub/Function·If/Select/For/While/Do/Try 블록과 `' #region` 접기 |
| Try/Finally 호환성 안내 | — | 기본 해제. `gpl.diagnostics.tryWithoutCatch`를 켜면 Information 표시. GPL 4.2K5의 Error 정지 후 Continue에서 Finally 재실행 가능성을 안내하며, Catch 추가만으로 예방된다고 판단하지 않습니다. |
| Quick Fix | `Ctrl+.` | XML 개선·호환성 대안 제안 |

- `Project.gpr`이 있으면 `ProjectSource`에 등록된 파일만 우선 인덱싱 (대형 워크스페이스 최적화)
- GPL/VB.NET은 대소문자 무시 언어 — 심볼 비교에 자동 반영
- `Math.Abs`, `CInt`, `Thread.Sleep`, `Controller.Timer` 등 주요 내장 API에 시그니처·요약·참고 링크 제공
- 문서화 주석 형식 — 설명은 항상, 나머지는 해당될 때만 씁니다. Sub/Function/Property뿐 아니라
  Module·Class·모듈/클래스 멤버 변수·상수 선언 위에 써도 같은 자리(호버·자동완성)에 표시됩니다:

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

- 오버로드(같은 이름의 Sub/Function 여럿)는 주석을 복붙하지 않아도 됩니다 — **공통 문서는 이름 단위로 공유되고,
  오버로드별 차이만 개별 문서화**합니다. 가장 완전한 시그니처 하나에 전체 문서를 쓰고 나머지에는 차이 한 줄과
  그 오버로드에만 있는 매개변수만 쓰면, 호버·자동완성·시그니처 도움말이 빠진 조각(공통 설명·같은 이름의
  매개변수·같은 반환 타입의 Returns)을 형제 오버로드에서 채워 출처와 함께 표시합니다. `'''` 골격도 형제가 이미
  설명한 매개변수는 뺍니다. 어느 오버로드의 문서를 공통으로 삼을지는 선언 순서가 아니라 문서의 풍부함·매개변수
  유사도로 정합니다.

## 명령어

### 연결·배포·실행

| 명령 | 설명 |
|---|---|
| `GPL: Connect to Controller` / `Disconnect Controller` | 제어기 연결/해제 |
| `GPL: Upload Only` | `/GPL` 소스만 업로드 — 실행 중 프로그램을 멈추지 않고 Stop/Compile/Start 모두 생략 |
| `GPL: Quick Compile` | 변경분만 /GPL에 직접 업로드 + Compile (STOP/START 생략) — 패널 상단 아이콘 |
| `GPL: Upload & Start` | /GPL 업로드 ∥ STOP → Start(`-compile` 포함) — 패널 상단 아이콘 |
| `GPL: Deploy` | 전체 /GPL 업로드 + Compile, 실행하지 않음 |
| `GPL: Start` | 배포 없이 실행만 (이미 올라간 것을 다시 돌릴 때) |
| `GPL: Save to Flash` | `/flash/projects`에 영구 저장만 — `Sync` + 10초 안전 대기가 끝날 때까지 상태바에 전원 차단 금지 경고 |
| `GPL: Stop All Threads` | `Stop -all` 전체 정지 + 같은 제어기의 실행 중·대기 중 업로드/배포 취소 — 패널 상단 아이콘 |

- 대상 프로젝트는 `.gpr`가 있는 폴더입니다. 워크스페이스에 여러 개면 QuickPick으로 고르고(최근 선택이 맨 위),
  **탐색기에서 프로젝트 폴더(`.gpr`가 들어 있는 폴더)를 우클릭**하면 선택 없이 그 프로젝트로 Upload Only/Deploy/Quick Compile/
  Debug Project/Upload & Start/Start/Save to Flash를 실행할 수 있습니다. 제어기 쪽 프로젝트 이름은 `.gpr`의 `ProjectName`입니다.
- **`Project.gpr` 우클릭 → `GPL: Sync Project Sources`**: 폴더의 `.gpl`과 `ProjectSource` 목록을 대조해
  누락된 파일 추가·없는 파일 항목 제거를 확인 후 반영합니다(GDE 형식 유지). `.gpl`을 새로 만들거나 이름 변경·삭제하면
  반영할지 물어봅니다(`gpl.project.autoSyncSources`).

> **`Upload & Start`와 `Quick Compile`의 차이**: 확장이 보내는 `Start`에는 `-compile`이 붙어 컴파일까지
> 함께 수행되므로, Upload & Start는 `Compile`을 따로 보내지 않습니다(같은 컴파일을 두 번 하지 않기 위해서입니다).
> 그 대신 소스에 에러가 있으면 Problems 패널이 아니라 **Start 실패(STATUS)** 로만 드러납니다 —
> 에러 위치까지 보려면 `Quick Compile`로 확인하세요.

> **`Upload Only`는 업로드 전용입니다.** 실행 중인 프로그램과 현재 컴파일본을 그대로 두고 `/GPL` 소스만 갱신하며,
> 안전성이 확인되지 않은 원격 전용 파일 삭제도 보류합니다. 업로드 뒤에는 `컴파일 필요` 상태로 표시됩니다.
> 같은 제어기에 여러 프로젝트 업로드/배포를 연달아 요청하면 거부하지 않고 등록 순서대로 대기합니다. 실제 업로드
> 중에는 기존 배포 잠금을 유지하므로 Compile/Start가 겹치지 않습니다.

> **FTP 패널의 `Compile & Run`(업로드된 복사본 실행) 주의**: 제어기에 **이미 업로드된 복사본만**
> 대상으로 하며 로컬 변경사항을 업로드하지 않습니다. 최신 로컬 코드 검증은 Deploy를 사용하세요.

FTP 패널의 프로젝트 다운로드는 두 모드를 제공합니다. **Live Working Copy**는 로컬 저장 시 기본 autoOnSave 규칙에 따라
`/GPL/<프로젝트>` 작업 소스를 갱신할 수 있지만 `Save to Flash`는 자동 실행하지 않습니다. **Read-only Snapshot**은
autoOnSave·Quick Compile·Deploy/F5·Save to Flash를 차단합니다. 다운로드 후에는 **Controller 작업공간 열기**를 선택하세요.
처음 한 번 Extension Host가 다시 시작될 수 있지만, 같은 상위 폴더에 다음 프로젝트를 내려받으면 저장된
`gpl-controller-<host>.code-workspace`에 자동으로 보이므로 폴더를 다시 추가할 필요가 없습니다.

### 디버깅·모니터링

| 명령 | 설명 |
|---|---|
| `GPL: Debug: Attach Only` | 배포 없이 실행 중인 프로그램에 즉시 Attach — 패널 상단 아이콘 |
| `GPL: Debug Project` | 프로젝트를 골라(또는 탐색기 우클릭) 배포 후 Attach — launch.json 불필요 |
| `GPL: Create/Update launch.json` | Attach 구성 자동 생성 |
| `GPL: Sync Breakpoints` | 제어기를 에디터 기준으로 맞춥니다(에디터에 없는 잔재는 해제, 빠진 것은 설정) |
| `GPL: Pull Breakpoints from Controller` | 반대 방향 — 제어기에 걸린 중단점을 에디터로 가져옵니다 |
| `GPL: Promote Source for Breakpoint` | 라이브러리로 딸려 온 소스에 중단점을 걸 수 있게 메인 `.gpr` 의 `ProjectSource` 로 올립니다(`.gpl` 우클릭). 빠지는 파일도 중복 컴파일도 없는지 검증한 뒤 diff 미리보기와 확인을 거쳐서만 저장 |
| `GPL: Start/Stop Runtime Console` | 런타임 콘솔 시작/중지 — 패널 트리의 `런타임 콘솔` 항목 우클릭 |
| `GPL: Start/Stop Live Log Terminal` | 명령 콘솔·런타임 콘솔 실시간 로그 터미널 — 같은 항목 우클릭 |
| `GPL: Show Traffic Monitor` | 명령 콘솔 송신 명령·수신 응답 본문(실시간, 줄 단위)과 런타임 콘솔 트래픽 모니터 — 패널 트리의 `통신 모니터` 항목에서 열고 본문 표시 켜기/끄기·지우기 |
| `GPL: Send Command to Controller` | 콘솔 명령 직접 전송 |
| `GPL: Open Digital I/O Panel` | 대시보드의 **디지털 I/O** 탭 — 전체 신호 ON/OFF·강제 상태, 번호 검색·필터, 확인 후 강제 ON/OFF/해제 |
| `GPL: Show/Set Global` / `Show DIO` / `Set DIO` | 전역변수·DIO 원시 명령(팔레트·외부 호출 호환용) |
| `GPL: Refresh All` | 쓰레드·FTP·시스템 정보 전체 새로고침 — 패널 상단 아이콘 |

디버깅 중에는 Debug Console에 명령을 여러 줄 붙여 넣어 위에서 아래로 순차 실행할 수 있습니다. `Show Thread -web`·
`ErrorLog` 같은 읽기 전용 명령은 그대로 쓰고, `Stop`·`Break`·`Execute` 같은 상태 변경 명령은 각 줄 앞에 `>`를 붙입니다.
상태 변경 명령이 여러 개면 전체 묶음을 실행하기 전에 한 번만 확인합니다. `>`를 빠뜨린 상태 변경 명령은 전송하지 않고
Debug Console에 그 사실과 올바른 입력 예를 표시합니다.

> **중단점이 회색으로 안 걸릴 때**: 제어기는 중단점 대상 파일을 그 프로젝트가 `.gpr` 에 **직접 적은**
> `ProjectSource` 안에서만 찾습니다. `ProjectLibrary` 로 참조해 들어온 소스는 어떤 표기를 써도
> `-508 File not found` 가 되므로, 라이브러리를 겹겹이 참조하는 구조에서는 `GPL: 브레이크포인트용 소스 승격`
> 으로 그 파일을 메인 `ProjectSource` 로 올린 뒤 재배포하세요.

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

**MCP 서버(`controller-mcp`)는 이 확장을 통해 제어기를 다룹니다.** 확장이 실행 중이면 MCP의 명령 콘솔 명령이 확장 세션으로
라우팅되어(Agent Bridge, `gpl.agentBridge.enabled`) 세션 경쟁이 없고, MCP 도구 `extension_command`로 Upload Only·Deploy·Quick Compile·
브레이크포인트 동기화 같은 **확장 기능 자체**를 쓸 수 있습니다. 현재 경로는 `extension_status`로 확인합니다.
AI 가 보낸 명령과 응답은 사람이 보낸 것과 같은 자리(출력 「GPL Language Support」)에 `(agent)` 표시로 남고, AI 요청이 오면
출력 패널이 자동으로 열립니다(`gpl.agentBridge.revealOutput`).

`GPL: Export AI Agent Setup`이 만드는 `.mcp.json`은 `GPL_BRIDGE=only`를 사용합니다. 따라서 사람이 VS Code에서 연결한 동안에도
AI가 두 번째 TCP 연결을 열지 않고 **확장의 한 연결과 직렬 큐를 공유**합니다. 브리지를 쓸 수 없으면 직접 접속으로 우회하지 않고
원인을 보고하므로, 단일 클라이언트 제어기에서 순간적인 presence 실패가 연결 경쟁으로 번지지 않습니다. GDE처럼 Agent Bridge를
사용하지 않는 외부 프로그램과의 동시 직접 접속은 여전히 지원하지 않습니다.

`GPL: Export AI Agent Setup`은 연결 설정만 만들고 브리지 전용 여부까지 자동 점검합니다. 프로젝트 이름·폴더는 `.mcp.json`이나
VS Code 설정에 기본값으로 저장하지 않습니다. MCP 세션을 시작하면 먼저 `project_target`에 정확한 `projectDir`을 지정해 대상을
확인한 뒤 프로젝트 도구를 사용합니다. Export를 다시 실행하면 구버전 `.mcp.json`의 `GPL_PROJECT`/`GPL_PROJECT_DIR`을 제거하고,
`CLAUDE.md`와 기존 `AGENTS.md` 자동 생성 블록을 현재 버전으로 갱신합니다. 사람이 작성한 문서 본문은 보존합니다.

제어기 안전 조건(Step/Continue 연타 방지, 정지 정착 전 Compile/Start 금지, Compile 직후
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
| `gpl.controller.port` | `1402` | 명령 콘솔 포트 |
| `gpl.controller.consolePort` | `1403` | 런타임 콘솔(출력 이벤트) 포트 |
| `gpl.controller.timeoutMs` | `10000` | 명령 타임아웃 (ms) |
| `gpl.controller.ftpBasePath` | `/GPL` | FTP 기본 경로 |
| `gpl.trace.server` | `off` | 로그 수준 (`off` / `messages` / `verbose`) |

이 외 전체 설정(런타임 콘솔 재연결 튜닝 `gpl.runtimeConsole.*`, 자동 시작, 폴링 간격 등)은
Settings UI에서 `gpl.` 검색으로 확인할 수 있습니다.

- 제어기 연결 성공 시 런타임 콘솔 소비자도 함께 연결되고, 연결 해제 시 함께 정리됩니다.

## 문제 해결 빠른 체크리스트

- 확장이 활성화되지 않음
  - 파일 확장자가 `.gpl` 또는 `.gpo`인지 확인
  - VS Code를 Reload한 뒤 다시 열기
- 자동완성/정의 찾기가 약함
  - 명령 팔레트에서 `GPL: Refresh Symbols` 실행
  - 워크스페이스 루트에 `Project.gpr` 존재 여부 확인
- 제어기 연결 실패
  - `gpl.controller.ip`, 포트(명령 콘솔 1402 · 런타임 콘솔 1403 · FTP 21) 확인
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
