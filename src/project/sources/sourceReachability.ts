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
 * 자기 선언 가림(shadowing): 파일이 **모듈 직속으로 직접 선언한 이름**(접근성 무관)은 그 파일 안에서 다른 파일을 가리키지 않는다.
 * 이름은 선언된 블록 안에서 먼저 알려지고(Scope of Names
 * https://www2.brooksautomation.com/Controller_Software/Introduction_To_The_Software/Guidance_Programming_Language/scope_names.htm),
 * 같은 파일의 다른 모듈에서 수식 없이 쓰면 모호해 원본이 컴파일되지 않는다 — 다른 파일의 것을 쓰려면 `MOD.NAME` 으로 수식하므로
 * 모듈 이름 낱말이 따로 남는다. 흔한 상수 이름(`POLL_MS`·`ERR_TIMEOUT`)을 모듈마다 따로 두는 코드에서 오포함을 줄인다
 * (Sample Prep: 이것 없이는 `Device_Cylinder` 가 `POLL_MS` 하나로 끌려 들어왔다). 지역 변수·클래스 멤버는 가리는 범위가 좁아 쓰지 않는다.
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
    const words = new Set<string>();
    for (const line of text.split(/\r\n|\n|\r/)) {
        const { code, names } = splitCodeAndNameStrings(stripComment(line));
        for (const piece of [code, ...names]) {
            for (const m of piece.matchAll(WORD)) {
                if (!m[1]) { words.add(m[2].toLowerCase()); }
            }
        }
    }
    return { declared: [...declared], containers, modules, ownNames: [...own], words, hasModuleInit };
}

/**
 * `roots` 에서 출발해 낱말 → 선언 이름으로 닿는 파일 키 집합. 선언 이름이 없는 파일은 늘 포함하고 출발점으로도 쓴다.
 * 같은 이름을 여러 파일이 선언하면 모두 포함한다. 파일 자신이 모듈 직속으로 선언한 이름(`ownNames`)은 그 파일에서는 참조로 보지 않고,
 * 같은 Module 이름을 선언한 파일들은 함께 묶는다(머리말).
 */
export function computeReachableSources(
    files: ReadonlyMap<string, Pick<SourceReferenceInfo, 'declared' | 'words'> & Partial<Pick<SourceReferenceInfo, 'ownNames' | 'modules'>>>,
    roots: Iterable<string>,
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
    const add = (key: string): void => {
        if (!files.has(key) || reach.has(key)) { return; }
        reach.add(key);
        queue.push(key);
        for (const name of files.get(key)!.modules ?? []) {
            for (const sibling of byModule.get(name) ?? []) { add(sibling); }
        }
    };
    for (const key of roots) { add(key); }
    for (const [key, info] of files) {
        if (info.declared.length === 0) { add(key); }
    }
    while (queue.length > 0) {
        const info = files.get(queue.pop()!)!;
        const own = new Set(info.ownNames ?? []);
        for (const word of info.words) {
            if (own.has(word)) { continue; }
            for (const target of byName.get(word) ?? []) { add(target); }
        }
    }
    return reach;
}
