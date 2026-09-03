/**
 * GPL(VB 계열) 예약어 정본 — 역할별 뷰를 이 파일 하나에서 제공한다.
 *
 * 종전에는 같은 낱말 목록이 `config.ts`(정의 탐색 차단용 좁은 집합)와
 * `language/renameCore.ts`(rename 금지용 넓은 집합)에 각각 하드코딩돼 있었다.
 * 예약어를 봐야 하는 곳이 늘어날 때마다(디버그 hover 차단 등) 목록이 갈라지므로,
 * 넓은 집합을 정본으로 두고 좁은 집합을 그 부분집합으로 정의한다.
 * vscode API에 의존하지 않는다(순수 모듈 — 단위 테스트/디버그 어댑터에서도 쓸 수 있게).
 */

/** 제어문/연산자/리터럴 키워드 — 심볼 해석 대상이 될 수 없는 좁은 집합. */
const CONTROL_WORDS = [
    'if', 'then', 'else', 'elseif', 'end', 'endif',
    'for', 'next', 'to', 'step', 'each', 'in',
    'while', 'wend', 'do', 'loop', 'until',
    'select', 'case', 'return', 'exit', 'continue', 'goto',
    'dim', 'as', 'byref', 'byval', 'redim',
    'and', 'or', 'not', 'xor', 'mod',
    'true', 'false', 'nothing',
    'try', 'catch', 'finally', 'throw', 'with',
] as const;

/** 선언/접근제한자/객체 참조 키워드 + 기본 타입명 — 넓은 집합에만 포함. */
const DECLARATION_WORDS = [
    'sub', 'function', 'property', 'module', 'class', 'type', 'enum',
    'get', 'set', 'public', 'private', 'friend', 'shared',
    'readonly', 'writeonly', 'const', 'static', 'optional', 'paramarray',
    'new', 'me', 'mybase', 'call', 'delegate', 'event',
    'inherits', 'implements', 'overloads', 'overrides', 'stop',
    'string', 'integer', 'long', 'short', 'byte', 'single', 'double',
    'boolean', 'object', 'date',
] as const;

/**
 * 예약어 전체(정본). 식별자 자리에 올 수 없는 낱말 — rename 금지, 디버그 hover 평가 차단 등
 * "이 낱말은 사용자 심볼이 아니다"를 판단하는 모든 곳이 이 집합을 쓴다.
 */
export const GPL_RESERVED_WORDS: ReadonlySet<string> = new Set<string>([
    ...CONTROL_WORDS,
    ...DECLARATION_WORDS,
]);

/**
 * 제어문/연산자/리터럴만 담은 좁은 집합 — 정의 탐색(definitionProvider)의 조기 차단용.
 * `New`(생성자 점프)·`Me`/`MyBase`·타입명(String 등)은 해석 대상으로 남겨야 하므로 제외된다.
 */
export const GPL_CONTROL_KEYWORDS: ReadonlySet<string> = new Set<string>(CONTROL_WORDS);

/** 예약어(넓은 집합)인지 검사 — 대소문자·주변 공백 무시. */
export function isGplReservedWord(name: string): boolean {
    return GPL_RESERVED_WORDS.has(name.trim().toLowerCase());
}

/** 제어문/연산자/리터럴 키워드(좁은 집합)인지 검사 — 대소문자·주변 공백 무시. */
export function isGplControlKeyword(name: string): boolean {
    return GPL_CONTROL_KEYWORDS.has(name.trim().toLowerCase());
}
