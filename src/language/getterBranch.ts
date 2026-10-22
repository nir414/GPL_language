/**
 * 분기형 Property getter — 파싱과 계산의 단일 정본(순수, vscode 무의존).
 *
 * 왜: 제어기 콘솔의 `Show Variable -eval` 은 사용자 Property 를 평가하지 못한다(-780). 확장은 getter 가
 * `Return <필드>` 한 줄이면 그 필드로 치환해 값을 보여 주는데(GitHub #26, `GPLSymbol.getterReturnExpr`),
 * 이 형태의 getter 는 치환할 수 없어 디버그 값이 비어 있었다(사용자 질문 2026-09-17, ai-handoff §1-DS):
 *
 *     Public ReadOnly Property isUseCrashDetectSensor As Boolean
 *         Get
 *             If m_crashDetectSensorIO <> 0 Then
 *                 Return True
 *             Else
 *                 Return False
 *             End If
 *         End Get
 *     End Property
 *
 * 조건에 쓰인 필드 값은 부모 객체 덤프에 실려 오므로(Private 포함, 프레임 무관), 확장이 비교식을 계산해
 * 결과를 보이고 출처(`m_crashDetectSensorIO <> 0 (m_crashDetectSensorIO = 5 → True)`)를 함께 표시한다.
 *
 * 지원 범위(의도적으로 좁다 — 틀린 값을 보이는 것보다 비우는 쪽이 낫다):
 * - Get 본문이 `If <조건> Then / Return A / Else / Return B / End If`, `If … Then / Return A / End If / Return B`,
 *   한 줄 `If <조건> Then Return A Else Return B`, `If <조건> Then Return A` + `Return B` 중 하나.
 * - 조건은 `[Not] <피연산자> [<비교연산자> <피연산자>]`. 피연산자는 필드 이름(점 경로 포함) 또는 리터럴
 *   (숫자·True/False·"문자열"). 호출·인덱스·산술·And/Or·`Is Nothing` 은 미지원(undefined).
 * - A/B 도 같은 피연산자 규칙. 비교는 GPL 규칙대로 숫자는 수치, 문자열은 문자열, Boolean 은 -1/0.
 *
 * 단위 테스트: src/test/getterBranch.test.ts
 */

/** 파서가 Property 심볼에 기록하는 분기형 getter 골격. */
export interface GetterBranch {
    /** `If … Then` 의 조건 원문(공백 정리) */
    condition: string;
    /** 조건이 참일 때 `Return` 식 원문 */
    thenExpr: string;
    /** 조건이 거짓일 때 `Return` 식 원문 */
    elseExpr: string;
}

export type GetterBranchOperand =
    | { kind: 'ident'; name: string }
    | { kind: 'literal'; text: string };

export type GetterBranchCompareOp = '=' | '<>' | '<' | '>' | '<=' | '>=';

/** 조건·분기를 피연산자 단위로 해석한 결과. `op`/`right` 가 없으면 `[Not] <피연산자>` 진릿값 판정. */
export interface GetterBranchShape {
    negated: boolean;
    left: GetterBranchOperand;
    op?: GetterBranchCompareOp;
    right?: GetterBranchOperand;
    thenExpr: GetterBranchOperand;
    elseExpr: GetterBranchOperand;
}

const RETURN_RE = /^Return\s+(.+)$/i;
const IF_HEAD_RE = /^If\s+(.+?)\s+Then$/i;
const IF_ONE_LINE_RE = /^If\s+(.+?)\s+Then\s+Return\s+(.+?)(?:\s+Else\s+Return\s+(.+))?$/i;
const ELSE_RE = /^Else$/i;
const END_IF_RE = /^End\s+If$/i;

/**
 * Get 블록의 문장들(주석 제거·trim, 빈 줄 제외, `Get`/`End Get` 제외)에서 분기형 골격을 읽는다.
 * 지원 형태가 아니면 undefined — 호출자는 그때 종전 규칙(단순 `Return` 또는 해석 불가)을 쓴다.
 */
export function parseGetterBranch(statements: readonly string[]): GetterBranch | undefined {
    const s = statements.map(x => x.trim()).filter(Boolean);
    if (s.length === 0) { return undefined; }
    const ret = (t: string | undefined): string | undefined => t?.match(RETURN_RE)?.[1].trim() || undefined;

    // 한 줄 If: `If c Then Return A Else Return B` / `If c Then Return A` + `Return B`
    const one = s[0].match(IF_ONE_LINE_RE);
    if (one) {
        const condition = one[1].trim();
        const thenExpr = one[2].trim();
        if (one[3] !== undefined) {
            return s.length === 1 ? { condition, thenExpr, elseExpr: one[3].trim() } : undefined;
        }
        const elseExpr = s.length === 2 ? ret(s[1]) : undefined;
        return elseExpr ? { condition, thenExpr, elseExpr } : undefined;
    }

    const head = s[0].match(IF_HEAD_RE);
    if (!head) { return undefined; }
    const condition = head[1].trim();

    // 블록 If/Else: If / Return A / Else / Return B / End If
    if (s.length === 5 && ELSE_RE.test(s[2]) && END_IF_RE.test(s[4])) {
        const thenExpr = ret(s[1]);
        const elseExpr = ret(s[3]);
        return thenExpr && elseExpr ? { condition, thenExpr, elseExpr } : undefined;
    }
    // 블록 If + 후행 Return: If / Return A / End If / Return B
    if (s.length === 4 && END_IF_RE.test(s[2])) {
        const thenExpr = ret(s[1]);
        const elseExpr = ret(s[3]);
        return thenExpr && elseExpr ? { condition, thenExpr, elseExpr } : undefined;
    }
    return undefined;
}

const IDENT_PATH_RE = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/;
const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const BOOL_RE = /^(?:True|False)$/i;
const STRING_RE = /^"(?:[^"]|"")*"$/;
/** 피연산자 자리에 올 수 없는 예약어(식별자 모양이지만 필드가 아니다). */
const NOT_AN_OPERAND_RE = /^(?:Me|Nothing|Not|And|Or|Xor|Is|IsNot|Mod|Like)$/i;

function parseOperand(text: string): GetterBranchOperand | undefined {
    const t = text.trim();
    if (!t) { return undefined; }
    if (NUMBER_RE.test(t) || BOOL_RE.test(t) || STRING_RE.test(t)) { return { kind: 'literal', text: t }; }
    if (IDENT_PATH_RE.test(t) && !NOT_AN_OPERAND_RE.test(t)) { return { kind: 'ident', name: t }; }
    return undefined;
}

/** 가장 바깥 괄호가 전체를 감싸면 한 겹 벗긴다(`(a <> 0)` → `a <> 0`). `(a) = (b)` 는 그대로. */
function stripOuterParens(text: string): string {
    let t = text.trim();
    while (t.startsWith('(') && t.endsWith(')')) {
        let depth = 0;
        let wraps = true;
        for (let i = 0; i < t.length; i++) {
            if (t[i] === '(') { depth++; }
            else if (t[i] === ')') { depth--; if (depth === 0 && i < t.length - 1) { wraps = false; break; } }
        }
        if (!wraps) { break; }
        t = t.slice(1, -1).trim();
    }
    return t;
}

const COMPARE_RE = /^(.*?)\s*(<>|<=|>=|=|<|>)\s*(.*)$/;

/** 골격을 피연산자 단위로 해석한다. 지원 범위 밖(호출·산술·And/Or 등)이면 undefined. */
export function analyzeGetterBranch(branch: GetterBranch): GetterBranchShape | undefined {
    let cond = stripOuterParens(branch.condition);
    let negated = false;
    if (/^Not\s+/i.test(cond)) {
        negated = true;
        cond = stripOuterParens(cond.replace(/^Not\s+/i, ''));
    }
    const thenExpr = parseOperand(branch.thenExpr);
    const elseExpr = parseOperand(branch.elseExpr);
    if (!thenExpr || !elseExpr) { return undefined; }

    const m = cond.match(COMPARE_RE);
    if (m && m[1].trim() && m[3].trim()) {
        const left = parseOperand(m[1]);
        const right = parseOperand(m[3]);
        if (!left || !right) { return undefined; }
        return { negated, left, op: m[2] as GetterBranchCompareOp, right, thenExpr, elseExpr };
    }
    const left = parseOperand(cond);
    return left ? { negated, left, thenExpr, elseExpr } : undefined;
}

/**
 * 계산에 값이 필요한 식별자(필드) 이름 — 조건과 분기의 `ident` 피연산자, 중복 제거·등장 순.
 * 지원 범위 밖 골격이면 undefined(해석 불가로 다뤄야 한다). 리터럴만으로 된 골격은 빈 배열.
 */
export function getterBranchIdentifiers(branch: GetterBranch): string[] | undefined {
    const shape = analyzeGetterBranch(branch);
    if (!shape) { return undefined; }
    const out: string[] = [];
    for (const o of [shape.left, shape.right, shape.thenExpr, shape.elseExpr]) {
        if (o?.kind === 'ident' && !out.some(n => n.toLowerCase() === o.name.toLowerCase())) { out.push(o.name); }
    }
    return out;
}

/** 제어기 표기(`-1`/`0`/`5`/`1E+32`)·소스 리터럴(`True`/`False`/`3`)을 수치로. 아니면 undefined. */
function toNumber(raw: string): number | undefined {
    const t = raw.trim();
    if (/^True$/i.test(t)) { return -1; }
    if (/^False$/i.test(t)) { return 0; }
    if (!t || !NUMBER_RE.test(t)) { return undefined; }
    const n = Number(t);
    return Number.isFinite(n) ? n : undefined;
}

/** 따옴표 문자열(제어기 덤프 `"get"`·소스 리터럴 `"abc"`, `""` 이스케이프) → 내용. 아니면 undefined. */
function toText(raw: string): string | undefined {
    const t = raw.trim();
    return STRING_RE.test(t) ? t.slice(1, -1).replace(/""/g, '"') : undefined;
}

function compare(left: string, op: GetterBranchCompareOp, right: string): boolean | undefined {
    const nl = toNumber(left);
    const nr = toNumber(right);
    if (nl !== undefined && nr !== undefined) {
        switch (op) {
            case '=': return nl === nr;
            case '<>': return nl !== nr;
            case '<': return nl < nr;
            case '>': return nl > nr;
            case '<=': return nl <= nr;
            case '>=': return nl >= nr;
        }
    }
    const sl = toText(left);
    const sr = toText(right);
    if (sl !== undefined && sr !== undefined) {
        switch (op) {
            case '=': return sl === sr;
            case '<>': return sl !== sr;
            case '<': return sl < sr;
            case '>': return sl > sr;
            case '<=': return sl <= sr;
            case '>=': return sl >= sr;
        }
    }
    return undefined; // 타입이 어긋남(숫자 vs 문자열) — GPL 도 컴파일 오류인 조합
}

function truthy(raw: string): boolean | undefined {
    const n = toNumber(raw);
    return n === undefined ? undefined : n !== 0;
}

/** 소스 리터럴을 제어기 표기로(`True` → `-1`, `False` → `0`) — 덤프의 Boolean 필드 표기와 맞춘다. */
function normalizeResultValue(raw: string): string {
    const t = raw.trim();
    if (/^True$/i.test(t)) { return '-1'; }
    if (/^False$/i.test(t)) { return '0'; }
    return t;
}

function inferType(operand: GetterBranchOperand, raw: string): string {
    if (operand.kind === 'literal') {
        if (BOOL_RE.test(operand.text)) { return 'Boolean'; }
        if (STRING_RE.test(operand.text)) { return 'String'; }
        if (NUMBER_RE.test(operand.text)) { return /[.eE]/.test(operand.text) ? 'Double' : 'Integer'; }
    }
    if (STRING_RE.test(raw.trim())) { return 'String'; }
    return '';
}

/** `evaluateGetterBranch` 결과 — 값은 제어기 표기, `via` 는 hover/Watch 에 `← …` 로 붙이는 출처 설명. */
export interface GetterBranchResult {
    value: string;
    /** 선언 반환 타입(있으면) 또는 리터럴에서 추정한 타입, 모르면 빈 문자열 */
    type: string;
    via: string;
}

/**
 * 분기형 getter 를 필드 값으로 계산한다.
 * @param lookup 필드 이름 → 제어기가 보고한 원문 값(부모 덤프 멤버 줄의 값 칸). 모르면 undefined.
 * @param declaredType Property 선언의 반환 타입(`Boolean`) — 표시 타입으로 우선 쓴다.
 * @returns 계산 불가(지원 범위 밖·값 없음·타입 불일치)면 undefined — 호출자는 종전 표시(-780 안내)를 유지한다.
 */
export function evaluateGetterBranch(
    branch: GetterBranch,
    lookup: (identifier: string) => string | undefined,
    declaredType?: string,
): GetterBranchResult | undefined {
    const shape = analyzeGetterBranch(branch);
    if (!shape) { return undefined; }
    const resolve = (o: GetterBranchOperand): string | undefined => (o.kind === 'literal' ? o.text : lookup(o.name));

    const used: string[] = [];
    const note = (o: GetterBranchOperand, v: string) => {
        if (o.kind !== 'ident') { return; }
        const entry = `${o.name} = ${v}`;
        if (!used.some(u => u.toLowerCase() === entry.toLowerCase())) { used.push(entry); }
    };

    const left = resolve(shape.left);
    if (left === undefined) { return undefined; }
    note(shape.left, left);

    let truth: boolean | undefined;
    if (shape.op && shape.right) {
        const right = resolve(shape.right);
        if (right === undefined) { return undefined; }
        note(shape.right, right);
        truth = compare(left, shape.op, right);
    } else {
        truth = truthy(left);
    }
    if (truth === undefined) { return undefined; }
    if (shape.negated) { truth = !truth; }

    const chosen = truth ? shape.thenExpr : shape.elseExpr;
    const raw = resolve(chosen);
    if (raw === undefined) { return undefined; }
    note(chosen, raw);

    const value = normalizeResultValue(raw);
    const type = (declaredType ?? '').trim() || inferType(chosen, raw);
    const via = `${branch.condition.trim()} (${used.length ? `${used.join(', ')} → ` : '→ '}${truth ? 'True' : 'False'})`;
    return { value, type, via };
}
