# 오류 해결 후 즉시 실행 체크리스트 (반복 오류 방지)

## 원칙
컴파일 오류를 발견했을 때, 수정 후 **항상 다음 검사**를 전역 단위로 실행하세요.
한 파일의 오류만 수정하면 다른 파일에서 같은 오류가 반복될 수 있습니다.

---

## 9.1 미정의 심볼 사냥 (한 파일이 아닌 전체 프로젝트)

**오류 패턴**: `(-729) *Undefined symbol* <symbol>`

**자주 나오는 미정의 심볼들**:
- `Trim` (VB 내장 함수)
- `Left`, `Right` (VB 내장 함수)
- `Val` (VB 내장 함수)
- `vbCrLf`, `vbTab` (VB 상수)
- `Select Case` (VB 제어구조) / `Select` (버전/방언 차이로 혼동 지점)

**수정 방법**:

1. **전역 검색**: 동일 심볼이 다른 파일에도 있는지 확인
    - VS Code: `Ctrl+Shift+F` (검색) / `Ctrl+Shift+H` (바꾸기)
    - PowerShell 예시(선택): `Select-String -Path "Test_robot\\*.gpl" -Pattern "Trim\(" -List`
    - (참고) bash/grep 사용 환경이면 아래처럼 검색 가능
      ```bash
      grep -r "Trim(" Test_robot/ --include="*.gpl"
      ```

2. **GPL 대체 함수 매핑**:
   | VB 함수 | GPL 대체 | 비고 |
   |---------|---------|------|
   | `Trim(s)` | `Core_StringUtils.SafeTrim(s)` | 공용 헬퍼 사용 |
   | `Left(s, n)` | `Mid(s, 1, n)` | 앞에서 n자 추출 |
   | `Right(s, n)` | `Mid(s, Len(s)-n+1)` | 뒤에서 n자 추출 |
   | `Val(s)` | `CInt(s)` 또는 `CDbl(s)` | 명시적 타입 변환 |
    | `vbCrLf` | `Core_Utils.CRLF` | 표준 상수 사용 |
     | `vbTab` | `Core_Utils.TAB` | 탭 문자 (상수 통일) |

3. **동시 교체**: 모든 용도 지점을 한 번에 교체 (프로젝트 전체)
    - 목적: 휴먼 에러 방지 + 시간 절약
    - 권장: VS Code 전역 바꾸기 사용

---

## 9.1-1 컴파일 파서 실수 사냥 (문자열 이스케이프/줄바꿈)

다음은 *미정의 심볼*이 아니라 **파서가 문장을 잘못 해석해서** 터지는 유형을 빠르게 잡는 체크다.

- [ ] `(-722) Unexpected text at end of line`가 나면, 줄바꿈 누락만 보지 말고 **문자열 리터럴 이스케이프**도 같이 의심한다.
- [ ] 특히 `\"` 패턴이 남아있는지 전역 검색한다 (GPL은 `"` 스타일 미지원 → 문자열 내부 따옴표는 `""`로 표현).

권장 전역 검색 키워드:
- `\\\"` (문자열 안에 들어간 `\"`)
- `End If        ` (제어문 뒤에 같은 줄로 문장이 붙는 패턴)

---

## 9.2 제어구조 짝 점검 (분기문: If/ElseIf 기본, Select는 상황별)

**오류 패턴**: `(-748) *No matching control structure*`

**원인**:
- 컨트롤러/프로젝트/방언에 따라 `Select` 계열 문법 지원이 들쭉날쭉할 수 있음
    - 일부 코드베이스에서는 `Select <expr> ... Case ... End Select` 형태가 동작하지만,
        `Select Case <expr>` 형태는 실패하는 경우가 있음(혼동 포인트).
- `Continue For` / `Continue While` 등은 미지원

**수정 방법**:

❌ 호환성 문제를 일으키기 쉬운 예(방언/버전 차이):
```vb
Select Case ch
    Case "["
        pos = pos + 1
    Case "]"
        pos = pos + 1
    Case Else
        pos = pos + 1
End Select
```

✅ 가장 안전한 예(항상 호환되도록 If/ElseIf 사용):
```vb
If ch = "[" Then
    pos = pos + 1
ElseIf ch = "]" Then
    pos = pos + 1
Else
    pos = pos + 1
End If
```

✅ 가독성이 더 좋은 상황(상수 분기, 케이스가 명확할 때):
- 프로젝트에서 `Select <expr> ... Case ... End Select` 형태가 동작하는 것이 확인된 경우에만 사용
- hot path에서 로직이 간단하고 분기 대상이 "열거형/상수"일 때에 적합

**확인 방법**:
- VS Code: `Ctrl+Shift+F`로 아래 키워드 검색
    - `Select Case`
    - `Continue For`
    - `Continue While`
- (참고) bash/grep 사용 환경이면 아래처럼 검색 가능
    ```bash
    grep -r "Select Case" Test_robot/ --include="*.gpl"
    grep -r "Continue For" Test_robot/ --include="*.gpl"
    grep -r "Continue While" Test_robot/ --include="*.gpl"
    ```

---

## 9.3 표준 상수/유틸 일관성 검사

코드 리뷰 시 항상 체크:

- [ ] **개행 문자**: `Core_Utils.CRLF` 사용? (vbCrLf 미사용?)
- [ ] **탭 문자**: `Core_Utils.TAB` 사용? (vbTab 미사용?)
- [ ] **타임스탬프**: `Core_Utils.timeString()` 사용? (직접 `Controller.PDB(121)` 호출 금지)
- [ ] **로그**: `Core_ErrorHandler.log()` 또는 `Console.WriteLine()` 사용?
- [ ] **파일 I/O**: `Storage_File_Manager` 또는 `Data_AsyncSave` 사용? (raw StreamWriter 최소화)
- [ ] **스레드 동기화**: `Thread.TestAndSet()` 사용? (Mutex/Lock 미사용)
- [ ] **Socket 안전**: `Socket`(또는 Session 내부 Socket) **Property에 `Nothing` 대입 금지** (대입 순간 컨트롤러 크래시/정지 버그 재현, Try/Catch로 방지 불가)
- [ ] **예외 처리**: `Catch`에서 예외를 조용히 무시하지 않음 (필요 시 throttle 로깅 또는 상위 전파)

추가 체크(경계 입력 방어):

- [ ] **배열 인자 Nothing**: `arr.Length`/`arr(i)` 접근 전 `If arr Is Nothing Then ...` 가드가 있는가?
- [ ] **바이너리 문자열 파싱**: `Byte` 변환은 최대 8비트만 처리하고(오른쪽 LSB 기준), 입력에 공백/접두사(0b)가 섞여도 안전한가?

---

## 9.3.1 과보호(Over-defensive) 방지 규칙 (일관성)

다음 규칙을 지키면 코드 스타일이 일관되고, 불필요한 `Nothing` 체크/중복 초기화가 줄어듭니다.

- [ ] **불변식(invariant) 우선**: 내부 필드/구성요소는 `New()` 또는 `Ensure()` 단계에서 1회 초기화하고, 이후 메서드에서는 재초기화/재할당을 하지 않는다.
    - 예: `m_q` 같은 큐 필드는 생성자에서 생성 → `Reset/Enqueue/TryDequeue`에서 `If m_q Is Nothing Then ...` 금지
- [ ] **hot path에서 lazy init 금지**: 루프/통신 경로처럼 자주 호출되는 곳에서 `EnsureX()`를 반복 호출하지 않는다.
    - 대신 **진입점(생성/등록/바인딩 단계)**에서 1회 보장한다.
- [ ] **경계(boundary)에서만 방어**: 외부 입력/IO/네트워크/배열 인덱스처럼 깨질 수 있는 지점만 방어한다.
    - 예: `If line Is Nothing Then line = ""`, 범위 체크, socket/session `Nothing` 체크는 유지
- [ ] **중복 검증/중복 조회 금지**: `IsValidX()`로 검증한 뒤 곧바로 `TryGetX()`/`GetX()`를 다시 호출하는 패턴을 만들지 않는다.
    - 원칙: *검증과 조회가 분리되어 중복 호출을 유발*하면, **한 번의 `TryGet*`로 검증+획득을 끝낸다.**
    - 예(권장): `If TryGetX(key, value) = 0 Then log... : Exit Sub`
    - (경고) `IsValidX`가 내부에서 `TryGetX`를 호출하는 얇은 래퍼라면, 호출부에서 2번 조회하는 실수로 이어지기 쉽다.
- [ ] **상한 통일**: 연결 수/채널 수처럼 서로 연동되는 상수는 한 군데에서 정의하거나, 최소한 상한을 강제해 불일치를 만들지 않는다.
    - 예: TCP connection 수가 command queue 채널 수를 넘지 않게 제한

---

## 9.4 빌드 후 최종 검증

### Step 1: 컴파일
```bash
npm run compile --prefix "gpl-language-extension"
scripts/BuildProject.ps1
```

### Step 2: 새로운 오류 확인

### Step 3: 문서 갱신 (선택사항)


## 참고 자료
- **GPL 언어 가이드**: `docs/Project/GPL_언어_실무_가이드.md`
- **일반 실수 모음**: `docs/Project/COMMON_MISTAKES.md`
- **파일 I/O**: `docs/Project/FILE_IO_IMPLEMENTATION.md`
- **문자열 API**: `docs/Project/STRING_API_GUIDE.md`

---

## 생성 날짜
- 2025-12-09
- 업데이트: 매 오류 해결 후 반영
