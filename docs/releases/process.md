# 릴리즈 프로세스 표준화 가이드

이 문서는 이 저장소에서 **버전 관리, 커밋, 태그, VSIX 패키징, GitHub Release, Marketplace 게시**를 어떻게 운영하는지 정리한 현행 문서다.
예전 문서/명령 예시 중 현재 스크립트와 맞지 않는 내용이 있었으므로, **실제 구현 기준**으로 다시 정리한다.

## 무엇이 기준 파일인가

공식 릴리즈에서 먼저 맞춰야 하는 파일은 아래 4개다.

- `package.json` — 확장의 실제 버전
- `CHANGELOG.md` — GitHub Release 노트 원본
- `README.md` — 이용자용 기능·사용 안내. 버전은 CHANGELOG와 Releases로 연결하고 중복 표기하지 않는다
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

### `npm run compile`

- `scripts/prune-build-outputs.js`가 현재 tsconfig의 출력 목록에서 빠진 `out/`의 JavaScript·소스맵을 먼저 제거한다.
- 현재 소스의 산출물과 별도 MCP 번들(`.cjs`)·리소스는 보존한다. 프로젝트 밖 경로·소스와 겹친 출력 폴더·junction/심볼릭 링크는 삭제 전에 거부한다.
- 이어서 TypeScript를 컴파일한다. 테스트·prepublish·패키징은 이 공통 경로를 사용한다.

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
3. `README.md` 사용 안내 반영 / `docs/ai-handoff.md` 버전 갱신
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
3. `README.md` 기능·사용법 변경 반영
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

이 절의 SemVer suffix는 **GitHub Release 전용**이다. Marketplace는 `-beta`/`-rc` suffix를 받지 않는다.
Marketplace Pre-release는 숫자 버전과 `vsce --pre-release`를 사용하며, 현재 자동 게시 대상에서는 제외한다.
GitHub 프리릴리즈는 SemVer suffix를 수동으로 맞춘다.

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

릴리즈 워크플로는 버전에 `-` suffix가 있으면 GitHub Release를 **Pre-release**로 표시하고 Marketplace 게시를 건너뛴다.

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
  - 기능·지원 범위·사용법 변경 반영
  - 버전·릴리스별 변경 사항은 CHANGELOG와 Releases에서 관리하고 중복 표기하지 않음
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

`release.yml`은 태그 버전과 package 버전 일치를 먼저 검사하고 확장·MCP 테스트를 실행한다.
테스트를 통과하면 VSIX를 한 번 패키징해 SHA-256과 함께 Actions artifact 및 GitHub Release에 보관한다.
기존 Release는 삭제하지 않고 갱신한다. `CHANGELOG.md`가 릴리스 노트의 정본이다.

### Marketplace 최초 등록

1. [게시자 관리](https://marketplace.visualstudio.com/manage/publishers/)에 게시용 Microsoft 계정으로 로그인한다.
2. `package.json`의 `publisher`와 같은 ID인 `nir414`의 소유권/게시 권한을 확인한다.
   아직 등록되지 않았다면 해당 ID로 게시자를 만든다. 다른 소유자가 사용 중이면 ID와 기존 설치의 전환을 먼저 결정한다.
3. **New extension → Visual Studio Code**에서 검증된 VSIX를 올린다.
   업데이트는 기존 확장의 **Update**를 사용한다. 게시된 버전을 덮어쓰지 말고 새 버전을 사용한다.
4. 게시 처리 완료 후 `@id:nir414.gpl-language-support` 검색과 상세 페이지 버전을 확인한다.
   업로드 접수와 Marketplace 공개 완료는 구분한다.

### Marketplace 자동 게시 연결 (Microsoft Entra ID / OIDC)

최초 업로드는 관리 화면에서 할 수 있다. 이후 자동 게시에는 다음 계정 설정이 필요하다.
이 저장소는 장기 PAT를 저장하지 않고 GitHub OIDC → Entra ID → `vsce --azure-credential` 경로를 사용한다.

Entra tenant가 없는 계정은 먼저 [Microsoft의 tenant 준비 안내](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-create-new-tenant)를 따른다.
현재 공식 경로는 [Azure 무료 계정 가입](https://azure.microsoft.com/free/)을 안내하며 전화/카드 확인과 약관 동의는 계정 소유자가 직접 처리한다.
가입 후 생성/연결된 기본 디렉터리에서 앱 등록 권한을 확인한다. 이를 관리 센터에서 추가 Workforce tenant를 생성하는 절차와 혼동하지 않는다.
추가 Workforce tenant 생성에는 유료 고객 조건이 있으며, 무료 체험 가입이 추가 tenant 생성을 허용한다는 의미는 아니다.
무료 체험 종료와 종량제 전환 시점의 조건은 가입 화면에서 확인한다. 게시용 identity에는 컴퓨트/스토리지 리소스가 필요하지 않다.

1. 게시에 사용할 Entra 애플리케이션(service principal) 또는 user-assigned managed identity를 준비한다.
   기존 조직의 게시용 identity가 있으면 재사용한다. 조직 정책상 identity 생성/수정 권한이 없으면 관리자에게 요청한다.
2. GitHub 저장소에 `marketplace` Environment를 만든다. 필요한 경우 승인자와 릴리스 태그 배포 규칙을 설정한다.
3. identity에 GitHub Actions용 federated credential을 연결한다.
   - Issuer: `https://token.actions.githubusercontent.com`
   - Subject: `repo:<owner>/<repository>:environment:marketplace` (현재 저장소의 실제 owner/name 사용)
   - Audience: `api://AzureADTokenExchange`
4. 해당 identity를 Marketplace 게시자의 멤버로 추가하고 **Contributor** 권한을 부여한다.
   [공식 게시 안내](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#secure-automated-publishing-to-visual-studio-marketplace)의
   profile 조회 절차로 Marketplace에서 사용하는 identity ID를 확인한다. client ID와 혼동하지 않는다.
5. GitHub `marketplace` Environment secrets에 `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`를 설정한다.
   비밀번호/인증서/PAT는 필요하지 않다. 워크플로는 subscription 없이 로그인하도록 설정했다.
6. 저장소 Actions variable `MARKETPLACE_PUBLISH`를 문자열 `true`로 설정하면 **이후 정식 태그**에서 게시가 활성화된다.
   미설정이면 GitHub Release까지만 생성한다. 설정을 켜도 과거 태그는 소급 실행되지 않는다.

게시 job은 같은 workflow run의 VSIX를 내려받아 SHA-256을 확인하고 **재빌드 없이** 게시한다.
태그의 `publisher.name`은 기존 확장 ID와 유지해야 같은 확장의 업데이트로 전달된다.
실패 시 Release workflow의 실패한 job을 재실행할 수 있다. 이미 같은 버전이 게시된 경우
`--skip-duplicate`로 건너뛰므로, 재실행 성공만으로 새 업로드를 증명하지 말고 Marketplace 버전을 직접 확인한다.
Marketplace에는 기존 설치보다 높은 버전을 게시해야 한다.

### 현재 연결 상태 (2026-10-26)

| 항목 | 값 |
| --- | --- |
| Entra 디렉터리 | `기본 디렉터리` (tenant `5fd15a3f-d15b-47d8-badb-2d7489faeba4`) |
| 게시용 앱 등록 | `gpl-language-marketplace-publisher` (client `571bc32b-3272-4eb3-abea-0b5333a52f80`, 서비스 주체 object `2fd6033a-3b4a-47ca-b30e-7a9379755139`) |
| federated credential | `repo:nir414/GPL_language:environment:marketplace` |
| Marketplace 멤버 | 게시자 `nir414`에 위 서비스 주체를 Contributor로 추가(Members에 `tenant\object` 형식으로 표시) |
| GitHub | `marketplace` Environment secrets `AZURE_CLIENT_ID`·`AZURE_TENANT_ID`, Actions variable `MARKETPLACE_PUBLISH=true`, 배포 규칙 `v*.*.*` 태그만 |

연결하면서 확인한 점:

- 구독 없는 개인 계정에서 `az login --allow-no-subscriptions`가 디렉터리 선택 화면에서 `'NoneType' object has no attribute 'get'`으로 죽었다(Azure CLI 2.91.0). `az config set core.login_experience_v2=off` 뒤 `az login --tenant <tenant> --allow-no-subscriptions`로 우회했다.
- Marketplace 멤버 ID는 서비스 주체로 로그인한 상태에서 `az rest -u https://app.vssps.visualstudio.com/_apis/profile/profiles/me --resource 499b84ac-1321-427f-aa17-267ca6975798`로 처음 호출할 때 등록·반환된다. `api-version=7.1-preview.3`을 붙인 첫 호출은 `VSS011031 no profile`로 실패했다. 조회에는 1시간짜리 임시 client secret을 쓰고 바로 지웠다(앱에는 secret이 남지 않는다).
- 이 저장소의 GitHub Release는 immutable이라 게시된 자산을 바꿀 수 없다. 실패한 Release workflow를 다시 실행하면 `release` job이 기존 릴리스의 자산을 받아 SHA-256을 확인하고 그 파일을 게시 대상으로 넘긴다(0.18.1부터). 0.18.0 태그의 workflow는 이 처리 전이라 재실행이 실패했고, Marketplace에는 0.18.1이 첫 자동 게시다.
- 권한 회수: 앱 등록을 지우거나 Marketplace Members에서 빼면 자동 게시 권한이 없어진다.
### 사용자의 자동 업데이트

Marketplace 게시와 사용자의 자동 업데이트 설정은 별개다. VS Code에서 해당 확장의 **Auto Update**가 켜져 있어야 한다.
VSIX로 설치한 확장은 Auto Update가 기본 비활성화되므로 Marketplace 공개 뒤 해당 설정을 확인하도록 안내한다.
조직의 VS Code 정책에 따라 업데이트가 제한될 수 있다.

참고: [Azure Login OIDC](https://github.com/Azure/login#login-with-openid-connect-oidc-recommended),
[VS Code 자동 업데이트](https://code.visualstudio.com/docs/configure/extensions/extension-marketplace#extension-auto-update).

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
- 설치 명령(`code --install-extension` 등)은 사용자가 요청하지 않는 한 실행하지 않는다
- 확장 동작을 확인할 일이 있으면 사용자가 F5(`Run Extension` — 전용 프로필 `GPL-DevHost`)로 개발 호스트를
  띄운다. `npm run dev:host`도 같은 환경을 별도 창으로 열지만, 사용자가 요청할 때만 실행한다

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
