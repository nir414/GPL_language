# AI 인계 자료 — GPL Language Support 확장 작업 핸드오프

- 최종 갱신: 2026-06-30
- 대상 저장소: `C:\Users\Doyun\Documents\GitHub\GPL_language` (VS Code 확장 `nir414.gpl-language-support`)
- 현재 package 버전: **0.6.17**
- 테스트 대상 프로젝트: `C:\SVN\pa\trunk\develop\07. Others\37. 핵산 Oligo 합성과제\시뮬레이션\projects\MergeCode` (65 파일)
- 제어기: G2400C, GPL 4.2K5, `192.168.0.1` (명령 1402 / 런타임 콘솔 1403)

---

## 0. 반복 실수 방지 — 하드 규칙 (다음 작업자 필독)

세션이 넘어가며 같은 실수가 반복됐다. 아래는 반드시 지킨다. (상세: `.github/instructions/gpl-ai-controller-debugging.instructions.md`)

1. **로그 파일을 실시간 상태/통신 채널로 쓰지 않는다.** `Compile.log`, `Robot.log` 등은 사후 기록용이다. 현재 컴파일/실행/연결 상태는 오직 1402 명령의 **live 응답**(`<STATUS>`/에러 라인)과 1403 스트림으로만 판단한다.
2. **작업 성공/실패는 그 명령 자신의 `<STATUS>`로만 판정한다.** 응답을 종결자 `</STATUS>`까지 끝까지 읽는다. `Show Thread`가 응답한다거나 `pass 1/2/3` 로그가 보인다는 식의 **간접 신호로 성공을 추정 금지**.
3. **단정 전에 live 데이터/소스를 확인한다.** "Build Only인지 F5인지"는 채널/세션(`[GPL Debug]` 접두어, 디버그 툴바)으로 구분. attach 시작 조건 등 동작은 추측 전에 소스를 읽는다.
4. **환경 주의 (중요):** 이 작업 환경의 샌드박스는 **방금 수정한 파일을 잘린(truncated) 상태로 읽어** `tsc`가 가짜 문법 오류(`Invalid character`, `')' expected` 등 파일 끝부분)를 낸다. **이는 코드 오류가 아니다.** 검증은 반드시 사용자 로컬에서 `npm run compile`로 한다. 호스트 파일은 정상이다.

---

## 1. 이번 세션(2026-06-30)에 완료한 변경

모두 working tree 반영됨(미커밋 가정). 적용하려면 로컬에서 `npm run compile` → `npm run package` → VSIX 재설치.

### A. 컴파일 STATUS 조기 완료 / 거짓 성공 제거 (어제 핸드오프의 결정 B·C 구현)

- `src/controller/controllerConnection.ts`: `SendCommandOptions`에 **`waitForStatusClose`** 옵션 추가. true면 idle 기반 조기 완료를 끄고 종결자 `</STATUS>`(또는 소켓 종료/하드 타임아웃)까지 수신.
- `src/controller/deployService.ts` `tryCompile`: `Compile`을 `waitForStatusClose: true` + `timeoutMs: max(cfg.timeoutMs, 60000)`로 호출. **STATUS 누락을 더 이상 성공으로 간주하지 않음.** `Show Thread`로 성공 처리하던 보강 판정 블록 **제거**. 이제 성공/실패는 STATUS와 `parseCompileErrors` 결과로만 판정.
- 결과: `-742`가 정확히 실패로 보고되고, 에러 라인(`file:line:(code): *msg*`)이 Problems에 표시됨. (이전엔 거짓 성공으로 가려졌음 — 어제 핸드오프 §4 리스크가 실제로 발생했던 것)
- 미사용이 된 `isTransientConnectionFailure`는 제거함.

### B. F5(Attach 전 배포) 컴파일 에러가 Problems에 유지 + 점프

- `src/debug/gplDebugSession.ts`: 디버그 배포 진단을 세션 인스턴스 필드(`_deployDiagnostics`)에서 **모듈 공용 컬렉션**(`getDebugDeployDiagnostics`, name `gpl-debug-deploy`)으로 변경.
- `disconnectRequest`에서 진단을 **clear 하지 않도록** 변경(기존 `this._deployDiagnostics?.clear()`가 세션 종료 시 Problems 항목을 즉시 지워 "코드로 점프" 기능이 안 보였던 원인). 다음 배포 시작 시 `deploy()`가 clear로 갱신.
- 실패 시 첫 에러로 점프 + Problems 패널 표시 추가(`gpl.deploy.jumpToFirstError`, 수동 Deploy 경로와 동일 UX).

### C. 저장 시 자동 컴파일 — 저장한 파일만 업로드 (효율 개선)

- `src/controller/ftpClient.ts` `uploadProject`: `onlyFiles` 옵션(지정 파일만, 크기비교 없이 강제 업로드).
- `src/controller/deployService.ts`: `DeployOptions.changedFiles` 추가 → `onlyFiles`로 전달.
- `src/extension.ts` `runDeploy`/autoOnSave: 저장된 파일이 속한 프로젝트를 해석해 그 파일만 업로드(`overrideProjectDir`, `changedFiles`). 전체 65개 스캔/SIZE 왕복 → 1파일 업로드로 축소.
- 주의: 이 최적화는 **autoOnSave 경로에만** 적용. F5/Build Only는 여전히 `skipUnchanged`(크기 비교) 또는 전체 업로드. F5/Build의 차등 업로드는 아래 §3 미해결.

### D. 정의 찾기(Go to Definition) — Property 인덱싱 버그

- `src/gplParser.ts`: Property 정규식이 `ReadOnly`/`WriteOnly` 수식어를 빠뜨려 `Public ReadOnly Property ...`를 인덱싱 못 했음. Sub/Function처럼 수식어 임의 순서 허용으로 수정. 이제 ReadOnly/WriteOnly 속성도 F12 동작.

---

## 2. 진행 중 / 코드 쪽 미결 (사용자 결정 대기)

- **`ProtocolModule.gpl` 478·480의 `-760 Invalid assignment`**: `isOrgCompleted`는 `RobotModule.gpl:828`에 **`Public ReadOnly Property ... As Boolean`**(읽기 전용)으로 정의됨. 거기에 값을 대입해서 나는 에러. 해결책(택1, 사용자 결정 대기): setter 메서드 추가 / `ReadOnly` 제거 후 `Set` 접근자 추가 / backing 필드 직접 대입.
- (참고) GDE 기준 원래 4개 에러(477 -730, 478 -760, 479 -748, 480 -760)였는데 477/479는 사용자가 정리한 듯, 현재 478/480만 남음.

## 3. 다음에 할 일 (체크리스트)

- [ ] 사용자 로컬에서 `npm run compile` 통과 확인 후 `npm run package` → 재설치(이번 세션 변경 적용).
- [ ] §2 `isOrgCompleted` 대입 방식 확정 후 코드 수정 → MergeCode 재컴파일로 `-742` 해소 확인.
- [ ] F5/Build Only 경로도 **로컬 매니페스트(파일별 mtime/크기 또는 해시) 기반 차등 업로드** 도입 검토(현재 SIZE 왕복 N회 + 크기충돌 누락 위험). 제어기 FTP의 `MDTM` 지원 여부는 환경 확인 필요 → 안전하게 로컬 mtime/해시 기반 권장.
- [ ] 정의 찾기: 이름 기반 조회(`definitionProvider.findDefinition(word)`)로 ReadOnly 속성은 잡히지만, 클래스 멤버 스코프 해석(`obj.member`를 obj의 클래스 한정으로) 정확도는 추후 보강 여지.
- [ ] 변경분 커밋/배포 및 회귀 확인.

## 4. 핵심 파일

```
src/controller/controllerConnection.ts   # sendCommandDetailed, waitForStatusClose
src/controller/deployService.ts          # deploy(), tryCompile, changedFiles/onlyFiles
src/controller/ftpClient.ts              # uploadProject onlyFiles
src/controller/responseParser.ts         # parseStatus, parseCompileErrors
src/debug/gplDebugSession.ts             # attachRequest, _runDeployBeforeAttach, getDebugDeployDiagnostics
src/extension.ts                         # runDeploy, autoOnSave
src/gplParser.ts                         # Property/Sub/Function 파싱
.github/instructions/gpl-ai-controller-debugging.instructions.md  # 하드 규칙
```

## 5. 참고 — 정상 컴파일 응답 형식 (GDE, verbatim, 2026-06-30)

다음처럼 3패스 + 에러 라인 + 최종 Status까지 한 연결로 스트리밍된다. 확장도 `</STATUS>`까지 받아 이 형식을 파싱해야 한다.

```
Compile Project: MergeCode
06-30-2026 14:13:14: project MergeCode, begin compiler pass 1
06-30-2026 14:13:14: project MergeCode, begin compiler pass 2
06-30-2026 14:13:15: project MergeCode, begin compiler pass 3
ProtocolModule.gpl:477:(-730): *Invalid symbol type*
ProtocolModule.gpl:478:(-760): *Invalid assignment*
ProtocolModule.gpl:480:(-760): *Invalid assignment*
ProtocolModule.gpl:479:(-748): *No matching control structure*
ProtocolModule.gpl:2934:(-742): *Compilation errors*: 4
Status: -742:*Compilation errors*
```

1402 와이어 형식은 위 내용이 `<DATA>...</DATA>` + `<STATUS>-742,"*Compilation errors*"</STATUS>`로 종결된다. `parseStatus`는 `<STATUS>`, `parseCompileErrors`는 `file:line:(code): *msg*`를 잡고 `-742` 집계줄은 제외한다.

## 6. STATUS 코드 메모

- `-9999` — No STATUS found(미수신 센티넬, `responseParser.ts`). **성공으로 간주 금지.**
- `0,"Success"` — 정상.
- `-742` — `*Compilation errors*`. **명확한 컴파일 실패.** 일시 상태 아님. `Start`가 -742면 그 프로젝트는 실행 불가.
- `-746`/`-752` — 컴파일/로드 일시 상태 가능(재시도 대상).
- `-745`(already loaded), `-508`/`-743`(missing/invalid) — Unload/Load 재시도 분기.
