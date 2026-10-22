import * as assert from 'assert';
import { test } from './harness';
import {
    countThreadStates,
    renderThreadListReport,
    renderThreadTable,
    summarizeThreadStates,
} from '../controller/threads/threadReport';
import type { ThreadInfo } from '../controller/protocol/responseParser';

function thread(partial: Partial<ThreadInfo> & { name: string }): ThreadInfo {
    return {
        state: 'Idle',
        lastStatus: '0',
        project: '',
        file: '',
        ...partial,
    } as ThreadInfo;
}

const SAMPLE: ThreadInfo[] = [
    thread({
        name: 'Main', state: 'Running', lastStatus: '0', project: 'GenAdp',
        file: 'Main.gpl', fileLine: 101, func: 'Main', procLine: 23, stackTiming: [12, 4],
    }),
    thread({ name: 'Worker', state: 'Break', project: 'GenAdp', file: 'Machine.gpl', fileLine: 65 }),
    thread({ name: 'Idle1' }),
    thread({ name: 'Bad', state: 'Error', lastStatus: '-757 *Object not instantiated*', project: 'GenAdp' }),
];

test('쓰레드 보고서: 상태 집계는 Break 를 Paused 로 함께 센다', () => {
    const counts = countThreadStates(SAMPLE);
    assert.deepStrictEqual(counts, { running: 1, paused: 1, idle: 1, errCount: 1 });
    assert.strictEqual(summarizeThreadStates(SAMPLE), '전체 4: Running 1, Paused 1, Idle 1, Error 1');
});

test('쓰레드 보고서: 표는 관측값만 싣고 없는 값은 `-` 로 적는다', () => {
    const lines = renderThreadTable(SAMPLE);

    assert.strictEqual(lines.length, 2 + SAMPLE.length, '헤더 2줄 + 쓰레드 수');
    assert.ok(lines[0].includes('Timing(-stack)'), '컬럼 헤더에 raw 표기를 그대로 둔다');
    assert.strictEqual(
        lines[2],
        '| Main | Running | 0 | GenAdp | Main.gpl:101 | Main:23 | 12 / 4 |',
    );
    // 파일만 있고 줄이 없으면 파일까지만, 프로시저·Timing 이 없으면 `-`.
    assert.strictEqual(lines[4], '| Idle1 | Idle | 0 | - | - | - | - |');
    // 상태 문구의 공백·별표는 원문 유지(해석하지 않는다).
    assert.ok(lines[5].includes('-757 *Object not instantiated*'));
});

test('쓰레드 보고서: 쓰레드가 없으면 표 대신 이유가 다른 한 줄을 적는다', () => {
    assert.deepStrictEqual(renderThreadTable([]), []);

    const offline = renderThreadListReport({ threads: [], connected: false, now: 0, formatTime: () => 'T' });
    assert.ok(offline.includes('- 연결: Disconnected'));
    assert.ok(offline.includes('연결돼 있지 않아'), '미연결과 "정말 없음" 을 구분한다');

    const online = renderThreadListReport({ threads: [], connected: true, now: 0, formatTime: () => 'T' });
    assert.ok(online.includes('실행 쓰레드가 없습니다'));
});

test('쓰레드 보고서: 머리말에 시각·연결·기대 프로젝트·버전·요약이 모두 있다', () => {
    const text = renderThreadListReport({
        threads: SAMPLE,
        connected: true,
        endpoint: '192.168.0.1:1402',
        expectedProject: 'GenAdp',
        extensionVersion: '0.9.7',
        now: 0,
        formatTime: () => '2026-09-22 14:03:11',
    });

    assert.ok(text.startsWith('# GPL 쓰레드 목록'));
    assert.ok(text.includes('- 시각: 2026-09-22 14:03:11'));
    assert.ok(text.includes('- 연결: Connected (192.168.0.1:1402)'));
    assert.ok(text.includes('- 기대 프로젝트: GenAdp'));
    assert.ok(text.includes('- 확장 버전: 0.9.7'));
    assert.ok(text.includes('전체 4: Running 1'));
    assert.ok(text.includes('| Main | Running |'));

    // 기대 프로젝트가 비어 있으면 (미설정) — 빈 문자열을 그대로 흘리지 않는다.
    const noProject = renderThreadListReport({ threads: [], connected: true, expectedProject: '  ' });
    assert.ok(noProject.includes('- 기대 프로젝트: (미설정)'));
});
