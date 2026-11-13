/**
 * 디버그 세션 시작 때 DataID 307 "Break on exception code" 를 한 번 읽어, 0 이 아니면 Try…Catch…Finally 가
 * 평소와 다르게 동작한다는 한 줄을 Debug Console 에 남기는 순수 모듈.
 *
 * 문서상(Brooks GPL Dictionary, Try…Catch…Finally Prerequisites): "If 'Break on exception code' (DataID 307) is set or
 * if an application is started in GDE with 'Break on exception' enabled, any active Try...Catch structures are ignored."
 *   https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Statements/trycatchfinally.htm
 * (Sample Prep 보고 2026-11-06 §2 — 10-02 의 "Finally 재실행·객체 정보 유실" 관측의 다른 설명 후보. 미검증 추정이므로
 * 문구는 "다를 수 있습니다" 로 쓴다.)
 *
 * 값은 로봇/쓰레드별 여러 개일 수 있다(보고: 8개 값, 모두 0). 하나라도 0 이 아니면 알린다. 읽기 실패·해석 불가는 조용히 건너뛴다.
 */

import { parseDataIdNumbers } from '../../controller/diagnostics/robotAxes';

export const DATAID_BREAK_ON_EXCEPTION = 307;
export const BREAK_ON_EXCEPTION_CMD = `pd ${DATAID_BREAK_ON_EXCEPTION}`;

/** pd 307 응답 → 0 이 아닌 값이 있으면 Debug Console 한 줄, 아니면 null. */
export function breakOnExceptionNotice(raw: string | null): string | null {
    const values = parseDataIdNumbers(raw);
    if (!values) { return null; }
    const set = values.filter((v): v is number => v !== null && v !== 0);
    if (set.length === 0) { return null; }
    return `제어기의 Break on exception code(DataID ${DATAID_BREAK_ON_EXCEPTION})가 설정돼 있습니다(${set.join(', ')}). `
        + '문서상 이 값이 켜져 있으면 활성 Try…Catch 구조가 무시되므로 Catch·Finally 동작이 평소와 다를 수 있습니다.';
}

/** 읽기 1회(실패 허용). 알릴 문구가 있으면 log 로 한 줄 남긴다. */
export async function reportBreakOnException(
    sendCmd: (command: string) => Promise<string | null>,
    log: (message: string) => void,
): Promise<void> {
    try {
        const notice = breakOnExceptionNotice(await sendCmd(BREAK_ON_EXCEPTION_CMD));
        if (notice) { log(notice); }
    } catch {
        // 보조 진단 — 읽기 실패가 세션 시작을 막지 않는다.
    }
}
