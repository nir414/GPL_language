import * as assert from 'assert';
import { test } from './harness';
import { parseStatus, parseCompileErrors } from '../controller/responseParser';

test('parseStatus: 성공 코드와 메시지', () => {
    const r = parseStatus('<STATUS>0,"OK"</STATUS>');
    assert.strictEqual(r.code, 0);
    assert.strictEqual(r.message, 'OK');
});

test('parseStatus: 음수 에러 코드', () => {
    const r = parseStatus('<STATUS>-745,"already loaded"</STATUS>');
    assert.strictEqual(r.code, -745);
    assert.strictEqual(r.message, 'already loaded');
});

test('parseStatus: 메시지 없는 STATUS', () => {
    const r = parseStatus('prefix <STATUS> -742 </STATUS> suffix');
    assert.strictEqual(r.code, -742);
    assert.strictEqual(r.message, '');
});

test('parseStatus: STATUS 없으면 -9999', () => {
    const r = parseStatus('garbage response without status');
    assert.strictEqual(r.code, -9999);
});

test('parseCompileErrors: CONSOLE 접두 에러 라인', () => {
    const errors = parseCompileErrors('[CONSOLE] foo.gpl:42:(-100): something bad');
    assert.strictEqual(errors.length, 1);
    assert.deepStrictEqual(errors[0], {
        file: 'foo.gpl',
        line: 42,
        code: -100,
        message: 'something bad',
    });
});

test('parseCompileErrors: 접두 없는 라인 + 다중 매치', () => {
    const errors = parseCompileErrors('a.gpl:1:(-1): first\nb.gpr:2:(-2): second');
    assert.strictEqual(errors.length, 2);
    assert.strictEqual(errors[0].file, 'a.gpl');
    assert.strictEqual(errors[1].file, 'b.gpr');
    assert.strictEqual(errors[1].code, -2);
});

test('parseCompileErrors: 매치 없으면 빈 배열', () => {
    assert.deepStrictEqual(parseCompileErrors('no errors here'), []);
});
