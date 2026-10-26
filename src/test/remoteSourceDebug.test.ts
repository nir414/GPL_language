/** 원격 URI의 실제 DAP 소스/BP 경로를 모의 FTP·명령 콘솔로 확인한다. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vm from 'vm';
import { createRequire } from 'module';
import { parseBreakpointCommand } from '../controller/debugging/breakpointCommand';
import { test } from './harness';

const SUCCESS = '<STATUS>0,"Success"</STATUS>';

function fixture(sources = ['Main.gpl', 'Sub/Space Name.gpl']) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-remote-dap-'));
	const cacheRoot = path.join(root, 'cache');
	const localPath = (remote: string) => path.join(cacheRoot, ...remote.split('/').filter(Boolean));
	const uri = (remote: string) => `gpl-ftp://test-session${remote.split('/').map(part => encodeURIComponent(part)).join('/')}`;
	const files = sources.map(file => {
		const remotePath = `/GPL/Probe/${file}`;
		return { remotePath, localPath: localPath(remotePath), uri: uri(remotePath) };
	});
	const projectDir = localPath('/GPL/Probe');
	fs.mkdirSync(projectDir, { recursive: true });
	const gprPath = path.join(projectDir, 'Project.gpr');
	fs.writeFileSync(gprPath, 'ProjectName="Probe"\n' + sources.map(file => `ProjectSource="${file}"\n`).join(''));
	const copy = path.join(root, 'workspace');
	fs.mkdirSync(copy);
	fs.writeFileSync(path.join(copy, 'Project.gpr'), 'ProjectName="Probe"\nProjectSource="Other.gpl"\n');
	fs.writeFileSync(path.join(copy, 'Other.gpl'), 'Module Other\nEnd Module\n');
	const project = { projectName: 'Probe', projectDir, gprPath, remotePath: '/GPL/Probe', sourcePaths: files.map(file => file.localPath), unresolvedLibraries: [] };
	const reads: string[] = [];
	const commands: string[] = [];
	const errors: any[] = [];
	const responses: any[] = [];
	let failReads = false;
	let prepareCalls = 0;
	const remote = {
		id: 'test-session', host: '192.0.2.1', root: '/GPL', cacheRoot,
		uri, localPath,
		remotePathForLocal(file: string): string | undefined {
			const relative = path.relative(cacheRoot, file);
			return relative.startsWith('..') || path.isAbsolute(relative) ? undefined : `/${relative.split(path.sep).join('/')}`;
		},
		resolveSource(file: string) {
			const direct = files.find(candidate => candidate.localPath === file || candidate.remotePath === file || candidate.uri === file);
			if (direct) { return direct; }
			if (/^[a-z][a-z0-9+.-]*:/i.test(file) || path.isAbsolute(file)) { return undefined; }
			const normalized = file.replace(/\\/g, '/').toLowerCase();
			const matches = files.filter(candidate => candidate.remotePath.toLowerCase().endsWith(`/${normalized}`));
			return matches.length === 1 ? matches[0] : undefined;
		},
		async ensureSource(file: string) {
			const source = this.resolveSource(file);
			if (!source) { return undefined; }
			if (failReads) { throw new Error('FTP read failed'); }
			if (!fs.existsSync(source.localPath)) {
				reads.push(source.remotePath);
				fs.mkdirSync(path.dirname(source.localPath), { recursive: true });
				fs.writeFileSync(source.localPath, 'Module Main\nPublic Sub Main()\nDim value As Integer = 1\nEnd Sub\nEnd Module\n');
			}
			return source;
		},
		async prepareProject() { prepareCalls++; return project; },
	};
	const disposable = () => ({ dispose() {} });
	const config = { ip: remote.host, port: 1402, consolePort: 1403, timeoutMs: 10000 };
	const vscode = {
		workspace: {
			workspaceFolders: [{ uri: { fsPath: copy } }],
			getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
			onDidSaveTextDocument: disposable,
		},
		window: { showWarningMessage: () => { throw new Error('원격 Attach에서 Start 확인을 요청하면 안 된다'); } },
	};
	const filename = path.resolve(__dirname, '../debug/gplDebugSession.js');
	const realRequire = createRequire(filename);
	const module = { exports: {} as any };
	vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
		module, exports: module.exports, console, setTimeout, clearTimeout, setInterval, clearInterval, Buffer,
		require: (id: string) => {
			if (id === 'vscode') { return vscode; }
			if (id.endsWith('/remoteSourceSession')) { return { getRemoteSourceSession: (sessionId: string) => sessionId === remote.id ? remote : undefined }; }
			if (id.endsWith('/controllerConnection')) {
				return { getControllerConfig: () => config, getConnectionProbeTimeoutMs: () => 1000, sendCommand: async (command: string) => { commands.push(command); return SUCCESS; } };
			}
			if (id.endsWith('/deployService')) { return {}; }
			if (id.endsWith('/deployRecord')) { return { onDidRecordCompiled: disposable }; }
			if (id.endsWith('/debugBridge')) { return { onDebugPollTrigger: disposable }; }
			return realRequire(id);
		},
	}, { filename });
	const session = new module.exports.GPLDebugSession();
	session._log = () => {};
	session.sendEvent = () => {};
	session.sendResponse = (response: unknown) => responses.push(response);
	session.sendErrorResponse = (_response: unknown, error: unknown) => errors.push(error);
	session._evaluateSourceStaleness = () => {};
	session._startPolling = () => {};
	session._fastPoll = () => {};
	session._setLockedThread = () => {};
	session._clientSideBpLogicEnabled = () => false;
	const breakpoints = new Map<string, Set<number>>();
	session._sendCmd = async (command: string) => {
		commands.push(command);
		const bp = parseBreakpointCommand(command);
		if (bp) {
			const lines = breakpoints.get(bp.file) ?? new Set<number>();
			if (bp.kind === 'Break') { lines.add(bp.line); } else { lines.delete(bp.line); }
			breakpoints.set(bp.file, lines);
		}
		if (command !== 'Show Break') { return SUCCESS; }
		return `<DATA>${[...breakpoints].flatMap(([file, lines]) => [...lines].map(line => `1, Probe, Main, 1, ${file}, ${line}, 0`)).join('\n')}</DATA>${SUCCESS}`;
	};
	const args = { controllerIp: config.ip, controllerPort: config.port, projectName: project.projectName, projectDir, remoteSourceSessionId: remote.id };
	return {
		session, args, files, project, remote, reads, commands, errors, responses, copy,
		failReads: () => { failReads = true; },
		prepareCalls: () => prepareCalls,
		dispose: () => fs.rmSync(root, { recursive: true, force: true }),
	};
}

test('remote DAP: workspace 밖 미다운로드 소스를 선언만으로 매핑하고 Attach는 상태를 바꾸지 않는다', async () => {
	const s = fixture();
	try {
		await s.session.attachRequest({}, { ...s.args, deployBeforeAttach: true, startOnAttach: true, stopOnEntry: true, stopAllBeforeAttach: true, clearProjectBreakpointsOnAttach: true, stopAllOnDisconnect: true });
		await s.session.configurationDoneRequest({}, {});
		assert.strictEqual(s.errors.length, 0);
		assert.strictEqual(s.prepareCalls(), 1);
		assert.strictEqual(s.reads.length, 0);
		assert.strictEqual(s.session._resolveSourcePath('Main.gpl'), s.files[0].localPath);
		assert.strictEqual(fs.existsSync(s.files[0].localPath), false);
		assert.strictEqual(s.session._resolveSourcePath('Other.gpl'), '');
		assert.strictEqual(s.session._sourceMapWidened, false);
		await s.session.disconnectRequest({}, {});
		assert.deepStrictEqual(s.commands, ['ErrorLog', 'Show Break']);
	} finally { s.dispose(); }
});

test('remote DAP: 스택 소스는 필요한 파일만 받고 임시 경로 대신 원격 URI로 표시한다', async () => {
	const s = fixture();
	try {
		await s.session.attachRequest({}, s.args);
		s.session._threadIdToName.set(1, 'Probe.Main');
		s.session._getThreadFrames = async () => [
			{ file: 'Main.gpl', fileLine: 3, process: 'Main', frameIndex: 0 },
			{ file: 'Other.gpl', fileLine: 2, process: 'Other', frameIndex: 1 },
		];
		const response: any = {};
		await s.session.stackTraceRequest(response, { threadId: 1 });
		assert.deepStrictEqual(s.reads, ['/GPL/Probe/Main.gpl']);
		assert.strictEqual(response.body.stackFrames[0].source.path, s.files[0].uri);
		assert.strictEqual(response.body.stackFrames[1].source, undefined);
		assert.strictEqual(fs.existsSync(s.files[1].localPath), false);
	} finally { s.dispose(); }
});

test('remote DAP: URI BP는 해당 소스만 내려받아 기존 ProjectSource 명령 표기로 보낸다', async () => {
	const s = fixture();
	try {
		await s.session.attachRequest({}, s.args);
		const response: any = {};
		await s.session.setBreakPointsRequest(response, { source: { path: s.files[1].uri }, lines: [3] });
		assert.deepStrictEqual(s.reads, ['/GPL/Probe/Sub/Space Name.gpl']);
		assert.strictEqual(response.body.breakpoints[0].verified, true);
		assert.strictEqual(response.body.breakpoints[0].source.path, s.files[1].uri);
		assert.ok(s.commands.includes('Set Break Probe "Sub\\Space Name.gpl"3'));
		assert.strictEqual(fs.existsSync(s.files[0].localPath), false);
	} finally { s.dispose(); }
});

test('remote DAP: FTP 실패·다른 세션 URI·동명 모호성은 제어기 BP 명령을 보내지 않는다', async () => {
	const s = fixture(['A/Main.gpl', 'B/Main.gpl']);
	try {
		await s.session.attachRequest({}, s.args);
		assert.strictEqual(s.session._resolveSourcePath('Main.gpl'), '');
		assert.strictEqual(s.session._resolveSourcePath('A\\Main.gpl'), s.files[0].localPath);
		const before = s.commands.length;
		for (const source of ['Main.gpl', s.files[0].uri.replace('test-session', 'another-session')]) {
			const response: any = {};
			await s.session.setBreakPointsRequest(response, { source: { path: source }, lines: [3] });
			assert.strictEqual(response.body.breakpoints[0].verified, false);
		}
		s.failReads();
		const failed: any = {};
		await s.session.setBreakPointsRequest(failed, { source: { path: s.files[0].uri }, lines: [3] });
		assert.strictEqual(failed.body.breakpoints[0].verified, false);
		assert.match(failed.body.breakpoints[0].message, /FTP read failed/);
		assert.strictEqual(s.commands.length, before);
	} finally { s.dispose(); }
});

test('remote DAP: 만료된 세션·제어기 불일치·프로젝트 불일치는 통신 전에 중단한다', async () => {
	for (const change of [{ remoteSourceSessionId: 'expired' }, { controllerIp: '192.0.2.2' }, { projectName: 'Another' }]) {
		const s = fixture();
		try {
			await s.session.attachRequest({}, { ...s.args, ...change });
			assert.strictEqual(s.errors.length, 1);
			assert.strictEqual(s.commands.length, 0);
		} finally { s.dispose(); }
	}
});

test('remote DAP: BP 위치 힌트도 URI를 해석해 필요한 소스만 읽는다', async () => {
	const s = fixture();
	try {
		await s.session.attachRequest({}, s.args);
		const before = s.commands.length;
		const response: any = {};
		await s.session.breakpointLocationsRequest(response, { source: { path: s.files[0].uri }, line: 1, endLine: 5 });
		assert.ok(response.body.breakpoints.some((bp: { line: number }) => bp.line === 3));
		assert.deepStrictEqual(s.reads, ['/GPL/Probe/Main.gpl']);
		assert.strictEqual(s.commands.length, before);
	} finally { s.dispose(); }
});

test('remote DAP: 미로딩 함수명 BP는 파일을 받거나 이전 BP를 해제하지 않고 이유를 알린다', async () => {
	const s = fixture();
	try {
		await s.session.attachRequest({}, s.args);
		const previous = [{ name: 'Previous', file: 'Main.gpl', line: 3, id: 1 }];
		s.session._functionBps = previous;
		const before = s.commands.length;
		const response: any = {};
		await s.session.setFunctionBreakPointsRequest(response, { breakpoints: [{ name: 'Main' }] });
		assert.strictEqual(response.body.breakpoints[0].verified, false);
		assert.match(response.body.breakpoints[0].message, /해당 파일을 먼저 열고/);
		assert.strictEqual(s.commands.length, before);
		assert.strictEqual(s.reads.length, 0);
		assert.strictEqual(s.session._functionBps, previous);
	} finally { s.dispose(); }
});

test('remote DAP: 캐시에 있는 유일한 직접 소스의 함수명 BP는 원격 URI로 응답한다', async () => {
	const s = fixture();
	try {
		await s.session.attachRequest({}, s.args);
		await s.remote.ensureSource(s.files[0].remotePath);
		const response: any = {};
		await s.session.setFunctionBreakPointsRequest(response, { breakpoints: [{ name: 'Main.Main' }] });
		assert.strictEqual(response.body.breakpoints[0].verified, true);
		assert.strictEqual(response.body.breakpoints[0].source.path, s.files[0].uri);
		assert.deepStrictEqual(s.reads, ['/GPL/Probe/Main.gpl']);
	} finally { s.dispose(); }
});

test('remote DAP: FTP 소스를 기다리는 중 분리되면 늦게 완료된 BP 요청을 전송하지 않는다', async () => {
	const s = fixture();
	try {
		await s.session.attachRequest({}, s.args);
		const ensure = s.remote.ensureSource.bind(s.remote);
		let resume!: () => void;
		s.remote.ensureSource = async file => {
			await new Promise<void>(resolve => { resume = resolve; });
			return ensure(file);
		};
		const response: any = {};
		const request = s.session.setBreakPointsRequest(response, { source: { path: s.files[0].uri }, lines: [3] });
		await s.session.disconnectRequest({}, {});
		resume();
		await request;
		assert.strictEqual(response.body.breakpoints[0].verified, false);
		assert.match(response.body.breakpoints[0].message, /세션이 종료/);
		assert.deepStrictEqual(s.commands, ['ErrorLog', 'Show Break']);
	} finally { s.dispose(); }
});

test('remote DAP: 비디버깅 에디터 BP 동기화는 원격 URI를 로컬 동명 파일로 보내지 않는다', async () => {
	const sent: string[] = [];
	let resolved = 0;
	class SourceBreakpoint {
		enabled = true;
		constructor(public location: any) {}
	}
	const remote = new SourceBreakpoint({ uri: { scheme: 'gpl-ftp', fsPath: '/GPL/Probe/Main.gpl' }, range: { start: { line: 2 } } });
	const vscode = {
		SourceBreakpoint,
		debug: { breakpoints: [remote], onDidChangeBreakpoints: () => ({ dispose() {} }) },
		workspace: { getConfiguration: () => ({ get: () => true }) },
	};
	const filename = path.resolve(__dirname, '../controller/debugging/breakpointSync.js');
	const actualRequire = createRequire(filename), module = { exports: {} as any };
	vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports,
		require: (id: string) => id === 'vscode' ? vscode : id.endsWith('/controllerConnection')
			? { sendCommand: async (command: string) => { sent.push(command); return '<STATUS>0,"Success"</STATUS>'; } }
			: actualRequire(id),
	}, { filename });
	const sync = new module.exports.EditorBreakpointSync({
		isConnected: () => true, isDebugSessionActive: () => false,
		resolveProjectName: async () => 'Probe', log() {},
		resolveTarget: () => { resolved++; return { kind: 'direct-source', file: 'Main.gpl', line: 3 }; },
	});
	try {
		assert.strictEqual(module.exports.editorBreakpointTargets().length, 0);
		const result = await sync.pushAll();
		assert.strictEqual(result.sent, 0);
		assert.strictEqual(resolved, 0);
		assert.deepStrictEqual(sent, []);
		vscode.debug.breakpoints = [new SourceBreakpoint({ uri: { scheme: 'file', fsPath: path.resolve('Probe/Main.gpl') }, range: { start: { line: 2 } } })];
		assert.strictEqual(module.exports.editorBreakpointTargets().length, 1, '일반 로컬 에디터 BP는 계속 지원한다');
	} finally { sync.dispose(); }
});
