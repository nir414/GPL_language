# AI 인계 자료 — GPL Language Support 확장 작업 핸드오프

- **최종 갱신: 2026-09-10** · 현재 package 버전 **0.9.6** (태그 `v0.9.0` — CI `release.yml`이 빌드·패키징·릴리즈)
- **직전 세션: §1-DQ** — **명령 UI 정리(사용자 지시).** 패널 `···` 메뉴가 "어지럽다"는 지적에서 기여 명령 81개를 전수 대조했다. 제목에 박혀 있던 `GPL:` 63개를 `category:"GPL"` 로 분리(VS Code 는 category 를 팔레트에서만 붙이고 메뉴에서는 뗀다), 제목을 **영문 원어 + 한국어 병기**로 81개 통일, 팔레트에서 36개 숨김(트리 인자 필수 25 + AI 진입점 11 — 눌러도 조용히 아무 일도 없던 것들), 패널 오버플로 22 → 14(부분집합·트리 중복 제거, 새로고침은 상단 아이콘, 콘솔 4종은 트리 항목으로). `aiCommandPolicy` 의 표시 이름은 package.json 과 대조하는 테스트로 고정했다. 확장 912/912.
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
  BP 가 회색이 되고 **툴팁에 "ProjectLibrary 로 참조된 하위 프로젝트(…)의 소스라 …" 안내**가 뜨는지,
  Output 에 그 파일당 1회만 찍히는지. ⑥ 같은 파일에 BP 를 여러 개 찍었을 때 Traffic 의 `Set Break` 왕복이
  파일당 1회씩만 나가는지(`_bpRejectedFiles` 단축). ⑦ **(별도 실험)** 메인 `Project.gpr` 에
  `ProjectSource="Lib_Net\TcpServer.gpl"` 를 직접 등재하고(`ProjectLibrary` 줄은 제거) 재컴파일 →
  그 파일에 `Set Break` 가 STATUS 0 으로 되는지. 되면 안내 문구를 단정형으로 고칠 것.
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
.vscode/launch.json                      # F5 개발 호스트 — --profile=GPL-DevHost(기본 설정·확장 없는 격리 창) + samples/hello-project 를 연다 (§1-BP)
samples/hello-project/                   # 개발 호스트용 최소 GPL 프로젝트(Project.gpr + Main.gpl). 제어기 없이 언어 기능 확인용, VSIX 미포함 (§1-BP)
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
src/debug/spontaneousPause.ts             # 사용자 액션 없이 관측된 Paused 판별(vscode 무의존) — GPL 의 Paused 는 Thread.Sleep 대기도 포함하므로 등록 BP 위치 일치 = 즉시 정지, 그 외 3폴·1500ms 연속 = 외부 정지, 나머지는 무시(가짜 브레이크 차단) (§1-CK)
src/controller/debugBridge.ts            # 디버그 세션 ↔ 확장 이벤트 버스 + RuntimeConsoleHealth 공급자(1403 alive → 백업 폴 완화) (§1-BI) + onDebugProbeResult(어댑터 폴 결과 → 연결 건강 모니터, §1-BK)
src/views/refreshThrottle.ts             # 트리 FTP/시스템 정보 자동 재조회 스로틀 판정(순수) (§1-BI, #22)
src/debug/launchJsonc.ts                 # launch.json JSONC 읽기/부분 갱신(jsonc-parser) — 주석·포맷 보존 upsert (§1-BI, #30)
controller-mcp/src/batch.js              # MCP controller_command 배치 runBatch/normalizeCommandInput (§1-BI, #16)
src/controller/trafficResponseBody.ts    # ResponseBodyStreamer — 1402 응답 본문 줄 단위 스트리밍·상한 생략 요약(§1-BG, vscode 무의존 순수 모듈)
src/controller/deployService.ts          # deploy() = 잠금 획득 → UPLOAD ∥ STOP/THREAD_CHECK(settle 게이트 — 항상 병행, §1-DL) → COMPILE → START(직전 정지 재확인 §0.6) → ERROR CHECK(§1-BD 재배치), tryCompile, directGpl(§1-G), COMPILE_DEFERRED, findProjectDirs(**/*.gpr)
src/controller/projectPickerCore.ts      # 프로젝트 폴더 선택 순수 규칙 — orderProjectDirs(최근 선택 우선)·projectDirFromResource(폴더 자체/.gpr/포함 파일)·filterDirsByProjectName (§1-BL, vscode 무의존)
src/controller/projectPicker.ts          # 공용 선택기 pickProjectDir(Detailed)(QuickPick·workspaceState 최근 선택)·readGprProjectName/projectNameOf·context key gpl.projectDirs(탐색기 메뉴) — 명령·F5 provider 공용 (§1-BL)
src/controller/projectNameGuard.ts       # 프로젝트명/Load 경로 안전성 단일 규칙(vscode 무의존) — 1402 명령은 공백 구분·인용 불가 → 공백·제어 문자 검출 checkProjectName/checkRemotePath·안내 문구 describeProjectNameProblem; deploy/Start/ftpRun·Unload/F5 attach/MCP proj()가 공유 (§1-BQ)
src/debug/activateDebug.ts               # DebugConfigurationProvider — 중복 세션 처리 + fillProjectTarget(다중 프로젝트 QuickPick, projectDir/projectName 보충) (§1-BL), InlineDebugAdapterFactory
src/controller/deployLock.ts             # 배포 잠금 — 메모리+파일(%TEMP%/gpl-controller/<ip>.lock.json), pid/heartbeat stale 자동 만료, describeDeployLock (§1-BD, 이슈 #15·#17)
src/controller/ftpClient.ts              # uploadProject onlyFiles, mirrorProject deferDelete + removeRemoteFiles(§1-BD), 지문 스킵 판정(§1-BV)
src/controller/syncManifest.ts           # 업로드 지문(SHA-1) 매니페스트 — 미러/skipUnchanged 스킵 판정(§1-BV, globalState)
src/controller/breakpointReconcile.ts    # 에디터↔제어기 중단점 수렴 계획(vscode 무의존) — controllerTargets(프로젝트 필터·미확정 제외)/planReconcile(toAdd·toRemove·kept)/orphanControllerBreakpoints(트리 ⚠ 표시) (§1-CJ)
src/controller/breakpointCommand.ts      # BP 명령 문자열 계층(vscode 무의존) — formatBreakpointCommand(무공백 표기 단일 출처)/parseBreakpointCommand(무공백·문서 표기 해석)/MirrorEchoMemory(미러발 에디터 변경 TTL 기억) (§1-CO)
src/controller/breakpointMirror.ts       # 제어기→에디터 중단점 미러 — AI(MCP·URI·콘솔)가 건 BP를 빨간 점으로. 외부 진입점에서만 동작(DAP·EditorBreakpointSync 제외), 설정 mirrorAiBreakpoints (§1-CO)
src/controller/responseParser.ts         # parseStatus, parseCompileErrors
src/debug/showVariableParser.ts          # Show Variable 파싱 — 2열 Location 멤버(isTypeToken)·summarizeLocation·annotateLocationMember(§1-BF)
src/language/receiverType.ts             # 멤버 접근 수신자 타입 정적 해석(resolveReceiverHolder·membersNamed·buildDocumentReceiverLookup) + 소속 판정 ownedByHolder·nestedTypesIn(정의찾기 전역 폴백 차단용, §1-CA) — 디버그 hover 게이트·정적 hover 공용(§1-BJ, #32, vscode 무의존)
src/ai/exportAgentSetup.ts               # Export/Check AI Agent Setup — 사본 sha256 동기화(syncStableBundleIfStale)·inspectAiAgentSetup·CLAUDE.md 블록 버전 표식(§1-BF)
src/views/controllerDashboardPanel.ts    # 제어기 대시보드 웹뷰 — setInterval/pause/config 메시지(§1-BF); HTML은 media/dashboard.html
controller-mcp/src/parse.js              # MCP 파서 — parseThreadList(이름 키)·compactThread·summarizeThreads·parseShowVariable(§1-BF)
scripts/bundle-mcp.js                    # MCP 번들 + 빌드 스탬프(define __GPL_MCP_BUILD_JSON__, 사이드카 .build.json)(§1-BF)
src/debug/gplDebugSession.ts             # attachRequest, _runDeployBeforeAttach(lockOwner 'F5 Deploy'), _waitDeployLockForStart, getDebugDeployDiagnostics
src/extension.ts                         # activate()/deactivate() — 배선만(195줄). ExtensionHost 생성 → activation/*.ts 의 activateXxx(host) 를 종전 순서로 호출 (§1-CZ)
src/activation/host.ts                   # ExtensionHost — 클로저가 공유하던 서비스(채널·심볼 캐시)·가변 상태(트리·상태바·런타임 콘솔·건강 모니터·디버그 여부·마지막 스냅샷)·헬퍼(log·배포 잠금·컴파일 검증 상태·런타임 콘솔 싱글톤·연결 상태 반영·Agent Bridge)·하위 API(project/connection/deploy/decorations). **가변 상태는 항상 host.x 로 읽는다** (§1-CZ)
src/activation/deploy.ts                 # gpl.deploy/uploadStart/start/saveToFlash/quickCompile + autoOnSave + 자동화 대상 해석·게이트 — runDeploy/runDeployCore(969줄 — 결과 보고부는 controller/deployOutcome.ts) (§1-CZ, §1-DB)
src/activation/connection.ts             # 연결 건강 모니터 배선·유실 처리·사후 스냅샷·connect/disconnect(대화형+비대화형)·launch.json·startQuickAttachSession(attachOnly=배포 없이 붙기, §1-DC)·debugProject(배포+붙기 — 대상은 QuickPick·우클릭, §1-DQ)
src/activation/projectContext.ts         # 기대 프로젝트 감지·launch.json 읽기·GPL 파일명→경로 해석(resolveGplFilePath) — host.project (§1-CZ)
src/activation/controllerOps.ts          # busy 재시도·정지 확인(§0.6)·SoftEStop 복구·정지 진입 대기(waitForThreadPause) — host 를 첫 인자로 (§1-CZ)
src/activation/debugDecorations.ts       # ExecutionDecorations — 정지 줄/에러 줄 강조 한 객체 (§1-CZ)
src/activation/{languageFeatures,xmlCommands,breakpointCommands,consoleCommands,aiAgentSetup,aiDebugCommands,controllerCommands,treeCommands,ftpCommands,debugIntegration,uriHandler}.ts  # 명령 그룹별 activateXxx(host) — 본문은 종전 extension.ts 그대로 (§1-CZ)
src/controller/threadArgs.ts             # asThreadNode — 쓰레드 명령 인자 정규화(순수) (§1-CZ)
src/controller/stepCommand.ts            # buildStepCommand — Step 명령 조립 정본(트리·AI API 공용, 순수) (§1-CZ)
src/util/pathKey.ts                      # 경로 동일성 키 normalizePathKey·normalizeDirKey·isPathUnder(파일·폴더 공용 단일 규칙, vscode 무의존) — controller/projectPickerCore 에서 분리(§1-CQ, §1-DB)
src/language/identifiers.ts              # ciEq — GPL 식별자 대소문자 무시 비교(vscode 무의존, 종전 config.ts) (§1-DB)
src/project/gprSync.ts                   # Project.gpr 파싱/소스 목록 동기화 순수 로직(vscode 무의존, 종전 controller/) — 명령 래퍼는 controller/gprSyncCommand.ts (§1-BW, §1-DB)
src/controller/deployOutcome.ts          # 배포 결과 보고 순수 규칙 — SituationDeploySnapshot 정의·결과 서명/이력·ErrorLog 분류 로그·COMPILE 원문 로그·실패 문구 4분기(vscode 무의존, 종전 activation/deploy.ts 클로저) (§1-DB)
src/views/treeFormat.ts                  # 트리 표시 포맷(크기·날짜·연결 통계, vscode 무의존) (§1-DB)
src/views/runtimeConsoleTreePresentation.ts  # 1403 콘솔 트리 행 문구(라벨·description·아이콘·툴팁·불안정 판정·가설, vscode 무의존) — 알림용은 controller/runtimeConsolePresentation.ts (§1-DB)
src/test/architecture.test.ts            # 구조 회귀 테스트 — vscode 의존 허용 목록·계층 의존 방향·런타임 순환·테스트 등록·package.json↔명령/설정 키 (§1-DB, 규칙 근거는 docs/development/architecture.md)
src/controller/aiCommandPolicy.ts        # AI/자동화 경로에서 거부할 명령 목록(정본) — 되돌릴 수 없는 명령만. 브리지·URI·명령 자체가 함께 본다 (§1-DA)
controller-mcp/src/deployLock.js         # 잠금 파일 읽기 전용 구현(확장과 파일 계약 공유) — Compile/Start/Load/Unload 유한 대기·거부(§1-BD)
src/language/gplParser.ts                # Property/Sub/Function 파싱 + parseDocument 메모이즈 캐시(§1-B E) + docComment 수집(§1-J)
src/language/gplBuiltins.ts              # 핵심 빌트인/String 함수 (Trim→메서드, Rnd(seed), Replace 제거, Asc/Chr/… 추가) + Bit 문자열 전역함수(§1-J)
src/language/gplDictionaryData.ts        # Move/Robot/Location/Profile/.../String 클래스 사전 + Controller/Thread/Exception/File/XML/Network 등 +153(§1-J)
src/providers/completionProvider.ts      # 정적 항목 캐시, 트리거('.', '&')
src/providers/definitionProvider.ts      # token 확인 + parseDocument 재사용
src/providers/hoverProvider.ts           # token 확인 + docComment 표시(§1-J)
src/providers/signatureHelpProvider.ts   # Signature Help(빌트인+사용자 Sub/Function, §1-J 신설)
src/symbolCache.ts                       # 심볼 캐시 + 완성 문서화(buildSymbolDocumentation, §1-J) — 파일 항목 키는 normalizePathKey(원본 표기는 항목에 보관), .gpr 소스 합집합도 같은 키(§1-CQ)
src/language/symbolLocations.ts          # 정의 peek 목록 정리(vscode 무의존) — dedupeSymbolLocations(같은 파일·줄 병합)/preferExistingFiles(없는 파일 제외, 전부 없으면 원본 유지) + 존재 판정 정본 isMissingFile(ENOENT만 삭제로 본다)·fileExists(§1-CQ)
src/language/docComment.ts               # 문서화 주석 정본(vscode 무의존) — parseDocComment(섹션 별칭·펜스 인식)/renderDocCommentMarkdown(호버·완성·시그니처 공용)/buildDocCommentBlock·mergeDocComment(골격·머지). 원문은 손실 없이 보존하고 렌더에만 손보는 원칙: withFenceLanguage(펜스 언어 보정)·stripDecorativeRules(`====` 장식선 제거, §1-CS)
src/project/projectSources.ts            # "프로젝트에 속한 소스" 단일 출처 — 재귀 목록·ProjectSource 해석·소유 .gpr 선택(§1-BW, vscode 무의존) + 중첩 프로젝트 경계(stopAtNestedProject)·ProjectLibrary 해석(resolveProjectLibraryDirs)·관련 프로젝트 수집(collectRelatedGprPaths)(§1-BX)
src/project/projectFileScope.ts          # 참조 검색·심볼 인덱싱 공용 파일 범위(resolveProjectFileScope, PROJECT_EXCLUDE_GLOB)(§1-BW) — 라이브러리 양방향 확장(§1-BX)
src/providers/referenceProvider.ts       # scanDocumentText 라인별 스캔(ReDoS 완화) + 프로젝트 범위 폴백(§1-BW — findTextInFiles는 제안 API로 미사용)
.github/instructions/gpl-ai-controller-debugging.instructions.md  # 하드 규칙
```

---

## 5. 참고 — 정상 컴파일 응답 형식 (GDE, verbatim, 2026-06-30)

다음처럼

---

## 1. 세션 이력 — 최근 세션 + 전체 인덱스

본문에는 **최근 10개 세션**(§1-DE ~ §1-DN)만 둔다.
그 이전은 월별 아카이브에 원문 그대로 있다 — 아래 인덱스의 링크를 따라간다.

| 아카이브 | 범위 | 세션 수 |
| --- | --- | --- |
| [2026-06](archive/handoff/2026-06.md) | §1-A ~ §1-B (2026-06-30) | 2 |
| [2026-07](archive/handoff/2026-07.md) | §1-C ~ §1-AL (2026-07-03 ~ 2026-07-31) | 35 |
| [2026-08](archive/handoff/2026-08.md) | §1-AM ~ §1-CM (2026-08-05 ~ 2026-08-31) | 53 |
| [2026-09](archive/handoff/2026-09.md) | §1-CN ~ §1-DG (2026-09-02 ~ 09-10) | 21 |
| (본문 아래) | §1-DE ~ §1-DN (2026-09-10) | 10 |

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
| §1-DH | 09-10 | 컴파일 에러 시 Problems 패널로 전환되지 않던 문제 — 출력 채널 `show()` 가 패널 전환을 덮어쓰던 것을 점프 여부로 분기(`jumpToFirstCompileError` 가 boolean 반환) | 본문 ↓ |
| §1-DI | 09-10 | 정지 불가 쓰레드 진단 `controller/threadStuckDiagnosis.ts` 신설(읽기 전용) — 위치 반복 샘플링·소스 문맥·수신자 식 추출로 복구 후보를 **제시**(전송 안 함), 배포 STOP 실패 시 자동 + `GPL: 정지 불가 쓰레드 진단` 명령 | 본문 ↓ |
| §1-DJ | 09-10 | 연결을 해제해도 1402 소켓이 다시 열리던 문제 — 디버그 어댑터가 확장의 해제를 모른 채 1 s 폴로 재접속하던 것을 해제 전 세션 종료(terminated 대기)로 차단, `stopAllOnDisconnect` 는 모달 확인 | 본문 ↓ |
| §1-DK | 09-10 | MCP·확장 자동화 구조 개선 — 확장 인스턴스별 presence/큐 분리(창이 여럿일 때 요청이 뒤섞이던 원인), 배포를 Operation 모델로(타임아웃 뒤 결과 조회·멱등키), 배포 증적 대조, 구조화 복구 지시 | 본문 ↓ |
| §1-DL | 09-10 | 「업로드 스타트」 제어기 이상 가설(㉠ Stop 중 FTP 덮어쓰기 · ㉡ 정지 직후 Start) **실기기 기각** — 순차화(`stopBeforeUpload`)와 TEST 경로(`gpl.uploadStart.test`) 철회, 업로드는 다시 정지 게이트와 병행(속도 복귀) | 본문 ↓ |
| §1-DM | 09-10 | **정지 불가 쓰레드의 원인 후보 확정 — `StreamReader.Read`/`ReadLine` 의 문서화된 무한 블록**(GPL Dictionary "hang your procedure"). `Peek` 은 비블로킹으로 정정(대신 탈출 조건 없는 루프를 지목), 리포트에 근거 URL·1순위·블로킹/폭주 미확정 경고. §1-DI 실측 건의 원인 확정은 아님 | 본문 ↓ |
| §1-DN | 09-10 | **`Start` 에 `-compile` 누락 — 올린 소스 대신 옛 바이너리가 실행되던 문제(사용자 발견).** 옛 하드 규칙 7("Start 가 자체 컴파일")을 캡처·실기 관측으로 폐기하고 `buildStartCommand` 기본값을 `-compile` 로 전환, MCP `start_project` 의 스위치 없는 `Start <proj>` 도 확장과 동일 형태로 정정 | 본문 ↓ |
| §1-DO | 09-10 | **`Thread.CurrentThread().` 뒤 자동완성이 `Thread.Abort()` 를 통째로 삽입하던 문제** — 완성 provider 의 자체 체인 해석을 `receiverType` 공용 해석기로 이관(`resolveReceiverTarget`), 미해석 시 전역 목록 폴백 → 멤버 후보만(tail 삽입) | 본문 ↓ |
| §1-DP | 09-10 | **표준화(ACL·SSOT·DRY·DI) — 판정 정본을 코드로 강제** · 수신자 해석 조립 정본 `providers/receiverContext.ts` 신설(사본 4벌 통합) · definitionProvider 자체 해석기 이관(다단 체인·`Me.` 해석 개선) · 배열 요소 타입 정본화 · 구조 테스트 R7 신설 | 본문 ↓ |
| §1-DQ | 09-10 | **명령 UI 정리(사용자 지시)** — `category:"GPL"` 분리로 제목의 `GPL:` 하드코딩 63개 제거, 제목을 영문 원어 + 한국어 병기로 통일(81개), 팔레트에서 36개 숨김(트리 인자 필수 25 + AI 진입점 11), 패널 `···` 메뉴 22 → 14(부분집합·트리 중복 제거, 새로고침은 아이콘으로, 콘솔 4종은 트리 항목으로) | 본문 ↓ |

---

**최근 세션 본문 — §1-DG ~ §1-DP (2026-09-10).** 이 아래부터는 세션 원문이다.

## 1-DH. 2026-09-10 세션 — 컴파일 에러가 나도 패널이 Problems 로 바뀌지 않던 문제 (출력 채널이 전환을 덮어씀)

### 요청

"컴파일하고 만약 코드 줄에서 에러 발생하면 문제 패널로 바꿔주면 좋겠어. 원래 그러지 않나?"

### 원인 (코드 대조)

기능 자체는 있었다 — `deployService.jumpToFirstCompileError()` 가 `workbench.actions.view.problems`
로 패널을 Problems 로 바꾸고 첫 에러 줄로 커서를 옮긴다(설정 `gpl.deploy.jumpToFirstError`, 기본 켜짐).
문제는 **같은 실패 분기가 출력 채널도 함께 띄운다**는 것이었다.

- `src/debug/gplDebugSession.ts` — 점프 **직후** `deployOutput.show(true)`. 나중에 도착한 출력 표시가
  Problems 를 덮으므로 F5 디버그 배포에서는 **항상** 출력 패널로 되돌아갔다.
- `src/activation/deploy.ts` — 점프 **직전** `outputChannel.show(true)`. 순서상 Problems 가 이기지만,
  출력 채널 표시는 확장 호스트→메인 스레드 비동기 요청이라 도착 순서가 뒤집히면 같은 증상이 난다.

`OutputChannel.show()` 는 await 할 수 없어 순서를 보장할 수 없다. 따라서 **두 패널을 같이 띄우지 않는
것**이 유일하게 안정적인 해법이다.

### 조치 (의도와 방법)

1. `jumpToFirstCompileError()` 의 반환 타입을 `Promise<void>` → `Promise<boolean>` 으로 바꿨다.
   **패널을 Problems 로 전환했는지**를 뜻한다(에러 없음·설정 off = `false`, 편집기 열기가 실패해도
   패널 전환은 이미 일어났으므로 `true`).
2. 호출측 두 곳이 그 값으로 분기한다 — 점프했으면 출력 채널을 띄우지 않는다.
   - `activation/deploy.ts`: `outputChannel.show(true)` 를 실패 분기 앞머리에서 **failure 판정 뒤로**
     옮기고 `if (!jumpedToError)` 로 감쌌다. 컴파일 에러가 아닌 실패(제어기 시스템 에러 등 코드 위치가
     없는 경우)는 종전대로 출력 패널이 뜬다.
   - `debug/gplDebugSession.ts`: `deployOutput.show(true)` 를 같은 조건으로 감쌌다.
3. `activation/ftpCommands.ts`(FTP Run)는 원래 출력 채널을 띄우지 않아 그대로 둔다.

결과: 소스 줄에 붙는 컴파일 에러 → **Problems 패널 + 에러 줄로 커서**, 그 외 실패 → 출력 패널.

### 검증

- `npm run compile` 통과.
- `npm test` 873/873 통과(구조 규칙 R1~R6 포함).
- 실제 패널 전환은 사용자 확인 필요 — 배포/빠른 컴파일/F5 세 경로에서 일부러 문법 오류를 넣고 확인.

### 남은 일

- 출력 원문이 필요할 때를 위해, 컴파일 에러 알림에 "출력 보기" 버튼을 붙이는 것을 검토(현재는 실패
  메시지의 "COMPILE 원문 로그 확인" 문구만 있고 사용자가 직접 출력 채널을 열어야 한다).

### 변경 파일

```
src/controller/deployService.ts  # jumpToFirstCompileError 가 Problems 전환 여부(boolean)를 반환
src/activation/deploy.ts         # 실패 분기: 점프하지 않은 경우에만 출력 패널 표시(show 위치 이동)
src/debug/gplDebugSession.ts     # 같은 분기 — 점프했으면 deployOutput.show 생략
docs/ai-handoff.md               # 기록(§1-CX 를 2026-09 아카이브로 이동 — 본문 최근 10세션 유지)
```

---

## 1-DI. 2026-09-10 세션 — 정지 불가 쓰레드 진단(`threadStuckDiagnosis.ts`) — Stop 이 안 먹을 때 "왜"를 자동으로 캔다

### 증상 — 실기기에서 실제로 겪은 것

사용자의 「업로드 스타트」가 STOP 게이트에서 막혔다. `Stop -all` 이 `-752` 를 두 번 돌려주고
16초(8초 × 2회) 뒤 배포가 중단됐다. 여기까지는 게이트 설계대로 옳은 동작이다. 문제는 **그다음에
사용자가 할 수 있는 게 없었다**는 것이다. 남은 로그는 이 한 줄뿐이었다.

```
✘ Stop -all 후에도 쓰레드가 정지되지 않음: MergeCode(Running)
```

콘솔로 확인한 실제 상태 — **`-752` 가 "곧 멈춘다"가 아니었다.**

| 명령 | 응답 |
| --- | --- |
| `Stop -all` / `Stop MergeCode` | `-752 "*Timeout stopping thread*"` (반복) |
| `Break MergeCode` | `-752` — **일시정지조차 안 걸린다** |
| `Show Stack MergeCode` | `-750 "*Invalid when thread active*"` (활성 쓰레드는 스택을 못 읽는다) |
| `Unload MergeCode` | `-750` |
| `Show Thread MergeCode` | `Running`, `_network_NetManager.gpl:98` — **수 분간 한 칸도 안 움직임** |

### 원인 — 탈출 조건 없는 flush 루프(소켓이 아니라 시리얼)

정지 위치 98줄은 프로젝트 시작부의 flush 루프였다.

```gpl
While NetworkManager.comReceiver(i).Peek() <> -1   ' 97
    NetworkManager.comReceiver(i).Read()           ' 98
End While
```

`comReceiver(0)` 은 `Shared Public ... As StreamReader` 이고 대상은 `/dev/com1`(HOST 시리얼)이다.
상대가 계속 송신하면 `Peek()` 이 영영 `-1` 을 안 돌려줘 이 루프를 빠져나올 수 없다.

**두 가지를 오판할 뻔했다. 다음 사람은 같은 함정에 빠지지 말 것.**

1. **이름에 속았다.** 파일명이 `_network_NetManager.gpl`, Sub 가 `communicationStart` 라 TCP 소켓으로
   단정했다. 같은 시간대 ErrorLog 에 `-1705 "Network timeout"` 이 있었고 `Show Network -tcp` 의
   `connections initiated 1` 도 그럴듯했다. **전부 무관한 별건**이었고 실제 대상은 RS232 였다.
   소스를 읽고서야 갈렸다.
2. **"줄 고정 = 블로킹"이 아니다.** 위치를 5번 찍어 5번 다 98이었지만, 좁은 루프라도 시간의 대부분을
   `Read()` I/O 가 차지하면 샘플이 그 줄에만 잡힌다. 실제로 이번 건은 블로킹인지 폭주인지 **끝내 못 갈랐다**
   (Close 는 두 경우 다 풀어 준다). 갈랐으려면 `/dev/com1` 케이블을 뽑아 봤어야 했다.

### 탈출 — 자원을 밖에서 치워 스스로 빠져나오게 한다

GPL 에 강제 kill 은 없다(Console Command 49개 전수에 `Kill` 0건 — `docs/development/pa-controller-debug-operations.md` §5).
실제로 통한 명령은 이것이다.

```
Execute NetworkManager.comReceiver(0).Close(), MergeCode   → 0,"Success"
```

즉시 98 → 100(`End If`)으로 빠져나왔고, **앞서 접수만 돼 있던 `Break` 가 그 순간 적용돼 `Paused`** 가 됐다.
`Execute` 는 `_Cmd_<project>` 라는 별도 쓰레드에서 돌고 `Shared`/모듈 전역을 공유하므로, 본체가 막혀
있어도 같은 객체를 닫을 수 있다.

부수 사실 3가지:

- 같은 식을 `Show Global` 로 **읽으면** `-712 "Invalid syntax"` 로 거부된다. 조회가 막혔다고 `Execute`
  까지 포기하면 안 된다 — 파서가 다르다.
- 객체가 `Nothing` 인 인덱스는 `-757 "Object not instantiated"` 로 떨어지고 `_Cmd_<project>` 가 에러로
  남는다. `Stop -all` 로 같이 정리해야 한다.
- 닫은 스트림은 되살릴 수 없다. `New StreamReader(...)` 는 `Sub New()` 에서만 돌므로 **새 Start** 가 필수다.

**디버그 콘솔 함정도 같이 확인됐다.** `Break`/`Stop`/`Execute` 는 `>` 접두사가 없으면 변수 평가로
흘러가 **전송 자체가 안 된다**(읽기 전용 폴백 정책, `gplDebugSession.ts`). 실패 메시지가 "변수 평가 실패"라
보낸 줄 알고 시간을 버렸다. 정책 자체는 옳으므로 유지하고, 문구 개선을 §3 에 남겼다.

### 조치 — 진단을 확장이 대신한다 (1겹만, 읽기 전용)

전체 절차 중 시간을 잡아먹은 것은 실행이 아니라 **진단**이었다(위치 반복 확인 → 소스 열기 → 호출 대상
찾기 → 전역인지 확인). 전부 읽기 전용이고 기계적이라 확장이 대신할 수 있다.

사용자와 합의한 설계는 3겹이고, **이번에 만든 것은 1겹뿐이다.**

| 겹 | 내용 | 상태 |
| --- | --- | --- |
| 1 | 진단 리포트 자동 생성(읽기 전용) + 복구 후보 명령 **제시** | **이번에 구현** |
| 2 | 원클릭 복구(확인 모달 → Execute → settle → Stop) | 미착수 — 1겹이 실전에서 후보를 제대로 뽑는지 본 뒤 |
| 3 | MCP 읽기 전용 도구 `diagnose_stuck_thread` + AI 가이드 명문화 | 미착수 |

**복구 명령을 자동 전송하지 않는 이유**는 셋이다. ① 대상 식별이 정적 분석이라 오식별이 가능하다(이번에도
배열 인덱스가 지역 변수라 소스만으로 확정 못 했고 `-757` 을 보고 사후 확인했다) ② 엉뚱한 객체를 닫으면
프로그램이 **조용히 반쯤 망가진 채** 돈다 ③ `Execute` 는 임의 GPL 문장 실행 경로다.

#### `controller/threadStuckDiagnosis.ts` (신규, vscode 무의존·주입형 IO)

§3.1 의 "절차를 모듈로" 규약을 그대로 따랐다 — 다만 이 모듈은 **상태를 바꾸지 않는다**(`Show Thread` 만 보낸다).

- `diagnoseStuckThread(io, name, lookupSource?, opts?)` — 위치를 N회 샘플링(기본 4회/400ms) →
  이동 여부 판정 → 로컬 소스에서 그 줄과 앞뒤 문맥 읽기 → 수신자 식 추출 → 복구 후보 조립 → 리포트.
  샘플 도중 쓰레드가 사라지면 `resolvedDuringSampling` 으로 끝낸다.
- `extractCallTarget(statement)` — 문장에서 **마지막 메서드 호출**의 수신자와 메서드를 뽑는다.
  `NetworkManager.comReceiver(i).Read()` → `{ receiver: 'NetworkManager.comReceiver(i)', method: 'Read' }`.
  문자열 리터럴과 주석을 같은 길이 공백으로 덮어 인덱스를 보존한 뒤(`maskLiterals`), `.` 앞을 역방향으로
  훑으며 괄호 짝을 맞춘다. 그래서 `While ... .Peek() <> -1` 의 좌변 키워드나 `x = sock.Read(buf)` 의
  대입 좌변에 걸리지 않는다.
- `buildRecoveryCandidates(receiver, project, opts?)` — 배열 인덱스가 **지역 변수**면(`comReceiver(i)`)
  소스만으로 확정할 수 없으므로(활성 쓰레드는 `Show Stack`·`Show Variable` 을 `-750` 으로 거부한다)
  `0`~`maxArrayIndexProbe`(기본 3)로 치환한 후보를 늘어놓는다. 없는 원소는 `-757` 이라 순서대로 시도해도 무해하다.
- `createFileSourceLookup(dirs)` — 제어기는 정지 위치를 **경로 없이 파일명만** 보고하므로 디렉터리를
  얕게(기본 depth 4) 재귀 탐색해 찾는다. 라이브러리가 하위 폴더에 있는 중첩 배치도 잡힌다. 파일명 단위 캐시.

리포트에는 "줄 고정 = 블로킹으로 단정하지 말 것", "닫으면 새 Start 필요", "`-757`=Nothing", "`-712`면
모듈명까지" 같은 **이번에 실제로 헤맨 함정**을 그대로 넣었다.

#### 호출부 2곳

- **자동** — `deployService` 의 STOP 게이트 실패 직후(`traceStuckDiagnosis`). 아직 활성인 쓰레드
  최대 2개를 진단해 배포 트레이스(`│` 접두)에 리포트를 붙인다. 실패해도 배포 결과에 영향이 없도록 감쌌다.
- **수동** — `GPL: 정지 불가 쓰레드 진단 (읽기 전용)`(`gpl.controller.diagnoseStuckThread`).
  팔레트·쓰레드 트리 우클릭(Running 항목)·문자열 인자 3경로. 소스 탐색 범위는 그 쓰레드의 `project` 와
  이름이 같은 워크스페이스 프로젝트를 우선한다(같은 이름 프로젝트가 여러 벌 복제된 배치가 실제로 있다).
  후보가 나오면 **"첫 후보 복사"** 버튼만 준다 — 전송은 하지 않는다.

### 검증

- `npm run compile` 통과.
- `npm test` **873/873** (신규 14건 포함, 구조 테스트 R1~R6 통과 — 새 모듈이 계층 규칙을 지킨다).
- 테스트 픽스처 함정 하나 기록: `<DATA>…98</DATA><STATUS>0,…` 처럼 **줄바꿈 없이** 이으면 태그를 벗긴 뒤
  `980` 으로 붙는다. 실제 응답에는 `\r\n` 이 있다 — 픽스처도 그렇게 만들어야 한다.
- **실기기 미검증** — 진단이 실제로 후보를 제대로 뽑는지는 다음에 막혔을 때 확인한다(§3).

### 변경 파일

```
src/controller/threadStuckDiagnosis.ts    # 신규 — 정지 불가 진단 정본(읽기 전용, 주입형 IO)
src/controller/deployService.ts           # STOP 게이트 실패 직후 자동 진단(traceStuckDiagnosis)
src/activation/controllerCommands.ts      # GPL: 정지 불가 쓰레드 진단 명령
src/test/threadStuckDiagnosis.test.ts     # 신규 14건
src/test/index.ts                         # 등록
package.json                              # 명령 + 쓰레드 트리(Running) 컨텍스트 메뉴
docs/ai-handoff.md                        # 이 절 + 헤더 + §1 인덱스 + §3
```

### 남은 일

§3 의 두 항목 — ① 실기기에서 진단이 실제로 후보를 뽑는지 확인 후 2·3겹 착수 ② 디버그 콘솔에서
제어기 명령 보내기 개선(여러 줄 붙여넣기·`>` 없이 보낸 상태 변경 명령이 전송 안 됨을 알기 어려움).
그리고 사용자 측 근본 대책은 **flush 루프에 반복 상한**을 넣는 것이다(저장소 밖 코드).
## 1-DJ. 2026-09-10 세션 — 연결을 해제해도 1402 소켓이 다시 열리던 문제 (디버그 세션이 폴을 계속 돌림)

### 증상

`GPL: Disconnect Controller` 로 연결을 끊어도 **다른 도구(GDE 등)가 1402 에 붙지 못했다.** 상태바·트리는
offline 인데 확장은 제어기와 계속 통신하고 있었다. 사용자가 "분명히 끊으라고 했는데 왜 붙어 있느냐"고
물은 지점이 정확히 이것이다.

### 원인 — 확장의 "연결 상태"와 어댑터의 "연결 상태"가 서로 다른 변수였다

1. `closeControllerConnection()`(`controller/consoleSocket.ts`)은 **보관 소켓 하나를 FIN 으로 닫을 뿐**,
   이후 명령의 신규 connect 를 막지 않는다. `_generation++` 은 "in-flight 명령이 끝나도 park 하지 마"라는
   뜻이지 전송 게이트가 아니다.
2. 디버그 어댑터는 attach 시점에 복사한 자기 `_config` 로 Show Thread 를 **기본 1 s**(1000~5000ms 클램프)
   마다 폴한다. **확장의 연결 상태를 읽는 코드가 없다** — 어댑터에는 `host` 참조 자체가 없다.
3. 그래서 해제 직후 1 s 안에 소켓이 부활하고 keep-alive(기본 30 s)로 다시 보관된다. 폴이 계속되니 idle
   타임아웃에 걸릴 일도 없어 **사실상 영구 점유**가 된다. 제어기는 단일 클라이언트라 다른 도구가 붙을 틈이 없다.
4. 어댑터가 스스로 세션을 끝내는 경로는 폴 3연속 실패(`MAX_POLL_FAILURES`)뿐인데, 재접속이 성공하니
   실패가 쌓이지 않는다. 통보 배선도 **어댑터 → 확장**(`gpl.controllerConnectionChanged`) 한 방향뿐이었다.
5. `gpl.controller.disconnect` 가 끄는 것들(statusBar·트리·healthMonitor·idlePing·agentBridge presence·
   세션 오버라이드) 중 **명령 전송 경로가 참조하는 값은 하나도 없다.** 즉 해제는 실질적으로 "UI 와 보조
   채널만 끄는 명령"이었다.

### 조치 — 해제 전에 디버그 세션을 먼저 끝낸다 (`activation/connection.ts`)

- `gpl.controller.disconnect` 를 async 로 바꾸고, 살아 있는 `brooks-gpl` 세션이 있으면
  **`stopDebugging()` → terminated 이벤트 수신까지 대기(`stopDebugSessionAndWait`, 상한 15 s)** 한 뒤에
  소켓을 닫는다. 기다리는 이유: 어댑터의 `disconnectRequest` 가 종료 과정에서 등록 BP 수만큼 `Nobreak` 와
  (구성에 따라) `Stop -all` 을 1402 로 보낸다 — 먼저 닫으면 그 명령들이 곧바로 새 연결을 연다.
  상한을 넘겨도 실패로 보지 않고 로그만 남기고 진행한다(`closeControllerConnection()` 은 in-flight 명령을
  중단하지 않는다).
- **모션 게이트(하드 규칙 6):** 세션 구성이 `stopAllOnDisconnect: true` 면 종료가 제어기 프로그램까지
  멈춘다(`Stop -all`). 사람이 누른 경우에는 그 사실을 적은 **모달로 먼저 확인**받고, 취소하면
  `{ ok:false, cancelled:true, connected:true }` 로 아무것도 하지 않고 돌아온다. 기본값은 false 지만
  `package.json` 의 launch 스니펫("Fast Debug (no upload)")이 true 로 주므로 실제로 걸리는 사용자가 있다.
- `silent`(AI·URI 경로)는 묻지 않고 진행하되 결과에 `debugSessionEnded` 를 담아 무슨 일이 있었는지 알린다
  (AI 접근을 막지 않고 조건은 확장이 충족한다는 원칙 — §1-DA 와 같은 방향).
- 종료 대상 핸들은 `host.gplDebugSession` 으로 붙잡아 둔다(`activation/debugIntegration.ts` 의 세션
  시작/종료 구독에서 set/clear). `vscode.debug.activeDebugSession` 은 사용자가 다른 디버그 세션에 포커스를
  두면 우리 세션이 아니게 되므로 종료 대상으로 쓸 수 없다.

### 검증

- `npm run compile` 통과. `npm test` 는 **다른 세션이 동시에 작업 중인 WIP**(`controller/operationStore.ts`
  신규·`deployLock.ts` 수정)에서 2건 실패하고 나머지는 통과 — 이 변경과 무관하다(변경 파일이 전부
  vscode 접착 계층이라 Node 단독 러너가 로드하지 않는다). 구조 테스트 R1~R6 통과.
- **실기기 미검증** — §3 항목 참조.

### 변경 파일

```
src/activation/connection.ts      # disconnect 를 async 로 + stopDebugSessionAndWait() + 모션 모달
src/activation/host.ts            # gplDebugSession 핸들 보관
src/activation/debugIntegration.ts# 세션 시작/종료에서 핸들 set/clear
src/activation/aiDebugCommands.ts # 반환 타입에 debugSessionEnded 추가
docs/ai-handoff.md                # 이 절 + 헤더 + §1 인덱스 + §3
```

### 남은 일

- 실기기 검증(§3).
- `startQuickAttachSession()` 의 "중단하고 다시 시작" 경로는 아직 `stopDebugging()` + **400ms 고정 대기**다
  (`activation/connection.ts`). 같은 종류의 경합이므로 `stopDebugSessionAndWait()` 로 바꾸는 것이 맞지만,
  이번 요청 범위 밖이라 두었다.
- 근본 대책 후보: 명시적 해제 뒤에는 `sendCommand` 자체를 거부하는 전송 게이트. 배포·MCP 등 모든 경로에
  영향이라 이번엔 넣지 않았다 — 세션 종료로 증상이 잡히는지 먼저 본다.

---

## 1-DK. 2026-09-10 세션 — MCP·확장 자동화 구조 개선 (인스턴스 분리 · Operation 모델 · 배포 증적 · 복구 지시)

### 요청

사용자가 26개 항목의 「GPL MCP 서버 / VS Code 확장 구조 개선 구현 지침」을 제시했다. 핵심 문제 제기:
DeployLock 이 비정상 충돌할 가능성, 여러 VS Code 인스턴스에서 Bridge 대상이 뒤섞이는 문제, 같은
`projectName` 을 안정적으로 식별하지 못하는 문제, Deploy/Compile 이 Bridge timeout 뒤 결과 불명이 되는 문제,
timeout 뒤 중복 실행, 실제로 어떤 소스가 올라갔는지 추적 불가, AI 가 복구 행동을 판단하기 어려움.

### 먼저 한 것 — 지적 사항을 코드와 대조 (구현 전)

지침의 P0 1순위는 「DeployLock 이중 획득 조사」였는데, **전수 확인 결과 이중 획득은 없었다**:
`acquire()` 호출부는 `deployService.deploy()`(try/finally 1회)와 `gpl.saveToFlash` 둘뿐이고 경로가 겹치지
않는다. `activation/deploy.ts` 의 `runDeploy` 는 `current()` **조회**다. 반면 다음은 사실로 확인됐다.

| 지침 | 사실 여부 | 근거 |
| --- | --- | --- |
| §5 Bridge queue 가 IP 네임스페이스 | **사실 · 근본 원인** | `bridgeDirs(ip)` 하나를 모든 창이 `drain()` — 먼저 집은 창이 실행 |
| §4 presence 파일이 IP 기반 단일 | 사실 | 두 창이 `<ip>.extension.json` 을 5초마다 번갈아 덮어씀 |
| §8·§9 장시간 명령이 단일 RPC | 사실 | `deploy_project` 기본 240초, 끊기면 결과 불명 |
| §3.2 AMBIGUOUS 인데 target 확정 | **사실 · 버그** | 확장이 `PROJECT_AMBIGUOUS` 를 줘도 요청 이름을 `sessionProject` 에 박았다 |
| §3.1 projectName 을 식별자로 | 부분 | 확장은 이미 `projectDir` canonical(`projectTarget.ts`), MCP 세션 대상만 이름 |
| §7.2·§7.3 잠금의 작업 식별·self 구분 | 부분 | `local` 플래그는 있었으나 `makeLockedResult` 가 버려 MCP 까지 안 갔다 |
| §12·§13 Source Manifest | **이미 존재, 미노출** | `syncManifest`(업로드분 SHA-1) + `deployRecordCore`(컴파일 스냅샷)가 **서로 대조되지 않았을 뿐** |
| §14 ECONNREFUSED 추론 금지 | 이미 구현 | `outcome.js` · `reachability.ts` (2026-08-31) |

그래서 §25 의 1~2단계(lock instrumentation)는 건너뛰고 3단계부터 착수했다.

### 조치 (1) — 확장 인스턴스 분리 (§4·§5·§6·§21)

- `controller/agentBridge.ts`: 확장 활성화 때 `extensionInstanceId`(UUID, `host.ts` 가 창 수명 동안 보관)를
  만들고 presence 를 `extensions/<id>.json`, 큐를 `bridge/inst/<id>/{req,res}` 로 분리한다.
- **레거시(IP) 경로는 리더 인스턴스 하나만** 서비스한다 — globalStorage 에 복사된 구버전 MCP 사본이 그대로
  동작하되 경쟁은 사라진다. 리더는 파일에 쓰지 않고 살아 있는 presence 들로 **계산**한다
  (`electLeaderInstanceId` — 가장 먼저 뜬 것, 동률이면 id 순). 확장과 MCP 가 같은 규칙이라 같은 답을 낸다.
  비리더는 레거시 presence 를 지우지 않는다(남의 것을 지우면 구버전 MCP 가 확장을 잃는다).
- MCP `extensionBridge.js`: `listExtensionInstances` / `resolveExtensionInstance`. 대상 창 우선순위는
  **명시 id → projectDir 를 품은 워크스페이스 → connected → 유일 후보**이고, 좁혀지지 않으면
  `EXTENSION_AMBIGUOUS` + 후보를 돌려준다. **임의로 고르지 않는다** — 그것이 원래 문제였다.
  1402 콘솔 명령은 어느 창을 거쳐도 같은 제어기로 나가므로 리더 창을 기본 경로로 쓴다.
- 새 도구 `extension_list` · `extension_resolve`, `extension_status` 는 인스턴스 목록을 함께 보여 준다.
- MCP 세션 대상: 해석과 고정을 분리했다(§3.2). 확장이 구조화 실패를 주면 **대상을 바꾸지 않고** 그대로
  올려 보낸다. 대상은 이름이 아니라 폴더를 canonical identity 로 기억한다(`sessionTarget{project,dir,verified}`).
- 브리지 타임아웃이 `requestId`·`sent` 를 함께 돌려준다 — 확장이 **집어 가지 않은** 요청만 재전송이 안전하고,
  뒤늦게 도착한 응답은 `takeLateResponse` 로 회수한다.

### 조치 (2) — 배포를 Operation 으로 (§8~§11·§18)

- `controller/operationStore.ts` 신설(vscode 무의존): 작업의 종류·대상·단계·결과를
  `%TEMP%/gpl-controller/operations/<id>.json` 에 남긴다. **배포 잠금과 합치지 않았다** — 잠금은 끝나면
  사라져야 하고(상호 배제) 기록은 끝난 뒤에도 남아야 한다(결과 조회).
- `state` 는 생애주기(QUEUED/RUNNING/COMPLETED/FAILED/CANCELLED)만 담고 세부 진행은 `phase` 문자열
  (배포 단계 라벨 그대로)이다 — 지침 §8.1 의 긴 상태 열거를 그대로 넣으면 단계가 늘 때마다 enum 두 벌을
  고쳐야 하므로, 단계 이름을 값으로 쓰는 쪽을 택했다.
- **UNKNOWN 은 실패가 아니다**: RUNNING 인데 heartbeat 가 끊겼거나 pid 가 죽었으면 **읽는 쪽이** UNKNOWN 으로
  보되 파일은 고치지 않는다(관측이지 확정이 아니다 — §0 하드 규칙 2·3의 연장).
- `deploy()` 는 잠금 획득 앞뒤로 작업을 열고 닫는다. 잠금 핸들을 감싸(`withOperationPhase`) `setStage()` 한 번에
  잠금 단계와 작업 phase 가 함께 움직이므로 **배포 본문(1,300줄)은 손대지 않았다.**
- 멱등키(§10): 같은 키의 배포가 진행 중이면 두 번째를 시작하지 않고 그 작업을 가리킨다(`IN_PROGRESS`).
  자동화 경로는 키를 안 주면 `(명령 + 대상 폴더)` 로 만든다 — 키가 없다고 중복 방지가 꺼지면 막으려던
  상황이 그대로 남는다.
- 잠금 레코드 v2(§7.2·§7.3): `operationId`·`extensionInstanceId`·`projectDir` 를 함께 기록하고, LOCKED 결과에
  보유자가 이 프로세스인지(`lockHolderIsLocal`)와 그 작업의 id 를 싣는다. 읽는 쪽이 모르는 필드를 무시하고
  version 도 검사하지 않으므로 구버전과 섞여도 안전하다.
- MCP `operations.js`(읽기 전용) + `operation_status` 도구 — **확장을 거치지 않고** 파일을 읽으므로 확장이
  배포로 바빠도, MCP 가 재시작돼도 조회된다. `deploy_project` 의 타임아웃은 `BRIDGE_REQUEST_TIMEOUT` +
  `recovery` 로 바뀌었다. 확장 명령 `gpl.automation.operations` 도 같은 조회를 제공한다.

### 조치 (3) — 배포 증적과 복구 지시 (§12·§13·§15~§17·§22)

- `controller/deployProvenance.ts` 신설: 로컬 소스 지문과 "우리가 올린 내용"의 지문을 대조해
  `localRevision`/`uploadedRevision`/`inSync` + 어긋난 파일 목록(`changedSinceUpload`·`notUploaded`·
  `staleRemote`)을 낸다. 업로드 후 Compile 전에 계산해 `DeployResult.provenance` 와 작업 기록에 싣는다.
  판정 근거를 `verifiedBy:'upload-manifest'` 로 밝힌다 — **원격 내용을 직접 해시한 것이 아니고**(제어기 FTP 에
  그 수단이 없다) 우리 밖에서 바뀐 원격은 여전히 증명하지 못한다. 업로드 기록이 없으면 `inSync=false` —
  판정 불가는 "올려야 함" 쪽으로 넘어져야 한다.
- `controller/automationRecovery.ts` 신설: 오류 코드마다 `action`·`retryCurrentCommand`·`safeToRepeat` 를
  표로 고정한다. 잠금/타임아웃/진행 중은 전부 `CHECK_OPERATION` + 재시도 false — "Quick Compile 로 우회"나
  "타임아웃을 실패로 읽고 되풀이"가 나오지 않게 하는 것이 목적이다. **표에 없는 코드는 보수적인
  기본값**(재시도 금지)으로 떨어진다. 확장의 자동화 실패는 `automationFailure()` 한 곳에서 만들어
  `recovery` 를 빠뜨릴 수 없다.
- MCP `deployOutcome`: `DeployResult.failedPhase` 를 `DEPLOY_<단계>` 코드 + `recovery` 로 번역한다 —
  종전에는 `success:false` 가 `ok:true` 안에 들어가 "명령은 성공했다"로 오독될 수 있었다.
- MCP `diagnostic_snapshot`(§22): 창 목록·진행 중 작업·잠금 보유자·세션 대상·전송 경로를 한 번에 본다.
  제어기에 명령을 보내지 않는다.

### 지침 중 구현하지 않은 것과 이유

- **§8 "operationId 즉시 반환 + 백그라운드 실행"(accept-then-poll)**: 브리지 요청/응답 파일 계약을 바꾸는
  일이고, 지금은 타임아웃이 와도 ① 요청을 집어 갔는지(`sent`) ② 그 작업의 상태(`operation_status`)를 알 수
  있어 **증상이 해소된다**. 계약 변경은 구버전 사본 호환까지 걸리므로 실기기 검증 뒤로 미뤘다.
- **§7.3 `LOCK_REENTRANT_ERROR`**: 이중 획득이 실제로 없으므로 만들지 않았다. `acquire()` 는 이미
  같은 프로세스면 `local=true` 로 거부하고, 그 사실이 이제 결과까지 전달된다.
- **§14**: 이미 구현돼 있어 손대지 않았다.

### 검증

- 확장 `npm test` **901/901**, `controller-mcp` `node --test` **98/98**(신규: 인스턴스 분리 6건 ·
  Operation 7건 + MCP 6건 · 증적 7건 · 복구 지시 6건 · 잠금 v2 2건).
- MCP 서버 기동 확인(`GPL_BRIDGE=off`).
- **실기기 미검증** — 다중 창·타임아웃·증적 시나리오는 §3 체크리스트로 넘겼다.

### 바뀐 파일

```
src/controller/agentBridge.ts          # 인스턴스 presence/큐 분리 + 리더 선출 + 큐 2개 drain
src/controller/operationStore.ts       # 신규 — 작업 기록(파일 영속, UNKNOWN 은 읽을 때 판정)
src/controller/deployProvenance.ts     # 신규 — 로컬 소스 vs 업로드분 지문 대조
src/controller/automationRecovery.ts   # 신규 — 코드별 복구 지시 표
src/controller/deployLock.ts           # 레코드 v2(operationId·instanceId·projectDir)
src/controller/deployService.ts        # 멱등 검사 → 작업 열기 → 잠금 → 증적 대조 → 결과 확정
src/activation/deploy.ts               # 자동화 인자 idempotencyKey, automationFailure(), gpl.automation.operations
src/activation/host.ts                 # extensionInstanceId · workspaceFolders · currentDeployLockOwnership()
package.json                           # onCommand:gpl.automation.operations
controller-mcp/src/extensionBridge.js  # 인스턴스 목록/선택/라우팅 + takeLateResponse
controller-mcp/src/operations.js       # 신규 — 작업 기록 읽기 + 복구 지시
controller-mcp/src/index.js            # 세션 대상 분리, extension_list/resolve, operation_status, diagnostic_snapshot
src/test/{operationStore,deployProvenance,automationRecovery}.test.ts · agentBridge · deployLock  # 신규/보강
controller-mcp/test/{operations.test.mjs, extensionBridge.test.mjs}                               # 신규/보강
docs/ai-handoff.md · docs/archive/handoff/2026-09.md   # 이 절 + 헤더 + §1 인덱스 + §3 + §1-DA 아카이브 이동
```

### 남은 일

- 실기기 검증(§3) — 특히 **다중 창에서 대상 창이 정확히 선택되는지**가 이번 변경의 핵심이다.
- 구버전 MCP 사본 호환 확인(§3). 구버전 경로는 리더 창으로만 나가므로 **대상 창을 고를 수 없다**.
- `gpl.saveToFlash` 의 잠금 획득(`activation/deploy.ts`)은 작업 기록을 만들지 않는다. AI 경로에서 차단된
  사람 전용 명령이라 조회 수요가 낮아 두었지만, 잠금 보유자로는 잡히므로 `diagnostic_snapshot` 에서
  `operationId:null` 로 보인다.
- 지침 §8 의 accept-then-poll 전환은 위 "구현하지 않은 것" 참조.

---

## 1-DL. 2026-09-10 세션 — 「업로드 스타트」 제어기 이상 가설 기각 + 속도 복귀 (순차화·TEST 경로 철회)

**결론(사용자 실기기 검증).** §1-DC가 세운 두 가설이 **둘 다 기각됐다.** 사용자가 TEST 조합 A~D를 돌렸고,
**안전장치를 모두 끈 A(= 변경 전 순서: 업로드 ∥ Stop 병행 + Start 직전 재확인 없음)에서도 제어기가 죽지 않았다.**
같은 조건을 반복해도 **애초에 재현되지 않는다**는 것이 사용자 보고다. 특히 ㉠(`Stop -all` 처리 중 FTP 덮어쓰기)은
"상관 없어 보인다"는 관측이 붙었다.

| 가설 | §1-DC의 근거 | 실기기 결과 |
| --- | --- | --- |
| ㉠ Stop 처리 중 FTP 덮어쓰기 | 병행의 근거였던 "실행 중 업로드는 무해"(이슈 #17)가 Stop 없는 빠른 컴파일 기준이었다 | **기각** — 병행(A·C)에서 정상 |
| ㉡ 정지 직후의 `Start`(제어기 자체 컴파일) | settle 게이트 통과 후에도 `-752` 뒤 내부 정리가 남을 수 있다 | **기각** — 재확인 없이도(A·B) 정상 |

**조치 — 값을 못 하는 안전장치는 걷어낸다(사용자 지시: "테스트도 지워버리고 빠른 속도로 작동하는 방향으로").**

1. **`gpl.uploadStart.test` 삭제** — 명령 등록(`activation/deploy.ts`), `package.json` 의 `commands`·
   `view/title`(비커 `navigation@5`)·`activationEvents` 항목까지 함께 제거. 구조 테스트 R5(package.json 명령 ↔
   소스 등록)가 한쪽만 지우는 실수를 잡아 준다.
2. **`DeployOptions.stopBeforeUpload` 삭제 → 업로드 스타트도 다시 `UPLOAD ∥ STOP` 병행.** 순차 분기(`sequentialStop`)와
   단계 배너 분기를 함께 지워 Phase 1 은 다시 `Promise.all([runUpload(), runStopGate()])` 한 갈래다. 총 소요가
   `정지 + 업로드` 에서 `max(정지, 업로드)` 로 돌아온다 — 정지가 `-752` 로 늦어질 때 차이가 크다.
3. **진단용 옵션 `preStartSettleCheck`·`modeNote` 삭제.** TEST 경로 전용이었으므로 남기면 죽은 설정이 된다.
   **Start 직전 정지 재확인 자체는 유지**했다 — 가설 ㉡과 무관하게 §0.6("`Stop -all` STATUS 0 은 정지 완료가
   아니다")의 게이트이고, 비용은 읽기 전용 `Show Thread` 한 번(정지돼 있으면 즉시 통과)이다. 활성 쓰레드가 남은
   채 `Start`(= 제어기 자체 컴파일)를 보내지 않는다는 규약은 §1-DD 통합 이후 모든 경로의 공통 전제다.

**대가 / 남은 불확실성.** 이번 세션 시점에서 "죽는다"의 실제 원인은 알 수 없었다 — 시퀀스(업로드·정지·Start의 순서)로
설명되지 않는다는 것까지가 결과였다. **→ 같은 날 §1-DM 에서 원인 계열이 특정됐다**(`StreamReader.Read`/`ReadLine` 의
문서화된 무한 블록 = 원인은 시퀀스가 아니라 **쓰레드 상태**). 아래 관측 항목은 재현 시 그대로 유효하다 —
정지에 응답하지 않는 쓰레드(§1-DI `threadStuckDiagnosis.ts`)가 있었는지, `Stop` 응답이 `-752` 였는지,
그리고 "죽음"이 영구였는지 수 분짜리 1402 접속 거부였는지(2026-08-31 실측: Unload 타임아웃 뒤 약 2.5분간 거부 후
재부팅 없이 복귀)를 구분해야 한다. 시퀀스를 되돌린 것이 그 관측을 방해하지는 않는다 — 병행이 원래 상태였다.

**검증.** `npm run compile` 통과, `npm test` **901/901**(구조 R1~R6 포함). 실기기 추가 검증은 이번 변경으로
새로 필요해진 것이 없다 — **되돌린 방향이 §1-DC 이전에 쓰던 그 경로**다(§3의 「업로드 스타트」 항목 ⓪ 종결).

**손댄 파일.**

```
src/activation/deploy.ts                 # QuickDeployOpts 3개 옵션·TEST 명령 삭제, uploadStart = { skipCompile: true }
src/controller/deployService.ts          # DeployOptions 3개 옵션·sequentialStop 분기·modeNote 트레이스·preStartSettleCheck 분기 삭제
package.json                             # gpl.uploadStart.test (commands · view/title · activationEvents)
docs/ai-handoff.md                       # 이 절 + 헤더 + §3(TEST 항목 삭제·검증 항목 ⓪ 종결) + §4 + §1-DC 무효 표시
docs/archive/handoff/2026-09.md          # §1-DB 아카이브 이동(본문 10세션 유지)
```

### 남은 일

- ~~원인 미지 상태로 닫는다~~ → **§1-DM 에서 원인 후보를 문서로 확정**(`Read`/`ReadLine` 의 무한 블록).
  그 사건 자체의 원인 확정은 아니므로 재현 실험은 §3 에 남아 있다.
- §1-DI 의 정지 불가 쓰레드 진단 2·3겹은 그대로 대기(§3).

---

## 1-DM. 2026-09-10 세션 — 정지 불가 쓰레드의 원인 후보 확정: `StreamReader.Read`/`ReadLine` 의 문서화된 무한 블록

**착안(사용자).** "StreamReader.Read() 문서에 존재하지 않는 바이트에 블락될 수 있다는 주의사항이 있다." → 원문 대조 결과 사실이다.

**문서 사실(GPL Dictionary, live 조회 — 원문 인용).**

| 메서드 | 블로킹 | 원문 핵심 | 출처 |
| --- | --- | --- | --- |
| `Read()` | **블록** | serial 은 읽을 바이트가 없으면 블록. "If for some reason the byte is lost due to an error, this method **will continue blocking and hang your procedure**." | [read_sr.htm](https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/StreamReader/read_sr.htm) |
| `ReadLine()` | **블록** | LF/CR 까지 블록. "If for some reason the line terminator is lost or corrupted due to an error, this method **will continue blocking and hang your procedure**." | [readline_sr.htm](https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/StreamReader/readline_sr.htm) |
| `Peek()` | **안 함** | "For serial devices, this method **does not block**, but **immediately returns -1** if no bytes are available to read." | [peek_sr.htm](https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/StreamReader/peek_sr.htm) |
| `Close()` | — | "**No error occurs if the file or device is not currently open.**" | [close_sr.htm](https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/StreamReader/close_sr.htm) |

**확정된 것(문서 사실).** 유실 바이트·유실 종결자가 생기면 `Read`/`ReadLine` 은 **영구히** 반환하지 않는다 — 제어기
결함이 아니라 **문서화된 동작**이다. GPL 에 강제 kill 이 없으므로(콘솔 명령 49개 전수에 `Kill` 0건) 그 쓰레드는
`Stop` 으로 풀리지 않고, 남는 길은 스트림을 밖에서 `Close()` 하는 것뿐이다. `Close` 는 안 열려 있어도 에러가 없어
시도 자체가 안전하고, 닫히면 블록된 호출이 `-1` 로 리턴한다 — 실측에서 통했던
`Execute NetworkManager.comReceiver(0).Close(), MergeCode` 가 우연이 아닌 **정공법**이었던 이유다.

**확정되지 않은 것 — §1-DI 실측 건의 원인은 이 문서로 결론나지 않는다(중요).** 그날 기록은 "블로킹인지
폭주(탈출 조건 없는 flush 루프)인지 **끝내 못 갈랐다**"다. 위치 5회 샘플이 모두 98줄(`Read()`)이었지만, 좁은 루프라도
시간의 대부분을 `Read()` I/O 가 차지하면 샘플이 그 줄에만 잡히기 때문이다. `Close` 는 두 경우 모두 풀어 주므로
**조치가 같아서 갈릴 필요가 없었고, 그래서 갈리지 않은 채 끝났다.** 이번 문서 대조가 더한 것은 "블로킹 쪽 시나리오가
**실재 가능**하다"는 확정과 "`Peek` 은 그 후보에서 제외된다"는 것이다 — 그 사건의 원인 확정이 아니다. 가르려면
입력원(`/dev/com1` 케이블·상대 송신)을 끊어 보는 실험이 필요하다(§3).

**이것이 아직 추정인 것.** 블록된 쓰레드가 **1402 콘솔까지 먹통으로 보이게** 만든 인과는 문서로 확정되지 않았다.
정지·Unload·Start 가 전부 거부되며 세션이 타임아웃 → 재접속 거부(2026-08-31 실측: 약 2.5분 거부 후 재부팅 없이 복귀)로
이어져 "죽은 것처럼" 보였다는 해석이 가장 그럴듯하다. **§3 에 재현 실험 항목을 넣었다** — 원인 규명은 그 실험으로 닫는다.

**§1-DL 과의 정합성(중요).** 원인이 **시퀀스가 아니라 상태**라면, 깨끗하게 정지되는 상태에서 TEST 조합 A~D 를
아무리 돌려도 재현되지 않는 것이 당연하다. 즉 §1-DL 의 "재현 실패"는 실험 설계의 한계였고, 시퀀스 가설 기각과
이번 후보 확정은 서로 모순되지 않는다. 따라서 §1-DL 의 병행 복귀(속도)를 되돌릴 이유도 없다.

**조치 — `controller/threadStuckDiagnosis.ts` (진단 정확도).**

1. **`Peek` 오분류 정정.** 기존 `BLOCKING_METHODS` 에 `'peek'` 가 들어 있어, 정지 위치가 `While … Peek() <> -1`
   줄로 잡히면 "대기할 수 있는 호출입니다"라고 **엉뚱한 곳을 범인으로 지목**했다. 문서상 Peek 은 블록하지 않으므로
   비블로킹으로 옮기고, 그 경우 리포트가 **"탈출 조건 없는 루프를 의심하라"** 고 안내한다(실측 그대로 — 상대가
   계속 송신해 `While … Peek() <> -1` 을 빠져나오지 못했다).
2. **무한 블록 계열을 1순위로 분리.** `UNBOUNDED_BLOCKING_METHODS`(`read`·`readline`) 를 새로 두고, 리포트에
   `— 문서상 **영구 대기**할 수 있는 호출입니다` + **근거 문장·URL** 을 싣는다. 지금 내놓는 복구 후보
   (`Execute <수신자>.Close(), <프로젝트>`)가 왜 맞는 조치인지가 리포트 안에서 설명된다.
3. **"줄 고정 = 블로킹" 단정 방지.** 무한 블록 계열인데 위치가 한 번도 움직이지 않았으면
   `BLOCK_VS_SPIN_CAVEAT`("좁은 루프의 I/O 시간일 수 있다 — 가르려면 입력원을 끊어 본다. Close 는 두 경우 모두 통한다")를
   덧붙인다. §1-DI 가 못 갈랐던 그 지점을 리포트가 스스로 밝히게 한 것이다.
4. 진단 결과에 `unboundedBlocking`·`blockingNote` 필드 추가(2·3겹과 MCP 도구가 같은 근거를 쓰도록).

**하지 않은 것.** 복구 명령 자동 전송은 여전히 하지 않는다(§1-DI 방침 유지 — 대상 식별이 정적 분석이다).
GPL 측 대책(수신 루프를 `Peek()` 로 가드, 정지 시 수신 객체 `Close()` 하는 종료 훅)은 **로봇 프로젝트 소스 쪽 일**이라
이 저장소에서 손대지 않았다.

**검증.** `npm run compile` 통과, `npm test` **903/903**(Peek 비블로킹 판정 테스트 신규 + Read 케이스에 근거 URL·
블로킹/폭주 미확정 경고 단정 추가). 문서 인용은 live 조회 원문이다(하드 규칙 3 — 단정 전 확인).

**손댄 파일.**

```
src/controller/threadStuckDiagnosis.ts   # UNBOUNDED_BLOCKING_METHODS / NONBLOCKING_METHODS / BLOCK_VS_SPIN_CAVEAT 분리, Peek 정정, 리포트 근거 줄
src/test/threadStuckDiagnosis.test.ts    # Peek 비블로킹 테스트 신규 + Read 1순위·근거 URL·미확정 경고 단정 추가
docs/ai-handoff.md                       # 이 절 + §3 재현 실험 항목 + §1-DL 상호 참조 (헤더는 §1-DN 이 가져갔다 — 같은 날 다른 세션)
docs/archive/handoff/2026-09.md          # §1-DC 아카이브 이동(본문 10세션 유지)
```

### 남은 일

- **§3 의 재현 실험** — ③(블록 상태에서 업로드 스타트가 실제로 죽이는지)이 이 가설의 확정 조건이고,
  ①-b(입력원 차단)가 블로킹/폭주를 가르는 유일한 관측이다.
- 재현되면 진단을 **정지 게이트 실패 시점**으로 앞당길지(배포 전 경고) 결정한다.
- §1-DI 의 2겹(확인 모달 → Execute → settle → Stop)·3겹(MCP `diagnose_stuck_thread`)은 그대로 대기.

---

## 1-DN. 2026-09-10 세션 — `Start` 에 `-compile` 이 빠져 올린 소스 대신 옛 바이너리가 실행되던 문제

### 증상 (사용자 발견)

`GPL: Start` 로 실행하면 FTP 로 `/GPL` 에 방금 올린 소스가 아니라 **이전에 실행했던 코드가 다시 실행된다.**
`-compile` 을 붙이면 올린 것이 실행된다.

### 원인 — 옛 하드 규칙 7 이 오독이었다

옛 규칙은 "PA 제어기의 `Start` 는 자체적으로 Compile 을 수행한다(사용자 실사용 사실, 2026-08-25 명시)"였고,
그래서 `startCommand.ts` 가 `-compile` 을 **금지**하고 있었다. 근거를 다시 대조하니 그 반대다.

`captures/gde_1402.pcapng` 에서 GDE 가 실제로 보낸 순서(오프셋 순, pcapng 블록 중복 제거):

| 순서 | 명령 |
| --- | --- |
| 1 | `Load /flash/projects/GPL_Code` |
| 2 | `COMPILE Test_robot` |
| 3 | `Start Test_robot -event` |

**GDE 는 Start 앞에 명시적 `COMPILE` 을 따로 보냈다.** 옛 규칙은 이 캡처의 3번만 보고 "스위치 없이 Start 했는데
새 코드가 돌더라 → 자체 컴파일한다"로 읽은 것이다. 실제로는 2번이 컴파일을 했고, 제어기의 `Start` 는 문서 그대로
**컴파일하지 않고 직전에 컴파일된 바이너리를 실행**한다(이번엔 Brooks 문서 쪽이 맞았다 — 문서 회의주의는
"문서를 무시하라"가 아니라 "실기기로 확인하라"이다).

확장은 Compile 을 따로 보내지 않는 경로가 셋이라 그대로 직격당했다.

| 경로 | 보내던 명령 | 실제 결과 |
| --- | --- | --- |
| `gpl.start` | `Start <proj> -event` | 옛 바이너리 실행 |
| `gpl.uploadStart` (업로드 스타트) | 업로드 후 `Start <proj> -event` (Compile 의도적 생략, §1-CD) | **업로드한 소스가 전혀 반영 안 됨** |
| 디버거 F5 | `Start <proj> -bex -break -event` | 옛 바이너리에 브레이크포인트 |
| MCP `start_project` | `Start <proj>` (`-event` 도 없음) | 옛 바이너리 + 1403 이벤트 없음 |

### 조치

1. **`startCommand.buildStartCommand` 에 `compile` 옵션 신설, 기본 `true`** — 문서 구문 순서대로 `-break` 뒤,
   `-event` 앞에 `-compile` 을 넣는다. 빼려면 `compile: false` 를 **명시**해야 한다(직전에 `Compile` 명령으로
   이미 컴파일한 경로가 이중 컴파일을 피하고 싶을 때만). 조립기가 하나이므로 위 네 경로 중 확장 셋은
   호출부 변경 없이 함께 고쳐졌다.
2. **MCP `start_project`** 는 조립기를 공유하지 않고 손조립이라 확장과 같은 형태로 맞췄다 —
   `Start <proj> -compile -event` / `stopOnEntry` 면 `Start <proj> -bex -break -compile -event`.
   (`-event` 누락은 §1-DE 의 FTP Run 과 같은 계열의 누락이었다.)
3. **같은 전제로 쓰였던 서술을 전부 정정** — 하드 규칙 7(이 문서 §0·`CLAUDE.md`·`AGENTS.md`·
   `.github/instructions/`), `package.json` 설정 설명 2건, `README.md`, MCP 지침(`guidelines.js`·도구 설명),
   소스 주석·사용자 안내 문구 12곳. `controllerTreeProvider.ts` 의 "옛 바이너리 문제는 아니지만"처럼
   **정면으로 틀린 서술**이 있어 남겨 두면 다음 작업자가 같은 오독을 반복한다.

**바뀌지 않은 것**: `-event` 기본값(GDE 동일, 1403 이벤트로 상태 수신), R3 완충(`startAfterCompileGapMs`),
"Compile 직후 Start 연속 금지". 마지막 항목은 근거가 "Start 가 자체 컴파일하므로"에서 "Start 의 `-compile` 이
컴파일하므로"로 바뀌었을 뿐 결론은 같다(컴파일 중복).

### 검증

- 확장 테스트 **902/902 통과**. `startCommand.test.ts` 기대값을 새 기본값으로 갱신하고
  "`-compile` 은 기본으로 항상 붙는다"·"`compile: false` 를 명시할 때만 뺀다" 2건을 추가
  (옛 "절대 붙이지 않는다" 테스트를 대체). `projectCommands.test.ts` 기대 명령 6곳 갱신.
- `node --check` 로 MCP 서버 문법 확인, `package.json` 파싱 확인.

### 후속 (같은 날) — 첫 실기 시도에서 드러난 응답 대기 문제

`-compile` 을 붙인 첫 실기 실행에서 Start 가 실패로 보고됐다.

```
CMD Start MergeCode -compile -event
RAW <DATA>... begin compiler pass 1 | ... begin compiler pass 2      <- 여기서 잘림
X Start failed: STATUS -9999: No STATUS found
```

**`-compile` 은 정상 동작했다** — 제어기가 compiler pass 를 돌리고 있다. 문제는 **응답 대기 규칙**이었다.
컴파일은 pass 사이에 수 초간 침묵하므로 `Compile` 명령은 예전부터 `waitForStatusClose: true` +
`max(cfg.timeoutMs, 60000)` 으로 받고 있었는데(`deployService`·`ftpCommands` 의 `forCompile` 플래그),
`Start` 는 즉답 명령이라는 전제로 기본 타임아웃(10 s)에 idle 조기 완료를 쓰고 있었다.
`-compile` 이 붙으면서 Start 의 응답이 Compile 과 같아졌으므로 대기 규칙도 같아야 한다.

**조치** — 판정을 한 곳에 모으고 Start 를 보내는 네 경로에 모두 적용했다.

| 경로 | 전송 | 조치 |
| --- | --- | --- |
| `projectCommands.startProject`(배포·FTP Run) | 주입형 IO | `runStatusCommand` 에 `opts` 추가 → `forCompile` 전달(두 IO 는 이미 처리하고 있었다) |
| `gpl.start` | `sendCommand` 직접 | `sendCommandDetailed` + `waitForStatusClose` |
| 디버거 F5 (`_sendCmd`) | `sendCommand` 직접 | 같은 조건 분기 |
| MCP `start_project` | `runCommand` | `timeoutMs: max(TIMEOUT, 60000)` (`compile_project` 와 동일) |

판정은 `startCommand.commandRunsCompiler(command)` 하나가 한다 — `Compile ...` 이거나
`Start ... -compile ...` 이면 참. 프로젝트 이름에 `compile` 이 들어가도 스위치가 아니면 거짓이다.

**관측**: 실패 직후 `show_threads` 는 쓰레드 0개였다 — 그 Start 는 실행에 이르지 못했고 제어기에 남은
것도 없었다. 타임아웃이 곧 실패는 아니지만(§0 하드 규칙), 이 건은 관측으로 미실행이 확인됐다.

확장 908/908 통과.

### 남은 일

- **실기기 재확인**: 대기 규칙을 고친 뒤 `gpl.uploadStart` 가 새 소스를 실제로 실행하는지. 이 경로는
  Compile 을 생략하는 설계라 `-compile` 하나에 전적으로 의존한다.
- **이중 컴파일 관측**: `Deploy & Run`(Compile 후 Start `-compile`)은 이제 같은 컴파일을 두 번 한다.
  옛 규칙의 "컴파일 중복은 위험 의심"은 잘못된 전제에서 나온 추정이었으므로 재평가 대상 —
  소요 시간을 실기기에서 재고, 부담되면 그 경로만 `compile: false` 로 빼는 것을 검토한다
  (조립기 옵션은 이미 있다).

---

## 1-DO. 2026-09-10 세션 — `Thread.CurrentThread().` 뒤 자동완성이 `Thread.Abort()` 를 통째로 넣던 문제

### 증상 (사용자 발견)

`_network_NetManager.gpl` 에서 `Thread.CurrentThread().` 까지 치고 자동완성을 고르면

```gpl
Thread.CurrentThread().Thread.Abort()   ' 실제로 삽입된 것
Thread.CurrentThread().Abort()          ' 정상
```

처럼 **클래스 접두부(`Thread.`)가 붙은 채로** 삽입됐다.

### 원인 — 두 겹이었다

1. **체인 해석 실패**: `completionProvider.resolveQualifierType` 은 첫 세그먼트만 내장 클래스로 해석하고,
   2번째 이후 세그먼트는 **사용자 심볼의 `returnType` 으로만** 하강했다(주석에도 "내장 반환 타입 체이닝은 미지원").
   그래서 `Thread`(내장 클래스) → `CurrentThread()` 에서 곧바로 미해석이 됐다.
   같은 하강 규칙을 이미 갖고 있는 순수 모듈 `language/receiverType.ts`(§1-AU, hover·디버그 hover 가 사용)에는
   `memberReturnType` 훅으로 `Thread.CurrentThread → Thread` 가 들어 있었는데, 완성 provider 만 자체 구현을
   쓰고 있어 그 지식을 못 받았다.
2. **미해석 폴백이 멤버 자리를 고려하지 않았다**: 해석 실패 시 `.` 뒤에서도 **전역 목록 전체**를 돌려줬고,
   거기에는 `label`/`insertText` 가 `Thread.Abort` 인 dotted 내장 항목이 그대로 들어 있다. 고르면 그 문자열이
   통째로 삽입된다 — 이것이 사용자가 본 결과다. (전역 함수·키워드·문 스니펫도 멤버 자리에 뜨고 있었다.)

### 조치

1. **체인 해석을 `receiverType` 으로 이관.** `resolveReceiverTarget(receiver, lookup)` 을 신설했다 —
   기존 `resolveReceiverTypeName` 이 이름만 돌려주는 것과 달리 **어느 사전에서 멤버를 꺼낼지**(`class` /
   `module` / `builtinClass`)와 **멤버가 없는 원시 타입**(`primitive`)을 구분해 준다. 완성 목록은 이 구분이
   필요하다: 원시 타입(`i.`)은 **빈 목록**, 미해석은 **폴백**으로 갈라져야 하는데 이름만으로는 둘 다 `undefined` 라
   구분할 수 없었다. 내부적으로는 하강 단계를 `TypeResolution{name, primitive}` 로 바꾸고, 이름만 쓰는 기존
   API(`resolveReceiverTypeName`·`resolveReceiverHolder`)는 원시 타입을 undefined 로 접어 **종전 동작 그대로** 뒀다.
2. **completionProvider 의 자체 해석기 삭제**(`resolveQualifierType`·`typeNameToTarget`·`resolveLocalType`·
   `getBuiltinClassNames`, 약 90줄) → `buildDocumentReceiverLookup(..., GPL_BUILTIN_RECEIVERS)` +
   `resolveReceiverTarget` 호출로 대체. 문자열 체인을 세그먼트로 옮기는 파서도 `cursorExpression.parseChainSegment`
   로 공용화했다(디버그 식 추출이 쓰던 지역 람다를 export).
3. **미해석 폴백을 멤버 자리용으로 교체**(`getUnresolvedMemberCompletions`) — 멤버가 될 수 있는 후보만 준다:
   내장 **dotted** 항목의 tail(`Abort`, 어느 클래스인지는 `detail` 에 `GPL Built-in · Thread.Abort` 로 표기)
   + 워크스페이스 심볼(이름 그대로라 안전). 전역 함수(`CInt`, `Mid`)·키워드·문 스니펫·XML 스니펫은 제외한다.
4. 내장 멤버 항목 생성을 `buildBuiltinMemberItem` 하나로 모아, **접두부 제거가 한 곳에서만 일어나게** 했다
   (해석 성공 경로와 폴백 경로가 서로 다른 규칙을 갖지 않도록). `insertSnippet` 의 인자 자리표시자는 살린다.

### 부수 효과 (의도한 개선)

- `Me.` 뒤가 이제 감싸는 클래스의 멤버로 뜬다(옛 자체 해석기는 `Me` 를 몰라 전역 목록으로 빠졌다).
- 동명 로컬이 내장 클래스 이름을 가린다 — `Dim thread As MyClass` 가 있으면 `thread.` 는 MyClass 멤버다
  (옛 구현은 내장 클래스 이름을 먼저 봤다).
- 원시 타입 뒤(`n.`)는 빈 목록으로 유지되고, 원시 타입 뒤로 더 하강하는 체인은 미해석으로 떨어진다.

### 검증

- `npm test` **906/906** (신규 3건: `resolveReceiverTarget` 의 내장/사용자/모듈/중첩 클래스 구분,
  원시 타입과 미해석의 구분, `parseChainSegment`). 컴파일 무경고.
- 실제 편집 UX 는 Extension Development Host 에서 사용자 확인 필요 — 확인 포인트는
  `Thread.CurrentThread().` / `Me.` / 로컬 변수 뒤 / 모듈 이름 뒤.

### 남은 일

- **`definitionProvider` 도 자체 체인 해석을 갖고 있다**(receiverType 헤더의 "점진 이관 대상" 중 남은 하나).
  같은 원인으로 내장 멤버 반환 타입을 못 따라가므로 정의 이동에서 같은 계열의 실패가 있을 수 있다.
- 완성 provider 에 남은 **프로젝트 특화 하드코딩**: `getGPLDictionaryCompletions` 의 Quick Ref 스니펫이
  `IO_FileManager`·`Core_StringUtils`·`Data_XmlAsyncSave` 등 특정 프로젝트 모듈을 열거하고,
  `getVBCompatibilityCompletions` 는 `Le`/`Ri`/`Val` 입력에 반응하며, `isXmlContext` 는 줄에 `xml`·`encode`·
  `entity` 가 있으면 XML 스니펫을 끼워 넣는다. 일반 GPL 사용자에겐 소음이라 정리 후보(사용자 확인 필요).

---

## 1-DP. 2026-09-10 세션 — 표준화: 판정 정본(SSOT)을 문서가 아니라 **테스트**가 지키게

### 요청

사용자가 이 저장소의 작업 기준을 명시했다 — 손상 방지 계층(ACL, Anti-Corruption Layer) ·
단일 진실 공급원(SSOT, Single Source of Truth) · 중복 배제 원칙(DRY, Don't Repeat Yourself) ·
의존성 주입(DI, Dependency Injection). 용어 표기 자체는 이미 `docs/development/architecture.md` §3.2 에
정본으로 있었으므로, 이번 작업은 **그 원칙이 코드에서 실제로 지켜지게 만드는 것**으로 잡았다.

### 진단 — 계층 규칙은 "사본"을 막지 못한다

구조 테스트 R1~R3 은 *어디에 두는가*(vscode 의존·의존 방향·순환)만 강제한다. 같은 판단을 여러 모듈이
각자 구현하는 것은 **폴더 규칙을 하나도 어기지 않고** 일어난다. 실측한 사본은 두 종류였다.

| 판단 | 사본이 있던 곳 | 결과 |
| --- | --- | --- |
| 수신자 해석 컨텍스트 조립(문서 파싱 + 프로시저 범위 + 내장 사전 훅) | hover ×2 · 디버그 hover · 완성 | 완성 provider 는 아예 **자체 해석기**를 들고 있다가 `Thread.CurrentThread().` 뒤를 못 풀었다(§1-DO) |
| 배열 요소 타입 벗기기(`Foo[]` → `Foo`) | definition ×2 · reference · rename · overloadResolution | 표기(`Foo()`·`Foo(,)`)가 늘어도 한쪽만 고쳐진다 |

definitionProvider 는 한 겹 더 나빴다 — 점 **바로 앞 식의 첫 이름만**(`extractBaseObjectName`) 보고 타입을
정했다. `a.b.member` 는 b 가 아니라 a 에서 멤버를 찾았고, `Me.` 나 내장 멤버를 거친 체인은 아예 해석하지
못한 채 "한정자를 버린 전역 이름 폴백"으로 흘러 **동명의 남의 심볼로 점프**했다(그 폴백이 위험하다는 것은
§1-AU 에서 이미 지적된 것이다).

### 조치

1. **조립 정본 신설 — `providers/receiverContext.ts`.** `buildReceiverContext(document, atLine, findAllByName, docSymbols?)`
   하나가 문서 파싱·프로시저 범위·내장 사전 훅을 조립한다. 사본 4벌 제거. 이 모듈은 `SymbolCache` 를
   import 하지 않고 **이름 조회 함수만 주입받는다**(DI) — `controller/` 절차 모듈이 `send`/`log` 를 받는 것과 같은 규약.
2. **definitionProvider 이관.** 체인 추출(`extractQualifierChainBefore` + `parseChainSegment`) → 공용
   `resolveReceiverTarget` → 홀더 안에서 멤버 조회. 모듈·정적 클래스·인스턴스 세 갈래가 로그 문구만 다른
   같은 조회를 복제하고 있어 `findMemberDefinitionIn` 하나로 합쳤다. 내장 수신자 차단(전역 폴백 금지)은
   해석 결과 `builtinClass` 로 그대로 판정된다 — `hasUserContainerNamed`·`isGplBuiltinClassName` 호출이 필요 없어져 삭제.
3. **배열 표기 정본화.** `receiverType.elementTypeOf` 에 더해 `isArrayTypeName` 을 export 하고, 배열 표기 정규식은
   파일 안에서도 상수 하나(`ARRAY_TYPE_SUFFIX`)로 모았다. definition·reference·rename·overloadResolution 의 사본 제거.
4. **체인 파서 확장.** `extractQualifierChainBefore` 가 연달아 붙은 괄호 그룹(`arr(0)(1).`)을 모두 소비한다 —
   하나만 소비하면 남은 `)` 때문에 체인 전체가 미해석이 되어 종전(첫 이름만 보던 방식)보다 오히려 좁아졌다.
5. **구조 테스트 R7 신설 — 판정 정본 우회 금지.** `SSOT_RULES` 표에 *무엇을 판단하는 규칙인가 · 정본 모듈 ·
   우회 표식(정규식) · 대신 쓸 것 · 정본이 제공해야 하는 export* 를 적어 두면, 정본 밖에서 그 표식이 나타날 때
   실패한다. 주석 언급은 위반으로 세지 않고(`codeOnly`), **정본에서 export 가 사라지면 "표가 낡았다"로 실패**해
   규칙 자체의 부패도 막는다. 새 정본을 세우면 표에 한 줄만 추가한다.

### 검증

- `npm test` **911/911**. 신규 3건(`isArrayTypeName`, 연속 괄호 체인, R7) + §1-DO 의 3건.
- **R7 변이 테스트**: `renameProvider` 에 `replace(/[]$/…)` 를 일부러 되살리자 R7 이 위반 모듈·규칙·대체 수단을
  찍고 실패했고, 되돌리자 911/911 로 복귀했다(규칙이 실제로 잡는지 확인).
- 편집 UX(F12/자동완성/hover)는 Extension Development Host 확인이 남아 있다 — 확인 포인트는
  `a.b.member` 의 정의 이동, `Me.` 뒤, 내장 수신자(`Move.Run`)에서 엉뚱한 점프가 없는지.

### 남은 일

- **`referenceProvider`·`renameProvider` 의 한정자 판정도 아직 자체 규칙**이다(수신자 체인이 아니라
  한정자 한 토큰만 본다). 정의 이동과 같은 이관 대상이지만, 이름 바꾸기는 **오탐이 파일을 고치는** 쪽이라
  실사용 검증을 붙여 별도 세션에서 하는 편이 안전하다.
- R7 표에 넣을 다음 후보: 주석/문자열 판정(`isInCommentOrString` 대 각 모듈의 자체 스캐너 — 용도가 달라
  선별 필요), 1403 상태 문구 두 표현(§7 부채 표).

---

## 1-DQ. 2026-09-10 세션 — 명령 UI 정리: `category` 분리 · 팔레트 위생 · 패널 메뉴 슬림화

### 발단

사용자가 제어기 패널 `···` 메뉴 스크린샷을 보내며 "표시를 3개씩이나 하니까 어지럽다", "이거 전부 패널쪽에서
선택해서 고를 수 있잖아"라고 지적했다. 기여 명령 81개 전수를 뽑아 대조했다(인벤토리 아티팩트로 발행).

### 진단 — 두 가지가 겹쳐 있었다

**① `category` 미사용.** 81개 중 63개가 제목에 `GPL:` 을 직접 박고 있었다. VS Code 는 `category` 를
**팔레트에서만** 접두어로 붙이고 메뉴에서는 떼는데, 제목에 넣으면 뗄 수가 없다. 그래서 패널 `···` 메뉴의
모든 줄이 `GPL:` 로 시작해 정작 구별되는 단어가 오른쪽으로 밀려 있었다 — 사용자가 본 "어지러움"의 실체다.

**② 팔레트 위생.** 팔레트 노출 규칙이 3개뿐이라 81개 중 78개가 무조건 떴다. 그중 36개는 사람이 팔레트에서
부를 수 없는 것이다 — 트리 노드를 인자로 받는 25개(`쓰레드 시작`·`스텝 오버`·`다운로드`·`Unload` …)는
구현이 `if (!node?.thread?.name) { return; }` 로 조용히 빠져나가 **아무 일도 일어나지 않고 이유도 안 나오며**,
`gpl.ai.debug.*` 11개는 MCP·URI 전용 진입점이다.

### 조치

| 항목 | 전 | 후 |
| --- | --- | --- |
| 제목의 `GPL:` 하드코딩 | 63 | 0 (`category: "GPL"` 로 분리) |
| 팔레트 무조건 노출 | 78 | 42 |
| 패널 `···` 오버플로 | 22 | 14 |

**제목 표기**는 사용자 선택대로 **영문 원어 + 한국어 병기**로 81개를 통일했다
(`Deploy (/GPL 업로드 + 컴파일, 실행 안 함)`, `Start Thread (쓰레드 시작)`). 종전에는 영어(`Save to Flash`)·
한국어(`업로드 스타트`)·접두어 없는 트리 전용(`재개`)이 규칙 없이 섞여 있었다.

**패널 `···` 에서 뺀 것**과 근거:

- `pushBreakpoints` — **`syncBreakpoints` 의 부분집합이다.** push 는 `pushAll()`(추가만), sync 는
  `reconcileAll()`(에디터에 없는 잔재 해제 + 빠진 것 설정). 소스 주석에도 "push(추가만)와 달리"라고 적혀 있다.
  사용자가 "3개나 있어야 해?"라고 물은 셋 중 하나를 근거를 갖고 뺐다. `pull` 은 **반대 방향**이라 남긴다.
- `showTraffic` — 트리의 `1402 통신 모니터` 항목에 이미 있다.
- `checkAgentSetup` — `exportAgentSetup` 이 끝나고 **자동으로 점검**하도록 통합했다(문제가 있을 때만 알린다).
  명령 자체는 팔레트에 남는다(재점검용).
- 콘솔 4종(`console.start/stop`, `liveTerminal.start/stop`) — 트리 `런타임 콘솔` 항목의 컨텍스트 메뉴로 옮겼다
  (`stop` 은 이미 거기 있었다).
- `threads.refresh` — VS Code 관례대로 **상단 아이콘**(`$(refresh)`)으로 승격.

**남긴 것**: `Send Command`·`Copy Situation`·`Reset Panel Layout` 은 사용자가 "패널에서 고를 수 있잖아"라고
했지만 **대조 결과 트리 항목이 없다**. 빼면 접근 경로가 사라지므로 `···` 에 유지했다(§3 에 결정 대기로 남김).

**그룹 번호**도 `1_deploy`/`2_debug`/`2_tools`/`3_console`/`3_diag`(2·3 중복)에서
`1_deploy`/`2_debug`/`3_tools`/`4_diag`/`9_connection` 으로 정리했다.

### 재발 방지

`aiCommandPolicy.ts` 는 차단 명령의 표시 이름을 문자열로 들고 있다(AI 에게 "사람에게 이 이름으로 부탁하라"고
알려주는 값). 제목을 바꾸자 곧바로 어긋났으므로, 테스트를 **package.json 의 `category` + `title` 과 대조**하도록
바꿨다 — 앞으로 제목만 고치면 테스트가 잡는다.

### 검증

확장 **912/912 통과**(구조 R5 "package.json 이 선언·참조하는 명령은 모두 소스에서 등록된다" 포함).
`pre-release-check` 의 README 정책 통과. README 명령 표도 새 이름으로 갱신하면서, 아직 남아 있던
"PA 제어기의 `Start`는 자체적으로 컴파일을 수행하므로" 설명과 실재하지 않는 이름
(`GPL: Quick Debug Attach (No launch.json)`)을 함께 정정했다.

### 남은 일

### 후속 (같은 날) — 보류 3건에 대한 사용자 결정

| 제안 | 결정 | 근거 |
| --- | --- | --- |
| `Deploy` 를 업로드 전용으로 | **유지** | "잔재 정리 전체 업로드 있는 게 좋긴 하겠네" — 전체 미러 업로드는 Quick Compile(변경분만)로 대체되지 않는다 |
| `Start` 제거 | **유지** | "Start 만 하는 거? 냅둬" — 업로드 없이 재실행하는 유일한 경로 |
| `Debug: Deploy & Attach` / `Debug Project` 통합 | **통합함** | "활성 문서 기준은 좀 불안정해서 QuickPick·탐색기 우클릭으로" |

**통합 내용**: `gpl.debug.attachNow` 를 제거하고 패널 `···` 의 그 자리를 `gpl.debugProject` 로 바꿨다.
근거는 대상 선택 방식이다 — `attachNow` 는 `resolveExpectedProjectName()`(launch.json → 워크스페이스 자동 탐지)로
대상을 **추론**했는데, 과제별로 같은 이름의 프로젝트를 복제해 두는 실제 배치에서는 엉뚱한 것을 고를 수 있다.
배포는 되돌리기 어려우므로 배포를 동반하는 경로는 대상을 **명시적으로 고르게** 한다.
`gpl.debug.attachOnly`(상단 아이콘)는 자동 탐지를 그대로 쓰지만 **붙기만 하고 제어기 상태를 바꾸지 않으므로** 남긴다.

확장 912/912 통과. 패널 `···` 오버플로는 14개 그대로(자리를 교체한 것이라 개수는 같다).
