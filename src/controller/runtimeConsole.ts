/**
 * 런타임 콘솔 (포트 1403) — 제어기 이벤트 배치 수신.
 * OutputChannel에 파싱된 메시지를 실시간으로 표시한다.
 *
 * 프로토콜 동작 (테스트 확인):
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

/** FIN+데이터 후 즉시 재연결 대기 (TCP 정리 여유) */
const RECONNECT_IMMEDIATE_MS = 100;
/** 빈 세션 (이벤트 없이 FIN) 후 고정 간격 재연결 */
const RECONNECT_IDLE_MS = 5_000;
/** 에러/빈 세션 시 지수 백오프 설정 */
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;
const RECONNECT_MAX_ATTEMPTS = 10;
/** end() 후 이 시간 안에 안 닫히면 destroy()로 강제 종료 */
const GRACEFUL_CLOSE_TIMEOUT_MS = 3_000;

export class RuntimeConsole implements vscode.Disposable {
    private socket: net.Socket | null = null;
    private output: vscode.OutputChannel;
    private _isConnected = false;
    private carry = '';
    private disposed = false;
    /** 사용자가 명시적으로 stop()을 호출했을 때 true → 자동 재연결 금지 */
    private _explicitStop = false;
    private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private _reconnectAttempt = 0;
    private _lastError: Error | null = null;
    /** 연결 성립 시각 — 로깅용 */
    private _connectedAt = 0;
    /** 현재 세션에서 데이터(바이트)를 수신했는지 여부 */
    private _sessionDataReceived = false;
    /** 연속 빈 세션 수 (데이터 없이 FIN) — 로그 노이즈 억제용 */
    private _consecutiveEmptySessions = 0;

    private readonly _onDidConnect = new vscode.EventEmitter<void>();
    private readonly _onDidDisconnect = new vscode.EventEmitter<void>();
    private readonly _onDidReceiveLine = new vscode.EventEmitter<string>();

    readonly onDidConnect = this._onDidConnect.event;
    readonly onDidDisconnect = this._onDidDisconnect.event;
    readonly onDidReceiveLine = this._onDidReceiveLine.event;

    get isConnected(): boolean { return this._isConnected; }

    constructor(output: vscode.OutputChannel) {
        this.output = output;
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
        if (this._reconnectTimer) { return; }
        this._explicitStop = false;
        this._reconnectAttempt = 0;
        this._consecutiveEmptySessions = 0;
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
        this.cancelReconnect();
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
            // 일정 시간 안에 안 닫히면 강제 종료
            const forceTimer = setTimeout(() => {
                try { s.destroy(); } catch { /* ignore */ }
            }, GRACEFUL_CLOSE_TIMEOUT_MS);
            s.once('close', () => clearTimeout(forceTimer));
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
        const ch = getTrafficChannel();
        if (!ch) { return; }
        const now = new Date();
        const ts = now.toLocaleTimeString('ko-KR', { hour12: false }) + '.' + String(now.getMilliseconds()).padStart(3, '0');
        ch.appendLine(`[${ts}] [1403] ${direction} ${message}`);
    }

    private cancelReconnect(): void {
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
    }

    /**
     * 자동 재연결 스케줄링 (지수 백오프).
     */
    private scheduleReconnect(): void {
        if (this.disposed || this._explicitStop) { return; }
        if (this._reconnectAttempt >= RECONNECT_MAX_ATTEMPTS) {
            this.output.appendLine(`[Console] 재연결 ${RECONNECT_MAX_ATTEMPTS}회 실패 — 자동 재연결 중단`);
            return;
        }

        const delay = Math.min(
            RECONNECT_BASE_MS * Math.pow(2, this._reconnectAttempt),
            RECONNECT_MAX_MS,
        );
        this._reconnectAttempt++;

        this.output.appendLine(`[Console] ${(delay / 1000).toFixed(0)}초 후 재연결 시도 (${this._reconnectAttempt}/${RECONNECT_MAX_ATTEMPTS})`);
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

        socket.connect(cfg.consolePort, cfg.ip, () => {
            this._isConnected = true;
            this._connectedAt = Date.now();
            this.carry = '';
            this._sessionDataReceived = false;
            socket.setKeepAlive(true, 5_000);  // 5초 간격 TCP keepalive
            socket.setNoDelay(true);
            if (this._consecutiveEmptySessions === 0) {
                this.output.appendLine(`[Console] Connected to ${cfg.ip}:${cfg.consolePort}`);
            }
            this.logConsoleTraffic('---', `CONNECTED (local ${socket.localAddress}:${socket.localPort}, idle=${this._consecutiveEmptySessions})`);
            this._onDidConnect.fire();
        });

        socket.on('data', (data: Buffer) => {
            this._sessionDataReceived = true;
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
            this.output.appendLine(`[Console] Socket error: ${err.message} (${(err as any).code ?? 'no code'})`);
        });

        socket.on('close', (hadError: boolean) => {
            this.socket = null;
            const dataReceived = this._sessionDataReceived;
            if (this._isConnected) {
                this._isConnected = false;
                const elapsed = Date.now() - this._connectedAt;

                if (hadError) {
                    // 에러로 인한 종료
                    this.output.appendLine(`[Console] Disconnected (${elapsed}ms): 에러 — ${this._lastError?.message ?? 'unknown'}`);
                    this._consecutiveEmptySessions = 0;
                } else if (dataReceived) {
                    // 데이터 수신 후 정상 종료 (이벤트 배치 완료)
                    this.output.appendLine(`[Console] Disconnected (${elapsed}ms): 이벤트 배치 전달 완료`);
                    this._consecutiveEmptySessions = 0;
                } else {
                    // 빈 세션 — 이벤트 없이 FIN
                    this._consecutiveEmptySessions++;
                    if (this._consecutiveEmptySessions === 1) {
                        this.output.appendLine(`[Console] 이벤트 대기 중...`);
                    }
                    // 이후 반복 로그 억제 (Traffic 채널에서만 확인 가능)
                }

                this.logConsoleTraffic('---', `CLOSE (${elapsed}ms, hadError=${hadError}, data=${dataReceived}, empty=${this._consecutiveEmptySessions})`);
                this._onDidDisconnect.fire();
            } else {
                // connect 콜백 전에 close 된 경우
                this.logConsoleTraffic('---', `CLOSE (connect failed: ${this._lastError?.message ?? 'unknown'})`);
                this.output.appendLine(`[Console] 연결 실패: ${this._lastError?.message ?? 'unknown'}`);
                this._consecutiveEmptySessions = 0;
            }
            this._lastError = null;

            // 명시적 stop이 아닌 연결 종료 → 자동 재연결
            if (!this._explicitStop) {
                if (dataReceived && !hadError) {
                    // 이벤트 배치 정상 완료 → 즉시 재연결 (다음 배치 대기)
                    this._reconnectAttempt = 0;
                    this.logConsoleTraffic('---', `RECONNECT (immediate, batch complete)`);
                    this._reconnectTimer = setTimeout(() => {
                        this._reconnectTimer = null;
                        this.connectInternal();
                    }, RECONNECT_IMMEDIATE_MS);
                } else if (!hadError) {
                    // 빈 세션 (이벤트 없음) → 고정 간격 재연결, 백오프 없음
                    this._reconnectAttempt = 0;
                    this.logConsoleTraffic('---', `RECONNECT (idle, ${RECONNECT_IDLE_MS}ms)`);
                    this._reconnectTimer = setTimeout(() => {
                        this._reconnectTimer = null;
                        this.connectInternal();
                    }, RECONNECT_IDLE_MS);
                } else {
                    // 에러 → 지수 백오프
                    this.scheduleReconnect();
                }
            }
        });
    }
}
