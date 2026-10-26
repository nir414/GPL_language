/** FTP 원격 소스 보기와 현재 창의 비배포 Attach. 작업공간은 변경하지 않는다. */
import * as vscode from 'vscode';
import * as path from 'path';
import { getControllerConfig } from '../controller/connection/controllerConnection';
import { listRemoteDir, normalizeAbsoluteRemoteDir } from '../controller/files/ftpClient';
import { checkProjectName, describeProjectNameProblem } from '../controller/projects/projectNameGuard';
import { controllerDebugConfiguration } from '../project/controllerProjectDebug';
import { ControllerRemoteFiles } from './controllerRemoteFiles';
import { activateControllerSourceLanguage } from './controllerSourceLanguage';
import type { ExtensionHost } from './host';

interface RemoteResource { remotePath: string; controllerHost?: string; }

export function activateControllerProjectDebug(host: ExtensionHost): void {
	const { context } = host;
	const files = new ControllerRemoteFiles(context);
	activateControllerSourceLanguage(host);
	let opening = false;
	const previousTargets = new Map<string, string | undefined>();
	context.subscriptions.push(vscode.debug.onDidTerminateDebugSession(debug => {
		const id = debug.configuration.remoteSourceSessionId;
		if (debug.type !== 'brooks-gpl' || !previousTargets.has(id)) { return; }
		const previous = previousTargets.get(id);
		previousTargets.delete(id);
		if (host.sessionTargetDir === debug.configuration.projectDir) {
			host.sessionTargetDir = previous;
			host.project.scheduleExpectedProjectSync('remote debug session ended');
		}
	}));
	const reportError = (error: unknown): void => {
		const message = error instanceof Error ? error.message : String(error);
		host.log(`[Controller Project] ${message}`);
		void vscode.window.showErrorMessage(`제어기 파일: ${message}`);
	};
	const targetOf = (resource: RemoteResource, fresh = false) => {
		const cfg = getControllerConfig();
		const remote = resource.remotePath.replace(/\\/g, '/');
		if (remote.split('/').some(part => part === '..' || /[\r\n\0]/.test(part))) { throw new Error('안전하지 않은 제어기 경로입니다.'); }
		if (fresh && resource.controllerHost && resource.controllerHost !== cfg.ip) {
			throw new Error('제어기 설정이 바뀌었습니다. FTP 목록을 새로고침한 뒤 프로젝트를 선택하세요.');
		}
		const remotePath = normalizeAbsoluteRemoteDir(remote);
		const root = [cfg.ftpBasePath, cfg.ftpFlashProjectsPath].map(normalizeAbsoluteRemoteDir)
			.sort((a, b) => b.length - a.length).find(base => remotePath === base || remotePath.startsWith(`${base}/`));
		if (!root) { throw new Error(`프로젝트 저장 영역 밖의 경로입니다: ${remotePath}`); }
		return { cfg, remotePath, session: files.getSession(resource.controllerHost ?? cfg.ip, root, fresh) };
	};
	async function pickRemoteProject(resource?: RemoteResource): Promise<RemoteResource | undefined> {
		if (typeof resource?.remotePath === 'string') { return resource; }
		const cfg = getControllerConfig();
		const choices: Array<vscode.QuickPickItem & RemoteResource> = [];
		for (const root of [...new Set([cfg.ftpBasePath, cfg.ftpFlashProjectsPath])]) {
			try {
				for (const entry of await listRemoteDir(cfg.ip, root)) {
					if (entry.isDirectory && entry.name !== '.' && entry.name !== '..') {
						choices.push({ label: entry.name, description: path.posix.join(root, entry.name),
							remotePath: path.posix.join(root, entry.name), controllerHost: cfg.ip });
					}
				}
			} catch (error) { host.log(`[Controller Project] ${root} 목록 조회 실패: ${String(error)}`); }
		}
		if (!choices.length) { throw new Error('FTP 프로젝트 목록을 가져오지 못했습니다. 제어기 주소와 FTP 연결을 확인하세요.'); }
		return vscode.window.showQuickPick(choices, { title: '제어기 프로젝트 디버깅', placeHolder: `${cfg.ip}의 프로젝트를 선택하세요` });
	}
	context.subscriptions.push(vscode.commands.registerCommand('gpl.controller.browseRemoteFiles', async () => {
		try {
			await host.controllerTree?.browseFtp();
			await vscode.commands.executeCommand('gplThreads.focus');
		} catch (error) { reportError(error); }
	}));

	context.subscriptions.push(vscode.commands.registerCommand('gpl.controller.openRemoteFile', async (resource?: RemoteResource) => {
		if (!resource?.remotePath) { return; }
		let pin: vscode.Disposable | undefined;
		try {
			const { session, remotePath } = targetOf(resource);
			pin = files.retain(session);
			await vscode.window.showTextDocument(vscode.Uri.parse(session.uri(remotePath)), { preview: true });
		} catch (error) { reportError(error); } finally { pin?.dispose(); }
	}));
	context.subscriptions.push(vscode.commands.registerCommand('gpl.controller.refreshRemoteFile', async (resource?: vscode.Uri) => {
		const uri = resource ?? vscode.window.activeTextEditor?.document.uri;
		if (!uri) { return; }
		try { await files.refresh(uri); } catch (error) { reportError(error); }
	}));
	context.subscriptions.push(vscode.commands.registerCommand('gpl.controller.openProjectForDebugging', async (resource?: RemoteResource) => {
		if (opening) { return; }
		opening = true;
		let pin: vscode.Disposable | undefined;
		try {
			if (!vscode.workspace.isTrusted) { throw new Error('현재 작업공간을 신뢰한 뒤 디버깅을 실행하세요.'); }
			if (host.gplDebugSession || vscode.debug.activeDebugSession?.type === 'brooks-gpl') {
				throw new Error('기존 GPL 디버그 세션을 분리(Disconnect)한 뒤 다시 실행하세요.');
			}
			const selected = await pickRemoteProject(resource);
			if (!selected) { return; }
			const { session, remotePath, cfg } = targetOf(selected, true);
			pin = files.retain(session);
			const candidates = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification,
				title: '제어기 프로젝트 확인 중', cancellable: false }, () => session.findProjects(remotePath));
			if (!candidates.length) { throw new Error(`${remotePath}에 GPL 프로젝트(.gpr)가 없습니다.`); }
			const project = candidates.length === 1 ? candidates[0] : await vscode.window.showQuickPick(
				candidates.map(candidate => ({ ...candidate, label: candidate.projectName, description: candidate.remotePath })),
				{ title: '디버깅할 하위 프로젝트 선택' });
			if (!project) { return; }
			const prepared = await session.prepareProject(project.gprPath);
			const checked = checkProjectName(prepared.projectName);
			if (!checked.ok) { throw new Error(describeProjectNameProblem(prepared.projectName, 'project', checked)); }
			const connected = await host.connection.connectControllerWithArgs({ ip: session.host, port: cfg.port, save: 'session', silent: true, preserveBreakpoints: true });
			if (!connected.ok) { throw new Error(`명령 콘솔 연결 실패: ${connected.error ?? session.host}`); }
			const config = { ...controllerDebugConfiguration({ host: session.host, port: cfg.port, consolePort: cfg.consolePort,
				projectName: prepared.projectName, projectDir: prepared.projectDir, remotePath: prepared.remotePath }),
				remoteSourceSessionId: session.id };
			previousTargets.set(session.id, host.sessionTargetDir);
			if (!await vscode.debug.startDebugging(undefined, config)) {
				previousTargets.delete(session.id);
				throw new Error('Attach를 시작하지 못했습니다. FTP 프로젝트에서 다시 실행하세요.');
			}
			const entry = prepared.sourcePaths[0] ? session.resolveSource(prepared.sourcePaths[0]) : undefined;
			if (entry) { await vscode.window.showTextDocument(vscode.Uri.parse(entry.uri), { preview: false }); }
			host.log(`[Controller Project] 원격 Attach ${session.host}:${cfg.port} ${prepared.projectName} (${prepared.remotePath})`);
			if (prepared.unresolvedLibraries.length) {
				void vscode.window.showWarningMessage(`받지 못한 ProjectLibrary: ${prepared.unresolvedLibraries.join(', ')}`);
			}
		} catch (error) { reportError(error); } finally { pin?.dispose(); opening = false; }
	}));
}
