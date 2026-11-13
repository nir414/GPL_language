# AI 인계 자료 — GPL Language Support 확장 작업 핸드오프

- **최종 갱신: 2026-11-13** · 현재 package 버전 **0.27.18** (시뮬 제어기 실기 시험으로 찾은 디버깅·배포·진단 문제 수정, 1759/1759 · MCP 213/213. 상세는 §1-HH.)
- **직전 세션: §1-HH** — "192.168.0.1 시뮬 제어기에 연결해 테스트하며 개선" → App 정지·Unload(사용자 동의) 뒤 시험 프로젝트로 배포·BP·스텝·변수·전처리 점검. `Exit Property` -719·`:` -722 진단, 호출자 프레임 줄 복원, listLocals 대체, NUL 오판, ErrorLog 이번 배포분, FTP 시각 수정. 새 MCP 응답·DAP 스택 줄은 실기 재확인 전(verification §1-HH). /GPL 에 시험 폴더 남음.
- 대상 저장소: `C:\Users\Doyun\Documents\GitHub\GPL_language` (VS Code 확장 `nir414.gpl-language-support`)
- 테스트 대상 프로젝트: `C:\SVN\pa\trunk\develop\07. Others\37. 핵산 Oligo 합성과제\시뮬레이션\projects\MergeCode` (65 파일)
- 제어기: G2400C, GPL 4.2K5, `192.168.0.1` (명령 1402 / 런타임 콘솔 1403)

## 이 문서 읽는 법

| 순서 | 섹션 | 내용 |
| --- | --- | --- |
| 1 | [§0 하드 규칙](#0-반복-실수-방지--하드-규칙-다음-작업자-필독) | 반복된 실수를 막는 규칙. **작업 전 필독** |
| 2 | [§2 미결](#2-진행-중--코드-쪽-미결-사용자-결정-대기) | 사용자 결정을 기다리는 항목 |
| 3 | [§3 다음에 할 일](#3-다음에-할-일-체크리스트) | **다음 작업은 여기서 고른다** (코드 작업·결정 대기) |
| 4 | [§4 핵심 파일](#4-핵심-파일) | 소스 지도 — 필요할 때 |
| 5 | [§5 참고](#5-참고--정상-컴파일-응답-형식-gde-verbatim-2026-06-30) | 정상 컴파일 응답 원문 — 필요할 때 |
| 6 | [§1 세션 이력](#1-세션-이력--최근-세션--전체-인덱스) | 최근 10세션 본문 + 인덱스 — 배경을 찾을 때 |
| — | `docs/ai-handoff-verification.md` | 새 VSIX 실사용·실기·UI 확인 대기 목록 — 사용자가 확인할 때 |
| — | `docs/archive/handoff/index.md` | 아카이브된 세션 인덱스(§1-A ~) — 옛 §1-XX 를 찾을 때 |

> **섹션 번호는 바꾸지 않는다.** `§0`·`§1-XX`·`§3-B`·`§4`는 소스 주석(`deployService.ts`,
> `controllerConnection.ts` 등), `AGENTS.md`, 런북, `package.json` 설정 설명에서 참조한다.
> 대신 **물리적 순서만** 읽는 순서에 맞췄다 — 분량이 큰 §1 세션 이력을 뒤로 뺐다.

> **이 문서를 갱신하는 규칙**은 `docs/development/record-keeping.md`에 있다(요약: `AGENTS.md` §6).
> 헤더는 **직전 세션 1건만**, §1 본문은 **최근 10세션**만(넘치면 월 아카이브로, 인덱스 행은 `archive/handoff/index.md`로),
> §3에는 코드 작업·결정만 두고 실사용 확인 항목은 `ai-handoff-verification.md`에, 완료 항목은 지운다.

---

## 0. 반복 실수 방지 — 하드 규칙 (다음 작업자 필독)

세션이 넘어가며 같은 실수가 반복됐다. 아래는 반드시 지킨다. (상세: `.github/instructions/gpl-ai-controller-debugging.instructions.md`)
번호는 `AGENTS.md` §4 요약과 1:1이고 소스 주석·CI 설정이 "하드 규칙 N"·"§0.N"으로 참조하므로 바꾸지 않는다 — 새 규칙은 끝에 붙인다.
(옛 CLAUDE.md 요약은 모션 규칙을 6번으로 적어 이 목록의 6과 엇갈렸다. 2026-11-04 에 모션 규칙을 9로 편입하고 소스 주석을 고쳤다.)

1. **로그 파일을 실시간 상태/통신 채널로 쓰지 않는다.** `Compile.log`, `Robot.log` 등은 사후 기록용이다. 현재 컴파일/실행/연결 상태는 오직 1402 명령의 **live 응답**(`<STATUS>`/에러 라인)과 1403 스트림으로만 판단한다.
2. **작업 성공/실패는 그 명령 자신의 `<STATUS>`로만 판정한다.** 응답을 종결자 `</STATUS>`까지 끝까지 읽는다. `Show Thread`가 응답한다거나 `pass 1/2/3` 로그가 보인다는 식의 **간접 신호로 성공을 추정 금지**.
3. **단정 전에 live 데이터/소스를 확인한다.** "Build Only인지 F5인지"는 채널/세션(`[GPL Debug]` 접두어, 디버그 툴바)으로 구분. attach 시작 조건 등 동작은 추측 전에 소스를 읽는다.
4. **환경 주의 — 리눅스 샌드박스(Cowork 등)에서 작업할 때만 해당한다.** Windows에서 직접 도는 Claude Code·Codex 에는 해당하지 않는다. 그 샌드박스는 **방금 수정한 파일을 잘린(truncated) 상태로 읽어** `tsc`가 가짜 문법 오류(`Invalid character`, `')' expected` 등 파일 끝부분)를 낸다. **이는 코드 오류가 아니다.** 검증은 반드시 사용자 로컬에서 `npm run compile`로 한다. 호스트 파일은 정상이다.
   - 2026-07-03 추가: 반대 방향 문제도 확인됨(호스트 도구로 쓴 파일이 샌드박스에서 잘리거나 NUL 패딩으로 보임). **파일 수정을 샌드박스 bash(heredoc/python)로 수행하면 양쪽이 일관된다.**
5. **하위 프로젝트 `npm install`은 Windows에서만 실행한다.** 리눅스 샌드박스/WSL에서 실행하면 `node_modules/.bin`에 유닉스 심볼릭 링크가 생기고, Windows의 `vsce package`가 `EACCES: permission denied, scandir ...`로 죽는다(2026-07-03 실제 발생, §1-C). `scripts/package.js`의 preflight가 이를 감지해 준다.
6. **`Stop -all`의 STATUS 0은 "정지 요청 접수"이지 정지 완료가 아니다.** 정지 완료 전에 `Compile`/`Start`를 보내면 제어기 이상 현상(메모리 누수 의심, 2026-07-08 사용자 관찰, §1-G)이 발생할 수 있다. Compile/Start 전에는 반드시 `Show Thread`로 모든 쓰레드가 Idle/Stopped/Error임을 확인한다. `deploy()`에 게이트가 구현돼 있으니 우회 경로를 만들지 말 것. (2026-08-28 §1-BN: 명령 정책 R2가 `sendCommandDetailed`에서 **모든 경로**의 Start/Compile/Load/Unload 앞에 `Stopping` 쓰레드 정착을 기다리므로 우회 경로가 생겨도 이 조건은 유지된다 — Running 쓰레드는 막지 않음.)
7. **PA 제어기의 `Start`는 스위치 없이는 컴파일하지 않는다 — `-compile`을 반드시 붙인다(2026-09-10 사용자 실기 관측, §1-DN).** `-compile` 없이 `Start`하면 제어기는 컴파일하지 않고 **직전에 컴파일돼 있던 바이너리를 그대로 실행한다** — FTP로 `/GPL`에 올린 새 소스가 반영되지 않는다. 캡처(`captures/gde_1402.pcapng`)의 GDE도 `Load /flash/projects/GPL_Code → COMPILE Test_robot → Start Test_robot -event` 순으로 **Start 앞에 명시적 `COMPILE`을 따로 보냈다**. ~~옛 규칙: "Start가 자체적으로 Compile을 수행한다(2026-08-25 명시)"~~ — 그 캡처의 `-event`만 보고 내린 오독이었고 **무효**다. 확장은 `startCommand.buildStartCommand`가 `-compile`을 기본으로 붙여 보장한다(`compile: false`를 명시할 때만 뺀다). **여전히 유효한 함의: Compile 직후 Start를 연속으로 보내지 않는다(컴파일 중복) — 한 번에 하나만.** (2026-08-28 §1-BN: 명령 정책 R3이 같은 프로젝트의 Compile 응답 완료 뒤 `gpl.controller.startAfterCompileGapMs`(기본 1.5 s) 완충을 두고 Start를 보낸다 — 안전성 미검증이라 거부가 아닌 완충.) Deploy는 Compile까지, 실행은 `GPL: Start`가 별도. "컴파일 검증 필요" 상태는 아직 별도 Compile 성공을 확인하지 못했다는 뜻이며, Start `-compile`이 실패하면 §1-EW부터 에러 위치를 Problems에 표시한다.
8. **제어기 채널은 번호가 아니라 이름으로 부른다 (2026-09-22 사용자 결정, §1-EB).** `1402`·`1403` 은 번호를 외운 사람에게만 뜻이 통한다 — 사용자 대면 문구(트리·알림·명령 제목·설정 설명·보고서)와 AI 대면 문구는 **명령 콘솔**·**런타임 콘솔**·**FTP** 로 쓴다. 번호는 ① 설정 값 ② `ip:port` 엔드포인트 ③ 원인을 가리는 진단 상세에서만 덧붙인다(`명령 콘솔(1402)`). 용어 정본과 헬퍼는 `controller/protocol/channelNames.ts`, 명령 제목은 구조 테스트 **R8** 이 지킨다. 그대로 두는 것: 로그 태그(`[1402]`·`[Console][RC1403]`)·설정 키(`keepAlive1402`)·포트가 주제인 프로토콜 문서(`docs/reference/console-commands.md`)·과거 기록(CHANGELOG·아카이브).
9. **모션·하드웨어에 영향을 줄 수 있는 변경은 저속/시뮬레이션 검증 없이 적용하지 않는다.** 자동 `Start`, 브레이크포인트 명령 형식, Step·Jump to Cursor, Set DIO 같은 것이 해당한다. 미적용 권고는 §3-B, 실기 확인 항목은 `ai-handoff-verification.md`(항목 제목의 모션 표기를 먼저 본다). (2026-11-04 §0 편입 — 그전에는 CLAUDE.md 요약에만 있었다.)
10. **`/flash/projects`는 비우기·삭제 대상으로 제안조차 하지 않는다 (2026-11-03 사용자 지적).** "flash GPL 비우기"라는 말은 `/GPL`을 뜻한다. flash 영구 저장(`gpl.saveToFlash`)은 AI 가 하지 않는다 — 확장이 `aiCommandPolicy.ts` 로 거부한다(`AI_BLOCKED`, 2026-09-07 사용자 결정). 확장의 /GPL 비우기도 대상이 /flash·루트면 거부한다(`classifyRemoteClearRoot`, §1-GR).

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

> **실사용·실기·UI 확인 항목은 `docs/ai-handoff-verification.md`로 옮겼다(2026-11-04).** 이 절에는 코드 작업과 결정 대기만
> 둔다. 새 VSIX의 확인 항목은 그 파일에 추가한다(규칙: `docs/development/record-keeping.md`).

- [ ] **(2026-11-13, §1-HH) 실기 시험 후속.** ① Running 쓰레드의 `Show Thread` 줄도 "다음 문장" 줄로 나온다(`Thread.Sleep` 12 → 13 `End While`) — 트리·대시보드 위치 표시에 `callSiteLine` 식 보정을 넣을지(정지 쓰레드는 정확) ② `callSiteLine` 을 라이브러리 소스(`<lib>/<file>`)·원격 소스 세션에서도 확인 ③ `Exit Property`·`:` 구분을 docs/gpl-language/common-mistakes 에 실측표로 ④ 문서와 다른 실측(Exit Property, 이름 없는 Show Variable)을 다른 펌웨어에서 재확인할 기회가 있으면 기록.
- [ ] **(2026-11-13, §1-HG) 수신함 보류 — 다음 작업 후보.** 원문은 수신함 `done/` 의 같은 이름 파일.
  ① 라이브러리 버전 v2 #8 배포 묶음 내보내기(`GPL: Export Deployed Bundle` — §1-HG 의 `libraries` 출처·해시 위에) ② #4 라이브러리 두 판의 Public 선언 차이 목록 ③ #5 고정 external 안 파일 편집 경고 ④ #6 `.gpr` 지시문으로 형제 밖 라이브러리 경로
  ⑤ #7 같은 제어기에 다른 판 라이브러리 함께 로드 가능 여부(실기 — 사용자 동의) ⑥ `-729` 안내에 "원격 /GPL/<lib> 는 다른 출처에서 올라왔다"(preflight `previousUpload` 활용)
  ⑦ `gpl.controller.expectedSerial` 을 MCP 로 전달(지금 MCP 는 env `GPL_EXPECTED_SERIAL` 만 — presence 에 싣는 방안) ⑧ `thread-entry-without-catch` 를 다른 파일 진입점·`ProjectStart` 까지(심볼 인덱스)
  ⑨ 잠금 Acquire 뒤 예외 경로 해제 누락 린트(binder #3) ⑩ ~~스택 열 순서 실측~~ — §1-HH 에서 확인(가운데 = stack_size).
- [ ] **(2026-11-06, §1-HE) 최적화기 다음 후보 — 실기 결과를 본 뒤.** ① ~~빈 껍데기 Module 비우기~~ — §1-HF 에서 구현
  ② 실행 프로젝트 자신의 안 쓰는 선언(지금은 라이브러리만 — 앱 코드는 사용자 책임 영역이라 옵션 분리) ③ Const 값 치환 후 선언 제거(Const 150~205 B, 식 안 리터럴 비용 미실측)
  ④ 클래스 멤버 형 추론(지금은 `obj.n` 이면 이름이 같은 모든 클래스의 `n` 을 남김 — 정밀도 향상 여지).
- [ ] **(2026-11-06, §1-HD) 배포 전처리 보류 — 결정·실기 근거 필요.** ① 컴파일 뒤 `/GPL` 소스 비우기(`upload-start` 선택지, 수신함 strip-purge §2):
  비운 뒤의 Start 는 하드 규칙 7(`-compile` 필수)과 충돌한다 — `-compile` 없는 Start 를 허용할지 사용자 결정, 그리고 소스 없이 런타임 오류 file:line·Show Stack·BP 가 맞는지 실기 확인이 먼저.
  ② ~~멤버 단위 미사용 제외~~ — §1-HE 에서 `removeUnusedMembers` 로 구현(실기 확인 대기).
  ③ 제어기 프로젝트 보기(`remoteSourceSession`)로 /GPL 을 열면 전처리 사본(주석 없음)이 보인다 — 표시가 필요하면 `lastCompiledFrom.preprocess` 로 안내.
- [ ] **(2026-11-05, §1-HC) 수신함 보류 항목 — 설계·결정 필요.** 원문은 수신함 `done/` 의 같은 이름 파일.
  ① `read_remote_file`(허용 목록 읽기 전용 FTP, debug-day §4) ② 바닥 여유 메모리 추적(`bootFloorMb`·`lostSinceBootMb`·경고, memory-floor-leak)과
  배포 결과 `postStartFreeMb`(perf §3)·부팅 이후 배포/Unload 사이클 수(debug-day §6) ③ `runtime_console_measure`(두 패턴 지연 짝짓기, perf §2)
  ④ ~~`Show Thread -stack` 크기~~ — §1-HG 에서 `stackUsage`(선택 조회) ⑤ CPU Monitor(`/cpu_mon.pcm` 웹 핸들러 — 제어기 HTTP 경로가 없어 채널 정책 결정 먼저, perf §1)
  ⑥ 정지→비우기→Unload 한 번에 하는 도구/`deploy_project` 옵션(cmd-thread v2 §4) ⑦ 제어기 사용 표시(lease)·`controller_status` 에 마지막 상태 변경자(debug-day §1-2·3)
  ⑧ 폴링 대기 정보 진단·`waitevent-loop`/`sendevent-wake` 스니펫·코딩 가이드(coding-guidance) ⑨ `As Object` -734 진단, 초기값 없는 모듈 `String` 필드 `Len()`/`&` 경고(debug-day §5b)
  ⑩ 에디터 live-sync(`breakpointSync`)도 라이브러리 소스를 `breakpointSendTarget` 으로 보낼지.
- [ ] **(2026-11-04, §1-GZ) 리뷰 후속 — 남은 코드 작업.** ① `@vscode/vsce` 2.x → 최신 메이저(개발 의존 취약점 5건 — `npm audit`; 패키징 경로라 `npm run package:no-bump` 로 검증)
  ② 디버그 폴 중 `_handleBreakpointStop`/`_resolveStopReasonForThread` 예외 시 pending 만 비워지고 StoppedEvent 가 유실되는 경로(리뷰 D6, 낮음) — 쓰레드별 처리를 try/catch 로
  ③ `setBreakPointsRequest` 파일별 직렬화(§1-GZ)의 회귀 테스트 — 겹친 요청 R1(lines=[10])·R2(lines=[]) 뒤 제어기에 BP 가 남지 않는지
  ④ basic-ftp 6 의 `allowSeparateTransferHost:true` — 실기에서 PASV 주소가 접속 IP 와 같으면 지운다(`ftpClient.createClient`).
- [ ] **(2026-11-04, §1-GY) 실사용 확인 대기 117건 정리 — 사용자 결정.** `docs/ai-handoff-verification.md` 의 08~09월 항목은 이미 실사용으로 확인됐거나
  이후 변경으로 무의미해졌을 수 있다. 사용자와 한 번 훑어 확인된 것·무의미한 것을 지우고, 문제로 남은 것만 이 절에 코드 작업으로 올린다.

- [ ] **(2026-10-28, §1-GL) ProjectName = 폴더 이름 — 결정·실기 확인.** ① BinderR4 리프·그룹 42개를 Quick Fix 로 고칠지(일괄은 .gpr 마다 「모두 고치기」) 사용자 결정 ② 고치면 `Data`(Gantry\Data·Lib\Data)·`Cmd`(Lib\Motion\Cmd·Lib\Robot\Cmd) 가 겹친다 — 폴더를 `GantryData`/`MotionCmd` 처럼 바꿀지(그러면 이 폴더를 가리키는 ProjectLibrary 경로·루트 ProjectSource 도 함께) 결정 ③ 라이브러리 ProjectName 이 폴더와 다를 때/겹칠 때 제어기 Compile·Start 가 실제로 어떻게 되는지는 미확인 — 바꾼 뒤 `Compile BinderR4` STATUS 로 확인.

- [ ] **(2026-10-22, §1-FK) 구조 개편 후속.** 0.14.3의 F5 활성화·정의/참조·완성·호버·워처 갱신을 확인한다. 다음 코드 작업은 GPLDebugSession의 중단점·변수·실행 제어·폴링 객체 합성이며, 전체 순서는 `docs/development/architecture.md` §2.3을 따른다. 연결·배포·디버그 실행 순서 변경은 별도 안전 시험에서 검증한다.

### 명령 UI — 남은 결정

- [ ] **`Send Command`·`Copy Situation`·`Reset Panel Layout` 을 트리로?** 사용자는 "패널에서 고를 수 있잖아"
      라고 했지만 **대조 결과 이 셋은 트리 항목이 없다** — 그래서 `···` 에 남겼다. 트리에 넣을 자리를 만들지 결정 필요.

열린 항목만 둔다. 완료된 항목은 `docs/archive/handoff/2026-08.md` §부록으로 옮겼다(2026-08-31 정리).

- [ ] **(2026-10-14, §1-EQ, 34-sample-prep-3f ⑩) 제어기/PC 시각 오프셋.** ErrorLog 시각(16:54:22)과 확장 이벤트 시각(16:59:15)이 약 4.5분 어긋난 채 오류 상세 보기에 섞인다 —
  연결 시 한 번 오프셋을 측정해(ErrorLog 최신 항목 vs PC 시각, 또는 시각 DataID 가 있으면 그것) "제어기 시각(PC 환산 hh:mm)" 으로 병기할지 결정. 측정 명령은 실기 확인 필요.
- [ ] **(2026-10-19, §1-ET) 런타임 콘솔 Live Log 시작 결과 표시 — 실기 확인(조회만, 모션 무관) + 원인 확정.** 새 VSIX 로
  ① 명령 콘솔 미연결 상태에서 「Start Live Log Terminal」 → 터미널 첫 두 줄(대상 `ip:1403`, 「GPL: Connect」 안내)과 결과 토스트(소켓 연결/수신 확인/연결 거부)
  ② 제어기 LAN 을 뽑은 상태에서 같은 명령 → `[1403] --- ERROR …` 뒤 error 토스트에 사유, 재연결 백오프 중 다시 실행하면 즉시 CONNECT 가 나가는지
  ③ 명령 콘솔 유실 알림 뒤 「GPL: Connect」만으로 런타임 콘솔이 함께 켜지는지(`finishConnect` → `ensureRuntimeConsole`)
  ④ Sample Prep 보고 v3(새 창 Traffic `[1403]` 줄)가 오면 §1-ET 의 후보 ①②③ 중 하나로 확정하고 필요하면 `runtimeConsole.ts` 정책을 손본다.
- [ ] **(2026-09-18) package.json 버전 역행 정리 — 사용자 결정.** 커밋된 버전은 09-10 이후 0.9.1 그대로이고 `npm run package` 의 bump 는 작업 사본에만
  쌓였다(0.9.9 까지 빌드·설치됨, 번들 스탬프 `v0.9.9 33fede3 2026-09-11T00:54Z`). 09-11 09:54~10:47 사이 작업 사본이 0.9.1 로 되감겨(메커니즘 미확정 —
  `git checkout`/stash 류 또는 동시 세션 추정) 이후 0.9.2~0.9.4 가 **재사용**됐다. 제안: ① `package.json`·`package-lock.json` 을 0.9.10 으로 올리고 그 bump 를
  커밋에 포함 ② `scripts/package.js` preflight 에 "설치된 확장 폴더/`git tag` 최고 버전보다 낮으면 중단" 검사 ③ 패키징 후 버전 변경을 세션 커밋에 담는 기록 규칙 한 줄.
- [ ] **(2026-09-21, §1-EA) `upload-start` 브리지 응답 240 s 타임아웃 vs 작업은 2초 만에 COMPLETED.** MCP `deploy_project(mode:"upload-start")`
  두 번째 호출이 `BRIDGE_REQUEST_TIMEOUT` 으로 돌아왔는데 `operation_status` 는 `upload_start-…-3 COMPLETED · 2초`. 첫 호출(-742 실패)은 17초에
  정상 응답. 응답 파일 전달이 빠진 경로를 찾을 것(요청 id `1789970243410-20216-17-gwvuxc`, 확장 pid 25164).
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

- [ ] **(2026-09-18, §1-DW) `gplParser.ts` 의 `Type … End Type` 분기 제거 검토.** GPL 공식 Statement Dictionary 에
  `Type` 문이 없다(2026-09-18 디렉터리 열거). 사용자 실제 코드에 `Type` 선언이 있는지 확인한 뒤, 없으면 파서 분기와
  `gplReservedWords.ts` 의 `type`·`enum`·`inherits`·`implements`·`with` 항목을 정리한다 — **있으면 그대로 둔다**
  (문서에 없지만 동작하는 사례가 있으므로 §0.3 대로 실물 확인이 먼저다).

- [ ] **(2026-09-10, §1-DM) 「제어기가 죽는다」 재현 실험 — `Read()` 블록 상태를 만들어 놓고 배포.**
  **모션 없이 할 수 있다**(수신 대기만 시키므로 하드 규칙 9 부담이 낮다 — 그래도 저속/시뮬레이션 권장).
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
- [ ] **(2026-09-10, §1-DE) 제어기 API 통합 (3) — 남은 중복 4·5·6·7.**
  §1-DE 말미의 목록 순서대로. 다음은 **`Show Thread` 열거를 `threadStop.probeThreads` 로 모으기**(저위험,
  "잘린 응답" 정책 3종을 하나로) → 중단점 명령 폴백을 `breakpointCommand.ts` 로 → busy 재시도 정책 정리
  (`commandPolicy` R2 가 이미 전송 전 최대 8초 대기라 실효 타임아웃이 곱해진다) → 스택/정지 위치 조회.

- [ ] **(2026-09-07, §1-DB) 구조 정비 후속 — 저위험 정리 후보(하드웨어 무관, 각각 tsc + `npm test` 로 검증 가능).**
  ① `config.ts` 에 남은 언어 헬퍼 `getQualifiedWordAtPosition`·`isInCommentOrString`·`GPL_CONTROL_KEYWORDS` → `language/`
  (vscode 타입을 받는 부분은 접착 쪽에 남기고 순수 부분만) ② 1403 상태 문구 두 표현(`controller/runtime/runtimeConsolePresentation` 알림용 영문 vs
  `views/tree/runtimeConsoleTreePresentation` 트리용 한국어)의 폴링 판정 정규식 차이 — **실기기에서 1403 reason/detail 문구를
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

- [ ] **(2026-09-02, §1-CR 후속) 모듈 멤버 자동완성 · 호버 범위 표시(제어기 무관, 모션 무영향)**:
  ① `모듈이름.`을 찍으면 그 모듈 안 **클래스가 목록에 나오는지**(종전 누락), 중첩 클래스는 안 나오는지
  ② `클래스이름.`에는 멤버 + 중첩 클래스가 나오고 **자기 자신은 안 나오는지**
  ③ 클래스/모듈 이름 호버에 `Class: 자기이름`·`Module: 자기이름`이 더는 안 붙는지
  ④ 중첩 클래스 호버의 범위가 **바깥 클래스**로 나오는지 ⑤ 프로시저·멤버 호버의 범위 줄은 종전과 같은지
  ⑥ `Module.Class.멤버` 정의 이동(F12)·호버가 종전대로 동작하는지(`membersNamed` 재작성 영향 확인).
- [ ] **(2026-08-05, §1-AQ) Stop/settle/busy-retry 처리 통일 리팩터링** — 같은 로직이 4곳+MCP에 제각각(§1-AQ 표 참조). 제안: ① `sendCommandWithBusyRetry`를 `controllerConnection.ts`(또는 공용 모듈)로 이동해 extension.ts/deployService/gplDebugSession이 공유 ② settled 상태 집합(`/^(idle|stopped|error)$/i`)과 settle 폴러를 단일 정본으로(현재 extension.ts:78과 deployService.threadSettled가 주석 동기화 의존 중복) ③ Stop 계열 공통 규약 확립: "Stop 전송 → STATUS 0/-752 모두 '접수'로 간주 → settle 폴링 → 미확인 시 Stop 1회 자동 재시도 → (수동 경로) SoftEStop 복구 제안 / (자동 경로) 중단" ④ controller-mcp 도구 설명·exportAgentSetup 가이드에 -752 비치명 의미 명시. ※ 모션/정지 흐름에 닿는 변경이므로 §3-B 원칙대로 저속/시뮬레이션 검증 후 적용.
- [ ] **(우선, §1-AH) 외부 AI 디버깅 경로 개선** — ①(워크스페이스 AI 가이드/`.mcp.json`)·②(`GPL: Export AI Agent Setup`)는 **완료(2026-08-05, §1-AN)**. 남은 것: ③ controller-mcp 디버깅 도구 견고화 패리티(§1-AG 규약) — **대부분 완료(2026-08-05, §1-AS: 정지확인 내장·run_to_line·statusHint, 실기기 검증 남음)**, ④ connect backoff. (1403 실시간 스트림 도구는 **완료(2026-10-14, §1-EQ `runtime_console_read`)**.) 상세와 배경은 §1-AH/§1-AN.
- [ ] (§1-J 후속) 캐시 초록 기반 60개(XmlNode/Network/Modbus) 항목을 web_fetch rate limit 해제 후 라이브 페이지로 파라미터 세부 재확인.
- [ ] §2 `isOrgCompleted` 대입 방식 확정 후 코드 수정 → MergeCode 재컴파일로 `-742` 해소 확인.
- [ ] 정의 찾기: 클래스 멤버 스코프 해석(`obj.member`를 obj의 클래스 한정으로) 정확도는 추후 보강 여지. ※ 오버로드 해석(인자 개수+타입, 동점 peek)은 2026-07-13 §1-K에서 구현 완료.

### 3-B. 코드 리뷰 권고 — 미적용(검증/결정 필요)

§1-B에서 **안전 항목만** 적용했고, 영향이 크거나 실측이 필요한 것을 여기 남겼다.
2026-07-16(§1-Q)에서 사용자 승인 하에 대부분 적용됐고, **적용·종결된 항목은**
`docs/archive/handoff/2026-08.md` §부록으로 옮겼다. 아래는 **아직 열린 것만**이다.

> **이 섹션의 판정 기준**(하드 규칙 9이 가리키는 곳): 제어기·디버그처럼 **모션·하드웨어에 영향이
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
src/language/syntax/gplStatements.ts            # 문 스니펫·키워드 정본(vscode 무의존) — 공식 Statement Dictionary 구문 + 스코프 규칙(scopes/requiresOpen/forbidsOpen) + getApplicableStatements (§1-CB)
src/language/syntax/blockContext.ts             # 커서 시점 열린 블록 스택(vscode 무의존) — analyzeBlockContext: file/type/procedure 스코프, 한 줄 If·Delegate·짝 없는 End 처리 (§1-CB)
src/language/checks/tryCatch.ts                 # Catch 누락 검사·GPL 4.2K5 호환성 안내 정본(vscode 무의존) — 중첩 Try·주석/문자열·줄 연속, Finally/End Try부터 보고 (§1-EH)
src/language/dictionary/gplDictionaryData.ts        # GPL Dictionary 데이터(vscode 무의존) — Class.Member 항목 + GPL_CLASS_DOCS(클래스 개요·생성자). Thread는 공식 18페이지 전수 (§1-BR)
src/language/dictionary/gplBuiltins.ts              # 사전 API — usage/details 필드, findGplClassDoc·getGplClassMembers·findGplBuiltinMember(내장 타입 멤버 조회) (§1-BR)
src/controller/automation/agentBridge.ts            # Agent Bridge 서버(vscode 무의존, 실행자 주입) — presence 파일·요청/응답 파일 IPC·gpl.* 범위 한정·순차 실행 (§1-BQ). **인스턴스별 분리**: extensionInstanceId 마다 extensions/<id>.json + bridge/inst/<id>/{req,res}, 레거시 IP 큐는 electLeaderInstanceId 로 뽑은 리더 하나만 서비스(구버전 MCP 호환) (§1-DK)
src/controller/automation/agentCommandLog.ts        # AI 경유 명령의 Output 표현 규칙(순수, §1-EO) — formatAgentCommandLines(요약 `[Command] >>> cmd (agent) → STATUS n · ms` + 들여쓴 본문, 상한은 trafficLogMaxResponseChars)·formatAgentCommandFailure(정책 보류/전송 실패)·createRevealGate(조용한 뒤 첫 요청만 패널 열기, 30 s). 접착은 activation/controller/controllerCommands(sendCommand 에이전트 분기)·activation/host(execute 래퍼, 설정 gpl.agentBridge.revealOutput)
controller-mcp/src/extensionBridge.js    # Agent Bridge 클라이언트 — presence 판정/깨우기(code --open-url)/요청·응답 왕복/재전송 안전 판정 (§1-BQ) + listExtensionInstances·resolveExtensionInstance(창 선택: 명시 id→projectDir 워크스페이스→connected→유일, 애매하면 EXTENSION_AMBIGUOUS)·takeLateResponse(타임아웃 뒤 결과 회수) (§1-DK) · pickConsoleRouteInstance(1402 콘솔 경로: 명시 id→창 하나→connected→리더 — 리더는 레거시 큐 담당일 뿐, §1-EK)
src/controller/automation/operationStore.ts         # **장시간 작업 기록**(vscode 무의존) — operations/<id>.json 에 종류·대상·phase·결과 영속. 잠금과 분리(잠금은 사라지고 기록은 남는다), QUEUED→RUNNING 전환·멱등키 중복 차단, **RUNNING/QUEUED인데 신호 끊김 = 읽을 때 UNKNOWN** (§1-DK, §1-FC)
src/controller/deployment/deployQueue.ts            # 제어기별 프로세스 내부 FIFO(vscode 무의존) — 같은 제어기 요청은 등록 순서대로, 다른 제어기는 병행. 창/프로세스 간 상호 배제는 deployLock과 함께 사용 (§1-FC)
controller-mcp/src/operations.js         # 위 기록 읽기(읽기 전용 미러) + operationRecovery(상태별 다음 행동). 확장을 거치지 않으므로 확장이 배포로 바빠도·MCP 가 재시작돼도 조회된다 (§1-DK)
src/controller/deployment/deployProvenance.ts       # **배포 증적**(vscode 무의존) — 로컬 소스 지문 vs 우리가 올린 내용 지문 대조: localRevision/uploadedRevision/inSync + changedSinceUpload·notUploaded·staleRemote. verifiedBy='upload-manifest'(원격을 직접 해시한 것이 아님을 밝힌다), 기록 없으면 inSync=false (§1-DK)
src/controller/automation/automationRecovery.ts     # **복구 지시 표**(vscode 무의존) — 오류 코드 → action·retryCurrentCommand·safeToRepeat. 잠금/타임아웃/진행 중은 전부 CHECK_OPERATION + 재시도 false, **표에 없는 코드는 재시도 금지**로 떨어진다 (§1-DK)
src/controller/automation/uriDispatch.ts            # 외부 진입점 URI 해석(vscode 무의존) — /<gpl.command.id>?args=JSON | ?key=value | /command?id=…, 별칭 4개, gpl.* 범위 한정 (§1-BN)
src/controller/connection/connectionSession.ts      # 제어기 연결 세션 상태 정본(vscode 무의존) — 쓰기는 host.setControllerConnected 만(R7), 구독 onControllerSessionChange(대시보드), effectiveKeepAlive(해제 상태 명령은 단발 연결) (§1-EM)
src/controller/connection/connectionHealth.ts       # 연결 건강 판정(vscode 무의존) — ConnectionHealthMonitor(connected→suspect→lost, 프로브 임계 3/거부 2·힌트는 suspect만)·ConnectionHealthProber(1 s 재프로브)·classifyCommandFailure·probeOutcomeFromResponse (§1-BK)
src/controller/connection/consoleSocket.ts          # 1402 소켓 계층(vscode 무의존) — keep-alive 소켓 1개, terminator-first 재사용 판정, stale 1회 재시도(write 실패·조회 명령만, §1-GZ), 한 줄 명령 검증·UTF-8, 트래픽 링버퍼 600줄 (§1-BI, #22), reject code 부착·보관 소켓 관찰자(§1-BK)
src/debug/execution/sourceTargets.ts               # BP 유효 줄·프로시저 범위(End Sub 기준)·호출 후보 파싱(vscode 무의존) — BP 줄 보정(문서 규칙)·Jump to Cursor 검증·Step Into Target 후보 (§1-BU)
src/controller/threads/threadActivity.ts          # "동작 중" 판정(vscode 무의존) — 쓰레드 존재 = 활성, project 컬럼·기본 이름·`_Cmd_<project>`(Execute 쓰레드) 인정 (§1-BU). 상태 판정 단일 출처: isSettledState(Idle/Stopped/Error) · isPausedState/PAUSED_THREAD_STATES(Paused/Break/Error, §1-DD)
src/controller/debugging/executionMarks.ts          # 실행 위치 강조(정지 줄·에러 줄)의 유효성 판정(vscode 무의존, §1-EP) — isErrorMarkStale/isStoppedMarkStale: 주인 쓰레드가 목록에 없거나 Error/정지 상태를 벗어나면 낡음, 주인 모르면 같은 종류 상태가 어디에도 없을 때. 소비자는 activation/debug/debugDecorations.reconcile, 공급자는 views/tree/controllerTreeProvider.onDidChangeRuntimeState
src/controller/commands/projectCommands.ts         # **Compile/Load/Unload/Start 의 정본**(vscode 무의존·주입형 IO) — compileProject(후보 순회·일시적 STATUS 1회 재시도·성공은 STATUS 0+에러 0 뿐)/loadProject(HTTP 응답=제어기 이상)/unloadProject(-750 쓰레드 실행 중)/startProject(항상 buildStartCommand). 배포·FTP Run 이 함께 쓴다 (§1-DE)
src/controller/projects/remoteProjectPath.ts       # 어느 원격 사본(/flash/projects vs /GPL)을 대상으로 삼을지 — 점수 규칙 단일 정본(존재+200/flash+80/선택+20, switched 로 전환 고지) (§1-DE)
src/controller/threads/threadStop.ts              # **쓰레드 정지의 정본**(vscode 무의존·주입형 IO) — probeThreads(잘린 응답=확인 불가) / waitThreadsSettle·waitThreadSettle / sendStop / stopAllAndSettle·stopThreadAndSettle(전송→STATUS 판정→폴링→자동 재시도, unconfirmed 노출). 배포·패널·FTP·디버그가 모두 이것을 쓴다 (§1-DD)
src/controller/threads/threadStuckDiagnosis.ts    # **정지 불가 쓰레드 진단**(vscode 무의존·주입형 IO, **읽기 전용**) — diagnoseStuckThread(위치 N회 샘플링→이동 판정→소스 문맥→수신자 식→복구 후보) / extractCallTarget(문장의 마지막 메서드 호출) / buildRecoveryCandidates(지역 변수 인덱스는 0..N 치환) / createFileSourceLookup(파일명만 아는 위치를 로컬에서 찾기). 후보는 **제시만 하고 보내지 않는다** (§1-DI)
src/controller/commands/startCommand.ts            # Start 명령 조립(vscode 무의존) — 문서 구문 순서, 기본 `-event`(GDE 동일), `-compile` 금지(하드 규칙 7) (§1-BU)
src/debug/execution/threadLock.ts                  # 스레드 단일 실행 잠금 판정(vscode 무의존) — resolveExecutionThread(대상 확정·staleLock)·shouldPreserveFocus·isAllThreadsResumeRequest. 어댑터의 StoppedEvent 는 전부 _stoppedEvent 경유(불변식) (§1-BS)
src/controller/connection/idlePing.ts               # 1402 유휴 ping 판정/스케줄러(vscode 무의존) — GDE 방식 세션 유지(유휴 5 s → 읽기 명령 1개), 1403 안정성의 열쇠 (§1-BM)
src/controller/connection/eventLoopStall.ts         # (§1-GI) 확장 호스트 이벤트 루프 정지 감지(500 ms 틱, 2 s 이상 기록) — 판정은 안 바꾸고 유실 로그·사후 스냅샷에 "지연 중 몇 초가 정지였나"
src/controller/connection/pcPowerEvents.ts         # (§1-GQ) Windows 이벤트 로그 절전/복귀(Kernel-Power 42/107/506/507·Power-Troubleshooter 1) 읽기·파싱, 복귀 -5 s~+120 s 안의 의심을 절전 복귀로 매칭
src/controller/connection/recentCommands.ts        # (§1-GQ) 최근 상태 변경 명령 30건 링(결과 STATUS/실패) — 유실 사후 스냅샷 「직전 상태 변경 명령」 절
src/controller/connection/lossNotice.ts            # (§1-GQ) 유실 알림 문구(절전 복귀 / 복구 대기 만료 / 일반) + 「다시 연결」 버튼 이름
src/views/statusbar/connectionHealthBadge.ts        # (§1-GI) suspect/recovering 상태바 문구(순수) — connectionStatusBar 가 1 s 마다 다시 그림
src/controller/connection/reachability.ts           # ping TTL·TCP·arp 도달성 판정 + 응답 장치 정체(제어기 vs 게이트웨이) 힌트 (§1-BI, #22)
src/controller/diagnostics/resourceProbes.ts         # Show Memory / Show Network -tcp / -mbuf 파서(실기기 원문 기준)·증가율·이력 (§1-BI, #22 자원 카드)
src/controller/diagnostics/statusSampling.ts         # 상태 수집·대시보드별 저빈도 진단 캐시·실제 표본 시각(순수 IO 주입, §1-FM)
src/controller/diagnostics/robotAxes.ts              # (§1-HA) 전원·축·좌표 DataID 정본 — pd 파서, 116 로봇 목록, 3504/3506/230, 16077/16078 리밋 정규화, 구성 읽기(Execute 안 씀)
src/controller/diagnostics/controllerStatus.ts       # 확장 명령 큐와 상태 수집기의 어댑터·기존 공개 API 재노출
src/controller/diagnostics/temperature.ts            # Show Temperature 파서·센서 유효성·360점 온도 이력(§1-FM)
src/controller/runtime/runtimeConsoleGuards.ts   # 1403 접속 카운터(슬라이딩 윈도우)·워치독 판정(순수) (§1-BI)
src/controller/runtime/runtimeConsoleBuffer.ts   # 1403 수신 줄 링버퍼(seq 커서 read·untilPattern/waitFor 대기·dropped 보고, 순수) — MCP runtime_console_read 의 뒷단 gpl.ai.debug.runtimeConsoleRead 가 읽는다; 파일 캡처(gpl.runtimeConsole.captureFile)는 runtimeConsole.ts 의 appendCapture (§1-EQ)
src/controller/deployment/deployRecordCore.ts       # 컴파일 스냅샷(sha1) 기록/대조 순수 로직 + Memento 스토어 (§1-BI, #21)
src/controller/deployment/deployRecord.ts           # deployRecordCore vscode 래퍼 — recordCompiled/getCompiledRecord/onDidRecordCompiled/attachDeployRecordStore (§1-BI)
src/controller/deployment/compileStale.ts           # "컴파일 검증 필요" 상태(CompileStaleTracker, vscode 무의존) — 제어기(ip)별 키·Memento 영속·markedAt, 뷰는 list(ip) 전체를 받음(§1-GN); 해제는 onDidRecordCompiled 구독으로 경로 무관 (§1-CU), Compile 성공이 ProjectLibrary 항목도 해제(clearCompiled)·library 플래그·clearMany (§1-GS)
src/controller/deployment/deployPreprocess.ts       # (§1-HD) 배포 전처리 계획(순수) — 설정 해석·미사용 라이브러리 파일 제외·.gpr ProjectSource 줄 빼기·-729 안내
src/controller/deployment/deployPreprocessStage.ts  # (§1-HD) 워크스페이스 밖 사본 만들기·업로드 폴더 대응·예전 업로드 제외 파일·증적 지문
src/controller/deployment/compiledLibraries.ts      # (§1-GS) 프로젝트 폴더 .gpr 의 ProjectLibrary 값 전이 수집(로컬 해석 실패 값도 원문)·isLibraryProjectDir
src/activation/deploy/compileStaleCommands.ts       # gpl.compileStale.pick — 미검증 프로젝트 다중 선택 → 고른 순서대로 Quick Compile(실패 시 중단). 상태바 배지가 여럿일 때 연다 (§1-GN)
src/controller/deployment/flashSafety.ts            # Save to Flash 안전 확인 상태기계(순수) — Sync 종결 STATUS 0 뒤 10초 안정화, 실패 시 unknown 유지 (§1-FD)
src/debug/execution/stepGate.ts                    # Step/Continue 게이트 순수 판정 shouldGateStepRequest(pending-entry/pending-same-thread/min-interval) (§1-BI, #28)
src/debug/evaluation/evalMessages.ts                # 평가 실패 문구 정본(vscode 무의존) — formatEvalError(hover/Watch/REPL 공용, 세션에서 이관)·describeNestedExpandFailure(중첩 객체 펼치기 실패 행: 코드·원인 앞, 대처 뒤, Debug Console 용 detail)·UNDEFINED_SYMBOL_STATUS/UNSUPPORTED_PROCEDURE_STATUS (§1-DS)
src/debug/evaluation/replInput.ts                   # Debug Console 여러 줄 입력 모델(vscode 무의존) — 줄 분해·`>` 접두사·상태 변경 명령 미전송 안내·입력별 결과 표시 (§1-ER)
src/language/analysis/getterBranch.ts             # 분기형 Property getter(`If 필드 비교 Then Return A Else Return B`, 4형태) 파싱·계산 정본(순수) — parseGetterBranch(파서 → GPLSymbol.getterBranch)·getterBranchIdentifiers(hover 게이트 해석 가능 판정)·evaluateGetterBranch(어댑터 ②-c·가상 Property 자식, 결과는 제어기 표기 -1/0 + via) (§1-DS)
src/debug/execution/spontaneousPause.ts             # 사용자 액션 없이 관측된 Paused 판별(vscode 무의존) — GPL 의 Paused 는 Thread.Sleep 대기도 포함하므로 등록 BP 위치 일치 = 즉시 정지, 그 외 3폴·1500ms 연속 = 외부 정지, 나머지는 무시(가짜 브레이크 차단) (§1-CK)
src/controller/debugging/debugBridge.ts            # 디버그 세션 ↔ 확장 이벤트 버스 + RuntimeConsoleHealth 공급자(1403 alive → 백업 폴 완화) (§1-BI) + onDebugProbeResult(어댑터 폴 결과 → 연결 건강 모니터, §1-BK)
src/views/tree/refreshThrottle.ts             # 트리 FTP/시스템 정보 자동 재조회 스로틀 판정(순수) (§1-BI, #22)
src/debug/session/launchJsonc.ts                 # launch.json JSONC 읽기/부분 갱신(jsonc-parser) — 주석·포맷 보존 upsert (§1-BI, #30)
controller-mcp/src/batch.js              # MCP controller_command 배치 runBatch/normalizeCommandInput (§1-BI, #16)
src/controller/connection/trafficResponseBody.ts    # ResponseBodyStreamer — 1402 응답 본문 줄 단위 스트리밍·상한 생략 요약(§1-BG, vscode 무의존 순수 모듈)
src/controller/deployment/deploy*Stage.ts           # (§1-GF) deployLocked 의 단계 본문 — precheck → targetStage → uploadStage(∥ stopStage) → compileStage → startStage → errorCheckStage, 공유 상태는 deployContext.ts(DeployContext)
src/controller/deployment/deployService.ts          # deploy() = 제어기별 QUEUED 대기→잠금 획득→일반은 UPLOAD ∥ STOP/THREAD_CHECK→COMPILE→START→ERROR CHECK, Upload Only는 UPLOAD만(원격 전용 삭제 보류). tryCompile, directGpl, COMPILE_DEFERRED, findProjectDirs, onDidUploadProgress (§1-BD, §1-EE, §1-FC)
src/controller/projects/projectPickerCore.ts      # 프로젝트 폴더 선택 순수 규칙 — orderProjectDirs(최근 선택 우선)·projectDirFromResource(폴더 자체/.gpr/포함 파일)·filterDirsByProjectName (§1-BL, vscode 무의존)
src/controller/projects/projectPicker.ts          # 공용 선택기 pickProjectDir(Detailed)(QuickPick·workspaceState 최근 선택)·readGprProjectName/projectNameOf·context key gpl.projectDirs(탐색기 메뉴) — 명령·F5 provider 공용 (§1-BL)
src/controller/projects/projectNameGuard.ts       # 프로젝트명/Load 경로 안전성 단일 규칙(vscode 무의존) — 1402 명령은 공백 구분·인용 불가 → 공백·제어 문자 검출 checkProjectName/checkRemotePath·안내 문구 describeProjectNameProblem; deploy/Start/ftpRun·Unload/F5 attach/MCP proj()가 공유 (§1-BQ)
src/debug/session/activateDebug.ts               # DebugConfigurationProvider — 중복 세션 처리 + fillProjectTarget(다중 프로젝트 QuickPick, projectDir/projectName 보충) (§1-BL), InlineDebugAdapterFactory
src/controller/deployment/deployLock.ts             # 배포 잠금 — 메모리+파일(%TEMP%/gpl-controller/<ip>.lock.json), pid/heartbeat stale 자동 만료, describeDeployLock (§1-BD, 이슈 #15·#17); 파일 교체 rename 의 EPERM/EBUSY 공유 위반은 4회 재시도(§1-GN, env.renameFile 주입)
src/controller/files/ftpClient.ts              # uploadProject onlyFiles, mirrorProject deferDelete + removeRemoteFiles(§1-BD), 지문 스킵 판정(§1-BV), 진행 이벤트 onProgress(event) = 파일 완료 + basic-ftp trackProgress 바이트(§1-EE)
src/controller/deployment/uploadProgress.ts         # 업로드 진행 집계(vscode 무의존) — UploadProgressTracker(파일 완료 + 전송 중 바이트, 스킵은 즉시 완료, 크기 클램프)·UploadProgressEvent; 표시는 views/statusbar/uploadProgressBar (§1-EE)
src/util/formatBytes.ts                  # 바이트 → 사람이 읽는 크기 정본(vscode 무의존, R7) — formatBytes/formatBytesAs/byteUnitFor(B 정수·그 위 소수 1자리·GB 까지); 종전 views/tree/treeFormat.formatSize 통합 (§1-EE)
src/controller/files/syncManifest.ts           # 업로드 지문(SHA-1) 매니페스트 — 미러/skipUnchanged 스킵 판정(§1-BV, globalState)
src/controller/debugging/breakpointReconcile.ts    # 에디터↔제어기 중단점 수렴 계획(vscode 무의존) — project-relative identity 비교, 미해석 proc=?/0 제외, planReconcile/orphan 표시 (§1-CJ, §1-EC)
src/controller/debugging/breakpointCommand.ts      # BP 명령 문자열 계층(vscode 무의존) — 무공백 생성, project-relative 경로 보존 parser, MirrorEchoMemory (§1-CO, §1-EC)
src/controller/debugging/breakpointMirror.ts       # 제어기→에디터 중단점 미러 — AI(MCP·URI·콘솔)가 건 BP를 빨간 점으로. 외부 진입점에서만 동작(DAP·EditorBreakpointSync 제외), 설정 mirrorAiBreakpoints (§1-CO)
src/controller/protocol/responseParser.ts         # parseStatus, parseCompileErrors
src/debug/evaluation/showVariableParser.ts          # Show Variable 파싱 — 2열 Location 멤버(isTypeToken)·summarizeLocation·annotateLocationMember(§1-BF)
src/language/analysis/receiverType.ts             # 멤버 접근 수신자 타입 정적 해석(resolveReceiverHolder·membersNamed·buildDocumentReceiverLookup) + 소속 판정 ownedByHolder·nestedTypesIn(정의찾기 전역 폴백 차단용, §1-CA) — 디버그 hover 게이트·정적 hover 공용(§1-BJ, #32, vscode 무의존)
src/controller/automation/exportAgentSetup.ts            # AI MCP 사용자 범위 등록(claude CLI·Codex toml)·점검·예전 워크스페이스 파일 정리·번들 동기화(§1-GV)
src/controller/automation/agentSetupChecks.ts            # 등록 판정·Codex toml 테이블 교체·예전 파일 strip 규칙(순수, vscode 무의존)
src/controller/io/dio.ts                    # Show DIO `signal: 0|1 [*]` 순수 파서 + Set DIO 명령/동작 설명 정본(§1-FB)
src/controller/io/dioGroups.ts              # (§1-GJ) 신호 번호 → Local/Remote I/O 그룹 분류(문서 신호 번호 체계), Soft 20001~20064 분할 조회, 토글 값·일괄 해제 대상
src/views/dashboard/controllerDashboardPanel.ts    # 제어기 대시보드 웹뷰 — 상태/I/O 탭, setInterval/setDiagnosticInterval/pause/config, 모달 없는 Set DIO·toggleDio·releaseDio(§1-BF·§1-FB·§1-GJ); HTML은 assets/webview/dashboard.html
controller-mcp/src/parse.js              # MCP 파서 — parseThreadList(이름 키)·compactThread·summarizeThreads·parseShowVariable(§1-BF)
scripts/bundle-mcp.js                    # MCP 번들 + 빌드 스탬프(define __GPL_MCP_BUILD_JSON__, 사이드카 .build.json)(§1-BF)
src/debug/session/sessionIo.ts                      # (§1-GF) 협력자가 세션을 보는 창 — 읽기 전용 getter + sendCmd/log/sendEvent. 세션 생성자의 _io 가 구현(지연 getter)
src/debug/session/sessionSources.ts                 # (§1-GF) 소스 지도·컴파일 단위·원격 소스·프로시저 범위(옛 _resolveSourcePath·_updateProjectDirs·_buildSourceFileMap)
src/debug/session/sessionBreakpoints.ts             # (§1-GF) BP 장부·Set Break 표기 폴백·-508 안내·임시 BP(옛 _sendBpCommandWithFallback·_bpFileForms)
src/debug/session/sourceStaleness.ts                # (§1-GF) GitHub #21 stale 판정·BP 강등/복원
src/debug/session/attachPreflight.ts                # (§1-GF) F5 배포(_runDeployBeforeAttach)·배포 잠금 대기·attach preflight 정지 — vscode 허용 목록
src/debug/session/frameCache.ts                     # (§1-GF) Show Stack 캐시·프레임 id·세대(invalidateFreshness/clearAll/dropThread)
src/debug/evaluation/variableEvaluator.ts           # (§1-GF) -eval 사다리·DAP Variable·배열 펼치기·REPL 평가(vscode 없음, io 콜백으로 설정/모달)
src/debug/evaluation/sourceSymbolIndex.ts           # (§1-GF) 로컬 이름·전역 목록·Property 색인(소스 파싱, 소스맵 세대 캐시)
src/debug/execution/pollDriver.ts                   # (§1-GF) 인터벌/fast/pending 폴 타이머 — 폴 본문(_pollThreadStates)은 세션에 남음
src/debug/session/gplDebugSession.ts             # attachRequest, _runDeployBeforeAttach(lockOwner 'F5 Deploy'), _waitDeployLockForStart, getDebugDeployDiagnostics
src/extension.ts                         # activate()/deactivate() — 배선만(195줄). ExtensionHost 생성 → activation/*.ts 의 activateXxx(host) 를 종전 순서로 호출 (§1-CZ)
src/activation/host.ts                   # ExtensionHost — 클로저가 공유하던 서비스(채널·심볼 캐시)·가변 상태(트리·상태바·런타임 콘솔·건강 모니터·디버그 여부·마지막 스냅샷)·헬퍼(log·배포 잠금·컴파일 검증 상태·런타임 콘솔 싱글톤·연결 상태 반영·Agent Bridge)·하위 API(project/connection/deploy/decorations). **가변 상태는 항상 host.x 로 읽는다** (§1-CZ)
src/views/tree/treeSections.ts · snapshotMarkdown.ts # (§1-GF) 트리 섹션/루트 빌더와 상황·진단 보고서(순수) — controllerTreeProvider 는 오케스트레이터
scripts/dev/deployReplay.js · compareTreeProvider.js # (§1-GF) 분할 전 커밋(6882714)과 현재를 같은 입력으로 재생해 대조 — 배포 151 시나리오 / 트리 41 상태. 회귀 의심 시 먼저 돌린다
scripts/dev/index-performance.js                    # (§1-GF) 합성 워크스페이스 인덱싱·호버 벤치마크(읽기/파싱/색인 단계별 ms + 심볼 digest)
src/activation/deploy/deploy.ts                 # gpl.deploy/uploadStart/start/saveToFlash/quickCompile + autoOnSave + 자동화 대상 해석·게이트 — runDeploy/runDeployCore(결과 보고부는 controller/deployment/deployOutcome.ts) (§1-CZ, §1-DB) · onDidUploadProgress → 상태바 진행 바 구독, Save to Flash 는 직접 연결(§1-EE) + Sync/10초 안전 확인(§1-FD)
src/activation/controller/connection.ts             # 연결 건강 모니터 배선·유실 처리·사후 스냅샷·connect/disconnect(대화형+비대화형)·launch.json·startQuickAttachSession(attachOnly=배포 없이 붙기, §1-DC)·debugProject(배포+붙기 — 대상은 QuickPick·우클릭, §1-DQ)
src/activation/deploy/projectContext.ts         # 기대 프로젝트 감지·launch.json 읽기·GPL 파일명→경로·BP target 해석(resolveGplFilePath/resolveBreakpointTarget) — host.project (§1-CZ, §1-EC)
src/activation/controller/controllerOps.ts          # busy 재시도·정지 확인(§0.6)·SoftEStop 복구·정지 진입 대기(waitForThreadPause) — host 를 첫 인자로 (§1-CZ)
src/activation/debug/debugDecorations.ts       # ExecutionDecorations — 정지 줄/에러 줄 강조 한 객체 (§1-CZ). showError/showStopped 에 주인 쓰레드, reconcile(snapshot) 로 상태가 끝난 강조 자동 해제 (§1-EP)
src/activation/{languageFeatures,xmlCommands,breakpointCommands,consoleCommands,aiAgentSetup,aiDebugCommands,controllerCommands,treeCommands,ftpCommands,debugIntegration,uriHandler}.ts  # 명령 그룹별 activateXxx(host) — 본문은 종전 extension.ts 그대로 (§1-CZ)
src/controller/threads/threadArgs.ts             # asThreadNode — 쓰레드 명령 인자 정규화(순수) (§1-CZ)
src/controller/commands/stepCommand.ts            # buildStepCommand — Step 명령 조립 정본(트리·AI API 공용, 순수) (§1-CZ)
src/util/pathKey.ts                      # 경로 동일성 키 normalizePathKey·normalizeDirKey·isPathUnder(파일·폴더 공용 단일 규칙, vscode 무의존) — controller/projects/projectPickerCore 에서 분리(§1-CQ, §1-DB)
src/language/syntax/identifiers.ts              # ciEq — GPL 식별자 대소문자 무시 비교(vscode 무의존, 종전 config.ts) (§1-DB)
src/project/gpr/gprSync.ts                   # Project.gpr 파싱/소스 목록 동기화 순수 로직(vscode 무의존, 종전 controller/) — 명령 래퍼는 controller/projects/gprSyncCommand.ts (§1-BW, §1-DB)
src/controller/deployment/deployOutcome.ts          # 배포 결과 보고 순수 규칙 — SituationDeploySnapshot 정의·결과 서명/이력·ErrorLog 분류 로그·COMPILE 원문 로그·실패 문구 4분기(vscode 무의존, 종전 activation/deploy/deploy.ts 클로저) (§1-DB)
src/views/tree/treeFormat.ts                  # 트리 표시 포맷(날짜·연결 통계, vscode 무의존 — 크기는 util/formatBytes 로 §1-EE) (§1-DB)
src/views/statusbar/uploadProgressBar.ts           # 상태바 업로드 진행 바 표시 규칙(vscode 무의존, R7) — renderBar(20칸 + 1/8 부분 블록)·formatBytesPair(total 단위 통일)·describeUploadProgress(전송 중/완료/동일)·renderUploadSummary; 집계는 controller/deployment/uploadProgress (§1-EE)
src/views/statusbar/connectionStatusBar.ts         # 상태바 — 연결 항목·대시보드·경고 배지(컴파일 검증 필요/소스 변경됨/스레드 잠금, 각각 별도 항목 §1-DV)·업로드 진행 바(§1-EE)·Flash 전원 차단 금지 경고(§1-FD)
src/views/statusbar/flashSafetyPresentation.ts     # Flash 안전 경고 문구·아이콘·툴팁의 표시 정본(순수, R7, §1-FD)
src/views/tree/runtimeConsoleTreePresentation.ts  # 1403 콘솔 트리 행 문구(라벨·description·아이콘·툴팁·불안정 판정·가설, vscode 무의존) — 알림용은 controller/runtime/runtimeConsolePresentation.ts (§1-DB)
src/test/architecture.test.ts            # 구조 회귀 테스트 — vscode 의존 허용 목록·계층 의존 방향·런타임 순환·테스트 등록·package.json↔명령/설정 키 (§1-DB, 규칙 근거는 docs/development/architecture.md)
src/test/language/syntax/sampleSyntaxCoverage.test.ts    # samples/syntax-tour 가 문법 정본(gplStatements)을 빠짐없이 쓰는지 양방향 검사 — 마커↔라벨, 키워드, 비GPL 문법 금지, gpr 등재, 파서 심볼 (§1-DW)
src/controller/automation/aiCommandPolicy.ts        # AI/자동화 경로에서 거부할 명령 목록(정본) — 되돌릴 수 없는 명령만. 브리지·URI·명령 자체가 함께 본다 (§1-DA)
controller-mcp/src/deployLock.js         # 잠금 파일 읽기 전용 구현(확장과 파일 계약 공유) — Compile/Start/Load/Unload 유한 대기·거부(§1-BD)
src/language/syntax/gplParser.ts                # Property/Sub/Function 파싱 + parseDocument 메모이즈 캐시(§1-B E) + docComment 수집(§1-J) + Property getter 골격(getterReturnExpr 단순 Return #26 / getterBranch 분기형 §1-DS)
assets/syntaxes/gpl.tmGrammar.json       # 구문 강조 — GPL 전용 규칙(선언 6종·Delegate 타입 선언·내장 VB 문법이 모르는 키워드 5규칙) 뒤에 source.asp.vb.net 위임. 선언 규칙 수식어 집합 = GPL_PROC_MODIFIERS, src/test/language/syntax/grammar.test.ts 가 강제 (§1-DT)
src/language/dictionary/gplBuiltins.ts              # 핵심 빌트인/String 함수 (Trim→메서드, Rnd(seed), Replace 제거, Asc/Chr/… 추가) + Bit 문자열 전역함수(§1-J)
src/language/dictionary/gplDictionaryData.ts        # Move/Robot/Location/Profile/.../String 클래스 사전 + Controller/Thread/Exception/File/XML/Network 등 +153(§1-J)
src/language/symbols/outlineModel.ts             # 개요·Ctrl+Shift+O·Ctrl+T 표현 모델 정본(vscode 무의존, §1-EI) — outlineCategoryOf(클래스 멤버 Sub/Function→method, 모듈 프로시저→function, 멤버 변수→field, 로컬→variable, Delegate→delegate)·symbolDetail(시그니처/타입/상수 값/Shared/ReadOnly·WriteOnly)·buildOutlineTree(계층 + 범위: 파서 endLine 정본, 없으면 다음 비-자손 직전·부모 안 폴백)·matchesSymbolQuery(순서 일치)
src/providers/structure/symbolKinds.ts             # OutlineCategory → vscode.SymbolKind 단일 대응표(R7 정본, §1-EI) — documentSymbolProvider·workspaceSymbolProvider 공용. Delegate 는 Class(§1-DU)
src/providers/structure/documentSymbolProvider.ts  # 개요(DocumentSymbol) — outlineModel 트리를 VS Code 객체로 옮기고 범위를 문서 안으로 보정만(§1-ED·§1-EI)
src/providers/structure/workspaceSymbolProvider.ts # Ctrl+T — 이름 컬럼 Range 위치, 로컬·파라미터 제외, matchesSymbolQuery(§1-EI)
src/providers/intellisense/completionProvider.ts      # 정적 항목 캐시, 트리거('.', '&')
src/providers/navigation/definitionProvider.ts      # token 확인 + parseDocument 재사용
src/providers/intellisense/hoverProvider.ts           # token 확인 + docComment 표시(§1-J)
src/providers/intellisense/signatureHelpProvider.ts   # Signature Help(빌트인+사용자 Sub/Function, §1-J 신설)
src/language/symbols/symbolIndex.ts      # 심볼 저장·조회·오버로드·멤버·이름 인덱스 정본 — 프로젝트 판단은 SymbolResolutionContext로 주입 (§1-FJ)
src/project/symbols/symbolProjectScope.ts # CompileUnitIndex·프로젝트 경계·경로 점수의 소유자 (§1-FJ)
src/language/vscode/symbolCache.ts       # 기존 Provider API 28개와 refresh·로그·삭제 정리를 조립 (§1-FJ)
src/language/vscode/workspaceSourceLoader.ts # 미저장 버퍼·인코딩·GPR 탐색·배치 로딩·참조 텍스트 읽기 (§1-FJ)
src/language/vscode/symbolPresentation.ts # VS Code 완성 항목·문서·스니펫 표현 (§1-FJ)
src/language/symbols/symbolLocations.ts          # 정의 peek 목록 정리(vscode 무의존) — dedupeSymbolLocations(같은 파일·줄 병합)/preferExistingFiles(없는 파일 제외, 전부 없으면 원본 유지) + 존재 판정 정본 isMissingFile(ENOENT만 삭제로 본다)·fileExists(§1-CQ)
src/language/documentation/docComment.ts               # 문서화 주석 정본(vscode 무의존) — parseDocComment(섹션 별칭·펜스 인식)/renderDocCommentMarkdown(호버·완성·시그니처 공용)/buildDocCommentBlock·mergeDocComment(골격·머지, DocTarget.coveredParams/coveredReturns 로 "차이만" §1-DR). 원문은 손실 없이 보존하고 렌더에만 손보는 원칙: withFenceLanguage(펜스 언어 보정)·stripDecorativeRules(`====` 장식선 제거, §1-CS)
src/language/documentation/docCommentOverloads.ts      # 오버로드 문서화 주석 병합 정본(vscode 무의존, §1-DR) — filterOverloadSiblings(형제 = 같은 이름·Sub/Function·모듈/클래스·컴파일 단위, 사본 접기)/resolveOverloadDoc(공통 설명은 유일하게 가장 풍부한 문서·자기 설명 없으면 Jaccard 로 가장 닮은 형제·이름별 매개변수·같은 타입 Returns — 선언 순서 무관, provenance 동반)/renderResolvedDocMarkdown/describeOverloadCoverage(골격 "차이만"). 호버·완성(symbolCache.buildSymbolDocumentation)·시그니처·''' 공용, 형제 후보는 symbolCache.findOverloadSiblings
src/project/sources/sourceMinify.ts              # (§1-HD) 줄 번호 유지 경량화(주석·# 줄·공백, 바이트 안전)
src/project/sources/memberScan.ts                # (§1-HE) 최적화용 엄격한 선언 스캐너 — 선언·물리 줄 범위·참조 낱말, 모르는 문장이면 irregular
src/project/sources/memberReachability.ts        # (§1-HE) 선언 그래프 도달성(모듈 이름 생략·자기 모듈 가림·클래스 멤버·New·Init·keep) → 지울 줄 범위
src/project/sources/compileCostModel.ts          # (§1-HF) 컴파일 메모리 추정 — Sample Prep 실측 단가(COMPILE_COST) × 선언 구조, 추정 전용
src/project/sources/sourceReachability.ts        # (§1-HD) 파일 단위 도달성 — 선언 이름(모듈 이름 생략 규칙)·참조 낱말·전이 폐포
src/project/sources/projectSources.ts            # "프로젝트에 속한 소스" 단일 출처 — 재귀 목록·ProjectSource 해석·소유 .gpr 선택(§1-BW, vscode 무의존) + 중첩 프로젝트 경계(stopAtNestedProject)·ProjectLibrary 해석(resolveProjectLibraryDirs)·관련 프로젝트 수집(collectRelatedGprPaths)(§1-BX)
src/project/remote/controllerProjectWorkspace.ts # FTP 다운로드 사본 manifest·SHA-256·Live/Snapshot 쓰기 게이트·중첩 배포 루트·staging/저장된 workspace 정본(vscode 무의존, §1-FA)
src/project/remote/controllerProjectDebug.ts # 제어기 소스·Attach 대상·안전 구성·일회성 재개·라이브러리 경로 후보(§1-FR)
src/controller/files/controllerProjectDownload.ts # Snapshot 다운로드·ProjectLibrary 그래프의 원격 의존성 수집(FTP 읽기만, §1-FR)
src/activation/remote/controllerProjectDebug.ts # FTP 프로젝트 선택·필요한 메타데이터 준비·현재 창 Attach(§1-FW)
src/activation/remote/controllerRemoteFiles.ts # 읽기 전용 FTP FileSystemProvider·문서/디버그 세션의 TMP 수명
src/controller/files/remoteSourceSession.ts # 원격 프로젝트 관계·세션별 경로/URI 매핑·lazy read
src/activation/remote/controllerSourceLanguage.ts # 열린 원격 소스의 프로젝트별 독립 언어 서비스
src/project/sources/compileUnitTarget.ts         # 컴파일 단위(.gpr) 선택 정본(vscode 무의존, §1-DX) — chooseCompileUnitGprs: 세션 대상 폴더(host.sessionTargetDir) 1순위 → 프로젝트명 일치 전부 → 없음. projectContext.findExpectedProjectDirs·gplDebugSession._updateProjectDirs 가 공유
src/project/remote/breakpointTarget.ts          # BP source identity 정본(vscode 무의존, §1-EC) — 메인 .gpr 직접 ProjectSource 원문 / ProjectLibrary source / compile unit 밖 판정
src/project/sources/projectFileScope.ts          # 참조 검색·심볼 인덱싱 공용 파일 범위(resolveProjectFileScope, PROJECT_EXCLUDE_GLOB)(§1-BW) — 라이브러리 양방향 확장(§1-BX)
src/providers/navigation/referenceProvider.ts       # scanDocumentText 라인별 스캔(ReDoS 완화) + 프로젝트 범위 폴백(§1-BW — findTextInFiles는 제안 API로 미사용)
.github/instructions/gpl-ai-controller-debugging.instructions.md  # 하드 규칙
```

---

## 5. 참고 — 정상 컴파일 응답 형식 (GDE, verbatim, 2026-06-30)

다음처럼

---

## 1. 세션 이력 — 최근 세션 + 전체 인덱스

본문에는 **최근 10개 세션**(§1-GY ~ §1-HH)만 둔다.
그 이전은 월별 아카이브에 원문 그대로 있고, 그 세션들의 인덱스는 [archive/handoff/index.md](archive/handoff/index.md)에 있다.
아래 §1-0 에는 본문에 있는 세션의 행만 둔다.

| 아카이브 | 범위 | 세션 수 |
| --- | --- | --- |
| [2026-06](archive/handoff/2026-06.md) | §1-A ~ §1-B (2026-06-30) | 2 |
| [2026-07](archive/handoff/2026-07.md) | §1-C ~ §1-AL (2026-07-03 ~ 2026-07-31) | 35 |
| [2026-08](archive/handoff/2026-08.md) | §1-AM ~ §1-CM (2026-08-05 ~ 2026-08-31) | 53 |
| [2026-09](archive/handoff/2026-09.md) | §1-CN ~ §1-EE (2026-09-02 ~ 09-30) | 44 |
| [2026-10](archive/handoff/2026-10.md) | §1-EF ~ §1-GO (2026-10-02 ~ 10-28, §1-FR 2건) | 63 |
| [2026-11](archive/handoff/2026-11.md) | §1-GP ~ §1-GX (2026-11-03 ~ 11-04) | 9 |
| (본문 아래) | §1-GY ~ §1-HH (2026-11-04 ~ 11-13) | 10 |

### 1-0. 전체 세션 인덱스

본문 세션만 둔다. 아카이브된 §1-A ~ §1-GX 는 [archive/handoff/index.md](archive/handoff/index.md).

| § | 날짜 | 주제 | 위치 |
| --- | --- | --- | --- |
| §1-GY | 11-04 | **AI 지침 정리** — `AGENTS.md` 정본화(`CLAUDE.md` 는 `@AGENTS.md` import), 요청 이력의 방침(커밋 자유·합쇼체 문구·포커스 강제 금지·/flash/projects) 명문화, `record-keeping.md`, §3 실사용 확인 117건 → `ai-handoff-verification.md`, 아카이브 인덱스 196행 → `archive/handoff/index.md`, 하드 규칙 번호 §0 로 통일(모션 6→9). 문서 전용 | 본문 ↓ |
| §1-GZ | 11-04 | **프로젝트 문제점 리뷰 후속 — 명령 안전·정지 판정 경합·메모리 자동 회수·의존성** — 1402 한 줄 검증(CR/LF 거부)·전달 뒤 재전송은 조회만·UTF-8·닫힌 STATUS·줄 번호 140 수정, 브리지 정지 명령 우선·URI 토큰·상태 모르면 Step/Continue 거부, 디버거 액션 세대·잔류 pending·BP 요청 직렬화, 메모리 부족 시 정지 → Unload 자동 회수(`memoryGuard.autoUnload`), basic-ftp 6.2.5·@types/vscode ~1.74·CI Node 22·.gitattributes. 0.27.10 | 본문 ↓ |
| §1-HA | 11-04 | **대시보드 축 위치 리밋 막대·추이 그래프 통합·전원/축/좌표 DataID 전환·I/O 클릭 토글** — 4.2K5 실측: `Execute Robot.WhereAngles`/`Where` 는 값 없음, `Execute Controller.PowerEnabled` -712, Execute 명령 상한 136자 → `pd 3504/3506/230/116/2002/16077/16078`(순수 `robotAxes.ts`), 로봇 전체 막대(양끝 소프트 리밋·5% 근접·이동), 「추이」 한 카드 5차트(같은 차트 함수·눈금·호버), 칩 클릭 토글·더블클릭 해제. 1646/1646. 0.27.11 | 본문 ↓ |
| §1-HB | 11-04 | **대시보드 I/O 칩 8열 격자 · Soft DIO 64 상한 실측** — 칩 flex-wrap → 8열 격자(64 = 8×8, bank 96 = 12×8, 좁으면 4열), 그룹은 multi-column 단에 쌓기. 4.2K5 실측 `Signal.DIO(20065)` = -1517(PDB 505 의 "~21000" 과 다름, com_dio 표 20001~20064 가 맞음). 1646/1646. 0.27.12 | 본문 ↓ |
| §1-HC | 11-05 | **수신함 Sample Prep 보고 11건 — 멀티 에이전트 처리** — 라이브러리(`ProjectLibrary`) 소스 거터 BP 를 `Set Break <lib> "<file>"` 로(`breakpointSendTarget` 단일화, 못 보내면 verified:false), MCP `<lib>/<file>` 재작성·`atRequestedLine` 정규화, Delegate·AddressOf 진단 5종(-205/-712/-741/-729), `source-missing` 낡은 진단(세대 키 캐시·외부 변경 워처), 런타임 콘솔 정체 감지(`parserStalled`), MCP `unload_project` 생략 = 세션 대상(-all 은 `all:true`)·/GPL 비우기 Idle 통과·디버그 세션 가드(`confirmDebugSession`)·작업 기록 `libraryUploads`·비운 뒤 rebootHint 억제·FTP 타임아웃 재시도 금지·검색 `maxResults`. 1688/1688 · MCP 188/188. 0.27.13 | 본문 ↓ |
| §1-HD | 11-06 | **배포 전처리(메모리 절약)** — 수신함 Sample Prep 2건: `gpl.deploy.preprocess`(기본 꺼짐, `projects.<ProjectName>`·MCP `preprocess` 덮어쓰기). 워크스페이스 밖 `<tmp>/gpl-controller/preprocess/<ip>/…` 사본을 올림 — 주석·`#` 줄·공백 제거(줄 수·줄바꿈·바이트 유지, `sourceMinify`), 실행 프로젝트에서 이름으로 닿지 않는 라이브러리 파일 제외 + 사본 .gpr 고쳐 쓰기(`sourceReachability`: 모듈 이름 생략 규칙·문자열 진입점·점 뒤 멤버 제외·자기 이름 가림), 예전 업로드분 삭제, `-729` 안내, 결과 `preprocess`. 실데이터 dry-run 2.12 → 1.30 MB · PaL 5파일 제외(요청 스크립트의 7개 중 2개는 실제 사용). `Mid(<임시 문자열>, …)` 누수 진단(`mid-temporary-argument`)·문서 「메모리 아끼기」. 1706/1706 · MCP 188/188. 0.27.14 | 본문 ↓ |
| §1-HE | 11-06 | **GPL source-to-source 최적화기 — 선언 단위 미사용 제거** — `gpl.deploy.preprocess.removeUnusedMembers`: 엄격한 선언 스캐너(`memberScan`, 모르는 문장이면 그 파일 손대지 않음)·선언 그래프 도달성(`memberReachability`: 모듈 이름 생략·자기 모듈 가림·점 뒤 클래스 멤버·New·Sub Init·부작용 초기화·keep `Container.Name`), 줄 비우기(줄 번호 유지), 파일 단위 제외에 모듈 Init 출발점 추가. Sample Prep dry-run 350선언·3,726코드줄(컴파일 ≈400 KB 추정), 남은 이름 52건 수동 대조 모두 다른 모듈 것, 2차 실행 0. 1714/1714 · MCP 188/188. 0.27.15 | 본문 ↓ |
| §1-HF | 11-06 | **최적화기 정밀도·범위 확장 + 컴파일 메모리 추정 + 메모리 진단 보정** — Sample Prep 실측(_mem.zip cost-table·unreferenced-members)·ChatGPT 정리 반영: 문자열은 이름 모양만 참조, 매개변수·맨 바깥 지역 가림, 안 쓰는 지역 Dim(87 B)·빈 Module(≈190 B) 제거, `compileCostModel`(원본 4.09 MB 추정 vs 실측 4.13 MB) → `preprocess.estimatedCompile`. 스테이지 dry-run 컴파일 4.1 → 3.5 MB 추정·소스 2.0 → 1.0 MB, 보고서 미참조 299개 중 249개 일치. Mid 누수 조건 정밀화(사용자 Function 결과 제외), `string-field-empty-init`(+183 B/칸), 문서 스레드 정정. 1719/1719 · MCP 188/188. 0.27.16 | 본문 ↓ |
| §1-HG | 11-13 | **수신함 Sample Prep 보고 11건 — 4갈래 병렬 처리** — MCP: 미연결 창 `extension-disconnected` 즉시 거부·작업 폴더 양방향 일치·창 고정(`extension_resolve`)·런타임 콘솔 세션 대상 경로(`routeMismatch`)·`bridge-host-mismatch`·번들 다운그레이드 방지·버전 경고, 제어기 IP 워크스페이스별 기억(`workspaceState`)·`autoConnectOnStartup`(opt-in); 제어기 정체 `controllerIdentity`(pd 110/114)·`expectedSerial`·스택 사용률·DataID 307 안내·전원 pd 230; 진단 `missing-final-newline`(-505)·`create-directory-device-root`(-300)·`thread-entry-without-catch`, Catch 정정 문서; 전처리 `Device_HanyoungML` 오포함(매개변수 가림·선언 줄 자기 이름) 수정·`preprocess.kept`, 라이브러리 출처(SVN·업로드 해시)·`gpl.deploy.libraryPreflight`. 1752/1752 · MCP 206/206. 0.27.17 | 본문 ↓ |
| §1-HH | 11-13 | **시뮬 제어기 실기 시험 — 디버깅·배포 점검과 수정** — 4.2K5 실측: `Exit Property` -719(`exit-property-rejected`)·`:` 문장 구분 -722(`statement-separator-colon`)·이름 없는 `Show Variable` -505(listLocals 를 로컬 소스 + -eval 로)·`Show Stack` 호출자 프레임은 다음 문장 줄(`callSiteLine` 로 호출 줄 복원)·run_to_line 빈 줄 → 다음 실행 줄(`adjustedTo`), 런타임 콘솔 NUL 로 인한 `PARSER_STALLED` 오판 해소, 배포 ErrorLog 이번 배포분만(`errorLogSinceDeploy`), FTP LIST 시각 2001년 수정, 콘솔 읽기 `remaining`·`matchAheadSeq`, 스택 열 순서·controllerIdentity·pd 230 실기 확인. 1759/1759 · MCP 213/213. 0.27.18 | 본문 ↓ |
---

**최근 세션 본문 — §1-GY ~ §1-HH (2026-11-04~11-13).** 이 아래부터는 세션 원문이다.

> §1-FR은 독립된 로컬·원격 작업에서 중복 사용됐다. 기존 참조와 원문을 보존하며, PR #36 병합 검증과 제어기 프로젝트 디버깅을 제목·개별 링크로 구분한다.

## 1-GY. 2026-11-04 세션 — AI 지침 정리: AGENTS.md 정본화 · ai-handoff 다이어트 · 하드 규칙 번호 통일 (문서 전용, 버전 변경 없음)

### 증상(요청)

- "프로젝트 지침을 개선하는 게 좋을 것 같다 — 지금 어떻게 되어 있나" → 현황 요약 보고 뒤 "사용자 요청 이력을 확인해 보며
  권장 방식으로 개선해 달라".

### 원인(검토 결과)

1. **사본 드리프트** — `CLAUDE.md`·`AGENTS.md` 가 같은 내용의 사본이라 이미 어긋나 있었다(R10 문구·`scripts/dev/` 줄이 AGENTS 에
   없음, AGENTS 끝에 Cowork 시절 문구 「함부로 편집하지 마세요」 잔재).
2. **필독 문서 재팽창** — `ai-handoff.md` 1,506줄/290KB(08-31 정리 때 960줄). §3 이 133KB(46%)였고 그 대부분이 버전마다 하나씩
   쌓이고 닫히지 않는 "새 VSIX 실사용·실기·UI 확인"이었다. §1-0 인덱스도 60KB. 헤더·§1 10세션 규칙은 지켜졌지만 §3·인덱스에는
   상한 규칙이 없었다.
3. **낡거나 충돌하는 서술** — Copilot 지침의 "`docs/`=GPL 로봇 프로젝트 문서", "VSIX 경로만 안내", 없어진 `_debug_cycle.ps1`;
   release/typescript 지침의 "README 버전 동기화"(실제로는 `pre-release-check` 가 README 버전 표기를 **금지**); "커밋은 요청 시만"
   (10-27 이후 커밋은 자유, push·태그·릴리스만 확인).
4. **하드 규칙 번호 2벌** — 옛 CLAUDE.md 요약은 6=모션 규칙, §0 은 6=`Stop` 접수. 소스 주석이 "하드 규칙 6"(모션)과 "§0.6"(Stop)을
   섞어 썼다. 요약에는 §0.6·§0.8 이 빠져 있었다.
5. **요청 이력에만 있던 방침** — Claude Code 대화 77개의 사용자 메시지 216건을 훑어 보니, 저장소 지침에 없고 auto memory 에만
   있던 방침이 있었다: 커밋 자유/push 확인(10-27), 사용자 대면 문구 합쇼체·지시투 금지(09-11, 저장소 기록 없음), 패널 포커스
   강제 금지·로그 기본 켬(10-27), `/flash/projects` 제안 금지(11-03), 넓은 위임 방식(09-07·10-27), 하위 모델(10-27).
   memory 는 Claude 에만 보이므로 Codex·Copilot 은 이 방침을 몰랐다.

### 조치(의도와 방법)

- **21e9d82 — 지침 정본 하나로.** `AGENTS.md` 를 정본으로 재작성(읽는 순서·작업별 정본 표·작업 방식·하드 규칙·제품 규칙·
  마칠 때·구조 규칙·저장소 구조). `CLAUDE.md` 는 `@AGENTS.md` import + Claude Code 전용(MCP·하위 모델·worktree·세션 조율)만.
  Codex·Copilot 은 AGENTS.md 를 직접 읽는다. 기록 세칙은 `docs/development/record-keeping.md` 로 분리(mkdocs nav 등재).
  `.github/copilot-instructions.md` 는 AGENTS.md 를 가리키는 허브로, release/typescript 지침의 낡은 서술 정정.
  "CLAUDE.md 하드 규칙 N" 참조(ci.yml·bundle-mcp.js·src 주석 3·architecture.md·docs/README)를 AGENTS.md 로.
- **이 커밋 — ai-handoff 다이어트.** §3 의 실사용 확인 항목 117개를 `docs/ai-handoff-verification.md` 로 원문 그대로 옮기고
  (분류는 제목 기준 스크립트 + 결정·조사·리팩터링 류 제외, 목록 검토 후 적용), §1-0 의 아카이브 행 196개를
  `docs/archive/handoff/index.md` 로 옮겼다(링크 경로만 상대 경로로 고침). 두 파일 모두 MkDocs 제외. 아카이브 5개의
  "전체 세션 인덱스" 안내를 새 파일로. §1-GO 를 2026-10 아카이브로(10세션 유지).
- **하드 규칙 번호 통일.** §0 번호를 정본으로: §0.4 를 "리눅스 샌드박스에서만"으로 한정, 모션 규칙을 §0.9 로 편입, `/flash/projects`
  를 §0.10 으로 신설. 소스 주석의 "하드 규칙 6"(모션 의미) 10곳(src 7파일)과 문서 10곳을 "하드 규칙 9"로 — "§0.6"(Stop 접수) 참조는
  그대로 둔다. 아카이브 원문은 고치지 않았다(AGENTS.md §4 에 옛 번호 안내).

### 검증

- `npx tsc --noEmit` 통과, `npm test` **1608/1608**(src 변경은 주석뿐).
- 옮기기 무손실: `git diff` 의 삭제 줄이 체크리스트 항목·인덱스 행·들여쓴 연속 줄·빈 줄뿐인지 필터로 확인(그 밖의 삭제 0).
  `ai-handoff.md` 290KB → 약 120KB.
- 버전·VSIX 없음(문서·주석 전용, 사용자 대면 동작 변화 없음).

### 남은 일

- §3 결정: `ai-handoff-verification.md` 117건 중 08~09월 항목 다수는 이미 실사용으로 확인됐거나 이후 변경으로 무의미해졌을
  가능성이 크다 — 사용자와 한 번 훑어 일괄 정리할지.
- Copilot 이 `chat.useAgentsMdFile` 로 AGENTS.md 를 실제로 읽는지는 문서상 동작이다 — Copilot Chat 에서 확인 안 함.
- 작업 중 실수: git-bash `sed -i` 가 CRLF 파일의 CR 을 지운다(인덱스는 LF 라 git 내용 변화는 없음). 작업 트리 EOL 이 바뀌었을 수 있는
  파일: ci.yml·bundle-mcp.js·deployStartStage.ts·remoteSourceMapping.ts·architecture.test.ts·architecture.md·docs/README.md.

## 1-GZ. 2026-11-04 세션 — 프로젝트 문제점 리뷰 후속: 명령 안전 · 정지 판정 경합 · 메모리 자동 회수 · 의존성 (0.27.10)

### 증상(요청)

1. "프로젝트 문제점 검토 리뷰" — 테스트·CI·의존성·문서를 직접 보고, 디버그 세션·제어기 통신·MCP 안전 장치는 검토 에이전트 3개로 나눠
   찾은 뒤 핵심 항목을 코드로 다시 확인해 보고했다(안전 S1~S7, 디버거 D1~D8, 통신, 도구, 프로세스).
2. 사용자 결정: "AI 가 Unload 는 가능해야 한다 — 반복 컴파일에서 매번 허가받으면 불편하니 램이 부족하면 자동으로 Unload 하고
   진행하도록. 나머지는 권장 개선 방향으로 수정." 자동 Unload 범위는 「대상 외 로드된 것도 전부」, 그룹 Compile 표시가 있으면
   「자동 Unload 건너뛰기」(질문으로 확인).

### 원인(리뷰에서 확인한 것)

- **명령 한 줄 검증 없음(S1)**: `controller_command` 문자열이나 `thread`·`expression`·`file` 인자에 CR/LF 가 있으면 제어기는 두 명령으로
  실행하는데, Unload 위험·배포 잠금·명령 정책·재전송 안전 판정은 첫 단어만 봤다(`Show Thread\r\nUnload -all` 이 조회로 분류).
- **전달 뒤 재전송(S2)**: keep-alive stale 재시도가 "write 성공 뒤 0바이트 close/error" 에도 같은 명령을 새 연결로 다시 보냈다(확장
  `consoleSocket`·MCP `console.js` 둘 다) — 제어기가 실행 뒤 끊은 경우(Unload 사례)와 구별할 수 없어 Start/Unload/Step 이중 실행 위험.
- **브리지 대기열 막힘(S3)**: 확장 브리지는 요청을 하나씩 처리하고 실행 상한이 없어, 확인 창 등으로 끝나지 않는 명령 하나가 뒤의
  `softestop`·`stop_threads` 를 막았다.
- **URI 무인증(S7)**: 웹 링크로 `vscode://…/gpl.controller.sendCommand?command=…` 를 열면(허용 창 "다시 묻지 않음" 뒤) 명령이 나갔다.
- MCP `step_thread`·`continue_thread`·`run_to_line` 은 사전 상태 조회가 실패하면 그냥 진행했고(S5), `run_to_line` 은 예외 시 임시 BP 가
  남았다(S6). `untilPattern` 정규식은 확장 호스트에서 그대로 실행됐다.
- **줄 번호 140**: `stripXmlTags` 가 태그만 지워 `|14</DATA><STATUS>0` → 줄 140. 직접 재현(배포 재생 하니스 기준 커밋도 이 버그로 10 을 냈다).
  `parseStatus`·연결 프로브는 여는 `<STATUS>` 만 봐서 잘린 응답의 숫자를 코드로 읽을 수 있었다. 1402 는 `ascii` 로 송수신해 한글이 깨졌다.
- **디버거**: 액션 전에 나간 폴 응답이 pending step 에 적용돼 옛 줄로 스텝 완료(D1/D2), 쓰레드 종료 시 continue 외 pending 미해제,
  이미 Paused 쓰레드의 Pause·Error 로 남은 Step 이 끝나지 않음, `_userActionInFlight` 불리언, disconnect 뒤 이벤트, 같은 파일
  `setBreakPointsRequest` 겹침.
- **도구**: basic-ftp 5.3.0 보안 권고 2건, CI Node 20(EOL), `@types/vscode` 1.116 설치(engines 1.74), 작업 트리 EOL 혼재.

### 조치(의도와 방법)

- **1402 명령(7933122)** — `consoleSocket.invalidCommandReason`·MCP `console.invalidCommandReason`·`batch.normalizeCommandInput` 이 CR/LF·C0
  제어 문자를 거부(`INVALID_COMMAND`, sent:false, 연결도 열지 않음). stale 재시도는 write 실패면 항상, 전달 뒤면 조회 명령만
  (`retryAfterDeliveryIsSafe` ← `isReadOnlyConsoleCommand`, MCP 는 `isRetrySafeCommand`), 그 외는 sent:true 로 reject. 송신 UTF-8, 수신 latin1 누적
  → `latin1ToUtf8`(본문 실시간 표시는 StringDecoder). idle 조기 완료도 `afterPendingIo` 뒤 + 마지막 chunk 시각 재확인. `stripXmlTags` 닫는
  태그 → 줄바꿈, `parseStatus`·`probeOutcomeFromResponse` 는 닫힌 `</STATUS>` 만. 1403: payload 수신 시 백오프 리셋, `connect` 동기 예외 복구,
  종료 시 수신 플래그 리셋.
- **AI 안전(daa26d8)** — 브리지 `runsOutsideBridgeQueue`(Stop·SoftEStop·Break sendCommand·runtimeConsoleRead 는 대기열 밖), 직렬 요청은
  `bridgeQueueStallLimitMs`(TTL+15 s) 넘으면 다음으로. URI 는 `uriCommandNeedsToken` — 조회 3종·별칭 밖은 `token=` 이
  `%TEMP%\gpl-controller\uri-token`(`uriToken.ensureUriToken`, PC 사용자 단위 1개)과 같아야 실행(런북 갱신). MCP `threadStateUnknownRefusal`,
  `run_to_line` try/finally, 정규식 200자·중첩 수량자 거부.
- **디버거(02aac31)** — `_actionSeq`(액션 시작마다 증가, 폴 시작 값과 다르면 응답 폐기·재폴), 종료 쓰레드의 모든 pending 해제,
  `pauseOnAlreadyPaused`, Error 로 남은 step/pause 완료(exception), `_userActionsInFlight` 카운터, 폴 반복의 await 뒤 연결 확인,
  disconnect 에서 `_previousThreadStates`·`_pendingThreadId` 초기화, Continue 연속 Paused 확정에 500 ms 하한, `setBreakPointsRequest` 파일별 직렬화
  (본문 `_setBreakPointsNow`, SIZE_DEBT 이름 갱신).
- **메모리 자동 회수(df563f4, 신규 `controller/deployment/deployMemoryRecovery.ts`)** — 업로드 전 측정이 경고(warnMb) 미만이면 정지 게이트 →
  재측정 → 여전히 모자라면 `/GPL` 폴더 중 실행 프로젝트를 하나씩 `Unload`(대상은 맨 끝, 180 s·`</STATUS>` 대기) → 재측정 → 업로드.
  업로드 전에 하는 이유: `Unload <앱>` 은 `/GPL/<앱>` 을 지운다(10월 실측). 대상을 내렸으면 변경 파일만이 아니라 전체 업로드, 업로드 지문
  폐기. 그룹 Compile 표시가 있으면 통째로 건너뜀(문구는 `unloadRiskWarning` — R7), 그룹·워크스페이스 밖 프로젝트는 Unload 안 함,
  Upload Only·skipStop·autoOnSave 제외, 결과 미확정이면 업로드 전에 멈춤(MEMORY_CHECK). 설정 `gpl.controller.memoryGuard.autoUnload`(기본 켬),
  `result.memoryRecovery`·작업 요약·MCP 지침 한 줄. 메모리 안내 문구의 "Unload 는 자동으로 하지 않는다" 는 고쳤다.
- **의존성·CI(5621847)** — basic-ftp 6.2.5(6.0 의 PASV 다른 호스트 거부는 실기 확인 전까지 `allowSeparateTransferHost:true`), 최소 FTP 서버
  회귀 테스트(`basicFtpCompat.test.ts`), `@types/vscode ~1.74.0`(오류 0), `npm audit fix`(개발 13 → 5), CI Node 22, `.gitattributes`(`* text=auto eol=lf`,
  인덱스 변경 0).
- **결정으로 바꾸지 않은 것** — S4(AI 가 `clearUnloadRisk{confirm:true}` 로 위험 표시를 지울 수 있음): 사용자 결정 "AI 도 Unload 할 수
  있어야" 에 따라 그대로 둔다. 명시적 위험 Unload 는 여전히 confirm:true 가 필요하다.

### 검증

- `npm test` **1630/1630**(신규 22건), `controller-mcp` `node --test` **174/174**(신규 6건).
- `scripts/dev/deployReplay.js`: 이 세션 전 커밋(19f96e6)을 따로 빌드해 같은 하니스로 돌린 결과 6건 차이(앞선 의도된 변경)였고, 지금은
  10건 — 늘어난 4건은 모두 줄 번호 10 → 1(fixture `|1</DATA><STATUS>0`) 버그 수정이다. 메모리 충분 경로의 명령·이벤트 순서는 같다.
- 실기·UI 는 돌리지 않았다 — `docs/ai-handoff-verification.md` §1-GZ 항목.
- VSIX: `dist/gpl-language-support-0.27.10.vsix` — 1,722,568 bytes, SHA-256 `58AEE1A29D389F48BCF8956BB3E76C46D6F4178B36BC1772FD312DB14C88FC47`. 경고는 기존과 같은 번들링 권고(371 파일)뿐, 실패 없음. 번들 basic-ftp 6.2.5 확인.

### 남은 일

- 실기 확인(verification §1-GZ): 메모리 자동 회수 실제 회수량·Unload 소요, basic-ftp 6 실제 제어기 FTP(PASV 주소가 접속 IP 와 같으면
  `allowSeparateTransferHost` 줄 삭제), URI 토큰, 한글 프로젝트명 1402 송수신.
- §3: `@vscode/vsce` 메이저 업그레이드(개발 의존 취약점 5건), D6(폴 중 예외 시 정지 알림 유실 — 낮음), `setBreakPointsRequest` 직렬화 테스트.

## 1-HA. 2026-11-04 세션 — 대시보드 축 위치 리밋 막대 · 추이 그래프 통합 · 전원/축/좌표 DataID 전환 · I/O 클릭 토글 (0.27.11)

### 증상(요청)

"축 상태를 바 형태로 어디 위치로 움직인 상태인지 한눈에 전부" + "그래프 모양이 별로고 보기 어렵다, 몇 개 안 되니 통합" +
(작업 중) "I/O 는 더블클릭해야 전환된다 — 클릭으로 전환, 더블클릭으로 해제".

### 원인(관측 — 실기 192.168.0.1, G2400C 4.2K5, 단일 축 로봇 5대 구성)

- 기존 축 게이지는 축 한계를 몰라 "세션 중 본 |max|" 로 스케일했다. 게다가 데이터 자체가 없었다:
  `Execute Robot.WhereAngles`·`Execute Robot.Where` 는 STATUS 0 에 DATA 없음, `Execute Controller.PowerEnabled` 는 **-712**.
  Execute 는 식의 값을 돌려주지 않는다(문서상 "assignment statement or a function reference" — execute_cmd.htm).
  `Execute Console.WriteLine(CStr(...))` 는 값을 1402 DATA 로 돌려주지만(1403 에는 안 나옴) 명령 길이 상한이 **136자**(137자부터 `-506 *Input too long*`)라
  한 줄에 축 2~3개뿐이고, Execute 는 `_Cmd_<project>` 쓰레드를 만든다(§3 의 Unload 지연 보고).
- 읽기 전용 DataID 로 전부 된다(실측 STATUS 0): `pd 3504, r`(Actual joint angles, RO), `pd 3506, r`(Actual Cartesian, RO),
  `pd 230`(Power state = 12), `pd 116`(Robot types `1,1,1,1,1,0…`), `pd 2002, r`(이름 "Track"·"H1 evZ"), `pd 16077/16078, r`(소프트 리밋, NP).
  없는 로봇은 `-1001 *Undefined robot*`, 없는 unit 리밋은 `-1509`.
- 그래프: 스파크라인 4개가 온도·자원 카드에 흩어져 있었고 `preserveAspectRatio="none"` 이라 점·선이 늘어났으며 눈금이 없었다.

### 조치(의도와 방법)

- **2b73521 — 순수 모듈 `controller/diagnostics/robotAxes.ts`**: pd 파서(따옴표 밖 `=`·콤마, wrap), 116 연속 목록(0 이 끝),
  type 1·7 은 Cartesian 없음, 리밋 정규화(max>min·|v|<1e6), 230 상태 문구. 샘플러는 구성(116·2002·16077·16078)을 캐시하고
  수동 갱신·재연결·실패 후 진단 주기에만 다시 읽으며, 폴링은 쓰레드 + 230 + 로봇별 3504 + (kinematics 로봇) 3506. **Execute 를 쓰지 않는다.**
  근거: PDB `Robot_Calibration/stop_limits.htm`·`Joint_Cartesian_Control/datalogging.htm`·`Controller_Settings/operationmodes.htm`·
  `Controller_Settings/system identification.htm`.
- **bdbaf9f — 웹뷰**: 축 카드(전체 폭) 로봇·축마다 막대 하나(양끝 = 소프트 리밋, 채움·표식 = 현재, 5% 근접 주의·밖 오류·이동 중
  방향/변화량·%, 리밋 없으면 관측 범위 점선), 요약 줄. 「추이」 카드 하나에 CPU·앰프 온도·여유 메모리·accepted/s·clusters free 를
  같은 차트 함수로(실제 픽셀 폭·y 눈금·영역·임계선 라벨·현재값·호버, null 끊김, ResizeObserver). 직교 좌표 카드는 로봇 번호 /
  조인트 전용이면 그 사실. 전원 배지는 230 문구. I/O 칩 클릭 = 강제 토글(250 ms 미룸), 더블클릭 = 강제 해제(강제된 것만, 토글 취소).
  카드 접힘은 `data-card` 이름으로 저장. 테스트 하니스 공용화(`dashboardHarness.ts`).

### 검증

- `npm test` **1646/1646**(신규 16건: robotAxes 7·dashboardCharts 6·dashboardDio 3). 실측 원문을 fixture 로 고정.
- 브라우저(Edge headless) 미리보기로 다크·라이트·좁은 폭(560px) 배치 확인 — 모의 데이터.
- 실기: 위 DataID·Execute 응답은 MCP 로 직접 확인. **새 확장 코드로 대시보드를 실기에 띄우지는 않았다**(사용자 창은 0.27.5) — verification §1-HA.
- VSIX: `dist/gpl-language-support-0.27.11.vsix` — 1,732,533 bytes, SHA-256 `A3836FEB1220F664CF369181279E406D40DD7224CE08D2DE042C26EF8970CA31`.
  경고는 기존 번들링 권고(372 파일)뿐. `pre-release-check` 는 「main 브랜치 아님(codex/domain-modules)」만 실패(작업 트리는 커밋 후 깨끗).

### 남은 일

- §3: MCP `controller_status` 의 `powerEnabled` 도 `Execute Controller.PowerEnabled`(4.2K5 에서 -712)라 항상 실패할 것 — `pd 230` 으로 바꿀 것.
- `CStr` 이 아닌 DataID 라 정밀도 문제는 없다. 다중 로봇의 직교 좌표는 kinematics 가 있는 첫 로봇만 보인다(필요하면 선택 UI).

## 1-HB. 2026-11-04 세션 — 대시보드 I/O 칩 8열 격자 · Soft DIO 64 상한 실측 (0.27.12)

### 증상(요청)

"2만번대는 64개 — 어디서 많이 본 숫자 아니야? 정렬 깔끔하게. 크기 맞춰 자동 줄바꿈이 아쉽다, 직사각형으로 줄바꿈되게.
그리고 soft IO 더 많이 쓸 수도 있지 않아?"

### 원인·관측(실기 192.168.0.1, G2400C 4.2K5)

- 칩이 `flex-wrap` 이라 그룹 폭에 따라 한 줄 개수가 제각각이었다(64개가 9·7·… 로 끊김).
- Soft 범위: 문서 둘이 다르다 — com_dio.htm 표는 `20001 - 20064`, PDB io.htm DataID 505 는 "20001 ~ 21000".
  실측: `Signal.DIO(20064)` 값 반환, `Signal.DIO(20065)`·`(21000)`·`(21001)` 은 **-1517 *Invalid signal number***,
  `Show DIO 20065` 빈 응답. `pd 505, 1..16` 은 64개씩 전부 `2`(configured)를 돌려주고 `pd 505, 17` 은 -1509 —
  unit 2~16 의 "configured" 는 실제로 접근 가능한 신호가 아니다. **이 펌웨어의 Soft DIO 는 64개가 상한**이고 늘리는 설정은
  문서에서 찾지 못했다.

### 조치

- **5c153d0** — 칩을 8열 격자(`--dio-cols: 8`, 460px 이하 4열)로. 64 = 8×8, bank 96 = 12×8 이라 모든 그룹이 같은 폭의
  직사각형이 된다. 그룹은 multi-column 단(`columns: 33em`)에 위에서부터 쌓아 키가 다른 그룹 사이 빈칸을 없앴다(`wide` 제거).
  `dioGroups.ts` 머리 주석에 Soft 상한 실측과 문서 불일치를 기록.

### 검증

- `npm test` 1646/1646. 모의 데이터 미리보기(Edge headless) 다크 1100·700·520px, 라이트 1300px — 8×8 정렬·5자리 번호 잘림 없음.
  (headless 창 최소 폭 때문에 460px 이하 4열은 화면으로 확인하지 못했다.)
- 실기 대시보드 화면은 미확인 — verification §1-HB.
- VSIX: `dist/gpl-language-support-0.27.12.vsix` — 1,733,002 bytes, SHA-256 `2ED0313C05C408C05FF08A356319979325D8C45413DA2ABF8D66E595F5F5D233`.
  경고는 기존 번들링 권고뿐.

### 남은 일

- 세마포어가 64개보다 많이 필요하면 Soft DIO 가 아니라 GPL 전역 변수/`Thread` 이벤트 쪽이다(문서 확인 후 안내).

## 1-HC. 2026-11-05 세션 — 수신함 Sample Prep 보고 11건, 멀티 에이전트 처리 (0.27.13)

### 증상(요청)

"GPL 확장 개선 요청 로컬에 자료들 넘어온거 확인해서 멀티 AI로 작업들좀 진행시켜줘. 토큰 절약형으로."
수신함 최상위 11건(11-02 ~ 11-05, 전부 Sample Prep). 102-antibody-96ch-d4 세션이 라이브러리 BP 건을 SendMessage 로도 보냈다.

### 진행 방식

- `main` 이 HEAD 보다 98커밋 뒤라 `isolation: worktree` 대신 HEAD 에서 `git worktree add`(`%TEMP%\gpl-wt-*`, node_modules 는 junction)로
  4갈래를 만들고 Sonnet 에이전트를 병렬로 돌렸다. 브랜치 `inbox/{mcp-ops,bp-path,delegate-diag,stale-fixes}` 를 `--no-ff` 병합(충돌 없음).
- 실수: 패키징 뒤 `npm run package` 를 한 번 더 돌려 0.27.14 로 올라갔다 → `npm version 0.27.13` 으로 되돌리고 0.27.14 VSIX 삭제.

### 조치(원인 → 수정)

- **라이브러리 BP**(79287e6·08b9281) — 거터 `setBreakpoints` 가 `ProjectLibrary` 형제 폴더 파일을 조용히 버렸다. 이 트리의 AI 경로도
  `library-source-breakpoint-unsupported` 로 거부했다 — 보고자가 알려 온 설치본 0.27.12 의 AI 경로 성공 로그는 기대 프로젝트가 Gantry 자신으로 풀려 `direct-source` 가 된 경우로 보인다(App 기준이면 거부, 추정). `project/remote/breakpointTarget.ts`
  `breakpointSendTarget()` 한 곳이 `Set Break <라이브러리 ProjectName> "<라이브러리 기준 경로>"` 를 정하고 DAP·AI 가 함께 쓴다.
  못 보내면 verified:false + `⚠ BP 전송 생략` 한 줄. MCP `set/clear_breakpoint`·`run_to_line` 은 `<lib>/<file>` 을 재작성(`libraryLocation.js`),
  `atRequestedLine` 은 `sameSourceFile` 로 비교. 에디터 live-sync(`breakpointSync`)는 여전히 라이브러리를 보내지 않고 로그만 남긴다.
- **Delegate 진단**(e0baf7a) — `language/checks/delegateChecks.ts`: `addressof-without-delegate`(-205/-712, 빠른 수정 감싸기),
  `addressof-me-prefix`(-741, `Me.` 삭제), `delegate-parameter-direct-call`(-729), `delegate-signature-mismatch`(-741, 오버로드 하나라도
  맞으면 통과, 숫자 형끼리는 같게 봄 — 미실측), `mid-member-access`(-712 경고). 보고의 「확인된 형태」 표는 거짓 경고 방지 테스트로 고정.
  `compilerChecks.ts` 의 줄 스캔 헬퍼를 `logicalLines.ts` 로 옮김(같은 커밋 — §7.2 분리 규칙 예외).
- **source-missing 낡음**(0b459ee) — 파일 의존 캐시가 본문만 키로 써서 모듈 이동 뒤 옛 대응을 돌려줬고, 재검사가 `onDidSave` 에만 걸렸다.
  `SymbolIndex.generation` + `fileDepsCache.ts`(본문+세대 키), `**/*.{gpl,gpr}` 워처로 외부 변경 재검사.
- **런타임 콘솔 정체**(fb4614c) — 원인 미확정(후보: `processConsoleText` 예외 뒤 `carry` 잔류, 개행 없는 type-3 청크 누적, 다른 창 수신).
  `controller/runtime/parserStall.ts` 가 판정해 쥔 바이트를 버리고 `EVENT=PARSER_STALLED/EXCEPTION` 줄로 남김, 상태에 `parserStalled`·`lastLineAt`.
- **MCP 운영 안전**(4da7511·85e45d7·8a11169·195f733·dfb7414·92d67e6) — `clear_remote_folder` AI 경로는 `stop_threads` 와 같은 `isSettledState`
  (`judgeAiClearThreadGate`)로 Idle 만 남으면 통과, 거부 시 전체 목록+`recommendedAction`(사람 트리 명령은 종전대로 모든 쓰레드가 막음).
  `unload_project` 생략 = 세션 대상, 없으면 `UNLOAD_TARGET_REQUIRED`, `-all` 은 `all:true` — **§1-GR(11-03)의 "생략 = -all" 결정을 MCP 에서만 뒤집음**
  (사람 경로의 Unload -all 기본은 그대로). 디버그 세션 중 Unload·비우기·범위 없는 Stop 은 `refused:"debug-session-active"` → `confirmDebugSession:true`.
  작업 기록에 `libraryUploads`, 비운 지 5분 안의 채널 유실엔 rebootHint 억제, FTP 타임아웃 `recovery` = 재시도 금지·`controller_status` 먼저,
  `runtime_console_search` `maxResults`(200)·`latestFirst`·`maxChars`(30000).

### 검증

- 병합 트리 `npm test` 1688/1688, `controller-mcp` 188/188. 제어기 접속 없음(실기 확인은 verification §1-HC).
- VSIX: `dist/gpl-language-support-0.27.13.vsix` — 1,754,161 bytes, SHA-256 `0C980A291E4BB37639A8BFE9A289472C20CA1ED28147E77005B90E1B27086956`.

### 남은 일

- 보류한 수신함 항목은 §3 「(2026-11-05, §1-HC)」.
- worktree 4개(`%TEMP%\gpl-wt-*`)와 `inbox/*` 브랜치는 병합 뒤 정리.

## 1-HD. 2026-11-06 세션 — 배포 전처리: 주석 제거 · 미사용 라이브러리 파일 제외로 제어기 메모리 절약 (0.27.14)

### 증상(요청)

"로컬 요청 들어온 내용들이 있을텐데, 메모리 최적화를 위한 작업부터 기능좀 개선해서 만들어줘."
수신함 최상위 8건 중 메모리 관련 2건(Sample Prep Binder 8Ch, 실행 중 Free 0.40 MB):
`2026-11-05_SamplePrep_gpl-source-memory-strip-purge_v1`(주석 제거 업로드 #40 · 컴파일 뒤 /GPL 비우기)과
`2026-11-06_SamplePrep_deploy-preprocess-options_v1`(파일 단위 tree-shaking · 주석 제거 · 그 밖의 경량화). 나머지 6건은 다음 세션.

### 원인(요청의 실측)

- `/GPL` 에 올린 소스는 제어기 메모리에 그대로 남는다 — 주석만 빈 줄로 바꾼 사본은 업로드 몫이 0.93 MB 줄고 컴파일 결과는 같았다(11-05).
- 문서상 라이브러리는 쓰는 프로젝트마다 통째로 함께 컴파일된다(GDS gpl_projects.htm). 범용 라이브러리 PaL 은 저장소에 통째로 두기로 했으므로(사용자 결정)
  워크스페이스가 아니라 **배포 사본**에서 줄여야 한다.

### 조치(의도와 방법)

- **설정** `gpl.deploy.preprocess`(리소스 범위, 기본 꺼짐): `stripComments`·`trimWhitespace`·`excludeUnreachableLibraryFiles`·`keepFiles`, `projects.<ProjectName>` 로 프로젝트별.
  MCP `deploy_project.preprocess`(객체 또는 `false`)가 호출 단위로 덮어쓴다(`resolvePreprocessOptions`: 공통 < 프로젝트 < 인자, keepFiles 는 합침).
- **사본**(`deployPreprocessStage.ts`): direct /GPL 업로드에서만 `<tmp>/gpl-controller/preprocess/<ip>/<원격 경로>` 에 만들고, 프로젝트 미러·autoOnSave 변경 파일·라이브러리
  업로드가 사본을 올린다. 클래식(flash + Load) 경로는 원본(사본이 /flash 에 남지 않게), 실패하면 원본 + 경고. Save to Flash 는 원래 로컬 원본을 미러한다 — 요청의
  "Save to Flash 가 전처리 사본을 저장" 우려는 이 확장에는 해당 없음. 지우기는 `fs.rmSync` 대신 unlink/rmdir(비ASCII 경로 크래시 회피).
- **줄 경량화**(`project/sources/sourceMinify.ts`): 문자열 밖 `'` 부터 줄 끝·`#` 줄 제거, 앞뒤 공백·탭 제거. 줄 수·줄바꿈(CRLF/LF/CR)·UTF-8 BOM 유지,
  latin1 1:1 이라 UTF-8·CP949 바이트가 깨지지 않는다. 근거(문서상) statementstructure.htm.
- **미사용 제외**(`project/sources/sourceReachability.ts` + `deployPreprocess.planTreeShake`): 출발점 = 실행 프로젝트 소스 + 이 배포가 올리지 않는 라이브러리 소스 + keepFiles.
  선언 이름 = Module·Class + **모듈 직속 비-Private 멤버**(문서상 "이름이 모든 모듈에서 유일하면 모듈 이름 생략 가능", modules.htm·scope_names.htm — 요청 스크립트는
  Module/Class 만 봐서 생략 호출을 놓친다). 문자열 안 이름 포함, 점 뒤 낱말(멤버 접근) 제외, 파일이 모듈 직속으로 선언한 이름은 그 파일에서 가림, 같은 Module 을
  나눠 쓴 파일은 묶음, 선언 없는 파일·못 읽은 출발점 파일은 보수적으로 처리. 사본의 라이브러리 .gpr 에서 그 `ProjectSource` 줄을 빼고, 예전 업로드로 라이브러리
  원격 폴더에 남은 제외 파일은 동기화 기록에 있는 것만 정지 확인 뒤 지운다(`dropSyncManifestFiles`, Upload Only 는 보류). ProjectStart 없는 그룹·내장형 하위 패키지는 건너뜀.
- **결과·진단**: `result.preprocess`(사본 위치·바이트 전후·제외 파일·고친 .gpr·`remoteDeleted`) → 작업 기록·MCP 요약(`preprocess −N KB · excluded M`),
  컴파일 스냅샷 `preprocess` → `list_remote_projects` 의 `lastCompiledFrom.preprocess`. 증적은 원본을 같은 규칙으로 전처리한 지문과 대조.
  `-729` 는 그 이름을 선언한 제외 파일을 짚는 안내(없으면 일반 안내)를 Problems·트레이스에 붙인다.
- **Mid 임시 문자열 누수**(세션 중 도착한 수신함 `mid-temp-leak-and-memory-costs_v1`, 시뮬 제어기 4.2K5): `Mid(CStr(i) & long300, 1, 10)` 은 1회당 320 B 가 돌아오지 않고
  Unload 뒤에도 회복되지 않았다(변수에 받은 뒤 `Mid` 는 0). `delegateChecks.ts` ⑤ `mid-temporary-argument`(information — 길이는 정적으로 모름): 첫 인자가 `&` 연결·문자열 내장 함수·
  String 을 돌려주는 사용자 Function 이면 알린다. 보고 §2 의 항목별 단가는 문서 `docs/gpl-language/memory-costs.md`(「메모리 아끼기」, 출처·한계 명시)로.

### 검증

- `npm test` 1706/1706(새 테스트 18건 — 경량화 바이트·줄바꿈, 도달성 규칙, 설정 해석, .gpr 고쳐 쓰기, 임시 폴더 사본 스테이지), `controller-mcp` 188/188.
- Sample Prep App(`projects/App`, PaL 36·Gantry 7) **읽기 전용 dry-run**: 주석 제거 2,121,039 → 1,298,220 B(−0.82 MB), 공백까지 1,190,108 B(−0.93 MB), 46파일 모두 줄 수 같음.
  미사용 제외 5개 — Core_Parse·Net_Client·Device_Cylinder·Robot_Data·Frame_Tool. 요청 스크립트의 7개 중 **Net_Log**(App_Main.gpl:52 `NLG.Start`)와
  **Frame_Tree**(Gantry_Commands.gpl:859 `FTR.Point`)는 코드에서 실제로 쓰여 남긴다 — 그대로 뺐으면 `-729` 였을 것.
- 제어기 접속 없음 — 실기 확인은 verification §1-HD.
- VSIX: `dist/gpl-language-support-0.27.14.vsix` — 1,774,453 bytes, SHA-256 `0026335598B58DB2FC7C41C8DF91BC2B0020FA6F5FA90BC3C69539B742C9D098`. 패키징 경고는 vsce 의 번들 권장(380파일) 하나뿐.

### 남은 일

- 보류: 컴파일 뒤 /GPL 소스 비우기, 멤버 단위 미사용 제외 → §3 「(2026-11-06, §1-HD)」. 수신함 나머지 6건(stale IP·JointOnly·binder facts·ctor Init·Catch·try-finally)은 다음 세션.

## 1-HE. 2026-11-06 세션 — GPL source-to-source 최적화기: 선언 단위 미사용 제거 (0.27.15)

### 증상(요청)

"우리가 임베디드 컴파일러 비슷한걸 구현해서 넣을 수 있을까? 코드 최적화 되도록?" → 검토 답변(제어기는 소스만 받으므로 진짜 컴파일러는 불가,
소스를 더 가벼운 소스로 바꾸는 최적화기는 가능 — 남은 메모리 이득의 주력은 안 쓰는 선언 제거) 뒤 "GPL 소스를 더 가벼운 GPL 소스로 바꿔 올리는 최적화기(source-to-source) 만들어 보자."

### 판단

- 제어기 입력은 `/GPL` 소스 + `Compile` 뿐이고 컴파일 결과 형식은 비공개(`.gpo` 는 전역 Location/Profile 모듈 — project-file-gpr.md) → 최적화는 소스 단계에서.
- 실측 단가(Sample Prep, Sub 165 B·Const 150~205 B·문장 59~140 B, 주석 0 B)상 남은 컴파일 몫은 **안 쓰는 선언**이다. 줄 번호는 유지(빈 줄로) — 오류 file:line·BP·Show Stack 보존.
- 기존 `GPLParser` 는 편집 중 소스를 견디는 관대한 IDE 파서라, 줄을 **지우는** 최적화에는 모르는 문장이면 통째로 포기하는 엄격한 스캐너를 따로 둔다.
- 함수 인라인·이름 줄이기는 하지 않는다(코드가 커지고 줄 번호가 깨짐 / `-eval`·Show Stack 이 이름을 씀).

### 조치

- **`project/sources/memberScan.ts`** — Module·Class(최상위·모듈·중첩)·Sub·Function·Property·Delegate·Const·변수 선언과 물리 줄 범위, 범위 안 참조 낱말
  (점 앞 낱말을 prefix, 문자열 안 포함, 숫자 표기 제외). 모르는 문장(`Event` 등)·짝 없는 블록·Module/Class 밖 문장 → `irregular`(그 파일은 지우지 않고 파일 전체 참조를 출발점으로).
  변수 초기화에 `New`·호출이 있으면 지울 수 없음, `Shared` 표시.
- **`project/sources/memberReachability.ts`** — 선언 그래프 고정점. 수식 없는 이름 = 모듈 직속(이름 유일 시 모듈 생략 — 문서상 modules.htm, 참조하는 모듈이 같은 이름을
  모듈 직속으로 선언했으면 그 모듈 것만 — scope_names.htm)·클래스 이름·클래스 멤버, `P.n` = 클래스 멤버 `n`(형을 모르니 이름이 같은 모든 클래스) + `P` 가 모듈이면 그 모듈의 `n`.
  클래스 멤버는 클래스가 닿을 때만, 닿으면 `Sub New` 함께(user_classes.htm). 출발점: 비후보 파일 전체, `Sub Init`, 지울 수 없는 모듈 직속·Shared 선언(인스턴스 필드는 클래스가 닿을 때만), keep(`Name`·`Container.Name`). 오버로드는 이름 단위.
- **`deployPreprocess.planMemberShake`** + 스테이지: 파일 단위 제외 뒤 남은 소스로 계획, 라이브러리 파일 안 범위를 빈 줄로(`blankLineRanges`, BOM 보존) → 주석·공백 경량화.
  결과 `preprocess.removedMemberCount·removedMemberLines·removedMembers`(상한 100)·`memberShakeIrregular`, `-729` 안내가 지운 선언(`파일:줄 (Container.Name)`)을 짚음, MCP 요약 `members −N`.
- **파일 단위 보강**: 모듈 직속 `Sub Init` 이 있는 라이브러리 파일은 미사용 제외에서 늘 남긴다(참조 없이 초기화 때 자동 호출 — 부작용 손실 방지, §1-HD 의 빈틈).

### 검증

- `npm test` 1714/1714(새 테스트 8건 — 스캐너 범위·참조·irregular, 모듈/클래스/출발점 규칙, 줄 수 유지·닫힌 집합, 스테이지 사본), `controller-mcp` 188/188.
- Sample Prep App **읽기 전용 dry-run**(사본은 scratchpad 에만): 라이브러리 선언 5,415개 중 350개(const 93·function 161·sub 70·class 15·property 7·variable 4), 4,565줄(코드 3,726줄) 제거.
  소스 −141 KB(주석·공백까지 2.07 → 1.06 MB), 컴파일 몫 추정 ≈400 KB(코드 줄당 110 B — Sample Prep 실측 비율, **추정**). 46파일 줄 수 동일, 결과를 다시 스캔해도 irregular 0,
  결과에 2차 실행 → 추가 제거 0(닫힌 집합). 지운 이름이 남은 코드에 나오는 52곳을 모두 대조 — 전부 다른 모듈이 자기 것으로 가린 `POLL_MS` 류나 `HFM.ERR_SETTING` 처럼 다른 모듈 수식.
- 제어기 접속 없음 — **실기 Compile 로 확인하기 전에는 운용 장비에 쓰지 않는다**(verification §1-HE).
- VSIX: `dist/gpl-language-support-0.27.15.vsix` — 1,784,171 bytes, SHA-256 `648A33F94E178A3F98846FDAD0A254638D59C0E29F99D45E122EE0ACF65F2BC2`. 패키징 경고는 vsce 번들 권장 하나.

### 남은 일

- 실기: 시뮬레이션 제어기에서 원본/최적화본 Compile STATUS·Show Memory 비교, Start 뒤 문자열 진입점·콜백 동작(verification §1-HE).
- 다음 후보(§3): 빈 껍데기가 된 Module(≈190 B) 비우기, 실행 프로젝트 자신의 안 쓰는 선언(지금은 라이브러리만), Const 값 치환.

## 1-HF. 2026-11-06 세션 — 최적화기 정밀도·범위 확장, 컴파일 메모리 추정, 메모리 진단 보정 (0.27.16)

### 증상(요청)

"메모리 최적화 정리_2026.11.06._20-22.zip · _mem.zip 여기 내용 참고해서 더 개선해줘." 앞은 ChatGPT 대화 내보내기(일반 임베디드 최적화 조사 + _mem.zip 검토),
뒤는 Sample Prep 이 보낸 실측 자료 — `2026-11-06_cost-table.md`(컴파일·실행·스레드 단가), `2026-11-05_unreferenced-members.md`(이름 기반 미참조 멤버 A~D·K),
`2026-11-05_memory-review.md`, 프로브 소스(`MEMx_Main.gpl`, `memk_gen.py`). 스크립트는 실행하지 않고 읽기만 했다(압축은 scratchpad 의 빈 폴더에 풀었다).

### 자료에서 가져온 것

- 메모리의 대부분은 코드(소스 2.39 + 컴파일 4.13 MB, 실행 객체·스레드 0.41 MB). 프로시저 머리가 컴파일의 ⅓(빈 Sub 165 · 첫 인자 +221 · 인자당 ≈100~130 · Function +180).
- 스레드 = 제어 블록 ≈33 KB + 스택(Unload 뒤에도 안 돌아오고 재사용) — **§1-HD 문서의 "8 KB 이상 28~41 KB" 는 틀렸다**(정정).
- `Mid` 누수는 `&`·내장 함수 임시값만, 사용자 Function 결과·길이 120 이하는 0. 객체 String 칸의 `""` 는 +183 B/칸.
- 미참조 목록(299개)과 우리 결과를 이름으로 대조하니 56개를 남기고 있었다 — 주원인은 안내문 문자열 속 낱말(`"... sigma=..."`)과 같은 이름의 매개변수(`diCount`).

### 조치

- **정밀도**(`memberScan`·`sourceReachability`): 문자열은 이름처럼 생긴 것(`Proc`·`MOD.Proc`·`MOD.`)만 참조(`splitCodeAndNameStrings`). 프로시저 매개변수와 **맨 바깥** 지역 Dim 은 그 프로시저 안에서 가린다
  (블록 안 Dim 은 블록 밖 같은 이름을 가리지 않으므로 가림에서 뺌 — If/For/While/Do/Select/Try/With 깊이 추적).
- **범위**(`memberReachability`): 남는 프로시저 안의 안 쓰는 지역 Dim(자기 줄 밖 코드에 이름이 없고 Static·부작용 초기화가 아닐 때)과 선언이 하나도 안 남은 Module 껍데기를 비운다.
- **추정**(`project/sources/compileCostModel.ts`): 실측 단가 × 선언 구조. 블록 닫는 줄(End If·Next)도 문장으로 세야 보고서의 문장 수(25,469 ↔ 우리 25,329)와 맞는다.
  Sample Prep 원본 4.09 MB 추정 vs 실측 4.13 MB. 스테이지가 컴파일 단위 전체의 원본/사본 추정을 `preprocess.estimatedCompile` 과 트레이스에 싣는다. 지운 줄 수는 범위 합집합.
- **진단**: `mid-temporary-argument` 를 맨 바깥 `&`·식 전체가 내장 문자열 함수인 경우로 좁힘. `language/checks/memoryChecks.ts` `string-field-empty-init`(클래스 인스턴스 String 필드 `= ""`, information, -782 주의 포함).
- **문서**: `docs/gpl-language/memory-costs.md` 를 실측 보고서 기준으로 다시 씀(앱 메모리 구성, 컴파일·실행 단가, 스레드 정정, 전처리 옵션, 피할 것/괜찮은 것).
- 하지 않은 것: 래퍼 인라인(722개 짧은 프로시저 — ByVal/ByRef·형 변환·접근성 때문에 자동 치환은 의미가 바뀔 수 있음), 인자 묶기(API 변경), 스레드 통합(구조 결정).

### 검증

- `npm test` 1719/1719(새 테스트 5건), `controller-mcp` 188/188.
- Sample Prep **실제 스테이지 dry-run**(가짜 ctx, 사본은 %TEMP% 의 시험용 폴더 — 확인 뒤 지움): 소스 2.0 → 1.0 MB(−50 %), 파일 5개 제외, 선언 392개(지역 Dim 2·빈 Module 6 포함, 4,849줄),
  컴파일 추정 4.1 → 3.5 MB(−0.57 MB, **추정**), 1.0 초. 2차 실행 추가 제거 0, 46파일 줄 수 동일·재스캔 irregular 0. 지운 지역 Dim 1건 원문 대조(`Device_LeadshineRS.gpl:3518 Dim i` — 실제로 안 씀).
- 보고서 미참조 299개 중 249개를 우리도 지움. 남긴 50개는 현재 소스에 이름이 없거나(`ZonePath` 등 — 보고서가 더 옛 소스 기준), 같은 이름 멤버가 다른 객체에서 점 뒤로 쓰여 형을 모르는 우리 규칙이 남긴 것.
- VSIX: `dist/gpl-language-support-0.27.16.vsix` — 1,791,965 bytes, SHA-256 `D383AFF94EC8679EEF9697FE8C8B46F6F917A2D62B5D16F9FAC57C01F99728A7`. 패키징 경고는 vsce 번들 권장 하나.

### 남은 일

- 실기: verification §1-HE(선언 단위 제거 Compile·Start)와 §1-HF(추정 대비 실측). 추정이 실측과 ±5 % 밖이면 `COMPILE_COST` 를 다시 맞춘다.
- 다음 후보는 §3 「(2026-11-06, §1-HE)」 — 남은 것은 실행 프로젝트 선언·Const 치환·클래스 멤버 형 추론(이번에 Module 껍데기는 처리).

## 1-HG. 2026-11-13 세션 — 수신함 Sample Prep 보고 11건, 4갈래 병렬 처리 (0.27.17)

### 증상(요청)

"확장 개선 요청들 처리 작업좀 진행해줘." 수신함 최상위 11건(11-05 ~ 11-12, 전부 Sample Prep): stale IP · mcp-host-auto-follow · runtime-console 경로 · binder facts ·
JointOnly · ctor Init · Catch 새 객체 · try-finally · thread-block/Mid · 전처리 오포함 · 라이브러리 버전 v2.

### 진행 방식

- HEAD(`codex/domain-modules`)가 `main` 보다 125커밋 앞이라 §1-HC 처럼 HEAD 에서 `git worktree add`(`%TEMP%\gpl-wt-*`, node_modules junction)로 4갈래를 만들고
  Sonnet 에이전트를 병렬로 돌렸다. 브랜치 `inbox2/{lang-docs,ctl-identity,mcp-route,deploy-lib}` 를 `--no-ff` 병합 — 충돌은 `package.json` 설정 두 개·`connection.ts` import 한 줄(둘 다 살림).
- 이미 있던 것 확인: 클래스 `Init` 경고(`init-hook-class-member`, §1-EA)·`try-without-catch` 기본 꺼짐(§1-FG)·스레드 33 KB/Mid 범위(§1-HF)·주소 자동 추종(§1-GV — 11-10 보고는 옛 0.18.1 MCP 번들 탓).

### 조치(원인 → 수정)

- **MCP 경로·주소**(62bf4dd·f37201a·d4e5296)
  - 미연결(`connected:false`) 창의 IP 가 GPL_HOST 와 다르면 `extension-disconnected`(두 IP·nextStep)로 1402 명령을 not-sent 거부 — 옛 IP 로 3 s 접속 시도 없음(`assessWindowAddress`). 같은 IP·GPL_HOST 없음·명시/고정 창은 종전대로.
  - 작업 폴더 일치는 양방향 포함(창 폴더가 프로젝트를 품는 쪽 우선, `matchWorkspaceInstances`). not-sent 를 `host-unreachable` 이 아니라 `bridge-host-mismatch` 로.
  - `extension_resolve {extensionInstanceId}` 가 이 MCP 세션을 그 창에 고정(메모리만, `.mcp.json` 무관, `{unpin:true}`), `transport.controller.pinned`.
  - `runtime_console_read` 는 세션 대상의 창으로(`routedBy`), 다른 창을 읽으면 `routeMismatch`. `runtime_console_search` 는 그 창 IP 의 캡처 파일. 보고 재현 경로는 코드로 확정 못 함(요청대로 수정).
  - globalStorage MCP 번들: 더 새 사본을 옛 확장이 덮지 않음(`decideStableBundleOverwrite`, `kept-newer` 로그). `controller_status.transport.versionWarning`(서버 ≠ 확장).
  - 제어기 IP 해석(`controller/connection/ipSource.ts`): 세션 > 워크스페이스 설정 > `workspaceState` 마지막 연결 > User. 저장은 지금 값이 있는 범위(워크스페이스 값이 없으면 User) — 작업 공간에 파일을 새로 만들지 않는다. 상태 표시줄 툴팁에 IP 와 출처.
    한계: User 값을 손으로 고쳐도 그 워크스페이스의 마지막 연결 값이 가린다(Settings Sync 때문에 설정 변경 시 기억을 지우지 않음).
  - `gpl.controller.autoConnectOnStartup`(기본 false — 1402 단일 클라이언트를 다른 창·GDE 에서 뺏을 수 있어 opt-in). MCP `session start` 줄에 출처·connected·GPL_HOST.
- **제어기 식별·진단**(ad4fda2·e5fe9f0·d6b4997·2ab5d5a)
  - `controllerIdentity {serial,id,name,model}`(pd 110/114/109/101, host:port 별 10분 캐시)을 `controller_status`·`project_target`·배포 결과에. 확장은 연결 직후 Output 기록 + `gpl.controller.expectedSerial` 불일치 시 비모달 경고.
    MCP 는 env `GPL_EXPECTED_SERIAL` 만 본다(확장 설정 전달은 §3 보류). 문서상 system identification.htm(110 serial RO, 114 Controller ID RO).
  - `stackUsage`(`Show Thread -stack -web` 끝 세 숫자 = 사용·크기·최대 KB로 **추정**, 90 % 경고) — `show_threads({stack:true})`·`controller_status({detail:true})`·`diagnostic_snapshot({includeStack:true})`.
  - 디버그 attach 때 `pd 307`(Break on exception code) 1회, 0 이 아니면 Debug Console 한 줄(문서상 trycatchfinally.htm Prerequisites — 켜져 있으면 Try…Catch 무시). 세션 명령 순서를 고정한 기존 테스트 10건은 `pd 307` 을 건너뛰게 고침.
  - MCP 전원 조회 `Execute Controller.PowerEnabled`(4.2K5 -712) → `pd 230`(8~12 켜짐, `robotAxes.readPowerState` 와 같은 판정).
- **언어 진단·문서**(bfeafa1·1fe798a)
  - `missing-final-newline`(코드 줄 warning·주석 줄 information, 빠른 수정은 파일 EOL 로) — 끝 줄바꿈 없으면 Compile -505(실측 11-05). `create-directory-device-root`(warning) — `File.CreateDirectory("/ROMDISK")` 류 -300.
  - `thread-entry-without-catch`(information, `gpl.diagnostics.threadEntryWithoutCatch` 기본 true): 같은 파일의 `New Thread("Mod.Proc", …)` 대상 본문에 Catch 가 하나도 없을 때. 다른 파일·`ProjectStart` 는 §3 보류.
  - `init-hook-class-member` 메시지에 생성자 호출 사례. 문서: Catch 는 던진 객체가 아니라 코드·Qualifier·로봇 정보만 옮긴 객체(앞 판 "Message 대입 무시" 정정, Catch 변수 Nothing 허용 — 문서와 다른 실측),
    `Catch ex : Throw ex` 덧붙이기 무용·-755 도 Finally 실행, 스택 4 KB·잠금 Finally 해제, 장치 루트, 변수 기본값, Joint Only Location·Pitch 0 → Roll, `CStr(Controller.PDb(110))` = "14"(미확정).
- **배포·라이브러리**(8b63adb·9daad53·feda129)
  - 전처리 오포함 원인: MLD 의 모듈 직속 `Function CodeText` 를 Gantry 의 `ByVal codeText` 매개변수와 클래스 멤버 선언 줄 `Public Function CodeText()` 가 참조로 읽힘(보고 추정 "멤버 이름 겹침"은 아님).
    `sourceReachability` 에 매개변수·지역 가림, 선언 줄 자기 이름 제외. Binder App dry-run 제외 5 → 6파일(`Device_HanyoungML` 추가, 37.8 → 82.9 KB). `preprocess.kept[]`(상한 60)·`keptCount`, MCP `· kept N`.
    `-729` 의 "전처리가 뺐다" 안내는 그 이름이 원본 어디에도 선언돼 있지 않으면 내지 않음. 사본 `.gpl` 끝 줄바꿈 보장(-505).
  - 라이브러리 출처 `libraries[] {name, localPath, remoteDir, vcs{kind,url,revision,mode,peg,modifiedFiles}|null, uploaded{files,sha256}}`·`librarySummary`(`libs PaL v2@r5405(pinned) · …`) → 결과·작업 기록·`lastCompiledFrom`.
    svn 은 `info`/`propget svn:externals`(상위 3단)/`status -q`, 4 s, 실패면 `vcs:null`. 실제 작업 사본 dry-run: PaL following r5365 변경 3, Gantry following 변경 0.
  - `preflight.libraries[]`(missing·pinnedDrift·modified·uploadMismatch, 이전 업로드는 `globalState gpl.libraryProvenance`, 모르면 `unknown`), 기본 경고만, `gpl.deploy.libraryPreflight.blockOn` 으로 막음.
    autoOnSave 저장 경로는 건너뜀(feda129 — 저장마다 svn 호출 방지, 병합 뒤 조정자가 추가). `.svn` 독립 작업 사본 라이브러리 회귀 테스트.

### 검증

- 병합 트리 `npm test` 1752/1752, `controller-mcp` 206/206. 제어기 접속 없음 — 실기·UI 확인은 verification §1-HG.
- 새 단계의 배포 전체 흐름 통합 실행은 가짜 컨텍스트·가짜 svn 실행기 수준(`runLibraryPreflight` 배선은 실사용으로 확인).
- VSIX: `dist/gpl-language-support-0.27.17.vsix` — 1,828,592 bytes, SHA-256 `4F6A0DE5F71909BC362DD50AF82459C927045B60A29CE6CF1D1C0C9952B7FB81`. 패키징 경고는 vsce 번들 권장 하나.

### 남은 일

- 보류 항목은 §3 「(2026-11-13, §1-HG)」(라이브러리 버전 #4~#8, `expectedSerial` MCP 전달, 진입점 린트 확장, 잠금 린트, 스택 열 순서 실측).
- worktree 4개(`%TEMP%\gpl-wt-*`)와 `inbox2/*` 브랜치는 병합 뒤 정리.

## 1-HH. 2026-11-13 세션 — 시뮬 제어기 실기 시험: 디버깅·배포 기능 점검과 그 자리 수정 (0.27.18)

### 증상(요청)

"192.168.0.1 시뮬 제어기에 연결해서 테스트 하며 개선 검토. 디버깅도 해보고 이것 저것 기능 테스트해서 개선." 제어기 G2400C 4.2K5(110 `0014FF-02300289`, 2105 = 1, 전원 꺼짐).
돌고 있던 Sample Prep `App`(쓰레드 12, Free 0.80 MB)은 사용자 동의로 정지·Unload 했고 다시 올리지 않았다(/GPL 의 PaL·Gantry 는 그대로).

### 시험한 것과 결과

- 시험 프로젝트: `samples/syntax-tour`, 프로브 `captures/probe-exitprop`·`probe-callerline`·`probe-loop`·`libtest/{LtApp,LtLib}`(captures 는 git 미추적).
- 정상 확인(§1-HG 실기 항목 일부 해소): `controllerIdentity`(project_target·배포·status), 전원 `pd 230` = 7 → `powerEnabled:false`, attach 없이도 `pd 307` 읽기,
  스택 열 순서(가운데 = 생성자 stack_size: TCPCMD 8.000·TCPCLI_0 6.000), `stop_threads({project})` 10쓰레드 정착, Unload 뒤 `next:"redeploy"`,
  전처리 `excludeUnreachableLibraryFiles`(매개변수 `codeText` 와 겹치는 `ZMOD.CodeText` 파일 제외 → Compile 0·Start 정상)·`preprocess.kept`·`libraries`(vcs null)·`preflight`(unknown),
  BP·Continue·Step over/into/out·run_to_line·eval(객체 덤프·`Counter.Ceiling`)·Break·`Execute Main.stopFlag = True`·런타임 콘솔 `routedBy:"session-target"`.

### 찾은 문제 → 조치

- **`Exit Property` 는 -719**(f888fed) — 문서상 Exit.htm 구문 목록에 있으나 Get·Set·ReadOnly Get 모두 Compile `-719 *Illegal use of keyword*`. 완성 목록에서 빼고 진단 `exit-property-rejected`(error), syntax-tour 수정.
- **`:` 문장 구분은 -722**(49b37ac) — `Callee(4) : i = 4` → `*Unexpected text at end of line*`. 진단 `statement-separator-colon`(error, 줄 머리 라벨·문자열·주석 제외). Sample Prep 47파일 스캔 거짓 경고 0.
- **syntax-tour 가 Start 때 -757**(1a7e013) — 샘플의 클래스 `Sub Init` 이 초기화 훅에 잡힘(§1-EA 와 같은 원인, 진단은 이미 있음). `Setup` 으로 바꿈.
- **호출자 프레임 줄**(1a7e013) — `Show Stack` 은 frame ≥ 1 에 호출 줄이 아니라 **돌아가 실행할 다음 문장 줄**을 준다(7 → 10 빈 줄·주석 건너뜀, If 안 12 → 13 `End If`, For 안 16 → 17 `Next`, 식 안 20 → 21, 함수 안 24 → 25).
  DAP 호출 스택이 로컬 소스로 호출 줄을 되짚는다(`sourceTargets.callSiteLine`, 맨 위 프레임은 그대로), MCP `show_stack` 은 `frames[].callLine`.
- **이름 없는 `Show Variable <thread> <frame>` 은 -505**(Paused·Error 모두, 문서상으로는 전체 표시) — `debug_snapshot({listLocals})` 를 로컬 소스의 매개변수·Dim 이름 + `-eval` 로(`controller-mcp/src/procedureLocals.js`).
- **`run_to_line` 빈 줄 요청**(142 → 143 에 섬) — 사이가 빈 줄·주석뿐이면 도달로 보고 `adjustedTo`.
- **런타임 콘솔 `PARSER_STALLED` 오판** — 프레임 사이 NUL 1바이트가 `carry` 에 남아 정체로 판정(`pending=1B head="\u0000"`, 세션 중 6회). 파서 입력에서 NUL 제거. §1-HC 의 "원인 미확정" 정체 후보 하나가 이것일 수 있다(추정).
- **배포 ErrorLog 누적**(280b3e4) — 배포마다 일주일 전 항목까지 14건이 다시 찍힘(이번 배포분 0). Compile 응답의 `begin compiler pass 1` 시각(제어기 시계)으로 갈라 예전 것은 개수만, `result.errorLogSinceDeploy`.
- **FTP LIST 시각이 2001년**(51fc817) — 연도 없는 `Nov 13 14:22` 를 V8 이 2001 로 채움 → `parseFtpListDate`. 동기화 지문의 원격 mtime 이 달라져 업데이트 뒤 첫 배포는 전체 업로드될 수 있다.
- **런타임 콘솔 읽기 잘림**(a4e102f) — `untilPattern` + `maxLines` 에서 잘리면 `matched:false`·`timedOut:false` 만 와 "안 나왔다" 로 읽힘 → `remaining`·`matchAheadSeq`. Continue 뒤 Idle 을 "실행 중일 수 있다" 로 안내하던 문구 수정.
- 수신함 12번째(flash 경로 대소문자, 5917cdc)도 이 버전에 실림.

### 검증

- `npm test` 1759/1759, `controller-mcp` 213/213. 고친 샘플은 실기에서 Compile STATUS 0·Start 정상.
- 이 세션의 MCP 서버는 수정 전 소스로 떠 있어 `listLocals`·`show_stack.callLine`·`adjustedTo`·`remaining` 과 DAP 호출 스택 줄은 **실기 재확인 전**(단위 테스트는 실측 표를 그대로 고정) — verification §1-HH.

### 남은 일

- 제어기 `/GPL` 에 시험 폴더(syntax_tour·probe_exitprop·probe_callerline·probe_loop·LtApp·LtLib)가 남아 있다 — 지우기는 사용자 동의 뒤. Sample Prep App 은 내려간 상태.
- 관찰만 한 것(§3): Running 쓰레드의 `Show Thread` 줄도 Sleep 다음 문장 줄로 나온다(`Thread.Sleep` 12 → 13) — 트리 표시 보정 여부, `c.Count`(-780)·`c.current`(-729) 는 객체 덤프로만 읽힘(기존 사실).
