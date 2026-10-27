import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vm from 'vm';
import { createRequire } from 'module';
import { test } from './harness';

/** 실제 언어 provider·캐시를 실행하고 VS Code·FTP 세션 경계만 대체한다. */
function fixture() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-remote-language-'));
	const documents: any[] = [];
	const sessions = new Map<string, any>();
	const providers = new Map<string, any>();
	const selectors: any[] = [];
	const opened: Array<(document: any) => void> = [];
	const changed: Array<(event: any) => void> = [];
	const closed: Array<(document: any) => void> = [];
	const subscriptions: Array<{ dispose(): void }> = [];
	class Position {
		constructor(public line: number, public character: number) {}
	}
	class Range {
		start: Position;
		end: Position;
		constructor(a: number | Position, b: number | Position, c?: number, d?: number) {
			this.start = typeof a === 'number' ? new Position(a, b as number) : a;
			this.end = typeof a === 'number' ? new Position(c!, d!) : b as Position;
		}
		contains(other: Range) {
			return this.start.line <= other.start.line && this.end.line >= other.end.line;
		}
	}
	const uri = (scheme: string, authority: string, pathname: string, fsPath = pathname) => ({
		scheme, authority, path: pathname, fsPath,
		toString: () => `${scheme}://${authority}${pathname}`,
	});
	const Uri = {
		file: (filePath: string) => uri('file', '', filePath, filePath),
		parse: (value: string) => {
			const parsed = new URL(value);
			return uri(parsed.protocol.slice(0, -1), parsed.host, decodeURIComponent(parsed.pathname));
		},
	};
	class MarkdownString {
		value: string;
		constructor(value = '') { this.value = value; }
		appendMarkdown(value: string) { this.value += value; return this; }
		appendCodeblock(value: string) { this.value += `\n${value}\n`; return this; }
	}
	const namedValues = new Proxy({}, { get: (_target, key) => key });
	const vscode: any = {
		Uri, Range, Position, MarkdownString,
		Location: class { constructor(public uri: unknown, public range: Range) {} },
		Hover: class { constructor(public contents: unknown, public range: Range) {} },
		DocumentSymbol: class { children: unknown[] = []; constructor(public name: string, public detail: string, public kind: unknown, public range: Range, public selectionRange: Range) {} },
		FoldingRange: class { constructor(public start: number, public end: number, public kind: unknown) {} },
		SignatureHelp: class {},
		SignatureInformation: class { constructor(public label: string) {} },
		ParameterInformation: class { constructor(public label: string | number[], public documentation: unknown) {} },
		CompletionItem: class { constructor(public label: string, public kind: unknown) {} },
		SnippetString: class { constructor(public value: string) {} },
		EvaluatableExpression: class { constructor(public range: Range, public expression: string) {} },
		SymbolKind: namedValues, CompletionItemKind: namedValues, FoldingRangeKind: namedValues,
		workspace: {
			textDocuments: documents,
			getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
			getWorkspaceFolder: () => undefined,
			findFiles: () => { throw new Error('원격 언어 기능은 작업공간을 탐색하면 안 된다'); },
			fs: { readFile: async (resource: { fsPath: string }) => fs.readFileSync(resource.fsPath) },
			onDidOpenTextDocument: (callback: any) => { opened.push(callback); return { dispose() {} }; },
			onDidChangeTextDocument: (callback: any) => { changed.push(callback); return { dispose() {} }; },
			onDidCloseTextDocument: (callback: any) => { closed.push(callback); return { dispose() {} }; },
			openTextDocument: async (filePath: string) => documents.find(doc => doc.backing === filePath),
		},
		debug: {},
		languages: {},
		window: {
			showInformationMessage: async (...args: unknown[]) => { notices.push(args); return pickAnswer; },
			showTextDocument: async (target: unknown) => { shown.push(target); },
		},
	};
	// 로컬 프로젝트 매핑 입력 — deploy record(ip|projectName → projectDir)와 작업공간 .gpr 목록(기본 비어 있음).
	const records = new Map<string, { projectDir: string }>();
	const gprPaths: string[] = [];
	const notices: unknown[][] = [];
	const shown: unknown[] = [];
	const logged: string[] = [];
	let pickAnswer: string | undefined;
	for (const [api, kind] of [
		['registerDocumentSymbolProvider', 'symbols'], ['registerFoldingRangeProvider', 'folding'],
		['registerCompletionItemProvider', 'completion'], ['registerDefinitionProvider', 'definition'],
		['registerHoverProvider', 'hover'], ['registerSignatureHelpProvider', 'signature'],
		['registerEvaluatableExpressionProvider', 'evaluatable'],
	]) {
		vscode.languages[api] = (selector: any, provider: any) => {
			selectors.push(selector); providers.set(kind, provider); return { dispose() {} };
		};
	}
	const loaded = new Map<string, { exports: any }>();
	function load(filename: string): any {
		const cached = loaded.get(filename);
		if (cached) { return cached.exports; }
		const module = { exports: {} as any };
		loaded.set(filename, module);
		const realRequire = createRequire(filename);
		vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
			module, exports: module.exports, console, Buffer, setImmediate, process,
			require: (id: string) => {
				if (id === 'vscode') { return vscode; }
				if (id.endsWith('/remoteSourceSession')) {
					return { REMOTE_SOURCE_SCHEME: 'gpl-ftp', getRemoteSourceSession: (key: string) => sessions.get(key) };
				}
				if (id.endsWith('/deployRecord')) {
					return { getCompiledRecord: (ip: string, name: string) => records.get(`${ip}|${name.toLowerCase()}`) };
				}
				if (id.endsWith('/projectFileScope')) {
					return { PROJECT_EXCLUDE_GLOB: '', findWorkspaceGprPaths: async () => [...gprPaths] };
				}
				const resolved = realRequire.resolve(id);
				return id.startsWith('.') && resolved.endsWith('.js') ? load(resolved) : realRequire(id);
			},
		}, { filename });
		return module.exports;
	}
	const activation = load(path.resolve(__dirname, '../activation/controllerSourceLanguage.js'));
	const host = {
		context: { subscriptions }, outputChannel: { appendLine() {} }, log(message: string) { logged.push(message); },
		symbolCache: new Proxy({}, { get: () => { throw new Error('로컬 심볼 캐시와 혼합하면 안 된다'); } }),
	};
	function addDocument(id: string, remotePath: string, content: string, announce = false) {
		let session = sessions.get(id);
		if (!session) {
			const cacheRoot = path.join(root, id);
			session = {
				id, host: '192.0.2.1', root: '/GPL', cacheRoot,
				prepared: new Set<string>(),
				localPath: (remote: string) => path.join(cacheRoot, remote.replace(/^\/+/, '')),
				uri: (remote: string) => `gpl-ftp://${id}${remote}`,
				remotePathFromUri: (value: string) => {
					const parsed = new URL(value);
					return parsed.protocol === 'gpl-ftp:' && parsed.host === id ? decodeURIComponent(parsed.pathname) : undefined;
				},
				remotePathForLocal: (filePath: string) => {
					const relative = path.relative(cacheRoot, filePath);
					return relative.startsWith('..') || path.isAbsolute(relative) ? undefined : `/${relative.split(path.sep).join('/')}`;
				},
				resolveSource: (filePath: string) => {
					const remotePath = session.remotePathForLocal(filePath);
					return session.prepared.has(remotePath) ? { remotePath, localPath: filePath, uri: session.uri(remotePath) } : undefined;
				},
			};
			sessions.set(id, session);
		}
		const backing = session.localPath(remotePath);
		fs.mkdirSync(path.dirname(backing), { recursive: true });
		fs.writeFileSync(backing, content);
		const document: any = {
			uri: Uri.parse(session.uri(remotePath)), backing, version: 1, content,
			get lineCount() { return this.content.split('\n').length; },
			lineAt(line: number | Position) { return { text: this.content.split('\n')[typeof line === 'number' ? line : line.line] }; },
			getText(range?: Range) {
				return range ? this.lineAt(range.start.line).text.slice(range.start.character, range.end.character) : this.content;
			},
			getWordRangeAtPosition(position: Position, pattern = /[A-Za-z_]\w*/) {
				const text = this.lineAt(position.line).text;
				for (const match of text.matchAll(new RegExp(pattern.source, 'g'))) {
					if (position.character >= match.index! && position.character <= match.index! + match[0].length) {
						return new Range(position.line, match.index!, position.line, match.index! + match[0].length);
					}
				}
				return undefined;
			},
		};
		documents.push(document);
		if (announce) { opened.forEach(callback => callback(document)); }
		return document;
	}
	/** 로컬 프로젝트 하나를 만든다 — Project.gpr 와 소스. 작업공간 목록(register)·deploy record(record) 등록은 선택. */
	function addLocalProject(dir: string, projectName: string | undefined, files: Record<string, string>, opts: { register?: boolean; record?: string } = {}) {
		const projectDir = path.join(root, dir);
		fs.mkdirSync(projectDir, { recursive: true });
		const gpr = path.join(projectDir, 'Project.gpr');
		fs.writeFileSync(gpr, `${projectName ? `ProjectName="${projectName}"\n` : ''}${Object.keys(files).map(f => `ProjectSource="${f.replace(/\//g, '\\')}"`).join('\n')}\n`);
		for (const [rel, content] of Object.entries(files)) {
			const full = path.join(projectDir, ...rel.split('/'));
			fs.mkdirSync(path.dirname(full), { recursive: true });
			fs.writeFileSync(full, content);
		}
		if (opts.register !== false) { gprPaths.push(gpr); }
		if (opts.record) { records.set(`192.0.2.1|${opts.record.toLowerCase()}`, { projectDir }); }
		return { projectDir, gpr, file: (rel: string) => path.join(projectDir, ...rel.split('/')) };
	}
	return {
		providers, selectors, sessions, addDocument, documents, addLocalProject, notices, shown,
		answer: (value: string | undefined) => { pickAnswer = value; },
		activate: () => activation.activateControllerSourceLanguage(host),
		change(document: any, content: string) {
			document.content = content; document.version++;
			changed.forEach(callback => callback({ document }));
		},
		close(document: any) {
			const index = documents.indexOf(document);
			if (index >= 0) { documents.splice(index, 1); }
			closed.forEach(callback => callback(document));
		},
		cleanup() { subscriptions.forEach(item => item.dispose()); fs.rmSync(root, { recursive: true, force: true }); },
	};
}

const token = { isCancellationRequested: false };

test('원격 소스 언어: 원격 scheme만 등록하고 작업공간 탐색·수정 provider를 등록하지 않는다', () => {
	const s = fixture();
	try {
		s.activate();
		assert.strictEqual(s.providers.size, 7);
		assert.ok(s.selectors.every(selector => selector.every((entry: any) => entry.scheme === 'gpl-ftp')));
	} finally { s.cleanup(); }
});

test('원격 소스 언어: 다른 연결과 로컬 작업공간의 동명 심볼을 섞지 않는다', async () => {
	const s = fixture();
	try {
		const a = s.addDocument('session-a', '/GPL/Project/Main.gpl', 'Module Main\nPublic Dim result As Integer\nresult = 1\nEnd Module');
		const b = s.addDocument('session-b', '/GPL/Project/Main.gpl', 'Module Main\nPublic Dim result As String\nresult = "b"\nEnd Module');
		s.documents.push({ uri: { scheme: 'file' }, getText: () => { throw new Error('로컬 파일을 읽으면 안 된다'); } });
		s.activate();
		const provider = s.providers.get('hover');
		const hoverA = await provider.provideHover(a, { line: 2, character: 3 }, token);
		const hoverB = await provider.provideHover(b, { line: 2, character: 3 }, token);
		assert.ok(hoverA.contents.value.includes('Integer'));
		assert.ok(!hoverA.contents.value.includes('String'));
		assert.ok(hoverB.contents.value.includes('String'));
		assert.ok(!hoverB.contents.value.includes('Integer'));
	} finally { s.cleanup(); }
});

test('원격 소스 언어: 열어 본 파일의 정의만 찾고 TMP 경로를 원격 URI로 되돌린다', async () => {
	const s = fixture();
	try {
		const main = s.addDocument('session-a', '/GPL/Project/Main.gpl', 'Module Main\nPublic Sub Run()\nLibraryTarget()\nEnd Sub\nEnd Module');
		s.addDocument('session-b', '/GPL/Project/Lib.gpl', 'Module Library\nPublic Sub LibraryTarget()\nEnd Sub\nEnd Module');
		s.activate();
		const provider = s.providers.get('definition');
		assert.strictEqual(await provider.provideDefinition(main, { line: 2, character: 4 }, token), undefined);
		s.addDocument('session-a', '/GPL/Project/Lib.gpl', 'Module Library\nPublic Sub LibraryTarget()\nEnd Sub\nEnd Module', true);
		const definition = await provider.provideDefinition(main, { line: 2, character: 4 }, token);
		assert.strictEqual(definition.uri.toString(), 'gpl-ftp://session-a/GPL/Project/Lib.gpl');
		assert.strictEqual(definition.range.start.line, 1);
		s.sessions.delete('session-a');
		assert.strictEqual(await provider.provideDefinition(main, { line: 2, character: 4 }, token), undefined);
	} finally { s.cleanup(); }
});

test('원격 소스 언어: 문서 개요·접기·시그니처와 프로시저 평가 차단을 재사용한다', async () => {
	const s = fixture();
	try {
		const document = s.addDocument('session-a', '/GPL/Project/Main.gpl', [
			'Module Main', 'Public Function Add(ByVal value As Integer) As Integer', 'Return value',
			'End Function', 'Public Sub Run()', 'Add(', 'End Sub', 'End Module',
		].join('\n'));
		s.activate();
		const symbols = s.providers.get('symbols').provideDocumentSymbols(document, token);
		assert.strictEqual(symbols[0].name, 'Main');
		assert.ok(symbols[0].children.some((symbol: any) => symbol.name === 'Add'));
		const folding = s.providers.get('folding').provideFoldingRanges(document, {}, token);
		assert.ok(folding.some((range: any) => range.start === 1 && range.end >= 2));
		const signature = await s.providers.get('signature').provideSignatureHelp(document, { line: 5, character: 4 }, token, {});
		assert.ok(signature.signatures.some((item: any) => item.label.includes('Add(ByVal value As Integer)')));
		const completions = await s.providers.get('completion').provideCompletionItems(document, { line: 5, character: 4 }, token, {});
		assert.ok(completions.some((item: any) => item.label === 'Add'));
		assert.strictEqual(s.providers.get('evaluatable').provideEvaluatableExpression(document, { line: 5, character: 1 }), undefined);
	} finally { s.cleanup(); }
});

test('원격 소스 언어: 편집기 문서 버전이 바뀌면 원격 심볼을 갱신한다', async () => {
	const s = fixture();
	try {
		const document = s.addDocument('session-a', '/GPL/Project/Main.gpl', 'Module Main\nPublic Dim result As Integer\nresult = 1\nEnd Module');
		s.activate();
		s.change(document, 'Module Main\nPublic Dim result As String\nresult = "new"\nEnd Module');
		const hover = await s.providers.get('hover').provideHover(document, { line: 2, character: 3 }, token);
		assert.ok(hover.contents.value.includes('String'));
		assert.ok(!hover.contents.value.includes('Integer'));
	} finally { s.cleanup(); }
});

test('원격 소스 언어: 같은 URI를 같은 버전으로 다시 열어도 새 문서 내용을 인덱싱한다', async () => {
	const s = fixture();
	try {
		s.addDocument('session-a', '/GPL/Project/Main.gpl', 'Module Main\nPublic Dim result As Integer\nresult = 1\nEnd Module');
		s.activate();
		const reopened = s.addDocument('session-a', '/GPL/Project/Main.gpl', 'Module Main\nPublic Dim result As String\nresult = "new"\nEnd Module', true);
		const hover = await s.providers.get('hover').provideHover(reopened, { line: 2, character: 3 }, token);
		assert.ok(hover.contents.value.includes('String'));
		assert.ok(!hover.contents.value.includes('Integer'));
	} finally { s.cleanup(); }
});

test('원격 소스 언어: 같은 FTP 연결에서 탐색한 서로 다른 프로젝트의 동명 심볼을 격리한다', async () => {
	const s = fixture();
	try {
		s.addDocument('session-a', '/GPL/ProjectA/Lib.gpl', 'Module Helper\nPublic Function Pick() As Integer\nEnd Function\nEnd Module');
		const a = s.addDocument('session-a', '/GPL/ProjectA/Main.gpl', 'Module Main\nPublic Sub Run()\nPick()\nEnd Sub\nEnd Module');
		s.addDocument('session-a', '/GPL/ProjectB/Lib.gpl', 'Module Helper\nPublic Function Pick() As String\nEnd Function\nEnd Module');
		const b = s.addDocument('session-a', '/GPL/ProjectB/Main.gpl', 'Module Main\nPublic Sub Run()\nPick()\nEnd Sub\nEnd Module');
		s.activate();
		const provider = s.providers.get('hover');
		const hoverA = await provider.provideHover(a, { line: 2, character: 2 }, token);
		const hoverB = await provider.provideHover(b, { line: 2, character: 2 }, token);
		assert.ok(hoverA.contents.value.includes('Integer'));
		assert.ok(!hoverA.contents.value.includes('String'));
		assert.ok(hoverB.contents.value.includes('String'));
		assert.ok(!hoverB.contents.value.includes('Integer'));
	} finally { s.cleanup(); }
});

test('원격 소스 언어: Attach로 준비한 프로젝트와 라이브러리는 다른 FTP 분기여도 정의를 공유한다', async () => {
	const s = fixture();
	try {
		const main = s.addDocument('session-a', '/GPL/App/Main.gpl', 'Module Main\nPublic Sub Run()\nLibraryTarget()\nEnd Sub\nEnd Module');
		s.addDocument('session-a', '/GPL/Lib/Core.gpl', 'Module Library\nPublic Sub LibraryTarget()\nEnd Sub\nEnd Module');
		const session = s.sessions.get('session-a');
		session.prepared.add('/GPL/App/Main.gpl');
		session.prepared.add('/GPL/Lib/Core.gpl');
		s.activate();
		const definition = await s.providers.get('definition').provideDefinition(main, { line: 2, character: 4 }, token);
		assert.strictEqual(definition.uri.toString(), 'gpl-ftp://session-a/GPL/Lib/Core.gpl');
	} finally { s.cleanup(); }
});

test('원격 소스 언어: 닫은 문서의 인덱스와 종료된 연결의 참조를 정리한다', async () => {
	const s = fixture();
	try {
		const main = s.addDocument('session-a', '/GPL/App/Main.gpl', 'Module Main\nPublic Sub Run()\nLibraryTarget()\nEnd Sub\nEnd Module');
		const library = s.addDocument('session-a', '/GPL/App/Lib.gpl', 'Module Library\nPublic Sub LibraryTarget()\nEnd Sub\nEnd Module');
		s.activate();
		const provider = s.providers.get('definition');
		assert.ok(await provider.provideDefinition(main, { line: 2, character: 4 }, token));
		s.close(library);
		assert.strictEqual(await provider.provideDefinition(main, { line: 2, character: 4 }, token), undefined);
		// 파일 provider가 먼저 세션을 정리하는 이벤트 순서도 허용한다.
		s.sessions.delete('session-a');
		assert.doesNotThrow(() => s.close(main));
		assert.strictEqual(await provider.provideDefinition(main, { line: 2, character: 4 }, token), undefined);
	} finally { s.cleanup(); }
});

// 2026-10-26 Sample Prep 보고: /GPL/Lib/Motion/Cmd/MotionCmd.gpl 의 `AddressOf MSC.OnErr` 에서 F12 가 안 됨(정의는 같은 파일).
test('원격 소스 언어: 같은 파일 다른 Module 의 멤버(AddressOf MSC.OnErr)로 이동한다', async () => {
	const s = fixture();
	try {
		const document = s.addDocument('session-a', '/GPL/Lib/Motion/Cmd/MotionCmd.gpl', [
			'Module MotionCmd',
			'Public Sub Register(ByVal p As TcpCmdParser)',
			'    p.AddSync("ERR", New TcpSyncCmdSub(AddressOf MSC.OnErr), 0)',
			'End Sub',
			'End Module',
			'',
			'Module MSC',
			'Public Sub OnErr(ByVal code As Integer)',
			'End Sub',
			'End Module',
		].join('\n'));
		s.activate();
		const provider = s.providers.get('definition');
		const onErr = await provider.provideDefinition(document, { line: 2, character: 56 }, token);
		assert.ok(onErr, 'OnErr 정의를 찾아야 한다');
		const location = Array.isArray(onErr) ? onErr[0] : onErr;
		assert.strictEqual(location.uri.toString(), 'gpl-ftp://session-a/GPL/Lib/Motion/Cmd/MotionCmd.gpl');
		assert.strictEqual(location.range.start.line, 7);
		const msc = await provider.provideDefinition(document, { line: 2, character: 51 }, token);
		const mscLocation = Array.isArray(msc) ? msc[0] : msc;
		assert.strictEqual(mscLocation?.range.start.line, 6, 'MSC 모듈 선언으로 이동');
	} finally { s.cleanup(); }
});

/** 비동기 씨앗(로컬 프로젝트 인덱싱)이 끝날 때까지 정의 조회를 되풀이한다. */
async function definitionEventually(provider: any, document: any, position: { line: number; character: number }): Promise<any> {
	for (let i = 0; i < 100; i++) {
		const result = await provider.provideDefinition(document, position, token);
		if (result) { return Array.isArray(result) ? result[0] : result; }
		await new Promise(resolve => setTimeout(resolve, 10));
	}
	return undefined;
}

const MOTION_CMD = [
	'Module MotionCmd',
	'Public Sub Register(ByVal p As TcpCmdParser)',
	'    p.AddSync("ERR", New TcpSyncCmdSub(AddressOf MSC.OnErr), 0)',
	'End Sub',
	'End Module',
].join('\n');
const MSC = 'Module MSC\nPublic Sub OnErr(ByVal code As Integer)\nEnd Sub\nEnd Module\n';

test('원격 소스 언어: 열지 않은 다른 파일의 모듈은 매핑된 로컬 프로젝트(작업공간 ProjectName)에서 찾는다', async () => {
	const s = fixture();
	try {
		const local = s.addLocalProject('ws/task34/Lib', 'Lib', { 'Motion/Cmd/MotionCmd.gpl': MOTION_CMD, 'Motion/Msc.gpl': MSC });
		s.addLocalProject('ws/task37/Other', 'Other', { 'Main.gpl': 'Module MSC\nPublic Sub OnErr()\nEnd Sub\nEnd Module\n' });
		const document = s.addDocument('session-a', '/GPL/Lib/Motion/Cmd/MotionCmd.gpl', MOTION_CMD);
		s.activate();
		const definition = await definitionEventually(s.providers.get('definition'), document, { line: 2, character: 56 });
		assert.ok(definition, '로컬 Msc.gpl 의 정의를 찾아야 한다');
		assert.strictEqual(definition.uri.scheme, 'file');
		assert.strictEqual(path.normalize(definition.uri.fsPath).toLowerCase(), path.normalize(local.file('Motion/Msc.gpl')).toLowerCase());
		assert.strictEqual(definition.range.start.line, 1);
	} finally { s.cleanup(); }
});

test('원격 소스 언어: deploy record 의 출처가 작업공간 동명 프로젝트보다 앞서고, 열어 본 원격 사본이 로컬보다 앞선다', async () => {
	const s = fixture();
	try {
		s.addLocalProject('ws/Lib', 'Lib', { 'Motion/Msc.gpl': 'Module MSC\nPublic Sub OnErr()\nEnd Sub\nEnd Module\n' });
		const recorded = s.addLocalProject('deployed/Lib', 'Lib', { 'Motion/Cmd/MotionCmd.gpl': MOTION_CMD, 'Motion/Msc.gpl': `' recorded\n${MSC}` }, { register: false, record: 'Lib' });
		const document = s.addDocument('session-a', '/GPL/Lib/Motion/Cmd/MotionCmd.gpl', MOTION_CMD);
		s.activate();
		const provider = s.providers.get('definition');
		const viaRecord = await definitionEventually(provider, document, { line: 2, character: 56 });
		assert.strictEqual(path.normalize(viaRecord.uri.fsPath).toLowerCase(), path.normalize(recorded.file('Motion/Msc.gpl')).toLowerCase());
		assert.strictEqual(viaRecord.range.start.line, 2, "' recorded 주석 뒤의 선언");
		// 같은 파일을 원격에서 열면 그 사본(같은 파일 점수)이 로컬보다 앞선다 — 제어기에 올라간 내용이 정본이다.
		s.addDocument('session-a', '/GPL/Lib/Motion/Msc.gpl', MSC, true);
		const viaRemote = await definitionEventually(provider, document, { line: 2, character: 56 });
		assert.strictEqual(viaRemote.uri.toString(), 'gpl-ftp://session-a/GPL/Lib/Motion/Msc.gpl');
		assert.strictEqual(viaRemote.range.start.line, 1);
	} finally { s.cleanup(); }
});

test('원격 소스 언어: 원격 사본이 로컬 파일과 다르면 열 때 한 번 알리고 「로컬 열기」로 로컬을 연다', async () => {
	const s = fixture();
	try {
		const local = s.addLocalProject('ws/Lib', 'Lib', { 'Motion/Cmd/MotionCmd.gpl': MOTION_CMD.replace('"ERR"', '"ERROR"'), 'Motion/Msc.gpl': MSC });
		s.activate();
		s.answer('로컬 열기');
		s.addDocument('session-a', '/GPL/Lib/Motion/Msc.gpl', `${MSC}\r\n`, true);
		s.addDocument('session-a', '/GPL/Lib/Motion/Cmd/MotionCmd.gpl', MOTION_CMD, true);
		for (let i = 0; i < 100 && s.shown.length === 0; i++) { await new Promise(resolve => setTimeout(resolve, 10)); }
		assert.strictEqual(s.notices.length, 1, '내용이 같은 Msc.gpl 은 알리지 않고 다른 MotionCmd.gpl 만 알린다');
		assert.match(String(s.notices[0][0]), /MotionCmd\.gpl 이 로컬 .*MotionCmd\.gpl 과 다릅니다/);
		assert.strictEqual(path.normalize((s.shown[0] as any).fsPath).toLowerCase(), path.normalize(local.file('Motion/Cmd/MotionCmd.gpl')).toLowerCase());
	} finally { s.cleanup(); }
});
