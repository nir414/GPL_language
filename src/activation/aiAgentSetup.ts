/** AI Agent Setup 내보내기·점검 + MCP 사본 자동 갱신. */
import * as vscode from 'vscode';
import {
	exportAiAgentSetup, inspectAiAgentSetup, syncStableBundleIfStale, AiAgentSetupReport,
} from '../ai/exportAgentSetup';
import { sameSetupPath, projectCandidatesInRoot } from '../ai/agentSetupChecks';
import { getControllerConfig } from '../controller/controllerConnection';
import { buildTargetCandidates, pickProjectDirDetailed } from '../controller/projectPicker';
import { isProjectTargetRequest, ProjectTargetRequest, resolveProjectTarget } from '../controller/projectTarget';
import type { ExtensionHost } from './host';

type SetupRequest = ProjectTargetRequest & { workspaceRoot?: string; nonInteractive?: boolean };

export function activateAiAgentSetup(host: ExtensionHost): void {
	const { context, outputChannel } = host;

	async function workspaceRoot(request: SetupRequest): Promise<string | undefined> {
		const folders = vscode.workspace.workspaceFolders ?? [];
		if (request.workspaceRoot) { return folders.find(f => sameSetupPath(f.uri.fsPath, request.workspaceRoot!))?.uri.fsPath; }
		const targetPath = request.projectDir || request.projectFile || host.sessionTargetDir;
		if (targetPath) {
			const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(targetPath));
			if (folder) { return folder.uri.fsPath; }
		}
		if (folders.length === 1) { return folders[0].uri.fsPath; }
		if (request.nonInteractive || folders.length === 0) { return undefined; }
		return (await vscode.window.showWorkspaceFolderPick({ placeHolder: 'AI Agent Setup을 저장할 워크스페이스 폴더' }))?.uri.fsPath;
	}

	function summary(report: AiAgentSetupReport): string {
		const settings = report.settingsOk ? '설정 정상' : `설정 문제 ${report.problems.length}건`;
		const target = report.target.status === 'confirmed' ? `작업 대상: ${report.target.detail}` : '작업 대상 미확정';
		const detail = [...report.problems, ...report.warnings].slice(0, 2).join(' / ');
		return `GPL AI Agent Setup — ${settings} · ${target}${report.warnings.length ? ` · 안내 확인 ${report.warnings.length}건` : ''}${detail ? ` — ${detail}` : ''}`;
	}

	context.subscriptions.push(vscode.commands.registerCommand('gpl.ai.exportAgentSetup', async (args?: SetupRequest) => {
		const request = args ?? {};
		const root = await workspaceRoot(request);
		if (!root) { return { ok: false, error: 'WORKSPACE_REQUIRED', detail: 'Export할 워크스페이스 폴더를 지정해야 합니다.' }; }
		const candidates = projectCandidatesInRoot(await buildTargetCandidates(), root);
		// 재실행 시 명시적으로 저장한 폴더를 유지한다. 열린 파일은 대상 선택에 쓰지 않는다.
		const previous = inspectAiAgentSetup(context, { workspaceRoot: root, candidates });
		const session = candidates.some(c => host.sessionTargetDir && sameSetupPath(c.dir, host.sessionTargetDir))
			? host.sessionTargetDir : previous.mcpJson.projectDir && previous.target.resolution?.ok ? previous.target.resolution.dir : undefined;
		const target = resolveProjectTarget(isProjectTargetRequest(request) ? request : undefined, candidates, {
			sessionTargetDir: session,
			configuredDefault: vscode.workspace.getConfiguration('gpl.controller').get<string>('defaultProject')?.trim(),
		});
		if (isProjectTargetRequest(request) && !target.ok) { return target; }
		const config = getControllerConfig();
		const result = await exportAiAgentSetup(context, {
			ip: config.ip, port: config.port, workspaceRoot: root,
			...(target.ok ? { projectName: target.projectName, projectDir: target.dir } : {}),
		});
		host.log(`[AI Setup] gpl.ai.exportAgentSetup => ${JSON.stringify(result)}`);
		if (!result.ok) { return result; }
		if (target.ok) { host.sessionTargetDir = target.dir; }
		const report = inspectAiAgentSetup(context, { workspaceRoot: root, candidates });
		host.log(`[AI Setup] export 후 자동 점검 => ${JSON.stringify(report, null, 2)}`);
		if (!report.ok && !request.nonInteractive) {
			const buttons = report.target.status === 'unresolved' && candidates.length ? ['프로젝트 선택', '출력 보기'] : ['출력 보기'];
			const pick = await vscode.window.showWarningMessage(summary(report), ...buttons);
			if (pick === '출력 보기') { outputChannel.show(true); }
			if (pick === '프로젝트 선택') {
				const picked = await pickProjectDirDetailed({ placeHolder: 'AI 작업 대상 프로젝트를 선택하세요', dirs: candidates.map(c => c.dir) });
				if (picked.kind === 'picked') { return vscode.commands.executeCommand('gpl.ai.exportAgentSetup', { workspaceRoot: root, projectDir: picked.dir }); }
			}
		}
		return { ...result, report };
	}));

	context.subscriptions.push(vscode.commands.registerCommand('gpl.ai.checkAgentSetup', async (args?: SetupRequest) => {
		const request = args ?? {};
		const root = await workspaceRoot(request);
		if (!root) { return { ok: false, error: 'WORKSPACE_REQUIRED' }; }
		const report = inspectAiAgentSetup(context, { workspaceRoot: root, candidates: projectCandidatesInRoot(await buildTargetCandidates(), root) });
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

	if (vscode.workspace.getConfiguration('gpl.ai').get<boolean>('autoRefreshMcpBundle', true)) {
		const sync = syncStableBundleIfStale(context);
		if (sync.action !== 'absent' && sync.action !== 'up-to-date') { host.log(`[AI Setup] MCP 사본 동기화: ${JSON.stringify(sync)}`); }
		if (sync.action === 'updated') {
			void (async () => {
				const candidates = await buildTargetCandidates();
				const reports = (vscode.workspace.workspaceFolders ?? []).map(folder => inspectAiAgentSetup(context, {
					workspaceRoot: folder.uri.fsPath, candidates: projectCandidatesInRoot(candidates, folder.uri.fsPath),
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
