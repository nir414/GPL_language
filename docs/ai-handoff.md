# AI 인계 자료 — GPL Language Support 확장 작업 핸드오프

- 최종 갱신: 2026-07-08 (§1-I: 디버그 F5 = /GPL 직접 미러 동기화; 릴리즈 v0.7.0 준비)
- 대상 저장소: `C:\Users\Doyun\Documents\GitHub\GPL_language` (VS Code 확장 `nir414.gpl-language-support`)
- 현재 package 버전: **0.7.0** (§1-I까지 포함, 미커밋 — `v0.7.0` 태그 push 시 CI(release.yml)가 자동 빌드·패키징·릴리즈. 로컬 `npm run compile` 최종 검증 권장)
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

### 배경

호버로 변수 값을 보려면 `editor.hover.delay`(기본 300ms) + 마우스 완전 정지 대기 + 평가 왕복이
겹쳐 체감이 느리다. 사용자 요청: 호버 판정 개선이 어렵다면 "클릭하면 바로 표시"로 대체.

### 조치

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

## 2. 진행 중 / 코드 쪽 미결 (사용자 결정 대기)

- **`ProtocolModule.gpl` 478·480의 `-760 Invalid assignment`**: `isOrgCompleted`는 `RobotModule.gpl:828`에 **`Public ReadOnly Property ... As Boolean`**(읽기 전용)으로 정의됨. 거기에 값을 대입해서 나는 에러. 해결책(택1, 사용자 결정 대기): setter 메서드 추가 / `ReadOnly` 제거 후 `Set` 접근자 추가 / backing 필드 직접 대입.
- (참고) GDE 기준 원래 4개 에러(477 -730, 478 -760, 479 -748, 480 -760)였는데 477/479는 사용자가 정리한 듯, 현재 478/480만 남음.

## 3. 다음에 할 일 (체크리스트)

- [ ] 사용자 로컬(Windows)에서 `npm run package` 1회 실행해 재검증 후 새 VSIX 재설치. ※ 2026-07-03: 샌드박스 검증 완료, `dist/gpl-language-support-0.6.24.vsix` 생성됨(§1-C).
- [ ] §2 `isOrgCompleted` 대입 방식 확정 후 코드 수정 → MergeCode 재컴파일로 `-742` 해소 확인.
- [ ] F5/Build Only 경로도 **로컬 매니페스트(파일별 mtime/크기 또는 해시) 기반 차등 업로드** 도입 검토(현재 SIZE 왕복 N회 + 크기충돌 누락 위험). 제어기 FTP의 `MDTM` 지원 여부는 환경 확인 필요 → 안전하게 로컬 mtime/해시 기반 권장. ※ 부분 반영: §1-I에서 F5/수동 Quick Compile은 `/GPL` 미러(원격 목록 조회 + 크기 비교, 원격 전용 삭제)로 전환됨. 남은 것은 크기충돌을 없앨 mtime/해시 강화.
- [ ] 정의 찾기: 이름 기반 조회(`definitionProvider.findDefinition(word)`)로 ReadOnly 속성은 잡히지만, 클래스 멤버 스코프 해석(`obj.member`를 obj의 클래스 한정으로) 정확도는 추후 보강 여지.
- [ ] 변경분 커밋/배포 및 회귀 확인.

### 3-B. 코드 리뷰 권고 — 미적용(검증/결정 필요)

위 §1-B에서 **안전 항목만** 적용했고, 아래는 영향이 크거나 실측이 필요해 보류함.

#### 컨트롤러/디버그 — 모션·하드웨어 영향 → **저속/시뮬레이션 우선 검증 필수**
- [ ] **B1** `gplDebugSession.ts:412`의 `Set Nobreak ... "file" line`(공백 **있음**)만 나머지 3곳(`:484`/`:500`/set은 `:493`)·GDE 캡처(`Set Break ..."file"22`, **no-space**)와 불일치. 한 헬퍼로 통일 권고(통일 후 실측). 불일치 시 종료 시점 브레이크포인트가 안 지워질 수 있음.
- [ ] **B2** 자동 `Start`(모션 유발 가능: `gplDebugSession.ts:262`/`:359`, `deployService.ts` Phase4)에 확인/저속/시뮬레이션 게이트 또는 `gpl.controller.requireStartConfirmation`(기본 true) 도입.
- [ ] **B3** REPL(`gplDebugSession.ts:955`)·setVariable(`:734`)의 임의 명령에 `consoleCommandClassifier`를 연결해 destructive 확인, 모션 state-changing 확인(현재 분류기는 로그 라벨링에만 사용).
- [ ] **B4/B5** `controllerConnection.ts` idle 기반 완료(`:264`)·close 시 부분버퍼 성공처리(`:296`)로 멀티라인 응답 truncation → 거짓 성공 가능. terminator(`</STATUS>`) 우선 완료로 전환, idle 완료 시 `responseComplete=false` 명시.
- [ ] **B6** `ftpClient.ts` 부분 업로드 롤백 부재 → 임시 원격 dir 업로드 후 rename(원자적) 또는 매니페스트 검증.

#### 언어 정확성 — 문서/실측 확인 필요
- [ ] **A1** `Replace` — 컨트롤러/GDE에서 `string.Replace(...)` 동작 실측. 동작하면 정확 시그니처+sourceUrl로 재등록(`gplBuiltins.ts`의 제거 주석 참고), 아니면 제거 유지.
- [ ] **A5** `gplDictionaryData.ts`의 `Move.WaitForEOM` sourceUrl `Move/waitforoem.htm`(EOM↔OEM 오타 의심) — 올바른 URL 확인 후 정정. 현재는 루트 URL 폴백이라 동작엔 무해.

#### TS 품질 — 안전하나 범위 큼(미적용)
- [ ] `extension.ts`(3000+줄) → `registerLanguageProviders` / `registerControllerCommands` / `registerXmlCommands` 등으로 분리.
- [ ] `diagnosticProvider`의 `DIAGNOSTICS_DISABLED = true` dead code(검출기 ~400줄 + 연동 codeAction) 정리하거나 설정으로 게이팅 후 검증.
- [ ] `symbolCache.findReferences`가 열린 문서만 검사 → 미오픈 파일도 읽도록 보강(또는 ripgrep 경로로 일원화).

## 4. 핵심 파일

```
src/controller/controllerConnection.ts   # sendCommandDetailed, waitForStatusClose
src/controller/deployService.ts          # deploy(), tryCompile, changedFiles/onlyFiles, directGpl(§1-G), Stop 완료 게이트
src/controller/ftpClient.ts              # uploadProject onlyFiles
src/controller/responseParser.ts         # parseStatus, parseCompileErrors
src/debug/gplDebugSession.ts             # attachRequest, _runDeployBeforeAttach, getDebugDeployDiagnostics
src/extension.ts                         # runDeploy, autoOnSave
src/gplParser.ts                         # Property/Sub/Function 파싱 + parseDocument 메모이즈 캐시(§1-B E)
src/gplBuiltins.ts                       # 핵심 빌트인/String 함수 (Trim→메서드, Rnd(seed), Replace 제거, Asc/Chr/… 추가)
src/gplDictionaryData.ts                 # Move/Robot/Location/Profile/.../String 클래스 사전
src/providers/completionProvider.ts      # 정적 항목 캐시, 트리거('.', '&')
src/providers/definitionProvider.ts      # token 확인 + parseDocument 재사용
src/providers/hoverProvider.ts           # token 확인
src/providers/referenceProvider.ts       # scanDocumentText 라인별 스캔(ReDoS 완화)
.github/instructions/gpl-ai-controller-debugging.instructions.md  # 하드 규칙
```

## 5. 참고 — 정상 컴파일 응답 형식 (GDE, verbatim, 2026-06-30)

다음처럼
