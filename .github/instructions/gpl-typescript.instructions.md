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

## GPL 수식어(Modifier) 조합 — 공식 문법 기준

GPL Dictionary 기준 각 선언문 앞에 올 수 있는 수식어 (대소문자 무관):

| 선언문 | 허용 수식어 |
|--------|------------|
| `Class class_name` | `Public` \| `Private` |
| `Module module_name` | 없음 |
| `Sub name(...)` | `Public` \| `Private` \| `Shared` |
| `Function name(...) As type` | `Public` \| `Private` \| `Shared` |
| `Property name(...) As type` | `Public` \| `Private` \| `Shared` \| `ReadOnly` \| `WriteOnly` |
| 모듈 수준 변수 | `Public` \| `Private` \| `Dim` \| `Static` \| `Const` |
| 매개변수 전달 방식 | `ByVal` \| `ByRef` |

- `Shared`는 클래스 내부에서만 유효하다.
- `ReadOnly` / `WriteOnly`는 `Property`에서만 유효하다.
- 수식어는 두 개까지 조합 가능하다 (예: `Public Shared`, `Private ReadOnly`).
- 기본 접근은 `Private`이다 (명시 없을 때).

## tmGrammar 패턴 작성 규칙

`syntaxes/gpl.tmGrammar.json`에 선언문 패턴 추가 시 반드시 지킬 규칙:

1. **줄 시작 앵커(`^`) 사용 금지** — 수식어가 앞에 오면 매칭이 깨짐
2. **`\s*\b` 사용하여 VB.NET 패턴과 경쟁 우위 확보**
   - VS Code TextMate 엔진은 **가장 먼저 시작하는 패턴**을 우선함
   - 내장 VB.NET 문법(`source.asp.vb.net`)의 `storage.type.asp` 패턴은 이미 `(?i:\\s*\\b(Call|Class|...)\\b\\s*)`로 동작 중
   - 우리 GPL 패턴이 `\\b(Class)` 만 써서는 위치(position)가 더 뒤이므로 패배함
   - **수정: `\\s*\\b(Class)` 사용** → 동일 위치에서 먼저 선언된 우리 패턴이 우선 적용
3. **수식어를 직접 캡처하지 않음** — `source.asp.vb.net` 위임이 `Public`/`Private`/`Shared` 등
   키워드 색상을 별도 처리하므로, GPL 전용 패턴은 핵심 키워드 + 이름만 캡처
4. **패턴 순서** — GPL 전용 패턴은 `{ "include": "source.asp.vb.net" }` 보다 앞에 배치

```json
// ✅ 올바른 예 — \s*\b로 VB.NET 패턴과 경쟁에서 우선
{ "match": "(?i)\\s*\\b(Class)\\s+([A-Za-z_]\\w*)", "captures": { "1": {...}, "2": {...} } }

// ❌ 잘못된 예 1 — \b만 사용하면 위치가 더 뒤라 VB.NET 패턴에 패배
{ "match": "(?i)\\b(Class)\\s+([A-Za-z_]\\w*)", "captures": { ... } }

// ❌ 잘못된 예 2 — ^ 앵커 사용 시 "Public Class Foo" 미매칭
{ "match": "(?i)^(Class)\\s+([A-Za-z_]\\w*)", "captures": { ... } }
```

**TextMate 패턴 경쟁 원리:**
- 매칭 위치가 더 앞인 패턴이 이김
- 위치가 같으면 배열 내 먼저 선언된 패턴이 이김
- 이미 매칭된 영역은 다른 패턴이 덮어쓸 수 없음

## 변경 후 확인

- 코드 수정 시 `package.json` 버전 patch +1
- `README.md` 현재 버전과 동기화
- `npm run pre-release-check`
- `npm run compile`

## 작업 중 발견한 문제 → 즉시 수정

패턴 작성 후 테스트 시 다음 증상이 보이면 즉시 원인 분석 → 수정 → 재패키징:

| 증상 | 원인 | 해결책 |
|------|------|--------|
| `[수식어] 키워드` 형태에서 이름 부분이 무색 | VB.NET 문법이 키워드 선점 (위치가 더 앞) | 패턴에 `\s*` 접두 추가로 동일 위치 확보 |
| `[수식어] 키워드` 형태 자체가 매칭 안 됨 | `^` 앵커나 `\b` 조합이 수식어를 배제 | `\s*` 추가하거나 앵커 제거 |
| 특정 수식어 조합만 색상 안 됨 (예: `Private Shared Class`) | 패턴이 단일 수식어 후만 봄 | 선택적 수식어를 2개까지 커버하도록 확장 |

**디버깅 프로세스:**
1. Output/Debug Console 확인 → 확장 로그에서 심볼 탐지 및 스코프 정보 수집
2. VS Code 개발자 도구 (F12) → "Developer: Inspect Editor Tokens and Scopes" 실행
3. 문제 라인에서 토큰 스코프 확인 → VB.NET 문법과 GPL 패턴의 경쟁 상태 파악
4. 패턴 수정 후 확장 재로드 (Ctrl+Shift+P "Developer: Reload Window") → 즉시 검증
5. 검증 완료 후 버전 bump → VSIX 패키징
