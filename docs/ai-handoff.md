# AI 인계 자료 — GPL Language Support 확장 작업 핸드오프

- 최종 갱신: 2026-08-18 (§1-BA: 문서 정리 2차 — file-io 분리, 런북 명령 표 재생성, 정본 역할 분담, pre-release-check README 버전 검사, Pages 배포. 직전: §1-AZ MkDocs 도입)
- 대상 저장소: `C:\Users\Doyun\Documents\GitHub\GPL_language` (VS Code 확장 `nir414.gpl-language-support`)
- 현재 package 버전: **0.8.14** (태그 push 시 CI(release.yml)가 자동 빌드·패키징·릴리즈. 로컬 `npm run compile`/`npm run pre-release-check`/`npm run package` 검증 권장)
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
6. **`Stop -all`의 STATUS 0은 "정지 요청 접수"이지 정지 완료가 아니다.** 정지 완료 전에 `Compile`/`Start`를 보내면 제어기 이상 현상(메모리 누수 의심, 2026-07-08 사용자 관찰, §1-G)이 발생할 수 있다. Compile/Start 전에는 반드시 `Show Thread`로 모든 쓰레드가 Idle/Stopped/Error임을 확인한다. `deploy()`에 게이트가 구현돼 있으니 우회 경로를 만들지 말 것.

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
- [ ] 미러는 크기 비교라 동일 크기 내용변경은 놓침(기존 `skipUnchanged` 한계와 동일) — 필요 시
  mtime/해시 기반으로 강화(§3 F5 차등 업로드 항목과 연계).

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
  - autoGate 경로는 진입 시 `output.show(true)`/`diagnosticCollection.clear()`를 하지 않음(저장마다 포커스 강탈 방지, 게이트 스킵 시 기존 빨간 줄 보존). 진단 clear는 게이트 통과 후 UPLOAD 진입 시점에 수행.
- **`extension.ts`**: `QuickDeployOpts.autoGate` 전달, `runDeployCore`에서 `AUTO_GATE` 결과는 실패 처리(팝업·스냅샷·outputChannel.show) 전에 로그 한 줄로 조기 반환. flush에서 `brooks-gpl` 디버그 세션 중이면 프로브 왕복 없이 스킵. 저장 핸들러/flush는 `getAutoOnSaveMode()` 사용.
- **Start 계열 명령에 배포 뮤텍스(`deployInFlight`) 가드 추가** — 사용자가 경고한 "업로드 도중 Start" 충돌의 확장 내부 경로 차단:
  - `gpl.start`, `gpl.controller.threadStart`, `gpl.controller.ftpRun`(Compile & Start): 업로드/배포 진행 중이면 경고 후 거부.
  - `gpl.saveToFlash`: FTP 미러(원격 삭제 포함)를 `deployInFlight`로 감싸 autoOnSave/배포와 상호 배제(기존엔 뮤텍스 밖이었음).
  - 한계: **MCP(controller-mcp)·GDE 등 외부 클라이언트의 Start/Compile은 이 뮤텍스로 못 막는다.** 자동 모드의 "쓰레드 0개" 게이트로 창을 최소화할 뿐, 근본 차단은 아님.
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

- 사용자: 커밋/푸시 후 **GitHub 저장소 Settings → Pages → Source를 "GitHub Actions"로 설정**해야 첫 배포가 됨 (미설정 시 deploy job 실패).
- 아래 §3 체크리스트에 후속 4건 추가함 (런북 Command ID 표 재생성, 런북↔instructions 정본 단일화, pre-release-check README 버전 대조, gpl-language 문서의 Test_robot 잔재 점검).

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

## 2. 진행 중 / 코드 쪽 미결 (사용자 결정 대기)

- **`ProtocolModule.gpl` 478·480의 `-760 Invalid assignment`**: `isOrgCompleted`는 `RobotModule.gpl:828`에 **`Public ReadOnly Property ... As Boolean`**(읽기 전용)으로 정의됨. 거기에 값을 대입해서 나는 에러. 해결책(택1, 사용자 결정 대기): setter 메서드 추가 / `ReadOnly` 제거 후 `Set` 접근자 추가 / backing 필드 직접 대입.
- (참고) GDE 기준 원래 4개 에러(477 -730, 478 -760, 479 -748, 480 -760)였는데 477/479는 사용자가 정리한 듯, 현재 478/480만 남음.

## 3. 다음에 할 일 (체크리스트)

- [ ] **(2026-08-05, §1-AQ) Stop/settle/busy-retry 처리 통일 리팩터링** — 같은 로직이 4곳+MCP에 제각각(§1-AQ 표 참조). 제안: ① `sendCommandWithBusyRetry`를 `controllerConnection.ts`(또는 공용 모듈)로 이동해 extension.ts/deployService/gplDebugSession이 공유 ② settled 상태 집합(`/^(idle|stopped|error)$/i`)과 settle 폴러를 단일 정본으로(현재 extension.ts:78과 deployService.threadSettled가 주석 동기화 의존 중복) ③ Stop 계열 공통 규약 확립: "Stop 전송 → STATUS 0/-752 모두 '접수'로 간주 → settle 폴링 → 미확인 시 Stop 1회 자동 재시도 → (수동 경로) SoftEStop 복구 제안 / (자동 경로) 중단" ④ controller-mcp 도구 설명·exportAgentSetup 가이드에 -752 비치명 의미 명시. ※ 모션/정지 흐름에 닿는 변경이므로 §3-B 원칙대로 저속/시뮬레이션 검증 후 적용.
- [ ] **(우선, §1-AH) 외부 AI 디버깅 경로 개선** — ①(워크스페이스 AI 가이드/`.mcp.json`)·②(`GPL: Export AI Agent Setup`)는 **완료(2026-08-05, §1-AN)**. 남은 것: ③ controller-mcp 디버깅 도구 견고화 패리티(§1-AG 규약) — **대부분 완료(2026-08-05, §1-AS: 정지확인 내장·run_to_line·statusHint, 실기기 검증 남음)**, ④ connect backoff, + **1403 실시간 스트림 도구**(console_start/read(cursor)/stop). 상세와 배경은 §1-AH/§1-AN.
- [ ] (§1-AG) 로컬 `npm run compile`→`npm run package`→VSIX 재설치 + 실기기 검증(Break/Step 상태 전이 타이밍, `-eval` 응답 형식, Error 전이 중단).
- [x] (2026-07-10, §1-J) Hover/IntelliSense/Signature Help 개선 + Brooks 사전 +155 — 샌드박스 tsc·90테스트 통과. (실기기 표시 확인은 사용자)
- [ ] (§1-J 후속) 캐시 초록 기반 60개(XmlNode/Network/Modbus) 항목을 web_fetch rate limit 해제 후 라이브 페이지로 파라미터 세부 재확인.
- [ ] 사용자 로컬(Windows)에서 `npm run package` 1회 실행해 재검증 후 새 VSIX 재설치. ※ 2026-07-03: 샌드박스 검증 완료, `dist/gpl-language-support-0.6.24.vsix` 생성됨(§1-C).
- [ ] §2 `isOrgCompleted` 대입 방식 확정 후 코드 수정 → MergeCode 재컴파일로 `-742` 해소 확인.
- [ ] F5/Build Only 경로도 **로컬 매니페스트(파일별 mtime/크기 또는 해시) 기반 차등 업로드** 도입 검토(현재 SIZE 왕복 N회 + 크기충돌 누락 위험). 제어기 FTP의 `MDTM` 지원 여부는 환경 확인 필요 → 안전하게 로컬 mtime/해시 기반 권장. ※ 부분 반영: §1-I에서 F5/수동 Quick Compile은 `/GPL` 미러(원격 목록 조회 + 크기 비교, 원격 전용 삭제)로 전환됨. 남은 것은 크기충돌을 없앨 mtime/해시 강화.
- [ ] 정의 찾기: 클래스 멤버 스코프 해석(`obj.member`를 obj의 클래스 한정으로) 정확도는 추후 보강 여지. ※ 오버로드 해석(인자 개수+타입, 동점 peek)은 2026-07-13 §1-K에서 구현 완료.
- [ ] (§1-P → §1-U에서 일부 완료) 실기기 검증: 1402 수동 검증으로 객체 덤프 형식 확인·분류 버그 수정(2026-07-22, §1-U). **남은 것(VSIX 재설치 후)**: Variables/hover/Watch에서 객체 트리 확장 UI 확인, 로컬 배열 펼침(30개 상한), 중첩 객체(`cmdResponse`), setVariable, Globals 패널 배열/객체 표시. 배열 확장 지연 크면 `ARRAY_EXPAND_MAX` 조정.
- [ ] (2026-07-16, §1-Q) 자체 검토 세션 변경분 — 로컬 `npm run compile` && `npm test` 후 §1-Q 실기기 검증 체크리스트 수행.
- [ ] (2026-08-18, §1-AY) Rename(F2) 실사용 검증 — MergeCode에서 로컬 변수/모듈 프로시저/클래스 멤버/스레드 문자열 참조 rename 확인. 다음 릴리스 CHANGELOG에 "Rename(F2) 지원" 기재.
- [ ] (2026-08-18, §1-AZ) GitHub Pages 첫 배포 — 커밋/푸시 후 저장소 Settings → Pages → Source를 "GitHub Actions"로 설정, docs.yml 성공과 사이트(https://nir414.github.io/GPL_language/) 확인.
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
src/controller/controllerConnection.ts   # sendCommandDetailed, waitForStatusClose
src/controller/deployService.ts          # deploy(), tryCompile, changedFiles/onlyFiles, directGpl(§1-G), Stop 완료 게이트
src/controller/ftpClient.ts              # uploadProject onlyFiles
src/controller/responseParser.ts         # parseStatus, parseCompileErrors
src/debug/gplDebugSession.ts             # attachRequest, _runDeployBeforeAttach, getDebugDeployDiagnostics
src/extension.ts                         # runDeploy, autoOnSave
src/gplParser.ts                         # Property/Sub/Function 파싱 + parseDocument 메모이즈 캐시(§1-B E) + docComment 수집(§1-J)
src/gplBuiltins.ts                       # 핵심 빌트인/String 함수 (Trim→메서드, Rnd(seed), Replace 제거, Asc/Chr/… 추가) + Bit 문자열 전역함수(§1-J)
src/gplDictionaryData.ts                 # Move/Robot/Location/Profile/.../String 클래스 사전 + Controller/Thread/Exception/File/XML/Network 등 +153(§1-J)
src/providers/completionProvider.ts      # 정적 항목 캐시, 트리거('.', '&')
src/providers/definitionProvider.ts      # token 확인 + parseDocument 재사용
src/providers/hoverProvider.ts           # token 확인 + docComment 표시(§1-J)
src/providers/signatureHelpProvider.ts   # Signature Help(빌트인+사용자 Sub/Function, §1-J 신설)
src/symbolCache.ts                       # 심볼 캐시 + 완성 문서화(buildSymbolDocumentation, §1-J)
src/providers/referenceProvider.ts       # scanDocumentText 라인별 스캔(ReDoS 완화)
.github/instructions/gpl-ai-controller-debugging.instructions.md  # 하드 규칙
```

## 5. 참고 — 정상 컴파일 응답 형식 (GDE, verbatim, 2026-06-30)

다음처럼
