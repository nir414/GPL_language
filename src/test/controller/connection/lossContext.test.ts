import * as assert from 'assert';
import { test } from '../../harness';
import {
    RecentCommandLog,
    commandsBefore,
    describeRecentCommand,
    PRECEDING_COMMAND_WINDOW_MS,
} from '../../../controller/connection/recentCommands';
import {
    parsePcPowerEvents,
    matchPcResume,
    describePcResume,
    RESUME_MATCH_AFTER_MS,
} from '../../../controller/connection/pcPowerEvents';
import { composeLossNotice, RECONNECT_ACTION } from '../../../controller/connection/lossNotice';

const clock = (ms: number) => `t${ms}`;

test('RecentCommandLog: 용량을 넘으면 오래된 것부터 버리고, commandsBefore 는 의심 시각 이전 창만 고른다', () => {
    const log = new RecentCommandLog(3);
    for (const at of [1, 2, 3, 4]) { log.add({ command: `C${at}`, at, outcome: 'status', statusCode: 0 }); }
    assert.deepStrictEqual(log.list().map(r => r.command), ['C2', 'C3', 'C4']);
    // 2026-11-02 09:18 재현: Stop -all 13 s 뒤 의심 — 그 뒤(유실 처리 중) 명령은 넣지 않는다.
    const base = 1_000_000;
    const records = [
        { command: 'Start App -compile -event', at: base - PRECEDING_COMMAND_WINDOW_MS - 1, outcome: 'status' as const, statusCode: 0 },
        { command: 'Stop -all', at: base - 13_000, outcome: 'status' as const, statusCode: 0 },
        { command: 'Stop -all', at: base + 2_000, outcome: 'failed' as const, failure: 'refused' },
    ];
    assert.deepStrictEqual(commandsBefore(records, base).map(r => r.at), [base - 13_000]);
    log.clear();
    assert.deepStrictEqual(log.list(), []);
});

test('describeRecentCommand: 결과 종류별 표기와 경과 초', () => {
    assert.strictEqual(describeRecentCommand({ command: 'Stop -all', at: 0, outcome: 'status', statusCode: -752 }, 13_400), 'Stop -all → STATUS -752 (13 s 전)');
    assert.strictEqual(describeRecentCommand({ command: 'Execute Robot.Where', at: 0, outcome: 'no-status' }, 1_000), 'Execute Robot.Where → STATUS 없음 (1 s 전)');
    assert.strictEqual(describeRecentCommand({ command: 'Unload X', at: 5_000, outcome: 'failed', failure: 'timeout' }, 1_000), 'Unload X → 실패(timeout) (0 s 전)');
});

test('parsePcPowerEvents: 아는 이벤트만 시간순으로, 모르는 줄·잘린 줄은 버린다', () => {
    const out = [
        'Microsoft-Windows-Kernel-Power|507|2000',
        'Microsoft-Windows-Kernel-Power|506|1000',
        'Microsoft-Windows-Kernel-Power|172|1500',
        'Microsoft-Windows-Power-Troubleshooter|1|3000',
        'Microsoft-Windows-Kernel-Power|42|abc',
        '',
    ].join('\r\n');
    assert.deepStrictEqual(parsePcPowerEvents(out), [
        { kind: 'sleep', at: 1000, source: 'Kernel-Power 506' },
        { kind: 'resume', at: 2000, source: 'Kernel-Power 507' },
        { kind: 'resume', at: 3000, source: 'Power-Troubleshooter 1' },
    ]);
    assert.deepStrictEqual(parsePcPowerEvents(''), []);
});

test('matchPcResume: 복귀 직후(창 안)의 의심만 절전 복귀로 본다 — 2026-10-28 20:41 실측 재현', () => {
    // 20:36:21 대기 진입 → 20:41:20 종료, 같은 초에 1403 RST 로 의심 시작.
    const sleepAt = 0;
    const resumeAt = 299_000;
    const events = parsePcPowerEvents([
        `Microsoft-Windows-Kernel-Power|506|${sleepAt}`,
        `Microsoft-Windows-Kernel-Power|507|${resumeAt}`,
    ].join('\n'));
    assert.deepStrictEqual(matchPcResume(events, resumeAt + 300), { resumeAt, resumeSource: 'Kernel-Power 507', sleepAt });
    assert.ok(matchPcResume(events, resumeAt - 3_000), '기록 순서 오차 몇 초는 받는다');
    assert.strictEqual(matchPcResume(events, resumeAt + RESUME_MATCH_AFTER_MS + 1), undefined, '복귀 2분 뒤의 끊김은 절전으로 설명하지 않는다');
    assert.strictEqual(matchPcResume(events, resumeAt - 60_000), undefined, '절전 중(복귀 전)의 의심도 아니다');
    assert.strictEqual(matchPcResume([], resumeAt), undefined);
    // 진입 기록이 조회 범위 밖이면 sleepAt 없이.
    assert.deepStrictEqual(matchPcResume(events.filter(e => e.kind === 'resume'), resumeAt), { resumeAt, resumeSource: 'Kernel-Power 507' });
});

test('describePcResume: 절전 시간을 분·초로', () => {
    assert.strictEqual(describePcResume({ resumeAt: 299_000, resumeSource: 'x', sleepAt: 0 }, clock), 'PC 절전 복귀 t299000 (절전 4분 59초)');
    assert.strictEqual(describePcResume({ resumeAt: 60_000, resumeSource: 'x', sleepAt: 0 }, clock), 'PC 절전 복귀 t60000 (절전 1분 0초)');
    assert.strictEqual(describePcResume({ resumeAt: 30_000, resumeSource: 'x', sleepAt: 0 }, clock), 'PC 절전 복귀 t30000 (절전 30초)');
    assert.strictEqual(describePcResume({ resumeAt: 5, resumeSource: 'x' }, clock), 'PC 절전 복귀 t5');
});

test('composeLossNotice: 절전 복귀면 제어기 문제가 아니라고, 아니면 미확정이라고 말하고 둘 다 다시 연결을 안내한다', () => {
    const resumeNotice = composeLossNotice({
        ip: '192.168.0.102', failures: 2, hasPostmortem: true, clock,
        resume: { resumeAt: 299_000, resumeSource: 'Kernel-Power 507', sleepAt: 0 },
        stallNote: '판정이 늦어진 296 s 는 …',
    });
    assert.ok(resumeNotice.includes('PC 절전 복귀 t299000 (절전 4분 59초) 직후에 끊겼습니다'));
    assert.ok(resumeNotice.includes('제어기 문제로 보지 않습니다'));
    assert.ok(resumeNotice.includes(`「${RECONNECT_ACTION}」`));
    assert.ok(!resumeNotice.includes('판정이 늦어진'), '절전 시간과 같은 정지 안내는 반복하지 않는다');
    assert.ok(resumeNotice.endsWith('사후 스냅샷 파일에 있습니다.'));

    const plain = composeLossNotice({ ip: '10.0.0.1', failures: 3, hasPostmortem: false, clock, stallNote: 'STALL' });
    assert.ok(plain.includes('3회 연속 무응답'));
    assert.ok(plain.includes('런타임 상태 미확정'));
    assert.ok(plain.includes(`「${RECONNECT_ACTION}」`));
    assert.ok(plain.includes('STALL'));
    assert.ok(!plain.includes('사후 스냅샷'));

    const expired = composeLossNotice({ ip: '10.0.0.1', failures: 2, hasPostmortem: false, clock, guidance: 'GUIDE' });
    assert.ok(expired.includes('GUIDE'));
    assert.ok(!expired.includes('런타임 상태 미확정'), '복구 대기 만료 안내가 있으면 그 안내를 쓴다');
});
