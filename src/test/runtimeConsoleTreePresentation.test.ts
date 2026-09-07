import * as assert from 'assert';
import { test } from './harness';
import {
    buildRuntimeConsoleTreeDescription,
    buildRuntimeConsoleTreeTooltip,
    formatRuntimeConsoleStatusDetail,
    formatRuntimeConsoleTreeState,
    getRuntimeConsoleHypothesis,
    getRuntimeConsoleTreeIcon,
    isRuntimeConsolePollingState,
    isRuntimeConsoleUnstable,
} from '../views/runtimeConsoleTreePresentation';
import type { RuntimeConsoleStatusSnapshot } from '../controller/runtimeConsole';

// 트리(GPL Controller 뷰)의 1403 콘솔 행 문구 — controllerTreeProvider.ts 에서 분리한 순수 함수의 회귀 테스트.

function snap(partial: Partial<RuntimeConsoleStatusSnapshot>): RuntimeConsoleStatusSnapshot {
    return {
        state: 'idle',
        connected: false,
        reason: '',
        noPayloadStreak: 0,
        immediateEofStreak: 0,
        lastChangedAt: 0,
        ...partial,
    } as RuntimeConsoleStatusSnapshot;
}

test('1403 트리 상태 라벨: 상태별 한국어 문구, reconnecting 은 폴링이면 "이벤트 대기 폴링"', () => {
    const expect: Array<[RuntimeConsoleStatusSnapshot['state'], string]> = [
        ['connected', '연결됨'],
        ['connected-no-payload', '연결됨 · payload 대기'],
        ['connecting', '연결 중'],
        ['connect-failed', '연결 실패'],
        ['no-payload', 'payload 없음'],
        ['polling', '연결 유지 · 이벤트 대기'],
        ['stopped', '중지됨'],
        ['batch-complete', '연결 유지 · 배치 완료'],
        ['socket-error', '소켓 오류'],
    ];
    for (const [state, label] of expect) {
        assert.strictEqual(formatRuntimeConsoleTreeState(snap({ state })), label, state);
    }
    assert.strictEqual(formatRuntimeConsoleTreeState(snap({ state: 'reconnecting', reason: 'ECONNRESET' })), '재연결 대기');
    assert.strictEqual(formatRuntimeConsoleTreeState(snap({ state: 'reconnecting', immediateEofStreak: 2 })), '이벤트 대기 폴링');
    assert.strictEqual(formatRuntimeConsoleTreeState(snap({ state: 'idle' })), '미연결', 'default 분기: connected=false');
    assert.strictEqual(formatRuntimeConsoleTreeState(snap({ state: 'idle', connected: true })), '연결됨', 'default 분기: connected=true');
});

test('1403 트리 폴링 판정: state=polling · 즉시 EOF 연속 · 사유 문구(이벤트 큐/Idle timeout/Empty batch)', () => {
    assert.strictEqual(isRuntimeConsolePollingState(snap({ state: 'polling' })), true);
    assert.strictEqual(isRuntimeConsolePollingState(snap({ state: 'reconnecting', immediateEofStreak: 1 })), true);
    assert.strictEqual(isRuntimeConsolePollingState(snap({ state: 'reconnecting', reason: '이벤트 큐 비어 있음' })), true);
    assert.strictEqual(isRuntimeConsolePollingState(snap({ state: 'reconnecting', detail: 'Idle timeout' })), true);
    assert.strictEqual(isRuntimeConsolePollingState(snap({ state: 'reconnecting', reason: 'ECONNREFUSED' })), false);
});

test('1403 트리 상세: reason/detail/streak/재연결 지연을 " / " 로 잇고, 없으면 연결 여부 문구', () => {
    assert.strictEqual(formatRuntimeConsoleStatusDetail(snap({ connected: true })), '정상 연결');
    assert.strictEqual(formatRuntimeConsoleStatusDetail(snap({})), '상세 없음');
    assert.strictEqual(
        formatRuntimeConsoleStatusDetail(snap({ reason: 'R', detail: 'D', noPayloadStreak: 2, immediateEofStreak: 3, reconnectDelayMs: 500 })),
        'R / D / noPayloadStreak=2 / pollEmptyStreak=3 / reconnect=500ms',
    );
});

test('1403 트리 description: 상태 라벨 뒤에 재연결 지연 > 마지막 payload > payload 없음 > reason 순으로 하나만', () => {
    assert.strictEqual(buildRuntimeConsoleTreeDescription(snap({ state: 'reconnecting', reason: 'ECONNRESET', reconnectDelayMs: 800 })), '재연결 대기 · 800ms 뒤 재연결');
    assert.strictEqual(buildRuntimeConsoleTreeDescription(snap({ state: 'polling', reconnectDelayMs: 300 })), '연결 유지 · 이벤트 대기 · 300ms 뒤 폴링');
    const withPayload = buildRuntimeConsoleTreeDescription(snap({ state: 'connected', connected: true, lastPayloadAt: Date.UTC(2026, 8, 7), lastPayloadBytes: 128 }));
    assert.ok(withPayload.startsWith('연결됨 · 마지막 payload ') && withPayload.endsWith(' · 128B'), withPayload);
    assert.strictEqual(buildRuntimeConsoleTreeDescription(snap({ state: 'no-payload', noPayloadStreak: 4 })), 'payload 없음 · payload 없음 x4');
    assert.strictEqual(buildRuntimeConsoleTreeDescription(snap({ state: 'connect-failed', reason: 'ECONNREFUSED' })), '연결 실패 · ECONNREFUSED');
    assert.strictEqual(buildRuntimeConsoleTreeDescription(snap({ state: 'idle', reason: '미연결' })), '미연결', 'reason 이 "미연결"이면 중복 표기 안 함');
});

test('1403 트리 아이콘: 연결 유지 상태는 pass, 연결 중/재연결은 refresh, 나머지는 warning', () => {
    for (const state of ['connected-no-payload', 'batch-complete', 'polling'] as const) {
        assert.strictEqual(getRuntimeConsoleTreeIcon(snap({ state })), 'pass', state);
    }
    assert.strictEqual(getRuntimeConsoleTreeIcon(snap({ state: 'connected', connected: true })), 'pass');
    assert.strictEqual(getRuntimeConsoleTreeIcon(snap({ state: 'connecting' })), 'refresh');
    assert.strictEqual(getRuntimeConsoleTreeIcon(snap({ state: 'reconnecting' })), 'refresh');
    assert.strictEqual(getRuntimeConsoleTreeIcon(snap({ state: 'connect-failed' })), 'warning');
    assert.strictEqual(getRuntimeConsoleTreeIcon(snap({ state: 'idle' })), 'warning');
});

test('1403 트리 툴팁: 머리 2줄 + 선택 줄(연결 시도·payload·오류 코드·대기) + 조작 안내 2줄', () => {
    const lines = buildRuntimeConsoleTreeTooltip(snap({
        state: 'reconnecting', reason: 'ECONNRESET', detail: 'D', lastConnectAt: 1, lastPayloadAt: 2, lastPayloadBytes: 9,
        lastErrorCode: 'ECONNRESET', reconnectDelayMs: 700, reconnectAttempt: 3,
    }), '192.168.0.1', 1403).split('\n');
    assert.strictEqual(lines[0], '1403 콘솔: 재연결 대기 (192.168.0.1:1403)');
    assert.strictEqual(lines[1], '상세: ECONNRESET / D / reconnect=700ms');
    assert.ok(lines[2].startsWith('마지막 연결 시도: '), lines[2]);
    assert.ok(lines[3].startsWith('마지막 payload: ') && lines[3].endsWith(' (9B)'), lines[3]);
    assert.strictEqual(lines[4], '마지막 오류 코드: ECONNRESET');
    assert.strictEqual(lines[5], '재연결 대기: 700ms (attempt 3)');
    assert.deepStrictEqual(lines.slice(6), ['클릭: 연결/재연결 후 로그 보기', '버튼: 트래픽 보기']);
    const minimal = buildRuntimeConsoleTreeTooltip(snap({ state: 'idle' }), 'ip', 1403).split('\n');
    assert.strictEqual(minimal.length, 4, '선택 줄이 없으면 머리 2줄 + 안내 2줄');
});

test('1403 트리 불안정 판정: 연결됨/정상 폴링/중지는 안정, payload 없음 5회 이상·거부/소켓 오류 문구는 불안정', () => {
    assert.strictEqual(isRuntimeConsoleUnstable(snap({ state: 'connected', connected: true })), false);
    for (const state of ['stopped', 'idle', 'polling', 'batch-complete', 'connected-no-payload'] as const) {
        assert.strictEqual(isRuntimeConsoleUnstable(snap({ state, noPayloadStreak: 9 })), false, state);
    }
    assert.strictEqual(isRuntimeConsoleUnstable(snap({ state: 'reconnecting', immediateEofStreak: 2 })), false, '즉시 EOF 만 있으면 폴링으로 본다');
    assert.strictEqual(isRuntimeConsoleUnstable(snap({ state: 'no-payload', noPayloadStreak: 5 })), true);
    assert.strictEqual(isRuntimeConsoleUnstable(snap({ state: 'no-payload', noPayloadStreak: 4 })), false);
    assert.strictEqual(isRuntimeConsoleUnstable(snap({ state: 'connect-failed', reason: 'connect ECONNREFUSED' })), true);
    assert.strictEqual(isRuntimeConsoleUnstable(snap({ state: 'socket-error', reason: 'socket error' })), true);
    assert.strictEqual(isRuntimeConsoleUnstable(snap({ state: 'connect-failed', reason: '기타' })), false);
});

test('1403 트리 가설 문구: ECONNREFUSED → 포트 점유/서비스 비활성, polling → 정상 폴링, no-payload → Idle 가능, 그 외 없음', () => {
    assert.ok(getRuntimeConsoleHypothesis(snap({ state: 'connect-failed', lastErrorCode: 'ECONNREFUSED' }))!.includes('포트를 점유'));
    assert.ok(getRuntimeConsoleHypothesis(snap({ state: 'connect-failed', detail: 'connect ECONNREFUSED 1403' }))!.includes('포트를 점유'));
    assert.ok(getRuntimeConsoleHypothesis(snap({ state: 'polling' }))!.includes('정상 폴링'));
    assert.ok(getRuntimeConsoleHypothesis(snap({ state: 'no-payload' }))!.includes('Idle'));
    assert.ok(getRuntimeConsoleHypothesis(snap({ state: 'connected-no-payload', connected: true }))!.includes('Idle'));
    assert.strictEqual(getRuntimeConsoleHypothesis(snap({ state: 'connected', connected: true })), undefined);
});
