/**
 * 파일 단위 도달성(tree-shaking) 판정 — 실행 프로젝트의 소스에서 출발해 **이름으로 닿는** 라이브러리 파일을 고른다.
 * vscode·fs 무의존 순수 모듈(파일 내용은 호출측이 읽어 넘긴다).
 *
 * 왜: 문서상 라이브러리 프로젝트는 그것을 쓰는 프로젝트마다 통째로 함께 컴파일된다(GDS "GPL Projects"
 * https://www2.brooksautomation.com/Controller_Software/Software_Reference/GDS/Guidance_Development_Environment/gpl_projects.htm).
 * 여러 장비가 함께 쓰는 범용 라이브러리라면 이 장비가 부르지 않는 파일까지 `/GPL` 메모리와 컴파일 결과를 차지한다
 * (Sample Prep: PaL 38개 중 7개 미도달, 2026-11-06 수신함 deploy-preprocess-options).
 *
 * 이름으로 닿는 방법(문서상):
 * - 모든 변수·프로시저는 Module 또는 Class 안에 있다(Module Statement
 *   https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Statement_Dictionary/Module.htm).
 * - 다른 모듈의 Public 항목은 `module_name.item_name` 으로 부르고, **이름이 모든 모듈에서 유일하면 모듈 이름을 생략할 수 있다**
 *   (Modules https://www2.brooksautomation.com/Controller_Software/Introduction_To_The_Software/Guidance_Programming_Language/modules.htm).
 *   그래서 Module·Class 이름만이 아니라 **모듈 직속 멤버 이름**도 선언 이름으로 센다.
 *
 * 판정은 보수적이다(빼면 안 되는 파일을 빼지 않는 쪽):
 * - 낱말 집합으로 본다 — 같은 낱말이 다른 뜻(지역 변수·클래스 멤버)이어도 그 이름을 선언한 파일을 포함한다.
 * - 이름처럼 생긴 문자열(`"FLR.RecorderLoop"`·`"Proc"`)도 참조로 센다 — 진입점을 문자열로 주는 코드가 있다. 자유 문장 속 낱말은 세지 않는다.
 * - 선언 이름을 하나도 찾지 못한 파일(빈 파일·파서가 못 읽은 파일)은 늘 포함하고, 그 파일의 참조도 따라간다.
 * - 같은 Module 이름을 여러 파일이 선언하면(나눠 쓴 모듈) 하나가 닿을 때 모두 포함한다.
 * - 모듈 직속 `Sub Init` 이 있는 파일은 이름 참조 없이도 초기화 때 불리므로 호출측이 늘 출발점으로 삼는다(`hasModuleInit`).
 * - 이름이 실행 중에 조립되는 경우(`"FL" & "R.Loop"`)는 알 수 없다 — 호출측이 고정 포함 목록(keepFiles)으로 보완한다.
 *
 * 지역 가림: **프로시저의 매개변수·지역 변수 이름**은 그 프로시저 안에서 모듈 직속 선언을 가리키지 않는다(선언된 블록 안에서 먼저 알려진다 —
 * Scope of Names). 다른 파일 함수 `CodeText` 가 있을 때 `ByVal codeText As String` 매개변수 하나로 그 파일이 끌려오던 오포함을 막는다
 * (Sample Prep 2026-11-10 `Device_HanyoungML`). 프로시저 범위를 알 수 없으면(짝 `End` 없음) 가리지 않는다 — 보수적이다.
 *
 * 자기 선언 가림(shadowing): 파일이 **모듈 직속으로 직접 선언한 이름**(접근성 무관)은 그 파일 안에서 다른 파일을 가리키지 않는다.
 * 이름은 선언된 블록 안에서 먼저 알려지고(Scope of Names
 * https://www2.brooksautomation.com/Controller_Software/Introduction_To_The_Software/Guidance_Programming_Language/scope_names.htm),
 * 같은 파일의 다른 모듈에서 수식 없이 쓰면 모호해 원본이 컴파일되지 않는다 — 다른 파일의 것을 쓰려면 `MOD.NAME` 으로 수식하므로
 * 모듈 이름 낱말이 따로 남는다. 흔한 상수 이름(`POLL_MS`·`ERR_TIMEOUT`)을 모듈마다 따로 두는 코드에서 오포함을 줄인다
 * (Sample Prep: 이것 없이는 `Device_Cylinder` 가 `POLL_MS` 하나로 끌려 들어왔다). 지역 변수·클래스 멤버는 가리는 범위가 좁아 쓰지 않는다.
 *
 * 타입 자리 낱말은 가리지 않는다: `As`·`New`·`Inherits`·`Implements` 바로 뒤 낱말은 변수가 아니라 타입(또는 그 모듈) 이름이라,
 * 같은 철자의 지역·매개변수·자기 선언이 있어도 늘 참조로 센다(`typeWords`). 대소문자를 가리지 않는 언어라 `Dim motor As Motor`·
 * `ByVal config As Config`·모듈 직속 `Private motor As Motor` 처럼 변수와 타입의 철자가 같은 코드가 흔한데, 가림 규칙이 타입 이름까지
 * 지워 `Class Motor` 파일이 업로드에서 빠졌다(2026-11-13 코드 리뷰에서 발견·재현). 더 넣는 쪽으로만 틀린다.
 */

import { GPLParser, GPLSymbolKind } from '../../language/syntax/gplParser';
import { stripComment } from '../../language/checks/logicalLines';
import { splitCodeAndNameStrings } from './memberScan';

export interface SourceReferenceInfo {
    /** 다른 파일이 이름으로 부를 수 있는 선언 이름(소문자) — Module·Class 이름과 모듈 직속 비-Private 멤버. */
    declared: string[];
    /** Module·Class 이름(원래 대소문자) — 고정 포함 목록의 이름 지정과 보고용. */
    containers: string[];
    /** 이 파일의 Module 이름(소문자) — 같은 모듈을 나눠 쓴 파일끼리 묶는다. */
    modules: string[];
    /** 이 파일이 모듈 직속으로 직접 선언한 이름(소문자, 접근성 무관) — 이 파일의 낱말 중 이것은 다른 파일 참조로 보지 않는다. */
    ownNames: string[];
    /** 주석을 뺀 코드에 나오는 낱말(소문자) — 문자열 리터럴 안 낱말 포함. */
    words: Set<string>;
    /** 타입 자리(`As`·`New`·`Inherits`·`Implements` 바로 뒤) 낱말(소문자) — 지역·자기 선언 가림과 무관하게 늘 참조로 센다. `words` 에도 들어 있다. */
    typeWords: Set<string>;
    /** 낱말(소문자) → 처음 나온 줄(1-기준) — 파일이 남은 이유를 "어디서 불렀나"로 보고할 때 쓴다. */
    wordLines: Map<string, number>;
    /** 모듈 직속 `Sub Init` 이 있는가 — 모듈 초기화 때 이름 참조 없이 자동으로 불리므로(문서상 modules.htm) 이 파일은 늘 남긴다. */
    hasModuleInit: boolean;
}

const MEMBER_KINDS: ReadonlySet<GPLSymbolKind> = new Set([
    GPLSymbolKind.Sub, GPLSymbolKind.Function, GPLSymbolKind.Variable, GPLSymbolKind.Constant,
    GPLSymbolKind.Property, GPLSymbolKind.Delegate,
]);
/**
 * 낱말 — 바로 앞이 `.` 인 낱말(`RWK.ERR_TIMEOUT` 의 `ERR_TIMEOUT`, `obj.Start` 의 `Start`)은 멤버 접근이라 빼고 앞 낱말만 남긴다.
 * 모듈 직속 이름을 수식 없이 부르는 참조는 점 뒤에 올 수 없고, `MOD.NAME` 은 `MOD` 가 그 파일로 이끈다.
 */
const WORD = /(\.\s*)?([A-Za-z_][A-Za-z0-9_]*)/g;
/** 바로 뒤 낱말이 타입(또는 타입을 품은 모듈) 이름인 키워드. */
const TYPE_LEADERS: ReadonlySet<string> = new Set(['as', 'new', 'inherits', 'implements']);

/** 프로시저 하나의 물리 줄 범위(0-기준)와 그 안에서 선언된 매개변수·지역 이름(소문자). */
interface LocalScope { start: number; end: number; names: Set<string> }

/** 짝 `End` 줄이 있는 프로시저마다 매개변수·지역 이름을 모은다. 지역은 프로시저 줄 범위 안의 심볼로 판단한다. */
function procedureLocalScopes(text: string, filePath: string): { scopes: LocalScope[]; declaredAt: Set<string> } {
    const syms = GPLParser.parseDocument(text, filePath, { includeLocals: true, includeParameters: true });
    const scopes: LocalScope[] = [];
    // 선언 줄에 적힌 그 선언의 이름(`Public Function CodeText()`)은 참조가 아니다 — 클래스 멤버 선언이 같은 이름의 모듈 함수 쪽 파일을 끌어오지 않게 한다.
    const declaredAt = new Set<string>();
    for (const sym of syms) { declaredAt.add(`${sym.line}:${sym.name.toLowerCase()}`); }
    for (const sym of syms) {
        if ((sym.kind !== GPLSymbolKind.Sub && sym.kind !== GPLSymbolKind.Function && sym.kind !== GPLSymbolKind.Property)
            || sym.endLine === undefined || sym.isLocal) { continue; }
        scopes.push({ start: sym.line, end: sym.endLine, names: new Set() });
    }
    for (const sym of syms) {
        if (!sym.isLocal) { continue; }
        for (const sc of scopes) {
            if (sym.line >= sc.start && sym.line <= sc.end) { sc.names.add(sym.name.toLowerCase()); }
        }
    }
    return { scopes, declaredAt };
}

/** 파일 하나의 선언 이름과 참조 낱말. `filePath` 는 파서 캐시 키로만 쓴다. */
export function analyzeSourceReferences(text: string, filePath: string): SourceReferenceInfo {
    const declared = new Set<string>();
    const own = new Set<string>();
    const containers: string[] = [];
    const modules: string[] = [];
    let hasModuleInit = false;
    for (const sym of GPLParser.parseDocument(text, filePath)) {
        const name = sym.name.toLowerCase();
        if (sym.kind === GPLSymbolKind.Module || sym.kind === GPLSymbolKind.Class) {
            declared.add(name);
            containers.push(sym.name);
            if (sym.kind === GPLSymbolKind.Module) { modules.push(name); }
            // 모듈과 모듈 직속 클래스만 가린다 — 중첩 클래스는 바깥 클래스 안에서만 알려진다.
            if (sym.kind === GPLSymbolKind.Module || !sym.parentClassName) { own.add(name); }
            continue;
        }
        if (!MEMBER_KINDS.has(sym.kind) || sym.className || sym.isLocal || sym.isParameter) { continue; }
        if (sym.kind === GPLSymbolKind.Sub && name === 'init') { hasModuleInit = true; }
        own.add(name);
        // 모듈 직속(클래스 밖·프로시저 밖) 멤버. 기본 접근성은 Private 이지만 표기가 없으면 포함한다(보수적).
        if (sym.accessModifier !== 'private') { declared.add(name); }
    }
    const { scopes, declaredAt } = procedureLocalScopes(text, filePath);
    const words = new Set<string>();
    const typeWords = new Set<string>();
    const wordLines = new Map<string, number>();
    const lines = text.split(/\r\n|\n|\r/);
    for (let i = 0; i < lines.length; i++) {
        const hidden = scopes.find(sc => i >= sc.start && i <= sc.end)?.names;
        const { code, names } = splitCodeAndNameStrings(stripComment(lines[i]));
        for (const piece of [code, ...names]) {
            // 타입 자리 판정은 코드 조각에서만 한다 — 이름처럼 생긴 문자열 안의 "As"·"New" 는 키워드가 아니다.
            let previous = '';
            for (const m of piece.matchAll(WORD)) {
                const w = m[2].toLowerCase();
                const typePosition = piece === code && !m[1] && TYPE_LEADERS.has(previous);
                previous = m[1] ? '' : w;
                if (m[1]) { continue; }
                if (typePosition) { typeWords.add(w); }
                else if (hidden?.has(w) || declaredAt.has(`${i}:${w}`)) { continue; }
                words.add(w);
                if (!wordLines.has(w)) { wordLines.set(w, i + 1); }
            }
        }
    }
    return { declared: [...declared], containers, modules, ownNames: [...own], words, typeWords, wordLines, hasModuleInit };
}

/** 파일이 닿은 이유 — `name` 은 낱말로 닿은 것(`by` 파일의 `line` 줄), 나머지는 낱말과 무관한 규칙. */
export type ReachReason =
    | { kind: 'root' }
    | { kind: 'no-declarations' }
    | { kind: 'sibling-module'; module: string; via: string }
    | { kind: 'name'; name: string; by: string; line?: number };

/**
 * `roots` 에서 출발해 낱말 → 선언 이름으로 닿는 파일 키 집합. 선언 이름이 없는 파일은 늘 포함하고 출발점으로도 쓴다.
 * 같은 이름을 여러 파일이 선언하면 모두 포함한다. 파일 자신이 모듈 직속으로 선언한 이름(`ownNames`)은 그 파일에서는 참조로 보지 않고,
 * 같은 Module 이름을 선언한 파일들은 함께 묶는다(머리말). `reasons` 를 주면 파일마다 처음 닿은 이유를 채운다.
 */
export function computeReachableSources(
    files: ReadonlyMap<string, Pick<SourceReferenceInfo, 'declared' | 'words'> & Partial<Pick<SourceReferenceInfo, 'ownNames' | 'modules' | 'wordLines' | 'typeWords'>>>,
    roots: Iterable<string>,
    reasons?: Map<string, ReachReason>,
): Set<string> {
    const byName = new Map<string, string[]>();
    const byModule = new Map<string, string[]>();
    const push = (map: Map<string, string[]>, name: string, key: string): void => {
        const list = map.get(name);
        if (list) { list.push(key); } else { map.set(name, [key]); }
    };
    for (const [key, info] of files) {
        for (const name of info.declared) { push(byName, name, key); }
        for (const name of info.modules ?? []) { push(byModule, name, key); }
    }
    const reach = new Set<string>();
    const queue: string[] = [];
    const add = (key: string, why: ReachReason): void => {
        if (!files.has(key) || reach.has(key)) { return; }
        reach.add(key);
        reasons?.set(key, why);
        queue.push(key);
        for (const name of files.get(key)!.modules ?? []) {
            for (const sibling of byModule.get(name) ?? []) { add(sibling, { kind: 'sibling-module', module: name, via: key }); }
        }
    };
    for (const key of roots) { add(key, { kind: 'root' }); }
    for (const [key, info] of files) {
        if (info.declared.length === 0) { add(key, { kind: 'no-declarations' }); }
    }
    while (queue.length > 0) {
        const from = queue.pop()!;
        const info = files.get(from)!;
        const own = new Set(info.ownNames ?? []);
        for (const word of info.words) {
            if (own.has(word) && !info.typeWords?.has(word)) { continue; }
            for (const target of byName.get(word) ?? []) { add(target, { kind: 'name', name: word, by: from, line: info.wordLines?.get(word) }); }
        }
    }
    return reach;
}

/**
 * 소스 전체의 선언 이름(소문자, 클래스 멤버 포함) — "원본 어디에도 선언이 없는 이름"인지 가를 때 쓴다. 못 읽은 파일(`text` undefined)이 있으면
 * 어디에 선언됐는지 말할 수 없으므로 모든 이름을 선언된 것으로 본다(안내를 숨기지 않는 쪽).
 */
export function collectDeclaredNames(files: Iterable<{ file: string; text: string | undefined }>): { has(name: string): boolean } {
    const names = new Set<string>();
    for (const { file, text } of files) {
        if (text === undefined) { return { has: () => true }; }
        for (const sym of GPLParser.parseDocument(text, file)) { names.add(sym.name.toLowerCase()); }
    }
    return names;
}
