import * as assert from 'assert';
import * as path from 'path';
import { test } from './harness';
import { SymbolIndex, SymbolResolutionContext } from '../language/symbols/symbolIndex';
import { normalizePathKey } from '../util/pathKey';

function setup(overrides: Partial<SymbolResolutionContext> = {}): SymbolIndex {
    return new SymbolIndex({
        narrowCandidates: candidates => candidates,
        scoreFilePath: (candidate, reference) => normalizePathKey(candidate) === normalizePathKey(reference) ? 1000 : 0,
        isSameCompileUnit: () => true,
        ...overrides,
    });
}

const functions = [
    'Module MathTools',
    'Public Function Choose(value As Integer) As Integer',
    'Return value',
    'End Function',
    'Public Function Choose(value As String) As String',
    'Return value',
    'End Function',
    'Public Function Choose(left As Integer, right As Integer) As Integer',
    'Return left + right',
    'End Function',
    'End Module',
].join('\n');

test('SymbolIndex: 경로 표기만 바뀐 갱신은 파일 하나로 유지하고 옛 이름을 제거한다', () => {
    const index = setup();
    index.updateFileText('C:\\symbols\\Main.gpl', 'Public Sub Before()\nEnd Sub');
    index.rebuildNameIndex();
    index.updateFileText('c:/SYMBOLS/./Main.gpl', 'Public Sub After()\nEnd Sub');
    index.rebuildNameIndex();
    assert.deepStrictEqual(index.listIndexedFiles(), ['c:/SYMBOLS/./Main.gpl']);
    assert.strictEqual(index.findAllByName('BEFORE').length, 0);
    assert.strictEqual(index.findDefinition('after')?.name, 'After');
});

test('SymbolIndex: 묶음 갱신은 완료 시 이름 인덱스를 한 번 반영한다', () => {
    const index = setup();
    index.updateFileText('a.gpl', 'Public Sub A()\nEnd Sub');
    index.updateFileText('b.gpl', 'Public Sub B()\nEnd Sub');
    assert.strictEqual(index.getAllSymbols().length, 2);
    assert.strictEqual(index.findAllByName('A').length, 0);
    index.rebuildNameIndex();
    assert.strictEqual(index.findAllByName('A').length, 1);
    assert.strictEqual(index.findAllByName('b').length, 1);
});

test('SymbolIndex: 대상 외 확장자와 바이너리 입력은 기존 심볼을 바꾸지 않는다', () => {
    const index = setup();
    index.updateFileText('Main.gpl', 'Public Sub Keep()\nEnd Sub');
    index.rebuildNameIndex();
    assert.strictEqual(index.updateFileText('Main.gpl', '\u0000garbage'), undefined);
    assert.strictEqual(index.updateFileText('Other.txt', 'Public Sub Bad()\nEnd Sub'), undefined);
    assert.strictEqual(index.findDefinition('Keep')?.name, 'Keep');
    assert.strictEqual(index.listIndexedFiles().length, 1);
});

test('SymbolIndex: 오버로드는 인자 수와 타입을 함께 해석한다', () => {
    const index = setup();
    index.updateFileText('Math.gpl', functions);
    index.rebuildNameIndex();
    assert.strictEqual(index.findDefinition('Choose', 'Math.gpl', 2)?.parameters?.length, 2);
    assert.strictEqual(index.findDefinition('Choose', 'Math.gpl', { argCount: 1, getArgTypes: () => ['String'] })?.returnType, 'String');
    assert.strictEqual(index.findMemberInModule('Choose', 'MathTools', 'Math.gpl', 2)?.parameters?.length, 2);
});

test('SymbolIndex: 프로젝트 경계는 경로 점수보다 먼저 후보를 좁힌다', () => {
    const a = path.resolve('index-fixture/a/Math.gpl');
    const b = path.resolve('index-fixture/b/Math.gpl');
    const index = setup({
        narrowCandidates: candidates => candidates.filter(symbol => symbol.filePath === a),
        scoreFilePath: candidate => candidate === b ? 1000 : 0,
    });
    index.updateFileText(a, functions);
    index.updateFileText(b, functions);
    index.rebuildNameIndex();
    assert.strictEqual(index.findDefinition('Choose', b, 2)?.filePath, a);
    assert.strictEqual(index.findMemberInModule('Choose', 'MathTools', b, 2)?.filePath, a);
});

test('SymbolIndex: 중첩 클래스·멤버·Optional 생성자의 조회를 유지한다', () => {
    const index = setup();
    index.updateFileText('Counter.gpl', [
        'Module Counters', 'Public Class Counter',
        'Public Count As Integer',
        'Public Sub New(Optional initial As Integer = 0)', 'End Sub',
        'Public Sub Increment()', 'End Sub',
        'Public Class Options', 'End Class',
        'End Class', 'End Module',
    ].join('\n'));
    index.rebuildNameIndex();
    assert.ok(index.getModuleMembers('Counters').some(symbol => symbol.name === 'Counter'));
    const members = index.getClassMembers('Counter').map(symbol => symbol.name);
    assert.ok(members.includes('Count'));
    assert.ok(members.includes('Options'));
    assert.ok(!members.includes('New'));
    assert.strictEqual(index.findMemberInClass('Count', 'Counter')?.kind, 'variable');
    assert.strictEqual(index.findConstructorInClass('Counter', 0)?.name, 'New');
    assert.strictEqual(index.findConstructorInClass('Counter', 5)?.name, 'New');
});

test('SymbolIndex: 폴더 삭제는 경계 안 파일만 제거하고 이름 조회에도 반영한다', () => {
    const index = setup();
    const root = path.resolve('index-fixture/group');
    index.updateFileText(path.join(root, 'A.gpl'), 'Public Sub A()\nEnd Sub');
    index.updateFileText(path.join(root, 'sub/B.gpl'), 'Public Sub B()\nEnd Sub');
    index.updateFileText(path.resolve('index-fixture/group-other/C.gpl'), 'Public Sub C()\nEnd Sub');
    index.rebuildNameIndex();
    index.deleteByFsPathPrefix(root.toUpperCase());
    assert.strictEqual(index.findAllByName('A').length, 0);
    assert.strictEqual(index.findAllByName('B').length, 0);
    assert.strictEqual(index.findAllByName('C').length, 1);
});

test('SymbolIndex: 지정한 경로만 존재 확인하고 나머지 파일은 보존한다', () => {
    const index = setup();
    for (const name of ['A', 'B', 'C']) index.updateFileText(`${name}.gpl`, `Public Sub ${name}()\nEnd Sub`);
    index.rebuildNameIndex();
    const checked: string[] = [];
    const removed = index.pruneFiles(file => { checked.push(file); return true; }, ['a.gpl', 'A.gpl', 'unknown.gpl']);
    assert.deepStrictEqual(removed, ['A.gpl']);
    assert.deepStrictEqual(checked, ['A.gpl']);
    assert.strictEqual(index.findAllByName('A').length, 0);
    assert.strictEqual(index.getAllSymbols().length, 2);
    index.clear();
    assert.strictEqual(index.getAllSymbols().length, 0);
    assert.strictEqual(index.findAllByName('B').length, 0);
});

test('SymbolIndex: 오버로드 형제는 주입한 컴파일 단위 경계를 따른다', () => {
    const index = setup({ isSameCompileUnit: (candidate, reference) => candidate === reference });
    index.updateFileText('A.gpl', functions);
    index.updateFileText('B.gpl', functions);
    index.rebuildNameIndex();
    const target = index.findAllByName('Choose').find(symbol => symbol.filePath === 'A.gpl')!;
    const siblings = index.findOverloadSiblings(target);
    assert.strictEqual(siblings.length, 2);
    assert.ok(siblings.every(symbol => symbol.filePath === 'A.gpl'));
});
