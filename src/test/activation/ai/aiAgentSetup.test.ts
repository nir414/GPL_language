import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vm from 'vm';
import { test } from '../../harness';
import { GUIDE_BEGIN, GUIDE_END, GUIDE_VERSION_MARK, LEGACY_GUIDE_FILE_HEADER } from '../../../controller/automation/agentSetupChecks';

/** vm 컨텍스트에서 만든 배열·객체는 프로토타입이 달라 deepStrictEqual 이 실패한다 — 값만 비교한다. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

interface SetupOptions {
	/** 1 = Production(활성화 시 자동 등록이 돈다), 2 = Development */
	extensionMode?: number;
	registration?: 'prompt' | 'auto' | 'off';
	claudeCli?: 'ok' | 'missing';
	codexInstalled?: boolean;
	claudeConfig?: object | null;
	files?: Record<string, string>;
}

/** 실제 명령 모듈을 실행하되 VS Code·파일·claude CLI 는 메모리 안으로 한정한다(홈 설정을 건드리지 않는다). */
function setup(opts: SetupOptions = {}) {
	const root = path.join(os.tmpdir(), 'gpl-ai-setup-virtual');
	const home = path.join(root, 'home');
	const claudeDir = path.join(home, 'claude');
	const codexHome = path.join(home, '.codex');
	const claudeJson = path.join(claudeDir, '.claude.json');
	const codexToml = path.join(codexHome, 'config.toml');
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
		unlinkSync: (file: string) => { if (!files.delete(key(file))) { throw new Error(`ENOENT ${file}`); } },
	};
	const cliCalls: string[][] = [];
	const childProcess = {
		execFile: (cmd: string, args: string[], _o: unknown, cb: (err: unknown, stdout: string, stderr: string) => void) => {
			assert.strictEqual(cmd, 'claude');
			cliCalls.push(args);
			if (opts.claudeCli === 'missing') { cb(Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }), '', ''); return; }
			// 실제 CLI 처럼 user scope(최상위 mcpServers)를 고친다.
			const config = files.has(key(claudeJson)) ? JSON.parse(read(claudeJson, 'utf8') as string) : {};
			config.mcpServers = config.mcpServers ?? {};
			if (args[1] === 'remove') { delete config.mcpServers[args[2]]; }
			if (args[1] === 'add-json') { config.mcpServers[args[2]] = JSON.parse(args[3]); }
			write(claudeJson, JSON.stringify(config, null, 2));
			cb(null, 'ok', '');
		},
	};
	const commands = new Map<string, (args?: unknown) => Promise<any>>();
	const log: string[] = [];
	const info: string[] = [];
	const answers: Array<string | undefined> = [];
	const folders = [root];
	const memento = () => { const m = new Map<string, unknown>(); return { get: (k: string, d?: unknown) => m.has(k) ? m.get(k) : d, update: async (k: string, v: unknown) => { m.set(k, v); } }; };
	const vscode = {
		ExtensionMode: { Production: 1, Development: 2 },
		workspace: {
			get workspaceFolders() { return folders.map(fsPath => ({ uri: { fsPath } })); },
			getConfiguration: () => ({ get: (name: string, d?: unknown) => name === 'autoRefreshMcpBundle' ? false : name === 'mcpRegistration' ? (opts.registration ?? d) : d }),
		},
		window: {
			showInformationMessage: async (m: string) => { info.push(m); return answers.shift(); },
			showWarningMessage: async (m: string) => { info.push(m); return answers.shift(); },
			showErrorMessage: async () => undefined,
		},
		env: { clipboard: { writeText: async () => undefined } },
		commands: {
			registerCommand: (name: string, fn: (args?: unknown) => Promise<any>) => { commands.set(name, fn); return { dispose: () => undefined }; },
			executeCommand: (name: string, args?: unknown) => commands.get(name)!(args),
		},
	};
	const context = {
		subscriptions: [], extension: { packageJSON: { version: '0.27.7' } }, extensionMode: opts.extensionMode ?? 2,
		asAbsolutePath: (file: string) => path.join(root, 'extension', file),
		globalStorageUri: { fsPath: path.join(root, 'storage') },
		globalState: memento(), workspaceState: memento(),
	};
	const stable = path.join(root, 'storage', 'mcp', 'gpl-controller-mcp.cjs');
	write(context.asAbsolutePath('out/mcp/gpl-controller-mcp.cjs'), 'MCP test bundle');
	if (opts.claudeConfig !== null) { write(claudeJson, JSON.stringify(opts.claudeConfig ?? { numStartups: 1 })); }
	if (opts.codexInstalled) { write(codexHome, ''); }
	for (const [name, text] of Object.entries(opts.files ?? {})) { write(path.join(root, name), text); }
	const host = { context, outputChannel: { show: () => undefined }, log: (message: string) => log.push(message) };
	const cache = new Map<string, { exports: any }>();
	function load(file: string): any {
		if (cache.has(file)) { return cache.get(file)!.exports; }
		const module = { exports: {} };
		cache.set(file, module);
		const localRequire = (id: string): any => {
			if (id === 'vscode') { return vscode; }
			if (id === 'fs') { return virtualFs; }
			if (id === 'child_process') { return childProcess; }
			if (id.startsWith('.')) { return load(path.resolve(path.dirname(file), `${id}.js`)); }
			return require(id);
		};
		new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file }).runInNewContext({
			require: localRequire, module, exports: module.exports, Buffer, setTimeout,
			process: { ...process, env: { ...process.env, CLAUDE_CONFIG_DIR: claudeDir, CODEX_HOME: codexHome } },
		});
		return module.exports;
	}
	load(path.resolve(__dirname, '../../../activation/ai/aiAgentSetup.js')).activateAiAgentSetup(host);
	const has = (file: string) => files.has(key(file));
	return {
		root, stable, claudeJson, codexToml, cliCalls, log, info, answers, write, has,
		read: (file: string) => read(file, 'utf8') as string,
		claudeEntry: () => JSON.parse(read(claudeJson, 'utf8') as string).mcpServers?.['gpl-controller'],
		run: (name: string, args: object = {}) => commands.get(name)!({ nonInteractive: true, ...args }),
		settle: () => new Promise(resolve => setTimeout(resolve, 30)),
	};
}

test('AI MCP 등록: Claude Code 사용자 범위에 주소 없이 등록하고 워크스페이스에는 아무 파일도 만들지 않는다', async () => {
	const env = setup();
	const result = await env.run('gpl.ai.exportAgentSetup');
	assert.strictEqual(result.ok, true);
	assert.strictEqual(result.claude.action, 'registered');
	assert.deepStrictEqual(env.claudeEntry(), { type: 'stdio', command: 'node', args: [env.stable], env: { GPL_BRIDGE: 'only' } });
	assert.deepStrictEqual(plain(env.cliCalls.map(a => a.slice(0, 3))), [['mcp', 'add-json', 'gpl-controller']]);
	assert.ok(env.cliCalls[0].includes('user'));
	assert.ok(env.has(env.stable), '안정 사본 복사');
	for (const name of ['.mcp.json', 'CLAUDE.md', 'AGENTS.md']) { assert.strictEqual(env.has(path.join(env.root, name)), false, name); }
	assert.strictEqual(result.report.claude.state, 'current');
	assert.strictEqual(result.report.ok, true);
	// 다시 실행하면 아무것도 하지 않는다.
	const again = await env.run('gpl.ai.exportAgentSetup');
	assert.strictEqual(again.claude.action, 'unchanged');
	assert.strictEqual(env.cliCalls.length, 1);
});

test('AI MCP 등록: 확장 사본을 가리키는 옛 형식(GPL_HOST 고정)은 지우고 다시 등록한다', async () => {
	const stablePath = path.join(os.tmpdir(), 'gpl-ai-setup-virtual', 'storage', 'mcp', 'gpl-controller-mcp.cjs');
	const env = setup({ claudeConfig: { mcpServers: { 'gpl-controller': { type: 'stdio', command: 'node', args: [stablePath], env: { GPL_BRIDGE: 'only', GPL_HOST: '192.168.0.1', GPL_PORT: '1402' } }, other: { command: 'x' } } } });
	const result = await env.run('gpl.ai.exportAgentSetup');
	assert.strictEqual(result.claude.action, 'updated');
	assert.deepStrictEqual(plain(env.cliCalls.map(a => a[1])), ['remove', 'add-json']);
	assert.strictEqual(env.claudeEntry().env.GPL_HOST, undefined);
	assert.strictEqual(JSON.parse(env.read(env.claudeJson)).mcpServers.other.command, 'x', '다른 서버 보존');
});

test('AI MCP 등록: 직접 등록한(다른 파일) 항목은 묻지 않고 건드리지 않는다 — replaceForeign 일 때만 바꾼다', async () => {
	const dev = 'C:\\dev\\controller-mcp\\src\\index.js';
	const env = setup({ claudeConfig: { mcpServers: { 'gpl-controller': { command: 'node', args: [dev], env: { GPL_HOST: '192.168.0.1' } } } } });
	const kept = await env.run('gpl.ai.exportAgentSetup');
	assert.strictEqual(kept.claude.action, 'kept-foreign');
	assert.strictEqual(env.cliCalls.length, 0);
	assert.strictEqual(env.claudeEntry().args[0], dev);
	assert.strictEqual(kept.report.ok, true, '직접 등록도 쓸 수 있는 등록이다');
	const replaced = await env.run('gpl.ai.exportAgentSetup', { replaceForeign: true });
	assert.strictEqual(replaced.claude.action, 'updated');
	assert.strictEqual(env.claudeEntry().args[0], env.stable);
});

test('AI MCP 등록: claude CLI 가 없으면 설정 파일을 직접 고치지 않고 실행할 명령을 돌려준다', async () => {
	const env = setup({ claudeCli: 'missing' });
	const result = await env.run('gpl.ai.exportAgentSetup');
	assert.strictEqual(result.claude.action, 'cli-missing');
	assert.match(result.claude.manualCommand, /^claude mcp add-json gpl-controller '.*' --scope user$/);
	assert.strictEqual(env.claudeEntry(), undefined);
});

test('AI MCP 등록: Codex 가 설치돼 있으면 config.toml 에도 등록하고, 없으면 만들지 않는다', async () => {
	const without = setup();
	await without.run('gpl.ai.exportAgentSetup');
	assert.strictEqual(without.has(without.codexToml), false);
	const env = setup({ codexInstalled: true });
	env.write(env.codexToml, '[features]\r\nx = true\r\n');
	const result = await env.run('gpl.ai.exportAgentSetup');
	assert.strictEqual(result.codex.action, 'registered');
	const toml = env.read(env.codexToml);
	assert.ok(toml.startsWith('[features]\r\nx = true\r\n\r\n[mcp_servers.gpl-controller]\r\n'));
	assert.ok(toml.includes(`args = ['${env.stable}']`));
	assert.strictEqual(result.report.codex.state, 'current');
});

test('예전 파일 정리: 확장이 만든 항목만 지우고 사용자 본문·다른 서버는 보존한다', async () => {
	const block = [GUIDE_BEGIN, `${GUIDE_VERSION_MARK} 0.20.0 -->`, '본문', GUIDE_END].join('\r\n');
	const env = setup({ files: {
		'.mcp.json': JSON.stringify({ mcpServers: { 'gpl-controller': { command: 'node' } } }),
		'CLAUDE.md': `${LEGACY_GUIDE_FILE_HEADER}\r\n\r\n${block}\r\n`,
		'AGENTS.md': `# 내 지침\r\n\r\n${block}\r\n\r\n나머지\r\n`,
	} });
	const report = await env.run('gpl.ai.checkAgentSetup');
	assert.strictEqual(report.legacyWorkspaceFiles.length, 3);
	const result = await env.run('gpl.ai.cleanWorkspaceAgentSetup');
	assert.strictEqual(result.ok, true);
	assert.deepStrictEqual(plain(result.cleaned.map((c: { action: string }) => c.action)), ['deleted', 'deleted', 'edited']);
	assert.strictEqual(env.has(path.join(env.root, '.mcp.json')), false);
	assert.strictEqual(env.has(path.join(env.root, 'CLAUDE.md')), false);
	assert.strictEqual(env.read(path.join(env.root, 'AGENTS.md')), '# 내 지침\r\n\r\n나머지\r\n');
	assert.strictEqual((await env.run('gpl.ai.checkAgentSetup')).legacyWorkspaceFiles.length, 0);
});

test('활성화 자동 동기화(auto): 미등록이면 등록하고, 예전 워크스페이스 파일 정리를 한 번 제안한다', async () => {
	const env = setup({ extensionMode: 1, registration: 'auto', files: { '.mcp.json': JSON.stringify({ mcpServers: { 'gpl-controller': {} } }) } });
	await env.settle();
	assert.strictEqual(env.claudeEntry().args[0], env.stable);
	assert.ok(env.info.some(m => m.includes('Claude Code: 등록함')));
	assert.ok(env.info.some(m => m.includes('예전 「Export AI Agent Setup」이 만든 파일이 1개')));
	// 답하지 않았으므로 파일은 그대로다.
	assert.strictEqual(env.has(path.join(env.root, '.mcp.json')), true);
});

test('활성화 자동 동기화(prompt·off·개발 호스트): 묻기만 하거나 아무것도 쓰지 않는다', async () => {
	const prompt = setup({ extensionMode: 1, registration: 'prompt' });
	await prompt.settle();
	assert.strictEqual(prompt.claudeEntry(), undefined);
	assert.ok(prompt.info.some(m => m.includes('사용자 설정에 한 번 등록할까요')));
	const off = setup({ extensionMode: 1, registration: 'off' });
	await off.settle();
	assert.deepStrictEqual([off.info.length, off.cliCalls.length], [0, 0]);
	const dev = setup({ extensionMode: 2, registration: 'auto' });
	await dev.settle();
	assert.deepStrictEqual([dev.info.length, dev.cliCalls.length], [0, 0]);
	// Claude Code 흔적(설정 파일)이 없으면 제안하지 않는다.
	const none = setup({ extensionMode: 1, registration: 'prompt', claudeConfig: null });
	await none.settle();
	assert.strictEqual(none.info.length, 0);
});
