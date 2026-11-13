import { GPLParser, GPLSymbol } from '../syntax/gplParser';
import { ciEq } from '../syntax/identifiers';
import {
    enclosingClassName,
    enclosingModuleName,
    ReceiverLookup,
} from './receiverType';
import { escapeRegExp, extractCallArgumentsFromSuffix, isInCommentOrString } from '../syntax/cursorExpression';
import { buildConstructorUsagePattern, isSymbolicStringReferenceAt } from './referenceSyntax';
import { buildCallContext, isOverloadSelected } from './overloadResolution';
import {
    classifyReferenceOccurrence,
    declarationAt,
    ReferenceExclusionReason,
    ReferenceTarget,
} from './referenceScope';
import { normalizePathKey } from '../../util/pathKey';
import {
    buildAnyQualifierPattern,
    buildQualifiedMemberPattern,
    computeLineStarts,
    isQualifiedAt,
    isStatementLeadingAssignmentLHS,
    memberOffsetInMatch,
    physicalLineText,
    shouldAcceptByMemberScope,
} from './referenceCandidates';
import { ReferenceSymbolSource } from './referenceTarget';
import { OccurrenceTrace } from './referenceTrace';

/**
 * 참조 찾기의 검색 계획과 출현 스캔 — 어떤 패턴을 어떤 순서로 돌리고, 걸린 출현을 어떻게 가려 모으는지.
 *
 * vscode 에 의존하지 않는다: 파일은 `{ fsPath, uriKey, text }`, 결과는 `ReferenceSite`(평문 좌표)로 주고받고,
 * provider 가 Uri·Location 으로 바꾼다. 같은 스캔이 현재 문서·워크스페이스 검색 결과·프로젝트 폴백에 공유된다.
 * 함수 본문은 provider 시절 그대로다(동작 동일성은 `referenceScan.test` 의 고정 표본이 지킨다).
 */

/** 스캔 한 줄 길이 상한 — 비정상적으로 긴(생성·압축) 라인은 스캔에서 제외한다. */
export const MAX_SCAN_LINE_LENGTH = 5000;

/** 검색 계획 — 커서의 대상 선언에서 파생된, 패턴 선택에 필요한 모든 사실. */
export interface ReferenceSearchPlan {
    word: string;
    qualifier: string | undefined;
    defSymbol: GPLSymbol | undefined;
    /** 오버로드까지 확정됐는지. */
    defPrecise: boolean;
    targetFilePath: string | undefined;
    targetModule: string | undefined;
    targetClass: string | undefined;
    targetAccess: string | undefined;
    escapedWord: string;
    escapedQualifier: string | undefined;
    escapedModule: string | undefined;
    escapedClass: string | undefined;
    isConstructorTarget: boolean;
    constructorPattern: string | undefined;
    anyQualifierPattern: string;
    unqualifiedPattern: string;
    isClassMember: boolean;
    shouldRestrictUnqualifiedToDefFile: boolean;
    /** 출현 판정(referenceScope)을 적용할 대상 — 없으면 종전 규칙. */
    scopeTarget: ReferenceTarget | undefined;
    overloadSiblings: GPLSymbol[];
    shouldPreferQualifiedOnly: boolean;
    shouldAlsoSearchModuleQualified: boolean;
    shouldAlsoSearchClassQualified: boolean;
    isCallableTarget: boolean;
    overloadFilterOn: boolean;
}

export interface ReferencePlanInput {
    word: string;
    qualifier: string | undefined;
    defSymbol: GPLSymbol | undefined;
    defPrecise: boolean;
    documentText: string;
    documentFsPath: string;
}

/** 대상 선언에서 검색 계획을 만든다(스코프 규칙·패턴 선택 플래그). */
export function buildReferenceSearchPlan(symbols: ReferenceSymbolSource, input: ReferencePlanInput): ReferenceSearchPlan {
    const { word, qualifier, defSymbol, defPrecise } = input;

    // We only treat qualifiers as authoritative when they resolve to a Module or Class symbol.
    const qualifierSymbol = qualifier
        ? symbols.findDefinition(qualifier, input.documentFsPath)
        : undefined;
    const isAuthoritativeQualifier = qualifierSymbol?.kind === 'module' || qualifierSymbol?.kind === 'class';

    const targetFilePath = defSymbol?.filePath;
    // 소속(스코프)은 공용 정본(receiverType)으로 구한다. 파서는 Class/Module 심볼의
    // `className`/`module`에 **자기 이름**을 넣으므로(자기-참조 필드), 그대로 읽으면
    // `Class MachineRobot` 선언이 "MachineRobot 클래스의 멤버"로 분류된다.
    // 그러면 비한정 검색이 정의 파일 안으로 묶이고 다른 파일의 `As MachineRobot`·
    // `New MachineRobot(...)`이 통째로 빠진다(2026-09-22 확인).
    const targetModule = defSymbol ? enclosingModuleName(defSymbol) : undefined;
    const targetClass = defSymbol ? enclosingClassName(defSymbol) : undefined;
    const targetAccess = defSymbol?.accessModifier;

    // Scope-aware search strategy:
    // - If cursor is on Module.Member (qualified), search ONLY for that qualified pattern.
    // - If cursor is on a module-level definition (e.g., Private Sub X), search:
    //   - unqualified "X" only within the defining file (to avoid mixing other modules)
    //   - qualified "Module.X" across the workspace for external callers
    // - Otherwise (ambiguous), fall back to name-only search.

    const escapedWord = escapeRegExp(word);
    const escapedQualifier = qualifier ? escapeRegExp(qualifier) : undefined;
    const escapedModule = targetModule ? escapeRegExp(targetModule) : undefined;
    const escapedClass = targetClass ? escapeRegExp(targetClass) : undefined;

    // 생성자는 선언 이름(`Sub New`)과 사용 문법(`New ClassName(...)`)이 다르다.
    // 일반 class member의 `.New` 검색으로 보내지 않고 클래스 이름까지 포함한
    // 전용 패턴을 세 검색 경로가 함께 사용한다.
    const isConstructorTarget = defSymbol?.kind === 'sub'
        && ciEq(word, 'New')
        && !!targetClass;
    const constructorPattern = isConstructorTarget && targetClass
        ? buildConstructorUsagePattern(targetClass)
        : undefined;

    const anyQualifierPattern = buildAnyQualifierPattern(escapedWord);
    const unqualifiedPattern = `\\b${escapedWord}\\b`;

    const isClassMember = !!targetClass;

    const isModuleLevelMember = !!targetModule && !targetClass;
    const isPrivateModuleLevelMember = isModuleLevelMember && targetAccess === 'private';

    // Scoping rules (GPL/VB-style):
    // - Class members are commonly referenced via instance-qualified syntax across files,
    //   but unqualified matches for the member name are often only meaningful within the class/defining file.
    // - Module members are effectively global; *public* module procedures are frequently called unqualified
    //   from other files, so restricting to the defining file causes false negatives.
    // - Private module-level members, however, should remain file-local.
    // - Type declarations (Class/Module) are referenced by their bare name across files
    //   (`As MachineRobot`, `New MachineRobot(...)`), so they follow the module-level rules —
    //   enclosingClassName()이 자기 이름을 돌려주지 않으므로 여기서 자동으로 그렇게 된다.
    const shouldRestrictUnqualifiedToDefFile =
        !!targetFilePath && (isClassMember || isPrivateModuleLevelMember);

    // 출현 판정(referenceScope)을 적용할 대상 — 소속이 확정된 Module 직속 멤버·Class 멤버·Module 자체.
    // 생성자·로컬·타입 선언(Class/Delegate — `As X`·`New X` 는 멤버 이름 해석과 규칙이 다르다)은
    // 종전 규칙(전용 패턴·이름 검색)을 그대로 쓴다.
    const isConstructorWord = defSymbol?.kind === 'sub' && ciEq(word, 'New');
    const isTypeDeclaration = defSymbol?.kind === 'class' || defSymbol?.kind === 'delegate';
    const scopeTarget: ReferenceTarget | undefined = defSymbol && !defSymbol.isLocal && !defSymbol.isParameter
        && !isConstructorWord && !isTypeDeclaration
        && (!!targetModule || !!targetClass || defSymbol.kind === 'module')
        ? {
            name: defSymbol.name,
            kind: defSymbol.kind,
            module: targetModule,
            className: targetClass,
            declarations: [],
        }
        : undefined;
    // 오버로드 형제 — 확정 못 했으면 형제 선언도 대상으로 인정하고(빼면 누락), 확정했으면 호출 인자로 가른다.
    let overloadSiblings: GPLSymbol[] = [];
    if (scopeTarget && defSymbol && (defSymbol.kind === 'sub' || defSymbol.kind === 'function')) {
        try {
            overloadSiblings = symbols.findOverloadSiblings(
                defSymbol, GPLParser.parseDocument(input.documentText, input.documentFsPath));
        } catch {
            overloadSiblings = [];
        }
    }
    if (scopeTarget && defSymbol) {
        scopeTarget.declarations = [defSymbol, ...(defPrecise ? [] : overloadSiblings)];
    }

    // 대상이 확정되면 사용부(`BRI.Setup`)에서 실행해도 선언에서 실행한 것과 같은 범위를 찾는다 —
    // 한정 패턴만 찾으면 정의 모듈 안의 한정자 없는 호출을 놓친다. 오탐은 출현 판정이 거른다.
    const shouldPreferQualifiedOnly = !!escapedQualifier && isAuthoritativeQualifier && !scopeTarget;
    const shouldAlsoSearchModuleQualified = !shouldPreferQualifiedOnly && !!escapedModule && !targetClass;
    const shouldAlsoSearchClassQualified = !shouldPreferQualifiedOnly && !!escapedClass && !!targetClass;

    const isCallableTarget = defSymbol?.kind === 'sub' || defSymbol?.kind === 'function';
    const overloadFilterOn = !!scopeTarget && defPrecise && isCallableTarget && overloadSiblings.length > 0;

    return {
        word, qualifier, defSymbol, defPrecise,
        targetFilePath, targetModule, targetClass, targetAccess,
        escapedWord, escapedQualifier, escapedModule, escapedClass,
        isConstructorTarget, constructorPattern, anyQualifierPattern, unqualifiedPattern,
        isClassMember, shouldRestrictUnqualifiedToDefFile,
        scopeTarget, overloadSiblings,
        shouldPreferQualifiedOnly, shouldAlsoSearchModuleQualified, shouldAlsoSearchClassQualified,
        isCallableTarget, overloadFilterOn,
    };
}

/** 스캔 한 단계 — 정규식 source(대소문자 무시·전역)와 한정자 없는 출현만 볼지. */
export interface ScanStep {
    pattern: string;
    unqualifiedOnly?: boolean;
}

/**
 * 파일 하나를 스캔할 단계 목록(순서가 곧 결과 순서다).
 *   - `local`: 현재 문서(워크스페이스 밖 파일도 덮는다) — 한정자 없는 정의 파일 스캔이 인스턴스 한정 스캔보다 먼저.
 *   - `fallback`: 프로젝트 범위 폴백 — 인스턴스 한정 스캔이 한정자 없는 스캔보다 먼저.
 * `isTargetFile` 은 그 파일이 정의 파일인지.
 */
export function planFileScan(plan: ReferenceSearchPlan, phase: 'local' | 'fallback', isTargetFile: boolean): ScanStep[] {
    const steps: ScanStep[] = [];
    if (plan.isConstructorTarget && plan.constructorPattern) {
        steps.push({ pattern: plan.constructorPattern });
        return steps;
    }
    if (plan.shouldPreferQualifiedOnly && plan.escapedQualifier) {
        steps.push({ pattern: buildQualifiedMemberPattern(plan.escapedQualifier, plan.escapedWord) });
        return steps;
    }
    if (plan.shouldAlsoSearchModuleQualified && plan.escapedModule) {
        steps.push({ pattern: buildQualifiedMemberPattern(plan.escapedModule, plan.escapedWord) });
    }
    if (plan.shouldAlsoSearchClassQualified && plan.escapedClass) {
        steps.push({ pattern: buildQualifiedMemberPattern(plan.escapedClass, plan.escapedWord) });
    }
    if (phase === 'local') {
        if (plan.shouldRestrictUnqualifiedToDefFile && plan.targetFilePath && isTargetFile) {
            steps.push({ pattern: plan.unqualifiedPattern, unqualifiedOnly: true });
        }
        if (plan.isClassMember) {
            // For class members, instance-qualified usages are the common cross-file pattern.
            steps.push({ pattern: plan.anyQualifierPattern });
        }
        if (!plan.shouldRestrictUnqualifiedToDefFile && !plan.isClassMember) {
            steps.push({ pattern: plan.unqualifiedPattern, unqualifiedOnly: false });
        }
        return steps;
    }
    if (plan.isClassMember) {
        steps.push({ pattern: plan.anyQualifierPattern });
    }
    // Unqualified scans: follow the same restriction rules.
    if (plan.shouldRestrictUnqualifiedToDefFile && plan.targetFilePath) {
        if (isTargetFile) {
            steps.push({ pattern: plan.unqualifiedPattern, unqualifiedOnly: true });
        }
    } else if (!plan.isClassMember) {
        steps.push({ pattern: plan.unqualifiedPattern, unqualifiedOnly: false });
    }
    return steps;
}

/**
 * 워크스페이스 텍스트 검색(ripgrep)에 보낼 질의 목록(순서 고정). `private` 대상은 호출부가 검색 자체를 건너뛴다.
 */
export function planWorkspaceQueries(plan: ReferenceSearchPlan): ScanStep[] {
    const queries: ScanStep[] = [];
    if (plan.isConstructorTarget && plan.constructorPattern) {
        queries.push({ pattern: plan.constructorPattern });
    } else if (plan.shouldPreferQualifiedOnly && plan.escapedQualifier) {
        queries.push({ pattern: buildQualifiedMemberPattern(plan.escapedQualifier, plan.escapedWord) });
    } else {
        // 1) Scope-aware qualified patterns
        if (plan.shouldAlsoSearchModuleQualified && plan.escapedModule) {
            queries.push({ pattern: buildQualifiedMemberPattern(plan.escapedModule, plan.escapedWord) });
        }
        if (plan.shouldAlsoSearchClassQualified && plan.escapedClass) {
            queries.push({ pattern: buildQualifiedMemberPattern(plan.escapedClass, plan.escapedWord) });
        }

        // 2) Class member: instance-qualified pattern across workspace
        if (plan.isClassMember) {
            queries.push({ pattern: plan.anyQualifierPattern });
        }

        // 3) Unqualified pattern, restricted to defining file when scope is known
        if (plan.shouldRestrictUnqualifiedToDefFile && plan.targetFilePath) {
            queries.push({ pattern: plan.unqualifiedPattern, unqualifiedOnly: true });
        } else if (!plan.isClassMember) {
            // Ambiguous: name-only scan (older behavior)
            queries.push({ pattern: plan.unqualifiedPattern, unqualifiedOnly: false });
        }
    }
    return queries;
}

/** 스캔 대상 파일 — `uriKey` 는 호출부의 Uri 문자열 표현(중복 제거 키). */
export interface ScanFile {
    fsPath: string;
    uriKey: string;
    text: string;
}

/** 참조 하나의 평문 좌표(0-기준). */
export interface ReferenceSite {
    uriKey: string;
    fsPath: string;
    startLine: number;
    startCharacter: number;
    endLine: number;
    endCharacter: number;
}

export interface ReferenceScanDeps {
    symbols: ReferenceSymbolSource;
    includeDeclaration: boolean;
    /** 커서가 있는 문서의 경로(정의 파일이 없을 때 컴파일 단위 기준점). */
    documentFsPath: string;
    /** 열지 않은 파일의 줄 배열로 수신자 조회를 만든다(`buildReceiverContextFromText(...).lookup`). */
    receiverLookupFromText(
        lines: readonly string[], fsPath: string, line: number,
        findAllByName: (name: string) => GPLSymbol[], docSymbols: GPLSymbol[],
    ): ReceiverLookup;
    log(message: string): void;
    isCancelled(): boolean;
}

/**
 * 한 번의 참조 찾기 동안의 출현 판정·수집 상태 — 중복 제거 장부, 파일별 파싱 캐시, 판정 로그 장부.
 * 스캔 경로(현재 문서·워크스페이스 검색 결과·폴백)가 모두 같은 `addIfAccepted` 한 관문을 지난다.
 */
export class ReferenceScanSession {
    readonly sites: ReferenceSite[] = [];
    readonly trace: OccurrenceTrace;
    private readonly seen = new Set<string>();
    private readonly fileContexts = new Map<string, { symbols: GPLSymbol[]; lines?: string[] }>();
    private readonly symbolicStringContainers: string[];
    private readonly unitReference: string;

    constructor(readonly plan: ReferenceSearchPlan, private readonly deps: ReferenceScanDeps) {
        this.trace = new OccurrenceTrace(deps.log);
        this.symbolicStringContainers = plan.targetClass
            ? [plan.targetClass]
            : plan.targetModule
                ? [plan.targetModule]
                : [];
        this.unitReference = plan.targetFilePath ?? deps.documentFsPath;
    }

    /**
     * 결과를 정의가 속한 컴파일 단위(프로젝트 + ProjectLibrary 관계) 밖으로 흘리지 않는다.
     * 워크스페이스를 프로젝트 상위 폴더에서 열면(`…/projects/GPL_Code` 여러 벌) 다른 과제
     * 프로젝트의 동명 심볼이 그대로 참조 결과에 섞인다. 단위를 판정할 수 없으면 걸러내지 않는다.
     */
    inCompileUnit(fsPath: string): boolean {
        return fsPath === this.unitReference || this.deps.symbols.isSameCompileUnit(fsPath, this.unitReference);
    }

    /** 중복이 아니면 장부에 올리고 true. */
    addSite(site: ReferenceSite): boolean {
        const key = `${site.uriKey}:${site.startLine}:${site.startCharacter}:${site.endLine}:${site.endCharacter}`;
        if (this.seen.has(key)) {
            return false;
        }
        this.seen.add(key);
        this.sites.push(site);
        return true;
    }

    hasNonDocumentSites(): boolean {
        return this.sites.some(s => s.fsPath !== this.deps.documentFsPath);
    }

    /**
     * 생성자 검색 패턴은 선언 줄(`Sub New`) 자체와 일치하지 않는다.
     * includeDeclaration 요청일 때만 정확한 파서 range로 선언 위치를 돌려준다(호출부가 장부에 올린다).
     */
    constructorDeclarationRange(): { fsPath: string; line: number; start: number; end: number } | undefined {
        const { plan } = this;
        const defSymbol = plan.defSymbol;
        if (!(plan.isConstructorTarget && this.deps.includeDeclaration && defSymbol)) {
            return undefined;
        }
        const start = Math.max(0, defSymbol.range?.start ?? 0);
        const end = Math.max(start + plan.word.length, defSymbol.range?.end ?? start + plan.word.length);
        return { fsPath: defSymbol.filePath, line: defSymbol.line, start, end };
    }

    private shouldAcceptOccurrence(fsPath: string, line: string, character: number): boolean {
        const { plan } = this;
        if (!isInCommentOrString(line, character)) {
            return true;
        }
        if (!plan.isCallableTarget || plan.isConstructorTarget) {
            return false;
        }

        // Class 멤버의 단독 `"Proc"` 표기는 정의 파일 안에서만 허용한다.
        // `"Class.Proc"` / `"Module.Proc"`는 컨테이너까지 일치해야 한다.
        const allowUnqualified = !plan.targetClass
            || (!!plan.targetFilePath && fsPath === plan.targetFilePath);
        return isSymbolicStringReferenceAt(line, character, {
            name: plan.word,
            containerNames: this.symbolicStringContainers,
            allowUnqualified,
        });
    }

    private shouldSkipAsDeclaration(fsPath: string, line: number, character: number, lineText: string): boolean {
        const { plan } = this;
        const defSymbol = plan.defSymbol;
        if (this.deps.includeDeclaration) {
            return false;
        }
        if (!defSymbol) {
            return false;
        }
        if (fsPath !== defSymbol.filePath) {
            return false;
        }
        if (line !== defSymbol.line) {
            return false;
        }

        // Best-effort: skip the first occurrence of the word on the defining line.
        const firstIdx = lineText.toLowerCase().indexOf(plan.word.toLowerCase());
        if (firstIdx < 0) {
            return false;
        }
        return character === firstIdx;
    }

    // ── 출현 판정(GPL 이름 해석) ────────────────────────────────────────────────────────
    // 텍스트 패턴은 이름만 본다. 여기서 각 출현이 정말 대상 선언을 가리키는지 referenceScope 로 거른다 —
    // 다른 모듈의 동명 선언(`Module BRM` 의 `Setup`), 다른 한정자(`BRM.Setup`), 그 자리의 멤버/로컬에 가려진
    // 한정자 없는 사용, 다른 오버로드에 맞는 호출을 뺀다(2026-10-23 SamplePrep 보고).
    private fileContextOf(fsPath: string, text: string) {
        const key = normalizePathKey(fsPath);
        let entry = this.fileContexts.get(key);
        if (!entry) {
            let symbols: GPLSymbol[];
            try {
                symbols = GPLParser.parseDocument(text, fsPath, { includeLocals: true, includeParameters: true });
            } catch {
                symbols = [];
            }
            entry = { symbols };
            this.fileContexts.set(key, entry);
        }
        return entry;
    }

    /** 출현 하나를 참조로 남길지. 대상 스코프가 확정되지 않았으면 종전대로 모두 남긴다. */
    private acceptByScope(fsPath: string, text: string, lineIdx: number, lineText: string, character: number): boolean {
        const { plan, deps } = this;
        const { scopeTarget, defSymbol, word } = plan;
        if (!scopeTarget || !defSymbol) {
            return true;
        }
        // 문자열 속 `"Module.Proc"` 는 shouldAcceptOccurrence 가 컨테이너까지 이미 검사했다.
        if (isInCommentOrString(lineText, character)) {
            return true;
        }
        const scopeLookup = {
            findAllByName: (n: string) => deps.symbols.findAllByName(n),
            inUnit: (p: string) => this.inCompileUnit(p),
            samePath: (a: string, b: string) => normalizePathKey(a) === normalizePathKey(b),
        };
        const file = this.fileContextOf(fsPath, text);
        const verdict = classifyReferenceOccurrence(
            scopeTarget,
            { filePath: fsPath, line: lineIdx, lineText, character, fileSymbols: file.symbols },
            scopeLookup,
        );
        let reason: ReferenceExclusionReason | undefined = verdict.accept ? undefined : verdict.reason;
        if (!reason && plan.overloadFilterOn && !declarationAt(file.symbols, word, lineIdx, character)) {
            const callArgs = extractCallArgumentsFromSuffix(lineText.substring(character + word.length));
            const callCtx = buildCallContext(callArgs, () => deps.receiverLookupFromText(
                (file.lines ??= text.split(/\r\n|\r|\n/)), fsPath, lineIdx,
                n => deps.symbols.findAllByName(n), file.symbols));
            if (!isOverloadSelected(defSymbol, plan.overloadSiblings, callCtx)) {
                reason = 'overload-mismatch';
            }
        }
        const fileName = fsPath.split(/[\\/]/).pop();
        const where = `${fileName}:${lineIdx + 1}`;
        const key = `${normalizePathKey(fsPath)}:${lineIdx}:${character}`;
        this.trace.record(key, where, reason);
        return !reason;
    }

    /**
     * 후보 출현 하나를 모든 관문(멤버 스코프·문자열/주석·반환값 대입·선언 건너뛰기·출현 판정)에 통과시켜
     * 남기면 장부에 올리고 true(중복이면 false). `startIndex` 는 `text` 안의 절대 오프셋.
     */
    addIfAccepted(
        file: ScanFile, lineIdx: number, colInLine: number, startIndex: number, lineText: string, unqualifiedOnly: boolean | undefined,
    ): boolean {
        const { plan, deps } = this;
        const { text, fsPath } = file;

        if (unqualifiedOnly && isQualifiedAt(text, startIndex)) {
            return false;
        }

        if (!shouldAcceptByMemberScope(
            (n, from) => deps.symbols.findDefinition(n, from), fsPath, text, startIndex, plan.targetClass)) {
            return false;
        }

        // 일반 문자열/주석은 제외하되, `"Class.Proc"`처럼 GPL 런타임이
        // 프로시저 이름으로 소비하는 정확한 symbol-valued string은 참조다.
        if (!this.shouldAcceptOccurrence(fsPath, lineText, colInLine)) {
            return false;
        }

        // 함수 본문의 반환값 대입문(FunctionName = ...)은 참조에서 제외.
        if (
            plan.defSymbol?.kind === 'function' &&
            fsPath === plan.defSymbol.filePath &&
            isStatementLeadingAssignmentLHS(text, startIndex, plan.word.length)
        ) {
            return false;
        }

        if (this.shouldSkipAsDeclaration(fsPath, lineIdx, colInLine, lineText)) {
            return false;
        }
        if (!this.acceptByScope(fsPath, text, lineIdx, lineText, colInLine)) {
            return false;
        }
        return this.addSite({
            uriKey: file.uriKey,
            fsPath,
            startLine: lineIdx,
            startCharacter: colInLine,
            endLine: lineIdx,
            endCharacter: colInLine + plan.word.length,
        });
    }

    /** 정규식을 문서 전체가 아니라 "라인별"로 실행해 걸린 출현을 장부에 올린다. 새로 올린 개수를 돌려준다. */
    scanSourceText(file: ScanFile, re: RegExp, opts: { unqualifiedOnly?: boolean }): number {
        const { word } = this.plan;
        const { text } = file;
        let added = 0;
        // VS Code 문서를 열지 않고도 물리 줄의 절대 오프셋을 보존한다(CRLF/LF/CR 혼합 허용).
        const lineStarts = computeLineStarts(text);

        // 멤버 접근/식별자 패턴은 모두 단일 라인 기준이므로(파라미터 안에서도 \r\n 제외),
        // 정규식을 문서 전체가 아니라 "라인별"로 실행한다. 이렇게 하면 정규식 입력 길이가
        // 한 줄로 제한되어, anyQualifierPattern의 중첩 수량자로 인한 catastrophic
        // backtracking(ReDoS) 위험이 구조적으로 사라진다. 헬퍼들이 기대하는 절대 오프셋은
        // lineStart + colInLine 으로 그대로 복원한다.
        for (let lineIdx = 0; lineIdx < lineStarts.length; lineIdx++) {
            if (this.deps.isCancelled()) {
                break;
            }
            const lineStart = lineStarts[lineIdx];
            const lineText = physicalLineText(text, lineStarts, lineIdx);
            if (lineText.length === 0 || lineText.length > MAX_SCAN_LINE_LENGTH) {
                continue;
            }

            re.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = re.exec(lineText)) !== null) {
                // zero-width 매치 방어(이론상 발생하지 않지만 무한 루프 방지)
                if (match[0].length === 0) {
                    re.lastIndex++;
                    continue;
                }

                const colInLine = match.index + memberOffsetInMatch(match[0], word);
                const startIndex = lineStart + colInLine;

                if (this.addIfAccepted(file, lineIdx, colInLine, startIndex, lineText, opts.unqualifiedOnly)) {
                    added += 1;
                }
            }
        }
        return added;
    }
}
