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
