/**
 * 런타임 콘솔(1403) 라인 정규화.
 *
 * 책임: latin1→UTF-8 디코딩 규약, 상태 이벤트 프레임 판정, `<E>…</E>` 프레임 정규화.
 * `responseParser.ts` 에서 응답 종류별로 분리했다(2026-10-27) — 함수 본문은 그대로 옮겼고,
 * 기존 import 경로는 `responseParser.ts` 배럴이 유지한다.
 */

/**
 * 1403 수신 바이트를 잃지 않고 문자열로 다루기 위한 규약(2026-08-28, GDE 캡처 판독):
 * 소켓 chunk 는 `latin1`(바이트 1:1)로 문자열화해 프레임/청크 경계를 찾고, **완성된 메시지 단위**에서만
 * 이 함수로 UTF-8 디코딩한다. 제어기는 콘솔 텍스트를 UTF-8로 보내며(한글 확인) 128바이트 청크 경계나
 * TCP 세그먼트 경계가 다바이트 문자 중간에 걸릴 수 있어, 청크를 먼저 이어 붙인 뒤 디코딩해야 한다.
 * (종전 `toString('ascii')`는 상위 비트를 버려 비ASCII 를 복구 불가능하게 망가뜨렸다.)
 */
export function latin1ToUtf8(latin1Text: string): string {
    if (!latin1Text) { return latin1Text; }
    // 모두 7비트면 변환 불필요 (빠른 경로)
    if (!/[-ÿ]/.test(latin1Text)) { return latin1Text; }
    return Buffer.from(latin1Text, 'latin1').toString('utf8');
}

/**
 * 포트 1403에서 수신되는 런타임 콘솔 라인 정규화.
 * `<E>type,source<L>len</L>message</E>` → `[source] message`
 *
 * 실측(1403 캡처) 메모:
 *  - 프레임 구분자는 `</E>` + `\n` + NUL(`\x00`).
 *  - `<L>N</L>`의 N은 로그 레벨이 아니라 **메시지 청크의 바이트 길이**다.
 *  - 긴 줄은 128바이트 단위로 여러 프레임에 쪼개져 오며, 마지막 청크만 `\n`으로 끝난다.
 *    (청크 재조립은 RuntimeConsole.emitConsoleFrame에서 수행하고, 여기서는 단일 프레임만 정규화한다.)
 *  - 숫자만 든 프레임(`<E>1,N</E>`·`<E>2</E>` 등)은 로그가 아니라 상태 이벤트이므로 빈 문자열로 억제한다
 *    (판정 정본은 `isConsoleStatusEventFrame`).
 */
/**
 * 숫자만 든 1403 프레임 = **상태 이벤트**(로그가 아님). `Start … -event` 가 보내는 쓰레드 상태 변화 신호다.
 *
 * GDE 캡처(`captures/gde_1403.pcapng`, 395프레임)에는 `<E>1,N</E>` 형태만 있었지만, 실기에서
 * `<E>2</E>`·`<E>0</E>` 처럼 **숫자 하나짜리** 프레임도 온다(2026-09-21 사용자 관측, GPL 5.1D6).
 * 종전 규칙이 두 숫자 형태만 알아서, 단일 숫자 프레임은 억제되지 않고 `</E>` 만 떨어져 나간
 * `<E>2` 가 GPL Console 에 그대로 찍혔다. 숫자와 콤마만 있는 프레임은 전부 상태 이벤트로 본다 —
 * 어차피 사람이 읽을 메시지가 없다(메시지는 `<L>len</L>` 뒤에 온다).
 */
export function isConsoleStatusEventFrame(line: string): boolean {
    const s = line.replace(/\0/g, '').replace(/\r/g, '').trim();
    return /^<E>\d+(?:,\d+)*<\/E>$/.test(s);
}

export function normalizeConsoleLine(line: string): string {
    const s = line.replace(/\0/g, '').replace(/\r/g, '').trim();
    if (!s || s === '</E>' || isConsoleStatusEventFrame(s)) {
        return '';
    }

    let project = '';
    const projMatch = s.match(/<E>\d+,([^<]+)<L>\d+<\/L>/);
    if (projMatch) {
        project = projMatch[1].trim();
    }

    const msg = s.replace(/^.*<L>\d+<\/L>/, '').replace(/<\/E>$/, '').trim();

    if (msg && project) {
        return `[${project}] ${msg}`;
    }
    if (msg) {
        return msg;
    }

    // Fallback: <E>ts,content</E>
    const fallback = s.match(/^<E>\d+,(.*)<\/E>$/);
    if (fallback) {
        return fallback[1].trim();
    }

    return s;
}
