# GPL Broker + Workbench 아키텍처 설계

> 상태: **제안(Draft)** · 작성일 2026-06-25 · 대상 독자: 본 저장소 유지보수자
>
> 목적: 제어기 GUI / 시뮬레이터 / 상태 모니터를 VSCode 확장에 내장하는 방식의 구조적
> 한계를 벗어나기 위해, **연결을 독점하는 Broker 프로세스**와 **별도 GPL Workbench 앱**으로
> 분리하는 목표 아키텍처를 정의한다. 프로토콜·프레임워크 선택과 단계별 마이그레이션 로드맵을 포함한다.

---

## 1. 배경과 문제 정의

현재 확장은 **모든 기능을 단일 확장 호스트 프로세스에 내장**한다.

- 언어 기능(파서·심볼·8개 Provider)
- 제어기 통신(1402 명령 / 1403 이벤트 스트림 / FTP / 배포)
- 디버그 어댑터(`brooks-gpl` DAP)
- 상태 모니터(`gplThreads` TreeView), 트래픽 모니터(OutputChannel)

GUI 야망(제어기 GUI, 시뮬레이터, 풍부한 상태 모니터)이 커질수록 다음 한계에 부딪힌다.

1. **UI 표현력**: 확장이 쓸 수 있는 건 TreeView / Webview / StatusBar뿐. 실시간 시각화·시뮬레이터는
   Webview 샌드박스 + 메시지 패싱에서 상태 관리가 비대해지고, 연속 렌더링/3D에는 부적합하다.
2. **수명주기 결합**: 확장은 에디터에 묶여 "에디터 없이 모니터만"이 불가능하다.
3. **소켓 접근 우회**: Webview는 제어기 소켓에 직접 못 붙고 확장 호스트를 프록시로 거친다. GUI가 풍부해질수록 병목.
4. **단일 클라이언트 제약**(가장 중요): 제어기는 *단일 클라이언트 / 단일 명령 스트림 / 명시적 상태 머신*으로
   다뤄야 한다. 별도 Workbench 앱이 제어기에 **직접** 붙으면 확장과 경합한다.

### 핵심 통찰

> "복잡한 기능은 별도 프로세스로 빼고 여러 클라이언트가 재사용한다"는 LSP 원칙을 **제어기 통신에도 대칭으로 적용한다.**

| 두뇌 | 별도 프로세스 | 클라이언트 |
|------|--------------|-----------|
| 언어 분석 | Language Server *(별도 로드맵)* | VSCode 확장, (장차 타 에디터) |
| **제어기 통신** | **Controller Broker** *(본 문서)* | VSCode 확장, GPL Workbench, (장차 CLI/CI) |

---

## 2. 현재 코드 구조 (조사 결과)

브로커가 떠안을 자산과 결합도를 실제 코드 기준으로 정리한다.

| 모듈 | 역할 | vscode 결합도 | 추출 난도 |
|------|------|--------------|-----------|
| `controller/controllerConnection.ts` | 1402 명령 송수신, **전역 직렬 큐**, config, 세션 오버라이드 | 낮음 (config 읽기 + 트래픽 OutputChannel) | **낮음** |
| `controller/responseParser.ts` | 응답 파싱(스레드/스택/컴파일에러/상태) | 없음(순수) | 없음 |
| `controller/ftpClient.ts` | FTP list/remove/upload/download | 낮음 | 낮음 |
| `controller/deployService.ts` | `deploy()` = STOP→UPLOAD→COMPILE 오케스트레이션 | 중 (Diagnostic/Output) | 중 |
| `controller/runtimeConsole.ts` | 1403 이벤트 스트림 + 재연결 상태 머신 | **높음** (OutputChannel/Disposable/EventEmitter) | **중~상** |
| `controller/debugBridge.ts` | 디버그 스레드/폴 트리거 이벤트 버스 | 높음(vscode EventEmitter) | 낮음(재구현) |
| `debug/gplDebugSession.ts` | DAP 구현, `sendCommand`로 1402 직접 사용 | 높음(DAP+vscode) | **특수**(§9) |
| `views/controllerTreeProvider.ts` | 상태 모니터 TreeView | 높음(전적으로 UI) | Workbench로 이전 |

### 결정적 사실 — 단일 명령 스트림은 이미 코드로 강제됨

```ts
// controllerConnection.ts:130-145 (요약)
let controllerCommandQueue: Promise<void> = Promise.resolve();
function enqueueControllerCommand<T>(task) {
  // 모든 명령을 하나의 Promise 체인에 직렬화 + 명령 간 idle gap(성공 15ms / 실패 100ms)
}
```

→ **브로커의 존재 이유가 여기 있다.** 지금은 "확장 프로세스 1개 = 큐 1개"라서 단일 스트림이 우연히 지켜진다.
Workbench가 별도 프로세스로 추가되는 순간 큐가 2개가 되어 깨진다. 브로커는 이 큐를 **프로세스 경계 너머 유일한 1개로** 만든다.

---

## 3. 설계 원칙

1. **연결 독점**: 제어기 TCP(1402/1403)·FTP에 붙는 것은 오직 브로커. 다른 모든 주체는 브로커의 클라이언트.
2. **단일 명령 스트림 보존**: 기존 `enqueueControllerCommand`의 직렬화·idle gap 정책을 브로커가 그대로 계승하고,
   여러 클라이언트의 요청을 공정하게 직렬화한다.
3. **코어 재사용**: 제어기 통신 TS 코드를 재작성하지 않는다. vscode 의존만 인터페이스로 걷어내고 패키지로 추출해 재사용.
4. **점진적 무중단**: 각 단계는 기존 확장이 계속 동작하는 상태로 끝난다. "한 번에 갈아엎기" 금지.
5. **명시적 상태 머신 단일화**: 1403 재연결/상태(`RuntimeConsoleStatusSnapshot`)와 연결 상태는 브로커 1곳에만 둔다.
6. **시뮬레이터 = 또 다른 백엔드**: 시뮬레이터는 브로커 API를 동일하게 구현하는 "가짜 제어기"로 둬, 클라이언트 UI를 1벌로 재사용.

---

## 4. 목표 아키텍처

```
                ┌─────────────────────────────────────────────┐
                │           Controller Broker (Node)            │
                │   ── 제어기 연결을 유일하게 소유 ──             │
                │   @gpl/controller-core 재사용:                 │
                │     • 1402 명령 직렬 큐 (단일 스트림)           │
                │     • 1403 이벤트 스트림 + 상태 머신            │
                │     • FTP / deploy 오케스트레이션              │
                │   백엔드 선택: [실제 제어기] | [시뮬레이터]      │
                └───▲───────────────▲───────────────▲───────────┘
                    │ WS/JSON-RPC    │               │
        ┌───────────┴────┐  ┌───────┴──────────┐  ┌─┴──────────┐
        │ VSCode 확장     │  │ GPL Workbench     │  │ (장차) CLI  │
        │ • 언어 기능     │  │  (Electron)       │  │  /CI 훅     │
        │ • 배포 트리거   │  │ • 상태 모니터 GUI  │  └────────────┘
        │ • 디버그 어댑터 │  │ • 제어기 GUI       │
        │   (브로커 경유) │  │ • 시뮬레이터 뷰    │
        └────────────────┘  └───────────────────┘
```

### 패키지 구성 (모노레포 제안)

```
packages/
  controller-core/      # vscode-free. net/ftp/parser/deploy 로직 (현 controller/* 이식)
  broker/               # controller-core를 감싼 standalone Node 데몬 + WS 서버
  protocol/             # 클라이언트·서버 공유 타입(요청/응답/이벤트 스키마)
apps/
  vscode-extension/     # 현 확장. controller/* 직접 호출 → broker 클라이언트로 전환
  workbench/            # Electron 앱 (신규)
```

---

## 5. 브로커 책임과 API 표면

기존 코드의 공개 함수를 그대로 RPC 메서드로 승격한다. (근거: 조사한 export 목록)

### 5.1 명령 (요청-응답) — 1402 기반

| RPC 메서드 | 대응 코드 | 비고 |
|-----------|----------|------|
| `command.send(text, opts)` | `sendCommandDetailed` | 직렬 큐 통과. `CommandResponse{raw, meta}` 반환 |
| `command.testConnection()` | `testConnection` | 경량 프로브 |
| `controller.getConfig()` / `setConfig()` | `getControllerConfig` + 세션 오버라이드 | IP/포트/타임아웃 |

### 5.2 이벤트 스트림 (구독) — 1403 기반

| RPC 알림(notification) | 대응 코드 |
|-----------------------|----------|
| `console.line` (payload 라인) | `RuntimeConsole.onDidReceiveData` |
| `console.status` (상태 스냅샷) | `onDidStatusChanged` + `RuntimeConsoleStatusSnapshot` |
| `console.connect` / `console.disconnect` | `onDidConnect/onDidDisconnect` |
| `console.start()` / `stop()` / `prime()` | RuntimeConsole 제어 메서드 |

### 5.3 배포 / 파일

| RPC 메서드 | 대응 코드 |
|-----------|----------|
| `deploy.run({projectDir, skipStart, ...})` | `deploy()` — 진행 상황은 알림으로 스트리밍 |
| `ftp.list/remove/upload/download` | `ftpClient.*` |
| `project.findDirs()` | `findProjectDirs` (단, 워크스페이스 개념은 클라이언트가 경로로 전달) |

### 5.4 디버그 지원

| RPC | 비고 |
|-----|------|
| `debug.threads.subscribe` | `debugBridge`의 스레드/폴 트리거를 RPC 알림으로 대체 |

> **참고**: 트래픽 로깅(`logTraffic`)과 라이브 로그는 브로커 중앙에서 발생시키고, 클라이언트는 구독만 한다.
> 이로써 "확장 OutputChannel" 같은 sink 의존이 코어에서 사라진다.

---

## 6. 프로토콜 선택: WebSocket vs gRPC

### 비교

| 기준 | WebSocket + JSON-RPC 2.0 | gRPC |
|------|--------------------------|------|
| 양방향/스트리밍 | ✅ 자연스러움 (notification = 1403 스트림) | ✅ server-streaming |
| 브라우저/Webview/Electron renderer | ✅ 네이티브 지원 | ⚠️ gRPC-web + 프록시 필요 |
| 코드 재사용(TS 일색) | ✅ 추가 런타임 0, 타입은 `protocol` 패키지 공유 | ⚠️ protoc/codegen 빌드 파이프라인 |
| 스키마 강제 | △ 런타임 검증 필요(zod 등) | ✅ protobuf 강타입 |
| 다언어 상호운용 | △ | ✅ (현재는 불필요) |
| 요청-응답 상관(correlation) | ✅ JSON-RPC `id` | ✅ |
| 운영 복잡도 | **낮음** | 중~상 |
| LSP와의 일관성 | ✅ LSP도 JSON-RPC | — |

### 권장: **WebSocket + JSON-RPC 2.0**

이유:
1. 전 구간이 TypeScript. gRPC의 최대 강점(다언어 강계약)이 현 시점에 **무용**하다.
2. 1403 이벤트 스트림 = JSON-RPC **notification**, 1402 명령 = **request/response(id)**, 배포 진행 = notification —
   세 가지 통신 형태가 JSON-RPC에 그대로 매핑된다.
3. Electron renderer / 미래의 브라우저 Workbench에서 프록시 없이 바로 붙는다.
4. LSP가 JSON-RPC라 팀의 인지 부하가 낮고, 장차 Language Server와 프레이밍을 공유할 수 있다.
5. 스키마 약함은 `packages/protocol`에 **공유 TS 타입 + zod 런타임 검증**으로 보완한다.

> 바인딩은 **127.0.0.1 루프백 한정** + 부팅 시 발급 토큰으로 최소 인증(§11 보안).

---

## 7. 프레임워크 선택: Electron vs Tauri

먼저 분리할 것: **브로커는 어느 경우든 standalone Node 프로세스**다(확장도 재사용해야 하므로).
프레임워크 선택은 "Workbench **셸**"에만 해당한다.

| 기준 | Electron | Tauri |
|------|----------|-------|
| 기존 TS/Node 코어 재사용 | ✅ 직접(메인 프로세스가 Node) | ⚠️ Rust 코어 → Node 사이드카로 브로커 동봉 |
| 번들 크기 | ✗ 큼(~120–200MB) | ✅ 작음(~10–40MB) |
| 보안 모델 | △ (직접 설계) | ✅ 기본 강함 |
| 학습/생태계 | ✅ 성숙, 자료 풍부 | △ Rust 진입장벽 |
| 자동 업데이트/서명 | ✅ 성숙(electron-updater) | ✅ 내장 |
| 우리 코드와의 마찰 | **낮음** | 중(IPC/사이드카 수명관리) |

### 권장: **1차 Electron, 번들 크기 부담 시 Tauri 재검토**

- 핵심 자산이 TS이고 **브로커를 Node 사이드카로 띄우는 구조**라, Electron이든 Tauri든 결국 Node 프로세스가 붙는다.
  그렇다면 초기엔 마찰이 가장 적은 **Electron**으로 빠르게 Workbench를 띄우는 게 합리적이다.
- 브로커를 프레임워크와 **느슨하게** 결합(별도 프로세스 + WS)해 두면, 나중에 셸만 Tauri로 갈아끼우는 비용이 작다.
  → 이 "셸 교체 가능성"을 위해 §4의 패키지 분리를 반드시 지킨다.

---

## 8. 시뮬레이터 통합

시뮬레이터를 브로커 **백엔드 인터페이스**의 또 다른 구현으로 둔다.

```
interface ControllerBackend {           // controller-core가 정의
  sendCommand(text, opts): Promise<CommandResponse>
  openEventStream(): EventStream         // 1403 대응
  ftp...(): ...
}
class RealControllerBackend implements ControllerBackend  // 현 net/ftp 코드
class SimulatorBackend     implements ControllerBackend   // 신규
```

- 브로커는 부팅 시 `[실제] | [시뮬레이터]` 중 하나를 주입받는다(설정/런타임 토글).
- Workbench의 상태 모니터·제어기 GUI는 어느 백엔드인지 **모른 채** 동일 RPC로 동작 → UI 1벌 재사용.
- 시뮬레이터는 `Show Thread`/`Move`/`Execute` 등 핵심 명령에 대해 응답·스레드 상태·1403 이벤트를 흉내 내는 것부터 시작한다.

---

## 9. 디버그 어댑터(DAP) 특수 처리

`gplDebugSession.ts`는 VSCode가 띄우는 DAP라 **확장 측에서 실행**되어야 한다. 하지만 내부에서 `sendCommand`로
1402를 직접 쓴다 → 단일 스트림 원칙상 **브로커를 우회하면 안 된다.**

**해결**: 디버그 어댑터를 **브로커 클라이언트로 전환**한다.

- `sendCommand(...)` → `brokerClient.command.send(...)`
- `debugBridge`의 폴 트리거/스레드 갱신 → 브로커의 `debug.threads`/`console.*` 구독으로 대체
- `deploy()`(attach 전 배포) → `deploy.run` RPC

이로써 디버깅 세션과 상태 폴러·Workbench가 모두 브로커의 동일 큐를 통과해 경합이 사라진다.

---

## 10. 단계별 마이그레이션 로드맵

각 Phase는 **확장이 계속 동작하는 상태**로 끝난다.

### Phase 0 — 코어 디커플링 *(코드 변경만, 외부 동작 동일)*
- `controllerConnection`에서 vscode 의존 제거: config는 주입(`ConfigSource`), 트래픽 로그는 sink 인터페이스(`TrafficSink`)로 추상화.
- `responseParser`(이미 순수), `ftpClient`, 그리고 `deploy()`의 비-UI 로직을 `packages/controller-core`로 이동.
- `runtimeConsole`의 소켓/재연결 로직과 vscode(OutputChannel/EventEmitter)를 분리: 코어는 순수 `EventStream`, vscode 어댑터는 확장에 잔류.
- **검증**: 기존 테스트(`responseParser.test` 등) 통과 + 확장 수동 동작 확인. 외형 변화 없음.

### Phase 1 — 브로커 프로세스 신설 *(병행, 확장은 아직 직접 호출)*
- `packages/broker`: controller-core를 감싸는 Node 데몬 + WS/JSON-RPC 서버(§5 API).
- `packages/protocol`: 공유 타입 + zod 검증.
- 단일 명령 큐를 브로커로 이관(여러 WS 클라이언트 요청을 공정 직렬화).
- **검증**: 임시 CLI 스크립트로 브로커에 `command.send("Show Thread")` 왕복 + 1403 구독 확인.

### Phase 2 — 확장을 브로커 클라이언트로 전환 *(단일 스트림 권위 이전)*
- 확장의 `sendCommand`/`RuntimeConsole`/`deploy`/FTP 호출을 브로커 RPC로 교체.
- **디버그 어댑터도 브로커 클라이언트화**(§9).
- 브로커 수명관리 결정: 확장이 없으면 자동 spawn + 헬스체크 + 재연결(§11).
- **검증**: 기존 디버그/배포/모니터 시나리오 회귀 테스트. 이 시점부터 제어기에 붙는 건 브로커뿐.

### Phase 3 — Workbench 셸 + 상태 모니터 *(첫 GUI)*
- `apps/workbench`(Electron) 스캐폴드. 브로커 WS에 접속.
- 현 `controllerTreeProvider`의 상태 모니터를 Workbench의 첫 네이티브 화면으로 재구현(스레드 목록/상태/에러).
- **검증**: 확장과 Workbench가 동시에 떠 있어도 경합 없이 같은 상태를 본다(단일 스트림 입증).

### Phase 4 — 제어기 GUI / FTP / 트래픽 모니터 이전
- FTP 브라우저, 명령 콘솔, 트래픽 모니터를 Workbench로.
- 확장은 "에디터 내 작업"(언어·배포 트리거·디버그)에 집중, GUI는 Workbench로 위임.

### Phase 5 — 시뮬레이터 백엔드
- `SimulatorBackend` 구현(§8). 브로커에서 실제/시뮬 토글.
- Workbench에 시뮬레이터 뷰(자세/궤적). 오프라인 개발·교육·CI 활용.

### (병렬 트랙) Language Server
- 본 문서 범위 밖이나, 동일 "별도 프로세스" 원칙. Phase 0의 패키지 분리 습관이 그대로 적용된다.

---

## 11. 리스크와 완화

| 리스크 | 영향 | 완화 |
|--------|------|------|
| 브로커 단일 장애점 | 죽으면 모든 클라이언트가 제어기 상실 | 헬스체크 + 자동 재시작, 클라이언트 재연결 backoff, 마지막 상태 캐시 |
| 브로커 수명 주체 모호 | 누가 띄우나(확장? Workbench? 데몬?) | **확장/Workbench 중 먼저 뜬 쪽이 spawn**, 단일 인스턴스 lock(포트/PID), 둘 다 없으면 종료 |
| 프로토콜 버전 불일치 | 클라이언트-브로커 호환 깨짐 | `protocol`에 버전 핸드셰이크, semver, zod 검증 실패 시 명확한 에러 |
| 프로세스 증가로 운영 복잡 | 디버깅·배포 난도↑ | 통합 로그 채널, 브로커 상태 진단 명령, 단일 모노레포 빌드 |
| 단일 스트림 재경합 | 여러 클라이언트가 동시에 명령 | 브로커 큐가 유일 직렬점, idle gap 정책 계승, 우선순위(디버그 step > 폴링) 도입 가능 |
| 데스크톱 배포 부담 | 서명/자동업데이트/설치관리자 | Electron 생태계(electron-builder/updater) 활용, 초기엔 내부 배포 |
| 보안(로컬 포트 노출) | 타 프로세스가 제어기 명령 주입 | 127.0.0.1 바인딩 한정 + 부팅 토큰 핸드셰이크, origin 검사 |

---

## 12. 미해결 질문 (착수 전 결정 필요)

1. **모노레포 도구**: npm workspaces로 충분한가, 아니면 pnpm/turborepo? (현 단일 패키지 → workspaces 권장)
2. **브로커 수명**: 항상 떠 있는 데몬(자동 시작) vs 클라이언트가 spawn하는 종속 프로세스? (Phase 2에서 확정)
3. **Workbench ↔ 확장 역할 경계**: 배포 트리거는 어디서? 디버그 시작 UI는? (에디터 맥락이 필요한 건 확장 유지 권장)
4. **시뮬레이터 충실도 범위**: 어느 명령/모션까지 흉내 낼 것인가(Phase 5 스코프).
5. **프레임워크 최종 확정**: Electron으로 시작하되 Tauri 전환 트리거(번들 크기 임계치 등)를 정의할지.

---

## 부록 A — 결합도 제거 체크리스트 (Phase 0 실착수용)

- [ ] `controllerConnection.getControllerConfig` → `ConfigSource` 주입으로 대체 (vscode.workspace 제거)
- [ ] `logTraffic`/`appendLiveLog` → `TrafficSink` 인터페이스로 추상화
- [ ] `setTrafficChannel`/`getTrafficChannel`(vscode.OutputChannel) → sink 구현으로 이동
- [ ] `RuntimeConsole`: net/재연결 상태머신을 순수 `EventStream`으로, vscode.OutputChannel/Disposable은 확장 어댑터로 분리
- [ ] `deployService.deploy`: DiagnosticCollection/OutputChannel 인자를 진행 콜백/이벤트로 치환
- [ ] `debugBridge`: vscode.EventEmitter → 코어 이벤트 + 확장 어댑터
- [ ] 세션 오버라이드(`setSessionControllerOverride`) → 브로커 config API로 이전
- [ ] `controller-core`에 vscode import 0건 확인 (`grep -r "from 'vscode'" packages/controller-core` → 빈 결과)
