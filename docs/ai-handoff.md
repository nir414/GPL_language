# AI 인계 자료 — GPL Language Support 확장 작업 핸드오프

- **최종 갱신: 2026-09-10** · 현재 package 버전 **0.9.1** (태그 `v0.9.0` — CI `release.yml`이 빌드·패키징·릴리즈)
- **직전 세션: §1-DD** — **제어기 조작 절차를 API 한 겹으로 묶기(1): 쓰레드 정지 정본 신설.**
  제어기의 원시 명령은 안전한 단위가 아니다(`Stop -all` 은 *요청 접수*까지만 보장) — 그 절차를 호출부마다
  다시 조립하던 것을 `controller/threadStop.ts`(vscode 무의존·주입형 IO) 하나로 모으고 5곳을 통합했다.
  디버그 세션 두 곳은 정지 확인이 아예 없었다(§0.6 위반). 개별 정지 쌍둥이 코드·정지/일시정지 상태 집합
  중복도 정리하고, 무검증 성공 보고 2건(`ftpUnload`·`threadStart`)을 고쳤다. `npm test` 837/837.
  같은 성격의 중복 8건을 전수 조사해 다음 단위(`controller/projectCommands.ts`)까지 §1-DD 표에 적어 뒀다.
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
7. **PA 제어기의 `Start`는 자체적으로 Compile을 수행한다(사용자 실사용 사실, 2026-08-25 명시).** Brooks 문서는 "Compile 명령으로 사전 컴파일되어 있어야 하며 `-compile` 스위치가 별도"라고 하지만 실제 동작이 다르다(문서 회의주의 사례 — 문서는 가설, 실기기가 사실). 함의: **Compile 직후 Start를 연속으로 보내지 않는다 — 한 번에 하나만.** (2026-08-28 §1-BN: 명령 정책 R3이 같은 프로젝트의 Compile 응답 완료 뒤 `gpl.controller.startAfterCompileGapMs`(기본 1.5 s) 완충을 두고 Start를 보낸다 — 안전성 미검증이라 거부가 아닌 완충.) 컴파일이 두 번 겹치는 연속 실행은 위험 의심이며 안전성은 추후 실기기 테스트. Deploy는 Compile까지, 실행은 `GPL: Start`가 별도. "컴파일 검증 필요" 상태의 뜻은 "옛 바이너리가 실행된다"가 아니라 "에러 미검증 — Start 시 자체 컴파일이 실패할 수 있고 Problems 연동이 없다". 기존 연속 경로(F5 `deployBeforeAttach` → `Start -break -bex`, FTP 뷰 '컴파일 & 실행')는 현황 유지·검토 대상(§1-BD 남은 일).

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

열린 항목만 둔다. 완료된 항목은 `docs/archive/handoff/2026-08.md` §부록으로 옮겼다(2026-08-31 정리).

- [ ] **(2026-09-10, §1-DC) 「업로드 스타트」 원인 규명 — `gpl.uploadStart.test`(비커 버튼)로 조합을 하나씩 실험.**
  저속/시뮬레이션에서만(하드 규칙 6). **D(현재 기본) → B → C → A** 순으로 돌리고 각 회차의 Deploy 트레이스를
  보관한다(머리의 `⚗ TEST X` 줄로 구분된다). 판정: **B에서만 정상 = 원인은 ㉠**(Stop 처리 중 FTP 덮어쓰기),
  **C에서만 정상 = 원인은 ㉡**(정지 직후의 Start), 둘 다 정상 = 각각으로 충분, A에서 재현되면 가설 자체가 맞다.
  결과가 나오면 이 항목과 §1-DC를 사실로 갱신하고, 불필요해진 조합·TEST 명령은 정리한다.
- [ ] **(2026-09-10, §1-DD) 제어기 API 통합 (2) — `controller/projectCommands.ts`(compile/load/unload/start).**
  §1-DD 표의 중복 1·2·3 을 한 번에 없앤다. `threadStop.ts` 와 같은 꼴(주입형 IO + 구조화 결과)로 만들고,
  진단(Problems) 연동·모달 확인 같은 UI 는 호출부에 남긴다. **배포 파이프라인의 심장부라 테스트를 먼저 깔고
  들어갈 것.** 부수 효과로 `ftpCommands` 의 `Start` 가 `-event` 없이 손으로 조립되던 것(경로마다 1403 이벤트 모드가
  달라지던 원인)과 `resolveFtpRunPath`/`chooseRemoteProjectPath` 의 가중치 차이(같은 프로젝트에 다른 원격 폴더를
  고를 수 있다)도 정리된다. 나머지 4~7(Show Thread 열거·중단점 폴백·busy 재시도·스택 조회)은 그다음.
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
- [ ] **(2026-08-31 §1-CD, 2026-09-10 §1-DC 갱신) 「업로드 스타트」 실기기 검증 — Start를 보내므로 저속/시뮬레이션 필수(하드 규칙 6)**:
  **최우선은 ⓪** — §1-DC의 순차 변경으로 "제어기가 응답을 잃는" 현상이 사라졌는지다. 재현되면 남는 용의자는
  정지 직후의 `Start`(제어기 자체 컴파일)이고, Deploy 트레이스가 어느 배너에서 끊겼는지가 판별 근거다.
  ⓪ 실행 → Output `GPL Deploy (Debug)`에 `[1/3] STOP → UPLOAD (순차)`가 찍히고, **`Stop -all`·정지 확인이 끝난
  뒤에야 `↑` 업로드 줄이 시작되는지**(병행이던 종전과의 차이). 정지가 안 되는 상황을 일부러 만들면
  "정지가 확인되지 않아 업로드를 시작하지 않았습니다"로 끝나고 **제어기 파일이 그대로인지**.
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
src/controller/agentBridge.ts            # Agent Bridge 서버(vscode 무의존, 실행자 주입) — presence 파일·요청/응답 파일 IPC·gpl.* 범위 한정·순차 실행 (§1-BQ)
controller-mcp/src/extensionBridge.js    # Agent Bridge 클라이언트 — presence 판정/깨우기(code --open-url)/요청·응답 왕복/재전송 안전 판정 (§1-BQ)
src/controller/uriDispatch.ts            # 외부 진입점 URI 해석(vscode 무의존) — /<gpl.command.id>?args=JSON | ?key=value | /command?id=…, 별칭 4개, gpl.* 범위 한정 (§1-BN)
src/controller/connectionHealth.ts       # 연결 건강 판정(vscode 무의존) — ConnectionHealthMonitor(connected→suspect→lost, 프로브 임계 3/거부 2·힌트는 suspect만)·ConnectionHealthProber(1 s 재프로브)·classifyCommandFailure·probeOutcomeFromResponse (§1-BK)
src/controller/consoleSocket.ts          # 1402 소켓 계층(vscode 무의존) — keep-alive 소켓 1개, terminator-first 재사용 판정, stale 1회 재시도, 트래픽 링버퍼 600줄 (§1-BI, #22), reject code 부착·보관 소켓 관찰자(§1-BK)
src/debug/sourceTargets.ts               # BP 유효 줄·프로시저 범위(End Sub 기준)·호출 후보 파싱(vscode 무의존) — BP 줄 보정(문서 규칙)·Jump to Cursor 검증·Step Into Target 후보 (§1-BU)
src/controller/threadActivity.ts          # "동작 중" 판정(vscode 무의존) — 쓰레드 존재 = 활성, project 컬럼·기본 이름·`_Cmd_<project>`(Execute 쓰레드) 인정 (§1-BU). 상태 판정 단일 출처: isSettledState(Idle/Stopped/Error) · isPausedState/PAUSED_THREAD_STATES(Paused/Break/Error, §1-DD)
src/controller/threadStop.ts              # **쓰레드 정지의 정본**(vscode 무의존·주입형 IO) — probeThreads(잘린 응답=확인 불가) / waitThreadsSettle·waitThreadSettle / sendStop / stopAllAndSettle·stopThreadAndSettle(전송→STATUS 판정→폴링→자동 재시도, unconfirmed 노출). 배포·패널·FTP·디버그가 모두 이것을 쓴다 (§1-DD)
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
src/controller/deployService.ts          # deploy() = 잠금 획득 → UPLOAD ∥ STOP/THREAD_CHECK(settle 게이트, stopBeforeUpload 면 STOP→UPLOAD 순차 §1-DC) → COMPILE → START(직전 정지 재확인 §1-DC) → ERROR CHECK(§1-BD 재배치), tryCompile, directGpl(§1-G), COMPILE_DEFERRED, findProjectDirs(**/*.gpr)
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
src/activation/connection.ts             # 연결 건강 모니터 배선·유실 처리·사후 스냅샷·connect/disconnect(대화형+비대화형)·launch.json·startQuickAttachSession(attachNow=배포 후 붙기 / attachOnly=배포 없이 붙기, §1-DC)·debugProject (§1-CZ)
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

본문에는 **최근 10개 세션**(§1-CR ~ §1-DA)만 둔다.
그 이전은 월별 아카이브에 원문 그대로 있다 — 아래 인덱스의 링크를 따라간다.

| 아카이브 | 범위 | 세션 수 |
| --- | --- | --- |
| [2026-06](archive/handoff/2026-06.md) | §1-A ~ §1-B (2026-06-30) | 2 |
| [2026-07](archive/handoff/2026-07.md) | §1-C ~ §1-AL (2026-07-03 ~ 2026-07-31) | 35 |
| [2026-08](archive/handoff/2026-08.md) | §1-AM ~ §1-CM (2026-08-05 ~ 2026-08-31) | 53 |
| [2026-09](archive/handoff/2026-09.md) | §1-CN ~ §1-CQ (2026-09-02) | 4 |
| (본문 아래) | §1-CR ~ §1-DA (2026-09-02 ~ 2026-09-07) | 10 |

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
| §1-CU | 09-02 | 최근 세션들의 미완 코드 항목 마무리 — "컴파일 검증 필요" 배지 해제를 배포 경로와 분리(`compileStale.ts` + `onDidRecordCompiled`) · `clean.js` 비ASCII 경로 크래시 · folding 의 `Set` 대입문 오인 | 본문 ↓ |
| §1-CV | 09-02 | 이름 바꾸기(F2) 오작동 — 선언 심볼 range 를 이름 span 으로(줄 전체 금지) · 콤마 다중 선언 파서(`declarationList.ts`) · 스코프 가시성 정본(`symbolScope.ts`, F12/F2 공유) · 편집 전 텍스트 검증 | 본문 ↓ |
| §1-CW | 09-02 | 참조 찾기(Shift+F12)가 생성자 `New Class(...)`와 `"Class.Proc"` callback 문자열을 놓치던 문제 — 특수 참조 문법 정본(`referenceSyntax.ts`) | 본문 ↓ |
| §1-CX | 09-03 | 밀린 세션 20개분(§1-CD~§1-CW) 작업 트리 일괄 커밋 + `.gitignore` 정리 — 리팩토링 준비 | 본문 ↓ |
| §1-CY | 09-07 | 네트워크 DataID 조사 + 실기 실측 대조 — 진단에 쓸 항목 골라내기(`reference/network-dataids.md`) | 본문 ↓ |
| §1-CZ | 09-07 | `extension.ts` activate() 5,300줄을 명령 그룹별 모듈(`src/activation/`)로 분해 — `ExtensionHost` + 순수 로직 4건 분리·테스트 15건 (§3-B 보류 항목 종결) | 본문 ↓ |
| §1-DA | 09-07 | flash 영구 저장(`gpl.saveToFlash`)을 AI/자동화 경로에서 차단 — 차단 목록 정본 `aiCommandPolicy.ts` + 브리지·URI·명령 3중 게이트, MCP 미러 | 본문 ↓ |
| §1-DB | 09-07 | 구조 기반 정비 — tsconfig 엄격 플래그·죽은 코드 제거·계층 경계(`util/pathKey`·`project/gprSync`·언어 모듈 `language/` 이동)·순수 분리(`deployOutcome`·`treeFormat`)·**계층 규칙 테스트 고정**(`architecture.test.ts`)·`docs/development/architecture.md` 신설 | 본문 ↓ |
| §1-DC | 09-10 | 「업로드 스타트」가 제어기를 멈추게 하던 시퀀스 정정 — 정지 확인 → 업로드 순차(`stopBeforeUpload`) + Start 직전 정지 재확인, 배포 없이 붙는 `gpl.debug.attachOnly` 신설·명령 제목 한국어화 + 원인 규명용 TEST 경로(`gpl.uploadStart.test`) + 빌드 완료 후 GPL Console 포커스 탈취 제거 | 본문 ↓ |
| §1-DD | 09-10 | 제어기 조작 절차를 API 한 겹으로 묶기(1) — 전체/개별 쓰레드 정지 정본 `controller/threadStop.ts`(주입형 IO·테스트 17건) + 5곳 통합 + 정지/일시정지 상태 판정 단일화 + 무검증 성공 보고 2건 수정 + 중복 절차 전수 조사 | 본문 ↓ |

---

**최근 세션 본문 — §1-CS ~ §1-DB (2026-09-02 ~ 2026-09-07).** 이 아래부터는 세션 원문이다.

## 1-CU. 2026-09-02 세션 — 최근 세션들이 남긴 미완 코드 항목 마무리 (배지 해제 경로 분리 · 비ASCII 경로 삭제 · `Set` 오인)

### 요청

"최근 채팅 세션들 검토 후 작업 안 된 것들 마무리해 줘." — §2·§3과 §1-CK~§1-CT의 «남은 일»을 훑어
**실기기·사용자 확인이 필요한 항목을 빼고 코드로 끝낼 수 있는 것**만 골라 처리했다.

훑은 결과의 분류:

| 분류 | 항목 | 이번 처리 |
| --- | --- | --- |
| 코드로 끝남 | §1-CT 원인 ①(F5 배포가 배지를 안 지움) · §1-CN(`clean.js` 비ASCII 크래시) · §1-CQ 관찰(`Set` 대입문이 folding 스택에 쌓임) | **처리(아래)** |
| 이미 되어 있었다 | §1-CR 별건 2건 — 호버 스코프 자기 되풀이 · `getModuleMembers` 가 클래스를 빼먹음 | §1-CR 의 «후속 조치» 에서 이미 처리됨(`receiverType.enclosingClassName` 등) — 코드로 확인만 |
| 사용자 확인 대기 | §3의 실기기·편집기 확인 항목 대부분 | 그대로 |
| 사용자 결정 대기 | §2(`isOrgCompleted` 대입 방식 · P1/P2 범위 · `uploadStart` 대화형 모달) | 그대로 |
| 범위가 큼/모션 접촉 | §1-AQ(Stop/settle/busy-retry 통일) · §1-AH ④(connect backoff·1403 스트림 도구) · §3-B(`Replace` 실측, `extension.ts` 분리) | 그대로 |

### 조치 ① — "컴파일 검증 필요" 배지가 F5 배포에서 안 풀리던 문제 (§1-CT 원인 ①)

**원인.** 배지 상태(`compileStaleProjects`)를 켜고 끄는 코드가 전부 `activate()` 안의 `runDeploy`
래퍼에만 있었다. F5 의 `deployBeforeAttach` 는 `deployService.deploy()` 를 직접 부르므로 Compile 이
성공해도 그 래퍼를 지나지 않아 배지가 남는다(MCP 경유 배포도 같다).

**방법.** 두 갈래로 나눴다.

1. **상태를 순수 모듈로** — `controller/compileStale.ts` 신설(`CompileStaleTracker`). `Map` + 키 정규화
   (공백·대소문자 무시) + `mark`/`clear`/`current`/`list` 만 담고 **vscode 무의존**이다. `mark` 는
   재호출 시 `since`·`projectDir` 을 보존하고(“얼마나 오래 미검증인가”가 리셋되면 배지가 거짓말을 한다),
   `clear` 는 지운 항목과 **배지에 대신 표시할 다음 항목**을 함께 돌려준다. 로깅과 UI 반영
   (`controllerTree`/`statusBar`)은 `extension.ts` 에 그대로 남겼다 — 모듈은 "무엇이 바뀌었는지"만 말한다.
2. **해제를 배포 경로에서 떼어냄** — `activate()` 에서 `onDidRecordCompiled` 를 구독해 거기서
   `clearCompileStale(rec.projectName)` 을 부른다. `recordCompiled` 는 **Compile 성공 확정 지점**과
   **업로드 스타트의 Start 성공 지점**(제어기가 자체 컴파일했음이 STATUS 0 으로 확정된 자리, §0.7)에서만
   발화하므로 해제 조건과 정확히 일치한다.

**직접 호출을 남긴 곳.** `runDeploy` 성공 지점과 `gpl.controller.ftpRun`(Load→Compile→Start)의 해제는
지우지 않았다.

- `ftpRun` 은 **deployService 를 거치지 않고** 1402 명령을 직접 보내므로 `recordCompiled` 가 발화하지 않는다
  → 직접 호출이 없으면 그 경로에서 배지가 남는다.
- `runDeploy` 쪽은 구독과 겹치지만, `deployService` 의 스냅샷 기록은 `try/catch` 로 감싼 **best-effort** 라
  `snapshotProjectFiles` 가 던지면 `recordCompiled` 까지 가지 못한다. 그때도 배지는 풀려야 한다.
- 겹쳐도 로그가 두 줄이 되지 않는다 — `clear` 는 **없던 항목이면 `undefined`** 를 돌려주고 호출부가
  거기서 조용히 끝낸다(테스트로 고정).

### 조치 ② — `scripts/clean.js` 가 한글 경로 클론에서 죽던 문제 (§1-CN 부수 발견)

Node v24.11.1(Windows)에서 `fs.rmSync()` 의 **경로 인자에 비ASCII 문자가 있으면** 예외도 `exit` 이벤트도
없이 프로세스가 `0xC0000409` 로 죽는다. 이번에 같은 장비에서 다시 실측해 범위를 확정했다.

```text
node -v → v24.11.1
unlinkSync   비ASCII 파일        → OK
rmdirSync    비ASCII 빈 디렉터리 → OK
readdirSync  비ASCII 디렉터리    → OK
lstatSync    비ASCII             → OK
realpathSync.native 비ASCII      → OK
rmSync       비ASCII 파일        → 프로세스 사망 (exit 코드 없음)
rmSync       ASCII 경로          → OK (하위에 한글 폴더가 있어도 안전 — 인자 자체가 ASCII면 된다)
```

즉 **깨진 것은 `fs.rmSync` 하나**다. 그래서 `removeRecursive(abs)` 를 두고, 인자가 ASCII 면 종전
`fs.rmSync(abs, {recursive:true, force:true})` 를 그대로 쓰고(빠른 native 경로 — `node_modules` 삭제가
느려지지 않는다) **비ASCII 경로일 때만** `readdirSync` → `unlinkSync`/`rmdirSync` 로 직접 내려간다.
`ENOENT` 는 `force:true` 와 같게 관용하고, 디렉터리 심링크는 대상까지 따라가지 않는다.

분기의 근거는 위 실측이다(추측으로 만든 분기가 아니다) — 주석에 함께 적어 뒀다.

### 조치 ③ — folding 의 `Set` 시작 패턴이 대입문까지 물던 문제 (§1-CQ 관찰)

`foldingRangeProvider.ts` 의 시작 패턴이 `/^\s*Set\b/i` 여서 GPL 의 **`Set obj = other` 대입문**마다
스택에 항목이 쌓였다. §1-CQ 에서는 "범위에는 영향 없음"으로 적었지만, 코드를 읽어 보니 영향이 있다 —
종결어 처리가 스택을 **위에서부터** 훑어 같은 kind 의 최상단을 닫으므로:

```gpl
Public Property Size As Integer
    Set (value As Integer)      ' ← 진짜 접근자 (stack: … property, set)
        Set m_obj = value       ' ← 대입문이 set 을 또 push  (stack: … property, set, set)
    End Set                     ' ← 최상단(대입문 항목)을 닫는다 → 대입문 줄부터 접힘
End Property                    ' ← 진짜 set 항목은 끝까지 안 닫힌 채 남는다
```

**방법.** 판정 정본인 `language/blockContext.ts` 와 표기를 맞췄다 — GPL 의 `Set` 절은
`Set (value As Integer)` 처럼 **괄호가 필수**이므로(`gplStatements.ts`) 시작 패턴을 `/^\s*Set\s*\(/i` 로,
같은 이유로 `Get` 도 `/^\s*Get\s*(?:'.*)?$/i`(접근자 단독 줄)로 좁혔다. folding provider 는
`vscode.TextDocument` 에 매여 순수 테스트가 안 되므로, **규칙 자체는 테스트 가능한 정본
(`blockContext`) 쪽에 케이스로 고정**하고 provider 는 그 표기를 따라가게 했다.

### 조치 ④ — README 에 빠져 있던 사용자 기능 2건 (전체 재검토에서 발견)

`README.md` 를 기능·명령 표와 실제 구현으로 대조했더니 **구현·CHANGELOG 에는 있는데 README 에만 없는**
것이 두 개 있었다.

- **Rename(F2)** — `renameCore.ts`/`renameProvider.ts` 로 들어온 기능(§1-AY)이 언어 기능 표에 아예 없었다.
  경쟁 확장 대비 차별 기능인데 문서에서 빠져 있던 셈이다. 로컬은 프로시저 범위·모듈/클래스 심볼은
  프로젝트와 참조 라이브러리 범위, 스레드 문자열 참조·함수 반환값 대입 포함, **F12 로 정의에 갈 수 없는
  식별자는 거부**한다는 안전선까지 한 줄로 적었다.
- **`GPL: 브레이크포인트용 소스 승격`** — 0.8.26 의 새 기능(§1-CT)이 명령 표에 없었다. 디버깅·모니터링
  표에 행을 넣고, "중단점이 회색으로 안 걸릴 때" 안내 블록으로 `-508` 의 원인(제어기는 `.gpr` 에 직접
  적은 `ProjectSource` 안에서만 대상 파일을 찾는다)과 해법을 함께 적었다.

`gpl.project.syncSources`·문 스니펫·문서화 주석 확장은 이미 README 에 있었다. `pre-release-check` 의
README 정책(버전·이력 하드코딩 금지) 통과.

### 조치 ⑤ — 동명 프로젝트 QuickPick 이 구분되지 않던 문제 (§1-CN 남은 일)

이 사용자의 실작업 구조는 과제 폴더마다 같은 이름의 프로젝트를 복제해 둔다
(`…/37. 핵산 Oligo 합성과제/시뮬레이션/projects/GPL_Code`). 그래서 QuickPick 라벨이
`$(folder) GPL_Code` 로 **똑같이** 보였다(`detail` 의 전체 경로로만 구분 가능).

`projectPickerCore.disambiguateDirLabels(dirs)` 를 신설했다 — 폴더명이 겹치는 그룹에만,
**그 그룹 안에서 서로 달라지는 데 필요한 최소 상위 폴더**를 계산해 `description` 맨 앞에 붙인다.
위 구조에서는 `projects` 도 `시뮬레이션` 도 같아 과제 폴더까지 올라가야 하므로
`37. 핵산 Oligo 합성과제\시뮬레이션\projects` 가 된다. 폴더명이 유일한 후보에는 아무것도 붙이지 않는다.
한 그룹에는 같은 깊이를 쓴다 — 깊이가 다르면 목록에서 눈으로 비교되지 않는다.

힌트는 `orderProjectDirs`(중복 제거·정렬) **뒤의 목록**에서 계산한다. 같은 폴더가 다른 표기로 두 번
들어오면 그 둘은 어떤 깊이에서도 구분되지 않아 힌트가 아예 안 붙기 때문이다.

### 재검토 — 정합성 일괄 점검 (이상 없음, 다음 작업자는 다시 안 봐도 된다)

전체 재검토 요청에 따라 "썩기 쉬운 곳"을 기계적으로 대조했다. 아래는 **모두 정상**이었다.

| 점검 | 방법 | 결과 |
| --- | --- | --- |
| 신규 모듈 11개가 실제로 쓰이는지 | import 참조 카운트 | 전부 연결됨(고아 없음) |
| 명령 등록 ↔ `contributes.commands` | 양방향 대조 | 불일치 없음. 미선언 6개는 **의도된 것**(트리 항목 전용 4개 · 자동화 전용 `gpl.automation.target` · 별칭 `gpl.stopAll`) |
| 설정 키 ↔ `contributes.configuration` | 코드가 읽는 키 대조 | 고아 없음. `gpl.trace.liveTerminal.autoStart` 는 분할 스코프(`getConfiguration('gpl.trace').get('liveTerminal.autoStart')`)로 읽고 있어 단순 grep 에는 안 잡힌다 |
| `controller-mcp` 테스트 | `node --test` | **79/79 통과**, CI(`ci.yml`)도 실행 중 |
| 문서가 가리키는 소스 경로 | `ai-handoff`·`CLAUDE`·런북의 `src/**`·`scripts/**` 경로 존재 확인 | 전부 존재 |
| README·docs 의 상대 링크 | `.md` 링크 대상 존재 확인 | 깨진 링크 없음 |
| 새 코드의 TODO/FIXME | grep | 없음 |

**손대지 않기로 한 것**: `symbolCache.indexWorkspace()` 의 **전역** 상한(§1-CN 남은 일). 프로젝트별 상한은
이미 있고(`collectProjectSourcePaths` 의 `truncated`), 전역 상한을 두면 대형 트리에서 **조용히** 정의·참조가
빠진다 — "느리지만 완전"에서 "빠르지만 불완전"으로 트레이드오프를 바꾸는 결정이라 실측 없이 정할 일이 아니다.
사용자 판단 대기로 §2 에 남긴다.

### 검증

- `npm run compile` — 통과.
- `npm test` — **758/758 통과**(이 세션 신규 13건: `compileStale` 6건, `blockContext` 2건, `projectPicker` 5건).
  (총계가 731 → 758 로 뛴 것은 이 세션 작업만이 아니다 — **§1-CV 세션이 같은 저장소에서 병렬로
  진행되며** 그쪽 테스트가 합류했다. 두 세션의 편집은 서로 다른 파일이라 충돌하지 않았고
  `src/test/index.ts` 는 양쪽 등록이 모두 남았다. 병렬 세션이 있을 때 헤더의 "직전 세션" 은
  **나중에 끝난 쪽**(§1-CV)이 갖는다 — 내 요약을 덮어쓰지 않고 이 본문에만 적었다.)
- `clean.js` 는 스크래치에 가짜 저장소를 만들어 두 경우로 실행했다.
  - `…/시뮬레이션/GPL_language`(비ASCII 경로) → `out`·`dist`·루트 `.vsix` 삭제, **종료 코드 0**,
    무관한 `한글폴더/` 는 그대로. 종전에는 이 지점에서 프로세스가 죽었다.
  - `…/ascii-repo`(ASCII 경로, 하위에 `out/한글하위/` 포함) → `out`·`.history` 삭제, 종료 코드 0
    (native 경로 회귀 없음).

### 남은 일

- §3 에 확인 항목 2건 추가: ① 배지 해제(F5·MCP·`ftpRun`·로그 중복 없음) ② `Set` 접근자 접기.
- folding provider 자체의 순수 모듈 분리(`string[]` → 범위 목록 + vscode 어댑터)는 하지 않았다.
  이번 수정은 표기 한 줄이라 정본 쪽 테스트로 충분하고, 분리는 접기 동작 전반의 회귀 위험이 실익보다 크다.
  folding 에 또 손댈 일이 생기면 그때 같이 한다.
- `extension.ts` 는 `compileStale.ts` 분리로 조금 줄었다(§3-B 의 "분리 보류" 판단은 그대로 — 이번은
  행동 수정에 딸린 최소 분리다).

### 변경 파일

```txt
src/controller/compileStale.ts        # 신규 — CompileStaleTracker(vscode 무의존), extension.ts 클로저에서 분리
src/extension.ts                      # 배지 상태를 tracker 로 교체 + onDidRecordCompiled 구독으로 경로 무관 해제
src/providers/foldingRangeProvider.ts # Set/Get 시작 패턴을 접근자 표기로 좁힘(blockContext 와 일치)
scripts/clean.js                      # removeRecursive — 비ASCII 경로는 unlinkSync/rmdirSync 폴백
src/test/compileStale.test.ts         # 신규 — 6건
src/test/blockContext.test.ts         # Set 대입문 2건 추가(대입문은 블록을 열지 않는다 / End Set 가로채기 없음)
src/controller/projectPickerCore.ts   # disambiguateDirLabels — 동명 폴더에만 최소 상위 폴더 표기
src/controller/projectPicker.ts       # QuickPick description 맨 앞에 위치 표기(정렬·중복 제거 뒤 목록에서 계산)
src/test/projectPicker.test.ts        # 5건 추가(실사용 과제 폴더 구조 픽스처)
src/test/index.ts                     # 스위트 등록
README.md                             # 언어 기능 표에 Rename(F2), 명령 표에 소스 승격 + "회색 BP" 안내
docs/ai-handoff.md, CHANGELOG.md      # 기록(§1-CK 를 2026-08 아카이브로 이동 — 본문 최근 10세션 유지)
```

## 1-CV. 2026-09-02 세션 — 이름 바꾸기(F2)가 선언 줄을 깨뜨리고 사용처를 남기던 문제 (심볼 이름 range · 콤마 다중 선언 · 스코프 판정)

### 증상 (사용자 신고)

"기호 이름 바꾸기 / 변수명 일괄 변경 기능이 제대로 작동 안 함." 확인 질문에 고른 증상은
**① 엉뚱한 곳까지 바뀜 + ② 일부만 바뀌고 남음(둘 다)**, 대상은 **Sub/Function 안 로컬 변수**.

### 원인 (코드 대조 + 파서 프로브로 확인 — 셋. 서로 겹쳐 같은 증상을 만든다)

1. **선언 심볼의 `range` 가 "이름 위치"가 아니라 "줄 전체(`start: 0`)"였다.** 모듈/클래스 레벨
   변수·상수, `Property`, `Type` 정의 5곳이 `range: { start: 0, end: line.length }` 로 심볼을 만들었다
   (Module/Class/Sub/Function/로컬/파라미터는 `findNameColumn` 으로 정상적인 이름 컬럼이었다).
   `renameProvider` 는 이 값을 이름 컬럼으로 믿으므로 한 번에 두 가지가 깨졌다:
   - **선언 줄 맨 앞 글자들을 새 이름으로 덮어썼다** — `    Public count As Integer` 에서 `count` →
     `counter` 를 하면 컬럼 0..5 를 치환해 `counterublic count As Integer` 가 된다.
   - **참조 수집을 컬럼 0(들여쓰기 공백)에서 시작**해 `getQualifiedWordAtPosition` 이 식별자를 못 찾고,
     `provideReferences` 가 **0건**을 돌려줬다 → 선언 줄만 깨지고 사용처 전부가 옛 이름으로 남았다.
   `documentSymbolProvider`(개요)와 `referenceProvider`(정의 라인 판정)는 이미 이 값을 방어적으로
   clamp 하고 있었다 — 즉 "줄 전체 range" 는 알려진 기벽이었지만 Rename 만 그대로 믿고 썼다.
2. **콤마 다중 선언을 파서가 통째로 놓쳤다.** 선언 정규식이 이름을 하나만(`(\w+)\s+As`) 잡고 바로
   `\s+As` 를 요구해 `Dim i, j As Integer` / `Dim a As Integer, b As String` / `Public gA, gB As Integer`
   는 **매치 자체가 실패**했다. 공식 `Dim` 구문은
   `[Public|Private|Shared] Dim variable_name [, variable_name …] As [New] type [= init] [, …]` 이고
   문서 예시도 `Dim ii, jj As Integer, x As Double` 다(문서상 — 문법 자체가 VB 계열이라 신뢰도 높음).
   그렇게 선언된 변수는 호버·정의 이동·자동완성·개요에서 "정의 없음"이 되고, Rename 은 로컬 인식에
   실패해 **전역 경로**로 흘렀다 — 이름이 같은 모듈 변수가 있으면 그 심볼로 붙어 위 ①을 그대로 탄다.
3. **다른 프로시저의 동명 로컬을 커서 스코프의 선언으로 골랐다.** `definitionProvider.pickBestScopedCandidate`
   와 그 축약판인 `renameProvider.findLocalSymbol` 은 "커서가 속한 프로시저 안에 후보가 있으면 그것,
   **없으면 전체 후보 중 커서 위쪽에서 가장 가까운 것**"을 골랐다. 아래 배치에서 Sub B 의 `count` 는
   모듈 레벨 변수를 가리키는데, 규칙이 Sub A 의 무관한 로컬을 고른다:

   ```gpl
   Public count As Integer      ' ← 실제 대상
   Public Sub A()
       Dim count As Integer     ' ← 무관한 로컬 (커서 위쪽에서 가장 가까움)
   End Sub
   Public Sub B()
       count = count + 1        ' ← 커서
   End Sub
   ```

   골라진 심볼이 `isLocal` 이므로 Rename 은 **커서가 있는 프로시저 안에서만** 치환하고(엉뚱한 범위),
   선언과 다른 파일 사용처는 옛 이름으로 남긴다(누락). F12·호버도 같은 규칙을 쓰므로 함께 틀렸다.

### 조치 (의도와 방법)

- **`src/language/declarationList.ts` 신규 — 선언자 목록 파서 정본(순수 모듈).** 접두(수식어·`Dim`·
  `Static`·`Const`) 뒤 꼬리를 받아 `name [(bounds)] [As [New] type [= init]]` 을 최상위 콤마로 갈라
  해석한다. 타입 없는 이름은 뒤따르는 `As type` 을 공유한다(`ii, jj As Integer` → 둘 다 Integer).
  괄호 깊이와 문자열 리터럴을 존중하므로 `Dim arr(10, 4) As Integer`·`Dim s As String = "a,b"` 가
  콤마에 쪼개지지 않고, `As New Thread("Mod.Proc")` 의 생성자 인자 괄호는 배열 표기로 오인하지 않는다.
  **선언자 형태가 아니면 `undefined`** 를 돌려주므로 `Public Type Foo`·`Public Enum X` 같은 줄은
  호출부가 원래 해석으로 넘어간다(종전 정규식이 `\s+As\s+\w+` 로 얻던 가드를 형태 검사로 대체).
- **`gplParser` 선언 처리 6개 정규식 → 2개 경로로 통합.** 로컬(`Dim`/`Static`) 3종(New형·일반·배열)과
  모듈 멤버 3종을 각각 하나로 합쳤다. 접두만 정규식으로 인식하고 나머지는 위 정본에 위임하므로,
  선언 형식이 늘어도 규칙을 덧붙이지 않는다. 이름 컬럼은 선언자 오프셋에서 계산해 **콤마 목록의
  두 번째·세 번째 이름도 정확한 range** 를 갖는다.
- **`Property`·`Type` 심볼의 `range` 를 이름 위치로 고쳤다.** 키워드 뒤에서 이름을 찾으므로 수식어와
  이름이 같아도(예: `Default` 라는 이름) 어긋나지 않는다. 이제 **모든 선언 심볼의 range 가 이름 span** 이다
  (개요의 selectionRange 도 이름으로 좁혀져 정확해진다).
- **`src/language/symbolScope.ts` 신규 — 스코프 가시성 판정 정본.** `isVisibleFrom`/`pickVisibleDeclaration`.
  규칙은 GPL(VB 계열) 그대로: 프로시저 안 로컬·파라미터는 **그 프로시저 안에서만** 보이고, 모듈/클래스
  레벨은 파일 전체에서 보이며 같은 이름의 로컬에 가려진다(섀도잉 — 로컬 선언이 커서보다 아래여도
  프로시저 전체가 스코프다). `definitionProvider.pickBestScopedCandidate` 와 `renameProvider.findLocalSymbol`
  이 이 한 곳을 쓰므로 **F12 가 가리키는 선언과 F2 가 바꾸는 대상이 어긋날 수 없다.**
- **Rename 에 위치 안전판 2개 (`renameCore`).**
  - `resolveDeclarationNameColumn` — 심볼 인덱스의 컬럼을 그대로 믿지 않고, 그 자리가 실제로 그 이름일
    때만 쓰고 아니면 주석/문자열 밖 첫 `\bword\b` 를 찾는다. 못 찾으면 이름 바꾸기를 **중단**한다
    (낡은 캐시·다른 파서 기벽이 다시 생겨도 선언 줄을 덮어쓰지 않게).
  - `isWordAt` + `replaceIfWordMatches` — **모든 편집을 내보내기 직전** 그 자리가 옛 이름인지 확인한다.
    로컬·전역·문자열 참조 세 경로 전부에 걸었다. 이름 바꾸기는 되돌리기 어려운 다중 파일 편집이라,
    위치 계산이 어디서 틀리더라도 엉뚱한 텍스트를 덮어쓰지 않는 마지막 방어선을 둔다.
- `renameProvider.resolveTarget` 의 위험한 폴백 제거: 로컬 판정에 실패하면 `local.line` 으로 프로시저
  범위를 다시 찾던 경로가 있었다(커서가 모듈 레벨이어도 **남의 프로시저** 범위를 얻어 그 안에서 치환).
  이제 커서의 프로시저 범위를 먼저 정하고 그 스코프에서 보이는 선언만 대상으로 삼는다.

### 검증

- `npm test` — **753/753 통과**(신규 22건 포함: `declarationList` 6 + 파서 통합 5 + `symbolScope` 7 +
  `renameCore` 4). 기존 스위트(`symbolCache`·`symbolLocations`·`gplParserFixes`·`overloadResolution`·
  `docComment` 등) 무회귀.
- 신규 테스트가 고정한 것: 콤마 목록의 모든 이름이 심볼로 잡히는지, **모든 선언 심볼의 range 가 이름을
  가리키는지**(줄 전체 금지), `As New T(...)` 가 배열이 아닌지, 문자열 안 콤마·주석이 선언 경계를
  흐리지 않는지, `Type`/`Property` 가 선언자 목록에 먹히지 않는지, 다른 프로시저 로컬이 보이지 않는지,
  hint 컬럼이 틀렸을 때 실제 이름 위치로 보정되는지.
- 파서 프로브(스크래치)로 수정 전/후 대조: `Dim i, j As Integer` 는 수정 전 **0개** → 후 `i`, `j` 둘 다
  로컬 심볼. 위 Sub A/Sub B 배치에서 Sub B 의 `count` 는 수정 전 "Sub A 의 로컬" → 후 "모듈 레벨 변수"로
  해석되고, 선언 줄 편집 위치가 컬럼 0 → **이름 컬럼 11** 로 바뀐다(참조 수집도 그 위치에서 시작).
- **편집기 실동작(F2) 검증은 하지 않았다** — Extension Development Host 가 필요하다(§3 에 항목 추가).

### 남은 일

- §3 에 F2 실동작 확인 항목 1건 추가(로컬·모듈 변수·Property·콤마 선언·섀도잉 5 경우).
- 이번 스코프 정본은 `definitionProvider`/`renameProvider` 두 곳만 태웠다. `hoverProvider`·
  `completionProvider` 는 각자 다른 방식으로 스코프를 보므로(줄 범위 필터) 손대지 않았다 —
  같은 함정이 있는지는 별도 점검 대상이다.
- `parseDeclaratorList` 의 타입은 점 표기(`As Robot.Location`)에서 **첫 세그먼트만** 쓴다(종전
  `As\s+(\w+)` 와 동일). 한정 타입 이름을 제대로 다루려면 심볼 캐시 쪽 타입 해석까지 함께 봐야 한다.

### 변경 파일

```txt
src/language/declarationList.ts   # 신규 — 선언자 목록 파서(콤마 다중 선언·배열·New·초기값), vscode 무의존
src/language/symbolScope.ts       # 신규 — 스코프 가시성 판정 정본(isVisibleFrom/pickVisibleDeclaration)
src/language/renameCore.ts        # isWordAt / resolveDeclarationNameColumn 추가
src/language/gplParser.ts                # 선언 정규식 6종 → 2경로(declaratorsOfLine) + Property/Type 이름 range
src/providers/renameProvider.ts   # 선언 이름 컬럼 확정(defPos·선언 편집) + 편집 전 텍스트 검증 + 스코프 정본 사용
src/providers/definitionProvider.ts # pickBestScopedCandidate → symbolScope 정본 위임
src/test/declarationList.test.ts  # 신규 — 11건(선언자 파싱 6 + 파서 통합 5)
src/test/symbolScope.test.ts      # 신규 — 7건
src/test/renameCore.test.ts       # 이름 컬럼 확정·isWordAt 4건 추가
src/test/index.ts                 # 스위트 등록
docs/ai-handoff.md, CHANGELOG.md  # 기록(§1-CL 을 2026-08 아카이브로 이동 — 본문 최근 10세션 유지)
```

## 1-CW. 2026-09-02 세션 — 참조 찾기가 생성자와 callback 문자열 사용부를 놓치던 문제

### 증상 (사용자 신고)

`GPL_Code`에서 두 선언에 Shift+F12를 실행해도 실제 사용부가 나오지 않았다.

1. `Lib_Net\Server\Server.gpl:62`의 생성자 선언 `Public Sub New(...)` →
   `Main.gpl:45`의 `New TcpServer(PORT_TEST)`가 누락.
2. 같은 파일 `Server.gpl:455`의 `TcpClientSessionThreadFunc` 선언 →
   `Server.gpl:448`의 `New Thread("TcpServer.TcpClientSessionThreadFunc", ...)`가 누락.

### 원인 (provider 코드 + 제공된 실파일 대조)

1. 파서는 생성자를 이름 `New`, `kind='sub'`, `className='TcpServer'`로 올바르게 기록했다. 그러나
   `referenceProvider`는 모든 class member를 `.Member` 형태로 찾으므로 생성자도 `.New`를 검색했다.
   GPL의 실제 사용 표기는 `New TcpServer(...)`라 패턴 자체가 맞지 않았다.
2. 일반 참조 필터는 문자열 내부 매치를 모두 제외했다. 반면 `definitionProvider`는 GPL `Thread` 관용구 때문에
   문자열 전체가 `Name`/`Class.Proc`인 경우 F12를 이미 지원했다. 같은 문법을 한 기능은 symbol reference로,
   다른 기능은 일반 문자열로 취급한 규칙 불일치였다.
3. 사용부에서 Shift+F12를 실행하면 선언 scope 복원이 늦었다. 특히 권위 있는 `Class.Member`/`Module.Member`
   한정자가 있어도 class member 후보가 섞였다는 이유로 scope 복원을 포기하는 경로가 있었다.

### 조치 (가독성·구조화 기준)

- `src/language/referenceSyntax.ts` 신규 — vscode 비의존 순수 정본으로 두 특수 표기를 모았다.
  - `buildConstructorUsagePattern(className)`: `Sub New`를 `New <정확한 클래스명>` 사용부에 대응시킨다.
  - `isSymbolicStringReferenceAt(...)`: 문자열 **전체**가 `Name` 또는 `Container.Name`이고 target 이름·컨테이너가
    일치할 때만 callback 참조로 인정한다. 일반 메시지의 부분 언급, 다른 클래스, thread label은 제외한다.
- `referenceProvider`의 local scan, VS Code workspace search, `.gpr` project-scope fallback이 위 정본을 공유한다.
  생성자는 `includeDeclaration`일 때 파서가 준 정확한 이름 range를 별도로 더하고, name-only cache fallback으로
  모든 `New`가 섞이는 경로는 타지 않는다.
- 일반 문자열/주석 제외는 유지하되 callable target에 대해서만 정확한 symbol-valued string을 허용한다.
  class member의 단독 `"Proc"`는 정의 파일 안으로 제한하고, 다른 파일에서는 `"Class.Proc"`가 정확히 일치해야 한다.
- 사용부에서도 target scope를 복원한다: `New ClassName` 뒤 타입으로 생성자를 찾고, 권위 있는
  `Class.Member`/`Module.Member`는 해당 컨테이너의 실제 멤버를 먼저 고른다.

### 검증

- `npm test` — **763/763 통과**(신규 `referenceSyntax` 5건 포함), TypeScript compile 포함.
- 제공된 실파일을 `GPLParser` + 새 정본으로 직접 probe:
  - 선언 `Server.gpl:62:14-17` (`New`, class `TcpServer`) → 사용 `Main.gpl:45:18`, `New TcpServer` 검출.
  - 선언 `Server.gpl:455:21-47` (`TcpClientSessionThreadFunc`, class `TcpServer`) →
    callback `Server.gpl:448:41-67` 정확히 검출.
- 일반 메시지의 부분 문자열, `TcpServerFactory`, 다른 컨테이너, `"TCPCLI"` label 제외 회귀 테스트 통과.
- Extension Development Host의 실제 Shift+F12 UI 호출은 하지 않았다 — §3 체크리스트에 남겼다.

### 변경 파일

```txt
src/language/referenceSyntax.ts       # 신규 — 생성자/callback 문자열 참조 문법 정본(순수)
src/providers/referenceProvider.ts    # 세 검색 경로 통합 적용 + 사용부 target scope 복원
src/test/referenceSyntax.test.ts      # 신규 — 실사용 문법/오탐 방지 5건
src/test/index.ts                     # 테스트 등록
docs/ai-handoff.md, CHANGELOG.md      # 기록 + §1-CM 2026-08 아카이브 이동
```

---

## 1-CX. 2026-09-03 세션 — 밀린 작업 트리 일괄 커밋 + `.gitignore` 정리 (리팩토링 준비)

### 요청

"남은 것들 커밋 좀 해 주고, 적절히 `.gitignore`도 처리해서 깃 프로젝트 좀 깔끔히 만들어 줘. 리팩토링 준비."

### 상황 (착수 시점 관측)

마지막 커밋 `b9a30d5`(08-31, CI 수정) 이후 **세션 20개분(§1-CD ~ §1-CW)의 결과물이 작업 트리에만**
있었다 — 추적 파일 60개 수정(+6,412/-4,080), 신규 파일 30개(모듈 13 · 테스트 12 · `docs/archive/handoff/` 등).
§1-CC 때와 같은 누적 패턴이다.

### 조치 (의도와 방법)

**커밋 전에 `npm test` 763/763 통과를 먼저 확인**했다(작업 트리 상태 자체가 온전한지가 먼저다).
그 다음 **계층별로 나눠** 커밋했다. 세션별로 자르는 것은 파일이 세션을 가로질러 겹쳐 불가능하고,
파일 하나를 여러 커밋에 쪼개면 어느 커밋도 컴파일되지 않으므로, **"한 커밋 = 한 계층"** 을 기준으로 삼았다.

| 커밋 | 범위 | 담은 세션 |
| --- | --- | --- |
| `chore: .gitignore …` | `.gitignore` | 이번 세션 |
| `기능(언어): 심볼 해석 정본화 …` | `language/`·`providers/`·파서·`symbolCache` + 테스트 (31 파일) | §1-CF~§1-CI, §1-CQ~§1-CW |
| `기능(프로젝트): 중첩 워크스페이스 …` | `project/` + 테스트 (7 파일) | §1-CN, §1-CT |
| `기능(제어기·디버깅): 중단점 양방향 수렴 …` | `controller/`·`debug/`·`views/` + 테스트 (27 파일) | §1-CD, §1-CJ~§1-CM, §1-CO, §1-CU |
| `기능(MCP): 결과 미확정(outcome) …` | `controller-mcp/` (8 파일) | §1-CL, §1-CO |
| `빌드/등록: 새 명령·설정 배선 …` | `package.json`·`extension.ts`·`config.ts`·`scripts/clean.js` | §1-CD, §1-CP, §1-CU |
| `docs: 세션 기록 …` | 문서 전체 | §1-CD~§1-CX |

`.gitignore` 에는 **저장소 밖(사용자 전역 `~/.config/git/ignore`)에만 있던 규칙**을 옮겨 담았다 —
다른 머신이나 CI에서 체크아웃해도 같은 파일이 추적 후보로 뜨지 않게 하기 위해서다.

- `.claude/settings.local.json` — Claude Code 권한 허용 목록(머신마다 다름). `.claude/` 전체가 아니라
  이 파일만 무시한다(팀 공유용 `.claude/settings.json` 은 추적 대상으로 남긴다).
- `.venv/`·`venv/`·`__pycache__/` — `requirements-docs.txt` 로 만드는 MkDocs 빌드용 가상환경.
- `*.orig`·`*.rej` — 패치/머지 잔여물.

기존 규칙은 **지우지 않았다.** `bin/`·`obj/`·`pkg/` 처럼 이 프로젝트에서 안 쓰는 항목도 있지만,
무시 규칙을 지우면 산출물이 실수로 커밋될 위험만 생기고 얻는 것은 미관뿐이다.

### 검증

- `npm test` — **763/763 통과**(TypeScript 컴파일 포함), 커밋 전 상태 기준.
- `git status` 정리 후 **깨끗함**(추적되지 않은 파일 없음, 무시되는 것은 산출물 디렉터리뿐).
- 추적 중인 파일 가운데 무시 규칙에 걸리는 것 없음(`git ls-files -i -c --exclude-standard` 빈 결과).
- 커밋 순서는 계층 → 배선 → 문서. 개별 커밋 단위로는 컴파일되지 않는 지점이 있다(위 표의 이유).

### 남은 일

- **CHANGELOG 버전 표기 어긋남**(§3에 항목 추가): `package.json` 0.8.28 vs CHANGELOG 최상단 `[0.8.27]`.
- 리팩토링 착수 전 참고: 이번에 만들어진 정본 모듈들(`language/symbolScope.ts`·`referenceSyntax.ts`·
  `declarationList.ts`·`symbolLocations.ts`, `project/compileUnit.ts`, `controller/breakpointCommand.ts`)이
  구조 개선의 발판이다 — 같은 판단을 여러 provider 가 중복으로 하던 것을 순수 모듈로 모으는 방향.
- `.gitattributes` 는 두지 않았다(제안만). 지금 인덱스는 전부 LF 이고 `core.autocrlf=true` 라 동작은
  일관되지만, 머신마다 설정이 다르면 전체 파일 diff 가 날 수 있다. 도입한다면 `* text=auto` 한 줄이
  인덱스 내용을 바꾸지 않아 안전하다 — 사용자 결정 사항.

### 변경 파일

```txt
.gitignore                        # AI 도구 로컬 설정·문서 venv·패치 잔여물 추가
docs/ai-handoff.md                # 헤더·§1 인덱스·§3 갱신 + 이 절 신설
docs/archive/handoff/2026-09.md   # 신규 — §1-CN 이동(본문 최근 10세션 유지 규칙)
```

### 후속 (같은 세션) — 0.9.0 정식 릴리스

커밋 정리 직후 사용자가 "0.9.0 버전으로 새로 올려 달라"고 해서 minor 릴리스를 냈다.
`docs/releases/process.md` §2(공식 MINOR) 절차를 그대로 따랐다 — **`npm run package`를 쓰면 patch가
한 번 더 올라가므로 `bump-version.js minor` → 문서 정리 → 커밋 → `pre-release-check` →
`package:no-bump` 순서**다.

**버전 어긋남 해소.** 위 §남은 일에 적어 뒀던 "`package.json` 0.8.28 vs CHANGELOG `[0.8.27]`" 문제는
0.9.0 릴리스로 자연스럽게 정리됐다. 판단 근거는 **`0.8.23`~`0.8.28`이 태그 없이 로컬 VSIX로만 나간
개발 빌드**라는 것이다(마지막 태그는 `v0.8.22`). 그래서 과거 절을 개명해 이력을 고치는 대신
(§1-CC 때는 그렇게 했지만, 그때는 대상이 딱 한 절이었다) **`[0.9.0]` 절에 그 구간 전체를 요약으로 묶고
"0.8.23~0.8.28은 로컬 빌드였고 그 변경이 모두 이 릴리스에 들어 있다"고 명시**했다. 과거 절은 원문
그대로 남아 있으니 항목별 상세는 그대로 읽을 수 있다.

- 릴리스 노트는 `scripts/extract-changelog.js`가 **해당 버전 절만** 뽑아 GitHub Release 본문으로 쓰므로,
  `[0.9.0]` 절은 아래 절을 참조만 하지 않고 **그 자체로 읽히도록** Added/Changed/Fixed를 채웠다.
- `bump-version.js`는 `package-lock.json`을 건드리지 않는다 — lockfile의 version 필드 2곳을 직접 맞췄다
  (`npm install`을 돌리면 의존성까지 흔들리므로 하지 않았다).
- `README.md`는 손대지 않았다. 이 저장소의 README에는 버전·이력 같은 가변 정보를 두지 않는 것이 정책이고
  `pre-release-check`가 이를 강제한다(`docs/releases/process.md`의 "README 현재 버전 갱신" 항목은
  그 정책 이전에 쓰인 낡은 서술이다 — 따르지 말 것).

검증: `npm test` 763/763 · `npm run pre-release-check` 통과 · `npm run package:no-bump` →
`dist/gpl-language-support-0.9.0.vsix` · `mkdocs build --strict` 통과.
`git push origin main` + `git tag v0.9.0` 푸시로 `release.yml`이 GitHub Release를 만든다.

**릴리스 결과.** 워크플로 3개 모두 성공(Release 42 s · CI 35 s · docs 34 s).
[v0.9.0 릴리스](https://github.com/nir414/GPL_language/releases/tag/v0.9.0) — draft/pre-release 아님,
`gpl-language-support-0.9.0.vsix`(1,065,820 B) 첨부. CI 가 통과했으므로 리눅스 러너에서도 확장 테스트·
MCP 테스트·패키징 스모크가 돈 것이다.

### 후속 2 (같은 세션) — 릴리스 로그 경고 반영 + `AGENTS.md` 동기화

- 릴리스 로그에 남은 경고 2건(Actions 의 Node 20 지원 종료 · VSIX 에 JS 129 개)을 **§3 체크리스트에
  올렸다.** 둘 다 이번 릴리스를 막지는 않지만 방치하면 릴리스 경로가 깨지거나(전자) 활성화가
  느려지는(후자) 항목이다.
- **`AGENTS.md` 와 `CLAUDE.md` 가 어긋나 있던 것을 맞췄다.** 두 파일은 같은 문서로 취급되는데
  (`CLAUDE.md`(=`AGENTS.md`)) `AGENTS.md` 에만 **F5 "Run Extension" 개발 호스트 프로필 설명이
  빠져 있었다** — Codex 계열은 `AGENTS.md` 만 읽으므로 그쪽만 `GPL-DevHost` 격리 규칙을 모르는
  상태였다. 이제 **제목 줄과 `AGENTS.md` 끝의 Cowork 블록을 빼면 두 파일이 완전히 동일**하다
  (Cowork 블록은 사용자가 넣은 것이라 그대로 뒀다). 한쪽만 고치는 실수가 또 나올 수 있으니,
  이 문서들을 고칠 때는 **양쪽을 함께** 고칠 것.


## 1-CY. 2026-09-07 세션 — 네트워크 DataID 조사 + 실기 실측 대조 (진단에 쓸 수 있는 것 골라내기)

### 요청

사용자가 Brooks 공식 문서 2개 링크를 주고 "유용한 자료가 있는지 확인 후, 유용하면 어떻게 활용할지
알아서 작성해서 메모해 두라"고 했다.

- PDB Controller Settings → Networking: `Controller_Software/Software_Reference/PDB/Controller_Settings/network.htm`
- Servo Network → Ethernet 설정 절차: `Controller_Software/Software_Setup/Selected_Setup_Procedures/Servo_Network/SrvNet_ethernet.htm`

### 조사 — 문서만 읽지 않고 실기기와 대조했다

문서는 가설이고 실기기 응답이 사실이라는 저장소 방침(§0-3)에 따라, 문서에서 고른 DataID 13개를
MCP `read_dataids`(= `pd <id>`, **읽기 전용·모션 무영향**)로 한 번에 조회했다 — 13/13 `STATUS 0,"Success"`.
대상은 G2400C · GPL 4.2K5 · `192.168.0.1`.

수확 5가지:

1. **`431`·`432`(Ethernet 수신·송신 오류)가 전 항목 `0`이다.** CRC·framing·fifo·carrier 등 어디에도
   값이 없다 → 이 제어기에서 관측돼 온 접속 끊김·재접속 거부는 **케이블/NIC 수준 문제가 아니다.**
   상위(제어기 소켓 처리·세션 수)에서 찾아야 한다는 근거가 처음으로 생겼다.
2. **`430`은 문서가 12개 값을 열거하지만 실측은 10개**다. 문서상 마지막 2개(`Port 1/2 status bitmask`)가
   이 펌웨어에 없다. **파서를 만들 때 길이를 고정하면 안 된다.** 번호↔항목 매핑도 개수가 다르므로
   아직 [추정]이다(§3 체크리스트).
3. **`427`(FTP user name and password) = `""`** — 문서상 빈 값이면 로그인이 필요 없다. 캡처에서 본
   `USER Precise`가 통한 이유이자, **FTP 배포 실패를 자격증명 탓으로 돌릴 근거가 없다**는 뜻이다.
4. **`134 Slave mode = 0`, `151`은 마스터 시리얼 1개 + 빈칸 15개** → **서보 네트워크 슬레이브가 없다.**
   `read_dataids({node})`의 `node` 인자를 쓸 대상이 애초에 없다(배열 16칸 = 마스터 1 + 슬레이브 최대 15로,
   문서의 "최대 15 노드"와도 맞는다).
5. **`411 Network console enable = 1`** — **TELNET(TCP 23) 콘솔이 열려 있다.** 확장은 안 쓰지만
   "단일 클라이언트·단일 명령 스트림" 전제를 깨는 외부 접속 경로가 하나 더 있다는 뜻이라,
   원인 불명의 상태 변화를 조사할 때 후보로 남긴다.

부수적으로 **`464 Web RPC = 0, 0, 0`**(전부 기본값)이라, "GDE가 변수를 웹 RPC로 읽는다"는 기존 가설
(`development/pa-controller-debug-operations.md` 7-8)을 **뒷받침하지도 반박하지도 않는다**는 것이 확인됐다.
서보 네트워크 문서에서는 **전원 투입 후 마스터가 약 30초, 슬레이브가 약 60초 대기**한다는 서술을 건졌다 —
재접속 백오프의 "이 구간의 거부는 장애로 세지 않는다"에 인용할 공식 근거다(다만 2026-08-31의 약 2.5분
거부는 이보다 길어 **이것만으로는 설명되지 않는다**).

### 조치

- **신규 `docs/reference/network-dataids.md`** — 실측값 표 + `430` 문서↔실측 대조표 +
  **"어떻게 쓸 것인가" 5절**(연결 진단 계층 분리 / FTP 실패 분류 / `node` 인자 사용 조건 /
  전원 투입 직후 무응답 / 포트 23) + 후속 검증 항목 + **"확장과 무관해 보이는 것과 그 이유"**.
  마지막 절은 다음 작업자가 같은 문서를 다시 뒤지지 않게 하려는 것이다(440–444 외부 궤적,
  453–466 웹 UI 계열 등). 근거 등급은 `project-file-gpr.md`와 같은 [실측]/[문서]/[추정] 표기를 썼다.
- `mkdocs.yml` nav → 레퍼런스에 등재.
- `development/pa-controller-debug-operations.md` 7-8 항목에 `464` 실측값 한 줄과 새 문서 참조 추가.

### 검증

- `read_dataids` 13건 전부 `STATUS 0,"Success"` — 값은 새 문서 §1에 원문 그대로.
- 코드 변경 없음(문서 3개 + nav). 컴파일·테스트 영향 없음.

### 남은 일

§3 체크리스트 2건(Ethernet 카운터를 진단에 얹기 / `430` 매핑 확정). 둘 다 읽기 전용·모션 무영향이다.

### 변경 파일

| 파일 | 내용 |
| --- | --- |
| `docs/reference/network-dataids.md` | **신규** — 네트워크 DataID 실측 대조 + 활용 방안 |
| `mkdocs.yml` | nav 레퍼런스에 신규 문서 등재 |
| `docs/development/pa-controller-debug-operations.md` | `464` 실측값 + 신규 문서 참조 |

---

## 1-CZ. 2026-09-07 세션 — `extension.ts` activate() 5,300줄을 명령 그룹별 모듈로 분해 (구조 리팩터링, 동작 동일)

### 요청

"알아서 전체 검토 후 작업해 줘." — §1-CX(커밋 정리·0.9.0 릴리스)로 작업 트리를 비운 뒤의 **리팩터링 착수**.

### 검토 결론 (착수 근거)

- 소스 90개 파일 42,720줄 중 `extension.ts`가 5,752줄이고, 그중 **`activate()` 한 함수가 5,300줄**이었다
  (명령 핸들러 72개 + `registerAiDebugCommand` 10개, 내부 헬퍼 함수 70여 개, 공유 클로저 변수 50여 개).
  코드 품질(주석·의도)은 좋지만 구조가 전부 한 클로저라 어디를 고쳐도 diff 가 이 파일에 몰렸다.
- §3-B 에 2026-07-16 부터 "행동 수정과 구조 변경 혼합을 피한다"는 이유로 **보류**돼 있던 항목이고, §1-CX 로
  트리가 비어 지금이 혼합 없이 할 수 있는 유일한 시점이었다. 로드맵(메모리 structural-refactor-roadmap)의 원칙
  **"빅뱅 금지 · 안전망 → 인터페이스 → 점진 분해 · 저위험 먼저"** 에 따라 이것 하나만 했고,
  `gplDebugSession.ts`(5,186줄, DAP+제어기 동작)·`deployService.ts`(`deployLocked` 한 함수 1,100줄)는
  하드웨어 검증 없이 손대지 않았다.

### 조치 (의도와 방법)

**설계.** 클로저가 공유하던 것을 명시적인 객체 하나로 옮기고, 명령 그룹은 그 객체를 받는 함수로 만든다.

- `activation/host.ts` — `ExtensionHost`. ① 서비스(불변): 출력 채널 3개·배포 진단 컬렉션·심볼 캐시·진단
  provider·ExtensionContext(생성자에서 만든다 — 종전에는 activate 진행 중 여기저기서 생성). ② 가변 상태: 트리·
  상태바·런타임 콘솔·건강 모니터/프로버·디버그 세션 여부·마지막 배포/소스 stale/런타임 에러 스냅샷·최근 로그 링버퍼·
  컴파일 검증 상태·중단점 sync/mirror. **항상 `host.x` 로 읽는다** — 활성화 시점에 구조 분해로 복사하면 낡은 값을
  본다(종전 클로저의 late binding 과 같게). ③ 헬퍼: 두 그룹 이상이 쓰는 것만(log·배포 잠금 조회/경고·프로젝트명
  가드·컴파일 검증 mark/clear·런타임 콘솔 싱글톤·연결 상태 반영·Agent Bridge). ④ 하위 API `project`·`connection`·
  `deploy`·`decorations` — 그 그룹의 활성화 함수가 돌려준 객체를 정의 대입(`!`)으로 둔다(activate 가 동기적으로
  끝나기 전에 모두 대입되고 명령 핸들러는 그 뒤에만 돈다).
- `activation/controllerOps.ts` — busy 재시도·정지 확인(`Show Thread` settled, §0.6)·SoftEStop 복구·정지 진입
  대기. 로그가 필요한 것은 host 를 첫 인자로 받는다(호스트 메서드로 만들지 않은 이유: host 를 "상태 컨테이너"로
  유지하고 의존성을 인자로 드러내기 위해 — design-principles "의존성은 주입받도록").
- `activation/debugDecorations.ts` — `ExecutionDecorations`. 종전에는 데코레이션 타입 2개 + "지금 칠해진 에디터"
  변수 2개를 트리 명령(threadShowLocation)과 디버그 이벤트(gpl.errorLocation)가 나눠 만졌다. "한 번에 한 곳만
  칠한다·편집 시작 시 모두 지운다"를 한 객체가 지킨다.
- 명령 그룹 14개(`activateXxx(host)`): languageFeatures(provider·워처·심볼 명령·클릭 후 호버, 활성화 마무리
  함수 반환) · xmlCommands · projectContext(→ host.project) · breakpointCommands · connection(→ host.connection) ·
  deploy(→ host.deploy) · consoleCommands · aiAgentSetup · aiDebugCommands · controllerCommands · treeCommands ·
  ftpCommands · debugIntegration · uriHandler.
- `extension.ts` — 195줄. host 생성 → 배너 → 위 함수들을 **종전과 같은 순서**로 호출. 다른 점 하나: 프로젝트
  컨텍스트(`host.project`)를 중단점 명령보다 먼저 만든다(종전에는 함수 호이스팅에 기대 순서가 뒤였다).

**방법 — 기계 치환 + 컴파일러 검출.** 본문을 손으로 옮기지 않았다. 스크립트가 원본의 줄 범위를 그대로 잘라
`activateXxx(host)` 안에 넣고, 공유 참조만 정규식으로 바꿨다: `logOutput(`→`host.log(`, 가변 상태 14종→`host.x`,
공유 헬퍼 12종→`host.f(`, controllerOps 함수 4종에 `host` 첫 인자 삽입, 하위 API 는 정의 모듈 밖에서만
`host.project.f(` 접두. 주석 줄은 건너뛰고, 필요한 import 는 원본 import 블록에서 식별자 출현으로 자동 산출했다.
남은 것은 **`tsc --strict` 가 전부 잡았다**(1차 59건 → 25건 → 2건 → 0): 스프레드(`...healthMonitor`) 뒤라
lookbehind 에 걸린 미치환 3건, 인자 없는 호출에 `host` 가 두 번 들어간 1건, 범위에 잘못 섞인 채널 생성 코드,
모듈 레벨 함수(사후 스냅샷·XML 로더)가 클로저 상태를 쓰던 것(→ host 인자) 등. heredoc 이 백슬래시를 한 단계 벗겨
정규식 리터럴이 깨진 사고가 두 번 있었다(메모리 reference_bash_heredoc_limit 재확인 — 스크립트는 Write 로 저장 후 실행).

**순수 로직 분리 (별도 커밋 `58bec44`).** activate 안에 있어 테스트할 수 없던 것 4건을 vscode 무의존 모듈로:
`controller/threadArgs.ts`(asThreadNode) · `controller/stepCommand.ts`(buildStepCommand ← aiBuildStepCommand,
startCommand.ts 와 같은 "문서 구문 단일 출처") · `controller/runtimeConsolePresentation.ts`(buildRuntimeConsoleUserMessage
— 상태 라벨 정본이 이미 있던 모듈) · `debug/showVariableParser.ts`(normalizeEvalValue). `config.ts` 에
`isRuntimeConsoleAutoStartOnDeploy/OnDebug`·`hasOpenGplDocument`. 테스트 15건 신설.

**의도한 동작 차이는 둘뿐.** ① 출력 채널 4개(`GPL Language Support`·`GPL Traffic`·`GPL Console`·배포 진단)의
생성 **시점**이 활성화 맨 앞으로 모였다(상대 순서는 종전과 같음 — Output 드롭다운은 라벨 정렬이라 체감 차이 없음).
② 활성화 배너와 FTP Run 로그의 버전 표기가 `vscode.extensions` 런타임 조회 대신 `EXTENSION_VERSION`
(package.json 단일 소스 — [[feedback_provider_version]] 결정과 일치). 그 밖의 문구·순서·게이트는 그대로다.

### 검증

- `tsc --strict` 무오류, `npm test` **778/778**(763 + 신규 15).
- **등록 명령 집합 전후 대조**: `registerCommand`/`registerAiDebugCommand` 의 ID 82개가 원본과 **동일 집합**.
  provider 등록 11종·이벤트 구독 13종의 개수도 동일.
- `context.subscriptions.push` 118 → 113: 채널 4개를 host 생성자에서 한 번에(−3), 데코레이션 타입 2개 +
  onDidChangeTextDocument 1개를 `ExecutionDecorations` 하나로(−2) — dispose 대상은 같다.
- 옛 식별자(`logOutput`·`extVersion`·`clearStoppedDecoration` 등) 잔존 0건, 미사용 import 0건(스크립트 검사).
- **하지 않은 것**: Extension Development Host 실동작·실기기 확인 — §3 맨 위 항목으로 남겼다. 코드 본문이
  그대로이고 컴파일러가 참조를 전부 검증했으므로 위험은 낮지만, "켜 봤다"는 사실은 없다.

### 남은 일 / 다음 작업자에게

- §3 스모크 항목(위). 통과하면 이 절의 "미실시" 표기를 지운다.
- 다음 저위험 후보(같은 host 패턴): `activation/deploy.ts` `runDeployCore` 의 결과 보고부(스냅샷 서명·ErrorLog 분류
  로그)를 순수 함수로 → 테스트 가능. `controllerTreeProvider.ts` 하단 포맷 함수(1547~)도 순수 모듈 후보.
- 고위험(하드웨어 검증 필요, 로드맵 P2/P3/P8): `gplDebugSession.ts` 클래스 분해, `deployService.deployLocked`
  단계 분리, `runtimeConsole.ts` 재연결 상태 머신. 브로커 아키텍처(docs/development/broker-workbench-architecture.md)
  Phase 0 결합도 제거 체크리스트와 함께 볼 것 — `ExtensionHost` 는 그 체크리스트의 "vscode 결합 지점 목록" 역할도 한다.
- 새 파일은 `extension.ts` 와 같은 **탭** 들여쓰기다(옮긴 코드의 diff 를 줄이기 위해). 저장소의 다른 파일은 대부분
  4칸 공백 — 혼재는 종전부터 있던 상태(controller 일부·views 도 탭).
- 동시 세션 주의: 이 세션과 §1-CY 세션(gpl-language-84)이 같은 작업 트리에서 겹쳤다. 코드 커밋은 이 세션 파일만
  경로 지정으로 올렸고, 문서 커밋은 §1-CY 문서 변경(코드 0건, 편집 완료 확인)을 **함께** 담았다 — 커밋 메시지에 명시.

### 변경 파일

```txt
src/extension.ts                        # 5,752 → 195줄. 배선만
src/activation/host.ts                  # 신규 — ExtensionHost
src/activation/controllerOps.ts         # 신규 — 재시도/정지 확인/SoftEStop/정지 대기
src/activation/debugDecorations.ts      # 신규 — ExecutionDecorations
src/activation/*.ts (14)                # 신규 — 명령 그룹별 activateXxx(host)
src/controller/threadArgs.ts            # 신규 — asThreadNode (순수)
src/controller/stepCommand.ts           # 신규 — buildStepCommand (순수)
src/controller/runtimeConsolePresentation.ts  # buildRuntimeConsoleUserMessage 추가
src/debug/showVariableParser.ts         # normalizeEvalValue 추가
src/config.ts                           # isRuntimeConsoleAutoStartOnDeploy/OnDebug · hasOpenGplDocument
src/test/{threadArgs,stepCommand,runtimeConsolePresentation}.test.ts  # 신규 + showVariableParser.test.ts 3건
docs/ai-handoff.md                      # 헤더·§1 인덱스·§3·§3-B(보류 항목 종결)·§4 갱신 + 이 절
docs/archive/handoff/2026-09.md         # §1-CP 이동
```

---

## 1-DA. 2026-09-07 세션 — flash 영구 저장(`gpl.saveToFlash`)을 AI 경로에서 차단

### 요청

> "GPL MCP 서버에 AI는 FlashSave 금지. 그리고 기능에서도 비활성화 시켜놔야겠어."

차단 범위는 확인 결과 **AI 경로만** — 사람이 팔레트·컨텍스트 메뉴에서 실행하는 경로는 그대로 둔다.

### 확인한 것 (단정 전 근거)

- **"FlashSave"는 1402 콘솔 명령이 아니다.** Brooks 공식 문서의 Console Commands 디렉터리 49개
  (`Controller_Software/Software_Reference/Console_Commands/`)에 그런 명령이 없고, 파라미터 쓰기 `Pc` 문서에도
  flash 저장 언급이 없다. 이 저장소에서 flash 에 쓰는 유일한 경로는 확장 명령 **`gpl.saveToFlash`**
  (`/flash/projects/<project>` FTP 미러 저장)다. → 콘솔 명령 차단은 필요 없고 확장 명령 차단이 맞다.
- **AI 가 그 명령에 닿는 문 3개**: ① MCP `extension_command`(→ Agent Bridge) ② URI
  `vscode://…/gpl.saveToFlash?project=X` ③ 자동화 인자(`isAutomationInvocation`)를 실은 직접 호출.
  셋 다 `gpl.*` 이면 통과였다.
- 왜 위험한가: `mirrorProject` 는 **로컬에 없는 원격 파일을 지운다**. flash 는 영구 사본이고 쓰기 수명이
  유한하다. 테스트 배포는 `/GPL` 직접 업로드로 충분하므로 AI 가 flash 를 건드릴 이유가 없다.

### 조치 — 차단 목록 정본 1개 + 게이트 3곳 + MCP 미러

- **`src/controller/aiCommandPolicy.ts` (신규, vscode 무의존)** — `AI_BLOCKED_COMMANDS` 에 명령 ID·제목·
  **왜 막는지**·**사람이 실행하는 방법**을 함께 담는다(응답에 그대로 실어 호출자가 우회를 찾지 않게).
  `findAiBlockedCommand` 는 대소문자·공백을 무시해 표기 변경 우회를 막는다. 항목을 추가하면 아래 세 곳이
  자동으로 따른다 — 명령별 `if` 를 흩뿌리지 않는 것이 목적.
- **게이트 3곳**
  - `controller/agentBridge.ts` — `validateBridgeRequest` 에서 거부(`error:"command-blocked"`). MCP 를 포함한
    **모든 브리지 클라이언트**가 여기를 지나므로 MCP 번들이 구버전이어도 막힌다.
  - `activation/uriHandler.ts` — 실행 전 거부, Output `[URI] 차단 …` + 경고 메시지.
  - `activation/deploy.ts` 의 `gpl.saveToFlash` — 자동화 인자면 `{ok:false, error:"AI_BLOCKED", detail}` 을
    돌려주고 아무것도 올리지 않는다(브리지·URI 를 거치지 않는 직접 호출까지 막는 마지막 관문).
    자동화 분기가 통째로 사라지면서 이 명령은 사람 경로(QuickPick + 미저장 확인)만 남았다.
- **MCP 서버** — `controller-mcp/src/aiPolicy.js` 가 같은 목록을 미러링해 `extension_command` 에서
  **왕복 없이** `{ok:false, sent:false, error:"AI_BLOCKED", recommendedAction}` 로 거부하고, 도구 설명과
  `guidelines.js`(initialize instructions — 도구 호출 **전에** 읽힌다)에도 금지를 명시한다.
  두 목록이 어긋나면 "MCP 는 막는데 URI 는 뚫리는" 구멍이 생기므로 **테스트가 두 파일의 명령 ID 집합을 대조**한다.

### 원칙과의 관계 (중요 — 지우지 말 것)

2026-08-28 사용자 결정 "AI 접근을 지침/허용 목록/승인 모달로 막지 않는다"는 그대로 유효하다. 이번 것은
**되돌릴 수 없는 파괴적 명령만 담는 예외 목록**이다. 구분 기준: `commandPolicy.ts` 는 *기다리면 안전해지는*
타이밍 조건을 확장이 대신 충족시키고, `aiCommandPolicy.ts` 는 *기다린다고 안전해지지 않는* "해도 되는가"의
판단이 필요한 명령만 거부한다. 이 구분을 `commandPolicy.ts` 머리말·런북 §명령 정책·
`.github/instructions/…` 7번 항목에 각각 적어 두었다.

### 검증

- `npm test` 784/784 (778 + 신규 `src/test/aiCommandPolicy.test.ts` 6건 — 목록 내용·표기 우회·비차단 명령 통과·
  브리지 거부/통과).
- `controller-mcp` `node --test` 86/86 (79 + 신규 `test/aiPolicy.test.mjs` 7건 — 거부 결과 형태·instructions 문구·
  **확장 목록과의 일치**).
- 실기기 확인 불필요(제어기에 아무것도 보내지 않는 경로 차단).

### 남은 일

- 사람 경로 스모크(팔레트에서 Save to Flash 실행)는 §3 의 확장 실동작 스모크 항목에 함께 둔다 — 자동화 분기
  제거로 이 명령의 사람 경로 코드가 바뀌었다.

### 바뀐 파일

```
src/controller/aiCommandPolicy.ts       # 신규 — AI 차단 목록 정본
src/controller/agentBridge.ts           # command-blocked 코드 + validateBridgeRequest 게이트
src/controller/commandPolicy.ts         # 머리말에 예외 명시(원칙 구분)
src/activation/uriHandler.ts            # URI 경로 차단
src/activation/deploy.ts                # gpl.saveToFlash 자동화 분기 제거 + AI_BLOCKED 반환
src/test/aiCommandPolicy.test.ts        # 신규 6건 (index.ts 등재)
controller-mcp/src/aiPolicy.js          # 신규 — MCP 미러 목록
controller-mcp/src/index.js             # extension_command 거부 + 도구 설명
controller-mcp/src/guidelines.js        # instructions 에 flash 저장 금지
controller-mcp/test/aiPolicy.test.mjs   # 신규 7건 (확장 목록과 대조 포함)
docs/development/ai-controller-debugging-runbook.md · .github/instructions/gpl-ai-controller-debugging.instructions.md
docs/ai-handoff.md · docs/archive/handoff/2026-09.md  # 이 절 + §1-CQ 아카이브 이동
```

## 1-DB. 2026-09-07 세션 — 구조 기반 정비: 계층 경계 정리 + 순수 분리 + 구조 규칙을 테스트로 고정 (리팩터링 5커밋, 동작 동일)

### 요청

"프로젝트를 전체적으로 구조체계들을 검토 후 리팩토링하여 체계적으로 한번 다시 기반틀을 튼튼하게 다지고 가려고 합니다.
피드백 후 알아서 개선 작업을 이어나가 주세요. 모든 개선 작업 완료 후 보고해 주세요."

### 검토 결론 (착수 근거 — 피드백으로 보고한 내용)

착수 시점: 소스 170파일 52,852줄(테스트 60파일 9,541줄 포함), `npm test` 784/784, MCP 86/86. 직접 import 그래프·
tsc 엄격 플래그 시험·미사용 심볼·package.json 대조로 본 상태:

- **잘 돼 있던 것**: `language/` 11/11 · `controller/` 31/41 · `debug/` 5/7 이 vscode 무의존이고 순수 모듈엔 테스트가 있다.
  런타임 import 순환 0(activation 의 host↔그룹 순환은 전부 `import type`). §1-CZ 로 extension.ts 분해 완료.
- **틀이 무너질 수 있던 곳**: ① 계층 규칙이 문서에만 있고 강제되지 않았다 — 실제로 `language/symbolLocations`·`project/*`·
  `symbolCache` 가 경로 키 하나 때문에 `controller/projectPickerCore` 를 import 했고(역방향), `language/gplBuiltins` 는 `ciEq`
  하나 때문에 `config.ts`(vscode) 를 끌어들여 Node 단독 테스트가 불가능했다(테스트가 없어 드러나지 않았다). ② 테스트 등록이
  수동(`index.ts`)이라 파일을 만들고 등록을 잊으면 조용히 빠진다. ③ tsconfig 가 `strict` 만 — 미사용 import/지역 11건·암묵
  return 3건·DAP `override` 누락 24건이 쌓여 있었다. ④ 죽은 코드: `controllerDiscovery.ts`(UDP 검색 — import 0, 명령 0, README 는
  기능으로 광고), `scripts/dev-cycle.js`(참조 0, 산출물 이름도 틀림), 0바이트 잔여 파일. ⑤ 루트 `src/` 에 언어 모듈 6개가 섞여
  폴더가 계층을 말하지 않았다. ⑥ `docCommentProvider.ts` 의 sortText 에 리터럴 NUL 바이트 — grep 이 바이너리로 오인.
- **손대지 않은 고위험**(로드맵 그대로): `gplDebugSession.ts` 5,186줄·`deployService.deployLocked` 1,100줄·`runtimeConsole.ts`
  재연결 상태 머신 — 하드웨어 검증 없이 분해하지 않는다(하드 규칙 6).

### 조치 (커밋 5개 + 문서 1개, 각각 tsc + `npm test` 통과 후 커밋)

① **정리(71dfcea)** — tsconfig 에 `noUnusedLocals`·`noUnusedParameters`·`noImplicitReturns`·`noImplicitOverride`·
  `noFallthroughCasesInSwitch`. 켜기 전 위반 38건 정리(미사용 매개변수는 `_` 접두, 명령 핸들러 3곳 `return undefined;` 명시,
  `gplDebugSession` 24곳 `override`). 죽은 코드 2파일 삭제(복구: `git show 9b79f1e:src/controller/controllerDiscovery.ts`),
  README/런북의 51417 언급 제거. NUL 리터럴 → `\u0000`(같은 값). `.editorconfig` 신설(.ts 들여쓰기는 파일별 혼재라 강제 안 함).
② **경계(a0dfe2e)** — `util/pathKey.ts`(normalizePathKey·normalizeDirKey·isPathUnder) 신설, 호출부 14곳 갱신, 재노출 없음(thin
  wrapper 지양). `controller/gprSync.ts` → `project/gprSync.ts`(순수 .gpr 로직). 명령 래퍼 `gprSyncCommand` 는 deployService·
  projectPicker 를 쓰므로 controller 에 남겨 controller → project 방향만 남겼다.
③ **배치(e093447)** — `gplParser`·`gplBuiltins`·`gplDictionaryData`·`gplStatements`·`symbolNameIndex`·`xmlUtils` → `language/`,
  `launchJsonc` → `debug/`. `git mv`(내용 무변경 → 100% rename) + import 42곳을 스크립트로 재계산(파일의 옛/새 위치 기준 상대
  경로 재산출) → tsc 검증. `scripts/dev/smoke.js` 의 out/ 경로 갱신. 루트에 남은 것: `extension`·`config`·`symbolCache`
  (vscode 의존이라 순수 계층 `language/` 에 넣지 않음).
④ **순수 분리(c80d84b)** — `controller/deployOutcome.ts`: runDeployCore 의 결과 보고 클로저 6개(결과 서명·컴파일 요약·스냅샷 조립·
  ErrorLog 분류 로그·COMPILE 원문 로그·실패 문구 4분기) + 이력 링버퍼 → 순수 함수/클래스. runDeployCore 는 줄을 찍고 알림을
  띄우는 일만 남는다(1,110 → 969줄). `SituationDeploySnapshot` 타입도 생산자 쪽으로 옮겨 controller/activation → views 타입
  의존을 views → controller 로 정정. `views/treeFormat.ts`·`views/runtimeConsoleTreePresentation.ts`: 트리 하단 함수 12개 그대로
  이동(1,718 → 1,537줄). 1403 문구 두 표현의 차이는 통일하지 않고 머리말에 기록. 테스트 23건.
⑤ **안전망(1331ee6)** — `src/test/architecture.test.ts` 6건: R1 vscode 허용 목록과 **정확히 일치**(빠진 것도 남은 것도 실패) ·
  R2 계층 의존 방향 · R3 런타임 순환 없음 · R4 테스트 파일 전부 index.ts 등록 · R5 package.json 이 선언·참조하는 명령이 전부
  `registerCommand` 됨(상수 ID 인식) · R6 코드가 읽는 `gpl.*` 설정 키가 전부 선언됨. 첫 실행이 `gplBuiltins → config` 위반을 잡아
  `ciEq` 를 `language/identifiers.ts` 로 옮겼다(호출부 7곳). `gplBuiltins` 조회 API 테스트 7건(bare 이름은 최상위 함수만 등).
⑥ **문서(이 커밋)** — `docs/development/architecture.md`(한 장 요약·계층 규칙 표·vscode 허용 목록과 이유·조립 순서·배치 기준·
  테스트 전략·부채 표) 신설 + mkdocs nav(+ mermaid custom fence), CLAUDE.md/AGENTS.md 읽기 순서·저장소 구조에 추가, 이 문서
  §4 경로 갱신(중복 항목 2개 정리), CHANGELOG 0.5.95 섹션 순서 정정, §1-CR 아카이브 이동, 로드맵 메모리 갱신.

방법: 파일 수정은 전부 스크립트(Python/Node) — 작업 트리에 CRLF/LF 파일이 섞여 있어(`core.autocrlf=true`) 파일별 EOL 을
보존했다. 정리 스크립트가 CRLF 파일에서 한 번 멈췄고(LF 가정), 그 뒤로는 EOL 감지 후 치환했다.

### 검증

- `npm test` 784 → **820/820**(신규 36: deployOutcome 11 · runtimeConsoleTreePresentation 8 · treeFormat 4 · gplBuiltins 7 ·
  architecture 6). tsc 무오류(엄격 플래그 5종 포함). MCP `node --test` 86/86(변경 없음). `mkdocs build --strict` 통과.
- 의존성 방향: language/project → controller 역방향 0건, `language/`·`util/` vscode import 0건, 런타임 순환 0 — 이제 테스트가 지킨다.
- **하지 않은 것**: Extension Development Host 실동작 — §3 의 §1-CZ 스모크 항목에 합쳤다. 실기기 확인은 불필요(제어기 통신
  코드·명령 문자열 무변경. 바뀐 것은 파일 위치·import·순수 함수 추출·컴파일러 플래그).

### 남은 일 / 다음 작업자에게

- §3 스모크(§1-CZ 항목) — §1-DB 변경도 같이 본다.
- §3 새 항목 "구조 정비 후속" ①~⑤(config.ts 언어 헬퍼 → language/, symbolCache 분리, 1403 문구 통일 결정, 트리 노드 생성 순수화,
  ESLint 여부). esbuild 번들 항목은 이제 착수 가능.
- 고위험(변동 없음): gplDebugSession 분해·deployLocked 단계 분리·runtimeConsole 상태 머신 — `architecture.md` §7 표.
- **규칙 바꾸는 법**: 계층/허용 목록을 바꾸면 `architecture.test.ts` 의 `ALLOWED_DEPENDENCIES`/`VSCODE_ALLOWED_MODULES` 와
  `architecture.md` §2/§3 을 같은 커밋에서 고친다. 테스트가 실패하면 "코드를 규칙에 맞출지, 규칙을 바꿀지"를 의식적으로 고른다.
- 동시 세션 주의: 착수 시 다른 세션(§1-DA)의 미커밋 작업 트리(코드 4 + 문서 4 + 신규 4 + 0바이트 잔여 1)가 있었다. 검증(784/86
  통과) 후 **그 세션 이름으로 분리 커밋**(9b79f1e)한 뒤 시작했고 잔여 파일은 지웠다 — 이 세션 커밋에 섞이지 않게. push 는 하지
  않았다(사용자 확인 뒤).

### 변경 파일 (요약 — 87 파일, 커밋 6개)

```txt
tsconfig.json · .editorconfig(신규) · README.md · docs/development/ai-controller-debugging-runbook.md
src/util/pathKey.ts(신규) · src/language/identifiers.ts(신규) · src/project/gprSync.ts(← controller/)
src/language/{gplParser,gplBuiltins,gplDictionaryData,gplStatements,symbolNameIndex,xmlUtils}.ts(← src/) · src/debug/launchJsonc.ts(← src/)
src/controller/deployOutcome.ts(신규) · src/views/treeFormat.ts(신규) · src/views/runtimeConsoleTreePresentation.ts(신규)
src/activation/deploy.ts(1,110 → 969) · src/views/controllerTreeProvider.ts(1,718 → 1,537) · src/controller/projectPickerCore.ts · src/config.ts
src/test/{architecture,gplBuiltins,deployOutcome,treeFormat,runtimeConsoleTreePresentation}.test.ts(신규) · src/test/index.ts
삭제: src/controller/controllerDiscovery.ts · scripts/dev-cycle.js
docs/development/architecture.md(신규) · mkdocs.yml · CLAUDE.md · AGENTS.md · docs/ai-handoff.md · docs/archive/handoff/2026-09.md · CHANGELOG.md
```

---

## 1-DC. 2026-09-10 세션 — 「업로드 스타트」가 제어기를 멈추게 하던 시퀀스 정정 + 배포 없이 붙는 attach 명령 (`gpl.debug.attachOnly`)

**증상(사용자 보고).** ① `GPL: 업로드 스타트`를 실행하면 **거의 확정적으로** 제어기가 응답을 잃는다.
`GPL: 빠른 컴파일`은 정상이다. 그래서 실사용은 `빠른 컴파일` → `GPL: Start` → 디버그 attach로 우회하고 있었다.
② 그런데 그 "디버그 attach"에 해당하는 버튼/명령이 보이지 않는다.

**원인 분석(코드 대조 — 실기기 재현은 아직).** 두 명령의 차이는 `deploy()` 옵션 3개뿐이다
(`activation/deploy.ts`의 `gpl.uploadStart` vs `gpl.quickCompile`).

| | 빠른 컴파일 | 업로드 스타트 |
| --- | --- | --- |
| `Stop -all` | 보내지 않음(`skipStop`, `Show Thread` 프로브만) | **보냄 — FTP 업로드와 동시 진행** |
| 마무리 | `Compile` | `Start`(= 제어기가 자체 컴파일까지 수행) |
| 원격 전용 파일 삭제 | 정지 확인 뒤 | 정지 확인 뒤 → **곧바로 Start** |

즉 업로드 스타트에서만 일어나는 일은 두 가지다. **㉠ `Stop -all` 처리(모션 abort·쓰레드 teardown) 중에
바로 그 쓰레드가 물고 있던 파일을 FTP가 덮어쓴다** — 병행 설계(§1-C의 UPLOAD ∥ STOP, 2026-08-25 이슈 #17)의
근거였던 "실행 중 FTP 업로드는 무해"라는 관찰은 **Stop을 보내지 않는** 빠른 컴파일 기준이라 이 조합은 검증 밖이었다.
**㉡ 정지 게이트 통과 직후 완충 없이 `Start`가 들어간다** — 게이트는 `Show Thread -web` 목록이 비면 통과인데,
`-752`(정지 진행 중) 뒤 제어기 내부 정리가 남아 있을 수 있고, 그 상태에서 들어가는 `Start`는 단순 실행이 아니라
**프로젝트 전체 컴파일 + 실행**이다. 빠른 컴파일 흐름에는 Stop 자체가 없고 Compile(수 초) + 사람이 Start를
누르기까지의 간격이 자연히 생긴다. ※ 이 둘은 **유력 가설**이며 실기기 재현으로 확정된 것은 아니다(§3에 검증 항목).

**조치 A — 업로드 스타트만 순차로 (`DeployOptions.stopBeforeUpload` 신설, `controller/deployService.ts`).**
`stopBeforeUpload: true`면 Phase 1을 `Promise.all([업로드, 정지게이트])` 대신 **정지 게이트 → 업로드** 순차로 돌린다.
정지가 확인되지 않으면 **업로드를 아예 시작하지 않고 중단**한다 — 제어기의 `/GPL` 사본을 손대지 않으므로
"실행 중이던 소스와 새 소스가 섞인" 상태가 생기지 않는다(병행 경로의 기존 문구 "업로드는 완료됨"과 구분된다).
단계 배너는 `[n/N] STOP → UPLOAD (순차)`, 잠금 stage는 `STOP` → `UPLOAD`. 옵션은 `activation/deploy.ts`의
`QuickDeployOpts`를 거쳐 `gpl.uploadStart`만 켠다 — 빠른 컴파일은 보낼 Stop이 없어 종전 병행 그대로다.

**조치 A2 — Start 직전 정지 재확인(`!skipStart` 공통).** START 단계 진입 시 `waitThreadsSettle()`을 한 번 더 돌려
활성 쓰레드가 남아 있으면 `failedPhase: 'START'`로 중단하고 `Start`를 보내지 않는다(무응답은 종전 규약대로 확인 불가 → 통과).
게이트 통과 후 업로드·원격 삭제·Compile로 수십 초가 흐르므로 **그때의 판정을 그대로 믿지 않는다**는 것이 요지다.
`Deploy & Run` 경로에도 같이 적용된다(읽기 전용 `Show Thread` 한 번이라 비용은 무시할 수준).

**조치 B — `gpl.debug.attachOnly` 신설(`activation/connection.ts`).** 기존 `gpl.debug.attachNow`는
`deployBeforeAttach: true`라 attach 전에 업로드+Compile을 다시 돌리고, 활성 쓰레드가 있으면
"Stop -all 하고 계속할까요?" 모달이 뜬다 — **이미 Start 해 둔 프로그램에 붙는 용도로는 쓸 수 없다**(승인하면 그 프로그램이 멈춘다).
사용자의 실사용 흐름(빠른 컴파일 → Start → 붙기)에 맞는 경로가 없었던 것이다. 두 명령의 본체를
`startQuickAttachSession({ deployBeforeAttach })` 하나로 합치고, attach-only 쪽은 `stopAllBeforeAttach: false`·
`stopOnEntry: false`로 **Stop도 Start도 보내지 않는다**(제어기 잔재 BP 정리는 세션 기본값 `clearProjectBreakpointsOnAttach`가 담당).

**조치 B2 — 발견성.** 명령 제목이 이것만 영어(`GPL: Quick Debug Attach (No launch.json)`)라 팔레트에서 `GPL: 디버그`로
검색하면 걸리지 않았고, 버튼도 패널 제목의 `···` 오버플로(`2_debug@1`)에만 있었다. 제목을 한국어로 바꾸고
(`GPL: 디버그 시작 (배포 후 붙기, launch.json 불필요)` / `GPL: 디버그 붙기 (배포 없이 실행 중인 프로그램에 attach)`),
attach-only는 패널 상단 `navigation@4`에 플러그 아이콘 버튼으로 올렸다.

**조치 B3 — `gpl.ai.debugAssist`의 `build-and-attach`.** 바로 위에서 `gpl.deploy`(Build Only)가 성공한 뒤인데
`attachNow`를 불러 같은 업로드+Compile을 한 번 더 돌리고 있었다 → `attachOnly`로 교체.

**조치 C — 원인을 가려낼 TEST 경로(`gpl.uploadStart.test`, 사용자 요청).** 기본 경로가 가설 ㉠·㉡을 둘 다 막아 버리면
**무엇이 실제 원인이었는지 알 수 없다.** 그래서 안전장치를 하나씩 켜고 끄는 조합을 QuickPick으로 고르는 진단 명령을 두고,
패널 상단에 비커 아이콘 버튼(`navigation@5`)으로 올렸다. 조합은 A(둘 다 끔=변경 전 재현) / B(순차만) / C(Start 직전 재확인만) /
D(둘 다=현재 기본) 넷이고, 고른 조합은 배포 트레이스 머리에 `⚗ TEST X — …`로 남아 나중에 로그만 봐도 구분된다.
이를 위해 `DeployOptions`에 `preStartSettleCheck`(기본 true, false는 진단용)와 `modeNote`(동작 무영향 메모)를 더했다.
**실기기에서는 저속/시뮬레이션으로만 실행할 것**(Start를 보낸다 — 하드 규칙 6).

**조치 D — 빌드 계열 완료 후 `GPL Console`로 포커스를 뺏지 않는다(사용자 지적).** 「빠른 컴파일」·Build Only가
성공하면 `consoleChannel.show(true)`로 **GPL Console**이 튀어나와, 방금 본 업로드/컴파일 진행 로그
(`GPL Language Support`)가 가려졌다. 실행하지 않은 경로에서 1403 런타임 출력으로 넘어갈 이유가 없으므로
완료 문구를 `host.log`로 같은 채널에 남기고 `outputChannel.show(true)`로 그 자리를 유지한다
(`activation/deploy.ts` 성공 처리 `skipStart` 분기). 1403 연결 자체는 종전대로 유지한다 — **포커스만** 바꾸지 않는다.
`Deploy & Run`·`gpl.start`처럼 실제로 실행하는 경로는 런타임 출력이 콘솔에 나오므로 종전대로 콘솔을 띄운다.

**발견 → §1-DD 에서 조치 — `Stop -all` + 정지 완료 확인이 한 곳으로 묶여 있지 않았다.** 사용자 질문("안전장치 경로가 하나로 묶여 있냐")을
확인한 결과 **5곳이 각자 구현**이고 기준도 제각각이다: ① `deployService.stopAllAndSettle`(무응답 1회 재전송 + 8초·500ms 폴링 +
Stop 재시도 1회) ② `gpl.controller.stopAll`(busy 재시도 5회 + `verifyAllStopped(8)` + SoftEStop 복구) ③ `ftpCommands`의 폴더 삭제
게이트와 ④ `ftpCommands.ensureStoppedBeforeCompile`(②와 같은 조합, 실패 시 throw) ⑤ **`gplDebugSession`의 attach preflight·
`stopAllOnDisconnect` — 정지 완료 확인이 아예 없다**(응답 문자열 유무/STATUS 0 정규식만 보고 "완료" 로그). settled 상태 집합도
`controller/threadActivity.isSettledState`와 `activation/controllerOps.SETTLED_THREAD_STATE`로 이중화돼 "동일하게 유지할 것"이라는
주석에 의존했다. 별도로 `commandPolicy` R2(Stopping 정착 대기)는 성격이 다른 사전 게이트다. → **§1-DD 에서 통합했다.**

**검증.** `npm run compile` 통과, `npm test` **820/820**(구조 R5 "package.json 명령 ↔ 소스 등록" 포함).
**실기기 검증은 하지 않았다** — `Stop`·`Start`를 보내는 경로라 저속/시뮬레이션 확인이 필요하다(하드 규칙 6, §3 항목).

**남은 일.** §3의 「업로드 스타트」 검증 항목을 이번 변경 기준으로 갱신했다(순차 순서·중단 지점·attach-only 버튼).
가설 ㉠/㉡ 중 무엇이 실제 원인이었는지는 실기기에서 Deploy 트레이스로 확인해야 한다 — 만약 순차 변경 후에도
재현되면 남는 용의자는 **정지 직후의 `Start`(㉡) 쪽**이다.

---

## 1-DD. 2026-09-10 세션 — 제어기 조작 절차를 API 한 겹으로 묶기 (1): 쓰레드 정지 정본 + 중복 절차 전수 조사

**배경(사용자 요청).** §1-DC 조사에서 "전체 정지 절차가 5곳에 각자 구현돼 있다"가 드러나자 사용자가 방향을 정했다 —
*"제어기 자체 기능이 부실해서 제어기 기능을 우리가 한 번 더 API 처럼 묶어 사용해야 한다."*

요지는 이렇다. 제어기의 원시 명령은 **안전한 단위가 아니다.** `Stop -all` 은 정지 *요청 접수*까지만 보장하고,
실제 정지는 `Show Thread` 로 따로 확인해야 하며, `-752` 는 실패가 아니라 진행 중이고, 안 멈추면 재시도해야 한다.
즉 "프로그램을 멈춘다"라는 **하나의 안전한 동작**은 명령 하나가 아니라 *전송+판정+폴링+재시도+실패 처리* 절차 전체다.
그 절차를 호출부마다 다시 조립하니 어떤 곳은 폴링을 빠뜨리고 어떤 곳은 재시도 횟수가 달랐다. §1-DB 의 계층 리팩터링이
*파일 배치*를 정리한 것이라면, 이것은 *제어기 조작 절차*를 정리하는 같은 성격의 작업이다.

**조치 1 — `controller/threadStop.ts` 신설(vscode 무의존, 주입형 IO).**
호출부는 전송·로그·대기(`ThreadStopIo`)만 주입하고 절차는 이 모듈이 갖는다.

- `probeThreads` — `Show Thread  -web` 1회. **STATUS 종결자를 못 받으면 `null`(확인 불가)** 로 빈 목록과 구분한다.
- `waitThreadsSettle` / `waitThreadSettle` — 정지 확인 폴링. 대상 선택자만 다른 공통 루프(`waitSettleFor`)를 쓴다.
- `sendStop` — 정지 명령 1회(무응답 재전송). `0`=접수 / `-752`=진행 중(비치명) / 그 외·STATUS 없음=실패.
- `stopAllAndSettle` / `stopThreadAndSettle` — 전송 → 확인 → 미확인 시 자동 재시도(기본 2회).
- 결과에 **`unconfirmed`** 를 실어 "확인 불가"를 정지로 위장하지 않는다 — 배포는 통과, 원격 삭제·Load/Compile 은
  중단이라는 **정책 차이를 호출부가 고르게** 한다(종전에는 그 차이가 우연이었다).
- 가짜 IO 로 시나리오를 고정한 단위 테스트 **17건**(`src/test/threadStop.test.ts`) — 가상 시계라 실제로 기다리지 않는다.

**조치 2 — 5곳을 이 모듈로 통합.** ① `deployService`(정지 게이트·Start 직전 재확인) ② `controllerOps.stopAllThreads`
(패널 「전체 정지」·FTP 삭제 게이트·FTP Run 전 정지) ③ `gplDebugSession`(attach preflight·`stopAllOnDisconnect`).
**디버그 세션 두 곳은 정지 확인이 아예 없었다** — attach preflight 는 응답 문자열이 있기만 하면 "완료"로 로그했다(§0.6 위반).

**조치 3 — 개별 정지도 같은 절차로.** 트리 「쓰레드 정지」와 FTP 「중지」에 line-for-line 같은 코드가 두 벌 있었다
→ `controllerOps.stopThreadWithRecovery`(Stop → 확인 → 실패 시 SoftEStop 제안 → 트리 갱신) 하나로.

**조치 4 — 상태 판정 단일화.** settled 집합이 `controllerOps.SETTLED_THREAD_STATE` 에 복제돼 "동일하게 유지할 것"이라는
주석에 의존하고 있었고, 일시정지 집합(`Paused/Break/Error`)도 `controllerOps.AI_PAUSED_STATES` 와
`controllerTreeProvider.PAUSED_STATES` 두 벌이었다. 모두 `threadActivity` 의 `isSettledState` /
`isPausedState`·`PAUSED_THREAD_STATES` 로 모았다. `waitForThreadPause` 가 **잘린 응답을 "쓰레드 없음"으로 읽던** 문제도
`probeThreads` 경유로 고쳤다.

**조치 5 — 무검증 성공 보고 2건(하드 규칙 2 위반) 수정.**
① `gpl.controller.ftpUnload` 는 응답을 보지 않고 무조건 "Unload 완료"를 띄웠다 — 쓰레드가 살아 있어 거부돼도(-750) 성공으로
보고했다. 이제 STATUS 로 판정하고 "로드 안 됨"과 "쓰레드 정지 필요"를 구분해 안내한다.
② `gpl.controller.threadStart` 는 STATUS 를 보지 않고 트리만 새로고침해 거부돼도 아무 말이 없었다.

**검증.** `npm run compile` 통과, `npm test` **837/837**(구조 R1~R6 포함). 커밋 2개(`865fb26`, `f05b5fa`).
실기기 검증은 미수행 — 정지 경로가 바뀌었으므로 §3 항목으로 남긴다.

**전수 조사 결과(다음 단위 후보).** 같은 성격의 중복이 아직 8건 남아 있다. 위험/가치 순으로:

| # | 절차 | 지금 어디에 흩어져 있나 | 핵심 불일치 |
| --- | --- | --- | --- |
| 1 | `Compile` | `deployService.tryCompile`(+재시도·복구) · `ftpCommands.tryCompile` · MCP | transient 재시도가 `-742/-746/-752` vs `-746` only vs 없음, 후보 이름 순회 유무, 진단(Problems) 연동 유무 |
| 2 | `Load`/`Unload` | `deployService`(HTTP 응답 감지·`-750` 락 규칙 있음) · `ftpCommands`(코드 하드코딩) | 상태 코드 헬퍼 vs 리터럴, 비차단 STATUS 취급 |
| 3 | `Start` | `deployService` · `deploy.gpl.start` · `gplDebugSession` · `ftpCommands`(**`-event` 없이 손으로 조립**) · `treeCommands`(쓰레드 Start) | 모션 확인 모달·정지 게이트·STATUS 검증이 경로마다 다름 |
| 4 | `Show Thread` 열거 | 10곳 | "잘린 응답" 정책 3종(확인 불가 / 빈 목록 / `includes('<STATUS>')`) |
| 5 | 중단점 명령 | `breakpointCommand` · `breakpointSync` · `gplDebugSession._sendBpCommandWithFallback`(4가지 표기 폴백) · MCP | 폴백은 DAP 에만 있고, `_clearBreakpointsForProject` 는 STATUS 를 안 본다 |
| 6 | busy 재시도 | `controllerOps.sendCommandWithBusyRetry` · `deployService` · `ftpCommands` · `commandPolicy` R2 | 정책 4종이 겹쳐 실효 타임아웃이 곱해진다 |
| 7 | 스택/정지 위치 조회 | `gplDebugSession._fetchThreadFramesUncached` · `treeCommands.threadShowLocation` · `controllerCommands` | 캐시·폴백 유무 |
| 8 | 원격 경로 선택 | `deployService.chooseRemoteProjectPath` · `ftpCommands.resolveFtpRunPath` | 점수 가중치가 달라 **같은 프로젝트에 다른 폴더를 고를 수 있다** |

다음 단위는 **`controller/projectCommands.ts`**(compile/load/unload/start를 같은 주입형 IO·구조화 결과로) 를 권한다 —
1·2·3 을 한 번에 없애고, ③의 `-event` 누락 같은 조용한 차이도 사라진다. 다만 배포 파이프라인의 심장부라
별도 세션에서 테스트를 먼저 깔고 들어가는 편이 안전하다(§3).
