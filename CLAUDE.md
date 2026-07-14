# CLAUDE.md — AI 작업자 시작 가이드

VS Code 확장 **`nir414.gpl-language-support`** — Brooks/Precise Automation의 GPL(Guidance
Programming Language) 언어 지원(IntelliSense, 정의 이동, 개요, 진단)과 PA 제어기 연동
(1402 명령 콘솔 / 1403 런타임 스트림 / FTP 배포, 디버그 어댑터)을 제공한다.

## 처음 왔다면 이 순서로 읽는다

1. **`docs/ai-handoff.md` — 필독.** 하드 규칙(§0), 세션별 변경 이력(무엇을/왜/어떻게),
   미해결 항목(§2, §3)이 모두 여기에 있다. 다음 할 일도 §3 체크리스트에서 고른다.
2. `.github/instructions/gpl-ai-controller-debugging.instructions.md` — 제어기 디버깅 하드 규칙 상세.
3. `docs/development/project-structure.md` 외 `docs/development/*` — 구조·워크플로·버전 관리.

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

## 작업을 마칠 때 반드시 남길 기록 (기록 규칙)

- **`docs/ai-handoff.md`에 세션 항목 추가**: 날짜 섹션(§1-X 형식)으로 증상 → 원인 → 조치(의도와
  방법) → 검증 → 남은 일을 적는다. 헤더의 "최종 갱신"과 "현재 package 버전"도 갱신한다.
- 해결한 미해결 항목은 §2/§3 체크리스트에서 지우거나 완료 표시하고, 새로 발견한 문제는 추가한다.
- 사용자에게 배포한 버전이 있으면 `CHANGELOG.md`에 항목을 추가한다(형식은 기존 항목 참조).
- **`CHANGELOG.md`는 깔끔하게 유지한다 (혼동 방지):**
  - **내용이 없는 `### Added/Changed/Fixed/Removed` 빈 섹션 헤더를 남기지 않는다.** 템플릿을
    복사하더라도 실제 항목이 없는 섹션 헤더는 삭제한다.
  - 같은 내용이 중복되면 **가장 최신(마지막) 항목만 남기고** 이전 중복은 지운다.
  - 버전 섹션은 **최신이 위로 오도록 내림차순**으로 정렬한다.
  - 단, 각 버전이 실제로 그 버전에서 바뀐 내용을 기록하는 이력이므로, 주제가 겹친다는 이유만으로
    과거 버전 항목 자체를 삭제하지는 않는다(이력 보존).
- 이 규칙의 목적: **다음 작업자(사람이든 AI든)가 이 파일 → ai-handoff.md 순서로만 읽어도
  전체 맥락과 다음 할 일을 파악할 수 있게 하는 것.**

## 저장소 구조 (요약)

- `src/` — 확장 소스. 핵심 파일 목록은 `docs/ai-handoff.md` §4 참조.
- `scripts/` — 빌드/패키징 스크립트 (`package.js`: preflight + bump + vsce 실행).
- `controller-mcp/` — 제어기 구동용 MCP 서버(별도 하위 프로젝트, VSIX에 미포함).
- `docs/` — 인계 문서(`ai-handoff.md`), 개발 문서(`development/`), 릴리스 절차(`releases/`).
- `captures/` — 패킷 캡처 등 분석 자료(VSIX에 미포함).
- `dist/` — 패키징 산출물 VSIX.
