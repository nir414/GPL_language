/**
 * `Show Variable` / `Show Variable -eval` 응답 파싱 (순수 함수).
 *
 * GPLDebugSession에서 분리한 이유: 실기기 응답 형식이 공식 문서 예시와 다른 부분이
 * 발견되어(객체 헤더 `cmd, Object Command` — 문서 예시는 `Loc, Object` 단독),
 * 실기기 캡처를 픽스처로 한 단위 테스트가 가능해야 회귀를 막을 수 있다.
 *
 * 실기기(GPL 4.x, 2026-07-22 캡처) 기준 응답 형식:
 *  - 단순 값:  `name, type, value`                          (예: `i, Integer, 5`)
 *  - 배열 헤더: `name, Type(…)` — 전체 값 없음, 요소 단위 조회만 가능
 *  - 배열 요소: `arr(0,0), Double(,), 30.5`
 *  - 객체:     `name, Object ClassName` + 멤버별 `name.field, type, value` 줄 (여러 줄)
 *              ※ 배열 필드는 멤버 목록에 포함되지 않는다(실기기 확인).
 *  - 시스템 Location 덤프(2026-08-25 캡처, GitHub #27): 헤더 `x, Object Location` 뒤의 멤버 줄이
 *              **`name, value` 2열**(+주석 값 `Type, 0 = Cartesian` / `Config, 1  = Righty`)로 온다.
 *              타입 칸이 없으므로 2열 줄은 두 번째 칸이 타입 토큰인지로 헤더/값을 가른다(isTypeToken).
 */

/** `Show Variable` 응답 한 줄의 파싱 결과 (`name, type, value`) */
export interface ParsedVarEntry {
    name: string;
    type: string;
    value: string;
}

/**
 * 쉼표 분할 시 괄호 안의 쉼표는 무시한다.
 * 이유: 배열 타입은 `Double(,)`, 요소 이름은 `arr(0,1)`처럼 괄호 안에 쉼표를 포함해
 * 단순 split(',')로는 필드가 깨진다(기존 버그 — 배열 값이 `)` 로 표시되던 원인).
 * maxParts 도달 시 나머지는 마지막 필드로 합쳐 문자열 값 속 쉼표를 보존한다.
 */
export function splitVarLine(line: string, maxParts: number): string[] {
    const parts: string[] = [];
    let depth = 0;
    let current = '';
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '(') { depth++; }
        else if (ch === ')') { depth = Math.max(0, depth - 1); }
        if (ch === ',' && depth === 0 && parts.length < maxParts - 1) {
            parts.push(current.trim());
            current = '';
        } else {
            current += ch;
        }
    }
    if (current.trim().length > 0 || parts.length > 0) {
        parts.push(current.trim());
    }
    return parts;
}

/**
 * `name, X` 2열 줄의 두 번째 칸이 **타입 토큰**인지 판별한다.
 * 타입: 스칼라(`Integer`, `String` …), 배열(`Double(,)`, `String()`), 객체(`Object Command`, `Object() null`),
 * 그 외 `이름(…)` 꼴의 사용자 배열 타입. 숫자/따옴표/주석 값(`636`, `0 = Cartesian`, `Null`)은 타입이 아니다.
 * 배경(GitHub #27): 2열이면 무조건 헤더로 보던 규칙이 Location 멤버 `X, 636`을 type='636'/value=''로 만들어
 * Variables 패널에서 값이 비어 보였다.
 */
export function isTypeToken(s: string): boolean {
    const t = s.trim();
    if (!t || /^[-+.\d"']/.test(t)) { return false; }
    if (/^(Integer|Double|Single|Boolean|Byte|Short|Long|String|Decimal|Date|Char)\s*(\([^)]*\))?$/i.test(t)) { return true; }
    if (/^Object\b/i.test(t)) { return true; }
    // 사용자 타입 배열 헤더(`RobotArm()`)처럼 식별자 바로 뒤에 괄호가 오는 꼴
    return /^[A-Za-z_]\w*\s*\([^)]*\)\s*\S*$/.test(t);
}

/** `Show Variable` 응답의 모든 유효 줄을 파싱한다. */
export function parseShowVariableMulti(raw: string): ParsedVarEntry[] {
    const withoutStatus = raw.replace(/<STATUS>[\s\S]*?<\/STATUS>/gi, '');
    // 알려진 프레임 태그(DATA/STATUS)만 제거 — `<[^>]+>` 전체 제거는 문자열 값에
    // 포함된 리터럴 `<...>`까지 삼켜 값이 잘리는 문제가 있었다.
    const cleaned = withoutStatus.replace(/<\/?(?:DATA|STATUS)[^>]*>/gi, '').trim();
    const lines = cleaned.split(/\r?\n/).filter(l => l.trim().length > 0);

    const entries: ParsedVarEntry[] = [];
    for (const rawLine of lines) {
        const line = rawLine.trim();
        const parts = splitVarLine(line, 3);
        if (parts.length >= 3) {
            entries.push({ name: parts[0], type: parts[1], value: parts[2] });
        } else if (parts.length === 2) {
            if (isTypeToken(parts[1])) {
                // 배열 헤더(`name, Double(,)`)·객체 헤더(`name, Object Command`)·빈 문자열(`x.Text, String`)처럼
                // 값 필드가 없는 줄
                entries.push({ name: parts[0], type: parts[1], value: '' });
            } else {
                // 2열 값 줄(시스템 Location 덤프 멤버: `Robot.Where(1).X, 636`, `….Type, 0 = Cartesian`,
                // `….RefFrame, Null`) — 타입 칸이 없고 값만 있다. `Null`은 다른 null 참조 표시와 맞춰 소문자로.
                entries.push({ name: parts[0], type: '', value: /^null$/i.test(parts[1]) ? 'null' : parts[1] });
            }
        } else {
            // 쉼표 없는 단순 값 (예: Show Global 응답)
            entries.push({ name: '', type: '', value: line });
        }
    }
    return entries;
}

/**
 * @param hasMembers 응답에 멤버 줄이 동봉됐는지 — **객체 배열** 판별에 필요하다.
 *   실기기(2026-07-22): 객체 배열 헤더는 `armList, Object() null`(멤버 없음, 요소는
 *   인덱스로 조회), 요소는 `armList(0), Object() RobotArm` + 멤버 줄 동봉.
 *   타입 문자열만으로는 둘 다 `Object(…)` 꼴이라 구분 불가.
 */
export function classifyVarEntry(e: ParsedVarEntry, hasMembers?: boolean): 'object' | 'array' | 'simple' {
    // 배열 헤더를 먼저 판정: 값 없이 타입 끝에 괄호가 붙으면 배열 (`Double()`, `Integer(,)`).
    // 요소 응답(`arr(0,0), Double(,), 30.5`)은 값이 있으므로 simple로 분류된다.
    if (!e.value && /\([^)]*\)\s*$/.test(e.type)) { return 'array'; }
    const t = e.type.trim();
    // `Object(…) <런타임클래스|null>` 꼴 (실기기 형식): 배열 헤더·요소·null 참조가 모두 이 꼴이다.
    const objParen = t.match(/^object\s*\([^)]*\)\s*(\S*)$/i);
    if (objParen) {
        if (hasMembers) { return 'object'; } // 요소 객체 (필드 덤프 동봉)
        // 요소/멤버 응답(이름에 인덱스나 점이 붙음)인데 멤버가 없으면:
        //  - 런타임 클래스 null → **null 참조** — 배열로 오분류하면 null 인덱싱이 또 null을
        //    성공으로 돌려줘 무한 가짜 배열 트리가 생긴다(실기기 확인: `armList(1), Object() null`).
        //  - 클래스명 존재 → 객체 (재조회하면 필드 덤프가 온다)
        if (/\)\s*$/.test(e.name) || e.name.includes('.')) {
            return /^null$/i.test(objParen[1] ?? '') ? 'simple' : 'object';
        }
        return 'array'; // 배열 헤더 (`armList, Object() null`)
    }
    // 실기기는 객체 헤더 타입을 `Object Command`처럼 클래스명 포함으로 보고한다
    // (공식 문서 예시는 `Object` 단독). 접두 단어 일치로 둘 다 수용한다.
    if (/^object\b/i.test(t)) { return 'object'; }
    return 'simple';
}

/** Location 덤프 멤버에서 leaf 이름(대소문자 무시)으로 값을 찾는다. */
function locationMemberValue(members: ParsedVarEntry[], leaf: string): string | undefined {
    const want = `.${leaf.toLowerCase()}`;
    return members.find(m => m.name.toLowerCase().endsWith(want))?.value;
}

/** 요약용 숫자 표기: 소수 3자리까지(뒤 0 제거). 숫자가 아니면 원문, 없으면 `?`. */
function fmtSummaryNumber(v: string | undefined): string {
    if (v === undefined) { return '?'; }
    const n = Number(v);
    return Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : v;
}

/** `Object Location` 헤더 타입인지. */
export function isLocationType(type: string): boolean {
    return /^object\s*(?:\([^)]*\)\s*)?location\s*$/i.test(type.trim());
}

/**
 * `Object Location` 덤프의 한 줄 요약(GitHub #27 제안 3).
 *  - Cartesian(`Type` 0): `(X, Y, Z | Yaw, Pitch, Roll) cfg=N`
 *  - Angles(`Type` 1):    `Angles(a1, a2, …)` — 덤프에는 축 수만큼 `Angle(i)` 줄이 온다
 * Type 줄이 없거나 미지 값이면 undefined(호출측은 타입명만 표시).
 * 실측(2026-08-25) 덤프에는 Text/Pos/PosWrtRef 줄이 없고 ZClearance 기본값은 1E+32(미설정)이다.
 */
export function summarizeLocation(members: ParsedVarEntry[]): string | undefined {
    if (members.length === 0) { return undefined; }
    const typeNum = (locationMemberValue(members, 'Type') ?? '').match(/^\s*(-?\d+)/)?.[1];
    if (typeNum === '0') {
        const pos = ['X', 'Y', 'Z'].map(k => fmtSummaryNumber(locationMemberValue(members, k))).join(', ');
        const ori = ['Yaw', 'Pitch', 'Roll'].map(k => fmtSummaryNumber(locationMemberValue(members, k))).join(', ');
        const cfg = locationMemberValue(members, 'Config')?.match(/^\s*(-?\d+)/)?.[1];
        return `(${pos} | ${ori})${cfg !== undefined ? ` cfg=${cfg}` : ''}`;
    }
    if (typeNum === '1') {
        const angles = members
            .map(m => ({ m, idx: m.name.match(/\.Angle\((\d+)\)\s*$/i)?.[1] }))
            .filter(x => x.idx !== undefined)
            .sort((a, b) => Number(a.idx) - Number(b.idx))
            .map(x => fmtSummaryNumber(x.m.value));
        return `Angles(${angles.join(', ')})`;
    }
    return undefined;
}

/**
 * Location 멤버 값의 표시용 주석. `ZClearance`의 1E+32는 "미설정" 기본값(Brooks 문서상 — 실기기 덤프에서도
 * 항상 1E+32로 관측)이라 그대로 두면 오해를 부른다. 그 외 값은 원문 그대로.
 */
export function annotateLocationMember(fullName: string, value: string): string {
    if (/\.ZClearance\s*$/i.test(fullName) && /^1E\+32$/i.test(value.trim())) { return `${value} (미설정)`; }
    return value;
}

/** 배열 타입 문자열에서 차원 수 추출: `Double()`→1, `Double(,)`→2, `Object(,) null`→2 … */
export function arrayRank(type: string): number {
    // 첫 괄호 그룹 기준 — 객체 배열(`Object() null`)처럼 괄호 뒤에 런타임 클래스가 붙는 형식 대응.
    const m = type.match(/\(([^)]*)\)/);
    if (!m) { return 1; }
    return (m[1].match(/,/g)?.length ?? 0) + 1;
}
