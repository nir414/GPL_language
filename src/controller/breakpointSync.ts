import * as vscode from 'vscode';
import * as path from 'path';
import { sendCommand } from './controllerConnection';
import { parseStatus, isSuccess } from './responseParser';

/**
 * 에디터 중단점 → 제어기 동기화 (VS Code가 중단점의 단일 원본).
 *
 * 배경(ai-handoff §1-AP): 외부 AI(MCP)가 제어기에 직접 브레이크포인트를 걸면 VS Code
 * UI에 보이지 않는다. 역방향(제어기→에디터) 미러링 대신, 에디터 중단점을 원본으로 삼고
 * 확장이 `Set Break`/`Set Nobreak`를 제어기에 실시간 반영한다 — 빨간 점이 항상 진실이
 * 되므로 동기화 어긋남이 구조적으로 없다. AI는 실행 제어(MCP)만 담당한다.
 *
 * 동작 조건과 예외 처리:
 * - `gpl.controller.syncEditorBreakpoints` 설정(기본 false)이 켜져 있고, 제어기에 연결된
 *   상태에서만 전송한다. 미연결이면 조용히 건너뛰고, 연결 시점에 전체 push로 따라잡는다.
 * - brooks-gpl 디버그 세션이 활성이면 DAP(gplDebugSession)가 중단점 동기화를 소유하므로
 *   이 모듈은 개입하지 않는다(이중 전송 방지).
 * - 조건/히트카운트/로그 중단점은 제어기가 지원하지 않으므로 일반 중단점으로 설정하고
 *   Output에 안내를 남긴다.
 * - 프로젝트명을 확정할 수 없으면 잘못된 프로젝트로 보내지 않고 건너뛴다(Output 기록).
 * - 명령 형식은 GDE 실측 no-space 형식(runbook): `Set Break <proj> "<file>"<line>` —
 *   gplDebugSession._bpCommand와 동일하게 유지해야 한다.
 */

const GPL_FILE_EXTS = new Set(['.gpl', '.gpo']);

export interface BreakpointSyncDeps {
	isConnected(): boolean;
	isDebugSessionActive(): boolean;
	/** 워크스페이스에서 감지한 제어기 프로젝트명 (빈 문자열이면 미확정) */
	resolveProjectName(): Promise<string>;
	log(line: string): void;
	/** 제어기 쪽 중단점을 실제로 변경한 배치가 끝난 뒤 호출 — UI(트리 중단점 섹션) 즉시 갱신용 */
	onDidSync?(): void;
}

interface TrackedBreakpoint {
	project: string;
	file: string;
	/** 1-based (제어기 기준) */
	line: number;
}

export interface PushAllResult {
	sent: number;
	failed: number;
	skipped: number;
}

function bpCommand(kind: 'Break' | 'Nobreak', project: string, file: string, line: number): string {
	return `Set ${kind} ${project} "${file}"${line}`;
}

export class EditorBreakpointSync implements vscode.Disposable {
	private readonly _listener: vscode.Disposable;
	/** VS Code 중단점 id → 제어기에 전송해 둔 위치. 제거 시 이 기록 기준으로 Nobreak를 보낸다. */
	private readonly _tracked = new Map<string, TrackedBreakpoint>();

	constructor(private readonly deps: BreakpointSyncDeps) {
		this._listener = vscode.debug.onDidChangeBreakpoints(e => {
			void this._onChange(e).catch(err => {
				this.deps.log(`[BP Sync] 처리 실패: ${err instanceof Error ? err.message : String(err)}`);
			});
		});
	}

	dispose(): void {
		this._listener.dispose();
		this._tracked.clear();
	}

	private _isEnabled(): boolean {
		return vscode.workspace.getConfiguration('gpl.controller').get<boolean>('syncEditorBreakpoints') === true;
	}

	private _shouldSync(): boolean {
		return this._isEnabled() && this.deps.isConnected() && !this.deps.isDebugSessionActive();
	}

	/** SourceBreakpoint를 제어기 대상(파일 베이스네임 + 1-based 줄)으로 변환. GPL 파일이 아니면 undefined. */
	private _toTarget(bp: vscode.Breakpoint): { file: string; line: number } | undefined {
		if (!(bp instanceof vscode.SourceBreakpoint)) { return undefined; }
		const fsPath = bp.location.uri.fsPath;
		if (!GPL_FILE_EXTS.has(path.extname(fsPath).toLowerCase())) { return undefined; }
		return { file: path.basename(fsPath), line: bp.location.range.start.line + 1 };
	}

	private async _send(kind: 'Break' | 'Nobreak', project: string, file: string, line: number): Promise<boolean> {
		const cmd = bpCommand(kind, project, file, line);
		try {
			const resp = await sendCommand(cmd);
			if (!isSuccess(resp)) {
				const status = parseStatus(resp);
				this.deps.log(`[BP Sync] 실패 (STATUS ${status.code}): ${cmd}`);
				return false;
			}
			this.deps.log(`[BP Sync] ${cmd}`);
			return true;
		} catch (err) {
			this.deps.log(`[BP Sync] 전송 오류: ${cmd} — ${err instanceof Error ? err.message : String(err)}`);
			return false;
		}
	}

	private _noteUnsupportedKinds(bp: vscode.Breakpoint, file: string, line: number): void {
		if (bp.condition || bp.hitCondition || bp.logMessage) {
			this.deps.log(`[BP Sync] ${file}:${line} — 조건/히트카운트/로그 중단점은 제어기가 지원하지 않아 일반 중단점으로 설정됩니다.`);
		}
	}

	private async _applyAdd(bp: vscode.Breakpoint, project: string): Promise<boolean> {
		const target = this._toTarget(bp);
		if (!target || !bp.enabled) { return false; }
		this._noteUnsupportedKinds(bp, target.file, target.line);
		const ok = await this._send('Break', project, target.file, target.line);
		if (ok) {
			this._tracked.set(bp.id, { project, file: target.file, line: target.line });
		}
		return ok;
	}

	private async _applyRemove(bp: vscode.Breakpoint): Promise<void> {
		// 제거는 현재 위치가 아니라 "전송해 둔 기록" 기준 — 편집으로 위치가 밀렸어도 정확히 지운다.
		const tracked = this._tracked.get(bp.id);
		if (!tracked) { return; }
		this._tracked.delete(bp.id);
		await this._send('Nobreak', tracked.project, tracked.file, tracked.line);
	}

	private async _onChange(e: vscode.BreakpointsChangeEvent): Promise<void> {
		if (!this._shouldSync()) {
			// 꺼져 있거나 미연결/디버그 세션 중 — 추적만 정리하고 전송하지 않는다.
			// (연결 후 따라잡기는 onControllerConnected → pushAll이 담당)
			for (const bp of e.removed) { this._tracked.delete(bp.id); }
			return;
		}

		const project = (await this.deps.resolveProjectName()).trim();
		if (!project) {
			this.deps.log('[BP Sync] 프로젝트명을 확정할 수 없어 중단점 변경을 반영하지 않습니다 (Project.gpr 확인).');
			return;
		}

		let touched = false;
		for (const bp of e.removed) {
			if (this._tracked.has(bp.id)) { touched = true; }
			await this._applyRemove(bp);
		}
		for (const bp of e.added) {
			if (await this._applyAdd(bp, project)) { touched = true; }
		}
		for (const bp of e.changed) {
			// enabled 토글/위치 변경 모두 "기존 기록 제거 → 현재 상태로 재설정"으로 수렴시킨다.
			if (this._tracked.has(bp.id)) { touched = true; }
			await this._applyRemove(bp);
			if (bp.enabled) {
				if (await this._applyAdd(bp, project)) { touched = true; }
			}
		}
		if (touched) {
			this.deps.onDidSync?.();
		}
	}

	/**
	 * 에디터의 모든 GPL 중단점을 제어기에 밀어넣는다 (추가만, 제어기 쪽 기존 중단점은 건드리지 않음).
	 * 연결 직후 따라잡기와 수동 명령(gpl.controller.pushBreakpoints)이 사용한다.
	 */
	async pushAll(): Promise<PushAllResult> {
		const result: PushAllResult = { sent: 0, failed: 0, skipped: 0 };
		if (!this.deps.isConnected()) {
			this.deps.log('[BP Sync] 제어기 미연결 — push 생략.');
			return result;
		}
		const project = (await this.deps.resolveProjectName()).trim();
		if (!project) {
			this.deps.log('[BP Sync] 프로젝트명을 확정할 수 없어 push를 생략합니다.');
			return result;
		}
		for (const bp of vscode.debug.breakpoints) {
			const target = this._toTarget(bp);
			if (!target || !bp.enabled) {
				result.skipped++;
				continue;
			}
			const ok = await this._applyAdd(bp, project);
			if (ok) { result.sent++; } else { result.failed++; }
		}
		if (result.sent > 0) {
			this.deps.onDidSync?.();
		}
		return result;
	}

	/** 연결 확립(false→true 에지) 시 호출 — 설정이 켜져 있으면 에디터 중단점으로 따라잡는다. */
	onControllerConnected(): void {
		if (!this._isEnabled() || this.deps.isDebugSessionActive()) { return; }
		void this.pushAll().then(r => {
			if (r.sent > 0 || r.failed > 0) {
				this.deps.log(`[BP Sync] 연결 직후 에디터 중단점 push: 성공 ${r.sent}, 실패 ${r.failed}, 제외 ${r.skipped}`);
			}
		});
	}
}
