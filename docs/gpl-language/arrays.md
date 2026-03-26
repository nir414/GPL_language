# 배열 (Data Type Arrays)

출처(공식):
- Data Type Arrays: https://www2.brooksautomation.com/Controller_Software/Introduction_To_The_Software/Guidance_Programming_Language/arrays.htm

## 핵심 규칙

- **모든 기본 타입 + Object**는 배열로 선언할 수 있습니다.
- 배열 차원 수(**Rank**)는 **1~4**까지 지원됩니다.
- 각 차원의 길이/전체 원소 수는 문법이 아니라 **가용 메모리**에 의해 제한됩니다.

## 인덱스와 크기(Upper bound) 개념

- GPL 배열의 **첫 인덱스는 항상 0**입니다. (VB.NET과 동일)
- `Dim`에서 크기를 지정할 때의 숫자는 “길이”가 아니라 **상한(upper bound)** 입니다.
  - 따라서 한 차원의 원소 개수는 항상 **upperBound + 1** 입니다.

예:
- `Dim Count(9) As Integer` → 인덱스 `0..9` → **10개**

VB6의 `Option Base 1` 또는 임의 인덱스 범위(예: `10 to 20`) 개념은 GPL에서 지원되지 않습니다.

## 선언 vs 할당

- `Dim MyArray(3, 4) As Integer`
  - 2차원 배열을 선언하고 **즉시 20개 원소가 할당**됩니다.
  - (1차원 0..3, 2차원 0..4)

- `Dim MyArray(,) As Integer`
  - 2차원 배열 “형태(차원)”만 선언하고 **원소는 아직 할당하지 않습니다**.
  - 사용 전, 다른 배열을 대입하거나 `ReDim`으로 할당해야 합니다.

## 기본 초기값과 제한

- 원소가 할당될 때:
  - 숫자 배열의 원소 기본값은 `0`
  - Object 배열의 원소 기본값은 `Nothing`
- 배열 원소를 `=` 절로 초기화하는 방식은 **지원되지 않습니다**.

## ReDim

- `ReDim`은 배열의 원소를 **할당하거나 크기를 변경**하는 데 사용합니다.
- 제약:
  - `ReDim`으로 **Rank(차원 수)** 는 바꿀 수 없습니다.
  - `ReDim`은 배열을 “처음 선언”하는 용도는 아닙니다. (차원은 `Dim`으로 먼저 정해야 함)
  - `ReDim Preserve`를 쓰면 **마지막(가장 오른쪽) 차원만** 크기 변경 가능

### ReDim Preserve 동작

- 일반 `ReDim`은 **기존 내용이 사라집니다**.
- `ReDim Preserve`는 **기존 내용을 유지**합니다.
- 단, **마지막 차원만 변경 가능**합니다.

예:

```vb
Dim array(3,4) As Integer
ReDim array(4,6)

ReDim Preserve array(3, 10)   ' OK (마지막 차원만 변경)
ReDim Preserve array(4, 10)   ' 오류: 마지막 차원 외 변경
```

### 요약 체크리스트 (Index/Dim/ReDim)

- 인덱스는 **항상 0부터 시작**
- `Dim X(n)`의 의미는 **길이 n이 아니라 upper bound = n**
  - 실제 길이 = **n + 1**
- 크기 없이 `Dim X(,)`처럼 선언하면 **할당되지 않음**
- `ReDim`은 **할당/크기 변경**만 가능, **차원 수 변경 불가**
- 같은 스코프(같은 블록)에서 **동일 변수명 재선언 불가**
  - 필요 시 변수명을 구분하거나 `ReDim`으로 크기만 변경

### 실전 예시 (상한 기반 길이)

```vb
Dim axes(1) As Integer   ' 0..1, 총 2개
Dim speeds(9) As Double  ' 0..9, 총 10개

ReDim axes(3)            ' 0..3, 총 4개로 변경
```

### 패턴: 크기를 모를 때 "추가"처럼 쓰기

GPL에는 자동 확장 리스트가 없으므로, **새 배열을 만들고 복사**하는 패턴을 사용합니다.

프로젝트에서는 **객체 스타일 헬퍼**를 만들어 `Add` 형태로 사용합니다.

```vb
Dim zeroPlan As AxisZeroPlan
zeroPlan = New AxisZeroPlan(myRobot(Robot.Selected-1))
zeroPlan.Clear().AddAxis("R", "HARD-", 9.5).AddAxis("L", "HARD-", 9.5)

CustomZeroDegreeSetMulti(zeroPlan.Items)
```

> 위 예시는 내부적으로 배열을 재할당하며, 호출부는 `Add` 형태로 단순화됩니다.

## 매우 중요: 배열 대입은 “복사”가 아니라 “참조 공유”

전체 배열을 대입하면 데이터가 복사되지 않고 **포인터(참조)가 복사**되어, 두 변수가 **같은 데이터**를 바라봅니다.

- `CountB = CountA` → `CountB`는 `CountA`와 동일한 배열을 참조

이 동작은 객체 변수와 유사하므로, 독립 사본이 필요하면 별도의 “원소 단위 복사” 로직을 고려해야 합니다.

## 프로시저 인자 전달(개요)

- 단일 원소를 인자로 넘기면 일반 변수처럼 동작합니다.
- 전체 배열을 넘기면 배열 값/변수에 대한 **포인터 전달**이 일어나며, 객체 전달과 유사한 ByVal/ByRef 의미를 갖습니다.

## Array 클래스 속성

모든 배열은 내장 `Array` 클래스의 멤버이며, 다음 속성으로 배열의 성질을 확인할 수 있습니다.

- `array.GetUpperBound(dim)`
  - 해당 차원의 upper bound 반환
  - lower bound는 항상 0 → 원소 수는 `upperBound + 1`
- `array.Length`
  - 전체 차원의 총 원소 수
- `array.Rank`
  - 차원 수

주의: 이 속성들은 **배열 전체에만** 적용되며, 부분 배열/개별 원소에는 사용할 수 없습니다.

## 자주 헷갈리는 포인트(String 배열)

예: `Dim sarray(3) As String`

- `sarray.Length` 는 **배열 길이(원소 개수)** → 4
- `sarray(0).Length` 는 **문자열 길이** → 초기에는 0
