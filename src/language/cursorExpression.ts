/**
 * 커서 위치의 식별자/멤버 접근 표현식을 다루는 순수 헬퍼.
 *
 * definitionProvider / referenceProvider / gplParser가 각자 복제하던 로직을
 * 단일 정본으로 모은 것이다. vscode API에 의존하지 않으므로 Node 단독으로
 * 단위 테스트가 가능하다.
 */

/**
 * 정규식 메타문자를 이스케이프한다 (MDN 표준 구현).
 *
 * 동적으로 만든 식별자/한정자를 `new RegExp(...)`에 넣을 때 사용한다.
 */
export function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 멤버 접근 표현식에서 점(.) 바로 앞의 "기준 객체 이름"을 추출한다.
 *
 * 표현식의 끝에서부터 스캔하여, "returnError = armList(0).member"처럼
 * 첫 식별자(returnError)가 기준 객체가 아닌 경우에도 올바르게 armList를 얻는다.
 * 예:
 *   "returnError = armList(0)" → "armList"
 *   "myRobot(index)"          → "myRobot"
 *   "obj"                     → "obj"
 *   "arr(0)(1)"               → "arr"
 */
export function extractBaseObjectName(expression: string): string | undefined {
    let pos = expression.length - 1;

    // 끝쪽 공백 스킵
    while (pos >= 0 && /\s/.test(expression[pos])) {
        pos--;
    }

    // 오른쪽에서 왼쪽으로 균형 잡힌 괄호 그룹 스킵
    while (pos >= 0 && expression[pos] === ')') {
        let depth = 0;
        while (pos >= 0) {
            if (expression[pos] === ')') { depth++; }
            else if (expression[pos] === '(') { depth--; }
            if (depth === 0) { pos--; break; }
            pos--;
        }
        // 연속된 괄호 그룹 사이 공백 스킵
        while (pos >= 0 && /\s/.test(expression[pos])) {
            pos--;
        }
    }

    // 현재 위치에서 끝나는 식별자 추출
    const endPos = pos + 1;
    while (pos >= 0 && /[a-zA-Z0-9_]/.test(expression[pos])) {
        pos--;
    }

    const name = expression.substring(pos + 1, endPos);
    return name.length > 0 && /^[a-zA-Z_]/.test(name) ? name : undefined;
}

/**
 * Sub/Function/Property 선언 앞에 올 수 있는 VB/GPL 수식어 목록.
 *
 * 파서(gplParser)의 Sub/Function 가드와 Property 가드에 흩어져 있던 목록을
 * 하나로 모은 합집합이다. 정의/참조 Provider가 "감싸는 프로시저"를 찾을 때
 * 파서와 동일한 집합을 인식하도록 단일 정본으로 사용한다.
 */
export const GPL_PROC_MODIFIERS: readonly string[] = [
    'Public', 'Private', 'Protected', 'Friend', 'Shared',
    'Overrides', 'Overloads', 'Overridable', 'NotOverridable', 'MustOverride',
    'Shadows', 'Partial', 'ReadOnly', 'WriteOnly', 'Default'
];

/**
 * 한 줄(trim된)이 Sub/Function/Property 선언 헤더인지 판별하고, 종류를 돌려준다.
 *
 * 수식어 순서·개수에 관계없이(예: `Public Overrides Sub`, `Friend Shared Function`)
 * 인식한다. 파서가 파싱하는 선언을 Provider도 동일하게 헤더로 인정하도록 맞춘다.
 */
export function matchProcedureHeaderKind(trimmedLine: string): 'Sub' | 'Function' | 'Property' | undefined {
    const mods = GPL_PROC_MODIFIERS.join('|');
    const re = new RegExp(`^\\s*(?:(?:${mods})\\b\\s+)*(Sub|Function|Property)\\b`, 'i');
    const m = re.exec(trimmedLine);
    if (!m) {
        return undefined;
    }
    const kind = m[1].toLowerCase();
    return kind === 'sub' ? 'Sub' : kind === 'function' ? 'Function' : 'Property';
}

/**
 * atLine을 감싸는 Sub/Function/Property 프로시저의 [헤더..End] 라인 범위를 찾는다.
 *
 * 위로 스캔하다 헤더보다 먼저 `End Sub/Function/Property`(atLine 자신은 제외)를 만나면
 * atLine은 프로시저 "사이"(모듈 레벨)이므로 undefined를 돌려준다 — 프로시저 밖 위치가
 * 직전 프로시저에 잘못 귀속되던 버그 방지. Module/Class 경계에서도 스캔을 멈춘다.
 * definitionProvider / hoverProvider가 공유하는 단일 정본이다.
 */
export function findEnclosingProcedureRange(
    getLine: (line: number) => string,
    lineCount: number,
    atLine: number
): { startLine: number; endLine: number } | undefined {
    let headerLine = -1;
    let headerKind: 'Sub' | 'Function' | 'Property' | undefined;

    for (let i = atLine; i >= 0; i--) {
        const trimmed = getLine(i).trim();
        if (trimmed.startsWith("'")) {
            continue;
        }

        // 파서와 동일한 수식어 집합으로 헤더를 인식한다.
        const kind = matchProcedureHeaderKind(trimmed);
        if (kind) {
            headerLine = i;
            headerKind = kind;
            break;
        }

        // 헤더 전에 위쪽의 End Sub/Function/Property를 만나면 프로시저 밖이다.
        // (atLine 자신이 End 라인인 경우는 그 프로시저 내부로 취급)
        if (i < atLine && /^\s*End\s+(Sub|Function|Property)\b/i.test(trimmed)) {
            return undefined;
        }

        // Stop if we hit a new type/module boundary before any header.
        if (/^\s*(Module|Class)\b/i.test(trimmed)) {
            break;
        }
    }

    if (headerLine < 0 || !headerKind) {
        return undefined;
    }

    // Find matching End <Kind>.
    let endLine = headerLine;
    const endRe = new RegExp(`^\\s*End\\s+${headerKind}\\b`, 'i');
    for (let i = headerLine + 1; i < lineCount; i++) {
        const trimmed = getLine(i).trim();
        if (trimmed.startsWith("'")) {
            continue;
        }
        if (endRe.test(trimmed)) {
            endLine = i;
            break;
        }
    }

    return { startLine: headerLine, endLine };
}

/**
 * 파라미터/인자 문자열을 최상위 콤마 기준으로 분리한다.
 *
 * 문자열 리터럴("..."), 중첩 괄호 `()`/대괄호 `[]` 내부의 콤마는 구분자로 보지 않는다.
 * 따라서 `Optional p As Foo = Bar(1, 2)`, `x As String = ","` 같은 기본값도 하나의
 * 파라미터로 유지된다. 비어 있거나 공백뿐인 항목은 결과에서 제외하므로,
 * `Sub Foo( )`처럼 공백만 든 괄호는 0개로 계산된다.
 */
export function splitParameters(paramText: string | undefined | null): string[] {
    if (!paramText) {
        return [];
    }

    const parts: string[] = [];
    let depth = 0;
    let inString = false;
    let current = '';

    for (let i = 0; i < paramText.length; i++) {
        const ch = paramText[i];

        if (ch === '"') {
            // VB식 "" 이스케이프는 토글 2회로 자연 처리된다.
            inString = !inString;
            current += ch;
            continue;
        }
        if (inString) {
            current += ch;
            continue;
        }

        if (ch === '(' || ch === '[') {
            depth++;
            current += ch;
            continue;
        }
        if (ch === ')' || ch === ']') {
            if (depth > 0) { depth--; }
            current += ch;
            continue;
        }

        if (ch === ',' && depth === 0) {
            parts.push(current);
            current = '';
            continue;
        }

        current += ch;
    }
    parts.push(current);

    return parts.map(p => p.trim()).filter(p => p.length > 0);
}

/**
 * 프로시저 파라미터 목록의 "인자 개수 범위(arity)"를 계산한다.
 *
 * - `required`: 반드시 넘겨야 하는 인자 수 (Optional/ParamArray 제외).
 * - `max`: 넘길 수 있는 최대 인자 수. ParamArray가 있으면 무제한이므로 `undefined`.
 *
 * VB/GPL 규칙상 Optional 뒤 파라미터는 모두 Optional이고, ParamArray는 마지막에
 * 하나만 올 수 있으며 0개 이상을 받는다. 오버로드/Optional 인자 해석의 단일 정본.
 */
export function getParameterArity(params: string[] | undefined): { required: number; max: number | undefined } {
    const clean = (params ?? []).map(p => p.trim()).filter(p => p.length > 0);

    let required = 0;
    let hasParamArray = false;
    for (const p of clean) {
        if (/(^|\s)ParamArray\b/i.test(p)) {
            hasParamArray = true;
            continue;
        }
        if (/(^|\s)Optional\b/i.test(p)) {
            continue;
        }
        required++;
    }

    return { required, max: hasParamArray ? undefined : clean.length };
}

/**
 * 호출부 인자 개수가 특정 프로시저의 arity 범위에 들어맞는지 판별한다.
 * argCount가 unknown(undefined)이면 항상 true(제약 없음).
 */
export function argCountMatchesArity(
    argCount: number | undefined,
    arity: { required: number; max: number | undefined }
): boolean {
    if (typeof argCount !== 'number') {
        return true;
    }
    if (argCount < arity.required) {
        return false;
    }
    if (arity.max !== undefined && argCount > arity.max) {
        return false;
    }
    return true;
}

/**
 * 식별자 바로 뒤 텍스트(afterWord)가 호출/인덱싱 `(...)`이면 최상위 콤마 기준의
 * 인자 표현식 배열을 돌려준다. `Foo()`는 [], 여는 괄호가 아니면 undefined.
 * 닫는 괄호가 아직 없는 미완성 입력(`Foo(a, b`)도 줄 끝까지를 인자로 간주한다.
 * (기존 "인자 개수 세기"의 확장판 — 개수는 반환 배열의 length로 얻는다.)
 */
export function extractCallArgumentsFromSuffix(afterWord: string): string[] | undefined {
    const s = afterWord.trimStart();
    if (!s.startsWith('(')) {
        return undefined;
    }

    let depth = 0;
    let inString = false;
    let end = s.length;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === '"') {
            inString = !inString;
            continue;
        }
        if (inString) {
            continue;
        }
        if (ch === "'") {
            // 문자열 밖의 `'`는 주석 시작 — 미완성 호출(`Foo(a ' x, y`)에서
            // 주석 속 콤마/괄호를 인자로 세지 않도록 여기서 자른다.
            end = i;
            break;
        }
        if (ch === '(') {
            depth++;
            continue;
        }
        if (ch === ')') {
            depth--;
            if (depth === 0) {
                end = i;
                break;
            }
        }
    }

    return splitParameters(s.substring(1, end));
}

/**
 * 커서 앞 텍스트에서 멤버 접근 한정자 체인을 추출한다 (자동완성용, 순수 함수).
 * 예)
 *   "x = loc."   → { chain: ['loc'], partial: '' }
 *   "Move.App"   → { chain: ['Move'], partial: 'App' }
 *   "a.b(0).C"   → { chain: ['a', 'b(0)'], partial: 'C' }
 * 마지막 식별자 앞에 '.'이 없으면(멤버 접근이 아니면) undefined.
 * 숫자 리터럴("1.5")과 괄호식("(x).")은 체인으로 취급하지 않는다.
 * 문자열/주석 내부 여부 검사는 호출자가 수행한다.
 */
export function extractQualifierChainBefore(
    textBeforeCursor: string
): { chain: string[]; partial: string } | undefined {
    const text = textBeforeCursor;
    let i = text.length;

    // 1) 커서 직전의 입력 중 단어(partial)
    const partialEnd = i;
    while (i > 0 && /[A-Za-z0-9_]/.test(text[i - 1])) { i--; }
    const partial = text.slice(i, partialEnd);
    if (i === 0 || text[i - 1] !== '.') { return undefined; }

    // 2) '.' 앞의 세그먼트들을 뒤에서 앞으로 수집
    const chain: string[] = [];
    while (i > 0 && text[i - 1] === '.') {
        i--; // '.' 소비
        const segEnd = i;
        // 호출/인덱싱 접미사 "(...)" (중첩 괄호 허용)
        if (i > 0 && text[i - 1] === ')') {
            let depth = 0;
            let j = i - 1;
            for (; j >= 0; j--) {
                const ch = text[j];
                if (ch === ')') { depth++; }
                else if (ch === '(') {
                    depth--;
                    if (depth === 0) { break; }
                }
            }
            if (j < 0 || depth !== 0) { return undefined; }
            i = j; // '(' 위치로 이동
        }
        // 식별자 부분
        while (i > 0 && /[A-Za-z0-9_]/.test(text[i - 1])) { i--; }
        const seg = text.slice(i, segEnd);
        if (!/^[A-Za-z_]/.test(seg)) { return undefined; }
        chain.unshift(seg);
    }
    if (chain.length === 0) { return undefined; }
    return { chain, partial };
}
