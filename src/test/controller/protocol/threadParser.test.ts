import * as assert from 'assert';
import { test } from '../../harness';
import { parseThreadList, SHOW_THREAD_LIST_CMD, SHOW_THREAD_LIST_STACK_CMD } from '../../../controller/protocol/threadParser';

test('SHOW_THREAD_LIST_CMD: 경량형(-web, -stack 없음) / STACK형: -stack -web', () => {
    // 고빈도 폴용 경량형: -web 만, -stack 없음
    assert.ok(/-web/.test(SHOW_THREAD_LIST_CMD));
    assert.ok(!/-stack/.test(SHOW_THREAD_LIST_CMD));
    // on-demand 상세형: -stack -web
    assert.ok(/-stack/.test(SHOW_THREAD_LIST_STACK_CMD));
    assert.ok(/-web/.test(SHOW_THREAD_LIST_STACK_CMD));
});

test('parseThreadList: -stack -web 파이프 형식에서 9컬럼 매핑 불변 + timing 캡처', () => {
    const text = '<DATA>ArmEventThreadFunction| Running| 0| ""| MergeCode| ArmEventThreadFunction| 5| RobotArmModule.gpl| 577| 0.172| 4.000| 0.172\n'
        + 'OpCommandRunThread1| Paused| 0| ""| MergeCode| getPDB| 2| PDBModule.gpl| 47| 0.297| 100.000| 0.871\n'
        + '</DATA><STATUS>0,"Success"</STATUS>';
    const r = parseThreadList(text);
    assert.strictEqual(r.length, 2);
    assert.strictEqual(r[0].name, 'ArmEventThreadFunction');
    assert.strictEqual(r[0].func, 'ArmEventThreadFunction');
    assert.strictEqual(r[0].file, 'RobotArmModule.gpl');
    assert.strictEqual(r[0].fileLine, 577);
    assert.deepStrictEqual(r[0].stackTiming, [0.172, 4.000, 0.172]);
    assert.deepStrictEqual(r[1].stackTiming, [0.297, 100.000, 0.871]);
});

test('parseThreadList: -stack 비-web의 순수 숫자 타이밍 행은 phantom 스레드를 만들지 않음', () => {
    const text = '<DATA>ArmEventThreadFunction, Running\n'
        + '0.172, 4.000, 0.172\n'
        + 'OpCommandRunThread1, Paused\n'
        + '0.297, 100.000, 0.871\n'
        + '</DATA><STATUS>0,"Success"</STATUS>';
    const r = parseThreadList(text);
    assert.strictEqual(r.length, 2);
    assert.deepStrictEqual(r.map(t => t.name), ['ArmEventThreadFunction', 'OpCommandRunThread1']);
    assert.ok(r.every(t => Number.isNaN(Number(t.name))));
});

test('parseThreadList: timing 없는 순수 -web(9컬럼)은 회귀 없이 stackTiming undefined', () => {
    const text = '<DATA>Test_robot| Paused| 0| ""| Test_robot| MAIN| 2| Entry_Main.gpl| 22\n'
        + '</DATA><STATUS>0,"Success"</STATUS>';
    const r = parseThreadList(text);
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].name, 'Test_robot');
    assert.strictEqual(r[0].fileLine, 22);
    assert.strictEqual(r[0].stackTiming, undefined);
});

test('normalizeThreadState: Stopped가 Stopping으로 오정규화되지 않는다', () => {
    // 파이프 형식(Show Thread  -web) 응답으로 간접 검증
    const resp = '<DATA>T1| Stopped| 0| ""| Proj| Main| 1| Main.gpl| 1\nT2| Stopping| 0| ""| Proj| Main| 1| Main.gpl| 1\nT3| Stop requested| 0| ""| Proj| Main| 1| Main.gpl| 1</DATA><STATUS>0,"Success"</STATUS>';
    const threads = parseThreadList(resp);
    assert.strictEqual(threads.length, 3);
    assert.strictEqual(threads[0].state, 'Stopped');
    assert.strictEqual(threads[1].state, 'Stopping');
    assert.strictEqual(threads[2].state, 'Stopped');
});

// ── latin1ToUtf8 (1403 바이트 보존 디코딩, 2026-08-28) ─────────────────────
