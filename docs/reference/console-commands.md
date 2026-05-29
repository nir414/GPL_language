# Console Commands (요약)

출처(공식):
- Console Command Summary: https://www2.brooksautomation.com/Controller_Software/Software_Reference/Console_Commands/intro_console_c.htm

Brooks/Guidance 컨트롤러의 콘솔은 한 번에 하나의 ASCII 명령을 받아 처리하는 텍스트 인터페이스입니다. 콘솔 명령은 GPL 프로젝트 로드, 실행, 디버깅, 파일/시스템 관리에 사용됩니다.

## 명령어 목록

| 명령어 | 요약 |
| --- | --- |
| `Break` | 실행 중인 active thread를 일시 정지합니다. |
| `Compile` | 로드된 GPL 프로젝트를 실행 가능한 내부 표현으로 컴파일합니다. |
| `Continue` | 일시 정지된 thread 실행을 재개합니다. |
| `Copy` | flash disk, ROMDISK 같은 장치의 파일을 복사합니다. |
| `Create` | 파일을 생성하고 데이터를 기록합니다. |
| `DataLog` | data logger 출력을 콘솔에 표시하거나 파일로 저장합니다. |
| `Date` | 시스템 날짜와 시간을 표시하거나 설정합니다. |
| `Del` | 파일을 삭제합니다. |
| `Directory` | 디렉터리 파일 목록 또는 flash disk 여유/전체 공간을 표시합니다. |
| `ErrorLog` | 시스템 error log를 표시하거나 지웁니다. |
| `Execute` | GPL program instruction을 즉시 실행합니다. 변수 값 조회/설정에도 사용할 수 있습니다. |
| `Format` | `/flash` disk 또는 `/NVRAM` 장치를 초기화하며 사용자 데이터를 지웁니다. |
| `Load` | 디스크의 GPL 프로젝트를 메모리에 로드합니다. |
| `Pc` | Parameter Database 항목 값을 설정합니다. |
| `Pd`, `Pdx` | Parameter Database 값을 표시합니다. |
| `Set Break` | procedure에 breakpoint를 설정합니다. |
| `Set DIO` | digital input/output signal 상태를 설정합니다. |
| `Set Global` | global variable 값을 설정합니다. |
| `Set Latch` | encoder position latch 속성을 수정합니다. |
| `Set Modbus` | MODBUS/TCP driver를 비활성화하거나 변경된 driver 속성을 적용합니다. |
| `Set NoBreak` | `Set Break`으로 설정한 breakpoint를 제거합니다. |
| `Set Payload` | 선택한 robot의 payload parameter를 수정합니다. |
| `Set Thread` | 일시 정지된 thread의 속성을 설정합니다. |
| `Show Break` | 설정된 breakpoint 정보를 표시합니다. |
| `Show DIO` | digital input/output signal 상태를 표시합니다. |
| `Show FPGA` | 현재 로드된 FPGA firmware 정보를 표시합니다. |
| `Show Global` | global variable 값을 표시합니다. |
| `Show GSB` | 연결된 GSB, GIO, SFT board와의 RS-485 통신 정보를 표시합니다. |
| `Show Latch` | encoder position latch 구성 및 pending latch event를 표시합니다. |
| `Show Memory` | 컨트롤러 메모리 사용량 정보를 표시합니다. |
| `Show Modbus` | MODBUS/TCP 구성 및 상태를 표시합니다. |
| `Show Network` | Ethernet 또는 RS-485 network 정보를 표시합니다. |
| `Show Payload` | 선택한 robot의 payload parameter를 표시합니다. |
| `Show SIO` | 연결된 SIO(RS-485) 장치 성능 정보를 표시합니다. |
| `Show Stack` | thread 실행 stack 정보를 표시합니다. |
| `Show StartupLog` | 컨트롤러 시작 시 콘솔에 출력된 메시지를 표시합니다. |
| `Show Thread` | 하나 또는 전체 thread 정보를 표시합니다. |
| `Show Variable` | variable 값을 표시합니다. |
| `Shutdown` | 컨트롤러 24V logic power off를 준비합니다. |
| `SoftEStop` | motor power를 유지한 상태로 robot motion을 빠르게 정지합니다. |
| `Start` | compiled project 실행을 시작합니다. |
| `Step` | 디버깅 중 procedure를 한 단계 이상 실행합니다. |
| `Stop` | active thread 실행을 정지합니다. |
| `Sync` | pending data가 flash에 모두 기록되고 flash device가 idle 상태가 될 때까지 대기합니다. |
| `Type` | ASCII file 내용을 콘솔에 표시합니다. |
| `Unload` | 메모리에서 project를 제거합니다. |
| `Xmodem` | Xmodem protocol로 파일을 송수신합니다. |

## 실무 분류

### 프로젝트 실행/관리

- `Load`, `Compile`, `Start`, `Stop`, `Unload`

### 디버깅

- 흐름 제어: `Break`, `Continue`, `Step`, `Stop`
- breakpoint: `Set Break`, `Show Break`, `Set NoBreak`
- thread/stack/variable 확인: `Show Thread`, `Show Stack`, `Show Variable`, `Set Thread`
- 즉석 실행/조회: `Execute`
- 로그 확인: `ErrorLog`, `Show StartupLog`

### 파일/디스크

- `Directory`, `Type`, `Copy`, `Create`, `Del`, `Format`, `Sync`, `Xmodem`

### I/O 및 통신

- `Set DIO`, `Show DIO`
- `Set Modbus`, `Show Modbus`
- `Show Network`, `Show GSB`, `Show SIO`

### 파라미터/로봇 상태

- `Pc`, `Pd`, `Pdx`
- `Set Payload`, `Show Payload`
- `Set Latch`, `Show Latch`
- `Show FPGA`, `Show Memory`, `Date`, `Shutdown`, `SoftEStop`

## 디버깅 흐름 예시

1. `Start project_name -break -bex`로 멈춘 상태에서 시작합니다.
2. `Show Thread`로 thread 상태와 현재 위치를 확인합니다.
3. `Show Stack thread_name`으로 호출 경로를 확인합니다.
4. `Show Variable thread_name frame variable` 또는 `Execute`로 값을 확인합니다.
5. `Step -into`, `Step -over`, `Step -out`으로 흐름을 추적합니다.
6. `Set Break`, `Show Break`, `Set NoBreak`으로 breakpoint를 관리합니다.
7. `ErrorLog`와 `Show StartupLog`로 오류/부팅 증거를 확인합니다.

주의:
- `Break`는 thread를 멈추고 재개할 수 있는 디버깅 명령입니다.
- `Stop`은 active thread 실행을 정지하므로, stack/variable 문맥을 유지하며 조사하려면 먼저 `Break`를 검토합니다.
- `Format`은 사용자 데이터를 지울 수 있으므로 실장비에서는 특히 주의합니다.
