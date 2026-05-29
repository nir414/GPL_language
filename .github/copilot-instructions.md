# Copilot instructions (GPL Language Support)

이 파일은 **최상위 허브 지침**이다. 항상 적용되는 프로젝트 공통 규칙만 둔다.
구현 세부 규칙은 `.github/instructions/` 아래 파일로 분리한다.

## 항상 먼저 지킬 공통 규칙

- GPL과 무관한 상황에서 확장이 존재감을 드러내지 않도록 한다.
- 워크스페이스에 로그·캐시·상태 파일을 자동 생성하지 않는다.
- VSIX 설치 명령이나 금지된 개발 명령을 실행하지 않는다.
- Brooks 제어기의 내장 GDE 포트(1402~1404)는 하드웨어/런타임 제약으로 취급한다.
  - 사용자 코드에서 포트 바인딩 방식이나 역할을 바꾸지 않는다.
  - 특히 1403 동작 문제는 임의 재설계보다 공식 문서 기준 비침습 진단을 먼저 한다.
- 제어기 TCP 명령은 병렬로 보내지 않는다.
- 1403 소켓 종료에 `socket.destroy()`를 쓰지 않는다.
- 제어기 Stop / Deploy / Compile / Start / 로그 수신 등 모든 제어기 조작은 `GPL_language` VS Code 확장 기능을 통해서만 수행한다.
- PowerShell 직접 FTP 업로드, `_debug_cycle.ps1` 등 스크립트를 통한 우회 배포는 금지한다.
- 확장으로 재현 불가능한 증거 수집이 꼭 필요한 경우에만 보조 수단을 제한적으로 사용한다.

## 프로젝트 핵심 맥락

- 이 저장소는 GPL 언어 지원 + DAP 디버거를 포함한 **VS Code 확장**이다.
- 진입점은 `src/extension.ts`다.
- `docs/`는 확장 코드가 아니라 GPL 로봇 프로젝트 문서다.
- 제어기/프로토콜 판단은 항상 **Brooks 공식 문서 우선** 원칙을 따른다.

## 세부 지침 위치

- `gpl-typescript.instructions.md`
  - `src/**/*.ts` 수정 시 자동 적용
  - GPL 파일 판별, 심볼 비교, 명명 규칙, 수정 범위, 파싱/심볼 원칙
- `gpl-controller.instructions.md`
  - `src/controller/**/*.ts`, `src/debug/**/*.ts`, `src/views/**/*.ts` 수정 시 자동 적용
  - 1402/1403 포트, `sendCommand()`, 응답 파싱, 직렬화, 1403 재연결 규칙
- `gpl-ai-controller-debugging.instructions.md`
  - AI 에이전트가 GPL Language Support 확장으로 제어기 디버깅을 보조할 때 적용
  - 안전한 명령 순서, VS Code command ID, DAP attach 흐름, 증거 수집 규칙
- `gpl-release.instructions.md`
  - 버전 변경, 릴리즈 검증, VSIX 패키징 시 적용
  - 버전 동기화, `pre-release-check`, `compile`, `dev:cycle`, 설치 금지 규칙

## 기본 작업 순서

1. 먼저 이 허브 문서의 공통 규칙을 확인한다.
2. 수정 대상 파일에 맞는 `.github/instructions/*.instructions.md` 지침을 따른다.
3. 코드 수정이 있었다면 버전/README/검증 순서를 지킨다.
4. 코드 수정 작업은 **항상 VSIX 패키징까지 완료**하고, 결과는 VSIX 파일 경로만 안내한다.
