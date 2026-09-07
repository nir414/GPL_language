/**
 * XML 관련 명령 — 베스트 프랙티스 웹뷰(`gpl.showXmlBestPractices`)·인코딩 분석(`gpl.analyzeXmlEncoding`).
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import { isGplDocument } from '../config';
import type { ExtensionHost } from './host';

/**
 * XML 베스트 프랙티스 HTML 로드
 */
async function loadXmlBestPracticesHtml(host: ExtensionHost): Promise<string> {
	try {
		const uri = vscode.Uri.joinPath(host.context.extensionUri, 'media', 'xmlBestPractices.html');
		const bytes = await vscode.workspace.fs.readFile(uri);
		return Buffer.from(bytes).toString('utf8');
	} catch (error) {
		const message =
			'Failed to load media/xmlBestPractices.html; falling back to inline XML best practices HTML.'
			+ (error instanceof Error && error.message ? ` Reason: ${error.message}` : '');
		host.outputChannel.appendLine(message);
		return getXmlBestPracticesFallbackHtml();
	}
}

/**
 * 폴백 HTML (리소스 파일 로드 실패 시)
 */
function getXmlBestPracticesFallbackHtml(): string {
	return `<!DOCTYPE html>
<html lang="ko">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>GPL XML 베스트 프랙티스</title>
</head>
<body>
	<h2>GPL XML 베스트 프랙티스</h2>
	<p>가이드 파일을 로드하지 못했습니다. 확장 로그(Output: "GPL Language Support")를 확인하세요.</p>
</body>
</html>`;
}

export function activateXmlCommands(host: ExtensionHost): void {
	const { context, outputChannel, diagnosticProvider } = host;

	// XML 베스트 프랙티스 보기 명령
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.showXmlBestPractices', () => {
			const panel = vscode.window.createWebviewPanel(
				'gplXmlBestPractices',
				'GPL XML 베스트 프랙티스',
				vscode.ViewColumn.Two,
				{}
			);

			// Load HTML from media/ instead of hardcoding a huge template string in TS.
			// This improves maintainability and keeps src/ focused on logic.
			loadXmlBestPracticesHtml(host)
				.then(html => {
					panel.webview.html = html;
				})
				.catch(err => {
					outputChannel.appendLine(`[Webview] Failed to load xmlBestPractices.html: ${err}`);
					panel.webview.html = getXmlBestPracticesFallbackHtml();
				});
		})
	);

	// XML 인코딩 분석 명령
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.analyzeXmlEncoding', () => {
			const activeEditor = vscode.window.activeTextEditor;
			if (!activeEditor || !isGplDocument(activeEditor.document)) {
				vscode.window.showWarningMessage('GPL 파일에서만 XML 분석이 가능합니다.');
				return;
			}

			// 진단 게이트(gpl.diagnostics.experimental, 기본 false)가 꺼져 있으면 updateDiagnostics는
			// 아무것도 표시하지 않는다 — "분석 완료"로 오인시키지 않고 비활성 상태를 그대로 안내한다.
			const diagnosticsEnabled = vscode.workspace
				.getConfiguration('gpl.diagnostics')
				.get<boolean>('experimental', false);
			if (!diagnosticsEnabled) {
				vscode.window.showInformationMessage(
					'GPL 진단이 비활성화되어 있어 XML 인코딩 분석 결과가 표시되지 않습니다. 설정 gpl.diagnostics.experimental을 켜면 Problems에 결과가 표시됩니다.',
				);
				return;
			}

			// 현재 문서의 진단 업데이트
			diagnosticProvider.updateDiagnostics(activeEditor.document);
			vscode.window.showInformationMessage('XML 인코딩 분석이 완료되었습니다. 문제점을 확인하세요.');
		})
	);
}
