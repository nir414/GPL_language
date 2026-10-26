import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vm from 'vm';
import { createRequire } from 'module';
import { RemoteSourceSession, REMOTE_SOURCE_SCHEME } from '../controller/files/remoteSourceSession';
import type { RemoteSourceIo } from '../controller/files/remoteSourceSession';
import { test } from './harness';

function fixture() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-remote-files-'));
	const calls: string[] = [];
	const documents: any[] = [];
	const close: Array<() => void> = [];
	const start: Array<(session: any) => void> = [];
	const terminate: Array<(session: any) => void> = [];
	const registered: any[] = [];
	const subscriptions: Array<{ dispose(): void }> = [];
	let content = 'Module Main';
	const io: RemoteSourceIo = {
		list: async (host, remote) => {
			calls.push(`LIST ${host} ${remote}`);
			return remote === '/GPL' ? [{ name: 'Project', isDirectory: true, size: 0 }]
				: [{ name: 'Main.gpl', isDirectory: false, size: 11 }, { name: 'Sub', isDirectory: true, size: 0 }];
		},
		read: async (host, remote) => { calls.push(`READ ${host} ${remote}`); return Buffer.from(content); },
	};
	class Session extends RemoteSourceSession {
		constructor(host: string, remote: string) { super(host, remote, io, root); }
	}
	const disposable = () => ({ dispose() {} });
	const error = (code: string) => (message: unknown) => Object.assign(new Error(String(message)), { code });
	const vscode = {
		EventEmitter: class {
			private readonly listeners: Array<(value: unknown) => void> = [];
			event = (listener: (value: unknown) => void) => {
				this.listeners.push(listener);
				return { dispose: () => { const index = this.listeners.indexOf(listener); if (index >= 0) { this.listeners.splice(index, 1); } } };
			};
			fire(value: unknown) { this.listeners.forEach(listener => listener(value)); }
			dispose() { this.listeners.length = 0; }
		},
		FileType: { File: 1, Directory: 2 },
		FileChangeType: { Changed: 1 },
		FileSystemError: { NoPermissions: error('NoPermissions'), Unavailable: error('Unavailable'), FileNotFound: error('FileNotFound') },
		workspace: {
			textDocuments: documents,
			registerFileSystemProvider: (...args: any[]) => { registered.push(args); return disposable(); },
			onDidCloseTextDocument: (handler: () => void) => { close.push(handler); return disposable(); },
		},
		debug: {
			onDidStartDebugSession: (handler: any) => { start.push(handler); return disposable(); },
			onDidTerminateDebugSession: (handler: any) => { terminate.push(handler); return disposable(); },
		},
	};
	const filename = path.resolve(__dirname, '../activation/controllerRemoteFiles.js');
	const realRequire = createRequire(filename);
	const module = { exports: {} as any };
	vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
		module, exports: module.exports,
		require: (id: string) => id === 'vscode' ? vscode : id.endsWith('/remoteSourceSession')
			? { RemoteSourceSession: Session, REMOTE_SOURCE_SCHEME } : realRequire(id),
	}, { filename });
	const provider = new module.exports.ControllerRemoteFiles({ subscriptions });
	const uri = (session: RemoteSourceSession, remote: string) => ({
		scheme: REMOTE_SOURCE_SCHEME, authority: session.id, path: remote,
		toString: () => session.uri(remote),
	});
	const debug = (session: RemoteSourceSession, type = 'brooks-gpl') => ({ type, configuration: { remoteSourceSessionId: session.id } });
	return {
		root, calls, documents, registered, provider, uri,
		setContent: (value: string) => { content = value; },
		close: () => close.forEach(handler => handler()),
		start: (session: RemoteSourceSession, type?: string) => start.forEach(handler => handler(debug(session, type))),
		terminate: (session: RemoteSourceSession, type?: string) => terminate.forEach(handler => handler(debug(session, type))),
		cleanup() { subscriptions.forEach(item => item.dispose()); fs.rmSync(root, { recursive: true, force: true }); },
	};
}

test('원격 파일 provider: 읽기 전용 등록과 stat/list/read가 실제 TMP 캐시를 사용한다', async () => {
	const s = fixture();
	try {
		assert.strictEqual(s.registered[0][0], 'gpl-ftp');
		assert.strictEqual(s.registered[0][2].isReadonly, true);
		const session = s.provider.getSession('192.0.2.10', '/GPL') as RemoteSourceSession;
		assert.strictEqual(s.provider.getSession('192.0.2.10', '/GPL'), session);
		assert.strictEqual((await s.provider.stat(s.uri(session, '/GPL'))).type, 2);
		assert.strictEqual(s.calls.length, 0, '루트 stat은 전체 FTP 탐색을 하지 않는다');
		const directory = await s.provider.readDirectory(s.uri(session, '/GPL'));
		assert.strictEqual(directory[0][0], 'Project');
		assert.strictEqual(directory[0][1], 2);
		const info = await s.provider.stat(s.uri(session, '/GPL/Project/Main.gpl'));
		assert.strictEqual(info.type, 1);
		assert.strictEqual(info.size, 11);
		const bytes = await s.provider.readFile(s.uri(session, '/GPL/Project/Main.gpl'));
		assert.strictEqual(Buffer.from(bytes).toString(), 'Module Main');
		assert.strictEqual(fs.readFileSync(session.localPath('/GPL/Project/Main.gpl'), 'utf8'), 'Module Main');
		assert.deepStrictEqual(s.calls.filter(call => call.startsWith('READ')), ['READ 192.0.2.10 /GPL/Project/Main.gpl']);
	} finally { s.cleanup(); }
});

test('원격 파일 provider: 연결이 없거나 루트 밖 URI이면 읽기를 거부한다', async () => {
	const s = fixture();
	try {
		await assert.rejects(s.provider.readFile({ authority: 'missing' }), { code: 'Unavailable' });
		const session = s.provider.getSession('192.0.2.10', '/GPL') as RemoteSourceSession;
		await assert.rejects(s.provider.readFile({ authority: session.id,
			toString: () => `gpl-ftp://${session.id}/GPL/%2e%2e/outside.gpl` }), { code: 'NoPermissions' });
		await assert.rejects(s.provider.stat(s.uri(session, '/GPL/Missing.gpl')), { code: 'FileNotFound' });
		assert.ok(!s.calls.some(call => call.startsWith('READ')));
	} finally { s.cleanup(); }
});

test('원격 파일 provider: create/write/delete/rename는 모두 FTP 동작 전에 거부한다', () => {
	const s = fixture();
	try {
		for (const action of ['createDirectory', 'writeFile', 'delete', 'rename']) {
			assert.throws(() => s.provider[action](), { code: 'NoPermissions' }, action);
		}
		assert.deepStrictEqual(s.calls, []);
	} finally { s.cleanup(); }
});

test('원격 파일 provider: 열린 문서가 있으면 캐시를 보존하고 마지막 문서 종료 후 정리한다', () => {
	const s = fixture();
	try {
		const session = s.provider.getSession('192.0.2.10', '/GPL') as RemoteSourceSession;
		s.documents.push({ uri: s.uri(session, '/GPL/Project/Main.gpl') });
		s.close();
		assert.ok(fs.existsSync(session.cacheRoot));
		s.documents.length = 0;
		s.close();
		assert.ok(!fs.existsSync(session.cacheRoot));
		const next = s.provider.getSession('192.0.2.10', '/GPL') as RemoteSourceSession;
		assert.notStrictEqual(next.id, session.id);
	} finally { s.cleanup(); }
});

test('원격 파일 provider: 중첩 retain과 활성 디버깅을 모두 해제한 뒤에만 캐시를 정리한다', () => {
	const s = fixture();
	try {
		const session = s.provider.getSession('192.0.2.10', '/GPL') as RemoteSourceSession;
		const first = s.provider.retain(session);
		const second = s.provider.retain(session);
		s.start(session);
		s.close();
		assert.ok(fs.existsSync(session.cacheRoot));
		first.dispose(); first.dispose();
		assert.ok(fs.existsSync(session.cacheRoot), 'retain 해제는 한 번만 적용한다');
		s.terminate(session);
		assert.ok(fs.existsSync(session.cacheRoot), '열기 작업의 retain이 남아 있다');
		second.dispose();
		assert.ok(!fs.existsSync(session.cacheRoot));
	} finally { s.cleanup(); }
});

test('원격 파일 provider: 같은 제어기라도 fresh 연결은 탐색 세션과 소스 캐시를 공유하지 않는다', async () => {
	const s = fixture();
	try {
		const browse = s.provider.getSession('192.0.2.10', '/GPL') as RemoteSourceSession;
		const browseUri = s.uri(browse, '/GPL/Project/Main.gpl');
		await s.provider.readFile(browseUri);
		const first = s.provider.getSession('192.0.2.10', '/GPL', true) as RemoteSourceSession;
		const second = s.provider.getSession('192.0.2.10', '/GPL', true) as RemoteSourceSession;
		assert.strictEqual(new Set([browse.id, first.id, second.id]).size, 3);
		assert.strictEqual(new Set([browse.cacheRoot, first.cacheRoot, second.cacheRoot]).size, 3);
		assert.strictEqual(s.provider.getSession('192.0.2.10', '/GPL'), browse);
		s.setContent('Module Updated');
		assert.strictEqual(Buffer.from(await s.provider.readFile(s.uri(first, '/GPL/Project/Main.gpl'))).toString(), 'Module Updated');
		assert.strictEqual(Buffer.from(await s.provider.readFile(browseUri)).toString(), 'Module Main');
		assert.strictEqual(s.calls.filter(call => call.startsWith('READ')).length, 2);
	} finally { s.cleanup(); }
});

test('원격 파일 provider: 명시적 새로고침은 원격 내용을 다시 읽고 Changed 이벤트를 보낸다', async () => {
	const s = fixture();
	try {
		const session = s.provider.getSession('192.0.2.10', '/GPL') as RemoteSourceSession;
		const uri = s.uri(session, '/GPL/Project/Main.gpl');
		s.documents.push({ uri });
		const events: any[] = [];
		const subscription = s.provider.onDidChangeFile((changes: any[]) => events.push(...changes));
		await s.provider.readFile(uri);
		const listsBefore = s.calls.filter(call => call.startsWith('LIST')).length;
		s.setContent('Module Updated');
		await s.provider.refresh(uri);
		assert.strictEqual(s.calls.filter(call => call.startsWith('READ')).length, 2);
		assert.ok(s.calls.filter(call => call.startsWith('LIST')).length > listsBefore);
		assert.strictEqual(fs.readFileSync(session.localPath('/GPL/Project/Main.gpl'), 'utf8'), 'Module Updated');
		assert.strictEqual(events.length, 1);
		assert.strictEqual(events[0].type, 1);
		assert.strictEqual(events[0].uri.toString(), uri.toString());
		assert.strictEqual(Buffer.from(await s.provider.readFile(uri)).toString(), 'Module Updated');
		assert.strictEqual(s.calls.filter(call => call.startsWith('READ')).length, 2, '갱신 후에는 새 캐시를 재사용한다');
		subscription.dispose();
	} finally { s.cleanup(); }
});
