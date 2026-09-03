# AGENTS.md — AI 작업자 시작 가이드

VS Code 확장 **`nir414.gpl-language-support`** — Brooks/Precise Automation의 GPL(Guidance
Programming Language) 언어 지원(IntelliSense, 정의 이동, 개요, 진단)과 PA 제어기 연동
(1402 명령 콘솔 / 1403 런타임 스트림 / FTP 배포, 디버그 어댑터)을 제공한다.

## 처음 왔다면 이 순서로 읽는다

1. **`docs/ai-handoff.md` — 필독.** 하드 규칙(§0), 세션별 변경 이력(무엇을/왜/어떻게),
   미해결 항목(§2, §3)이 모두 여기에 있다. 다음 할 일도 §3 체크리스트에서 고른다.
2. `.github/instructions/gpl-ai-controller-debugging.instructions.md` — 제어기 디버깅 하드 규칙 상세.
3. 구조는 이 파일의 §저장소 구조 + `docs/ai-handoff.md` §4(핵심 파일), 릴리스/버전 규칙은
   `docs/releases/process.md`, 제어기 디버깅은 `docs/development/ai-controller-debugging-runbook.md`.
   (옛 Test_robot 시절 문서는 저장소 밖 `C:\Users\Doyun\Downloads\test robot\`으로 반출됨 — 2026-08-18, git 이력에는 남아 있음.)

## 자주 쓰는 명령

- `npm run compile` — TypeScript 컴파일 (`out/`)
- `npm run package` — patch 버전 bump + VSIX 패키징 (`dist/gpl-language-support-<ver>.vsix`, 실패 시 버전 자동 롤백)
- `npm run package:no-bump` — 버전 그대로 패키징
- `npm test` — 컴파일 + 테스트

## 하드 규칙 요약 (상세: docs/ai-handoff.md §0)

1. 로그 파일(`Compile.log` 등)을 실시간 상태 채널로 쓰지 않는다 — 판단은 1402 live `<STATUS>`와 1403 스트림으로만.
2. 성공/실패는 해당 명령의 `<STATUS>`를 `</STATUS>`까지 읽고 판정한다. 간접 신호로 성공 추정 금지.
3. 단정 전에 live 데이터/소스를 확인한다.
4. **샌드박스 파일 동기화 함정**: 호스트 도구로 갓 수정한 파일이 샌드박스에서 잘리거나 NUL 패딩으로
   보일 수 있다(반대 방향도 동일). 가짜 문법 오류에 속지 말 것. 파일 수정은 샌드박스 bash
   (heredoc/python)로 하면 양쪽이 일관된다. 최종 검증은 사용자 로컬 `npm run compile`.
5. **하위 프로젝트(`controller-mcp` 등)의 `npm install`은 Windows에서만.** 리눅스에서 실행하면
   유닉스 심링크가 생겨 Windows `vsce package`가 EACCES로 죽는다. `scripts/package.js`의
   preflight가 감지해 주지만, 애초에 만들지 않는 것이 원칙.
6. 모션/하드웨어에 영향 가능한 변경(자동 `Start`, 브레이크포인트 명령 형식 등)은 저속/시뮬레이션
   검증 없이 적용하지 않는다 (`docs/ai-handoff.md` §3-B).
7. **PA 제어기의 `Start`는 자체적으로 Compile을 수행한다**(사용자 실사용 사실 — Brooks 문서와 다름).
   따라서 Compile 직후 Start를 연속으로 보내지 않는다(한 번에 하나만). Deploy는 Compile까지, 실행은
   `GPL: Start` 별도 (`docs/ai-handoff.md` §0.7).

## 작업을 마칠 때 반드시 남길 기록 (기록 규칙)

- **`docs/ai-handoff.md`에 세션 항목 추가**: 날짜 섹션(§1-X 형식)으로 증상 → 원인 → 조치(의도와
  방법) → 검증 → 남은 일을 적는다. 헤더의 "최종 갱신"과 "현재 package 버전"도 갱신한다.
- 해결한 미해결 항목은 §2/§3 체크리스트에서 지우거나 완료 표시하고, 새로 발견한 문제는 추가한다.
- **`docs/ai-handoff.md`가 다시 불어나지 않게 유지한다 (2026-08-31 정리로 3,573줄 → 960줄):**
  - **헤더는 직전 세션 1건만 요약한다.** 이전 요약을 `직전: … 직전: …`으로 이어 붙이지 않는다.
    (그렇게 쌓여 헤더 한 줄이 16,000자가 됐던 것이 정리의 직접 원인이다. 과거 요약의 정본은
    §1 세션 본문과 아카이브이지 헤더가 아니다.)
  - **§1 본문에는 최근 10개 세션만 둔다.** 넘치면 오래된 것부터 `docs/archive/handoff/<YYYY-MM>.md`로
    **원문 그대로** 옮기고, §1 "전체 세션 인덱스" 표에서 그 행의 위치 칸을 아카이브 링크로 바꾼다.
  - 세션을 추가하면 **§1 인덱스 표에도 한 줄 추가**한다(§ 번호 · 날짜 · 주제 · 위치).
  - **§3에서 완료(`[x]`)된 항목은 남기지 않는다.** 기록이 필요하면 해당 월 아카이브의 §부록으로 옮긴다.
  - **섹션 번호(§0·§1-XX·§2·§3·§3-B·§4·§5)는 바꾸지 않는다.** 소스 주석(`deployService.ts` 등),
    이 파일, 런북, `package.json` 설정 설명이 참조한다. 바꿔도 되는 것은 물리적 순서뿐이다.
  - `docs/archive/handoff/`는 ai-handoff.md와 같이 MkDocs 사이트에서 제외된다(`mkdocs.yml`의
    `exclude_docs`). 새 아카이브 파일을 nav에 등재하지 않는다.
- 사용자에게 배포한 버전이 있으면 `CHANGELOG.md`에 항목을 추가한다(형식은 기존 항목 참조).
- **`CHANGELOG.md`는 깔끔하게 유지한다 (혼동 방지):**
  - **내용이 없는 `### Added/Changed/Fixed/Removed` 빈 섹션 헤더를 남기지 않는다.** 템플릿을
    복사하더라도 실제 항목이 없는 섹션 헤더는 삭제한다.
  - 같은 내용이 중복되면 **가장 최신(마지막) 항목만 남기고** 이전 중복은 지운다.
  - 버전 섹션은 **최신이 위로 오도록 내림차순**으로 정렬한다.
  - 단, 각 버전이 실제로 그 버전에서 바뀐 내용을 기록하는 이력이므로, 주제가 겹친다는 이유만으로
    과거 버전 항목 자체를 삭제하지는 않는다(이력 보존).
- **충돌하는 낡은 기록은 지운다.** 옛 항목의 서술이 새 결정과 정면으로 충돌하면(같은 사양·상태·규칙을
  서로 다르게 말해, 나중에 읽는 사람·AI가 어느 쪽이 맞는지 착각할 수 있으면) 낡아 무효가 된 서술은
  지운다(또는 무효 표시 후 최신 항목을 가리킨다). 결정의 흐름(무엇을·왜)은 남기되, 지금은 틀린
  '현재 사실'을 두 개로 남겨 두지 않는다.
- 이 규칙의 목적: **다음 작업자(사람이든 AI든)가 이 파일 → ai-handoff.md 순서로만 읽어도
  전체 맥락과 다음 할 일을 파악할 수 있게 하는 것.**

## 저장소 구조 (요약)

- `src/` — 확장 소스. 핵심 파일 목록은 `docs/ai-handoff.md` §4 참조.
- `scripts/` — 빌드/패키징 스크립트 (`package.js`: preflight + bump + vsce 실행).
- `controller-mcp/` — 제어기 구동용 MCP 서버(별도 하위 프로젝트, VSIX에 미포함).
- `docs/` — 인계 문서(`ai-handoff.md`), 개발 문서(`development/`), 릴리스 절차(`releases/`).
- `captures/` — 패킷 캡처 등 분석 자료(VSIX에 미포함).
- `dist/` — 패키징 산출물 VSIX.

## Imported Claude Cowork project instructions

VScode용 GPL 언어 확장 개발중 입니다
"C:\Users\Doyun\Documents\GitHub\GPL_language" 에서 작업해 주세요

함부로 편집하지 마세요
