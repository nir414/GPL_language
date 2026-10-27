import { GPLParser, GPLSymbol } from '../syntax/gplParser';
import { ciEq } from '../syntax/identifiers';
import {
    extractCallArgumentsFromSuffix,
    extractQualifierChainBefore,
    isTypeNamePosition,
    parseChainSegment,
} from '../syntax/cursorExpression';
import {
    membersNamed,
    ReceiverHolder,
    ReceiverLookup,
    ReceiverSegment,
    resolveReceiverTarget,
} from './receiverType';
import { buildCallContext, CallContext, rankOverloadMatches } from './overloadResolution';
import { containerAt } from './referenceScope';
import { isTypeUsageAt } from './referenceSyntax';
import { formatUsageTargetLog } from './referenceTrace';

/**
 * 참조 찾기의 "대상 선언 복원" — 커서가 선언이 아니라 사용부에 있을 때도 선언에서 실행한 것과 같은 스코프를 얻는다.
 *
 * 심볼 캐시 조회는 `ReferenceSymbolSource`(좁은 읽기 인터페이스)로 받고, 수신자 컨텍스트는 호출부가
 * 지연 조립 함수로 넣어 준다 — vscode 의존 없이 문자열·심볼만으로 돈다. 함수 본문은 provider 시절 그대로다.
 */

/** 참조 대상 복원에 쓰는 심볼 조회(`SymbolCache` 의 부분집합). */
export interface ReferenceSymbolSource {
    findAllByName(name: string): GPLSymbol[];
    findDefinition(name: string, fromFilePath?: string): GPLSymbol | undefined;
    findConstructorInClass(className: string, argCount?: number, preferredFilePath?: string): GPLSymbol | undefined;
    findMemberCandidatesInClass(memberName: string, className: string): GPLSymbol[];
    findMemberCandidatesInModule(memberName: string, moduleName: string): GPLSymbol[];
    isSameCompileUnit(candidateFilePath: string, referenceFilePath: string): boolean;
    findOverloadSiblings(target: GPLSymbol, extra?: readonly GPLSymbol[]): GPLSymbol[];
}

/** 사용부 복원이 쓰는 수신자 컨텍스트(`providers/intellisense/receiverContext.ReceiverContext` 의 부분집합). */
export interface UsageReceiverContext {
    lookup: ReceiverLookup;
    docSymbols: GPLSymbol[];
}

/** 참조 대상 복원 결과 — `precise` 면 오버로드까지 확정된 것(형제 오버로드의 호출·선언을 가를 수 있다). */
export interface RecoveredTarget {
    symbol: GPLSymbol;
    precise: boolean;
}

export function tryGetDefinitionSymbolAtPosition(
    documentText: string,
    documentFsPath: string,
    line: number,
    word: string,
    wordStart: number
): GPLSymbol | undefined {
    try {
        const localSymbols = GPLParser.parseDocument(documentText, documentFsPath);
        const inLine = localSymbols.filter(s => ciEq(s.name, word) && s.line === line);

        // Prefer the symbol whose indexed range covers the cursor.
        const covering = inLine.find(s => {
            const start = Math.max(0, s.range?.start ?? 0);
            const end = Math.max(start, s.range?.end ?? start);
            return wordStart >= start && wordStart <= end;
        });
        if (covering) {
            return covering;
        }

        // Fallback: if there's exactly one symbol with that name on the line, use it.
        if (inLine.length === 1) {
            return inLine[0];
        }

        return undefined;
    } catch {
        return undefined;
    }
}

/**
 * 커서가 정의 라인이 아닌 "호출부"에 있을 때, 캐시에서 정의의 스코프를 복원한다.
 *
 * 보수적으로 동작한다(참조 누락 방지 우선):
 *   - 모듈 레벨 프로시저(Sub/Function, className 없음)만 복원 대상으로 한다.
 *     클래스 멤버는 `With` 블록의 `.member` 같은 비한정 접근을 놓칠 위험이 있어 기존 광역 검색을 유지한다.
 *   - 같은 이름의 프로시저 후보가 여러 모듈/파일에 흩어져 스코프가 모호하면 복원하지 않는다.
 *   - 한정자(qualifier)가 있으면 그 모듈 스코프의 후보를 우선 사용한다.
 *
 * 복원 결과는 public 모듈 멤버에서는 (광역 검색을 유지하므로) 사실상 추가 정보로만 쓰이고,
 * private 모듈 멤버에서는 정의 파일로 검색을 좁혀 오탐(다른 파일의 동명 심볼)을 줄인다.
 */
export function recoverDefinitionScope(
    symbols: ReferenceSymbolSource,
    word: string,
    qualifier: string | undefined,
    documentFsPath: string
): GPLSymbol | undefined {
    const byName = symbols.findAllByName(word)
        .filter(s => s.kind === 'sub' || s.kind === 'function');

    if (byName.length === 0) {
        return undefined;
    }

    // 클래스 멤버가 하나라도 섞여 있으면 복원하지 않는다(광역 검색 유지).
    if (byName.some(s => !!s.className)) {
        return undefined;
    }

    // 한정자가 모듈이면 해당 모듈 후보로 좁힌다.
    let pool = byName;
    if (qualifier) {
        const qSym = symbols.findDefinition(qualifier, documentFsPath);
        if (qSym?.kind === 'module') {
            const inModule = byName.filter(s => s.module && ciEq(s.module, qSym.name));
            if (inModule.length > 0) {
                pool = inModule;
            }
        }
    }

    // 스코프 합의: 남은 후보가 모두 같은 모듈이어야 한다(모호하면 포기).
    const firstModule = pool[0].module || '';
    const sameModule = pool.every(s => (s.module || '') === firstModule);
    if (!sameModule) {
        return undefined;
    }

    // 접근제한자 합의: 하나라도 private면 private로 본다(정의 파일로 좁히는 쪽이 안전).
    const anyPrivate = pool.some(s => s.accessModifier === 'private');
    const chosen = anyPrivate ? (pool.find(s => s.accessModifier === 'private') || pool[0]) : pool[0];
    return chosen;
}

/**
 * `As MachineRobot` / `New MachineRobot(...)`처럼 **타입 이름 사용부**에서 실행했을 때
 * 그 타입 선언(Class/Module)을 캐시에서 복원한다.
 *
 * 이렇게 해야 선언에서 실행하든 사용부에서 실행하든 같은 스코프(정의 파일·모듈·접근제한자)를
 * 쓰고 결과가 일치한다. 복원하지 않으면 사용부 실행은 스코프 없는 이름 전역 검색이 되어
 * 컴파일 단위 기준점이 정의 파일이 아니라 현재 문서가 된다.
 */
export function recoverTypeUsageDeclaration(
    symbols: ReferenceSymbolSource,
    word: string,
    documentFsPath: string,
    lineText: string,
    character: number
): GPLSymbol | undefined {
    if (!isTypeUsageAt(lineText, character)) {
        return undefined;
    }
    const sym = symbols.findDefinition(word, documentFsPath);
    return sym?.kind === 'class' || sym?.kind === 'module' ? sym : undefined;
}

/**
 * 동명 후보(같은 홀더의 오버로드 등) 중 하나를 고른다. 호출 인자로 하나가 확정되면 precise.
 * 후보가 하나뿐이어도 precise 다.
 */
export function pickCandidate(candidates: GPLSymbol[], callCtx: CallContext | undefined): RecoveredTarget | undefined {
    if (candidates.length === 0) {
        return undefined;
    }
    if (candidates.length === 1) {
        return { symbol: candidates[0], precise: true };
    }
    const callable = candidates.filter(s => s.kind === 'sub' || s.kind === 'function');
    if (callable.length > 1 && callCtx && typeof callCtx.argCount === 'number') {
        const ranked = rankOverloadMatches(callable, callCtx);
        return { symbol: ranked[0], precise: ranked.length === 1 };
    }
    return { symbol: callable[0] ?? candidates[0], precise: false };
}

/**
 * 사용부(호출·한정자·한정자 없는 이름)에서 실행했을 때 대상 선언을 GPL 이름 해석으로 복원한다 —
 * 정의 이동(definitionProvider)과 같은 순서다.
 *   - `a.b.Member` → 수신자 체인을 receiverType 으로 풀어 그 홀더의 멤버(`Me.`·변수·Module 한정 포함)
 *   - 한정자 없는 `Name.` → 같은 컴파일 단위의 Module/Class(모듈 먼저 — 한정자 자리의 사용자 의도)
 *   - 한정자 없는 `Name` → 감싸는 클래스 멤버 → 감싸는 모듈 직속 멤버
 * 로컬/파라미터면 undefined(종전 이름 검색 유지). 오버로드는 호출 인자로 고른다.
 */
export function recoverUsageTarget(
    symbols: ReferenceSymbolSource,
    word: string,
    documentFsPath: string,
    line: number,
    lineText: string,
    wordStart: number,
    wordEnd: number,
    receiverContext: () => UsageReceiverContext,
): RecoveredTarget | undefined {
    let rc: UsageReceiverContext;
    try {
        rc = receiverContext();
    } catch {
        return undefined;
    }
    const { lookup, docSymbols } = rc;
    const docPath = documentFsPath;
    const inUnit = (s: GPLSymbol): boolean =>
        s.filePath === docPath || symbols.isSameCompileUnit(s.filePath, docPath);
    const callArgs = extractCallArgumentsFromSuffix(lineText.substring(wordEnd));
    const callCtx = buildCallContext(callArgs, () => lookup);

    const before = lineText.substring(0, wordStart).replace(/\s+$/, '');
    if (before.endsWith('.')) {
        const chainInfo = extractQualifierChainBefore(before.replace(/\s*\.\s*/g, '.'));
        const parsed = chainInfo?.partial === '' ? chainInfo.chain.map(parseChainSegment) : undefined;
        if (!parsed || !parsed.every(s => s !== undefined)) {
            return undefined;
        }
        const target = resolveReceiverTarget(parsed as ReceiverSegment[], lookup);
        if (target?.kind !== 'class' && target?.kind !== 'module') {
            return undefined;
        }
        let members = membersNamed(lookup, target, word).filter(inUnit);
        if (members.length === 0) {
            members = target.kind === 'class'
                ? symbols.findMemberCandidatesInClass(word, target.name)
                : symbols.findMemberCandidatesInModule(word, target.name);
        }
        return pickCandidate(members.filter(inUnit), callCtx);
    }

    if (lookup.findLocal(word)) {
        return undefined;
    }

    if (/^\s*\./.test(lineText.substring(wordEnd))) {
        const holders = lookup.findAllByName(word)
            .filter(s => !s.isLocal && !s.isParameter && (s.kind === 'module' || s.kind === 'class') && inUnit(s))
            .sort((a, b) => (a.kind === 'module' ? 0 : 1) - (b.kind === 'module' ? 0 : 1));
        if (holders.length > 0) {
            return { symbol: holders[0], precise: true };
        }
    }

    const here = containerAt(docSymbols, line);
    const scopes: ReceiverHolder[] = [];
    const className = lookup.enclosingClassName ?? here.className;
    if (className) {
        scopes.push({ kind: 'class', name: className });
    }
    if (here.module) {
        scopes.push({ kind: 'module', name: here.module });
    }
    for (const holder of scopes) {
        const members = membersNamed(lookup, holder, word).filter(inUnit);
        const picked = pickCandidate(members, callCtx);
        if (picked) {
            return picked;
        }
    }
    return undefined;
}

/** 커서 위치 — `resolveReferenceTargetSymbol` 의 입력. */
export interface ReferenceCursor {
    word: string;
    /** `Module.Member` 의 `Module`(없으면 undefined). */
    qualifier: string | undefined;
    documentText: string;
    documentFsPath: string;
    line: number;
    lineText: string;
    wordStart: number;
    wordEnd: number;
}

/**
 * 커서의 대상 선언을 정한다 — 선언 위 → `New X` 생성자 → 타입 사용부 → GPL 이름 해석 → 종전 이름 기반 복원 순.
 * 어느 것도 확정하지 못하면 `defSymbol` 이 undefined 로 남아 이름 기반 광역 검색이 된다.
 * 사용부 복원이 성공하면 `log` 로 한 줄 남긴다.
 */
export function resolveReferenceTargetSymbol(
    symbols: ReferenceSymbolSource,
    cursor: ReferenceCursor,
    receiverContext: () => UsageReceiverContext,
    log: (message: string) => void,
): { defSymbol: GPLSymbol | undefined; defPrecise: boolean } {
    const { word, qualifier, lineText, documentFsPath } = cursor;

    // If cursor is on a definition, capture its module/class scope.
    let defSymbol = tryGetDefinitionSymbolAtPosition(
        cursor.documentText, documentFsPath, cursor.line, word, cursor.wordStart);
    // 오버로드까지 확정됐는지 — 선언 위에서 실행했거나, 호출 인자로 하나가 골라졌을 때.
    let defPrecise = !!defSymbol;

    // 사용부에서 실행한 Find References도 선언에서 실행한 것과 같은 target scope를 가져야 한다.
    // `New ClassName(...)`은 커서 단어(New)만으로는 클래스가 드러나지 않으므로 뒤의 타입을 읽고,
    // `Class.Member` / `Module.Member`는 권위 있는 한정자의 실제 멤버를 바로 선택한다.
    if (!defSymbol && ciEq(word, 'New')) {
        const constructorUse = lineText
            .substring(cursor.wordEnd)
            .match(/^\s+([A-Za-z_]\w*)\b/);
        if (constructorUse) {
            defSymbol = symbols.findConstructorInClass(
                constructorUse[1],
                undefined,
                documentFsPath,
            );
        }
    }
    // 커서가 정의 라인이 아니라 "호출부"에 있는 경우에도 정의의 스코프(module/class/access)를
    // 복원한다. 이렇게 하면 정의에서 실행하든 호출부에서 실행하든 "참조 찾기" 결과가 일관된다.
    // 타입 사용부(`As X`/`New X`) → GPL 이름 해석(수신자 체인·감싸는 클래스/모듈, 정의 이동과 같은 순서)
    // → 종전 이름 기반 복원 순. 어느 것도 확정하지 못하면 기존의 이름 기반 광역 검색으로 남긴다.
    if (!defSymbol) {
        defSymbol = recoverTypeUsageDeclaration(symbols, word, documentFsPath, lineText, cursor.wordStart);
        defPrecise = !!defSymbol;
    }
    if (!defSymbol && !ciEq(word, 'New') && !isTypeNamePosition(lineText, cursor.wordStart)) {
        const recovered = recoverUsageTarget(
            symbols, word, documentFsPath, cursor.line, lineText, cursor.wordStart, cursor.wordEnd, receiverContext);
        if (recovered) {
            defSymbol = recovered.symbol;
            defPrecise = recovered.precise;
            log(formatUsageTargetLog(defSymbol, defPrecise));
        }
    }
    if (!defSymbol) {
        defSymbol = recoverDefinitionScope(symbols, word, qualifier, documentFsPath);
        defPrecise = false;
    }
    return { defSymbol, defPrecise };
}
