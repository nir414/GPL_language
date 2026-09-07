/**
 * 제어기 트리 명령 — 새로고침·쓰레드 시작/정지/Break/Continue/Step·정지 위치 표시·스택 인스펙터·액션 QuickPick.
 */

import * as vscode from 'vscode';
import { sendCommand } from '../controller/controllerConnection';
import { isBusyStatus } from '../controller/controllerStatusCodes';
import { parseStack, parseStatus, parseThreadDetail } from '../controller/responseParser';
import { buildStepCommand } from '../controller/stepCommand';
import type { StepMode } from '../controller/stepCommand';
import { asThreadNode } from '../controller/threadArgs';
import { sendCommandWithBusyRetry, trySoftEStopRecovery, verifyThreadStopped, waitForThreadPause } from './controllerOps';
import type { ExtensionHost } from './host';

export function activateTreeCommands(host: ExtensionHost): void {
	const { context, outputChannel } = host;

	// FTP 파일 목록 새로고침
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.refreshFtp', () => {
			host.controllerTree?.refreshFtp();
		})
	);

	// 시스템 정보 새로고침
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.refreshSystemInfo', () => {
			host.controllerTree?.refreshSystemInfo();
		})
	);

	// 개별 쓰레드 시작/정지
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.threadStart', async (node: any) => {
			node = asThreadNode(node);
			if (!node?.thread?.name) { return; }
			// 업로드/컴파일 도중 Start가 겹치면 제어기 이상을 유발할 수 있다 — 배포 잠금(다른 창/프로세스 포함)으로 차단.
			const busy = host.currentDeployLockHolder();
			if (busy) {
				host.warnDeployBusy('쓰레드 시작', busy, '완료 후 쓰레드를 시작하세요');
				return;
			}
			// /GPL 소스가 Compile로 검증되지 않은 프로젝트면 안내(Start는 제어기가 자체 컴파일 — 소스 에러 시 Start 실패, §0.7).
			if (!(await host.deploy.confirmStartWhenCompileStale(node.thread.project || node.thread.name))) { return; }
			const busyAfter = host.currentDeployLockHolder();
			if (busyAfter) { host.warnDeployBusy('쓰레드 시작', busyAfter); return; }
			try {
				await sendCommand(`Start ${node.thread.name}`);
				host.controllerTree?.refresh();
			} catch (err: any) {
				vscode.window.showErrorMessage(`쓰레드 시작 실패: ${err.message ?? err}`);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.threadStop', async (node: any) => {
			node = asThreadNode(node);
			if (!node?.thread?.name) { return; }
			try {
				const threadName = node.thread.name;
				const stopResp = await sendCommandWithBusyRetry(host, `Stop ${threadName}`, { maxAttempts: 5, baseDelayMs: 400 });
				const status = parseStatus(stopResp);
				if (status.code !== 0 && !isBusyStatus(status.code)) {
					vscode.window.showErrorMessage(`쓰레드 정지 실패: STATUS ${status.code} ${status.message}`);
					return;
				}

				const stopped = await verifyThreadStopped(host, threadName, 7);
				if (!stopped) {
					const recovered = await trySoftEStopRecovery(host, threadName);
					if (!recovered) {
						vscode.window.showWarningMessage(`${threadName} 정지 명령은 전송됐지만 아직 실행 중일 수 있습니다. 잠시 후 다시 확인해줘.`);
					}
				} else {
					vscode.window.showInformationMessage(`${threadName} 정지 완료`);
				}
				host.controllerTree?.refresh();
			} catch (err: any) {
				vscode.window.showErrorMessage(`쓰레드 정지 실패: ${err.message ?? err}`);
			}
		})
	);

	// ─── 트리 쓰레드 제어(Break/Continue/Step) 공통 ─────────────────────
	// 하드 규칙 2: 성공/실패는 그 명령의 <STATUS>로 판정한다(이전엔 전송 후 바로 refresh만 했음).
	// Break/Step의 STATUS 0은 "접수"일 수 있어(§0.6 패턴) 실제 정지 복귀는 waitForThreadPause로 확인한다.
	async function sendThreadCommandChecked(cmd: string, failLabel: string): Promise<boolean> {
		const resp = await sendCommand(cmd);
		const status = parseStatus(resp);
		outputChannel.appendLine(`[Thread] >>> ${cmd} => STATUS ${status.code}${status.message ? ` ${status.message}` : ''}`);
		if (status.code !== 0) {
			vscode.window.showErrorMessage(`${failLabel} 실패: STATUS ${status.code} ${status.message}`);
			return false;
		}
		return true;
	}

	const TREE_STEP_LABEL: Record<StepMode, string> = { over: '스텝 오버', into: '스텝 인투', out: '스텝 아웃' };

	/**
	 * 트리 인라인/컨텍스트 메뉴의 Step. 명령 문자열은 디버그 어댑터·AI API와 같은 `aiBuildStepCommand`로 만든다
	 * (GDE 실측: over=`-over -noerror`, into=`-noerror`; out=`-out -noerror`는 Brooks 문서상 스위치 — 실기기 미검증).
	 * 정지 복귀가 확인되면 정지 위치를 에디터에 표시한다(설정 gpl.controller.autoShowPausedLocation, 기본 true).
	 */
	async function runTreeThreadStep(node: any, mode: StepMode): Promise<void> {
		node = asThreadNode(node);
		const name: string | undefined = node?.thread?.name;
		if (!name) { return; }
		const label = TREE_STEP_LABEL[mode];
		try {
			if (!(await sendThreadCommandChecked(buildStepCommand(name, mode), `${name} ${label}`))) { return; }
			const wait = await waitForThreadPause(name, 5000);
			host.controllerTree?.refresh();
			if (!wait.paused) {
				// 긴 모션 한 줄을 스텝하면 정지 복귀가 늦을 수 있다 — 팝업 대신 상태바/Output로만 알린다(트리 폴링이 이어서 갱신).
				vscode.window.setStatusBarMessage(`${name} ${label}: 접수됨, 정지 복귀 대기 중 (${wait.state ?? '상태 미확인'})`, 5000);
				outputChannel.appendLine(`[Thread] ${name} ${label}: 5초 내 정지 복귀 미확인 (state=${wait.state ?? '?'})`);
				return;
			}
			if (vscode.workspace.getConfiguration('gpl.controller').get<boolean>('autoShowPausedLocation') !== false) {
				await vscode.commands.executeCommand('gpl.controller.threadShowLocation', node);
			}
		} catch (err: any) {
			vscode.window.showErrorMessage(`${label} 실패: ${err.message ?? err}`);
		}
	}

	// 쓰레드 일시정지 (Break)
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.threadBreak', async (node: any) => {
			node = asThreadNode(node);
		const name: string | undefined = node?.thread?.name;
			if (!name) { return; }
			try {
				if (!(await sendThreadCommandChecked(`Break ${name}`, `${name} 일시정지`))) { return; }
				const wait = await waitForThreadPause(name, 5000);
				host.controllerTree?.refresh();
				if (wait.paused) {
					vscode.window.showInformationMessage(`${name} 일시정지 (${wait.state})`);
				} else {
					vscode.window.showWarningMessage(`${name} 일시정지 명령은 접수됐지만 아직 ${wait.state ?? '상태 미확인'} 상태입니다. 잠시 후 트리에서 다시 확인하세요.`);
				}
			} catch (err: any) {
				vscode.window.showErrorMessage(`일시정지 실패: ${err.message ?? err}`);
			}
		})
	);

	// 쓰레드 재개 (Continue)
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.threadContinue', async (node: any) => {
			node = asThreadNode(node);
		const name: string | undefined = node?.thread?.name;
			if (!name) { return; }
			try {
				await sendThreadCommandChecked(`Continue ${name}`, `${name} 재개`);
				host.controllerTree?.refresh();
			} catch (err: any) {
				vscode.window.showErrorMessage(`재개 실패: ${err.message ?? err}`);
			}
		})
	);

	// 쓰레드 에러 건너뛰기 계속 (Continue -noerror)
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.threadContinueNoError', async (node: any) => {
			node = asThreadNode(node);
		const name: string | undefined = node?.thread?.name;
			if (!name) { return; }
			try {
				if (await sendThreadCommandChecked(`Continue ${name} -noerror`, `${name} 재개`)) {
					vscode.window.showInformationMessage(`${name} 에러 건너뛰고 재개`);
				}
				host.controllerTree?.refresh();
			} catch (err: any) {
				vscode.window.showErrorMessage(`재개 실패: ${err.message ?? err}`);
			}
		})
	);

	// 쓰레드 스텝 — 인라인 버튼(아이콘 $(debug-step-over))은 Step Over. Into/Out은 컨텍스트 메뉴에서.
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.threadStep', (node: any) => runTreeThreadStep(node, 'over')),
		vscode.commands.registerCommand('gpl.controller.threadStepInto', (node: any) => runTreeThreadStep(node, 'into')),
		vscode.commands.registerCommand('gpl.controller.threadStepOut', (node: any) => runTreeThreadStep(node, 'out')),
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.threadShowLocation', async (node: any) => {
			node = asThreadNode(node);
			const threadName: string | undefined = node?.thread?.name;
			if (!threadName) { return; }

			try {
				let topFrame = undefined as ReturnType<typeof parseStack>[number] | undefined;

				const resp = await sendCommand(`Show Stack ${threadName}`);
				if (resp) {
					const frames = parseStack(resp);
					topFrame = frames[0];
				}

				if (!topFrame) {
					const detailResp = await sendCommand(`Show Thread ${threadName}`);
					const detail = detailResp ? parseThreadDetail(detailResp) : null;
					if (detail?.file && detail.fileLine > 0) {
						topFrame = {
							frameIndex: 0,
							project: detail.project,
							process: detail.process || threadName,
							procLine: detail.procLine,
							file: detail.file,
							fileLine: detail.fileLine,
							size: 0,
						};
						outputChannel.appendLine(
							`[Thread] ${threadName} 위치 복구: Show Thread fallback → ${detail.file}:${detail.fileLine} (${detail.process || threadName})`,
						);
					}
				}

				if (!topFrame) {
					vscode.window.showWarningMessage(`${threadName}: 스택 프레임이 없습니다.`);
					outputChannel.appendLine(`[Thread] ${threadName} 위치 조회 실패: Show Stack / Show Thread fallback 모두 실패`);
					return;
				}

				// Top frame = current execution position
				if (!topFrame.file || topFrame.fileLine <= 0) {
					vscode.window.showWarningMessage(`${threadName}: 파일/줄 정보 없음 (${topFrame.process || 'unknown'})`);
					return;
				}

				// Resolve file path
				const filePath = host.project.resolveGplFilePath(topFrame.file);
				if (!filePath) {
					vscode.window.showWarningMessage(`${threadName}: 파일 "${topFrame.file}"을 워크스페이스에서 찾을 수 없습니다.`);
					return;
				}

				// Open the file and reveal the stopped line
				const doc = await vscode.workspace.openTextDocument(filePath);
				const editor = await vscode.window.showTextDocument(doc, { preview: false });
				const line = topFrame.fileLine - 1; // 0-based
				const range = new vscode.Range(line, 0, line, 0);
				editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
				editor.selection = new vscode.Selection(line, 0, line, 0);

				// Apply stopped-line decoration
				host.decorations.showStopped(editor, doc.lineAt(line).range);

				outputChannel.appendLine(
					`[Thread] ${threadName} 정지 위치: ${topFrame.file}:${topFrame.fileLine} (${topFrame.process})`,
				);

				// brooks-gpl 디버그 세션이 활성이면 디버거 포커스도 이 쓰레드로 전환한다
				// (CALL STACK/Variables/Watch가 해당 쓰레드 기준으로 갱신 — 디버그 패널과의 동작 병합).
				// 부가 기능이므로 실패해도 위치 표시에는 영향 없음.
				const dbgSession = vscode.debug.activeDebugSession;
				if (dbgSession?.type === 'brooks-gpl') {
					try {
						await dbgSession.customRequest('gplFocusThread', { name: threadName });
					} catch (focusErr: any) {
						outputChannel.appendLine(`[Thread] ${threadName} 디버거 포커스 연동 실패(무시): ${focusErr?.message ?? focusErr}`);
					}
				}
			} catch (err: any) {
				vscode.window.showErrorMessage(`스택 조회 실패: ${err.message ?? err}`);
			}
		})
	);

	// CALL STACK에서 Running 쓰레드 클릭 → 현재 실행 위치 열기 (Show Stack 스냅샷).
	// 정지 쓰레드는 VS Code가 스택 프레임으로 기본 처리하므로 여기서는 다루지 않는다.
	// onDidChangeActiveStackItem은 VS Code 1.90+ API — engines(^1.74)보다 새 API라
	// 존재 여부를 확인하고 등록한다(구버전에서는 이 기능만 조용히 비활성).
	const debugApi = vscode.debug as any;
	if (typeof debugApi.onDidChangeActiveStackItem === 'function') {
		context.subscriptions.push(debugApi.onDidChangeActiveStackItem(async (item: any) => {
			// DebugStackFrame(frameId 보유)은 정지 쓰레드 포커스 — 기본 동작에 맡긴다.
			if (!item || typeof item.threadId !== 'number' || 'frameId' in item) { return; }
			if (item.session?.type !== 'brooks-gpl') { return; }
			try {
				const info = await item.session.customRequest('gplThreadInfo', { threadId: item.threadId });
				if (!info?.name || info.state !== 'Running') { return; }
				// Continue/Step 직후 VS Code가 포커스를 쓰레드로 자동 전환하며 오는
				// 이벤트는 사용자 클릭이 아니므로 무시한다.
				if (typeof info.msSinceResume === 'number' && info.msSinceResume < 2000) { return; }
				await vscode.commands.executeCommand('gpl.controller.threadShowLocation', { thread: { name: info.name } });
			} catch (err: any) {
				outputChannel.appendLine(`[Thread] CALL STACK Running 쓰레드 위치 열기 실패(무시): ${err?.message ?? err}`);
			}
		}));
	}

	// 쓰레드 클릭 → 액션 QuickPick (상세/스택/위치/제어/복사)
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.threadActions', async (node: any) => {
			const t = node?.thread;
			if (!t?.name) { return; }
			const name: string = t.name;
			const state: string = t.state;
			type ActItem = vscode.QuickPickItem & { action: string };
			const items: ActItem[] = [];
			// 현재 실행/정지 위치는 모든 상태에서 조회 가능 (Running은 스냅샷)
			items.push({ label: '$(go-to-file) 현재 실행 위치 보기', action: 'location' });
			items.push({ label: '$(list-tree) 스택 보기 (Show Stack)', action: 'stack' });
			items.push({ label: '$(info) 상세 보기 (Show Thread)', action: 'detail' });
			if (state === 'Running') {
				items.push({ label: '$(debug-pause) 일시정지 (Break)', action: 'break' });
				items.push({ label: '$(debug-stop) 정지 (Stop)', action: 'stop' });
			} else if (state === 'Paused' || state === 'Break') {
				items.push({ label: '$(debug-continue) 재개 (Continue)', action: 'continue' });
				items.push({ label: '$(debug-step-over) 스텝 오버 (Step -over)', action: 'step' });
				items.push({ label: '$(debug-step-into) 스텝 인투 (Step -into)', action: 'stepInto' });
				items.push({ label: '$(debug-step-out) 스텝 아웃 (Step -out)', action: 'stepOut' });
				items.push({ label: '$(debug-stop) 정지 (Stop)', action: 'stop' });
			} else if (state === 'Error') {
				items.push({ label: '$(debug-continue) 에러 건너뛰고 재개', action: 'continueNoError' });
				items.push({ label: '$(debug-stop) 정지 (Stop)', action: 'stop' });
			} else {
				items.push({ label: '$(play) 시작 (Start)', action: 'start' });
			}
			items.push({ label: '$(copy) 정보 복사', action: 'copy' });
			const pick = await vscode.window.showQuickPick(items, { placeHolder: `${name} [${state}] — 동작 선택` });
			if (!pick) { return; }
			switch (pick.action) {
				case 'location': await vscode.commands.executeCommand('gpl.controller.threadShowLocation', node); break;
				case 'stack': await vscode.commands.executeCommand('gpl.controller.threadShowStack', node); break;
				case 'detail': {
					const resp = await sendCommand(`Show Thread ${name}`);
					outputChannel.appendLine(`[Thread] >>> Show Thread ${name}`);
					outputChannel.appendLine(resp || '(empty)');
					outputChannel.show(true);
					break;
				}
				case 'break': await vscode.commands.executeCommand('gpl.controller.threadBreak', node); break;
				case 'continue': await vscode.commands.executeCommand('gpl.controller.threadContinue', node); break;
				case 'continueNoError': await vscode.commands.executeCommand('gpl.controller.threadContinueNoError', node); break;
				case 'step': await vscode.commands.executeCommand('gpl.controller.threadStep', node); break;
				case 'stepInto': await vscode.commands.executeCommand('gpl.controller.threadStepInto', node); break;
				case 'stepOut': await vscode.commands.executeCommand('gpl.controller.threadStepOut', node); break;
				case 'stop': await vscode.commands.executeCommand('gpl.controller.threadStop', node); break;
				case 'start': await vscode.commands.executeCommand('gpl.controller.threadStart', node); break;
				case 'copy': {
					const info = [`Thread: ${name}`, `State: ${state}`, t.project ? `Project: ${t.project}` : '', t.file ? `File: ${t.file}${t.fileLine ? ':' + t.fileLine : ''}` : '', t.lastStatus ? `Status: ${t.lastStatus}` : ''].filter(Boolean).join('\n');
					await vscode.env.clipboard.writeText(info);
					vscode.window.showInformationMessage(`${name} 정보 복사됨`);
					break;
				}
			}
		})
	);

	// 쓰레드 스택 인스펙터 — Show Stack → 프레임 QuickPick → 소스 위치 이동
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.threadShowStack', async (node: any) => {
			node = asThreadNode(node);
		const name: string | undefined = node?.thread?.name;
			if (!name) { return; }
			try {
				const resp = await sendCommand(`Show Stack ${name}`);
				const frames = resp ? parseStack(resp) : [];
				outputChannel.appendLine(`[Thread] >>> Show Stack ${name}`);
				outputChannel.appendLine(resp || '(empty)');
				if (frames.length === 0) {
					vscode.window.showWarningMessage(`${name}: 스택 프레임이 없습니다.`);
					outputChannel.show(true);
					return;
				}
				const items = frames.map((f, i) => ({
					label: `$(list-tree) #${i} ${f.process || '(unknown)'}`,
					description: f.file ? `${f.file}:${f.fileLine}` : '(위치 없음)',
					frame: f,
				}));
				const pick = await vscode.window.showQuickPick(items, { placeHolder: `${name} 스택 — 프레임 선택 시 소스로 이동` });
				if (!pick) { return; }
				const f = pick.frame;
				if (!f.file || f.fileLine <= 0) { vscode.window.showWarningMessage('해당 프레임에 파일/줄 정보가 없습니다.'); return; }
				const filePath = host.project.resolveGplFilePath(f.file);
				if (!filePath) { vscode.window.showWarningMessage(`파일 "${f.file}"을 워크스페이스에서 찾을 수 없습니다.`); return; }
				const doc = await vscode.workspace.openTextDocument(filePath);
				const editor = await vscode.window.showTextDocument(doc, { preview: false });
				const line = Math.max(0, f.fileLine - 1);
				const range = new vscode.Range(line, 0, line, 0);
				editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
				editor.selection = new vscode.Selection(line, 0, line, 0);
			} catch (err: any) {
				vscode.window.showErrorMessage(`스택 조회 실패: ${err.message ?? err}`);
			}
		})
	);
}
