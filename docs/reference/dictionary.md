# GPL Dictionary — 프로젝트용 인덱스

> 목적: Brooks/Guidance GPL Dictionary의 “큰 분류(TOC)”를 프로젝트 관점으로 한 장에 정리합니다.
>
> 핵심 원칙:
>
> - TOC의 `#...?...TocPath=...` 링크는 크롤링/요약에서 본문이 누락되기 쉬우므로, **직접 URL**로 변환해 사용합니다.
> - 이 문서는 “개요/요약(인트로 페이지)” 중심입니다. (각 멤버별 상세 페이지까지 전부 수집하면 분량이 매우 커짐)
>
> 출처(루트):
>
> - GPL Dictionary Pages Summary: https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/intro.htm

공식 intro 페이지 요지:

- GPL Dictionary는 GPL에서 사용 가능한 **instruction/keyword/function** 및 각 **class의 property/method**에 대한 상세 정보를 제공합니다.
- 설명은 **클래스 단위** 또는 **주요 기능 단위**로 그룹핑되며, **각 그룹 내부는 알파벳 순**으로 정렬됩니다.
- 표기 규칙(문서 내 관례):
  - instruction/keyword/function/group/property/method 이름: **굵게(bold)**
  - 사용자가 정한 변수 이름: *이탤릭(italics)*
  - 코드 스니펫: 고정폭 글꼴(Courier)

---

## 목차

- [0) 해시(#) TOC 링크 → 직접 URL 변환 규칙](#0-해시-toc-링크--직접-url-변환-규칙)
- [1) GPL Dictionary 큰 분류(요약)](#1-gpl-dictionary-큰-분류요약)
  - [1.1 Statements 요약(문장 목록)](#11-statements-요약문장-목록)
  - [1.2 Dim Statement 핵심 규칙](#12-dim-statement-핵심-규칙)
  - [1.3 String Summary 핵심 요약](#13-string-summary-핵심-요약)
- [2) 프로젝트 관점 “어디서 많이 쓰나” 빠른 매핑](#2-프로젝트-관점-어디서-많이-쓰나-빠른-매핑)
- [3) 이 프로젝트에서 이미 정리된 세부 문서](#3-이-프로젝트에서-이미-정리된-세부-문서)
- [4) 다음 확장(원하면)](#4-다음-확장원하면)

## 0) 해시(#) TOC 링크 → 직접 URL 변환 규칙

TOC 링크 예:

- `#Controller_Software/Software_Reference/GPL_Dictionary/Network/networkintro.htm?TocPath=...`

직접 URL:

- `https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Network/networkintro.htm`

변환 규칙:

1. 맨 앞의 `#` 제거
2. 뒤의 `?TocPath=...` 제거
3. 앞에 `https://www2.brooksautomation.com/` 붙이기

---

## 1) GPL Dictionary 큰 분류(요약)

아래 항목들은 **각 그룹의 intro 페이지**(summary table) 기준으로 정리했습니다.

| 그룹                        | 한 줄 요약                                         | 공식 intro                                                                                                                      |
| --------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Array Class                 | 모든 타입의 배열 변수를 위한 기본 속성/메서드      | https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Array/arrayintro.htm                    |
| Console Class               | GPL 콘솔 출력(진단용)                              | https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Console/consoleintro.htm                |
| Controller Class            | 컨트롤러(하이파워/E-Stop/PDB 등) 시스템 기능 접근  | https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Controller/cntrlclassintro.htm          |
| Exception Handling          | Try/Catch/Throw 등 + Exception 클래스              | https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Exception_Handling/exception_intro.htm  |
| File and Serial I/O Classes | File/StreamReader/StreamWriter로 파일·시리얼 I/O   | https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/fileserialintro.htm         |
| Functions                   | 클래스에 속하지 않는 표준 함수(형변환 등)          | https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Function_Dictionary/functionintro.htm   |
| Latch Class                 | 디지털 입력 latch 이벤트 결과(시간/위치) 수집      | https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Latch/latchintro.htm                    |
| Location Class              | 로봇/파트 위치·자세 표현(Angles/Cartesian)         | https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/locationintro.htm              |
| Math Class                  | 산술/삼각함수 등 Math 메서드 모음                  | https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Math/mathintro.htm                      |
| Modbus Class                | MODBUS/TCP 슬레이브 장치 마스터 접근               | https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Modbus/modbusintro.htm                  |
| Move Class                  | 로봇 모션 명령(목적지+프로파일 기반)               | https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Move/moveintro.htm                      |
| Networking Classes          | Ethernet 통신(IPEndPoint/Socket/Tcp*/Udp*)         | https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Network/networkintro.htm                |
| Profile Class               | 모션 성능 파라미터(speed/accel 등)                 | https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Profile_class/profileintro.htm          |
| RefFrame Class              | 기준좌표계(기본/팔레트/컨베이어)                   | https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Reference_Frame/refframeintro.htm       |
| Robot Class                 | 로봇 상태/제어(Attach/Where/Home 등)               | https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Robot/robotintro.htm                    |
| Signal Class                | 디지털/아날로그 I/O 접근                           | https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Signal/signalintro.htm                  |
| Statements                  | 언어 기본 문장(Call/Dim/If/While/Module 등)        | https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Statement_Dictionary/statementintro.htm |
| Strings                     | 문자열 변수 메서드 + 문자열 함수(Len/Mid/Instr 등) | https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/String/stringintro.htm                  |
| Thread Class                | 스레드 시작/중지/이벤트/동기화(TestAndSet)         | https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Thread/threadintro.htm                  |
| Vision Classes              | PreciseVision 인터페이스(Vision/VisResult)         | https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Vision/visionintro.htm                  |
| XML Classes                 | XML DOM 유사 API(XmlDoc/XmlNode)                   | https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/XML/xmlintro.htm                        |

---

### 1.1 Statements 요약(문장 목록)

GPL의 기본 문장들을 한 줄씩 정리한 요약 페이지입니다.
문장들은 제어 구조, 변수 선언, 서브/함수 호출 등 일반적인 BASIC 계열 문장을 기반으로 구성됩니다.

출처:

- https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Statement_Dictionary/statementintro.htm

요약 목록:

- **Call**: 프로시저 호출(반환값 무시)
- **Case / Case Else**: Select...Case...End Select 분기 항목 정의
- **Class**: 클래스 정의 시작
- **Const**: 읽기 전용 변수 선언
- **Delegate**: 함수/서브 간접 호출용 Delegate 클래스 생성
- **Dim**: 변수 선언
- **Do...Loop**: 조건 기반 반복 블록
- **Else / ElseIf**: If...Then...Else 분기
- **End**: 구조/요소 종료
- **Exit**: 제어 구조/프로시저 탈출
- **For...Next**: 횟수 기반 반복 블록
- **Function**: 사용자 정의 함수 시작
- **Get**: Property의 Get 블록 시작
- **Goto**: 라벨로 무조건 분기
- **If...Then...Else...End**: 조건 분기 블록
- **Loop**: Do...Loop 종료(조건 포함 가능)
- **Module**: 모듈 정의 시작
- **Next**: For...Next 종료
- **Property**: 사용자 정의 Property 시작
- **ReDim**: 배열 크기 변경
- **Return**: 프로시저 종료 및 값 반환
- **Select...Case...End Select**: 다중 분기
- **Set**: Property의 Set 블록 시작
- **Sub**: 사용자 정의 서브 시작
- **While...End While**: 조건 기반 반복 블록

### 1.2 Dim Statement 핵심 규칙

출처:

- https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Statement_Dictionary/Dim.htm

핵심 포인트:

- `Dim`은 **클래스/프로시저/모듈 내부**에서만 사용
- 프로시저 내부에서 `Public/Private` 사용 불가, 모듈 레벨에서 `Shared` 사용 불가
- 배열은 최대 **4차원**까지 선언 가능
- `As New`는 객체 타입에서만 가능하며, `As New` 사용 시 `= init` 불가
- 여러 변수를 한 줄에 선언할 때는 **초기화(init) 금지**
- `Shared` 변수는 **단일 인스턴스**로 유지(스레드/호출 간 값 보존)
- 비-Shared 변수는 **프로시저 호출/객체 생성 시마다 재초기화**
- 초기값 미지정 시 숫자형은 `0`, 객체형은 `Nothing`

### 1.3 String Summary 핵심 요약

문자열 변수의 **속성/메서드 + 문자열 함수**를 요약한 인트로 페이지입니다.
문자열은 내장 클래스 구조를 재사용하며, BASIC 계열 함수와 문자열 메서드가 함께 제공됩니다.

출처:

- https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/String/stringintro.htm

핵심 포인트:

- 문자열 조작을 위한 **속성/메서드 + 함수**가 함께 제공됨
- `CStr`, `CDbl`, `CInt`, `Hex` 등 **형변환 함수**도 문자열 처리 흐름에서 자주 사용

대표 메서드/속성(요약 표 일부):

- `String.Compare`: 두 문자열 비교(대소문자 구분/무시)
- `string.IndexOf`: 부분 문자열 검색(0~n)
- `string.Length`: 문자열 길이
- `string.Split`: 구분자로 분할 → 배열 반환
- `string.Substring`: 부분 문자열 추출
- `string.ToLower` / `string.ToUpper`: 대소문자 변환
- `string.Trim` / `TrimStart` / `TrimEnd`: 공백/문자 제거

대표 문자열 함수(요약 표 일부):

- `Asc`, `Chr`: ASCII ↔ 문자 변환
- `Format`: 숫자 → 형식화 문자열
- `FromBitString` / `ToBitString`: 비트 패킹 문자열 변환
- `InStr`: 부분 문자열 검색(1~n)
- `LCase` / `UCase`: 대/소문자 변환
- `Len`, `Mid`: 길이/부분 문자열 처리

## 2) 프로젝트 관점 “어디서 많이 쓰나” 빠른 매핑

이 저장소는 파일 접두사로 계층을 구분합니다.

- `Core_`: 에러/유틸/스레드 안전/공통
- `IO_`: 네트워크/파일 I/O
- `Data_`: 저장/로드/영속화
- `Robot_`: 실제 로봇 동작/시퀀스

TOC 그룹별로 보면(그리고 이 저장소 docs 기준으로 정리하면) 보통 이렇게 연결됩니다.

- Statements / Functions → 언어 기본 문장/규칙(필요 시 공식 페이지를 직접 참조)
- Strings → `../gpl-language/strings.md`
- Array Class / ReDim / GetUpperBound 등 → `../gpl-language/arrays.md`
- Networking Classes(Socket/Tcp*/Udp*) → `../gpl-language/networking.md`
- File and Serial I/O Classes → `../gpl-language/file-io.md`
- Thread Class → `../gpl-language/threading.md`, `../gpl-language/thread-safety.md`
- Exception Handling → `../gpl-language/error-handling.md`
- Robot Class(Home/Where/Attach 등) 및 Homing 개요 → `./robot-homing-methods.md`

---

## 3) 이 프로젝트에서 이미 정리된 세부 문서

- Arrays(0-based, upper bound, ReDim, 참조 공유): [`../gpl-language/arrays.md`](../gpl-language/arrays.md)
- Networking (Socket/TcpListener/TcpClient/UdpClient/IPEndPoint): [`../gpl-language/networking.md`](../gpl-language/networking.md)
- File I/O: [`../gpl-language/file-io.md`](../gpl-language/file-io.md)
- Threading / Thread Safety: [`../gpl-language/threading.md`](../gpl-language/threading.md), [`../gpl-language/thread-safety.md`](../gpl-language/thread-safety.md)
- Error Handling: [`../gpl-language/error-handling.md`](../gpl-language/error-handling.md)
- Homing Methods(요약): [`./robot-homing-methods.md`](./robot-homing-methods.md)

---

## 4) 다음 확장(원하면)

각 그룹은 intro가 다시 “멤버별 상세 페이지”를 많이 링크합니다.

원하시면 다음 중 하나로 확장할 수 있어요.

- (A) **자주 쓰는 그룹만** 상세까지 파고들어 ‘프로젝트 베스트 프랙티스’로 정리 (추천)
- (B) TOC 전체를 **자동 수집 + 자동 요약**해서 방대한 레퍼런스 문서 생성 (분량/유지보수 비용 큼)
