# Copilot instructions (GPL Language Support)

공통 지침의 정본은 저장소 루트 **`AGENTS.md`**다. VS Code Copilot은 `chat.useAgentsMdFile` 설정이 켜져 있으면 이 파일과
함께 읽는다. 공통 규칙(작업 방식, 하드 규칙, 제품 규칙, 기록 규칙, 구조 설계 방향)은 여기에 복사하지 않는다.
이 파일에는 Copilot 전용 안내와 경로별 세부 지침의 목록만 둔다.

## 반드시 지킬 것 (AGENTS.md 발췌 — 원문이 정본)

- 제어기 조작(Stop·Deploy·Compile·Start·로그 수신)은 확장 기능으로만 한다. 소켓·FTP를 직접 열거나 스크립트로 우회 배포하지 않는다.
- 성공/실패는 그 명령의 `<STATUS>`를 `</STATUS>`까지 읽고 판정한다. `Start`에는 `-compile`이 붙는다.
- 사용자 작업 공간에 로그·캐시·상태·AI 설정 파일을 자동으로 만들지 않는다.
- VS Code 창을 열거나 VSIX를 설치하는 명령은 사용자가 요청할 때만 실행한다.

## 경로별 세부 지침 (`.github/instructions/`)

| 파일 | 적용 | 내용 |
| --- | --- | --- |
| `gpl-typescript.instructions.md` | `src/**/*.ts` | GPL 파일 판별, 심볼 비교, 명명, 파싱 경계, TextMate 문법 패턴 |
| `gpl-controller.instructions.md` | `src/controller/**`, `src/debug/**`, `src/views/**` | 포트, `sendCommand()` 의미, 응답 파싱 단일화, 직렬화, 런타임 콘솔 재연결 |
| `gpl-ai-controller-debugging.instructions.md` | AI가 제어기 디버깅을 보조할 때 | 안전한 명령 순서, Command ID, DAP attach, 증거 수집 |
| `gpl-release.instructions.md` | 버전·패키징·릴리스 | 버전 정책, 검증 순서, 설치 금지 |

## 기본 작업 순서

1. `AGENTS.md`의 공통 규칙을 확인한다.
2. 수정 대상 파일에 맞는 `.github/instructions/*.instructions.md`를 따른다.
3. 사용자 대면 기능을 바꿨다면 `gpl-release.instructions.md` 순서대로 검증·버전 결정·VSIX 패키징까지 끝내고,
   VSIX 경로·크기·SHA-256·경고 여부를 보고한다.
