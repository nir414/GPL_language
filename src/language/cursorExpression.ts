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
 * character 위치를 감싸는 문자열 리터럴("...")의 내용(따옴표 제외)을 돌려준다.
 * 주석(`'` 이후)이거나 문자열 밖이면 undefined.
 *
 * GPL은 Thread 생성자 등에서 실행할 프로시저를 문자열로 참조하므로
 * (예: New Thread("DataFile.SaveReservationThreadFunction")),
 * 정의 찾기가 문자열 속 프로시저 참조를 해석할 때 사용한다.
 * VB식 이스케이프("")는 토글로 close+open 처리되어 리터럴이 쪼개지지만,
 * 그런 문자열은 식별자 형태가 아니므로 호출부 검증에서 자연히 걸러진다.
 */
export function getStringLiteralContentAt(
    lineText: string,
    character: number
): { text: string; start: number; end: number } | undefined {
    let strStart = -1; // 현재 열린 문자열의 여는 따옴표 위치 (-1이면 문자열 밖)
    for (let i = 0; i < lineText.length; i++) {
        const ch = lineText[i];
        if (ch === '"') {
            if (strStart === -1) {
                strStart = i;
            } else {
                if (character > strStart && character < i) {
                    return { text: lineText.substring(strStart + 1, i), start: strStart + 1, end: i };
                }
                strStart = -1;
            }
        } else if (ch === "'" && strStart === -1) {
            return undefined; // 이후 전부 주석
        }
    }
    if (strStart !== -1 && character > strStart) {
        // 닫는 따옴표가 없는(줄 끝까지 열린) 문자열
        return { text: lineText.substring(strStart + 1), start: strStart + 1, end: lineText.length };
    }
    return undefined;
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

// ─── 디버그 hover/watch용 식 추출 ────────────────────────────

/** extractDebugExpressionAt 결과의 한 세그먼트: `armList(i)` → { name: 'armList', args: 'i' } */
export interface DebugExpressionSegment {
    name: string;
    /** 괄호 그룹 내용(괄호 제외). 없으면 인덱싱/호출 접미사 없는 세그먼트. */
    args?: string;
}

/** 커서 위치의 디버그 평가 후보 식 (안전성 판단은 호출자 몫 — 세그먼트 구조를 그대로 노출). */
export interface DebugExpressionCandidate {
    /** 앞 체인 + 커서 세그먼트. 예) `armList(i).isCanFlip`의 isCanFlip 커서 → 2개 세그먼트 */
    segments: DebugExpressionSegment[];
    /** 커서가 위치한 세그먼트 인덱스(항상 마지막) */
    cursorSegment: number;
    startColumn: number;
    /** 끝(exclusive) — 커서 세그먼트의 괄호 그룹 포함 */
    endColumn: number;
}

/** 세그먼트 배열을 GPL 식 문자열로 조립한다. */
export function buildDebugExpression(segments: DebugExpressionSegment[]): string {
    return segments
        .map(s => (s.args !== undefined ? `${s.name}(${s.args})` : s.name))
        .join('.');
}

/**
 * 라인 텍스트의 커서 위치에서 디버그 평가 대상 식을 추출한다 (순수 함수).
 * 예) `armList(i).isCanFlip = True`
 *   - `armList` 커서 → segments [{armList, args:'i'}]           (뒤따르는 인덱스 포함)
 *   - `isCanFlip` 커서 → [{armList, args:'i'}, {isCanFlip}]     (앞 체인 포함)
 * 문자열/주석 안, 식별자가 아닌 위치는 undefined.
 * ※ 괄호 그룹이 배열 인덱싱인지 호출인지는 여기서 판단하지 않는다 — 호출자(provider)가
 *   심볼 정보로 검증해야 한다(-eval은 Sub/Function도 실행하므로 안전성에 중요).
 */
export function extractDebugExpressionAt(
    lineText: string,
    character: number,
): DebugExpressionCandidate | undefined {
    // 1) 커서가 문자열/주석 내부면 제외
    let inString = false;
    for (let i = 0; i < Math.min(character, lineText.length); i++) {
        const ch = lineText[i];
        if (ch === '"') { inString = !inString; }
        else if (ch === "'" && !inString) { return undefined; } // 주석 시작 이후
    }
    if (inString) { return undefined; }

    // 2) 커서 위치의 식별자 단어
    let ws = character;
    while (ws > 0 && /[A-Za-z0-9_]/.test(lineText[ws - 1])) { ws--; }
    let we = character;
    while (we < lineText.length && /[A-Za-z0-9_]/.test(lineText[we])) { we++; }
    const word = lineText.slice(ws, we);
    if (!/^[A-Za-z_]\w*$/.test(word)) { return undefined; }

    const parseSegment = (raw: string): DebugExpressionSegment | undefined => {
        const m = raw.match(/^([A-Za-z_]\w*)(?:\((.*)\))?$/);
        if (!m) { return undefined; }
        return m[2] !== undefined ? { name: m[1], args: m[2] } : { name: m[1] };
    };

    // 3) 앞 체인 (`a(0).b.` 형태) — 재구성 텍스트가 원문과 정확히 일치할 때만 채택
    //    (공백 섞인 `a . b` 등 예외 케이스는 안전하게 커서 단어만 사용)
    const segments: DebugExpressionSegment[] = [];
    let startColumn = ws;
    const before = extractQualifierChainBefore(lineText.slice(0, ws));
    if (before && before.partial === '') {
        const chainText = before.chain.join('.') + '.';
        if (lineText.slice(ws - chainText.length, ws) === chainText) {
            const parsed = before.chain.map(parseSegment);
            if (parsed.every(s => s !== undefined)) {
                segments.push(...(parsed as DebugExpressionSegment[]));
                startColumn = ws - chainText.length;
            }
        }
    }

    // 4) 커서 단어 + 바로 뒤 괄호 그룹(공백 없이 붙은 것만 — 인덱싱 관용구)
    let endColumn = we;
    const cursorSeg: DebugExpressionSegment = { name: word };
    if (lineText[we] === '(') {
        let depth = 0;
        let close = -1;
        let quoted = false;
        for (let i = we; i < lineText.length; i++) {
            const ch = lineText[i];
            if (ch === '"') { quoted = !quoted; continue; }
            if (quoted) { continue; }
            if (ch === "'") { break; } // 주석 — 미완성 그룹
            if (ch === '(') { depth++; }
            else if (ch === ')') {
                depth--;
                if (depth === 0) { close = i; break; }
            }
        }
        if (close > we) {
            cursorSeg.args = lineText.slice(we + 1, close);
            endColumn = close + 1;
        }
    }
    segments.push(cursorSeg);

    return {
        segments,
        cursorSegment: segments.length - 1,
        startColumn,
        endColumn,
    };
}

// ─── 인덱스 식별자 치환 (디버그 어댑터용) ────────────────────

/**
 * 식의 최상위 괄호 그룹 안에서 식별자(점 경로 포함) 토큰을 추출한다 (순수 함수).
 * 예) `armList(i)` → ['i'], `m(i, j+1)` → ['i', 'j'], `a(i).b(k)` → ['i', 'k']
 * 숫자 리터럴만 있으면 빈 배열. 중첩 괄호나 문자열 리터럴이 있으면 치환 불가로 undefined.
 * 용도: 제어기 콘솔이 변수 인덱스를 평가하지 못할 때 식별자를 값으로 치환해 재시도.
 */
export function extractIndexIdentifierTokens(expression: string): string[] | undefined {
    const tokens: string[] = [];
    let depth = 0;
    let i = 0;
    while (i < expression.length) {
        const ch = expression[i];
        if (ch === '"') { return undefined; }
        if (ch === '(') {
            depth++;
            if (depth > 1) { return undefined; } // 중첩 인덱스 식은 미지원
            i++;
            continue;
        }
        if (ch === ')') { depth = Math.max(0, depth - 1); i++; continue; }
        if (depth >= 1 && /[A-Za-z_]/.test(ch)) {
            const m = expression.slice(i).match(/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*/);
            if (m) {
                if (!tokens.includes(m[0])) { tokens.push(m[0]); }
                i += m[0].length;
                continue;
            }
        }
        i++;
    }
    return tokens;
}

/** 최상위 괄호 그룹 안의 식별자 토큰을 값으로 치환한 식을 돌려준다 (순수 함수). */
export function replaceIndexIdentifierTokens(
    expression: string,
    values: ReadonlyMap<string, string>,
): string {
    let out = '';
    let depth = 0;
    let i = 0;
    while (i < expression.length) {
        const ch = expression[i];
        if (ch === '(') { depth++; out += ch; i++; continue; }
        if (ch === ')') { depth = Math.max(0, depth - 1); out += ch; i++; continue; }
        if (depth >= 1 && /[A-Za-z_]/.test(ch)) {
            const m = expression.slice(i).match(/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*/);
            if (m) {
                out += values.get(m[0]) ?? m[0];
                i += m[0].length;
                continue;
            }
        }
        out += ch;
        i++;
    }
    return out;
}
