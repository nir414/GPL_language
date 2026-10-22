import * as assert from 'assert';
import { test } from './harness';
import {
    describeNestedExpandFailure,
    formatEvalError,
    UNDEFINED_SYMBOL_STATUS,
    UNSUPPORTED_PROCEDURE_STATUS,
} from '../debug/evalMessages';

// ─── describeNestedExpandFailure — 중첩 객체 펼치기 안내 행 (§1-DS, 사용자 스크린샷 2026-09-17) ───
// 실사례: GPL.MAIN 프레임에서 `rt1`(Object RT1ItemList) 덤프의 `rt1.rt1Datafile, Object DataFile` 을 펼침.
// RT1ItemList 의 `Private Dim rt1Datafile As DataFile` — 클래스 밖 프레임이라 직접 평가는 -729.

test('nestedExpand: -729 는 "지원 안 함"이 아니라 "이 프레임에서 안 보임"으로 설명하고 코드를 앞에 둔다', () => {
    const row = describeNestedExpandFailure({
        expression: 'rt1.rt1Datafile',
        varType: 'Object DataFile',
        error: { code: UNDEFINED_SYMBOL_STATUS, message: '*Undefined symbol*' },
        frameDescription: 'GPL.MAIN @ GPL.gpl:73',
    });
    assert.strictEqual(row.name, '(펼칠 수 없음)');
    assert.ok(row.value.startsWith('-729 *Undefined symbol*'), row.value);
    assert.ok(/프레임/.test(row.value), '원인(프레임 스코프)이 값에 있어야 한다');
    assert.ok(!/지원하지 않습니다/.test(row.value), '종전의 부정확한 "지원 안 함" 서술을 쓰지 않는다');
    assert.ok(!/ℹ/.test(row.value) && !/ℹ/.test(row.name), 'hover 글꼴에서 i 로 보이는 기호를 쓰지 않는다');
    // 상세는 Debug Console 용 — 식·프레임·leaf 이름이 들어간다
    assert.ok(row.detail.includes('rt1.rt1Datafile') && row.detail.includes('GPL.MAIN') && row.detail.includes('rt1Datafile'), row.detail);
});

test('nestedExpand: -780 은 프로시저 해석 + 백킹 필드 안내', () => {
    const row = describeNestedExpandFailure({
        expression: 'robot.arm',
        varType: 'Object RobotArm',
        error: { code: UNSUPPORTED_PROCEDURE_STATUS, message: '*Unsupported procedure reference*' },
    });
    assert.ok(row.value.startsWith('-780'), row.value);
    assert.ok(/m_\*/.test(row.value), '백킹 필드 안내');
    assert.ok(!/\(프레임/.test(row.detail), '프레임 설명이 없으면 괄호도 붙이지 않는다');
});

test('nestedExpand: 실패 코드 없이 멤버 줄만 없으면 타입을 앞세우고 "멤버 줄 없음"으로 설명', () => {
    const row = describeNestedExpandFailure({ expression: 'a.b', varType: 'Object Mutex' });
    assert.ok(row.value.startsWith('Object Mutex — '), row.value);
    assert.ok(/멤버 줄/.test(row.value));
    assert.ok(row.detail.includes('a.b') && row.detail.includes('Object Mutex'));
});

test('nestedExpand: 기타 STATUS 는 코드·문구 그대로 + 거부 사실만', () => {
    const row = describeNestedExpandFailure({
        expression: 'x.y', varType: '', error: { code: -712, message: '*Invalid syntax*' },
    });
    assert.ok(row.value.startsWith('-712 *Invalid syntax*'), row.value);
    assert.ok(row.value.includes('x.y'));
    assert.ok(row.detail.includes('타입 Object'), '빈 타입은 Object 로 표기');
});

test('nestedExpand: 메시지 없는 STATUS 는 코드만 앞에 둔다', () => {
    const row = describeNestedExpandFailure({
        expression: 'x.y', varType: 'Object T', error: { code: -729, message: '' },
    });
    assert.ok(row.value.startsWith('-729 — '), row.value);
});

// ─── formatEvalError — gplDebugSession 에서 이관(동작 보존) ───

test('formatEvalError: -780/-729/-762/-763/-712/기타 분기', () => {
    assert.ok(formatEvalError('cmd.ints(0)', { code: -780, message: '*Unsupported procedure reference*' }).includes('cmd 객체를 펼쳐 m_* 필드 조회'));
    assert.ok(formatEvalError('readyLoc.extraZ2', { code: -729, message: '*Undefined symbol*' }).includes('점 표기 멤버 접근'));
    assert.ok(formatEvalError('loc.X', { code: -762, message: '' }).includes('Angle(1..n)을'));
    assert.ok(formatEvalError('loc.Angle(1)', { code: -763, message: '' }).includes('X/Y/Z/Yaw/Pitch/Roll을'));
    assert.ok(formatEvalError('Me.x', { code: -712, message: '*Invalid syntax*' }).includes('Me.'));
    assert.strictEqual(formatEvalError('x', { code: -999, message: '' }), '(평가 실패 -999: 원인 미상)');
});
