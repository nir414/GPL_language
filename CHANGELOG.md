# Changelog

이 프로젝트의 주요 변경 사항은 이 파일에 기록한다.

## [0.8.22] - 2026-08-31

### Added

- **`Try`·`Select`·`For`·`While`·`Do`·`If` 같은 제어 구조와 `Sub`/`Function`/`Property`/`Module`/
  `Class`/`Dim`/`Const`/`ReDim`/`Delegate` 선언을 자동완성 스니펫으로 넣을 수 있습니다.** 줄 시작에서
  키워드를 몇 글자 치면 블록 골격이 통째로 제안되고, `Tab`으로 조건식·변수·타입 자리를 옮겨 다닐 수
  있습니다(`For` 스니펫은 `Next`의 제어 변수까지 함께 바뀝니다). 키워드·원시 타입(`Integer`, `Single` …)·
  낱말 연산자(`Mod`, `AndAlso`, `Is` …)도 설명과 함께 완성 목록에 나옵니다.
  - 구문은 공식 GPL Dictionary(Statement Dictionary)를 그대로 따릅니다. VB.NET과 다른 GPL 고유
    표기를 반영했습니다 — 반복 종결은 `Wend`가 아니라 **`End While`**, 다중 분기는
    **`Select match_value`**, Property의 Set 절은 **`Set (value As Integer)`처럼 괄호 절이 필수**입니다.
    각 항목 설명에서 해당 공식 문서 페이지를 바로 열 수 있습니다.
  - **그 자리에서 문법적으로 유효한 문만 제안합니다.** 파일 최상위에서는 `Module`/`Class`만,
    Module/Class 본문에서는 선언문만, 프로시저 안에서는 제어 구조를 제안합니다. `Else`는 `If` 안에서,
    `Case`는 `Select` 안에서, `Exit For`는 `For` 루프 안에서만 나옵니다. 식 중간(`x = ` 뒤나 인자 목록
    안)에서는 블록 스니펫이 끼어들지 않습니다.

- **프로젝트 폴더 안에 다른 프로젝트가 들어 있는 구조(중첩 프로젝트 / `ProjectLibrary`)를 지원합니다.**
  GDS로 만든 실제 프로젝트에서 `Project.gpr`에 `ProjectLibrary="MyProject\MyLibrary"`가 있고, 그 라이브러리가
  **메인 프로젝트 폴더 안에 자기 `Project.gpr`를 가진 폴더**로 들어 있는 것을 확인했습니다. 이제 확장은
  "이 프로젝트가 소유한 파일"과 "이 프로젝트와 함께 컴파일되는 파일"을 구분해서 판단합니다.
  - 정의 이동·자동완성·**참조 찾기(Shift+F12)·이름 바꾸기(F2)** 가 메인 프로젝트와 라이브러리 **양방향**으로
    동작합니다. 특히 라이브러리 안의 `Public` 루틴에서 참조를 찾으면 그것을 사용하는 메인 프로젝트의
    호출부가 함께 나옵니다(종전에는 라이브러리 폴더 안만 훑어 호출부를 놓쳤습니다).
  - 디버깅 중 라이브러리 소스의 브레이크포인트·스택 소스 열기가 라이브러리 폴더까지 인식합니다.
  - 프로젝트 선택 목록에서 라이브러리 프로젝트를 `라이브러리 · <참조하는 프로젝트>`로 구분해 보여 줍니다
    (라이브러리만 실수로 배포·실행하는 것을 줄이기 위함이며, 목록에서 빼지는 않습니다).
  - Deploy 로그에 참조 라이브러리가 이 배포에 **포함되는지(폴더 안) 아닌지(폴더 밖)** 를 표시합니다.
    폴더 밖 라이브러리는 따로 Deploy 해야 합니다(업로드 대상 자체는 종전과 같습니다).

- **제어기 FTP 폴더를 한 번에 비우는 버튼을 추가했습니다.** 사이드바 GPL Controller 패널의
  `FTP 파일 (/GPL)` 섹션 헤더에 휴지통 버튼이 생겼습니다(우클릭 메뉴에는 `Flash Projects`도 있습니다).
  항목을 하나씩 지우는 대신 폴더 안을 통째로 비우며, 폴더 자체는 남깁니다. 실행 전에
  ① 배포가 진행 중이면 차단 ② 지울 목록 조회 ③ 쓰레드가 하나라도 있으면 `Stop -all` 승인과 정지 확인
  ④ 지울 항목을 보여 주는 확인 창을 차례로 거칩니다. 삭제 후에는 업로드 지문을 버려 다음 배포가
  파일을 건너뛰지 않게 합니다. `Flash Projects`는 되돌릴 수 없어서 인라인 버튼 대신 우클릭 메뉴에만
  두었습니다.

### Changed

- **GPL Console 출력 줄 앞의 `[RT] [<프로젝트>]` 접두사를 시각 표시로 바꿨습니다.**
  이제 `[14:23:07] MyProject start` 형태로 나옵니다. 채널 자체가 런타임 전용이고 한 번에 한 프로젝트만
  실행되므로 두 접두사는 매 줄 반복되는 상수였습니다. 종전 형태나 프로젝트명이 필요하면
  `gpl.runtimeConsole.linePrefix`를 `legacy` / `time+project`(또는 접두사 없이 `none`)로 바꾸면 됩니다.

### Fixed

- **`While … End While` 블록이 접히지 않던 문제를 고쳤습니다.** 접기 판정이 `Wend`만 종결어로 보고
  있어서, GPL 정본 표기인 `End While`로 닫은 반복문에 접기 화살표가 생기지 않았습니다.

- **정의 이동(F12)이 이름만 같은 무관한 프로시저로 점프하던 문제를 고쳤습니다.**
  `Move.Loc`, `Console.WriteLine`처럼 GPL 내장 객체의 멤버나, 클래스·모듈 안에서 찾지 못한 멤버에
  정의 이동을 하면 확장이 앞의 한정자(`Move.`, `MyClass.`)를 버린 채 **워크스페이스 전체를 이름만으로**
  뒤졌습니다. 그래서 다른 파일에 우연히 같은 이름의 `Public Sub`가 하나 있으면 그리로 이동했습니다.
  이제 수신자의 타입이 확정된 멤버 접근은 그 한정자에 속한 정의만 찾고, 없으면 "정의 없음"으로
  둡니다(엉뚱한 곳으로 이동하지 않습니다). 대신 종전에 우연히 동작하던 `모듈.클래스`,
  중첩 클래스 `바깥.안쪽`, 모듈 수준 Property 이동은 그대로 유지됩니다. 인덱스에 아직 없는
  클래스(파일을 방금 복사해 온 경우 등)는 예전처럼 이름으로 찾습니다.

- **`Project.gpr` 소스 목록 동기화가 라이브러리 소스를 상위 프로젝트에 추가하려던 문제를 고쳤습니다.**
  프로젝트 폴더를 재귀 스캔할 때 하위 폴더의 별도 `Project.gpr`를 경계로 보지 않아, 라이브러리 파일이
  상위 프로젝트의 `ProjectSource` **추가 후보**로 떴습니다(`gpl.project.autoSyncSources`가 `auto`면 확인 없이
  반영). 라이브러리 파일은 이미 함께 컴파일되므로 이중 등록이 됩니다. 이제 자기 `.gpr`를 가진 하위 폴더는
  다른 프로젝트로 보고 목록에 넣지 않으며, 무엇을 제외했는지 출력 채널에 남깁니다.

- **프로젝트가 하위 폴더로 나뉜 구조에서 참조 찾기·심볼 인식이 동작하도록 고쳤습니다.**
  `Project.gpr`의 `ProjectSource`는 폴더 기준 상대 경로여서 `ProjectSource="T1\T1.gpl"`,
  `ProjectSource="T1\T2\T2.gpl"`처럼 임의 깊이로 중첩할 수 있는데(실제 프로젝트 확인), 확장 안에서
  "프로젝트에 속한 소스"를 기능마다 다르게 판단하고 있었습니다. 특히 **참조 찾기(Shift+F12)의 폴백이
  "정의 파일과 같은 폴더의 형제 파일"만 훑어** 하위 폴더에 있는 소스의 참조를 통째로 놓쳤습니다
  (워크스페이스 텍스트 검색에 쓰는 `workspace.findTextInFiles`는 제안 API라 정식 VS Code에서는 실행되지
  않고 이 폴백이 실제 경로였습니다). 이제 판단 기준을 한 곳(`src/project/projectSources.ts`)으로 모아
  **소유 프로젝트(.gpr)의 소스 목록 ∪ 프로젝트 폴더 재귀 스캔**을 쓰며, 워크스페이스 밖에서 열린 파일도
  위로 올라가며 `.gpr`를 찾아 같은 범위를 만듭니다. 상한(파일 1000개)에 걸리면 조용히 자르지 않고
  출력 채널에 알립니다.
- **Project.gpr 소스 목록 동기화가 하위 폴더 항목을 지우자고 제안하던 문제를 고쳤습니다.** 폴더 쪽 목록을
  비재귀로 만들어 `T1\T2\T2.gpl` 같은 항목을 "목록에 있지만 파일이 없음"으로 판정했고,
  `gpl.project.autoSyncSources`가 `auto`면 확인 없이 제거되어 해당 파일이 컴파일 대상에서 빠질 수 있었습니다.
  이제 목록을 재귀로 만들고(기록 구분자는 GDE와 같은 `\`), 제거 제안은 **디스크에 실제로 없을 때만** 합니다 —
  탐색 제외 규칙이나 상한 때문에 목록에서 빠진 파일을 지우자고 제안하지 않습니다. 하위 폴더에 새 `.gpl`을
  만들거나 지웠을 때의 자동 반영도 이제 반응합니다(종전에는 프로젝트 폴더 직속 파일만).
- **정의 후보가 여러 파일에 있을 때 "같은 프로젝트"를 워크스페이스 최상위 폴더보다 우선합니다.**
  프로젝트가 하위 폴더로 나뉘어 있으면 디렉터리가 달라도 같은 컴파일 단위이고, 반대로 최상위 폴더가 같다는
  것만으로는 다른 프로젝트의 동명 파일과 구분되지 않았습니다.
- **디버깅 중 동명 소스 경합에서 `.gpr` 소스 목록을 1순위 기준으로 씁니다.** 제어기는 파일명(basename)만
  주므로, 같은 이름의 파일이 여러 폴더에 있으면 종전의 "얕은 경로 우선"이 목록에 없는 엉뚱한 파일을 고를 수
  있었습니다. 하위 폴더 소스의 중단점은 파일명 표기가 거부될 경우 프로젝트 기준 상대 경로
  (`"T1\T2\T2.gpl"`)로 한 번 더 시도하고, 성공한 표기를 세션에 기억합니다(평면 프로젝트에서 보내는 명령은
  종전과 동일합니다).
- **심볼 인덱싱이 `.history`·`dist`·`out` 사본을 제외합니다.** Local History 확장이 남긴 stale 사본이
  인덱스에 섞여 정의/참조가 엉뚱한 파일을 가리키는 것을 막습니다(프로젝트 탐색과 같은 제외 목록).
  또한 프로젝트 파일 이름이 `Project.gpr`가 아니어도(임의 `*.gpr`) 프로젝트 단위 인덱싱을 적용하고,
  `.gpr`에 아직 추가하지 않은 파일도 프로젝트 폴더 안에 있으면 인식합니다.

## [0.8.20] - 2026-08-28

### Added

- **디버깅 조작을 공식 문서 기준으로 확장했습니다 — 커서까지 이동·Step Into Target·프로시저 이름 중단점·조건부 중단점.**
  ① **커서까지 이동(Jump to Cursor)**: 정지 중 다음 실행 문장을 옮깁니다(`Set Thread <스레드> -line <줄>`).
  건너뛴 문장은 실행되지 않아 초기화·안전 조건이 빠질 수 있으므로 기본값은 실행 직전 경고 확인이며
  (`gpl.debug.jumpToCursor`: `warn`/`on`/`off`), 대상 줄이 문서 제약(같은 프로시저 안의 실행 문장)을 만족하는지
  파서로 먼저 확인합니다. ② **Step Into Target**: 한 줄에 호출이 여러 개일 때 들어갈 호출을 고릅니다 — 제어기
  `Step`에는 대상 지정 스위치가 없어 정의 위치에 임시 중단점을 걸고 Continue한 뒤 정리하며, 실패하면 기본 Step으로
  되돌립니다. ③ **프로시저 이름 중단점**: `Class.Proc`을 입력하면 정의 위치의 첫 실행 줄에 설정합니다.
  ④ **중단점 줄 보정**: 빈 줄·주석에 찍은 중단점을 제어기가 다음 실행 문장으로 옮기는 문서 규칙을 미리 계산해
  같은 줄에 설정하고 이유를 알려 주며, 문서상 동시 상한(32개)을 넘으면 경고합니다. ⑤ **조건부 중단점·히트 조건·
  로그포인트**(기본 꺼짐, `gpl.debug.clientSideBreakpointLogic`): 제어기에 조건 개념이 없어 확장이 적중 시 값을
  평가하고 불일치하면 자동 Continue합니다 — 자동 재개는 모션을 다시 움직이므로 기본값을 꺼짐으로 두었고, 평가
  실패 시에는 지나치지 않고 정지를 유지합니다. ⑥ 값 복사는 표시용 접미 없이 원문을, 큰 호출 스택은 지연 로딩을
  지원하며, `gpl.debug.integerHex`로 정수에 16진수를 병기합니다(비트마스크 DataID 읽기용).
- **`Start`가 공식 문서 구문으로 조립되고 기본값이 GDE와 같아졌습니다.** 이제 `Start <프로젝트> -event`를 보냅니다 —
  문서상 `-event`는 쓰레드 상태 변경을 콘솔 메시지가 아니라 **이벤트로** 보내며 GDE도 항상 이 형태를 씁니다
  (`gpl.controller.startEventMode`로 끄면 `-noevent`). launch 구성에 `startStackSizeKb`(`-stack`)·
  `startShowInitStatements`(`-init`)·`startTrace`(`-trace`, 성능 저하 경고)를 추가했고, `-compile`은 어떤 경우에도
  붙이지 않습니다(제어기 Start가 자체 컴파일).
- **MCP `read_dataids`가 `Pdx`(16진수)와 unit·sub unit·배열 인덱스·서보 노드 인자를 지원합니다.** 문서 구문
  `Pd dataid, unit, unit2, array_index, node`에 맞춰 뒤 인자를 쓸 때 앞 인자를 기본값으로 자동 보완합니다.
  비트마스크 DataID는 `{hex:true}`로 읽으면 그대로 읽힙니다.
- **스레드 단일 실행 잠금 — 다중 스레드에서 의도하지 않은 스레드를 움직이는 사고를 막습니다.** GPL 제어기의 실행 명령은 스레드 단위(`Continue <이름>` / `Step <이름> -over`)인데 대상은 VS Code의 포커스 스레드가 결정합니다. 그래서 내가 보고 있지 않은 스레드가 브레이크포인트에 걸려 포커스를 가져간 상태에서 F5/F10을 누르면 다른 스레드가 재개됩니다(모션 영향 가능). CALL STACK에서 스레드를 우클릭 → **`GPL: 스레드 실행 잠금`**(또는 명령 팔레트 `GPL: 스레드 실행 잠금 토글`)을 걸면 Continue/Step(F5·F10·F11·Shift+F11)이 포커스와 무관하게 잠근 스레드에만 나가고, 다른 스레드가 정지해도 디버그 포커스를 훔쳐 가지 않습니다(StoppedEvent `preserveFocusHint`). 잠금 중에는 상태바에 `$(lock) 스레드 잠금: <이름>`이 뜨고 클릭하면 해제되며, 잠근 스레드가 종료되면 자동으로 풀립니다. **추가로 재개되는 스레드는 없습니다** — 잠금은 대상을 좁히기만 하므로 새로 움직이는 축이 생기지 않습니다. DAP `supportsSingleThreadExecutionRequests`도 선언하지만, VS Code 1.135 본체에는 이 capability와 `singleThread` 인자가 존재하지 않아(2026-08-28 번들 확인) 실제 UI는 위의 확장 명령·메뉴·상태바가 제공합니다.
- **GPL Dictionary의 Thread 클래스 정보를 편집기에서 바로 봅니다.** 공식 문서 `GPL_Dictionary/Thread/`의 페이지를 전수 반영해 멤버 16개를 정리하고, 요약만 있던 자리에 **문서의 구문 표기와 값 표**를 함께 띄웁니다 — `Thread.ThreadState`의 상태값(-1 없음 / 0 유휴 / 1 정지 중 / 2 실행 중 / 3 일시 중지 / 4 오류로 중지), `Thread.WaitEvent`·`Thread.SendEvent`의 이벤트 비트(`&H0001`~`&HFFFF`)와 event_mask/time_out 조합별 동작, `Thread.Join`의 반환값(-1/0), `Thread.Schedule`의 매개변수 범위(priority 0~16, period는 0.125 ms의 2의 거듭제곱 배수), `Thread.Sleep`의 0·음수 의미와 0.125 ms 양자화. Shared 메서드(`Thread.Sleep`)와 인스턴스 멤버(`thread_object.Abort()`)의 호출 형태도 문서 표기 그대로 보여 줍니다.
- **`Thread` 클래스 이름 위에 마우스를 올리면 클래스 개요가 뜹니다.** 최대 64개 스레드·1 ms 단위 전환 같은 실행 모델과 함께 생성자 `New Thread(procedure_name, project_name, thread_name, stack_size)`의 매개변수 설명(어떤 것이 선택인지, 생략 시 기본값, 프로시저가 클래스 안에 있으면 Public Shared여야 한다는 조건)과 멤버 목록을 보여 줍니다. 생성자는 이름만 기록하고 실제 스레드 생성·검증은 `Start`에서 이뤄진다는 점도 함께 표시됩니다.
- **`Dim t As Thread`처럼 선언한 변수의 멤버에도 호버가 동작합니다.** 종전에는 `Thread.Abort`처럼 클래스 이름을 그대로 쓴 경우에만 설명이 떴고, 실제 코드에서 흔한 `t.Abort()` 형태는 아무것도 뜨지 않았습니다(자동 완성은 이미 동작했으므로 호버만 비어 있었습니다). 이제 변수의 선언 타입이 내장 클래스면 그 클래스의 문서를 보여 주며, 같은 이름의 사용자 심볼이 있으면 그쪽이 우선합니다.
- 새 설정 `gpl.hover.builtinDetails`(기본 켜짐) — 내장 항목 호버에 위의 값 표·매개변수 범위를 함께 볼지 결정합니다. 끄면 종전처럼 한 줄 요약만 나옵니다. 디버깅 중에는 기존 `gpl.hover.duringDebug` 규칙(기본 compact)을 그대로 따릅니다.
- **MCP 서버가 GPL 확장을 직접 사용합니다 (Agent Bridge).** 종전에는 MCP가 제어기 1402에 직접 접속해 확장의 keep-alive 세션과 경쟁했고, 그 결과 AI가 *"제어기는 정상인데 1402 채널을 VS Code가 이미 점유하고 있습니다"*라고만 보고하며 확장을 통한 테스트로 넘어가지 못했습니다. 이제 VS Code에서 확장이 실행 중이면 MCP의 1402 명령이 **확장 세션으로 라우팅**되어 같은 직렬 큐·keep-alive 연결·명령 정책을 그대로 타므로 세션 경쟁 자체가 없어지고, 트래픽이 GPL Traffic/Output에도 함께 남습니다. 새 MCP 도구 두 개: `extension_status`(확장 실행 여부·버전·연결 상태와 **지금 명령이 어느 경로로 나가는지**를 확인 — 점유 여부를 추측하지 않게 함, `wake:true`로 확장 깨우기)와 `extension_command`(확장 명령 `gpl.*` 실행 — `gpl.deploy`, `gpl.quickCompile`, `gpl.start`, 브레이크포인트 동기화, `gpl.ai.debug.*`, 진단 스냅샷 등을 MCP에서 그대로 사용). 전송은 `%TEMP%\gpl-controller\`의 요청/응답 파일 한 쌍(배포 잠금과 같은 계약 — 새 포트·서버 없음)이고, 확장 쪽 스위치는 `gpl.agentBridge.enabled`, MCP 쪽은 `GPL_BRIDGE=auto|only|off`입니다. 확장이 없으면 종전처럼 직접 접속으로 폴백하되, 결과가 모호한 실패(타임아웃 등)에서는 조회 명령만 재전송해 상태 변경 명령의 중복 전송을 막습니다. `GPL: Send Command to Controller`도 인자를 주면 입력 상자 없이 실행하고 결과를 반환합니다(이 라우팅의 진입점).
- **외부 진입점 URI를 이 확장의 모든 명령으로 열었습니다.** `vscode://nir414.gpl-language-support/<gpl.command.id>?args=<JSON>`(또는 `?key=value` 평면 인자, `/command?id=…`)로 `gpl.*` 명령 전부를 `code --open-url`에서 실행할 수 있습니다(종전 `/connect`·`/disconnect`·`/getState`·`/dashboard` 별칭은 그대로). 결과는 Output `[URI] <id> => …`에 기록됩니다. 쓰레드 대상 명령(`gpl.controller.thread*`)은 트리 노드 외에 `{ threadName }`·문자열 인자도 받습니다. MCP·AI 명령·URI가 만든 목적(학습되지 않은 GPL 확장을 AI가 그대로 써서 테스트·자료 검토·로그 확인을 돕는 것)에 맞게 접근은 제한하지 않습니다.
- **제어기 명령 정책 — 안전 조건을 지침이 아니라 확장이 스스로 충족시킵니다.** 모든 1402 명령이 지나는 직렬 큐 한 곳(`sendCommandDetailed`)에서, 어느 경로(명령 팔레트·트리·`gpl.ai.debug.*`·URI·디버그 어댑터)로 보내든 ① 같은 쓰레드의 Step/Continue는 직전 명령의 정지가 `Show Thread -web`으로 확인된 뒤 최소 간격(`gpl.debug.minStepIntervalMs`)을 두고 보내고(#28 — 종전엔 디버그 어댑터 경로만 보호), ② Start/Compile/Load/Unload 전에 정지 진행 중(`Stopping`) 쓰레드가 정착할 때까지 기다리며(§0.6 — Stop 접수 직후 Compile/Start가 제어기 이상을 유발한 이력), ③ Compile 완료 직후 같은 프로젝트 Start는 `gpl.controller.startAfterCompileGapMs`(기본 1.5초) 완충 뒤 보냅니다(§0.7). 승인 모달이나 거부 목록은 두지 않고 기다려서 충족시키며, `gpl.controller.transitionSettleWaitMs`(기본 8초) 안에 충족되지 않을 때만 명령을 보내지 않고 오류(`gpl.ai.debug.*`는 `{ ok: false, error: "policy-hold", code }`)로 알립니다. 개입 내용은 GPL Traffic `--- policy:` 줄에 남고, `gpl.controller.commandPolicyEnabled`로 끌 수 있습니다(진단용). 실행 중(Running) 쓰레드는 막지 않습니다 — 다중 프로젝트 동시 실행은 정상이고 대상 프로젝트가 실행 중이면 제어기가 STATUS로 답합니다.
- **1402 유휴 ping — GDE 방식으로 제어기 세션을 놓지 않습니다.** 제어기에 연결된 동안 1402 명령이 `gpl.controller.keepAliveIdlePingMs`(기본 5초, 0이면 끔) 동안 없으면 읽기 전용 명령(`gpl.controller.keepAliveIdlePingCommand`, 기본 `Show Thread` — 빈 응답)을 같은 직렬 큐로 1개 보냅니다. GDE는 1402 세션을 끝까지 유지하며 유휴 5초마다 파라미터 읽기를 보내고, 제어기는 그 세션을 쥔 클라이언트에게 1403 런타임 스트림을 계속 열어 두는 것으로 관측됩니다(GDE 캡처: 1403이 36.7초 연속 수신 / 확장 keep-alive 도입 뒤 08-27 로그: 1403 세션 44.4분 유지 / 종전 단명 1402 시절: 1403이 배치마다 끊김). 반대로 1403에 무언가를 보내는 것은 효과가 없습니다(GDE의 5초 NUL도 FIN을 막지 못함). ping 결과는 연결 건강 모니터에도 프로브로 보고되어, 트리/대시보드 폴이 없는 유휴 상태에서도 끊김이 5초 주기로 드러납니다. GPL Traffic에 `--- 1402 idle ping ON/stopped`가 남고 실패는 첫 회·10회마다 기록됩니다.
- **프로젝트명에 공백이 있으면 제어기 명령을 보내지 않고 이유와 고치는 방법을 알립니다.** Brooks 제어기의 콘솔 명령(`Compile <name>`·`Load <path>`·`Start <name>`·`Unload <name>`)은 인자를 공백으로 구분하고 인용 문법이 없어, `My project`처럼 공백(탭·NBSP·전각 공백·제어 문자 포함)이 든 프로젝트명이나 경로는 명령이 끊겨 실패하거나 이름이 비슷한 다른 프로젝트를 대상으로 삼을 수 있습니다. 이제 Deploy/Quick Compile(FTP 업로드 전), `GPL: Start`, 트리의 컴파일 & 실행·Unload, F5 디버그 attach, MCP `compile_project`/`start_project`/`unload_project`가 모두 같은 규칙으로 보내기 전에 막고, `Project.gpr`의 ProjectName(또는 폴더명)을 `My_project`처럼 바꾸라는 안내를 띄웁니다. 워크스페이스에서 그런 프로젝트가 감지되면 명령을 실행하기 전에도 세션당 한 번 경고합니다. 이름을 자동으로 바꾸지는 않습니다.
- **문서화 주석(Documentation Comment) — 설명·Parameters·Returns·Examples를 호버에서 그대로 봅니다.** 선언 바로 위 `'` 주석 블록에 `# Parameters` / `# Returns` / `# Examples` 머리글을 쓰면, 호버·자동완성·시그니처 도움말이 이를 구조로 인식해 표시합니다 — 매개변수는 ``- `이름`: 설명`` 항목이 목록으로, 예제는 코드 블록(GPL 구문 강조)으로 나오고, 시그니처 도움말에서는 지금 입력 중인 매개변수의 설명만 따로 뜹니다. 머리글은 `# 매개변수`·`# 반환`·`# 예제` 같은 한국어 별칭도 인식하고, 표에 없는 머리글(`# Errors` 등)도 순서를 지켜 그대로 보여 줍니다. 기존의 평범한 주석은 종전과 똑같이 표시됩니다. `gpl.hover.docCommentMaxLines`는 이제 **설명 부분**에만 적용되어(섹션은 잘리지 않음) 매개변수 목록이 중간에서 끊기지 않습니다.
- **문서화 주석 골격 자동 생성.** 선언 바로 위에서 `'''`를 입력하면(JSDoc의 `/**`와 같은 흐름) 시그니처를 읽어 설명·`# Parameters`(매개변수마다 한 줄)·`# Returns`(반환 타입이 있을 때) 골격을 만들고 Tab으로 칸을 이동하며 채울 수 있습니다. 선언 줄의 전구 메뉴나 명령 팔레트 `GPL: 문서화 주석 생성`으로도 같은 일을 하며, **이미 주석이 있으면 빠진 항목만 덧붙입니다**(기존 설명은 건드리지 않음 — 매개변수를 추가한 뒤 문서를 맞출 때 유용). 새 설정 `gpl.docComment.generateOnTripleQuote`(기본 켜짐), `gpl.docComment.includeExamples`(기본 꺼짐 — 켜면 `# Examples` 골격과 호출 예시도 함께 생성).
- **MCP 서버가 연결 시점에 GPL 코딩 규약을 알립니다.** `gpl-controller-mcp`가 `initialize` 응답의 `instructions`로 제어기 안전 규칙(원시 소켓 금지·`</STATUS>` 판정·모션 명령 확인·Compile→Start 연속 금지)과 **문서화 주석 형식**을 함께 전달합니다 — AI 에이전트가 GPL 소스를 쓰거나 고칠 때 도구를 부르기 전에 규약을 알게 됩니다. `instructions`를 쓰지 않는 클라이언트를 위해 같은 내용을 리소스 `gpl://guidelines/doc-comment`로도 노출합니다. 확장 명령 `gpl.insertDocComment`는 이제 `extension_command`에서도 쓸 수 있게 문자열 URI를 받고, 결과로 `{ ok, action: inserted|merged|up-to-date, added?, file, line, symbol }`을 돌려줍니다.

### Fixed

- **업로드 스킵 판정이 파일 크기가 아니라 내용을 봅니다.** 종전에는 미러 동기화(F5·빠른 컴파일의 `/GPL`, flash 저장)와 `skipUnchanged` 업로드가 **원격 파일 크기와 로컬 크기가 같으면 변경 없음**으로 보고 건너뛰었습니다. 그래서 상수 `10`을 `20`으로 바꾸거나 오타 한 글자를 고치는 것처럼 **길이가 그대로인 편집**은 전송되지 않고 제어기가 낡은 소스를 그대로 컴파일했습니다 — 오류도 경고도 없이 조용히 틀리는 문제였습니다. 이제 확장이 **올린 내용의 SHA-1 지문**을 제어기 경로별로 기억해 두고, ① 원격에 파일이 있고 ② 크기가 같고 ③ 지금 로컬 내용이 마지막으로 올린 내용과 같고 ④ (제어기 목록이 시각을 주면) 원격 파일이 그 뒤로 바뀌지 않았을 때만 건너뜁니다. 판정할 근거가 없으면 건너뛰지 않고 올립니다 — 첫 동기화나 확장 업데이트 직후에는 한 번 전량 업로드가 일어나고, 그때는 로그에 `(첫 동기화 — 지문 기록 없음, 전체 업로드)`라고 남습니다. 제어기와의 통신 횟수는 늘지 않습니다(기존 목록 조회·`SIZE` 응답을 그대로 씁니다).
- **"동작 중" 판정을 쓰레드 존재 기준으로 통일했습니다.** `Execute <문장>, <프로젝트>`는 문서상 `_Cmd_<프로젝트>`
  라는 별도 쓰레드에서 실행되므로 이름만 비교하면 그 프로젝트가 도는 것을 놓쳤고, `Idle`/`Stopped`로 보이는
  쓰레드도 목록에 남아 있으면 아직 끝난 것이 아닙니다(Stop의 STATUS 0은 요청 접수). 이제 **쓰레드가 목록에
  존재하면 동작 중**으로 보고, 프로젝트 단위 판정은 project 컬럼·기본 이름·`_Cmd_` 접두를 모두 인정합니다
  (`src/controller/threadActivity.ts`). 빠른 컴파일의 STOP 생략 경로도 정지 계열 쓰레드가 남아 있으면
  그대로 진행하지 않고 사용자 확인을 받습니다.
- **`Set Nobreak`가 실패하면 공식 문서 표기로 자동 재시도합니다.** 실측(GDE 캡처)으로 확인된 무공백 형식
  `Set Break P "F.gpl"30`은 `Set Break`에서만 관측됐고 `Set Nobreak`는 근거가 없었습니다. 무공백 형식이 STATUS
  실패를 내면 문서 표기(`Set Nobreak P "F.gpl" 30`)로 한 번 더 보내고, 어느 쪽이 동작했는지 로그에 남깁니다.
- **런타임 콘솔(1403)의 한글 출력이 깨지던 원인을 고쳤습니다.** 수신 바이트를 `ascii`로 디코딩해 상위 비트를 버리고 있었는데, 제어기는 콘솔 텍스트를 UTF-8로 보냅니다(2026-06-23 GDE 캡처의 한글 줄로 확인). 이제 바이트를 보존한 채 128바이트 청크를 이어 붙인 뒤 UTF-8로 디코딩하므로 청크 경계가 글자 중간에 걸려도 온전합니다. 프레임의 `<L>N</L>`(청크 바이트 길이)과 실제 길이가 어긋나면 GPL Console 상태 로그에 `WARN=L_MISMATCH`를 세션당 1회 남깁니다.

## [0.8.19] - 2026-08-26

### Fixed

- **`launch.json`에 주석(JSONC)이 있으면 `GPL: Create/Update Debug launch.json`이 "launch.json 파싱 실패"로 중단되던 문제(#30)를 고쳤습니다.** VS Code와 같은 `jsonc-parser`로 읽어 주석·trailing comma·줄 끝 주석을 모두 받아들이고, 갱신할 때 파일 전체를 다시 쓰지 않고 같은 이름의 GPL 구성 항목만 부분 편집해 **사용자의 주석·`${config:…}` 참조·다른 구성·들여쓰기를 보존**합니다. 파싱 오류 메시지에는 줄/열이 표시됩니다. launch.json에서 제어기 IP·프로젝트명을 읽는 경로(`readLaunchControllerInfo`)도 같은 파서를 씁니다(종전 정규식 주석 제거는 줄 끝 주석·문자열 안 `/*`에 취약했음).
- **디버거 Step/Continue 연타로 제어기가 다운되던 경로를 막았습니다(#28).** F11/F12 키를 누른 채 유지하면 이전 Step의 정지 확인 없이 `Step` 명령이 30ms 간격으로 수백 건 송신되어(2026-08-25 16:23 실측 325건/22.5초) 제어기가 응답을 멈췄습니다. 이제 같은 쓰레드의 이전 Step/Continue 정지가 확인되기 전에 들어온 Step/Continue 요청은 명령을 보내지 않고 무시하며(Debug Console에 1회 + 50건마다 요약 로그), 정지 확인 뒤에도 `gpl.debug.minStepIntervalMs`(기본 100ms) 하한을 둡니다. Pause(F6)는 게이트하지 않습니다.
- **제어기 연결이 잠깐 끊겼다 붙을 때마다 FTP 파일 목록(/GPL·Flash)과 시스템 정보를 전부 다시 조회해 FTP 접속이 폭주하던 문제(#22)를 고쳤습니다.** 마지막 조회가 5분 이내면 캐시를 유지하고 섹션 설명에 `마지막 조회 HH:mm`을 표기합니다. 새로고침 아이콘·배포 후·명시적 Disconnect 후 재연결은 종전처럼 즉시 갱신됩니다. /GPL·Flash 목록은 FTP 세션 하나로 함께 조회합니다.
- **디버그 단축키를 VS Code 표준과 호환되게 정리했습니다(#20).** `F9 → Continue` 기본 바인딩(표준 Toggle Breakpoint와 충돌)과 `Ctrl+Alt+I → 디버그 호버`(Copilot Chat 기본키와 충돌)를 제거했습니다. F5/F6/F9/F10/F11/Shift+F11은 VS Code 표준이 그대로 동작하며, GDE 습관(F9 = Continue)이 필요하면 `gpl.keybindings.gdeStyle`을 켭니다.
- **호버 응답 개선(#19).** 마우스 이동마다 문서 전체 텍스트를 다시 만들어 파서 캐시 키와 비교하던 비용을 없애고 `(uri, version)` 단위로 심볼을 캐시합니다(파서 자체는 이미 내용 기준으로 메모이즈되어 재파싱은 없었습니다).
- **디버거 Variables/Watch에서 시스템 `Location`을 펼치면 값이 비어 보이던 문제(#27)를 수정했습니다.** 제어기의 Location 덤프는 멤버 줄이 `name, value` 2열(+주석 값 `0 = Cartesian`)로 오는데 3열을 전제한 파서가 값을 타입 칸에 넣었습니다. 이제 값이 제대로 보이고, Location 노드 자체에 한 줄 요약(`(636, 0, 0 | 0, 90, -180) cfg=1` / `Angles(0, 0, 0, 0, 0.196)`)이 표시되며, `ZClearance` 1E+32는 `(미설정)`으로 주석됩니다. `-762/-763`(Location 타입 불일치)과 `-712`(평가기 구문 불가) 오류에 안내 문구를 추가했습니다.
- **CI(태그 push)로 빌드한 VSIX에 제어기 대시보드 HTML(`media/dashboard.html`)이 빠져 "media/dashboard.html을 로드하지 못했습니다" 폴백만 뜨던 문제를 수정했습니다.** `.gitignore`가 `media/` 전체를 무시해 파일이 저장소에 없었습니다(로컬 `npm run package`에는 포함돼 이 PC에서만 정상으로 보였음). 이제 추적합니다.
- **Export AI Agent Setup의 globalStorage MCP 서버 사본이 확장 업데이트 후 갱신되지 않던 문제(#23)를 수정했습니다.** 확장 활성화 시 사본이 동봉 번들과 다르면(sha256) 자동으로 갱신하고 Claude Code `/mcp` 재연결 안내를 띄웁니다(`gpl.ai.autoRefreshMcpBundle`, 기본 켜짐 — Export를 실행한 적 없는 PC에는 영향 없음). MCP 번들에 빌드 스탬프(확장 버전·빌드 시각·git sha)가 박혀 서버 시작 stderr·`get_session_log`·`controller_status.server`로 어느 번들이 돌고 있는지 바로 알 수 있습니다.

### Added

- **Attach only 디버깅에서 소스·제어기 코드 불일치를 표시합니다(#21).** Deploy/Quick Compile/F5 배포로 Compile이 성공하면 그 시점의 로컬 소스 스냅샷(파일별 해시)을 워크스페이스에 기록해 두고, `deployBeforeAttach: false`로 붙거나 세션 중 GPL 파일을 저장하면 대조합니다. 마지막 Compile 이후 편집된 파일이 있으면 상태바에 `⚠ 소스 변경됨 N — BP 신뢰 불가` 배지(+알림 1회)가 뜨고, 그 파일의 브레이크포인트는 제어기에 설정되되 **회색(unverified)**으로 "재배포 필요" 메시지와 함께 표시됩니다(제어기는 시작 시점 컴파일 코드를 실행하므로 줄 번호가 어긋나 걸리지 않을 수 있음). 배지를 클릭하면 `Stop + Upload + Run 으로 재시작`(현재 세션을 끊고 `deployBeforeAttach`·`stopAllBeforeAttach` 구성으로 재시작) 또는 파일 열기를 선택할 수 있고, 재컴파일되면 자동으로 해소됩니다. 이 워크스페이스에서 배포한 기록이 없으면 판정하지 않습니다.
- **AI/외부에서 제어기 연결을 만들고 읽을 수 있습니다(#25).** `gpl.controller.connect`가 `{ ip?, port?, save?: 'session'|'settings', silent? }` 인자를 받으면 입력 상자 없이 연결을 시도하고 `{ ok, ip, port, connected, error? }`를 반환합니다(인자 없이 부르면 종전 대화형 그대로). AI 계층에 `gpl.ai.debug.connect` / `gpl.ai.debug.disconnect` / `gpl.ai.debug.getConnectionState`(연결·디버그 세션·1403 콘솔·배포 잠금·컴파일 필요 상태)를 추가했고, URI 진입점 `vscode://nir414.gpl-language-support/connect?ip=…&port=…`(`/disconnect`, `/getState`, `/dashboard`; `code --open-url`로 호출)을 열었습니다 — 모션을 일으키는 동작은 URI로 열지 않습니다. `gpl.ai.debug.loop`도 미연결 시 입력 상자 대신 비대화형으로 연결합니다.
- **MCP `controller_command` 배치 실행과 `read_dataids` 도구(#16).** `commands: string[]`(최대 50개, `stopOnError` 옵션)를 주면 서버가 1402 단일 채널에서 순차 실행한 뒤 항목별 `{ command, status, ok, data }` 배열을 한 번에 돌려줍니다(DataID 30개 조회가 MCP 왕복 30회 → 1회). 파라미터 DB 다건 읽기 전용 도구 `read_dataids(ids)`는 `pd <id>` 응답을 `{ id, description, meta, values }`로 구조화합니다. 배치 안의 Compile/Start/Load/Unload에도 배포 잠금 가드가 항목별로 적용됩니다.
- **제어기 자원 지표(#22 자원 고갈 가설 관찰용).** 대시보드에 "제어기 자원" 카드 — `Show Memory` / `Show Network -tcp` / `Show Network -mbuf`(읽기 전용 3명령)를 폴링마다 조회해 여유 메모리, TCP accepted 누적과 **accepted/s**(2/s 주의·10/s 경고), mbuf clusters free 감소, drops/waits/drains를 표시하고 5분 이상 스파크라인을 남깁니다(`gpl.controller.dashboardResourceProbes`). 확장 자신의 1402 연결 수(connects/재사용/재시도)도 함께 보여 제어기 카운터와 대조할 수 있습니다. MCP `controller_status(detail: true)`에도 같은 구조의 `resources`(+`acceptedPerSec`)가 추가됐습니다. 파서는 G2400C(GPL 4.2K5) 실기기 응답 원문(2026-08-25 채록) 기준입니다.
- **연결 유실 사후 스냅샷(#22).** "Connection lost (3 consecutive failures)" 시 `%TEMP%\gpl-controller\postmortem-<시각>.log`에 마지막 트래픽 400줄(1402 명령·응답 본문 + 1403 라인), 1402 연결 통계, 1403 상태, 배포 잠금, ping TTL·TCP·arp 기반 도달성 판정("ICMP 응답·1402 거부 → 서비스 다운/재시작 중" 등, 직결 NIC 임대 상실 시 사무실 게이트웨이가 대신 응답하는 함정도 MAC/TTL로 표시)을 자동 저장하고 알림에서 바로 열 수 있습니다. 제어기가 죽으면 1402가 닫혀 ErrorLog를 읽을 수 없고 재부팅하면 지워지므로 PC 쪽 증거를 남기는 것이 목적입니다.
- **1403 런타임 콘솔 재연결 워치독(#22).** 재연결 스케줄이 조용히 사라지거나(2026-08-25 17:45 사망 직전 3분 침묵) connecting이 고착되면 15초 주기 워치독이 감지해 강제 재연결하고, 재연결 스케줄·누적 접속 수(`CLOSE (… connects=N)`, 50회마다 요약)를 GPL Traffic에 항상 기록합니다.
- 클릭 뒤 마우스를 멈춰도 언어 호버가 다시 표시되는 옵션 `gpl.hover.showAfterClick`(기본 꺼짐, #19·#29). VS Code는 클릭으로 닫힌 호버를 마우스가 움직이기 전까지 다시 열지 않으므로, 클릭 직후 커서 위치에 호버를 띄웁니다(디버그 중에는 기존 변수 값 호버가 우선).
- **GPL Traffic 채널이 1402 응답 본문을 실시간으로 보여줍니다.** 이전에는 보내는 명령(`>>>`)은 전문이 찍혔지만 제어기 응답은 `<<< STATUS 0  12 lines  38ms` 요약만 남아 "서로 무엇을 주고받는지"의 절반이 보이지 않았습니다. 이제 응답 본문이 도착하는 대로 줄 단위(` | ` 라인)로 흘러나오고(Compile처럼 pass 사이에 침묵하는 명령도 도착한 부분까지 즉시 표시), 마지막에 기존 `<<<` 요약이 붙습니다. 긴 응답은 `gpl.controller.trafficLogMaxResponseChars`(기본 4000자, 0=무제한)까지만 표시하고 생략 요약 한 줄을 남기며, `gpl.controller.trafficLogResponseBody`를 끄면 예전처럼 요약만 남습니다. GPL Controller 트리의 연결 섹션에 **`1402 통신 모니터`** 항목이 추가되어 클릭으로 채널을 열고, 인라인/우클릭으로 본문 표시 켜기/끄기(`GPL: Toggle Traffic Response Body (1402)`)와 채널 지우기(`GPL: Clear Traffic Monitor`)를 할 수 있습니다. 확장이 1402로 보내는 모든 명령(디버그 어댑터·트리 폴링·배포 포함)이 한 소켓 경로를 지나므로 누락 없이 기록됩니다.
- **디버거가 클래스 Property 값을 보여줍니다(#26).** 제어기 콘솔은 식의 마지막 요소가 사용자 프로퍼티면 `-780`으로 거부하므로, 파서가 Property의 `Get … Return <식>`을 기록해 두고 디버그 어댑터가 백킹 필드(Get 반환식 또는 관례 `m_이름`)로 치환해 평가합니다. 다른 클래스 프레임에서 Private 점 표기가 `-729`면 부모 객체 덤프(프레임 무관, Private 포함)에서 멤버 줄을 추출합니다. hover·Watch 결과에 `← m_armCount (Get 반환식)`처럼 출처를 표시하고, 객체 노드를 펼치면 Property가 읽기 전용 가상 자식으로 나타나며, 해석 가능한 Property 위에서는 디버그 hover가 열립니다. `Me.` 접두는 자동으로 벗기고(제어기에서 `-712`), 반환형이 Location인 프로퍼티는 `.Pos`를 붙여 우회합니다.
- **`GPL: Check AI Agent Setup`** 명령(#23) — `.mcp.json` 등록 경로, globalStorage 사본/동봉 번들 해시 일치, CLAUDE.md 안내 블록 버전을 한 번에 점검하고 문제가 있으면 Export 재실행 버튼을 제공합니다. CLAUDE.md 자동 생성 블록에 확장 버전 표식이 들어갑니다.
- **제어기 대시보드 시각화 개선(#18)** — 상단에 연결·고전원·스레드·에러 상태를 색상 배지로 크게 표시(상태가 바뀌면 깜빡임), 스레드 표(상태·위치·프로시저·마지막 STATUS, 변화 행 강조), 축 위치 게이지(관측 범위 자동 조정, 이동 중 표시·Δ), 직교 좌표 XY 미니 플롯(최근 궤적), 새 에러 로그 줄 강조. 폴링 주기 선택과 일시정지 버튼을 탭 안에 넣었고(미구현이던 `setInterval` 메시지 구현), 연결 중에는 상태바에 `$(dashboard)` 바로가기 항목이 표시됩니다.

### Changed

- **1402 명령 연결을 명령마다 새로 열지 않고 유지·재사용합니다(keep-alive, #22).** 트리/상태바 폴링·BP 동기화·디버그 어댑터 백업 폴이 모두 명령마다 새 TCP 연결을 열어(5번째 다운 전 77분간 1,254회) 제어기 TCP accept 부하의 한 축이었습니다. 이제 직전 응답이 `</STATUS>`로 깨끗하게 끝난 경우에만 연결을 재사용하고(타임아웃·불완전 응답·오류 뒤에는 닫음), 재사용 소켓이 죽어 있으면 새 연결로 1회 재시도합니다. GPL Traffic에 `--- 1402 CONNECT #n` / `--- 1402 CLOSE (이유)`가 남고, 트리 `1402 명령 포트` 항목에 연결/재사용 횟수가 표시됩니다. `gpl.controller.keepAlive1402`(기본 켬)를 끄면 종전 동작, `keepAliveIdleCloseMs`(기본 30초)로 유휴 종료 시간을 조절합니다. ※ 제어기가 한 연결에서 연속 명령을 받아 주는지는 실기기 확인 항목입니다(받지 않으면 무해하지만 효과가 없음).
- **디버그 중 Running 백업 폴을 완화했습니다(#22).** 1403 런타임 스트림이 정상이면 정지 감지는 1403 이벤트가 먼저 알려주므로 `Show Thread` 백업 폴을 `gpl.controller.threadPollIntervalMs`(기본 5초)로 늦추고, 1403이 끊긴 동안만 `gpl.debug.runningBackupPollMs`(기본 1초)를 씁니다(종전 1Hz 고정 — 77분간 922회).
- 1403 이벤트 배치를 받은 뒤 재접속하는 간격을 100ms → 250ms로 늘렸습니다(`gpl.runtimeConsole.batchReconnectDelayMs`, #22 접속 churn 완화). 정지 감지는 1402 백업 폴이 보완합니다.
- MCP AI 가이드(`GPL: Export AI Agent Setup`의 CLAUDE.md 블록)에 배치 사용 규칙(`read_dataids`/`controller_command(commands)`), 자원 관찰(`controller_status(detail).resources`), "정지 확인 내장 도구 앞뒤에 show_thread를 끼우지 말 것", "같은 스레드 Step 반복 금지(#28)"를 추가했습니다.
- **MCP 관찰 도구(#24)**: `show_threads`/`debug_snapshot`/`controller_status`의 스레드 응답을 이름 있는 키(`name/state/project/procedure/file/line`)의 compact 형식으로 바꿔 3중 중복(fields+raw+rawLines)을 제거했습니다(`show_threads(verbose:true)`로 원문 유지). `controller_status`가 스레드 상태별 개수·정지 스레드 위치·고전원(`Controller.PowerEnabled`)·배포 잠금·서버 빌드를 돌려주고, 연결 실패 시 ICMP/TCP를 구분해 "재부팅 중 / 서비스 다운 / 완전 무응답"을 판정합니다(`detail:true`면 스레드 전체 목록·최근 ErrorLog 10줄). `eval_expression`과 각 도구의 `evals` 결과가 `{name,type,value,kind,members}`로 구조화되고, `-780`이면 `m_이름` 백킹 필드로 자동 재시도해 `resolvedAs`를 표시합니다(`Me.` 자동 제거). `debug_snapshot(listLocals:true)`로 프레임 변수 전체 덤프(Brooks 문서상 구문, 실기기 미검증)를 요청할 수 있습니다. 시뮬레이션/실기 판별은 근거 명령이 확인되지 않아 `simulation: null`로 둡니다.

## [0.8.18] - 2026-08-25

### Fixed

- **GPL Controller 트리의 쓰레드 "스텝" 인라인 버튼이 아이콘(Step Over)과 다르게 Step Into로 동작하던 문제를 수정했습니다.** 이제 디버그 어댑터의 F10과 같은 `Step <thread> -over -noerror`를 보냅니다. Step Into / Step Out은 정지 쓰레드의 우클릭 메뉴에서 실행합니다(Step Out은 Brooks 문서상 스위치로, 실기기 검증 전입니다).
- 트리의 일시정지·재개·에러 건너뛰고 재개·스텝 동작이 제어기 `<STATUS>`를 확인하지 않고 성공으로 간주하던 것을 고쳤습니다. STATUS가 0이 아니면 에러 메시지를 띄우고, 일시정지·스텝은 쓰레드가 실제로 정지 상태로 돌아올 때까지(최대 5초) 확인한 뒤 트리를 갱신합니다. 스텝 뒤 정지 위치는 편집기에 자동 표시됩니다(`gpl.controller.autoShowPausedLocation`).

### Added

- 정지·에러·실행 중 쓰레드의 우클릭 메뉴에 **현재 위치 보기**와 **스택 보기(Show Stack)** 를 추가했습니다 — 이전에는 정지·에러 쓰레드에서 스택 보기에 도달할 방법이 없었습니다.

## [0.8.17] - 2026-08-25

> 0.8.15·0.8.16은 같은 날의 로컬 중간 빌드입니다(0.8.16은 업로드→정지를 순차로 구현한 버전). 아래 내용은 0.8.17 기준입니다.

### Changed

- **배포 단계를 UPLOAD ∥ STOP → COMPILE로 재구성했습니다** (GitHub #17). FTP 업로드와 정지(`Stop -all` + 정지 완료 게이트)를 **동시에** 진행하고, 둘 다 완료가 확인된 뒤에 Compile합니다 — 소요 시간이 "업로드 + 정지"에서 "max(업로드, 정지)"로 줄고, "정지 미완료 상태의 Compile/Start 금지" 규칙은 그대로 유지됩니다. Compile과 Start는 한 번에 하나만 보냅니다(Deploy는 Compile까지, Start는 `GPL: Start`가 별도) — PA 제어기의 Start는 자체적으로 Compile을 수행하므로 Compile 직후 Start는 컴파일 중복입니다. 미러 동기화의 원격 전용 파일 삭제는 실행 중 안전성이 확인되지 않아 정지 확인 뒤로 미룹니다. 이에 따라 활성 쓰레드 때문에 Quick Compile/F5 배포를 중단하면 업로드는 이미 끝난 상태이며, 메시지가 "업로드 완료, Compile 미수행"으로 바뀝니다. ※ 실기기 검증 전 — 시뮬레이션/저속에서 먼저 확인하세요.
- **autoOnSave `"auto"` 모드가 쓰레드가 있어도 업로드는 수행합니다.** `/GPL/<프로젝트>`가 있으면 저장 파일을 올리고, Compile만 "쓰레드가 하나도 없는 완전 STOP 상태"에서 수행합니다(그 외에는 Compile 보류 → "컴파일 필요" 표시). 이전에는 쓰레드가 하나라도 있으면 업로드까지 전부 건너뛰었습니다.
- **"배포가 이미 진행 중입니다" 경고에 원인이 표시됩니다** (GitHub #15) — 누가(Deploy / Quick Compile / autoOnSave / Save to Flash / F5), 어느 단계(UPLOAD·STOP·COMPILE…), 몇 초 경과인지와 [출력 보기] 버튼. 배포 잠금은 프로젝트 선택·미저장 확인 대화상자가 끝난 뒤에 잡으므로, 대화상자를 열어 둔 채로는 더 이상 다른 배포를 막지 않습니다.

### Added

- **프로세스 간 배포 잠금** — 업로드/배포 중에는 `%TEMP%\gpl-controller\<제어기IP>.lock.json` 잠금 파일을 잡습니다(보유자·단계·시각·PID·heartbeat). 다른 VS Code 창의 Start/Deploy/Save to Flash와 gpl-controller MCP 서버의 `compile_project`/`start_project`/`unload_project`, `controller_command`의 Compile/Start/Load/Unload가 이 잠금을 읽어 대기(MCP는 최대 20초, `GPL_LOCK_WAIT_MS`) 또는 거부합니다 — 업로드 도중 Compile/Start가 겹쳐 제어기가 이상해지는 경로를 프로세스 경계 너머까지 차단합니다. 확장이 비정상 종료해도 PID/heartbeat(30초)로 자동 만료되어 창 리로드 없이 복구됩니다. F5 디버그 배포도 같은 잠금에 참여하며, 디버그 세션의 Start도 잠금이 풀릴 때까지(최대 20초) 기다립니다.
- **"컴파일 검증 필요" 상태 표시** — /GPL 소스는 올라갔지만 Compile로 검증되지 않은(보류·중단·실패) 프로젝트를 GPL Controller 트리 "프로젝트 상태"와 상태바에 경고로 표시합니다. PA 제어기의 `Start`는 자체적으로 Compile을 수행하므로(실사용 관찰 — Brooks 문서와 다름) 옛 프로그램이 도는 문제는 아니지만, 소스에 에러가 있으면 Start가 실패하고 Problems 연동도 없습니다. 이 상태에서 `GPL: Start`/쓰레드 시작을 누르면 "Compile만 실행 / 그대로 Start / 취소"를 먼저 묻습니다(Compile 직후 Start 연속 실행은 피함). Compile 성공 시 자동 해제됩니다.
- MCP `controller_status` 응답에 `deployLock` 필드(현재 잠금 보유자·단계·경과) 추가. `GPL: Export AI Agent Setup`이 생성하는 AI 가이드에도 잠금 거부 시 대응 규칙이 들어갑니다.

## [0.8.14] - 2026-08-18

### Fixed

- **컴파일 에러 점프 후 편집기 커서가 사라져 보이던 문제 수정** — 에러 발생 시 첫 에러 위치로 점프한 뒤 Problems 패널 명령이 마지막에 실행되어 키보드 포커스를 패널로 가져가는 순서 문제였습니다. 이제 Problems 패널을 먼저 열고 편집기 점프를 마지막에 수행해, 최종 포커스와 커서가 에러 줄의 편집기에 남습니다. 커서는 컬럼 0 대신 들여쓰기 뒤 첫 문자에 놓이고, 에러 줄이 이미 화면에 보이면 불필요한 스크롤 재중앙 정렬을 하지 않습니다. (수동 Deploy/Quick Compile과 디버그 F5 배포 경로 공통)

### Changed

- **저장 시 자동 빠른 컴파일(`gpl.quickCompile.autoOnSave`)이 조건부 자동 모드 `"auto"`를 기본값으로 사용합니다** (기존 boolean → `"auto"`/`"on"`/`"off"` 문자열, 구버전 `true`/`false` 값도 인식). `"auto"`는 제어기가 **완전 STOP 상태**(쓰레드가 하나도 존재하지 않음)이고 **`/GPL/<프로젝트>` 폴더가 이미 존재**할 때만 저장 파일을 업로드+Compile하며, 조건 미충족(실행 중·정지 쓰레드 잔존·/GPL 폴더 없음·확인 불가·디버그 세션 중)이면 팝업 없이 Output 로그 한 줄만 남기고 조용히 건너뜁니다. 업로드/파일 삭제 도중 Compile/Start가 겹치면 제어기 이상이 생길 수 있어 자동 경로는 보수적으로 게이트합니다. 자동 모드는 /GPL 폴더를 새로 만들거나 classic(/flash) 경로로 폴백하지 않으므로, 최초 1회는 수동 Deploy로 올려야 합니다.

### Added

- **업로드 중 실행 충돌 방지 가드** — 업로드/배포가 진행 중일 때 `GPL: Start`, 트리의 쓰레드 시작, FTP 뷰의 "컴파일 & 실행", `Save to Flash`를 경고와 함께 거부합니다(업로드 도중 Compile/Start가 겹치면 제어기 이상을 유발할 수 있음). `Save to Flash`의 FTP 미러(원격 파일 삭제 포함)도 같은 뮤텍스에 포함되어 autoOnSave와 겹치지 않습니다.
- **업로드 전 미저장 파일 확인 모달** — Deploy/Quick Compile/Save to Flash 실행 시 해당 프로젝트에 저장되지 않은 파일이 있으면 "저장 후 계속 / 취소" 모달로 확인합니다(Start 확인 모달과 같은 패턴). 저장하지 않으면 디스크의 이전 내용이 업로드되므로, 취소하면 업로드를 시작하지 않습니다. autoOnSave 경로는 저장이 트리거이므로 이 모달을 띄우지 않습니다.

## [0.8.13] - 2026-08-05

### Added

- **제어기 중단점 실시간 보기 개선** — GPL Controller 트리의 "브레이크포인트" 섹션이 0개일 때도 항상 표시되어 현재 상태를 확인할 수 있고, 섹션 헤더의 인라인 ↻ 버튼으로 `Show Break`만 즉시 재조회할 수 있습니다(전체 새로고침보다 가볍습니다). 항목을 클릭하면 해당 파일:줄이 열립니다(줄 번호는 배포본 기준). 에디터 중단점 동기화(`syncEditorBreakpoints`)가 켜져 있으면 중단점을 찍는 즉시 트리에도 반영됩니다.
- **`GPL: Pull Controller Breakpoints` 명령 추가** — 제어기에 설정된 중단점(GDE/AI가 건 것 포함)을 에디터 빨간 점으로 가져옵니다. 이미 같은 위치에 있는 중단점은 건너뛰며, 워크스페이스에서 찾지 못한 파일은 건수로 보고합니다. 상시 미러링이 아니라 명시적으로 실행할 때만 동작합니다.

## [0.8.12] - 2026-08-05

### Fixed

- **배포(STOP 단계)가 STATUS -752 "Timeout stopping thread"를 즉시 실패로 판정하던 문제 수정** — -752는 정지 요청 후 3초(제어기 내부 대기) 안에 쓰레드가 멈추지 않았다는 뜻일 뿐, 요청 자체는 접수되어 쓰레드는 하던 일을 마치면 멈춥니다(GPL 에러 문서 기준 비치명). 이제 배포 중 Stop -all이 -752를 돌려주면 실패로 중단하는 대신 정지 완료 게이트(Show Thread 폴링)로 실제 정지를 확인하고, 게이트에서 정지가 확인되지 않으면 Stop -all을 1회 자동 재시도합니다. 가끔 나는 -752 때문에 사용자가 배포를 손으로 재시도할 필요가 없어집니다.

## [0.8.11] - 2026-08-05

### Added

- **에디터 중단점 → 제어기 실시간 동기화** (`gpl.controller.syncEditorBreakpoints`, 기본 꺼짐) — 켜면 VS Code에서 중단점을 추가/제거/토글할 때 확장이 즉시 `Set Break`/`Set Nobreak`를 제어기로 전송합니다. VS Code 중단점이 단일 원본이 되어, 외부 AI(MCP)가 실행을 제어할 때도 에디터 빨간 점과 제어기 상태가 어긋나지 않습니다. 연결 직후에는 에디터 중단점으로 자동 따라잡고, brooks-gpl 디버그 세션 중에는 DAP가 담당하므로 개입하지 않습니다. 수동 일괄 반영은 `GPL: Push Editor Breakpoints to Controller`(뷰 "..." 메뉴 포함).
- **정지 위치 자동 표시** (`gpl.controller.autoShowPausedLocation`, 기본 켜짐) — 디버그 세션이 없을 때 스레드가 정지(Paused/Break/Error)로 전이하거나 stopOnEntry로 정지 상태로 새로 나타나면, 트리 폴링이 감지해 정지 위치 파일을 자동으로 열고 강조합니다. 외부 AI(MCP)나 GDE가 세운 정지를 에디터가 따라갑니다. 연결 직후 이미 정지돼 있던 스레드로는 점프하지 않습니다.

## [0.8.10] - 2026-08-05

### Added

- **GPL Controller 뷰 타이틀 "..." 메뉴에 자주 쓰는 명령 추가** — Quick Debug Attach, Debug launch.json 생성, 런타임 콘솔 시작/중지, 라이브 로그 터미널 시작/중지, Copy Situation for Chat, Export AI Agent Setup, Disconnect Controller. Command Palette를 열지 않고 GUI에서 바로 실행할 수 있습니다.

### Fixed

- `GPL: Export AI Agent Setup`이 CLAUDE.md에 **번호가 붙은 수동 섹션 제목**("## 7. 제어기 통신 — …")을 중복으로 감지하지 못하고 같은 내용을 한 번 더 추가하던 문제 수정 — 제목 본문 기준으로 감지합니다.

## [0.8.9] - 2026-08-05

### Added

- **`GPL: Export AI Agent Setup` 명령(`gpl.ai.exportAgentSetup`) 추가** — 현재 워크스페이스를 외부 AI(Claude Code) 디버깅 가능 상태로 만듭니다. VSIX에 동봉된 gpl-controller MCP 서버 번들을 확장 globalStorage(버전 무관 안정 경로)로 복사하고, 그 경로를 가리키는 `.mcp.json`(기존 항목 병합 보존)과 제어기 안전 규칙 CLAUDE.md 가드 섹션(마커 블록, 재실행 시 교체)을 생성/갱신합니다. Claude Code 세션을 새로 시작하면 gpl-controller 도구가 활성화됩니다.
- **controller-mcp 서버를 esbuild 단일 파일로 번들해 VSIX에 동봉** — `out/mcp/gpl-controller-mcp.cjs`(약 724KB). `npm run bundle:mcp`로 생성되며 패키징(`vscode:prepublish`)에 자동 포함됩니다. node_modules를 싣지 않으므로 저장소 클론 없이 확장 설치만으로 MCP 서버가 배포됩니다.

## [0.8.8] - 2026-08-05

### Added

- **`GPL: Start` 명령(`gpl.start`) 추가** — 배포 없이 `Start <project>`만 전송합니다. 기존 `Deploy & Run`의 START 단계를 분리한 것으로, Start 전 확인 모달(`gpl.controller.requireStartConfirmation`)과 런타임 콘솔 준비는 동일하게 적용됩니다.
- **`GPL: Save to Flash` 명령(`gpl.saveToFlash`) 추가** — 로컬 프로젝트를 `ftp://<제어기IP>/flash/projects/<projectName>`에 미러 동기화로 저장만 합니다(Stop/Unload/Load/Compile 없음). 테스트는 `/GPL`, 영구 저장은 flash라는 이원화 원칙의 저장 담당.

### Changed

- **Deploy 기본 업로드 위치가 `/GPL/<projectName>` 직접 업로드로 변경** — `gpl.deploy`(Build Only)도 Quick Compile/디버그 F5와 동일하게 /GPL 직접 미러 업로드 + Compile을 수행합니다(Unload/Load 생략). `/GPL`에 폴더가 없으면 FTP로 생성해 업로드합니다(Load 문서 Remarks가 허용하는 경로 — 최초 생성 인식 여부는 실기기 검증 전, 실패 시 Save to Flash + Load로 복구 안내). `/flash/projects`는 더 이상 Deploy가 자동으로 건드리지 않습니다.
- **`Deploy & Run`(`gpl.deployRun`) 버튼 제거** — Deploy와 Start를 분리 운용합니다(Deploy → 필요 시 GPL: Start).
- autoOnSave(변경 파일만 업로드) 경로는 `/GPL` 폴더가 없을 때 불완전한 폴더 생성을 막기 위해 기존(flash + Load) 경로로 폴백합니다.
- **심볼 조회 성능 개선** — 정의 이동·자동완성·참조 조회가 이름 기준 인덱스 캐시를 사용하도록 바뀌어, 대규모 워크스페이스에서 반복 조회의 체감 지연을 줄였습니다.

## [0.8.3] - 2026-07-24

### Added

- **AI 자율 디버깅 API(`gpl.ai.debug.*`) 추가**
  - `gpl.ai.debug.getState`: 스레드/스택/브레이크포인트 상태를 구조화 반환
  - `gpl.ai.debug.setBreakpoint` / `gpl.ai.debug.clearBreakpoint`: GDE 실측 no-space 형식으로 BP 제어
  - `gpl.ai.debug.breakThread` / `gpl.ai.debug.stepThread` / `gpl.ai.debug.continueThread`: 스레드 실행 제어
  - `gpl.ai.debug.evaluate`: `Show Variable -eval` 기반 식/변수 평가 결과 반환
  - `gpl.ai.debug.loop`: 스텝 반복 + watch 수집 + 조건(`equals/contains/regex`) 충족 시 자동 중단

### Changed

- README에 AI 자율 디버깅 API 섹션을 추가하고 `v0.8.2` 기준 사용 예시를 반영했습니다.

## [0.8.1] - 2026-07-24

### Added

- **AI Debug Assist 명령(`gpl.ai.debugAssist`) 추가**
  - 확장 명령만 사용해 안전한 디버깅 기본 순서를 오케스트레이션합니다.
  - 실행 모드: `진단만`, `Build Only + 진단`, `Build Only + 콘솔`, `Build Only + Attach`.
  - 내부 순서: 제어기 연결 확인 → 상태 스냅샷 수집 → (모드별) Build Only → (옵션) 콘솔/Attach → 최종 진단 스냅샷.
  - 실행 결과를 `GPL Language Support` Output 채널의 `[AI Debug Assist]` 섹션에 구조화해 기록합니다.

### Changed

- `README.md`의 AI/Agent 디버깅 섹션에 `GPL: AI Debug Assist` 사용 목적과 동작 모드를 문서화했습니다.

## [0.8.0] - 2026-07-23

### Added

- **문자열 속 프로시저 참조 정의 찾기**: `New Thread("DataFile.SaveReservationThreadFunction",,"...")`처럼 GPL이 프로시저를 문자열로 참조하는 관용구에서 F12가 동작합니다. 문자열 전체가 식별자 형태(`Name`/`Class.Proc`)이고 Sub/Function(또는 앞 조각의 클래스/모듈)으로 해석될 때만 이동하므로, 일반 문장/경로 문자열에서 엉뚱한 곳으로 점프하지 않습니다.

### Fixed

- `Shared Public Dim ...`처럼 **Shared가 접근 수식어보다 앞에 오는 멤버 변수 선언**이 인덱싱되지 않아 정의 찾기(F12)/호버가 되지 않던 문제를 수정했습니다(기존에는 `Public Shared Dim` 순서만 인식). Sub/Function과 동일하게 수식어 임의 순서를 허용합니다.

## [0.7.7] - 2026-07-16

### Added

- **멤버 자동완성**: `obj.` / `Move.` 뒤에서는 해당 클래스(내장·사용자 정의)의 멤버만 표시합니다(기존: 전역 목록 전체). 내장 멤버는 꼬리만 삽입되어 `Move.Move.Approach` 같은 접두부 중복 삽입이 발생하지 않고, `Dim loc As Location` 같은 변수 타입과 배열 요소(`arr(0).`)도 해석합니다. Integer 등 원시 타입 뒤에서는 목록을 비웁니다.
- **로컬 변수/파라미터 자동완성**: 현재 Sub/Function의 로컬과 파라미터가 타입 정보와 함께 목록 최상단에 표시됩니다.
- **Start 확인 게이트**: `gpl.controller.requireStartConfirmation`(기본 true) — Deploy & Run의 START 단계와 디버그 시작 시 자동 Start 전에 확인 모달을 표시합니다(로봇 모션 보호). 엔트리 정지 시작(`stopOnEntry`)은 모션이 없어 게이트하지 않습니다.
- **디버그 콘솔 안전장치**: `gpl.debug.confirmDestructiveRepl`(기본 true) — `>` 접두 명령이 제어기 상태를 바꿀 수 있으면 전송 전 확인하고, 접두사 없는 입력이 변수 평가에 실패해도 읽기 전용 명령만 제어기로 전달합니다(오타가 명령으로 나가던 구멍 차단).
- FTP 업로드 직후 원격 파일 크기를 재확인해 **부분 업로드(잘린 파일)를 감지**합니다. 불일치가 확인되면 1회 재시도 후 업로드 실패로 처리합니다.
- **참조 찾기가 열려 있지 않은 파일까지** 워크스페이스 전체를 검색합니다(기존: 열린 문서만).
- 실험적 정적 진단 게이트 `gpl.diagnostics.experimental`(기본 false).

- **매개변수 힌트(Signature Help)** 를 새로 추가했습니다. `foo(`, `Move.Approach(`, `obj.Method(` 처럼 호출을 입력하는 동안 매개변수 목록을 표시하고 현재 입력 중인 인자를 강조합니다. GPL 내장 함수와 사용자 정의 Sub/Function을 모두 지원하며, 여는 괄호 `(` 와 쉼표 `,` 에서 자동으로 나타납니다.
- 사용자 정의 Sub/Function/Property 선언 **바로 위의 `'` 주석 블록** 을 인식하여 호버·자동완성·매개변수 힌트의 설명으로 함께 보여줍니다.
- Brooks GPL Dictionary 대조로 내장 심볼의 정의 정보를 대폭 확장했습니다(약 155개 추가): Controller·Thread·Latch·Exception·File·StreamReader/Writer·Array·Console·Vision·XmlDoc·XmlNode·Modbus·Socket·TcpClient/Listener·UdpClient·IPEndPoint 등. 각 항목에 시그니처·요약·공식 문서 링크가 포함됩니다.

### Changed

- 주석 안에서는 언어 자동완성이 뜨지 않고, 문자열 안에서는 XML 엔티티 완성만 유지됩니다.
- **브레이크포인트 명령 형식을 GDE 실측(no-space)으로 통일**했습니다. 디버그 세션 종료 시 브레이크포인트 해제가 형식 불일치로 누락될 수 있던 문제가 해소됩니다.
- 배포/컴파일 전 활성 스레드 확인이 `Show Thread  -web`(실측 열거 형식)을 사용합니다. 기존 인자 없는 `Show Thread`는 빈 응답을 줄 수 있어 정지 확인 게이트가 통과해 버릴 수 있었습니다.
- 1402 응답 완료 판정이 종결자(`</STATUS>`) 우선으로 바뀌고, 잘린 응답은 완전한 응답으로 오독되지 않습니다. FTP & Run 흐름의 성공 판정도 STATUS 단독으로 정리했습니다(간접 신호 성공 추정 제거).
- 배포 동시 실행이 방지되고(진행 중 경고), 저장 시 자동 컴파일이 컴파일 중 저장된 파일을 잃지 않고 이어서 처리하며, 여러 프로젝트 파일이 섞여 저장돼도 프로젝트별로 나눠 처리합니다.
- F9(계속)가 GPL 디버그 세션에서만 동작합니다(다른 언어 디버깅의 F9 브레이크포인트 토글을 가로채지 않음).
- **호버 팝업이 간결해졌습니다.** 함수 설명 주석은 기본적으로 첫 문단(최대 6줄)만 요약 표시하고, 잘린 경우 `…`와 함께 정의 이동(F12)을 안내합니다. 디버깅 중에는 변수 값 호버를 가리지 않도록 시그니처 한 줄만 표시합니다. `gpl.hover.enabled` / `gpl.hover.docComment`(summary·full·off) / `gpl.hover.docCommentMaxLines` / `gpl.hover.duringDebug`(compact·off·normal) 설정으로 조절할 수 있습니다.
- **디버깅 중 브레이크포인트 도달 감지와 정지 쓰레드 전환이 빨라졌습니다.** 자유 실행 중 BP 히트를 1403 상태 이벤트로 즉시 감지하고(기존: 최대 5초 인터벌 폴 대기), Running 쓰레드가 있는 동안 백업 폴을 1초 간격으로 촘촘하게 유지합니다(정지 중 트래픽은 기존과 동일). 정지 감지 직후 스택 프레임을 선조회해 소스 위치 표시(전환) 체감도 왕복 1회분 줄었습니다.
- 디버깅 중 변수 값 클릭 표시(`showValueOnCursorClick`)가 **키보드 포커스를 hover 위젯에 빼앗기지 않습니다.** 기존에는 클릭 직후 `editorTextFocus` 조건 키바인딩(F9/F8 toggleBreakpoint 등)이 동작하지 않는 부작용이 있었습니다.
- 디버그 변수 편집(Set Variable)이 제어기 STATUS를 확인해 실패 시 실제로 실패로 표시합니다(기존: 항상 성공 표시).
- 호버와 자동완성의 설명을 개선했습니다. 사용자 정의 심볼은 시그니처 코드블록과 주석 설명을 함께 표시합니다.
- **정의 찾기(F12)가 메서드 오버로딩을 인자 타입까지 반영해 선택합니다.** 인자 개수가 같은 오버로드(예: `getWafer(stage, slot, arm As RobotArm)` vs `getWafer(stage, slot, armlist() As RobotArm)`)에서 호출부 인자의 타입(리터럴, 로컬/파라미터 변수, 배열 여부)을 추론해 맞는 선언으로 이동합니다. 타입으로도 구분할 수 없는 동점 후보가 남으면 틀린 곳으로 점프하는 대신 **후보 목록(peek)** 을 띄워 직접 고를 수 있습니다.

### Fixed

- **중첩 클래스 구조**(클래스 안의 클래스)가 올바르게 파싱됩니다. 기존에는 안쪽 `End Class`가 바깥 클래스 문맥까지 지워, 안쪽 클래스 뒤에 선언된 멤버가 모듈 소속으로 잘못 분류될 수 있었습니다. 이제 부모 관계도 기록되어 `Outer.` 완성에 중첩 클래스가 나오고 `Outer.Inner.`로 하강할 수 있습니다.
- 'Stopped'(정지 완료) 스레드 상태가 'Stopping'(정지 중)으로 오인되어 정지 검증이 실패하던 문제를 수정했습니다.
- 정의 이동/호버/참조 정확성: 로컬 변수 호버가 동명 전역 심볼에 가려지던 문제, 문자열/주석 안의 텍스트가 참조로 잡히던 오탐, 심볼 이름 위치 계산 오류(`Fun`이 `Function` 안에 매칭), `As Integer()` 배열 반환 타입 미인식, 생성자 오버로드의 Optional 인자 매칭, 폴더 삭제/이름변경 후 심볼 캐시 잔류.
- 컴파일 재시도(-745/-508 복구) 실패 시 원래 상태코드로 덮어써져 보고되던 문제와, 재컴파일 성공 후 이전 시도의 에러가 Problems에 남던 문제를 수정했습니다. 전체 배포의 `[5/4]` 단계 표기도 바로잡았습니다.
- 사이드바 에러 섹션의 인라인 '에러 지우기' 버튼이 표시되지 않던 문제를 수정했습니다.
- 디버그: 폴링이 예외로 조용히 멈추던 문제, 외부(GDE 등)에서 재개했을 때 UI가 정지 상태로 남던 문제, 배열 변수 확장이 빈 문자열 요소에서 멈추던 문제, 디버그 모드 진입 후에도 사이드바 폴링이 계속되던 문제를 수정했습니다.
- 1403 콘솔: 연결 시도가 응답 없는 대상에서 수십 초 고착되던 문제(5초 타임아웃), 마지막 미완성 라인 유실, 이벤트 이미터 누수를 수정했습니다.
- 배열 파라미터(`armList() As RobotArm`, `x As Integer()`)의 타입이 로컬 배열 선언과 동일하게 `RobotArm[]` 형식으로 인식됩니다(정의 찾기·참조 검색의 배열/스칼라 구분 일관화).

## [0.7.0] - 2026-07-08

### Added

- 디버그 중 마우스 클릭으로 커서를 변수 위에 놓으면 값을 즉시 표시합니다(호버 대기 불필요). `gpl.debug.showValueOnCursorClick`(기본 true)로 끌 수 있으며, `Ctrl+Alt+I`로 키보드에서도 즉시 표시할 수 있습니다.

### Changed

- 디버그(F5) 시작 전 업로드가 flash 서버를 거치지 않고 제어기 `/GPL/<projectName>`에 직접 **미러 동기화**됩니다. 크기가 다르거나 새로 생긴 파일만 올리고, 로컬에서 지운/이름 바꾼 파일은 원격에서도 삭제하며, `Unload`/`Load` 왕복을 생략해 디버그 배포가 빨라집니다. `/GPL`에 프로젝트 폴더가 아직 없으면(최초 배포) 기존 flash 경로로 자동 폴백하고, 배포 전 STOP은 그대로 선행하므로 안전합니다.
- 저장 시 자동 빠른 컴파일(`gpl.quickCompile.autoOnSave`)이 제어기 `Show Thread`로 확인해 **활성 쓰레드가 없을 때만** `/GPL/<projectName>`에 저장 파일을 업로드합니다. 실행 중에는 저장마다 방해하지 않도록 조용히 건너뜁니다.
- 디버그 hover/watch 평가 캐시를 3초로 늘리고 REPL 명령 후 캐시를 무효화해, 같은 변수 재확인이 즉시 응답합니다.
- 디버그 스텝/컨티뉴의 체감 지연을 줄였습니다. 정지 감지 fast poll을 500ms×2에서 30ms 시작 점감 백오프로 바꾸고, 1403 즉시 트리거의 디바운스 유실을 재폴 예약으로 보완했으며, 정지 직후 중복되던 `Show Thread` 왕복을 캐시로 제거했습니다. (예상 체감: 스텝당 ~600ms → ~100-250ms)

### Fixed

- 디버깅 시 대상 프로젝트(`projectName`)가 다른 프로젝트로 오인식되던 문제를 수정했습니다. 여러 프로젝트가 `Main.gpl`처럼 같은 파일명을 쓸 때, 활성 파일의 이름이 우연히 다른 프로젝트의 소스 목록에 있으면 그 프로젝트가 잘못 선택됐습니다. 이제 **활성 파일이 실제로 들어 있는 프로젝트 폴더**를 최우선으로 판별합니다. 또한 `.history`(로컬 히스토리)·`dist`·`out`에 남은 과거 `Project.gpr` 사본이 후보로 섞이지 않도록 탐색 범위를 정리하고, 자동 판별이 모호할 때는 `launch.json`의 `projectName` 명시를 권고하는 안내를 디버그 콘솔에 표시합니다.
- 정의 이동/호버가 주석(`'`)과 문자열 내부에서도 동작해 엉뚱한 심볼로 점프하던 문제를 수정했습니다. `If`/`Then` 같은 제어 키워드도 더 이상 심볼로 해석하지 않습니다.
- 클래스 필드·상수가 멤버 조회(`obj.field` 정의 이동)에서 누락되던 문제를 수정했습니다.
- 키 입력마다 심볼 캐시를 전체 재파싱하던 것을 400ms 디바운스로 바꿔 로그 폭주와 CPU 낭비를 없앴습니다.
- Quick Compile: 쓰레드 실행 중(-750)에는 Load를 강행하지 않고 명확한 안내와 함께 중단합니다. Load 응답이 HTTP면(제어기 이상 징후) 재시도 없이 즉시 중단합니다.

## [0.6.25] - 2026-07-03

### Added

- 디버그 launch 옵션 `stopAllOnDisconnect`(기본 false): 디버그 세션 종료 시 제어기 프로그램을 `Stop -all`로 정지합니다. "GPL Debug: Fast (Stop→Start→Attach, no upload, stop on exit)" 구성 스니펫도 추가되었습니다.

## [0.6.24] - 2026-07-03

> 참고: 0.6.1~0.6.23은 CHANGELOG 없이 진행된 개발 반복 빌드입니다(자동 patch bump). 0.6.23은 패키징 실패로 VSIX가 존재하지 않습니다.

### Fixed

- `npm run package`가 `EACCES: permission denied, scandir '...\controller-mcp\node_modules\.bin\node-which'`로 실패하던 문제를 해결했습니다. 원인은 리눅스 환경에서 실행된 `npm install`이 남긴 유닉스 심볼릭 링크였으며, 링크 제거 후 `scripts/package.js`에 preflight 검사를 추가해 재발 시 명확한 안내와 함께 조기 중단되도록 했습니다.

### Changed

- `.vscodeignore`에 `controller-mcp/**`, `captures/**`, `dist/**`, `test_*.js`, `.claude`를 추가해 개발 전용 파일이 VSIX에 포함되지 않도록 했습니다.
- `scripts/package.js`가 버전 bump(`--bump patch`)를 직접 처리하고, 패키징 실패 시 버전을 롤백해 버전 번호 낭비를 막습니다. vsce를 Node로 직접 실행해 이중 컴파일과 DEP0190 경고도 제거했습니다.

## [0.6.0] - 2026-05-29

### Changed

- 패키징 버전을 `0.6.0`으로 재정렬했습니다.
- npm/VS Code SemVer 호환성을 유지하기 위해 실제 버전 문자열에는 16진수 리터럴 표기 대신 `major.minor.patch` 형식을 유지합니다.

## [0.5.109] - 2026-05-29

### Changed

- FTP Run은 기본적으로 Compile 전에 `Load <resolvedPath>`를 선행하지 않도록 변경했습니다.
- 필요한 환경에서만 `gpl.controller.ftpRunLoadBeforeCompile=true`로 Load 선행 동작을 켤 수 있도록 설정을 추가했습니다.

## [0.5.108] - 2026-05-29

### Fixed

- FTP Run이 `/GPL/<project>`와 `/flash/projects/<project>` 사이에서 오래된 `/GPL` 복사본을 선택할 수 있던 경로 정합성 문제를 완화했습니다.
  - 설정된 `gpl.controller.ftpFlashProjectsPath`에 같은 프로젝트가 있으면 Flash Projects 경로를 우선 사용합니다.
  - Compile 전에 `Load <resolvedPath>`를 명시적으로 수행해 컴파일 대상 복사본을 확정합니다.

## [0.5.107] - 2026-05-29

### Fixed

- FTP Run의 `Compile <project>` 경로에도 STATUS 누락 보강 판정을 적용했습니다.
  - `Compile successful` 마커가 있으면 성공으로 처리합니다.
  - pass 로그만 있고 STATUS가 없으면 `Show Thread` 후속 정상 응답으로 성공 여부를 보강 판정합니다.
- FTP Run Compile 응답의 RAW preview와 불완전 수신 메타 로그를 출력해 `STATUS -9999 No STATUS found` 분석성을 개선했습니다.

## [0.5.106] - 2026-05-29

### Changed

- 디버깅 중 `F9`로 Continue를 실행할 수 있도록 기본 키바인딩을 추가했습니다.
- hover/watch 변수 평가에 짧은 TTL 캐시를 추가해 같은 변수의 반복 조회 응답성을 개선했습니다.
- GPL Controller 뷰의 연결 상태 상단 액션에서 Disconnect 위치를 `Stop -all`로 교체했습니다.

## [0.5.105] - 2026-05-29

### Changed

- `GPL: Send Command to Controller` 입력 가드를 추가해 XML 형식, `Show Project`, `Directory` 단독 호출을 감지하고 올바른 plain command 사용을 안내합니다.
- README와 console command reference에 1402 wire format(plain text + CRLF), `Directory <path>`, `STATUS -505/-714` 해석을 보강했습니다.

## [0.5.102] - 2026-05-28

### Fixed

- **디버거 안정성 — 제어기 단일 명령 스트림 가정 강화**: 폴링이 사용자 명령보다 1402 큐를 점유해 Step/Continue 반응이 지연되던 문제 수정
  - 사용자 액션(step/continue/pause/disconnect) 진행 중에는 `Show Thread` 폴링을 보류 (`_userActionInFlight` 가드)
  - 명령 간 최소 idle gap(정상 15ms / 실패 후 100ms) 도입으로 매 명령 connect/close 부담을 분산 → ECONNRESET/idle EOF 빈도 감소
- **Continue 후 오정지 해소**: paused→paused 2회 휴리스틱 대신 "Running 한 번이라도 관측 + 다시 Paused" 명시적 상태 전이로 정지 이벤트 발사
  - Continue 직후 폴 누락으로 인해 직전 정지 상태를 새 BP 도달로 오인하던 케이스 제거

### Changed

- **Disconnect 시 자동 `Stop <project>` 호출 제거**: 디버거 분리는 "VS Code 측 세션 종료"만 의미하며 제어기 측 프로젝트 실행은 보존
  - 좀비 쓰레드 정리는 사용자가 명시적으로 `GPL: 모든 쓰레드 중지` / 개별 쓰레드 중지 명령을 사용해야 함
  - 브레이크포인트 정리는 그대로 수행

## [0.5.101] - 2026-05-20

### Changed

- GPL 문법 하이라이팅 확장: 표준 TextMate 스코프 기반으로 선언부/타입명 색상을 강화
  - `Class`, `Module`, `Sub`, `Function`, `Property`, `Const` 선언 이름에 의미 스코프 부여
  - `As Type`, `New TypeName` 위치의 타입명도 별도 스코프로 표시
  - 커스텀 전용 스코프보다 테마 호환성이 좋은 표준 계열(`entity.name.*`, `storage.type.*`, `storage.modifier.*`) 우선 사용

## [0.5.100] - 2026-05-20

### Fixed

- `Go to Definition`이 `Public Shared steps() As StepBatch` 같이 `Dim` 없는 `Shared` 배열 선언을 심볼 캐시에 인덱싱하지 못하던 문제 수정
  - 파서에 `Public/Private Shared name() As Type` 패턴 분기가 없어 해당 선언이 파싱에서 누락되었음

## [0.5.99] - 2026-05-20

### Fixed

- `Find All References`가 `steps(i).RunZeroStep(...)` 같은 배열/인덱서 기반 클래스 멤버 호출을 놓치던 문제 수정
  - 기존 참조 검색 패턴이 `obj.Member` 형태만 주로 인식해 `arr(index).Member`, `arr(0)(1).Member`, `foo.bar(i).Member` 호출이 누락될 수 있었음
  - 멤버 접근 정규식을 확장해 인덱서/체이닝이 포함된 qualifier도 검색 대상으로 포함

## [0.5.95] - 2026-05-18

### Changed

- 배포 COMPILE 단계에서 `STATUS -742/-746/-752`가 발생하고 컴파일 에러가 파싱되지 않은 경우 자동 1회 재시도
  - 일시적인 컨트롤러 상태 변동으로 인한 간헐 실패를 완화
  - 실제 컴파일 에러가 있는 경우는 즉시 실패 처리 유지

## [0.5.98] - 2026-05-20

### Fixed

- GPL 문법: `Public Class ClassName` 형태에서 클래스 이름이 무색이던 문제 수정
  - 원인: 내장 VB.NET 문법의 `storage.type.asp` 패턴이 `\\s*` 접두로 `Class` 이전 공백부터 매칭 선점
  - 수정: 클래스 선언 패턴에 `\\s*` 추가로 동일 위치 경쟁 시 GPL 패턴 우선 적용

## [0.5.97] - 2026-05-20

### Changed

- GPL 문법 하이라이팅: `Class` / `Module` 선언 이름에 `entity.name.type` 스코프 부여
  - `Class StepData` → `StepData`가 타입 이름 색상으로 표시됨
  - `Module AutoAging` → `AutoAging`이 모듈 이름 색상으로 표시됨

## [0.5.96] - 2026-05-18

### Fixed

- `Deploy (Build Only)` / `Deploy & Run`의 COMPILE 대상 동기화 강화
  - 업로드 후 COMPILE 전에 대상 프로젝트를 `Unload -> Load(/flash/projects/<project>)`로 강제 동기화
  - 이미 로드된 `/GPL/<project>`의 구버전 복사본을 컴파일해 과거 오류가 재발견되는 오판정 가능성을 완화

## [0.5.94] - 2026-05-18

### Changed

- 1403 무출력 종료를 `Immediate EOF / Idle timeout / Empty batch`로 분리 판정
  - `Idle timeout`(기본 1500ms 이상 유지 후 payload 없이 종료)은 정상 이벤트 대기 폴링으로 처리
  - 정상 idle 세션이 `noPayloadStreak`에 누적되어 `UNSTABLE`로 과대 경보되는 문제를 완화
- `Idle timeout` 경로 재연결은 고정 idle 지연(기본 5000ms)으로 유지
  - 빈 세션 누적만으로 재연결 지연이 30000ms까지 커지는 현상을 줄여 가시성과 반응성 균형 개선

## [0.5.93] - 2026-05-18

### Changed

- 1403 세션에서 payload가 없어도 `GPL Console` 채널에 상태 힌트를 출력하도록 개선
  - `CONNECTED_NO_PAYLOAD`, `Immediate EOF` 폴링, `no-payload streak` 상황을 `[RT] [1403] ...` 라인으로 표시
  - 런타임 이벤트가 없는 구간에서도 콘솔이 완전히 비어 보이지 않아 운영자가 상태를 즉시 판단 가능

## [0.5.92] - 2026-05-18

### Changed

- `GPL: Deploy (Build Only)`가 오류/시스템 경고 없이 정상 완료되면 `GPL Console` 채널을 자동으로 표시
  - 1403 런타임 콘솔 연결 직후 출력 확인 동선 단축

## [0.5.91] - 2026-05-18

### Performance

- **1403 재연결 루프 완화(2차)**: `RuntimeConsole.start()` 기본 경로가 대기 중 재연결 타이머를 취소하지 않도록 조정
  - 자동 `ensure/start` 호출로 `RECONNECT timer canceled by explicit start()`가 반복되며 connect/close가 가속되는 패턴을 억제
  - no-payload/immediate-EOF 누적 streak 카운터가 자동 호출마다 리셋되지 않도록 보존해 적응형 지연 정책이 안정적으로 작동

### Changed

- 사용자 명령(`gpl.console.start`, `gpl.console.ensure`)만 강제 즉시 재연결 옵션을 사용하도록 분리
  - 수동 액션 반응성은 유지
  - 내부 자동 경로는 비침습(idempotent) 유지

## [0.5.90] - 2026-05-18

### Performance

- **디버그 폴링 부하 완화**: 디버그 세션의 `Show Thread` 폴링 간격을 사용자 설정(`gpl.controller.threadPollIntervalMs`) 기반으로 적용하고, 안전 범위(1000~5000ms)로 제한
  - 기존처럼 500ms로 강제되지 않아 1402 트래픽 스팸을 크게 줄임
  - `Step/Continue` 즉시성은 기존 `_fastPoll` 및 1403 데이터 트리거 경로로 유지
- **1403 장기 no-payload 루프 완화**: `Immediate EOF` 재연결 최대 지연 기본값을 `5000ms -> 15000ms`로 상향
  - 장시간 이벤트 부재 구간에서 불필요한 connect/close 반복 빈도를 낮춤

### Added

- attach 시 적용된 디버그 폴링 간격(`user/effective`)을 Debug Console에 기록해 현장 진단 가시성 강화

## [0.5.89] - 2026-05-15

### Performance

- **디버그 응답성 대폭 개선**: `Step -over` 실행 중 직렬 큐 혼잡 문제 해결
  - `pendingAction`이 `step`/`continue`인 동안 `stackTraceRequest`, `variablesRequest`, `evaluateRequest`에서 TCP 명령을 전송하지 않고 즉시 반환 (캐시 프레임 또는 빈 결과)
  - 이로써 Watch 패널/변수 패널의 자동 폴링이 직렬 큐를 막지 않아 `Show Thread` 폴링 지연 해소
  - 예상 step latency: 5~8초 → 1~2초
- **1403 이벤트 즉시 폴 트리거**: `RuntimeConsole.onDidReceiveData` 이벤트 추가
  - 1403에서 raw 데이터(step 완료 `<E>N,N</E>` 포함) 수신 시 `fireDebugPollTrigger()` 호출
  - 디버그 세션이 즉시 `_pollThreadStates()` 실행 → 폴링 타이머 대기 없이 StoppedEvent 발송
- **`_cachedFrames`**: `_getThreadFrames()` 결과를 쓰레드별로 캐싱, step 실행 중 직전 위치 정보 제공
- **`_fastPoll` 경량화**: 5회×300ms → 2회×500ms (1403 즉시 트리거가 백업을 담당)

## [0.5.88] - 2026-05-14

- 디버그 CALL STACK 패널의 쓰레드 항목에 실시간 상태 표시 추가
  - 형식: `ThreadName  [▶ Running]`, `ThreadName  [⏸ Break]`, `ThreadName  [⚠ Error]` 등
  - 상태 변경 시 `InvalidatedEvent(['threads'])` 전송 → VS Code가 자동으로 쓰레드 목록 갱신

## [0.5.87] - 2026-05-14

- `Show Thread` 폴링을 고정 주기 `setInterval`에서 적응형 `setTimeout` 재귀 방식으로 교체
- 실행 중인 쓰레드가 없을 때(idle) 폴링 간격을 기본값의 3배로 자동 지연해 제어기 1402 포트 부하 감소
- 쓰레드가 감지되면 즉시 `threadPollIntervalMs` 설정 주기로 복귀

## [0.5.86] - 2026-05-14

- 1403 콘솔 트리 항목을 `상태 + 최근 payload/재연결 요약` 중심으로 재구성해 한 줄에서 현재 상황을 더 바로 읽을 수 있게 개선
- 1403 항목 툴팁에 마지막 연결 시도, payload, 오류 코드, 재연결 대기 정보를 묶어 표시
- 상태 뷰 상단과 1403 항목 hover 액션에 `GPL Traffic` 버튼을 추가해 트래픽 채널을 바로 열 수 있게 개선

## [0.5.85] - 2026-05-14

- 사이드바 연결 섹션에서 `1403 콘솔 상태`와 `1403 연결/재연결/로그 보기`를 하나의 클릭 가능한 항목으로 병합
- 병합된 1403 항목에 현재 상태, 상세 사유, 포트 정보, 클릭 동작 안내를 함께 표시해 UI를 더 간결하게 정리

## [0.5.84] - 2026-05-14

- 1403 런타임 콘솔 상태를 `connecting / connected-no-payload / reconnecting / connect-failed` 등으로 세분화하고, 마지막 연결 시도/마지막 payload/최근 오류 코드 같은 증거를 스냅샷에 포함
- `GPL: Start Runtime Console`, `1403 연결/재연결/로그 보기`, 포트 핑 UX를 개선해 `연결됨이지만 payload 없음`과 `연결 거부/재연결 대기`를 구분해 안내
- 진단 스냅샷과 사이드바 연결 섹션에 1403 관찰 증거와 가설(예: ECONNREFUSED, 빈 세션)을 함께 표시해 제어기 문제와 UI/표시 문제를 분리 진단하기 쉽게 개선

## [0.5.83] - 2026-05-13

- COMPILE 응답에 `<STATUS>`가 누락되어도 `Compile successful` 문자열이 있으면 성공으로 판정하도록 개선
- COMPILE 응답이 pass 로그 중심(DATA-only)이고 STATUS 미검출인 경우 즉시 `-9999` 실패 처리하지 않고, 짧은 보강 수신 window 후 `Show Thread` 1회 보강 판정을 수행하도록 개선
- `Compile by name -> -508` 이후 `Load <absolute FTP path>` + COMPILE 성공 시 `-508`을 최종 실패 원인에서 제외하고 전처리 경고로만 기록
- COMPILE 원문 로그에 미완 응답 진단 메타(`responseComplete`, `bytesReceived`, `lastChunkAt`, `idleTimeoutMs`) 출력 추가

## [0.5.82] - 2026-05-12

- 배포 경로 자동 판별 추가: `/flash/projects`와 `/GPL`를 프로빙해 프로젝트 폴더 존재 기준으로 우선 경로를 선택하고 배포에 사용
- 배포 결과/알림에 선택된 원격 경로를 명시해 현재 어떤 경로로 컴파일/실행했는지 즉시 확인 가능
- 스냅샷 강화: `Error Thread 상세`에 오류 스레드명/ID, 직전 명령, 최초 발생 시각, 스택 프레임, 관련 함수를 자동 포함

## [0.5.81] - 2026-05-12

- 사이드바 UI 간소화: 연결 섹션에서 `통신 트래픽 보기`, `명령 보내기`, 중복 콘솔 관련 항목을 제거해 핵심 정보 위주로 축소
- 1403 조작 단일화: `1403 연결/재연결/로그 보기` 액션(`gpl.console.ensure`) 하나로 통합
- 프로젝트 컨텍스트 섹션 축약: 기대/실행, FTP 요약만 표시하고 기본 접힘으로 변경
- 상단 액션 버튼 단순화: 연결 상태 기준 `Connect/Disconnect + Refresh` 중심으로 축소

## [0.5.80] - 2026-05-12

- 런타임 오류 발생 시 디버그 이벤트에 오류 스레드명/ID, 직전 실행 명령, 최초 발생 시각, 스택 프레임 요약, 관련 함수 목록을 포함하도록 확장
- 사이드바에 `런타임 오류 컨텍스트` 섹션 추가: 오류 스레드, 직전 명령, 최초 시각, 프레임을 자동 표시
- 에러 항목 클릭 동작을 `오류 상세 보기`로 변경하여 해당 오류의 스레드/호출 경로/관련 함수/최근 로그(10줄)를 즉시 출력
- `-782` 코드 상세에서 초기화 누락/생성자 누락/getter 반환 경로 후보를 자동 힌트로 표시
- 에러 체인(`-782 -> -508 -> -2`)을 접을 수 있는 `에러 체인` 하위 섹션으로 그룹화
- 진단 스냅샷에 `판정(환경/코드/UI)` 한 줄 요약 추가

## [0.5.79] - 2026-05-12

- 배포 실패 시 `COMPILE 원문 로그` 섹션을 출력 채널에 추가해 `-738/-742` 등 실제 컨텍스트를 직접 확인 가능하도록 개선
- `ErrorLog` 출력을 `환경 경고` / `코드·배포 에러`로 더 강하게 분리하고, 코드별 해석/권장 조치를 함께 표시
- COMPILE 단계에서 시스템 환경 에러(예: `-1521`) 동반 시 알림 문구를 `코드 수정 효과 검증 불가` 우선 문구로 강화
- 동일 실패 시그니처를 세션 히스토리로 비교해 `회귀 아님: 동일 실패 패턴 N회 관측` 메시지 자동 부여
- `gpl.diagnosticSnapshot` 명령 추가: 1402/1403 상태, 단계 판정, 코드 TopN, 체인, 비교 판정, COMPILE 원문 요약을 클립보드/출력 채널로 생성

## [0.5.78] - 2026-05-12

- 디버깅 중 쓰레드가 `Error` 상태로 전이되면 에러 위치 이벤트(`gpl.errorLocation`)를 발행하도록 DAP 세션 개선
- 확장에서 에러 위치 이벤트를 수신하면 해당 소스 파일/라인을 자동으로 열고 중앙으로 스크롤하도록 개선
- 같은 시점의 에러 위치/쓰레드 정보를 `GPL Language Support` Output 채널에 함께 기록해 로그와 위치를 한눈에 확인 가능

## [0.5.77] - 2026-05-12

- `Copy Situation for Chat` 스냅샷에 **최근 배포 결과** 섹션 추가
  - 성공/실패
  - 마지막 단계(`STOP`/`UPLOAD`/`COMPILE`/`START`/`SUCCESS`)
  - 컴파일 에러 코드 목록
  - 제어기 시스템 에러 코드 목록
- 트리뷰 연결 섹션에 1403 콘솔 상태 원인 표시 추가
  - 연결 거부(`ECONNREFUSED`), 빈 세션, 즉시 EOF, 소켓 에러 구분
  - `1403 재시도 연결` 액션 노출
- 명령 ID 별칭 `gpl.stopAll` 추가 (`gpl.controller.stopAll`와 동일 동작)
- 설정 기본값 변경: `gpl.runtimeConsole.autoStartOnDeploy = true`

## [0.5.76] - 2026-05-12

### Added

- `responseParser.ts`에 `classifyErrorEntry()` / `parseControllerErrorEntry()` 공유 함수 추가 — 제어기 시스템 에러 코드 목록(`-1521`, `-1520`, `-1519`, `-1518`) 포함
- 컨트롤러 트리뷰 에러 섹션을 두 그룹으로 분리 표시: `⚙ 제어기 시스템` (경고 아이콘) vs 코드 에러 (빨간 아이콘)
- 배포 결과 출력 채널에 `[⚠ 제어기 시스템]` / `[✘ 배포 에러]` 구분 섹션 출력

### Changed

- `extension.ts`의 지역 에러 분류 함수 3개를 `responseParser.ts` 공유 함수로 교체
- 배포 실패 시 실패 단계(STOP/UPLOAD/COMPILE/START) 메시지에 포함
- `-1521` 등 알려진 시스템 에러가 있어도 배포/GPL 코드 실패 원인으로 귀속하지 않도록 메시지 분리

### Fixed

- `gpl.controller.copyError` 인라인 명령이 TreeItem 객체를 인자로 받아 변환 실패하던 문제 수정 (`label` 프로퍼티 fallback 추가)

## [0.5.75] - 2026-05-12

- `GPL: Copy Situation for Chat` 실행 시 클립보드 복사만 수행하고 Markdown 문서를 자동으로 열지 않도록 조정
- 상태 공유 명령 실행 후 에디터 포커스를 빼앗지 않게 UX 단순화

## [0.5.74] - 2026-05-12

- UI 전역 상태 컨텍스트(`gpl.ui.connected`, `gpl.ui.debugging`)를 도입해 연결/디버그 상태를 일관 공유
- `GPL Controller > Status` 상단 액션을 연결 상태 기반으로 노출하도록 조정
  - 미연결: `Connect` 노출
  - 연결됨: `Stop All`, `Deploy`, `Deploy & Run`, `Refresh`, `Quick Attach` 노출
- 디버깅 중에는 상단의 `Deploy`/`Deploy & Run` 버튼을 숨겨 상충 동작 가능성 완화

## [0.5.73] - 2026-05-12

- Attach 전 배포 실패 시 실패 단계(`STOP/UPLOAD/COMPILE/START`)를 명시적으로 출력
- 실패 명령, STATUS 코드/메시지, 후보 프로젝트명 시도 순서를 Debug Console에 출력
- attach 실패 시 배포 raw trace를 Debug Console에 자동 덤프
- `GPL Deploy (Debug)` Output 채널에 동일 배포 trace가 누적되어 사후 분석 강화

## [0.5.72] - 2026-05-12

- `GPL Controller > Status` 상단 버튼을 10개에서 5개로 축소해 UI 혼잡도 완화
- 상단 유지 버튼: `stopAll`, `deploy`, `deployRun`, `threads.refresh`, `debug.attachNow`
- 상단에서 제외 버튼: `consoleToggle`, `logs.liveTerminal.start`, `showTraffic`, `copySituationForChat`, `debug.generateLaunch`
- README 현재 버전을 `v0.5.72`로 업데이트

## [0.5.71] - 2026-05-12

- TCP 응답 수신 로직을 개선해 부분 수신 이후에도 누적 응답을 완성으로 판단할 수 있게 조정
- 트래픽 로그에서 송신 명령 형식을 `[PLAIN]` / `[XML]`로 자동 표시
- 에러 섹션에서 Error 상태 쓰레드의 이름, 파일, 마지막 상태를 우선 노출하도록 UI 개선
- README 상단 현재 버전 표기를 `v0.5.71`로 정합성 맞춤
- 패킷 분할 상황에서 `</STATUS>`만 기다리며 무응답처럼 보이던 UX 문제 완화
- 릴리즈 파이프라인이 기대하는 `CHANGELOG.md` 부재 문제 해결

## [0.5.70] - 2026-05-12

- 디버그 세션의 쓰레드 상태를 사이드바에 실시간 동기화하는 브리지 추가
- `Run Extension (no compile)` 런치 구성과 `npm: watch` 기반 빠른 개발 루프 문서화
- README 디버깅 가이드를 확장해 F5 흐름과 watch 기반 재실행 흐름을 명확히 설명
- 디버그 중 별도 TCP 추가 호출 없이 쓰레드 상태를 보도록 동작 개선
