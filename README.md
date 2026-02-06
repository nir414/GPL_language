# GPL Language Support

[![Version](https://img.shields.io/badge/version-0.2.11-blue.svg)](https://github.com/nir414/GPL_language/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

GPL (Guidance Programming Language) 지원 VS Code 확장 프로그램입니다. Brooks Automation 로봇 제어를 위한 GPL 언어의 IntelliSense, 정의/참조 탐색, 자동완성 등의 기능을 제공합니다.

## 주요 기능

- **정의 찾기** (F12) - 함수, 클래스, 변수의 정의로 빠르게 이동
- **참조 찾기** (Shift+F12) - 심볼이 사용된 모든 위치 검색
- **자동완성** (IntelliSense) - GPL 심볼 제안 및 자동 완성
- **문서 구조** - Explorer 패널에서 파일 구조 확인
- **워크스페이스 심볼 검색** (Ctrl+T) - 빠른 심볼 탐색
- **VB.NET 호환성 진단** - 미지원 함수/구문 감지 및 경고

## 설치

1. 최신 릴리즈 `.vsix` 파일을 준비합니다. (예: `gpl-language-support.vsix`)
2. VS Code에서 설치:
   - 좌측 Activity Bar에서 **Extensions**(확장) 뷰를 엽니다. (단축키: `Ctrl+Shift+X`)
   - Extensions 패널 우측 상단의 **…(More Actions)** 메뉴를 클릭합니다.
   - **Install from VSIX...** 를 선택한 뒤, 준비한 `.vsix` 파일을 지정합니다.
   - 설치 후 안내가 뜨면 **Reload**(창 다시 로드) 또는 VS Code 재시작을 진행합니다.
3. GPL 파일을 열면 확장이 활성화됨
   - 설치 확인: Extensions 목록에서 "GPL Language Support"가 **Installed**로 표시되는지 확인합니다.

> 참고: 이 저장소에서 `npm run package`를 실행하면 `.vsix`는 기본적으로 `dist/gpl-language-support-<version>.vsix`로 생성됩니다.

## GPL 언어 소개

GPL (Guidance Programming Language)은 Brooks Automation에서 개발한 로봇 제어 전용 언어입니다:

- **VB.NET 기반 문법**: 익숙한 VB.NET 스타일 코드
- **모듈 시스템**: Classes, Modules, Functions/Subs
- **임베디드 환경**: Guidance 컨트롤러에 내장되어 실시간 제어
- **로봇 제어**: 모션 제어, 머신 비전, PreciseFlex 로봇 프로그래밍
- **산업 응용**: 바이오/의료 샘플 핸들링, 전자/반도체 자동화

### VB.NET 호환성 진단

- 미지원 함수 감지
- Optional 파라미터 사용 체크
- On Error 구문 감지
- Dictionary/Object 타입 사용 경고

## GPL 언어 참고 자료

GPL 언어 개발을 위한 공식 문서:

- **[Brooks Automation GPL Reference](https://www2.brooksautomation.com/Controller_Software/Introduction_To_The_Software/Guidance_Programming_Language/)** - 공식 언어 레퍼런스
- **[GPL 자동 실행 모드](https://www2.brooksautomation.com/Controller_Software/Introduction_To_The_Software/Controller_Automatic_Execution_Modes/mode_gpl.htm)** - 자동 실행 설정

## 명령어

- `GPL: Refresh Symbols` - 심볼 캐시 수동 새로고침
- `GPL: Debug Symbol Cache` - 파일별 심볼 목록과 파싱 상태 확인

## 개발 가이드

이 프로젝트에 기여하고 싶으신가요? 자세한 개발 환경 설정, 코딩 가이드라인, PR 제출 방법은 [CONTRIBUTING.md](CONTRIBUTING.md)를 참고하세요.

### 빠른 시작

```bash
# 저장소 클론
git clone https://github.com/nir414/GPL_language.git
cd GPL_language

# 의존성 설치
npm install

# 빌드
npm run compile

# VS Code에서 F5로 디버그 실행
```

### 프로젝트 구조

```
GPL_language/
├── src/                        # TypeScript 소스 코드
│   ├── extension.ts            # 확장 진입점
│   ├── gplParser.ts            # GPL 파서
│   ├── symbolCache.ts          # 심볼 캐시 관리
│   └── providers/              # 언어 서비스 프로바이더
├── syntaxes/                   # TextMate 문법 정의
├── language-configuration.json # 언어 설정 (괄호, 주석 등)
└── package.json                # 확장 매니페스트
```

## 기여하기

버그 리포트, 기능 제안, Pull Request를 환영합니다!

- **버그 리포트**: [Issues](https://github.com/nir414/GPL_language/issues)에 상세한 재현 방법과 함께 제출
- **기능 제안**: 사용 사례와 함께 Issue로 제안
- **Pull Request**: [기여 가이드라인](CONTRIBUTING.md) 참고

## 변경 이력

버전별 상세 변경 사항은 [CHANGELOG.md](CHANGELOG.md)를 참고하세요.

## 라이선스

이 프로젝트는 [MIT License](LICENSE)로 배포됩니다.

## 링크

- [GitHub Repository](https://github.com/nir414/GPL_language)
- [Issues](https://github.com/nir414/GPL_language/issues)
- [Brooks Automation GPL 공식 문서](https://www2.brooksautomation.com/Controller_Software/Introduction_To_The_Software/Guidance_Programming_Language/)
- GitHub 공개/배포 준비 정리: CI 추가, `.gitignore`/`.vscodeignore` 정비, README/메타데이터 업데이트

#### v0.2.2

- VB.NET 호환성 진단 추가: 미지원 함수/Optional/On Error/Dictionary/Object 사용 감지
- 코드 액션/자동완성 확장: 테스트 코드 삽입, 호환성 대안 제안
- 심볼 캐시 디버그 명령 추가 (`GPL: Debug Symbol Cache`)
- 출력 로그/초기화 메시지 개선

#### v0.1.3

- 코드 액션/자동완성 개선

#### v0.1.2

- 핵심 언어 지원 기능 (정의/참조/자동완성)
- 문서 구조 및 워크스페이스 심볼 검색
