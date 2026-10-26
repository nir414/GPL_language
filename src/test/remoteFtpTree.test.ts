import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { createRequire } from 'module';
import { test } from './harness';

/** 실제 TreeDataProvider를 실행하며 FTP I/O와 명령 콘솔 경계만 대체한다. */
function fixture() {
	let host = '192.0.2.10';
	let basePath = '/GPL';
	let flashPath = '/flash/projects';
	let rootEntries: any[] = [{ name: 'Project', isDirectory: true, size: 0 }];
	let pendingRoot: Promise<any> | undefined;
	const calls: Array<{ host: string; remote: string }> = [];
	const roots: Array<{ host: string; remote: string[] }> = [];
	const commandCalls: string[] = [];
	const failures = new Set<string>();
	const listings = new Map<string, any[]>([
		['/GPL/Project', [{ name: 'Nested', isDirectory: true, size: 0 }, { name: 'Main.gpl', isDirectory: false, size: 12 }]],
		['/GPL/Project/Nested', [{ name: 'Child.gpl', isDirectory: false, size: 20 }]],
	]);
	const dispose = () => ({ dispose() {} });
	class EventEmitter {
		event = () => dispose();
		fire() {}
		dispose() {}
	}
	const vscode: any = {
		EventEmitter,
		TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
		TreeItem: class { constructor(public label: string, public collapsibleState: number) {} },
		ThemeIcon: class { constructor(public id: string) {} },
		workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
		debug: { breakpoints: [] },
	};
	const consoleCommand = async (command: string) => {
		commandCalls.push(command); throw new Error('FTP 탐색은 명령 콘솔을 사용하면 안 된다');
	};
	const controller = {
		getControllerConfig: () => ({ ip: host, port: 1402, consolePort: 1403, ftpBasePath: basePath, ftpFlashProjectsPath: flashPath }),
		trySendCommand: consoleCommand, probeControllerCommand: consoleCommand,
		getTrafficLogOptions: () => ({}), getConnectionStats: () => ({}),
	};
	const ftp = {
		listRemoteDir: async (target: string, remote: string) => {
			calls.push({ host: target, remote });
			if (failures.delete(remote)) { throw new Error('FTP unavailable'); }
			return listings.get(remote) ?? [];
		},
		listRemoteDirs: async (target: string, remote: string[]) => {
			roots.push({ host: target, remote });
			if (pendingRoot) { const result = pendingRoot; pendingRoot = undefined; return result; }
			return [
				{ entries: rootEntries },
				{ entries: [{ name: 'Saved', isDirectory: true, size: 0 }] },
			];
		},
	};
	const loaded = new Map<string, { exports: any }>();
	function load(filename: string): any {
		const cached = loaded.get(filename);
		if (cached) { return cached.exports; }
		const module = { exports: {} as any };
		loaded.set(filename, module);
		const realRequire = createRequire(filename);
		vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
			module, exports: module.exports, console, process, Buffer, setTimeout, clearTimeout,
			require: (id: string) => {
				if (id === 'vscode') { return vscode; }
				if (id.endsWith('/controllerConnection')) { return controller; }
				if (id.endsWith('/ftpClient')) { return ftp; }
				if (id.endsWith('/debugBridge')) { return { onDebugThreadsUpdated: () => dispose() }; }
				if (id.endsWith('/breakpointSync')) { return { editorBreakpointTargets: () => [] }; }
				const resolved = realRequire.resolve(id);
				return id.startsWith('.') && resolved.endsWith('.js') ? load(resolved) : realRequire(id);
			},
		}, { filename });
		return module.exports;
	}
	const { ControllerTreeProvider } = load(path.resolve(__dirname, '../views/controllerTreeProvider.js'));
	const provider = new ControllerTreeProvider();
	return {
		provider, calls, roots, commandCalls, failures, listings,
		setHost: (value: string) => { host = value; },
		setPaths: (base: string, flash: string) => { basePath = base; flashPath = flash; },
		setRootEntries: (entries: any[]) => { rootEntries = entries; },
		deferRoot() {
			let resolve!: (value: any) => void;
			pendingRoot = new Promise(done => { resolve = done; });
			return resolve;
		},
		async project() {
			const root = await provider.getChildren();
			const gpl = root.find((node: any) => node.id === 'ftp');
			return (await provider.getChildren(gpl)).find((node: any) => node.label === 'Project');
		},
		cleanup: () => provider.dispose(),
	};
}

test('원격 FTP 트리: 명령 콘솔 연결 없이 루트만 조회하고 폴더를 펼칠 때 자식 목록을 읽는다', async () => {
	const s = fixture();
	try {
		assert.strictEqual((await s.provider.getChildren()).length, 1);
		await s.provider.browseFtp();
		assert.strictEqual(s.provider.isConnected, false);
		assert.strictEqual(s.roots.length, 1);
		assert.strictEqual(s.roots[0].host, '192.0.2.10');
		assert.strictEqual(s.roots[0].remote.join('|'), '/GPL|/flash/projects');
		const project = await s.project();
		assert.strictEqual(s.calls.length, 0, '루트를 그리는 것만으로 하위 폴더를 읽지 않는다');
		const item = s.provider.getTreeItem(project);
		assert.strictEqual(item.collapsibleState, 1);
		assert.strictEqual(item.command, undefined);
		const first = s.provider.getChildren(project);
		const second = s.provider.getChildren(project);
		const children = await first;
		await second;
		assert.strictEqual(s.calls.length, 1, '같은 폴더의 동시·반복 펼치기는 목록 요청을 공유한다');
		assert.strictEqual(s.calls[0].remote, '/GPL/Project');
		const nested = children.find((node: any) => node.label === 'Nested');
		assert.ok(nested);
		await s.provider.getChildren(nested);
		assert.strictEqual(s.calls[1].remote, '/GPL/Project/Nested');
		assert.deepStrictEqual(s.commandCalls, []);
	} finally { s.cleanup(); }
});

test('원격 FTP 트리: 파일 열기 명령이 폴더를 만들었던 제어기와 원격 경로를 유지한다', async () => {
	const s = fixture();
	try {
		await s.provider.browseFtp();
		const project = await s.project();
		s.setHost('192.0.2.20');
		const children = await s.provider.getChildren(project);
		const file = children.find((node: any) => node.label === 'Main.gpl');
		const item = s.provider.getTreeItem(file);
		assert.strictEqual(s.calls[0].host, '192.0.2.10');
		assert.strictEqual(item.collapsibleState, 0);
		assert.strictEqual(item.command.command, 'gpl.controller.openRemoteFile');
		assert.strictEqual(item.command.arguments[0].controllerHost, '192.0.2.10');
		assert.strictEqual(item.command.arguments[0].remotePath, '/GPL/Project/Main.gpl');
		assert.strictEqual(item.id, 'ftp:192.0.2.10:/GPL/Project/Main.gpl');
		assert.strictEqual((await s.provider.getChildren(file)).length, 0);
		assert.strictEqual(s.calls.length, 1, '파일 노드는 LIST를 보내지 않는다');
	} finally { s.cleanup(); }
});

test('원격 FTP 트리: 실패한 하위 목록은 재시도하고 새로고침은 성공 캐시도 무효화한다', async () => {
	const s = fixture();
	try {
		await s.provider.browseFtp();
		const project = await s.project();
		s.failures.add('/GPL/Project');
		const failed = await s.provider.getChildren(project);
		assert.ok(failed[0].label.includes('조회 실패'));
		const recovered = await s.provider.getChildren(project);
		assert.ok(recovered.some((node: any) => node.label === 'Main.gpl'));
		assert.strictEqual(s.calls.length, 2);
		await s.provider.getChildren(project);
		assert.strictEqual(s.calls.length, 2);
		s.listings.set('/GPL/Project', [{ name: 'Updated.gpl', isDirectory: false, size: 10 }]);
		await s.provider.refreshFtp();
		const refreshed = await s.provider.getChildren(project);
		assert.strictEqual(s.calls.length, 3);
		assert.strictEqual(refreshed[0].label, 'Updated.gpl');
		assert.deepStrictEqual(s.commandCalls, []);
	} finally { s.cleanup(); }
});

test('원격 FTP 트리: 목록을 기다리는 동안 제어기 설정이 바뀌면 이전 응답을 폐기한다', async () => {
	const s = fixture();
	try {
		const resolve = s.deferRoot();
		const pending = s.provider.browseFtp();
		assert.strictEqual(s.roots.length, 1);
		s.setHost('192.0.2.20');
		resolve([{ entries: [{ name: 'OldControllerProject', isDirectory: true, size: 0 }] }, { entries: [] }]);
		await pending;
		const roots = await s.provider.getChildren();
		const gpl = roots.find((node: any) => node.id === 'ftp');
		const children = await s.provider.getChildren(gpl);
		assert.ok(!children.some((node: any) => node.label === 'OldControllerProject'));
		assert.ok(children.every((node: any) => !node.remotePath && !node.command));
		await s.provider.refreshFtp();
		const project = await s.project();
		assert.strictEqual(project.controllerHost, '192.0.2.20');
		assert.strictEqual(s.roots[1].host, '192.0.2.20');
		assert.strictEqual(s.calls.length, 0);
		assert.deepStrictEqual(s.commandCalls, []);
	} finally { s.cleanup(); }
});

test('원격 FTP 트리: 캐시 조회 후 host나 FTP 루트가 바뀌면 기존 항목을 클릭할 수 없다', async () => {
	const s = fixture();
	try {
		await s.provider.browseFtp();
		s.setHost('192.0.2.20');
		let roots = await s.provider.getChildren();
		let children = await s.provider.getChildren(roots.find((node: any) => node.id === 'ftp'));
		assert.ok(children[0].label.includes('설정이 바뀌었습니다'));
		assert.ok(children.every((node: any) => !node.remotePath && !node.command));
		s.setHost('192.0.2.10');
		s.setPaths('/NewGPL', '/flash/new-projects');
		roots = await s.provider.getChildren();
		children = await s.provider.getChildren(roots.find((node: any) => node.id === 'ftp'));
		assert.ok(children[0].label.includes('설정이 바뀌었습니다'));
		assert.ok(children.every((node: any) => !node.remotePath && !node.command));
		await s.provider.refreshFtp();
		const project = await s.project();
		assert.strictEqual(project.remotePath, '/NewGPL/Project');
		assert.strictEqual(project.controllerHost, '192.0.2.10');
		assert.strictEqual(s.calls.length, 0);
	} finally { s.cleanup(); }
});

test('원격 FTP 트리: 손상된 루트·하위 항목에서 열기 명령과 추가 LIST가 생기지 않는다', async () => {
	const s = fixture();
	try {
		s.setRootEntries([{ name: '../outside', isDirectory: true, size: 0 }]);
		await s.provider.browseFtp();
		const roots = await s.provider.getChildren();
		const gpl = roots.find((node: any) => node.id === 'ftp');
		const rejected = await s.provider.getChildren(gpl);
		assert.ok(rejected[0].label.includes('안전하지 않은'));
		assert.ok(!rejected[0].remotePath && !rejected[0].command);
		assert.strictEqual((await s.provider.getChildren(rejected[0])).length, 0);
		assert.strictEqual(s.calls.length, 0);
		s.setRootEntries([{ name: 'Project', isDirectory: true, size: 0 }]);
		for (const name of ['nested/escape', '%2e%2e', '%252e%252e', 'CON']) {
			s.listings.set('/GPL/Project', [{ name, isDirectory: true, size: 0 }]);
			await s.provider.refreshFtp();
			const project = await s.project();
			const children = await s.provider.getChildren(project);
			assert.ok(children[0].label.includes('안전하지 않은'), name);
			const item = s.provider.getTreeItem(children[0]);
			assert.strictEqual(item.command, undefined);
			assert.strictEqual(item.remotePath, undefined);
			const before = s.calls.length;
			assert.strictEqual((await s.provider.getChildren(children[0])).length, 0);
			assert.strictEqual(s.calls.length, before, '거부한 항목으로 추가 LIST를 보내지 않는다');
		}
		assert.ok(s.calls.every(call => call.remote === '/GPL/Project'));
		assert.deepStrictEqual(s.commandCalls, []);
	} finally { s.cleanup(); }
});
