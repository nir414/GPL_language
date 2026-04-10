/**
 * 쓰레드 TreeView 프로바이더 — GDE의 Threads 패널을 VS Code 사이드바로 구현.
 * `Show Thread` 명령을 주기적으로 폴링하여 상태를 갱신한다.
 */

import * as vscode from 'vscode';
import { trySendCommand, getControllerConfig } from '../controller/controllerConnection';
import { parseThreadList, ThreadInfo } from '../controller/responseParser';

export class ThreadTreeProvider implements vscode.TreeDataProvider<ThreadItem>, vscode.Disposable {
    private _onDidChangeTreeData = new vscode.EventEmitter<ThreadItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private threads: ThreadInfo[] = [];
    private pollTimer: ReturnType<typeof setInterval> | null = null;
    private pollIntervalMs: number;
    private _isPolling = false;

    constructor(pollIntervalMs: number = 5000) {
        this.pollIntervalMs = pollIntervalMs;
    }

    getTreeItem(element: ThreadItem): vscode.TreeItem {
        return element;
    }

    getChildren(): ThreadItem[] {
        return this.threads.map(t => new ThreadItem(t));
    }

    /**
     * 폴링 시작. 이미 폴링 중이면 무시.
     */
    startPolling(): void {
        if (this._isPolling) { return; }
        this._isPolling = true;
        this.refresh(); // 즉시 한 번
        this.pollTimer = setInterval(() => this.refresh(), this.pollIntervalMs);
    }

    /**
     * 폴링 중지.
     */
    stopPolling(): void {
        this._isPolling = false;
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }

    /**
     * 즉시 갱신.
     */
    async refresh(): Promise<void> {
        const cfg = getControllerConfig();
        const resp = await trySendCommand('Show Thread', cfg);
        if (resp) {
            this.threads = parseThreadList(resp);
        } else {
            this.threads = [];
        }
        this._onDidChangeTreeData.fire(undefined);
    }

    dispose(): void {
        this.stopPolling();
        this._onDidChangeTreeData.dispose();
    }
}

class ThreadItem extends vscode.TreeItem {
    constructor(public readonly thread: ThreadInfo) {
        super(thread.name, vscode.TreeItemCollapsibleState.None);
        this.description = `${thread.state}${thread.file ? ' · ' + thread.file : ''}`;
        this.tooltip = `${thread.name}\nState: ${thread.state}\nLast Status: ${thread.lastStatus}\nProject: ${thread.project}\nFile: ${thread.file}`;
        this.iconPath = ThreadItem.getIcon(thread.state);
        this.contextValue = 'gplThread';
    }

    private static getIcon(state: string): vscode.ThemeIcon {
        switch (state) {
            case 'Running': return new vscode.ThemeIcon('play', new vscode.ThemeColor('charts.green'));
            case 'Idle': return new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('charts.yellow'));
            case 'Error': return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
            case 'Stopped': return new vscode.ThemeIcon('debug-stop', new vscode.ThemeColor('charts.orange'));
            case 'Break': return new vscode.ThemeIcon('debug-pause', new vscode.ThemeColor('charts.blue'));
            default: return new vscode.ThemeIcon('question');
        }
    }
}
