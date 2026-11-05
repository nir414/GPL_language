import * as assert from 'assert';
import { test } from '../../harness';
import { FileDepsCache } from '../../../project/gpr/fileDepsCache';
import { SymbolIndex } from '../../../language/symbols/symbolIndex';
import { computeFileDependencies } from '../../../providers/diagnostics/requiresHeaderPlan';
import { normalizePathKey } from '../../../util/pathKey';

test('FileDepsCache: 본문과 세대가 같으면 재계산하지 않고, 어느 쪽이든 바뀌면 다시 계산한다', () => {
    const cache = new FileDepsCache<string>();
    let calls = 0;
    const compute = (v: string) => () => { calls++; return v; };
    assert.strictEqual(cache.getOrCompute('a', 'text', 1, compute('v1')), 'v1');
    assert.strictEqual(cache.getOrCompute('a', 'text', 1, compute('v2')), 'v1');
    assert.strictEqual(calls, 1);
    assert.strictEqual(cache.getOrCompute('a', 'text2', 1, compute('v3')), 'v3'); // 본문 변경
    assert.strictEqual(cache.getOrCompute('a', 'text2', 2, compute('v4')), 'v4'); // 세대 변경(본문 동일)
    assert.strictEqual(calls, 3);
});

function makeIndex(): SymbolIndex {
    return new SymbolIndex({
        narrowCandidates: candidates => candidates,
        scoreFilePath: (candidate, reference) => normalizePathKey(candidate) === normalizePathKey(reference) ? 1000 : 0,
        isSameCompileUnit: () => true,
    });
}

test('모듈을 다른 파일로 옮기면 인덱스 세대가 오르고, 같은 본문의 의존 파일이 새 파일로 바뀐다', () => {
    const index = makeIndex();
    const caller = 'Module APP\n    Public Sub Main()\n        RWK.Go()\n    End Sub\nEnd Module\n';
    const rwk = 'Module RWK\n    Public Sub Go()\n    End Sub\nEnd Module\n';
    const lookup = { findAllByName: (n: string) => index.findAllByName(n), isSameCompileUnit: () => true };
    const cache = new FileDepsCache<string[]>();
    const depsOf = () => cache.getOrCompute('app', caller, index.generation,
        () => computeFileDependencies(caller, 'C:\\p\\App.gpl', lookup).map(d => d.filePath));

    // 옮기기 전: RWK 는 Robot_Joint.gpl 에 있다
    index.updateFileText('C:\\p\\App.gpl', caller);
    index.updateFileText('C:\\p\\Robot_Joint.gpl', rwk);
    index.rebuildNameIndex();
    const before = index.generation;
    assert.deepStrictEqual(depsOf().map(normalizePathKey), [normalizePathKey('C:\\p\\Robot_Joint.gpl')]);

    // 외부 도구가 RWK 를 Robot_Worker.gpl 로 옮긴다 — App.gpl 본문은 그대로다
    index.updateFileText('C:\\p\\Robot_Joint.gpl', 'Module RBT\n    Public Sub X()\n    End Sub\nEnd Module\n');
    index.updateFileText('C:\\p\\Robot_Worker.gpl', rwk);
    index.rebuildNameIndex();
    assert.ok(index.generation > before, '인덱스 변경은 세대를 올려야 한다');
    assert.deepStrictEqual(depsOf().map(normalizePathKey), [normalizePathKey('C:\\p\\Robot_Worker.gpl')]);
});

test('SymbolIndex.clear 도 세대를 올린다(전체 재인덱싱 뒤 같은 번호로 되돌아가지 않는다)', () => {
    const index = makeIndex();
    index.updateFileText('A.gpl', 'Module A\nEnd Module\n');
    const g = index.generation;
    index.clear();
    assert.ok(index.generation > g);
});
