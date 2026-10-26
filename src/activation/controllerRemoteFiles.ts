/** FTP 파일은 현재 창에서 읽고, 사용 중인 문서·디버그 세션이 없는 TMP 사본만 정리한다. */
import * as vscode from 'vscode';
import * as path from 'path';
import { RemoteSourceSession, REMOTE_SOURCE_SCHEME } from '../controller/files/remoteSourceSession';

export class ControllerRemoteFiles implements vscode.FileSystemProvider, vscode.Disposable {
	private readonly sessions = new Map<string, RemoteSourceSession>();
	private readonly pins = new Map<string, number>();
	private readonly debugging = new Set<string>();
	private readonly changed = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
	readonly onDidChangeFile = this.changed.event;
	private readonly subscriptions: vscode.Disposable[];

	constructor(context: vscode.ExtensionContext) {
		this.subscriptions = [
			vscode.workspace.registerFileSystemProvider(REMOTE_SOURCE_SCHEME, this, { isReadonly: true, isCaseSensitive: false }),
			vscode.workspace.onDidCloseTextDocument(() => { this.collect(); }),
			vscode.debug.onDidStartDebugSession(session => {
				const id = session.configuration.remoteSourceSessionId;
				if (session.type === 'brooks-gpl' && typeof id === 'string') { this.debugging.add(id); }
			}),
			vscode.debug.onDidTerminateDebugSession(session => {
				const id = session.configuration.remoteSourceSessionId;
				if (typeof id === 'string') { this.debugging.delete(id); this.collect(); }
			}),
		];
		context.subscriptions.push(this);
	}

	getSession(host: string, root: string, fresh = false): RemoteSourceSession {
		if (fresh) {
			const session = new RemoteSourceSession(host, root);
			this.sessions.set(session.id, session);
			return session;
		}
		const key = JSON.stringify([host, root]);
		let session = this.sessions.get(key);
		if (!session) { session = new RemoteSourceSession(host, root); this.sessions.set(key, session); }
		return session;
	}

	/** 파일을 여는 도중 발생하는 문서 이벤트가 캐시를 회수하지 않게 한다. */
	retain(session: RemoteSourceSession): vscode.Disposable {
		this.pins.set(session.id, (this.pins.get(session.id) ?? 0) + 1);
		let released = false;
		return { dispose: () => {
			if (released) { return; }
			released = true;
			const count = (this.pins.get(session.id) ?? 1) - 1;
			if (count > 0) { this.pins.set(session.id, count); } else { this.pins.delete(session.id); }
			this.collect();
		} };
	}

	private collect(): void {
		const open = new Set(vscode.workspace.textDocuments
			.filter(doc => doc.uri.scheme === REMOTE_SOURCE_SCHEME).map(doc => doc.uri.authority));
		for (const [key, session] of this.sessions) {
			if (open.has(session.id) || this.debugging.has(session.id) || this.pins.has(session.id)) { continue; }
			session.dispose();
			this.sessions.delete(key);
		}
	}

	private target(uri: vscode.Uri): { session: RemoteSourceSession; remotePath: string } {
		const session = [...this.sessions.values()].find(s => s.id === uri.authority);
		if (!session) { throw vscode.FileSystemError.Unavailable('제어기 파일 연결이 끝났습니다. FTP 트리에서 파일을 다시 여세요.'); }
		const remotePath = session.remotePathFromUri(uri.toString());
		if (!remotePath) { throw vscode.FileSystemError.NoPermissions(uri); }
		return { session, remotePath };
	}

	watch(): vscode.Disposable { return { dispose() {} }; }
	async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
		const { session, remotePath } = this.target(uri);
		if (remotePath === session.root) { return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 }; }
		const name = path.posix.basename(remotePath);
		const entry = (await session.list(path.posix.dirname(remotePath), true)).find(e => e.name.toLowerCase() === name.toLowerCase());
		if (!entry) { throw vscode.FileSystemError.FileNotFound(uri); }
		return { type: entry.isDirectory ? vscode.FileType.Directory : vscode.FileType.File,
			ctime: 0, mtime: entry.modifiedAt?.getTime() ?? 0, size: entry.size };
	}
	async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
		const { session, remotePath } = this.target(uri);
		return (await session.list(remotePath)).map(e => [e.name, e.isDirectory ? vscode.FileType.Directory : vscode.FileType.File]);
	}
	async readFile(uri: vscode.Uri): Promise<Uint8Array> {
		const { session, remotePath } = this.target(uri);
		return session.read(remotePath);
	}
	async refresh(uri: vscode.Uri): Promise<void> {
		const { session, remotePath } = this.target(uri);
		const pin = this.retain(session);
		try {
			await session.list(path.posix.dirname(remotePath), true);
			await session.read(remotePath, true);
			this.changed.fire([{ type: vscode.FileChangeType.Changed, uri }]);
		} finally { pin.dispose(); }
	}
	createDirectory(): never { throw vscode.FileSystemError.NoPermissions('제어기 파일 보기는 읽기 전용입니다.'); }
	writeFile(): never { throw vscode.FileSystemError.NoPermissions('제어기 파일 보기는 읽기 전용입니다.'); }
	delete(): never { throw vscode.FileSystemError.NoPermissions('제어기 파일 보기는 읽기 전용입니다.'); }
	rename(): never { throw vscode.FileSystemError.NoPermissions('제어기 파일 보기는 읽기 전용입니다.'); }

	dispose(): void {
		for (const subscription of this.subscriptions) { subscription.dispose(); }
		for (const session of this.sessions.values()) { session.dispose(); }
		this.sessions.clear();
		this.changed.dispose();
	}
}
