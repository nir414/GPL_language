/** FTP 프로젝트 선택 → 전용 작업공간 → 창 전환 후 일회성 Attach. */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getControllerConfig } from '../controller/connection/controllerConnection';
import { listRemoteDir, normalizeAbsoluteRemoteDir } from '../controller/files/ftpClient';
import { downloadControllerLibraries, downloadControllerProjectCopy } from '../controller/files/controllerProjectDownload';
import { checkProjectName, describeProjectNameProblem } from '../controller/projects/projectNameGuard';
import { parseGprText } from '../project/gprSync';
import { gprPathInDir, resolveGprSourcePaths, walkTree } from '../project/projectSources';
import { writeControllerProjectManifest } from '../project/controllerProjectWorkspace';
import {
    CONTROLLER_DEBUG_MARKER, PENDING_CONTROLLER_DEBUG_KEY, PendingControllerDebug,
    canResumeControllerDebug, controllerDebugConfiguration,
} from '../project/controllerProjectDebug';
import { normalizePathKey } from '../util/pathKey';
import { ciEq } from '../language/identifiers';
import type { ExtensionHost } from './host';

interface RemoteProject { remotePath: string; }

export function activateControllerProjectDebug(host: ExtensionHost): void {
    const { context } = host;
    let opening = false;
    let resuming = false;

    async function attach(pending: PendingControllerDebug): Promise<void> {
        const target = pending.target;
        if (!fs.existsSync(target.projectDir)) { throw new Error(`소스 폴더가 없습니다: ${target.projectDir}`); }
        host.sessionTargetDir = target.projectDir;
        const gpr = gprPathInDir(target.projectDir);
        if (gpr) {
            const text = fs.readFileSync(gpr, 'utf8');
            const start = parseGprText(text).projectStart;
            const sources = resolveGprSourcePaths(gpr, text).filter(file => fs.existsSync(file));
            const entry = sources.find(file => start && ciEq(path.basename(file, path.extname(file)), start)) ?? sources[0];
            if (entry) { await vscode.window.showTextDocument(vscode.Uri.file(entry), { preview: false }); }
        }
        // 접속 이벤트가 DAP보다 먼저 실행돼 기존 BP를 지우지 않도록 작업공간에서 먼저 끈다.
        const controllerConfig = vscode.workspace.getConfiguration('gpl.controller');
        if (controllerConfig.get<boolean>('syncEditorBreakpoints') === true) {
            await controllerConfig.update('syncEditorBreakpoints', false, vscode.ConfigurationTarget.Workspace);
        }
        const connected = await host.connection.connectControllerWithArgs({
            ip: target.host, port: target.port, save: 'session', silent: true,
        });
        if (!connected.ok) { throw new Error(`명령 콘솔 연결 실패: ${connected.error ?? target.host}`); }
        const config = controllerDebugConfiguration(target);
        const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(target.projectDir));
        if (!await vscode.debug.startDebugging(folder, config)) {
            throw new Error('Attach를 시작하지 못했습니다. 이 작업공간에서 F5로 다시 시도할 수 있습니다.');
        }
        host.log(`[Controller Project] Attach ${target.host}:${target.port} ${target.projectName} (${target.remotePath}) → ${target.projectDir}`);
        void vscode.window.showInformationMessage(
            `${target.projectName}: 제어기 소스로 디버깅을 시작했습니다. 업로드·컴파일·자동 실행은 하지 않았습니다. `
            + 'FTP 소스와 현재 실행 코드의 일치 여부는 확인되지 않았습니다.',
        );
        if (pending.unresolvedLibraries.length > 0) {
            void vscode.window.showWarningMessage(`받지 못한 ProjectLibrary: ${pending.unresolvedLibraries.join(', ')} — 해당 라이브러리 소스 위치를 표시하지 못할 수 있습니다.`);
        }
    }

    async function resume(): Promise<void> {
        if (resuming || !vscode.workspace.isTrusted) { return; }
        const current = vscode.workspace.workspaceFile?.fsPath;
        const pending = context.globalState.get<PendingControllerDebug>(PENDING_CONTROLLER_DEBUG_KEY);
        if (!current || !pending || normalizePathKey(current) !== normalizePathKey(pending.workspaceFile)) { return; }
        resuming = true;
        try {
            // 먼저 소비한다. 실패·창 재열기 때 사용자 요청 없이 다시 연결하지 않는다.
            await context.globalState.update(PENDING_CONTROLLER_DEBUG_KEY, undefined);
            if (!canResumeControllerDebug(pending, current)) {
                void vscode.window.showInformationMessage('제어기 프로젝트가 열렸습니다. F5로 디버깅을 시작하세요.');
                return;
            }
            await attach(pending);
        } finally { resuming = false; }
    }

    const reportError = (err: unknown): void => {
        const message = err instanceof Error ? err.message : String(err);
        host.log(`[Controller Project] ${message}`);
        void vscode.window.showErrorMessage(`제어기 프로젝트 디버깅: ${message}`);
    };

    async function pickRemoteProject(resource: unknown): Promise<RemoteProject | undefined> {
        const node = resource as Partial<RemoteProject> | undefined;
        if (typeof node?.remotePath === 'string') { return { remotePath: node.remotePath }; }
        const cfg = getControllerConfig();
        const choices: Array<vscode.QuickPickItem & RemoteProject> = [];
        for (const root of [...new Set([cfg.ftpBasePath, cfg.ftpFlashProjectsPath])]) {
            try {
                for (const entry of await listRemoteDir(cfg.ip, root)) {
                    if (entry.isDirectory && entry.name !== '.' && entry.name !== '..') {
                        const remotePath = path.posix.join(root, entry.name);
                        choices.push({ label: entry.name, description: remotePath, remotePath });
                    }
                }
            } catch (err) {
                // 한 저장 영역만 존재하는 제어기도 있다. 조회 실패는 Output에 남긴다.
                host.log(`[Controller Project] ${root} 목록 조회 실패: ${String(err)}`);
            }
        }
        if (choices.length === 0) { throw new Error('FTP 프로젝트 목록을 가져오지 못했습니다. 제어기 주소와 FTP 연결을 확인하세요.'); }
        return vscode.window.showQuickPick(choices, { title: '제어기 프로젝트 열어 디버깅', placeHolder: `${cfg.ip}에서 열 프로젝트를 선택하세요` });
    }

    async function open(resource: unknown): Promise<void> {
        if (!vscode.workspace.isTrusted) {
            throw new Error('작업공간을 신뢰한 뒤 다시 실행하세요.');
        }
        if (host.gplDebugSession || vscode.debug.activeDebugSession?.type === 'brooks-gpl') {
            throw new Error('기존 GPL 디버그 세션을 분리(Disconnect)한 뒤 다시 실행하세요.');
        }
        const remote = await pickRemoteProject(resource);
        if (!remote) { return; }
        const cfg = getControllerConfig();
        const remotePath = path.posix.normalize(normalizeAbsoluteRemoteDir(remote.remotePath.replace(/\\/g, '/')));
        const remoteRoot = [cfg.ftpBasePath, cfg.ftpFlashProjectsPath]
            .map(normalizeAbsoluteRemoteDir).sort((a, b) => b.length - a.length)
            .find(root => remotePath.startsWith(`${root}/`));
        if (!remoteRoot) { throw new Error(`프로젝트 저장 영역 밖의 경로입니다: ${remotePath}`); }

        const storage = path.join(context.globalStorageUri.fsPath, 'controller-projects');
        fs.mkdirSync(storage, { recursive: true });
        const sessionDir = fs.mkdtempSync(path.join(storage, 'debug-'));
        host.log(`[Controller Project] 다운로드 세션: ${sessionDir}`);
        const sourceRoot = path.join(sessionDir, 'sources');
        const relative = path.posix.relative(remoteRoot, remotePath);
        const projectDir = path.join(sourceRoot, ...relative.split('/'));
        // 중첩 프로젝트도 같은 원격 최상위 폴더의 상대 배치를 보존한다.
        const branch = relative.split('/')[0];
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification, title: '제어기 프로젝트 가져오는 중', cancellable: false,
        }, async progress => {
            await downloadControllerProjectCopy(cfg.ip, path.posix.join(remoteRoot, branch), path.join(sourceRoot, branch), message => progress.report({ message }));
        });

        let gpr = gprPathInDir(projectDir);
        if (!gpr) {
            const choices: Array<vscode.QuickPickItem & { gpr: string }> = [];
            walkTree(projectDir, (full, name) => {
                if (!/\.gpr$/i.test(name)) { return; }
                const info = parseGprText(fs.readFileSync(full, 'utf8'));
                choices.push({ label: info.projectName || path.basename(path.dirname(full)), description: path.relative(sourceRoot, full), gpr: full });
            });
            if (choices.length === 0) { throw new Error(`${remotePath}에 GPL 프로젝트(.gpr)가 없습니다. 받은 파일은 ${sessionDir}에 보존했습니다.`); }
            gpr = choices.length === 1 ? choices[0].gpr
                : (await vscode.window.showQuickPick(choices, { title: '디버깅할 하위 프로젝트 선택' }))?.gpr;
            if (!gpr) { return; }
        }
        const parsed = parseGprText(fs.readFileSync(gpr, 'utf8'));
        const projectName = parsed.projectName || path.basename(path.dirname(gpr));
        const nameCheck = checkProjectName(projectName);
        if (!nameCheck.ok) { throw new Error(describeProjectNameProblem(projectName, 'project', nameCheck)); }
        const unresolvedLibraries = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification, title: `${projectName} 라이브러리 확인 중`, cancellable: false,
        }, progress => downloadControllerLibraries(cfg.ip, remoteRoot, sourceRoot, gpr!, message => progress.report({ message })));

        const target = {
            host: cfg.ip, port: cfg.port, consolePort: cfg.consolePort,
            remotePath: path.posix.join(remoteRoot, path.relative(sourceRoot, path.dirname(gpr)).split(path.sep).join('/')),
            projectName, projectDir: path.dirname(gpr),
        };
        writeControllerProjectManifest(sourceRoot, {
            mode: 'snapshot', controllerHost: cfg.ip, sourceRemotePath: remoteRoot,
            projectName, downloadedAt: new Date().toISOString(),
        });
        const workspaceFile = path.join(sessionDir, 'controller.code-workspace');
        fs.writeFileSync(workspaceFile, `${JSON.stringify({
            folders: [{ path: 'sources', name: `${projectName} @ ${cfg.ip}` }],
            settings: {
                'gpl.controller.ip': cfg.ip, 'gpl.controller.port': cfg.port,
                'gpl.controller.consolePort': cfg.consolePort,
                'gpl.controller.syncEditorBreakpoints': false,
            },
        }, null, 2)}\n`, 'utf8');
        fs.mkdirSync(path.join(sourceRoot, '.vscode'), { recursive: true });
        fs.writeFileSync(path.join(sourceRoot, '.vscode', 'launch.json'), `${JSON.stringify({
            version: '0.2.0', configurations: [controllerDebugConfiguration(target)],
        }, null, 2)}\n`, 'utf8');
        fs.writeFileSync(path.join(sourceRoot, CONTROLLER_DEBUG_MARKER), `${JSON.stringify(target, null, 2)}\n`, 'utf8');
        const pending: PendingControllerDebug = { workspaceFile, requestedAt: Date.now(), target, unresolvedLibraries };
        await context.globalState.update(PENDING_CONTROLLER_DEBUG_KEY, pending);
        host.log(`[Controller Project] 소스 작업공간: ${workspaceFile}`);
        // 같은 창에서 전환해 이전 창의 명령 연결과 경쟁하지 않는다. 취소해도 소스와 F5 구성은 남는다.
        try {
            await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(workspaceFile), false);
        } catch (err) {
            await context.globalState.update(PENDING_CONTROLLER_DEBUG_KEY, undefined);
            throw err;
        }
    }

    context.subscriptions.push(vscode.commands.registerCommand('gpl.controller.openProjectForDebugging', async (resource?: unknown) => {
        if (opening) { return; }
        opening = true;
        try { await open(resource); } catch (err) { reportError(err); } finally { opening = false; }
    }));
    context.subscriptions.push(vscode.workspace.onDidGrantWorkspaceTrust(() => { void resume().catch(reportError); }));
    void resume().catch(reportError);
}
