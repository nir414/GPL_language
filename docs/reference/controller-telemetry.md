# 제어기 상태 정보와 온도

코드와 함께 상태를 보려면 **GPL: Open Controller Dashboard (제어기 대시보드)**를 실행합니다.
상단 CPU 온도 배지와 온도 카드에서 센서별 현재값, 조회 시각, CPU·앰프 최고값 추이와 원문을 확인할 수 있습니다.
사이드바의 **시스템 정보 새로고침**에도 온도가 포함됩니다.

## 조회할 수 있는 정보

2026-10-22 공식 문서와 현재 구현을 대조한 목록입니다. 조회 가능 여부는 모델·펌웨어·센서 구성에 따라 다릅니다.
아래 표의 읽기 명령과 달리 `Pc`, `Set`, `Execute`의 대입·메서드 호출은 상태를 바꿀 수 있습니다.

| 정보 | 조회 경로 | 조건·해석 | 확장 표시 |
| --- | --- | --- | --- |
| CPU·앰프 온도 | `Show Temperature` | CPU 내부 센서와 앰프 센서를 구분. 수치 제공 여부는 모델별로 다름 | 대시보드 자동 갱신·추이, 시스템 정보 수동 조회 |
| 앰프 온도 배열 | `Pd 12605` | G2xxx는 온도를 읽는 센서가 없어 과열 보호와 수치 조회를 구분해야 함 | MCP `read_dataids`로 필요 시 확인 |
| 모터 온도·상태 | `Pd 12110`, 구성 `Pd 10110` | 10110=0이면 감시 비활성. 1~3은 PTC 센서 수로, 12110의 0/1/10은 온도 상태이며 °C가 아님. 10110>10은 KTY84/130 방식의 최대 허용 °C | 센서 구성 확인 후 MCP로 조회. 자동 온도 카드에는 넣지 않음 |
| 전원·운전 상태 | `Execute Controller.PowerEnabled`, `Pd 230`, `Pd 234` | 전원 ON/OFF와 전원 시퀀스·자동 실행 상태는 서로 다른 항목 | 대시보드·MCP, 상세 상태는 DataID 조회 |
| 쓰레드·중단 위치·스택 | `Show Thread  -web`, `Show Stack` | 쓰레드 상태와 코드 위치. 스택은 대상 쓰레드를 지정해 필요 시 조회 | 대시보드·사이드바·디버거 |
| 축·직교 위치 | `Execute Robot.WhereAngles`, `Execute Robot.Where` | 기존 선택 Robot 문맥과 축 단위를 따름 | 대시보드 |
| 메모리 | `Show Memory` | Main Memory의 Free/Used/Segments. `-all`은 File Descriptors 등도 포함 | 대시보드 자동 갱신·자원 추이, 상세는 수동 명령 |
| TCP·네트워크 버퍼 | `Show Network -tcp`, `Show Network -mbuf` | accept 누적·증가율, mbuf/cluster 여유·drop/wait 등 | 대시보드 자동 갱신·추이 |
| 디지털 I/O | `Show DIO` | 현재 신호와 강제 상태. 쓰기는 별도 확인 후 실행 | 대시보드 디지털 I/O 탭 |
| 오류·시작 기록 | `ErrorLog -web ,10`, `Show StartupLog` | 과거 기록은 현재 상태와 구분. 오류 로그 삭제 옵션은 사용하지 않음 | 오류는 대시보드·사이드바, 시작 기록은 수동 조회 |
| Flash 사용량·파일 | `Directory /flash` | 파일 목록·여유 공간. 내용 변경 없이 조회 가능 | FTP 트리·시스템 정보, 명령 수동 조회 |
| 모델·구성 | `Pd 101` 등 Parameter Database | 모델·로봇·축·네트워크 구성은 해당 DataID와 unit을 지정 | MCP `read_dataids` |
| 부하·서보 진단 | `Pd 12304`, `Pd 12320`, `Pd 12684` 등 | 출력 토크·추종 오차·DC 버스 전압. 모델·축·단위와 표본 시각을 함께 확인 | 필요 시 MCP 조회. 고속 파형은 별도 DataLog 설계 필요 |

공식 근거:

- [System Console Panel](https://www2.brooksautomation.com/Controller_Software/Introduction_To_The_Software/Web_Interface/Control_Panels/systemconsole.htm): CPU·앰프 온도 및 `Show Temperature` 조회 경로.
- [Console Command Summary](https://www2.brooksautomation.com/Controller_Software/Software_Reference/Console_Commands/intro_console_c.htm), [Pd/Pdx](https://www2.brooksautomation.com/Controller_Software/Software_Reference/Console_Commands/pdpdx.htm): 상태·통신·I/O·파일·Parameter Database 조회.
- [Show Memory](https://www2.brooksautomation.com/Controller_Software/Software_Reference/Console_Commands/show_memory.htm): 메모리 항목·File Descriptors. `-verify`는 실시간 응답을 방해할 수 있어 자동 갱신에 사용하지 않습니다.
- [Servo Related Errors](https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Error_Code/servo_errors.htm): G2xxx 앰프 센서 제한, 과열·추종 오차·전원 전압 관련 진단 항목.
- [Motor Temperature Sensing](https://www2.brooksautomation.com/Controller_Software/Software_Setup/Selected_Setup_Procedures/motortempsensing.htm): 모터 온도 센서 방식과 DataID 의미.
- [Controller operation modes](https://www2.brooksautomation.com/Controller_Software/Software_Reference/PDB/Controller_Settings/operationmodes.htm): 전원 상태와 CPU 과열 시 상태 출력 동작.

## 갱신 주기와 값의 유효성

- 연결·쓰레드·전원·위치는 기존 `gpl.controller.dashboardPollIntervalMs`(기본 1500 ms)를 따릅니다.
- 온도·자원·과거 에러는 `gpl.controller.dashboardDiagnosticIntervalMs`(기본 10000 ms)를 따릅니다.
  주기는 조회가 완료된 뒤 다음 조회까지의 간격이며, 통신·다른 작업 때문에 실제 간격은 길어질 수 있습니다.
- **새로고침**은 전체 항목을 다시 조회합니다. 자원 조회를 끄더라도 온도는 계속 조회합니다.
- 온도·자원·에러에는 실제 조회 시각을 표시합니다. 빠른 화면 갱신만으로 캐시의 시각이나 추이 점을 늘리지 않습니다.
- 명령은 한 번에 하나씩 기존 확장 큐를 통해 전송합니다. 탭 숨김·연결 해제·대상 전환 후 남은 조회는 취소하고 이전 결과를 화면에 적용하지 않습니다.
- 성공한 종결 `</STATUS>`까지 받은 응답만 정상값으로 사용합니다. 실패·미지원·형식 불명은 미확인으로 표시하고 원문을 남깁니다.
- 온도 이력은 탭이 열린 동안 최신 360회 실측을 보관합니다. 기본 주기에서는 약 1시간이며, 수동 조회 횟수와 실제 통신 간격에 따라 달라집니다. 연결 세션이나 제어기 대상이 바뀌면 이력을 초기화합니다.

## 온도를 검토할 때

CPU 내부 온도는 외함이나 실내 온도와 다릅니다. 이번 조사에서는 **G2400C CPU의 허용·정지 온도 수치**를 확인하지 못했습니다.
다른 모델의 앰프 보호 온도를 CPU 기준으로 적용하지 않습니다. 화면의 `gpl.controller.dashboardCpuTemperatureWarningC`는
사용자가 정하는 관찰용 주의 기준이며, 기본 0은 기준 미설정입니다. 이 설정은 제어기의 보호 설정이나 동작을 변경하지 않습니다.

앰프 0°C는 유효한 실측으로 확정하지 않고 반환값과 센서 지원 미확인을 함께 표시합니다. 과열 관련 오류가 있다면
오류 발생 시각과 온도 변화, 전원·부하 상태를 함께 비교해야 합니다. 단일 온도 측정만으로 과열의 원인이나 안전성을 판정하지 않습니다.

## 2026-10-22 읽기 전용 실측

기존 확장 브리지에서 각 응답의 종결 STATUS 0을 확인했습니다. 한 시점의 기록이며 현재값을 대신하지 않습니다.

| 항목 | 응답 | 해석 |
| --- | --- | --- |
| `Pd 101` | `"G2400C"` | 현재 대상 모델 |
| `Show Temperature` CPU 1 | 첫 조회 `57.1 C`, 후속 조회 `58.5 C` | CPU 내부 온도. 두 시점의 값만으로 과열 여부 미판정 |
| `Show Temperature` Amp 1~4, `Pd 12605` | 모두 0 | 공식 G2xxx 센서 제한과 부합. 실제 0°C로 해석하지 않음 |
| `Pd 10110` | `0, 0, 0, 0` | 해당 축의 모터 온도 감시 비활성 |
| `Pd 12110` | `0, 0, 0, 0` | 현재 구성에서 모터 실측 온도로 사용할 수 없음 |
| `Pd 230` | `7` | 전원 요청 대기 상태. 온도 측정 시점과 전원 상태 조회 시점은 다름 |
| 후속 `ErrorLog -web ,10` | 빈 DATA, STATUS 0 | 이번 조회에 반환된 오류 없음. 과거 과열 이력 부재를 증명하지 않음 |

설정·전원·프로그램 실행 상태를 바꾸는 명령이나 배포는 수행하지 않았습니다.

문서 제목/URL은 스킬 캐시로 찾았고 공식 페이지 본문은 웹 도구로 확인했습니다. 실행 셸의 공식 검색 인덱스 접속은 DNS 오류로 실패하여 캐시를 사용했습니다.
