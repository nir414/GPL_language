/**
 * 확장 호스트 이벤트 루프 정지 감지(vscode 무의존) — "제어기 죽은 판정이 왜 이렇게 느린가" 분석(2026-10-27) 대응.
 *
 * 배경(실측):
 *  - 사후 스냅샷 10건 중 3건(65 s·71 s·22 s)은 판정 규칙이 아니라 **확장 호스트 전체가 멈춘 시간**이 지연의 대부분이었다.
 *    2026-10-26 17:48:06~17:49:17 VS Code renderer.log 가 "Extension host is unresponsive" 를 남긴 71 s 동안 재프로브
 *    타이머도, 1403 재연결 타이머도, 1403 워치독(15 s 주기)도 돌지 않았고, 풀린 시각(17:49:17.676)과 다음 프로브 송신
 *    (17:49:17.677)이 1 ms 차이였다. 확장 호스트는 모든 확장이 함께 쓰는 프로세스라 원인이 이 확장 밖일 수 있다.
 *  - 이 정지는 GPL Traffic 에도 Output 에도 보이지 않아 "판정이 느리다"로만 드러났다 — 관측해 남기는 것이 이 모듈의 일이다.
 *
 * 방법: tickMs 주기 타이머가 예정보다 thresholdMs 이상 늦게 돌면 그만큼 멈춰 있었던 것으로 기록한다(Node
 * perf_hooks.monitorEventLoopDelay 는 히스토그램이라 "언제 몇 초"를 주지 않는다). 판정은 바꾸지 않는다 — 정지 중의
 * 프로브 실패도 그대로 센다. 기록은 유실 로그·사후 스냅샷에서 "판정 지연 중 몇 초가 정지였는지"를 밝히는 데 쓴다.
 */

export interface EventLoopStall {
    /** 멈추기 시작한 것으로 보이는 시각(epoch ms) — 직전 정상 틱 + tickMs. */
    startedAt: number;
    /** 다시 돈 시각(epoch ms). */
    endedAt: number;
    /** 예정보다 늦은 시간(ms) = endedAt - startedAt. */
    durationMs: number;
}

export interface StallTimers {
    setInterval(fn: () => void, ms: number): unknown;
    clearInterval(handle: unknown): void;
}

export interface EventLoopStallMonitorOptions {
    /** 감시 주기(ms). 기본 500. */
    tickMs?: number;
    /** 이만큼 이상 늦으면 정지로 기록(ms). 기본 2000. */
    thresholdMs?: number;
    /** 보관할 최근 정지 수. 기본 50. */
    capacity?: number;
    now?: () => number;
    timers?: StallTimers;
    /** 정지를 기록할 때마다 호출(로그용). 예외는 삼킨다. */
    onStall?: (stall: EventLoopStall) => void;
}

const defaultTimers: StallTimers = {
    setInterval: (fn, ms) => {
        const h = setInterval(fn, ms);
        h.unref?.();
        return h;
    },
    clearInterval: h => clearInterval(h as ReturnType<typeof setInterval>),
};

export class EventLoopStallMonitor {
    private readonly tickMs: number;
    private readonly thresholdMs: number;
    private readonly capacity: number;
    private readonly now: () => number;
    private readonly timers: StallTimers;
    private handle: unknown = null;
    private lastTickAt = 0;
    private readonly stalls: EventLoopStall[] = [];

    constructor(private readonly opts: EventLoopStallMonitorOptions = {}) {
        this.tickMs = Math.max(50, opts.tickMs ?? 500);
        this.thresholdMs = Math.max(this.tickMs, opts.thresholdMs ?? 2000);
        this.capacity = Math.max(1, opts.capacity ?? 50);
        this.now = opts.now ?? Date.now;
        this.timers = opts.timers ?? defaultTimers;
    }

    get running(): boolean { return this.handle !== null; }

    start(): void {
        if (this.handle !== null) { return; }
        this.lastTickAt = this.now();
        this.handle = this.timers.setInterval(() => this.tick(), this.tickMs);
    }

    stop(): void {
        if (this.handle === null) { return; }
        this.timers.clearInterval(this.handle);
        this.handle = null;
    }

    /** 타이머 콜백. 테스트에서는 now 를 넘겨 직접 부른다. 정지를 기록했으면 그 기록을 돌려준다. */
    tick(now: number = this.now()): EventLoopStall | undefined {
        const expectedAt = this.lastTickAt + this.tickMs;
        this.lastTickAt = now;
        const late = now - expectedAt;
        if (late < this.thresholdMs) { return undefined; }
        const stall: EventLoopStall = { startedAt: expectedAt, endedAt: now, durationMs: late };
        this.stalls.push(stall);
        if (this.stalls.length > this.capacity) { this.stalls.splice(0, this.stalls.length - this.capacity); }
        try { this.opts.onStall?.(stall); } catch { /* 로그 실패가 감시를 멈추지 않게 */ }
        return stall;
    }

    /** 최근 정지(오래된 순) 복사본. */
    recent(): EventLoopStall[] {
        return this.stalls.slice();
    }
}

/** [from, to] 구간과 겹치는 정지만(오래된 순). */
export function stallsWithin(stalls: readonly EventLoopStall[], from: number, to: number): EventLoopStall[] {
    return stalls.filter(s => s.endedAt > from && s.startedAt < to);
}

/** [from, to] 구간 안에서 이벤트 루프가 멈춰 있던 시간 합(ms) — 구간 밖으로 나간 부분은 잘라 낸다. */
export function stallOverlapMs(stalls: readonly EventLoopStall[], from: number, to: number): number {
    let total = 0;
    for (const s of stalls) {
        const a = Math.max(from, s.startedAt);
        const b = Math.min(to, s.endedAt);
        if (b > a) { total += b - a; }
    }
    return total;
}

/** 로그용 한 줄: `71.4 s (17:48:06 → 17:49:17)`. 시각 표기는 호출자가 고른다(기본 HH:MM:SS 로컬). */
export function describeStall(stall: EventLoopStall, fmt: (ms: number) => string = formatClock): string {
    return `${(stall.durationMs / 1000).toFixed(1)} s (${fmt(stall.startedAt)} → ${fmt(stall.endedAt)})`;
}

function formatClock(ms: number): string {
    const d = new Date(ms);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
