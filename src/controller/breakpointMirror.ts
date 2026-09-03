import * as vscode from 'vscode';
import { BreakpointCommandKind, parseBreakpointCommand } from './breakpointCommand';

/**
 * 제어기 → 에디터 중단점 미러 (AI/외부가 건 BP를 빨간 점으로 보이게 한다).
 *
 * 배경: §1-AP는 "에디터가 단일 원본"을 택하면서 역방향 미러링을 두지 않았다. 그 결과
 * MCP·URI·명령 콘솔로 건 BP는 제어기에만 존재해 에디터에 **아무 표시도 없었고**, 제어기 트리의
 * `⚠ 에디터에 없음` 배지로만 알 수 있었다. 게다가 `syncEditorBreakpoints`가 켜져 있으면 다음
 * `reconcileAll()`이 "에디터에 없는 BP"로 보고 해제해 버렸다(디버그 세션 중에는 DAP의
 * `setBreakPointsRequest`가 같은 일을 파일 단위로 한다).
 *
 * 그래서 **AI가 건 BP는 걸리는 즉시 에디터에도 추가**한다. 이러면
 * - 사용자가 빨간 점으로 AI의 중단점을 보고 F9로 지울 수 있고,
 * - "에디터 = 단일 원본" 규약이 깨지지 않는다(제어기에만 있는 BP가 생기지 않으므로
 *   reconcile·DAP가 지워 버리는 일도 없다).
 *
 * 적용 지점은 **외부 진입점뿐**이다 — `gpl.controller.sendCommand`(브리지/URI 인자 경로)와
 * `gpl.ai.debug.setBreakpoint/clearBreakpoint`. DAP와 `EditorBreakpointSync`는 in-process로
 * `sendCommand()`를 직접 부르므로 여기 걸리지 않는다(그쪽은 이미 에디터가 원본이라 미러가 불필요하고,
 * DAP의 "파일 전체 Nobreak 후 재설정"을 미러링하면 빨간 점이 깜빡이고 조건/로그포인트 메타가 날아간다).
 *
 * 해제(`Set Nobreak`)도 미러한다 — 제어기에서 사라진 BP의 빨간 점을 남겨 두면 그것이야말로 어긋남이다.
 * 다만 `run_to_line`처럼 스스로 정리하는 임시 BP는 호출 측에서 `mirrorBreakpoints: false`로 제외한다.
 */

export type MirrorSkipReason =
	/** 설정(`gpl.controller.mirrorAiBreakpoints`)이 꺼져 있음 */
	| 'disabled'
	/** BP 설정/해제 명령이 아님 */
	| 'not-breakpoint-command'
	/** 워크스페이스에서 해당 파일을 찾지 못함(배포본에만 있는 소스 등) */
	| 'unresolved-file'
	/** 이미 같은 위치에 에디터 중단점이 있음 */
	| 'already-present'
	/** 지울 에디터 중단점이 없음 */
	| 'not-present';

export interface MirrorResult {
	/** 에디터 중단점을 실제로 추가/제거했는지 */
	mirrored: boolean;
	kind?: BreakpointCommandKind;
	file?: string;
	line?: number;
	reason?: MirrorSkipReason;
}

export interface BreakpointMirrorDeps {
	/** 미러 사용 여부 (설정) */
	isEnabled(): boolean;
	/** 파일명(베이스네임) → 워크스페이스 절대 경로. 찾지 못하면 undefined. */
	resolveFilePath(fileName: string): string | undefined;
	log(line: string): void;
	/**
	 * 미러가 유발한 에디터 변경임을 알린다 — `EditorBreakpointSync`가 이 변경을 제어기로
	 * 되쏘지 않게 하는 에코 차단용. 미러가 에디터를 바꾸기 **직전에** 호출한다.
	 */
	noteMirrored?(kind: BreakpointCommandKind, file: string, line: number): void;
}

export class ControllerBreakpointMirror {
	constructor(private readonly deps: BreakpointMirrorDeps) { }

	/** 원시 명령 문자열(`Set Break …`)을 해석해 미러한다. BP 명령이 아니면 아무것도 하지 않는다. */
	applyCommand(command: string): MirrorResult {
		const parsed = parseBreakpointCommand(command);
		if (!parsed) { return { mirrored: false, reason: 'not-breakpoint-command' }; }
		return this.apply(parsed.kind, parsed.file, parsed.line);
	}

	apply(kind: BreakpointCommandKind, file: string, line: number): MirrorResult {
		const base: MirrorResult = { mirrored: false, kind, file, line };
		if (!this.deps.isEnabled()) { return { ...base, reason: 'disabled' }; }

		const fsPath = this.deps.resolveFilePath(file);
		if (!fsPath) {
			this.deps.log(`[BP Mirror] 파일 미해석 — 에디터에 표시하지 못했습니다: ${file}:${line}`);
			return { ...base, reason: 'unresolved-file' };
		}

		const uri = vscode.Uri.file(fsPath);
		const lineIdx = line - 1;
		const existing = vscode.debug.breakpoints.filter(bp =>
			bp instanceof vscode.SourceBreakpoint
			&& bp.location.uri.fsPath.toLowerCase() === uri.fsPath.toLowerCase()
			&& bp.location.range.start.line === lineIdx);

		if (kind === 'Break') {
			if (existing.length > 0) { return { ...base, reason: 'already-present' }; }
			this.deps.noteMirrored?.(kind, file, line);
			vscode.debug.addBreakpoints([
				new vscode.SourceBreakpoint(new vscode.Location(uri, new vscode.Position(lineIdx, 0))),
			]);
			this.deps.log(`[BP Mirror] 에디터에 중단점 추가: ${file}:${line}`);
			return { ...base, mirrored: true };
		}

		if (existing.length === 0) { return { ...base, reason: 'not-present' }; }
		this.deps.noteMirrored?.(kind, file, line);
		vscode.debug.removeBreakpoints(existing);
		this.deps.log(`[BP Mirror] 에디터 중단점 제거: ${file}:${line}`);
		return { ...base, mirrored: true };
	}
}
