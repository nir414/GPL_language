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
            // 배열 헤더(`name, Double(,)`)나 객체 헤더(`name, Object Command`)처럼
            // 값 필드가 없는 줄
            entries.push({ name: parts[0], type: parts[1], value: '' });
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

/** 배열 타입 문자열에서 차원 수 추출: `Double()`→1, `Double(,)`→2, `Object(,) null`→2 … */
export function arrayRank(type: string): number {
    // 첫 괄호 그룹 기준 — 객체 배열(`Object() null`)처럼 괄호 뒤에 런타임 클래스가 붙는 형식 대응.
    const m = type.match(/\(([^)]*)\)/);
    if (!m) { return 1; }
    return (m[1].match(/,/g)?.length ?? 0) + 1;
}
