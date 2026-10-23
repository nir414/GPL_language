/** 작업공간 전환·Workspace Trust·일회성 Attach를 모의 VS Code API로 검증한다. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vm from 'vm';
import { createRequire } from 'module';
import { test } from './harness';
import { PENDING_CONTROLLER_DEBUG_KEY } from '../project/controllerProjectDebug';
import { downloadControllerLibraries, downloadControllerProjectCopy } from '../controller/files/controllerProjectDownload';
import type { ControllerDownloadIo } from '../controller/files/controllerProjectDownload';
import { normalizeAbsoluteRemoteDir } from '../controller/files/ftpClient';

function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-debug-open-'));
    const state = new Map<string, any>();
    const commands = new Map<string, (...args: any[]) => Promise<void>>();
    const starts: any[] = [];
    const connections: any[] = [];
    const configUpdates: any[] = [];
    let syncEditorBreakpoints = true;
    const errors: string[] = [];
    const opened: any[] = [];
    const grantHandlers: Array<() => void> = [];
    const downloads: string[] = [];
    const dispose = () => ({ dispose() {} });
    const cfg = { ip: '192.0.2.2', port: 1502, consolePort: 1503, ftpBasePath: '/GPL', ftpFlashProjectsPath: '/flash/projects' };
    const vscode: any = {
        Uri: { file: (fsPath: string) => ({ fsPath }) },
        ProgressLocation: { Notification: 1 },
        ConfigurationTarget: { Workspace: 2 },
        workspace: {
            isTrusted: true, workspaceFile: undefined,
            getConfiguration: () => ({
                get: (key: string) => key === 'syncEditorBreakpoints' ? syncEditorBreakpoints : undefined,
                update: async (key: string, value: boolean, scope: number) => {
                    configUpdates.push({ key, value, scope });
                    if (key === 'syncEditorBreakpoints') { syncEditorBreakpoints = value; }
                },
            }),
            getWorkspaceFolder: () => undefined,
            onDidGrantWorkspaceTrust: (fn: () => void) => { grantHandlers.push(fn); return dispose(); },
        },
        debug: { startDebugging: async (_folder: unknown, config: unknown) => { starts.push(config); return true; } },
        window: {
            withProgress: async (_options: unknown, fn: any) => fn({ report() {} }),
            showQuickPick: async (items: any[]) => items[0],
            showTextDocument: async () => ({}),
            showErrorMessage: (message: string) => { errors.push(message); },
            showInformationMessage: () => {}, showWarningMessage: () => {},
        },
        commands: {
            registerCommand: (id: string, fn: any) => { commands.set(id, fn); return dispose(); },
            executeCommand: async (id: string, uri: unknown, newWindow: unknown) => { opened.push({ id, uri, newWindow }); },
        },
    };
    const io: ControllerDownloadIo = {
        list: async (_host, remote) => remote === '/GPL' ? [{ name: 'FolderName', isDirectory: true, size: 0 }] : [],
        download: async (_host, remote, destination) => {
            downloads.push(remote);
            fs.writeFileSync(path.join(destination, 'Project.gpr'), 'ProjectName="ActualName"\nProjectStart="Main"\nProjectSource="Main.gpl"\n');
            fs.writeFileSync(path.join(destination, 'Main.gpl'), 'Module Main\nEnd Module\n');
            return { downloaded: 2, totalBytes: 1 };
        },
    };
    const context: any = {
        subscriptions: [], globalStorageUri: { fsPath: root },
        globalState: { get: (key: string) => state.get(key), update: async (key: string, value: unknown) => { state.set(key, value); } },
    };
    const host: any = {
        context, log() {},
        connection: { connectControllerWithArgs: async (args: any) => { connections.push({ ...args, syncEditorBreakpoints }); return { ok: true }; } },
    };
    const filename = path.resolve(__dirname, '../activation/controllerProjectDebug.js');
    const realRequire = createRequire(filename);
    const module = { exports: {} as any };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
        module, exports: module.exports, console,
        require: (id: string) => {
            if (id === 'vscode') { return vscode; }
            if (id.endsWith('/controllerConnection')) { return { getControllerConfig: () => cfg }; }
            if (id.endsWith('/ftpClient')) { return { listRemoteDir: io.list, normalizeAbsoluteRemoteDir }; }
            if (id.endsWith('/controllerProjectDownload')) {
                return {
                    downloadControllerProjectCopy: (...args: Parameters<typeof downloadControllerProjectCopy>) => downloadControllerProjectCopy(args[0], args[1], args[2], args[3], io),
                    downloadControllerLibraries: (...args: Parameters<typeof downloadControllerLibraries>) => downloadControllerLibraries(args[0], args[1], args[2], args[3], args[4], io),
                };
            }
            return realRequire(id);
        },
    }, { filename });
    const activate = () => { grantHandlers.length = 0; module.exports.activateControllerProjectDebug(host); };
    const flush = () => new Promise(resolve => setImmediate(resolve));
    return {
        root, state, starts, connections, configUpdates, errors, opened, downloads, vscode, host, activate, flush,
        grant: () => grantHandlers.forEach(fn => fn()),
        open: (resource?: unknown) => commands.get('gpl.controller.openProjectForDebugging')!(resource),
        cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
    };
}

test('controller project open: FTP 메뉴에서 다운로드하고 창 전환 뒤 정확한 대상에 한 번 Attach한다', async () => {
    const s = fixture();
    try {
        s.activate();
        await s.open({ remotePath: '/GPL/FolderName' });
        assert.deepStrictEqual(s.errors, []);
        assert.deepStrictEqual(s.downloads, ['/GPL/FolderName']);
        assert.strictEqual(s.starts.length, 0);
        const pending = s.state.get(PENDING_CONTROLLER_DEBUG_KEY);
        assert.strictEqual(pending.target.projectName, 'ActualName');
        assert.strictEqual(s.opened[0].newWindow, false);
        const workspace = JSON.parse(fs.readFileSync(pending.workspaceFile, 'utf8'));
        assert.strictEqual(workspace.settings['gpl.controller.consolePort'], 1503);
        assert.strictEqual(workspace.settings['gpl.controller.syncEditorBreakpoints'], false);
        assert.ok(fs.existsSync(path.join(path.dirname(pending.workspaceFile), 'sources', '.vscode', 'launch.json')));

        s.vscode.workspace.workspaceFile = { fsPath: pending.workspaceFile };
        s.vscode.workspace.isTrusted = false;
        s.activate();
        await s.flush();
        assert.strictEqual(s.starts.length, 0, '신뢰 전에는 Attach하지 않는다');
        s.vscode.workspace.isTrusted = true;
        s.grant();
        s.grant();
        await s.flush();
        assert.strictEqual(s.starts.length, 1);
        assert.strictEqual(s.starts[0].projectDir, pending.target.projectDir);
        assert.strictEqual(s.connections[0].ip, '192.0.2.2');
        assert.strictEqual(s.connections[0].syncEditorBreakpoints, false, '초기 접속 시점부터 기존 BP 동기화를 차단한다');
        assert.deepStrictEqual(s.configUpdates, [{ key: 'syncEditorBreakpoints', value: false, scope: 2 }]);
        assert.strictEqual(s.connections[0].port, 1502);
        assert.strictEqual(s.host.sessionTargetDir, pending.target.projectDir);
        assert.strictEqual(s.state.get(PENDING_CONTROLLER_DEBUG_KEY), undefined);
        s.activate();
        await s.flush();
        assert.strictEqual(s.starts.length, 1, '나중에 작업공간을 다시 열면 자동 Attach하지 않는다');
    } finally { s.cleanup(); }
});

test('controller project open: 명령 팔레트에서도 FTP 프로젝트를 선택할 수 있다', async () => {
    const s = fixture();
    try {
        s.activate();
        await s.open();
        assert.deepStrictEqual(s.errors, []);
        assert.deepStrictEqual(s.downloads, ['/GPL/FolderName']);
        assert.strictEqual(s.opened.length, 1);
    } finally { s.cleanup(); }
});

test('controller project open: 경로 이탈과 기존 디버그 세션은 다운로드 전에 중단한다', async () => {
    const s = fixture();
    try {
        s.activate();
        await s.open({ remotePath: '/GPL/../../outside' });
        assert.strictEqual(s.errors.length, 1);
        assert.strictEqual(s.downloads.length, 0);
        s.vscode.debug.activeDebugSession = { type: 'brooks-gpl' };
        await s.open({ remotePath: '/GPL/FolderName' });
        assert.strictEqual(s.errors.length, 2);
        assert.strictEqual(s.downloads.length, 0);
    } finally { s.cleanup(); }
});

test('controller project open: 첫 연결이 실패해도 요청을 재실행하지 않고 F5 구성은 보존한다', async () => {
    const s = fixture();
    try {
        s.activate();
        await s.open({ remotePath: '/GPL/FolderName' });
        const pending = s.state.get(PENDING_CONTROLLER_DEBUG_KEY);
        s.vscode.workspace.workspaceFile = { fsPath: pending.workspaceFile };
        s.host.connection.connectControllerWithArgs = async () => ({ ok: false, error: 'ECONNREFUSED' });
        s.activate();
        await s.flush();
        assert.strictEqual(s.errors.length, 1);
        assert.strictEqual(s.starts.length, 0);
        assert.strictEqual(s.state.get(PENDING_CONTROLLER_DEBUG_KEY), undefined);
        assert.ok(fs.existsSync(path.join(path.dirname(pending.workspaceFile), 'sources', '.vscode', 'launch.json')));
        s.activate();
        await s.flush();
        assert.strictEqual(s.errors.length, 1);
    } finally { s.cleanup(); }
});

test('controller project open: 중단점 동기화를 끄지 못하면 초기 연결을 보내지 않는다', async () => {
    const s = fixture();
    try {
        s.activate();
        await s.open({ remotePath: '/GPL/FolderName' });
        const pending = s.state.get(PENDING_CONTROLLER_DEBUG_KEY);
        s.vscode.workspace.workspaceFile = { fsPath: pending.workspaceFile };
        s.vscode.workspace.getConfiguration = () => ({
            get: () => true,
            update: async () => { throw new Error('settings write failed'); },
        });
        s.activate();
        await s.flush();
        assert.strictEqual(s.connections.length, 0);
        assert.strictEqual(s.starts.length, 0);
        assert.ok(s.errors[0].includes('settings write failed'));
        assert.strictEqual(s.state.get(PENDING_CONTROLLER_DEBUG_KEY), undefined);
    } finally { s.cleanup(); }
});
