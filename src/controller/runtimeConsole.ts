/**
 * 런타임 콘솔 (포트 1403) — 제어기 실시간 출력 스트리밍.
 * OutputChannel에 파싱된 메시지를 실시간으로 표시한다.
 * 제어기가 연결을 끊으면 자동 재연결을 시도한다 (지수 백오프).
 */

import * as net from 'net';
import * as vscode from 'vscode';
import { getControllerConfig } from './controllerConnection';
import { normalizeConsoleLine } from './responseParser';

/** 재연결 지수 백오프 설정 */
const RECONNECT_BASE_MS = 2_000;   // 최초 재연결 대기
const RECONNECT_MAX_MS = 30_000;   // 최대 대기 시간
const RECONNECT_MAX_ATTEMPTS = 10; // 이후 포기

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
     */
    start(): void {
        if (this.socket) { return; }
        this._explicitStop = false;
        this._reconnectAttempt = 0;
        this.connectInternal();
    }

    /**
     * 콘솔 스트리밍 중지 (명시적). 자동 재연결도 중단.
     */
    stop(): void {
        this._explicitStop = true;
        this.cancelReconnect();
        if (this.socket) {
            this.socket.destroy();
            this.socket = null;
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

        socket.connect(cfg.consolePort, cfg.ip, () => {
            this._isConnected = true;
            this._reconnectAttempt = 0;   // 연결 성공 → 카운터 리셋
            this.carry = '';
            this.output.appendLine(`[Console] Connected to ${cfg.ip}:${cfg.consolePort}`);
            this._onDidConnect.fire();
        });

        socket.on('data', (data: Buffer) => {
            const text = (this.carry + data.toString('ascii')).replace(/\r/g, '');
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

        socket.on('error', () => {
            // close 이벤트에서 처리
        });

        socket.on('close', () => {
            this.socket = null;
            const wasConnected = this._isConnected;
            if (this._isConnected) {
                this._isConnected = false;
                this.output.appendLine('[Console] Disconnected');
                this._onDidDisconnect.fire();
            }
            // 명시적 stop이 아닌 비정상 연결 종료 → 자동 재연결
            if (!this._explicitStop) {
                this.scheduleReconnect();
            }
        });
    }
}
