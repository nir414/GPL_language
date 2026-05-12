---
description: "Use when editing GPL Language Support TypeScript source files, providers, parser, symbol cache, or extension wiring. Covers src edits, GPL file detection, naming, symbol matching, parsing boundaries, and dependency reuse."
applyTo: "src/**/*.ts"
---

# GPL TypeScript Source Rules

- TypeScript 수정은 `src/`만 한다. `out/`은 빌드 산출물이므로 직접 수정하지 않는다.
- `*.gpl` / `*.gpo` 판별은 `document.languageId`만 믿지 말고 반드시 `isGplDocument()`를 사용한다.
- GPL/VB.NET 심볼 비교는 대소문자를 무시하므로 반드시 `ciEq()`를 사용한다.
- Function/Sub 이름은 PascalCase를 사용한다. 단, 생성자 `Sub New(...)`는 예외다.
- `docs/`는 GPL 로봇 프로젝트 문서이며 확장 코드와 별개다.
- `test_parser.js`, `test_1403_manual.js` 등 루트 테스트 파일은 수동 검증용으로 취급한다.
- 구문 강조는 `syntaxes/gpl.tmGrammar.json`의 VB.NET 재사용 방식을 유지하고, 불필요한 커스텀 문법 추가를 피한다.
- 새 기능을 직접 구현하기 전에 기존 의존성이나 검증된 npm 패키지 활용 가능성을 먼저 확인한다.

## 파싱/심볼 관련 원칙

- 아키텍처 기본 흐름은 `SymbolCache` → `GPLParser` → `providers/*`이다.
- 로컬 변수처럼 `blockDepth > 0` 범위의 심볼은 워크스페이스 심볼에 노출하지 않는다.
- 생성자 탐색은 `New ClassName(...)` → `Sub New` 연결 규칙을 유지한다.

## 변경 후 확인

- 코드 수정 시 `package.json` 버전 patch +1
- `README.md` 현재 버전과 동기화
- `npm run pre-release-check`
- `npm run compile`
