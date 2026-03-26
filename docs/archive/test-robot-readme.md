# Test_robot 문서 디렉토리

이 폴더는 GPL 프로젝트의 상세 문서를 포함합니다.

## 문서 구조

### 📂 프로젝트 전반

- **[PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md)**: 전체 모듈 구조, 의존성, 설계 철학
- **[DEVELOPER_HANDOVER.md](DEVELOPER_HANDOVER.md)**: 개발자 인수인계 가이드 (필독)
- **[CONTROLLER_UPLOAD_AUTOMATION.md](CONTROLLER_UPLOAD_AUTOMATION.md)**: 자동 업로드 시스템 가이드
- **[gpl-regex-search.md](gpl-regex-search.md)**: GPL 코드 검색 패턴

### 📂 Project/ - 실무 가이드

#### 필수 가이드

- **[COMMON_MISTAKES.md](Project/COMMON_MISTAKES.md)**: GPL 개발 시 흔한 실수와 해결책 (필독)
- **[ERROR_HANDLING_GUIDE.md](Project/ERROR_HANDLING_GUIDE.md)**: 표준 에러 처리 패턴
- **[GPL*언어*실무\_가이드.md](Project/GPL_언어_실무_가이드.md)**: GPL 언어 실무 가이드

#### 기술 가이드

- **[FILE_IO_IMPLEMENTATION.md](Project/FILE_IO_IMPLEMENTATION.md)**: 파일 I/O 구현 상세
- **[GPL_THREAD_SAFETY.md](Project/GPL_THREAD_SAFETY.md)**: 스레드 안전성 가이드
- **[STRING_API_GUIDE.md](Project/STRING_API_GUIDE.md)**: 문자열 처리 API
- **[GPL*데이터타입*상수\_정리.md](Project/GPL_데이터타입_상수_정리.md)**: 데이터 타입 정리
- **[GPL_DICTIONARY_GUIDE.md](Project/GPL_DICTIONARY_GUIDE.md)**: 공식 레퍼런스 인덱스 + URL 변환 규칙

#### 참고 문서

- **[GPL_THREAD_CLASS_SUMMARY.md](Project/GPL_THREAD_CLASS_SUMMARY.md)**: Thread 클래스 요약
- **[VERSION_MANAGEMENT.md](Project/VERSION_MANAGEMENT.md)**: 버전 관리 시스템
- **[INCIDENTS.md](Project/INCIDENTS.md)**: 주요 이슈 및 해결 이력
- **[Project/History](Project/History/)**: 세션/리뷰 기록(아카이브)

### 📂 XML/JSON 문서

- XML/JSON 관련 문서는 현재 이 디렉터리에는 포함되어 있지 않습니다.
- 필요 시 상위 `docs/` 경로의 XML/JSON 문서를 참조하세요.

## 추천 읽기 순서

### 신규 개발자

1. [DEVELOPER_HANDOVER.md](DEVELOPER_HANDOVER.md) - 전체 개요
2. [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) - 구조 이해
3. [COMMON_MISTAKES.md](Project/COMMON_MISTAKES.md) - 실수 방지
4. [ERROR_HANDLING_GUIDE.md](Project/ERROR_HANDLING_GUIDE.md) - 에러 처리

### GPL 언어 학습

1. [GPL*언어*실무\_가이드.md](Project/GPL_언어_실무_가이드.md)
2. [GPL*데이터타입*상수\_정리.md](Project/GPL_데이터타입_상수_정리.md)
3. [GPL_THREAD_SAFETY.md](Project/GPL_THREAD_SAFETY.md)

### 특정 기능 구현

- **파일 I/O**: [FILE_IO_IMPLEMENTATION.md](Project/FILE_IO_IMPLEMENTATION.md)
- **문자열 처리**: [STRING_API_GUIDE.md](Project/STRING_API_GUIDE.md)
- **공식 레퍼런스 인덱스**: [GPL_DICTIONARY_GUIDE.md](Project/GPL_DICTIONARY_GUIDE.md)

## 문서 유지보수

- 새로운 기능/문제 해결 시 관련 문서 업데이트
- 중요한 이슈는 [INCIDENTS.md](Project/INCIDENTS.md)에 기록
- 공식 레퍼런스 요약은 [GPL_DICTIONARY_GUIDE.md](Project/GPL_DICTIONARY_GUIDE.md)에 누적

---

**최종 업데이트**: 2026-02-06
