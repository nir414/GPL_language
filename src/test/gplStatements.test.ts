import * as assert from 'assert';
import { test } from './harness';
import { GPL_STATEMENT_SNIPPETS, GPL_KEYWORDS, getApplicableStatements } from '../gplStatements';
import { GplBlockContext, GplBlockKind, GplScope } from '../language/blockContext';

/**
 * 문 스니펫 테이블의 무결성 + 스코프 필터 회귀 테스트.
 *
 * 스니펫은 사용자가 코드를 실제로 삽입하는 데이터라 오타가 곧 잘못된 GPL 코드가 된다.
 * 따라서 표기 규칙(라벨이 키워드로 시작, `${}` 균형, GPL 고유 종결어)을 기계로 잡는다.
 */

function ctx(scope: GplScope, openBlocks: GplBlockKind[] = []): GplBlockContext {
    return { scope, openBlocks };
}

function labelsOf(scope: GplScope, openBlocks: GplBlockKind[] = []): string[] {
    return getApplicableStatements(ctx(scope, openBlocks)).map(s => s.label);
}

test('statements: 라벨이 중복되지 않는다', () => {
    const seen = new Set<string>();
    for (const s of GPL_STATEMENT_SNIPPETS) {
        assert.ok(!seen.has(s.label), `중복 라벨: ${s.label}`);
        seen.add(s.label);
    }
});

test('statements: 라벨의 첫 낱말이 스니펫 본문의 키워드와 같다 (접두사 입력으로 걸러지도록)', () => {
    // 선언문 본문은 관용적 기본값으로 접근 수식어를 앞에 붙인다(`Public Sub …`).
    // 라벨은 키워드로 시작해야 하므로, 수식어를 걷어낸 뒤 비교한다.
    const MODIFIERS = /^(?:(?:Public|Private|Shared|ReadOnly|WriteOnly)\s+)*/i;
    for (const s of GPL_STATEMENT_SNIPPETS) {
        const labelHead = s.label.split(/[\s.(]/)[0];
        const bodyHead = s.body[0].replace(MODIFIERS, '').split(/[\s(]/)[0];
        assert.strictEqual(bodyHead, labelHead, `${s.label}: 본문 키워드가 "${bodyHead}"`);
    }
});

test('statements: 공식 문(Statement)·예외 처리 문을 빠짐없이 담는다', () => {
    // 출처: GPL Dictionary의 Statements Summary + Exception Handling Summary 표.
    // End/Loop/Next는 각 블록 스니펫이 함께 넣으므로 단독 항목을 두지 않는다.
    const REQUIRED = [
        'Call', 'Case', 'Class', 'Const', 'Delegate', 'Dim', 'Do', 'Else', 'ElseIf',
        'Exit', 'For', 'Function', 'Get', 'GoTo', 'If', 'Module', 'Property', 'ReDim',
        'Return', 'Select', 'Set', 'Sub', 'While',
        'Catch', 'Finally', 'Throw', 'Try',
    ];
    const heads = new Set(GPL_STATEMENT_SNIPPETS.map(s => s.label.split(/[\s.(]/)[0].toLowerCase()));
    const missing = REQUIRED.filter(k => !heads.has(k.toLowerCase()));
    assert.deepStrictEqual(missing, [], `문 스니펫 누락: ${missing.join(', ')}`);
});

test('statements: 본문·설명·detail 이 비어 있지 않다', () => {
    for (const s of GPL_STATEMENT_SNIPPETS) {
        assert.ok(s.body.length > 0, `${s.label}: 본문 없음`);
        assert.ok(s.body.every(line => typeof line === 'string'), `${s.label}: 본문 줄 타입`);
        assert.ok(s.detail.trim().length > 0, `${s.label}: detail 없음`);
        assert.ok(s.documentation.trim().length > 0, `${s.label}: documentation 없음`);
    }
});

test('statements: 스니펫 플레이스홀더의 중괄호가 균형을 이룬다', () => {
    for (const s of GPL_STATEMENT_SNIPPETS) {
        const text = s.body.join('\n');
        let depth = 0;
        for (let i = 0; i < text.length; i++) {
            if (text[i] === '$' && text[i + 1] === '{') {
                depth++;
                i++;
            } else if (text[i] === '}') {
                depth--;
                assert.ok(depth >= 0, `${s.label}: 닫는 중괄호가 더 많다`);
            }
        }
        assert.strictEqual(depth, 0, `${s.label}: \${} 균형이 맞지 않는다`);
        // `$1` / `${1:...}` 형태만 허용 — `$name` 같은 오타를 잡는다.
        for (const m of text.matchAll(/\$(?!\{)(.)/g)) {
            assert.ok(/[0-9]/.test(m[1]), `${s.label}: 잘못된 플레이스홀더 "$${m[1]}"`);
        }
    }
});

test('statements: sourceUrl 은 모두 공식 문서 https URL', () => {
    for (const s of GPL_STATEMENT_SNIPPETS) {
        assert.ok(s.sourceUrl, `${s.label}: sourceUrl 없음`);
        assert.ok(
            s.sourceUrl!.startsWith('https://www2.brooksautomation.com/'),
            `${s.label}: 공식 문서 URL 아님 (${s.sourceUrl})`
        );
    }
});

test('statements: GPL 고유 구문을 지킨다 (End While / Select / Set 괄호 절)', () => {
    const all = GPL_STATEMENT_SNIPPETS.map(s => s.body.join('\n')).join('\n');
    // While 종결어는 End While — Wend 를 삽입해서는 안 된다.
    assert.ok(/\bEnd While\b/.test(all), 'End While 스니펫이 있어야 한다');
    assert.ok(!/\bWend\b/.test(all), 'Wend 를 삽입하는 스니펫이 있으면 안 된다');
    // 다중 분기는 `Select match_value` — VB.NET식 `Select Case x` 를 삽입하지 않는다.
    assert.ok(!/Select Case /.test(all), 'Select Case 형태를 삽입하면 안 된다');
    // Property 의 Set 절은 괄호 절이 필수다.
    const setSnippets = GPL_STATEMENT_SNIPPETS.filter(s => /\bSet\b/.test(s.body.join('\n')));
    assert.ok(setSnippets.length > 0, 'Set 절 스니펫이 있어야 한다');
    for (const s of setSnippets) {
        assert.ok(/Set \(/.test(s.body.join('\n')), `${s.label}: Set 뒤 괄호 절이 없다`);
    }
});

test('statements: For 스니펫의 Next 가 제어 변수를 미러링한다', () => {
    const forSnippets = GPL_STATEMENT_SNIPPETS.filter(s => s.label.startsWith('For '));
    assert.ok(forSnippets.length >= 2, 'For / For Step 스니펫');
    for (const s of forSnippets) {
        const body = s.body.join('\n');
        assert.ok(/^For \$\{1:/.test(body), `${s.label}: 제어 변수가 \${1}`);
        assert.ok(/Next \$\{1:/.test(body), `${s.label}: Next 가 \${1} 을 미러링해야 한다`);
    }
});

test('scope: 파일 최상위에서는 Module/Class 만 제안한다', () => {
    const labels = labelsOf('file');
    assert.ok(labels.some(l => l.startsWith('Module')), 'Module 제안');
    assert.ok(labels.some(l => l.startsWith('Class')), 'Class 제안');
    assert.ok(!labels.some(l => l.startsWith('If ')), '프로시저 전용 If 는 제안하지 않는다');
    assert.ok(!labels.some(l => l.startsWith('Sub ')), 'Sub 는 Module/Class 안에서만');
    assert.ok(!labels.some(l => l.startsWith('Dim ')), 'Dim 은 Module/Class/프로시저 안에서만');
});

test('scope: Module/Class 본문에서는 선언문만 제안한다', () => {
    const labels = labelsOf('type', ['module']);
    assert.ok(labels.some(l => l.startsWith('Sub ')), 'Sub 제안');
    assert.ok(labels.some(l => l.startsWith('Function ')), 'Function 제안');
    assert.ok(labels.some(l => l.startsWith('Dim ')), 'Dim 제안');
    assert.ok(labels.some(l => l.startsWith('Const ')), 'Const 제안');
    assert.ok(!labels.some(l => l.startsWith('If ')), 'If 는 프로시저 안에서만');
    assert.ok(!labels.some(l => l.startsWith('Module')), '중첩 Module 은 제안하지 않는다');
});

test('scope: 프로시저 본문에서는 제어 구조를 제안하고 선언문 헤더는 제안하지 않는다', () => {
    const labels = labelsOf('procedure', ['module', 'sub']);
    assert.ok(labels.some(l => l.startsWith('If ')), 'If 제안');
    assert.ok(labels.some(l => l.startsWith('Select ')), 'Select 제안');
    assert.ok(labels.some(l => l.startsWith('While ')), 'While 제안');
    assert.ok(labels.some(l => l.startsWith('Try ')), 'Try 제안');
    assert.ok(labels.some(l => l.startsWith('Dim ')), 'Dim 은 프로시저 안에서도 유효');
    assert.ok(!labels.some(l => l.startsWith('Sub ')), '프로시저 안에 프로시저를 넣을 수 없다');
    assert.ok(!labels.some(l => l.startsWith('Property ')), 'Property 는 Class 본문에서만');
});

test('scope: Exit/Else/Case 는 해당 블록이 열려 있을 때만 제안한다', () => {
    const inSub = labelsOf('procedure', ['module', 'sub']);
    assert.ok(!inSub.includes('Exit For'), 'For 밖에서 Exit For 를 제안하면 안 된다');
    assert.ok(!inSub.includes('Else'), 'If 밖에서 Else 를 제안하면 안 된다');
    assert.ok(!inSub.includes('Case ...'), 'Select 밖에서 Case 를 제안하면 안 된다');
    assert.ok(inSub.includes('Exit Sub'), 'Sub 안에서는 Exit Sub 제안');

    const inFor = labelsOf('procedure', ['module', 'sub', 'for']);
    assert.ok(inFor.includes('Exit For'), 'For 안에서는 Exit For 제안');

    const inIf = labelsOf('procedure', ['module', 'sub', 'if']);
    assert.ok(inIf.includes('Else'), 'If 안에서는 Else 제안');
    assert.ok(inIf.includes('ElseIf ... Then'), 'If 안에서는 ElseIf 제안');

    const inSelect = labelsOf('procedure', ['module', 'sub', 'select']);
    assert.ok(inSelect.includes('Case ...'), 'Select 안에서는 Case 제안');
    assert.ok(inSelect.includes('Case Else'), 'Select 안에서는 Case Else 제안');

    const inTry = labelsOf('procedure', ['module', 'sub', 'try']);
    assert.ok(inTry.includes('Finally'), 'Try 안에서는 Finally 제안');
    assert.ok(inTry.includes('Exit Try'), 'Try 안에서는 Exit Try 제안');
});

test('scope: Get/Set 절은 Property 안에서만, 이미 열린 접근자 안에서는 제안하지 않는다', () => {
    const inProperty = labelsOf('procedure', ['class', 'property']);
    assert.ok(inProperty.includes('Get ... End Get'), 'Property 안에서 Get 제안');
    assert.ok(inProperty.includes('Set ... End Set'), 'Property 안에서 Set 제안');

    const inGet = labelsOf('procedure', ['class', 'property', 'get']);
    assert.ok(!inGet.includes('Get ... End Get'), 'Get 안에서 다시 Get 을 제안하면 안 된다');

    const inSub = labelsOf('procedure', ['module', 'sub']);
    assert.ok(!inSub.includes('Get ... End Get'), 'Sub 안에서 Get 을 제안하면 안 된다');
});

test('keywords: 이름이 중복되지 않고 설명이 붙어 있다', () => {
    const seen = new Set<string>();
    for (const kw of GPL_KEYWORDS) {
        const key = kw.name.toLowerCase();
        assert.ok(!seen.has(key), `중복 키워드: ${kw.name}`);
        seen.add(key);
        assert.ok(/^[A-Za-z]+$/.test(kw.name), `키워드 표기: ${kw.name}`);
        assert.ok(kw.detail.trim().length > 0, `${kw.name}: 설명 없음`);
    }
});

test('keywords: 문서에 근거가 있는 원시 타입과 낱말 연산자를 모두 담는다', () => {
    const names = new Set(GPL_KEYWORDS.map(k => k.name));
    // Sub/Function/Dim 문서의 primitive type keywords
    for (const t of ['Boolean', 'Byte', 'Double', 'Integer', 'Short', 'Single']) {
        assert.ok(names.has(t), `원시 타입 누락: ${t}`);
    }
    // Arithmetic Expressions 우선순위 표의 낱말 연산자
    for (const op of ['Mod', 'Is', 'Not', 'And', 'AndAlso', 'Or', 'OrElse', 'Xor']) {
        assert.ok(names.has(op), `연산자 누락: ${op}`);
    }
});
