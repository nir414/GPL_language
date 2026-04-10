/**
 * 런타임 콘솔 (포트 1403) — 제어기 실시간 출력 스트리밍.
 * OutputChannel에 파싱된 메시지를 실시간으로 표시한다.
 */

import * as net from 'net';
import * as vscode from 'vscode';
import { getControllerConfig } from './controllerConnection';
import { normalizeConsoleLine } from './responseParser';

export class RuntimeConsole implements vscode.Disposable {
    private socket: net.Socket | null = null;
    private output: vscode.OutputChannel;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private _isConnected = false;
    private carry = '';
    private disposed = false;
    private reconnectMs: number;

    private readonly _onDidConnect = new vscode.EventEmitter<void>();
    private readonly _onDidDisconnect = new vscode.EventEmitter<void>();
    private readonly _onDidReceiveLine = new vscode.EventEmitter<string>();

    readonly onDidConnect = this._onDidConnect.event;
    readonly onDidDisconnect = this._onDidDisconnect.event;
    readonly onDidReceiveLine = this._onDidReceiveLine.event;

    get isConnected(): boolean { return this._isConnected; }

    constructor(output: vscode.OutputChannel, reconnectMs: number = 1000) {
        this.output = output;
        this.reconnectMs = reconnectMs;
    }

    /**
     * 콘솔 스트리밍 시작.
     */
    start(): void {
        if (this.socket) { return; }
        this.connectInternal();
    }

    /**
     * 콘솔 스트리밍 중지.
     */
    stop(): void {
        this.clearReconnect();
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

    private connectInternal(): void {
        if (this.disposed) { return; }

        const cfg = getControllerConfig();
        const socket = new net.Socket();
        this.socket = socket;

        socket.connect(cfg.consolePort, cfg.ip, () => {
            this._isConnected = true;
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
            // 에러 시 reconnect에서 처리
        });

        socket.on('close', () => {
            this.socket = null;
            if (this._isConnected) {
                this._isConnected = false;
                this.output.appendLine('[Console] Disconnected');
                this._onDidDisconnect.fire();
            }
            this.scheduleReconnect();
        });
    }

    private scheduleReconnect(): void {
        if (this.disposed) { return; }
        this.clearReconnect();
        this.reconnectTimer = setTimeout(() => {
            this.connectInternal();
        }, this.reconnectMs);
    }

    private clearReconnect(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }
}
