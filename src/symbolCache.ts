import * as vscode from 'vscode';
import * as path from 'path';
import { GPLParser, GPLSymbol } from './gplParser';
import { isTraceOn, ciEq } from './config';
import { getParameterArity, argCountMatchesArity } from './language/cursorExpression';
import { CallContext, toCallContext, rankOverloadMatches } from './language/overloadResolution';
import { buildSymbolNameIndex } from './symbolNameIndex';
import { renderDocCommentMarkdown } from './language/docComment';
import { isDeclaredIn, ReceiverHolder } from './language/receiverType';
import { PROJECT_EXCLUDE_GLOB, findWorkspaceGprPaths } from './project/projectFileScope';
import { collectProjectSourcePaths, pickOwningGprPath } from './project/projectSources';
import { CompileUnitIndex, narrowToCompileUnit } from './project/compileUnit';
import { isPathUnder, normalizePathKey } from './controller/projectPickerCore';
import { isMissingFile } from './language/symbolLocations';

// scoreFilePath 점수 체계 — 높을수록 우선 (정의 후보가 여럿일 때 경로 근접도로 선택)
const SCORE_SAME_FILE = 1000;
const SCORE_SAME_DIRECTORY = 800;
/** 같은 프로젝트(.gpr 폴더) 하위 — 하위 폴더로 나뉘어 있어도 같은 컴파일 단위다. */
const SCORE_SAME_PROJECT = 650;
/**
 * 같은 컴파일 단위의 **다른** 프로젝트 — `ProjectLibrary`로 참조하는/참조받는 프로젝트.
 * 폴더는 분리돼 있어도 함께 컴파일되므로, 워크스페이스 최상위 폴더가 같을 뿐인 남의 프로젝트보다 앞선다.
 */
const SCORE_RELATED_PROJECT = 600;
const SCORE_SAME_TOP_LEVEL_FOLDER = 500;
const SCORE_UNRELATED = 0;

/**
 * 워크스페이스 파일 검색 공용 제외 글롭.
 * 프로젝트 탐색(`findProjectDirs`·참조 검색 범위)과 같은 목록을 쓴다 — 특히 `.history`
 * (Local History 확장)의 stale 사본이 인덱스를 오염시키면 정의/참조가 엉뚱한 파일을 가리킨다.
 */
const INDEX_EXCLUDE_GLOB = PROJECT_EXCLUDE_GLOB;

/**
 * 파일 하나의 캐시 항목.
 *
 * 키는 `normalizePathKey`로 정규화한 경로이고, 표시·URI 생성에는 여기 담긴 **원본 표기**를 쓴다.
 * 종전에는 `document.uri.fsPath` 원문을 그대로 Map 키로 썼는데, 같은 파일이 표기만 다르게
 * 들어오면(`.gpr`의 `ProjectSource=` 표기 ↔ 디스크 표기 등) 항목이 하나 더 생겨
 * 정의 이동이 같은 선언을 여러 번 띄웠다 (2026-09-02).
 */
interface CachedFileSymbols {
    /** 디스크 표기 그대로의 경로 — Location·참조 결과에 그대로 쓴다. */
    filePath: string;
    symbols: GPLSymbol[];
}

export class SymbolCache {
    /** 정규화 경로 키 → 파일 항목. 키 정규화 규칙은 `normalizePathKey` 하나뿐이다. */
    private symbols: Map<string, CachedFileSymbols> = new Map();
    private nameIndex: Map<string, GPLSymbol[]> = new Map();
    /** 마지막 인덱싱에서 발견한 워크스페이스 .gpr 경로 — 정의 후보 선택의 "같은 프로젝트" 판정에 쓴다. */
    private gprPaths: string[] = [];
    /**
     * 컴파일 단위(프로젝트 + ProjectLibrary 관계) 경계 — 정의 후보를 소유 프로젝트 밖으로 새지 않게 한다.
     * 워크스페이스를 프로젝트 상위 폴더에서 열면 인덱스에 여러 과제의 동명 심볼이 함께 들어오기 때문이다.
     */
    private compileUnits = new CompileUnitIndex();
    private outputChannel?: vscode.OutputChannel;
    /** True while refresh/indexWorkspace is running — suppresses duplicate updates from onDidOpenTextDocument. */
    public isRefreshing = false;

    constructor(outputChannel?: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    private log(message: string) {
        if (!isTraceOn(vscode.workspace)) {
            return;
        }
        if (this.outputChannel) {
            this.outputChannel.appendLine(message);
        }
    }

    public async refresh(): Promise<void> {
        this.log('[SymbolCache] Starting refresh...');
        this.isRefreshing = true;
        try {
            this.symbols.clear();
            this.nameIndex.clear();
            await this.indexWorkspace();
        } finally {
            this.isRefreshing = false;
        }
        this.log(`[SymbolCache] Refresh complete. Total symbols: ${this.getAllSymbols().length}`);
    }

    public updateDocument(document: vscode.TextDocument): void {
        if (document.uri.scheme !== 'file') {
            return;
        }

        // Do not rely on languageId: *.gpl can be opened as 'vb'.
        const fsPath = document.uri.fsPath;
        const lower = fsPath.toLowerCase();
        if (!lower.endsWith('.gpl') && !lower.endsWith('.gpo')) {
            return;
        }

        const text = document.getText();
        // 바이너리 .gpo가 텍스트로 열린 경우(NUL 문자 포함) 심볼 갱신을 건너뛴다 — 쓰레기 심볼 방지.
        if (text.includes('\u0000')) {
            return;
        }

        const symbols = GPLParser.parseDocument(text, fsPath);
        // 키는 정규화 경로 — 같은 파일이 다른 표기로 다시 들어와도 항목은 하나로 유지된다.
        // 표기가 바뀌었으면 방금 열린 문서의 표기를 정본으로 삼는다(디스크 표기에 더 가깝다).
        this.symbols.set(normalizePathKey(fsPath), { filePath: fsPath, symbols });
        this.rebuildNameIndex();

        const fileName = path.basename(fsPath);
        this.log(`[SymbolCache] Updated ${fileName}: ${symbols.length} symbols`);
    }

    /**
     * Remove cached symbols for a file path.
     * This prevents "garbage" symbols from lingering after deletes/renames.
     */
    public removeFile(filePath: string): void {
        const deleted = this.deleteByFsPath(filePath);
        if (deleted) {
            this.rebuildNameIndex();
            const fileName = path.basename(filePath);
            this.log(`[SymbolCache] Removed ${fileName} from cache`);
        }
    }

    private deleteByFsPath(filePath: string): boolean {
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
        for (const key of Array.from(this.symbols.keys())) {
            if (key === targetKey || key.startsWith(prefixKey)) {
                this.symbols.delete(key);
                removed = true;
            }
        }
        if (removed) {
            this.rebuildNameIndex();
        }
    }

    /**
     * 디스크에서 사라진 파일의 캐시 항목을 제거하고, 제거한 개수를 돌려준다.
     *
     * 파일 삭제·이동은 원래 워처(`onDidDelete`)가 잡지만 놓치는 경로가 있다 — SVN update/switch 같은
     * 대량 변경, 탐색기에서 폴더째 이동, **워크스페이스 밖** `.gpr`로 인덱싱된 파일(워처는 워크스페이스
     * 폴더만 본다). 그때 남은 잔류 항목은 정의 이동에서 "열리지 않는 후보"로 나타난다(§1-CQ).
     * 그래서 잔류를 **발견한 자리에서** 이 메서드로 인덱스까지 정리한다(자가 치유) — 그러지 않으면
     * 정의 이동만 걸러지고 호버·자동완성·참조 검색은 계속 사라진 파일의 심볼을 본다.
     *
     * 지우는 기준은 `isMissingFile` 하나뿐이다 — **`ENOENT`일 때만** 지운다.
     *
     * @param filePaths 검사할 경로(생략하면 인덱스 전체). 표기는 무관하다(정규화해서 조회).
     */
    public pruneMissingFiles(filePaths?: readonly string[]): number {
        const keys = filePaths
            ? Array.from(new Set(filePaths.map(p => normalizePathKey(p))))
            : Array.from(this.symbols.keys());

        let removed = 0;
        for (const key of keys) {
            const entry = this.symbols.get(key);
            if (!entry || !isMissingFile(entry.filePath)) {
                continue;
            }
            this.symbols.delete(key);
            removed++;
            this.log(`[SymbolCache] Pruned missing file: ${entry.filePath}`);
        }

        if (removed > 0) {
            this.rebuildNameIndex();
        }
        return removed;
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

        // 워크스페이스를 프로젝트 상위 폴더에서 열면 여러 과제의 동명 심볼이 한 인덱스에 들어온다.
        // 같은 컴파일 단위 안에 후보가 있으면 그 밖은 정의가 될 수 없다 — 점수 경쟁 전에 잘라낸다.
        const candidates = this.narrowToUnit(all, currentFilePath);

        // 호출 문맥(Foo(...))이고 호출 가능한 후보가 있으면 arity/타입 기반 오버로드 해석을 시도한다.
        // 이 경로는 파일 우선순위(scoreFilePath)도 함께 고려하므로 현재 파일 내 오버로드가 자연스레 우선된다.
        const ctx = toCallContext(call);
        if (ctx && typeof ctx.argCount === 'number') {
            const callable = candidates.filter(s => s.kind === 'function' || s.kind === 'sub');
            if (callable.length > 0) {
                const matches = rankOverloadMatches(
                    callable,
                    ctx,
                    currentFilePath ? c => this.scoreFilePath(c.filePath, currentFilePath) : undefined
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
        const candidates = this.narrowToUnit(all, preferredFilePath);

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
            preferredFilePath ? c => this.scoreFilePath(c.filePath, preferredFilePath) : undefined
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
            .map(sym => ({ sym, score: this.scoreFilePath(sym.filePath, preferredFilePath) }))
            .sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                // stable-ish tiebreakers: prefer same file, then earlier definition
                if (a.sym.filePath !== b.sym.filePath) return a.sym.filePath.localeCompare(b.sym.filePath);
                return a.sym.line - b.sym.line;
            });

        return scored[0].sym;
    }

    /**
     * 후보를 기준 파일의 컴파일 단위(프로젝트 + ProjectLibrary 관계) 안으로 좁힌다.
     * 단위 안 후보가 없거나 단위를 판정할 수 없으면 원본 그대로 — 모를 때 지우지 않는다.
     */
    private narrowToUnit(candidates: GPLSymbol[], preferredFilePath?: string): GPLSymbol[] {
        const narrowed = narrowToCompileUnit(candidates, preferredFilePath, s => s.filePath, this.compileUnits);
        return narrowed === candidates ? candidates : [...narrowed];
    }

    /**
     * 두 파일이 같은 컴파일 단위인가 — 참조 검색·이름 바꾸기가 결과를 프로젝트 밖으로 흘리지 않게
     * 하는 데 쓴다. 단위를 판정할 수 없으면 true(모를 때 배제하지 않는다).
     */
    public isSameCompileUnit(candidateFilePath: string, referenceFilePath: string): boolean {
        return this.compileUnits.isSameUnit(candidateFilePath, referenceFilePath);
    }

    /** `.gpr` 내용이 바뀌었을 때 컴파일 단위 해석 캐시를 버린다(파일 감시자에서 호출). */
    public invalidateProjectRelations(): void {
        this.compileUnits.invalidate();
    }

    private scoreFilePath(candidateFilePath: string, preferredFilePath: string): number {
        // Higher is better. 경로 비교는 캐시 키와 같은 규칙(normalizePathKey)을 쓴다 —
        // 대소문자뿐 아니라 `.`/`..`·구분자 차이도 같은 파일로 본다.
        const candidateKey = normalizePathKey(candidateFilePath);
        const preferredKey = normalizePathKey(preferredFilePath);
        if (candidateKey === preferredKey) {
            return SCORE_SAME_FILE;
        }

        if (path.dirname(candidateKey) === path.dirname(preferredKey)) {
            return SCORE_SAME_DIRECTORY;
        }

        // 같은 프로젝트(.gpr 폴더) 하위를 워크스페이스 최상위 폴더보다 우선한다 —
        // 프로젝트가 하위 폴더로 나뉘어 있으면(`T1\T2\T2.gpl`) 디렉터리는 달라도 같은 컴파일 단위이고,
        // 반대로 최상위 폴더가 같다는 것만으로는 다른 프로젝트의 동명 파일과 구분되지 않는다.
        const owningGpr = pickOwningGprPath(preferredFilePath, this.gprPaths);
        if (owningGpr && isPathUnder(candidateFilePath, path.dirname(owningGpr))) {
            return SCORE_SAME_PROJECT;
        }

        // 라이브러리 관계로 함께 컴파일되는 프로젝트(형제/중첩 폴더)는 남의 프로젝트보다 앞선다.
        // 이게 없으면 라이브러리의 정의가 SCORE_UNRELATED로 떨어져, 최상위 폴더만 같은
        // 무관한 프로젝트의 동명 심볼(SCORE_SAME_TOP_LEVEL_FOLDER)에게 진다.
        // (`isSameUnit`은 "모르면 true"라 점수 매기기에는 못 쓴다 — 여기선 단위가 확정된 경우에만 준다.)
        const unitDirs = this.compileUnits.unitDirsFor(preferredFilePath);
        if (unitDirs.length > 0 && this.compileUnits.isInUnitDirs(candidateFilePath, unitDirs)) {
            return SCORE_RELATED_PROJECT;
        }

        // Prefer same top-level folder relative to workspace folder
        const ws = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(preferredFilePath));
        if (ws) {
            const relPreferred = path.relative(ws.uri.fsPath, preferredFilePath);
            const relCandidate = path.relative(ws.uri.fsPath, candidateFilePath);
            const topPreferred = relPreferred.split(path.sep)[0];
            const topCandidate = relCandidate.split(path.sep)[0];
            if (topPreferred && topPreferred.toLowerCase() === topCandidate.toLowerCase()) {
                return SCORE_SAME_TOP_LEVEL_FOLDER;
            }
        }

        return SCORE_UNRELATED;
    }

    /**
     * 캐시에 인덱싱된 "모든" 파일에서 심볼 사용처를 찾는다.
     *
     * 종전에는 (a) 해당 이름을 정의한 파일이면서 (b) 에디터에 열린 문서만 스캔해,
     * 사용-전용 파일과 미오픈 파일의 참조를 통째로 놓쳤다. 이제 인덱싱된 파일 전체를
     * 대상으로, 열린 문서가 있으면 그 텍스트(저장 전 편집 반영)를, 없으면 디스크에서
     * 읽어(utf8) 스캔한다. 스캔 자체는 주석/문자열 안전 + 대소문자 무시 단어 경계인
     * GPLParser.findSymbolUsages를 그대로 사용한다.
     */
    public async findReferences(
        symbolName: string,
        token?: vscode.CancellationToken
    ): Promise<{ filePath: string; usages: { line: number; character: number }[] }[]> {
        const references: { filePath: string; usages: { line: number; character: number }[] }[] = [];
        // 읽기에 실패한 경로 — 루프가 끝난 뒤 "확실히 없는" 것만 인덱스에서 정리한다(자가 치유).
        // 순회 중 Map을 건드리지 않으려고 모았다가 처리한다.
        const unreadable: string[] = [];

        // 키가 아니라 원본 표기(filePath)로 순회한다 — 결과가 URI·표시에 그대로 쓰이므로.
        for (const { filePath } of Array.from(this.symbols.values())) {
            if (token?.isCancellationRequested) {
                break;
            }

            // 열린 문서 우선(편집 중 내용 유지) — 경로는 정규화 키로 비교.
            const fileKey = normalizePathKey(filePath);
            const document = vscode.workspace.textDocuments.find(
                (doc: vscode.TextDocument) => normalizePathKey(doc.uri.fsPath) === fileKey
            );

            let text: string;
            if (document) {
                text = document.getText();
            } else {
                try {
                    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
                    text = Buffer.from(bytes).toString('utf8');
                } catch {
                    // 삭제/접근 불가 파일은 건너뛴다. 원인 판정(ENOENT인지)은 pruneMissingFiles에 맡긴다.
                    unreadable.push(filePath);
                    continue;
                }
            }

            const usages = GPLParser.findSymbolUsages(text, symbolName);
            if (usages.length > 0) {
                references.push({ filePath, usages });
            }
        }

        if (unreadable.length > 0) {
            const pruned = this.pruneMissingFiles(unreadable);
            if (pruned > 0) {
                this.log(`[SymbolCache] 참조 검색 중 사라진 파일 ${pruned}개를 인덱스에서 제거했다`);
            }
        }

        return references;
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

    public getAllSymbols(): GPLSymbol[] {
        const allSymbols: GPLSymbol[] = [];
        for (const { symbols: fileSymbols } of this.symbols.values()) {
            allSymbols.push(...fileSymbols);
        }
        return allSymbols;
    }

    private rebuildNameIndex(): void {
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

    public getCompletionItems(): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];
        const seenNames = new Set<string>();

        for (const symbol of this.getAllSymbols()) {
            const lowerName = symbol.name.toLowerCase();
            if (seenNames.has(lowerName)) {
                continue;
            }
            seenNames.add(lowerName);

            const item = new vscode.CompletionItem(symbol.name, this.getCompletionItemKind(symbol.kind));
            
            // Add detail information
            let detail: string = symbol.kind;
            if (symbol.module) {
                detail += ` (${symbol.module}`;
                if (symbol.className) {
                    detail += `.${symbol.className}`;
                }
                detail += ')';
            }
            item.detail = detail;

            // Add documentation (signature codeblock + doc-comment when available)
            item.documentation = this.buildSymbolDocumentation(symbol);

            // Add snippet for functions/subs
            if ((symbol.kind === 'function' || symbol.kind === 'sub') && symbol.parameters) {
                const params = symbol.parameters.map((param, index) => `\${${index + 1}:${param}}`).join(', ');
                item.insertText = new vscode.SnippetString(`${symbol.name}(${params})`);
            }

            items.push(item);
        }

        return items;
    }

    /**
     * Build rich completion documentation: a GPL signature codeblock for callables
     * (or `name : type` for fields/consts), followed by the symbol's `'` doc-comment.
     */
    public buildSymbolDocumentation(symbol: GPLSymbol): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        if (symbol.kind === 'function' || symbol.kind === 'sub') {
            const params = symbol.parameters?.join(', ') ?? '';
            const sig = symbol.kind === 'function'
                ? `Function ${symbol.name}(${params})${symbol.returnType ? ` As ${symbol.returnType}` : ''}`
                : `Sub ${symbol.name}(${params})`;
            md.appendCodeblock(sig, 'gpl');
        } else if (symbol.returnType) {
            md.appendMarkdown(`\`${symbol.name}\` : \`${symbol.returnType}\``);
        }
        if (symbol.docComment) {
            // 구조화된 문서화 주석(`# Parameters` 등)은 섹션째, 옛 주석은 서술 그대로 렌더링된다.
            const doc = renderDocCommentMarkdown(symbol.docComment, { descriptionMode: 'full' });
            if (doc) {
                // Module/Class처럼 앞에 붙일 시그니처·타입 줄이 없는 종류는 구분용 빈 줄을 넣지 않는다.
                md.appendMarkdown(md.value ? `\n\n${doc}` : doc);
            }
        }
        md.isTrusted = false;
        return md;
    }

    public getCompletionItemKind(symbolKind: string): vscode.CompletionItemKind {
        switch (symbolKind) {
            case 'module': return vscode.CompletionItemKind.Module;
            case 'class': return vscode.CompletionItemKind.Class;
            case 'function': return vscode.CompletionItemKind.Function;
            case 'sub': return vscode.CompletionItemKind.Method;
            case 'variable': return vscode.CompletionItemKind.Variable;
            case 'property': return vscode.CompletionItemKind.Property;
            case 'constant': return vscode.CompletionItemKind.Constant;
            default: return vscode.CompletionItemKind.Text;
        }
    }

    private async indexWorkspace(): Promise<void> {
        // Prefer Project.gpr-based indexing when available.
        // Many GPL projects are single-folder, and Project.gpr defines the actual compile/reference set.
        // This avoids scanning the entire workspace (which can be huge) when only a handful of sources matter.
        const projectFiles = await this.getProjectSourcesFromGpr();

        const filesToIndex = projectFiles ?? (await vscode.workspace.findFiles(
            '**/*.gpl',
            INDEX_EXCLUDE_GLOB
        ));

        if (projectFiles) {
            this.log(`[SymbolCache] Using Project.gpr sources (${filesToIndex.length} files)`);
        } else {
            this.log(`[SymbolCache] Workspace glob: found ${filesToIndex.length} .gpl files`);
        }

        for (const file of filesToIndex) {
            const fsPath = file.fsPath;
            try {
                // Skip .gpo files during indexing — they are compiled binary objects
                if (fsPath.toLowerCase().endsWith('.gpo')) {
                    continue;
                }
                const document = await vscode.workspace.openTextDocument(file);
                this.updateDocument(document);
            } catch (error) {
                this.log(`[SymbolCache] Error loading ${fsPath}: ${error}`);
            }
        }
    }

    /**
     * 프로젝트(`.gpr`) 단위 소스 목록 — 워크스페이스의 각 `.gpr`마다
     * **`ProjectSource` 목록 ∪ 프로젝트 폴더 재귀 스캔**을 모아 돌려준다.
     * 워크스페이스에 `.gpr`가 하나도 없으면 undefined(호출측이 워크스페이스 glob으로 폴백).
     *
     * `ProjectSource`는 폴더 기준 상대 경로여서 `T1\T2\T2.gpl`처럼 하위 폴더가 임의 깊이로
     * 중첩될 수 있다(2026-08-28 실제 파일 확인 — `project/projectSources.ts` 참고).
     * 폴더 재귀 스캔을 합집합으로 두는 이유는 `.gpr`에 아직 추가하지 않은 새 파일도
     * 정의 이동·참조 검색·자동완성에 잡히게 하려는 것이다(참조 검색 범위와 같은 규칙).
     */
    private async getProjectSourcesFromGpr(): Promise<vscode.Uri[] | undefined> {
        try {
            const gprPaths = await findWorkspaceGprPaths();
            this.gprPaths = gprPaths;
            this.compileUnits.setGprPaths(gprPaths);
            if (gprPaths.length === 0) {
                return undefined;
            }

            // 정규화 키 → 원본 경로. `.gpr`마다 같은 파일을 다른 표기로 낼 수 있어
            // (`ProjectSource=` 표기 ↔ 디스크 스캔 표기) 문자열 Set으로는 중복이 걸러지지 않는다.
            // 먼저 들어온 표기를 정본으로 남긴다 — 프로젝트 폴더 재귀 스캔(디스크 표기)이 앞선다.
            const sources = new Map<string, string>();
            let truncatedProjects = 0;

            for (const gprPath of gprPaths) {
                try {
                    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(gprPath));
                    const text = Buffer.from(bytes).toString('utf8');
                    const collected = collectProjectSourcePaths(gprPath, text, {
                        extensions: ['.gpl', '.gpo'],
                    });
                    if (collected.truncated) {
                        truncatedProjects++;
                    }
                    for (const full of collected.files) {
                        const key = normalizePathKey(full);
                        if (!sources.has(key)) {
                            sources.set(key, full);
                        }
                    }
                } catch (e) {
                    this.log(`[SymbolCache] Failed to parse .gpr (${gprPath}): ${e}`);
                }
            }

            if (truncatedProjects > 0) {
                this.log(
                    `[SymbolCache] ⚠ 소스 탐색 상한에 걸린 프로젝트 ${truncatedProjects}개 — `
                    + '일부 파일이 인덱스에서 빠졌습니다.'
                );
            }

            if (sources.size === 0) {
                // .gpr는 있지만 소스를 하나도 모으지 못했다 → 워크스페이스 glob으로 폴백.
                return undefined;
            }

            return Array.from(sources.values()).map(p => vscode.Uri.file(p));
        } catch {
            return undefined;
        }
    }
}
