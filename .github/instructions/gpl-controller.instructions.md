---
description: "Use when editing Brooks GPL controller communication, TCP ports 1402/1403, runtimeConsole, FTP upload, deploy flow, debugger transport, or response parsing. Covers serial command rules, port invariants, sendCommand semantics, and 1403 shutdown/reconnect behavior."
applyTo:
  - "src/controller/**/*.ts"
  - "src/debug/**/*.ts"
  - "src/views/**/*.ts"
---

# GPL Controller Communication Rules

- 고정 포트는 하드웨어 제약이다. 변경하지 않는다.
  - 1402: 명령 송수신
  - 1403: 런타임 콘솔 이벤트
  - 21: FTP
  - 51417: UDP 검색
- 제어기는 동시 TCP 요청을 처리하지 못하므로 `sendCommand()`를 병렬 호출하지 않는다.
- 디버그 세션은 `_enqueueCommand()`로 직렬화하고, UI 측 호출도 순차 `await`를 유지한다.

## `sendCommand()` 규칙

- `sendCommand()`는 `</STATUS>` 수신 시 resolve한다.
- 에러 STATUS도 resolve 대상이며, reject는 네트워크 실패에서만 발생한다.
- 따라서 resolve된 응답에 대해 항상 `isSuccess()`, `parseStatus()`, `parseCompileErrors()` 등을 사용해 결과를 확인한다.

## 응답 파싱 단일화

- 응답 파싱은 `src/controller/responseParser.ts` 한 곳에서만 수행한다.
- 새 파싱 로직이 필요하면 `responseParser.ts`에 추가한다.
- 서비스/프로바이더/디버거 코드에서 임의 XML/문자열 파싱을 중복 구현하지 않는다.

## 1403 런타임 콘솔 규칙

- 1403은 지속 스트리밍보다 **이벤트 배치 모드**로 취급한다.
- 데이터 수신 후 FIN이 오면 즉시 재연결하는 현재 정책을 유지한다.
- 에러/빈 세션은 지수 백오프를 사용한다.
- 사용자 명시 중지(`_explicitStop`) 시 자동 재연결을 차단한다.
- 소켓 종료는 반드시 `socket.end()`를 사용한다. `socket.destroy()`는 금지다.

## 근거 우선순위

- 1순위: Brooks 공식 문서
- 2순위: 로컬 GPL 문서 보강
- 3순위: 코드/로그/실험 결과
- 공식 근거가 없는 내용은 추정 또는 가설로 표시한다.
