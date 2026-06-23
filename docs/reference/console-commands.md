# Console Commands (요약)

출처(공식):
- Console Command Summary: https://www2.brooksautomation.com/Controller_Software/Software_Reference/Console_Commands/intro_console_c.htm

Brooks/Guidance 컨트롤러의 콘솔은 한 번에 하나의 ASCII 명령을 받아 처리하는 텍스트 인터페이스입니다. 콘솔 명령은 GPL 프로젝트 로드, 실행, 디버깅, 파일/시스템 관리에 사용됩니다.

## Wire format

- 1402 명령 포트에는 plain text 명령 뒤에 CRLF를 붙여 ASCII로 보냅니다.
- 예: `Show Thread` + `\r\n`
- `<COMMAND><NAME>...</NAME></COMMAND>` 같은 XML wrapper는 사용하지 않습니다.
- 응답은 보통 `<DATA>...</DATA>`와 `<STATUS>code,"message"</STATUS>` 형식이며, `</STATUS>` 수신을 응답 완료 기준으로 봅니다.

## Packet Capture Evidence

2026-06-19에 GDE/PEdit와 PA 제어기 `192.168.0.1` 사이의 `pktmon` 캡처를 확인했습니다. `Npcap` 없이 Windows 내장 `pktmon`으로 수집했고, `pcapng`를 Wireshark/tshark로 분석했습니다.

관찰된 포트 역할:

| 포트 | 관찰된 역할 |
| --- | --- |
| `1402/tcp` | Console Command 요청/응답. plain ASCII 명령과 `<DATA>/<STATUS>` 응답 |
| `1403/tcp` | Runtime event/output stream. `<E>...</E>` frame 수신 |
| `21/tcp` | FTP control channel. `USER Precise`, `PASV`, `LIST`, `RETR` |
| passive data port | FTP data channel. 예: `1692`~`1699` |

관찰된 `1402` 명령 예:

```text
PC(1700,0,0,1)=""
Stop -a
Stop
COMPILE MergeCode
Start Mergecode -event
Show Thread -web
Show Thread
Show Break
memory
dir -f /flash
ErrorLog -web ,10
PD 104,0,0,0
PD 105,0,0,0
PD 106,0,0,0
PD 109,0,0,0
PD 200,0,0,0
PD 234,-1,0,0
PD 601,-1,0,0
PD 1700,-1,0,0
PD 2800,1,0,0
```

해석:

- `PD`/`Pdx`, `Show`, `ErrorLog`, `memory`, `dir -f /flash`는 read-only 진단 성격입니다.
- `PC`, `Stop`, `COMPILE`, `Start`는 제어기 상태를 바꾸는 명령입니다.
- `Stop` 단독 호출은 캡처에서 `STATUS -205,"*Missing argument*"`로 실패했고, `Stop -a`는 성공했습니다.
- `COMPILE MergeCode`는 compiler pass 1/2/3 이후 `Compile successful` 응답을 받았습니다.
- `Start Mergecode -event` 이후 `1403`에서 `ROBOT PROGRAM ... STARTED` 이벤트가 수신됐습니다.

FTP 쪽에서는 `STOR` 업로드가 아니라 `RETR` 다운로드만 관찰됐습니다.

```text
RETR /GPL/MergeCode/Project.gpr
RETR /GPL/MergeCode/MergeCode.gpl
```

따라서 해당 캡처는 "프로젝트 정지/상태조회 -> 컴파일 -> 실행 -> 이벤트 확인 -> 재조회/다운로드" 흐름으로 보는 것이 가장 자연스럽습니다.

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
| `Directory <path>` | 디렉터리 파일 목록 또는 flash disk 여유/전체 공간을 표시합니다. path 인자가 필요합니다. |
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

- `Directory <path>`, `Type`, `Copy`, `Create`, `Del`, `Format`, `Sync`, `Xmodem`

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

## 자주 헷갈리는 명령

- 프로젝트 목록은 `Show Project`가 아니라 `Directory /flash/projects` 또는 설정된 FTP 프로젝트 경로로 확인합니다.
- `Directory` 단독 호출은 `STATUS -505`가 날 수 있으므로 `Directory <path>` 형태로 실행합니다.
- PEdit/GDE가 FTP passive mode를 쓰면 `21/tcp`만으로는 파일 본문이 보이지 않습니다. 패킷 분석 시에는 제어기 IP의 전체 TCP 또는 passive data port까지 캡처해야 `RETR` 파일 내용 전송량을 볼 수 있습니다.

## STATUS 코드 힌트

| 코드 | 의미 | 다음 확인 |
| --- | --- | --- |
| `0` | 성공 | payload 확인 |
| `-505` | 입력 부족 또는 명령 인자 누락 | `Directory <path>`처럼 인자를 채워 재시도 |
| `-508` | file not found | `/GPL` vs `/flash/projects`, 프로젝트명, FTP 경로 확인 |
| `-714` | unknown command | 명령명 확인. 프로젝트 목록은 `Directory /flash/projects` 사용 |
| `-745` | project already exists 가능 | 이미 로드된 상태인지 확인 |

주의:
- `Break`는 thread를 멈추고 재개할 수 있는 디버깅 명령입니다.
- `Stop`은 active thread 실행을 정지하므로, stack/variable 문맥을 유지하며 조사하려면 먼저 `Break`를 검토합니다.
- `Format`은 사용자 데이터를 지울 수 있으므로 실장비에서는 특히 주의합니다.
