# gpl-controller-mcp

Brooks / Precise Automation **PA 제어기(GPL)** 를 **1402 ASCII 콘솔**로 조작하는 MCP 서버.
Claude(Desktop / Cowork / Code)가 **compile · run · debug** 도구를 직접 호출할 수 있게 노출한다.

> 이 서버는 **사용자 PC에서 실행**해야 한다. 제어기(`192.168.0.1` 등)는 사내 LAN에 있으므로,
> 원격 샌드박스가 아니라 제어기에 닿는 같은 네트워크의 PC에서 띄워야 도구가 동작한다.

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
| `GPL_TIMEOUT_MS` | `15000` | 명령 타임아웃(ms). compile은 최소 60s로 자동 상향 |

## 3. 단독 실행 확인(선택)

MCP 클라이언트가 보통 자동으로 실행하지만, 수동 점검도 가능하다.

```bash
GPL_HOST=192.168.0.1 GPL_PROJECT=MergeCode npm start
# stderr 에 "[gpl-controller-mcp] ready — target 192.168.0.1:1402 ..." 가 뜨면 정상
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
- `controller_status()` — 연결/스레드 상태 요약(`Show Thread -web`)

**컴파일 · 실행**
- `compile_project(project?)` — `Compile`. STATUS로만 성공 판정, 실패 시 에러 라인 파싱
- `start_project(project?, stopOnEntry?)` — `Start` (`-break -bex` 시 진입점 정지)
- `unload_project(project?)` — `Unload`

**실행 제어(디버그)**
- `pause_thread(thread)` — `Break <thread>`
- `continue_thread(thread, ignoreErrors?)` — `Continue`
- `step_thread(thread, mode=into|over|out)` — `Step` (`-over`/`-out`, 항상 `-noerror`)
- `softestop()` — `SoftEStop` (모션 급정지, 전원 유지)

**브레이크포인트**
- `set_breakpoint(file, line, project?)` — `Set Break <proj> "<file>"<line>`
- `clear_breakpoint(file, line, project?)` — `Set Nobreak ...`
- `list_breakpoints()` — `Show Break`

**관찰**
- `show_threads()` — 전체 스레드(구조화)
- `show_thread(thread)` — 스레드 상세/현재 위치
- `show_stack(thread)` — 호출 스택
- `eval_expression(thread, frame, expression)` — `Show Variable -eval` 로 프레임 변수/식 평가
- `set_variable(expression, project?)` — `Execute <expression>, <project>`

## 6. 전형적 디버그 흐름(예)

1. `compile_project` → 에러 없으면
2. `set_breakpoint("ProtocolModule.gpl", 479)`
3. `start_project(stopOnEntry: true)`
4. `show_threads` → 정지한 스레드 이름 확인
5. `show_stack(thread)` / `eval_expression(thread, 0, "robotIndex")`
6. `step_thread(thread, "over")` 반복, 또는 `continue_thread(thread)`

## 7. 설계 · 주의

- **명령 구문은 확장 소스/GDE 패킷 캡처/공식 콘솔 문서로 검증한 형태만** 사용한다.
  특히 `Set Break`/`Set Nobreak`는 **따옴표와 줄번호 사이에 공백이 없다**(`"file"479`) — GDE 캡처 기준.
- 완료 판정은 종결자 `</STATUS>` 기준(idle 조기완료로 부분 응답을 성공 오판하지 않음).
- 1402는 **단일 클라이언트 채널**이라 서버가 명령을 직렬화한다. 같은 제어기에 GDE/디버거가
  동시에 붙어 있으면 충돌할 수 있으니 한 쪽만 사용.
- `start_project` / `set_variable` / `softestop` 는 동작을 바꾸는 명령이다. 현재는
  **시뮬레이션 모드(모터 미연결)** 전제로 게이팅 없이 동작한다. 실제 로봇에 적용할 때는
  저속/확인 게이트를 추가할 것.
- 디버그 변수 평가는 `Show Variable -eval <thread> <frame> <expr>` 형식을 쓴다(확장과 동일).
