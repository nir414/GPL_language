import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vm from 'vm';
import { test } from './harness';
import type { TargetCandidate } from '../controller/projectTarget';

/** 실제 명령을 실행하되 VS Code와 파일 쓰기는 메모리 안으로 한정한다. */
function setup() {
	const root = path.join(os.tmpdir(), 'gpl-ai-setup-virtual');
	const second = `${root}-second`;
	const candidates: TargetCandidate[] = [
		{ dir: path.join(root, 'Binder', 'GenAdp'), projectName: 'GenAdp', runnable: true },
		{ dir: path.join(root, 'Dilution', 'MergeCode'), projectName: 'MergeCode', runnable: true },
		{ dir: path.join(root, 'Antibody', 'MergeCode'), projectName: 'MergeCode', runnable: true },
		{ dir: path.join(root, 'Binder', 'GenAdp', 'Lib_Net', 'Server'), projectName: 'Lib_NetServer', runnable: false },
	];
	const files = new Map<string, Buffer>();
	const key = (file: string) => path.resolve(file).toLowerCase();
	const write = (file: string, value: string | Buffer) => { files.set(key(file), Buffer.from(value)); };
	const read = (file: string, encoding?: unknown) => {
		const data = files.get(key(file));
		if (!data) { throw new Error(`가상 파일 없음: ${file}`); }
		return encoding ? data.toString('utf8') : data;
	};
	const virtualFs = {
		existsSync: (file: string) => files.has(key(file)), readFileSync: read, writeFileSync: write,
		mkdirSync: () => undefined, copyFileSync: (src: string, dest: string) => write(dest, read(src) as Buffer),
		unlinkSync: (file: string) => { files.delete(key(file)); },
	};
	const commands = new Map<string, (args?: unknown) => Promise<any>>();
	const log: string[] = [];
	const folders = [root];
	const vscode = {
		ExtensionMode: { Development: 2 },
		Uri: { file: (fsPath: string) => ({ scheme: 'file', fsPath }) },
		workspace: {
			get workspaceFolders() { return folders.map(fsPath => ({ uri: { fsPath } })); },
			getWorkspaceFolder: (uri: { fsPath: string }) => {
				const folder = folders.find(f => uri.fsPath === f || uri.fsPath.startsWith(f + path.sep));
				return folder ? { uri: { fsPath: folder } } : undefined;
			},
			getConfiguration: () => ({ get: (name: string) => name === 'autoRefreshMcpBundle' ? false : undefined }),
		},
		window: {
			activeTextEditor: { document: { uri: { scheme: 'file', fsPath: path.join(candidates[3].dir, 'Server.gpl') } } },
			showInformationMessage: async () => undefined, showWarningMessage: async () => undefined,
			showErrorMessage: async () => undefined,
			showWorkspaceFolderPick: () => { throw new Error('비대화형 작업에서 폴더 선택 UI 발생'); },
		},
		commands: {
			registerCommand: (name: string, fn: (args?: unknown) => Promise<any>) => { commands.set(name, fn); return { dispose: () => undefined }; },
			executeCommand: (name: string, args?: unknown) => commands.get(name)!(args),
		},
	};
	const context = {
		subscriptions: [], extension: { packageJSON: { version: '0.9.11' } }, extensionMode: 2,
		asAbsolutePath: (file: string) => path.join(root, 'extension', file),
		globalStorageUri: { fsPath: path.join(root, 'storage') },
	};
	write(context.asAbsolutePath('out/mcp/gpl-controller-mcp.cjs'), 'MCP test bundle');
	const host = { context, sessionTargetDir: undefined as string | undefined, outputChannel: { show: () => undefined }, log: (message: string) => log.push(message) };
	const cache = new Map<string, { exports: any }>();
	function load(file: string): any {
		if (cache.has(file)) { return cache.get(file)!.exports; }
		const module = { exports: {} };
		cache.set(file, module);
		const localRequire = (id: string): any => {
			if (id === 'vscode') { return vscode; }
			if (id === 'fs') { return virtualFs; }
			if (id.endsWith('/controllerConnection')) { return { getControllerConfig: () => ({ ip: '192.168.0.1', port: 1402 }) }; }
			if (id.endsWith('/projectPicker')) { return { buildTargetCandidates: async () => candidates }; }
			if (id.startsWith('.')) { return load(path.resolve(path.dirname(file), `${id}.js`)); }
			return require(id);
		};
		new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file }).runInNewContext({
			require: localRequire, module, exports: module.exports, process, Buffer,
		});
		return module.exports;
	}
	load(path.resolve(__dirname, '../activation/aiAgentSetup.js')).activateAiAgentSetup(host);
	return {
		root, second, candidates, host, folders, log, write,
		read: (file: string) => read(file, 'utf8') as string,
		config: () => JSON.parse(read(path.join(root, '.mcp.json'), 'utf8') as string),
		entry: (folder = root) => JSON.parse(read(path.join(folder, '.mcp.json'), 'utf8') as string).mcpServers['gpl-controller'],
		export: (args: object = {}) => commands.get('gpl.ai.exportAgentSetup')!({ nonInteractive: true, ...args }),
	};
}

test('AI Setup 명령: 라이브러리 파일이 열려 있어도 다중 프로젝트를 임의로 선택하지 않는다', async () => {
	const env = setup();
	const result = await env.export();
	assert.strictEqual(result.ok, true);
	assert.strictEqual(result.report.settingsOk, true);
	assert.strictEqual(result.report.ready, false);
	assert.strictEqual(result.report.target.status, 'unresolved');
	assert.strictEqual(env.entry().env.GPL_PROJECT, '');
	assert.strictEqual(env.entry().env.GPL_PROJECT_DIR, '');
});

test('AI Setup 명령: 세션 폴더를 유지하고 재실행도 저장한 폴더를 유지한다', async () => {
	const env = setup();
	env.host.sessionTargetDir = env.candidates[0].dir;
	const result = await env.export();
	assert.strictEqual(result.report.ready, true);
	assert.strictEqual(env.entry().env.GPL_PROJECT, 'GenAdp');
	env.host.sessionTargetDir = undefined;
	await env.export();
	assert.strictEqual(env.entry().env.GPL_PROJECT_DIR, env.candidates[0].dir);
});

test('AI Setup 명령: 명시한 동명 프로젝트 폴더를 저장하고 다른 MCP 서버를 보존한다', async () => {
	const env = setup();
	env.write(path.join(env.root, '.mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'other-server' } } }));
	const result = await env.export({ projectDir: env.candidates[1].dir });
	assert.strictEqual(result.report.target.resolution.dir, env.candidates[1].dir);
	assert.strictEqual(env.entry().env.GPL_PROJECT, 'MergeCode');
	assert.strictEqual(env.entry().env.GPL_PROJECT_DIR, env.candidates[1].dir);
	assert.strictEqual(env.config().mcpServers.other.command, 'other-server');
});

test('AI Setup 명령: multi-root의 두 번째 폴더에만 내보낸다', async () => {
	const env = setup();
	env.folders.push(env.second);
	const dir = path.join(env.second, 'GenAdp');
	env.candidates.push({ dir, projectName: 'GenAdp', runnable: true });
	const result = await env.export({ projectDir: dir });
	assert.strictEqual(result.report.workspaceRoot, env.second);
	assert.strictEqual(env.entry(env.second).env.GPL_PROJECT_DIR, dir);
	assert.throws(() => env.entry());
});

test('AI Setup 명령: Export 실패 후 완료 점검을 남기지 않고 손상 JSON을 보존한다', async () => {
	const env = setup();
	env.write(path.join(env.root, '.mcp.json'), '{ broken');
	const result = await env.export({ projectDir: env.candidates[0].dir });
	assert.strictEqual(result.ok, false);
	assert.strictEqual(result.error, 'export-failed');
	assert.ok(env.log.every(line => !line.includes('export 후 자동 점검')));
	assert.strictEqual(env.read(path.join(env.root, '.mcp.json')), '{ broken');
});

test('AI Setup 명령: 기존 서버·환경변수·문서 본문과 CRLF를 보존한다', async () => {
	const env = setup();
	env.write(path.join(env.root, '.mcp.json'), JSON.stringify({ mcpServers: {
		'gpl-controller': { env: { GPL_BRIDGE: 'only', CUSTOM: 'preserved' } }, other: { command: 'other' },
	} }, null, 2).replace(/\n/g, '\r\n'));
	env.write(path.join(env.root, 'CLAUDE.md'), '# 사용자 규칙\r\n\r\n기존 본문\r\n');
	await env.export({ projectDir: env.candidates[0].dir });
	assert.strictEqual(env.entry().env.GPL_BRIDGE, 'only');
	assert.strictEqual(env.entry().env.CUSTOM, 'preserved');
	assert.strictEqual(env.config().mcpServers.other.command, 'other');
	const text = env.read(path.join(env.root, 'CLAUDE.md'));
	assert.ok(text.startsWith('# 사용자 규칙\r\n\r\n기존 본문\r\n'));
	assert.strictEqual(/(^|[^\r])\n/.test(text), false);
	assert.strictEqual(/(^|[^\r])\n/.test(env.read(path.join(env.root, '.mcp.json'))), false);
});
