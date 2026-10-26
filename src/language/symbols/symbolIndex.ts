import * as path from 'path';
import { GPLParser, GPLSymbol } from '../gplParser';
import { ciEq } from '../identifiers';
import { getParameterArity, argCountMatchesArity } from '../cursorExpression';
import { CallContext, toCallContext, rankOverloadMatches } from '../overloadResolution';
import { buildSymbolNameIndex } from '../symbolNameIndex';
import { filterOverloadSiblings } from '../docCommentOverloads';
import { isDeclaredIn, ReceiverHolder } from '../receiverType';
import { normalizePathKey } from '../../util/pathKey';

/** 프로젝트 구성의 구현은 호출부가 소유한다. */
export interface SymbolResolutionContext {
    narrowCandidates(candidates: GPLSymbol[], referenceFilePath?: string): GPLSymbol[];
    scoreFilePath(candidateFilePath: string, referenceFilePath: string): number;
    isSameCompileUnit(candidateFilePath: string, referenceFilePath: string): boolean;
}

interface CachedFileSymbols {
    filePath: string;
    symbols: GPLSymbol[];
}

/** 파일별 심볼과 이름 인덱스를 소유한다. VS Code와 파일 로딩은 호출부가 맡는다. */
export class SymbolIndex {
    private symbols = new Map<string, CachedFileSymbols>();
    private nameIndex = new Map<string, GPLSymbol[]>();
    private fileRevisions = new Map<string, number>();
    private changeSequence = 0;

    constructor(private readonly context: SymbolResolutionContext) {}

    public clear(): void {
        this.symbols.clear();
        this.nameIndex.clear();
        this.fileRevisions.clear();
    }

    /** 새 읽기 요청도 이전 요청을 무효화한다. clear 뒤에도 번호를 재사용하지 않는다. */
    public beginFileUpdate(filePath: string): number {
        const revision = ++this.changeSequence;
        this.fileRevisions.set(normalizePathKey(filePath), revision);
        return revision;
    }

    public isFileUpdateCurrent(filePath: string, revision: number): boolean {
        return this.fileRevisions.get(normalizePathKey(filePath)) === revision;
    }

    public removeFile(filePath: string): boolean {
        const removed = this.deleteByFsPath(filePath);
        if (removed) { this.rebuildNameIndex(); }
        return removed;
    }

    /** 존재 확인은 주입받고, 삭제가 확인된 항목만 한 묶음으로 제거한다. */
    public pruneFiles(isMissing: (filePath: string) => boolean, filePaths?: readonly string[]): string[] {
        const keys = filePaths
            ? Array.from(new Set(filePaths.map(p => normalizePathKey(p))))
            : Array.from(this.symbols.keys());
        const removed: string[] = [];
        for (const key of keys) {
            const entry = this.symbols.get(key);
            if (!entry || !isMissing(entry.filePath)) { continue; }
            this.beginFileUpdate(entry.filePath);
            this.symbols.delete(key);
            removed.push(entry.filePath);
        }
        if (removed.length > 0) { this.rebuildNameIndex(); }
        return removed;
    }

    public isSameCompileUnit(candidateFilePath: string, referenceFilePath: string): boolean {
        return this.context.isSameCompileUnit(candidateFilePath, referenceFilePath);
    }

    /**
     * 파일 하나의 심볼을 텍스트로 갱신한다 — 문서 객체 없이(인덱싱·워처·열린 문서 경로가 모두 이 길을 탄다).
     * **이름 인덱스는 다시 만들지 않는다** — 호출자가 묶음이 끝난 뒤 `rebuildNameIndex()` 를 한 번 부른다.
     * 파일마다 재구축하면 그때까지 누적된 심볼 전체를 매번 훑어 O(n²) 가 된다(2026-09-18 실측: 567개
     * 파일·21,747 심볼에서 624만 회 순회·798 ms — 읽기+파싱 465 ms 보다 컸다).
     * @returns 파싱한 심볼 수. 대상이 아니거나(확장자·NUL 문자가 있는 내용) 건너뛰면 undefined.
     */
    public updateFileText(fsPath: string, text: string): number | undefined {
        const lower = fsPath.toLowerCase();
        if (!lower.endsWith('.gpl') && !lower.endsWith('.gpo')) {
            return undefined;
        }
        this.beginFileUpdate(fsPath);

        // NUL 문자가 있는 내용은 텍스트 소스로 해석하지 않는다 — 잘못된 심볼 생성 방지.
        if (text.includes('\u0000')) {
            return;
        }

        const symbols = GPLParser.parseDocument(text, fsPath);
        // 키는 정규화 경로 — 같은 파일이 다른 표기로 다시 들어와도 항목은 하나로 유지된다.
        // 표기가 바뀌었으면 방금 들어온 표기를 정본으로 삼는다(디스크 표기에 더 가깝다).
        this.symbols.set(normalizePathKey(fsPath), { filePath: fsPath, symbols });
        return symbols.length;
    }

    private deleteByFsPath(filePath: string): boolean {
        this.beginFileUpdate(filePath);
        // 키가 이미 정규화돼 있으므로 대소문자·구분자 차이를 따로 훑을 필요가 없다.
        return this.symbols.delete(normalizePathKey(filePath));
    }

    /**
     * fsPath 자체이거나 그 하위인 모든 캐시 항목을 제거한다(대소문자·구분자 무시).
     * 폴더 삭제/이름변경 시 하위 파일들의 잔류 심볼을 일괄 정리하는 용도 (extension.ts에서 호출).
     */
    public deleteByFsPathPrefix(fsPath: string): void {
        const targetKey = normalizePathKey(fsPath);
        const prefixKey = targetKey + path.sep;
        let removed = false;
        // 아직 읽기 중이라 심볼이 없는 파일도 폴더 삭제에 포함한다.
        for (const key of new Set([...this.symbols.keys(), ...this.fileRevisions.keys()])) {
            if (key === targetKey || key.startsWith(prefixKey)) {
                this.beginFileUpdate(key);
                removed = this.symbols.delete(key) || removed;
            }
        }
        if (removed) {
            this.rebuildNameIndex();
        }
    }

    /** 인덱싱된 파일 목록(원본 표기) — 진단 명령이 경로 단위로 훑는 데 쓴다. */
    public listIndexedFiles(): string[] {
        return Array.from(this.symbols.values(), entry => entry.filePath);
    }

    /**
     * 이름으로 정의를 찾는다.
     *
     * `argCount`가 주어지고 이름이 겹치는 호출 가능한 심볼(Sub/Function)이 여러 개면,
     * 인자 개수(Optional/ParamArray 포함한 arity 범위)에 맞는 오버로드를 우선 선택한다.
     * 예) `getWafer(a, b, c)`(인자 3개)는 3-인자 오버로드로 이동한다.
     *
     * `argCount`가 없으면(기존 호출부 그대로) 이름 기준으로 현재 파일을 우선하는
     * 종전 동작을 유지한다 — hover/참조의 한정자 조회 등은 영향받지 않는다.
     */
    public findDefinition(symbolName: string, currentFilePath?: string, call?: number | CallContext): GPLSymbol | undefined {
        return this.findDefinitionMatches(symbolName, currentFilePath, call)[0];
    }

    /**
     * findDefinition의 다중 후보 버전.
     *
     * 호출 문맥(call: 인자 개수 또는 CallContext)이 있으면 arity·인자 타입 적합도까지
     * 반영해 오버로드를 랭킹하고, 그래도 구분 불가능한 "선두 동점 그룹"을 모두
     * 돌려준다(정의찾기 peek 목록용). 항상 최선 후보가 [0]이므로 단일 결과가
     * 필요하면 findDefinition을 쓰면 된다.
     */
    public findDefinitionMatches(symbolName: string, currentFilePath?: string, call?: number | CallContext): GPLSymbol[] {
        const all = this.nameIndex.get(symbolName.toLowerCase()) ?? [];

        if (all.length === 0) {
            return [];
        }

        const ctx = toCallContext(call);
        // 인자별 오버로드 선택이 없으면 현재 파일이 항상 최우선이며 같은 컴파일 단위에 속한다.
        // 다른 프로젝트의 동명 후보 때문에 관계 그래프를 먼저 만드는 비용을 피한다.
        if (currentFilePath && typeof ctx?.argCount !== 'number') {
            const currentKey = normalizePathKey(currentFilePath);
            const inFile = all.find(s => normalizePathKey(s.filePath) === currentKey);
            if (inFile) { return [inFile]; }
        }

        // 워크스페이스를 프로젝트 상위 폴더에서 열면 여러 과제의 동명 심볼이 한 인덱스에 들어온다.
        // 같은 컴파일 단위 안에 후보가 있으면 그 밖은 정의가 될 수 없다 — 점수 경쟁 전에 잘라낸다.
        const candidates = this.context.narrowCandidates(all, currentFilePath);

        // 호출 문맥(Foo(...))이고 호출 가능한 후보가 있으면 arity/타입 기반 오버로드 해석을 시도한다.
        // 이 경로는 파일 우선순위(scoreFilePath)도 함께 고려하므로 현재 파일 내 오버로드가 자연스레 우선된다.
        if (ctx && typeof ctx.argCount === 'number') {
            const callable = candidates.filter(s => s.kind === 'function' || s.kind === 'sub');
            if (callable.length > 0) {
                const matches = rankOverloadMatches(
                    callable,
                    ctx,
                    currentFilePath ? c => this.context.scoreFilePath(c.filePath, currentFilePath) : undefined
                );
                if (matches.length > 0) {
                    return matches;
                }
            }
        }

        // 기존 동작: 현재 파일에서 먼저 찾고, 없으면 경로 근접도로 최적 후보 선택.
        // (workspace 루트와 Test_robot/ 같은 중복 사본 사이에서 튀는 것을 방지)
        if (currentFilePath) {
            // 경로 비교는 캐시 키와 같은 규칙(normalizePathKey) — 표기 차이를 같은 파일로 본다.
            const currentKey = normalizePathKey(currentFilePath);
            const inFile = candidates.filter(s => normalizePathKey(s.filePath) === currentKey);
            if (inFile.length > 0) {
                return [inFile[0]];
            }
        }

        const best = this.pickBestCandidate(candidates, currentFilePath);
        return best ? [best] : [];
    }

    public findMemberInClass(memberName: string, className: string, preferredFilePath?: string, call?: number | CallContext): GPLSymbol | undefined {
        return this.findMemberInClassMatches(memberName, className, preferredFilePath, call)[0];
    }

    /** findMemberInClass의 다중 후보 버전 — 구분 불가능한 오버로드 동점 그룹을 돌려준다. [0]이 최선. */
    public findMemberInClassMatches(memberName: string, className: string, preferredFilePath?: string, call?: number | CallContext): GPLSymbol[] {
        // Search for the member in the specified class
        // First, try to find exact match with className (수집 조건은 findMemberCandidatesInClass가 정본)
        const exactCandidates = this.findMemberCandidatesInClass(memberName, className);

        const exactPicks = this.pickCallableMatches(exactCandidates, preferredFilePath, call);
        if (exactPicks.length > 0) {
            return exactPicks;
        }

        // If not found, also search in files that contain the class definition
        // This handles cases where the parser might not set className correctly
        const fallbackCandidates: GPLSymbol[] = [];
        for (const { symbols: fileSymbols } of this.symbols.values()) {
            // Find if this file has the class definition
            const classSymbol = fileSymbols.find(s => ciEq(s.name, className) && s.kind === 'class');
            if (classSymbol) {
                // Look for the member in this file
                for (const s of fileSymbols) {
                    if (
                        ciEq(s.name, memberName) &&
                        (s.kind === 'function' || s.kind === 'sub' || s.kind === 'property') &&
                        s.line > classSymbol.line // Member should be after class definition
                    ) {
                        fallbackCandidates.push(s);
                    }
                }
            }
        }

        return this.pickCallableMatches(fallbackCandidates, preferredFilePath, call);
    }

    public findMemberInModule(memberName: string, moduleName: string, preferredFilePath?: string, call?: number | CallContext): GPLSymbol | undefined {
        return this.findMemberInModuleMatches(memberName, moduleName, preferredFilePath, call)[0];
    }

    /** findMemberInModule의 다중 후보 버전 — 구분 불가능한 오버로드 동점 그룹을 돌려준다. [0]이 최선. */
    public findMemberInModuleMatches(memberName: string, moduleName: string, preferredFilePath?: string, call?: number | CallContext): GPLSymbol[] {
        // 수집 조건은 findMemberCandidatesInModule가 정본 — 선택만 여기서 수행.
        const candidates = this.findMemberCandidatesInModule(memberName, moduleName);
        return this.pickCallableMatches(candidates, preferredFilePath, call);
    }

    public findConstructorInClass(className: string, argCount?: number, preferredFilePath?: string): GPLSymbol | undefined {
        // In GPL/VB style, constructors are represented as `Sub New(...)`.
        // The parser records these as kind 'sub' with name 'New' and className set.
        const candidates: GPLSymbol[] = [];

        for (const s of this.nameIndex.get('new') ?? []) {
            if (s.kind !== 'sub') {
                continue;
            }
            if (!s.className || !ciEq(s.className, className)) {
                continue;
            }
            if (typeof argCount === 'number') {
                // Optional/ParamArray를 반영한 arity 범위 검사 — 종전의 정확 일치(===)는
                // `Sub New(Optional ...)`의 0-인자 호출 등을 놓쳤다 (오버로드 해석 모듈과 동일 규칙).
                if (!argCountMatchesArity(argCount, getParameterArity(s.parameters))) {
                    continue;
                }
            }

            candidates.push(s);
        }

        // If we tried to match by argCount and found none, fall back to any constructor.
        if (candidates.length === 0 && typeof argCount === 'number') {
            return this.findConstructorInClass(className, undefined, preferredFilePath);
        }

        return this.pickBestCandidate(candidates, preferredFilePath);
    }

    public findMemberCandidatesInClass(memberName: string, className: string): GPLSymbol[] {
        const candidates: GPLSymbol[] = [];
        for (const s of this.nameIndex.get(memberName.toLowerCase()) ?? []) {
            if (
                s.className !== undefined && ciEq(s.className, className) &&
                // 필드(variable)·상수(constant)도 클래스 멤버다 — 누락 시 `obj.field` 정의 이동이
                // fallback 텍스트 검색으로만 동작하던 버그 수정 (2026-07-03).
                // 호출 문맥(Foo(...))의 비호출형 제외는 pickBestCallableCandidate가 담당한다.
                (s.kind === 'function' || s.kind === 'sub' || s.kind === 'property'
                    || s.kind === 'variable' || s.kind === 'constant')
            ) {
                candidates.push(s);
            }
        }
        return candidates;
    }

    public findMemberCandidatesInModule(memberName: string, moduleName: string): GPLSymbol[] {
        const candidates: GPLSymbol[] = [];
        for (const { symbols: fileSymbols } of this.symbols.values()) {
            for (const s of fileSymbols) {
                if (
                    ciEq(s.name, memberName) &&
                    s.module !== undefined && ciEq(s.module, moduleName) &&
                    !s.className &&
                    (s.kind === 'function' || s.kind === 'sub' || s.kind === 'constant' || s.kind === 'variable')
                ) {
                    candidates.push(s);
                }
            }
        }
        return candidates;
    }

    /**
     * 이름이 일치하는 모든 심볼을 돌려준다(대소문자 무시).
     * 참조 검색이 호출부에서 시작될 때 정의의 스코프(module/class/access)를 복원하는 데 쓴다.
     */
    public findAllByName(symbolName: string): GPLSymbol[] {
        const out: GPLSymbol[] = [];
        const bucket = this.nameIndex.get(symbolName.toLowerCase()) ?? [];
        for (const s of bucket) {
            if (ciEq(s.name, symbolName)) {
                out.push(s);
            }
        }
        return out;
    }

    /**
     * 오버로드 형제 — 같은 이름·Sub/Function·같은 모듈/클래스·같은 컴파일 단위의 다른 선언(자기 제외).
     * 캐시 밖 심볼(현재 문서를 파싱한 결과)을 `extra` 로 합칠 수 있고, 같은 선언의 사본은 하나로 접힌다.
     * 문서화 주석 병합(docCommentOverloads)이 쓰는 형제 후보의 정본.
     */
    public findOverloadSiblings(target: GPLSymbol, extra?: readonly GPLSymbol[]): GPLSymbol[] {
        const pool = extra && extra.length
            ? [...this.findAllByName(target.name), ...extra]
            : this.findAllByName(target.name);
        return filterOverloadSiblings(target, pool, { isSameUnit: (c, t) => this.isSameCompileUnit(c, t) });
    }

    public getAllSymbols(): GPLSymbol[] {
        const allSymbols: GPLSymbol[] = [];
        for (const { symbols: fileSymbols } of this.symbols.values()) {
            allSymbols.push(...fileSymbols);
        }
        return allSymbols;
    }

    /**
     * className의 멤버 목록(필드/상수/프로퍼티/메서드) — 멤버 자동완성용.
     * 중첩 클래스 선언도 바깥 클래스의 멤버로 노출한다 (예: `ZeroPlan.` → `StepBatch`).
     */
    public getClassMembers(className: string): GPLSymbol[] {
        return this.collectDeclaredMembers({ kind: 'class', name: className });
    }

    /**
     * moduleName 직속(클래스 밖) 멤버 목록 — 모듈 한정자 자동완성용.
     * 그 모듈의 최상위 클래스 선언도 포함한다 (예: `ZeroModule.` → `ZeroPlan`) — 종전에는
     * 클래스 심볼의 `className`이 자기 이름이라 "클래스 안에 있는 것"으로 걸러져 빠졌다.
     */
    public getModuleMembers(moduleName: string): GPLSymbol[] {
        return this.collectDeclaredMembers({ kind: 'module', name: moduleName });
    }

    /**
     * 후보들 중에서 호출 문맥에 맞는 결과를 고른다(다중 동점 허용).
     *
     * 호출 문맥이 없으면 종전대로 경로 근접도 기반 단일 선택.
     * 호출 문맥이면 비호출형(const/variable/property)은 제외하고, arity·인자 타입
     * 적합도·경로 근접도로 랭킹한 "선두 동점 그룹"을 돌려준다.
     * (선택 규칙 상세는 rankOverloadMatches — symbolCache/definitionProvider 공용 정본 — 참조.)
     */
    private pickCallableMatches(all: GPLSymbol[], preferredFilePath: string | undefined, call?: number | CallContext): GPLSymbol[] {
        if (all.length === 0) {
            return [];
        }

        // 클래스/모듈 멤버 폴백은 인덱싱된 파일 전체를 훑으므로 여기서도 컴파일 단위로 좁힌다.
        const candidates = this.context.narrowCandidates(all, preferredFilePath);

        const ctx = toCallContext(call);
        if (!ctx || typeof ctx.argCount !== 'number') {
            const best = this.pickBestCandidate(candidates, preferredFilePath);
            return best ? [best] : [];
        }

        // 배열 타입 필드/프로퍼티(`steps() As StepBatch` 등)는 `steps(i)`처럼 괄호로
        // 인덱싱되므로 호출 문맥에서도 정당한 후보다 — 비호출형 제외에서 살려둔다.
        const isIndexableArray = (s: GPLSymbol) =>
            (s.kind === 'variable' || s.kind === 'property') && !!s.returnType && s.returnType.endsWith('[]');
        const callable = candidates.filter(s => s.kind === 'function' || s.kind === 'sub' || isIndexableArray(s));
        if (callable.length === 0) {
            // In a call context (Foo(...)), non-callable symbols (const/variable/property) should not be selected.
            return [];
        }

        return rankOverloadMatches(
            callable,
            ctx,
            preferredFilePath ? c => this.context.scoreFilePath(c.filePath, preferredFilePath) : undefined
        );
    }

    private pickBestCandidate(candidates: GPLSymbol[], preferredFilePath?: string): GPLSymbol | undefined {
        if (candidates.length === 0) {
            return undefined;
        }
        if (!preferredFilePath) {
            return candidates[0];
        }

        const scored = candidates
            .map(sym => ({ sym, score: this.context.scoreFilePath(sym.filePath, preferredFilePath) }))
            .sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                // stable-ish tiebreakers: prefer same file, then earlier definition
                if (a.sym.filePath !== b.sym.filePath) return a.sym.filePath.localeCompare(b.sym.filePath);
                return a.sym.line - b.sym.line;
            });

        return scored[0].sym;
    }

    public rebuildNameIndex(): void {
        const allSymbols = this.getAllSymbols();
        this.nameIndex = buildSymbolNameIndex(allSymbols);
    }

    /**
     * 홀더(클래스/모듈)에 **직접 선언된** 심볼 목록 — 멤버 자동완성용.
     * 소속 판정은 `isDeclaredIn` 하나로 통일한다(클래스/모듈 심볼의 자기-참조 필드 함정 — receiverType.ts 참조).
     * 이름 중복(오버로드)은 첫 항목만, 생성자(New)는 제외한다.
     */
    private collectDeclaredMembers(holder: ReceiverHolder): GPLSymbol[] {
        const seen = new Set<string>();
        const members: GPLSymbol[] = [];
        for (const s of this.getAllSymbols()) {
            if (!isDeclaredIn(s, holder)) { continue; }
            const key = s.name.toLowerCase();
            if (key === 'new' || seen.has(key)) { continue; }
            seen.add(key);
            members.push(s);
        }
        return members;
    }
}
