import * as assert from 'assert';
import { test } from '../../harness';
import {
	GUIDE_BEGIN, GUIDE_END, GUIDE_VERSION_MARK, LEGACY_GUIDE_FILE_HEADER, MCP_SERVER_NAME,
	classifyEntry, classifyClaudeUserConfig, classifyCodexConfig, desiredMcpEntry, readCodexEntry,
	upsertCodexServer, stripMcpJsonEntry, stripGuideBlock,
} from '../../../controller/automation/agentSetupChecks';

const STABLE = 'C:\\Users\\me\\AppData\\Roaming\\Code\\User\\globalStorage\\nir414.gpl-language-support\\mcp\\gpl-controller-mcp.cjs';
const DEV = 'C:\\Users\\me\\Documents\\GitHub\\GPL_language\\controller-mcp\\src\\index.js';

test('MCP 등록 항목: 주소·프로젝트를 적지 않고 브리지 전용으로만 만든다', () => {
	const entry = desiredMcpEntry(STABLE);
	assert.deepStrictEqual(entry, { type: 'stdio', command: 'node', args: [STABLE], env: { GPL_BRIDGE: 'only' } });
	assert.strictEqual(classifyEntry(entry, STABLE).state, 'current');
});

test('MCP 등록 판정: 없음·옛 형식(우리 것)·다른 파일(직접 등록)을 가른다', () => {
	assert.strictEqual(classifyEntry(undefined, STABLE).state, 'absent');
	// 경로 대소문자·구분자 차이는 같은 파일이다.
	assert.strictEqual(classifyEntry({ command: 'node.exe', args: [STABLE.toLowerCase().replace(/\\/g, '/')], env: { GPL_BRIDGE: 'only' } }, STABLE).state, 'current');
	const legacy = classifyEntry({ type: 'stdio', command: 'node', args: [STABLE], env: { GPL_BRIDGE: 'only', GPL_HOST: '192.168.0.1', GPL_PORT: '1402' } }, STABLE);
	assert.strictEqual(legacy.state, 'outdated');
	assert.match(legacy.detail ?? '', /GPL_HOST\/GPL_PORT/);
	assert.strictEqual(classifyEntry({ command: 'node', args: [STABLE], env: { GPL_BRIDGE: 'auto' } }, STABLE).state, 'outdated');
	const foreign = classifyEntry({ command: 'node', args: [DEV], env: { GPL_HOST: '192.168.0.1' } }, STABLE);
	assert.deepStrictEqual([foreign.state, foreign.script], ['foreign', DEV]);
});

test('Claude 사용자 설정: user scope 의 mcpServers 만 보고, 깨진 JSON 은 unreadable', () => {
	assert.strictEqual(classifyClaudeUserConfig(undefined, STABLE).state, 'absent');
	assert.strictEqual(classifyClaudeUserConfig('{ broken', STABLE).state, 'unreadable');
	// 프로젝트별(projects[...].mcpServers) 항목은 사용자 범위 등록이 아니다.
	const projectOnly = JSON.stringify({ projects: { 'C:/x': { mcpServers: { [MCP_SERVER_NAME]: desiredMcpEntry(STABLE) } } } });
	assert.strictEqual(classifyClaudeUserConfig(projectOnly, STABLE).state, 'absent');
	const user = JSON.stringify({ numStartups: 3, mcpServers: { [MCP_SERVER_NAME]: desiredMcpEntry(STABLE) } });
	assert.strictEqual(classifyClaudeUserConfig(user, STABLE).state, 'current');
});

const CODEX_SAMPLE = [
	'[features]',
	'x = true',
	'',
	'[mcp_servers.node_repl]',
	"command = 'C:\\tools\\node_repl.exe'",
	'',
	'[mcp_servers.gpl-controller]',
	'enabled = true',
	'command = "node"',
	`args = ['${DEV}']`,
	'',
	'[mcp_servers.gpl-controller.env]',
	'GPL_PORT = "1402"',
	'GPL_HOST = "192.168.0.1"',
	'',
	'[memories]',
	'use_memories = true',
	'',
].join('\r\n');

test('Codex config.toml: 우리 테이블의 command·args·env 를 읽는다(literal/basic 문자열, 하위 env 테이블·인라인 테이블)', () => {
	const entry = readCodexEntry(CODEX_SAMPLE)!;
	assert.deepStrictEqual(entry.args, [DEV]);
	assert.strictEqual(entry.command, 'node');
	assert.deepStrictEqual(entry.env, { GPL_PORT: '1402', GPL_HOST: '192.168.0.1' });
	assert.strictEqual(classifyCodexConfig(CODEX_SAMPLE, STABLE).state, 'foreign');
	const inline = `[mcp_servers."gpl-controller"]\ncommand = "node"\nargs = [\n  "${STABLE.replace(/\\/g, '\\\\')}",\n]\nenv = { GPL_BRIDGE = "only" }\n`;
	assert.strictEqual(classifyCodexConfig(inline, STABLE).state, 'current');
	assert.strictEqual(classifyCodexConfig('[features]\nx = 1\n', STABLE).state, 'absent');
	assert.strictEqual(readCodexEntry('[features]\n'), undefined);
});

test('Codex config.toml 쓰기: 우리 테이블만 그 자리에서 교체하고 다른 줄·CRLF 는 그대로 둔다', () => {
	const next = upsertCodexServer(CODEX_SAMPLE, desiredMcpEntry(STABLE));
	assert.strictEqual(classifyCodexConfig(next, STABLE).state, 'current');
	assert.strictEqual(/(^|[^\r])\n/.test(next), false, 'CRLF 유지');
	const lines = next.split('\r\n');
	assert.deepStrictEqual(lines.slice(0, 6), CODEX_SAMPLE.split('\r\n').slice(0, 6), '앞쪽 테이블 보존');
	assert.deepStrictEqual(lines.slice(6, 12), [
		'[mcp_servers.gpl-controller]',
		'command = "node"',
		`args = ['${STABLE}']`,
		'',
		'[mcp_servers.gpl-controller.env]',
		'GPL_BRIDGE = "only"',
	]);
	assert.deepStrictEqual(lines.slice(12), ['', '[memories]', 'use_memories = true', ''], '뒤쪽 테이블 보존, 빈 줄 하나로 구분');
	assert.ok(!next.includes('GPL_HOST'));
	// 다시 써도 같다(멱등).
	assert.strictEqual(upsertCodexServer(next, desiredMcpEntry(STABLE)), next);
});

test('Codex config.toml 쓰기: 테이블이 없으면 끝에 덧붙이고, 빈 파일이면 새로 만든다', () => {
	const appended = upsertCodexServer('[features]\nx = true\n\n', desiredMcpEntry(STABLE));
	assert.ok(appended.startsWith('[features]\nx = true\n\n[mcp_servers.gpl-controller]\n'));
	assert.ok(appended.endsWith('GPL_BRIDGE = "only"\n'));
	const fresh = upsertCodexServer('', desiredMcpEntry(STABLE));
	assert.ok(fresh.startsWith('[mcp_servers.gpl-controller]\n'));
	assert.strictEqual(classifyCodexConfig(fresh, STABLE).state, 'current');
	// 작은따옴표가 든 경로는 basic 문자열로 이스케이프한다.
	const quoted = "C:\\Users\\o'neil\\mcp.cjs";
	assert.deepStrictEqual(readCodexEntry(upsertCodexServer('', desiredMcpEntry(quoted)))!.args, [quoted]);
});

test('워크스페이스 .mcp.json 정리: gpl-controller 만 지우고 다른 서버는 보존, 남는 것이 없으면 파일 삭제', () => {
	const only = JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: { command: 'node' } } });
	assert.deepStrictEqual(stripMcpJsonEntry(only), { changed: true, text: null });
	const mixed = JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: {}, other: { command: 'x' } } }, null, 2).replace(/\n/g, '\r\n');
	const stripped = stripMcpJsonEntry(mixed);
	assert.strictEqual(stripped.changed, true);
	assert.deepStrictEqual(JSON.parse(stripped.text!), { mcpServers: { other: { command: 'x' } } });
	assert.strictEqual(/(^|[^\r])\n/.test(stripped.text!), false, 'CRLF 유지');
	assert.deepStrictEqual(stripMcpJsonEntry('{"mcpServers":{"other":{}}}'), { changed: false, text: '{"mcpServers":{"other":{}}}' });
	const broken = stripMcpJsonEntry('{ broken');
	assert.strictEqual(broken.changed, false);
	assert.ok(broken.error);
});

test('워크스페이스 안내 블록 정리: 자동 블록만 지우고 사용자 본문 보존, 확장이 만든 머리말만 남으면 파일 삭제', () => {
	const block = [GUIDE_BEGIN, `${GUIDE_VERSION_MARK} 0.27.0 -->`, '## 제어기 통신', '본문', GUIDE_END].join('\r\n');
	assert.deepStrictEqual(stripGuideBlock(`${LEGACY_GUIDE_FILE_HEADER}\r\n\r\n${block}\r\n`), { changed: true, text: null });
	const user = stripGuideBlock(`# 사용자 규칙\r\n\r\n기존 본문\r\n\r\n${block}\r\n\r\n나머지\r\n`);
	assert.deepStrictEqual(user, { changed: true, text: '# 사용자 규칙\r\n\r\n기존 본문\r\n\r\n나머지\r\n' });
	assert.deepStrictEqual(stripGuideBlock(`# 내 규칙\n\n${block.replace(/\r\n/g, '\n')}\n`), { changed: true, text: '# 내 규칙\n' });
	assert.deepStrictEqual(stripGuideBlock('# 블록 없음\n'), { changed: false, text: '# 블록 없음\n' });
});
