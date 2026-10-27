/**
 * 연결 항목의 "확인 중 / 복구 대기" 표시(순수) — 2026-10-27 "제어기 죽은 판정이 왜 이렇게 느린가" 대응.
 *
 * 종전에는 연결 건강 모니터가 suspect·recovering 이어도 상태바가 유실 확정 순간까지 `$(plug) GPL: <ip>`(정상)였다.
 * 판정 규칙(연속 실패 임계·복구 대기 창)은 그대로 두되, **첫 이상 신호부터** 지금 무엇을 확인하는 중인지 보인다 —
 * "제어기가 죽었다"고 쓰지 않는다(관측과 판단을 섞지 않는다). 유실 확정은 여전히 connectionHealth 가 한다.
 */

import type { ConnectionHealthPolicy, HealthSnapshot } from '../../controller/connection/connectionHealth';

export interface ConnectionHealthBadge {
    text: string;
    tooltip: string;
}

type BadgePolicy = Pick<ConnectionHealthPolicy, 'failureThreshold' | 'definitiveFailureThreshold' | 'recoveryWindowMs'>;

/** connected/disconnected 면 undefined(종전 표시 그대로). */
export function presentConnectionHealth(ip: string, snap: HealthSnapshot, policy: BadgePolicy, now: number): ConnectionHealthBadge | undefined {
    if (snap.state === 'suspect') {
        const since = snap.suspectSince ?? now;
        const elapsed = seconds(now - since);
        const last = snap.lastFailure ? `${snap.lastFailure.kind} — ${snap.lastFailure.detail}` : '(아직 프로브 결과 없음)';
        return {
            text: `$(sync~spin) GPL: ${ip} 응답 확인 중 (실패 ${snap.consecutiveFailures}/${policy.failureThreshold})`,
            tooltip: [
                `명령 콘솔 응답 확인 중 — ${elapsed} s 경과`,
                `계기: ${snap.suspectReason ?? '(미상)'}`,
                `마지막 실패: ${last}`,
                `연속 ${policy.failureThreshold}회 실패(연결 거부·도달 불가는 ${policy.definitiveFailureThreshold}회)면 연결 상태를 해제합니다.`,
                '제어기가 다운됐다는 판정은 아닙니다.',
                '클릭: 지금 연결 해제',
            ].join('\n'),
        };
    }
    if (snap.state === 'recovering') {
        const since = snap.recoveringSince ?? now;
        const op = snap.disruptiveOperation;
        return {
            text: `$(watch) GPL: ${ip} 복구 대기 ${seconds(now - since)}/${seconds(policy.recoveryWindowMs)} s`,
            tooltip: [
                `${op ? `${op.command} 가 응답 없이 끝난 뒤(${op.kind})` : '채널 교란 가능 명령 뒤'} 명령 콘솔 복구를 기다리는 중`,
                `이 사이의 연결 거부는 유실로 세지 않습니다(프로브 실패 ${snap.recoveryProbeFailures}회).`,
                `${seconds(policy.recoveryWindowMs)} s 안에 응답이 오면 그대로 이어지고, 넘기면 일반 판정(연속 실패 임계)으로 넘어갑니다.`,
                '그 명령의 실제 결과는 미확정입니다.',
                '클릭: 기다리지 않고 지금 연결 해제',
            ].join('\n'),
        };
    }
    return undefined;
}

function seconds(ms: number): number {
    return Math.max(0, Math.round(ms / 1000));
}
