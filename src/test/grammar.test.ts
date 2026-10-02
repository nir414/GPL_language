import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { test } from './harness';
import { GPL_PROC_MODIFIERS } from '../language/cursorExpression';

// ─── TextMate 문법(syntaxes/gpl.tmGrammar.json) 구조 테스트 (§1-DT) ─────────────────
// 발단: `Public Delegate Sub LogSinkSub(ByVal line As String)` 의 `Delegate` 가 색이 없었다 — 확장 문법에도, 위임하는
// VS Code 내장 VB(ASP) 문법에도 없는 낱말이었다. 문법 파일은 파서 정본을 import 할 수 없으므로 여기서 대조한다.

interface GrammarRule { comment?: string; match?: string; captures?: Record<string, { name: string }>; include?: string }
interface Grammar { scopeName: string; patterns: GrammarRule[] }

function loadGrammar(): Grammar {
    const file = path.resolve(__dirname, '..', '..', 'syntaxes', 'gpl.tmGrammar.json');
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as Grammar;
}

/** Oniguruma `(?i)` 접두를 JS 의 `i` 플래그로 바꿔 컴파일한다(문법의 규칙은 그 외 Oniguruma 전용 구문을 쓰지 않는다). */
function toRegExp(match: string): RegExp {
    const ci = match.startsWith('(?i)');
    return new RegExp(ci ? match.slice(4) : match, ci ? 'i' : '');
}

/** 캡처 위치까지 보려면 `d`(hasIndices)·`g` 가 필요하다. */
function toScanner(match: string): RegExp {
    const ci = match.startsWith('(?i)');
    return new RegExp(ci ? match.slice(4) : match, 'dg' + (ci ? 'i' : ''));
}

interface Token { rule: string; text: string; scope: string; start: number; end: number }

/**
 * TextMate 의 토큰화를 문법의 `match` 규칙만으로 흉내 낸다 — **줄 안에서 가장 앞에서 시작하는 매치가 이기고**,
 * 같은 자리면 patterns 의 앞선 규칙이 이긴다. 내장 VB(ASP) 문법은 여기서 흉내 낼 수 없으므로 제외하지만,
 * 그쪽은 우리 규칙보다 뒤에 있어 "우리 규칙이 잘못 선점하는지"를 보는 데는 이 근사로 충분하다.
 */
function tokenize(g: Grammar, line: string): Token[] {
    const rules = g.patterns.filter(p => p.match).map(p => ({ comment: p.comment ?? '', re: toScanner(p.match!), captures: p.captures ?? {} }));
    const out: Token[] = [];
    let pos = 0;
    while (pos <= line.length) {
        let best: { rule: typeof rules[0]; m: RegExpExecArray } | undefined;
        for (const r of rules) {
            r.re.lastIndex = pos;
            const m = r.re.exec(line);
            if (!m || m[0].length === 0) { continue; }
            if (!best || m.index < best.m.index) { best = { rule: r, m }; }
        }
        if (!best) { break; }
        const indices = (best.m as RegExpExecArray & { indices?: Array<[number, number] | undefined> }).indices ?? [];
        for (let i = 1; i < best.m.length; i++) {
            const scope = best.rule.captures[String(i)];
            const span = indices[i];
            if (!scope || !span || best.m[i] === undefined) { continue; }
            out.push({ rule: best.rule.comment, text: best.m[i], scope: scope.name, start: span[0], end: span[1] });
        }
        pos = best.m.index + best.m[0].length;
    }
    return out;
}

function ruleOf(g: Grammar, commentPrefix: string): GrammarRule {
    const r = g.patterns.find(p => (p.comment ?? '').startsWith(commentPrefix));
    assert.ok(r && r.match, `문법 규칙 "${commentPrefix}" 이 있어야 한다`);
    return r!;
}

/** 선언 규칙의 수식어 대안 `(?:(?:A|B|C)\s+)*` 에서 A|B|C 를 뽑는다. */
function modifierSet(rule: GrammarRule): Set<string> {
    const m = rule.match!.match(/\(\?:\(\?:([A-Za-z|]+)\)\\s\+\)\*/);
    assert.ok(m, `수식어 그룹을 찾지 못함: ${rule.match}`);
    return new Set(m![1].split('|').map(s => s.toLowerCase()));
}

test('grammar: 모든 match 규칙이 정규식으로 컴파일되고 include 는 내장 VB 문법 하나뿐이다', () => {
    const g = loadGrammar();
    assert.strictEqual(g.scopeName, 'source.gpl');
    for (const p of g.patterns) {
        if (p.include) { assert.strictEqual(p.include, 'source.asp.vb.net'); continue; }
        assert.ok(p.match, `match 없는 규칙: ${p.comment}`);
        assert.doesNotThrow(() => toRegExp(p.match!), `컴파일 실패: ${p.comment}`);
        assert.ok(p.captures && Object.keys(p.captures).length > 0, `captures 없는 규칙: ${p.comment}`);
    }
    assert.strictEqual(g.patterns[g.patterns.length - 1].include, 'source.asp.vb.net', '위임 include 는 마지막이어야 GPL 규칙이 우선한다');
});

test('grammar: Sub/Function/Property 선언 규칙의 수식어 집합은 파서 정본 GPL_PROC_MODIFIERS 와 같다', () => {
    const g = loadGrammar();
    const expected = new Set(GPL_PROC_MODIFIERS.map(s => s.toLowerCase()));
    for (const prefix of ['Sub declaration', 'Function declaration', 'Property declaration']) {
        const got = modifierSet(ruleOf(g, prefix));
        assert.deepStrictEqual([...got].sort(), [...expected].sort(), `${prefix}: 수식어 집합이 파서와 다르다`);
    }
});

test('grammar: `Public Delegate Sub LogSinkSub(ByVal line As String)` — Delegate 규칙이 이름을 타입으로 잡는다', () => {
    const g = loadGrammar();
    const line = '\tPublic Delegate Sub LogSinkSub(ByVal line As String)';
    const m = line.match(toRegExp(ruleOf(g, 'Delegate declaration').match!));
    assert.ok(m, 'Delegate 선언 규칙이 매치해야 한다');
    assert.strictEqual(m![1].trim(), 'Public');
    assert.strictEqual(m![2], 'Delegate');
    assert.strictEqual(m![3], 'Sub');
    assert.strictEqual(m![4], 'LogSinkSub');
    const caps = ruleOf(g, 'Delegate declaration').captures!;
    assert.strictEqual(caps['2'].name, 'storage.type.delegate.gpl');
    assert.strictEqual(caps['4'].name, 'entity.name.type.delegate.gpl');
    // TextMate 는 같은 줄에서 **가장 앞에서 시작하는** 매치를 고른다. Sub 규칙은 ` Sub LogSinkSub` 에서 늦게 시작하고
    // Delegate 규칙은 줄 머리에서 시작하므로 Delegate 규칙이 이긴다(수식어 집합에 Delegate 를 넣지 않고도 가로채기가 없다).
    const del = toRegExp(ruleOf(g, 'Delegate declaration').match!).exec(line)!;
    const sub = toRegExp(ruleOf(g, 'Sub declaration').match!).exec(line);
    assert.ok(!sub || del.index < sub.index, 'Delegate 규칙이 Sub 규칙보다 앞에서 시작해야 한다');
    // Delegate Function 도 같은 규칙
    const f = '\tPrivate Delegate Function Comparer(a As Integer, b As Integer) As Integer'.match(toRegExp(ruleOf(g, 'Delegate declaration').match!));
    assert.strictEqual(f?.[4], 'Comparer');
});

test('grammar: 수식어가 여럿인 선언과 내장 문법이 모르는 키워드가 잡힌다', () => {
    const g = loadGrammar();
    const fn = '\tPublic Overrides Function Describe() As String'.match(toRegExp(ruleOf(g, 'Function declaration').match!));
    assert.strictEqual(fn?.[3], 'Describe');
    assert.strictEqual(fn?.[1].trim(), 'Public Overrides');
    const prop = '\tPublic Shared ReadOnly Property Count As Integer'.match(toRegExp(ruleOf(g, 'Property declaration').match!));
    assert.strictEqual(prop?.[3], 'Count');
    const cls = '\tPublic MustInherit Class LogSinkBase'.match(toRegExp(ruleOf(g, 'Class declaration').match!));
    assert.strictEqual(cls?.[3], 'LogSinkBase');

    const kw = toRegExp(ruleOf(g, 'Declaration modifiers').match!);
    for (const w of ['Shared', 'Overrides', 'ByVal', 'ByRef', 'Optional', 'ParamArray', 'Delegate', 'Preserve']) {
        assert.ok(kw.test(` ${w} `), `수식어 규칙이 ${w} 를 잡아야 한다`);
    }
    const ctl = toRegExp(ruleOf(g, 'Control-flow keywords').match!);
    for (const s of ['Try', 'Catch ex', 'Finally', 'Throw', 'Exit While', 'Exit Try', 'Case Else', 'GoTo']) {
        assert.ok(ctl.test(`\t${s}`), `제어 규칙이 "${s}" 를 잡아야 한다`);
    }
    const end = toRegExp(ruleOf(g, 'Block terminators').match!);
    for (const s of ['End Module', 'End Get', 'End Set', 'End Try', 'End While', 'End Select', 'End If']) {
        assert.ok(end.test(s), `종결 규칙이 "${s}" 를 잡아야 한다`);
    }
    const op = toRegExp(ruleOf(g, 'Operators missing').match!);
    assert.ok(op.test('New LogSinkSub(AddressOf OnLogLine)'));
    assert.ok(op.test('If x Is Nothing Then'));
    assert.ok(!op.test('IsConnected'), '식별자 일부(IsConnected)는 연산자가 아니다');
    const self = toRegExp(ruleOf(g, 'Object self references').match!);
    assert.ok(self.test('Me.Name') && self.test('MyBase.New()') && !self.test('Member'));
    const inh = '\t\tInherits LogSinkBase'.match(toRegExp(ruleOf(g, 'Inheritance keywords').match!));
    assert.strictEqual(inh?.[2], 'LogSinkBase');
});

// ─── 낱말 조각 오염 방지 (§1-DZ) ────────────────────────────────────────────────
// 발단: `Public SyncSub As TcpSyncCmdSub` 에서 식별자 `SyncSub` 안의 `Sub` 만 색이 달라졌다.
// 선언 규칙이 `(?i)\s*…(Sub)\s+(이름)` 이라 TextMate 가 줄 중간의 `Sub As` 를 "Sub 선언"으로 읽고
// `Sub` 를 키워드, 뒤따르는 `As` 를 프로시저 이름으로 칠한 것이다. Class/Module/Function/Property/Const
// 규칙도 같은 모양이라 `BaseClass`·`ItemProperty`·`MaxConst` 등에서 똑같이 깨졌다.

/** 낱말 조각 검사에 쓰는 코드 줄 — 키워드로 끝나는 식별자와 정상 선언을 섞어 둔다. */
const FRAGMENT_CORPUS = [
    '\t\tPublic SyncSub As TcpSyncCmdSub',
    '\t\tPublic AsyncSub As TcpAsyncCmdSub',
    '\t\tPublic CallbackFunction As LogSink',
    '\t\tPublic ItemProperty As Integer',
    '\t\tPublic MaxConst As Integer',
    '\t\tPublic BaseClass As Object',
    '\t\tPublic NetModule As Object',
    '\t\tPublic CmdDelegate As Object',
    '\t\tDim subTotal As Integer',
    '\t\tsubTotal = subTotal + 1',
    '\tPublic Sub Main()',
    '\tPublic Overrides Function Describe() As String',
    '\t\tPublic ReadOnly Property Count As Integer',
    '\tPublic MustInherit Class LogSinkBase',
    '\tPublic Delegate Sub LogSink(ByVal text As String)',
    '\t\tPublic Const SlotLimit As Integer = 3',
    '\t\tDim ex As New Exception',
];

test('grammar: 선언 규칙은 줄 머리(^)에 고정돼 있다 — 줄 중간의 낱말 조각을 선언으로 읽지 않도록', () => {
    const g = loadGrammar();
    for (const p of g.patterns) {
        if (!p.match || !(p.comment ?? '').includes('declaration')) { continue; }
        assert.ok(
            p.match.startsWith('(?i)^\\s*'),
            `선언 규칙 "${p.comment}" 은 (?i)^\\s* 로 시작해야 한다 — \\s* 만 두면 식별자 중간(예: SyncSub 의 Sub)에 걸린다`
        );
    }
});

test('grammar: 어떤 규칙도 식별자 안의 낱말 조각을 잡지 않는다', () => {
    const g = loadGrammar();
    const lines = [...FRAGMENT_CORPUS];
    const sampleDir = path.resolve(__dirname, '..', '..', 'samples', 'syntax-tour');
    for (const name of fs.readdirSync(sampleDir).filter(n => n.toLowerCase().endsWith('.gpl'))) {
        lines.push(...fs.readFileSync(path.join(sampleDir, name), 'utf8').split(/\r?\n/));
    }

    const word = /[A-Za-z0-9_]/;
    const bad: string[] = [];
    for (const line of lines) {
        for (const t of tokenize(g, line)) {
            const before = t.start > 0 ? line[t.start - 1] : '';
            const after = t.end < line.length ? line[t.end] : '';
            const headSticks = word.test(t.text[0] ?? '') && word.test(before);
            const tailSticks = word.test(t.text[t.text.length - 1] ?? '') && word.test(after);
            if (headSticks || tailSticks) {
                bad.push(`"${t.text}" (${t.scope}) — 규칙 "${t.rule}" @ ${line.trim()}`);
            }
        }
    }
    assert.deepStrictEqual(bad, [], '식별자 일부에 색이 칠해진다');
});

test('grammar: 필드 선언 `Public SyncSub As TcpSyncCmdSub` 는 As 규칙만 잡는다', () => {
    const g = loadGrammar();
    const line = '\t\tPublic SyncSub As TcpSyncCmdSub';
    assert.deepStrictEqual(
        tokenize(g, line).map(t => `${t.text}=${t.scope}`),
        ['As=keyword.operator.type.gpl', 'TcpSyncCmdSub=storage.type.gpl'],
        'Sub 선언 규칙이 SyncSub 안의 Sub 를 선점하면 안 된다'
    );
    for (const prefix of ['Sub declaration', 'Function declaration', 'Property declaration',
        'Class declaration', 'Module declaration', 'Const declaration']) {
        assert.ok(!toRegExp(ruleOf(g, prefix).match!).test(line), `${prefix} 이 필드 선언에 걸린다`);
    }
});

test('grammar: `As New <Type>` — New 는 키워드, 뒤 이름이 타입이다', () => {
    const g = loadGrammar();
    assert.deepStrictEqual(
        tokenize(g, '\t\tDim ex As New Exception').map(t => `${t.text}=${t.scope}`),
        ['As=keyword.operator.type.gpl', 'New=keyword.operator.new.gpl', 'Exception=storage.type.gpl']
    );
    // 생성자 인자가 붙어도, 한정 이름이어도 같다.
    assert.deepStrictEqual(
        tokenize(g, '\t\tDim sink As New Net.LogSink(AddressOf WriteTagged)')
            .filter(t => t.scope !== 'keyword.operator.gpl')
            .map(t => `${t.text}=${t.scope}`),
        ['As=keyword.operator.type.gpl', 'New=keyword.operator.new.gpl', 'Net.LogSink=storage.type.gpl']
    );
    // As 없이 쓰는 New 도 같은 색이어야 한다.
    assert.deepStrictEqual(
        tokenize(g, '\t\tex = New Exception').map(t => `${t.text}=${t.scope}`),
        ['New=keyword.operator.new.gpl', 'Exception=storage.type.gpl']
    );
});

test('grammar: 타입을 참조하는 자리(As/New/Inherits)는 모두 storage.type.gpl 로 통일돼 있다', () => {
    const g = loadGrammar();
    // 정의 이름(Class/Module/Delegate)만 entity.name.* 을 쓴다.
    for (const prefix of ['Type annotation', 'Constructor type usage', 'Inheritance keywords']) {
        const caps = Object.values(ruleOf(g, prefix).captures ?? {}).map(c => c.name);
        assert.ok(
            caps.includes('storage.type.gpl'),
            `${prefix}: 타입 참조는 storage.type.gpl 이어야 한다 (지금: ${caps.join(', ')})`
        );
        assert.ok(
            !caps.some(n => n.startsWith('entity.name.type')),
            `${prefix}: 타입 참조에 정의용 스코프(entity.name.type.*)를 쓰면 안 된다`
        );
    }
});
