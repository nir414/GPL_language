# Changelog

All notable changes to the "GPL Language Support" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
