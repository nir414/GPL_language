# gpl-controller-mcp

Brooks / Precise Automation **PA 제어기(GPL)** 를 **1402 ASCII 콘솔**로 조작하는 MCP 서버.
Claude(Desktop / Cowork / Code)가 **compile · run · debug** 도구를 직접 호출할 수 있게 노출한다.

> 이 서버는 **사용자 PC에서 실행**해야 한다. 제어기(`192.168.0.1` 등)는 사내 LAN에 있으므로,
> 원격 샌드박스가 아니라 제어기에 닿는 같은 네트워크의 PC에서 띄워야 도구가 동작한다.

> **권장 배포 경로 (v0.8.9+)**: 이 폴더를 직접 쓰는 대신, 확장 VSIX에 esbuild 단일 파일로
> 동봉된 번들(`out/mcp/gpl-controller-mcp.cjs`)을 쓰는 것이 기본이다. VS Code 명령
> **`GPL: Export AI Agent Setup`** 을 실행하면 번들이 globalStorage(버전 무관 경로)로 복사되고
> 워크스페이스에 `.mcp.json`이 자동 생성된다 — 저장소 클론·`npm install` 없이 AI-ready.
> 이 폴더는 그 번들의 **소스**이며, 아래 수동 절차는 개발/디버깅용이다.

---

## 1. 요구사항 · 설치

- Node.js 18 이상
- 제어기 콘솔(기본 `1402` 포트) 접근 가능한 네트워크

```bash
cd controller-mcp
npm install
```

## 2. 설정 (환경변수)

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `GPL_HOST` | `192.168.0.1` | 제어기 IP |
| `GPL_PORT` | `1402` | ASCII 콘솔 포트 |
| `GPL_PROJECT` | `MergeCode` | 기본 프로젝트명(도구에서 생략 시 사용) |
| `GPL_LOCK_WAIT_MS` | `20000` | **배포 잠금 대기 상한(ms)**. VS Code 확장이 FTP 업로드/배포 중이면 `%TEMP%\gpl-controller\<ip>.lock.json`을 잡는다. 이때 `compile_project`/`start_project`/`unload_project`와 `controller_command`의 Compile/Start/Load/Unload는 잠금이 풀릴 때까지 이 시간만 기다렸다 진행하고, 초과 시 보유자 정보와 함께 거부한다(업로드 도중 Compile/Start는 제어기 이상 유발 — GitHub #17) |
| `GPL_LOCK_DIR` | `%TEMP%\gpl-controller` | 배포 잠금 파일 디렉터리 재지정(테스트/특수 환경용. 확장과 같은 경로여야 한다) |
| `GPL_TIMEOUT_MS` | `15000` | 명령 타임아웃(ms). compile은 최소 60s로 자동 상향 |
| `GPL_IDLE_CLOSE_MS` | `30000` | keep-alive 1402 소켓의 유휴 종료 시간(ms) |
| `GPL_MCP_LOG_DIR` | `%TEMP%\gpl-mcp` | 세션 로그 파일 디렉터리(도구 호출/1402 명령 기록) |

추가 환경변수:

| 변수 | 기본 | 설명 |
| --- | --- | --- |
| `GPL_BRIDGE` | `auto` | VS Code 확장 브리지 사용. `auto`=확장이 있으면 확장 세션으로, 없으면 직접 접속 / `only`=브리지 필수(세션 단일화 보장) / `off`=항상 직접 접속 |
| `GPL_VSCODE_CLI` | `code` | 확장이 비활성일 때 깨우는 데 쓸 VS Code CLI 경로 |
| `GPL_LOCK_DIR` | `%TEMP%\gpl-controller` | 배포 잠금·브리지 파일 디렉터리(확장과 같은 값이어야 한다) |

## 3. 단독 실행 확인(선택)

MCP 클라이언트가 보통 자동으로 실행하지만, 수동 점검도 가능하다.

```bash
GPL_HOST=192.168.0.1 GPL_PROJECT=MergeCode npm start
# stderr 에 "[gpl-controller-mcp] ready — v0.8.19 <sha> (<빌드시각>) — target 192.168.0.1:1402 ..." 가 뜨면 정상
# (소스 직접 실행이면 "vdev (unbundled source)". 번들 버전은 get_session_log / controller_status 의 server 필드에도 나온다)
```

파서 단위테스트(제어기 없이):

```bash
npm test
```

## 4. Claude 에 연결

### Claude Code (PC 터미널)

```bash
claude mcp add gpl-controller \
  --env GPL_HOST=192.168.0.1 --env GPL_PORT=1402 --env GPL_PROJECT=MergeCode \
  -- node "C:/Users/Doyun/Documents/GitHub/GPL_language/controller-mcp/src/index.js"
```

### Claude Desktop / Cowork (설정 JSON의 `mcpServers`)

```json
{
  "mcpServers": {
    "gpl-controller": {
      "command": "node",
      "args": ["C:\\Users\\Doyun\\Documents\\GitHub\\GPL_language\\controller-mcp\\src\\index.js"],
      "env": { "GPL_HOST": "192.168.0.1", "GPL_PORT": "1402", "GPL_PROJECT": "MergeCode" }
    }
  }
}
```

연결 후 Claude 에서 "MergeCode 컴파일해줘", "ProtocolModule.gpl 479줄에 브레이크포인트 걸고 stopOnEntry로 실행해줘" 처럼 자연어로 지시하면 아래 도구를 호출한다.

---

## 5. 연결 시 전달되는 지침 (instructions · 리소스)

서버는 `initialize` 응답의 **`instructions`**로 두 가지를 함께 알린다(`src/guidelines.js`).
도구 설명과 달리 **도구를 부르기 전에** 읽히므로, 작업을 시작하기 전에 알아야 할 규약만 담는다.

1. **제어기 안전 규칙** — 원시 TCP 소켓 금지, `</STATUS>`까지 읽고 판정, 모션 유발 명령은 사용자 확인,
   Compile 직후 Start 연속 호출 금지.
2. **GPL 문서화 주석 규약** — GPL 소스를 쓰거나 고칠 때 선언 바로 위에 남기는 주석 형식.
   설명은 항상, `# Parameters`는 매개변수가 있을 때, `# Returns`는 반환값이 있을 때,
   `# Examples`는 도움이 될 때만. VS Code 확장이 이 형식을 호버·자동완성·시그니처 도움말에
   구조로 표시한다(형식의 단일 출처는 확장의 `src/language/docComment.ts`).

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

골격은 손으로 쓰지 않아도 된다 — 편집기에서 선언 위에 `'''`를 입력하거나,
`extension_command('gpl.insertDocComment', { uri, line })`로 만든다(이미 주석이 있으면 **빠진 항목만**
덧붙고 기존 설명은 보존된다. 결과: `{ ok, action: inserted|merged|up-to-date, added?, file, line, symbol }`).

`instructions`를 쓰지 않는 클라이언트를 위해 같은 내용을 리소스로도 노출한다 —
`gpl://guidelines/doc-comment` (`resources/list` → `resources/read`).

## 6. 제공 도구

**VS Code 확장 연동 (Agent Bridge)** — MCP가 제어기에 직접 붙는 대신 **확장의 명령을 실제로 실행**하는 통로.
확장이 실행 중이면 1402 명령이 자동으로 확장 세션으로 나가므로 세션 경쟁("1402를 VS Code가 점유 중")이 없다.

- `extension_status(wake?)` — 확장 실행 여부·버전·pid·연결 상태·디버그 세션과 **지금 명령이 나가는 경로**
  (`extension-bridge` / `direct-tcp`). *"1402를 VS Code가 점유 중"이라고 추측하지 말고 이 도구로 확인할 것.*
  `wake:true`면 확장이 비활성일 때 `code --open-url`로 활성화를 시도한다.
- `extension_command(command, args?, timeoutMs?)` — 확장 명령(`gpl.*`) 실행. 제어기 콘솔 명령이 아니라 **확장 기능**을 쓴다:
  `gpl.deploy`(/GPL 업로드+Compile) · `gpl.quickCompile` · `gpl.uploadStart`(업로드+Start) · `gpl.start` · `gpl.controller.pushBreakpoints`/`pullBreakpoints` ·
  `gpl.ai.debug.getState`/`getConnectionState`/`setBreakpoint`/`evaluate`/`loop` · `gpl.diagnosticSnapshot` ·
  `gpl.controller.threadBreak({threadName})` 등. 인자 형식은 확장 런북의 Command ID 표를 따른다.
  Deploy처럼 오래 걸리는 명령은 `timeoutMs`를 크게(예: 180000) 준다.

**기본**
- `controller_command(command)` 또는 `controller_command(commands: string[], stopOnError?)` — 임의 콘솔 명령(에스케이프 해치).
  **배치(GitHub #16)**: `commands`(1~50개)를 주면 서버가 **순서대로 순차** 실행해 결과 배열을 한 번에 돌려준다 —
  MCP 호출당 고정 오버헤드(≈1.5 s)가 제어기 왕복(13~85 ms)의 100배라, DataID 30개를 단건 30회로 읽으면 45 s, 배치 1회면 0.5 s.
  `command`/`commands`는 정확히 하나만 지정(둘 다/둘 다 없음은 에러). 단건 응답은 종전과 동일(`{command,status,ok,data,hint?}`).
  배치 응답: `{ count, okCount, failCount, stoppedAt?, skipped?, results:[{ index, command, status, ok, data, hint?, error? }] }`.
  항목마다 기존 `runCommand`를 그대로 쓰므로 **배포 잠금 가드(Compile/Start/Load/Unload 대기·거부)가 항목별로 적용**되고,
  타임아웃/연결 오류 항목은 `{ok:false, error}`로 기록된다(배치 전체가 죽지 않음). `stopOnError:true`면 첫 실패에서 멈추고 `stoppedAt`(인덱스).
  ```json
  { "commands": ["Show Memory", "Show Network -tcp", "pd 2703", "pd 2704"], "stopOnError": false }
  ```
- `read_dataids(ids: number[])` — 파라미터 DB(DataID) 다건 읽기(`pd <id>`, **읽기 전용** — 쓰기 `pc`는 제공하지 않음). 1~100개를
  순차 조회해 항목별 `{ id, ok, status, description, meta, values, raw }`. 실측 `2703, 1, 1, 0, "100% Cartesian accels in (mm or deg)/sec^2" = 1200, 400, 0`
  → `description` 따옴표 제거, `meta:[1,1,0]`, `values:["1200","400","0"]`(원문 토큰 — 문자열 값은 따옴표 유지, 값 목록의 다중 줄 wrap은 이어 붙임).
  파싱 실패 시 `raw`만 채워지고 `ok`는 STATUS 기준.
  선택 인자(공식 문서 구문 `Pd dataid, unit, unit2, array_index, node`): `hex:true` → `pdx`로 읽어 **정수를 16진수로**
  표시(비트마스크 DataID 예: 2003 Axis mask), `unit` / `unit2` / `arrayIndex`(0 = 전체 값) / `node`(서보 네트워크 노드 —
  문서가 테스트·디버깅 용도로 명시). 뒤 인자만 지정하면 앞 인자를 문서 기본값(unit 1 / unit2 1 / index 0)으로 자동 보완한다.
- `controller_status(detail?)` — 상태 요약 1회: 연결(1402 도달성) · 스레드 상태별 개수와 정지 스레드 위치 ·
  고전원(`Execute Controller.PowerEnabled`) · 배포 잠금 · `server`(빌드 스탬프). **연결 실패 시** ICMP/TCP를 구분해
  "재부팅 중 / 서비스 다운(ECONNREFUSED) / 완전 무응답" verdict를 돌려준다(단명 연결 반복 금지). `detail:true`면
  스레드 전체 목록(compact)과 최근 `ErrorLog` 10줄, 그리고 **`resources`**(GitHub #22): 읽기 전용 `Show Memory` / `Show Network -tcp` /
  `Show Network -mbuf` 3명령을 배치로 보내 `{ memory:{freeMb,usedMb,segments,freeSegments,usedSegments}, tcp:{accepted,established,dropped,closed,
  acceptedPerSec,sampleIntervalSec}, mbuf:{total,free,data,header,clusters,clustersFree,drops,waits,drains}, raw:{...원문}, sampledAt }`로 구조화한다.
  `acceptedPerSec`는 서버 메모리의 직전 `detail` 호출 대비 accept 카운터 증가율(첫 호출·재부팅 후 `null`) — 제어기 TCP 접속 churn 관찰(가설 1 검증)용.
  원문 형식은 GPL 4.2K5 실측(2026-08-25) 1회분 기준이라 다른 펌웨어에선 필드가 `null`일 수 있다 — 그때는 `raw` 참고.
  시뮬레이션/실기 판별 명령은 미확인이라 `simulation`은 항상 `null`.
- `get_session_log(tail?)` — 이 세션의 도구 호출/1402 명령 로그(왕복 낭비 분석·공유용).
  같은 내용이 파일(`GPL_MCP_LOG_DIR`, 서버 시작 시 stderr에 경로 출력)에도 기록되며,
  사용자는 `Get-Content "<로그파일>" -Wait`로 AI의 제어기 조작을 실시간 관찰할 수 있다.

**컴파일 · 실행**
- `compile_project(project?)` — `Compile`. STATUS로만 성공 판정, 실패 시 에러 라인 파싱
- `start_project(project?, stopOnEntry?)` — `Start` (`-break -bex` 시 진입점 정지)
- `unload_project(project?)` — `Unload`

**실행 제어(디버그)** — Break/Step/Continue는 STATUS 0이 "접수"일 수 있어(접수≠완료),
서버가 `Show Thread <thread>` 폴링으로 **실제 정지를 확인한 뒤 정지 위치까지 반환**한다.
호출측(AI)이 스텝/재개마다 show_thread를 따로 부를 필요가 없다.

- `pause_thread(thread)` — `Break <thread>` + 정지 확인/위치 반환
- `continue_thread(thread, ignoreErrors?, waitForStopMs?)` — `Continue` + 다음 정지 폴링
  (기본 3s 내 브레이크포인트 히트면 위치 반환, 아니면 실행 중으로 보고)
- `step_thread(thread, mode=into|over|out, evals?)` — `Step`(항상 `-noerror`) + 정지 확인.
  `evals`로 정지 직후 변수 관측을 한 호출에 배치할 수 있다.
  같은 스레드에 연속 스텝 3회 이상이면 응답에 `advice`(run_to_line/정적 분석 전환 권고)가 붙는다.
- `run_to_line(thread, file, line, project?, evals?, keepBreakpoint?, timeoutMs?)` —
  **여러 줄 진행의 기본 경로.** 임시 중단점 → Continue → 정지 확인 → 변수 배치 평가 →
  중단점 정리를 1회 호출로 수행한다(스텝 반복 대신 이걸 사용).
- `softestop()` — `SoftEStop` (모션 급정지, 전원 유지)

**브레이크포인트**
- `set_breakpoint(file, line, project?)` — `Set Break <proj> "<file>"<line>`
- `clear_breakpoint(file, line, project?)` — `Set Nobreak ...`
- `list_breakpoints()` — `Show Break`. 프로젝트·파일·줄·히트수를 구조화해 돌려준다.

확장 브리지를 거치면(`GPL_BRIDGE=auto|only`) 설정/해제가 **VS Code 에디터의 중단점(빨간 점)에도
반영된다** — AI가 무엇을 걸었는지 사용자가 보고 F9로 지울 수 있고, 에디터를 원본으로 삼는
`gpl.controller.syncEditorBreakpoints`·디버그 세션이 그 중단점을 "에디터에 없는 잔재"로 지우지도 않는다.
`run_to_line`의 임시 중단점은 반영하지 않으며, 그 줄에 원래 있던 중단점은 지우지 않는다.
확장 설정 `gpl.controller.mirrorAiBreakpoints`로 끌 수 있다.

**관찰**
- `debug_snapshot(thread?, evals?, frame?, listLocals?)` — **상황 파악 원샷**: 스레드 목록(compact) + 요약 + 정지
  스레드 위치 상세 + 호출 스택 + 선택 변수 평가를 한 호출로. 세션 시작/정지 직후엔
  show_threads/show_thread/show_stack을 따로 부르지 말고 이걸 먼저. `listLocals:true`면 해당 프레임 변수 전체
  덤프(`Show Variable <thread> <frame>` — Brooks 문서상 구문, **실기기 미검증**)를 원문으로 덧붙인다.
- `show_threads(verbose?)` — 전체 스레드를 이름 있는 키(`name/state/project/procedure/procLine/file/line`)로.
  기본은 compact(빈 값·0 생략, 스레드당 ~80B); `verbose:true`일 때만 원문 줄·fields 포함.
- `show_thread(thread)` — 스레드 상세/현재 위치
- `show_stack(thread)` — 호출 스택
- `eval_expression(thread, frame, expression)` — `Show Variable -eval` 로 프레임 변수 평가. 결과는
  `{name, type, value, kind(simple|object|array), members?}`로 구조화(원문 재파싱 불필요). **한계(실측)**: 식의 마지막
  요소가 사용자 property/메서드면 `-780`, 다른 클래스 프레임의 Private 점 표기는 `-729`, `Me.`/CStr()/산술은 `-712`.
  `-780`이면 관례 백킹 필드 `m_<이름>`으로 자동 재시도하고(→ `-729`면 부모 객체 덤프에서 추출) 성공 시 `resolvedAs`를
  표시한다. `Me.` 접두는 자동 제거. 체인 중간의 사용자 Property/Function은 실행되므로 `x.loc.X`, `x.loc.Pos`처럼
  마지막을 시스템 멤버로 끝내면 읽힌다(실패 응답에 힌트 자동 포함).
- `set_variable(expression, project?)` — `Execute <expression>, <project>`

**실패 응답 힌트**: 알려진 STATUS 코드(-780/-729 eval 한계, -714 없는 명령, -508 경로,
-742 컴파일 에러 등)로 실패하면 응답에 `hint`(무엇을 바꿔 재시도할지)가 자동으로 붙는다.
같은 부류의 재시도를 반복하지 말고 힌트를 따를 것.

## 7. 전형적 디버그 흐름(예)

0. **말하면서 작업한다**: 제어기 조작 전에 한 줄로 "무엇을 왜" 하는지 말하고, 관측
   결과가 오면 즉시 한 줄로 해석을 보고한다. 조용한 연속 도구 호출 금지 — 사용자가
   진행 상황을 따라올 수 있어야 한다.
1. **정적 분석 먼저**: 소스를 읽고 "확인할 관측값(변수·분기 지점)" 목록을 만든다.
2. `compile_project` → 에러 없으면
3. `start_project(stopOnEntry: true)` → `debug_snapshot()`으로 정지 스레드/위치/스택 파악
4. `run_to_line(thread, "ProtocolModule.gpl", 2841, evals: ["lastStage", "m_gridActive"])`
   — 도달 + 관측을 한 번에. 관측값이 더 필요하면 `eval_expression` 추가.
5. 다음 관측 지점도 `run_to_line`으로 이동. **스텝은 "바로 다음 한 줄의 효과 자체가
   질문일 때"만** `step_thread(thread, "over", evals: [...])`로 사용한다.

## 8. 설계 · 주의

- **명령 구문은 확장 소스/GDE 패킷 캡처/공식 콘솔 문서로 검증한 형태만** 사용한다.
  특히 `Set Break`/`Set Nobreak`는 **따옴표와 줄번호 사이에 공백이 없다**(`"file"479`) — GDE 캡처 기준.
- 완료 판정은 종결자 `</STATUS>` 기준(idle 조기완료로 부분 응답을 성공 오판하지 않음).
- 1402는 **단일 클라이언트 채널**이라 서버가 명령을 직렬화한다. 같은 제어기에 GDE가 동시에 붙어 있으면 충돌할 수 있으니 한 쪽만 사용.
- **Agent Bridge(2026-08-28)** — VS Code GPL 확장이 실행 중이면 1402 명령을 확장 세션으로 보낸다(`src/extensionBridge.js`).
  종전에는 확장이 keep-alive 세션을 쥔 채 MCP가 따로 접속해 두 세션이 경쟁했고, AI가 *"제어기는 정상인데 1402를 VS Code가
  점유 중"*이라고만 보고하며 확장을 통한 테스트로 넘어가지 못했다. 브리지 경로에서는 명령이 확장의 **같은 직렬 큐·keep-alive
  세션·명령 정책**(Step 연타 방지 / 정지 정착 대기 / Compile→Start 완충)을 그대로 타고 GPL Traffic·Output에도 함께 남는다.
  - 전송 수단은 `%TEMP%\gpl-controller\`의 요청/응답 파일 한 쌍(배포 잠금과 같은 계약 — 새 포트·서버 없음).
    확장 상태는 `<ip>.extension.json`(heartbeat 5초, 15초 이상이면 죽은 것으로 판정).
  - `GPL_BRIDGE=auto`(기본)는 확장이 없으면 직접 접속으로 자동 폴백, `only`는 브리지 필수(세션 단일화 보장), `off`는 종전 동작.
  - **폴백 규칙**: 브리지가 명령을 *실행하지 않았음이 확실한* 실패(요청 거부·확장 없음)면 직접 전송으로 넘어가고,
    모호한 실패(타임아웃·확장 내부 오류)는 **조회 명령만** 재전송한다 — 상태 변경 명령의 중복 전송(Step 두 줄 진행, Start 컴파일 중복)을 막는다.
  - 확장의 명령 정책이 안전 조건을 채우지 못해 보류하면(`policy-hold`) 직접 접속으로 **우회하지 않고** 그대로 알린다.
  - 요청은 확장에서 **순차 처리**된다. `gpl.deploy`처럼 수 분 걸리는 명령을 브리지로 실행하는 동안 다른 브리지 요청은 뒤에서 기다린다.
- 확장이 배포/업로드 중이면(`%TEMP%/gpl-controller/<ip>.lock.json`) Compile/Start/Load/Unload는 잠금이 풀릴 때까지 대기 후 진행한다.
- **배치(`controller_command(commands)`/`read_dataids`/`resources` 프로브)는 서버 직렬 큐에서 순차 실행한다 — 1402 단일 채널이므로
  `Promise.all` 병렬 전송은 금지**(`src/batch.js` `runBatch`). 배치 안에서도 항목별로 `runCommand` → 배포 잠금 가드를 그대로 거친다.
- **keep-alive 연결(v0.2)**: 명령마다 TCP를 새로 열지 않고 연결을 유지한다(유휴
  `GPL_IDLE_CLOSE_MS` 후 종료). 정지 확인 폴링(150ms)과 왕복 지연이 크게 줄어든다.
  죽은 소켓이면 새 연결로 1회 자동 재시도.
- `start_project` / `set_variable` / `softestop` 는 동작을 바꾸는 명령이다. 현재는
  **시뮬레이션 모드(모터 미연결)** 전제로 게이팅 없이 동작한다. 실제 로봇에 적용할 때는
  저속/확인 게이트를 추가할 것.
- 디버그 변수 평가는 `Show Variable -eval <thread> <frame> <expr>` 형식을 쓴다(확장과 동일).
- **접수≠완료 확인 내장**: Break/Step/Continue/run_to_line은 서버가 `Show Thread <thread>`
  상세를 폴링(150ms 간격)해 정지 계열 상태(Paused/Break/Error)로 완료를 판정한다.
  접수 직후 옛 위치의 Paused가 보이는 레이스는 직전 위치와 같은 관측을 600ms 동안
  무시(stale grace)하는 방식으로 처리한다(확장 waitForThreadPause/parseThreadDetail 이식).
- **AI 낭비 패턴 가드**: 연속 스텝 넛지(3회 이상 시 `advice`), 실패 STATUS 힌트(`hint`),
  `evals` 관측 배치는 "한 줄 스텝 반복·불가능한 eval 재시도" 같은 에이전트 낭비를
  응답 안에서 즉시 교정하기 위한 장치다. 배경: docs/ai-handoff.md 해당 세션 항목 참조.
