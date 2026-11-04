# 실사용 확인 대기 목록 (AI 인계 부속)

새 VSIX를 설치한 뒤 사용자가 실제 VS Code·제어기에서 확인할 항목이다. 구현과 자동 테스트는 끝났고, 실사용·실기·UI로만
확인할 수 있는 것만 둔다. 코드 작업과 사용자 결정 대기는 `docs/ai-handoff.md` §3에 있다(규칙: `docs/development/record-keeping.md`).

- **모션 주의**: 항목 제목의 괄호(모션 무영향·저속/시뮬레이션 등)를 먼저 본다. Start·Step·Set DIO 처럼 상태를 바꾸는 항목은
  하드 규칙 9에 따라 저속/시뮬레이션 조건에서 한다.
- **확인이 끝나면 항목을 지운다.** 결과 기록이 필요하면 해당 세션(§1-XX)이 있는 월 아카이브에 부록으로 남긴다.
  확인 중 문제가 나오면 `docs/ai-handoff.md` §3에 코드 작업 항목으로 올린다.
- 새 항목은 위에 추가한다(최신이 위). 형식: `- [ ] **(날짜, §1-XX) 대상 — 확인 범위(모션 영향).** ①…②…`

## 확인 대기 항목

- [ ] **(2026-11-04, §1-HB) 0.27.12 대시보드 I/O 배치 — 실기 확인(읽기만).** 디지털 I/O 탭에서 Soft Internal DIO 가 8×8, Digital I/O·Dedicated 가 8개씩 줄을 맞춰 보이는지, 패널을 좁히면(약 460px 이하) 4열로 바뀌는지, 5·6자리 번호가 잘리지 않는지.
- [ ] **(2026-11-04, §1-HA) 0.27.11 대시보드 — 실기 확인(①~③ 읽기 전용, ④는 Set DIO 를 보낸다 — 장비 정지·무해한 신호로).**
  ① **축 위치**: 로봇 5대(R1 Track·R2 H1 evZ …)가 줄마다 막대로 나오고 양끝 숫자가 `pd 16078/16077, r` 값과 같은지, 표식 위치·%가 `pd 3504, r` 와 맞는지.
  저속 조그 중 표식이 따라가고 ▲/▼ 변화량·「이동 중」이 뜨는지, 리밋 가까이에서 주의색이 되는지. GPL Traffic 에 `Execute` 가 더는 없고 폴링 1회가
  `Show Thread` + `pd 230` + `pd 3504, 1~5` 로 끝나는지(구성 `pd 116·2002·16077·16078` 은 처음·새로고침 때만). 대시보드를 연 채 `Unload` 가 종전처럼 지연되지 않는지(§1-GN inbox 보고).
  ② **전원 배지**: 서보 켠 상태에서 ON · 「켜짐 · 자동 모드 실행 (230=12)」, 끈 상태에서 OFF 와 상태 문구. 직교 좌표 카드는 「조인트 전용 구성」으로 나오는지.
  ③ **추이 카드**: 다섯 그래프가 한 줄(넓은 창)·두 줄(좁은 창)로 같은 모양인지, 창 크기를 바꿔도 글자·점이 늘어나지 않는지, 마우스를 올리면 시각·값 툴팁이 뜨는지, 다크/라이트 테마.
  ④ **I/O 칩**: 한 번 클릭 → 잠깐 뒤 강제 토글(`Set DIO n 1/-1`) 1회, 강제된 칩 더블클릭 → `Set DIO n 0` 만 나가고 토글은 나가지 않는지(GPL Traffic), 강제 안 된 칩 더블클릭은 안내만.
- [ ] **(2026-11-04, §1-GZ) 0.27.10 리뷰 후속 — 실사용·실기 확인(①은 Stop·Unload 를 보낸다 — 장비 정지 상태에서, 나머지는 읽기·FTP).**
  ① **메모리 자동 회수**: 여유 메모리가 4 MB 미만인 상태(실행 중 앱 포함)에서 AI `deploy_project build` 또는 Quick Compile → Output 에
  `♻ 여유 메모리 … 정지 뒤 다시 재고` → (모자라면) `CMD Unload <다른 앱>` … `CMD Unload <대상>` → `♻ 메모리 회수: X MB → Y MB` 가 찍히고 업로드·Compile 이
  이어지는지, 결과의 `memoryRecovery`(unloaded·skipped)가 맞는지. 그룹(Lib) 폴더는 `Unload 안 함` 으로 남는지. 같은 부팅에 그룹 Compile 을 한 뒤라면
  「메모리 자동 회수 건너뜀」 경고만 나오고 Unload 를 보내지 않는지. Unload 1건당 걸린 시간도 적어 둔다.
  ② **basic-ftp 6**: Upload Only·배포·FTP 트리 새로고침·원격 파일 열기가 종전처럼 되는지. GPL Traffic/Output 에 FTP 오류가 없으면
  `ftpClient.createClient` 의 `allowSeparateTransferHost: true` 를 지워 6.x 기본값(다른 호스트 거부)으로 다시 확인한다(§3).
  ③ **URI 토큰**: 브라우저 주소창에 `vscode://nir414.gpl-language-support/gpl.controller.sendCommand?command=Show%20Thread` → 실행되지 않고
  「token 이 필요합니다」 경고. 같은 URI 에 `&token=<%TEMP%\gpl-controller\uri-token 값>` 을 붙이면 실행. MCP 확장 깨우기(`getConnectionState`)는 그대로.
  ④ **1402 인코딩**: 한글이 든 프로젝트·파일 이름(있으면)의 `Set Break`·`Show Thread` 응답이 GPL Traffic 과 트리에서 깨지지 않는지.
  ⑤ **디버거**: 마지막 줄에서 Step 해 쓰레드가 끝나면 디버그 툴바가 실행 중에 묶이지 않는지, Thread.Sleep 중인 쓰레드에 Pause 를 누르면
  곧바로 정지(pause)로 표시되는지(Step 은 모션 주의 — 시뮬레이션 프로젝트).
- [ ] **(2026-11-04, §1-GW) 0.27.8 Step 체감 — 실사용 확인(Step 은 모션 주의).** ① 확장 첫 줄이 `v0.27.8` 인지. ② Step over 뒤 편집기 노란 줄이 GPL Traffic 의 `Show Stack` 응답보다 먼저 옮겨 가는지(같은 정지에 `Show Stack` 은 1번). ③ 호출 스택 패널이 맨 위 프레임 하나로 먼저 보였다가 곧 전체로 채워지는지(깜박임·중복 Locals 조회 없음 — `Show Variable -eval` 이 변수당 1번). ④ Debug Console `⏱ Step over 총 …ms` 의 감지 출처·폴 횟수 — §1-GA 이후 처음 나오는 실측이라 숫자를 그대로 남긴다(§1-GA 남은 일). ⑤ BP 줄로 Step 했을 때 이유가 `breakpoint` 로 표시되는지(폴 줄 판정).
- [ ] **(2026-11-04, §1-GU) 0.27.6 체감 속도 — 실사용 확인(읽기 경로; ③은 Step 이라 모션 주의).** ① 창을 Reload 한 뒤 Output 첫 줄이 `v0.27.6` 인지(어제까지 창이 0.18.1 로 떠 있었다). ② 디버그 밖에서 `GPL: Start`·트리 Stop 뒤 쓰레드 행이 1~2 s 안에 바뀌는지, GPL Traffic 에 명령 뒤 `Show Thread  -web` 가 150/600/1500/3000 ms 무렵 몇 번 나가고 그 뒤 5 s 정규 폴로 돌아가는지. ③ 디버그 Step over 때 Debug Console `⏱ Step over 총 …ms` 줄 — 감지 출처·폴 횟수가 종전보다 줄었는지, Move 줄은 백업 폴 400 ms 간격인지. ④ 정지한 채 1.5 s 넘게 있다가 변수를 펼치거나 호버해도 `Show Stack` 이 다시 나가지 않는지. ⑤ 1403 상태 이벤트가 쉬지 않고 오는 프로그램에서 트리 조회가 250 ms 하한으로 묶이는지(1402 폭주 없음).
- [ ] **(2026-11-03, §1-GT) 0.27.5 메모리 측정값 정본 — 실사용 확인(읽기 경로·모션 무영향).** ① 확장 목록에서 이 확장이 0.27.5 인지 먼저 본다(이번에 Marketplace 0.18.1 로 되돌아가 있었다 — 재발하면 Auto Update 끄기 또는 Marketplace 게시로 막을지 사용자 결정). ② `GPL: Start` 한 번에 GPL Traffic 의 `Show Memory` 가 1번만 나가고 큐 슬롯 줄에 `(재사용 — N ms 전 Show Memory 측정, 그 뒤 상태 변경 없음)` 이 붙는지. ③ 업로드 스타트에서 업로드 전 측정 뒤 `Stop`·업로드를 거친 Compile 직전에는 **새로** 재는지(재사용 표시가 없어야 함). ④ 트리 시스템 정보 「메모리」 값·툴팁 측정 시각이 상태 표시줄 경고 항목 클릭 상세와 같은지, 대시보드를 열어 두면 둘 다 함께 바뀌는지. ⑤ Sample Prep 제어기 여유 메모리 0.97 MB(17:20) — Unload -all 또는 재부팅 뒤 Free 와 `Show Thread` 응답 시간이 돌아오는지(느려짐이 메모리 부족과 겹치는지 확인).
- [ ] **(2026-11-03, §1-GS) 0.27.4 「컴파일 검증 필요」 — 실사용 확인.** ① 라이브러리(PaL)를 Upload Only → 그것을 쓰는 실행 프로젝트를 Upload & Start 하면 Output 에 `컴파일 검증 필요 상태 해제: 라이브러리 PaL — <App> Compile 에 포함` 한 줄과 배지 해제 ② 라이브러리 배지 클릭이 Quick Compile 이 아니라 선택 창(라이브러리는 체크 해제, 골라도 컴파일 안 함) ③ 선택 창 × 로 항목 해제 ④ /GPL 비우기 뒤 지운 프로젝트 해제. 남은 일: 형제 배치가 아닌 프로젝트(tools\Probe)의 라이브러리 동반 업로드 후보(같은 ip 로 마지막에 Upload Only 한 폴더 제안 — 수신함 ⑤, 보류), 라이브러리 배지에서 "이 라이브러리를 쓰는 실행 프로젝트" 후보 고르기(보류).
- [ ] **(2026-11-03, §1-GR) 0.27.3 Unload 기본 -all — UI·실기 확인(쓰레드를 모두 정지한 상태에서).** ① 트리 /GPL 프로젝트 폴더 우클릭 「Unload -all (/GPL 비운 뒤 모두 내리기)」 → (위험 근거가 있으면 위험 모달) → /GPL 비우기 모달("비운 뒤 Unload -all") → `Unload -all` STATUS 0, 취소하면 Unload 미전송·Output 한 줄 ② /flash/projects 폴더 노드에서 같은 메뉴를 눌러도 비우기 모달에 **/GPL 목록만** 나오는지(플래시 미접촉) ③ 「GPL: Unload Project」 목록 맨 위가 「모두 내리기」라 Enter 로 바로 진행, 「이 프로젝트만」 아래 이름 Unload 가 종전대로 ④ MCP `unload_project()`(인자 없음)가 `targetSource:"default-all"` 로 -all 사전 조건(`threads-active`/`gpl-not-empty`)을 돌려주는지.
- [ ] **(2026-11-03, §1-GQ) 0.27.2 유실 정황 — 실사용 확인.** ① 제어기에 연결한 채 PC 를 절전(덮개 닫기·`Win+X → 종료 → 절전`)했다가 깨우면 알림이 「PC 절전 복귀 HH:MM:SS (절전 N분) 직후에 끊겼습니다 … 제어기 문제로 보지 않습니다」이고 Output 에 `[Controller] 계기: PC 절전 복귀 …`, 사후 스냅샷 판정 절에 `계기:` 줄과 「PC 절전/복귀」 절 ② 「다시 연결」이 네트워크가 올라온 뒤 정상 연결되는지(아직 안 올라왔으면 종전처럼 연결 실패 알림) ③ `Stop -all` 뒤 끊기면 「직전 상태 변경 명령」 절과 Output 한 줄에 `Stop -all → STATUS 0 (N s 전)` ④ 알림이 종전보다 몇 초 늦게 뜨는지(이벤트 로그 조회 약 4 s — 도달성 판정과 병렬). 남은 원인 후보: 깨어 있는 중 링크 단절 8건(USB 랜카드 RTL8153 전원 절약·케이블·제어기 NIC) — 재발 시 사후 스냅샷과 `Get-WinEvent Microsoft-Windows-NetworkProfile/Operational` 10000 을 대조.
- [ ] **(2026-10-28, §1-GO) 라이브러리 함께 업로드 — 실기 확인(FTP·Compile, 모션 무영향).** `projects/Main`(ProjectStart, `ProjectLibrary="Libraries"`) + `projects/Libraries` 를 만들어 ① Upload Only 출력에 「함께 업로드: Libraries → /GPL/Libraries」와 Library done 줄, 알림 끝에 「+ 라이브러리 Libraries」 ② **Compile Main 이 STATUS 0** 인지 — 제어기가 `/GPL/Libraries` 를 라이브러리로 찾는지(문서 표본은 중첩 배치 1건뿐; 실패하면 `-508`/미정의 심볼 류가 나올 것이고, 그때는 원격 경로 규칙을 고친다) ③ 라이브러리 파일을 고친 뒤 다시 올리면 그 파일만 sent ④ BinderR4 의 `Gantry\Data` 를 올리면 「내장형 패키지 — 컴파일 단위는 BinderR4」 줄만 나오고 추가 업로드 없음.
- [ ] **(2026-10-28, §1-GN) 0.26.0 — "컴파일 검증 필요" 목록·Unload -all 전 비우기 — VSIX·실기 확인(Unload 는 정지 상태에서).** ① Upload Only 로 프로젝트 3개를 올리면 트리 「프로젝트 상태 ⚠ 컴파일 검증 필요 3개」에 세 줄, 상태바 `$(warning) 컴파일 검증 필요: <마지막> 외 2` ② 상태바 클릭 → 다중 선택 QuickPick(전부 체크) → 고른 순서대로 Quick Compile, 하나 실패 시 중단 ③ 한 프로젝트만 Compile 하면 그 줄만 사라지고 라벨이 「외 1」로 ④ `GPL: Start`(모달 「그대로 Start」) STATUS 0 뒤 배지 해제 + Output `[Start] ✔ 컴파일 스냅샷 기록` ⑤ 창 다시 열기(Reload Window) 뒤에도 미검증 목록이 남고, 다른 IP 로 설정을 바꾸면 사라졌다가 되돌리면 다시 뜨는지 ⑥ 「GPL: Unload Project」→「모두 내리기」: 위험 모달 → /GPL 비우기 모달(문구에 "비운 뒤 Unload -all") → 삭제 → `Unload -all` STATUS 0, 취소하면 Unload 미전송·Output 한 줄, /GPL 이 비어 있으면 모달 없이 바로 ⑦ MCP `unload_project {project:"-all"}` 가 /GPL 비어 있지 않을 때 `refused:"gpl-not-empty"` + 목록, 활성 쓰레드가 있으면 `threads-active` ⑧ 실행 뒤 앱 Unload 가 15 s 를 넘겨도(GPL Traffic 의 소요 시간) 타임아웃 없이 STATUS 가 오는지 — 그래도 inbox 의 `_Cmd_<project>` 유발 무응답(§1-GN 남은 일)은 별건.
- [ ] **(2026-10-28, §1-GM) Upload Only 여러 프로젝트 — VSIX·실기 확인(FTP 만, 모션 무영향).** ① 탐색기에서 프로젝트 폴더 2개 이상 Ctrl 선택 → 우클릭 `GPL: Upload Only` 가 고른 순서대로 올리고 끝에 「Upload Only 완료 n/n」 한 번만 뜨는지(프로젝트별 토스트 없음) ② 프로젝트 아닌 폴더를 섞으면 「n개만 업로드」 모달 ③ 팔레트에서 다중 선택 QuickPick, 직전 선택이 미리 체크되는지 ④ 둘째 프로젝트에서 실패(예: FTP 끊김)·미저장 확인 취소 시 셋째 이후가 「미실행」으로 남는지 ⑤ 정체 확인(`verifyControllerIdentity`)이 프로젝트마다 반복되는 지연이 체감되면 묶음 1회로 줄일지 결정.
- [ ] **(2026-10-27, §1-GK) 패키지 의존 검사 — VSIX·UI 확인(편집기만, 모션 무영향).** BinderR4 의 `Gantry\Station\Project.gpr` 를 열면(인덱싱 뒤 약 1 s) ① Problems 에 `GPL Dependencies` 진단 — Station 의 `ProjectLibrary "Lib\Core\Foundation"`·`"Lib\Core\Text"` 줄에 미사용 Information, `Lib\Device\CantopsIOCmd\Project.gpr` 에 간접 의존 3건, `Lib\Motion\Cmd` 에 간접 1건(드라이런 결과와 같은지) ② Quick Fix 「… 줄 지우기」/「ProjectLibrary=… 추가」와 「이 .gpr 의 의존 문제 모두 고치기」가 뜨고 적용·저장하면 1.5 s 뒤 재검사로 사라지는지 ③ `.gpr` 우클릭 「Check Project Dependencies」 → 요약 알림·Output `[Dependencies]` 목록 ④ App 파일에서 `Lib` 쪽이 App 을 참조하게 임시로 고치면 계층 위반 Warning 이 그 줄에 뜨는지(되돌릴 것) ⑤ `gpl.project.dependencyCheck: manual` 이면 열어도 검사하지 않는지. 미결: 미사용 판정은 "직접 쓰지 않음"이라 라이브러리가 자기 의존을 선언하지 않고 이 패키지에 기대는 경우도 미사용으로 보인다 — 지우기 전에 사람이 확인.
- [ ] **(2026-10-27, §1-GJ) 0.22.0 대시보드 I/O — 실기 확인(Set DIO 는 실제 신호를 바꾼다: 장비 정지 상태·무해한 신호로).** ① I/O 탭에서 Local I/O(Digital 13~20/10001~10012 · Soft 20001~20064 · Dedicated 제어기 8081~/18001~ · 축 1~6)·Remote I/O 「미검출」이 실기 응답대로 나오는지. ② Soft 신호(예: 20064) 더블클릭 → 강제 ON(`Set DIO 20064 1`)·모서리 표시·탭 숫자, 우클릭 「강제 해제」 → 표시 사라짐, 「모든 강제 해제」가 강제된 것만 `Set DIO n 0` 으로 보내는지(GPL Traffic). ③ 폴링 1 회가 `Show DIO` + Soft 3 줄(160자 분할) 로 끝나고 STATUS 0 인지, 0.5 s 주기에서도 1402 큐가 밀리지 않는지. ④ 우클릭 메뉴가 VS Code 기본 메뉴 대신 뜨고 Shift+F10·Esc 로 열고 닫히는지, 패널 크기 변경·스크롤에서 닫히는지. ⑤ RIO·서보 네트워크가 있는 장비에서 그룹이 RIO n·Network Node n 으로 잡히는지(문서상 node n 일반 I/O 는 +100000·n, 13~20/10001~10012).
- [ ] **(2026-10-27, §1-GI) 0.21.0 연결 판정 — 실기·UI 확인(읽기 경로·모션 무영향).** ① 연결 중 제어기 LAN 케이블을 뽑거나 전원을 내리면 상태바가 **첫 이상 신호부터** `$(sync~spin) … 응답 확인 중 (실패 n/3)`(경고색)으로 바뀌고 툴팁에 계기·마지막 실패가 보이는지, 클릭하면 바로 해제되는지, 복구되면 정상 표시로 돌아오는지. ② Unload 무응답 뒤 `$(watch) … 복구 대기 n/180 s` 가 1 s 마다 갱신되는지. ③ 다음 유실 때 Output 에 `[Health] 확장 호스트 이벤트 루프 정지 …` 줄과 유실 알림의 「판정이 늦어진 N s 는 … 확장 호스트가 멈춰 있던 시간」, 사후 스냅샷 「확장 호스트 이벤트 루프 정지」 절이 채워지는지 — 채워지면 그 시각의 `%APPDATA%\Code\logs\…\renderer.log` 에서 범인 확장 프로파일을 찾는다. ④ GPL Traffic 에 `CONNECT TIMEOUT (3000ms, no handshake)` 가 정상 운용(부팅 직후 포함) 중에 뜨지 않는지 — 뜨면 `gpl.controller.connectTimeoutMs` 를 올린다.
- [ ] **(2026-10-27, §1-GG) Requires 헤더 — VSIX·UI 확인(편집기만, 모션 무영향).** BinderR4 를 연 상태에서 ① 인덱싱이 끝난 뒤 `App\Control\Machine.gpl` 의 `'Requires:` 줄에 Information 진단(「추가 2 … · 메모 1줄 → 'Notes:」)과 Quick Fix 「Requires 헤더 갱신」이 뜨는지, 적용하면 MotionSystem.gpl 두 줄이 한 줄로 합쳐지고 Deck 설명이 `'Notes:` 로 가며 `'Used by:` 는 그대로인지, Ctrl+Z 로 한 번에 되돌아가는지 ② `GPL: Update Requires Headers in Project` → Refactor Preview 에 헤더 있는 파일(83개 중 변경분)이 파일별 라벨로 뜨고, 일부만 체크해 적용되는지 ③ `gpl.requiresHeader.mode: onSave` 에서 저장 시 바로 고쳐지는지, 블록 없는 파일은 그대로인지 ④ 인덱싱 중(활성화 직후)에는 진단이 안 뜨는지 ⑤ 큰 파일(LeadshineRS.gpl)에서 타이핑 지연이 체감되는지(드라이런 첫 계산 수백 ms 는 컴파일 단위 캐시 예열, 이후 파일당 수십 ms). 미해결: 문자열로 부르는 프로시저(`AddSync("Name")` 류)·수신자 타입을 모르는 멤버 호출은 목록에 안 들어감(누락 쪽 — 확인 필요하면 SYMBOL_STRING_CONSUMERS 연동 검토).
- [ ] **(2026-10-26, §1-FZ) 0.18.0 실기·UI 확인.** ① FTP 쓰기 전 정체 확인: 실제 제어기에서 220 배너(`RTEMS FTP server`)가 읽혀 Upload Only·Quick Compile이 막히지 않는지, 배너·런타임 콘솔 핸드셰이크 프로브가 무해한지. ② 그룹(Lib) Compile 뒤 Unload 확인 모달·MCP `confirm` 흐름과 재부팅 뒤 자동 해제. ③ 참조 찾기(BinderR3 `BRI.Setup`)·정의 이동(`NUM` 2후보, MergeCode `getWafer`) 결과와 놓치는 참조 여부. ④ 새 진단 8종의 대형 코드베이스(V2/Lib) 오탐률. ⑤ `date` 응답 형식·잔여 오차·재부팅 뒤 유지. ⑥ 메모리 경고 상태 표시줄과 배포당 1회 알림. 보류 항목(모듈 String 첫 사용 린트, Unload 소켓 유지, Lib upload-only 기본값)은 §1-FZ 남은 일 참조.
- [ ] **(2026-10-23, §1-FY) 명령 커서 아이콘 — 새 VSIX/UI 확인.** 0.17.2 설치 후 확장 목록·README와 활동바/Status 보기에서 컬러·단색 아이콘을 밝은/어두운 테마로 확인한다. 24px 렌더링과 패키지 내용은 정적으로 확인했으며 실제 VS Code 표시와 캐시 갱신은 아직 보지 않았다.
- [ ] **(2026-10-23, §1-FX) FTP 새로고침 UI 확인.** 새 VSIX에서 조회 진행 중 새로고침·연속 클릭·편집기/세션 종료를 확인한다. 모의 FTP 회귀와 로컬 테스트는 실제 제어기·VS Code UI 검증을 대신하지 않는다.
- [ ] **(2026-10-27, §1-GF) 0.19.2 분해 뒤 실기·UI 확인.** 재생 하니스·테스트로는 같다고 확인했지만 실기기와 VS Code UI 는 돌리지 않았다. ① F5 Attach → Step/Continue/Pause → 변수·Watch·REPL(`>Show Thread`)·조건부 BP(설정 켜고) → Disconnect 가 종전과 같은지(Debug Console 로그 줄도) ② Deploy & Run·Quick Compile·Upload Only·메모리 심각 모달·쓰레드 정지 모달이 종전 순서대로 ③ 제어기 트리 각 섹션·상황/진단 보고서 복사 결과 ④ `scripts/dev/index-performance.js` 를 실제 워크스페이스(9 s 보고)에서 돌려 어느 단계가 느린지(합성 64파일은 0.3 s 라 재현 안 됨). 이상이 보이면 `node scripts/dev/deployReplay.js <시나리오>`·`compareTreeProvider.js` 로 old/new 를 다시 대조한다.
- [ ] **(2026-10-27, §1-GE) 0.19.1 시작 동작 확인(UI만).** 새 VSIX 설치 뒤 GPL Console 또는 터미널을 보이게 둔 채 VS Code 창을 다시 열어 ① 활성화 직후 ② `Symbol cache initialized!` 가 찍히는 시점(대형 워크스페이스는 수 초 뒤) 모두 패널이 Output 으로 바뀌지 않는지, ③ 설정을 건드리지 않은 상태에서 Output 에 `[Trace] gpl.trace.server = verbose` 와 `[SymbolCache] …` 줄이 기본으로 남는지. 「예상 프로젝트가 Upload Only·열린 파일로 바뀌는」 건은 §1-GE 남은 일의 제안 ①② 중 하나를 사용자가 고르면 구현.
- [ ] **(2026-10-27, §1-GC) 0.19.0 실기·UI 확인(Unload·Start 는 정지 상태·저속/시뮬레이션에서).** ① 명령 팔레트/트리 `···` 「GPL: Unload Project」 → `/GPL` 폴더 QuickPick(이름 입력·`-all` 항목 포함) → 앱(BinderR3) 선택 시 모달 없이 `Unload BinderR3` STATUS 로 완료/거부(-750) 보고, **`Lib`(ProjectStart 없음) 선택 시 그룹 Compile 표시가 없어도 「그래도 Unload/취소」 모달**이 뜨고 AI `unload_project`/`sendCommand('Unload Lib')` 는 `refused:"unload-after-group-compile"`(detail 에 "ProjectStart 가 없는 그룹"). 그룹 Unload 로 제어기가 멈추는 현상의 회피 방법은 미확인 — 실기에서 실제로 보낼지는 사용자 판단. ② 여유 메모리 심각(≤2.5 MB) 상태에서 사람이 Build/Deploy → Stop 뒤 Compile 직전 「그래도 Compile/취소」 모달, 취소하면 `[Deploy] … 중단: 여유 메모리 … 사용자가 취소` + 「Unload…」 버튼, 트레이스에 `✘ 사용자가 여유 메모리 심각 경고에서 취소`; `gpl.start`·FTP Run 도 같은 모달; MCP `deploy_project build` 는 모달 없이 `precheckWarnings` 만. 메모리 알림 토스트에 「Unload…」 버튼. ③ Project.gpr: 탐색기 밖(파워셸/SVN)에서 프로젝트 폴더에 `.gpl` 을 만들거나 지우면 1회 알림(「반영/항목 선택…」), 배포 직전에 목록이 다르면 「반영 후 배포/그대로 배포/취소」 모달, 「그대로」면 Output 에 `⚠ Project.gpr 소스 목록이 폴더와 다릅니다 — 추가 N (…)` 와 MCP 응답 `precheckWarnings`·`gprSyncMismatch`. 대량 변경(SVN 갱신)에서 프로젝트당 알림 1회인지. ④ GPL Console/Live Log 를 보는 상태에서 AI 가 `show_threads`·`eval_expression`·`list_remote_projects` 를 30초 넘게 띄엄띄엄 불러도 패널이 Output 으로 바뀌지 않고, `deploy_project`/`stop_threads`/`set_breakpoint` 에는 (30초 조용 뒤) 바뀌는지.
- [ ] **(2026-10-26, §1-GB) 0.18.3 실기·UI 확인.** ① BinderR3 **실행 중**에 `deploy_project build` → 차단 없이 Stop→Compile 까지 가고, `precheckWarnings` 에 「업로드 전 측정 — …(실행 중인 앱 … 포함)」과 「정지 뒤 Compile 직전 측정 — …」 두 줄, `memoryPrecheck.freeMb` 가 정지 뒤 값(≈3 MB)인지. 상태 표시줄 배지 문구 "심각(… 전송은 막지 않음)". ② FTP 트리에서 `/GPL/Lib/Motion/Cmd/MotionCmd.gpl` 을 열어 `MSC.OnErr` F12 — Output 에 `[Remote Source] … → <로컬 Lib 경로> (deploy-record|project-name|folder-name, 소스 N개)` 가 찍히는지, 정의가 원격 사본(열어 둔 경우) 또는 로컬 파일로 열리는지. 안 되면 그 줄(매핑 없음/실패)과 Debug Console 로그를 보고. ③ 로컬에서 고친 파일의 원격 사본을 열 때 「로컬 열기」 알림 1회.
- [ ] **(2026-10-26, §1-GA) 디버그 스텝 체감 — 0.18.2 실기 확인(읽기 경로·모션 무영향).** ① Locals 가 많은 프로시저(또는 Globals 를 펼친 상태)에서 정지 직후 바로 F10 연타 → Debug Console 의 `⏱ Step over 총 …` 줄에서 **큐 대기(ms)가 0~수십 ms** 인지(종전엔 남은 변수 조회만큼 수백 ms~수 초). ② Move 가 있는 줄을 Step → 1403 트리거 없이도 `정지 확인 대기: step 가 … → 1000ms 간격 백업 폴` 뒤 1 s 안에 정지가 잡히는지, Continue 는 20 s 뒤 백업 폴이 사용자 간격으로 돌아가는지(GPL Traffic 의 Show Thread 간격). ③ 재개 직후 Variables 패널이 일부만 채워진 채 멈추는 일이 없는지(남은 조회는 버리므로 다음 정지에서 다시 채워져야 정상). ④ 타이밍 줄의 「정지 감지」 출처가 평소 `1403 트리거` 인지 — `fast poll`/`대기 백업 폴` 이 대부분이면 1403 `<E>` 이벤트가 스텝 완료를 알리지 않는 것(§1-L 남은 일)이므로 그때는 FAST_POLL_DELAYS 를 더 촘촘히 할지 결정.
- [ ] **(2026-10-22, §1-FQ) Hover 성능 — 새 VSIX 편집기 확인.** PoseFile.gpl:132의 AxisCount와 여러 파일의 함수 이름에서 첫 마우스 Hover·재방문 반응을 확인한다. 실제 소스 하니스에서 VS Code의 표시 대기·렌더링·다른 확장의 경합은 측정하지 않았다.
- [ ] **(2026-10-22, §1-FN) Hover 수정 — 새 VSIX 편집기 확인.** PoseFile.gpl:132의 axes·table·AxisCount 위에서 각각 Integer 변수·JointPoseTable 매개변수·AxisCount() As Integer 시그니처가 표시되고 범위가 해당 식별자로 나뉘는지 확인한다. 자동 회귀 6건과 전체 1222건은 통과했다.
- [ ] **(2026-10-22, §1-FH) 간단한 hello-project — F5 UI 및 제어기 컴파일·실행 확인.** Main.gpl의 Add·Clamp에서 F12·Shift+F12·F2·호버·시그니처 도움말, counter 객체 완성·Count Property·Outline·접기를 확인한다. 제어기에서는 출력 sum: 3 / clamped: 100 / count: 3과 Increment 호출 중단점의 스텝·변수를 확인한다. 정적 검사와 관련 테스트 55/55만 수행했다.
- [ ] **(2026-10-22, §1-FG) 수신함 후속과 0.14.0 검증.** `docs/requests.md` 표의 미구현 항목을 유지한다. 새 VSIX에서 메모리 가드의 사람/MCP 차단·측정 실패 표시, Upload Only의 기존 FTP 전용 계약, 수신 대기 중 후속 Stop 접수, 선택 Try 안내를 확인한다. 실제 Compile/Start/Stop은 안전한 시험 조건과 별도 승인 범위에서만 수행한다.
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
- [ ] **(2026-10-23, §1-FW) FTP 원격 파일·현재 창 Attach — 새 VSIX/UI/제어기 확인.** `GPL: Browse Controller Files`로 명령 콘솔 연결 없이 FTP 폴더를 펼치고 파일을 열어 본다. 기존 창·폴더·설정이 유지되고 새 Workspace Trust 요청이 없는지, 읽기 전용 편집기·새로 읽기·열린 소스의 언어 기능을 확인한다. 프로젝트 우클릭 Attach는 .gpr 관계와 필요한 파일만 읽으며 Main/라이브러리 스택·줄 BP가 원격 URI로 연결돼야 한다. Traffic에 자동 업로드·Compile·Start·Stop·초기 기존 BP 해제가 없어야 한다. 닫은 문서와 종료한 세션의 TMP 캐시 수명, 서로 다른 제어기·프로젝트의 동명 파일 격리도 확인한다. VSIX 설치·실제 UI·실기 검증과 FTP 소스/실행 바이너리의 일치는 별도 확인 대상이다.
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
      ① 새 VSIX 설치 → `GPL: Check AI Agent Setup` 에서 등록 상태 확인(§1-GV — 사용자 범위 등록, `GPL_BRIDGE:"only"`) → AI `/mcp` 재연결
      ② 사람이 VS Code에서 연결한 상태로 `extension_status` → `bridgeMode:"only"`, `transport.using:"extension-bridge"`, Sample Prep 인스턴스 `connected:true`
      ③ AI 읽기 명령 1건 → Output/Traffic에 `(agent)`로 같은 명령·응답이 남고 `Get-NetTCPConnection`에 별도 MCP direct-tcp 소유자가 생기지 않는지
      ④ 확장 브리지를 잠시 끈 상태에서는 AI가 direct로 우회하지 않고 `GPL_BRIDGE=only — 확장 브리지를 쓸 수 없다`로 `not-sent`를 돌려주는지.
- [ ] **(2026-10-20, §1-EZ) AI 영구 기본 프로젝트 제거 — 새 VSIX/Export/MCP 재연결 뒤 확인(설정 파일·조회만, 모션 무관).**
      (①② 의 `.mcp.json`·AGENTS 블록 갱신 확인은 §1-GV 에서 워크스페이스 파일 자체를 폐기해 무효 — 정리 확인은 §1-GV 항목.)
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
- [ ] **(2026-10-19, §1-EU) Start 뒤 메인 쓰레드 Error 감시 — 실기 확인(Start 포함이므로 저속/시뮬레이션).** 새 VSIX 로
  ① Sample Prep 의 AntiBodyR2 를 로봇 1대 제어기에 Upload & Start → 5 s 안에 에러 토스트 「배포는 끝났지만 Start 뒤 메인 쓰레드가 Error 로 멈췄습니다: AntiBodyR2 Error — -1509 … @ _robot_ExtraModuleHandler.gpl:484 (setUseAutoHome)」 + 힌트, 해당 줄 붉은 강조, 트리 오류 컨텍스트, 상황 스냅샷 요약
  ② 정상 프로젝트 → 토스트 「배포 완료」 그대로, Output 트레이스에 `✔ 메인 쓰레드 … Error 없음` 또는 `프로그램이 끝났다`
  ③ MCP `deploy_project(mode:"upload_start")` 응답에 `runtimeError`·`warning`, `operation_status` 목록 `resultSummary` 에 `runtimeError -1509 @ …`
  ④ `postStartWatchMs: 0` 이면 감시 줄이 트레이스에 없고 소요가 종전과 같은지
  ⑤ 1402 거부 상황에서 `controller_status` → `observations.localConnections.measured:true`, 다른 창이 잡고 있으면 `foreignOwners` 와 verdict 의 PID 문구; `show_threads` 요약의 `pausedThreads`/`errorThreads`/`stoppedThreads`.
- [ ] **(2026-11-04, §1-GX) 제어기 패널 재배치 — 새 VSIX UI 확인(조회만, 모션 무관).** ① 설치 뒤 첫 표시에서 순서가 연결 → 프로젝트 상태 → 쓰레드 → 코드 오류 → 브레이크포인트 → FTP 파일 → 시스템 정보 → I/O → 환경 경고 → Flash Projects 이고, 펼친 것이 프로젝트 상태·쓰레드·FTP 파일·시스템 정보뿐인지(EPOCH 3 으로 저장된 접기 상태가 한 번 초기화) ② 시스템 정보 새로고침 뒤 CPU 온도는 바로 보이고 「앰프 온도 (N) · 최고 xx.x°C」가 접혀 있는지, 펼치거나 접은 상태가 다음 새로고침에도 유지되는지 ③ 사용자가 순서를 더 바꾸고 싶다고 하면 `treeSections.buildConnectedRoot` + `treeSectionsLayout.test.ts` 만 고치면 된다.
- [ ] **(2026-11-04, §1-GV) AI MCP 사용자 범위 등록·주소 자동 추종 — 새 VSIX 실사용 확인(설정 파일·조회만, 모션 무관).**
  ① 개발 소스로 직접 등록해 둔 이 PC(`~/.claude.json`·`~/.codex/config.toml` 모두 `controller-mcp/src/index.js`)에서는 활성화 때 아무 제안도 없고 등록이 그대로인지(foreign 유지).
     다른 PC(또는 user scope 의 gpl-controller 를 지운 상태)에서는 「사용자 설정에 한 번 등록할까요?」 → 등록 → `claude mcp get gpl-controller` 가 globalStorage `gpl-controller-mcp.cjs`·`GPL_BRIDGE=only` 만 보이는지.
  ② 확장에서 제어기 IP 를 바꾼 뒤(.1 ↔ .102) MCP 를 재연결하지 않고 `extension_status` → `host` 와 `transport.controller{source:"extension"}` 이 새 IP 로 따라가는지, Sample Prep 창에서 `deploy_project(mode:"build")` 가 정상인지.
  ③ Sample Prep 등 예전 Export 흔적이 있는 작업 공간을 열면 「예전 … 파일이 N개」 제안이 한 번만 뜨고, 「정리…」 모달 목록대로 `.mcp.json` gpl-controller 항목·CLAUDE.md/AGENTS.md 자동 블록만 사라지는지(사용자 본문·다른 서버 보존). `.codex` 폴더는 확장 것이 아니라 대상이 아니다.
  ④ claude CLI 가 PATH 에 없는 PC 에서 등록 → 「명령 복사」 안내가 뜨고 설정 파일은 바뀌지 않는지.
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
- [ ] **(2026-09-10, §1-DK) 구버전 MCP 사본 호환 확인.** 예전 등록으로 globalStorage 에
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
- [ ] **(2026-09-10, §1-DE) 배포·FTP Run 실기기 확인 — Compile/Load/Unload/Start 구현이 하나로 합쳐졌다.**
  저속/시뮬레이션에서만(Start 를 보낸다 — 하드 규칙 9). ① 「빠른 컴파일」·「Deploy」가 종전과 같은 트레이스로
  끝나는지(단계 배너·CMD/RAW/NOTE 줄). ② **소스에 일부러 에러를 넣고** FTP Run 을 실행 → 종전에는 토스트 한 줄만
  나오던 컴파일 에러가 **Problems 패널에 뜨고 첫 에러로 점프**하는지(같은 이름의 로컬 프로젝트가 열려 있을 때).
  ③ FTP Run 의 Start 가 Traffic 에 `Start <name> -event` 로 나가는지(종전에는 `-event` 가 없었다) + 1403 이벤트가
  오는지. ④ 트리에서 `/GPL/<name>` 노드로 FTP Run 했는데 flash 에도 같은 이름이 있으면 로그에 경로 전환
  (`Path selected: … → …`)이 남는지. ⑤ FTP Unload 를 쓰레드 실행 중 실행 → -750 안내가 뜨는지.
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
  ③은 저속/시뮬레이션 필수, 하드 규칙 9)**: ① 활성 쓰레드가 있는 상태로 autoOnSave/Deploy →
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
  (Start 를 보내는 ⑤는 저속/시뮬레이션 필수, 하드 규칙 9)**:
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
  ⑧ (무효 — §1-GV 에서 워크스페이스 `.mcp.json`·AGENTS 블록을 폐기, 정리는 `GPL: Remove AI Agent Files from Workspace`.)
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
- [ ] **(2026-08-31 §1-CD, 2026-09-10 §1-DL 갱신) 「업로드 스타트」 실기기 검증 — Start를 보내므로 저속/시뮬레이션 필수(하드 규칙 9)**:
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
- [ ] **(2026-08-28, §1-BS) 스레드 단일 실행 잠금 + ContinuedEvent 수정 — 실기기 검증(읽기·UI 위주, 새로 재개되는 스레드 없음)**: ① 2개 이상 스레드를 각각 BP로 정지 → CALL STACK에서 A 우클릭 `GPL: 스레드 실행 잠금` → 라벨에 🔒, 상태바 `$(lock) 스레드 잠금: A` ② B가 BP에 걸려도 포커스가 A에 남는지(preserveFocusHint), 그 상태에서 F10/F5가 **A에만** 나가는지(GPL Traffic의 `Step A …`/`Continue A`) + Debug Console에 잠금 되돌림 로그가 첫 건만 남는지 ③ 외부(GDE 또는 MCP `continue_thread`)로 A만 재개 → **B의 CALL STACK·변수·정지 배지가 유지**되는지(ContinuedEvent `allThreadsContinued=false` 수정 효과 — 종전에는 사라졌다) ④ 잠금 중 F6으로 B를 Pause → 요청한 B가 멈추는지(잠금 미적용이 의도) ⑤ 잠근 스레드를 CALL STACK 우클릭 '스레드 종료' → 상태바·라벨 잠금이 즉시 사라지는지, Shift+F5 후에도 남지 않는지 ⑥ 상태바 자물쇠 클릭 = 해제, 명령 팔레트 `GPL: 스레드 실행 잠금 토글`이 디버그 중에만 보이는지.
- [ ] **(2026-08-28, §1-BS) 조사 문서 실기기 검증 대기 목록** — `docs/development/pa-controller-debug-operations.md` §8: `Step … -out` 실동작(캡처 근거 없음), `Set Nobreak`의 no-space 형식, `Start … -event` 유/무에 따른 1403 수신량, `help` 명령 존재 여부(= 펌웨어 실제 지원 명령 목록을 얻는 최선의 수단), `Pdx`·`Pd … <node>`·`ErrorLog <thread>`/`-servo`·`Show StartupLog` 응답 형식, `Show Break` procLine(4열)을 우리 파서가 쓰지 않는지, `Execute`가 만드는 `_Cmd_<project>` 스레드를 settle 판정이 사용자 스레드로 오인하지 않는지. 모두 읽기 전용이거나 저속 검증 가능 — `pc` 쓰기와 `Show Memory -verify`는 검증 대상에서 제외(위험).
- [ ] **(2026-08-28, §1-BQ) Agent Bridge(MCP↔확장) — 실기기/실환경 검증**: ① VS Code에서 확장 활성화 후 MCP `extension_status` → `transport.using = extension-bridge`, 확장 버전/pid/connected 일치 ② `show_threads` 실행 → GPL Traffic에 `>>> Show Thread  -web`이 **확장 채널로** 찍히고 MCP 세션 로그에 `via extension` ③ VS Code를 닫고 같은 도구 → `direct-tcp`로 자동 폴백, 힌트가 '확장이 실행 중이 아니다'로 나오는지(점유 결론이 안 나오는지) ④ `extension_status(wake:true)`가 VS Code를 깨우는지(`code` CLI 없는 환경에서는 wakeError) ⑤ `extension_command('gpl.quickCompile', …, timeoutMs:180000)`로 확장 Deploy/Quick Compile이 MCP에서 실행되고 결과가 오는지 ⑥ 정지 전 Step 연타를 MCP로 시도 → `policy-hold`가 그대로 전달되고 **직접 접속으로 우회하지 않는지** ⑦ 브리지 처리 중 확장을 종료 → 모호한 실패에서 상태 변경 명령이 재전송되지 않는지 ⑧ `GPL_BRIDGE=only`에서 확장 없을 때 명확히 거부하는지 ⑨ `%TEMP%\gpl-controller\bridge\`에 요청/응답 파일이 남지 않는지(정상 처리 후 0개).
- [ ] **(2026-08-28, §1-BP) F5 개발 호스트 전용 프로필 — 사용자 확인(코드 무관, 제어기 무영향)**: ① F5 "Run Extension" → 새 창이 `samples/hello-project`를 열고, 창 위치·사이드바가 **기본 상태**인지 ② Extensions 뷰에 우리 확장만(개발 모드) 보이고 평소 확장이 없는지 ③ 평소 창에서 저장소 폴더를 다시 열었을 때 프로필이 바뀌지 않았는지(폴더 분리가 의도대로 동작하는지) ④ 테마를 GPL-DevHost 프로필에 설치·선택한 뒤 F5를 다시 눌러 유지되는지.
- [ ] **(2026-08-28, §1-BQ) 프로젝트명 공백 가드 — 실기기 확인(읽기 전용 위주, 모션 무영향)**: ① 테스트용 폴더 `My project`(Project.gpr ProjectName도 `My project`)를 워크스페이스에 두고 열기 → 활성화 직후 `GPL 프로젝트명 경고 — …` 1회(세션 중 재감지에 재경고 없음) ② 그 프로젝트로 Deploy/Quick Compile → FTP 업로드·1402 명령 없이(GPL Traffic 확인) `UPLOAD 단계 실패 … Validate project name` 안내 ③ `GPL: Start`·F5 attach → `Start 중단`/`디버그 시작 중단 — …`(제어기 미전송) ④ MCP `compile_project({project:'My project'})` → `ERROR (compile_project): 프로젝트명 …` ⑤ **문서상 사실 확정**: GPL Traffic 콘솔(raw)로 `Compile My project` 1회 → 실제 STATUS 코드·문구를 §1-BQ에 기록(존재하지 않는 프로젝트라 무해) ⑥ 정상 이름 프로젝트의 모든 경로가 종전과 같은지(경고·차단 0건).
- [ ] **(2026-08-28, §1-BN) URI 전체 개방·명령 정책 — 실기기 검증(저속/시뮬레이션, Step·Start 포함이므로 하드 규칙 9)**: ① `code --open-url "vscode://nir414.gpl-language-support/gpl.ai.debug.getState"` → Output `[URI] gpl.ai.debug.getState => {…}`; `/gpl.controller.threadBreak?threadName=MainThread` → 일시정지; `/command?id=gpl.controller.showTraffic`; `gpl.*` 밖 id → 경고만 ② **R1**: 정지 쓰레드에 `gpl.ai.debug.stepThread({threadName, waitForPause:false})`를 연속 3회 → Traffic에 `Step`이 정지 관측 뒤에만 나가고 `--- policy: R1 step … 정지 확인 대기/확인` 줄; 긴 모션 줄 Step 뒤 8 s 안에 정지 안 되면 `{ ok:false, error:'policy-hold', code:'resume-pending' }`(제어기 미전송 확인) ③ **R2**: `Stop -all` 직후 `gpl.start` → Traffic에 `Show Thread -web` 재조회 뒤 Stopping 사라진 다음 `Start`; deploy()/ftpRun/F5 소요 증가량 기록 ④ **R3**: Quick Compile 직후 Start → `--- policy: R3 … 완충` 뒤 전송(1.5 s) ⑤ 디버그 세션 F10 연타 → 어댑터 `Step/Continue 요청 무시`가 먼저 걸리고 policy R1 개입은 0~1회 ⑥ `commandPolicyEnabled: false`로 종전 동작 복귀 확인.
- [ ] **(2026-08-28, §1-BM) 1402 유휴 ping·1403 UTF-8 — 실기기 검증(읽기 전용, 모션 무영향)**: **①② 완료(2026-08-28 사용자 실사용 관측, 0.8.20 — 1403 연결이 해제되지 않고 유지됨; Traffic 원문 대조·30분 계측은 미실시)** ③ 대조 실험: `keepAliveIdlePingMs: 0`으로 되돌려 같은 30분 → `1402 CLOSE (idle 30s)` 직후 수 초 안에 `[1403] CLOSE`가 따라오는지(1402↔1403 결부 가설 확정/기각) ④ 제어기 전원 차단 시 유휴 상태에서도 `[Health] 연결 의심 — probe`가 ≤ 5 s + 8 s에 뜨는지(ping 프로브 보고) ⑤ GPL 프로그램에서 `Console.WriteLine("한글 테스트 가나다")` → GPL Console `[RT]` 줄이 온전, 130바이트 이상 한글 섞인 줄도 온전, 상태 로그에 `WARN=L_MISMATCH` 0건 ⑥ 포트 필터 없이 제어기 IP 전체를 pktmon 5분(GDE 접속·Stop/Start 포함) → 1404 사용 여부, `<E>1,N</E>` vs `Show Thread -web` 스레드 수, 1403 FIN과 1402 명령의 시간 관계.
- [ ] **(2026-08-28, §1-BK) 연결 끊김 감지 — 실기기 검증(읽기 전용, 모션 무영향)**: ① 연결 후 케이블 분리(또는 제어기 전원 차단) → Output `[Health] 연결 의심 — …`(출처 runtime-console / keep-alive-socket / probe 중 무엇이 먼저였는지) 뒤 GPL Traffic에 `Show Thread -web`이 ≈ 1 s 간격·8 s 타임아웃으로 3회 → `[Controller] Connection lost — … 3회 연속 실패` + 상태바 offline + 알림이 **30 s 이내**인지(타임스탬프 기록, §1-BK 표 확정) ② 제어기 재부팅 → REFUSED 2회로 수 초 내 유실 ③ 디버그 세션(BP 정지·Running 각각) 중 ①을 재현 → Debug Console `Show Thread 실패 1/3…`과 확장 유실 판정이 같은 시점, 세션 종료 후 상태바 offline ④ 정상 운용 30분간 `[Health] 연결 의심` 오탐 0건(1403 빈 세션·Immediate EOF·keep-alive `CLOSE (by peer)`는 힌트가 아님을 확인) ⑤ 수 초 끊김 뒤 복구 → `[Health] 연결 복구 — N회 실패 뒤 …` 로그와 연결 상태 유지 ⑥ `gpl.ai.debug.getConnectionState.health` 값 ⑦ 사후 스냅샷 파일에 `## 유실 판정` 절.
- [ ] **(2026-08-27, §1-BJ) 이슈 #32 — 실기기 검증(읽기 전용, 모션 무영향)**: ① `RNDRobot.org()` 프레임에서 `robotArmList(0).controlAxis` hover → `4 (Integer) ← m_controlAxis (Get 반환식)`; 정적 hover(비디버그 또는 디버그 hover 닫힌 뒤)가 `Property controlAxis As Integer`(RobotArm) 표시, Output `[Hover Receiver] robotArmList(0).controlAxis: class RobotArm → property controlAxis` ② 같은 프레임에서 `RNDRobot.controlAxis("T")`의 `controlAxis` hover는 여전히 차단(규칙 1) ③ 동명 Property가 두 클래스에 있는 식이 있으면 Debug Console `프로퍼티 후보 클래스 한정(#32)` 로그 확인 ④ **규칙 1 근거 실측(시뮬레이션·무해한 Sub만)**: 파라미터 없고 모션 없는 Sub 이름 단독 `Show Variable -eval <thread> <frame> <SubName>` → -780(실행 안 됨)인지 — 실행되면 §1-BJ 사실 정리 수정 ⑤ 괄호 없는 중간 세그먼트(`obj.GetArm.count`)를 -eval이 호출로 실행하는지(실행되면 게이트에 중간 세그먼트 callable 검사 추가).
- [ ] **(2026-08-26, §1-BI) 이슈 일괄 처리분 — 실기기 검증(통신 패턴·읽기 전용·UI, 모션 무영향)**: ① **1402 keep-alive**: 연결 후 GPL Traffic에 `--- 1402 CONNECT #1 (keep-alive)` 1회 뒤 `Show Thread` 폴링이 CONNECT 없이 이어지는지(제어기가 응답 뒤 끊으면 매번 `CLOSE (by peer, held 0s)`+CONNECT → 기본값 false 되돌릴지 결정) / GDE·MCP 동시 접속 시 세션 수 제한 유무 / 30 s idle 뒤 `CLOSE (idle 30s)` vs `by peer`(제어기 유휴 타임아웃이 짧으면 `keepAliveIdleCloseMs` 축소) / `Show Network -tcp` accepted/s가 종전 1~3/s에서 ≈0으로 / stale-retry가 Continue·Step 같은 상태 변경 명령에서 발생한 사례 감시(있으면 read-only로 재시도 제한) ② **Step 게이트**: F12 홀드 시 Traffic에 Step이 30 ms 간격으로 나가지 않고 Debug Console에 `Step/Continue 요청 무시` 1회 + 요약; 정지 뒤 다음 Step 정상; 다른 스레드 Step은 허용 ③ **백업 폴**: Running 중 1403 정상이면 `Show Thread -web` 간격 5 s(Traffic), 1403 중지 시 1 s로 복귀, Debug Console `백업 폴:` 전환 로그 ④ **stale BP**: Deploy 후 파일 편집 → Attach only → 상태바 `⚠ 소스 변경됨 1` + 알림 + 그 파일 BP 회색·메시지 / 세션 중 저장 → 즉시 회색 / Quick Compile 성공 → 복원 / 배지 클릭 → 재시작 흐름 / 배포 기록 없는 워크스페이스에서 안내 로그만 ⑤ **1403**: `RECONNECT (…)`가 매 세션 뒤 1줄, 30분 정상 폴링에 `WATCHDOG:` 0건, LAN 분리로 connecting 고착 시 워치독 또는 connect timeout 한쪽만 동작, `batchReconnectDelayMs` 반영 ⑥ **FTP 스로틀**: LAN 단절→복구 플랩 시 5분 이내 재조회 없음(Traffic에 Show Memory/Flash Free/CPU Profile 미발생, FTP passive 연결 0), 명시 Disconnect 후 재연결은 즉시 조회 ⑦ **자원 카드**: Free/Used/Segments·accepted/s·clusters free·drops 값 채워짐(실기기 원문 기준 파서), 재부팅 후 카운터 리셋 표시, `-mbuf` 스위치 거부 시 STATUS 표시 ⑧ **사후 스냅샷**: 제어기 전원 차단으로 유실 유발 → `%TEMP%\gpl-controller\postmortem-*.log` 생성·알림 버튼·verdict(ICMP/TCP/arp, TTL 255·00-14-FF) 확인; 직결 NIC 임대 상실 재현 시 게이트웨이 응답 경고 ⑨ **connect 비대화형**: `code --open-url "vscode://nir414.gpl-language-support/connect"` → 연결·Output `[URI]`; `gpl.ai.debug.getConnectionState` 결과 ⑩ **MCP**: `read_dataids([2703,2704,2705])`, `controller_command(commands:[…])` 50건 소요, 문자열 값 DataID·wrap DataID·`pd 99999` STATUS, `controller_status(detail:true)` 2회 간격 ≥60 s에서 `acceptedPerSec` ⑪ **호버**: `showAfterClick` 켠 뒤 클릭 후 정지 → 호버, 드래그 선택 미표시; 수천 줄 문서에서 체감 ⑫ **단축키**: F9 = Toggle Breakpoint(기본), `gdeStyle` 켜면 F9 = Continue.
- [ ] **(2026-08-25, §1-BG) GPL Traffic 1402 응답 본문 표시 — 실기기 확인(읽기 전용, 모션 무영향)**: ① `Show Thread` 폴링 응답이 ` | ` 줄로 실시간 표시되고 마지막에 `<<<` 요약 ② `Compile`(waitForStatusClose) pass 사이 침묵 구간에 도착분이 먼저 보이는지 ③ 긴 응답(ErrorLog 다수) 4000자 초과 시 생략 요약 1줄 ④ 트리 `1402 통신 모니터` 인라인 토글/지우기 동작·설명 갱신, OFF면 `<<<` 요약만 ⑤ Live Log Terminal에도 ` | ` 줄이 흐르는데 과다하면 옵션 분리 ⑥ 좁은 사이드바에서 인라인 아이콘 2개 표시 확인.
- [ ] **(2026-08-25, §1-BF) 이슈 #27·#26·#24·#23·#18 — 실기기 검증(읽기 전용, 모션 무영향)**: ① Variables에서 `Robot.Where(1)`/Location 로컬 펼치기 → 멤버 값 표시·헤더 요약·`ZClearance (미설정)` ② hover/Watch `myRobot(0).armCount`(RNDRobot 프레임·StationManager 프레임 둘 다) → `1 (Integer) ← m_armCount (Get 반환식)`; 객체 노드 펼치면 가상 Property 자식; `Me.m_armCount` 자동 처리; `LocationEx.GetCurCartPos().loc` → `.Pos` 우회 ③ MCP `controller_status`(연결/차단/재부팅 중 3케이스 reachable verdict, powerEnabled), `show_threads` 크기 비교, `eval_expression("myRobot(0).armCount")` → resolvedAs, `debug_snapshot(listLocals:true)` 응답 형식 실측 → 런북 기록 ④ 확장 업데이트(0.8.18 → 0.8.19 VSIX 설치) 후 재시작 → "MCP 사본 갱신" 알림 → Claude Code `/mcp` 재연결 → `get_session_log.server.version` = 0.8.19; `GPL: Check AI Agent Setup` 정상/구버전 CLAUDE.md 감지 ⑤ 대시보드: 배지 색·flash, 축 게이지 이동 표시(Jog 중), XY 궤적, 주기 변경·일시정지, 상태바 `$(dashboard)` 진입.
- [ ] **(2026-08-25, §1-BE) 트리 쓰레드 스텝 정비 — 실기기 검증(저속/시뮬레이션 우선, 하드 규칙 9)**: ① 인라인 스텝이 `Step <t> -over -noerror`를 보내고 호출문을 **넘어가는지**(GPL Traffic·정지 줄) ② 우클릭 Step Into(`-noerror`)가 프로시저 **안으로** 들어가는지 ③ **Step Out(`-out -noerror`) STATUS 최초 실측**(Brooks 문서상 지원, GDE 캡처엔 없음) → 결과를 런북 "GDE 1402 실측 명령 포맷"에 기록 ④ 정지/에러 쓰레드 우클릭 → 스택 보기/현재 위치 보기 ⑤ STATUS≠0 경로(예: Running 쓰레드에 Continue, Idle 쓰레드에 Break) 에러 메시지 문구 확인.
- [ ] **(2026-08-25, §1-BD) 배포 순서 재배치 + 배포 잠금 — 실기기 검증, 릴리스 전 필수(하드 규칙 9)**:
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
- [ ] (§1-AG) 로컬 `npm run compile`→`npm run package`→VSIX 재설치 + 실기기 검증(Break/Step 상태 전이 타이밍, `-eval` 응답 형식, Error 전이 중단).
- [ ] (§1-P → §1-U에서 일부 완료) 실기기 검증: 1402 수동 검증으로 객체 덤프 형식 확인·분류 버그 수정(2026-07-22, §1-U). **남은 것(VSIX 재설치 후)**: Variables/hover/Watch에서 객체 트리 확장 UI 확인, 로컬 배열 펼침(30개 상한), 중첩 객체(`cmdResponse`), setVariable, Globals 패널 배열/객체 표시. 배열 확장 지연 크면 `ARRAY_EXPAND_MAX` 조정.
- [ ] (2026-07-16, §1-Q) 자체 검토 세션 변경분 — 로컬 `npm run compile` && `npm test` 후 §1-Q 실기기 검증 체크리스트 수행.
- [ ] (2026-08-18, §1-AY) Rename(F2) 실사용 검증 — MergeCode에서 로컬 변수/모듈 프로시저/클래스 멤버/스레드 문자열 참조 rename 확인. 다음 릴리스 CHANGELOG에 "Rename(F2) 지원" 기재.
