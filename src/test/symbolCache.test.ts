import * as assert from 'assert';
import { test } from './harness';
import { buildSymbolNameIndex } from '../symbolNameIndex';

test('buildSymbolNameIndex: 이름 기준으로 대소문자 무시 인덱싱', () => {
    const symbols = [
        { name: 'Foo', kind: 'function', filePath: 'a.gpl', line: 1 } as any,
        { name: 'foo', kind: 'sub', filePath: 'b.gpl', line: 2 } as any,
        { name: 'Bar', kind: 'variable', filePath: 'c.gpl', line: 3 } as any,
    ];

    const index = buildSymbolNameIndex(symbols);
    assert.deepStrictEqual(index.get('foo')?.map(s => s.filePath), ['a.gpl', 'b.gpl']);
    assert.deepStrictEqual(index.get('bar')?.map(s => s.filePath), ['c.gpl']);
    assert.strictEqual(index.get('missing')?.length ?? 0, 0);
});
