/**
 * 장시간 작업 기록(Operation) — "지금 무엇이 어디까지 진행됐는가"를 프로세스 밖에서도 읽을 수 있게 하는 저장소.
 * vscode 무의존 — 단위 테스트: `src/test/operationStore.test.ts`.
 *
 * 왜(2026-09-10 사용자 개선안 §8~§11): Deploy/Quick Compile 은 업로드+Compile 로 수 분이 걸리는데, MCP 는 그것을
 * **브리지 RPC 한 번**으로 기다렸다. 응답 대기가 끝나면(기본 240초) 결과가 **불명**이 되고, AI 는 같은 작업을
 * 다시 돌리거나("중복 배포") 배포 잠금에 막혀 "LOCKED" 만 보고했다. 정작 확장은 그때도 멀쩡히 배포를 진행 중이었다.
 *
 * 그래서 작업의 **상태를 파일로 남긴다**. 배포 잠금(`deployLock.ts`)이 "지금 크리티컬 섹션에 누가 있는가"를 담당하듯,
 * 이 파일은 "그 작업이 무엇이고 어디까지 갔고 결과가 무엇인가"를 담당한다. 둘은 목적이 다르므로 합치지 않는다:
 *   - 잠금은 작업이 끝나면 **사라져야** 하고(상호 배제), 기록은 끝난 뒤에도 **남아야** 한다(결과 조회).
 * ※ 이 파일도 로그가 아니라 조정/조회 프리미티브다 — 제어기 상태 판단에는 쓰지 않는다(§0 하드 규칙 1과 무관).
 *
 * 파일 계약 — MCP `controller-mcp/src/operations.js`(읽기 전용 구현)와 반드시 동일하게 유지:
 *   경로 : <dir>/operations/<operationId>.json   (dir 기본값은 배포 잠금과 같은 %TEMP%/gpl-controller)
 *   내용 : { version, operationId, type, state, phase, controllerId, extensionInstanceId, pid, host,
 *            projectDir?, projectName?, idempotencyKey?, requestId?,
 *            createdAt, startedAt?, finishedAt?, heartbeat, result?, error? }
 *   RUNNING 인데 heartbeat 가 끊겼거나 pid 가 죽었으면 **읽는 쪽이** state 를 'UNKNOWN' 으로 본다
 *   (파일을 고쳐 쓰지 않는다 — UNKNOWN 은 관측이지 확정이 아니고, FAILED 와 다르다. §11).
 *
 * 상태 모델: `state` 는 생애주기(QUEUED/RUNNING/COMPLETED/FAILED/CANCELLED, 읽을 때만 UNKNOWN)이고,
 * 세부 진행은 `phase` 문자열(PREPARE/UPLOAD/STOP/COMPILE/START/…)로 둔다 — 배포 단계 라벨을 그대로 쓰므로
 * 단계가 늘어도 이 모듈을 고칠 필요가 없다(상태 enum 을 두 벌 유지하지 않는다).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const OPERATION_VERSION = 1;
/** heartbeat 가 이 시간 이상 갱신되지 않으면 진행 중이라고 믿지 않는다(→ 읽을 때 UNKNOWN). */
export const OPERATION_STALE_MS = 60_000;
/** 진행 중 heartbeat 갱신 주기. STALE_MS 보다 충분히 짧아야 한다. */
export const OPERATION_HEARTBEAT_MS = 5_000;
/** 끝난 기록을 이 시간까지 남긴다 — 타임아웃 뒤에 결과를 되찾을 수 있는 창(§11). */
export const OPERATION_KEEP_MS = 60 * 60_000;
/** 디렉터리에 남기는 기록 수 상한(오래된 완료분부터 지운다). */
export const OPERATION_KEEP_MAX = 200;
export const OPERATION_DIR_NAME = 'gpl-controller';

/** 작업 생애주기. UNKNOWN 은 파일에 쓰지 않는다 — 읽는 쪽이 heartbeat/pid 로 판정한다. */
export type OperationState = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN';

/** 되풀이해도 되는가를 호출자가 문장 해석 없이 알 수 있게 하는 복구 지시(§15·§17). */
export type OperationRetryMode =
    | 'NONE'
    | 'CHECK_OPERATION'
    | 'RETRY_SAME_REQUEST'
    | 'RESOLVE_PROJECT'
    | 'RESOLVE_EXTENSION';

export interface OperationError {
    code: string;
    message: string;
    retryable: boolean;
    retryMode: OperationRetryMode;
    /** 같은 요청을 그대로 다시 보내도 부작용이 없는가(제어기 상태 변경 여부). */
    safeToRepeat: boolean;
}

export interface OperationRecord {
    version: number;
    operationId: string;
    /** 'DEPLOY' | 'QUICK_COMPILE' | 'UPLOAD_START' | … — 자유 문자열이지만 호출측이 일관되게 쓴다. */
    type: string;
    state: OperationState;
    /** 세부 진행 단계(배포 단계 라벨 그대로). */
    phase: string;
    /** 제어기 식별 — 지금은 IP. */
    controllerId: string;
    /** 이 작업을 수행하는 확장 인스턴스(§4). */
    extensionInstanceId?: string;
    pid: number;
    host: string;
    /** 대상 프로젝트의 canonical identity(§3.1). */
    projectDir?: string;
    projectName?: string;
    /** 같은 키의 요청은 새 작업을 만들지 않는다(§10). */
    idempotencyKey?: string;
    /** 이 작업을 일으킨 브리지 요청 id — 로그 상관(§23). */
    requestId?: string;
    createdAt: number;
    startedAt?: number;
    finishedAt?: number;
    heartbeat: number;
    /** 완료 시 결과 요약(배포 결과 전체가 아니라 판정에 필요한 것만). */
    result?: Record<string, unknown>;
    error?: OperationError;
}

export interface OperationEnv {
    dir?: string;
    now?: () => number;
    pid?: number;
    host?: string;
    pidAlive?: (pid: number) => boolean;
    /** 0이면 heartbeat 타이머를 돌리지 않는다(테스트). */
    heartbeatIntervalMs?: number;
    staleMs?: number;
}

export function defaultOperationRootDir(): string {
    return process.env.GPL_LOCK_DIR || path.join(os.tmpdir(), OPERATION_DIR_NAME);
}

export function operationsDir(dir = defaultOperationRootDir()): string {
    return path.join(dir, 'operations');
}

/** operationId 를 파일명으로 안전하게. */
export function sanitizeOperationId(id: string): string {
    const safe = String(id || '').trim().replace(/[^A-Za-z0-9._-]/g, '_');
    return safe || 'unknown';
}

export function operationFilePath(operationId: string, dir = defaultOperationRootDir()): string {
    return path.join(operationsDir(dir), `${sanitizeOperationId(operationId)}.json`);
}

let seq = 0;
/** `deploy-1789005694073-23504-3` — 사람이 로그에서 알아볼 수 있게 종류·시각·pid 를 담는다. */
export function newOperationId(type: string, now = Date.now(), pid = process.pid): string {
    seq = (seq + 1) % 100000;
    return sanitizeOperationId(`${type.toLowerCase()}-${now}-${pid}-${seq}`);
}

function pidAliveDefault(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) { return false; }
    try {
        process.kill(pid, 0);
        return true;
    } catch (err: any) {
        return err?.code === 'EPERM';
    }
}

function writeFileAtomic(file: string, content: string): void {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, content);
    try {
        fs.renameSync(tmp, file);
    } catch {
        try { fs.writeFileSync(file, content); } finally { try { fs.unlinkSync(tmp); } catch { /* noop */ } }
    }
}

function parseRecord(text: string): OperationRecord | undefined {
    try {
        const rec = JSON.parse(text) as OperationRecord;
        if (!rec || typeof rec !== 'object') { return undefined; }
        if (rec.version !== OPERATION_VERSION || typeof rec.operationId !== 'string') { return undefined; }
        return rec;
    } catch {
        return undefined;
    }
}

/**
 * 기록을 읽는다. **진행 중이라고 적혀 있어도 그대로 믿지 않는다** — heartbeat 가 끊겼거나 프로세스가 죽었으면
 * state 를 'UNKNOWN' 으로 바꿔 돌려준다(파일은 고치지 않는다). UNKNOWN 은 실패가 아니라 '결과 미확정'이다(§11).
 */
export function readOperation(
    operationId: string,
    env: { dir?: string; now?: number; staleMs?: number; pidAlive?: (pid: number) => boolean } = {},
): OperationRecord | undefined {
    let text: string;
    try {
        text = fs.readFileSync(operationFilePath(operationId, env.dir), 'utf8');
    } catch {
        return undefined;
    }
    const rec = parseRecord(text);
    return rec ? withObservedState(rec, env) : undefined;
}

/** 파일에 적힌 state 를 관측으로 보정한다(진행 중인데 보유자가 사라졌으면 UNKNOWN). */
export function withObservedState(
    rec: OperationRecord,
    env: { now?: number; staleMs?: number; pidAlive?: (pid: number) => boolean } = {},
): OperationRecord {
    if (rec.state !== 'RUNNING' && rec.state !== 'QUEUED') { return rec; }
    const now = env.now ?? Date.now();
    const staleMs = env.staleMs ?? OPERATION_STALE_MS;
    const alive = (env.pidAlive ?? pidAliveDefault)(rec.pid);
    const fresh = now - (rec.heartbeat || rec.createdAt || 0) <= staleMs;
    if (alive && fresh) { return rec; }
    return { ...rec, state: 'UNKNOWN' };
}

/** 기록 전체(최근 것부터). 손상된 파일은 건너뛴다. */
export function listOperations(
    env: { dir?: string; now?: number; staleMs?: number; pidAlive?: (pid: number) => boolean; controllerId?: string } = {},
): OperationRecord[] {
    let names: string[];
    const base = operationsDir(env.dir);
    try {
        names = fs.readdirSync(base).filter(n => n.endsWith('.json'));
    } catch {
        return [];
    }
    const out: OperationRecord[] = [];
    for (const name of names) {
        let rec: OperationRecord | undefined;
        try {
            rec = parseRecord(fs.readFileSync(path.join(base, name), 'utf8'));
        } catch {
            continue;
        }
        if (!rec) { continue; }
        if (env.controllerId && rec.controllerId !== env.controllerId) { continue; }
        out.push(withObservedState(rec, env));
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
}

/** 아직 끝나지 않은 작업(진행 중으로 관측되는 것만 — UNKNOWN 은 제외한다). */
export function activeOperations(env: Parameters<typeof listOperations>[0] = {}): OperationRecord[] {
    return listOperations(env).filter(r => r.state === 'RUNNING' || r.state === 'QUEUED');
}

/**
 * 같은 idempotencyKey 로 **아직 진행 중인** 작업. 있으면 새 작업을 만들지 않는다(§10) —
 * 타임아웃 뒤의 재시도가 두 번째 배포를 일으키는 것을 막는 장치다.
 */
export function findActiveByIdempotencyKey(key: string, env: Parameters<typeof listOperations>[0] = {}): OperationRecord | undefined {
    if (!key) { return undefined; }
    return activeOperations(env).find(r => r.idempotencyKey === key);
}

/**
 * 오래된 기록을 지운다. **진행 중으로 관측되는 것은 건드리지 않는다.**
 *
 * 생존 신호가 끊긴 기록(UNKNOWN)도 `keepMs` 를 넘기면 지운다 — UNKNOWN 을 영구 보존하면 창이 죽을 때마다
 * 기록이 쌓이고, 보관 기간(기본 1시간)이 지난 미확정 결과는 조회해도 판단 근거가 되지 못한다. 대신 그
 * 사이에는 남아 있으므로 **타임아웃 직후의 조회는 반드시 성공한다**(§11 — 그것이 이 보관 기간의 목적이다).
 */
export function sweepOperations(env: { dir?: string; now?: number; keepMs?: number; keepMax?: number } = {}): number {
    const now = env.now ?? Date.now();
    const keepMs = env.keepMs ?? OPERATION_KEEP_MS;
    const keepMax = env.keepMax ?? OPERATION_KEEP_MAX;
    const all = listOperations({ dir: env.dir, now });
    const finished = all.filter(r => r.state !== 'RUNNING' && r.state !== 'QUEUED');
    const victims = new Set<string>();
    for (const r of finished) {
        if (now - (r.finishedAt ?? r.heartbeat ?? r.createdAt) > keepMs) { victims.add(r.operationId); }
    }
    // 남은 것이 상한을 넘으면 오래된 완료분부터 더 지운다.
    const survivors = finished.filter(r => !victims.has(r.operationId)).sort((a, b) => b.createdAt - a.createdAt);
    for (const r of survivors.slice(Math.max(0, keepMax - (all.length - finished.length)))) {
        victims.add(r.operationId);
    }
    let removed = 0;
    for (const id of victims) {
        try {
            fs.unlinkSync(operationFilePath(id, env.dir));
            removed++;
        } catch { /* 이미 없음 */ }
    }
    return removed;
}

/**
 * 진행 중인 작업 하나를 대표하는 핸들. 단계가 바뀔 때마다 파일에 반영하고, heartbeat 로 "살아 있음"을 남긴다.
 * `finish` 는 멱등이다 — 예외 경로에서 두 번 불려도 첫 결과가 남는다.
 */
export type OperationSeed =
    Pick<OperationRecord, 'operationId' | 'type' | 'controllerId'>
    & Partial<Omit<OperationRecord, 'operationId' | 'type' | 'controllerId'>>;

export class OperationHandle {
    private readonly dir: string;
    private readonly now: () => number;
    private timer: ReturnType<typeof setInterval> | undefined;
    private rec: OperationRecord;
    private done = false;

    constructor(seed: OperationSeed, env: OperationEnv = {}) {
        this.dir = env.dir ?? defaultOperationRootDir();
        this.now = env.now ?? (() => Date.now());
        const t = this.now();
        this.rec = {
            version: OPERATION_VERSION,
            state: 'RUNNING',
            createdAt: t,
            startedAt: t,
            heartbeat: t,
            pid: env.pid ?? process.pid,
            host: env.host ?? os.hostname(),
            ...seed,
            phase: seed.phase ?? 'PREPARE',
        };
        this.write();
        const hbMs = env.heartbeatIntervalMs ?? OPERATION_HEARTBEAT_MS;
        if (hbMs > 0) {
            this.timer = setInterval(() => { try { this.heartbeat(); } catch { /* 다음 주기에 재시도 */ } }, hbMs);
            this.timer.unref?.();
        }
    }

    get record(): Readonly<OperationRecord> { return this.rec; }
    get operationId(): string { return this.rec.operationId; }
    get filePath(): string { return operationFilePath(this.rec.operationId, this.dir); }
    get finished(): boolean { return this.done; }

    setPhase(phase: string): void {
        if (this.done || this.rec.phase === phase) { return; }
        this.rec = { ...this.rec, phase, heartbeat: this.now() };
        this.write();
    }

    /** 대상이 뒤늦게 확정됐을 때(프로젝트 해석 후) 보강한다. */
    describeTarget(target: { projectDir?: string; projectName?: string }): void {
        if (this.done) { return; }
        this.rec = { ...this.rec, ...target, heartbeat: this.now() };
        this.write();
    }

    heartbeat(): void {
        if (this.done) { return; }
        this.rec = { ...this.rec, heartbeat: this.now() };
        this.write();
    }

    complete(result?: Record<string, unknown>): void {
        this.finish('COMPLETED', { result });
    }

    fail(error: OperationError, result?: Record<string, unknown>): void {
        this.finish('FAILED', { error, result });
    }

    cancel(reason?: string): void {
        this.finish('CANCELLED', {
            error: reason ? { code: 'OPERATION_CANCELLED', message: reason, retryable: true, retryMode: 'RETRY_SAME_REQUEST', safeToRepeat: true } : undefined,
        });
    }

    private finish(state: OperationState, extra: { result?: Record<string, unknown>; error?: OperationError }): void {
        if (this.done) { return; }
        this.done = true;
        if (this.timer) { clearInterval(this.timer); this.timer = undefined; }
        const t = this.now();
        this.rec = { ...this.rec, state, finishedAt: t, heartbeat: t, ...extra };
        this.write();
    }

    private write(): void {
        try {
            fs.mkdirSync(operationsDir(this.dir), { recursive: true });
            writeFileAtomic(this.filePath, JSON.stringify(this.rec));
        } catch { /* 기록 실패가 배포를 막지는 않는다 */ }
    }
}

/** 작업 하나를 시작한다. `operationId` 를 주지 않으면 새로 만든다. */
export function beginOperation(
    seed: {
        type: string;
        controllerId: string;
        operationId?: string;
        extensionInstanceId?: string;
        projectDir?: string;
        projectName?: string;
        idempotencyKey?: string;
        requestId?: string;
        phase?: string;
    },
    env: OperationEnv = {},
): OperationHandle {
    const now = env.now ?? (() => Date.now());
    return new OperationHandle(
        { ...seed, operationId: seed.operationId ?? newOperationId(seed.type, now(), env.pid ?? process.pid) },
        env,
    );
}

/** 로그 상관용 한 줄 접두사(§23): `[op=deploy-… ext=8f4c… project=MergeCode]` */
export function operationLogTag(rec: Pick<OperationRecord, 'operationId' | 'extensionInstanceId' | 'projectName'>): string {
    const parts = [`op=${rec.operationId}`];
    if (rec.extensionInstanceId) { parts.push(`ext=${rec.extensionInstanceId.slice(0, 8)}`); }
    if (rec.projectName) { parts.push(`project=${rec.projectName}`); }
    return `[${parts.join(' ')}]`;
}
