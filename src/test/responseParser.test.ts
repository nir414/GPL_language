import * as assert from 'assert';
import { test } from './harness';
import { parseStatus, parseCompileErrors, parseThreadList, SHOW_THREAD_LIST_CMD, SHOW_THREAD_LIST_STACK_CMD } from '../controller/responseParser';

test('parseStatus: 성공 코드와 메시지', () => {
    const r = parseStatus('<STATUS>0,"OK"</STATUS>');
    assert.strictEqual(r.code, 0);
    assert.strictEqual(r.message, 'OK');
});

test('parseStatus: 음수 에러 코드', () => {
    const r = parseStatus('<STATUS>-745,"already loaded"</STATUS>');
    assert.strictEqual(r.code, -745);
    assert.strictEqual(r.message, 'already loaded');
});

test('parseStatus: 메시지 없는 STATUS', () => {
    const r = parseStatus('prefix <STATUS> -742 </STATUS> suffix');
    assert.strictEqual(r.code, -742);
    assert.strictEqual(r.message, '');
});

test('parseStatus: STATUS 없으면 -9999', () => {
    const r = parseStatus('garbage response without status');
    assert.strictEqual(r.code, -9999);
});

test('parseCompileErrors: CONSOLE 접두 에러 라인', () => {
    const errors = parseCompileErrors('[CONSOLE] foo.gpl:42:(-100): something bad');
    assert.strictEqual(errors.length, 1);
    assert.deepStrictEqual(errors[0], {
        file: 'foo.gpl',
        line: 42,
        code: -100,
        message: 'something bad',
    });
});

test('parseCompileErrors: 접두 없는 라인 + 다중 매치', () => {
    const errors = parseCompileErrors('a.gpl:1:(-1): first\nb.gpr:2:(-2): second');
    assert.strictEqual(errors.length, 2);
    assert.strictEqual(errors[0].file, 'a.gpl');
    assert.strictEqual(errors[1].file, 'b.gpr');
    assert.strictEqual(errors[1].code, -2);
});

test('parseCompileErrors: 매치 없으면 빈 배열', () => {
    assert.deepStrictEqual(parseCompileErrors('no errors here'), []);
});

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

// ─── 2026-07-16 자체 검토 세션 수정분 회귀 (parseStatus 마지막 블록 / 스레드 상태 정규화) ───

test('parseStatus: DATA 본문에 STATUS 텍스트가 있어도 마지막(종결) 블록을 채택', () => {
    const dump = '<DATA>log says <STATUS>-999,"fake"</STATUS> inside body</DATA>\r\n<STATUS>0,"Success"</STATUS>';
    const r = parseStatus(dump);
    assert.strictEqual(r.code, 0);
    assert.strictEqual(r.message, 'Success');
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
