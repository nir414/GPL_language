import * as assert from 'assert';
import * as path from 'path';
import { test } from '../harness';
import { isPathUnder, normalizePathKey } from '../../util/pathKey';

// ─── 경로 키 메모·접두어 비교 — 종전 path.resolve/relative 판정과 같은 결과여야 한다 ───

test('normalizePathKey: 반복 호출도 같은 키, 표기 차이는 한 키로 수렴', () => {
    const base = path.resolve('C:\Work\Proj');
    const a = normalizePathKey(base + path.sep + 'Main.gpl');
    assert.strictEqual(normalizePathKey(base + path.sep + 'Main.gpl'), a);
    assert.strictEqual(normalizePathKey(base + path.sep + 'sub' + path.sep + '..' + path.sep + 'Main.gpl'), a);
    assert.strictEqual(normalizePathKey(base + path.sep), normalizePathKey(base));
});

test('isPathUnder: 하위·동일은 참, 형제·접두어만 같은 폴더·상위는 거짓', () => {
    const dir = path.resolve('C:\Work\Proj');
    assert.strictEqual(isPathUnder(path.join(dir, 'a', 'b.gpl'), dir), true);
    assert.strictEqual(isPathUnder(dir, dir), true);
    assert.strictEqual(isPathUnder(dir + 'X' + path.sep + 'b.gpl', dir), false);
    assert.strictEqual(isPathUnder(path.dirname(dir), dir), false);
    assert.strictEqual(isPathUnder(path.join(path.dirname(dir), 'Other', 'b.gpl'), dir), false);
});

test('isPathUnder: 종전 path.relative 판정과 같은 결과(대소문자·`..`·`..x` 폴더)', () => {
    const legacy = (file: string, dir: string): boolean => {
        const rel = path.relative(path.resolve(dir), path.resolve(file));
        return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    };
    const dir = path.resolve('C:\Work\Proj');
    const files = [
        path.join(dir, 'a.gpl'), path.join(dir, '..x', 'a.gpl'), path.join(dir, 'sub', '..', 'a.gpl'),
        dir.toUpperCase() + path.sep + 'A.GPL', path.join(dir, '..', 'a.gpl'), path.resolve('D:\Work\Proj\a.gpl'),
        path.parse(dir).root, path.join(path.parse(dir).root, 'x.gpl'),
    ];
    for (const f of files) {
        assert.strictEqual(isPathUnder(f, dir), legacy(f, dir), f);
        assert.strictEqual(isPathUnder(f, path.parse(dir).root), legacy(f, path.parse(dir).root), f + ' @root');
    }
});
