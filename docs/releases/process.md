# 릴리즈 프로세스 표준화 가이드

이 문서는 이 저장소에서 **버전 관리, 커밋, 태그, VSIX 패키징, GitHub Release**를 어떻게 운영하는지 정리한 현행 문서다.
예전 문서/명령 예시 중 현재 스크립트와 맞지 않는 내용이 있었으므로, **실제 구현 기준**으로 다시 정리한다.

## 무엇이 기준 파일인가

공식 릴리즈에서 먼저 맞춰야 하는 파일은 아래 4개다.

- `package.json` — 확장의 실제 버전
- `CHANGELOG.md` — GitHub Release 노트 원본
- `README.md` — 상단 현재 버전 표기와 주요 변경 이력
- `docs/ai-handoff.md` — 작업 인계/세션 기록

이 저장소에서 릴리즈 태그 `vX.Y.Z`는 반드시 `package.json`의 `version`과 일치해야 한다.

## 버전 정책

SemVer를 따른다.

- **MAJOR (`x.0.0`)**: 하위 호환이 깨지는 변경
- **MINOR (`0.x.0`)**: 기능 추가, 동작 확장
- **PATCH (`0.0.x`)**: 버그 수정, 안정화, 문서/내부 개선

예:

- `0.8.0 → 0.8.1`: patch
- `0.8.0 → 0.9.0`: minor
- `0.8.0 → 1.0.0`: major

## 현재 스크립트가 실제로 하는 일

이 절이 가장 중요하다. 스크립트 이름만 보고 동작을 추측하면 버전이 의도와 다르게 변경될 수 있다.

### `npm run package`

- 내부적으로 `node scripts/package.js --bump patch`
- **패키징 직전에 patch 버전을 자동으로 +1** 한다
- 성공하면 `dist/gpl-language-support-<version>.vsix` 생성
- 실패하면 `package.json` 버전을 롤백

즉, 이 명령은 **공식 patch 릴리즈** 또는 **로컬 patch 패키징**에만 안전하다.

### `npm run package:no-bump`

- 현재 `package.json` 버전을 **그대로 유지**하고 VSIX만 만든다
- `minor`, `major`, `beta`, `rc`처럼 **버전을 이미 맞춰둔 상태**에서 사용해야 한다

### `node scripts/bump-version.js <type>`

- `package.json` 버전 업데이트
- `CHANGELOG.md`에 새 버전 섹션 추가
- 지원 타입: `patch`, `minor`, `major`

주의:

- 이 스크립트는 `README.md`, `docs/ai-handoff.md`까지는 자동으로 안 고친다
- `CHANGELOG.md`에 빈 `### Added/Changed/Fixed/Removed`가 생길 수 있으니 실제 내용만 남기고 정리해야 한다

### `npm run pre-release-check`

다음 항목을 검사한다.

- `package.json` / `CHANGELOG.md` 존재
- 버전 형식 유효성
- 현재 버전이 `CHANGELOG.md`에 존재하는지
- Git working tree가 깨끗한지
- 현재 브랜치가 `main`인지
- `node_modules` 존재 여부
- `npm run compile` 통과 여부
- release workflow 관련 필수 파일/스크립트 존재 여부

즉, 이 체크는 **커밋 전**보다 **버전 문서 수정 후 커밋한 다음** 돌리는 게 더 자연스럽다.

## 릴리즈 경로 선택

### 1) 공식 PATCH 릴리즈

버그 수정/소규모 개선을 정식 릴리즈할 때.

권장 흐름:

1. `node scripts/bump-version.js patch`
2. `CHANGELOG.md` 정리
3. `README.md` / `docs/ai-handoff.md` 버전 반영
4. 커밋
5. `npm run pre-release-check`
6. `npm run package:no-bump`
7. `git push origin main`
8. `git tag vX.Y.Z`
9. `git push origin vX.Y.Z`

> `npm run package` 하나로 patch bump + VSIX 생성도 가능하지만,
> **공식 릴리즈**에서는 CHANGELOG/README/인계 문서까지 같이 맞춰야 하므로
> 위처럼 **버전을 먼저 고정하고 `package:no-bump`로 패키징**하는 흐름을 권장한다.

### 2) 공식 MINOR / MAJOR 릴리즈

새 기능 추가나 큰 변경일 때.

1. `node scripts/bump-version.js minor` 또는 `major`
2. `CHANGELOG.md` 내용 보강 + 빈 섹션 제거
3. `README.md` 현재 버전 갱신
4. `docs/ai-handoff.md` 세션 기록/현재 버전 갱신
5. `git add ...` / `git commit ...`
6. `npm run pre-release-check`
7. `npm run package:no-bump`
8. `git push origin main`
9. `git tag vX.Y.Z`
10. `git push origin vX.Y.Z`

중요:

- **`npm run package`를 쓰면 안 된다.**
- 이유: 이미 `minor`/`major`로 맞춘 버전에서 다시 **patch가 한 번 더 올라가 버림**

### 3) 프리릴리즈 (`-alpha`, `-beta`, `-rc`)

프리릴리즈는 SemVer suffix를 수동으로 맞춘다.

예:

- `0.9.0-alpha.1`
- `0.9.0-beta.1`
- `0.9.0-rc.1`

흐름:

1. `package.json` 버전 수동 수정
2. `CHANGELOG.md`에 `## [0.9.0-beta.1] - YYYY-MM-DD` 추가
3. `README.md` / `docs/ai-handoff.md` 정리
4. 커밋
5. `npm run pre-release-check`
6. `npm run package:no-bump`
7. `git push origin main`
8. `git tag v0.9.0-beta.1`
9. `git push origin v0.9.0-beta.1`

릴리즈 워크플로는 태그에 `alpha`, `beta`, `rc`가 들어 있으면 GitHub Release를 자동으로 **Pre-release**로 표시한다.

## 표준 릴리즈 절차

아래 절차를 기본 정식 릴리즈 흐름으로 삼는다.

### 1. 작업 브랜치/상태 정리

```powershell
git checkout main
git pull origin main
git status --short
```

- 다른 미완성 작업이 섞여 있지 않은지 먼저 확인한다.

### 2. 버전 올리기

예: minor 릴리즈

```powershell
node scripts/bump-version.js minor
```

예: patch 릴리즈

```powershell
node scripts/bump-version.js patch
```

### 3. 릴리즈 문서 정리

반드시 확인:

- `CHANGELOG.md`
  - 새 버전 섹션 날짜 확인
  - 실제 변경 내용 채우기
  - 빈 `### Added/Changed/Fixed/Removed` 삭제
- `README.md`
  - 상단 `현재 버전` 반영
  - 필요 시 주요 변경 이력 최신화
- `docs/ai-handoff.md`
  - 최종 갱신 / 현재 package 버전 / 세션 기록 추가

### 4. 커밋

```powershell
git add package.json CHANGELOG.md README.md docs/ai-handoff.md
git commit -m "chore: release X.Y.Z"
```

이 저장소는 `pre-release-check`가 **clean working tree**를 요구하므로,
버전 문서를 반영한 뒤 먼저 커밋해 두는 것이 좋다.

### 5. 릴리즈 검증

```powershell
npm run pre-release-check
```

필요 시 수동으로도 한 번 더 확인:

```powershell
npm run compile
```

### 6. VSIX 패키징

- patch/minor/major/pre-release 모두 공식 릴리즈에서는 아래를 권장:

```powershell
npm run package:no-bump
```

산출물:

- `dist/gpl-language-support-X.Y.Z.vsix`

### 7. 원격 푸시

```powershell
git push origin main
```

### 8. 태그 생성 및 푸시

```powershell
git tag vX.Y.Z
git push origin vX.Y.Z
```

이 태그 푸시가 GitHub Release 워크플로를 트리거한다.

## GitHub Release가 만들어지는 방식

`release.yml`은 태그 푸시 후 대략 아래 순서로 동작한다.

1. 소스 체크아웃
2. 의존성 설치
3. TypeScript 컴파일
4. VSIX 패키징
5. 태그 버전과 `package.json` 버전 일치 확인
6. `scripts/extract-changelog.js <version>`로 릴리즈 노트 추출
7. GitHub Release 생성
8. VSIX 첨부

즉, `CHANGELOG.md` 형식이 깨지면 Release 노트가 빈약해질 수 있다.

## 커밋 메시지/태그 규칙

권장 커밋 메시지:

- `chore: release 0.8.0`
- `chore: release 0.8.1`
- `chore: release 0.9.0-beta.1`

태그 형식:

- 정식: `v0.8.0`
- 프리릴리즈: `v0.9.0-beta.1`

`v` 접두사는 유지한다.

## 자주 하는 실수

### 실수 1. `minor` 릴리즈인데 `npm run package`를 실행함

증상:

- `0.8.0`으로 맞췄는데 패키징 후 `0.8.1`로 어긋남

원인:

- `npm run package`가 항상 patch bump를 하기 때문

대응:

- 공식 릴리즈는 `package:no-bump` 사용

### 실수 2. `pre-release-check`가 clean working tree에서 실패함

증상:

- `Git working directory is clean` 실패

원인:

- 버전 파일 수정 후 아직 커밋하지 않음

대응:

- 버전 파일 정리 → 커밋 → `npm run pre-release-check`

### 실수 3. `CHANGELOG.md`에 새 버전은 만들었는데 내용이 비어 있음

증상:

- GitHub Release 노트에 내용이 거의 없음

대응:

- 빈 헤더 제거
- 실제 변경 내용을 `Added/Changed/Fixed/Removed` 중 필요한 섹션만 남겨 작성

### 실수 4. VSIX 설치까지 자동으로 해버림

이 저장소 원칙:

- **VSIX 설치는 사용자가 수동으로 한다**
- 설치 명령(`code --install-extension`, `npm run dev:install`)은 실행하지 않는다

## 태그/릴리즈 복구

태그를 잘못 만들었으면:

```powershell
git tag -d v0.8.0
git push origin :refs/tags/v0.8.0
```

그 다음:

1. 버전/문서 수정
2. 필요 시 새 커밋
3. 올바른 태그 재생성
4. 다시 push

GitHub Releases에 이미 생성된 항목이 있으면 웹에서 수동 삭제가 필요할 수 있다.

## 로컬 개발용 패키징과 공식 릴리즈의 차이

### 로컬 개발용 VSIX만 필요할 때

```powershell
npm run compile
npm run package
```

- patch 버전이 자동 증가할 수 있다
- 빠르게 설치용 VSIX를 만들 때 적합
- 태그/릴리즈용 공식 절차와는 구분해서 생각해야 한다

### 공식 릴리즈를 만들 때

```powershell
node scripts/bump-version.js <patch|minor|major>
# 문서 수정
git commit ...
npm run pre-release-check
npm run package:no-bump
git push origin main
git tag vX.Y.Z
git push origin vX.Y.Z
```

## 참고 자료

- [Quick Release Guide](./quick-guide.md)
- [Keep a Changelog](https://keepachangelog.com/)
- [Semantic Versioning](https://semver.org/)
- [VS Code Extension Publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
