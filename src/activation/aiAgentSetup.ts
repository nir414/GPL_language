/** AI Agent Setup 내보내기·점검 + MCP 사본 자동 갱신. */
import * as vscode from 'vscode';
import {
	exportAiAgentSetup, inspectAiAgentSetup, syncStableBundleIfStale, AiAgentSetupReport,
} from '../ai/exportAgentSetup';
import { sameSetupPath, findMcpHostMismatch } from '../ai/agentSetupChecks';
import { getControllerConfig } from '../controller/controllerConnection';
import { onControllerSessionChange } from '../controller/connectionSession';
import type { ExtensionHost } from './host';

type SetupRequest = { workspaceRoot?: string; nonInteractive?: boolean };

export function activateAiAgentSetup(host: ExtensionHost): void {
	const { context, outputChannel } = host;

	async function workspaceRoot(request: SetupRequest): Promise<string | undefined> {
		const folders = vscode.workspace.workspaceFolders ?? [];
		if (request.workspaceRoot) { return folders.find(f => sameSetupPath(f.uri.fsPath, request.workspaceRoot!))?.uri.fsPath; }
		if (folders.length === 1) { return folders[0].uri.fsPath; }
		if (request.nonInteractive || folders.length === 0) { return undefined; }
		return (await vscode.window.showWorkspaceFolderPick({ placeHolder: 'AI Agent Setup을 저장할 워크스페이스 폴더' }))?.uri.fsPath;
	}

	/** 점검 기준이 되는 현재 제어기 주소 — 세션 오버라이드 포함(§1-ES). */
	function currentController(): { ip: string; port: number } {
		const cfg = getControllerConfig();
		return { ip: cfg.ip, port: cfg.port };
	}

	function summary(report: AiAgentSetupReport): string {
		const settings = report.settingsOk ? '설정 정상' : `설정 문제 ${report.problems.length}건`;
		const detail = [...report.problems, ...report.warnings].slice(0, 2).join(' / ');
		return `GPL AI Agent Setup — ${settings}${report.warnings.length ? ` · 안내 확인 ${report.warnings.length}건` : ''}${detail ? ` — ${detail}` : ''}`;
	}

	context.subscriptions.push(vscode.commands.registerCommand('gpl.ai.exportAgentSetup', async (args?: SetupRequest) => {
		const request = args ?? {};
		const root = await workspaceRoot(request);
		if (!root) { return { ok: false, error: 'WORKSPACE_REQUIRED', detail: 'Export할 워크스페이스 폴더를 지정해야 합니다.' }; }
		const config = getControllerConfig();
		const result = await exportAiAgentSetup(context, {
			ip: config.ip, port: config.port, workspaceRoot: root,
		});
		host.log(`[AI Setup] gpl.ai.exportAgentSetup => ${JSON.stringify(result)}`);
		if (!result.ok) { return result; }
		const report = inspectAiAgentSetup(context, { workspaceRoot: root, currentController: currentController() });
		host.log(`[AI Setup] export 후 자동 점검 => ${JSON.stringify(report, null, 2)}`);
		if (!report.ok && !request.nonInteractive) {
			const pick = await vscode.window.showWarningMessage(summary(report), '출력 보기');
			if (pick === '출력 보기') { outputChannel.show(true); }
		}
		return { ...result, report };
	}));

	context.subscriptions.push(vscode.commands.registerCommand('gpl.ai.checkAgentSetup', async (args?: SetupRequest) => {
		const request = args ?? {};
		const root = await workspaceRoot(request);
		if (!root) { return { ok: false, error: 'WORKSPACE_REQUIRED' }; }
		const report = inspectAiAgentSetup(context, {
			workspaceRoot: root, currentController: currentController(),
		});
		host.log(`[AI Setup] gpl.ai.checkAgentSetup => ${JSON.stringify(report, null, 2)}`);
		if (!request.nonInteractive) {
			const pick = report.ok
				? await vscode.window.showInformationMessage(summary(report), '출력 보기')
				: await vscode.window.showWarningMessage(summary(report), 'Export 재실행', '출력 보기');
			if (pick === 'Export 재실행') { await vscode.commands.executeCommand('gpl.ai.exportAgentSetup', { workspaceRoot: root }); }
			else if (pick === '출력 보기') { outputChannel.show(true); }
		}
		return report;
	}));

	// 연결이 확립될 때 `.mcp.json` 의 GPL_HOST 가 지금 연결 주소와 다르면 알린다(2026-10-19, §1-ES).
	// 왜: Export 뒤 다른 IP 로 연결하면 그 워크스페이스의 MCP 는 옛 주소로 접속하고 이 창의 presence 도 못 찾아
	// "확장 미실행" 으로 보고했다 — 배포·콘솔이 전부 막혔는데 확장 쪽에는 아무 표시가 없었다. 같은 (폴더, 주소)는 한 번만 알린다.
	const warnedHostMismatch = new Set<string>();
	context.subscriptions.push(onControllerSessionChange(change => {
		if (!change.connected) { return; }
		const current = currentController();
		for (const folder of vscode.workspace.workspaceFolders ?? []) {
			const root = folder.uri.fsPath;
			const mismatch = findMcpHostMismatch(root, current);
			if (!mismatch) { continue; }
			host.log(`[AI Setup] .mcp.json 제어기 주소 불일치: GPL_HOST ${mismatch.configured.host}:${mismatch.configured.port} ≠ 현재 연결 ${current.ip}:${current.port} (${mismatch.path})`);
			const key = `${root}|${current.ip}:${current.port}`;
			if (warnedHostMismatch.has(key)) { continue; }
			warnedHostMismatch.add(key);
			void (async () => {
				const pick = await vscode.window.showWarningMessage(
					`AI(MCP) 설정의 제어기 주소(${mismatch.configured.host}:${mismatch.configured.port})가 현재 연결(${current.ip}:${current.port})과 다릅니다 — `
						+ '이 상태의 MCP 서버는 옛 주소로 접속하고 이 창을 찾지 못합니다. Export를 다시 실행하면 .mcp.json을 현재 주소로 갱신합니다(이후 Claude Code에서 /mcp 재연결).',
					'Export 재실행', '무시',
				);
				if (pick === 'Export 재실행') { await vscode.commands.executeCommand('gpl.ai.exportAgentSetup', { workspaceRoot: root }); }
			})().catch(err => host.log(`[AI Setup] 주소 불일치 안내 실패: ${String(err)}`));
		}
	}));

	if (vscode.workspace.getConfiguration('gpl.ai').get<boolean>('autoRefreshMcpBundle', true)) {
		const sync = syncStableBundleIfStale(context);
		if (sync.action !== 'absent' && sync.action !== 'up-to-date') { host.log(`[AI Setup] MCP 사본 동기화: ${JSON.stringify(sync)}`); }
		if (sync.action === 'updated') {
			void (async () => {
				const reports = (vscode.workspace.workspaceFolders ?? []).map(folder => inspectAiAgentSetup(context, {
					workspaceRoot: folder.uri.fsPath, currentController: currentController(),
				}));
				for (const report of reports) { host.log(`[AI Setup] MCP 갱신 후 점검 => ${JSON.stringify(report)}`); }
				const from = sync.previous?.version ? `v${sync.previous.version}` : '구버전(스탬프 없음)';
				const to = sync.current?.version ? `v${sync.current.version}` : '현재 번들';
				const needExport = reports.some(r => r.claudeMd.hasBlock && r.claudeMd.upToDate === false);
				const pick = await vscode.window.showInformationMessage(
					`gpl-controller MCP 사본을 ${from} → ${to}로 갱신했습니다. Claude Code에서 /mcp로 재연결하세요.`
						+ (needExport ? ' 워크스페이스 안내는 Export를 다시 실행해 갱신하세요.' : ''),
					...(needExport ? ['Export 재실행', '확인'] : ['확인']),
				);
				if (pick === 'Export 재실행') { await vscode.commands.executeCommand('gpl.ai.exportAgentSetup'); }
			})().catch(err => host.log(`[AI Setup] MCP 갱신 후 점검 실패: ${String(err)}`));
		}
	}
}
