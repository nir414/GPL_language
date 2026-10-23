/**
 * 오버로드 그룹의 문서화 주석 병합(vscode 무의존).
 *
 * 원칙 — **공통 문서는 이름 단위로 공유하고, 오버로드별 차이만 개별 문서화한다.**
 * 같은 이름의 Sub/Function 이 여럿이면 선언마다 주석을 통째로 복붙하지 않아도, 빠진 조각을
 * 형제 오버로드의 주석에서 채워 호버·자동완성·시그니처 도움말에 보여 준다. 작성자는 가장 완전한
 * 시그니처 하나에 전체 문서를 쓰고, 나머지에는 차이 한 줄과 그 오버로드에만 있는 매개변수만 쓰면 된다.
 *
 * 선정 규칙은 **선언 순서를 쓰지 않는다** — 실제 코드의 오버로드 순서는 나중에 덧붙인 흔적일 뿐 의미가 없다.
 *  - 공통 설명: 그룹에서 문서가 **유일하게** 가장 풍부한 오버로드의 요약(첫 문단).
 *    풍부함 = 설명 줄 수 + 매개변수 항목 수 + 섹션 수. 동률이면 매개변수 커버리지
 *    (그 문서가 설명한 이름이 그룹 전체 매개변수 이름 중 몇 개인지)로 가르고, 그래도 동률이면 공통 설명을 붙이지 않는다
 *    (애매하면 틀린 것을 붙이는 대신 생략).
 *  - 자기 설명: 있으면 그대로. 없으면 매개변수 이름 집합이 가장 닮은 형제(Jaccard)의 설명, 동률이면 더 풍부한 문서.
 *  - `# Parameters`: 이름별 병합 — 자기 항목 우선, 없으면 가장 닮은 형제부터 찾는다. 자기 시그니처에 있는 이름만 채운다.
 *  - `# Returns`: 자기 것, 없으면 반환 타입이 같은 형제 중 가장 닮은 것.
 *  - `# Examples`·`# Remarks`·기타 섹션: 자기 것만(오버로드 고유일 때가 많다).
 * 모든 기준이 같을 때의 마지막 정렬(경로·줄)은 선정 기준이 아니라 렌더 결과가 호출마다 흔들리지 않게 하는 안정성 장치다.
 *
 * 물려받은 조각은 출처를 함께 돌려주므로(provenance) 호버가 "어느 오버로드의 문서에서 왔는지"를 작게 표기할 수 있다.
 * 형제가 없거나 물려받은 것이 없으면 자기 주석을 파싱한 그대로 돌려준다(비오버로드 심볼의 표시는 종전과 동일).
 */

import { normalizePathKey } from '../util/pathKey';
import { ciEq } from './identifiers';
import {
    DocParamEntry,
    DocRenderOptions,
    ParsedDocComment,
    SECTION_TITLES,
    extractParamName,
    findSection,
    parseDocComment,
    renderDocCommentMarkdown,
} from './docComment';

/** 병합에 필요한 최소 심볼 형태(GPLSymbol 과 구조 호환). */
export interface OverloadDocCandidate {
    name: string;
    kind: string;
    filePath: string;
    line: number;
    module?: string;
    className?: string;
    /** 원문 매개변수 선언 목록(예: 'ByVal value As Number'). */
    parameters?: readonly string[];
    returnType?: string;
    docComment?: string;
}

export interface OverloadSiblingOptions {
    /** 두 파일이 같은 컴파일 단위인지(판정 불가면 true 를 돌려줄 것). 없으면 단위를 따지지 않는다. */
    isSameUnit?: (candidateFilePath: string, targetFilePath: string) => boolean;
}

export interface ResolvedOverloadDoc {
    /** 병합 결과 — renderDocCommentMarkdown / getParamDoc 에 그대로 넣을 수 있다. */
    doc: ParsedDocComment;
    /** 형제 오버로드 수(자기 제외). 0 이면 doc 은 자기 주석 그대로다. */
    overloadCount: number;
    /** 물려받은 조각의 출처(마크다운 한 줄, 이탤릭). 물려받은 것이 없으면 undefined. */
    provenance?: string;
}

/** 골격 생성·보완이 "차이만" 만들도록, 형제가 이미 설명한 조각을 알려 준다. */
export interface OverloadCoverage {
    /** 대상 시그니처의 매개변수 중 형제 주석이 설명을 갖고 있는 이름(원문 표기). */
    coveredParams: string[];
    /** 반환 타입이 같은 형제가 비어 있지 않은 `# Returns` 를 갖고 있으면 true. */
    coveredReturns: boolean;
}

const CALLABLE_KINDS: ReadonlySet<string> = new Set(['function', 'sub']);

function lowerOrEmpty(s: string | undefined): string {
    return (s ?? '').toLowerCase();
}

function hasText(lines: readonly string[] | undefined): boolean {
    return !!lines && lines.some(l => l.trim() !== '');
}

/** 같은 선언인지 가르는 키 — 캐시 심볼과 현재 문서를 파싱한 심볼은 객체가 달라도 같은 선언일 수 있다. */
function declKey(s: OverloadDocCandidate): string {
    return `${normalizePathKey(s.filePath)}#${s.line}`;
}

function compareStable(a: OverloadDocCandidate, b: OverloadDocCandidate): number {
    const pa = normalizePathKey(a.filePath);
    const pb = normalizePathKey(b.filePath);
    if (pa !== pb) {
        return pa < pb ? -1 : 1;
    }
    return a.line - b.line;
}

/**
 * 대상과 같은 오버로드 그룹에 속하는 형제(대상 자신 제외)만 남긴다 —
 * 같은 이름·호출 가능(Sub/Function)·같은 모듈/클래스·(주어지면) 같은 컴파일 단위.
 * 같은 선언의 사본(캐시 + 현재 문서 파싱)은 하나로 합친다.
 */
export function filterOverloadSiblings<T extends OverloadDocCandidate>(
    target: T,
    candidates: readonly T[],
    options: OverloadSiblingOptions = {}
): T[] {
    if (!CALLABLE_KINDS.has(target.kind)) {
        return [];
    }
    const targetPath = normalizePathKey(target.filePath);
    const seen = new Set<string>([declKey(target)]);
    const out: T[] = [];
    for (const c of candidates) {
        if (!CALLABLE_KINDS.has(c.kind) || !ciEq(c.name, target.name)) {
            continue;
        }
        if (lowerOrEmpty(c.module) !== lowerOrEmpty(target.module) || lowerOrEmpty(c.className) !== lowerOrEmpty(target.className)) {
            continue;
        }
        const key = declKey(c);
        if (seen.has(key)) {
            continue;
        }
        // 자기 선언·캐시 사본은 관계 탐색 전에 제외한다. 같은 파일의 오버로드도 항상 같은 단위다.
        if (options.isSameUnit && normalizePathKey(c.filePath) !== targetPath
            && !options.isSameUnit(c.filePath, target.filePath)) {
            continue;
        }
        seen.add(key);
        out.push(c);
    }
    return out;
}

/** 출처 표기용 짧은 시그니처 — 이름과 매개변수 이름만, 배열 매개변수는 `()` 를 남긴다(`getWafer(stage, slot, armlist())`). */
export function shortSignature(sym: OverloadDocCandidate): string {
    const names = (sym.parameters ?? []).map(decl => {
        const name = extractParamName(decl) ?? decl.trim();
        const beforeAs = decl.split(/\bAs\b/i)[0];
        return /\([\s,]*\)/.test(beforeAs) ? `${name}()` : name;
    });
    return `${sym.name}(${names.join(', ')})`;
}

// ---------------------------------------------------------------------------
// 프로필 — 심볼 하나의 문서를 병합에 쓰기 좋은 형태로
// ---------------------------------------------------------------------------

interface Profile<T extends OverloadDocCandidate> {
    sym: T;
    doc?: ParsedDocComment;
    /** 시그니처의 매개변수 이름(원문 표기, 순서 유지). */
    paramNames: string[];
    /** 같은 것을 소문자로. */
    paramSet: Set<string>;
    /** 문서에 있는 매개변수 항목 중 설명이 비어 있지 않은 것(소문자 이름 → 항목). */
    entries: Map<string, DocParamEntry>;
    /** 설명 줄 수 + 매개변수 항목 수 + 섹션 수. */
    richness: number;
}

function profileOf<T extends OverloadDocCandidate>(sym: T): Profile<T> {
    const doc = sym.docComment && sym.docComment.trim() ? parseDocComment(sym.docComment) : undefined;
    const paramNames = (sym.parameters ?? [])
        .map(extractParamName)
        .filter((n): n is string => !!n);
    const entries = new Map<string, DocParamEntry>();
    const paramSection = doc ? findSection(doc, 'parameters') : undefined;
    for (const p of paramSection?.params ?? []) {
        if (p.text.trim()) {
            entries.set(p.name.toLowerCase(), p);
        }
    }
    const richness = doc
        ? doc.description.filter(l => l.trim()).length + (paramSection?.params.length ?? 0) + doc.sections.length
        : 0;
    return { sym, doc, paramNames, paramSet: new Set(paramNames.map(n => n.toLowerCase())), entries, richness };
}

/** 매개변수 이름 집합의 Jaccard 유사도. 둘 다 비어 있으면 1(매개변수 없는 오버로드끼리는 서로 가장 닮았다). */
function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
    if (a.size === 0 && b.size === 0) {
        return 1;
    }
    let inter = 0;
    for (const x of a) {
        if (b.has(x)) {
            inter++;
        }
    }
    const union = a.size + b.size - inter;
    return union === 0 ? 1 : inter / union;
}

/** 대상에 가까운 순서 — 유사도 ↓, 풍부함 ↓, 마지막으로 안정 정렬. */
function nearestFirst<T extends OverloadDocCandidate>(own: Profile<T>, others: readonly Profile<T>[]): Profile<T>[] {
    return [...others].sort((a, b) =>
        jaccard(own.paramSet, b.paramSet) - jaccard(own.paramSet, a.paramSet)
        || b.richness - a.richness
        || compareStable(a.sym, b.sym));
}

function coverageOf<T extends OverloadDocCandidate>(p: Profile<T>, groupNames: ReadonlySet<string>): number {
    let n = 0;
    for (const name of groupNames) {
        if (p.entries.has(name)) {
            n++;
        }
    }
    return n;
}

/**
 * 공통 설명의 출처 — 요약이 있는 문서 중 **유일하게** 가장 풍부한 것. 풍부함 동률은 커버리지로 가르고,
 * 그래도 동률이면 undefined(공통 설명 없음).
 */
function pickSharedSource<T extends OverloadDocCandidate>(
    profiles: readonly Profile<T>[],
    groupNames: ReadonlySet<string>
): Profile<T> | undefined {
    const scored = profiles
        .filter(p => p.doc && p.doc.summary.trim() !== '')
        .map(p => ({ p, coverage: coverageOf(p, groupNames) }))
        .sort((a, b) => b.p.richness - a.p.richness || b.coverage - a.coverage);
    if (scored.length === 0) {
        return undefined;
    }
    if (scored.length === 1) {
        return scored[0].p;
    }
    const [top, second] = scored;
    const strictlyBetter = top.p.richness > second.p.richness
        || (top.p.richness === second.p.richness && top.coverage > second.coverage);
    return strictlyBetter ? top.p : undefined;
}

function sameReturnType(a: OverloadDocCandidate, b: OverloadDocCandidate): boolean {
    return !!a.returnType && !!b.returnType && lowerOrEmpty(a.returnType) === lowerOrEmpty(b.returnType);
}

function returnsLinesOf<T extends OverloadDocCandidate>(p: Profile<T>): string[] | undefined {
    const lines = p.doc ? findSection(p.doc, 'returns')?.lines : undefined;
    return hasText(lines) ? lines : undefined;
}

// ---------------------------------------------------------------------------
// 병합
// ---------------------------------------------------------------------------

/**
 * 대상 오버로드의 문서를 형제 문서로 보완한다. 규칙은 파일 머리 주석 참조.
 * 자기 주석도 없고 물려받을 것도 없으면 undefined.
 */
export function resolveOverloadDoc<T extends OverloadDocCandidate>(
    target: T,
    siblings: readonly T[]
): ResolvedOverloadDoc | undefined {
    const own = profileOf(target);
    if (siblings.length === 0) {
        return own.doc ? { doc: own.doc, overloadCount: 0 } : undefined;
    }

    const others = siblings.map(profileOf);
    const nearest = nearestFirst(own, others);

    // 출처 기록 — 같은 형제에서 여러 조각을 받으면 한 줄로 묶는다.
    const sources = new Map<string, { sym: T; pieces: string[] }>();
    const credit = (p: Profile<T>, piece: string) => {
        const key = declKey(p.sym);
        const cur = sources.get(key);
        if (cur) {
            cur.pieces.push(piece);
        } else {
            sources.set(key, { sym: p.sym, pieces: [piece] });
        }
    };

    // 자기 설명 — 없으면 가장 닮은 형제의 설명.
    let description: string[] = own.doc ? [...own.doc.description] : [];
    let descriptionFrom: Profile<T> | undefined;
    if (!hasText(description)) {
        const src = nearest.find(p => p.doc && hasText(p.doc.description));
        if (src) {
            description = [...src.doc!.description];
            descriptionFrom = src;
            credit(src, '설명');
        }
    }

    // 공통 설명 — 유일하게 가장 풍부한 문서의 요약. 자기 자신이나 설명을 이미 빌려온 형제면 중복이므로 생략.
    const groupNames = new Set<string>(own.paramSet);
    for (const p of others) {
        for (const n of p.paramSet) {
            groupNames.add(n);
        }
    }
    const shared = pickSharedSource([own, ...others], groupNames);
    let sharedLine: string | undefined;
    if (shared && shared !== own && shared !== descriptionFrom) {
        const summary = shared.doc!.summary;
        const firstOwn = description.find(l => l.trim())?.trim();
        if (summary && summary !== firstOwn) {
            sharedLine = summary;
            credit(shared, '공통 설명');
        }
    }

    // 매개변수 — 시그니처 순서로, 자기 항목(설명 있음) → 형제 항목 → 자기 빈 항목.
    const ownSection = own.doc ? findSection(own.doc, 'parameters') : undefined;
    const ownEntries = new Map<string, DocParamEntry>();
    for (const p of ownSection?.params ?? []) {
        ownEntries.set(p.name.toLowerCase(), p);
    }
    const entries: DocParamEntry[] = [];
    for (const name of own.paramNames) {
        const key = name.toLowerCase();
        const mine = ownEntries.get(key);
        if (mine && mine.text.trim()) {
            entries.push(mine);
            continue;
        }
        const src = nearest.find(p => p.entries.has(key));
        if (src) {
            entries.push({ name: mine?.name ?? name, text: src.entries.get(key)!.text });
            credit(src, `\`${name}\``);
            continue;
        }
        if (mine) {
            entries.push(mine);
        }
    }
    // 시그니처에 없는 자기 항목은 원문대로 남긴다(작성자가 쓴 것을 병합이 지우지 않는다).
    for (const p of ownSection?.params ?? []) {
        if (!own.paramSet.has(p.name.toLowerCase())) {
            entries.push(p);
        }
    }

    // Returns — 자기 것, 없으면 반환 타입이 같은 가장 닮은 형제 것.
    const ownReturns = own.doc ? findSection(own.doc, 'returns') : undefined;
    let returnsLines: string[] = ownReturns?.lines ?? [];
    if (!hasText(returnsLines) && target.returnType) {
        const src = nearest.find(p => sameReturnType(p.sym, target) && returnsLinesOf(p));
        if (src) {
            returnsLines = [...returnsLinesOf(src)!];
            credit(src, SECTION_TITLES.returns);
        }
    }

    if (sources.size === 0) {
        // 물려받은 것이 없다 — 자기 주석 그대로(비오버로드 표시와 동일하게).
        return own.doc ? { doc: own.doc, overloadCount: siblings.length } : undefined;
    }

    // 합성 — 파서가 인식하는 형식으로 다시 써서 parseDocComment 에 넣는다(렌더러·getParamDoc 과 완전히 호환).
    const lines: string[] = [];
    if (sharedLine) {
        lines.push(sharedLine);
    }
    lines.push(...description);
    if (entries.length) {
        lines.push('', `# ${ownSection?.title ?? SECTION_TITLES.parameters}`);
        for (const e of entries) {
            lines.push(e.text ? `- \`${e.name}\`: ${e.text}` : `- \`${e.name}\``);
        }
    }
    if (hasText(returnsLines)) {
        lines.push('', `# ${ownReturns?.title ?? SECTION_TITLES.returns}`, ...returnsLines);
    }
    for (const s of own.doc?.sections ?? []) {
        if (s.kind === 'parameters' || s.kind === 'returns') {
            continue;
        }
        lines.push('', `# ${s.title}`, ...s.lines);
    }

    const parts = Array.from(sources.values())
        .map(({ sym, pieces }) => `\`${shortSignature(sym)}\`: ${pieces.join(', ')}`);
    return {
        doc: parseDocComment(lines.join('\n')),
        overloadCount: siblings.length,
        provenance: `*형제 오버로드에서 가져옴 — ${parts.join(' · ')}*`
    };
}

/** 병합 결과를 호버/자동완성용 마크다운으로 — 본문 뒤에 출처 한 줄을 붙인다. */
export function renderResolvedDocMarkdown(
    resolved: ResolvedOverloadDoc,
    options: DocRenderOptions = {}
): string | undefined {
    const body = renderDocCommentMarkdown(resolved.doc, options);
    if (!body) {
        return undefined;
    }
    return resolved.provenance ? `${body}\n\n${resolved.provenance}` : body;
}

/**
 * 골격 생성·보완용 — 형제 주석이 이미 설명한 매개변수 이름과 Returns 여부.
 * 골격은 이 조각을 빼고 만들어 "차이만 문서화" 를 도구 쪽에서도 지킨다.
 */
export function describeOverloadCoverage<T extends OverloadDocCandidate>(
    target: T,
    siblings: readonly T[]
): OverloadCoverage {
    const own = profileOf(target);
    const others = siblings.map(profileOf);
    const coveredParams = own.paramNames.filter(n => others.some(p => p.entries.has(n.toLowerCase())));
    const coveredReturns = !!target.returnType
        && others.some(p => sameReturnType(p.sym, target) && !!returnsLinesOf(p));
    return { coveredParams, coveredReturns };
}
