# AI 인계 자료 — GPL Language Support 확장 작업 핸드오프

- 최종 갱신: 2026-08-31 (§1-CA: **정의찾기(F12)의 "한정자 버리는 전역 폴백" 차단** — `Main.gpl`의 `Run`이 무관한 `Lib_MoveQueue.Run`으로 점프하던 문제. 멤버 접근 해석이 실패해도 `return`하지 않고 흘러내려 `findDefinitionMatches(word)`가 한정자를 버린 채 워크스페이스 전체를 이름으로 뒤지던 것이 원인. 내장 클래스 수신자(`Move.`/`Console.`/`Dim t As Thread` — provider가 사전을 import조차 안 했다)와 컨테이너가 확정된 멤버 미발견은 이제 `undefined`로 차단하되, 인스턴스 경로는 **클래스 정의가 인덱스에 있을 때만** 차단(stale 캐시 안전망 유지). 폴백이 우연히 해 주던 `MyModule.MyClass`·`Outer.Inner`·모듈 Property는 신규 공용 규칙 `receiverType.ownedByHolder`(+`nestedTypesIn`)로 소속을 검사해 계속 찾는다. 클래스 심볼의 `className`은 파서가 자기 자신으로 채운다는 사실에 맞춰 테스트 픽스처 정정. 테스트 555/555. 실제 `Main.gpl:23`이 어느 갈래였는지는 확인 대기(§3). 직전: §1-BZ: **GPL Console 줄 접두사 정리** — `[RT] [<프로젝트>]` → 기본 `[14:23:07] <메시지>`. 설정 `gpl.runtimeConsole.linePrefix`(`time`/`time+project`/`none`/`legacy`)로 일반화하고, 접두사 조립은 순수 함수 `formatRuntimeConsoleLine`(`controller/runtimeConsoleGuards.ts`)으로 분리. `outputLine(msg, project)`이 프로젝트명을 인자로 받아 접두사가 `_onDidReceiveLine` 리스너로 새지 않는다. 테스트 551/551. 직전: §1-BY: **FTP 섹션 "폴더 비우기" 버튼** — 트리 `FTP 파일 (/GPL)` 섹션 헤더의 휴지통 버튼으로 폴더 안을 통째로 비운다(`clearRemoteDir` — 폴더 자체는 남기고 한 단계 아래만, 개별 실패는 모아서 "부분 완료"). 게이트: 배포 잠금 → 목록 확인 → **쓰레드 정지 게이트**(존재=동작 중, 승인 시 `Stop -all` + settle, STATUS 미수신은 사용자 판단) → 목록을 보여 주는 모달 → 삭제 후 `forgetSyncManifest`+새로고침. Flash Projects는 영구 삭제라 인라인 버튼 없이 우클릭 메뉴로만. 테스트 547/547, 실기기 미검증(§3). 직전: §1-BX: **중첩 프로젝트(`ProjectLibrary`) 지원** — 사용자의 실제 프로젝트 `projects/MyProject`에서 `ProjectLibrary="MyProject\MyLibrary"`와 **프로젝트 폴더 안의 또 다른 `Project.gpr`**가 확인됨(키워드·값 형식 [실측] 확정, 값은 프로젝트명이 아니라 `\` 구분 **경로**이고 기준점은 projects 루트). 코드에서 **"이 프로젝트가 소유한 파일"과 "함께 컴파일되는 파일"을 분리**했다: `listSourceFilesRecursive`가 중첩 `.gpr`에서 멈추고(`stopAtNestedProject`, 기본 켬 + `nestedProjects[]` 보고) → `.gpr` 동기화가 라이브러리 소스를 상위 프로젝트 `ProjectSource`로 **추가 제안하던 회귀 해소**(auto 모드면 무경고 이중 등록이었다); `resolveProjectLibraryDirs`(기준점 ①프로젝트 폴더 ②projects 루트 ③알려진 `.gpr` 경로 끝 일치, 재귀·기준점 누적·순환 방지·`unresolved` 보고) + `collectRelatedGprPaths`(자기 + 라이브러리 + **자기를 참조하는 프로젝트**)로 참조 검색의 **역방향 누락**(라이브러리 Public 루틴의 호출부를 못 찾던 것) 해소. 디버그는 라이브러리 폴더·소스를 프로젝트 범위에 포함(BP 표기는 메인 기준이 우선되도록 순서 고정), QuickPick은 라이브러리를 `$(library)` + `라이브러리 · <참조 프로젝트>`로 구분 표시, 배포 trace는 `Library:` 줄로 폴더 안/밖·미해석을 구분해 알린다(**업로드 대상은 무변경** — 제어기 쪽 라이브러리 배치 규칙 미검증). 경로의 공백·한글·깊은 중첩은 검토 결과 무해(제어기에 가는 것은 프로젝트 이름뿐). 테스트 544/544 + 실제 폴더 실행 확인. 실기기 확인 대기: 제어기에서 라이브러리 위치(`/GPL/<메인>/<lib>` vs `/GPL/<lib>`)·라이브러리 소스 BP 표기(§3). 직전: §1-BW: **프로젝트 하위 폴더(중첩 소스) 지원** — `ProjectSource="T1\T2\T2.gpl"`처럼 폴더 기준 상대 경로가 임의 깊이로 중첩되는 것이 실제 프로젝트(TEST_GPL)로 확인됨. "프로젝트에 속한 소스"를 기능마다 다르게 판단하던 것을 신규 `src/project/projectSources.ts`(순수) + `src/project/projectFileScope.ts`(vscode) 한 곳으로 모았다(**.gpr 목록 ∪ 폴더 재귀 스캔**). **참조 찾기가 깨진 실제 원인**: 광역 검색용 `workspace.findTextInFiles`는 제안 API라 정식 VS Code에서 실행되지 않고 폴백이 주 경로인데, 그 폴백이 "정의 파일과 같은 폴더"만 훑었다 → 프로젝트 범위 폴백으로 교체. `.gpr` 동기화는 재귀 목록 + **디스크 확인**을 통과한 항목만 제거 제안(종전에는 하위 폴더 항목을 지우자고 제안, auto 모드면 조용히 제거). `symbolCache`는 임의 `*.gpr` + 합집합 인덱싱 + `SCORE_SAME_PROJECT` 티어, `.history`/`dist`/`out` 제외. 디버그 동명 소스 경합은 `.gpr` 목록을 1순위 기준으로, 하위 폴더 BP는 파일명 표기 실패 시 상대 경로 표기로 재시도(평면 프로젝트는 종전과 동일한 명령). 테스트 536/536. 실기기 확인 대기: 제어기 `Compile`이 상대 경로 항목을 여는지 + BP 파일 표기(§3). 직전: §1-BV: **업로드 스킵 판정을 크기 → 내용 지문(SHA-1)으로** — 같은 길이 편집이 조용히 스킵되어 제어기가 낡은 소스를 컴파일하던 문제. 직전: §1-BV: **업로드 스킵 판정을 크기 → 내용 지문(SHA-1)으로** — `controller/syncManifest.ts` 신설(globalState 영속). 미러/`skipUnchanged`가 "원격 크기 == 로컬 크기" 하나로 스킵하던 것을 "원격 존재 + 크기 일치 + 로컬 SHA-1 == 마지막 업로드 SHA-1 + (LIST가 주면) 관측 원격 mtime 일치"로 좁혔다. 같은 길이로 고친 소스가 스킵되어 낡은 소스가 컴파일되던 문제 해소. 판정 불가는 전부 업로드로 넘어뜨리고(첫 동기화는 전량 업로드), 해시 불가 파일은 종전 크기 비교로 폴백. FTP 왕복은 늘지 않음(기존 LIST/SIZE 그대로). 테스트 +17건(528/528). 실기기 미검증(§3). 직전: §1-BU: **공식 문서 기준 디버깅 조작 확장** — Jump to Cursor(`Set Thread -line`, 기본 경고 확인 `gpl.debug.jumpToCursor`), Step Into Target(임시 BP + Continue), 프로시저 이름 BP, BP 유효 줄 힌트·줄 보정(문서 규칙), 조건부 BP·히트 조건·로그포인트(기본 OFF `gpl.debug.clientSideBreakpointLogic` — 자동 Continue 수반), 값 복사·스택 지연 로딩·정수 hex(`gpl.debug.integerHex`). `Start` 를 문서 구문으로 조립(`controller/startCommand.ts`, 기본 `-event` = GDE 동일, `-compile` 금지) + launch `startStackSizeKb`/`startShowInitStatements`/`startTrace`. **"동작 중" 판정을 쓰레드 존재 기준으로 통일**(`controller/threadActivity.ts` — `Execute` 의 `_Cmd_<project>` 포함). MCP `read_dataids` 에 `Pdx`·unit·node 인자. 신규 순수 모듈 3개 + 테스트 36건(511/511). 직전: §1-BT: **문서화 주석(Documentation Comment) 포맷 + 골격 자동 생성** — `src/language/docComment.ts`(신규, vscode 무의존) 한 곳에서 형식 정의: 설명 + `# Parameters`/`# Returns`/`# Examples` 머리글(한국어 별칭 인식, 미지의 머리글은 `other`로 보존), `- `name`: 설명` 항목 파싱, 코드 펜스 안 `#`는 머리글 아님. 호버·자동완성·시그니처 도움말이 이 렌더러를 공유하고, 시그니처 도움말은 파라미터별 설명을 `ParameterInformation.documentation`으로 붙인다. `docCommentMaxLines`는 이제 **설명에만** 적용(섹션은 미절단). 생성: `'''` 스니펫 자동완성 + 전구 메뉴 + `gpl.insertDocComment`, 기존 주석이 있으면 **빠진 항목만 보완**(`mergeDocComment`). 설정 2개(`gpl.docComment.generateOnTripleQuote`/`includeExamples`), 단위 테스트 20건(473/473). UI 실행 검증은 §3. 직전: §1-BS: **제어기 디버깅 조작 전수 조사 + 스레드 단일 실행 잠금** — 조사 결과는 `docs/development/pa-controller-debug-operations.md`(신규, 4방향: 확장 명령 37형태·MCP 표면·GDE 캡처 재판독·공식 문서 49항목). VS Code 1.135 번들에 `supportsSingleThreadExecutionRequests`/`singleThread` 문자열이 **0건**임을 확인 → 잠금 UI는 확장이 제공(`debug/callstack/context` 메뉴·명령 3개·상태바 자물쇠, `src/debug/threadLock.ts` + custom request 4개), 잠금 중 타 스레드 정지에 `preserveFocusHint`. **버그 수정**: 외부 재개 감지의 `ContinuedEvent`에 `allThreadsContinued=false` 누락 → VS Code가 전체 재개로 읽어 다른 정지 스레드의 CALL STACK을 지우던 문제. 기존 기록 정정 3건(1402 응답 NUL 종결자, GDE 하트비트는 유휴 조건 없는 고정 주기, 1403 NUL은 TCP keep-alive 프로브). 직전: §1-BR: **GPL Dictionary Thread 클래스 반영** — `Thread/` 18개 페이지 전수 확인으로 멤버 16개를 사전 단일 출처화(CORE 중복 2개 제거), `usage`(문서 Syntax)·`details`(ThreadState -1~4, 이벤트 비트, Join 반환, Schedule 범위) 필드 추가, `GPL_CLASS_DOCS`로 클래스 개요·`New Thread(...)` 생성자 호버, `resolveReceiverTypeName` 추가로 `Dim t As Thread` → `t.Abort` 호버 지원(`resolveReceiverHolder` 동작은 무변경), 설정 `gpl.hover.builtinDetails`. 직전: §1-BP: **F5 개발 호스트 표준화** — `.vscode/launch.json`이 `--profile=GPL-DevHost`로 기본 설정·확장 없는 격리 창을 띄우고 `samples/hello-project`(신규 최소 GPL 프로젝트)를 연다. `--user-data-dir`은 F5에서 무시됨을 실측 확인(개발 호스트는 별도 프로세스가 아님). `npm run dev:host` 부활, 릴리스 지침의 "절대 금지" 목록을 "창 열기·설치는 사용자 요청이 있을 때만" 원칙으로 교체. 직전: §1-BQ: **프로젝트명 공백 가드**(`controller/projectNameGuard.ts`) — 1402 명령은 인자를 공백으로 구분하므로 공백 든 프로젝트명/Load 경로는 Deploy·Start·FTP Run/Unload·F5 attach·MCP 모든 진입점에서 보내기 전에 차단 + 이름 변경 안내, 워크스페이스 감지 시 세션당 1회 경고. 직전: §1-BN: URI 외부 진입점을 `gpl.*` 전체 명령으로 개방(`controller/uriDispatch.ts`) + **제어기 명령 정책**(`controller/commandPolicy.ts` — Step 연타 #28·Stopping 정착 §0.6·Compile→Start 완충 §0.7을 `sendCommandDetailed` 직렬 큐 한 곳에서 "대기로 충족", 승인/거부 없음; 사용자 결정 "AI 접근은 지침으로 제한하지 않고 확장이 자체 처리"), 쓰레드 명령 `{ threadName }` 인자 허용. 직전: §1-BM: GDE 1403 캡처 프레임 단위 재판독 → "1403 안정성의 열쇠는 1402 세션 유지" — 1402 유휴 ping(`controller/idlePing.ts`, `keepAliveIdlePingMs` 기본 5 s `Show Thread`, 결과는 건강 모니터 프로브로), 1403 수신 `ascii`→latin1 보존 + 완성 메시지 단위 UTF-8 디코딩(`latin1ToUtf8`, 한글 콘솔 출력 복구), `<E>1,N</E>`=스레드 수 가설·GDE 5 s NUL keep-alive 사실 기록. 직전: §1-BL: 프로젝트 선택 규칙 공용화 — `controller/projectPicker(Core).ts`, F5 `resolveDebugConfiguration`에서 다중 프로젝트 QuickPick(최근 선택 기억), 탐색기 폴더 우클릭 메뉴(Deploy/빠른 컴파일/Debug Project/Start/Save to Flash, context key `gpl.projectDirs`), 새 명령 `gpl.debugProject`; 후속: `.gpr` 우클릭 **Project.gpr 소스 목록 동기화**(`controller/gprSync(Command).ts`, 생성/삭제 시 자동 반영 `gpl.project.autoSyncSources`). 같은 날 다른 세션: §1-BK: 제어기 연결 끊김 자동 감지 재설계 — `controller/connectionHealth.ts` 모니터/재프로브(프로브 타임아웃 8 s·1 s 재프로브·연속 3회/거부 2회), 트리 실패 시 상세 폴 생략, 디버그 어댑터 폴·1403·keep-alive 소켓·대시보드 신호 연결, 유실 확정 시 연결 상태 끊음(자동 재접속 없음). 직전: §1-BJ: GitHub #32 — 멤버 접근 hover의 수신자 타입 해석(디버그 hover 게이트·정적 hover·백킹 후보 런타임 클래스 필터) + Property 디버깅 방향 논의 기록. 직전: §1-BI: GitHub 열린 이슈 14건 일괄 처리 — #16·#19·#20(옵트인)·#21·#22(완화책)·#25(A·B)·#28 구현, #15·#17·#18·#23·#24·#26·#27은 이미 구현된 것 종결 코멘트, #22·#25-C는 원인/설계 코멘트. 직전: §1-BH #20 키바인딩 제거(다른 세션), §1-BG GPL Traffic 응답 본문)
- 대상 저장소: `C:\Users\Doyun\Documents\GitHub\GPL_language` (VS Code 확장 `nir414.gpl-language-support`)
- 현재 package 버전: **0.8.21** — package.json은 0.8.21이고 `dist/gpl-language-support-0.8.21.vsix`가 로컬에 있으나(bump 미커밋, 태그·릴리스 없음) **그 VSIX는 §1-BW(하위 폴더 지원) 이전 빌드**다. CHANGELOG에 [0.8.21]을 §1-BW 내용으로 열었으므로(직전 세션까지 0.8.21 섹션이 없어 `pre-release-check`가 실패했다) 배포 전 `npm run package:no-bump`로 0.8.21 VSIX를 다시 만들 것. 0.8.20 VSIX도 §1-BM(1402 유휴 ping·1403 UTF-8) 이전 빌드다. 0.8.19 VSIX(08-27 빌드)에는 §1-BJ(#32)가 없음 — 0.8.19를 이미 설치·배포했다면 CHANGELOG의 #32 항목을 이후 버전으로 옮긴다(사용자 확인 필요). §1-BI·§1-BW·§1-BX 변경분은 실기기/UI 미검증이 많으니(§3) 패키징 전 §3 체크리스트 확인 권장. 태그 push 시 CI(release.yml)가 자동 빌드·패키징·릴리즈. 로컬 `npm run compile`/`npm run pre-release-check`/`npm run package` 검증 권장.
- 테스트 대상 프로젝트: `C:\SVN\pa\trunk\develop\07. Others\37. 핵산 Oligo 합성과제\시뮬레이션\projects\MergeCode` (65 파일)
- 제어기: G2400C, GPL 4.2K5, `192.168.0.1` (명령 1402 / 런타임 콘솔 1403)

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

## 1. 이번 세션(2026-06-30)에 완료한 변경

모두 working tree 반영됨(미커밋 가정). 적용하려면 로컬에서 `npm run compile` → `npm run package` → VSIX 재설치.

``` powershell
npm run compile
npm run package
```

### A. 컴파일 STATUS 조기 완료 / 거짓 성공 제거 (어제 핸드오프의 결정 B·C 구현)

- `src/controller/controllerConnection.ts`: `SendCommandOptions`에 **`waitForStatusClose`** 옵션 추가. true면 idle 기반 조기 완료를 끄고 종결자 `</STATUS>`(또는 소켓 종료/하드 타임아웃)까지 수신.
- `src/controller/deployService.ts` `tryCompile`: `Compile`을 `waitForStatusClose: true` + `timeoutMs: max(cfg.timeoutMs, 60000)`로 호출. **STATUS 누락을 더 이상 성공으로 간주하지 않음.** `Show Thread`로 성공 처리하던 보강 판정 블록 **제거**. 이제 성공/실패는 STATUS와 `parseCompileErrors` 결과로만 판정.
- 결과: `-742`가 정확히 실패로 보고되고, 에러 라인(`file:line:(code): *msg*`)이 Problems에 표시됨. (이전엔 거짓 성공으로 가려졌음 — 어제 핸드오프 §4 리스크가 실제로 발생했던 것)
- 미사용이 된 `isTransientConnectionFailure`는 제거함.

### B. F5(Attach 전 배포) 컴파일 에러가 Problems에 유지 + 점프

- `src/debug/gplDebugSession.ts`: 디버그 배포 진단을 세션 인스턴스 필드(`_deployDiagnostics`)에서 **모듈 공용 컬렉션**(`getDebugDeployDiagnostics`, name `gpl-debug-deploy`)으로 변경.
- `disconnectRequest`에서 진단을 **clear 하지 않도록** 변경(기존 `this._deployDiagnostics?.clear()`가 세션 종료 시 Problems 항목을 즉시 지워 "코드로 점프" 기능이 안 보였던 원인). 다음 배포 시작 시 `deploy()`가 clear로 갱신.
- 실패 시 첫 에러로 점프 + Problems 패널 표시 추가(`gpl.deploy.jumpToFirstError`, 수동 Deploy 경로와 동일 UX).

### C. 저장 시 자동 컴파일 — 저장한 파일만 업로드 (효율 개선)

- `src/controller/ftpClient.ts` `uploadProject`: `onlyFiles` 옵션(지정 파일만, 크기비교 없이 강제 업로드).
- `src/controller/deployService.ts`: `DeployOptions.changedFiles` 추가 → `onlyFiles`로 전달.
- `src/extension.ts` `runDeploy`/autoOnSave: 저장된 파일이 속한 프로젝트를 해석해 그 파일만 업로드(`overrideProjectDir`, `changedFiles`). 전체 65개 스캔/SIZE 왕복 → 1파일 업로드로 축소.
- 주의: 이 최적화는 **autoOnSave 경로에만** 적용. F5/Build Only는 여전히 `skipUnchanged`(크기 비교) 또는 전체 업로드. F5/Build의 차등 업로드는 아래 §3 미해결.

### D. 정의 찾기(Go to Definition) — Property 인덱싱 버그

- `src/gplParser.ts`: Property 정규식이 `ReadOnly`/`WriteOnly` 수식어를 빠뜨려 `Public ReadOnly Property ...`를 인덱싱 못 했음. Sub/Function처럼 수식어 임의 순서 허용으로 수정. 이제 ReadOnly/WriteOnly 속성도 F12 동작.

---

## 1-B. 코드 리뷰 후속 수정 (2026-06-30, 같은 날 별도 작업 스트림)

전체 코드 리뷰(언어 정확성/TS 품질/컨트롤러 연동) 후 **안전한 항목만** 적용. 모션/하드웨어 영향 항목은 미적용(아래 §3 "검증 필요"). 검증은 §0.4대로 로컬 `npm run compile` 필요.

### E. 언어 서비스 핫패스 — 파서 메모이즈 + cancellation token

- `src/gplParser.ts`: `parseDocument`를 메모이즈 래퍼 + `parseDocumentUncached`로 분리. (filePath+옵션+내용)이 같으면 재파싱 없이 캐시본(얕은 복사)을 반환, FIFO 32개로 캐시 제한. definition/hover/diagnostic/documentSymbol 등에서 한 요청당 동일 문서를 여러 번 파싱하던 비용 제거(호출부 변경 없음).
- `src/providers/definitionProvider.ts`, `hoverProvider.ts`: 진입부 + 무거운 폴백 직전에 `token.isCancellationRequested` 확인 추가.

### F. 자동완성 — 정적 항목 캐시 + 공백 트리거 제거

- `src/providers/completionProvider.ts`: builtin/dictionary `CompletionItem`을 정적 캐시(`_builtinCompletionsCache`, `_dictionaryCompletionsCache`)로 1회만 생성·재사용. 진입부 token 확인 추가.
- `src/extension.ts`: completion 트리거에서 `' '`(공백) 제거 → `'.'`, `'&'`만. (공백 입력마다 전체 팝업이 떠 소음/지연을 유발하던 부분. 식별자 입력 시 기본 IntelliSense는 그대로.) **되돌리려면** 트리거 배열에 `' '` 재추가.

### G. referenceProvider ReDoS 완화

- `src/providers/referenceProvider.ts` `scanDocumentText`: 정규식을 문서 전체가 아니라 **라인별**로 실행(절대 오프셋은 `doc.offsetAt`로 복원), 5000자 초과 라인은 스캔 제외. `buildAnyQualifierPattern` 중첩 수량자로 인한 catastrophic backtracking 위험 구조적 제거. 매칭 의미는 동일(멤버 접근은 단일 라인 기준).

### H. GPL Dictionary 데이터 — 정확성/커버리지 (문서 대조)

- `src/gplBuiltins.ts`:
  - `Trim` 전역 함수 → **`String.Trim` 메서드**로 정정(공식 Table 19-8 / `String/trim.htm`).
  - `Rnd()` → **`Rnd(seed)`** (seed 생략 가능, 음수=시퀀스 재시작, 0=직전값).
  - `Math.E`/`Math.PI` 요약의 LaTeX(`$e$`, `$\pi$`) 제거 — hover에서 렌더 안 되고 `'$\pi$'`의 `\p`는 무효 이스케이프였음.
  - **`Replace` 항목 제거** — 번들·공식 Dictionary 모두 미확인, `String/replace.htm`은 빈 페이지. (코드에 재등록 조건 주석 남김.)
  - String 함수 추가: `Asc / Chr / Format / LCase / UCase`.
- `src/gplDictionaryData.ts`: String 클래스 멤버 추가 — `String.Compare / IndexOf / Length / Split / Substring / ToLower / ToUpper / TrimEnd / TrimStart` (시그니처·sourceUrl 모두 공식 문서에서 확인).

### I. 확장 리소스 정리 / 캐시 신선도

- `src/extension.ts`: `ControllerTreeProvider` 인스턴스를 `context.subscriptions`에 등록(기존엔 등록 핸들만 push → pollTimer/EventEmitter/`_debugModeSubscription` 누수 가능).
- `src/extension.ts`: `.gpl/.gpo` `FileSystemWatcher` 추가 — 에디터 밖 변경(git pull/외부 도구/빌드 산출물)도 심볼 캐시에 반영해 "정의를 찾을 수 없음" stale 방지.

### J. 디버그: `stopAllOnDisconnect` 옵션 추가 (빠른 디버그 흐름)

- 배경: autoOnSave가 업로드/컴파일을 처리하므로 디버그 시 배포 불필요. "STOP→START→Attach로 붙고, 종료 시 프로그램 정지"를 원함.
- STOP→START→Attach는 **기존 옵션만으로 가능**: `deployBeforeAttach:false` + `stopAllBeforeAttach:true`(=`Stop -all` preflight) + `stopOnEntry:false`(→ `configurationDoneRequest`가 자동 `Start`).
- 빠졌던 것 = **종료 시 정지**. `disconnectRequest`는 원래 프로그램을 살려뒀음(주석 425-427). 그래서 신규 launch 옵션 **`stopAllOnDisconnect`**(기본 false) 추가:
  - `src/debug/gplDebugSession.ts`: `IAttachRequestArguments`에 필드, `private _stopAllOnDisconnect`, `attachRequest`에서 저장, `disconnectRequest`에서 true면 브레이크포인트 정리 후 `Stop -all` 전송.
  - `package.json`: 디버거 `configurationAttributes.attach`에 `stopAllOnDisconnect` 스키마 + "GPL Debug: Fast (...)" configurationSnippet 추가.
- 적용: 2026-07-03 14:41 Windows에서 `npm run package` 성공 → `dist/gpl-language-support-0.6.25.vsix`에 **이미 포함됨**(VSIX 내 컴파일 산출물에서 확인). **재빌드 불필요, 0.6.25 재설치만 하면 됨.**
- 검토(후속 세션 2026-07-03): 호스트 원본 기준 전체 구문 검사(TS 구문 진단 0건, package.json JSON 유효), 변경 지점 4곳 육안 확인, "기존 옵션으로 STOP→START→Attach 가능" 주장을 코드로 재확인(`configurationDoneRequest`의 auto-Start, `_runAttachPreflight`). 이상 없음.
- 참고(미해결 §3-B B1): `disconnectRequest`의 브레이크포인트 해제는 여전히 `Set Nobreak ... "file" line`(공백 O)로, GDE 검증된 no-space 형식과 불일치. 이번 변경 범위에선 유지함.

> 상세 리뷰 리포트(심각도/근거/대안/Confidence)는 사용자 측 별도 파일 `GPL_language_review_260630.md` 참고.

---

## 1-C. 2026-07-03 세션 — VSIX 패키징 실패(EACCES) 해결 + 패키징 파이프라인 개선

### 증상

`npm run package` → vsce 파일 스캔 중
`EACCES: permission denied, scandir '...\controller-mcp\node_modules\.bin\node-which'` 로 종료 코드 1.
실패한 bump 두 번(0.6.22→0.6.23, 0.6.23→0.6.24)으로 버전만 소모됨 — **0.6.23 VSIX는 존재하지 않음(정상)**.

### 원인

6/30에 `controller-mcp`에서 **리눅스 샌드박스로 `npm install`** 이 실행되어
`node_modules/.bin/node-which`가 **유닉스 심볼릭 링크**로 생성됨. Windows는 이 링크를 읽지 못해
vsce의 glob 스캔(scandir)이 EACCES로 실패. 개요(Outline) 기능 수정과는 무관 — 시점이 겹쳤을 뿐.

### 조치 (의도 → 방법)

1. **깨진 링크 제거**: `controller-mcp/node_modules/.bin/node-which` 삭제. 저장소 내 잔여 유닉스 심링크 0개 확인.
2. **VSIX 오염 방지**: `.vscodeignore`에 `controller-mcp/**`, `captures/**`, `dist/**`, `test_*.js`, `.claude` 추가.
   (그전엔 이 폴더들이 VSIX에 포함될 수 있었음 — 0.6.24 VSIX가 이전보다 ~50KB 작아진 이유.)
3. **`scripts/package.js` 재작성**:
   - preflight: 패키징 전에 깨진/유닉스 심링크를 스캔, 발견 시 원인·해결법 메시지와 함께 즉시 중단(재발 시 바로 진단됨).
   - `--bump patch` 옵션 내장 + **실패 시 package.json/package-lock.json 버전 롤백**(버전 번호 낭비 방지).
   - vsce를 `node node_modules/@vscode/vsce/vsce`로 직접 실행 — `.cmd` + `shell:true` 제거(DEP0190 경고 소멸, OS 무관 동일 동작).
   - 사전 `npm run compile` 제거 — vsce가 `vscode:prepublish`로 어차피 컴파일하므로 **이중 컴파일 제거**.
4. **`package.json` scripts 갱신**:
   - `"package": "node scripts/package.js --bump patch"`
   - `"package:no-bump": "node scripts/package.js"`

### 검증

샌드박스(리눅스)에서 `npm run package:no-bump` → 컴파일+패키징 성공.
`dist/gpl-language-support-0.6.24.vsix` (109 files, ~362KB). vsce 파일 트리에서 controller-mcp/captures 미포함 확인.
Windows 쪽은 사용자 로컬에서 `npm run package` 1회로 재확인 권장.

### 재발 방지

- 하드 규칙 §0.5 추가(하위 프로젝트 npm install은 Windows에서만).
- preflight가 같은 유형의 문제를 패키징 전에 잡아 명확한 메시지로 알려준다.

---

## 1-D. 2026-07-03 세션(후속) — 디버그 스텝 체감 지연 개선

### 증상/원인 분석

F10 스텝 한 번의 체감 지연이 ~600-750ms. 분해하면:

1. **fast poll 첫 틱이 +500ms** (`_fastPoll` = 500ms x 2 setInterval — 첫 관측까지 최소 500ms).
2. **1403 즉시 트리거 유실**: 트리거 폴이 force=false라 250ms 디바운스에 걸리고,
   `_userActionInFlight`/`_pollInFlight` 가드에 막히면 재시도 없이 버려짐 → 연속 스텝일수록 500ms 백업 폴에 의존.
3. **정지 직후 중복 왕복**: 폴이 방금 `Show Thread`를 했는데 StoppedEvent 직후 VS Code의
   threadsRequest가 같은 명령을 또 보냄(+1 RTT). FRAME_CACHE_TTL 400ms가 짧아 Show Stack 재조회 여지.

참고: 1402는 `</STATUS>` 수신 즉시 완료되므로(idle 300ms는 STATUS 미수신시만) 명령 자체는 빠름.
명령당 새 TCP 연결 + 15ms 큐 gap 구조는 유지.

### 조치 (src/debug/gplDebugSession.ts만 수정, 모두 읽기 경로 — 모션 영향 없음)

- ⑥ `_fastPoll`: 500ms x 2 → **30/120/250/500/1000ms 점감 백오프** 체인(setTimeout).
  pending 해소 시 조기 종료 후 일반 폴링 복귀. `_fastPollGen` 세대 토큰으로 이전 체인 무효화
  (연속 스텝 시 이중 체인 방지). `_stopPolling`도 gen++.
- ④ 1403 트리거 폴을 **force=true**로(디바운스 우회) + 가드에 막힌 트리거는 `_pollRetryRequested`로
  표시했다가 폴 완료 직후 30ms 뒤 1회 재폴 (트리거 유실 제거).
- ⑤ 폴이 가져온 thread 목록을 `_lastThreadList`(TTL 300ms)로 캐시 → 정지 직후 threadsRequest가
  재사용, TCP 왕복 1회 제거.
- `FRAME_CACHE_TTL_MS` 400 → 1500ms (정지 중 프레임 불변, 새 액션 시 `_fastPoll`이 무효화).

기대 효과: 스텝 체감 지연 ~600-750ms → **~100-250ms** (1403 트리거 정상 동작 시 그 이하).
대가: 스텝 직후 1초간 Show Thread 왕복 최대 2-3회 증가 (연결당 수십 bytes, 부하 미미).

### 검증

- 샌드박스 캐시가 stale이라(§0.4) /tmp shadow 빌드로 **전체 프로젝트 tsc(strict) 타입체크 통과 (0 errors)**.
- 실기기 검증 필요: 연속 스텝 시 체감, 1402 트래픽 로그(`[poll #N]`), ECONNRESET 미발생 확인.

### 남은 일

- [ ] 사용자 로컬 `npm run package` → 새 VSIX 설치 → 실기기에서 스텝 체감/트래픽 확인.
- [ ] 제어기 무응답 재발 시 §1-F 관찰 포인트 수집 (포트별 생사, 웹 UI, GDE, 에러 로그).
- [x] `Load` 콘솔 명령의 공식 인자 형식(이름 vs 절대경로) Brooks 문서로 확인. → **완료(2026-07-08, §1-G)**: 인자는 `Project.gpr`를 담은 **폴더 경로**(대소문자 구분). `/GPL`에 생성되는 폴더명은 `.gpr`의 프로젝트명. 옵션 `-compile`/`-start` 존재.
- [ ] (장기) 1402 persistent connection 검토 — 명령당 connect 오버헤드 제거. 제어기 단일 클라이언트
  가정 확인 필요, GDE 캡처 참고.

---

## 1-E. 2026-07-03 세션(후속2) — 디버그 변수 확인 UX: 클릭 즉시 표시

### 릴리즈 배경

호버로 변수 값을 보려면 `editor.hover.delay`(기본 300ms) + 마우스 완전 정지 대기 + 평가 왕복이
겹쳐 체감이 느리다. 사용자 요청: 호버 판정 개선이 어렵다면 "클릭하면 바로 표시"로 대체.

### 릴리즈 조치

- `src/extension.ts` (activateDebug 직후): 디버그 세션 중 **마우스 클릭**으로 커서가 GPL 식별자
  위에 놓이면 내장 명령 `editor.debug.action.showDebugHover`를 즉시 호출 — 호버 대기 없이 값 표시.
  필터: kind===Mouse만(키보드 커서 이동 제외), gpl 문서만, 빈 선택/단어 선택만(긴 드래그 제외),
  식별자 위가 아니면 무시. 설정 `gpl.debug.showValueOnCursorClick`(기본 true)로 on/off.
- `package.json`: 위 설정 추가 + 키바인딩 `Ctrl+Alt+I` → `editor.debug.action.showDebugHover`
  (inDebugMode && GPL 에디터) — 키보드로도 즉시 호버.
- `src/debug/gplDebugSession.ts`: `EVALUATE_CACHE_TTL_MS` 750→3000ms (정지 중 값 불변 전제,
  step/continue의 `_clearStaleState`·setVariable이 무효화). REPL로 임의 제어기 명령 실행 시
  `_clearEvaluateCache()` 호출 추가(상태 변경 가능성 → stale hover 방지).

### 검증

- /tmp shadow 빌드 전체 tsc(strict) 통과 (0 errors). package.json 편집부 구조 확인.
- 실기기: 클릭 시 hover 표시, 실행 중 클릭 시 "(실행 중)" 표시 확인 필요.
- 참고: 호버 자체를 빠르게 하려면 사용자 설정 `"editor.hover.delay": 100` 권장(전역 설정, 확장이 강제 불가).

---

## 1-F. 2026-07-03 세션(후속3) — 제어기 무응답 사건 + LSP 정리

### 사건 (17시경, 사용자 재부팅으로 복구)

Quick Compile 도중 제어기(192.168.0.1)가 완전 무응답이 됨. 로그 타임라인:
업로드 성공(쓰레드 활성 상태) → `Unload` -750 정상 응답 → `Load /flash/projects/MergeCode`
→ **HTTP/1.1 400 (GoAhead-Webs) 응답** → 이후 FTP(21)·1402 전부 ECONNREFUSED.

### 분석 (원격 단정 불가 — 가설 순위)

- `Load <절대경로>`는 0.5.108부터 상시 사용되어 정상 동작해 온 명령 → **HTTP 400은 원인이라기보다
  콘솔 서비스가 먼저 죽고 GoAhead만 남아 1402 연결을 받은 "증상"일 가능성**이 높다.
- 후보 원인: (a) 명령당 새 TCP 연결 구조 + 0.6.26~27의 연결 빈도 증가(fast poll 백오프, 클릭 평가)로
  제어기 TCP 자원(PCB/세션) 고갈, (b) 쓰레드 실행 중 FTP 업로드(플래시 쓰기) 영향, (c) 제어기 자체 불안정.
- **재발 시 관찰 포인트**: 어떤 포트부터 죽는지(80/21/1402/1403), 웹 UI 접속 여부, GDE 연결 여부, 제어기 에러 로그.

### 조치

- `deployService.ts`: ① Unload가 -750(*Invalid when thread active*)이면 **Load를 생략하고 명확한
  메시지와 함께 중단** (이전: "failed but continue" 후 Load 강행 — 이전 로드본 컴파일 오판정 위험).
  ② Load 응답이 `HTTP/`로 시작하면 제어기 이상 징후로 보고 **재시도 없이 즉시 중단**.
- LSP 정리(같은 날 로그에서 확인된 문제):
  - `definitionProvider`/`hoverProvider`: **주석(`'`)·문자열("...") 내부와 제어 키워드(If/Then/Dim...)에서
    조기 반환** — 오점프(주석 속 robotIndex → 엉뚱한 클래스)와 낭비(Then 멤버 해석 풀코스) 제거.
    헬퍼 `isInCommentOrString`/`GPL_CONTROL_KEYWORDS`는 `config.ts`에 추가.
  - `symbolCache.ts`: `findMemberInClass`/`findMemberCandidatesInClass`가 **필드(variable)·상수(constant)를
    멤버로 포함**하도록 수정 (기존: sub/function/property만 → `obj.field` 정의 이동이 fallback으로만 동작).
    호출 문맥의 비호출형 제외는 기존 pickBestCallableCandidate가 담당.
  - `extension.ts`: `onDidChangeTextDocument`의 symbolCache 갱신에 **400ms 디바운스** (기존: 키 입력마다
    전체 재파싱 + "[SymbolCache] Updated" 로그 폭주).

### 검증

- /tmp shadow 빌드 전체 tsc(strict) 통과 (0 errors). 실기기 검증 필요(특히 quick compile -750 경로).

---

## 1-G. 2026-07-08 세션 — Quick Compile 재설계: /GPL 직접 업로드 + Stop 완료 게이트

### 배경 (사용자 발견 2건 + 공식 문서 확인)

1. **Brooks 공식 문서 확인 완료** (Console Command Summary → Load/Unload 상세):
   - `Load <folder_path>`: "creates a folder in the GPL project area and **copies** all the files" —
     이동이 아니라 복사. 인자는 `Project.gpr`를 담은 폴더 경로(대소문자 구분), `/GPL` 폴더명은
     `.gpr`의 프로젝트명으로 결정. **"The new project folder must not already exist"** 제약.
     옵션 `-compile`/`-start` 존재. Remarks: **"an external file-copy utility such as FTP can be
     used to create the folder and copy the files"** → `/GPL` 직접 FTP 쓰기는 공식 허용 경로.
   - `Unload [name|-all]`: `/GPL`의 해당 프로젝트 폴더+파일 제거 및 메모리 해제. 단위는 프로젝트별.
     쓰레드가 idle이 아니면 실패(-750) → 기존 Unload→Load 동기화가 락에 걸리던 원인.
   - URL: `Controller_Software/Software_Reference/Console_Commands/load.htm`, `unload.htm`
2. **사용자 관찰 — 이상 현상(의심)**: `Stop -all`로 완전 정지되기 **전에** `Compile`/`Start`를
   보내면 제어기에서 메모리 누수로 보이는 현상 발생. 2026-07-03 무응답 사건(§1-F) 가설 (b)와
   정합적. 원격 단정은 불가하나, 예방 게이트는 원인 규명 없이 적용 가능 → 하드 규칙 §0.6 추가.

### 조치 (`deployService.ts` / `extension.ts` / `controllerTreeProvider.ts` / `package.json`)

- **Direct /GPL 업로드 모드** (`DeployOptions.directGpl`, Quick Compile 경로에서 활성):
  - 시작 시 FTP로 `/GPL` 목록을 조회해 프로젝트 폴더(대소문자 무시 매칭, 실제 원격 이름 사용)가
    있으면: 변경 파일을 `/GPL/<name>/`에 **직접 업로드** → `Compile <name>`. **Unload/Load 생략**
    (-750 락과 "폴더 존재 불가" 제약 모두 회피, 전체 프로젝트 재복사 비용 제거).
  - `/GPL`에 폴더가 없으면(최초 1회 등) 기존 경로(flash 업로드 + Unload/Load)로 **자동 폴백**,
    배너에 사유 출력.
  - Direct 모드에서 -745/-508/-743 복구용 Unload/Load는 시도하지 않음(목적에 반함) — "전체
    배포로 재시도" 안내 후 실패 처리.
- **Stop 완료 게이트**: `Stop -all` STATUS 0 이후 `Show Thread`를 500ms 간격 최대 8초 폴링,
  모든 쓰레드가 Idle/Stopped/Error가 될 때까지 대기. 미정지 시 STOP 단계 실패로 중단.
- **Quick Compile 사전 쓰레드 체크 + Stop 확인 팝업**: STOP을 생략하는 대신 시작 시
  `Show Thread` 1회 확인. 활성 쓰레드가 있으면 **모달로 "Stop -all로 정지 후 계속할까요?" 확인**
  (`DeployOptions.confirmStopOnActive` 콜백, extension.ts에서 `showWarningMessage` modal 연결).
  승인 시 `Stop -all` + 정지 완료 게이트 후 계속, 거부/미지정 시 새 실패 단계 **`THREAD_CHECK`**로
  중단("STOP 후 재시도" 안내). **autoOnSave 경로는 `noStopPrompt`로 팝업 없이 조용히 중단**
  (저장마다 모달이 뜨면 방해). `Show Thread` 무응답 시에는 경고만 남기고 진행(기존 동작 수준 유지).
  Stop/정지 게이트 로직은 `sendStopAll`/`waitThreadsSettle`/`stopAllAndSettle` 헬퍼로 추출되어
  전체 배포 STOP 단계와 공유된다.
- `SituationDeploySnapshot.lastStage`에 `THREAD_CHECK` 추가(트리 뷰에서 STOP 실패와 동급 표시).
- `package.json`: quickCompile 타이틀을 "변경분만 /GPL 직접 업로드, STOP/START 생략"으로 갱신.

### 검증

- /tmp shadow 빌드 tsc(strict) 통과 (0 errors) + 단위 테스트 68/68 통과 (샌드박스).
  ※ §0.4 함정 재발: 이번엔 마운트가 "새 내용을 옛 길이로 잘라" 보여줌(새 파일은 즉시 동기화,
  수정 파일은 길이 고착). 완전한 앞부분 + 호스트 Read로 확보한 꼬리를 이어붙여 검증함.
- 사용자 로컬 `npm run compile` 재확인 필요(§0.4). 실기기 검증 필요:
  ① Quick Compile이 /GPL 직접 모드로 동작하는지(배너 `Mode: direct /GPL upload` 확인),
  ② 변경 파일만 업로드 후 Compile 결과가 GDE와 일치하는지,
  ③ 활성 쓰레드 상태에서 Stop 확인 모달이 뜨고, 승인 시 Stop→정지확인→진행 / 거부 시
     THREAD_CHECK 중단이 되는지 (autoOnSave에서는 팝업 없이 조용히 중단),
  ④ 전체 배포 시 "모든 쓰레드 정지 확인" 로그 후 진행하는지.

### 남은 일 / 새 미해결

- [ ] `/GPL` 로드본의 **재부팅 후 영속성** 확인(RAM 기반 의심). 날아간다면 direct 모드 후에는
  flash 사본이 구버전으로 남으므로, 주기적 전체 배포 또는 종료 전 flash 동기화 안내 필요.
- [x] `/GPL` 직접 쓰기와 `/flash/projects` 사본의 **이원화 관리 원칙** — 2026-07-24 §1-AF에서
  확정·구현: 모든 배포(Deploy/Quick Compile/F5)는 /GPL 직접, flash 반영은 `GPL: Save to Flash` 전담.
  (당초 "정식 배포가 flash 담당" 구상은 폐기 — Deploy는 더 이상 flash를 건드리지 않음.)
- [ ] "Stop 미완료 상태에서 Compile/Start → 메모리 누수 의심" 실기기 재현/관찰 (Show Memory로
  전후 비교 권장). 재현되면 Brooks 문의 고려.
- [ ] `Load -compile` 옵션 활용 검토(클래식 경로의 Load+Compile 왕복 1회 축소 여지).

## 1-H. 2026-07-08 세션(후속) — 디버그 `<projectName>` 오인식(다른 프로젝트로 처리) 수정

### 증상
F5/attach 디버깅을 하다 보면 `<projectName>`이 **실제 열어둔 프로젝트가 아니라 다른 프로젝트**로
잡히는 일이 잦았다. 그 결과 브레이크포인트 명령(`Set Break <proj> "file" line`), 전역 조회
(`Show Global expr, <proj>`), `Start <proj>` 등이 엉뚱한 프로젝트로 나갔다.

### 원인 (3가지가 겹침)
1. **선택 우선순위 역전** — `gplDebugSession._detectProjectName`의 다중 프로젝트 분기에서
   `preferred = bothMatch || sourceMatches[0] || dirMatches[...]` 였다. 즉 활성 파일의
   **basename이 어느 프로젝트의 소스목록에 있는지**(약한 신호)가, 활성 파일이 **물리적으로 어느
   프로젝트 폴더 안에 있는지**(강한 신호)보다 우선했다. `Main.gpl`처럼 프로젝트마다 흔한 파일명이면,
   실제 폴더의 프로젝트가 아니라 이름만 겹치는 옆 프로젝트가 선택됐다. (참고로 배포 경로
   `_resolveDeployProjectDir`는 반대로 디렉터리 포함을 우선 — 두 경로의 규칙이 불일치했다.)
   테스트 대상이 `...\projects\` 아래 여러 프로젝트로 배치돼 있어(§헤더) 항상 다중 후보 상태였다.
2. **탐색 범위 오염** — `_findFiles`가 `.history`(Local History 확장)·`dist`를 제외하지 않아
   과거 이름의 stale `Project.gpr` 사본이 후보에 섞였다. 단일 프로젝트인데도 다중 분기로 빠지거나,
   옛 이름이 그대로 반환될 수 있었다. `deployService.findProjectDirs`의 glob도 같은 문제.
3. **중복 후보 미제거** — 같은 `.gpr`가 중첩 루트/사본으로 두 번 잡히면 다중으로 오판.

### 조치
- **선택 규칙을 순수 함수로 분리·수정**: `src/controller/responseParser.ts`에
  `selectProjectFromCandidates(candidates, activePath)` 추가. 우선순위를 바로잡음 —
  ① 폴더포함+소스일치 → ② 폴더포함(가장 깊은/구체적 폴더) → ③ 폴더 밖 파일의 **고유** 소스명 일치
  → ④ 판별 불가 시 결정적 fallback(경로 정렬 첫 후보)에 `ambiguous=true` 표시.
  또한 동일 `.gpr` 경로 중복 제거 + 남은 후보가 **모두 같은 projectName이면 단일로 확정**.
- `gplDebugSession._detectProjectName`이 위 순수 함수를 사용하도록 리팩터링. `ambiguous`면
  "launch.json의 `projectName`으로 명시 권고" 경고를 Debug Console에 남김.
- **탐색 범위 정리**: `_findFiles`가 dot 디렉터리(`.history`/`.vscode`/…)와 `out`/`dist`/`bin`을
  건너뛰도록 수정. `deployService.findProjectDirs`의 exclude glob에 `.history`/`dist`/`out` 추가.
- **회귀 테스트 추가**: `src/test/projectSelection.test.ts`(11 케이스), `src/test/index.ts`에 등록.

### 검증
- 순수 로직을 샌드박스 tmpfs로 포팅해 11/11 통과 확인. 핵심 케이스: **파일명 충돌 시 디렉터리
  포함이 basename보다 우선**, stale 동일이름 사본 병합, 동일경로 중복 제거, 중첩 시 최심 폴더,
  모호 시 결정적 선택 + `ambiguous=true`.
- ⚠ **인샌드박스 `tsc`/`npm test`는 이번에도 §0-4 트랩으로 실행 불가**(내가 건드리지 않은
  `ftpClient.ts:204`까지 잘려 가짜 "Unterminated template literal"이 남). 호스트 원본은 정상 확인.
  → **사용자 로컬 Windows에서 `npm run compile` && `npm test`로 최종 검증 필요.**

### 남은 일 / 새 미해결
- [ ] 로컬 `npm run compile` && `npm test` 통과 확인 후 `npm run package`로 VSIX 재생성.
- [ ] (선택) README/launch.json 예시에 "다중 프로젝트 시 `projectName` 명시 권장" 한 줄 추가.

### 변경 파일
- `src/controller/responseParser.ts` — `ProjectCandidate`/`ProjectSelection`/`selectProjectFromCandidates` 추가.
- `src/debug/gplDebugSession.ts` — `_detectProjectName` 리팩터링, `_findFiles` 탐색 범위 정리.
- `src/controller/deployService.ts` — `findProjectDirs` glob exclude 확장.
- `src/test/projectSelection.test.ts`(신규), `src/test/index.ts`(등록).

## 1-I. 2026-07-08 세션(후속2) — 디버그(F5) 배포: /GPL 직접 미러 동기화 (flash 미경유)

### 배경
§1-G에서 Quick Compile을 `/GPL/<name>` 직접 업로드(directGpl)로 바꿨으나, 그 미러 동기화 함수
(`ftpClient.mirrorProject`)는 만들어만 두고 `deploy()`의 UPLOAD 단계에 **연결돼 있지 않았다**.
또 디버그(F5) attach 전 배포는 여전히 flash 경유(Unload/Load)였다. 사용자 요청: F5도 flash를
거치지 말고 `/GPL`에 직접, Unload 없이 파일 단위로 맞춰(변경분만 업로드 + 원격 전용 삭제) 더 빠르게.

### 조치 (`deployService.ts` / `gplDebugSession.ts`)
- **mirrorProject를 UPLOAD 단계에 연결**: `directActive && !useChangedOnly`(수동 Quick Compile,
  디버그 F5)일 때 `uploadProject` 대신 `mirrorProject` 사용 — 크기 다른/새 파일만 업로드하고
  로컬에 없는 원격 파일은 **삭제**(낡은 소스 오컴파일 방지), `Unload`/`Load` 생략. `import`에
  `mirrorProject` 추가, `DeployResult.uploadStats`에 `deleted?` 추가, trace에 삭제 건수 로그.
- **autoOnSave(`changedFiles`)는 미러 제외**: 저장 파일만 올리는 초경량 경로라 전체 원격 목록
  조회/삭제가 있는 미러는 쓰지 않고 기존 `onlyFiles` 업로드를 유지.
- **디버그(F5) 배포에 `directGpl: true`**: `gplDebugSession._runDeployBeforeAttach`의 `deploy()`
  호출에 추가. attach 전 STOP은 그대로 선행하므로 -750 락 없이 안전. `/GPL/<name>` 미존재 시
  classic(flash + Unload/Load) 경로로 자동 폴백.

### 검증
- §0.4 트랩 재발(마운트가 `deployService.ts`를 885행에서 잘라 보여줌 — 43607바이트, ✔ 문자 중간
  절단). 호스트 원본으로 `deployService.ts`(974행)·`ftpClient.ts`(313행)를 재구성해 /tmp shadow에서
  `tsc --noEmit` — **내 변경(mirror/uploadStats/directGpl) 관련 오류 0건** 확인. 남은 tsc 오류는
  전부 마운트 잘림 아티팩트(호스트 파일은 정상, Read로 확인).
- 사용자 로컬 Windows `npm run compile` && `npm test`로 최종 확인 필요.
- 실기기 검증: F5 시 배너 `Mode: mirror sync ...`, 변경분만 업로드 + 원격 전용 삭제 로그(`del ...`),
  Compile 결과가 GDE와 일치하는지.

### 남은 일 / 새 미해결
- [ ] F5 미러의 원격 전용 파일 삭제가 의도대로 동작하는지 실기기 확인(특히 로컬에서 이름 바꾼 파일).
- [x] 미러는 크기 비교라 동일 크기 내용변경은 놓침(기존 `skipUnchanged` 한계와 동일) — 2026-08-28
  §1-BV에서 업로드 지문(SHA-1) 매니페스트로 해소.

### 변경 파일
- `src/controller/deployService.ts` — UPLOAD 단계 mirror 분기, `mirrorProject` import, `uploadStats.deleted?`.
- `src/debug/gplDebugSession.ts` — attach 전 배포에 `directGpl: true`.
- `CHANGELOG.md` — [0.7.0]에 디버그 미러 동기화 / autoOnSave 게이팅 항목 추가.

## 1-J. 2026-07-10 세션 — 언어 서비스 개선(Hover/IntelliSense/Signature Help) + Brooks 사전 대폭 확장

### 배경
사용자 요청: Quick Info / Hover / function doc comment / IntelliSense / Signature Help 검토·개선 + Brooks 기본 함수 정의 정보 확대. Signature Help는 **아예 미구현**이었고, 파서가 선언 위 `'` 주석 블록을 전혀 수집하지 않아 사용자 함수 설명이 hover/완성에 나오지 않았음.

### 조치 (의도 → 방법)
1. **함수 doc comment 파싱**(`gplParser.ts`): Function/Sub/Property 선언 바로 위의 연속 `'` 주석 블록을 `GPLSymbol.docComment`로 수집. 코드 줄마다 pending 블록을 소비/리셋해 다른 선언으로 누수 방지, 중간 빈 줄이면 미부착. 순수 모듈(vscode 비의존) 유지.
2. **Hover/Quick Info**(`hoverProvider.ts`): 사용자 심볼 hover 하단에 docComment를 마크다운으로 표시(`formatDocComment`, 줄바꿈 보존). 주석/문자열 내 hover 억제·빌트인 hover는 기존 유지.
3. **IntelliSense**(`symbolCache.ts`): 완성 항목 documentation을 `buildSymbolDocumentation`로 교체 — 시그니처 코드블록 + docComment를 MarkdownString으로 제공(기존 "Parameters/Returns" 평문 대체).
4. **Signature Help (신설)**(`providers/signatureHelpProvider.ts` + `extension.ts` 등록): 커서 앞 코드에서 `stripToCode`로 문자열/주석 무력화 후, 최내곽 미닫힘 `(` 와 top-level 콤마 수로 active parameter 산출. 빌트인(시그니처 문자열 파싱) + 사용자 Sub/Function(심볼 캐시 → 현재 문서 파싱 폴백) 모두 지원. 트리거 `(` `,` / retrigger `,`. 파라미터 강조는 [start,end] 오프셋 사용.
5. **Brooks 사전 확장**(`gplDictionaryData.ts` +153 / `gplBuiltins.ts` +2): GPL Dictionary 공식 페이지·검색 인덱스 대조로 Controller·Thread·Latch·Exception·File·Stream(Reader/Writer)·Array·Console·Vision/VisResult·XmlDoc·XmlNode·Modbus·Socket·Tcp/Udp·IPEndPoint 멤버를 signature+국문 요약+sourceUrl로 추가. String 전역함수 2개(FromBitString/ToBitString)는 형식 규칙(Class.Member) 때문에 사전이 아닌 CORE(`gplBuiltins`)에 등록. 추측 항목 없음. 기존 중복(Latch 9개)·ShowDialog 중복은 제외.

### 검증
- 샌드박스 `npx tsc --noEmit`(strict) 0 errors, `npx tsc -p ./` 0 errors.
- `node out/test/index.js` **90/90 통과**(신규 docComment 파서 테스트 5개 포함; `gplDictionaryData.test`의 형식/중복/URL/스니펫 회귀가 신규 사전 항목을 전수 검증).
- ⚠ 최종 검증은 사용자 로컬 `npm run compile` 및 실기기에서 hover·시그니처 표시 확인 권장(§0.4 샌드박스 트랩).

### 주의 / 남은 일
- **web_fetch 공용 rate limit(429)** 으로 XmlNode 30 / Network·Modbus 30개는 라이브 페이지 대신 **번들 검색 인덱스(`brooks_topics.jsonl`) 초록**에서 signature+요약을 추출함(공식 문서 내용이나 초록 기반이라 파라미터 세부는 페이지 재확인 여지). 나머지 ~93개는 라이브 페이지 직접 확인.
- 무인자 접근자 메서드(FirstChild/DocumentElement/ParentNode 등)는 문서상 괄호가 없으나 일관성을 위해 `Name()`로 표기함. 실제 GPL 사용은 괄호 없이 호출 — 원하면 property 표기로 조정 가능.
- `Statement_Dictionary`(If/For/Try 등 25개 키워드)는 "함수"가 아니라 이번 확장에서 제외. 필요 시 키워드 hover로 별도 처리 가능.
- (line-ending) 작업 트리 다수 파일이 CRLF로 바뀌어 HEAD(LF)와 full-file diff 상태. 이번에 편집한 파일은 LF로 저장(HEAD 관례)해 의미 diff만 남도록 함. 저장소 전반 CRLF/LF 정리(.gitattributes 도입 등)는 사용자 판단 권장.

### 변경 파일
- `src/gplParser.ts` — `GPLSymbol.docComment` + 주석 블록 수집 로직.
- `src/providers/hoverProvider.ts` — docComment 표시 + `formatDocComment`.
- `src/symbolCache.ts` — `buildSymbolDocumentation`(완성 문서화).
- `src/providers/signatureHelpProvider.ts` — 신설.
- `src/extension.ts` — signature help 등록 + import.
- `src/gplBuiltins.ts` / `src/gplDictionaryData.ts` — 사전 확장(+155).
- `src/test/gplParserDocComment.test.ts` (+ `src/test/index.ts`) — 신규 회귀 테스트.

## 1-K. 2026-07-13 세션 — 정의찾기(F12) 오버로드 해석: 인자 타입 추론 + 동점 peek

### 증상 (사용자 보고, MergeCode 실사용)
`RobotModule.gpl:3795`의 `getWafer(stage, slot, robotArmList)` 호출에서 F12가 엉뚱한
오버로드로 점프. 3-인자 오버로드가 스칼라(`arm As RobotArm`)/배열(`armlist() As RobotArm`)
로 나뉘어 있어 **인자 개수만으로는 구분 불가** — 기존 선택기는 개수 동점이면 라인 순서로 결정했다.

### 원인
1. 호출부 정보를 `countCallArgumentsFromSuffix`가 **개수 하나로 축약** — 인자 표현식/타입 미사용.
2. `selectCallableByArity`(symbolCache)와 `pickByArgCount`(definitionProvider)가 arity → 파라미터 수
   정확 일치 → 경로 → **라인 순**으로만 선택. 두 곳에 같은 규칙이 중복 구현돼 있었음.
3. 파서 `extractParamName`이 배열 파라미터의 타입을 `RobotArm`(스칼라와 동일)로 기록 —
   배열/스칼라 구분 정보가 심볼 단계에서 소실.

### 조치 (의도 → 방법)
- **`src/language/overloadResolution.ts` 신설(순수 모듈)** — 오버로드 선택 규칙의 단일 정본:
  `CallContext { argCount, getArgTypes(lazy) }`, `parseParameterDecl`(Optional/ParamArray/ByRef,
  배열 양표기 `x()`/`As T()` 인식), `inferLiteralArgType`, `scoreCandidateByTypes`(+3 정확 일치 /
  +2 숫자 리터럴↔숫자 / +1 숫자 계열 변환 / 0 unknown 중립 / −2 명백 불일치, ParamArray 요소 대조),
  `rankOverloadMatches`(arity 필터 → 타입 총점 → 파라미터 수 정확 일치 → pathScore → 경로/라인;
  끝까지 동점이면 **동점 그룹 전체 반환**). unknown 중립 원칙이라 타입 추론 실패 시 기존 동작 유지.
- `cursorExpression.extractCallArgumentsFromSuffix` 추가 — 개수 대신 **인자 표현식 배열** 추출
  (미완성 `Foo(a, b`도 줄 끝까지 처리). definitionProvider의 개수 세기 전용 메서드는 제거.
- `symbolCache`: `findDefinition/findMemberInClass/findMemberInModule`이 `number | CallContext`를
  수용(하위호환 — hover/참조 등 기존 호출부 무변경), 다중 후보 버전 `find*Matches` 추가. 중복
  선택기(`pickBestCallableCandidate`/`selectCallableByArity`)를 `pickCallableMatches` +
  `rankOverloadMatches`로 일원화.
- `definitionProvider`: `inferCallArgTypes`(리터럴/`New Foo`/단순 식별자→로컬·파라미터·캐시
  returnType/`ident(...)`→배열 요소 타입 또는 함수 반환 타입; 멤버 접근 등 복합식은 unknown 중립).
  **lazy** — arity로 걸러도 동점 후보 2개 이상일 때만 추론 실행·요청 내 캐시. 동점이 끝내
  안 갈리면 `buildDefinitionResult`가 **Location[] 반환 → VS Code peek 목록**으로 사용자가 선택.
  캐시 미스 로컬 파싱 경로(`pickLocalMatches`)도 같은 정본 사용.
- `gplParser.extractParamName`: 배열 파라미터 타입을 `RobotArm[]`로 기록(로컬 배열 Dim 표기와
  일관). 소비처는 기존대로 `[]`를 벗겨 사용 — `referenceProvider`의 인스턴스 한정자 비교에도
  strip 추가.

### 검증
- 샌드박스 `npx tsc -p ./ --noEmit`(strict) 0 errors, `node out/test/index.js` **109/109 통과**
  (기존 90 + 신규 `overloadResolution.test.ts` 19: getWafer 배열/스칼라/4-인자 시나리오,
  타입 불명 동점 peek, lazy 호출 검증, ParamArray, 리터럴 분류, 미완성 호출 추출).
- 이번엔 §0.4 트랩 미발생 — 모든 수정을 샌드박스 bash(heredoc/python)로 수행, 호스트 Read로 꼬리 확인.
- **사용자 로컬 `npm run compile` && `npm test` + 실기기(MergeCode) F12 확인 필요**:
  ① `getWafer(stage,slot,robotArmList)` → 배열 오버로드(3804행 부근)로 점프,
  ② 스칼라 인자 호출 → 스칼라 오버로드, ③ 타입 구분 불가 호출 → peek 목록 표시.

### 남은 일 / 새 미해결
- [ ] 생성자(`Sub New`) 오버로드는 여전히 인자 개수만 사용(`findConstructorInClass`) — 타입 추론 연결 여지.
- [ ] 인자 타입 추론이 멤버 접근 복합식(`obj.prop`)은 unknown 처리 — 필요 시 확장.
- [ ] Signature Help/hover의 오버로드 선택도 `rankOverloadMatches` 재사용 검토(현재 별도 로직).

### 변경 파일
- `src/language/overloadResolution.ts` — 신설(순수 모듈, 오버로드 선택 규칙 정본).
- `src/language/cursorExpression.ts` — `extractCallArgumentsFromSuffix` 추가.
- `src/symbolCache.ts` — CallContext 수용 + `find*Matches` + 선택기 일원화.
- `src/providers/definitionProvider.ts` — 인자 타입 추론(lazy) + 동점 peek 반환.
- `src/gplParser.ts` — 배열 파라미터 타입 `Type[]` 기록.
- `src/providers/referenceProvider.ts` — 한정자 returnType 배열 접미사 strip.
- `src/test/overloadResolution.test.ts`(신규), `src/test/index.ts`(등록), `CHANGELOG.md`.

## 1-L. 2026-07-13 세션(후속) — 디버그 브레이크 감지/전환 체감 개선 + F8 키바인딩 충돌 수정

### 증상 (사용자 보고)
1. 쓰레드가 BP에 도달했을 때 감지·전환(정지 쓰레드로 포커스 이동)이 느리다.
2. 디버깅 중 마우스 호버(클릭 값 표시) 상태가 되면 F8(`editor.debug.action.toggleBreakpoint`, `when: editorTextFocus`)이 동작하지 않는다.

### 원인 분해
- **감지**: (a) 1403 트리거(`_onDidReceiveData`)가 **세션당 첫 청크에만** 발사됨 — 연결 유지 중 도착한 브레이크 신호(`<E>N,N</E>` 숫자 상태 이벤트)를 놓침. (b) 트리거 핸들러가 `pendingAction`이 step/continue/entry일 때만 폴 — **자유 실행 중 BP 히트(auto-Start 후, 다른 쓰레드 등)는 트리거 무시** → 인터벌 폴(기본 5000ms) 대기. (c) 인터벌 폴이 실행/정지 무관하게 사용자 간격 고정.
- **전환**: StoppedEvent 후 VS Code의 stackTraceRequest가 그때서야 `Show Stack` 왕복(+0프레임 시 `Show Thread` 폴백 1회 추가).
- **F8**: VS Code 소스(debugEditorActions.ts/debugHover.ts)로 확인 — `showDebugHover`는 `focus=true` 하드코딩이라 클릭 값 표시(§1-E) 시 키보드 포커스가 hover 위젯으로 이동 → `editorTextFocus`=false → 해당 조건 키바인딩 전부 무력화. debug hover는 포커스를 잃어도 닫히지 않음(에디터 keydown/클릭/스크롤 시 닫힘).

### 조치 (모두 읽기 경로 — 모션 영향 없음)
- `runtimeConsole.ts` `emitConsoleFrame`: 비 type-3 프레임이 숫자 상태 이벤트(`/^<E>\d+,\d+<\/E>$/`)면 세션 중간에도 `_onDidReceiveData` 발사. 콘솔 텍스트(type-3)는 해당 없음 → 출력 폭주가 트리거 폭주로 이어지지 않음.
- `gplDebugSession.ts`:
  - 트리거 핸들러: pendingAction 있으면 기존대로 force 즉시 폴(+pause도 포함됨), **없어도** `_requestTriggerPoll()`로 코얼레싱 폴 예약(디바운스 창 만료 시점에 force 폴 1회 보장 — 창 안 트리거 유실 구멍 제거).
  - ⑦ 인터벌 폴을 setInterval → **적응형 setTimeout 체인**(`_scheduleNextIntervalPoll`, `_pollTimerGen` 세대 토큰): Running 쓰레드 존재 시 `min(1000, 사용자간격)`, 전부 정지 시 사용자 간격. 정지 중 트래픽은 기존과 동일.
  - ⑧ 정지 감지 직후 `_prefetchFramesAfterStop`(Show Stack 캐시 워밍) + `_getThreadFrames`에 in-flight 합류 맵(`_framesInFlight`) — stackTraceRequest가 진행 중 조회에 합류(중복 Show Stack 없음). `_frameCacheGen` 세대 토큰으로 무효화 후 완료된 조회의 stale 캐시 재주입 방지(`_clearStaleState`/`_fastPoll`에서 bump).
  - 폴 가드 재폴 조건을 `force || pendingAction`으로 완화, finally 재폴에서 pendingAction 요구 제거.
  - configurationDone auto-Start 직후 `_fastPoll()` 추가.
  - setVariableRequest: 응답 STATUS 비-0이면 실패로 보고(기존: 무조건 성공 표시 — 하드 규칙 2 위반 지점). 응답 유실/무-STATUS는 기존 성공 가정 유지.
  - 쓰레드 종료 시 `_continueOrigin` 엔트리 정리(누적 방지).
- `extension.ts`: 클릭 값 표시 후 `workbench.action.focusActiveEditorGroup`으로 **포커스를 에디터로 복귀** — 값 표시는 유지되고 F8 등 키바인딩 정상 동작. (사용자 보험: keybindings.json의 `when`을 `debuggersAvailable && (editorTextFocus || editorFocus || disassemblyViewFocus)`로.)

기대 효과: 자유 실행 중 BP 히트 감지 최대 ~5s → **~수십ms(1403 정상)/최대 ~1s(1403 유실 시 백업 폴)**. 전환(소스 위치 표시)은 Show Stack 1왕복 선반영. 대가: Running 상태에서 백업 폴 1회/s(기본 설정 대비 5배, 정지 중엔 변화 없음).

### 검증
- 샌드박스 bash로만 파일 수정(§0.4 트랩 미발생, 호스트 Read로 일치 확인). `npx tsc -p ./ --noEmit`(strict) 0 errors, `node out/test/index.js` **109/109 통과**.
- 서브에이전트 코드 리뷰 수행: med 2건(비-pending 트리거 유실 구멍, stale 프레임 캐시 재주입) → 모두 반영 완료(코얼레싱 예약 `_requestTriggerPoll`, `_frameCacheGen`). low 3건 반영(then 체인 rejection, `_continueOrigin` 정리, setVariable STATUS).
- **사용자 로컬 `npm run compile` && `npm test` + 실기기 확인 필요**:
  ① 자유 실행 중 BP 히트 시 정지까지 체감(수백 ms 내), Debug Console에 `[1403] 데이터 감지` 없이도 정지가 잡히는지(비-pending 경로),
  ② 연속 스텝 체감 유지(§1-D 수준), ③ 클릭 값 표시 직후 F8 브레이크포인트 토글 동작 + 값 팝업 유지 여부,
  ④ 1402 트래픽: Running 중 Show Thread ~1회/s + 이벤트 시 추가 폴 — §1-F 관찰 포인트(ECONNREFUSED/무응답)와 함께 모니터링.

### 남은 일 / 새 미해결
- [ ] 실기기: 위 ①~④ 확인. 특히 `<E>N,N</E>` 상태 이벤트가 자유 실행 BP 히트에서도 발생하는지(발생 안 하면 감지는 1s 백업 폴에 의존 — 그래도 기존 5s보다 빠름).
- [ ] (관찰) continue pending 중 콘솔 출력 폭주 시 force 트리거 폴 빈도(기존 동작임, 상한 ≈ 1/(RTT+45ms)) — §1-F 재발 조짐 있으면 force 경로에도 최소 간격(100~150ms) 안전판 추가 검토.
- [x] ~~(기록만, 미적용) `deployService.ts` -745/-508 복구 분기 cr2 덮어쓰기~~ → **해소(2026-07-16, §1-Q)**: `recoveryFailureRecorded` 플래그로 폴스루 덮어쓰기 차단.
- [x] ~~(문서 갱신) §3-B B1의 라인 참조~~ → **B1 자체 해소(2026-07-16, §1-Q)**: `_bpCommand` 헬퍼로 5곳 전부 no-space 통일.

### 변경 파일
- `src/controller/runtimeConsole.ts` — 숫자 상태 이벤트 프레임에서 폴 트리거 발사.
- `src/debug/gplDebugSession.ts` — 트리거 핸들러 확장, 코얼레싱 폴 예약, 적응형 백업 폴, 프레임 프리페치/in-flight 합류/캐시 세대, setVariable STATUS 판정, `_continueOrigin` 정리.
- `src/extension.ts` — 클릭 값 표시 후 에디터 포커스 복귀(F8 충돌 수정).
- `CHANGELOG.md` — [Unreleased]에 항목 추가.

## 1-M. 2026-07-14 세션 — 호버 팝업 스팸 개선 (요약 모드 + 디버그 중 간소화 + gpl.hover.* 설정)

### 증상 (사용자 보고)
편집/디버깅 중 마우스가 함수명 위를 지나갈 때마다 doc comment 전문이 포함된 대형 호버 팝업이 계속 떠서 방해됨.

### 원인
§1-J(2026-07-10)에서 hover에 docComment를 붙일 때 **길이 제한 없이 전문**을 표시하도록 구현. 시그니처 + Module/Class 스코프 + 주석 전문이 합쳐져 긴 주석이 달린 심볼에서 팝업이 커짐. 디버깅 중에도 편집 때와 동일한 분량 표시.

### 조치 (다른 언어 확장 방식 참고: TS/Pylance 요약 표시, rust-analyzer/C++ 설정 게이팅)
- `package.json`: 설정 4종 추가 (`gpl.hover.enabled` 기본 true / `gpl.hover.docComment` summary|full|off 기본 **summary** / `gpl.hover.docCommentMaxLines` 기본 6, 0=무제한 / `gpl.hover.duringDebug` compact|off|normal 기본 **compact**).
- `src/config.ts`: `getHoverConfig()` 추가 — 잘못된 설정값은 기본값으로 정규화.
- `src/providers/hoverProvider.ts`:
  - `formatDocComment(doc, config)`: summary 모드는 첫 문단(빈 `'` 줄 전까지)만 + maxLines 초과분 절단, 잘린 경우 `… (전체 주석: 정의로 이동 F12)` 표시. full은 maxLines만 적용, off는 생략.
  - 디버그 간소화: `vscode.debug.activeDebugSession?.type === 'brooks-gpl'`이고 duringDebug=compact면 빌트인/사용자 Function·Sub 모두 **시그니처 코드블록 한 줄만**(카테고리·요약·링크·스코프·주석 생략). off면 언어 호버 미표시(변수 값 호버만 남음). Const/Variable은 원래 작으므로 스코프·주석만 생략.
  - `gpl.hover.enabled=false`면 조기 반환.
- 참고: `debuggers.languages: ["gpl"]` 덕에 디버그 중 VS Code가 기본적으로 값 호버를 우선하지만, Alt-호버·비디버그 편집 경로의 대형 팝업은 이번 설정으로 해결. 팝업 등장 빈도 자체는 전역 `editor.hover.delay`(기본 300ms) 증가로 조절 가능(확장이 강제 불가, §1-E 참고와 동일).

### 검증
- 호스트 도구로 수정 후 샌드박스에서 파일 일치 확인(§0.4 트랩 미발생), `npx tsc --noEmit -p .` 0 errors, `npm test` **109/109 통과**.
- **사용자 로컬 `npm run compile` + 실기기 확인 필요**: ① 긴 doc comment 함수 hover가 첫 문단+6줄로 줄고 `…` 표시되는지, ② brooks-gpl 디버깅 중 hover가 시그니처 한 줄로 나오는지, ③ 설정 변경(full/off 등)이 재시작 없이 반영되는지(매 요청마다 읽으므로 즉시 반영 예상).

### 남은 일 / 새 미해결
- [ ] (선택) 잘린 주석의 "정의로 이동" 안내를 command link로 대체 검토 — 현재 `isTrusted=false`라 텍스트 안내만. command URI 허용 시 신뢰 범위 결정 필요.
- [ ] (선택) completion/signatureHelp의 docComment 표시에도 동일한 요약 규칙 적용 검토(현재 hover만).
- [ ] (2026-07-14 공식 문서 show_variable.htm 대조로 발견) `_parseShowVariableEval`이 첫 줄만 사용 — **Object 변수는 필드/프로퍼티별 다중 라인 응답**이므로 필드 값이 버려짐. 다중 라인이면 variablesReference 트리 또는 여러 줄 표시로 개선 검토.
- [ ] (같은 대조) 배열은 `arr(0,0)`처럼 인덱스 지정 시에만 값 표시(전체 배열은 타입만) — 배열 이름 hover 시 "(인덱스를 지정하세요)" 안내 추가 검토.
- [ ] (참고) 사용자 실기기 사례: 스택 라인과 로컬 소스 라인 불일치(배포 후 편집) 시 hover가 엉뚱한 프로시저 심볼을 조회해 -729. 재배포 안내 또는 스택 라인-소스 드리프트 감지(프로시저명 대조) 검토.

### 변경 파일
- `package.json` — `gpl.hover.*` 설정 4종.
- `src/config.ts` — `HoverConfig` 타입 + `getHoverConfig()`.
- `src/providers/hoverProvider.ts` — 요약/절단, 디버그 compact/off, enabled 게이트.

## 1-N. 2026-07-14 세션 — 디버그(F5) 배포에 "업로드 전 쓰레드 확인 + 정지 확인 모달" 게이트 적용

### 배경
§1-G에서 Quick Compile에 넣은 게이트(업로드 전 `Show Thread` → 활성 쓰레드면 모달로 Stop 여부 확인
→ 미승인 시 `THREAD_CHECK` 중단)가 만족스럽게 동작했다. 사용자 요청: **GPL 업로드 디버깅(F5)**
경로에도 같은 안전 절차를 적용. 원칙(사용자 강조, 메모리 `feedback_gpl_upload_thread_check`):
**실행 중인 쓰레드가 있는 상태의 업로드는 파일 충돌·메모리 누수를 유발할 수 있으므로, 업로드 동작
전에 반드시 `Show Thread`로 확인하고 동작 중이면 사용자에게 중지 여부를 먼저 묻는다.**

### 원인 (게이트 누락 지점)
`gplDebugSession._runDeployBeforeAttach`가 `deploy()`에 `directGpl: true`만 넘기고
`skipStop`/`confirmStopOnActive`를 넘기지 않았다. → `skipStop`이 falsy → deploy의 STOP 단계가
**무조건 `Stop -all`을 조용히 실행**(사용자에게 묻지 않고 실행 중 쓰레드를 정지)했다.
Quick Compile은 `skipStop: true` + `confirmStopOnActive` 모달로 이 확인을 하고 있었는데,
F5 경로만 빠져 있었다.

### 조치 (`src/debug/gplDebugSession.ts`)
- **`_runDeployBeforeAttach`가 `deploy()`에 `skipStop: true` + `confirmStopOnActive`(모달) 전달.**
  Quick Compile과 동일 게이트 재사용 — 활성 쓰레드 없으면 불필요한 `Stop -all` 없이 바로 업로드,
  있으면 `'실행 중인 쓰레드가 있습니다. Stop -all로 정지한 후 디버깅을 시작할까요?'` 모달
  (버튼 `Stop 후 디버그 시작`). 승인 시 Stop+정지완료 게이트→업로드, 거부 시 `THREAD_CHECK` 중단.
- **취소를 실패와 구분.** `_runDeployBeforeAttach` 반환형을 `boolean` → `{ ok; cancelled? }`로 변경.
  `THREAD_CHECK`(사용자 취소)면 컴파일 에러 UI(첫 에러 점프/Problems 패널/deployOutput.show)를
  띄우지 않고 조용히 중단, `attachRequest`는 "쓰레드를 정지하지 않아 디버깅을 시작하지 않았습니다.
  STOP 후 다시 F5" 안내 메시지를 낸다(기존 "배포 실패"와 분리).
- 이 함수 하나가 launch.json Attach / Quick Debug Attach(`gpl.debug.attachNow`) 등 `deployBeforeAttach:true`
  진입점 전부를 커버하므로 단일 지점 수정으로 모든 F5 경로에 적용됨.

### 검증
- 로컬 `npm run compile` 통과(0 errors), `npm test` 109/109 통과.
- **실기기 검증 필요**: F5 시 ① 활성 쓰레드 있으면 모달이 뜨고, ② 승인 시 Stop→정지확인→업로드→attach,
  ③ 거부 시 세션이 취소 메시지와 함께 중단되는지, ④ 활성 쓰레드 없을 땐 모달 없이 바로 배포되는지.

### 남은 일 / 참고
- [ ] (선택) 전체 배포 "Deploy & Run"(`runDeploy` skipStart=false)도 현재 무조건 `Stop -all`이다.
  실행 후 재시작이 계약이라 정지가 내재적이지만, 실행 중 로봇 정지 확인이 필요하면 동일 게이트 적용 검토.
- [ ] (선택) 거부 시 "재배포 없이 실행 중 프로그램에 attach만"(관찰 전용) 옵션 제공 여지.

### 변경 파일
- `src/debug/gplDebugSession.ts` — `_runDeployBeforeAttach`(skipStop+confirmStopOnActive, 반환형 변경), `attachRequest` 취소 분기.

## 1-O. 2026-07-14 세션 — 반복되는 `.git/index.lock` "File exists" 에러 진단 + 해제 스크립트 추가

### 증상
`git add`/`commit` 시 `fatal: Unable to create '.../.git/index.lock': File exists.
Another git process seems to be running ...`가 **매번** 발생.

### 원인 (핵심: stale 락, "another git process"는 거짓 경고)
- 문제의 `.git/index.lock`은 **0바이트, 4일 전(2026-07-10 11:37) 생성**본이었고, 확인 시점에
  **실행 중인 git.exe가 하나도 없었다**(Win32_Process 조회 결과 없음). 즉 살아있는 git이 아니라
  이전에 중단된 프로세스가 남긴 **stale 락**이 방치돼 있었던 것. 아무도 안 지우니 이후 모든 인덱스
  쓰기가 같은 락에 걸려 "매번" 실패한 것처럼 보임(새 에러가 아니라 동일 락 하나가 계속 차단).
- 락 leak 유발 조건이 이 환경에 다 있음: **AI 에이전트 2개 동시 실행**(`codex` 프로세스 + Claude Code)이
  같은 리포에서 git을 돌림 + **VS Code 내장 Git**의 자동 status/fetch/refresh + Windows Defender/인덱싱의
  순간 파일 핸들 점유. 이 중 하나가 락을 쥔 채 강제 종료되면 락이 남는다.

### 조치
- 즉시: stale 락 제거(실행 중 git 없음 확인 후) → git 정상 복구.
- **`scripts/git-unlock.js` 추가** + `package.json`에 `npm run git:unlock` 등록.
  - 기본(안전) 모드: **실행 중 git 프로세스가 없을 때만** 락 제거. git이 돌고 있으면 살아있는 작업일
    수 있으므로 제거하지 않고 경고(레이스 방지). 추가로 락이 `MIN_AGE_SECONDS`(5s) 이내 생성이면
    진행 중일 수 있어 건너뜀.
  - `--check`: 상태만 출력(제거 안 함). `--force`: git 프로세스/age 확인 건너뛰고 강제 제거.
  - `index.lock`/`HEAD.lock`/`config.lock`/`shallow.lock` 대응, worktree(`.git` 파일 형태)도 해석.
- 재발 방지 권고(스크립트 외): ① 같은 리포에서 codex + Claude Code를 동시에 git 작업시키지 않기,
  ② Windows Defender 실시간 검사에 리포/`.git` 제외 추가, ③ git 명령을 강제 중단(Ctrl+C/터미널 닫기)하지 않기.

### 검증
- `node scripts/git-unlock.js` 5개 경로 수동 테스트 통과: (1) 락 없음=정상, (2) `--check`=상태만,
  (3) fresh 락=age 가드로 건너뜀, (4) 60s 락=제거, (5) `--force`=즉시 제거. 이후 `git status` 정상.

### 변경 파일
- `scripts/git-unlock.js` (신규), `package.json` (`git:unlock` 스크립트 추가).

## 1-P. 2026-07-14 세션 — 디버그 변수 표시: 배열/객체 구조적(트리) 표시 지원

### 증상
Variables/Watch/hover에서 배열·객체 변수의 표시가 깨짐.
- 배열: `Show Variable` 응답 `My_array, Double(,)`를 단순 `split(',')`로 파싱해 값이 **`)`** 로 표시됨.
- 객체: 응답이 여러 줄(`Loc, Object` + 멤버별 `Loc.X, Double, 0` …)인데 **첫 줄만 파싱**해 "Object"만 보이고 멤버가 전부 유실.
- 전역 패널: `Show Global`은 숫자/문자열 식만 지원(공식 문서)해 배열/객체 전역이 아예 안 보였음.

### 근거 (공식 문서, live fetch 확인)
`Show Variable Command`(www2.brooksautomation.com/Controller_Software/Software_Reference/Console_Commands/show_variable.htm):
- 단순 값 `name, type, value` / 배열 `name, Type(…)` — **전체 배열 값은 표시 안 됨, 요소 단위 조회만 가능**(`arr(0,0), Double(,), 30.5`) / 객체는 멀티라인(멤버별 1줄), 중첩 객체는 별도 `Show Variable`로 재조회 필요.
`Show Global Command`: 숫자/문자열 **식**만 지원 → 배열/객체 전역 표시는 `Show Variable -eval`로 우회해야 함.

### 조치 (`src/debug/gplDebugSession.ts`)
- **파서 교체**: `_parseShowVariableMulti`(전체 줄) + `_splitVarLine`(괄호 안 쉼표 무시, 3필드 초과분은 값에 합침 — 문자열 값 쉼표 보존). 기존 `_parseShowVariableEval`은 첫 항목 반환 래퍼로 유지(호출부 호환).
- **ScopeRef 확장** (union): 기존 locals/globals에 `members`(객체 응답에 동봉된 멤버 줄 — 재조회 없이 표시) / `expand`(배열·중첩 객체 — 펼칠 때 지연 조회) 추가.
- **분류/변환**: `_classifyVarEntry`(값 없이 타입에 괄호=배열, `Object`=객체) → `_makeVariable`이 배열/객체에 `variablesReference` 부여해 Variables/Watch에서 **트리로 확장**. `evaluateName` 설정으로 Watch 추가도 자연스럽게 동작.
- **배열 확장** `_expandArrayElements`: 선언 크기를 알 수 없으므로 인덱스 0부터 순차 조회, 범위 밖 STATUS 오류에서 중단. 상한 `ARRAY_EXPAND_MAX = 30`(직렬 명령 큐 보호). 다차원은 첫 인덱스만 순회(나머지 0 고정) + 안내 행.
- **전역 패널**: 각 전역을 `Show Variable -eval <breakThread> <frame> <qualifiedName>`로 먼저 조회(전역은 어느 프레임에서든 접근 가능 → 타입/구조 확보), 실패 시 기존 `Show Global` 폴백(`_readGlobalValue`) 유지.
- **evaluate(hover/watch)**: 구조 조회로 전환, 배열/객체면 `variablesReference` 반환(캐시에 ref 동봉 — 핸들과 캐시 모두 `_clearStaleState`에서 리셋되므로 수명 일치). REPL은 객체 멤버 전체를 멀티라인 텍스트로 출력.
- **setVariable**: members/expand 스코프에서 표시 이름이 부분 경로이므로 전체 식(`parent.field`, `parent(i)`)으로 조합해 `Execute` 전송.
- **부수 수정**: REPL/hover의 `Show Global` 폴백이 STATUS 블록을 제거하지 않아 `0, "Success"`가 값처럼 표시되던 버그 수정(기존 `_parseShowVariableEval` 주석에 문서화돼 있던 것과 같은 부류).

### 검증
- 샌드박스 `tsc -p ./ --noEmit` 통과 (파일 동기화 확인 후 — §0.4).
- 파서 단위 검증: 실제 소스에서 `_splitVarLine`/`_parseShowVariableMulti` 본문을 추출해 공식 문서 예시 6종(단순/배열 헤더/요소(괄호+쉼표 이름)/쉼표 포함 문자열/멀티라인 객체+STATUS/오류 STATUS만) 전부 기대값 일치.
- **실기기 미검증** — 제어기 연결 후 Variables 패널에서 배열/객체 펼침, Watch 확장, 멤버 setVariable 확인 필요(§3 체크리스트 추가). 읽기 전용 Show 명령 위주라 모션 영향 없음(setVariable은 기존 Execute 경로 그대로).

### 변경 파일
- `src/debug/gplDebugSession.ts` (단일 파일).

## 1-Q. 2026-07-16 세션 — 자체 검토: 전체 코드 리뷰 + §3-B 보류 항목 일괄 적용

### 배경
사용자 요청 "자체 검토 및 개선" — 범위 선택: **§3-B 보류 항목 전체(모션 영향 포함) + 전체 코드 리뷰**.
4개 영역(컨트롤러/디버그 어댑터/언어 서비스/확장·뷰) 병렬 리뷰로 발견 사항을 수집한 뒤,
파일 소유권을 나눠 일괄 적용했다. 모션 영향 항목은 사용자가 위험 감수를 명시 승인했으며,
**실기기 검증 전이므로 아래 체크리스트 확인 후 사용**해야 한다.

### 조치 A — §3-B 보류 항목
- **B1 (BP 명령 형식 통일)**: `gplDebugSession._bpCommand` 헬퍼 신설 — GDE 캡처 실측(runbook)
  기준 **no-space**(`Set Break <proj> "<file>"<line>`)로 5개 전송 지점 전부 통일.
  disconnect 경로만 공백 형식이라 세션 종료 시 BP 해제가 조용히 실패할 수 있었던 유일 불일치 해소.
- **B2 (자동 Start 확인 게이트)**: 설정 `gpl.controller.requireStartConfirmation`(기본 **true**) 신설.
  deployService START 단계(Deploy & Run)와 디버그 `configurationDone` 자동 Start에 모달 확인 적용.
  attach의 `Start -break -bex`는 엔트리 정지 시작(모션은 사용자 continue 시점)이라 게이트 제외.
  거부 시 배포는 failedPhase='START'로, 디버그는 안내 메시지 후 세션 유지.
- **B3 (REPL destructive 게이트)**: `consoleCommandClassifier` 정비(`ErrorLog -clear`/`Execute` →
  state-changing, `isReadOnlyConsoleCommand` export) + REPL: `>` 접두 명령 중 비읽기는 모달 확인
  (`gpl.debug.confirmDestructiveRepl` 기본 true), **비접두사 폴스루는 읽기 전용만 통과**(그 외
  "'>' 접두사 사용" 안내 — 오타가 명령으로 나가던 구멍 차단). setVariable은 CR/LF 값 거부만 추가.
- **B4/B5 (controllerConnection terminator-first)**: 종결 판정을 "버퍼 끝 `</STATUS>`"로(DATA 본문 내
  STATUS 텍스트 오인 방지), `meta.responseComplete`는 **STATUS 수신만 인정**(</DATA>-only 제외),
  idle/close 완료는 트래픽 로그에 INCOMPLETE 표시. idle 조기 완료 자체는 유지 — deployService의
  HTTP(GoAhead) 교차 응답 감지가 idle 경로에 의존하기 때문(제거 시 감지 소실). parseStatus는
  **마지막 STATUS 블록** 채택으로 변경.
- **B6 (FTP 부분 업로드 감지)**: `ftpClient.uploadVerified` — 업로드 직후 SIZE 재확인, 불일치
  "확인" 시 1회 재업로드 후 실패 처리(예외 → UPLOAD 실패). SIZE 조회 불가는 통과(정상 업로드를
  오실패로 만들지 않음). uploadProject/mirrorProject 공통. 임시명+rename(원자적) 방식은 제어기
  FTP의 RNFR/RNTO 지원 미확인으로 보류.
- **A5 (WaitForEOM URL)**: 라이브 확인 결과 `waitforoem.htm`이 **Brooks 공식 파일명**(오타는
  Brooks 측 파일명이고 페이지는 정상, `waitforeom.htm`은 빈 페이지) — 수정 불필요, 종결.
- **TS 품질**: diagnosticProvider `getDiagnostics` 삭제(참조 0) + `DIAGNOSTICS_DISABLED` 상수를
  설정 `gpl.diagnostics.experimental`(기본 off) 게이트로 교체 + `optional-parameter` ERROR 진단
  삭제(오버로드 모듈의 Optional 지원 모델과 정면 충돌); `symbolCache.findReferences` **미오픈
  파일 스캔**(async + fs.readFile, "정의 보유 파일만" 필터 제거, token 지원); extension.ts 분리는
  보류(아래 남은 일 — 분리 지도 확보됨).

### 조치 B — 리뷰 발견 수정 (high/med 중심)
- **[게이트 무력화] deployService.probeActiveThreads가 인자 없는 `Show Thread` 사용** — 실측
  (runbook: 실행 중에도 빈 DATA)대로면 §0.6 정지 게이트/THREAD_CHECK가 항상 통과하는 false-pass.
  `SHOW_THREAD_LIST_CMD`(`Show Thread  -web`) + **STATUS 종결 미수신 시 "확인 불가"(null)** 처리로 교체.
- **[하드룰 잔존] extension.ts ftpRun**: ① tryCompile을 `waitForStatusClose:true`로(§1-A와 동일),
  ② 'compile successful' 텍스트 마커 성공 제거, ③ `Show Thread` 보강 성공 판정 제거(STATUS
  누락=실패), ④ `ensureStoppedBeforeCompile()` 반환 무시 2곳 → false면 중단(§0.6).
- **[파서] normalizeThreadState**: `'stopp'` 포함 검사가 "Stopped"를 'Stopping'으로 오정규화 →
  'stopped' 우선 검사로 수정. extension의 verifyThreadStopped/verifyAllStopped도 settled=
  `/^(idle|stopped|error)$/i`로 정합화(정지 완료를 활성으로 오판 → 불필요 SoftEStop 유도 제거).
- **[§1-L 해소] deployService**: -745/-508 복구 후 cr2 실패 기록 덮어쓰기 차단(recoveryFailureRecorded),
  후보 성공 시 이전 후보 compileErrors 잔류 제거, totalPhases에 ERROR CHECK 포함([5/4] 표기 수정),
  상태코드 substring 오탐 방지(hasCode 경계 매칭).
- **[배포 동시성] extension.ts**: runDeploy 전역 뮤텍스(이중 실행 차단), autoOnSave — 컴파일 중
  저장분 유실 방지(재예약), 프로젝트별 그룹핑(타 프로젝트 파일 조용한 탈락 방지), .gpr 미해석
  파일은 저장 경로에서 UI 없이 스킵.
- **[디버그 gplDebugSession]**: 폴 체인 예외 시 재스케줄 보장(try/finally), 폴 감지 정지 시
  평가/프레임 캐시 무효화, deploy가 감지한 projectName 보존(args 우선), 외부 재개 시
  ContinuedEvent 전송, `_expandArrayElements` 종료 조건 정비(무응답=표식 후 중단, 빈 값은 계속,
  pending 시 조기 중단), hover `Show Global` 빈 프로젝트명 가드, `_lastThreadList` 제자리 정렬
  제거, 값 태그 제거 정규식을 DATA/STATUS로 한정, `Start -break` 실패 시 pending 'entry' 해제.
- **[언어 서비스]**: referenceProvider 한정자 인접성 수정(문서 전체 lastIndexOf('.') → 인접 점만)
  + 문자열 리터럴 오탐 제거(isInCommentOrString); hover 로컬/파라미터 우선(동명 전역에 가려짐 해소);
  생성자 arity Optional/ParamArray 반영; 파서 이름 컬럼 word-boundary(`Fun`이 `Function`에 매칭되던
  버그); `As T()` 배열 반환 타입 기록; 파라미터 추출 주석 안전(stripToCode 위치 결정 + 원본 슬라이스);
  signatureHelp 오버로드 전체 표시; folding 연속줄 오탐(주석 끝 `_`); 파서 캐시 LRU화;
  `deleteByFsPathPrefix`(폴더 삭제/rename 후 stale 심볼 해소); completionProvider 죽은 계산 제거;
  .gpo NUL 가드; 경로 비교 대소문자 정규화.
- **[1403/뷰/스크립트]**: runtimeConsole — `_onDidReceiveData` dispose 누락, waiter 배열 stale(교체
  전 원본을 filter), close 시 carry flush, **connect 자체 타임아웃(5s)**; controllerTreeProvider —
  폴 세대 토큰(**디버그 중 폴링 지속되던 레이스** 수정), 늦은 응답 가드, refresh(true) stale 대기;
  clearErrors 인라인 버튼 when 수정(`section-errorsCode|Env` — 기존엔 절대 안 뜸); F9 continue를
  `debugType == 'brooks-gpl'`로 한정(타 디버거 F9 BP 토글 하이재킹 제거); scripts/package.js bump
  롤백 범위/npx 인용, git-unlock unlink 예외 처리; ftpClient dot 항목 업로드 제외·'.'/'..' 재귀
  방지·다운로드 경로 탈출 가드; RuntimeConsole dispose를 subscriptions에 등록; 디바운스 타이머
  2종 dispose 등록; deployOutcomeHistory 상한 50; autoStartOnDeploy 등 설정 read-at-use(기본값
  package.json과 일치).

### 검증
- 샌드박스 `npx tsc -p ./ --noEmit`(strict) **0 errors**, `node out/test/index.js` **123/123 통과**
  (기존 109 + 파서 수정 회귀 12 + responseParser 2: parseStatus 마지막 블록/Stopped 정규화).
- 편집 전부 샌드박스 bash python(§0.4 트랩 미발생), 호스트 grep으로 전 파일 동기화 확인.
- package.json 신규 설정 3종(requireStartConfirmation/confirmDestructiveRepl/diagnostics.experimental)
  등록, JSON 유효성 확인.
- **사용자 로컬 `npm run compile` && `npm test` 최종 확인 필요(§0.4).**

### 남은 일 / 실기기 검증 체크리스트
- [ ] 로컬 `npm run compile` && `npm test` → `npm run package`로 VSIX 재생성.
- [ ] 실기기: ① Deploy & Run에서 Start 확인 모달 표시/거부 시 START 중단(끄려면
  `gpl.controller.requireStartConfirmation: false`), ② F5(stopOnEntry=false) 자동 Start 모달,
  ③ REPL `>Stop -all` 류 확인 모달 + 비접두사 명령 차단 안내, ④ disconnect 후 GDE `Show Break`로
  BP 잔재 없는지(B1 no-space 효과), ⑤ Quick Compile/F5 게이트가 활성 스레드를 실제 감지하는지
  (`-web` 폴 — 직전까지 false-pass 가능성 있었음), ⑥ ftpRun에서 STATUS 누락 시 실패 처리 확인,
  ⑦ 업로드 후 SIZE 재검증이 정상 배포에서 오탐 없는지.
- [ ] extension.ts 분리(§3-B 잔여) — 이번 리뷰로 분리 지도 확보: `extensionRuntime`(채널·상태
  컨텍스트) → registerLanguageProviders(416-721) / registerXmlCommands / projectContext(767-1000)
  / registerDeployCommands(1178-1608) / registerControllerCommands(ftpRun 2167-2529는 별도 파일)
  / registerDebugIntegration(2917-3092 + 데코레이션 승격). 이번 세션은 행동 수정이 많아 구조
  변경 혼합을 피했다(디프 리뷰 가능성 유지).
- [ ] (리뷰 발견, 미적용 — 다음 후보) 디버그 step/continue의 stale 폴 스냅샷 레이스(액션 전송
  시각과 스냅샷 시각 비교 필요), variablesReference/frameId 카운터 리셋 재사용, Globals 확장
  무상한 직렬 왕복(캐시+상한), activateDebug 재시작 400ms 고정 대기, controllerConnection
  resolve-before-close half-open(§1-F 연관 — 변경 리스크로 보류), referenceProvider
  findTextInFiles proposed API 죽은 경로 정리, mirror 삭제 실패 swallow.

### 변경 파일
- 직접: `src/controller/controllerConnection.ts`(B4/B5), `responseParser.ts`(parseStatus/상태 정규화),
  `deployService.ts`(게이트/복구/START 게이트), `ftpClient.ts`(B6/필터/가드), `runtimeConsole.ts`,
  `package.json`(설정 3종/F9/menus), `src/test/responseParser.test.ts`(+2).
- 에이전트 A(디버그): `src/debug/gplDebugSession.ts`, `src/controller/consoleCommandClassifier.ts`.
- 에이전트 B(언어): `gplParser.ts`, `symbolCache.ts`, `language/cursorExpression.ts`,
  `providers/{reference,hover,completion,definition,signatureHelp,foldingRange,diagnostic}Provider.ts`,
  `src/test/gplParserFixes.test.ts`(+12), `src/test/index.ts`.
- 에이전트 C(확장/뷰): `extension.ts`, `views/controllerTreeProvider.ts`, `scripts/package.js`,
  `scripts/git-unlock.js`.

## 1-R. 2026-07-16 세션(후속) — 자동완성 개선: 멤버 완성 + 로컬 완성 + 중복 삽입 방지

### 배경 (사용자 요청: 자동완성 검토 → 개선)
검토에서 확인된 3건: ① `.` 트리거인데 멤버 컨텍스트 인식이 없어 `obj.` 뒤에 전역 목록 전체가 뜸(노이즈),
② dotted 내장(label `Move.Approach` + full insertText)이 `Move.` 뒤 선택 시 `Move.Move.Approach(...)`로
중복 삽입될 위험, ③ 로컬 변수/파라미터 미제공(워드 기반 제안에만 의존).

### 조치
- **`cursorExpression.extractQualifierChainBefore`(순수 함수) 신설**: 커서 앞 텍스트에서 한정자 체인
  추출(`a.b(0).C` → chain ['a','b(0)'], partial 'C'). 숫자 리터럴(`1.`)·괄호식(`(x).`) 제외.
- **completionProvider 재구성**:
  - 멤버 컨텍스트면 **해당 한정자의 멤버만** 반환. 한정자 타입 해석 순서: 내장(사전) 클래스 정적 접근
    → 현재 프로시저 로컬/파라미터 타입(메모이즈 파서) → 워크스페이스 심볼(클래스/모듈/returnType).
    체이닝은 사용자 심볼 returnType으로만(내장 반환 체이닝 미지원 → 폴백). 배열은 `arr(0).`=요소 타입,
    `arr.`=내장 Array 클래스. **원시 타입(Integer 등) 뒤 `.`는 빈 목록**(노이즈 억제).
  - 내장 멤버는 **tail만 삽입**(`Approach(...)`) — ② 중복 삽입 원천 차단. 사용자 멤버는 파라미터 스니펫.
  - **주석 안 완성 억제, 문자열 안은 XML 엔티티 완성만 유지**(`&` 트리거의 존재 이유). `classifyPosition`
    헬퍼(GPL `""` 이스케이프 인식).
  - **로컬/파라미터 완성 추가**: 현재 프로시저 범위(findEnclosingProcedureRange)의 isLocal/isParameter
    심볼, `00_local_` sortText로 최상단. 해석 실패 시 기존 전역 목록 폴백(동작 보수적).
  - `Chr(9)` 라벨의 리터럴 탭 문자 제거(표시 어색함).
- **symbolCache**: `getClassMembers`/`getModuleMembers` 신설, `buildSymbolDocumentation`/
  `getCompletionItemKind` public화(멤버 항목 문서화 재사용).

### 검증
- tsc strict 0 errors, 테스트 **130/130**(체인 추출 회귀 7 추가: 단순/partial/인덱싱/중첩괄호/숫자/괄호식).
- 에디터 확인 필요(실사용): ① `Move.` → Move 멤버만+tail 삽입, ② `Dim loc As Location` 후 `loc.` →
  Location 멤버, ③ 사용자 클래스 변수 `obj.` → 클래스 멤버(필드/상수 포함), ④ 로컬/파라미터가 목록
  최상단, ⑤ 주석/문자열 안 팝업 억제, ⑥ 미지 식별자 뒤 `.`는 기존처럼 전역 목록(폴백).
- **§0.4 함정 재발 기록**: 이번엔 `package.json`의 샌드박스 뷰가 꼬리 4바이트(`"\n}\n`) 잘려
  `node`가 ERR_INVALID_PACKAGE_CONFIG. **호스트 원본은 정상**(Read로 대조) — 샌드박스 뷰만 호스트와
  동일 내용으로 재기록해 해소. 판단은 항상 호스트 원본 기준으로 할 것.

### 남은 일
- [ ] (선택) 내장 멤버 반환 타입 체이닝(`XmlDoc.CreateElement(...).`) — 사전 데이터에 returnType 필드
  추가가 선행 필요.
- [ ] (선택) 멤버 완성에서 접근 제한자(Private) 필터링 — 현재는 클래스 밖에서도 전 멤버 표시.

### 변경 파일
- `src/providers/completionProvider.ts`(재구성), `src/language/cursorExpression.ts`(+extractQualifierChainBefore),
  `src/symbolCache.ts`(멤버 조회 API), `src/test/cursorExpression.test.ts`(+7).

## 1-S. 2026-07-16 세션(후속2) — 중첩 클래스 파서 수정 + 스모크 하니스 + Dictionary 커버리지 대조

### 배경 (사용자 질문 3건)
① "VS Code 없이 실시간 점검 가능한가" → 모의 vscode 주입 하니스로 해결(아래).
② "KDY_AutoAging.gpl의 class 중첩 구조 처리되나" (Module > ZeroPlan > StepBatch > StepAxis 3중 중첩).
③ "함수 호버는 되는데 상수는 왜 안 보이나".

### ② 중첩 클래스 — 구조적 결함 발견·수정
- 결함: 파서가 클래스 문맥을 **스택 없이 단일 변수**로 추적 → 안쪽 `End Class`가 바깥 문맥까지
  소거. 안쪽 클래스 **뒤에 오는** 바깥 클래스 멤버가 모듈 직속으로 오분류되고, 부모 관계 소실.
  (KDY 파일은 멤버 배치가 우연히 안전한 순서라 겉으론 동작했음)
- 수정: `gplParser`에 `classStack` 도입(End Class → pop으로 바깥 복귀, Module 진입/End Module에서
  초기화), `GPLSymbol.parentClassName` 추가(중첩 클래스의 부모 기록, additive).
  `symbolCache.getClassMembers`가 중첩 클래스를 바깥 클래스 멤버로 노출(ZeroPlan. → StepBatch),
  completionProvider 체인 하강에 중첩 클래스/모듈 내 클래스 홉 추가(ZeroPlan.StepBatch. → 멤버).
- 검증: 신규 파서 테스트 4건(안쪽 End Class 뒤 멤버 귀속/모듈 복귀/parentClassName/안쪽 멤버 귀속)
  포함 **134/134 통과**. 실파일 하니스: `ZeroPlan.` → 멤버 7+StepBatch, `ZeroPlan.StepBatch.` →
  멤버 7+StepAxis, `steps(0).` → StepBatch 멤버. 문자열 안 `.`은 억제 확인.

### ① 스모크 하니스 (신규 dev 도구 — "VS Code 없이 직접 점검")
- `scripts/dev/vscodeMock.js` + `scripts/dev/smoke.js`: vscode API 최소 모의를 `Module._load` 훅으로
  주입해 **컴파일 산출물(out/)의 실제 provider**(호버/완성)를 임의 .gpl 파일로 구동.
  `node scripts/dev/smoke.js <파일.gpl> [--hover 단어] [--member 한정자.]` (먼저 npm run compile).
- VSIX에는 미포함(.vscodeignore에 scripts/dev/** 추가). 한계: 실제 UI/디버그 호버/제어기 연동은
  못 봄 — 그건 여전히 실기기 확인 필요.

### ③ 상수 호버 — 현 코드는 정상 (하니스 실증)
- KDY 실파일에서 상수 선언부/사용부 호버 모두 정상(`값: 2300`까지 표시). 모듈 레벨 bare `Const`
  파싱은 2026-03부터, 값 표시는 04-30부터 존재 — 코드 결함 아님.
- 사용자 환경(설치 VSIX ~0.7.7 추정)에서 안 보인 원인 후보: (a) 설치본이 이전 빌드,
  (b) **디버깅 중** 디버그 값 호버가 우선되는데 상수는 런타임 변수가 아니라 DA 평가가 실패/빈값
  → 아무것도 안 뜸. 사용자에게 "편집 중에도 안 보이는지"를 질문한 상태 — 답에 따라
  (b)면 DA evaluateRequest hover 실패 시 깔끔한 실패 반환(→ VS Code가 언어 호버로 폴백) 개선 검토.

### GPL Dictionary 커버리지 대조 (사용자: "정의 다 들어갔어?")
- 공식 검색 인덱스(캐시 모드 — 라이브 403 차단) 기준 GPL_Dictionary **384페이지** 중
  우리 sourceUrl 참조 **319**. 미커버 65 = intro/summary/Statement류 47(함수 아님, §1-J 의도적 제외
  범주) + 멤버성 18: **생성자 8**(New XmlDoc/TcpClient/TcpListener/UdpClient/IPEndPoint/
  StreamReader/StreamWriter/Thread), **Try/Catch 문 계열 6**(Statement 범주), ShowDialog
  Advanced Mode 변형 1, CAddr(Hidden) 1, XmlDoc Encode/Decode 2는 이름으로는 등록돼 있음(URL만 상이).
- 멤버성 페이지 기준 **319/337 ≈ 95%**. 캐시 인덱스라 사이트 최신과 미세 차이 가능.

### 남은 일
- [ ] (결정 대기) 생성자 8건을 사전에 등록할지 — `New XmlDoc(...)` 형태라 completion/signature와
  결합 방식 결정 필요(예: `Class.New` 이름 또는 `New` 키워드 트리거 특수 처리).
- [ ] 상수 호버: 사용자 답변에 따라 (b) 경로면 DA hover 평가 실패 반환 개선.
- [ ] smoke 하니스에 정의 이동(definitionProvider) 배터리 추가 검토.

### 변경 파일
- `src/gplParser.ts`(classStack/parentClassName), `src/symbolCache.ts`(getClassMembers 중첩 노출),
  `src/providers/completionProvider.ts`(체인 하강 홉), `src/test/gplParserFixes.test.ts`(+4),
  `scripts/dev/vscodeMock.js`·`scripts/dev/smoke.js`(신규), `.vscodeignore`.

## 1-T. 2026-07-22 세션 — 정의 찾기: `Shared Public Dim` 수식어 순서 + 문자열 속 프로시저 참조(New Thread)

### 증상 (사용자 보고, MergeCode/DataModule.gpl)
① 59행 `SaveReservationThread.ThreadState`에서 F12가 12행 선언
   `Shared Public Dim SaveReservationThread As Thread = New Thread(...)`로 이동하지 않음.
② 12행 `New Thread("DataFile.SaveReservationThreadFunction",,"SaveReservationThreadFunction")`의
   문자열 속 프로시저 이름에서도 F12가 동작해야 한다는 요청.

### 원인
① 멤버 변수 정규식 6개(shared 3 + 일반 3)가 전부 `Public Shared Dim` 순서만 허용
   (`^(Private|Public)\s+Shared\s+...`). GPL은 `Shared Public Dim` 순서도 유효한데
   (Sub/Function/Property 매치는 이미 수식어 임의 순서 허용) 변수만 빠져 있어 심볼 미인덱싱.
② definitionProvider가 문자열 내부를 무조건 차단(2026-07-03 오검색 방지 조치)
   — GPL의 "프로시저를 문자열로 참조" 관용구(Thread 생성자)가 함께 막혔음.

### 조치
① `src/gplParser.ts`: 멤버 변수 6개 정규식을 공통 수식어 접두
   `((수식어{Private|Public|Protected|Friend|Shared})+ Dim? | Dim)` 기반 3개(New형/스칼라·Const형/배열형)로
   통합. 접두 문자열에서 accessModifier/isShared를 판정(`memberMods`). 수식어·Dim이 하나도 없는
   bare `x As Integer`는 선언으로 오인하지 않도록 접두를 필수화.
② `src/language/cursorExpression.ts`: `getStringLiteralContentAt`(커서를 감싸는 "..." 내용 추출,
   주석/문자열 밖은 undefined) 신설 — 순수 모듈이라 Node 테스트 가능.
   `src/providers/definitionProvider.ts`: 문자열 내부일 때 `resolveStringLiteralReference`로 위임.
   문자열 전체가 식별자 형태(`Name`/`Class.Proc`)일 때만: qualifier 있으면 클래스→모듈 멤버의
   Sub/Function, 첫 segment면 클래스/모듈 정의, 단일 식별자면 Sub/Function만 허용(변수와의
   우연 일치 배제). 캐시 미스 시 현재 문서 온디맨드 파싱 폴백. 해석 실패 시 기존처럼 undefined
   (일반 문장/경로 문자열에서 엉뚱한 점프 없음 — 기존 차단 의미 보존).

### 검증
- `npm test` 142/142 통과 (신규: 수식어 순서 5건 + getStringLiteralContentAt 3건).
- 실기기/실파일 확인은 사용자 몫: DataModule.gpl 59행 → 12행(F12), 12행 문자열 → 78행
  `SaveReservationThreadFunction` Sub(F12).

### 남은 일
- [ ] hover/reference도 문자열 속 프로시저 참조를 지원할지 결정(현재는 definition만).

### 변경 파일
- `src/gplParser.ts`(멤버 변수 수식어 순서 통합), `src/language/cursorExpression.ts`(+getStringLiteralContentAt),
  `src/providers/definitionProvider.ts`(+resolveStringLiteralReference), `src/test/gplParserFixes.test.ts`(+8).

## 1-U. 2026-07-22 세션 — Show Variable 실기기 검증(§1-P 후속): 객체 헤더 형식 차이 수정 + 콘솔 평가 한계 확인

### 배경/증상

사용자가 실기기(G2400C, GPL 4.2K5)에서 브레이크포인트(ProtocolModule.gpl:2029, `commRoutine`)로
`OpCommandRunThread1`을 정지시키고 1402로 `Show Variable`을 수동 검증(§1-P가 실기기 미검증 상태였음).

### 실기기 캡처로 확인된 사실 (2026-07-22)

1. **객체 헤더는 `cmd, Object Command`처럼 타입에 클래스명이 붙는다** — 공식 문서 예시(`Loc, Object`)와 다름.
   기존 `_classifyVarEntry`가 `/^object$/`(정확 일치)라 실기기 응답이 **simple로 오분류 → 트리 확장 불가**(버그).
2. **객체 덤프는 스칼라 필드만 나열한다**: private 필드(`m_cmd`, `m_rawArg` 등) 포함 7줄이 왔으나,
   **배열 필드(`m_rawArgs() As String`)는 목록에서 통째로 빠짐**. 프로퍼티(cmd/cmdCode 등 no-arg get)도 안 옴.
3. **프로퍼티/메서드 참조는 콘솔 평가 불가 — 인자 유무 무관**: `cmd.ints(0)` → `-780`,
   클래스 프로퍼티 `robotIndex`(getWafer 프레임에서 bare 이름) → `-780`. 즉 이 펌웨어의
   -eval은 **필드/로컬만** 평가한다(공식 문서의 "no-arg get property 표시"와 다름).
4. **-729 = 해당 프레임 스코프에 없는 이름**: 다른 프레임의 로컬(`robotArmList`를 프레임 0에서),
   객체의 배열 필드(`cmd.m_rawArgs(0)`) 모두 -729. **프레임별 스코프가 정확히 분리**되어
   같은 이름이 프레임 3/4에선 로컬 Integer, 프레임 1/2에선 프로퍼티(-780)로 해석된 사례 확인.
5. 실용 우회: 인덱스 프로퍼티 값은 원본 필드로 읽는다 — `cmd.m_rawArg = "7,6"` → `ints(0)=7, ints(1)=6`.
6. `Show Stack` 프레임/브레이크포인트 hit, 문자열 값 속 쉼표(`"7,6"`) 보존은 §1-P 파서 가정대로 동작.
7. **객체 배열 형식(moveToReady 프레임 실측)**: 배열 전체는 `armList, Object() null`
   (값/멤버 없음 — 요소는 인덱스로만 조회), 요소는 `armList(0), Object() RobotArm` +
   **필드 멤버 줄 동봉**(RobotArm 31개 필드 전부 확인, 프로퍼티는 역시 미포함).
   → `classifyVarEntry`에 `hasMembers` 인자 추가: `Object(…)` 꼴은 멤버 동봉이면 요소 객체,
   아니면 배열로 분류(멤버 없이는 타입 문자열만으로 구분 불가). `arrayRank`도 괄호 뒤
   클래스명 형식(`Object(,) null`) 대응. 헤더 표시는 `null` 제거(`Object() 배열`).
8. `Show Global`은 **모듈 레벨 전역 전용** — 로컬/파라미터는 프레임과 무관하게 -729.
   (같은 이름이 프레임마다 다르게 해석되는 것은 4번의 프레임 스코프 규칙.)
9. **변수 인덱스는 네이티브 지원**: `armList(i)` 성공(i=0, `armList(0)`과 동일 덤프,
   멤버 이름은 입력식 그대로 `armList(i).m_…`로 echo). §1-W의 인덱스 치환 로직은
   순수 폴백으로만 동작. (인덱스 안 산술식 `x-1` 등은 미확인.)
10. **점 표기 멤버 식은 -eval이 아예 거부한다**: `readyLoc.extraZ2`(필드) → -729,
   프로퍼티는 -780. 멤버 값은 **부모 객체 덤프에 실려 올 때만** 확인 가능하고,
   중첩 객체 멤버(`readyLoc.m_loc, Object Location`)는 존재만 표시되며 **더 내려갈 방법이
   없다**(공식 문서 "referenced objects show only their presence"의 실체).
   → 확장 대응(§1-Y): 점 표기 식이 실패하면 부모를 덤프해 멤버 줄에서 값을 추출하는
   폴백(`_queryVariableStructuredSmart` ③), 중첩 객체 펼침 실패 시 안내 행 표시.

### 조치

- **`src/debug/showVariableParser.ts` 신설(순수 모듈)**: `_parseShowVariableMulti`/`_splitVarLine`/
  `_classifyVarEntry`/`_arrayRank` + `ParsedVarEntry`를 gplDebugSession에서 추출. 단위 테스트 가능해짐.
- **분류 수정**: 배열 헤더 판정을 먼저 한 뒤 `/^object\b/`(접두 단어 일치)로 객체 판정 —
  `Object Command`(실기기)와 `Object`(문서) 모두 수용, `Object Xxx()` 배열 오분류 방지.
- **표시 개선**: Variables/hover의 객체 값에 클래스명 노출(`Object Command`), REPL 객체 헤더도 동일.
- **에러 안내**: `_queryVariableStructured`가 실패 STATUS(코드/메시지)를 동봉, `_formatEvalError`가
  -780(인자 있는 프로퍼티 미지원)/-729(접근 불가 심볼)를 사용자 문구로 변환. hover/watch는
  **Show Global 폴백까지 실패한 뒤에만** 표시(-729가 타 모듈 전역일 수 있어 순서 중요). REPL은
  비접두사 폴스루 거부 메시지에 원인 첨부.
- `src/test/showVariableParser.test.ts` 신설: 실기기 캡처를 픽스처로 7케이스(객체 덤프 8줄 파싱,
  `Object Command` 분류, 배열/요소/차원, 에러 STATUS, 쉼표 보존).

### 검증

- `npm test` 149/149 통과(신규 7 포함), `npm run compile` 정상.
- **실기기 UI 검증은 VSIX 재설치 후 필요**: Variables에서 `cmd` 펼침(멤버 7개), hover/Watch 트리,
  Watch에 `cmd.ints(0)` 입력 시 -780 안내 문구 표시 확인.

### 남은 일

- [ ] VSIX 재설치 후 UI 검증(위). 로컬 배열(`tempStrSplitBuf` 등) 펼침·30개 상한·중첩 객체(`cmdResponse`)는 여전히 미검증(§1-P 잔여).
- [ ] `cmd.m_cmd`(객체의 스칼라 필드 직접 식)·`cmd.rawArg`(no-arg 프로퍼티) 콘솔 평가 가능 여부 실기기 확인 —
  가능하면 배열 필드 안내 문구를 더 정확히 조정.

### 변경 파일

- `src/debug/showVariableParser.ts`(신설), `src/debug/gplDebugSession.ts`(파서 위임 + 분류/표시/에러 안내),
  `src/test/showVariableParser.test.ts`(신설), `src/test/index.ts`(+1 import).

## 1-V. 2026-07-22 세션 — 디버깅 중 엉뚱한 폴더 파일이 열리는 문제 수정 (소스맵 경합 해소)

### 증상 (사용자 보고 — 엉뚱한 폴더 열림)

디버깅 중 정지/스텝 시 가끔 엉뚱한 폴더의 파일이 열림. 워크스페이스:
`C:\SVN\pa\...\시뮬레이션\projects` (프로젝트 사본/백업 폴더 다수 포함).

### 원인

1. `_sourceFileMap`이 **베이스네임 → 경로 1개**라서 동명 .gpl이 여러 개면(사본 폴더,
   다른 프로젝트) **스캔 순서상 마지막 파일이 조용히 덮어씀** → 제어기 파일명을 엉뚱한
   로컬 파일로 매핑.
2. `_scanDir`이 dot 폴더를 안 걸러 **`.history`(Local History 확장)의 stale 사본**까지
   인덱싱 (`_findFiles`에는 같은 이유의 스킵이 이미 있었는데 소스맵 쪽만 누락).
3. 부수: Globals 패널 열거가 이 맵을 순회해 **다른 프로젝트/사본의 전역까지 혼입**.

### 조치

- `responseParser.ts`에 **`pickSourceCandidate(candidates, projectDirs)` 순수 함수** 추가:
  ① 디버그 대상 프로젝트 폴더(Project.gpr 위치) 하위 우선 → ② 얕은 경로 우선(사본은 대개
  하위 폴더) → ③ 사전순(결정적). 모호하면 `ambiguous` 목록 반환.
- `gplDebugSession.ts`:
  - `_sourceFileMap`을 `Map<string, string[]>`(후보 전부 보존)로 변경, `_scanDir`에
    dot/`dist`/`bin` 스킵 추가(`_findFiles`와 동일 규칙).
  - attach 시 `_updateProjectDirs()`: `_projectName`과 이름이 일치하는 Project.gpr 폴더들을
    수집(경합 우선순위 기준). 명시적 projectName(launch.json)·자동 감지 모두 커버.
  - `_resolveSourcePath` → `_pickSourcePath`: 경합 시 위 함수로 선택, **모호하면 베이스네임당
    1회 경고 로그**(선택/제외 경로 + 사본 정리·projectName 안내).
  - Globals 열거: 프로젝트 폴더를 알면 그 밖의 소스는 제외(타 프로젝트 전역 혼입 방지).

### 검증 (§1-V)

- `npm test` 154/154 통과(신규 pickSource 5케이스 포함), `npm run compile` 정상.
- 실기기: VSIX 재설치 후, 사본 폴더가 있는 워크스페이스에서 브레이크 정지 시 올바른
  프로젝트 폴더의 파일이 열리는지 + 디버그 로그의 "동명 소스 경합" 경고 확인.

### 변경 파일

- `src/controller/responseParser.ts`(+pickSourceCandidate), `src/debug/gplDebugSession.ts`
  (소스맵 후보화 + `_updateProjectDirs`/`_pickSourcePath` + Globals 범위 제한),
  `src/test/projectSelection.test.ts`(+5).

## 1-W. 2026-07-22 세션 — 디버그 hover에서 `armList(i)` 같은 인덱스 식 평가 지원

### 요청/배경

사용자: "hover 시 `armList(i)`도 표시 가능하지 않나? `i`가 뭔지 디버거가 아는데."
확인 결과 **EvaluatableExpressionProvider가 없어** VS Code가 커서 밑 단어(`armList`)만
어댑터로 보내고 있었음 — 식 자체가 전달되지 않는 구조였다.

### 조치

- **`GPLEvaluatableExpressionProvider` 신설**(`src/providers/evaluatableExpressionProvider.ts`,
  extension.ts에 등록): 커서 위치에서 체인+인덱스 식(`armList(i)`, `armList(i).isCanFlip`)을
  구성해 디버그 hover 평가식으로 제공.
  - **안전 규칙(중요)**: `-eval`은 Sub/Function도 **실행**한다(공식 문서). 따라서
    ① 커서 이름이 Sub/Function이면 디버그 hover 차단(undefined) — 기본 동작이 파라미터 없는
    Sub 이름을 -eval로 보내 실행할 수 있던 기존 위험도 함께 제거.
    ② 괄호 그룹은 그 이름이 **변수/파라미터로 확인될 때만** 포함(호출식 hover 실행 방지).
    미확인이면 단어만(기존 동작).
  - 판별: 현재 문서를 `includeLocals/includeParameters`로 온디맨드 파싱(메모이즈 캐시) —
    워크스페이스 SymbolCache는 로컬/파라미터를 인덱싱하지 않기 때문. 크로스파일 프로시저는
    SymbolCache `findAllByName`으로 보강.
- **어댑터 인덱스 치환 재시도** `_queryVariableStructuredSmart`(hover/watch/REPL 경로):
  원식 조회 실패 시 괄호 안 식별자(`i`, `obj.idx`)를 개별 조회해 **정수 값으로 치환한 식**
  (`armList(3)`)으로 1회 재시도. 제어기가 변수 인덱스를 직접 평가하면 첫 조회로 끝난다.
  트리 확장/Watch 추가는 치환된 식(resolvedExpression)을 사용.
- 순수 함수는 `cursorExpression.ts`에: `extractDebugExpressionAt`/`buildDebugExpression`/
  `extractIndexIdentifierTokens`(중첩 괄호·문자열은 치환 불가)/`replaceIndexIdentifierTokens`.

### 검증 (§1-W)

- `npm test` 161/161 통과(신규 7: 식 추출 4 + 토큰 추출/치환 3), `npm run compile` 정상.
- 실기기 미확정 항목: **제어기 콘솔이 변수 인덱스(`armList(i)`)를 직접 평가하는지** —
  직접 되면 치환 경로는 폴백으로만 동작. 아래 남은 일 참조.

### 남은 일 (§1-W)

- [ ] VSIX 재설치 후: `armList(i)` hover(요소 값/트리), `armList(i).isCanFlip` hover,
  Watch에 `armList(i)` 추가, Sub 이름 hover 시 디버그 팝업 차단(언어 hover는 유지) 확인.
- [x] 실기기 1402 확인 완료(§1-U 사실 7~10): 변수 인덱스 네이티브 지원(`armList(i)` 성공),
  객체 배열 헤더 `Object() null`/요소 `Object() RobotArm`+멤버 동봉, 점 표기 멤버 식은
  -729/-780 거부(부모 덤프 폴백으로 대응, §1-Y).

### 변경 파일 (§1-W)

- `src/providers/evaluatableExpressionProvider.ts`(신설), `src/extension.ts`(등록),
  `src/language/cursorExpression.ts`(+4 순수 함수), `src/debug/gplDebugSession.ts`
  (+`_queryVariableStructuredSmart`, hover/REPL 경로 전환), `src/test/cursorExpression.test.ts`(+7).

## 1-X. 2026-07-22 세션 — Globals 패널 표시 지연 진단·개선

### 증상/진단

사용자: "글로벌 변수 표시가 왜 느리냐". 구조 분석 + 실측:

- Globals 열거 = 프로젝트 .gpl 전부 read+parse(MergeCode 63파일 실측 ~290ms). 파서 메모이즈
  LRU 상한 32 < 63파일이라 **매 요청 전량 캐시 미스**.
- 전역 1개당 직렬 1402 왕복 **최소 1회, 최대 3회**(-eval → `Show Global Module.name` →
  `Show Global name`). MergeCode 전역 42개 실측 → 정지마다 42~126회 직렬 왕복.
  1402는 단일 명령 스트림이라 병렬화 불가, Show Thread 폴링·Locals 조회와 큐 경쟁.
- **실기기 확인: `Show Global`은 인자 필수(-205)** — 전역 전체를 한 번에 받는 형식 없음
  (`Show Global` / `Show Global , MergeCode` 모두 -205). 스레드 정지 여부와 무관.

### 조치 (§1-X)

- **A. 조회 방식 메모** `_globalQueryMemo`(세션 유지, 소스맵 재구축 시 리셋):
  전역별로 성공한 방식('eval' / 'global'+이름 / 'none')을 기억 —
  다음 정지부터 전역당 1회 왕복. 'global' 방식이 실패로 바뀌면 메모 삭제 후 다음 정지에서
  전체 사다리 재시도. 'none'(전부 실패)은 폴백 생략(–eval 1회만 재시도).
- **C. 열거 캐시** `_globalDescriptorsCache`(소스맵 세대당 1회 계산) +
  `gplParser._parseCacheMax` 32→128(63파일×옵션 2종 커버).
- `_readGlobalValue`를 `_readGlobalValueSingle`(1회 조회)로 분해해 메모 직행 경로에 사용.
- 미적용(후속 옵션): 모듈별 그룹 노드로 지연 조회(B) — 42개가 더 늘어나면 검토.

### 검증 (§1-X)

- `npm test` 161/161, `npm run compile` 정상.
- 실기기: VSIX 재설치 후 Globals 패널 첫 펼침(사다리 학습) 뒤 **두 번째 정지부터 체감 단축**
  확인. 스크래치 스크립트 `countGlobals.js`(세션 스크래치패드)로 42개 산출.

### 변경 파일 (§1-X)

- `src/debug/gplDebugSession.ts`(_globalQueryMemo/_globalDescriptorsCache/_readGlobalValueSingle),
  `src/gplParser.ts`(_parseCacheMax 128).

## 1-Y. 2026-07-22 세션 — 실기기 추가 검증 반영: 객체 배열 분류 + 점 표기 멤버 폴백

### 배경 (§1-Y)

사용자 실기기 테스트 계속: ① `armList` 객체 배열 덤프 성공(§1-U 사실 7),
② `readyLoc.extraZ2` 개별 조회 -729 발견(§1-U 사실 9 — 점 표기 멤버 식 미지원).

### 조치 (§1-Y)

- **객체 배열 분류 수정**: `classifyVarEntry(entry, hasMembers)` — `Object(…)` 꼴 타입은
  멤버 동봉이면 요소 객체, 없으면 배열. (기존엔 `Object() null`이 object로 오분류 →
  Variables에서 배열 펼침이 빈 트리가 될 뻔.) `arrayRank`는 첫 괄호 그룹 기준으로 변경,
  배열 표시값에서 ` null` 제거. 호출부 5곳에 멤버 유무 전달.
- **점 표기 멤버 폴백**: `_queryVariableStructuredSmart`에 ③단계 추가 — 점 표기 식 실패 시
  부모 객체를 덤프(부모는 ①②로 해석 — `armList(i).m_armIndex`도 커버)해 멤버 줄에서 값
  추출. 깊이 1 제한(중첩 객체 멤버는 덤프에도 값이 없음). hover/Watch/REPL 모두 적용.
- 중첩 객체 expand 실패 시 `(값) (undefined)` 대신 "중첩 멤버 개별 조회 미지원" 안내 행.
- -729 안내 문구를 점 표기 케이스 포함으로 갱신.
- **프로퍼티 이름 hover 차단**(후속, 같은 날): `cmd.ints(0)`의 `ints` 위 hover가 단어 평가로
  폴백돼 엉뚱한 -729 팝업이 뜨던 것 → provider의 차단 대상에 `Property` 추가(사용자 스크린샷
  제보). 인자 있는 프로퍼티 값은 원천 조회 불가(백킹 배열도 덤프 제외) — `cmd` 덤프의
  `m_rawArg`로 확인하는 것이 유일한 우회. `cmd.ints`(인자 누락) → -205도 실측 기록.
- **null 참조 무한 트리 수정**(후속, 같은 날, 사용자 스크린샷 제보): `Dim armList(1)`처럼
  일부만 채운 객체 배열에서 빈 요소가 `armList(1), Object() null`(null 참조)로 오는데,
  "Object(…)+멤버 없음=배열" 규칙이 이를 배열로 오분류 → **제어기가 null 인덱싱
  (`armList(1)(0)`)도 null 성공으로 응답**해 가짜 30요소 null 배열이 무한 재귀했다.
  → `classifyVarEntry`: 이름에 인덱스/점이 있는 응답의 `Object(…) null`은 simple(값 `null`
  표시), 클래스명이 있으면 object(재조회로 덤프 확보). 배열 헤더(맨몸 이름)만 array 유지.
  Variables/hover/REPL에 null 값 표시 추가. 테스트 165/165(+1).

### 검증 (§1-Y)

- `npm test` 164/164(실기기 캡처 픽스처 3건 추가: `Object() null`/`Object() RobotArm`/rank).
- 실기기(VSIX 재설치 후): Variables에서 `armList` 펼침 → `(0)` 요소 → 필드 31개 트리,
  Watch에 `readyLoc.extraZ2` 입력 → 부모 덤프 폴백으로 값 표시(디버그 로그 "부모 덤프 폴백" 확인).
- ~~여전히 미확정: 변수 인덱스 직접 평가~~ → **확정: 네이티브 지원**(같은 날 실기기,
  §1-U 사실 9). 치환 로직(②)은 폴백으로만 동작.

### 변경 파일 (§1-Y)

- `src/debug/showVariableParser.ts`(classifyVarEntry hasMembers/arrayRank),
  `src/debug/gplDebugSession.ts`(Smart ③ 부모 덤프 폴백, expand 안내, 호출부 멤버 유무 전달),
  `src/test/showVariableParser.test.ts`(+3).

## 1-Z. 2026-07-23 세션 — 0.8.0 릴리즈 메타데이터 정리 + 검증/패키징

### 배경

사용자 요청으로 `0.7.12` 개발 버전을 `0.8.0` 릴리즈로 승격. 현재 저장소는 `npm run package`가
항상 patch bump를 수행하므로, minor 릴리즈는 **버전을 먼저 고정한 뒤** `package:no-bump`로 패키징해야 함.

### 조치

- `package.json` 버전을 `0.8.0`으로 상향.
- `CHANGELOG.md`의 `Unreleased` 항목을 `## [0.8.0] - 2026-07-23` 릴리즈 섹션으로 승격.
- `README.md` 상단 현재 버전과 주요 변경 이력의 현재 섹션을 `0.8.0` 기준으로 정리.
- 이 인계 문서 헤더의 최종 갱신/현재 package 버전을 릴리즈 상태와 일치하도록 갱신.

### 릴리즈 검증 절차

- 로컬 검증 순서: `npm run compile` → `npm run pre-release-check` → `npm run package:no-bump`
- 패키징 성공 시 `dist/gpl-language-support-0.8.0.vsix` 산출.
- 이후 git commit + `v0.8.0` 태그 생성.

### 릴리즈 후속 작업

- [ ] 원격 push 및 GitHub Release/Actions 결과 확인.

## 1-AA. 2026-07-23 세션 — 버전/커밋/태그/릴리즈 운영 문서 정리

### 문서화 배경

기존 `docs/releases/quick-guide.md`와 `docs/releases/process.md`에 현재 스크립트 구현과 어긋나는 내용이 있었다.
특히 `npm run package`가 항상 patch bump를 수행한다는 점, `minor/major` 릴리즈에서 `package:no-bump`를
써야 한다는 점, `pre-release-check`가 clean working tree를 요구한다는 점이 충분히 드러나지 않았다.

### 문서화 조치

- `docs/releases/quick-guide.md`를 현행 기준으로 다시 작성.
  - 로컬 테스트용 VSIX / 공식 patch 릴리즈 / 공식 minor·major 릴리즈 / 프리릴리즈를 분리해 설명.
  - `npm run package` vs `npm run package:no-bump` 차이를 첫머리에 명시.
- `docs/releases/process.md`를 전면 갱신.
  - 기준 파일(`package.json`, `CHANGELOG.md`, `README.md`, `docs/ai-handoff.md`) 정의.
  - 표준 릴리즈 절차, GitHub Release 생성 흐름, 자주 하는 실수, 태그 복구 절차 추가.
  - 공식 릴리즈는 버전을 먼저 고정하고 `package:no-bump`로 패키징하는 흐름을 권장하도록 정리.

### 문서화 검증

- 실제 0.8.0 릴리즈 경험(버전 고정 → 커밋 → `pre-release-check` → `package:no-bump` → tag push)을 기준으로 서술을 맞춤.
- `Quick Release Guide` 링크를 `process.md` 기준으로 정합화.

### 문서화 후속 작업

- [ ] 다음 patch 릴리즈 때 문서 절차대로 다시 한 번 실제 검증해 drift 없는지 확인.

## 1-AB. 2026-07-23 세션 — 1403 수신 비정상 상태 문서 명시 + 릴리즈 문서 표현 정리

### 1403 문서화 배경 / 증상

- 1403 출력 이벤트 수신(실시간 로그 터미널의 `[1403]` 출력)은 여러 세션에 걸친 완화 작업
  (적응형 재연결, no-payload 샘플링, Immediate EOF 분리 등 — CHANGELOG 0.6.x~0.7.x)에도
  실기기에서 안정 동작을 확보하지 못했다. 연결은 되지만 payload가 수신되지 않는 경우가 많음.
- **사용자 결정(2026-07-23)**: 1403 개선 작업은 사실상 중단(포기). 문서에 비정상 상태를 명시하기로 함.

### 1403 문서화 조치

- `README.md`: 제어기 통합 기능 목록의 "실시간 로그 터미널" 항목에 한 줄 경고 추가,
  "실시간 로그 터미널" 절 상단에 알려진 제한 블록(1403 수신 비정상, 개선 중단, as-is 제공) 추가.
- `docs/releases/process.md`: 구어체 표현 2곳("발등 찍는다", "휑함")을 문서 톤에 맞게 수정 (같은 날 별도 요청).

### 1403 문서화 검증

- 문서 변경만 있음(코드 변경 없음).

### 1403 문서화 남은 일

- 1403 근본 원인 조사는 보류(사용자 결정). 재개할 경우 기존 완화 이력(§1-D, §1-L, CHANGELOG 0.6.x~0.7.x)부터 검토.

## 1-AC. 2026-07-24 세션 — AI Debug Assist 오케스트레이션 명령 추가

### 배경

사용자 목표: "GPL 확장만으로 AI가 PA 제어기 디버깅 루프를 직접 수행".
기존에도 `Connect/Deploy/Snapshot/Attach` 명령은 있었지만, AI가 안정적으로 같은 순서를 반복 실행할
단일 진입점이 없어서 수동 체인 호출에 의존했다.

### 조치

- `src/extension.ts`
  - 신규 명령 `gpl.ai.debugAssist` 추가.
  - 모드 선택형 오케스트레이션:
    - `진단만 (연결 + 스냅샷)`
    - `Build Only + 진단`
    - `Build Only + 콘솔`
    - `Build Only + Attach`
  - 내부 실행 순서(확장 명령만 사용):
    1) 연결 확인(`gpl.controller.connect`)
    2) 초기 상황 스냅샷(`gpl.controller.copySituationForChat`)
    3) 모드별 Build Only(`gpl.deploy`)
    4) 옵션: 콘솔(`gpl.console.start`) 또는 Attach(`gpl.debug.attachNow`)
    5) 최종 진단 스냅샷(`gpl.diagnosticSnapshot`)
  - 실행 결과를 `[AI Debug Assist]` 섹션으로 Output(`GPL Language Support`)에 구조화 기록.
- `package.json`
  - activationEvents에 `onCommand:gpl.ai.debugAssist` 추가.
  - commands에 `GPL: AI Debug Assist` 노출.
  - `view/title` 메뉴(연결 상태)에도 액션 추가.
- `README.md`
  - 명령 표/AI 진입점 섹션에 `GPL: AI Debug Assist` 문서화.
  - 버전 표기 `v0.8.1` 반영.
- `docs/development/ai-controller-debugging-runbook.md`
  - AI 오케스트레이션 빠른 경로와 명령 ID 반영.

### 검증/주의

- 본 명령은 기존 상태 변경 게이트/직렬 명령 규칙 위에서 동작한다(직접 TCP/FTP 우회 없음).
- 런북 파일 끝 공백 관련 markdown lint(`MD012`) 경고가 환경/도구 측 라인계수와 달리 남아
  추가 정리는 보류. 기능 동작과 직접 무관.

### 남은 일

- [ ] 사용자 로컬에서 `npm run compile` → `npm run pre-release-check` → `npm run package` 검증.
- [ ] 생성된 VSIX(`dist/gpl-language-support-0.8.1.vsix`) 실설치 후 `GPL: AI Debug Assist` 4개 모드 실기기 확인.

## 1-AD. 2026-07-24 세션 — AI 자율 디버깅 API/루프 추가

### 배경

사용자 요구: "AI가 Break 걸고 변수 확인하며 한 스텝씩 스스로 디버깅".
기존 `gpl.ai.debugAssist`는 오케스트레이션(연결/빌드/Attach) 중심이라, 반복 제어 루프를
직접 구성할 저수준 API가 부족했다.

### 조치

- `src/extension.ts`
  - AI 전용 디버그 API 추가:
    - `gpl.ai.debug.getState`
    - `gpl.ai.debug.setBreakpoint`
    - `gpl.ai.debug.clearBreakpoint`
    - `gpl.ai.debug.breakThread`
    - `gpl.ai.debug.stepThread`
    - `gpl.ai.debug.continueThread`
    - `gpl.ai.debug.evaluate`
    - `gpl.ai.debug.loop`
  - `gpl.ai.debug.loop`는 최대 step 수 내에서 스택 top/Watch 값을 수집하고,
    `stopWhen` 조건(`equals`/`contains`/`matches`) 충족 시 자동 중단.
  - 브레이크포인트 명령은 GDE 실측 no-space 형식(`"file"<line>`) 유지.
- `package.json`
  - 위 명령들의 activation event 및 commands 노출 추가.
- `README.md`
  - "AI 자율 디버깅 API" 섹션 추가 및 사용 예시 반영.
  - `v0.8.3` 현재 버전 표기 동기화.

### 남은 일

- [ ] 생성된 VSIX(`dist/gpl-language-support-0.8.3.vsix`) 실설치 후 아래 시나리오 실기기 검증:
  1) `setBreakpoint` → `breakThread` → `evaluate` 값 확인
  2) `stepThread(mode=over)` 반복 시 위치/값 변동 확인
  3) `loop` + `stopWhen` 조건 중단 확인

## 1-AF. 2026-07-24 세션 — 배포 경로 이원화: Deploy=/GPL 직접, Save to Flash 신설, Start 버튼 분리

### 배경 (사용자 결정)

사용자 요구 3건: ① Deploy의 기본 업로드 위치는 `ftp://<제어기IP>/GPL/<projectName>`(테스트용),
② 제어기에 영구 저장하고 싶을 때만 `ftp://<제어기IP>/flash/projects/<projectName>`에 저장,
③ Deploy와 Start는 합치지 않고 분리. §1-G의 미해결 항목 "이원화 관리 원칙"을 그대로 구현한 것.
세부 선택(사용자 확인): Deploy & Run은 독립 Start 버튼으로 교체 / Save to Flash는 FTP 복사만
(Load/Compile 없음) / /GPL 폴더 미존재 시 FTP로 생성해 직접 업로드(검증 전 경고 표시).

### 조치

- `src/controller/deployService.ts`
  - directGpl 모드에서 `/GPL/<projectName>` 폴더가 없으면 **classic 폴백 대신 FTP로 폴더를
    생성해 직접 업로드**(`directGplCreate`, 배너에 경고 출력). Load 문서 Remarks("FTP can be
    used to create the folder and copy the files")가 허용하는 공식 경로.
  - 단 **changedFiles(autoOnSave) 경로는 생성하지 않음** — 변경 파일 1개만 담긴 불완전한
    /GPL 폴더 방지, 기존 classic(flash+Load) 폴백 유지. probe 실패 시에도 classic 폴백 유지.
  - direct 모드 -508/-743 안내 문구를 "전체 배포로 재시도" → "Save to Flash 후 Unload/Load로
    복구"로 갱신(전체 배포도 이제 direct라서 이전 안내는 무효).
- `src/extension.ts`
  - `runDeployCore`: `directGpl: quickOpts?.quick` → **`directGpl: true`** — Deploy(Build Only)도
    /GPL 직접 미러 업로드 사용. classic 경로는 폴백 전용으로 유지(코드 삭제 없음).
  - **`gpl.deployRun` 제거**, **`gpl.start` 신설** — 배포 없이 `Start <project>`만 전송.
    확인 모달(`requireStartConfirmation`, §3-B B2)과 런타임 콘솔 준비(primeForRuntimeStart)는
    구 Deploy & Run의 START 단계와 동일. 프로젝트명은 .gpr에서 해석(폴더명 폴백).
  - **`gpl.saveToFlash` 신설** — `mirrorProject`로 `/flash/projects/<projectName>`에 미러 저장만
    (Stop/Unload/Load/Compile 없음, 원격 전용 파일은 삭제됨을 로그로 표시).
  - 공용 헬퍼 `pickWorkspaceProjectDir` / `readGprProjectName` 추가.
- `package.json`: commands/menus/activationEvents에서 deployRun → start(`$(play)`) 교체,
  saveToFlash(`$(save)`, view/title 오버플로 `1_deploy` 그룹 + threadSection 컨텍스트) 추가,
  deploy 타이틀을 "/GPL 업로드 + Compile, Start 없음"으로 갱신, autoStartOnDeploy·
  requireStartConfirmation 설명 문구 동기화.
- `src/debug/gplDebugSession.ts`: 폴백 관련 낡은 주석 갱신(동작 변화 없음 — F5는 원래 directGpl).
- `.github/instructions/gpl-ai-controller-debugging.instructions.md`: 명령 표/상태 변경 가드에서
  deployRun → start 교체, saveToFlash 행 추가.
- `CHANGELOG.md`: [Unreleased]에 Added/Changed 기록.

### 검증

- 샌드박스 tsc(strict) 통과 여부는 아래 기록 참조. **최종 검증은 사용자 로컬 `npm run compile`(§0.4).**
- 실기기(G2400C) 검증 필요:
  1) `/GPL/<name>`이 이미 있는 프로젝트에서 Deploy — 배너 `Mode: direct /GPL upload` + Compile 정상.
  2) **`/GPL`에 폴더가 없는 프로젝트 최초 Deploy — FTP 생성 후 Compile이 성공하는지(핵심 미검증).**
     -508/-743이면 제어기가 FTP 생성 폴더를 로드본으로 인식 못 하는 것 → Save to Flash + Load 복구
     경로 확인 후, 이 경우 최초 배포 로직을 "flash+Load 1회" 방식으로 되돌릴지 결정.
  3) `GPL: Start` — 확인 모달 → Start 전송 → 1403 콘솔 출력 확인.
  4) `GPL: Save to Flash` — /flash/projects/<name> 반영 + 로드본/실행 상태에 영향 없는지.

### 남은 일

- [ ] 위 실기기 검증 2) 결과를 이 문서에 기록(§1-G의 "/GPL 재부팅 영속성" 확인도 겸사겸사).
- [ ] Deploy가 더 이상 flash를 갱신하지 않으므로, **flash 사본이 구버전으로 남는 것이 기본 상태**가
  됨 — 릴리스/종료 전 Save to Flash 습관 필요. README/사용 문서에 이원화 원칙 안내 추가 검토.

## 1-AG. 2026-07-24 세션(후속) — AI 자율 디버깅 API 견고화 (반환 계약/Output 기록/pause 폴링)

> ⚠ 기록 주의: 이 세션과 **다른 작업 스트림(§1-AE 심볼 조회 성능 개선·§1-AF 배포 경로 이원화, 0.8.5)** 이 같은 날 병행 진행됨.
> 헤더가 참조하는 §1-AE(심볼 조회 성능 개선) 본문 섹션이 현재 파일에 없음 — 병행 편집 중 유실 가능성 있으니 해당 스트림에서 복원 필요.

### 증상/배경

§1-AD 코드 리뷰에서 자율 루프 관점의 약점 발견:
(1) 결과가 return만 되고 어디에도 기록되지 않아 `executeCommand` 반환값을 직접 받지 못하는 호출자는 결과를 볼 수 없음(§1-AC의 debugAssist는 Output 기록하는 것과 대조).
(2) `sendCommand` 예외(타임아웃 등) 시 `{ok:false}` 대신 예외가 전파되어 반환 계약 붕괴.
(3) `Break`/`Step`의 STATUS 0을 완료로 간주 — §0.6 `Stop -all`과 같은 "접수≠완료" 패턴 위험. loop는 고정 `sleep(120)` 후 바로 Show Stack이라 이전 위치를 읽을 수 있음.
(4) loop가 스레드 Error 전이를 무시하고 `-noerror`로 계속 스텝. stopWhen 평가 실패(-eval 오류)가 침묵. 잘못된 `stopWhen.matches` 정규식이 루프 중 예외로 사망.

### 조치 (의도 → 방법, `src/extension.ts`의 AI API 블록 재구성)

- **공통 래퍼 `registerAiDebugCommand`** 도입: 8개 명령 전부 try/catch로 감싸 `{ok:false, error:'command-failed', detail}` 통일 + 결과 JSON을 Output에 `[AI Debug] <commandId> => {...}`로 기록(4000자 초과 시 절단). Output만 읽는 AI도 결과 소비 가능.
- **`waitForThreadPause` 헬퍼**: `Show Thread` 폴링(기본 5000ms/150ms 간격)으로 Paused/Break/Error 진입 확인.
- **`breakThread`/`stepThread`**: `waitForPause`(기본 **true**)/`waitTimeoutMs` 인자 추가. STATUS 0 후 실제 정지까지 확인해야 `ok:true`. 미정지 시 `pause-timeout`. **ok 의미가 "접수"→"정지 확인"으로 바뀜** — 종전 동작은 `waitForPause:false`.
- **`loop`**: ① `sleep(120)` → 스텝 후 `waitForThreadPause`(인자 `stepWaitTimeoutMs`, 기본 5000ms), 미복귀 시 `step-pause-timeout`. ② 루프 도중 Error **전이** 시 `stoppedBy:'thread-error'`+`lastStatus`로 중단(시작부터 Error인 스레드는 종전대로 -noerror 스텝 허용). ③ 대상 스레드 소실 시 `thread-not-found`. ④ stopWhen 평가 결과(값/statusCode/matched)를 매 스텝 trace에 기록 — 표현식 오타 가시화. ⑤ `stopWhen.matches` 정규식은 루프 진입 전 1회 검증(`invalid-stopWhen-matches`).
- `README.md`: AI 자율 디버깅 API 섹션에 공통 규약(반환 계약/Output 기록/waitForPause/loop 동작) 및 인자 예시 갱신.

### 검증

- 샌드박스 `npx tsc --noEmit` 오류 0건, `npm test` 166/166 통과. 파일 수정은 §0.4대로 샌드박스 bash(python)로 수행(LF 유지 확인).
- 최종 검증은 사용자 로컬 `npm run compile` 필요.

### 남은 일

- [ ] 사용자 로컬 `npm run compile` → `npm run package` → VSIX 재설치.
- [ ] 실기기 검증(§1-AD 시나리오에 추가): ① `Break`/`Step` 후 `Show Thread` 상태 전이 타이밍 실측 — STATUS 0이 접수인지 완료인지 확정, 폴링 기본 5000ms 적정성 확인 ② `-eval` 응답 실측으로 `normalizeEvalValue` CSV 휴리스틱(`name,type,value` 전제) 확정 ③ Error 전이 중단 동작 확인.
- [ ] 미적용 리뷰 항목(사용자 보류): **[C]** setBreakpoint의 Show Break 재확인(verify) 옵션, loop watch에 raw 병행. **[D]** `continueThread`/`stepThread`는 실행 재개=모션 재개 가능인데 B2 게이트(`requireStartConfirmation`)가 Start에만 적용 — AI 자율 루프용 확인 게이트 도입 여부 사용자 결정 필요. **기타**: 폴링 간격/maxSteps 상한 설정화, watch·stopWhen frameIndex 0 고정 인자화, getState의 `-stack -web` 활용.

## 1-AH. 2026-07-24 세션(후속2) — 외부 AI(Claude Code) 실전 투입 관찰: MCP 미등록 → 원시 TCP 우회 (분석만, 코드 변경 없음)

### 증상 (사용자 실전 테스트, 전사 확보)

로봇 워크스페이스(MergeCode, `C:\SVN\...\시뮬레이션`)에서 Claude Code에게 "디버깅 해봐"를 지시한 결과:

1. "제어기 연결이 MCP 도구로는 안 잡히네요" → WORKLOG/파일 읽기로 후퇴.
2. 이후 PowerShell/Node **원시 TCP로 1402 직접 접속** 시도 — 프로토콜을 XML(`<COMMAND><NAME>...`)로 오추측 → 0바이트 → **설치된 확장 번들(0.8.5 out/)을 역공학**해 "평문+`\r\n`" 프레이밍 파악. "샌드박스를 해제하고 실행" 선언까지 진행.

### 원인 분석

- **MCP 미등록이 진짜 원인**: 그 워크스페이스의 `.vscode/mcp.json`은 VS Code(Copilot)용이라 **Claude Code는 읽지 않음**. Claude Code용은 `claude mcp add` 또는 프로젝트 루트 `.mcp.json`. gpl-controller MCP가 세션에 없었음.
- **가드레일 부재**: "직접 TCP로 확장 경로 우회 금지" 규칙은 이 저장소(README/런북)에만 있고 **로봇 워크스페이스의 CLAUDE.md에는 없음**. AI는 그쪽 CLAUDE.md를 최우선으로 읽는다는 것이 전사로 확인됨. 원시 소켓에는 직렬 큐·Stop 게이트·확인 모달이 전혀 없어 역공학 중 Start류 명령 전송 시 모션 위험.
- (참고) `gpl.ai.debug.*`는 VS Code `executeCommand` 전용이라 터미널 AI는 호출 불가 — 외부 AI의 정규 경로는 controller-mcp뿐(§1-AG [A]에서 지적한 공백의 실전 재현).

### 다음 세션 개선 계획 (효과 순, 사용자 승인 전 — 착수 시 이 목록에서 선택)

- [ ] **① 로봇 워크스페이스 AI 가이드**: MergeCode 쪽 CLAUDE.md에 "제어기 통신은 gpl-controller MCP만 사용 / 직접 TCP 금지(모션 위험) / 미등록 시 `claude mcp add` 방법" 섹션 + 프로젝트 루트 `.mcp.json`(Claude Code용) 추가. ※ 해당 폴더는 이 저장소 밖 — 템플릿을 만들어 사용자가 배치.
  - 진행(2026-08-05): **① 완료.** `.mcp.json`을 시뮬레이션 워크스페이스 루트에 배치(이 저장소의 `controller-mcp/src/index.js` 절대경로 참조, HOST 192.168.0.1/PORT 1402/PROJECT MergeCode), 서버 단독 기동 stderr `ready` 확인. 로봇 워크스페이스 CLAUDE.md에 §7(제어기 통신 — MCP만 사용/직접 TCP 금지/STATUS 판정/디버그 흐름/안전 규칙/동시 접속 주의/1403 미지원 안내) 추가. 남은 검증: 사용자가 해당 워크스페이스에서 Claude Code 재시작 → `.mcp.json` 승인 → `/mcp` 연결 확인. 배경: 사용자가 로봇 워크스페이스에서 `controller-mcp`를 `cd`+`npm start`로 직접 실행 시도 → 그 폴더에 없어 ENOENT(§1-AH 증상 재현).
- [x] **② 확장 명령 `GPL: Export AI Agent Setup`**: **완료(2026-08-05, §1-AN)** — esbuild 단일 파일 번들을 VSIX에 동봉하고, 명령이 globalStorage 복사 + `.mcp.json` 병합 생성 + CLAUDE.md 가드 섹션 upsert를 수행. 상세·남은 검증은 §1-AN.
- [ ] **③ controller-mcp 디버깅 도구 패리티**: 현재 compile·run 중심 → `gpl.ai.debug.*`와 동일 규약(no-space BP, pause 폴링, STATUS 판정, §1-AG 견고화 규칙)으로 setBreakpoint/step/evaluate/loop 도구 추가.
- [ ] **④ 완화책**: controller-mcp connect backoff 재시도(확장 트리 폴링 5s와의 1402 순간 충돌 대비 — 확장/MCP 모두 connect-per-command라 상시 점유는 아님).

## 1-AI. 2026-07-28 세션 — src/ 전체 가독성 정리 (동작 불변 리팩터링만)

### 배경/의도

사용자 요청 "전체 코드 가독성 개선". 병렬 리뷰(4개 탐색 에이전트)로 후보 약 100건 수집 후, **동작 불변이 확실한(SAFE) 항목만 적용**. 프로토콜 명령 문자열·타임아웃·재시도 횟수·정규식 의미·STATUS 판정 로직은 일절 변경하지 않음.

### 조치 (파일별 요약)

- `src/xmlUtils.ts`: 어디서도 호출되지 않던 XML 분석기 절반(`analyzeXmlEncoding` + private 헬퍼 9개 + 인터페이스 3개 + `getXmlBestPractices`, 약 250줄) 삭제. `getXmlCodeSnippets`만 잔존 (303→55줄). 실제 XML 진단은 diagnosticProvider/gplParser 담당(주석으로 명시).
- `src/extension.ts`: 죽은 함수 `logConsole`/`logTraffic` 삭제, 미사용 import(`getTrafficChannel`) 제거, `sendCommandWithBusyRetry`의 항상-undefined `config` 파라미터 제거(호출 7곳 정리). 중복 통합: `confirmDirectorySuggestion`(Directory 제안 모달 2곳), `currentRuntimeConsoleStatus()`(idle 스냅샷 리터럴 3곳), `stopRuntimeConsoleAndSyncTree()`(3곳), runDeployCore 인라인 프로젝트 선택 → 기존 `pickWorkspaceProjectDir` 재사용. 상수화: `RECENT_DEBUG_LOG_MAX=240`, `SETTLED_THREAD_STATE` 정규식(deployService.threadSettled와 동일 유지 주석 포함). `AI_PAUSED_STATES` 인라인 중복 1곳 통일, `(vscode.debug as any)` 캐스트 제거, 인라인 `require('fs')` → 상단 import 사용, no-op `gutterIconPath: undefined` 제거.
- `src/controller/deployService.ts`: `void`로만 소비되던 `hasCompileSuccessful`/`hasCompilePassLog` 삭제(판정 로직 자체는 §1-A 그대로), 반환 타입의 항상-false `needsFollowUp` 필드 제거, 미사용 import `isSuccess` 제거.
- `src/controller/responseParser.ts`: **`NO_STATUS_CODE = -9999` 상수 export**(deployService/gplDebugSession의 하드코딩 3곳 교체), XML 태그 제거 정규식 4곳 → `stripXmlTags()` 헬퍼, 잘못된 위치의 `parseThreadList` JSDoc을 함수 위로 이동, `let`→`const` 1곳.
- `src/debug/gplDebugSession.ts`: import 블록 사이에 끼어 있던 코드 정리(모든 import를 상단으로), 미사용 `GPLSymbol` import·죽은 `_readGlobalValue` 삭제. 상수화: `UNDEFINED_VALUE='(undefined)'`(8곳), `CONTINUE_PAUSED_CONFIRM_COUNT=3`(3곳). 중복 통합: `_showGlobalResponseLines()`(STATUS 제거+라인 분리 2곳), `_isSkippedScanDir()`(_scanDir/_findFiles 공용 제외 규칙). 낡은 주석 정정(_parseShowVariableEval 문서가 이미 showVariableParser로 옮겨진 STATUS 처리를 자기 일로 서술하던 것 등), `_makeVariable`의 no-op 삼항 else(`: entry.value`→`: ''`, value는 string이라 동작 동일).
- `src/controller/runtimeConsole.ts` / `controllerConnection.ts`: `IMMEDIATE_EOF_SESSION_MS=500` 상수화, 타임스탬프 포맷 중복 → `formatTrafficTimestamp()` export 공용화.
- `src/providers/*`: codeAction(죽은 로컬 2개·미사용 파라미터 제거, 본문이 동일해진 메서드 2쌍 통합), completion(`isXmlContext` 미사용 파라미터 제거), reference(`shouldSkipAsDeclaration`를 사용처 앞으로 이동, cache 폴백의 dedupe 인라인 → `addLocation` 재사용, `MAX_SEARCH_RESULTS`/`MAX_FOLDER_FALLBACK_FILES` 상수화, 오해 소지 로그 문구 수정), definition(`fileNameOf()` 헬퍼로 7곳 통일, 중복 Location 생성 → `buildLocation` 재사용), hover(`buildCallableSignature()` 추출), diagnostic(루프 한복판의 tombstone 주석을 메서드 doc으로 이동).
- `src/views/controllerTreeProvider.ts`: 미사용 public `getExpectedProjectFolderName` 삭제, 상태 초기화 8줄×2 → `clearCachedControllerState()`, 쓰레드 집계 4줄×2 → `countThreadStates()`, FTP 섹션 빌더 2벌 → `buildFtpSection()` 공용화, 폴링 상수화(`DEFAULT_THREAD_POLL_MS`/`IDLE_POLL_MULTIPLIER`/`DETAIL_POLL_MULTIPLIER`/`CONNECTION_LOSS_FAILURE_THRESHOLD`) + `baseThreadPollIntervalMs()`.
- `src/views/controllerDashboardPanel.ts`: no-op `case 'setInterval'` 제거(주석으로 의도 보존). `src/log/liveLogTerminal.ts`: 터미널을 dispose하지 않는 `disposeLiveLogTerminal` → `resetLiveLogTerminalState`로 개명.
- `src/gplParser.ts`: 494줄 `parseDocumentUncached` 축소 — 캡처 없는 `extractParamName`을 private static으로 이동, 바이트 동일하던 파라미터 심볼 등록 블록 2벌 → `pushParameterSymbols` 클로저, 수식어 추출 2벌 → `procedureModifiers()` static. `this.`/`GPLParser.` 혼용 4곳 통일, `XML_BODY_SCAN_LINES=50` 상수화, includeLocals 도입 이후 낡아진 "로컬은 인덱싱 안 함" 주석 3곳 정정. **파싱 정규식은 무변경.**
- `src/symbolCache.ts`: 후보 수집 루프 중복 2쌍 → `findMemberCandidatesInClass`/`findMemberCandidatesInModule`를 정본으로 재사용, `scoreFilePath` 점수 상수화(1000/800/500/0), `INDEX_EXCLUDE_GLOB` 상수화, 거짓 로그("GPL/GPO 검색 중..." — 실제로는 *.gpl만, 이미 완료 후 출력) 정정, 불필요한 `(file as vscode.Uri).fsPath ?? String(file)` 방어 캐스트 정리.
- `src/config.ts`: hover 기본값 3종 상수화(폴백 이중 표기 제거), `!== false` 가드에 의도 주석, `GPL_CONTROL_KEYWORDS` doc이 실제 내용(선언 키워드·리터럴 포함)과 맞게 정정. `src/gplBuiltins.ts`: `normalize` → `normalizeBuiltinName` 개명.

### 검증

- 샌드박스 `tsc --noEmit` exit 0, `tsc -p .` 후 `node ./out/test/index.js` **166/166 통과**.
- §0.4 규칙대로 **사용자 로컬 `npm run compile` 최종 확인 필요** (이번 세션은 호스트 도구로 편집했고 샌드박스 무결성 tail 검사는 통과).
- 실기기 영향 가능 경로(1402/1403 명령·배포·디버그 스텝)는 문자열/타이밍 무변경이므로 회귀 위험 낮음. 단 `gpl.controller.disconnect`/`console.stop`/연결유실 경로가 공용 헬퍼를 타므로 한 번의 연결-해제 스모크 테스트 권장.

### 미적용 (리뷰에서 나온 LOW/RISKY 후보 — 원하면 다음 세션에)

- 대형 함수 분해: `runDeployCore`(~330줄), `ftpRun` 핸들러(~280줄), `referenceProvider.provideReferences`(~460줄), `controllerTreeProvider.buildRoot`(~340줄), `definitionProvider.provideDefinition`(~280줄), `gplParser.parseDocumentUncached`의 로컬/멤버 선언 분기 추출.
- `gplDebugSession`: step 3종(next/stepIn/stepOut) 공통화, `_findFiles`의 오해 소지 `await`(제거 시 마이크로태스크 1틱 변화), `isPathUnder` 중복(responseParser와 파일 간 공유 필요).
- extension.ts: `console` 지역변수가 전역 console을 가리는 8곳 개명, `gpl.console.start`/`ensure` 본문 공통화, threadStop/ftpStop 핸들러 공통화, 미사용 export `logMessage` 삭제(공개 API 표면 변경).
- 기타: `controllerConnection.getSessionControllerOverride`(미사용 export) 삭제 여부, `symbolCache.findMemberInModule`(미사용 public) 삭제 여부, diagnostic source 문자열 상수 공유(11곳+codeAction 2곳), documentSymbol/workspaceSymbol의 동일 `getSymbolKind` 공용 모듈화, `gplBuiltins`의 sourceUrl 접두사를 `GPL_DICTIONARY_ROOT_URL +`로 조립(~45곳), treeItem에 대한 probably-dead `(item as any).remotePath` 스탬핑 2줄(실기기에서 FTP 컨텍스트 메뉴 확인 후 제거).

## 1-AJ. 2026-07-28 세션(후속) — GPL Controller 뷰 타이틀 툴바 재구성 (package.json만)

### 배경/의도

사용자 판단: 타이틀 바 버튼 9개는 과다. 자동 새로고침·디버그 자동 Start·디버그 콘솔 `>` 프리픽스로 대체되는 버튼이 많음. **명령 삭제 없이 `menus.view/title`의 `group`만 변경** — `navigation@N`(아이콘 버튼) ↔ 일반 그룹(`...` 오버플로 메뉴) 이동이라 되돌리기 쉬움.

### 조치 (`package.json` `contributes.menus.view/title`)

- 타이틀 바 유지: `connect`(미연결 시)·`stopAll` @1, `quickCompile` @2(구 @5), `start` @3(구 @5).
- `...` 오버플로로 이동: `deploy` → `1_deploy@0`(saveToFlash@1 위 — 전체 동기화·최초 배포용으로 존치), `refresh` → `2_tools@1`, `sendCommand` → `2_tools@2`(비디버그 상태에선 여전히 유일한 명령 전송 UI), `diagnosticSnapshot`/`ai.debugAssist`/`showTraffic` → `3_diag@1~3`.
- 판단 근거: deploy(Stop+전체 업로드)와 quickCompile(변경분만, STOP 생략)은 기능이 다르므로 deploy는 삭제하지 않고 강등만. refresh·showTraffic은 트리 항목 inline 버튼(section-threads / runtimeConsoleItem)이 이미 있어 타이틀 바 제거로 손실 없음. start는 디버그가 자동 Start 하지만(비디버그 실행용) 사용자 결정으로 타이틀 바 유지.

### 검증

- 샌드박스 python `json.load` 파싱 정상, view/title 11개 항목 그룹 값 전수 확인. 코드(src) 무변경이라 compile 불필요.
- **남은 확인**: VS Code 재시작(또는 VSIX 재설치) 후 타이틀 바에 stopAll·quickCompile·start 3개(+미연결 시 connect)만 보이고 나머지가 `...` 메뉴에 있는지 육안 확인.

### 남은 일

- 패키징·배포 시 CHANGELOG.md에 툴바 재구성 항목 추가.

## 1-AK. 2026-07-28 세션(후속2) — 확장 트리 ↔ 디버그 패널 쓰레드 기능 병합

### 배경/의도

사용자 관찰: 확장 트리(gplThreads)와 디버그 패널(CALL STACK)의 쓰레드가 클릭/우클릭 동작이 서로 달라 혼란. 요구: 어느 정도 기능 병합.
과정에서 확인한 사실: CALL STACK 쓰레드 우클릭 메뉴(일시 중지/스텝/스레드 종료)는 **VS Code 기본 DAP 메뉴**이고, 일시 중지·스텝은 이미 어댑터가 쓰레드 단위 처리 중이었으나 **"스레드 종료"는 `terminateThreadsRequest` 미구현으로 동작하지 않는 상태**였다. 처음엔 `debug/callstack/context` 커스텀 메뉴("GPL: 이 쓰레드 Stop")로 접근했다가, 기본 메뉴와 중복되어 **표준 DAP 구현으로 방향 전환** (커스텀 명령은 도중 제거, package.json 기여 없음).

### 조치

- `src/debug/gplDebugSession.ts`:
  - `initializeRequest`: `supportsTerminateThreadsRequest = true`.
  - **`terminateThreadsRequest` 구현**: 선택 쓰레드에만 `Stop <name>` 전송(전체 아님). 성공/실패는 §0.2대로 각 명령 STATUS로만 판정, 실패 시 sendErrorResponse. `_userActionInFlight` 게이트 + 종료 후 `_fastPoll()`.
  - **`customRequest('gplFocusThread', {name})` 추가**: 정지(Break/Paused/Error) 상태 쓰레드의 StoppedEvent를 재발사해 VS Code 포커스 쓰레드 전환. 제어기 명령 전송 없음(UI 전용), `_pendingAction` 상태머신 불간섭. 정지 상태가 아니거나 미등록이면 무시하고 `{focused:false}` 반환. reason은 상태 기반 근사치(Error→exception, 그 외→breakpoint).
- `src/extension.ts` `gpl.controller.threadShowLocation`: 위치 열기 성공 후 brooks-gpl 세션이 활성이면 `customRequest('gplFocusThread')` 호출 — 트리에서 정지/에러 쓰레드 클릭 시 Variables/Watch도 그 쓰레드로 전환. 실패는 로그만(부가 기능).

### 검증

- 샌드박스 `tsc --noEmit` exit 0, `node ./out/test/index.js` **166/166 통과**. 파일 tail 무결성 확인(NUL/잘림 없음). §0.4대로 **로컬 `npm run compile` 최종 확인 필요**.
- **실기기 확인 필요 (모션 영향 낮음 — Stop/포커스 전환만)**:
  1. 디버그 중 CALL STACK 쓰레드 우클릭 "스레드 종료" → 해당 쓰레드만 Stop되는지, 다른 쓰레드 계속 실행되는지.
  2. 디버그 중 트리에서 정지/에러 쓰레드 클릭 → 위치 열림 + CALL STACK/Variables 포커스 전환되는지.
  3. StoppedEvent 재발사가 step/continue 흐름을 깨지 않는지 (포커스 전환 직후 F10/F5 정상 동작).

### 남은 일

- 패키징·배포 시 CHANGELOG.md에 §1-AJ(툴바 재구성)와 함께 항목 추가.

## 1-AL. 2026-07-31 세션 — 트리 "현재 실행 위치 보기"가 .history stale 사본을 열던 버그 수정

### 증상 → 원인

- 사용자 관찰: 디버깅 중 확장 트리의 "현재 실행 위치 보기"가 **전혀 다른 폴더의 `.history/.../projects/` 사본**을 열었다. 반면 **디버그 패널(CALL STACK) 더블클릭은 정상** — 여는 경로가 2개로 갈라져 있었던 것.
- 원인: 소스 경로 해석이 중복 구현되어 한쪽만 고쳐진 상태였다.
  - 디버그 어댑터 `gplDebugSession._resolveSourcePath/_pickSourcePath`: dot 폴더(.history 등) 제외 + 동명 경합 시 프로젝트 폴더 우선(`pickSourceCandidate`) — 정상.
  - `extension.ts resolveGplFilePath`(트리 `threadShowLocation`/`threadShowStack`/`gpl.errorLocation` 이벤트가 공용): `node_modules`/`.git`/`out`만 제외하고 **첫 매치를 그대로 반환** → `.history` 사본이 먼저 걸리면 그걸 열었다.

### 조치 (src/extension.ts)

- `resolveGplFilePath`를 디버그 어댑터와 같은 규칙으로 통일:
  - `isSkippedScanDir`: dot 폴더 전부 + `node_modules`/`out`/`dist`/`bin` 제외 (gplDebugSession `_isSkippedScanDir`와 동일 규칙).
  - 첫 매치 반환 → **후보 전부 수집 후 `pickSourceCandidate`(responseParser의 순수 함수, import 추가)로 선택.** 프로젝트 폴더 기준은 `controllerTree.getExpectedProjectName()`과 이름이 일치하는 Project.gpr 폴더(`findExpectedProjectDirs`).
  - 경합 시 제외 후보를 출력 채널에 경고 로그로 남김(디버그 어댑터와 동일 UX).
- 보조 함수 `findWorkspaceFilesByName` 분리(Project.gpr 수집과 .gpl 후보 수집이 공용).

### 검증

- 샌드박스 `tsc --noEmit` exit 0, `node ./out/test/index.js` **166/166 통과**. 파일 tail 무결성 확인. §0.4대로 **로컬 `npm run compile` 최종 확인 필요**.
- 실기기 확인(모션 영향 없음 — 파일 열기뿐): `.history`가 있는 워크스페이스에서 트리 "현재 실행 위치 보기" → 실제 프로젝트 폴더의 파일이 열리는지.

### 남은 일

- 세 해석 경로(`gplDebugSession._resolveSourcePath` / `extension.ts resolveGplFilePath` / `deployService.resolveErrorFilePath`)의 스캔·선택 규칙을 공용 모듈로 빼는 리팩터링 검토 — 이번엔 동작 통일만 하고 구조 변경은 보류(§0 함부로 편집 금지 원칙).
- 패키징·배포 시 CHANGELOG.md에 항목 추가.

## 1-AM. 2026-08-05 세션 — CALL STACK에서 Running 쓰레드 클릭 → 현재 실행 위치 열기

### 증상 → 원인

- 사용자 관찰: 디버그 패널(CALL STACK)에서 **Running 쓰레드를 더블클릭해도 실행 중 위치가 열리지 않는다** (정지 쓰레드는 정상).
- 원인: 기능 제거가 아니라 **원래 CALL STACK에서는 불가능한 동작**이었다. DAP 규칙상 VS Code는 정지된 쓰레드에만 stackTrace를 요청하므로 Running 쓰레드는 프레임이 없고 클릭해도 아무 일도 안 일어난다. 실행 중 위치를 열어주던 것은 확장 트리의 "현재 실행 위치 보기"(Show Stack 스냅샷)였고, 사용자는 그 동작이 CALL STACK에도 있기를 기대.

### 조치

- `src/debug/gplDebugSession.ts`:
  - `customRequest('gplThreadInfo', {threadId})` 추가: DAP threadId → `{name, state, msSinceResume}` 반환. 제어기 명령 없는 UI 전용 조회. `state`는 최근 폴 캐시(`_previousThreadStates`) 기준.
  - `_lastResumeAt` 필드 추가 — continue/step 4개 요청에서 `Date.now()` 기록. `msSinceResume`으로 노출해 확장이 "재개 직후 VS Code 자동 포커스 전환"(사용자 클릭 아님)을 걸러내는 데 쓴다(fast poll 첫 발이 30ms라 상태가 이미 Running으로 갱신됐을 수 있는 레이스 대비).
- `src/extension.ts`:
  - `vscode.debug.onDidChangeActiveStackItem` 리스너 등록: 활성 스택 아이템이 **프레임이 아닌 쓰레드**(frameId 없음)이고 세션 타입 `brooks-gpl`이며 `gplThreadInfo` 상태가 `Running`이면 `gpl.controller.threadShowLocation` 실행(트리와 동일 경로 — Show Stack 스냅샷 → 경로 해석 → 열기+데코레이션). `msSinceResume < 2000`이면 스킵(재개 직후 자동 이벤트 무시).
  - 이 API는 VS Code 1.90+ (engines는 ^1.74) — `typeof` 존재 확인 후 등록, 구버전에서는 이 기능만 조용히 비활성.

### 한계 (알고 수용)

- `onDidChangeActiveStackItem`은 **선택 변경 시에만** 발화 — 같은 Running 쓰레드를 연달아 다시 클릭하면 이벤트가 없어 재조회되지 않는다. 갱신하려면 다른 항목 클릭 후 다시 클릭하거나 트리의 "현재 실행 위치 보기" 사용.
- 정지 쓰레드 클릭은 기존대로 VS Code 기본 동작(프레임 열기)에 맡긴다 — 이 리스너는 개입하지 않음.

### 검증

- 로컬 `npm run compile` exit 0, `npm test` **166/166 통과**.
- 실기기 확인 필요 (모션 영향 없음 — 읽기 전용 Show Stack + 파일 열기뿐):
  1. 디버그 중 CALL STACK에서 Running 쓰레드 클릭 → 현재 실행 위치 파일:라인이 열리는지.
  2. F5(Continue) 직후 자동으로 파일이 튀어 열리지 **않는지** (2초 가드 동작 확인).
  3. 정지 쓰레드 클릭/스텝 흐름이 기존과 동일한지 (리스너 비개입 확인).

### 남은 일

- 패키징·배포 시 CHANGELOG.md에 항목 추가.
- (선택) 같은 쓰레드 재클릭 시 위치 갱신이 필요하다는 피드백이 오면 `debug/callstack/context` 우클릭 메뉴("현재 실행 위치 보기") 추가 검토.

## 1-AN. 2026-08-05 세션(후속) — MCP 서버 VSIX 동봉 + `GPL: Export AI Agent Setup` 구현 (§1-AH ①·② 완료, 0.8.9)

### 배경/의도

- 사용자 목표: "확장에서 되는 디버깅을 AI가 해줬으면". 경로 결론은 §1-AH 그대로 controller-mcp가 정규 경로 — 남은 문제는 배포·등록의 마찰이었다.
- 이날 수동 선행 조치: 시뮬레이션 워크스페이스에 `.mcp.json` 배치 + CLAUDE.md §7 가드 섹션(§1-AH ① 진행 기록), `~/.claude.json` user 스코프 전역 등록(백업 `.claude.json.bak-20260805`, `claude` CLI가 PATH에 없어 Node로 직접 기록).
- 혼동 정리(사용자 질문으로 확인된 것): VS Code 확장 뷰의 "MCP 서버" 갤러리와 `.vscode/mcp.json`은 **Copilot용**이라 Claude Code가 읽지 않는다. Claude Code 등록 주체는 프로젝트 `.mcp.json` / user `~/.claude.json`뿐. **VSIX 동봉만으로는 자동 등록되지 않으므로** Export 명령이 "동봉 → 등록"의 간극을 메운다.

### 조치 (의도 → 방법)

- **서버 동봉**: `scripts/bundle-mcp.js` 신설 + devDep `esbuild`. `controller-mcp/src/index.js` → `out/mcp/gpl-controller-mcp.cjs` 단일 CJS(약 724KB, node18 target). node_modules를 싣지 않아 §1-C 심링크 EACCES·용량 문제가 원천 차단됨. `npm run bundle:mcp` 스크립트 추가, `vscode:prepublish`를 `compile && bundle:mcp`로 확장(번들 실패 시 vsce 중단 → package.js가 버전 롤백).
- **`src/ai/exportAgentSetup.ts` 신설** — `gpl.ai.exportAgentSetup` (`GPL: Export AI Agent Setup`):
  1. 동봉 번들을 `globalStorage/mcp/gpl-controller-mcp.cjs`로 복사. **확장 설치 경로를 .mcp.json에 직접 쓰면 업데이트 시 버전 폴더가 바뀌어 조용히 깨지므로** 버전 무관 안정 경로를 사용, 명령 재실행 시 최신 번들로 갱신.
  2. 워크스페이스 루트 `.mcp.json`에 gpl-controller 항목 **병합**(다른 서버 항목 보존, 기존 파일 파싱 실패 시 덮어쓰지 않고 중단). env는 설정 `gpl.controller.ip/port` + `detectWorkspaceProjectName()` 결과.
  3. CLAUDE.md 가드 섹션 upsert — 마커 블록(`<!-- BEGIN/END gpl-controller-mcp guide -->`)이 있으면 그 블록만 교체(재실행 안전), 마커 없이 같은 제목의 수동 섹션이 있으면 건너뜀(중복 방지), 없으면 append. 내용: MCP만 사용/원시 TCP 금지/STATUS 판정/전형적 디버그 흐름/모션 안전 규칙/1402 단일 클라이언트 경합/1403 미노출 안내.
- `extension.ts`에 명령 등록(결과 JSON을 Output `[AI Setup]`으로 기록 — §1-AG Output 기록 규약과 동일 취지), package.json contributes/activationEvents 추가.

### 검증

- 로컬 `npm run compile` exit 0, `npm test` **166/166 통과**.
- 번들 단독 기동 스모크: `node out/mcp/gpl-controller-mcp.cjs` → stderr `[gpl-controller-mcp] ready` 확인.
- `npm run package` → **0.8.9** VSIX 생성(117 files, 594KB), zip 목록에서 `extension/out/mcp/gpl-controller-mcp.cjs` 포함 확인.

### 남은 일

- [x] ~~0.8.9 VSIX 설치 → 실워크스페이스에서 `GPL: Export AI Agent Setup` 실행~~ — **실사용 확인(2026-08-05)**: 사용자가 시뮬레이션 워크스페이스에서 실행, `.mcp.json`이 globalStorage 경로로 갱신되고 CLAUDE.md 블록 생성됨. 단 수동 §7과 중복 생성 발견 → §1-AO에서 수정(0.8.10). 남은 확인: Claude Code 재시작 → `/mcp` 연결 → `compile_project`/`show_threads` 실동작.
- [ ] 등록 경로 정리: 현재 user 스코프(`~/.claude.json`) 전역 등록과 프로젝트 `.mcp.json`이 공존(우선순위 local>project>user). 시뮬레이션 워크스페이스의 수동 `.mcp.json`(저장소 경로 참조)은 Export 재실행 시 globalStorage 경로로 갱신됨. 정착 후 한쪽으로 일원화 검토.
- [ ] §1-AH ③(controller-mcp 도구 견고화 패리티 — Break/Step 후 pause 폴링 등 §1-AG 규약), ④(connect backoff), **1403 실시간 스트림 도구**(console_start/read(cursor)/stop 링버퍼)는 미착수.

## 1-AO. 2026-08-05 세션(후속2) — GPL Controller 뷰 메뉴에 명령 8종 추가 + Export CLAUDE.md 중복 감지 수정 (0.8.10)

### 배경

- 사용자가 0.8.9 설치 후 시뮬레이션 워크스페이스에서 `GPL: Export AI Agent Setup`을 실행 — `.mcp.json`이 globalStorage 경로로 정상 갱신됨(§1-AN 실사용 검증). 그러나 CLAUDE.md에 **수동 §7이 있는데도 자동 블록이 중복 append**됨: 중복 감지가 제목 "정확 일치" 기준이라 수동 제목의 번호 접두(`## 7. 제어기 통신 — ...`)를 놓침.
- 사용자 요청: Command Palette 대신 **GPL Controller 뷰 "..." 메뉴(GUI)에서** GPL 명령들을 실행하고 싶음.

### 조치

- `exportAgentSetup.ts`: 중복 감지 기준을 제목 본문 포함 여부(`CLAUDE_SECTION_TOPIC` = "제어기 통신 — gpl-controller MCP 도구만 사용한다")로 완화 — 번호 접두 등 변형도 잡힘. 시뮬레이션 CLAUDE.md의 수동 §7은 삭제해 **마커 블록만** 남김(재실행 시 자동 갱신되는 쪽으로 관리 일원화).
- `package.json` view/title 메뉴 추가(§1-AJ 그룹 구조 유지): `2_debug`(attachNow, generateLaunch), `2_tools`에 copySituationForChat, `3_console`(console start/stop, liveTerminal start/stop), `3_diag`에 exportAgentSetup, `9_connection`(disconnect). exportAgentSetup·generateLaunch는 제어기 연결이 불필요해 when에 `gpl.ui.connected` 조건 없음.

### 검증

- `npm test` 166/166, `npm run package` → **0.8.10** VSIX(117 files). 메뉴 실표시/실행은 VSIX 설치 후 확인 필요.

### 남은 일

- [ ] 0.8.10 설치 → 뷰 "..." 메뉴에 새 명령 8종 표시·실행 확인, Export 재실행 시 CLAUDE.md 블록이 중복 없이 교체되는지 확인.

## 1-AP. 2026-08-05 세션(후속3) — 에디터 중단점→제어기 동기화 + 정지 위치 자동 표시 (0.8.11)

### 증상/배경

- 사용자 관찰(MCP 실사용): AI가 MCP `set_breakpoint`/`pause_thread`로 제어기에 브레이크를 걸면 **VS Code 중단점 UI와 정지 위치가 갱신되지 않음**. 원인은 구조적 — MCP는 VS Code를 우회해 1402로 직접 명령하므로 "제어기 → VS Code" 방향 연결고리가 없다.
- 방향 결정(사용자 제안 채택): 제어기→에디터 미러링(Show Break 폴링) 대신 **에디터 중단점을 단일 원본**으로 삼고 확장이 제어기에 밀어넣는다. 빨간 점이 항상 진실이라 어긋남이 구조적으로 없고, 1402 추가 폴링도 불필요. AI는 실행 제어만 담당. (완전한 디버그 UI 실시간 동기화는 여전히 Broker의 몫 — broker-workbench-architecture.md §9)

### 조치

- **`src/controller/breakpointSync.ts` 신설** (`EditorBreakpointSync`): `vscode.debug.onDidChangeBreakpoints` 구독 → 연결 상태 + 설정 `gpl.controller.syncEditorBreakpoints`(기본 **false**, 옵트인) 확인 후 `Set Break`/`Set Nobreak` 전송(GDE no-space 형식 — gplDebugSession._bpCommand와 동일 유지 필요).
  - 예외 처리: brooks-gpl 디버그 세션 중엔 DAP가 소유하므로 개입 안 함(이중 전송 방지) / 미연결이면 건너뛰고 **연결 확립 에지(false→true)에서 pushAll로 따라잡기**(setControllerConnected에 훅) / 프로젝트명 미확정 시 잘못 보내지 않고 skip+로그 / 조건·히트카운트·로그 BP는 일반 BP로 설정+안내 / STATUS 실패·예외는 Output `[BP Sync]` 기록 / **제거는 전송 시점 기록(_tracked) 기준**이라 편집으로 위치가 밀려도 정확히 지움 / changed(토글·이동)는 "기록 제거 후 재설정"으로 수렴.
  - 수동 일괄 반영: `gpl.controller.pushBreakpoints`(`GPL: Push Editor Breakpoints to Controller`, 뷰 메뉴 2_debug@3). 추가만 하며 제어기 쪽 기존(GDE 등) BP는 건드리지 않음.
- **정지 위치 자동 표시**: ControllerTreeProvider에 `onDidThreadPause` 이벤트 추가 — 일반 폴링에서 스레드가 비정지→정지(Paused/Break/Error) 전이하거나 **정지 상태로 새로 나타나면**(stopOnEntry, 스레드 0개에서 시작해도 잡힘) 발생. extension.ts가 구독해 §1-AM의 `threadShowLocation` 경로로 파일 열기+강조. 설정 `gpl.controller.autoShowPausedLocation`(기본 **true**).
  - 오발화 방지: 연결 후 **첫 수신 목록은 비교 제외**(`hasReceivedThreadList` — 이미 정지돼 있던 스레드로 점프 안 함, 재연결 시 리셋) / 한 폴 주기 최대 1건(다중 파일 점프 방지) / 디버그 세션 중엔 미발화(디버그 모드는 bridge 경로라 자연 배제 + 구독부 이중 가드) / 이벤트 dispose 처리.
- exportAgentSetup 생성 가이드에 **중단점 워크플로** 문단 추가: 동기화 설정이 켜져 있으면 AI는 `set_breakpoint` 대신 사용자에게 에디터 관리 요청, 직접 쓸 땐 위치(file:line) 보고.

### 검증

- `npm test` 166/166, `npm run package` → **0.8.11** VSIX. 실기기/시뮬레이션 확인 필요:
  1. 설정 켜고 연결 → 에디터에서 BP 추가/제거/토글 → `Show Break`로 제어기 반영 확인, Output `[BP Sync]` 로그.
  2. AI(MCP)로 start_project(stopOnEntry) / pause_thread → 몇 초 내 에디터가 정지 위치로 점프하는지.
  3. F5 디버그 세션 중에는 두 기능 모두 개입하지 않는지(기존 DAP 동작 그대로).
  4. 연결 직후 이미 정지돼 있던 스레드로 점프하지 **않는지**.

### 남은 일

- [ ] 0.8.11 설치 후 위 검증 4항목 수행 (모션 영향 없음 — Set Break/Nobreak + 읽기 전용 조회뿐).
- [ ] (선택) MCP `set_breakpoint`로 건 BP는 여전히 에디터에 안 보임 — 가이드로 완화했으나, 원하면 `list_breakpoints` 기반 단발 "pull" 명령 추가 검토.

## 1-AQ. 2026-08-05 세션(후속4) — 배포 STOP 단계 -752 즉시 실패 제거: settle 게이트 판정 + Stop -all 1회 자동 재시도 (0.8.12)

### 증상/원인

- 사용자 보고: Quick Compile에서 활성 쓰레드 감지 → 사용자 승인으로 `Stop -all` 전송 → 제어기가 `STATUS -752 "Timeout stopping thread"` → 확장이 **즉시 실패로 판정하고 배포 중단**. 가끔 재현되며 손으로 재시도하면 성공.
- -752의 공식 의미(GPL Error Code 문서 language_errors.htm, 사용자 제공): **정지 요청 후 3초(제어기 내부 대기) 안에 쓰레드가 멈추지 않았다는 뜻일 뿐, 요청은 접수되어 쓰레드는 하던 일(모션/I/O)을 마치면 멈춘다. "This is not a critical error."** 빨리 멈추려면 SoftEStop 후 Stop.
- 직접 원인은 `deployService.sendStopAll`의 비대칭: 무응답만 1회 재전송하고 **STATUS 에러는 종류 불문 즉시 실패**, settle 게이트(`waitThreadsSettle`, Show Thread 폴링)는 STATUS 0에서만 진입. Compile 쪽은 이미 -742/-746/-752를 transient로 1회 재시도하는데 STOP만 -752를 치명 취급.

### 조치

- `src/controller/deployService.ts`:
  - `sendStopAll`이 3분류를 반환: `accepted`(STATUS 0) / `stopping`(-752, 비치명) / `failed`(무응답 재전송 실패·기타 STATUS).
  - `stopAllAndSettle`: accepted든 stopping이든 **항상 settle 게이트로 실제 정지를 판정**(STATUS 0도 "접수"일 뿐이므로, §0.6). 게이트에서 정지 미확인이면 **Stop -all 1회 자동 재시도 후 게이트 재수행**, 그래도 미확인이면 기존과 동일하게 STOP 실패로 중단(Compile/Start 미전송 — 안전 게이트 유지).
- `src/controller/controllerStatusCodes.ts`: `STATUS_CONTROLLER_BUSY(-752)` 주석을 공식 문서 의미("Timeout stopping thread", 비치명)로 갱신(기존 "일시 busy" 서술은 부정확).

### 검증

- `npm test` 166/166, `npm run package` → **0.8.12** VSIX. 실기기 확인: 스레드 실행 중 Quick Compile → Stop 승인 → -752가 나와도 배포가 이어지는지(트레이스에 "정지 진행 중(비치명)" → settle 게이트 → 통과).

### 발견 — Stop/settle/busy-retry 로직이 4곳에 제각각 (통일 필요, §3 항목 추가)

| 위치 | busy(-752) 재시도 | settle 확인 | 비고 |
| --- | --- | --- | --- |
| deployService (deploy/F5/Quick Compile) | 이번에 수정(게이트+1회 재시도) | `waitThreadsSettle` | 이번 세션 정비 |
| extension.ts 수동 명령(stopAll/Stop thread/SoftEStop) | `sendCommandWithBusyRetry`(최대 5회) | `verifyAllStopped`/`verifyThreadStopped` + SoftEStop 복구 제안 | 가장 관대·완성형 |
| extension.ts ftpRun | busy 재시도 5회, 잔여 busy 통과 | 자체 게이트 | deployService와 별도 구현 |
| gplDebugSession (`_sendCmd`) | **없음** | **없음** | disconnect/attach preflight/Stop thread — 실패해도 진행이라 저위험이나 -752가 "실패" 로그로 남음 |
| controller-mcp | 없음 (ok:false로 AI에 반환) | 없음 | AI가 -752를 치명으로 오해 가능 — 도구 설명/가이드에 의미 명시 필요 |

- settled 상태 집합(`/^(idle|stopped|error)$/i`)이 `extension.ts:78`(SETTLED_THREAD_STATE)과 `deployService.threadSettled`에 **주석 동기화 의존으로 중복**.

### 남은 일

- [ ] 0.8.12 설치 후 실기기 검증(위 시나리오 — 모션 영향 없음: Stop -all + 읽기 전용 Show Thread뿐).
- [ ] Stop/settle/busy-retry 통일 리팩터링 → §3 체크리스트 참조.

## 1-AR. 2026-08-05 세션(후속5) — 제어기 중단점 실시간 보기: 트리 섹션 상시 표시 + 클릭 열기 + 인라인 새로고침 + Pull 명령 (0.8.13)

### 배경

- 사용자 요청: "제어기의 브레이크 상태를 실시간으로 보고 싶다 — 동기화든 수동 새로고침이든". 조사 결과 트리에 이미 "브레이크포인트 (N)" 섹션이 있고 상세 폴링(`Show Break`, ~10초 주기 또는 정지 스레드 존재 시)이 데이터를 받고 있었으나, 체감을 막는 3가지: ① 0개면 섹션 자체가 사라져 상태 확인 불가 ② 폴링 주기 외 즉시 갱신 수단 없음 ③ 항목 클릭해도 위치가 안 열림.

### 조치

- `controllerTreeProvider.ts`:
  - 브레이크포인트 섹션 **상시 표시**(0개면 "없음" 안내 노드) — 상태가 항상 보인다.
  - 항목 클릭 → `gpl.controller.openBreakpointLocation`으로 해당 파일:줄 열기(툴팁에 "배포본 기준 줄 번호" 명시 — 로컬 수정 시 어긋날 수 있음).
  - `refreshBreakpointsNow()` 공개 메서드: `Show Break` 1회만 재조회(전체 refresh보다 경량). 성공 시 파싱 목록 반환(pull이 재사용), 미연결/실패 시 null.
- `extension.ts` 명령 3종:
  - `gpl.controller.refreshBreakpoints` — 섹션 헤더 **인라인 ↻ 버튼**(viewItem == section-breakpoints, 기존 `section-${id}` contextValue 활용).
  - `gpl.controller.openBreakpointLocation` — 트리 항목 클릭용(내부, contributes 미등록).
  - `gpl.controller.pullBreakpoints`(`GPL: Pull Controller Breakpoints`, 뷰 메뉴 2_debug@4) — **단발 pull**: 제어기 중단점을 에디터 빨간 점으로 반영. 이미 있는 위치(파일+줄 일치)는 건너뛰어 동기화 리스너와의 에코를 최소화(신규분 재전송은 멱등이라 무해). 파일 미해석 건수 보고.
- `breakpointSync.ts`: `onDidSync` 콜백 추가 — 에디터→제어기 동기화 배치가 실제로 뭔가 보낸 직후 `refreshBreakpointsNow()` 호출 → **에디터에서 중단점을 찍으면 1초 내 트리 섹션에도 반영**(다음 폴링을 기다리지 않음).
- 갱신 주기 정리: 상시 폴링(~10초/정지 스레드 시 매 폴) + 동기화 직후 즉시 + 인라인 ↻ 수동 — "실시간 보기"는 이 3중으로 충족. 상시 폴링 주기 단축은 1402 트래픽 증가라 보류.

### 검증

- `npm test` 166/166, **0.8.13** VSIX. 실기기 확인: ① 0개일 때 섹션 표시 ② AI(MCP)가 set_breakpoint → 다음 폴링(≤10초) 또는 ↻ 클릭으로 트리 반영 ③ 항목 클릭 → 위치 열림 ④ 에디터 BP 추가(동기화 on) → 트리 즉시 반영 ⑤ Pull → 빨간 점 생성·중복 스킵.

### 남은 일

- [ ] 0.8.13 설치 후 위 5개 시나리오 확인 (모두 읽기 전용 조회 + 에디터 조작 — 모션 영향 없음).

## 1-AS. 2026-08-05 세션(후속6) — controller-mcp: AI 디버깅 낭비 패턴 구조적 차단 (run_to_line·정지확인 내장·힌트 주입)

### 증상 (사용자 관찰 + AI 자가 분석)

MCP로 AI 디버깅 시 "엄청 느리고 의미 없는 반복": ① 분기 흐름이 코드만으로 결정된 상태에서 정보 없는 줄을 45회 한 줄 스텝 — 규칙상 Step 후 show_thread 확인(접수≠완료)이 필요해 스텝당 MCP 왕복 2회 = 약 90왕복 낭비 ② `-eval`이 property/메서드를 평가 못 한다(-780)는 걸 알고도 유사 시도 반복, `wherej` 같은 없는 명령 시도(-714) ③ 원인 특정에 실제 필요한 건 코드 읽기 + eval 2~3회뿐이었음.

### 원인 분석 → 방침

- 문서 규칙(런북/CLAUDE.md)은 세션이 길어지면 잊힌다. **유도는 도구 응답 안에서, 낭비가 일어나는 그 시점에** 해야 효과적.
- 온라인 조사로 방침 뒷받침(2026-08-05, 본 세션): line-by-line 스텝은 LLM 에이전트의 알려진 비효율 패턴이며 해법은 고수준 관측 반환(arXiv 2604.24212 ADI), 도구는 워크플로 단위로 통합하고 에러는 다음 행동을 지시해야 함(Anthropic "Writing effective tools for agents", Datadog MCP 사례), LLM은 순차 디버깅 훈련 데이터가 부족해 도구 설계로 보정 필요(MSR debug-gym).

### 조치 (`controller-mcp/src/*` — VSIX 번들 `out/mcp`는 다음 `npm run package` 때 재생성)

- `parse.js`: 확장 `responseParser.ts`에서 `parseThreadDetail`(콤마 형식 상세)·`normalizeThreadState`(Stopped/Stopping 순서 주의 포함) 이식, `PAUSED_STATES`(Paused/Break/Error), `statusHint(code)`(-729/-780 eval 한계, -714 없는 명령, -505/-508/-742/-745/-9999 행동 지향 힌트) 추가.
- `index.js`:
  - **정지 확인 내장(접수≠완료 자동화)**: `waitForThreadPause()` — `Show Thread <thread>` 상세를 150ms 폴링, 정지 계열 상태로 완료 판정. 접수 직후 옛 위치 Paused 레이스는 직전 위치 스냅샷과 같은 관측을 600ms 무시(stale grace)로 처리. `pause_thread`/`step_thread`/`continue_thread`가 정지 위치(file:line/state)까지 반환 → **스텝당 MCP 왕복 2회 → 1회**.
  - **`run_to_line` 신설(여러 줄 진행의 기본 경로)**: 임시 중단점 → Continue → 정지 확인 → `evals` 배치 평가 → 중단점 정리(기본 해제, `keepBreakpoint` 옵션)를 1회 호출로. `atRequestedLine`으로 다른 지점 정지(다른 BP/에러)도 구분 보고.
  - **관측 배치**: `step_thread`/`run_to_line`에 `evals: string[]` — 정지 확인 후 프레임 0에서 여러 변수를 한 응답으로(ADI의 배치 관측 방향).
  - **연속 스텝 넛지**: 같은 스레드 연속 스텝 3회째부터 응답에 `advice`(run_to_line/정적 분석 전환 권고). 차단은 안 함. continue/run_to_line/set_breakpoint/pause가 스트릭 리셋.
  - **실패 힌트 주입**: `runCommand`가 실패 STATUS에 `hint` 자동 첨부. eval은 DATA 안 `(-729)/(-780)` 패턴도 감지. description에도 eval 한계(필드/로컬만) 명시.
- `README.md`(controller-mcp): §5 도구 목록/§6 권장 흐름(정적 분석 먼저 → run_to_line+evals, 스텝은 "다음 한 줄의 효과가 질문일 때만")/§7 설계 주의 갱신.

### 검증

- `controller-mcp` `npm test` 10/10 통과(신규: parseThreadDetail·normalizeThreadState·statusHint), `node --check` 통과. **실기기 미검증** — 아래 남은 일.

### 남은 일

- [ ] 실기기 검증(시뮬레이션 모드): ① step_thread가 정지 위치를 반환하는지(접수 직후 stale grace 동작 포함) ② run_to_line 도달/미도달/다른 BP 정지 3케이스 ③ evals 배치 응답 ④ -780/-714 힌트 표기 ⑤ 연속 스텝 3회 advice. `Show Thread <name>` 상세가 Running 중에도 위치를 주는지 실측 확인.
- [ ] step/continue의 대상 인자 실측 재확인: GDE 캡처(§runbook)는 `Step <project>` 형식인데 MCP는 스레드명을 넣는다(기존 세션에서 45회 스텝이 동작했으므로 스레드명=프로젝트명 환경에선 유효). 다르게 명명된 스레드에서 확인 필요.
- [ ] 런북/instructions의 "Step 후 show_thread 확인" 서술을 "MCP 도구는 정지 확인 내장"으로 갱신(다음 문서 정리 때).

## 1-AT. 2026-08-05 세션(후속7) — 배포 로그 가독성 개선 (폴링 스팸·전량 나열·오해 소지 기호 정리)

### 증상 (사용자 로그 제시)

Quick Compile 출력 로그가 읽기 어려움: ① settle 게이트가 500ms 폴링마다 같은 `… 정지 대기: IOMonitorThreadFunction(Paused)` 줄을 십수 번 반복 ② mirror sync가 스킵 포함 65개 파일을 전부 나열(실제 전송은 3개) ③ `✘ del Compile.log`가 실패처럼 보임(정상 미러 삭제인데 실패 기호) ④ `✔ Stop complete (요청 접수)` 문구 모순(complete vs 접수) ⑤ `✔ 모든 쓰레드 정지 확인 (0개)`의 "(0개)"가 혼란(Show Thread 목록 수인데 맥락 없음) ⑥ direct 모드에서 헤더의 `Selected base path`/`Path candidates`가 FTP 줄과 중복 ⑦ [ErrorLog 분류]에서 같은 코드(-1600 Trj/AutoEx)에 동일 보일러플레이트 설명이 항목마다 반복.

### 조치

- `src/controller/deployService.ts`:
  - `waitThreadsSettle`: 상태 문자열이 바뀌면 즉시, 같은 상태면 **2초에 한 번만** 경과 시간과 함께 출력(`… 정지 대기 3.5s: …`). 완료 줄은 `✔ 모든 쓰레드 정지 확인 (1.5s, 정지 상태 N개)` 형식 — total 0(목록 비어 있음)이면 개수 생략.
  - 업로드 진행: `onProgress`의 action으로 **실제 전송된 파일만** `│ ↑ [i/total] 파일명` 출력(스킵은 `Mirror/Upload done` 요약 카운트로만). 퍼센트 표기 제거.
  - 미러 삭제 기호 `✘ del` → `− del`(✘는 실패 전용으로 유지).
  - Stop 접수: `✔ Stop complete (요청 접수)` → `✔ Stop -all 접수 — 실제 정지는 아래 게이트에서 확인`.
  - 헤더: `Selected base path`/`Path candidates`는 classic 모드에서만 출력(direct 모드는 FTP 줄과 중복).
  - ERROR CHECK: `⚠ N error(s):` → `⚠ ErrorLog N건:`(과거 누적 항목이 섞이므로 단정 회피).
  - **버그 수정**: 최종 요약줄이 실패 시에도 `✔ Build failed`로 찍히던 것을 성공/실패에 따라 `✔`/`✘`로.
- `src/controller/ftpClient.ts`: `uploadProject`/`mirrorProject`의 `onProgress`에 4번째 인자 `action: 'uploaded' | 'skipped'` 추가(기존 호출자는 인자 무시로 호환).
- `src/extension.ts` [ErrorLog 분류]: 부가 설명(detail/해석/권장)을 **코드당 한 번만** 출력(같은 코드 반복 시 요약 줄만).

### 검증

- 로컬 `npm run compile` 통과. 실기기 로그 출력 확인은 다음 배포 때 자연 검증(로직 변경 아님 — 판정 규약(STATUS/settle 게이트)은 건드리지 않고 출력만 변경).

### 남은 일

- [ ] 다음 `npm run package`(버전 bump) 때 CHANGELOG에 본 로그 개선 항목 추가.

## 1-AU. 2026-08-05 세션(후속8) — controller-mcp 2차: keep-alive 연결·세션 로그·사전 가드·debug_snapshot (§1-AS 실사용 피드백 반영)

### 증상 (§1-AS 적용 후 재시도, 사용자 분석)

여전히 느림: ① `-eval` 제약으로 왕복 증가 — `robotType`, `automaticRetractScaraArm`, `getStation(3).teachingPointCountPerArm` 전부 `-780 Unsupported procedure reference`, 프레임 로컬 `cmd`도 실패(성공은 `theMotionLoger.lastStage` 같은 모듈전역.필드뿐) ② "여기 위치" 파악에 수천 줄 RobotModule.gpl 탐색 등 준비가 김 ③ 1402 직렬화 채널의 호출당 왕복 지연 + AI가 안전 규칙상 스텝/컨티뉴 **앞에** 상태 확인을 또 끼움(사후 확인 내장했지만 사전 확인 중복은 남았었음). 추가 요청: 관련 로그를 사용자가 복사해 올 수 있게, 그리고 AI가 뭘 하는지 말하면서 작업하게.

### 조치 (`controller-mcp/src/*`)

- **`console.js` keep-alive 재작성**: connect-per-command(명령마다 TCP 연결, 150ms 폴링마다 재접속!) → 연결 유지 + 유휴 `GPL_IDLE_CLOSE_MS`(기본 30s) 후 종료. 죽은 재사용 소켓(0바이트 끊김/쓰기 실패)은 새 연결로 1회 자동 재시도. `onCommand` 훅(명령/소요시간/raw/에러) 추가. 가짜 1402 서버 스모크로 재사용·재접속·직렬화 검증.
- **세션 로그**: 모든 도구 호출(시작 args/완료 ms/1402 왕복 수)과 1402 명령(ms/STATUS)을 링버퍼(2000줄) + 파일(`GPL_MCP_LOG_DIR`, 기본 `%TEMP%\gpl-mcp\gpl-mcp-<ts>.log`, 시작 시 stderr에 경로 출력)에 기록. `get_session_log(tail?)` 도구 신설. 사용자는 `Get-Content <파일> -Wait`로 실시간 관찰(= "AI가 뭘 하는지 보이게") 가능, 파일 복사로 낭비 분석 공유.
- **사전 상태 가드 내장**: `step_thread`/`continue_thread`는 스냅샷에서 비정지면 명령 전송 없이 `refused: thread-not-paused`+현재 위치 반환, `pause_thread`는 이미 정지면 `alreadyPaused`+위치 반환. `run_to_line`은 스레드가 이미 실행 중이면 Continue를 생략하고 중단점 히트만 대기. description에 "사전·사후 확인 내장 — 앞뒤 show_thread 금지" 명시. step 응답에 `before` 위치 포함.
- **`debug_snapshot(thread?, evals?, frame?)` 신설**: 스레드 목록+정지 스레드 자동 선택+위치 상세+스택+선택 evals를 1회 호출로(상황 파악 원샷).
- **eval 힌트 정밀화(§1-U 실측 정합)**: -780(프로퍼티/메서드, 인자 무관 — 백킹 필드/부모 덤프/정적 분석 대안 제시)과 -729(프레임 스코프 밖/점 표기 멤버 — show_stack으로 프레임 확인, 모듈전역.필드·arr(i)는 가능)를 분리. `eval_expression` description에 가능/불가 목록 명시.
- **문서**: controller-mcp README(도구/흐름 0번 "말하면서 작업"/환경변수/keep-alive), 런북 §6(MCP 내장 확인 — 앞뒤 show_thread 금지), instructions 핵심 원칙(보고 규칙 + MCP 내장 확인) 갱신.

### 검증

- `controller-mcp` `npm test` 10/10(-780/-729 힌트 단언 갱신), `node --check` 3파일 통과, keep-alive 스모크(가짜 서버: 3명령 1연결 재사용 → 강제 끊김 후 자동 재접속 → 동시 3발사 직렬화) PASS. 루트 `npm test` 166/166(무관 회귀 없음 확인). **실기기 미검증.**

### 남은 일

- [ ] 실기기 검증(§1-AS 체크리스트에 추가): keep-alive가 GDE/확장 동시 접속과 공존하는지(1402 다중 클라이언트 수용은 기존 관찰상 가능), 유휴 30s 종료 동작, debug_snapshot 자동 스레드 선택, 사전 가드 refused 응답.
- [ ] 로그 파일 크기 관리(장기 세션 시 rotate) — 필요해지면.
- [ ] MCP 서버 재시작 후 사용(현재 연결된 세션에는 새 도구/동작 미반영), VSIX 번들은 다음 `npm run package` 때 갱신.

## 1-AV. 2026-08-18 세션 — autoOnSave 조건부 자동 활성화(기본 "auto") + Start 계열 배포 뮤텍스 가드

### 요구/배경 (사용자)

- autoOnSave(저장 시 자동 빠른 컴파일)가 **기본적으로, 단 조건부로** 켜지길 원함. 조건:
  ① 제어기가 **완전 STOP 상태** — "모든 쓰레드가 종료되어 존재하지 않는 상황"(정지 상태 쓰레드도 없음).
  ② `/GPL/<projectName>` 폴더가 원격에 이미 존재.
- 이유(안전): **업로드/파일 삭제 도중 Compile/Start가 겹치면 제어기가 죽는 것 같다**(사용자 관찰).
  §0.6(Stop 후 Compile/Start 이상)과 같은 계열의 충돌로 판단, 자동 경로는 보수적으로 게이트.

### 조치

- **설정 `gpl.quickCompile.autoOnSave`: boolean → enum 문자열** (`package.json`):
  - `"auto"`(신규 **기본값**): 아래 AUTO_GATE 충족 시에만 조용히 실행. 미충족이면 팝업/패널 포커스/스냅샷 없이 Output 로그 한 줄만 남기고 스킵.
  - `"on"`(구 `true`): 기존 동작 그대로(게이트 없음, 활성 쓰레드 시 조용히 중단, /GPL 없으면 classic 폴백).
  - `"off"`(구 `false`): 사용 안 함.
  - 구버전 boolean 값 호환: `extension.ts getAutoOnSaveMode()`가 `true→on`, `false→off`로 해석(명시적 false 사용자는 계속 꺼짐). **미설정 사용자는 이번 버전부터 "auto"로 동작이 바뀜** — CHANGELOG에 명시.
- **`deployService.ts`에 `DeployOptions.autoGate` + `failedPhase 'AUTO_GATE'` 추가**. 게이트는 deploy() 내부에서 live 데이터로만 판정(§0 하드 규칙):
  - 조건 1(/GPL probe 직후): `/GPL/<projectName>` 미존재·프로브 실패·생성 필요 → AUTO_GATE 스킵. **자동 모드는 폴더를 생성하지 않고 classic 폴백도 하지 않는다**(불완전 업로드/의도치 않은 flash 쓰기 방지). 최초 1회는 수동 Deploy로 올리라고 안내.
  - 조건 2(skipStop 쓰레드 프로브): `Show Thread  -web` 목록이 **완전히 비어야**(total 0) 진행. 정지 상태(Idle/Stopped/Error) 쓰레드가 있어도 스킵(기존 게이트보다 엄격 — 사용자 정의 "STOP 상태"). 무응답(STATUS 미수신)도 "확인 불가 = 미충족"으로 스킵.
    ※ **2026-08-25 §1-BD에서 변경**: 조건 2는 이제 UPLOAD *뒤*·COMPILE 직전에 적용되고, 미충족이면 업로드는 유지한 채 Compile만 보류(`COMPILE_DEFERRED` → "컴파일 필요" 표시)한다. "자동 업로드까지 스킵"은 당시 사양.
  - autoGate 경로는 진입 시 `output.show(true)`/`diagnosticCollection.clear()`를 하지 않음(저장마다 포커스 강탈 방지, 게이트 스킵 시 기존 빨간 줄 보존). 진단 clear는 게이트 통과 후 수행(당시 UPLOAD 진입 시점 → §1-BD 이후 COMPILE 진입 시점).
- **`extension.ts`**: `QuickDeployOpts.autoGate` 전달, `runDeployCore`에서 `AUTO_GATE` 결과는 실패 처리(팝업·스냅샷·outputChannel.show) 전에 로그 한 줄로 조기 반환. flush에서 `brooks-gpl` 디버그 세션 중이면 프로브 왕복 없이 스킵. 저장 핸들러/flush는 `getAutoOnSaveMode()` 사용.
- **Start 계열 명령에 배포 뮤텍스(`deployInFlight`) 가드 추가** — 사용자가 경고한 "업로드 도중 Start" 충돌의 확장 내부 경로 차단:
  - `gpl.start`, `gpl.controller.threadStart`, `gpl.controller.ftpRun`(Compile & Start): 업로드/배포 진행 중이면 경고 후 거부.
  - `gpl.saveToFlash`: FTP 미러(원격 삭제 포함)를 `deployInFlight`로 감싸 autoOnSave/배포와 상호 배제(기존엔 뮤텍스 밖이었음).
  - 한계(당시): ~~MCP(controller-mcp)·GDE 등 외부 클라이언트의 Start/Compile은 이 뮤텍스로 못 막는다.~~ → **2026-08-25 §1-BD에서 MCP·다른 VS Code 창까지 차단**(프로세스 간 잠금 파일 `%TEMP%/gpl-controller/<ip>.lock.json`; `deployInFlight` boolean은 폐지). GDE는 여전히 못 막는다(브로커 전환 전까지의 한계).
- **업로드 전 미저장 파일 확인 모달(같은 날 후속 요청)** — `extension.ts confirmSaveDirtyProjectDocs()`:
  - Deploy/Quick Compile(runDeployCore 수동 경로)·Save to Flash 실행 시, 해당 projectDir 하위의 dirty 문서가 있으면
    Start 확인과 같은 모달("저장 후 계속" + 취소)로 확인. 취소하거나 저장 실패 시 업로드를 시작하지 않는다
    (미저장 상태로 올리면 디스크의 이전 내용이 업로드돼 혼동 유발).
  - autoOnSave(changedFiles) 경로는 저장이 트리거이므로 이 모달을 띄우지 않는다(저장 경로 UI 금지 규칙 유지).
  - 확인 저장으로 autoOnSave pending에 들어간 파일은 runDeployCore 경로에서는 제거(같은 업로드가 처리 — 중복 컴파일 방지),
    Save to Flash 경로에서는 유지(/GPL 동기화는 이후 autoOnSave가 자체 게이트로 처리 — flash 업로드는 /GPL을 갱신하지 않음).

### 검증

- `npm run compile` 통과, `npm test` 166/166 통과(회귀 없음). **실기기(G2400C) 미검증.**
- 실기기 검증 체크리스트(다음 작업자/사용자):
  1. 완전 STOP(쓰레드 0) + /GPL/MergeCode 존재 상태에서 .gpl 저장 → 자동 업로드+Compile 실행되는지, Output에 `[autoOnSave] 게이트 통과` 로그.
  2. 프로그램 실행 중 저장 → 팝업 없이 Output `게이트 미충족 — 활성 쓰레드` 한 줄만 남고 제어기 무접촉(FTP LIST/Show Thread 프로브만)인지.
  3. Stop 직후(정지 상태 쓰레드 잔존) 저장 → `정지 상태 쓰레드 N개 존재` 스킵 확인.
  4. /GPL에 프로젝트 없는 워크스페이스에서 저장 → `/GPL/<name> 폴더 없음` 스킵(classic 폴백/폴더 생성 없음) 확인.
  5. 디버그(F5) 세션 중 저장 → `디버그 세션 진행 중` 스킵.
  6. 수동 Deploy 진행 중 `gpl.start`/트리 쓰레드 시작/ftpRun → "업로드/배포가 진행 중" 경고로 거부되는지.
  7. 게이트 스킵 시 기존 컴파일 에러 빨간 줄이 지워지지 않는지.
  8. 미저장 .gpl 파일이 있는 상태에서 수동 Quick Compile/Deploy/Save to Flash → "저장 후 계속/취소" 모달,
     취소 시 업로드 미시작, "저장 후 계속" 시 저장→업로드 진행 + 같은 파일이 autoOnSave로 중복 컴파일되지 않는지.

### 남은 일

- [ ] 실기기 검증(위 체크리스트) 후 `npm run package`(→0.8.14 예정) + VSIX 재설치.
- [ ] 외부 클라이언트(MCP/GDE) Start와 확장 업로드의 교차 충돌은 미해결 — 필요 시 controller-mcp 쪽에도 "업로드 중" 상호 신호 검토.

## 1-AW. 2026-08-18 세션 — 활동바 "GPL Controller" 아이콘 교체 (CPU 칩)

- **요구**: 기존 `resources/gpl-controller.svg`(박스+점 3개+막대) 모양이 마음에 들지 않는다며 교체 요청. 컨셉 선택지(로봇 팔/CPU 칩/콘솔 터미널) 중 사용자가 **CPU 칩** 선택.
- **조치**: SVG를 CPU 칩 실루엣(본체 사각 외곽선 + 중앙 다이 + 4방향 핀 3개씩)으로 재작성. viewBox 128 유지, 색상 `#4FC3F7` 유지(활동바에서는 마스크 처리되어 테마 색이 입혀지므로 실루엣만 유효). `package.json`의 참조 경로(활동바 컨테이너 + gplThreads 뷰) 변경 없음.
- **검증**: 코드 변경 없음(에셋만). VS Code 창 리로드(또는 VSIX 재설치) 후 활동바 아이콘 표시 확인은 사용자.

## 1-AX. 2026-08-18 세션 — 컴파일 에러 점프 최종 포커스를 편집기로 + 점프 로직 공용 헬퍼화

- **증상**: 컴파일 에러 발생 시 편집하던 커서가 사라져 보임(사용자 보고).
- **원인**: 배포 실패 분기에서 ① `showTextDocument`로 첫 에러 위치 점프(포커스+커서 이동) 후 ② `workbench.actions.view.problems` 명령이 **마지막에** 실행되어 키보드 포커스를 Problems 패널로 가져감 → 편집기 캐럿 비활성화가 "커서 사라짐"으로 인지됨.
- **사용자 결정**: 에러 시 포커스·커서를 에러 위치로 옮기는 동작 자체는 **정상 사양으로 확정**. 최종 포커스가 패널에 남는 부분만 수정.
- **조치**:
  - 순서 교체 — Problems 패널 명령을 먼저 실행하고 편집기 점프를 마지막에. 최종 포커스·커서가 에러 줄 편집기에 남는다.
  - 중복 제거 — extension.ts(수동 Deploy/Quick Compile)와 gplDebugSession.ts(F5 배포)의 동일 점프 로직을 `deployService.jumpToFirstCompileError()` 공용 헬퍼로 추출(설정 `gpl.deploy.jumpToFirstError` 체크 포함). 두 경로가 다시 어긋날 여지 제거.
  - 소소한 개선 — 커서를 컬럼 0 대신 들여쓰기 뒤 첫 문자(`firstNonWhitespaceCharacterIndex`)에 배치(컴파일러는 파일:줄만 보고, 컬럼 정보 없음). reveal은 `InCenter` → `InCenterIfOutsideViewport`(에러 줄이 이미 보이면 스크롤 점프 없음).
- **검증**: `npm run compile` 통과, `npm test` 166/166 통과. 실사용 포커스 동작 확인은 VSIX 재설치 후 사용자.
- **남은 일(선택)**: autoOnSave 자동 Quick Compile 경로에서도 점프가 발생한다(§1-AV 게이트 통과 후 에러가 나는 경우). 저장 시마다 커서 이동이 방해가 되면 `gpl.deploy.jumpToFirstError`를 끄거나 "수동 배포만 점프" 옵션 분리를 검토.

## 1-AY. 2026-08-18 세션 — Rename(F2) 프로바이더 신규 (라이벌 확장 대응)

- **배경**: 마켓플레이스에 GPL 지원 라이벌 확장 `kimhui.vb-helper`(2026-07-30 게시, VB.NET+GPL+PAC **에디터 전용**, 제어기 연동 없음) 등장. 기능 비교 결과 우리 확장에 없는 편집 기능 중 사용자 결정으로 **Rename만** 도입 (`.pac` 언어 지원·스니펫은 보류 — "우리 방향과 다름"/"표준화 어려움", 재제안 금지).
- **의도/설계** (신규 `src/providers/renameProvider.ts` + 순수 로직 `src/language/renameCore.ts`):
  - **대상 판별은 정의 이동과 같은 해석 순서** (로컬 → 멤버 접근 → 캐시 → 온디맨드 파싱). F12로 정의에 못 가는 식별자는 F2도 거부 — 이름만 같은 코드를 텍스트 치환으로 깨뜨리지 않는 안전선. 예약어(광역 셋, renameCore.GPL_RENAME_RESERVED)·GPL 내장 심볼(gplBuiltins)은 원본/새 이름 양쪽에서 거부.
  - **로컬 변수/파라미터**: `findEnclosingProcedureRange`로 감싸는 프로시저 안의 비한정(`.` 뒤가 아닌) 매치만 변경.
  - **전역 심볼**: `GPLReferenceProvider.provideReferences`를 **정의 위치에서** 재실행(호출부/정의부 어디서 F2 해도 결과 동일)하되, rename 특성에 맞게 3가지 보정:
    1. **함수 반환값 대입**(`FunctionName = ...`) — 참조 검색은 의도적으로 제외하지만 rename은 필수 포함 (누락 시 컴파일 깨짐).
    2. **문자열 프로시저 참조** — GPL 스레드 관용구 `New Thread("Mod.Proc")`의 문자열도 함께 변경. 기준은 정의 이동(resolveStringLiteralReference)과 동일: "F12로 점프되는 문자열만 F2로 바뀐다" (식별자 형태 리터럴 + 한정자 일치 검증). Module/Class rename 시 `"Name.xxx"`의 첫 세그먼트도 처리.
    3. **섀도잉 필터** — 동명 로컬이 선언된 다른 프로시저 안의 비한정 매치는 그 로컬을 가리키므로 제외 (참조 검색의 과탐이 rename에서는 코드 파손이 되는 것 방지).
  - 같은 스코프 동명 충돌 검사(거부), 새 이름 식별자 형식 검증.
- **부수 변경**: `isInCommentOrString` 정본을 `config.ts` → `language/cursorExpression.ts`로 이동 (renameCore가 vscode 비의존이어야 Node 단독 테스트 가능). config.ts가 re-export하므로 기존 import 경로 전부 무변경. extension.ts는 GPLReferenceProvider 인스턴스를 변수로 빼 Rename과 공유.
- **검증**: `npm test` 178/178 통과 (신규 renameCore 12케이스: 예약어/경계/주석·문자열 제외/skipQualified/반환값 대입/문자열 세그먼트/컨테이너/주석 속 문자열 + isInCommentOrString 이동 회귀). 실사용(F2) 검증은 VSIX 재설치 후 사용자.
- **남은 일**: ① MergeCode 실프로젝트에서 F2 실사용 검증 (특히 스레드 문자열 참조·오버로드·클래스 멤버) ② 다음 릴리스 패키징 시 CHANGELOG에 "Rename(F2) 지원" 항목 추가 ③ (선택) rename 결과 미리보기 유도 문서화 — VS Code 기본은 즉시 적용이므로 대규모 rename 전 `Ctrl+Enter`(미리보기) 권장 안내.

## 1-AZ. 2026-08-18 세션 — 문서 전면 정리 + Material for MkDocs 사이트 도입

### 증상/배경 (사용자 요청: "문서 자료 정리 + Material for MkDocs 도입")

- 전수 조사 결과 `docs/development/` 7개 중 **5개가 지금은 삭제되고 없는 GPL 로봇 앱(Test_robot) 시절 문서**였고, 그중 `automation.md`는 현행 하드 규칙이 금지하는 절차(별도 PowerShell/FTP 업로드로 Deploy 경로 우회)를 "권장 워크플로"로 서술 — CLAUDE.md 3단계 읽기 순서를 따르는 신규 작업자(AI 포함)가 금지 경로를 정상 절차로 학습할 위험.
- 그 외: 런북 `-742`를 "일시 상태 가능"으로 오기(instructions와 정면 모순), 폐지된 `gpl.deployRun` 잔존, 루트 README 버전 v0.8.8(실제 0.8.14, 6릴리스 연속 방치), `networking.md`가 옛 파일명(`GPL_DICTIONARY_GUIDE.md`) 링크, `gpl-release.instructions.md`의 "`npm run package` (필수)"가 process.md의 minor/major 금지 규칙과 모순.

### 조치

- **MkDocs 사이트 골격**: `mkdocs.yml`(Material, `language: ko`, 라이트/다크, 한글 앵커 보존용 `pymdownx.slugs` slugify, `exclude_docs`로 ai-handoff.md·dotfile 제외 — 사용자 결정), `requirements-docs.txt`(mkdocs-material==9.7.7 고정), `.github/workflows/docs.yml`(main 푸시 시 `mkdocs build --strict` → GitHub Pages 배포, docs 경로 필터), `ci.yml`에 docs `paths-ignore`, npm `docs:serve`/`docs:build`, `.gitignore`에 `site/`, `.vscodeignore`에 mkdocs 파일.
- **Test_robot 시절 문서 이관**: `handover.md`·`project-structure.md`·`version-management.md`·`automation.md` → `docs/archive/test-robot/`(각 최상단에 폐기 배너: 마지막 유효 시점·현행 대체 문서 명시), `workflow-improvements.md` → `docs/archive/sessions/2025-12-09-workflow-retro.md`(동일 사건 세션 기록과 짝). handover의 고유 가치(설계 근거·코딩 우선순위·래퍼 지양·Quality Gate)는 신규 `docs/development/design-principles.md`로 추출. `development/`에는 runbook·design-principles·broker-workbench 3개만 남음.
- **런북 P0 교정**: `-742`를 "명확한 컴파일 실패"로 분리(-746 일시 상태, -752는 §1-AU 의미로 명시), `gpl.deployRun` 행 → `gpl.start`/`gpl.saveToFlash`/`gpl.quickCompile`로 교체, 명령 제목을 package.json 실제 제목으로 갱신. ※ 조사 에이전트가 "`gpl.stopAll` 미존재"라 보고했으나 **검증 결과 extension.ts:2708에 별칭으로 실존** — 삭제하지 않음 (하드 규칙 3: 단정 전 소스 확인의 실례).
- **모순 해소**: `gpl-release.instructions.md`의 "`npm run package` (필수)" → patch 전용으로 조건부화(정본: releases/process.md), CLAUDE.md 읽기 순서 3번을 현행 문서로 재지정, 루트 README 버전 0.8.14·문서 링크 갱신.
- **아카이브의 살아있는 지식 승격**: Static 로컬 변수 선언 시 초기화 함정(2026-01-02 세션) → `gpl-language/datatypes.md`, StreamWriter AutoFlush 기본값(serial·/NVRAM=True)+공식 URL 8개 → `gpl-language/file-io.md`. 원본엔 승격 표시.
- **링크/인덱스**: `networking.md` 깨진 링크 수정, `docs/README.md` 전면 재작성(사이트 홈, ai-handoff를 필독 1순위로 GitHub 링크 등재, 디렉터리 링크·CONTRIBUTING 유령 링크 제거), archive README에 test-robot 폴더 등재, incidents 레거시 명칭 매핑 1세대 보강(IO_FileManager → Storage_File_Manager), 아카이브 내 깨진 전방 링크에 "(당시 경로)" 주석.

### 검증

- `mkdocs build --strict` **경고 0건 통과** (한글 앵커는 빌드 산출물 HTML의 id와 dictionary.md TOC 9개 전부 일치 확인). `package.json` JSON 유효성 확인. 이관 경로를 참조하는 잔존 참조 grep 0건. 코드(src) 무변경이므로 compile/package 불필요.

### 남은 일

- ~~GitHub Pages Source 설정~~ → §1-BA에서 API로 활성화·배포·검증 완료.
- 후속 4건(런북 Command ID 표 재생성, 런북↔instructions 정본 단일화, pre-release-check README 버전 대조, gpl-language Test_robot 잔재 점검)도 §1-BA에서 완료.

## 1-BA. 2026-08-18 세션(후속) — 문서 정리 2차: Test_robot 잔재 제거·정본 정리·Pages 배포

### 배경 (사용자: "불필요/오류 문서 알아서 제거, 남은 일 이어서")

§1-AZ의 후속 체크리스트 4건 + gpl-language 문서에 남아 있던 "삭제된 Test_robot 코드가 이 저장소에 구현돼 있다"는 프레이밍 정리.

### 조치

- **file-io.md 분리**: 범용 GPL 지식(StreamReader Peek 패턴, File 클래스, StreamWriter Flush/AutoFlush, Flash 수명 원칙)만 남기고, Test_robot 저장 시스템 구현 설명(Storage_File_Manager/Data_AsyncSave/XmlStore/DatStore, FileIOTest, 모듈 에러 코드)은 `archive/test-robot/file-io-implementation.md` 신설로 이관.
- **프레이밍 교정** (예제 코드는 유효하므로 유지, 서술만 수정): networking.md §7을 "적용 사례(옛 Test_robot — 현재 저장소에 없음)"로, thread-safety.md의 "본 리포지토리의 Data_AsyncSave" 서술 수정, error-handling.md "적용 모듈" → 예제 출처 설명으로, error-prevention.md의 `Test_robot/` grep 경로 → `<프로젝트 폴더>`로 일반화 + 체크리스트 모듈명에 "옛 프로젝트 기준" 주석.
- **런북 Command ID 표 재생성**: package.json `contributes.commands` 57개를 단일 출처로 6개 카테고리 표로 재작성. "이 표가 낡으면 package.json이 정본" 명시. 트리 컨텍스트 전용 명령은 별도 절로 분리(팔레트 단독 실행 부적합).
- **정본 역할 분담 명시**: runbook·instructions 양쪽 최상단에 상호 역할 선언 추가. instructions의 `-752` 의미 교정("Timeout stopping thread" 비치명, §1-AU), `-746`과 분리. 낡은 명령 제목("Deploy (Build Only)", "(/GPL 업로드 + Compile)") 실제 제목으로 갱신.
- **pre-release-check.js**: README "현재 버전: **vX.Y.Z**" ↔ package.json 버전 대조 검사 추가(표기 부재/불일치 시 실패). 현재 README(v0.8.14)로 회귀 확인.

### 검증

- `mkdocs build --strict` 통과. pre-release-check의 새 정규식을 현재 README에 대해 단독 실행으로 확인(match v0.8.14). 이관/수정된 경로를 참조하는 잔존 참조 grep 확인.

### 남은 일

- (선택) markdownlint 스타일 경고(MD022/MD032 등)가 문서 전반에 있으나 빌드 무관 — 일괄 정리는 별도 세션에서.

## 1-BB. 2026-08-18 세션(3차) — Test_robot 아카이브 반출 + datatypes 상수 원문 교체

### 배경 (사용자 요청)

- `datatypes.md`의 로봇 구성 상수(GPL_Righty 등) 한국어 번역이 의미 불명("손목 위" 등) — 원문 영어로 교체 요청.
- `docs/archive/test-robot/`(§1-AZ에서 이관한 폐기 문서 5개)가 확장과 무관한 옛 프로젝트 자료라 저장소에 남아 있는 것 자체가 불필요하다고 판단, 저장소 밖 반출 요청.

### 조치

- **datatypes.md 상수 절 교체**: GPL_Righty~GPL_Single 7개를 Brooks 공식 원문 영어 서술로 교체(WebFetch로 원문 대조), 앞에 "로봇 자세(configuration) 지정 플래그" 한 줄 안내와 원문 링크 추가. 기존 번역은 "pitched up/down" 등 핵심 의미가 소실돼 있었음.
- **getting-started.md 잔재 제거**: "바이오/의료: 샘플 핸들링" 등 응용 분야 2줄은 2026-02-05 클라우드 에이전트 커밋(35ddb0b)의 AI 생성 README 소개문 잔재로 확인 → 같은 섹션의 고아 코드 조각(`Robot.Home()`/`Move.Linear` 2줄, 설명 유실)과 함께 삭제. "주요 특징" 불릿 목록도 하나로 정리.
- **Test_robot 아카이브 반출**: `docs/archive/test-robot/` 5개 파일(handover, project-structure, version-management, automation, file-io-implementation)을 저장소 밖 `C:\Users\Doyun\Downloads\test robot\`으로 이동, 폴더 삭제. 원문은 git 이력(`docs/archive/test-robot/`)에서 열람 가능.
- **참조 정리**: mkdocs.yml nav의 "Test_robot 시절 문서" 절 삭제, CLAUDE.md 읽기 순서 각주, design-principles.md·file-io.md·networking.md의 아카이브 링크를 "저장소 밖 반출(git 이력에서 열람)" 서술로 교체, archive/README.md에 "반출된 문서" 절 신설, reviews/2025-12-08.md 주석 갱신.

### 검증

- `npm run docs:build`(mkdocs `--strict`) 통과. `archive/test-robot` 잔존 링크 grep — 남은 것은 전부 "git 이력의 ..." 안내 문구와 §1-AZ/§1-BA 이력 기록뿐(당시 사실이므로 유지).

### 남은 일

- 없음.

## 1-BC. 2026-08-18 세션(4차) — README 과포화 정리 (중복 압축·버전 표기 제거)

### 배경 (사용자 요청)

- 루트 README가 636줄로 과포화 — 중복 압축·불필요 내용 제거 요청.
- "현재 버전: **vX.Y.Z**" 같은 **수시로 바뀌는 내용은 README에 포함하지 않는다**(수정 부담).
- 확장 명령 표는 정리된 형태로 유지, 소개는 "무엇을 위한 확장인가" 중심으로.
- 언어 기능(자동완성/F12)은 셀링 포인트가 아님(100% 동작 확신 없고 혁신 요소 아님) — 제어기 연동·디버깅을 앞세울 것.

### 조치

- **README 636줄 → 209줄 재작성**:
  - "주요 변경 이력" 섹션(~175줄) 삭제 — CHANGELOG.md가 정본(모든 버전 커버 확인). 섹션 자체가 "v0.8.8 (현재)"로 이미 낡아 있었음(이중 관리 실패의 증거).
  - "현재 버전" 표기 제거. 소개를 목적 중심(GDE 대비 간극)으로 재작성하고 Brooks/GPL 원문 링크 유지, 기능 순서를 제어기 통합 → 디버거 → 언어 기능으로 재배치. 빠른 시작도 연결 → 배포 → 디버깅 순.
  - 명령 표를 package.json `contributes.commands` 기준 3그룹(연결·배포·실행 / 디버깅·모니터링 / AI 에이전트용)으로 재구성 — **존재하지 않는 `GPL: Deploy & Run` 제거**, `GPL: Start`/`Save to Flash`/`빠른 컴파일`/Push·Pull Breakpoints 반영.
  - 설정 표 20개 → 핵심 6개만 남기고 "Settings UI에서 `gpl.` 검색" 안내로 대체.
  - 프로젝트 구조 트리, 상세 디버그 실행 절차(방법1/2, v0.5.73+ Attach 실패 로그 포인트) 삭제/축약 — ai-handoff §4·runbook이 담당.
- **제거분은 저장소 밖 백업으로** (사용자 정정: 다른 프로젝트 문서로 옮기지 말고 §1-BB Test_robot 반출과 같은 방식으로 백업 후 제거): 정리 전 README 원본 전문(635줄)을 `C:\Users\Doyun\Downloads\GPL_language_backup\README_2026-08-18_정리전_원본.md`로 백업. 처음에 runbook으로 옮겼던 `gpl.ai.debug.*` 인자 예시·`{ok,...}` 반환 규약, Brooks 포트/콘솔 근거 문서 표, 1403 재연결 튜닝 안내는 runbook에서도 되돌림(git checkout) — 이 내용들은 백업 파일과 git 이력(HEAD:README.md)에서만 열람 가능.
- **pre-release-check.js 4.5 검사 전환**: §1-BA의 "README 버전 대조" → **"README에 버전 표기가 없어야 함"**. 표기 방치 사고(v0.8.8 6릴리스 방치)의 재발 방지책을 대조에서 표기 금지로 전환.

### 검증

- README에 `현재 버전:` 패턴 부재 확인(새 검사 로직 단독 실행 통과), `npm run docs:build`(mkdocs `--strict`) 통과. 코드(src) 무변경.

### 남은 일

- 없음.

## 1-BD. 2026-08-25 세션 — 이슈 #15·#17 통합: 배포 잠금(프로세스 간) + 배포 단계 UPLOAD ∥ STOP 병행 → COMPILE + "컴파일 필요" 상태

검토 문서(설계 근거·겹침 지도·결정표): Artifact `https://claude.ai/code/artifact/e5aa9332-0856-40d8-9242-a3fd6fce9541` (세션 산출물, 구현 *전* 계획 — 이 §가 정본). GitHub 이슈 #15, #17(보충 의견 포함).

### 증상 (사용자, 2026-08-20 실사용)

- **#15**: `gpl.deploy` 시 "배포가 이미 진행 중입니다" 경고가 원인 불명으로 뜸 — `deployInFlight`가 QuickPick/미저장 모달 대기 중에도 잡혀 있고, 경고에 누가/어느 단계/언제부터인지가 없음.
- **#17**: 쓰레드 동작 중 FTP 업로드는 무해한데 STOP을 업로드 앞에 강제 → autoOnSave가 쓰레드 하나만 있어도 전부 스킵, 전체 Deploy도 불필요하게 일찍 정지. 진짜 위험("업로드 도중 Compile/Start → 제어기 사망")은 프로세스 내부 boolean으로만 막혀 MCP·다른 창에는 열려 있었음. 보충 의견: STOP+settle 게이트는 제거가 아니라 **Compile/Start 직전으로 이동**.

### 원인 (소스 대조)

- `runDeploy`가 플래그를 세운 뒤 `runDeployCore`가 UI를 await(구 1449/1457행). 고정 경고 문자열 5곳. `deployInFlight`는 extension.ts 지역 변수 — F5 경로(`gplDebugSession._runDeployBeforeAttach`) 미참여, MCP는 무관.
- `deploy()` 순서 STOP→UPLOAD→COMPILE, autoGate 조건 2가 UPLOAD 전에 `total>0`이면 AUTO_GATE로 전부 스킵.
- Brooks 공식 문서(live 2026-08-25): `Start`는 컴파일하지 않음(`-compile` 스위치 별도), `Compile`은 "may not be actively executing in a thread". **→ 사용자 정정(같은 날): PA 제어기의 `Start`는 자체적으로 Compile을 수행한다(실사용 사실, §0.7).** 문서 회의주의 사례. 함의가 바뀐다: 재구성으로 생기는 "소스는 업로드됨, Compile 미수행" 상태는 "옛 바이너리 실행" 위험이 아니라 "에러 미검증(Start 시 자체 컴파일 실패 가능, Problems 연동 없음)"이며, Compile→Start 연속 실행은 컴파일 중복이라 피한다(한 번에 하나만).

### 조치

- **A. 배포 잠금** `src/controller/deployLock.ts`(vscode 무의존, 단위 테스트 12건): 메모리 레코드 + 파일 `%TEMP%/gpl-controller/<ip>.lock.json` `{version, owner, stage, since, heartbeat, pid, host}`. 획득은 `wx` 배타 생성, 갱신은 임시파일+rename, heartbeat 5 s(+업로드 onProgress), stale = pid 미존재 ‖ heartbeat 30 s 초과 ‖ 자기 pid 잔재 → 자동 정리 후 1회 재시도. release는 세대 토큰 + pid/since 일치 시에만 삭제(뒤늦은 finally가 새 보유자를 지우지 않음). `describeDeployLock` → "owner — stage, N초 경과". **강제 해제 버튼은 두지 않음**(안전 가드이므로; stale 자동 만료가 대체 — 결정표). 이 파일은 로그가 아니라 조정 프리미티브로 하드 규칙 1과 무관.
  - `deploy()`가 진입 시 획득/finally 해제(`DeployOptions.lockOwner`, 단계 배너마다 `setStage`). F5 경로 자동 참여. 보유 중이면 `failedPhase 'LOCKED'` + `lockHolder`(`makeLockedResult`).
  - `extension.ts`: `deployInFlight` 폐지 → `currentDeployLockHolder()` 조회 + `warnDeployBusy(action, holder, hint)`로 문구 통합([출력 보기] 버튼). `runDeploy`는 UI 전 조회만 하고 잠금은 `deploy()` 안(UI 뒤)에서. `gpl.saveToFlash`는 UI 뒤 `acquire('Save to Flash','FTP_MIRROR')`. autoOnSave flush는 잠금 중 재예약, LOCKED 결과면 changedFiles를 pending에 되돌림. `gpl.start`/`threadStart`/`ftpRun` 가드 교체.
  - `gplDebugSession`: `_waitDeployLockForStart` — 자동 Start/stopOnEntry Start 전 최대 20 s 대기, 계속 잡혀 있으면 Start만 보류(attach 유지).
- **B. MCP** `controller-mcp/src/deployLock.js`(읽기 전용, 파일 계약 동일, node:test 8건) + `index.js` `guardDeployLock`/`sendGuarded`: 첫 단어 `Compile|Start|Load|Unload`인 명령은 최대 `GPL_LOCK_WAIT_MS`(20000) 대기 후 진행, 초과 시 보유자·단계·경과와 함께 오류(우회 금지 문구). `controller_status`에 `deployLock` 필드. README 환경변수 표(`GPL_LOCK_WAIT_MS`/`GPL_LOCK_DIR`), `exportAgentSetup` CLAUDE 섹션에 규칙 추가. MCP는 FTP를 하지 않으므로 잠금을 쓰지 않음.
- **C. deployService 재구성 — UPLOAD ∥ STOP 병행**: `runUpload()`와 `runStopGate()`(`!skipStop`: Stop -all+settle / `skipStop`: Show Thread 프로브 → autoGate 조건 2 또는 사용자 Stop 확인)를 `Promise.all`로 **동시에** 시작하고 둘 다 끝난 뒤에만 진행(실패한 쪽이 있어도 업로드 완료 전에 돌아가 잠금을 풀지 않음) → 지연 삭제 → COMPILE → (START) → ERROR CHECK. 총 소요 = max(업로드, 정지). **의도 정정**: 첫 커밋 `f88cbd6`은 이슈 문장을 "UPLOAD → STOP 순차"로 읽어 구현했으나, 사용자 보충(#17 코멘트 2026-08-25 — 목적은 속도, Stop은 재시도로 오래 걸릴 수 있고 업로드와 동시 진행에 문제 없음)으로 병행으로 수정. **COMPILE과 START는 한 번에 하나만**(연속/동시 실행 안전성은 추후 테스트 — 사용자 결정; 현재 deploy() 호출자는 모두 skipStart이고 Start는 `gpl.start`가 별도). 단계 표시는 `[1/N] UPLOAD ∥ STOP (동시 진행)` 한 배너, 잠금 stage는 `UPLOAD+STOP`/`UPLOAD+THREAD_CHECK`. `mirrorProject({ deferDelete: true })` → `pendingDeletes` → settle 뒤 `removeRemoteFiles`(실행 중 원격 삭제 무해가 미검증이라 지연 — 결정표). autoGate 미충족은 `COMPILE_DEFERRED`(업로드 유지, Compile 보류), THREAD_CHECK 메시지는 "업로드는 완료됨, Compile 미수행". autoGate 진단 clear는 COMPILE 진입 시점으로. `DeployPhase` 타입 신설(LOCKED/COMPILE_DEFERRED). 트리 `stageMap`을 새 순서로. 클래식 경로의 Unload/Load 동기화는 COMPILE 단계 안이라 그대로 STOP 뒤.
- **D. "컴파일 검증 필요" 상태** `extension.ts compileStaleProjects`: COMPILE_DEFERRED/THREAD_CHECK/업로드 후 Compile 실패 시 set, Compile 성공(deploy·ftpRun) 시 clear. 트리 "프로젝트 상태"에 경고 노드(클릭→Quick Compile), 상태바 배지(`ConnectionStatusBar.setCompileStale`), `gpl.start`/`threadStart`는 `confirmStartWhenCompileStale` 모달 **"Compile만 실행 / 그대로 Start / 취소"** — Start가 자체 컴파일하므로(§0.7) "Compile만 실행"은 에러 확인만 하고 Start하지 않는다(Compile 직후 Start 연속 금지). 처음엔 "Compile 후 Start" 선택지였으나 §0.7 명시 후 같은 날 수정. 한계: MCP `compile_project`로 컴파일하면 확장은 모르므로 상태가 남는다(다음 확장 Compile 성공 시 해제).
- **E. 문서**: README 워크플로 3곳, package.json(`deployBeforeAttach`·`autoOnSave` 설명), runbook, instructions, broker 설계 표, CHANGELOG [0.8.15], §1-AV 낡은 서술 무효 표시, §3·§4.

### 검증

- `npm run compile` 통과, `npm test` **190/190**(신규 deployLock 12건 포함), `controller-mcp` `node --test` **18/18**(신규 8건), `npm run pre-release-check` 16/17 — 실패 1건은 "working tree clean"(미커밋 상태라 정상). 편집한 모든 파일 CRLF 유지 확인(→ **§1-BE 정정**: 이 저장소는 파일별 LF/CRLF 혼재이며 extension.ts 등 대부분은 LF — 각 파일의 기존 형식 유지가 맞는 표현).
- **실기기(G2400C) 미검증** — §3 체크리스트 ①~⑧. **C(재배치)는 제어기 명령 순서를 바꾸므로 하드 규칙 6에 따라 저속/시뮬레이션 검증 전 배포 금지.** 검토 문서의 권장은 "A·B·D(무영향) 먼저 배포, C는 검증 뒤"였으나 사용자 지시로 한 working tree에 모두 구현했다 — 분할 배포가 필요하면 C(deployService의 Phase 1/2 블록 + deferDelete + COMPILE_DEFERRED 처리)를 별 브랜치로 떼어낼 것.

### 남은 일

- §3 ①~⑧ 실기기 검증, #17 ④ 재현 절차 기록. 검증 후 이슈 #15·#17 종결 코멘트.
- GDE의 Compile/Start는 여전히 못 막는다 — 브로커(broker-workbench Phase 1–2) 전환 시 잠금 파일 writer를 브로커가 승계(파일 계약 유지).
- **Compile→Start 연속 실행 경로 검토(§0.7)**: F5 `deployBeforeAttach`(deploy Compile → `Start -break -bex`)와 FTP 뷰 '컴파일 & 실행'(`gpl.controller.ftpRun`)은 Compile 직후 Start를 보낸다 — Start가 자체 컴파일하므로 컴파일 중복. 안전성 테스트 후 F5는 "Compile 생략 + Start만" 또는 "Compile만"으로, ftpRun은 분리/제거 여부 사용자 결정.
- (선택, 사용자 요청 시) 경과 3분 초과 시에만 노출되는 "강제 해제" 버튼 + 2단계 확인.

## 1-BE. 2026-08-25 세션(후속) — 트리 쓰레드 제어 정비: 스텝 버튼 아이콘/명령 불일치 수정 + Step Into/Out·스택 보기 우클릭 메뉴 + `<STATUS>` 판정

### 증상 (사용자 질문)

- GPL Controller 트리에서 일시정지 쓰레드에 인라인 버튼이 재개·스텝 **2개만** 보인다 — "쓰레드 동작 종류가 더 다양하지 않나?"

### 원인 (소스 대조)

- 인라인 2개(Continue/Step)는 **의도된 설계**: 트리=가벼운 상태 확인·응급 제어, 세분 스텝은 디버그 어댑터(F10/F11) 몫(controllerTreeProvider `toThreadItem` 주석, 런북 §6). 인라인이 늘면 라벨 폭을 잡아먹는 문제도 있다(이미 `P...`로 잘림). 다만 대조 중 어긋남 3건:
  1. **`gpl.controller.threadStep`이 `Step <t>`(플래그 없음)를 보냈다** — GDE 실측·Brooks 문서 모두 플래그 없음 = step **into**인데, 아이콘은 `$(debug-step-over)`. 버튼 모양과 동작이 달랐고, 런북 "모든 step에 `-noerror`"도 빠져 있었다. 같은 파일의 `aiBuildStepCommand`(AI API·디버그 어댑터용)는 3모드를 올바르게 만들고 있었는데 트리만 안 썼다.
  2. **`threadBreak`/`threadContinue`/`threadContinueNoError`/`threadStep`이 `<STATUS>`를 보지 않고** 전송 직후 `refresh()`만 했다(하드 규칙 2 위반). `threadStop`·`gpl.ai.debug.stepThread`는 판정+정지 복귀 확인을 하고 있어 트리 경로만 느슨했다.
  3. **일시정지/에러 쓰레드에서 스택 보기 도달 불가**: 클릭=위치 이동 고정, 액션 QuickPick(`threadActions`)은 비정지 상태에만 연결, 우클릭 메뉴엔 Continue/Step/Stop만. `threadShowStack`/`threadShowLocation`이 `contributes.commands`에 미선언이라 메뉴에 올릴 수도 없었다.
- Brooks 문서(live 2026-08-25, `Console_Commands/step.htm`): `Step thread_name [-into] [-over] [-out] [-noerror]`, 스위치 없음 = `-into`, `-noerror` = 에러를 낸 스텝을 건너뜀. **`-out`은 GDE 캡처(2026-06-23)에 없어 실기기 미검증**(디버그 어댑터 Shift+F11은 이미 `-out -noerror`를 보내고 있었음 — 문서상 지원, 실측은 §3).

### 조치

- `src/extension.ts`(트리 쓰레드 핸들러 블록):
  - `sendThreadCommandChecked(cmd, failLabel)` — `parseStatus`로 판정, STATUS≠0이면 에러 메시지+`false`, Output에 `[Thread] >>> <cmd> => STATUS n msg` 기록.
  - `runTreeThreadStep(node, mode)` — `aiBuildStepCommand` **재사용**(디버그 어댑터·AI API와 명령 문자열 단일 소스) → STATUS 판정 → `waitForThreadPause`(5초) → `refresh()` → `gpl.controller.autoShowPausedLocation`(기본 true)이면 `threadShowLocation`으로 정지 줄 표시. 5초 내 미복귀(긴 모션 한 줄 등)는 팝업 대신 **상태바 5초 + Output**만(트리 폴링이 이어서 갱신).
  - `threadStep` = **over**(아이콘과 일치), 신규 `threadStepInto`/`threadStepOut`. `threadBreak`는 STATUS + 정지 복귀 확인 뒤 메시지(미복귀는 경고), `threadContinue`/`-noerror`는 STATUS 판정. `threadActions` QuickPick의 정지 항목도 3종으로(현재 정지 쓰레드는 클릭이 위치 이동이라 도달 안 되지만 표기 일관성).
- `package.json`: `contributes.commands` — `threadStep` 제목 "스텝 오버 (Step Over)", 신규 `threadStepInto`(`$(debug-step-into)`)/`threadStepOut`(`$(debug-step-out)`)/`threadShowLocation`(`$(go-to-file)`)/`threadShowStack`(`$(list-tree)`). `view/item/context` — **인라인은 그대로 Continue + Step(Over) 2개 유지**(라벨 폭·오조작 방지). 우클릭 paused: Continue/Step Over/Step Into/Step Out/Stop(`thread@1~5`), error: Continue -noerror/Stop, 신규 그룹 `threadInspect@1~2`(현재 위치 보기/스택 보기, `viewItem =~ /^gplThread-(paused|error|running)$/` — 구분선으로 분리됨).
- 문서: 런북(트리 전용 명령 목록, §6 스텝 안내에 트리 경로, GDE 실측 스텝 구문에 문서상 전체 구문·`-out` 미검증 표기), README 패널 항목 한 줄, CHANGELOG [0.8.18].

### 검증

- `npm run compile` 통과, `npm test` **190/190**, `npm run pre-release-check` 16/17(실패 1건은 "working tree clean" — 미커밋이라 정상). package.json 검사: commands 60개, `view/item/context` 42개, 메뉴→명령 미선언 0. 편집 파일의 **기존 줄바꿈 형식 유지**를 바이트 단위(CRLF 개수)로 확인 — 이 저장소는 파일별로 LF/CRLF가 **혼재**한다(extension.ts·package.json·ai-handoff.md·런북·README는 LF, CHANGELOG.md·controllerTreeProvider.ts는 CRLF). ※ Git Bash에서 grep에 ANSI-C 인용(`$'…'`)으로 CR 한 글자를 넘기면 빈 패턴이 되어 모든 줄을 세므로 CRLF 판정에 쓰지 말 것 — Python으로 바이트를 직접 세는 쪽이 안전(이번 세션에서 오판 발생 후 정정).
- **실기기 미검증** — §3 항목. 인라인 스텝의 의미가 into→over로 **바뀌므로**(하드 규칙 6) 저속/시뮬레이션에서 먼저 확인.

### 남은 일

- §3 ①~⑤ 실기기 검증. `Step -out` 실측 STATUS를 런북 "GDE 1402 실측 명령 포맷"에 기록.
- (선택) 일시정지 쓰레드 인라인에 Stop 추가 여부 — 오조작 위험 때문에 지금은 우클릭에만.

## 1-BF. 2026-08-25 세션(후속 2) — GitHub 이슈 #27·#26·#24·#23·#18 일괄 처리

### 증상 (이슈 5건, 모두 2026-08-25 실측 보고)

- **#27** Variables/Watch에서 시스템 `Location`(`Robot.Where(1)` 등)을 펼치면 값이 비어 보임(`X    (636)`).
- **#26** 디버그 hover/Watch에서 클래스 Property 값을 볼 수 없음(제어기 -eval `-780`).
- **#24** MCP 스레드 응답이 fields+raw+rawLines 3중 중복(15스레드 ≈ 6.5KB), `controller_status`가 "연결+스레드 목록"만, eval 결과가 원문 문자열.
- **#23** `GPL: Export AI Agent Setup`의 globalStorage MCP 사본이 확장 업데이트 후 갱신되지 않아 08-05판 구버전 서버(17도구, connect-per-command)가 계속 실행됨.
- **#18** 제어기 대시보드가 콘솔 값을 표로 옮긴 수준이라 상태 변화를 즉시 인지하기 어려움.

### 원인

- #27: 실기기 Location 덤프의 멤버 줄이 사용자 객체(`name, type, value` 3열)와 달리 **`name, value` 2열 + 주석 값**(`Type, 0 = Cartesian`, `Config, 1  = Righty`, `RefFrame, Null`)이다. `parseShowVariableMulti`가 2열이면 무조건 헤더(type)로 봐서 `X, 636` → type='636', value=''.
- #26: -eval은 **식의 마지막 요소가 사용자 Property/Function**이면 `-780`(체인 중간은 실행됨 — `LocationEx.GetCurCartPos().loc.X`는 636). 값 자체는 백킹 필드에 있고 객체 덤프에는 Private 포함 전체 필드가 **프레임 무관**하게 실려 온다. Private 필드 점 표기는 같은 클래스 프레임에서만(`-729` 아니면). `Me.x`는 `-712`. 확장은 `-780`을 안내 문구로만 바꿔 줬고, Property→백킹 필드 해석 단계가 없었다.
- #24: `parseThreadList`가 `{name, fields[9], raw}`만 만들고 도구가 rawLines를 또 붙임. `controller_status`는 `Show Thread -web` 1회. 연결 실패 시 원인(재부팅 중/서비스 다운/무응답) 구분 불가(#22 사고).
- #23: `copyBundleToStablePath`가 명령 핸들러 안에서만 호출됨(activate에 검사 없음). 번들 `McpServer version: '0.1.0'` 고정이라 나중에 비교를 넣어도 구별 불가. 사용자에게 알릴 신호 없음.
- #18: 대시보드 HTML이 숫자 표 위주, `setInterval` 메시지 미구현, 상태바 클릭이 연결 토글에 묶여 대시보드 진입 경로 없음.

### 조치

- **#27** `src/debug/showVariableParser.ts`: `isTypeToken()`으로 2열 줄의 두 번째 칸이 타입 토큰(스칼라/배열/`Object …`/`이름(…)`)인지 판별 — 타입이면 종전대로 헤더, 아니면 **값**(type '')으로. `Null`→`null`. `isLocationType`/`summarizeLocation`(Cartesian `(X, Y, Z | Yaw, Pitch, Roll) cfg=N`, Angles `Angles(a1, …)`, 소수 3자리)/`annotateLocationMember`(`ZClearance` 1E+32 → `(미설정)`). `gplDebugSession._makeVariable`이 `Object Location` 노드 값에 요약을 넣고, REPL 객체 출력은 2열 멤버를 빈 칸 없이 잇는다. `_formatEvalError`에 `-762/-763`(Location 타입 불일치 안내), `-712`(구문 불가) 추가. 테스트 5건(실측 픽스처 REAL_LOCATION_CART/ANGLES).
- **#26** `src/gplParser.ts`: `GPLSymbol.getterReturnExpr`(Get 본문이 `Return <식>` 한 문장일 때) + `hasGetter`(WriteOnly 구분). `extractSimpleGetterReturn`이 Property 다음 줄부터 `End Property`까지 훑음(Set 블록 제외, 주석 제거). `gplDebugSession._queryVariableStructuredSmart` ②-b: `-780`이면 `_propertyBackingCandidates`(Get 반환식 → 관례 `m_이름`) 순으로 치환 평가 → `-729`고 부모 식이 있으면 부모 덤프(Smart, depth+1)에서 `.m_이름` 멤버 추출 → 반환형 Location이면 `<식>.Pos` 우회. 결과 `via`를 hover/Watch/REPL에 `← m_armCount (Get 반환식)`로 표시. `Me.` 접두 자동 제거. **가상 Property 자식**: `members`/`expand` 스코프에서 헤더 타입(`Object RNDRobot`)의 클래스 Property를 `_propertyChildren`이 덤프 멤버에서 찾아 `presentationHint.kind='property'` 읽기 전용으로 추가(왕복 없음, 해석 불가는 `(프로시저 — 평가 불가)`, WriteOnly 제외). `_propertyIndexCache`(이름별·클래스별)는 `_buildSourceFileMap`에서 무효화. `evaluatableExpressionProvider._isCallable`: 해석 가능한 Property(`getterReturnExpr` 있음 또는 같은 클래스에 `m_이름` 필드)는 hover 허용. 파서 테스트 2건.
- **#24** `controller-mcp/src/parse.js`: `parseThreadList`가 9열을 이름 키(`state/statusCode/statusMessage/project/procedure/procLine/file/line`)로 매핑(fields/raw는 유지), `compactThread`/`summarizeThreads`/`parseShowVariable`(확장 파서 규칙 이식, 2열 Location 포함)/`isTypeToken`/`splitVarLine`. `statusHint`에 `-712/-762/-763`, `-780` 문구를 "마지막 요소" 규칙·`.Pos` 우회로 갱신. `index.js`: `controller_status(detail?)` = 연결·`summarizeThreads`·`Execute Controller.PowerEnabled`·배포 잠금·`server: BUILD`; 실패 시 `probeReachability`(ECONNREFUSED / ICMP ping(`TTL=` 판정) / 무응답 → verdict 문장); `detail`이면 compact 스레드 목록 + `ErrorLog -web ,10`. `simulation: null`(판별 명령 미확인 — 문서·저장소 어디에도 근거 없음, 사용자 확인 필요로 도구 설명에 명시). `show_threads(verbose?)`, `debug_snapshot`은 compact + `listLocals`(`Show Variable <thread> <frame>` — **문서상 구문, 실기기 미검증**으로 응답에 표기). `evalOne`: `parseShowVariable` 구조화, `Me.` 제거, `-780` → `m_<leaf>` 재시도 → `-729`+부모 → 부모 덤프 추출, `resolvedAs`. `eval_expression`/`evals`가 공유. node:test 23/23(+5).
- **#23** `scripts/bundle-mcp.js`: `define __GPL_MCP_BUILD_JSON__`(확장 버전·builtAt·git sha)과 사이드카 `out/mcp/gpl-controller-mcp.build.json`, 배너 2줄째에 빌드 표기. `index.js` `BUILD`/`BUILD_LABEL` → McpServer version, stderr ready 줄, 세션 로그 첫 줄, `get_session_log.server`, `controller_status.server`. `src/ai/exportAgentSetup.ts`: `syncStableBundleIfStale`(사본 있고 sha256 다르면 덮어쓰기+사이드카 복사; 사본 없으면 `absent`), `inspectAiAgentSetup`(번들/사본 해시·빌드, `.mcp.json` 등록·경로가 사본을 가리키는지·파일 존재, CLAUDE.md 블록 버전 표식 `<!-- gpl-controller-mcp guide version: x.y.z -->` 비교 → problems[]). CLAUDE 블록에 버전 표식+안내 문장. `extension.ts`: 활성화 시 `gpl.ai.autoRefreshMcpBundle`(기본 true)이면 동기화 → `updated`면 "v이전 → v현재 갱신, /mcp 재연결" 알림(+CLAUDE.md 구버전이면 "Export 재실행" 버튼); 신규 명령 `gpl.ai.checkAgentSetup`(`GPL: Check AI Agent Setup`, view/title `3_diag@5`) — 요약 알림+Output 상세. 대안 ③(런처 방식)은 자동 갱신으로 충분해 채택하지 않음.
- **#18** `media/dashboard.html` 재작성: 상단 상태 스트립(연결/고전원/스레드/에러 배지, 상태 변화 시 `flash`), 스레드 표(Error→Paused→Running→Idle 정렬, Idle 흐리게, 상태 변화 행 왼쪽 강조, 위치 `file:line`, 프로시저, lastStatus), 축 게이지(중앙 0 양방향 바, 축별 관측 |max|×1.05로 자동 스케일, Δ>0.01이면 "이동 중" 색), 직교 좌표 + XY 미니 SVG 플롯(관측 범위 자동, 최근 40점 궤적), 새 에러 줄 붉은 강조, 주기 `<select>`(0.5/1/1.5/3/5s)·일시정지·새로고침. `controllerDashboardPanel.ts`: `setInterval`(500~60000 clamp, 탭 열려 있는 동안만)·`pause`(자동 재예약 중단, 수동 새로고침은 1회 허용)·`config` 메시지로 UI 동기화. `connectionStatusBar.ts`: 연결 중 `$(dashboard)` 항목(우선순위 99, `gpl.controller.showDashboard`). 설정 `dashboardPollIntervalMs` 설명 보강.
- **부수 발견(#18 처리 중)**: `.gitignore`의 `media/`(옛 "Development files (local only)", db4c187) 때문에 `media/dashboard.html`이 **한 번도 커밋되지 않았다** → CI(release.yml, 클린 체크아웃) VSIX에는 대시보드 HTML이 없어 `fallbackHtml`("media/dashboard.html을 로드하지 못했습니다")만 떴을 것. 로컬 `npm run package`는 작업 트리 파일을 싸므로 이 PC에서만 정상. `.gitignore`에서 `media/` 무시를 제거하고 파일을 추적(이번 커밋). 같은 폴더를 참조하는 `extension.ts`의 `media/xmlBestPractices.html`은 파일 자체가 없다(XML 모범 사례 명령 — 별건, §3에 기록).
- 문서: CHANGELOG [0.8.19] 선기재, controller-mcp README 도구 설명, 런북 부록(-eval 규칙 요약), README 대시보드 한 줄.

### 검증

- `npm run compile` 통과, `npm test` **197/197**(+7: Location 파서 5, Property getter 2), `controller-mcp` `node --test` **23/23**(+5), `npm run bundle:mcp` → 스탬프 `v0.8.18 3d47377` 확인(사이드카 생성). 편집 파일의 기존 줄바꿈 유지(gplDebugSession.ts·connectionStatusBar.ts·CHANGELOG.md는 CRLF, 나머지 LF — Python 바이트 패치로 확인).
- **실기기 미검증** — §3 항목. 디버거 변경은 읽기 전용(Show Variable)이라 모션 위험 없음. MCP `controller_status`의 `Execute Controller.PowerEnabled`도 읽기.

### 남은 일

- §3 체크리스트(§1-BF) 실기기 검증. `debug_snapshot(listLocals)`의 `Show Variable <thread> <frame>` 응답 형식 실측 후 런북 "GDE 1402 실측 명령 포맷"에 기록.
- 시뮬레이션/실기 판별 명령 조사(Brooks 문서에서 근거 확인 후 `controller_status.simulation` 채우기) — 안전 게이트 자동 판단에 필요.
- (선택) 대시보드 축 게이지에 축 한계값(로봇 파라미터 DataID) 반영 — 현재는 세션 관측 범위 자동 스케일.
- **`media/xmlBestPractices.html` 부재**: `extension.ts`가 참조하지만 저장소·작업 트리 어디에도 없음(옛 media/ 무시 규칙의 희생물로 추정). XML 모범 사례 명령이 폴백/오류를 내는지 확인하고, 파일을 복원하거나 명령을 정리할 것.

## 1-BG. 2026-08-25 세션(후속 3) — GPL Traffic에 1402 응답 본문 실시간 표시 + 트리 "1402 통신 모니터" 항목

### 증상 / 요청

- 사용자: "1402 포트에서 무슨 통신하는지 볼 수 있는 기능" + "서로 뭐 보내는지 실시간으로" + "패널에 1402 포트 메뉴로 하나 추가". 확인해 보니 `GPL Traffic` 채널이 이미 있었지만 **송신(`>>>`)은 전문, 수신은 `<<< STATUS 0  N lines  Nms` 요약만** 기록해 제어기가 실제로 보낸 응답 본문이 전혀 보이지 않았다 — "서로 무엇을 보내는지"의 절반(응답 쪽) 누락. 사용자 질문 "GPL Traffic에서 1402 통신 전부 나오는 거야?"의 답은 **아니오**였다.

### 원인

- `controllerConnection.ts` `completeResponse()`가 STATUS 코드·줄 수·소요 시간만 `logTraffic('<<<', …)`로 남기고 `responseBuffer` 본문은 호출자에게만 돌려주었다.

### 조치

- **`src/controller/trafficResponseBody.ts` (신규, 순수 모듈)**: `ResponseBodyStreamer` — 소켓 chunk를 line-buffering 해 완성된 줄만 즉시 emit(마지막 조각은 다음 chunk/flush까지 보류, CR/LF가 chunk 경계에서 갈라져도 안전), 공백 줄 생략(`<<<` 요약의 줄 수 기준과 동일), `maxChars` 예산 초과 시 이후 줄 생략 + flush 때 생략 요약 1줄(`... 본문 N줄/M자 생략 (표시 상한 K자 — gpl.controller.trafficLogMaxResponseChars)`), 한 줄이 예산을 넘으면 예산만큼 + `…`. `flush()` 멱등(종료 경로가 겹쳐도 중복 출력 없음).
- **`controllerConnection.ts`**: `sendCommandDetailedInternal`이 명령마다 `getTrafficLogOptions()`를 읽어 on이면 streamer를 만들고 `data` 이벤트마다 `push`, **모든 종료 경로**(정상 `</STATUS>` 완료·idle 완료·타임아웃·error·close)에서 `flush` → 도착한 부분까지는 반드시 보인다. `logTraffic` 방향 표식에 ` | `(수신 본문 줄) 추가. `getTrafficLogOptions()`/`setTrafficResponseBodyEnabled()` export(설정 대상은 워크스페이스 값이 있으면 Workspace, 아니면 Global).
  - 1402 소켓을 여는 곳은 이 함수 하나뿐이고 디버그 어댑터도 `DebugAdapterInlineImplementation`(같은 확장 호스트)이라, 확장이 보내는 **모든** 1402 명령(디버거·트리 폴링·배포·명령 보내기)이 누락 없이 기록된다. `controller-mcp`는 별도 프로세스라 여기 안 잡힘(자체 `get_session_log`가 담당).
- **설정 2개**: `gpl.controller.trafficLogResponseBody`(기본 true), `gpl.controller.trafficLogMaxResponseChars`(기본 4000, 0=무제한).
- **트리 항목**: 연결 섹션 `1402 명령 포트` 아래 **`1402 통신 모니터`**(icon radio-tower, contextValue `trafficMonitorItem`) — 설명에 현재 모드(`명령 + 응답 본문 (≤4000자)` / `명령 + STATUS 요약만`), 클릭 → `gpl.controller.showTraffic`, 인라인 `$(eye)` 토글 + `$(clear-all)` 지우기, 우클릭 메뉴 3개(열기/토글/지우기).
- **명령 2개**: `gpl.controller.toggleTrafficResponseBody`("GPL: Toggle Traffic Response Body (1402)" — 토글 후 채널에 `--- 1402 응답 본문 표시: ON/OFF` 표식, 트리 `redraw()`), `gpl.controller.clearTraffic`("GPL: Clear Traffic Monitor"). `onDidChangeConfiguration`으로 설정 UI 변경도 트리에 반영. `ControllerTreeProvider.redraw()` 신규(1402 폴링 없이 다시 그리기 — 기존 set* 메서드들이 각자 fire 하던 것을 공용화할 수 있는 자리).
- 로그 형식 예 (` | ` 라인은 Live Log Terminal에도 `[1402]` 접두로 같이 흐른다 — logTraffic 공용 경로):

  ```
  [14:02:11.001] >>> [PLAIN][read-only/debug/thread state] 192.168.0.1:1402  Show Thread
  [14:02:11.034]  |  <DATA>
  [14:02:11.034]  |  MergeCode.Main    Running   ...
  [14:02:11.034]  |  </DATA>
  [14:02:11.034]  |  <STATUS>0,""</STATUS>
  [14:02:11.035] <<< STATUS 0  1 lines  34ms
  ```

### 검증

- `npm test` **203/203**(+6 trafficResponseBody: chunk 경계 보류·CR/LF 분할·공백 줄·멱등 flush·절단/생략 요약·무제한·경계값). `package.json` JSON 파싱 OK. 편집 파일 줄바꿈 유지 — `git ls-files --eol` 기준 mixed 없음(CHANGELOG.md·controllerConnection.ts·controllerTreeProvider.ts는 w/crlf, extension.ts·package.json·index.ts·README·ai-handoff는 w/lf; 인덱스는 모두 lf, autocrlf=true).
- **실기기 미검증** — §3 항목. 읽기 전용 로깅이라 모션 위험 없음. 성능: 줄 단위 `appendLine`, 기본 4000자 상한이므로 5초 폴링 `Show Thread`의 부담은 미미하다고 판단, 대용량 응답(ErrorLog·파일 덤프)은 상한으로 보호.

### 남은 일

- 실기기 확인은 §3 체크리스트(§1-BG) 참조.
- (선택) 1403 스트림 원문도 같은 ` | ` 규약으로 통일할지 검토 — 현재 1403은 `runtimeConsole.ts` 자체 포맷으로 GPL Traffic에 기록.
- (선택) Live Log Terminal에 본문 줄이 과다하면 터미널 쪽만 요약으로 두는 옵션 분리.

## 1-BH. 2026-08-26 세션 — GitHub 이슈 #20: VS Code 표준 디버그 키 복원

### 증상 / 판단

- `package.json`이 GPL 디버그 세션에서 `F9`를 `workbench.action.debug.continue`에 강제로 연결해 VS Code 표준 Toggle Breakpoint를 가로챘다. `Ctrl+Alt+I`의 `editor.debug.action.showDebugHover`도 최근 VS Code/Copilot의 Open Chat 기본키와 충돌할 수 있었다.
- DAP 어댑터는 VS Code 표준 `F5` Continue, `F9` Toggle Breakpoint, `F10/F11/Shift+F11` Step을 별도 기여 없이 지원하므로 두 오버라이드가 필요하지 않다. ~~GDE식 `F9=Continue` 옵트인은 사용자 수요가 확인되지 않아 새 설정으로 남기지 않았다.~~ → **같은 날 후속(§1-BI, 다른 세션)에서 이슈 #20 제안 2대로 옵트인 `gpl.keybindings.gdeStyle`(기본 off, `when: … && config.gpl.keybindings.gdeStyle`)을 추가했다.** 기본 동작(표준 키)은 동일하다.

### 조치

- `package.json`의 `contributes.keybindings` 두 항목을 제거했다. 확장이 더 이상 디버그 표준 키를 덮어쓰지 않는다. (§1-BI: `F9 → continue`는 `config.gpl.keybindings.gdeStyle` 조건부로 다시 등록 — 기본 off라 동작은 같다.)
- `gpl.debug.showValueOnCursorClick`의 마우스 클릭 즉시 값 표시는 키바인딩과 독립된 기능이라 유지했다. 키보드 호버가 필요하면 VS Code 표준 `Ctrl+K Ctrl+I`를 사용할 수 있다.
- `CHANGELOG.md` [0.8.19] Changed에 #20을 기록했다. 과거 버전의 F9/Ctrl+Alt+I 추가 기록은 당시 릴리스 이력이라 보존한다.

### 검증

- `package.json` JSON 파싱 OK, `npm test`가 TypeScript 전체 컴파일 후 **203/203 통과**. 첫 샌드박스 실행은 저장소 밖 `out/` 쓰기 권한 때문에 TS5033(EPERM)이 났고, 권한 승인 후 같은 명령이 정상 통과했다(코드 오류 아님). VSIX 설치 후 육안 확인: F9=Toggle Breakpoint, F5=Continue, Ctrl+Alt+I가 확장에 의해 점유되지 않음.

### 남은 일

- VSIX 설치 후 실제 키 동작을 한 번 확인하면 이슈 #20을 종결할 수 있다. → §1-BI에서 GitHub 코멘트와 함께 종결 처리(2026-08-26).
- ※ 기록: 이 §1-BH는 §1-BG 커밋(84f0062) 직전에 다른 세션이 작성했고 그 커밋에 함께 들어갔다. 같은 저장소에서 두 세션이 동시에 작업하면 이런 교차가 생긴다 — 커밋 전 `git status`/`git diff`로 의도치 않은 변경이 섞였는지 확인할 것([[git-unlock-tool]] 메모의 codex+Claude 동시 사용 리스크와 같은 뿌리).

## 1-BI. 2026-08-26 세션 — GitHub 열린 이슈 14건 일괄 처리 (#15~#28)

사용자 요청: "깃 이슈 하나씩 전부 해결 — 어려운 건 해결 방향을 댓글로, 바로 되는 건 권장 방식으로, 이전에 해결했는데 표시 안 한 것도 고려". 구현은 파일 단위로 겹치지 않게 나눠 병렬 에이전트(Workflow) 7개로 진행하고, `extension.ts`·`package.json`·문서는 통합자가 담당했다.

### 분류와 결과

| 이슈 | 판정 | 처리 |
|---|---|---|
| #15 #17 (배포 잠금·게이트 재배치) | 이미 구현(0.8.17, §1-BD) — 표시만 누락 | 종결 코멘트 + close |
| #18 #23 #24 #26 #27 | 이미 구현(0.8.19 선기재, §1-BF) | 종결 코멘트 + close (#18·#24는 이번 자원 지표 추가 포함) |
| #20 (단축키) | §1-BH(다른 세션)가 제거만 함 | 옵트인 `gpl.keybindings.gdeStyle` 추가(제안 2), 제안 3(고유 명령 기본 키)은 보류 사유·스니펫 코멘트, close |
| #19 (호버) | 구현 | 문제 1: 옵트인 `gpl.hover.showAfterClick` / 문제 2: (uri,version) 심볼 캐시 — 파서 메모이즈는 이미 있었음을 코멘트로 정정, close |
| #25 (connect 비대화형) | A·B 구현, C는 설계 | ConnectArgs·반환값·AI 명령 3개·URI 핸들러; C(확장↔MCP 브리지)는 브로커 Phase 1 통합 권고 코멘트, close |
| #16 (MCP 배치) | 구현 | `controller_command(commands[], stopOnError)` + `read_dataids` + `controller_status(detail).resources`, close |
| #28 (Step 연타) | 구현 | 어댑터 Step 게이트 + 최소 간격, close |
| #21 (Attach only stale BP) | 구현 | 컴파일 스냅샷 기록 → attach/저장 시 대조 → 상태바 배지·BP unverified·재시작 액션, close |
| #22 (제어기 다운) | 완화책 구현, 원인 미확정 | 1402 keep-alive·1403 churn/워치독·백업 폴 완화·FTP 스로틀·자원 지표·사후 스냅샷·도달성 판정; 분리 실험 계획 코멘트, **열어 둠** |
| #29 (호버 클릭 후 재표시 — 세션 중 #19에서 분리돼 신규 등록) | #19 처리로 이미 구현 | `gpl.hover.showAfterClick` 옵트인이 수용 기준 3항 모두 충족 — 종결 코멘트 + close |
| #30 (launch.json JSONC 파싱 실패 — 세션 중 신규 등록) | 구현 | `jsonc-parser` 도입, `src/launchJsonc.ts`(parseJsonc·describeJsoncErrors·detectFormatting·upsertLaunchConfiguration) — 읽기 2곳 통일 + 부분 갱신으로 주석/포맷 보존, close |

### 조치 (파일별 요지 — 상세는 각 모듈 헤더 주석)

- **1402 keep-alive (#22 제안 6)** — `src/controller/consoleSocket.ts`(신규, vscode 무의존)로 소켓 계층 분리, `controllerConnection.ts`는 얇은 래퍼. 모듈 소켓 1개(키 ip:port), **terminator-first(`</STATUS>` 버퍼 끝) 완료만 재사용**, idle/close/TIMEOUT/error 뒤 폐기(잔류 바이트 프레이밍 오염 방지), 재사용 소켓 0바이트 stale → 새 연결 1회 재시도(TIMEOUT은 이중 실행 위험으로 재시도 금지), 유휴 소켓 data/close/error 감시 + idle 타이머(30 s) + `setKeepAlive(10 s)`. 설정 `gpl.controller.keepAlive1402`(기본 true)/`keepAliveIdleCloseMs`. Traffic `--- 1402 CONNECT #n (keep-alive|single-shot)` / `--- 1402 CLOSE (reason)`. export `closeControllerConnection(reason)`(disconnect/연결 유실/deactivate에서 호출), `getConnectionStats()`(트리 `1402 명령 포트` 설명·대시보드 자원 카드에 표시), 트래픽 링버퍼 600줄 `recordTrafficLine`/`getRecentTraffic`(1403 라인도 runtimeConsole.logConsoleTraffic에서 밀어 넣음). 설계 편차: 폐기는 destroy 대신 FIN(end)+1 s 강제, 유휴 소켓 공백 바이트는 drop 대신 유지(로그만). 테스트: 로컬 net 서버 통합 13건 + 헬퍼 4건.
- **도달성 판정** — `src/controller/reachability.ts`(신규): `pingHost`(TTL= 판정, 한국어 ping 대응)·`tcpProbe`·`arpLookup`(인터페이스별 전부, OUI 00-14-FF=Precise / D8-43-AE=Micro-Star)·`describeReachability`(MCP 4분류 + 응답 장치 정체 힌트 — #22 "사후 진단 함정"). 테스트 24건.
- **연결 유실 사후 스냅샷 (#22 제안 4)** — `extension.ts writeConnectionLostPostmortem`: `%TEMP%/gpl-controller/postmortem-<ts>.log`에 도달성 verdict·1402 통계·1403 상태·배포 잠금·최근 트래픽 400줄. 알림 [사후 스냅샷 열기]. 유실 시 keep-alive 소켓 즉시 폐기.
- **1403 (#22 제안 1·5번째 다운 댓글 3)** — `runtimeConsole.ts`: 배치 완료 재접속 100→`gpl.runtimeConsole.batchReconnectDelayMs`(250, 하한 50); RECONNECT 스케줄 로그 **항상** 기록(종전 streak 게이트 억제가 17:45 침묵 판독 불가의 확정 원인); 모든 타이머를 `armReconnectTimer(delay, reason)`로 단일화(`_reconnectDueAt`); **15 s 워치독**(`runtimeConsoleGuards.decideWatchdogAction` 순수 판정: force-reconnect / fire-overdue-timer(+10 s) / destroy-stuck-connecting(connect timeout+10 s) / skip-reconnect-stopped) — start()에서 켜고 stop()/dispose()에서 끔; `ConnectStats`(누적·60 s 슬라이딩·이유별) → 스냅샷 `connectCount/connectsPerMinute/watchdogKicks`, `CONNECT (#N, reason)`, `CLOSE (… connects=N)`, 50회마다 요약. 소켓 없는 stop()·건너뛴 connect도 로그. 테스트 17건.
- **디버그 어댑터 (#28·#22 제안 2·#21)** — `gplDebugSession.ts`: ① Step 게이트 — `_pendingAction` step/continue(같은 스레드)·entry 중 새 step/continue는 명령 미송신·정상 응답만(`stepGate.shouldGateStepRequest` 순수 판정, `gpl.debug.minStepIntervalMs` 기본 100), 첫 무시 로그 + 50건마다, pending 해소 시 요약; Pause는 게이트 안 함. ② 백업 폴: `debugBridge.setRuntimeConsoleHealthProvider`(extension.ts가 runtimeConsole 스냅샷 공급)로 1403 alive면 `_pollIntervalMs`, 아니면 `gpl.debug.runningBackupPollMs`(1000). ③ stale: attach(`!deployBeforeAttach`)·저장·재컴파일 시 `deployRecord.compareWithLocal` → `_staleFiles` → BP `id` 부여 + `verified:false`+메시지(`BreakpointEvent('changed')`로 갱신) → 커스텀 이벤트 `gpl.sourceStale {projectName, compiledAt, staleFiles, trigger}`(trigger: attach/saved/recompiled/disconnect). 세부: 게이트된 요청은 success 응답만 보내므로 VS Code는 시뮬레이션 continued 상태가 된다 — pending이 있으면 그 해소 StoppedEvent가 UI를 복귀시키고, **pending 없이 최소 간격만으로 무시된 경우**(키를 뗄 때 마지막 반복)는 `_afterGatedStepRequest`가 쓰레드별 타이머(≥250 ms)로 정지 상태를 확인해 같은 위치 StoppedEvent를 재발사(제어기 명령 0회, 실제 step/continue가 나가면 취소). 저장 감지는 파일 sha1이 스냅샷과 같으면(무변경 저장·되돌리기) stale 해제. 복원은 제어기가 받아준 줄(`_breakpoints`)만 verified:true. 미결: Compile 후 제어기 Set Break 잔존 여부(잔존하지 않으면 재-setBreakpoints 유도 필요), 컴파일 뒤 추가된 .gpl의 BP STATUS, 간격 게이트를 '보류 후 1회 실행'으로 바꿀지.
- **컴파일 스냅샷 (#21 기반)** — `deployRecordCore.ts`(순수: `snapshotProjectFiles` .gpl/.gpo/.gpr sha1+size+mtime, `diffSnapshots` 대소문자·구분자 무시·sha1 우선, `DeployRecordStore` Memento `gpl.deployRecords`) + `deployRecord.ts`(vscode 래퍼, `onDidRecordCompiled`). `deployService.ts`: 스냅샷은 **UPLOAD 직전**에 찍고(업로드~컴파일 사이 편집 오판 방지) Compile 성공 확정 지점에서 `recordCompiled`(실패는 trace만). `extension.ts`: `attachDeployRecordStore(context.workspaceState)`, `gpl.sourceStale` → `statusBar.setSourceStale`(`connectionStatusBar` 3번째 항목) + 알림 1회, 명령 `gpl.debug.showSourceStale`(재시작 = stopDebugging → startDebugging({...configuration, deployBeforeAttach:true, stopAllBeforeAttach:true}) / 파일 열기 / 숨기기). 실측 65파일 스냅샷 7~12 ms. 한계: autoOnSave(changedFiles)는 저장 파일만 올리므로 업로드 안 된 디스크 변경이 "동기화됨"으로 기록될 수 있음.
- **트리 FTP (#22 제안 7)** — `ftpClient.listRemoteDirs(host, paths[])`(세션 1회, 경로별 error), `controllerTreeProvider`: 연결 확립 시 `refreshFtpIfStale/refreshSystemInfoIfStale`(5분·캐시·`ip|/GPL|flash` 키, `views/refreshThrottle.decideAutoRefresh` 순수), 유실 시 캐시 보존(당시 `_lossNotificationInProgress` 플래그 — §1-BK에서 `setConnected(false, {reason:'lost'})` 명시 전달로 대체, 플래그 제거), 명시 disconnect는 비움, 섹션 설명 `마지막 조회 HH:mm`+툴팁. 테스트 11건.
- **대시보드 자원 카드 (#22 제안 8)** — `resourceProbes.ts`(순수): `Show Memory`/`Show Network -tcp`/`-mbuf` 파서 + `buildResourceSnapshot`/`computeRates`/`ResourceHistory`(120점, 점 간격 ≥2.5 s, 증가율 기준 ≥5 s, 카운터 감소=리셋). **실기기 원문 형식 확정**: MCP 에이전트가 2026-08-25 세션 트랜스크립트에서 채록 — Show Memory `Main Memory:`+Free/Used 2줄(각각 Segments), -tcp BSD `netstat -s` 표(`conn. closed (includes drops)  13836`), -mbuf `mbufs:3072 clusters: 512 free: 223` / `drops waits drains` / `free:2725 data:292 …`. 확장 파서는 처음 요약 표기 기준으로 작성돼 실기기 원문에서 3필드가 틀렸고(established가 앞 줄 값, closed null, mbuf free null — `\s+`가 CR/LF를 넘는 문제·괄호 주석·free 위치) 통합자가 같은 줄 한정 매칭·라벨-뒤 패턴·clusters 줄 분리로 수정, 실기기 픽스처 테스트 3건 추가(25/25). `controllerStatus.fetchControllerStatus(cfg, {includeResources})`(기본 false), 패널 `gpl.controller.dashboardResourceProbes`, 웹뷰 카드(accepted/s 2/10 임계, clusters free ▼, drops/waits/drains 경고, 스파크라인 2개, 원문 details) + 확장 1402 connects 행.
- **MCP (#16·#22)** — `controller-mcp/src/batch.js`(`runBatch` for-await 순차, throw→`{ok:false,error}`, stopOnError→`stoppedAt/skipped`; `normalizeCommandInput`), `controller_command {command?|commands?(1~50), stopOnError?}`(단건 응답 바이트 동일), `read_dataids(ids 1~100)`(`pd` 읽기 전용, `parseDataIdResponse`: 따옴표 밖 첫 `=`, wrap 흡수, values 원문 토큰), `controller_status(detail).resources`(`parseResourceProbes`, `acceptedPerSec` 서버 메모리 직전 샘플). 도구 20→21. node --test 40/40, 가짜 1402 e2e 23/23. `exportAgentSetup.ts` CLAUDE 가이드: 배치 규칙·자원 관찰·"정지 확인 내장 도구 앞뒤 show_thread 금지"·"같은 스레드 Step 반복 금지(#28)".
- **connect 비대화형·URI (#25 A·B)** — `extension.ts`: `connectControllerWithArgs(ConnectArgs)`/`connectControllerInteractive()`/`finishConnect()`로 분리, `gpl.controller.connect(args?)`는 `isConnectArgs`일 때만 비대화형(트리/상태바/팔레트 회귀 없음), `ConnectResult{ok,ip,port,connected,error?,mode}`; `gpl.controller.disconnect(args?)` 반환값+silent; AI 계층 `gpl.ai.debug.connect/disconnect/getConnectionState`; `registerUriHandler`(`/connect?ip&port&save`, `/disconnect`, `/getState`, `/dashboard` — 모션 동작 제외), `activationEvents: onUri`; `gpl.ai.debug.loop` 미연결 시 비대화형 연결.
- **호버 (#19)** — `hoverProvider._docSymbolsCache`(uri,version), 폴백은 비-로컬만; `extension.ts` `gpl.hover.showAfterClick`(기본 false) 리스너: Mouse 단일 클릭·식별자 위·`editor.hover.delay` 뒤 `editor.action.showHover {focus:'noAutoFocus'}`, 디버그 중 제외.
- **launch.json JSONC (#30)** — 의존성 `jsonc-parser@^3.3.1`(VS Code 자체 설정 파서, 무의존 MIT). `src/launchJsonc.ts`(vscode 무의존): `parseJsonc`(allowTrailingComma), `describeJsoncErrors`(1-based 줄/열), `detectFormatting`(들여쓰기·EOL 감지), `upsertLaunchConfiguration(text, config)` — 빈 파일은 골격 생성, `configurations` 누락은 배열 생성, 같은 `name`은 `modify(['configurations', idx])`로 교체·없으면 `['configurations', -1]` 삽입(`isArrayInsertion`) → `applyEdits`. 교체되는 GPL 항목 내부 주석만 사라지고 나머지(최상위 주석·다른 구성·`${config:…}`·들여쓰기)는 보존. `extension.ts`: `readLaunchControllerInfo`(정규식 주석 제거 폐지)·`createOrUpdateLaunchJson`(전체 `JSON.stringify` 덮어쓰기 폐지, 변경 없으면 쓰지 않음, 오류는 줄/열과 경로 표시) 교체. 테스트 8건(#30 재현 입력·문자열 안 `/*`·오류 위치·포맷 감지·교체/삽입/골격/오류).
- **단축키 (#20)** — `package.json` keybindings: `F9 → continue`를 `when: … && config.gpl.keybindings.gdeStyle`로만(기본 off), `Ctrl+Alt+I` 제거(§1-BH). 설정 `gpl.keybindings.gdeStyle`.
- **문서** — README(디버거 절: 표준 키·Step 게이트·stale 배지 / AI 표: 연결 명령·URI / 호버 옵션), 런북(Command ID·인자 표·URI·BP 해제 규약·§4 Attach stale·§6 Step 게이트·금지 2항), controller-mcp README(§5 배치·read_dataids·resources, §7), CHANGELOG [0.8.19](§1-BH 중복 #20 항목 제거·날짜 08-26), 이 문서.

### 검증

- `npm run compile` 통과, `npm test` **329/329**(+126: deployRecord 13·ftpRefreshThrottle 11·runtimeConsoleGuards 17·keepAlive1402 17·reachability 24·resourceProbes 25·stepGate 11·launchJsonc 8), `controller-mcp` `node --test` **40/40**(+17), `npm run bundle:mcp` 성공, `npm run pre-release-check`는 'working tree clean' 1건만 실패(커밋 전 정상). 줄바꿈: 모든 편집 파일 기존 형식 유지(`git ls-files --eol` mixed 없음; 신규 파일 LF·BOM 없음). CHANGELOG는 종전 4줄이 LF였던 혼재를 CRLF로 정규화됨.
- **실기기(G2400C) 미검증** — §3 체크리스트(§1-BI). 모션 영향 없음(통신 패턴·읽기 전용 명령·UI). 단, keep-alive는 "제어기가 한 연결에서 연속 명령을 받는가"가 효과의 전제(안 받아도 무해 — CLOSE by peer 후 재연결).
- 교차 검증: 확장 `resourceProbes.ts`를 MCP 실기기 픽스처로 돌려 3필드 오류를 잡아 수정(위). 동시 세션이 남긴 §1-BH/CHANGELOG #20 중복은 최신 항목만 남기고 정리.
- **적대적 리뷰 Workflow(6 영역 → 발견 항목 검증)는 세션 한도로 6개 에이전트가 모두 실패**("session limit · resets 4:40pm")해 실행되지 못했다. 대신 통합자가 핵심 경로를 직접 읽어 검토: consoleSocket 재사용 판정·stale 재시도 범위(0바이트만, TIMEOUT 제외)·generation 가드·idle 소켓 감시, Step 게이트 재발사(정지 상태에서만, 실제 step 시 취소), stale 판정/저장 감지/재컴파일 복원, 워치독의 socket-exists 가드, MCP runBatch 순차성·단건 하위 호환 — 차단 결함 없음. 다음 세션에서 리뷰 Workflow를 다시 돌릴 가치가 있다(특히 gplDebugSession 변경분).

### 남은 일

- §3 체크리스트(§1-BI) 실기기 검증 — 특히 keep-alive 전제(a)(b)(c), Step 게이트 F12 홀드 재현, stale 배지, 자원 카드 값.
- #22 원인 축 분리 실험(확장 완전 분리 → attach → BP), 시리얼 콘솔 상시 캡처, 직결 NIC 고정 IP.
- #25 C(확장↔MCP 브리지)는 브로커 Phase 1과 통합 — `docs/development/broker-workbench-architecture.md`에 endpoint 파일 계약·`extension.claim(thread)` 반영 여부 결정.
- #20 제안 3(GPL 고유 명령 기본 키) — 사용 후 결정. #24 simulation 판별 명령 — 근거 확인 후 채우기.
- `Show Memory -all`의 File Descriptors(문서상 free ≤5면 I/O 정지 가능)가 가설 1과 직결 — 파서는 대응됨, 프로브 명령 전환은 실기기 확인 후.
- 대시보드 자원 이력은 패널 메모리에만(탭 닫으면 소멸) — 파일/채널 기록은 후속. FTP 캐시는 플랩 원인이 재부팅이면 최대 5분 낡을 수 있음(수동 새로고침) — 유실 전후 쓰레드 목록 비교로 재부팅 추정 시 강제 재조회 후보.
- 존재하지 않는 DataID(`pd 99999`) 실제 STATUS 확인 후 MCP `statusHint` 보정.

## 1-BJ. 2026-08-27 세션 — GitHub #32: 멤버 접근 hover의 수신자 타입 해석 (+ Property 디버깅 방향 논의)

### 증상 (이슈 #32, 2026-08-27 실기 관측, 확장 0.8.19 선기재본)

- `RNDRobot.org()` 프레임에서 `robotArmList(0).controlAxis`의 `controlAxis` hover → 디버그 hover 없음. 대신 뜨는 정적 hover는 **`RNDRobot`의 `Function controlAxis(axisName As String)`**(수신자는 `RobotArm`이고 그 클래스의 `controlAxis`는 `Return m_controlAxis` Property). 값은 `robotArmList` hover 덤프(`m_controlAxis = 4`)에 실려 오는데 `controlAxis` 위에서는 볼 수 없었다.

### 원인

- `evaluatableExpressionProvider.kindOf`가 현재 문서 심볼 + `symbolCache.findAllByName(name)`을 **이름만으로** 합쳐 `some(callable)` → `'callable'` → 규칙 1로 hover 차단. 동명 Function이 다른 클래스에 있으면 #26 예외(해석 가능 Property 허용)가 실행 기회조차 없다(provider가 undefined면 어댑터 폴백에 도달하지 못함).
- `hoverProvider`는 `word`를 `[\w.]`로만 모아 `robotArmList(0).controlAxis`에서 `controlAxis`만 남고, `findDefinition(lookupName)`(현재 파일 우선)이 `RNDRobot.controlAxis`를 뽑았다.
- `gplDebugSession._propertyBackingCandidates`도 `byName` 인덱스만 써서 동명 Property가 여러 클래스에 있으면 남의 백킹 필드를 먼저 시도할 수 있었다(이번 사례는 Property가 하나라 무해).
- 수신자 타입을 따라가는 코드는 completionProvider(`resolveQualifierType`)·definitionProvider(L473~)에 각자 있었고 공용화되지 않았다.

### 조치

- **`src/language/receiverType.ts` (신규, vscode 무의존 순수 모듈)**: `resolveReceiverHolder(receiverSegments, lookup)` — 첫 세그먼트 `Me`→감싸는 클래스 / 로컬·파라미터 타입 / 클래스·모듈 이름(정적) / 타입 있는 비-로컬 심볼(감싸는 클래스 필드 우선) → 이후 멤버 `returnType` 체이닝, 중첩 클래스 하강, 인덱싱된 `T[]`/`T()`는 요소 타입(인덱싱 없는 배열은 내장 Array라 실패). `membersNamed(lookup, holder, name)`(클래스 `className` 정확 일치·모듈 직속), `buildDocumentReceiverLookup(docSymbols, procRange, atLine, cacheFindAllByName)`(프로시저 범위 내 로컬, 사용 위치 위쪽 가장 가까운 선언, 문서+캐시 중복 제거). 원시 타입·내장 클래스·미해석은 undefined → 호출자가 **종전 이름 기반 보수 판정으로 폴백**(안전 규칙 1·2 유지).
- **`evaluatableExpressionProvider`**: 세그먼트 i>0은 `holderOf(i)`로 수신자 홀더를 구해 `kindOf(name, holder)`가 **그 홀더의 멤버만**으로 판정(그 이름의 멤버가 없으면 이름 전체로 폴백). 규칙 2도 세그먼트별 홀더를 쓴다.
- **`hoverProvider`**: `extractDebugExpressionAt`로 괄호 포함 수신자 체인을 되찾아 `findReceiverMember` → 수신자 클래스의 멤버(정확 일치 → 캐시 `findMemberInClass/Module`) 우선, 실패 시 종전 `lookupName` 조회. Output에 `[Hover Receiver] 체인.멤버: class X → property Y` 로그.
- **`gplDebugSession`**: `_propertyBackingCandidates(expression, className?)` 클래스 필터. ②-b에서 후보가 **둘 이상의 클래스**에 걸치면 부모 객체 덤프를 먼저 받아 헤더의 런타임 클래스(`_classNameOfType` → `Object RobotArm`)로 좁힌다(정적 추론보다 정확 — 어댑터는 실제 객체를 알 수 있다). 부모 덤프는 `getParentDump()`로 한 번만 받아 -729 폴백에도 재사용(종전보다 왕복 1회 절약). Debug Console 로그 `프로퍼티 후보 클래스 한정(#32)`.
- 테스트 `src/test/receiverType.test.ts` 13건(#32 픽스처: `robotArmList(0)`→RobotArm, 멤버 한정으로 Function 제외, 인덱싱 없는 배열 실패, 파라미터, 원시 타입, Me, 정적 접근, Function 반환형 체이닝, 중첩 클래스, 스코프/가림, 중복 제거).
- completionProvider/definitionProvider의 자체 수신자 해석은 **그대로 두었다**(동작 동일성 확인 후 이관 — §3).

### 이 세션의 Property 디버깅 논의 — 합의·사실·미결 (다음 작업자는 이 방향을 전제로)

- **합의(사용자)**: Property를 백킹 필드로 보여주는 현 방식(§1-BF)은 위험을 감안해도 유지·확대한다. 복잡한 getter(`Return m_x + 1`, `Return GetCurrentValue()`, `Return IIf(...)`, `Return m_data.Value`)도 "일단 보이는 게 베스트"이나, **확장이 getter 식을 직접 계산하는 방식은 채택하지 않는다**(연산 의미 차이로 잘못 보일 때 체감 위험이 더 크다 — 사용자 판단). 시스템 메서드 읽기 전용 화이트리스트도 보류(부담 큼). Property 값은 "실제와 다를 수 있음"을 사용자가 인지할 수 있게 **일반 변수와 시각적으로 구분**해야 한다.
- **사실 정리(코드·실측)**: -eval은 마지막 요소가 사용자 프로시저면 -780(실행 안 함), 체인 중간은 실행(§1-BF). hover 식은 항상 커서 세그먼트에서 끝난다(`cursorExpression.extractDebugExpressionAt`: `cursorSegment = segments.length - 1`) → **커서 leaf의 Property/Function은 hover로 실행되지 않는다**. 규칙 1의 "-eval은 Sub도 실행한다"는 서술의 근거는 공식 문서였고(이 문서 1056행 부근) 실기 -780 규칙과 다르다 → §3 실기 검증 항목(무해한 Sub로). 진짜 실행 위험은 괄호 없는 **중간** 세그먼트(`obj.GetArm.count`)인데 현재 게이트는 검사하지 않는다(GPL -eval이 괄호 없는 호출을 허용하는지 미확인).
- **불가 판정**: "프로그램이 마지막으로 getter를 실행했을 때의 반환값"은 1402로 관측 불가 — 반환값은 평가 스택의 임시값(Show Variable 대상 아님), `End Get` BP는 걸리지 않음(§1-BF 실측), getter `Return` 줄 BP는 모든 호출처·모든 스레드에서 걸려 자동 continue로 흘리더라도 실행 타이밍을 망친다.
- **미결(사용자 검토 중)**: ① 제어기가 계산한 getter 값을 얻는 유일한 후보 = 디버거 헬퍼 주입(프로젝트에 `Dbg` 클래스 추가, `Dbg.Cap(obj.prop).v` — 마지막 요소가 Public 필드라 -780 회피; **인자 안의 Property가 평가되는지 실기 확인 필요**, 사용자 프로젝트에 파일이 추가되는 부담). ② DAP `presentationHint.lazy`(debugprotocol 1.68 보유, VS Code가 눈 아이콘 "클릭하여 평가"로 렌더)로 Property를 시각 구분 + 한 번 클릭한 항목은 다음 정지부터 어댑터가 eager로 돌려주는 sticky 방식(사용자 요청 "직전 스텝으로 넘길 때 자동 반영"). ③ 읽은-시점 스탬프(정지 세대/시각/step 상대) 형식.

### 검증

- `npm test`(TypeScript 전체 컴파일 포함) **342/342 통과**(+13: receiverType 13건). 편집 파일 줄바꿈 유지 확인 (`git ls-files --eol`: gplDebugSession.ts·CHANGELOG.md는 w/crlf, evaluatableExpressionProvider.ts·hoverProvider.ts·test/index.ts·ai-handoff.md는 w/lf — 종전과 동일). 신규 2파일은 UTF-8 무BOM·LF.
- **실기기 미검증** — §3 항목. 읽기 전용(Show Variable) 변경만이라 모션 위험 없음.

### 남은 일

- §3 체크리스트(§1-BJ) 실기기 검증.
- completionProvider/definitionProvider 자체 수신자 해석 → `receiverType.ts` 이관(동작 동일성 확인 후).
- Property 디버깅 미결 ①②③ 결정 후 구현(§2에 등록).

## 1-BK. 2026-08-28 세션 — 제어기 연결 끊김 자동 감지 재설계 (`controller/connectionHealth.ts`)

### 증상 (사용자 보고)

- "제어기 연결 끊기는 걸 자동 감지 못하는 것 같다." 검토 결과 감지 로직은 있었으나 기본 설정에서 상태바가 바뀌기까지 1~3분, 디버그 세션 중엔 더 늦었다 — 사용자가 "감지 안 됨"으로 느끼는 것이 맞았다.

### 원인 (코드 확인)

1. 유실 판정이 `controllerTreeProvider.doRefresh`의 `Show Thread` 3회 연속 실패 한 곳뿐. 실패 1회 = `timeoutMs` 10 s인데, 실패 뒤에도 `return` 없이 내려가 `ErrorLog`·`Show Break`를 또 보내(각 10 s) 한 사이클 최대 30 s → 3회 ≈ 100 s(쓰레드 0개면 폴 간격 15 s라 ≈ 130 s).
2. 디버그 세션 중 `enterDebugMode`가 트리 폴링을 끄고, 어댑터는 자체 5회 실패로 `TerminatedEvent`만 보냈다. `gpl.controllerConnectionChanged`는 attach 시 `connected:true`만 발신 → extension.ts의 `connected:false` 분기는 도달 불가 코드였다. 세션 종료 후 트리 폴링이 재개돼 다시 3회 → 최대 ≈ 3분.
3. 끊김을 먼저 아는 신호 — 1403 `setKeepAlive(5 s)` → connect-failed/socket-error 백오프, 1402 keep-alive 보관 소켓 `CLOSE (by peer/error)`, 대시보드 4 s 프로브 `connected:false` — 가 판정에 연결돼 있지 않았다(표시/로그만).
4. 실패 종류 미구분(REFUSED도 3회), 첫 실패 뒤 정규 간격 대기, `trySendCommand`는 null만 실패라 부분 응답이 성공으로 카운터를 리셋.

### 사용자 결정 (2026-08-28)

- 프로브 타임아웃 **8 s**("5 s는 짧다"). 유실 판정이 나면 **연결 상태를 끊는다**(제어기가 다시 연결되지 않는 경우) — 유실 뒤 자동 재접속 루프는 두지 않음(재연결은 명시적 Connect). 나머지는 권장 방향대로.

### 조치

- **`src/controller/connectionHealth.ts` (신규, vscode 무의존)** — `ConnectionHealthMonitor`(상태 disconnected/connected/suspect; `reportProbe`/`reportHint`; 훅 onSuspect/onRecovered/onLost), `ConnectionHealthProber`(suspect 동안 `reprobeDelayMs` 1 s 간격 재프로브, 복구/유실/stop 시 종료, start 멱등·세대 토큰으로 늦은 결과 폐기), `classifyCommandFailure`(code 우선 → 메시지 errno 토큰: refused/unreachable/timeout/reset/closed/incomplete/other), `probeOutcomeFromResponse`(`<STATUS>` 존재 = 성공), `describeLoss`. 정책 `DEFAULT_CONNECTION_HEALTH_POLICY` = probeTimeoutMs 8000 / failureThreshold 3 / definitiveFailureThreshold 2(refused·unreachable) / reprobeDelayMs 1000 / hintCooldownMs 10000(복구 직후 힌트 잔향 무시). **힌트는 connected→suspect만 옮기고(단정 금지) 판정은 1402 프로브로만** — 하드 규칙(간접 신호로 단정 금지) 취지 유지.
- **`controllerConnection.ts`** — `getConnectionProbeTimeoutMs()`(설정 `gpl.controller.connectionProbeTimeoutMs`, 기본 8000·하한 1000; package.json 스키마 추가), `probeControllerCommand(cmd, cfg?, timeoutMs?)`(예외 없이 ProbeOutcome), `setHeldSocketObserver`/`HeldSocketEvent`·`ProbeOutcome` 재노출.
- **`consoleSocket.ts`** — reject에 errno 스타일 `code` 부착(`codedError`: 원 code / `COMMAND_TIMEOUT` / `ECONNCLOSED`), 보관 소켓 by-peer/error 관찰자 `setHeldSocketObserver`.
- **`controllerTreeProvider.ts`** — 자체 유실 판정(`CONNECTION_LOSS_FAILURE_THRESHOLD`·`consecutiveFailures`·`onDidLoseConnection`·`_lossNotificationInProgress`) 제거 → `onDidProbe(ProbeOutcome)` 발신. `doRefresh`는 `probeControllerCommand`로 폴하고 **실패 시 상세 폴 생략(return)**. 유실/해제 구분은 extension이 `setConnected(false, {reason:'lost'})`로 명시 전달.
- **`gplDebugSession.ts`** — `_probeThreadList()`(프로브 타임아웃, `fireDebugProbeResult`로 확장에 보고 — 디버그 중 유일한 프로브 경로), `MAX_POLL_FAILURES` 5→3(모니터와 동기), 실패 종료 시 `gpl.controllerConnectionChanged {connected:false, reason}` 발신. `debugBridge.ts`에 `onDebugProbeResult/fireDebugProbeResult`.
- **`extension.ts`** — `healthMonitor`/`healthProber` 생성, `handleConnectionLost(summary)`(종전 onDidLoseConnection 핸들러: 1403 정지·`setControllerConnected(false,{reason:'lost'})`·keep-alive 폐기·사후 스냅샷(+`## 유실 판정` 절)·알림). 프로브 공급: 트리 `onDidProbe`·`onDebugProbeResult` → `reportProbe`. 힌트 공급: 1403 `onDidStatusChanged`(connect-failed/socket-error만 — 빈 세션·Immediate EOF는 정상 폴링), `setHeldSocketObserver`(**error만** — by-peer FIN은 제어기의 정상 유휴 종료일 수 있어 제외), `setDashboardConnectionObserver`(connected=false), 어댑터 `connected:false` → `reportHint`. `setControllerConnected`가 모니터 상태 동기 + 해제 시 `prober.stop()`. `gpl.ai.debug.getConnectionState`에 `health` 추가. Output `[Health] 연결 의심 — <사유> → 1000ms 뒤부터 재프로브…` / `[Health] 연결 복구 — N회 실패 뒤…` / `[Controller] Connection lost — … <describeLoss>`.
- **`controllerDashboardPanel.ts`** — `setDashboardConnectionObserver`(pollOnce마다 connected/note 보고).
- 테스트 `src/test/connectionHealth.test.ts` 18건(분류·응답 판정·모니터 전이/임계/확정 임계/복구/힌트/쿨다운/명시 해제·prober 루프/멱등/stop 늦은 결과/예외/조기 복구).

### 예상 감지 시간 (추정 — Windows TCP 기본값 가정, 실기기 미검증)

| 상황 | 종전 | 이후 |
|---|---|---|
| 재부팅·연결 거부(REFUSED) | 10~30 s | 수 초(거부 2회) |
| 케이블 분리·전원 차단(무응답) | ≈ 100~130 s | 1403 keepalive(≈ 15 s) 또는 첫 폴 실패(≤ 5 s + 8 s) → 8 s 프로브 ×3(1 s 간격) ≈ 20~30 s |
| 디버그 세션 중 | 최대 ≈ 3분 | 위와 동일(어댑터 폴이 프로브) |

### 검증

- `npm run compile` 통과, `npm test` **360/360**(+18). 편집 파일 줄바꿈 유지(`git ls-files --eol`: controllerTreeProvider/controllerConnection/debugBridge/gplDebugSession w/crlf, 나머지 w/lf — 종전과 동일), 신규 2파일 UTF-8 무BOM·LF.
- **실기기 미검증** — §3 항목. 모션 무영향(읽기 전용 `Show Thread`·UI·상태 전이만).

### 남은 일

- §3 체크리스트(§1-BK) 실기기 검증.
- 후보(미착수): suspect 동안 상태바 표시(`확인 중…`); 유실 뒤 자동 재접속(현재는 사용자 결정으로 의도적으로 없음 — 원할 때만); 배포/REPL 등 일반 명령의 refused/unreachable 실패도 힌트로(현재 공급자는 프로브·1403·보관 소켓·대시보드·어댑터).

## 1-BL. 2026-08-28 세션 — 프로젝트 선택 규칙 공용화 + F5 다중 프로젝트 QuickPick + 탐색기 우클릭 메뉴

### 배경 (사용자 질문에서 출발)

- "확장이 프로젝트 이름·경로를 어떻게 정하나, 컴파일은 프로젝트를 고르게 하는데 디버깅은 왜 다르게 동작하나." 코드 대조 결과:
  - **프로젝트 이름**은 어디서나 `.gpr`의 `ProjectName`(없으면 폴더명). 원격 경로(`/GPL/<이름>`)는 배포에만 필요하고 디버거는 1402 명령에 이름만 쓴다.
  - **로컬 폴더 선택 규칙이 진입점마다 달랐다**: 수동 명령(Deploy/빠른 컴파일/Start/Save to Flash)은 `extension.ts` QuickPick, autoOnSave는 저장 파일 위치, F5 `deployBeforeAttach`는 어댑터 `_resolveDeployProjectDir`(projectDir → projectName 매칭 → 활성 파일 → **경로 정렬 첫 번째**)로 사람에게 묻지 않았다. 어댑터 자동 감지는 `Project.gpr` 고정 파일명만 찾고(`findProjectDirs`는 `*.gpr`), 두 폴더의 `.gpr` 이름이 같으면(`MergeCode`/`MergeCode Beta` 복사본) 둘 다 `/GPL/MergeCode`에 올라가 서로 덮어쓴다(미러라 상대 전용 파일 삭제까지).
- 사용자 결정: 다수 프로젝트면 항상 QuickPick으로 묻고, 폴더 우클릭 메뉴로 컴파일/디버깅/flash 저장을 할 수 있게 한다.
- (작업 태도 지적) 확장 동작 설명에 사용자의 다른 저장소(로봇 프로젝트 폴더)를 뒤져 예제를 인용한 것은 불필요했다 — 근거는 확장 소스로 한정할 것(auto memory에 기록).

### 조치

- **`src/controller/projectPickerCore.ts` (신규, vscode 무의존)**: `orderProjectDirs(dirs, lastPicked)`(최근 선택 맨 위·경로 정렬·중복 제거), `projectDirFromResource(path, dirs, isDirectory)`(폴더는 프로젝트 폴더 자체만 인정 — 상위 폴더로 하위 프로젝트를 임의 선택하지 않음; `.gpr`는 그 폴더; 소스 파일은 포함하는 가장 깊은 프로젝트 폴더, `path.relative` 기반이라 `MergeCode`/`MergeCode Beta` 접두어 혼동 없음), `filterDirsByProjectName(dirs, name, gprNameOf)`(폴더명 또는 `.gpr` 이름 일치).
- **`src/controller/projectPicker.ts` (신규)**: `pickProjectDirDetailed({ placeHolder, resource?, projectName?, silent? })` → `picked | none | not-found | cancelled`. 명시 리소스는 QuickPick 없이 확정(못 찾으면 QuickPick으로 넘어가지 않음 — 의도와 다른 대상 업로드 방지). 후보 1개 즉시, 2개+ QuickPick(label 폴더명, description `ProjectName=…`(폴더명과 다를 때)·`최근 선택`, detail 전체 경로). 선택은 `workspaceState['gpl.projectPicker.lastDir']`. `activateProjectPicker(context)`가 `**/*.gpr` 워처·워크스페이스 변경으로 context key **`gpl.projectDirs`**(감지 폴더 배열)를 갱신. `readGprProjectName`/`projectNameOf`도 여기로 이동(extension.ts 로컬 함수 제거).
- **`extension.ts`**: `pickWorkspaceProjectDir(placeHolder, resource?)`가 공용 모듈에 위임(Uri 인자만 인정 — 팔레트/트리에서 오는 비-Uri 인자 무시). `gpl.deploy`/`gpl.quickCompile`은 Uri가 오면 `overrideProjectDir`로 QuickPick 생략, `gpl.start`/`gpl.saveToFlash`는 Uri를 선택 함수에 전달. **새 명령 `gpl.debugProject`**("GPL: Debug Project (Deploy + Attach)") — 폴더 확정 → `{ projectName, projectDir, deployBeforeAttach: true }` 동적 구성으로 `startDebugging`(중복 세션 처리는 provider가 담당). `activateProjectPicker(context)`를 `activateDebug` 직전에 호출.
- **`src/debug/activateDebug.ts`**: `resolveDebugConfiguration`에 `fillProjectTarget(config)` — attach 구성에서 `projectDir` 명시면 그대로(`projectName` 비면 `.gpr`에서 보충); `projectName`만 있고 `deployBeforeAttach`가 아니면 묻지 않음(폴더 불필요); 그 외 후보 1개 자동, 2개+ QuickPick(`projectName`이 있으면 그 이름과 일치하는 폴더 안에서 — 같은 이름 폴더가 여럿인 경우). 취소 → `undefined`(세션 시작 안 함). 후보 0개 → 어댑터의 기존 폴백(Show Thread). **사용자가 명시한 `projectName`은 덮어쓰지 않는다.** 어댑터 시작 전(확장 호스트)이라 UI가 가능 — 어댑터의 `_resolveDeployProjectDir` 정렬-첫-번째 폴백은 사실상 도달하지 않게 됨(코드는 안전망으로 유지). 재시작 경로(`session.configuration` 재사용)는 이미 `projectDir`가 채워져 있어 재질문 없음.
- **`package.json`**: 명령 `gpl.debugProject`; `menus.explorer/context`에 Deploy/빠른 컴파일/Debug Project/Start/Save to Flash 5개(`when: explorerResourceIsFolder && resourcePath in gpl.projectDirs`, 그룹 `gpl_project@1..5`). **기준은 프로젝트 폴더(.gpr를 가진 폴더)만** — `.gpr` 파일 우클릭에는 띄우지 않는다(처음 `.gpr`에도 노출했다가 사용자 지적으로 제거, 2026-08-28). `resourcePath`와 `findProjectDirs`(uri.fsPath 기반)가 같은 표기라 `in` 비교가 맞는다(Windows 드라이브 문자 소문자 포함). `projectDirFromResource`의 `.gpr`/소스 파일 분기는 다른 진입점(명령 인자로 Uri를 넘기는 경우)용으로 유지.
- 테스트 `src/test/projectPicker.test.ts` 6건(정렬/최근 선택, 폴더 자체만 인정, 접두어 혼동 없음, `.gpr`/중첩/미포함, 이름 필터).

### 검증

- `npm test`(전체 컴파일 포함) **366/366 통과**(+6). 신규 3파일 UTF-8 무BOM·LF. 기존 파일은 Edit로 부분 수정(줄바꿈 유지).
- **VS Code 실동작 미검증(다음 작업자/사용자)**: ① 탐색기에서 프로젝트 폴더 우클릭 시 5개 메뉴 노출, 상위 폴더(`projects\`)·`Project.gpr`·일반 파일에는 미노출 ② 두 프로젝트 워크스페이스에서 F5(`projectName`·`projectDir` 없음) → QuickPick, 취소 시 세션 미시작, 선택 후 Debug Console `[deploy] Attach 전 배포 시작: <선택 폴더>` ③ `launch.json`에 `projectName`만 있고 같은 이름 폴더 2개 + `deployBeforeAttach: true` → 이름 필터된 QuickPick ④ 우클릭 → Debug Project가 `Start` 확인 게이트·배포 잠금·컴파일 stale 안내를 종전과 같이 타는지(모션 관련 — 시뮬레이션/저속). 제어기 명령 순서 자체는 바꾸지 않았다.

### 후속 (같은 날) — Project.gpr 소스 목록 동기화: `.gpr` 우클릭 메뉴 + 생성/삭제 시 자동 반영

- 사용자 요청: ".gpr 우클릭에는 다른 메뉴를 — 프로젝트에 .gpl을 일일이 입력하는 게 귀찮았다, 자동화해 달라." 참고 자료로 사용자가 직접 지정한 `C:\SVN\pa\trunk\develop\07. Others\37. 핵산 Oligo 합성과제\시뮬레이션\projects\MergeCode`의 `Project.gpr`를 읽어 형식을 확정했다(사용자 지정 경로만 읽음):
  - 첫 줄 `'MM/DD/YYYY, HH:MM:SS AM|PM` 주석(GDE 저장 시각) → `ProjectBegin` → `ProjectName="…"` → `ProjectStart="Main"` → `ProjectSource="파일명.gpl"`(파일당 한 줄, 폴더 기준 파일명) → `ProjectEnd`. ASCII, BOM 없음, **LF**. 63 `.gpl` = 63 항목(전부 등록됨). **`GModule.gpo`(바이너리 산출물)는 ProjectSource에 없음** → 기본 소스 확장은 `.gpl`만(`gpl.project.sourceExtensions`로 확장 가능).
- **`src/controller/gprSync.ts` (신규, vscode 무의존)**: `parseGprText`(EOL·끝 개행·타임스탬프 줄·ProjectEnd 줄·항목 줄 번호), `filterSourceFiles`(확장자·이름순), `planGprSync`(폴더에만 있으면 추가/목록에만 있으면 제거, 대소문자·구분자 무시), `applyGprSync`(기존 순서 유지, 추가는 `ProjectEnd` 앞, 제거는 줄 삭제, `now` 주면 타임스탬프 갱신, EOL·끝 개행 보존, ProjectEnd 없는 손상 파일은 보충), `createGprText`(새 .gpr, 기본 CRLF), `formatGprTimestamp`(12시간제 0패딩).
- **`src/controller/gprSyncCommand.ts` (신규)**: 명령 **`gpl.project.syncSources`**("GPL: Project.gpr 소스 목록 동기화") — `.gpr` Uri/폴더 Uri/팔레트(프로젝트 QuickPick) → 대조 → 추가·제거 항목 **다중 선택 QuickPick(기본 전체 체크)** → `WorkspaceEdit`로 전체 치환 후 저장(열려 있는 더티 문서와 충돌 없음, Undo 가능) → `symbolCache.refresh()`(Project.gpr 기반 인덱싱이라 목록 변경 시 필요) → 알림(+파일 열기). 이미 동기화면 상태바 메시지만. `.gpr` 없는 폴더는 "새로 만들까요?"(모달) → `createGprText`(ProjectName=폴더명, Start=Main). 소스 목록은 **폴더 재귀**(하위 폴더 포함) — 2026-08-28 §1-BW에서 변경. (종전 서술 "폴더 직속 비재귀"는 무효: `ProjectSource`가 실제로 상대 경로를 쓴다.)
  - **자동 반영 `gpl.project.autoSyncSources`**(`prompt` 기본 / `auto` / `off`): `workspace.onDidCreateFiles/onDidDeleteFiles/onDidRenameFiles`(VS Code 안에서의 조작만 — 에디터 밖 git checkout 등 대량 변경은 반응 안 함) → 파일을 포함하는 가장 깊은 프로젝트 폴더별 600 ms 디바운스(§1-BW: 종전에는 직속 파일만 반응) → 변경 계획이 있으면 prompt는 알림("반영" / "항목 선택…"), auto는 즉시 반영 + 상태바 요약.
- **`package.json`**: 명령·설정 2개, `explorer/context`에 `.gpr` 파일 전용 항목(`when: !explorerResourceIsFolder && resourceExtname =~ /^\.gpr$/i`). 폴더 메뉴(5개)와 분리 — 폴더는 배포/실행, `.gpr`는 목록 관리.
- 테스트 `src/test/gprSync.test.ts` 8건(실제 형식 픽스처: 파싱, 확장자 필터, 계획, LF/CRLF 보존, 타임스탬프, 손상 파일 보충, 새 파일 생성 라운드트립). **실제 MergeCode Project.gpr 드라이런**(읽기 전용 스크립트): 63/63 일치·추가/제거 0, 무변경 apply가 원본과 바이트 동일, 가상 추가/삭제 시나리오 정상 — 아래 검증 참조.
- 미검증(VS Code 실동작): `.gpr` 우클릭 메뉴 노출·폴더 메뉴에 미노출, 새 `.gpl` 생성 시 알림 → 반영 → GDE에서 `Project.gpr`가 정상 열리는지(형식은 GDE 저장본과 동일 규칙이나 GDE 재로드 확인은 사용자).

### 남은 일

- 어댑터 `_detectProjectName`의 `Project.gpr` 고정 파일명 → `*.gpr`로 통일(`findProjectDirs`와 일치). 이번에는 손대지 않음(provider가 대부분 선결하므로 영향 축소).
- Project.gpr 동기화: `ProjectStart` 검증(지정 프로시저가 소스에 있는지). ~~하위 폴더 소스 지원 여부 확인 후 재귀 옵션 검토~~ → **완료(§1-BW, 2026-08-28)**: GDE가 `ProjectSource="T1\T2\T2.gpl"`을 쓰는 것이 실제 파일로 확인되어 목록·참조·인덱싱을 모두 재귀로 통일했다(제어기 Compile 측 확인은 §3에 남음).
- 같은 `.gpr` `ProjectName`을 가진 폴더가 2개 이상 감지되면 업로드 전에 "같은 제어기 프로젝트를 덮어씁니다" 경고(사용자에게 제안만 한 상태).
- 트리뷰에 감지된 프로젝트 목록 노드(우선순위 3, 선택).

## 1-BM. 2026-08-28 세션 — GDE 1403 캡처 프레임 단위 재판독 → 1402 유휴 ping(GDE 방식 세션 유지) + 1403 UTF-8 디코딩

### 발단 (사용자 질문)

"1403이 통신을 안 하면 자동으로 끊기는 것 같다. 800 ms 간격으로 계속 뭔가 보내면 안 끊기지 않을까?" → "GDE는 어떻게 1403을 무난하게 유지했나? 1403으로 뭔가 계속 보냈던 건가?"

### 분석 — `captures/gde_1403.pcapng` (2026-06-23 13:29, pktmon, 로컬 전용·gitignore) 를 tshark + 파이썬으로 재조립

보고서(Artifact, 사용자 소유): https://claude.ai/code/artifact/7e2348da-ccdd-4f4c-b008-150620ea1266 — 스크립트는 세션 스크래치패드(`analyze_1403.py`, `build_report.py`)에 있었고 저장소에는 넣지 않음. 핵심 사실은 런북 "GDE 1403 실측 런타임 이벤트" 절에 정본으로 옮겼다.

- 80.6 s, 원시 1,956 프레임 → pktmon 계층 중복 제거 390, TCP 스트림 2개. S0(포트 50721, 캡처 전부터 열림, 42.8 s, **제어기 FIN**으로 종료) / S1(52229, FIN 1.07 s 뒤 SYN, 36.7 s, 캡처 끝까지 유지).
- **GDE → 1403 송신 = TCP keep-alive 프로브 ×8(1바이트 0x00, seq 미전진), 전부 S0.** (2026-08-28 재판독 정정: 애플리케이션 write가 아니다 — 1403은 구독·핸드셰이크 명령이 없는 순수 수신 스트림이다. 결론 "1403에 데이터를 써서 유지하려 하지 말 것"과 우리 구현은 그대로 유효하다.) 규칙: 송·수신 어느 쪽도 없이 5.00 s → NUL(수신으로도 리셋: 18.226 수신 → 23.236 송신). S1은 이벤트 공백이 최대 4.07 s라 NUL 0건.
- **NUL은 FIN을 막지 못했다**: S0은 마지막 이벤트(18.226) 뒤 침묵 24.6 s 동안 NUL 4개가 모두 1.5~3.5 ms에 ACK됐는데도 42.835 s 제어기 FIN. S1은 0바이트 송신으로 36.7 s 유지. → "1403에 무언가 보내서 유지" 가설 기각(800 ms 송신 불필요).
- **1403 수명은 1402 세션에 결부**(가설, 근거 3점 일치): ① GDE는 1402 단일 스트림을 70 s 캡처 내내 유지, `PD 234,-1,0,0`·`PD 601,-1,0,0`·`PD 2800,1,0,0`(2회 연속)·`PD 1700,-1,0,0` 을 **유휴 조건 없이 ~5.01 s 고정 주기**로 폴(2026-08-28 재판독 정정 — 종전 "유휴 5 s마다"는 부정확) → 1403 연속 수신 ② 확장이 명령마다 1402를 열고 닫던 시절(§1-BI 이전) 1403이 배치마다 FIN·Immediate EOF·30~40 connect/분(#22) ③ 1402 keep-alive 도입 뒤 `%TEMP%\gpl-controller\postmortem-2026-08-27T08-34-43-985Z.log`: `[1403] CLOSE (2661714ms, hadError=true, data=false …)` = **1403 세션 44.4분 유지, payload 0, FIN 없음**, 1402 `held 2673s`와 같은 초에 ECONNRESET(제어기 사망). 사용자가 느낀 "통신 없으면 끊김"의 유력 후보 = keep-alive 소켓의 30 s 유휴 종료(`keepAliveIdleCloseMs`)가 1403 FIN을 끌어내는 경로(미확정 — Traffic에서 `1402 CLOSE (idle 30s)` 직후 `[1403] CLOSE` 상관 확인 항목 §3). **2026-08-28 사용자 실사용 관측(0.8.20): 1403 연결이 해제되지 않고 계속 유지됨 — 종전의 “통신 없으면 끊김”은 재현되지 않아 해결로 처리한다. 다만 1402↔1403 결부는 여전히 가설이며(확정하려면 §3 ③ 대조 실험), Traffic 원문 대조는 하지 않았다.**
- **프레임**: type 1 `<E>1,N</E>\n`(11 B) + NUL(1 B)이 **항상 별개 세그먼트**(79/79) / type 3은 `<E>3,proj<L>N</L>msg</E>\n\0` 한 세그먼트, `<L>N</L>`=청크 바이트 길이 68/68 일치, 128 B 청크(21줄이 128+23), **UTF-8**(한글 줄 "2. DatStore 실제 데이터 저장소" 81 B 복원). 제어기 윈도우 17520 고정, PSH마다 세그먼트, 재전송·RST 0. pktmon 누락 8구간(`Previous segment not captured`)은 캡처 문제.
- **`<E>1,N</E>`의 N = 살아 있는 스레드 수**(가설, 근거 강함): `Thread started … Count: 1/2/3` 출력 9~98 ms 뒤 `1,2 → 1,3 → 1,4`, Stop `1,4 → 1,0`, Start `1,1`; 100 ms 격자 샘플링(S0 자유 실행에서 `1,2` 생략), Step마다 Running↔Paused 전환으로 같은 값이 100 ms 간격 쌍으로 반복(`1,4` ×51). 1402 캡처(11:47)와 동시 캡처가 아니어서 `Show Thread -web`과 직접 대조는 못 함(1402 캡처엔 AsyncSave 포함 5스레드, 1403 세션엔 `1,5` 없음 — 버전 차이 가능).
- 부수: 2026-06-23 당시 Test_robot이 로그 줄마다 `WARN(-510) … CreateDirectory failed /ROMDISK/tmp *File already exists*` 20회(프로그램 쪽). 제어기 로그 타임스탬프가 캡처 시각보다 2.0~2.6 s 늦음(시계 오프셋 추정).
- **확장 결함 발견**: `runtimeConsole.ts` 1403 수신을 `data.toString('ascii')`로 디코딩 → 상위 비트 소실로 한글 콘솔 출력 복구 불가.

### 조치

- **`src/controller/idlePing.ts` (신규, vscode 무의존)**: `shouldIdlePing`(순수 판정: enabled·intervalMs>0·inFlight==0·`now-lastActivityAt ≥ interval`) + `IdlePingScheduler`(noteCommandStart/End로 활동 보고, `tick()` 1 s 주기, ping 진행 중 중복 금지, 실패 통계·로그는 첫 회·10회마다). 테스트 `src/test/idlePing.test.ts` 7건.
- **`controllerConnection.ts`**: `getIdlePingOptions()`(`gpl.controller.keepAliveIdlePingMs` 기본 5000·0=끔·하한 1000, `keepAliveIdlePingCommand` 기본 `Show Thread` — 인자 없는 Show Thread는 실기기에서 빈 `<DATA></DATA>`, GDE도 사용), 큐 `enqueueControllerCommand`가 스케줄러에 활동 보고(큐 대기 중도 진행 중으로 셈), ping은 `probeControllerCommand`(프로브 타임아웃 8 s)로 보내 결과를 `setIdlePingObserver` 관찰자에게 넘김(실패는 throw → 통계). `setIdlePingActive(bool)`(Traffic `--- 1402 idle ping ON (every 5 s idle → Show Thread)` / `stopped (pings=…, failures=…)`), `getIdlePingStats()`. keepAlive1402 가 꺼져 있으면 ping도 안 나감.
- **`extension.ts`**: `setControllerConnected`에서 `setIdlePingActive(connected)`; ping 결과 → `healthMonitor.reportProbe`(유휴 중에도 5 s 주기 프로브가 되어 끊김 감지가 빨라짐 — 트리 폴·어댑터 폴과 같은 카운터). deactivate 시 관찰자 해제·중지.
- **`responseParser.ts`**: `latin1ToUtf8()` — 소켓 chunk는 latin1(바이트 1:1)로 문자열화해 프레임 경계를 찾고, 완성 메시지 단위에서만 UTF-8 디코딩. 테스트 3건(실측 한글 줄 81 B, 128 B 경계가 글자 중간에 걸린 두 청크를 이어 붙이면 온전·따로 디코딩하면 깨짐, ascii 복구 불가 근거).
- **`runtimeConsole.ts`**: `toString('ascii')` → `toString('latin1')`; `flushConsoleFrameBuffer`에서 청크 결합 후 `latin1ToUtf8`; `emitConsoleLine`(평문·비 type-3 프레임)도 디코딩; Traffic `<<<` 표시도 디코딩; `<L>N</L>` ≠ 청크 길이면 `[Console][RC1403] WARN=L_MISMATCH declared=… got=…` 세션당 1회(`_sessionLenMismatch`).
- **`package.json`**: 설정 2개 추가, `keepAliveIdleCloseMs` 설명에 ping과의 관계 추기.
- **문서**: 런북 "GDE 1403 실측 런타임 이벤트" 절 전면 갱신(위 사실·가설·미확정), "금지/제약"에 "1403에 데이터를 보내 유지하려 하지 않는다" 추가. CHANGELOG [0.8.20] Fixed(UTF-8)·Added(유휴 ping).

### 검증

- `npm run compile` 통과, 단위 테스트 384건 통과(신규 10건 포함 — 아래 실행 결과 참조). 실기기 검증은 §3.
- 설계 편차 메모: ping 명령을 GDE의 `PD 234…`가 아닌 `Show Thread`로 둔 이유 — DataID 234/601/2800/1700의 의미를 문서에서 확인하지 못했고(검색 무결과), `Show Thread`는 GDE 캡처와 확장 실측 모두에서 빈 응답이 확인된 최소 비용 읽기 명령이라서. GDE와 완전 동일 트래픽이 필요하면 설정으로 바꿀 수 있다.
- **실사용 확인 (2026-08-28, 0.8.20)**: 사용자가 “1403 포트 연결이 해제되지 않고 잘 유지된다”고 관측 — 종전의 유휴 시 끊김이 재현되지 않아 §3 체크리스트 ①②을 해결로 처리했다. 근거는 사용자 관측이고 Traffic 로그 원문 대조·30분 계측은 하지 않았다(대조 실험 ③는 §3에 남김).

### 남은 일

- 실기기: §3 항목(~~ping 켠 뒤 유휴 `[1403] CLOSE` 0건~~ → 2026-08-28 실사용 관측으로 해결, 1402 idle CLOSE ↔ 1403 CLOSE 상관 대조 실험, 한글 `Console.WriteLine`, `1,N` vs `Show Thread -web`, 포트 필터 없는 5분 pktmon으로 1404·FIN 트리거).
- `<E>1,N</E>`을 스레드 수로 확정하면: `1,0` = 전체 종료 즉시 판정(백업 폴 없이), N 변화 = 스레드 목록 갱신 트리거, 상태바 `threads: N`.
- 1403 배치 후 재접속 250 ms·빈 세션 5 s 백오프를 GDE(≈1 s 단일값)에 맞출지 — 유휴 ping으로 FIN 자체가 사라지면 불필요할 수 있어 관찰 뒤 결정.
- ~~디버그 어댑터가 별 프로세스로 자기 1402 연결을 갖는지 확인~~ → 확인(§1-BN): `activateDebug.ts`가 `DebugAdapterInlineImplementation`으로 등록해 **같은 확장 호스트 프로세스**에서 돌고 `controllerConnection.sendCommand`(같은 직렬 큐·keep-alive 소켓)를 쓴다. 별도 ping 불필요.

## 1-BN. 2026-08-28 세션 — URI 외부 진입점 전체 개방 + 제어기 명령 정책(지침 → 확장 자체 강제)

### 증상 / 요청

- 사용자가 설치본 `out/extension.js`의 `handleUri`를 읽고 "URI로 받는 action이 connect/disconnect/getState/dashboard 넷뿐 — GPL 확장의 모든 기능을 쓸 수 있어야 하지 않나" 지적. 이어서 원칙을 명시: **AI는 GPL 확장의 기능을 기본적으로 전부 이용할 수 있어야 하고 접근 자체를 막지 않는다. 특정 사고를 막기 위한 조건은 AI 지침으로 세우는 게 아니라 확장이 자체 제한 처리해야 한다.** MCP를 만든 목적이 AI가 학습해 본 적 없는 GPL 확장을 통해 자연스럽게 사용자를 보조(제어기 테스트·자료 검토·로그 확인)하게 하는 것이므로, 제한이 걸리면 안 된다.

### 원인(종전 구조)

- URI 핸들러(§1-BI, #25 B)는 "모션 유발 동작은 열지 않는다"는 허용 목록 방식이었고, 안전 조건은 (a) 디버그 어댑터의 stepGate(#28) 한 곳의 코드와 (b) 런북 "금지/제약"의 "외부 클라이언트는 스스로 정지 확인 뒤 다음 명령"(지침)에 나뉘어 있었다. 즉 트리·`gpl.ai.debug.stepThread(waitForPause:false)`·URI 경로의 Step/Continue 연타, Stop 접수 직후 Start(§0.6), Compile 직후 Start(§0.7)는 코드로 막히지 않고 지침에만 의존했다.

### 조치

- **명령 정책 `src/controller/commandPolicy.ts`(vscode 무의존, 순수)** — 모든 1402 명령이 지나는 `controllerConnection.sendCommandDetailed`의 직렬 큐 안에서 `before(command, io)` / `after(command, raw, statusReceived, now)`를 호출한다. 어느 경로(팔레트·트리·`gpl.ai.debug.*`·URI·인라인 디버그 어댑터)든 동일.
  - **R1 Step/Continue**: 같은 쓰레드의 직전 Step/Continue가 STATUS 0으로 접수되면 `pending`. 다음 Step/Continue는 `Show Thread -web` 재조회(300 ms 간격)로 정지가 관측될 때까지 **기다린 뒤** 보낸다(Step은 Idle/Stopped/Error/Paused/Break 관측, Continue는 Running 포함 어떤 상태 관측이면 해제; `-web` 전체 목록에 없으면 종료로 간주 해제; `Stop`이 나가면 즉시 해제). 그 뒤에도 `gpl.debug.minStepIntervalMs`(기본 100 ms)를 대기로 지킨다. Break는 게이트하지 않는다. 어댑터의 stepGate(무시)가 앞단에 있어 어댑터 경로에서는 거의 개입하지 않는다.
  - **R2 Start/Compile/Load/Unload**: 보내기 전에 `Show Thread -web`을 1회 이상 조회해 `Stopping` 쓰레드가 없을 때만 보낸다(있으면 정착까지 대기). **Running/Paused는 막지 않는다** — 다중 프로젝트 동시 실행은 정상이고 대상 프로젝트가 실행 중이면 제어기가 STATUS로 거부한다(그 판정은 제어기의 것, 하드 규칙 2). 응답을 못 받으면 "모름"이지 정착이 아니다.
  - **R3 Start**: 같은 프로젝트(`Load` 경로는 마지막 요소, 대소문자 무시)의 Compile 응답 완료 뒤 `gpl.controller.startAfterCompileGapMs`(기본 1500) 안이면 남은 시간만큼 대기. 0이면 없음.
  - 한도 `gpl.controller.transitionSettleWaitMs`(기본 8000, 하한 500) 안에 충족되지 않으면 **제어기에 보내지 않고** `PolicyError{code: 'resume-pending'|'threads-transitioning'|'threads-unknown'}`를 던진다(가짜 STATUS 없음). `registerAiDebugCommand`는 이를 `{ ok:false, error:'policy-hold', code, detail, sentToController:false }`로 돌려준다(통신 실패 `command-failed`와 구분 — AI가 "기다렸다 다시"를 판단할 수 있게). 일반 명령은 오류 메시지로 표시.
  - 승인 모달·거부 목록은 두지 않았다(사용자 결정). 기존 모달(`requireStartConfirmation`, Set DIO QuickPick, SoftEStop 복구 확인)은 그대로 — 필요하면 설정으로 끈다.
  - 정책의 상태 조회는 큐 슬롯을 쥔 채 `sendCommandDetailedInternal`을 직접 써서 재진입 교착을 피한다. 개입은 GPL Traffic `--- policy: R1/R2/R3 …`. `gpl.controller.commandPolicyEnabled`(기본 true)로 끄면 종전과 동일. `getConnectionState().commandPolicy`에 옵션 스냅샷.
- **URI 전체 개방 `src/controller/uriDispatch.ts`(순수) + `extension.ts` handleUri 교체** — `/<gpl.command.id>?args=<JSON>`, `/<gpl.command.id>?key=value`(숫자/불리언/JSON 자동 변환 → 객체 1개), `/command?id=…&args=…`. 별칭 4개는 종전 동작 유지. `gpl.*` 밖은 실행하지 않는다(임의 VS Code 명령 프록시 방지 — 범위 한정). 등록되지 않은 id는 경고. 결과는 Output `[URI] <id> => <요약>`.
- **쓰레드 명령 인자 정규화 `asThreadNode`(extension.ts)** — `gpl.controller.thread*` 10개가 트리 노드 외에 `{ threadName, project? }`·`{ name }`·문자열을 받는다(URI/AI 호출용). FTP 명령은 이미 `{ projectName, remotePath }` 평면 객체로 호출 가능.
- **문서**: README(URI 행·정책 문단·Step 문단), 런북(URI·명령 정책 절, 트리 명령 인자 형식, 금지/제약 3항을 "확장이 강제/MCP·raw만 주의"로), `.github/instructions` 6항 보강 + **7항 신설(AI 접근을 지침으로 제한하지 않음)**, §0.6·§0.7 주석, CHANGELOG [0.8.20] Added 2건, §4 핵심 파일.

### 검증

- `npm test`: 컴파일 통과, 단위 테스트 **414건 통과**(신규 `commandPolicy.test.ts` 22건·`uriDispatch.test.ts` 8건 — 가상 시계·스크립트된 Show Thread 응답으로 R1/R2/R3 대기·타임아웃·해제 조건, URI 해석/변환/범위 한정).
- 실기기 미검증 — §3 항목 참조. 특히 R2가 **모든** Start/Compile/Load/Unload 앞에 `Show Thread -web` 1회를 추가하므로 deploy()·ftpRun·F5 경로의 소요 증가(수십 ms~)와 Traffic 패턴을 확인할 것.

### 남은 일

- 실기기: §3 §1-BN 항목.
- ~~MCP 서버는 정책 밖~~ → §1-BQ에서 해결: Agent Bridge로 MCP의 1402 명령이 확장 세션을 타면 R1/R2/R3이 그대로 적용된다. 브리지가 꺼져 있거나 확장이 없을 때만 직접 접속(그때는 MCP 자체 정지 확인만).
- `Continue -noerror` 반복(런북 "원인 분석 전 반복 사용하지 않는다")은 명확한 기계 조건이 없어 정책에 넣지 않았다 — 사고 사례가 생기면 조건을 정해 R4로.
- 종전 §1-BI URI 검증 항목(§3 ⑨ `…/connect`)은 별칭이 그대로라 유효.

## 1-BO. 2026-08-28 세션 — 프로젝트명 공백 가드(1402 명령 인자는 공백 구분)

### 증상 / 배경

- 사용자가 Brooks 공식 문서(Compile·Load·Start)를 확인한 결과: 1402 콘솔 명령은 **인자를 공백으로 구분**하며 따옴표 같은 인용(quoting) 문법이 없다 — `Compile <project_name>`, `Load <project_path>`, `Start <project_name> [-break] [-bex]`. 따라서 프로젝트명(`Project.gpr` ProjectName = 제어기 `/GPL/<name>` 폴더명)에 공백이 있으면(`My project`) 제어기는 `My`를 이름으로, `project`를 옵션으로 읽는다 → "프로젝트 없음" 계열 STATUS로 실패하거나, 이름이 비슷한 다른 프로젝트를 대상으로 삼을 수 있다. 확장은 종전까지 이름을 그대로 템플릿에 끼워 넣었고(`Compile ${candidate}`, `Start ${projectName}`, `Load ${loadPath}` …) 검사가 없었다.
- (문서상 사실 — 실기기에서 공백 이름으로 실제 어떤 STATUS가 나는지는 미측정. 하드 규칙 3 원칙대로 "문서상"으로 표기.)

### 조치

- **단일 규칙 모듈 `src/controller/projectNameGuard.ts`(vscode 무의존, 순수)** — `checkProjectName(name)` / `checkRemotePath(path)`(→ `{ ok, problems[] }`), `isProjectNameSafe`, `suggestSafeProjectName`(공백 연속 → `_`), `describeProjectNameProblem(name, kind: 'project'|'folder'|'remote')`(원인+해결을 한 문장으로; 안전하면 `''`). 부적합 문자 = 유니코드 `\s` 전체(space·tab·NBSP·U+3000 …) + 제어 문자(U+0000–001F, 007F). 문자 클래스는 `new RegExp('[\\s\\u0000-\\u001F\\u007F]')` 식 이스케이프로만 적는다(원시 제어 문자를 소스에 넣으면 diff·편집기에서 보이지 않음 — 이 세션에서 실제로 두 번 발생해 고침). 빈 이름도 부적합.
- **적용 진입점(이름을 명령에 끼워 넣는 곳 전부)**:
  - `deployService.deploy()` — `.gpr` 파싱 직후 `projectName` 검사(FTP 업로드·1402 명령 하나도 보내기 전에 `failedPhase:'UPLOAD'`, `failedCommand:'Validate project name'`, `failedStatusMessage`=안내 문구로 반환 — "No .gpr" 실패와 같은 형태라 extension.ts의 기존 실패 표시 경로가 그대로 메시지를 띄움). Direct /GPL 모드가 아닐 때(`!directActive`)는 로컬 **폴더명**도 검사(클래식 경로 `/flash/projects/<폴더명>` → `Load <경로>`·Compile 후보로 쓰이므로).
  - `extension.ts` — 공용 `ensureProjectNameSafe(name, kind, action)`(로그 `[action] 중단:` + `showErrorMessage`)를 `gpl.start`(Start 전), 트리 `gpl.controller.ftpRun`(원격 폴더명·`remotePath` 둘 다), `gpl.controller.ftpUnload`에 적용. 그리고 `scheduleExpectedProjectSync`(워크스페이스 프로젝트 컨텍스트 감지)에서 `warnUnsafeProjectContextOnce` — 명령을 실행하기 전에도 **세션당 이름별 1회** `showWarningMessage`로 미리 경보.
  - `gplDebugSession.attachRequest` — `_projectName` 확정 직후 검사 → `sendErrorResponse(id 1004, '디버그 시작 중단 — …')`. (`deployBeforeAttach` 경로는 deploy()가 먼저 막고 1003 일반 문구 + Debug Console trace에 이유.)
  - `controller-mcp/src/index.js` `proj()` — 같은 정규식으로 검사해 throw → `tool()` 래퍼가 `isError` 결과로 반환(compile_project/start_project/unload_project 등 `proj()`를 쓰는 도구 전부).
- 이름을 **자동으로 바꾸지는 않는다**(Project.gpr·폴더·/GPL 폴더 셋을 함께 맞춰야 하고 사용자 자산이므로) — 안내 문구에 제안 이름(`My_project`)만 보여 준다.
- 문서: CHANGELOG [0.8.20] Added 1건, 런북 "금지/제약"에 1항, §4 핵심 파일.

### 검증

- `npm test`: 컴파일 통과, 단위 테스트 **423건 통과**(신규 `projectNameGuard.test.ts` 10건 — 통과/거부 문자 종류·등장순 중복 제거·앞뒤 공백·빈 이름·경로 세그먼트·제안 이름·안내 문구 구성).
- 실기기 미검증(§3 항목).

### 남은 일

- 실기기: 공백 이름 `Compile My project`를 raw로 1회 보내 실제 STATUS 코드를 확보해 위 "문서상"을 사실로 바꾸기(§3).
- 공백 외에 제어기가 거부하는 문자(`/`, `\`, `:` 등 파일시스템 예약 문자)가 있는지는 문서·실기기 미확인 — 확인되면 `UNSAFE_CHAR_CLASS`를 넓힌다(규칙은 한 곳).
- `Project.gpr` 문서 자체에 진단(빨간 줄)을 다는 것은 하지 않았다 — `.gpr`는 등록 언어가 아니고 컨텍스트 경고로 충분하다고 판단. 필요해지면 `diagnosticCollection`에 ProjectName 줄 범위로 추가.

## 1-BP. 2026-08-28 세션 — F5 개발 호스트를 "기본 VS Code + 우리 확장만" 환경으로 표준화(전용 프로필)

### 증상 / 배경

- 확장을 테스트할 때 F5로 뜨는 Extension Development Host가 **평소 쓰던 프로필을 그대로 상속**했다 —
  개인 설정(`settings.json`), 설치된 확장 수십 개, 창 위치·사이드바 배치까지. 사용자 환경에서만 되는 동작을
  "잘 된다"고 오판할 수 있고, 다른 확장과의 충돌·기본값 회귀를 볼 수 없다.
- 1차 시도로 `--user-data-dir`/`--extensions-dir`를 launch.json args에 넣었으나 **창 위치·설정이 그대로 유지**됐다.
  원인 확인(실측): 지정한 폴더에 F5 실행 흔적(`User/globalStorage`, `workspaceStorage`, `storage.json`)이 전혀
  생기지 않고 평소 `%APPDATA%\Code\logs`에만 새 세션 로그가 생겼다 → **F5 개발 호스트는 새 프로세스가 아니라
  현재 VS Code 프로세스 안의 새 창**이라 프로세스 단위 속성인 `--user-data-dir`은 무시된다(창 단위인
  `--extensions-dir`/`--disable-extensions`만 먹는다). 사실로 확정.

### 조치

- **`.vscode/launch.json` — 두 구성 모두 `--profile=GPL-DevHost`로 통일.** VS Code가 없는 이름이면 빈 프로필
  (기본 설정·확장 없음)을 자동 생성하므로 별도 준비 작업이 필요 없다. 프로필은 창 단위 속성이라 F5에서 정상
  동작하며, 이것이 VS Code가 권장하는 격리 방식이다. 파일 상단에 위 판단 근거를 주석으로 남겼다.
- **여는 폴더를 확장 저장소 → `samples/hello-project`로 변경.** `--profile`은 "폴더 ↔ 프로필" 연결을 기억하므로
  저장소 폴더를 개발 호스트로 열면 **평소 창에서 저장소를 열 때도 GPL-DevHost 프로필로 열려** 개발 환경이 망가진다.
  샘플 폴더로 분리해 그 부작용을 없앴다.
- **`samples/hello-project/` 신규**(`Project.gpr` + `Main.gpl`) — 제어기 없이도 IntelliSense·개요·정의 이동·진단·호버를
  확인할 수 있는 최소 GPL 프로젝트. `.gpr`는 §1-BL/gprSync가 파싱하는 실제 형식(ProjectBegin/Name/Start/Source/End).
  `.vscodeignore`에 `samples/**` 추가로 VSIX에는 싣지 않는다.
- **`npm run dev:host` 부활** — `npm run compile && code --new-window --extensionDevelopmentPath=. --profile=GPL-DevHost samples/hello-project`.
  같은 환경을 디버거 없이 별도 프로세스로 여는 용도(F5는 중단점이 붙는 대신 부모 프로세스 공유).
  2026-03-10에 "새 창이 뜨는 것을 막으려고" 비활성화했던 것인데, 사용자 확인 결과 **당시 경험 부족에 따른 조치**였고
  표준 권장 방식으로 되돌리기로 결정. `dev:install`·`dev:cycle:open`은 실체가 없어 그대로 삭제.
- **`.github/instructions/gpl-release.instructions.md`의 "절대 금지" 절 교체** — 명령 자체를 금지하는 대신
  "창 열기·설치 명령은 **사용자 요청이 있을 때만**"으로 규칙의 층위를 올렸다(금지 목록 나열 → 원칙 1개).
  §1-BN의 결정(접근을 지침으로 막지 말고 필요한 조건만 충족)과 같은 방향이다.
- `CLAUDE.md` "자주 쓰는 명령"에 F5/`dev:host` 설명 추가.

### 검증

- `npm test` — 컴파일 통과, 단위 테스트 **423건 전부 통과**(코드 변경 없음, 설정·샘플만 바뀌어 회귀 없음 확인).
- `--user-data-dir` 무시는 위 "배경"대로 파일시스템 흔적으로 실측 확인.
- **미검증(사용자 확인 필요)**: 실제 F5 실행 시 GPL-DevHost 프로필이 생성되고 기본 UI 상태(창 위치·사이드바)로
  뜨는지, 확장 목록에 우리 확장만 보이는지. AI가 임의로 창을 열지 않기로 했으므로 사용자가 직접 누른다(§3).

### 남은 일

- 테마 등 개인 취향은 개발 호스트 창에서 **한 번만** 설정하면 GPL-DevHost 프로필에 저장되어 유지된다
  (Extensions 뷰에서 테마 확장 설치 → Ctrl+K Ctrl+T). 저장소에 개인 설정을 커밋하지 않기 위해 의도적으로
  자동화하지 않았다.
- 프로필을 완전히 초기화하려면 개발 호스트 창에서 프로필 관리 UI로 GPL-DevHost를 삭제하면 다음 F5에서 재생성된다.
- 제어기 연동(Deploy/Start/디버그)을 개발 호스트에서 시험할 때는 launch.json 마지막 인자를 실제 프로젝트 폴더로
  바꾸거나, 개발 호스트 창에서 그 폴더를 열면 된다(그 폴더도 GPL-DevHost에 연결됨에 유의).

## 1-BQ. 2026-08-28 세션 — Agent Bridge: MCP가 제어기에 직접 붙지 않고 **확장을 사용**하게

### 증상 / 요청

- 사용자: "지금은 자꾸 AI가 **'제어기는 정상이고, 1402 채널을 VS Code가 이미 점유하고 있습니다'** 라는 말을 반복하며 테스트를 GPL 확장을 통해 하지 않는 것 같아." 이어서 의도를 명확히 함 — **"MCP 서버(controller-mcp)에서 AI가 GPL 확장을 더 잘 사용할 수 있도록"** 고쳐 달라는 것이었다(직전 §1-BN에서 확장 안쪽만 고친 것은 의도 오해).

### 원인

- MCP 서버는 `ControllerConsole`(`controller-mcp/src/console.js`)로 **제어기 1402에 직접 TCP**로 붙는 별도 프로세스다. 확장은 keep-alive 세션 + 유휴 ping(§1-BM)으로 1402 세션을 계속 쥐고 있으므로 두 세션이 경쟁한다. MCP 쪽 명령이 지연·실패하면 AI가 관측할 수 있는 사실은 "제어기는 ping/TCP로 살아 있는데 내 명령이 안 된다"뿐이라 **"VS Code가 점유 중"이라는 결론에서 멈췄다**.
- 확장을 쓸 통로가 없었다: URI(#25 B, §1-BN에서 전체 개방)는 **일방향**이라 결과를 못 받고, 확장↔MCP 브리지(#25-C)는 설계만 있고 구현이 없었다. 공유 자원은 배포 잠금 파일 하나뿐(읽기 전용).

### 조치

- **파일 IPC 브리지 신설** — 확장 `src/controller/agentBridge.ts`(vscode 무의존, 실행자 주입) ↔ MCP `controller-mcp/src/extensionBridge.js`. 배포 잠금과 같은 `%TEMP%\gpl-controller\` 계약을 쓰므로 **새 포트·서버·의존성이 없다**.
  - presence `<ip>.extension.json` — pid·확장 버전·ip/port·connected·debugSessionActive·heartbeat(5 s)·bridge{enabled,reqDir,resDir}. stale 15 s 또는 pid 사망이면 없는 것으로 본다. 확장 활성화/연결 변화/디버그 세션 시작·종료 때 갱신, `deactivate`에서 삭제.
  - 요청 `bridge/<ip>/req/<id>.json` → 응답 `bridge/<ip>/res/<id>.json`. 확장은 `fs.watch` + 300 ms 스캔 폴백으로 감지해 **순차** 실행하고(제어기 단일 명령 스트림 원칙) 결과를 쓴다. 요청은 읽는 즉시 삭제(중복 실행 방지), TTL 지난 요청은 실행하지 않고 `stale-request` 응답, 응답은 5분 뒤 청소.
  - 실행 범위는 `gpl.*`로 한정(임의 VS Code 명령 프록시 방지 — uriDispatch와 같은 규칙). 등록되지 않은 명령은 `unknown-command`.
- **확장 진입점**: `gpl.controller.sendCommand`가 인자를 받으면 **비대화형**으로 실행하고 `{ok, command, status, raw, statusTagReceived}`를 반환한다(인자 없으면 종전 입력 상자). `Compile`은 자동으로 `waitForStatusClose`. 정책 보류는 `{ok:false, error:'policy-hold', code, sentToController:false}`.
- **MCP 라우팅**: `sendGuarded`가 브리지 가용이면 `gpl.controller.sendCommand`로 보낸다 → 1402 트래픽이 **확장의 직렬 큐·keep-alive 세션·명령 정책(R1/R2/R3, §1-BN)**을 그대로 타고 GPL Traffic/Output에도 남는다. `controller_status`·`show_thread(s)`·`Execute Controller.PowerEnabled` 등 직접 `consoleClient.send`를 쓰던 경로도 모두 `sendGuarded`로 통일.
  - `GPL_BRIDGE=auto`(기본)/`only`(브리지 필수)/`off`(종전 동작), `GPL_VSCODE_CLI`(확장 깨우기용 CLI). presence 재확인 3 s 캐시.
  - **폴백 규칙(안전)**: 명령이 실행되지 않았음이 확실한 실패(presence 없음·요청 거부)면 직접 전송으로 넘어가고, **모호한 실패(bridge-timeout·command-failed)는 조회 명령만** 재전송한다(`isRetrySafeCommand`) — Step 중복(두 줄 진행)·Start 중복(컴파일 중복) 방지. `policy-hold`는 직접 접속으로 **우회하지 않는다**(정책 무력화 금지).
- **MCP 신규 도구 2개**: `extension_status(wake?)` — 확장 실행 여부·버전·pid·연결 상태와 **현재 전송 경로**(extension-bridge/direct-tcp)·사유·다음 조치. 설명에 "1402 점유라고 추측하지 말고 이 도구로 확인할 것"을 명시. `wake:true`면 `code --open-url`로 확장 활성화 시도(URI 진입점 재사용). / `extension_command(command, args?, timeoutMs?)` — 확장 명령 실행(Deploy·Quick Compile·Start·브레이크포인트 동기화·`gpl.ai.debug.*`·진단 스냅샷 …). 즉 **MCP에서 확장 기능 전체를 쓸 수 있다**.
- `controller_status` 응답에 `transport`(경로·확장 정보·힌트) 추가, 연결 실패 힌트도 경로에 따라 다르게(브리지 경로면 "점유 문제 아님"을 명시). 서버 시작 stderr에 `extension bridge: ON/OFF` 한 줄.
- 설정: 확장 `gpl.agentBridge.enabled`(기본 true).

### 검증

- 확장 `npm test`: **434건 통과**(신규 `agentBridge.test.ts` 11건 — 경로/staleness/요청 검증/왕복/도메인 실패 전달/예외/거부 3종/TTL/순차 처리/presence 생명주기).
- MCP `npm test`: **51건 통과**(신규 `test/extensionBridge.test.mjs` 11건 — presence 5가지 사유 구분, 손상 JSON, id 안전성, 가짜 확장과의 요청/응답 왕복, 타임아웃 시 요청 회수, 범위 한정, mode off/auto, 재전송 안전 판정, 힌트).
- 실기기·실환경 미검증(§3).

### 남은 일

- 실기기: §3 §1-BQ 항목.
- 브리지 요청은 확장에서 **순차 처리**된다 — `gpl.deploy`(수 분)를 브리지로 실행하는 동안 다른 브리지 요청(상태 조회 등)이 뒤에서 기다린다. 실사용에서 불편하면 "조회 명령은 별도 레인" 같은 완화를 검토(현재는 예측 가능성 우선).
- MCP 번들(`scripts/bundle-mcp.js`, esbuild)이 새 모듈을 포함하는지 패키징 시 확인 — import 추적이라 자동이지만 globalStorage 사본 갱신 뒤 `extension_status`로 실동작 확인 권장.
- 브로커 통합(§2 Broker+Workbench)으로 갈 때 이 파일 IPC는 WS/JSON-RPC로 대체될 수 있다 — 계약을 한곳(`agentBridge.ts` 머리말)에 모아 뒀다.

## 1-BR. 2026-08-28 세션 — GPL Dictionary **Thread 클래스**를 확장이 띄우게(멤버 전수·상세·클래스 개요·인스턴스 호버)

### 증상 / 요청

- 사용자 요청: Brooks GPL Dictionary의 `Thread/threadintro.htm`과 `Thread/` 디렉터리 자료를 가져와 확장이 정보를 띄우게 할 것.
- 실태 점검(공식 디렉터리 목록 대조):
  - 사전에 Thread 멤버 14개, `gplBuiltins.ts` CORE에 `Thread.Sleep`/`Thread.TestAndSet` 2개가 **중복 등록**돼 있었고, `findGplBuiltin`은 CORE를 먼저 반환하므로 사전 쪽 내용이 가려졌다. CORE의 `Thread.TestAndSet(target, value)`는 문서(`variable, new_value`)와 매개변수 이름도 달랐다.
  - 클래스 개요(`threadintro.htm`)와 생성자(`new.htm`)는 어디에도 없었다 — `New Thread("Class.Proc")`는 파서·rename·definition이 이미 특별 취급하는 흔한 코드인데 호버는 아무것도 띄우지 않았다.
  - 각 멤버의 **값 표**(ThreadState -1~4, 이벤트 비트 `&H0001`~`&HFFFF`, Join 반환 -1/0, Schedule의 priority 0~16·period 0.125×2ⁿ)는 한 줄 요약에 담기지 않아 결국 문서를 열어봐야 했다.
  - `Dim t As Thread` 뒤 `t.Abort()` 호버는 **아무 정보도 뜨지 않았다**. `receiverType.ts`의 `resolveReceiverHolder`가 사용자 클래스/모듈만 해석하기 때문(내장 타입은 설계상 undefined). 완성(completion)은 `builtinClass` 경로가 이미 있어 동작했으므로 **호버만 비어 있는 비대칭** 상태였다.

### 조치

- **데이터(단일 출처화·전수 반영)** — `src/gplDictionaryData.ts`
  - `Thread/` 디렉터리의 18개 페이지를 모두 열어 확인하고(`threadintro`·`new` 포함) 멤버 16개를 사전 한 곳에 모았다. CORE의 Thread 2개는 제거(중복 금지 주석을 그 자리에 남김).
  - 항목에 `usage`(문서의 Syntax 표기 — `thread_object.Abort()` / `Thread.Sleep(milliseconds)` / `old_value = Thread.TestAndSet(...)`)와 `details`(값 표·매개변수 범위·주의사항)를 채웠다. `signature`는 signatureHelp가 매개변수를 파싱하는 정규형이라 **건드리지 않고** 필드를 나눴다.
  - `GPL_CLASS_DOCS`(신규, `GPLClassDoc`) — 클래스 자체의 개요. Thread: 최대 64스레드·1 ms 라운드로빈, 생성자 `New Thread(procedure_name, project_name, thread_name, stack_size)`와 매개변수 표, "생성자는 이름만 기록하고 실제 생성·검증은 Start에서" 라는 문서 사실. **생성자를 멤버 목록에 넣지 않은 이유**: `Thread.New(...)`는 호출할 수 없는 형식이라 완성 후보로 뜨면 잘못된 코드를 유도한다.
- **API** — `src/gplBuiltins.ts`: `usage`/`details` 필드, `findGplClassDoc` / `getGplClassMembers` / `isGplBuiltinClassName` / `findGplBuiltinMember`(타입 이름 + 멤버 이름 → 사전 항목), `getGplBuiltinClassNames`.
- **수신자 타입 해석** — `src/language/receiverType.ts`: 첫 세그먼트 해석을 `firstSegmentTypeName`으로 분리하고 `resolveReceiverTypeName`(체인의 최종 **타입 이름**)을 추가했다. `resolveReceiverHolder`는 그 이름을 `holderNamed`로 감싸는 형태로 바뀌어 **동작·반환값이 종전과 동일**하다(디버그 호버 게이트 `evaluatableExpressionProvider`가 이 함수를 쓰므로 의도적으로 무변경 — 새 홀더 종류를 추가하지 않았다).
- **표시** — `src/providers/hoverProvider.ts`
  - 내장 호버를 `buildBuiltinHover`로 분리: `usage`가 있으면 그것을 코드블록에, `details`는 구분선 아래에 붙인다.
  - `buildClassDocHover`: 내장 클래스 이름 위 호버 → 개요 + 생성자 구문 + 멤버 목록 + Reference. **사용자 심볼 조회가 모두 실패한 뒤에만** 표시해 동명 사용자 심볼이 항상 우선한다.
  - `findBuiltinReceiverMember`: 수신자 타입이 내장 클래스면 사전 멤버를 띄운다. 이름 기반 `findDefinition` 폴백보다 **먼저** 두었다 — 그러지 않으면 다른 클래스의 동명 `Abort`가 잘못 표시된다(#32와 같은 함정).
  - 완성 항목 문서(`completionProvider.buildBuiltinDocumentation`)에도 `usage`/`details` 반영.
- **설정** — `gpl.hover.builtinDetails`(기본 true). 값 표가 팝업을 키우므로, 기존 `gpl.hover.*`(대형 팝업 방지) 체계에 맞춰 끌 수 있게 했다. 디버깅 중 `compact` 모드에서는 종전대로 한 줄만.

### 검증

- `npm run compile` 통과, `npm test` **442/442 통과**(신규 8건).
  - 사전: 공식 페이지 목록과 **1:1 대조**(멤버 16개 각각의 `sourceUrl` 파일명까지 검사 + 개수 일치 — 문서에 없는 항목이 끼어도 실패), ThreadState `-1~4` 값 표 존재, 값 표가 필요한 4개 항목의 `details` 존재, `usage` 형식, 클래스 개요 필수 필드·출처·"멤버 없는 개요 금지", 생성자 매개변수 4개.
  - 수신자: `Dim saveThread As Thread` → `resolveReceiverTypeName` = `'Thread'`이면서 `resolveReceiverHolder`는 여전히 `undefined`(종전 동작 보존을 테스트로 고정), 사용자 타입·배열 요소·`Me`·원시 타입·다단 체이닝.
- 자료 출처는 전부 `www2.brooksautomation.com/.../GPL_Dictionary/Thread/`의 개별 페이지에서 직접 확인했다(추측 항목 없음). 다만 **웹 문서는 가설, 실기기가 사실**이라는 규칙(§0.3, 문서 회의주의)에 따라 값 표의 실제 동작은 아래 "남은 일"로 남긴다.
- 확장 호스트에서의 육안 확인(F5)은 하지 않았다 — 사용자 요청이 있을 때만 창을 연다(§1-BP).

### 남은 일

- **다른 클래스로 같은 작업 확장**: 이번에 만든 구조(`usage`/`details`/`GPL_CLASS_DOCS`)는 클래스 중립적이다. Move·Robot·Controller·Latch·Exception 등도 같은 방식으로 개요·값 표를 채울 수 있다(현재 개요는 Thread 하나뿐).
- **실기기 확인(읽기 전용, 모션 무영향)**: `Thread.ThreadState` 값(-1~4)과 `Show Thread` 상태 문자열의 대응이 문서대로인지 1402로 대조. 특히 문서의 `1 = Stopping`(과도 상태)은 확장의 `normalizeThreadState`(Stopped↔Stopping 오정규화 회귀 테스트가 이미 있음)와 맞물리므로 실제 응답으로 확인해 두면 좋다.
- 내장 멤버의 **반환 타입** 정보가 사전에 없어 `Thread.CurrentThread().Abort` 같은 다단 체이닝은 호버가 해석하지 못한다(1단계 `t.Abort`는 동작). 필요하면 항목에 `returnType`을 추가하는 것이 자연스러운 다음 단계다.

## 1-BS. 2026-08-28 세션 — 제어기 디버깅 조작 전수 조사 + 표준 단축키 검토 + **스레드 단일 실행 잠금**

멀티 에이전트 오케스트레이션(워크플로 7 에이전트: 확장 명령·노출 표면·GDE 캡처·공식 문서 4방향 조사 →
단축키 감사 → 적대적 재검증 → 설계)으로 수행했다. 조사 결과 전체는
`docs/development/pa-controller-debug-operations.md`(신규)에 정리했다.

### 사실 확인 — VS Code는 `supportsSingleThreadExecutionRequests`를 소비하지 않는다

VS Code 1.135 본체 번들
(`%LOCALAPPDATA%\Programs\Microsoft VS Code\08d4889f9e\resources\app\out\vs\workbench\workbench.desktop.main.js`)
에서 문자열을 직접 셌다: `supportsSingleThreadExecutionRequests` **0건**, `singleThread` **0건**
(대조군은 존재 — `supportsStepBack`, `allThreadsStopped`, `preserveFocusHint`, `debug/callstack/context`).
즉 capability만 선언해도 UI는 생기지 않고 `singleThread` 인자도 오지 않는다. 따라서 잠금 UI는
**확장이 직접 제공**하고, capability 선언은 인자를 보내는 다른 DAP 클라이언트를 위한 규약 표시로만 남긴다.

같은 번들에서 확인한 두 규약(이번 구현의 근거):

- `StoppedEvent.preserveFocusHint`는 실제로 존중된다(`!o.preserveFocusHint && …` 분기) → 잠금 중 다른
  스레드의 정지가 포커스를 훔치지 않게 할 수 있다.
- `ContinuedEvent`는 `body.allThreadsContinued !== false` 로 읽는다 → **필드를 생략하면 '전체 재개'로
  해석**되어 정지 상태인 다른 스레드의 CALL STACK까지 지운다(`n = this.threadIds` 분기). 응답
  (`ContinueResponse`)의 기본값 해석과 **반대**다.

### 조치

- **`src/debug/threadLock.ts` 신설**(vscode 무의존, 순수 함수 3개 + 단위 테스트 13건):
  `resolveExecutionThread`(잠금 대상 확정 — 잠긴 스레드가 목록에 없으면 `staleLock`),
  `shouldPreserveFocus`, `isAllThreadsResumeRequest`.
- **어댑터**(`gplDebugSession.ts`): `supportsSingleThreadExecutionRequests = true` 선언(위 사실 주석 포함),
  `_lockedThreadName`/`_lockRedirectCount` 상태, `_resolveExecutionTarget`을 Continue/Step over/into/out
  네 요청 **첫 줄**에 적용(게이트 판정보다 먼저 대상을 확정해야 `_gateStepRequest`의 threadId 비교와
  `_afterGatedStepRequest`의 StoppedEvent 재발사가 같은 스레드를 가리킨다), 모든 StoppedEvent 발사를
  `_stoppedEvent` 하나로 모아 `allThreadsStopped: false` 명시 + 잠금 중 타 스레드에 `preserveFocusHint`
  (예외: `gplFocusThread`는 사용자가 직접 지목한 전환이므로 `forceFocus`로 포커스를 준다),
  CALL STACK 라벨에 잠금 자물쇠 접두, custom request 4개
  (`gplLockThread`/`gplUnlockThread`/`gplLockState`/`gplThreadList`) + `gpl.threadLockChanged` 이벤트,
  잠근 스레드 종료(`terminateThreadsRequest` STATUS 0)·세션 종료 시 자동 해제.
- **버그 수정(잠금과 별개)**: 외부 재개 감지의 `new ContinuedEvent(id)` → `new ContinuedEvent(id, false)`.
  종전에는 GDE·REPL·MCP로 한 스레드만 재개해도 VS Code가 '전체 재개'로 보고 **다른 정지 스레드의
  CALL STACK·변수·정지 배지를 지웠다**.
- **확장 UI**: 명령 3개(`gpl.debug.lockThread`/`unlockThread`/`toggleThreadLock`),
  `debug/callstack/context` 메뉴 2항목(`callStackItemType == 'thread'`), `commandPalette` 가드,
  상태바 `$(lock) 스레드 잠금: <이름>`(클릭 해제, `connectionStatusBar.setThreadLock`),
  `gpl.threadLockChanged` 수신으로 어댑터 자동 해제까지 동기화, 세션 종료 시 표시 정리.
- **잠금은 대상을 좁히기만 한다** — 추가로 재개되는 스레드가 없으므로 §0 하드 규칙 6에 걸리지 않는다.
  DAP `singleThread: false`(전체 재개)가 오더라도 fan-out 하지 않고 요청 스레드만 재개하며 그 사실을
  Debug Console에 남긴다(여러 스레드 동시 Continue = #28 사고와 같은 형태의 버스트 + 보이지 않는 축의 모션).
- **Pause(F6)에는 잠금을 적용하지 않는다**: Break는 폭주한 스레드를 멈추는 마지막 수단이므로 대상을
  되돌리면 정작 멈춰야 할 스레드가 계속 움직인다(#28 게이트에서 제외한 이유와 같다).

### 표준 단축키 검토 결과 (10키)

F5·F6·F9·F10·F11·Shift+F11은 어댑터 핸들러가 있고 정상 동작하되 전부 조건이 붙는다(#28 게이트 +
commandPolicy R1 — **어댑터 자신의 명령도 R1 대기를 거친다**). Shift+F5는 `supportsTerminateRequest=false`라
disconnect만 나가 BP만 정리하고 프로젝트 실행은 유지된다. Ctrl+Shift+F5는 재시작 요청 미지원으로
종료+재attach 폴백이며, **`deployBeforeAttach: true` 구성에서는 재시작마다 UPLOAD→STOP→COMPILE 전체가
반복된다**(적대적 검증에서 확인). Ctrl+F5는 launch 구성이 없고 `noDebug`를 읽는 코드가 0건이라 무의미하다
(대응물은 `GPL: Start`). 표는 README 디버거 절과 조사 문서 §7에 있다.

### 기존 기록 정정 (캡처 재판독으로 드러난 오류)

1. **1402 응답 프레이밍에 NUL 종결자**가 있다(178/178) — 런북 프레이밍 기록이 `</STATUS>\r\n`까지만 적고 있었다.
2. **GDE의 5초 하트비트는 유휴 조건이 없다**(~5.01 s 고정 주기, 스텝 연타 중에도 끼어듦) — §1-BM·런북의
   "유휴 5 s마다"는 부정확. 우리 구현(유휴 5 s ping)은 같은 목적의 **의도적 차이**로 서술을 고쳤다.
3. **GDE가 1403에 보내는 NUL 1바이트는 TCP keep-alive 프로브**(seq 미전진)이며 애플리케이션 write가 아니다 —
   §1-BM 서술 정정. 결론("1403에 써서 유지하려 하지 말 것")과 구현은 그대로 유효하다.

### 검증

- `npm test` **453/453 통과**(신규 13건: threadLock). `npx tsc -p ./ --noEmit` 통과.
- 정적 점검: `new StoppedEvent(`가 `_stoppedEvent` 내부 1건만 남고, `new ContinuedEvent(`는 2번째 인자
  없는 호출이 0건.
- VS Code 번들 문자열 카운트(위) — 경로·버전(1.135.0)과 함께 기록해 업데이트 후 재확인할 수 있게 했다.
- 실기기 확인은 하지 않았다(§3 체크리스트에 추가).

### 남은 일

- 실기기: ① 잠금 중 다른 스레드가 BP에 걸릴 때 포커스가 잠근 스레드에 남고 F10이 잠근 스레드로 가는지
  ② 외부(GDE/MCP)에서 한 스레드만 재개했을 때 다른 정지 스레드의 CALL STACK이 유지되는지(ContinuedEvent 수정 효과)
  ③ 잠근 스레드 종료·세션 종료 시 상태바·라벨 잠금이 함께 사라지는지 ④ 잠금 중 F6이 요청한 스레드를 멈추는지.
- 조사 문서 §8의 실기기 검증 대기 목록(`Step -out`, `Set Nobreak` no-space, `Start -event`, `help` 존재,
  `Pdx`/`node`/`ErrorLog <thread>`/`Show StartupLog` 응답 형식, `Show Break` procLine 사용 여부,
  `Execute`의 `_Cmd_*` 스레드 오인 가능성).
- 미구현 후보(조사 문서 §6): 예외 상세(`supportsExceptionInfoRequest`), WATCH 대입(`supportsSetExpression`),
  함수 브레이크포인트, BP 유효 줄 힌트 — 전부 모션 무영향. 조건부 BP/로그포인트는 자동 재개가 필요해 보류.
- VS Code가 `singleThread`를 실제로 보내기 시작하면(현재 0건) '인자 미수신' 전제와 사용자 안내를 갱신한다.

## 1-BT. 2026-08-28 세션 — 문서화 주석(Documentation Comment) 포맷 + 골격 자동 생성

사용자 요청: "설명 + `# Parameters` + `# Returns` + `# Examples`" 구조를 호버에서 보이게 하고,
그 구조를 **자동으로 만들어 주는 기능**도 함께.

### 배경

`docComment` 수집 자체는 이미 있었다(파서가 선언 바로 위 연속 `'` 블록을 `GPLSymbol.docComment`로 수집,
§1-J). 그러나 소비 쪽(호버·자동완성·시그니처 도움말)은 **줄바꿈만 살려 그대로 출력**했다. 즉 매개변수
설명을 써도 목록으로 정리되지 않았고, 예제는 코드 블록으로 보이지 않았으며, `gpl.hover.docCommentMaxLines`
(기본 6)가 주석 **전체**에 걸려 매개변수 목록이 중간에서 잘렸다. 형식을 정해도 그 형식을 쓸 이유가 없는
상태였다.

### 조치 — 형식은 파서/렌더러 한 곳(`src/language/docComment.ts`, vscode 무의존)에서 정의

- **파싱**: `parseDocComment(raw)` → `{ description, summary, sections[], isStructured, lines }`.
  - 머리글은 `#`~`######` (`# Parameters`, `#Parameters`, `# Parameters:` 모두 허용). 첫 머리글 이전은 설명.
  - 섹션 이름은 별칭 표 `SECTION_ALIASES`로 `parameters | returns | examples | remarks`에 매핑하고
    한국어(`매개변수`·`반환`·`예제`·`비고` 등)도 인식한다. **표에 없는 머리글도 버리지 않고 `other`로
    순서를 지켜 보존**한다(형식을 몰라도 손실 없음 — 새 섹션 종류가 필요하면 표에 한 줄만 추가).
  - Parameters 항목은 `- \`name\`: 설명` / `* name - 설명` / 이어지는 들여쓴 줄까지 받아
    `{name, text}[]`로 파싱한다. 코드 펜스(``` / ~~~) 안의 `#`은 머리글로 보지 않는다.
  - 머리글이 하나도 없으면 전부 `description` → **옛 주석은 종전과 동일하게 표시된다**(호환).
- **렌더링**: `renderDocCommentMarkdown(raw|parsed, opts)`.
  - 설명 → `**Parameters**` 목록 → `**Returns**` → `**Examples**`(코드 블록, 언어 표기 없는 여는 펜스에는
    `gpl`을 붙여 구문 강조) → 그 외 섹션(작성자가 쓴 제목 원문 그대로).
  - `descriptionMode`(summary|full)·`maxDescriptionLines`는 **설명에만** 적용한다. 섹션은 작성자가 길이를
    정한 구조이므로 자르지 않는다 → `gpl.hover.docCommentMaxLines` 기본 6에서도 매개변수 목록이 안 끊긴다.
  - `includeKinds`로 섹션을 골라 렌더링(시그니처 도움말이 Parameters를 빼는 데 사용).
- **소비처 3곳 연결**: `providers/hoverProvider.ts`(formatDocComment이 렌더러 호출),
  `symbolCache.buildSymbolDocumentation`(자동완성 상세), `providers/signatureHelpProvider.ts`
  (파라미터별 `ParameterInformation.documentation` = `# Parameters` 항목, 본문에서는 Parameters 제외해 중복 방지).

### 조치 — 골격 자동 생성 (`src/providers/docCommentProvider.ts`)

- `buildDocCommentBlock(target, {snippet, includeExamples})`: 설명은 항상, `# Parameters`는 파라미터가 있을 때만,
  `# Returns`는 반환 타입이 있을 때만, `# Examples`는 옵션일 때만 — 사용자가 정한 규칙 그대로. 반환하는 줄에는
  **들여쓰기를 넣지 않는다**(VS Code 스니펫이 삽입 위치의 들여쓰기를 2번째 줄부터 이어 붙이므로, 넣으면 2배가 된다).
- **`'''` 트리거**: 선언 바로 위 줄에서 `'''`를 입력하면 스니펫 자동완성 1개를 제안(JSDoc `/**`와 같은 흐름).
  교체 범위는 들여쓰기 **다음**(첫 `'`)부터로 잡아야 스니펫 들여쓰기가 어긋나지 않는다. `'''`와 선언 사이에
  이미 주석이 있으면 제안하지 않는다(중복 생성 방지). 설정 `gpl.docComment.generateOnTripleQuote`(기본 켜짐).
- **명령/코드 액션**: `gpl.insertDocComment`(명령 팔레트 `GPL: 문서화 주석 생성`) + 선언 줄 전구 메뉴
  (RefactorRewrite). 코드 액션 탐색은 strict — **빈 줄에서 멈춘다**(빈 줄이 끼면 주석이 그 선언에 붙지 않는
  파서 규칙과 같게 해, 무관한 위치에서 전구가 뜨지 않게).
- **이미 주석이 있으면 보완**: `mergeDocComment`가 시그니처에는 있는데 `# Parameters`에 없는 항목, 반환 타입이
  있는데 없는 `# Returns` 섹션만 계산해 **줄 단위 삽입 지시**로 돌려준다. 기존 서술은 건드리지 않으며,
  삽입 위치는 Parameters → Returns → Examples 순서를 지킨다. 같은 위치의 삽입은 하나로 합치고(적용 순서에
  따라 순서가 뒤집히는 것 방지), 문서 EOL(CRLF/LF)을 그대로 쓴다.

### 조치 — MCP 서버도 같은 규약을 알리게 (사용자 요청)

AI가 이 MCP로 GPL 코드를 만질 때 형식을 모르면 규약이 확산되지 않는다. 도구 설명은 그 도구를 부를 때만
읽히므로, **도구 호출 전에** 읽히는 `initialize` 응답의 `instructions`에 넣었다.

- `controller-mcp/src/guidelines.js` 신설 — `DOC_COMMENT_GUIDE`(문서화 주석 규약)와
  `SERVER_INSTRUCTIONS`(= 제어기 안전 규칙 + 규약). `index.js`의 `new McpServer(..., { instructions })`로 전달.
  세션 내내 컨텍스트에 남는 텍스트라 규약·근거만 남기고 예시는 최소로(1.6 KB, 상한 4 KB를 테스트로 고정).
- `instructions`를 쓰지 않는 클라이언트를 위해 리소스 `gpl://guidelines/doc-comment`로도 노출
  (참고 문서는 매 요청에 실리는 도구 목록이 아니라 리소스로 두는 것이 MCP 관례). SDK 호환을 위해
  `registerResource`(1.1+)가 아닌 `server.resource(name, uri, meta, cb)`를 쓴다 — package.json이 `^1.0.4`.
- `gpl.insertDocComment`를 MCP 경로에서 쓸 수 있게 보완: `uri`를 `vscode.Uri` 외에 **URI 문자열·로컬 경로**로도
  받고(브리지는 JSON이라 문자열로 온다), 결과 `{ ok, action: inserted|merged|up-to-date|no-editor|no-declaration,
  added?, file, line, symbol }`을 돌려준다(종전 void — 호출측이 무슨 일이 있었는지 알 수 없었다).
- 검증: MCP 서버를 실제로 띄워 `initialize`/`resources/list`/`resources/read`/`tools/list`를 주고받아 확인(스모크),
  단위 테스트 5건 추가(`controller-mcp/test/guidelines.test.mjs`, controller-mcp 56/56 통과).
- `controller-mcp/README.md`에 §5 "연결 시 전달되는 지침"을 신설했다 — **이 때문에 뒤 절 번호가 하나씩 밀렸다**
  (옛 기록의 §5 제공 도구 → §6, §6 디버그 흐름 → §7, §7 설계·주의 → §8).

### 검증

- 단위 테스트 20건 신설(`src/test/docComment.test.ts`, 전체 473/473 통과) — 섹션 분리, 항목 표기 변형,
  펜스 안 `#`, 미지의 머리글 보존, 옛 주석 호환, summary/full·maxLines가 설명에만 적용, includeKinds,
  펜스 언어 부여, 골격 생성(평문/스니펫/Examples), 머지 3케이스.
- 실제 파일 왕복 확인: `samples/hello-project/Main.gpl`을 새 형식으로 갱신(`Add`, `Clamp`)하고
  파서 → 렌더러를 통과시켜 호버 마크다운을 눈으로 확인(매개변수 목록·Returns·```gpl 예제 블록).
- **UI 동작(자동완성 팝업·스니펫 들여쓰기·전구 메뉴)은 실행 검증 전이다** — §3 체크리스트 참조.

### 남은 일

- F5 개발 호스트에서 `'''` 스니펫 들여쓰기와 전구 메뉴를 눈으로 확인(§3).
- 파라미터 심볼 위 호버에 그 파라미터의 `# Parameters` 설명을 붙이는 것(현재는 시그니처 도움말에서만 보인다).
- 확장이 만드는 CLAUDE.md 가드 블록(`src/ai/exportAgentSetup.ts` `buildClaudeSection`)에도 같은 규약을 넣을지 — 지금은 MCP `instructions`에만 있다(사용자 요청 범위).
- 진단으로 "문서화되지 않은 매개변수" 경고를 낼지 여부는 보류(소음 위험 — 사용자 요청 없음).

## 1-BU. 2026-08-28 세션 — 공식 문서 기준 디버깅 조작 확장(Jump to Cursor·Step Into Target·조건부 BP·함수 BP) + Start 구문 + 쓰레드 존재 = 동작 중

사용자 지시: "Jump to Cursor는 위험 경고는 하되 기능은 쓸 수 있게", "흉내만 가능한 것도 구현하고 상시 돌아가는
기능은 기본 OFF", "공식 문서 보면서 표준 방식으로", "`_Cmd_<project>` 쓰레드도 동작 상태로 인식 — 안전한 것은
쓰레드가 존재하는가".

### 공식 문서에서 확정한 사실 (2026-08-28, 페이지 원문 확인)

- **`Step thread [-into] [-over] [-out] [-noerror]`** — 네 스위치 모두 문서에 있다. `-into` 는 "스위치가 없으면
  기본값", `-out` 은 "현재 프로시저가 호출자로 돌아갈 때까지". 전제는 Start 로 활성화 뒤 정지한 쓰레드.
- **`Set Break project "file" line` / `Set Nobreak [project] ["file"] [line]`** — **문서 표기는 공백 있음**.
  실측(GDE)은 `Set Break` 의 무공백 형식이고 `Set Nobreak` 는 캡처 근거가 없다 → 무공백 우선 + 실패 시 문서
  표기 재시도로 양쪽을 커버(`_sendBpCommandWithFallback`). 문서 제약도 반영: 동시 32개 상한, 한 명령줄에 하나,
  빈 줄·주석은 다음 실행 문장으로 이동, 없는 BP 해제는 에러 아님.
- **`Start`** — `-event` 는 "쓰레드 상태 변경을 콘솔 메시지가 아니라 **이벤트로** 보낸다"(GDE 가 항상 쓰는 이유가
  이것으로 설명된다). `-stack` 기본 4 KB, `-init` 은 초기화 문장 표시, `-trace` 는 성능 저하 경고,
  `-name` 은 쓰레드 이름. `-compile` 은 문서상 "시작 전 컴파일"이지만 실기기는 스위치 없이도 컴파일하므로
  (하드 규칙 7) **절대 붙이지 않는다**.
- **`Pd`/`Pdx dataid, unit, unit2, array_index, node`** — `Pdx` 는 정수를 16진수로 표시, `node` 는 서보 노드 지정
  (문서가 테스트/디버깅 용도로 명시), `array_index` 0 = 전체 값.
- **`Show Memory -verify`** — 사용자 실기기 테스트 결과 `<DATA></DATA>` + `STATUS 0` 즉시 응답. 문서 경고("실시간
  응답 방해 가능")는 유지하되 수동 진단은 가능으로 완화(자동 폴링에는 넣지 않는다).

### 조치 — 신규 순수 모듈 3개 + 어댑터/확장 배선

- **`src/controller/threadActivity.ts`**(신규, 테스트 11건): "동작 중" 판정을 **쓰레드 존재**로 통일.
  `isControllerIdle`(빈 목록만 완전 정지) / `isProjectRunning`(project 컬럼·기본 이름·`_Cmd_<project>` 모두 인정)
  / `describeThreadActivity`(정지 계열이어도 존재하면 동작 중이라고 설명). `deployService` 의 빠른 컴파일 STOP
  생략 경로가 이제 정지 계열 쓰레드가 남아 있어도 그대로 진행하지 않는다.
- **`src/debug/sourceTargets.ts`**(신규, 테스트 17건): BP 유효 줄·프로시저 범위(`End Sub` 기준)·호출 후보 파싱.
  `New Thread(` 같은 생성자와 제어 구문 키워드는 호출 후보에서 제외한다.
- **`src/controller/startCommand.ts`**(신규, 테스트 8건): 문서 구문 순서로 `Start` 조립, `-compile` 금지를 코드로
  강제, 프로젝트/쓰레드 이름 공백 검사.
- **어댑터**(`gplDebugSession.ts`): capability 선언 추가 — `supportsGotoTargetsRequest`(설정에 따라),
  `supportsStepInTargetsRequest`, `supportsFunctionBreakpoints`, `supportsBreakpointLocationsRequest`(false→true),
  `supportsClipboardContext`, `supportsDelayedStackTraceLoading`, 그리고 설정이 켜졌을 때만
  `supportsConditionalBreakpoints`/`HitConditional`/`LogPoints`. 구현: `gotoTargetsRequest`/`gotoRequest`
  (경고 모달 → `Set Thread -line`, 응답 뒤 StoppedEvent reason `goto`), `stepInTargetsRequest` + `stepInRequest`
  의 `targetId` 분기(임시 BP + Continue, 정지 시 정리), `setFunctionBreakPointsRequest`,
  `breakpointLocationsRequest`, `setBreakPointsRequest` 의 줄 보정·조건 메타 수집·함수 BP 줄 보호,
  `_handleBreakpointStop`(임시 BP 정리 + 조건/히트/로그 판정 + 자동 Continue), clipboard 컨텍스트 평가,
  `_withHexHint`.
- **VS Code 소비 여부를 번들에서 먼저 확인**했다(지난 세션의 `supportsSingleThreadExecutionRequests` 0건 교훈):
  gotoTargets 2 / stepInTargets 2 / functionBreakpoints 3 / breakpointLocations 2 / clipboardContext 2 /
  delayedStackTraceLoading 2 / conditionalBreakpoints 2 / hitConditional 1 / logPoints 1 건.
  **`supportsValueFormattingOptions` 는 0건** → hex 는 DAP 대신 설정(`gpl.debug.integerHex`)으로 제공.
- **설정 4개 추가**: `gpl.debug.jumpToCursor`(warn/on/off, 기본 warn) / `gpl.debug.clientSideBreakpointLogic`
  (기본 false — 자동 Continue를 수반하므로) / `gpl.debug.integerHex`(기본 false) /
  `gpl.controller.startEventMode`(기본 true). launch 구성 3개: `startStackSizeKb`·`startShowInitStatements`·`startTrace`.
- **MCP `read_dataids`**: `hex`(→`pdx`)·`unit`·`unit2`·`arrayIndex`·`node` 인자 추가, 뒤 인자 사용 시 앞 인자 기본값 자동 보완.

### 위험 설계 근거

- Jump to Cursor 는 **기능을 막지 않고 경고로 처리**한다(사용자 결정). 대상 줄 검증(같은 프로시저·실행 문장)은
  로컬 파서로 하고, 기본값에서 모달로 "건너뛴 문장 미실행 → 초기화·안전 조건 누락 가능"을 알린다.
- 조건부 BP/로그포인트는 **자동 Continue**가 본질이라 기본 OFF. 조건 평가 실패 시에는 지나치지 않고 정지를 유지한다.
- Step Into Target 은 임시 BP + Continue(=재개)이므로 대상에 도달하지 못하면 계속 실행된다 — BP 설정/Continue 실패
  시 임시 BP를 즉시 걷어내고 기본 Step 으로 폴백한다.

### 검증

- `npm test` **511/511 통과**(신규 36건: threadActivity 11 · sourceTargets 17 · startCommand 8). `tsc --noEmit` 통과.
- **메모(원인 미확정): 소스는 새 코드인데 동작이 옛 코드였던 구간이 있었다.** python 으로 편집한
  `sourceTargets.ts` 의 수정이 반영되지 않아 테스트 3건이 실패했는데, 파일 내용과 런타임 `toString()` 은 새 코드로
  보이면서 동작만 옛 코드였다. Write 도구로 같은 내용을 다시 쓰자 즉시 통과. 원인 후보는 두 가지이고 **어느 쪽인지
  확정하지 못했다** — ① 샌드박스/호스트 파일 동기화 함정(§0 하드 규칙 4) ② 같은 시각 다른 세션·에디터에서의
  동시 편집(사용자 지적, [[git-unlock-tool]] 메모의 교차 편집과 같은 뿌리). 재발하면 편집 직후
  `git diff <파일>` 과 `out/` grep 을 함께 보고 어느 쪽인지 판별할 것.
  실무 지침(원인과 무관하게 유효): **소스 편집은 Edit/Write 도구로 하고, 의심되면 `out/`을 grep 해 반영을 확인한다.**
- 실기기 확인은 하지 않았다(§3 체크리스트 추가).

### 남은 일

- 실기기: Jump to Cursor(저속·시뮬레이션에서 먼저), Step Into Target 임시 BP 정리, 함수 BP, 조건부 BP 자동 재개
  동작, `Start -event` 전환 후 1403 수신량, `Set Nobreak` 폴백 로그 발생 여부.
- 남은 후보(조사 문서 §6): 예외 상세(`supportsExceptionInfoRequest`), WATCH 대입(`supportsSetExpression`),
  재시작(`supportsRestartRequest`), 종료 시 중지/유지 선택, Debug Console 자동완성, `Set Thread -bex/-nobex`.

## 1-BV. 2026-08-28 세션 — 업로드 스킵 판정을 "크기" → **내용 지문(SHA-1)** 으로 (미러/skipUnchanged)

### 증상

`mirrorProject`(F5·수동 빠른 컴파일의 `/GPL` 미러, Save to Flash)와 `uploadProject(skipUnchanged)`의 스킵 판정이
**파일 크기 하나**였다. 그런데 GPL 소스 편집은 길이가 그대로인 경우가 흔하다(상수 `10`→`20`, 오타 한 글자,
주석 한 글자). 그런 파일은 "변경 없음"으로 스킵되어 제어기가 **낡은 소스를 그대로 컴파일**한다 — 오류도 경고도
없이 조용히 틀리는 종류의 버그. §1-I "남은 일"과 §3 체크리스트에 미해결로 남아 있던 항목이다.

### 원인

크기는 내용의 지문이 아니다. 원격 내용을 확인할 수단이 필요한데,

- 제어기 FTP에 `HASH`/`XMD5`/`XCRC` 계열 확장이 있다는 근거가 없고(문서·캡처 모두 없음, 실기기 미검증),
- 내려받아 해시하면 왕복 비용이 업로드와 같아져 스킵의 의미가 사라진다.

### 조치 (의도와 방법)

- **`src/controller/syncManifest.ts` 신설**(vscode 무의존) — "그 제어기 경로에 어떤 내용을 올려 두었는가"를
  파일별 `{size, sha1, remoteMtimeMs?}`로 기록한다. 원격을 해시하는 대신 **우리가 올린 내용의 SHA-1**을 기억해
  두고, 다음 동기화에서 "지금 로컬 내용 == 마지막으로 올린 내용"인지를 본다.
- **스킵 조건이 좁아졌다**: ① 원격에 존재 ② 원격 크기 == 로컬 크기 ③ 로컬 SHA-1 == 마지막 업로드 SHA-1
  ④ (LIST가 mtime을 주면) 마지막으로 관측한 원격 mtime과 동일. **판정 불가는 전부 업로드 쪽으로 넘어뜨린다** —
  지문이 없으면(첫 동기화, 확장 업데이트 직후) 스킵하지 않는다. 낡은 소스 오컴파일보다 한 번 더 올리는 쪽이 싸다.
- `remoteMtimeMs`는 업로드 직후에는 알 수 없으므로 비워 두고 **다음 목록 조회에서 채택**한다. 값이 있는데 관측치와
  다르면 "우리 밖에서 원격이 바뀜"(다른 PC·GDE·수동 FTP)으로 보고 다시 올린다. 제어기가 목록에 시각을 주지 않으면
  이 조건은 자동으로 생략된다.
- **저장은 `globalState`** — 기록의 주어가 워크스페이스가 아니라 "그 제어기 경로"라, 같은 PC의 다른 창이 같은
  `/GPL/<name>`을 건드려도 지문을 공유해야 한다. (`deployRecord`는 projectDir 종속이라 workspaceState인 것과 대비.)
  경로별 기록은 32개까지 보관하고 오래된 것부터 버린다.
- 미러는 전체 목록 기준이라 **대체**(`recordSyncManifest`) — 로컬에서 사라진 파일의 지문도 함께 정리된다.
  `uploadProject(onlyFiles)`(autoOnSave)는 이번에 다룬 파일만 담기므로 **병합**(`mergeSyncManifest`).
- FTP 트리에서 원격 폴더/파일을 지우면 그 경로 지문을 버린다(`forgetSyncManifest`).
- 해시 실패·64 MB 초과 파일은 `sha1: ''`로 두고 **종전대로 크기 비교로 폴백**한다(동작 후퇴 없음).
- **추가 왕복 없음** — 미러는 기존 LIST 한 번 그대로, 업로드는 기존 `SIZE` 그대로다. 늘어난 비용은 로컬 파일
  읽기·해시뿐(수십 KB급 GPL 소스 65개 기준 무시할 수준).
- 첫 동기화(지문 없음)면 미러 trace에 `(첫 동기화 — 지문 기록 없음, 전체 업로드)`를 붙여, 전량 업로드가 이상이
  아니라 정상 동작임을 로그에서 바로 알 수 있게 했다.

### 검증

- `npm run compile` 통과(사용자 로컬 Windows), `npm test` **528/528**(신규 17건).
- 신규 테스트가 덮는 것: 동일 크기 내용 변경(핵심 회귀), 지문 없음/구버전 기록(sha1 빈 값), 해시 불가 폴백,
  원격 mtime 외부 변경, 업로드→스킵(mtime 채택)→같은 길이 편집→재업로드 흐름, 키 정규화(host·원격 경로·파일 경로),
  저장소 replace/merge/forget·Memento 영속화·손상 저장분 필터·보관 상한.
- 실기기 미검증(§3에 항목 추가).

### 남은 일 / 새 미해결

- [ ] 실기기: `.gpl`을 **같은 길이로** 고친 뒤 빠른 컴파일 → trace에 그 파일이 `↑ [n/N]`로 전송되는지 확인
      (종전이라면 스킵됐을 파일).
- [ ] 실기기: 제어기 FTP LIST가 mtime을 주는지 확인 — 주면 "다른 PC/GDE가 바꾼 원격 파일" 감지가 살아난다.
      안 주면 그 조건만 생략되고 나머지는 그대로다.

### 변경 파일

- `src/controller/syncManifest.ts` — **신규**. 지문 타입·판정(`isUnchanged`/`nextStamp`)·저장소(globalState).
- `src/controller/ftpClient.ts` — `uploadProject`/`mirrorProject`에 `manifest` 입력과 반환 추가,
  `collectRemoteFiles`가 LIST의 mtime도 수집(`RemoteFileEntry`).
- `src/controller/deployService.ts` — 미러/업로드 전에 지문을 읽어 넘기고, 성공 후 대체/병합 기록.
- `src/extension.ts` — `attachSyncManifestStore(context.globalState)`, Save to Flash 미러에 지문 연결,
  FTP 삭제 시 지문 폐기.
- `src/test/syncManifest.test.ts` — **신규** 17건, `src/test/index.ts`에 등록.

## 1-BW. 2026-08-28 세션 — 프로젝트 하위 폴더(중첩 소스) 지원: "프로젝트에 속한 소스" 판단을 한 곳으로

### 발단 (사용자 관찰)

사용자가 실제 프로젝트 `…\시뮬레이션\projects\TEST_GPL\Project.gpr`에서 확인:

```txt
ProjectBegin
ProjectName="TEST_GPL"
ProjectStart="Main"
ProjectSource="Main.gpl"
ProjectSource="T1\T1.gpl"
ProjectSource="T1\T2\T2.gpl"
ProjectEnd
```

→ **`ProjectSource`는 폴더 기준 상대 경로이며 하위 폴더를 임의 깊이로 중첩할 수 있다**(GDE가 이 형식으로
저장한다). 이어서 사용자 지적: "중첩 구조를 인식 못 한다 — 참조 찾기 등이 제대로 작동하지 않는다."

이로써 §1-BL의 미해결 항목("하위 폴더 소스 지원 여부 확인 후 재귀 옵션 검토")의 절반이 사실로 확정됐다.
나머지 절반(**제어기 Compile이 상대 경로 항목을 실제로 열어 컴파일하는지**)은 여전히 실기기 확인 사항 → §3.

### 원인 — 기능마다 "프로젝트에 속한 소스"를 다르게 판단하고 있었다

| 기능 | 종전 판단 | 중첩 구조에서 |
|---|---|---|
| 참조 찾기 폴백 (`referenceProvider`) | **정의 파일과 같은 폴더의 형제 `.gpl`만**(`fs.readDirectory`, 비재귀) | 하위 폴더 참조 **전부 누락** |
| 심볼 인덱싱 (`symbolCache`) | `**/Project.gpr`의 `ProjectSource`만(파일명이 `Project.gpr`일 때만) | 목록에 있으면 OK, 목록에 없는 파일은 미인식 |
| `.gpr` 동기화 (`gprSyncCommand`) | 폴더 직속 파일만(비재귀) | 하위 폴더 항목을 "파일 없음"으로 **제거 제안**(auto 모드면 조용히 제거) |
| 디버그 동명 소스 경합 (`pickSourceCandidate`) | 프로젝트 폴더 하위 → **얕은 경로 우선** | 목록에 없는 얕은 동명 파일이 이길 수 있음 |
| 정의 후보 근접도 (`scoreFilePath`) | 같은 폴더 → **워크스페이스 최상위 폴더** | 같은 프로젝트의 다른 하위 폴더가 남과 동급 |

특히 참조 찾기가 실제로 깨진 이유가 중요하다: 워크스페이스 광역 검색에 쓰는
`vscode.workspace.findTextInFiles`는 **제안(proposed) API**여서 정식 VS Code에서는 존재하지 않는다
(`package.json`에 `enabledApiProposals` 없음 → 런타임 감지에서 `false` 반환). 즉 **폴백이 실제 주 경로**였고,
그 폴백이 "같은 폴더"만 보고 있었다.

`.gpr` 동기화의 제거 오판은 컴파일된 `out/`으로 실증했다: `T1\T2\T2.gpl` 항목 + 비재귀 목록 →
`toRemove = ['T1\T2\T2.gpl']`, 자동 반영 결과에서 그 줄이 사라짐.

### 조치

**신규 `src/project/projectSources.ts`(순수, vscode 무의존)** — "프로젝트에 속한 소스" 규칙의 단일 출처.
`.gpr` 텍스트 파싱은 기존 `controller/gprSync.ts`를 그대로 쓴다(파서 중복 금지).

- `listSourceFilesRecursive(dir, opts)` — **재귀** 수집, 폴더 기준 상대 경로. dot 항목·`node_modules`·
  `bin`/`out`/`dist` 제외(디버그 소스맵 스캔과 같은 규칙), 심볼릭 링크 건너뜀, 대소문자 무시 정렬로 결정적.
  구분자 옵션(기본 `\` = GDE 관측 형식), `maxFiles`(기본 5000)·`maxDepth`(기본 16) 초과는
  **`truncated`로 알린다**(조용한 절단 금지).
- `resolveGprSourcePaths(gprPath, text)` — `\`·`/`·절대 경로 항목을 절대 경로로 해석(중복 제거).
- `pickOwningGprPath(filePath, gprPaths)` — 파일을 포함하는 **가장 깊은(가까운)** `.gpr`. 같은 폴더면
  `Project.gpr` 우선, 그 외 사전순.
- `findNearestGprOnDisk(startPath)` — 워크스페이스 밖 파일용(위로 최대 16단계).
- `collectProjectSourcePaths(gprPath, text)` — **`.gpr` 목록 ∪ 폴더 재귀 스캔**(누락 방지 우선:
  아직 `.gpr`에 없는 새 파일도, 스캔 제외에 걸린 목록 항목도 포함).

**신규 `src/project/projectFileScope.ts`(vscode)** — `resolveProjectFileScope(seedPath, opts)`:
① 워크스페이스 `.gpr` 중 소유 프로젝트 → ② 없으면 디스크에서 위로 탐색 → ③ 그래도 없으면 워크스페이스
전체 재귀 glob. `PROJECT_EXCLUDE_GLOB`(= `findProjectDirs`와 같은 목록, `.history`/`dist`/`out` 포함)을 공유한다.

**적용**

- `providers/referenceProvider.ts` — 폴더 폴백을 **프로젝트 범위 폴백**으로 교체(`MAX_SCOPE_FALLBACK_FILES=1000`,
  `.gpl`만 — `.gpo`는 바이너리). 로그에 `origin`·파일 수·상한 초과를 남긴다. 변수명 `folderFallback*` →
  `scopeFallback*`.
- `symbolCache.ts` — `getProjectSourcesFromGpr`가 `findWorkspaceGprPaths()`(임의 `*.gpr`) +
  `collectProjectSourcePaths`를 쓴다(종전 `**/Project.gpr` 고정 + 자체 정규식 파싱 제거).
  `INDEX_EXCLUDE_GLOB`을 공용 목록으로 교체(`.history` stale 사본 배제). `scoreFilePath`에
  **`SCORE_SAME_PROJECT=650`** 티어 신설(같은 폴더 800 > 같은 프로젝트 650 > 최상위 폴더 500).
- `controller/gprSync.ts` — `planGprSync(parsed, files, { existsOnDisk })`: 제거 대상은 **목록에 없다 +
  디스크에도 없다** 둘을 모두 만족할 때만. 탐색 제외·상한 때문에 목록에서 빠진 파일을 지우자고 하지 않는다.
- `controller/gprSyncCommand.ts` — `listSourceFiles`가 재귀(구분자 `\`), `existsOnDisk` 전달,
  자동 반영 watcher가 **파일을 포함하는 가장 깊은 프로젝트**(`isPathUnder`)로 대상을 정한다(종전: 직속만).
- `controller/responseParser.ts` — `pickSourceCandidate(candidates, projectDirs, projectSourcePaths?)`:
  ① `.gpr` 목록에 실제로 든 후보 → ② 프로젝트 폴더 하위 → ③ 얕은 경로 → ④ 사전순.
- `debug/gplDebugSession.ts` — `_updateProjectDirs`가 `_projectSourcePaths`(해석된 `ProjectSource` 절대 경로)도
  채워 `pickSourceCandidate`에 넘긴다. **BP 파일 표기 폴백**: `_bpFileForms()`가 [파일명, 프로젝트 기준 상대
  경로]를 만들고, 파일명 표기가 STATUS 실패하면 상대 경로 표기로 재시도한 뒤 성공한 표기를 세션에 기억
  (`_bpPreferProjectRelativeFile`). **평면 프로젝트는 후보가 하나라 보내는 명령이 종전과 완전히 동일하다.**

### 검증

- `npm test` **536/536 통과**(신규 `src/test/projectSources.test.ts` 8건: 재귀·제외 규칙·구분자, 상한
  `truncated`, `\`/`/`/절대 경로 해석, 합집합, 소유 `.gpr` 선택, 디스크 상향 탐색, **하위 폴더 항목
  제거 오판 방지**, `.gpr` 목록 우선 소스 선택). `npx tsc -p . --noEmit` 무오류.
- 픽스처는 사용자가 확인한 TEST_GPL 구조(`Main.gpl` + `T1\T1.gpl` + `T1\T2\T2.gpl`)를 그대로 재현하고,
  `.history`/`node_modules`/`out` 사본과 `.txt`/`.gpo`가 제외되는지까지 확인한다.
- **미검증(실기기·UI)**: §3 체크리스트 참조. 특히 제어기 `Compile`의 상대 경로 항목 처리와 하위 폴더
  소스의 BP 파일 표기.

### 남은 일

- 하위 폴더 소스의 **원격 배치 확인**: FTP 업로드는 이미 재귀 + `ensureDir`로 원격에 같은 구조를 만든다
  (`ftpClient.getAllFiles`/`uploadVerified`) — 제어기가 그 구조를 컴파일하는지는 실기기 확인 대상.
- `_detectProjectName`의 `Project.gpr` 고정 파일명 → `*.gpr` 통일(§1-BL에서 이월). 이번에 `symbolCache`와
  참조 범위는 임의 `*.gpr`로 통일했으나 어댑터 경로는 그대로 뒀다.
- 하위 폴더에서 **같은 basename**이 여러 개일 때 제어기 응답(basename만 준다)의 근본적 모호성은 남는다.
  이번 변경으로 `.gpr` 목록이 1순위 기준이 됐지만, 목록에 동명이 둘 이상이면 여전히 경고 후 결정적 tie-break다.

## 1-BX. 2026-08-31 세션 — 중첩 프로젝트(`ProjectLibrary`) 지원: "소유한 파일"과 "함께 컴파일되는 파일"을 분리

### 발단 (사용자 관찰)

사용자가 GDS로 만든 실제 프로젝트에서 확인 —
`C:\SVN\pa\trunk\develop\07. Others\37. 핵산 Oligo 합성과제\시뮬레이션\projects\MyProject`

```txt
projects/MyProject/Project.gpr        ProjectLibrary="MyProject\MyLibrary"
projects/MyProject/Main.gpl           …
projects/MyProject/MyLibrary/Project.gpr   ← 중첩 프로젝트(자기 .gpr·ProjectName="MyLibrary")
projects/MyProject/MyLibrary/Project.gpl
```

두 가지가 새로 확인됐다.

1. **`ProjectLibrary` 키워드가 실측으로 확정**됐다(종전 `docs/reference/project-file-gpr.md`는 [미검증]).
   값은 **단순 프로젝트명이 아니라 `\` 구분 경로**이고, 관측된 기준점은 **projects 루트**다.
2. **프로젝트 폴더 안에 다른 프로젝트가 들어갈 수 있다.** "프로젝트 폴더 = 프로젝트 하나" 전제가 깨진다.

경로 쪽(공백·마침표·한글 `07. Others` / `37. 핵산 Oligo 합성과제` / `시뮬레이션`, `projects/` 아래 깊은 중첩)은
검토 결과 **문제 없음**: 제어기 명령에 들어가는 것은 프로젝트 **이름**(`MyProject`)뿐이고
(`projectNameGuard`), VS Code glob은 워크스페이스 루트 기준 상대 패턴이며, FTP 원격 경로는
`remoteDir + projectDir 기준 상대경로`로 만들어져 상위 경로 문자가 새지 않는다.

### 증상 (중첩 구조에서 실제로 깨지던 것)

- **🔴 `.gpr` 동기화가 라이브러리 소스를 상위 프로젝트의 `ProjectSource`로 추가하려 했다.**
  `listSourceFilesRecursive`가 중첩 `.gpr`를 경계로 보지 않아 `MyLibrary\Project.gpl`이 상위 프로젝트의
  폴더 목록에 섞였고, `planGprSync`가 이를 "추가" 후보로 계산했다(QuickPick 기본 체크 상태,
  `autoSyncSources: auto`면 무경고 반영). 라이브러리는 문서상 이미 **논리적으로 포함되어 함께 컴파일**되므로
  이중 등록이 된다.
- **🟡 참조 검색·이름 바꾸기 범위가 비대칭이었다.** `resolveProjectFileScope`가 소유 `.gpr` 하나로 좁혀서,
  라이브러리 안의 `Public` 루틴에서 참조를 찾으면 **메인 프로젝트의 호출부를 통째로 놓쳤다**.
- **🟡 QuickPick에서 라이브러리가 최상위 프로젝트와 구분되지 않았다**(라벨이 폴더명뿐) — 라이브러리만
  Deploy/Start 하는 실수를 부른다.
- 배포는 폴더 재귀라 중첩 라이브러리가 함께 올라가지만, 그 배치를 제어기가 어떻게 해석하는지는 미검증이었고
  **폴더 밖 라이브러리는 아무 말 없이 빠졌다**.

### 조치 (의도와 방법)

핵심 결정: **서로 다른 두 질문을 코드에서 분리한다.**

| 질문 | 답하는 함수 | 쓰는 곳 |
| --- | --- | --- |
| 이 프로젝트가 **소유한** 파일 | `listSourceFilesRecursive`(중첩 `.gpr`에서 멈춤), `collectProjectSourcePaths` | `.gpr` 소스 목록 동기화 |
| 이 프로젝트와 **함께 컴파일되는** 파일 | `resolveProjectLibraryDirs`, `collectRelatedGprPaths` | 심볼·참조 검색·디버그 소스 매핑 |

- `controller/gprSync.ts` — `ParsedGpr.libraries`(`GprLibraryEntry[]`) 추가. `ProjectLibrary` 줄을 **인식만**
  하고 소스 동기화의 추가/제거 대상에서 제외한다(`applyGprSync`는 종전대로 그 줄을 보존).
- `controller/responseParser.ts` — `GprInfo.libraries: string[]` 추가.
- `project/projectSources.ts` —
  - `listSourceFilesRecursive`에 `stopAtNestedProject`(기본 **켬**) + 결과에 `nestedProjects[]`.
    폴더 직속에 `.gpr`가 있으면 그 아래로 내려가지 않는다(루트 자신은 제외).
  - `gprPathInDir()` 신설(`Project.gpr` 우선) — `findNearestGprOnDisk`도 이걸 쓰도록 정리.
  - `resolveProjectLibraryDirs()` — 값 하나를 **기준점 순서대로** 시도한다: ① 프로젝트 폴더 기준
    → ② projects 루트(부모) 기준(실측) → ③ 알려진 `.gpr` 중 폴더 경로 **끝이 일치**하는 것(폴백).
    `.gpr`가 실제로 있는 첫 후보를 채택한다. 라이브러리의 라이브러리까지 재귀하고(기준점은 **누적**
    — 중첩 라이브러리가 projects 루트 기준 표기를 써도 풀린다), 순환 참조는 방문 집합으로 끊는다.
    해석 실패는 삼키지 않고 `unresolved[]`로 돌려준다.
  - `collectRelatedGprPaths()` — `[자기, 참조 라이브러리…, **자기를 라이브러리로 참조하는 프로젝트**…]`.
    역방향이 참조 검색 비대칭의 해법이다.
- `project/projectFileScope.ts` — `resolveProjectFileScope`가 관련 `.gpr` 전체의 소스 합집합으로 범위를
  만들고 `relatedGprPaths`를 결과에 담는다.
- `controller/gprSyncCommand.ts` — 중첩 프로젝트를 제외했다는 사실을 출력 채널에 남긴다(조용히 빼지 않음).
- `controller/projectPicker.ts` — `mapLibraryDirs()`로 "다른 프로젝트가 참조하는 폴더"를 찾아 QuickPick에
  `$(library)` 아이콘 + `라이브러리 · <참조 프로젝트>` 설명을 붙인다. **목록에서 빼지는 않는다**
  (라이브러리도 열어 편집하고 따로 배포할 수 있어야 한다).
- `controller/deployService.ts` — 배포 trace에 `Library:` 줄. 폴더 **안**(함께 업로드됨) / 폴더 **밖**
  (이 배포에 포함되지 않음 — 따로 Deploy 필요) / 해석 실패를 구분해 알린다.
  **업로드 대상 자체는 종전과 같다** — 제어기 쪽 라이브러리 배치 규칙이 미검증이라 임의로 넓히지 않았다.
- `debug/gplDebugSession.ts` — `_updateProjectDirs`가 라이브러리 폴더와 그 `ProjectSource`도 넣는다.
  라이브러리 폴더는 메인 프로젝트 폴더 **뒤에** 붙인다(`_bpFileForms`가 첫 일치 폴더로 상대 경로를
  만들므로 메인 기준 표기 `MyLibrary\Project.gpl`이 먼저 나와야 한다).

### 검증

- `npm test` **544/544 통과**(신규 8건: 중첩 경계·경계 해제 시 종전 동작·동기화 회귀·두 기준점 해석·
  형제/중첩/순환 참조·알려진 `.gpr` 폴백·양방향 `collectRelatedGprPaths`·`ProjectLibrary` 파싱/보존).
- `npm run compile` 무오류.
- **실제 폴더로 확인** — 컴파일된 모듈을 사용자의 `projects/MyProject`에 직접 돌렸다:
  `libraries=['MyProject\MyLibrary']`, 소유 파일 = `Main.gpl`·`Modules\*.gpl`(라이브러리 제외),
  `nestedProjects=[projects/MyProject/MyLibrary]`, 동기화 계획 `toAdd=[] toRemove=[]`,
  라이브러리 해석 성공, 범위는 양방향(`MyProject↔MyLibrary`). 기존 프로젝트
  (`Lib_Apps`/`MergeCode`/`MergeCode_Beta`)는 `nested=0 libs=0`으로 **동작 변화 없음**.

### 남은 일

- 실기기 확인은 §3 체크리스트(§1-BX) 참조. 핵심은 **제어기에서 라이브러리가 어디 있어야 하는가**
  (`/GPL/<메인>/<라이브러리>` vs `/GPL/<라이브러리>`)이고, 여기에 따라 배포 범위를 넓힐지 결정한다.
- 라이브러리 프로젝트를 Start 대상으로 고르면 `ProjectStart`가 없어 실패한다 — 미리 막을지 결정 필요.
- `ProjectLibrary`를 2개 이상 쓸 때 줄이 반복되는지 미확인(파서는 반복 줄 기준으로 구현).

## 1-BY. 2026-08-31 세션 — FTP 섹션 "폴더 비우기" 버튼(제어기 `/GPL` 통째로 삭제)

### 발단 (사용자 요청)

> "패널에 FTP (/GPL) 폴더 전체 DEL 하는 버튼 있으면 좋을 것 같아."

종전에는 트리의 FTP 항목을 **하나씩** 우클릭 → 삭제(`gpl.controller.ftpDelete`)해야 했다.
프로젝트가 여러 개 쌓인 `/GPL`을 비우려면 항목 수만큼 클릭이 필요했다.

### 조치

- `src/controller/ftpClient.ts`
  - **`clearRemoteDir(host, remotePath, onDelete?)`** 신설 — **폴더 자체는 남기고 한 단계 아래 항목만** 지운다.
    `/GPL`·`/flash/projects`는 제어기가 고정으로 들고 있는 경로라, 폴더가 사라지면 이후 업로드/Load 경로가
    달라진다. 한 FTP 세션으로 처리하고 개별 실패는 `failed[]`로 모아 돌려준다(하나가 걸려도 나머지는 계속 삭제 →
    호출측이 "부분 완료"로 알린다).
  - **`normalizeAbsoluteRemoteDir()`** 신설(export) — `/GPL/`·`//GPL` → `/GPL`. 빈 경로·루트는 `/`로 수렴시켜
    **호출측과 `clearRemoteDir` 양쪽이 안전장치로 쓴다**(설정 오입력으로 파일시스템 전체를 지우는 사고 방지 —
    루트/빈 경로는 FTP 연결 **전에** 예외).
- `src/extension.ts` — 명령 **`gpl.controller.ftpClearFolder`**. 게이트 순서:
  1. 대상 경로 결정 — 섹션 노드의 `remotePath`(화면에 보이는 경로) 우선, 없으면 설정값. 루트/빈 경로면 중단.
  2. **배포 잠금**(`currentDeployLockHolder`) — 업로드/컴파일 중이면 실행하지 않는다(반쯤 지워진 소스가
     컴파일되는 것을 막는다).
  3. `listRemoteDir`로 지울 목록 확보(비어 있으면 알리고 종료).
  4. **쓰레드 정지 게이트 `ensureIdleBeforeRemoteDelete()`** — `Show Thread  -web` 목록에 쓰레드가 **하나라도**
     있으면 동작 중으로 보고(`controller/threadActivity.ts` 규약), 사용자가 승인할 때만 `Stop -all` +
     `verifyAllStopped`까지 통과해야 진행한다. STATUS를 못 받으면(확인 불가) 정지 상태로 추정하지 않고
     사용자에게 판단을 넘긴다(하드 규칙 2). `Stop -all`의 STATUS -752는 busy로 보고 settle 게이트로 판정(§0.6).
  5. **모달 확인** — 지울 항목을 최대 15개까지 보여 주고, flash 섹션이면 "제어기 재부팅으로도 복구되지 않음" 경고.
  6. 삭제 후 `forgetSyncManifest`(base + 지운 폴더들) → 지문이 남아 다음 동기화가 스킵하는 것을 막는다 →
     `refreshFtp`. 실패 항목은 출력 채널에 남기고 "부분 완료"로 알린다.
- `src/views/controllerTreeProvider.ts` — `SectionNode.remotePath` 추가, FTP 섹션 생성 시 basePath를 담고
  `toSectionItem`이 TreeItem에 붙여 준다(InfoNode와 같은 방식). 섹션 헤더 명령이 대상 경로를 인자로 받는다.
- `package.json` — 명령 `GPL: FTP 폴더 비우기 (제어기의 파일 전체 삭제)`(`$(trash)`),
  `/GPL` 섹션 헤더 **인라인 버튼**(`inline@9` — 새로고침 다음 자리), 우클릭 메뉴는 `/GPL`·Flash Projects 양쪽.
  **Flash Projects에는 인라인 버튼을 두지 않았다** — 영구 삭제라 오클릭 비용이 커서 우클릭으로만 노출한다.

### 검증

- `npm run compile` 통과. `npm test` **547/547** 통과 — 신규 `src/test/ftpClient.test.ts` 3건
  (경로 정규화 · 빈 경로/루트 수렴 · `clearRemoteDir`이 루트·빈 경로를 **연결 전에** 거부).
- **실기기 미검증** — §3 체크리스트(§1-BY) 참조.

### 남은 일 / 미검증

- `/GPL/<프로젝트>`를 FTP로 지웠을 때 제어기의 **로드본 상태**가 어떻게 되는지 미검증. 모달에는
  "제어기에 로드된 프로젝트 상태는 별개이므로 필요하면 Unload도 함께 하세요"라고만 안내한다 — 실측 후 확정할 것.
- 항목이 많을 때 basic-ftp `removeDir`(재귀 삭제)의 소요 시간·제어기 부하 미측정.

## 1-BZ. 2026-08-31 세션 — GPL Console 줄 접두사를 `[RT] [<프로젝트>]` → 시각으로

### 증상

GPL Console의 모든 줄이 `[RT] [MyProject] ...` 로 시작해 실제 메시지가 밀렸다. 채널 자체가 런타임
전용이고 한 번에 한 프로젝트만 실행되므로 두 접두사 모두 매 줄 반복되는 상수였다. (샘플 출력에서
`[MyProject]`가 두 번 보인 것 중 뒤쪽은 확장이 아니라 GPL 코드의 `LogModule.SetPrefix`가 붙인 것.)

### 조치 (의도 → 방법)

- 기본 출력을 `[14:23:07] MyProject start` 형태(로컬 시각 `HH:mm:ss`)로 바꿨다. 고정 문자열을 다른
  고정 문자열로 갈아끼우는 대신 **설정 하나로 일반화**했다: `gpl.runtimeConsole.linePrefix` =
  `time`(기본) / `time+project` / `none` / `legacy`(종전 `[RT] [<프로젝트>]`).
- 접두사 조립은 순수 함수 `formatRuntimeConsoleLine(message, project, mode, at)`으로 분리해
  `src/controller/runtimeConsoleGuards.ts`(vscode 무의존 — 테스트 러너가 순수 node라 vscode를 import하는
  `runtimeConsole.ts`에는 둘 수 없다)에 뒀다.
- `runtimeConsole.outputLine(normalized, project)`이 프로젝트명을 **인자로** 받는다. 종전에는 type-3 프레임
  처리부에서 `[${project}] ` 를 메시지 문자열에 미리 섞어 `_onDidReceiveLine` 리스너까지 접두사가 흘러갔다.
  이제 접두사는 출력 채널에만 붙고 리스너에는 원문이 간다(현재 외부 리스너 0개 — 향후 파싱 안전).
- 상태 로그(`[Console][RC1403] STATE=...`)는 별도 경로(`appendStateLine`)라 무변경.

### 검증

- `npm test` **551/551** 통과 — 신규 4건(기본 time, 세 모드, 프로젝트명 없을 때 빈 대괄호 미발생,
  모든 모드가 메시지 원문 보존).

### 남은 일

- 밀리초 표시(`HH:mm:ss.SSS`)는 넣지 않았다. 1403 프레임 재조립·폴링 간격을 눈으로 좇을 일이 생기면
  포맷도 설정으로 뺄 것.

## 1-CA. 2026-08-31 세션 — 정의찾기(F12)가 한정자를 버리고 동명의 남의 심볼로 점프하던 문제

### 증상

사용자 프로젝트(`시뮬레이션\projects\MyProject`)의 `Main.gpl:23`에서 `Run` 위에 정의찾기를 하면
전혀 무관한 `Lib_Apps\Lib_MoveQueue.gpl:38 Public Sub Run(start As Integer)`으로 이동했다.

### 원인

`GPLDefinitionProvider.provideDefinition`의 **마지막 폴백**이 한정자(qualifier)를 완전히 버리고
`symbolCache.findDefinitionMatches(word, ...)`로 **워크스페이스 전체 이름 인덱스**를 뒤진다.
그런데 그 앞 단계인 멤버 접근(`obj.member`) 해석은 **실패해도 `return`하지 않고 흘러내려온다** —
`[Object NOT Found]` / `[No Type Info]` / `[Member NOT Found]`(모듈·클래스 정적·인스턴스 3갈래) /
베이스 표현식 추출 실패 전부 로그만 남기고 통과했다. 그 결과 워크스페이스에 `Run`이 하나뿐이면
무엇을 한정자로 썼든 그리로 점프한다(인자 1개면 arity까지 맞아 확신도가 더 올라간다).

특히 **내장 객체 멤버는 구조적으로 항상 이 경로로 떨어졌다** — `definitionProvider.ts`는
`gplDictionaryData`/`gplBuiltins`를 import조차 하지 않아 `Move.`·`Console.`·`Robot.`·`Dim t As Thread`
같은 수신자를 해석할 방법이 없었고, 전부 `[Object NOT Found]` → 전역 이름 폴백이었다.

### 조치 (의도 → 방법)

원칙: **수신자 타입이 확정된 멤버 접근은, 그 한정자에 속하지 않은 심볼로 이동하지 않는다.**
조용히 틀린 곳으로 점프하느니 "정의 없음"이 안전하다(문자열 리터럴 경로가 이미 쓰던 철학).

- **내장 클래스 수신자 차단** — 수신자 타입 이름을 확정(사용자 모듈/클래스 이름 → 변수의 선언 타입
  → 표기된 이름 순)한 뒤 `isGplBuiltinClassName`이면 `undefined`를 돌려준다. 내장은 이동할 소스가
  없으므로 폴백에 맡길 이유가 없다. 같은 이름의 **사용자 클래스/모듈이 실제로 있으면 차단하지 않는다**
  (`hasUserContainerNamed` — 사용자가 직접 만든 `Location` 클래스 등).
- **컨테이너가 확정된 멤버 미발견 차단** — 모듈·클래스 정적·인스턴스 3갈래 모두 실패 시
  `resolveOwnedMemberOrBlock`으로 넘어가 전역 폴백 대신 `undefined`.
  단, 인스턴스 경로는 **클래스 정의가 인덱스에 있을 때만** 차단한다. 없으면(캐시 stale·미인덱싱 파일)
  종전대로 폴백에 맡긴다 — 여기서 막으면 "파일을 방금 복사해 와 캐시가 낡은" 경우를 못 찾는다.
- **폴백이 우연히 해 주던 일은 잃지 않는다** — `findMemberCandidatesInModule/Class`는 종류(kind)를
  좁게 걸러 **모듈 안의 클래스(`MyModule.MyClass`)·중첩 클래스(`Outer.Inner`)·모듈 수준 Property**를
  놓친다. 그동안 그런 접근은 전역 폴백 덕에 우연히 동작했다. 그래서 차단 직전에 소속을 검사하는
  조회를 한 번 더 둔다: `receiverType.ts`에 `nestedTypesIn`(중첩 타입 선언)과 이를 `membersNamed`와
  합친 **`ownedByHolder`** 를 신설하고 provider가 그것을 쓴다. `descend`의 중복 구현도 여기로 통합.
- 클래스 심볼의 `className`은 파서가 **자기 자신**으로 채운다(`gplParser.ts:203`). 소속 판정은
  `parentClassName`(중첩) / `module`(모듈 최상위)로 해야 한다 — `receiverType.test.ts` 픽스처도
  이 사실에 맞게 고쳤다(종전 픽스처는 `className`을 비워 둬 실제와 달랐다).

### 검증

- `npm run compile` 통과, `npm test` **555/555** 통과 — 신규 4건(`ownedByHolder`가 다른 컨테이너의
  동명 Sub로 새지 않음 = 이번 버그 회귀, `Module.Class`·`Outer.Inner`를 찾음, 클래스 멤버 결과 유지,
  `nestedTypesIn`은 일반 멤버를 잡지 않음).
- **미검증**: 실제 `Main.gpl:23`이 어느 갈래였는지는 사용자 확인 대기(§3). 점 없는 맨 호출
  (`Call Run(0)`)이었다면 이번 변경으로는 동작이 달라지지 않는다.

### 남은 일

- `[No Type Info]`(베이스 심볼은 찾았는데 타입이 없는 변수)는 여전히 전역 폴백으로 간다. 막으면
  타입 추론이 약한 코드에서 정의찾기가 통째로 죽으므로 남겨 뒀다. 오탐 신고가 또 나오면 재검토.
- hover/자동완성에도 같은 "한정자 버리는 폴백"이 있는지 미확인 — `hoverProvider.ts:399`의 폴백은
  현재 문서 온디맨드 파싱이라 성격이 다르지만 확인 필요.

## 2. 진행 중 / 코드 쪽 미결 (사용자 결정 대기)

- **`ProtocolModule.gpl` 478·480의 `-760 Invalid assignment`**: `isOrgCompleted`는 `RobotModule.gpl:828`에 **`Public ReadOnly Property ... As Boolean`**(읽기 전용)으로 정의됨. 거기에 값을 대입해서 나는 에러. 해결책(택1, 사용자 결정 대기): setter 메서드 추가 / `ReadOnly` 제거 후 `Set` 접근자 추가 / backing 필드 직접 대입.
- (참고) GDE 기준 원래 4개 에러(477 -730, 478 -760, 479 -748, 480 -760)였는데 477/479는 사용자가 정리한 듯, 현재 478/480만 남음.

## 3. 다음에 할 일 (체크리스트)

- [ ] **(2026-08-31, §1-CA) 정의찾기 한정자 폴백 차단 — 편집기 동작 확인(제어기 무관, 모션 무영향)**: ① **원인 확정**: 신고된 `시뮬레이션\projects\MyProject\Main.gpl:23`의 **줄 원문**을 받아 `gpl.trace.server: verbose` + Output `GPL Language Support`에서 `[Definition Request] … Word: "Run"` 뒤에 찍히는 태그를 확인한다 — `[Builtin Receiver]`/`[Member NOT Found] … 전역 폴백 차단`이면 이번 수정으로 해결, `[Fallback Search]`가 그대로 나오면 **점 없는 맨 호출**(`Call Run(0)`)이라 다른 문제다(이 경우 GPL이 한정자 없는 크로스 모듈 호출을 허용하는지부터 확인). ② `Move.Loc` 같은 내장 멤버에서 F12 → 아무 데도 가지 않는지(종전에는 동명 사용자 심볼로 점프). ③ `모듈.클래스`·중첩 클래스 `바깥.안쪽`·모듈 수준 Property F12가 **여전히 되는지**(폴백 차단으로 잃지 않았는지 — 이번 회귀 위험 1순위). ④ 파일을 새로 복사해 와 캐시가 낡은 상태에서 `인스턴스.멤버` F12가 종전처럼 찾아지는지(stale 안전망 유지 확인).
- [ ] **(2026-08-31, §1-BY) FTP 폴더 비우기 — 실기기 검증(파일 삭제만, 모션 무영향이지만 되돌릴 수 없음)**: ① 쓰레드가 도는 상태에서 `/GPL` 섹션의 휴지통 버튼 → 정지 게이트 모달이 뜨는지, 취소하면 **아무것도 지워지지 않는지**. ② 승인 시 `Stop -all` → 정지 확인을 거친 뒤에만 삭제가 시작되는지. ③ 삭제 후 트리 `/GPL`이 비고, 이어서 Deploy가 최초 업로드 경로(FTP 폴더 생성)로 정상 동작하는지 — 지문(manifest)이 남아 파일이 스킵되지 않는지(`forgetSyncManifest` 확인). ④ `/GPL/<프로젝트>`를 지운 뒤 제어기 로드본 상태(`Show Thread`·`Compile <name>`·`Load`)가 어떻게 되는지 기록 → 모달 안내 문구(Unload 병행 여부) 확정. ⑤ 항목이 많을 때 소요 시간과 부분 실패 표시(`failed[]`) 동작.
- [ ] **(2026-08-31, §1-BX) 중첩 프로젝트(`ProjectLibrary`) — 검증**: 대상은 `projects/MyProject`(라이브러리 `MyProject/MyLibrary`). **①③은 제어기 확인(업로드·컴파일만, 모션 무영향), ②④⑤는 편집기 동작.** ① `MyProject` Deploy → trace의 `Library:` 줄이 `폴더 안(함께 업로드됨): MyLibrary`로 나오는지 · FTP에 `/GPL/MyProject/MyLibrary/…`가 올라가는지 · `Compile MyProject`의 `<STATUS>`가 0인지(= 제어기가 중첩 배치 그대로 라이브러리를 찾는다). 실패하면 STATUS·문구를 기록하고, `/GPL/MyLibrary`로 따로 올렸을 때는 되는지 대조 — **이 답에 따라 배포 범위를 넓힐지 결정한다**(§1-BX 남은 일). ② `.gpr` 우클릭 → 소스 목록 동기화: `MyLibrary\Project.gpl`이 **추가 후보로 뜨지 않고**, 출력 채널에 `중첩 프로젝트는 동기화 대상에서 제외: MyLibrary`가 남는지 · `autoSyncSources: auto`에서도 조용히 추가되지 않는지. ③ 라이브러리 소스(`MyLibrary/Project.gpl`)에 BP → `Set Break MyProject "…"` 가 어떤 파일 표기로 통하는지(basename인지 `MyLibrary\Project.gpl`인지) · 정지 시 올바른 파일이 열리는지. ④ 라이브러리의 `Public Sub T1`에서 Shift+F12 → **메인 `Main.gpl`의 호출부**가 나오는지(역방향 — 이번 수정의 핵심) · 반대 방향도 나오는지 · F12/F2도 양방향인지. ⑤ 프로젝트 QuickPick(다중 후보)에서 `MyLibrary`가 `$(library)` 아이콘 + `라이브러리 · MyProject에서 참조`로 표시되는지. ⑥ (여유가 되면) GDS에서 라이브러리를 **2개** 추가해 `.gpr` 줄이 반복되는지 확인 → `docs/reference/project-file-gpr.md` §8-1 종결.
- [ ] **(2026-08-28, §1-BW) 프로젝트 하위 폴더(중첩 소스) — 검증**: **①은 제어기 확인(업로드·컴파일만, 모션 무영향), ②~⑥은 편집기 동작**. ① `TEST_GPL`(`Main.gpl` + `T1\T1.gpl` + `T1\T2\T2.gpl`)로 Deploy → FTP trace에 `T1/T2/T2.gpl`이 원격 같은 구조로 올라가는지, `Compile TEST_GPL`의 `<STATUS>`가 0인지(= 제어기가 상대 경로 항목을 연다) — 실패하면 어떤 STATUS·문구인지 기록. ② 하위 폴더 소스에 BP → 파일명 표기로 성공하는지, 실패 시 로그에 `파일 표기 … 거부 → 다른 표기로 재시도` 뒤 `프로젝트 기준 상대 경로로 받습니다`가 뜨는지(어느 쪽이 참인지 §1-BW에 확정 기록) · 정지 시 **올바른 파일**이 열리는지. ③ `T1\T2\T2.gpl`의 Sub에서 Shift+F12 → 루트 `Main.gpl`의 호출부가 나오는지, 반대 방향(루트에서 하위 폴더 참조)도 나오는지 · `gpl.trace: verbose`의 `[References] … origin=project (files=N)` 확인. ④ F12/자동완성/이름 바꾸기(F2)가 중첩 파일 간에 동작하는지. ⑤ `.gpr` 우클릭 → 소스 목록 동기화: 하위 폴더 항목이 **제거 후보로 뜨지 않고**, 새로 만든 `T1\T2\T3\New.gpl`이 `추가`로 뜨며 기록 구분자가 `\`인지 · `autoSyncSources: auto`에서 하위 폴더 생성/삭제에 반응하는지 · GDE에서 그 `Project.gpr`가 정상 열리는지. ⑥ 같은 basename을 서로 다른 하위 폴더에 둔 경우(`T1\A.gpl`, `T1\T2\A.gpl`) 디버그 정지 시 `.gpr` 목록에 있는 쪽이 열리는지.
- [ ] **(2026-08-28, §1-BV) 업로드 지문(SHA-1) 스킵 판정 — 실기기 검증(업로드만, 모션 무영향)**: ① `.gpl`을 **같은 길이로** 고치고(예: 상수 `10`→`20`) 빠른 컴파일 → trace에 그 파일이 `↑ [n/N]`로 전송되는지(종전이라면 스킵됐을 파일). ② 아무것도 고치지 않고 다시 실행 → 그 파일이 skipped로 빠지는지(스킵 자체는 살아 있어야 한다 — 매번 전량 업로드가 되면 지문이 저장되지 않는 것). ③ 확장 설치 직후 첫 실행에서 `(첫 동기화 — 지문 기록 없음, 전체 업로드)`가 한 번만 뜨고 다음 회차부터 정상 스킵되는지. ④ 제어기 FTP 목록이 mtime을 주는지(주면 다른 PC/GDE가 바꾼 원격 파일까지 감지된다 — 트리의 FTP 항목에 시각이 보이는지로 대략 확인). ⑤ flash 저장(Save to Flash)도 같은 규칙으로 동작하는지.
- [ ] **(2026-08-28, §1-BU) 공식 문서 기준 디버깅 조작 — 실기기 검증**: ① **Jump to Cursor**(모션 영향 — 저속/시뮬레이션 필수): 정지 상태에서 같은 프로시저 안 줄 우클릭 → '커서까지 이동' → 경고 모달 → `Set Thread <스레드> -line <줄>` STATUS 0 · 새 위치로 화살표 이동 · 다른 프로시저/주석 줄에는 메뉴가 나오지 않는지 · `gpl.debug.jumpToCursor: "on"`에서 모달 생략 / `"off"`에서 메뉴 없음 ② **Step Into Target**: 한 줄에 호출 2개 이상인 지점에서 우클릭 → 대상 선택 → 임시 BP + `Continue` 후 그 프로시저에서 정지 · 정지 뒤 `Show Break`에 임시 BP가 남지 않는지 · 정의를 못 찾는 호출은 목록에 없는지 ③ **프로시저 이름 BP**: BREAKPOINTS 뷰에 `Class.Proc` 입력 → 첫 실행 줄에 설정 · 같은 파일 소스 BP 갱신 시 사라지지 않는지 ④ **BP 줄 보정**: 빈 줄/주석에 BP → 다음 실행 줄로 옮겨 표시되고 메시지가 이유를 설명하는지 · 33개째 BP에서 상한 경고 로그 ⑤ **조건부 BP**(`clientSideBreakpointLogic` 켠 뒤, 자동 Continue 발생 — 저속/시뮬레이션): 조건 불일치 시 자동 재개 로그 1회 + 히트 조건 `>3` 동작 + 로그포인트 `{식}` 치환 출력 · 조건 평가 실패 시 정지를 유지하는지 ⑥ **Start `-event`**: GPL Traffic에 `Start <프로젝트> -event`가 나가고 1403 수신량·상태 이벤트가 종전보다 늘어나는지(`startEventMode` 끄면 `-noevent`) · `startStackSizeKb`/`startTrace` 반영 ⑦ **Set Nobreak 폴백**: 로그에 `문서 표기로 재시도`가 뜨는지(뜨면 이 제어기는 공백 형식을 요구 — 조사 문서 §1 갱신) ⑧ **쓰레드 존재 = 동작 중**: `Execute` 로 `_Cmd_<프로젝트>` 쓰레드를 만든 상태에서 빠른 컴파일 → 진행하지 않고 확인/보류하는지 · `Idle` 상태 쓰레드만 남았을 때도 같은 판정인지 ⑨ **MCP**: `read_dataids({ids:[2003], hex:true})` → `pdx` 응답 · `node` 인자 지정 시 응답 형식.
- [ ] **(2026-08-28, §1-BT) 문서화 주석 — 편집기 동작 확인(제어기 무관, 모션 무영향)**: ① `samples/hello-project/Main.gpl`의 `Clamp` 이름 위 호버 → 설명 + Parameters 목록 + Returns + ```gpl 예제 블록이 보이는지(기본 `gpl.hover.docComment=summary`, `docCommentMaxLines=6`에서도 매개변수가 안 잘리는지) ② `Clamp(` 입력 시 시그니처 도움말에서 **활성 매개변수의 설명만** 뜨는지 ③ 선언 바로 위에서 `'''` 입력 → 골격 스니펫이 제안되고 삽입 뒤 **들여쓰기가 2배가 되지 않는지**, Tab으로 칸 이동이 되는지 ④ 선언 줄 전구 → `문서화 주석 생성`, 이미 주석이 있는 선언에서는 `보완`이 뜨고 매개변수를 하나 추가한 뒤 실행하면 **빠진 항목만** 추가되는지(기존 설명 보존, CRLF 유지) ⑤ 머리글 없는 옛 주석이 종전과 똑같이 보이는지 ⑥ `gpl.docComment.includeExamples=true`에서 `# Examples` 골격과 호출 예시가 함께 생성되는지.
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
- [x] (2026-07-10, §1-J) Hover/IntelliSense/Signature Help 개선 + Brooks 사전 +155 — 샌드박스 tsc·90테스트 통과. (실기기 표시 확인은 사용자)
- [ ] (§1-J 후속) 캐시 초록 기반 60개(XmlNode/Network/Modbus) 항목을 web_fetch rate limit 해제 후 라이브 페이지로 파라미터 세부 재확인.
- [ ] 사용자 로컬(Windows)에서 `npm run package` 1회 실행해 재검증 후 새 VSIX 재설치. ※ 2026-07-03: 샌드박스 검증 완료, `dist/gpl-language-support-0.6.24.vsix` 생성됨(§1-C).
- [ ] §2 `isOrgCompleted` 대입 방식 확정 후 코드 수정 → MergeCode 재컴파일로 `-742` 해소 확인.
- [x] (2026-08-28, §1-BV) F5/Build Only 경로의 **로컬 매니페스트 기반 차등 업로드** — `controller/syncManifest.ts`(globalState 영속)로 스킵 판정에 내용 SHA-1 + 관측 원격 mtime을 더했다. 크기충돌 누락 해소. 남은 확인은 실기기에서 "같은 크기 편집이 실제로 전송되는가"(§3 실기기 체크).
- [ ] 정의 찾기: 클래스 멤버 스코프 해석(`obj.member`를 obj의 클래스 한정으로) 정확도는 추후 보강 여지. ※ 오버로드 해석(인자 개수+타입, 동점 peek)은 2026-07-13 §1-K에서 구현 완료.
- [ ] (§1-P → §1-U에서 일부 완료) 실기기 검증: 1402 수동 검증으로 객체 덤프 형식 확인·분류 버그 수정(2026-07-22, §1-U). **남은 것(VSIX 재설치 후)**: Variables/hover/Watch에서 객체 트리 확장 UI 확인, 로컬 배열 펼침(30개 상한), 중첩 객체(`cmdResponse`), setVariable, Globals 패널 배열/객체 표시. 배열 확장 지연 크면 `ARRAY_EXPAND_MAX` 조정.
- [ ] (2026-07-16, §1-Q) 자체 검토 세션 변경분 — 로컬 `npm run compile` && `npm test` 후 §1-Q 실기기 검증 체크리스트 수행.
- [ ] (2026-08-18, §1-AY) Rename(F2) 실사용 검증 — MergeCode에서 로컬 변수/모듈 프로시저/클래스 멤버/스레드 문자열 참조 rename 확인. 다음 릴리스 CHANGELOG에 "Rename(F2) 지원" 기재.
- [x] (2026-08-18, §1-AZ → §1-BA 완료) GitHub Pages 첫 배포 — Pages를 API로 `build_type=workflow` 활성화, 커밋 `915c97a` 푸시 → docs.yml 성공, 사이트 HTTP 200 확인(https://nir414.github.io/GPL_language/). 같은 푸시의 CI(compile)도 성공.
- [x] (§1-AZ → §1-BA 완료) 런북 Command ID 표 재생성 — package.json `contributes.commands` 57개 기준 카테고리별 재생성(연결/상태, 배포/실행, 디버그/콘솔, 조회/IO, AI 전용, 트리 전용).
- [x] (§1-AZ → §1-BA 완료) 런북 ↔ instructions 정본 단일화 — 양쪽 최상단에 역할 분담 명시(instructions=하드 규칙·가드 정본, runbook=절차·전체 명령 표·pktmon 실측·STATUS 판단표 정본). instructions의 `-752`를 "Timeout stopping thread, 비치명"으로 교정, 낡은 명령 제목 갱신. 표 자체의 물리적 제거는 하지 않음(AI 자동 로드 파일의 자족성 유지).
- [x] (§1-AZ → §1-BA 완료) `pre-release-check`에 README "현재 버전: **vX.Y.Z**" ↔ package.json 대조 검사 추가 (불일치·표기 부재 시 실패).
- [x] (§1-AZ → §1-BA 완료) `gpl-language/` Test_robot 잔재 정리 — file-io.md를 범용 지식만 남기고 구현 설명은 `archive/test-robot/file-io-implementation.md`로 분리. networking/thread-safety/error-handling/error-prevention의 "이 저장소에 있다"는 프레이밍을 "옛 프로젝트 사례"로 교정(예제 코드 자체는 유효하므로 유지).
- [ ] 변경분 커밋/배포 및 회귀 확인.

### 3-B. 코드 리뷰 권고 — 미적용(검증/결정 필요)

위 §1-B에서 **안전 항목만** 적용했고, 아래는 영향이 크거나 실측이 필요해 보류했었다.
**2026-07-16(§1-Q)에서 사용자 승인 하에 대부분 적용** — 각 항목의 완료 표시와 실기기 검증 필요 여부 참조.

#### 컨트롤러/디버그 — 모션·하드웨어 영향 → **저속/시뮬레이션 우선 검증 필수**
- [x] **B1** → **적용(2026-07-16, §1-Q)**: `_bpCommand` 헬퍼로 5곳 전부 GDE 실측 no-space 통일. [실기기: disconnect 후 Show Break 잔재 확인]
- [x] **B2** → **적용(2026-07-16, §1-Q)**: `gpl.controller.requireStartConfirmation`(기본 true) — deployService Phase4 + configurationDone 자동 Start에 모달 게이트. `-break -bex`(엔트리 정지)는 제외.
- [x] **B3** → **적용(2026-07-16, §1-Q)**: classifier 정비 + REPL 게이트(`gpl.debug.confirmDestructiveRepl` 기본 true), 비접두사 폴스루는 읽기 전용만. setVariable은 CR/LF 거부(확인 모달은 과도하여 미적용).
- [x] **B4/B5** → **적용(2026-07-16, §1-Q)**: terminator-first(버퍼 끝 판정) + `meta.responseComplete`=STATUS 수신만 인정 + close 부분버퍼 INCOMPLETE 표시. idle 완료 자체는 HTTP 교차 응답 감지 의존성 때문에 유지.
- [x] **B6** → **적용(2026-07-16, §1-Q)**: `uploadVerified`(업로드 직후 SIZE 재확인, 확인된 불일치만 실패). rename(원자적) 방식은 제어기 RNFR/RNTO 지원 미확인으로 보류.

#### 언어 정확성 — 문서/실측 확인 필요
- [ ] **A1** `Replace` — 컨트롤러/GDE에서 `string.Replace(...)` 동작 실측. 동작하면 정확 시그니처+sourceUrl로 재등록(`gplBuiltins.ts`의 제거 주석 참고), 아니면 제거 유지.
- [x] **A5** → **종결(2026-07-16, §1-Q)**: `waitforoem.htm`이 Brooks 공식 파일명(라이브 확인 — 해당 URL이 실제 Move.WaitForEOM 페이지, `waitforeom.htm`은 빈 페이지). 수정 불필요.

#### TS 품질 — 안전하나 범위 큼(미적용)
- [ ] `extension.ts`(3182줄) → 분리 **보류(2026-07-16)** — 행동 수정과 구조 변경 혼합을 피함. 분리 지도(섹션 경계/공유 상태/모듈 제안)는 §1-Q 남은 일 참조.
- [x] `diagnosticProvider` → **적용(2026-07-16, §1-Q)**: `gpl.diagnostics.experimental` 설정 게이트(기본 off) + getDiagnostics 삭제 + optional-parameter 오진단 삭제.
- [x] `symbolCache.findReferences` → **적용(2026-07-16, §1-Q)**: 미오픈 파일 fs.readFile 스캔 + "정의 보유 파일만" 필터 제거 + cancellation token.

## 4. 핵심 파일

```
.vscode/launch.json                      # F5 개발 호스트 — --profile=GPL-DevHost(기본 설정·확장 없는 격리 창) + samples/hello-project 를 연다 (§1-BP)
samples/hello-project/                   # 개발 호스트용 최소 GPL 프로젝트(Project.gpr + Main.gpl). 제어기 없이 언어 기능 확인용, VSIX 미포함 (§1-BP)
src/controller/controllerConnection.ts   # vscode 래퍼 — sendCommandDetailed(직렬 큐 + 명령 정책 before/after 적용, §1-BN) 옵션(keepAlive1402/idle) 전달, logTraffic(>>> / ' | ' / <<< / ---)·getTrafficLogOptions(§1-BG), closeControllerConnection/getConnectionStats/getRecentTraffic 재노출(§1-BI), probeControllerCommand/getConnectionProbeTimeoutMs(§1-BK), getCommandPolicySnapshot·isPolicyError 재노출(§1-BN)
src/controller/commandPolicy.ts          # 제어기 명령 정책(vscode 무의존) — R1 Step/Continue 정지 확인 대기+최소 간격(#28), R2 Start/Compile/Load/Unload 전 Stopping 정착 대기(§0.6), R3 Compile→Start 완충(§0.7); 승인/거부 없음, 한도 초과 시 PolicyError(미전송) (§1-BN)
src/gplDictionaryData.ts                 # GPL Dictionary 데이터(vscode 무의존) — Class.Member 항목 + GPL_CLASS_DOCS(클래스 개요·생성자). Thread는 공식 18페이지 전수 (§1-BR)
src/gplBuiltins.ts                       # 사전 API — usage/details 필드, findGplClassDoc·getGplClassMembers·findGplBuiltinMember(내장 타입 멤버 조회) (§1-BR)
src/language/receiverType.ts             # 수신자 타입 해석 — resolveReceiverHolder(사용자 클래스/모듈) + resolveReceiverTypeName(내장 포함 타입 이름) (§1-BJ, §1-BR)
src/controller/agentBridge.ts            # Agent Bridge 서버(vscode 무의존, 실행자 주입) — presence 파일·요청/응답 파일 IPC·gpl.* 범위 한정·순차 실행 (§1-BQ)
controller-mcp/src/extensionBridge.js    # Agent Bridge 클라이언트 — presence 판정/깨우기(code --open-url)/요청·응답 왕복/재전송 안전 판정 (§1-BQ)
src/controller/uriDispatch.ts            # 외부 진입점 URI 해석(vscode 무의존) — /<gpl.command.id>?args=JSON | ?key=value | /command?id=…, 별칭 4개, gpl.* 범위 한정 (§1-BN)
src/controller/connectionHealth.ts       # 연결 건강 판정(vscode 무의존) — ConnectionHealthMonitor(connected→suspect→lost, 프로브 임계 3/거부 2·힌트는 suspect만)·ConnectionHealthProber(1 s 재프로브)·classifyCommandFailure·probeOutcomeFromResponse (§1-BK)
src/controller/consoleSocket.ts          # 1402 소켓 계층(vscode 무의존) — keep-alive 소켓 1개, terminator-first 재사용 판정, stale 1회 재시도, 트래픽 링버퍼 600줄 (§1-BI, #22), reject code 부착·보관 소켓 관찰자(§1-BK)
src/debug/sourceTargets.ts               # BP 유효 줄·프로시저 범위(End Sub 기준)·호출 후보 파싱(vscode 무의존) — BP 줄 보정(문서 규칙)·Jump to Cursor 검증·Step Into Target 후보 (§1-BU)
src/controller/threadActivity.ts          # "동작 중" 판정(vscode 무의존) — 쓰레드 존재 = 활성, project 컬럼·기본 이름·`_Cmd_<project>`(Execute 쓰레드) 인정 (§1-BU)
src/controller/startCommand.ts            # Start 명령 조립(vscode 무의존) — 문서 구문 순서, 기본 `-event`(GDE 동일), `-compile` 금지(하드 규칙 7) (§1-BU)
src/debug/threadLock.ts                  # 스레드 단일 실행 잠금 판정(vscode 무의존) — resolveExecutionThread(대상 확정·staleLock)·shouldPreserveFocus·isAllThreadsResumeRequest. 어댑터의 StoppedEvent 는 전부 _stoppedEvent 경유(불변식) (§1-BS)
src/controller/idlePing.ts               # 1402 유휴 ping 판정/스케줄러(vscode 무의존) — GDE 방식 세션 유지(유휴 5 s → 읽기 명령 1개), 1403 안정성의 열쇠 (§1-BM)
src/controller/reachability.ts           # ping TTL·TCP·arp 도달성 판정 + 응답 장치 정체(제어기 vs 게이트웨이) 힌트 (§1-BI, #22)
src/controller/resourceProbes.ts         # Show Memory / Show Network -tcp / -mbuf 파서(실기기 원문 기준)·증가율·이력 (§1-BI, #22 자원 카드)
src/controller/runtimeConsoleGuards.ts   # 1403 접속 카운터(슬라이딩 윈도우)·워치독 판정(순수) (§1-BI)
src/controller/deployRecordCore.ts       # 컴파일 스냅샷(sha1) 기록/대조 순수 로직 + Memento 스토어 (§1-BI, #21)
src/controller/deployRecord.ts           # deployRecordCore vscode 래퍼 — recordCompiled/getCompiledRecord/onDidRecordCompiled/attachDeployRecordStore (§1-BI)
src/debug/stepGate.ts                    # Step/Continue 게이트 순수 판정 shouldGateStepRequest(pending-entry/pending-same-thread/min-interval) (§1-BI, #28)
src/controller/debugBridge.ts            # 디버그 세션 ↔ 확장 이벤트 버스 + RuntimeConsoleHealth 공급자(1403 alive → 백업 폴 완화) (§1-BI) + onDebugProbeResult(어댑터 폴 결과 → 연결 건강 모니터, §1-BK)
src/views/refreshThrottle.ts             # 트리 FTP/시스템 정보 자동 재조회 스로틀 판정(순수) (§1-BI, #22)
src/launchJsonc.ts                       # launch.json JSONC 읽기/부분 갱신(jsonc-parser) — 주석·포맷 보존 upsert (§1-BI, #30)
controller-mcp/src/batch.js              # MCP controller_command 배치 runBatch/normalizeCommandInput (§1-BI, #16)
src/controller/trafficResponseBody.ts    # ResponseBodyStreamer — 1402 응답 본문 줄 단위 스트리밍·상한 생략 요약(§1-BG, vscode 무의존 순수 모듈)
src/controller/deployService.ts          # deploy() = 잠금 획득 → UPLOAD → STOP/THREAD_CHECK(settle 게이트) → COMPILE → ERROR CHECK(§1-BD 재배치), tryCompile, directGpl(§1-G), COMPILE_DEFERRED, findProjectDirs(**/*.gpr)
src/controller/projectPickerCore.ts      # 프로젝트 폴더 선택 순수 규칙 — orderProjectDirs(최근 선택 우선)·projectDirFromResource(폴더 자체/.gpr/포함 파일)·filterDirsByProjectName (§1-BL, vscode 무의존)
src/controller/projectPicker.ts          # 공용 선택기 pickProjectDir(Detailed)(QuickPick·workspaceState 최근 선택)·readGprProjectName/projectNameOf·context key gpl.projectDirs(탐색기 메뉴) — 명령·F5 provider 공용 (§1-BL)
src/controller/projectNameGuard.ts       # 프로젝트명/Load 경로 안전성 단일 규칙(vscode 무의존) — 1402 명령은 공백 구분·인용 불가 → 공백·제어 문자 검출 checkProjectName/checkRemotePath·안내 문구 describeProjectNameProblem; deploy/Start/ftpRun·Unload/F5 attach/MCP proj()가 공유 (§1-BQ)
src/debug/activateDebug.ts               # DebugConfigurationProvider — 중복 세션 처리 + fillProjectTarget(다중 프로젝트 QuickPick, projectDir/projectName 보충) (§1-BL), InlineDebugAdapterFactory
src/controller/deployLock.ts             # 배포 잠금 — 메모리+파일(%TEMP%/gpl-controller/<ip>.lock.json), pid/heartbeat stale 자동 만료, describeDeployLock (§1-BD, 이슈 #15·#17)
src/controller/ftpClient.ts              # uploadProject onlyFiles, mirrorProject deferDelete + removeRemoteFiles(§1-BD), 지문 스킵 판정(§1-BV)
src/controller/syncManifest.ts           # 업로드 지문(SHA-1) 매니페스트 — 미러/skipUnchanged 스킵 판정(§1-BV, globalState)
src/controller/responseParser.ts         # parseStatus, parseCompileErrors
src/debug/showVariableParser.ts          # Show Variable 파싱 — 2열 Location 멤버(isTypeToken)·summarizeLocation·annotateLocationMember(§1-BF)
src/language/receiverType.ts             # 멤버 접근 수신자 타입 정적 해석(resolveReceiverHolder·membersNamed·buildDocumentReceiverLookup) + 소속 판정 ownedByHolder·nestedTypesIn(정의찾기 전역 폴백 차단용, §1-CA) — 디버그 hover 게이트·정적 hover 공용(§1-BJ, #32, vscode 무의존)
src/ai/exportAgentSetup.ts               # Export/Check AI Agent Setup — 사본 sha256 동기화(syncStableBundleIfStale)·inspectAiAgentSetup·CLAUDE.md 블록 버전 표식(§1-BF)
src/views/controllerDashboardPanel.ts    # 제어기 대시보드 웹뷰 — setInterval/pause/config 메시지(§1-BF); HTML은 media/dashboard.html
controller-mcp/src/parse.js              # MCP 파서 — parseThreadList(이름 키)·compactThread·summarizeThreads·parseShowVariable(§1-BF)
scripts/bundle-mcp.js                    # MCP 번들 + 빌드 스탬프(define __GPL_MCP_BUILD_JSON__, 사이드카 .build.json)(§1-BF)
src/debug/gplDebugSession.ts             # attachRequest, _runDeployBeforeAttach(lockOwner 'F5 Deploy'), _waitDeployLockForStart, getDebugDeployDiagnostics
src/extension.ts                         # runDeploy(잠금 조회 + warnDeployBusy), autoOnSave, 컴파일 필요 상태(compileStaleProjects/confirmStartWhenCompileStale), 트리 쓰레드 제어(sendThreadCommandChecked/runTreeThreadStep — aiBuildStepCommand 공유, §1-BE)
controller-mcp/src/deployLock.js         # 잠금 파일 읽기 전용 구현(확장과 파일 계약 공유) — Compile/Start/Load/Unload 유한 대기·거부(§1-BD)
src/gplParser.ts                         # Property/Sub/Function 파싱 + parseDocument 메모이즈 캐시(§1-B E) + docComment 수집(§1-J)
src/gplBuiltins.ts                       # 핵심 빌트인/String 함수 (Trim→메서드, Rnd(seed), Replace 제거, Asc/Chr/… 추가) + Bit 문자열 전역함수(§1-J)
src/gplDictionaryData.ts                 # Move/Robot/Location/Profile/.../String 클래스 사전 + Controller/Thread/Exception/File/XML/Network 등 +153(§1-J)
src/providers/completionProvider.ts      # 정적 항목 캐시, 트리거('.', '&')
src/providers/definitionProvider.ts      # token 확인 + parseDocument 재사용
src/providers/hoverProvider.ts           # token 확인 + docComment 표시(§1-J)
src/providers/signatureHelpProvider.ts   # Signature Help(빌트인+사용자 Sub/Function, §1-J 신설)
src/symbolCache.ts                       # 심볼 캐시 + 완성 문서화(buildSymbolDocumentation, §1-J)
src/project/projectSources.ts            # "프로젝트에 속한 소스" 단일 출처 — 재귀 목록·ProjectSource 해석·소유 .gpr 선택(§1-BW, vscode 무의존) + 중첩 프로젝트 경계(stopAtNestedProject)·ProjectLibrary 해석(resolveProjectLibraryDirs)·관련 프로젝트 수집(collectRelatedGprPaths)(§1-BX)
src/project/projectFileScope.ts          # 참조 검색·심볼 인덱싱 공용 파일 범위(resolveProjectFileScope, PROJECT_EXCLUDE_GLOB)(§1-BW) — 라이브러리 양방향 확장(§1-BX)
src/providers/referenceProvider.ts       # scanDocumentText 라인별 스캔(ReDoS 완화) + 프로젝트 범위 폴백(§1-BW — findTextInFiles는 제안 API로 미사용)
.github/instructions/gpl-ai-controller-debugging.instructions.md  # 하드 규칙
```

## 5. 참고 — 정상 컴파일 응답 형식 (GDE, verbatim, 2026-06-30)

다음처럼
