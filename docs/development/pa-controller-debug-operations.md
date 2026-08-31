# PA 제어기에서 가능한 디버깅 조작 — 전수 조사 (2026-08-28)

Brooks/Precise Automation 제어기(G2400C, GPL 4.2K5)를 1402 콘솔로 디버깅할 때 **실제로 가능한 조작**을
네 방향에서 조사해 한곳에 모은 문서다. 목적은 두 가지 — ① 확장/MCP가 이미 쓰는 명령의 정확한 구문을
한 곳에서 확인하고, ② **아직 쓰지 않는 조작**을 놓치지 않는 것.

조사 방향과 근거:

| 방향 | 자료 | 산출 |
|---|---|---|
| 확장 소스 | `src/**` 전체의 명령 문자열 조립 지점 | 실제 전송 명령 37형태 |
| 노출 표면 | MCP 22개 tool, `gpl.ai.debug.*`, URI, commandPolicy | 표면 → 명령 매핑, 게이트 위치 |
| 실기기 캡처 | `captures/gde_1402.pcapng`(70.4 s, 명령 178건) / `gde_1403.pcapng`(80.6 s) tshark 재판독 | GDE의 실제 통신 패턴 |
| 공식 문서 | www2.brooksautomation.com Console Command Summary(49항목) + 개별 페이지 23개 | 문서상 구문·스위치 |

**신뢰도 표기** — 이 저장소의 규칙(문서는 가설, 실기기 응답이 사실)에 따라 항목마다 구분한다.

- `실측` = 실기기 캡처 또는 자체 실기기 응답으로 확인
- `코드` = 확장이 실제로 보내지만 실기기 응답 근거가 문서에만 있음
- `문서` = 공식 문서에만 있음 (실기기 미검증)

---

## 1. 브레이크포인트

| 명령 | 신뢰도 | 비고 |
|---|---|---|
| `Set Break <project> "<file>"<line>` | 실측 | **닫는 따옴표와 줄번호 사이에 공백이 없다.** 공식 문서 예제는 공백을 넣지만(`… "Testfile.gpl" 30`) GDE 캡처는 no-space — 실측이 사실 |
| `Set Nobreak <project> "<file>"<line>` | 코드 | **공식 문서 표기는 공백 있음**(`Set Nobreak My_project "Testfile.gpl" 30`)이고 GDE 캡처에는 Nobreak 자체가 없다. 확장은 실측이 확인된 무공백 형식으로 먼저 보내고 STATUS 실패 시 문서 표기로 자동 재시도한다(`_sendBpCommandWithFallback`). 문서상 인자를 생략하면 다중/전체 해제이며 없는 BP를 지워도 에러가 아니다 |
| `Show Break` | 실측 | 응답 7컬럼: `id, project, proc, procLine, file, fileLine, hitCount` |

`Show Break` 응답에서 확인된 두 가지:

- 제어기가 파일 줄을 **프로시저 상대 줄로 변환**해 함께 돌려준다(파일 22줄 → procLine 2). 우리 파서는
  5·6열(file/fileLine)을 쓴다 — 상대 줄을 쓰는 곳이 없는지 확인 필요.
- 7번째 컬럼은 공식 문서상 **hit count**이고, 캡처에서도 현재 정지 중인 BP만 1이었다(문서 ↔ 실측 교차 확인).
  히트 횟수를 얻는 유일한 경로이며 리셋 명령은 없다.

문서에만 있는 제약(실기기 미검증): 한 명령에 최대 32개 BP 동시 정의 / 같은 명령줄에 두 개 불가 /
빈 줄·주석을 지정하면 다음 실행 가능 문장으로 자동 이동 / 실행 중 프로시저에도 설정 가능.

**없는 것**: 조건식·히트 조건·로그포인트·watchpoint·BP 활성/비활성 토글에 대응하는 명령이 문서·실측
어디에도 없다. 조건부 BP를 하려면 정지 후 `Show Variable -eval`로 평가하고 자동 재개하는 클라이언트
구현밖에 방법이 없다.

## 2. 실행 제어

| 명령 | 신뢰도 | 비고 |
|---|---|---|
| `Break <thread>` | 코드 | 자원을 해제하지 않으므로 Continue/Step으로 재개 가능(문서가 Stop과 명시적으로 구분) |
| `Continue <thread>` | 실측 | |
| `Continue <thread> -noerror` | 코드 | 실패한 문장을 건너뛴다. 원인 분석 전 반복 금지 |
| `Step <thread> -noerror` (= step **into**) | 실측 | `-into` 플래그는 캡처에 없다. 문서도 "스위치가 없으면 -into가 기본" |
| `Step <thread> -over -noerror` | 실측 | |
| `Step <thread> -out -noerror` | 문서 | **캡처 178건에 `-out`이 한 번도 없다** — 세 Step 변형 중 유일하게 미검증 |
| `Stop <thread>` / `Stop -all` | 코드 | GDE는 `-a`, 우리는 `-all`. 인자 없는 `Stop`은 `-205 Missing argument`(캡처 표본 존재) |
| `Start <project>` / `… -break -bex` | 코드 | GDE는 `Start <project> -event`를 쓴다(아래) |
| `SoftEStop` | 코드 | 급감속 + High Power 유지. `Controller.SoftEStop = True`로도 동일 효과(문서) |

**`Step` 스위치는 문서상 네 개 모두 사용 가능하다**(2026-08-28 step.htm 원문 확인):
`-into`("스위치가 없으면 기본값"), `-over`, `-out`("현재 프로시저가 호출자로 돌아갈 때까지 실행"),
`-noerror`("정지를 유발한 에러 문장을 건너뛴다"). 전제 조건은 "Start 로 활성화된 뒤 에러·브레이크포인트·Break
로 정지한 스레드"다. 우리 확장은 세 변형을 모두 보내며, `-out` 만 캡처 근거가 없다(문서 근거는 있다).

**`Start` 스위치 — 문서 원문 의미**(2026-08-28 start.htm 확인). 전제: 프로젝트가 GPL 영역에 있고 `Compile`로
컴파일되어 있어야 한다.

| 스위치 | 문서상 의미 | 확장의 사용 |
|---|---|---|
| `-event` | 쓰레드 상태 변경을 **콘솔 메시지가 아니라 이벤트로** 보낸다 | **기본으로 붙인다**(GDE 동일, `gpl.controller.startEventMode`) |
| `-noevent` | 앞선 `-event`를 되돌린다(GDE 콘솔용) | 위 설정을 끄면 붙는다 |
| `-break` | 첫 명령 실행 직전 정지 | `stopOnEntry` |
| `-bex` | 예외 시 Try/Catch 를 건너뛰고 즉시 정지 | `stopOnEntry`와 함께 |
| `-stack <KB>` | 프로시저 스택 크기(문서 기본 4) | launch `startStackSizeKb`(1~1024) |
| `-init` | trace/단일 스텝 중 초기화 문장도 표시 | launch `startShowInitStatements` |
| `-trace` | 실행 문장을 콘솔에 표시 — **성능 크게 저하** | launch `startTrace`(진단용) |
| `-name <thread>` | 쓰레드 이름 지정(기본값은 프로젝트명) | 미사용 |
| `-compile` | 시작 전 컴파일/재컴파일 | **절대 붙이지 않는다** — 실기기는 스위치 없이도 컴파일한다(하드 규칙 7). 이 대목은 문서가 부정확하다 |

조립은 `src/controller/startCommand.ts` 한 곳에서 하고 스위치 순서는 문서 구문 순서를 따른다.

**Stop 이후에는 Continue가 불가**하고 `Start`로만 재시작된다(문서). Paused 상태의 스레드는 Unload 전에
Stop이 요구된다 — 저장소의 settle 게이트와 방향이 같다. 단 `-752/-753`(Timeout stopping thread)의
비치명 해석과 1회 재시도 규약은 문서에 없는 실측 규약이다.

## 3. 상태·스택·변수 조회

| 명령 | 신뢰도 | 응답 형식 |
|---|---|---|
| `Show Thread  -web` | 실측 | 파이프 9컬럼 `name\| state\| code\| "msg"\| project\| func\| procLine\| file\| fileLine`. 이름 슬롯을 비우는 **두 칸 공백**은 문서에 없는 실측 규약 |
| `Show Thread <thread>` | 실측 | 콤마 3줄(상태 / 코드·메시지 / 위치) |
| `Show Thread` (인자 없음) | 실측 | 스레드 5개가 Running이어도 `<DATA></DATA>` — 최소 비용 읽기(우리 keep-alive ping 용도) |
| `Show Stack <thread> [frame]` | 코드 | `frame, project, proc, procLine, file, fileLine, frameSize`. **프레임 번호가 Show Variable의 변수 컨텍스트를 결정한다** |
| `Show Variable [-eval] <thread> <frame> <expr>` | 실측 | `-eval`은 값을 반환하지 않는 Sub도 평가하게 하는 스위치 — **문서 자체가 Sub 실행을 유발함을 명시** |
| `Show Global <expr>, <project>` | 코드 | 문서 예제로 `Math.Sqrt(16)`·`Chr(i1)`·`GPL.i1`·`l1.X` 등 시스템 함수 호출까지 허용됨이 확인 |
| `Execute <문장>, <project>` | 코드 | 대입·함수 호출. **`_Cmd_<project>` 별도 스레드에서 실행**되므로 Show Thread 목록에 나타날 수 있다 |
| `ErrorLog` / `-web ,10` / `-clear` | 코드 | 항목 포맷 `<date> <time> <d> <source><d> <ecode><d> <string>`, 구분자는 표준 `,` / `-web` `\|` |
| `Pd <id>, <unit>, <unit2>, <idx>, <node>` | 실측 | 응답에 DataID 설명 문자열이 포함된다 |
| `Show Memory` / `Show Network -tcp\|-mbuf` / `Show DIO` / `Set DIO` | 코드 | |

문서상 `Show Variable`은 객체 메서드·get 프로퍼티까지 표시한다고 하지만, 자체 실기기 실측(GPL 4.2K5)은
프로퍼티/메서드에 `-780`을 돌려주고 점 표기 멤버를 거부한다 — **실측이 사실**.

## 4. GDE 캡처에서 관측된 패턴 — 우리가 아직 흉내내지 않는 것

전부 `실측`(2026-06-23 pktmon 캡처, 프로젝트 Test_robot).

1. **1402 응답 프레이밍에 NUL 종결자가 있다**: `<DATA>…</DATA>\r\n<STATUS>code,"msg"</STATUS>\r\n` + `\0`
   (178/178 일치). 런북의 프레이밍 기록은 `</STATUS>\r\n`까지만 적고 NUL을 빠뜨렸다 — 1403과 동일한
   NUL 프레임 종결 규약이다. 응답 완결 판정을 NUL까지로 잡으면 STATUS 누락 판정을 더 엄격하게 할 수 있다(제안).
2. **5초 하트비트에 유휴 조건이 없다**: `PD 234,-1,0,0`(Power/Auto execute state) → `PD 601`(test speed %)
   → `PD 2800`(Robot homed, **같은 명령 2회 연속**) → `PD 1700`(Dialog box output) 5개 블록이 명령이
   오가는 중에도 ~5.01 s 주기로 무조건 나간다. 우리 구현은 "유휴 5초 뒤 1회"이므로 동작이 다르다.
3. **모든 Step 직전에 preamble 2개**: `PD 464,1,0,1`("Web RPC: debug, timeout, stack") + `PD 307,1,0,0`
   ("Break on exception codes", 8원소 배열). 11/11회 예외 없음. Continue에는 없다(스텝 전용).
4. **상태 변경 명령 뒤 `Show Thread  -web` 2연속**(즉시 +5~20 ms, 그리고 +185~230 ms), `Stop -a` 뒤에는 3연속.
   실제로 t=28.954와 29.164의 스레드 집합이 서로 달랐다 — **1회 폴로 스레드 목록을 확정하면 안 되는 실측 근거**.
5. **Step into로 새 파일에 진입하면 `Show Break`를 다시 읽는다**(BP 목록 재조회).
6. **`Start <project> -event`**: GDE는 두 번 모두 `-event`를 붙였고 `-break`는 쓰지 않았다(이미 걸어 둔
   BP에서 정지). 1403이 `<E>…</E>` 이벤트를 내려보내는 것과 이름이 맞물려 **`-event`가 이벤트 스트림
   활성화 조건일 가능성**이 있으나 미검증 — `-event` 유/무로 1403 수신량을 대조하면 확정된다.
7. **1403은 순수 수신 스트림**이다. GDE가 보내는 1바이트 `0x00`은 seq가 전진하지 않으므로 애플리케이션
   write가 아니라 **TCP keep-alive 프로브**다. "GDE가 5초마다 NUL을 보낸다(애플리케이션 keep-alive)"는
   기존 해석은 오류이며, 결론("1403에 데이터를 써서 유지하려 하지 말 것")과 우리 구현은 그대로 유효하다.
8. **GDE의 변수·스택 조회 명령이 캡처에 0건**이다. 설명 후보 3개(변수 창을 열지 않았다 / 웹 RPC(포트 80)로
   읽는다 / 1404 사용) 모두 미검증. DataID 464의 이름에 "Web RPC: debug, timeout, stack"이 들어 있는 것이
   정황 근거다. 우리 `Show Variable -eval` 문법은 GDE 캡처가 아니라 자체 실기기 실측에 근거한다.
9. `PC(1700,0,0,1)=""` — `Stop -a` 직전에 DataID 1700을 빈 문자열로 **쓴다**(대화상자 입력 상태 정리로 추정).
   읽기 인덱스(`-1,0,0`)와 쓰기 인덱스(`0,0,1`)가 다르다.
10. **COMPILE 응답을 받은 뒤 440 ms 만에 `Start`를 같은 세션으로 보낸다**(28.504→28.944, 47.084→47.546).
    저장소 하드 규칙 7("Compile 직후 Start 연속 금지")은 사용자 실사용 사실에 근거한 규칙이므로 유지하되,
    GDE 관측은 이와 다르다는 사실만 기록한다.

## 5. 공식 문서에만 있고 우리가 쓰지 않는 조작

전부 `문서` — 실기기 검증 전에는 채택하지 않는다.

| 명령 | 무엇이 가능해지는가 | 판단 |
|---|---|---|
| `Set Thread <thread> -line <n>` | **다음 실행 줄 변경 = VS Code의 Jump to Cursor/Set Next Statement** | **2026-08-28 구현** — `gpl.debug.jumpToCursor`(기본 `warn`: 실행 전 위험 경고 확인). 대상 줄은 문서 제약대로 같은 프로시저 안의 실행 문장이어야 하며 확장이 로컬 파서로 확인한다 |
| `Set Thread … -trace/-notrace` | 실행 추적 on/off | 1403 출력량 영향 미지 — 검증 후 판단 |
| `Set Thread … -bex/-nobex` | break-on-exception 스레드별 제어 | 현재 예외 중단점은 어댑터 내부 판정뿐 — 제어기 측 제어로 옮길 여지 |
| `Pdx …` | 비트마스크 DataID를 16진수로 읽기 | **2026-08-28 구현** — MCP `read_dataids({hex:true})` |
| `Pd … <node>` | 서보 네트워크 노드별 DataID 조회 | **2026-08-28 구현** — MCP `read_dataids({node, unit, unit2, arrayIndex})`. 문서 구문 `Pd dataid, unit, unit2, array_index, node`이고 뒤 인자를 쓰려면 앞 인자를 채워야 하므로 기본값(unit 1 / unit2 1 / index 0)을 자동 보완한다 |
| `ErrorLog <thread>` / `-servo` | 스레드별·서보 기원 에러 분리 | 디버그 세션 노이즈 감소, 읽기 전용 |
| `Show StartupLog` | 기동 시 초기화 실패 원인 사후 확인 | 재부팅·재접속 진단에 유용, 스위치 미확인 |
| `help` | **제어기 펌웨어가 실제 지원하는 명령 목록** | 문서 대신 실측을 사실로 삼는 이 저장소에서 가치가 가장 큼 — 존재 여부부터 검증 권장 |
| `DataLog <count> [,file]` | 서보/모션 파형 캡처 열거 | Precise DataLogger 포맷 파서 신규 필요 |
| `Set Global <var>, <project>` + `^Z` | 프로젝트 외부에서 전역 쓰기 | `^Z`(0x1A) 종료 프로토콜이 현재 줄 단위 프레이밍과 충돌 가능 — 채택 전 프레이밍 검증 필수. 메서드 호출이 필요하면 `Execute`가 대안 |
| `Show Memory -verify` | 메모리 손상 검사 | **실기기 1회 확인(2026-08-28, 사용자)**: `<DATA></DATA>` + `STATUS 0,"Success"`로 즉시 응답, 체감 지연·이상 없음. 문서는 "실시간 응답을 방해할 수 있다"고 경고하므로 **수동 진단으로만 사용하고 자동 폴링에는 넣지 않는다**(모션 중 사용은 여전히 비권장) |
| `pc <id> … = <값>` | DataID 쓰기 | 문서 자체가 오작동 위험을 경고. 확장·MCP에 노출하지 않는 현재 방침 유지 |

**문서에 없는 것도 확인됐다.** `Kill` 명령은 Console Command Summary 49개 항목과 전문 인덱스 검색 모두
0건 — 스레드 제거는 `Stop`, 프로젝트 제거는 `Unload`가 전부다. 즉 **응답 없는 스레드를 강제로 죽이는
문서상 수단이 없다**(Stop이 -752/-753으로 시간 초과할 때의 탈출구는 저장소의 settle 게이트 + 1회 재시도가
사실상 유일). `Set/Get DataID`라는 명칭도 없고 공식 명칭은 `Pc`(쓰기)/`Pd`·`Pdx`(읽기)다.
또한 `Unload`는 문서 원문상 **디스크의 프로젝트 폴더 파일까지 제거**한다 — UI/MCP 문구가 "메모리 해제"로
오인시키지 않는지 확인이 필요하다.

## 6. DAP capability 대응 — 무엇이 가능하고 무엇이 불가능한가

VS Code 디버그 UI의 기능은 어댑터가 capability를 선언해야 나타난다. 위 조사를 근거로 분류하면:

**구현됨 (2026-08-28)** — "흉내"는 제어기에 대응 명령이 없어 확장이 같은 결과를 만드는 것을 뜻한다.
표준 DAP 요청으로 노출되므로 사용자에게는 다른 언어의 디버거와 같게 보인다.

| 기능 | 방식 | 기본값 |
|---|---|---|
| Jump to Cursor | `Set Thread <thread> -line <n>`(제어기 명령) + 같은 프로시저·실행 문장 사전 확인 | 켜짐, 실행 전 경고(`gpl.debug.jumpToCursor`) |
| Step Into Target | 대상 프로시저 첫 실행 줄에 **임시 BP + Continue**, 정지 후 임시 BP 정리. 실패 시 기본 Step 으로 폴백 | 켜짐 |
| 프로시저 이름 BP | 파서로 `Class.Proc` → 파일·첫 실행 줄 → `Set Break` | 켜짐 |
| BP 유효 줄 힌트 | 파서로 프로시저 안·실행 문장만 후보로 제시하고, 빈 줄·주석 지정은 문서 규칙대로 다음 실행 줄로 **보정해 응답** | 켜짐 |
| 조건부 BP·히트 조건·로그포인트 | 적중 시 `Show Variable` 로 평가 → 불일치면 **자동 Continue**. 평가 실패는 정지 유지 | **꺼짐**(`gpl.debug.clientSideBreakpointLogic`) |
| 값 전체 복사 | `supportsClipboardContext` — 표시용 접미·주석 없이 원문(객체는 멤버 줄로 펼침) | 켜짐 |
| 스택 지연 로딩 | `supportsDelayedStackTraceLoading` — `startFrame`/`levels` 존중 + `totalFrames` | 켜짐 |
| 정수 16진수 표기 | VS Code 가 `supportsValueFormattingOptions` 를 소비하지 않으므로 설정으로 제공(`4095 (&HFFF)`) | 꺼짐(`gpl.debug.integerHex`) |
| Run to Cursor | 종전부터 임시 BP + Continue 로 동작(VS Code 자체 구현) | 켜짐 |

**남은 후보 (제어기 명령으로 실현 가능)**

- `supportsExceptionInfoRequest` — 예외 상세 패널. `Show Thread <name>`의 코드·메시지와 `ErrorLog`를
  이미 읽고 있어 그대로 채울 수 있다.
- `supportsSetExpression` — WATCH 항목 직접 대입. `setVariable`이 쓰는 `Execute <expr> = <값>` 경로 재사용.
- `supportsRestartRequest` — `Stop -all` → 정착 대기 → `Start`를 어댑터가 한 번에. 단 모션 영향 경로.
- `supportTerminateDebuggee` / `supportSuspendDebuggee` — 종료 시 "중지 vs 실행 유지" 선택 UI.
- `supportsCompletionsRequest` — Debug Console 자동완성(부분). 확장 심볼 인덱스 + `Show Global`.
- `Set Thread -bex/-nobex` — 예외 정지를 어댑터 내부 판정에서 제어기 측 제어로 옮기는 것.

**여전히 불가능**

- 프레임 재시작, Step Back, 데이터 BP(watchpoint), 디스어셈블·메모리 뷰, instruction 단위 스텝 —
  대응 명령이 문서·실측 모두 없다.
- 제어기 자체의 조건부 BP — `Set Break` 에 조건·히트·무시 횟수 스위치가 없다(위 흉내가 유일한 길).

## 7. 표준 디버그 단축키 — 실제 동작 (2026-08-28 소스 기준)

| 키 | 판정 | 나가는 명령 / 근거 |
|---|---|---|
| `F5` Continue | 동작(조건) | `Continue <thread>`(Error면 `-noerror`). #28 게이트 + commandPolicy R1 대기가 **어댑터 자신에게도** 적용된다 |
| `F6` Pause | 동작(조건) | `Break <thread>`. 게이트에서 의도적으로 제외(폭주 제동 수단) |
| `F9` Toggle BP | 동작(조건) | `Show Break` → `Set Nobreak` 정리 → `Set Break` → 검증 `Show Break`. `gdeStyle`을 켜면 디버그 중 F9는 Continue가 되어 토글 불가 |
| `F10` / `F11` / `Shift+F11` | 동작(조건) | `Step … -over -noerror` / `Step … -noerror` / `Step … -out -noerror`(미검증) |
| `Shift+F5` Stop | 동작(조건) | disconnect만 — BP 전체 `Set Nobreak` 후 **프로젝트 실행은 유지**. `stopAllOnDisconnect: true`면 `Stop -all` |
| `Ctrl+Shift+F5` Restart | 폴백 | 재시작 요청 미지원 → 종료 + 재attach. **`deployBeforeAttach: true`면 재시작마다 UPLOAD→STOP→COMPILE 전체가 반복된다** |
| `Ctrl+F5` Run w/o Debugging | 미지원 | attach 전용 구성이고 `noDebug`를 읽는 코드가 0건. 대응물은 `GPL: Start` |
| `Ctrl+Shift+D` | 표준 | 만들 수 있는 구성은 attach 하나 |

## 8. 이 조사로 드러난 검증·정정 항목

정정 완료(이 문서와 §1-BS에 반영):

1. 1402 응답 프레이밍의 NUL 종결자 — 런북 프레이밍 기록 보강 필요.
2. GDE 5초 하트비트는 **유휴 조건 없는 무조건 주기** — "유휴 5 s마다"는 부정확.
3. GDE 1403의 NUL 1바이트는 **TCP keep-alive 프로브**(애플리케이션 write 아님).

추가 확인(2026-08-28):

- **`Show Memory -verify`** 는 실기기에서 즉시 `<DATA></DATA>` + `STATUS 0,"Success"` 로 응답했다(사용자 테스트) —
  문서 경고는 유지하되 "수동 진단 가능"으로 완화. 자동 폴링에는 넣지 않는다.
- **`Step` 네 스위치**(`-into`/`-over`/`-out`/`-noerror`)는 문서에 모두 명시되어 있다 — `-out` 도 문서 근거는 있다.
- **`Set Break`/`Set Nobreak` 표기**: 문서는 공백 있음, 실측(GDE)은 `Set Break` 무공백.
  확장은 무공백 → 실패 시 문서 표기 재시도로 양쪽을 모두 커버한다.
- **`Start -event` 의미 확정**: "쓰레드 상태 변경을 콘솔 메시지가 아니라 이벤트로 보낸다".
  GDE 가 항상 쓰는 이유가 설명되며, 확장도 기본값으로 채택했다.

실기기 검증 대기:

- `Step … -out`의 실제 동작(문서 근거는 있고 캡처 근거가 없음).
- `Set Nobreak`의 무공백 형식 동작 여부(폴백 로그 `문서 표기로 재시도`가 뜨는지로 확인 가능).
- `Start -event` 유/무에 따른 1403 수신량 차이(기본값을 `-event`로 바꾼 뒤 첫 세션에서 관찰).
- `Start … -event` 유/무에 따른 1403 수신량 차이.
- `help` 명령의 존재 여부 → 펌웨어 실제 지원 명령 목록.
- `Pdx`, `Pd … <node>`, `ErrorLog <thread>`/`-servo`, `Show StartupLog`의 응답 형식.
- `Show Break`의 procLine(4열)을 우리 파서가 쓰지 않는지 재확인.
- `Execute`가 만드는 `_Cmd_<project>` 스레드를 settle 판정이 사용자 스레드로 오인하지 않는지.
