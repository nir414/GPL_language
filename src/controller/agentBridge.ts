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
 * 파일 계약(MCP `controller-mcp/src/extensionBridge.js`와 동일하게 유지할 것):
 *   presence : <dir>/<ip>.extension.json   { version, pid, extensionVersion, ip, port, connected, debugSessionActive,
 *                                            since, heartbeat, bridge:{ enabled, reqDir, resDir } }
 *              stale = (pid 죽음) || now - heartbeat > PRESENCE_STALE_MS
 *   요청     : <dir>/bridge/<ip>/req/<id>.json  { version, id, command, args?, createdAt, from?, timeoutMs? }
 *   응답     : <dir>/bridge/<ip>/res/<id>.json  { version, id, ok, result?|error+detail?, code?, startedAt, finishedAt, extensionVersion }
 *
 * 신뢰 경계: 같은 사용자의 임시 디렉터리(배포 잠금과 동일 수준). 실행 대상은 `gpl.*` 명령으로 한정한다 —
 * 임의 VS Code 명령의 프록시가 되지 않게 하는 범위 한정이며, 제어기 안전 조건은 명령 정책이 별도로 담당한다(접근 제한이 아님).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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
    | 'stale-request' | 'command-failed' | 'bridge-disabled';

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
    const createdAt = typeof r.createdAt === 'number' && Number.isFinite(r.createdAt) ? r.createdAt : now;
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
    private readonly now: () => number;
    private readonly pid: number;
    private watcher: fs.FSWatcher | undefined;
    private scanTimer: ReturnType<typeof setInterval> | undefined;
    private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    private draining = false;
    private since = 0;
    private connected = false;
    private debugSessionActive = false;
    private started = false;

    constructor(private readonly env: AgentBridgeEnv) {
        this.dir = env.dir ?? agentBridgeRootDir();
        const dirs = bridgeDirs(env.ip, this.dir);
        this.reqDir = dirs.reqDir;
        this.resDir = dirs.resDir;
        this.now = env.now ?? Date.now;
        this.pid = env.pid ?? process.pid;
    }

    get requestDir(): string { return this.reqDir; }
    get responseDir(): string { return this.resDir; }
    get presencePath(): string { return presenceFilePath(this.env.ip, this.dir); }
    get isRunning(): boolean { return this.started; }

    start(): void {
        if (this.started) { return; }
        this.started = true;
        this.since = this.now();
        fs.mkdirSync(this.reqDir, { recursive: true });
        fs.mkdirSync(this.resDir, { recursive: true });
        this.sweepResponses();
        this.writePresence();

        try {
            this.watcher = fs.watch(this.reqDir, { persistent: false }, () => { void this.drain(); });
            this.watcher.on('error', () => { /* 스캔 폴백이 있으므로 무시 */ });
        } catch {
            // fs.watch 미지원 환경(일부 네트워크 드라이브) — 스캔만으로 동작한다.
        }
        const scanMs = this.env.scanIntervalMs ?? SCAN_INTERVAL_MS;
        if (scanMs > 0) {
            this.scanTimer = setInterval(() => { void this.drain(); }, scanMs);
            this.scanTimer.unref?.();
        }
        const hbMs = this.env.heartbeatIntervalMs ?? PRESENCE_HEARTBEAT_MS;
        if (hbMs > 0) {
            this.heartbeatTimer = setInterval(() => this.writePresence(), hbMs);
            this.heartbeatTimer.unref?.();
        }
        this.env.log?.(`[Bridge] 시작 — 요청 ${this.reqDir}`);
        void this.drain();
    }

    stop(): void {
        if (!this.started) { return; }
        this.started = false;
        try { this.watcher?.close(); } catch { /* noop */ }
        this.watcher = undefined;
        if (this.scanTimer) { clearInterval(this.scanTimer); this.scanTimer = undefined; }
        if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = undefined; }
        try { fs.unlinkSync(this.presencePath); } catch { /* noop */ }
        this.env.log?.('[Bridge] 중지');
    }

    /** 연결/디버그 상태를 presence 에 반영한다(외부 AI가 "확장이 지금 연결돼 있는지"를 알 수 있게). */
    setState(state: { connected?: boolean; debugSessionActive?: boolean }): void {
        if (state.connected !== undefined) { this.connected = state.connected; }
        if (state.debugSessionActive !== undefined) { this.debugSessionActive = state.debugSessionActive; }
        if (this.started) { this.writePresence(); }
    }

    writePresence(): void {
        const record: BridgePresence = {
            version: AGENT_BRIDGE_VERSION,
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
        };
        try {
            fs.mkdirSync(this.dir, { recursive: true });
            writeFileAtomic(this.presencePath, JSON.stringify(record));
        } catch { /* presence 실패는 치명적이지 않다 */ }
    }

    /** 요청 디렉터리를 한 번 훑어 순차 처리한다. 중복 실행되지 않는다. */
    async drain(): Promise<void> {
        if (this.draining || !this.started) { return; }
        this.draining = true;
        try {
            for (;;) {
                let names: string[];
                try {
                    names = fs.readdirSync(this.reqDir).filter(n => n.endsWith('.json')).sort();
                } catch {
                    return;
                }
                if (names.length === 0) { return; }
                for (const name of names) {
                    await this.processFile(name);
                }
                // 처리 중 새로 들어온 요청이 있으면 이어서 처리(위 for 이후 다시 목록을 읽는다).
                try {
                    if (fs.readdirSync(this.reqDir).filter(n => n.endsWith('.json')).length === 0) { return; }
                } catch {
                    return;
                }
            }
        } finally {
            this.draining = false;
        }
    }

    private async processFile(name: string): Promise<void> {
        const file = path.join(this.reqDir, name);
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
            this.writeResponse({ version: AGENT_BRIDGE_VERSION, id: fileId, ok: false, error: 'invalid-request', detail: `JSON 파싱 실패: ${(err as Error).message}`, startedAt, finishedAt: this.now() });
            return;
        }
        const check = validateBridgeRequest(parsed, fileId, this.now());
        if (!check.ok) {
            this.env.log?.(`[Bridge] 거부 ${fileId}: ${check.error} — ${check.detail}`);
            this.writeResponse({ version: AGENT_BRIDGE_VERSION, id: fileId, ok: false, error: check.error, detail: check.detail, startedAt, finishedAt: this.now() });
            return;
        }
        const req = check.request;
        if (this.env.isKnownCommand) {
            const known = await this.env.isKnownCommand(req.command);
            if (!known) {
                this.writeResponse({ version: AGENT_BRIDGE_VERSION, id: fileId, ok: false, error: 'unknown-command', detail: `'${req.command}' 명령이 등록돼 있지 않음`, startedAt, finishedAt: this.now() });
                return;
            }
        }
        this.env.log?.(`[Bridge] 실행 ${req.command}${req.from ? ` (from ${req.from})` : ''}`);
        try {
            const result = await this.env.execute(req.command, req.args);
            // 명령이 `{ ok:false, error }`(AiDebugResult 규약)를 돌려준 경우도 전송은 성공이다 —
            // 브리지의 ok 는 "명령을 실행했다"이고, 도메인 성공/실패는 result 안에 그대로 실어 보낸다.
            const code = typeof (result as { error?: unknown })?.error === 'string' ? (result as { error: string }).error : undefined;
            this.writeResponse({ version: AGENT_BRIDGE_VERSION, id: fileId, ok: true, result, code, startedAt, finishedAt: this.now() });
        } catch (err: any) {
            this.writeResponse({ version: AGENT_BRIDGE_VERSION, id: fileId, ok: false, error: 'command-failed', detail: err?.message ?? String(err), startedAt, finishedAt: this.now() });
        }
    }

    private writeResponse(res: BridgeResponse): void {
        try {
            fs.mkdirSync(this.resDir, { recursive: true });
            writeFileAtomic(path.join(this.resDir, `${res.id}.json`), JSON.stringify({ ...res, extensionVersion: this.env.extensionVersion }));
        } catch (err: any) {
            this.env.log?.(`[Bridge] 응답 쓰기 실패 ${res.id}: ${err?.message ?? err}`);
        }
    }

    /** 가져가지 않은 오래된 응답 정리. */
    private sweepResponses(): void {
        try {
            const cutoff = this.now() - RESPONSE_SWEEP_MS;
            for (const name of fs.readdirSync(this.resDir)) {
                const p = path.join(this.resDir, name);
                try {
                    if (fs.statSync(p).mtimeMs < cutoff) { fs.unlinkSync(p); }
                } catch { /* noop */ }
            }
        } catch { /* noop */ }
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
