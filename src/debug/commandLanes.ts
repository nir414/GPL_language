/**
 * 디버그 어댑터의 제어기 명령 차선(lane) 큐 — 순수 로직(vscode 무의존).
 *
 * 왜: 한 번 정지할 때마다 VS Code 는 Locals(지역 변수 수만큼 `Show Variable -eval`)·Watch·펼쳐 둔 Globals 를
 * 전부 다시 조회한다. 종전 어댑터 큐는 단일 FIFO 라 그 조회가 끝나기 전에 누른 Step/Continue 가 **남은 조회 뒤에
 * 줄을 섰고**, 그 뒤 정지 감지용 `Show Thread -web` 도 다시 조회 사이에 끼어 "다음 줄로 넘어가는 데 한참 걸리는"
 * 체감을 만들었다(2026-10-26 사용자 보고). 제어기 1402 는 명령 하나씩만 받으므로 병렬화는 못 하지만
 * **순서는 바꿀 수 있다**.
 *
 * 규칙:
 *  - `control` 차선(Step/Continue/Break·정지 감지 폴·스택 조회)은 항상 `data` 차선(변수·Watch·전역 조회)보다 먼저 나간다.
 *  - `data` 작업은 등록 시점의 세대(generation)를 기억한다. `invalidateData()`(= 실행 재개) 뒤에는 아직 시작하지 않은
 *    data 작업을 **보내지 않고** `staleValue` 로 즉시 끝낸다 — 정지 컨텍스트가 바뀌어 값이 어차피 버려지기 때문이다.
 *  - 작업이 실패(reject)하면 다음 작업 전에 `failureCooldownMs` 를 쉰다(종전 어댑터 큐의 100ms 와 같은 의미).
 *  - 실행 중인 작업은 중단하지 않는다(소켓 응답을 기다리는 중이라 취소할 수 없다).
 *
 * 단위 테스트: src/test/commandLanes.test.ts
 */

export type CommandLane = 'control' | 'data';

export interface LaneTaskContext {
    /** 등록부터 실행 시작까지 기다린 시간(ms). */
    waitedMs: number;
    /** 이 작업이 실행을 시작할 때 그 앞에서 실행된 작업 수(등록 이후). */
    ranAhead: number;
}

export interface LaneEnqueueOptions<T> {
    /** data 차선 전용 — 세대가 바뀌어 보내지 않을 때 돌려줄 값. 생략하면 undefined. */
    staleValue?: T;
}

export interface LaneQueueOptions {
    failureCooldownMs?: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
}

export interface LaneQueueStats {
    controlPending: number;
    dataPending: number;
    running: boolean;
    generation: number;
}

interface LaneTask {
    lane: CommandLane;
    generation: number;
    enqueuedAt: number;
    /** 등록 시점까지 완료된 작업 수 — ranAhead 계산용. */
    completedAtEnqueue: number;
    run: (ctx: LaneTaskContext) => Promise<void>;
    /** data 작업이 세대 불일치로 건너뛰어질 때. */
    skip: () => void;
}

const DEFAULT_FAILURE_COOLDOWN_MS = 100;

export class LaneQueue {
    private readonly control: LaneTask[] = [];
    private readonly data: LaneTask[] = [];
    private running = false;
    private generation = 0;
    private completed = 0;
    private readonly failureCooldownMs: number;
    private readonly sleep: (ms: number) => Promise<void>;
    private readonly now: () => number;

    constructor(options?: LaneQueueOptions) {
        this.failureCooldownMs = Math.max(0, options?.failureCooldownMs ?? DEFAULT_FAILURE_COOLDOWN_MS);
        this.sleep = options?.sleep ?? (ms => new Promise<void>(r => setTimeout(r, ms)));
        this.now = options?.now ?? (() => Date.now());
    }

    /** 작업을 차선에 등록한다. control 은 data 보다 먼저, 같은 차선 안에서는 등록 순서대로 실행된다. */
    enqueue<T>(lane: CommandLane, work: (ctx: LaneTaskContext) => Promise<T>, options?: LaneEnqueueOptions<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const task: LaneTask = {
                lane,
                generation: this.generation,
                enqueuedAt: this.now(),
                completedAtEnqueue: this.completed,
                run: async ctx => {
                    try {
                        resolve(await work(ctx));
                    } catch (err) {
                        reject(err);
                        throw err;
                    }
                },
                skip: () => resolve(options?.staleValue as T),
            };
            (lane === 'control' ? this.control : this.data).push(task);
            void this.pump();
        });
    }

    /**
     * 정지 컨텍스트가 바뀌었다(step/continue 전송). 아직 시작하지 않은 data 작업은 보내지 않고 staleValue 로 끝낸다.
     * 이후 등록되는 data 작업은 새 세대에 속해 정상 실행된다.
     */
    invalidateData(): void {
        this.generation++;
        const stale = this.data.splice(0, this.data.length);
        for (const t of stale) { t.skip(); }
    }

    stats(): LaneQueueStats {
        return { controlPending: this.control.length, dataPending: this.data.length, running: this.running, generation: this.generation };
    }

    private next(): LaneTask | undefined {
        if (this.control.length > 0) { return this.control.shift(); }
        while (this.data.length > 0) {
            const t = this.data.shift()!;
            if (t.generation === this.generation) { return t; }
            t.skip();
        }
        return undefined;
    }

    private async pump(): Promise<void> {
        if (this.running) { return; }
        this.running = true;
        try {
            for (let task = this.next(); task; task = this.next()) {
                const ctx: LaneTaskContext = {
                    waitedMs: Math.max(0, this.now() - task.enqueuedAt),
                    ranAhead: Math.max(0, this.completed - task.completedAtEnqueue),
                };
                let failed = false;
                try {
                    await task.run(ctx);
                } catch {
                    failed = true;
                }
                this.completed++;
                if (failed && this.failureCooldownMs > 0) {
                    await this.sleep(this.failureCooldownMs);
                }
            }
        } finally {
            this.running = false;
            // pump 가 끝나는 사이에 등록된 작업이 있으면 다시 돈다.
            if (this.control.length > 0 || this.data.length > 0) { void this.pump(); }
        }
    }
}
