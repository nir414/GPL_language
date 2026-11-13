# GPL 지원 데이터 타입 및 상수 정리

## 지원 데이터 타입
- Boolean: True(<>0)/False(=0)
- Byte: 0~255 (8비트)
- Short: 16비트 정수
- Integer: 32비트 정수
- Single: 32비트 부동소수점
- Double: 64비트 부동소수점
- String: 임의 길이 문자열
- Object: 시스템 구조/클래스용 포인터(사용자 정의 불가)

## 미지원 데이터 타입 (VB6/VB.NET)
- Long/Int64: 64비트 정수
- Decimal: 96비트 정수
- Int16/Int32: Short/Integer의 별칭
- Char: 16비트 유니코드
- Variant: VB6 범용 타입
- Date: 날짜/시간

## 타입 지정 문자 미지원
- 변수/상수 선언 시 접미사(예: 725L, Abc!) 불가

## 자동/명시적 타입 변환
- 모든 정수형은 부동소수점 연산 시 자동 변환
- 명시적 변환 함수: CBool, CByte, CDbl, CInt, CShort, CSng, CStr, Hex
- `CStr`은 큰 값을 소문자 지수 표기로 쓴다: `CStr(1E+32)` = `"1e+32"`(2026-11-03 실기, [strings §8](strings.md))

## 상수
- GPL_CR: ASCII CR(13)
- GPL_LF: ASCII LF(10)
- 로봇 자세(configuration) 지정 플래그 — 같은 목표 위치에 대해 팔이 취할 자세를 선택하는 비트 값
  ([원문](https://www2.brooksautomation.com/Controller_Software/Introduction_To_The_Software/Guidance_Programming_Language/data_type_and_variables.htm) 표현 그대로 유지):
  - GPL_Righty: Assert right shouldered configuration (&H01)
  - GPL_Lefty: Assert left shouldered configuration (&H02)
  - GPL_Above: Assert elbow above wrist configuration (&H04)
  - GPL_Below: Assert elbow below wrist configuration (&H08)
  - GPL_Flip: Assert wrist pitched up configuration (&H10)
  - GPL_NoFlip: Assert wrist pitched down configuration (&H20)
  - GPL_Single: Assert restrict wrist position to within +/- 180 degrees (&H1000)

## 기타
- 모든 입력 문자는 7비트 ASCII만 허용
- 8비트 ASCII/유니코드 문자, 심볼명/문자열 리터럴 불가
- 16진수: &H, 8진수: &O (문자열 연결 시 & 뒤에 공백 필요)

## 변수 기본값 (선언만 한 변수의 값)

2026-11-06 Sample Prep 실측(GPL 4.2K5 시뮬 제어기, 프로브 `ZEROINIT_Probe`)에서 선언만 하고 값을 넣지 않은 변수는 모두 아래 값이었습니다.

| 대상 | 기본값 |
| --- | --- |
| `Integer` · `Double` | 0 |
| `Boolean` | False |
| 객체 참조 | Nothing |
| `String` | **Nothing** (빈 문자열 `""` 가 아님) |
| 클래스 고정 배열 `Dim a(3) As …` · 생성자 `ReDim` 배열 | 0 · False · Nothing |
| 모듈 변수 · 모듈 고정 배열 | 0 |
| 지역 변수 | 호출마다 0 (앞 호출 값을 갖지 않음) |

- 객체 300개를 채워 쓰고 버린 뒤 새로 만든 객체도 같은 기본값이었습니다(힙 재사용 쓰레기값 없음).
- 채운 배열에 `ReDim`(Preserve 없음)을 하면 전부 0, `ReDim Preserve` 로 늘어난 칸도 0 입니다.
- 그래서 생성자의 `= 0` · `= False` · `= Nothing` 초기화 줄은 필요 없습니다. 확장에는 숫자·Boolean·객체의 "초기화되지 않은 변수" 경고가 없습니다.
- `String` 만 Nothing 이라, 빈 문자열이 필요하면 `""` 로 채워야 `Len`·ByVal 전달에서 `-782` 를 피합니다. 단 객체를 많이 만드는 클래스는 칸마다 메모리가 더 듭니다([memory-costs](memory-costs.md) §3).
- `CStr(Controller.PDb(110))` 이 시리얼 문자열(`"0014FF-02300289"`)이 아니라 `"14"` 를 돌려줬습니다(2026-11-06 Sample Prep 실측, **미확정** — 문서상 110 은 Controller serial number 문자열 DataID).
  프로그램에서 `PDb(110)` 로 제어기를 판별하는 코드는 값을 확인하고 쓰세요.

## Static 로컬 변수 — 선언 시 초기화 금지

GPL 4.2K5 실기기에서 **`Static` 로컬 변수에 선언과 동시에 초기값을 주면, 호출할 때마다
값이 다시 초기화되는 듯한 동작**이 재현됐다(누적 카운터가 계속 1로 유지). 재현 로그는
[2026-01-02 세션 기록](../archive/sessions/2026-01-02.md) 5절 참조.

- **Static 로컬 변수는 선언 시 초기화(`= 0` 등)를 피한다.**
- 초기값이 필요하면 "첫 호출 1회만" 초기화하는 가드 패턴을 쓴다:

```vb
Private Sub Example()
    Static inited As Integer
    Static counter As Integer

    If inited = 0 Then
        counter = 0
        inited = 1
    End If

    counter = counter + 1
End Sub
```

## 배열(Arrays)

배열은 별도 문서로 분리했습니다.

- **[arrays.md](arrays.md)**: 0-based 인덱스 규칙, upper bound 의미, `ReDim` 제약, 배열 대입 시 참조 공유(포인터 복사) 동작, `Array.Length/Rank/GetUpperBound` 정리
