# Copilot instructions (GPL Language Support)

## 프로젝트 개요

- **VS Code 언어 확장**. 진입점: `src/extension.ts`
- GPL (Guidance Programming Language) = Brooks Automation 로봇 제어 언어, VB.NET 유사 문법
- **아키텍처**: `SymbolCache` → `GPLParser` → `providers/*`

## 핵심 규칙 (CRITICAL)

### 파일 식별

VS Code가 `*.gpl`을 `languageId: 'vb'`로 열 수 있으므로, **확장자 기반 체크를 반드시 병행**:

```typescript
// ❌ document.languageId === 'gpl' 만 쓰지 말 것
// ✅ isGplDocument() 사용 (확장자 .gpl/.gpo 체크)
```

### 프로바이더 버전 관리 (반드시 준수)

**코드를 수정할 때마다** 버전을 반드시 올려야 한다:

1. **`PROVIDER_VERSION`**: 수정한 프로바이더 파일의 버전 상수
2. **`package.json` version**: 확장 전체 버전 (VSIX 파일명에 반영)

두 버전은 **동기화**해서 관리한다 (예: 둘 다 `0.2.14`).

- **형식**: `X.Y.Z` 또는 `X.Y.Z-짧은설명` — patch(Z) +1

### 명명 규칙

- Function/Sub 이름은 **PascalCase** (`AgingMacroStart` ✅, `agingMacroStart` ❌)
- 생성자 `Sub New(...)`는 예외

## 프로젝트 동작 요약

- **인덱싱**: `Project.gpr`이 있으면 `ProjectSource="..."` 파일만 우선 인덱싱. 없으면 `**/*.gpl` 전체 스캔
- **생성자**: `New ClassName(...)` → `Sub New` 정의로 점프. 인자 수로 오버로드 구분
- **참조 검색**: Qualified(`Module.Member`) → 전체 스캔 / Unqualified → 스코프에 따라 범위 제한
- **파싱 스코프**: `blockDepth > 0`인 로컬 변수는 워크스페이스 심볼에서 제외
- **진단 제약**: `diagnosticProvider.ts`는 아직 `languageId === 'gpl'` 의존 (`.gpl`이 `vb`로 열리면 진단 누락 가능)

## 변경 시 규칙

- ✅ TypeScript는 `src/`만 수정. `out/`은 빌드 산출물
- ✅ `*.gpl` 판별은 확장자 기반 (`isGplDocument()`)
- ❌ `document.languageId`만 쓰지 말 것

## 개발 워크플로

```bash
npm run compile       # TypeScript → out/
npm run dev:cycle     # compile → VSIX package (한 번에)
npm run package       # VSIX만 생성
```

- 코드 수정 후 `npm run dev:cycle` 실행 → Extensions 뷰 → Install from VSIX로 설치
- 디버그: F5 → Extension Development Host → Output 패널 "GPL Language Support"
- 로그 활성화: `"gpl.trace.server": "verbose"`
- `code --install-extension` 등 CLI는 새 창을 열 수 있으므로 UI 설치 우선

## 파일 구조

```
src/
  extension.ts              # 진입점
  gplParser.ts              # VB/GPL 파서
  symbolCache.ts            # 심볼 인덱싱, Project.gpr 최적화
  config.ts                 # Settings
  providers/
    definitionProvider.ts    # Go to Definition
    referenceProvider.ts     # Find All References
    completionProvider.ts    # IntelliSense
    diagnosticProvider.ts    # 진단
    codeActionProvider.ts    # Quick Fix
    documentSymbolProvider.ts # Outline
    workspaceSymbolProvider.ts # Ctrl+T
    foldingRangeProvider.ts  # 폴딩
syntaxes/gpl.tmGrammar.json # 구문 강조
```
