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

## 실기 메모: GPL에서 홈 관련 PDB 읽기·쓰기 (2026-10-21)

출처: Sample Prep Binder 4Ch 로봇 1(절대값 엔코더, GPL 4.2K5)에서 읽고 실행한 결과다. 공식 문서가 아니라 한 장비의 관측이므로,
다른 로봇·펌웨어에서는 값을 먼저 읽어 확인한다.

### 접근 형식

- 로봇 단위 값: `Controller.PDbNum(id, robot)`
- 축 단위 값: `Controller.PDbNum(id, robot, 0, axis)` — robot·axis는 1부터([arrays.md](../gpl-language/arrays.md) 표 참고)

### 이번에 확인한 DataID

| DataID | 이름(PDB 표기) | 단위 | 관측값·뜻 |
| --- | --- | --- | --- |
| 2800 | Robot homed | 로봇 | 홈 완료 여부 |
| 2802 | Homing sequence | 로봇 | 1 |
| 2803 | Homing method | 축 | 35 = 현재 위치를 홈으로 정의(움직이지 않음) |
| 10106 / 10107 | Positive / Negative overtravel DIN signal | 축 | 오버트래블 입력 신호 번호 |
| 10201 | Encoder type | 축 | 44·40 = 절대값, 41 = 인크리멘탈 (이 장비는 44) |
| 12252 | Raw absolute position, ecnt | 축 | 엔코더 원시 절대 위치 |
| 16120 | Calibration home offset, mcnt | 축 | 홈 오프셋 |
| 901 | (PDB flash 저장) | — | `Controller.PDbNum(901, robot, 0, 0) = 1`로 저장(기존 코드 근거, 이번엔 실행 안 함) |

### Factory Zero(현위치 = 0) 절차

절대값 엔코더 축에서 "지금 자세를 0도로" 만드는 절차다. 실기에서 X·Y·Z가 0.000이 되는 것을 확인했다(축 정지 상태에서 실행).

1. 바꿀 축의 2803(Homing method)과 16120(Calibration home offset)을 백업한다.
2. 2803을 35로 둔다(현재 위치를 홈으로 정의 — 축이 움직이지 않는다).
3. `16120 = -12252`(원시 절대 위치의 부호 반전)로 쓴다.
4. `Robot.Home`을 실행한다.
5. `Finally`에서 2803을 원래 방식으로 복원한다.
6. 결과를 유지하려면 901로 PDB를 flash에 저장한다. **되돌릴 수 없으므로 마지막에, 사람이 판단해 실행한다.**

구현 참고: Sample Prep 라이브러리 `Robot.gpl`의 `JointRobot.SetFactoryZeroHere`.

## 실기 관측 메모 — 방향·오버트래블·원점·조그 (2026-10-23, Binder 8Ch)

Sample Prep 세션이 실기에서 확인한 사실이다. 공식 문서와 다를 수 있는 부분은 관측으로 표시했다.

| 주제 | 관측 |
| --- | --- |
| 축 방향 반전 | DataID **10202** *Encoder sign*과 **10609** *Torque sign*을 **같은 축에서 함께** 부호 반전하면 방향이 바뀐다(실기 값 `1, 1, -1` — Z만 반전). 위치 부호가 바뀌므로 16120(홈 오프셋)·소프트 리밋·10106/10107 +/- 배정을 다시 맞춘다. |
| 오버트래블 신호 | 10106/10107에 원격 IO 소프트 신호(2000x)도 쓸 수 있다. 켜진 신호 하나가 **그 로봇의 모든 관절 이동**을 막는다(`-1035` *Positive overtravel*). 일반 이동은 반대 방향도 거부하지만 관절 조그(`Move.SetJogCommand`)로는 반대 방향 탈출이 된다. |
| 소프트 오버트래블 | DataID **2111** *Soft overtravel* = 1이면 오버트래블이 하드 E-Stop(파워 차단) 대신 소프트 E-Stop(감속, 파워 유지)이 된다. 기본 FALSE. |
| 리밋 원점(2803 = 17/18) | 소프트 신호 리밋으로 `Robot.Home` → 60 ms 만에 `-1023` *Missed signal during homing*, 축이 움직이지 않음. 원점은 스위치 전이를 서보 하드웨어 래치로 잡는데 소프트 신호는 래치할 수 없다는 가설(중간 확신). |
| 원점 속도 단위 | 2804 *Homing speed 1*은 ecnt/s 단위다. 기본 100은 2300 = 1,677,721.6 ecnt/mm 장비에서 약 0.00006 mm/s — 사실상 움직이지 않는다. |
| 조그 tick 모드 | 조그 속도 5 % 이하는 tick 모드(한 걸음씩)다(문서 `homing_jogging.htm`, DataID 2825). GPL `Move.SetJogCommand`에도 적용된다 — 1.43 %는 2분간 0.003 mm, 6~7 %는 연속 이동. 연속 조그는 5 %를 넘겨 쓴다. |

