---
description: "Use when changing package version, README version text, building the GPL extension, running release checks, packaging VSIX, or validating release readiness. Covers forbidden install commands and required verification order."
---

# GPL Release and Validation Workflow

- 코드 수정이 있으면 `package.json` 버전을 patch +1 한다.
- `README.md`의 현재 버전 표기는 `package.json`과 반드시 일치해야 한다.
- 코드 수정 작업은 **항상 VSIX 패키징까지 완료**한다.
- 검증/패키징 순서는 기본적으로 다음을 따른다.
  1. `npm run compile`
  2. `npm run pre-release-check`
  3. `npm run package` — **patch 계열 작업에만.** minor/major/pre-release 공식 릴리즈는
     버전을 먼저 수동 설정한 뒤 `npm run package:no-bump`를 쓴다 (정본: `docs/releases/process.md`).
- VSIX 생성 후에는 **파일 경로만 안내**한다.

## 창 열기·설치 명령은 사용자 요청이 있을 때만

- `npm run dev:host`, `code --extensionDevelopmentPath …`, `code --install-extension …` 처럼 VS Code 창을
  열거나 확장을 설치하는 명령은 **사용자가 그렇게 해 달라고 한 경우에만** 실행한다. 패키징·검증 흐름의
  일부로 임의 실행하지 않는다 (사용자 화면에 창이 뜨고, 사용자의 VS Code 설치 상태를 바꾸기 때문).
- 확장 테스트의 표준 경로는 F5(`.vscode/launch.json` "Run Extension") — 전용 프로필 `GPL-DevHost`로
  기본 환경(설정·확장 없음)에 우리 확장만 올려 `samples/hello-project`를 연다. 사용자가 직접 누른다.
- 사용자의 실제 VS Code 프로필에 VSIX를 설치하는 것은 사용자가 직접 한다(Extensions > Install from VSIX).

## 추가 확인

- 워크스페이스에 로그/캐시/상태 파일이 자동 생성되지 않았는지 확인한다.
- 사용자가 직접 설치한다는 원칙을 깨지 않는다.
