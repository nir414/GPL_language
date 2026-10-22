import * as assert from 'assert';
import { test } from './harness';
import { classifyErrorEntry, getGplErrorGroup, isConsoleStatusEventFrame, normalizeConsoleLine } from '../controller/protocol/responseParser';
import { parseStatus, parseCompileErrors, parseThreadList, latin1ToUtf8, SHOW_THREAD_LIST_CMD, SHOW_THREAD_LIST_STACK_CMD } from '../controller/protocol/responseParser';

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

test('parseCompileErrors: DATA 태그와 첫 에러가 같은 줄이어도 파일명에는 태그가 섞이지 않는다', () => {
    const errors = parseCompileErrors('<DATA>Main.gpl:12:(-303): Undefined symbol: foo</DATA><STATUS>-742,"Compile errors"</STATUS>');
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].file, 'Main.gpl');
    assert.strictEqual(errors[0].message, 'Undefined symbol: foo');
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

// ── latin1ToUtf8 (1403 바이트 보존 디코딩, 2026-08-28) ─────────────────────

test('latin1ToUtf8: ASCII 는 그대로, UTF-8 바이트열(latin1 로 읽힌)은 한글로 복원된다', () => {
    assert.strictEqual(latin1ToUtf8('[Test_robot] Robot Version: v1.0.0'), '[Test_robot] Robot Version: v1.0.0');
    // GDE 1403 캡처 실측 줄: "2. DatStore 실제 데이터 저장소" — <L>81</L> (개행 포함 81 바이트)
    const utf8 = Buffer.from('[06-23-2026 13:29:38] [Test_robot] [MAIN] 2. DatStore 실제 데이터 저장소\n', 'utf8');
    assert.strictEqual(utf8.length, 81);
    assert.strictEqual(latin1ToUtf8(utf8.toString('latin1')), '[06-23-2026 13:29:38] [Test_robot] [MAIN] 2. DatStore 실제 데이터 저장소\n');
});

test('latin1ToUtf8: 128바이트 청크 경계가 다바이트 문자 중간에 걸려도 청크를 이어 붙인 뒤 디코딩하면 온전하다', () => {
    const text = 'x'.repeat(126) + '한글 테스트\n';   // 126 + 3 → 첫 128바이트 경계가 '한'(3바이트) 중간에 걸린다
    const bytes = Buffer.from(text, 'utf8');
    const chunk1 = bytes.subarray(0, 128).toString('latin1');
    const chunk2 = bytes.subarray(128).toString('latin1');
    // 청크별 디코딩은 깨진다(ascii/utf8 어느 쪽도 복구 불가)
    assert.notStrictEqual(latin1ToUtf8(chunk1) + latin1ToUtf8(chunk2), text);
    // 이어 붙인 뒤 디코딩하면 원문
    assert.strictEqual(latin1ToUtf8(chunk1 + chunk2), text);
});

test('latin1ToUtf8: ascii 디코딩은 상위 비트를 버려 복구 불가 — 회귀 방지 근거', () => {
    const bytes = Buffer.from('저장소', 'utf8');
    assert.notStrictEqual(Buffer.from(bytes.toString('ascii'), 'latin1').toString('utf8'), '저장소');
    assert.strictEqual(latin1ToUtf8(bytes.toString('latin1')), '저장소');
});

// ─── 에러 코드 그룹 — 공식 범위 표(Error_Intro.htm)가 정본 (§1-EA) ───

test('errorGroups: 문서 범위대로 코드를 그룹에 넣는다 (경계 포함)', () => {
    assert.strictEqual(getGplErrorGroup(-757)?.title, 'Language Related Errors');
    assert.strictEqual(getGplErrorGroup(-700)?.title, 'Language Related Errors', '경계값 -700 포함');
    assert.strictEqual(getGplErrorGroup(-999)?.title, 'Language Related Errors', '경계값 -999 포함');
    assert.strictEqual(getGplErrorGroup(-200)?.title, 'Standard System Errors');
    assert.strictEqual(getGplErrorGroup(-1521)?.category, 'environment');
    assert.strictEqual(getGplErrorGroup(-1200)?.category, 'unknown', '로봇 에러는 코드/환경이 갈리지 않는다');
    assert.strictEqual(getGplErrorGroup(0), undefined, '성공/경고 범위는 에러 그룹이 아니다');
    assert.strictEqual(getGplErrorGroup(-5000), undefined, '표에 없는 구간');
});

test('classifyErrorEntry: -757·-700 은 코드 오류다 (종전에는 환경 경고로 떨어졌다)', () => {
    const c = classifyErrorEntry('09-21-2026 10:04:49.135, GenAdp, -757, "*Object not instantiated*"');
    assert.strictEqual(c.category, 'code');
    assert.strictEqual(c.isControllerSystem, false, '환경 경고 칸으로 가면 안 된다');
    assert.strictEqual(c.parsedCode, -757);
    assert.ok(c.detail?.includes('Language Related Errors'), '문서상 그룹을 밝힌다');

    const aborted = classifyErrorEntry('09-21-2026 10:04:49.135, GenAdp, -700, "*Thread execution aborted*"');
    assert.strictEqual(aborted.category, 'code');
    assert.strictEqual(aborted.isControllerSystem, false);
});

test('classifyErrorEntry: 환경 코드는 그대로 환경, 분류 미상은 단정하지 않는다', () => {
    const env = classifyErrorEntry('09-21-2026 10:04:49.135, SYSTEM, -1521, "*Invalid parameter DB*"');
    assert.strictEqual(env.category, 'environment');
    assert.strictEqual(env.isControllerSystem, true);

    const unknown = classifyErrorEntry('09-21-2026 10:04:49.135, GenAdp, -1200, "*Robot problem*"');
    assert.strictEqual(unknown.category, 'unknown');
    assert.strictEqual(unknown.isControllerSystem, true, '미상은 코드 오류로 단정하지 않는다');
    assert.ok(unknown.detail?.includes('갈리지 않음'));
});

test('classifyErrorEntry: 코드별 힌트가 있으면 범위 표보다 우선한다', () => {
    // -508 은 Input and Output Errors 범위지만 손으로 검토한 힌트가 있다.
    const c = classifyErrorEntry('09-21-2026 10:04:49.135, GenAdp, -508, "*File not found*"');
    assert.strictEqual(c.category, 'code');
    assert.ok(c.detail?.includes('File not found'));
});

// ─── 1403 상태 이벤트 프레임 억제 (§1-EA) ───
// 실기 관측(2026-09-21): `<E>2</E>`·`<E>0</E>` 같은 단일 숫자 프레임이 와서, 두 숫자 형태만 알던
// 종전 규칙을 빠져나가 `</E>` 만 떨어진 `<E>2` 가 GPL Console 에 찍혔다.

test('consoleFrame: 숫자만 든 프레임은 형태에 상관없이 상태 이벤트다', () => {
    assert.strictEqual(isConsoleStatusEventFrame('<E>1,4</E>'), true, 'GDE 캡처의 형식');
    assert.strictEqual(isConsoleStatusEventFrame('<E>2</E>'), true, '실기에서 온 단일 숫자 형식');
    assert.strictEqual(isConsoleStatusEventFrame('<E>0</E>'), true);
    assert.strictEqual(isConsoleStatusEventFrame('<E>1,2,3</E>'), true);
    assert.strictEqual(isConsoleStatusEventFrame('  <E>2</E>\u0000 '), true, 'NUL·공백은 프레임 판정에 영향 없다');

    assert.strictEqual(isConsoleStatusEventFrame('<E>3,GenAdp<L>12</L>hello</E>'), false, '메시지 프레임은 로그다');
    assert.strictEqual(isConsoleStatusEventFrame('<E>2'), false, '닫히지 않은 조각은 프레임이 아니다');
    assert.strictEqual(isConsoleStatusEventFrame('MAIN Startup complete'), false);
});

test('normalizeConsoleLine: 상태 이벤트는 빈 문자열, 메시지 프레임은 그대로', () => {
    assert.strictEqual(normalizeConsoleLine('<E>2</E>'), '', '종전에는 `<E>2` 가 콘솔에 찍혔다');
    assert.strictEqual(normalizeConsoleLine('<E>0</E>'), '');
    assert.strictEqual(normalizeConsoleLine('<E>1,4</E>'), '');
    assert.strictEqual(normalizeConsoleLine('</E>'), '');
    assert.strictEqual(normalizeConsoleLine('<E>3,GenAdp<L>5</L>hello</E>'), '[GenAdp] hello');
});
