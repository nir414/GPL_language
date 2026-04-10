/**
 * 상태바 — 제어기 연결 상태를 하단 바에 표시.
 * 클릭 시 연결/해제 토글 또는 IP 변경 가능.
 */

import * as vscode from 'vscode';
import { getControllerConfig, testConnection } from '../controller/controllerConnection';

export class ConnectionStatusBar implements vscode.Disposable {
    private item: vscode.StatusBarItem;
    private _isConnected = false;
    private checkTimer: ReturnType<typeof setInterval> | null = null;

    get isConnected(): boolean { return this._isConnected; }

    constructor() {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.item.command = 'gpl.controller.connect';
        this.updateDisplay(false);
        this.item.show();
    }

    /**
     * 연결 상태 변경.
     */
    setConnected(connected: boolean): void {
        this._isConnected = connected;
        this.updateDisplay(connected);
    }

    /**
     * 주기적 heartbeat 시작.
     */
    startHeartbeat(intervalMs: number = 15000): void {
        this.stopHeartbeat();
        this.checkTimer = setInterval(async () => {
            const ok = await testConnection();
            this.setConnected(ok);
        }, intervalMs);
    }

    stopHeartbeat(): void {
        if (this.checkTimer) {
            clearInterval(this.checkTimer);
            this.checkTimer = null;
        }
    }

    dispose(): void {
        this.stopHeartbeat();
        this.item.dispose();
    }

    private updateDisplay(connected: boolean): void {
        const cfg = getControllerConfig();
        if (connected) {
            this.item.text = `$(plug) GPL: ${cfg.ip}`;
            this.item.backgroundColor = undefined;
            this.item.tooltip = `Connected to ${cfg.ip}:${cfg.port} — click to disconnect`;
        } else {
            this.item.text = `$(debug-disconnect) GPL: Disconnected`;
            this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            this.item.tooltip = 'Click to connect to controller';
        }
    }
}
