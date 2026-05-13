/**
 * 런타임 콘솔 (포트 1403) — 제어기 이벤트 배치 수신.
 * OutputChannel에 파싱된 메시지를 실시간으로 표시한다.
 *
 * 프로토콜 동작 (현재 구현/테스트 기반 가설):
 *   - 연결 → 제어기가 이벤트 큐를 전달 → FIN (정상 종료)
 *   - FIN 후 즉시 재연결 → 다음 이벤트 배치 대기
 *   - 이벤트 없으면 연결 유지 (대기 상태)
 *
 * ⚠ 소켓 종료 시 반드시 socket.end() 사용 (FIN 전송).
 *   socket.destroy()는 RST를 보내며 제어기 내장 TCP 스택이
 *   해당 포트 서비스를 비정상 상태로 전환할 수 있다.
 */

import * as net from 'net';
import * as vscode from 'vscode';
import { getControllerConfig, getTrafficChannel } from './controllerConnection';
import { normalizeConsoleLine } from './responseParser';
import { appendLiveLog } from '../log/liveLogTerminal';

/** FIN+데이터 후 즉시 재연결 대기 (TCP 정리 여유) */
const RECONNECT_IMMEDIATE_MS = 100;
/** 빈 세션 (이벤트 없이 FIN) 후 고정 간격 재연결 */
const RECONNECT_IDLE_MS = 5_000;
/** 에러/빈 세션 시 지수 백오프 설정 */
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;
const RECONNECT_MAX_ATTEMPTS = 10;
/** end() 후 이 시간 동안 close가 늦어질 수 있어 관찰 로그를 남기는 기준 시간 */
const GRACEFUL_CLOSE_TIMEOUT_MS = 3_000;
/** Connected 상태에서 이 시간 동안 데이터가 없으면 idle 힌트 표시 */
const NO_OUTPUT_HINT_MS = 3_000;
/** no-payload 경고 스로틀 기본값 (로그 스팸 방지) */
const DEFAULT_UNSTABLE_WARN_COOLDOWN_MS = 60_000;
/** no-payload 누적 경고 임계치 기본값 */
const DEFAULT_NO_PAYLOAD_WARN_THRESHOLD = 3;
/** empty/immediate 로그 출력 주기 기본값 */
const DEFAULT_EMPTY_NOTICE_EVERY = 5;
/** Immediate EOF 재연결 base/max 기본값 (짧은 블라인드 구간 완화) */
const DEFAULT_IMMEDIATE_EOF_RECONNECT_BASE_MS = 1_000;
const DEFAULT_IMMEDIATE_EOF_RECONNECT_MAX_MS = 5_000;
/** 빈 세션 재연결 base/max 기본값 */
const DEFAULT_IDLE_RECONNECT_BASE_MS = RECONNECT_IDLE_MS;
const DEFAULT_IDLE_RECONNECT_MAX_MS = RECONNECT_MAX_MS;

interface RuntimeConsoleTuning {
    noPayloadWarnThreshold: number;
    unstableWarnCooldownMs: number;
    emptyNoticeEvery: number;
    immediateEofReconnectBaseMs: number;
    immediateEofReconnectMaxMs: number;
    idleReconnectBaseMs: number;
    idleReconnectMaxMs: number;
}

export interface RuntimeConsoleStatusSnapshot {
    connected: boolean;
    reason: string;
    detail?: string;
    noPayloadStreak: number;
    lastChangedAt: number;
}

export class RuntimeConsole implements vscode.Disposable {
    private socket: net.Socket | null = null;
    private output: vscode.OutputChannel;
    private stateOutput: vscode.OutputChannel;
    private _isConnected = false;
    private carry = '';
    private disposed = false;
    /** 사용자가 명시적으로 stop()을 호출했을 때 true → 자동 재연결 금지 */
    private _explicitStop = false;
    private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private _reconnectAttempt = 0;
    private _lastError: Error | null = null;
    private _lastReason = '초기화 전';
    private _lastDetail = '';
    private _lastChangedAt = Date.now();
    /** 연결 성립 시각 — 로깅용 */
    private _connectedAt = 0;
    /** 현재 세션에서 데이터(바이트)를 수신했는지 여부 */
    private _sessionDataReceived = false;
    /** 데이터가 전혀 없을 때 UX 힌트 타이머 */
    private _noOutputHintTimer: ReturnType<typeof setTimeout> | null = null;
    /** stop() 호출 후 graceful close 로그 타이머 */
    private _gracefulStopTimer: ReturnType<typeof setTimeout> | null = null;
    /** 첫 batch를 받기 위한 준비 완료 타이머 */
    private _readyForBatchTimer: ReturnType<typeof setTimeout> | null = null;
    private _readyForBatch = false;
    /** 연속 빈 세션 수 (데이터 없이 FIN) — 로그 노이즈 억제용 */
    private _consecutiveEmptySessions = 0;
    /** 연속 무페이로드 시도 수 (empty batch + connect fail 포함) */
    private _consecutiveNoPayloadAttempts = 0;
    /** 마지막 무페이로드 경고 시각 */
    private _lastUnstableWarnAt = 0;
    private _readyWaiters: Array<(value: boolean) => void> = [];
    private _payloadWaiters: Array<(value: boolean) => void> = [];

    private readonly _onDidConnect = new vscode.EventEmitter<void>();
    private readonly _onDidDisconnect = new vscode.EventEmitter<void>();
    private readonly _onDidReceiveLine = new vscode.EventEmitter<string>();

    readonly onDidConnect = this._onDidConnect.event;
    readonly onDidDisconnect = this._onDidDisconnect.event;
    readonly onDidReceiveLine = this._onDidReceiveLine.event;

    get isConnected(): boolean { return this._isConnected; }

    getStatusSnapshot(): RuntimeConsoleStatusSnapshot {
        return {
            connected: this._isConnected,
            reason: this._isConnected ? 'Connected' : this._lastReason,
            detail: this._lastDetail || undefined,
            noPayloadStreak: this._consecutiveNoPayloadAttempts,
            lastChangedAt: this._lastChangedAt,
        };
    }

    constructor(output: vscode.OutputChannel, stateOutput?: vscode.OutputChannel) {
        this.output = output;
        this.stateOutput = stateOutput ?? output;
    }

    private appendStateLine(line: string): void {
        // 상태 로그는 기본적으로 GPL Console(RT payload)와 분리한다.
        // 필요 시 설정으로만 Output 채널 미러링.
        const traffic = getTrafficChannel();
        if (traffic) {
            traffic.appendLine(line);
        }
        appendLiveLog(line);

        const mirrorToOutput = vscode.workspace
            .getConfiguration('gpl.runtimeConsole')
            .get<boolean>('showStateInOutputChannel', false);
        if (mirrorToOutput) {
            this.stateOutput.appendLine(line);
        }
    }

    async waitForPayload(timeoutMs = 1500): Promise<boolean> {
        if (this._sessionDataReceived) { return true; }
        return await new Promise<boolean>((resolve) => {
            const resolver = (value: boolean) => resolve(value);
            this._payloadWaiters.push(resolver);
            const timeout = setTimeout(() => {
                this._payloadWaiters = this._payloadWaiters.filter(r => r !== resolver);
                resolve(this._sessionDataReceived);
            }, timeoutMs);
            const wrapped = (value: boolean) => {
                clearTimeout(timeout);
                resolver(value);
            };
            this._payloadWaiters[this._payloadWaiters.length - 1] = wrapped;
        });
    }

    async waitUntilReady(timeoutMs = 400): Promise<boolean> {
        if (this._readyForBatch) { return true; }
        return await new Promise<boolean>((resolve) => {
            const resolver = (value: boolean) => resolve(value);
            this._readyWaiters.push(resolver);
            const timeout = setTimeout(() => {
                this._readyWaiters = this._readyWaiters.filter(r => r !== resolver);
                resolve(this._readyForBatch);
            }, timeoutMs);
            const wrapped = (value: boolean) => {
                clearTimeout(timeout);
                resolver(value);
            };
            this._readyWaiters[this._readyWaiters.length - 1] = wrapped;
        });
    }

    /**
     * 콘솔 스트리밍 시작.
     *
     * Idempotent: 이미 연결되었거나, 연결 시도 중(소켓 존재) 또는
     * 재연결 대기 중(_reconnectTimer 활성)이면 아무 것도 하지 않는다.
     * → 여러 진입점(배포 후, attach 시점, 사이드바 클릭 등)에서 안전하게 호출 가능.
     *
     * @param delayMs 연결 시도 전 대기 (이전 소켓 TCP 정리 여유)
     */
    start(delayMs = 0): void {
        if (this.disposed) { return; }
        if (this._isConnected) { return; }
        if (this.socket) { return; }
        this._explicitStop = false;
        this._reconnectAttempt = 0;
        this._consecutiveEmptySessions = 0;
        this._consecutiveNoPayloadAttempts = 0;
        this._lastUnstableWarnAt = 0;
        if (this._reconnectTimer) {
            if (delayMs <= 0) {
                this.cancelReconnect();
                this.logConsoleTraffic('---', 'RECONNECT timer canceled by explicit start()');
                this.connectInternal();
            }
            return;
        }
        if (delayMs > 0) {
            this._reconnectTimer = setTimeout(() => {
                this._reconnectTimer = null;
                this.connectInternal();
            }, delayMs);
        } else {
            this.connectInternal();
        }
    }

    /**
     * 콘솔 스트리밍 중지 (명시적). 자동 재연결도 중단.
     * RST 대신 FIN(graceful close)을 사용하여 제어기 TCP 스택 보호.
     */
    stop(): void {
        this._explicitStop = true;
        this._lastReason = '사용자 중지';
        this._lastDetail = '수동으로 런타임 콘솔 중지';
        this._lastChangedAt = Date.now();
        this.cancelReconnect();
        this.clearReadyState(false);
        this.resolvePayloadWaiters(false);
        if (this._noOutputHintTimer) {
            clearTimeout(this._noOutputHintTimer);
            this._noOutputHintTimer = null;
        }
        if (this._gracefulStopTimer) {
            clearTimeout(this._gracefulStopTimer);
            this._gracefulStopTimer = null;
        }
        if (this.socket) {
            const s = this.socket;
            this.socket = null;
            // 이벤트 리스너 제거 → close 핸들러의 오해 로그 방지
            s.removeAllListeners();
            // 'error' 핸들러를 반드시 다시 등록해야 한다.
            // removeAllListeners 이후 end()/destroy() 중 소켓 에러가 발생하면
            // unhandled 'error' 이벤트가 Node.js 프로세스(=extension host)를 크래시시킨다.
            s.on('error', (err) => {
                this.logConsoleTraffic('---', `STOP error (ignored): ${err.message}`);
            });
            // FIN 기반 종료를 우선한다. (RST 방지)
            // close 이벤트가 늦어질 수 있어 로그만 남기고 강제 destroy는 하지 않는다.
            this._gracefulStopTimer = setTimeout(() => {
                this.logConsoleTraffic('---', `STOP wait over (${GRACEFUL_CLOSE_TIMEOUT_MS}ms), waiting close by FIN path`);
            }, GRACEFUL_CLOSE_TIMEOUT_MS);
            s.end();   // FIN 전송 (graceful close) — error 핸들러 등록 후 호출
            this.logConsoleTraffic('---', 'STOP (graceful FIN)');
        }
        if (this._isConnected) {
            this._isConnected = false;
            this._onDidDisconnect.fire();
        }
    }

    dispose(): void {
        this.disposed = true;
        this.stop();
        this._onDidConnect.dispose();
        this._onDidDisconnect.dispose();
        this._onDidReceiveLine.dispose();
    }

    /** GPL Traffic 채널에 1403 콘솔 트래픽 로깅 */
    private logConsoleTraffic(direction: '>>>' | '<<<' | '---', message: string): void {
        const now = new Date();
        const ts = now.toLocaleTimeString('ko-KR', { hour12: false }) + '.' + String(now.getMilliseconds()).padStart(3, '0');
        const line = `[${ts}] [1403] ${direction} ${message}`;
        const ch = getTrafficChannel();
        if (ch) {
            ch.appendLine(line);
        }
        appendLiveLog(line);
    }

    private cancelReconnect(): void {
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
    }

    private clearReadyState(valueForWaiters: boolean): void {
        this._readyForBatch = false;
        if (this._readyForBatchTimer) {
            clearTimeout(this._readyForBatchTimer);
            this._readyForBatchTimer = null;
        }
        const waiters = this._readyWaiters.splice(0, this._readyWaiters.length);
        for (const waiter of waiters) {
            waiter(valueForWaiters);
        }
    }

    private scheduleReadyForBatch(): void {
        this.clearReadyState(false);
        this._readyForBatchTimer = setTimeout(() => {
            this._readyForBatchTimer = null;
            if (this._isConnected && !this._explicitStop) {
                this._readyForBatch = true;
                const waiters = this._readyWaiters.splice(0, this._readyWaiters.length);
                for (const waiter of waiters) {
                    waiter(true);
                }
                this.logConsoleTraffic('---', 'READY for first batch');
            }
        }, 75);
    }

    private resolvePayloadWaiters(value: boolean): void {
        const waiters = this._payloadWaiters.splice(0, this._payloadWaiters.length);
        for (const waiter of waiters) {
            waiter(value);
        }
    }

    private getTuning(): RuntimeConsoleTuning {
        const cfg = vscode.workspace.getConfiguration('gpl.runtimeConsole');
        const threshold = Math.max(1, cfg.get<number>('noPayloadWarnThreshold', DEFAULT_NO_PAYLOAD_WARN_THRESHOLD));
        const cooldown = Math.max(1_000, cfg.get<number>('unstableWarnCooldownMs', DEFAULT_UNSTABLE_WARN_COOLDOWN_MS));
        const noticeEvery = Math.max(1, cfg.get<number>('emptyNoticeEvery', DEFAULT_EMPTY_NOTICE_EVERY));
        const immediateBase = Math.max(250, cfg.get<number>('immediateEofReconnectBaseMs', DEFAULT_IMMEDIATE_EOF_RECONNECT_BASE_MS));
        const immediateMax = Math.max(immediateBase, cfg.get<number>('immediateEofReconnectMaxMs', DEFAULT_IMMEDIATE_EOF_RECONNECT_MAX_MS));
        const idleBase = Math.max(500, cfg.get<number>('idleReconnectBaseMs', DEFAULT_IDLE_RECONNECT_BASE_MS));
        const idleMax = Math.max(idleBase, cfg.get<number>('idleReconnectMaxMs', DEFAULT_IDLE_RECONNECT_MAX_MS));
        return {
            noPayloadWarnThreshold: threshold,
            unstableWarnCooldownMs: cooldown,
            emptyNoticeEvery: noticeEvery,
            immediateEofReconnectBaseMs: immediateBase,
            immediateEofReconnectMaxMs: immediateMax,
            idleReconnectBaseMs: idleBase,
            idleReconnectMaxMs: idleMax,
        };
    }

    private shouldEmitNoPayloadNotice(attempt: number, emptyNoticeEvery: number): boolean {
        return attempt <= 1 || attempt % emptyNoticeEvery === 0;
    }

    private computeAdaptiveReconnectDelayMs(attempt: number, baseMs: number, maxMs: number): number {
        const growthStep = Math.max(1, Math.floor((attempt + 1) / 2));
        return Math.min(baseMs * growthStep, maxMs);
    }

    private handleNoPayloadAttempt(reason: string): void {
        const tuning = this.getTuning();
        this._consecutiveNoPayloadAttempts++;
        if (this.shouldEmitNoPayloadNotice(this._consecutiveNoPayloadAttempts, tuning.emptyNoticeEvery)) {
            this.logConsoleTraffic('---', `NO_PAYLOAD attempt=${this._consecutiveNoPayloadAttempts} (${reason})`);
        }
        if (this._consecutiveNoPayloadAttempts >= tuning.noPayloadWarnThreshold) {
            const now = Date.now();
            if (now - this._lastUnstableWarnAt < tuning.unstableWarnCooldownMs) {
                return;
            }
            this._lastUnstableWarnAt = now;

            const burstCount = this._consecutiveNoPayloadAttempts > tuning.noPayloadWarnThreshold
                ? `${tuning.noPayloadWarnThreshold}+`
                : `${this._consecutiveNoPayloadAttempts}`;
            this.appendStateLine(`[Console][RC1403] STATE=UNSTABLE noPayloadStreak=${burstCount} reason=${reason}`);
            this.appendStateLine('[Console][RC1403] ACTION=CHECK_ROBOT_LOG source=/ROMDISK/tmp/Robot.log');
        }
    }

    private async scheduleReconnectByPolicy(dataReceived: boolean, hadError: boolean, noPayloadReason?: string): Promise<void> {
        if (this._explicitStop || this.disposed) { return; }

        const tuning = this.getTuning();

        if (dataReceived && !hadError) {
            // 이벤트 배치 정상 완료 → 즉시 재연결 (다음 배치 대기)
            this._reconnectAttempt = 0;
            this.logConsoleTraffic('---', 'RECONNECT (immediate, batch complete)');
            this._reconnectTimer = setTimeout(() => {
                this._reconnectTimer = null;
                this.connectInternal();
            }, RECONNECT_IMMEDIATE_MS);
            return;
        }

        if (!hadError) {
            // 빈 세션 (이벤트 없음) → 이유별 적응형 재연결
            this._reconnectAttempt = 0;
            const reason = noPayloadReason || 'No payload';
            const isImmediateEof = reason === 'Immediate EOF';
            const idleDelay = isImmediateEof
                ? this.computeAdaptiveReconnectDelayMs(
                    this._consecutiveNoPayloadAttempts,
                    tuning.immediateEofReconnectBaseMs,
                    tuning.immediateEofReconnectMaxMs,
                )
                : this.computeAdaptiveReconnectDelayMs(
                    this._consecutiveNoPayloadAttempts,
                    tuning.idleReconnectBaseMs,
                    tuning.idleReconnectMaxMs,
                );
            if (this.shouldEmitNoPayloadNotice(this._consecutiveNoPayloadAttempts, tuning.emptyNoticeEvery)) {
                const policy = isImmediateEof ? 'immediate-eof-adaptive' : 'idle-adaptive';
                this.logConsoleTraffic('---', `RECONNECT (${policy}, ${idleDelay}ms, streak=${this._consecutiveNoPayloadAttempts}, reason=${reason})`);
            }
            this._reconnectTimer = setTimeout(() => {
                this._reconnectTimer = null;
                this.connectInternal();
            }, idleDelay);
            return;
        }

        // 에러 → 지수 백오프
        this.scheduleReconnect();
    }

    /**
     * 자동 재연결 스케줄링 (지수 백오프).
     */
    private scheduleReconnect(): void {
        if (this.disposed || this._explicitStop) { return; }
        if (this._reconnectAttempt >= RECONNECT_MAX_ATTEMPTS) {
            this.appendStateLine(`[Console][RC1403] STATE=RECONNECT_STOPPED attempts=${RECONNECT_MAX_ATTEMPTS}`);
            return;
        }

        const delay = Math.min(
            RECONNECT_BASE_MS * Math.pow(2, this._reconnectAttempt),
            RECONNECT_MAX_MS,
        );
        this._reconnectAttempt++;

        this.appendStateLine(`[Console][RC1403] STATE=RECONNECT_SCHEDULED delayMs=${delay} attempt=${this._reconnectAttempt}/${RECONNECT_MAX_ATTEMPTS}`);
        this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = null;
            this.connectInternal();
        }, delay);
    }

    private connectInternal(): void {
        if (this.disposed || this._explicitStop) { return; }

        const cfg = getControllerConfig();
        const socket = new net.Socket();
        this.socket = socket;
        this._lastError = null;

        this.logConsoleTraffic('>>>', `CONNECT ${cfg.ip}:${cfg.consolePort}`);

        const connectOptions = cfg.preferIPv4
            ? { host: cfg.ip, port: cfg.consolePort, family: 4 }
            : { host: cfg.ip, port: cfg.consolePort };

        socket.connect(connectOptions, () => {
            this._isConnected = true;
            this._lastReason = 'Connected';
            this._lastDetail = '';
            this._lastChangedAt = Date.now();
            this._connectedAt = Date.now();
            this.carry = '';
            this._sessionDataReceived = false;
            socket.setKeepAlive(true, 5_000);  // 5초 간격 TCP keepalive
            socket.setNoDelay(true);
            this.scheduleReadyForBatch();

            if (this._noOutputHintTimer) {
                clearTimeout(this._noOutputHintTimer);
                this._noOutputHintTimer = null;
            }
            this._noOutputHintTimer = setTimeout(() => {
                // 연결은 정상인데 런타임 출력이 없는 경우(Idle/무출력)를 장애와 분리해서 안내
                if (this._isConnected && !this._sessionDataReceived) {
                    this.appendStateLine('[Console][RC1403] STATE=CONNECTED_NO_PAYLOAD');
                    this.logConsoleTraffic('---', 'CONNECTED no payload yet (idle-or-unstable)');
                }
            }, NO_OUTPUT_HINT_MS);

            if (this._consecutiveEmptySessions === 0) {
                this.appendStateLine(`[Console][RC1403] STATE=CONNECTED endpoint=${cfg.ip}:${cfg.consolePort}`);
            }
            this.logConsoleTraffic('---', `CONNECTED (local ${socket.localAddress}:${socket.localPort}, idle=${this._consecutiveEmptySessions})`);
            this._onDidConnect.fire();
        });

        socket.on('data', (data: Buffer) => {
            this._sessionDataReceived = true;
            this._consecutiveNoPayloadAttempts = 0;
            this.resolvePayloadWaiters(true);
            if (this._noOutputHintTimer) {
                clearTimeout(this._noOutputHintTimer);
                this._noOutputHintTimer = null;
            }
            const raw = data.toString('ascii');
            this.logConsoleTraffic('<<<', raw.replace(/[\r\n]+/g, '\\n'));
            const text = (this.carry + raw).replace(/\r/g, '');
            const lines = text.split('\n');

            // 마지막 줄이 불완전할 수 있으므로 carry로 보존
            if (!text.endsWith('\n')) {
                this.carry = lines[lines.length - 1];
                lines.length = lines.length - 1;
            } else {
                this.carry = '';
            }

            for (const line of lines) {
                const normalized = normalizeConsoleLine(line);
                if (normalized) {
                    this.output.appendLine(`[RT] ${normalized}`);
                    this._onDidReceiveLine.fire(normalized);
                }
            }
        });

        socket.on('end', () => {
            // 서버가 FIN(쓰기 종료)을 보냄 — close 전에 발생
            const elapsed = this._connectedAt > 0 ? Date.now() - this._connectedAt : 0;
            this.logConsoleTraffic('---', `END (server sent FIN, connected ${elapsed}ms)`);
        });

        socket.on('error', (err: Error) => {
            this._lastError = err;
            this.logConsoleTraffic('---', `ERROR: ${err.message} (${(err as any).code ?? 'no code'})`);
            this.appendStateLine(`[Console][RC1403] EVENT=SOCKET_ERROR code=${(err as any).code ?? 'NA'} message=${err.message}`);
        });

        socket.on('close', (hadError: boolean) => {
            this.socket = null;
            if (!this._sessionDataReceived) {
                this.resolvePayloadWaiters(false);
            }
            if (this._gracefulStopTimer) {
                clearTimeout(this._gracefulStopTimer);
                this._gracefulStopTimer = null;
            }
            this.clearReadyState(false);
            if (this._noOutputHintTimer) {
                clearTimeout(this._noOutputHintTimer);
                this._noOutputHintTimer = null;
            }
            const dataReceived = this._sessionDataReceived;
            let noPayloadReason: string | undefined;
            if (this._isConnected) {
                this._isConnected = false;
                const elapsed = Date.now() - this._connectedAt;

                if (hadError) {
                    // 에러로 인한 종료
                    const errCode = (this._lastError as any)?.code as string | undefined;
                    if (errCode === 'ECONNREFUSED') {
                        this._lastReason = '연결 거부';
                        this._lastDetail = '1403 포트가 연결을 거부했습니다 (ECONNREFUSED)';
                    } else {
                        this._lastReason = '소켓 에러';
                        this._lastDetail = this._lastError?.message ?? '알 수 없는 소켓 에러';
                    }
                    this._lastChangedAt = Date.now();
                    this.appendStateLine(`[Console][RC1403] STATE=DISCONNECTED mode=error elapsedMs=${elapsed} message=${this._lastError?.message ?? 'unknown'}`);
                    if (!dataReceived) {
                        if (errCode === 'ECONNREFUSED') {
                            this.handleNoPayloadAttempt('Connection refused');
                        } else {
                            this.handleNoPayloadAttempt('Socket error (no payload)');
                        }
                    }
                    this._consecutiveEmptySessions = 0;
                } else if (dataReceived) {
                    // 데이터 수신 후 정상 종료 (이벤트 배치 완료)
                    this._lastReason = '배치 완료 후 재연결';
                    this._lastDetail = '이벤트 배치 수신 후 서버가 FIN으로 세션 종료';
                    this._lastChangedAt = Date.now();
                    this.appendStateLine(`[Console][RC1403] STATE=DISCONNECTED mode=batch_complete elapsedMs=${elapsed}`);
                    this._consecutiveEmptySessions = 0;
                } else {
                    // 빈 세션 — 이벤트 없이 FIN
                    this._consecutiveEmptySessions++;
                    const reason = elapsed <= 500 ? 'Immediate EOF' : 'Empty batch';
                    noPayloadReason = reason;
                    this._lastReason = reason === 'Immediate EOF' ? '즉시 EOF' : '빈 세션';
                    this._lastDetail = reason === 'Immediate EOF'
                        ? '연결 직후 서버가 payload 없이 즉시 세션을 종료했습니다'
                        : '연결은 되었지만 payload 없이 세션이 종료되었습니다';
                    this._lastChangedAt = Date.now();
                    this.handleNoPayloadAttempt(reason);
                    const tuning = this.getTuning();
                    if (this.shouldEmitNoPayloadNotice(this._consecutiveNoPayloadAttempts, tuning.emptyNoticeEvery)) {
                        this.appendStateLine(`[Console][RC1403] STATE=DISCONNECTED mode=no_payload reason=${reason} payloadBytes=0 elapsedMs=${elapsed} streak=${this._consecutiveNoPayloadAttempts}`);
                    }
                }

                this.logConsoleTraffic('---', `CLOSE (${elapsed}ms, hadError=${hadError}, data=${dataReceived}, empty=${this._consecutiveEmptySessions})`);
                this._onDidDisconnect.fire();
            } else {
                // connect 콜백 전에 close 된 경우
                const errMsg = this._lastError?.message ?? 'unknown';
                const errCode = (this._lastError as any)?.code as string | undefined;
                this.logConsoleTraffic('---', `CLOSE (connect failed: ${errMsg})`);
                if (errCode === 'ECONNREFUSED') {
                    this._lastReason = '연결 거부';
                    this._lastDetail = '1403 포트가 연결을 거부했습니다 (ECONNREFUSED)';
                    this.appendStateLine('[Console][RC1403] STATE=CONNECT_FAILED reason=ECONNREFUSED');
                    this.handleNoPayloadAttempt('Connection refused');
                } else {
                    this._lastReason = '연결 실패';
                    this._lastDetail = errMsg;
                    this.appendStateLine(`[Console][RC1403] STATE=CONNECT_FAILED reason=${errMsg}`);
                    this.handleNoPayloadAttempt('Connect error');
                }
                this._lastChangedAt = Date.now();
                this._consecutiveEmptySessions = 0;
            }
            this._lastError = null;

            // 명시적 stop이 아닌 연결 종료 → 정책 기반 재연결
            void this.scheduleReconnectByPolicy(dataReceived, hadError, noPayloadReason);
        });
    }
}
