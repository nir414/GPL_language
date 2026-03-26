# GPL Language Support - 문서 가이드

**GPL (Guidance Programming Language)** 개발을 위한 종합 문서 모음입니다.

> **참고**: 여기서 말하는 GPL은 Brooks Automation의 **Guidance Programming Language**이며 GNU GPL 라이선스와 무관합니다.

---

## 📚 문서 구조

### 🎓 [gpl-language/](gpl-language/) - GPL 언어 학습 자료

GPL 언어의 핵심 개념, 문법, 베스트 프랙티스를 다룹니다.

**추천 읽기 순서:**

1. **[getting-started.md](gpl-language/getting-started.md)** - GPL 언어 개요 및 VB.NET과의 차이점
2. **[datatypes.md](gpl-language/datatypes.md)** - 데이터 타입, 상수, ASCII 제약 사항
3. **[location-cartesian.md](gpl-language/location-cartesian.md)** - Location Cartesian/PosWrtRef/XYZ와 관련 컴파일 오류 정리
4. **[arrays.md](gpl-language/arrays.md)** - 배열(0-based, upper bound, ReDim, 참조 공유)
5. **[strings.md](gpl-language/strings.md)** - 문자열 처리 표준 (Left/Right/Val 대체 패턴)
6. **[common-mistakes.md](gpl-language/common-mistakes.md)** - 자주 발생하는 실수 및 컴파일 에러 패턴
7. **[error-handling.md](gpl-language/error-handling.md)** - 예외 처리 및 로그 표준화
8. **[error-prevention.md](gpl-language/error-prevention.md)** - 에러 방지 체크리스트

**심화 주제:**

- **[threading.md](gpl-language/threading.md)** - Thread 클래스 및 동기화 (TestAndSet 패턴)
- **[thread-safety.md](gpl-language/thread-safety.md)** - 스레드 안전성 상세 가이드
- **[networking.md](gpl-language/networking.md)** - TCP/UDP 네트워킹 (Socket, TcpClient, UdpClient)
- **[file-io.md](gpl-language/file-io.md)** - 파일 입출력 구현

---

### 🛠️ [development/](development/) - 프로젝트 개발 가이드

GPL 프로젝트 개발 및 운영을 위한 실무 가이드입니다.

- **[project-structure.md](development/project-structure.md)** - 프로젝트 구조 및 아키텍처
- **[automation.md](development/automation.md)** - 컨트롤러 업로드 자동화
- **[handover.md](development/handover.md)** - 개발자 인수인계 가이드
- **[version-management.md](development/version-management.md)** - 버전 관리 전략
- **[workflow-improvements.md](development/workflow-improvements.md)** - AI 에이전트 워크플로우 개선 사항

---

### 📖 [reference/](reference/) - 참고 자료

GPL 공식 레퍼런스 및 참고 문서입니다.

- **[dictionary.md](reference/dictionary.md)** - GPL Dictionary 인덱스 및 Statements 요약
- **[robot-homing-methods.md](reference/robot-homing-methods.md)** - 로봇 Homing Methods(인덱스 사용/미사용, 방법군 개요)

---

### 🚀 [releases/](releases/) - 릴리즈 프로세스

VS Code 확장 릴리즈 관련 가이드입니다.

- **[quick-guide.md](releases/quick-guide.md)** - 빠른 릴리즈 가이드 (3단계)
- **[process.md](releases/process.md)** - 상세 릴리즈 체크리스트 및 문제 해결

---

### 📦 [archive/](archive/) - 히스토리 및 기록

프로젝트 히스토리, 세션 요약, 인시던트 기록입니다.

- **[incidents.md](archive/incidents.md)** - 발생한 이슈 및 해결 방법
- **[sessions/](archive/sessions/)** - 개발 세션 요약 및 기술 노트
  - [2025-12-09.md](archive/sessions/2025-12-09.md)
  - [2026-01-02.md](archive/sessions/2026-01-02.md)
  - [streamwriter-notes.md](archive/sessions/streamwriter-notes.md)
- **[reviews/](archive/reviews/)** - 프로젝트 리뷰 기록
  - [2025-12-08.md](archive/reviews/2025-12-08.md)

---

## 🔗 VS Code 확장과의 연계

이 문서들은 **GPL Language Support** VS Code 확장의 진단 규칙 및 코드 액션의 기준이 됩니다:

- **진단 규칙**: `Optional`, `On Error`, `Left/Right/Val`, `EndOfStream` 등 미지원 구문 감지
- **코드 액션**: VB.NET 호환성 대안 제안, 권장 패턴 제시
- **자동완성**: GPL 특화 패턴 및 API 제안

자세한 내용은 프로젝트 루트의 [README.md](../README.md)를 참고하세요.

---

## 🌐 외부 리소스

### GPL 공식 문서

- **[Brooks Automation GPL Reference](https://www2.brooksautomation.com/Controller_Software/Introduction_To_The_Software/Guidance_Programming_Language/)** - 공식 언어 레퍼런스
- **[GPL 자동 실행 모드](https://www2.brooksautomation.com/Controller_Software/Introduction_To_The_Software/Controller_Automatic_Execution_Modes/mode_gpl.htm)** - 자동 실행 설정

### 프로젝트 링크

- [GitHub Repository](https://github.com/nir414/GPL_language)
- [Issues](https://github.com/nir414/GPL_language/issues)
- [Contributing Guidelines](../CONTRIBUTING.md)

---

## 📝 문서 기여

문서 개선 사항이나 오류를 발견하시면:

1. [Issues](https://github.com/nir414/GPL_language/issues)에 제보
2. Pull Request로 직접 수정 제안
3. [기여 가이드라인](../CONTRIBUTING.md) 참고

---

**마지막 업데이트**: 2026년 2월 6일
