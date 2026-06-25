import * as assert from 'assert';
import { test } from './harness';
import { GPL_DICTIONARY_ENTRIES } from '../gplDictionaryData';

// gplDictionaryData는 `import type`만 사용하므로 vscode 의존 없이 로드된다.
// 이 테스트는 GPL Dictionary 데이터의 형식 회귀(누락 필드/중복/잘못된 출처)를 잡는다.

const ALLOWED_KINDS = new Set(['function', 'method', 'property']);
const DICTIONARY_HOST = 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/';

test('모든 항목이 필수 필드를 갖는다', () => {
    for (const e of GPL_DICTIONARY_ENTRIES) {
        assert.ok(e.name && e.name.trim().length > 0, `name 누락: ${JSON.stringify(e)}`);
        assert.ok(e.signature && e.signature.trim().length > 0, `signature 누락: ${e.name}`);
        assert.ok(e.summary && e.summary.trim().length > 0, `summary 누락: ${e.name}`);
        assert.ok(e.category && e.category.trim().length > 0, `category 누락: ${e.name}`);
        assert.ok(ALLOWED_KINDS.has(e.kind), `허용되지 않은 kind(${e.kind}): ${e.name}`);
    }
});

test('항목 이름은 Class.Member 형식이며 대소문자 무시 중복이 없다', () => {
    const seen = new Map<string, string>();
    for (const e of GPL_DICTIONARY_ENTRIES) {
        assert.match(e.name, /^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/, `이름 형식 위반: ${e.name}`);
        const key = e.name.toLowerCase();
        assert.ok(!seen.has(key), `중복 이름: ${e.name} (이전: ${seen.get(key)})`);
        seen.set(key, e.name);
    }
});

test('모든 항목은 GPL Dictionary 출처 URL을 가진다', () => {
    for (const e of GPL_DICTIONARY_ENTRIES) {
        assert.ok(e.sourceUrl, `sourceUrl 누락: ${e.name}`);
        assert.ok(
            e.sourceUrl!.startsWith(DICTIONARY_HOST),
            `sourceUrl이 GPL Dictionary 경로가 아님: ${e.name} -> ${e.sourceUrl}`
        );
        assert.ok(e.sourceUrl!.endsWith('.htm'), `sourceUrl이 .htm 페이지가 아님: ${e.name} -> ${e.sourceUrl}`);
    }
});

test('insertSnippet 태브스톱은 균형 잡힌 형식을 갖는다', () => {
    for (const e of GPL_DICTIONARY_ENTRIES) {
        if (!e.insertSnippet) {
            continue;
        }
        const open = (e.insertSnippet.match(/\$\{/g) ?? []).length;
        const close = (e.insertSnippet.match(/\}/g) ?? []).length;
        assert.strictEqual(open, close, `태브스톱 괄호 불균형: ${e.name} -> ${e.insertSnippet}`);
    }
});

test('핵심 모션/로봇 항목이 존재한다(스모크)', () => {
    const names = new Set(GPL_DICTIONARY_ENTRIES.map(e => e.name));
    for (const expected of ['Move.Loc', 'Move.WaitForEOM', 'Robot.Where', 'Robot.Attached', 'Location.X', 'Profile.Speed', 'Signal.DIO']) {
        assert.ok(names.has(expected), `핵심 항목 누락: ${expected}`);
    }
});
