# GPL Networking (Brooks/Guidance) — 프로젝트용 정리

> 상위 인덱스(큰 분류 TOC): [GPL_DICTIONARY_GUIDE.md](./GPL_DICTIONARY_GUIDE.md)

> 출처: Brooks Automation GPL Dictionary / Networking Classes
> 
> - Networking Classes Summary: https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Network/networkintro.htm
> - IPEndPoint: https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Network/IPEndPoint/construct_ipe.htm
> - Socket: https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Network/Socket/available_sock.htm (등)
> - TcpClient: https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Network/TcpClient/construct_tcpc.htm
> - TcpListener: https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Network/TcpListener/construct_tcpl.htm
> - UdpClient: https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Network/UdpClient/construct_udpc.htm

이 문서는 **컨트롤러(GPL) 네트워크 API를 프로젝트 관점에서 빠르게 다시 꺼내 쓰기** 위해 만든 요약입니다.

- “개념/규칙”은 문서 내용을 기반으로 정리하고,
- “프로젝트에서의 실제 사용”은 `Test_robot/Net_Tcp_*.gpl` 흐름에 맞춰 연결합니다.

---

## 1) 큰 그림: 클래스 역할

Networking 클래스는 다음 역할로 구성됩니다.

- `IPEndPoint`: IP + Port를 한 객체로 표현
- `Socket`: 실제 송수신 I/O의 본체(대부분의 네트워크 동작은 여기서 수행)
- `TcpListener`: TCP 서버(리스닝/접속 수락)
- `TcpClient`: TCP 클라이언트(서버에 연결)
- `UdpClient`: UDP datagram 통신용 소켓

중요 포인트:
- `TcpClient.Client` / `UdpClient.Client` / `TcpListener.AcceptSocket`가 **`Socket`을 반환**합니다.
- 실질적인 Send/Receive는 `Socket.Send`, `Socket.Receive` 등에서 수행됩니다.

---

## 2) IPEndPoint

### 2.1 생성자
- `New IPEndPoint(IP_address, port_number)`
  - `IP_address` (옵션, String): 표준 형태 `"nnn.nnn.nnn.nnn"`. 비었거나 생략 시 wildcard(아무 주소나 매칭).
  - `port_number` (옵션, Number): 문서상 `0..65536`. 생략 시 자동 할당.
    - 참고: 일반적인 TCP/UDP 포트 범위는 `0..65535`이므로, 실무에선 `<= 65535`로 제한하는 편이 안전합니다.

### 2.2 프로퍼티
- `ipendpoint_object.IPAddress`
  - IP 주소 문자열 set/get. 빈 문자열이면 wildcard.
- `ipendpoint_object.Port`
  - 포트 번호 set/get.

---

## 3) TcpListener (TCP 서버)

### 3.1 생성자
- `New TcpListener(endpoint)`
  - `endpoint`는 로컬 endpoint.
  - **문서 명시:** GPL 컨트롤러는 IP가 단일이라 endpoint의 IP 주소는 무시되고, **포트가 리슨 포트**를 결정.
  - 생성만으로는 리스닝 시작 X → `Start` 호출 필요.

### 3.2 서버 기본 흐름
1) `listener.Start`
2) `listener.Pending`로 연결 요청 확인
3) `listener.AcceptSocket`으로 연결 수락 → 클라이언트용 `Socket` 획득
4) 필요하면 `listener.Stop`(새 연결 중단). 이미 열린 연결 서비스는 계속 가능.

### 3.3 멤버 요약
- `tcplistener_object.Start`
  - 연결 요청 리스닝 시작.
  - 네트워크 에러 시 Exception 발생.
- `tcplistener_object.Pending` (Boolean)
  - 대기 연결이 있으면 True.
  - 네트워크 에러 시 False 반환(문서 명시).
- `tcplistener_object.AcceptSocket`
  - 연결 수락 + 새 `Socket` 반환.
  - 대기 연결이 없으면 블록됨 → 블로킹 회피는 `Pending` 체크.
  - 네트워크 에러 시 Exception 발생.
- `tcplistener_object.Stop`
  - 더 이상 새 연결을 받지 않음. 이미 연결된 세션 서비스에는 영향 없음.
- `tcplistener_object.Close`
  - 자원 해제. 이미 닫혀 있어도 에러 없음.

---

## 4) TcpClient (TCP 클라이언트)

### 4.1 생성자
- `New TcpClient(endpoint)`
  - `endpoint`를 주면 즉시 connect 요청.
  - 생략 시, 나중에 `Socket.Connect(remote_endpoint)` 호출해야 I/O 가능.

### 4.2 멤버
- `tcpclient_object.Client` → 내부 `Socket` 반환
- `tcpclient_object.Close` → 연결/자원 해제(하위 Socket close). 이미 닫혀있어도 에러 없음.

---

## 5) UdpClient (UDP)

### 5.1 생성자
- `New UdpClient(endpoint)`
  - `endpoint`(옵션): 로컬 endpoint.
  - **문서 명시:** 컨트롤러 IP 단일이라 IP는 무시.
  - port가 0이 아니면 지정 포트로 오는 datagram만 수신.
  - 생성 자체는 네트워크 I/O를 발생시키지 않음.

### 5.2 멤버
- `udpclient_object.Client` → 내부 `Socket` 반환
- `udpclient_object.Close` → 소켓 close (이미 닫혀도 에러 없음)

---

## 6) Socket (프로젝트에서 가장 중요한 본체)

### 6.1 Blocking vs Timeout 요약
- `socket_object.Blocking` (Boolean)
  - True: Send/Receive가 필요 시 **대기(block)** 가능
  - False: 대기가 필요하면 **Exception 발생**
  - 기본값: blocking 모드
  - 문서 권장: 무작정 non-blocking으로 예외 폴링하는 것보다 `Available` 또는 `ReceiveTimeout`/`SendTimeout` 활용

- `socket_object.ReceiveTimeout` (ms)
  - blocking 모드에서만 의미 있음
  - Receive/ReceiveFrom이 대기 중 타임아웃 초과 시 Exception
  - 0이면 무제한 대기(무한 블록 가능)

- `socket_object.SendTimeout` (ms)
  - blocking 모드에서만 의미 있음
  - Send/SendTo가 큐가 가득 차서 대기할 때 타임아웃 초과 시 Exception
  - 0이면 무제한 대기

### 6.2 KeepAlive (TCP idle 연결 감지)
- `socket_object.KeepAlive` (Boolean)
  - TCP 연결이 idle일 때 keep-alive 패킷을 보내 끊김을 감지
  - 문서에 timing이 고정값으로 명시됨:
    - idle이면 14초마다 1회
    - 응답 없으면 2초 간격으로 재전송
    - 9회(총 32초) 응답 없으면 로컬에서 연결 종료
  - 원격도 끊김 감지를 원하면 원격도 KeepAlive를 켜야 함

### 6.3 데이터 송수신 API
- `socket_object.Available` (Property)
  - 수신 가능 바이트 수를 반환
  - 0보다 크면 `Receive`/`ReceiveFrom` 호출로 읽을 수 있음
  - Socket이 열려있지 않거나 오류 시 Exception

- `socket_object.Receive(input_buffer, max_length)` (TCP)
  - blocking이면 데이터 올 때까지 대기
  - 반환값: 받은 바이트 수
    - 0이면 연결이 끊어진 상태를 의미 → Socket close 권장
  - 네트워크 오류 시 Exception

- `socket_object.Send(output_buffer, max_length)` (TCP)
  - `max_length`는 옵션. 생략 또는 0이면 전체 문자열 전송
  - 반환값: 실제 전송 바이트 수
    - blocking 모드면 요청한 바이트와 동일
    - non-blocking이면 일부만 보낼 수 있어 나머지는 재호출로 보내야 함
  - 네트워크 오류 시 Exception

- `socket_object.ReceiveFrom(input_buffer, max_length, remote_endpoint)` (UDP)
  - datagram 수신
  - `remote_endpoint` (ByRef IPEndPoint): 수신한 상대 endpoint 정보로 덮어씀
  - 반환값: 받은 바이트 수
    - 0이면 disconnect 상태로 간주 → close 권장 (**문서 명시**)
      - 참고: UDP는 “연결” 개념이 약하지만, GPL 문서에서는 0을 소켓 이상 상태로 해석하도록 안내합니다.
  - `max_length > 1536`은 내부 제한상 큰 의미 없음(문서 명시)
  - 네트워크 오류 시 Exception

- `socket_object.SendTo(output_buffer, max_length, remote_endpoint)` (UDP)
  - datagram 전송
  - 반환값: 실제 전송 바이트 수(부족하면 나머지 재전송)
  - 네트워크 오류 시 Exception

### 6.4 Connect / RemoteEndPoint / Close
- `socket_object.Connect(remote_endpoint)`
  - TcpClient 생성 시 endpoint를 생략했을 때만 사용(문서 명시)

- `socket_object.RemoteEndPoint`
  - TCP 연결의 원격 endpoint(IPEndPoint)를 반환
  - 활성 연결이 없으면 `IPAddress="0.0.0.0"`, `Port=0`

- `socket_object.Close`
  - Socket/TcpListener/TcpClient/UdpClient 모두에 동일 패턴으로 존재
  - 이미 닫혀있어도 에러 없음

---

## 7) 우리 프로젝트에서의 적용 포인트 (Test_robot)

### 7.1 서버 흐름(accept/session/receive)
- 서버 루프 분리 모듈: `Test_robot/Net_Tcp_ServerLoop.gpl`
  - `Dim endPoint As New IPEndPoint(ip, port)`
  - `Dim listener As New TcpListener(endPoint)`
  - `listener.Start` → `listener.Pending()` 대기 → `listener.AcceptSocket`
  - 세션 소켓 설정:
    - `clientSocket.ReceiveTimeout = 0`  (무한 블록 가능)
    - `clientSocket.KeepAlive = True`   (idle 끊김 감지)

추가로, 프로젝트는 연결별 상태를 **세션 객체로 캡슐화**합니다.

- 세션 클래스: `TcpSession` (`Net_Tcp_Session.gpl`에 정의)
  - 필드/상태: `Ip`, `Port`, `Socket`, `EchoMode`, `Queue`
  - 동작: `Send`, `SendLine`, `CloseSocket`
- 서버 루프(세션 기반): `Net_Tcp_ServerLoop.RunServerLoopForSession(session, stopping, debugOn)`
- 세션 생성/스레드 시작: `Test_robot/Net_Tcp_Communication.gpl`

### 7.2 Receive는 “예외/close로 블로킹 해제”가 핵심
- 수신 래퍼: `Test_robot/Net_Tcp_SocketReceive.gpl`
  - `clientSocket.Receive(buf, max_length)` 형태 사용
    - 현재 프로젝트 호출부(`Net_Tcp_ServerLoop.gpl`)에서 `2000`을 전달하는데, 이는 **timeout(ms)** 가 아니라 **최대 수신 길이(byte)** 입니다.
    - 타임아웃은 `clientSocket.ReceiveTimeout`으로 제어합니다.
  - stop 과정에서 **socket close로 blocking Receive를 깨우는 패턴**을 사용(코드 주석에 명시)

### 7.3 Send는 별도 모듈 + 선택적 락
- 송신 모듈: `Test_robot/Net_Tcp_SocketSend.gpl`
  - per-socket 락(TAS 스핀락)을 선택적으로 사용

세션 객체화 이후에는 다음 오버로드를 사용해 **배열 인덱스 없이** 송신할 수 있습니다.

- `Net_Tcp_SocketSend.SendSocket(sock, data, sendLock)`
- `Net_Tcp_SocketSend.SendSocketLine(sock, line, sendLock)`

### 7.4 (프로젝트) TCP 수신 명령 큐: 채널 객체 기반 polling

프로젝트는 네트워크 thread(수신)와 메인 thread(처리)를 분리하기 위해 **고정 크기 ring buffer 큐**를 사용합니다.

- 모듈: `Test_robot/Net_Tcp_CommandQueue.gpl`
  - 채널(sourceIndex)별로 `TcpCommandQueueChannel` 객체를 1개씩 보유
  메인 루프에서는 `GetChannel()`로 채널 객체를 얻어 polling 합니다.

메인 루프 polling 예시(권장 패턴):

```vb
Dim q As TcpCommandQueueChannel
q = Net_Tcp_CommandQueue.GetChannel(i)
If q Is Nothing Then
    ' 채널 준비 전이면 skip
Else
    While q.TryDequeue(cmdLine) = 1
        ' cmdLine 처리
    End While
End If
```

추가로, `TcpCommunication` 인스턴스는 생성 시점에 자기 채널 큐를 `Queue` 프로퍼티로 바인딩합니다.
따라서 연결 객체를 들고 있는 경우엔 `tcp.Queue.TryDequeue(...)` 형태로도 사용할 수 있습니다.

---

## 8) 해시(#) 링크를 “직접 URL”로 바꿔서 한 번에 수집하는 법

당신이 붙여준 TOC 링크는 이런 형태입니다:
- `#Controller_Software/.../Socket/receive_sock.htm?TocPath=...`

이건 브라우저 내 네비게이션(해시)이라서 크롤러/요약기가 본문을 놓치기 쉽습니다.
따라서 다음 규칙으로 바꾸면 됩니다.

- 앞의 `#` 제거
- `?TocPath=...` 쿼리 제거
- 앞에 도메인 `https://www2.brooksautomation.com/`를 붙임

예:
- `#Controller_Software/Software_Reference/GPL_Dictionary/Network/Socket/receive_sock.htm?TocPath=...`
→ `https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Network/Socket/receive_sock.htm`

이 방식이면 **필요한 페이지 URL 리스트를 만들어 한 번에 요청**(허용 알람 1회)로 끝낼 수 있습니다.

---

## 9) 체크리스트(실무)
- TCP 서버:
  - `TcpListener.Start` 호출 이후에만 `Pending/AcceptSocket`
  - `AcceptSocket`은 기본적으로 블록됨 → `Pending`으로 방어
- TCP 세션:
  - `Receive`가 0을 반환하면 연결 종료로 판단하고 close
  - blocking + timeout 조합을 설계(특히 stop/close 시나리오)
- UDP:
  - `ReceiveFrom`의 `remote_endpoint`는 ByRef로 덮어씌워짐
  - `max_length > 1536`은 실익이 제한적
- KeepAlive:
  - 끊김 감지 목적이면 양쪽 노드에서 모두 활성화 고려

