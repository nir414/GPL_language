/**
 * GPL 문서화 주석(documentation comment) 파서 · 렌더러 · 골격 생성기.
 *
 * 형식 — 선언 바로 위에 붙는 연속 `'` 주석 블록(파서가 GPLSymbol.docComment로 수집).
 * 설명이 먼저 오고, 그 뒤에 `#` 머리글로 구분되는 섹션이 이어진다.
 *
 * ```gpl
 * ' 값을 지정된 범위로 제한합니다.
 * '
 * ' # Parameters
 * ' - `value`: 제한할 값
 * ' - `min`: 최솟값
 * '
 * ' # Returns
 * ' 범위가 적용된 값
 * '
 * ' # Examples
 * ' ```
 * ' result = Clamp(120, 0, 100)
 * ' ```
 * Public Function Clamp(value As Number, min As Number, max As Number) As Number
 * ```
 *
 * 설계 원칙:
 *  - 섹션 이름은 별칭 표(SECTION_ALIASES)로 정규화하되, 표에 없는 머리글도 버리지 않고
 *    'other' 섹션으로 순서를 지켜 보존한다(형식을 몰라도 손실 없이 표시).
 *  - 구조가 없는 옛 주석(머리글 없음)은 전부 description이 되어 종전 동작과 동일하게 렌더된다.
 *  - vscode에 의존하지 않는다 — 순수 모듈이라 out/test/index.js에서 단위 테스트한다.
 */

export type DocSectionKind = 'parameters' | 'returns' | 'examples' | 'remarks' | 'other';

/** `# Parameters` 섹션의 항목 하나 (`- \`name\`: 설명`). */
export interface DocParamEntry {
    name: string;
    /** 설명(이어지는 들여쓴 줄은 공백으로 이어 붙임). 설명이 없으면 빈 문자열. */
    text: string;
}

export interface DocSection {
    kind: DocSectionKind;
    /** 작성자가 쓴 머리글 원문(예: 'Parameters', '매개변수'). 렌더링에 그대로 쓴다. */
    title: string;
    /** 머리글을 제외한 본문 줄(앞뒤 빈 줄 제거). */
    lines: string[];
    /** kind==='parameters'일 때 파싱된 항목. 불릿이 하나도 없으면 빈 배열. */
    params: DocParamEntry[];
    /** 원본(스트립된) 줄 배열에서 이 섹션이 차지하는 구간 — 머리글 줄부터 다음 머리글(또는 끝) 직전까지. */
    range: { start: number; end: number };
    /** 앞뒤 빈 줄을 뺀 본문(lines)의 원본 줄 인덱스 구간. 항목을 덧붙일 위치 계산에 쓴다. */
    bodyRange: { start: number; end: number };
}

export interface ParsedDocComment {
    /** 첫 머리글 이전의 자유 서술. */
    description: string[];
    /** description의 첫 문단을 한 줄로 합친 요약(없으면 ''). */
    summary: string;
    /** 등장 순서를 보존한 섹션 목록. */
    sections: DocSection[];
    /** `#` 머리글이 하나라도 있으면 true(구조화된 주석). */
    isStructured: boolean;
    /** 주석 전체를 `'` 제거 후 줄 단위로 나눈 원본(머지 시 줄 번호 계산에 사용). */
    lines: string[];
}

interface SectionAlias {
    kind: Exclude<DocSectionKind, 'other'>;
    /** 골격 생성 시 사용할 표준 제목. */
    canonical: string;
    aliases: readonly string[];
}

/**
 * 섹션 이름 별칭 표. 새 섹션 종류가 필요하면 여기에 한 줄을 추가하면 파싱·렌더링·생성이 함께 따라온다.
 * (표에 없는 머리글도 'other'로 보존되므로, 등록은 "특별 취급이 필요할 때"만 하면 된다.)
 */
const SECTION_ALIASES: readonly SectionAlias[] = [
    {
        kind: 'parameters',
        canonical: 'Parameters',
        aliases: ['parameters', 'parameter', 'params', 'param', 'arguments', 'args', '매개변수', '매개 변수', '파라미터', '인수', '인자']
    },
    {
        kind: 'returns',
        canonical: 'Returns',
        aliases: ['returns', 'return', 'return value', '반환', '반환값', '반환 값', '리턴', '리턴값']
    },
    {
        kind: 'examples',
        canonical: 'Examples',
        aliases: ['examples', 'example', 'usage', '예제', '예시', '사용법', '사용 예', '사용예']
    },
    {
        kind: 'remarks',
        canonical: 'Remarks',
        aliases: ['remarks', 'remark', 'notes', 'note', '비고', '참고', '주의']
    }
];

/** 섹션 표준 제목 (골격 생성기가 사용). */
export const SECTION_TITLES: Readonly<Record<Exclude<DocSectionKind, 'other'>, string>> = {
    parameters: 'Parameters',
    returns: 'Returns',
    examples: 'Examples',
    remarks: 'Remarks'
};

const FENCE_RE = /^\s*(```|~~~)/;
const HEADER_RE = /^\s*(#{1,6})\s*(\S.*?)\s*:?\s*$/;
const BULLET_RE = /^\s*[-*+]\s+(.*)$/;
// `value`: 설명 / value - 설명 / value 설명 — 이름 뒤 구분자는 선택.
const PARAM_ENTRY_RE = /^`?([A-Za-z_][A-Za-z0-9_]*)`?(?:\s*\(\s*\))?\s*(?:[:—–-]\s*)?(.*)$/;

/**
 * 장식용 구분선 판별 — 구두점만으로 3자 이상 채운 줄(`========`, `--------`, `* * *`, `////` 등).
 *
 * 마크다운은 이런 줄을 바로 위 문단의 setext 머리글 밑줄로 읽어(`===`→h1, `---`→h2) 제목 한 줄이
 * 거대한 헤딩으로 렌더된다. 옛 주석의 ASCII 박스가 여기에 해당하므로 렌더링 단계에서만 걸러낸다
 * (원문과 줄 인덱스는 그대로 둔다 — 주석 머지/편집이 줄 번호에 의존한다).
 *
 * 대상 문자에 백틱과 물결(`~`)은 넣지 않는다 — 코드 펜스 표기(``` / ~~~)와 구분할 수 없다.
 * 마침표·콜론도 제외한다(`...`, `:::`는 내용일 수 있다).
 */
const DECORATIVE_RULE_RE = /^[=\-_*#+/\\|<>]{3,}$/;

export function isDecorativeRule(line: string): boolean {
    return DECORATIVE_RULE_RE.test(line.replace(/\s+/g, ''));
}

/** 장식용 구분선을 제거한다. 코드 펜스 안(예제 속 `-----`는 내용이다)은 손대지 않는다. */
function stripDecorativeRules(lines: readonly string[]): string[] {
    const out: string[] = [];
    let fence = false;
    for (const line of lines) {
        if (FENCE_RE.test(line)) {
            fence = !fence;
        } else if (!fence && isDecorativeRule(line)) {
            continue;
        }
        out.push(line);
    }
    return out;
}

function classifyHeader(title: string): { kind: DocSectionKind } {
    const key = title.trim().toLowerCase().replace(/\s+/g, ' ');
    for (const entry of SECTION_ALIASES) {
        if (entry.aliases.includes(key)) {
            return { kind: entry.kind };
        }
    }
    return { kind: 'other' };
}

function trimBlankEdges(lines: string[]): string[] {
    let start = 0;
    let end = lines.length;
    while (start < end && lines[start].trim() === '') { start++; }
    while (end > start && lines[end - 1].trim() === '') { end--; }
    return lines.slice(start, end);
}

/** `# Parameters` 본문 줄에서 항목을 추출한다. 불릿이 아닌 이어지는 줄은 직전 항목 설명에 이어 붙인다. */
function parseParamEntries(lines: string[]): DocParamEntry[] {
    const out: DocParamEntry[] = [];
    let fence = false;
    for (const raw of lines) {
        if (FENCE_RE.test(raw)) { fence = !fence; continue; }
        if (fence) { continue; }
        // 장식용 구분선은 직전 항목의 이어지는 설명으로 붙지 않게 버린다.
        if (isDecorativeRule(raw)) { continue; }

        const bullet = raw.match(BULLET_RE);
        if (bullet) {
            const m = bullet[1].match(PARAM_ENTRY_RE);
            if (m) {
                out.push({ name: m[1], text: m[2].trim() });
            }
            continue;
        }
        // 불릿이 아닌 줄: 직전 항목의 이어지는 설명으로 본다.
        const cont = raw.trim();
        if (cont && out.length) {
            const last = out[out.length - 1];
            last.text = last.text ? `${last.text} ${cont}` : cont;
        }
    }
    return out;
}

/**
 * 문서화 주석 본문(줄 앞 `'`가 이미 제거된 문자열)을 구조화한다.
 * 코드 펜스(``` 또는 ~~~) 안의 `#`은 머리글로 보지 않는다.
 */
export function parseDocComment(raw: string): ParsedDocComment {
    const lines = raw.replace(/\r\n?/g, '\n').split('\n').map(l => l.trimEnd());

    const description: string[] = [];
    const sections: DocSection[] = [];
    let current: { kind: DocSectionKind; title: string; start: number; body: string[] } | undefined;
    let fence = false;

    const flush = (endIndex: number) => {
        if (!current) { return; }
        const body = trimBlankEdges(current.body);
        // 본문의 원본 줄 인덱스 — 머리글 다음 줄부터 세되 앞의 빈 줄만큼 밀어 준다.
        let lead = 0;
        while (lead < current.body.length && current.body[lead].trim() === '') { lead++; }
        const bodyStart = current.start + 1 + lead;
        sections.push({
            kind: current.kind,
            title: current.title,
            lines: body,
            params: current.kind === 'parameters' ? parseParamEntries(body) : [],
            range: { start: current.start, end: endIndex },
            bodyRange: { start: bodyStart, end: bodyStart + body.length }
        });
        current = undefined;
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (FENCE_RE.test(line)) {
            fence = !fence;
        }

        // `#####` 같은 장식선은 머리글(`# 제목`)로 보지 않는다 — HEADER_RE에는 걸린다.
        const header = !fence && !isDecorativeRule(line) ? line.match(HEADER_RE) : null;
        if (header) {
            flush(i);
            const title = header[2];
            current = { kind: classifyHeader(title).kind, title, start: i, body: [] };
            continue;
        }

        if (current) {
            current.body.push(line);
        } else {
            description.push(line);
        }
    }
    flush(lines.length);

    const desc = trimBlankEdges(description);
    const firstBlank = desc.findIndex(l => l.trim() === '');
    const summaryLines = stripDecorativeRules(firstBlank > 0 ? desc.slice(0, firstBlank) : desc);

    return {
        description: desc,
        summary: summaryLines.join(' ').trim(),
        sections,
        isStructured: sections.length > 0,
        lines
    };
}

export function findSection(doc: ParsedDocComment, kind: DocSectionKind): DocSection | undefined {
    return doc.sections.find(s => s.kind === kind);
}

/** `# Parameters` 항목을 이름(대소문자 무시) → 설명으로 조회한다. */
export function getParamDoc(doc: ParsedDocComment, paramName: string): string | undefined {
    const section = findSection(doc, 'parameters');
    if (!section) { return undefined; }
    const hit = section.params.find(p => p.name.toLowerCase() === paramName.toLowerCase());
    return hit && hit.text ? hit.text : undefined;
}

// ---------------------------------------------------------------------------
// 렌더링
// ---------------------------------------------------------------------------

export interface DocRenderOptions {
    /** 'summary'(기본): 설명은 첫 문단만 / 'full': 설명 전체. 섹션은 두 모드 모두 표시한다. */
    descriptionMode?: 'summary' | 'full';
    /** 설명 부분의 최대 줄 수 (0 또는 미지정 = 무제한). 섹션에는 적용하지 않는다. */
    maxDescriptionLines?: number;
    /** false면 섹션(Parameters/Returns/…)을 렌더링하지 않는다(기본 true). */
    sections?: boolean;
    /** 렌더링할 섹션 종류 제한(미지정 = 전부). */
    includeKinds?: readonly DocSectionKind[];
    /** 설명이 잘렸을 때 덧붙일 안내 문구. */
    truncationHint?: string;
}

const DEFAULT_TRUNCATION_HINT = '… *(전체 주석: 정의로 이동 F12)*';

/** 한 문단(빈 줄 없는 줄 묶음)을 마크다운 강제 줄바꿈으로 잇는다. */
function joinParagraph(lines: string[]): string {
    return lines.join('  \n');
}

/**
 * 언어 표기가 없는 여는 코드 펜스(```)에 `gpl`을 붙여 호버에서도 구문 강조가 되게 한다.
 * 원문(주석)은 건드리지 않고 렌더링 결과에만 적용한다.
 */
function withFenceLanguage(lines: readonly string[]): string[] {
    let open = false;
    return lines.map(line => {
        const m = line.match(/^(\s*)(```|~~~)(.*)$/);
        if (!m) { return line; }
        const wasOpen = open;
        open = !open;
        return !wasOpen && m[3].trim() === '' ? `${m[1]}${m[2]}gpl` : line;
    });
}

/**
 * 여는 코드 펜스만 남았을 때 닫는 펜스를 보태 준다.
 *
 * 두 경로에서 생긴다: 작성자가 닫는 펜스를 빼먹은 주석, 그리고 **요약 모드·`maxDescriptionLines`로
 * 펜스 중간에서 잘린 설명**. 닫히지 않은 펜스는 뒤따르는 안내 문구(`… 전체 주석: 정의로 이동`)나
 * 다음 섹션까지 코드 블록으로 삼켜 버린다. 원문은 그대로 두고 렌더 결과만 보정한다.
 */
function closeUnbalancedFence(lines: readonly string[]): string[] {
    let open: string | undefined;
    for (const line of lines) {
        const m = line.match(/^\s*(```|~~~)/);
        if (m) { open = open ? undefined : m[1]; }
    }
    return open ? [...lines, open] : [...lines];
}

function renderSectionBody(section: DocSection): string {
    if (section.kind === 'parameters' && section.params.length) {
        return section.params
            .map(p => (p.text ? `- \`${p.name}\` — ${p.text}` : `- \`${p.name}\``))
            .join('\n');
    }
    const lines = stripDecorativeRules(section.lines);
    // Examples 등은 코드 펜스를 그대로 살려야 하므로 원문 줄바꿈을 유지한다.
    if (section.kind === 'examples' || lines.some(l => FENCE_RE.test(l))) {
        return closeUnbalancedFence(withFenceLanguage(lines)).join('\n');
    }
    return joinParagraph(lines);
}

/**
 * 문서화 주석을 호버/자동완성용 마크다운으로 렌더링한다.
 * 구조가 없는 주석은 설명 그대로(종전 동작), 구조화된 주석은 설명 + 섹션 순서대로 표시한다.
 */
export function renderDocCommentMarkdown(
    input: string | ParsedDocComment,
    options: DocRenderOptions = {}
): string | undefined {
    const doc = typeof input === 'string' ? parseDocComment(input) : input;
    const mode = options.descriptionMode ?? 'summary';
    const max = options.maxDescriptionLines ?? 0;

    // 장식용 구분선은 잘라내기(요약/최대 줄 수) 전에 없앤다 — 표시 한도를 장식이 잡아먹지 않게.
    let desc = stripDecorativeRules(doc.description);
    let truncated = false;

    if (mode === 'summary') {
        const blank = desc.findIndex(l => l.trim() === '');
        if (blank > 0) {
            truncated = truncated || blank < desc.length;
            desc = desc.slice(0, blank);
        }
    }
    if (max > 0 && desc.length > max) {
        desc = desc.slice(0, max);
        truncated = true;
    }
    desc = trimBlankEdges(desc);

    const parts: string[] = [];
    const hint = options.truncationHint ?? DEFAULT_TRUNCATION_HINT;
    if (desc.length) {
        // 설명 안의 코드 펜스도 섹션과 같이 다룬다 — 언어 표기 보정 후, 잘려서 열린 펜스는 닫아
        // 뒤의 안내 문구가 코드 블록에 삼켜지지 않게 한다.
        const body = joinParagraph(closeUnbalancedFence(withFenceLanguage(desc)));
        parts.push(truncated ? `${body}  \n${hint}` : body);
    } else if (truncated && !doc.sections.length) {
        parts.push(hint);
    }

    if (options.sections !== false) {
        for (const section of doc.sections) {
            if (options.includeKinds && !options.includeKinds.includes(section.kind)) {
                continue;
            }
            const body = renderSectionBody(section);
            if (!body.trim()) { continue; }
            parts.push(`**${section.title}**\n\n${body}`);
        }
    }

    const text = parts.join('\n\n');
    return text.trim() ? text : undefined;
}

// ---------------------------------------------------------------------------
// 골격 생성
// ---------------------------------------------------------------------------

export interface DocTarget {
    /** GPLSymbolKind 문자열과 동일한 값을 받는다. */
    kind: string;
    name: string;
    /** 원문 파라미터 선언 목록(예: 'ByVal value As Number'). */
    parameters?: readonly string[];
    /** 반환 타입(Function/Property). 있으면 `# Returns` 섹션을 만든다. */
    returnType?: string;
}

export interface DocGenerateOptions {
    /** true면 `${1:…}` 스니펫 placeholder를 넣는다(기본 false — 평문). */
    snippet?: boolean;
    /** `# Examples` 섹션 골격을 함께 넣는다(기본 false). */
    includeExamples?: boolean;
}

/** 파라미터 선언에서 이름만 뽑는다. `ByRef list() As Foo` → `list`. */
export function extractParamName(decl: string): string | undefined {
    const withoutDefault = decl.split('=')[0];
    const cleaned = withoutDefault.replace(/\b(ByVal|ByRef|Optional|ParamArray)\b/gi, ' ').trim();
    const beforeAs = cleaned.split(/\bAs\b/i)[0].trim();
    const tokens = beforeAs.split(/\s+/).filter(Boolean);
    const last = tokens[tokens.length - 1] || '';
    const name = last.replace(/\(.*\)\s*$/, '').replace(/[^A-Za-z0-9_]/g, '');
    return name || undefined;
}

function placeholder(snippet: boolean, index: number, text: string): string {
    return snippet ? `\${${index}:${text}}` : text;
}

/**
 * 선언에 맞는 문서화 주석 골격을 만든다. 반환값은 `'` 접두사가 붙은 줄 배열이며 **들여쓰기는 없다**
 * (호출부가 스니펫으로 삽입하면 VS Code가 삽입 위치의 들여쓰기를 이어 붙인다).
 *
 * 규칙: 설명은 항상, `# Parameters`는 파라미터가 있을 때, `# Returns`는 반환 타입이 있을 때,
 * `# Examples`는 옵션으로만 — 사용자가 정한 형식 그대로.
 */
export function buildDocCommentBlock(target: DocTarget, options: DocGenerateOptions = {}): string[] {
    const snippet = options.snippet === true;
    let tab = 1;
    const out: string[] = [`' ${placeholder(snippet, tab++, `${target.name} 설명`)}`];

    const paramNames = (target.parameters ?? [])
        .map(extractParamName)
        .filter((n): n is string => !!n);

    if (paramNames.length) {
        out.push("'", `' # ${SECTION_TITLES.parameters}`);
        for (const name of paramNames) {
            out.push(`' - \`${name}\`: ${placeholder(snippet, tab++, '설명')}`);
        }
    }

    if (target.returnType) {
        out.push("'", `' # ${SECTION_TITLES.returns}`, `' ${placeholder(snippet, tab++, `${target.returnType} 반환값 설명`)}`);
    }

    if (options.includeExamples) {
        out.push(
            "'",
            `' # ${SECTION_TITLES.examples}`,
            "' ```",
            `' ${placeholder(snippet, tab++, buildCallExample(target, paramNames))}`,
            "' ```"
        );
    }

    if (snippet) {
        out[out.length - 1] = `${out[out.length - 1]}$0`;
    }
    return out;
}

/** Examples 골격에 넣을 호출 예시 한 줄. */
function buildCallExample(target: DocTarget, paramNames: readonly string[]): string {
    const args = paramNames.join(', ');
    if (target.kind === 'function') {
        return `result = ${target.name}(${args})`;
    }
    if (target.kind === 'sub') {
        return `${target.name}(${args})`;
    }
    return target.name;
}

// ---------------------------------------------------------------------------
// 문서 안에서 대상 선언·주석 블록 찾기 (편집기 무의존 — vscode 쪽은 줄 접근자만 넘긴다)
// ---------------------------------------------------------------------------

/** 줄 번호(0-based) → 그 줄의 원문. */
export type LineAccessor = (line: number) => string;

/** 파서가 docComment를 수집할 때와 같은 규칙으로 줄 앞 `'`(+공백 하나)를 제거한다. */
export function stripCommentPrefix(text: string): string {
    return text.trim().replace(/^'+[ \t]?/, '');
}

export function isCommentLine(text: string): boolean {
    return text.trim().startsWith("'");
}

/** 한 선언이 문서화 주석을 붙일 만한 종류인지 (변수/상수도 포함 — 설명만 있는 골격이 나온다). */
export function isDocumentableKind(kind: string): boolean {
    return ['function', 'sub', 'property', 'class', 'module', 'variable', 'constant'].includes(kind);
}

/** 탐색 상한 — 주석 블록이 아무리 길어도 이 범위 밖의 선언은 대상으로 보지 않는다. */
export const DOC_SCAN_LIMIT = 40;

/**
 * `fromLine`에서 아래로 훑어 첫 코드 줄(빈 줄·주석이 아닌 줄)을 찾는다.
 * `stopAtBlank`면 빈 줄에서 멈춘다 — 빈 줄이 끼면 주석이 그 선언에 붙지 않는 파서 규칙과 같게 하기 위함
 * (선언과 무관한 위치에서 전구 메뉴가 뜨는 것을 막는다).
 */
export function findCodeLineBelow(
    getLine: LineAccessor,
    lineCount: number,
    fromLine: number,
    options: { stopAtBlank?: boolean } = {}
): number | undefined {
    for (let i = fromLine; i < lineCount && i < fromLine + DOC_SCAN_LIMIT; i++) {
        const text = getLine(i);
        if (text.trim() === '') {
            if (options.stopAtBlank) { return undefined; }
            continue;
        }
        if (isCommentLine(text)) { continue; }
        return i;
    }
    return undefined;
}

/**
 * 선언 줄 바로 위에 붙어 있는 연속 `'` 주석 블록을 찾는다(빈 줄이 끼면 끊긴다 — 파서와 동일 규칙).
 * `lines`는 `'` 접두사를 제거한 본문으로, 그대로 parseDocComment에 넣을 수 있다.
 */
export function locateDocCommentBlock(
    getLine: LineAccessor,
    declLine: number
): { startLine: number; lines: string[] } | undefined {
    let start: number | undefined;
    for (let i = declLine - 1; i >= 0; i--) {
        if (!isCommentLine(getLine(i))) { break; }
        start = i;
    }
    if (start === undefined) { return undefined; }

    const lines: string[] = [];
    for (let i = start; i < declLine; i++) {
        lines.push(stripCommentPrefix(getLine(i)));
    }
    return { startLine: start, lines };
}

// ---------------------------------------------------------------------------
// 기존 주석 보완(머지)
// ---------------------------------------------------------------------------

/** 원본 줄 배열의 `atIndex` 위치에 `lines`를 끼워 넣으라는 지시. */
export interface DocInsertion {
    atIndex: number;
    lines: string[];
}

export interface DocMergeResult {
    insertions: DocInsertion[];
    /** 사람이 읽을 변경 요약(예: ['매개변수 min', 'Returns 섹션']). */
    added: string[];
}

/**
 * 이미 있는 문서화 주석에 빠진 항목만 덧붙인다(기존 서술은 건드리지 않는다).
 *  - 시그니처에 있는데 `# Parameters`에 없는 파라미터 → 항목 추가(섹션이 없으면 섹션째 추가)
 *  - 반환 타입이 있는데 `# Returns` 섹션이 없음 → 섹션 추가
 * 삽입 위치는 Parameters → Returns → Examples 순서를 지키도록 고른다.
 */
export function mergeDocComment(existing: ParsedDocComment, target: DocTarget): DocMergeResult {
    const insertions: DocInsertion[] = [];
    const added: string[] = [];

    const paramNames = (target.parameters ?? [])
        .map(extractParamName)
        .filter((n): n is string => !!n);

    const paramSection = findSection(existing, 'parameters');
    const returnsSection = findSection(existing, 'returns');
    const examplesSection = findSection(existing, 'examples');

    /** 특정 kind 섹션 앞(없으면 문서 끝)의 삽입 지점. */
    const insertPointBefore = (kinds: DocSectionKind[]): number => {
        for (const s of existing.sections) {
            if (kinds.includes(s.kind)) {
                return s.range.start;
            }
        }
        return existing.lines.length;
    };

    if (paramNames.length) {
        if (paramSection) {
            const documented = new Set(paramSection.params.map(p => p.name.toLowerCase()));
            const missing = paramNames.filter(n => !documented.has(n.toLowerCase()));
            if (missing.length) {
                insertions.push({
                    atIndex: paramSection.bodyRange.end,
                    lines: missing.map(n => `- \`${n}\`: `)
                });
                added.push(...missing.map(n => `매개변수 \`${n}\``));
            }
        } else {
            const at = insertPointBefore(['returns', 'examples']);
            insertions.push({
                atIndex: at,
                lines: ['', `# ${SECTION_TITLES.parameters}`, ...paramNames.map(n => `- \`${n}\`: `), ...(at < existing.lines.length ? [''] : [])]
            });
            added.push(`${SECTION_TITLES.parameters} 섹션`);
        }
    }

    if (target.returnType && !returnsSection) {
        const at = examplesSection ? examplesSection.range.start : existing.lines.length;
        insertions.push({
            atIndex: at,
            lines: ['', `# ${SECTION_TITLES.returns}`, '', ...(at < existing.lines.length ? [''] : [])]
        });
        added.push(`${SECTION_TITLES.returns} 섹션`);
    }

    // 같은 위치에 두 번 끼워 넣으면 적용 순서에 따라 순서가 뒤집히므로 하나로 합친다
    // (Parameters → Returns 순서 유지). 그 뒤 뒤쪽부터 삽입해야 앞선 삽입이 인덱스를 밀지 않는다.
    const byIndex = new Map<number, string[]>();
    for (const ins of insertions) {
        const cur = byIndex.get(ins.atIndex);
        if (cur) {
            cur.push(...ins.lines);
        } else {
            byIndex.set(ins.atIndex, [...ins.lines]);
        }
    }
    const merged = Array.from(byIndex.entries())
        .map(([atIndex, lines]) => ({ atIndex, lines }))
        .sort((a, b) => b.atIndex - a.atIndex);

    return { insertions: merged, added };
}
