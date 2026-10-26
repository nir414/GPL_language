/**
 * 상태바 — 제어기 연결 상태를 하단 바에 표시.
 * 클릭 시 연결/해제 토글 또는 IP 변경 가능.
 *
 * 표시 조건: GPL 파일이 활성 에디터에 열려 있거나, 제어기에 연결된 상태.
 * 그 외에는 자동으로 숨김.
 *
 * 연결 중에는 바로 오른쪽에 `$(dashboard)` 항목이 함께 떠서 제어기 대시보드 탭으로 바로 들어갈 수 있다
 * (GitHub #18 — 기존 항목 클릭은 연결 토글에 묶여 있어 대시보드 진입 경로가 없었다).
 *
 * 경고 배지("컴파일 검증 필요"·"소스 변경됨"·"스레드 잠금")는 **연결 항목과 별개의 항목**으로 띄운다 — 배지마다
 * 클릭 동작이 다르기 때문이다(Quick Compile / 재배포 안내 / 잠금 해제). 종전에는 "컴파일 검증 필요"를 연결 항목의
 * 글자에 덧붙여 놓아 배지를 누르면 연결이 끊겼다(2026-09-18 사용자 지적, ai-handoff §1-DV).
 *
 * 업로드 진행 바(`██████░░░░  3.2 MB / 10.7 MB`)도 별도 항목이다 — 상태바는 글자를 제자리에서 바꿀 수 있어
 * 출력 패널(줄이 쌓이기만 함)과 달리 움직이는 바를 그릴 수 있다. 집계는 `controller/deployment/uploadProgress`, 바·문구 규칙은
 * `views/uploadProgressBar`(둘 다 순수), 여기는 보이기/숨기기와 완료 뒤 잠시 남기는 타이밍만 안다(§1-EE).
 */

import * as vscode from 'vscode';
import { getControllerConfig, SHOW_MEMORY_STATUS_COMMAND } from '../controller/connection/controllerConnection';
import type { CompileStaleInfo } from '../controller/deployment/compileStale';
import type { FlashSafetyState } from '../controller/deployment/flashSafety';
import type { UploadProgressEvent, UploadSummary } from '../controller/deployment/uploadProgress';
import { describeUploadProgress, renderUploadProgress, renderUploadSummary } from './uploadProgressBar';
import { isGplDocument } from '../config';
import { compileStaleBadgeCommand, compileStaleBadgeLabel, compileStaleBadgeTooltip } from './compileStaleBadge';
import { presentFlashSafety } from './flashSafetyPresentation';

/** 업로드가 끝났을 때 상태바에 잠시 남기는 결과. 실패 문구는 배포 결과 알림이 따로 띄우므로 짧게만. */
export type UploadEndOutcome =
    | { ok: true; summary: UploadSummary }
    | { ok: false; message: string };

/** 완료/실패 문구를 상태바에 남겨 두는 시간(ms). 완료는 짧게, 실패는 읽을 만큼. */
const UPLOAD_DONE_LINGER_MS = 2500;
const UPLOAD_FAIL_LINGER_MS = 5000;

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
    /** "컴파일 검증 필요" 배지 — 연결 중이고 미검증 프로젝트가 있을 때만. 클릭 = 그 프로젝트 Quick Compile. */
    private compileStaleItem: vscode.StatusBarItem;
    private compileStale: CompileStaleInfo | undefined;
    /** Attach only 디버깅 중 소스 stale 경고(GitHub #21) — 빈 목록이면 숨김. */
    private staleItem: vscode.StatusBarItem;
    private sourceStale: StatusBarSourceStale | undefined;
    /** 스레드 단일 실행 잠금 표시(디버그 중 잠금이 걸려 있을 때만). */
    private threadLockItem: vscode.StatusBarItem;
    private lockedThread: string | undefined;
    /** 업로드 진행 바 — 업로드 중에만 보이고, 끝나면 결과를 잠시 남겼다가 숨긴다. */
    private uploadItem: vscode.StatusBarItem;
    private uploadLingerTimer: ReturnType<typeof setTimeout> | undefined;
    /** 진행 표시가 한 번이라도 떴는지 — 시작도 못 한 실패(FTP 접속 불가)는 배포 알림에 맡기고 여기선 조용히 지나간다. */
    private uploadShown = false;
    /** Flash 쓰기 중 전원 차단 금지 경고 — 업로드 진행과 별개로 Sync + 안정화가 끝날 때까지 유지한다. */
    private flashSafetyItem: vscode.StatusBarItem;
    /**
     * 여유 메모리 경고 구간 표시(`$(warning) Free 2.96 MB`) — 매 검사마다 숫자만 갱신한다. 알림 창은 상태가 나빠질 때만 뜨고
     * 지속 상태는 이 한 칸이 맡는다(2026-10-23 보고). 문구 규칙은 controller/diagnostics/memoryNotice.memoryBadge.
     */
    private memoryItem: vscode.StatusBarItem;
    private disposables: vscode.Disposable[] = [];

    get isConnected(): boolean { return this._isConnected; }

    /**
     * 업로드 진행 갱신 — 파일 완료·전송 중 바이트 갱신마다 불린다(초당 몇 번). 같은 항목의 글자만 바꾸므로
     * 상태바에는 한 줄만 있고 움직인다. `projectName` 은 툴팁에만 쓴다(본문은 바와 크기만 — 짧게).
     */
    setUploadProgress(event: UploadProgressEvent, projectName?: string): void {
        this.clearUploadLinger();
        this.uploadShown = true;
        this.uploadItem.text = `$(sync~spin) ${renderUploadProgress(event)}`;
        this.uploadItem.tooltip = describeUploadProgress(event, projectName);
        this.uploadItem.backgroundColor = undefined;
        this.uploadItem.show();
    }

    /**
     * 업로드 끝 — 완료면 요약을 잠시, 실패면 경고색으로 조금 더 남긴 뒤 숨긴다.
     * 진행 표시가 없었던 실패(FTP 접속 불가 등)는 배포 알림에 맡기고 **아무것도 건드리지 않는다** — 직전 업로드의
     * 완료 문구가 아직 남아 있으면 그 숨김 타이머도 그대로 돌아야 한다.
     */
    endUpload(outcome: UploadEndOutcome): void {
        if (!outcome.ok && !this.uploadShown) { return; }
        this.clearUploadLinger();
        this.uploadShown = false;
        if (outcome.ok) {
            this.uploadItem.text = `$(check) ${renderUploadSummary(outcome.summary)}`;
            this.uploadItem.tooltip = undefined;
            this.uploadItem.backgroundColor = undefined;
        } else {
            this.uploadItem.text = '$(error) 업로드 실패';
            this.uploadItem.tooltip = outcome.message;
            this.uploadItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        }
        this.uploadItem.show();
        this.uploadLingerTimer = setTimeout(() => {
            this.uploadLingerTimer = undefined;
            this.uploadItem.hide();
        }, outcome.ok ? UPLOAD_DONE_LINGER_MS : UPLOAD_FAIL_LINGER_MS);
    }

    private clearUploadLinger(): void {
        if (this.uploadLingerTimer) {
            clearTimeout(this.uploadLingerTimer);
            this.uploadLingerTimer = undefined;
        }
    }

    /**
     * "컴파일 검증 필요" 상태 — /GPL 소스는 업로드됐지만 Compile로 검증되지 않은 프로젝트(이슈 #17 재구성의 부수 상태).
     * Start 는 `-compile` 로 컴파일까지 하므로(ai-handoff §0.7) 소스 에러가 있으면 Start가 실패한다 — 놓치지 않게 상태바에
     * **별도 항목**의 경고 배지로 보인다(연결 항목의 클릭 = 연결 해제와 섞이지 않게, §1-DV). undefined면 해제.
     */
    setCompileStale(state?: CompileStaleInfo): void {
        this.compileStale = state;
        this.updateCompileStaleItem();
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

    /** Flash 쓰기 안전 단계 표시. undefined면 안전 확인이 끝난 것이므로 숨긴다. */
    setFlashSafety(state?: FlashSafetyState, projectName?: string): void {
        if (!state) {
            this.flashSafetyItem.hide();
            return;
        }
        const shown = presentFlashSafety(state, projectName);
        this.flashSafetyItem.text = shown.text;
        this.flashSafetyItem.tooltip = shown.tooltip;
        this.flashSafetyItem.show();
    }

    /**
     * 메모리 경고 항목. badge 가 null 이면 숨기고(ok 복귀), undefined 면 지금 표시를 유지한다(측정 실패 — 모르는 것을 좋아졌다고 보지 않는다).
     */
    setMemoryWarning(badge: { text: string; tooltip: string } | null | undefined): void {
        if (badge === undefined) { return; }
        if (badge === null) {
            this.memoryItem.hide();
            return;
        }
        this.memoryItem.text = badge.text;
        this.memoryItem.tooltip = badge.tooltip;
        this.memoryItem.show();
    }

    constructor() {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.item.command = 'gpl.controller.connect';
        this.updateDisplay(false);

        this.dashboardItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
        this.dashboardItem.text = '$(dashboard)';
        this.dashboardItem.command = 'gpl.controller.showDashboard';
        this.dashboardItem.tooltip = '제어기 대시보드 열기 — 연결·고전원·스레드·축 위치·에러를 새 탭에서 시각적으로 확인';

        this.compileStaleItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
        this.compileStaleItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');

        this.staleItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 97);
        this.staleItem.command = 'gpl.debug.showSourceStale';
        this.staleItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');

        this.threadLockItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 96);
        this.threadLockItem.command = 'gpl.debug.unlockThread';
        this.threadLockItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');

        this.uploadItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 95);
        this.uploadItem.name = 'GPL 업로드 진행';

        // 안전 경고는 연결/업로드 항목보다 높은 우선순위로 두어 좁은 상태바에서도 먼저 남는다.
        this.flashSafetyItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 101);
        this.flashSafetyItem.name = 'GPL Flash 쓰기 안전 경고';
        this.flashSafetyItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');

        this.memoryItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 94);
        this.memoryItem.name = 'GPL 제어기 여유 메모리 경고';
        this.memoryItem.command = SHOW_MEMORY_STATUS_COMMAND;
        this.memoryItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');

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
        this.updateCompileStaleItem();
    }

    dispose(): void {
        this.clearUploadLinger();
        this.disposables.forEach(d => d.dispose());
        this.item.dispose();
        this.dashboardItem.dispose();
        this.compileStaleItem.dispose();
        this.staleItem.dispose();
        this.threadLockItem.dispose();
        this.uploadItem.dispose();
        this.flashSafetyItem.dispose();
        this.memoryItem.dispose();
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

    private updateCompileStaleItem(): void {
        const stale = this.compileStale;
        // 연결이 끊긴 동안은 숨긴다(상태 자체는 유지 — 재연결하면 미검증이 남아 있는 한 다시 뜬다).
        if (!stale || !this._isConnected) {
            this.compileStaleItem.hide();
            return;
        }
        // 문구·클릭 대상은 트리와 같은 규칙(views/compileStaleBadge) — 폴더를 알면 Uri 인자로 선택 창 없이 그 프로젝트.
        this.compileStaleItem.text = `$(warning) ${compileStaleBadgeLabel(stale)}`;
        this.compileStaleItem.command = compileStaleBadgeCommand(stale, dir => vscode.Uri.file(dir));
        this.compileStaleItem.tooltip = compileStaleBadgeTooltip(stale);
        this.compileStaleItem.show();
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
            // "컴파일 검증 필요"는 여기 덧붙이지 않는다 — 별도 항목(updateCompileStaleItem). 이 항목의 클릭은 연결 해제다.
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
