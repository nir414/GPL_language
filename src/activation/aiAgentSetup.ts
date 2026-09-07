/**
 * AI Agent Setup — `.mcp.json`/CLAUDE.md 내보내기·점검(GitHub #23) + 활성화 시 MCP 사본 자동 갱신.
 */

import * as vscode from 'vscode';
import { exportAiAgentSetup, inspectAiAgentSetup, syncStableBundleIfStale } from '../ai/exportAgentSetup';
import { getControllerConfig } from '../controller/controllerConnection';
import type { ExtensionHost } from './host';

export function activateAiAgentSetup(host: ExtensionHost): void {
	const { context, outputChannel } = host;

	// AI Agent Setup 내보내기 — 현재 워크스페이스에 .mcp.json(동봉 MCP 서버 등록) +
	// CLAUDE.md 가드 섹션을 생성해, 외부 AI(Claude Code)가 제어기를 안전하게 다룰 수 있게 한다.
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.ai.exportAgentSetup', async () => {
			const config = getControllerConfig();
			const projectName = (await host.project.detectWorkspaceProjectName())?.trim() || undefined;
			const result = await exportAiAgentSetup(context, { ip: config.ip, port: config.port, projectName });
			host.log(`[AI Setup] gpl.ai.exportAgentSetup => ${JSON.stringify(result)}`);
			return result;
		})
	);

	// AI Agent Setup 점검(GitHub #23) — .mcp.json 등록 경로, globalStorage 사본/동봉 번들 sha256 일치, CLAUDE.md 안내 블록 버전을
	// 한 번에 보고한다. 문제가 있으면 Export 재실행 버튼을 함께 준다.
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.ai.checkAgentSetup', async () => {
			const report = inspectAiAgentSetup(context);
			host.log(`[AI Setup] gpl.ai.checkAgentSetup => ${JSON.stringify(report, null, 2)}`);
			const bundleVer = report.bundled.build?.version ?? report.extensionVersion;
			const summary = report.ok
				? `GPL AI Agent Setup 정상 — MCP 번들 v${bundleVer}${report.stableCopy.exists ? ', globalStorage 사본 최신' : ''}${report.mcpJson.registered ? ', .mcp.json 등록됨' : ''}${report.claudeMd.hasBlock ? ', CLAUDE.md 안내 최신' : ''}.`
				: `GPL AI Agent Setup 점검 ${report.problems.length}건: ${report.problems.join(' / ')}`;
			const pick = report.ok
				? await vscode.window.showInformationMessage(summary, '출력 보기')
				: await vscode.window.showWarningMessage(summary, 'Export 재실행', '출력 보기');
			if (pick === 'Export 재실행') {
				await vscode.commands.executeCommand('gpl.ai.exportAgentSetup');
			} else if (pick === '출력 보기') {
				outputChannel.show(true);
			}
			return report;
		})
	);

	// 활성화 시 globalStorage MCP 사본 자동 갱신(GitHub #23): Export를 한 번이라도 실행한 PC에서 확장이 업데이트되면
	// 사본이 구버전으로 남아 Claude Code가 옛 서버(keep-alive·debug_snapshot 없는 08-05판 등)를 계속 띄우던 문제.
	// 사본이 없으면 아무것도 하지 않는다. 실행 중인 MCP 프로세스는 다음 시작 때 새 파일을 읽으므로 /mcp 재연결을 안내한다.
	if (vscode.workspace.getConfiguration('gpl.ai').get<boolean>('autoRefreshMcpBundle', true)) {
		const sync = syncStableBundleIfStale(context);
		if (sync.action !== 'absent' && sync.action !== 'up-to-date') {
			host.log(`[AI Setup] MCP 사본 동기화: ${JSON.stringify(sync)}`);
		}
		if (sync.action === 'updated') {
			const report = inspectAiAgentSetup(context);
			const from = sync.previous?.version ? `v${sync.previous.version}` : '구버전(스탬프 없음)';
			const to = sync.current?.version ? `v${sync.current.version}` : '현재 번들';
			const needExport = report.claudeMd.hasBlock && report.claudeMd.upToDate === false;
			const buttons = needExport ? ['Export 재실행', '확인'] : ['확인'];
			void vscode.window.showInformationMessage(
				`gpl-controller MCP 서버 사본을 ${from} → ${to}로 갱신했습니다. 실행 중인 Claude Code에서는 /mcp로 gpl-controller를 재연결해야 새 서버가 뜹니다.` +
				(needExport ? ' 워크스페이스 CLAUDE.md의 안내 블록은 구버전입니다 — Export 재실행을 권장합니다.' : ''),
				...buttons,
			).then(pick => {
				if (pick === 'Export 재실행') { void vscode.commands.executeCommand('gpl.ai.exportAgentSetup'); }
			});
		}
	}
}
