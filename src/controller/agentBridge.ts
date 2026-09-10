/**
 * Agent Bridge — 외부 AI 에이전트(특히 `controller-mcp` MCP 서버)가 **이 확장의 명령을 실제로 호출하고 결과를 받는** 통로.
 * vscode 무의존(실행자는 주입) — 단위 테스트: `src/test/agentBridge.test.ts`.
 *
 * 배경(2026-08-28 사용자 지적):
 *  - MCP 서버는 제어기 1402에 **직접 TCP**로 붙는 별도 프로세스다. 확장이 keep-alive 세션을 쥐고 있으면 두 세션이 경쟁하고,
 *    AI는 "제어기는 정상인데 1402를 VS Code가 점유 중"이라는 말만 반복하며 **확장을 통한 테스트를 하지 못했다**.
 *  - URI(`vscode://…`)는 일방향이라 결과를 돌려줄 수 없어 MCP가 쓸 수 없었다(#25-C 브리지는 설계만 있었음).
 *  - 그래서 요청/응답 파일 한 쌍으로 된 최소 IPC를 둔다. 배포 잠금(`deployLock.ts`)이 이미 쓰는
 *    `%TEMP%/gpl-controller/` 파일 계약과 같은 방식이라 새 포트·서버·의존성이 없다.
 *
 * 효과: MCP가 이 브리지로 명령을 보내면 1402 트래픽이 **확장의 단일 직렬 큐/keep-alive 세션**을 그대로 타므로
 *  ① 세션 경쟁이 사라지고 ② 명령 정책(`commandPolicy.ts` R1/R2/R3)이 그대로 적용되고 ③ GPL Traffic/Output에 함께 기록된다.
 *
 * 인스턴스 분리(2026-09-10 개선안 §4·§5) — **왜**: presence 와 큐가 제어기 IP 하나를 네임스페이스로 썼다.
 * 그래서 같은 제어기를 보는 VS Code 창이 둘이면 ① 두 창이 같은 presence 파일을 번갈아 덮어써 MCP 의
 * `extension_status` 가 창을 오갔고 ② **두 창이 같은 요청 디렉터리를 drain 해서 먼저 집은 창이 실행**했다.
 * 다른 워크스페이스의 창이 남의 배포를 수행할 수 있었다는 뜻이다. 이제 각 확장 호스트가 활성화 시
 * `extensionInstanceId`(UUID)를 만들고 presence·큐를 그 아래로 분리한다.
 *
 * 레거시 경로(IP 네임스페이스)는 **리더 인스턴스 하나만** 서비스한다 — 구버전 MCP 사본(globalStorage 에 복사된
 * `gpl-controller-mcp.cjs`)이 그대로 동작하되 경쟁은 사라진다. 리더는 파일에 기록하지 않고 살아 있는 인스턴스
 * presence 들로부터 **계산**한다(`electLeaderInstanceId`) — 양쪽이 같은 규칙으로 같은 답을 낸다.
 *
 * 파일 계약(MCP `controller-mcp/src/extensionBridge.js`와 동일하게 유지할 것):
 *   presence(인스턴스) : <dir>/extensions/<instanceId>.json
 *                        { version, extensionInstanceId, pid, extensionVersion, ip, port, connected,
 *                          debugSessionActive, since, heartbeat, workspace, workspaceFolders,
 *                          bridge:{ enabled, reqDir, resDir } }
 *   presence(레거시)   : <dir>/<ip>.extension.json   — 리더만 쓴다. 내용은 위와 같은 모양.
 *              stale = (pid 죽음) || now - heartbeat > PRESENCE_STALE_MS
 *   요청     : <dir>/bridge/inst/<instanceId>/req/<id>.json  { version, id, command, args?, createdAt, from?, timeoutMs? }
 *              (레거시: <dir>/bridge/<ip>/req/<id>.json — 리더만 처리)
 *   응답     : 같은 큐의 res/<id>.json  { version, id, ok, result?|error+detail?, code?, startedAt, finishedAt, extensionVersion }
 *
 * 신뢰 경계: 같은 사용자의 임시 디렉터리(배포 잠금과 동일 수준). 실행 대상은 `gpl.*` 명령으로 한정한다 —
 * 임의 VS Code 명령의 프록시가 되지 않게 하는 범위 한정이며, 제어기 안전 조건은 명령 정책이 별도로 담당한다(접근 제한이 아님).
 * 예외는 `aiCommandPolicy.ts` 의 AI 차단 목록뿐이다(되돌릴 수 없는 파괴적 명령 — 2026-09-07 사용자 결정).
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findAiBlockedCommand, aiBlockedDetail } from './aiCommandPolicy';

export const AGENT_BRIDGE_VERSION = 1;
/** presence heartbeat 주기 — STALE_MS보다 충분히 짧게. */
export const PRESENCE_HEARTBEAT_MS = 5_000;
/** 이 시간 이상 heartbeat가 갱신되지 않으면 확장이 죽은 것으로 본다. */
export const PRESENCE_STALE_MS = 15_000;
/** 요청에 timeoutMs가 없을 때의 기본 유효 시간 — 이보다 오래된 요청은 실행하지 않고 stale 응답을 쓴다. */
export const DEFAULT_REQUEST_TTL_MS = 60_000;
/** 시작 시 이보다 오래된 응답 파일은 청소한다(가져가지 않은 응답이 쌓이지 않게). */
export const RESPONSE_SWEEP_MS = 300_000;
/** fs.watch 를 놓쳐도 요청이 방치되지 않도록 하는 폴백 스캔 주기. */
export const SCAN_INTERVAL_MS = 300;

/** 이 확장의 명령만 실행한다(임의 VS Code 명령 프록시 방지 — uriDispatch 와 같은 규칙). */
export const BRIDGE_COMMAND_ID_PATTERN = /^gpl\.[A-Za-z0-9_.]+$/;

export const AGENT_BRIDGE_DIR_NAME = 'gpl-controller';

export interface BridgePresence {
    version: number;
    /** 이 확장 호스트(VS Code 창)의 고유 id. 활성화 때 한 번 생성된다(§4). */
    extensionInstanceId?: string;
    pid: number;
    extensionVersion: string;
    ip: string;
    port: number;
    connected: boolean;
    debugSessionActive: boolean;
    since: number;
    heartbeat: number;
    bridge: { enabled: boolean; reqDir: string; resDir: string };
    workspace?: string;
    /** 이 창이 열고 있는 워크스페이스 폴더들 — MCP 가 projectDir 로 인스턴스를 고를 때 쓴다(§6). */
    workspaceFolders?: string[];
}

export interface BridgeRequest {
    version: number;
    id: string;
    command: string;
    args?: unknown;
    createdAt: number;
    from?: string;
    timeoutMs?: number;
}

export type BridgeErrorCode =
    | 'invalid-request' | 'unsupported-command' | 'unknown-command'
    | 'stale-request' | 'command-failed' | 'bridge-disabled'
    /** AI/자동화 경로에서 실행할 수 없는 명령(aiCommandPolicy.ts) — 사람이 UI 에서 직접 실행해야 한다. */
    | 'command-blocked';

export interface BridgeResponse {
    version: number;
    id: string;
    ok: boolean;
    result?: unknown;
    error?: BridgeErrorCode;
    detail?: string;
    /** 명령이 돌려준 도메인 코드(예: 명령 정책의 policy-hold). */
    code?: string;
    startedAt: number;
    finishedAt: number;
    extensionVersion?: string;
}

// ── 경로 ──────────────────────────────────────────────────────────────────

export function agentBridgeRootDir(env: NodeJS.ProcessEnv = process.env): string {
    return env.GPL_LOCK_DIR || path.join(os.tmpdir(), AGENT_BRIDGE_DIR_NAME);
}

/** ip 를 파일명으로 안전하게(배포 잠금 `deployLockFileName` 과 같은 규칙). */
export function sanitizeIpForPath(ip: string): string {
    const safe = String(ip || 'default').trim().replace(/[^A-Za-z0-9._-]/g, '_');
    return safe || 'default';
}

export function presenceFilePath(ip: string, dir = agentBridgeRootDir()): string {
    return path.join(dir, `${sanitizeIpForPath(ip)}.extension.json`);
}

export function bridgeDirs(ip: string, dir = agentBridgeRootDir()): { base: string; reqDir: string; resDir: string } {
    const base = path.join(dir, 'bridge', sanitizeIpForPath(ip));
    return { base, reqDir: path.join(base, 'req'), resDir: path.join(base, 'res') };
}

// ── 인스턴스 네임스페이스(§4·§5) ────────────────────────────────────────────

/** instanceId 를 파일/디렉터리 이름으로 안전하게. 빈 값이면 'unknown'. */
export function sanitizeInstanceId(id: string): string {
    const safe = String(id || '').trim().replace(/[^A-Za-z0-9._-]/g, '_');
    return safe || 'unknown';
}

/** 인스턴스 presence 들이 모여 있는 디렉터리. */
export function instancePresenceDir(dir = agentBridgeRootDir()): string {
    return path.join(dir, 'extensions');
}

export function instancePresenceFilePath(instanceId: string, dir = agentBridgeRootDir()): string {
    return path.join(instancePresenceDir(dir), `${sanitizeInstanceId(instanceId)}.json`);
}

export function instanceBridgeDirs(instanceId: string, dir = agentBridgeRootDir()): { base: string; reqDir: string; resDir: string } {
    const base = path.join(dir, 'bridge', 'inst', sanitizeInstanceId(instanceId));
    return { base, reqDir: path.join(base, 'req'), resDir: path.join(base, 'res') };
}

/** 새 인스턴스 id — 확장 활성화마다 하나. 창을 닫았다 열면 다른 id 가 된다(그것이 의도다). */
export function newExtensionInstanceId(): string {
    try {
        return crypto.randomUUID();
    } catch {
        // randomUUID 가 없는 런타임 폴백 — 충돌만 피하면 되므로 형식은 자유다.
        return `${Date.now().toString(36)}-${process.pid.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }
}

export function isPidAliveDefault(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) { return false; }
    try {
        process.kill(pid, 0);
        return true;
    } catch (err: any) {
        return err?.code === 'EPERM';
    }
}

/**
 * 살아 있는 인스턴스 presence 목록. `ip` 를 주면 그 제어기를 보는 것만 남긴다.
 * 읽기 전용 — stale 파일은 걸러 내기만 하고 지우지 않는다(정리는 소유자 몫).
 */
export function listInstancePresences(
    options: { dir?: string; ip?: string; now?: number; staleMs?: number; pidAlive?: (pid: number) => boolean } = {},
): BridgePresence[] {
    const dir = options.dir ?? agentBridgeRootDir();
    const now = options.now ?? Date.now();
    const staleMs = options.staleMs ?? PRESENCE_STALE_MS;
    const pidAlive = options.pidAlive ?? isPidAliveDefault;
    let names: string[];
    try {
        names = fs.readdirSync(instancePresenceDir(dir)).filter(n => n.endsWith('.json'));
    } catch {
        return [];
    }
    const out: BridgePresence[] = [];
    for (const name of names) {
        let rec: BridgePresence;
        try {
            rec = JSON.parse(fs.readFileSync(path.join(instancePresenceDir(dir), name), 'utf8')) as BridgePresence;
        } catch {
            continue;
        }
        if (!rec || typeof rec !== 'object' || rec.version !== AGENT_BRIDGE_VERSION) { continue; }
        if (typeof rec.extensionInstanceId !== 'string' || !rec.extensionInstanceId) { continue; }
        if (isPresenceStale(rec, now, staleMs)) { continue; }
        if (typeof rec.pid === 'number' && rec.pid > 0 && !pidAlive(rec.pid)) { continue; }
        if (options.ip && rec.ip !== options.ip) { continue; }
        out.push(rec);
    }
    return out;
}

/**
 * 레거시(IP 네임스페이스) 큐·presence 를 맡을 인스턴스를 고른다 — **가장 먼저 뜬 인스턴스**, 동률이면 id 순.
 * 파일에 기록하지 않고 계산으로 정하므로 확장과 MCP 가 같은 답을 낸다. 후보가 없으면 undefined.
 */
export function electLeaderInstanceId(presences: readonly BridgePresence[]): string | undefined {
    const live = presences.filter(p => p.bridge?.enabled && typeof p.extensionInstanceId === 'string');
    if (live.length === 0) { return undefined; }
    let best = live[0];
    for (const p of live.slice(1)) {
        if (p.since < best.since || (p.since === best.since && String(p.extensionInstanceId) < String(best.extensionInstanceId))) {
            best = p;
        }
    }
    return best.extensionInstanceId;
}

// ── 순수 판정 ─────────────────────────────────────────────────────────────

export function isPresenceStale(p: Pick<BridgePresence, 'heartbeat'>, now: number, staleMs = PRESENCE_STALE_MS): boolean {
    return !Number.isFinite(p?.heartbeat) || now - p.heartbeat > staleMs;
}

/**
 * 요청 파일 내용 검증. 실행 가능하면 request 를, 아니면 사유를 돌려준다.
 * (id 는 파일명에서 오므로 본문 id 와 다르면 거부 — 응답 경로가 어긋나는 것을 막는다.)
 */
export function validateBridgeRequest(raw: unknown, fileId: string, now: number): { ok: true; request: BridgeRequest } | { ok: false; error: BridgeErrorCode; detail: string } {
    const r = raw as Partial<BridgeRequest> | null;
    if (!r || typeof r !== 'object') {
        return { ok: false, error: 'invalid-request', detail: '요청 본문이 객체가 아님' };
    }
    if (r.version !== AGENT_BRIDGE_VERSION) {
        return { ok: false, error: 'invalid-request', detail: `지원하지 않는 version ${String(r.version)} (기대 ${AGENT_BRIDGE_VERSION})` };
    }
    if (typeof r.id !== 'string' || r.id !== fileId) {
        return { ok: false, error: 'invalid-request', detail: `id 불일치 (파일 ${fileId} / 본문 ${String(r.id)})` };
    }
    if (typeof r.command !== 'string' || !BRIDGE_COMMAND_ID_PATTERN.test(r.command)) {
        return { ok: false, error: 'unsupported-command', detail: `'${String(r.command)}' — 이 확장의 명령(gpl.*)만 실행할 수 있음` };
    }
    // 브리지는 AI/자동화 전용 통로다 — 되돌릴 수 없는 명령은 여기서 실행하지 않는다(aiCommandPolicy.ts).
    const blocked = findAiBlockedCommand(r.command);
    if (blocked) {
        return { ok: false, error: 'command-blocked', detail: aiBlockedDetail(blocked) };
    }
    const createdAt =typeof r.createdAt === 'number' && Number.isFinite(r.createdAt) ? r.createdAt : now;
    const ttl = typeof r.timeoutMs === 'number' && Number.isFinite(r.timeoutMs) && r.timeoutMs > 0
        ? Math.min(r.timeoutMs, 10 * 60_000)
        : DEFAULT_REQUEST_TTL_MS;
    if (now - createdAt > ttl) {
        return { ok: false, error: 'stale-request', detail: `요청이 ${Math.round((now - createdAt) / 1000)}초 지나 만료됨(TTL ${Math.round(ttl / 1000)}초) — 실행하지 않음` };
    }
    return { ok: true, request: { version: AGENT_BRIDGE_VERSION, id: r.id, command: r.command, args: r.args, createdAt, from: typeof r.from === 'string' ? r.from : undefined, timeoutMs: ttl } };
}

/** 파일명 → 요청 id. `.json` 이 아니거나 안전하지 않은 이름이면 undefined. */
export function requestIdFromFileName(name: string): string | undefined {
    if (!name.endsWith('.json')) { return undefined; }
    const id = name.slice(0, -'.json'.length);
    return /^[A-Za-z0-9._-]{1,128}$/.test(id) ? id : undefined;
}

// ── 서버 ──────────────────────────────────────────────────────────────────

export interface AgentBridgeEnv {
    ip: string;
    port: number;
    extensionVersion: string;
    dir?: string;
    pid?: number;
    now?: () => number;
    workspace?: string;
    /** 이 확장 호스트의 고유 id. 생략하면 새로 만든다 — 호출측이 창 수명 동안 같은 값을 넘기는 것이 좋다. */
    instanceId?: string;
    /** 열려 있는 워크스페이스 폴더 경로들(§6 인스턴스 선택 근거). */
    workspaceFolders?: string[];
    /** 프로세스 생존 확인(테스트 주입점). */
    pidAlive?: (pid: number) => boolean;
    /** 인스턴스 presence 가 이 시간 이상 갱신되지 않으면 죽은 것으로 본다(리더 선출용). */
    staleMs?: number;
    /** `gpl.*` 명령 실행자 — 확장에서는 vscode.commands.executeCommand. */
    execute: (command: string, args: unknown) => Promise<unknown>;
    /** 등록된 명령인지 확인(없으면 unknown-command). 생략하면 검사하지 않는다. */
    isKnownCommand?: (command: string) => Promise<boolean> | boolean;
    log?: (message: string) => void;
    heartbeatIntervalMs?: number;
    scanIntervalMs?: number;
}

/**
 * 요청 디렉터리를 감시하며 `gpl.*` 명령을 실행하고 응답 파일을 쓴다.
 * 요청은 **한 번에 하나씩 순차 처리**한다 — 제어기는 단일 명령 스트림이라는 원칙과 결과 순서 예측 가능성 때문.
 */
export class AgentBridgeServer {
    private readonly dir: string;
    private readonly reqDir: string;
    private readonly resDir: string;
    private readonly legacyReqDir: string;
    private readonly legacyResDir: string;
    private readonly now: () => number;
    private readonly pid: number;
    private readonly pidAlive: (pid: number) => boolean;
    private readonly staleMs: number;
    private watchers: fs.FSWatcher[] = [];
    private scanTimer: ReturnType<typeof setInterval> | undefined;
    private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    private draining = false;
    private since = 0;
    private connected = false;
    private debugSessionActive = false;
    private started = false;
    /** 레거시(IP) 큐·presence 를 맡고 있는가. 매 heartbeat 마다 다시 계산한다. */
    private leader = false;

    /** 이 확장 호스트의 고유 id(§4). */
    readonly instanceId: string;

    constructor(private readonly env: AgentBridgeEnv) {
        this.dir = env.dir ?? agentBridgeRootDir();
        this.instanceId = sanitizeInstanceId(env.instanceId || newExtensionInstanceId());
        const dirs = instanceBridgeDirs(this.instanceId, this.dir);
        this.reqDir = dirs.reqDir;
        this.resDir = dirs.resDir;
        const legacy = bridgeDirs(env.ip, this.dir);
        this.legacyReqDir = legacy.reqDir;
        this.legacyResDir = legacy.resDir;
        this.now = env.now ?? Date.now;
        this.pid = env.pid ?? process.pid;
        this.pidAlive = env.pidAlive ?? isPidAliveDefault;
        this.staleMs = env.staleMs ?? PRESENCE_STALE_MS;
    }

    get requestDir(): string { return this.reqDir; }
    get responseDir(): string { return this.resDir; }
    /** 인스턴스 presence 경로(정본). */
    get presencePath(): string { return instancePresenceFilePath(this.instanceId, this.dir); }
    /** 레거시 presence 경로 — 리더일 때만 쓴다(구버전 MCP 호환). */
    get legacyPresencePath(): string { return presenceFilePath(this.env.ip, this.dir); }
    get legacyRequestDir(): string { return this.legacyReqDir; }
    get isLeader(): boolean { return this.leader; }
    get isRunning(): boolean { return this.started; }

    start(): void {
        if (this.started) { return; }
        this.started = true;
        this.since = this.now();
        for (const d of [this.reqDir, this.resDir, this.legacyReqDir, this.legacyResDir]) {
            fs.mkdirSync(d, { recursive: true });
        }
        this.sweepResponses();
        // presence 를 먼저 써야 리더 선출에서 자기 자신이 후보로 잡힌다.
        this.writePresence();
        this.refreshLeadership();

        for (const d of [this.reqDir, this.legacyReqDir]) {
            try {
                const w = fs.watch(d, { persistent: false }, () => { void this.drain(); });
                w.on('error', () => { /* 스캔 폴백이 있으므로 무시 */ });
                this.watchers.push(w);
            } catch {
                // fs.watch 미지원 환경(일부 네트워크 드라이브) — 스캔만으로 동작한다.
            }
        }
        const scanMs = this.env.scanIntervalMs ?? SCAN_INTERVAL_MS;
        if (scanMs > 0) {
            this.scanTimer = setInterval(() => { void this.drain(); }, scanMs);
            this.scanTimer.unref?.();
        }
        const hbMs = this.env.heartbeatIntervalMs ?? PRESENCE_HEARTBEAT_MS;
        if (hbMs > 0) {
            this.heartbeatTimer = setInterval(() => { this.writePresence(); this.refreshLeadership(); }, hbMs);
            this.heartbeatTimer.unref?.();
        }
        this.env.log?.(`[Bridge] 시작 — 인스턴스 ${this.instanceId} · 요청 ${this.reqDir}${this.leader ? ' (+ 레거시 큐 담당)' : ''}`);
        void this.drain();
    }

    stop(): void {
        if (!this.started) { return; }
        this.started = false;
        for (const w of this.watchers) { try { w.close(); } catch { /* noop */ } }
        this.watchers = [];
        if (this.scanTimer) { clearInterval(this.scanTimer); this.scanTimer = undefined; }
        if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = undefined; }
        try { fs.unlinkSync(this.presencePath); } catch { /* noop */ }
        // 레거시 presence 는 내가 쓴 것일 때만 지운다 — 다른 창이 리더로 올라가 쓴 것을 지우면 안 된다.
        if (this.leader) { this.removeLegacyPresenceIfMine(); }
        this.leader = false;
        this.env.log?.('[Bridge] 중지');
    }

    /**
     * 살아 있는 인스턴스들 중 레거시 큐 담당(리더)이 나인지 다시 계산한다.
     * 리더에서 내려오면 레거시 presence 를 치워 구버전 MCP 가 죽은 창을 붙들지 않게 한다.
     */
    refreshLeadership(): boolean {
        if (!this.started) { return false; }
        const presences = listInstancePresences({ dir: this.dir, ip: this.env.ip, now: this.now(), staleMs: this.staleMs, pidAlive: this.pidAlive });
        const leaderId = electLeaderInstanceId(presences);
        // 아직 아무 presence 도 읽히지 않았으면(첫 tick·읽기 실패) 자기 자신을 리더로 본다 — 단일 창에서 레거시 큐가 죽지 않게.
        const next = leaderId ? leaderId === this.instanceId : true;
        if (next !== this.leader) {
            this.leader = next;
            this.env.log?.(`[Bridge] 레거시 큐 담당 ${next ? '획득' : '해제'} (인스턴스 ${this.instanceId})`);
            if (!next) { this.removeLegacyPresenceIfMine(); }
        }
        if (this.leader) { this.writeLegacyPresence(); }
        return this.leader;
    }

    /** 연결/디버그 상태를 presence 에 반영한다(외부 AI가 "확장이 지금 연결돼 있는지"를 알 수 있게). */
    setState(state: { connected?: boolean; debugSessionActive?: boolean }): void {
        if (state.connected !== undefined) { this.connected = state.connected; }
        if (state.debugSessionActive !== undefined) { this.debugSessionActive = state.debugSessionActive; }
        if (this.started) { this.writePresence(); }
    }

    /** presence 레코드 한 벌 — 인스턴스 파일과 레거시 파일에 같은 내용을 쓴다. */
    private presenceRecord(): BridgePresence {
        return {
            version: AGENT_BRIDGE_VERSION,
            extensionInstanceId: this.instanceId,
            pid: this.pid,
            extensionVersion: this.env.extensionVersion,
            ip: this.env.ip,
            port: this.env.port,
            connected: this.connected,
            debugSessionActive: this.debugSessionActive,
            since: this.since || this.now(),
            heartbeat: this.now(),
            bridge: { enabled: this.started, reqDir: this.reqDir, resDir: this.resDir },
            workspace: this.env.workspace,
            workspaceFolders: this.env.workspaceFolders,
        };
    }

    writePresence(): void {
        try {
            fs.mkdirSync(instancePresenceDir(this.dir), { recursive: true });
            writeFileAtomic(this.presencePath, JSON.stringify(this.presenceRecord()));
        } catch { /* presence 실패는 치명적이지 않다 */ }
    }

    /**
     * 레거시 presence — 구버전 MCP 는 `<ip>.extension.json` 하나만 보므로 리더가 대신 쓴다.
     * 큐 경로는 **레거시 큐**를 가리켜야 그 MCP 가 쓰는 곳과 우리가 읽는 곳이 같아진다.
     */
    private writeLegacyPresence(): void {
        const record: BridgePresence = {
            ...this.presenceRecord(),
            bridge: { enabled: this.started, reqDir: this.legacyReqDir, resDir: this.legacyResDir },
        };
        try {
            fs.mkdirSync(this.dir, { recursive: true });
            writeFileAtomic(this.legacyPresencePath, JSON.stringify(record));
        } catch { /* noop */ }
    }

    /** 레거시 presence 가 내 것일 때만 지운다(다른 창이 리더로 올라가 쓴 것을 지우지 않게). */
    private removeLegacyPresenceIfMine(): void {
        try {
            const rec = JSON.parse(fs.readFileSync(this.legacyPresencePath, 'utf8')) as BridgePresence;
            if (rec?.extensionInstanceId && rec.extensionInstanceId !== this.instanceId) { return; }
            if (!rec?.extensionInstanceId && rec?.pid !== this.pid) { return; }
        } catch {
            return;   // 없거나 못 읽으면 건드리지 않는다
        }
        try { fs.unlinkSync(this.legacyPresencePath); } catch { /* noop */ }
    }

    /** 지금 처리할 큐들 — 자기 인스턴스 큐는 항상, 레거시 큐는 리더일 때만. */
    private queues(): Array<{ reqDir: string; resDir: string; legacy: boolean }> {
        const list = [{ reqDir: this.reqDir, resDir: this.resDir, legacy: false }];
        if (this.leader) { list.push({ reqDir: this.legacyReqDir, resDir: this.legacyResDir, legacy: true }); }
        return list;
    }

    /** 요청 디렉터리를 한 번 훑어 순차 처리한다. 중복 실행되지 않는다. */
    async drain(): Promise<void> {
        if (this.draining || !this.started) { return; }
        this.draining = true;
        try {
            for (;;) {
                let processed = 0;
                for (const q of this.queues()) {
                    let names: string[];
                    try {
                        names = fs.readdirSync(q.reqDir).filter(n => n.endsWith('.json')).sort();
                    } catch {
                        continue;
                    }
                    for (const name of names) {
                        await this.processFile(name, q);
                        processed++;
                    }
                }
                // 처리 중 새로 들어온 요청이 있으면 이어서 처리한다.
                if (processed === 0) { return; }
            }
        } finally {
            this.draining = false;
        }
    }

    private async processFile(name: string, queue: { reqDir: string; resDir: string }): Promise<void> {
        const file = path.join(queue.reqDir, name);
        const startedAt = this.now();
        const fileId = requestIdFromFileName(name);
        if (!fileId) {
            try { fs.unlinkSync(file); } catch { /* noop */ }
            return;
        }
        let text: string;
        try {
            text = fs.readFileSync(file, 'utf8');
        } catch {
            return;   // 이미 사라졌거나 읽을 수 없음
        }
        // 먼저 지운다 — 처리 중 재진입/중복 실행 방지(응답 파일이 결과 채널).
        try { fs.unlinkSync(file); } catch { /* noop */ }

        let parsed: unknown;
        try {
            parsed = JSON.parse(text);
        } catch (err) {
            this.writeResponse(queue.resDir, { version: AGENT_BRIDGE_VERSION, id: fileId, ok: false, error: 'invalid-request', detail: `JSON 파싱 실패: ${(err as Error).message}`, startedAt, finishedAt: this.now() });
            return;
        }
        const check = validateBridgeRequest(parsed, fileId, this.now());
        if (!check.ok) {
            this.env.log?.(`[Bridge] 거부 ${fileId}: ${check.error} — ${check.detail}`);
            this.writeResponse(queue.resDir, { version: AGENT_BRIDGE_VERSION, id: fileId, ok: false, error: check.error, detail: check.detail, startedAt, finishedAt: this.now() });
            return;
        }
        const req = check.request;
        if (this.env.isKnownCommand) {
            const known = await this.env.isKnownCommand(req.command);
            if (!known) {
                this.writeResponse(queue.resDir, { version: AGENT_BRIDGE_VERSION, id: fileId, ok: false, error: 'unknown-command', detail: `'${req.command}' 명령이 등록돼 있지 않음`, startedAt, finishedAt: this.now() });
                return;
            }
        }
        this.env.log?.(`[Bridge] 실행 ${req.command}${req.from ? ` (from ${req.from})` : ''}`);
        try {
            const result = await this.env.execute(req.command, req.args);
            // 명령이 `{ ok:false, error }`(AiDebugResult 규약)를 돌려준 경우도 전송은 성공이다 —
            // 브리지의 ok 는 "명령을 실행했다"이고, 도메인 성공/실패는 result 안에 그대로 실어 보낸다.
            const code = typeof (result as { error?: unknown })?.error === 'string' ? (result as { error: string }).error : undefined;
            this.writeResponse(queue.resDir, { version: AGENT_BRIDGE_VERSION, id: fileId, ok: true, result, code, startedAt, finishedAt: this.now() });
        } catch (err: any) {
            this.writeResponse(queue.resDir, { version: AGENT_BRIDGE_VERSION, id: fileId, ok: false, error: 'command-failed', detail: err?.message ?? String(err), startedAt, finishedAt: this.now() });
        }
    }

    /** 응답은 **요청이 온 큐**의 res 로 쓴다 — 인스턴스 큐와 레거시 큐의 응답이 섞이지 않게. */
    private writeResponse(resDir: string, res: BridgeResponse): void {
        try {
            fs.mkdirSync(resDir, { recursive: true });
            writeFileAtomic(path.join(resDir, `${res.id}.json`), JSON.stringify({ ...res, extensionVersion: this.env.extensionVersion }));
        } catch (err: any) {
            this.env.log?.(`[Bridge] 응답 쓰기 실패 ${res.id}: ${err?.message ?? err}`);
        }
    }

    /** 가져가지 않은 오래된 응답 정리. */
    private sweepResponses(): void {
        const cutoff = this.now() - RESPONSE_SWEEP_MS;
        for (const dir of [this.resDir, this.legacyResDir]) {
            try {
                for (const name of fs.readdirSync(dir)) {
                    const p = path.join(dir, name);
                    try {
                        if (fs.statSync(p).mtimeMs < cutoff) { fs.unlinkSync(p); }
                    } catch { /* noop */ }
                }
            } catch { /* noop */ }
        }
    }
}

/** 임시 파일 + rename — 읽는 쪽이 부분 기록을 보지 않게 한다. */
function writeFileAtomic(file: string, content: string): void {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, content);
    try {
        fs.renameSync(tmp, file);
    } catch {
        // rename 실패(드문 Windows 경합) 시 직접 쓰기로 폴백.
        try { fs.writeFileSync(file, content); } finally { try { fs.unlinkSync(tmp); } catch { /* noop */ } }
    }
}
