# Copilot instructions (GPL Language Support)

## ⛔ 절대 금지 — 읽지 않으면 시작하지 말 것

> 아래 규칙은 반복적으로 위반되어 명시된 것들이다. 이유 불문 예외 없음.

| 금지 행위 | 이유 |
|-----------|------|
| `npm run dev:install` / `dev:cycle:open` / `dev:host` 실행 | VS Code 새 창이 열려 사용자에게 매우 불편. **수십 번 지적됨** |
| VSIX 설치 명령 실행 (`code --install-extension` 등) | 동일. **설치는 사용자가 직접 한다** |
| 워크스페이스에 파일 자동 생성 (로그·캐시·상태 파일 등) | GPL과 무관한 작업 중에도 파일이 생성됨 |
| `activationEvents`에 `"onDebug"` 같은 광범위한 이벤트 추가 | Python/JS 등 무관한 디버그 세션에서 확장이 활성화됨 |
| `Promise.all([sendCommand(...), sendCommand(...)])` | 제어기는 동시 TCP 요청을 처리하지 못함 |
| `socket.destroy()` 로 1403 소켓 종료 | RST 전송 → 제어기 TCP 스택 오염 → 데이터 유실 |

**빌드 후 할 일**: `npm run dev:cycle` 실행 → VSIX 파일 경로만 알려주기. 끝.

---

## 프로젝트 개요

- **VS Code 언어 확장** (Language Support + DAP Debugger). 진입점: `src/extension.ts`
- GPL (Guidance Programming Language) = Brooks Automation 로봇 제어 언어, VB.NET 유사 문법
- **아키텍처**: `SymbolCache` → `GPLParser` → `providers/*` → 9개 Language Provider + Controller 통신 + DAP 디버거
- `docs/` 폴더는 **GPL 로봇 프로젝트**(Test_robot) 문서. VS Code 확장 코드와 별개
- 구문 강조: `syntaxes/gpl.tmGrammar.json`은 VB.NET 내장 문법(`source.asp.vb.net`)을 **그대로 재사용** — 커스텀 패턴 추가 불필요
- 자동화 스크립트: `scripts/` — 버전 범프, 클린, 패키징, 릴리즈 체크 ([릴리즈 절차](docs/releases/process.md), [빠른 가이드](docs/releases/quick-guide.md))

## 설계 원칙 (CRITICAL — 반드시 준수)

> GPL 확장은 **GPL 작업 전용 도구**다. VS Code는 GPL 개발 외에도 다양한 용도로 사용된다.
> 확장이 GPL과 무관한 상황에서 리소스를 쓰거나 파일을 생성하는 것은 **절대 허용하지 않는다**.

### 1. 최소 활성화 원칙

- 확장은 GPL 파일(`.gpl`/`.gpo`)이 실제로 열리거나, GPL 명령/디버거가 명시적으로 사용될 때만 깨어나야 한다
- `activationEvents`에 `"onDebug"` 같이 **모든 디버그 세션에서 활성화되는 광범위한 이벤트를 사용하지 말 것**
  - ✅ `"onDebugResolve:brooks-gpl"` — GPL 디버거 전용
  - ❌ `"onDebug"` — Python/JS/기타 디버그 세션에서도 확장을 깨움
- GPL과 무관한 워크스페이스에서는 확장이 **존재감 없이** 완전히 조용해야 한다

### 2. 디스크 쓰기 금지 원칙

- 확장이 자동으로 파일을 생성/수정하는 것을 **원칙적으로 금지**한다
- 로그, 캐시, 상태 파일 등 어떤 형태로든 **사용자 워크스페이스에 파일을 쓰지 말 것**
  - ❌ `.vscode/gpl-debug.log` 같은 자동 생성 로그 파일
  - ✅ 메모리 내 버퍼 (원형 큐 등) 로 최근 상태 유지
- AI 연동이 필요하면 `vscode.lm.registerTool`로 on-demand 제공 — 파일 기반 우회 금지

### 3. 리소스 절약 원칙

- 폴링, 파일 감시, 소켓 연결 등은 **GPL 세션이 활성화된 동안에만** 동작해야 한다
- 확장이 idle 상태일 때 백그라운드 작업이 돌아서는 안 된다

---

## 핵심 규칙 (CRITICAL)

### 파일 식별

VS Code가 `*.gpl`을 `languageId: 'vb'`로 열 수 있으므로, **확장자 기반 체크를 반드시 병행**:

```typescript
// ❌ document.languageId === 'gpl' 만 쓰지 말 것
// ✅ isGplDocument() 사용 (확장자 .gpl/.gpo 체크)
```

### 버전 관리 (반드시 준수)

**코드를 수정할 때마다** `package.json`의 `version`을 반드시 올려야 한다.

- 버전은 **`package.json`에서 단일 관리** → `config.ts`의 `EXTENSION_VERSION`이 `require('../package.json').version`으로 자동 로드
- 프로바이더별 `PROVIDER_VERSION` 상수는 **제거됨** (v0.2.21~). 개별 파일에 버전 상수를 만들지 말 것
- **형식**: `X.Y.Z` 또는 `X.Y.Z-짧은설명` — patch(Z) +1
- 상세: [docs/development/version-management.md](docs/development/version-management.md)

### 명명 규칙

- Function/Sub 이름은 **PascalCase** (`AgingMacroStart` ✅, `agingMacroStart` ❌)
- 생성자 `Sub New(...)`는 예외

### 대소문자 처리

GPL/VB.NET은 **대소문자 무시 언어**이므로 심볼 이름 비교 시 반드시 `ciEq()` 사용:

```typescript
// ❌ s.name === symbolName
// ✅ ciEq(s.name, symbolName)  // config.ts의 ciEq 함수
```

## 제어기 통신 — 핵심 함정 (CRITICAL)

### `sendCommand` resolve ≠ 성공

`controllerConnection.ts`의 `sendCommand()`는 **`</STATUS>` 수신 시 항상 resolve**한다. STATUS 코드가 에러(-745 등)여도 reject하지 않는다. reject되는 경우: 타임아웃, 소켓 에러, 응답 없이 close — **네트워크 레벨 실패만**.

```typescript
// ❌ catch로 제어기 에러를 감지하려 하지 말 것 — sendCommand는 에러 STATUS도 resolve
try { await sendCommand('Compile X'); } catch { /* 네트워크 에러만 여기 옴 */ }

// ✅ resolve된 응답의 STATUS를 반드시 검사
const resp = await sendCommand('Compile X', cfg);
if (!isSuccess(resp)) {
    const errors = parseCompileErrors(resp);
    const status = parseStatus(resp);  // { code, message, raw }
}
```

### 에러 핸들링 3단계

| 함수 | 용도 | 실패 시 |
|------|------|---------|
| `sendCommand()` | 결과가 중요한 명령 (배포/컴파일) | reject (네트워크) 또는 resolve (에러 STATUS) |
| `trySendCommand()` | best-effort 명령 (폴링/상태 조회) | `null` 반환 |
| `_sendCmd()` (디버그) | DAP 세션 내 명령 직렬화 | `null` 반환, 에러 삼킴 |

### TCP 직렬화

제어기는 **동시 TCP 요청을 처리하지 못한다**. 명령을 반드시 순차적으로 보낼 것:
- 디버그 세션: `_enqueueCommand()`로 큐 직렬화
- 사이드바 TreeView: 순차 await
- **절대 `Promise.all([sendCommand(...), sendCommand(...)])`을 쓰지 말 것**

### 고정 포트 (하드웨어 결정, 변경 불가)

| 포트 | 프로토콜 | 용도 | 모듈 |
|------|----------|------|------|
| 1402 | TCP | 명령 송수신 | `controllerConnection.ts` |
| 1403 | TCP | 런타임 콘솔 이벤트 배치 수신 | `runtimeConsole.ts` |
| 21 | FTP | 프로젝트 업로드/다운로드 | `ftpClient.ts` (anonymous 접속) |
| 51417 | UDP | 제어기 자동 검색 브로드캐스트 | `controllerDiscovery.ts` |

## 프로젝트 동작 요약

- **인덱싱**: `Project.gpr`이 있으면 `ProjectSource="..."` 파일만 우선 인덱싱. 없으면 `**/*.gpl` 전체 스캔
- **생성자**: `New ClassName(...)` → `Sub New` 정의로 점프. 인자 수로 오버로드 구분
- **참조 검색**: Qualified(`Module.Member`) → 전체 스캔 / Unqualified → 스코프에 따라 범위 제한
- **파싱 스코프**: `blockDepth > 0`인 로컬 변수는 워크스페이스 심볼에서 제외
- **진단**: `diagnosticProvider.ts` — **현재 비활성화** (`DIAGNOSTICS_DISABLED = true`). 검증 완료 후 플래그를 `false`로 변경하여 활성화

### 디버그 어댑터

- **DAP Inline Implementation** — extension 프로세스 내에서 실행, 별도 프로세스 없음
- **Attach-only** (Launch 미지원). Debug type: `'brooks-gpl'`
- `deployBeforeAttach: true` → Attach 전 자동 `deploy(skipStart: true)` 실행
- `stopOnEntry` → `Start projectName -break -bex`로 첫 줄 정지
- 폴링 간격: 디버거 최대 500ms, 사이드바 5000ms
- 5회 연속 폴 실패 → 자동 세션 종료

### 1403 이벤트 배치 프로토콜 (`runtimeConsole.ts`)

1403 포트는 **지속 스트리밍이 아닌 이벤트 배치 모드**로 동작한다 (TCP 테스트로 확정):
- 연결 → 제어기가 큐에 쌓인 이벤트를 전달 → **FIN** (정상 종료)
- FIN 후 **즉시 재연결** (100ms) → 다음 이벤트 배치 대기
- 이벤트 없으면 연결 유지 (대기 상태)

이벤트 포맷: `<E>type,source<L>level</L>message</E>`
- type 1 = 쓰레드 상태 변경 (`<E>1,0</E>`, `<E>1,1</E>` 등)
- type 3 = 콘솔 출력 (`<E>3,GPL_Code<L>52</L>메시지</E>`)

**재연결 전략 (2단계)**:
- **데이터 수신 + FIN** → 즉시 재연결 (`RECONNECT_IMMEDIATE_MS = 100`), 카운터 리셋
- **에러/빈 세션** → 지수 백오프 (2초 → 4초 → ... → 최대 30초, 최대 10회)
- `_explicitStop` = 사용자 `stop()` 호출 시 자동 재연결 차단

**⚠ RST 금지 (CRITICAL)**: 소켓 종료 시 반드시 `socket.end()` (FIN) 사용.
`socket.destroy()`는 RST를 보내며 제어기 내장 TCP 스택이 1403 서비스를 오염시켜 후속 연결에서 데이터 유실을 유발한다.

## 변경 시 규칙

- ✅ TypeScript는 `src/`만 수정. `out/`은 빌드 산출물
- ✅ `*.gpl` 판별은 확장자 기반 (`isGplDocument()`)
- ❌ `document.languageId`만 쓰지 말 것
- ❌ `test_parser.js`, `test_1403_manual.js` 등 루트 테스트 파일은 수동 검증용. 자동화 테스트 프레임워크 없음

### 외부 패키지 활용 원칙

- 검증된 npm 패키지가 존재하면 **직접 구현보다 패키지 사용을 우선**한다
- 예: FTP → `basic-ftp`, TCP → Node.js `net` (내장), XML → `fast-xml-parser` 등
- 새 패키지 도입 시 기준: 유지보수 활발 · 의존성 적음 · VS Code 확장 번들에 적합한 크기
- 이미 `package.json`에 있는 패키지의 기능을 중복 구현하지 말 것

### 응답 파싱 원칙

제어기 응답 파싱은 **`responseParser.ts` 한 곳에서만** 수행한다:
- `parseStatus()`, `parseCompileErrors()`, `parseThreadList()`, `normalizeConsoleLine()` 등
- 새 파싱 로직이 필요하면 이 파일에 추가. 프로바이더나 서비스에서 직접 파싱하지 말 것

## 개발 워크플로

```bash
npm run compile       # TypeScript → out/
npm run dev:cycle     # compile → VSIX package (이것만 실행)
npm run package       # VSIX만 생성
```

- VSIX 생성 후: 경로(`dist/gpl-language-support-x.x.x.vsix`) 안내만. 설치는 사용자가 직접.
- 디버그: F5 → Extension Development Host → Output 패널 "GPL Language Support"
- 로그 활성화: `"gpl.trace.server": "verbose"`
- OutputChannel 3개: `GPL Language Support` (메인), `GPL Console` (런타임), `GPL Traffic` (TCP 트래픽)
- `.vscodeignore`: `src/`, `scripts/`, `docs/`, `*.js.map` 등은 VSIX에서 제외됨

### 설정 키 (`gpl.*`)

| 키 | 기본값 | 설명 |
|---|---|---|
| `trace.server` | `off` | 로그 레벨 (`off` / `messages` / `verbose`) |
| `controller.ip` | `192.168.0.2` | 제어기 IP |
| `controller.port` | `1402` | 명령 포트 |
| `controller.consolePort` | `1403` | 콘솔 이벤트 포트 |
| `controller.timeoutMs` | `10000` | 명령 타임아웃 (ms) |
| `controller.ftpBasePath` | `/GPL` | FTP 루트 경로 |
| `controller.threadPollIntervalMs` | `5000` | 쓰레드 폴링 간격 (ms) |

## 파일 구조

```
src/
  extension.ts              # 진입점, 명령 등록, 모듈 배선
  gplParser.ts              # VB/GPL 파서
  symbolCache.ts            # 심볼 인덱싱, Project.gpr 최적화
  config.ts                 # Settings, isGplDocument(), ciEq(), EXTENSION_VERSION
  gplBuiltins.ts            # GPL 내장 함수 데이터베이스 (시그니처, 설명, 스니펫)
  xmlUtils.ts               # XML 인코딩 분석 유틸
  providers/
    definitionProvider.ts    # Go to Definition
    referenceProvider.ts     # Find All References
    completionProvider.ts    # IntelliSense
    hoverProvider.ts         # 호버 (심볼 정보 + 내장 함수 시그니처)
    diagnosticProvider.ts    # 진단 (현재 비활성화)
    codeActionProvider.ts    # Quick Fix
    documentSymbolProvider.ts # Outline
    workspaceSymbolProvider.ts # Ctrl+T
    foldingRangeProvider.ts  # 폴딩
  controller/
    controllerConnection.ts  # TCP 명령 송수신 (포트 1402)
    responseParser.ts        # 응답 파싱 — 모든 파싱의 단일 지점
    ftpClient.ts             # FTP 업/다운로드 (포트 21, basic-ftp)
    deployService.ts         # 배포 워크플로 (STOP→UPLOAD→COMPILE→START)
    runtimeConsole.ts        # 런타임 콘솔 이벤트 배치 수신 (포트 1403)
    controllerDiscovery.ts   # UDP 브로드캐스트 제어기 검색 (포트 51417)
  debug/
    activateDebug.ts         # DAP 등록 (DebugAdapterInlineImplementation)
    gplDebugSession.ts       # 디버그 세션 (attach-only, 명령 직렬화)
  views/
    controllerTreeProvider.ts # 통합 사이드바 (연결·쓰레드·FTP·시스템·에러)
    threadTreeProvider.ts    # 레거시 쓰레드 패널
    connectionStatusBar.ts   # 하단 상태바 연결 표시
syntaxes/gpl.tmGrammar.json # 구문 강조 (VB.NET 문법 재사용)
scripts/                     # 빌드 자동화 (bump-version, clean, package 등)
docs/                        # GPL 로봇 프로젝트(Test_robot) 문서 — 확장 코드와 별개
```
