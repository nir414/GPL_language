/**
 * 정지 감지 폴(Show Thread)의 일정 — 인터벌 백업 폴·step/continue 직후 fast poll 점감 체인·pending 백업 폴·1403 트리거 코얼레싱.
 *
 * 폴 자체(상태 전이 판정)는 세션의 `_pollThreadStates` 가 하고, 여기는 "언제 다시 볼지"만 정한다. 타이머 세대 토큰으로
 * 이전 체인을 무효화하며, 1403 이 정상이면 Running 중 백업 폴을 사용자 간격으로 완화한다(GitHub #22). 간격 계산은 pollSchedule.ts(순수).
 *
 * `gplDebugSession.ts`(5,700줄) 에서 2026-10-27 에 분리했다. 세션 상태는 `DebugSessionIo` getter 로만 읽는다.
 */

import { parseThreadList } from '../../controller/protocol/responseParser';
import { getRuntimeConsoleHealth } from '../../controller/debugging/debugBridge';
import { pendingPollDelayMs, DEFAULT_CONTINUE_FAST_WINDOW_MS, StopPollSource } from './pollSchedule';
import type { FrameCache } from '../session/frameCache';
import type { PendingPollAction } from './pollSchedule';

export interface PollHost {
    readonly isConnected: boolean;
    /** 폴이 진행 중이면 새 폴을 시작하지 않는다(세션이 _pollThreadStates 안에서 세운다). */
    readonly pollInFlight: boolean;
    readonly lastPollCompletedAt: number;
    /** 마지막 Show Thread 목록(Running 쓰레드 유무 → 백업 폴 간격). */
    readonly lastThreadList: ReturnType<typeof parseThreadList> | null;
    /** 변수·Watch 조회가 차선에 남아 있는가 — 정지 중 인터벌 폴은 그동안 한 주기 쉰다(조회 사이에 끼지 않게). */
    readonly dataQueryPending?: boolean;
    readonly pendingAction: PendingPollAction;
    log(message: string): void;
    pollThreadStates(force: boolean, source: StopPollSource): Promise<void>;
}

export class PollDriver {
    constructor(private readonly host: PollHost, private readonly frames: FrameCache) {}

    // State polling
    private pollTimer: ReturnType<typeof setTimeout> | undefined;

    // 인터벌 폴 체인 세대 토큰 — _stopPolling/_startPolling 시 이전 체인 무효화.
    private pollTimerGen = 0;

    private fastPollTimer: ReturnType<typeof setTimeout> | undefined;

    // fast poll 체인 세대 토큰 — _stopPolling/새 _fastPoll 시 이전 체인을 무효화.
    private fastPollGen = 0;

    // ⑦ 1403 트리거(비-pending) 코얼레싱: 디바운스 창 안에 도착한 트리거를 버리지 않고
    //    창 만료 직후 1회 폴로 합쳐 예약한다 (자유 실행 BP 히트 감지 유실 방지).
    private triggerPollPending = false;

    // 폴 체인 예외는 첫 1회만 Debug Console에 알리고(스팸 방지) 이후는 조용히 재스케줄한다.
    private pollChainErrorLogged = false;

    private logPollChainError(chain: string, err: unknown): void {
        if (this.pollChainErrorLogged) { return; }
        this.pollChainErrorLogged = true;
        const msg = err instanceof Error ? err.message : String(err);
        this.host.log(`⚠ ${chain} 폴 체인 예외 (체인은 유지됨): ${msg}`);
    }

    /**
     * ⑦ 비-pending 1403 트리거용 코얼레싱 폴 예약. 디바운스 창(POLL_MIN_GAP_MS)이
     * 지나는 시점에 force 폴 1회를 보장한다 — 창 안에 도착한 트리거를 그냥 버리면
     * 자유 실행 BP 히트 감지가 인터벌 백업(≥1s)까지 밀리는 구멍이 생긴다.
     */
    requestTriggerPoll(): void {
        if (this.triggerPollPending) { return; }
        this.triggerPollPending = true;
        const since = Date.now() - this.host.lastPollCompletedAt;
        const delay = Math.max(0, PollDriver.POLL_MIN_GAP_MS - since) + 5;
        setTimeout(() => {
            this.triggerPollPending = false;
            if (!this.host.isConnected) { return; }
            // force=true: 만료 시점 폴이 다시 디바운스에 걸리지 않도록. 폴 진행 중이면
            // _pollRetryRequested(force 경로)로 재폴이 예약된다.
            void this.host.pollThreadStates(true, 'trigger');
        }, delay);
    }

    private startPolling(): void {
        this.stopPolling();
        this.scheduleNextIntervalPoll(++this.pollTimerGen);
    }

    /**
     * ⑦ 적응형 백업 폴: Running 쓰레드가 있고 1403 이 부재(health 없음/비alive)이면 짧은 간격
     * (_runningBackupPollMs)으로, 1403 이 정상이거나 모두 정지/Idle이면 사용자 간격(_pollIntervalMs)으로 재관측한다.
     * GitHub #22: 1403 이 정상이면 정지/BP 히트는 1403 트리거(onDebugPollTrigger)가 먼저 알려주므로 촘촘한
     * 백업 폴은 트래픽 낭비다(실측 77분간 Show Thread 922회). 정책은 폴마다 재평가하되 로그는 바뀔 때만 남긴다.
     * 정지 중 상태 변화는 사용자 액션이 시작점이라 _fastPoll이 즉시 커버하므로 정지 중 트래픽은 기존과 동일하다.
     */
    private scheduleNextIntervalPoll(gen: number): void {
        if (gen !== this.pollTimerGen || !this.host.isConnected) { return; }
        const anyRunning = (this.host.lastThreadList ?? []).some(t => t.state === 'Running');
        let delay = this.pollIntervalMs;
        if (anyRunning) {
            const health = getRuntimeConsoleHealth();
            const alive = health?.alive === true;
            delay = alive ? this.pollIntervalMs : Math.min(this.runningBackupPollMs, this.pollIntervalMs);
            const policy: 'alive' | 'absent' = alive ? 'alive' : 'absent';
            if (policy !== this.backupPollPolicy) {
                this.backupPollPolicy = policy;
                this.host.log(alive
                    ? `백업 폴: 런타임 콘솔 정상(${health?.state}) → ${delay}ms (GitHub #22)`
                    : `백업 폴: 런타임 콘솔 부재(${health ? health.state : '상태 공급자 없음'}) → ${delay}ms (GitHub #22)`);
            }
        }
        this.pollTimer = setTimeout(() => {
            this.pollTimer = undefined;
            void (async () => {
                if (gen !== this.pollTimerGen || !this.host.isConnected) { return; }
                try {
                    // 모두 정지 중이고 변수 조회가 남아 있으면 이번 주기는 건너뛴다 — 사람이 기다리는 조회가 먼저다.
                    // (Running 쓰레드가 있으면 정지 감지가 우선이라 그대로 폴한다.)
                    const busyWhileStopped = this.host.dataQueryPending === true
                        && !(this.host.lastThreadList ?? []).some(t => t.state === 'Running');
                    if (!this.host.pollInFlight && !busyWhileStopped) {
                        await this.host.pollThreadStates(false, 'interval');
                    }
                } catch (err) {
                    // 폴 1회 예외로 인터벌 체인이 조용히 끊기지 않게 한다 (재스케줄 보장).
                    this.logPollChainError('interval', err);
                } finally {
                    this.scheduleNextIntervalPoll(gen);
                }
            })();
        }, delay);
    }

    stopPolling(): void {
        this.pollTimerGen++;
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = undefined;
        }
        // 진행 중인 fast poll 체인 무효화 — 지연 콜백이 뒤늦게 재폴/재스케줄하지 않도록.
        this.fastPollGen++;
        if (this.fastPollTimer) {
            clearTimeout(this.fastPollTimer);
            this.fastPollTimer = undefined;
        }
    }

    /**
     * Trigger fast polling after step/continue/pause commands.
     * ⑥ 첫 폴을 30ms에 시작해 점감 백오프(FAST_POLL_DELAYS_MS)로 재관측한다 —
     * 짧은 스텝은 명령 STATUS 직후 첫 폴에서 바로 잡혀 체감 지연이 최소화된다.
     * 1403 즉시 트리거가 주 신호이고 이 스케줄은 트리거 유실 대비 백업.
     * pending 액션이 해소되면 남은 스케줄을 버리고 일반 폴링으로 복귀한다.
     */
    fastPoll(): void {
        this.stopPolling();
        // ③ 곧 위치가 바뀌므로 stack 프레임 캐시 신선도를 무효화(다음 정지 후 1회 재조회).
        this.frames.invalidateFreshness(); // ⑧ 진행 중이던 프레임 조회의 캐시 기록도 무효화
        const gen = ++this.fastPollGen;
        const delays = PollDriver.FAST_POLL_DELAYS_MS;
        // pending 백업 폴 일정의 기준 시각 — 이 함수는 사용자 액션(step/continue/pause/entry Start) 직후에만 불린다.
        this.pendingSinceMs = Date.now();
        this.pendingBackupLogged = false;
        const schedule = (idx: number): void => {
            if (gen !== this.fastPollGen) { return; }
            let delay: number;
            let source: StopPollSource;
            if (idx < delays.length) {
                delay = delays[idx];
                source = 'fast';
            } else {
                // 점감 체인이 끝났는데 아직 사용자 액션의 정지를 못 봤다 — 1403 트리거가 이 정지를 알려 주지 않을 수 있으므로
                // pending 전용 백업 폴로 잇는다(pollSchedule.ts: step/pause/entry 는 확인까지, continue 는 창 안에서만).
                const pending = pendingPollDelayMs({
                    pendingAction: this.host.pendingAction,
                    pendingSinceMs: this.pendingSinceMs,
                    nowMs: Date.now(),
                    backupPollMs: this.runningBackupPollMs,
                    continueFastWindowMs: DEFAULT_CONTINUE_FAST_WINDOW_MS,
                });
                if (pending === null) {
                    if (this.host.isConnected) { this.startPolling(); }
                    return;
                }
                delay = pending;
                source = 'pending';
                if (!this.pendingBackupLogged) {
                    this.pendingBackupLogged = true;
                    this.host.log(`정지 확인 대기: ${this.host.pendingAction} 가 ${Date.now() - this.pendingSinceMs}ms 째 미확인 → ${delay}ms 간격 백업 폴로 계속 확인 (1403 트리거 병행)`);
                }
            }
            this.fastPollTimer = setTimeout(() => {
                this.fastPollTimer = undefined;
                if (gen !== this.fastPollGen || !this.host.isConnected) { return; }
                void (async () => {
                    try {
                        if (!this.host.pollInFlight) {
                            await this.host.pollThreadStates(true, source);
                        }
                    } catch (err) {
                        // 폴 1회 예외로 fast poll 체인이 끊기지 않게 한다 (다음 스케줄 유지).
                        this.logPollChainError('fast', err);
                    }
                    if (gen !== this.fastPollGen || !this.host.isConnected) { return; }
                    // 정지를 이미 감지했으면(pending 해소) fast poll 조기 종료 → 일반 폴링 복귀
                    if (!this.host.pendingAction) {
                        if (!this.pollTimer) { this.startPolling(); }
                        return;
                    }
                    schedule(idx + 1);
                })();
            }, delay);
        };
        schedule(0);
    }

    // 직전에 적용한 백업 폴 정책 — 바뀔 때만 1회 로그(폴마다 로그하면 소음)
    backupPollPolicy: 'alive' | 'absent' | undefined;

    runningBackupPollMs = PollDriver.DEFAULT_RUNNING_BACKUP_POLL_MS;

    /** 현재 pending 액션의 명령이 나간 시각 — pending 백업 폴 일정(pollSchedule.pendingPollDelayMs)의 기준. */
    private pendingSinceMs = 0;

    private pendingBackupLogged = false;

    // ⑦ 백업 인터벌 폴 간격(Running 쓰레드 존재 + 1403 부재 시). 실행 중 BP 히트는 1403 상태
    //    이벤트 트리거가 주 신호이고, 이 값은 1403 유실/미연결 시의 안전망이다.
    //    GitHub #22('5번째 다운' 제안 2): 1403 이 정상인데도 항상 1Hz 로 돌던 이 폴이 부팅 후 77분간
    //    Show Thread -web 922회를 만들었다. 이제 debugBridge 의 1403 health 가 alive 면 사용자 간격
    //    (_pollIntervalMs)으로 완화하고, 1403 부재일 때만 이 값(설정 gpl.debug.runningBackupPollMs,
    //    하한 250ms, attach 시 1회 읽음)을 쓴다. (그 이전: 항상 사용자 간격 → BP 히트 감지 최대 5초 지연)
    static readonly DEFAULT_RUNNING_BACKUP_POLL_MS = 1000;

    static readonly MIN_RUNNING_BACKUP_POLL_MS = 250;

    // ⑥ step/continue 후 fast poll 스케줄(ms): 첫 폴 30ms 시작, 점감 백오프.
    //    (기존 500ms x 2는 1403 트리거 유실 시 첫 관측까지 최소 500ms 체감 지연 유발)
    // 2026-11-04: 30/120/250/500/1000 → 촘촘하게. 폴은 앞 폴이 끝난 뒤 예약되므로 RTT 가 길면 그만큼 자연히 벌어진다(쌓이지 않음).
    static readonly FAST_POLL_DELAYS_MS = [20, 60, 120, 200, 300, 450, 650];

    static readonly POLL_MIN_GAP_MS = 250;

    static readonly MIN_DEBUG_POLL_INTERVAL_MS = 1000;

    static readonly MAX_DEBUG_POLL_INTERVAL_MS = 5000;

    pollIntervalMs = 1000;
}
