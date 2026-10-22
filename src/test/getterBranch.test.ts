import * as assert from 'assert';
import { test } from './harness';
import {
    parseGetterBranch,
    analyzeGetterBranch,
    getterBranchIdentifiers,
    evaluateGetterBranch,
} from '../language/getterBranch';
import { GPLParser, GPLSymbolKind } from '../language/gplParser';

// ─── 분기형 getter (§1-DS, 사용자 질문 2026-09-17) ───────────────────────────────
// RobotArmModule.gpl 실사례:
//   Public ReadOnly Property isUseCrashDetectSensor As Boolean
//       Get
//           If m_crashDetectSensorIO <> 0 Then
//               Return True
//           Else
//               Return False
//           End If
//       End Get
//   End Property

const CRASH_BRANCH = { condition: 'm_crashDetectSensorIO <> 0', thenExpr: 'True', elseExpr: 'False' };

test('parseGetterBranch: 블록 If/Else/End If', () => {
    assert.deepStrictEqual(
        parseGetterBranch(['If m_crashDetectSensorIO <> 0 Then', 'Return True', 'Else', 'Return False', 'End If']),
        CRASH_BRANCH,
    );
});

test('parseGetterBranch: If/End If 뒤 후행 Return', () => {
    assert.deepStrictEqual(
        parseGetterBranch(['If m_count > 0 Then', 'Return m_first', 'End If', 'Return Nothing']),
        { condition: 'm_count > 0', thenExpr: 'm_first', elseExpr: 'Nothing' },
    );
});

test('parseGetterBranch: 한 줄 If … Then Return A Else Return B / If … Then Return A + Return B', () => {
    assert.deepStrictEqual(
        parseGetterBranch(['If m_flag Then Return "on" Else Return "off"']),
        { condition: 'm_flag', thenExpr: '"on"', elseExpr: '"off"' },
    );
    assert.deepStrictEqual(
        parseGetterBranch(['If m_flag Then Return 1', 'Return 0']),
        { condition: 'm_flag', thenExpr: '1', elseExpr: '0' },
    );
});

test('parseGetterBranch: 지원 형태가 아니면 undefined (ElseIf·문장 추가·단순 Return·빈 본문)', () => {
    assert.strictEqual(parseGetterBranch(['If a = 1 Then', 'Return 1', 'ElseIf a = 2 Then', 'Return 2', 'Else', 'Return 0', 'End If']), undefined);
    assert.strictEqual(parseGetterBranch(['If a = 1 Then', 'm_x = 2', 'Return 1', 'Else', 'Return 0', 'End If']), undefined);
    assert.strictEqual(parseGetterBranch(['Return m_x']), undefined);
    assert.strictEqual(parseGetterBranch([]), undefined);
    assert.strictEqual(parseGetterBranch(['If a = 1 Then', 'Return 1', 'End If']), undefined, 'else 분기 없음');
});

test('analyzeGetterBranch / getterBranchIdentifiers: 피연산자 분해와 필드 이름 수집', () => {
    const shape = analyzeGetterBranch(CRASH_BRANCH)!;
    assert.deepStrictEqual(shape.left, { kind: 'ident', name: 'm_crashDetectSensorIO' });
    assert.strictEqual(shape.op, '<>');
    assert.deepStrictEqual(shape.right, { kind: 'literal', text: '0' });
    assert.deepStrictEqual(getterBranchIdentifiers(CRASH_BRANCH), ['m_crashDetectSensorIO']);
    // 분기 쪽 식별자도 모은다(중복 제거·등장 순)
    assert.deepStrictEqual(
        getterBranchIdentifiers({ condition: 'm_a <= m_b', thenExpr: 'm_a', elseExpr: 'm_b' }),
        ['m_a', 'm_b'],
    );
    // 리터럴만이면 빈 배열, 지원 범위 밖(호출·산술·And)은 undefined
    assert.deepStrictEqual(getterBranchIdentifiers({ condition: '1 = 1', thenExpr: '1', elseExpr: '0' }), []);
    assert.strictEqual(getterBranchIdentifiers({ condition: 'm_arr(0) <> 0', thenExpr: 'True', elseExpr: 'False' }), undefined);
    assert.strictEqual(getterBranchIdentifiers({ condition: 'm_a + 1 > 2', thenExpr: 'True', elseExpr: 'False' }), undefined);
    assert.strictEqual(getterBranchIdentifiers({ condition: 'm_a > 0 And m_b > 0', thenExpr: 'True', elseExpr: 'False' }), undefined);
    assert.strictEqual(getterBranchIdentifiers({ condition: 'm_obj Is Nothing', thenExpr: 'True', elseExpr: 'False' }), undefined);
});

test('evaluateGetterBranch: 수치 비교 — 제어기 표기(-1/0)로 값을 주고 출처를 붙인다', () => {
    const on = evaluateGetterBranch(CRASH_BRANCH, id => (id === 'm_crashDetectSensorIO' ? '5' : undefined), 'Boolean');
    assert.deepStrictEqual(on, {
        value: '-1', type: 'Boolean',
        via: 'm_crashDetectSensorIO <> 0 (m_crashDetectSensorIO = 5 → True)',
    });
    const off = evaluateGetterBranch(CRASH_BRANCH, () => '0', 'Boolean');
    assert.strictEqual(off?.value, '0');
    assert.ok(off?.via.endsWith('→ False)'), off?.via);
});

test('evaluateGetterBranch: 값이 없으면 undefined, 선언 타입 없으면 리터럴에서 추정', () => {
    assert.strictEqual(evaluateGetterBranch(CRASH_BRANCH, () => undefined), undefined);
    const r = evaluateGetterBranch(CRASH_BRANCH, () => '1');
    assert.strictEqual(r?.type, 'Boolean');
    const s = evaluateGetterBranch({ condition: 'm_flag', thenExpr: '"on"', elseExpr: '"off"' }, () => '-1');
    assert.deepStrictEqual(s, { value: '"on"', type: 'String', via: 'm_flag (m_flag = -1 → True)' });
    const n = evaluateGetterBranch({ condition: 'm_flag', thenExpr: '1.5', elseExpr: '0' }, () => '0');
    assert.deepStrictEqual(n, { value: '0', type: 'Integer', via: 'm_flag (m_flag = 0 → False)' });
});

test('evaluateGetterBranch: Not·괄호·문자열 비교·Boolean 리터럴 비교·분기 식별자', () => {
    assert.strictEqual(evaluateGetterBranch({ condition: 'Not (m_x = 0)', thenExpr: 'True', elseExpr: 'False' }, () => '0')?.value, '0');
    assert.strictEqual(evaluateGetterBranch({ condition: '(m_x <> 0)', thenExpr: 'True', elseExpr: 'False' }, () => '3')?.value, '-1');
    // 덤프의 문자열은 따옴표 포함(`"get"`) — 소스 리터럴 `"get"` 과 내용으로 비교
    assert.strictEqual(evaluateGetterBranch({ condition: 'm_cmd = "get"', thenExpr: '1', elseExpr: '0' }, () => '"get"')?.value, '1');
    assert.strictEqual(evaluateGetterBranch({ condition: 'm_cmd = "get"', thenExpr: '1', elseExpr: '0' }, () => '"set"')?.value, '0');
    // Boolean 필드(-1) 와 True 리터럴 비교
    assert.strictEqual(evaluateGetterBranch({ condition: 'm_on = True', thenExpr: '1', elseExpr: '0' }, () => '-1')?.value, '1');
    // 분기가 필드면 그 값을 돌려준다
    const pick = evaluateGetterBranch(
        { condition: 'm_a >= m_b', thenExpr: 'm_a', elseExpr: 'm_b' },
        id => ({ m_a: '7', m_b: '9' } as Record<string, string>)[id],
    );
    assert.deepStrictEqual(pick, { value: '9', type: '', via: 'm_a >= m_b (m_a = 7, m_b = 9 → False)' });
    // 숫자 vs 문자열처럼 타입이 어긋나면 계산하지 않는다
    assert.strictEqual(evaluateGetterBranch({ condition: 'm_x = "a"', thenExpr: '1', elseExpr: '0' }, () => '3'), undefined);
});

test('파서: Property 의 분기형 getter 를 getterBranch 로 기록하고, 단순 Return 은 종전대로 getterReturnExpr', () => {
    const src = [
        'Module M',
        '\tPublic Class RobotArm',
        '\t\tPrivate m_crashDetectSensorIO As Integer',
        '\t\tPrivate m_realtimeSlipCheckSensorInput As Integer',
        '\t\tPublic ReadOnly Property isUseCrashDetectSensor As Boolean',
        '\t\t\tGet',
        "\t\t\t\tIf m_crashDetectSensorIO <> 0 Then ' 센서 IO 배정 여부",
        '\t\t\t\t\tReturn True',
        '\t\t\t\tElse',
        '\t\t\t\t\tReturn False',
        '\t\t\t\tEnd If',
        '\t\t\tEnd Get',
        '\t\tEnd Property',
        '\t\tPublic Property realtimeSlipCheckSensor As Integer',
        '\t\t\tSet (value As Integer)',
        '\t\t\t\tm_realtimeSlipCheckSensorInput = value',
        '\t\t\tEnd Set',
        '\t\t\tGet',
        '\t\t\t\tReturn m_realtimeSlipCheckSensorInput',
        '\t\t\tEnd Get',
        '\t\tEnd Property',
        '\tEnd Class',
        'End Module',
    ].join('\n');
    const syms = GPLParser.parseDocument(src, '/virtual/getterBranch.gpl');
    const crash = syms.find(s => s.kind === GPLSymbolKind.Property && s.name === 'isUseCrashDetectSensor')!;
    assert.ok(crash, 'Property 심볼');
    assert.strictEqual(crash.getterReturnExpr, undefined);
    assert.deepStrictEqual(crash.getterBranch, CRASH_BRANCH);
    assert.strictEqual(crash.hasGetter, true);
    assert.strictEqual(crash.returnType, 'Boolean');
    const slip = syms.find(s => s.kind === GPLSymbolKind.Property && s.name === 'realtimeSlipCheckSensor')!;
    assert.strictEqual(slip.getterReturnExpr, 'm_realtimeSlipCheckSensorInput');
    assert.strictEqual(slip.getterBranch, undefined);
});
