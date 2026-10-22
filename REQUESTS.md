# 요청 수신함 (외부 사용 프로젝트 → GPL_language)

이 저장소 루트에서 바로 보이는 요청 목록이다. 확장·MCP 를 쓰는 다른 프로젝트 세션이 증상·개선 요청을 여기에 항목으로 덧붙인다.
처리한 항목은 처리 결과(버전·커밋)를 적고 `## 처리 완료` 로 옮긴다. (2026-10-21 Sample Prep 세션이 사용자 지시로 만들었다.)

## 처리 결과 요약 (2026-10-22, 0.14.0)

원본: `C:\Users\Doyun\Downloads\GPL_language_inbox`. 기존 미커밋 변경을 보존하고 아래 항목을 코드·테스트로 대조했습니다. 설치와 제어기 실기 검증은 하지 않았습니다.

| 보고 | 처리 | 남은 범위 |
| --- | --- | --- |
| deploy-452-flash-fallback v2 | 경로 폴백 차단·FTP 오류 안내 기존 반영 확인, 메모리 가드 추가 | TCP accept/overflow 기반 health 판정, 저메모리 Unload 상세 정책 |
| line-length-lint v1 | 수치 한계 미확정으로 보류 유지 | 292자 성공 보고와 모순되는 250/255 기본값은 넣지 않음 |
| quickcompile-bridge-stall v3 | STATUS 대기·모달 제거·경로 해석·정체 표시·작업 결과 복구 기존 반영 확인 | COM_Probe 폴더 소실은 원인 미확정, FTP 삭제 trace 필요 |
| bridge-blocked-by-console-wait v1 | 수신 버퍼 대기를 명령 처리에서 분리, 응답 독립성 회귀 테스트 | 새 VSIX에서 여러 세션 동시 사용 확인 |
| clear-gpl-folder-by-ai v1 | clear_remote_folder와 구조화된 취소/삭제 결과 기존 반영 확인, 메모리 가드 추가 | 옛 라이브러리 구조 자동 판정은 프로젝트별 근거 필요 |
| controller-offline-guard v1 | 설계 대기 유지 | 명시적 offline의 다중 창 공유 범위와 FTP·런타임 콘솔·MCP 직접 경로를 일관되게 막는 구현 필요. 미연결만으로 offline이라 단정하지 않음 |
| gpl-language-facts v1 | 잘못된 Catch 처방 제거, 기본 경고 해제/선택 Information, Continue 결과 주의·문서 보강 | 진입점 Catch 정적 분석, 사람 Continue 사전 확인, Error/Idle 제거까지 정지 의미 확장은 미구현 |
| low-memory-guard v2 | Compile/Start·배포 전 Free 검사, 콜론 Stop skip·오류 안내, 후보 개수 요약, 크기 집계 범위·라이브러리 문구 명시 | 예상 업로드 후 Free·재귀 크기·UI 위험 감수 override·최근 Compile 후 Unload timeout은 미구현 |

## 기존 요청 상세

### 2026-10-21 Sample Prep — /GPL 폴더 비우기를 사용자 동의 후 AI 가 MCP 도구로 실행할 수 있게

출처 세션: Sample Prep 34-sample-prep-22. 확장 0.9.17(pid 18408), MCP 서버 0.9.18(6b93d4d), 제어기 192.168.0.1.
배경: 사용자가 2026-10-21 에 규칙을 바꿨다 — "/GPL 폴더를 비우는 일은 AI 가 사용자 동의를 구하고, 동의하면 AI 가 진행해도 된다".
지금은 MCP 지침·`list_remote_projects` 힌트가 "삭제는 사용자가 확장 트리의 「/GPL 비우기」로 한다"로 못 박혀 있다.

**① 무엇을 했나**
1. 08:27Z `controller_status(detail)` → 여유 메모리 2.48 MB, 스레드 0. `list_remote_projects` → /GPL 에 COM_Probe·EM2RS_Probe·Lib(옛 `Lib_*` 구조) 3개.
2. 사용자 동의(AskUserQuestion) 후 08:29Z `extension_command(command="gpl.controller.ftpClearFolder", timeoutMs=120000)` — 인자 없음.

**② 응답·관측**
- 응답: `ok:true`, `ms:10665`, 끝. 삭제 목록·삭제 개수·취소 여부가 없다.
- 확장 소스(`out/activation/ftpCommands.js`)상 이 명령은 지울 목록을 담은 **모달 확인**(「모두 삭제」)을 띄운다. 이번엔 10.7 s 뒤 반환됐고 사후 `list_remote_projects` 는 `projectCount:0`, 여유 메모리 3.37 MB 로 실제 삭제를 확인했다.
  하지만 응답만 보면 "모달 취소"와 "삭제 완료"를 구분할 수 없다(취소 경로는 코드상 `return` 이라 `ok:true` 일 것으로 추정).
- 모달이 떠 있는 동안 브리지 소비가 막히는지는 관측하지 못했다(10 초 안에 닫힘). 10-20 의 모달 정지 보고와 같은 패턴이므로 주의.

**③ 요청**
1. **MCP 도구 `clear_remote_folder`**(이름 제안) — `root` 기본 `/GPL`, 안전 조건은 확장 `ftpClearFolder` 와 동일(배포 잠금·스레드 정지 게이트).
   호출 전 `list_remote_projects` 로 대상을 보여 주고, 사용자 동의는 AI 가 받아 `confirm:true` 로 넘기는 구조. `/flash/...` 는 지금처럼 `AI_BLOCKED` 유지(되돌릴 수 없음). 모달을 거치지 않으니 브리지 정지 위험도 없다.
2. 모달을 유지하는 현행 `extension_command("gpl.controller.ftpClearFolder")` 는 결과에 `{targets, deleted, failed, cancelled}` 를 실어 줄 것.
3. 지침 문구 갱신: MCP instructions·`list_remote_projects` 힌트의 "삭제는 사용자가 한다"를 "사용자 동의 후 AI 가 `clear_remote_folder` 로 가능(flash 제외)"로.
4. (선택) Compile/배포 전 가드: 여유 메모리가 임계(예: 3 MB) 미만이거나 `/GPL` 에 같은 이름 공용 라이브러리의 옛 구조(`Lib_Core` → `Core` 개편으로 생기는 중복)가 남아 있으면 경고.

잘 된 점: `list_remote_projects` 의 `lastCompiledFrom`(출처 폴더·시각)이 옛 `Lib` 가 어제 구조임을 판정하는 데 바로 쓸모 있었다.

원본(상세): `C:\Users\Doyun\Downloads\GPL_language_inbox\2026-10-21_SamplePrep_clear-gpl-folder-by-ai_v1.md`

## 처리 완료

0.14.0 반영 내용과 보류 사유는 위 표 및 `docs/ai-handoff.md` §1-FG를 참조합니다.
