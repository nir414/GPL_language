import * as assert from 'assert';
import { test } from './harness';
import { GPLParser, GPLSymbol } from '../language/gplParser';
import {
    classifyReferenceOccurrence,
    containerAt,
    qualifierAt,
    ReferenceScopeLookup,
    ReferenceTarget,
} from '../language/referenceScope';
import { buildDocumentReceiverLookup, findQualifierShadowing, resolveExpressionType } from '../language/receiverType';
import { buildCallContext, inferArgumentType, isOverloadSelected, scoreArgTypeAgainstParam, parseParameterDecl } from '../language/overloadResolution';
import { findEnclosingProcedureRange } from '../language/cursorExpression';

const PARSE = { includeLocals: true, includeParameters: true } as const;

function parse(filePath: string, lines: string[]): GPLSymbol[] {
    return GPLParser.parseDocument(lines.join('\n'), filePath, PARSE);
}

function lookupOver(all: GPLSymbol[]): ReferenceScopeLookup {
    return {
        findAllByName: n => all.filter(s => !s.isLocal && !s.isParameter && s.name.toLowerCase() === n.toLowerCase()),
        inUnit: () => true,
        samePath: (a, b) => a.toLowerCase() === b.toLowerCase(),
    };
}

const A = 'C:\\p\\A.gpl';
const B = 'C:\\p\\B.gpl';
const A_LINES = [
    'Module MA',                     // 0
    'Public Sub Go()',               // 1
    'End Sub',                       // 2
    'Public Class Inner',            // 3
    'Public Sub Go()',               // 4  클래스 멤버 — 모듈의 Go 를 가린다
    'End Sub',                       // 5
    'Public Sub Run()',              // 6
    'Go()',                          // 7  → Inner.Go
    'End Sub',                       // 8
    'End Class',                     // 9
    'Public Sub Call()',             // 10
    'Dim go As Integer',             // 11 로컬 선언
    'go = 1',                        // 12 → 로컬
    'End Sub',                       // 13
    'Public Sub Call2()',            // 14
    'Go()',                          // 15 → MA.Go
    'MA . Go()',                     // 16 → MA.Go (점 주위 공백)
    'x(0).Go()',                     // 17 → 다른 수신자
    'End Sub',                       // 18
    'End Module',                    // 19
];
const B_LINES = [
    'Module MB',                     // 0
    'Public Sub Use()',              // 1
    'Go()',                          // 2 → 다른 모듈, 동명 모듈 멤버가 하나뿐이면 MA.Go
    'End Sub',                       // 3
    'End Module',                    // 4
];

function occurrence(file: string, lines: string[], symbols: GPLSymbol[], line: number, marker = 'Go') {
    const lineText = lines[line];
    const idx = lineText.search(new RegExp(`\\b${marker}\\b`, 'i'));
    return { filePath: file, line, lineText, character: idx, fileSymbols: symbols };
}

test('referenceScope: containerAt 은 가장 안쪽 클래스와 감싸는 모듈을 준다', () => {
    const sa = parse(A, A_LINES);
    assert.deepStrictEqual(containerAt(sa, 7), { module: 'MA', className: 'Inner' });
    assert.deepStrictEqual(containerAt(sa, 15), { module: 'MA', className: undefined });
});

test('referenceScope: qualifierAt 은 점 주위 공백·인덱싱 체인을 읽는다', () => {
    assert.deepStrictEqual(qualifierAt('MA . Go()', 5), { qualified: true, chain: ['MA'] });
    assert.deepStrictEqual(qualifierAt('x(0).Go()', 5), { qualified: true, chain: ['x(0)'] });
    assert.deepStrictEqual(qualifierAt('Go()', 0), { qualified: false });
    assert.deepStrictEqual(qualifierAt('    .Go()', 5).qualified, true, 'With 블록의 .Go');
});

test('referenceScope: Module 직속 멤버 — 선언·한정자·가림 판정', () => {
    const sa = parse(A, A_LINES);
    const sb = parse(B, B_LINES);
    const lookup = lookupOver([...sa, ...sb]);
    const target: ReferenceTarget = { name: 'Go', kind: 'sub', module: 'MA', declarations: [{ filePath: A, line: 1 }] };
    const verdict = (file: string, lines: string[], syms: GPLSymbol[], line: number, marker?: string) =>
        classifyReferenceOccurrence(target, occurrence(file, lines, syms, line, marker), lookup);

    assert.deepStrictEqual(verdict(A, A_LINES, sa, 1), { accept: true }, '정의 자신');
    assert.deepStrictEqual(verdict(A, A_LINES, sa, 4), { accept: false, reason: 'other-module-decl' });
    assert.deepStrictEqual(verdict(A, A_LINES, sa, 7), { accept: false, reason: 'shadowed-by-member' });
    assert.deepStrictEqual(verdict(A, A_LINES, sa, 11, 'go'), { accept: false, reason: 'shadowed-by-local' });
    assert.deepStrictEqual(verdict(A, A_LINES, sa, 12, 'go'), { accept: false, reason: 'shadowed-by-local' });
    assert.deepStrictEqual(verdict(A, A_LINES, sa, 15), { accept: true });
    assert.deepStrictEqual(verdict(A, A_LINES, sa, 16), { accept: true });
    assert.deepStrictEqual(verdict(A, A_LINES, sa, 17), { accept: false, reason: 'qualifier-mismatch' });
    assert.deepStrictEqual(verdict(B, B_LINES, sb, 2), { accept: true }, '다른 모듈 — 경쟁 선언 없음');
});

test('referenceScope: 다른 모듈에 같은 이름의 모듈 멤버가 또 있으면 한정자 없는 사용은 확정하지 않는다', () => {
    const sa = parse(A, A_LINES);
    const cLines = ['Module MC', 'Public Sub Go()', 'End Sub', 'End Module'];
    const sc = parse('C:\\p\\C.gpl', cLines);
    const sb = parse(B, B_LINES);
    const lookup = lookupOver([...sa, ...sb, ...sc]);
    const target: ReferenceTarget = { name: 'Go', kind: 'sub', module: 'MA', declarations: [{ filePath: A, line: 1 }] };
    assert.deepStrictEqual(
        classifyReferenceOccurrence(target, occurrence(B, B_LINES, sb, 2), lookup),
        { accept: false, reason: 'ambiguous-unqualified' });
});

test('resolveExpressionType: 배열은 표기 그대로, 인덱싱은 요소 타입, Me·필드 체인', () => {
    const lines = [
        'Module M',                                   // 0
        'Public Class Arm',                           // 1
        'Public peers() As Arm',                      // 2
        'End Class',                                  // 3
        'Public Class Bot',                           // 4
        'Private m_arm As Arm',                       // 5
        'Public Sub Work(ByRef list() As Arm)',       // 6
        'Dim n As Integer',                           // 7
        'n = 0',                                      // 8
        'End Sub',                                    // 9
        'End Class',                                  // 10
        'End Module',                                 // 11
    ];
    const syms = parse('C:\\p\\M.gpl', lines);
    const proc = findEnclosingProcedureRange(i => lines[i], lines.length, 8);
    const lookup = buildDocumentReceiverLookup(syms, proc, 8, () => []);
    const t = (expr: string) => inferArgumentType(expr, lookup);
    assert.strictEqual(t('list'), 'Arm[]');
    assert.strictEqual(t('list(0)'), 'Arm');
    assert.strictEqual(t('n'), 'Integer');
    assert.strictEqual(t('Me.m_arm'), 'Arm');
    assert.strictEqual(t('m_arm.peers'), 'Arm[]');
    assert.strictEqual(t('m_arm . peers(1)'), 'Arm');
    assert.strictEqual(t('Me'), 'Bot');
    assert.strictEqual(t('n + 1'), undefined, '연산식은 판단 보류');
    assert.strictEqual(resolveExpressionType([{ name: 'unknownThing' }], lookup), undefined);
});

test('오버로드: As Object 파라미터는 중립 — 구체 타입 오버로드가 이긴다', () => {
    assert.strictEqual(scoreArgTypeAgainstParam('Arm', parseParameterDecl('o As Object')), 0);
    assert.strictEqual(scoreArgTypeAgainstParam('Arm', parseParameterDecl('a As Arm')), 3);
});

test('오버로드: isOverloadSelected 는 근거가 없으면 빼지 않는다', () => {
    const scalar = { kind: 'sub', parameters: ['a As Integer'], filePath: 'x', line: 1 };
    const pair = { kind: 'sub', parameters: ['a As Integer', 'b As Integer'], filePath: 'x', line: 2 };
    const noTypes = () => ({ findLocal: () => undefined, findAllByName: () => [] });
    assert.strictEqual(isOverloadSelected(scalar, [pair], undefined), true);
    assert.strictEqual(isOverloadSelected(scalar, [], buildCallContext(['1', '2'], noTypes)), true);
    assert.strictEqual(isOverloadSelected(scalar, [pair], buildCallContext(['1', '2'], noTypes)), false);
    assert.strictEqual(isOverloadSelected(pair, [scalar], buildCallContext(['1', '2'], noTypes)), true);
});

test('findQualifierShadowing: 클래스 멤버 Num() 이 Module NUM 을 가린다(대소문자 무시)', () => {
    const unit = [
        'Module RBU',                        // 0
        'Public Class RobotUnit',            // 1
        'Public Function Num() As Integer',  // 2
        'End Function',                      // 3
        'Public Function Pos() As String',   // 4
        'Return NUM.FixedText(1, 3)',        // 5
        'End Function',                      // 6
        'End Class',                         // 7
        'Public Function Other() As String', // 8
        'Return NUM.FixedText(1, 3)',        // 9
        'End Function',                      // 10
        'End Module',                        // 11
    ];
    const numbers = parse('C:\\p\\Numbers.gpl', ['Module NUM', 'End Module']);
    const syms = parse('C:\\p\\RobotUnit.gpl', unit);
    const cache = (n: string) => numbers.filter(s => s.name.toLowerCase() === n.toLowerCase());
    const at = (line: number) => buildDocumentReceiverLookup(
        syms, findEnclosingProcedureRange(i => unit[i], unit.length, line), line, cache);

    const inClass = findQualifierShadowing('NUM', at(5));
    assert.ok(inClass, '클래스 안에서는 가림');
    assert.deepStrictEqual(inClass!.holders.map(h => `${h.kind} ${h.name}`), ['module NUM']);
    assert.deepStrictEqual(inClass!.members.map(m => m.name), ['Num']);
    assert.strictEqual(findQualifierShadowing('NUM', at(9)), undefined, '클래스 밖(모듈 함수)에서는 가림 없음');
});
