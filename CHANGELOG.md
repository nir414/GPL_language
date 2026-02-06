# Changelog

All notable changes to the "GPL Language Support" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.13] - 2026-02-06

### Added

- **릴리즈 자동화 시스템**: GitHub Actions 기반 자동 릴리즈 워크플로
  - `v*.*.*` 태그 푸시 시 자동으로 VSIX 빌드 및 GitHub Release 생성
  - CHANGELOG에서 릴리즈 노트 자동 추출
  - 프리릴리즈 자동 감지 (alpha, beta, rc)
  - package.json 버전과 태그 버전 자동 검증
- **버전 관리 스크립트**: `npm run bump:patch/minor/major` 명령으로 버전 자동 업데이트
  - package.json과 CHANGELOG.md 동시 업데이트
  - 오늘 날짜로 새 버전 섹션 자동 생성
- **릴리즈 전 검증**: `npm run pre-release-check` 명령으로 릴리즈 전 필수 조건 자동 체크
  - Git 상태, 버전 형식, CHANGELOG 존재 여부 등 검증
  - TypeScript 컴파일 테스트
  - 필수 파일 존재 확인
- **CI 개선**: 모든 커밋에서 VSIX 패키징 및 아티팩트 업로드

### Changed

- **README.md**: 동적 배지로 변경, 설치 안내 개선, GitHub Release 링크 직접 제공
- **문서 구조**: 릴리즈 프로세스 상세 가이드 및 빠른 참조 가이드 추가
  - `docs/RELEASE_PROCESS.md`: 전체 릴리즈 체크리스트 및 문제 해결 가이드
  - `docs/QUICK_RELEASE.md`: 3단계 간단 릴리즈 요약본
- **CONTRIBUTING.md**: 릴리즈 섹션 추가

### Fixed

- CHANGELOG 추출 로직 개선 (sed 대신 Node.js 스크립트 사용)
- 버전 범프 스크립트의 CHANGELOG 삽입 위치 계산 개선

## [0.2.12] - 2026-02-06

### Fixed

- **숫자 리터럴 정의 검색 방지**: `setFactoryZero(0)` 같은 코드에서 숫자(`0`, `1`, `100`, `3.14` 등)를 Ctrl+클릭해도 불필요한 심볼 검색이 실행되지 않도록 수정
  - `definitionProvider`: 숫자 리터럴 감지 시 즉시 `undefined` 반환
  - `referenceProvider`: 숫자 리터럴 감지 시 즉시 빈 배열 반환

### Added

- **Enhanced Diagnostics**: Comprehensive VB.NET compatibility checks
  - Added detection for unsupported functions: `Left`, `Right`, `InStrRev`, `Val`, `UBound`, `EndOfStream`
  - Added detection for unsupported types: `Long`, `Int64`, `Decimal`, `Char`, `Date`, `Variant`
  - Performance warning for string concatenation in loops
  - Best practice warnings for `Nothing` comparisons
- **Improved Code Actions**: Quick fixes for common issues
  - `Left()` → `Mid(s, 1, n)` conversion
  - `Right()` → `Mid(s, Len(s) - n + 1)` conversion
  - `Val()` → `CInt()` or `CDbl()` conversion
  - Unsupported type → alternative type suggestions
- **GPL-Specific Snippets**: Production-ready code patterns
  - `try_catch`: Standard exception handling template
  - `thread_lock`: Thread.TestAndSet synchronization pattern
  - `mid_left`, `mid_right`: String manipulation patterns (Left/Right replacements)
  - `instr_pattern`: String search with start index
  - `string_null_check`: Safe Nothing checking
  - `stream_flush`: StreamWriter with Flush pattern
  - `file_read`: StreamReader pattern
  - `cint_safe`: Safe integer conversion with error handling
  - `module_template`, `class_template`: Boilerplate code

### Changed

- All diagnostic messages and code actions now reference GPL documentation
- Diagnostic severity levels adjusted based on impact (Warning vs Information)
- Completion items prioritized: snippets > symbols > keywords

### Documentation

- Aligned extension features with `docs/imported/Test_robot_docs/` guidelines
- Based diagnostics on `GPL_언어_실무_가이드.md`, `COMMON_MISTAKES.md`, `STRING_API_GUIDE.md`
- Snippets follow patterns from `GPL_THREAD_CLASS_SUMMARY.md`, `GPL_NETWORKING_GUIDE.md`

## [0.2.11] - 2026-02-06

### Added

- Complete implementation of all core language service providers
- Definition Provider with constructor detection and qualified/unqualified member access
- Reference Provider with workspace-wide search and scope-aware patterns
- Completion Provider for IntelliSense support
- Document/Workspace Symbol Providers for navigation
- Folding Range Provider for code folding
- Diagnostic Provider for VB.NET compatibility warnings
- Code Action Provider for quick fixes

### Changed

- Fully optimized codebase based on private repository implementation
- Removed all XML-related features as planned
- Improved symbol cache with Project.gpr support
- Enhanced file change watching and diagnostics

## [0.2.10] - 2026-02-06

### Added

- Public 모듈 멤버의 unqualified 호출(`Foo()`)에 대한 워크스페이스 전체 참조 검색 지원
- `Project.gpr` 파일 기반 최적화 인덱싱: `ProjectSource`에 등록된 소스만 우선 인덱싱

### Changed

- 워크스페이스/폴더 폴백 스캔 대상에 `*.gpo` 파일 포함
- 대형 워크스페이스에서 심볼 캐시 스캔 성능 향상

## [0.2.9] - 2025-12-09

### Added

- 워크스페이스 밖에서 연 파일의 동일 폴더 내 `*.gpl` 파일 폴백 스캔 기능
- 폴백 스캔 안전장치: 비재귀 + 최대 200개 파일 제한

### Fixed

- VS Code 워크스페이스 검색에서 제외되는 파일의 "같은 폴더 참조" 누락 완화

## [0.2.8] - 2025-12-08

### Changed

- Function/Sub 키워드 파싱을 토큰 기반으로 개선
- `Shared Public`과 같은 다양한 키워드 순서 조합 지원

### Fixed

- 키워드 순서 변화로 인한 인덱싱 누락 문제 완화
- 참조 검색에서 일부 심볼이 누락되던 문제 해결

## [0.2.7] - 2025-12-07

### Added

- `Shared Public Function/Sub` 순서 지원 추가 (기존: `Public Shared` 순서만 인식)

### Fixed

- 키워드 순서로 인해 인덱싱되지 않던 심볼의 참조 검색 정상화

## [0.2.4] - 2025-11-15

### Added

- GitHub Actions CI 워크플로 추가 (빌드 검증)

### Changed

- `.gitignore` 및 `.vscodeignore` 정비
- README 및 package.json 메타데이터 업데이트
- 공개 배포 준비를 위한 프로젝트 구조 정리

## [0.2.2] - 2025-10-20

### Added

- VB.NET 호환성 진단 기능
  - 미지원 함수 감지 (InputBox, MsgBox, MessageBox.Show 등)
  - Optional 파라미터 사용 체크
  - On Error 구문 감지
  - Dictionary/Object 타입 사용 경고
- 코드 액션: 테스트 코드 삽입, 호환성 대안 제안
- 자동완성 확장: 호환성 대안 제안 포함
- `GPL: Debug Symbol Cache` 명령 추가 (파일별 심볼 목록 및 파싱 상태 확인)

### Improved

- 출력 로그 메시지 개선
- 확장 초기화 메시지 명확화

## [0.1.3] - 2025-09-05

### Improved

- 코드 액션 개선
- 자동완성 기능 향상

## [0.1.2] - 2025-08-15

### Added

- 초기 릴리즈
- Go to Definition (정의 찾기)
- Find All References (참조 찾기)
- IntelliSense (자동완성)
- Document Symbol Provider (문서 구조)
- Workspace Symbol Search (워크스페이스 심볼 검색)
- GPL 구문 강조 (Syntax Highlighting)
- `GPL: Refresh Symbols` 명령

## [0.1.0] - 2025-07-01

### Added

- 프로젝트 초기 설정
- 기본 GPL 언어 파서 구현
- TextMate 문법 정의

---

[0.2.10]: https://github.com/nir414/GPL_language/compare/v0.2.9...v0.2.10
[0.2.9]: https://github.com/nir414/GPL_language/compare/v0.2.8...v0.2.9
[0.2.8]: https://github.com/nir414/GPL_language/compare/v0.2.7...v0.2.8
[0.2.7]: https://github.com/nir414/GPL_language/compare/v0.2.4...v0.2.7
[0.2.4]: https://github.com/nir414/GPL_language/compare/v0.2.2...v0.2.4
[0.2.2]: https://github.com/nir414/GPL_language/compare/v0.1.3...v0.2.2
[0.1.3]: https://github.com/nir414/GPL_language/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/nir414/GPL_language/compare/v0.1.0...v0.1.2
[0.1.0]: https://github.com/nir414/GPL_language/releases/tag/v0.1.0
