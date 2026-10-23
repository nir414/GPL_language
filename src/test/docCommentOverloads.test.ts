import * as assert from 'assert';
import * as path from 'path';
import { test } from './harness';
import {
    describeOverloadCoverage,
    filterOverloadSiblings,
    renderResolvedDocMarkdown,
    resolveOverloadDoc,
    shortSignature,
} from '../language/docCommentOverloads';
import { buildDocCommentBlock, findSection, getParamDoc, mergeDocComment, parseDocComment } from '../language/docComment';

// 오버로드 그룹의 문서화 주석 병합 — "공통 문서는 이름 단위로 공유, 차이만 개별 문서화".
// 선정 규칙이 선언 순서에 의존하지 않는지(뒤죽박죽 순서에서도 같은 결과)를 특히 본다.

type Sym = {
    name: string; kind: string; filePath: string; line: number;
    module?: string; className?: string; parameters?: string[]; returnType?: string; docComment?: string;
};

function sym(line: number, parameters: string[], docComment?: string, extra: Partial<Sym> = {}): Sym {
    return { name: 'getWafer', kind: 'sub', filePath: path.resolve('overload-fixture', 'RobotModule.gpl'), module: 'RobotModule', line, parameters, docComment, ...extra };
}

// RobotModule.gpl 의 getWafer 오버로드 사례 — 전체 문서는 스칼라 버전 하나에만, 나머지는 차이만.
const scalar = sym(3760, ['stage As Integer', 'slot As Integer', 'arm As RobotArm'], [
    '지정 스테이지·슬롯의 웨이퍼를 집는다.',
    '',
    '# Parameters',
    '- `stage`: 스테이지 번호(1부터)',
    '- `slot`: 슬롯 번호',
    '- `arm`: 사용할 암',
].join('\n'));
const array = sym(3804, ['stage As Integer', 'slot As Integer', 'armlist() As RobotArm'], [
    '배열 버전 — 여러 암으로 순서대로 집는다.',
    '',
    '# Parameters',
    '- `armlist`: 사용할 암 목록',
].join('\n'));
const withOpt = sym(3810, ['stage As Integer', 'slot As Integer', 'armlist() As RobotArm', 'opt As Integer'], [
    '# Parameters',
    '- `opt`: 동작 옵션 비트',
].join('\n'));

test('filterOverloadSiblings: 같은 이름·모듈/클래스·호출 가능만, 자기 자신과 사본은 제외', () => {
    const aliasPath = `${path.dirname(scalar.filePath)}${path.sep}.${path.sep}${path.basename(scalar.filePath)}`;
    const copyOfScalar = { ...scalar, filePath: process.platform === 'win32' ? aliasPath.replace(/\\/g, '/').toUpperCase() : aliasPath };
    const otherModule = sym(10, [], undefined, { module: 'Other' });
    const variable = sym(20, [], undefined, { kind: 'variable' });
    const got = filterOverloadSiblings(scalar, [scalar, copyOfScalar, array, withOpt, otherModule, variable]);
    assert.deepStrictEqual(got.map(s => s.line), [3804, 3810]);
});

test('filterOverloadSiblings: 컴파일 단위 판정이 주어지면 다른 단위는 형제가 아니다', () => {
    const farCopy = { ...array, filePath: path.resolve('other-overload-fixture', 'RobotModule.gpl') };
    const got = filterOverloadSiblings(scalar, [array, farCopy], {
        isSameUnit: (c, t) => path.dirname(c) === path.dirname(t)
    });
    assert.deepStrictEqual(got.map(s => s.filePath), [array.filePath]);
});

test('filterOverloadSiblings: 자기 선언·사본·같은 파일은 프로젝트 관계를 조회하지 않는다', () => {
    const aliasPath = `${path.dirname(scalar.filePath)}${path.sep}.${path.sep}${path.basename(scalar.filePath)}`;
    const copy = { ...scalar, filePath: process.platform === 'win32' ? aliasPath.replace(/\\/g, '/').toUpperCase() : aliasPath };
    const calls: string[] = [];
    const external = { ...array, filePath: path.resolve('other-overload-fixture', 'RobotModule.gpl') };
    const got = filterOverloadSiblings(scalar, [scalar, copy, array, { ...array }, external], {
        isSameUnit: file => { calls.push(file); return false; },
    });
    assert.deepStrictEqual(got, [array]);
    assert.deepStrictEqual(calls, [external.filePath]);
});

test('resolveOverloadDoc: 설명 없는 오버로드가 공통 설명·닮은 형제의 설명·이름별 매개변수를 물려받는다', () => {
    const r = resolveOverloadDoc(withOpt, [scalar, array])!;
    assert.strictEqual(r.overloadCount, 2);
    // 공통 설명(가장 풍부한 스칼라 버전) + 가장 닮은 형제(배열 버전, 이름 3개 겹침)의 설명이 한 문단으로.
    assert.deepStrictEqual(r.doc.description, ['지정 스테이지·슬롯의 웨이퍼를 집는다.', '배열 버전 — 여러 암으로 순서대로 집는다.']);
    assert.strictEqual(r.doc.summary, '지정 스테이지·슬롯의 웨이퍼를 집는다. 배열 버전 — 여러 암으로 순서대로 집는다.');
    // 매개변수는 시그니처 순서로, 출처는 이름별.
    assert.deepStrictEqual(findSection(r.doc, 'parameters')!.params, [
        { name: 'stage', text: '스테이지 번호(1부터)' },
        { name: 'slot', text: '슬롯 번호' },
        { name: 'armlist', text: '사용할 암 목록' },
        { name: 'opt', text: '동작 옵션 비트' },
    ]);
    assert.strictEqual(getParamDoc(r.doc, 'ARMLIST'), '사용할 암 목록');
    // 출처 표기 — 형제별로 한 묶음, 배열 매개변수는 `()` 를 남긴다.
    assert.ok(r.provenance!.includes('`getWafer(stage, slot, armlist())`: 설명, `armlist`'), r.provenance);
    assert.ok(r.provenance!.includes('`getWafer(stage, slot, arm)`: 공통 설명, `stage`, `slot`'), r.provenance);
});

test('resolveOverloadDoc: 선언 순서를 바꿔도 결과가 같다(순서 무관 선정)', () => {
    const render = (siblings: Sym[]) => renderResolvedDocMarkdown(resolveOverloadDoc(withOpt, siblings)!, { descriptionMode: 'full' });
    const a = render([scalar, array]);
    const b = render([array, scalar]);
    // 줄 번호를 뒤집어도(배열 버전이 먼저 선언된 것처럼) 같다.
    const c = render([{ ...array, line: 100 }, { ...scalar, line: 9000 }]);
    assert.strictEqual(a, b);
    assert.strictEqual(a, c);
});

test('resolveOverloadDoc: 자기 설명이 있으면 공통 설명 아래에 차이로 붙고, 자기 매개변수 항목이 우선한다', () => {
    const r = resolveOverloadDoc(array, [scalar, withOpt])!;
    assert.deepStrictEqual(r.doc.description, ['지정 스테이지·슬롯의 웨이퍼를 집는다.', '배열 버전 — 여러 암으로 순서대로 집는다.']);
    assert.deepStrictEqual(findSection(r.doc, 'parameters')!.params, [
        { name: 'stage', text: '스테이지 번호(1부터)' },
        { name: 'slot', text: '슬롯 번호' },
        { name: 'armlist', text: '사용할 암 목록' },
    ]);
});

test('resolveOverloadDoc: 가장 풍부한 오버로드 자신은 물려받을 것이 없어 자기 주석 그대로', () => {
    const r = resolveOverloadDoc(scalar, [array, withOpt])!;
    assert.strictEqual(r.overloadCount, 2);
    assert.strictEqual(r.provenance, undefined);
    assert.deepStrictEqual(r.doc, parseDocComment(scalar.docComment!));
});

test('resolveOverloadDoc: 풍부함·커버리지가 동률이면 공통 설명을 붙이지 않는다(애매하면 생략)', () => {
    const a = sym(1, ['x As Integer'], '정수 버전.\n\n# Parameters\n- `x`: 정수');
    const b = sym(2, ['s As String'], '문자열 버전.\n\n# Parameters\n- `s`: 문자열');
    const bare = sym(3, ['x As Integer', 's As String']);
    const r = resolveOverloadDoc(bare, [a, b])!;
    // 설명은 가장 닮은 형제에서(둘 다 Jaccard 0.5 → 풍부함 동률 → 안정 정렬로 a) 하나만, 공통 설명 줄은 없다.
    assert.deepStrictEqual(r.doc.description, ['정수 버전.']);
    assert.deepStrictEqual(findSection(r.doc, 'parameters')!.params.map(p => p.name), ['x', 's']);
});

test('resolveOverloadDoc: Returns 는 반환 타입이 같은 형제에서만 물려받는다', () => {
    const full = sym(1, ['a As Integer'], '설명.\n\n# Returns\n합계', { kind: 'function', returnType: 'Integer' });
    const sameType = sym(2, ['a As Integer', 'b As Integer'], undefined, { kind: 'function', returnType: 'Integer' });
    const otherType = sym(3, ['a As Integer', 'b As Integer'], undefined, { kind: 'function', returnType: 'String' });
    assert.deepStrictEqual(findSection(resolveOverloadDoc(sameType, [full])!.doc, 'returns')!.lines, ['합계']);
    assert.strictEqual(findSection(resolveOverloadDoc(otherType, [full])!.doc, 'returns'), undefined);
});

test('resolveOverloadDoc: 형제가 없으면 자기 주석 파싱 그대로, 아무 문서도 없으면 undefined', () => {
    assert.deepStrictEqual(resolveOverloadDoc(scalar, [])!.doc, parseDocComment(scalar.docComment!));
    assert.strictEqual(resolveOverloadDoc(sym(1, ['a As Integer']), []), undefined);
    assert.strictEqual(resolveOverloadDoc(sym(1, ['a As Integer']), [sym(2, ['b As Integer'])]), undefined);
});

test('resolveOverloadDoc: 자기 Examples/Remarks 는 유지되고 형제의 것은 오지 않는다', () => {
    const withExample = sym(1, ['a As Integer'], '설명.\n\n# Examples\n```\nFoo(1)\n```');
    const target = sym(2, ['a As Integer', 'b As Integer'], '두 개 버전.\n\n# Remarks\n주의.');
    const r = resolveOverloadDoc(target, [withExample])!;
    assert.deepStrictEqual(r.doc.sections.map(s => s.kind), ['remarks']);
});

test('shortSignature: 이름만, 배열 매개변수는 () 유지', () => {
    assert.strictEqual(shortSignature(withOpt), 'getWafer(stage, slot, armlist(), opt)');
    assert.strictEqual(shortSignature(sym(1, ['ByRef list(,) As Foo', 'Optional n As Integer = 3'])), 'getWafer(list(), n)');
});

test('describeOverloadCoverage → 골격은 형제가 설명한 매개변수를 빼고(차이만), 호출 예시는 전체 이름을 쓴다', () => {
    const coverage = describeOverloadCoverage(withOpt, [scalar, array]);
    assert.deepStrictEqual(coverage, { coveredParams: ['stage', 'slot', 'armlist'], coveredReturns: false });

    const block = buildDocCommentBlock({
        kind: 'sub', name: 'getWafer', parameters: withOpt.parameters, coveredParams: coverage.coveredParams
    }, { includeExamples: true });
    assert.deepStrictEqual(block, [
        "' getWafer 설명",
        "'",
        "' # Parameters",
        "' - `opt`: 설명",
        "'",
        "' # Examples",
        "' ```",
        "' getWafer(stage, slot, armlist, opt)",
        "' ```",
    ]);
});

test('describeOverloadCoverage → 전부 형제가 설명했으면 골격은 설명 한 줄뿐, Returns 도 같은 타입 형제가 썼으면 뺀다', () => {
    const full = sym(1, ['a As Integer'], '설명.\n\n# Parameters\n- `a`: 값\n\n# Returns\n합계', { kind: 'function', returnType: 'Integer' });
    const target = sym(2, ['a As Integer'], undefined, { kind: 'function', returnType: 'Integer' });
    const coverage = describeOverloadCoverage(target, [full]);
    assert.deepStrictEqual(coverage, { coveredParams: ['a'], coveredReturns: true });
    const block = buildDocCommentBlock({ kind: 'function', name: 'getWafer', parameters: target.parameters, returnType: 'Integer', ...coverage });
    assert.deepStrictEqual(block, ["' getWafer 설명"]);
});

test('mergeDocComment: 형제가 설명한 매개변수·Returns 는 빠진 항목으로 세지 않는다', () => {
    const existing = parseDocComment('배열 버전.');
    const { insertions, added } = mergeDocComment(existing, {
        kind: 'function', name: 'getWafer', parameters: withOpt.parameters, returnType: 'Integer',
        coveredParams: ['stage', 'slot', 'armlist'], coveredReturns: true
    });
    assert.deepStrictEqual(added, ['Parameters 섹션']);
    assert.deepStrictEqual(insertions[0].lines, ['', '# Parameters', '- `opt`: ']);
});
