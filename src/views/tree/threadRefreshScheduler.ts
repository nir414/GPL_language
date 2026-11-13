/**
 * 쓰레드 목록 즉시 갱신 예약 — vscode·소켓 무의존 (2026-11-04 「쓰레드 상태가 바로바로 갱신되지 않는다」).
 *
 * 배경: 디버그 밖에서 트리의 쓰레드 상태는 정규 폴링(기본 5 s, 쓰레드가 없으면 15 s)으로만 바뀌었다. Start·Stop 직후의
 * 한 번 갱신은 제어기가 상태를 바꾸기 **전** 응답을 받기 쉬워(Start 직후 아직 Idle 등) 다음 정규 폴까지 최대 5~15 s 동안
 * 낡은 상태가 보였고, 1403 상태 이벤트(`<E>1,N</E>`)도 디버그 세션만 받아 트리는 몰랐다.
 *
 * 이 모듈은 "언제 다시 조회할지"만 정한다:
 *  - request(사유, 지연): 한 번 더 조회. 이미 예약된 것과 겹치면 가장 이른 것 하나로 합친다.
 *  - burst(사유): 상태를 바꾸는 명령 뒤 짧은 간격(THREAD_REFRESH_BURST_MS)으로 몇 번 — 전이가 끝나는 순간을 놓치지 않게.
 *  - 조회 중에 온 요청은 버리지 않고 끝난 뒤 한 번으로 합쳐 다시 돈다. 시작 간격은 minGapMs 이상(이벤트 폭주 방지).
 * 실제 조회(`Show Thread -web`)와 정규 폴링 재설정은 호출자(controllerTreeProvider)의 run 이 한다.
 */

/** 상태 변경 명령 뒤 추가 조회 시점(명령 응답 기준, ms). 전이가 수백 ms~수 초에 끝나는 Start/Stop 을 덮는다. */
export const THREAD_REFRESH_BURST_MS: readonly number[] = [150, 600, 1500, 3000];
/** 연속 조회 시작 사이 최소 간격(ms). */
export const THREAD_REFRESH_MIN_GAP_MS = 250;

export interface ThreadRefreshIo {
    now(): number;
    setTimer(fn: () => void, ms: number): unknown;
    clearTimer(handle: unknown): void;
    /** 조회 1회. 합쳐진 사유들을 받는다(로그용). */
    run(reasons: readonly string[]): Promise<void>;
}

interface Deadline { at: number; reason: string }

export class ThreadRefreshScheduler {
    private deadlines: Deadline[] = [];
    private timer: unknown;
    private timerAt: number | undefined;
    private running = false;
    private lastRunStartedAt = Number.NEGATIVE_INFINITY;
    private generation = 0;

    constructor(private readonly io: ThreadRefreshIo, private readonly minGapMs: number = THREAD_REFRESH_MIN_GAP_MS) {}

    /** 아직 돌지 않은 예약 수(테스트·진단용). */
    get pendingCount(): number { return this.deadlines.length; }
    get isRunning(): boolean { return this.running; }

    request(reason: string, delayMs = 0): void {
        this.add([{ at: this.io.now() + Math.max(0, delayMs), reason }]);
    }

    burst(reason: string, offsetsMs: readonly number[] = THREAD_REFRESH_BURST_MS): void {
        const now = this.io.now();
        this.add(offsetsMs.map(d => ({ at: now + Math.max(0, d), reason })));
    }

    /** 예약을 모두 버린다(연결 해제·디버그 진입). 진행 중인 조회는 끝까지 가되 그 뒤 다시 돌지 않는다. */
    cancel(): void {
        this.deadlines = [];
        this.generation++;
        this.clearTimer();
    }

    private add(items: Deadline[]): void {
        this.deadlines.push(...items);
        this.deadlines.sort((a, b) => a.at - b.at);
        this.arm();
    }

    private clearTimer(): void {
        if (this.timer !== undefined) { this.io.clearTimer(this.timer); }
        this.timer = undefined;
        this.timerAt = undefined;
    }

    private arm(): void {
        if (this.running || this.deadlines.length === 0) { return; }
        const at = Math.max(this.deadlines[0].at, this.lastRunStartedAt + this.minGapMs);
        if (this.timer !== undefined && this.timerAt !== undefined && this.timerAt <= at) { return; }
        this.clearTimer();
        this.timerAt = at;
        this.timer = this.io.setTimer(() => {
            this.timer = undefined;
            this.timerAt = undefined;
            void this.fire();
        }, Math.max(0, at - this.io.now()));
    }

    /** 타이머 콜백. 테스트에서 직접 부를 수 있다. 도래한 예약을 모두 한 번의 조회로 합친다. */
    async fire(): Promise<void> {
        if (this.running) { return; }
        const now = this.io.now();
        const due = this.deadlines.filter(d => d.at <= now);
        if (due.length === 0) { this.arm(); return; }
        this.deadlines = this.deadlines.filter(d => d.at > now);
        const gen = this.generation;
        this.running = true;
        this.lastRunStartedAt = now;
        try {
            await this.io.run([...new Set(due.map(d => d.reason))]);
        } catch {
            // 조회 실패는 다음 정규 폴·유실 판정이 다룬다 — 예약 체인만 이어 간다.
        } finally {
            this.running = false;
            if (gen === this.generation) { this.arm(); }
        }
    }
}
