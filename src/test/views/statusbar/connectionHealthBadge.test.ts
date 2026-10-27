import * as assert from 'assert';
import { test } from '../../harness';
import { DEFAULT_CONNECTION_HEALTH_POLICY, type HealthSnapshot } from '../../../controller/connection/connectionHealth';
import { presentConnectionHealth } from '../../../views/statusbar/connectionHealthBadge';

const base: HealthSnapshot = { state: 'connected', consecutiveFailures: 0, consecutiveDefinitiveFailures: 0, recoveryProbeFailures: 0 };
const policy = DEFAULT_CONNECTION_HEALTH_POLICY;

test('presentConnectionHealth: connected/disconnected 는 표시 없음(종전 연결 항목 그대로)', () => {
    assert.strictEqual(presentConnectionHealth('192.168.0.1', base, policy, 0), undefined);
    assert.strictEqual(presentConnectionHealth('192.168.0.1', { ...base, state: 'disconnected' }, policy, 0), undefined);
});

test('presentConnectionHealth: suspect — 첫 신호부터 실패 횟수/임계와 계기를 보이되 다운이라고 단정하지 않는다', () => {
    const badge = presentConnectionHealth('192.168.0.1', {
        ...base,
        state: 'suspect',
        consecutiveFailures: 2,
        suspectSince: 1_000,
        suspectReason: 'keep-alive-socket: read ECONNRESET (ECONNRESET) (held 119s)',
        lastFailure: { kind: 'timeout', detail: 'Command timeout (8000ms): Show Thread  -web', at: 9_000 },
    }, policy, 13_400);
    assert.ok(badge);
    assert.strictEqual(badge.text, '$(sync~spin) GPL: 192.168.0.1 응답 확인 중 (실패 2/3)');
    const lines = badge.tooltip.split('\n');
    assert.strictEqual(lines[0], '명령 콘솔 응답 확인 중 — 12 s 경과');
    assert.strictEqual(lines[1], '계기: keep-alive-socket: read ECONNRESET (ECONNRESET) (held 119s)');
    assert.strictEqual(lines[2], '마지막 실패: timeout — Command timeout (8000ms): Show Thread  -web');
    assert.ok(badge.tooltip.includes('연속 3회 실패(연결 거부·도달 불가는 2회)'));
    assert.ok(badge.tooltip.includes('다운됐다는 판정은 아닙니다'));
});

test('presentConnectionHealth: suspect 직후(프로브 결과 전)도 표시한다', () => {
    const badge = presentConnectionHealth('10.0.0.5', { ...base, state: 'suspect', suspectSince: 5_000, suspectReason: 'runtime-console: connect-failed' }, policy, 5_000);
    assert.strictEqual(badge?.text, '$(sync~spin) GPL: 10.0.0.5 응답 확인 중 (실패 0/3)');
    assert.ok(badge?.tooltip.includes('마지막 실패: (아직 프로브 결과 없음)'));
});

test('presentConnectionHealth: recovering — 경과/창과 근거 명령, 결과 미확정을 보인다', () => {
    const badge = presentConnectionHealth('192.168.0.1', {
        ...base,
        state: 'recovering',
        recoveringSince: 0,
        recoveryProbeFailures: 7,
        disruptiveOperation: { command: 'Unload BinderR4', kind: 'timeout', detail: 'Command timeout', at: 0 },
    }, policy, 37_499);
    assert.ok(badge);
    assert.strictEqual(badge.text, '$(watch) GPL: 192.168.0.1 복구 대기 37/180 s');
    assert.ok(badge.tooltip.startsWith('Unload BinderR4 가 응답 없이 끝난 뒤(timeout) 명령 콘솔 복구를 기다리는 중'));
    assert.ok(badge.tooltip.includes('프로브 실패 7회'));
    assert.ok(badge.tooltip.includes('실제 결과는 미확정'));
    assert.ok(badge.tooltip.endsWith('클릭: 기다리지 않고 지금 연결 해제'));
});
