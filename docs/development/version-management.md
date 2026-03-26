# GPL 빌드 메타데이터(버전) 관리

현재 이 리포지토리에서 **실제로 구현되어 있는 버전/빌드 정보 관리**는, 런타임(GPL 코드)에서 버전을 계산하는 방식이 아니라 **빌드 산출물에 메타데이터를 기록**하는 방식입니다.

즉, `scripts/BuildProject.ps1`가 `bin/build_manifest.json`을 생성해 **Git 커밋/브랜치/빌드 시각** 등을 남깁니다.

> 참고: 예전 문서에 있던 `VersionManager.gpl`, `BuildVersionGenerator.ps1`, `version_info.xml` 등은 **현재 리포지토리에 존재하지 않으며(미구현/레거시)**, 아래 내용으로 정리했습니다.

## ✅ 현재 구현(현행)

### 무엇이 생성되나?

`GPL 프로젝트 빌드`(=`scripts/BuildProject.ps1`) 실행 시 `bin/`에 아래가 생성됩니다.

- `bin/*.gpl`: `Test_robot/`의 소스가 산출물 폴더로 복사됨(컨트롤러 업로드/배포용)
- `bin/build_manifest.json`: 빌드 메타데이터

### build_manifest.json 구조

`build_manifest.json`에는 아래 필드가 포함됩니다.

- `build_time`: 빌드 시각(UTC 문자열)
- `configuration`: Release/Debug 등
- `total_files`: 프로젝트 파일 수(스크립트 기준 집계)
- `output_directory`: 산출물 디렉토리
- `git_info.branch`, `git_info.commit`: Git 브랜치/커밋(가능한 경우)

예시:

```json
{
  "configuration": "Release",
  "git_info": {
    "branch": "main",
    "commit": "26cde4dceaa8c9ca7de627291758789641657be4"
  },
  "total_files": 20,
  "output_directory": "bin",
  "build_time": "2025-12-17 13:23:11 UTC"
}
```

## 🔧 사용법(현행)

### 1) 빌드 메타데이터 생성

- VS Code 작업: `GPL 프로젝트 빌드`

### 2) 결과 확인

- `bin/build_manifest.json`을 열어서 빌드 정보를 확인합니다.

## 🧩 런타임에서 “버전 문자열”을 보여주고 싶다면(향후 확장)

현재 GPL 런타임에서 `build_manifest.json`을 읽어 버전 문자열을 구성하는 모듈은 **아직 없습니다**.

가능한 확장 방향(제안):

- `Core_Version.gpl` 같은 모듈을 추가하여
  - `build_manifest.json`을 파싱하거나(가능하다면)
  - 또는 빌드 시점에 `Core_Version.gpl`에 상수를 자동 주입하는 방식으로
  - `Core_ErrorHandler.log("Build: ...")` 형태로 출력

이 경우 파일 추가/삭제 시 `Test_robot/Project.gpr`의 `ProjectSource` 및 로드 순서도 함께 수정해야 합니다.

---

## 🧱 모듈 버전 관리(주석 기반, 제안/권장)

질문에서 제안하신 것처럼 **모듈(또는 모듈 묶음)별 버전을 주석으로 관리**하는 방식은,
이 프로젝트처럼 "파일 추가/삭제 시 Project.gpr를 반드시 수정"해야 하는 환경에서 특히 유용합니다.

### 왜 Project.gpr에서 관리하는가?

- `Project.gpr`는 **실제 로드 순서 + 포함 파일 목록**을 한 눈에 보여주는 “패키지 매니페스트” 역할을 합니다.
- 모듈을 재사용/분리할 때, “어떤 파일들이 함께 움직여야 하는지”가 가장 중요하고,
  그 정보를 `Project.gpr`가 이미 갖고 있습니다.

### 권장 규칙(실무용)

1) **버전 단위는 2가지 중 하나로만 운영**

- (A) **모듈 묶음(pack) 버전**: `Core`, `Net(TCP stack)`, `Data`, `Robot`처럼 “함께 움직이는 단위”
- (B) **개별 파일 버전**: 특정 파일이 독립 배포/재사용될 때만

> 보통은 (A)만으로도 충분하고, (B)는 정말 독립 모듈화가 필요할 때만 추가하는 게 유지보수에 좋습니다.

2) **SemVer(권장): vMAJOR.MINOR.PATCH**

- MAJOR: 외부에서 호출하는 Public API/동작이 호환되지 않게 변경
- MINOR: 기능 추가(호환 유지)
- PATCH: 버그 수정/내부 개선(호환 유지)

3) **Project.gpr에 “묶음별 버전”을 주석으로 기록**

예:

```text
' Core v1.0.0
ProjectSource="Core_SpinLock.gpl"
ProjectSource="Core_RingQueue.gpl"
...

' Net (TCP stack) v1.0.0
ProjectSource="Net_Tcp_CommandQueue.gpl"
...
```

4) **파일 헤더에는 선택적으로 버전/변경이력만 가볍게**

- 파일 상단에 `Updated:` / `Version:` 정도만(너무 상세한 CHANGELOG는 오히려 낡기 쉬움)
- 상세 변경 이력은 Git log / PR / incidents 문서로 관리

5) “모듈화해서 언제든 가져다 쓸 수 있게” 하려면 **의존성(같이 묶어야 하는 파일)도 함께 기록**

- 예: `Data_AsyncSave`는 `Core_SpinLock`, `Core_RingQueue`, `Storage_File_Manager`에 의존
- 이런 의존 관계를 pack 단위로 생각하면 “복사/이식”이 쉬워집니다.

### 이 프로젝트에서의 현실적인 운영안(추천)

- `Project.gpr`에 **섹션별 버전(Core/IO/Net/Data/Robot)**을 기록 (질문에서 하신 방향)
- `Entry_Main.gpl`의 `ROBOT_VERSION`는 “제품/펌웨어 표시용”으로 유지
- 빌드 메타데이터(`bin/build_manifest.json`)는 “정확한 빌드 식별자”로 유지

즉, 표시 레벨을 이렇게 나누면 깔끔합니다:

- 제품 표시: `ROBOT_VERSION` (예: v1.0.0)
- 모듈 묶음 호환성: `Project.gpr` 주석 버전
- 빌드 식별: `build_manifest.json` (commit/build_time)
