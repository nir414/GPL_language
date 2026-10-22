import { GPLSymbol, GPLSymbolKind } from './gplParser';
import { elementTypeOf, isArrayTypeName } from './receiverType';

/**
 * 개요(Outline)·빵 부스러기·`Ctrl+Shift+O`·워크스페이스 심볼(`Ctrl+T`)이 공유하는 **심볼 표현 모델**(vscode 무의존).
 *
 * VS Code 는 심볼의 종류(`SymbolKind`)로 개요 필터(`outline.showMethods` 등)와 `@:` 종류별 묶음을 만들고,
 * `detail` 을 이름 옆에 흐리게 보여 준다. 그래서 여기서 정하는 것은 셋이다.
 *
 * 1. **분류(`OutlineCategory`)** — GPL 심볼을 VS Code 가 이해하는 범주로. `Sub`/`Function` 은 "값을 돌려주는가"의
 *    차이일 뿐 "메서드냐 함수냐"가 아니므로 **클래스 멤버면 method, 모듈 프로시저면 function** 으로 나눈다
 *    (종전엔 Sub→Method·Function→Function 이라 `outline.showMethods` 를 끄면 Sub 만 사라지는 식으로 어긋났다).
 *    모듈·클래스 멤버 변수는 지역 변수가 아니라 **field** 다(개요는 로컬을 싣지 않는다).
 * 2. **detail 문자열** — 시그니처(`(a As Integer) As String`), 타입(`As Integer`), 상수 값(`= 3`),
 *    `Shared`·`ReadOnly`/`WriteOnly`. 동명 오버로드(`Describe` ×3)를 개요·`Ctrl+Shift+O` 에서 구별하게 한다.
 * 3. **계층과 범위** — 모듈 > 클래스 > (중첩 클래스 >) 멤버. 블록 범위는 파서가 기록한 짝 `End` 줄(`endLine`)이
 *    정본이고, 짝이 없을 때(입력 중·End 누락)만 "다음 비-자손 심볼 직전"으로 추정한다 — 종전 폴백은 중첩 클래스를
 *    몰라 형제 범위가 겹쳤다(ai-handoff §1-ED).
 *
 * VS Code `SymbolKind` 로의 변환은 접착 계층 `providers/symbolKinds` 한 곳이 한다(구조 테스트 R7).
 */
export type OutlineCategory =
    | 'module'
    | 'class'
    | 'delegate'
    | 'method'
    | 'function'
    | 'property'
    | 'field'
    | 'constant'
    | 'variable';

/** 여러 줄 범위를 갖는 분류 — 그 외는 선언 줄 한 줄이 범위다. */
const BLOCK_CATEGORIES: ReadonlySet<OutlineCategory> = new Set<OutlineCategory>([
    'module', 'class', 'method', 'function', 'property',
]);

export function isBlockCategory(category: OutlineCategory): boolean {
    return BLOCK_CATEGORIES.has(category);
}

/** GPL 심볼 → 개요 분류. 스코프(클래스 멤버인지)까지 본다. */
export function outlineCategoryOf(symbol: GPLSymbol): OutlineCategory {
    switch (symbol.kind) {
        case GPLSymbolKind.Module: return 'module';
        case GPLSymbolKind.Class: return 'class';
        case GPLSymbolKind.Delegate: return 'delegate';
        case GPLSymbolKind.Function:
        case GPLSymbolKind.Sub:
            return symbol.className ? 'method' : 'function';
        case GPLSymbolKind.Property: return 'property';
        case GPLSymbolKind.Constant: return 'constant';
        case GPLSymbolKind.Variable:
        default:
            return symbol.isLocal || symbol.isParameter ? 'variable' : 'field';
    }
}

/** 파서의 배열 표기(`Integer[]`)를 GPL 표기(`Integer()`)로 되돌린 `As …` 조각. 타입이 없으면 빈 문자열. */
function asTypeClause(typeName: string | undefined): string {
    if (!typeName) { return ''; }
    if (isArrayTypeName(typeName)) {
        return `As ${elementTypeOf(typeName, true) ?? typeName}()`;
    }
    return `As ${typeName}`;
}

/** 파라미터 선언 원문을 개요용으로 줄인다 — 기본값인 `ByVal` 은 지우고 `ByRef` 는 남긴다, 공백은 하나로. */
export function compactParameter(raw: string): string {
    return raw.replace(/^\s*ByVal\s+/i, '').replace(/\s+/g, ' ').trim();
}

function parameterList(symbol: GPLSymbol): string {
    return `(${(symbol.parameters ?? []).map(compactParameter).join(', ')})`;
}

/**
 * 개요·`Ctrl+Shift+O` 에 이름 옆으로 보일 보조 텍스트. 이름은 그대로 두고(필터·검색이 이름으로 맞춘다)
 * 종류를 가르는 정보만 담는다. 모듈·클래스는 비어 있다.
 */
export function symbolDetail(symbol: GPLSymbol): string {
    const parts: string[] = [];
    switch (symbol.kind) {
        case GPLSymbolKind.Module:
        case GPLSymbolKind.Class:
            return '';
        case GPLSymbolKind.Delegate:
            parts.push(symbol.returnType ? 'Delegate Function' : 'Delegate Sub', parameterList(symbol), asTypeClause(symbol.returnType));
            break;
        case GPLSymbolKind.Function:
            if (symbol.isShared) { parts.push('Shared'); }
            parts.push(parameterList(symbol), asTypeClause(symbol.returnType));
            break;
        case GPLSymbolKind.Sub:
            if (symbol.isShared) { parts.push('Shared'); }
            parts.push(parameterList(symbol));
            break;
        case GPLSymbolKind.Property:
            if (symbol.isShared) { parts.push('Shared'); }
            parts.push(asTypeClause(symbol.returnType));
            if (symbol.isReadOnly) { parts.push('(ReadOnly)'); }
            else if (symbol.isWriteOnly) { parts.push('(WriteOnly)'); }
            break;
        case GPLSymbolKind.Constant:
            if (symbol.isShared) { parts.push('Shared'); }
            parts.push(asTypeClause(symbol.returnType));
            if (symbol.value) { parts.push(`= ${symbol.value}`); }
            break;
        case GPLSymbolKind.Variable:
        default:
            if (symbol.isShared) { parts.push('Shared'); }
            parts.push(asTypeClause(symbol.returnType));
            break;
    }
    return parts.filter(Boolean).join(' ');
}

/**
 * 워크스페이스 심볼(`Ctrl+T`) 질의 일치 — 질의 글자가 이름에 **순서대로** 나타나면 통과(대소문자 무시).
 * `rlog` 로 `RegisterLogSink` 를 찾을 수 있게 넓게 거르고, 순위 매기기는 VS Code 의 퍼지 점수에 맡긴다.
 * 종전 `includes` 는 연속 부분 문자열만 받아 VS Code 의 퍼지 검색 기대와 어긋났다.
 */
export function matchesSymbolQuery(name: string, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) { return true; }
    const n = name.toLowerCase();
    let at = 0;
    for (const ch of q) {
        at = n.indexOf(ch, at);
        if (at < 0) { return false; }
        at++;
    }
    return true;
}

export interface OutlineNode {
    name: string;
    detail: string;
    category: OutlineCategory;
    /** 선언 줄(0-기준). */
    line: number;
    /** 범위 끝 줄(0-기준, 포함). 블록이 아니면 `line` 과 같다. */
    endLine: number;
    /** 파서가 짝 `End` 줄을 실제로 기록했으면 true, 추정이면 false. */
    endLineParsed: boolean;
    /** 선언 줄 안의 이름 컬럼 [start, end). 호출부가 줄 길이로 보정한다. */
    nameStart: number;
    nameEnd: number;
    children: OutlineNode[];
    symbol: GPLSymbol;
}

/**
 * 파싱된 심볼 목록(문서 순서)으로 개요 트리를 만든다. `lineCount` 는 범위를 문서 안으로 묶는 데 쓴다.
 *
 * 계층은 파서의 문맥 필드로 정한다 — 클래스는 `parentClassName`(중첩) → `module` → 루트, 멤버는
 * `className` → `module` → 루트. 이름 키라 한 파일 안 동명 클래스는 뒤엣것에 붙는다(발생 사례 없음, §1-ED).
 * 로컬·파라미터 심볼은 개요에 싣지 않는다(옵션을 켜 파싱한 목록이 와도 거른다).
 */
export function buildOutlineTree(symbols: readonly GPLSymbol[], lineCount: number): OutlineNode[] {
    const lastLine = Math.max(0, lineCount - 1);
    const roots: OutlineNode[] = [];
    const modulesByName = new Map<string, OutlineNode>();
    const classesByName = new Map<string, OutlineNode>();

    const attach = (node: OutlineNode, ...candidates: Array<OutlineNode | undefined>): void => {
        const parent = candidates.find(Boolean);
        (parent ? parent.children : roots).push(node);
    };

    for (const symbol of symbols) {
        if (symbol.isLocal || symbol.isParameter) { continue; }
        const category = outlineCategoryOf(symbol);
        const line = Math.max(0, Math.min(symbol.line ?? 0, lastLine));
        const node: OutlineNode = {
            name: symbol.name,
            detail: symbolDetail(symbol),
            category,
            line,
            endLine: line,
            endLineParsed: false,
            nameStart: Math.max(0, symbol.range?.start ?? 0),
            nameEnd: Math.max(0, symbol.range?.end ?? 0),
            children: [],
            symbol,
        };
        if (node.nameEnd < node.nameStart) { node.nameEnd = node.nameStart; }

        if (category === 'module') {
            roots.push(node);
            modulesByName.set(symbol.name, node);
        } else if (category === 'class') {
            attach(node,
                symbol.parentClassName ? classesByName.get(symbol.parentClassName) : undefined,
                symbol.module ? modulesByName.get(symbol.module) : undefined);
            classesByName.set(symbol.name, node);
        } else {
            attach(node,
                symbol.className ? classesByName.get(symbol.className) : undefined,
                symbol.module ? modulesByName.get(symbol.module) : undefined);
        }
    }

    resolveEndLines(roots, lastLine);
    return roots;
}

/**
 * 블록 범위의 끝 줄을 정한다. 파서의 `endLine` 이 있으면 그것, 없으면 전위 순회에서 **다음 비-자손 노드 직전**
 * 까지(없으면 부모 범위 끝 또는 문서 끝). 항상 부모 범위 안에 머물고 선언 줄보다 앞서지 않는다.
 */
function resolveEndLines(roots: OutlineNode[], lastLine: number): void {
    const order: Array<{ node: OutlineNode; depth: number; parent: OutlineNode | undefined }> = [];
    const walk = (nodes: OutlineNode[], depth: number, parent: OutlineNode | undefined): void => {
        for (const n of nodes) {
            order.push({ node: n, depth, parent });
            walk(n.children, depth + 1, n);
        }
    };
    walk(roots, 0, undefined);

    for (let i = 0; i < order.length; i++) {
        const { node, depth, parent } = order[i];
        if (!isBlockCategory(node.category)) {
            node.endLine = node.line;
            continue;
        }
        // 부모가 짝 End 를 가지면 그 End 줄은 부모 몫 — 자식은 그 앞에서 끝난다.
        const cap = parent ? parent.endLine - (parent.endLineParsed ? 1 : 0) : lastLine;
        const parsed = node.symbol.endLine;
        if (typeof parsed === 'number' && parsed >= node.line) {
            node.endLine = Math.max(node.line, Math.min(parsed, lastLine, cap));
            node.endLineParsed = true;
            continue;
        }
        let estimate = cap;
        for (let j = i + 1; j < order.length; j++) {
            if (order[j].depth <= depth) {
                estimate = order[j].node.line - 1;
                break;
            }
        }
        node.endLine = Math.max(node.line, Math.min(estimate, cap, lastLine));
        node.endLineParsed = false;
    }
}
