import * as assert from 'assert';
import { test } from '../../harness';
import { parseCompileErrors } from '../../../controller/protocol/compileErrorParser';

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

test('parseCompileErrors: DATA 태그와 첫 에러가 같은 줄이어도 파일명에는 태그가 섞이지 않는다', () => {
    const errors = parseCompileErrors('<DATA>Main.gpl:12:(-303): Undefined symbol: foo</DATA><STATUS>-742,"Compile errors"</STATUS>');
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].file, 'Main.gpl');
    assert.strictEqual(errors[0].message, 'Undefined symbol: foo');
});

test('parseCompileErrors: 매치 없으면 빈 배열', () => {
    assert.deepStrictEqual(parseCompileErrors('no errors here'), []);
});
