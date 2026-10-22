import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vm from 'vm';
import { test } from './harness';
import type { TargetCandidate } from '../controller/projectTarget';
import { GUIDE_BEGIN, GUIDE_END, GUIDE_VERSION_MARK, GUIDE_TOPIC } from '../ai/agentSetupChecks';

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
		root, second, candidates, host, folders, log, write, vscode,
		/** 명령 모듈과 같은 인스턴스의 순수 모듈(연결 세션 정본 등)을 얻는다. */
		module: (relative: string) => load(path.resolve(__dirname, relative)),
		read: (file: string) => read(file, 'utf8') as string,
		config: () => JSON.parse(read(path.join(root, '.mcp.json'), 'utf8') as string),
		entry: (folder = root) => JSON.parse(read(path.join(folder, '.mcp.json'), 'utf8') as string).mcpServers['gpl-controller'],
		export: (args: object = {}) => commands.get('gpl.ai.exportAgentSetup')!({ nonInteractive: true, ...args }),
	};
}

test('AI Setup 명령: 프로젝트와 무관하게 브리지 설정만 내보낸다', async () => {
	const env = setup();
	const result = await env.export();
	assert.strictEqual(result.ok, true);
	assert.strictEqual(result.report.settingsOk, true);
	assert.strictEqual(result.report.ready, true);
	assert.strictEqual(env.entry().env.GPL_PROJECT, undefined);
	assert.strictEqual(env.entry().env.GPL_PROJECT_DIR, undefined);
	assert.strictEqual(env.entry().env.GPL_BRIDGE, 'only');
});

test('AI Setup 명령: 세션 대상과 구버전 영구 대상을 저장하지 않는다', async () => {
	const env = setup();
	env.host.sessionTargetDir = env.candidates[0].dir;
	env.write(path.join(env.root, '.mcp.json'), JSON.stringify({ mcpServers: {
		'gpl-controller': { env: { GPL_PROJECT: 'GenAdp', GPL_PROJECT_DIR: env.candidates[0].dir } },
	} }));
	const result = await env.export();
	assert.strictEqual(result.report.ready, true);
	assert.strictEqual(env.entry().env.GPL_PROJECT, undefined);
	assert.strictEqual(env.entry().env.GPL_PROJECT_DIR, undefined);
	assert.strictEqual(env.host.sessionTargetDir, env.candidates[0].dir);
});

test('AI Setup 명령: 다른 MCP 서버를 보존한다', async () => {
	const env = setup();
	env.write(path.join(env.root, '.mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'other-server' } } }));
	const result = await env.export();
	assert.strictEqual(result.report.ready, true);
	assert.strictEqual(env.config().mcpServers.other.command, 'other-server');
});

test('AI Setup 명령: 연결 시 .mcp.json 주소가 다르면 한 번 알리고, Export 재실행이 현재 주소로 다시 쓴다(§1-ES)', async () => {
	const env = setup();
	await env.export();
	assert.strictEqual(env.entry().env.GPL_HOST, '192.168.0.1');
	// 확장이 다른 IP 로 연결된 상황 — Export 시점 값은 .mcp.json 에 그대로 남아 있다.
	env.write(path.join(env.root, '.mcp.json'), env.read(path.join(env.root, '.mcp.json')).replace('"GPL_HOST": "192.168.0.1"', '"GPL_HOST": "192.168.0.102"'));
	const warnings: string[] = [];
	let answer: string | undefined = 'Export 재실행';
	(env.vscode.window as any).showWarningMessage = async (message: string) => { warnings.push(message); return answer; };
	const settle = () => new Promise(resolve => setTimeout(resolve, 20));
	// setup() 마다 새 vm 컨텍스트라 연결 세션 정본도 새 인스턴스(초기 상태 false)다 — reset 은 구독까지 지우므로 부르지 않는다.
	const session = env.module('../controller/connectionSession.js');
	// 이 테스트의 getControllerConfig 는 192.168.0.1 이므로, 지금 연결 주소(.1)와 .mcp.json(.102)이 어긋난 상태다.
	session.setControllerSessionConnected(true);
	await settle();
	assert.strictEqual(warnings.length, 1);
	assert.ok(warnings[0].includes('192.168.0.102:1402') && warnings[0].includes('192.168.0.1:1402'));
	assert.ok(env.log.some(line => line.includes('.mcp.json 제어기 주소 불일치')));
	// Export 재실행이 현재 주소로 다시 썼다.
	assert.strictEqual(env.entry().env.GPL_HOST, '192.168.0.1');
	// 같은 (폴더, 주소)는 다시 연결해도 두 번 알리지 않는다(로그에는 남는다). 해제 에지는 검사하지 않는다.
	answer = undefined;
	env.write(path.join(env.root, '.mcp.json'), env.read(path.join(env.root, '.mcp.json')).replace('"GPL_HOST": "192.168.0.1"', '"GPL_HOST": "192.168.0.102"'));
	session.setControllerSessionConnected(false);
	session.setControllerSessionConnected(true);
	await settle();
	assert.strictEqual(warnings.length, 1);
	// 주소가 같으면 아무 일도 없다.
	await env.export();
	session.setControllerSessionConnected(false);
	session.setControllerSessionConnected(true);
	await settle();
	assert.strictEqual(warnings.length, 1);
});

test('AI Setup 명령: multi-root의 두 번째 폴더에만 내보낸다', async () => {
	const env = setup();
	env.folders.push(env.second);
	const result = await env.export({ workspaceRoot: env.second });
	assert.strictEqual(result.report.workspaceRoot, env.second);
	assert.strictEqual(env.entry(env.second).env.GPL_PROJECT_DIR, undefined);
	assert.throws(() => env.entry());
});

test('AI Setup 명령: Export 실패 후 완료 점검을 남기지 않고 손상 JSON을 보존한다', async () => {
	const env = setup();
	env.write(path.join(env.root, '.mcp.json'), '{ broken');
	const result = await env.export();
	assert.strictEqual(result.ok, false);
	assert.strictEqual(result.error, 'export-failed');
	assert.ok(env.log.every(line => !line.includes('export 후 자동 점검')));
	assert.strictEqual(env.read(path.join(env.root, '.mcp.json')), '{ broken');
});

test('AI Setup 명령: 기존 서버·환경변수·문서 본문과 CRLF를 보존한다', async () => {
	const env = setup();
	env.write(path.join(env.root, '.mcp.json'), JSON.stringify({ mcpServers: {
		'gpl-controller': { env: { GPL_BRIDGE: 'auto', GPL_PROJECT: 'Old', GPL_PROJECT_DIR: 'Old/Path', CUSTOM: 'preserved' } }, other: { command: 'other' },
	} }, null, 2).replace(/\n/g, '\r\n'));
	env.write(path.join(env.root, 'CLAUDE.md'), '# 사용자 규칙\r\n\r\n기존 본문\r\n');
	await env.export();
	assert.strictEqual(env.entry().env.GPL_BRIDGE, 'only');
	assert.strictEqual(env.entry().env.GPL_PROJECT, undefined);
	assert.strictEqual(env.entry().env.GPL_PROJECT_DIR, undefined);
	assert.strictEqual(env.entry().env.CUSTOM, 'preserved');
	assert.strictEqual(env.config().mcpServers.other.command, 'other');
	const text = env.read(path.join(env.root, 'CLAUDE.md'));
	assert.ok(text.startsWith('# 사용자 규칙\r\n\r\n기존 본문\r\n'));
	assert.strictEqual(/(^|[^\r])\n/.test(text), false);
	assert.strictEqual(/(^|[^\r])\n/.test(env.read(path.join(env.root, '.mcp.json'))), false);
});

test('AI Setup 명령: 기존 AGENTS 자동 블록을 갱신하고 과거 기본 프로젝트 문구를 제거한다', async () => {
	const env = setup();
	const agents = [
		'# 사용자 지침',
		'',
		GUIDE_BEGIN,
		`${GUIDE_VERSION_MARK} 0.9.8 -->`,
		GUIDE_TOPIC,
		'기본 프로젝트는 `Lib_NetServer`.',
		GUIDE_END,
		'',
		'나머지 지침',
	].join('\r\n');
	env.write(path.join(env.root, 'AGENTS.md'), agents);
	const result = await env.export();
	const updated = env.read(path.join(env.root, 'AGENTS.md'));
	assert.ok(result.written.some((p: string) => p.includes('AGENTS.md')));
	assert.ok(updated.includes(`${GUIDE_VERSION_MARK} 0.9.11 -->`));
	assert.ok(updated.includes('기본 프로젝트를 설정이나 파일에 저장하지 않는다'));
	assert.ok(!updated.includes('Lib_NetServer'));
	assert.ok(updated.startsWith('# 사용자 지침\r\n\r\n'));
	assert.ok(updated.endsWith('\r\n\r\n나머지 지침'));
	assert.strictEqual(/(^|[^\r])\n/.test(updated), false);
});
