/**
 * 중단점 명령 — 제어기→에디터 미러(§1-CO)·에디터→제어기 실시간 동기화(§1-AP)·pull/push/sync/해제(§1-CJ).
 */

import * as vscode from 'vscode';
import { MirrorEchoMemory } from '../controller/breakpointCommand';
import { ControllerBreakpointMirror } from '../controller/breakpointMirror';
import { EditorBreakpointSync } from '../controller/breakpointSync';
import type { ExtensionHost } from './host';

export function activateBreakpointCommands(host: ExtensionHost): void {
	const { context } = host;

	// 제어기 → 에디터 중단점 미러 (§1-CO). AI(MCP·URI·명령 콘솔)가 건 BP를 그 자리에서 빨간 점으로
	// 만든다 — 종전에는 제어기에만 존재해 보이지 않았고, reconcile/DAP가 "에디터에 없는 BP"로 보고
	// 지워 버렸다. 에코 메모리는 미러가 만든 에디터 변경이 다시 제어기로 나가지 않게 막는다.
	const bpMirrorEcho = new MirrorEchoMemory();
	host.breakpointMirror = new ControllerBreakpointMirror({
		isEnabled: () => vscode.workspace.getConfiguration('gpl.controller')
			.get<boolean>('mirrorAiBreakpoints') !== false,
		resolveFilePath: fileName => host.project.resolveGplFilePath(fileName),
		log: line => host.log(line),
		noteMirrored: (kind, file, line) => bpMirrorEcho.note(kind, file, line),
	});

	// 에디터 중단점 → 제어기 실시간 동기화 (설정 gpl.controller.syncEditorBreakpoints, §1-AP).
	// VS Code 중단점을 단일 원본으로 삼고, 외부 AI(MCP)가 건 BP도 위 미러를 거쳐 그 원본에 합류시킨다.
	host.breakpointSync = new EditorBreakpointSync({
		mirrorEcho: bpMirrorEcho,
		isConnected: () => host.controllerTree?.isConnected ?? false,
		isDebugSessionActive: () => host.isDebugSessionActive,
		resolveProjectName: () => host.project.resolveExpectedProjectName(),
		log: line => host.log(line),
		// 동기화 배치 직후 트리의 중단점 섹션을 즉시 갱신 (다음 상세 폴링까지 기다리지 않음)
		onDidSync: () => { void host.controllerTree?.refreshBreakpointsNow(); },
		// 실시간 동기화가 꺼진 채로 중단점을 건드렸다 — 에디터의 빨간 점과 제어기가 어긋나는
		// 유일한 경로이므로 조용히 넘기지 않고 조치 수단과 함께 알린다 (§1-CJ).
		onUnsyncedChange: () => { void notifyBreakpointsNotSynced(); },
	});
	context.subscriptions.push(host.breakpointSync);

	// 트리 중단점 섹션 인라인 새로고침 — Show Break 1회만 재조회 (전체 새로고침보다 가볍다)
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.refreshBreakpoints', async () => {
			const list = await host.controllerTree?.refreshBreakpointsNow();
			if (!list) {
				vscode.window.showWarningMessage('GPL: 제어기 미연결 — 브레이크포인트를 조회할 수 없습니다.');
			}
		})
	);

	// 트리 중단점 항목 클릭 → 해당 위치 열기 (줄 번호는 배포본 기준 — 로컬 수정 시 어긋날 수 있음)
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.openBreakpointLocation', async (args?: { file?: string; line?: number }) => {
			const file = args?.file;
			const line = args?.line ?? 0;
			if (!file || line <= 0) { return; }
			const filePath = host.project.resolveGplFilePath(file);
			if (!filePath) {
				vscode.window.showWarningMessage(`GPL: "${file}"을 워크스페이스에서 찾을 수 없습니다.`);
				return;
			}
			const doc = await vscode.workspace.openTextDocument(filePath);
			const editor = await vscode.window.showTextDocument(doc, { preview: false });
			const lineIdx = Math.min(line - 1, doc.lineCount - 1);
			editor.revealRange(new vscode.Range(lineIdx, 0, lineIdx, 0), vscode.TextEditorRevealType.InCenter);
			editor.selection = new vscode.Selection(lineIdx, 0, lineIdx, 0);
		})
	);

	// 제어기 중단점 → 에디터 가져오기 (단발 pull — 사용자가 명시 실행할 때만, 상시 미러링 아님).
	// 에디터에 이미 있는 위치는 건너뛰므로 동기화 리스너와의 에코는 신규 항목에만 발생(멱등이라 무해).
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.pullBreakpoints', async () => {
			const list = await host.controllerTree?.refreshBreakpointsNow();
			if (!list) {
				vscode.window.showWarningMessage('GPL: 제어기 미연결 — 중단점을 가져올 수 없습니다.');
				return { ok: false, error: 'not-connected' };
			}
			let added = 0, existing = 0, unresolved = 0;
			const toAdd: vscode.SourceBreakpoint[] = [];
			for (const bp of list) {
				if (!bp.file || bp.fileLine <= 0) { unresolved++; continue; }
				const filePath = host.project.resolveGplFilePath(bp.file);
				if (!filePath) {
					unresolved++;
					host.log(`[BP Pull] 파일 미해석: ${bp.file}:${bp.fileLine} (${bp.project})`);
					continue;
				}
				const uri = vscode.Uri.file(filePath);
				const lineIdx = bp.fileLine - 1;
				const already = vscode.debug.breakpoints.some(b =>
					b instanceof vscode.SourceBreakpoint &&
					b.location.uri.fsPath.toLowerCase() === uri.fsPath.toLowerCase() &&
					b.location.range.start.line === lineIdx);
				if (already) { existing++; continue; }
				toAdd.push(new vscode.SourceBreakpoint(new vscode.Location(uri, new vscode.Position(lineIdx, 0))));
				added++;
			}
			if (toAdd.length > 0) {
				vscode.debug.addBreakpoints(toAdd);
			}
			const msg = `제어기 중단점 가져오기: 추가 ${added}, 이미 있음 ${existing}, 해석 불가 ${unresolved}` +
				(added > 0 ? ' (줄 번호는 배포본 기준)' : '');
			host.log(`[BP Pull] ${msg}`);
			vscode.window.showInformationMessage(`GPL: ${msg}`);
			return { ok: true, added, existing, unresolved };
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.pushBreakpoints', async () => {
			const result = await host.breakpointSync!.pushAll();
			const msg = `에디터 중단점 push: 성공 ${result.sent}, 실패 ${result.failed}, 제외 ${result.skipped}`;
			host.log(`[BP Sync] ${msg}`);
			if (result.failed > 0) {
				vscode.window.showWarningMessage(`GPL: ${msg} — 자세한 내용은 GPL Output 확인`);
			} else {
				vscode.window.showInformationMessage(`GPL: ${msg}`);
			}
			return result;
		})
	);

	// 제어기를 에디터 상태로 수렴(§1-CJ) — 에디터에 없는 잔재 중단점을 해제하고 빠진 것은 설정한다.
	// push(추가만)와 달리 "빨간 점은 없는데 제어기는 브레이크를 거는" 상태를 한 번에 없앤다.
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.syncBreakpoints', async () => {
			const result = await host.breakpointSync!.reconcileAll();
			if (!result.ok) {
				const reason = result.error === 'not-connected' ? '제어기 미연결'
					: result.error === 'missing-project' ? '프로젝트명 미확정 (Project.gpr 확인)'
						: 'Show Break 응답 판정 실패';
				vscode.window.showWarningMessage(`GPL: 중단점을 맞출 수 없습니다 — ${reason}`);
				return result;
			}
			const msg = `중단점 맞추기: 설정 ${result.added}, 해제 ${result.removed}, 유지 ${result.kept}`
				+ (result.failed > 0 ? `, 실패 ${result.failed}` : '')
				+ (result.untouched > 0 ? ` (다른 프로젝트 ${result.untouched}개는 손대지 않음)` : '');
			if (result.failed > 0) {
				vscode.window.showWarningMessage(`GPL: ${msg} — 자세한 내용은 GPL Output 확인`);
			} else {
				vscode.window.showInformationMessage(`GPL: ${msg}`);
			}
			return result;
		})
	);

	// 트리의 제어기 중단점 항목 우클릭 → 그 중단점만 제어기에서 해제.
	// 같은 위치에 에디터 중단점이 있으면 미러가 그 빨간 점도 함께 지운다(§1-CO) — 주 용도인
	// "⚠ 에디터에 없음" 잔재는 지울 점이 없으므로 종전과 동작이 같다.
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.clearBreakpointHere', async (arg?: any) => {
			// 우클릭 메뉴는 트리 노드를 그대로 넘기고(InfoNode), 명령 팔레트/코드 호출은 {file, line}을 넘긴다.
			const args: { file?: string; line?: number } =
				arg && (arg.file || arg.line) ? arg : (arg?.command?.arguments?.[0] ?? {});
			const file = args.file;
			const line = args.line ?? 0;
			if (!file || line <= 0) { return { ok: false, error: 'missing-file-or-line' }; }
			const result = await vscode.commands.executeCommand<{ ok: boolean; status?: { code: number; message: string } }>(
				'gpl.ai.debug.clearBreakpoint', { file, line });
			if (result?.ok) {
				vscode.window.showInformationMessage(`GPL: 제어기 중단점 해제 — ${file}:${line}`);
			} else {
				const st = result?.status;
				vscode.window.showWarningMessage(
					`GPL: 중단점 해제 실패 — ${file}:${line}${st ? ` (STATUS ${st.code}${st.message ? `: ${st.message}` : ''})` : ''}`);
			}
			await host.controllerTree?.refreshBreakpointsNow();
			return result;
		})
	);

	// 실시간 동기화 꺼짐 안내 — 세션당 1회, "다시 보지 않기"는 전역 저장.
	const BP_UNSYNCED_MUTE_KEY = 'gpl.bpUnsyncedNoticeMuted';
	let bpUnsyncedNoticeShown = false;
	async function notifyBreakpointsNotSynced(): Promise<void> {
		if (bpUnsyncedNoticeShown || context.globalState.get<boolean>(BP_UNSYNCED_MUTE_KEY) === true) { return; }
		bpUnsyncedNoticeShown = true;
		const turnOn = '실시간 동기화 켜기';
		const syncNow = '지금 한 번 맞추기';
		const mute = '다시 보지 않기';
		const picked = await vscode.window.showWarningMessage(
			'GPL: 에디터 중단점 변경이 제어기에 반영되지 않았습니다 — 제어기에 이전 중단점이 남아 실행 시 그 자리에서 멈출 수 있습니다.',
			turnOn, syncNow, mute);
		if (picked === turnOn) {
			await vscode.workspace.getConfiguration('gpl.controller')
				.update('syncEditorBreakpoints', true, vscode.ConfigurationTarget.Global);
			host.log('[BP Sync] 실시간 동기화를 켰습니다 (gpl.controller.syncEditorBreakpoints = true).');
			await vscode.commands.executeCommand('gpl.controller.syncBreakpoints');
		} else if (picked === syncNow) {
			await vscode.commands.executeCommand('gpl.controller.syncBreakpoints');
		} else if (picked === mute) {
			await context.globalState.update(BP_UNSYNCED_MUTE_KEY, true);
			host.log('[BP Sync] 동기화 꺼짐 안내를 더 이상 표시하지 않습니다 (GPL: Sync Breakpoints 명령으로 언제든 맞출 수 있습니다).');
		}
	}
}
