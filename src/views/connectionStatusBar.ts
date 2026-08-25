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

/** "컴파일 필요" 표시 정보(controllerTreeProvider.CompileStaleState와 동일 형태). */
export interface StatusBarCompileStale {
    projectName: string;
    since: number;
    reason: string;
}

export class ConnectionStatusBar implements vscode.Disposable {
    private item: vscode.StatusBarItem;
    private _isConnected = false;
    private compileStale: StatusBarCompileStale | undefined;
    private disposables: vscode.Disposable[] = [];

    get isConnected(): boolean { return this._isConnected; }

    /**
     * "컴파일 검증 필요" 상태 — /GPL 소스는 업로드됐지만 Compile로 검증되지 않은 프로젝트(이슈 #17 재구성의 부수 상태).
     * Start는 제어기가 자체 컴파일하므로(ai-handoff §0.7) 소스 에러가 있으면 Start가 실패한다 — 놓치지 않게 상태바에
     * 경고 배지로 보인다. undefined면 해제.
     */
    setCompileStale(state?: StatusBarCompileStale): void {
        this.compileStale = state;
        this.updateDisplay(this._isConnected);
        this.updateVisibility();
    }

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
            const stale = this.compileStale;
            if (stale) {
                this.item.text = `$(plug) GPL: ${cfg.ip} $(warning) 컴파일 검증 필요: ${stale.projectName}`;
                this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                this.item.tooltip = `Connected to ${cfg.ip}:${cfg.port} — click to disconnect\n\n` +
                    `컴파일 검증 필요: ${stale.projectName} — ${stale.reason}\n` +
                    `${new Date(stale.since).toLocaleString()} 이후 /GPL 소스가 아직 Compile로 검증되지 않았습니다. ` +
                    'Start는 제어기가 자체 컴파일하므로 소스에 에러가 있으면 Start가 실패합니다 — Quick Compile로 먼저 확인하세요.';
            } else {
                this.item.text = `$(plug) GPL: ${cfg.ip}`;
                this.item.backgroundColor = undefined;
                this.item.tooltip = `Connected to ${cfg.ip}:${cfg.port} — click to disconnect`;
            }
        } else {
            this.item.text = `$(debug-disconnect) GPL: ${cfg.ip} (offline)`;
            this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            this.item.tooltip = `Disconnected (${cfg.ip}:${cfg.port}) — click to connect`;
        }
    }
}
