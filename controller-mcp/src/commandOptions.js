/** Compile 및 `Start -compile`의 공통 응답 대기 규칙. */
export function compilerCommandOptions(configuredTimeoutMs) {
  return {
    timeoutMs: Math.max(Number(configuredTimeoutMs) || 0, 60_000),
    // compiler pass 사이의 idle 구간에서 조기 완료하지 않고 명령 자신의 종결 STATUS까지 읽는다.
    waitForStatusClose: true,
  };
}

/** 명령 자신의 종결 STATUS가 없으면 성공/실패가 아니라 결과 미확정이다. */
export function controllerResponseOutcome(status) {
  return status?.complete === true ? 'completed' : 'unknown';
}
