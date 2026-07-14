/**
 * 오버로드 해석(호출부 인자 ↔ 선언 파라미터 대조) 순수 헬퍼.
 *
 * 같은 이름의 Sub/Function 후보가 여럿일 때(오버로딩), 호출부의 인자 개수와
 * "추론 가능한 인자 타입"을 근거로 후보를 랭킹한다. vscode API에 의존하지
 * 않으므로 Node 단독 단위 테스트가 가능하다. symbolCache(워크스페이스 캐시
 * 경로)와 definitionProvider(온디맨드 파싱 경로)가 같은 규칙을 공유하는
 * 단일 정본이다.
 *
 * 설계 원칙: 타입 추론이 불가능한 인자는 "unknown(중립, 0점)"으로 두어
 * 기존(인자 개수 기반) 동작을 해치지 않는다. 확실한 정보가 있을 때만
 * 가점/감점으로 순위를 바꾼다.
 */
import { getParameterArity, argCountMatchesArity } from './cursorExpression';

/**
 * 호출 문맥. 인자 개수와 (lazy) 인자 타입 공급자를 담는다.
 * 필드를 추가해도 기존 호출부가 깨지지 않도록 객체 형태로 확장한다.
 */
export interface CallContext {
    /** 호출부 최상위 인자 개수. undefined면 호출 문맥이 아니다. */
    argCount?: number;
    /**
     * 호출부 인자 타입의 lazy 공급자 — arity로 걸러도 후보가 2개 이상일 때만
     * 호출된다(식별자 타입 조회 비용 절약). 각 원소는 `RobotArm`, `RobotArm[]`,
     * `Integer`, NUMERIC_LITERAL_TYPE 같은 타입 문자열 또는 추론 불가 시 undefined.
     */
    getArgTypes?: () => ReadonlyArray<string | undefined>;
}

/** number(기존 argCount 호출부)와 CallContext를 모두 받는 하위호환 정규화. */
export function toCallContext(call?: number | CallContext): CallContext | undefined {
    if (call === undefined) { return undefined; }
    return typeof call === 'number' ? { argCount: call } : call;
}

/** rankOverloadMatches가 요구하는 최소 후보 형태(GPLSymbol과 구조 호환). */
export interface OverloadCandidate {
    kind: string;
    parameters?: string[];
    filePath: string;
    line: number;
}

/** 파라미터 선언 1개를 구조화한 정보. */
export interface ParamInfo {
    name?: string;
    /** 배열 접미사 없는 타입 이름 원문 (예: "RobotArm"). */
    typeName?: string;
    isArray: boolean;
    isOptional: boolean;
    isParamArray: boolean;
}

/** 숫자 리터럴 인자의 타입 표지 — 구체 숫자 타입을 정할 수 없어 계열로만 매칭한다. */
export const NUMERIC_LITERAL_TYPE = '__numeric__';

/** GPL/VB 숫자 계열 타입(소문자). 숫자 리터럴/암시적 숫자 변환 매칭에 사용. */
const GPL_NUMERIC_TYPES: ReadonlySet<string> = new Set([
    'byte', 'short', 'integer', 'long', 'single', 'double', 'decimal'
]);

/**
 * 파라미터 선언 문자열을 구조화한다.
 * 예: "stage As Integer" / "armlist() As RobotArm" / "ByRef s() As Foo"
 *     "Optional speed As Integer = 10" / "ParamArray vals() As Integer" / "x As Integer()"
 */
export function parseParameterDecl(decl: string): ParamInfo {
    const isOptional = /(^|\s)Optional\b/i.test(decl);
    const isParamArray = /(^|\s)ParamArray\b/i.test(decl);

    // 기본값(최상위 '=' 이후)은 타입 판정과 무관하므로 잘라낸다.
    let core = decl;
    {
        let depth = 0;
        let inString = false;
        for (let i = 0; i < decl.length; i++) {
            const ch = decl[i];
            if (ch === '"') { inString = !inString; continue; }
            if (inString) { continue; }
            if (ch === '(' || ch === '[') { depth++; continue; }
            if (ch === ')' || ch === ']') { if (depth > 0) { depth--; } continue; }
            if (ch === '=' && depth === 0) { core = decl.substring(0, i); break; }
        }
    }

    const cleaned = core.replace(/\b(ByVal|ByRef|Optional|ParamArray)\b/gi, ' ').trim();

    const asMatch = cleaned.match(/\bAs\s+(\w+)\s*(\(\s*,*\s*\))?/i);
    const typeName = asMatch ? asMatch[1] : undefined;
    const typeIsArray = !!(asMatch && asMatch[2]);

    const beforeAs = cleaned.split(/\bAs\b/i)[0].trim();
    const tokens = beforeAs.split(/\s+/).filter(Boolean);
    const last = tokens[tokens.length - 1] || '';
    const nameIsArray = /\(.*\)\s*$/.test(last);
    const name = last.replace(/\(.*\)\s*$/, '').replace(/[^A-Za-z0-9_]/g, '') || undefined;

    return { name, typeName, isArray: typeIsArray || nameIsArray, isOptional, isParamArray };
}

/**
 * 리터럴 인자 표현식의 타입을 추론한다. 추론 불가 시 undefined.
 * `"..."`(연결식 포함)는 String, True/False는 Boolean,
 * 숫자/16진(&H)/8진(&O) 리터럴은 NUMERIC_LITERAL_TYPE.
 */
export function inferLiteralArgType(expr: string): string | undefined {
    const s = expr.trim();
    if (!s) { return undefined; }
    if (s.startsWith('"')) { return 'String'; }
    if (/^(True|False)$/i.test(s)) { return 'Boolean'; }
    if (/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(s)) { return NUMERIC_LITERAL_TYPE; }
    if (/^&[Hh][0-9A-Fa-f]+$/.test(s) || /^&[Oo][0-7]+$/.test(s)) { return NUMERIC_LITERAL_TYPE; }
    return undefined;
}

/**
 * 인자 타입 1개 ↔ 파라미터 1개의 적합도 점수.
 *   +3 타입·배열여부 정확 일치 / +2 숫자 리터럴 ↔ 숫자 파라미터
 *   +1 숫자 계열 간 암시적 변환 / 0 판단 불가(중립)
 *   -1 숫자 리터럴 ↔ 비숫자 파라미터 / -2 명백한 불일치(배열여부·타입)
 */
export function scoreArgTypeAgainstParam(argType: string | undefined, param: ParamInfo): number {
    if (!argType || !param.typeName) { return 0; }
    const paramType = param.typeName.toLowerCase();

    if (argType === NUMERIC_LITERAL_TYPE) {
        if (param.isArray) { return -2; }
        return GPL_NUMERIC_TYPES.has(paramType) ? 2 : -1;
    }

    const argIsArray = argType.endsWith('[]');
    const argElem = (argIsArray ? argType.slice(0, -2) : argType).toLowerCase();

    if (argIsArray !== param.isArray) { return -2; }
    if (argElem === paramType) { return 3; }
    if (!argIsArray && GPL_NUMERIC_TYPES.has(argElem) && GPL_NUMERIC_TYPES.has(paramType)) { return 1; }
    return -2;
}

/**
 * 후보 하나의 파라미터 목록에 대해 인자 타입들의 적합도 총점을 구한다.
 * 초과 인자는 마지막 ParamArray 파라미터의 요소 타입과 대조한다.
 */
export function scoreCandidateByTypes(
    paramDecls: ReadonlyArray<string> | undefined,
    argTypes: ReadonlyArray<string | undefined>
): number {
    const params = (paramDecls ?? []).map(parseParameterDecl);
    const lastParam = params.length > 0 ? params[params.length - 1] : undefined;

    let score = 0;
    for (let i = 0; i < argTypes.length; i++) {
        let p = i < params.length ? params[i] : undefined;
        if (!p && lastParam && lastParam.isParamArray) { p = lastParam; }
        if (!p) { continue; }

        // ParamArray는 스칼라 인자를 개별로 받으므로 요소 타입(스칼라)으로 대조한다.
        if (p.isParamArray && p.isArray) {
            const t = argTypes[i];
            if (t !== undefined && !t.endsWith('[]')) {
                p = { ...p, isArray: false };
            }
        }

        score += scoreArgTypeAgainstParam(argTypes[i], p);
    }
    return score;
}

/**
 * 호출 가능한 후보들을 호출 문맥으로 랭킹해 "선두 동점 그룹"을 돌려준다.
 *
 * 선택 규칙(우선순위):
 *   1) arity 범위(required..max, Optional/ParamArray 반영)가 argCount를 포함하는 후보만.
 *      해당 후보가 없으면 전체 유지(부정확한 호출/파서 한계 대비).
 *   2) 인자 타입 적합도 총점 — 1) 이후에도 후보가 2개 이상이고 타입 공급자가 있을 때만
 *      계산한다(lazy, 조회 비용 절약).
 *   3) 전체 파라미터 수가 argCount와 정확히 일치하는 후보 우선.
 *   4) pathScore(파일 경로 근접도 등, 호출측 주입) 높은 후보 우선.
 *   5) 여기까지 점수가 모두 같은 후보들은 "구분 불가능한 동점"으로 보고 전부
 *      돌려준다(정의찾기 peek 목록용). [0]이 경로/라인 순 최선 후보다.
 */
export function rankOverloadMatches<T extends OverloadCandidate>(
    callable: ReadonlyArray<T>,
    ctx: CallContext,
    pathScore?: (candidate: T) => number
): T[] {
    if (callable.length === 0) { return []; }

    const argCount = ctx.argCount;
    let pool: ReadonlyArray<T> = callable;
    if (typeof argCount === 'number') {
        const within = callable.filter(c => argCountMatchesArity(argCount, getParameterArity(c.parameters)));
        if (within.length > 0) { pool = within; }
    }

    let argTypes: ReadonlyArray<string | undefined> | undefined;
    if (pool.length > 1 && ctx.getArgTypes) {
        const t = ctx.getArgTypes();
        if (t && t.some(x => x !== undefined)) { argTypes = t; }
    }

    const scored = pool.map(sym => ({
        sym,
        typeScore: argTypes ? scoreCandidateByTypes(sym.parameters, argTypes) : 0,
        exactTotal: typeof argCount === 'number' && (sym.parameters?.length ?? 0) === argCount ? 1 : 0,
        pathScore: pathScore ? pathScore(sym) : 0
    })).sort((a, b) => {
        if (b.typeScore !== a.typeScore) { return b.typeScore - a.typeScore; }
        if (b.exactTotal !== a.exactTotal) { return b.exactTotal - a.exactTotal; }
        if (b.pathScore !== a.pathScore) { return b.pathScore - a.pathScore; }
        if (a.sym.filePath !== b.sym.filePath) { return a.sym.filePath.localeCompare(b.sym.filePath); }
        return a.sym.line - b.sym.line;
    });

    const top = scored[0];
    return scored
        .filter(e => e.typeScore === top.typeScore && e.exactTotal === top.exactTotal && e.pathScore === top.pathScore)
        .map(e => e.sym);
}
