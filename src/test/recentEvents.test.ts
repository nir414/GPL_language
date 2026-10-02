import * as assert from 'assert';
import { test } from './harness';
import { ControllerEventLog, formatControllerEvent, isControllerEvent } from '../controller/recentEvents';

// ─── 「오류 상세 보기」의 "직전 제어기 사건" — 되먹임 차단과 소음 제거 (§1-EA) ───

test('recentEvents: 확장 내부 수다와 배포 트레이스 장식 줄은 사건이 아니다', () => {
    assert.strictEqual(isControllerEvent('[Deploy] ✔ 빌드 완료: GenAdp'), true);
    assert.strictEqual(isControllerEvent('[Stop] CMD Stop -all'), true);
    // 태그가 없어도 제어기 작업의 결과를 말하는 줄이 많아 통과시킨다.
    assert.strictEqual(isControllerEvent('CMD Compile GenAdp'), true);

    assert.strictEqual(isControllerEvent('[SymbolCache] Indexed 605 files in 7403 ms'), false);
    assert.strictEqual(isControllerEvent('[ProjectContext] expected project: GenAdp'), false);
    assert.strictEqual(isControllerEvent('[Bridge] 시작 — 인스턴스 4bd87e0b'), false);
    assert.strictEqual(isControllerEvent(''), false, '빈 줄이 창을 먹으면 안 된다');
    assert.strictEqual(isControllerEvent('│ ↑ [52/71] _robot_Robot.gpl'), false, '업로드 진행 줄 71개가 창을 다 차지했다');
    assert.strictEqual(isControllerEvent('─────────────────────────────────────────'), false);
    assert.strictEqual(isControllerEvent('╭──────────────────────────────╮'), false);
});

test('recentEvents: 연속 중복은 접어서 count 로 센다 (-757/-700 폭주가 창을 다 먹지 않게)', () => {
    const log = new ControllerEventLog();
    log.record('[ErrorLog] GenAdp (-757): *Object not instantiated*', 1000);
    log.record('[ErrorLog] GenAdp (-757): *Object not instantiated*', 2000);
    log.record('[ErrorLog] GenAdp (-757): *Object not instantiated*', 3000);
    log.record('[Stop] CMD Stop -all', 4000);

    const recent = log.recent(10);
    assert.strictEqual(recent.length, 2);
    assert.strictEqual(recent[0].count, 3);
    assert.strictEqual(recent[0].at, 3000, '접힌 항목은 가장 나중 시각을 쓴다');
    assert.strictEqual(recent[1].count, 1);
});

test('recentEvents: 사건이 아닌 줄은 record 가 조용히 버린다 (호출부가 판정을 다시 하지 않게)', () => {
    const log = new ControllerEventLog();
    log.record('[SymbolCache] Updated Main.gpl: 13 symbols');
    log.record('');
    log.record('│ ↑ [1/61] App_Adp.gpl');
    assert.strictEqual(log.size, 0);
});

test('recentEvents: 상한을 넘으면 오래된 것부터 버리고, recent 는 최근 N건을 오래된 → 최근 순으로', () => {
    const log = new ControllerEventLog(3);
    for (const n of [1, 2, 3, 4, 5]) { log.record(`[Deploy] step ${n}`, n); }
    assert.deepStrictEqual(log.recent(10).map(e => e.text), ['[Deploy] step 3', '[Deploy] step 4', '[Deploy] step 5']);
    assert.deepStrictEqual(log.recent(2).map(e => e.text), ['[Deploy] step 4', '[Deploy] step 5']);
    assert.deepStrictEqual(log.recent(0), []);
});

test('recentEvents: 표시 줄은 시각 + 문구, 접힌 항목만 ×N', () => {
    const clock = (ms: number): string => `T${ms}`;
    assert.strictEqual(formatControllerEvent({ at: 7, text: '[Stop] CMD Stop -all', count: 1 }, clock), 'T7  [Stop] CMD Stop -all');
    assert.strictEqual(formatControllerEvent({ at: 7, text: '[Stop] CMD Stop -all', count: 4 }, clock), 'T7  [Stop] CMD Stop -all (×4)');
});
