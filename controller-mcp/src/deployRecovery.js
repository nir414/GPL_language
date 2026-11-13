// 배포 실패 복구 지시 중 업로드 FTP 타임아웃 — 확장 controller/automation/automationRecovery.ts(deployFailureRecovery)와 같은 결론.
// 2026-11-05 inbox: 같은 부팅 4번째 재배포 사이클에서 FTP 제어 소켓 타임아웃 뒤 1402 가 끊겼는데, 응답이 "같은 요청 재시도 가능"이라
// 19 초 뒤 재시도가 나가 채널 교란을 키웠다. 업로드 단계 타임아웃은 재시도 전에 controller_status 로 먼저 관측하게 한다.

/** FTP 타임아웃(`Timeout (control socket)`·`ETIMEDOUT` 등)으로 보이는 메시지인가. */
export function isFtpTimeoutMessage(message) {
  return /\btimeout\b|timed out|ETIMEDOUT/i.test(String(message ?? ''));
}

/** 업로드 단계의 FTP 타임아웃이면 true — 이때만 일반 UPLOAD 복구(같은 요청 재시도)를 대체한다. */
export function isUploadTimeoutFailure(failedPhase, failedStatusMessage) {
  return failedPhase === 'UPLOAD' && isFtpTimeoutMessage(failedStatusMessage);
}

export function uploadTimeoutRecovery() {
  return {
    action: 'CHECK_OPERATION', retryCurrentCommand: false, safeToRepeat: false, retryable: false,
    detail: 'FTP 타임아웃으로 업로드가 중단됐다. **같은 배포를 곧바로 다시 보내지 말 것** — 타임아웃은 명령 콘솔 연결 유실로 이어진 적이 있다(같은 부팅 4번째 재배포 사이클). '
      + 'controller_status 로 명령 콘솔·FTP 상태를 먼저 관측하고, 응답이 안정된 뒤 다시 시도할 것. 재부팅·전원 재투입은 사용자 확인 없이 권하지 말 것.',
  };
}
