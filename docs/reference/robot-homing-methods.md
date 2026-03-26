# Robot Homing Methods (요약)

출처(공식):
- Introduction to the Homing Methods: https://www2.brooksautomation.com/Controller_Software/Software_Setup/Selected_Setup_Procedures/Robot_Homing_Configuration/Homing_Methods/homingmethodsdetail.htm
- Method 1: https://www2.brooksautomation.com/Controller_Software/Software_Setup/Selected_Setup_Procedures/Robot_Homing_Configuration/Homing_Methods/method1.htm
- Methods 17 to 30: https://www2.brooksautomation.com/Controller_Software/Software_Setup/Selected_Setup_Procedures/Robot_Homing_Configuration/Homing_Methods/method17_30.htm

## 큰 그림: Index(Encoder Zero Index) 사용 여부

- **Methods 1–14**는 엔코더의 **Zero Index(인덱스 펄스)** 신호를 사용해 홈을 정의합니다.
  - 문서 기준으로, 인덱스를 사용할 수 있다면 일반적으로 더 정확한 홈 결과를 기대할 수 있습니다.
- 엔코더가 Zero Index를 제공하지 않는 경우, 인덱스를 쓰지 않는 유사 절차를 선택합니다.
  - 규칙: **방법 번호에 16을 더하면** 인덱스 신호를 무시하는 절차가 됩니다.

공식 설명의 핵심 규칙:

- `noIndexMethod = indexMethod + 16`
  - 예: Method 1의 “인덱스 없는 버전”은 Method 17
  - 예: Methods 3,4의 “인덱스 없는 버전”은 Methods 19,20

## 지원되는 방법(분류)

소개 페이지에 정리된 방법군(세부는 각 링크 참조):

- Method -10, -11: 단일 Index Pulse 기반 홈
- Method -9: 3rd party absolute encoder 기반 홈
- Methods -5 ~ -8: Precise pseudo absolute encoder 기반 홈
- Methods -1 ~ -4: Hard limits stop 기반 홈
- Method 1: Negative limit switch 기반 + Index pulse
- Method 2: Positive limit switch 기반
- Methods 3 ~ 14: Home switch + Index pulse 조합
- Methods 15, 16: Reserved
- Methods 17 ~ 30: Index pulse 없이 홈 (1~14의 +16 버전)
- Methods 31, 32: Reserved
- Methods 33, 34: Index pulse 기반 홈
- Method 35: 현재 위치를 홈으로 정의

## 예시: Method 1 (Negative Limit Switch + Index)

공식 문서 요지:

- Negative limit switch 상태에 따라 초기 이동 방향이 결정됩니다.
- 홈 위치는 단순히 스위치 지점이 아니라,
  - **Negative limit switch가 비활성으로 돌아오는 지점의 오른쪽(+) 방향에서 최초로 검출되는 인덱스 펄스**로 정의됩니다.

즉, 스위치는 “찾기/복귀”의 기준이고, 최종 홈은 “인덱스 펄스”로 정밀하게 고정되는 구조입니다.

## Methods 17–30 (인덱스 없이 Homing)

공식 문서 요지:

- Methods 17–30은 Methods 1–14와 유사하지만,
- 홈 위치가 인덱스 펄스가 아니라 **Home/Limit 스위치 전이(transition)** 에만 의존합니다.

## 선택 가이드(요약)

- Zero Index가 있는 엔코더를 사용할 수 있다면: **Methods 1–14 계열**을 우선 검토
- Zero Index가 없다면: 해당 방법에 **+16**한 **Methods 17–30 계열**을 사용

> 주의: 실제 장비 구성(리미트/홈 센서/하드스톱)과 안전 요구사항에 따라 적절한 방법 선택이 달라질 수 있습니다. 운영 표준은 현장 매뉴얼/사양서와 함께 확정하세요.

