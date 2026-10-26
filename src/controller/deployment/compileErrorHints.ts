/**
 * 컴파일 에러 한 건에 "그 줄을 보면 원인이 이것일 가능성이 크다"는 안내를 고른다. vscode 무의존 순수 모듈.
 *
 * 안내 문장 자체는 `responseParser` 의 코드별 힌트 표(`getErrorCodeHint`)가 정본이다 — 여기서는 **언제 붙일지**만 정한다.
 * 근거: 2026-10-25 실기 컴파일(inbox gpl-overload-return-type-and-new-parens).
 *   - `-741 Argument mismatch` 가 함수 선언 줄에서 나면 반환형이 다른 오버로드다. 그 본문은 `-733`/`-773` 으로 쏟아진다.
 *   - `-722 Unexpected text at end of line` 이 `New X()` 줄에서 나면 X 에 `Sub New` 가 없다.
 *   - `-737 Too many errors` 는 파일당 약 20개에서 끊긴 것 — 뒤 오류는 다음 컴파일에서야 보인다.
 */

import { CompileError, getErrorCodeHint } from '../protocol/responseParser';

const DECLARATION_LINE = /^\s*(?:(?:Public|Private|Protected|Friend|Shared|Overloads|Overrides|Overridable|Shadows)\s+)*(?:Function|Sub)\s+[A-Za-z_]\w*/i;
const NEW_WITH_EMPTY_PARENS = /\bNew\s+[A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)*\s*\(\s*\)/i;

/** 주석(문자열 밖 `'` 이후)을 지운다 — 주석 속 `New X()` 로 안내가 붙지 않게. */
function stripComment(line: string): string {
    let inString = false;
    for (let i = 0; i < line.length; i++) {
        if (line[i] === '"') { inString = !inString; }
        else if (line[i] === "'" && !inString) { return line.slice(0, i); }
    }
    return line;
}

function sameFile(a: CompileError, b: CompileError): boolean {
    return a.file.replace(/\\/g, '/').toLowerCase() === b.file.replace(/\\/g, '/').toLowerCase();
}

/**
 * @param lineText 에러가 가리키는 소스 줄(읽지 못했으면 undefined — 줄을 봐야 하는 안내는 붙이지 않는다).
 * @param errors   같은 컴파일의 전체 에러(파생 오류 판정용).
 */
export function compileErrorHint(err: CompileError, errors: readonly CompileError[], lineText: string | undefined): string | undefined {
    const hint = getErrorCodeHint(err.code);
    if (!hint) { return undefined; }
    const code = lineText === undefined ? undefined : stripComment(lineText);
    switch (err.code) {
        case -741:
            return code !== undefined && DECLARATION_LINE.test(code) ? hint.action : undefined;
        case -722:
            return code !== undefined && NEW_WITH_EMPTY_PARENS.test(code) ? hint.action : undefined;
        case -733:
        case -773: {
            const origin = errors.find(e => e.code === -741 && sameFile(e, err) && e.line < err.line);
            return origin ? `${origin.line}행 -741 의 파생 오류일 가능성이 큽니다 — ${hint.action}` : undefined;
        }
        case -737:
            return hint.action;
        default:
            return undefined;
    }
}

/**
 * 에러마다 `hint` 를 채운다(제자리 갱신 — Problems 진단과 자동화 결과의 compileErrors 가 같은 객체를 공유한다).
 * `readLine(file, line)` 은 1-기준 줄 번호의 소스 줄을 돌려주고, 못 읽으면 undefined.
 */
export function attachCompileErrorHints(
    errors: CompileError[],
    readLine: (file: string, line: number) => string | undefined,
): void {
    for (const err of errors) {
        const hint = compileErrorHint(err, errors, readLine(err.file, err.line));
        if (hint) { err.hint = hint; } else { delete err.hint; }
    }
}
