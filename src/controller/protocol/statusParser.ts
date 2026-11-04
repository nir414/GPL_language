/**
 * 콘솔 응답의 `<STATUS>` 블록 파서.
 *
 * 책임: `<STATUS>code,"message"</STATUS>` 추출과 성공 판정, STATUS 없음 센티널(`NO_STATUS_CODE`).
 * `responseParser.ts` 에서 응답 종류별로 분리했다(2026-10-27) — 함수 본문은 그대로 옮겼고,
 * 기존 import 경로는 `responseParser.ts` 배럴이 유지한다.
 */

export interface StatusResult {
    code: number;
    message: string;
    raw: string;
}

/** STATUS 블록이 응답에 없을 때 parseStatus가 반환하는 센티널 코드. */
export const NO_STATUS_CODE = -9999;

/**
 * 응답에서 `<STATUS>code,"message"</STATUS>` 추출.
 * STATUS가 없으면 code = NO_STATUS_CODE(-9999). **닫는 `</STATUS>` 까지 온 블록만** 인정한다(하드 규칙 2) —
 * `<STATUS>-75` 에서 잘린 응답의 숫자를 코드로 읽지 않는다(2026-11-04 §1-GZ).
 */
export function parseStatus(response: string): StatusResult {
    // DATA 본문에 STATUS 텍스트가 포함될 수 있으므로(파일/로그 덤프 응답),
    // 실제 종결 STATUS인 "마지막" 블록을 채택한다.
    const re = /<STATUS>\s*(-?\d+)(?:,\s*"([^"]*)")?[^<]*<\/STATUS>/g;
    let m: RegExpExecArray | null;
    let last: RegExpExecArray | null = null;
    while ((m = re.exec(response)) !== null) { last = m; }
    if (last) {
        return { code: parseInt(last[1], 10), message: last[2] || '', raw: response };
    }
    return { code: NO_STATUS_CODE, message: 'No STATUS found', raw: response };
}

export function isSuccess(response: string): boolean {
    return parseStatus(response).code === 0;
}
