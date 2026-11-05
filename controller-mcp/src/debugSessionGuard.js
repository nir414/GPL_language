// 디버그 세션 중 파괴적 도구의 거부 판정 — 순수(2026-11-05 inbox debug-day-feedback §1).
//
// 사건: 한 세션의 디버거가 TCPCLI_0 을 중단점에 세워 둔 사이 다른 세션이 `clear_remote_folder`·`unload_project {}` 를
// 경고 없이 실행했다. 확장 presence 의 `debugSessionActive`(transport.extension.debugSessionActive)가 true 이면
// 파괴적 도구는 `refused:"debug-session-active"` 로 돌려주고, 사용자 동의를 받은 뒤 `confirmDebugSession:true` 로만 진행한다.
// (`confirm` 은 이미 그룹 Compile 위험·clear_remote_folder 삭제 동의에 쓰여 재사용하지 않는다 — 동의 단계가 섞인다.)
// 형식은 `unload-after-group-compile` 거부(unloadRisk.unloadRiskRefusalResult)와 같다: refused·error·sent:false·outcome·recovery.retryWith.

export const DEBUG_SESSION_REFUSAL = 'debug-session-active';

/**
 * @param {{ tool: string, debugSessionActive: unknown, confirmDebugSession?: boolean, action?: string }} a
 * @returns {null | object} 진행해도 되면 null, 거부면 응답 객체(보내지 않음).
 */
export function debugSessionRefusal({ tool, debugSessionActive, confirmDebugSession, action }) {
  if (debugSessionActive !== true || confirmDebugSession === true) return null;
  const what = action ? `${tool}(${action})` : tool;
  return {
    ok: false,
    refused: DEBUG_SESSION_REFUSAL,
    error: DEBUG_SESSION_REFUSAL,
    sent: false,
    outcome: 'not-sent',
    detail: `확장에 디버그 세션이 열려 있다(transport.extension.debugSessionActive) — ${what} 은 중단점에 서 있는 쓰레드와 /GPL 소스를 지워 ` +
      '다른 세션의 디버깅을 끊을 수 있어 보내지 않았다. 사용자에게 디버그 중인 세션이 있는지 알리고 동의를 받은 뒤에만 ' +
      '`confirmDebugSession:true` 로 다시 호출할 것.',
    recovery: { action: 'ASK_USER', retryCurrentCommand: false, retryWith: { confirmDebugSession: true } },
  };
}
