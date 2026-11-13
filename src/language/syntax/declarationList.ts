/**
 * GPL 변수/상수 선언의 "선언자 목록" 파서 — vscode 비의존 순수 모듈.
 *
 * GPL(Dim 문)은 한 줄에 여러 변수를 선언할 수 있다(문서상 구문):
 *
 *   [Public | Private | Shared] Dim variable_name [, variable_name …] As [New] type [= [New] init]
 *       [, variable_name [, variable_name …] As [New] type [= [New] init], …]
 *
 * 즉 `Dim ii, jj As Integer, x As Double`은 ii·jj가 Integer, x가 Double이다.
 * 종전 파서는 이름을 하나만(`(\w+)\s+As`) 잡아 콤마 목록 줄을 **통째로 놓쳤고**,
 * 그 결과 해당 변수는 호버·정의 이동·이름 바꾸기에서 "정의 없음"으로 취급됐다.
 * (이름 바꾸기는 로컬 인식 실패 시 전역 경로로 흘러 무관한 동명 심볼을 건드린다.)
 *
 * 이 모듈은 접두(수식어·Dim·Static·Const) 뒤의 꼬리 문자열만 받아 선언자들을
 * 돌려준다. 접두 인식과 심볼 생성은 호출부(gplParser)가 맡는다.
 */

/** 선언 하나(이름 + 타입 정보). */
export interface Declarator {
    /** 선언된 이름 */
    name: string;
    /** 꼬리 문자열 기준 이름 시작 오프셋 (심볼 range 계산용) */
    offset: number;
    /** 배열 선언(`name(10)`, `name()`, `As Integer()`)인지 */
    isArray: boolean;
    /** `As` 뒤 타입 이름 — 점 표기(`Foo.Bar`)는 첫 세그먼트만 */
    type: string;
    /** `As New Foo` 형태인지 */
    isNew: boolean;
    /** `= ...` 초기값 원문(주석 제외, 문자열 원문 보존). 없으면 undefined */
    init?: string;
}

/** 괄호 그룹(한 단계 중첩 허용) — 배열 첨자·생성자 인자 공용. */
const PAREN_GROUP = '\\([^()]*(?:\\([^()]*\\)[^()]*)*\\)';

/**
 * 선언자 하나의 형태.
 *   name [ ( bounds ) ] [ As [New] type [ ( … ) ] [ = init ] ]
 * 타입은 점 표기를 허용하되(구문 거부 방지) 첫 세그먼트만 캡처한다.
 * 타입 뒤 괄호는 배열 표기(`As Integer()`)일 수도, 생성자 인자
 * (`As New Thread("Mod.Proc")`)일 수도 있어 New 여부로 구분한다.
 */
const DECLARATOR_RE = new RegExp(
    '^\\s*' +
    '([A-Za-z_]\\w*)' +                                     // 1: 이름
    `\\s*(${PAREN_GROUP})?` +                               // 2: 배열 첨자
    '\\s*(?:As\\s+(New\\s+)?' +                             // 3: New
    '([A-Za-z_]\\w*)(?:\\s*\\.\\s*[A-Za-z_]\\w*)*' +        // 4: 타입(첫 세그먼트)
    `\\s*(${PAREN_GROUP})?` +                               // 5: 타입 뒤 괄호
    '\\s*(=[\\s\\S]*)?' +                                   // 6: 초기값
    ')?\\s*$',
    'i'
);

/** 최상위(괄호 밖) 콤마로 자른 조각과 그 시작 오프셋. */
interface Part {
    text: string;
    offset: number;
}

/**
 * 문자열 리터럴 내부만 공백으로 치환한 사본을 만든다(길이·위치 보존).
 * GPL/VB의 `""`(이스케이프된 따옴표)도 문자열 내부로 취급한다.
 * 호출부가 구조 판정용 사본을 주지 않았을 때 쓰는 안전판 — 문자열 안 콤마
 * (`Dim s As String = "a,b"`)를 선언 구분자로 오인하지 않게 한다.
 */
function blankStringLiterals(text: string): string {
    let out = '';
    let inString = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (!inString) {
            if (ch === '"') {
                inString = true;
                out += ' ';
            } else {
                out += ch;
            }
            continue;
        }
        if (ch === '"') {
            if (text[i + 1] === '"') {
                out += '  ';
                i++;
                continue;
            }
            inString = false;
        }
        out += ' ';
    }
    return out;
}

/**
 * 괄호 깊이를 고려해 최상위 콤마로 자른다.
 * 입력은 문자열 리터럴 내부가 공백으로 치환된 사본이어야 한다(문자열 안 콤마 무시).
 */
function splitTopLevelCommas(codeTail: string): Part[] {
    const parts: Part[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < codeTail.length; i++) {
        const ch = codeTail[i];
        if (ch === '(' || ch === '[') {
            depth++;
        } else if (ch === ')' || ch === ']') {
            depth = Math.max(0, depth - 1);
        } else if (ch === ',' && depth === 0) {
            parts.push({ text: codeTail.slice(start, i), offset: start });
            start = i + 1;
        }
    }
    parts.push({ text: codeTail.slice(start), offset: start });
    return parts;
}

/**
 * 선언 접두 뒤의 꼬리를 선언자 목록으로 해석한다.
 *
 * @param tail 원문 꼬리(주석은 이미 잘려 있어야 한다) — 초기값 원문을 여기서 잘라 쓴다.
 * @param codeTail tail과 **길이가 같고** 문자열 내부만 공백으로 치환된 사본 —
 *                 콤마/괄호 구조 판정에 쓴다. 생략하면 tail에서 직접 만든다.
 * @returns 선언자 목록. 선언문이 아니거나(예: `Public Type Foo`) 타입 없는 이름이
 *          남으면(GPL은 `As type` 필수) undefined — 호출부가 다른 해석으로 넘어가게 한다.
 */
export function parseDeclaratorList(tail: string, codeTail?: string): Declarator[] | undefined {
    if (!tail.trim()) {
        return undefined;
    }
    const structure = codeTail ?? blankStringLiterals(tail);

    const out: Declarator[] = [];
    // 아직 타입을 만나지 못한 이름들 — 뒤따르는 `As type`이 이 그룹 전체의 타입이 된다.
    let pending: Array<{ name: string; offset: number; isArray: boolean }> = [];

    for (const part of splitTopLevelCommas(structure)) {
        const m = DECLARATOR_RE.exec(part.text);
        if (!m) {
            return undefined; // 선언자 형태가 아님 → 선언문으로 보지 않는다
        }
        const name = m[1];
        // 정규식이 `^\s*`로 앵커돼 있으므로 이름은 선두 공백 바로 뒤에서 시작한다.
        const offset = part.offset + Math.max(0, part.text.search(/\S/));
        const hasBounds = !!m[2];
        const type = m[4];

        if (!type) {
            pending.push({ name, offset, isArray: hasBounds });
            continue;
        }

        const isNew = !!m[3];
        // `As Integer()`는 배열 타입이지만, `As New Thread(...)`의 괄호는 생성자 인자다.
        // (구조 판정용 사본은 문자열 내부가 공백이라 `Thread("a")`도 `Thread( )`로 보인다.)
        const isArrayType = !!m[5] && !isNew;
        let init: string | undefined;
        if (m[6]) {
            // 초기값은 원문에서 잘라 쓴다(문자열 리터럴 보존). 선언자 안의 첫 `=`가 경계이고,
            // 끝은 이 선언자 조각의 끝이다(뒤에 다른 선언자가 이어질 수 있다).
            const eq = part.text.indexOf('=');
            if (eq >= 0) {
                init = tail.slice(part.offset + eq + 1, part.offset + part.text.length).trim() || undefined;
            }
        }

        for (const p of pending) {
            out.push({ name: p.name, offset: p.offset, isArray: p.isArray || isArrayType, type, isNew });
        }
        pending = [];
        out.push({ name, offset, isArray: hasBounds || isArrayType, type, isNew, init });
    }

    if (pending.length > 0) {
        return undefined; // `As type`으로 닫히지 않은 이름이 남음 → 선언문이 아니다
    }
    return out.length > 0 ? out : undefined;
}
