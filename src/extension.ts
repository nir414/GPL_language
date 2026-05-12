import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
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
import { testConnection, getControllerConfig, sendCommand, setTrafficChannel, getTrafficChannel, setSessionControllerOverride, clearSessionControllerOverride } from './controller/controllerConnection';
import { deploy, findProjectDirs } from './controller/deployService';
import { removeRemoteDir, removeRemoteFile, downloadProject } from './controller/ftpClient';
import { RuntimeConsole } from './controller/runtimeConsole';
import { ControllerTreeProvider } from './views/controllerTreeProvider';
import { ConnectionStatusBar } from './views/connectionStatusBar';
import { activateDebug } from './debug/activateDebug';
import { parseCompileErrors, parseStack, parseThreadDetail, parseGpr, parseStatus, parseThreadList } from './controller/responseParser';
import { startLiveLogTerminal, stopLiveLogTerminal, appendLiveLog, isLiveLogTerminalEnabled } from './log/liveLogTerminal';

// Global output channel for GPL extension logging
let outputChannel: vscode.OutputChannel;
let consoleChannel: vscode.OutputChannel;
let trafficChannel: vscode.OutputChannel;
let runtimeConsole: RuntimeConsole | undefined;
let statusBar: ConnectionStatusBar | undefined;
let controllerTree: ControllerTreeProvider | undefined;
let deployDiagnostics: vscode.DiagnosticCollection;

/**
 * RuntimeConsole 싱글톤 확보.
 *
 * 인스턴스를 재사용한다. start()가 idempotent하므로 idle/연결 중/재연결 대기
 * 어떤 상태에서 호출되어도 좀비 인스턴스나 중복 소켓이 생기지 않는다.
 * (이전: 끊긴 인스턴스를 stop+재생성 → 좀비의 reconnect timer가 1403을 두고 경쟁)
 */
function ensureRuntimeConsole(): RuntimeConsole {
	if (!runtimeConsole) {
		runtimeConsole = new RuntimeConsole(consoleChannel, outputChannel);
	}
	runtimeConsole.start();
	return runtimeConsole;
}

export function activate(context: vscode.ExtensionContext) {
	outputChannel = vscode.window.createOutputChannel('GPL Language Support');
	context.subscriptions.push(outputChannel);

	trafficChannel = vscode.window.createOutputChannel('GPL Traffic');
	context.subscriptions.push(trafficChannel);
	setTrafficChannel(trafficChannel);

	function logOutput(msg: string): void {
		outputChannel.appendLine(msg);
		appendLiveLog(`[main] ${msg}`);
	}

	function logConsole(msg: string): void {
		consoleChannel?.appendLine(msg);
		appendLiveLog(`[console] ${msg}`);
	}

	function logTraffic(msg: string): void {
		trafficChannel.appendLine(msg);
		appendLiveLog(`[traffic] ${msg}`);
	}

	function sleep(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	function summarizeDeployErrorLog(entry: string): string {
		const normalized = (entry || '').replace(/\s+/g, ' ').trim();
		if (!normalized) {
			return 'ErrorLog 내용 없음';
		}
		if (normalized.length <= 140) {
			return normalized;
		}
		return `${normalized.slice(0, 137)}...`;
	}

	function parseControllerErrorLogEntry(entry: string): { timestamp: string; source: string; code: number; message: string } | undefined {
		const match = entry.match(/^(\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}:\d{2}\.\d{3}),\s*([^,]+),\s*(-?\d+),\s*"?([^"]*)"?$/);
		if (!match) { return undefined; }
		return {
			timestamp: match[1],
			source: match[2].trim(),
			code: Number(match[3]),
			message: match[4].trim(),
		};
	}

	function classifyDeployErrorLog(entry: string): { summary: string; detail?: string; isControllerError: boolean } {
		const controllerError = parseControllerErrorLogEntry(entry);
		if (!controllerError) {
			return {
				summary: summarizeDeployErrorLog(entry),
				isControllerError: false,
			};
		}

		if (controllerError.code === -1521) {
			return {
				summary: `제어기 PDB 파일 오류 (-1521): ${controllerError.message}`,
				detail: '분류: controller /flash/config 의 *.pac 파일 형식/로드 문제(공식 문서 기준). GPL 코드 오류로 직접 분류하지 않음.',
				isControllerError: true,
			};
		}

		if (controllerError.code === -1520) {
			return {
				summary: `제어기 PDB 파일 누락 (-1520): ${controllerError.message}`,
				detail: '분류: controller /flash/config 의 parameter DB 파일 누락/열기 실패(공식 문서 기준).',
				isControllerError: true,
			};
		}

		return {
			summary: `제어기 ErrorLog ${controllerError.source} ${controllerError.code}: ${controllerError.message}`,
			detail: '분류: controller ErrorLog 항목. 현재 실행 결과와 과거 누적 항목을 분리 확인 필요.',
			isControllerError: true,
		};
	}

	function isBusyStatus(code: number): boolean {
		// -752: controller busy / temporarily unavailable
		return code === -752;
	}

	async function sendCommandWithBusyRetry(
		command: string,
		config?: Parameters<typeof sendCommand>[1],
		options?: { maxAttempts?: number; baseDelayMs?: number },
	): Promise<string> {
		const maxAttempts = Math.max(1, options?.maxAttempts ?? 4);
		const baseDelayMs = Math.max(100, options?.baseDelayMs ?? 400);
		let lastError: any;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				const resp = await sendCommand(command, config);
				const status = parseStatus(resp);
				if (status.code === 0) {
					return resp;
				}

				if (isBusyStatus(status.code) && attempt < maxAttempts) {
					const delay = baseDelayMs * attempt;
					logOutput(`[Retry] ${command} -> STATUS ${status.code} (busy), retry in ${delay}ms (${attempt}/${maxAttempts})`);
					await sleep(delay);
					continue;
				}

				return resp;
			} catch (err: any) {
				lastError = err;
				if (attempt >= maxAttempts) { break; }
				const delay = baseDelayMs * attempt;
				logOutput(`[Retry] ${command} -> network error: ${err?.message ?? err}, retry in ${delay}ms (${attempt}/${maxAttempts})`);
				await sleep(delay);
			}
		}

		throw lastError ?? new Error(`Command failed after retries: ${command}`);
	}

	async function verifyThreadStopped(threadName: string, maxAttempts = 6): Promise<boolean> {
		const target = threadName.toLowerCase();
		for (let i = 1; i <= maxAttempts; i++) {
			try {
				const resp = await sendCommandWithBusyRetry('Show Thread', undefined, { maxAttempts: 2, baseDelayMs: 250 });
				const threads = parseThreadList(resp);
				const found = threads.find(t => t.name.toLowerCase() === target);
				if (!found) {
					return true;
				}

				const state = (found.state || '').toString().toLowerCase();
				const stillActive = state.includes('run') || state.includes('pause') || state.includes('break') || state.includes('error') || state.includes('stopp');
				if (!stillActive) {
					return true;
				}
			} catch {
				// transient failure: continue polling window
			}

			await sleep(250 * i);
		}

		return false;
	}

	async function verifyAllStopped(maxAttempts = 6): Promise<boolean> {
		for (let i = 1; i <= maxAttempts; i++) {
			try {
				const resp = await sendCommandWithBusyRetry('Show Thread', undefined, { maxAttempts: 2, baseDelayMs: 250 });
				const threads = parseThreadList(resp);
				if (threads.length === 0) {
					return true;
				}

				const hasActive = threads.some(t => {
					const state = (t.state || '').toString().toLowerCase();
					return state.includes('run') || state.includes('pause') || state.includes('break') || state.includes('error') || state.includes('stopp');
				});
				if (!hasActive) {
					return true;
				}
			} catch {
				// transient failure: retry within window
			}

			await sleep(300 * i);
		}

		return false;
	}

	async function trySoftEStopRecovery(targetName?: string): Promise<boolean> {
		const targetLabel = targetName ? `${targetName}` : '전체 스레드';
		const choice = await vscode.window.showWarningMessage(
			`${targetLabel} 정지가 확인되지 않았어. SoftEStop을 실행해서 제어된 감속 정지를 시도할까?`,
			{ modal: true },
			'SoftEStop 실행',
			'취소',
		);
		if (choice !== 'SoftEStop 실행') {
			return false;
		}

		try {
			await sendCommandWithBusyRetry('SoftEStop', undefined, { maxAttempts: 3, baseDelayMs: 500 });
			logOutput('[Recovery] SoftEStop executed');
			await sleep(800);
			const ok = targetName ? await verifyThreadStopped(targetName, 8) : await verifyAllStopped(8);
			if (ok) {
				vscode.window.showWarningMessage(`SoftEStop 후 ${targetLabel} 정지 확인 완료`);
				return true;
			}

			vscode.window.showWarningMessage(`SoftEStop 후에도 ${targetLabel} 정지 확인이 안 됐어. 컨트롤러 상태 점검이 필요해.`);
			return false;
		} catch (err: any) {
			vscode.window.showErrorMessage(`SoftEStop 실패: ${err?.message ?? err}`);
			return false;
		}
	}

	const thisExtension = vscode.extensions.all.find(ext => ext.extensionPath === context.extensionPath);
	const extVersion = thisExtension?.packageJSON?.version ?? 'unknown';
	logOutput(`GPL Language Support extension is now active! (v${extVersion})`);

	// Debug/trace logging (workspace/user settings)
	// - gpl.trace.server = off | messages | verbose
	const traceLevel = getTraceServerLevel(vscode.workspace);
	if (isTraceOn(vscode.workspace)) {
		logOutput(`[Trace] gpl.trace.server = ${traceLevel}`);
		outputChannel.show(true);
	}

	function hasOpenGplContext(): boolean {
		return vscode.workspace.textDocuments.some(doc => isGplDocument(doc));
	}

	const runtimeConsoleCfg = vscode.workspace.getConfiguration('gpl.runtimeConsole');
	const autoStartConsoleOnDeploy = runtimeConsoleCfg.get<boolean>('autoStartOnDeploy', false);
	const autoStartConsoleOnDebug = runtimeConsoleCfg.get<boolean>('autoStartOnDebug', true);

	const autoStartLiveTerminal = vscode.workspace
		.getConfiguration('gpl.trace')
		.get<boolean>('liveTerminal.autoStart', false);
	if (autoStartLiveTerminal) {
		if (hasOpenGplContext()) {
			startLiveLogTerminal();
			logOutput('[Trace] live terminal auto-start enabled');
		} else {
			logOutput('[Trace] live terminal auto-start skipped (no open GPL document)');
		}
	}

	const symbolCache = new SymbolCache(outputChannel);
	const diagnosticProvider = new GPLDiagnosticProvider();
	let symbolCacheInitPromise: Promise<void> | null = null;

	function ensureSymbolCacheInitialized(reason: string): Promise<void> {
		if (symbolCacheInitPromise) { return symbolCacheInitPromise; }
		outputChannel.appendLine(`Initializing symbol cache... (${reason})`);
		symbolCacheInitPromise = symbolCache.refresh()
			.then(() => {
				outputChannel.appendLine('Symbol cache initialized!');
				if (isTraceOn(vscode.workspace)) {
					outputChannel.show(true);
				}
			})
			.catch((err) => {
				outputChannel.appendLine(`[SymbolCache] Initialization failed: ${err}`);
				symbolCacheInitPromise = null;
			});
		return symbolCacheInitPromise;
	}
	
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
			await ensureSymbolCacheInitialized('manual refresh');
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
				void ensureSymbolCacheInitialized('GPL document opened');
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

	async function detectWorkspaceProjectContext(): Promise<{ projectName: string; folderName: string }> {
		const dirs = await findProjectDirs();
		if (dirs.length === 0) {
			return { projectName: '', folderName: '' };
		}

		const activePath = vscode.window.activeTextEditor?.document?.uri.scheme === 'file'
			? vscode.window.activeTextEditor.document.uri.fsPath
			: '';

		const sortedDirs = [...dirs].sort((a, b) => b.length - a.length);
		let preferred = sortedDirs[0];
		if (activePath) {
			const matched = sortedDirs.find(d => {
				try {
					const rel = path.relative(path.resolve(d), path.resolve(activePath));
					return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
				} catch {
					return false;
				}
			});
			if (matched) { preferred = matched; }
		}

		const folderName = path.basename(preferred).trim();
		try {
			const gprPath = path.join(preferred, 'Project.gpr');
			const text = fs.readFileSync(gprPath, 'utf-8');
			const info = parseGpr(text);
			return {
				projectName: (info.projectName || folderName).trim(),
				folderName,
			};
		} catch {
			return { projectName: folderName, folderName };
		}
	}

	async function detectWorkspaceProjectName(): Promise<string> {
		const context = await detectWorkspaceProjectContext();
		return context.projectName;
	}

	let expectedProjectSyncTimer: ReturnType<typeof setTimeout> | undefined;
	function scheduleExpectedProjectSync(reason: string): void {
		if (expectedProjectSyncTimer) {
			clearTimeout(expectedProjectSyncTimer);
		}
		expectedProjectSyncTimer = setTimeout(() => {
			void detectWorkspaceProjectContext().then(projectContext => {
				controllerTree?.setExpectedProjectContext(projectContext.projectName, projectContext.folderName);
				if (projectContext.projectName) {
					logOutput(`[ProjectContext] expected project (${reason}): ${projectContext.projectName} / ftp folder: ${projectContext.folderName}`);
				}
			});
		}, 150);
	}

	scheduleExpectedProjectSync('startup');

	function getPreferredWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders || folders.length === 0) { return undefined; }

		const activeUri = vscode.window.activeTextEditor?.document?.uri;
		if (activeUri && activeUri.scheme === 'file') {
			const fromActive = vscode.workspace.getWorkspaceFolder(activeUri);
			if (fromActive) { return fromActive; }
		}

		return folders[0];
	}

	/**
	 * .vscode/launch.json에서 첫 brooks-gpl 구성을 읽어 controller 정보를 추출.
	 * launch.json이 없거나 파싱 실패하면 undefined.
	 */
	function readLaunchControllerInfo(): { ip?: string; port?: number; projectName?: string } | undefined {
		const folder = getPreferredWorkspaceFolder();
		if (!folder) { return undefined; }
		const launchPath = path.join(folder.uri.fsPath, '.vscode', 'launch.json');
		if (!fs.existsSync(launchPath)) { return undefined; }
		try {
			const text = fs.readFileSync(launchPath, 'utf8');
			// launch.json은 주석 허용. 간단한 라인/블록 주석 제거 후 JSON.parse.
			const stripped = text
				.replace(/\/\*[\s\S]*?\*\//g, '')
				.replace(/^\s*\/\/.*$/gm, '');
			const parsed = JSON.parse(stripped);
			const configs: any[] = Array.isArray(parsed?.configurations) ? parsed.configurations : [];
			const gplCfg = configs.find(c => c?.type === 'brooks-gpl');
			if (!gplCfg) { return undefined; }
			const rawIp = typeof gplCfg.controllerIp === 'string' ? gplCfg.controllerIp.trim() : '';
			const rawPort = gplCfg.controllerPort;
			const rawProject = typeof gplCfg.projectName === 'string' ? gplCfg.projectName.trim() : '';

			const ip = resolveLaunchVariables(rawIp, folder);
			const projectName = resolveLaunchVariables(rawProject, folder);
			let port: number | undefined;
			if (typeof rawPort === 'number') {
				port = rawPort;
			} else if (typeof rawPort === 'string') {
				const resolvedPort = resolveLaunchVariables(rawPort.trim(), folder);
				const n = Number(resolvedPort);
				if (Number.isFinite(n) && n > 0) { port = n; }
			}
			return {
				ip: ip || undefined,
				port,
				projectName: projectName || undefined,
			};
		} catch {
			return undefined;
		}
	}

	/**
	 * launch.json 값에 포함된 VS Code 변수 placeholder를 해석한다.
	 * 지원: ${config:NAMESPACE.KEY}, ${env:VAR}, ${workspaceFolder}, ${workspaceFolderBasename}.
	 * 해석 실패 또는 빈 결과면 빈 문자열 반환 (자기참조 ${config:gpl.controller.ip} 같은 케이스 안전 처리).
	 */
	function resolveLaunchVariables(value: string, folder: vscode.WorkspaceFolder): string {
		if (!value) { return ''; }
		// placeholder가 없으면 그대로 반환
		if (!value.includes('${')) { return value; }

		const replaced = value.replace(/\$\{([^}]+)\}/g, (_match, expr: string) => {
			const trimmed = expr.trim();
			if (trimmed === 'workspaceFolder') {
				return folder.uri.fsPath;
			}
			if (trimmed === 'workspaceFolderBasename') {
				return path.basename(folder.uri.fsPath);
			}
			if (trimmed.startsWith('config:')) {
				const key = trimmed.slice('config:'.length).trim();
				const v = vscode.workspace.getConfiguration().get<unknown>(key);
				return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
			}
			if (trimmed.startsWith('env:')) {
				const name = trimmed.slice('env:'.length).trim();
				return process.env[name] ?? '';
			}
			// 미지원 placeholder는 빈 문자열 (사이드바에 ${...} 리터럴이 노출되는 것 방지)
			return '';
		});

		// 해석 후에도 ${ 가 남아있으면 부분 실패로 간주 — 호출자가 폴백하도록 빈 문자열
		if (replaced.includes('${')) { return ''; }
		return replaced.trim();
	}

	/**
	 * expected project 이름 결정: launch.json 우선 → Project.gpr 기반 폴백.
	 */
	async function resolveExpectedProjectName(): Promise<string> {
		const fromLaunch = readLaunchControllerInfo()?.projectName;
		if (fromLaunch) { return fromLaunch; }
		return await detectWorkspaceProjectName();
	}

	async function createOrUpdateLaunchJson(): Promise<string | undefined> {
		const folder = getPreferredWorkspaceFolder();
		if (!folder) {
			vscode.window.showWarningMessage('워크스페이스 폴더가 없어 launch.json을 만들 수 없습니다.');
			return undefined;
		}

		const cfg = getControllerConfig();
		const detectedProjectName = await detectWorkspaceProjectName();
		const projectName = detectedProjectName || path.basename(folder.uri.fsPath);
		const vscodeDir = path.join(folder.uri.fsPath, '.vscode');
		const launchPath = path.join(vscodeDir, 'launch.json');

		const attachConfig = {
			name: `GPL: Attach (${projectName})`,
			type: 'brooks-gpl',
			request: 'attach',
			controllerIp: cfg.ip,
			controllerPort: cfg.port,
			projectName,
			deployBeforeAttach: true,
			stopOnEntry: false,
		};

		const stopOnEntryConfig = {
			name: `GPL: Attach (${projectName}) — Stop on Entry`,
			type: 'brooks-gpl',
			request: 'attach',
			controllerIp: cfg.ip,
			controllerPort: cfg.port,
			projectName,
			deployBeforeAttach: true,
			stopOnEntry: true,
		};

		let launchObj: { version: string; configurations: any[] } = {
			version: '0.2.0',
			configurations: [],
		};

		if (fs.existsSync(launchPath)) {
			try {
				const currentText = fs.readFileSync(launchPath, 'utf8');
				const parsed = JSON.parse(currentText);
				launchObj = {
					version: typeof parsed?.version === 'string' ? parsed.version : '0.2.0',
					configurations: Array.isArray(parsed?.configurations) ? parsed.configurations : [],
				};
			} catch (err: any) {
				vscode.window.showErrorMessage(`launch.json 파싱 실패: ${err?.message ?? err}`);
				return undefined;
			}
		}

		const upsert = (nextCfg: any) => {
			const idx = launchObj.configurations.findIndex((c: any) => c?.name === nextCfg.name);
			if (idx >= 0) {
				launchObj.configurations[idx] = nextCfg;
			} else {
				launchObj.configurations.push(nextCfg);
			}
		};

		upsert(attachConfig);
		upsert(stopOnEntryConfig);

		fs.mkdirSync(vscodeDir, { recursive: true });
		fs.writeFileSync(launchPath, `${JSON.stringify(launchObj, null, 4)}\n`, 'utf8');
		return launchPath;
	}

	// 연결 유실 감지 → 상태바 + 알림 갱신
	controllerTree.onDidLoseConnection(() => {
		runtimeConsole?.stop();
		statusBar?.setConnected(false);
		logOutput('[Controller] Connection lost (3 consecutive failures)');
		vscode.window.showWarningMessage('GPL Controller 연결이 끊어졌습니다.');
	});

	// ── Controller commands ──────────────────────────────────

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.connect', async () => {
			const currentCfg = getControllerConfig();
			const launchInfo = readLaunchControllerInfo();
			// 기본값 우선순위: launch.json > 현재 cfg(세션 오버라이드 포함) > settings
			const defaultIp = launchInfo?.ip || currentCfg.ip;
			const inputIp = await vscode.window.showInputBox({
				prompt: launchInfo?.ip
					? `제어기 IP (launch.json 기본값: ${launchInfo.ip})`
					: '제어기 IP 주소를 입력하세요',
				value: defaultIp,
				placeHolder: '192.168.0.1',
				validateInput: (v) => /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v) ? null : '올바른 IP 형식이 아닙니다 (예: 192.168.0.1)',
			});
			if (!inputIp) { return; }

			// IP 변경 시 저장 여부 확인. launch.json IP를 그대로 받아들인 경우는
			// settings에 굳이 쓰지 않고 세션 오버라이드만 적용한다.
			if (inputIp !== currentCfg.ip) {
				const fromLaunch = launchInfo?.ip === inputIp;
				const choices: vscode.QuickPickItem[] = fromLaunch
					? [
						{ label: '이번만 사용', description: 'launch.json 값을 세션 한정으로 사용' },
						{ label: '저장', description: `settings.json에 ${inputIp} 저장` },
					]
					: [
						{ label: '저장', description: `settings.json에 ${inputIp} 저장` },
						{ label: '이번만 사용', description: '이 세션 동안만 적용 (재시작 시 초기화)' },
					];
				const save = await vscode.window.showQuickPick(choices, {
					placeHolder: `IP를 ${inputIp}(으)로 변경합니다`,
				});
				if (!save) { return; }
				if (save.label === '저장') {
					await vscode.workspace.getConfiguration('gpl.controller').update('ip', inputIp, vscode.ConfigurationTarget.Global);
					clearSessionControllerOverride();
				} else {
					setSessionControllerOverride(inputIp, launchInfo?.port);
				}
			} else if (launchInfo?.port && launchInfo.port !== currentCfg.port) {
				// IP는 같지만 launch.json이 다른 port를 지정한 경우 세션 오버라이드 적용
				setSessionControllerOverride(inputIp, launchInfo.port);
			}

			const expected = await resolveExpectedProjectName();
			const projectContext = await detectWorkspaceProjectContext();
			controllerTree?.setExpectedProjectContext(projectContext.projectName || expected, projectContext.folderName || expected);
			const cfg = getControllerConfig();
			logOutput(`[Controller] Connecting to ${cfg.ip}:${cfg.port} …`);
			try {
				const ok = await testConnection(cfg);
				if (ok) {
					vscode.window.showInformationMessage(`GPL Controller 연결 성공: ${cfg.ip}`);
					statusBar?.setConnected(true);
					controllerTree?.setConnected(true);
					// controller 연결 성공 시 1403도 바로 유지 연결한다.
					try { ensureRuntimeConsole(); } catch (err: any) {
						logOutput(`[Console] auto-start on connect failed: ${err?.message ?? err}`);
					}
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
		vscode.window.onDidChangeActiveTextEditor((editor) => {
			if (editor?.document && isGplDocument(editor.document)) {
				scheduleExpectedProjectSync('active GPL document changed');
			}
		}),
		vscode.workspace.onDidChangeWorkspaceFolders(() => {
			scheduleExpectedProjectSync('workspace folders changed');
		}),
		vscode.workspace.onDidSaveTextDocument((doc) => {
			if (isGplDocument(doc)) {
				scheduleExpectedProjectSync('GPL document saved');
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.debug.generateLaunch', async () => {
			const launchPath = await createOrUpdateLaunchJson();
			if (!launchPath) { return; }

			const choice = await vscode.window.showInformationMessage(
				'디버깅 구성을 생성/업데이트했습니다.',
				'파일 열기',
			);
			if (choice === '파일 열기') {
				const doc = await vscode.workspace.openTextDocument(launchPath);
				await vscode.window.showTextDocument(doc, { preview: false });
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.debug.attachNow', async () => {
			// 중복 세션 방지: 이미 brooks-gpl 세션이 살아있으면 사용자에게 처리 방식 선택을 요청
			const existing = (vscode.debug as any).activeDebugSession as vscode.DebugSession | undefined;
			const hasGplSession = existing?.type === 'brooks-gpl';
			if (hasGplSession) {
				const pick = await vscode.window.showWarningMessage(
					'GPL 디버그 세션이 이미 실행 중입니다.',
					{ modal: false },
					'기존 세션 유지',
					'중단하고 다시 시작',
				);
				if (pick === '기존 세션 유지' || pick === undefined) {
					return;
				}
				// 중단하고 다시 시작
				try {
					await vscode.debug.stopDebugging(existing);
					// 세션 정리 시간을 짧게 대기 (DAP terminated 이벤트 처리)
					await new Promise(r => setTimeout(r, 400));
				} catch {
					// 무시: stopDebugging이 실패해도 새 세션 시작은 시도
				}
			}

			const cfg = getControllerConfig();
			const projectName = await resolveExpectedProjectName();
			const launchInfo = readLaunchControllerInfo();

			const dynamicConfig: vscode.DebugConfiguration = {
				type: 'brooks-gpl',
				request: 'attach',
				name: projectName ? `GPL Quick Attach (${projectName})` : 'GPL Quick Attach',
				controllerIp: launchInfo?.ip || cfg.ip,
				controllerPort: launchInfo?.port || cfg.port,
				projectName,
				deployBeforeAttach: true,
				stopOnEntry: false,
			};

			const started = await vscode.debug.startDebugging(undefined, dynamicConfig);
			if (!started) {
				vscode.window.showErrorMessage('디버깅 시작 실패: 구성 또는 제어기 상태를 확인해줘.');
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.disconnect', () => {
			// 싱글톤 인스턴스는 보존하고 연결만 끊는다 (v0.5.48 일관성).
			runtimeConsole?.stop();
			clearSessionControllerOverride();
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
		logOutput(`[Deploy] Starting ${mode}: ${projectDir} → ${cfg.ip}`);
		outputChannel.show(true);

		let deployRuntimeConsole: RuntimeConsole | undefined;
		if (!skipStart) {
			try {
				deployRuntimeConsole = ensureRuntimeConsole();
				await deployRuntimeConsole.waitUntilReady(800);
				logOutput('[Deploy] Runtime console primed before Start');
			} catch (err: any) {
				logOutput(`[Console] pre-start failed: ${err?.message ?? err}`);
			}
		}

		try {
			const result = await deploy({ projectDir, skipStart }, outputChannel, deployDiagnostics);
			if (result.success) {
				const deployedFolderName = path.basename(projectDir).trim();
				controllerTree?.setExpectedProjectContext(result.projectName, deployedFolderName);
				await controllerTree?.refreshAll();
				if (skipStart) {
					// Build Only 성공 후에도 1403 콘솔을 즉시 유지 연결한다.
					// 디버그 Attach/F5 직전 콘솔 준비를 보장하여 "1403 미연결" 체감 이슈를 줄인다.
					try {
						deployRuntimeConsole = ensureRuntimeConsole();
						await deployRuntimeConsole.waitUntilReady(800);
						logOutput('[Deploy] Runtime console auto-start after Build Only');
					} catch (err: any) {
						logOutput(`[Console] build-only auto-start failed: ${err?.message ?? err}`);
					}
					vscode.window.showInformationMessage(`빌드 완료: ${result.projectName} (FTP/컨텍스트 갱신 완료, Start 미실행)`);
				} else {
					const firstError = result.errorLog.length > 0
						? classifyDeployErrorLog(result.errorLog[0])
						: undefined;
					if (result.errorLog.length > 0) {
						for (const entry of result.errorLog) {
							const classified = classifyDeployErrorLog(entry);
							if (classified.isControllerError) {
								logOutput(`[Deploy][ErrorLog] ${classified.summary}`);
								if (classified.detail) {
									logOutput(`[Deploy][ErrorLog] ${classified.detail}`);
								}
							}
						}
					}
					if (result.errorLog.length > 0) {
						outputChannel.show(true);
						const warningText = firstError?.isControllerError
							? `배포 완료. controller ErrorLog ${result.errorLog.length}건 감지: ${firstError.summary}`
							: `배포 완료. ErrorLog ${result.errorLog.length}건 감지: ${firstError?.summary ?? ''}`;
						const action = await vscode.window.showWarningMessage(
							warningText,
							'출력 보기',
							'콘솔 보기',
						);
						if (action === '콘솔 보기') {
							if (!deployRuntimeConsole) {
								deployRuntimeConsole = ensureRuntimeConsole();
								await deployRuntimeConsole.waitUntilReady(800);
							}
							consoleChannel.show(true);
						} else {
							outputChannel.show(true);
						}
					} else {
						vscode.window.showInformationMessage(`배포 완료: ${result.projectName}`);
						if (!deployRuntimeConsole && autoStartConsoleOnDeploy) {
							deployRuntimeConsole = ensureRuntimeConsole();
							await deployRuntimeConsole.waitUntilReady(800);
						}
						consoleChannel.show(true);
					}
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
		vscode.commands.registerCommand('gpl.console.start', async () => {
			const console = ensureRuntimeConsole();
			await console.waitUntilReady();
			const hasPayload = await console.waitForPayload(1500);
			consoleChannel.show(true);
			if (hasPayload) {
				vscode.window.showInformationMessage('GPL 런타임 콘솔 시작 (payload 수신 확인)');
			} else {
				vscode.window.showWarningMessage('GPL 런타임 콘솔 소켓은 연결됐지만 payload는 아직 없어. Idle 또는 1403 불안정 가능');
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.console.stop', () => {
			runtimeConsole?.stop();
			vscode.window.showInformationMessage('GPL 런타임 콘솔 중지');
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.logs.liveTerminal.start', async () => {
			startLiveLogTerminal();
			try {
				const console = ensureRuntimeConsole();
				await console.waitUntilReady();
				const hasPayload = await console.waitForPayload(1500);
				if (!hasPayload) {
					logOutput('[Console] live log start: socket connected but no payload yet');
				}
			} catch (err: any) {
				logOutput(`[Console] live log start -> runtime console start failed: ${err?.message ?? err}`);
			}
			logOutput('Live log terminal started');
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
			runtimeConsole?.stop();
			logOutput('Live log terminal stopped');
			stopLiveLogTerminal();
			vscode.window.showInformationMessage('GPL Live Logs 터미널 중지 (1403 런타임 콘솔도 정리됨)');
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.threads.refresh', () => {
			controllerTree?.refreshAll();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.copySituationForChat', async () => {
			if (!controllerTree) { return; }
			await controllerTree.refreshAll();
			const expected = controllerTree.getExpectedProjectName();
			const header = [
				'다음은 GPL Controller 현재 상태입니다. 실행 프로젝트/FTP 프로젝트 불일치 여부를 우선 분석해 주세요.',
				expected ? `기대 프로젝트: ${expected}` : '기대 프로젝트: (미설정)',
				'',
			].join('\n');
			const body = controllerTree.buildSituationSnapshotMarkdown({
				runtimeConsoleConnected: runtimeConsole?.isConnected ?? false,
			});
			const text = `${header}${body}`;

			await vscode.env.clipboard.writeText(text);
			const doc = await vscode.workspace.openTextDocument({
				content: text,
				language: 'markdown',
			});
			await vscode.window.showTextDocument(doc, { preview: false });
			vscode.window.showInformationMessage('AI 공유용 상태 스냅샷을 복사했고, 문서도 열었습니다.');
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
				// 콘솔 포트: 런타임 콘솔 열기(항상 시작/재사용)
				// ⚠ 사용자가 "1403 포트 클릭"을 상태 확인으로 인식하는 경우가 많아
				//   토글 동작은 의도치 않은 중지를 유발한다.
				const console = ensureRuntimeConsole();
				await console.waitUntilReady(800);
				const hasPayload = await console.waitForPayload(1500);
				consoleChannel.show(true);
				if (runtimeConsole?.isConnected && hasPayload) {
					vscode.window.showInformationMessage(`${label} (${ip}:${port}) — payload 수신 확인 (GPL Console 확인)`);
				} else if (runtimeConsole?.isConnected) {
					vscode.window.showWarningMessage(`${label} (${ip}:${port}) — 소켓은 연결됐지만 payload는 아직 없어. Idle 또는 1403 불안정 가능`);
				} else {
					vscode.window.showInformationMessage(`${label} (${ip}:${port}) — 런타임 콘솔 연결 시도 중...`);
				}
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
				const stopResp = await sendCommandWithBusyRetry('Stop -all', undefined, { maxAttempts: 5, baseDelayMs: 500 });
				const status = parseStatus(stopResp);
				if (status.code !== 0 && !isBusyStatus(status.code)) {
					vscode.window.showErrorMessage(`전체 정지 실패: STATUS ${status.code} ${status.message}`);
					return;
				}

				const stopped = await verifyAllStopped(8);
				if (stopped) {
					vscode.window.showWarningMessage('전체 정지 완료 (Stop -all)');
				} else {
					const recovered = await trySoftEStopRecovery();
					if (!recovered) {
						vscode.window.showWarningMessage('Stop -all 전송됨. 제어기 바쁨/재시작으로 정지 확인이 지연되고 있습니다. 상태를 다시 확인해줘.');
					}
				}
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

	// 에러 항목 복사
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.copyError', async (text: string) => {
			if (!text) { return; }
			await vscode.env.clipboard.writeText(text);
			vscode.window.showInformationMessage('에러 텍스트가 클립보드에 복사되었습니다.');
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
				const threadName = node.thread.name;
				const stopResp = await sendCommandWithBusyRetry(`Stop ${threadName}`, undefined, { maxAttempts: 5, baseDelayMs: 400 });
				const status = parseStatus(stopResp);
				if (status.code !== 0 && !isBusyStatus(status.code)) {
					vscode.window.showErrorMessage(`쓰레드 정지 실패: STATUS ${status.code} ${status.message}`);
					return;
				}

				const stopped = await verifyThreadStopped(threadName, 7);
				if (!stopped) {
					const recovered = await trySoftEStopRecovery(threadName);
					if (!recovered) {
						vscode.window.showWarningMessage(`${threadName} 정지 명령은 전송됐지만 아직 실행 중일 수 있습니다. 잠시 후 다시 확인해줘.`);
					}
				} else {
					vscode.window.showInformationMessage(`${threadName} 정지 완료`);
				}
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
			const name: string | undefined = node?.projectName || node?.label;
			const remotePath: string | undefined = node?.remotePath;
			if (!name || !remotePath) { return; }

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
			const host = cfg.ip;

			await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: `${name} 다운로드 중...`, cancellable: false },
				async (progress) => {
					try {
						const result = await downloadProject(host, remotePath, localDir, (cur, total, file) => {
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
			const name: string | undefined = node?.projectName || node?.label;
			const ctx: string | undefined = node?.contextValue;
			const remotePath: string | undefined = node?.remotePath;
			if (!name || !ctx || !remotePath) { return; }

			const isDir = ctx === 'ftpFolder' || ctx === 'ftpFlashFolder';
			const confirm = await vscode.window.showWarningMessage(
				`${isDir ? '폴더' : '파일'} "${name}"을(를) 제어기에서 삭제하시겠습니까?`,
				{ modal: true }, '삭제'
			);
			if (confirm !== '삭제') { return; }

			const cfg = getControllerConfig();
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
			const name: string | undefined = node?.projectName || node?.label;
			const loadPath: string | undefined = node?.remotePath;
			if (!name || !loadPath) { return; }

			const cfg = getControllerConfig();

			outputChannel.show(true);
			logOutput('');
			logOutput(`━━ [FTP Run v${extVersion}] ${name} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
			logOutput(`│ Note: FTP Run uses the uploaded controller copy at ${loadPath}`);
			logOutput(`│       Local edits are NOT uploaded here. Use GPL: Deploy (Build Only) to verify latest local code.`);

			const runStatusCommand = async (command: string) => {
				const raw = await sendCommand(command);
				const status = parseStatus(raw);
				return { raw, status };
			};

			const tryCompile = async () => {
				const raw = await sendCommand(`Compile ${name}`);
				const status = parseStatus(raw);
				const errors = parseCompileErrors(raw);
				return { raw, status, errors, ok: status.code === 0 && errors.length === 0 };
			};

			const ensureStoppedBeforeCompile = async (): Promise<boolean> => {
				logOutput('│ Phase: Stop before Compile');
				logOutput('│ Stop -all');
				const stopResp = await sendCommandWithBusyRetry('Stop -all', undefined, { maxAttempts: 5, baseDelayMs: 500 });
				const stopStatus = parseStatus(stopResp);
				if (stopStatus.code !== 0 && !isBusyStatus(stopStatus.code)) {
					throw new Error(`Stop -all failed: STATUS ${stopStatus.code} ${stopStatus.message || ''}`.trimEnd());
				}

				const stopped = await verifyAllStopped(8);
				if (stopped) {
					logOutput('│ ✔ Stop complete');
					return true;
				}

				logOutput('│ ⚠ Stop sent, but thread stop confirmation is delayed');
				return false;
			};

			const ensureLoadedFromFtp = async (): Promise<boolean> => {
				logOutput(`│ Load ${loadPath}`);
				const { status } = await runStatusCommand(`Load ${loadPath}`);
				if (status.code === 0) {
					logOutput(`│ ✔ Load success`);
					return true;
				}
				if (status.code === -745) {
					logOutput(`│ ✔ Load skipped (already loaded)`);
					return true;
				}
				logOutput(`│ ✘ Load failed: STATUS ${status.code} ${status.message || ''}`.trimEnd());
				return false;
			};

			try {
				await ensureStoppedBeforeCompile();

				// 1) Compile 시도
				logOutput('│ Phase: Compile uploaded controller copy');
				logOutput(`│ Compile ${name}`);
				let compile = await tryCompile();
				if (!compile.ok) {
					const statusCode = compile.status.code;
					if (statusCode === -746) {
						logOutput('│ ⚠ STATUS -746 Interlocked for read');
						logOutput('│ ⚠ Retry path: Stop → wait → Compile');
						await ensureStoppedBeforeCompile();
						await sleep(500);
						compile = await tryCompile();
						if (!compile.ok) {
							throw new Error(`Compile failed after retry: STATUS ${compile.status.code} ${compile.status.message || ''}`.trimEnd());
						}
						logOutput('│ ✔ Compile success (after interlock retry)');
					} else if (statusCode === -745) {
						logOutput(`│ ⚠ Already loaded → Unload → Load → Compile`);
						const { status: unloadStatus } = await runStatusCommand(`Unload ${name}`);
						if (unloadStatus.code === 0) {
							logOutput(`│ ✔ Unload success`);
						} else if (unloadStatus.code === -508 || unloadStatus.code === -743) {
							logOutput(`│ ✔ Unload skipped (project not loaded)`);
						} else {
							throw new Error(`Unload failed: STATUS ${unloadStatus.code} ${unloadStatus.message || ''}`.trimEnd());
						}
						const loaded = await ensureLoadedFromFtp();
						if (!loaded) {
							throw new Error(`Load failed: ${loadPath}`);
						}
						compile = await tryCompile();
						if (!compile.ok) {
							throw new Error(`Compile failed: STATUS ${compile.status.code} ${compile.status.message || ''}`.trimEnd());
						}
						logOutput(`│ ✔ Compile success (after reload)`);
					} else if (statusCode === -508 || statusCode === -743) {
						logOutput(`│ ⚠ Not loaded → Load → Compile`);
						const loaded = await ensureLoadedFromFtp();
						if (!loaded) {
							throw new Error(`Load failed: ${loadPath}`);
						}
						compile = await tryCompile();
						if (!compile.ok) {
							throw new Error(`Compile failed: STATUS ${compile.status.code} ${compile.status.message || ''}`.trimEnd());
						}
						logOutput(`│ ✔ Compile success (after load)`);
					} else {
						const compileError = compile.errors[0];
						if (compileError) {
							throw new Error(`Compile failed: ${compileError.file}:${compileError.line} (${compileError.code}) ${compileError.message}`);
						}
						throw new Error(`Compile failed: STATUS ${compile.status.code} ${compile.status.message || ''}`.trimEnd());
					}
				} else {
					logOutput(`│ ✔ Compile success`);
				}

				// 2) 콘솔 자동 시작 (아직 꺼져 있으면)
				ensureRuntimeConsole();
				consoleChannel.show(true);

				// 3) Start
				logOutput(`│ Start ${name}`);
				const { status: startStatus } = await runStatusCommand(`Start ${name}`);
				if (startStatus.code !== 0) {
					throw new Error(`Start failed: STATUS ${startStatus.code} ${startStatus.message || ''}`.trimEnd());
				}
				logOutput(`│ ✔ Start success`);
				vscode.window.showInformationMessage(`${name} 업로드된 제어기 복사본 기준 컴파일 & 실행 완료`);
				controllerTree?.refresh();
			} catch (err: any) {
				logOutput(`│ ✘ 실패: ${err.message ?? err}`);
				vscode.window.showErrorMessage(`${name} 실행 실패: ${err.message ?? err}`);
			}
		})
	);

	// FTP 폴더 중지
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.ftpStop', async (node: any) => {
			const name: string | undefined = node?.projectName || node?.label;
			if (!name) { return; }

			try {
				const stopResp = await sendCommandWithBusyRetry(`Stop ${name}`, undefined, { maxAttempts: 5, baseDelayMs: 400 });
				const status = parseStatus(stopResp);
				if (status.code !== 0 && !isBusyStatus(status.code)) {
					vscode.window.showErrorMessage(`${name} 중지 실패: STATUS ${status.code} ${status.message}`);
					return;
				}

				const stopped = await verifyThreadStopped(name, 7);
				if (!stopped) {
					const recovered = await trySoftEStopRecovery(name);
					if (!recovered) {
						vscode.window.showWarningMessage(`${name} 정지 명령은 전송됐지만 아직 실행 중일 수 있습니다. 잠시 후 다시 확인해줘.`);
					}
				} else {
					vscode.window.showInformationMessage(`${name} 중지 완료`);
				}
				controllerTree?.refresh();
			} catch (err: any) {
				vscode.window.showErrorMessage(`${name} 중지 실패: ${err.message ?? err}`);
			}
		})
	);

	// FTP 폴더 Unload (메모리 해제)
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.ftpUnload', async (node: any) => {
			const name: string | undefined = node?.projectName || node?.label;
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
				const projectFromDebugConfig = (session.configuration?.projectName || '').toString().trim();
				if (projectFromDebugConfig) {
					controllerTree?.setExpectedProjectName(projectFromDebugConfig);
					logOutput(`[ProjectContext] expected project (debug config): ${projectFromDebugConfig}`);
				} else {
					scheduleExpectedProjectSync('debug session started');
				}
				controllerTree?.stopPolling();
				if (autoStartConsoleOnDebug) {
					// 디버그 attach 시 1403 런타임 콘솔 자동 시작 (start()는 idempotent).
					try { ensureRuntimeConsole(); } catch (err: any) {
						logOutput(`[Console] auto-start on debug failed: ${err?.message ?? err}`);
					}
				}
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

	// Initialize symbol cache lazily only when GPL context exists.
	if (hasOpenGplContext()) {
		setTimeout(() => {
			void ensureSymbolCacheInitialized('open GPL documents detected');
		}, 300);
	}
	
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
	stopLiveLogTerminal();

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
