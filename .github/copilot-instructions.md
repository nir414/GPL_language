# Copilot instructions (GPL Language Support)

## 프로젝트 개요

- 이 저장소는 **VS Code 언어 확장**입니다. 진입점은 `src/extension.ts`
- GPL (Guidance Programming Language)은 Brooks Automation의 로봇 제어 언어로, VB.NET 유사 문법을 사용
- **아키텍처**: `SymbolCache` → `GPLParser` → `providers/*`
  - `SymbolCache`: 워크스페이스의 `**/*.gpl`/`**/*.gpo` 파일을 인덱싱
  - `GPLParser.parseDocument()`: VB/GPL 문법을 파싱해서 심볼(Module/Class/Function/Sub/Variable)로 변환
  - `providers/*`: 정의/참조/완성/진단/코드액션/심볼/폴딩 등 언어 기능 구현

## 핵심 컨벤션과 패턴 (CRITICAL)

### 파일 식별 (`*.gpl` vs languageId)

```typescript
// ❌ 절대 이렇게만 하지 말 것
if (document.languageId === 'gpl') { ... }

// ✅ 반드시 확장자 기반 체크 병행
function isGplDocument(document: vscode.TextDocument): boolean {
    const fsPath = document.uri.fsPath.toLowerCase();
    return document.uri.scheme === 'file' &&
           (fsPath.endsWith('.gpl') || fsPath.endsWith('.gpo'));
}
```

**이유**: VS Code가 `*.gpl`을 `languageId: 'vb'`로 열 수 있음. `isGplDocument()`를 사용해서 확장자 우선 판별 필요.

### 로그 출력 패턴

```typescript
private log(message: string) {
    if (!isTraceVerbose(vscode.workspace)) return;
    this.outputChannel?.appendLine(message);
}
```

**설정**: `gpl.trace.server` = `off` | `messages` | `verbose` (기본: `off`)  
**Output 채널**: "GPL Language Support"

## 프로젝트 특화 동작 (중요)

### 1. Project.gpr 기반 최적화 인덱싱

`SymbolCache.indexWorkspace()`는 `Project.gpr` 파일이 있으면 `ProjectSource="..."` 엔트리만 우선 인덱싱:

```typescript
// symbolCache.ts의 로직
const projectFiles = await this.getProjectSourcesFromGpr();
if (projectFiles && projectFiles.length > 0) {
  // Project.gpr에 등록된 파일만 인덱싱 (대형 워크스페이스 최적화)
}
```

**파싱 규칙**: XML 형식 `ProjectSource="file.gpl"` 또는 `ProjectSource='file.gpl'`  
**폴백**: `.gpr`이 없거나 비어있으면 `**/*.gpl` glob으로 전체 스캔

### 2. 생성자 감지 로직

VB 스타일 생성자: `Sub New(...)`

```typescript
// definitionProvider.ts의 패턴
// "New ClassName(...)" → `Sub New` 정의로 점프
const constructorPattern = /\bNew\s+(\w+)\s*\(/i;
```

**파라미터 매칭**: 괄호 안 인자 개수를 세어서 오버로드된 생성자 중 선택

### 3. Qualified/Unqualified 참조 우선순위

`referenceProvider.ts`의 핵심 로직:

- **Qualified 호출** (`Module.Member`, `Class.Method`): 모든 파일 스캔
- **Unqualified 호출** (`Foo()`):
  - Public 모듈 멤버 → 워크스페이스 전체 탐색
  - Private/module-level → 같은 파일/모듈 내부만

### 4. 파싱 스코프 제약

`GPLParser`는 `blockDepth`로 로컬 변수를 워크스페이스 심볼에서 제외:

```typescript
// gplParser.ts
let blockDepth = 0;
// Function/Sub 진입 → blockDepth++
// 로컬 Dim 변수 → blockDepth > 0이면 스킵
```

**이유**: 로컬 변수는 파일 내부에서만 유효하므로 워크스페이스 심볼 검색에서 노이즈 제거

### 5. 런타임 기능 감지

최신 VS Code API가 없는 경우 폴백:

```typescript
// referenceProvider.ts
const wsAny: any = vscode.workspace as any;
if (typeof wsAny.findTextInFiles !== "function") {
  // 대체 구현 (파일 직접 스캔)
}
```

**이유**: `@types/vscode` 버전이 `findTextInFiles`를 포함하지 않을 수 있음. 런타임 검사로 안전하게 처리.

## 변경 시 지켜야 할 규칙 (Do / Don't)

- ✅ Do: TypeScript는 `src/`만 수정하세요. `out/`은 빌드 산출물입니다.
- ✅ Do: `*.gpl` 판별은 `isGplDocument()`처럼 확장자 기반 체크가 필요합니다(파일이 `vb`로 열릴 수 있음).
- ❌ Don't: `document.languageId`만 믿지 마세요.

## 개발 워크플로

### 빌드/컴파일

```bash
npm run compile       # TypeScript → out/ (한 번 빌드)
npm run watch        # 파일 변경 감지 자동 빌드
```

**산출물**: `out/extension.js` (패키지가 참조하는 진입점)

### 디버그

1. VS Code에서 **F5** 또는 Run > Start Debugging
2. `.vscode/launch.json`의 "Run GPL Language Extension" 사용
3. 새 창(Extension Development Host)에서 `.gpl` 파일 열어 테스트
4. **Output 패널** → "GPL Language Support" 채널에서 로그 확인
   - 로그 활성화: `.vscode/settings.json`에 `"gpl.trace.server": "verbose"` 추가

### 패키징 (VSIX 생성)

```bash
npm run package      # dist/gpl-language-support-v0.2.10.vsix 생성
```

**설치**: Extensions 뷰 → `...` → Install from VSIX...

### CI/CD

GitHub Actions 워크플로 (`.github/workflows/ci.yml`):

- **Trigger**: main 브랜치 push, PR
- **Job**: Node 20 설치 → `npm ci` → `npm run compile`
- **Lint/Test**: 현재 없음 (컴파일 성공 여부만 검증)

## 진단(Diagnostics) 동작

**제약**: `diagnosticProvider.ts`는 `languageId === 'gpl'`에서만 진단 갱신

- `.gpl`이 `vb`로 열리면 진단 안 뜸
- **해결**: 파일 우측 하단 언어 모드를 "GPL"로 변경

**진단 종류**:

1. **VB.NET 호환성 이슈**: 미지원 함수, Optional 파라미터, On Error, Dictionary/Object 사용
2. **성능 경고**: 반복적 문자열 연결, 비효율적 패턴

## 통합 포인트와 의존성

### VS Code API 사용

- **언어 서비스**: `vscode.languages.register*Provider` (Definition, Reference, Completion, etc.)
- **파일 시스템**: `vscode.workspace.findFiles()`, `vscode.workspace.fs.readFile()`
- **진단**: `vscode.languages.createDiagnosticCollection('gpl')`
- **Output**: `vscode.window.createOutputChannel('GPL Language Support')`

### 외부 의존성

**없음** (devDependencies만):

- `@types/vscode`: VS Code API 타입 정의
- `typescript`: 컴파일러
- `@vscode/vsce`: VSIX 패키징 도구

### Document Selectors

확장이 적용되는 파일:

```typescript
const gplSelectors: vscode.DocumentSelector = [
  { language: "gpl", scheme: "file", pattern: "**/*.gpl" },
  { language: "vb", scheme: "file", pattern: "**/*.gpl" },
  { scheme: "file", pattern: "**/*.gpl" },
  // .gpo도 동일하게 처리 (프로젝트 엔트리/라이브러리)
];
```

## 파일 구조 요약

```
src/
  extension.ts           # 진입점, 프로바이더 등록, 커맨드 바인딩
  gplParser.ts           # VB/GPL 문법 파서 (Module/Class/Function/Sub/Variable)
  symbolCache.ts         # 워크스페이스 심볼 인덱싱, Project.gpr 최적화
  config.ts              # Settings 읽기 (gpl.trace.server)
  providers/
    definitionProvider.ts    # Go to Definition, 생성자 감지
    referenceProvider.ts     # Find All References, qualified/unqualified 처리
    completionProvider.ts    # IntelliSense
    diagnosticProvider.ts    # VB.NET 호환성 + 성능 이슈
    codeActionProvider.ts    # Quick Fix 제안
    documentSymbolProvider.ts # Outline 뷰
    workspaceSymbolProvider.ts # Ctrl+T 심볼 검색
    foldingRangeProvider.ts  # 코드 폴딩

syntaxes/
  gpl.tmGrammar.json     # TextMate 문법 (구문 강조)

language-configuration.json # 괄호 매칭, 주석 토글, 자동 인덴트

package.json             # 확장 매니페스트, 기여점(commands, languages, grammars)
tsconfig.json            # TypeScript 설정
```

## 자주 묻는 질문

**Q**: "Go to Definition"이 클래스 선언 대신 생성자로 가는데?  
**A**: `New ClassName(...)` 패턴에서 의도된 동작. 클래스 선언으로 가려면 `ClassName` 부분을 `New` 없이 참조.

**Q**: 참조 검색이 같은 폴더 파일을 못 찾아요.  
**A**: 워크스페이스 밖에서 연 파일은 폴백 스캔(최대 200개)을 시도. 워크스페이스로 열면 전체 탐색 가능.

**Q**: 심볼 캐시가 오래된 것 같아요.  
**A**: Command Palette → "GPL: Refresh Symbols" 실행. 또는 `gpl.debugSymbolCache` 명령으로 캐시 상태 확인.

**Q**: `.gpo` 파일은 무엇인가요?  
**A**: GPL 프로젝트의 엔트리 포인트나 라이브러리. 참조 검색에 포함됨.
