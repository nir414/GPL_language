/**
 * 스레드 단일 실행 잠금 판정 — 순수 로직(vscode 무의존).
 *
 * 왜: GPL 제어기의 실행 명령은 원래 스레드 단위(`Continue <이름>` / `Step <이름> -over`)인데,
 * 어느 스레드에 나가는지는 VS Code 의 포커스 스레드가 결정한다. 다중 스레드 프로젝트에서는
 * 내가 보는 스레드가 아닌 쪽이 브레이크포인트에 걸리면 StoppedEvent 로 포커스가 그쪽으로 옮겨가고,
 * 그 상태에서 F10/F5 를 누르면 **의도하지 않은 스레드가 움직인다**(모션 영향 가능).
 * 잠금이 걸려 있으면 어댑터가 실행 명령의 대상을 잠근 스레드로 되돌리고, 다른 스레드의 정지는
 * 포커스를 훔치지 않게 한다(StoppedEvent.preserveFocusHint).
 *
 * DAP 대응: `supportsSingleThreadExecutionRequests` + `ContinueArguments.singleThread`.
 * 단, VS Code 1.135 본체 번들에는 `supportsSingleThreadExecutionRequests`/`singleThread` 문자열이
 * 존재하지 않는다(2026-08-28 확인) — 즉 VS Code 는 아직 이 인자를 보내지 않으므로, 실제 UI 는
 * 확장 쪽 명령·CALL STACK 메뉴·상태바가 제공하고 이 모듈이 어댑터 안에서 대상을 확정한다.
 * 인자가 오는 클라이언트에서는 `singleThread` 를 그대로 존중한다.
 *
 * 안전 원칙: 이 판정은 **실행 대상을 좁히기만** 한다. 잠금 때문에 추가로 재개되는 스레드는 없다
 * (docs/ai-handoff.md §0 하드 규칙 6 — 모션 영향 확대 금지).
 *
 * 단위 테스트: src/test/threadLock.test.ts
 */

/** 실행(Continue/Step) 요청의 대상 스레드 판정 결과. */
export interface ThreadLockDecision {
    /** 실제로 명령을 보낼 스레드 id */
    targetThreadId: number;
    /** 요청 대상과 다른 스레드로 되돌렸는가 */
    redirected: boolean;
    /** 잠긴 스레드 이름(잠금 없으면 undefined) */
    lockedName?: string;
    /** 잠긴 이름이 현재 스레드 목록에 없어 잠금이 무효가 된 경우 — 호출측이 잠금을 해제한다 */
    staleLock: boolean;
}

export interface ThreadLockInput {
    /** 잠긴 스레드 이름. undefined/빈 문자열 = 잠금 없음 */
    lockedName: string | undefined;
    /** 이번 요청이 지정한 스레드 id */
    requestedThreadId: number;
    /** 스레드 이름 → DAP threadId */
    threadNameToId: ReadonlyMap<string, number>;
}

/**
 * 실행 명령을 보낼 스레드를 확정한다.
 *
 * - 잠금 없음 → 요청 그대로.
 * - 잠긴 이름이 목록에 없음(종료된 스레드) → 요청 그대로 + staleLock=true.
 * - 잠긴 스레드가 요청 대상과 같음 → 요청 그대로.
 * - 다름 → 잠긴 스레드로 되돌린다(redirected=true).
 */
export function resolveExecutionThread(input: ThreadLockInput): ThreadLockDecision {
    const { lockedName, requestedThreadId, threadNameToId } = input;

    if (!lockedName) {
        return { targetThreadId: requestedThreadId, redirected: false, staleLock: false };
    }

    const lockedId = threadNameToId.get(lockedName);
    if (lockedId === undefined) {
        return { targetThreadId: requestedThreadId, redirected: false, lockedName, staleLock: true };
    }
    if (lockedId === requestedThreadId) {
        return { targetThreadId: requestedThreadId, redirected: false, lockedName, staleLock: false };
    }
    return { targetThreadId: lockedId, redirected: true, lockedName, staleLock: false };
}

/**
 * 다른 스레드의 정지(StoppedEvent)가 포커스를 훔치지 않게 할지 판정한다.
 * 잠금이 걸려 있고 정지한 스레드가 잠긴 스레드가 아닐 때만 true.
 * (잠긴 스레드 자신의 정지는 사용자가 보고 있어야 하므로 포커스를 준다.)
 */
export function shouldPreserveFocus(lockedName: string | undefined, stoppedThreadName: string | undefined): boolean {
    if (!lockedName || !stoppedThreadName) { return false; }
    return lockedName !== stoppedThreadName;
}

/**
 * DAP `singleThread` 인자를 해석한다. 어댑터의 실행 명령은 항상 스레드 단위이므로
 * true/undefined 는 그대로 단일 스레드 실행이고, 명시적 false(=모든 스레드 재개 요청)만
 * 구분해 호출측이 로그로 알린다 — 추가 스레드를 자동 재개하지는 않는다(하드 규칙 6).
 */
export function isAllThreadsResumeRequest(singleThread: boolean | undefined): boolean {
    return singleThread === false;
}
