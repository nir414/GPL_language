# GPL (Guidance Programming Language) 자료 정리

**GPL(Guidance Programming Language)** 관련 실무 자료를 정리한 인덱스입니다.

> 참고: 여기서 말하는 GPL은 Brooks Automation의 **Guidance Programming Language**이며 GNU GPL 라이선스와 무관합니다.

---

## 1) 추천 읽기 순서 (빠른 온보딩)

1. **언어 개요 + VB.NET 차이/제약**
   - `docs/imported/Test_robot_docs/Project/GPL_언어_실무_가이드.md`
2. **자주 터지는 실수/컴파일 에러 패턴**
   - `docs/imported/Test_robot_docs/Project/COMMON_MISTAKES.md`
3. **데이터 타입/상수/문자 제약(ASCII 등)**
   - `docs/imported/Test_robot_docs/Project/GPL_데이터타입_상수_정리.md`
4. **문자열 처리 표준(Left/Right/Val 등 대체 포함)**
   - `docs/imported/Test_robot_docs/Project/STRING_API_GUIDE.md`
5. **예외/로그 표준화(운영 안정성)**
   - `docs/imported/Test_robot_docs/Project/ERROR_HANDLING_GUIDE.md`
6. **스레드/동기화(TestAndSet 패턴)**
   - `docs/imported/Test_robot_docs/Project/GPL_THREAD_CLASS_SUMMARY.md`
7. **네트워킹(Socket/TcpClient/TcpListener/UdpClient)**
   - `docs/imported/Test_robot_docs/Project/GPL_NETWORKING_GUIDE.md`
8. **XML DOM( XmlDoc/XmlNode ) 요약**
   - `docs/imported/Test_robot_docs/XML/XML_Classes_Summary.md`
9. **공식 레퍼런스 인덱스/문장 요약**

- `docs/imported/Test_robot_docs/Project/GPL_DICTIONARY_GUIDE.md`

---

## 2) 핵심 요약 (실무 관점)

### 2.1 언어 성격 / VB.NET과의 차이

- 컨트롤러 내장(임베디드) 언어로, VB.NET과 문법이 유사하지만 **.NET 타입/기능 일부가 미지원**입니다.
- 제약 예시(특히 컴파일/런타임에서 자주 만나는 것들):
  - `On Error GoTo` 금지 → `Try...Catch...End Try`만 사용
  - `Optional` 매개변수 미지원 → 오버로드로 대체
  - `Left/Right/InStrRev/Val/EndOfStream/UBound` 등 VB 계열 함수 일부 미지원(문서에 대체 패턴 정리됨)
  - `String`이 `Nothing`일 수 있어 `Len/Mid/=` 호출 전 방어 필요 (환경에 따라 `And/Or` 단락평가가 불확실할 수 있어 **단계적 체크 권장**)

근거 문서:

- `Project/GPL_언어_실무_가이드.md`
- `Project/COMMON_MISTAKES.md`

### 2.2 객체/참조(포인터) 모델 — “대입은 값 복사가 아니라 참조 복사”

- 객체 변수는 값 자체가 아니라 **참조(pointer)** 를 들고 있습니다.
- `b = a`는 값 복제가 아니라 “같은 객체를 가리키게 되는 것”이라, 이후 `a.X = 10`이면 `b.X`도 10으로 보일 수 있습니다.
- 독립 복제가 필요하면 클래스가 제공하는 `Clone`을 사용.

근거 문서:

- `Project/GPL_언어_실무_가이드.md`

### 2.3 데이터 타입/상수/문자 제약

- 지원 타입: `Boolean, Byte, Short, Integer, Single, Double, String, Object(사용자 정의 불가)`
- 미지원 타입: `Long/Int64, Decimal, Char, Variant, Date` 등
- 입력 문자는 **7-bit ASCII만 허용**(유니코드/8-bit ASCII 사용 제약)
- 16진수 `&H`, 8진수 `&O` 지원(문자열 연결 시 `&` 뒤 공백 필요 등의 주의사항 있음)

근거 문서:

- `Project/GPL_데이터타입_상수_정리.md`

### 2.4 문자열 처리 표준 (미지원 함수 대체 포함)

- 권장 패턴:
  - 앞 n글자: `Mid(s, 1, n)`
  - 뒤 n글자: `Mid(s, Len(s) - n + 1)`
  - 검색: `InStr(1, source, sub)` (시작 인덱스 명시)
  - `InStrRev` 미지원 → `For i = 1 To Len(path)`로 마지막 구분자 위치를 수동 탐색
  - `Val` 미지원 → `CInt`, `CDbl`로 명시 변환

근거 문서:

- `Project/STRING_API_GUIDE.md`
- `Project/COMMON_MISTAKES.md`

### 2.5 스레드/동기화

- Thread StartProcedure는 아래 중 하나를 만족해야 안정적으로 동작:
  1. **모듈(Module) 내 Public Sub** (문자열로 `Module.SubName` 지정)
  2. **클래스(Class) 내 Public Shared Sub**
- 동기화는 `Thread.TestAndSet(lockVar, 1)` + `Thread.Sleep(0)` 기반 스핀락 패턴을 사용.

근거 문서:

- `Project/GPL_THREAD_CLASS_SUMMARY.md`

### 2.6 네트워킹(TCP/UDP) 핵심 포인트

- `TcpClient.Client`, `UdpClient.Client`, `TcpListener.AcceptSocket` 등은 실제 송수신 본체인 `Socket`을 반환.
- 타임아웃은 길이 파라미터가 아니라 `socket.ReceiveTimeout` / `socket.SendTimeout`으로 제어.
- 종료/stop 시나리오에서는 **blocking Receive를 socket close로 깨우는 패턴**이 중요.
- `KeepAlive`의 동작 타이밍(문서에 고정값으로 명시됨)을 알고 운영 기준에 맞게 사용.

근거 문서:

- `Project/GPL_NETWORKING_GUIDE.md`

### 2.7 XML( XmlDoc / XmlNode ) 핵심 포인트

- `XmlDoc`는 문서 전체(로드/세이브/루트 접근)
  - `XmlDoc.LoadFile`, `XmlDoc.LoadString`, `xmldoc.SaveFile`, `xmldoc.SaveString`
  - 엔티티 변환: `XmlDoc.EncodeEntities`, `XmlDoc.DecodeEntities`
- `XmlNode`는 개별 노드(자식/형제 이동, 요소/속성 get/set, 추가/삭제)

근거 문서:

- `XML/XML_Classes_Summary.md`

### 2.8 예외/로그 표준화

- 모듈마다 `Console.WriteLine` 난발 대신, **`Core_ErrorHandler`로 일원화**
- Silent catch 금지. 필요 시:
  - 상위 전파 또는
  - `Core_ErrorHandler.logException(ex, context)` 또는
  - 빈번 실패 경로는 throttle 로깅

근거 문서:

- `Project/ERROR_HANDLING_GUIDE.md`

### 2.9 GPL Dictionary 요약(Statements 포함)

- GPL 공식 레퍼런스의 **큰 분류(TOC)**를 프로젝트 관점으로 정리
- Statements 요약 페이지와 Dim/Const/ReDim 같은 핵심 문장 규칙을 빠르게 참조 가능
- 해시(#) TOC 링크를 직접 URL로 변환하는 규칙 포함

근거 문서:

- `Project/GPL_DICTIONARY_GUIDE.md`

---

## 3) 포함된 문서 목록

아래 문서들은 GPL 개발 실무에서 수집한 베스트 프랙티스와 패턴을 포함합니다.

- 컨트롤/배포/프로젝트 운영
  - `CONTROLLER_UPLOAD_AUTOMATION.md`
  - `DEVELOPER_HANDOVER.md`
  - `PROJECT_STRUCTURE.md`
  - `PROJECT_REVIEW_2025-12-08.md`
  - `Project/VERSION_MANAGEMENT.md`

- GPL 언어/표준/핵심 가이드
  - `Project/GPL_언어_실무_가이드.md`
  - `Project/GPL_데이터타입_상수_정리.md`
  - `Project/STRING_API_GUIDE.md`
  - `Project/COMMON_MISTAKES.md`
  - `Project/ERROR_PREVENTION_CHECKLIST.md`
  - `Project/ERROR_HANDLING_GUIDE.md`

- 네트워킹/스레드
  - `Project/GPL_NETWORKING_GUIDE.md`
  - `Project/GPL_DICTIONARY_GUIDE.md` (공식 레퍼런스 인덱스 + URL 변환 규칙)
  - `Project/GPL_THREAD_CLASS_SUMMARY.md`
  - `Project/GPL_THREAD_SAFETY.md`

- XML/JSON
  - `XML/XML_Classes_Summary.md`
  - `JSON/JSON_IMPLEMENTATION_NOTES.md`

- 히스토리/세션 메모(참고)
  - `Project/INCIDENTS.md`
  - `Project/History/Sessions/*`

---

## 4) VS Code 확장과의 연계

이 자료들은 GPL Language Support 확장의 진단 규칙과 코드 액션의 기준이 됩니다:

- **진단 규칙**: `Optional`, `On Error`, `Left/Right/Val`, `EndOfStream` 등 미지원 구문 감지
- **코드 액션**: VB.NET 호환성 대안 제안, 권장 패턴 제시
- **자동완성**: GPL 특화 패턴 및 API 제안

자세한 내용은 프로젝트 루트의 [README.md](../README.md)를 참고하세요.
