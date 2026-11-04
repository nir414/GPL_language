# AGENTS.md — AI 작업자 공통 지침

VS Code 확장 **`nir414.gpl-language-support`** — Brooks/Precise Automation의 GPL(Guidance
Programming Language) 언어 지원(IntelliSense, 정의 이동, 개요, 진단)과 PA 제어기 연동
(명령 콘솔 1402 / 런타임 콘솔 1403 / FTP 배포, 디버그 어댑터)을 제공한다.

> **이 파일이 AI 작업 지침의 정본이다.** Codex·Copilot은 이 파일을 직접 읽고, Claude Code는 `CLAUDE.md`가
> 이 파일을 import 한다. 다른 지침 파일(`CLAUDE.md`, `.github/copilot-instructions.md`, `.github/instructions/*`)은
> 이 내용을 복사하지 않고 도구 전용 사항과 경로별 세부 규칙만 둔다. 규칙을 고칠 때는 여기 한 곳을 고친다.

## 1. 처음 왔다면 이 순서로 읽는다

1. 이 파일.
2. **`docs/ai-handoff.md`의 헤더·§0·§2·§3** — 하드 규칙 상세, 사용자 결정 대기, 다음 할 일. §4(핵심 파일)는 필요할 때,
   §1 세션 이력은 특정 결정의 배경을 찾을 때만 본다.
3. 작업 종류별 정본:

| 작업 | 정본 |
| --- | --- |
| 제어기 조작·디버깅 (하드 규칙) | `.github/instructions/gpl-ai-controller-debugging.instructions.md` |
| 제어기 조작·디버깅 (절차·Command ID·STATUS 판단표) | `docs/development/ai-controller-debugging-runbook.md` |
| 제어기 통신 코드 (`src/controller`·`debug`·`views`) | `.github/instructions/gpl-controller.instructions.md` |
| 언어 기능·TextMate 문법 코드 | `.github/instructions/gpl-typescript.instructions.md` |
| 구조·계층·파일 배치 | `docs/development/architecture.md` (§2.4 성장 규칙, `npm test`의 구조 테스트가 강제) |
| 버전·패키징·릴리스 | `docs/releases/process.md` |
| 작업 기록(ai-handoff·CHANGELOG) 관리 | `docs/development/record-keeping.md` |

## 2. 자주 쓰는 명령

- `npm run compile` — 이전 JS·소스맵 정리 후 TypeScript 컴파일 (`out/`)
- `npm test` — 컴파일 + 단위·구조 테스트
- `npm run pre-release-check` — 릴리스 전 정합성 검사 (README 버전 표기 금지 등)
- `npm run package` — patch 버전 bump + VSIX 패키징 (`dist/gpl-language-support-<ver>.vsix`, 실패 시 버전 자동 롤백)
- `npm run package:no-bump` — 버전 그대로 패키징
- **F5 "Run Extension"** — 전용 프로필 `GPL-DevHost`(기본 설정·다른 확장 없음)로 Extension Development Host를
  띄워 `samples/hello-project`를 연다. `npm run dev:host`는 같은 창을 디버거 없이 여는 것이다. VS Code 창을 열거나
  VSIX를 설치하는 명령은 **사용자가 요청할 때만** 실행한다(사용자 화면과 설치 상태를 바꾸므로).

## 3. 작업 방식 (사용자 방침)

- **"검토해서 개선해줘 / 권장 방향으로 / 알아서" 요청은 넓은 위임이다.** 검토 결론을 먼저 짧게 밝히고, 중간 질문 없이
  저위험한 것부터 끝까지 진행해 마지막에 한 번 보고한다. 결과를 크게 바꾸는 선택이나 되돌리기 어려운 동작(제어기 상태 변경,
  삭제, push)만 먼저 확인한다.
- **요청 범위 밖의 파일·설정은 고치지 않고 제안만 한다.** 위임받은 범위 안에서는 끝까지 하고, 범위 밖에서 발견한 문제는 보고와
  `docs/ai-handoff.md` §3에 남긴다.
- **Git** — 커밋은 논리 단위로 묻지 않고 해도 된다. push·태그·GitHub Release는 사용자가 요청할 때만 한다
  (태그 push = Marketplace 자동 게시).
- **같은 저장소에 다른 AI 세션이 동시에 작업한다.** 커밋 직전 `git status`·`git diff --cached`로 자기 변경만 담고, 다른 세션의
  미커밋 파일은 섞지 않는다. 여러 세션이 함께 고치는 파일(`docs/ai-handoff.md`·`CHANGELOG.md`·`package.json`)은 쓰기 직전에
  다시 읽는다. `.git/index.lock` 오류는 `npm run git:unlock`으로 정리한다.
- **근거** — GPL 문법·내장 클래스·콘솔 명령·DataID·오류 코드는 Brooks 공식 문서
  ([GPL Dictionary](https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/intro.htm)와
  형제 섹션)로 확인하고 근거 URL을 남긴다. 문서는 가설이고 실기 응답이 사실이다. 문서 근거는 "문서상"으로 쓰고, 어긋나면 실측을
  따르며 차이를 기록한다. 확장의 동작은 이 저장소 소스를 근거로 설명하고, 사용자가 가리키지 않은 다른 저장소·로봇 프로젝트를
  뒤져 예제를 찾지 않는다.
- **제어기 조작은 확장(또는 확장을 거치는 `gpl-controller` MCP 도구)으로만 한다.** PowerShell·Node·Python으로 1402/1403
  소켓을 직접 열거나 FTP로 직접 올리지 않는다(명령 직렬화와 안전 게이트를 우회한다).
- 저장소에 남은 옛 "절대 금지" 규칙이 표준 도구 사용법을 막고 있으면 우회하지 말고, 원칙 한 줄로 바꾸자고 제안한다.

## 4. 하드 규칙 (상세·근거: `docs/ai-handoff.md` §0 — 번호는 1:1로 같다)

번호는 소스 주석·CI 설정이 "하드 규칙 N"으로 참조하므로 바꾸지 않는다. 새 규칙은 끝에 붙인다.

1. 로그 파일(`Compile.log` 등)을 실시간 상태 채널로 쓰지 않는다 — 판단은 명령 콘솔의 live `<STATUS>`와 런타임 콘솔 스트림으로만.
2. 성공/실패는 그 명령의 `<STATUS>`를 `</STATUS>`까지 읽고 판정한다. 간접 신호로 성공을 추정하지 않는다.
3. 단정하기 전에 live 데이터와 소스를 확인한다.
4. **리눅스 샌드박스(Cowork 등)에서 작업할 때만**: 호스트 도구로 갓 수정한 파일이 샌드박스에서 잘리거나 NUL 패딩으로 보일 수
   있다(반대 방향도 같다). 가짜 문법 오류에 속지 말고, 파일 수정은 샌드박스 bash로 하며, 최종 검증은 Windows의 `npm run compile`.
5. 하위 프로젝트(`controller-mcp` 등)의 `npm install`은 Windows에서만 한다. 리눅스에서 하면 유닉스 심링크가 생겨 Windows
   `vsce package`가 EACCES로 죽는다(`scripts/package.js` preflight가 감지).
6. `Stop`의 STATUS 0은 "정지 요청 접수"이지 정지 완료가 아니다. Compile/Start 전에는 모든 쓰레드가 Idle/Stopped/Error인지
   확인한다(확장은 명령 정책 R2가 정착을 기다린다 — 우회 경로를 만들지 않는다).
7. **`Start`는 스위치 없이는 컴파일하지 않는다 — `-compile`을 반드시 붙인다.** 없으면 `/GPL`에 올린 새 소스가 아니라 직전
   바이너리가 실행된다(2026-09-10 실기 관측). 확장은 `startCommand.buildStartCommand`가 기본으로 붙인다. 그래서 Compile 직후
   Start를 연속으로 보내지 않는다(컴파일 중복). Deploy는 Compile까지, 실행은 `GPL: Start`가 따로 한다.
8. 제어기 채널은 사용자·AI 대면 문구에서 번호가 아니라 이름으로 부른다 — **명령 콘솔**·**런타임 콘솔**·**FTP**
   (정본 `controller/protocol/channelNames.ts`, 구조 테스트 R8). 번호는 설정 값·`ip:port`·진단 상세에서만 덧붙인다.
9. 모션·하드웨어에 영향을 줄 수 있는 변경(자동 `Start`, 브레이크포인트 명령 형식, Step·Jump 등)은 저속/시뮬레이션 검증 없이
   적용하지 않는다(`docs/ai-handoff.md` §3-B).
10. **`/flash/projects`는 비우기·삭제 대상으로 제안조차 하지 않는다.** "flash GPL 비우기"라는 말은 `/GPL`을 뜻한다. flash 영구
    저장(`gpl.saveToFlash`)은 AI가 하지 않는다(확장이 `AI_BLOCKED`로 거부).

## 5. 제품 규칙 (확장이 사용자에게 보이는 방식)

- GPL과 무관한 상황에서는 확장이 존재감을 드러내지 않는다.
- **사용자 작업 공간에 파일을 자동으로 만들지 않는다** — 로그·캐시·상태 파일, AI 설정 파일(`.mcp.json`·`CLAUDE.md`·`AGENTS.md`)
  모두 해당한다. MCP 등록은 사용자 범위에 한 번만 한다(2026-11-04).
- **포커스·패널을 강제로 바꾸지 않는다.** 시작·AI 요청·로그 기록 때 Output 같은 패널을 자동으로 열지 않는다. 로그 기록 자체는
  기본으로 켜 둔다(베타 단계라 분석용, 2026-10-27). AI가 MCP로 한 조작도 사람의 조작처럼 Output에 남긴다.
- **사용자 대면 문구(알림·모달·Output)는 합쇼체로 쓴다.** 반말, `~할 것`·`~하라` 같은 지시투, Output 채널의 마크다운 볼드를
  쓰지 않는다. AI가 읽는 텍스트(MCP 응답·`recovery.detail`)는 지시형 해라체를 써도 된다(2026-09-11).
- AI의 접근을 지침·허용 목록·승인 모달로 막지 않는다. 사고를 막는 조건은 확장이 대기·게이트로 직접 충족시킨다
  (`commandPolicy.ts`). 예외는 되돌릴 수 없는 명령만 담는 `aiCommandPolicy.ts` 차단 목록이다(현재 `gpl.saveToFlash`).
- README에는 버전·변경 이력처럼 자주 바뀌는 내용을 쓰지 않는다(`pre-release-check`가 강제). 순서는 제어기 연동 → 디버깅 →
  상태 → AI → 언어 기능이다.

## 6. 작업을 마칠 때 (세칙: `docs/development/record-keeping.md`)

- **사용자 대면 기능 변경은 요청이 없어도 검증 → 버전 결정 → VSIX 패키징까지 끝낸다.** 사용자가 패키징하지 말라고 할 때만
  생략한다. 버전은 기능 추가를 포함해 **patch(`0.0.x`)가 기본**이고, minor는 사용자가 요청할 때만, 하위 호환을 깨는 major는
  범위와 전환 방법을 먼저 알린다(정본 `docs/releases/process.md`). package/package-lock·CHANGELOG·`docs/ai-handoff.md`의 버전을
  맞추고, VSIX 경로·크기·SHA-256·경고 여부를 보고한다.
- `docs/ai-handoff.md`에 세션 항목(§1-XX: 증상 → 원인 → 조치 → 검증 → 남은 일)과 §1 인덱스 행을 추가하고, 헤더를 직전 세션
  1건으로 바꾼다. 실사용 확인 항목은 `docs/ai-handoff-verification.md`에, 코드 작업·결정 대기는 §3에 둔다.
- 사용자에게 배포한 버전은 `CHANGELOG.md`에 기록한다.
- 새 결정과 정면으로 충돌하는 옛 서술은 지우거나 무효 표시한다. 지금은 틀린 "현재 사실"을 두 개로 남겨 두지 않는다.

## 7. 구조 설계 방향 (정본: `docs/development/architecture.md` §2.4)

기능을 먼저 만들지 말고 **책임의 위치부터 정한다**(사용자 방침 2026-09-18: 책임 분리·SSOT·Semantic API·UI/자동화 분리·
관측 기준 판단·중복 금지·Operation 단위·예외보다 구조 확장). 그 위에 파일 배치 규칙 6개를 둔다(번호는 소스·문서가 참조한다).

1. **두 단계 폴더** — `src/<계층>/<area>/<파일>`. 새 파일은 반드시 기존 area 안에 두고, 새 area가 필요하면
   `architecture.test.ts`의 `LAYER_AREAS`와 architecture.md §2.1 표를 같은 커밋에서 고친다. 저장소 루트에는 도구
   규약(npm·tsc·git·vsce·MkDocs·AI 도구)이 요구하는 파일만 둔다 — 새 폴더는 `assets/`·`docs/`·`scripts/` 안에.
2. **크기 상한은 분해 신호** — 파일 1,000줄 또는 함수/메서드 150줄을 넘기면 architecture.md §7 부채 표에 올리고
   (구조 테스트 R10이 측정해 `SIZE_DEBT`·§7에 없으면 실패한다), 다음 작업에서 "협력자 모듈 + 좁은 io 인터페이스"
   (`debug/session/sessionIo.ts`)나 "단계 모듈 + 컨텍스트 객체"(`controller/deployment/deployContext.ts`)로 나눈다.
   분해는 기능 추가와 섞지 않는다(별도 커밋).
3. **순수 먼저, 접착은 얇게** — 판단·변환·포맷은 vscode·소켓 없는 순수 모듈 + 단위 테스트로 만들고, vscode는
   허용 목록 모듈(R1)에서만 부른다. 새 기능의 첫 커밋은 순수 모듈과 테스트, 둘째가 UI/MCP 배선이다.
4. **옮기고 나누는 변경은 동작 불변을 증명한다** — 분할 전 코드와 새 코드를 같은 입력으로 돌려 비교하는 재생 하네스
   (`scripts/dev/deployReplay.js`·`compareTreeProvider.js`)나 출력 고정 테스트를 먼저 만들고, 차이 0을 확인한 뒤 커밋한다.
   하네스는 지우지 않고 `scripts/dev/`에 남긴다.
5. **상태는 명시적으로** — 플래그 여러 개의 조합으로 상태를 추론하지 말고, 상태 타입 + 전이 함수(순수, 테스트 가능)로 쓴다.
   남아 있는 암묵 상태 머신(`_pollThreadStates`·`runtimeConsole` 재연결)이 다음 분해 대상이다.
6. **문서와 테스트가 규칙의 정본** — 구조 규칙은 architecture.md에 쓰고 architecture.test가 강제한다. 규칙을 바꾸면
   테스트·문서·이 파일의 요약을 같은 커밋에서 맞춘다. 구두 합의만 있는 규칙은 없는 규칙이다.

## 8. 저장소 구조 (요약)

- `src/` — 확장 소스. 계층(util → language → project → controller → debug/views → providers/activation)과
  그 안의 기능별 하위 폴더(area), vscode 의존 허용 목록은 `docs/development/architecture.md`, 핵심 파일 목록은
  `docs/ai-handoff.md` §4. 테스트는 `src/test/`에 src와 같은 폴더 구조로 둔다.
- `assets/` — VSIX에 실리는 정적 자원: `icons/`, `webview/`(대시보드 HTML), `syntaxes/`(TextMate 문법),
  `language-configuration.json`. package.json의 `contributes`·소스의 `extensionUri` 경로가 가리키므로 옮기면 함께 고친다.
- `scripts/` — 빌드/패키징 스크립트(`package.js`: preflight + bump + vsce 실행). `scripts/dev/`는 옮기고 나누는 변경의
  동작 불변을 보이는 재생 하네스(구조 규칙 4).
- `controller-mcp/` — 제어기 구동용 MCP 서버(별도 하위 프로젝트, 번들만 VSIX에 실림).
- `docs/` — 확장의 사용자·개발·레퍼런스 문서(MkDocs, 사이트 빌드는 `dist/site/`)와 AI 인계 문서(`ai-handoff.md`,
  `ai-handoff-verification.md`, `archive/handoff/` — 사이트에서 제외), 외부 프로젝트 요청 수신함(`requests.md`).
- `samples/` — F5 개발 호스트가 여는 예제 GPL 프로젝트(VSIX에 미포함).
- `captures/` — 패킷 캡처 등 분석 자료(git 미추적). `dist/` — VSIX와 문서 사이트(git 미추적).
- 루트에 남은 나머지는 도구 규약상 자리가 고정된 파일이다. 탐색기에서는 `.vscode/settings.json`의 파일 중첩·숨김으로
  접어 보이고, 새 폴더를 루트에 더하기 전에 위 폴더 안에 둘 수 있는지 먼저 본다.
