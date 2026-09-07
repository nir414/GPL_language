import * as assert from 'assert';
import { test } from './harness';
import {
    GPL_BUILTIN_RECEIVERS,
    GPL_DICTIONARY_ROOT_URL,
    findGplBuiltin,
    findGplBuiltinMember,
    findGplClassDoc,
    getAllGplBuiltins,
    getGplBuiltinClassNames,
    getGplBuiltinReferenceUrl,
    getGplClassMembers,
    isGplBuiltinClassName,
} from '../language/gplBuiltins';
import { GPL_CLASS_DOCS } from '../language/gplDictionaryData';

// gplBuiltins 는 사전 데이터(gplDictionaryData) 위의 조회 API — 호버·완성·시그니처·정의 이동·디버그 hover 게이트가 모두 쓴다.
// 데이터 형식은 gplDictionaryData.test 가 보고, 여기서는 **조회 규칙**과 코어 빌트인 + 사전의 합집합 무결성을 본다.

test('builtins 합집합: 이름은 대소문자 무시 유일, 필수 필드·출처 URL 이 모두 있다', () => {
    const all = getAllGplBuiltins();
    assert.ok(all.length > 300, `항목 수 ${all.length}`);
    const seen = new Map<string, string>();
    for (const e of all) {
        const key = e.name.toLowerCase();
        assert.ok(!seen.has(key), `중복 이름: ${e.name} (이전: ${seen.get(key)})`);
        seen.set(key, e.name);
        assert.ok(e.signature && e.summary && e.category, `필수 필드 누락: ${e.name}`);
        assert.ok(['function', 'method', 'property'].includes(e.kind), `kind: ${e.name} ${e.kind}`);
        assert.ok(e.sourceUrl?.startsWith(GPL_DICTIONARY_ROOT_URL), `출처 URL: ${e.name} → ${e.sourceUrl}`);
    }
});

test('findGplBuiltin: 정규형(Class.Member)은 대소문자 무시로 찾고, bare 이름은 최상위 함수만 허용', () => {
    assert.strictEqual(findGplBuiltin('math.abs')?.name, 'Math.Abs');
    assert.strictEqual(findGplBuiltin('CINT')?.name, 'CInt', '코어 함수는 bare 이름으로 찾는다');
    // 클래스 멤버는 GPL 에서 항상 `Class.` 접두가 필요하므로 bare 단어(Abs·Sleep)와 매칭하면 동명의 사용자 식별자를 오인한다.
    assert.strictEqual(findGplBuiltin('Abs'), undefined);
    assert.strictEqual(findGplBuiltin('Sleep'), undefined);
    assert.strictEqual(findGplBuiltin('   '), undefined);
    assert.strictEqual(findGplBuiltin('NoSuchThing'), undefined);
});

test('findGplBuiltin: 최상위 함수 tail 이 겹치지 않는다(겹치면 bare 조회가 조용히 undefined 가 된다)', () => {
    const tails = new Map<string, string[]>();
    for (const e of getAllGplBuiltins()) {
        if (e.kind !== 'function') { continue; }
        const tail = (e.name.includes('.') ? e.name.split('.').pop()! : e.name).toLowerCase();
        tails.set(tail, [...(tails.get(tail) ?? []), e.name]);
    }
    const ambiguous = [...tails].filter(([, names]) => names.length > 1);
    assert.deepStrictEqual(ambiguous, [], `tail 이 겹치는 함수: ${ambiguous.map(([t, n]) => `${t}=${n.join('/')}`).join(', ')}`);
});

test('클래스 이름 집합: 사전 항목의 접두부 + 클래스 개요 문서 — 대소문자 무시, 모든 클래스 문서에 멤버가 있다', () => {
    const names = getGplBuiltinClassNames();
    assert.ok(names.size >= 20, `클래스 수 ${names.size}`);
    assert.strictEqual(isGplBuiltinClassName('THREAD'), true);
    assert.strictEqual(isGplBuiltinClassName('math'), true);
    assert.strictEqual(isGplBuiltinClassName('Foo'), false);
    assert.strictEqual(isGplBuiltinClassName(''), false);
    for (const doc of GPL_CLASS_DOCS) {
        assert.ok(getGplClassMembers(doc.name).length > 0, `클래스 문서만 있고 멤버 항목이 없다: ${doc.name}`);
        assert.strictEqual(findGplClassDoc(doc.name.toUpperCase())?.name, doc.name);
    }
    for (const prefix of new Set(getAllGplBuiltins().filter(e => e.name.includes('.')).map(e => e.name.split('.')[0]))) {
        assert.ok(findGplClassDoc(prefix), `멤버 항목은 있는데 클래스 개요 문서가 없다: ${prefix}`);
    }
});

test('getGplClassMembers / findGplBuiltinMember: Class. 접두 매칭, 미지 클래스는 빈 결과·undefined', () => {
    const thread = getGplClassMembers('thread');
    assert.ok(thread.length > 0);
    assert.ok(thread.every(e => e.name.toLowerCase().startsWith('thread.')), thread.map(e => e.name).join(','));
    assert.deepStrictEqual(getGplClassMembers('Foo'), []);
    assert.strictEqual(findGplBuiltinMember('Thread', 'Sleep')?.name, 'Thread.Sleep');
    assert.strictEqual(findGplBuiltinMember('thread', 'currentthread')?.returnType, 'Thread', '멤버 체인 해석용 returnType');
    assert.strictEqual(findGplBuiltinMember('Foo', 'X'), undefined, '내장 클래스가 아니면 사용자 심볼 조회로 폴백하도록 undefined');
    assert.strictEqual(findGplBuiltinMember('', 'X'), undefined);
});

test('GPL_BUILTIN_RECEIVERS: receiverType 에 물려주는 어댑터가 사전과 같은 답을 준다', () => {
    assert.strictEqual(GPL_BUILTIN_RECEIVERS.isClassName('Thread'), true);
    assert.strictEqual(GPL_BUILTIN_RECEIVERS.isClassName('MyClass'), false);
    assert.strictEqual(GPL_BUILTIN_RECEIVERS.memberReturnType('Thread', 'CurrentThread'), 'Thread');
    assert.strictEqual(GPL_BUILTIN_RECEIVERS.memberReturnType('Thread', 'NoSuchMember'), undefined);
});

test('getGplBuiltinReferenceUrl: sourceUrl 이 없으면 사전 루트로 폴백', () => {
    const entry = getAllGplBuiltins()[0];
    assert.strictEqual(getGplBuiltinReferenceUrl(entry), entry.sourceUrl);
    assert.strictEqual(getGplBuiltinReferenceUrl({ ...entry, sourceUrl: undefined }), GPL_DICTIONARY_ROOT_URL);
});
