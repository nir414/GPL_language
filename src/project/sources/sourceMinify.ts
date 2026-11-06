/**
 * GPL 소스 경량화(배포 전처리) — **줄 번호를 지키면서** 주석·공백만 덜어 낸다. vscode·fs 무의존 순수 모듈.
 *
 * 왜: 제어기는 `/GPL` 에 올린 소스를 메모리에 그대로 쥔다. 주석만 빈 줄로 바꾼 사본은 업로드 몫이 0.93 MB 줄고
 * 컴파일 결과는 같았다(2026-11-05 Sample Prep 실측, 수신함 gpl-source-memory-strip-purge). 줄 수를 바꾸지 않으므로
 * 컴파일 오류의 file:line · 중단점 · Show Stack 이 원본 줄과 그대로 맞는다.
 *
 * 근거(문서상, Statement Structure Overview
 * https://www2.brooksautomation.com/Controller_Software/Introduction_To_The_Software/Guidance_Programming_Language/statementstructure.htm):
 * - 주석은 문자열 밖의 `'` 부터 줄 끝까지다. 주석 줄은 이어 쓸 수 없다(` _` 연속 대상이 아니다).
 * - `#` 로 시작하는 줄은 무시된다(`#Region` 등).
 * - 문자열은 줄을 넘지 않으므로 줄 앞뒤 공백은 문자열 내용이 될 수 없다.
 *
 * 바이트 안전: 파일 인코딩(UTF-8·CP949 등)을 해석하지 않고 latin1 로 1:1 대응시켜 ASCII 구분자(`'` `"` 공백·탭·줄바꿈)만
 * 본다. UTF-8 연속 바이트(0x80–0xBF)와 CP949 둘째 바이트(0x41–0xFE)는 이 구분자 값과 겹치지 않으므로 다국어 문자열·주석이
 * 깨지지 않는다. 줄바꿈 문자(CRLF/LF/CR)와 UTF-8 BOM 은 원문 그대로 둔다.
 */

import { stripComment } from '../../language/checks/logicalLines';

export interface MinifyOptions {
    /** 주석 줄·`#` 줄을 빈 줄로, 줄 끝 주석을 지운다(문자열 안 `'` 는 보존). */
    stripComments: boolean;
    /** 줄 앞 들여쓰기와 줄 끝 공백(공백·탭)을 지운다. */
    trimWhitespace: boolean;
}

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
/** 줄바꿈을 보존하며 나눈다 — 짝수 칸은 줄 내용, 홀수 칸은 줄바꿈 문자. */
const LINE_SPLIT = /(\r\n|\n|\r)/;
const DIRECTIVE_LINE = /^[ \t]*#/;
const TRAILING_BLANK = /[ \t]+$/;
const LEADING_BLANK = /^[ \t]+/;

/** 한 줄 경량화. 결과는 원래 줄의 앞부분(공백 제외)이거나 빈 문자열이다 — 코드 토큰을 바꾸거나 옮기지 않는다. */
export function minifyGplLine(line: string, opts: MinifyOptions): string {
    let out = line;
    if (opts.stripComments) {
        if (DIRECTIVE_LINE.test(out)) { return ''; }
        const code = stripComment(out);
        // 주석을 지웠을 때만 그 앞에 남은 공백을 함께 지운다(`x = 1   ' 설명` → `x = 1`).
        if (code.length !== out.length) { out = code.replace(TRAILING_BLANK, ''); }
    }
    if (opts.trimWhitespace) {
        out = out.replace(LEADING_BLANK, '').replace(TRAILING_BLANK, '');
    }
    return out;
}

/** 텍스트 경량화 — 줄 수·줄바꿈 문자를 그대로 둔다. 옵션이 모두 꺼져 있으면 입력을 그대로 돌려준다. */
export function minifyGplText(text: string, opts: MinifyOptions): string {
    if (!opts.stripComments && !opts.trimWhitespace) { return text; }
    const parts = text.split(LINE_SPLIT);
    for (let i = 0; i < parts.length; i += 2) {
        parts[i] = minifyGplLine(parts[i], opts);
    }
    return parts.join('');
}

/** 파일 바이트 경량화 — 인코딩을 해석하지 않는다(머리말 참고). UTF-8 BOM 은 보존한다. */
export function minifyGplBuffer(content: Buffer, opts: MinifyOptions): Buffer {
    if (!opts.stripComments && !opts.trimWhitespace) { return content; }
    const hasBom = content.length >= 3 && content.subarray(0, 3).equals(UTF8_BOM);
    const body = hasBom ? content.subarray(3) : content;
    const out = Buffer.from(minifyGplText(body.toString('latin1'), opts), 'latin1');
    return hasBom ? Buffer.concat([UTF8_BOM, out]) : out;
}

/** 줄 수 — 줄바꿈 문자 수 + 1(빈 내용은 0). 경량화 전후가 같아야 한다(테스트·보고용). */
export function countLines(text: string): number {
    if (text.length === 0) { return 0; }
    return (text.split(LINE_SPLIT).length + 1) / 2; // 나눈 조각 = 내용 k+1 + 줄바꿈 k
}
