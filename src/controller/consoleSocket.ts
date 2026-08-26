/**
 * 1402 명령 콘솔 소켓 계층 (vscode 무의존) — GitHub #22.
 *
 * 배경: 종전 `controllerConnection.ts`는 명령마다 `new net.Socket()` → `socket.end()`로 단명 연결을 만들었다.
 * 상태바/트리 폴링·BP 동기화·ErrorLog·Show Break 폴링·디버그 어댑터의 `Show Thread -web` 1 Hz 백업 폴이 전부
 * 이 경로라 1402만 1~3 conn/s(5번째 다운 전 77분간 1,254회)였고, 제어기(G2400C, 16 MB)의 TCP 자원 고갈이
 * 사망 가설 1이다(#22 댓글 2026-08-25 실측). 디버그 어댑터의 1403 스트림·controller-mcp console.js는 이미 영속
 * 연결이므로 일반 명령 경로도 같은 구조로 통일한다(#22 제안 6).
 *
 * 설계:
 *  - 모듈 수준 keep-alive 소켓 1개(키 `ip:port`). 명령은 상위(`enqueueControllerCommand`)에서 직렬화되므로
 *    한 시점에 in-flight 명령은 하나뿐이고, 소켓은 "in-flight(명령이 소유)" ↔ "parked(유휴, 모듈이 보관)"를 오간다.
 *  - 재사용 조건은 엄격하다: 직전 응답이 **버퍼 끝 `</STATUS>`(terminator-first)**로 완료된 경우에만 보관한다.
 *    idle 조기 완료·close 부분 버퍼·TIMEOUT·error로 끝난 응답 뒤에는 소켓을 폐기한다 — 늦게 도착하는 잔류
 *    바이트가 다음 명령 응답 앞에 붙어 프레이밍(`<DATA>`/`<STATUS>` 경계)이 깨지는 것을 막기 위해서다.
 *  - 재사용 소켓에 write가 실패했거나, 0바이트 수신 상태에서 error/close 되면(제어기가 유휴 연결을 먼저 끊었는데
 *    우리가 아직 모르는 경합) 새 연결로 같은 명령을 1회 재시도한다(controller-mcp console.js와 동일).
 *    TIMEOUT은 재시도하지 않는다 — 명령이 이미 제어기에 도달해 실행됐을 수 있어(Start/Step 등) 이중 실행 위험.
 *  - keepAlive=false면 종전과 동일한 단명 연결(connect→write→end)로 동작한다.
 *  - `CommandResponse` 의미(meta 필드, idle/extraIdle/waitForStatusClose, HTTP 교차 응답 감지를 위해 부분 버퍼도
 *    반환하는 규약)는 그대로 유지한다. 새 meta 필드(`socketReused`/`socketKept`)만 추가.
 *  - 트래픽 링버퍼(`recordTrafficLine`/`getRecentTraffic`): GPL Traffic 채널에 찍힌 최종 라인을 상한 600줄로 보관.
 *    연결 유실 사후 스냅샷(#22 제안 4)에서 "마지막 N줄"을 꺼내 쓰기 위한 것.
 */

import * as net from 'net';

export type TrafficDirection = '>>>' | '<<<' | '---' | ' | ';
export type TrafficLogger = (direction: TrafficDirection, message: string) => void;

export interface ConsoleEndpoint {
    ip: string;
    port: number;
    preferIPv4: boolean;
}

export interface ConsoleSendOptions {
    /** 하드 타임아웃(연결 시간 포함). 만료 시 소켓 destroy + reject. */
    timeoutMs: number;
    /** 최소 바이트 수신 후 이 시간 동안 침묵하면 조기 완료(waitForStatusClose=false일 때). */
    idleMs: number;
    minResponseBytes: number;
    extraIdleMsOnIncomplete: number;
    waitForStatusClose: boolean;
    /** true면 깨끗하게 끝난 응답 뒤 소켓을 보관해 다음 명령에 재사용. false면 종전 단명 연결. */
    keepAlive: boolean;
    /** 보관 소켓을 닫기까지의 유휴 시간(ms). */
    keepAliveIdleCloseMs: number;
}

/** 응답 본문 실시간 표시용 sink(trafficResponseBody.ResponseBodyStreamer 호환). flush는 멱등이어야 한다. */
export interface ResponseBodySink {
    push(chunk: string): void;
    flush(): unknown;
}

export interface ConsoleSendHooks {
    log: TrafficLogger;
    body?: ResponseBodySink | null;
}

export interface CommandResponseMeta {
    responseComplete: boolean;
    bytesReceived: number;
    lastChunkAt: string;
    idleTimeoutMs: number;
    statusTagReceived: boolean;
    dataTagClosed: boolean;
    extraIdleApplied: boolean;
    durationMs: number;
    /** 이 명령이 보관 중이던 keep-alive 소켓을 재사용했는지 (#22). */
    socketReused: boolean;
    /** 응답 뒤 소켓을 다음 명령용으로 보관했는지 (#22). false면 폐기(단명 모드/미완결/타임아웃/에러/연결 해제). */
    socketKept: boolean;
}

export interface CommandResponse {
    raw: string;
    meta: CommandResponseMeta;
}

export interface ConnectionStats {
    /** 프로세스 누적 TCP connect 시도 수 (CONNECT #n 의 n). */
    connects: number;
    /** 보관 소켓 재사용 횟수. */
    reuses: number;
    /** stale 소켓 감지 후 새 연결로 재시도한 횟수. */
    retries: number;
    /** 마지막 connect 시도 시각(epoch ms). */
    lastConnectAt?: number;
    /** 지금 유휴 keep-alive 소켓을 보관 중인지. */
    keepAliveActive: boolean;
    /** 보관 중인 소켓이 연결된 시각(epoch ms). keepAliveActive=false면 undefined. */
    heldSinceMs?: number;
}

/** keep-alive 소켓의 TCP 레벨 keepalive 프로브 간격(1403 스트림은 5 s — 명령 포트는 덜 공격적으로). */
const TCP_KEEPALIVE_PROBE_MS = 10_000;
/** 우리가 FIN을 보낸 뒤 제어기가 FIN을 돌려주지 않을 때 강제 정리까지 기다리는 시간(종전 단명 경로와 동일). */
const FIN_WAIT_FORCE_CLOSE_MS = 1000;

// ── 순수 헬퍼 ──────────────────────────────────────────────────────────────

/**
 * 응답이 종결자 `</STATUS>`로 "깨끗하게" 끝났는지(버퍼 끝 기준, 뒤따르는 공백/개행 허용).
 * includes() 판정은 DATA 본문에 STATUS 텍스트가 담긴 응답(로그/파일 덤프 등)에서 본문 중간을 종결로 오인할 수
 * 있어 버퍼 끝 기준으로 판정한다. 소켓 재사용 여부도 이 판정 하나로 결정된다.
 */
export function isCleanlyTerminated(raw: string): boolean {
    return /<\/STATUS>\s*$/.test(raw);
}

/** 로그용 초 표기: 30000 → `30s`, 1500 → `1.5s`. */
export function formatSeconds(ms: number): string {
    return ms % 1000 === 0 ? `${ms / 1000}s` : `${(ms / 1000).toFixed(1)}s`;
}

/** 고정 상한 줄 버퍼(오래된 줄부터 버림). */
export class LineRingBuffer {
    private lines: string[] = [];

    constructor(readonly capacity: number) {
        if (!Number.isInteger(capacity) || capacity <= 0) {
            throw new Error(`LineRingBuffer: capacity must be a positive integer (got ${capacity})`);
        }
    }

    push(line: string): void {
        this.lines.push(line);
        if (this.lines.length > this.capacity) {
            this.lines.splice(0, this.lines.length - this.capacity);
        }
    }

    /** 최근 maxLines줄(오래된 것 → 새 것 순서)의 복사본. */
    recent(maxLines: number): string[] {
        const n = Math.max(0, Math.floor(maxLines));
        return n >= this.lines.length ? this.lines.slice() : this.lines.slice(this.lines.length - n);
    }

    get length(): number {
        return this.lines.length;
    }

    clear(): void {
        this.lines = [];
    }
}

// ── 트래픽 링버퍼 ──────────────────────────────────────────────────────────

export const TRAFFIC_RING_CAPACITY = 600;
const _trafficRing = new LineRingBuffer(TRAFFIC_RING_CAPACITY);

/**
 * GPL Traffic 채널에 찍힌 최종 라인(타임스탬프 포함)을 링버퍼에 넣는다.
 * 1402 로거(controllerConnection.logTraffic)가 자동으로 넣고, 1403(runtimeConsole) 등 다른 로거도 자기 라인을
 * 여기에 밀어 넣으면 사후 스냅샷에 함께 남는다.
 */
export function recordTrafficLine(line: string): void {
    _trafficRing.push(line);
}

/** 최근 트래픽 라인(기본 300줄, 상한 600줄) — 연결 유실 사후 스냅샷용. */
export function getRecentTraffic(maxLines = 300): string[] {
    return _trafficRing.recent(maxLines);
}

// ── keep-alive 소켓 보관 ───────────────────────────────────────────────────

interface HeldSocket {
    socket: net.Socket;
    key: string;
    connectedAt: number;
    log: TrafficLogger;
    idleTimer: ReturnType<typeof setTimeout> | null;
    onData: (chunk: Buffer) => void;
    onClose: () => void;
    onError: (err: Error) => void;
}

let _held: HeldSocket | null = null;
/** closeControllerConnection()마다 증가. in-flight 명령이 완료 시 세대가 바뀌어 있으면 소켓을 보관하지 않는다. */
let _generation = 0;
const _stats = { connects: 0, reuses: 0, retries: 0, lastConnectAt: undefined as number | undefined };

function endpointKey(e: ConsoleEndpoint): string {
    return `${e.ip}:${e.port}`;
}

function heldFor(h: HeldSocket): string {
    return `${Math.round((Date.now() - h.connectedAt) / 1000)}s`;
}

function isReusable(s: net.Socket): boolean {
    return !s.destroyed && s.readyState === 'open';
}

/** FIN 우선(RST 방지 — runtimeConsole·종전 단명 경로와 같은 정책). 제어기가 FIN을 안 돌려주면 1 s 뒤 강제 정리. */
function endGracefully(socket: net.Socket): void {
    socket.on('error', () => { /* 폐기 중 에러 무시 */ });
    try { socket.end(); } catch { /* noop */ }
    const t = setTimeout(() => { if (!socket.destroyed) { socket.destroy(); } }, FIN_WAIT_FORCE_CLOSE_MS);
    t.unref();
}

function dropHeld(reason: string, immediate = false): void {
    const h = _held;
    if (!h) { return; }
    _held = null;
    if (h.idleTimer) { clearTimeout(h.idleTimer); h.idleTimer = null; }
    h.socket.removeListener('data', h.onData);
    h.socket.removeListener('close', h.onClose);
    h.socket.removeListener('error', h.onError);
    h.log('---', `1402 CLOSE (${reason})`);
    if (immediate) {
        h.socket.on('error', () => { /* 폐기 중 에러 무시 */ });
        h.socket.destroy();
    } else {
        endGracefully(h.socket);
    }
}

/** 명령이 끝난 소켓을 유휴 보관: 예기치 않은 바이트 감시 + 상대측 종료 감지 + idle 타이머. */
function parkSocket(socket: net.Socket, key: string, connectedAt: number, idleCloseMs: number, log: TrafficLogger): void {
    if (_held) { dropHeld('replaced'); }
    const held: HeldSocket = {
        socket, key, connectedAt, log, idleTimer: null,
        onData: () => { /* 아래에서 교체 */ },
        onClose: () => { /* 아래에서 교체 */ },
        onError: () => { /* 아래에서 교체 */ },
    };
    held.onData = (chunk: Buffer) => {
        // 종결자 `</STATUS>` 뒤의 `\r\n`이 chunk 경계에서 갈라져 늦게 오는 경우는 프레이밍에 무해하므로(다음 응답
        // raw는 trim 된다) 소켓을 유지한다. 그 외 바이트는 정체 불명 → 다음 응답을 오염시킬 수 있어 폐기.
        const text = chunk.toString('ascii').replace(/\0/g, '');
        if (text.trim() === '') {
            log('---', `1402 idle socket: ${chunk.length} bytes of trailing whitespace — ignored`);
            return;
        }
        log('---', `1402 unexpected data on idle socket (${chunk.length} bytes) — drop`);
        dropHeld('unexpected-data', true);
    };
    held.onClose = () => {
        if (_held !== held) { return; }
        _held = null;
        if (held.idleTimer) { clearTimeout(held.idleTimer); held.idleTimer = null; }
        log('---', `1402 CLOSE (by peer, held ${heldFor(held)})`);
    };
    held.onError = (err: Error) => {
        if (_held !== held) { return; }
        _held = null;
        if (held.idleTimer) { clearTimeout(held.idleTimer); held.idleTimer = null; }
        log('---', `1402 CLOSE (error: ${err.message}, held ${heldFor(held)})`);
    };
    socket.on('data', held.onData);
    socket.on('close', held.onClose);
    socket.on('error', held.onError);
    held.idleTimer = setTimeout(() => dropHeld(`idle ${formatSeconds(idleCloseMs)}`), idleCloseMs);
    held.idleTimer.unref();
    // 유휴 소켓이 프로세스(테스트 러너 등)를 붙잡지 않도록. 재사용 시 ref() 복원.
    socket.unref();
    _held = held;
}

function takeHeld(): HeldSocket {
    const h = _held as HeldSocket;
    _held = null;
    if (h.idleTimer) { clearTimeout(h.idleTimer); h.idleTimer = null; }
    h.socket.removeListener('data', h.onData);
    h.socket.removeListener('close', h.onClose);
    h.socket.removeListener('error', h.onError);
    h.socket.ref();
    return h;
}

/**
 * 보관 중인 keep-alive 소켓을 폐기한다(연결 해제·연결 유실·deactivate 시 호출).
 * in-flight 명령은 중단하지 않되, 그 명령이 끝나면 소켓을 보관하지 않고 닫는다.
 */
export function closeControllerConnection(reason = 'disconnect'): void {
    _generation++;
    dropHeld(reason);
}

export function getConnectionStats(): ConnectionStats {
    return {
        connects: _stats.connects,
        reuses: _stats.reuses,
        retries: _stats.retries,
        lastConnectAt: _stats.lastConnectAt,
        keepAliveActive: _held !== null,
        heldSinceMs: _held ? _held.connectedAt : undefined,
    };
}

// ── 명령 송수신 ────────────────────────────────────────────────────────────

/**
 * 한 줄 명령을 보내고 응답(raw + meta)을 돌려준다. 호출자는 직렬화를 보장해야 한다(동시 호출 금지 — 1402는
 * 단일 명령 스트림이고, 보관 소켓도 하나뿐이다).
 */
export function sendConsoleCommand(
    command: string,
    endpoint: ConsoleEndpoint,
    options: ConsoleSendOptions,
    hooks: ConsoleSendHooks,
): Promise<CommandResponse> {
    return attempt(command, endpoint, options, hooks, false);
}

function attempt(
    command: string,
    endpoint: ConsoleEndpoint,
    opts: ConsoleSendOptions,
    hooks: ConsoleSendHooks,
    forceFresh: boolean,
): Promise<CommandResponse> {
    return new Promise<CommandResponse>((resolve, reject) => {
        const key = endpointKey(endpoint);
        const generation = _generation;
        const log = hooks.log;
        const body = hooks.body ?? null;

        // ── 소켓 확보: 보관 소켓 재사용 또는 새 연결 ──
        if (_held && (!opts.keepAlive || _held.key !== key)) {
            dropHeld(opts.keepAlive ? 'endpoint changed' : 'keep-alive disabled');
        }
        let socket: net.Socket;
        let connectedAt: number;
        let reused = false;
        if (opts.keepAlive && !forceFresh && _held && isReusable(_held.socket)) {
            const h = takeHeld();
            socket = h.socket;
            connectedAt = h.connectedAt;
            reused = true;
            _stats.reuses++;
        } else {
            if (_held) { dropHeld('not reusable', true); }
            socket = new net.Socket();
            connectedAt = Date.now();
            _stats.connects++;
            _stats.lastConnectAt = connectedAt;
            log('---', `1402 CONNECT #${_stats.connects} ${key} (${opts.keepAlive ? 'keep-alive' : 'single-shot'})`);
        }

        // ── 응답 누적 수신: <STATUS> 찾을 때까지 기다리되, 최소 바이트 수 && idle 조건으로도 완성 응답으로 판단 ──
        const { timeoutMs: timeout, idleMs, minResponseBytes, extraIdleMsOnIncomplete, waitForStatusClose } = opts;
        let responseBuffer = '';
        let settled = false;
        let kept = false;
        /** 이 소켓이 닫히는 이유(우리가 닫기 시작한 쪽이 기록). 'close' 이벤트에서 `--- 1402 CLOSE (reason)` 한 줄로 남긴다. */
        let closeReason: string | null = null;
        let gracefulCloseTimer: ReturnType<typeof setTimeout> | null = null;
        let idleTimer: ReturnType<typeof setTimeout> | null = null;
        const startMs = Date.now();
        let lastChunkAtMs = startMs;
        let extraIdleApplied = false;

        const buildMeta = (): CommandResponseMeta => {
            const raw = responseBuffer || '';
            const statusTagReceived = raw.includes('</STATUS>');
            const dataTagClosed = raw.includes('</DATA>');
            return {
                // 하드 규칙 2: 완전한 응답은 종결자 </STATUS> 수신으로만 판정한다.
                // (</DATA>만 닫힌 응답은 STATUS 누락 — idle/close 완료 경로에서 잘렸을 수 있음)
                responseComplete: statusTagReceived,
                bytesReceived: Buffer.byteLength(raw, 'utf8'),
                lastChunkAt: new Date(lastChunkAtMs).toISOString(),
                idleTimeoutMs: idleMs,
                statusTagReceived,
                dataTagClosed,
                extraIdleApplied,
                durationMs: Date.now() - startMs,
                socketReused: reused,
                socketKept: kept,
            };
        };

        const clearIdle = () => { if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; } };
        const clearGraceful = () => { if (gracefulCloseTimer) { clearTimeout(gracefulCloseTimer); gracefulCloseTimer = null; } };
        const detach = () => {
            socket.removeListener('data', onData);
            socket.removeListener('error', onError);
            socket.removeListener('close', onClose);
        };

        /** 소켓을 이 명령으로 끝내고 닫는다(FIN). 제어기가 FIN을 안 보내 half-open으로 남으면 1 s 뒤 강제 정리. */
        const releaseSocket = (reason: string) => {
            closeReason = reason;
            gracefulCloseTimer = setTimeout(() => {
                gracefulCloseTimer = null;
                log('---', `FIN wait over (${key}) after STATUS for ${command} — force close`);
                if (!socket.destroyed) { socket.destroy(); }
            }, FIN_WAIT_FORCE_CLOSE_MS);
            socket.end();
        };

        log('>>>', `${endpoint.ip}:${endpoint.port}  ${command}`);

        const timer = setTimeout(() => {
            if (settled) { return; }
            settled = true;
            clearIdle();
            // 응답 미완 상태 — 잔류 바이트가 언제 올지 모르므로 재사용 금지, 즉시 폐기.
            closeReason = 'timeout';
            socket.destroy();
            body?.flush();
            log('---', `TIMEOUT (${timeout}ms): ${command}`);
            reject(new Error(`Command timeout (${timeout}ms): ${command}`));
        }, timeout);

        const completeResponse = () => {
            if (settled) { return; }
            settled = true;
            clearTimeout(timer);
            clearIdle();

            const elapsed = Date.now() - startMs;
            // DATA 본문에 STATUS 텍스트가 포함될 수 있어 마지막 STATUS 블록을 채택한다(로그 라벨용).
            const statusMatches = [...responseBuffer.matchAll(/<STATUS>\s*(-?\d+)(?:,\s*"([^"]*)")?/g)];
            const statusMatch = statusMatches.length ? statusMatches[statusMatches.length - 1] : null;
            const statusStr = statusMatch ? `STATUS ${statusMatch[1]}` : 'OK';
            const lines = responseBuffer.split(/\r?\n/).filter(l => l.trim() && !l.includes('<STATUS>') && !l.includes('</STATUS>') && !l.includes('<DATA>') && !l.includes('</DATA>')).length;
            body?.flush();
            log('<<<', `${statusStr}  ${lines} lines  ${elapsed}ms`);

            // 재사용 판정(엄격): terminator-first 완료 && keep-alive on && 그 사이 closeControllerConnection() 없음.
            // idle 조기 완료(STATUS 없음/버퍼 끝이 STATUS가 아님)면 잔류 바이트가 뒤따를 수 있어 반드시 폐기한다.
            const clean = isCleanlyTerminated(responseBuffer);
            if (opts.keepAlive && clean && generation === _generation) {
                detach();
                parkSocket(socket, key, connectedAt, opts.keepAliveIdleCloseMs, log);
                kept = true;
            } else if (opts.keepAlive) {
                releaseSocket(clean ? 'disconnect' : 'incomplete-response');
            } else {
                releaseSocket('single-shot');
            }
            resolve({ raw: responseBuffer.trim(), meta: buildMeta() });
        };

        /** 재사용 소켓이 죽어 있었다(0바이트 수신 상태에서 write 실패/error/close) → 새 연결로 같은 명령 1회 재시도. */
        const canRetryStale = () => reused && !settled && responseBuffer.length === 0;
        const retryStale = (why: string) => {
            settled = true;
            clearTimeout(timer);
            clearIdle();
            detach();
            socket.on('error', () => { /* 폐기 중 에러 무시 */ });
            socket.destroy();
            _stats.retries++;
            log('---', `1402 CLOSE (stale-retry: ${why})`);
            log('---', `1402 stale keep-alive socket — retrying once on a fresh connection: ${command}`);
            resolve(attempt(command, endpoint, opts, hooks, true));
        };

        const onData = (data: Buffer) => {
            lastChunkAtMs = Date.now();
            const text = data.toString('ascii').replace(/\0/g, '');
            responseBuffer += text;
            body?.push(text);

            clearIdle();

            // 완성 응답 조건 1(terminator-first): 종결자 </STATUS>가 버퍼 끝에 도달.
            if (isCleanlyTerminated(responseBuffer)) {
                completeResponse();
                return;
            }

            // 완성 응답 조건 2: 최소 바이트 수 && idle 대기 (부분 수신으로 인한 "무응답" 오해 방지)
            // waitForStatusClose면 idle 조기 완료를 끄고 오직 </STATUS>/소켓 종료/하드 타임아웃으로만 완료한다.
            // idle로 완료된 STATUS 없는 응답은 meta.responseComplete=false로 표시된다(하드 규칙 2, B4).
            if (!waitForStatusClose && responseBuffer.length >= minResponseBytes) {
                idleTimer = setTimeout(() => {
                    if (!responseBuffer.includes('</STATUS>') && extraIdleMsOnIncomplete > 0 && !extraIdleApplied) {
                        extraIdleApplied = true;
                        idleTimer = setTimeout(() => { if (!settled) { completeResponse(); } }, extraIdleMsOnIncomplete);
                        return;
                    }
                    if (!settled) { completeResponse(); }
                }, idleMs);
            }
        };

        const onError = (err: Error) => {
            clearGraceful();
            clearIdle();
            if (settled) {
                if (!closeReason) { closeReason = `error: ${err.message}`; }
                return;
            }
            if (canRetryStale()) { retryStale(err.message); return; }
            settled = true;
            clearTimeout(timer);
            closeReason = `error: ${err.message}`;
            body?.flush();
            log('---', `ERROR: ${err.message}`);
            reject(new Error(`Connection error (${endpoint.ip}:${endpoint.port}): ${err.message}`));
        };

        const onClose = () => {
            clearGraceful();
            clearIdle();
            if (!settled) {
                if (canRetryStale()) { retryStale('closed with no response'); return; }
                settled = true;
                clearTimeout(timer);
                body?.flush();
                if (responseBuffer.length > 0) {
                    const elapsed = Date.now() - startMs;
                    // 부분 버퍼도 반환은 한다(HTTP 교차 응답 감지 등 raw 소비자 유지).
                    // 단 meta.responseComplete=false로 표시되어 호출자가 절단 응답을 성공으로 오독하지 않는다(B5).
                    const hasStatusClose = responseBuffer.includes('</STATUS>');
                    log('<<<', `(closed${hasStatusClose ? '' : ', INCOMPLETE — no </STATUS>'}) ${responseBuffer.length} bytes  ${elapsed}ms`);
                    log('---', `1402 CLOSE (${closeReason ?? 'by peer'})`);
                    resolve({ raw: responseBuffer.trim(), meta: buildMeta() });
                } else {
                    log('---', `CLOSED without response: ${command}`);
                    log('---', `1402 CLOSE (${closeReason ?? 'by peer'})`);
                    reject(new Error(`Connection closed without response: ${command}`));
                }
                return;
            }
            log('---', `1402 CLOSE (${closeReason ?? 'by peer'})`);
        };

        const writeCommand = () => {
            const payload = Buffer.from(command + '\r\n', 'ascii');
            try {
                socket.write(payload, (err?: Error | null) => {
                    if (!err || settled) { return; }
                    if (canRetryStale()) { retryStale(`write failed: ${err.message}`); }
                    else { onError(err); }
                });
            } catch (err) {
                if (canRetryStale()) { retryStale(`write threw: ${(err as Error).message}`); }
                else { onError(err as Error); }
            }
        };

        socket.on('data', onData);
        socket.on('error', onError);
        socket.on('close', onClose);

        if (reused) {
            writeCommand();
            return;
        }
        const connectOptions: net.TcpSocketConnectOpts = endpoint.preferIPv4
            ? { host: endpoint.ip, port: endpoint.port, family: 4 }
            : { host: endpoint.ip, port: endpoint.port };
        socket.connect(connectOptions, () => {
            // 요청-응답형 짧은 명령이므로 Nagle을 꺼서 command 전송 지연(및 delayed-ACK 상호작용)을 줄인다.
            // 1403 스트림 소켓과 동일한 정책.
            socket.setNoDelay(true);
            if (opts.keepAlive) {
                // 유휴 보관 중 상대가 소리 없이 사라진 경우(제어기 다운·케이블)를 OS 레벨에서 감지해 stale 소켓을 정리.
                socket.setKeepAlive(true, TCP_KEEPALIVE_PROBE_MS);
            }
            writeCommand();
        });
    });
}
