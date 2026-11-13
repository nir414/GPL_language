import * as assert from 'assert';
import { test } from '../../harness';
import {
    buildAnyQualifierPattern,
    buildQualifiedMemberPattern,
    computeLineStarts,
    getQualifierBefore,
    isQualifiedAt,
    isStatementLeadingAssignmentLHS,
    memberOffsetInMatch,
    physicalLineText,
    qualifierBeforeWord,
    shouldAcceptByMemberScope,
} from '../../../language/analysis/referenceCandidates';
import type { GPLSymbol } from '../../../language/syntax/gplParser';

const sym = (over: Record<string, unknown>): GPLSymbol =>
    ({ name: 'x', kind: 'variable', line: 0, filePath: 'f.gpl', ...over } as unknown as GPLSymbol);

test('참조 후보: 모듈/클래스 한정 패턴은 점 주변 공백을 허용하고 단어 경계를 지킨다', () => {
    const re = new RegExp(buildQualifiedMemberPattern('Util', 'Scale'), 'gi');
    assert.strictEqual(re.exec('x = Util . Scale(1)')?.[0], 'Util . Scale');
    re.lastIndex = 0;
    assert.strictEqual(re.exec('MyUtil.Scale'), null);
    re.lastIndex = 0;
    assert.strictEqual(re.exec('Util.ScaleAll'), null);
});

test('참조 후보: 임의 한정자 패턴은 배열 인덱스·중첩 한정자 뒤의 `.Member` 를 잡는다', () => {
    const re = () => new RegExp(buildAnyQualifierPattern('RunZeroStep'), 'gi');
    assert.strictEqual(re().exec('steps(i).RunZeroStep()')?.[0], 'steps(i).RunZeroStep');
    assert.strictEqual(re().exec('foo.bar(i).RunZeroStep')?.[0], 'foo.bar(i).RunZeroStep');
    assert.strictEqual(re().exec('arr(0)(1).RunZeroStep')?.[0], 'arr(0)(1).RunZeroStep');
    assert.strictEqual(re().exec('RunZeroStep()'), null);
});

test('참조 후보: 문장 맨 앞 좌변 대입(`Func = v`)만 반환값 대입으로 본다', () => {
    const at = (text: string, name: string) => isStatementLeadingAssignmentLHS(text, text.indexOf(name), name.length);
    assert.strictEqual(at('Scale = v * 2', 'Scale'), true);
    assert.strictEqual(at('    \tScale   = 3', 'Scale'), true);
    assert.strictEqual(at('x = Scale', 'Scale'), false, '우변은 아니다');
    assert.strictEqual(at('If Scale = 0 Then', 'Scale'), false, '비교문은 앞에 If 가 있다');
    assert.strictEqual(at('Scale == 1', 'Scale'), false, '합성 연산자');
    assert.strictEqual(at('Scale(1)', 'Scale'), false);
    assert.strictEqual(at('a = 1\n  Scale = 2', 'Scale'), true, '앞 줄은 보지 않는다');
});

test('참조 후보: isQualifiedAt 은 공백만 건너뛴 바로 앞이 점일 때만 true', () => {
    assert.strictEqual(isQualifiedAt('a.b', 2), true);
    assert.strictEqual(isQualifiedAt('a .\t b', 5), true);
    assert.strictEqual(isQualifiedAt('a. (b', 4), false);
    assert.strictEqual(isQualifiedAt('b', 0), false);
});

test('참조 후보: getQualifierBefore 는 바로 앞 점의 기반 객체 이름을 돌려준다', () => {
    const t = 'x = arr(i).Member';
    assert.strictEqual(getQualifierBefore(t, t.indexOf('Member')), 'arr');
    assert.strictEqual(getQualifierBefore('foo.bar', 'foo.bar'.indexOf('bar')), 'foo');
    assert.strictEqual(getQualifierBefore('Member', 0), undefined);
    // 몇 줄 위의 무관한 `foo.bar` 는 한정자가 아니다(2026 회귀)
    const multi = 'foo.bar\nMember';
    assert.strictEqual(getQualifierBefore(multi, multi.indexOf('Member')), undefined);
});

test('참조 후보: qualifierBeforeWord 는 커서 단어 앞 마지막 점의 기반 객체', () => {
    assert.strictEqual(qualifierBeforeWord('Util.Scale(1)', 5), 'Util');
    assert.strictEqual(qualifierBeforeWord('x = steps(i).Run', 'x = steps(i).'.length), 'steps');
    assert.strictEqual(qualifierBeforeWord('Scale(1)', 0), undefined);
});

test('참조 후보: 멤버 스코프 필터 — 클래스 멤버 검색일 때만 한정자 종류로 가른다', () => {
    const lookup = (table: Record<string, GPLSymbol>) => (name: string) => table[name.toLowerCase()];
    const find = lookup({
        csl: sym({ name: 'CSL', kind: 'module' }),
        pump: sym({ name: 'Pump', kind: 'class' }),
        other: sym({ name: 'Other', kind: 'class' }),
        p: sym({ name: 'p', kind: 'variable', returnType: 'Pump' }),
        arr: sym({ name: 'arr', kind: 'variable', returnType: 'Pump[]' }),
        q: sym({ name: 'q', kind: 'variable', returnType: 'Other' }),
        untyped: sym({ name: 'untyped', kind: 'variable' }),
    });
    const accept = (text: string, cls?: string) =>
        shouldAcceptByMemberScope(find, 'f.gpl', text, text.indexOf('Start'), cls);
    assert.strictEqual(accept('q.Start', undefined), true, '클래스 멤버 검색이 아니면 항상 통과');
    assert.strictEqual(accept('Start', 'Pump'), true, '한정자 없는 사용');
    assert.strictEqual(accept('unknown.Start', 'Pump'), true, '색인에 없는 로컬은 보존');
    assert.strictEqual(accept('CSL.Start', 'Pump'), false, '모듈 한정자는 클래스 멤버가 아니다');
    assert.strictEqual(accept('Pump.Start', 'Pump'), true);
    assert.strictEqual(accept('pump.Start', 'PUMP'), true, '대소문자 무시');
    assert.strictEqual(accept('Other.Start', 'Pump'), false, '다른 클래스의 정적 사용');
    assert.strictEqual(accept('p.Start', 'Pump'), true);
    assert.strictEqual(accept('q.Start', 'Pump'), false, '반환 타입이 다른 인스턴스');
    assert.strictEqual(accept('arr(2).Start', 'Pump'), true, '배열 요소 타입');
    assert.strictEqual(accept('untyped.Start', 'Pump'), true, '타입을 모르면 보존');
});

test('참조 후보: computeLineStarts·physicalLineText — CRLF/LF/CR 혼합을 물리 줄로 나눈다', () => {
    const text = 'a\r\nbb\rccc\n\nd';
    const starts = computeLineStarts(text);
    assert.deepStrictEqual(starts, [0, 3, 6, 10, 11]);
    assert.deepStrictEqual(starts.map((_, i) => physicalLineText(text, starts, i)), ['a', 'bb', 'ccc', '', 'd']);
    assert.deepStrictEqual(computeLineStarts(''), [0]);
});

test('참조 후보: memberOffsetInMatch 는 한정자 접두어를 건너뛰고 못 찾으면 0', () => {
    assert.strictEqual(memberOffsetInMatch('Util.Scale', 'scale'), 5);
    assert.strictEqual(memberOffsetInMatch('Scale.Scale', 'Scale'), 6, '마지막 출현이 멤버');
    assert.strictEqual(memberOffsetInMatch('abc', 'zzz'), 0);
});
