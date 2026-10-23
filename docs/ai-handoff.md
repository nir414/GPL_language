# AI 인계 자료 — GPL Language Support 확장 작업 핸드오프

- **최종 갱신: 2026-10-23** · 현재 package 버전 **0.16.3** (원격 수정과 로컬 기능 병합. 검증·패키징 결과는 §1-FU 참조.)
- **직전 세션: §1-FU** — 로컬 변경 28개를 원본 백업·stash에 보관한 뒤 원격 커밋 2개를 fast-forward하고 재적용했다. 양쪽 기능·이력을 보존하고 테스트의 OS 경로 기준을 맞췄다.
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
7. **PA 제어기의 `Start`는 스위치 없이는 컴파일하지 않는다 — `-compile`을 반드시 붙인다(2026-09-10 사용자 실기 관측, §1-DN).** `-compile` 없이 `Start`하면 제어기는 컴파일하지 않고 **직전에 컴파일돼 있던 바이너리를 그대로 실행한다** — FTP로 `/GPL`에 올린 새 소스가 반영되지 않는다. 캡처(`captures/gde_1402.pcapng`)의 GDE도 `Load /flash/projects/GPL_Code → COMPILE Test_robot → Start Test_robot -event` 순으로 **Start 앞에 명시적 `COMPILE`을 따로 보냈다**. ~~옛 규칙: "Start가 자체적으로 Compile을 수행한다(2026-08-25 명시)"~~ — 그 캡처의 `-event`만 보고 내린 오독이었고 **무효**다. 확장은 `startCommand.buildStartCommand`가 `-compile`을 기본으로 붙여 보장한다(`compile: false`를 명시할 때만 뺀다). **여전히 유효한 함의: Compile 직후 Start를 연속으로 보내지 않는다(컴파일 중복) — 한 번에 하나만.** (2026-08-28 §1-BN: 명령 정책 R3이 같은 프로젝트의 Compile 응답 완료 뒤 `gpl.controller.startAfterCompileGapMs`(기본 1.5 s) 완충을 두고 Start를 보낸다 — 안전성 미검증이라 거부가 아닌 완충.) Deploy는 Compile까지, 실행은 `GPL: Start`가 별도. "컴파일 검증 필요" 상태는 아직 별도 Compile 성공을 확인하지 못했다는 뜻이며, Start `-compile`이 실패하면 §1-EW부터 에러 위치를 Problems에 표시한다.

---

8. **제어기 채널은 번호가 아니라 이름으로 부른다 (2026-09-22 사용자 결정, §1-EB).** `1402`·`1403` 은 번호를 외운 사람에게만 뜻이 통한다 — 사용자 대면 문구(트리·알림·명령 제목·설정 설명·보고서)와 AI 대면 문구는 **명령 콘솔**·**런타임 콘솔**·**FTP** 로 쓴다. 번호는 ① 설정 값 ② `ip:port` 엔드포인트 ③ 원인을 가리는 진단 상세에서만 덧붙인다(`명령 콘솔(1402)`). 용어 정본과 헬퍼는 `controller/protocol/channelNames.ts`, 명령 제목은 구조 테스트 **R8** 이 지킨다. 그대로 두는 것: 로그 태그(`[1402]`·`[Console][RC1403]`)·설정 키(`keepAlive1402`)·포트가 주제인 프로토콜 문서(`docs/reference/console-commands.md`)·과거 기록(CHANGELOG·아카이브).

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

- **(2026-09-02, §1-CU) `WorkspaceSourceLoader.indexWorkspace()`에 전역 상한을 둘지 — 사용자 결정 대기.**
  워크스페이스의 모든 `.gpr` 프로젝트 소스를 수집하며 프로젝트별 상한(`collectProjectSourcePaths`의 `truncated`)은
  있지만 전역 상한은 없다. UTF-8은 디스크에서 직접 읽고 다른 설정 인코딩만 VS Code 디코더로 연다.
  파일 수·소요 시간 요약과 32파일마다 이벤트 루프 양보는 이미 구현돼 있다(§1-DX, §1-FK 재확인).
  다수 프로젝트에서 실제 지연을 관측한 뒤 상한·진행 표시 등 추가 정책을 정한다. 일부 파일을 조용히 제외하는 상한은 도입하지 않았다.

---

## 3. 다음에 할 일 (체크리스트)

- [ ] **(2026-10-23, §1-FT) `.gpo` 설명 정정 검토.** `package.json`의 소스 확장자 설정 설명과 `src/project/gprSync.ts` 주석은 `.gpo`를 컴파일 산출물로 적고 있으나, Brooks GDS 공식 설명서는 모션 객체·전역 GPL 변수를 담는 전역 모듈 파일로 설명한다. 실제 파일 취급과 대조해 이 설명을 바로잡는다. 이번에는 README만 GPL/GPR 중심으로 정리하고 실행 코드·설정 선언은 수정하지 않았다.

- [ ] **(2026-10-22, §1-FQ) Hover 성능 — 새 VSIX 편집기 확인.** PoseFile.gpl:132의 AxisCount와 여러 파일의 함수 이름에서 첫 마우스 Hover·재방문 반응을 확인한다. 실제 소스 하니스에서 VS Code의 표시 대기·렌더링·다른 확장의 경합은 측정하지 않았다.

- [ ] **(2026-10-22, §1-FN) Hover 수정 — 새 VSIX 편집기 확인.** PoseFile.gpl:132의 axes·table·AxisCount 위에서 각각 Integer 변수·JointPoseTable 매개변수·AxisCount() As Integer 시그니처가 표시되고 범위가 해당 식별자로 나뉘는지 확인한다. 자동 회귀 6건과 전체 1222건은 통과했다.

- [ ] **(2026-10-22, §1-FK) 구조 개편 후속.** 0.14.3의 F5 활성화·정의/참조·완성·호버·워처 갱신을 확인한다. 다음 코드 작업은 GPLDebugSession의 중단점·변수·실행 제어·폴링 객체 합성이며, 전체 순서는 `docs/development/architecture.md` §2.3을 따른다. 연결·배포·디버그 실행 순서 변경은 별도 안전 시험에서 검증한다.

- [ ] **(2026-10-22, §1-FH) 간단한 hello-project — F5 UI 및 제어기 컴파일·실행 확인.** Main.gpl의 Add·Clamp에서 F12·Shift+F12·F2·호버·시그니처 도움말, counter 객체 완성·Count Property·Outline·접기를 확인한다. 제어기에서는 출력 sum: 3 / clamped: 100 / count: 3과 Increment 호출 중단점의 스텝·변수를 확인한다. 정적 검사와 관련 테스트 55/55만 수행했다.

- [ ] **(2026-10-22, §1-FG) 수신함 후속과 0.14.0 검증.** `REQUESTS.md` 표의 미구현 항목을 유지한다. 새 VSIX에서 메모리 가드의 사람/MCP 차단·측정 실패 표시, Upload Only의 기존 FTP 전용 계약, 수신 대기 중 후속 Stop 접수, 선택 Try 안내를 확인한다. 실제 Compile/Start/Stop은 안전한 시험 조건과 별도 승인 범위에서만 수행한다.

- [ ] **(2026-10-22, §1-FF) Marketplace 실제 등록·게시/자동 업데이트 확인.** 게시자 소유권 확인, 검증 VSIX 최초 게시, Entra identity/Marketplace Contributor·GitHub Environment secrets/OIDC 연결, `MARKETPLACE_PUBLISH=true` 설정 후 정식 태그 job과 Marketplace 공개 버전 확인. VSIX 기존 설치의 Auto Update 전환 확인. 로컬 수정과 실제 서비스 연결은 구분한다.

### 명령 UI — 남은 결정

- [ ] **`Send Command`·`Copy Situation`·`Reset Panel Layout` 을 트리로?** 사용자는 "패널에서 고를 수 있잖아"
      라고 했지만 **대조 결과 이 셋은 트리 항목이 없다** — 그래서 `···` 에 남겼다. 트리에 넣을 자리를 만들지 결정 필요.

열린 항목만 둔다. 완료된 항목은 `docs/archive/handoff/2026-08.md` §부록으로 옮겼다(2026-08-31 정리).

- [ ] **(2026-10-21, §1-FE) Stop All의 업로드/배포 취소 — 새 VSIX/제어기 확인.** ① `Upload & Start`의 FTP
      진행 중 `GPL: Stop All Threads` → 현재 파일 경계 뒤 추가 업로드·원격 삭제가 없고 Compile/Start가 전송되지 않으며 작업이
      `CANCELLED`인지 ② 같은 제어기에 대기 중인 두 번째 배포도 잠금 획득 전에 취소되는지 ③ 원시 `Stop -all`/`Stop -a`,
      디버그 중지, MCP `stop_threads()` 전체 범위도 같은지 ④ Compile/Start가 이미 명령 콘솔로 전송된 순간이면 해당 응답 정리 뒤
      다음 단계가 없고 외부 Stop이 최종 정착시키는지 ⑤ Save to Flash 취소는 파일 경계에서 멈춘 뒤에도 `Sync`·Disk Busy 해제·
      10초 안정화 확인을 마치며, 안전 미확인 시 경고를 유지하는지 확인한다. 실기 전송은 안전한 프로젝트·장비 조건에서만 수행한다.

- [ ] **(2026-10-21, §1-FD) Flash 저장 중 전원 차단 금지 경고 — 새 VSIX/제어기 확인.** 변경 파일이 있는 프로젝트에서
      Save to Flash를 실행해 ① FTP 쓰기 시작부터 상태바의 「FLASH 저장 중 — 전원 끄지 마세요」가 보이는지
      ② 명령 콘솔 Traffic의 `Sync`가 종결 `STATUS 0`을 받은 뒤에도 10초 카운트다운이 이어지고 그 뒤에만 경고가 사라지는지
      ③ 실제 제어기의 Flash Busy 표시 소멸 시점과 `Sync` 완료가 일치하는지 대조한다. 연결 해제·`Sync` 타임아웃·종결 STATUS 누락은
      「FLASH 안전 상태 미확인」 경고가 계속 남아야 하며, 이때는 물리 표시가 사라진 뒤 10초가 지날 때까지 전원을 끄지 않는다.
      취소·FTP 부분 실패 경로도 같은 안전 확인을 거치는지 확인한다. 이 검증 중에는 실제 전원을 차단하지 않는다.

- [ ] **(2026-10-21, §1-FB) 디지털 I/O 제어판 — 새 VSIX/UI/제어기 확인.** ① 트리 `I/O · 전역변수` →
      `디지털 I/O 제어판`이 기존 대시보드의 I/O 탭을 바로 열고, 상태 탭 왕복·일시정지·수동 새로고침이 정상인지
      ② 실제 `Show DIO` 원문과 카드의 신호 수·번호·ON/OFF·`FORCED(*)`가 일치하고 검색·전체/ON/OFF/강제됨 필터가 맞는지
      ③ 안전한 시험 신호(시뮬레이션 또는 장비 영향이 명확히 차단된 조건) 하나에서 강제 ON(`1`)·OFF(`-1`)·해제(`0`)를
      확인 모달과 함께 실행해, 중복 클릭이 막히고 성공 뒤 즉시 재조회되는지. **실장비 신호는 영향 범위를 확인하기 전 조작하지 않는다.**
      ④ 연결 해제·유실 시 I/O 폴링이 멈추고 OFFLINE 안내만 남으며, 재연결 뒤 현재 탭 갱신이 재개되는지.

- [ ] **(2026-10-21, §1-FC) Upload Only·다중 프로젝트 대기열 — 새 VSIX/제어기 확인.** 실행 중인 안전한 시험
      프로젝트를 유지한 채 서로 다른 프로젝트 폴더에서 `Upload Only`를 연달아 실행해 ① 둘째 요청이 `LOCKED`로 끝나지 않고
      `operation_status`에 `QUEUED / QUEUE_WAIT`로 보이는지 ② Output의 `[Queue]` 순서대로 두 FTP 업로드가 직렬 실행되는지
      ③ Traffic에 Stop·Show Thread·Compile·Start가 없고 실행 쓰레드가 유지되는지 ④ 업로드 뒤 `컴파일 검증 필요` 배지가 뜨며
      FTP 목록만 갱신되는지 ⑤ 로컬에 없는 원격 전용 파일은 삭제되지 않는지 확인한다. 업로드 중 `Start`/Compile 경합 차단과
      「전체 정지」로 실행·대기 작업을 취소할 때 `CANCELLED` 기록이 남는지도 별도 저속/안전 조건에서 확인한다.

- [ ] **(2026-10-23, §1-FR) 제어기 프로젝트 열어 디버깅 — 새 VSIX/UI/제어기 확인.** FTP 프로젝트 우클릭·명령 팔레트 → 전용 작업공간 전환 → Workspace Trust → 같은 제어기/프로젝트에 한 번 Attach되는지 확인한다. Traffic에 업로드·Compile·Start·Stop·기존 BP 해제가 없어야 하며, Main과 라이브러리의 스택 위치·변수·BP를 확인한다. 0.16.1에서 라이브러리 탐색이 없는 하위 경로를 조회하지 않고 완료되는지도 확인한다(§1-FS). 초기 보존 BP는 분리 뒤에도 남고 세션이 추가한 BP만 해제돼야 한다. 재열기는 자동 Attach 없이 F5로 가능해야 한다. FTP 소스와 실행 바이너리의 일치는 별도 증거가 필요하다.

- [ ] **(2026-10-21, §1-FA) 새 FTP 작업공간 흐름 — VSIX/UI/제어기 확인.** 구현·순수 테스트는 완료됐다. 새 VSIX에서
      ① Live Working Copy로 `EM2RS_Probe` 다운로드 → 마지막 파일에서 진행 표시가 즉시 끝나고 완료 선택이 별도로 뜨는지,
      manifest의 파일 수·크기·SHA-256이 실제 사본과 맞고 `.gpl-download-*`가 남지 않는지
      ② 「Controller 작업공간 열기」 최초 전환은 Host 재시작 뒤 한 번 재연결하고, 같은 상위 폴더에 `Lib`를 두 번째로 받으면
      새 workspace root 추가·제목 없는 작업 영역 저장 질문·폴더별 신뢰 확인·연결 해제가 반복되지 않고 탐색기에 바로 나타나는지
      ③ `Lib/Lib_Core/Log/Logger.gpl` 저장 시 대상이 `/GPL/Lib`이고 `Lib_Log`로 해석되지 않는지(작업 소스 업로드 포함, flash 저장 없음)
      ④ Read-only Snapshot 저장·Quick Compile·Deploy/F5·Save to Flash가 FTP/명령 콘솔 전송 전에 차단되는지,
      다른 IP에서 받은 Live 사본도 현재 연결 주소와 다르면 같은 방식으로 차단되는지
      ⑤ EM2RS_Probe→Lib 정의/호버와 Attach Only의 소스 매핑이 유지되는지. Attach는 자동 실행하지 않으며
      `clearProjectBreakpointsOnAttach` 영향 확인 뒤 별도로 수행한다. 전용 작업공간 자동 삭제 정책은 아직 없다.

- [ ] **(2026-10-14, §1-EM) 연결 해제 시 1402 소켓 반납 — 창 2개 실기 재확인(조회만, 모션 무관).** 새 VSIX 로 ① 창 B 에서 연결 → 대시보드 열기 → 연결 해제 → 대시보드 배지가 `OFFLINE · 연결 해제됨` 으로 멈추고, GPL Traffic 에 그 뒤 `>>>` 가 없으며 `Get-NetTCPConnection -RemoteAddress 192.168.0.1` 에 창 B pid 의 1402 Established 가 **남지 않는지** ② 그 상태에서 창 A 가 연결되는지 ③ 창 B 에서 다시 연결 → 대시보드가 즉시 갱신을 재개하는지 ④ 미접속 창으로 MCP `controller_status` → 응답은 오고 소켓은 단발로 닫히는지(Traffic 에 `1402 CLOSE (single-shot)`). 연결 유실(`lost`) 경로도 대시보드가 `연결 유실` 로 멈추는지.
- [ ] **(2026-10-20, §1-EY) VS Code+AI 명령 콘솔 단일 세션 공유 — 새 VSIX/Export/MCP 재연결 뒤 확인(조회만, 모션 무관).**
      ① Sample Prep에 0.9.18 설치 → `GPL: Export AI Agent Setup` 재실행 → `.mcp.json` `GPL_BRIDGE:"only"` 확인 → AI `/mcp` 재연결
      ② 사람이 VS Code에서 연결한 상태로 `extension_status` → `bridgeMode:"only"`, `transport.using:"extension-bridge"`, Sample Prep 인스턴스 `connected:true`
      ③ AI 읽기 명령 1건 → Output/Traffic에 `(agent)`로 같은 명령·응답이 남고 `Get-NetTCPConnection`에 별도 MCP direct-tcp 소유자가 생기지 않는지
      ④ 확장 브리지를 잠시 끈 상태에서는 AI가 direct로 우회하지 않고 `GPL_BRIDGE=only — 확장 브리지를 쓸 수 없다`로 `not-sent`를 돌려주는지.
- [ ] **(2026-10-20, §1-EZ) AI 영구 기본 프로젝트 제거 — 새 VSIX/Export/MCP 재연결 뒤 확인(설정 파일·조회만, 모션 무관).**
      ① 구버전 `.mcp.json`에 `GPL_PROJECT`/`GPL_PROJECT_DIR`, `AGENTS.md` 자동 블록에 옛 `Lib_NetServer`가 있는 워크스페이스에서
      `GPL: Export AI Agent Setup` → 두 env 키 삭제, AGENTS 블록 버전 갱신·기본 프로젝트 문구 삭제, 사용자 본문 보존
      ② `GPL: Check AI Agent Setup` → 「설정 정상」이며 「작업 대상 미확정」·프로젝트 불일치 안내가 더는 나오지 않는지
      ③ `/mcp` 재연결 직후 대상 없는 `compile_project`/`deploy_project` → `PROJECT_TARGET_REQUIRED`(전송 없음),
      `project_target({projectDir})` 성공 뒤에는 인자 생략 호출이 그 세션 대상으로 가는지, `clear:true` 뒤 다시 거부되는지.
- [ ] **(2026-10-14, §1-EL) `stop_threads`·`unload_project` 사전 확인 — 실기 검증(정지 명령만, 모션 무관).** MCP 재연결(`/mcp`) 뒤
  ① 프로젝트가 별도 이름 쓰레드(`LOG_SOCKET`)를 띄운 상태에서 `unload_project` → `refused:"threads-active"` 와 목록이 오고 세션 로그에
  `Unload` 가 **안 나갔는지** ② `stop_threads({ project })` → `Stop LOG_SOCKET` 처럼 이름별 전송 + `settled:true`, 응답 `threads` 가 빈 목록
  ③ `stop_threads()` → `Stop -all` ④ 정지 불가 상태(§1-DM 재현)에서 2회 전송 뒤 `threads-still-active` + `diagnoseStuckThread` 안내
  ⑤ `-752` 가 오면 접수로 처리돼 settle 로 넘어가는지. 통과하면 §1-DI 의 3겹(MCP 진단 도구)과 묶어 결정.
- [ ] **(2026-10-14, §1-EQ) MCP 재확인 차단·대기 도구·런타임 콘솔 읽기 — 실기 검증(읽기 전용, 모션 무관).** 확장 재패키징·MCP 재연결 뒤:
  ① `deploy_project(mode:"build")` 성공 응답에 `next:"none"`·축약 `result`(해시 없음) → 같은 operationId 로 `operation_status` → `redundant:true` 요약만
  ② `deploy_project` 직후 다른 창에서 `operation_status({limit:5})` → 목록 항목 `resultSummary` 에 `uploaded N · … · inSync`
  ③ 배포 중 `wait_operation()`(인자 없이) → 완료까지 대기 후 상세 1회, `waitedMs` ≈ 배포 소요; 진행 중 아닐 때는 최신 완료 작업
  ④ `Start` 뒤 `runtime_console_read({waitMs: 20000, untilPattern: "<프로그램이 찍는 문구>"})` → 그 줄까지 `lines`·`matched:true`·`nextCursor`; 이어 `runtime_console_read({cursor: nextCursor})` 가 그 뒤 줄만;
     `%TEMP%\gpl-controller\runtime-console-192.168.0.1.log` 에 같은 줄이 ISO 시각과 함께 남는지; `gpl.runtimeConsole.captureFile:false` 면 `captureFile` 이 비는지
  ⑤ `list_remote_projects()` → `/GPL` 폴더별 fileCount/totalBytes/newestModifiedAt/lastCompiledFrom, 배포 중 호출은 `deploy-busy`
  ⑥ 1402 거부 상태(사용자 Upload & Start 중)에서 `show_threads` → 문자열 ERROR 가 아니라 `{ok:false, outcome, recommendedAction}`; `controller_status` → `likelyCause` 에 배포 잠금
- [ ] **(2026-10-14, §1-EQ, 34-sample-prep-3f ⑩) 제어기/PC 시각 오프셋.** ErrorLog 시각(16:54:22)과 확장 이벤트 시각(16:59:15)이 약 4.5분 어긋난 채 오류 상세 보기에 섞인다 —
  연결 시 한 번 오프셋을 측정해(ErrorLog 최신 항목 vs PC 시각, 또는 시각 DataID 가 있으면 그것) "제어기 시각(PC 환산 hh:mm)" 으로 병기할지 결정. 측정 명령은 실기 확인 필요.
- [ ] **(2026-10-19, §1-EU) Start 뒤 메인 쓰레드 Error 감시 — 실기 확인(Start 포함이므로 저속/시뮬레이션).** 새 VSIX 로
  ① Sample Prep 의 AntiBodyR2 를 로봇 1대 제어기에 Upload & Start → 5 s 안에 에러 토스트 「배포는 끝났지만 Start 뒤 메인 쓰레드가 Error 로 멈췄습니다: AntiBodyR2 Error — -1509 … @ _robot_ExtraModuleHandler.gpl:484 (setUseAutoHome)」 + 힌트, 해당 줄 붉은 강조, 트리 오류 컨텍스트, 상황 스냅샷 요약
  ② 정상 프로젝트 → 토스트 「배포 완료」 그대로, Output 트레이스에 `✔ 메인 쓰레드 … Error 없음` 또는 `프로그램이 끝났다`
  ③ MCP `deploy_project(mode:"upload_start")` 응답에 `runtimeError`·`warning`, `operation_status` 목록 `resultSummary` 에 `runtimeError -1509 @ …`
  ④ `postStartWatchMs: 0` 이면 감시 줄이 트레이스에 없고 소요가 종전과 같은지
  ⑤ 1402 거부 상황에서 `controller_status` → `observations.localConnections.measured:true`, 다른 창이 잡고 있으면 `foreignOwners` 와 verdict 의 PID 문구; `show_threads` 요약의 `pausedThreads`/`errorThreads`/`stoppedThreads`.
- [ ] **(2026-10-19, §1-ET) 런타임 콘솔 Live Log 시작 결과 표시 — 실기 확인(조회만, 모션 무관) + 원인 확정.** 새 VSIX 로
  ① 명령 콘솔 미연결 상태에서 「Start Live Log Terminal」 → 터미널 첫 두 줄(대상 `ip:1403`, 「GPL: Connect」 안내)과 결과 토스트(소켓 연결/수신 확인/연결 거부)
  ② 제어기 LAN 을 뽑은 상태에서 같은 명령 → `[1403] --- ERROR …` 뒤 error 토스트에 사유, 재연결 백오프 중 다시 실행하면 즉시 CONNECT 가 나가는지
  ③ 명령 콘솔 유실 알림 뒤 「GPL: Connect」만으로 런타임 콘솔이 함께 켜지는지(`finishConnect` → `ensureRuntimeConsole`)
  ④ Sample Prep 보고 v3(새 창 Traffic `[1403]` 줄)가 오면 §1-ET 의 후보 ①②③ 중 하나로 확정하고 필요하면 `runtimeConsole.ts` 정책을 손본다.
- [ ] **(2026-10-19, §1-ES) MCP 주소 불일치 보고 — VSIX 재패키징 후 재현 확인(조회만, 모션 무관).** `npm run package` → 설치 → Sample Prep 창에서 .102 로 연결(`.mcp.json` 은 .1 그대로) →
  ① 연결 직후 경고 「AI(MCP) 설정의 제어기 주소(192.168.0.1:1402)가 현재 연결(192.168.0.102:1402)과 다릅니다」 + 「Export 재실행」 버튼, Output 에 `[AI Setup] .mcp.json 제어기 주소 불일치` 한 줄
  ② 그 상태에서 MCP `extension_status(wake:true)` → `reason:"host-mismatch"`, `hostMismatch.extensions[0].ip === "192.168.0.102"`, `workspaceMatch:true`, `woken:false`(wake 생략), nextStep 에 두 주소
  ③ `project_target(projectDir)` → `PROJECT_TARGET_UNVERIFIED` 의 detail 에 "확장 미실행이 아니라 주소 불일치" 문구; `controller_status` → `likelyCause` 에 같은 문구, `hostMismatch` 비-null
  ④ 「Export 재실행」 → `.mcp.json` GPL_HOST 가 .102 로, `/mcp` 재연결 뒤 `extension_status` → `available:true`, `deploy_project(mode:"build")` 가 정상 수행
  ⑤ `GPL: Check AI Agent Setup` 이 불일치를 "설정 문제 1건 — GPL_HOST(…)가 현재 제어기 주소(…)와 다름" 으로 표시하는지.
- [ ] **(2026-10-19, §1-ER) Debug Console 여러 줄 실행 — F5/제어기 UI 확인(조회만 우선, 상태 변경은 저속/시뮬레이션).**
  ① `Show Thread -web`·`ErrorLog` 두 줄 붙여넣기 → 빈 줄을 건너뛰고 입력별 결과 블록이 순서대로 한 응답에 보이는지
  ② `Break <thread>`를 `>` 없이 입력 → Traffic에 원문 `Break`가 나가지 않고 "명령으로 인식했지만 보내지 않음" 안내가 뜨는지
  ③ `>Break <thread>`와 읽기 명령을 함께 붙여넣기 → 확인창 1회 뒤 원래 순서대로 전송되는지, 취소하면 묶음 전체가 실행되지 않는지
  ④ `gpl.debug.confirmDestructiveRepl=false`에서는 확인창만 생략되고 순서·결과가 같은지. 실제 UI가 붙여넣기 줄들을 하나의 DAP evaluate 요청으로 전달하는지도 이 확인에서 확정한다.
- [ ] **(2026-10-14, §1-EO) AI 경유 동작 Output 표시 — UI 확인(제어기 조회만, 모션 무관).** MCP `show_threads` 1회 →
  ① Output 「GPL Language Support」가 자동으로 열리고(포커스는 편집기) `[Bridge] 실행 …` 다음에 `[Command] >>> Show Thread -web (agent) → STATUS 0 · N ms`
  와 들여쓴 응답 본문이 찍히는지 ② 이어서 30초 안에 또 호출하면 패널을 다시 열지 않는지(다른 채널로 옮겨 둔 채 확인)
  ③ `gpl.agentBridge.revealOutput=false` 면 열리지 않고 로그만 남는지 ④ MCP `deploy_project(mode:"build")` 가 제어기 시스템 경고가
  있는 상태에서도 토스트를 닫지 않은 채 수 초 안에 결과를 돌려주는지(종전 300초 BRIDGE_REQUEST_TIMEOUT).
- [ ] **(2026-10-14, §1-EP) 에러 줄·정지 줄 강조 자동 해제 — UI 확인(시뮬레이션/저속).** ① 쓰레드가 Error 가 돼 붉은 줄이 칠해진 뒤
  (디버그 세션의 에러 알림 또는 패널 「코드 오류」의 Error 쓰레드 클릭) 그 쓰레드를 Stop 하거나 `Start -compile` 로 재시작하면 다음 폴(기본 5초)
  안에 붉은 줄이 지워지는지 ② 디버그 세션 중(폴링 대신 debugBridge 목록)에도 같은지 ③ 「현재 실행 위치 보기」의 노란 줄이 Continue/Step 뒤
  지워지는지 ④ 연결 해제 시 둘 다 지워지는지 ⑤ ErrorLog 항목(쓰레드 없음)에서 연 붉은 줄은 「에러 로그 초기화」 뒤에 지워지는지.
- [ ] **(2026-10-14, §1-EK) MCP 콘솔 경로 — 창 2개 실기 재확인(제어기 조회만, 모션 무관).** 창 A(먼저 뜬 리더)는 미접속, 창 B 는
  제어기 접속 상태로 두고 MCP 를 재시작(`/mcp` 재연결 — 번들 사본은 `npm run bundle:mcp` 뒤 활성화 시 자동 갱신)한 뒤
  ① `extension_status` 의 `transport.consoleRoute` 가 `{via:"connected"}` + 창 B 의 id 인지 ② `controller_status` 가 ECONNREFUSED 없이
  `<STATUS>` 를 받는지 ③ 창 B 를 끊고 창 A 를 접속시키면 3초(BRIDGE_RECHECK_MS) 뒤 경로가 창 A 로 따라오는지
  ④ 둘 다 끊으면 `via:"leader"` 로 돌아가는지. 2026-10-14 실측 환경(34. Sample Prep = 리더·미접속, GPL_language = 접속)이 그대로다.
- [ ] **(2026-10-14, §1-EN) 타입 참조 색 — 편집기 확인(제어기 무관).** C_YAO `__init__RobotConfig__.gpl:38~43` 에서
  `Dim arm As RobotArm`·`arm = New RobotArm(1,3)`·`New VaccumGripSequence(New InverseSingleAct(…))` 의 타입 이름이 Dracula Soft 에서
  청록 이탤릭(`As`·`New` 는 분홍 그대로)인지, `Class X` 선언 이름(청록 정체)과 구별되는지. 다른 테마(Dark+)에서도 `New` 파랑·타입 청록인지.
- [ ] **(2026-10-02, §1-EJ) 괄호 안 구문 강조 — 편집기 확인(제어기 무관).** EM2RS_Probe `Commands.gpl:138~150` 의
  `p.AddSync("RSCFG", New TcpSyncCmdSub(AddressOf PRB.OnCfg))` 에서 ① `AddressOf` 가 키워드 색 ② `OnCfg` 가 함수 색(`PRB.` 는 본문색)
  ③ 괄호 안 `New` 가 키워드, `TcpSyncCmdSub` 가 타입 색인지. 이어 `samples/syntax-tour` 에서 ④ 매개변수 목록
  `(ByVal text As String)` 의 `ByVal`·`String` 색이 바깥 `As String` 과 같은지 ⑤ 괄호가 줄을 넘는 호출(`_` 이어쓰기)
  뒤 줄들의 색이 무너지지 않는지. §1-EV에서 `Commands.gpl:97`의 쉼표 뒤 `ByVal` 누락까지 고쳐 실제 토큰화 45/45를
  확인했지만, 새 VSIX의 편집기 눈 확인은 아직 남아 있다. 확인용 토큰 덤프 스크립트는 §1-EJ 「검증」 참조.
- [ ] **(2026-10-02, §1-EI) 개요(Outline) 분류·detail — F5 UI 확인(제어기 무관).** "Run Extension (syntax tour)" 로 `Shapes.gpl` 을 열고
      ① 개요에서 `Describe` 세 항목 옆에 `(a As Integer) As String` 식 detail 이 각각 다르게 보이는지, `CreatedCount  As Integer (ReadOnly)`·
      `created  Shared As Integer`·`Ceiling  As Integer = 1000` 이 맞는지 ② 설정 `outline.showMethods` 를 끄면 Counter 의 Init/Bump/LastLine 만
      사라지고 모듈의 ShapeTour/Describe 는 남는지(`showFunctions` 는 반대), `showFields` 를 끄면 멤버 변수가 사라지는지 ③ `Ctrl+Shift+O` →
      `@:` 에서 methods/functions/fields/constants/properties/classes/modules 로 묶이는지 ④ `Ctrl+T` 로 `rlog` 를 쳐서 `RegisterLogSink` 류가
      나오고 선택 시 커서가 이름 위에 놓이는지 ⑤ `End Sub` 를 지운 채 입력 중일 때 개요가 깨지지 않고 범위가 클래스 안에 머무는지.
- [ ] **(2026-10-22, §1-FG) Try 호환성 UI 확인.** 기본 설정에서는 Catch 누락 경고가 없고, `gpl.diagnostics.tryWithoutCatch=true`이면 Information과 수정된 Continue 주의 문구가 표시되는지 확인한다. 이전 §1-EH의 기본 Warning·Catch 추가 예방 설명은 새 실측으로 무효다.
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
- [ ] **(2026-10-20, §1-EW) 배포 안전·Start 진단·참조 폴백 — 새 VSIX 확인.**
  ① FTP `/GPL` 목록 조회를 실패시킨 테스트 환경에서 Deploy/FTP Run이 `/flash/projects`로 내려가지 않고 **FTP 쓰기 전에** 중단되며 후보를 `(unconfirmed)`로 표시하는지;
  `452 Error writing file`은 COMPILE 로그가 아니라 Show Memory와 `/GPL` 사용량을 안내하는지(업로드만, 모션 무관).
  ② 오류가 있는 프로젝트를 Upload & Start(저속/시뮬레이션) → `Start -compile` 원문의 `file:line:(code)`가 Problems·클릭 가능한 Output·MCP `compileErrors`에 같은 값으로 오는지.
  ③ `.gpr` 없는 폴더의 GPL 파일에서 Shift+F12 → 그 폴더 하위만 찾고 중첩 `.gpr` 폴더는 건너뛰며, verbose 로그가
  `[References] fallback origin=folder … scanned=N/M hits=… unreadable=… elapsed=… truncated=…` 한 줄인지. private 심볼은 파일 밖 검색을 하지 않는지.
  ④ 세션 대상을 `COM_Probe`로 둔 뒤 `deploy_project(projectDir="…\\V2\\Lib", mode="quick")` → `targetSent.projectDir`은 Lib,
  `targetSent.project`는 비어 있고 작업 기록의 `projectName`도 Lib인지. 원격 삭제가 보고되면 FTP trace의 실제 삭제 경로를 별도 확보한다.
- [ ] **(2026-10-20, §1-EX) Sample Prep Quick Compile/브리지 후속 — 새 VSIX·MCP 재연결 뒤 확인.**
  ① `deploy_project(mode:"upload-start", confirmStart:true)`가 확인 모달 없이 끝나고 브리지 응답 또는 operation recovery를 돌려주는지(실제 Start 포함 — 저속/시뮬레이션).
  ② `compile_project`와 `start_project`의 긴 compiler pass 응답이 `</STATUS>`까지 오며 `pass 3` 중간의 -9999가 재발하지 않는지.
  ③ `extension_status`에 `activeRequest`·마지막 수거/응답 시각·대기 수가 보이고, 요청을 15초 이상 큐에 둔 재현에서만 `bridgeStalled:true`인지.
  ④ `stop_threads({project})`가 `TCPCLI[0]`를 원문 `Stop TCPCLI[0]`으로 보내지 않고 `skipped`로 보고하며 다른 표현 가능한 쓰레드만 멈추는지.
  ⑤ `EM2RS_Probe` 컴파일 에러 `Lib\\Lib_Device\\EM2RS\\EM2RS.gpl`이 로컬 `V2\\Lib\\Lib_Device\\EM2RS\\EM2RS.gpl`을 여는지.
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
  (vscode 타입을 받는 부분은 접착 쪽에 남기고 순수 부분만) ② 1403 상태 문구 두 표현(`controller/runtime/runtimeConsolePresentation` 알림용 영문 vs
  `views/runtimeConsoleTreePresentation` 트리용 한국어)의 폴링 판정 정규식 차이 — **실기기에서 1403 reason/detail 문구를
  캡처해 대조한 뒤** 하나로 합칠지 결정 ③ `controllerTreeProvider.ts`(1,537줄) 섹션별 노드 생성을 순수 함수로
  ④ ESLint 도입 여부 — 지금은 tsconfig 엄격 플래그 5종이 대신한다. 계층 규칙·허용 목록을 바꾸면
  `docs/development/architecture.md` 와 `architecture.test.ts` 를 같이 고친다.

- [ ] **(2026-09-07, §1-CY) 연결 진단에 Ethernet 카운터(DataID 430/431/432) 얹기 — 계층 분리.**
  `src/controller/diagnostics/resourceProbes.ts`가 지금 `Show Memory`/`Show Network -tcp|-mbuf`만 본다. 여기에
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
  **QuickPick 이 뜨지 않고** `{ok:false, error:"PROJECT_TARGET_REQUIRED", sent:false}` 가 오는지.
  ② MCP `project_target({projectDir:"…\\GPL_Code"})` → 고정된 뒤 `deploy_project`(대상 미지정)가 그 프로젝트로 나가는지.
  `project_target({})` 로 현재 세션 대상·후보 수가 조회되는지. `{clear:true}` 로 풀리는지.
  ③ **에디터에서 다른 프로젝트의 파일을 열어 둔 상태**로 ②를 반복 → 대상이 바뀌지 않는지(active editor 무시).
  ④ 사람이 명령 팔레트 `GPL: Deploy` 로 QuickPick 에서 `MyProject` 를 고른 뒤, MCP `project_target({})` 가
  그 선택을 세션 대상으로 반영했는지(사람이 한 번 고르면 다시 묻지 않는다).
  ⑤ `deploy_project({mode:"upload-start"})`(confirmStart 없이) → 모달이 뜨지 않고 `INTERACTIVE_UI_REQUIRED` 가
  오는지. **사용자에게 확인을 받은 뒤** `confirmStart:true` 로 재호출하면 진행되는지(저속/시뮬레이션에서).
  ⑥ 대상 폴더의 파일을 편집만 하고 저장하지 않은 상태로 `deploy_project` → `UNSAVED_FILES` + 파일 목록이
  오는지, `saveDirty:true` 면 저장 후 진행되는지.
  ⑦ 라이브러리만 있는 폴더를 `projectDir` 로 직접 지정하면 대상이 되는지(라이브러리도 직접 지정은 허용).
  ⑧ 구버전 `.mcp.json`에 `GPL_PROJECT`/`GPL_PROJECT_DIR`이 남은 상태에서 Check → Export 재실행 안내, Export 뒤 두 키가
  제거되고 `AGENTS.md` 자동 블록의 옛 기본 프로젝트 문구도 사라지는지.
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
- [ ] **(우선, §1-AH) 외부 AI 디버깅 경로 개선** — ①(워크스페이스 AI 가이드/`.mcp.json`)·②(`GPL: Export AI Agent Setup`)는 **완료(2026-08-05, §1-AN)**. 남은 것: ③ controller-mcp 디버깅 도구 견고화 패리티(§1-AG 규약) — **대부분 완료(2026-08-05, §1-AS: 정지확인 내장·run_to_line·statusHint, 실기기 검증 남음)**, ④ connect backoff. (1403 실시간 스트림 도구는 **완료(2026-10-14, §1-EQ `runtime_console_read`)**.) 상세와 배경은 §1-AH/§1-AN.
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
samples/hello-project/                   # 기본 F5용 간단한 기능 예제(Main.gpl 69줄 + README 14줄 + Project.gpr). Add·Clamp·Counter·For, VSIX 미포함 (§1-FH)
samples/syntax-tour/                     # GPL 문(statement)을 전부 한 번씩 쓴 대조용 프로젝트(Main/Declarations/Shapes/Faults.gpl). 각 문의 첫 등장 줄 끝에 ' [syntax] <라벨> 마커. 모션 API 없음, VSIX 미포함 (§1-DW)
src/controller/connection/controllerConnection.ts   # vscode 래퍼 — sendCommandDetailed(직렬 큐 + 명령 정책 before/after 적용, §1-BN) 옵션(keepAlive1402/idle) 전달, logTraffic(>>> / ' | ' / <<< / ---)·getTrafficLogOptions(§1-BG), closeControllerConnection/getConnectionStats/getRecentTraffic 재노출(§1-BI), probeControllerCommand/getConnectionProbeTimeoutMs(§1-BK), getCommandPolicySnapshot·isPolicyError 재노출(§1-BN)
src/controller/commands/commandPolicy.ts          # 제어기 명령 정책(vscode 무의존) — R1 Step/Continue 정지 확인 대기+최소 간격(#28), R2 Start/Compile/Load/Unload 전 Stopping 정착 대기(§0.6), R3 Compile→Start 완충(§0.7); 승인/거부 없음, 한도 초과 시 PolicyError(미전송) (§1-BN)
src/language/gplStatements.ts            # 문 스니펫·키워드 정본(vscode 무의존) — 공식 Statement Dictionary 구문 + 스코프 규칙(scopes/requiresOpen/forbidsOpen) + getApplicableStatements (§1-CB)
src/language/blockContext.ts             # 커서 시점 열린 블록 스택(vscode 무의존) — analyzeBlockContext: file/type/procedure 스코프, 한 줄 If·Delegate·짝 없는 End 처리 (§1-CB)
src/language/tryCatch.ts                 # Catch 누락 검사·GPL 4.2K5 호환성 안내 정본(vscode 무의존) — 중첩 Try·주석/문자열·줄 연속, Finally/End Try부터 보고 (§1-EH)
src/language/gplDictionaryData.ts        # GPL Dictionary 데이터(vscode 무의존) — Class.Member 항목 + GPL_CLASS_DOCS(클래스 개요·생성자). Thread는 공식 18페이지 전수 (§1-BR)
src/language/gplBuiltins.ts              # 사전 API — usage/details 필드, findGplClassDoc·getGplClassMembers·findGplBuiltinMember(내장 타입 멤버 조회) (§1-BR)
src/controller/automation/agentBridge.ts            # Agent Bridge 서버(vscode 무의존, 실행자 주입) — presence 파일·요청/응답 파일 IPC·gpl.* 범위 한정·순차 실행 (§1-BQ). **인스턴스별 분리**: extensionInstanceId 마다 extensions/<id>.json + bridge/inst/<id>/{req,res}, 레거시 IP 큐는 electLeaderInstanceId 로 뽑은 리더 하나만 서비스(구버전 MCP 호환) (§1-DK)
src/controller/automation/agentCommandLog.ts        # AI 경유 명령의 Output 표현 규칙(순수, §1-EO) — formatAgentCommandLines(요약 `[Command] >>> cmd (agent) → STATUS n · ms` + 들여쓴 본문, 상한은 trafficLogMaxResponseChars)·formatAgentCommandFailure(정책 보류/전송 실패)·createRevealGate(조용한 뒤 첫 요청만 패널 열기, 30 s). 접착은 activation/controllerCommands(sendCommand 에이전트 분기)·activation/host(execute 래퍼, 설정 gpl.agentBridge.revealOutput)
controller-mcp/src/extensionBridge.js    # Agent Bridge 클라이언트 — presence 판정/깨우기(code --open-url)/요청·응답 왕복/재전송 안전 판정 (§1-BQ) + listExtensionInstances·resolveExtensionInstance(창 선택: 명시 id→projectDir 워크스페이스→connected→유일, 애매하면 EXTENSION_AMBIGUOUS)·takeLateResponse(타임아웃 뒤 결과 회수) (§1-DK) · pickConsoleRouteInstance(1402 콘솔 경로: 명시 id→창 하나→connected→리더 — 리더는 레거시 큐 담당일 뿐, §1-EK)
src/controller/automation/operationStore.ts         # **장시간 작업 기록**(vscode 무의존) — operations/<id>.json 에 종류·대상·phase·결과 영속. 잠금과 분리(잠금은 사라지고 기록은 남는다), QUEUED→RUNNING 전환·멱등키 중복 차단, **RUNNING/QUEUED인데 신호 끊김 = 읽을 때 UNKNOWN** (§1-DK, §1-FC)
src/controller/deployment/deployQueue.ts            # 제어기별 프로세스 내부 FIFO(vscode 무의존) — 같은 제어기 요청은 등록 순서대로, 다른 제어기는 병행. 창/프로세스 간 상호 배제는 deployLock과 함께 사용 (§1-FC)
controller-mcp/src/operations.js         # 위 기록 읽기(읽기 전용 미러) + operationRecovery(상태별 다음 행동). 확장을 거치지 않으므로 확장이 배포로 바빠도·MCP 가 재시작돼도 조회된다 (§1-DK)
src/controller/deployment/deployProvenance.ts       # **배포 증적**(vscode 무의존) — 로컬 소스 지문 vs 우리가 올린 내용 지문 대조: localRevision/uploadedRevision/inSync + changedSinceUpload·notUploaded·staleRemote. verifiedBy='upload-manifest'(원격을 직접 해시한 것이 아님을 밝힌다), 기록 없으면 inSync=false (§1-DK)
src/controller/automation/automationRecovery.ts     # **복구 지시 표**(vscode 무의존) — 오류 코드 → action·retryCurrentCommand·safeToRepeat. 잠금/타임아웃/진행 중은 전부 CHECK_OPERATION + 재시도 false, **표에 없는 코드는 재시도 금지**로 떨어진다 (§1-DK)
src/controller/automation/uriDispatch.ts            # 외부 진입점 URI 해석(vscode 무의존) — /<gpl.command.id>?args=JSON | ?key=value | /command?id=…, 별칭 4개, gpl.* 범위 한정 (§1-BN)
src/controller/connection/connectionSession.ts      # 제어기 연결 세션 상태 정본(vscode 무의존) — 쓰기는 host.setControllerConnected 만(R7), 구독 onControllerSessionChange(대시보드), effectiveKeepAlive(해제 상태 명령은 단발 연결) (§1-EM)
src/controller/connection/connectionHealth.ts       # 연결 건강 판정(vscode 무의존) — ConnectionHealthMonitor(connected→suspect→lost, 프로브 임계 3/거부 2·힌트는 suspect만)·ConnectionHealthProber(1 s 재프로브)·classifyCommandFailure·probeOutcomeFromResponse (§1-BK)
src/controller/connection/consoleSocket.ts          # 1402 소켓 계층(vscode 무의존) — keep-alive 소켓 1개, terminator-first 재사용 판정, stale 1회 재시도, 트래픽 링버퍼 600줄 (§1-BI, #22), reject code 부착·보관 소켓 관찰자(§1-BK)
src/debug/sourceTargets.ts               # BP 유효 줄·프로시저 범위(End Sub 기준)·호출 후보 파싱(vscode 무의존) — BP 줄 보정(문서 규칙)·Jump to Cursor 검증·Step Into Target 후보 (§1-BU)
src/controller/threads/threadActivity.ts          # "동작 중" 판정(vscode 무의존) — 쓰레드 존재 = 활성, project 컬럼·기본 이름·`_Cmd_<project>`(Execute 쓰레드) 인정 (§1-BU). 상태 판정 단일 출처: isSettledState(Idle/Stopped/Error) · isPausedState/PAUSED_THREAD_STATES(Paused/Break/Error, §1-DD)
src/controller/debugging/executionMarks.ts          # 실행 위치 강조(정지 줄·에러 줄)의 유효성 판정(vscode 무의존, §1-EP) — isErrorMarkStale/isStoppedMarkStale: 주인 쓰레드가 목록에 없거나 Error/정지 상태를 벗어나면 낡음, 주인 모르면 같은 종류 상태가 어디에도 없을 때. 소비자는 activation/debugDecorations.reconcile, 공급자는 views/controllerTreeProvider.onDidChangeRuntimeState
src/controller/commands/projectCommands.ts         # **Compile/Load/Unload/Start 의 정본**(vscode 무의존·주입형 IO) — compileProject(후보 순회·일시적 STATUS 1회 재시도·성공은 STATUS 0+에러 0 뿐)/loadProject(HTTP 응답=제어기 이상)/unloadProject(-750 쓰레드 실행 중)/startProject(항상 buildStartCommand). 배포·FTP Run 이 함께 쓴다 (§1-DE)
src/controller/projects/remoteProjectPath.ts       # 어느 원격 사본(/flash/projects vs /GPL)을 대상으로 삼을지 — 점수 규칙 단일 정본(존재+200/flash+80/선택+20, switched 로 전환 고지) (§1-DE)
src/controller/threads/threadStop.ts              # **쓰레드 정지의 정본**(vscode 무의존·주입형 IO) — probeThreads(잘린 응답=확인 불가) / waitThreadsSettle·waitThreadSettle / sendStop / stopAllAndSettle·stopThreadAndSettle(전송→STATUS 판정→폴링→자동 재시도, unconfirmed 노출). 배포·패널·FTP·디버그가 모두 이것을 쓴다 (§1-DD)
src/controller/threads/threadStuckDiagnosis.ts    # **정지 불가 쓰레드 진단**(vscode 무의존·주입형 IO, **읽기 전용**) — diagnoseStuckThread(위치 N회 샘플링→이동 판정→소스 문맥→수신자 식→복구 후보) / extractCallTarget(문장의 마지막 메서드 호출) / buildRecoveryCandidates(지역 변수 인덱스는 0..N 치환) / createFileSourceLookup(파일명만 아는 위치를 로컬에서 찾기). 후보는 **제시만 하고 보내지 않는다** (§1-DI)
src/controller/commands/startCommand.ts            # Start 명령 조립(vscode 무의존) — 문서 구문 순서, 기본 `-event`(GDE 동일), `-compile` 금지(하드 규칙 7) (§1-BU)
src/debug/threadLock.ts                  # 스레드 단일 실행 잠금 판정(vscode 무의존) — resolveExecutionThread(대상 확정·staleLock)·shouldPreserveFocus·isAllThreadsResumeRequest. 어댑터의 StoppedEvent 는 전부 _stoppedEvent 경유(불변식) (§1-BS)
src/controller/connection/idlePing.ts               # 1402 유휴 ping 판정/스케줄러(vscode 무의존) — GDE 방식 세션 유지(유휴 5 s → 읽기 명령 1개), 1403 안정성의 열쇠 (§1-BM)
src/controller/connection/reachability.ts           # ping TTL·TCP·arp 도달성 판정 + 응답 장치 정체(제어기 vs 게이트웨이) 힌트 (§1-BI, #22)
src/controller/diagnostics/resourceProbes.ts         # Show Memory / Show Network -tcp / -mbuf 파서(실기기 원문 기준)·증가율·이력 (§1-BI, #22 자원 카드)
src/controller/diagnostics/statusSampling.ts         # 상태 수집·대시보드별 저빈도 진단 캐시·실제 표본 시각(순수 IO 주입, §1-FM)
src/controller/diagnostics/controllerStatus.ts       # 확장 명령 큐와 상태 수집기의 어댑터·기존 공개 API 재노출
src/controller/diagnostics/temperature.ts            # Show Temperature 파서·센서 유효성·360점 온도 이력(§1-FM)
src/controller/runtime/runtimeConsoleGuards.ts   # 1403 접속 카운터(슬라이딩 윈도우)·워치독 판정(순수) (§1-BI)
src/controller/runtime/runtimeConsoleBuffer.ts   # 1403 수신 줄 링버퍼(seq 커서 read·untilPattern/waitFor 대기·dropped 보고, 순수) — MCP runtime_console_read 의 뒷단 gpl.ai.debug.runtimeConsoleRead 가 읽는다; 파일 캡처(gpl.runtimeConsole.captureFile)는 runtimeConsole.ts 의 appendCapture (§1-EQ)
src/controller/deployment/deployRecordCore.ts       # 컴파일 스냅샷(sha1) 기록/대조 순수 로직 + Memento 스토어 (§1-BI, #21)
src/controller/deployment/deployRecord.ts           # deployRecordCore vscode 래퍼 — recordCompiled/getCompiledRecord/onDidRecordCompiled/attachDeployRecordStore (§1-BI)
src/controller/deployment/compileStale.ts           # "컴파일 검증 필요" 배지 상태(CompileStaleTracker, vscode 무의존) — 해제는 onDidRecordCompiled 구독으로 경로 무관 (§1-CU)
src/controller/deployment/flashSafety.ts            # Save to Flash 안전 확인 상태기계(순수) — Sync 종결 STATUS 0 뒤 10초 안정화, 실패 시 unknown 유지 (§1-FD)
src/debug/stepGate.ts                    # Step/Continue 게이트 순수 판정 shouldGateStepRequest(pending-entry/pending-same-thread/min-interval) (§1-BI, #28)
src/debug/evalMessages.ts                # 평가 실패 문구 정본(vscode 무의존) — formatEvalError(hover/Watch/REPL 공용, 세션에서 이관)·describeNestedExpandFailure(중첩 객체 펼치기 실패 행: 코드·원인 앞, 대처 뒤, Debug Console 용 detail)·UNDEFINED_SYMBOL_STATUS/UNSUPPORTED_PROCEDURE_STATUS (§1-DS)
src/debug/replInput.ts                   # Debug Console 여러 줄 입력 모델(vscode 무의존) — 줄 분해·`>` 접두사·상태 변경 명령 미전송 안내·입력별 결과 표시 (§1-ER)
src/language/getterBranch.ts             # 분기형 Property getter(`If 필드 비교 Then Return A Else Return B`, 4형태) 파싱·계산 정본(순수) — parseGetterBranch(파서 → GPLSymbol.getterBranch)·getterBranchIdentifiers(hover 게이트 해석 가능 판정)·evaluateGetterBranch(어댑터 ②-c·가상 Property 자식, 결과는 제어기 표기 -1/0 + via) (§1-DS)
src/debug/spontaneousPause.ts             # 사용자 액션 없이 관측된 Paused 판별(vscode 무의존) — GPL 의 Paused 는 Thread.Sleep 대기도 포함하므로 등록 BP 위치 일치 = 즉시 정지, 그 외 3폴·1500ms 연속 = 외부 정지, 나머지는 무시(가짜 브레이크 차단) (§1-CK)
src/controller/debugging/debugBridge.ts            # 디버그 세션 ↔ 확장 이벤트 버스 + RuntimeConsoleHealth 공급자(1403 alive → 백업 폴 완화) (§1-BI) + onDebugProbeResult(어댑터 폴 결과 → 연결 건강 모니터, §1-BK)
src/views/refreshThrottle.ts             # 트리 FTP/시스템 정보 자동 재조회 스로틀 판정(순수) (§1-BI, #22)
src/debug/launchJsonc.ts                 # launch.json JSONC 읽기/부분 갱신(jsonc-parser) — 주석·포맷 보존 upsert (§1-BI, #30)
controller-mcp/src/batch.js              # MCP controller_command 배치 runBatch/normalizeCommandInput (§1-BI, #16)
src/controller/connection/trafficResponseBody.ts    # ResponseBodyStreamer — 1402 응답 본문 줄 단위 스트리밍·상한 생략 요약(§1-BG, vscode 무의존 순수 모듈)
src/controller/deployment/deployService.ts          # deploy() = 제어기별 QUEUED 대기→잠금 획득→일반은 UPLOAD ∥ STOP/THREAD_CHECK→COMPILE→START→ERROR CHECK, Upload Only는 UPLOAD만(원격 전용 삭제 보류). tryCompile, directGpl, COMPILE_DEFERRED, findProjectDirs, onDidUploadProgress (§1-BD, §1-EE, §1-FC)
src/controller/projects/projectPickerCore.ts      # 프로젝트 폴더 선택 순수 규칙 — orderProjectDirs(최근 선택 우선)·projectDirFromResource(폴더 자체/.gpr/포함 파일)·filterDirsByProjectName (§1-BL, vscode 무의존)
src/controller/projects/projectPicker.ts          # 공용 선택기 pickProjectDir(Detailed)(QuickPick·workspaceState 최근 선택)·readGprProjectName/projectNameOf·context key gpl.projectDirs(탐색기 메뉴) — 명령·F5 provider 공용 (§1-BL)
src/controller/projects/projectNameGuard.ts       # 프로젝트명/Load 경로 안전성 단일 규칙(vscode 무의존) — 1402 명령은 공백 구분·인용 불가 → 공백·제어 문자 검출 checkProjectName/checkRemotePath·안내 문구 describeProjectNameProblem; deploy/Start/ftpRun·Unload/F5 attach/MCP proj()가 공유 (§1-BQ)
src/debug/activateDebug.ts               # DebugConfigurationProvider — 중복 세션 처리 + fillProjectTarget(다중 프로젝트 QuickPick, projectDir/projectName 보충) (§1-BL), InlineDebugAdapterFactory
src/controller/deployment/deployLock.ts             # 배포 잠금 — 메모리+파일(%TEMP%/gpl-controller/<ip>.lock.json), pid/heartbeat stale 자동 만료, describeDeployLock (§1-BD, 이슈 #15·#17)
src/controller/files/ftpClient.ts              # uploadProject onlyFiles, mirrorProject deferDelete + removeRemoteFiles(§1-BD), 지문 스킵 판정(§1-BV), 진행 이벤트 onProgress(event) = 파일 완료 + basic-ftp trackProgress 바이트(§1-EE)
src/controller/deployment/uploadProgress.ts         # 업로드 진행 집계(vscode 무의존) — UploadProgressTracker(파일 완료 + 전송 중 바이트, 스킵은 즉시 완료, 크기 클램프)·UploadProgressEvent; 표시는 views/uploadProgressBar (§1-EE)
src/util/formatBytes.ts                  # 바이트 → 사람이 읽는 크기 정본(vscode 무의존, R7) — formatBytes/formatBytesAs/byteUnitFor(B 정수·그 위 소수 1자리·GB 까지); 종전 views/treeFormat.formatSize 통합 (§1-EE)
src/controller/files/syncManifest.ts           # 업로드 지문(SHA-1) 매니페스트 — 미러/skipUnchanged 스킵 판정(§1-BV, globalState)
src/controller/debugging/breakpointReconcile.ts    # 에디터↔제어기 중단점 수렴 계획(vscode 무의존) — project-relative identity 비교, 미해석 proc=?/0 제외, planReconcile/orphan 표시 (§1-CJ, §1-EC)
src/controller/debugging/breakpointCommand.ts      # BP 명령 문자열 계층(vscode 무의존) — 무공백 생성, project-relative 경로 보존 parser, MirrorEchoMemory (§1-CO, §1-EC)
src/controller/debugging/breakpointMirror.ts       # 제어기→에디터 중단점 미러 — AI(MCP·URI·콘솔)가 건 BP를 빨간 점으로. 외부 진입점에서만 동작(DAP·EditorBreakpointSync 제외), 설정 mirrorAiBreakpoints (§1-CO)
src/controller/protocol/responseParser.ts         # parseStatus, parseCompileErrors
src/debug/showVariableParser.ts          # Show Variable 파싱 — 2열 Location 멤버(isTypeToken)·summarizeLocation·annotateLocationMember(§1-BF)
src/language/receiverType.ts             # 멤버 접근 수신자 타입 정적 해석(resolveReceiverHolder·membersNamed·buildDocumentReceiverLookup) + 소속 판정 ownedByHolder·nestedTypesIn(정의찾기 전역 폴백 차단용, §1-CA) — 디버그 hover 게이트·정적 hover 공용(§1-BJ, #32, vscode 무의존)
src/ai/exportAgentSetup.ts               # Export/Check AI Agent Setup — 번들 동기화·파일 생성·설정/대상 준비 상태(§1-EF)
src/ai/agentSetupChecks.ts              # 실행 설정·폴더 대상·CLAUDE/AGENTS 안내 검사(vscode 무의존)
src/controller/io/dio.ts                    # Show DIO `signal: 0|1 [*]` 순수 파서 + Set DIO 명령/동작 설명 정본(§1-FB)
src/views/controllerDashboardPanel.ts    # 제어기 대시보드 웹뷰 — 상태/I/O 탭, setInterval/pause/config, 확인 후 Set DIO(§1-BF·§1-FB); HTML은 media/dashboard.html
controller-mcp/src/parse.js              # MCP 파서 — parseThreadList(이름 키)·compactThread·summarizeThreads·parseShowVariable(§1-BF)
scripts/bundle-mcp.js                    # MCP 번들 + 빌드 스탬프(define __GPL_MCP_BUILD_JSON__, 사이드카 .build.json)(§1-BF)
src/debug/gplDebugSession.ts             # attachRequest, _runDeployBeforeAttach(lockOwner 'F5 Deploy'), _waitDeployLockForStart, getDebugDeployDiagnostics
src/extension.ts                         # activate()/deactivate() — 배선만(195줄). ExtensionHost 생성 → activation/*.ts 의 activateXxx(host) 를 종전 순서로 호출 (§1-CZ)
src/activation/host.ts                   # ExtensionHost — 클로저가 공유하던 서비스(채널·심볼 캐시)·가변 상태(트리·상태바·런타임 콘솔·건강 모니터·디버그 여부·마지막 스냅샷)·헬퍼(log·배포 잠금·컴파일 검증 상태·런타임 콘솔 싱글톤·연결 상태 반영·Agent Bridge)·하위 API(project/connection/deploy/decorations). **가변 상태는 항상 host.x 로 읽는다** (§1-CZ)
src/activation/deploy.ts                 # gpl.deploy/uploadStart/start/saveToFlash/quickCompile + autoOnSave + 자동화 대상 해석·게이트 — runDeploy/runDeployCore(결과 보고부는 controller/deployment/deployOutcome.ts) (§1-CZ, §1-DB) · onDidUploadProgress → 상태바 진행 바 구독, Save to Flash 는 직접 연결(§1-EE) + Sync/10초 안전 확인(§1-FD)
src/activation/connection.ts             # 연결 건강 모니터 배선·유실 처리·사후 스냅샷·connect/disconnect(대화형+비대화형)·launch.json·startQuickAttachSession(attachOnly=배포 없이 붙기, §1-DC)·debugProject(배포+붙기 — 대상은 QuickPick·우클릭, §1-DQ)
src/activation/projectContext.ts         # 기대 프로젝트 감지·launch.json 읽기·GPL 파일명→경로·BP target 해석(resolveGplFilePath/resolveBreakpointTarget) — host.project (§1-CZ, §1-EC)
src/activation/controllerOps.ts          # busy 재시도·정지 확인(§0.6)·SoftEStop 복구·정지 진입 대기(waitForThreadPause) — host 를 첫 인자로 (§1-CZ)
src/activation/debugDecorations.ts       # ExecutionDecorations — 정지 줄/에러 줄 강조 한 객체 (§1-CZ). showError/showStopped 에 주인 쓰레드, reconcile(snapshot) 로 상태가 끝난 강조 자동 해제 (§1-EP)
src/activation/{languageFeatures,xmlCommands,breakpointCommands,consoleCommands,aiAgentSetup,aiDebugCommands,controllerCommands,treeCommands,ftpCommands,debugIntegration,uriHandler}.ts  # 명령 그룹별 activateXxx(host) — 본문은 종전 extension.ts 그대로 (§1-CZ)
src/controller/threads/threadArgs.ts             # asThreadNode — 쓰레드 명령 인자 정규화(순수) (§1-CZ)
src/controller/commands/stepCommand.ts            # buildStepCommand — Step 명령 조립 정본(트리·AI API 공용, 순수) (§1-CZ)
src/util/pathKey.ts                      # 경로 동일성 키 normalizePathKey·normalizeDirKey·isPathUnder(파일·폴더 공용 단일 규칙, vscode 무의존) — controller/projects/projectPickerCore 에서 분리(§1-CQ, §1-DB)
src/language/identifiers.ts              # ciEq — GPL 식별자 대소문자 무시 비교(vscode 무의존, 종전 config.ts) (§1-DB)
src/project/gprSync.ts                   # Project.gpr 파싱/소스 목록 동기화 순수 로직(vscode 무의존, 종전 controller/) — 명령 래퍼는 controller/projects/gprSyncCommand.ts (§1-BW, §1-DB)
src/controller/deployment/deployOutcome.ts          # 배포 결과 보고 순수 규칙 — SituationDeploySnapshot 정의·결과 서명/이력·ErrorLog 분류 로그·COMPILE 원문 로그·실패 문구 4분기(vscode 무의존, 종전 activation/deploy.ts 클로저) (§1-DB)
src/views/treeFormat.ts                  # 트리 표시 포맷(날짜·연결 통계, vscode 무의존 — 크기는 util/formatBytes 로 §1-EE) (§1-DB)
src/views/uploadProgressBar.ts           # 상태바 업로드 진행 바 표시 규칙(vscode 무의존, R7) — renderBar(20칸 + 1/8 부분 블록)·formatBytesPair(total 단위 통일)·describeUploadProgress(전송 중/완료/동일)·renderUploadSummary; 집계는 controller/deployment/uploadProgress (§1-EE)
src/views/connectionStatusBar.ts         # 상태바 — 연결 항목·대시보드·경고 배지(컴파일 검증 필요/소스 변경됨/스레드 잠금, 각각 별도 항목 §1-DV)·업로드 진행 바(§1-EE)·Flash 전원 차단 금지 경고(§1-FD)
src/views/flashSafetyPresentation.ts     # Flash 안전 경고 문구·아이콘·툴팁의 표시 정본(순수, R7, §1-FD)
src/views/runtimeConsoleTreePresentation.ts  # 1403 콘솔 트리 행 문구(라벨·description·아이콘·툴팁·불안정 판정·가설, vscode 무의존) — 알림용은 controller/runtime/runtimeConsolePresentation.ts (§1-DB)
src/test/architecture.test.ts            # 구조 회귀 테스트 — vscode 의존 허용 목록·계층 의존 방향·런타임 순환·테스트 등록·package.json↔명령/설정 키 (§1-DB, 규칙 근거는 docs/development/architecture.md)
src/test/sampleSyntaxCoverage.test.ts    # samples/syntax-tour 가 문법 정본(gplStatements)을 빠짐없이 쓰는지 양방향 검사 — 마커↔라벨, 키워드, 비GPL 문법 금지, gpr 등재, 파서 심볼 (§1-DW)
src/controller/automation/aiCommandPolicy.ts        # AI/자동화 경로에서 거부할 명령 목록(정본) — 되돌릴 수 없는 명령만. 브리지·URI·명령 자체가 함께 본다 (§1-DA)
controller-mcp/src/deployLock.js         # 잠금 파일 읽기 전용 구현(확장과 파일 계약 공유) — Compile/Start/Load/Unload 유한 대기·거부(§1-BD)
src/language/gplParser.ts                # Property/Sub/Function 파싱 + parseDocument 메모이즈 캐시(§1-B E) + docComment 수집(§1-J) + Property getter 골격(getterReturnExpr 단순 Return #26 / getterBranch 분기형 §1-DS)
syntaxes/gpl.tmGrammar.json              # 구문 강조 — GPL 전용 규칙(선언 6종·Delegate 타입 선언·내장 VB 문법이 모르는 키워드 5규칙) 뒤에 source.asp.vb.net 위임. 선언 규칙 수식어 집합 = GPL_PROC_MODIFIERS, src/test/grammar.test.ts 가 강제 (§1-DT)
src/language/gplBuiltins.ts              # 핵심 빌트인/String 함수 (Trim→메서드, Rnd(seed), Replace 제거, Asc/Chr/… 추가) + Bit 문자열 전역함수(§1-J)
src/language/gplDictionaryData.ts        # Move/Robot/Location/Profile/.../String 클래스 사전 + Controller/Thread/Exception/File/XML/Network 등 +153(§1-J)
src/language/outlineModel.ts             # 개요·Ctrl+Shift+O·Ctrl+T 표현 모델 정본(vscode 무의존, §1-EI) — outlineCategoryOf(클래스 멤버 Sub/Function→method, 모듈 프로시저→function, 멤버 변수→field, 로컬→variable, Delegate→delegate)·symbolDetail(시그니처/타입/상수 값/Shared/ReadOnly·WriteOnly)·buildOutlineTree(계층 + 범위: 파서 endLine 정본, 없으면 다음 비-자손 직전·부모 안 폴백)·matchesSymbolQuery(순서 일치)
src/providers/symbolKinds.ts             # OutlineCategory → vscode.SymbolKind 단일 대응표(R7 정본, §1-EI) — documentSymbolProvider·workspaceSymbolProvider 공용. Delegate 는 Class(§1-DU)
src/providers/documentSymbolProvider.ts  # 개요(DocumentSymbol) — outlineModel 트리를 VS Code 객체로 옮기고 범위를 문서 안으로 보정만(§1-ED·§1-EI)
src/providers/workspaceSymbolProvider.ts # Ctrl+T — 이름 컬럼 Range 위치, 로컬·파라미터 제외, matchesSymbolQuery(§1-EI)
src/providers/completionProvider.ts      # 정적 항목 캐시, 트리거('.', '&')
src/providers/definitionProvider.ts      # token 확인 + parseDocument 재사용
src/providers/hoverProvider.ts           # token 확인 + docComment 표시(§1-J)
src/providers/signatureHelpProvider.ts   # Signature Help(빌트인+사용자 Sub/Function, §1-J 신설)
src/language/symbols/symbolIndex.ts      # 심볼 저장·조회·오버로드·멤버·이름 인덱스 정본 — 프로젝트 판단은 SymbolResolutionContext로 주입 (§1-FJ)
src/project/symbols/symbolProjectScope.ts # CompileUnitIndex·프로젝트 경계·경로 점수의 소유자 (§1-FJ)
src/language/vscode/symbolCache.ts       # 기존 Provider API 28개와 refresh·로그·삭제 정리를 조립 (§1-FJ)
src/language/vscode/workspaceSourceLoader.ts # 미저장 버퍼·인코딩·GPR 탐색·배치 로딩·참조 텍스트 읽기 (§1-FJ)
src/language/vscode/symbolPresentation.ts # VS Code 완성 항목·문서·스니펫 표현 (§1-FJ)
src/language/symbolLocations.ts          # 정의 peek 목록 정리(vscode 무의존) — dedupeSymbolLocations(같은 파일·줄 병합)/preferExistingFiles(없는 파일 제외, 전부 없으면 원본 유지) + 존재 판정 정본 isMissingFile(ENOENT만 삭제로 본다)·fileExists(§1-CQ)
src/language/docComment.ts               # 문서화 주석 정본(vscode 무의존) — parseDocComment(섹션 별칭·펜스 인식)/renderDocCommentMarkdown(호버·완성·시그니처 공용)/buildDocCommentBlock·mergeDocComment(골격·머지, DocTarget.coveredParams/coveredReturns 로 "차이만" §1-DR). 원문은 손실 없이 보존하고 렌더에만 손보는 원칙: withFenceLanguage(펜스 언어 보정)·stripDecorativeRules(`====` 장식선 제거, §1-CS)
src/language/docCommentOverloads.ts      # 오버로드 문서화 주석 병합 정본(vscode 무의존, §1-DR) — filterOverloadSiblings(형제 = 같은 이름·Sub/Function·모듈/클래스·컴파일 단위, 사본 접기)/resolveOverloadDoc(공통 설명은 유일하게 가장 풍부한 문서·자기 설명 없으면 Jaccard 로 가장 닮은 형제·이름별 매개변수·같은 타입 Returns — 선언 순서 무관, provenance 동반)/renderResolvedDocMarkdown/describeOverloadCoverage(골격 "차이만"). 호버·완성(symbolCache.buildSymbolDocumentation)·시그니처·''' 공용, 형제 후보는 symbolCache.findOverloadSiblings
src/project/projectSources.ts            # "프로젝트에 속한 소스" 단일 출처 — 재귀 목록·ProjectSource 해석·소유 .gpr 선택(§1-BW, vscode 무의존) + 중첩 프로젝트 경계(stopAtNestedProject)·ProjectLibrary 해석(resolveProjectLibraryDirs)·관련 프로젝트 수집(collectRelatedGprPaths)(§1-BX)
src/project/controllerProjectWorkspace.ts # FTP 다운로드 사본 manifest·SHA-256·Live/Snapshot 쓰기 게이트·중첩 배포 루트·staging/저장된 workspace 정본(vscode 무의존, §1-FA)
src/project/controllerProjectDebug.ts # 제어기 소스·Attach 대상·안전 구성·일회성 재개·라이브러리 경로 후보(§1-FR)
src/controller/files/controllerProjectDownload.ts # Snapshot 다운로드·ProjectLibrary 그래프의 원격 의존성 수집(FTP 읽기만, §1-FR)
src/activation/controllerProjectDebug.ts # 프로젝트 선택·작업공간 준비·Workspace Trust·창 전환 뒤 일회성 Attach(§1-FR)
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

본문에는 **최근 10개 세션**(§1-FM ~ §1-FU, 독립 작업에서 중복된 §1-FR 2건 포함)만 둔다.
그 이전은 월별 아카이브에 원문 그대로 있다 — 아래 인덱스의 링크를 따라간다.

| 아카이브 | 범위 | 세션 수 |
| --- | --- | --- |
| [2026-06](archive/handoff/2026-06.md) | §1-A ~ §1-B (2026-06-30) | 2 |
| [2026-07](archive/handoff/2026-07.md) | §1-C ~ §1-AL (2026-07-03 ~ 2026-07-31) | 35 |
| [2026-08](archive/handoff/2026-08.md) | §1-AM ~ §1-CM (2026-08-05 ~ 2026-08-31) | 53 |
| [2026-09](archive/handoff/2026-09.md) | §1-CN ~ §1-EE (2026-09-02 ~ 09-30) | 44 |
| [2026-10](archive/handoff/2026-10.md) | §1-EF ~ §1-FL (2026-10-02 ~ 10-22) | 33 |
| (본문 아래) | §1-FM ~ §1-FU (2026-10-22~23, §1-FR 2건) | 10 |

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
| §1-BK | 08-28 | 제어기 연결 끊김 자동 감지 재설계 (`controller/connection/connectionHealth.ts`) | [2026-08](archive/handoff/2026-08.md) |
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
| §1-DD | 09-10 | 제어기 조작 절차를 API 한 겹으로 묶기(1) — 전체/개별 쓰레드 정지 정본 `controller/threads/threadStop.ts`(주입형 IO·테스트 17건) + 5곳 통합 + 정지/일시정지 상태 판정 단일화 + 무검증 성공 보고 2건 수정 + 중복 절차 전수 조사 | [2026-09](archive/handoff/2026-09.md) |
| §1-DE | 09-10 | 제어기 조작 절차 API 통합(2) — Compile/Load/Unload/Start 정본 `projectCommands.ts` + 원격 사본 선택 `remoteProjectPath.ts` + Start 전 콘솔 준비 일원화, FTP Run 의 `-event` 누락·컴파일 에러 미표시 해소 | [2026-09](archive/handoff/2026-09.md) |
| §1-DF | 09-10 | 제어기 패널 섹션 기본 접힘 상태를 사용자가 쓰는 배치로 고정 — 섹션 `TreeItem.id` 부여(+`SECTION_LAYOUT_EPOCH` 세대)로 저장된 접기 상태가 기본값을 덮어쓰던 문제 해소, `GPL: Reset Panel Layout` 명령 신설 | [2026-09](archive/handoff/2026-09.md) |
| §1-DG | 09-10 | SoftEStop 확인 모달의 취소 버튼 중복 — `{ modal: true }` 가 자동으로 붙이는 취소와 명시 항목 `'취소'` 가 겹치던 문제 | [2026-09](archive/handoff/2026-09.md) |
| §1-DH | 09-10 | 컴파일 에러 시 Problems 패널로 전환되지 않던 문제 — 출력 채널 `show()` 가 패널 전환을 덮어쓰던 것을 점프 여부로 분기(`jumpToFirstCompileError` 가 boolean 반환) | [2026-09](archive/handoff/2026-09.md) |
| §1-DI | 09-10 | 정지 불가 쓰레드 진단 `controller/threads/threadStuckDiagnosis.ts` 신설(읽기 전용) — 위치 반복 샘플링·소스 문맥·수신자 식 추출로 복구 후보를 **제시**(전송 안 함), 배포 STOP 실패 시 자동 + `GPL: 정지 불가 쓰레드 진단` 명령 | [2026-09](archive/handoff/2026-09.md) |
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
| §1-DW | 09-18 | **문법 전수 샘플 `samples/syntax-tour` + 커버리지 테스트** — 공식 Statement Dictionary 열거로 GPL 의 문이 25개(+예외 처리)뿐임을 확정하고(`Enum`·`Inherits`·`Implements`·`With`·`Type` 은 GPL 에 없음), `gplStatements.ts` 를 커버 정본으로 삼아 4개 소스에 전 문법을 한 번씩 사용(모션 API 없음). 줄 끝 `' [syntax] <라벨>` 마커 + `src/test/sampleSyntaxCoverage.test.ts` 가 양방향 커버리지·키워드·비GPL 문법·gpr 등재·파서 심볼을 강제. `hello-project` 는 당시 최소 확인용으로 유지(§1-FH에서 간단한 기능 예제로 확장), F5 구성 "Run Extension (syntax tour)" 추가 | [2026-09](archive/handoff/2026-09.md) |
| §1-DX | 09-18 | **시작 시 인덱싱 O(n²) 제거 + 동명 소스 해석을 세션 대상 폴더 기준으로 통일** — 사용자 분석 문서 2건 코드 대조. `symbolCache`: 파일마다 이름 인덱스 재구축(567개에서 798 ms) → 묶음 끝 1회, `openTextDocument` 567회 → 디스크 직접 읽기(`files.encoding` 비UTF-8 만 문서), 32 파일마다 양보, `.gpl` 워처 300 ms 묶음, 요약 로그 1줄. `project/compileUnitTarget.ts` 신설 — **세션 대상 폴더(`host.sessionTargetDir`, deploy 클로저 흡수) 1순위** 규칙을 트리/이벤트(`projectContext`)와 디버거(`_updateProjectDirs`, launch `projectDir` 힌트)가 공유, Quick Attach 가 `projectDir` 동봉. 배포 ERROR CHECK 문구 = Start 직후 스냅숏 명시. `-200` 은 확장 밖 | [2026-09](archive/handoff/2026-09.md) |
| §1-DY | 09-21 | **"컴파일 검증 필요" 배지가 방금 작업한 프로젝트 대신 가장 오래된 것을 가리키던 문제** — 대표 항목 `CompileStaleTracker.current()` 를 가장 먼저 등록된 것 → **가장 최근 표시된 것**으로, `mark()` 는 재표시 시 최근 자리로 승격(`since`·`projectDir` 보존). `markCompileStale`(방금 항목)과 `clearCompileStale`(`current()`)이 서로 다른 항목을 가리키던 편차도 함께 해소 | [2026-09](archive/handoff/2026-09.md) |
| §1-DZ | 09-21 | **식별자 안의 키워드에 색이 칠해지던 문제(`Public SyncSub As TcpSyncCmdSub` 의 `Sub`)** — 선언 규칙 7개가 `(?i)\s*…` 로 시작해 줄 중간의 `Sub As …` 를 선언으로 읽고 있었다. 전부 `(?i)^\s*` 로 줄 머리 고정(Class·Module·Delegate·Sub·Function·Property·Const). 곁들여 `As New <Type>` 의 `New` 가 타입 색을 먹고 정작 타입은 무색이던 것, 한정 이름(`As Net.LogSink`)이 첫 마디만 칠해지던 것을 고치고 타입 참조 스코프를 `storage.type.gpl` 로 통일 | [2026-09](archive/handoff/2026-09.md) |
| §1-EA | 09-21 | **「오류 상세 보기」 로그 `[main] - [main] - …` 겹침 + 에러 코드 분류 범위 표 + `Init` 충돌 실기 확정** — 보고서 되먹임 차단(`host.report`)·제어기 사건 링버퍼(`recentEvents.ts`)·`<E>N</E>` 단일 숫자 상태 프레임 억제; `classifyErrorEntry` 를 공식 `Error_Intro.htm` 범위 표로(`-757`/`-700` = 코드 오류), 라벨 정본 `describeErrorCategory` + R7; 진입점 대조 `startProcedureCheck.ts`; **`samples/init-probe` 실험으로 클래스 멤버 `Init` 이 모듈 초기화에 인스턴스 없이 불려 -757 나는 것 재현·확정** → 진단 `language/initHook.ts`, 예약어 `Lib`, `-757` 힌트; 에러 UI(강조 유지·항목 클릭 이동·복사=상세 보기, `controller/diagnostics/errorReport.ts`); 키워드 호버(`findGplKeyword`, `ByVal`/`ByRef` 문서 규칙) | [2026-09](archive/handoff/2026-09.md) |
| §1-EB | 09-22 | **클래스 이름 참조 찾기가 선언 파일 밖을 놓치던 문제** — 파서의 자기-참조 필드(`Class` 심볼의 `className` = 자기 이름)를 `referenceProvider` 가 raw 로 읽어 클래스 선언을 "자기 자신의 멤버" 로 분류 → 비한정 검색이 정의 파일로 묶이고 다른 파일의 `As X`·`New X(...)` 가 전부 탈락(F2 도 같은 경로라 **클래스 이름 바꾸기가 선언 파일만 고쳤다**). 소속 판정을 정본 `enclosingClassName`/`enclosingModuleName` 으로 교체 + 사용부 실행도 타입 선언을 복원(`isTypeUsageAt`) + `renameProvider` 충돌 검사도 같은 정본. 같은 세션에 **문자열 참조를 소비 위치로 좁히고**(로그 문자열 오탐 — `SYMBOL_STRING_CONSUMERS`), **제어기 채널을 번호가 아니라 이름으로**(`channelNames.ts` · 하드 규칙 §0-8 · 구조 테스트 R8), 패널 「전체 쓰레드 복사」(`controller/threads/threadReport.ts` — 상황 스냅샷과 같은 표, R7 규칙 추가로 `controllerStatus` 의 집계 사본도 정리) | [2026-09](archive/handoff/2026-09.md) |
| §1-EC | 09-22 | **중첩 source/library breakpoint identity 수정** — `ProjectSource` 원문 상대경로를 전송하고 library source는 명령 전에 차단; parser/mirror/reconcile 경로 보존; `Show Break`의 procedure resolution까지 검증 | [2026-09](archive/handoff/2026-09.md) |
| §1-ED | 09-29 | **개요 「커서 따르기」가 클릭한 심볼을 놓치던 문제** — 블록 심볼 범위를 "다음 동급 심볼 직전" 휴리스틱 → 파서가 기록한 짝 `End …` 줄(`endLine`)로. 마지막 클래스 범위가 문서 끝까지 늘어나고 중첩 클래스에서 바깥 클래스 범위가 조기 절단되던 겹침 해소, Property 를 블록 심볼로, 중첩 클래스를 바깥 클래스 children 으로(`parentClassName`) | [2026-09](archive/handoff/2026-09.md) |
| §1-EE | 09-30 | **업로드 진행 바(상태바)** — FTP 업로드 중 상태바에 `██████░░░░  3.2 MB / 10.7 MB` 가 제자리에서 움직이고 완료 요약을 잠시 남김. 집계 `controller/deployment/uploadProgress.ts` · 표시 규칙 `views/uploadProgressBar.ts` · 바이트 표기 정본 `util/formatBytes.ts`(모두 순수, R7), 바이트는 basic-ftp `trackProgress`, 전파는 `deployService.onDidUploadProgress` 를 `activation/deploy.ts` 가 한 번 구독(모든 배포 경로 공통), Save to Flash 는 직접 연결 | [2026-09](archive/handoff/2026-09.md) |
| §1-EF | 10-02 | **다중 프로젝트 AI Setup** — 활성 파일/최장 경로 추측 제거, 폴더 대상 저장·미확정 표시, 설정/안내 불일치 점검, multi-root 범위 지정, MCP 세션의 폴더 확인 가드 | [2026-10](archive/handoff/2026-10.md) |
| §1-EG | 10-02 | **누적 작업 트리 커밋 정리** — §1-DR~§1-EF 변경을 대화·인계 기록과 diff로 대조하고 언어 분석 / 프로젝트·중단점 / 제어기 진단·업로드 / AI Setup / 문서·매니페스트의 5개 커밋으로 분리, 전체 테스트 재검증 | [2026-10](archive/handoff/2026-10.md) |
| §1-EH | 10-02 | **Catch 누락 경고** — GPL 4.2K5 실기 관측에 따라 Catch 없는 Try를 기본 Warning으로 표시, 실험 진단과 분리·설정 즉시 갱신·문 완성 안내·회귀 테스트 | [2026-10](archive/handoff/2026-10.md) |
| §1-EI | 10-02 | **개요(Outline) 검토·개선** — 종류 분류를 VS Code 필터·`@:` 묶음 기준으로(클래스 멤버 Sub/Function→Method, 모듈 프로시저→Function, 멤버 변수→Field), detail 에 시그니처·타입·상수 값·Shared·ReadOnly/WriteOnly(동명 오버로드 구별), `Ctrl+T` 이름 컬럼 위치·순서 일치 질의·로컬 제외, 입력 중 블록의 범위 폴백을 중첩 인식으로. 표현 모델 `language/outlineModel.ts`(순수) + 종류 대응표 `providers/symbolKinds.ts`(R7 규칙 추가), 파서에 Property `isReadOnly`/`isWriteOnly` | [2026-10](archive/handoff/2026-10.md) |
| §1-EJ | 10-02 | **괄호 안 구문 강조 누락(`New X(AddressOf PRB.OnCfg)`)** — 내장 VB 문법의 `#round-brackets` 가 안쪽에 자기 자신만 include 해 괄호 안에서는 GPL 규칙이 전혀 적용되지 않았다. GPL 이 괄호 영역을 직접 열고 `$self` 적용, `AddressOf [한정자.]Proc` 대상에 `entity.name.function`, `New` 규칙을 공백부터 시작해 내장 `storage.type.asp` 와 동점에서 이기게, 낱말 연산자를 `keyword.operator.expression` 으로(Dark+ 키워드 색). 실제 vscode-textmate + 내장 VB 문법으로 전후 토큰 대조 | [2026-10](archive/handoff/2026-10.md) |
| §1-EK | 10-14 | **MCP 1402 명령이 리더 창으로만 나가던 라우팅(창 2개 ECONNREFUSED)** — `resolveBridge` 가 레거시 큐 담당(리더)을 콘솔 경로로 썼다. 1402 는 단일 클라이언트라 리더가 미접속·다른 창이 접속 중이면 리더 창이 새로 접속하다 거부. `pickConsoleRouteInstance`(명시 id → 창 하나 → connected → 리더)로 분리, `transport.consoleRoute{id,via,connected}` 노출, 힌트 문구 수정. 테스트 107/107, 실기 재확인은 §3 | [2026-10](archive/handoff/2026-10.md) |
| §1-EL | 10-14 | **「Stop 이 안 된다」= `Stop <project>` 범위 오해 → MCP `stop_threads` 신설 + `unload_project` 사전 쓰레드 확인** — `Stop <이름>` 은 쓰레드 이름 단위(`Stop MergeCode` 뒤 `LOG_SOCKET` 잔류 → Unload -750 반복, `Stop -all` 로 즉시 정지 실기 확인). 도구는 thread/project/전체 범위 → STATUS 0/-752 접수 → Show Thread -web settle → 1회 재시도 → 잔류 시 `diagnoseStuckThread` 안내; Unload 는 활성 쓰레드 있으면 `refused:"threads-active"`(전송 안 함); `statusHint` -750/-752, `SERVER_INSTRUCTIONS`·`exportAgentSetup` 안전 규칙·README. Unload 로 Free 0.635→4.356 Mb 실측 | [2026-10](archive/handoff/2026-10.md) |
| §1-EM | 10-14 | **연결 해제 뒤에도 대시보드가 1402 를 다시 열어 쥐던 문제(다른 창 ECONNREFUSED)** — 연결 상태의 정본이 뷰(`controllerTree.isConnected`)였고 `host.setControllerConnected` 가 손으로 나눠 주는 목록에 대시보드가 없었다 + 전송 계층은 연결 의도를 몰라 해제 상태에서도 소켓을 보관. 정본 `controller/connection/connectionSession.ts`(순수) 신설 — 쓰기는 host 한 곳, 대시보드는 구독해 멈춤/재개, `effectiveKeepAlive` 로 해제 상태 명령은 단발 연결, 뷰 플래그 읽기 14곳을 `host.isControllerConnected` 로, R7 규칙 추가. 1079/1079 | [2026-10](archive/handoff/2026-10.md) |
| §1-EN | 10-14 | **타입 참조(`As X`·`New X`·`Inherits X`)가 키워드 색으로 칠해지던 구문 강조** — 타입 이름 스코프가 키워드용 `storage.type.gpl`(Dracula 분홍·Dark+ 파랑)이라 `New RobotArm` 이 한 색이었다(§1-EJ 뒤 `New` 뒤 이름까지 번져 드러남). 세 규칙을 `entity.name.type.gpl` 로 통일, 문법 머리 규칙 (3) 과 `grammar.test.ts` 통일 테스트를 뒤집음(storage.type 금지). 실제 토큰화 샘플 대조 103 토큰 모두 의도한 변화. 1079/1079 | [2026-10](archive/handoff/2026-10.md) |
| §1-EO | 10-14 | **AI(MCP) 경유 제어기 동작이 Output 에 보이지 않던 문제(사용자 지적) + MCP `deploy_project` 가 작업 완료 뒤에도 300초 타임아웃하던 원인** — 브리지 `gpl.controller.sendCommand` 는 `[Command] >>> … (agent)` 한 줄만 남기고 응답은 GPL Traffic 에만, 패널도 열지 않았다 → 순수 `controller/automation/agentCommandLog.ts`(요약 줄·본문 상한=Traffic 설정·실패 표기·조용한 뒤 첫 요청만 패널 열기)와 설정 `gpl.agentBridge.revealOutput`(기본 켬). 배포 완료 토스트를 `await` 해 비모달 알림을 닫을 때까지 명령 Promise 가 안 끝나던 것을 then 으로 교체. 1084/1084 | [2026-10](archive/handoff/2026-10.md) |
| §1-EP | 10-14 | **에러 줄 붉은 강조가 쓰레드 재시작 뒤에도 남던 문제(사용자 보고, `_data_Station.gpl:257 Throw ex`)** — `ExecutionDecorations` 는 문서 편집·덮어칠하기로만 지워져 제어기 상태와 이어진 경로가 없었다. 순수 `controller/debugging/executionMarks.ts`(`isErrorMarkStale`/`isStoppedMarkStale`: 주인 쓰레드가 목록에 없거나 Error/정지 상태가 아니면 낡음, 주인 모르면 같은 종류 상태가 어디에도 없을 때) + `showError/showStopped(…, { threadName })` + `reconcile(snapshot)`, 트리 `onDidChangeRuntimeState`(doRefresh·enterDebugMode·clearCachedControllerState) 구독. 테스트 6건, 1098/1098 | [2026-10](archive/handoff/2026-10.md) |
| §1-EQ | 10-14 | **AI(MCP) 상태 확인 반복 낭비(사용자 지적) → 재확인 차단·대기 도구·런타임 콘솔 스트림** — deploy 완료 결과를 받고도 operation_status 목록→상세→Show Memory 로 재확인하던 것을 `DeliveredResultMemory`(재조회는 `redundant` 요약만)·`next:"none"` 으로 끊고, `wait_operation`(서버 대기)·`runtime_console_read`(확장 `RuntimeConsoleBuffer` 커서/패턴 대기 + 파일 캡처)·`list_remote_projects`(FTP LIST) 신설. 응답 축약(`compactOperationResult`·`project_target` 후보 제거·`controller_status` 중복 블록 제거), deploy 타임아웃 시 작업 기록으로 결과 복구, show_threads 실패 구조화. 다른 세션 증상 10건 중 8건 반영. MCP 114/114 · 확장 1098/1098 | [2026-10](archive/handoff/2026-10.md) |
| §1-ER | 10-19 | **Debug Console 여러 줄 실행 + 상태 변경 명령 미전송 안내** — 붙여 넣은 입력을 줄별로 순차 처리하고, `>` 상태 변경 명령의 확인은 묶음당 한 번. `>` 없는 `Break`/`Stop`/`Execute`는 명령으로 인식했지만 원문 명령을 보내지 않았음을 명확히 표시. 순수 입력/표시 모델 `debug/replInput.ts`, 테스트 4건, 전체 1102/1102 | [2026-10](archive/handoff/2026-10.md) |
| §1-ES | 10-19 | **확장이 다른 IP 에 연결돼 있는데 MCP 가 "확장 미실행" 으로 보고(Sample Prep 보고, 배포·콘솔 전부 막힘)** — presence 를 `GPL_HOST` 로만 찾아 `.mcp.json` 이 Export 시점 주소로 남으면 `presence-missing`. MCP `describeHostMismatch`/`hostMismatchFix` → `reason:"host-mismatch"`·`hostMismatch` 를 `extension_status`·`controller_status(likelyCause)`·`project_target`·`extension_resolve(EXTENSION_HOST_MISMATCH)`·`deploy_project`·`extension_list`·`diagnostic_snapshot` 에, 같은 작업 창이면 wake 생략. 확장은 `findMcpHostMismatch`(순수) + 연결 확립 시 경고(「Export 재실행」) + Check 의 `currentController` 대조. MCP 118/118 · 확장 1104/1104 | [2026-10](archive/handoff/2026-10.md) |
| §1-ET | 10-19 | **「런타임 콘솔(1403)이 확장에서는 안 붙고 수동으로는 붙는다」(Sample Prep 보고) — 원인 미확정, Live Log 시작 명령의 결과 표시 보강** — 사후 스냅샷 2건(17:46·18:02)은 1402·1403 동시 ECONNRESET + ARP 가 MSI 게이트웨이 = 직결 경로 유실 패턴이고, 유실 확정 시 런타임 콘솔은 설계대로 STOP(자동 재접속 없음). 새 창의 `[1403]` Traffic 은 미입수. 「Start Live Log Terminal」이 대상 `ip:port`·명령 콘솔 연결 여부를 터미널에 적고 `forceImmediateReconnect` 로 즉시 붙어 본 뒤 결과를 알림+터미널에 표시(종전엔 결과 무관 "연결 시도" 토스트). 1104/1104 | [2026-10](archive/handoff/2026-10.md) |
| §1-EU | 10-19 | **Upload & Start 는 성공인데 Start 뒤 메인 쓰레드가 -1509 로 Error 정지한 것을 알리지 않음(Sample Prep 보고) + MCP refused 때 로컬 소유 PID + `pausedThreads` 에 Error 혼입** — 순수 `controller/threads/postStartWatch.ts`(Start 뒤 `postStartWatchMs` 동안 Show Thread 폴링 → Error 면 상세로 코드·메시지·file:line, -1509 힌트) → `DeployResult.runtimeError`(success 는 유지), 호출측은 에러 토스트(「오류 상세」)·줄 강조·오류 컨텍스트·스냅샷 요약. MCP `deploy_project` 에 `runtimeError`·`warning`, 목록 요약에 `runtimeError`. `controller_status` 실패 응답 `observations.localConnections`(Get-NetTCPConnection, foreignOwners → 추론 1순위·verdict). `summarizeThreads` 를 pausedThreads/errorThreads/stoppedThreads 로. MCP 121/121 · 확장 1108/1108 | [2026-10](archive/handoff/2026-10.md) |
| §1-EV | 10-20 | **매개변수 목록의 두 번째 이후 `ByVal`/`ByRef`만 본문색이던 구문 강조** — 내장 VB `variable.other.asp`가 쉼표 뒤 공백부터 먼저 시작해 GPL 낱말 규칙을 이기던 TextMate 경쟁. GPL 수식어 규칙도 `\s*`로 같은 위치에서 시작하고 캡처는 낱말만 유지, 경쟁 조건 회귀 테스트 추가. `EM2RS_Probe` 실제 토큰화 45/45 · 최종 1118/1118 · 0.9.15 VSIX | [2026-10 아카이브](archive/handoff/2026-10.md#1-ev-2026-10-20-세션--매개변수-목록에서-쉼표-뒤-byvalbyref만-본문색이던-구문-강조) |
| §1-EW | 10-20 | **개선 메모 반영: 원격 경로 오판 차단·Start 컴파일 진단·FTP 452 안내·참조 폴백 경량화·MCP 대상 키 일치** — `/GPL` 조회 실패 시 `/flash/projects` 폴백 금지, 선택 후보 미확인 시 FTP 쓰기 전 중단. `Start -compile` 에러를 Problems/MCP 결과로 구조화. `.gpr` 없는 참조 검색은 현재 폴더 재귀 범위 + 디스크 직접 읽기 + private 파일 밖 검색 생략 + 요약 로그. 명시 `projectDir`에 세션 이름을 섞지 않음. -506 lint는 수치 근거 없어 보류. 확장 1118/1118 · MCP 123/123 | [2026-10](archive/handoff/2026-10.md) |
| §1-EX | 10-20 | **Sample Prep Quick Compile/브리지 후속** — MCP Compile/Start의 `</STATUS>` 대기 전달, 배포 루트 기준 `Lib\...` 경로 해석, `confirmStart:true` 중복 모달 제거, 브리지 큐 정체 presence, 표현 불가 쓰레드 이름 skip, 실패 문구 보강. 확장 1121/1121 · MCP 129/129 | [2026-10](archive/handoff/2026-10.md) |
| §1-EY | 10-20 | **VS Code 사람 연결과 AI 접근을 한 명령 콘솔 세션으로 강제** — 실제 Sample Prep 경로가 `extension-bridge`임을 확인하고, Export `.mcp.json`에 `GPL_BRIDGE=only`를 써 직접 TCP 폴백을 금지. Check가 누락·`auto`·`off`를 설정 문제로 보고하며 생성 가이드·README·런북을 같은 계약으로 정정. 확장 1122/1122 · MCP 129/129 · 0.9.17 VSIX | [2026-10](archive/handoff/2026-10.md) |
| §1-EZ | 10-20 | **AI 영구 기본 프로젝트 제거** — `gpl.controller.defaultProject`와 Export의 `GPL_PROJECT*`를 제거하고 대상은 `project_target({projectDir})` 세션에만 유지. Check의 「작업 대상 미확정」 제거, 기존 AGENTS 자동 블록도 Export가 갱신. 확장 1117/1117 · MCP 128/128 · 0.9.18 VSIX | [2026-10](archive/handoff/2026-10.md) |
| §1-FA | 10-21 | **제어기 FTP 프로젝트 로컬 작업공간** — 실측 뒤 Live/Snapshot manifest, staging 무결성, 저장된 `.code-workspace`, 중첩 `/GPL/Lib` 배포 루트, 공통 쓰기 게이트 구현. 새 테스트 6/6, VSIX/제어기 재확인은 §3 | [10월 아카이브](archive/handoff/2026-10.md#1-fa-2026-10-21-세션) |
| §1-FB | 10-21 | **디지털 I/O 제어판** — 트리의 Show/Set DIO 두 단계 UI를 대시보드 `상태 / 디지털 I/O` 탭으로 통합. 상태등·FORCED·검색·필터·카드별 강제/해제, 확인 모달·중복 방지·성공 후 재조회. 순수 파서/명령 규칙 5건, 전체 1128/1128, 0.11.0 VSIX | [10월 아카이브](archive/handoff/2026-10.md#1-fb-2026-10-21-세션) |
| §1-FC | 10-21 | **무정지 Upload Only + 다중 프로젝트 배포 큐** — Stop/Show Thread/Compile/Start 없이 `/GPL`만 갱신하고 원격 전용 삭제 보류·컴파일 필요 표시. 같은 제어기 요청은 `QUEUED`로 기록해 순차 실행, 실제 작업 잠금은 유지. 확장 1139/1139 · MCP 131/131 · 0.13.0 VSIX | [10월 아카이브](archive/handoff/2026-10.md) |
| §1-FD | 10-21 | **Save to Flash 전원 차단 금지 경고** — FTP 시작부터 상태바 경고, `Sync` 종결 STATUS 0 뒤 10초 안정화가 끝나야 해제. 실패·취소 경로도 확인하며 안전 미확정이면 경고 유지. 순수 상태/표시 테스트 4건, 전체 1139/1139, 0.13.1 VSIX | [10월 아카이브](archive/handoff/2026-10.md#1-fd-2026-10-21-세션--save-to-flash-중-전원-차단-금지-경고와-안전-확인) |
| §1-FE | 10-21 | **Stop All이 업로드/배포를 남기던 충돌 차단** — 명시적 전체 정지를 실행 중·대기 중 작업 취소로 전파, FTP 파일 경계 뒤 삭제·Compile·Start 차단, 내부 배포 Stop 제외, Save to Flash 안전 확인 유지. 확장 1139/1139 · MCP 131/131 · 0.13.1 VSIX | [10월 아카이브](archive/handoff/2026-10.md) |
| §1-FF | 10-22 | Marketplace 게시 준비 — Release 테스트·동일 VSIX/체크섬 전달·Entra OIDC 게시, 개발용 지침/메모 패키지 제외. 0.13.2 | [10월 아카이브](archive/handoff/2026-10.md#1-ff-2026-10-22-세션--marketplace-등록과-업데이트-배포-경로-준비) |
| §1-FG | 10-22 | 수신함 8개 대조: 메모리 사전 검사·콘솔 대기 분리·Try 안내 정정·MCP Stop 및 응답 요약 | [10월 아카이브](archive/handoff/2026-10.md#1-fg-2026-10-22-세션) |
| §1-FH | 10-22 | **hello-project 간단한 기능 예제** — 최초 5개 소스 확장은 복잡하다는 사용자 피드백으로 축소. Main.gpl 69줄의 Add·Clamp·작은 Counter·For와 README 14줄로 핵심 편집 기능 체험. 정적 검사·진단 0건·관련 테스트 55/55, 0.14.0 유지 | [10월 아카이브](archive/handoff/2026-10.md) |
| §1-FI | 10-22 | **구조 개편 1단계** — 0.14.0 기준 커밋·작업 브랜치, controller 64개 파일을 12개 기능 폴더로 분류, 실행 로직 보존·구조 R9 추가. 0.14.1 | [10월 아카이브](archive/handoff/2026-10.md) |
| §1-FJ | 10-22 | **구조 개편 2단계** — SymbolIndex·SymbolProjectScope·WorkspaceSourceLoader·표현 분리, 공개 메서드 28개 유지, 관련 28/28·동등성 비교 2064건. 0.14.2 | [10월 아카이브](archive/handoff/2026-10.md) |
| §1-FK | 10-22 | **구조 개편 재검토** — 파일 갱신 경합·참조 인코딩 수정, 중복 refresh 직렬화, 빌드 잔여 JS·맵 자동 제거. 0.14.3 | [10월 아카이브](archive/handoff/2026-10.md) |
| §1-FL | 10-22 | **정식 로고 적용** — SVG 정본·PNG 확장 아이콘·사이드바 단색 심벌과 README 통일. 0.14.4 | [10월 아카이브](archive/handoff/2026-10.md) |
| §1-FM | 10-22 | **제어기 상태·온도** — 공식 조회 항목 조사, CPU·앰프 온도·실측 추이·원문·사용자 주의 기준, 기본 10초 진단 분리·취소·캐시 격리. 0.15.0 | 본문 ↓ |
| §1-FN | 10-22 | **매개변수 Hover 누락** — 공통 식별자 해석·개별 범위와 내장 한정 이름 조회, 회귀 6건. 0.15.1 | 본문 ↓ |
| §1-FO | 10-22 | **README 이용자 안내 개편** — 기능·지원 환경·시작 방법과 배포·디버깅·모니터링·AI 연동 정리, 개발·게시·내부 API 설명 제거. 0.15.2 | 본문 ↓ |
| §1-FP | 10-22 | **누적 변경 커밋·푸시** — 확장 1222/1222·MCP 137/137·문서 빌드, 기존 VSIX 167개 파일 일치, 사용자 확인 뒤 codex/domain-modules 원격 반영 | 본문 ↓ |
| §1-FQ | 10-22 | **첫 Hover 지연 개선** — 현재 파일 우선 조회·오버로드 자기 선언 제외·라이브러리 폴더 캐시, 실제 소스 성능 대조. 0.15.3 | 본문 ↓ |
| §1-FR (PR #36) | 10-23 | **PR #36 병합 검증** — Linux CI fixture와 Flash 안전·진입점·Rename 리뷰 수정, 회귀 6건·전체 1228/1228·MCP 137/137. 0.15.4 | [본문](#1-fr-2026-10-23-세션--pr-36-병합-ci와-리뷰-수정) |
| §1-FR (제어기 디버깅) | 10-23 | **제어기 프로젝트 열어 디버깅** — Snapshot·참조 라이브러리·작업공간 전환 후 일회성 Attach, 자동 Start 차단·기존 BP 보존. 0.16.0 | 본문 ↓ |
| §1-FS | 10-23 | **디버깅용 FTP 라이브러리 탐색 오류** — 없는 경로의 목록 형식 오류 실측, 부모 확인·캐시·원격 대소문자 보존. 0.16.1 | 본문 ↓ |
| §1-FT | 10-23 | **README 문체·분량 개선** — 개인 취미 프로젝트 소개·kaomoji, 버전·VSIX 설치·기본 단축키 제거, GPL/GPR 안내. 0.16.2 | 본문 ↓ |
| §1-FU | 10-23 | **로컬·GitHub 병합** — 원격 Flash·진입점·Rename 수정과 로컬 Hover·제어기 프로젝트 디버깅 통합, 경로 fixture·문서 충돌 해소. 0.16.3 | 본문 ↓ |

---

**최근 세션 본문 — §1-FM ~ §1-FU (2026-10-22~23).** 이 아래부터는 세션 원문이다.

> §1-FR은 독립된 로컬·원격 작업에서 중복 사용됐다. 기존 참조와 원문을 보존하며, PR #36 병합 검증과 제어기 프로젝트 디버깅을 제목·개별 링크로 구분한다.

## 1-FM. 2026-10-22 세션 — 제어기 상태 정보 조사와 온도·갱신 개선

### 요청·관측

사용자는 조회 가능한 상태 정보를 먼저 조사·정리하고, 발열 검토 중 코드와 함께 온도를 볼 수 있게 개선해 달라고 요청했다.
기존 대시보드는 기본 1.5초마다 8개 명령을 조회했고 온도는 없었다. 시스템 정보는 메모리·Flash·CPU Profile만 조회했다.

- Brooks 검색 스킬은 셸 DNS 오류로 캐시를 사용했고, 공식 System Console Panel·Servo Errors·Motor Temperature Sensing·Pd/Pdx·Show Memory·Controller operation modes의 본문은 웹 도구로 확인했다. 조회 항목과 조건은 `docs/reference/controller-telemetry.md`에 정리했다.
- 두 VS Code 창 모두 연결·디버깅 비활성임을 확인한 뒤 기존 MCP 확장 브리지로 읽기만 수행했다. `Show Temperature` STATUS 0에서 CPU 1은 첫 57.1°C, 후속 58.5°C였다. 앰프 4개는 0.0°C, `Pd 101`은 G2400C, `Pd 12605`는 0 배열, `Pd 10110`은 0 배열(모터 감시 비활성), `Pd 12110`도 0 배열이었다.
- G2xxx 앰프는 공식 문서상 수치 조회 센서가 없다. PTC 모터 센서의 상태값과 °C도 구분해야 한다. G2400C CPU 허용·정지 온도 수치는 확인하지 못했으므로 과열을 판정하지 않는다. 후속 `ErrorLog -web ,10`은 빈 DATA·종결 STATUS 0이며 과거 과열 이력 부재를 증명하지 않는다.
- 조사 중 근거 없이 선택한 `Version`은 STATUS -714로 거부됐다. 다른 추측 표기로 재시도하지 않고 문서의 `Pd 101`로 모델을 읽었다. 설정·모션·정지·실행·배포 명령은 보내지 않았다.

### 조치·설계

- `diagnostics/temperature.ts`에 온도 파서·360점 이력을 두고 CPU/Robot/Amp 번호와 센서값을 구분했다. 앰프 0은 원래 반환값을 보존하면서 유효 섭씨값은 null로 두며, 실패·불완전 응답은 숫자로 표시하지 않는다.
- `diagnostics/statusSampling.ts`가 대시보드별 진단 캐시와 실제 표본 시각을 소유한다. 기존 `controllerStatus.ts`는 공개 상수·타입·호출을 재노출하며 확장 큐의 완결 응답을 순수 수집기에 전달하는 어댑터로 남겼다.
- 빠른 갱신은 쓰레드·전원·축·직교 위치 4명령, 온도·자원·과거 에러는 기본 10초로 분리했다. 수동 갱신은 전체 조회하며 자원 비활성 설정과 온도는 독립이다. 명령을 한꺼번에 큐에 넣지 않고 하나씩 기다린다.
- 패널 세대와 연결·대상·가시성을 매 명령 전후 확인해 뒤늦은 조회와 결과를 버린다. 연결 세션·대상 변경 시 진단 캐시와 이력을 초기화하고, 실패한 최신 조회는 이전 성공값으로 대체하지 않는다.
- 온도 배지·센서 카드·조회 시각·최고값 추이·원문을 추가했다. 기본은 과열 미판정이며 선택 설정 `dashboardCpuTemperatureWarningC`는 제조사 보호 한계와 구별되는 사용자 기준이다. 시스템 정보의 온도는 기존 수동/조건부 조회 경로를 따른다.
- 단일 표본의 그래프 범위가 축 보정으로 1°C 늘어나는 표시를 바로잡았다. 캐시 표본을 새 표본으로 중복 기록하지 않으며 그래프 X축은 실제 표본 시각을 따른다.
- 기능 추가이므로 minor 0.15.0을 선택했다. 병행 로고 작업의 0.14.4와 리소스 변경을 보존했다.

### 검증

- 온도 파서·이력·주기 분리·강제 갱신·센서 미지원·미완결 응답·대상 전환·취소·순차 전송·실제 웹뷰 스크립트의 표시/HTML escaping·연결 해제 후 자원값 정리 회귀 **21/21** 통과. 전체 확장 **1222/1222**, MCP **137/137** 통과. 첫 샌드박스 실행의 기존 소켓·junction·임시 파일 오류 16건은 일반 Windows 권한 재실행에서 해소됐다.
- npm run docs:build(strict)와 범위별 git diff --check 통과. 실제 HTML을 560px 폭 Chrome에서 렌더링해 58.5°C·센서 제한·실측 범위가 보이는 것을 확인했다. 캡처는 .tmp/temperature-preview.jpg(조회 기록 미리보기, 새 VSIX의 실제 VS Code 화면은 아님)에 남겼다. 임시 viewport는 복원했다.
- minor 0.15.0의 온도 기능을 병행 Hover 수정 patch 0.15.1이 보존한 현재 버전으로 패키징했다. npm run package:no-bump 성공. dist/gpl-language-support-0.15.1.vsix, **1,384,937 bytes**, SHA-256 **CC7130D59863985A21C6AD8A79D4D2B47543B078B1B05D4571DB24F1273615BC**. 기존 Node DEP0190·JavaScript 번들링 권고 경고가 있고 패키징 실패는 없다.
- ZIP의 package·대시보드 HTML·온도/수집기/어댑터·패널/트리 JavaScript가 현재 파일과 byte 단위로 일치하며 .tmp 자료 혼입은 없다. README·CHANGELOG의 버전도 확인했다. 기존 CRLF와 UTF-8 인코딩을 보존하고 신규 소스·테스트는 UTF-8 without BOM으로 작성했다.
- 브라우저에서 실측 58.5°C와 앰프 0 반환·센서 미확인, 과열 미판정 표시를 확인했다. 새 VSIX의 실제 VS Code Webview 검증과 연속 온도 실측은 별도다.

### 남은 일

CPU 허용 온도는 모델별 하드웨어 자료나 제조사 확인이 필요하다. 지속 발열·장시간 통신 부하·실제 VS Code 표시와 새 VSIX 설치는 수행하지 않았다. 설치·Git 커밋·태그·push·게시 없이 변경으로 남긴다.

## 1-FN. 2026-10-22 세션 — 멤버 접근의 매개변수 Hover 누락 수정

### 증상·원인

`V2/Lib/RobotData/PoseFile.gpl:132`의 `axes = table.AxisCount()`에서 Hover가 비었다는 제보다. 현재 소스에서 table은 JointPoseTable 매개변수이며 AxisCount는 Robot/Pose.gpl:483의 Integer 반환 Function이다. 실행 중인 Sample Prep 확장은 0.14.0이고 디버그 세션은 비활성이다. 기존 GPL Language Support 로그에는 AxisCount 수신자·함수를 찾은 기록과, 같은 표현식에서 수신자 조회 없이 끝난 요청이 함께 있었다.

Hover만 자체 식별자 해석기로 점 표기 전체를 단어·범위로 사용했다. table 위에서는 커서 식이 table을 정확히 골라도 word에 점이 있어 로컬 조회가 생략됐다. 따라서 정의가 매개변수에만 있으면 undefined, 동명 전역 변수가 있으면 그 전역 변수가 표시됐다. 메서드 카드도 전체 점 표기 범위를 반환했다.

### 조치·의도

- 자체 해석기를 제거하고 정의·참조 Provider와 같은 getQualifiedWordAtPosition을 사용한다. 수신자는 기존 cursorExpression·receiverType 경로로 해석하고, Hover 범위는 커서 아래 식별자로 제한한다.
- 내장 조회도 커서 세그먼트까지의 한정 이름을 사용한다. Math.Abs의 문서와 Thread.CurrentThread().Name 반환 타입 체이닝을 유지하면서 Thread 자체와 멤버를 각각 표시한다.
- 실제 Hover Provider·공통 설정/식별자 해석·수신자 해석·SymbolIndex를 함께 실행하는 회귀 테스트 6건을 추가했다. VS Code 경계만 대체한다.
- 병행 온도 작업의 minor 0.15.0을 보존하고 버그 수정 patch 0.15.1로 package·lock·README·CHANGELOG를 맞췄다. 최근 10세션 유지를 위해 §1-FD를 10월 아카이브로 원문 그대로 이동했다. 외부 GPL 소스는 수정하지 않았다.

### 검증

- 수정 전 새 회귀 테스트 6건 중 4건이 실패했고, 수정 후 6/6 통과했다. 매개변수 우선순위·로컬 변수·메서드 시그니처/문서·식별자별 범위·점 주위 공백·배열 인덱싱·내장 함수/클래스·주석/문자열·취소를 확인했다.
- npm run compile 성공. 전체 테스트 첫 실행은 샌드박스의 junction·localhost·임시 파일 권한으로 16건이 실패했고, 제한 밖에서 Node 회귀 테스트를 실행해 1222/1222 통과했다. 제어기 명령은 보내지 않았다.
- 실제 PoseFile.gpl:132 소스를 읽어 같은 Provider에 넣었을 때 axes: Integer, table: JointPoseTable, Function AxisCount() As Integer와 각 식별자의 개별 범위를 확인했다. VS Code API 경계는 대체했으며 실제 마우스 UI 검증은 아니다.
- npm run package:no-bump 성공. dist/gpl-language-support-0.15.1.vsix, 1,384,937 bytes, SHA-256 CC7130D59863985A21C6AD8A79D4D2B47543B078B1B05D4571DB24F1273615BC.
- ZIP의 Hover JavaScript·package manifest가 현재 작업 파일과 동일하며 문서 버전 0.15.1을 확인했다. README 이미지·CHANGELOG 이슈 링크는 vsce의 GitHub URL 변환으로 원본과 다르다. 경고는 기존 Node DEP0190과 JavaScript 번들링 권고이며 패키징 실패는 없다.
- git diff --check 통과. 인코딩·기존 LF/CRLF를 유지했고 새 테스트 파일은 UTF-8 without BOM·LF다.

### 남은 일

새 VSIX를 설치한 뒤 실제 편집기에서 PoseFile.gpl:132의 axes·table·AxisCount 각 Hover 표시와 범위를 확인한다. 설치·F5 UI·제어기 동작 검증은 수행하지 않았다. Git 커밋·태그·push·게시도 수행하지 않는다.

## 1-FO. 2026-10-22 세션 — README를 확장 이용자용 기능·지원 안내로 개편

### 증상·원인

README에 Marketplace 게시 예정 문구, 로컬 패키지 상태, 확장 개발·릴리스 절차와 AI 호출 API·제어기 명령 구문이 섞여 있었다.
사용자는 이 파일이 개발자용 내부 자료가 아니라 확장 이용자가 기능과 지원 범위를 파악하는 문서임을 명확히 했다.

### 조치·의도

- 주요 기능·지원 환경·설치·시작 방법을 앞에 두고 언어 지원, 프로젝트·배포, 디버깅, 상태·로그, AI 연동을 이용자 관점으로 다시 썼다.
- 게시 예정·로컬 패키지 버전·개발 환경 실행법·내부 프로토콜과 호출 API는 제거했다. 변경 이력과 GPL 언어·프로젝트·온도 참고 자료로 연결한다.
- 명령 제목과 설정 기본값을 package.json과 대조했다. Upload & Start의 컴파일 오류가 Problems에 표시되는 현재 동작과 디버거 분리·프로그램 정지의 차이를 반영했다.
- 문서 개선 patch **0.15.2**로 package·lock·CHANGELOG를 맞췄다. README에는 수시로 바뀌는 버전을 중복 표기하지 않는다.
- 후속 피드백에 따라 설정 기본값 표도 제거하고 현재값은 VS Code 설정 화면으로 안내한다. 릴리스 절차의 README 버전 갱신 지시도 기능·사용 안내 갱신으로 바꿔 같은 중복을 다시 만들지 않게 했다.
- 최근 10세션 유지를 위해 §1-FE를 10월 아카이브에 원문 그대로 옮기고 기존에 뒤처진 본문 범위·아카이브 집계도 실제 섹션 기준으로 맞췄다.

### 검증

- README의 명령 제목 **22개**, 설정 키 **6개**를 manifest와 대조했다. 로컬 링크·이미지 **5개**의 대상과 Markdown 표 **6개**의 파싱·HTML 변환을 확인했다. 확장 버전·설정 기본값·개발/내부 API 문구가 남지 않았음을 확인했다. 실제 확장 화면을 렌더링한 UI 검증은 아니다.
- `npm run compile` 성공. `npm run pre-release-check`는 **15/17**로, 기존 미커밋 변경과 `codex/domain-modules` 브랜치 조건만 실패했다. 이를 통과시키기 위한 커밋·브랜치 변경은 하지 않았다. 문서만 수정해 전체 회귀 테스트는 반복하지 않았다.
- `npm run package:no-bump` 성공. `dist/gpl-language-support-0.15.2.vsix` **1,380,010 bytes**, SHA-256 **EBB6DD8A52112E2CC0490E0D5D3EDD9D030B17F1B52196AC20946738CF77520A**. 기존 Node `DEP0190`과 JavaScript 번들링 권고가 있었고 패키징 실패는 없었다.
- VSIX의 manifest가 현재 package.json과 일치하며 README도 vsce의 URL 변환 외에는 현재 파일과 동일하다. 로고·CHANGELOG 포함, 문서 링크의 GitHub URL 변환, 내부 지침·임시 파일 제외를 확인했다.
- `git diff --check` 통과. 수정한 7개 파일의 UTF-8 without BOM·CRLF를 보존했고 §1-FE의 아카이브 이동은 원문 바이트와 일치한다. 외부 Marketplace·Releases 공개 상태 조회는 이 환경에서 성공하지 못했으며 게시 여부를 단정하지 않았다.

### 남은 일

실제 확장 화면에서의 README 표시와 외부 링크 접근은 별도 확인 대상이다. 실행 코드 변경, VSIX 설치, F5, 제어기 명령, Git 커밋·태그·push·게시를 수행하지 않는다.

## 1-FP. 2026-10-22 세션 — 누적 변경 검증과 커밋·푸시

### 요청·범위

사용자는 현재 변경을 커밋하고 푸시 전에 질문해 달라고 요청했다. 현재 브랜치는 codex/domain-modules이며 origin/main에는 기존 로컬 커밋 6개가 아직 없다. GitHub 조회로 원격 main이 0ac3978이고 같은 이름의 원격 작업 브랜치가 없음을 확인했다.

### 조치·의도

- 0.14.1~0.15.2에 해당하는 controller 분류·SymbolCache 역할 분리·갱신/빌드 안정화·온도·Hover·로고·README 변경을 하나의 누적 변경 커밋 대상으로 정리했다. 기능·버전 변경은 추가하지 않는다.
- 스테이징한 새 symbolPresentation.ts의 빈 줄 공백 1건만 제거했다. 최근 10세션을 유지하도록 §1-FF를 10월 아카이브로 원문 그대로 이동하고 인덱스를 갱신했다.
- 216개 파일을 4f20480으로 커밋했다. 사용자가 현재 작업 브랜치로 푸시를 선택한 뒤 기존 6개와 새 커밋을 origin/codex/domain-modules에 반영하고 추적 브랜치를 설정했다. 태그·공식 Release·Marketplace 게시는 요청 범위에 포함하지 않는다.

### 검증

- 일반 Windows 권한에서 npm test(compile 포함) **1222/1222**, MCP **137/137** 통과. npm run docs:build(strict)도 성공했다. 문서 도구의 기존 안내 배너가 있었고 빌드 실패는 없다.
- 기존 VSIX의 manifest·운영 JavaScript/소스맵·MCP 번들·media·resources **167개**를 현재 파일과 SHA-256으로 대조해 불일치 0개를 확인했다. 새 동작이나 포함 파일 변경이 없어 0.15.2와 기존 VSIX를 유지한다.
- dist/gpl-language-support-0.15.2.vsix: **1,380,010 bytes**, SHA-256 **EBB6DD8A52112E2CC0490E0D5D3EDD9D030B17F1B52196AC20946738CF77520A**. 기존 패키징 기록의 Node DEP0190·JavaScript 번들링 권고는 유지되며 이번에 패키징을 다시 실행하지 않았다.

### 남은 일

푸시 완료 후 원격 작업 브랜치의 4f20480과 원격 main의 기존 0ac3978을 직접 확인했다. 확인 대기 중 생긴 docCommentOverloads.ts·해당 테스트 수정과 scripts/dev/hover-performance.js는 별도 작업 변경으로 보존했다. 이 완료 기록만 후속 문서 커밋으로 반영한다. 새 VSIX 설치·F5 UI·실제 제어기 동작 검증은 이번에 수행하지 않았으며 기존 §3 항목을 유지한다.

## 1-FQ. 2026-10-22 세션 — 첫 Hover의 불필요한 프로젝트 탐색 제거

### 증상·원인

마우스 Hover의 반응이 느리다는 요청이다. 첫 요청 때 현재 파일에 정의가 있어도 다른 프로젝트의 동명 후보부터 좁혔고, 오버로드 자기 선언·캐시 사본에도 컴파일 단위를 확인했다. 라이브러리 해석에서는 여러 프로젝트가 같은 폴더 후보를 동기적으로 반복 조회했다. 문서 파싱 캐시는 이미 있었으며, 측정한 주된 지연은 프로젝트 탐색이었다.

### 조치·의도

- 인자별 오버로드 해석이 없는 이름 조회는 현재 파일의 정의를 먼저 반환한다. 호출 문맥이 있거나 외부 정의를 찾는 경우의 프로젝트 경계·인자 수·타입 해석은 유지한다.
- 오버로드 자기 선언·캐시 사본은 프로젝트 관계 확인 전에 제외하며, 같은 파일의 형제는 같은 컴파일 단위로 처리한다.
- CompileUnitIndex가 성공·실패한 폴더별 .gpr 조회를 재사용한다. projectSources의 기존 경로 우선순위와 탐색 규칙을 주입형 조회로 그대로 사용하고 .gpr 내용·목록 변경 시 함께 무효화한다.
- scripts/dev/hover-performance.js로 실제 SymbolCache 인덱싱·Hover Provider를 실행한다. CLI의 workspace·source·line·word로 대상을 지정하며, 경과 시간·동기 I/O·문서 읽기 수·카드 SHA-256을 출력한다. 설정·VS Code hover.delay는 변경하지 않았다.

### 측정·검증

수정 전 기준은 4f20480의 관련 TypeScript 네 파일을 메모리에서 컴파일해 같은 하니스에 주입했다. 각 시나리오에서 프로젝트 관계 캐시를 비우고 첫 요청 1회·반복 50회를 측정했다. 시간은 참고 표본이며 VS Code UI 실측이 아니다.

| 대상 — PoseFile.gpl:132 AxisCount | 첫 요청 수정 전 → 후 | 폴더 동기 조회 전 → 후 |
| --- | --- | --- |
| V2: 234파일·9,173심볼 | 505.779 → 9.206 ms | 4,139 → 0 |
| Sample Prep: 1,324파일·57,609심볼 | 1,165.761 → 11.273 ms | 5,384 → 0 |

두 규모에서 수정 전후 카드 SHA-256은 0b5a3344b4df886657d449164e561b340e6abb5a7cf316e443458aae48c66ed5로 동일하다. 반복 중앙값은 V2 0.112 ms 미만, 상위 범위 0.408 ms 이하였다. V2의 파일별 함수 12개 추가 표본에서 첫 요청 0.528~248.327 ms를 확인했다. 실제 외부 오버로드 관계가 필요한 3개 표본은 약 214~248 ms와 폴더 조회 356회를 사용하므로 모든 첫 Hover가 디스크 조회 없이 끝나는 것은 아니다.

- 신규 회귀 4건: 현재 파일 조회의 관계 탐색 생략과 호출 해석 보존, 오버로드 자기·사본·같은 파일 제외, 폴더 조회 성공·실패 재사용과 새 .gpr 무효화 반영, 실제 Hover의 불필요한 관계 탐색 차단.
- npm test(compile 포함) **1226/1226** 통과. 첫 샌드박스 실행은 junction·파일 교체·loopback TCP 권한 제한으로 기존 테스트 16건이 실패했으며 일반 Windows 권한 재실행에서 모두 통과했다. git diff --check·성능 하니스 구문 검사도 통과했다.
- npm run package:no-bump 성공. dist/gpl-language-support-0.15.3.vsix: **1,380,619 bytes**, SHA-256 **404854D618F3264239B3C15293909C9751FE7A5CCBBC3C97CB39D17AF1AB7643**. 기존 Node DEP0190·JavaScript 번들링 권고 경고가 있고 패키징 실패는 없다.
- VSIX의 변경 JavaScript 4개·Hover Provider·MCP 번들·package.json 7개를 현재 파일 SHA-256과 대조했다. manifest 버전과 개발용 파일 제외를 확인했다. UTF-8 without BOM·CRLF·NUL 없음, 최근 세션 10건과 §1-FG 원문 아카이브 일치도 확인했다. README는 버전을 중복 표기하지 않는 현행 정책에 따라 유지했다.

### 남은 일

새 VSIX 설치 뒤 실제 편집기 마우스 반응을 확인한다. VS Code의 표시 대기·렌더링·다른 확장에 의한 Extension Host 점유는 하니스에 포함하지 않았다. 설치·F5 UI·제어기 조작·Git 커밋·태그·push·게시를 수행하지 않는다.

## 1-FR. 2026-10-23 세션 — PR #36 병합 CI와 리뷰 수정

### 증상·원인

사용자가 원격 codex/domain-modules의 누적 변경을 main에 병합하도록 요청했다. PR #36의 Linux CI는 compile을 통과했지만 Windows 경로를 전제한 fixture 2건 때문에 1220/1222로 실패했다. 자동 리뷰에서 미완결 Sync STATUS를 성공으로 처리하는 Flash 안전 경계, 작업 쓰레드·잘린 스택의 진입점 오진, 다른 프로젝트를 포함하는 Rename 충돌 검사도 확인했다.

### 조치·범위

- fixture를 실행 OS의 path.resolve·dirname·basename·sep로 만들고 Windows에서만 대소문자·구분자 차이도 검사한다. 운영 경로 정규화 계약은 유지한다.
- Flash 안전 판정에 기존 isCleanlyTerminated 종결자 규칙을 재사용했다. 숫자 STATUS 0이 있더라도 종결 응답이 없으면 unknown으로 남고 안정화 카운트다운·경고 해제로 넘어가지 않는다.
- 진입점 대조는 대상 프로젝트·메인 쓰레드와 완결된 전체 스택이 확인될 때만 수행한다. 캐시된 디버그 이벤트의 축약 프레임은 완결 스택으로 간주하지 않고, Show Stack 결과는 전체로 비교하되 표시만 8개로 제한한다.
- Rename 충돌은 기존 isSameCompileUnit 판정을 재사용한다. 같은 단위의 프로젝트·라이브러리 충돌은 계속 차단하고 무관한 프로젝트의 동명 모듈은 제외한다.
- 원래 checkout의 진행 중인 0.15.3 작업을 건드리지 않고 f1a26fd에서 만든 독립 worktree에서 수정했다. 별도 작업 버전과 겹치지 않도록 버그 수정 patch 0.15.4를 선택했다. §1-FQ 번호도 재사용하지 않는다.
- 최근 10개 세션을 유지하도록 §1-FG를 원문 그대로 아카이브로 이동했다.

### 검증·결과 확인

- 수정 전 모의 입력에서 잘린 Sync 응답이 ok:true가 되고 작업 쓰레드가 시작 프로시저 불일치로 표시되는 것을 재현했다. 실제 제어기 명령은 보내지 않았다.
- 독립 Windows worktree의 npm test(compile 포함) **1228/1228**, MCP **137/137** 통과. Flash·진입점·실제 Rename Provider의 경계 회귀 6건을 추가했다. git diff --check 통과.
- npm run package:no-bump 성공. dist/gpl-language-support-0.15.4.vsix **1,364,300 bytes**, SHA-256 **5CD0631386F3A49A8D3AA8DB7BBCA6E3E46C2E2F6F020B9E385B96AAD98F87B7**. 내부 manifest·운영 코드·리소스 168개가 현재 파일과 일치하고 임시 파일·내부 지침·테스트 소스가 없음을 확인했다. 초회 ZIP 검사에서 임시 커밋 메시지 포함을 찾아 제외 폴더로 옮긴 뒤 같은 버전으로 재생성했다. 최종 산출물은 원래 checkout의 dist에도 보존했다. 기존 Node DEP0190·JavaScript 번들링 권고가 있고 최종 패키징 실패는 없다.
- Linux CI·MCP·VSIX smoke 검사의 최종 결과와 main 병합 상태는 [PR #36](https://github.com/nir414/GPL_language/pull/36)에서 확인한다. 원격 head SHA가 달라지면 이전 검사 결과를 새 커밋의 검증으로 취급하지 않는다.

### 남은 일

새 0.15.4 VSIX의 F5 UI·실제 제어기·Flash 안전 경고 실물 확인은 수행하지 않았으며 기존 §3 항목을 유지한다. 패키징·회귀 검증은 실제 장비의 Flash 쓰기 안전성을 증명하지 않는다.

## 1-FR. 2026-10-23 세션 — 제어기 프로젝트를 열어 바로 디버깅

### 증상·원인

FTP 다운로드와 로컬 작업공간, Attach가 분리돼 제어기 프로젝트를 열어 디버깅하기까지 사용자가 대상과 경로를 직접 맞춰야 했다. 기존 Attach는 stopOnEntry=false여도 configurationDone에서 Start 경로로 들어갔고, preflight를 끄더라도 파일 BP 갱신과 분리에서 기존 BP를 지울 수 있었다.

### 조치

- FTP 폴더 우클릭과 명령 팔레트에 gpl.controller.openProjectForDebugging을 추가했다. 확장의 globalStorageUri/controller-projects 아래 새 세션에 소스 Snapshot을 받고, 원격 폴더 상대 배치를 보존한다. ProjectName은 폴더명과 구분해 .gpr에서 읽고 projectDir과 함께 고정한다.
- ProjectLibrary 그래프와 기존 조상 경로 후보 규칙을 재사용해 필요한 최상위 라이브러리 폴더를 순차 다운로드한다. 순환·중복 참조를 끊고 미해결 참조를 안내한다. 통신 실패를 폴더 없음으로 숨기지 않는다. 다운로드 사본의 manifest 게이트로 자동 업로드·배포·Flash 쓰기를 막는다.
- 저장된 .code-workspace, 소스 .vscode/launch.json과 활성화용 marker를 만든다. 전환 전에 globalState에 일회성 요청을 저장하고, 해당 작업공간의 신뢰 확인 뒤 10분 이내에만 한 번 소비한다. 나중에 다시 열거나 첫 연결이 실패하면 F5로 사용한다. 소스 파일은 자동 삭제하지 않는다.
- 새 startOnAttach=false는 stopOnEntry와 configurationDone 양쪽의 자동 Start를 끈다. 기존 설정의 기본값 true는 유지하되 Attach Only 명령도 false를 명시한다. preserveExistingBreakpoints=true는 Attach에서 종결 STATUS를 확인한 Show Break 목록을 보존하고 BP 갱신·함수/임시 BP·분리 경로에서 해당 위치의 Set Break/Nobreak 전송을 생략한다.
- FTP 소스와 현재 실행 바이너리의 일치를 검증한 것으로 표시하지 않는다. Main 소스를 열고 명령 콘솔에 세션 주소로 연결해 지정된 프로젝트에 Attach한다. 기존 디버그 세션이 살아 있으면 창 전환으로 종료시키지 않고 먼저 Disconnect하도록 안내한다.

### 검증

- 신규 회귀 **15/15**: 대상 고정·비배포 구성·일회성 재개·신뢰 확인·실패 후 재시도 방지·경로 경계·라이브러리 순환/누락/통신 실패, 실제 DAP의 Start 차단과 기존 BP 보존·새 소스 BP 정리, 실제 소스맵의 동명 사본 제외·라이브러리 매핑을 모의 통신/API로 확인했다.
- 최종 VSIX 빌드와 같은 산출물로 전체 확장 **1241/1241**, controller-mcp **137/137**, `npm run docs:build` strict, `git diff --check` 통과. 첫 샌드박스 전체 실행의 기존 소켓·junction·파일 교체 16건은 일반 Windows 권한 실행에서 해소했다. 초기 새 BP 테스트는 모의 Show Break에 추가 BP를 반영하도록 고친 뒤 통과했다.
- `npm run pre-release-check` **15/17**. 미커밋 변경과 현재 `codex/domain-modules` 브랜치 때문에 clean-tree/main 항목만 실패했으며 커밋·브랜치 전환으로 우회하지 않았다.
- `npm run package:no-bump` 성공: **dist/gpl-language-support-0.16.0.vsix**, **1,390,743 bytes**, SHA-256 **7652DCC60AB3535C325BBC4DFA4176536969D7DBAA0D1A2B55011EBC6461AE83**. 기존 Node DEP0190·JavaScript 다파일 번들링 권고 경고가 있으며 패키징 실패는 없다.
- VSIX의 새 모듈·DAP·Attach 명령·진입점·MCP 번들·package.json 8개를 현재 파일 SHA-256과 대조했다. CHANGELOG는 vsce의 issue 링크 변환 외에 동일하고, 소스·테스트·내부 지침·임시 조사 파일은 제외됐다. 기존 동시 작업의 변경을 유지했다.
- 실제 VSIX 설치·F5 UI·제어기 접속·모션 검증·Git 커밋·태그·push·게시를 수행하지 않았다.

### 남은 일

§3의 새 흐름 UI/제어기 확인을 수행한다. FTP 다운로드의 무결성과 실행 바이너리 출처는 구분하며, 다른 도구가 컴파일한 프로그램의 소스 일치는 미확인으로 유지한다.

## 1-FS. 2026-10-23 세션 — FTP 라이브러리 후보 경로 확인 실패

### 증상·원인

사용자가 제어기 프로젝트 열어 디버깅에서 basic-ftp의 MLSD/Unix/DOS 목록 형식 오류를 보고했다. 내려받은 사본을 읽어 BinderR3 본체는 완성됐고 ProjectLibrary 탐색에서 실패했음을 확인했다. 기존 코드는 로컬 상대 경로 후보를 그대로 원격 LIST에 넣고, 없는 폴더는 FTP 550으로만 거절된다고 가정했다.

연결된 0.16.0 확장의 hello-project 창을 extensionInstanceId로 지정해 MCP extension_command의 gpl.ai.debug.listRemoteProjects로 조회했다. /GPL/BinderR3/Lib/Core/Foundation은 동일한 파싱 오류였고, /GPL/BinderR3 목록에는 하위 App만 있었다. /GPL/Lib/Core/Foundation은 Project.gpr·Foundation.gpl·Errors.gpl·Stopwatch.gpl을 정상 반환했다. FTP 조회만 했으며 Compile·Start·Stop·업로드·디버그 Attach는 실행하지 않았다.

### 조치

- controller/files/controllerProjectDownload.ts에서 부모 목록의 디렉터리 항목을 확인하며 경로를 내려가도록 수정했다. 없는 후보는 LIST를 보내지 않고 다음 기준점을 시도한다. 목록은 이 다운로드 호출 안에서 캐시하고, 실제 원격 항목의 대소문자로 다음 경로와 다운로드 루트를 구성한다.
- 확인된 디렉터리의 파싱 실패·통신 오류는 빈 목록으로 처리하지 않고 후보 경로와 함께 보고한다. 공유 FTP 파서와 기본 전송 동작은 바꾸지 않았다.
- 테스트의 존재하지 않는 경로 응답을 빈 배열에서 현장과 같은 파싱 예외로 바꿨다. 없는 후보를 조회하지 않는지, 부모 조회가 중복되지 않는지, 정상 폴더의 오류가 유지되는지, 소문자 참조를 원격 표기로 찾는지 확인한다.

### 검증

- 관련 회귀 **17/17**, 전체 확장 **1243/1243**, controller-mcp **137/137**, TypeScript 컴파일·`git diff --check` 통과. 첫 전체 실행에서 발견한 controller→language 의존 위반은 폴더명 비교에서 언어 식별자 모듈의 직접 참조를 제거해 해소했다.
- `npm run pre-release-check` **15/17**: 현재 `codex/domain-modules` 브랜치와 미커밋 변경 때문에 main/clean-tree 항목만 실패했다. 기존 변경을 유지하며 Git 커밋·브랜치 전환은 하지 않았다.
- `npm run package:no-bump` 성공. **dist/gpl-language-support-0.16.1.vsix**, **1,391,240 bytes**, SHA-256 **D02DF70F6A02F5B097E24F7478887BE4DE65F45BD492E1245B4402CCC670FA3A**. 기존 Node DEP0190·JavaScript 다파일 번들링 경고가 있고 패키징 실패는 없다.
- VSIX의 변경 다운로드 모듈·주요 Attach 모듈·MCP 번들·package.json 등 8개 파일의 SHA-256이 현재 빌드와 같다. 소스·테스트·내부 지침·임시 파일 제외를 확인했다. 설치·새 코드의 실제 다운로드/Attach·모션·원격 쓰기·Git 커밋·태그·push·게시는 수행하지 않았다.

### 남은 일

새 VSIX 설치 뒤 같은 BinderR3에서 작업공간 전환·Attach까지 확인한다. 현장 FTP 재현은 설치된 0.16.0 경로의 실패/정상 목록 비교이며 새 코드의 전체 흐름 실기 검증은 아니다. 실행 바이너리와 FTP 소스 일치 여부도 미확인으로 유지한다.

## 1-FT. 2026-10-23 세션 — README 문체와 개인 프로젝트 소개 개선

### 증상·원인

사용자는 README가 다른 이용자에게 배포하는 설명글임을 밝히고, 자연스러운 한국어와 개인 개발자가 취미로 만드는 프로젝트의 편안함을 요청했다. 후속 요청에서 일반 이모지 대신 kaomoji를 쓰고, 최소 버전·VSIX 설치·VS Code 기본 단축키 설명을 줄이라고 했다.

### 조치·의도

- 소개와 문의 안내에 개인 프로젝트의 편안한 말투와 kaomoji를 넣고, 제목의 일반 이모지는 제거했다. 탐색·배포·디버깅·모니터링 문장을 이용자가 따라 읽기 쉽게 다듬었다.
- 최소 VS Code 버전·VSIX 설치 절차·확장 ID 소개·기본 단축키 표와 단축키 표기를 제거했다. 지원 파일은 `.gpl` 소스와 `.gpr` 프로젝트 파일로 정리했다. Flash 전원 주의와 Snapshot/Live·분리/정지 구분은 유지하며 실행 코드는 수정하지 않았다.
- 후속 피드백에 따라 도입부의 반복 기능 나열과 「연결 없이 코드 편집 가능」·「프로젝트 없이 파일 편집 가능」 문장을 제거했다. VS Code의 기본 파일 편집을 확장 고유 기능처럼 소개하지 않는다.
- 문서 개선 patch 0.16.2로 package·lock·CHANGELOG를 맞췄다. 최근 10세션 유지를 위해 §1-FJ를 10월 아카이브에 원문 그대로 옮겼다.
- Microsoft 공식 문서에서 Marketplace 설명은 게시 패키지의 README를 사용하며, 로컬/GitHub 파일 수정만으로 즉시 동기화되지 않음을 확인했다. VS Code 1.74의 공식 릴리스 노트도 확인했지만 README에는 중복 표기하지 않는다. Brooks [GDS 공식 설명서](https://www.brooksautomation.com/getmedia/b7051664-7d14-4584-8d9b-3474e338e135/GDS.pdf)의 `.gpo` 설명과 기존 소스 주석의 차이는 §3에 후속 항목으로 남겼다.

### 검증

- Markdown 표 5개·로컬 링크/이미지 5개·설정 키 5개, HTML 변환과 굵은 글씨 구문을 확인했다. 요청받은 버전·VSIX 설치·기본 단축키·GPO 표기 제거, 일반 이모지 없음·kaomoji 2개, 그 밖의 명령·설정 보존을 확인했다. 실제 Marketplace 화면 렌더링 검증은 아니다.
- `npm run package:no-bump` 성공. TypeScript 컴파일과 MCP 번들링을 포함하며, 문서 변경이므로 전체 회귀 테스트는 반복하지 않았다. 기존 Node DEP0190과 JavaScript 번들링 권고 경고가 있었고 최종 패키징 실패는 없다.
- 최종 VSIX는 `dist/gpl-language-support-0.16.2.vsix`, **1,391,125 bytes**, SHA-256 **1872921939BC34A3480A28FC0369E4D77F6C43F75637009947CD4BEAE6E8B0F2**. README·CHANGELOG는 vsce의 상대 URL 변환·이슈 자동 링크 외에는 현재 원본과 같고, manifest도 현재 package.json과 같다. 소스·테스트·내부 지침·임시 파일 미포함을 확인했다.
- 수정 파일의 UTF-8 without BOM·CRLF, 최근 세션 10개와 §1-FJ 아카이브 원문 보존을 확인했다. 중간 검증에서 vsce의 이슈 자동 링크 변환을 차이로 잡던 비교 조건을 보완했으며, 마지막 README 수정 뒤 같은 버전을 재패키징하고 원본과의 일치를 확인했다.

### 남은 일

실제 Marketplace 화면 표시·게시 반영은 별도 확인 대상이다. `.gpo` 주석 정정은 §3에 남겼다. 설치·게시·Git 커밋과 제어기 조작은 수행하지 않았다.

## 1-FU. 2026-10-23 세션 — 원격 수정과 로컬 작업 병합

### 증상·원인

로컬 codex/domain-modules는 원격보다 2커밋 뒤였고, 0.16.2까지의 변경 28개가 미커밋 상태였다. 양쪽의 버전·변경 이력·인계 문서가 겹쳤으며 원격의 OS별 경로 fixture 변경과 로컬 신규 Hover 테스트의 Windows 고정 경로가 충돌했다.

### 조치

- 변경 파일 28개를 SHA-256 manifest와 함께 임시 폴더에 복사하고, 미추적 파일을 포함한 stash `84a93eee1689a4fed1d62322264959309228f4f0` (`pre-merge-local-2026-10-23`)로 보관했다. stash는 복구용으로 유지한다.
- 원격 `c0541c8`·`e00e0fb`를 fast-forward한 뒤 로컬 변경을 재적용했다. Flash 안전·진입점 진단·Rename 수정과 Hover 성능·제어기 프로젝트 디버깅·README 변경을 함께 유지한다.
- 충돌 파일 5개의 양쪽 이력을 통합하고 package/package-lock을 0.16.3으로 맞췄다. 신규 테스트 2건의 fixture는 path.resolve와 OS별 별칭으로 정리했다.
- 중복된 §1-FR은 번호·원문을 보존하고 제목·링크로 구분한다. 최근 본문 10건을 유지하도록 §1-FK·§1-FL을 아카이브로 옮겼다.

### 검증·남은 일

Windows 로컬 npm test(compile 포함) **1249/1249**와 git diff --check가 통과했다. 원래 로컬 변경 28개 중 20개는 내용이 그대로이며, 8개는 버전·문서·테스트 통합에 필요한 변경만 반영했다. 양쪽 인계 문서·아카이브의 모든 세션 원문 보존을 대조했다. VSIX 0.16.3 생성에 성공했고, manifest·운영 코드·리소스 179개가 현재 파일과 바이트 단위로 일치했다. README·CHANGELOG는 패키징 도구의 상대 링크·issue 링크 변환만 다르며 내용 보존을 확인했다. 개발 지침·테스트·임시 파일은 포함되지 않았다. 설치·F5 UI·실제 제어기 검증은 별도로 남아 있다. 병합 직후에는 로컬 변경을 미커밋 상태로 보존했으며, 이후 사용자가 커밋·push까지 진행하도록 승인했다.

- 패키징: `dist/gpl-language-support-0.16.3.vsix`, **1,391,689 bytes**, SHA-256 **846F2966834DCE4F514997276CF72F202B02FF76CDDBB058E30AF93B39F36A03**. JavaScript 번들링 권고 경고 1건, 패키징 실패 없음. 검증 로그는 `dist/merge-0.16.3-tests.log`·`dist/merge-0.16.3-package.log`.
- Git 병합 직후: HEAD와 origin/codex/domain-modules는 `e00e0fb`로 같고 ahead/behind 0/0, 미해결 충돌·staged 변경이 없었다. 후속 승인에 따라 검증된 28개 파일을 같은 작업 브랜치에 커밋·push한다. 최신 fetch에서 원격 추가 변경이 없고 테스트 이후 소스·package 변경이 없음을 재확인했다. 이번 검사에서는 Linux CI·MCP 테스트를 새로 실행하지 않았다.
