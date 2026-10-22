import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from './harness';
import {
	GUIDE_BEGIN, GUIDE_END, GUIDE_VERSION_MARK, GUIDE_SETUP_MARK, GUIDE_TOPIC,
	GuideSetup, inspectWorkspaceSetup, isControllerHost, findMcpHostMismatch, readMcpControllerAddress,
	SHARED_CONTROLLER_BRIDGE_MODE,
} from '../ai/agentSetupChecks';

const VERSION = '0.9.11';

function guide(setup: GuideSetup, version = VERSION): string {
	return [GUIDE_BEGIN, `${GUIDE_VERSION_MARK} ${version} -->`, `${GUIDE_SETUP_MARK}${JSON.stringify(setup)} -->`, GUIDE_TOPIC, GUIDE_END].join('\n');
}

function fixture(fn: (root: string, script: string, setup: GuideSetup) => void): void {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-ai-setup-test-'));
	const script = path.join(root, 'server.cjs');
	const setup = { ip: '192.168.0.1', port: 1402 };
	fs.writeFileSync(script, '');
	writeEntry(root, { type: 'stdio', command: 'node', args: [script], env: {
		GPL_BRIDGE: SHARED_CONTROLLER_BRIDGE_MODE,
		GPL_HOST: setup.ip, GPL_PORT: String(setup.port),
	} });
	fs.writeFileSync(path.join(root, 'CLAUDE.md'), guide(setup));
	try { fn(root, script, setup); }
	finally {
		assert.strictEqual(path.dirname(root), path.resolve(os.tmpdir()));
		assert.ok(path.basename(root).startsWith('gpl-ai-setup-test-'));
		fs.rmSync(root, { recursive: true, force: true });
	}
}

function writeEntry(root: string, entry: unknown): void {
	fs.writeFileSync(path.join(root, '.mcp.json'), JSON.stringify({ mcpServers: { 'gpl-controller': entry } }));
}

function mutateEntry(root: string, fn: (entry: { command: string; args: string[]; env: Record<string, string> }) => void): void {
	const file = path.join(root, '.mcp.json');
	const config = JSON.parse(fs.readFileSync(file, 'utf8'));
	fn(config.mcpServers['gpl-controller']);
	fs.writeFileSync(file, JSON.stringify(config));
}

test('AI Setup: 정상 설정은 브리지·주소·안내를 함께 확인한다', () => fixture((root, script) => {
	const report = inspectWorkspaceSetup(root, script, VERSION);
	assert.deepStrictEqual(report.problems, []);
	assert.deepStrictEqual(report.warnings, []);
	assert.strictEqual(report.mcpJson.pointsToStableCopy, true);
	assert.strictEqual(report.mcpJson.bridgeMode, SHARED_CONTROLLER_BRIDGE_MODE);
}));

test('AI Setup: 브리지 전용이 아니면 VS Code와 AI의 단일 세션 공유 설정으로 보지 않는다', () => fixture((root, script) => {
	for (const mode of [undefined, 'auto', 'off']) {
		mutateEntry(root, entry => {
			if (mode === undefined) { delete entry.env.GPL_BRIDGE; }
			else { entry.env.GPL_BRIDGE = mode; }
		});
		const report = inspectWorkspaceSetup(root, script, VERSION);
		assert.ok(report.problems.some(p => p.includes('GPL_BRIDGE') && p.includes('Export 재실행')));
	}
	mutateEntry(root, entry => { entry.env.GPL_BRIDGE = ' ONLY '; });
	assert.strictEqual(inspectWorkspaceSetup(root, script, VERSION).problems.length, 0);
}));

test('AI Setup: 구버전 영구 프로젝트 환경변수는 제거 대상으로 알린다', () => fixture((root, script) => {
	mutateEntry(root, entry => {
		entry.env.GPL_PROJECT = 'Lib_NetServer';
		entry.env.GPL_PROJECT_DIR = 'Binder/GenAdp/Lib_Net/Server';
	});
	const report = inspectWorkspaceSetup(root, script, VERSION);
	assert.ok(report.problems.some(p => p.includes('GPL_PROJECT/GPL_PROJECT_DIR') && p.includes('Export 재실행')));
}));

test('AI Setup: args 누락과 잘못된 실행 파일은 설정 오류다', () => fixture((root, script) => {
	mutateEntry(root, entry => { entry.args = []; entry.command = 'not-a-node-launcher'; });
	const report = inspectWorkspaceSetup(root, script, VERSION);
	assert.ok(report.problems.some(p => p.includes('args[0]')));
	assert.ok(report.problems.some(p => p.includes('command')));
}));

test('AI Setup: IP·호스트 이름과 포트 형식을 검증한다', () => fixture((root, script) => {
	mutateEntry(root, entry => { entry.env.GPL_HOST = '999.1.2.3'; entry.env.GPL_PORT = '1402extra'; });
	const report = inspectWorkspaceSetup(root, script, VERSION);
	assert.ok(report.problems.some(p => p.includes('GPL_HOST')));
	assert.ok(report.problems.some(p => p.includes('GPL_PORT')));
	for (const host of ['localhost', 'robot.local', '192.168.0.1', '::1']) { assert.ok(isControllerHost(host)); }
	for (const host of ['', '999.1.2.3', '-robot', 'robot:1402', 'robot host']) { assert.strictEqual(isControllerHost(host), false); }
}));

test('AI Setup: .mcp.json 의 제어기 주소가 현재 연결과 다르면 설정 문제로 알린다(§1-ES)', () => fixture((root, script, setup) => {
	const same = inspectWorkspaceSetup(root, script, VERSION, { currentController: { ip: setup.ip, port: setup.port } });
	assert.strictEqual(same.problems.length, 0);
	assert.strictEqual(findMcpHostMismatch(root, { ip: setup.ip, port: setup.port }), undefined);
	const current = { ip: '192.168.0.102', port: 1402 };
	const report = inspectWorkspaceSetup(root, script, VERSION, { currentController: current });
	assert.ok(report.problems.some(p => p.includes('GPL_HOST(192.168.0.1:1402)') && p.includes('192.168.0.102:1402')));
	const mismatch = findMcpHostMismatch(root, current);
	assert.deepStrictEqual(mismatch?.configured, { host: '192.168.0.1', port: 1402 });
	assert.strictEqual(mismatch?.path, path.join(root, '.mcp.json'));
	assert.strictEqual(inspectWorkspaceSetup(root, script, VERSION).problems.length, 0);
	mutateEntry(root, entry => { entry.env.GPL_HOST = '999.1.2.3'; });
	assert.strictEqual(findMcpHostMismatch(root, current), undefined);
	fs.unlinkSync(path.join(root, '.mcp.json'));
	assert.strictEqual(readMcpControllerAddress(root), undefined);
	assert.strictEqual(findMcpHostMismatch(root, current), undefined);
}));

test('AI Setup: CLAUDE 안내가 없거나 블록이 잘렸으면 정상으로 통과하지 않는다', () => fixture((root, script) => {
	fs.unlinkSync(path.join(root, 'CLAUDE.md'));
	assert.ok(inspectWorkspaceSetup(root, script, VERSION).problems.some(p => p.includes('안내 없음')));
	fs.writeFileSync(path.join(root, 'CLAUDE.md'), GUIDE_BEGIN);
	assert.ok(inspectWorkspaceSetup(root, script, VERSION).problems.some(p => p.includes('시작/끝')));
}));

test('AI Setup: 같은 버전의 안내도 제어기 주소가 다르면 알린다', () => fixture((root, script, setup) => {
	fs.writeFileSync(path.join(root, 'CLAUDE.md'), guide({ ...setup, ip: '192.168.0.2' }));
	const report = inspectWorkspaceSetup(root, script, VERSION);
	assert.strictEqual(report.warnings.length, 1);
	assert.ok(report.warnings[0].includes('제어기 주소'));
}));

test('AI Setup: AGENTS의 구버전 자동 안내를 검출하되 과거 기본 프로젝트는 비교하지 않는다', () => fixture((root, script) => {
	fs.writeFileSync(path.join(root, 'AGENTS.md'), `${GUIDE_BEGIN}\n${GUIDE_VERSION_MARK} 0.9.8 -->\n${GUIDE_TOPIC}\n기본 프로젝트는 \`Lib_NetServer\`.\n${GUIDE_END}`);
	const report = inspectWorkspaceSetup(root, script, VERSION);
	assert.strictEqual(report.warnings.length, 1);
	assert.ok(report.warnings[0].includes('AGENTS.md') && report.warnings[0].includes('구버전'));
}));

test('AI Setup: 수동 안내는 검사 결과로 알리고 보존한다', () => fixture((root, script) => {
	const text = `## 7. ${GUIDE_TOPIC}\n직접 작성한 규칙`;
	fs.writeFileSync(path.join(root, 'CLAUDE.md'), text);
	const report = inspectWorkspaceSetup(root, script, VERSION);
	assert.deepStrictEqual(report.problems, []);
	assert.ok(report.warnings.some(p => p.includes('수동 안내')));
	assert.strictEqual(fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'), text);
}));

test('AI Setup: 서버 상대 경로는 워크스페이스 root 기준으로 검사한다', () => fixture((root, script) => {
	mutateEntry(root, entry => { entry.args = ['./server.cjs']; });
	assert.strictEqual(inspectWorkspaceSetup(root, script, VERSION).mcpJson.pointsToStableCopy, true);
}));

test('AI Setup: root가 없으면 현재 프로세스 폴더의 설정을 읽지 않는다', () => {
	const report = inspectWorkspaceSetup(undefined, 'missing.cjs', VERSION);
	assert.strictEqual(report.mcpJson.exists, false);
	assert.strictEqual(report.claudeMd.exists, false);
	assert.ok(report.problems.length > 0);
});
