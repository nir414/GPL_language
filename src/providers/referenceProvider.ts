import * as vscode from 'vscode';
import * as path from 'path';
import { SymbolCache } from '../symbolCache';
import { GPLParser, GPLSymbol } from '../gplParser';
import { isTraceVerbose } from '../config';

export class GPLReferenceProvider implements vscode.ReferenceProvider {
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

    private escapeRegExp(text: string): string {
        // Escape characters that have special meaning in RegExp.
        return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    private tryGetDefinitionSymbolAtPosition(
        document: vscode.TextDocument,
        position: vscode.Position,
        word: string,
        wordRange: vscode.Range
    ): GPLSymbol | undefined {
        try {
            const localSymbols = GPLParser.parseDocument(document.getText(), document.uri.fsPath);
            const inLine = localSymbols.filter(s => s.name === word && s.line === position.line);

            // Prefer the symbol whose indexed range covers the cursor.
            const covering = inLine.find(s => {
                const start = Math.max(0, s.range?.start ?? 0);
                const end = Math.max(start, s.range?.end ?? start);
                return wordRange.start.character >= start && wordRange.start.character <= end;
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

    private isQualifiedAt(text: string, matchIndex: number): boolean {
        // True if the identifier at matchIndex is preceded (ignoring whitespace) by a dot.
        for (let i = matchIndex - 1; i >= 0; i--) {
            const ch = text[i];
            if (ch === ' ' || ch === '\t') {
                continue;
            }
            return ch === '.';
        }
        return false;
    }

    private isInWorkspace(uri: vscode.Uri): boolean {
        try {
            return !!vscode.workspace.getWorkspaceFolder(uri);
        } catch {
            return false;
        }
    }

    // NOTE:
    // - `workspace.findTextInFiles` is available in newer VS Code versions, but some @types/vscode
    //   versions used by this repo don't include its typings.
    // - We therefore use runtime feature detection + lightweight local typings.
    private async findTextInWorkspace(
        query: { pattern: string; isRegExp?: boolean; isCaseSensitive?: boolean; isWordMatch?: boolean },
        token: vscode.CancellationToken,
        onMatch: (r: { uri: vscode.Uri; ranges: vscode.Range[] }) => void,
        opts?: { include?: string; exclude?: string; useIgnoreFiles?: boolean; maxResults?: number }
    ): Promise<boolean> {
        return new Promise((resolve) => {
            try {
                const wsAny: any = vscode.workspace as any;
                if (typeof wsAny.findTextInFiles !== 'function') {
                    resolve(false);
                    return;
                }

                wsAny.findTextInFiles(
                    query,
                    {
                        // GPL 프로젝트는 엔트리/라이브러리로 .gpo를 함께 쓰는 경우가 많음.
                        // 참조 검색은 .gpl 뿐 아니라 .gpo도 함께 스캔해야 누락이 줄어든다.
                        include: '{**/*.gpl,**/*.gpo}',
                        exclude: '{**/bin/**,**/node_modules/**,**/.git/**}',
                        useIgnoreFiles: true,
                        ...opts
                    },
                    (result: any) => {
                        if (token.isCancellationRequested) {
                            return;
                        }
                        if (!result || !result.uri || !result.ranges || !result.ranges[0]) {
                            return;
                        }
                        onMatch({ uri: result.uri, ranges: result.ranges });
                    }
                ).then(
                    () => resolve(true),
                    () => resolve(true)
                );
            } catch {
                resolve(false);
            }
        });
    }

    async provideReferences(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.ReferenceContext,
        token: vscode.CancellationToken
    ): Promise<vscode.Location[]> {
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return [];
        }

        const word = document.getText(wordRange);

        // Detect qualified access like Module.Member where the cursor is on Member.
        const lineText = document.lineAt(position.line).text;
        const beforeWord = lineText.substring(0, wordRange.start.character).trimEnd();
        const dotMatch = beforeWord.match(/(\w+)\s*\.$/);
        const qualifier = dotMatch ? dotMatch[1] : undefined;

        // If the cursor is on a qualified member access like obj.Member, the "obj" part is usually
        // a variable, not the defining type/module. Restricting references to only "obj.Member" is
        // not what users expect for class members.
        // We only treat qualifiers as authoritative when they resolve to a Module or Class symbol.
        const qualifierSymbol = qualifier
            ? this.symbolCache.findDefinition(qualifier, document.uri.fsPath)
            : undefined;
        const isAuthoritativeQualifier = qualifierSymbol?.kind === 'module' || qualifierSymbol?.kind === 'class';

        // If cursor is on a procedure definition, capture its module/class scope.
        const defSymbol = this.tryGetDefinitionSymbolAtPosition(document, position, word, wordRange);

        const targetFilePath = defSymbol?.filePath;
        const targetModule = defSymbol?.module;
        const targetClass = defSymbol?.className;
        const targetAccess = defSymbol?.accessModifier;

        this.log(
            `[References] word="${word}" qualifier=${qualifier || 'N/A'} defScope=` +
                `${targetModule || 'N/A'}${targetClass ? '.' + targetClass : ''}` +
                ` access=${targetAccess || 'N/A'} file=${targetFilePath ? targetFilePath.split('\\').pop() : 'N/A'}`
        );

        // Scope-aware search strategy:
        // - If cursor is on Module.Member (qualified), search ONLY for that qualified pattern.
        // - If cursor is on a module-level definition (e.g., Private Sub X), search:
        //   - unqualified "X" only within the defining file (to avoid mixing other modules)
        //   - qualified "Module.X" across the workspace for external callers
        // - Otherwise (ambiguous), fall back to name-only search.

        const escapedWord = this.escapeRegExp(word);
        const escapedQualifier = qualifier ? this.escapeRegExp(qualifier) : undefined;
        const escapedModule = targetModule ? this.escapeRegExp(targetModule) : undefined;
        const escapedClass = targetClass ? this.escapeRegExp(targetClass) : undefined;

        const qualifiedRegex = (q: string) => new RegExp(`\\b${q}\\s*\\.\\s*${escapedWord}\\b`, 'gi');
        const qualifiedPattern = (q: string) => `\\b${q}\\s*\\.\\s*${escapedWord}\\b`;
        const anyQualifierPattern = `\\b\\w+\\s*\\.\\s*${escapedWord}\\b`;
        const unqualifiedRegex = new RegExp(`\\b${escapedWord}\\b`, 'gi');
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
        const shouldRestrictUnqualifiedToDefFile =
            !!targetFilePath && (isClassMember || isPrivateModuleLevelMember);

        const shouldPreferQualifiedOnly = !!escapedQualifier && isAuthoritativeQualifier;
        const shouldAlsoSearchModuleQualified = !shouldPreferQualifiedOnly && !!escapedModule && !targetClass;
        const shouldAlsoSearchClassQualified = !shouldPreferQualifiedOnly && !!escapedClass && !!targetClass;

        const locations: vscode.Location[] = [];
        const seen = new Set<string>();
        let localHits = 0;
        let workspaceHits = 0;
        let folderFallbackHits = 0;
        let folderFallbackRan = false;

        const addLocation = (uri: vscode.Uri, range: vscode.Range): boolean => {
            const key = `${uri.toString()}:${range.start.line}:${range.start.character}:${range.end.line}:${range.end.character}`;
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            locations.push(new vscode.Location(uri, range));
            return true;
        };

        const scanDocumentText = (doc: vscode.TextDocument, re: RegExp, opts: { unqualifiedOnly?: boolean }): number => {
            const text = doc.getText();
            let added = 0;
            re.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = re.exec(text)) !== null) {
                if (token.isCancellationRequested) {
                    break;
                }
                if (opts.unqualifiedOnly && this.isQualifiedAt(text, match.index)) {
                    continue;
                }
                const full = match[0];
                const memberOffset = full.toLowerCase().lastIndexOf(word.toLowerCase());
                const startIndex = match.index + (memberOffset >= 0 ? memberOffset : 0);
                const endIndex = startIndex + word.length;
                const range = new vscode.Range(doc.positionAt(startIndex), doc.positionAt(endIndex));
                if (shouldSkipAsDeclaration(doc.uri, range, doc)) {
                    continue;
                }
                if (addLocation(doc.uri, range)) {
                    added += 1;
                }
            }
            return added;
        };

        const shouldSkipAsDeclaration = (uri: vscode.Uri, range: vscode.Range, doc: vscode.TextDocument): boolean => {
            if (context.includeDeclaration) {
                return false;
            }
            if (!defSymbol) {
                return false;
            }
            if (uri.fsPath !== defSymbol.filePath) {
                return false;
            }
            if (range.start.line !== defSymbol.line) {
                return false;
            }

            // Best-effort: skip the first occurrence of the word on the defining line.
            const lineText = doc.lineAt(defSymbol.line).text;
            const firstIdx = lineText.toLowerCase().indexOf(word.toLowerCase());
            if (firstIdx < 0) {
                return false;
            }
            return range.start.character === firstIdx;
        };

        // Always scan the current document directly (covers files outside the workspace).
        // We keep the old local scan semantics but limit it to the most relevant patterns.
        try {
            const scanLocal = (re: RegExp, opts: { unqualifiedOnly?: boolean }) => {
                localHits += scanDocumentText(document, re, opts);
            };

            if (shouldPreferQualifiedOnly && escapedQualifier) {
                scanLocal(qualifiedRegex(escapedQualifier), {});
            } else {
                if (shouldAlsoSearchModuleQualified && escapedModule) {
                    scanLocal(qualifiedRegex(escapedModule), {});
                }
                if (shouldAlsoSearchClassQualified && escapedClass) {
                    scanLocal(qualifiedRegex(escapedClass), {});
                }
                if (shouldRestrictUnqualifiedToDefFile && targetFilePath && document.uri.fsPath === targetFilePath) {
                    scanLocal(unqualifiedRegex, { unqualifiedOnly: true });
                }
                if (isClassMember) {
                    // For class members, instance-qualified usages are the common cross-file pattern.
                    scanLocal(new RegExp(anyQualifierPattern, 'gi'), {});
                }
                if (!shouldRestrictUnqualifiedToDefFile && !isClassMember) {
                    scanLocal(unqualifiedRegex, { unqualifiedOnly: false });
                }
            }
        } catch {
            // ignore local scan errors
        }

        // Workspace-wide search using VS Code's search engine (ripgrep) for performance.
        try {
            const matchedDocs = new Map<string, vscode.TextDocument>();
            const getDoc = async (uri: vscode.Uri): Promise<vscode.TextDocument> => {
                const key = uri.toString();
                const cached = matchedDocs.get(key);
                if (cached) {
                    return cached;
                }
                const d = await vscode.workspace.openTextDocument(uri);
                matchedDocs.set(key, d);
                return d;
            };

            const handleMatch = async (r: { uri: vscode.Uri; ranges: vscode.Range[] }, opts: { unqualifiedOnly?: boolean }) => {
                if (token.isCancellationRequested) {
                    return;
                }

                const uri = r.uri;

                // Private/module-local rules: avoid scanning other files for unqualified matches.
                const isDefFile = targetFilePath && uri.fsPath === targetFilePath;
                if (
                    targetAccess === 'private' &&
                    shouldRestrictUnqualifiedToDefFile &&
                    !isDefFile &&
                    opts.unqualifiedOnly
                ) {
                    return;
                }

                const doc = await getDoc(uri);
                const text = doc.getText();
                const range = r.ranges[0];
                const startOffset = doc.offsetAt(range.start);

                if (opts.unqualifiedOnly && this.isQualifiedAt(text, startOffset)) {
                    return;
                }
                if (shouldSkipAsDeclaration(uri, range, doc)) {
                    return;
                }
                if (addLocation(uri, range)) {
                    workspaceHits += 1;
                }
            };

            // Collect results synchronously-ish by awaiting the overall search promise.
            const pending: Promise<void>[] = [];
            const enqueue = (p: Promise<void>) => {
                pending.push(p.catch(() => undefined));
            };

            const runQuery = async (pattern: string, opts: { unqualifiedOnly?: boolean }) => {
                const ok = await this.findTextInWorkspace(
                    { pattern, isRegExp: true, isCaseSensitive: false },
                    token,
                    (r) => enqueue(handleMatch(r, opts)),
                    { maxResults: 5000 }
                );
                return ok;
            };

            // If the API isn't available, we'll skip this whole fast-path and rely on cache fallback.
            // (Local scan above still helps for out-of-workspace files.)
            let anySearchRan = false;

            if (shouldPreferQualifiedOnly && escapedQualifier) {
                anySearchRan = (await runQuery(qualifiedPattern(escapedQualifier), {})) || anySearchRan;
            } else {
                // 1) Scope-aware qualified patterns
                if (shouldAlsoSearchModuleQualified && escapedModule) {
                    anySearchRan = (await runQuery(qualifiedPattern(escapedModule), {})) || anySearchRan;
                }
                if (shouldAlsoSearchClassQualified && escapedClass) {
                    anySearchRan = (await runQuery(qualifiedPattern(escapedClass), {})) || anySearchRan;
                }

                // 2) Class member: instance-qualified pattern across workspace
                if (isClassMember) {
                    anySearchRan = (await runQuery(anyQualifierPattern, {})) || anySearchRan;
                }

                // 3) Unqualified pattern, restricted to defining file when scope is known
                if (shouldRestrictUnqualifiedToDefFile && targetFilePath) {
                    anySearchRan = (await runQuery(unqualifiedPattern, { unqualifiedOnly: true })) || anySearchRan;
                } else if (!isClassMember) {
                    // Ambiguous: name-only scan (older behavior)
                    anySearchRan = (await runQuery(unqualifiedPattern, { unqualifiedOnly: false })) || anySearchRan;
                }
            }

            if (anySearchRan) {
                await Promise.all(pending);
            }
        } catch {
            // Ignore and fall back to cache-based approach.
        }

        // Folder fallback: if workspace search returned no results outside current document,
        // try scanning the same directory for sibling .gpl files.
        try {
            const targetUri = targetFilePath ? vscode.Uri.file(targetFilePath) : document.uri;
            const targetInWorkspace = this.isInWorkspace(targetUri);
            const docInWorkspace = this.isInWorkspace(document.uri);

            const hasNonDocumentLocations = locations.some(l => l.uri.fsPath !== document.uri.fsPath);
            this.log(
                `[References] workspaceCheck: targetInWorkspace=${targetInWorkspace}, docInWorkspace=${docInWorkspace}, ` +
                    `hasNonDocumentLocations=${hasNonDocumentLocations}, target=${targetUri.fsPath}, doc=${document.uri.fsPath}`
            );
            
            // Run folder fallback if no external references were found yet
            if (!token.isCancellationRequested && !hasNonDocumentLocations) {
                folderFallbackRan = true;
                const dirFsPath = path.dirname(targetUri.fsPath);
                const dirUri = vscode.Uri.file(dirFsPath);
                const entries = await vscode.workspace.fs.readDirectory(dirUri);

                // Limit to avoid accidentally scanning huge directories.
                const gplFiles = entries
                    .filter(([name, type]) => {
                        if (type !== vscode.FileType.File) {
                            return false;
                        }
                        const lower = name.toLowerCase();
                        return lower.endsWith('.gpl') || lower.endsWith('.gpo');
                    })
                    .slice(0, 200)
                    .map(([name]) => vscode.Uri.file(path.join(dirFsPath, name)));

                this.log(`[References] Workspace scan=0; running folder fallback in: ${dirFsPath} (files=${gplFiles.length})`);

                for (const uri of gplFiles) {
                    if (token.isCancellationRequested) {
                        break;
                    }
                    // Avoid re-scanning the current document; it was already scanned.
                    if (uri.fsPath === document.uri.fsPath) {
                        continue;
                    }

                    const doc = await vscode.workspace.openTextDocument(uri);

                    if (shouldPreferQualifiedOnly && escapedQualifier) {
                        folderFallbackHits += scanDocumentText(doc, qualifiedRegex(escapedQualifier), {});
                        continue;
                    }

                    if (shouldAlsoSearchModuleQualified && escapedModule) {
                        folderFallbackHits += scanDocumentText(doc, qualifiedRegex(escapedModule), {});
                    }
                    if (shouldAlsoSearchClassQualified && escapedClass) {
                        folderFallbackHits += scanDocumentText(doc, qualifiedRegex(escapedClass), {});
                    }
                    if (isClassMember) {
                        folderFallbackHits += scanDocumentText(doc, new RegExp(anyQualifierPattern, 'gi'), {});
                    }

                    // Unqualified scans: follow the same restriction rules.
                    if (shouldRestrictUnqualifiedToDefFile && targetFilePath) {
                        if (doc.uri.fsPath === targetFilePath) {
                            folderFallbackHits += scanDocumentText(doc, unqualifiedRegex, { unqualifiedOnly: true });
                        }
                    } else if (!isClassMember) {
                        folderFallbackHits += scanDocumentText(doc, unqualifiedRegex, { unqualifiedOnly: false });
                    }
                }
            }
        } catch {
            // ignore folder fallback errors
        }

        this.log(
            `[References] results: local=${localHits}, workspace=${workspaceHits}, folderFallback=${folderFallbackHits}, ` +
                `folderFallbackRan=${folderFallbackRan}, total=${locations.length}`
        );

        // Fallback: if workspace scan yields nothing (or was cancelled), use the existing cache-based approach.
        // Note: cache-based approach is less accurate because it is name-only and may include duplicates.
        if (!token.isCancellationRequested && locations.length === 0) {
            this.log('[References] Workspace scan returned 0. Falling back to cache-based search.');
            const refs = this.symbolCache.findReferences(word);
            for (const ref of refs) {
                const uri = vscode.Uri.file(ref.symbol.filePath);

                for (const usage of ref.usages) {
                    const p = new vscode.Position(usage.line, usage.character);
                    const range = new vscode.Range(p, new vscode.Position(usage.line, usage.character + word.length));
                    const key = `${uri.toString()}:${range.start.line}:${range.start.character}:${range.end.line}:${range.end.character}`;
                    if (seen.has(key)) {
                        continue;
                    }
                    seen.add(key);
                    locations.push(new vscode.Location(uri, range));
                }
            }
        }

        return locations;
    }
}
