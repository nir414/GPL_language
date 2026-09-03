import * as assert from 'assert';
import { test } from './harness';
import { GPL_DICTIONARY_ENTRIES, GPL_CLASS_DOCS } from '../gplDictionaryData';

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

// ─── Thread Class (GPL Dictionary /Thread/ 디렉터리 전수 반영, 2026-08-28) ──────────────
// 공식 디렉터리의 페이지 목록과 1:1로 맞춰, 새 멤버가 누락되거나 출처가 어긋나면 실패한다.
// threadintro.htm(클래스 개요)과 new.htm(생성자)은 멤버가 아니라 GPL_CLASS_DOCS가 담당한다.
const THREAD_MEMBER_PAGES: Record<string, string> = {
    'Thread.Abort': 'abort.htm',
    'Thread.Argument': 'argument.htm',
    'Thread.CurrentThread': 'currentthread.htm',
    'Thread.Join': 'join.htm',
    'Thread.Name': 'name.htm',
    'Thread.Project': 'project.htm',
    'Thread.Resume': 'resume.htm',
    'Thread.Schedule': 'schedule.htm',
    'Thread.SendEvent': 'sendevent.htm',
    'Thread.Sleep': 'sleep.htm',
    'Thread.Start': 'start.htm',
    'Thread.StartProcedure': 'startprocedure.htm',
    'Thread.Suspend': 'suspend.htm',
    'Thread.TestAndSet': 'testandset.htm',
    'Thread.ThreadState': 'threadstate.htm',
    'Thread.WaitEvent': 'waitevent.htm',
};

test('Thread Class: 공식 문서의 멤버 페이지를 빠짐없이, 각자 제 출처로 담는다', () => {
    const threadEntries = GPL_DICTIONARY_ENTRIES.filter(e => e.name.startsWith('Thread.'));
    const found = new Map(threadEntries.map(e => [e.name, e]));

    for (const [name, page] of Object.entries(THREAD_MEMBER_PAGES)) {
        const entry = found.get(name);
        assert.ok(entry, `Thread 멤버 누락: ${name} (${page})`);
        assert.ok(
            entry!.sourceUrl!.endsWith(`/Thread/${page}`),
            `출처 페이지 불일치: ${name} -> ${entry!.sourceUrl}`
        );
    }
    assert.strictEqual(
        threadEntries.length,
        Object.keys(THREAD_MEMBER_PAGES).length,
        `문서에 없는 Thread 항목이 있다: ${threadEntries.map(e => e.name).filter(n => !(n in THREAD_MEMBER_PAGES)).join(', ')}`
    );
});

test('Thread Class: 값 표가 있는 항목은 상세(details)를 담는다', () => {
    // 호버가 실제로 띄우는 정보 — 상태값·이벤트 비트·매개변수 범위가 빠지면 회귀.
    for (const name of ['Thread.ThreadState', 'Thread.WaitEvent', 'Thread.Schedule', 'Thread.Join']) {
        const e = GPL_DICTIONARY_ENTRIES.find(x => x.name === name);
        assert.ok(e?.details && e.details.includes('|'), `상세 표 누락: ${name}`);
    }
    const state = GPL_DICTIONARY_ENTRIES.find(x => x.name === 'Thread.ThreadState')!;
    for (const value of ['| -1 |', '| 0 |', '| 1 |', '| 2 |', '| 3 |', '| 4 |']) {
        assert.ok(state.details!.includes(value), `ThreadState 값 누락: ${value}`);
    }
});

test('usage는 있으면 공백이 아니고 멤버 이름을 포함한다', () => {
    for (const e of GPL_DICTIONARY_ENTRIES) {
        if (!e.usage) {
            continue;
        }
        assert.ok(e.usage.trim().length > 0, `usage 공백: ${e.name}`);
        const member = e.name.split('.').pop()!;
        assert.ok(e.usage.includes(member), `usage에 멤버 이름이 없음: ${e.name} -> ${e.usage}`);
    }
});

/**
 * 멤버가 이 파일이 아니라 `gplBuiltins.ts`의 GPL_CORE_BUILTINS에 등록된 클래스.
 * 이 테스트는 vscode 비의존이라 그 표(config.ts → vscode를 import)를 읽을 수 없어
 * "멤버 없는 개요" 검사에서만 예외로 둔다. 멤버가 없는 것이 아니라 표가 다른 것이다.
 */
const MEMBERS_IN_CORE_BUILTINS = new Set(['math']);

test('클래스 개요(GPL_CLASS_DOCS)는 필수 필드와 GPL Dictionary 출처를 갖는다', () => {
    const seen = new Set<string>();
    for (const c of GPL_CLASS_DOCS) {
        assert.match(c.name, /^[A-Za-z_][A-Za-z0-9_]*$/, `클래스 이름 형식 위반: ${c.name}`);
        assert.ok(!seen.has(c.name.toLowerCase()), `중복 클래스 개요: ${c.name}`);
        seen.add(c.name.toLowerCase());
        assert.ok(c.summary && c.summary.trim().length > 0, `summary 누락: ${c.name}`);
        assert.ok(c.sourceUrl.startsWith(DICTIONARY_HOST), `출처가 GPL Dictionary가 아님: ${c.name}`);
        assert.ok(c.sourceUrl.endsWith('.htm'), `출처가 .htm이 아님: ${c.name}`);
        // 개요만 있고 멤버가 하나도 없는 클래스는 데이터 오류
        if (!MEMBERS_IN_CORE_BUILTINS.has(c.name.toLowerCase())) {
            assert.ok(
                GPL_DICTIONARY_ENTRIES.some(e => e.name.toLowerCase().startsWith(c.name.toLowerCase() + '.')),
                `멤버가 없는 클래스 개요: ${c.name}`
            );
        }
    }
});

test('Thread 클래스 개요는 생성자 구문을 담는다', () => {
    const thread = GPL_CLASS_DOCS.find(c => c.name === 'Thread');
    assert.ok(thread, 'Thread 클래스 개요 누락');
    assert.ok(
        thread!.constructorSignature?.startsWith('New Thread('),
        `생성자 구문 누락/형식 오류: ${thread!.constructorSignature}`
    );
    for (const p of ['procedure_name', 'project_name', 'thread_name', 'stack_size']) {
        assert.ok(thread!.constructorSignature!.includes(p), `생성자 매개변수 누락: ${p}`);
    }
});

// ─── 멤버 체인·디버그 hover용 메타데이터 (2026-08-31) ─────────────────────────────────────
// returnType은 `Thread.CurrentThread.Name`의 `Name`을 Thread 멤버로 판정하기 위한 전제이고,
// sideEffectFree는 그 식을 제어기에서 평가(=실행)해도 안전하다는 표시다(evaluatableExpressionProvider).

test('Thread.CurrentThread는 반환 타입과 조회 전용 표시를 갖는다', () => {
    const byName = (n: string) => GPL_DICTIONARY_ENTRIES.find(e => e.name === n);
    const cur = byName('Thread.CurrentThread');
    assert.ok(cur, 'Thread.CurrentThread 항목 없음');
    assert.strictEqual(cur!.returnType, 'Thread');
    assert.strictEqual(cur!.sideEffectFree, true);
    assert.strictEqual(byName('Thread.Name')!.returnType, 'String');
    assert.strictEqual(byName('Thread.Project')!.returnType, 'String');
    // 상태를 바꾸는 메서드에는 조회 전용 표시를 붙이지 않는다(붙으면 hover가 그 식을 실행한다)
    for (const n of ['Thread.Abort', 'Thread.Sleep', 'Thread.Start', 'Thread.Suspend', 'Thread.Resume', 'Thread.SendEvent']) {
        assert.notStrictEqual(byName(n)?.sideEffectFree, true, `${n}에 sideEffectFree 표시`);
    }
});

test('returnType은 있으면 공백이 아닌 타입 이름이다', () => {
    for (const e of GPL_DICTIONARY_ENTRIES) {
        if (e.returnType === undefined) { continue; }
        assert.match(e.returnType, /^[A-Za-z_][A-Za-z0-9_]*(\[\]|\(\s*,*\s*\))?$/, `returnType 형식 위반: ${e.name} -> ${e.returnType}`);
    }
});

test('내장 클래스를 가리키는 returnType은 실제로 존재하는 클래스다', () => {
    // returnType은 수신자 체인 해석(`Latch.Result(1).Location`)의 유일한 근거다.
    // 오타가 나면 조용히 해석만 실패하므로(오류가 아님) 기계로 잡는다.
    const primitives = new Set(['boolean', 'byte', 'short', 'integer', 'long', 'single', 'double', 'string', 'object']);
    const classNames = new Set<string>();
    for (const c of GPL_CLASS_DOCS) {
        classNames.add(c.name.toLowerCase());
    }
    for (const e of GPL_DICTIONARY_ENTRIES) {
        const dot = e.name.indexOf('.');
        if (dot > 0) {
            classNames.add(e.name.slice(0, dot).toLowerCase());
        }
    }
    for (const e of GPL_DICTIONARY_ENTRIES) {
        if (!e.returnType) { continue; }
        const base = e.returnType.replace(/(\[\]|\(\s*,*\s*\))$/, '').toLowerCase();
        if (primitives.has(base)) { continue; }
        assert.ok(classNames.has(base), `returnType이 알 수 없는 클래스: ${e.name} -> ${e.returnType}`);
    }
});

test('클래스 개요는 GPL Dictionary의 클래스를 빠짐없이 담는다', () => {
    // 개요가 없으면 클래스 이름 위의 hover가 아무것도 띄우지 않는다.
    // 사전에 멤버가 등록된 클래스는 반드시 개요도 있어야 한다.
    const documented = new Set(GPL_CLASS_DOCS.map(c => c.name.toLowerCase()));
    const withMembers = new Set<string>();
    for (const e of GPL_DICTIONARY_ENTRIES) {
        const dot = e.name.indexOf('.');
        if (dot > 0) {
            withMembers.add(e.name.slice(0, dot).toLowerCase());
        }
    }
    const missing = [...withMembers].filter(n => !documented.has(n)).sort();
    assert.deepStrictEqual(missing, [], `클래스 개요 누락: ${missing.join(', ')}`);
});

test('생성자 구문이 있으면 New <클래스명> 형식이다', () => {
    for (const c of GPL_CLASS_DOCS) {
        if (!c.constructorSignature) { continue; }
        assert.ok(
            new RegExp(`^New\\s+${c.name}\\b`).test(c.constructorSignature),
            `생성자 구문이 클래스 이름과 맞지 않음: ${c.name} -> ${c.constructorSignature}`
        );
    }
});
