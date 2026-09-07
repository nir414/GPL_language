/**
 * 1403 런타임 콘솔·라이브 로그 터미널·상태 스냅샷 명령 + 대시보드 웹뷰.
 */

import * as vscode from 'vscode';
import { buildRuntimeConsoleUserMessage } from '../controller/runtimeConsolePresentation';
import { showRuntimeConsoleUserMessage } from './controllerOps';
import { isLiveLogTerminalEnabled, startLiveLogTerminal, stopLiveLogTerminal } from '../log/liveLogTerminal';
import { ControllerDashboardPanel } from '../views/controllerDashboardPanel';
import { hasOpenGplDocument } from '../config';
import type { ExtensionHost } from './host';

export function activateConsoleCommands(host: ExtensionHost): void {
	const { context, outputChannel, consoleChannel } = host;

	const autoStartLiveTerminal = vscode.workspace
		.getConfiguration('gpl.trace')
		.get<boolean>('liveTerminal.autoStart', false);
	if (autoStartLiveTerminal) {
		if (hasOpenGplDocument(vscode.workspace)) {
			startLiveLogTerminal();
			host.log('[Trace] live terminal auto-start enabled');
		} else {
			host.log('[Trace] live terminal auto-start skipped (no open GPL document)');
		}
	}
	// 제어기 실시간 상태 대시보드 (Webview Panel)
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.showDashboard', () => {
			ControllerDashboardPanel.show(context, outputChannel);
		})
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.console.start', async () => {
			const console = host.ensureRuntimeConsole();
			console.start(0, { forceImmediateReconnect: true });
			await console.waitUntilReady();
			const hasPayload = await console.waitForPayload(1500);
			const snapshot = console.getStatusSnapshot();
			host.controllerTree?.setRuntimeConsoleStatus(snapshot);
			consoleChannel.show(true);
			showRuntimeConsoleUserMessage(snapshot, hasPayload, 'GPL 런타임 콘솔 시작');
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.console.stop', () => {
			host.stopRuntimeConsoleAndSyncTree();
			vscode.window.showInformationMessage('GPL 런타임 콘솔 중지');
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.console.ensure', async () => {
			const console = host.ensureRuntimeConsole();
			console.start(0, { forceImmediateReconnect: true });
			await console.waitUntilReady(1200);
			const hasPayload = await console.waitForPayload(1500);
			const snapshot = console.getStatusSnapshot();
			host.controllerTree?.setRuntimeConsoleStatus(snapshot);
			consoleChannel.show(true);
			showRuntimeConsoleUserMessage(snapshot, hasPayload, '1403 콘솔 확인');
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.logs.liveTerminal.start', async () => {
			startLiveLogTerminal();
			try {
				const console = host.ensureRuntimeConsole();
				await console.waitUntilReady();
				const hasPayload = await console.waitForPayload(1500);
				const snapshot = console.getStatusSnapshot();
				host.controllerTree?.setRuntimeConsoleStatus(snapshot);
				host.log(`[Console] ${buildRuntimeConsoleUserMessage(snapshot, hasPayload, 'live log start').message}`);
			} catch (err: any) {
				host.log(`[Console] live log start -> runtime console start failed: ${err?.message ?? err}`);
			}
			host.log('Live log terminal started');
			vscode.window.showInformationMessage('GPL Live Logs 터미널 시작 (1403 런타임 콘솔 연결 시도)');
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.logs.liveTerminal.stop', () => {
			if (!isLiveLogTerminalEnabled()) {
				vscode.window.showInformationMessage('GPL Live Logs 터미널이 이미 중지 상태야.');
				return;
			}
			// Live Log 세션 종료 시 1403 소비자도 함께 정리해 소켓/타이머/리스너를 완전 해제한다.
			host.runtimeConsole?.stop();
			host.log('Live log terminal stopped');
			stopLiveLogTerminal();
			vscode.window.showInformationMessage('GPL Live Logs 터미널 중지 (1403 런타임 콘솔도 정리됨)');
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.threads.refresh', () => {
			host.controllerTree?.refreshAll();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.copySituationForChat', async () => {
			if (!host.controllerTree) { return; }
			await host.controllerTree.refreshAll();
			const expected = host.controllerTree.getExpectedProjectName();
			const header = [
				'다음은 GPL Controller 현재 상태입니다. 실행 프로젝트/FTP 프로젝트 불일치 여부를 우선 분석해 주세요.',
				expected ? `기대 프로젝트: ${expected}` : '기대 프로젝트: (미설정)',
				'',
			].join('\n');
			const body = host.controllerTree.buildSituationSnapshotMarkdown({
				runtimeConsoleStatus: host.currentRuntimeConsoleStatus(),
				deploySnapshot: host.lastDeploySnapshot,
			});
			const text = `${header}${body}`;

			await vscode.env.clipboard.writeText(text);
			vscode.window.showInformationMessage('AI 공유용 상태 스냅샷을 클립보드에 복사했습니다.');
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.diagnosticSnapshot', async () => {
			if (!host.controllerTree) { return; }
			await host.controllerTree.refreshAll();
			const markdown = host.controllerTree.buildDiagnosticSnapshotMarkdown({
				runtimeConsoleStatus: host.currentRuntimeConsoleStatus(),
				deploySnapshot: host.lastDeploySnapshot,
			});

			await vscode.env.clipboard.writeText(markdown);
			host.log('');
			host.log('── [진단 스냅샷] ───────────────────────────────────────');
			for (const line of markdown.split(/\r?\n/)) {
				host.log(line);
			}
			host.log('─────────────────────────────────────────────────────────');
			outputChannel.show(true);
			vscode.window.showInformationMessage('진단 스냅샷을 클립보드에 복사했어.');
		})
	);
}
