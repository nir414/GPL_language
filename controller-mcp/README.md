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

## 5. 제공 도구

**기본**
- `controller_command(command)` — 임의 콘솔 명령(에스케이프 해치)
- `controller_status(detail?)` — 상태 요약 1회: 연결(1402 도달성) · 스레드 상태별 개수와 정지 스레드 위치 ·
  고전원(`Execute Controller.PowerEnabled`) · 배포 잠금 · `server`(빌드 스탬프). **연결 실패 시** ICMP/TCP를 구분해
  "재부팅 중 / 서비스 다운(ECONNREFUSED) / 완전 무응답" verdict를 돌려준다(단명 연결 반복 금지). `detail:true`면
  스레드 전체 목록(compact)과 최근 `ErrorLog` 10줄. 시뮬레이션/실기 판별 명령은 미확인이라 `simulation`은 항상 `null`.
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
- `list_breakpoints()` — `Show Break`

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

## 6. 전형적 디버그 흐름(예)

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

## 7. 설계 · 주의

- **명령 구문은 확장 소스/GDE 패킷 캡처/공식 콘솔 문서로 검증한 형태만** 사용한다.
  특히 `Set Break`/`Set Nobreak`는 **따옴표와 줄번호 사이에 공백이 없다**(`"file"479`) — GDE 캡처 기준.
- 완료 판정은 종결자 `</STATUS>` 기준(idle 조기완료로 부분 응답을 성공 오판하지 않음).
- 1402는 **단일 클라이언트 채널**이라 서버가 명령을 직렬화한다. 같은 제어기에 GDE/디버거가
  동시에 붙어 있으면 충돌할 수 있으니 한 쪽만 사용.
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
