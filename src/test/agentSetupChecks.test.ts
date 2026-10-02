import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from './harness';
import {
	GUIDE_BEGIN, GUIDE_END, GUIDE_VERSION_MARK, GUIDE_SETUP_MARK, GUIDE_TOPIC,
	GuideSetup, inspectWorkspaceSetup, isControllerHost, projectCandidatesInRoot,
} from '../ai/agentSetupChecks';
import { TargetCandidate, resolveProjectTarget } from '../controller/projectTarget';

const VERSION = '0.9.11';

function guide(setup: GuideSetup, version = VERSION): string {
	return [GUIDE_BEGIN, `${GUIDE_VERSION_MARK} ${version} -->`, `${GUIDE_SETUP_MARK}${JSON.stringify(setup)} -->`, GUIDE_TOPIC, GUIDE_END].join('\n');
}

function fixture(fn: (root: string, script: string, candidates: TargetCandidate[], setup: GuideSetup) => void): void {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-ai-setup-test-'));
	const script = path.join(root, 'server.cjs');
	const dir = path.join(root, 'Binder', 'GenAdp');
	const setup = { ip: '192.168.0.1', port: 1402, projectName: 'GenAdp', projectDir: dir };
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(script, '');
	writeEntry(root, { type: 'stdio', command: 'node', args: [script], env: {
		GPL_HOST: setup.ip, GPL_PORT: String(setup.port), GPL_PROJECT: setup.projectName, GPL_PROJECT_DIR: dir,
	} });
	fs.writeFileSync(path.join(root, 'CLAUDE.md'), guide(setup));
	try { fn(root, script, [{ dir, projectName: 'GenAdp', runnable: true }], setup); }
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

test('AI Setup: 정상 설정은 폴더 대상과 안내를 함께 확인한다', () => fixture((root, script, candidates) => {
	const report = inspectWorkspaceSetup(root, script, VERSION, candidates);
	assert.deepStrictEqual(report.problems, []);
	assert.deepStrictEqual(report.warnings, []);
	assert.strictEqual(report.target.status, 'confirmed');
	assert.strictEqual(report.mcpJson.pointsToStableCopy, true);
}));

test('AI Setup: 여러 실행 프로젝트와 중첩 라이브러리에서 임의 대상을 고르지 않는다', () => fixture((root, script, candidates, setup) => {
	candidates.push({ dir: path.join(root, 'Dilution', 'MergeCode'), projectName: 'MergeCode', runnable: true });
	candidates.push({ dir: path.join(candidates[0].dir, 'Lib_Net', 'Server'), projectName: 'Lib_NetServer', runnable: false });
	assert.strictEqual(resolveProjectTarget(undefined, candidates).ok, false);
	const pinned = resolveProjectTarget(undefined, candidates, { sessionTargetDir: candidates[0].dir });
	assert.ok(pinned.ok && pinned.projectName === 'GenAdp');
	mutateEntry(root, entry => { entry.env.GPL_PROJECT = ''; entry.env.GPL_PROJECT_DIR = ''; });
	fs.writeFileSync(path.join(root, 'CLAUDE.md'), guide({ ip: setup.ip, port: setup.port }));
	const report = inspectWorkspaceSetup(root, script, VERSION, candidates);
	assert.deepStrictEqual(report.problems, []);
	assert.strictEqual(report.target.status, 'unresolved');
}));

test('AI Setup: 동명 프로젝트는 이름만으로 확정하지 않고 폴더로 구분한다', () => fixture((root, script, _candidates, setup) => {
	const candidates = ['Antibody', 'Binder', 'Dilution'].map(folder => ({ dir: path.join(root, folder, 'MergeCode'), projectName: 'MergeCode', runnable: true }));
	mutateEntry(root, entry => { entry.env.GPL_PROJECT = 'MergeCode'; delete entry.env.GPL_PROJECT_DIR; });
	fs.writeFileSync(path.join(root, 'CLAUDE.md'), guide({ ...setup, projectName: 'MergeCode', projectDir: undefined }));
	let report = inspectWorkspaceSetup(root, script, VERSION, candidates);
	assert.strictEqual(report.target.status, 'unresolved');
	assert.ok(report.target.resolution && !report.target.resolution.ok && report.target.resolution.error === 'PROJECT_AMBIGUOUS');
	mutateEntry(root, entry => { entry.env.GPL_PROJECT_DIR = candidates[2].dir; });
	report = inspectWorkspaceSetup(root, script, VERSION, candidates);
	assert.ok(report.target.resolution?.ok && report.target.resolution.dir === candidates[2].dir);
}));

test('AI Setup: args 누락과 잘못된 실행 파일은 설정 오류다', () => fixture((root, script, candidates) => {
	mutateEntry(root, entry => { entry.args = []; entry.command = 'not-a-node-launcher'; });
	const report = inspectWorkspaceSetup(root, script, VERSION, candidates);
	assert.ok(report.problems.some(p => p.includes('args[0]')));
	assert.ok(report.problems.some(p => p.includes('command')));
}));

test('AI Setup: IP·호스트 이름과 포트 형식을 검증한다', () => fixture((root, script, candidates) => {
	mutateEntry(root, entry => { entry.env.GPL_HOST = '999.1.2.3'; entry.env.GPL_PORT = '1402extra'; });
	const report = inspectWorkspaceSetup(root, script, VERSION, candidates);
	assert.ok(report.problems.some(p => p.includes('GPL_HOST')));
	assert.ok(report.problems.some(p => p.includes('GPL_PORT')));
	for (const host of ['localhost', 'robot.local', '192.168.0.1', '::1']) { assert.ok(isControllerHost(host)); }
	for (const host of ['', '999.1.2.3', '-robot', 'robot:1402', 'robot host']) { assert.strictEqual(isControllerHost(host), false); }
}));

test('AI Setup: 존재하지 않는 프로젝트는 작업 대상 미확정이다', () => fixture((root, script, candidates) => {
	mutateEntry(root, entry => { entry.env.GPL_PROJECT = 'Missing'; delete entry.env.GPL_PROJECT_DIR; });
	const report = inspectWorkspaceSetup(root, script, VERSION, candidates);
	assert.strictEqual(report.target.status, 'unresolved');
	assert.ok(report.target.resolution && !report.target.resolution.ok && report.target.resolution.error === 'PROJECT_NOT_FOUND');
}));

test('AI Setup: 폴더와 ProjectName이 다르면 설정 오류다', () => fixture((root, script, candidates) => {
	mutateEntry(root, entry => { entry.env.GPL_PROJECT = 'Other'; });
	assert.ok(inspectWorkspaceSetup(root, script, VERSION, candidates).problems.some(p => p.includes('ProjectName')));
}));

test('AI Setup: CLAUDE 안내가 없거나 블록이 잘렸으면 정상으로 통과하지 않는다', () => fixture((root, script, candidates) => {
	fs.unlinkSync(path.join(root, 'CLAUDE.md'));
	assert.ok(inspectWorkspaceSetup(root, script, VERSION, candidates).problems.some(p => p.includes('안내 없음')));
	fs.writeFileSync(path.join(root, 'CLAUDE.md'), GUIDE_BEGIN);
	assert.ok(inspectWorkspaceSetup(root, script, VERSION, candidates).problems.some(p => p.includes('시작/끝')));
}));

test('AI Setup: 같은 버전의 안내도 주소·이름·폴더가 다르면 알린다', () => fixture((root, script, candidates, setup) => {
	fs.writeFileSync(path.join(root, 'CLAUDE.md'), guide({ ...setup, ip: '192.168.0.2', projectName: 'Other', projectDir: path.join(root, 'Other') }));
	const report = inspectWorkspaceSetup(root, script, VERSION, candidates);
	assert.strictEqual(report.warnings.length, 3);
}));

test('AI Setup: AGENTS의 구버전 기본 프로젝트 충돌을 검출한다', () => fixture((root, script, candidates) => {
	fs.writeFileSync(path.join(root, 'AGENTS.md'), `${GUIDE_BEGIN}\n${GUIDE_VERSION_MARK} 0.9.8 -->\n${GUIDE_TOPIC}\n기본 프로젝트는 \`Lib_NetServer\`(도구의 project 인자 생략 시 사용).\n${GUIDE_END}`);
	const report = inspectWorkspaceSetup(root, script, VERSION, candidates);
	assert.ok(report.warnings.some(p => p.includes('AGENTS.md') && p.includes('구버전')));
	assert.ok(report.warnings.some(p => p.includes('Lib_NetServer') && p.includes('GenAdp')));
}));

test('AI Setup: 수동 안내는 검사 결과로 알리고 보존한다', () => fixture((root, script, candidates) => {
	const text = `## 7. ${GUIDE_TOPIC}\n직접 작성한 규칙`;
	fs.writeFileSync(path.join(root, 'CLAUDE.md'), text);
	const report = inspectWorkspaceSetup(root, script, VERSION, candidates);
	assert.deepStrictEqual(report.problems, []);
	assert.ok(report.warnings.some(p => p.includes('수동 안내')));
	assert.strictEqual(fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'), text);
}));

test('AI Setup: root 기준 상대 경로를 검사하고 multi-root의 다른 후보를 섞지 않는다', () => fixture((root, script, candidates) => {
	mutateEntry(root, entry => { entry.args = ['./server.cjs']; entry.env.GPL_PROJECT_DIR = path.relative(root, candidates[0].dir); });
	const foreign = { dir: `${root}-other/GenAdp`, projectName: 'GenAdp', runnable: true };
	assert.deepStrictEqual(projectCandidatesInRoot([...candidates, foreign], root), candidates);
	assert.strictEqual(inspectWorkspaceSetup(root, script, VERSION, [...candidates, foreign]).target.status, 'confirmed');
}));

test('AI Setup: root가 없으면 현재 프로세스 폴더의 설정을 읽지 않는다', () => {
	const report = inspectWorkspaceSetup(undefined, 'missing.cjs', VERSION, []);
	assert.strictEqual(report.mcpJson.exists, false);
	assert.strictEqual(report.claudeMd.exists, false);
	assert.ok(report.problems.length > 0);
});
