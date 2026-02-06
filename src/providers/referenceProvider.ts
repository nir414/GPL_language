import * as vscode from 'vscode';
import { SymbolCache, GPLSymbol } from '../symbolCache';
import { GPLParser } from '../gplParser';
import { isTraceVerbose } from '../config';
import * as PATH from 'path';

export class GPLReferenceProvider implements vscode.ReferenceProvider {
    private static readonly PROVIDER_VERSION = '0.2.11';

    constructor(
        private symbolCache: SymbolCache,
        private outputChannel?: vscode.OutputChannel
    ) {}

    private log(message: string) {
        if (!isTraceVerbose(vscode.workspace)) {
            return;
        }
        if (this.outputChannel) {
            this.outputChannel.appendLine(message);
        }
    }

    async provideReferences(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.ReferenceContext,
        token: vscode.CancellationToken
    ): Promise<vscode.Location[] | undefined> {
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return undefined;
        }

        const word = document.getText(wordRange);
        const line = document.lineAt(position.line).text;
        
        this.log(`\n[Reference Request] v${GPLReferenceProvider.PROVIDER_VERSION} | Word: "${word}" | Line: "${line.trim()}"`);

        // Skip numeric literals (e.g. 0, 1, 100, 3.14) - they are not symbols
        if (/^\d+(\.\d+)?$/.test(word)) {
            this.log(`[Skip] Numeric literal "${word}"`);
            return [];
        }

        // Get definition to determine search scope
        const symbol = this.symbolCache.findDefinition(word, document.uri.fsPath);

        if (!symbol) {
            this.log(`[Symbol NOT Found] "${word}" - trying local parse fallback`);
            
            try {
                const localSymbols = GPLParser.parseDocument(document.getText(), document.uri.fsPath);
                const local = localSymbols.find(s => s.name === word);

                if (!local) {
                    this.log(`[Local Parse Fail] Symbol "${word}" not found`);
                    return [];
                }

                this.log(`[Local Symbol Found] ${local.name} | Kind: ${local.kind}`);
                
                // If it's a local/private symbol, search only in current file
                if (local.kind === 'function' || local.kind === 'sub' || local.kind === 'variable') {
                    this.log(`[Scope] Local-only search for ${local.kind}`);
                    return this.findReferencesInFile(document, word);
                }
            } catch (error) {
                this.log(`[Error] Local parse failed: ${error}`);
                return [];
            }
        } else {
            this.log(`[Symbol Found] ${symbol.name} | Kind: ${symbol.kind} | Module: ${symbol.module || 'N/A'} | Class: ${symbol.className || 'N/A'}`);
        }

        const locations: vscode.Location[] = [];

        // Determine if this is a public module member (potential workspace-wide search)
        const isPublicModuleMember = symbol && 
            symbol.module && 
            !symbol.className &&
            (symbol.kind === 'function' || symbol.kind === 'sub');

        this.log(`[Public Module Member?] ${isPublicModuleMember ? 'YES' : 'NO'}`);

        if (isPublicModuleMember) {
            // Search for both qualified and unqualified patterns
            this.log(`[Search Strategy] Workspace-wide for public member`);
            
            // Pattern 1: Unqualified call (e.g., "FunctionName(")
            const unqualifiedPattern = new RegExp(`\\b${this.escapeRegex(word)}\\s*\\(`, 'gi');
            
            // Pattern 2: Qualified call (e.g., "ModuleName.FunctionName(")
            const qualifiedPattern = symbol.module 
                ? new RegExp(`\\b${this.escapeRegex(symbol.module)}\\.${this.escapeRegex(word)}\\s*\\(`, 'gi')
                : null;

            const workspaceLocations = await this.searchInWorkspace(word, unqualifiedPattern, qualifiedPattern);
            locations.push(...workspaceLocations);

        } else if (symbol?.module) {
            // Module-level symbol (not public function/sub) - search within module files
            this.log(`[Search Strategy] Module-scoped search for "${symbol.module}"`);
            const moduleFiles = this.symbolCache.getSymbolsByModule(symbol.module);
            
            for (const moduleSymbol of moduleFiles) {
                try {
                    const uri = vscode.Uri.file(moduleSymbol.filePath);
                    const doc = await vscode.workspace.openTextDocument(uri);
                    const fileLocations = this.findReferencesInFile(doc, word);
                    locations.push(...fileLocations);
                } catch (error) {
                    this.log(`[Error] Failed to read ${moduleSymbol.filePath}: ${error}`);
                }
            }

        } else if (symbol?.className) {
            // Class member - search for "obj.member" pattern
            this.log(`[Search Strategy] Class member search for "${symbol.className}.${word}"`);
            
            // Pattern: objectName.memberName
            const memberPattern = new RegExp(`\\b\\w+\\.${this.escapeRegex(word)}\\b`, 'gi');
            
            const workspaceLocations = await this.searchInWorkspace(word, memberPattern, null);
            locations.push(...workspaceLocations);

        } else {
            // Fallback: local or unknown scope
            this.log(`[Search Strategy] Local file search only`);
            const fileLocations = this.findReferencesInFile(document, word);
            locations.push(...fileLocations);
        }

        this.log(`[Result] Found ${locations.length} reference(s)`);
        return locations;
    }

    /**
     * Search for references in workspace using VS Code's native search
     */
    private async searchInWorkspace(
        word: string,
        unqualifiedPattern: RegExp | null,
        qualifiedPattern: RegExp | null
    ): Promise<vscode.Location[]> {
        const locations: vscode.Location[] = [];

        // Check if findTextInFiles is available (VS Code 1.86+)
        const wsAny: any = vscode.workspace as any;
        if (typeof wsAny.findTextInFiles !== 'function') {
            this.log(`[Warning] findTextInFiles API not available, using fallback`);
            return this.searchInWorkspaceFallback(word);
        }

        try {
            const searchPatterns: RegExp[] = [];
            if (unqualifiedPattern) searchPatterns.push(unqualifiedPattern);
            if (qualifiedPattern) searchPatterns.push(qualifiedPattern);

            for (const pattern of searchPatterns) {
                this.log(`[Workspace Search] Pattern: ${pattern.source}`);
                
                const searchOptions = {
                    include: '**/*.gpl',
                    exclude: '**/node_modules/**',
                    useRegExp: true,
                    isRegExp: true,
                    isCaseSensitive: false,
                    maxResults: 10000
                };

                const results = await wsAny.findTextInFiles(
                    { pattern: pattern.source },
                    searchOptions,
                    (result: any) => {
                        // Progress callback
                        this.log(`[Match] ${result.uri.fsPath}:${result.ranges[0].start.line + 1}`);
                    }
                );

                for (const result of results) {
                    const uri = result.uri;
                    for (const match of result.ranges) {
                        locations.push(new vscode.Location(uri, match));
                    }
                }
            }

        } catch (error) {
            this.log(`[Error] Workspace search failed: ${error}`);
            return this.searchInWorkspaceFallback(word);
        }

        return locations;
    }

    /**
     * Fallback method when findTextInFiles is not available
     */
    private async searchInWorkspaceFallback(word: string): Promise<vscode.Location[]> {
        this.log(`[Fallback] Searching workspace files manually`);
        
        const locations: vscode.Location[] = [];
        const workspaceFolders = vscode.workspace.workspaceFolders;

        if (!workspaceFolders) {
            this.log(`[Fallback] No workspace folders`);
            return this.searchInFolderFallback(word);
        }

        try {
            const gplFiles = await vscode.workspace.findFiles('**/*.gpl', '**/node_modules/**', 10000);
            this.log(`[Fallback] Found ${gplFiles.length} GPL files`);

            for (const uri of gplFiles) {
                try {
                    const doc = await vscode.workspace.openTextDocument(uri);
                    const fileLocations = this.findReferencesInFile(doc, word);
                    locations.push(...fileLocations);
                } catch (error) {
                    this.log(`[Fallback Error] Failed to read ${uri.fsPath}: ${error}`);
                }
            }
        } catch (error) {
            this.log(`[Fallback Error] findFiles failed: ${error}`);
        }

        return locations;
    }

    /**
     * Last resort: search in current folder when no workspace is open
     */
    private async searchInFolderFallback(word: string): Promise<vscode.Location[]> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            this.log(`[No Editor] Cannot determine folder`);
            return [];
        }

        const currentDir = PATH.dirname(editor.document.uri.fsPath);
        this.log(`[Folder Fallback] Searching in ${currentDir}`);

        const locations: vscode.Location[] = [];

        try {
            const fs = await import('fs');
            const files = fs.readdirSync(currentDir)
                .filter(f => f.toLowerCase().endsWith('.gpl'))
                .slice(0, 200); // Limit to 200 files

            this.log(`[Folder Fallback] Found ${files.length} GPL files`);

            for (const file of files) {
                try {
                    const uri = vscode.Uri.file(PATH.join(currentDir, file));
                    const doc = await vscode.workspace.openTextDocument(uri);
                    const fileLocations = this.findReferencesInFile(doc, word);
                    locations.push(...fileLocations);
                } catch (error) {
                    this.log(`[Folder Fallback Error] ${file}: ${error}`);
                }
            }
        } catch (error) {
            this.log(`[Folder Fallback Error] readdir failed: ${error}`);
        }

        return locations;
    }

    /**
     * Find all references in a single file
     */
    private findReferencesInFile(document: vscode.TextDocument, word: string): vscode.Location[] {
        const locations: vscode.Location[] = [];
        const text = document.getText();
        const wordPattern = new RegExp(`\\b${this.escapeRegex(word)}\\b`, 'gi');

        let match: RegExpExecArray | null;
        while ((match = wordPattern.exec(text)) !== null) {
            const position = document.positionAt(match.index);
            const range = new vscode.Range(
                position,
                new vscode.Position(position.line, position.character + word.length)
            );
            locations.push(new vscode.Location(document.uri, range));
        }

        return locations;
    }

    /**
     * Escape regex special characters
     */
    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}
