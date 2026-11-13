import * as assert from 'assert';
import { test } from '../../harness';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { coerceUriValue, resolveUriRequest, summarizeUriResult, uriCommandNeedsToken, uriTokenMatches } from '../../../controller/automation/uriDispatch';
import { ensureUriToken, uriTokenPath } from '../../../controller/automation/uriToken';

test('uriDispatch: 별칭은 대소문자 무시, 쿼리 보존', () => {
    const r = resolveUriRequest('/Connect', 'ip=192.168.0.1&port=1402&save=settings');
    assert.strictEqual(r.kind, 'alias');
    if (r.kind === 'alias') {
        assert.strictEqual(r.action, 'connect');
        assert.strictEqual(r.query.get('ip'), '192.168.0.1');
    }
    assert.deepStrictEqual(resolveUriRequest('/getConnectionState', '').kind === 'alias' && (resolveUriRequest('/getConnectionState', '') as any).action, 'getState');
    assert.strictEqual((resolveUriRequest('dashboard/', undefined) as any).action, 'dashboard');
});

test('uriDispatch: 경로가 명령 id — args JSON', () => {
    const r = resolveUriRequest('/gpl.ai.debug.getState', 'args=' + encodeURIComponent('{"includeBreakpoints":true}'));
    assert.deepStrictEqual(r, { kind: 'command', commandId: 'gpl.ai.debug.getState', args: { includeBreakpoints: true } });
});

test('uriDispatch: 평면 쿼리 → 객체 1개(숫자/불리언/JSON 자동 변환)', () => {
    const r = resolveUriRequest('/gpl.ai.debug.stepThread', 'threadName=MainThread&mode=over&waitForPause=false&waitTimeoutMs=3000&thread=' + encodeURIComponent('{"name":"X"}'));
    assert.deepStrictEqual(r, {
        kind: 'command', commandId: 'gpl.ai.debug.stepThread',
        args: { threadName: 'MainThread', mode: 'over', waitForPause: false, waitTimeoutMs: 3000, thread: { name: 'X' } },
    });
});

test('uriDispatch: 쿼리 없음 → args undefined(인자 없이 호출)', () => {
    assert.deepStrictEqual(resolveUriRequest('/gpl.controller.showDashboard', ''), { kind: 'command', commandId: 'gpl.controller.showDashboard', args: undefined });
});

test('uriDispatch: /command?id=… 형식 — id 는 인자에서 제외', () => {
    const r = resolveUriRequest('/command', 'id=gpl.controller.connect&ip=10.0.0.2&silent=true');
    assert.deepStrictEqual(r, { kind: 'command', commandId: 'gpl.controller.connect', args: { ip: '10.0.0.2', silent: true } });
    assert.strictEqual(resolveUriRequest('/command', 'ip=1').kind, 'invalid');
});

test('uriDispatch: gpl.* 밖의 명령·빈 경로·잘못된 JSON 은 invalid', () => {
    assert.strictEqual(resolveUriRequest('/workbench.action.terminal.sendSequence', '').kind, 'invalid');
    assert.strictEqual(resolveUriRequest('/', '').kind, 'invalid');
    assert.strictEqual(resolveUriRequest('/gpl.deploy', 'args={oops').kind, 'invalid');
    assert.strictEqual(resolveUriRequest('/gpl.deploy;rm', '').kind, 'invalid');
});

test('uriDispatch: 값 변환 규칙', () => {
    assert.strictEqual(coerceUriValue('12'), 12);
    assert.strictEqual(coerceUriValue('-1.5'), -1.5);
    assert.strictEqual(coerceUriValue('true'), true);
    assert.strictEqual(coerceUriValue('MainThread'), 'MainThread');
    assert.strictEqual(coerceUriValue('192.168.0.1'), '192.168.0.1');   // IP 는 숫자가 아니다
    assert.deepStrictEqual(coerceUriValue('[1,2]'), [1, 2]);
    assert.strictEqual(coerceUriValue('{broken'), '{broken');
});

test('uriDispatch: 결과 요약은 길이를 자른다', () => {
    assert.strictEqual(summarizeUriResult(undefined), '(반환값 없음)');
    assert.strictEqual(summarizeUriResult({ ok: true }), '{"ok":true}');
    const long = summarizeUriResult('x'.repeat(1000), 100);
    assert.ok(long.startsWith('x'.repeat(100)) && long.includes('+900자'));
});

// ── URI 토큰 (§1-GZ) ───────────────────────────────────────────────────────

test('uriDispatch: token 쿼리는 인자에서 빠지고 결과의 token 으로 온다', () => {
    const r = resolveUriRequest('/gpl.controller.sendCommand', 'command=Show%20Thread&token=abc');
    assert.strictEqual(r.kind, 'command');
    if (r.kind === 'command') {
        assert.deepStrictEqual(r.args, { command: 'Show Thread' });
        assert.strictEqual(r.token, 'abc');
    }
    const j = resolveUriRequest('/gpl.deploy', 'args=%7B%22mode%22%3A%22build%22%7D&token=t');
    assert.ok(j.kind === 'command' && (j.args as any).mode === 'build' && j.token === 't');
});

test('uriCommandNeedsToken: 조회 전용(확장 깨우기 포함)만 토큰 없이, 나머지는 토큰 필요', () => {
    assert.strictEqual(uriCommandNeedsToken('gpl.ai.debug.getConnectionState'), false);
    assert.strictEqual(uriCommandNeedsToken('gpl.controller.sendCommand'), true);
    assert.strictEqual(uriCommandNeedsToken('gpl.start'), true);
    assert.strictEqual(uriTokenMatches('a'.repeat(32), 'a'.repeat(32)), true);
    assert.strictEqual(uriTokenMatches('a'.repeat(32), 'b'.repeat(32)), false);
    assert.strictEqual(uriTokenMatches(undefined, 'x'), false, '기대값이 없으면 닫힌 쪽');
    assert.strictEqual(uriTokenMatches('abc', undefined), false);
});

test('ensureUriToken: 없으면 만들고, 있으면 같은 값을 돌려준다(창마다 바뀌지 않게)', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-uri-token-'));
    try {
        const a = ensureUriToken(base);
        assert.ok(a && /^[0-9a-f]{32}$/.test(a));
        assert.strictEqual(ensureUriToken(base), a);
        assert.strictEqual(fs.readFileSync(uriTokenPath(base), 'utf8'), a);
        fs.writeFileSync(uriTokenPath(base), 'broken');
        const b = ensureUriToken(base);
        assert.ok(b && b !== 'broken' && /^[0-9a-f]{32}$/.test(b), '모양이 틀리면 새로 만든다');
    } finally {
        fs.unlinkSync(uriTokenPath(base));
        fs.rmdirSync(path.dirname(uriTokenPath(base)));
        fs.rmdirSync(base);
    }
});
