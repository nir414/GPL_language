/**
 * 1403 런타임 콘솔·라이브 로그 터미널·상태 스냅샷 명령 + 대시보드 웹뷰.
 */

import * as vscode from 'vscode';
import { buildRuntimeConsoleUserMessage } from '../controller/runtime/runtimeConsolePresentation';
import { showRuntimeConsoleUserMessage } from './controllerOps';
import { appendLiveLog, isLiveLogTerminalEnabled, startLiveLogTerminal, stopLiveLogTerminal } from '../log/liveLogTerminal';
import { getControllerConfig } from '../controller/connection/controllerConnection';
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
			ControllerDashboardPanel.show(context, outputChannel, 'status');
		})
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.showIoPanel', () => {
			ControllerDashboardPanel.show(context, outputChannel, 'io');
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
			showRuntimeConsoleUserMessage(snapshot, hasPayload, '런타임 콘솔 확인');
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.logs.liveTerminal.start', async () => {
			startLiveLogTerminal();
			// 터미널에 "어디로 붙는지" 를 먼저 적는다(2026-10-19 Sample Prep 보고, §1-ET): 런타임 콘솔은 명령 콘솔과 같은 주소
			// (세션 오버라이드 > settings `gpl.controller.ip`)에 `consolePort` 로 독립 접속하며, 명령 콘솔 연결 여부와 무관하게 시도한다.
			const cfg = getControllerConfig();
			appendLiveLog(`[GPL Live Logs] 런타임 콘솔 대상 ${cfg.ip}:${cfg.consolePort} — 연결 시도 (명령 콘솔 연결 상태: ${host.isControllerConnected ? '연결됨' : '미연결'})`);
			if (!host.isControllerConnected) {
				// 명령 콘솔 유실 뒤에는 런타임 콘솔도 함께 멈추고 자동 재접속하지 않는다(2026-08-28 결정) — 다시 Connect 하면 같이 켜진다.
				appendLiveLog('[GPL Live Logs] 명령 콘솔이 연결돼 있지 않습니다 — 연결 유실 뒤라면 「GPL: Connect」로 다시 연결하면 런타임 콘솔도 함께 시작됩니다.');
			}
			try {
				const console = host.ensureRuntimeConsole();
				// 사용자가 직접 켠 것이므로 백오프 대기(최대 30 s)·재연결 중단 상태를 풀고 즉시 한 번 붙어 본다 — `gpl.console.start` 와 같은 규칙.
				// 종전에는 start() 만 불러 대기 중인 백오프 타이머를 그대로 두었고, 결과와 무관하게 "연결 시도" 토스트만 띄워
				// 연결 거부·타임아웃이 사용자에게 보이지 않았다(터미널·GPL Traffic 에만 남음).
				console.start(0, { forceImmediateReconnect: true });
				await console.waitUntilReady(1200);
				const hasPayload = await console.waitForPayload(1500);
				const snapshot = console.getStatusSnapshot();
				host.controllerTree?.setRuntimeConsoleStatus(snapshot);
				const outcome = buildRuntimeConsoleUserMessage(snapshot, hasPayload, 'GPL Live Logs 터미널 시작');
				host.log(`[Console] ${outcome.message}`);
				appendLiveLog(`[GPL Live Logs] ${outcome.message}`);
				showRuntimeConsoleUserMessage(snapshot, hasPayload, 'GPL Live Logs 터미널 시작');
			} catch (err: any) {
				host.log(`[Console] live log start -> runtime console start failed: ${err?.message ?? err}`);
				appendLiveLog(`[GPL Live Logs] 런타임 콘솔 시작 실패: ${err?.message ?? err}`);
				vscode.window.showErrorMessage(`GPL Live Logs — 런타임 콘솔 시작 실패: ${err?.message ?? err}`);
			}
			host.log('Live log terminal started');
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.logs.liveTerminal.stop', () => {
			if (!isLiveLogTerminalEnabled()) {
				vscode.window.showInformationMessage('GPL Live Logs 터미널은 이미 중지 상태입니다.');
				return;
			}
			// Live Log 세션 종료 시 1403 소비자도 함께 정리해 소켓/타이머/리스너를 완전 해제한다.
			host.runtimeConsole?.stop();
			host.log('Live log terminal stopped');
			stopLiveLogTerminal();
			vscode.window.showInformationMessage('GPL Live Logs 터미널 중지 (런타임 콘솔도 정리됨)');
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
		vscode.commands.registerCommand('gpl.controller.copyThreads', async () => {
			if (!host.controllerTree) { return; }
			// 붙여넣은 목록이 화면보다 낡지 않도록 복사 직전에 한 번 갱신한다(상황 복사와 같은 취지).
			await host.controllerTree.refreshAll();
			const markdown = host.controllerTree.buildThreadReportMarkdown();
			await vscode.env.clipboard.writeText(markdown);
			vscode.window.showInformationMessage('쓰레드 목록을 클립보드에 복사했습니다.');
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
			vscode.window.showInformationMessage('진단 스냅샷을 클립보드에 복사했습니다.');
		})
	);
}
