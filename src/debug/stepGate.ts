/**
 * Step/Continue 게이트 판정 — 순수 로직(vscode 무의존). GitHub #28.
 *
 * 왜: 2026-08-25 16:23 실측 — F12 홀드(키 자동 반복)로 Step 이 22.5초 동안 325건(중앙값 31ms 간격)
 * 제어기에 송신되어 제어기가 다운됐다. 디버그 어댑터의 `_userActionInFlight` 는 명령 송신 중(6~12ms)에만
 * true 라 키 반복을 막지 못했다. GDE 는 정지 확인 전에는 Step 버튼이 비활성화된다 — 같은 규칙을
 * 어댑터가 강제한다.
 *
 * 규칙(호출측 gplDebugSession 이 게이트되면 제어기에 명령을 보내지 않고 응답만 success 로 돌려준다):
 * 1. pendingAction 이 'entry'(stopOnEntry Start 의 첫 정지 대기) 이면 모든 step/continue 를 게이트.
 * 2. pendingAction 이 'step' | 'continue' 이고 pendingThreadId 가 요청 쓰레드와 같으면 게이트
 *    (다른 쓰레드에 대한 요청은 허용). 'pause' 대기 중인 요청은 게이트하지 않는다.
 * 3. 최소 간격: minIntervalMs > 0 이고 마지막 재개(lastResumeAt) 후 경과가 그 미만이면 게이트.
 *    minIntervalMs 0 = 간격 제한 없음, lastResumeAt 0 = 아직 재개한 적 없음(간격 판정 생략).
 *
 * 단위 테스트: src/test/stepGate.test.ts
 */

export type StepGatePendingAction = 'step' | 'pause' | 'entry' | 'continue' | null;

/** 게이트 사유. null 이면 허용. */
export type StepGateReason = 'pending-entry' | 'pending-same-thread' | 'min-interval';

export interface StepGateInput {
    /** 어댑터가 정지 확인을 기다리는 직전 사용자 액션 */
    pendingAction: StepGatePendingAction;
    /** pendingAction 이 step/continue/pause 일 때 그 대상 쓰레드 id */
    pendingThreadId: number | undefined;
    /** 이번 step/continue 요청의 대상 쓰레드 id */
    requestThreadId: number;
    /** 마지막으로 Step/Continue 명령을 보낸 시각(ms). 0 = 없음 */
    lastResumeAt: number;
    /** 현재 시각(ms) */
    now: number;
    /** 최소 간격(ms). 0 이하 = 간격 제한 없음 */
    minIntervalMs: number;
}

/**
 * step/continue 요청을 무시해야 하면 사유를, 허용하면 null 을 돌려준다.
 * pending 판정이 간격 판정보다 우선한다(로그 문구가 원인을 정확히 가리키도록).
 */
export function shouldGateStepRequest(input: StepGateInput): StepGateReason | null {
    const { pendingAction, pendingThreadId, requestThreadId, lastResumeAt, now, minIntervalMs } = input;

    if (pendingAction === 'entry') {
        return 'pending-entry';
    }
    if ((pendingAction === 'step' || pendingAction === 'continue') && pendingThreadId === requestThreadId) {
        return 'pending-same-thread';
    }
    if (minIntervalMs > 0 && lastResumeAt > 0 && now - lastResumeAt < minIntervalMs) {
        return 'min-interval';
    }
    return null;
}
