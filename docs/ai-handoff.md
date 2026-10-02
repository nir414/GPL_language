# AI 인계 자료 — GPL Language Support 확장 작업 핸드오프

- **최종 갱신: 2026-10-02** · 현재 package 버전 **0.9.11**(package.json 기준 — **버전 역행 이력 있음**: 0.9.9 까지 로컬 빌드된 뒤 작업 사본이 커밋값 0.9.1 로 되감겨 0.9.2~0.9.8 을 재사용, §3 참조 · 태그 `v0.9.0` — CI `release.yml`이 빌드·패키징·릴리즈)
- **직전 세션: §1-EG** — **누적 작업 트리 커밋 정리.** §1-DR~§1-EF의 대화·인계 기록과 실제 diff를 대조해 언어 분석, 프로젝트/중단점, 제어기 진단·업로드, AI Setup, 문서·매니페스트의 5개 검토 단위로 정리했다. `npm test` 1045/1045와 controller-mcp 102/102 통과. 제어기 명령·F5·패키징은 수행하지 않았다.
- 대상 저장소: `C:\Users\Doyun\Documents\GitHub\GPL_language` (VS Code 확장 `nir414.gpl-language-support`)
- 테스트 대상 프로젝트: `C:\SVN\pa\trunk\develop\07. Others\37. 핵산 Oligo 합성과제\시뮬레이션\projects\MergeCode` (65 파일)
- 제어기: G2400C, GPL 4.2K5, `192.168.0.1` (명령 1402 / 런타임 콘솔 1403)

## 이 문서 읽는 법

| 순서 | 섹션 | 내용 |
| --- | --- | --- |
| 1 | [§0 하드 규칙](#0-반복-실수-방지--하드-규칙-다음-작업자-필독) | 반복된 실수를 막는 규칙. **작업 전 필독** |
| 2 | [§2 미결](#2-진행-중--코드-쪽-미결-사용자-결정-대기) | 사용자 결정을 기다리는 항목 |
| 3 | [§3 다음에 할 일](#3-다음에-할-일-체크리스트) | **다음 작업은 여기서 고른다** |
| 4 | [§4 핵심 파일](#4-핵심-파일) | 소스 지도 |
| 5 | [§5 참고](#5-참고--정상-컴파일-응답-형식-gde-verbatim-2026-06-30) | 정상 컴파일 응답 원문 |
| 6 | [§1 세션 이력](#1-세션-이력--최근-세션--전체-인덱스) | 최근 세션 본문 + 전체 인덱스(과거분은 아카이브) |

> **섹션 번호는 바꾸지 않는다.** `§0`·`§1-XX`·`§3-B`·`§4`는 소스 주석(`deployService.ts`,
> `controllerConnection.ts` 등), `CLAUDE.md`/`AGENTS.md`, 런북, `package.json` 설정 설명에서 참조한다.
> 대신 **물리적 순서만** 읽는 순서에 맞췄다 — 분량이 큰 §1 세션 이력을 뒤로 뺐다.

> **이 문서를 갱신하는 규칙**은 `CLAUDE.md`(=`AGENTS.md`) §작업을 마칠 때 반드시 남길 기록에 있다.
> 요약: 헤더는 **직전 세션 1건만**(요약 체인을 잇지 않는다), §1 본문은 **최근 10세션**만 두고
> 넘치면 `docs/archive/handoff/<YYYY-MM>.md`로 옮기며, §3의 완료 항목은 지운다.

---

## 0. 반복 실수 방지 — 하드 규칙 (다음 작업자 필독)

세션이 넘어가며 같은 실수가 반복됐다. 아래는 반드시 지킨다. (상세: `.github/instructions/gpl-ai-controller-debugging.instructions.md`)

1. **로그 파일을 실시간 상태/통신 채널로 쓰지 않는다.** `Compile.log`, `Robot.log` 등은 사후 기록용이다. 현재 컴파일/실행/연결 상태는 오직 1402 명령의 **live 응답**(`<STATUS>`/에러 라인)과 1403 스트림으로만 판단한다.
2. **작업 성공/실패는 그 명령 자신의 `<STATUS>`로만 판정한다.** 응답을 종결자 `</STATUS>`까지 끝까지 읽는다. `Show Thread`가 응답한다거나 `pass 1/2/3` 로그가 보인다는 식의 **간접 신호로 성공을 추정 금지**.
3. **단정 전에 live 데이터/소스를 확인한다.** "Build Only인지 F5인지"는 채널/세션(`[GPL Debug]` 접두어, 디버그 툴바)으로 구분. attach 시작 조건 등 동작은 추측 전에 소스를 읽는다.
4. **환경 주의 (중요):** 이 작업 환경의 샌드박스는 **방금 수정한 파일을 잘린(truncated) 상태로 읽어** `tsc`가 가짜 문법 오류(`Invalid character`, `')' expected` 등 파일 끝부분)를 낸다. **이는 코드 오류가 아니다.** 검증은 반드시 사용자 로컬에서 `npm run compile`로 한다. 호스트 파일은 정상이다.
   - 2026-07-03 추가: 반대 방향 문제도 확인됨(호스트 도구로 쓴 파일이 샌드박스에서 잘리거나 NUL 패딩으로 보임). **파일 수정을 샌드박스 bash(heredoc/python)로 수행하면 양쪽이 일관된다.**
5. **하위 프로젝트 `npm install`은 Windows에서만 실행한다.** 리눅스 샌드박스/WSL에서 실행하면 `node_modules/.bin`에 유닉스 심볼릭 링크가 생기고, Windows의 `vsce package`가 `EACCES: permission denied, scandir ...`로 죽는다(2026-07-03 실제 발생, §1-C). `scripts/package.js`의 preflight가 이를 감지해 준다.
6. **`Stop -all`의 STATUS 0은 "정지 요청 접수"이지 정지 완료가 아니다.** 정지 완료 전에 `Compile`/`Start`를 보내면 제어기 이상 현상(메모리 누수 의심, 2026-07-08 사용자 관찰, §1-G)이 발생할 수 있다. Compile/Start 전에는 반드시 `Show Thread`로 모든 쓰레드가 Idle/Stopped/Error임을 확인한다. `deploy()`에 게이트가 구현돼 있으니 우회 경로를 만들지 말 것. (2026-08-28 §1-BN: 명령 정책 R2가 `sendCommandDetailed`에서 **모든 경로**의 Start/Compile/Load/Unload 앞에 `Stopping` 쓰레드 정착을 기다리므로 우회 경로가 생겨도 이 조건은 유지된다 — Running 쓰레드는 막지 않음.)
7. **PA 제어기의 `Start`는 스위치 없이는 컴파일하지 않는다 — `-compile`을 반드시 붙인다(2026-09-10 사용자 실기 관측, §1-DN).** `-compile` 없이 `Start`하면 제어기는 컴파일하지 않고 **직전에 컴파일돼 있던 바이너리를 그대로 실행한다** — FTP로 `/GPL`에 올린 새 소스가 반영되지 않는다. 캡처(`captures/gde_1402.pcapng`)의 GDE도 `Load /flash/projects/GPL_Code → COMPILE Test_robot → Start Test_robot -event` 순으로 **Start 앞에 명시적 `COMPILE`을 따로 보냈다**. ~~옛 규칙: "Start가 자체적으로 Compile을 수행한다(2026-08-25 명시)"~~ — 그 캡처의 `-event`만 보고 내린 오독이었고 **무효**다. 확장은 `startCommand.buildStartCommand`가 `-compile`을 기본으로 붙여 보장한다(`compile: false`를 명시할 때만 뺀다). **여전히 유효한 함의: Compile 직후 Start를 연속으로 보내지 않는다(컴파일 중복) — 한 번에 하나만.** (2026-08-28 §1-BN: 명령 정책 R3이 같은 프로젝트의 Compile 응답 완료 뒤 `gpl.controller.startAfterCompileGapMs`(기본 1.5 s) 완충을 두고 Start를 보낸다 — 안전성 미검증이라 거부가 아닌 완충.) Deploy는 Compile까지, 실행은 `GPL: Start`가 별도. "컴파일 검증 필요" 상태의 뜻은 "에러 미검증 — Start의 `-compile`이 실패할 수 있고 Problems 연동이 없다"이다.

---

8. **제어기 채널은 번호가 아니라 이름으로 부른다 (2026-09-22 사용자 결정, §1-EB).** `1402`·`1403` 은 번호를 외운 사람에게만 뜻이 통한다 — 사용자 대면 문구(트리·알림·명령 제목·설정 설명·보고서)와 AI 대면 문구는 **명령 콘솔**·**런타임 콘솔**·**FTP** 로 쓴다. 번호는 ① 설정 값 ② `ip:port` 엔드포인트 ③ 원인을 가리는 진단 상세에서만 덧붙인다(`명령 콘솔(1402)`). 용어 정본과 헬퍼는 `controller/channelNames.ts`, 명령 제목은 구조 테스트 **R8** 이 지킨다. 그대로 두는 것: 로그 태그(`[1402]`·`[Console][RC1403]`)·설정 키(`keepAlive1402`)·포트가 주제인 프로토콜 문서(`docs/reference/console-commands.md`)·과거 기록(CHANGELOG·아카이브).

## 2. 진행 중 / 코드 쪽 미결 (사용자 결정 대기)

- **`ProtocolModule.gpl` 478·480의 `-760 Invalid assignment`**: `isOrgCompleted`는 `RobotModule.gpl:828`에 **`Public ReadOnly Property ... As Boolean`**(읽기 전용)으로 정의됨. 거기에 값을 대입해서 나는 에러. 해결책(택1, 사용자 결정 대기): setter 메서드 추가 / `ReadOnly` 제거 후 `Set` 접근자 추가 / backing 필드 직접 대입.
- (참고) GDE 기준 원래 4개 에러(477 -730, 478 -760, 479 -748, 480 -760)였는데 477/479는 사용자가 정리한 듯, 현재 478/480만 남음.
- **(2026-08-31) 「GPL 디버깅 자동화의 헛방질·사용자 개입 감소」 개선안 — P0 완료(§1-CM), P1·P2 범위 결정 대기.**
  P0 1~5(자동화 대상 명시·QuickPick 금지·세션 대상 고정·active editor 배제·`-714` 추측 차단)와 6~8(단일 관측으로
  강한 장애 판정 금지·상태 변경 전 관측·미확정 사건의 영구 기록 금지)은 §1-CM·§1-CL 에서 처리했다.
  API 형태는 **기존 명령에 대상 인자를 추가**하는 쪽으로 정했다(`gpl.controller.connect` 의 기존 비대화형 패턴과
  동일 — 별도 `gpl.automation.*` 명령군을 만들지 않았다. 예외는 조회/고정 전용인 `gpl.automation.target` 하나).
  남은 결정:
  - **P1**(디버깅 품질): 가설 상태 모델(Observation/Hypothesis/Supported/Confirmed/Rejected) · prediction·refutation
    조건 유지 · discriminating probe 우선 · 반복 failure signature 감지 · 상태 변경 명령의 before/after snapshot ·
    command purpose/information gain 관리. **이 중 어디까지를 코드로 강제할지**가 결정 사항이다 — 상당 부분은
    AI 의 추론 규율이라 `SERVER_INSTRUCTIONS`(지침)로 두는 것이 맞고, 코드로 강제할 수 있는 것은
    "상태 변경 도구가 before/after 스냅샷을 자동 첨부"·"같은 failure signature N회면 응답에 전략 전환 넛지"
    정도다(`pause_thread`·`continue_thread` 에 이미 있는 패턴의 확장).
  - **P2**: high-level `runProject` workflow(deploy→compile→reload→start→verify 한 호출) · interactive UI 발생 감지 ·
    동일 사용자 개입 반복 시 automation defect 로 기록.
  - `gpl.uploadStart` 의 **대화형** 경로에 Start 확인 모달이 없다(§1-CD 기록과 코드가 다르다). 비대화형은 이번에
    `confirmStart` 를 요구하게 됐는데, 대화형에도 모달을 넣을지 — 사람이 로켓 버튼을 누르는 것 자체가 의도
    표명이라 안 넣는 쪽도 일관된다. **사용자 결정 필요.**

- **(2026-09-02, §1-CU) `symbolCache.indexWorkspace()` 에 전역 상한을 둘지 — 사용자 결정 대기.**
  지금은 워크스페이스의 **모든** `.gpr` 프로젝트 소스를 `openTextDocument` 로 연다. 프로젝트별 상한은
  이미 있지만(`collectProjectSourcePaths` 의 `truncated`) 전역 상한이 없어, 과제 폴더를 여러 개 담은
  상위 폴더를 열면 활성화가 느려질 수 있다. 상한을 두면 **조용히** 일부 파일이 정의/참조/자동완성에서
  빠진다 — "느리지만 완전" → "빠르지만 불완전" 으로 트레이드오프가 바뀐다. 실제로 느린지(실측)와
  어느 쪽을 원하는지가 결정 사항이다. 중간안: 상한 대신 **인덱싱 파일 수·소요 시간을 Output 에 남겨**
  먼저 관측 가능하게 만드는 것.

---

## 3. 다음에 할 일 (체크리스트)

### 명령 UI — 남은 결정

- [ ] **`Send Command`·`Copy Situation`·`Reset Panel Layout` 을 트리로?** 사용자는 "패널에서 고를 수 있잖아"
      라고 했지만 **대조 결과 이 셋은 트리 항목이 없다** — 그래서 `···` 에 남겼다. 트리에 넣을 자리를 만들지 결정 필요.

열린 항목만 둔다. 완료된 항목은 `docs/archive/handoff/2026-08.md` §부록으로 옮겼다(2026-08-31 정리).

- [ ] **(2026-10-02, §1-EF) AI Setup — F5 UI 확인.** `Sample Prep`처럼 프로젝트가 여럿인 폴더에서 Export → 대상 미확정/프로젝트 선택, 동명 MergeCode 폴더 선택과 재실행 유지, multi-root 저장 위치, CLAUDE/AGENTS 충돌 안내를 확인한다. 실제 작업 폴더의 안내 수정·MCP 재연결·설치·제어기 실행은 이번 검증에서 수행하지 않았다.
- [ ] **(2026-09-30, §1-EE) 업로드 진행 바 — F5 개발 호스트 + 실기기 확인.** ① Deploy/Quick Compile 중 상태바 왼쪽(연결 항목 옆)에
      `$(sync~spin) ██████████░░░░░░░░░░  3.2 MB / 10.7 MB` 가 **한 항목에서 제자리로** 움직이는지(줄이 쌓이지 않는지), 블록·부분 블록
      (`▏▎▍▌▋▊▉`) 글자 폭이 상태바 글꼴(Segoe UI 폴백)에서 흔들리지 않는지 ② 끝나면 `✔ 업로드 완료 …` 가 2.5초 보였다 사라지는지, FTP
      실패 시 경고색 `업로드 실패` 가 5초 남는지 ③ autoOnSave(파일 1개)에서 깜빡임이 방해되지 않는지 — 거슬리면 `autoGate` 경로는 완료
      표시를 생략하는 쪽으로 ④ Save to Flash 도 같은 바가 뜨는지 ⑤ 바 폭 20칸이 적당한지(사용자 예시는 30칸 — `UPLOAD_BAR_WIDTH` 상수 하나).
- [ ] **(2026-09-29, §1-ED) 개요 「커서 따르기」 — 편집기 확인(제어기 무관).** ① 클래스 뒤에 모듈 레벨
      Sub/Function 이 있는 파일(사용자의 `ProtocolModule` 파일 또는 `samples/syntax-tour/Shapes.gpl`)을 열고
      개요에서 그 Sub 를 클릭 → 개요 선택이 클릭한 항목에 **머무는지**(종전: 클래스로 되돌아감) ② 에디터
      커서를 Property 의 Get 본문·중첩 클래스 본문에 두면 개요가 그 Property/중첩 클래스를 하이라이트하는지
      ③ 개요 계층에서 중첩 클래스(Shapes 의 Snapshot)가 바깥 클래스(Counter) 아래에 나오는지.
- [ ] **(2026-09-22, §1-EB) 클래스 참조 찾기 — 실프로젝트 확인(제어기 무관).** `GenAdp` 에서 `App\Control\Machine.gpl` 의 `Class MachineRobot` 선언에 커서를 두고 "모든 참조 찾기" → `App\Host\Commands.gpl` 의 `Private g_robot As MachineRobot` 과 `Main.gpl:101` 의 `New MachineRobot(...)` 이 함께 나오는지, 사용부에서 실행했을 때와 목록이 같은지. 이어 **한정 표기 정책**을 정할 것 — `As ROB.MachineRobot` 위에서 실행하면 지금은 `ROB.MachineRobot` 만 모은다(`shouldPreferQualifiedOnly`). 타입은 한정/비한정이 같은 대상이라 합치는 쪽이 맞아 보이지만 멤버(`Module.Member`) 정책까지 함께 바뀐다.
- [ ] **(2026-09-21, §1-DZ) 구문 강조 — 편집기 확인(제어기 무관).** `TcpProtocol.gpl:65` 의
  `Public SyncSub As TcpSyncCmdSub` / `Public AsyncSub As TcpAsyncCmdSub` 에서 ① 식별자가 통째로 한 색인지
  (`Sub` 만 다른 색이면 회귀) ② `As` 가 키워드 색인지(프로시저 이름 색이면 회귀) ③ `TcpSyncCmdSub` 가 타입 색인지.
  이어 `samples/syntax-tour` 를 F5 "Run Extension (syntax tour)" 로 열어 ④ `Declarations.gpl` 의
  `Private SyncSub, AsyncSub As LogSink` 가 ①~③ 과 같은지 ⑤ `Dim ex As New Exception` 에서 `New` 는 키워드 색,
  `Exception` 은 타입 색인지(종전에는 `New` 가 타입 색, `Exception` 은 무색) ⑥ `Public Sub Main()`·
  `Public Overrides Function Describe() As String`·`Public Delegate Sub LogSink(…)`·`Public Const SlotLimit As Integer = 3` 의
  키워드·이름 색이 종전 그대로인지(줄 머리 고정으로 정상 선언이 빠지지 않았는지). 테마는 Dark+ 기준으로 본다.
- [ ] **(2026-09-18, §1-DX) 시작 시 인덱싱 개선 — 실워크스페이스 확인(제어기 무관).** `…\34. Sample Prep\장비 구성` 처럼 `.gpl` 수백 개인
  워크스페이스에서 `gpl.trace.server: verbose` 로 첫 `.gpl` 을 열고 Output 의 `[SymbolCache] Indexed N files in X ms` 를 읽는다.
  기대: 종전 파일당 576줄 로그 대신 요약 1줄, X 가 사용자 측정(읽기+파싱 465 ms + 재구축 798 ms) 에서 재구축 몫이 빠진 수준.
  호버·자동완성·F12 가 종전과 같은지, 인코딩 이상(한글 주석 깨짐 — `files.encoding` 이 UTF-8 이 아닌 워크스페이스면 문서 경로로 폴백해야 함)이 없는지 본다.
- [ ] **(2026-09-18, §1-DX) 동명 소스 해석 — 실기 확인(읽기 전용).** 동명 `MergeCode` 가 3개인 워크스페이스에서 ① MCP `project_target` 을
  `Dilution\…\MergeCode` 로 고정(또는 `GPL: Debug Project` 로 그 폴더 선택) ② Quick Attach → Debug Console 에 `프로젝트 폴더 확정(projectDir): …Dilution…` ③ 런타임
  에러/정지 시 열리는 파일이 `Dilution` 사본인지, Output 의 `⚠ 동명 소스 N개 경합` 경고가 사라졌는지 ④ 트리의 기대 프로젝트를 다른 이름으로
  바꾸면 `[ProjectContext] ⚠ 세션 대상 폴더 … 다릅니다` 가 **1회만** 나오고 이름 일치 해석으로 떨어지는지.
- [ ] **(2026-09-18) package.json 버전 역행 정리 — 사용자 결정.** 커밋된 버전은 09-10 이후 0.9.1 그대로이고 `npm run package` 의 bump 는 작업 사본에만
  쌓였다(0.9.9 까지 빌드·설치됨, 번들 스탬프 `v0.9.9 33fede3 2026-09-11T00:54Z`). 09-11 09:54~10:47 사이 작업 사본이 0.9.1 로 되감겨(메커니즘 미확정 —
  `git checkout`/stash 류 또는 동시 세션 추정) 이후 0.9.2~0.9.4 가 **재사용**됐다. 제안: ① `package.json`·`package-lock.json` 을 0.9.10 으로 올리고 그 bump 를
  커밋에 포함 ② `scripts/package.js` preflight 에 "설치된 확장 폴더/`git tag` 최고 버전보다 낮으면 중단" 검사 ③ 패키징 후 버전 변경을 세션 커밋에 담는 기록 규칙 한 줄.
- [ ] **(2026-09-21, §1-EA) `upload-start` 브리지 응답 240 s 타임아웃 vs 작업은 2초 만에 COMPLETED.** MCP `deploy_project(mode:"upload-start")`
  두 번째 호출이 `BRIDGE_REQUEST_TIMEOUT` 으로 돌아왔는데 `operation_status` 는 `upload_start-…-3 COMPLETED · 2초`. 첫 호출(-742 실패)은 17초에
  정상 응답. 응답 파일 전달이 빠진 경로를 찾을 것(요청 id `1789970243410-20216-17-gwvuxc`, 확장 pid 25164).
- [ ] **(2026-09-21, §1-EA) `upload-start` 의 Start `-compile` 컴파일 에러가 `compileErrors: []` 로 온다.** RAW 에는 `StageB_ClassInit.gpl:13:(-719)…` 가
  있는데 구조화되지 않아 Problems 점프·MCP 호출자 모두 위치를 못 받는다. `projectCommands.compileOnce` 의 `parseCompileErrors(resp.raw)` 를 Start 응답에도
  적용하면 될 것(§0.7 의 "Start 실패 시 에러 위치가 Problems 에 오지 않는다" 를 실제로 메우는 일).
- [ ] **(2026-09-21) 제어기 연결 유실이 나흘간 7회 반복 — 원인 확정(확장 밖일 가능성 높음, 읽기 전용).** `%TEMP%\gpl-controller\postmortem-*.log`
  7건이 같은 서명이다: 장시간 유지된 keep-alive 소켓이 **1402·1403 동시에 `read ECONNRESET`** → 재접속은 `ECONNREFUSED`/`ENETUNREACH`/timeout.
  직전 폴링은 전부 `<STATUS>0`(4~8 ms), 교란 명령 없음. 3건에서 `192.168.0.1` 응답 장치가 **MSI MAC `D8-43-AE-A9-7F-89`·TTL 64**(제어기는
  `00-14-FF`·TTL 255), 2건은 경로 자체가 없음(ENETUNREACH) → **PC 직결 NIC 링크/IP 유실**이 1순위 가설(사무실 라우터가 192.168.0.1 이라
  직결이 죽으면 그쪽으로 흐른다). 다음 유실 때 ① `arp -a 192.168.0.1` ② `ping` TTL ③ 직결 NIC `ipconfig`(APIPA 여부)로 확정.
  확장 쪽 후보 하나: postmortem 헤드라인(`## 판정`)에 "응답 장치 ≠ 제어기" 를 올리기 — 지금은 도달성 섹션 안에 묻혀 있다(사용자: 우선 기록만).
- [ ] **(2026-09-18, 사용자 문서 이슈 A — 확장 밖) 제어기 `-200 *No memory available*` 재현 조사.** 기동 5초 뒤 재현, 프로젝트 점유 약 4.38 MB/45,770 세그먼트(평균 100 B —
  작은 객체 대량), Unload 후 6.79 MB/42,099 세그먼트 잔존(baseline 인지 미확정). 확인 순서: ① 재부팅 직후 `Show Memory` baseline ② `DataKeyValue.New`(`raw.Split("=")`)
  대량 생성 호출부 ③ `_robot_Robot.gpl:1260` `opCommandRunThread.Start` 전까지의 기동 할당량 — 디버거 예외 위치(`_lib_DataKeyValue.gpl:52`)와 `Show Stack`
  (`_robot_Robot.gpl:1260`)의 불일치도 미해결. 확장 쪽 함의는 §1-DX 의 ERROR CHECK 문구 정정으로 끝(관측 창 추가는 배포 잠금이 길어져 보류).
- [ ] **(2026-09-18, §1-DV) 상태바 "컴파일 검증 필요" 배지 분리 — 실동작 확인(제어기 연결 필요, 읽기·컴파일만·모션 무영향).** ① 연결 후 `gpl.quickCompile.autoOnSave` = `auto` + 쓰레드가 도는 상태로 .gpl 저장(업로드만 되고 Compile 보류) → 상태바에 `$(plug) GPL: <ip>` 는 **보통 색**으로 남고 그 오른쪽에 `$(warning) 컴파일 검증 필요: <프로젝트>` 가 **별도 항목**으로 경고색인지 ② 배지 클릭 → **연결이 끊기지 않고** Quick Compile 이 선택 창 없이 그 프로젝트로 나가는지(Traffic 에 `Compile <프로젝트>`) ③ Compile 성공 → 배지만 사라지고 연결 항목은 그대로인지 ④ 연결 항목 클릭 → 종전대로 연결 해제, 배지도 함께 숨는지 ⑤ 미검증 상태를 남긴 채 재연결 → 배지가 다시 뜨는지 ⑥ 프로젝트가 여럿인 워크스페이스에서 트리의 "컴파일 검증 필요" 항목을 눌러도 선택 창 없이 **같은 프로젝트**로 Quick Compile 이 나가는지(배지 규칙 공유) ⑦ 같은 상태에서 `GPL: Start` 확인 모달과 MCP `start_project` 의 `COMPILE_UNVERIFIED` 메시지가 배지 툴팁과 **같은 설명 문장**인지(사유·시각 포함).

- [ ] **(2026-09-17, §1-DU) Delegate 심볼 — 편집기 확인(제어기 무관).** `GPL_Code_v2` 워크스페이스에서 ① `LogFile.gpl:238` `New LogSinkSub(AddressOf OnLogLine)` 의
  `LogSinkSub` 에서 F12 → `Logger.gpl:77` 선언으로 가는지 ② 같은 자리 호버가 `**Delegate** LogSinkSub` + 코드 블록 `Delegate Sub LogSinkSub(ByVal line As String)` + 위 주석
  (문서화 주석)인지 ③ `Dim sinkList(SINK_MAX - 1) As LogSinkSub` 의 `LogSinkSub` 에서도 F12/호버가 되는지 ④ 개요(Outline)에 `LogSinkSub` 가 클래스 아이콘으로 **한 줄 범위**로 나오고,
  그 아래 `SINK_MAX`·`RegisterLogSink` 가 모듈 레벨에 정상 배치되는지(블록 깊이 오염 없음) ⑤ `LOG.` 자동완성에 `LogSinkSub` 가 나오는지 ⑥ 디버그 세션 중 `New LogSinkSub(` 의 이름 위에서
  디버그 hover 가 뜨지 않는지(타입 이름, 규칙 0-c) ⑦ 선언 위에서 `'''` → `# Parameters` 에 `line` 항목이 생기는지.

- [ ] **(2026-09-17, §1-DT) 구문 강조 — 편집기 확인(제어기 무관).** `Logger.gpl:77` `Public Delegate Sub LogSinkSub(ByVal line As String)` 에서
  ① `Delegate` 가 키워드 색, `LogSinkSub` 가 **클래스 이름과 같은 타입 색**, `ByVal` 이 수식어 색인지 ② `RegisterLogSink(New LogSinkSub(AddressOf OnLogLine))` 의
  `AddressOf` 가 연산자 색인지 ③ `Public Overrides Function Describe()`·`Public Shared ReadOnly Property Count` 의 **이름**이 함수 색인지(이중 괄호 버그 수정 확인 —
  종전에는 이름이 무색이거나 `Sub` 키워드가 함수 색이었다) ④ `Try/Catch/Finally/Throw`·`End Try`·`End Module`·`Me.`·`Inherits Base`·`x Is Nothing` 에 색이 붙는지
  ⑤ 식별자 일부(`IsConnected`·`Member`·`Steps`)가 키워드 색으로 오염되지 않는지. 확인 뒤 VSIX 로 배포하면 CHANGELOG 항목 추가.

- [ ] **(2026-09-17, §1-DS) 디버그 hover 정리 — 실기 확인(읽기 전용, 모션 무영향).** MergeCode_Beta `GPL.MAIN` 에서 정지한 상태로
  ① `rt1` hover → `rt1Datafile` 펼치면 `(펼칠 수 없음) = -729 *Undefined symbol* — 현재 프레임에서 해석되지 않는 이름…` 행 **하나**와
  Debug Console 의 `rt1.rt1Datafile 펼치기 실패 -729 … (프레임 GPL.MAIN @ …)` 로그가 나오는지(종전 `(값) = ℹ …` 없음)
  ② `New UserSaveData(...)`·`New System(...)` 의 클래스 이름, `Thread.Sleep(100)` 의 `Thread` 위에서는 디버그 hover 가 뜨지 않고 정적 hover 만 뜨는지
  ③ `myRobot(r-1).arm(a-1).isUseCrashDetectSensor` 줄에서 `arm` 위에는 디버그 hover 가 없고, `isUseCrashDetectSensor` 위에는
  `-1  (Boolean)  ← m_crashDetectSensorIO <> 0 (m_crashDetectSensorIO = N → True) (getter 분기 계산)` 처럼 값이 나오는지(N 은 덤프의 실제 값),
  Debug Console 에 `프로퍼티 분기 계산` 로그 ④ `myRobot` hover → 요소 객체 트리의 `isUseCrashDetectSensor` 가상 자식이 계산값으로 보이는지
  (종전 `(프로시저 — 평가 불가)`) ⑤ `theSystem.useZPosErrorCheck`(단순 Return getter) 표시가 종전과 같은지 — 회귀 확인
  ⑥ Watch 에 `rt1.rt1Datafile` → `Object DataFile` 행, 펼치면 ①과 같은 행 · Debug Console REPL 에 같은 식 → `rt1.rt1Datafile, Object DataFile` + 이유 줄
  ⑦ (사실 확인) `Show Variable -eval <thread> 0 myRobot(0).CheckMotorStateThread` 가 STATUS 0 + Thread 덤프인지(Public 필드 점 표기 통과 — §1-DS 사실 정리의 근거를 명령 응답으로 고정).

- [ ] **(2026-09-18, §1-DW) 문법 전수 샘플 `samples/syntax-tour` — 편집기 확인 + 실기 컴파일 확인.**
  **(가) 편집기(제어기 무관, 모션 무영향)**: F5 "Run Extension (syntax tour)" 로 열고 ① 네 파일의 구문 강조가
  깨지는 곳이 없는지(특히 `Delegate`·`AddressOf`·`Me`·`Exit Try`·`Case Else`·라벨 `Retry:`) ② 개요(Outline)에
  Module 4 · Class `Counter`/중첩 `Snapshot` · Property 3 · Delegate 2 가 제대로 서는지 ③ Problems 패널이 비어
  있는지(가짜 진단이 뜨면 그 규칙이 과잉) ④ `Counter.Count` 위 호버에 Set 절 괄호 규칙 설명이 뜨는지.
  **(나) 실기 컴파일(모션 없음 — Deploy + Compile 까지만, Start 는 선택)**: `deploy_project` 로 `/GPL/syntax_tour`
  에 올리고 `COMPILE` 의 `<STATUS>` 를 끝까지 읽어 판정한다. **문서화되지 않은 세 가지가 이 확인의 목적**이다 —
  ① `Shapes.gpl` 의 `Describe` 오버로드 3형제(공식 `Function` 문서에 `Overloads` 가 없다) ② 중첩 `Class Snapshot`
  ③ `WriteOnly` Property. 거부되면 그 요소만 샘플에서 빼고 §1-DW "남은 일" 에 STATUS 원문을 근거로 남긴다
  (커버리지 테스트는 `gplStatements.ts` 의 문만 강제하므로 이 셋을 빼도 깨지지 않는다).
  ④ Start 까지 해 본다면 콘솔에 `syntax-tour: done` 이 찍히는지만 보면 된다(모션 API 없음).

- [ ] **(2026-09-18, §1-DW) `gplParser.ts` 의 `Type … End Type` 분기 제거 검토.** GPL 공식 Statement Dictionary 에
  `Type` 문이 없다(2026-09-18 디렉터리 열거). 사용자 실제 코드에 `Type` 선언이 있는지 확인한 뒤, 없으면 파서 분기와
  `gplReservedWords.ts` 의 `type`·`enum`·`inherits`·`implements`·`with` 항목을 정리한다 — **있으면 그대로 둔다**
  (문서에 없지만 동작하는 사례가 있으므로 §0.3 대로 실물 확인이 먼저다).

- [ ] **(2026-09-17, §1-DR) 오버로드 문서화 주석 병합 — 편집기 동작 확인(제어기 무관, 모션 무영향).** 같은 모듈에
  `Foo(a As Integer)`(전체 문서: 설명 + `a` 항목) · `Foo(a As Integer, b As String)`(설명 한 줄 + `b` 항목만) ·
  `Foo(a As Integer, b As String, c As Integer)`(주석 없음)를 두고 ① 세 번째 이름 위 호버 → 헤더에 `+2 오버로드`,
  첫 번째의 공통 설명 + 두 번째의 설명, `a`·`b` 설명이 채워지고 마지막에 이탤릭 출처 줄(`*형제 오버로드에서 가져옴 — …*`)이
  보이는지 ② `Foo(1, "x", 3)` 입력 시 시그니처 도움말 세 번째 시그니처에서 활성 매개변수 `a`·`b` 의 설명이 뜨는지
  ③ 세 번째 선언 바로 위 `'''` → 골격에서 `a`·`b` 항목이 빠지고(`c` 만) 완성 항목 설명에 "오버로드가 2개 더 있습니다 —
  차이만 씁니다(… 은 뺐습니다)" 안내가 붙는지, 전구 `보완` 도 `a`·`b` 를 빠진 항목으로 세지 않는지 ④ 세 선언의 **순서를
  뒤집어 저장**해도 ①의 결과가 같은지 ⑤ 오버로드가 아닌 `Clamp` 호버가 종전과 동일한지(`+N` 없음, 출처 줄 없음)
  ⑥ 두 오버로드에 같은 분량의 전체 문서를 각각 써 둔 그룹에서는 공통 설명 줄이 붙지 않는지(애매하면 생략 규칙).
  ※ 이 시나리오는 `samples/syntax-tour/Shapes.gpl` 의 `Describe` 3형제로 그대로 재현된다 — F5 "Run Extension (syntax tour)"
  로 열면 ①~④·⑥을 바로 해 볼 수 있고, ⑤의 비교 대상 `Clamp` 는 `Main.gpl` 에 있다 (§1-DW).

- [ ] **(2026-09-10, §1-DK) 자동화 구조 개선 실기기 검증 — 다중 창·타임아웃·증적.** 모션 무영향(배포/조회만,
  `upload-start` 는 쓰지 않는다). ① **VS Code 창 2개**를 같은 제어기로 열고 `extension_list` → 두 창이 각각
  다른 `extensionInstanceId` 로 나오는지(종전에는 presence 가 서로 덮여 하나만 보였다). ② 한쪽 창의
  워크스페이스에 있는 프로젝트로 `deploy_project(projectDir=…)` → **그 창이** 배포를 수행하는지(확장 Output 의
  `[Bridge] 실행` 줄로 확인). ③ `projectDir` 없이 호출 → `EXTENSION_AMBIGUOUS` + 후보 목록이 오는지.
  ④ 배포 중에 `operation_status` → RUNNING + 현재 phase 가 보이는지. ⑤ `timeoutMs` 를 일부러 짧게(예 10000)
  주고 호출 → `BRIDGE_REQUEST_TIMEOUT` + `recovery.action="CHECK_OPERATION"` + operationId 가 오고, 그 id 로
  조회하면 진행/완료가 보이는지(**다시 배포하지 않고**). ⑥ 같은 대상으로 두 번 연속 호출 → 두 번째가
  `DEPLOY_IN_PROGRESS` 로 기존 작업을 가리키는지. ⑦ 파일 하나를 고치고 저장만 한 뒤 배포 →
  `provenance.inSync=true`, 반대로 고친 뒤 업로드를 건너뛴 상황을 만들면 `changedSinceUpload` 에 그 파일이 뜨는지.
  ⑧ 창을 하나 닫고 15초 뒤 `extension_list` → 그 인스턴스가 목록에서 빠지고, 남은 창이 레거시 큐 담당(leader)을
  물려받는지(확장 Output `[Bridge] 레거시 큐 담당 획득`).
- [ ] **(2026-09-10, §1-DK) 구버전 MCP 사본 호환 확인.** `GPL: Export AI Agent Setup` 으로 globalStorage 에
  복사된 예전 `gpl-controller-mcp.cjs` 가 남아 있는 환경에서, 새 확장과 함께 **레거시 IP 큐**로 계속 동작하는지
  (`extension_status` 가 `legacyPresenceOnly:true` 로 오고 명령이 나가는지). 창이 2개일 때 구버전 경로는
  리더 창으로만 나가므로 경쟁은 없지만 **대상 창을 고를 수 없다** — 그 경우 사용자에게 MCP 사본 갱신을 권할 것.

- [ ] **(2026-09-10, §1-DJ) 연결 해제 시 디버그 세션 종료 — 실기기 검증.** ①~③은 통신 패턴·UI(모션 무영향),
  ④는 **모션 영향**이므로 저속/시뮬레이션에서. ① 디버그 세션 중 `GPL: Disconnect Controller` → GPL Traffic 에
  `1402 CLOSE (disconnect)` 뒤 **Show Thread 폴이 더 나가지 않는지**(종전에는 1 s 뒤 CONNECT 가 다시 찍혔다).
  ② 그 상태에서 **GDE 로 같은 제어기에 접속되는지**(이 항목이 이번 수정의 목적이다). ③ 알림이
  "연결 해제 — 디버그 세션도 종료했습니다"로 뜨고 상태바·트리가 offline 로 남는지(폴 성공으로 되살아나지 않는지).
  ④ launch 구성에 `stopAllOnDisconnect: true` 를 준 세션에서 해제 → **모달 확인이 먼저 뜨고**, 취소하면 세션도
  연결도 그대로인지 / 진행하면 `Stop -all` 이 나가고 정지가 확인되는지. ⑤ BP 를 여러 개(10개 이상) 건 세션에서
  해제 시 `Nobreak` 가 전부 나간 뒤 소켓이 닫히는지, 15 s 상한에 걸리면 로그에 "종료 미확인"이 남는지.
- [ ] **(2026-09-10) 디버그 콘솔에서 제어기 명령을 보내기가 불편하다 — 사용자 지적.** 실제로 겪은 것:
  ① 여러 줄을 붙여 넣어도 한 줄씩만 처리돼 진단 명령 묶음을 한 번에 못 보낸다. ② 상태 변경 명령
  (`Break`/`Stop`/`Execute`)은 `>` 접두사가 없으면 변수 평가로 흘러가 **전송 자체가 안 되는데**, 실패 메시지가
  "변수 평가 실패"라 보내진 줄 알고 시간을 버린다(`gplDebugSession.ts` 의 읽기 전용 폴백 정책 —
  정책 자체는 유지). 개선 후보: 여러 줄 입력을 순차 전송, 콘솔 명령으로 인식되는 입력에는 "`>` 를 붙이면
  전송됩니다" 대신 **보낼지 묻는 안내**, 자주 쓰는 진단 묶음(`Show Thread`/`Show Stack`/`ErrorLog`/
  `Show Network`)을 한 번에 실행하는 명령. ※ 착수 계기가 된 실측은 아래 "정지 불가 스레드" 항목 참조.
- [ ] **(2026-09-10, §1-DM) 「제어기가 죽는다」 재현 실험 — `Read()` 블록 상태를 만들어 놓고 배포.**
  **모션 없이 할 수 있다**(수신 대기만 시키므로 하드 규칙 6 부담이 낮다 — 그래도 저속/시뮬레이션 권장).
  ① 수신 루프가 도는 프로젝트를 Start 한 뒤, 상대측이 **줄 종결자 없이 몇 바이트만 보내고 끊는**(또는
  아예 보내지 않는) 상태를 만들어 `Read`/`ReadLine` 에 박히게 한다 → `Show Thread` 로 그 쓰레드가
  Running 인데 위치가 고정인지 확인. **①-b 블로킹/폭주 가르기(§1-DI 가 못 갈랐던 지점)**: 입력원을 끊는다
  (`/dev/com1` 케이블 분리 또는 상대 송신 중지) → **블로킹이면 여전히 안 움직이고, 폭주(탈출 조건 없는 루프)면
  그때 루프를 빠져나온다.** ② 그 상태에서 `Stop -all` → `-752` 가 재현되는지. ③ 이어서
  「업로드 스타트」 → **그때 제어기가 "죽는" 현상이 재현되는지**(§1-DL 에서 깨끗한 상태로는 재현 실패).
  ④ `GPL: 정지 불가 쓰레드 진단` 이 Read 줄을 1순위로 지목하고 근거 URL·`Execute <수신자>.Close()`
  후보를 내놓는지. ⑤ 그 `Execute` 로 실제로 풀리는지, 풀린 뒤 `Stop -all` → Start 가 정상인지.
  ⑥ "죽음"이 영구인지 수 분짜리 1402 접속 거부인지 시각과 함께 기록(2026-08-31 실측: 약 2.5분 뒤 자력 복귀).
  → ③이 재현되면 원인 규명이 닫힌다. 그때는 **확장이 배포 전에 이 상태를 감지해 경고**할지(진단을 STOP
  실패 후가 아니라 **정지 게이트 실패 시점**에 앞당기는 것) 결정한다.
- [ ] **(2026-09-10, §1-DI) 정지 불가 쓰레드 진단 — 실기기 확인 후 2·3겹 착수.**
  1겹(읽기 전용 진단 리포트 + 복구 후보 제시)은 구현했다. **다음에 또 막혔을 때** 확인할 것:
  ① 배포 STOP 실패 트레이스에 진단 리포트가 붙는지 ② 정지 위치의 소스를 실제로 찾아 오는지
  (라이브러리가 하위 폴더에 있는 중첩 배치 포함) ③ 뽑아낸 수신자 식이 맞는지, 후보 `Execute` 가 통하는지
  ④ 같은 이름 프로젝트가 여러 벌일 때 엉뚱한 사본의 소스를 집지 않는지.
  통과하면 **2겹**(확인 모달 → Execute → settle → Stop 을 한 번에)과 **3겹**(MCP 읽기 전용 도구
  `diagnose_stuck_thread` + AI 가이드 명문화)을 얹는다. 자동 전송은 하지 않는다는 방침은 유지 —
  대상 식별이 정적 분석이고 엉뚱한 객체를 닫으면 프로그램이 조용히 반쯤 망가진다(§1-DI).
- [ ] **(2026-09-10, §1-DE) 배포·FTP Run 실기기 확인 — Compile/Load/Unload/Start 구현이 하나로 합쳐졌다.**
  저속/시뮬레이션에서만(Start 를 보낸다 — 하드 규칙 6). ① 「빠른 컴파일」·「Deploy」가 종전과 같은 트레이스로
  끝나는지(단계 배너·CMD/RAW/NOTE 줄). ② **소스에 일부러 에러를 넣고** FTP Run 을 실행 → 종전에는 토스트 한 줄만
  나오던 컴파일 에러가 **Problems 패널에 뜨고 첫 에러로 점프**하는지(같은 이름의 로컬 프로젝트가 열려 있을 때).
  ③ FTP Run 의 Start 가 Traffic 에 `Start <name> -event` 로 나가는지(종전에는 `-event` 가 없었다) + 1403 이벤트가
  오는지. ④ 트리에서 `/GPL/<name>` 노드로 FTP Run 했는데 flash 에도 같은 이름이 있으면 로그에 경로 전환
  (`Path selected: … → …`)이 남는지. ⑤ FTP Unload 를 쓰레드 실행 중 실행 → -750 안내가 뜨는지.
- [ ] **(2026-09-10, §1-DE) 제어기 API 통합 (3) — 남은 중복 4·5·6·7.**
  §1-DE 말미의 목록 순서대로. 다음은 **`Show Thread` 열거를 `threadStop.probeThreads` 로 모으기**(저위험,
  "잘린 응답" 정책 3종을 하나로) → 중단점 명령 폴백을 `breakpointCommand.ts` 로 → busy 재시도 정책 정리
  (`commandPolicy` R2 가 이미 전송 전 최대 8초 대기라 실효 타임아웃이 곱해진다) → 스택/정지 위치 조회.
- [ ] **(2026-09-10, §1-DD) 정지 경로 실기기 확인 — 5곳이 같은 절차를 쓰게 바뀌었다(모션 유발 없음, 정지만).**
  ① 패널 「전체 정지」: 정지 확인까지 간 뒤 "전체 정지 완료"가 뜨는지, 제어기를 뽑아 두면(무응답) 완료로
  보고하지 **않고** SoftEStop 안내로 가는지. ② 트리 쓰레드 「정지」·FTP 폴더 「중지」가 같은 문구·같은 절차인지.
  ③ 디버그 세션 attach 시 `stopAllBeforeAttach: true` 구성으로 붙으면 정지 확인 로그가 남는지(종전에는 없었다).
  ④ `gpl.controller.ftpUnload` 를 **쓰레드가 도는 상태에서** 실행 → 종전의 거짓 "Unload 완료" 대신 실패 사유가
  뜨는지(-750 이면 "쓰레드를 먼저 정지하세요"). ⑤ 트리 쓰레드 「시작」이 실패할 때 오류가 뜨는지.
- [ ] **(2026-09-10, §1-DC) `gpl.debug.attachOnly` 확인 — 제어기 연결은 필요하지만 Stop/Start 는 보내지 않는다.**
  ① 빠른 컴파일 → `GPL: Start` 로 프로그램을 돌려 둔 상태에서 패널 상단 **플러그 아이콘**(또는 팔레트
  `GPL: 디버그 붙기`)을 눌러 **배포 모달·Stop 모달 없이** 세션이 붙는지, 그리고 **돌던 프로그램이 계속 도는지**.
  ② 붙은 뒤 F9 중단점이 실제로 걸리는지(`Set Break` 가 Traffic 에 나가는지) + 변수 호버가 되는지.
  ③ 로컬 소스를 고쳐 저장한 뒤 붙으면 "로컬 소스가 더 새로움" 경고가 뜨는지(Attach only 의 핵심 판정, GitHub #21).
  ④ 팔레트에서 `GPL: 디버그` 로 검색했을 때 두 명령(`디버그 시작` / `디버그 붙기`)이 모두 나오는지.
  ⑤ `GPL: AI 디버그 어시스트`의 `build-and-attach` 가 Build Only 뒤 **재배포 없이** 붙는지(§1-DC 조치 B3).
- [ ] **(2026-09-07, §1-CZ) `extension.ts` 분해 뒤 확장 실동작 스모크 — 편집기 동작만(제어기는 조회만).**
  코드 본문은 그대로 옮겼고 `tsc`·등록 명령 집합 대조·순수 모듈 테스트로 확인했지만, **Extension Development
  Host 에서 실제로 켜 본 적은 없다.** F5(`GPL-DevHost` 프로필)로 `samples/hello-project`를 열고
  ① 활성화 배너가 Output 에 찍히고 Output 채널 4개(GPL Language Support/Traffic/Console + 진단)가 보이는지
  ② F12/Shift+F12/호버가 종전처럼 동작하는지(언어 기능 배선) ③ 제어기 트리가 뜨고 `GPL: Connect`(비연결 상태라
  실패해도 됨)가 실행되는지 ④ 명령 팔레트에서 `GPL:` 명령이 종전과 같은 개수로 나오는지 ⑤ 창을 닫을 때
  deactivate 가 예외 없이 끝나는지(개발 호스트 콘솔) 확인한다. 제어기가 있으면 `Show Thread` 조회·정지 위치
  표시(노란 강조)·디버그 에러 줄(붉은 강조)까지 — 데코레이션은 `ExecutionDecorations` 로 합쳐졌다.
  **§1-DB(2026-09-07 구조 리팩터링)도 같은 스모크로 확인한다** — 파일 이동·순수 분리는 tsc·테스트 820건으로 검증했지만
  개발 호스트에서 켜 본 적은 역시 없다. 배포 후 Output 의 `[ErrorLog 분류]`/`[COMPILE 원문 로그]` 섹션과 트리의 1403 콘솔
  행(라벨·description·툴팁·가설)이 종전과 같은지 함께 본다.

- [ ] **(2026-09-07, §1-DB) 구조 정비 후속 — 저위험 정리 후보(하드웨어 무관, 각각 tsc + `npm test` 로 검증 가능).**
  ① `config.ts` 에 남은 언어 헬퍼 `getQualifiedWordAtPosition`·`isInCommentOrString`·`GPL_CONTROL_KEYWORDS` → `language/`
  (vscode 타입을 받는 부분은 접착 쪽에 남기고 순수 부분만) ② `symbolCache.ts` 를 순수 인덱스 + vscode 로더로 나눠 인덱스는
  `language/` 로 ③ 1403 상태 문구 두 표현(`controller/runtimeConsolePresentation` 알림용 영문 vs
  `views/runtimeConsoleTreePresentation` 트리용 한국어)의 폴링 판정 정규식 차이 — **실기기에서 1403 reason/detail 문구를
  캡처해 대조한 뒤** 하나로 합칠지 결정 ④ `controllerTreeProvider.ts`(1,537줄) 섹션별 노드 생성을 순수 함수로
  ⑤ ESLint 도입 여부 — 지금은 tsconfig 엄격 플래그 5종이 대신한다. 계층 규칙·허용 목록을 바꾸면
  `docs/development/architecture.md` 와 `architecture.test.ts` 를 같이 고친다.

- [ ] **(2026-09-07, §1-CY) 연결 진단에 Ethernet 카운터(DataID 430/431/432) 얹기 — 계층 분리.**
  `src/controller/resourceProbes.ts`가 지금 `Show Memory`/`Show Network -tcp|-mbuf`만 본다. 여기에
  `pd 430/431/432`(읽기 전용, 모션 무영향, `read_dataids` 1회 ≈ 1.5 s)를 같은 주기로 더하면
  "물리/링크(431·432) → 패킷(430 #3·#4) → 세션 끊김(430 #6) → 소켓 고갈(`Show Network -tcp`)"으로
  접속 문제를 계층별로 가를 수 있다. 판정 기준표는 `docs/reference/network-dataids.md` §3-1.
  **선행 확인**: `Show Network` 출력과 430이 같은 카운터의 다른 표현인지(겹치면 둘 다 넣을 이유 없음).

- [ ] **(2026-09-07, §1-CY) DataID 430 항목 매핑 확정 — 문서 12개 vs 실측 10개.**
  공식 문서는 12개(끝 2개가 포트 상태 비트마스크)를 열거하는데 GPL 4.2K5는 **10개만** 준다.
  번호↔항목 매핑은 아직 [추정]이다. 1402 접속을 의도적으로 끊었다 붙인 전후로 `pd 430`을 두 번 읽어
  #6(Connections closed/dropped)이 그만큼 증가하면 확정된다. 같은 요령으로 #6 증가율 기준선도 잡는다
  (실측 절대값 30,773 — 부팅 후 누적이라 절대값은 의미 없고 Δ/분이 신호).

- [ ] **(2026-09-03, §1-CX) GitHub Actions 의 Node 20 지원 종료 — 액션 메이저 버전 올리기.**
  `v0.9.0` 릴리스 로그의 경고: `actions/checkout@v4` · `actions/setup-node@v4` ·
  `softprops/action-gh-release@v2` 가 Node 20 을 타깃으로 하는데 러너가 **Node 24 로 강제 실행**하고 있다.
  지금은 자동 대체로 동작하지만 대체가 끝나면 릴리스 경로가 깨진다. 손볼 곳은 `ci.yml`(2) ·
  `release.yml`(3) · `docs.yml`(4 — `setup-python@v5` · `upload-pages-artifact@v3` · `deploy-pages@v4` 포함).
  Node 24 런타임을 쓰는 최신 메이저로 올리고(올릴 시점에 실제 최신 버전을 확인할 것),
  **태그를 하나 밀어 릴리스 경로 전체를 다시 밟아 확인**한다 — CI 스모크만으로는 `release.yml` 이 검증되지 않는다.

- [ ] **(2026-09-03, §1-CX) VSIX 번들링 검토 — 확장 본체를 esbuild 단일 파일로.**
  `vsce` 경고: VSIX 187 파일 중 **129 개가 JS** 라 활성화가 느려질 수 있다. `esbuild` 는 이미
  devDependency 이고 `scripts/bundle-mcp.js` 가 MCP 서버에 같은 패턴을 쓰고 있으니 확장 본체에도
  적용할 수 있다. 함께 바뀌는 것: `package.json` 의 `main`(`./out/extension.js` → 번들 산출물) ·
  `vscode:prepublish` · `.vscodeignore` · 테스트 진입점(`out/test/index.js` 는 번들과 별개로 남겨야 한다).
  **구조 개선과 같이 볼 항목** — 번들은 모듈 경계를 감추므로, 경계를 정리한 뒤에 하는 편이 낫다.
  **§1-DB 로 계층 경계가 테스트(`architecture.test.ts`)로 고정됐으므로 이제 착수 가능하다.**

- [ ] **(2026-09-02, §1-CW) 참조 찾기(Shift+F12) 편집기 실동작 확인 — 제어기 불필요.**
  `GPL_Code`를 Extension Development Host에서 열고 ① `Server.gpl:62`의 `New`에서 실행했을 때
  `Main.gpl:45`의 `New TcpServer(PORT_TEST)`가 나오는지 ② `Server.gpl:455`의
  `TcpClientSessionThreadFunc`에서 실행했을 때 `Server.gpl:448`의
  `"TcpServer.TcpClientSessionThreadFunc"`가 나오는지 ③ 각 사용부에서 거꾸로 실행해도 같은 target scope와
  결과가 나오는지 확인한다. 자동 테스트와 실파일 parser/search probe는 통과했지만 VS Code UI 호출은 미검증이다.

- [ ] **(2026-09-02, §1-CV) 이름 바꾸기(F2) 실동작 확인 — 편집기 동작만(제어기 불필요).**
  ① **모듈 레벨 변수**(`Public count As Integer`)에서 F2 → 선언 줄이 `counterublic …` 처럼 깨지지
  않고 이름만 바뀌며, **다른 파일 사용처까지** 함께 바뀌는지(종전에는 선언 줄만 깨지고 나머지는 남았다).
  ② `Property`·`Type` 이름에서 같은지. ③ **콤마 선언**(`Dim i, j As Integer`)의 `j` 에서 F2 가
  거부되지 않고 그 프로시저 안만 바뀌는지. ④ **섀도잉**: 모듈 변수와 같은 이름의 로컬이 있는 Sub 에서,
  로컬 쪽 F2 는 그 Sub 안만 / 모듈 변수 쪽 F2 는 그 Sub 를 **건너뛰고** 나머지를 바꾸는지.
  ⑤ 같은 배치에서 **F12** 가 Sub A 의 무관한 로컬이 아니라 모듈 선언으로 가는지(같은 정본을 쓴다).
  ⑥ Output 채널(`gpl.trace.verbose`)에 `[Rename] ⚠ 건너뜀` 이 찍히면 위치 계산이 아직 틀린
  곳이 있다는 뜻이니 그 줄을 기록해 둔다.

- [ ] **(2026-09-02, §1-CU) 동명 프로젝트 QuickPick 구분 확인 — 편집기 동작만(제어기 불필요).**
  과제 폴더가 둘 이상인 워크스페이스(`…/과제A/시뮬레이션/projects/GPL_Code` · `…/과제B/…/GPL_Code`)를 열고
  `GPL: Deploy` → ① 목록의 두 `GPL_Code` 가 **description 에 과제 폴더까지 표시돼** 구분되는지
  ② 이름이 겹치지 않는 프로젝트에는 그 표기가 **붙지 않는지**(잡음 방지) ③ 과제 폴더 이름을 타면
  걸러지는지(`matchOnDescription`) ④ `최근 선택`·`ProjectName=`·`라이브러리 · …에서 참조` 표기가
  종전처럼 함께 보이는지.

- [ ] **(2026-09-02, §1-CU) "컴파일 검증 필요" 배지 해제 확인 — 재현에 배포가 필요하다(Start 를 보내는
  ③은 저속/시뮬레이션 필수, 하드 규칙 6)**: ① 활성 쓰레드가 있는 상태로 autoOnSave/Deploy →
  배지가 켜지는지(종전과 같음). ② 그 상태에서 **F5(Attach 전 배포)** 로 Compile 까지 성공 → 배지가
  **사라지는지**(이번 수정의 핵심 — 종전에는 남았다). ③ MCP `deploy_project` 로도 같은지.
  ④ `GPL: Deploy` 성공 시 Output 에 `컴파일 검증 필요 상태 해제` 가 **한 번만** 찍히는지
  (직접 호출과 `onDidRecordCompiled` 구독이 겹쳐도 두 줄이 되지 않아야 한다).
  ⑤ FTP 섹션의 `ftpRun`(Load→Compile→Start) 으로도 해제되는지(그 경로는 deployService 를 거치지
  않으므로 직접 호출을 남겨 뒀다).

- [ ] **(2026-09-02, §1-CU) `Set` 접근자 접기 확인 — 편집기 동작만(제어기 불필요).** `Set (value As …)`
  절 본문에 `Set m_obj = value` 같은 대입문이 있는 Property 에서 ① 접기 화살표가 `Set (` 줄에 붙고
  `End Set` 까지 접히는지(종전에는 대입문 줄부터 접혔다) ② 대입문만 있는 프로시저에 엉뚱한 접기
  화살표가 생기지 않는지 ③ `Get` 절 접기가 그대로인지.

- [ ] **(2026-09-02, §1-CS) 장식 구분선 제거 확인 — 편집기 동작만(제어기 불필요).** 재현 위치는
  `…\시뮬레이션\projects\GPL_Code\Lib_Core\Base\StringUtils.gpl`의 `SafeTrim`. ① 호버에서 `====`
  줄과 거대한 헤딩이 사라지고 `[2] SafeTrim - None 안전 Trim` + `용도: …`가 **본문 크기 두 줄**로
  나오는지. ② `# Examples` 코드 펜스 안에 `-----`를 넣은 주석에서는 그 줄이 **그대로 남는지**(펜스 안은
  내용). ③ 배너 주석이 붙은 모듈/클래스 호버(§1-CR)에서 분량이 과하지 않은지 — 과하면
  `gpl.hover.docCommentMaxLines`로 조절 가능한지. ④ 자동완성 상세·시그니처 도움말도 같이 깨끗해졌는지
  (같은 렌더러를 쓴다). ⑤ 설명에 코드 예제를 넣은 긴 주석을 `docCommentMaxLines`를 3~4로 줄여 놓고
  호버 → 잘린 코드 블록이 **닫히고** 그 아래 `… 전체 주석: 정의로 이동` 안내가 코드가 아닌 평문으로
  보이는지(조치 2).

- [ ] **(2026-09-02, §1-CQ) 정의 찾기 중복 해소 확인 — 편집기 동작만(제어기 불필요).** 재현 위치는
  `…\37. 핵산 Oligo 합성과제\시뮬레이션\projects\GPL_Code\Main.gpl`의 `LGF.SetPath` 호출부.
  ① **먼저 원인 판별**(고치기 전 상태가 남아 있다면): peek 목록의 각 행을 클릭해 열리는 **파일 경로 3개를
  비교**한다 — 표기만 다르면 중복 인덱싱, 없는 파일이면 캐시 잔류다(§1-CQ "남은 일"). ② 새 VSIX/개발 호스트에서
  F12 → **결과가 1개**로 나오는지. ③ `gpl.trace.verbose`를 켜고 Output에 `[Duplicate Locations]` 또는
  `[Stale Locations]`가 찍히는지(찍혔다면 안전망이 실제로 걸러낸 것이고, 발생원이 아직 남아 있다는 뜻).
  ④ 후보 로그가 `file=<전체 경로>`로 나오는지. ⑤ 회귀 확인: Shift+F12(참조)·F2(이름 바꾸기) 결과의
  **경로 대소문자가 원래 표기 그대로**인지(캐시 키만 소문자이고 표시는 원본이어야 한다).
  ⑥ **①의 대안(더 쉬움 — 후속 작업)**: 명령 팔레트 `GPL: Debug Symbol Cache` → 출력 채널 맨 위의
  `⚠ 같은 이름의 파일이 여러 경로에…` / `⚠ 디스크에 없는 파일이…` 요약을 본다. 발생원이 **표기 차이**면
  전자에 `logfile.gpl (2곳)`처럼 사실상 같은 경로가 나열되고, **잔류**면 후자에 나온다. 알림 메시지에
  "확인할 항목 N건"이 뜨는지도 함께 본다. ⑦ 잔류였다면 F12·Shift+F12를 한 번 한 뒤 이 명령을 다시 실행해
  **잔류가 스스로 사라졌는지**(자가 치유). 정상 파일이 함께 지워지지는 않았는지(심볼 수 급감 여부)도 확인.

- [ ] **(2026-09-02, §1-CP) 디버깅 중 호버 확인 — 제어기 연결 필요하나 조회만(모션 무영향).**
  디버그 세션을 붙인 상태에서 `LOG.cehLog` 같은 Sub 이름 위에 호버 → **시그니처 + `Module:` + 설명 +
  `# Parameters`가 편집 때와 같이 나오는지**(종전엔 시그니처 한 줄). 변수 이름 위에서는 여전히 **값 호버**가
  우선하는지. `gpl.hover.duringDebug`를 `compact`/`off`로 바꾸면 각각 한 줄/미표시로 즉시 바뀌는지
  (설정을 매 호버마다 읽으므로 재시작 불필요).

- [ ] **(2026-09-02, §1-CO) AI 중단점 미러 실기기 확인(제어기 연결 필요 — `Set Break`/`Nobreak`·조회만, 모션 무영향)**:
  ① MCP `set_breakpoint`로 BP를 걸면 **에디터 그 줄에 빨간 점이 생기는지**(이번 수정의 핵심). Output에
  `[BP Mirror] 에디터에 중단점 추가: …`가 남는지. ② 그 상태에서 `gpl.controller.syncEditorBreakpoints`를 켜고
  `GPL: Sync Breakpoints` → **AI가 건 BP가 살아남는지**(종전에는 "에디터에 없는 잔재"로 해제됐다).
  ③ 미러로 생긴 빨간 점을 F9로 지우면 `Set Nobreak`가 나가고 제어기에서도 사라지는지(에코 차단이 제대로면
  중복 전송 없이 1회). ④ MCP `clear_breakpoint` → 빨간 점이 사라지는지. ⑤ `run_to_line`(기본값) →
  **빨간 점이 깜빡이지 않는지**, 그 줄에 원래 BP가 있었으면 **끝나고도 남아 있는지**(`breakpointKept`).
  ⑥ MCP `list_breakpoints` → 목록이 **비어 있지 않고** 파일·줄·히트수가 오는지(종전엔 빈 결과).
  ⑦ 디버그 세션(F5) 중 MCP로 BP를 걸었을 때 빨간 점이 생기고, 그 파일에 F9를 눌러도(DAP 재설정) 그 BP가
  살아 있는지. ⑧ 배포본에만 있는 파일(워크스페이스에 없는 소스)에 BP를 걸면 조용히 넘어가고 Output에
  `파일 미해석`이 남는지. ⑨ `gpl.controller.mirrorAiBreakpoints`를 끄면 종전 동작(제어기에만 설정)으로
  돌아가는지.

- [ ] **(2026-09-02, §1-CN) 중첩 구조에서 정의/참조/이름바꾸기 확인 — 제어기 불필요, 실제 워크스페이스만 있으면 된다.**
  워크스페이스를 **프로젝트 폴더가 아니라 상위**에서 연다(`…\시뮬레이션` 또는 `…\projects`, 가능하면
  과제 폴더 두 개가 함께 보이는 수준까지).
  ① `GPL_Code\Main.gpl`에서 F12(정의 이동) → **같은 과제**의 정의로 가는지. 다른 과제의 동명 파일로 튀지 않는지.
  ② `Lib_Net`/`Lib_Core`의 `Public` 루틴에서 F12·Shift+F12 → 정의는 라이브러리로, 참조는 **`GPL_Code`의 호출부까지**
  나오는지(역방향 참조자 포함이 되는지).
  ③ Shift+F12(참조 찾기) 결과에 **다른 과제 프로젝트의 파일이 섞이지 않는지**.
  ④ F2(이름 바꾸기)로 `Sub`/`Module` 이름을 바꿀 때, 미리보기(Preview)에 다른 과제 프로젝트의 파일이
  **한 건도 없는지** — 이번 수정 전에는 `"Mod.Proc"` 문자열이 워크스페이스 전체에서 바뀌었다.
  ⑤ `Trace: verbose`(`gpl.trace.server`)로 Output `GPL Language Support` 확인 —
  `[References] … project-scope fallback: origin=project dir=…\GPL_Code`가 **맞는 프로젝트**를 가리키는지,
  `⚠ 워크스페이스 탐색이 깊이/개수 상한에 걸렸습니다` 경고가 뜨는지(뜨면 워크스페이스가 너무 넓다는 신호).
  ⑥ `.gpr`를 편집(소스 추가·`ProjectLibrary` 변경)하고 저장 → 약 1초 뒤 재인덱싱 로그가 찍히고,
  새 파일의 심볼이 F12에 바로 잡히는지.
  ⑦ **회귀**: 프로젝트 폴더 자체를 워크스페이스로 연 종전 방식에서도 ①~④가 그대로 되는지.

- [ ] **(2026-08-31, §1-CM) 자동화 대상 해석 확인 — 대부분 제어기 없이 되고, 배포/실행 항목만 제어기 필요
  (Start 를 보내는 ⑤는 저속/시뮬레이션 필수, 하드 규칙 6)**:
  ① 프로젝트가 **여러 개**인 워크스페이스(예: `GPL_Code` + `MyProject`)에서 MCP `deploy_project`(대상 미지정) →
  **QuickPick 이 뜨지 않고** `{ok:false, error:"PROJECT_AMBIGUOUS", candidates:[…]}` 가 오는지. 후보 목록에
  `runnable`(ProjectStart 유무)과 라이브러리 참조가 표시되는지.
  ② MCP `project_target({project:"GPL_Code"})` → 고정된 뒤 `deploy_project`(대상 미지정)가 그 프로젝트로 나가는지.
  `project_target({})` 로 현재 대상·후보·설정 기본값이 조회되는지. `{clear:true}` 로 풀리는지.
  ③ **에디터에서 다른 프로젝트의 파일을 열어 둔 상태**로 ②를 반복 → 대상이 바뀌지 않는지(active editor 무시).
  ④ 사람이 명령 팔레트 `GPL: Deploy` 로 QuickPick 에서 `MyProject` 를 고른 뒤, MCP `project_target({})` 가
  그 선택을 세션 대상으로 반영했는지(사람이 한 번 고르면 다시 묻지 않는다).
  ⑤ `deploy_project({mode:"upload-start"})`(confirmStart 없이) → 모달이 뜨지 않고 `INTERACTIVE_UI_REQUIRED` 가
  오는지. **사용자에게 확인을 받은 뒤** `confirmStart:true` 로 재호출하면 진행되는지(저속/시뮬레이션에서).
  ⑥ 대상 폴더의 파일을 편집만 하고 저장하지 않은 상태로 `deploy_project` → `UNSAVED_FILES` + 파일 목록이
  오는지, `saveDirty:true` 면 저장 후 진행되는지.
  ⑦ 라이브러리만 있는 폴더를 `projectDir` 로 직접 지정하면 대상이 되는지(라이브러리도 직접 지정은 허용).
  ⑧ 설정 `gpl.controller.defaultProject` 에 없는 이름을 넣어도 오류가 아니라 `PROJECT_AMBIGUOUS` 로 가는지.
  ⑨ 존재하지 않는 명령(`controller_command({command:"Show Project"})`)을 **두 번** 보내면 두 번째가
  `sent:false, cached:true` 로 즉시 오는지, `Show Project -all` 은 전송되면서 `relatedUnknownCommands` 에
  `Show Project` 가 실리는지.
  ⑩ **사람용 경로 회귀**: 탐색기에서 프로젝트 폴더 우클릭 → Deploy 가 종전처럼 QuickPick 없이 되는지,
  팔레트에서 인자 없이 부르면 종전처럼 QuickPick 이 뜨는지.

- [ ] **(2026-08-31, §1-CL) 연결 판정 개선 확인 — 재현에 `Unload` 가 필요하다(모션 무영향: 로드본 제거만, 쓰레드
  실행 중이면 제어기가 `-750` 으로 거부한다)**:
  ① 쓰레드를 모두 정지한 뒤 MCP `unload_project` 로 `Unload <프로젝트>` → **타임아웃이 나면** 도구 응답이
  `ERROR (...)` 가 아니라 `{ok:false, outcome:"unknown", reason:"command-timeout", controllerHealth:"unconfirmed",
  recommendedAction:"wait-and-probe …"}` 로 오는지. ② 같은 시점 확장 Output `GPL Language Support` 에
  `[Health] 채널 복구 대기 — Unload … 가 응답 없이 끝남(timeout) … 최대 180 s` 가 찍히고, **`[Controller] 1402 명령
  채널 유실` 알림이 뜨지 않는지**(이번 수정의 핵심 — 종전에는 3초 만에 떴다). ③ GPL Traffic 에
  `--- channel: Unload … 응답 없이 끝남` 과 5 s 간격 `Show Thread` 재프로브가 보이는지(1 s 간격이 아님).
  ④ 제어기가 돌아오면 `[Health] 채널 복구 확인 — Unload … 뒤 일시적 사용 불가였음` 이 찍히고 연결이 **유지**되는지.
  ⑤ 복구가 180 s 를 넘도록(또는 `connectionRecoveryWindowMs` 를 10000 으로 낮춰) 만들면
  `recovery-window-expired …` 로 강등된 뒤 종전처럼 유실 알림이 뜨는지 — 문구가 "제어기가 다운됐다는 뜻은
  아닙니다" 로 바뀌었는지. ⑥ 그때 저장되는 사후 스냅샷(`%TEMP%/gpl-controller/postmortem-*.log`)에
  `## 직전 관측: 채널 교란 가능 명령` 절과 `assessment`/`controllerHealth` 가 들어 있는지.
  ⑦ 제어기 연결을 뽑고(케이블/전원) MCP `controller_status` → 응답에 `'제어기 소프트웨어 다운/재시작 중'`·
  `'전원 재투입'` 문구가 **없고** `controllerHealth.state` 가 `unconfirmed`/`unreachable` 로 오는지.
  ⑧ `connectionRecoveryWindowMs: 0` 으로 두면 종전 판정(교란 뒤 거부 2회 → 유실)으로 돌아가는지.

- [ ] **(2026-09-02, §1-CT) 라이브러리 소스 BP 승격 — 실기기 확인**(`.gpr` 편집이라 모션 무영향):
  `projects/GPL_Code` 를 **원래 구성**(`ProjectLibrary` 4줄 + `ProjectSource="Main.gpl"`)으로 되돌린 뒤
  `Lib_Core/LogFile/LogFile.gpl` 우클릭 → **GPL: 브레이크포인트용 소스 승격**. ① diff 미리보기에
  `− ProjectLibrary="GPL_Code\Lib_Core"` + `+ ProjectSource="Lib_Core\LogFile\LogFile.gpl"` + 나머지 하위의 개별 참조가
  뜨는지 ② 적용 → 빠른 컴파일이 **에러 없이** 통과하는지(= 컴파일 집합 보존 계산이 맞았는지 — 여기서
  "모듈 중복 정의"나 "정의되지 않은 심볼"이 나오면 계획 계산 버그다) ③ 그 파일에 F9 → BP 가 **빨간색**
  으로 verified 되고 실제로 히트하는지 ④ 되돌리기 주석대로 복원하면 원래대로 `-508` 이 되는지.
  대상이 넓은 파일(`Lib_Core/Log/Logger.gpl` — 소스 20개 승격)에서도 ②가 통과하는지 함께.
- [ ] **(2026-08-31, §1-CK) 가짜 정지 차단 + 라이브러리 BP 안내 확인(제어기 연결 필요 — `Set Break`/조회만, 모션 무영향)**:
  ① `Thread.Sleep` 루프가 도는 프로젝트에 Attach → **BP 를 걸지 않은 파일에서 디버거가 멋대로 정지하지
  않는지**(이번 수정의 핵심). Output 에 정지 로그가 줄어드는지. ② 그 파일의 실행 줄에 BP 를 걸면
  **종전처럼 즉시 걸리는지**(반응성 회귀 없음). ③ GDE/MCP 로 `Break <thread>` 를 걸면 3폴·1.5초 안쪽에
  `외부 정지 확정 …` 로그와 함께 CALL STACK 이 잡히는지. ④ Step/Continue 후 같은 BP 줄에 다시 도달했을 때
  정지가 **다시** 보고되는지(`announced` 가 재히트를 가리지 않는지). ⑤ `ProjectLibrary` 하위 소스에 F9 →
  **Traffic 에 `Set Break`가 전혀 나가지 않고** BP가 회색 + promotion 안내가 뜨는지. ⑥ 메인의 하위 source
  (`ProjectSource="App\Host\Commands.gpl"`)에 F9 → basename이 아니라 정확히
  `Set Break <메인> "App\Host\Commands.gpl"<line>`가 한 번 나가는지. ⑦ `Show Break`가 실제 procedure 이름과
  `procLine > 0`을 돌려줄 때만 verified가 되는지(`? / 0` record와 `-775`는 성공으로 보이면 안 됨).
- [ ] **(2026-08-31, §1-CJ) 중단점 어긋남 복구 확인(제어기 연결 필요 — `Set Break`/`Nobreak`만, 모션 무영향)**:
  ① 동기화가 꺼진 상태에서 GPL 파일에 F9 → **경고 알림 3버튼**이 뜨는지, [실시간 동기화 켜기]가 설정을 켜고
  곧바로 수렴까지 하는지. ② 트리 중단점 섹션에서 에디터에 없는 항목에 `⚠ 에디터에 없음`과
  섹션 요약 `⚠ N 에디터에 없음`이 보이는지 + 우클릭 「제어기에서 이 중단점 해제」가 되는지.
  ③ `GPL: Sync Breakpoints` 실행 → `Show Break`가 에디터의 빨간 점과 정확히 일치하는지(Traffic으로
  `Set Nobreak …`/`Set Break …` 확인). ④ 동기화를 켠 상태에서 **다른 창/MCP로 걸어 둔 BP를 F9로 지웠을 때**
  폴백 `Nobreak`가 나가고 실제로 사라지는지(이번 수정의 핵심). ⑤ 다른 프로젝트가 로드된 상태에서
  수렴이 **그 프로젝트 BP를 건드리지 않는지**(`untouched` 카운트). ⑥ 제어기를 뽑고 F9 → 알림·전송이
  없는지(미연결이면 조용히 지나가야 한다).
- [ ] **(2026-08-31 §1-CD, 2026-09-10 §1-DL 갱신) 「업로드 스타트」 실기기 검증 — Start를 보내므로 저속/시뮬레이션 필수(하드 규칙 6)**:
  ⓪ **끝났다(§1-DL)** — "제어기가 응답을 잃는다"는 현상은 안전장치를 전부 끈 조합에서도 재현되지 않아
  가설 ㉠·㉡을 기각했고, 순차화와 TEST 경로를 철회해 **다시 병행(`[1/3] UPLOAD ∥ STOP (동시 진행)`)**이다.
  남은 확인은 아래 ①~⑦(병행 기준). 재현되는 일이 다시 생기면 그때는 시퀀스가 아니라 **그때의 쓰레드 상태**
  (정지에 응답하지 않는 쓰레드 유무 — §1-DI 진단)를 먼저 남긴다.
  ① 패널 상단 세 번째 버튼(로켓)이 `GPL: 업로드 스타트`로 보이고, `Start(실행만)`은 `···` 메뉴에 있는지.
  ② 정상 소스로 실행 → `[2/3] PREPARE (Compile 생략 …)` → `[3/3] START`가 찍히고
  **`Compile <name>` 명령이 Traffic에 단 한 번도 나가지 않는지**(§1-CD 변경의 핵심).
  ③ Start 확인 모달이 뜨는지(`gpl.controller.requireStartConfirmation` 기본 true) + **Start 직전 정지 재확인**
  (`Show Thread` 한 번 더)이 트레이스에 남고, 쓰레드가 남아 있으면 `Start`가 나가지 않는지(§1-DC 조치 A2).
  ④ **소스에 일부러 에러를 넣고** 실행 → Start의 STATUS 코드와 소요 시간(암묵 컴파일 시간)을 기록하고,
  트리/상태바에 "컴파일 검증 필요"가 뜨는지 + 클릭 시 빠른 컴파일로 에러 위치가 Problems에 오는지.
  ⑤ 성공 후 Attach only 디버깅에서 "로컬 소스가 더 새로움" 헛경고가 **뜨지 않는지**(스냅샷 기록 시점 이동 확인).
  ⑥ 소요 시간을 `Deploy`(Compile 포함) 대비 기록 — 컴파일 중복 제거 효과 수치화.
  ⑦ 클래식 폴백(=`/GPL/<name>` 없음)에서도 Unload/Load 뒤 Start가 성공하는지.
- [ ] **(2026-08-31, §1-CI) 클래스 개요 호버 + 체인 멤버 완성 확인(편집기 동작만 — 제어기 불필요)**:
  ① GPL 소스에서 `Move`·`Robot`·`Location`·`Modbus`·`StreamWriter` 같은 **클래스 이름 위** 호버 →
  요약·생성자 구문·멤버 목록·Reference 링크가 나오는지. ② 같은 이름의 사용자 심볼이 있으면
  종전처럼 **사용자 심볼이 우선**하는지(`hoverProvider`의 `!sym` 조건). ③ `gpl.hover.builtinDetails`를
  끄면 `details`(표)가 빠지고 요약만 나오는지. ④ `Latch.Result(1).` / `Robot.Where.` / `vision.Result(0).`
  뒤에서 **멤버 자동완성 후보**가 뜨는지 — 이번에 채운 `returnType`이 실제로 수신자 해석에 쓰이는지 확인.
  ⑤ 프로시저 안에서 `Thr`·`Cal`·`Go`를 입력해 `Throw …`·`Call …`·`GoTo …` 스니펫이 제안되는지, 삽입 결과가
  올바른 GPL인지. ⑥ `Controller.ShowDialog` 위 호버에 3가지 형태(`usage`)와 mode 표가 나오는지.
- [ ] **(2026-08-31, §1-CH) Private 전역 편집 차단 확인(편집기 동작 — 제어기는 조회만)**:
  ① 정지 상태에서 Variables의 `GLOBALS`에서 **Private 모듈 전역**(예: `DBG.m_enabled`) 행에 편집(연필) 제스처가
  **뜨지 않는지** — VS Code가 DAP `presentationHint.attributes: ['readOnly']`를 존중하는지 확인하는 것이 핵심.
  존중하지 않으면 그때는 값 문자열에 표시를 덧붙이는 쪽으로 바꾼다. ② Public 모듈 전역은 종전대로 편집되는지.
  ③ 굳이 편집이 나갔을 때(또는 Watch/Debug Console에서 대입했을 때) 오류 문구가 STATUS 숫자만이 아니라
  "Private 모듈 전역이라 …" 설명으로 나오는지. ④ bare 표기로만 읽히는 전역이 있으면 편집이 성공하는지
  (조회 성공 표기 우선 사용 — §1-CH ①).
- [ ] **(2026-08-31, §1-CG) 내장 클래스 멤버 호버 확인(제어기 연결 필요, 조회만 — 모션 무영향)**:
  ① 정지 상태에서 `Thread.CurrentThread.Name`의 **`Name` 위** 호버 → 값(`"GPL_Code"  (String)`)이 뜨는지
  (종전에는 `Function Name() As String` 언어 호버만 떴다). ② `Thread.CurrentThread` 위는 종전처럼 객체 덤프가
  뜨는지. ③ 괄호형 `Thread.CurrentThread().Name`에서도 값이 뜨는지. ④ 디버그 세션이 **아닐 때** `Name` 위
  호버가 GPL Dictionary `Thread.Name` 카드로 바뀌었는지(남의 클래스 시그니처가 아닌지). ⑤ `Thread.Sleep(…)`의
  `Sleep`·`t.Abort()`의 `Abort` 위 호버에서 Traffic에 `Show Variable -eval` 명령이 **나가지 않는지**(부작용 차단).
- [ ] **(2026-08-31, §1-CF) 디버그 값 색 + 예약어 호버 차단 확인(제어기 연결 필요, 모션 무영향 — 조회만)**:
  ① 정지 상태에서 `String`/`Integer`/`Boolean` 변수에 호버 → 값이 **흐린 회색이 아니라** 테마의
  문자열/숫자/불리언 색(dark 기본: 연어색/연녹색/파란색)으로 보이는지. Variables·Watch 패널도 같은지.
  ② 아직 흐리게 보이면 그 값의 타입 칸이 무엇이었는지(객체/배열/타입 없음) 확인 — 원시 타입만 색상화 대상이다.
  ③ `If`/`Then`/`End`/`As`/`Dim`/타입명(`String`) 위에 호버 → **아무 팝업도 뜨지 않는지**(종전 -712 오류 안내).
  ④ 같은 줄의 실제 변수(`context`)에는 값 팝업이 그대로 뜨는지 + Traffic에 `Show Variable -eval … Then`이
  **나가지 않는지**(예약어 차단이 문서 파싱보다 앞이므로 명령 자체가 없어야 한다).
- [ ] **(2026-08-31, §1-CB) 문 스니펫·키워드 완성 — 편집기 동작 확인(제어기 무관, 모션 무영향)**: ① `samples/hello-project/Main.gpl`의 `Main` 프로시저 안에서 `tr` 입력 → `Try … Catch … End Try`가 제안되고 삽입 뒤 **들여쓰기가 2배가 되지 않는지**(에디터가 탭/스페이스 어느 설정이든), Tab으로 `ex` 자리로 이동하는지. ② `for` → `For … Next`를 넣고 `${1}` 자리에 이름을 치면 **`Next`의 변수명도 함께 바뀌는지**(미러링). ③ 프로시저 **밖**(Module 본문)에서 `if` → If 스니펫이 뜨지 않고 `Sub`/`Dim`이 뜨는지, 반대로 프로시저 **안**에서 `Sub`가 뜨지 않는지. ④ `For` 루프 안에서만 `Exit For`가, `If` 안에서만 `Else`가, `Select` 안에서만 `Case`가 뜨는지. ⑤ `x = ` 뒤나 `Clamp(` 인자 자리에서 블록 스니펫이 **끼어들지 않는지**. ⑥ 완성 목록 순서가 로컬 변수 → 문 스니펫 → 키워드 → 내장 함수 순으로 보이는지(소음이 심하면 `sortText` 접두사 조정). ⑦ Class 안에서 `Property` 스니펫 → `Set (value As Integer)` 괄호 절이 들어가는지. ⑧ `While … End While` 블록에 **접기 화살표가 생기는지**(이번 folding 수정). ⑨ 큰 파일(수천 줄)에서 타이핑 지연이 체감되지 않는지(블록 분석은 줄 단위 캐시).
- [ ] **(2026-08-31, §1-CA) 정의찾기 한정자 폴백 차단 — 편집기 동작 확인(제어기 무관, 모션 무영향)**: ① **원인 확정**: 신고된 `시뮬레이션\projects\MyProject\Main.gpl:23`의 **줄 원문**을 받아 `gpl.trace.server: verbose` + Output `GPL Language Support`에서 `[Definition Request] … Word: "Run"` 뒤에 찍히는 태그를 확인한다 — `[Builtin Receiver]`/`[Member NOT Found] … 전역 폴백 차단`이면 이번 수정으로 해결, `[Fallback Search]`가 그대로 나오면 **점 없는 맨 호출**(`Call Run(0)`)이라 다른 문제다(이 경우 GPL이 한정자 없는 크로스 모듈 호출을 허용하는지부터 확인). ② `Move.Loc` 같은 내장 멤버에서 F12 → 아무 데도 가지 않는지(종전에는 동명 사용자 심볼로 점프). ③ `모듈.클래스`·중첩 클래스 `바깥.안쪽`·모듈 수준 Property F12가 **여전히 되는지**(폴백 차단으로 잃지 않았는지 — 이번 회귀 위험 1순위). ④ 파일을 새로 복사해 와 캐시가 낡은 상태에서 `인스턴스.멤버` F12가 종전처럼 찾아지는지(stale 안전망 유지 확인).
- [ ] **(2026-08-31, §1-BY) FTP 폴더 비우기 — 실기기 검증(파일 삭제만, 모션 무영향이지만 되돌릴 수 없음)**: ① 쓰레드가 도는 상태에서 `/GPL` 섹션의 휴지통 버튼 → 정지 게이트 모달이 뜨는지, 취소하면 **아무것도 지워지지 않는지**. ② 승인 시 `Stop -all` → 정지 확인을 거친 뒤에만 삭제가 시작되는지. ③ 삭제 후 트리 `/GPL`이 비고, 이어서 Deploy가 최초 업로드 경로(FTP 폴더 생성)로 정상 동작하는지 — 지문(manifest)이 남아 파일이 스킵되지 않는지(`forgetSyncManifest` 확인). ④ `/GPL/<프로젝트>`를 지운 뒤 제어기 로드본 상태(`Show Thread`·`Compile <name>`·`Load`)가 어떻게 되는지 기록 → 모달 안내 문구(Unload 병행 여부) 확정. ⑤ 항목이 많을 때 소요 시간과 부분 실패 표시(`failed[]`) 동작.
- [ ] **(2026-08-31, §1-BX) 중첩 프로젝트(`ProjectLibrary`) — 편집기 동작 검증**: 대상은 `projects/MyProject`(라이브러리 `MyProject/MyLibrary`). **제어기 쪽 ①③⑥은 §1-CK 에서 실측으로 해소됐다** — 라이브러리는 `/GPL/<메인>/<라이브러리>` 에 그대로 올라가 그 자리에서 컴파일·실행되므로 배포 범위를 넓힐 필요가 없고, `ProjectLibrary` 는 줄 반복으로 여러 개 쓰며, 라이브러리 소스에는 **어떤 파일 표기로도 `Set Break` 가 되지 않는다**(`-508`, 12종 확인). 남은 항목은 편집기 동작뿐이다. ① `.gpr` 우클릭 → 소스 목록 동기화: `MyLibrary\Project.gpl` 이 **추가 후보로 뜨지 않고**, 출력 채널에 `중첩 프로젝트는 동기화 대상에서 제외: MyLibrary` 가 남는지 · `autoSyncSources: auto` 에서도 조용히 추가되지 않는지. ② 라이브러리의 `Public Sub T1` 에서 Shift+F12 → **메인 `Main.gpl` 의 호출부**가 나오는지(역방향 — §1-BX 수정의 핵심) · 반대 방향도 나오는지 · F12/F2 도 양방향인지. ③ 프로젝트 QuickPick(다중 후보)에서 `MyLibrary` 가 `$(library)` 아이콘 + `라이브러리 · MyProject에서 참조` 로 표시되는지. ④ 라이브러리 소스에서 정지했을 때 **올바른 파일이 열리는지**(소스 매핑은 BP 와 별개로 동작한다).
- [ ] **(2026-08-28, §1-BW) 프로젝트 하위 폴더(중첩 소스) — 검증**: **①은 제어기 확인(업로드·컴파일만, 모션 무영향), ②~⑥은 편집기 동작**. ① `TEST_GPL`(`Main.gpl` + `T1\T1.gpl` + `T1\T2\T2.gpl`)로 Deploy → FTP trace에 `T1/T2/T2.gpl`이 원격 같은 구조로 올라가는지, `Compile TEST_GPL`의 `<STATUS>`가 0인지(= 제어기가 상대 경로 항목을 연다) — 실패하면 어떤 STATUS·문구인지 기록. ② 하위 폴더 소스에 BP → 파일명 표기로 성공하는지, 실패 시 로그에 `파일 표기 … 거부 → 다른 표기로 재시도` 뒤 `프로젝트 기준 상대 경로로 받습니다`가 뜨는지(어느 쪽이 참인지 §1-BW에 확정 기록) · 정지 시 **올바른 파일**이 열리는지. ③ `T1\T2\T2.gpl`의 Sub에서 Shift+F12 → 루트 `Main.gpl`의 호출부가 나오는지, 반대 방향(루트에서 하위 폴더 참조)도 나오는지 · `gpl.trace: verbose`의 `[References] … origin=project (files=N)` 확인. ④ F12/자동완성/이름 바꾸기(F2)가 중첩 파일 간에 동작하는지. ⑤ `.gpr` 우클릭 → 소스 목록 동기화: 하위 폴더 항목이 **제거 후보로 뜨지 않고**, 새로 만든 `T1\T2\T3\New.gpl`이 `추가`로 뜨며 기록 구분자가 `\`인지 · `autoSyncSources: auto`에서 하위 폴더 생성/삭제에 반응하는지 · GDE에서 그 `Project.gpr`가 정상 열리는지. ⑥ 같은 basename을 서로 다른 하위 폴더에 둔 경우(`T1\A.gpl`, `T1\T2\A.gpl`) 디버그 정지 시 `.gpr` 목록에 있는 쪽이 열리는지.
- [ ] **(2026-08-28, §1-BV) 업로드 지문(SHA-1) 스킵 판정 — 실기기 검증(업로드만, 모션 무영향)**: ① `.gpl`을 **같은 길이로** 고치고(예: 상수 `10`→`20`) 빠른 컴파일 → trace에 그 파일이 `↑ [n/N]`로 전송되는지(종전이라면 스킵됐을 파일). ② 아무것도 고치지 않고 다시 실행 → 그 파일이 skipped로 빠지는지(스킵 자체는 살아 있어야 한다 — 매번 전량 업로드가 되면 지문이 저장되지 않는 것). ③ 확장 설치 직후 첫 실행에서 `(첫 동기화 — 지문 기록 없음, 전체 업로드)`가 한 번만 뜨고 다음 회차부터 정상 스킵되는지. ④ 제어기 FTP 목록이 mtime을 주는지(주면 다른 PC/GDE가 바꾼 원격 파일까지 감지된다 — 트리의 FTP 항목에 시각이 보이는지로 대략 확인). ⑤ flash 저장(Save to Flash)도 같은 규칙으로 동작하는지.
- [ ] **(2026-08-28, §1-BU) 공식 문서 기준 디버깅 조작 — 실기기 검증**: ① **Jump to Cursor**(모션 영향 — 저속/시뮬레이션 필수): 정지 상태에서 같은 프로시저 안 줄 우클릭 → '커서까지 이동' → 경고 모달 → `Set Thread <스레드> -line <줄>` STATUS 0 · 새 위치로 화살표 이동 · 다른 프로시저/주석 줄에는 메뉴가 나오지 않는지 · `gpl.debug.jumpToCursor: "on"`에서 모달 생략 / `"off"`에서 메뉴 없음 ② **Step Into Target**: 한 줄에 호출 2개 이상인 지점에서 우클릭 → 대상 선택 → 임시 BP + `Continue` 후 그 프로시저에서 정지 · 정지 뒤 `Show Break`에 임시 BP가 남지 않는지 · 정의를 못 찾는 호출은 목록에 없는지 ③ **프로시저 이름 BP**: BREAKPOINTS 뷰에 `Class.Proc` 입력 → 첫 실행 줄에 설정 · 같은 파일 소스 BP 갱신 시 사라지지 않는지 ④ **BP 줄 보정**: 빈 줄/주석에 BP → 다음 실행 줄로 옮겨 표시되고 메시지가 이유를 설명하는지 · 33개째 BP에서 상한 경고 로그 ⑤ **조건부 BP**(`clientSideBreakpointLogic` 켠 뒤, 자동 Continue 발생 — 저속/시뮬레이션): 조건 불일치 시 자동 재개 로그 1회 + 히트 조건 `>3` 동작 + 로그포인트 `{식}` 치환 출력 · 조건 평가 실패 시 정지를 유지하는지 ⑥ **Start `-event`**: GPL Traffic에 `Start <프로젝트> -event`가 나가고 1403 수신량·상태 이벤트가 종전보다 늘어나는지(`startEventMode` 끄면 `-noevent`) · `startStackSizeKb`/`startTrace` 반영 ⑦ **Set Nobreak 폴백**: 로그에 `문서 표기로 재시도`가 뜨는지(뜨면 이 제어기는 공백 형식을 요구 — 조사 문서 §1 갱신) ⑧ **쓰레드 존재 = 동작 중**: `Execute` 로 `_Cmd_<프로젝트>` 쓰레드를 만든 상태에서 빠른 컴파일 → 진행하지 않고 확인/보류하는지 · `Idle` 상태 쓰레드만 남았을 때도 같은 판정인지 ⑨ **MCP**: `read_dataids({ids:[2003], hex:true})` → `pdx` 응답 · `node` 인자 지정 시 응답 형식.
- [ ] **(2026-08-28, §1-BT) 문서화 주석 — 편집기 동작 확인(제어기 무관, 모션 무영향)**: ① `samples/hello-project/Main.gpl`의 `Clamp` 이름 위 호버 → 설명 + Parameters 목록 + Returns + ```gpl 예제 블록이 보이는지(기본 `gpl.hover.docComment=summary`, `docCommentMaxLines=6`에서도 매개변수가 안 잘리는지) ② `Clamp(` 입력 시 시그니처 도움말에서 **활성 매개변수의 설명만** 뜨는지 ③ 선언 바로 위에서 `'''` 입력 → 골격 스니펫이 제안되고 삽입 뒤 **들여쓰기가 2배가 되지 않는지**, Tab으로 칸 이동이 되는지 ④ 선언 줄 전구 → `문서화 주석 생성`, 이미 주석이 있는 선언에서는 `보완`이 뜨고 매개변수를 하나 추가한 뒤 실행하면 **빠진 항목만** 추가되는지(기존 설명 보존, CRLF 유지) ⑤ 머리글 없는 옛 주석이 종전과 똑같이 보이는지 ⑥ `gpl.docComment.includeExamples=true`에서 `# Examples` 골격과 호출 예시가 함께 생성되는지.
- [ ] **(2026-09-02, §1-CR) 문서화 주석 — `Module`·`Class`·변수·상수 표시 확인(제어기 무관, 모션 무영향)**: ① `Module`·`Class` 이름 위 호버 → 설명이 `---` 아래에 보이는지 ② 모듈/클래스 멤버 변수·상수, 프로시저 속 지역 `Dim`/`Const` 호버도 같은지 ③ 자동완성 목록에서 그 항목을 고를 때 오른쪽 상자에 설명이 나오는지(설명 앞 빈 줄 없이) ④ 모듈 파일 머리의 배너 주석이 모듈 호버에 어떻게 보이는지(장식 구분선은 걸러지는지) ⑤ 변수 위 주석이 다음 선언으로 새지 않는지(빈 줄 차단 유지).
- [ ] **(2026-09-02, §1-CR 후속) 모듈 멤버 자동완성 · 호버 범위 표시(제어기 무관, 모션 무영향)**:
  ① `모듈이름.`을 찍으면 그 모듈 안 **클래스가 목록에 나오는지**(종전 누락), 중첩 클래스는 안 나오는지
  ② `클래스이름.`에는 멤버 + 중첩 클래스가 나오고 **자기 자신은 안 나오는지**
  ③ 클래스/모듈 이름 호버에 `Class: 자기이름`·`Module: 자기이름`이 더는 안 붙는지
  ④ 중첩 클래스 호버의 범위가 **바깥 클래스**로 나오는지 ⑤ 프로시저·멤버 호버의 범위 줄은 종전과 같은지
  ⑥ `Module.Class.멤버` 정의 이동(F12)·호버가 종전대로 동작하는지(`membersNamed` 재작성 영향 확인).
- [ ] **(2026-08-28, §1-BS) 스레드 단일 실행 잠금 + ContinuedEvent 수정 — 실기기 검증(읽기·UI 위주, 새로 재개되는 스레드 없음)**: ① 2개 이상 스레드를 각각 BP로 정지 → CALL STACK에서 A 우클릭 `GPL: 스레드 실행 잠금` → 라벨에 🔒, 상태바 `$(lock) 스레드 잠금: A` ② B가 BP에 걸려도 포커스가 A에 남는지(preserveFocusHint), 그 상태에서 F10/F5가 **A에만** 나가는지(GPL Traffic의 `Step A …`/`Continue A`) + Debug Console에 잠금 되돌림 로그가 첫 건만 남는지 ③ 외부(GDE 또는 MCP `continue_thread`)로 A만 재개 → **B의 CALL STACK·변수·정지 배지가 유지**되는지(ContinuedEvent `allThreadsContinued=false` 수정 효과 — 종전에는 사라졌다) ④ 잠금 중 F6으로 B를 Pause → 요청한 B가 멈추는지(잠금 미적용이 의도) ⑤ 잠근 스레드를 CALL STACK 우클릭 '스레드 종료' → 상태바·라벨 잠금이 즉시 사라지는지, Shift+F5 후에도 남지 않는지 ⑥ 상태바 자물쇠 클릭 = 해제, 명령 팔레트 `GPL: 스레드 실행 잠금 토글`이 디버그 중에만 보이는지.
- [ ] **(2026-08-28, §1-BS) 조사 문서 실기기 검증 대기 목록** — `docs/development/pa-controller-debug-operations.md` §8: `Step … -out` 실동작(캡처 근거 없음), `Set Nobreak`의 no-space 형식, `Start … -event` 유/무에 따른 1403 수신량, `help` 명령 존재 여부(= 펌웨어 실제 지원 명령 목록을 얻는 최선의 수단), `Pdx`·`Pd … <node>`·`ErrorLog <thread>`/`-servo`·`Show StartupLog` 응답 형식, `Show Break` procLine(4열)을 우리 파서가 쓰지 않는지, `Execute`가 만드는 `_Cmd_<project>` 스레드를 settle 판정이 사용자 스레드로 오인하지 않는지. 모두 읽기 전용이거나 저속 검증 가능 — `pc` 쓰기와 `Show Memory -verify`는 검증 대상에서 제외(위험).
- [ ] **(2026-08-28, §1-BQ) Agent Bridge(MCP↔확장) — 실기기/실환경 검증**: ① VS Code에서 확장 활성화 후 MCP `extension_status` → `transport.using = extension-bridge`, 확장 버전/pid/connected 일치 ② `show_threads` 실행 → GPL Traffic에 `>>> Show Thread  -web`이 **확장 채널로** 찍히고 MCP 세션 로그에 `via extension` ③ VS Code를 닫고 같은 도구 → `direct-tcp`로 자동 폴백, 힌트가 '확장이 실행 중이 아니다'로 나오는지(점유 결론이 안 나오는지) ④ `extension_status(wake:true)`가 VS Code를 깨우는지(`code` CLI 없는 환경에서는 wakeError) ⑤ `extension_command('gpl.quickCompile', …, timeoutMs:180000)`로 확장 Deploy/Quick Compile이 MCP에서 실행되고 결과가 오는지 ⑥ 정지 전 Step 연타를 MCP로 시도 → `policy-hold`가 그대로 전달되고 **직접 접속으로 우회하지 않는지** ⑦ 브리지 처리 중 확장을 종료 → 모호한 실패에서 상태 변경 명령이 재전송되지 않는지 ⑧ `GPL_BRIDGE=only`에서 확장 없을 때 명확히 거부하는지 ⑨ `%TEMP%\gpl-controller\bridge\`에 요청/응답 파일이 남지 않는지(정상 처리 후 0개).
- [ ] **(2026-08-28, §1-BP) F5 개발 호스트 전용 프로필 — 사용자 확인(코드 무관, 제어기 무영향)**: ① F5 "Run Extension" → 새 창이 `samples/hello-project`를 열고, 창 위치·사이드바가 **기본 상태**인지 ② Extensions 뷰에 우리 확장만(개발 모드) 보이고 평소 확장이 없는지 ③ 평소 창에서 저장소 폴더를 다시 열었을 때 프로필이 바뀌지 않았는지(폴더 분리가 의도대로 동작하는지) ④ 테마를 GPL-DevHost 프로필에 설치·선택한 뒤 F5를 다시 눌러 유지되는지.
- [ ] **(2026-08-28, §1-BQ) 프로젝트명 공백 가드 — 실기기 확인(읽기 전용 위주, 모션 무영향)**: ① 테스트용 폴더 `My project`(Project.gpr ProjectName도 `My project`)를 워크스페이스에 두고 열기 → 활성화 직후 `GPL 프로젝트명 경고 — …` 1회(세션 중 재감지에 재경고 없음) ② 그 프로젝트로 Deploy/Quick Compile → FTP 업로드·1402 명령 없이(GPL Traffic 확인) `UPLOAD 단계 실패 … Validate project name` 안내 ③ `GPL: Start`·F5 attach → `Start 중단`/`디버그 시작 중단 — …`(제어기 미전송) ④ MCP `compile_project({project:'My project'})` → `ERROR (compile_project): 프로젝트명 …` ⑤ **문서상 사실 확정**: GPL Traffic 콘솔(raw)로 `Compile My project` 1회 → 실제 STATUS 코드·문구를 §1-BQ에 기록(존재하지 않는 프로젝트라 무해) ⑥ 정상 이름 프로젝트의 모든 경로가 종전과 같은지(경고·차단 0건).
- [ ] **(2026-08-28, §1-BN) URI 전체 개방·명령 정책 — 실기기 검증(저속/시뮬레이션, Step·Start 포함이므로 하드 규칙 6)**: ① `code --open-url "vscode://nir414.gpl-language-support/gpl.ai.debug.getState"` → Output `[URI] gpl.ai.debug.getState => {…}`; `/gpl.controller.threadBreak?threadName=MainThread` → 일시정지; `/command?id=gpl.controller.showTraffic`; `gpl.*` 밖 id → 경고만 ② **R1**: 정지 쓰레드에 `gpl.ai.debug.stepThread({threadName, waitForPause:false})`를 연속 3회 → Traffic에 `Step`이 정지 관측 뒤에만 나가고 `--- policy: R1 step … 정지 확인 대기/확인` 줄; 긴 모션 줄 Step 뒤 8 s 안에 정지 안 되면 `{ ok:false, error:'policy-hold', code:'resume-pending' }`(제어기 미전송 확인) ③ **R2**: `Stop -all` 직후 `gpl.start` → Traffic에 `Show Thread -web` 재조회 뒤 Stopping 사라진 다음 `Start`; deploy()/ftpRun/F5 소요 증가량 기록 ④ **R3**: Quick Compile 직후 Start → `--- policy: R3 … 완충` 뒤 전송(1.5 s) ⑤ 디버그 세션 F10 연타 → 어댑터 `Step/Continue 요청 무시`가 먼저 걸리고 policy R1 개입은 0~1회 ⑥ `commandPolicyEnabled: false`로 종전 동작 복귀 확인.
- [ ] **(2026-08-28, §1-BM) 1402 유휴 ping·1403 UTF-8 — 실기기 검증(읽기 전용, 모션 무영향)**: **①② 완료(2026-08-28 사용자 실사용 관측, 0.8.20 — 1403 연결이 해제되지 않고 유지됨; Traffic 원문 대조·30분 계측은 미실시)** ③ 대조 실험: `keepAliveIdlePingMs: 0`으로 되돌려 같은 30분 → `1402 CLOSE (idle 30s)` 직후 수 초 안에 `[1403] CLOSE`가 따라오는지(1402↔1403 결부 가설 확정/기각) ④ 제어기 전원 차단 시 유휴 상태에서도 `[Health] 연결 의심 — probe`가 ≤ 5 s + 8 s에 뜨는지(ping 프로브 보고) ⑤ GPL 프로그램에서 `Console.WriteLine("한글 테스트 가나다")` → GPL Console `[RT]` 줄이 온전, 130바이트 이상 한글 섞인 줄도 온전, 상태 로그에 `WARN=L_MISMATCH` 0건 ⑥ 포트 필터 없이 제어기 IP 전체를 pktmon 5분(GDE 접속·Stop/Start 포함) → 1404 사용 여부, `<E>1,N</E>` vs `Show Thread -web` 스레드 수, 1403 FIN과 1402 명령의 시간 관계.
- [ ] **(2026-08-28, §1-BK) 연결 끊김 감지 — 실기기 검증(읽기 전용, 모션 무영향)**: ① 연결 후 케이블 분리(또는 제어기 전원 차단) → Output `[Health] 연결 의심 — …`(출처 runtime-console / keep-alive-socket / probe 중 무엇이 먼저였는지) 뒤 GPL Traffic에 `Show Thread -web`이 ≈ 1 s 간격·8 s 타임아웃으로 3회 → `[Controller] Connection lost — … 3회 연속 실패` + 상태바 offline + 알림이 **30 s 이내**인지(타임스탬프 기록, §1-BK 표 확정) ② 제어기 재부팅 → REFUSED 2회로 수 초 내 유실 ③ 디버그 세션(BP 정지·Running 각각) 중 ①을 재현 → Debug Console `Show Thread 실패 1/3…`과 확장 유실 판정이 같은 시점, 세션 종료 후 상태바 offline ④ 정상 운용 30분간 `[Health] 연결 의심` 오탐 0건(1403 빈 세션·Immediate EOF·keep-alive `CLOSE (by peer)`는 힌트가 아님을 확인) ⑤ 수 초 끊김 뒤 복구 → `[Health] 연결 복구 — N회 실패 뒤 …` 로그와 연결 상태 유지 ⑥ `gpl.ai.debug.getConnectionState.health` 값 ⑦ 사후 스냅샷 파일에 `## 유실 판정` 절.
- [ ] **(2026-08-27, §1-BJ) 이슈 #32 — 실기기 검증(읽기 전용, 모션 무영향)**: ① `RNDRobot.org()` 프레임에서 `robotArmList(0).controlAxis` hover → `4 (Integer) ← m_controlAxis (Get 반환식)`; 정적 hover(비디버그 또는 디버그 hover 닫힌 뒤)가 `Property controlAxis As Integer`(RobotArm) 표시, Output `[Hover Receiver] robotArmList(0).controlAxis: class RobotArm → property controlAxis` ② 같은 프레임에서 `RNDRobot.controlAxis("T")`의 `controlAxis` hover는 여전히 차단(규칙 1) ③ 동명 Property가 두 클래스에 있는 식이 있으면 Debug Console `프로퍼티 후보 클래스 한정(#32)` 로그 확인 ④ **규칙 1 근거 실측(시뮬레이션·무해한 Sub만)**: 파라미터 없고 모션 없는 Sub 이름 단독 `Show Variable -eval <thread> <frame> <SubName>` → -780(실행 안 됨)인지 — 실행되면 §1-BJ 사실 정리 수정 ⑤ 괄호 없는 중간 세그먼트(`obj.GetArm.count`)를 -eval이 호출로 실행하는지(실행되면 게이트에 중간 세그먼트 callable 검사 추가).
- [ ] **(2026-08-26, §1-BI) 이슈 일괄 처리분 — 실기기 검증(통신 패턴·읽기 전용·UI, 모션 무영향)**: ① **1402 keep-alive**: 연결 후 GPL Traffic에 `--- 1402 CONNECT #1 (keep-alive)` 1회 뒤 `Show Thread` 폴링이 CONNECT 없이 이어지는지(제어기가 응답 뒤 끊으면 매번 `CLOSE (by peer, held 0s)`+CONNECT → 기본값 false 되돌릴지 결정) / GDE·MCP 동시 접속 시 세션 수 제한 유무 / 30 s idle 뒤 `CLOSE (idle 30s)` vs `by peer`(제어기 유휴 타임아웃이 짧으면 `keepAliveIdleCloseMs` 축소) / `Show Network -tcp` accepted/s가 종전 1~3/s에서 ≈0으로 / stale-retry가 Continue·Step 같은 상태 변경 명령에서 발생한 사례 감시(있으면 read-only로 재시도 제한) ② **Step 게이트**: F12 홀드 시 Traffic에 Step이 30 ms 간격으로 나가지 않고 Debug Console에 `Step/Continue 요청 무시` 1회 + 요약; 정지 뒤 다음 Step 정상; 다른 스레드 Step은 허용 ③ **백업 폴**: Running 중 1403 정상이면 `Show Thread -web` 간격 5 s(Traffic), 1403 중지 시 1 s로 복귀, Debug Console `백업 폴:` 전환 로그 ④ **stale BP**: Deploy 후 파일 편집 → Attach only → 상태바 `⚠ 소스 변경됨 1` + 알림 + 그 파일 BP 회색·메시지 / 세션 중 저장 → 즉시 회색 / Quick Compile 성공 → 복원 / 배지 클릭 → 재시작 흐름 / 배포 기록 없는 워크스페이스에서 안내 로그만 ⑤ **1403**: `RECONNECT (…)`가 매 세션 뒤 1줄, 30분 정상 폴링에 `WATCHDOG:` 0건, LAN 분리로 connecting 고착 시 워치독 또는 connect timeout 한쪽만 동작, `batchReconnectDelayMs` 반영 ⑥ **FTP 스로틀**: LAN 단절→복구 플랩 시 5분 이내 재조회 없음(Traffic에 Show Memory/Flash Free/CPU Profile 미발생, FTP passive 연결 0), 명시 Disconnect 후 재연결은 즉시 조회 ⑦ **자원 카드**: Free/Used/Segments·accepted/s·clusters free·drops 값 채워짐(실기기 원문 기준 파서), 재부팅 후 카운터 리셋 표시, `-mbuf` 스위치 거부 시 STATUS 표시 ⑧ **사후 스냅샷**: 제어기 전원 차단으로 유실 유발 → `%TEMP%\gpl-controller\postmortem-*.log` 생성·알림 버튼·verdict(ICMP/TCP/arp, TTL 255·00-14-FF) 확인; 직결 NIC 임대 상실 재현 시 게이트웨이 응답 경고 ⑨ **connect 비대화형**: `code --open-url "vscode://nir414.gpl-language-support/connect"` → 연결·Output `[URI]`; `gpl.ai.debug.getConnectionState` 결과 ⑩ **MCP**: `read_dataids([2703,2704,2705])`, `controller_command(commands:[…])` 50건 소요, 문자열 값 DataID·wrap DataID·`pd 99999` STATUS, `controller_status(detail:true)` 2회 간격 ≥60 s에서 `acceptedPerSec` ⑪ **호버**: `showAfterClick` 켠 뒤 클릭 후 정지 → 호버, 드래그 선택 미표시; 수천 줄 문서에서 체감 ⑫ **단축키**: F9 = Toggle Breakpoint(기본), `gdeStyle` 켜면 F9 = Continue.
- [ ] **(2026-08-25, §1-BG) GPL Traffic 1402 응답 본문 표시 — 실기기 확인(읽기 전용, 모션 무영향)**: ① `Show Thread` 폴링 응답이 ` | ` 줄로 실시간 표시되고 마지막에 `<<<` 요약 ② `Compile`(waitForStatusClose) pass 사이 침묵 구간에 도착분이 먼저 보이는지 ③ 긴 응답(ErrorLog 다수) 4000자 초과 시 생략 요약 1줄 ④ 트리 `1402 통신 모니터` 인라인 토글/지우기 동작·설명 갱신, OFF면 `<<<` 요약만 ⑤ Live Log Terminal에도 ` | ` 줄이 흐르는데 과다하면 옵션 분리 ⑥ 좁은 사이드바에서 인라인 아이콘 2개 표시 확인.
- [ ] **(2026-08-25, §1-BF) 이슈 #27·#26·#24·#23·#18 — 실기기 검증(읽기 전용, 모션 무영향)**: ① Variables에서 `Robot.Where(1)`/Location 로컬 펼치기 → 멤버 값 표시·헤더 요약·`ZClearance (미설정)` ② hover/Watch `myRobot(0).armCount`(RNDRobot 프레임·StationManager 프레임 둘 다) → `1 (Integer) ← m_armCount (Get 반환식)`; 객체 노드 펼치면 가상 Property 자식; `Me.m_armCount` 자동 처리; `LocationEx.GetCurCartPos().loc` → `.Pos` 우회 ③ MCP `controller_status`(연결/차단/재부팅 중 3케이스 reachable verdict, powerEnabled), `show_threads` 크기 비교, `eval_expression("myRobot(0).armCount")` → resolvedAs, `debug_snapshot(listLocals:true)` 응답 형식 실측 → 런북 기록 ④ 확장 업데이트(0.8.18 → 0.8.19 VSIX 설치) 후 재시작 → "MCP 사본 갱신" 알림 → Claude Code `/mcp` 재연결 → `get_session_log.server.version` = 0.8.19; `GPL: Check AI Agent Setup` 정상/구버전 CLAUDE.md 감지 ⑤ 대시보드: 배지 색·flash, 축 게이지 이동 표시(Jog 중), XY 궤적, 주기 변경·일시정지, 상태바 `$(dashboard)` 진입.
- [ ] **(2026-08-25, §1-BE) 트리 쓰레드 스텝 정비 — 실기기 검증(저속/시뮬레이션 우선, 하드 규칙 6)**: ① 인라인 스텝이 `Step <t> -over -noerror`를 보내고 호출문을 **넘어가는지**(GPL Traffic·정지 줄) ② 우클릭 Step Into(`-noerror`)가 프로시저 **안으로** 들어가는지 ③ **Step Out(`-out -noerror`) STATUS 최초 실측**(Brooks 문서상 지원, GDE 캡처엔 없음) → 결과를 런북 "GDE 1402 실측 명령 포맷"에 기록 ④ 정지/에러 쓰레드 우클릭 → 스택 보기/현재 위치 보기 ⑤ STATUS≠0 경로(예: Running 쓰레드에 Continue, Idle 쓰레드에 Break) 에러 메시지 문구 확인.
- [ ] **(2026-08-25, §1-BD) 배포 순서 재배치 + 배포 잠금 — 실기기 검증, 릴리스 전 필수(하드 규칙 6)**:
  ① 전체 Deploy(쓰레드 실행 중): 업로드(FTP)와 `Stop -all`/`Show Thread` 폴링(1402)이 **동시에** 나가는지(GPL Traffic 타임스탬프 vs Output `↑` 라인), 둘 다 끝난 뒤에만 `Compile`이 나가는지. 쓰레드 실행 중 Quick Compile: 업로드가 진행되는 동안 "Stop 후 계속" 모달 → 승인 → Stop → settle → (업로드 완료 확인) → Compile. 총 소요가 이전(순차)보다 줄었는지 체감/로그로 확인
  ①-b 동시 진행 중 1402 명령(Stop/Show Thread)이 FTP 전송과 간섭하지 않는지(ECONNRESET·STATUS 누락 없음) — 사용자 주장 "문제 없음"의 실측 확정
  ② autoOnSave "auto" + 쓰레드 존재 → 업로드만, Compile 미전송(트래픽 로그), 트리 "프로젝트 상태"·상태바에 "컴파일 필요"
  ③ "컴파일 검증 필요" 상태에서 `GPL: Start` → 모달 → "Compile만 실행"은 Start하지 않음 / "그대로 Start"는 제어기 자체 컴파일(§0.7)로 새 코드가 실행되는지, 소스 에러가 있을 때 Start의 STATUS(-742 추정)와 소요 시간(암묵 컴파일 시간) 기록
  ④ 실행 중 `Compile`을 보내면 실제 STATUS가 무엇인지(문서: "may not be actively executing in a thread")
  ⑤ 업로드 실패(케이블 분리) 시 쓰레드 상태 불변(재배치로 STOP이 뒤로 갔으므로 예전과 달리 프로그램이 계속 돈다)
  ⑥ 실행 중 원격 전용 파일 삭제가 무해한지 → 확인되면 `deferDelete` 지연 제거 여부 결정
  ⑦ 업로드 중 다른 창 `GPL: Start` / MCP `compile_project` → 경고에 보유자·단계·경과 / MCP는 20초 대기 후 진행 또는 보유자 정보와 함께 거부
  ⑧ 확장 창 강제 종료 후 `%TEMP%\gpl-controller\<ip>.lock.json`이 30초 내 stale 처리되어 다음 배포가 정상 획득(Output `[Lock]` 로그)
- [ ] (§1-BD, 이슈 #17 ④) "업로드 중 Compile/Start → 제어기 사망" 재현 절차·양상(무응답/재부팅/ErrorLog) 기록 — 시뮬레이터 우선, 사용자 실기기 작업. 확인되면 이슈 #17에 코멘트.
- [ ] **(2026-08-05, §1-AQ) Stop/settle/busy-retry 처리 통일 리팩터링** — 같은 로직이 4곳+MCP에 제각각(§1-AQ 표 참조). 제안: ① `sendCommandWithBusyRetry`를 `controllerConnection.ts`(또는 공용 모듈)로 이동해 extension.ts/deployService/gplDebugSession이 공유 ② settled 상태 집합(`/^(idle|stopped|error)$/i`)과 settle 폴러를 단일 정본으로(현재 extension.ts:78과 deployService.threadSettled가 주석 동기화 의존 중복) ③ Stop 계열 공통 규약 확립: "Stop 전송 → STATUS 0/-752 모두 '접수'로 간주 → settle 폴링 → 미확인 시 Stop 1회 자동 재시도 → (수동 경로) SoftEStop 복구 제안 / (자동 경로) 중단" ④ controller-mcp 도구 설명·exportAgentSetup 가이드에 -752 비치명 의미 명시. ※ 모션/정지 흐름에 닿는 변경이므로 §3-B 원칙대로 저속/시뮬레이션 검증 후 적용.
- [ ] **(우선, §1-AH) 외부 AI 디버깅 경로 개선** — ①(워크스페이스 AI 가이드/`.mcp.json`)·②(`GPL: Export AI Agent Setup`)는 **완료(2026-08-05, §1-AN)**. 남은 것: ③ controller-mcp 디버깅 도구 견고화 패리티(§1-AG 규약) — **대부분 완료(2026-08-05, §1-AS: 정지확인 내장·run_to_line·statusHint, 실기기 검증 남음)**, ④ connect backoff, + **1403 실시간 스트림 도구**(console_start/read(cursor)/stop). 상세와 배경은 §1-AH/§1-AN.
- [ ] (§1-AG) 로컬 `npm run compile`→`npm run package`→VSIX 재설치 + 실기기 검증(Break/Step 상태 전이 타이밍, `-eval` 응답 형식, Error 전이 중단).
- [ ] (§1-J 후속) 캐시 초록 기반 60개(XmlNode/Network/Modbus) 항목을 web_fetch rate limit 해제 후 라이브 페이지로 파라미터 세부 재확인.
- [ ] §2 `isOrgCompleted` 대입 방식 확정 후 코드 수정 → MergeCode 재컴파일로 `-742` 해소 확인.
- [ ] 정의 찾기: 클래스 멤버 스코프 해석(`obj.member`를 obj의 클래스 한정으로) 정확도는 추후 보강 여지. ※ 오버로드 해석(인자 개수+타입, 동점 peek)은 2026-07-13 §1-K에서 구현 완료.
- [ ] (§1-P → §1-U에서 일부 완료) 실기기 검증: 1402 수동 검증으로 객체 덤프 형식 확인·분류 버그 수정(2026-07-22, §1-U). **남은 것(VSIX 재설치 후)**: Variables/hover/Watch에서 객체 트리 확장 UI 확인, 로컬 배열 펼침(30개 상한), 중첩 객체(`cmdResponse`), setVariable, Globals 패널 배열/객체 표시. 배열 확장 지연 크면 `ARRAY_EXPAND_MAX` 조정.
- [ ] (2026-07-16, §1-Q) 자체 검토 세션 변경분 — 로컬 `npm run compile` && `npm test` 후 §1-Q 실기기 검증 체크리스트 수행.
- [ ] (2026-08-18, §1-AY) Rename(F2) 실사용 검증 — MergeCode에서 로컬 변수/모듈 프로시저/클래스 멤버/스레드 문자열 참조 rename 확인. 다음 릴리스 CHANGELOG에 "Rename(F2) 지원" 기재.

### 3-B. 코드 리뷰 권고 — 미적용(검증/결정 필요)

§1-B에서 **안전 항목만** 적용했고, 영향이 크거나 실측이 필요한 것을 여기 남겼다.
2026-07-16(§1-Q)에서 사용자 승인 하에 대부분 적용됐고, **적용·종결된 항목은**
`docs/archive/handoff/2026-08.md` §부록으로 옮겼다. 아래는 **아직 열린 것만**이다.

> **이 섹션의 판정 기준**(하드 규칙 6이 가리키는 곳): 제어기·디버그처럼 **모션·하드웨어에 영향이
> 갈 수 있는 변경은 저속/시뮬레이션 검증 없이 적용하지 않는다.** 해당 분류(B1~B6)는 2026-07-16
> §1-Q에서 전부 적용·검증됐고 기록은 아카이브에 있다. 새 권고가 이 분류에 해당하면 여기에 추가한다.

#### 언어 정확성 — 문서/실측 확인 필요
- [ ] **A1** `Replace` — 컨트롤러/GDE에서 `string.Replace(...)` 동작 실측. 동작하면 정확 시그니처+sourceUrl로 재등록(`gplBuiltins.ts`의 제거 주석 참고), 아니면 제거 유지.


---

## 4. 핵심 파일

```
# 계층 규칙·폴더 지도(어디에 무엇을 두는가)는 docs/development/architecture.md — src/test/architecture.test.ts 가 강제한다 (§1-DB)
.vscode/launch.json                      # F5 개발 호스트 — --profile=GPL-DevHost(기본 설정·확장 없는 격리 창). "Run Extension" = hello-project, "Run Extension (syntax tour)" = syntax-tour (§1-BP, §1-DW)
samples/hello-project/                   # 개발 호스트용 최소 GPL 프로젝트(Project.gpr + Main.gpl). 제어기 없이 언어 기능 확인용, VSIX 미포함 (§1-BP)
samples/syntax-tour/                     # GPL 문(statement)을 전부 한 번씩 쓴 대조용 프로젝트(Main/Declarations/Shapes/Faults.gpl). 각 문의 첫 등장 줄 끝에 ' [syntax] <라벨> 마커. 모션 API 없음, VSIX 미포함 (§1-DW)
src/controller/controllerConnection.ts   # vscode 래퍼 — sendCommandDetailed(직렬 큐 + 명령 정책 before/after 적용, §1-BN) 옵션(keepAlive1402/idle) 전달, logTraffic(>>> / ' | ' / <<< / ---)·getTrafficLogOptions(§1-BG), closeControllerConnection/getConnectionStats/getRecentTraffic 재노출(§1-BI), probeControllerCommand/getConnectionProbeTimeoutMs(§1-BK), getCommandPolicySnapshot·isPolicyError 재노출(§1-BN)
src/controller/commandPolicy.ts          # 제어기 명령 정책(vscode 무의존) — R1 Step/Continue 정지 확인 대기+최소 간격(#28), R2 Start/Compile/Load/Unload 전 Stopping 정착 대기(§0.6), R3 Compile→Start 완충(§0.7); 승인/거부 없음, 한도 초과 시 PolicyError(미전송) (§1-BN)
src/language/gplStatements.ts            # 문 스니펫·키워드 정본(vscode 무의존) — 공식 Statement Dictionary 구문 + 스코프 규칙(scopes/requiresOpen/forbidsOpen) + getApplicableStatements (§1-CB)
src/language/blockContext.ts             # 커서 시점 열린 블록 스택(vscode 무의존) — analyzeBlockContext: file/type/procedure 스코프, 한 줄 If·Delegate·짝 없는 End 처리 (§1-CB)
src/language/gplDictionaryData.ts        # GPL Dictionary 데이터(vscode 무의존) — Class.Member 항목 + GPL_CLASS_DOCS(클래스 개요·생성자). Thread는 공식 18페이지 전수 (§1-BR)
src/language/gplBuiltins.ts              # 사전 API — usage/details 필드, findGplClassDoc·getGplClassMembers·findGplBuiltinMember(내장 타입 멤버 조회) (§1-BR)
src/controller/agentBridge.ts            # Agent Bridge 서버(vscode 무의존, 실행자 주입) — presence 파일·요청/응답 파일 IPC·gpl.* 범위 한정·순차 실행 (§1-BQ). **인스턴스별 분리**: extensionInstanceId 마다 extensions/<id>.json + bridge/inst/<id>/{req,res}, 레거시 IP 큐는 electLeaderInstanceId 로 뽑은 리더 하나만 서비스(구버전 MCP 호환) (§1-DK)
controller-mcp/src/extensionBridge.js    # Agent Bridge 클라이언트 — presence 판정/깨우기(code --open-url)/요청·응답 왕복/재전송 안전 판정 (§1-BQ) + listExtensionInstances·resolveExtensionInstance(창 선택: 명시 id→projectDir 워크스페이스→connected→유일, 애매하면 EXTENSION_AMBIGUOUS)·takeLateResponse(타임아웃 뒤 결과 회수) (§1-DK)
src/controller/operationStore.ts         # **장시간 작업 기록**(vscode 무의존) — operations/<id>.json 에 종류·대상·phase·결과 영속. 잠금과 분리(잠금은 사라지고 기록은 남는다), 멱등키로 중복 배포 차단, **RUNNING 인데 신호 끊김 = 읽을 때 UNKNOWN(실패 아님, 파일은 안 고친다)** (§1-DK)
controller-mcp/src/operations.js         # 위 기록 읽기(읽기 전용 미러) + operationRecovery(상태별 다음 행동). 확장을 거치지 않으므로 확장이 배포로 바빠도·MCP 가 재시작돼도 조회된다 (§1-DK)
src/controller/deployProvenance.ts       # **배포 증적**(vscode 무의존) — 로컬 소스 지문 vs 우리가 올린 내용 지문 대조: localRevision/uploadedRevision/inSync + changedSinceUpload·notUploaded·staleRemote. verifiedBy='upload-manifest'(원격을 직접 해시한 것이 아님을 밝힌다), 기록 없으면 inSync=false (§1-DK)
src/controller/automationRecovery.ts     # **복구 지시 표**(vscode 무의존) — 오류 코드 → action·retryCurrentCommand·safeToRepeat. 잠금/타임아웃/진행 중은 전부 CHECK_OPERATION + 재시도 false, **표에 없는 코드는 재시도 금지**로 떨어진다 (§1-DK)
src/controller/uriDispatch.ts            # 외부 진입점 URI 해석(vscode 무의존) — /<gpl.command.id>?args=JSON | ?key=value | /command?id=…, 별칭 4개, gpl.* 범위 한정 (§1-BN)
src/controller/connectionHealth.ts       # 연결 건강 판정(vscode 무의존) — ConnectionHealthMonitor(connected→suspect→lost, 프로브 임계 3/거부 2·힌트는 suspect만)·ConnectionHealthProber(1 s 재프로브)·classifyCommandFailure·probeOutcomeFromResponse (§1-BK)
src/controller/consoleSocket.ts          # 1402 소켓 계층(vscode 무의존) — keep-alive 소켓 1개, terminator-first 재사용 판정, stale 1회 재시도, 트래픽 링버퍼 600줄 (§1-BI, #22), reject code 부착·보관 소켓 관찰자(§1-BK)
src/debug/sourceTargets.ts               # BP 유효 줄·프로시저 범위(End Sub 기준)·호출 후보 파싱(vscode 무의존) — BP 줄 보정(문서 규칙)·Jump to Cursor 검증·Step Into Target 후보 (§1-BU)
src/controller/threadActivity.ts          # "동작 중" 판정(vscode 무의존) — 쓰레드 존재 = 활성, project 컬럼·기본 이름·`_Cmd_<project>`(Execute 쓰레드) 인정 (§1-BU). 상태 판정 단일 출처: isSettledState(Idle/Stopped/Error) · isPausedState/PAUSED_THREAD_STATES(Paused/Break/Error, §1-DD)
src/controller/projectCommands.ts         # **Compile/Load/Unload/Start 의 정본**(vscode 무의존·주입형 IO) — compileProject(후보 순회·일시적 STATUS 1회 재시도·성공은 STATUS 0+에러 0 뿐)/loadProject(HTTP 응답=제어기 이상)/unloadProject(-750 쓰레드 실행 중)/startProject(항상 buildStartCommand). 배포·FTP Run 이 함께 쓴다 (§1-DE)
src/controller/remoteProjectPath.ts       # 어느 원격 사본(/flash/projects vs /GPL)을 대상으로 삼을지 — 점수 규칙 단일 정본(존재+200/flash+80/선택+20, switched 로 전환 고지) (§1-DE)
src/controller/threadStop.ts              # **쓰레드 정지의 정본**(vscode 무의존·주입형 IO) — probeThreads(잘린 응답=확인 불가) / waitThreadsSettle·waitThreadSettle / sendStop / stopAllAndSettle·stopThreadAndSettle(전송→STATUS 판정→폴링→자동 재시도, unconfirmed 노출). 배포·패널·FTP·디버그가 모두 이것을 쓴다 (§1-DD)
src/controller/threadStuckDiagnosis.ts    # **정지 불가 쓰레드 진단**(vscode 무의존·주입형 IO, **읽기 전용**) — diagnoseStuckThread(위치 N회 샘플링→이동 판정→소스 문맥→수신자 식→복구 후보) / extractCallTarget(문장의 마지막 메서드 호출) / buildRecoveryCandidates(지역 변수 인덱스는 0..N 치환) / createFileSourceLookup(파일명만 아는 위치를 로컬에서 찾기). 후보는 **제시만 하고 보내지 않는다** (§1-DI)
src/controller/startCommand.ts            # Start 명령 조립(vscode 무의존) — 문서 구문 순서, 기본 `-event`(GDE 동일), `-compile` 금지(하드 규칙 7) (§1-BU)
src/debug/threadLock.ts                  # 스레드 단일 실행 잠금 판정(vscode 무의존) — resolveExecutionThread(대상 확정·staleLock)·shouldPreserveFocus·isAllThreadsResumeRequest. 어댑터의 StoppedEvent 는 전부 _stoppedEvent 경유(불변식) (§1-BS)
src/controller/idlePing.ts               # 1402 유휴 ping 판정/스케줄러(vscode 무의존) — GDE 방식 세션 유지(유휴 5 s → 읽기 명령 1개), 1403 안정성의 열쇠 (§1-BM)
src/controller/reachability.ts           # ping TTL·TCP·arp 도달성 판정 + 응답 장치 정체(제어기 vs 게이트웨이) 힌트 (§1-BI, #22)
src/controller/resourceProbes.ts         # Show Memory / Show Network -tcp / -mbuf 파서(실기기 원문 기준)·증가율·이력 (§1-BI, #22 자원 카드)
src/controller/runtimeConsoleGuards.ts   # 1403 접속 카운터(슬라이딩 윈도우)·워치독 판정(순수) (§1-BI)
src/controller/deployRecordCore.ts       # 컴파일 스냅샷(sha1) 기록/대조 순수 로직 + Memento 스토어 (§1-BI, #21)
src/controller/deployRecord.ts           # deployRecordCore vscode 래퍼 — recordCompiled/getCompiledRecord/onDidRecordCompiled/attachDeployRecordStore (§1-BI)
src/controller/compileStale.ts           # "컴파일 검증 필요" 배지 상태(CompileStaleTracker, vscode 무의존) — 해제는 onDidRecordCompiled 구독으로 경로 무관 (§1-CU)
src/debug/stepGate.ts                    # Step/Continue 게이트 순수 판정 shouldGateStepRequest(pending-entry/pending-same-thread/min-interval) (§1-BI, #28)
src/debug/evalMessages.ts                # 평가 실패 문구 정본(vscode 무의존) — formatEvalError(hover/Watch/REPL 공용, 세션에서 이관)·describeNestedExpandFailure(중첩 객체 펼치기 실패 행: 코드·원인 앞, 대처 뒤, Debug Console 용 detail)·UNDEFINED_SYMBOL_STATUS/UNSUPPORTED_PROCEDURE_STATUS (§1-DS)
src/language/getterBranch.ts             # 분기형 Property getter(`If 필드 비교 Then Return A Else Return B`, 4형태) 파싱·계산 정본(순수) — parseGetterBranch(파서 → GPLSymbol.getterBranch)·getterBranchIdentifiers(hover 게이트 해석 가능 판정)·evaluateGetterBranch(어댑터 ②-c·가상 Property 자식, 결과는 제어기 표기 -1/0 + via) (§1-DS)
src/debug/spontaneousPause.ts             # 사용자 액션 없이 관측된 Paused 판별(vscode 무의존) — GPL 의 Paused 는 Thread.Sleep 대기도 포함하므로 등록 BP 위치 일치 = 즉시 정지, 그 외 3폴·1500ms 연속 = 외부 정지, 나머지는 무시(가짜 브레이크 차단) (§1-CK)
src/controller/debugBridge.ts            # 디버그 세션 ↔ 확장 이벤트 버스 + RuntimeConsoleHealth 공급자(1403 alive → 백업 폴 완화) (§1-BI) + onDebugProbeResult(어댑터 폴 결과 → 연결 건강 모니터, §1-BK)
src/views/refreshThrottle.ts             # 트리 FTP/시스템 정보 자동 재조회 스로틀 판정(순수) (§1-BI, #22)
src/debug/launchJsonc.ts                 # launch.json JSONC 읽기/부분 갱신(jsonc-parser) — 주석·포맷 보존 upsert (§1-BI, #30)
controller-mcp/src/batch.js              # MCP controller_command 배치 runBatch/normalizeCommandInput (§1-BI, #16)
src/controller/trafficResponseBody.ts    # ResponseBodyStreamer — 1402 응답 본문 줄 단위 스트리밍·상한 생략 요약(§1-BG, vscode 무의존 순수 모듈)
src/controller/deployService.ts          # deploy() = 잠금 획득 → UPLOAD ∥ STOP/THREAD_CHECK(settle 게이트 — 항상 병행, §1-DL) → COMPILE → START(직전 정지 재확인 §0.6) → ERROR CHECK(§1-BD 재배치), tryCompile, directGpl(§1-G), COMPILE_DEFERRED, findProjectDirs(**/*.gpr), onDidUploadProgress 이벤트(업로드 진행/종료 — 상태바 진행 바가 구독, §1-EE)
src/controller/projectPickerCore.ts      # 프로젝트 폴더 선택 순수 규칙 — orderProjectDirs(최근 선택 우선)·projectDirFromResource(폴더 자체/.gpr/포함 파일)·filterDirsByProjectName (§1-BL, vscode 무의존)
src/controller/projectPicker.ts          # 공용 선택기 pickProjectDir(Detailed)(QuickPick·workspaceState 최근 선택)·readGprProjectName/projectNameOf·context key gpl.projectDirs(탐색기 메뉴) — 명령·F5 provider 공용 (§1-BL)
src/controller/projectNameGuard.ts       # 프로젝트명/Load 경로 안전성 단일 규칙(vscode 무의존) — 1402 명령은 공백 구분·인용 불가 → 공백·제어 문자 검출 checkProjectName/checkRemotePath·안내 문구 describeProjectNameProblem; deploy/Start/ftpRun·Unload/F5 attach/MCP proj()가 공유 (§1-BQ)
src/debug/activateDebug.ts               # DebugConfigurationProvider — 중복 세션 처리 + fillProjectTarget(다중 프로젝트 QuickPick, projectDir/projectName 보충) (§1-BL), InlineDebugAdapterFactory
src/controller/deployLock.ts             # 배포 잠금 — 메모리+파일(%TEMP%/gpl-controller/<ip>.lock.json), pid/heartbeat stale 자동 만료, describeDeployLock (§1-BD, 이슈 #15·#17)
src/controller/ftpClient.ts              # uploadProject onlyFiles, mirrorProject deferDelete + removeRemoteFiles(§1-BD), 지문 스킵 판정(§1-BV), 진행 이벤트 onProgress(event) = 파일 완료 + basic-ftp trackProgress 바이트(§1-EE)
src/controller/uploadProgress.ts         # 업로드 진행 집계(vscode 무의존) — UploadProgressTracker(파일 완료 + 전송 중 바이트, 스킵은 즉시 완료, 크기 클램프)·UploadProgressEvent; 표시는 views/uploadProgressBar (§1-EE)
src/util/formatBytes.ts                  # 바이트 → 사람이 읽는 크기 정본(vscode 무의존, R7) — formatBytes/formatBytesAs/byteUnitFor(B 정수·그 위 소수 1자리·GB 까지); 종전 views/treeFormat.formatSize 통합 (§1-EE)
src/controller/syncManifest.ts           # 업로드 지문(SHA-1) 매니페스트 — 미러/skipUnchanged 스킵 판정(§1-BV, globalState)
src/controller/breakpointReconcile.ts    # 에디터↔제어기 중단점 수렴 계획(vscode 무의존) — project-relative identity 비교, 미해석 proc=?/0 제외, planReconcile/orphan 표시 (§1-CJ, §1-EC)
src/controller/breakpointCommand.ts      # BP 명령 문자열 계층(vscode 무의존) — 무공백 생성, project-relative 경로 보존 parser, MirrorEchoMemory (§1-CO, §1-EC)
src/controller/breakpointMirror.ts       # 제어기→에디터 중단점 미러 — AI(MCP·URI·콘솔)가 건 BP를 빨간 점으로. 외부 진입점에서만 동작(DAP·EditorBreakpointSync 제외), 설정 mirrorAiBreakpoints (§1-CO)
src/controller/responseParser.ts         # parseStatus, parseCompileErrors
src/debug/showVariableParser.ts          # Show Variable 파싱 — 2열 Location 멤버(isTypeToken)·summarizeLocation·annotateLocationMember(§1-BF)
src/language/receiverType.ts             # 멤버 접근 수신자 타입 정적 해석(resolveReceiverHolder·membersNamed·buildDocumentReceiverLookup) + 소속 판정 ownedByHolder·nestedTypesIn(정의찾기 전역 폴백 차단용, §1-CA) — 디버그 hover 게이트·정적 hover 공용(§1-BJ, #32, vscode 무의존)
src/ai/exportAgentSetup.ts               # Export/Check AI Agent Setup — 번들 동기화·파일 생성·설정/대상 준비 상태(§1-EF)
src/ai/agentSetupChecks.ts              # 실행 설정·폴더 대상·CLAUDE/AGENTS 안내 검사(vscode 무의존)
src/views/controllerDashboardPanel.ts    # 제어기 대시보드 웹뷰 — setInterval/pause/config 메시지(§1-BF); HTML은 media/dashboard.html
controller-mcp/src/parse.js              # MCP 파서 — parseThreadList(이름 키)·compactThread·summarizeThreads·parseShowVariable(§1-BF)
scripts/bundle-mcp.js                    # MCP 번들 + 빌드 스탬프(define __GPL_MCP_BUILD_JSON__, 사이드카 .build.json)(§1-BF)
src/debug/gplDebugSession.ts             # attachRequest, _runDeployBeforeAttach(lockOwner 'F5 Deploy'), _waitDeployLockForStart, getDebugDeployDiagnostics
src/extension.ts                         # activate()/deactivate() — 배선만(195줄). ExtensionHost 생성 → activation/*.ts 의 activateXxx(host) 를 종전 순서로 호출 (§1-CZ)
src/activation/host.ts                   # ExtensionHost — 클로저가 공유하던 서비스(채널·심볼 캐시)·가변 상태(트리·상태바·런타임 콘솔·건강 모니터·디버그 여부·마지막 스냅샷)·헬퍼(log·배포 잠금·컴파일 검증 상태·런타임 콘솔 싱글톤·연결 상태 반영·Agent Bridge)·하위 API(project/connection/deploy/decorations). **가변 상태는 항상 host.x 로 읽는다** (§1-CZ)
src/activation/deploy.ts                 # gpl.deploy/uploadStart/start/saveToFlash/quickCompile + autoOnSave + 자동화 대상 해석·게이트 — runDeploy/runDeployCore(969줄 — 결과 보고부는 controller/deployOutcome.ts) (§1-CZ, §1-DB) · onDidUploadProgress → 상태바 진행 바 구독, Save to Flash 는 직접 연결(§1-EE)
src/activation/connection.ts             # 연결 건강 모니터 배선·유실 처리·사후 스냅샷·connect/disconnect(대화형+비대화형)·launch.json·startQuickAttachSession(attachOnly=배포 없이 붙기, §1-DC)·debugProject(배포+붙기 — 대상은 QuickPick·우클릭, §1-DQ)
src/activation/projectContext.ts         # 기대 프로젝트 감지·launch.json 읽기·GPL 파일명→경로·BP target 해석(resolveGplFilePath/resolveBreakpointTarget) — host.project (§1-CZ, §1-EC)
src/activation/controllerOps.ts          # busy 재시도·정지 확인(§0.6)·SoftEStop 복구·정지 진입 대기(waitForThreadPause) — host 를 첫 인자로 (§1-CZ)
src/activation/debugDecorations.ts       # ExecutionDecorations — 정지 줄/에러 줄 강조 한 객체 (§1-CZ)
src/activation/{languageFeatures,xmlCommands,breakpointCommands,consoleCommands,aiAgentSetup,aiDebugCommands,controllerCommands,treeCommands,ftpCommands,debugIntegration,uriHandler}.ts  # 명령 그룹별 activateXxx(host) — 본문은 종전 extension.ts 그대로 (§1-CZ)
src/controller/threadArgs.ts             # asThreadNode — 쓰레드 명령 인자 정규화(순수) (§1-CZ)
src/controller/stepCommand.ts            # buildStepCommand — Step 명령 조립 정본(트리·AI API 공용, 순수) (§1-CZ)
src/util/pathKey.ts                      # 경로 동일성 키 normalizePathKey·normalizeDirKey·isPathUnder(파일·폴더 공용 단일 규칙, vscode 무의존) — controller/projectPickerCore 에서 분리(§1-CQ, §1-DB)
src/language/identifiers.ts              # ciEq — GPL 식별자 대소문자 무시 비교(vscode 무의존, 종전 config.ts) (§1-DB)
src/project/gprSync.ts                   # Project.gpr 파싱/소스 목록 동기화 순수 로직(vscode 무의존, 종전 controller/) — 명령 래퍼는 controller/gprSyncCommand.ts (§1-BW, §1-DB)
src/controller/deployOutcome.ts          # 배포 결과 보고 순수 규칙 — SituationDeploySnapshot 정의·결과 서명/이력·ErrorLog 분류 로그·COMPILE 원문 로그·실패 문구 4분기(vscode 무의존, 종전 activation/deploy.ts 클로저) (§1-DB)
src/views/treeFormat.ts                  # 트리 표시 포맷(날짜·연결 통계, vscode 무의존 — 크기는 util/formatBytes 로 §1-EE) (§1-DB)
src/views/uploadProgressBar.ts           # 상태바 업로드 진행 바 표시 규칙(vscode 무의존, R7) — renderBar(20칸 + 1/8 부분 블록)·formatBytesPair(total 단위 통일)·describeUploadProgress(전송 중/완료/동일)·renderUploadSummary; 집계는 controller/uploadProgress (§1-EE)
src/views/connectionStatusBar.ts         # 상태바 — 연결 항목·대시보드·경고 배지(컴파일 검증 필요/소스 변경됨/스레드 잠금, 각각 별도 항목 §1-DV)·업로드 진행 바(setUploadProgress/endUpload — 제자리 갱신, 완료 2.5초·실패 5초 남김, §1-EE)
src/views/runtimeConsoleTreePresentation.ts  # 1403 콘솔 트리 행 문구(라벨·description·아이콘·툴팁·불안정 판정·가설, vscode 무의존) — 알림용은 controller/runtimeConsolePresentation.ts (§1-DB)
src/test/architecture.test.ts            # 구조 회귀 테스트 — vscode 의존 허용 목록·계층 의존 방향·런타임 순환·테스트 등록·package.json↔명령/설정 키 (§1-DB, 규칙 근거는 docs/development/architecture.md)
src/test/sampleSyntaxCoverage.test.ts    # samples/syntax-tour 가 문법 정본(gplStatements)을 빠짐없이 쓰는지 양방향 검사 — 마커↔라벨, 키워드, 비GPL 문법 금지, gpr 등재, 파서 심볼 (§1-DW)
src/controller/aiCommandPolicy.ts        # AI/자동화 경로에서 거부할 명령 목록(정본) — 되돌릴 수 없는 명령만. 브리지·URI·명령 자체가 함께 본다 (§1-DA)
controller-mcp/src/deployLock.js         # 잠금 파일 읽기 전용 구현(확장과 파일 계약 공유) — Compile/Start/Load/Unload 유한 대기·거부(§1-BD)
src/language/gplParser.ts                # Property/Sub/Function 파싱 + parseDocument 메모이즈 캐시(§1-B E) + docComment 수집(§1-J) + Property getter 골격(getterReturnExpr 단순 Return #26 / getterBranch 분기형 §1-DS)
syntaxes/gpl.tmGrammar.json              # 구문 강조 — GPL 전용 규칙(선언 6종·Delegate 타입 선언·내장 VB 문법이 모르는 키워드 5규칙) 뒤에 source.asp.vb.net 위임. 선언 규칙 수식어 집합 = GPL_PROC_MODIFIERS, src/test/grammar.test.ts 가 강제 (§1-DT)
src/language/gplBuiltins.ts              # 핵심 빌트인/String 함수 (Trim→메서드, Rnd(seed), Replace 제거, Asc/Chr/… 추가) + Bit 문자열 전역함수(§1-J)
src/language/gplDictionaryData.ts        # Move/Robot/Location/Profile/.../String 클래스 사전 + Controller/Thread/Exception/File/XML/Network 등 +153(§1-J)
src/providers/completionProvider.ts      # 정적 항목 캐시, 트리거('.', '&')
src/providers/definitionProvider.ts      # token 확인 + parseDocument 재사용
src/providers/hoverProvider.ts           # token 확인 + docComment 표시(§1-J)
src/providers/signatureHelpProvider.ts   # Signature Help(빌트인+사용자 Sub/Function, §1-J 신설)
src/symbolCache.ts                       # 심볼 캐시 + 완성 문서화(buildSymbolDocumentation, §1-J) — 파일 항목 키는 normalizePathKey(원본 표기는 항목에 보관), .gpr 소스 합집합도 같은 키(§1-CQ)
src/language/symbolLocations.ts          # 정의 peek 목록 정리(vscode 무의존) — dedupeSymbolLocations(같은 파일·줄 병합)/preferExistingFiles(없는 파일 제외, 전부 없으면 원본 유지) + 존재 판정 정본 isMissingFile(ENOENT만 삭제로 본다)·fileExists(§1-CQ)
src/language/docComment.ts               # 문서화 주석 정본(vscode 무의존) — parseDocComment(섹션 별칭·펜스 인식)/renderDocCommentMarkdown(호버·완성·시그니처 공용)/buildDocCommentBlock·mergeDocComment(골격·머지, DocTarget.coveredParams/coveredReturns 로 "차이만" §1-DR). 원문은 손실 없이 보존하고 렌더에만 손보는 원칙: withFenceLanguage(펜스 언어 보정)·stripDecorativeRules(`====` 장식선 제거, §1-CS)
src/language/docCommentOverloads.ts      # 오버로드 문서화 주석 병합 정본(vscode 무의존, §1-DR) — filterOverloadSiblings(형제 = 같은 이름·Sub/Function·모듈/클래스·컴파일 단위, 사본 접기)/resolveOverloadDoc(공통 설명은 유일하게 가장 풍부한 문서·자기 설명 없으면 Jaccard 로 가장 닮은 형제·이름별 매개변수·같은 타입 Returns — 선언 순서 무관, provenance 동반)/renderResolvedDocMarkdown/describeOverloadCoverage(골격 "차이만"). 호버·완성(symbolCache.buildSymbolDocumentation)·시그니처·''' 공용, 형제 후보는 symbolCache.findOverloadSiblings
src/project/projectSources.ts            # "프로젝트에 속한 소스" 단일 출처 — 재귀 목록·ProjectSource 해석·소유 .gpr 선택(§1-BW, vscode 무의존) + 중첩 프로젝트 경계(stopAtNestedProject)·ProjectLibrary 해석(resolveProjectLibraryDirs)·관련 프로젝트 수집(collectRelatedGprPaths)(§1-BX)
src/project/compileUnitTarget.ts         # 컴파일 단위(.gpr) 선택 정본(vscode 무의존, §1-DX) — chooseCompileUnitGprs: 세션 대상 폴더(host.sessionTargetDir) 1순위 → 프로젝트명 일치 전부 → 없음. projectContext.findExpectedProjectDirs·gplDebugSession._updateProjectDirs 가 공유
src/project/breakpointTarget.ts          # BP source identity 정본(vscode 무의존, §1-EC) — 메인 .gpr 직접 ProjectSource 원문 / ProjectLibrary source / compile unit 밖 판정
src/project/projectFileScope.ts          # 참조 검색·심볼 인덱싱 공용 파일 범위(resolveProjectFileScope, PROJECT_EXCLUDE_GLOB)(§1-BW) — 라이브러리 양방향 확장(§1-BX)
src/providers/referenceProvider.ts       # scanDocumentText 라인별 스캔(ReDoS 완화) + 프로젝트 범위 폴백(§1-BW — findTextInFiles는 제안 API로 미사용)
.github/instructions/gpl-ai-controller-debugging.instructions.md  # 하드 규칙
```

---

## 5. 참고 — 정상 컴파일 응답 형식 (GDE, verbatim, 2026-06-30)

다음처럼

---

## 1. 세션 이력 — 최근 세션 + 전체 인덱스

본문에는 **최근 10개 세션**(§1-DV ~ §1-EE)만 둔다.
그 이전은 월별 아카이브에 원문 그대로 있다 — 아래 인덱스의 링크를 따라간다.

| 아카이브 | 범위 | 세션 수 |
| --- | --- | --- |
| [2026-06](archive/handoff/2026-06.md) | §1-A ~ §1-B (2026-06-30) | 2 |
| [2026-07](archive/handoff/2026-07.md) | §1-C ~ §1-AL (2026-07-03 ~ 2026-07-31) | 35 |
| [2026-08](archive/handoff/2026-08.md) | §1-AM ~ §1-CM (2026-08-05 ~ 2026-08-31) | 53 |
| [2026-09](archive/handoff/2026-09.md) | §1-CN ~ §1-DU (2026-09-02 ~ 09-17) | 34 |
| (본문 아래) | §1-DV ~ §1-EE (2026-09-18 ~ 09-30) | 10 |

### 1-0. 전체 세션 인덱스

| § | 날짜 | 주제 | 위치 |
| --- | --- | --- | --- |
| §1-A | 06-30 | 컴파일 STATUS 조기 완료·F5 컴파일 에러 유지·저장 시 자동 컴파일·Property 인덱싱 | [2026-06](archive/handoff/2026-06.md) |
| §1-B | 06-30 | 코드 리뷰 후속 수정 (같은 날 별도 작업 스트림) | [2026-06](archive/handoff/2026-06.md) |
| §1-C | 07-03 | VSIX 패키징 실패(EACCES) 해결 + 패키징 파이프라인 개선 | [2026-07](archive/handoff/2026-07.md) |
| §1-D | 07-03 | 디버그 스텝 체감 지연 개선 | [2026-07](archive/handoff/2026-07.md) |
| §1-E | 07-03 | 디버그 변수 확인 UX: 클릭 즉시 표시 | [2026-07](archive/handoff/2026-07.md) |
| §1-F | 07-03 | 제어기 무응답 사건 + LSP 정리 | [2026-07](archive/handoff/2026-07.md) |
| §1-G | 07-08 | Quick Compile 재설계: /GPL 직접 업로드 + Stop 완료 게이트 | [2026-07](archive/handoff/2026-07.md) |
| §1-H | 07-08 | 디버그 `<projectName>` 오인식(다른 프로젝트로 처리) 수정 | [2026-07](archive/handoff/2026-07.md) |
| §1-I | 07-08 | 디버그(F5) 배포: /GPL 직접 미러 동기화 (flash 미경유) | [2026-07](archive/handoff/2026-07.md) |
| §1-J | 07-10 | 언어 서비스 개선(Hover/IntelliSense/Signature Help) + Brooks 사전 대폭 확장 | [2026-07](archive/handoff/2026-07.md) |
| §1-K | 07-13 | 정의찾기(F12) 오버로드 해석: 인자 타입 추론 + 동점 peek | [2026-07](archive/handoff/2026-07.md) |
| §1-L | 07-13 | 디버그 브레이크 감지/전환 체감 개선 + F8 키바인딩 충돌 수정 | [2026-07](archive/handoff/2026-07.md) |
| §1-M | 07-14 | 호버 팝업 스팸 개선 (요약 모드 + 디버그 중 간소화 + gpl.hover.* 설정) | [2026-07](archive/handoff/2026-07.md) |
| §1-N | 07-14 | 디버그(F5) 배포에 "업로드 전 쓰레드 확인 + 정지 확인 모달" 게이트 적용 | [2026-07](archive/handoff/2026-07.md) |
| §1-O | 07-14 | 반복되는 `.git/index.lock` "File exists" 에러 진단 + 해제 스크립트 추가 | [2026-07](archive/handoff/2026-07.md) |
| §1-P | 07-14 | 디버그 변수 표시: 배열/객체 구조적(트리) 표시 지원 | [2026-07](archive/handoff/2026-07.md) |
| §1-Q | 07-16 | 자체 검토: 전체 코드 리뷰 + §3-B 보류 항목 일괄 적용 | [2026-07](archive/handoff/2026-07.md) |
| §1-R | 07-16 | 자동완성 개선: 멤버 완성 + 로컬 완성 + 중복 삽입 방지 | [2026-07](archive/handoff/2026-07.md) |
| §1-S | 07-16 | 중첩 클래스 파서 수정 + 스모크 하니스 + Dictionary 커버리지 대조 | [2026-07](archive/handoff/2026-07.md) |
| §1-T | 07-22 | 정의 찾기: `Shared Public Dim` 수식어 순서 + 문자열 속 프로시저 참조(New Thread) | [2026-07](archive/handoff/2026-07.md) |
| §1-U | 07-22 | Show Variable 실기기 검증(§1-P 후속): 객체 헤더 형식 차이 수정 + 콘솔 평가 한계 확인 | [2026-07](archive/handoff/2026-07.md) |
| §1-V | 07-22 | 디버깅 중 엉뚱한 폴더 파일이 열리는 문제 수정 (소스맵 경합 해소) | [2026-07](archive/handoff/2026-07.md) |
| §1-W | 07-22 | 디버그 hover에서 `armList(i)` 같은 인덱스 식 평가 지원 | [2026-07](archive/handoff/2026-07.md) |
| §1-X | 07-22 | Globals 패널 표시 지연 진단·개선 | [2026-07](archive/handoff/2026-07.md) |
| §1-Y | 07-22 | 실기기 추가 검증 반영: 객체 배열 분류 + 점 표기 멤버 폴백 | [2026-07](archive/handoff/2026-07.md) |
| §1-Z | 07-23 | 0.8.0 릴리즈 메타데이터 정리 + 검증/패키징 | [2026-07](archive/handoff/2026-07.md) |
| §1-AA | 07-23 | 버전/커밋/태그/릴리즈 운영 문서 정리 | [2026-07](archive/handoff/2026-07.md) |
| §1-AB | 07-23 | 1403 수신 비정상 상태 문서 명시 + 릴리즈 문서 표현 정리 | [2026-07](archive/handoff/2026-07.md) |
| §1-AC | 07-24 | AI Debug Assist 오케스트레이션 명령 추가 | [2026-07](archive/handoff/2026-07.md) |
| §1-AD | 07-24 | AI 자율 디버깅 API/루프 추가 | [2026-07](archive/handoff/2026-07.md) |
| §1-AF | 07-24 | 배포 경로 이원화: Deploy=/GPL 직접, Save to Flash 신설, Start 버튼 분리 | [2026-07](archive/handoff/2026-07.md) |
| §1-AG | 07-24 | AI 자율 디버깅 API 견고화 (반환 계약/Output 기록/pause 폴링) | [2026-07](archive/handoff/2026-07.md) |
| §1-AH | 07-24 | 외부 AI(Claude Code) 실전 투입 관찰: MCP 미등록 → 원시 TCP 우회 (분석만, 코드 변경 없음) | [2026-07](archive/handoff/2026-07.md) |
| §1-AI | 07-28 | src/ 전체 가독성 정리 (동작 불변 리팩터링만) | [2026-07](archive/handoff/2026-07.md) |
| §1-AJ | 07-28 | GPL Controller 뷰 타이틀 툴바 재구성 (package.json만) | [2026-07](archive/handoff/2026-07.md) |
| §1-AK | 07-28 | 확장 트리 ↔ 디버그 패널 쓰레드 기능 병합 | [2026-07](archive/handoff/2026-07.md) |
| §1-AL | 07-31 | 트리 "현재 실행 위치 보기"가 .history stale 사본을 열던 버그 수정 | [2026-07](archive/handoff/2026-07.md) |
| §1-AM | 08-05 | CALL STACK에서 Running 쓰레드 클릭 → 현재 실행 위치 열기 | [2026-08](archive/handoff/2026-08.md) |
| §1-AN | 08-05 | MCP 서버 VSIX 동봉 + `GPL: Export AI Agent Setup` 구현 (§1-AH ①·② 완료, 0.8.9) | [2026-08](archive/handoff/2026-08.md) |
| §1-AO | 08-05 | GPL Controller 뷰 메뉴에 명령 8종 추가 + Export CLAUDE.md 중복 감지 수정 (0.8.10) | [2026-08](archive/handoff/2026-08.md) |
| §1-AP | 08-05 | 에디터 중단점→제어기 동기화 + 정지 위치 자동 표시 (0.8.11) | [2026-08](archive/handoff/2026-08.md) |
| §1-AQ | 08-05 | 배포 STOP 단계 -752 즉시 실패 제거: settle 게이트 판정 + Stop -all 1회 자동 재시도 (0.8.12) | [2026-08](archive/handoff/2026-08.md) |
| §1-AR | 08-05 | 제어기 중단점 실시간 보기: 트리 섹션 상시 표시 + 클릭 열기 + 인라인 새로고침 + Pull 명령 (0.8.13) | [2026-08](archive/handoff/2026-08.md) |
| §1-AS | 08-05 | controller-mcp: AI 디버깅 낭비 패턴 구조적 차단 (run_to_line·정지확인 내장·힌트 주입) | [2026-08](archive/handoff/2026-08.md) |
| §1-AT | 08-05 | 배포 로그 가독성 개선 (폴링 스팸·전량 나열·오해 소지 기호 정리) | [2026-08](archive/handoff/2026-08.md) |
| §1-AU | 08-05 | controller-mcp 2차: keep-alive 연결·세션 로그·사전 가드·debug_snapshot (§1-AS 실사용 피드백 반영) | [2026-08](archive/handoff/2026-08.md) |
| §1-AV | 08-18 | autoOnSave 조건부 자동 활성화(기본 "auto") + Start 계열 배포 뮤텍스 가드 | [2026-08](archive/handoff/2026-08.md) |
| §1-AW | 08-18 | 활동바 "GPL Controller" 아이콘 교체 (CPU 칩) | [2026-08](archive/handoff/2026-08.md) |
| §1-AX | 08-18 | 컴파일 에러 점프 최종 포커스를 편집기로 + 점프 로직 공용 헬퍼화 | [2026-08](archive/handoff/2026-08.md) |
| §1-AY | 08-18 | Rename(F2) 프로바이더 신규 (라이벌 확장 대응) | [2026-08](archive/handoff/2026-08.md) |
| §1-AZ | 08-18 | 문서 전면 정리 + Material for MkDocs 사이트 도입 | [2026-08](archive/handoff/2026-08.md) |
| §1-BA | 08-18 | 문서 정리 2차: Test_robot 잔재 제거·정본 정리·Pages 배포 | [2026-08](archive/handoff/2026-08.md) |
| §1-BB | 08-18 | Test_robot 아카이브 반출 + datatypes 상수 원문 교체 | [2026-08](archive/handoff/2026-08.md) |
| §1-BC | 08-18 | README 과포화 정리 (중복 압축·버전 표기 제거) | [2026-08](archive/handoff/2026-08.md) |
| §1-BD | 08-25 | 이슈 #15·#17 통합: 배포 잠금(프로세스 간) + 배포 단계 UPLOAD ∥ STOP 병행 → COMPILE + "컴파일 필요" 상태 | [2026-08](archive/handoff/2026-08.md) |
| §1-BE | 08-25 | 트리 쓰레드 제어 정비: 스텝 버튼 아이콘/명령 불일치 수정 + Step Into/Out·스택 보기 우클릭 메뉴 + `<STATUS>` 판정 | [2026-08](archive/handoff/2026-08.md) |
| §1-BF | 08-25 | GitHub 이슈 #27·#26·#24·#23·#18 일괄 처리 | [2026-08](archive/handoff/2026-08.md) |
| §1-BG | 08-25 | GPL Traffic에 1402 응답 본문 실시간 표시 + 트리 "1402 통신 모니터" 항목 | [2026-08](archive/handoff/2026-08.md) |
| §1-BH | 08-26 | GitHub 이슈 #20: VS Code 표준 디버그 키 복원 | [2026-08](archive/handoff/2026-08.md) |
| §1-BI | 08-26 | GitHub 열린 이슈 14건 일괄 처리 (#15~#28) | [2026-08](archive/handoff/2026-08.md) |
| §1-BJ | 08-27 | GitHub #32: 멤버 접근 hover의 수신자 타입 해석 (+ Property 디버깅 방향 논의) | [2026-08](archive/handoff/2026-08.md) |
| §1-BK | 08-28 | 제어기 연결 끊김 자동 감지 재설계 (`controller/connectionHealth.ts`) | [2026-08](archive/handoff/2026-08.md) |
| §1-BL | 08-28 | 프로젝트 선택 규칙 공용화 + F5 다중 프로젝트 QuickPick + 탐색기 우클릭 메뉴 | [2026-08](archive/handoff/2026-08.md) |
| §1-BM | 08-28 | GDE 1403 캡처 프레임 단위 재판독 → 1402 유휴 ping(GDE 방식 세션 유지) + 1403 UTF-8 디코딩 | [2026-08](archive/handoff/2026-08.md) |
| §1-BN | 08-28 | URI 외부 진입점 전체 개방 + 제어기 명령 정책(지침 → 확장 자체 강제) | [2026-08](archive/handoff/2026-08.md) |
| §1-BO | 08-28 | 프로젝트명 공백 가드(1402 명령 인자는 공백 구분) | [2026-08](archive/handoff/2026-08.md) |
| §1-BP | 08-28 | F5 개발 호스트를 "기본 VS Code + 우리 확장만" 환경으로 표준화(전용 프로필) | [2026-08](archive/handoff/2026-08.md) |
| §1-BQ | 08-28 | Agent Bridge: MCP가 제어기에 직접 붙지 않고 **확장을 사용**하게 | [2026-08](archive/handoff/2026-08.md) |
| §1-BR | 08-28 | GPL Dictionary **Thread 클래스**를 확장이 띄우게(멤버 전수·상세·클래스 개요·인스턴스 호버) | [2026-08](archive/handoff/2026-08.md) |
| §1-BS | 08-28 | 제어기 디버깅 조작 전수 조사 + 표준 단축키 검토 + **스레드 단일 실행 잠금** | [2026-08](archive/handoff/2026-08.md) |
| §1-BT | 08-28 | 문서화 주석(Documentation Comment) 포맷 + 골격 자동 생성 | [2026-08](archive/handoff/2026-08.md) |
| §1-BU | 08-28 | 공식 문서 기준 디버깅 조작 확장(Jump to Cursor·Step Into Target·조건부 BP·함수 BP) + Start 구문 + 쓰레드 존재 = 동작 중 | [2026-08](archive/handoff/2026-08.md) |
| §1-BV | 08-28 | 업로드 스킵 판정을 "크기" → **내용 지문(SHA-1)** 으로 (미러/skipUnchanged) | [2026-08](archive/handoff/2026-08.md) |
| §1-BW | 08-28 | 프로젝트 하위 폴더(중첩 소스) 지원: "프로젝트에 속한 소스" 판단을 한 곳으로 | [2026-08](archive/handoff/2026-08.md) |
| §1-BX | 08-31 | 중첩 프로젝트(`ProjectLibrary`) 지원: "소유한 파일"과 "함께 컴파일되는 파일"을 분리 | [2026-08](archive/handoff/2026-08.md) |
| §1-BY | 08-31 | FTP 섹션 "폴더 비우기" 버튼(제어기 `/GPL` 통째로 삭제) | [2026-08](archive/handoff/2026-08.md) |
| §1-BZ | 08-31 | GPL Console 줄 접두사를 `[RT] [<프로젝트>]` → 시각으로 | [2026-08](archive/handoff/2026-08.md) |
| §1-CA | 08-31 | 정의찾기(F12)가 한정자를 버리고 동명의 남의 심볼로 점프하던 문제 | [2026-08](archive/handoff/2026-08.md) |
| §1-CB | 08-31 | 문(statement) 스니펫 자동완성: Try/Select/For 등 제어 구조 + 키워드 | [2026-08](archive/handoff/2026-08.md) |
| §1-CC | 08-31 | 밀린 커밋 일괄 정리 + 0.8.22 릴리스 | [2026-08](archive/handoff/2026-08.md) |
| §1-CD | 08-31 | GPL 패널 「업로드 스타트」 버튼 (`gpl.uploadStart`) | [2026-08](archive/handoff/2026-08.md) |
| §1-CE | 08-31 | **이 문서 과포화 정리** — 세션 이력 월별 아카이브 분리 + 읽는 순서로 섹션 재배치 + 보존 규칙 신설 | [2026-08](archive/handoff/2026-08.md) |
| §1-CF | 08-31 | 디버그 값이 흐리게 보이던 문제(DAP `type` 제공) + 예약어(`If`/`Then`) 위 -712 오류 팝업 차단 + 예약어 목록 정본화 | [2026-08](archive/handoff/2026-08.md) |
| §1-CG | 08-31 | `Thread.CurrentThread.Name` 디버그 호버에 값이 안 나오던 문제 — 내장 클래스 수신자 타입 해석 + 사전 `returnType`/`sideEffectFree` | [2026-08](archive/handoff/2026-08.md) |
| §1-CH | 08-31 | Private 모듈 전역 값 편집이 -729로 실패 — 쓰기 이름 표기 재시도 + 원인 설명 문구 | [2026-08](archive/handoff/2026-08.md) |
| §1-CI | 08-31 | GPL 언어 정보 커버리지 감사 — 클래스 개요 26개 + 체인 해석용 returnType 48개 + 누락 문 3개 | [2026-08](archive/handoff/2026-08.md) |
| §1-CJ | 08-31 | F9로 지운 중단점이 제어기에 남아 계속 브레이크가 걸리던 문제 — 제거 폴백 + 양방향 수렴(`reconcileAll`) + 어긋남 표시 | [2026-08](archive/handoff/2026-08.md) |
| §1-CK | 08-31 | 안 걸린 BP가 걸린 것처럼 보이던 두 원인 — 스케줄러 `Paused` 오인 정지 차단 + `ProjectLibrary` 소스는 제어기가 BP 대상으로 못 찾음(-508) 규명·안내 | [2026-08](archive/handoff/2026-08.md) |
| §1-CL | 08-31 | 1402 연결 실패를 제어기 장애로 단정하던 판정 개선 — `recovering` 상태 + 관측/추론 분리 + MCP `outcome:'unknown'` (P0) | [2026-08](archive/handoff/2026-08.md) |
| §1-CM | 08-31 | 자동화 경로에서 프로젝트 선택 UI 가 떠 멈추던 문제 — 비대화형 대상 해석(`projectTarget.ts`) + `-714` 추측 차단 (P0) | [2026-08](archive/handoff/2026-08.md) |
| §1-CN | 09-02 | 프로젝트 상위 폴더에서 워크스페이스를 여는 중첩 구조 지원 — 정의/참조/이름바꾸기의 컴파일 단위 경계(`compileUnit.ts`) + 탐색 상한·`.svn` 제외 | [2026-09](archive/handoff/2026-09.md) |
| §1-CO | 09-02 | AI(MCP)가 건 중단점이 에디터에 안 보이던 문제 — 제어기→에디터 미러(`breakpointMirror.ts`) + `list_breakpoints` 빈 결과 수정 | [2026-09](archive/handoff/2026-09.md) |
| §1-CP | 09-02 | 디버깅 중 호버에서 문서화 주석이 사라지던 동작 — `gpl.hover.duringDebug` 기본값 `compact` → `normal` + 설정 정규화 단일 출처화 | [2026-09](archive/handoff/2026-09.md) |
| §1-CQ | 09-02 | 정의 찾기(F12)가 같은 선언을 3번 띄우던 문제 — 심볼 캐시 경로 키 정규화(`normalizePathKey`) + peek 목록 중복/잔류 제거 | [2026-09](archive/handoff/2026-09.md) |
| §1-CR | 09-02 | 문서화 주석이 `Module`·`Class`·변수·상수 선언에서 표시되지 않던 문제 — 파서의 `docComment` 수집 대상을 모든 선언 종류로 확장 + 소속 판정 단일 출처화(`isDeclaredIn`) | [2026-09](archive/handoff/2026-09.md) |
| §1-CS | 09-02 | 옛 주석의 ASCII 장식 구분선(`' ====`)이 호버를 setext 헤딩으로 깨뜨리던 문제 — `isDecorativeRule`/`stripDecorativeRules`(렌더 단계에서만 제거) | [2026-09](archive/handoff/2026-09.md) |
| §1-CT | 09-02 | 중첩 라이브러리 구조에서 BP 가능하게 — 소스 승격 계획/검증(`sourcePromotion.ts`) + 디버그 소스맵을 컴파일 단위로 좁힘 | [2026-09](archive/handoff/2026-09.md) |
| §1-CU | 09-02 | 최근 세션들의 미완 코드 항목 마무리 — "컴파일 검증 필요" 배지 해제를 배포 경로와 분리(`compileStale.ts` + `onDidRecordCompiled`) · `clean.js` 비ASCII 경로 크래시 · folding 의 `Set` 대입문 오인 | [2026-09](archive/handoff/2026-09.md) |
| §1-CV | 09-02 | 이름 바꾸기(F2) 오작동 — 선언 심볼 range 를 이름 span 으로(줄 전체 금지) · 콤마 다중 선언 파서(`declarationList.ts`) · 스코프 가시성 정본(`symbolScope.ts`, F12/F2 공유) · 편집 전 텍스트 검증 | [2026-09](archive/handoff/2026-09.md) |
| §1-CW | 09-02 | 참조 찾기(Shift+F12)가 생성자 `New Class(...)`와 `"Class.Proc"` callback 문자열을 놓치던 문제 — 특수 참조 문법 정본(`referenceSyntax.ts`) | [2026-09](archive/handoff/2026-09.md) |
| §1-CX | 09-03 | 밀린 세션 20개분(§1-CD~§1-CW) 작업 트리 일괄 커밋 + `.gitignore` 정리 — 리팩토링 준비 | [2026-09](archive/handoff/2026-09.md) |
| §1-CY | 09-07 | 네트워크 DataID 조사 + 실기 실측 대조 — 진단에 쓸 항목 골라내기(`reference/network-dataids.md`) | [2026-09](archive/handoff/2026-09.md) |
| §1-CZ | 09-07 | `extension.ts` activate() 5,300줄을 명령 그룹별 모듈(`src/activation/`)로 분해 — `ExtensionHost` + 순수 로직 4건 분리·테스트 15건 (§3-B 보류 항목 종결) | [2026-09](archive/handoff/2026-09.md) |
| §1-DA | 09-07 | flash 영구 저장(`gpl.saveToFlash`)을 AI/자동화 경로에서 차단 — 차단 목록 정본 `aiCommandPolicy.ts` + 브리지·URI·명령 3중 게이트, MCP 미러 | [2026-09](archive/handoff/2026-09.md) |
| §1-DB | 09-07 | 구조 기반 정비 — tsconfig 엄격 플래그·죽은 코드 제거·계층 경계(`util/pathKey`·`project/gprSync`·언어 모듈 `language/` 이동)·순수 분리(`deployOutcome`·`treeFormat`)·**계층 규칙 테스트 고정**(`architecture.test.ts`)·`docs/development/architecture.md` 신설 | [2026-09](archive/handoff/2026-09.md) |
| §1-DC | 09-10 | 「업로드 스타트」 시퀀스 정정 **(시퀀스 가설은 §1-DL 에서 기각·철회)** — 정지 확인 → 업로드 순차(`stopBeforeUpload`) + Start 직전 정지 재확인, 배포 없이 붙는 `gpl.debug.attachOnly` 신설·명령 제목 한국어화 + 원인 규명용 TEST 경로(`gpl.uploadStart.test`) + 빌드 완료 후 GPL Console 포커스 탈취 제거 | [2026-09](archive/handoff/2026-09.md) |
| §1-DD | 09-10 | 제어기 조작 절차를 API 한 겹으로 묶기(1) — 전체/개별 쓰레드 정지 정본 `controller/threadStop.ts`(주입형 IO·테스트 17건) + 5곳 통합 + 정지/일시정지 상태 판정 단일화 + 무검증 성공 보고 2건 수정 + 중복 절차 전수 조사 | [2026-09](archive/handoff/2026-09.md) |
| §1-DE | 09-10 | 제어기 조작 절차 API 통합(2) — Compile/Load/Unload/Start 정본 `projectCommands.ts` + 원격 사본 선택 `remoteProjectPath.ts` + Start 전 콘솔 준비 일원화, FTP Run 의 `-event` 누락·컴파일 에러 미표시 해소 | [2026-09](archive/handoff/2026-09.md) |
| §1-DF | 09-10 | 제어기 패널 섹션 기본 접힘 상태를 사용자가 쓰는 배치로 고정 — 섹션 `TreeItem.id` 부여(+`SECTION_LAYOUT_EPOCH` 세대)로 저장된 접기 상태가 기본값을 덮어쓰던 문제 해소, `GPL: Reset Panel Layout` 명령 신설 | [2026-09](archive/handoff/2026-09.md) |
| §1-DG | 09-10 | SoftEStop 확인 모달의 취소 버튼 중복 — `{ modal: true }` 가 자동으로 붙이는 취소와 명시 항목 `'취소'` 가 겹치던 문제 | [2026-09](archive/handoff/2026-09.md) |
| §1-DH | 09-10 | 컴파일 에러 시 Problems 패널로 전환되지 않던 문제 — 출력 채널 `show()` 가 패널 전환을 덮어쓰던 것을 점프 여부로 분기(`jumpToFirstCompileError` 가 boolean 반환) | [2026-09](archive/handoff/2026-09.md) |
| §1-DI | 09-10 | 정지 불가 쓰레드 진단 `controller/threadStuckDiagnosis.ts` 신설(읽기 전용) — 위치 반복 샘플링·소스 문맥·수신자 식 추출로 복구 후보를 **제시**(전송 안 함), 배포 STOP 실패 시 자동 + `GPL: 정지 불가 쓰레드 진단` 명령 | [2026-09](archive/handoff/2026-09.md) |
| §1-DJ | 09-10 | 연결을 해제해도 1402 소켓이 다시 열리던 문제 — 디버그 어댑터가 확장의 해제를 모른 채 1 s 폴로 재접속하던 것을 해제 전 세션 종료(terminated 대기)로 차단, `stopAllOnDisconnect` 는 모달 확인 | [2026-09](archive/handoff/2026-09.md) |
| §1-DK | 09-10 | MCP·확장 자동화 구조 개선 — 확장 인스턴스별 presence/큐 분리(창이 여럿일 때 요청이 뒤섞이던 원인), 배포를 Operation 모델로(타임아웃 뒤 결과 조회·멱등키), 배포 증적 대조, 구조화 복구 지시 | [2026-09](archive/handoff/2026-09.md) |
| §1-DL | 09-10 | 「업로드 스타트」 제어기 이상 가설(㉠ Stop 중 FTP 덮어쓰기 · ㉡ 정지 직후 Start) **실기기 기각** — 순차화(`stopBeforeUpload`)와 TEST 경로(`gpl.uploadStart.test`) 철회, 업로드는 다시 정지 게이트와 병행(속도 복귀) | [2026-09](archive/handoff/2026-09.md) |
| §1-DM | 09-10 | **정지 불가 쓰레드의 원인 후보 확정 — `StreamReader.Read`/`ReadLine` 의 문서화된 무한 블록**(GPL Dictionary "hang your procedure"). `Peek` 은 비블로킹으로 정정(대신 탈출 조건 없는 루프를 지목), 리포트에 근거 URL·1순위·블로킹/폭주 미확정 경고. §1-DI 실측 건의 원인 확정은 아님 | [2026-09](archive/handoff/2026-09.md) |
| §1-DN | 09-10 | **`Start` 에 `-compile` 누락 — 올린 소스 대신 옛 바이너리가 실행되던 문제(사용자 발견).** 옛 하드 규칙 7("Start 가 자체 컴파일")을 캡처·실기 관측으로 폐기하고 `buildStartCommand` 기본값을 `-compile` 로 전환, MCP `start_project` 의 스위치 없는 `Start <proj>` 도 확장과 동일 형태로 정정 | [2026-09](archive/handoff/2026-09.md) |
| §1-DO | 09-10 | **`Thread.CurrentThread().` 뒤 자동완성이 `Thread.Abort()` 를 통째로 삽입하던 문제** — 완성 provider 의 자체 체인 해석을 `receiverType` 공용 해석기로 이관(`resolveReceiverTarget`), 미해석 시 전역 목록 폴백 → 멤버 후보만(tail 삽입) | [2026-09](archive/handoff/2026-09.md) |
| §1-DP | 09-10 | **표준화(ACL·SSOT·DRY·DI) — 판정 정본을 코드로 강제** · 수신자 해석 조립 정본 `providers/receiverContext.ts` 신설(사본 4벌 통합) · definitionProvider 자체 해석기 이관(다단 체인·`Me.` 해석 개선) · 배열 요소 타입 정본화 · 구조 테스트 R7 신설 | [2026-09](archive/handoff/2026-09.md) |
| §1-DQ | 09-10 | **명령 UI 정리(사용자 지시)** — `category:"GPL"` 분리로 제목의 `GPL:` 하드코딩 63개 제거, 제목을 영문 원어 + 한국어 병기로 통일(81개), 팔레트에서 36개 숨김(트리 인자 필수 25 + AI 진입점 11), 패널 `···` 메뉴 22 → 14(부분집합·트리 중복 제거, 새로고침은 아이콘으로, 콘솔 4종은 트리 항목으로) | [2026-09](archive/handoff/2026-09.md) |
| §1-DR | 09-17 | **오버로드 문서화 주석 병합** — "공통 문서는 이름 단위로 공유, 차이만 개별 문서화"(`language/docCommentOverloads.ts` 신설, 마커 없음), 선정은 선언 순서 무관(풍부함·커버리지·Jaccard, 애매하면 생략), 호버 `+N 오버로드`·출처 표기, 시그니처·자동완성 동일 병합, `'''` 골격은 형제가 설명한 매개변수 제외, MCP 지침·README 갱신 | [2026-09](archive/handoff/2026-09.md) |
| §1-DS | 09-17 | **디버그 hover 정리(스크린샷 기반)** — 중첩 객체 펼치기 실패 행을 실제 원인(-729 프레임 밖 Private 필드 등)으로(`debug/evalMessages.ts`), 타입 자리·Class/Module 단독 이름 hover 차단(규칙 0-b/0-c), 인자 있는 Property 는 커서 세그먼트만 차단, **분기형 getter 를 부모 덤프 필드 값으로 계산**(`language/getterBranch.ts`), Public 필드 점 표기는 통과한다는 실측 정리, hover 위젯 잘림은 VS Code 동작 | [2026-09](archive/handoff/2026-09.md) |
| §1-DT | 09-17 | **구문 강조 보강** — `Delegate`·`AddressOf`·`ByVal/ByRef`·`Shared/Overrides…`·`Try/Catch`·`Me/MyBase`·`Inherits` 등 내장 VB(ASP) 문법이 모르는 GPL 키워드를 확장 문법이 직접 칠함, `Delegate Sub/Function` 은 타입 선언으로, 선언 규칙 수식어 집합 = `GPL_PROC_MODIFIERS`(구조 테스트 `grammar.test.ts`), **기존 이중 괄호 `((Sub))` 로 선언 이름에 색이 안 붙던 버그** 수정 | [2026-09](archive/handoff/2026-09.md) |
| §1-DU | 09-17 | **`Delegate` 선언이 심볼로 인덱싱되지 않아 정의 찾기·호버가 안 되던 문제** — 파서에 `GPLSymbolKind.Delegate`(한 줄 타입 선언, 파라미터·반환 타입·문서화 주석, 블록 진입 없음) 신설, 호버 `Delegate Sub Name(params)` 시그니처, 개요/워크스페이스 심볼·자동완성 종류·디버그 hover 타입 판정·`'''` 문서화 대상에 반영 | [2026-09](archive/handoff/2026-09.md) |
| §1-DV | 09-18 | **상태바 "컴파일 검증 필요" 배지를 누르면 연결이 끊기던 문제** — 연결 항목 글자에 덧붙어 있던 배지를 별도 상태바 항목으로 분리(`connectionStatusBar.ts`), 클릭 = 해당 프로젝트 Quick Compile(`Uri` 인자, 선택 창 없음), 연결 항목은 연결 해제만; 설명 문장 정본 `compileStale.describeCompileStale` + 배지 규칙 `views/compileStaleBadge.ts` 로 4벌 사본 통합, R7 행 추가 | [2026-09](archive/handoff/2026-09.md) |
| §1-DW | 09-18 | **문법 전수 샘플 `samples/syntax-tour` + 커버리지 테스트** — 공식 Statement Dictionary 열거로 GPL 의 문이 25개(+예외 처리)뿐임을 확정하고(`Enum`·`Inherits`·`Implements`·`With`·`Type` 은 GPL 에 없음), `gplStatements.ts` 를 커버 정본으로 삼아 4개 소스에 전 문법을 한 번씩 사용(모션 API 없음). 줄 끝 `' [syntax] <라벨>` 마커 + `src/test/sampleSyntaxCoverage.test.ts` 가 양방향 커버리지·키워드·비GPL 문법·gpr 등재·파서 심볼을 강제. `hello-project` 는 최소 확인용으로 그대로 유지, F5 구성 "Run Extension (syntax tour)" 추가 | [2026-09](archive/handoff/2026-09.md) |
| §1-DX | 09-18 | **시작 시 인덱싱 O(n²) 제거 + 동명 소스 해석을 세션 대상 폴더 기준으로 통일** — 사용자 분석 문서 2건 코드 대조. `symbolCache`: 파일마다 이름 인덱스 재구축(567개에서 798 ms) → 묶음 끝 1회, `openTextDocument` 567회 → 디스크 직접 읽기(`files.encoding` 비UTF-8 만 문서), 32 파일마다 양보, `.gpl` 워처 300 ms 묶음, 요약 로그 1줄. `project/compileUnitTarget.ts` 신설 — **세션 대상 폴더(`host.sessionTargetDir`, deploy 클로저 흡수) 1순위** 규칙을 트리/이벤트(`projectContext`)와 디버거(`_updateProjectDirs`, launch `projectDir` 힌트)가 공유, Quick Attach 가 `projectDir` 동봉. 배포 ERROR CHECK 문구 = Start 직후 스냅숏 명시. `-200` 은 확장 밖 | 본문 ↓ |
| §1-DY | 09-21 | **"컴파일 검증 필요" 배지가 방금 작업한 프로젝트 대신 가장 오래된 것을 가리키던 문제** — 대표 항목 `CompileStaleTracker.current()` 를 가장 먼저 등록된 것 → **가장 최근 표시된 것**으로, `mark()` 는 재표시 시 최근 자리로 승격(`since`·`projectDir` 보존). `markCompileStale`(방금 항목)과 `clearCompileStale`(`current()`)이 서로 다른 항목을 가리키던 편차도 함께 해소 | 본문 ↓ |
| §1-DZ | 09-21 | **식별자 안의 키워드에 색이 칠해지던 문제(`Public SyncSub As TcpSyncCmdSub` 의 `Sub`)** — 선언 규칙 7개가 `(?i)\s*…` 로 시작해 줄 중간의 `Sub As …` 를 선언으로 읽고 있었다. 전부 `(?i)^\s*` 로 줄 머리 고정(Class·Module·Delegate·Sub·Function·Property·Const). 곁들여 `As New <Type>` 의 `New` 가 타입 색을 먹고 정작 타입은 무색이던 것, 한정 이름(`As Net.LogSink`)이 첫 마디만 칠해지던 것을 고치고 타입 참조 스코프를 `storage.type.gpl` 로 통일 | 본문 ↓ |
| §1-EA | 09-21 | **「오류 상세 보기」 로그 `[main] - [main] - …` 겹침 + 에러 코드 분류 범위 표 + `Init` 충돌 실기 확정** — 보고서 되먹임 차단(`host.report`)·제어기 사건 링버퍼(`recentEvents.ts`)·`<E>N</E>` 단일 숫자 상태 프레임 억제; `classifyErrorEntry` 를 공식 `Error_Intro.htm` 범위 표로(`-757`/`-700` = 코드 오류), 라벨 정본 `describeErrorCategory` + R7; 진입점 대조 `startProcedureCheck.ts`; **`samples/init-probe` 실험으로 클래스 멤버 `Init` 이 모듈 초기화에 인스턴스 없이 불려 -757 나는 것 재현·확정** → 진단 `language/initHook.ts`, 예약어 `Lib`, `-757` 힌트; 에러 UI(강조 유지·항목 클릭 이동·복사=상세 보기, `controller/errorReport.ts`); 키워드 호버(`findGplKeyword`, `ByVal`/`ByRef` 문서 규칙) | 본문 ↓ |
| §1-EB | 09-22 | **클래스 이름 참조 찾기가 선언 파일 밖을 놓치던 문제** — 파서의 자기-참조 필드(`Class` 심볼의 `className` = 자기 이름)를 `referenceProvider` 가 raw 로 읽어 클래스 선언을 "자기 자신의 멤버" 로 분류 → 비한정 검색이 정의 파일로 묶이고 다른 파일의 `As X`·`New X(...)` 가 전부 탈락(F2 도 같은 경로라 **클래스 이름 바꾸기가 선언 파일만 고쳤다**). 소속 판정을 정본 `enclosingClassName`/`enclosingModuleName` 으로 교체 + 사용부 실행도 타입 선언을 복원(`isTypeUsageAt`) + `renameProvider` 충돌 검사도 같은 정본. 같은 세션에 **문자열 참조를 소비 위치로 좁히고**(로그 문자열 오탐 — `SYMBOL_STRING_CONSUMERS`), **제어기 채널을 번호가 아니라 이름으로**(`channelNames.ts` · 하드 규칙 §0-8 · 구조 테스트 R8), 패널 「전체 쓰레드 복사」(`controller/threadReport.ts` — 상황 스냅샷과 같은 표, R7 규칙 추가로 `controllerStatus` 의 집계 사본도 정리) | 본문 ↓ |
| §1-EC | 09-22 | **중첩 source/library breakpoint identity 수정** — `ProjectSource` 원문 상대경로를 전송하고 library source는 명령 전에 차단; parser/mirror/reconcile 경로 보존; `Show Break`의 procedure resolution까지 검증 | 본문 ↓ |
| §1-ED | 09-29 | **개요 「커서 따르기」가 클릭한 심볼을 놓치던 문제** — 블록 심볼 범위를 "다음 동급 심볼 직전" 휴리스틱 → 파서가 기록한 짝 `End …` 줄(`endLine`)로. 마지막 클래스 범위가 문서 끝까지 늘어나고 중첩 클래스에서 바깥 클래스 범위가 조기 절단되던 겹침 해소, Property 를 블록 심볼로, 중첩 클래스를 바깥 클래스 children 으로(`parentClassName`) | 본문 ↓ |
| §1-EE | 09-30 | **업로드 진행 바(상태바)** — FTP 업로드 중 상태바에 `██████░░░░  3.2 MB / 10.7 MB` 가 제자리에서 움직이고 완료 요약을 잠시 남김. 집계 `controller/uploadProgress.ts` · 표시 규칙 `views/uploadProgressBar.ts` · 바이트 표기 정본 `util/formatBytes.ts`(모두 순수, R7), 바이트는 basic-ftp `trackProgress`, 전파는 `deployService.onDidUploadProgress` 를 `activation/deploy.ts` 가 한 번 구독(모든 배포 경로 공통), Save to Flash 는 직접 연결 | 본문 ↓ |
| §1-EF | 10-02 | **다중 프로젝트 AI Setup** — 활성 파일/최장 경로 추측 제거, 폴더 대상 저장·미확정 표시, 설정/안내 불일치 점검, multi-root 범위 지정, MCP 세션의 폴더 확인 가드 | 본문 ↓ |
| §1-EG | 10-02 | **누적 작업 트리 커밋 정리** — §1-DR~§1-EF 변경을 대화·인계 기록과 diff로 대조하고 언어 분석 / 프로젝트·중단점 / 제어기 진단·업로드 / AI Setup / 문서·매니페스트의 5개 커밋으로 분리, 전체 테스트 재검증 | 본문 ↓ |

---

**최근 세션 본문 — §1-DX ~ §1-EG (2026-09-18 ~ 10-02).** 이 아래부터는 세션 원문이다.


## 1-DX. 2026-09-18 세션 — 시작 시 인덱싱 O(n²) 제거 · 동명 소스 해석을 세션 대상 폴더 기준으로 통일

### 계기 (사용자 분석 문서 2건)

- `GPL확장-시작지연-분석-20260918.md` — 첫 `.gpl` 을 열 때 확장 호스트가 1.3 s 이상 멈춘다. 워크스페이스
  `…\34. Sample Prep\장비 구성`(하위 독립 프로젝트 7개, `.gpl` 567개 / 6.9 MB / 심볼 21,747개). 설치 빌드 `out/` 모듈을
  Node 에서 직접 호출한 측정: 읽기+파싱 465 ms, **`rebuildNameIndex` 567회 798 ms(심볼 방문 누적 624만 회)**,
  `openTextDocument` 567회(측정 불가).
- `제어기 메모리부족·소스경로 오지정 정리 2026-09-18.md` — 이슈 A: `MergeCode` 기동 5초 뒤 `-200 *No memory available*`
  재현(제어기/GPL 프로그램 측). 이슈 B: 동명 `_lib_DataKeyValue.gpl` 이 워크스페이스에 9개, 배포본은 `Dilution\…\MergeCode`
  인데 **`⚠ 동명 소스 9개 경합` 경고는 `Antibody\…` 를, 디버거 예외 표시는 `projects(제거예정)\…` 를 열었다.**
  `_robot_Robot.gpl` 은 사본마다 줄 수도 내용도 달라 같은 1260번 줄이 전혀 다른 코드다.

### 코드 대조 (지적 ↔ 실제) — 구현 전에 먼저 확인했다

| 지적 | 대조 결과 | 조치 |
| --- | --- | --- |
| 1. 인덱싱 O(n²) | **사실.** `updateDocument()` 가 파일마다 `rebuildNameIndex()` → `getAllSymbols()` 전량 재순회 | `updateFileText()`(인덱스 보류) + 묶음 끝 `finally` 1회 |
| 2. `openTextDocument` 567회 | **사실 + 문서가 못 본 비용 하나 더**: `onDidOpenTextDocument` 핸들러가 `languageId !== 'gpl'` 이면 `normalizeGplDocumentLanguage`(언어 전환)까지 파일마다 돌린다 | `vscode.workspace.fs.readFile` + UTF-8 디코딩(BOM 제거). `files.encoding` 이 UTF-8 계열이 아닌 리소스만 문서로 |
| 3. 진단 호출 `isRefreshing` 가드 | 문서 객체를 만들지 않으면 `onDidOpenTextDocument` 자체가 발생하지 않아 **문제가 소멸** | 별도 변경 없음 |
| 4. `.gpl` 워처 디바운스 없음 | **사실.** 파일마다 `openTextDocument` + 전체 재구축 | 300 ms 묶음 → `updateFilesFromDisk()` 1회 |
| 5. verbose 로그 파일당 1줄 | **사실** | `Indexed N files in X ms` 요약 1줄(실패 파일만 개별) |
| B. "`[SymbolCache]` 경고가 Antibody 선택" | **출처 오인** — 그 경고는 `projectContext.resolveGplFilePath`(트리·이벤트 명령) 것이고 같은 채널에 섞여 보였다. 진짜 원인: `findExpectedProjectDirs` 와 디버거 `_updateProjectDirs` 가 모두 **프로젝트명 일치 `.gpr` 전부**를 모아 `MergeCode` 3개가 동률 → `pickSourceCandidate` 가 깊이·사전순으로 갈라 각각 다른 사본. `project_target` 으로 고정한 폴더는 어느 쪽에도 들어가지 않았다 | `project/compileUnitTarget.ts` 신설 — 세션 대상 폴더 1순위, 두 해석기가 공유 |
| A. 배포 `No active errors` 가 5초 먼저 | **사실이나 설계상 Start 직후 스냅숏**이다. 관측 창을 두면 배포 잠금·Operation 이 그만큼 길어진다 | 문구에 시점 명시만. 런타임 에러는 1403/`[Debug Error]` 가 담당 |
| A. `-200` 자체 | **확장 밖**(GPL 프로그램의 소객체 대량 생성 추정) | 문서의 조사 항목을 §3 에 옮김 |

### 조치 — 인덱싱 (`src/symbolCache.ts`, `src/activation/languageFeatures.ts`)

- `updateFileText(fsPath, text)`: 확장자·NUL 검사 → 파싱 → `symbols` 갱신까지만. **이름 인덱스는 건드리지 않는다.**
  `updateDocument()`(열린 문서 단건)는 이걸 부르고 자기가 1회 재구축 + 종전 로그.
- `indexWorkspace()`: 에디터에 열린 문서는 그 버퍼(미저장 편집분), 아니면 `readSourceText()`(디스크). 32 파일마다
  `setImmediate` 양보(호버·자동완성 요청이 사이에 처리될 틈). `finally` 에서 `rebuildNameIndex()` 1회. 로그는 요약 1줄.
- `updateFilesFromDisk(uris)`: 워처 묶음용 — 읽기 → 보류 갱신 → 끝에 1회 재구축.
- 워처: `pendingWatcherFiles` 에 모아 300 ms 뒤 flush. `refresh` 중이면 300 ms 뒤 재시도(종전에는 조용히 버렸다).
- `refresh()` 가 부르는 경로이므로 `GPL: Refresh Symbols`·`.gpr` 변경 재인덱싱도 같은 혜택.

### 조치 — 동명 소스 해석 (`src/project/compileUnitTarget.ts` 신설 + 5개 파일)

- `chooseCompileUnitGprs(projectName, target, listKnown)` (순수): `target`(세션 대상 폴더의 `.gpr` 신원)이 있고 이름이
  맞으면(또는 이름을 아직 모르면) **그 하나** `via:'target-dir'` — `listKnown` 은 호출하지 않는다(스캔 생략). 아니면
  이름 일치 전부 `'name'`, 대상 폴더 이름이 어긋나면 `'target-dir-mismatch'`(호출자가 경고), 근거 없으면 `'none'`.
  `readGprIdentity(gprPath)` / `readGprIdentityInDir(dir)` 동봉. 테스트 `compileUnitTarget.test.ts` 7건(실측 배치 재현).
- **`host.sessionTargetDir`** 신설(단일 출처) — `deploy.ts` 의 `automationTargetDir` 클로저를 흡수(`project_target`·
  `gpl.automation.target`·QuickPick 선택이 갱신). `debugIntegration.onDidStartDebugSession` 이 `configuration.projectDir`
  로 갱신. `connection.ts` Quick Attach/Attach Only 는 대상 폴더의 프로젝트명이 맞으면 `projectDir` 를 동봉.
- `projectContext.findExpectedProjectDirs()`: 위 규칙 사용. mismatch 경고는 (대상, 기대 이름) 조합당 1회.
- `gplDebugSession`: `args.projectDir` → `_projectDirHint`. `_updateProjectDirs()` 가 위 규칙으로 `.gpr` 을 고르고
  라이브러리 확장은 종전과 같다. 로그 `프로젝트 폴더 확정(projectDir | 프로젝트명 일치): …`.
- `deployService` ERROR CHECK: `│ ✔ ErrorLog empty (snapshot right after Start — later runtime errors arrive via GPL Console / debug events)`.

### 조치 — 트리 「코드 오류」의 Error 쓰레드 행이 아무 상호작용도 없던 문제 (같은 세션, 사용자 스크린샷)

- 종전: `InfoNode('🔴 name', …, contextValue 'errorThread')` — 명령 없음, `errorThread` 에 걸린 메뉴도 없음 → 클릭·복사·위치 이동
  전부 불가. 「환경 경고」(`sysErrorItem`) 행도 클릭(상세 보기)만 되고 복사 메뉴가 없었다.
- 이제 Error 쓰레드는 **쓰레드 섹션과 같은 `ThreadNode`**(새 인스턴스)로 넣는다 → 클릭 = 에러 위치(`threadShowLocation`), 우클릭 =
  Show Stack / Continue(NoError) / Stop / 정지 불가 진단, 인라인 복사. `copyError` 는 툴팁이 문자열이면 **툴팁**을 복사(이름·State·Status·
  File:line, 에러 항목은 해석·권장 조치까지). 복사 메뉴 `when` 을 `errorItem|sysErrorItem|errorChainItem|gplThread-error` 로 확장.

### 검증

- `npm test` 968/968(신규 7건 포함, 구조 R1~R7 통과 — `compileUnitTarget` 은 `project` 계층에서 `language`·`util` 만 의존).
- **실워크스페이스·실기 미검증** — 확인 항목은 §3 (인덱싱 시간 로그 읽기, `project_target` 고정 후 예외 위치가 `Dilution` 사본인지).

### 남은 일

- §3 4건: 인덱싱 실측, 동명 소스 실기 확인, package.json 버전 역행 정리(사용자 결정), 제어기 `-200` 조사(확장 밖).
- §2 (2026-09-02, §1-CU) `indexWorkspace()` 전역 상한 — 이번 변경으로 파일당 비용이 파싱만 남아 상한의 필요성은 낮아졌다. 결정은 그대로 대기.

---

## 1-DY. 2026-09-21 세션 — "컴파일 검증 필요" 배지가 방금 작업한 프로젝트 대신 가장 오래된 것을 가리키던 문제

### 증상 (사용자 발견)

GenAdp 를 편집하고 Quick Compile 로 두 번 통과시키는 동안에도 하단 상태바 배지가 계속
`⚠ 컴파일 검증 필요: MergeCode` 였다. "왜 MergeCode 로 타겟이 잡혀 있냐"는 질문에서 출발했다.

### 원인 — 절반은 사양대로, 절반은 구현 편차

출력 로그의 시간순이 그대로 답이었다.

| 시각 | 사건 | 배지 |
| --- | --- | --- |
| 09:02 | MergeCode Quick Compile — 업로드는 성공, 쓰레드 14개 활성이라 **COMPILE 미수행**(`THREAD_CHECK`) | MergeCode 등록 |
| 09:03 | `Stop -all` 로 전부 정지 | 유지 (정지는 해제 조건이 아니다) |
| 09:20 | GenAdp Quick Compile 성공 ×2 | 유지 — 해제는 **컴파일된 그 프로젝트에만** |
| 10:00 | MergeCode Quick Compile 성공 | 해제 |

- 등록은 `activation/deploy.ts` 의 `markCompileStale(result.projectName, '<mode> 업로드 후 Compile 미수행(활성 쓰레드)')`,
  해제는 `host.clearCompileStale(projectName)` 로 **이름 단위**다. 여기까지는 맞다 — 그 구간 동안 MergeCode 의
  `/GPL` 소스는 실제로 컴파일본과 어긋나 있었고, 경고는 정확히 그걸 가리켰다.
- 문제는 **대표 항목을 고르는 규칙**이었다. `CompileStaleTracker.current()` 가 Map 의 **첫(가장 먼저 등록된)** 항목을
  돌려줘, 미검증이 둘 이상이면 방금 손댄 쪽이 아니라 제일 묵은 쪽이 배지를 차지한다. 배지가 하나만 표시되는
  구조(§1-DV)라 나머지는 아예 보이지 않는다.
- 여기에 **구현 편차**가 하나 더 겹쳐 있었다. `host.markCompileStale` 은 방금 표시한 항목을 배지에 바로 꽂는데
  (`statusBar.setCompileStale(info)`), `host.clearCompileStale` 은 `current()`(= 가장 오래된 것)로 되돌린다. 같은 배지가
  어느 경로로 갱신됐느냐에 따라 최신을 가리켰다 옛것으로 되돌아가는 셈이다.

### 조치 — `controller/compileStale.ts` 한 곳만

사용자 선택은 "가장 최근 등록된 것"(활성 에디터는 보지 않는다 — 배지가 따라다니면 오히려 산만하다).

- `current()` = **가장 최근에 표시된 항목**. Map 의 마지막 값을 돌려준다.
- `mark()` 는 이미 있는 항목을 다시 표시할 때 `delete` 후 `set` 으로 **최근 자리로 승격**한다. `since`·`projectDir` 는
  종전대로 보존하므로 "언제부터 미검증인가"는 그대로다. 이 승격이 있어야 위의 구현 편차가 사라진다 —
  `markCompileStale` 이 꽂는 항목과 `current()` 가 고르는 항목이 항상 같아진다.
- `list()` 는 오래된 → 최근 표시 순(마지막이 `current`). AI 스냅샷(`aiDebugCommands.ts`)이 쓰는 순서다.
- 표시 문구·클릭 대상(`views/compileStaleBadge.ts`)과 해제 조건은 건드리지 않았다.

### 검증

- `npm test` **968/968**. `compileStale.test.ts` 2건 갱신 — ① 대표 = 최근 표시 항목, 재표시하면 승격(`list` 순서 포함)
  ② 최근 것을 해제하면 그 앞의 미검증 항목이 배지에 남는다(종전 테스트는 오래된 것부터 지우는 방향만 봤다).
- 실기 미검증(상태 추적은 순수 모듈이라 제어기와 무관하다). UI 확인은 미검증 프로젝트를 2개 만들어
  (쓰레드 살린 채 A·B 를 각각 Quick Compile) 배지가 **나중에 한 쪽**을 가리키는지 보면 된다.

### 남은 일

- 미검증이 2개 이상일 때 **나머지를 알 방법이 없다** — 배지도 트리 "프로젝트 상태"도 대표 1건만 보여 준다.
  "외 N개" 표기와 클릭 시 목록 선택은 이번 선택에서 보류했다(사용자: 최근 것만으로 충분). 여러 프로젝트를
  번갈아 배포하는 작업이 늘면 그때 다시 꺼낸다.

---

## 1-DZ. 2026-09-21 세션 — 식별자 안의 키워드에 색이 칠해지던 문제 (`SyncSub` 의 `Sub`)

### 증상 (사용자 스크린샷)

`…\Binder\projects\GenAdp\Lib_Net\Protocol\TcpProtocol.gpl:65` 의 필드 두 줄에서 식별자 **중간부터** 색이 바뀌었다.

```gpl
Public SyncSub As TcpSyncCmdSub
Public AsyncSub As TcpAsyncCmdSub
```

### 원인 — 선언 규칙이 줄 머리에 고정돼 있지 않았다

`syntaxes/gpl.tmGrammar.json` 의 Sub 선언 규칙은 이랬다.

```
(?i)\s*((?:(?:Public|Private|…)\s+)*)(Sub)\s+([A-Za-z_][A-Za-z0-9_]*)
```

머리의 `\s*` 는 "들여쓰기를 허용한다"는 뜻으로 쓴 것이지만 **위치를 고정하지는 못한다**. TextMate(Oniguruma)는
줄 안 어디서든 매치를 찾고 **가장 앞에서 시작한 매치**를 채택하므로, 이 정규식은 수식어 그룹을 0회로 접고
`SyncSub` 안의 `Sub As`(= `(Sub)\s+(이름)`)에 그대로 걸린다. 결과는 `Sub` = `storage.type.function.gpl`(키워드 색),
뒤따르는 `As` = `entity.name.function.gpl`(프로시저 이름 색)이었다.

같은 모양을 쓰는 선언 규칙이 7개라 증상도 7종이었다 — 재현 줄(감사 스크립트로 확인):

| 줄 | 잘못 칠해진 것 |
| --- | --- |
| `Public SyncSub As TcpSyncCmdSub` | `Sub` = 키워드, `As` = 프로시저 이름 |
| `Public CallbackFunction As LogSink` | `Function` = 키워드, `As` = 프로시저 이름 |
| `Public ItemProperty As Integer` | `Property` = 키워드, `As` = 프로시저 이름 |
| `Public MaxConst As Integer` | `Const` = 키워드, `As` = 상수 이름 |
| `Public BaseClass As Object` | `Class` = 키워드, `As` = 클래스 이름 |
| `Public NetModule As Object` | `Module` = 키워드, `As` = 모듈 이름 |

(`Delegate` 규칙만 무사했다 — `Delegate` 뒤에 `Sub|Function` 을 반드시 요구해 우연히 조각에 걸리지 않았다.)

§1-DT 에서 새로 얹은 키워드 규칙들은 전부 `\b…\b` 라 멀쩡했다. 낡은 선언 규칙 7개만 이 보호가 없었다.

### 함께 발견한 것 — `As New <Type>`

`As` 규칙이 `\b(As)\s+(이름)` 이라 `Dim ex As New Exception` 에서 **`New` 를 타입 이름으로** 잡았다.
`New` 가 타입 색을 먹고 정작 `Exception` 에는 아무 색도 붙지 않았다(그 자리는 `As` 규칙이 이미 소비해
뒤의 `New` 규칙이 볼 수 없다). `samples/syntax-tour` 만 해도 `As New` 가 6곳이다.
한정 이름(`As New Xml.XmlDoc`)도 `Xml` 까지만 칠해졌다.

### 조치 (`syntaxes/gpl.tmGrammar.json`)

- **선언 규칙 7개를 `(?i)^\s*` 로 줄 머리에 고정**(Class·Module·Delegate·Sub·Function·Property·Const).
  GPL 선언은 언제나 줄 머리에서 시작하므로(줄 연속 `_` 로 쪼개도 다음 줄 머리다) 정상 선언은 그대로 잡히고,
  줄 중간의 낱말 조각은 **시작 위치 자체가 없어** 매치가 사라진다. `\b` 만 덧대는 것보다 규칙이 분명하고
  주석·문자열 안의 `Public Sub …` 같은 문구도 함께 막힌다.
- **`As` 규칙이 `New` 를 따로 잡는다**: `\b(As)\s+(?:(New)\s+)?(타입)` → `New` 는 `keyword.operator.new.gpl`,
  이름은 `storage.type.gpl`.
- **한정 타입 이름 지원**: `As`/`New`/`Inherits` 의 타입에 `(?:\.[A-Za-z_][A-Za-z0-9_]*)*` 를 붙여 `Net.LogSink` 를 한 덩어리로.
- **타입 참조 스코프 통일**: `New X`·`Inherits X` 가 쓰던 `entity.name.type.gpl` → `storage.type.gpl`.
  정의 이름(Class·Module·Delegate 선언)만 `entity.name.*` 를 쓴다는 규칙을 문법 머리 주석에 적어 두었다
  (같은 "타입 자리"가 `As` 뒤인지 `New` 뒤인지에 따라 색이 달라지던 것도 이걸로 사라진다).

### 재발 방지 (`src/test/grammar.test.ts`, +5건)

- **토큰화 근사**: 문법의 `match` 규칙만으로 TextMate 의 "가장 앞에서 시작하는 매치가 이긴다"를 흉내 내고
  `d`(hasIndices) 플래그로 **캡처의 실제 위치**를 얻는 `tokenize()`.
- `어떤 규칙도 식별자 안의 낱말 조각을 잡지 않는다` — 캡처의 앞뒤 글자가 낱말 문자면 실패. 대상은
  키워드로 끝나는 식별자 17줄 + `samples/syntax-tour` 전 줄. **이 테스트가 이번 버그의 정본 가드**다.
- `선언 규칙은 줄 머리(^)에 고정돼 있다` — comment 에 `declaration` 이 든 규칙은 `(?i)^\s*` 로 시작해야 한다(구조 검사).
- 신고 줄의 기대 토큰, `As New <Type>` 3형(기본·생성자 인자·한정 이름·`As` 없는 `New`), 타입 참조 스코프 통일.

`samples/syntax-tour/Declarations.gpl` 에 눈으로 대조할 줄을 하나 넣었다 — `Private SyncSub, AsyncSub As LogSink`.

### 검증

`npm test` **973/973**(968 → +5). 감사 스크립트로 수정 전/후 토큰을 비교해 위 표의 7종이 모두 사라지고
정상 선언(`Public Sub Main()`·`Public Overrides Function Describe() As String`·`Public Delegate Sub LogSink(…)`)의
토큰은 그대로임을 확인했다. 편집기 실표시(색)는 §3 항목.

### 남은 일

- 확장 파서 쪽은 같은 함정이 없다(확인함): `cursorExpression.matchProcedureHeaderKind`·`blockContext`·
  `gplParser` 의 선언 가드는 이미 `^` 로 고정돼 있고, `As New` 도 `declarationList.ts` 가 `isNew` 로 구분한다.
- 문법 파일의 `Inherits|Implements` 규칙은 GPL 에 없는 문(§1-DW 에서 공식 문서로 확인)이라 사실상 죽은 규칙이다.
  파서(`TYPE_POSITION_KEYWORDS`)가 보수적으로 남겨 둔 것과 보조를 맞춰 이번에는 지우지 않았다.

---

## 1-EA. 2026-09-21 세션 — 「오류 상세 보기」 로그가 겹쳐 쌓이던 문제 + 에러 코드 분류를 공식 범위 표 기준으로

### 증상 (사용자 발견)

「오류 상세 보기」를 누를 때마다 "직전 로그" 줄이 이렇게 깊어졌다.

```
- [main] - [main] - [main] - [main] - [main] [⚠ 환경 경고] [-757] GenAdp (-757): *Object not instantiated*
- [main] - [main] - [main] - [main] ─────────────────────────────────────────
```

### 원인 — 보고서가 자기 출력을 다시 먹는 고리

- `host.log` 는 **모든 줄**을 `[main] ` 을 붙여 링버퍼(`recentDebugLogLines`)에 넣는다.
- 그런데 `gpl.controller.showErrorDetail` 은 자기 보고서 약 25줄을 **그 `host.log` 로** 출력했다.
- 그래서 보고서 안의 `- [main] …` 줄이 버퍼에 들어갈 때 `[main] ` 이 한 겹 더 붙는다 → 누를 때마다 한 겹씩.
- 더 나쁜 것은 **보고서(25줄) > 창(10줄)** 이라, "직전 로그"는 구조상 **늘 직전 보고서 찌꺼기**만 보여 줬다.
  제어기에서 무슨 일이 있었는지는 한 번도 보인 적이 없다. 계단처럼 쌓인 `─────` 도 같은 이유다.

### 조치 ① — 출력 경로와 버퍼 분리 (사용자 선택: "Output 에 그대로, 링버퍼만 분리")

- `host.report(lines)` 신설 — Output·라이브 로그에는 쓰지만 **링버퍼에 남기지 않는다.** 보고서는 이걸로 나간다.
- 링버퍼를 `controller/recentEvents.ts`(순수 모듈)로 교체. 담는 것은 **제어기 사건만**이다(사용자 선택):
  - 빈 줄·배포 트레이스 장식 줄(`│ ↑ [52/71] …`, 박스/구분선)과 확장 내부 태그(`[SymbolCache]`·`[ProjectContext]`·
    `[Bridge]`·`[AI Setup]`·`[Trace]`·`[Watcher]`)는 제외. **deny-list** 로 둔 이유는 새 제어기 태그가 생겨도
    자동으로 들어오게 하기 위해서다(allow-list 는 빠뜨리면 조용히 빈 섹션이 된다).
  - 같은 문구가 **연달아** 오면 접어서 `(×N)` — `-757`/`-700` 처럼 폭주하는 에러가 창을 다 먹지 않게.
  - 표시 줄에 `HH:mm:ss` 를 붙인다(`formatControllerEvent`).
- 섹션 제목도 "직전 로그 (최근 10줄)" → **"직전 제어기 사건 (최근 10건)"**.

### 조치 ② — 에러 코드 분류를 공식 범위 표로 (사용자가 문서 링크로 지적)

보고서의 `분류: environment` 가 틀렸다. `-757 Object not instantiated` 는 공식 문서상 **Language Related Errors**다
(사용자 제시: `GPL_Error_Code/language_errors.htm`).

- 원인: `classifyErrorEntry` 가 코드별 힌트 표(`-782`·`-508`·`-2`)에 있는 것만 코드 오류로 보고 **나머지 전부**를
  `isControllerSystem: true`(환경 경고)로 떨어뜨렸다. 실제 런타임 에러 대부분이 여기 해당했다.
- `Error_Intro.htm` 의 범위 표를 `GPL_ERROR_GROUPS` / `getGplErrorGroup(code)` 로 들여왔다(2026-09-21 확인):
  `-200..-299` System · `-300..-499` Hardware · `-500..-699` I/O · `-700..-999` Language ·
  `-1000..-1499` Robot · `-1500..-1599` Config DB · `-1600..-1699` Controller · `-1700..-1799` Network ·
  `-2000..-2999` GPL 응용 프로그램 전용 · `-3000..-3999` Servo · `-4000..-4100` Vision.
- 분류 우선순위: **코드별 힌트(사람이 검토한 것) > 범위 표 > 미상.** 로봇·네트워크·비전은 코드/환경이 갈리지 않아
  `unknown` 으로 두고 **단정하지 않는다**(`isControllerSystem` 은 true 유지 — 종전의 보수적 동작 그대로).
- 라벨 정본 `describeErrorCategory`(코드 오류 / 제어기 환경 / 분류 미상)를 두고, 트리 버킷이 하드코딩하던
  `category: 'code'|'environment'` 를 **판정 결과 그대로 넘기도록** 고쳤다(같은 판단의 사본 제거). R7 표에 행 추가.

### 조치 ③ — 진입점 대조 (사용자가 건넨 분석 문서 반영)

사용자가 같은 `-757` 을 다룬 분석 문서(`GenAdp_-757_Init_이름충돌_분석_2026-09-21.md`, 다른 세션 작성)를
넘겨 줬다. 요지는 "라이브러리 클래스의 `Private Sub Init` 이 GPL 런타임의 스레드 시작 초기화 단계와
이름이 충돌해 인스턴스 없이 호출됐다"이고, 조치는 `Init` → `InitDefaults` 개명이다.

대조해 보니:

- 문서가 든 관측은 단단하다 — `Show Stack GenAdp` 가 **`Init` 프레임 하나뿐**이고 `MAIN`·`New` 가 없다.
- 더 단순한 경쟁 가설(**`.gpr` 의 `ProjectStart` 오설정**)을 먼저 확인했는데 **기각**됐다:
  GenAdp 의 `Project.gpr` 은 `ProjectStart="ORCH_Main.MAIN"` 으로 제대로 들어가 있고 `Public Sub MAIN` 도 있다.
  공식 문서(`Console_Commands/start.htm`)는 `Start` 가 *"the project-start procedure from a compiled project"* 를
  실행한다고만 한다 — 그렇다면 최하단 프레임은 `MAIN` 이어야 하는데 아니었다.
- 다만 문서 스스로 밝히듯 **메커니즘은 미확정**이고, 개명 뒤 `Start` 는 사용자가 수행하기로 해 **수정 효과도 미검증**이다.
  그래서 확장에는 "`Init` 이름을 쓰지 말라"는 규칙을 넣지 않았다.

확장이 확실히 도울 수 있는 것은 **사실의 불일치**다. `controller/startProcedureCheck.ts`(순수, 테스트 4건):

- `.gpr` 의 `ProjectStart`(한정자 제거)와 **스택 최하단 프레임**을 대소문자 무시로 비교한다.
- 다르면 오류 상세 보고서에 `⚠ 진입점 불일치: … 시작 프로시저가 한 줄도 실행되지 않았을 수 있습니다` 한 줄.
  **원인은 말하지 않는다**(테스트가 문구에 "초기화 단계" 가 들어가지 않음을 강제한다) — 하드 규칙 3.
- 같거나 재료(스택·ProjectStart)가 없으면 조용하다. 모름을 경고로 바꾸면 신호가 죽는다.
- `-757` 을 코드별 힌트에 추가했다(`Object not instantiated`, category `code`) — 권장 조치에 이 대조를 적어 둔다.
- `.gpr` 의 `ProjectStart` 읽기는 `projectPicker.readGprProjectStart`(`readGprProjectName` 과 같은 자리).

### 조치 ④ — GPL Console 에 `<E>2`·`<E>0` 이 찍히던 문제 (사용자 관측)

사용자 콘솔 로그에 정체 불명의 줄이 반복됐다.

```text
[13:38:08] <E>2
[13:38:45] <E>0
[13:38:51] <E>0
```

**재현으로 확정했다**(`out/` 빌드에 `normalizeConsoleLine` 직접 호출):

```text
"<E>2</E>"    ->  "<E>2"      ← 억제되지 않고 `</E>` 만 떨어져 나감
"<E>1,4</E>"  ->  ""          ← 종전 규칙이 아는 형태
```

원인은 억제 규칙이 `/^<E>\d+,\d+<\/E>$/` 로 **두 숫자 형태만** 알고 있었던 것이다. 단일 숫자 프레임은
그 뒤의 `msg = s.replace(/<\/E>$/, '')` 를 타고 `<E>2` 라는 찌꺼기가 되어 그대로 출력됐다.

- `captures/gde_1403.pcapng` 의 `<E>…</E>` 395프레임은 **전부 `<E>1,N</E>`** 이다(1,4 ×290, 1,1 ×75, 1,3 ×15,
  1,2 ×10, 1,0 ×5). 단일 숫자 형태는 우리 참조 데이터에 없다 — 제어기/펌웨어 차이로 보이나 **의미는 미확정**이다.
- 사용자 로그의 등장 위치(Start 직전 `<E>2`, 전원 투입 요청·에러 직후 `<E>0`)는 `Start … -event` 의 쓰레드
  상태 변화 신호와 맞아떨어지지만, 숫자의 뜻은 확인되지 않았다.

조치 — 판정 정본 `responseParser.isConsoleStatusEventFrame` 신설(`/^<E>\d+(?:,\d+)*<\/E>$/`):

- **숫자와 콤마만 있는 프레임은 전부 상태 이벤트**로 본다. 사람이 읽을 메시지는 `<L>len</L>` 뒤에만 오므로
  숫자만 든 프레임에 로그가 실릴 수 없다 — 형태를 하나씩 추가하는 대신 이 성질로 일반화했다.
- `normalizeConsoleLine`(억제)과 `runtimeConsole.emitConsoleFrame`(폴 트리거 발사)이 **같은 정본**을 쓴다.
  종전에는 두 곳이 같은 정규식을 따로 들고 있었다.
- **미지 형식은 조용히 버리지 않는다**: 캡처에 없던 형태(`1,N` 이 아닌 것)는 세션당 형식마다 한 번
  `[Console][RC1403] EVENT=STATUS_FRAME form=<E>2</E> (…의미 미확정…)` 으로 상태 줄에 남긴다 — 하드 규칙 3.

### 조치 ⑤ — `Init` 충돌을 실기로 확정 (`samples/init-probe`, 사용자 제안)

"hello-project 로 간단히 테스트해 볼 수 있지 않나"는 제안에서 `samples/init-probe`(형제 폴더, 모션 없음)를 만들었다.
사용자가 함께 짚어 준 공식 문서 GPL/modules.htm 이 결정적이었다:

> If a user Sub procedure named **Init** is defined within a module, it is executed as part of the module initialization,
> **before the startup procedure begins.** / An internal Sub procedure named **`_Init`** is automatically generated … Do not attempt
> to create a procedure with this name.

| 단계 | 내용 | 결과 |
| --- | --- | --- |
| A | `Module Main` 에 `Public Sub Init` + `Sub Main` (레거시 꼴) | Start → 정상 종료(Idle @ Main). 콘솔 순서는 1403 에서 확인(문서대로면 Init → Main) |
| B | `Module ProbeLib` 안 `Public Class Probe` 의 **`Private Sub Init()`**(첫 문장 `m_buf = ""`) + 다른 모듈의 `Sub Main` | **재현.** `Start init_probe -compile -event` → 스레드 Error `-757 *Object not instantiated*` @ `StageB_ClassInit.gpl:24`(Init 1행), `Show Stack` = `0, init_probe, Init, 1, StageB_ClassInit.gpl, 24` — **Init 1프레임, 호출자 없음, Main 미실행.** GenAdp 스택과 동일 |

즉 문서화된 훅(모듈 수준 `Sub Init`)의 이름 조회가 **클래스 경계·`Private` 을 보지 않는다** — 문서에 없는 날카로운 모서리.
다른 세션의 분석 문서(조치 ③)가 관측으로 짚은 결론이 맞았고, 이제 미확정이 아니다.

곁다리 실측: `Module Lib` → `-719 *Illegal use of keyword* Lib` — **`Lib` 은 예약어**(정본 `gplReservedWords.ts` 에 추가).

확장 반영:

- `language/initHook.ts`(순수, 테스트 4건) → `diagnosticProvider.detectInitHookIssues`. 클래스 멤버 `Init` = **warning**(Sub/Function),
  `_Init` = error, 모듈 수준 `Sub Init` = **hint**(Problems 에 안 올라감 — 레거시의 빈 `Public Sub Init` 은 합법 훅이라 소음이면 안 된다).
  진단은 기존 게이트 `gpl.diagnostics.experimental`(기본 off) 뒤에 있다.
- `-757` 코드별 힌트와 `startProcedureCheck` 의 진입점 불일치 문구가 진입점이 `Init` 일 때 **원인을 말한다**(확정됐으므로 — 조치 ③ 의
  "원인 단정 금지" 문구·테스트를 갱신).
- 실험 절차 메모: `deploy_project(build)` → `start_project` 는 Compile 을 두 번 한다(Start 의 `-compile`). Stage B 는 `upload-start` 로 한 번에 갔다.
  두 번째 `upload-start` 는 브리지 응답이 240 s 타임아웃했지만 `operation_status` 는 **2초 만에 COMPLETED** — 응답 파일 전달 문제(§3).
  `upload-start` 의 Start `-compile` 컴파일 에러(-742)는 `compileErrors: []` 로 와서 Problems 로 점프하지 못했다(§3).

### 조치 ⑥ — 에러 UI 세 가지 (사용자 지적: 강조가 깜빡 사라짐 · 클릭 이동 불안정 · 복사 내용 빈약)

원인은 서로 얽혀 있었다.

1. **노란 강조가 칠해진 직후 사라짐** — `debugDecorations.ts` 가 `onDidChangeTextDocument` 에 **필터 없이** 두 강조를 다 지웠다.
   Output 채널(`output:` 스킴)도 TextDocument 라 이 이벤트를 내므로, `threadShowLocation` 이 `showStopped()` 바로 다음 줄에서
   `[Thread] … 정지 위치` 로그를 찍는 순간 자기 손으로 지운 셈이다. 5초 폴링 로그·1403 콘솔 줄도 같은 경로. 이제 **칠해진 그 문서의
   실제 편집**(`contentChanges.length > 0`)만 지운다.
2. **클릭 이동이 "불안정"하게 느껴진 것** — 같은 모양의 행이 다르게 움직였다. Error **쓰레드 행**은 `threadShowLocation` 으로 파일을
   열지만, 「코드 오류」 섹션의 **에러 항목**은 `showErrorDetail` 이 보고서만 찍고 파일을 열지 않았다. 여기에 1 이 겹쳐 열려도 강조가 없으니
   이동했는지 알 수 없었다. 이제 에러 항목 클릭도 최상단 프레임(`Show Stack` → 없으면 목록 위치)으로 **이동 + 붉은 강조** 뒤 보고서를 찍는다.
3. **복사 내용 빈약** — `copyError` 가 트리 항목 **툴팁**을 복사했다(쓰레드 행 4~6줄, 에러 항목 1~3줄). 상세 보기 보고서와 재료가 달랐다.
   → 렌더러를 순수 모듈 `controller/errorReport.ts`(`renderErrorReport`, 테스트 4건)로 빼고, `gatherErrorReport` 한 함수가 재료를 모아
   **상세 보기와 복사가 같은 줄**을 쓴다. 복사물은 마크다운(제목 `## 오류 상세 — GenAdp -757 *Object not instantiated*`, 원문·코드·분류(문서상 그룹)·
   스레드 상태·프로젝트/ProjectStart·위치·직전 명령·첫 시각·해석/권장·진입점 불일치·스택(안쪽→바깥쪽)·관련 함수·직전 제어기 사건 10건·버전/시각).
   재료가 없는 항목(추정 체인)은 종전처럼 툴팁/라벨을 복사한다. 모르는 값은 "(미확인)" — 지어내지 않는다.

`toErrorDetailPayload` 가 트리 요소 세 종류(에러 InfoNode 의 `command.arguments[0]`·ThreadNode 의 `thread`·직접 payload)와 문자열을
하나로 정규화한다. 남긴 비대칭 하나: Error 쓰레드 **행** 클릭은 여전히 `threadShowLocation`(노란 강조), 에러 **항목** 클릭은 붉은 강조 —
색이 갈린다. 쓰레드 행도 `showErrorDetail` 로 보내 통일할지는 사용자 판단(정지 쓰레드 행과의 일관성 문제).

### 조치 ⑦ — `ByVal`/`ByRef` 위에서 호버가 비던 문제 (사용자 지적: "자료 레퍼런스가 안 뜬다")

호버 제공자는 내장 항목(`findGplBuiltin`)·수신자 멤버·사용자 심볼·내장 클래스 문서만 봤다. 키워드 표 `GPL_KEYWORDS`(`language/gplStatements.ts`)는
**완성 목록 전용**이라, `ByVal`/`ByRef` 를 비롯한 키워드·원시 타입·낱말 연산자·상수 위에서는 호버가 `undefined` 였다 — 문서 링크가 빠진 게 아니라
카드 자체가 없었다.

- `GplKeyword` 에 `documentation?`(마크다운, 문서 근거 규칙만)·`sourceUrl?`(공식 페이지) 추가, `findGplKeyword(name)`(대소문자 무시) 추가.
  표 **전 항목**에 `sourceUrl` 을 채웠다 — 2026-09-21 curl 로 존재 + 본문에 그 낱말이 실제로 언급되는지 확인한 페이지만
  (Statement Dictionary `Sub/Dim/Property/ForNext/redim/Delegate/IfThenElse.htm`, 소개 절 `data_type_and_variables`(Basic Data Types 표)·
  `scope_names`·`objectvariablenewclause`·`arithmeticexpressions.htm`).
- `ByVal`/`ByRef` 본문은 `Sub.htm`(생략 시 ByVal · ByVal 은 복사본, ByRef 는 호출자 변수 직접 참조 · 둘 다 지정 불가)과
  `objectsasprocedurearguments.htm`(객체는 ByVal 이어도 **값 포인터**라 `Loc.X = 20` 은 호출자에게 보이고 `Loc = New Location` 만 안 보임 —
  ByRef 는 **변수 포인터**라 교체까지 보임)에서 옮겼다. 문서 예 `add_sub(4, 5, a)` → `a = 9` 도 그대로.
- `providers/hoverProvider.ts`: `buildKeywordHover`(머리말 `GPL Keyword/Primitive Type/Operator/Constant` · detail · `---` documentation · `[Reference]`).
  분기는 **마지막 폴백** — 사용자 심볼·내장 클래스 문서 뒤(`String` 은 클래스 카드가 더 풍부해 그쪽이 먹는다), 수신자 있는 멤버 이름(`obj.Step`)과
  점 표기에는 띄우지 않는다. compact(디버그 중 opt-in)면 한 줄만. 완성 목록(`completionProvider`)과 같은 표를 읽으므로 설명이 갈릴 수 없다.
- 하지 않은 것: 문 머리(`If`·`For`·`Sub`·`Dim`…)의 호버 → 남은 일.

### 검증

- `npm test` **1000/1000**. 신규 27건 — `gplStatements.test.ts` 3건(`findGplKeyword` 대소문자·표 밖 낱말, `ByVal`/`ByRef` 재료(documentation·Sub.htm·객체 인자 링크), 전 항목 `sourceUrl`),
  `errorReport.test.ts` 4건(제목·재료 전부·미확인 표기·-782 후보), — `initHook.test.ts` 4건(클래스 멤버 warning·모듈 hint·`_Init` error·대소문자/비선언 무시), `startProcedureCheck.test.ts` +1(Init 원인 문구), — `recentEvents.test.ts` 5건(사건 판정·중복 접기·상한·표시 줄),
  `responseParser.test.ts` 4건(범위 경계·`-757`/`-700` 코드 분류·환경/미상·힌트 우선),
  `startProcedureCheck.test.ts` 4건(한정자 제거·최하단 프레임·불일치 문구·조용한 경우),
  `responseParser.test.ts` 2건(상태 이벤트 프레임 판정·정규화 억제).
- 실기 미검증(순수 모듈). UI 확인은 「오류 상세 보기」를 **연속 두 번** 눌러 `[main]` 이 겹치지 않는지,
  "직전 제어기 사건"에 배포/Stop/Compile 같은 줄이 오는지 보면 된다.

### 남은 일

- **`<E>2`·`<E>0` 의 의미 확정.** 이제 콘솔에는 안 뜨지만 상태 줄에 관측 기록이 남는다. 다음에 실기에서
  `Show Thread` 결과와 프레임 숫자를 같은 시각으로 대조하면(쓰레드 수인지, 상태 코드인지) 확정된다.
  확정되면 `isConsoleStatusEventFrame` 주석과 §5 참고에 적는다.
- **`Init` 충돌은 확정됐다(조치 ⑤). 남은 확인 둘.** ① Stage A 의 1403 콘솔 순서가 문서대로 `PROBE A: Init` → `PROBE A: Main` 인지
  (사용자 GPL Console 에서 눈으로 — 확장에 콘솔 줄을 되읽는 명령이 없다). ② GenAdp 는 `Init` → `InitDefaults` 개명 뒤 `Start` 로 `-757` 이
  사라지는지 사용자 확인. 방증: 13:22 postmortem 의 다른 프로젝트 쓰레드 `WTR_1` 도 프로시저 `Init`(MergeCode.gpl:1331) 에서 `-705` 로 멈춰 있었다.
- **제어기 뒷정리**: 실험 뒤 `init_probe` 스레드가 Error(-757) 상태로 남아 있다(`/GPL/init_probe` 도 남음). 사용자 결정 뒤 `Unload init_probe`.
- **트리 「환경 경고」 버킷의 이름**이 `unknown` 항목까지 담고 있어 여전히 절반만 맞다. 세 번째 버킷을 만들지,
  "코드 오류로 단정하지 않음" 류로 제목을 바꿀지는 UI 결정이 필요하다.
- **문 머리 키워드 호버**(`If`·`For`·`Sub`·`Dim`·`Try`…)는 아직 없다(조치 ⑦은 `GPL_KEYWORDS` 표만). 재료는 `GPL_STATEMENT_SNIPPETS` 의
  `detail`/`documentation`/`sourceUrl` 에 이미 있으니, 같은 머리의 변형(If 2종·For 2종…)을 한 카드에 어떻게 묶을지만 정하면
  `buildKeywordHover` 옆에 붙는다.
- 범위 표는 **문서상** 분류다(§0 하드 규칙 3 — Brooks 문서는 가설). 실기 응답과 어긋나는 코드가 나오면
  코드별 힌트에 추가해 범위 표보다 우선하게 한다.

---

## 1-EB. 2026-09-22 세션 — 클래스 이름 참조 찾기가 선언 파일 밖을 통째로 놓치던 문제 (자기-참조 필드)

### 증상

사용자가 실제 프로젝트(`GenAdp`)에서 `App\Control\Machine.gpl:65` 의 `Class MachineRobot` 선언에 커서를 두고
**모든 참조 찾기**를 실행했는데 결과가 **선언 한 줄뿐**이었다. 같은 프로젝트의

- `App\Host\Commands.gpl:65` — `Private g_robot As MachineRobot`
- `Main.gpl:101` — `g_machine = New MachineRobot(g_robot, g_sys, …)`

가 빠졌다. 반대로 **사용부**(`As MachineRobot`)에 커서를 두고 실행하면 5건이 나왔다. 사용자 trace:

```
[References] word="MachineRobot" qualifier=N/A defScope=ROB.MachineRobot access=public file=Machine.gpl
[References] results: local=1, workspace=0, scopeFallback=0, scopeFallbackRan=true, total=1   ← 선언에서 실행
[References] word="MachineRobot" qualifier=N/A defScope=N/A
[References] results: local=2, workspace=0, scopeFallback=3, scopeFallbackRan=true, total=5   ← 사용부에서 실행
```

### 원인 — 파서의 자기-참조 필드를 raw 로 읽었다

파서는 `Class` 심볼의 `className` 에 **자기 이름**을 넣는다(`gplParser.ts`: `currentClass` 를 갱신한 뒤 push).
`receiverType.ts` 가 이 비대칭을 명시하고 `enclosingClassName`/`enclosingModuleName` 정본을 두고 있는데
(§1-CR 에서 만든 것), `referenceProvider` 만 raw 필드를 읽고 있었다:

```ts
const targetClass = defSymbol?.className;   // Class MachineRobot → 'MachineRobot'
```

그 결과 클래스 선언이 **"자기 자신의 멤버"** 로 분류됐다(`isClassMember`). 이 분기의 전제는 "멤버는 다른 파일에서
`obj.Member` 로 쓰인다" 이므로

- 워크스페이스/프로젝트 검색은 `한정자.MachineRobot` 패턴만 돌고,
- 비한정 이름 검색은 **정의 파일 안으로 제한**된다(`shouldRestrictUnqualifiedToDefFile`).

`As MachineRobot`·`New MachineRobot(...)` 은 둘 다 비한정이라 다른 파일에서 전부 탈락했다. `New …` 가 빠진 것은
생성자(`Sub New`) 소유 문제가 아니라 같은 원인이다 — 생성자에서 실행하는 참조 찾기(`buildConstructorUsagePattern`)는
그대로 동작하고 있었다.

**F2(이름 바꾸기)가 같은 경로를 탄다**는 점이 더 위험했다. `renameProvider` 는 참조 수집을 항상 정의 위치에서
`provideReferences` 로 한다 — 즉 **클래스 이름 바꾸기가 선언 파일만 고치고 다른 파일에 옛 이름을 남겨** 컴파일이
깨지는 상태였다(이번 수정 전까지, 사용자 피해 보고는 없음).

### 조치

1. **`referenceProvider` 의 스코프 판정을 공용 정본으로 교체** — `enclosingModuleName`/`enclosingClassName`
   (`providers/referenceProvider.ts`). 클래스 선언은 이제 모듈 레벨 심볼로 분류돼 (a) 비한정 전역 검색과
   (b) `모듈.클래스` 한정 검색을 함께 돌린다. `Private Class` 는 종전 규칙대로 정의 파일로 제한된다(모듈 스코프).
   모듈 심볼도 `모듈.모듈` 이라는 무의미한 질의를 더 이상 만들지 않는다.
2. **사용부에서 실행해도 같은 스코프를 쓰게** — `recoverTypeUsageDeclaration` 추가. `As X`/`New X`/`As New X` 판정은
   순수 모듈 `language/referenceSyntax.ts` 의 `isTypeUsageAt` 이 맡고, 맞으면 캐시에서 타입 선언(Class/Module)을
   복원한다. 선언·사용부 어디서 실행해도 컴파일 단위 기준점(`unitReference`)과 결과가 같아진다.
3. **`renameProvider` 의 이름 충돌 검사도 같은 정본으로** — 종전 비교(`s.className === sym.className`)는 클래스를
   바꿀 때 **그 클래스의 멤버**를 충돌로 보고하고, 정작 모듈 레벨의 진짜 충돌은 놓쳤다.

### 검증

- `npm test` **1002/1002** (신규 2 케이스 4 단언군: `isTypeUsageAt` 이 `As`/`New`/`As New` 를 인정하고
  선언(`Class X`)·멤버 접근(`obj.X`)·한정 표기(`As ROB.X`)·`bias X` 같은 부분 일치를 제외하는지).
- 구조 테스트 **R7**(판정 정본 우회 금지) 통과 — 소속 판정은 `receiverType` 하나.
- 실기 프로젝트에서의 재확인은 사용자 편집기 몫(§3 항목 추가).

### 덧붙임 — 패널의 「전체 쓰레드 복사」 (같은 세션, 사용자 제안)

종전에는 쓰레드 목록을 통째로 복사할 방법이 「Copy Situation」(연결·배포·FTP·브레이크포인트까지 한꺼번에)뿐이었다.
쓰레드만 붙여넣고 싶을 때 쓸 것이 없어 명령 하나를 추가했다.

- `gpl.controller.copyThreads` — "Copy All Threads (전체 쓰레드 복사)". 쓰레드 섹션 컨텍스트 메뉴(`threadSection@6`)와
  명령 팔레트에서 실행한다. 복사 직전에 `refreshAll()` 로 한 번 갱신해 화면보다 낡은 목록이 붙지 않게 한다
  (「상황 복사」와 같은 방식). 등록은 `activation/consoleCommands.ts`.
- 표 렌더러를 순수 모듈 **`controller/threadReport.ts`** 로 뽑았다 — `renderThreadTable`·`summarizeThreadStates`·
  `countThreadStates`. **상황 스냅샷의 `## 쓰레드` 절도 같은 렌더러를 쓴다**(errorReport 와 같은 취지: 보이는 것과
  복사되는 것이 갈라지지 않게). 표 컬럼은 이름·상태·STATUS·프로젝트·위치(`file:line`)·프로시저(`func:procLine`)·
  `Timing(-stack)` — 종전 상황 스냅샷의 4컬럼(이름·상태·프로젝트·파일)보다 넓어졌다. `Timing` 은 컬럼 의미가
  Brooks 도움말에 없어 raw 표기 그대로 싣는다(하드 규칙 3).
- **R7 에 규칙 한 줄 추가**(쓰레드 표·상태 집계) → 곧바로 세 번째 사본이 걸렸다: `controller/controllerStatus.ts` 의
  `threadSummary` 가 `Paused || Break` 집계를 따로 구현하고 있었다(MCP `controller_status` 가 쓰는 값). 정본으로
  교체 — 이제 패널 요약·상황 스냅샷·MCP 가 같은 기준으로 센다.
- `npm test` **1006/1006** (신규 `threadReport.test.ts` 4 케이스: 집계·`-` 처리·미연결/빈 목록 구분·머리말 필드).

### 덧붙임 2 — 로그 문자열이 참조로 잡히던 문제 (같은 세션)

사용자가 `Sub ClearError()` 의 참조를 찾았더니 **`LOG.WriteEx(ex, "STA.ClearError")` 가 결과에 섞였다**.
`"Mod.Proc"` 모양의 문자열을 전부 프로시저 참조로 인정하고 있었기 때문이다(§1-T 에서 `New Thread` 관용구를
지원하며 들어온 규칙이 모양만 보도록 일반화돼 있었다).

사용자 정리가 판정 기준을 그대로 준다 — `New Thread("NPU.WorkerLoop",,"TCPCMD")` 는 런타임이 그 문자열로
프로시저를 찾으므로 참조지만, 로그 인자는 그냥 출력이다. 그래서 **"소비되는 자리"** 를 조건으로 넣었다.

- `language/referenceSyntax.ts` 에 소비자 표 `SYMBOL_STRING_CONSUMERS`(현재 `New Thread(procedure_name, …)` 의
  0번 인자 하나 — 근거는 GPL Dictionary 의 생성자 매개변수 설명)와 `findSymbolStringConsumerAt(lineText, quoteIndex)`.
  리터럴 앞을 거꾸로 훑어 **같은 깊이의 콤마를 세며** 감싸는 호출의 `(` 를 찾고, 머리와 인자 번호가 표와 맞을 때만
  참조로 본다. 그래서 같은 호출의 세 번째 인자(`thread_name`)도 자동으로 빠진다.
- 적용: 참조 찾기(`isSymbolicStringReferenceAt`)와 **이름 바꾸기**(`renameCore.findStringLiteralRenameOccurrences`).
  F2 는 되돌리기 어려운 편집이라 같은 기준으로 좁혔다 — 로그 문자열은 이제 F2 로 바뀌지 않는다.
- **F12 는 종전대로** 모양만 맞으면 점프한다(사용자가 그 자리를 직접 누르는 읽기 전용 동작). 그래서
  "F12 가 가는 문자열 = F2 가 바꾸는 문자열" 이라던 `renameCore` 의 설명은 낡아서 고쳤다.
- 한계: 프로젝트 자체 래퍼(`Lib.Spawn("Mod.Proc")`)는 표에 없으니 참조로 세지 않는다(오탐보다 누락을 택했다).
  필요해지면 설정으로 표를 늘린다. 줄 이음(`_`)으로 호출 머리가 윗줄에 있어도 같은 이유로 세지 않는다.
- 회귀 테스트: 인자 번호·중첩 호출·대입문·`Dim … As New Thread` 인식, 그리고 사용자 사례 두 줄 그대로.
  종전 테스트 하나(`New Thread("Mod.SaveThread",, "SaveThread")` 가 2건)는 **기대값이 바뀌었다** — 세 번째
  인자는 런타임 라벨이라 1건이 맞다.

### 덧붙임 3 — 제어기 채널을 번호가 아니라 이름으로 (같은 세션, 사용자 결정)

"1402·1403 을 이제 명칭으로 부르자". 화면·알림·명령 제목·설정 설명·보고서·MCP 지침에 포트 번호가 그대로
노출돼 있었다("1402 미연결", "1403 콘솔").

- 용어 정본 **`controller/channelNames.ts`** — `명령 콘솔`·`런타임 콘솔`·`FTP`, 기본 포트, `channelWithPort`
  (`명령 콘솔(1402)`)·`channelEndpoint`(`명령 콘솔 192.168.0.1:1402`). 표기 규칙(번호를 붙이는 세 자리)도
  이 파일의 머리말에 적었다. 하드 규칙 §0-8 에 요약.
- 바꾼 곳: 트리(`명령 콘솔`·`통신 모니터`·`런타임 콘솔`), 상황/진단/사후 스냅샷 머리글, 연결 유실 알림·로그 문장,
  `package.json` 의 명령 제목 2개와 설정 설명 다수, README, 디버그 어댑터 로그 문장, MCP `SERVER_OVERVIEW`.
- 그대로 둔 곳: 로그 태그(`[1402]`·`[Console][RC1403] STATE=…` — 기계가 읽는 접두어라 바꾸면 기존 로그·문서와
  어긋난다), 설정 키(`keepAlive1402`), 포트 자체가 주제인 문서(`docs/reference/console-commands.md`), 과거 기록.
- **구조 테스트 R8** 추가: `package.json` 의 명령 제목에 `1402`/`1403` 이 있으면 실패. 눈에 가장 잘 띄는 문구부터
  못 되돌아가게 막는다(전 범위를 기계로 막으려면 "사용자 대면 문자열" 을 판별해야 해 과했다).
- `npm test` **1014/1014** (기대 문구를 쓰던 테스트 2건도 함께 갱신 — 런타임 콘솔 트리 툴팁, reachability 판정문).

### 남은 일 / 알려진 한계

- **한정 표기 위에서 실행하면 한정형만 모은다.** `As ROB.MachineRobot` 의 `MachineRobot` 에 커서를 두면
  `shouldPreferQualifiedOnly` 가 켜져 `ROB.MachineRobot` 만 찾는다(멤버도 같은 정책). 타입은 한정/비한정이 같은
  대상을 가리키므로 합치는 쪽이 맞지만, 멤버 정책까지 함께 바뀌므로 이번엔 건드리지 않았다(§3).
- 클래스 이름과 **같은 이름의 멤버**가 있으면 비한정 검색 결과에 섞일 수 있다(컴파일 단위 안). 모듈 레벨 심볼이
  원래 갖던 수준의 오탐이다.

---

## 1-EC. 2026-09-22 세션 — library 중심 프로젝트의 breakpoint source identity 수정

### 증상과 실측

사용자 보고서 `GPL_breakpoint_lookup_report_2026-09-22.md`의 GenAdp 실측에서 다음이 확인됐다.

- 메인 `.gpr`의 평면 source는 `Set Break GenAdp "Main.gpl"69`로 성공했다.
- 직접 하위 source `ProjectSource="App\Host\Commands.gpl"`는 basename `Commands.gpl`로 보내면 `-508`,
  `.gpr` 원문 경로 `App\Host\Commands.gpl`로 보내면 성공했고 `Show Break`가 `OnMotion, 2`로 연결됐다.
- `ProjectLibrary`의 `Loop.gpl`은 library `ProjectName`, 메인 기준 경로 등 시험한 모든 표기가 `-508`이었다.
- 과거의 미해석 record는 `proc=?`, `procLine=0`인데도 같은 tuple 재설정 시 `-775 Duplicate breakpoint`를 냈다.
  따라서 STATUS 0이나 `-775`만으로 실제 instruction resolution을 판정할 수 없다.

기존 구현은 에디터 동기화와 AI 명령에서 무조건 `path.basename`을 사용했고, DAP도 basename을 먼저 보낸 뒤
상대경로를 추측했다. 명령 parser도 경로를 basename으로 버려 같은 이름의 다른 폴더 source를 구분하지 못했다.

### 조치

- 순수 정본 `project/breakpointTarget.ts` 신설: 메인 `.gpr`의 직접 `ProjectSource` 원문과
  `ProjectLibrary` graph를 절대경로로 대조해 `direct-source | library-source | outside-project`를 반환한다.
- 에디터 실시간 동기화·push/reconcile, AI `setBreakpoint/clearBreakpoint`, DAP source breakpoint가 같은 resolver를 쓴다.
  직접 source만 명령을 만들고 library source는 controller에 보내지 않은 채 promotion 명령을 안내한다.
- `breakpointCommand` parser와 mirror/reconcile key가 project-relative 전체 경로를 보존한다. `/`와 `\`, 대소문자만
  정규화하며 `App\Host\Commands.gpl`과 `Other\Commands.gpl`은 서로 다른 위치로 취급한다.
- 에디터/AI/DAP의 `Set Break`는 뒤이어 `Show Break`에서 project/file/fileLine과 함께 `proc != ?`,
  `procLine > 0`까지 확인한다. `-775`인데 기존 record가 미해석이면 같은 identity를 `Nobreak`한 뒤 한 번 재설정한다.
  DAP는 `Show Break` 검증을 못 했거나 procedure에 연결되지 않은 항목을 `verified: false`로 내린다.
- 동기화 호환 경로(F9 add/remove, 연결 후 reconcile, AI/콘솔 mirror, Pull, DAP ownership)를 다시 추적했다.
  Pull이 제어기 중단점을 빨간 점으로 추가할 때 미러 에코를 먼저 기록해, 실시간 동기화가 이미 존재하는 중단점에
  `Set Break`를 중복 전송하지 않도록 했다. `proc=?`/`procLine<=0` record는 Pull에서도 해석 불가로 제외한다.
  1402 명령은 기존 전역 직렬 큐를 공유하며 DAP 활성 중에는 에디터 동기화가 멈춘다.

### 검증과 남은 일

- `npm test` **1011/1011**. 신규 resolver 3건 + 경로 identity·미해석 record 회귀 테스트 보강.
- 제어기에 명령은 보내지 않았다. GenAdp에서 직접 하위 source 명령 경로, library source의 무전송,
  `Show Break` procedure 검증은 §3의 실기 항목으로 남겼다.

## 1-ED. 2026-09-29 세션 — 개요 「커서 따르기」가 클릭한 심볼을 놓치던 문제: 블록 범위를 파서의 짝 `End` 줄로

### 증상 (사용자 신고)

개요(Outline)에서 「커서 따르기」를 켜고 함수 등을 클릭하면 커서가 안 움직이는 것처럼 보이고,
개요 선택이 자꾸 원래 항목으로 되돌아온다. 함께 "기본적인 언어 개요 기능도 검토해 달라"는 요청.

### 원인

클릭 → 커서 이동 자체는 VS Code 코어가 한다(개요 클릭 → `selectionRange` 시작으로 selection 설정,
`outlinePane.ts`/`documentSymbolsOutline.ts` 확인). 문제는 직후의 「커서 따르기」 — 코어는 **커서를
감싸는 심볼을 `DocumentSymbol.range` 포함 관계로** 찾는데, 우리 provider 의 블록 범위가
"다음 동급 심볼 직전까지" 휴리스틱(`findSymbolEndLine`)이라 형제 범위가 겹쳤다.

- 클래스 범위가 "다음 Class 선언 직전"까지라서 **파일의 마지막 클래스는 문서 끝까지** 늘어나,
  클래스 뒤 모듈 레벨 Sub/Function 을 전부 삼켰다. 그런 심볼을 클릭하면 커서는 옮겨지지만 감싸는
  심볼 탐색이 (겹친 범위의) 클래스로 풀려 개요 선택이 곧장 그리로 되돌아간다 — 첫 클릭 후에는
  커서가 이미 목표에 있으므로 재클릭해도 아무 변화가 없어 "커서가 안 움직인다"로 체감된다.
- **중첩 클래스**(GPL 정식 문법 — `samples/syntax-tour/Shapes.gpl`)에서는 반대로 바깥 클래스 범위가
  안쪽 `Class` 선언 직전에서 끊겨, 그 뒤에 오는 바깥 클래스 멤버들(Shapes 의 Count·Init·Bump 등)이
  부모 range 밖의 children 이 됐다. 중첩 클래스 자체도 모듈 직속 형제로 잘못 배치됐다.
- Property 는 블록(`Get/Set … End Property`)인데 한 줄 범위였다 — getter/setter 본문에 커서가 있으면
  개요가 Property 를 못 찾고 클래스로 올라갔다.

### 조치

- **파서(`language/gplParser.ts`)**: 블록 심볼(Module/Class/Sub/Function/Property)에 `endLine`
  (짝 `End …` 의 물리 줄, 0-기준) 기록. 열린 블록 심볼 스택(`openModule`/`openClasses`/`openProcs`)을
  기존 `classStack`/`blockDepth` 와 나란히 유지하고, `End` 의 **종류가 맞을 때만** 짝으로 기록한다 —
  End 누락·종류 불일치 소스에서는 `undefined` 로 남긴다(끝 줄을 지어내지 않음).
- **개요(`providers/documentSymbolProvider.ts`)**:
  - 블록 범위 = 선언 줄 ~ `endLine` 줄 끝(End 줄 위에 커서가 있어도 그 블록으로 인식).
    `endLine` 이 없으면(입력 중 등 짝이 아직 없음) 종전 휴리스틱으로 폴백.
  - Property 를 블록 심볼에 포함.
  - 중첩 클래스를 `parentClassName` 기준으로 바깥 클래스의 children 으로(종전: 모듈 직속).

### 검증

- `npm test` **1017/1017** — 신규 `src/test/blockEndLine.test.ts` 3건(정상 짝·중첩 클래스·짝 불일치/누락·enum 문자열 고정).
- `Shapes.gpl` 실측 덤프: Counter 13→120, 중첩 Snapshot 31→39(parent=Counter), Property/Sub/Function 전부
  짝 `End` 줄과 일치 — 형제 범위 겹침 해소. (종전: Counter 13→30 조기 절단, Snapshot 31→문서 끝)

### 남은 일

- F5 개발 호스트에서 「커서 따르기」 클릭이 클릭한 항목에 머무는지 실확인 (§3).
- 폴백 휴리스틱(`findSymbolEndLine`)은 중첩 클래스를 모른 채 남아 있음 — `endLine` 이 없는
  비정상 소스(입력 중)에서만 쓰이므로 유지. 개요 계층의 클래스/모듈 맵이 이름 키라 한 파일 안
  동명 클래스는 뒤엣것에 붙는 한계도 종전대로(발생 사례 없음).

## 1-EE. 2026-09-30 세션 — 업로드 진행 바: 출력 패널에 쌓이는 로그 대신 상태바에서 제자리로 움직이는 바

### 계기 (사용자 요청)

배포/업로드 때 출력에 찍히는 파일별 로그와 별개로, 하단에 **줄이 중첩되지 않고 애니메이션처럼** 움직이는
`██████████████████████████████  10.7 MB / 10.7 MB` 꼴의 진행 표시를 원했다.

### 판단

- 출력 패널(`OutputChannel`)은 한 번 쓴 줄을 제자리에서 고칠 수 없다(`\r`·ANSI 무시, `replace()` 는 전체 교체) —
  거기서 흉내 내면 줄이 쌓인다. 제자리 갱신이 되는 곳은 **상태바 항목**(글자 교체)·알림 진행(`withProgress`)·
  Pseudoterminal 셋. 요청의 "하단·텍스트 바" 에 가장 가깝고 배포 로그와 역할이 겹치지 않는 상태바를 택했다
  (알림은 VS Code 고유 바라 블록 문자를 못 그리고, 터미널은 패널이 하나 더 생긴다).
- 바이트 단위 진행: 종전 `onProgress` 는 파일 개수만 줬다. basic-ftp 5.3 의 `Client.trackProgress` 가 전송 중 소켓
  바이트를 0.5초마다(시작·끝 즉시) 주므로(전송 건별 값, `type: 'upload' | 'download' | 'list'`) 그것을 잇고, 파일
  크기는 루프 전에 한 번 `stat` 해 분모를 먼저 안다.
- 분모 = 로컬 대상 파일 크기 합. 스킵(내용 동일) 판정이 루프 안에서 SIZE 조회·SHA-1 로 이뤄져 미리 걸러내면
  왕복이 두 배라, 스킵된 파일은 그 시점에 완료로 더한다(바가 스킵 구간에서 단숨에 뜀 — "프로젝트 중 얼마가
  원격과 같아졌나" 로는 정직).

### 조치

- **`src/controller/uploadProgress.ts` 신설(순수)** — 집계 정본. `UploadProgressTracker`(begin → transferred… → end /
  스킵은 end 만; begin 없는 바이트는 무시 → 목록 조회 전송이 섞여도 안 움직임; 전송분은 파일 크기로 잘라 검증 실패
  재전송(0 부터 다시)에도 넘치지 않음) + `UploadProgress`/`UploadProgressEvent`/`UploadSummary` 타입.
- **`src/views/uploadProgressBar.ts` 신설(순수)** — 표시 정본(`views/compileStaleBadge` 와 같은 나눔: 의미는 controller,
  모양은 views). `renderBar`(20칸, 경계 칸은 `▏▎▍▌▋▊▉` 1/8 부분 블록, 총량 0 은 가득)·`formatBytesPair`(total 단위로
  통일: `3.2 MB / 10.7 MB`)·`renderUploadProgress`·`describeUploadProgress`(툴팁: 파일 수·현재 파일 — 이벤트 종류로
  "전송 중:"/"완료:"/"동일:" 구분)·`renderUploadSummary`(`업로드 완료 10.7 MB (3 전송 · 44 동일)`, 전송 0 이면 "변경 없음").
- **`src/util/formatBytes.ts` 신설(순수)** — 바이트 표기 정본(`formatBytes`/`formatBytesAs`/`byteUnitFor`; B 정수·그 위 소수
  1자리 고정 — 자릿수가 흔들리면 글자가 떨린다; GB 까지). 트리의 `views/treeFormat.formatSize` 를 지우고
  `controllerTreeProvider` 가 이것을 쓴다(종전 기대값 그대로 + GB·음수 클램프). `architecture.test.ts` R7 에
  두 행(바이트 표기 · 진행 바/완료 문구) 추가, `architecture.md` §3.2.1 표도 SSOT_RULES 와 다시 맞춤.
- **`ftpClient.ts`** — `uploadProject`/`mirrorProject` 가 루프 전에 `LocalUploadEntry[]`(경로·상대경로·크기)를 만들고
  tracker 를 돌린다. `onProgress` 시그니처가 `(current, total, file, action)` → `(event: UploadProgressEvent)`
  (`type: 'file' | 'bytes'`). `trackUploadBytes` 가 `type === 'upload'` 만 집계, `finally` 에서 `client.trackProgress()` 로
  핸들러를 떼고 닫는다. **루프 전 크기는 진행 집계에만** 쓰고 해시·업로드 검증(SIZE 대조)·지문은 파일 차례에 다시
  `stat` 한 값을 쓴다(종전과 동일) — 앞 파일들을 올리는 동안 저장된 파일이 "크기 불일치" 로 실패하지 않게.
  `totalBytes` 값·스킵 판정·지문 키·순서는 종전과 같다.
- **`deployService.ts`** — `onDidUploadProgress: vscode.Event<DeployUploadEvent>`(`progress` / `end ok|fail`). 배포가
  어느 경로로 시작됐든(명령·F5 `deployBeforeAttach`·autoOnSave·MCP) 같은 이벤트가 나가므로 표시는 한 곳만 구독한다
  (`deployRecord.onDidRecordCompiled` 와 같은 꼴, 호출부마다 콜백을 꿰지 않음). 파일 완료마다 잠금 heartbeat + 전송분만
  `│ ↑ [n/total] file` 로그(종전과 동일), 바이트 갱신은 로그에 안 찍힘.
- **`views/connectionStatusBar.ts`** — `uploadItem`(왼쪽, 우선순위 95) + `setUploadProgress(progress, projectName)` /
  `endUpload({ok, summary|message})`. 완료 2.5초·실패 5초(경고색) 남겼다 숨김. 진행 표시가 한 번도 안 뜬 실패
  (FTP 접속 불가)는 배포 알림에 맡기고 **아무것도 건드리지 않는다**(직전 완료 문구의 숨김 타이머까지). 타이머는 새 진행·dispose 에서 정리.
- **`activation/deploy.ts`** — `activateDeployCommands` 가 이벤트를 한 번 구독해 상태바로. Save to Flash 는
  deployService 를 거치지 않으므로 `mirrorProject.onProgress` 에서 같은 API 를 직접 부른다.
- 디버그 어댑터는 `DebugAdapterInlineImplementation`(같은 프로세스)이라 F5 배포도 같은 이벤트로 잡힌다.

### 검증

- `npm test` **1026/1026** — 신규 `uploadProgress.test.ts` 3건(tracker: 스킵 즉시 완료·크기 클램프·begin 없는 바이트 무시·
  재전송·스냅샷 크기로 done == total), `uploadProgressBar.test.ts` 5건(단위 통일·바 경계/넘침/총량 0·1/8 부분 블록·본문/툴팁
  전송 중/완료/동일·완료 요약), `formatBytes.test.ts` 2건(종전 treeFormat 크기 테스트 이관 + GB·음수). 구조 테스트
  R1~R8 통과(새 모듈은 순수, `views → controller/util` 방향, R7 행 2개).
- **적대적 리뷰**(워크플로: basic-ftp 연동·이벤트/수명주기·표시/API 호환·저장소 관례 4관점 → 지적마다 반박 검증, 13 에이전트).
  확인돼 반영한 것: ① 사전 stat 크기를 해시·SIZE 검증·지문에 재사용해 "파일 저장 중 배포" 가 크기 불일치로 실패하는 경쟁
  (종전 ms → 업로드 전체로 넓어졌던 것, 위 ftpClient 항목) ② `endUpload` 가 무시할 실패에서도 타이머를 지워 직전 완료
  문구가 안 사라지던 것 ③ 스킵 구간 툴팁이 "전송 중: <스킵 파일>" 이던 것 ④ `formatBytes` 가 `treeFormat.formatSize` 의
  사본(DRY) ⑤ 표시 규칙이 controller 에 있던 배치(§5·§1-DV 선례와 어긋남) ⑥ 정본이라면서 R7 행이 없던 것.
  반박돼 버린 것: §3 항목에 F5/MCP 경로 추가(세 경로 모두 같은 `deploy()` 로 수렴), §3 허용 목록 표에 EventEmitter 언급(표의
  성격상 불필요). basic-ftp 쪽은 `type === 'upload'` 정확·`list` 전송은 걸러짐·`trackProgress()` 해제 확실·재전송 시
  바 잠깐 후퇴 후 복귀로 확인.
- 제어기에는 명령을 보내지 않았다. F5 실표시(글자 폭·타이밍)는 §3.
- CRLF 파일(`ftpClient.ts`·`connectionStatusBar.ts`)의 줄바꿈 유지 확인(`git ls-files --eol`).

### 남은 일

- §3 항목(F5·실기 확인, 바 폭·autoOnSave 깜빡임 정책).
- 업로드는 여전히 취소 불가(`CancellationToken` 이 FTP 루프까지 안 감) — 취소가 필요해지면 상태바 항목 클릭에 얹을 수 있다.

## 1-EF. 2026-10-02 세션 — 다중 프로젝트 워크스페이스의 AI Setup 내보내기·자동 점검

### 증상·원인

`Sample Prep`에는 제외 규칙 적용 후 Project.gpr 66개(시작점 지정 16개), 동명 MergeCode 3개가 있다.
종전 Export는 활성 파일의 가장 깊은 프로젝트, 없으면 최장 경로를 기본 이름으로 저장했다. 라이브러리를
기본 대상으로 저장해도 점검은 번들·등록 경로·CLAUDE 버전만 검사해 정상으로 통과했다. 실제 .mcp.json/CLAUDE는
GenAdp, AGENTS의 구버전 안내는 Lib_NetServer를 가리켰다.

### 조치

- `activation/aiAgentSetup`: 활성 파일 추측을 제거하고 기존 `resolveProjectTarget` 재사용. 세션 폴더 → 저장된
  명시 폴더를 유지하며 나머지 선택 규칙은 기존 자동화와 같다. 대상이 모호하면 빈 기본값으로 설정을 내보내고
  「설정 정상 · 작업 대상 미확정」을 표시한다. 프로젝트 선택은 기존 picker를 쓰되 선택한 workspace root 후보로 한정한다.
- `.mcp.json`: 이름과 `GPL_PROJECT_DIR`을 함께 기록. 기존 다른 서버·사용자 환경변수·CLAUDE 본문과 줄바꿈 보존.
  Export가 실패하면 완료 자동 점검을 실행하지 않는다. multi-root는 저장할 root를 명시/선택하고 첫 root를 임의로 쓰지 않는다.
- `ai/agentSetupChecks`: Node 단독 검사. 실행 파일·args·type·HOST/PORT·프로젝트 이름/폴더·안내 누락/잘린 블록·
  버전/주소/대상 불일치(AGENTS 포함)를 검사한다. report의 `settingsOk`, `target`, `warnings`, `ready`/`ok`를 구분한다.
  미확정은 설정 실패로 취급하지 않지만 준비 완료도 아니다. 수동 안내와 AGENTS는 변경하지 않고 점검 결과로 알린다.
- `controller-mcp/configuredTarget`: 미설정 legacy 기본값은 유지하되 빈 GPL_PROJECT는 MergeCode로 폴백하지 않는다.
  GPL_PROJECT_DIR 키가 있는 새 Export 설정은 project_target에서 브리지로 폴더를 확인하기 전 프로젝트 도구를
  PROJECT_TARGET_REQUIRED(sent:false)로 거부한다. 브리지 검증 실패도 성공으로 보고하지 않는다. 다른 대상은 다시 고정해야 한다.
  project_target 요청은 폴더/파일 경로로 VS Code 창을 선택한다. 원시 controller_command의 기존 계약은 변경하지 않았다.
- AI 계층이 순수 controller 대상 해석·util 경로 정본을 쓰도록 architecture 문서/검사 표 갱신. README 사용 흐름 추가.

### 검증

- `npm test`: 1045/1045. 검사 회귀 13건 + 실제 Export 명령/메모리 파일 시스템 6건 추가(라이브러리 열린 상태,
  세션/재실행 폴더 유지, 동명 폴더, multi-root, 실패 후 보존, 다른 서버·환경변수·CRLF 보존).
- `controller-mcp npm test`: 102/102(설정 대상 보호 4건 추가).
- 실제 MCP 도구 핸들러 + 가상 전송: 확인 전 Compile/Start 거부, project_target 폴더/창 라우팅,
  확인 후 이름 사용, clear 후 재거부 — 5 시나리오 통과. 실제 TCP 명령 0건.
- `npm run bundle:mcp`: 로컬 번들 생성. 실제 Sample Prep 66개 후보로 Export 명령을 메모리에서 실행:
  라이브러리가 열려 있어도 빈 기본값/대상 미확정, Dilution 폴더 명시 시 이름+폴더 확정, AGENTS 충돌은 경고 유지. 실제 파일 쓰기 0건.

### 남은 일

- §3의 F5 UI 확인. 설치·실기·Sample Prep의 실제 Export/안내 수정은 수행하지 않았다.

## 1-EG. 2026-10-02 세션 — 누적 작업 트리의 대화 기록 대조·커밋 정리

### 계기

기준 커밋 `0ac3978` 뒤로 §1-DR~§1-EF의 여러 작업이 한 작업 트리에 누적돼 있었다. 사용자가 채팅 기록을
살펴보고 Git 커밋도 정리해 달라고 요청했다. 코드·테스트·문서가 세션 사이에서 겹치므로 날짜별 커밋을
억지로 재현하지 않고, 현재 최종 상태에서 독립적으로 검토할 수 있는 책임 단위로 나눴다.

### 정리한 커밋

| 커밋 | 범위 |
| --- | --- |
| `4634348` | 언어 분석·파서·문법 강조·문서화 주석·샘플과 관련 테스트 |
| `04ebdbc` | 세션 대상 프로젝트 해석·중단점 source identity·디버거 연동 |
| `5fbe230` | 제어기 오류 보고·채널 용어·쓰레드 표·컴파일 배지·FTP 업로드 진행 상태 |
| `0692c9d` | 다중 프로젝트 AI Setup·설정 점검·MCP project target 확인 |
| 이 문서 커밋 | 테스트 등록·package 0.9.11·README/CHANGELOG·아키텍처·인계 기록 |

분리 과정에서 기존 작업 내용을 수정하거나 되돌리지 않았고, 제어기 명령·F5 창 실행·패키징·배포는 하지 않았다.

### 검증

- 루트 `npm test`: **1045/1045 통과**(TypeScript compile 포함).
- `controller-mcp`의 `npm test`: **102/102 통과**.
- `git diff --check`: 공백 오류 없음. Git의 LF→CRLF 경고는 저장소/working-tree 줄바꿈 설정에 따른 안내이며,
  기존 파일 내용을 일괄 변환하지 않았다.

### 남은 일

- §3에 기록된 F5 UI·실기기·패키징 검증은 그대로 남아 있다.
- 원격 push·태그·릴리스는 수행하지 않았다.
