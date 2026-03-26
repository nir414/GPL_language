# 릴리즈 프로세스 표준화 가이드

## 개요

이 문서는 GPL Language Support 확장의 릴리즈 프로세스를 표준화하여 일관성 있고 안전한 배포를 보장합니다.

## 릴리즈 타입

### Semantic Versioning 적용

- **MAJOR (x.0.0)**: Breaking changes (하위 호환성 깨짐)
- **MINOR (0.x.0)**: 새로운 기능 추가 (하위 호환성 유지)
- **PATCH (0.0.x)**: 버그 수정 및 성능 개선

## 릴리즈 체크리스트

### 1. 사전 준비 (로컬)

- [ ] `main` 브랜치를 최신 상태로 업데이트

  ```powershell
  git checkout main
  git pull origin main
  ```

- [ ] 의존성 설치 및 빌드 테스트

  ```powershell
  npm ci
  npm run compile
  ```

- [ ] Extension Development Host에서 수동 테스트
  - F5로 디버깅 실행
  - 주요 기능 검증 (Definition, References, Completion 등)

### 2. 버전 업데이트

- [ ] `package.json`의 `version` 필드 업데이트

  ```json
  "version": "0.2.13"
  ```

- [ ] `CHANGELOG.md` 업데이트
  - 새 버전 섹션 추가
  - 날짜는 `YYYY-MM-DD` 형식
  - 변경사항을 `Added`, `Changed`, `Fixed`, `Removed` 카테고리로 분류

  예시:

  ```markdown
  ## [0.2.13] - 2026-02-06

  ### Added

  - 새로운 기능 설명

  ### Fixed

  - 버그 수정 내용
  ```

- [ ] 변경사항 커밋
  ```powershell
  git add package.json CHANGELOG.md
  git commit -m "chore: bump version to 0.2.13"
  ```

### 3. 로컬 VSIX 빌드 및 검증 (선택사항)

- [ ] VSIX 패키징

  ```powershell
  npm run package
  ```

- [ ] 생성된 VSIX 파일 확인

  ```powershell
  dir dist\
  ```

- [ ] 로컬 설치 테스트
  - VS Code Extensions 뷰 → `...` → Install from VSIX
  - 설치 후 기능 재검증

### 4. GitHub에 푸시

- [ ] 변경사항 푸시

  ```powershell
  git push origin main
  ```

- [ ] CI 빌드 성공 확인
  - https://github.com/nir414/GPL_language/actions 에서 CI 워크플로 확인

### 5. 릴리즈 태그 생성

- [ ] Semantic Version 태그 생성 및 푸시
  ```powershell
  git tag v0.2.13
  git push origin v0.2.13
  ```

### 6. 자동 릴리즈 확인

- [ ] GitHub Actions 워크플로 실행 확인
  - https://github.com/nir414/GPL_language/actions
  - "Release" 워크플로가 자동으로 시작됨

- [ ] GitHub Release 생성 확인
  - https://github.com/nir414/GPL_language/releases
  - 릴리즈 노트가 CHANGELOG에서 자동 추출됨
  - VSIX 파일이 자동으로 첨부됨

### 7. VS Code Marketplace 배포 (선택사항)

현재는 GitHub Release만 자동화되어 있습니다. VS Code Marketplace 배포를 원하면:

- [ ] [Visual Studio Marketplace](https://marketplace.visualstudio.com/manage) 접속
- [ ] Publisher 계정으로 로그인 (`nir414`)
- [ ] 새 버전 업로드 또는 `vsce publish` 명령 사용
  ```powershell
  npx @vscode/vsce publish
  ```

## 자동화 워크플로 설명

### 트리거 조건

`v*.*.*` 패턴의 태그를 푸시하면 자동으로 실행됩니다.

### 워크플로 단계

1. **소스 체크아웃**: 전체 히스토리 포함
2. **의존성 설치**: `npm ci`
3. **TypeScript 컴파일**: `npm run compile`
4. **VSIX 패키징**: `npm run package`
5. **버전 검증**: package.json 버전과 태그 버전 일치 확인
6. **프리릴리즈 감지**: 태그에 `alpha`, `beta`, `rc` 포함 시 자동으로 prerelease 플래그 설정
7. **CHANGELOG 추출**: Node.js 스크립트로 해당 버전의 변경사항 추출
8. **GitHub Release 생성**: 릴리즈 노트와 VSIX 파일 첨부
9. **Artifact 업로드**: 90일간 보관

### 실패 시 대응

- **버전 불일치**: package.json 버전을 수정하고 태그를 다시 생성

  ```powershell
  git tag -d v0.2.13
  git push origin :refs/tags/v0.2.13
  # package.json 수정 후
  git tag v0.2.13
  git push origin v0.2.13
  ```

- **빌드 실패**: CI 로그 확인 후 수정, 새 태그로 재시도

## 핫픽스 프로세스

긴급 버그 수정이 필요한 경우:

1. `main`에서 바로 수정 후 패치 버전 증가 (예: 0.2.13 → 0.2.14)
2. 위 체크리스트 따라 릴리즈
3. CHANGELOG에 `### Fixed` 섹션에 핫픽스 내용 명시

## 베타/프리릴리즈

실험적 기능을 테스트하거나 프리릴리즈 버전을 배포하려면:

### 프리릴리즈 버전 생성

```powershell
# 1. 프리릴리즈 버전으로 범프 (수동 편집 필요)
# package.json에서 version을 다음과 같이 수정:
# "version": "0.3.0-beta.1"
# "version": "0.3.0-alpha.1"  
# "version": "0.3.0-rc.1"

# 2. CHANGELOG 업데이트 (수동)
# ## [0.3.0-beta.1] - 2026-02-06 형식으로 추가

# 3. 커밋 & 푸시
git add package.json CHANGELOG.md
git commit -m "chore: bump version to 0.3.0-beta.1"
git push origin main

# 4. 프리릴리즈 태그 생성 & 푸시
git tag v0.3.0-beta.1
git push origin v0.3.0-beta.1
```

### 자동 프리릴리즈 감지

릴리즈 워크플로는 태그에 `alpha`, `beta`, `rc`가 포함되어 있으면 자동으로 **prerelease**로 표시합니다.

- ✅ 프리릴리즈로 표시: `v0.3.0-beta.1`, `v1.0.0-alpha.2`, `v2.0.0-rc.1`
- ❌ 정식 릴리즈: `v0.3.0`, `v1.0.0`

프리릴리즈는 GitHub Releases 페이지에서 "Pre-release" 라벨이 붙으며, "Latest" 릴리즈로 표시되지 않습니다.

## 문제 해결

### Q: 태그를 잘못 만들었어요

```powershell
# 로컬 태그 삭제
git tag -d v0.2.13

# 원격 태그 삭제
git push origin :refs/tags/v0.2.13

# 릴리즈도 GitHub에서 수동 삭제
```

### Q: 릴리즈 워크플로가 실패했어요

- Actions 탭에서 로그 확인
- 버전 불일치 또는 빌드 에러 수정
- 태그를 삭제하고 다시 생성

### Q: CHANGELOG가 릴리즈 노트에 안 나와요

- CHANGELOG.md 형식 확인: `## [버전] - 날짜`
- CHANGELOG를 수정한 후 태그를 다시 생성

## 참고 자료

- [Keep a Changelog](https://keepachangelog.com/)
- [Semantic Versioning](https://semver.org/)
- [GitHub Actions - Releases](https://github.com/softprops/action-gh-release)
- [VS Code Extension Publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
