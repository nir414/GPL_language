/**
 * 정지 감지 폴 일정 — 순수 함수(vscode 무의존).
 *
 * 배경: step/continue 뒤 fast poll 체인(30/120/250/500/1000ms)이 끝나도 정지가 확인되지 않으면 종전에는 일반 인터벌
 * 폴로 돌아갔는데, GitHub #22 이후 1403 런타임 콘솔이 "살아 있으면" 그 간격이 사용자 설정(기본 5 s)이다.
 * 1403 의 `<E>N,N</E>` 상태 이벤트가 그 정지를 알려 주지 않으면(형식 미확정 — ai-handoff §1-L 남은 일) Move 처럼
 * 2 초 넘게 걸리는 한 줄을 Step 한 뒤 다음 줄 표시까지 최대 5 초가 걸렸다. 사용자가 **직접 기다리는 액션이 pending 인
 * 동안**만은 짧은 백업 폴을 유지한다. 1403 트리거는 그대로 주 신호이고 이 일정은 그 유실을 메우는 보험이다.
 *
 * 규칙:
 *  - step / pause / entry: 끝이 정해진 액션 — 정지가 확인될 때까지 `backupPollMs` 간격으로 계속 본다.
 *  - continue: 자유 실행은 몇 분이고 이어질 수 있어 1Hz 폴을 무한정 두지 않는다. 전송 후 `continueFastWindowMs`
 *    동안만 `backupPollMs` 로 보고, 그 뒤는 null(일반 인터벌 정책 — 1403 부재 시 백업 폴, 정상 시 사용자 간격)로 넘긴다.
 *  - pending 이 없으면 null.
 *
 * 단위 테스트: src/test/pollSchedule.test.ts
 */

export type PendingPollAction = 'step' | 'continue' | 'pause' | 'entry' | null;

export interface PendingPollInput {
    pendingAction: PendingPollAction;
    /** 액션 명령을 보낸 시각(ms). */
    pendingSinceMs: number;
    nowMs: number;
    /** `gpl.debug.runningBackupPollMs`(하한 250). */
    backupPollMs: number;
    /** continue 가 짧은 백업 폴을 유지하는 창(ms). */
    continueFastWindowMs: number;
}

export const DEFAULT_CONTINUE_FAST_WINDOW_MS = 20_000;

/**
 * fast poll 체인이 끝난 뒤 다음 폴까지의 지연(ms). null 이면 pending 전용 폴을 끝내고 일반 인터벌 정책으로 돌아간다.
 */
export function pendingPollDelayMs(input: PendingPollInput): number | null {
    const backup = Math.max(1, Math.floor(input.backupPollMs));
    switch (input.pendingAction) {
        case 'step':
        case 'pause':
        case 'entry':
            return backup;
        case 'continue': {
            const elapsed = input.nowMs - input.pendingSinceMs;
            return elapsed < input.continueFastWindowMs ? backup : null;
        }
        default:
            return null;
    }
}

/** 정지 감지 출처 — 타이밍 로그용. */
export type StopPollSource = 'fast' | 'pending' | '1403' | 'interval' | 'retry' | 'trigger' | 'manual';

export interface ResumeTiming {
    kind: string;
    threadName: string;
    requestedAt: number;
    /** 명령이 어댑터 큐에서 기다린 시간(ms). */
    queueWaitMs?: number;
    /** 명령 전송부터 `</STATUS>` 까지(ms). */
    commandMs?: number;
    /** 명령이 끝난 시각. */
    commandDoneAt?: number;
    /** 재개 뒤 보낸 정지 감지 폴 수. */
    polls: number;
}

/**
 * 정지 감지 시점에 Debug Console 에 남길 한 줄 요약.
 * 예: `⏱ Step 총 92ms — 명령 14ms(큐 대기 0ms) · 정지 감지 +78ms(1403 트리거, 폴 2회)`
 */
export function formatResumeTiming(t: ResumeTiming, detectedAt: number, source: StopPollSource): string {
    const total = Math.max(0, detectedAt - t.requestedAt);
    const cmd = t.commandMs !== undefined ? `${t.commandMs}ms` : '?';
    const wait = t.queueWaitMs !== undefined ? `(큐 대기 ${t.queueWaitMs}ms)` : '';
    const afterCmd = t.commandDoneAt !== undefined ? Math.max(0, detectedAt - t.commandDoneAt) : total;
    const sourceLabel: Record<StopPollSource, string> = {
        'fast': 'fast poll',
        'pending': '대기 백업 폴',
        '1403': '1403 트리거',
        'interval': '인터벌 폴',
        'retry': '재폴',
        'trigger': '1403 트리거(예약)',
        'manual': '직접 폴',
    };
    return `⏱ ${t.kind} 총 ${total}ms — 명령 ${cmd}${wait} · 정지 감지 +${afterCmd}ms(${sourceLabel[source]}, 폴 ${t.polls}회)`;
}
