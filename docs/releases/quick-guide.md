# Quick Release Guide

이 문서는 **실제로 자주 쓰는 명령만 빠르게 보는 요약본**이다.
상세 배경과 예외 처리는 [`process.md`](./process.md)를 본다.

## 가장 중요한 규칙 3개

1. **공식 릴리즈는 `package.json`, `CHANGELOG.md`, `README.md`, `docs/ai-handoff.md`를 같이 맞춘다.**
2. **`npm run package`는 항상 patch bump를 한다.**
3. **minor / major / pre-release는 `npm run package:no-bump`를 써야 한다.**

## 어떤 명령을 써야 하나

### 로컬 테스트용 VSIX만 빨리 만들 때

```powershell
npm run compile
npm run package
```

- patch 버전이 자동으로 1 올라갈 수 있다.
- 공식 태그 릴리즈 절차와는 분리해서 생각한다.

### 공식 PATCH 릴리즈

```powershell
node scripts/bump-version.js patch
# CHANGELOG.md / README.md / docs/ai-handoff.md 정리
git add package.json CHANGELOG.md README.md docs/ai-handoff.md
git commit -m "chore: release X.Y.Z"
npm run pre-release-check
npm run package:no-bump
git push origin main
git tag vX.Y.Z
git push origin vX.Y.Z
```

### 공식 MINOR / MAJOR 릴리즈

```powershell
node scripts/bump-version.js minor
# 또는: node scripts/bump-version.js major
# CHANGELOG.md / README.md / docs/ai-handoff.md 정리
git add package.json CHANGELOG.md README.md docs/ai-handoff.md
git commit -m "chore: release X.Y.Z"
npm run pre-release-check
npm run package:no-bump
git push origin main
git tag vX.Y.Z
git push origin vX.Y.Z
```

### 프리릴리즈 (`-alpha`, `-beta`, `-rc`)

```powershell
# package.json version 수동 수정 (예: 0.9.0-beta.1)
# CHANGELOG.md에 같은 버전 섹션 추가
# README.md / docs/ai-handoff.md 정리
git add package.json CHANGELOG.md README.md docs/ai-handoff.md
git commit -m "chore: release 0.9.0-beta.1"
npm run pre-release-check
npm run package:no-bump
git push origin main
git tag v0.9.0-beta.1
git push origin v0.9.0-beta.1
```

## 자주 틀리는 포인트

- `npm run package`는 **minor/major용이 아님**
  - 이미 `0.8.0`으로 맞춰놨는데 이걸 실행하면 `0.8.1`이 될 수 있다.
- `npm run pre-release-check`는 **Git working tree가 깨끗해야 통과**한다.
  - 즉, 문서 수정 후 먼저 커밋하고 돌리는 편이 안전하다.
- `CHANGELOG.md`의 빈 섹션은 지운다.
  - `### Added`만 있고 내용 없으면 나중에 릴리즈 노트가 휑해진다.
- VSIX 설치는 자동으로 하지 않는다.
  - 사용자 수동 설치 원칙 유지.

## 산출물

패키징 성공 시:

- `dist/gpl-language-support-X.Y.Z.vsix`

결과 공유는 **VSIX 파일 경로만** 안내한다.

## 확인 링크

- Actions: <https://github.com/nir414/GPL_language/actions>
- Releases: <https://github.com/nir414/GPL_language/releases>
- Latest: <https://github.com/nir414/GPL_language/releases/latest>

## 더 자세한 문서

- 상세 절차/복구/실수 방지: [`process.md`](./process.md)
