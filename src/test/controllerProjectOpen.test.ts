/** 원격 파일·Attach가 기존 작업공간을 보존하고 필요한 내용만 읽는지 검증한다. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vm from 'vm';
import { createRequire } from 'module';
import { test } from './harness';
import { RemoteSourceSession, getRemoteSourceSession } from '../controller/files/remoteSourceSession';
import { listRemoteDir } from '../controller/files/ftpClient';

function fixture() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-remote-open-test-'));
	const commands = new Map<string, (...args: any[]) => Promise<void>>();
	const starts: any[] = [], connections: any[] = [], opened: string[] = [], errors: string[] = [], executed: string[] = [];
	const reads: string[] = [], lists: string[] = [], sessions: RemoteSourceSession[] = [];
	const terminated: Array<(debug: any) => void> = [];
	const files: Record<string, string> = {
		'/GPL/FolderName/Project.gpr': 'ProjectName="ActualName"\nProjectStart="Main"\nProjectSource="Main.gpl"\nProjectSource="Unused.gpl"\n',
		'/GPL/FolderName/Main.gpl': 'Module Main\nEnd Module\n',
		'/GPL/FolderName/Unused.gpl': 'Module Unused\nEnd Module\n',
	};
	const list: typeof listRemoteDir = async (_host, remote) => {
		lists.push(remote);
		const entries = new Map<string, { name: string; isDirectory: boolean; size: number }>();
		for (const [file, contents] of Object.entries(files)) {
			if (!file.startsWith(`${remote}/`)) { continue; }
			const relative = file.slice(remote.length + 1), name = relative.split('/')[0];
			entries.set(name, { name, isDirectory: relative.includes('/'), size: Buffer.byteLength(contents) });
		}
		return [...entries.values()];
	};
	const io = { list, read: async (_host: string, remote: string) => {
		reads.push(remote);
		if (!(remote in files)) { throw new Error(`Missing ${remote}`); }
		return Buffer.from(files[remote]);
	} };
	const cfg = { ip: '192.0.2.2', port: 1502, consolePort: 1503, ftpBasePath: '/GPL', ftpFlashProjectsPath: '/flash/projects' };
	const parse = (value: string) => {
		const u = new URL(value);
		return { scheme: u.protocol.slice(0, -1), authority: u.hostname, path: decodeURIComponent(u.pathname), toString: () => value };
	};
	const vscode: any = {
		Uri: { parse }, ProgressLocation: { Notification: 1 },
		workspace: { isTrusted: true, workspaceFolders: [{ uri: { fsPath: 'existing-project' } }],
			updateWorkspaceFolders: () => { throw new Error('기존 작업공간 변경 금지'); } },
		debug: { startDebugging: async (folder: unknown, config: any) => { assert.strictEqual(folder, undefined); starts.push(config); return true; },
			onDidTerminateDebugSession: (handler: (debug: any) => void) => { terminated.push(handler); return { dispose() {} }; } },
		window: {
			withProgress: async (_options: unknown, action: any) => action({ report() {} }),
			showQuickPick: async (items: any[]) => items[0],
			showTextDocument: async (uri: ReturnType<typeof parse>) => {
				opened.push(uri.toString());
				await getRemoteSourceSession(uri.authority)!.read(uri.path);
				return {};
			},
			showErrorMessage: (message: string) => { errors.push(message); }, showWarningMessage() {},
		},
		commands: { registerCommand: (id: string, action: any) => { commands.set(id, action); return { dispose() {} }; },
			executeCommand: async (id: string) => { executed.push(id); assert.strictEqual(id, 'gplThreads.focus'); } },
	};
	let browseCount = 0;
	const host: any = { context: { subscriptions: [], globalState: { update() { throw new Error('일회성 재개 요청 저장 금지'); } } },
		log() {}, controllerTree: { browseFtp: async () => { browseCount++; } }, project: { scheduleExpectedProjectSync() {} },
		connection: { connectControllerWithArgs: async (args: any) => { connections.push(args); return { ok: true }; } } };
	class RemoteFiles {
		getSession(hostname: string, remoteRoot: string) {
			const session = sessions.find(s => s.host === hostname && s.root === remoteRoot) ?? new RemoteSourceSession(hostname, remoteRoot, io, root);
			if (!sessions.includes(session)) { sessions.push(session); }
			return session;
		}
		retain() { return { dispose() {} }; }
	}
	const filename = path.resolve(__dirname, '../activation/controllerProjectDebug.js'), actualRequire = createRequire(filename);
	const module = { exports: {} as any };
	vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, console,
		require: (id: string) => {
			if (id === 'vscode') { return vscode; }
			if (id.endsWith('/controllerConnection')) { return { getControllerConfig: () => cfg }; }
			if (id.endsWith('/ftpClient')) { return { ...actualRequire(id), listRemoteDir: list }; }
			if (id.endsWith('/controllerRemoteFiles')) { return { ControllerRemoteFiles: RemoteFiles }; }
			if (id.endsWith('/controllerSourceLanguage')) { return { activateControllerSourceLanguage() {} }; }
			return actualRequire(id);
		},
	}, { filename });
	module.exports.activateControllerProjectDebug(host);
	return { starts, connections, opened, errors, executed, reads, lists, host, vscode, files,
		browseCount: () => browseCount,
		terminate: (configuration: any) => terminated.forEach(handler => handler({ type: 'brooks-gpl', configuration })),
		command: (id: string, resource?: unknown) => commands.get(id)!(resource),
		cleanup: () => { sessions.forEach(session => session.dispose()); fs.rmSync(root, { recursive: true, force: true }); } };
}

test('원격 프로젝트 열기: 기존 창에서 메타데이터와 첫 소스만 읽고 안전한 Attach를 요청한다', async () => {
	const s = fixture();
	try {
		await s.command('gpl.controller.openProjectForDebugging', { remotePath: '/GPL/FolderName' });
		assert.deepStrictEqual(s.errors, []);
		assert.strictEqual(s.starts.length, 1);
		const config = s.starts[0];
		assert.strictEqual(config.projectName, 'ActualName');
		assert.ok(config.remoteSourceSessionId);
		for (const flag of ['deployBeforeAttach', 'startOnAttach', 'stopAllBeforeAttach', 'stopOnEntry', 'stopAllOnDisconnect', 'clearProjectBreakpointsOnAttach']) { assert.strictEqual(config[flag], false); }
		assert.strictEqual(config.preserveExistingBreakpoints, true);
		assert.ok(s.reads.includes('/GPL/FolderName/Project.gpr'));
		assert.ok(s.reads.includes('/GPL/FolderName/Main.gpl'));
		assert.ok(!s.reads.includes('/GPL/FolderName/Unused.gpl'));
		assert.ok(s.opened[0].startsWith('gpl-ftp://'));
		assert.strictEqual(s.executed.length, 0);
		assert.strictEqual(s.vscode.workspace.workspaceFolders[0].uri.fsPath, 'existing-project');
	} finally { s.cleanup(); }
});

test('원격 파일 열기: 선택한 파일 하나만 읽으며 제어기 명령 콘솔에 연결하지 않는다', async () => {
	const s = fixture();
	try {
		await s.command('gpl.controller.openRemoteFile', { remotePath: '/GPL/FolderName/Unused.gpl', controllerHost: '192.0.2.7' });
		assert.deepStrictEqual(s.errors, []);
		assert.deepStrictEqual(s.reads, ['/GPL/FolderName/Unused.gpl']);
		assert.strictEqual(s.connections.length, 0);
		assert.strictEqual(s.starts.length, 0);
	} finally { s.cleanup(); }
});

test('원격 프로젝트 열기: 명령 팔레트 선택과 명시한 제어기 주소를 유지한다', async () => {
	const s = fixture();
	try {
		await s.command('gpl.controller.openProjectForDebugging');
		assert.deepStrictEqual(s.errors, []);
		assert.strictEqual(s.connections[0].ip, '192.0.2.2');
		assert.strictEqual(s.connections[0].port, 1502);
		assert.strictEqual(s.connections[0].preserveBreakpoints, true);
	} finally { s.cleanup(); }
});

test('원격 프로젝트 열기: 경로 이탈·미신뢰·기존 디버깅은 FTP 전송 전에 거부한다', async () => {
	const s = fixture();
	try {
		await s.command('gpl.controller.openProjectForDebugging', { remotePath: '/GPL/../../outside' });
		await s.command('gpl.controller.openProjectForDebugging', { remotePath: '/GPL/FolderName', controllerHost: '192.0.2.7' });
		s.vscode.workspace.isTrusted = false;
		await s.command('gpl.controller.openProjectForDebugging', { remotePath: '/GPL/FolderName' });
		s.vscode.workspace.isTrusted = true;
		s.vscode.debug.activeDebugSession = { type: 'brooks-gpl' };
		await s.command('gpl.controller.openProjectForDebugging', { remotePath: '/GPL/FolderName' });
		assert.strictEqual(s.errors.length, 4);
		assert.strictEqual(s.lists.length, 0);
		assert.strictEqual(s.reads.length, 0);
		assert.strictEqual(s.connections.length, 0);
	} finally { s.cleanup(); }
});

test('원격 프로젝트 열기: 연결 실패를 자동 재시도하지 않는다', async () => {
	const s = fixture();
	try {
		let attempts = 0;
		s.host.connection.connectControllerWithArgs = async () => { attempts++; return { ok: false, error: 'ECONNREFUSED' }; };
		await s.command('gpl.controller.openProjectForDebugging', { remotePath: '/GPL/FolderName' });
		assert.strictEqual(s.errors.length, 1);
		assert.strictEqual(attempts, 1);
		assert.strictEqual(s.starts.length, 0);
	} finally { s.cleanup(); }
});

test('원격 FTP 폴더 연결: FTP 트리만 표시하고 작업공간·디버거를 건드리지 않는다', async () => {
	const s = fixture();
	try {
		await s.command('gpl.controller.browseRemoteFiles');
		assert.strictEqual(s.browseCount(), 1);
		assert.deepStrictEqual(s.executed, ['gplThreads.focus']);
		assert.strictEqual(s.connections.length, 0);
		assert.strictEqual(s.starts.length, 0);
	} finally { s.cleanup(); }
});

test('원격 프로젝트 열기: 세션 종료 뒤 기존 프로젝트 대상을 복원한다', async () => {
	const s = fixture();
	try {
		s.host.sessionTargetDir = 'existing-project';
		await s.command('gpl.controller.openProjectForDebugging', { remotePath: '/GPL/FolderName' });
		const config = s.starts[0];
		s.host.sessionTargetDir = config.projectDir;
		s.terminate(config);
		assert.strictEqual(s.host.sessionTargetDir, 'existing-project');
	} finally { s.cleanup(); }
});
