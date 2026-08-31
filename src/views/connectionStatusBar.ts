/**
 * 상태바 — 제어기 연결 상태를 하단 바에 표시.
 * 클릭 시 연결/해제 토글 또는 IP 변경 가능.
 *
 * 표시 조건: GPL 파일이 활성 에디터에 열려 있거나, 제어기에 연결된 상태.
 * 그 외에는 자동으로 숨김.
 *
 * 연결 중에는 바로 오른쪽에 `$(dashboard)` 항목이 함께 떠서 제어기 대시보드 탭으로 바로 들어갈 수 있다
 * (GitHub #18 — 기존 항목 클릭은 연결 토글에 묶여 있어 대시보드 진입 경로가 없었다).
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

/** 디버그 세션 중 "소스가 제어기 컴파일 코드보다 새로움" 상태(GitHub #21) — files 는 프로젝트 기준 상대 경로. */
export interface StatusBarSourceStale {
    projectName: string;
    files: string[];
    compiledAt?: number;
}

export class ConnectionStatusBar implements vscode.Disposable {
    private item: vscode.StatusBarItem;
    /** 대시보드 바로가기(연결 중에만 표시). */
    private dashboardItem: vscode.StatusBarItem;
    private _isConnected = false;
    private compileStale: StatusBarCompileStale | undefined;
    /** Attach only 디버깅 중 소스 stale 경고(GitHub #21) — 빈 목록이면 숨김. */
    private staleItem: vscode.StatusBarItem;
    private sourceStale: StatusBarSourceStale | undefined;
    /** 스레드 단일 실행 잠금 표시(디버그 중 잠금이 걸려 있을 때만). */
    private threadLockItem: vscode.StatusBarItem;
    private lockedThread: string | undefined;
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

    /**
     * "소스 변경됨 — BP 신뢰 불가" 배지(GitHub #21). Attach only 디버깅에서 제어기는 시작 시점에 컴파일된 코드를
     * 실행하므로, 그 뒤 편집·저장된 파일의 브레이크포인트는 Set Break 가 성공해도 실제 코드 줄과 어긋나 걸리지 않는다.
     * 디버그 어댑터가 gpl.sourceStale 이벤트로 알려 준 파일 목록을 표시한다. undefined/빈 목록이면 숨김.
     */
    setSourceStale(state?: StatusBarSourceStale): void {
        this.sourceStale = state && state.files.length > 0 ? state : undefined;
        this.updateStaleItem();
    }

    /**
     * 스레드 단일 실행 잠금 표시. 잠금 중에는 Continue/Step 이 VS Code 포커스와 무관하게 잠근
     * 스레드에만 나가므로(다중 스레드에서 의도하지 않은 스레드를 움직이는 사고 방지), 잠긴 상태를
     * 놓치지 않게 상태바에 표시한다. 클릭하면 해제. undefined면 숨김.
     */
    setThreadLock(threadName?: string): void {
        this.lockedThread = threadName || undefined;
        this.updateThreadLockItem();
    }

    constructor() {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.item.command = 'gpl.controller.connect';
        this.updateDisplay(false);

        this.dashboardItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
        this.dashboardItem.text = '$(dashboard)';
        this.dashboardItem.command = 'gpl.controller.showDashboard';
        this.dashboardItem.tooltip = '제어기 대시보드 열기 — 연결·고전원·스레드·축 위치·에러를 새 탭에서 시각적으로 확인';

        this.staleItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
        this.staleItem.command = 'gpl.debug.showSourceStale';
        this.staleItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');

        this.threadLockItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 97);
        this.threadLockItem.command = 'gpl.debug.unlockThread';
        this.threadLockItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');

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
        this.dashboardItem.dispose();
        this.staleItem.dispose();
        this.threadLockItem.dispose();
    }

    private updateThreadLockItem(): void {
        const name = this.lockedThread;
        if (!name) {
            this.threadLockItem.hide();
            return;
        }
        this.threadLockItem.text = `$(lock) 스레드 잠금: ${name}`;
        this.threadLockItem.tooltip =
            `스레드 단일 실행 잠금 — Continue/Step(F5·F10·F11·Shift+F11)은 CALL STACK 포커스와 무관하게 ` +
            `${name} 스레드에만 나갑니다.\n다른 스레드가 정지해도 디버그 포커스를 가져가지 않습니다.\n\n` +
            '클릭하면 잠금을 해제합니다.';
        this.threadLockItem.show();
    }

    private updateStaleItem(): void {
        const s = this.sourceStale;
        if (!s) {
            this.staleItem.hide();
            return;
        }
        const shown = s.files.slice(0, 12);
        this.staleItem.text = `$(warning) 소스 변경됨 ${s.files.length} — BP 신뢰 불가`;
        this.staleItem.tooltip =
            `${s.projectName}: 제어기 컴파일 코드보다 새로운 소스 ${s.files.length}개\n` +
            shown.join('\n') + (s.files.length > shown.length ? `\n… 외 ${s.files.length - shown.length}개` : '') +
            (s.compiledAt ? `\n마지막 Compile: ${new Date(s.compiledAt).toLocaleString()}` : '') +
            '\n이 파일들의 브레이크포인트는 옛 코드 줄에 걸려 있거나 걸리지 않습니다.\n클릭: 재배포(Stop + Upload + Run)로 재시작 / 파일 열기';
        this.staleItem.show();
    }

    private updateVisibility(): void {
        if (this._isConnected || isGplDocument(vscode.window.activeTextEditor?.document)) {
            this.item.show();
        } else {
            this.item.hide();
        }
        if (this._isConnected) {
            this.dashboardItem.show();
        } else {
            this.dashboardItem.hide();
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
