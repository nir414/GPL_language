import * as assert from 'assert';
import { test } from '../../harness';
import { isConsoleStatusEventFrame, latin1ToUtf8, normalizeConsoleLine } from '../../../controller/protocol/runtimeConsoleLine';

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
