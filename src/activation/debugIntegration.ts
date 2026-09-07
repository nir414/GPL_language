/**
 * 디버그 세션 연동 — 클릭 즉시 값 표시, 소스 변경(BP 신뢰 불가) 상태(#21), 스레드 단일 실행 잠금,
 * 세션 시작/종료/커스텀 이벤트(gpl.sourceStale·gpl.threadLockChanged·gpl.controllerConnectionChanged·gpl.errorLocation).
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { isRuntimeConsoleAutoStartOnDebug } from '../config';
import { setSessionControllerOverride } from '../controller/controllerConnection';
import type { ExtensionHost } from './host';

function formatDebugErrorSummary(errorMessage: unknown, errorCode: unknown, fallback: string): string {
	const message = typeof errorMessage === 'string' ? errorMessage.trim() : '';
	const code = typeof errorCode === 'number' && Number.isFinite(errorCode) ? errorCode : undefined;
	if (message && code !== undefined && !message.includes(String(code))) {
		return `${message} (STATUS ${code})`;
	}
	if (message) {
		return message;
	}
	if (code !== undefined) {
		return `STATUS ${code}`;
	}
	return fallback || 'Error';
}

export function activateDebugIntegration(host: ExtensionHost): void {
	const { context, outputChannel } = host;

	// ── 디버그 중 클릭 즉시 변수 값 표시 ──────────────────────────
	// 호버는 editor.hover.delay + 마우스 정지 대기 때문에 체감이 느리다.
	// 마우스 클릭으로 커서를 식별자 위에 놓으면 내장 debug hover를 즉시 띄운다.
	// 키보드 커서 이동은 제외(kind !== Mouse). gpl.debug.showValueOnCursorClick로 끌 수 있음.
	context.subscriptions.push(
		vscode.window.onDidChangeTextEditorSelection(e => {
			if (!host.isDebugSessionActive) { return; }
			if (e.kind !== vscode.TextEditorSelectionChangeKind.Mouse) { return; }
			const editor = e.textEditor;
			if (editor.document.languageId !== 'gpl') { return; }
			const sel = e.selections[0];
			if (!sel || !sel.isSingleLine) { return; }
			// 클릭(빈 선택)·더블클릭(단어 선택)만 처리 — 긴 드래그 선택은 제외
			if (!sel.isEmpty && editor.document.getText(sel).length > 64) { return; }
			// 식별자 위가 아니면 무시 (빈 공간 클릭 시 불필요한 hover 방지)
			if (!editor.document.getWordRangeAtPosition(sel.active)) { return; }
			const cfg = vscode.workspace.getConfiguration('gpl.debug');
			if (!cfg.get<boolean>('showValueOnCursorClick', true)) { return; }
			// showDebugHover는 focus=true가 하드코딩되어(VS Code debugEditorActions.ts)
			// 키보드 포커스가 hover 위젯으로 이동 → editorTextFocus가 꺼져서
			// editorTextFocus 조건의 키바인딩(F9/F8 toggleBreakpoint 등)이 클릭 직후
			// 동작하지 않는 부작용이 있었다. debug hover는 포커스를 잃어도 닫히지 않으므로
			// (에디터 keydown/스크롤/클릭 시 닫힘) 표시 직후 포커스를 에디터로 되돌려
			// 값 표시와 키바인딩을 모두 살린다.
			void vscode.commands.executeCommand('editor.debug.action.showDebugHover')
				.then(() => vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup'))
				.then(undefined, () => undefined);
		})
	);
	// ── 소스 변경(BP 신뢰 불가) 상태 보기/조치 (GitHub #21) — 상태바 배지 클릭 ──
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.debug.showSourceStale', async () => {
			const s = host.lastSourceStale;
			if (!s || s.files.length === 0) {
				vscode.window.showInformationMessage('소스 변경(BP 신뢰 불가) 상태가 아닙니다.');
				return;
			}
			const session = vscode.debug.activeDebugSession;
			type Pick = vscode.QuickPickItem & { action: 'restart' | 'dismiss' | 'open'; file?: string };
			const restartItem: Pick = {
				action: 'restart',
				label: '$(debug-restart) Stop + Upload + Run 으로 재시작',
				description: '현재 세션을 끊고 deployBeforeAttach·stopAllBeforeAttach 구성으로 다시 시작',
				detail: `변경된 파일 ${s.files.length}개를 업로드·Compile 한 뒤 attach — 프로그램이 정지·재시작됩니다(저속/시뮬레이션 권장)`,
			};
			const dismissItem: Pick = { action: 'dismiss', label: '$(eye-closed) 이 세션 동안 배지 숨기기' };
			const fileItems: Pick[] = s.files.map(f => ({ action: 'open', label: `$(file-code) ${f}`, description: '열기', file: f }));
			const pick = await vscode.window.showQuickPick<Pick>([restartItem, ...fileItems, dismissItem], {
				placeHolder: `${s.projectName}: 제어기 컴파일 코드보다 새로운 소스 ${s.files.length}개 — BP가 실제 코드 줄에 걸리지 않을 수 있습니다` +
					(s.compiledAt ? ` (마지막 Compile ${new Date(s.compiledAt).toLocaleString()})` : ''),
			});
			if (!pick) { return; }
			if (pick.action === 'dismiss') {
				host.statusBar?.setSourceStale(undefined);
				return;
			}
			if (pick.action === 'restart') {
				if (!session || session.type !== 'brooks-gpl') {
					vscode.window.showWarningMessage('활성 brooks-gpl 디버그 세션이 없습니다. F5 로 "Stop + Upload + Run" 구성을 직접 시작하세요.');
					return;
				}
				const confirm = await vscode.window.showWarningMessage(
					'디버그 세션을 끊고 Stop + Upload + Run(재배포) 구성으로 다시 시작할까요?',
					{
						modal: true,
						detail: '실행 중인 쓰레드가 있으면 정지 확인 후 Compile 하고 attach 합니다. 정지·재시작으로 모션 프로그램이 처음부터 다시 실행될 수 있습니다.',
					},
					'재시작',
				);
				if (confirm !== '재시작') { return; }
				const folder = session.workspaceFolder;
				const config = { ...session.configuration, deployBeforeAttach: true, stopAllBeforeAttach: true };
				await vscode.debug.stopDebugging(session);
				const started = await vscode.debug.startDebugging(folder, config);
				host.log(`[Debug] 소스 변경 → 재배포 재시작(${config.name ?? 'attach'}): ${started ? '시작됨' : '시작 실패'}`);
				return;
			}
			if (pick.file) {
				// 이벤트의 경로는 프로젝트 폴더 기준 상대 경로 — 워크스페이스에서 끝부분이 일치하는 파일을 찾아 연다.
				const rel = pick.file.replace(/\\/g, '/');
				const base = rel.split('/').pop() ?? rel;
				const found = await vscode.workspace.findFiles(`**/${base}`, '**/node_modules/**', 20);
				const match = found.find(u => u.fsPath.replace(/\\/g, '/').toLowerCase().endsWith(rel.toLowerCase())) ?? found[0];
				if (match) {
					await vscode.window.showTextDocument(match, { preview: false });
				} else {
					vscode.window.showWarningMessage(`파일을 찾지 못했습니다: ${pick.file}`);
				}
			}
		})
	);


	// ── 스레드 단일 실행 잠금 (CALL STACK 우클릭 · 명령 팔레트 · 상태바) ──────────────────
	// 왜: GPL 제어기의 실행 명령은 스레드 단위(`Continue <이름>`)인데 대상은 VS Code 포커스
	// 스레드가 결정한다. 다중 스레드에서 다른 스레드가 브레이크포인트에 걸리면 포커스가 그쪽으로
	// 옮겨가고, 그 상태의 F5/F10 은 의도하지 않은 스레드를 움직인다(모션 영향 가능). 잠금을 걸면
	// 어댑터가 실행 명령 대상을 잠근 스레드로 되돌리고, 다른 스레드의 정지는 포커스를 훔치지 않는다.
	// 제어기로 나가는 명령은 없다 — 대상 선택만 바꾸는 UI 기능이다.
	const gplDebugSessionForLock = (): vscode.DebugSession | undefined => {
		const session = vscode.debug.activeDebugSession;
		return session?.type === 'brooks-gpl' ? session : undefined;
	};

	const applyThreadLockState = (name?: string): void => {
		host.statusBar?.setThreadLock(name);
	};

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.debug.lockThread', async (arg?: { threadId?: number; sessionId?: string }) => {
			const session = gplDebugSessionForLock();
			if (!session) {
				vscode.window.showWarningMessage('GPL 디버그 세션이 활성일 때만 스레드 실행 잠금을 걸 수 있습니다.');
				return;
			}
			// CALL STACK 우클릭은 { sessionId, threadId } 를 넘긴다. 없으면 활성 스택 항목 → QuickPick 순.
			let threadId: number | undefined = typeof arg?.threadId === 'number' ? arg.threadId : undefined;
			if (threadId === undefined) {
				const activeItem = (vscode.debug as any).activeStackItem;
				if (activeItem && typeof activeItem.threadId === 'number' && activeItem.session?.id === session.id) {
					threadId = activeItem.threadId;
				}
			}
			let name: string | undefined;
			if (threadId === undefined) {
				try {
					const list = await session.customRequest('gplThreadList');
					const threads: { id: number; name: string; state: string | null }[] = list?.threads ?? [];
					if (!threads.length) {
						vscode.window.showWarningMessage('잠글 스레드를 찾지 못했습니다 (스레드 목록이 비어 있음).');
						return;
					}
					const pick = await vscode.window.showQuickPick(
						threads.map(t => ({
							label: t.name,
							description: t.state ?? '',
							detail: list?.locked === t.name ? '현재 잠긴 스레드' : undefined,
							thread: t,
						})),
						{ title: '실행을 잠글 스레드 선택 (Continue/Step 이 이 스레드에만 나갑니다)' },
					);
					if (!pick) { return; }
					name = pick.thread.name;
				} catch (err: any) {
					vscode.window.showErrorMessage(`스레드 목록 조회 실패: ${err?.message ?? err}`);
					return;
				}
			}
			try {
				const res = await session.customRequest('gplLockThread', name ? { name } : { threadId });
				if (!res?.locked) {
					vscode.window.showWarningMessage('스레드 실행 잠금 실패 — 해당 스레드를 찾을 수 없습니다.');
					return;
				}
				applyThreadLockState(res.name);
				host.log(`[ThreadLock] 잠금: ${res.name} — Continue/Step 은 포커스와 무관하게 이 스레드에만 나갑니다`);
			} catch (err: any) {
				vscode.window.showErrorMessage(`스레드 실행 잠금 실패: ${err?.message ?? err}`);
			}
		}),
		vscode.commands.registerCommand('gpl.debug.unlockThread', async () => {
			const session = gplDebugSessionForLock();
			if (!session) {
				applyThreadLockState(undefined);
				return;
			}
			try {
				const res = await session.customRequest('gplUnlockThread');
				applyThreadLockState(undefined);
				if (res?.previous) { host.log(`[ThreadLock] 해제: ${res.previous}`); }
			} catch (err: any) {
				host.log(`[ThreadLock] 해제 실패(무시): ${err?.message ?? err}`);
				applyThreadLockState(undefined);
			}
		}),
		vscode.commands.registerCommand('gpl.debug.toggleThreadLock', async () => {
			const session = gplDebugSessionForLock();
			if (!session) {
				vscode.window.showWarningMessage('GPL 디버그 세션이 활성일 때만 스레드 실행 잠금을 사용할 수 있습니다.');
				return;
			}
			let locked: string | null = null;
			try {
				const state = await session.customRequest('gplLockState');
				locked = state?.name ?? null;
			} catch { /* 상태 조회 실패 시 잠금 시도로 진행 */ }
			await vscode.commands.executeCommand(locked ? 'gpl.debug.unlockThread' : 'gpl.debug.lockThread');
		}),
	);
	// 디버그 세션 중 사이드바 폴링 일시 중지 (TCP 충돌 방지)
	context.subscriptions.push(
		vscode.debug.onDidStartDebugSession(session => {
			if (session.type === 'brooks-gpl') {
				host.isDebugSessionActive = true;
				host.updateUiContexts(host.controllerTree?.isConnected ?? host.statusBar?.isConnected ?? false);
				host.ensureAgentBridge()?.setState({ debugSessionActive: true });
				const projectFromDebugConfig = (session.configuration?.projectName || '').toString().trim();
				if (projectFromDebugConfig) {
					host.controllerTree?.setExpectedProjectName(projectFromDebugConfig);
					host.log(`[ProjectContext] expected project (debug config): ${projectFromDebugConfig}`);
				} else {
					host.project.scheduleExpectedProjectSync('debug session started');
				}
				host.controllerTree?.enterDebugMode();
				if (isRuntimeConsoleAutoStartOnDebug(vscode.workspace)) {
					// 디버그 attach 시 1403 런타임 콘솔 자동 시작 (start()는 idempotent).
					try { host.ensureRuntimeConsole(); } catch (err: any) {
						host.log(`[Console] auto-start on debug failed: ${err?.message ?? err}`);
					}
				}
			}
		}),
		vscode.debug.onDidTerminateDebugSession(session => {
			if (session.type === 'brooks-gpl') {
				host.isDebugSessionActive = false;
				host.updateUiContexts(host.controllerTree?.isConnected ?? host.statusBar?.isConnected ?? false);
				host.ensureAgentBridge()?.setState({ debugSessionActive: false });
				host.controllerTree?.exitDebugMode();
				host.lastSourceStale = undefined;
				host.statusBar?.setSourceStale(undefined);
				host.lastRuntimeErrorContext = undefined;
				host.controllerTree?.setRuntimeErrorContext(undefined);
				// 스레드 실행 잠금은 세션과 함께 사라진다 — 상태바 표시도 내린다.
				host.statusBar?.setThreadLock(undefined);
			}
		}),
		vscode.debug.onDidReceiveDebugSessionCustomEvent(async event => {
			if (event.session.type !== 'brooks-gpl') { return; }
			if (event.event === 'gpl.sourceStale') {
				// Attach only 디버깅: 제어기 컴파일 코드보다 새로운 소스 파일 목록(빈 목록 = 해소). GitHub #21.
				const body = (event.body ?? {}) as { projectName?: string; compiledAt?: number; staleFiles?: string[]; trigger?: string };
				const files = Array.isArray(body.staleFiles) ? body.staleFiles.map(String) : [];
				host.lastSourceStale = files.length ? { projectName: String(body.projectName ?? ''), files, compiledAt: body.compiledAt } : undefined;
				host.statusBar?.setSourceStale(host.lastSourceStale);
				if (files.length) {
					host.log(`[Debug] 소스 변경됨 — BP 신뢰 불가 ${files.length}개 (${body.trigger ?? 'attach'}): ${files.join(', ')}`);
					if (host.sourceStaleNotifiedSessionId !== event.session.id) {
						host.sourceStaleNotifiedSessionId = event.session.id;
						void vscode.window.showWarningMessage(
							`소스 변경됨 — 브레이크포인트 신뢰 불가 (${files.length}개 파일이 제어기 컴파일 코드보다 새로움)`,
							'조치 보기',
						).then(pick => { if (pick === '조치 보기') { void vscode.commands.executeCommand('gpl.debug.showSourceStale'); } });
					}
				} else if (body.trigger === 'recompiled') {
					host.log('[Debug] 소스 변경 상태 해소 — 재컴파일로 BP 신뢰성 복원');
				}
				return;
			}
			if (event.event === 'gpl.threadLockChanged') {
				// 스레드 단일 실행 잠금 상태 변경(어댑터가 잠근 스레드 종료를 감지해 스스로 해제하는 경우 포함).
				const name = (event.body ?? {}).threadName;
				host.statusBar?.setThreadLock(typeof name === 'string' && name ? name : undefined);
				return;
			}
			if (event.event === 'gpl.controllerConnectionChanged') {
				const body = (event.body ?? {}) as {
					connected?: boolean;
					ip?: string;
					port?: number;
					projectName?: string;
				};

				if (body.connected) {
					const ip = (body.ip || '').trim();
					if (ip) {
						setSessionControllerOverride(ip, body.port);
					}
					const projectName = (body.projectName || '').trim();
					if (projectName) {
						host.controllerTree?.setExpectedProjectName(projectName);
					}
					host.setControllerConnected(true, { refreshTree: !host.isDebugSessionActive });
					if (host.isDebugSessionActive) {
						host.controllerTree?.enterDebugMode();
					}
					host.log(`[Controller] Connected via debug adapter${ip ? `: ${ip}${body.port ? `:${body.port}` : ''}` : ''}`);
				} else {
					// 어댑터가 Show Thread 폴 연속 실패로 세션을 끝냈다. 어댑터 폴 결과는 debugBridge 로 이미 보고돼 있어 대개
					// 유실이 확정된 뒤지만, 아니라면 힌트로 받아 자체 프로브로 확인한다 — 간접 신호로 단정하지 않는다(2026-08-28).
					const reason = String((body as { reason?: unknown }).reason ?? 'debug adapter reported disconnected');
					host.log(`[Controller] Debug adapter reported connection loss — ${reason}`);
					host.healthMonitor?.reportHint('debug-adapter', reason);
				}
				return;
			}
			if (event.event !== 'gpl.errorLocation') { return; }

			const body = (event.body ?? {}) as {
				threadId?: number;
				threadName?: string;
				file?: string;
				line?: number;
				process?: string;
				statusText?: string;
				errorCode?: number;
				errorMessage?: string;
				errorLogLines?: string[];
				lastCommand?: string;
				firstSeenAt?: string;
				stackFrames?: string[];
				relatedFunctions?: string[];
			};

			const threadName = body.threadName || 'unknown-thread';
			const statusText = body.statusText || 'Error';
			const errorSummary = formatDebugErrorSummary(body.errorMessage, body.errorCode, statusText);
			const line = typeof body.line === 'number' ? body.line : 0;
			const file = (body.file || '').trim();
			host.lastRuntimeErrorContext = {
				threadName,
				threadId: body.threadId,
				lastCommand: body.lastCommand,
				firstSeenAt: body.firstSeenAt,
				statusText: errorSummary,
				stackFrames: body.stackFrames,
				relatedFunctions: body.relatedFunctions,
			};
			host.controllerTree?.setRuntimeErrorContext(host.lastRuntimeErrorContext);

			let targetPath = '';
			if (file) {
				if (path.isAbsolute(file) && fs.existsSync(file)) {
					targetPath = file;
				} else {
					targetPath = host.project.resolveGplFilePath(path.basename(file)) || '';
				}
			}

			if (targetPath && line > 0) {
				try {
					const doc = await vscode.workspace.openTextDocument(targetPath);
					const editor = await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: false });
					const lineIndex = Math.max(0, line - 1);
					const targetLine = doc.lineAt(Math.min(lineIndex, Math.max(0, doc.lineCount - 1))).range;
					host.decorations.showError(editor, targetLine);
					editor.selection = new vscode.Selection(targetLine.start, targetLine.start);
					editor.revealRange(targetLine, vscode.TextEditorRevealType.InCenterIfOutsideViewport);

					host.log(`[Debug Error] ${threadName} @ ${path.basename(targetPath)}:${line} (${body.process || '-'}) - ${errorSummary}`);
					if (Array.isArray(body.errorLogLines) && body.errorLogLines.length > 0) {
						for (const errorLine of body.errorLogLines.slice(0, 3)) {
							host.log(`[Debug ErrorLog] ${errorLine}`);
						}
					}
					outputChannel.show(true);
					void vscode.window.showWarningMessage(
						`디버그 에러: ${errorSummary} @ ${path.basename(targetPath)}:${line} (${threadName})`,
					);
					return;
				} catch (err: any) {
					host.log(`[Debug Error] 위치 표시 실패: ${err?.message ?? err}`);
				}
			}

			host.log(`[Debug Error] ${threadName} - ${errorSummary} (소스 위치 해석 실패)`);
			if (Array.isArray(body.errorLogLines) && body.errorLogLines.length > 0) {
				for (const errorLine of body.errorLogLines.slice(0, 3)) {
					host.log(`[Debug ErrorLog] ${errorLine}`);
				}
			}
			outputChannel.show(true);
		}),
	);
}
