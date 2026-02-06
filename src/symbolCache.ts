import * as vscode from 'vscode';
import { GPLParser, GPLSymbol } from './gplParser';
import { isTraceOn } from './config';

// Re-export GPLSymbol for convenience
export { GPLSymbol } from './gplParser';

export class SymbolCache {
    private symbols: Map<string, GPLSymbol[]> = new Map();
    private outputChannel?: vscode.OutputChannel;

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
        this.symbols.clear();
        await this.indexWorkspace();
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

        const symbols = GPLParser.parseDocument(document.getText(), document.uri.fsPath);
        this.symbols.set(document.uri.fsPath, symbols);
        
        const fileName = document.uri.fsPath.split('\\').pop() || document.uri.fsPath;
        this.log(`[SymbolCache] Updated ${fileName}: ${symbols.length} symbols`);
    }

    /**
     * Remove cached symbols for a file path.
     * This prevents "garbage" symbols from lingering after deletes/renames.
     */
    public removeFile(filePath: string): void {
        const deleted = this.deleteByFsPath(filePath);
        if (deleted) {
            const fileName = filePath.split('\\').pop() || filePath;
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

    public findDefinition(symbolName: string, currentFilePath?: string): GPLSymbol | undefined {
        // First, search in the current file
        if (currentFilePath && this.symbols.has(currentFilePath)) {
            const fileSymbols = this.symbols.get(currentFilePath)!;
            const localSymbol = fileSymbols.find(s => s.name === symbolName);
            if (localSymbol) {
                return localSymbol;
            }
        }

        // Then search in all files, preferring files closer to the current file path
        const candidates: GPLSymbol[] = [];
        for (const [, fileSymbols] of this.symbols) {
            for (const sym of fileSymbols) {
                if (sym.name === symbolName) {
                    candidates.push(sym);
                }
            }
        }

        if (candidates.length === 0) {
            return undefined;
        }

        return this.pickBestCandidate(candidates, currentFilePath);
    }

    public findMemberInClass(memberName: string, className: string, preferredFilePath?: string): GPLSymbol | undefined {
        const exactCandidates: GPLSymbol[] = [];
        for (const [, fileSymbols] of this.symbols) {
            for (const s of fileSymbols) {
                if (
                    s.name === memberName &&
                    s.className === className &&
                    (s.kind === 'function' || s.kind === 'sub' || s.kind === 'property')
                ) {
                    exactCandidates.push(s);
                }
            }
        }
        const exactPick = this.pickBestCandidate(exactCandidates, preferredFilePath);
        if (exactPick) {
            return exactPick;
        }

        // Fallback: search in files that contain the class definition
        const fallbackCandidates: GPLSymbol[] = [];
        for (const [, fileSymbols] of this.symbols) {
            const classSymbol = fileSymbols.find(s => s.name === className && s.kind === 'class');
            if (classSymbol) {
                for (const s of fileSymbols) {
                    if (
                        s.name === memberName &&
                        (s.kind === 'function' || s.kind === 'sub' || s.kind === 'property') &&
                        s.line > classSymbol.line
                    ) {
                        fallbackCandidates.push(s);
                    }
                }
            }
        }

        return this.pickBestCandidate(fallbackCandidates, preferredFilePath);
    }

    public findMemberInModule(memberName: string, moduleName: string, preferredFilePath?: string): GPLSymbol | undefined {
        const candidates: GPLSymbol[] = [];
        for (const [, fileSymbols] of this.symbols) {
            for (const s of fileSymbols) {
                if (
                    s.name === memberName &&
                    s.module === moduleName &&
                    !s.className &&
                    (s.kind === 'function' || s.kind === 'sub' || s.kind === 'constant' || s.kind === 'variable')
                ) {
                    candidates.push(s);
                }
            }
        }

        return this.pickBestCandidate(candidates, preferredFilePath);
    }

    public findConstructorInClass(className: string, argCount?: number, preferredFilePath?: string): GPLSymbol | undefined {
        const candidates: GPLSymbol[] = [];

        for (const [, fileSymbols] of this.symbols) {
            for (const s of fileSymbols) {
                if (s.kind !== 'sub') continue;
                if (s.className !== className) continue;
                if (s.name !== 'New') continue;
                if (typeof argCount === 'number') {
                    const paramCount = s.parameters ? s.parameters.length : 0;
                    if (paramCount !== argCount) continue;
                }

                candidates.push(s);
            }
        }

        if (candidates.length === 0 && typeof argCount === 'number') {
            return this.findConstructorInClass(className, undefined, preferredFilePath);
        }

        return this.pickBestCandidate(candidates, preferredFilePath);
    }

    private pickBestCandidate(candidates: GPLSymbol[], preferredFilePath?: string): GPLSymbol | undefined {
        if (candidates.length === 0) return undefined;
        if (!preferredFilePath) return candidates[0];

        const scored = candidates
            .map(sym => ({ sym, score: this.scoreFilePath(sym.filePath, preferredFilePath) }))
            .sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                if (a.sym.filePath !== b.sym.filePath) return a.sym.filePath.localeCompare(b.sym.filePath);
                return a.sym.line - b.sym.line;
            });

        return scored[0].sym;
    }

    private scoreFilePath(candidateFilePath: string, preferredFilePath: string): number {
        if (candidateFilePath === preferredFilePath) return 1000;

        const preferredUri = vscode.Uri.file(preferredFilePath);
        const candidateUri = vscode.Uri.file(candidateFilePath);
        const preferredDir = vscode.Uri.file(preferredUri.fsPath).with({ path: preferredUri.fsPath.substring(0, preferredUri.fsPath.lastIndexOf('/')) });
        const candidateDir = vscode.Uri.file(candidateUri.fsPath).with({ path: candidateUri.fsPath.substring(0, candidateUri.fsPath.lastIndexOf('/')) });
        if (candidateDir.fsPath === preferredDir.fsPath) return 800;

        const ws = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(preferredFilePath));
        if (ws) {
            const relPreferred = vscode.workspace.asRelativePath(preferredFilePath);
            const relCandidate = vscode.workspace.asRelativePath(candidateFilePath);
            const separator = process.platform === 'win32' ? '\\' : '/';
            const topPreferred = relPreferred.split(separator)[0];
            const topCandidate = relCandidate.split(separator)[0];
            if (topPreferred && topPreferred === topCandidate) return 500;
        }

        return 0;
    }

    public findReferences(symbolName: string): { symbol: GPLSymbol; usages: { line: number; character: number }[] }[] {
        const references: { symbol: GPLSymbol; usages: { line: number; character: number }[] }[] = [];

        for (const [filePath, fileSymbols] of this.symbols) {
            const symbol = fileSymbols.find(s => s.name === symbolName);
            if (symbol) {
                const document = vscode.workspace.textDocuments.find((doc: vscode.TextDocument) => doc.uri.fsPath === filePath);
                if (document) {
                    const usages = GPLParser.findSymbolUsages(document.getText(), symbolName);
                    if (usages.length > 0) {
                        references.push({ symbol, usages });
                    }
                }
            }
        }

        return references;
    }

    public getAllSymbols(): GPLSymbol[] {
        const allSymbols: GPLSymbol[] = [];
        for (const fileSymbols of this.symbols.values()) {
            allSymbols.push(...fileSymbols);
        }
        return allSymbols;
    }

    public getCompletionItems(currentModule?: string, currentClass?: string): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];
        const seenNames = new Set<string>();

        for (const symbol of this.getAllSymbols()) {
            if (seenNames.has(symbol.name)) continue;
            seenNames.add(symbol.name);

            const item = new vscode.CompletionItem(symbol.name, this.getCompletionItemKind(symbol.kind));
            
            let detail: string = symbol.kind;
            if (symbol.module) {
                detail += ` (${symbol.module}`;
                if (symbol.className) {
                    detail += `.${symbol.className}`;
                }
                detail += ')';
            }
            item.detail = detail;

            if (symbol.parameters && symbol.parameters.length > 0) {
                item.documentation = `Parameters: ${symbol.parameters.join(', ')}`;
            }
            if (symbol.returnType) {
                item.documentation = (item.documentation || '') + `\nReturns: ${symbol.returnType}`;
            }

            if ((symbol.kind === 'function' || symbol.kind === 'sub') && symbol.parameters) {
                const params = symbol.parameters.map((param, index) => `\${${index + 1}:${param}}`).join(', ');
                item.insertText = new vscode.SnippetString(`${symbol.name}(${params})`);
            }

            items.push(item);
        }

        return items;
    }

    private getCompletionItemKind(symbolKind: string): vscode.CompletionItemKind {
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

    public async indexWorkspace(): Promise<void> {
        const projectFiles = await this.getProjectSourcesFromGpr();

        const filesToIndex = projectFiles ?? (await vscode.workspace.findFiles(
            '{**/*.gpl,**/*.gpo}',
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
                const document = await vscode.workspace.openTextDocument(file);
                this.updateDocument(document);
            } catch (error) {
                const fsPath = (file as vscode.Uri).fsPath ?? String(file);
                this.log(`[SymbolCache] Error loading ${fsPath}: ${error}`);
            }
        }
    }

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
                    const text = new TextDecoder('utf-8').decode(bytes);

                    const re = /ProjectSource\s*=\s*["']([^"']+)["']/gi;
                    let match: RegExpExecArray | null;
                    while ((match = re.exec(text)) !== null) {
                        const raw = (match[1] || '').trim();
                        if (!raw) continue;

                        const isAbsolute = raw.indexOf(':') > 0 || raw.startsWith('/');
                        const resolved = isAbsolute
                            ? raw
                            : vscode.Uri.joinPath(vscode.Uri.file(gprUri.fsPath + '/..'), raw).fsPath;

                        const lower = resolved.toLowerCase();
                        if (!lower.endsWith('.gpl') && !lower.endsWith('.gpo')) continue;
                        sources.add(resolved);
                    }
                } catch (e) {
                    this.log(`[SymbolCache] Failed to parse Project.gpr (${gprUri.fsPath}): ${e}`);
                }
            }

            if (sources.size === 0) {
                return undefined;
            }

            return Array.from(sources).map(p => vscode.Uri.file(p));
        } catch {
            return undefined;
        }
    }

    /**
     * Update symbols for a specific file
     */
    public async updateFile(filePath: string): Promise<void> {
        try {
            const uri = vscode.Uri.file(filePath);
            const document = await vscode.workspace.openTextDocument(uri);
            this.updateDocument(document);
        } catch (error) {
            this.log(`[SymbolCache] Error updating file ${filePath}: ${error}`);
        }
    }

    /**
     * Get all symbols in a specific module
     */
    public getSymbolsByModule(moduleName: string): GPLSymbol[] {
        const result: GPLSymbol[] = [];
        const moduleNameUpper = moduleName.toUpperCase();

        for (const symbols of this.symbols.values()) {
            for (const symbol of symbols) {
                if (symbol.module?.toUpperCase() === moduleNameUpper) {
                    result.push(symbol);
                }
            }
        }

        return result;
    }
}
