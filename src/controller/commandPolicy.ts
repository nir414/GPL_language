/**
 * 제어기 명령 정책(vscode 무의존) — "AI 지침이 아니라 확장이 스스로 안전 조건을 충족시킨다" (2026-08-28 사용자 결정).
 *
 * 배경:
 *  - 확장은 AI(MCP·`gpl.ai.debug.*`·URI)·트리·팔레트·디버그 어댑터 등 여러 경로로 1402 명령을 보낸다. 종전에는
 *    제어기 사고를 막는 조건(Step 연타 금지 #28, Stop 정착 전 Compile/Start 금지 §0.6, Compile 직후 Start 연속 금지 §0.7)이
 *    디버그 어댑터 한 곳의 게이트와 런북의 "외부 클라이언트는 스스로 확인한다"는 지침에만 있었다.
 *  - 모든 명령이 controllerConnection.sendCommandDetailed 의 직렬 큐 한 곳을 지나므로, 여기서 한 번 강제하면 어느 경로로
 *    들어와도 같은 조건이 걸린다. 지침을 몰라도 안전하게 쓸 수 있게 하는 것이 목적이다.
 *
 * 원칙 — 접근을 막지 않는다:
 *  - 사람 승인 모달·명령 거부 목록을 두지 않는다. AI가 비대화형으로 쓰는 경로가 막히면 MCP/URI를 만든 목적이 무너진다.
 *  - 조건은 "확장이 대신 기다려서 충족시키는" 형태(정착 대기·최소 간격·완충 지연)로만 두고, 한정된 대기(settleWaitMs) 안에
 *    조건이 충족되지 않을 때만 PolicyError 로 알린다(제어기에 아무것도 보내지 않고 — 가짜 STATUS 를 만들지 않는다, 하드 규칙 2).
 *  - 상태 판정은 `Show Thread  -web` 실응답으로만 한다(간접 신호 금지). 응답을 못 받으면 "모름"이지 "정착"이 아니다.
 *
 * 규칙:
 *  R1. Step/Continue(같은 쓰레드): 직전 Step/Continue 가 STATUS 0 으로 접수된 뒤 그 쓰레드의 정지(Step) 또는 상태 관측(Continue)이
 *      확인되기 전에는 다음 명령을 보내지 않고 정지를 기다린다(settleWaitMs). 그 뒤에도 `minResumeIntervalMs` 하한을 둔다.
 *      (디버그 어댑터의 stepGate 는 키 자동 반복을 "무시"로 처리하고, 여기서는 "기다린 뒤 보냄"으로 처리한다 — 어댑터가 앞단에서
 *      먼저 걸러 주므로 어댑터 경로에서는 거의 개입하지 않는다.)
 *  R2. Start/Compile/Load/Unload: 제어기에 `Stopping`(정지 진행 중) 쓰레드가 있으면 정착까지 기다린다(§0.6 — Stop -all STATUS 0 은
 *      접수일 뿐, 정지 완료 전 Compile/Start 는 제어기 이상 유발). Running/Paused 는 막지 않는다 — 다중 프로젝트 동시 실행은
 *      정상 사용이고, 대상 프로젝트가 실행 중이면 제어기가 STATUS 로 거부한다(그 판정은 제어기의 것).
 *  R3. Start <project>: 같은 프로젝트의 Compile 응답 완료 뒤 `startAfterCompileGapMs` 가 지나기 전이면 그만큼 기다린다(§0.7 —
 *      Start 가 자체 컴파일을 수행하므로 컴파일 연속을 피한다. 안전성 실측 전이라 거부가 아닌 완충 지연으로 둔다).
 *
 * 단위 테스트: src/test/commandPolicy.test.ts
 */

import { parseThreadList } from './responseParser';
import type { ThreadInfo } from './responseParser';

export type PolicyCommandKind =
    | 'step' | 'continue' | 'break' | 'stop'
    | 'start' | 'compile' | 'load' | 'unload'
    | 'show-thread' | 'other';

export interface PolicyCommandInfo {
    kind: PolicyCommandKind;
    /** 대상 쓰레드/프로젝트 이름(첫 비스위치 인자). `Stop -all`·`Show Thread` 처럼 없으면 undefined. */
    target?: string;
    /** `Show Thread -web` 처럼 전체 쓰레드를 열거하는 응답인지(이 경우 목록에 없는 쓰레드는 종료된 것으로 본다). */
    listsAllThreads: boolean;
}

export interface CommandPolicyOptions {
    /** R1 — 같은 쓰레드 Step/Continue 사이 최소 간격(ms). 0 이하 = 없음. (`gpl.debug.minStepIntervalMs`) */
    minResumeIntervalMs: number;
    /** R1·R2 — 상태 전이 정착을 기다리는 상한(ms). (`gpl.controller.transitionSettleWaitMs`) */
    settleWaitMs: number;
    /** R3 — Compile 완료 뒤 같은 프로젝트 Start 까지의 완충(ms). 0 이하 = 없음. (`gpl.controller.startAfterCompileGapMs`) */
    startAfterCompileGapMs: number;
    /** 정착 대기 중 `Show Thread -web` 재조회 간격(ms). */
    pollIntervalMs: number;
}

export const DEFAULT_COMMAND_POLICY_OPTIONS: Readonly<CommandPolicyOptions> = {
    minResumeIntervalMs: 100,
    settleWaitMs: 8000,
    startAfterCompileGapMs: 1500,
    pollIntervalMs: 300,
};

/** 정책이 명령 실행 전에 쓰는 I/O — 실제 구현은 controllerConnection, 테스트는 가짜. */
export interface PolicyIo {
    now(): number;
    sleep(ms: number): Promise<void>;
    /** `Show Thread  -web` 을 보내 목록을 돌려준다. `</STATUS>` 를 못 받았거나 실패면 null(모름). */
    listThreads(): Promise<ThreadInfo[] | null>;
    log(message: string): void;
}

export type PolicyErrorCode = 'resume-pending' | 'threads-transitioning' | 'threads-unknown';

/** 한정된 대기 안에 조건이 충족되지 않아 명령을 보내지 않았음을 알린다. 제어기에는 아무것도 전송되지 않았다. */
export class PolicyError extends Error {
    constructor(public readonly code: PolicyErrorCode, message: string) {
        super(message);
        this.name = 'PolicyError';
    }
}

export function isPolicyError(err: unknown): err is PolicyError {
    return err instanceof PolicyError || (typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'PolicyError');
}

// ── 분류 ──────────────────────────────────────────────────────────────────

const KIND_BY_VERB: ReadonlyMap<string, PolicyCommandKind> = new Map([
    ['step', 'step'],
    ['continue', 'continue'],
    ['break', 'break'],
    ['stop', 'stop'],
    ['start', 'start'],
    ['compile', 'compile'],
    ['load', 'load'],
    ['unload', 'unload'],
]);

/** 명령 문자열을 정책 관점으로 분류한다. 스위치(`-over`, `-all` …)는 대상으로 보지 않는다. */
export function classifyPolicyCommand(command: string): PolicyCommandInfo {
    const tokens = command.trim().split(/\s+/).filter(Boolean);
    const verb = (tokens[0] ?? '').toLowerCase();
    if (!verb) {
        return { kind: 'other', listsAllThreads: false };
    }
    if (verb === 'show' && (tokens[1] ?? '').toLowerCase() === 'thread') {
        const rest = tokens.slice(2);
        const target = rest.find(t => !t.startsWith('-'));
        const listsAllThreads = !target && rest.some(t => /^-web$/i.test(t));
        return { kind: 'show-thread', target, listsAllThreads };
    }
    const kind = KIND_BY_VERB.get(verb);
    if (!kind) {
        return { kind: 'other', listsAllThreads: false };
    }
    const target = tokens.slice(1).find(t => !t.startsWith('-'));
    return { kind, target, listsAllThreads: false };
}

/** Load 는 경로(`/flash/projects/X`)를 받으므로 프로젝트 키는 마지막 경로 요소로 맞춘다. */
function projectKey(target: string | undefined): string | undefined {
    if (!target) { return undefined; }
    const last = target.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? target;
    return last.toLowerCase();
}

/** 쓰레드가 정지 계열(Step 뒤 다음 명령을 보내도 되는 상태)인지. Running/Stopping 만 아니면 정지로 본다. */
const RESUME_SETTLED_STATES = /^(idle|stopped|error|paused|break)$/i;
const TRANSITIONING_STATE = /^stopping$/i;

interface ResumeRecord {
    kind: 'step' | 'continue';
    lastSentAt: number;
    /** STATUS 0 접수 뒤 정지/관측 확인 전이면 접수 시각, 확인되면 undefined. */
    pendingSince?: number;
}

// ── 정책 ──────────────────────────────────────────────────────────────────

export class ControllerCommandPolicy {
    private opts: CommandPolicyOptions;
    private readonly resumeByThread = new Map<string, ResumeRecord>();
    private readonly compileDoneAtByProject = new Map<string, number>();

    constructor(options?: Partial<CommandPolicyOptions>) {
        this.opts = { ...DEFAULT_COMMAND_POLICY_OPTIONS, ...(options ?? {}) };
    }

    updateOptions(options: Partial<CommandPolicyOptions>): void {
        this.opts = { ...this.opts, ...options };
    }

    getOptions(): Readonly<CommandPolicyOptions> {
        return this.opts;
    }

    /** 테스트/진단용 — 쓰레드의 재개 대기 상태. */
    isResumePending(threadName: string): boolean {
        return this.resumeByThread.get(threadName.toLowerCase())?.pendingSince !== undefined;
    }

    /**
     * 명령을 보내기 전에 호출한다. 조건이 충족될 때까지 기다리거나(io.sleep/listThreads), 한정된 대기 안에 충족되지 않으면
     * PolicyError 를 던진다(명령 미전송). 그 외 명령은 즉시 반환한다.
     */
    async before(command: string, io: PolicyIo): Promise<void> {
        const info = classifyPolicyCommand(command);
        switch (info.kind) {
            case 'step':
            case 'continue':
                if (info.target) { await this.gateResume(info.target, info.kind, io); }
                return;
            case 'start':
            case 'compile':
            case 'load':
            case 'unload':
                await this.gateTransition(info, io);
                if (info.kind === 'start') { await this.gateStartAfterCompile(info.target, io); }
                return;
            default:
                return;
        }
    }

    /**
     * 응답을 받은 뒤 호출한다(실패로 응답이 없으면 호출하지 않아도 된다). 상태 기록만 하고 예외를 내지 않는다.
     * @param statusReceived `</STATUS>` 까지 받았는지 — 잘린 응답은 관측으로 쓰지 않는다(하드 규칙 2).
     */
    after(command: string, raw: string, statusReceived: boolean, now: number): void {
        const info = classifyPolicyCommand(command);
        switch (info.kind) {
            case 'show-thread':
                if (statusReceived) { this.observeThreads(parseThreadList(raw), info.listsAllThreads); }
                return;
            case 'step':
            case 'continue': {
                if (!info.target || !statusReceived) { return; }
                const code = lastStatusCode(raw);
                const key = info.target.toLowerCase();
                const prev = this.resumeByThread.get(key);
                this.resumeByThread.set(key, {
                    kind: info.kind,
                    lastSentAt: now,
                    // STATUS 0 = 접수(정지 완료 아님 — Break/Step 의 STATUS 0 은 "접수"일 수 있다, §0.6 패턴). 거부됐으면 대기 없음.
                    pendingSince: code === 0 ? now : prev?.pendingSince,
                });
                return;
            }
            case 'compile': {
                const key = projectKey(info.target);
                if (key && statusReceived) { this.compileDoneAtByProject.set(key, now); }
                return;
            }
            case 'stop':
                // 정지 명령이 나가면 그 쓰레드의 재개 대기는 의미가 없다(정지되면 관측으로도 풀리지만 즉시 풀어 둔다).
                if (info.target) { this.clearPending(info.target); } else { this.resumeByThread.forEach(r => { r.pendingSince = undefined; }); }
                return;
            default:
                return;
        }
    }

    /** `Show Thread` 응답에서 관측한 상태로 재개 대기를 푼다. 외부(폴러)에서 직접 넘겨도 된다. */
    observeThreads(threads: ThreadInfo[], listsAllThreads: boolean): void {
        if (this.resumeByThread.size === 0) { return; }
        const byName = new Map<string, ThreadInfo>();
        for (const t of threads) { byName.set((t.name || '').toLowerCase(), t); }
        for (const [key, rec] of this.resumeByThread) {
            if (rec.pendingSince === undefined) { continue; }
            const t = byName.get(key);
            if (!t) {
                if (listsAllThreads) { rec.pendingSince = undefined; }   // 종료된 쓰레드
                continue;
            }
            const state = (t.state || '').toString().trim();
            if (rec.kind === 'continue') {
                // Continue 는 Running 관측도 "명령이 반영됐다"는 확인이다. 알 수 없는 상태 문자열만 보류.
                if (state) { rec.pendingSince = undefined; }
            } else if (RESUME_SETTLED_STATES.test(state)) {
                rec.pendingSince = undefined;
            }
        }
    }

    private clearPending(threadName: string): void {
        const rec = this.resumeByThread.get(threadName.toLowerCase());
        if (rec) { rec.pendingSince = undefined; }
    }

    private async gateResume(threadName: string, kind: 'step' | 'continue', io: PolicyIo): Promise<void> {
        const key = threadName.toLowerCase();
        const rec = this.resumeByThread.get(key);
        if (!rec) { return; }

        if (rec.pendingSince !== undefined) {
            const start = io.now();
            io.log(`R1 ${kind} ${threadName}: 직전 ${rec.kind} 정지 확인 대기 (최대 ${this.opts.settleWaitMs}ms, GitHub #28)`);
            let sawList = false;
            for (;;) {
                const threads = await io.listThreads();
                if (threads) {
                    sawList = true;
                    this.observeThreads(threads, true);
                }
                if (rec.pendingSince === undefined) {
                    io.log(`R1 ${kind} ${threadName}: 정지 확인 (${io.now() - start}ms 대기)`);
                    break;
                }
                if (io.now() - start >= this.opts.settleWaitMs) {
                    const detail = sawList ? '아직 정지 상태가 아님' : 'Show Thread 응답 없음(상태 모름)';
                    throw new PolicyError('resume-pending',
                        `${kind === 'step' ? 'Step' : 'Continue'} ${threadName} 보류 — 직전 ${rec.kind === 'step' ? 'Step' : 'Continue'}의 정지 확인이 ${this.opts.settleWaitMs}ms 안에 되지 않음(${detail}). ` +
                        `쓰레드가 멈춘 뒤 다시 시도하세요(정지 전 연속 Step은 제어기를 다운시킨 사고 이력, GitHub #28). 제어기에 명령은 보내지 않았습니다.`);
                }
                await io.sleep(this.opts.pollIntervalMs);
            }
        }

        if (this.opts.minResumeIntervalMs > 0 && rec.lastSentAt > 0) {
            const remaining = this.opts.minResumeIntervalMs - (io.now() - rec.lastSentAt);
            if (remaining > 0) {
                io.log(`R1 ${kind} ${threadName}: 최소 간격 ${this.opts.minResumeIntervalMs}ms 유지 (${remaining}ms 대기)`);
                await io.sleep(remaining);
            }
        }
    }

    private async gateTransition(info: PolicyCommandInfo, io: PolicyIo): Promise<void> {
        const label = `${info.kind}${info.target ? ` ${info.target}` : ''}`;
        const start = io.now();
        let logged = false;
        let sawList = false;
        for (;;) {
            const threads = await io.listThreads();
            if (threads) {
                sawList = true;
                this.observeThreads(threads, true);
                const transitioning = threads.filter(t => TRANSITIONING_STATE.test((t.state || '').toString().trim()));
                if (transitioning.length === 0) {
                    if (logged) { io.log(`R2 ${label}: 정지 정착 확인 (${io.now() - start}ms 대기)`); }
                    return;
                }
                if (!logged) {
                    logged = true;
                    io.log(`R2 ${label}: Stopping 쓰레드 ${transitioning.map(t => t.name).join(', ')} 정착 대기 (최대 ${this.opts.settleWaitMs}ms, §0.6)`);
                }
            } else if (!logged) {
                logged = true;
                io.log(`R2 ${label}: Show Thread 응답 없음 — 상태 확인 재시도 (최대 ${this.opts.settleWaitMs}ms)`);
            }
            if (io.now() - start >= this.opts.settleWaitMs) {
                if (sawList) {
                    throw new PolicyError('threads-transitioning',
                        `${label} 보류 — 정지 진행 중(Stopping) 쓰레드가 ${this.opts.settleWaitMs}ms 안에 정착하지 않음. 정지 완료 전 Compile/Start는 제어기 이상을 유발합니다(§0.6). 제어기에 명령은 보내지 않았습니다.`);
                }
                throw new PolicyError('threads-unknown',
                    `${label} 보류 — 쓰레드 상태를 ${this.opts.settleWaitMs}ms 안에 확인하지 못함(Show Thread -web 응답 없음). 상태 미확인 상태로 Compile/Start를 보내지 않습니다(§0.6). 제어기에 명령은 보내지 않았습니다.`);
            }
            await io.sleep(this.opts.pollIntervalMs);
        }
    }

    private async gateStartAfterCompile(target: string | undefined, io: PolicyIo): Promise<void> {
        if (this.opts.startAfterCompileGapMs <= 0) { return; }
        const key = projectKey(target);
        if (!key) { return; }
        const doneAt = this.compileDoneAtByProject.get(key);
        if (doneAt === undefined) { return; }
        const remaining = this.opts.startAfterCompileGapMs - (io.now() - doneAt);
        if (remaining > 0) {
            io.log(`R3 start ${target}: Compile 완료 직후 — ${remaining}ms 완충 뒤 전송 (§0.7 Start 자체 컴파일)`);
            await io.sleep(remaining);
        }
    }
}

/** 응답의 마지막 `<STATUS>` 코드. 없으면 undefined. (responseParser.parseStatus 와 같은 "마지막 블록" 규칙) */
function lastStatusCode(raw: string): number | undefined {
    const re = /<STATUS>\s*(-?\d+)/g;
    let m: RegExpExecArray | null;
    let last: string | undefined;
    while ((m = re.exec(raw)) !== null) { last = m[1]; }
    return last === undefined ? undefined : Number.parseInt(last, 10);
}
