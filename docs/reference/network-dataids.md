# 네트워크 DataID — 확장이 쓸 수 있는 것들

제어기의 네트워크 설정·통계는 파라미터 DB(DataID)에 있고, `Pd`(읽기 전용)로 **1402 콘솔에서 그대로
읽을 수 있다**. 이 문서는 그중 **이 확장의 연결·배포·진단에 실제로 쓸 수 있는 항목만** 골라
문서 서술과 실기기 실측을 대조해 정리한다.

출처(공식):

- Networking(PDB Controller Settings): <https://www2.brooksautomation.com/Controller_Software/Software_Reference/PDB/Controller_Settings/network.htm>
- Ethernet Servo Network 설정 절차: <https://www2.brooksautomation.com/Controller_Software/Software_Setup/Selected_Setup_Procedures/Servo_Network/SrvNet_ethernet.htm>

실측 기준: **G2400C · GPL 4.2K5 · `192.168.0.1`, 2026-09-07**, MCP `read_dataids`(= `pd <id>`) 1회 조회.

| 표기 | 뜻 |
| --- | --- |
| **[실측]** | 위 제어기 응답으로 확인 |
| **[문서]** | Brooks 공식 문서 서술 (실기기 검증 별도 필요) |
| **[추정]** | 문서와 실측을 맞춰 본 해석. 단정하지 않는다 |

> `pc`(DataID **쓰기**)는 확장·MCP에 노출하지 않는 것이 이 저장소의 방침이다
> ([pa-controller-debug-operations](../development/pa-controller-debug-operations.md)). 아래 항목은 전부 **읽기**로만 쓴다.

---

## 1. 실측값 (2026-09-07)

| DataID | 이름 | 실측값 | 확장에서의 의미 |
| --- | --- | --- | --- |
| 420 | Local IP address | `"192.168.0.1"` | 접속 대상이 맞는지 자기 확인 |
| 421 | IP subnet mask | `"255.255.255.0"` | |
| 422 | IP gateway address | `"192.168.0.100"` | 같은 서브넷의 호스트가 게이트웨이로 잡혀 있다 → 도달성 판정에서 "응답한 장치가 제어기인가 게이트웨이인가" 구분 시 참고 (`reachability.ts`) |
| 427 | FTP user name and password | `""` (빈 문자열) | **빈 값 = 로그인 불필요**[문서]. 캡처의 `USER Precise`가 통한 이유 → FTP 실패를 자격증명 탓으로 돌리지 않는다 |
| 411 | Network console enable | `1` | TELNET(**TCP 23**) 콘솔이 **열려 있다**. `1`=허용+트레이스는 시리얼, `2`=허용+트레이스를 TELNET 클라이언트로[문서] |
| 134 | Slave mode | `0` | 이 제어기는 마스터 |
| 151 | Servo network node identifier | `"0014FF-02300289"` + 빈칸 15개 | **슬레이브 없음**(배열 16칸 = 마스터 1 + 슬레이브 최대 15) |
| 425 | Servo network multicast IP address | `"239.192.0.1"` | 기본 멀티캐스트 주소. 슬레이브가 없어 의미 없음 |
| 430 | Ethernet statistics | 값 **10개** (아래 §2) | 링크·TCP 계층 카운터 — 연결 진단의 직접 근거 |
| 431 | Ethernet receiver errors | 5개 항목 전부 `0` | `Buffer overflow / CRC error / Framing error / Fifo overrun / Missed packets` |
| 432 | Ethernet transmitter errors | 5개 항목 전부 `0` | `Aborted / Carrier / Fifo / Heartbeat / Window errors` |
| 450 | Web password security | `-1` | `-1` = 웹 보호 없음[문서] → 451/452의 "로그온 PC IP 고정"이 작동하지 않는 상태 |
| 464 | Web RPC: debug, timeout, stack | `0, 0, 0` | 전부 기본값. GDE의 변수 조회가 웹 RPC 경유라는 **가설을 뒷받침하지도 반박하지도 않는다** |

> 431/432가 전 항목 `0`이라는 것은 **물리 링크는 깨끗하다**는 뜻이다. 즉 이 제어기에서 관측되는
> 접속 끊김·재접속 거부는 케이블/NIC 수준 문제가 아니라 상위(제어기 소켓 처리·세션 수) 쪽에서
> 찾아야 한다.

## 2. DataID 430 — 문서 12개 vs 실측 10개

**문서는 12개 값을 열거하지만, GPL 4.2K5 실측은 10개만 돌려준다.** 마지막 두 항목
(`Port 1 status bitmask`, `Port 2 status bitmask`)이 없다. 파서를 만든다면 **길이를 고정하지 말 것.**

| # | 문서상 항목[문서] | 2026-09-07 실측 | 비고 |
| --- | --- | --- | --- |
| 1 | Total packets received | 578,373 | |
| 2 | Total packets transmitted | 506,279 | |
| 3 | Bad packets received | 0 | |
| 4 | Transmission problems | 0 | |
| 5 | TCP/IP connections initiated | 0 | 제어기는 받기만 하므로 0이 자연스럽다[추정] |
| 6 | Connections closed/dropped | **30,773** | 절대값이 크다. 부팅 후 누적이므로 **증가율(Δ/분)이 신호**다 |
| 7 | TCP/IP packets sent | 505,811 | |
| 8 | TCP/IP packets received | 509,503 | |
| 9 | TCP/IP retransmitted packets | 0 | |
| 10 | Retransmit timeouts | 14 | 재전송 0인데 타임아웃 14 — 카운터 정의가 문서와 다를 수 있다[추정] |
| 11 | Port 1 status bitmask | **없음** | 이 펌웨어에서 미제공 |
| 12 | Port 2 status bitmask | **없음** | 이 펌웨어에서 미제공 |

번호↔항목 매핑 자체가 **[추정]**이다(개수가 다르므로 문서 순서를 그대로 붙인 것). 확정하려면
의도적으로 트래픽을 만든 전후로 두 번 읽어 증분을 대조해야 한다(§4).

## 3. 어떻게 쓸 것인가

### 3-1. 연결 진단 카드에 링크 계층 근거 추가 (가장 실효)

지금 `src/controller/resourceProbes.ts`는 `Show Memory` / `Show Network -tcp|-mbuf`를 파싱해
자원 카드를 만든다. 여기에 **`pd 430/431/432`를 같은 주기로 얹으면** 접속 문제를 계층별로 가른다.

| 관측 | 해석 |
| --- | --- |
| 431/432에 0이 아닌 값이 늘어남 | 물리/링크 문제 (케이블·스위치·NIC) |
| 430 #3·#4 증가 | 패킷 수준 오류 |
| 430 #6(closed/dropped)만 급증 | 세션이 계속 끊긴다 — 확장의 재접속 루프·1403 워치독 쪽 |
| 430 #9·#10 증가 | 왕복 지연·손실 → 타임아웃 값 재검토 |
| 전부 정지, `Show Network -tcp` 소켓만 누적 | 제어기 소켓 고갈 (기존 #22 가설) |

읽기 전용·모션 무영향이고 MCP `read_dataids` 1회(≈1.5 s)로 3개를 한 번에 받는다.
**"연결 실패는 관측이고 제어기 장애는 판단이다"**(§0)를 지키면서 판단에 필요한 증거를 더해 주는
가장 값싼 수단이다.

### 3-2. FTP 배포 실패의 원인 분류

`427 = ""`이면 **로그인 자체가 필요 없다**[문서]. 따라서 배포가 FTP 단계에서 실패할 때
사용자 계정/비밀번호를 의심할 근거가 없다 — 경로·권한·연결·전송 모드를 먼저 본다.
반대로 이 값이 비어 있지 않은 현장이라면 확장의 FTP 자격증명 설정이 **반드시** 필요하다는 뜻이므로,
배포 실패 진단 메시지에 `pd 427` 확인을 한 줄 넣어 두면 현장 대응이 빨라진다.

### 3-3. `read_dataids({node})`를 언제 쓸 수 있는가

`node` 인자는 **서보 네트워크 슬레이브가 있을 때만** 의미가 있다. 판별은 두 개로 끝난다.

- `134 Slave mode` = 0 → 이 제어기가 마스터
- `151`의 2번째 칸부터 시리얼 번호가 채워져 있으면 그 **배열 순서가 곧 노드 번호**[문서]

우리 제어기는 2번 칸부터 전부 비어 있으므로 **슬레이브가 없고, `node` 인자를 쓸 대상이 없다.**
MCP 도구 설명이나 진단에서 노드 지정을 권하기 전에 이 두 값을 먼저 읽는 것이 맞다.

### 3-4. 전원 투입 직후 무응답은 정상 구간일 수 있다

> "the master controller attempts to connect to the slave controllers for about 30 seconds …
> each slave controller waits for about 60 seconds for a connection request from the master"[문서]

즉 **부팅 직후 최대 1분 가까이는 제어기가 서보 네트워크 형성에 매여 있을 수 있다.** 재접속
백오프·워치독의 "이 시간 안의 거부는 장애로 세지 않는다" 구간을 정할 때 인용할 수 있는
공식 근거다. (2026-08-31의 약 2.5분 재접속 거부는 이보다 길어 **이것만으로는 설명되지 않는다** —
별개 원인으로 남겨 둔다.)

### 3-5. 포트 23 TELNET 콘솔이 열려 있다는 사실

`411 = 1`이므로 **1402 말고도 콘솔에 들어갈 문이 하나 더 있다**(TELNET 23, 비밀번호는 DataID 410).
확장은 이 경로를 쓰지 않지만, "단일 클라이언트·단일 명령 스트림" 전제를 깨는 외부 접속이
가능하다는 뜻이다. 원인 불명의 상태 변화(스레드가 남의 손에 멈춰 있음 등)를 조사할 때
**후보로 기억해 둘 것.** 우리가 이 값을 바꿀 일은 없다.

## 4. 후속 검증 항목 (읽기 전용, 모션 무영향)

- [ ] **430 항목 매핑 확정** — 1402 접속을 의도적으로 끊었다 붙인 전후로 `pd 430`을 두 번 읽어
      #6(closed/dropped)이 그만큼 증가하는지 확인. 증가하면 매핑 [추정] → [실측].
- [ ] **430 #6 증가율 기준선** — 정상 사용 10분간 Δ를 재어 "비정상 급증"의 임계를 정한다.
- [ ] **410(Network password) 값** — 이번 조회에 넣지 않았다. 1402가 비밀번호를 요구하지 않는
      이유가 410이 비어서인지, 1402가 애초에 TELNET 인증과 무관해서인지는 미확인.
- [ ] **`Show Network`(콘솔) 출력과 430의 관계** — 같은 카운터를 다른 표현으로 주는 것인지,
      서로 보완인지 대조. 겹치면 자원 카드에 둘 다 넣을 이유가 없다.

## 5. 확장과 무관해 보이는 것 (읽지 않아도 되는 이유)

- **440~444 External trajectory** — 외부 궤적 생성기(실시간 Ethernet 스트림). 확장의 범위 밖.
- **453~459, 460~463, 465, 466 웹 로그온·브랜딩·커스텀 페이지** — 제어기 웹 UI 전용.
  단 451/452(현재 로그온 사용자·IP)는 "누가 웹으로 붙어 있나"를 볼 때만 의미가 있는데,
  이 제어기는 `450 = -1`(보호 없음)이라 값이 채워지지 않는다.
- **600 / 2010 / 425 / 151 / 134** — 서보 네트워크 구성. 슬레이브가 없는 현재 구성에서는
  §3-3의 판별 용도 외에 쓸 일이 없다.
