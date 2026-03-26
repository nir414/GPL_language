# Quick Release Guide

릴리즈 과정을 빠르게 실행하기 위한 요약본입니다.

## ⚡ 간단 버전 (3단계)

```powershell
# 1. 버전 범프 (patch/minor/major 중 선택)
npm run bump:patch

# 2. CHANGELOG.md 편집 후 커밋 & 푸시
git add package.json CHANGELOG.md
git commit -m "chore: bump version to 0.2.13"
git push origin main

# 3. 태그 생성 & 푸시 (자동 릴리즈 트리거)
git tag v0.2.13
git push origin v0.2.13
```

✅ 완료! GitHub Actions가 자동으로 빌드, 패키징, 릴리즈 노트 생성, Release 생성을 처리합니다.

## 📦 버전 범프 명령

```powershell
npm run bump:patch  # 0.2.12 → 0.2.13 (버그 수정)
npm run bump:minor  # 0.2.12 → 0.3.0  (새 기능)
npm run bump:major  # 0.2.12 → 1.0.0  (Breaking changes)
```

**자동 처리 사항:**

- ✅ package.json 버전 업데이트
- ✅ CHANGELOG.md에 새 버전 섹션 자동 생성
- ✅ 오늘 날짜 자동 입력

## 🔧 프리릴리즈 (Beta/Alpha/RC)

```powershell
# 1. package.json 수동 편집
# "version": "0.3.0-beta.1"

# 2. CHANGELOG 수동 추가
# ## [0.3.0-beta.1] - 2026-02-06

# 3. 커밋 & 푸시
git add package.json CHANGELOG.md
git commit -m "chore: bump version to 0.3.0-beta.1"
git push origin main

# 4. 프리릴리즈 태그 생성
git tag v0.3.0-beta.1
git push origin v0.3.0-beta.1
```

워크플로가 자동으로 **Pre-release**로 표시합니다.

## 🚨 태그 삭제 (실수한 경우)

```powershell
# 로컬 태그 삭제
git tag -d v0.2.13

# 원격 태그 삭제
git push origin :refs/tags/v0.2.13

# GitHub에서 Release도 수동 삭제 (필요시)
# https://github.com/nir414/GPL_language/releases
```

## 🔍 릴리즈 확인

- **Actions 워크플로**: https://github.com/nir414/GPL_language/actions
- **Releases 페이지**: https://github.com/nir414/GPL_language/releases
- **최신 릴리즈**: https://github.com/nir414/GPL_language/releases/latest

## 📚 자세한 내용

전체 릴리즈 체크리스트와 문제 해결은 [RELEASE_PROCESS.md](RELEASE_PROCESS.md)를 참고하세요.
