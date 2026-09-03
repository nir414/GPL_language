import * as vscode from 'vscode';
import * as path from 'path';
import { sendCommand } from './controllerConnection';
import { parseStatus, isSuccess, parseBreakList } from './responseParser';
import { BreakpointTarget, controllerTargets, planReconcile, ReconcilePlan } from './breakpointReconcile';
import { formatBreakpointCommand, MirrorEchoMemory } from './breakpointCommand';

/**
 * 에디터 중단점 → 제어기 동기화 (VS Code가 중단점의 단일 원본).
 *
 * 배경(ai-handoff §1-AP): 에디터 중단점을 원본으로 삼고 확장이 `Set Break`/`Set Nobreak`를
 * 제어기에 실시간 반영한다 — 빨간 점이 항상 진실이 되므로 동기화 어긋남이 구조적으로 없다.
 *
 * 외부 AI(MCP)가 제어기에 직접 건 BP는 종전에 VS Code UI에 보이지 않았으나, 이제
 * `breakpointMirror.ts`가 외부 진입점에서 그 BP를 **에디터에도 추가**한다(§1-CO). 따라서
 * "에디터가 원본" 규약은 그대로이고, AI가 건 BP도 빨간 점으로 보인다. 미러가 만든 에디터 변경이
 * 다시 제어기로 나가지 않도록 `deps.mirrorEcho`로 에코를 걸러 낸다.
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
 *
 * 어긋남 복구(§1-CJ): 제어기의 `Set Break`는 VS Code를 닫아도 제어기에 남는다. 실시간 동기화가
 * 꺼져 있던 동안의 변경·다른 창·MCP/GDE·비정상 종료 잔재 때문에 "빨간 점은 없는데 제어기는
 * 브레이크를 거는" 상태가 생길 수 있었다. 세 가지로 막는다.
 * - 제거 시 전송 기록(`_tracked`)이 없어도 **현재 위치 기준으로 `Nobreak`를 보낸다**(폴백).
 * - `reconcileAll()`: `Show Break`와 에디터 목록을 비교해 양방향으로 수렴시킨다(연결 에지·수동 명령).
 * - 설정이 꺼진 상태에서 중단점을 건드리면 `onUnsyncedChange`로 알려 사용자가 바로 조치할 수 있게 한다.
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
	/**
	 * 실시간 동기화가 꺼진 상태에서 GPL 중단점이 바뀌었을 때 호출 — 제어기에는 반영되지 않았다는
	 * 사실을 사용자에게 알리는 용도(에디터의 빨간 점과 제어기 상태가 어긋나는 유일한 경로).
	 */
	onUnsyncedChange?(): void;
	/**
	 * 제어기→에디터 미러(`breakpointMirror.ts`)가 만든 변경을 기억하는 공유 메모리.
	 * 여기 걸린 변경은 이미 제어기에 반영된 것이므로 되쏘지 않는다(무의미한 왕복·중복 BP 방지).
	 */
	mirrorEcho?: MirrorEchoMemory;
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

export interface ReconcileResult {
	/** 제어기에 새로 설정한 개수 */
	added: number;
	/** 제어기에서 해제한 개수(에디터에 없던 잔재) */
	removed: number;
	/** 양쪽에 이미 있어 전송하지 않은 개수 */
	kept: number;
	failed: number;
	/** 다른 프로젝트/위치 미해석으로 손대지 않은 제어기 항목 수 */
	untouched: number;
	/** 수행하지 못한 이유 (`ok: false`일 때만) */
	error?: 'not-connected' | 'missing-project' | 'show-break-failed';
	ok: boolean;
}

const bpCommand = formatBreakpointCommand;

/** 파일 확장자로 GPL 소스 여부 판정 (제어기에 중단점을 걸 수 있는 파일). */
function isGplSource(fsPath: string): boolean {
	return GPL_FILE_EXTS.has(path.extname(fsPath).toLowerCase());
}

/**
 * 지금 에디터에 있는 GPL 중단점 위치 목록 (제어기 명령 단위 — 베이스네임 + 1-based 줄).
 * 비활성(enabled=false) 중단점은 제어기에 걸지 않으므로 기본적으로 제외한다.
 */
export function editorBreakpointTargets(includeDisabled = false): BreakpointTarget[] {
	const out: BreakpointTarget[] = [];
	for (const bp of vscode.debug.breakpoints) {
		if (!(bp instanceof vscode.SourceBreakpoint)) { continue; }
		if (!includeDisabled && !bp.enabled) { continue; }
		const fsPath = bp.location.uri.fsPath;
		if (!isGplSource(fsPath)) { continue; }
		out.push({ file: path.basename(fsPath), line: bp.location.range.start.line + 1 });
	}
	return out;
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
	private _toTarget(bp: vscode.Breakpoint): BreakpointTarget | undefined {
		if (!(bp instanceof vscode.SourceBreakpoint)) { return undefined; }
		const fsPath = bp.location.uri.fsPath;
		if (!isGplSource(fsPath)) { return undefined; }
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

	/**
	 * 중단점 제거를 제어기에 반영한다. 반환값은 실제로 `Nobreak`를 보냈는지 여부.
	 *
	 * 우선순위는 "전송해 둔 기록"(`_tracked`) — 편집으로 위치가 밀렸어도 정확히 지운다.
	 * 기록이 없으면(설정이 꺼져 있던 동안 찍은 BP, 다른 창·이전 세션·MCP/GDE가 걸어 둔 BP,
	 * Pull로 가져온 BP) 종전에는 아무것도 보내지 않아 제어기에 그대로 남았다 — 이제 현재
	 * 위치 기준으로 폴백 전송한다. 제어기에 없는 위치에 대한 `Nobreak`는 실패 STATUS만
	 * 남기고 상태를 바꾸지 않으므로 안전하다.
	 */
	private async _applyRemove(bp: vscode.Breakpoint, project: string): Promise<boolean> {
		const tracked = this._tracked.get(bp.id);
		if (tracked) {
			this._tracked.delete(bp.id);
			await this._send('Nobreak', tracked.project, tracked.file, tracked.line);
			return true;
		}
		const target = this._toTarget(bp);
		if (!target || !project) { return false; }
		this.deps.log(`[BP Sync] 전송 기록 없음 — 현재 위치로 해제 시도: ${target.file}:${target.line}`);
		await this._send('Nobreak', project, target.file, target.line);
		return true;
	}

	/**
	 * 이 변경 이벤트에 GPL 소스 중단점이 하나라도 들어 있는지 (안내를 GPL 파일에만 한정).
	 * 미러 에코는 이미 제어기에 반영된 것이므로 "어긋남" 안내 대상이 아니다.
	 */
	private _involvesGplBreakpoint(e: vscode.BreakpointsChangeEvent, echoed: ReadonlySet<string>): boolean {
		return [...e.added, ...e.removed, ...e.changed]
			.some(bp => !echoed.has(bp.id) && this._toTarget(bp) !== undefined);
	}

	/**
	 * 이 변경이 제어기→에디터 미러(`breakpointMirror.ts`)에서 비롯된 것인지 가려낸다.
	 *
	 * 미러가 만든 에디터 변경을 그대로 되쏘면 방금 건 BP에 `Set Break`를 한 번 더 보내거나
	 * (제어기가 "Duplicate breakpoint"로 거절), 방금 해제한 위치에 `Set Nobreak`를 또 보내는
	 * 무의미한 왕복이 생긴다. 반환값은 그렇게 걸러 낼 중단점의 id 집합(항목당 한 번만 매칭).
	 */
	private _collectEchoes(e: vscode.BreakpointsChangeEvent): Set<string> {
		const echoed = new Set<string>();
		const echo = this.deps.mirrorEcho;
		if (!echo) { return echoed; }
		const groups = [['Break', e.added], ['Nobreak', e.removed]] as const;
		for (const [kind, list] of groups) {
			for (const bp of list) {
				const target = this._toTarget(bp);
				if (target && echo.consume(kind, target.file, target.line)) { echoed.add(bp.id); }
			}
		}
		echo.prune();
		return echoed;
	}

	/** 미러가 추가한 중단점을 전송 기록에 넣는다 — 이후 F9 제거가 기록 기준으로 정확히 지워진다. */
	private _trackEchoedAdd(bp: vscode.Breakpoint, project: string): void {
		const target = this._toTarget(bp);
		if (!target || !project) { return; }
		this._tracked.set(bp.id, { project, file: target.file, line: target.line });
	}

	private async _onChange(e: vscode.BreakpointsChangeEvent): Promise<void> {
		const echoed = this._collectEchoes(e);
		if (!this._shouldSync()) {
			// 꺼져 있거나 미연결/디버그 세션 중 — 추적만 정리하고 전송하지 않는다.
			// (연결 후 따라잡기는 onControllerConnected → reconcileAll이 담당)
			for (const bp of e.removed) { this._tracked.delete(bp.id); }
			// 설정만 꺼져 있고 제어기에는 연결된 상태 = 빨간 점과 제어기가 어긋나는 유일한 경로.
			// 디버그 세션 중이면 DAP가 반영하므로 어긋나지 않는다.
			if (!this._isEnabled()
				&& this.deps.isConnected()
				&& !this.deps.isDebugSessionActive()
				&& this._involvesGplBreakpoint(e, echoed)) {
				this.deps.log('[BP Sync] 실시간 동기화가 꺼져 있어 중단점 변경을 제어기에 반영하지 않았습니다 — 제어기에는 이전 중단점이 남아 있을 수 있습니다.');
				this.deps.onUnsyncedChange?.();
			}
			return;
		}

		const project = (await this.deps.resolveProjectName()).trim();
		if (!project) {
			this.deps.log('[BP Sync] 프로젝트명을 확정할 수 없어 중단점 변경을 반영하지 않습니다 (Project.gpr 확인).');
			return;
		}

		let touched = false;
		for (const bp of e.removed) {
			// 미러가 지운 것 = 제어기에서 이미 사라진 것. 추적만 정리한다.
			if (echoed.has(bp.id)) { this._tracked.delete(bp.id); continue; }
			if (await this._applyRemove(bp, project)) { touched = true; }
		}
		for (const bp of e.added) {
			// 미러가 추가한 것 = 제어기에 이미 있는 것. 기록만 남기고 다시 보내지 않는다.
			if (echoed.has(bp.id)) { this._trackEchoedAdd(bp, project); continue; }
			if (await this._applyAdd(bp, project)) { touched = true; }
		}
		for (const bp of e.changed) {
			// enabled 토글/위치 변경 모두 "기존 기록 제거 → 현재 상태로 재설정"으로 수렴시킨다.
			if (await this._applyRemove(bp, project)) { touched = true; }
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

	/**
	 * 제어기를 에디터 상태로 **수렴**시킨다 — 에디터에 없는 이 프로젝트의 중단점은 해제하고,
	 * 에디터에만 있는 중단점은 설정한다(양방향). `pushAll`(추가 전용)과 달리 잔재를 정리하므로
	 * "빨간 점은 없는데 제어기는 브레이크를 거는" 상태를 한 번에 없앤다.
	 *
	 * 다른 프로젝트의 중단점과 위치를 해석할 수 없는 항목은 손대지 않는다(`untouched`).
	 */
	async reconcileAll(): Promise<ReconcileResult> {
		const empty = { added: 0, removed: 0, kept: 0, failed: 0, untouched: 0 };
		if (!this.deps.isConnected()) {
			this.deps.log('[BP Sync] 제어기 미연결 — 중단점 맞추기 생략.');
			return { ...empty, ok: false, error: 'not-connected' };
		}
		const project = (await this.deps.resolveProjectName()).trim();
		if (!project) {
			this.deps.log('[BP Sync] 프로젝트명을 확정할 수 없어 중단점 맞추기를 생략합니다 (Project.gpr 확인).');
			return { ...empty, ok: false, error: 'missing-project' };
		}

		let showResp: string | null = null;
		try {
			showResp = await sendCommand('Show Break');
		} catch (err) {
			this.deps.log(`[BP Sync] Show Break 실패 — ${err instanceof Error ? err.message : String(err)}`);
		}
		if (!showResp || !isSuccess(showResp)) {
			this.deps.log('[BP Sync] Show Break 응답을 판정할 수 없어 중단점 맞추기를 중단합니다 (제어기 상태를 모르는 채로 해제하지 않는다).');
			return { ...empty, ok: false, error: 'show-break-failed' };
		}

		const { targets, untouched } = controllerTargets(parseBreakList(showResp), project);
		const plan: ReconcilePlan = planReconcile(targets, editorBreakpointTargets(), untouched);

		let added = 0, removed = 0, failed = 0;
		for (const t of plan.toRemove) {
			if (await this._send('Nobreak', project, t.file, t.line)) { removed++; } else { failed++; }
		}
		for (const t of plan.toAdd) {
			if (await this._send('Break', project, t.file, t.line)) {
				added++;
				this._trackTarget(project, t);
			} else {
				failed++;
			}
		}
		// 이미 양쪽에 있던 것도 추적에 넣어 둔다 — 이후 F9 제거가 기록 기준으로 정확히 지워진다.
		for (const t of plan.kept) { this._trackTarget(project, t); }

		if (added > 0 || removed > 0) {
			this.deps.onDidSync?.();
		}
		this.deps.log(`[BP Sync] 중단점 맞추기: 설정 ${added}, 해제 ${removed}, 유지 ${plan.kept.length}, 실패 ${failed}, 손대지 않음 ${plan.untouched}`);
		return { added, removed, kept: plan.kept.length, failed, untouched: plan.untouched, ok: true };
	}

	/** 위치가 같은 에디터 중단점을 찾아 전송 기록에 넣는다 (reconcile 결과를 _tracked에 반영). */
	private _trackTarget(project: string, target: BreakpointTarget): void {
		for (const bp of vscode.debug.breakpoints) {
			const t = this._toTarget(bp);
			if (!t || !bp.enabled) { continue; }
			if (t.line === target.line && t.file.toLowerCase() === target.file.toLowerCase()) {
				this._tracked.set(bp.id, { project, file: t.file, line: t.line });
				return;
			}
		}
	}

	/**
	 * 연결 확립(false→true 에지) 시 호출 — 설정이 켜져 있으면 에디터 상태로 수렴시킨다.
	 *
	 * 종전에는 추가만 하는 `pushAll`이었다. 설정을 켠 것은 "에디터의 빨간 점이 단일 원본"을
	 * 선택한 것이므로, 연결 시점에 잔재까지 정리해 두는 편이 그 약속과 일치한다.
	 */
	onControllerConnected(): void {
		if (!this._isEnabled() || this.deps.isDebugSessionActive()) { return; }
		void this.reconcileAll().then(r => {
			if (r.ok && (r.added > 0 || r.removed > 0 || r.failed > 0)) {
				this.deps.log(`[BP Sync] 연결 직후 중단점 맞추기: 설정 ${r.added}, 해제 ${r.removed}, 실패 ${r.failed}`);
			}
		});
	}
}
