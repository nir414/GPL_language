/**
 * 정지 쓰레드의 호출 스택 캐시 — `Show Stack` 결과·프레임 ID 할당·신선도(TTL)·세대(generation) 무효화.
 *
 * 같은 정지 동안 stackTrace/scopes/variables 가 연달아 와도 Show Stack 은 1회만 보내고, step/continue 로 위치가 바뀌면
 * 세대를 올려 진행 중이던 조회 결과가 캐시에 섞이지 않게 한다. 변수 평가 사다리도 이 세대로 "실행 재개됨"을 판정한다.
 *
 * `gplDebugSession.ts`(5,700줄) 에서 2026-10-27 에 분리했다. 세션 상태는 `DebugSessionIo` getter 로만 읽는다.
 */

import { parseThreadDetail, parseStack, StackFrameInfo } from '../../controller/protocol/responseParser';
import type { DebugSessionIo } from './sessionIo';
import type { ThreadInfo } from '../../controller/protocol/responseParser';

const STOPPED_STATES: ReadonlySet<string> = new Set(['Paused', 'Break', 'Error']);
const baseName = (f: string) => f.replace(/\\/g, '/').split('/').pop()!.toLowerCase();

/**
 * 캐시한 스택을 다시 조회하지 않고 써도 되는가(순수). TTL 안이면 그대로 쓰고, TTL 이 지났어도 pending(step/continue)이
 * 없고 마지막 정지 감지 폴(`Show Thread -web`)이 같은 쓰레드를 같은 파일·줄에 정지로 보고 있으면 쓴다(2026-11-04 —
 * 정지 뒤 1.5 s 가 지나 호버·Watch·Locals 를 열 때마다 Show Stack 을 다시 보냈다). 폴 목록에 위치가 없으면 TTL 만 본다.
 */
export function isFrameCacheReusable(input: {
    frames: readonly StackFrameInfo[];
    cachedAt: number;
    now: number;
    ttlMs: number;
    polled: ThreadInfo | undefined;
    pending: boolean;
}): boolean {
    if (input.frames.length === 0) { return false; }
    if (input.now - input.cachedAt < input.ttlMs) { return true; }
    if (input.pending) { return false; }
    const top = input.frames[0];
    const polled = input.polled;
    if (!polled || !STOPPED_STATES.has(polled.state) || !polled.fileLine || !polled.file || !top.file) { return false; }
    return polled.fileLine === top.fileLine && baseName(polled.file) === baseName(top.file);
}

export class FrameCache {
    constructor(private readonly io: DebugSessionIo) {}

    /** 곧 위치가 바뀔 때(step/continue/REPL 명령): 신선도만 무효화 — 프레임 자체는 pending 동안 UI 에 돌려준다. */
    invalidateFreshness(): void {
        this.frameCacheAt.clear();
        this.provisionalTops.clear();
        this.frameCacheGen++;
    }

    /** 정지 컨텍스트 전환: 프레임 ID·캐시 전부 리셋(옛 frameId 가 새 정지로 새지 않게). */
    clearAll(): void {
        this.frameIdToInfo.clear();
        this.frameIdCounter = 0;
        this.cachedFrames.clear();
        this.provisionalTops.clear();
        this.frameCacheGen++;
    }

    /** 한 쓰레드의 정지 값이 바뀌었을 때(자발적 정지 인정) 그 쓰레드만 버린다. */
    dropThread(threadName: string): void {
        this.cachedFrames.delete(threadName);
        this.frameCacheAt.delete(threadName);
        this.provisionalTops.delete(threadName);
        this.frameCacheGen++;
    }

    // 정지 감지 폴(`Show Thread -web`) 한 줄로 만든 맨 위 프레임(2026-11-04). GDE 는 Step 뒤 이 한 줄로 바로 현재 줄을
    // 표시하고 스택은 따로 읽는다(captures/gde_1402.pcapng: Step → 1 ms 뒤 Show Thread -web, Show Stack 없음). 우리도
    // VS Code 가 맨 위 프레임만 물으면(stackTrace levels=1 — supportsDelayedStackTraceLoading) Show Stack 응답을 기다리지
    // 않고 이것으로 답한다. 나머지 프레임 요청은 진행 중인 Show Stack 에 합류한다. 위치가 바뀌는 순간 지운다.
    private readonly provisionalTops = new Map<string, StackFrameInfo>();

    /** 폴 줄에 파일·줄이 있으면 그 쓰레드의 잠정 맨 위 프레임으로 기억한다. */
    noteProvisionalTop(polled: ThreadInfo): void {
        if (!polled.file || !polled.fileLine || polled.fileLine <= 0) { return; }
        this.provisionalTops.set(polled.name, {
            frameIndex: 0,
            project: polled.project,
            process: polled.func || polled.name,
            procLine: polled.procLine ?? 0,
            file: polled.file,
            fileLine: polled.fileLine,
            size: 0,
        });
    }

    /**
     * 맨 위 프레임 하나만 필요할 때 Show Stack 을 기다리지 않고 줄 수 있는 값: 재사용 가능한 캐시가 있으면 그 맨 위,
     * 없으면 잠정 맨 위 프레임(그 경우 전체 조회를 띄워 둔다). 둘 다 없으면 undefined.
     */
    topFrameWithoutWaiting(threadName: string): { frame: StackFrameInfo; provisional: boolean } | undefined {
        const cached = this.cachedFrames.get(threadName);
        const cachedAt = this.frameCacheAt.get(threadName);
        if (cached && cached.length > 0 && cachedAt !== undefined && isFrameCacheReusable({
            frames: cached, cachedAt, now: Date.now(), ttlMs: FrameCache.FRAME_CACHE_TTL_MS,
            polled: this.io.lastThreadList?.find(t => t.name === threadName), pending: this.io.pendingAction !== null,
        })) {
            return { frame: cached[0], provisional: false };
        }
        const top = this.provisionalTops.get(threadName);
        if (!top) { return undefined; }
        void this.getThreadFrames(threadName).catch(() => undefined);
        return { frame: top, provisional: true };
    }

    // Frame ID — globally unique across all threads
    frameIdCounter = 0;

    frameIdToInfo = new Map<number, { threadName: string; frameIndex: number }>();

    // Stack frame cache — pending step/continue 동안 UI에 반환할 직전 프레임 캐시
    cachedFrames = new Map<string, StackFrameInfo[]>();

    // ③ Show Stack 캐시 신선도: 정지 위치별 마지막 조회 시각 + 짧은 TTL.
    //    같은 정지 동안 stackTrace/scopes/variables 연속 요청을 1회 조회로 합친다.
    frameCacheAt = new Map<string, number>();

    // ⑧ 프레임 캐시 세대 — _clearStaleState/_fastPoll에서 bump. 진행 중이던 Show Stack
    //    조회가 무효화 이후 완료되면 결과를 캐시에 기록하지 않는다(stale 재주입 방지).
    frameCacheGen = 0;

    // 정지 중 프레임은 변하지 않고 새 step/continue 시 _fastPoll()이 무효화하므로,
    // TTL을 넉넉히 둬서 정지 직후 stackTrace의 Show Stack 재조회 왕복을 줄인다 (400→1500ms).
    private static readonly FRAME_CACHE_TTL_MS = 1500;

    // ⑧ 동일 쓰레드 프레임 조회의 중복 방지 — 정지 감지 직후 프리페치와 VS Code의
    //    stackTraceRequest가 겹칠 때 같은 Show Stack을 두 번 보내지 않고 합류시킨다.
    private framesInFlight = new Map<string, Promise<StackFrameInfo[]>>();

    allocFrameId(threadName: string, frameIndex: number): number {
        const id = ++this.frameIdCounter;
        this.frameIdToInfo.set(id, { threadName, frameIndex });
        return id;
    }

    /** ⑧ 정지 감지 직후 스택 프레임 선조회로 캐시를 데워 둔다(읽기 전용 Show Stack).
     *  StoppedEvent 직후 오는 stackTraceRequest가 진행 중 조회에 합류해
     *  왕복 1회분의 전환 체감 지연을 줄인다. */
    prefetchFramesAfterStop(threadName: string, polled?: ThreadInfo): void {
        if (polled) { this.noteProvisionalTop(polled); }
        void this.getThreadFrames(threadName).catch(() => undefined);
    }

    async getThreadFrames(threadName: string): Promise<StackFrameInfo[]> {
        // ③ Show Stack 캐시: 같은 정지 동안 stackTrace/scopes/variables가 연달아
        //    요청해도 짧은 TTL 내에는 1회 조회 결과를 재사용한다(_fastPoll에서 무효화).
        const cachedFresh = this.cachedFrames.get(threadName);
        const cachedAt = this.frameCacheAt.get(threadName);
        if (cachedFresh && cachedFresh.length > 0 && cachedAt !== undefined && isFrameCacheReusable({
            frames: cachedFresh,
            cachedAt,
            now: Date.now(),
            ttlMs: FrameCache.FRAME_CACHE_TTL_MS,
            polled: this.io.lastThreadList?.find(t => t.name === threadName),
            pending: this.io.pendingAction !== null,
        })) {
            return cachedFresh;
        }

        const inFlight = this.framesInFlight.get(threadName);
        if (inFlight) { return inFlight; }
        const fetch = this.fetchThreadFramesUncached(threadName);
        this.framesInFlight.set(threadName, fetch);
        try {
            return await fetch;
        } finally {
            this.framesInFlight.delete(threadName);
        }
    }

    /** 로그용 정지 프레임 설명(`GPL.MAIN @ GPL.gpl:73`) — 캐시된 스택만 본다(왕복 없음). 캐시가 없으면 undefined. */
    describeFrameForLog(threadName: string, frameIndex: number): string | undefined {
        const f = this.cachedFrames.get(threadName)?.[frameIndex];
        if (!f) { return undefined; }
        return `${f.process || '?'} @ ${f.file || '?'}:${f.fileLine || 0}`;
    }

    private async fetchThreadFramesUncached(threadName: string): Promise<StackFrameInfo[]> {
        // ⑧ 조회 시작 시점의 캐시 세대 캡처 — 조회 중 새 step/continue로 무효화되면
        //    (특히 Show Stack 0프레임 → Show Thread fallback이 Step 뒤에 큐잉되는 경우)
        //    과도기 위치를 fresh로 재주입하지 않도록 캐시 기록만 건너뛴다.
        const gen = this.frameCacheGen;
        const resp = await this.io.sendCmd(`Show Stack ${threadName}`);
        const frames = resp ? parseStack(resp) : [];
        if (frames.length > 0) {
            if (gen === this.frameCacheGen) {
                this.cachedFrames.set(threadName, frames);
                this.frameCacheAt.set(threadName, Date.now());
            }
            return frames;
        }

        const detailResp = await this.io.sendCmd(`Show Thread ${threadName}`);
        const detail = detailResp ? parseThreadDetail(detailResp) : null;
        if (detail?.file && detail.fileLine > 0) {
            this.io.log(`Show Stack ${threadName} → 0 frames, Show Thread fallback 사용 (${detail.file}:${detail.fileLine})`);
            const fallback: StackFrameInfo[] = [{
                frameIndex: 0,
                project: detail.project,
                process: detail.process || threadName,
                procLine: detail.procLine,
                file: detail.file,
                fileLine: detail.fileLine,
                size: 0,
            }];
            if (gen === this.frameCacheGen) {
                this.cachedFrames.set(threadName, fallback);
                this.frameCacheAt.set(threadName, Date.now());
            }
            return fallback;
        }

        return [];
    }
}
