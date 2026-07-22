import * as vscode from 'vscode';
import * as path from 'path';
import { GPLParser, GPLSymbol } from './gplParser';
import { isTraceOn, ciEq } from './config';
import { getParameterArity, argCountMatchesArity } from './language/cursorExpression';
import { CallContext, toCallContext, rankOverloadMatches } from './language/overloadResolution';

export class SymbolCache {
    private symbols: Map<string, GPLSymbol[]> = new Map();
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

        const symbols = GPLParser.parseDocument(text, document.uri.fsPath);
        this.symbols.set(document.uri.fsPath, symbols);
        
        const fileName = path.basename(document.uri.fsPath);
        this.log(`[SymbolCache] Updated ${fileName}: ${symbols.length} symbols`);
    }

    /**
     * Remove cached symbols for a file path.
     * This prevents "garbage" symbols from lingering after deletes/renames.
     */
    public removeFile(filePath: string): void {
        const deleted = this.deleteByFsPath(filePath);
        if (deleted) {
            const fileName = path.basename(filePath);
            this.log(`[SymbolCache] Removed ${fileName} from cache`);
        }
    }

    private deleteByFsPath(filePath: string): boolean {
        if (this.symbols.delete(filePath)) {
            return true;
        }

        // Windows paths can differ by casing. If a direct delete fails, try a case-insensitive match.
        const targetLower = filePath.toLowerCase();
        for (const key of this.symbols.keys()) {
            if (key.toLowerCase() === targetLower) {
                return this.symbols.delete(key);
            }
        }

        return false;
    }

    /**
     * fsPath 자체이거나 `fsPath + path.sep`로 시작하는 모든 캐시 항목을 제거한다(대소문자 무시).
     * 폴더 삭제/이름변경 시 하위 파일들의 잔류 심볼을 일괄 정리하는 용도 (extension.ts에서 호출).
     */
    public deleteByFsPathPrefix(fsPath: string): void {
        const targetLower = fsPath.toLowerCase();
        const prefixLower = targetLower.endsWith(path.sep) ? targetLower : targetLower + path.sep;
        for (const key of Array.from(this.symbols.keys())) {
            const keyLower = key.toLowerCase();
            if (keyLower === targetLower || keyLower.startsWith(prefixLower)) {
                this.symbols.delete(key);
            }
        }
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
        // 이름이 일치하는 전체 후보를 먼저 모은다.
        const candidates: GPLSymbol[] = [];
        for (const [, fileSymbols] of this.symbols) {
            for (const sym of fileSymbols) {
                if (ciEq(sym.name, symbolName)) {
                    candidates.push(sym);
                }
            }
        }

        if (candidates.length === 0) {
            return [];
        }

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
            // Windows 경로는 대소문자가 다를 수 있어 무시 비교(deleteByFsPath와 동일 규칙).
            const currentLower = currentFilePath.toLowerCase();
            const inFile = candidates.filter(s => s.filePath.toLowerCase() === currentLower);
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
        // First, try to find exact match with className
        const exactCandidates: GPLSymbol[] = [];
        for (const [, fileSymbols] of this.symbols) {
            for (const s of fileSymbols) {
                if (
                    ciEq(s.name, memberName) &&
                    s.className !== undefined && ciEq(s.className, className) &&
                    // 필드(variable)·상수(constant) 포함 — findMemberCandidatesInClass와 동일 수정.
                    // 호출 문맥(argCount 지정)의 비호출형 제외는 pickBestCallableCandidate가 담당.
                    (s.kind === 'function' || s.kind === 'sub' || s.kind === 'property'
                        || s.kind === 'variable' || s.kind === 'constant')
                ) {
                    exactCandidates.push(s);
                }
            }
        }

        const exactPicks = this.pickCallableMatches(exactCandidates, preferredFilePath, call);
        if (exactPicks.length > 0) {
            return exactPicks;
        }

        // If not found, also search in files that contain the class definition
        // This handles cases where the parser might not set className correctly
        const fallbackCandidates: GPLSymbol[] = [];
        for (const [filePath, fileSymbols] of this.symbols) {
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
        // Search for the member in the specified module
        const candidates: GPLSymbol[] = [];
        for (const [, fileSymbols] of this.symbols) {
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

        return this.pickCallableMatches(candidates, preferredFilePath, call);
    }

    public findConstructorInClass(className: string, argCount?: number, preferredFilePath?: string): GPLSymbol | undefined {
        // In GPL/VB style, constructors are represented as `Sub New(...)`.
        // The parser records these as kind 'sub' with name 'New' and className set.
        const candidates: GPLSymbol[] = [];

        for (const [, fileSymbols] of this.symbols) {
            for (const s of fileSymbols) {
                if (s.kind !== 'sub') {
                    continue;
                }
                if (!s.className || !ciEq(s.className, className)) {
                    continue;
                }
                if (!ciEq(s.name, 'New')) {
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
        }

        // If we tried to match by argCount and found none, fall back to any constructor.
        if (candidates.length === 0 && typeof argCount === 'number') {
            return this.findConstructorInClass(className, undefined, preferredFilePath);
        }

        return this.pickBestCandidate(candidates, preferredFilePath);
    }

    public findMemberCandidatesInClass(memberName: string, className: string): GPLSymbol[] {
        const candidates: GPLSymbol[] = [];
        for (const [, fileSymbols] of this.symbols) {
            for (const s of fileSymbols) {
                if (
                    ciEq(s.name, memberName) &&
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
        }
        return candidates;
    }

    public findMemberCandidatesInModule(memberName: string, moduleName: string): GPLSymbol[] {
        const candidates: GPLSymbol[] = [];
        for (const [, fileSymbols] of this.symbols) {
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
    private pickCallableMatches(candidates: GPLSymbol[], preferredFilePath: string | undefined, call?: number | CallContext): GPLSymbol[] {
        if (candidates.length === 0) {
            return [];
        }

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

    private scoreFilePath(candidateFilePath: string, preferredFilePath: string): number {
        // Higher is better. Windows 경로는 대소문자가 다를 수 있어 무시 비교(deleteByFsPath와 동일 규칙).
        const candidateLower = candidateFilePath.toLowerCase();
        const preferredLower = preferredFilePath.toLowerCase();
        if (candidateLower === preferredLower) {
            return 1000;
        }

        if (path.dirname(candidateLower) === path.dirname(preferredLower)) {
            return 800;
        }

        // Prefer same top-level folder relative to workspace folder
        const ws = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(preferredFilePath));
        if (ws) {
            const relPreferred = path.relative(ws.uri.fsPath, preferredFilePath);
            const relCandidate = path.relative(ws.uri.fsPath, candidateFilePath);
            const topPreferred = relPreferred.split(path.sep)[0];
            const topCandidate = relCandidate.split(path.sep)[0];
            if (topPreferred && topPreferred.toLowerCase() === topCandidate.toLowerCase()) {
                return 500;
            }
        }

        return 0;
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

        for (const filePath of this.symbols.keys()) {
            if (token?.isCancellationRequested) {
                break;
            }

            // 열린 문서 우선(편집 중 내용 유지) — 경로는 Windows 대소문자 무시 비교.
            const fileLower = filePath.toLowerCase();
            const document = vscode.workspace.textDocuments.find(
                (doc: vscode.TextDocument) => doc.uri.fsPath.toLowerCase() === fileLower
            );

            let text: string;
            if (document) {
                text = document.getText();
            } else {
                try {
                    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
                    text = Buffer.from(bytes).toString('utf8');
                } catch {
                    continue; // 삭제/접근 불가 파일은 건너뛴다
                }
            }

            const usages = GPLParser.findSymbolUsages(text, symbolName);
            if (usages.length > 0) {
                references.push({ filePath, usages });
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
        for (const [, fileSymbols] of this.symbols) {
            for (const s of fileSymbols) {
                if (ciEq(s.name, symbolName)) {
                    out.push(s);
                }
            }
        }
        return out;
    }

    public getAllSymbols(): GPLSymbol[] {
        const allSymbols: GPLSymbol[] = [];
        for (const fileSymbols of this.symbols.values()) {
            allSymbols.push(...fileSymbols);
        }
        return allSymbols;
    }

    /**
     * className의 멤버 목록(필드/상수/프로퍼티/메서드) — 멤버 자동완성용.
     * 이름 중복(오버로드)은 첫 항목만, 생성자(New)는 제외한다.
     */
    public getClassMembers(className: string): GPLSymbol[] {
        const target = className.toLowerCase();
        const seen = new Set<string>();
        const members: GPLSymbol[] = [];
        for (const s of this.getAllSymbols()) {
            if (s.kind === 'module') { continue; }
            if (s.kind === 'class') {
                // 중첩 클래스는 바깥 클래스의 멤버로 노출한다 (예: ZeroPlan. → StepBatch).
                if (!s.parentClassName || s.parentClassName.toLowerCase() !== target) { continue; }
            } else if (!s.className || s.className.toLowerCase() !== target) { continue; }
            const key = s.name.toLowerCase();
            if (key === 'new' || seen.has(key)) { continue; }
            seen.add(key);
            members.push(s);
        }
        return members;
    }

    /** moduleName 직속(클래스 밖) 멤버 목록 — 모듈 한정자 자동완성용. 클래스 심볼은 포함한다. */
    public getModuleMembers(moduleName: string): GPLSymbol[] {
        const target = moduleName.toLowerCase();
        const seen = new Set<string>();
        const members: GPLSymbol[] = [];
        for (const s of this.getAllSymbols()) {
            if (!s.module || s.module.toLowerCase() !== target) { continue; }
            if (s.className || s.kind === 'module') { continue; }
            const key = s.name.toLowerCase();
            if (seen.has(key)) { continue; }
            seen.add(key);
            members.push(s);
        }
        return members;
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
            md.appendMarkdown(`\n\n${symbol.docComment.split('\n').map(l => l.trimEnd()).join('  \n')}`);
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
            '{**/node_modules/**,**/bin/**,**/.git/**}'
        ));

        if (projectFiles) {
            this.log(`[SymbolCache] Using Project.gpr sources (${filesToIndex.length} files)`);
        } else {
            this.log(`[SymbolCache] Searching for GPL/GPO files...`);
            this.log(`[SymbolCache] Found ${filesToIndex.length} GPL/GPO files`);
        }

        for (const file of filesToIndex) {
            try {
                const fsPath = (file as vscode.Uri).fsPath ?? String(file);
                // Skip .gpo files during indexing — they are compiled binary objects
                if (fsPath.toLowerCase().endsWith('.gpo')) {
                    continue;
                }
                const document = await vscode.workspace.openTextDocument(file);
                this.updateDocument(document);
            } catch (error) {
                const fsPath = (file as vscode.Uri).fsPath ?? String(file);
                this.log(`[SymbolCache] Error loading ${fsPath}: ${error}`);
            }
        }
    }

    /**
     * Parse Project.gpr files (if present) and return a deduplicated list of source file URIs.
     * Returns undefined when no Project.gpr exists in the workspace.
     */
    private async getProjectSourcesFromGpr(): Promise<vscode.Uri[] | undefined> {
        try {
            const gprFiles = await vscode.workspace.findFiles(
                '**/Project.gpr',
                '{**/node_modules/**,**/bin/**,**/.git/**}'
            );

            if (!gprFiles || gprFiles.length === 0) {
                return undefined;
            }

            const sources = new Set<string>();

            for (const gprUri of gprFiles) {
                try {
                    const bytes = await vscode.workspace.fs.readFile(gprUri);
                    const text = Buffer.from(bytes).toString('utf8');

                    // ProjectSource="file.gpl" (also accept single quotes)
                    const re = /ProjectSource\s*=\s*["']([^"']+)["']/gi;
                    let match: RegExpExecArray | null;
                    while ((match = re.exec(text)) !== null) {
                        const raw = (match[1] || '').trim();
                        if (!raw) {
                            continue;
                        }

                        const resolved = path.isAbsolute(raw)
                            ? raw
                            : path.join(path.dirname(gprUri.fsPath), raw);

                        const lower = resolved.toLowerCase();
                        if (!lower.endsWith('.gpl') && !lower.endsWith('.gpo')) {
                            continue;
                        }
                        sources.add(resolved);
                    }
                } catch (e) {
                    this.log(`[SymbolCache] Failed to parse Project.gpr (${gprUri.fsPath}): ${e}`);
                }
            }

            if (sources.size === 0) {
                // Project.gpr exists but had no ProjectSource entries; fall back to glob.
                return undefined;
            }

            return Array.from(sources).map(p => vscode.Uri.file(p));
        } catch {
            return undefined;
        }
    }
}
