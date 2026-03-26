# INCIDENTS

## Executive Summary

- 2026-01-02 Socket에 `Nothing` 대입 시(특히 Socket Property) 대입 순간 컨트롤러 정지/크래시: `Nothing` 대입 제거 + Socket Property get-only화로 차단.
- 2025-12-04 XML 파일에 빈 줄이 이중으로 생성되는 문제: CRLF 대신 LF만 사용하도록 BuildXmlString 수정.
- 2025-12-04 StreamReader.EndOfStream() unsupported; replaced with Peek() >= 0 to detect EOF correctly.
- 2025-12-04 Line break omission errors: End If/Exit Function followed immediately by next statement on same line.
- 2025-09-17 Exception handling compile errors: Catch syntax and On Error misuse fixed; standardized TestAndSet patterns.
- 2025-09-17 XmlAsyncSave compile errors (Shared, Len): Removed Shared, added to Project.gpr; Len usage clarified.
- 2025-09-17 Invalid data type XmlStoreModule: Wrong instantiation syntax; fixed to `New XmlStore`.

> 레거시 명칭 메모(과거 기록 읽기용):
> - (구) XmlAsyncSave(.gpl) → (현) Data_AsyncSave.gpl
> - (구) XmlStore(.gpl) → (현) Data_XmlStore.gpl (내부 Class 이름은 여전히 XmlStore)
> - (구) FileIOManager(.gpl) → (현) IO_FileManager.gpl
> - (구) ErrorHandlerKDY(.gpl) → (현) Core_ErrorHandler.gpl
> - (구) Main.gpl → (현) Core_Main.gpl
> - (구) XMLHandler_KDY.gpl → (현) 리포지토리에서 제거됨

## 2026-01-02: Socket에 `Nothing` 대입 시 컨트롤러 정지/크래시 (버그성)

- 증상

  - `Socket` 변수/배열/필드에 `= Nothing`을 **대입하는 순간** 컨트롤러가 멈추는(크래시하는) 현상이 관측됨.
  - 특히 `Socket`을 **Property로 노출**한 형태에서 `session.Socket = Nothing` 대입이 트리거가 될 수 있음.
  - 일반적인 예외(NullReference 등)처럼 **Try/Catch로 잡히지 않음**.

- 원인

  - 정확한 내부 원인은 불명(컨트롤러/런타임 쪽 버그성 동작으로 추정).
  - 결론적으로 "왜"보다 "하지 말 것"이 더 중요.

- 조치 (패치 적용)

  1) 런타임 코드(`Test_robot/`)에서 **Socket에 대한 `= Nothing` 명시 대입 제거**
     - 예: `clientSocket = Nothing`, `tcpipSocket(slotIndex) = Nothing` 등.

  2) `Net_Tcp_Session.TcpSession`의 `Socket`을 **Get-only로 변경**하여 외부 대입 차단
     - 소켓 연결은 `AttachSocket(sock)`로만 수행.

  3) 서버 루프에서 `session.Socket = ... / = Nothing` 형태를 제거하고 세션 메서드로만 처리
     - 연결 종료 시에도 `session.Socket = Nothing` 금지.

- 영향 범위

  - 네트워크(TCP) 연결/정리 루틴
  - 코드 리뷰에서 Socket 정리 로직이 “값 대입”으로 표현되어 있으면 위험

- 교훈 / 예방

  - **Socket에는 `Nothing`을 절대 대입하지 말 것.** (대입 자체가 위험)
  - Socket을 Property로 노출하더라도 **setter 제공 금지**(Get-only 권장).
  - 리뷰 시 "Socket"과 "= Nothing" 조합은 우선적으로 차단.
  - 관련 규칙은 아래 문서에 상시 반영:
    - `docs/Project/COMMON_MISTAKES.md` (0-6)
    - `docs/Project/ERROR_PREVENTION_CHECKLIST.md` (Socket 안전 항목)

## 2025-12-04: XML 파일 빈 줄 이중 생성 문제

- 증상

  - XmlStore로 저장된 XML 파일에서 각 태그 사이에 빈 줄이 하나씩 추가로 들어감.
  - 예: `<?xml version="1.0" encoding="UTF-8"?>` 다음에 빈 줄, `<root>` 다음에 빈 줄, 각 데이터 태그 사이에도 빈 줄.

- 원인

  - `BuildXmlString()` 함수에서 각 줄 끝에 `Utils.CRLF` (CR+LF, `\r\n`)를 사용.
  - GPL의 StreamWriter 또는 파일 시스템이 줄바꿈을 추가로 처리하여 이중 줄바꿈 발생 가능성.
  - Windows 환경에서 CRLF가 예상과 다르게 처리될 수 있음.

- 조치 (패치 적용)

  1) **XmlStore.gpl (BuildXmlString)**: `Utils.CRLF` → `Utils.LF`로 변경.
  2) 각 줄 끝에 LF(Line Feed, `\n`)만 추가하여 단일 줄바꿈 보장.

- 검증

  - 수정 후 프로젝트 빌드 및 테스트 필요.
  - 생성된 XML 파일에서 빈 줄이 제거되었는지 확인.

- 교훈

  - XML 또는 텍스트 파일 생성 시 줄바꿈 문자 선택에 주의.
  - GPL의 파일 I/O가 줄바꿈을 어떻게 처리하는지 실제 출력 파일로 검증 필요.
  - 플랫폼별 줄바꿈 차이(Windows: CRLF, Unix: LF)를 고려하여 일관된 형식 사용.

## 2025-12-04: StreamReader EOF 감지 및 줄바꿈 누락 오류

- 증상

  - XmlStore.gpl: 137, 141줄에서 `Unexpected text at end of line`, 142, 144, 150, 151줄에서 `Undefined symbol content`.
  - FileIOManager.gpl: 235줄에서 `Undefined symbol EndOfStream`, 244줄에서 `No matching control structure`.

- 원인

  1) **줄바꿈 누락**: `End If`, `Exit Function` 등 문장 끝에 줄바꿈 없이 다음 문장이 바로 이어져 컴파일러가 한 줄로 인식.
  2) **EndOfStream() 미지원**: GPL의 `StreamReader`는 `EndOfStream()` 메서드를 지원하지 않음. VB.NET 호환 가정으로 작성했으나 컴파일 실패.
  3) **EOF 감지 오류**: 이전 구현에서 `ReadLine()` 결과가 빈 문자열(`""`)일 때 EOF로 판정했으나, 이는 실제 빈 줄과 구분할 수 없어 파일 읽기 조기 종료 발생.

- 조치 (패치 적용)

  1) **XmlStore.gpl (LoadFromFile)**: `End If` 뒤에 적절한 줄바꿈 추가, `Dim content` 선언 위치 정리.
  2) **FileIOManager.gpl (ReadFileContent)**: 
     - `Do While Not reader.EndOfStream()` → `Do While reader.Peek() >= 0`로 변경.
     - `Peek()`는 다음 읽을 문자를 미리 보며, EOF일 때 음수(-1) 반환하므로 빈 줄과 EOF를 정확히 구분.
     - `isFirstLine` 플래그로 첫 줄 처리, 이후 줄은 `Utils.CRLF` 추가하여 이어붙임.

- 검증

  - 수정 후 `XmlStore.gpl`, `FileIOManager.gpl` 모두 컴파일 에러 없음 확인.
  - 파일 읽기 시 빈 줄 포함한 전체 내용이 정상 로드됨.

- 교훈

  - **GPL StreamReader API**: `Peek() >= 0`으로 EOF 감지, `EndOfStream()` 사용 금지.
  - **줄바꿈 필수**: 모든 제어문(`End If`, `End Sub`, `Exit Function` 등) 뒤에는 반드시 줄바꿈 추가.
  - **빈 줄 vs EOF**: `ReadLine() = ""`로 EOF 판정하면 실제 빈 줄에서 조기 종료되므로 절대 사용 금지.
  - **에러 연쇄**: 줄바꿈 누락 같은 파싱 오류는 후속 변수 인식 오류를 유발하므로 첫 오류부터 해결 후 재컴파일.

## 2025-09-17: 예외 처리 컴파일 오류

- 증상

  - Main.gpl, ErrorHandlerKDY.gpl에서 `Undefined symbol ex`, `Illegal use of keyword On`, `No matching control structure` 등 발생.

- 원인

  - GPL 예외 처리 규칙과 VB.NET 관성 혼용: `Catch ex As Exception`, `On Error ...` 사용, 예외 속성 접근 규격 불일치.

- 조치 (패치 적용)

  1) Main.gpl: `Catch excLoop`/`Catch excMain`으로 변경, `excLoop.Message()` 사용, Finally의 `On Error` 제거, 종료 시 `TcpCommunication.StopAll()` 및 `XmlAsyncSave.Flush(2000)` 호출 유지.
  2) ErrorHandlerKDY.gpl: `On Error` 제거, `ErrorCode`/`Message()`/`RobotError`/`RobotNum`/`Axis` 접근을 Try/Catch 가드로 안전화.
  3) XMLHandler_KDY.gpl: Mutex 제거, `Thread.TestAndSet` 세마포어와 `started` 플래그로 스레드-세이프화 및 단일 시작 보장.
  4) TcpCommunication.gpl: `StopAll()` 도입, 리스너/수신 루프에 종료 플래그 체크 추가.

- 검증

  - 컴파일 재시도 기준 오류 해소. 추가 오류 발생 시 동일 원칙으로 라인별 수정 진행.

- 교훈

  - GPL은 `Try...Catch...Finally...End Try`만 사용, `Catch` 뒤 예외 변수 필수.
  - `On Error`는 사용하지 않음. 예외 메시지는 `Message()` 메서드 형태에 주의.
  - 모듈 스코프 변수는 `Private Dim`, 락은 `Thread.TestAndSet` 세마포어 사용 권장.

## 2025-09-17: XmlAsyncSave 컴파일 오류 (Shared, Len)

## 2025-09-17: Invalid data type XmlStoreModule (Main.gpl)

- 증상

  - 빌드 로그: `Main.gpl:21:(-738): Invalid data type XmlStoreModule`, `Main.gpl:27:(-738): Invalid data type XmlStoreModule`.

- 원인

  - `XmlStore.gpl`은 `Module XmlStoreModule` 내부에 `Public Class XmlStore`가 정의되어 있으나, GPL에서는 네임스페이스처럼 `XmlStoreModule.XmlStore`를 타입명으로 사용하지 않음.
  - 인스턴스 생성 시 `New XmlStoreModule.XmlStore`를 사용하여 타입 인식 실패.

- 조치 (패치 적용)

  1) `Main.gpl`: `Dim storeA As New XmlStore`, `Dim storeB As New XmlStore`로 수정.
  2) 전체 컴파일 재시도로 오류 해소 확인.

- 교훈

  - GPL의 Module은 네임스페이스가 아님. 타입 참조 시 클래스명만 사용.
  - 새 모듈 도입 시 샘플 코드에서도 GPL 타입 해석 규칙을 우선 검증.


- 증상

  - XmlAsyncSave.gpl 초반부에서 `Illegal use of keyword` 다수 발생.
  - 후속 빌드에서 `Missing string Len` 오류가 1건 보고됨.

- 원인

  - GPL 문법에서 모듈 스코프의 `Shared` 키워드 사용 불가 → 키워드 불법 사용 오류.
  - 파서가 앞선 문법 오류의 영향으로 `Len(...)` 호출을 오진(누락 문자열)한 것으로 추정.
  - 참고: 문자열 길이는 `Len(string)` 사용, 배열 길이는 `array.Length` 사용 (Array Class Summary).

- 조치 (패치 적용)

  1) XmlAsyncSave.gpl: 모든 `Private Shared Dim` → `Private Dim`으로 변경, 나머지 로직/스코프 유지.
  2) Project.gpr: `XmlAsyncSave.gpl`, `XmlStore.gpl`을 ProjectSource에 추가(심볼 해소).
  3) 관련 모듈 정합성 점검(예외/If 구문 등) 후 재컴파일.

- 검증

  - 변경 후 전체 컴파일 통과. `Len` 관련 오류 재현되지 않음.

- 교훈

  - 모듈 스코프 변수는 `Private Dim`을 기본으로 사용(Shared 지양).
  - 문자열/배열 길이: `Len(s As String)`, `arr.Length`를 구분 사용.
  - 선행 문법 오류는 후속 오류를 연쇄적으로 유발하므로, 첫 오류부터 제거 후 재컴파일 반복.
