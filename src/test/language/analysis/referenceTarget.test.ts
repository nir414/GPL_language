import * as assert from 'assert';
import { test } from '../../harness';
import { GPLParser, GPLSymbol } from '../../../language/syntax/gplParser';
import {
    pickCandidate,
    recoverDefinitionScope,
    recoverTypeUsageDeclaration,
    ReferenceCursor,
    resolveReferenceTargetSymbol,
    tryGetDefinitionSymbolAtPosition,
} from '../../../language/analysis/referenceTarget';
import { makeSymbolIndex, receiverLookupFromText, SAMPLE_FILES } from './referenceFixture';

const UTIL = 'C:\\proj\\Util.gpl';
const PUMP = 'C:\\proj\\Pump.gpl';
const MAIN = 'C:\\proj\\Main.gpl';

/** 줄 `line` 에서 `marker` 위치(+offset)의 커서로 대상 복원을 돌린다. */
function resolve(files: Record<string, string>, file: string, line: number, marker: string, word: string, qualifier?: string) {
    const symbols = makeSymbolIndex(files);
    const text = files[file];
    const lines = text.split('\n');
    const lineText = lines[line];
    const wordStart = lineText.indexOf(marker);
    const cursor: ReferenceCursor = {
        word, qualifier, documentText: text, documentFsPath: file, line, lineText,
        wordStart, wordEnd: wordStart + word.length,
    };
    const logs: string[] = [];
    const result = resolveReferenceTargetSymbol(symbols, cursor, () => {
        const docSymbols = GPLParser.parseDocument(text, file, { includeLocals: true, includeParameters: true });
        return { docSymbols, lookup: receiverLookupFromText(lines, file, line, n => symbols.findAllByName(n), docSymbols) };
    }, m => logs.push(m));
    return { ...result, logs, symbols };
}

const describe = (s: GPLSymbol | undefined) => s && `${s.kind} ${s.module ?? ''}.${s.className ?? ''}.${s.name}@${s.filePath.split('\\').pop()}:${s.line}`;

test('참조 대상: 선언 줄의 커서는 그 줄의 선언을 고른다(범위가 덮는 것 우선)', () => {
    const text = SAMPLE_FILES[UTIL];
    const decl = tryGetDefinitionSymbolAtPosition(text, UTIL, 1, 'Scale', 16);
    assert.strictEqual(describe(decl), 'function Util..Scale@Util.gpl:1');
    // 호출부 줄에는 같은 이름의 선언이 없다
    assert.strictEqual(tryGetDefinitionSymbolAtPosition(text, UTIL, 5, 'Scale', 18), undefined);
    // 대소문자 무시
    assert.strictEqual(tryGetDefinitionSymbolAtPosition(text, UTIL, 1, 'SCALE', 16)?.line, 1);
});

test('참조 대상: 이름 기반 복원 — 모듈이 갈리면 포기하고 한정자가 모듈이면 그 모듈로 좁힌다', () => {
    const symbols = makeSymbolIndex(SAMPLE_FILES);
    // Scale 은 Util 과 PumpMod 에 모두 있다
    assert.strictEqual(recoverDefinitionScope(symbols, 'Scale', undefined, MAIN), undefined);
    assert.strictEqual(describe(recoverDefinitionScope(symbols, 'Scale', 'Util', MAIN)), 'function Util..Scale@Util.gpl:1');
    assert.strictEqual(describe(recoverDefinitionScope(symbols, 'Scale', 'PumpMod', MAIN)), 'sub PumpMod..Scale@Pump.gpl:9');
    // 한 곳뿐인 모듈 프로시저
    assert.strictEqual(describe(recoverDefinitionScope(symbols, 'Run', undefined, MAIN)), 'sub Util..Run@Util.gpl:4');
    // 클래스 멤버는 복원하지 않는다(광역 검색 유지)
    assert.strictEqual(recoverDefinitionScope(symbols, 'Start', undefined, MAIN), undefined);
    assert.strictEqual(recoverDefinitionScope(symbols, 'NoSuchName', undefined, MAIN), undefined);
});

test('참조 대상: 이름 기반 복원 — 같은 모듈에 private 이 섞이면 private 쪽을 고른다', () => {
    const files = {
        'C:\\p\\A.gpl': [
            'Module A', 'Public Sub X()', 'End Sub', 'Private Sub X(a As Integer)', 'End Sub', 'End Module',
        ].join('\n'),
    };
    const symbols = makeSymbolIndex(files);
    const chosen = recoverDefinitionScope(symbols, 'X', undefined, 'C:\\p\\A.gpl');
    assert.strictEqual(chosen?.accessModifier, 'private');
    assert.strictEqual(chosen?.line, 3);
});

test('참조 대상: 타입 이름 사용부(`As Pump`)는 선언한 Class/Module 로 복원한다', () => {
    const symbols = makeSymbolIndex(SAMPLE_FILES);
    const line = 'Dim q As Pump';
    const decl = recoverTypeUsageDeclaration(symbols, 'Pump', MAIN, line, line.indexOf('Pump'));
    assert.strictEqual(describe(decl), 'class PumpMod.Pump.Pump@Pump.gpl:1');
    // 타입 자리가 아니면 복원하지 않는다
    assert.strictEqual(recoverTypeUsageDeclaration(symbols, 'Util', MAIN, 'Util.Scale(1.0)', 0), undefined);
});

test('참조 대상: pickCandidate — 하나면 확정, 확정 못 하는 오버로드는 첫 호출 가능 후보를 imprecise 로', () => {
    const a = { kind: 'sub', name: 'F', line: 1 } as GPLSymbol;
    const b = { kind: 'sub', name: 'F', line: 3 } as GPLSymbol;
    const v = { kind: 'variable', name: 'F', line: 0 } as GPLSymbol;
    assert.strictEqual(pickCandidate([], undefined), undefined);
    assert.deepStrictEqual(pickCandidate([a], undefined), { symbol: a, precise: true });
    assert.deepStrictEqual(pickCandidate([a, b], undefined), { symbol: a, precise: false });
    assert.deepStrictEqual(pickCandidate([v, b], undefined), { symbol: b, precise: false });
    assert.deepStrictEqual(pickCandidate([v, { ...v, line: 9 }], undefined), { symbol: v, precise: false });
});

test('참조 대상: 사용부 — 수신자 변수(`q.Start()`)는 그 타입의 멤버로, 사용부 로그를 남긴다', () => {
    const r = resolve(SAMPLE_FILES, MAIN, 5, 'Start', 'Start', 'q');
    assert.strictEqual(describe(r.defSymbol), 'sub PumpMod.Pump.Start@Pump.gpl:2');
    assert.strictEqual(r.defPrecise, true);
    assert.deepStrictEqual(r.logs, ['[References] usage → sub Start @Pump.gpl:3 precise=true']);
});

test('참조 대상: 사용부 — `Module.Member` 와 한정자 없는 `Name.` 의 모듈 자리', () => {
    const member = resolve(SAMPLE_FILES, MAIN, 6, 'Scale', 'Scale', 'Util');
    assert.strictEqual(describe(member.defSymbol), 'function Util..Scale@Util.gpl:1');
    assert.strictEqual(member.defPrecise, true);
    const holder = resolve(SAMPLE_FILES, MAIN, 6, 'Util', 'Util');
    assert.strictEqual(holder.defSymbol?.kind, 'module');
    assert.strictEqual(holder.defSymbol?.name, 'Util');
    assert.strictEqual(holder.defPrecise, true);
});

test('참조 대상: 사용부 — 한정자 없는 이름은 감싸는 클래스 멤버로 푼다', () => {
    const r = resolve(SAMPLE_FILES, PUMP, 5, 'Start', 'Start');
    assert.strictEqual(describe(r.defSymbol), 'sub PumpMod.Pump.Start@Pump.gpl:2');
    assert.strictEqual(r.defPrecise, true);
});

test('참조 대상: 로컬 변수 사용부는 복원하지 못해 undefined 로 남는다(이름 검색 유지)', () => {
    const r = resolve(SAMPLE_FILES, MAIN, 12, 'Scale', 'Scale');
    assert.strictEqual(r.defSymbol, undefined);
    assert.strictEqual(r.defPrecise, false);
    assert.deepStrictEqual(r.logs, []);
});

test('참조 대상: 선언 위에서 실행하면 precise, `New` 는 뒤의 클래스 생성자를 고르되 precise 는 아니다', () => {
    const files = {
        'C:\\proj\\Box.gpl': [
            'Module M', 'Public Class Box', 'Public Sub New()', 'End Sub', 'End Class',
            'Public Sub T()', 'Dim b As New Box()', 'End Sub', 'End Module',
        ].join('\n'),
    };
    const onDecl = resolve(files, 'C:\\proj\\Box.gpl', 2, 'New', 'New');
    assert.strictEqual(onDecl.defSymbol?.line, 2);
    assert.strictEqual(onDecl.defPrecise, true);
    const onUse = resolve(files, 'C:\\proj\\Box.gpl', 6, 'New', 'New');
    assert.strictEqual(onUse.defSymbol?.line, 2);
    assert.strictEqual(onUse.defPrecise, false);
    assert.deepStrictEqual(onUse.logs, []);
});

test('참조 대상: 오버로드는 호출 인자 수로 확정한다', () => {
    const files = {
        'C:\\proj\\Ov.gpl': [
            'Module M',
            'Public Sub F(a As Integer)',
            'End Sub',
            'Public Sub F(a As Integer, b As Integer)',
            'End Sub',
            'Public Sub T()',
            'F(1, 2)',
            'F(1)',
            'End Sub',
            'End Module',
        ].join('\n'),
    };
    const two = resolve(files, 'C:\\proj\\Ov.gpl', 6, 'F', 'F');
    assert.strictEqual(two.defSymbol?.line, 3);
    assert.strictEqual(two.defPrecise, true);
    const one = resolve(files, 'C:\\proj\\Ov.gpl', 7, 'F', 'F');
    assert.strictEqual(one.defSymbol?.line, 1);
    assert.strictEqual(one.defPrecise, true);
});
