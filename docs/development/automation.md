# Controller 자동 업로드 시스템

GPL Controller 프로젝트를 자동으로 ZIP으로 압축하고 Controller에 업로드하는 완전 자동화 시스템입니다.

## 📋 개요

이 시스템은 다음 작업을 자동으로 수행합니다:

1. ✅ 프로젝트 폴더를 ZIP으로 압축
2. ✅ Controller 프로그램 정지
3. ✅ ZIP 업로드 다이얼로그 트리거
4. ✅ 파일 선택 및 업로드 실행
5. ✅ 업로드 완료 대기 (타임아웃 관리)
6. ✅ Controller 프로그램 시작

## 🚀 빠른 시작

### VSCode에서 실행

1. **명령 팔레트** 열기: `Ctrl+Shift+P`
2. **Tasks: Run Task** 선택
3. 다음 중 하나 선택:
   - `Controller 업로드 (자동)` - 업로드 후 자동으로 프로그램 시작
   - `Controller 업로드 (시작 안함)` - 업로드만 수행, 시작 안함

### 터미널에서 직접 실행

```powershell
# 기본 실행 (자동 시작)
powershell -ExecutionPolicy Bypass -File scripts/UploadController.ps1

# 시작하지 않고 업로드만
powershell -ExecutionPolicy Bypass -File scripts/UploadController.ps1 -SkipStart

# 커스텀 ZIP 경로 지정
powershell -ExecutionPolicy Bypass -File scripts/UploadController.ps1 -ZipPath "C:\Temp\myproject.zip"

# 타임아웃 변경 (기본 120초)
powershell -ExecutionPolicy Bypass -File scripts/UploadController.ps1 -UploadTimeout 180
```

## 📁 파일 구조

```
scripts/
├── ControllerAutomation.ps1    # UI Automation 핵심 모듈
├── UploadController.ps1         # 통합 실행 스크립트
├── BuildProject.ps1             # 기존 빌드 스크립트
└── copy_project.ps1             # 기존 복사 스크립트
```

## ⚙️ 파라미터 설명

### UploadController.ps1

| 파라미터 | 타입 | 기본값 | 설명 |
|---------|------|--------|------|
| `-ProjectDir` | string | `Test_robot` | 압축할 프로젝트 디렉토리 |
| `-ZipPath` | string | 자동 생성 | ZIP 파일 저장 경로 |
| `-WindowTitle` | string | `*Guidance*` | Controller 창 검색 패턴 |
| `-UploadTimeout` | int | `120` | 업로드 대기 타임아웃 (초) |
| `-SkipStart` | switch | - | 업로드 후 시작하지 않음 |

## 🔧 작동 원리

### 1. ZIP 생성
- 프로젝트 디렉토리 전체를 `.zip`으로 압축
- 기존 ZIP 파일이 있으면 삭제 후 재생성
- .NET Compression을 사용하여 최적 압축

### 2. UI Automation
- Windows UI Automation Framework 사용
- Controller 창을 자동으로 찾아서 제어
- 버튼 클릭, 텍스트 입력, 상태 확인 등 모두 자동화

### 3. 안전 장치
- 각 단계마다 실패 감지 및 에러 처리
- 타임아웃 설정으로 무한 대기 방지
- 업로드 실패 시 자동 재시도 없음 (수동 개입 필요)
- 모든 작업 로그 기록

### 4. 상태 모니터링
- 업로드 진행 상황 실시간 추적
- 완료/에러 상태 자동 감지
- 프로그램 실행 상태 확인

## 📊 실행 로그 예시

```
[2025-12-08 14:30:15] [INFO] Configuration:
[2025-12-08 14:30:15] [INFO]   Project Directory: Test_robot
[2025-12-08 14:30:15] [INFO]   ZIP Path: C:\...\upload_20251208_143015.zip

=== Step 1 : Creating project ZIP ===

[2025-12-08 14:30:16] [SUCCESS] ZIP created successfully (Size: 2.45 MB)

=== Step 2 : Finding Controller window ===

[2025-12-08 14:30:17] [SUCCESS] Found window: Guidance Development Suite

=== Step 3 : Stopping controller program ===

[2025-12-08 14:30:18] [SUCCESS] Program stopped

=== Step 4 : Triggering ZIP upload dialog ===

[2025-12-08 14:30:20] [SUCCESS] Upload dialog should be open now

=== Step 5 : Selecting ZIP file ===

[2025-12-08 14:30:22] [SUCCESS] File selected and confirmed

=== Step 6 : Waiting for upload to complete ===

[2025-12-08 14:30:45] [SUCCESS] Upload completed successfully

=== Step 7 : Starting controller program ===

[2025-12-08 14:30:47] [SUCCESS] Program started successfully

╔═══════════════════════════════════════════════════╗
║          Upload Completed Successfully!          ║
╚═══════════════════════════════════════════════════╝

[2025-12-08 14:30:47] [SUCCESS] Total execution time: 00:32
```

## 🛠️ 문제 해결

### Controller 창을 찾을 수 없음
- Controller 애플리케이션이 실행 중인지 확인
- `-WindowTitle` 파라미터로 정확한 창 제목 패턴 지정
  ```powershell
  -WindowTitle "*정확한창제목*"
  ```

### 업로드 버튼을 찾을 수 없음
- Controller UI가 정상적으로 로드되었는지 확인
- 다른 다이얼로그가 열려있지 않은지 확인
- `ControllerAutomation.ps1`의 버튼 이름 패턴 수정

### 업로드 타임아웃
- 네트워크 상태 확인
- ZIP 파일 크기가 너무 크지 않은지 확인
- `-UploadTimeout` 파라미터로 대기 시간 늘리기
  ```powershell
  -UploadTimeout 300  # 5분
  ```

### 파일 다이얼로그 처리 실패
- Controller 버전에 따라 다이얼로그 구조가 다를 수 있음
- `Select-ZipFile` 함수에서 다이얼로그 이름 패턴 조정 필요

## 🔒 안전성 규칙

1. **대상 창 미발견 시 즉시 중단**
   - Controller 창이 없으면 작업 진행 안함

2. **타임아웃 필수**
   - 모든 대기 작업에 타임아웃 설정
   - 무한 대기 방지

3. **자동 재시도 금지**
   - 업로드 실패 시 수동 확인 필요
   - 반복 실패로 인한 리소스 낭비 방지

4. **상세 로깅**
   - 모든 단계별 로그 기록
   - 문제 발생 시 디버깅 용이

5. **에러 복구 불가 시 즉시 종료**
   - 명확한 에러 메시지 출력
   - 수동 개입 가이드 제공

## 🎯 활용 팁

### 단축키 설정
`keybindings.json`에 추가:
```json
{
  "key": "ctrl+shift+u",
  "command": "workbench.action.tasks.runTask",
  "args": "Controller 업로드 (자동)"
}
```

### 빌드 + 업로드 통합
연속 작업이 필요하면 tasks.json에 dependsOn 추가:
```json
{
  "label": "빌드 후 업로드",
  "dependsOn": ["GPL 프로젝트 빌드", "Controller 업로드 (자동)"],
  "dependsOrder": "sequence"
}
```

### 커스터마이징
- `ControllerAutomation.ps1`에서 버튼 이름, ID 패턴 수정
- 특정 환경에 맞게 타임아웃, 대기 시간 조정
- 추가 안전 체크 로직 구현 가능

## 📝 주의사항

1. **PowerShell 실행 정책**
   - 스크립트 실행을 위해 `-ExecutionPolicy Bypass` 필요
   - 또는 시스템 정책 변경: `Set-ExecutionPolicy RemoteSigned`

2. **UI Automation 권한**
   - Windows UI Automation은 관리자 권한 불필요
   - 단, 대상 애플리케이션과 같은 권한 레벨 필요

3. **Controller 버전 호환성**
   - Controller UI가 업데이트되면 버튼 이름/ID 변경 가능
   - 필요시 `ControllerAutomation.ps1` 수정

4. **동시 실행 금지**
   - 여러 인스턴스 동시 실행 불가
   - 한 번에 하나의 업로드만 처리

## 🔄 업데이트 히스토리

- **2025-12-08**: 초기 버전 완성
  - 전체 자동화 워크플로우 구현
  - VSCode tasks.json 연동
  - 안전성 규칙 적용
  - 상세 로깅 시스템 추가

## 📞 지원

문제가 발생하면:
1. 로그 메시지 확인
2. Controller 애플리케이션 상태 확인
3. 스크립트 파라미터 조정
4. 필요시 `ControllerAutomation.ps1` 커스터마이징

---

**Made with ❤️ for GPL Development**
