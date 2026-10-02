import * as assert from 'assert';
import { test } from './harness';
import { GPLParser, GPLSymbolKind } from '../language/gplParser';
import { isDocumentableKind } from '../language/docComment';

// ─── Delegate 선언 심볼 (§1-DU, 사용자 신고 2026-09-17) ─────────────────────────────
// Logger.gpl:77 `Public Delegate Sub LogSinkSub(ByVal line As String)` 이 인덱싱되지 않아
// LogFile.gpl 의 `New LogSinkSub(AddressOf OnLogLine)` 에서 정의 찾기가 안 됐다.

const SRC = [
    'Module LOG',
    "\t' 로그 한 줄을 받는 sink(외부 모듈 확장 포인트).",
    "\t' 파일/TCP 등 부가 모듈이 스스로 등록한다.",
    '\tPublic Delegate Sub LogSinkSub(ByVal line As String)',
    '\tPrivate Const SINK_MAX As Integer = 8',
    '\tPrivate Dim sinkList(SINK_MAX - 1) As LogSinkSub',
    '',
    "\tPrivate Delegate Function Comparer(a As Integer, b As Integer) As Integer ' 비교기",
    '\tPublic Delegate Function Picker(items() As String) As String()',
    '',
    '\tPublic Sub RegisterLogSink(ByVal sink As LogSinkSub)',
    '\t\tDim slot As Integer',
    '\t\tslot = sinkListCount',
    '\tEnd Sub',
    '',
    '\tPublic Class Box',
    '\t\tDelegate Sub Inner(x As Integer)',
    '\t\tPublic Sub Run()',
    '\t\tEnd Sub',
    '\tEnd Class',
    'End Module',
].join('\n');

test('파서: Delegate Sub 는 Delegate 심볼(파라미터·문서화 주석·접근자·모듈)로 잡히고 블록에 들어가지 않는다', () => {
    const syms = GPLParser.parseDocument(SRC, '/virtual/Logger.gpl', { includeLocals: true, includeParameters: true });
    const d = syms.find(s => s.name === 'LogSinkSub')!;
    assert.ok(d, 'LogSinkSub 심볼');
    assert.strictEqual(d.kind, GPLSymbolKind.Delegate);
    assert.deepStrictEqual(d.parameters, ['ByVal line As String']);
    assert.strictEqual(d.returnType, undefined);
    assert.strictEqual(d.module, 'LOG');
    assert.strictEqual(d.className, undefined);
    assert.strictEqual(d.accessModifier, 'public');
    assert.strictEqual(d.line, 3);
    assert.ok(d.docComment?.includes('sink'), '바로 위 주석 블록이 문서화 주석으로 붙어야 한다');
    // 이름 컬럼은 `Delegate Sub ` 뒤 — 수식어/키워드 위치가 아니다
    assert.strictEqual(SRC.split('\n')[3].slice(d.range.start, d.range.end), 'LogSinkSub');
    // 한 줄 선언이므로 파라미터 `line` 이 로컬/파라미터 심볼로 생기지 않는다
    assert.ok(!syms.some(s => s.name === 'line' && s.isParameter), 'Delegate 파라미터는 로컬 심볼이 아니다');
    // 뒤따르는 선언들이 정상적으로 같은 모듈 레벨에 잡힌다(블록 깊이가 어긋나지 않았다)
    const c = syms.find(s => s.name === 'SINK_MAX')!;
    assert.strictEqual(c.kind, GPLSymbolKind.Constant);
    assert.strictEqual(c.isLocal, undefined);
    const reg = syms.find(s => s.name === 'RegisterLogSink')!;
    assert.strictEqual(reg.kind, GPLSymbolKind.Sub);
    assert.strictEqual(reg.module, 'LOG');
    assert.ok(syms.some(s => s.name === 'slot' && s.isLocal), 'Sub 본문 로컬은 여전히 잡힌다');
});

test('파서: Delegate Function 은 반환 타입(배열 접미 포함)을 기록하고, 클래스 안 Delegate 는 className 을 갖는다', () => {
    const syms = GPLParser.parseDocument(SRC, '/virtual/Logger.gpl');
    const cmp = syms.find(s => s.name === 'Comparer')!;
    assert.strictEqual(cmp.kind, GPLSymbolKind.Delegate);
    assert.deepStrictEqual(cmp.parameters, ['a As Integer', 'b As Integer']);
    assert.strictEqual(cmp.returnType, 'Integer');
    assert.strictEqual(cmp.accessModifier, 'private');
    const pick = syms.find(s => s.name === 'Picker')!;
    assert.strictEqual(pick.returnType, 'String[]');
    const inner = syms.find(s => s.name === 'Inner')!;
    assert.strictEqual(inner.kind, GPLSymbolKind.Delegate);
    assert.strictEqual(inner.className, 'Box');
    assert.strictEqual(inner.module, 'LOG');
    // 클래스 안 Delegate 뒤의 Sub 도 같은 클래스 소속으로 잡힌다
    const run = syms.find(s => s.name === 'Run')!;
    assert.strictEqual(run.className, 'Box');
    // Delegate 줄이 Sub/Function 으로 중복 인덱싱되지 않는다
    assert.strictEqual(syms.filter(s => s.name === 'LogSinkSub').length, 1);
    assert.strictEqual(syms.filter(s => s.name === 'Comparer').length, 1);
});

test('문서화 주석: delegate 는 문서화 대상 종류다(`\'\'\'` 골격에 매개변수 항목이 생긴다)', () => {
    assert.strictEqual(isDocumentableKind('delegate'), true);
});
