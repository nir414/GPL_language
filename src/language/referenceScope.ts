/**
 * 참조 찾기의 **출현 위치 판정** 정본 — vscode 무의존 순수 모듈.
 *
 * 참조 검색은 텍스트 패턴(이름·`X.이름`)으로 후보를 모은 뒤, 여기서 각 출현이 정말 대상 선언을
 * 가리키는지 GPL 이름 해석 규칙으로 거른다. 종전에는 폴백 스캔이 이름만으로 매치해서
 * `Module BRI` 의 `Setup` 참조에 `Module BRM` 의 `Public Sub Setup()` 선언과 `BRM.Setup()` 호출이
 * 섞여 나왔다(2026-10-23 SamplePrep 보고). 호버는 `BRM.Setup → module BRM` 으로 정확히 해석했으니,
 * 참조 쪽도 같은 소속 규칙(receiverType)을 써야 결과가 갈라지지 않는다.
 *
 * 판정 원칙: **확정할 수 없으면 뺀다**(오탐보다 누락이 덜 해롭다는 보고자의 요청). 다만 판정에 필요한
 * 정보가 아예 없으면(대상 스코프 미상) 이 모듈을 부르지 않는다 — 호출부가 종전 이름 검색을 유지한다.
 */
import { GPLSymbol, GPLSymbolKind } from './gplParser';
import { ciEq } from './identifiers';
import { extractQualifierChainBefore, parseChainSegment } from './cursorExpression';
import { enclosingClassName, enclosingModuleName, isDeclaredIn, ReceiverHolder } from './receiverType';

/** 출현을 참조에서 뺀 이유 — verbose 로그에 그대로 찍힌다(오탐 원인 추적용). */
export type ReferenceExclusionReason =
    /** 다른 Module/Class(또는 같은 이름의 다른 종류)에 있는 동명 **선언** */
    | 'other-module-decl'
    /** 감싸는 프로시저의 로컬/파라미터 선언 또는 그것에 가려진 사용 */
    | 'shadowed-by-local'
    /** `X.이름` 의 `X` 가 대상의 컨테이너가 아니다 */
    | 'qualifier-mismatch'
    /** 한정자 없는 사용이 그 자리의 컨테이너(클래스/다른 모듈) 멤버로 해석된다 */
    | 'shadowed-by-member'
    /** 다른 모듈 안의 한정자 없는 사용 — 같은 이름의 모듈 멤버가 여럿이라 어느 것인지 확정할 수 없다 */
    | 'ambiguous-unqualified'
    /** Module 대상인데 `이름.` 꼴(모듈 한정자)이 아니다 */
    | 'not-qualifier-usage'
    /** 호출 인자가 다른 오버로드에 맞는다 */
    | 'overload-mismatch';

export type ReferenceVerdict =
    | { accept: true }
    | { accept: false; reason: ReferenceExclusionReason };

/** 참조 대상 — 정의 심볼에서 판정에 필요한 것만 추린 형태. */
export interface ReferenceTarget {
    name: string;
    kind: GPLSymbolKind | string;
    /** 정의를 감싸는 모듈(Module 심볼 자신이면 undefined — receiverType.enclosingModuleName). */
    module?: string;
    /** 정의를 감싸는 클래스(Class 심볼 자신이면 undefined — receiverType.enclosingClassName). */
    className?: string;
    /**
     * 대상으로 인정할 선언 위치들. 정의 자신과, 오버로드를 확정하지 못했으면 그 형제까지.
     * 이 위치의 선언 토큰은 참조로 남고, 다른 동명 선언은 빠진다.
     */
    declarations: ReadonlyArray<{ filePath: string; line: number }>;
}

/** 출현 하나와 그 파일의 문맥. */
export interface ReferenceOccurrence {
    filePath: string;
    /** 0-기준 줄 */
    line: number;
    lineText: string;
    /** 식별자 시작 열 */
    character: number;
    /** 그 파일의 심볼 — `includeLocals`·`includeParameters` 로 파싱한 것(로컬 가림 판정에 필요). */
    fileSymbols: readonly GPLSymbol[];
}

/** 판정에 쓰는 외부 조회 — 다른 파일에 걸친 모듈/클래스 멤버를 알아야 해서 호출부가 넣어 준다. */
export interface ReferenceScopeLookup {
    /** 비-로컬 심볼 이름 조회(워크스페이스 인덱스). 출현 파일의 심볼은 이 모듈이 따로 합친다. */
    findAllByName(name: string): GPLSymbol[];
    /** 후보 파일이 대상과 같은 컴파일 단위인지. 판정할 수 없으면 true. */
    inUnit(filePath: string): boolean;
    /** 경로 동일성(대소문자·구분자 무시). */
    samePath(a: string, b: string): boolean;
}

const isProcedure = (s: GPLSymbol): boolean =>
    !s.isLocal && !s.isParameter
    && (s.kind === GPLSymbolKind.Sub || s.kind === GPLSymbolKind.Function || s.kind === GPLSymbolKind.Property);

/** 블록 심볼이 줄을 감싸는지. 짝 `End` 를 못 만났으면(입력 중) 파일 끝까지로 본다. */
const covers = (s: GPLSymbol, line: number): boolean =>
    s.line <= line && (s.endLine === undefined || line <= s.endLine);

/**
 * 줄을 감싸는 가장 안쪽 Module·Class. 모듈 밖이면 둘 다 undefined.
 * (클래스 심볼의 `module` 필드가 감싸는 모듈이지만, 모듈 직속 줄이면 클래스가 없으므로 모듈 심볼로 따로 찾는다.)
 */
export function containerAt(
    fileSymbols: readonly GPLSymbol[], line: number,
): { module?: string; className?: string } {
    let cls: GPLSymbol | undefined;
    let mod: GPLSymbol | undefined;
    for (const s of fileSymbols) {
        if (s.isLocal || s.isParameter || !covers(s, line)) { continue; }
        if (s.kind === GPLSymbolKind.Class && (!cls || s.line > cls.line)) { cls = s; }
        if (s.kind === GPLSymbolKind.Module && (!mod || s.line > mod.line)) { mod = s; }
    }
    return { module: mod?.name ?? cls?.module, className: cls?.name };
}

/** 줄을 감싸는 프로시저(Sub/Function/Property). 프로시저 밖이면 undefined. */
export function procedureAt(fileSymbols: readonly GPLSymbol[], line: number): GPLSymbol | undefined {
    let best: GPLSymbol | undefined;
    for (const s of fileSymbols) {
        if (isProcedure(s) && covers(s, line) && (!best || s.line > best.line)) { best = s; }
    }
    return best;
}

/** 출현 위치가 동명 **선언**의 이름 토큰인지 — 그렇다면 그 심볼. */
export function declarationAt(
    fileSymbols: readonly GPLSymbol[], name: string, line: number, character: number,
): GPLSymbol | undefined {
    const onLine = fileSymbols.filter(s => s.line === line && ciEq(s.name, name));
    if (onLine.length === 0) { return undefined; }
    const covering = onLine.find(s => s.range && character >= s.range.start && character <= Math.max(s.range.start, s.range.end));
    if (covering) { return covering; }
    // 파서 range 가 없거나 어긋난 경우: 그 줄의 첫 동명 토큰만 선언으로 본다(호출부 shouldSkipAsDeclaration 과 같은 근사).
    return onLine.length === 1 && !onLine[0].range ? onLine[0] : undefined;
}

/**
 * 식별자 앞의 한정자 체인. `BRM.Setup` → `{ qualified: true, chain: ['BRM'] }`, `Setup` → `{ qualified: false }`.
 * 점은 있는데 체인을 읽을 수 없으면(`With` 블록의 `.Setup`, 문자열 연결 등) `chain` 없이 qualified 만 참이다.
 */
export function qualifierAt(lineText: string, character: number): { qualified: boolean; chain?: string[] } {
    const before = lineText.slice(0, character).replace(/\s+$/, '');
    if (!before.endsWith('.')) { return { qualified: false }; }
    const normalized = before.replace(/\s*\.\s*/g, '.');
    const info = extractQualifierChainBefore(normalized);
    return info && info.partial === '' ? { qualified: true, chain: info.chain } : { qualified: true };
}

/** 출현 파일 심볼 + 워크스페이스 인덱스를 합친 조회(같은 선언 중복 제거). 판정 한 번 안에서는 이름별로 한 번만 모은다. */
function mergedFindAll(occ: ReferenceOccurrence, lookup: ReferenceScopeLookup): (name: string) => GPLSymbol[] {
    const memo = new Map<string, GPLSymbol[]>();
    return (name: string) => {
        const nameKey = name.toLowerCase();
        const hit = memo.get(nameKey);
        if (hit) { return hit; }
        const seen = new Set<string>();
        const out: GPLSymbol[] = [];
        const fromFile = occ.fileSymbols.filter(s => !s.isLocal && !s.isParameter && ciEq(s.name, name));
        for (const s of [...fromFile, ...lookup.findAllByName(name)]) {
            const key = `${s.filePath}:${s.line}:${s.kind}`.toLowerCase();
            if (seen.has(key)) { continue; }
            seen.add(key);
            out.push(s);
        }
        memo.set(nameKey, out);
        return out;
    };
}

/** 홀더에 직접 선언된 동명 멤버(타입 선언 제외)가 있는지. */
function holderDeclares(findAll: (name: string) => GPLSymbol[], holder: ReceiverHolder, name: string): boolean {
    return findAll(name).some(s => !s.isLocal && !s.isParameter
        && s.kind !== GPLSymbolKind.Class && s.kind !== GPLSymbolKind.Module
        && isDeclaredIn(s, holder));
}

/** 출현이 감싸는 프로시저의 로컬/파라미터에 가려지는지. */
function shadowedByLocal(occ: ReferenceOccurrence, name: string): boolean {
    const proc = procedureAt(occ.fileSymbols, occ.line);
    if (!proc) { return false; }
    return occ.fileSymbols.some(s => (s.isLocal || s.isParameter) && ciEq(s.name, name)
        && s.line >= proc.line && (proc.endLine === undefined || s.line <= proc.endLine));
}

/** 출현 바로 뒤가 멤버 접근 `.` 인지(모듈 한정자 자리). */
function followedByDot(occ: ReferenceOccurrence, name: string): boolean {
    return /^\s*\./.test(occ.lineText.slice(occ.character + name.length));
}

const isTargetDeclaration = (target: ReferenceTarget, occ: ReferenceOccurrence, lookup: ReferenceScopeLookup): boolean =>
    target.declarations.some(d => d.line === occ.line && lookup.samePath(d.filePath, occ.filePath));

/**
 * 출현 하나가 대상의 참조인지 판정한다.
 *
 * - 선언 토큰: 대상 선언(정의 자신·미확정 오버로드 형제)만 남기고, 다른 컨테이너의 동명 선언과 로컬 선언은 뺀다.
 * - Module 직속 멤버: `X.이름` 은 `X` 가 정의 모듈일 때만, 한정자 없는 `이름` 은 GPL 이름 해석대로 —
 *   로컬 → 감싸는 클래스 멤버 → 감싸는 모듈 멤버 → (다른 모듈이면) 유일한 모듈 멤버.
 * - Module 자체: `이름.` 꼴(모듈 한정자)만. 클래스 멤버 `Num()` 같은 동명 호출은 뺀다.
 * - Class 멤버: 한정자 판정은 호출부의 수신자 규칙이 맡고, 여기서는 선언·로컬 가림·다른 클래스의 동명 멤버 가림만 본다.
 * - 그 밖(Class 타입 등)은 선언 규칙만 적용한다.
 */
export function classifyReferenceOccurrence(
    target: ReferenceTarget,
    occ: ReferenceOccurrence,
    lookup: ReferenceScopeLookup,
): ReferenceVerdict {
    const name = target.name;
    const findAll = mergedFindAll(occ, lookup);

    const decl = declarationAt(occ.fileSymbols, name, occ.line, occ.character);
    if (decl) {
        if (isTargetDeclaration(target, occ, lookup)) { return { accept: true }; }
        if (decl.isLocal || decl.isParameter) { return { accept: false, reason: 'shadowed-by-local' }; }
        // 같은 모듈이 여러 파일에 나뉘어 선언된 경우(`Module NUM` 이 두 파일) — 모듈 대상이면 같은 모듈이다.
        if (target.kind === GPLSymbolKind.Module && decl.kind === GPLSymbolKind.Module) { return { accept: true }; }
        // 같은 컨테이너의 동명 선언 = 확정된 대상의 다른 오버로드
        const sameContainer = ciEq(enclosingModuleName(decl) ?? '', target.module ?? '')
            && ciEq(enclosingClassName(decl) ?? '', target.className ?? '');
        return { accept: false, reason: sameContainer && target.kind !== GPLSymbolKind.Module ? 'overload-mismatch' : 'other-module-decl' };
    }

    const q = qualifierAt(occ.lineText, occ.character);

    if (target.kind === GPLSymbolKind.Module) {
        if (q.qualified) { return { accept: false, reason: 'qualifier-mismatch' }; }
        if (shadowedByLocal(occ, name)) { return { accept: false, reason: 'shadowed-by-local' }; }
        return followedByDot(occ, name) ? { accept: true } : { accept: false, reason: 'not-qualifier-usage' };
    }

    if (target.className) {
        if (q.qualified) { return { accept: true }; } // 수신자 판정은 호출부(shouldAcceptByMemberScope) 몫
        if (shadowedByLocal(occ, name)) { return { accept: false, reason: 'shadowed-by-local' }; }
        const here = containerAt(occ.fileSymbols, occ.line);
        if (here.className && !ciEq(here.className, target.className)
            && holderDeclares(findAll, { kind: 'class', name: here.className }, name)) {
            return { accept: false, reason: 'shadowed-by-member' };
        }
        return { accept: true };
    }

    if (target.module) {
        if (q.qualified) {
            const first = q.chain?.length === 1 ? parseChainSegment(q.chain[0]) : undefined;
            return first && first.args === undefined && ciEq(first.name, target.module)
                ? { accept: true }
                : { accept: false, reason: 'qualifier-mismatch' };
        }
        if (shadowedByLocal(occ, name)) { return { accept: false, reason: 'shadowed-by-local' }; }
        const here = containerAt(occ.fileSymbols, occ.line);
        if (here.className && holderDeclares(findAll, { kind: 'class', name: here.className }, name)) {
            return { accept: false, reason: 'shadowed-by-member' };
        }
        if (here.module && ciEq(here.module, target.module)) { return { accept: true }; }
        if (here.module && holderDeclares(findAll, { kind: 'module', name: here.module }, name)) {
            return { accept: false, reason: 'shadowed-by-member' };
        }
        // 다른 모듈의 한정자 없는 사용 — 같은 컴파일 단위에 같은 이름의 다른 모듈 멤버가 있으면 확정할 수 없다.
        const competing = findAll(name).some(s => !s.isLocal && !s.isParameter
            && enclosingClassName(s) === undefined
            && s.kind !== GPLSymbolKind.Module && s.kind !== GPLSymbolKind.Class
            && !!enclosingModuleName(s) && !ciEq(enclosingModuleName(s)!, target.module!)
            && lookup.inUnit(s.filePath));
        return competing ? { accept: false, reason: 'ambiguous-unqualified' } : { accept: true };
    }

    return { accept: true };
}
