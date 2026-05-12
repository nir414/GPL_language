/**
 * 상태바 — 제어기 연결 상태를 하단 바에 표시.
 * 클릭 시 연결/해제 토글 또는 IP 변경 가능.
 *
 * 표시 조건: GPL 파일이 활성 에디터에 열려 있거나, 제어기에 연결된 상태.
 * 그 외에는 자동으로 숨김.
 */

import * as vscode from 'vscode';
import { getControllerConfig } from '../controller/controllerConnection';
import { isGplDocument } from '../config';

export class ConnectionStatusBar implements vscode.Disposable {
    private item: vscode.StatusBarItem;
    private _isConnected = false;
    private disposables: vscode.Disposable[] = [];

    get isConnected(): boolean { return this._isConnected; }

    constructor() {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.item.command = 'gpl.controller.connect';
        this.updateDisplay(false);

        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor(() => this.updateVisibility())
        );

        this.updateVisibility();
    }

    /**
     * 연결 상태 변경.
     */
    setConnected(connected: boolean): void {
        this._isConnected = connected;
        this.item.command = connected ? 'gpl.controller.disconnect' : 'gpl.controller.connect';
        this.updateDisplay(connected);
        this.updateVisibility();
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.item.dispose();
    }

    private updateVisibility(): void {
        if (this._isConnected || isGplDocument(vscode.window.activeTextEditor?.document)) {
            this.item.show();
        } else {
            this.item.hide();
        }
    }

    private updateDisplay(connected: boolean): void {
        const cfg = getControllerConfig();
        if (connected) {
            this.item.text = `$(plug) GPL: ${cfg.ip}`;
            this.item.backgroundColor = undefined;
            this.item.tooltip = `Connected to ${cfg.ip}:${cfg.port} — click to disconnect`;
        } else {
            this.item.text = `$(debug-disconnect) GPL: ${cfg.ip} (offline)`;
            this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            this.item.tooltip = `Disconnected (${cfg.ip}:${cfg.port}) — click to connect`;
        }
    }
}
