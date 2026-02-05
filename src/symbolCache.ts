import * as vscode from 'vscode';
import * as path from 'path';
import { GPLParser, GPLSymbol } from './gplParser';
import { isTraceOn } from './config';

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
        // (This avoids jumping between duplicate project copies like workspace root vs Test_robot/)
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
        // Search for the member in the specified class
        // First, try to find exact match with className
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

        // If not found, also search in files that contain the class definition
        // This handles cases where the parser might not set className correctly
        const fallbackCandidates: GPLSymbol[] = [];
        for (const [filePath, fileSymbols] of this.symbols) {
            // Find if this file has the class definition
            const classSymbol = fileSymbols.find(s => s.name === className && s.kind === 'class');
            if (classSymbol) {
                // Look for the member in this file
                for (const s of fileSymbols) {
                    if (
                        s.name === memberName &&
                        (s.kind === 'function' || s.kind === 'sub' || s.kind === 'property') &&
                        s.line > classSymbol.line // Member should be after class definition
                    ) {
                        fallbackCandidates.push(s);
                    }
                }
            }
        }

        const fallbackPick = this.pickBestCandidate(fallbackCandidates, preferredFilePath);
        if (fallbackPick) {
            return fallbackPick;
        }

        return undefined;
    }

    public findMemberInModule(memberName: string, moduleName: string, preferredFilePath?: string): GPLSymbol | undefined {
        // Search for the member in the specified module
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

        const pick = this.pickBestCandidate(candidates, preferredFilePath);
        if (pick) {
            return pick;
        }

        return undefined;
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
                if (s.className !== className) {
                    continue;
                }
                if (s.name !== 'New') {
                    continue;
                }
                if (typeof argCount === 'number') {
                    const paramCount = s.parameters ? s.parameters.length : 0;
                    if (paramCount !== argCount) {
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
        // Higher is better
        if (candidateFilePath === preferredFilePath) {
            return 1000;
        }

        const preferredDir = path.dirname(preferredFilePath);
        if (path.dirname(candidateFilePath) === preferredDir) {
            return 800;
        }

        // Prefer same top-level folder relative to workspace folder
        const ws = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(preferredFilePath));
        if (ws) {
            const relPreferred = path.relative(ws.uri.fsPath, preferredFilePath);
            const relCandidate = path.relative(ws.uri.fsPath, candidateFilePath);
            const topPreferred = relPreferred.split(path.sep)[0];
            const topCandidate = relCandidate.split(path.sep)[0];
            if (topPreferred && topPreferred === topCandidate) {
                return 500;
            }
        }

        return 0;
    }

    public findReferences(symbolName: string): { symbol: GPLSymbol; usages: { line: number; character: number }[] }[] {
        const references: { symbol: GPLSymbol; usages: { line: number; character: number }[] }[] = [];

        for (const [filePath, fileSymbols] of this.symbols) {
            const symbol = fileSymbols.find(s => s.name === symbolName);
            if (symbol) {
                // Read the file content to find usages
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
            if (seenNames.has(symbol.name)) {
                continue;
            }
            seenNames.add(symbol.name);

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

            // Add documentation
            if (symbol.parameters && symbol.parameters.length > 0) {
                item.documentation = `Parameters: ${symbol.parameters.join(', ')}`;
            }
            if (symbol.returnType) {
                item.documentation = (item.documentation || '') + `\nReturns: ${symbol.returnType}`;
            }

            // Add snippet for functions/subs
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

    private async indexWorkspace(): Promise<void> {
        // Prefer Project.gpr-based indexing when available.
        // Many GPL projects are single-folder, and Project.gpr defines the actual compile/reference set.
        // This avoids scanning the entire workspace (which can be huge) when only a handful of sources matter.
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
