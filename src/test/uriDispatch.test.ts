import * as assert from 'assert';
import { test } from './harness';
import { coerceUriValue, resolveUriRequest, summarizeUriResult } from '../controller/uriDispatch';

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
