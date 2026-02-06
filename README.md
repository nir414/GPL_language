# GPL Language Support

현재 버전: **v0.2.11**  
GPL (Guidance Programming Language) 지원 VS Code 확장. 정의/참조 탐색, 자동완성 기능을 제공합니다.

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

## 프로젝트 구조

```
GPL_language/
├── src/                        # VS Code 확장 TypeScript 소스
│   ├── extension.ts            # 확장 진입점
│   ├── gplParser.ts            # GPL 파서
│   ├── symbolCache.ts          # 심볼 캐시 관리
│   ├── xmlUtils.ts             # XML 유틸리티
│   └── providers/              # 언어 기능 프로바이더
├── syntaxes/                   # 문법 하이라이팅
├── scripts/                    # 빌드 스크립트
├── package.json                # 확장 매니페스트
├── tsconfig.json               # TypeScript 설정
├── language-configuration.json # 언어 설정
└── README.md                   # 이 파일
```

## 기능

### 핵심 언어 기능

- **정의 찾기 (Go to Definition)**: F12 키로 함수, 클래스, 변수의 정의로 이동
- **참조 찾기 (Find All References)**: Shift+F12로 심볼이 사용된 모든 위치를 찾기
- **자동완성 (IntelliSense)**: GPL 심볼 제안
- **문서 구조 (Outline View)**: Explorer 패널에서 문서 구조 확인
- **심볼 검색 (Symbol Search)**: Ctrl+T로 빠른 탐색
- **심볼 캐시 관리**: `GPL: Refresh Symbols`, `GPL: Debug Symbol Cache`로 캐시 재생성/점검

### GPL 언어 특징

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

## 개발자 가이드 (빌드/디버그/패키징)

이 저장소는 **VS Code 확장(Extension)** 프로젝트입니다. 소스는 `src/`에 있고, 빌드 산출물은 `out/`에 생성됩니다.

> 참고: `out/` 폴더는 컴파일 결과물이라 직접 수정하지 않습니다. (변경은 `src/`에서만)

### 요구사항

- **Node.js** (권장: 16 이상)
- **npm**
- **VS Code** (엔진 요구사항: `^1.74.0`)

### 의존성 설치

```bash
npm install
```

### 로컬 빌드(컴파일)

TypeScript 컴파일로 `out/`에 확장 엔트리(`out/extension.js`)가 생성됩니다.

```bash
npm run compile
```

개발 중 자동 컴파일(감시 모드):

```bash
npm run watch
```

### VS Code에서 디버그 실행

1. VS Code의 **Run and Debug** 탭에서 "Run GPL Language Extension" 실행 (보통 F5)
2. 새로 뜨는 **Extension Development Host** 창에서 `.gpl` 파일을 열어 기능을 테스트
3. 로그는 Output 패널의 "GPL Language Support" 채널에서 확인

### 로그 설정

디버깅 시 로그 출력을 제어하려면 `.vscode/settings.json`에서 다음 옵션을 사용합니다:

```json
{
  "gpl.trace.server": "verbose"
}
```

**옵션값:**

- `off` - 로그 출력 안 함 (기본값)
- `messages` - 중요 메시지만 출력
- `verbose` - 상세 로그 출력 (디버깅 시 권장)

로그는 **Output** 패널 → **"GPL Language Support"** 채널에서 확인할 수 있습니다.

### VSIX 패키징(배포 파일 생성)

```bash
npm run package
```

성공하면 `dist/` 폴더에 `gpl-language-support-v0.2.10.vsix` 같은 파일이 생성됩니다

- `.gpl` 파일이 **Visual Basic(vb)** 으로 열릴 수 있습니다.
  - 진단(Diagnostics)이 안 뜬다면, 파일 우측 하단 언어 모드를 **GPL**로 바꿔서 확인해 보세요.

## 기여

GPL Language Support 확장 개발에 이슈 리포트나 기여를 환영합니다.

---

### 변경사항

#### v0.2.10 (현재)

- 참조 검색 개선
  - Public 모듈 멤버(`Module ...`의 `Public Sub/Function`)의 **unqualified 호출**(`Foo()`)도 워크스페이스에서 탐색
  - 워크스페이스/폴더 폴백 스캔 대상에 `*.gpo` 포함
- 심볼 캐시 최적화
  - `Project.gpr`이 있으면 `ProjectSource`에 등록된 소스만 우선 인덱싱(대형 워크스페이스 스캔 비용 절감)

#### v0.2.9

- 참조 검색 개선: 워크스페이스 밖에서 연 파일도 동일 폴더의 `*.gpl`을 폴백 스캔
  - VS Code 워크스페이스 검색에서 제외되는 파일들의 "같은 폴더 참조" 누락을 완화
  - 안전장치: 비재귀 + 최대 200개 파일로 제한

#### v0.2.8

- 파서 개선: Function/Sub 키워드를 토큰 기반으로 파싱
  - `Shared Public` 등 키워드 순서 변화에도 안정적으로 인덱싱
  - 참조 검색 누락 문제의 근본 원인 완화

#### v0.2.7

- 파서 개선: `Shared Public Function/Sub` 순서 지원 추가
  - 기존: `Public Shared Function` 순서만 인식
  - 개선: `Shared Public Function`, `Public Shared Function` 모두 인식
  - 이로 인해 이전에 인덱싱되지 않던 심볼의 참조 검색이 정상 작동

#### v0.2.4

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
