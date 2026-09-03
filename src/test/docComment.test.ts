import * as assert from 'assert';
import { test } from './harness';
import {
    buildDocCommentBlock,
    extractParamName,
    findCodeLineBelow,
    findSection,
    getParamDoc,
    isDecorativeRule,
    locateDocCommentBlock,
    mergeDocComment,
    parseDocComment,
    renderDocCommentMarkdown,
} from '../language/docComment';

// 문서화 주석 포맷(설명 + `# Parameters` / `# Returns` / `# Examples`)의 파싱·렌더링·골격 생성 회귀 검사.
// 파서가 수집하는 docComment는 줄 앞 `'`가 이미 제거된 상태이므로, 여기서도 같은 형태를 입력으로 쓴다.

const SAMPLE = [
    '값을 지정된 범위로 제한합니다.',
    '',
    '# Parameters',
    '- `value`: 제한할 값',
    '- `min`: 최솟값',
    '- `max`: 최댓값',
    '',
    '# Returns',
    '범위가 적용된 값',
    '',
    '# Examples',
    '```',
    'Dim result As Number',
    'result = Clamp(120, 0, 100)',
    "' result = 100",
    '```',
].join('\n');

test('parseDocComment: 설명과 섹션을 분리한다', () => {
    const doc = parseDocComment(SAMPLE);
    assert.strictEqual(doc.isStructured, true);
    assert.deepStrictEqual(doc.description, ['값을 지정된 범위로 제한합니다.']);
    assert.strictEqual(doc.summary, '값을 지정된 범위로 제한합니다.');
    assert.deepStrictEqual(doc.sections.map(s => s.kind), ['parameters', 'returns', 'examples']);
});

test('parseDocComment: Parameters 항목을 이름/설명으로 파싱한다', () => {
    const params = findSection(parseDocComment(SAMPLE), 'parameters')!.params;
    assert.deepStrictEqual(params, [
        { name: 'value', text: '제한할 값' },
        { name: 'min', text: '최솟값' },
        { name: 'max', text: '최댓값' },
    ]);
    assert.strictEqual(getParamDoc(parseDocComment(SAMPLE), 'MIN'), '최솟값');
});

test('parseDocComment: 항목 표기 변형(백틱 없음/대시 구분/이어지는 줄)을 받아들인다', () => {
    const doc = parseDocComment([
        '# 매개변수',
        '- speed - 이동 속도',
        '  (mm/s 단위)',
        '* `retry`: 재시도 횟수',
    ].join('\n'));
    const section = findSection(doc, 'parameters')!;
    assert.deepStrictEqual(section.params, [
        { name: 'speed', text: '이동 속도 (mm/s 단위)' },
        { name: 'retry', text: '재시도 횟수' },
    ]);
    // 별칭(한국어) 머리글도 parameters로 분류되지만 제목 원문은 보존한다.
    assert.strictEqual(section.title, '매개변수');
});

test('parseDocComment: 코드 펜스 안의 # 은 머리글로 보지 않는다', () => {
    const doc = parseDocComment([
        '설명',
        '',
        '# Examples',
        '```',
        '# 이건 머리글이 아니다',
        '```',
    ].join('\n'));
    assert.deepStrictEqual(doc.sections.map(s => s.title), ['Examples']);
    assert.strictEqual(findSection(doc, 'examples')!.lines.length, 3);
});

test('parseDocComment: 알 수 없는 머리글도 순서를 지켜 보존한다', () => {
    const doc = parseDocComment(['설명', '', '# Errors', '-1 : 실패'].join('\n'));
    const section = doc.sections[0];
    assert.strictEqual(section.kind, 'other');
    assert.strictEqual(section.title, 'Errors');
    assert.deepStrictEqual(section.lines, ['-1 : 실패']);
});

test('parseDocComment: 머리글이 없으면 전부 설명(옛 주석 호환)', () => {
    const doc = parseDocComment('Adds two integers.\nReturns the sum.');
    assert.strictEqual(doc.isStructured, false);
    assert.strictEqual(doc.sections.length, 0);
    assert.deepStrictEqual(doc.description, ['Adds two integers.', 'Returns the sum.']);
});

test('renderDocCommentMarkdown: summary 모드에서도 섹션은 표시한다', () => {
    const md = renderDocCommentMarkdown(SAMPLE, { descriptionMode: 'summary', maxDescriptionLines: 6 })!;
    assert.ok(md.startsWith('값을 지정된 범위로 제한합니다.'), md);
    assert.ok(md.includes('**Parameters**'), md);
    assert.ok(md.includes('- `value` — 제한할 값'), md);
    assert.ok(md.includes('**Returns**'), md);
    assert.ok(md.includes('범위가 적용된 값'), md);
    assert.ok(md.includes('**Examples**'), md);
    assert.ok(md.includes('result = Clamp(120, 0, 100)'), md);
});

test('renderDocCommentMarkdown: maxDescriptionLines는 설명에만 적용된다', () => {
    const raw = ['한 줄', '두 줄', '세 줄', '', '# Returns', '반환값'].join('\n');
    const md = renderDocCommentMarkdown(raw, { descriptionMode: 'full', maxDescriptionLines: 2 })!;
    assert.ok(md.includes('한 줄'), md);
    assert.ok(!md.includes('세 줄'), md);
    assert.ok(md.includes('…'), md);
    assert.ok(md.includes('**Returns**'), md);
});

test('renderDocCommentMarkdown: 언어 표기 없는 여는 펜스에 gpl을 붙여 강조되게 한다', () => {
    const md = renderDocCommentMarkdown(SAMPLE, { descriptionMode: 'full' })!;
    assert.ok(md.includes('```gpl'), md);
    // 닫는 펜스는 그대로 — 언어가 이미 있으면 건드리지 않는다.
    assert.ok(md.trimEnd().endsWith('```'), md);
    const tagged = renderDocCommentMarkdown('# Examples\n```vb\nx = 1\n```', { descriptionMode: 'full' })!;
    assert.ok(tagged.includes('```vb'), tagged);
    assert.ok(!tagged.includes('```gpl'), tagged);
});

test('renderDocCommentMarkdown: 펜스 중간에서 잘려도 코드 블록이 열린 채 끝나지 않는다', () => {
    const raw = ['설명 줄', '```', 'x = 1', 'y = 2', '```', '꼬리'].join('\n');
    const md = renderDocCommentMarkdown(raw, { descriptionMode: 'full', maxDescriptionLines: 3 })!;
    const fences = md.match(/^\s*(```|~~~)/gm) ?? [];
    assert.strictEqual(fences.length % 2, 0, md);
    // 안내 문구는 코드 블록 밖에 있어야 한다.
    assert.ok(md.indexOf('…') > md.lastIndexOf('```'), md);
    // 자르지 않으면 원문 그대로(닫는 펜스를 덧붙이지 않는다).
    const full = renderDocCommentMarkdown(raw, { descriptionMode: 'full' })!;
    assert.strictEqual((full.match(/```/g) ?? []).length, 2, full);
    assert.ok(full.endsWith('꼬리'), full);
});

test('renderDocCommentMarkdown: 닫는 펜스를 빼먹은 섹션도 보정한다', () => {
    const md = renderDocCommentMarkdown('# Examples\n```\nx = 1', { descriptionMode: 'full' })!;
    assert.ok(md.includes('```gpl\nx = 1\n```'), md);
});

test('isDecorativeRule: 구두점만 있는 줄만 장식선으로 본다', () => {
    for (const line of ['========', '--------', '***', '* * *', '#####', '//////', '____', '# ====']) {
        assert.ok(isDecorativeRule(line), line);
    }
    for (const line of ['', '--', '# Parameters', '- `s`: 값', '...', ':::', '```', '~~~', '값 = 1']) {
        assert.ok(!isDecorativeRule(line), line);
    }
});

test('renderDocCommentMarkdown: 옛 ASCII 박스 주석이 setext 머리글로 깨지지 않는다', () => {
    const raw = [
        '========================================',
        '[2] SafeTrim - None 안전 Trim',
        '========================================',
        '용도: Nothing 체크 + Trim 한 번에',
    ].join('\n');
    const doc = parseDocComment(raw);
    // 파싱 원문은 손실 없이 보존한다(주석 편집이 줄 인덱스에 의존).
    assert.strictEqual(doc.lines.length, 4);
    assert.strictEqual(doc.isStructured, false);
    assert.strictEqual(doc.summary, '[2] SafeTrim - None 안전 Trim 용도: Nothing 체크 + Trim 한 번에');

    const md = renderDocCommentMarkdown(raw, { descriptionMode: 'summary', maxDescriptionLines: 6 })!;
    assert.ok(!md.includes('==='), md);
    assert.strictEqual(md, '[2] SafeTrim - None 안전 Trim  \n용도: Nothing 체크 + Trim 한 번에');
});

test('renderDocCommentMarkdown: 장식선은 섹션 본문·파라미터 항목에서도 걸러진다', () => {
    const raw = [
        '설명.',
        '----------',
        '# Parameters',
        '- `s`: 다듬을 문자열',
        '----------',
        '# Examples',
        '```',
        "' 표 구분선은 예제 안에서는 내용이다",
        '----------',
        '```',
    ].join('\n');
    const doc = parseDocComment(raw);
    assert.deepStrictEqual(doc.sections.map(s => s.kind), ['parameters', 'examples']);
    assert.deepStrictEqual(findSection(doc, 'parameters')!.params, [{ name: 's', text: '다듬을 문자열' }]);

    const md = renderDocCommentMarkdown(raw, { descriptionMode: 'full' })!;
    assert.ok(md.startsWith('설명.'), md);
    assert.ok(md.includes('- `s` — 다듬을 문자열'), md);
    // 펜스 안의 구분선은 그대로 남는다.
    assert.ok(md.includes('```gpl\n'), md);
    assert.strictEqual((md.match(/^-{10}$/gm) ?? []).length, 1, md);
});

test('renderDocCommentMarkdown: includeKinds로 섹션을 걸러낸다', () => {
    const md = renderDocCommentMarkdown(SAMPLE, { descriptionMode: 'full', includeKinds: ['returns'] })!;
    assert.ok(md.includes('**Returns**'), md);
    assert.ok(!md.includes('**Parameters**'), md);
});

test('renderDocCommentMarkdown: 내용이 없으면 undefined', () => {
    assert.strictEqual(renderDocCommentMarkdown('   \n  '), undefined);
});

test('extractParamName: 수식어/배열/기본값이 붙어도 이름만 뽑는다', () => {
    assert.strictEqual(extractParamName('value As Number'), 'value');
    assert.strictEqual(extractParamName('ByRef settings() As AxisZeroSetting'), 'settings');
    assert.strictEqual(extractParamName('Optional speed As Integer = 10'), 'speed');
    assert.strictEqual(extractParamName('ParamArray vals() As Integer'), 'vals');
});

test('buildDocCommentBlock: Function은 설명 + Parameters + Returns 골격', () => {
    const lines = buildDocCommentBlock({
        kind: 'function',
        name: 'Clamp',
        parameters: ['value As Number', 'min As Number', 'max As Number'],
        returnType: 'Number',
    });
    assert.deepStrictEqual(lines, [
        "' Clamp 설명",
        "'",
        "' # Parameters",
        "' - `value`: 설명",
        "' - `min`: 설명",
        "' - `max`: 설명",
        "'",
        "' # Returns",
        "' Number 반환값 설명",
    ]);
});

test('buildDocCommentBlock: 파라미터 없는 Sub은 설명만', () => {
    assert.deepStrictEqual(
        buildDocCommentBlock({ kind: 'sub', name: 'Home', parameters: [] }),
        ["' Home 설명"]
    );
});

test('buildDocCommentBlock: snippet 모드는 placeholder와 $0을 넣는다', () => {
    const lines = buildDocCommentBlock(
        { kind: 'function', name: 'Add', parameters: ['a As Integer'], returnType: 'Integer' },
        { snippet: true }
    );
    assert.strictEqual(lines[0], "' ${1:Add 설명}");
    assert.strictEqual(lines[3], "' - `a`: ${2:설명}");
    assert.ok(lines[lines.length - 1].endsWith('$0'), lines[lines.length - 1]);
});

test('buildDocCommentBlock: includeExamples면 호출 예시 코드 펜스를 넣는다', () => {
    const lines = buildDocCommentBlock(
        { kind: 'function', name: 'Add', parameters: ['a As Integer', 'b As Integer'], returnType: 'Integer' },
        { includeExamples: true }
    );
    assert.ok(lines.includes("' # Examples"));
    assert.ok(lines.includes("' result = Add(a, b)"), lines.join('|'));
});

test('mergeDocComment: 빠진 매개변수 항목만 덧붙인다', () => {
    const existing = parseDocComment(['설명', '', '# Parameters', '- `a`: 첫 값'].join('\n'));
    const { insertions, added } = mergeDocComment(existing, {
        kind: 'function',
        name: 'Add',
        parameters: ['a As Integer', 'b As Integer'],
    });
    assert.strictEqual(insertions.length, 1);
    assert.strictEqual(insertions[0].atIndex, 4);
    assert.deepStrictEqual(insertions[0].lines, ['- `b`: ']);
    assert.deepStrictEqual(added, ['매개변수 `b`']);
});

test('mergeDocComment: 섹션이 없으면 Parameters를 Returns 앞에 끼워 넣는다', () => {
    const existing = parseDocComment(['설명', '', '# Returns', '합'].join('\n'));
    const { insertions } = mergeDocComment(existing, {
        kind: 'function',
        name: 'Add',
        parameters: ['a As Integer'],
        returnType: 'Integer',
    });
    assert.strictEqual(insertions.length, 1);
    assert.strictEqual(insertions[0].atIndex, 2); // '# Returns' 줄 앞
    assert.deepStrictEqual(insertions[0].lines, ['', '# Parameters', '- `a`: ', '']);
});

test('mergeDocComment: 더할 것이 없으면 빈 결과', () => {
    const existing = parseDocComment(['설명', '', '# Parameters', '- `a`: 첫 값'].join('\n'));
    const { insertions } = mergeDocComment(existing, { kind: 'sub', name: 'Do', parameters: ['a As Integer'] });
    assert.strictEqual(insertions.length, 0);
});

test('mergeDocComment: 문서 끝에 Returns 섹션을 추가한다', () => {
    const existing = parseDocComment(['설명'].join('\n'));
    const { insertions, added } = mergeDocComment(existing, {
        kind: 'property',
        name: 'Speed',
        returnType: 'Integer',
    });
    assert.strictEqual(insertions.length, 1);
    assert.strictEqual(insertions[0].atIndex, 1);
    assert.deepStrictEqual(insertions[0].lines, ['', '# Returns', '']);
    assert.deepStrictEqual(added, ['Returns 섹션']);
});

// --- 문서 안에서 대상 선언·주석 블록 찾기 (편집기 연동의 순수 부분) ---

const DOC_LINES = [
    'Module M',                                   // 0
    '',                                           // 1
    "    ' 두 값을 더한다.",                       // 2
    "    '",                                      // 3
    "    ' # Parameters",                         // 4
    '    Public Function Add(a As Integer) As Integer', // 5
    '        Return a',                           // 6
    '    End Function',                           // 7
    '',                                           // 8
    '    Public Sub Home()',                      // 9
    '    End Sub',                                // 10
];
const getLine = (i: number) => DOC_LINES[i];

test('findCodeLineBelow: 주석을 건너뛰고 첫 코드 줄을 찾는다', () => {
    assert.strictEqual(findCodeLineBelow(getLine, DOC_LINES.length, 2), 5);
    assert.strictEqual(findCodeLineBelow(getLine, DOC_LINES.length, 5), 5);
});

test('findCodeLineBelow: stopAtBlank면 빈 줄에서 멈춘다(주석이 붙지 않는 위치)', () => {
    assert.strictEqual(findCodeLineBelow(getLine, DOC_LINES.length, 8, { stopAtBlank: true }), undefined);
    assert.strictEqual(findCodeLineBelow(getLine, DOC_LINES.length, 8), 9);
});

test('locateDocCommentBlock: 선언 위 연속 주석을 접두사 제거해 모은다', () => {
    const block = locateDocCommentBlock(getLine, 5)!;
    assert.strictEqual(block.startLine, 2);
    assert.deepStrictEqual(block.lines, ['두 값을 더한다.', '', '# Parameters']);
    // 모은 줄은 그대로 parseDocComment 입력이 된다.
    assert.strictEqual(parseDocComment(block.lines.join('\n')).sections.length, 1);
});

test('locateDocCommentBlock: 주석이 없으면 undefined', () => {
    assert.strictEqual(locateDocCommentBlock(getLine, 9), undefined);
});
