# AI 인계 자료 — GPL Language Support 확장 작업 핸드오프

- 최종 갱신: 2026-07-23 (§1-Z: 0.8.0 릴리즈 메타데이터 정리·검증·패키징; 직전 §1-Y: 객체 배열 분류 + 점 표기 멤버 부모 덤프 폴백)
- 대상 저장소: `C:\Users\Doyun\Documents\GitHub\GPL_language` (VS Code 확장 `nir414.gpl-language-support`)
- 현재 package 버전: **0.8.0** (태그 push 시 CI(release.yml)가 자동 빌드·패키징·릴리즈. 로컬 `npm run compile`/`npm run pre-release-check`/`npm run package:no-bump` 검증 권장)
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
- [ ] `/GPL` 직접 쓰기와 `/flash/projects` 사본의 **이원화 관리 원칙** 문서화: Quick Compile은
  /GPL만 갱신, 정식 배포(Build/Deploy & Run)가 flash 반영 담당.
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

## 2. 진행 중 / 코드 쪽 미결 (사용자 결정 대기)

- **`ProtocolModule.gpl` 478·480의 `-760 Invalid assignment`**: `isOrgCompleted`는 `RobotModule.gpl:828`에 **`Public ReadOnly Property ... As Boolean`**(읽기 전용)으로 정의됨. 거기에 값을 대입해서 나는 에러. 해결책(택1, 사용자 결정 대기): setter 메서드 추가 / `ReadOnly` 제거 후 `Set` 접근자 추가 / backing 필드 직접 대입.
- (참고) GDE 기준 원래 4개 에러(477 -730, 478 -760, 479 -748, 480 -760)였는데 477/479는 사용자가 정리한 듯, 현재 478/480만 남음.

## 3. 다음에 할 일 (체크리스트)

- [x] (2026-07-10, §1-J) Hover/IntelliSense/Signature Help 개선 + Brooks 사전 +155 — 샌드박스 tsc·90테스트 통과. (실기기 표시 확인은 사용자)
- [ ] (§1-J 후속) 캐시 초록 기반 60개(XmlNode/Network/Modbus) 항목을 web_fetch rate limit 해제 후 라이브 페이지로 파라미터 세부 재확인.
- [ ] 사용자 로컬(Windows)에서 `npm run package` 1회 실행해 재검증 후 새 VSIX 재설치. ※ 2026-07-03: 샌드박스 검증 완료, `dist/gpl-language-support-0.6.24.vsix` 생성됨(§1-C).
- [ ] §2 `isOrgCompleted` 대입 방식 확정 후 코드 수정 → MergeCode 재컴파일로 `-742` 해소 확인.
- [ ] F5/Build Only 경로도 **로컬 매니페스트(파일별 mtime/크기 또는 해시) 기반 차등 업로드** 도입 검토(현재 SIZE 왕복 N회 + 크기충돌 누락 위험). 제어기 FTP의 `MDTM` 지원 여부는 환경 확인 필요 → 안전하게 로컬 mtime/해시 기반 권장. ※ 부분 반영: §1-I에서 F5/수동 Quick Compile은 `/GPL` 미러(원격 목록 조회 + 크기 비교, 원격 전용 삭제)로 전환됨. 남은 것은 크기충돌을 없앨 mtime/해시 강화.
- [ ] 정의 찾기: 클래스 멤버 스코프 해석(`obj.member`를 obj의 클래스 한정으로) 정확도는 추후 보강 여지. ※ 오버로드 해석(인자 개수+타입, 동점 peek)은 2026-07-13 §1-K에서 구현 완료.
- [ ] (§1-P → §1-U에서 일부 완료) 실기기 검증: 1402 수동 검증으로 객체 덤프 형식 확인·분류 버그 수정(2026-07-22, §1-U). **남은 것(VSIX 재설치 후)**: Variables/hover/Watch에서 객체 트리 확장 UI 확인, 로컬 배열 펼침(30개 상한), 중첩 객체(`cmdResponse`), setVariable, Globals 패널 배열/객체 표시. 배열 확장 지연 크면 `ARRAY_EXPAND_MAX` 조정.
- [ ] (2026-07-16, §1-Q) 자체 검토 세션 변경분 — 로컬 `npm run compile` && `npm test` 후 §1-Q 실기기 검증 체크리스트 수행.
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
