---
description: "Use when changing package version, README version text, building the GPL extension, running release checks, packaging VSIX, or validating release readiness. Covers forbidden install commands and required verification order."
---

# GPL Release and Validation Workflow

- 코드 수정이 있으면 `package.json` 버전을 patch +1 한다.
- `README.md`의 현재 버전 표기는 `package.json`과 반드시 일치해야 한다.
- 검증 순서는 기본적으로 다음을 따른다.
  1. `npm run pre-release-check`
  2. `npm run compile`
  3. 필요 시 `npm run dev:cycle`
- VSIX 생성 후에는 **파일 경로만 안내**한다.

## 절대 금지

- `npm run dev:install`
- `npm run dev:cycle:open`
- `npm run dev:host`
- `code --install-extension` 등 VSIX 설치 명령

## 추가 확인

- 워크스페이스에 로그/캐시/상태 파일이 자동 생성되지 않았는지 확인한다.
- 사용자가 직접 설치한다는 원칙을 깨지 않는다.
