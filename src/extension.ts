import * as vscode from 'vscode';
import * as path from 'path';
import { GPLDefinitionProvider } from './providers/definitionProvider';
import { GPLReferenceProvider } from './providers/referenceProvider';
import { GPLCompletionProvider } from './providers/completionProvider';
import { GPLDocumentSymbolProvider } from './providers/documentSymbolProvider';
import { GPLWorkspaceSymbolProvider } from './providers/workspaceSymbolProvider';
import { GPLDiagnosticProvider } from './providers/diagnosticProvider';
import { GPLCodeActionProvider } from './providers/codeActionProvider';
import { GPLFoldingRangeProvider } from './providers/foldingRangeProvider';
import { GPLHoverProvider } from './providers/hoverProvider';
import { SymbolCache } from './symbolCache';
import { getTraceServerLevel, isTraceOn, isGplDocument } from './config';

// Controller integration
import { testConnection, getControllerConfig, sendCommand, setTrafficChannel, getTrafficChannel } from './controller/controllerConnection';
import { deploy, findProjectDirs } from './controller/deployService';
import { removeRemoteDir, removeRemoteFile, downloadProject } from './controller/ftpClient';
import { RuntimeConsole } from './controller/runtimeConsole';
import { ControllerTreeProvider } from './views/controllerTreeProvider';
import { ConnectionStatusBar } from './views/connectionStatusBar';
import { activateDebug } from './debug/activateDebug';
import { parseStack, parseThreadDetail } from './controller/responseParser';

// Global output channel for GPL extension logging
let outputChannel: vscode.OutputChannel;
let consoleChannel: vscode.OutputChannel;
let trafficChannel: vscode.OutputChannel;
let runtimeConsole: RuntimeConsole | undefined;
let statusBar: ConnectionStatusBar | undefined;
let controllerTree: ControllerTreeProvider | undefined;
let deployDiagnostics: vscode.DiagnosticCollection;

/** RuntimeConsole 싱글톤 확보 — 이미 실행 중이면 재사용, 아니면 새로 생성·시작 */
function ensureRuntimeConsole(): RuntimeConsole {
	if (runtimeConsole?.isConnected) { return runtimeConsole; }
	// 기존 인스턴스가 있지만 끊겨 있으면 dispose 후 새로 생성
	if (runtimeConsole) { runtimeConsole.stop(); }
	const cfg = getControllerConfig();
	runtimeConsole = new RuntimeConsole(consoleChannel);
	runtimeConsole.start();
	return runtimeConsole;
}

export function activate(context: vscode.ExtensionContext) {
	outputChannel = vscode.window.createOutputChannel('GPL Language Support');
	context.subscriptions.push(outputChannel);

	trafficChannel = vscode.window.createOutputChannel('GPL Traffic');
	context.subscriptions.push(trafficChannel);
	setTrafficChannel(trafficChannel);

	const thisExtension = vscode.extensions.all.find(ext => ext.extensionPath === context.extensionPath);
	const extVersion = thisExtension?.packageJSON?.version ?? 'unknown';
	outputChannel.appendLine(`GPL Language Support extension is now active! (v${extVersion})`);

	// Debug/trace logging (workspace/user settings)
	// - gpl.trace.server = off | messages | verbose
	const traceLevel = getTraceServerLevel(vscode.workspace);
	if (isTraceOn(vscode.workspace)) {
		outputChannel.appendLine(`[Trace] gpl.trace.server = ${traceLevel}`);
		outputChannel.show(true);
	}

	const symbolCache = new SymbolCache(outputChannel);
	const diagnosticProvider = new GPLDiagnosticProvider();
	
	// Register language providers
	// .gpl 파일은 (권장) gpl 언어로 열고, 호환을 위해 vb로 열린 경우도 지원한다.
	const gplSelectors: vscode.DocumentSelector = [
		{ language: 'gpl', scheme: 'file', pattern: '**/*.gpl' },
		{ language: 'vb', scheme: 'file', pattern: '**/*.gpl' },
		{ scheme: 'file', pattern: '**/*.gpl' },
		{ language: 'gpl', scheme: 'file', pattern: '**/*.gpo' },
		{ language: 'vb', scheme: 'file', pattern: '**/*.gpo' },
		{ scheme: 'file', pattern: '**/*.gpo' }
	];

	// Definition provider (Go to Definition)
	context.subscriptions.push(
		vscode.languages.registerDefinitionProvider(
			gplSelectors,
			new GPLDefinitionProvider(symbolCache, outputChannel)
		)
	);

	// Reference provider (Find All References)
	context.subscriptions.push(
		vscode.languages.registerReferenceProvider(
			gplSelectors,
			new GPLReferenceProvider(symbolCache, outputChannel)
		)
	);

	// Completion provider (IntelliSense)
	context.subscriptions.push(
		vscode.languages.registerCompletionItemProvider(
			gplSelectors,
			new GPLCompletionProvider(symbolCache),
			'.', ' ', '&'
		)
	);

	// Document symbol provider (Outline view)
	context.subscriptions.push(
		vscode.languages.registerDocumentSymbolProvider(
			gplSelectors,
			new GPLDocumentSymbolProvider()
		)
	);

	// Workspace symbol provider (Go to Symbol in Workspace)
	context.subscriptions.push(
		vscode.languages.registerWorkspaceSymbolProvider(
			new GPLWorkspaceSymbolProvider(symbolCache)
		)
	);

	// Folding provider (fix odd folding behavior on *.gpl)
	context.subscriptions.push(
		vscode.languages.registerFoldingRangeProvider(
			gplSelectors,
			new GPLFoldingRangeProvider()
		)
	);

	// Hover provider (Const value display)
	context.subscriptions.push(
		vscode.languages.registerHoverProvider(
			gplSelectors,
			new GPLHoverProvider(symbolCache, outputChannel)
		)
	);

	// Code Action provider (Quick fixes and refactoring)
	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider(
			gplSelectors,
			new GPLCodeActionProvider(),
			{
				providedCodeActionKinds: [
					vscode.CodeActionKind.QuickFix,
					vscode.CodeActionKind.Refactor,
					vscode.CodeActionKind.RefactorRewrite,
					vscode.CodeActionKind.Source
				]
			}
		)
	);

	// Diagnostic provider registration
	context.subscriptions.push(diagnosticProvider);

	// Refresh symbols command
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.refreshSymbols', async () => {
			await symbolCache.refresh();
			outputChannel.appendLine('GPL symbols cache refreshed!');
			outputChannel.show();
			vscode.window.showInformationMessage('GPL symbols refreshed!');
		})
	);
	
	// Debug command to check symbol cache
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.debugSymbolCache', () => {
			const allSymbols = symbolCache.getAllSymbols();
			outputChannel.appendLine('=== GPL Symbol Cache Debug ===');
			outputChannel.appendLine(`Total symbols: ${allSymbols.length}`);
			
			// Group by file and class
			const byFile = new Map<string, any[]>();
			for (const sym of allSymbols) {
				const fileName = sym.filePath.split('\\').pop() || sym.filePath;
				if (!byFile.has(fileName)) {
					byFile.set(fileName, []);
				}
				byFile.get(fileName)!.push(sym);
			}
			
			for (const [file, symbols] of byFile) {
				outputChannel.appendLine(`\n${file}:`);
				for (const sym of symbols) {
					const classInfo = sym.className ? ` (in class ${sym.className})` : '';
					const typeInfo = sym.returnType ? ` : ${sym.returnType}` : '';
					outputChannel.appendLine(`  [${sym.kind}] ${sym.name}${typeInfo}${classInfo} @line ${sym.line + 1}`);
				}
			}
			
			outputChannel.show();
			vscode.window.showInformationMessage('Symbol cache debug info written to output channel');
		})
	);

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
			loadXmlBestPracticesHtml(context)
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

			// 현재 문서의 진단 업데이트
			diagnosticProvider.updateDiagnostics(activeEditor.document);
			vscode.window.showInformationMessage('XML 인코딩 분석이 완료되었습니다. 문제점을 확인하세요.');
		})
	);

	// Auto-refresh symbols and diagnostics when GPL files change
	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument((event) => {
			if (isGplDocument(event.document)) {
				symbolCache.updateDocument(event.document);
				diagnosticProvider.scheduleDiagnostics(event.document, 500);
			}
		})
	);

	// Keep caches clean on delete/rename to avoid stale symbols/diagnostics.
	context.subscriptions.push(
		vscode.workspace.onDidDeleteFiles((event) => {
			for (const uri of event.files) {
				symbolCache.removeFile(uri.fsPath);
				diagnosticProvider.clearDiagnostics(uri);
			}
		})
	);

	context.subscriptions.push(
		vscode.workspace.onDidRenameFiles(async (event) => {
			for (const f of event.files) {
				// Remove old cache/diagnostics
				symbolCache.removeFile(f.oldUri.fsPath);
				diagnosticProvider.clearDiagnostics(f.oldUri);

				// Re-index the new file path so symbol filePath stays correct
				try {
					const document = await vscode.workspace.openTextDocument(f.newUri);
					if (isGplDocument(document)) {
						symbolCache.updateDocument(document);
						diagnosticProvider.scheduleDiagnostics(document, 0);
					}
				} catch (e) {
					outputChannel.appendLine(`[Rename] Failed to re-index ${f.newUri.fsPath}: ${e}`);
				}
			}
		})
	);

	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument((document) => {
			if (isGplDocument(document)) {
				// Skip during refresh — indexWorkspace already calls updateDocument
				if (!symbolCache.isRefreshing) {
					symbolCache.updateDocument(document);
				}
				diagnosticProvider.scheduleDiagnostics(document, 0);
			}
		})
	);

	// 문서 저장 시 진단 업데이트
	context.subscriptions.push(
		vscode.workspace.onDidSaveTextDocument((document) => {
			if (isGplDocument(document)) {
				diagnosticProvider.scheduleDiagnostics(document, 0);
			}
		})
	);

	// ════════════════════════════════════════════════════════════
	// Controller integration – initialization
	// ════════════════════════════════════════════════════════════
	consoleChannel = vscode.window.createOutputChannel('GPL Console');
	context.subscriptions.push(consoleChannel);

	deployDiagnostics = vscode.languages.createDiagnosticCollection('gpl-deploy');
	context.subscriptions.push(deployDiagnostics);

	statusBar = new ConnectionStatusBar();
	context.subscriptions.push(statusBar);

	controllerTree = new ControllerTreeProvider();
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('gplThreads', controllerTree)
	);

	// 연결 유실 감지 → 상태바 + 알림 갱신
	controllerTree.onDidLoseConnection(() => {
		statusBar?.setConnected(false);
		outputChannel.appendLine('[Controller] Connection lost (3 consecutive failures)');
		vscode.window.showWarningMessage('GPL Controller 연결이 끊어졌습니다.');
	});

	// ── Controller commands ──────────────────────────────────

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.connect', async () => {
			const cfg = getControllerConfig();
			outputChannel.appendLine(`[Controller] Connecting to ${cfg.ip}:${cfg.port} …`);
			try {
				const ok = await testConnection(cfg);
				if (ok) {
					vscode.window.showInformationMessage(`GPL Controller 연결 성공: ${cfg.ip}`);
					statusBar?.setConnected(true);
					controllerTree?.setConnected(true);
				} else {
					vscode.window.showErrorMessage(`GPL Controller 연결 실패: ${cfg.ip}`);
					statusBar?.setConnected(false);
				}
			} catch (err: any) {
				vscode.window.showErrorMessage(`연결 오류: ${err.message ?? err}`);
				statusBar?.setConnected(false);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.disconnect', () => {
			runtimeConsole?.stop();
			runtimeConsole = undefined;
			statusBar?.setConnected(false);
			controllerTree?.setConnected(false);
			vscode.window.showInformationMessage('GPL Controller 연결 해제');
		})
	);

	// --- Deploy helper (공통 로직) ---
	async function runDeploy(skipStart: boolean) {
		const cfg = getControllerConfig();
		const projectDirs = await findProjectDirs();
		if (projectDirs.length === 0) {
			vscode.window.showWarningMessage('워크스페이스에서 .gpr 프로젝트 파일을 찾을 수 없습니다.');
			return;
		}

		let projectDir: string;
		if (projectDirs.length === 1) {
			projectDir = projectDirs[0];
		} else {
			const pick = await vscode.window.showQuickPick(
				projectDirs.map(d => ({ label: d })),
				{ placeHolder: '배포할 프로젝트를 선택하세요' }
			);
			if (!pick) { return; }
			projectDir = pick.label;
		}

		const mode = skipStart ? 'Build' : 'Deploy & Run';
		outputChannel.appendLine(`[Deploy] Starting ${mode}: ${projectDir} → ${cfg.ip}`);
		outputChannel.show(true);

		try {
			const result = await deploy({ projectDir, skipStart }, outputChannel, deployDiagnostics);
			if (result.success) {
				if (skipStart) {
					vscode.window.showInformationMessage(`빌드 완료: ${result.projectName} (Start는 별도로 실행하세요)`);
				} else {
					vscode.window.showInformationMessage(`배포 완료: ${result.projectName}`);
					ensureRuntimeConsole();
					consoleChannel.show(true);
				}
			} else {
				const errMsg = result.compileErrors.length > 0
					? `${result.compileErrors.length}개 컴파일 에러`
					: '알 수 없는 오류';
				vscode.window.showErrorMessage(`배포 실패: ${errMsg}`);
			}
		} catch (err: any) {
			vscode.window.showErrorMessage(`배포 오류: ${err.message ?? err}`);
			outputChannel.appendLine(`[Deploy] Error: ${err.stack ?? err}`);
		}
	}

	// gpl.deploy — Stop + Upload + Compile (Start 안 함, 디버그 친화)
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.deploy', () => runDeploy(true))
	);

	// gpl.deployRun — Stop + Upload + Compile + Start (기존 원클릭 실행)
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.deployRun', () => runDeploy(false))
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.console.start', () => {
			ensureRuntimeConsole();
			consoleChannel.show(true);
			vscode.window.showInformationMessage('GPL 런타임 콘솔 시작');
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.console.stop', () => {
			runtimeConsole?.stop();
			runtimeConsole = undefined;
			vscode.window.showInformationMessage('GPL 런타임 콘솔 중지');
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.threads.refresh', () => {
			controllerTree?.refreshAll();
		})
	);

	// 포트 클릭 → 통신 테스트
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.pingPort', async (portType: string, ip: string, port: number) => {
			const label = portType === 'command' ? '명령 포트' : '콘솔 포트';
			const start = Date.now();

			if (portType === 'command') {
				// TCP 명령 포트: Show Thread 명령으로 왕복 측정
				try {
					const resp = await sendCommand('Show Thread', { ip, port }, 5000);
					const elapsed = Date.now() - start;
					if (resp) {
						vscode.window.showInformationMessage(`${label} (${ip}:${port}) 응답 OK — ${elapsed}ms`);
					} else {
						vscode.window.showWarningMessage(`${label} (${ip}:${port}) 응답 없음`);
					}
				} catch (err: any) {
					vscode.window.showErrorMessage(`${label} (${ip}:${port}) 실패: ${err.message ?? err}`);
				}
			} else {
				// 콘솔 포트: TCP 연결만 테스트 (소켓 열림 확인)
				const net = await import('net');
				const socket = new net.Socket();
				const timer = setTimeout(() => {
					socket.destroy();
					vscode.window.showWarningMessage(`${label} (${ip}:${port}) 타임아웃 (5s)`);
				}, 5000);

				socket.connect(port, ip, () => {
					const elapsed = Date.now() - start;
					clearTimeout(timer);
					socket.destroy();
					vscode.window.showInformationMessage(`${label} (${ip}:${port}) 연결 OK — ${elapsed}ms`);
				});
				socket.on('error', (err: Error) => {
					clearTimeout(timer);
					vscode.window.showErrorMessage(`${label} (${ip}:${port}) 실패: ${err.message}`);
				});
			}
		})
	);

	// 연결 섹션 클릭 → 트래픽 모니터 열기
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.showTraffic', () => {
			trafficChannel.show(true);
		})
	);

	// 제어기에 임의 명령 전송
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.sendCommand', async () => {
			const cmd = await vscode.window.showInputBox({
				prompt: '제어기에 보낼 명령을 입력하세요',
				placeHolder: 'Show Thread, ErrorLog, Stop -all, …',
			});
			if (!cmd) { return; }
			try {
				const resp = await sendCommand(cmd);
				outputChannel.appendLine(`[Command] >>> ${cmd}`);
				outputChannel.appendLine(resp);
				outputChannel.show(true);
			} catch (err: any) {
				vscode.window.showErrorMessage(`명령 실패: ${err.message ?? err}`);
			}
		})
	);

	// 전체 정지 (Stop -all)
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.stopAll', async () => {
			try {
				await sendCommand('Stop -all');
				vscode.window.showWarningMessage('전체 정지 완료 (Stop -all)');
				controllerTree?.refresh();
			} catch (err: any) {
				vscode.window.showErrorMessage(`전체 정지 실패: ${err.message ?? err}`);
			}
		})
	);

	// 콘솔 토글 (시작/중지)
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.consoleToggle', () => {
			if (runtimeConsole?.isConnected) {
				runtimeConsole.stop();
				runtimeConsole = undefined;
				vscode.window.showInformationMessage('런타임 콘솔 중지');
			} else {
				ensureRuntimeConsole();
				consoleChannel.show(true);
				vscode.window.showInformationMessage('런타임 콘솔 시작');
			}
		})
	);

	// 에러 로그 초기화
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.clearErrors', async () => {
			try {
				await sendCommand('ErrorLog -clear');
				vscode.window.showInformationMessage('에러 로그 초기화 완료');
				controllerTree?.refresh();
			} catch (err: any) {
				vscode.window.showErrorMessage(`에러 로그 초기화 실패: ${err.message ?? err}`);
			}
		})
	);

	// FTP 파일 목록 새로고침
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.refreshFtp', () => {
			controllerTree?.refreshFtp();
		})
	);

	// 시스템 정보 새로고침
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.refreshSystemInfo', () => {
			controllerTree?.refreshSystemInfo();
		})
	);

	// 개별 쓰레드 시작/정지
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.threadStart', async (node: any) => {
			if (!node?.thread?.name) { return; }
			try {
				await sendCommand(`Start ${node.thread.name}`);
				controllerTree?.refresh();
			} catch (err: any) {
				vscode.window.showErrorMessage(`쓰레드 시작 실패: ${err.message ?? err}`);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.threadStop', async (node: any) => {
			if (!node?.thread?.name) { return; }
			try {
				await sendCommand(`Stop ${node.thread.name}`);
				controllerTree?.refresh();
			} catch (err: any) {
				vscode.window.showErrorMessage(`쓰레드 정지 실패: ${err.message ?? err}`);
			}
		})
	);

	// 쓰레드 일시정지 (Break)
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.threadBreak', async (node: any) => {
			if (!node?.thread?.name) { return; }
			try {
				await sendCommand(`Break ${node.thread.name}`);
				vscode.window.showInformationMessage(`${node.thread.name} 일시정지`);
				controllerTree?.refresh();
			} catch (err: any) {
				vscode.window.showErrorMessage(`일시정지 실패: ${err.message ?? err}`);
			}
		})
	);

	// 쓰레드 재개 (Continue)
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.threadContinue', async (node: any) => {
			if (!node?.thread?.name) { return; }
			try {
				await sendCommand(`Continue ${node.thread.name}`);
				controllerTree?.refresh();
			} catch (err: any) {
				vscode.window.showErrorMessage(`재개 실패: ${err.message ?? err}`);
			}
		})
	);

	// 쓰레드 에러 건너뛰기 계속 (Continue -noerror)
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.threadContinueNoError', async (node: any) => {
			if (!node?.thread?.name) { return; }
			try {
				await sendCommand(`Continue ${node.thread.name} -noerror`);
				vscode.window.showInformationMessage(`${node.thread.name} 에러 건너뛰고 재개`);
				controllerTree?.refresh();
			} catch (err: any) {
				vscode.window.showErrorMessage(`재개 실패: ${err.message ?? err}`);
			}
		})
	);

	// 쓰레드 스텝 실행 (Step)
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.threadStep', async (node: any) => {
			if (!node?.thread?.name) { return; }
			try {
				await sendCommand(`Step ${node.thread.name}`);
				controllerTree?.refresh();
			} catch (err: any) {
				vscode.window.showErrorMessage(`스텝 실행 실패: ${err.message ?? err}`);
			}
		})
	);

	// FTP 프로젝트 다운로드
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.ftpDownload', async (node: any) => {
			const name: string | undefined = node?.label;
			if (!name) { return; }

			// 저장 위치 선택
			const targetUri = await vscode.window.showOpenDialog({
				canSelectFolders: true,
				canSelectFiles: false,
				canSelectMany: false,
				openLabel: '여기에 다운로드',
				title: `"${name}" 프로젝트 다운로드 위치 선택`,
			});
			if (!targetUri?.[0]) { return; }

			const localDir = path.join(targetUri[0].fsPath, name);
			const cfg = getControllerConfig();
			const remotePath = `${cfg.ftpBasePath}/${name}`;

			await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: `${name} 다운로드 중...`, cancellable: false },
				async (progress) => {
					try {
						const result = await downloadProject(cfg.ip, remotePath, localDir, (cur, total, file) => {
							progress.report({ increment: (1 / total) * 100, message: file });
						});
						const openChoice = await vscode.window.showInformationMessage(
							`"${name}" 다운로드 완료 (${result.downloaded}개 파일)`,
							'폴더 열기', '워크스페이스에 추가',
						);
						if (openChoice === '폴더 열기') {
							await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(localDir));
						} else if (openChoice === '워크스페이스에 추가') {
							vscode.workspace.updateWorkspaceFolders(
								vscode.workspace.workspaceFolders?.length ?? 0, 0,
								{ uri: vscode.Uri.file(localDir), name },
							);
						}
					} catch (err: any) {
						vscode.window.showErrorMessage(`다운로드 실패: ${err.message ?? err}`);
					}
				},
			);
		})
	);

	// FTP 항목 삭제
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.ftpDelete', async (node: any) => {
			const name: string | undefined = node?.label;
			const ctx: string | undefined = node?.contextValue;
			if (!name || !ctx) { return; }

			const isDir = ctx === 'ftpFolder';
			const confirm = await vscode.window.showWarningMessage(
				`${isDir ? '폴더' : '파일'} "${name}"을(를) 제어기에서 삭제하시겠습니까?`,
				{ modal: true }, '삭제'
			);
			if (confirm !== '삭제') { return; }

			const cfg = getControllerConfig();
			const remotePath = `${cfg.ftpBasePath}/${name}`;
			try {
				if (isDir) {
					await removeRemoteDir(cfg.ip, remotePath);
				} else {
					await removeRemoteFile(cfg.ip, remotePath);
				}
				vscode.window.showInformationMessage(`"${name}" 삭제 완료`);
				controllerTree?.refreshFtp();
			} catch (err: any) {
				vscode.window.showErrorMessage(`삭제 실패: ${err.message ?? err}`);
			}
		})
	);

	// FTP 폴더 컴파일 & 실행 (Load 에러 핸들링 포함)
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.ftpRun', async (node: any) => {
			const name: string | undefined = node?.label;
			if (!name) { return; }

			const cfg = getControllerConfig();
			const loadPath = `${cfg.ftpBasePath}/${name}`;

			outputChannel.show(true);
			outputChannel.appendLine('');
			outputChannel.appendLine(`━━ [FTP Run] ${name} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

			try {
				// 1) Compile 시도
				outputChannel.appendLine(`│ Compile ${name}`);
				try {
					await sendCommand(`Compile ${name}`);
					outputChannel.appendLine(`│ ✔ Compile success`);
				} catch (compErr: any) {
					const msg = compErr.message || '';
					if (msg.includes('-745')) {
						// 이미 로드됨 → Unload → Load → Compile
						outputChannel.appendLine(`│ ⚠ Already loaded → Unload → Load → Compile`);
						await sendCommand(`Unload ${name}`);
						await sendCommand(`Load ${loadPath}`);
						await sendCommand(`Compile ${name}`);
						outputChannel.appendLine(`│ ✔ Compile success (after reload)`);
					} else if (msg.includes('-508') || msg.includes('-743')) {
						// 로드 안됨 → Load → Compile
						outputChannel.appendLine(`│ ⚠ Not loaded → Load → Compile`);
						await sendCommand(`Load ${loadPath}`);
						await sendCommand(`Compile ${name}`);
						outputChannel.appendLine(`│ ✔ Compile success (after load)`);
					} else {
						throw compErr;
					}
				}

				// 2) 콘솔 자동 시작 (아직 꺼져 있으면)
				ensureRuntimeConsole();
				consoleChannel.show(true);

				// 3) Start
				outputChannel.appendLine(`│ Start ${name}`);
				await sendCommand(`Start ${name}`);
				outputChannel.appendLine(`│ ✔ Start success`);
				vscode.window.showInformationMessage(`${name} 컴파일 & 실행 완료`);
				controllerTree?.refresh();
			} catch (err: any) {
				outputChannel.appendLine(`│ ✘ 실패: ${err.message ?? err}`);
				vscode.window.showErrorMessage(`${name} 실행 실패: ${err.message ?? err}`);
			}
		})
	);

	// FTP 폴더 중지
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.ftpStop', async (node: any) => {
			const name: string | undefined = node?.label;
			if (!name) { return; }

			try {
				await sendCommand(`Stop ${name}`);
				vscode.window.showInformationMessage(`${name} 중지 완료`);
				controllerTree?.refresh();
			} catch (err: any) {
				vscode.window.showErrorMessage(`${name} 중지 실패: ${err.message ?? err}`);
			}
		})
	);

	// FTP 폴더 Unload (메모리 해제)
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.ftpUnload', async (node: any) => {
			const name: string | undefined = node?.label;
			if (!name) { return; }

			try {
				await sendCommand(`Unload ${name}`);
				vscode.window.showInformationMessage(`${name} Unload 완료`);
				controllerTree?.refresh();
			} catch (err: any) {
				vscode.window.showErrorMessage(`Unload 실패: ${err.message ?? err}`);
			}
		})
	);

	// ════════════════════════════════════════════════════════════
	// Thread stopped-location indicator (click paused thread → show line)
	// ════════════════════════════════════════════════════════════

	// Decoration: yellow arrow + line highlight for the stopped position
	const stoppedLineDecoration = vscode.window.createTextEditorDecorationType({
		isWholeLine: true,
		backgroundColor: new vscode.ThemeColor('editor.stackFrameHighlightBackground'),
		gutterIconPath: undefined,  // VS Code 내장 색상 사용
		overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.warningForeground'),
		overviewRulerLane: vscode.OverviewRulerLane.Center,
	});
	context.subscriptions.push(stoppedLineDecoration);

	// Track the current decoration so we can clear it
	let stoppedDecorationEditor: vscode.TextEditor | undefined;

	/** Clear the stopped-line highlight */
	function clearStoppedDecoration(): void {
		if (stoppedDecorationEditor) {
			stoppedDecorationEditor.setDecorations(stoppedLineDecoration, []);
			stoppedDecorationEditor = undefined;
		}
	}

	// Clear highlight when user starts editing or switches away
	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument(() => clearStoppedDecoration()),
	);

	/**
	 * Resolve a GPL filename (basename) to a workspace file path.
	 * Scans all workspace folders for .gpl/.gpo files.
	 */
	function resolveGplFilePath(filename: string): string | undefined {
		const target = filename.toLowerCase();
		const folders = vscode.workspace.workspaceFolders;
		if (!folders) { return undefined; }

		function scan(dir: string): string | undefined {
			try {
				const entries = require('fs').readdirSync(dir, { withFileTypes: true });
				for (const entry of entries) {
					const full = path.join(dir, entry.name);
					if (entry.isDirectory()) {
						if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'out') { continue; }
						const found = scan(full);
						if (found) { return found; }
					} else if (entry.name.toLowerCase() === target) {
						return full;
					}
				}
			} catch { /* skip */ }
			return undefined;
		}

		for (const folder of folders) {
			const found = scan(folder.uri.fsPath);
			if (found) { return found; }
		}
		return undefined;
	}

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.threadShowLocation', async (node: any) => {
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
				const filePath = resolveGplFilePath(topFrame.file);
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
				clearStoppedDecoration();
				const lineRange = doc.lineAt(line).range;
				editor.setDecorations(stoppedLineDecoration, [{ range: lineRange }]);
				stoppedDecorationEditor = editor;

				outputChannel.appendLine(
					`[Thread] ${threadName} 정지 위치: ${topFrame.file}:${topFrame.fileLine} (${topFrame.process})`,
				);
			} catch (err: any) {
				vscode.window.showErrorMessage(`스택 조회 실패: ${err.message ?? err}`);
			}
		})
	);

	// ════════════════════════════════════════════════════════════
	// Debug Adapter Protocol (DAP) — brooks-gpl debugger
	// ════════════════════════════════════════════════════════════
	activateDebug(context);

	// 디버그 세션 중 사이드바 폴링 일시 중지 (TCP 충돌 방지)
	context.subscriptions.push(
		vscode.debug.onDidStartDebugSession(session => {
			if (session.type === 'brooks-gpl') {
				controllerTree?.stopPolling();
			}
		}),
		vscode.debug.onDidTerminateDebugSession(session => {
			if (session.type === 'brooks-gpl') {
				controllerTree?.startPolling();
			}
		}),
	);

	// ════════════════════════════════════════════════════════════
	// Symbol cache & diagnostics initialization
	// ════════════════════════════════════════════════════════════

	// Initialize symbol cache and diagnostics for open documents
	outputChannel.appendLine('Initializing symbol cache...');
	symbolCache.refresh().then(() => {
		outputChannel.appendLine('Symbol cache initialized!');
		if (isTraceOn(vscode.workspace)) {
			outputChannel.show(true);
		}
	});
	
	// 열려있는 GPL 문서들에 대해 진단 실행
	vscode.workspace.textDocuments.forEach(document => {
		if (isGplDocument(document)) {
			diagnosticProvider.scheduleDiagnostics(document, 0);
		}
	});
}

export function deactivate() {
	// Controller cleanup
	runtimeConsole?.stop();
	controllerTree?.stopPolling();

	if (outputChannel) {
		outputChannel.appendLine('GPL Language Support extension is now deactivated!');
		outputChannel.dispose();
	}
}

// Export logging function for use in other modules
export function logMessage(message: string) {
	if (outputChannel) {
		outputChannel.appendLine(message);
	}
}

/**
 * XML 베스트 프랙티스 HTML 로드
 */
async function loadXmlBestPracticesHtml(context: vscode.ExtensionContext): Promise<string> {
	try {
		const uri = vscode.Uri.joinPath(context.extensionUri, 'media', 'xmlBestPractices.html');
		const bytes = await vscode.workspace.fs.readFile(uri);
		return Buffer.from(bytes).toString('utf8');
	} catch (error) {
		if (outputChannel) {
			const message =
				'Failed to load media/xmlBestPractices.html; falling back to inline XML best practices HTML.'
				+ (error instanceof Error && error.message ? ` Reason: ${error.message}` : '');
			outputChannel.appendLine(message);
		}
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
