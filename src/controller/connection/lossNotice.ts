/**
 * 명령 콘솔 유실 알림 문구(vscode 무의존) — 원인 정황(PC 절전 복귀·복구 대기 만료·확장 호스트 정지)에 따라
 * 무엇을 하면 되는지를 한 문장으로 고른다. 판정 자체(유실 확정)는 connectionHealth 가 하고, 여기는 문구만 정한다.
 *
 * 문구 원칙(2026-08-31): 확장이 "명령 채널을 놓았다"는 것이 사실이고 제어기가 죽었다는 것은 판단이다 — 단정하지 않는다.
 * 다만 PC 절전 복귀가 OS 기록으로 확인되면 "제어기 문제로 보지 않는다"고 말해도 된다(2026-11-03 실측 5건).
 */

import type { PcResumeMatch } from './pcPowerEvents';
import { describePcResume } from './pcPowerEvents';

/** 알림의 다시 연결 버튼 이름 — activation 이 같은 문자열로 선택을 판별한다. */
export const RECONNECT_ACTION = '다시 연결';

export interface LossNoticeInput {
    ip: string;
    failures: number;
    /** 복구 대기 만료 뒤 거부 안내(connectionHealth.recoveryGuidanceForLoss). */
    guidance?: string;
    /** 판정 지연 중 확장 호스트 정지 안내. */
    stallNote?: string;
    /** PC 절전 복귀와 맞물렸으면 그 기록. */
    resume?: PcResumeMatch;
    /** 사후 스냅샷 파일이 있는가. */
    hasPostmortem: boolean;
    clock: (ms: number) => string;
}

export function composeLossNotice(input: LossNoticeInput): string {
    const head = `GPL Controller 명령 콘솔 연결을 놓았습니다 (${input.ip}) — `;
    const parts: string[] = [];
    if (input.resume) {
        // 절전 복귀는 연속 무응답 횟수보다 계기가 중요하다. 정지 안내는 절전 시간과 같은 내용이라 덧붙이지 않는다.
        parts.push(`${describePcResume(input.resume, input.clock)} 직후에 끊겼습니다. PC 가 자는 동안 네트워크가 내려간 것으로, 제어기 문제로 보지 않습니다. `
            + `네트워크가 다시 올라오면 「${RECONNECT_ACTION}」을 눌러 주세요.`);
        if (input.guidance) { parts.push(input.guidance); }
    } else {
        parts.push(`${input.failures}회 연속 무응답으로 연결 상태를 해제했습니다.`);
        parts.push(input.guidance ?? `제어기가 다운됐다는 뜻은 아닙니다(런타임 상태 미확정) — 「${RECONNECT_ACTION}」으로 다시 연결해 보세요.`);
        if (input.stallNote) { parts.push(input.stallNote); }
    }
    if (input.hasPostmortem) { parts.push('마지막 트래픽·도달성 판정은 사후 스냅샷 파일에 있습니다.'); }
    return head + parts.join(' ');
}
