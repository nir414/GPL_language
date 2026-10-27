import * as vscode from 'vscode';
import { SymbolCache } from '../../language/vscode/symbolCache';
import { isTraceVerbose, getQualifiedWordAtPosition } from '../../config';
import { memberOffsetInMatch, qualifierBeforeWord } from '../../language/analysis/referenceCandidates';
import {
    buildReferenceSearchPlan,
    planFileScan,
    planWorkspaceQueries,
    ReferenceScanSession,
    ReferenceSite,
    ScanFile,
} from '../../language/analysis/referenceScan';
import { resolveReferenceTargetSymbol } from '../../language/analysis/referenceTarget';
import {
    formatFallbackLog,
    formatResultsLog,
    formatTargetScopeLog,
    formatWorkspaceCheckLog,
    WORKSPACE_FALLBACK_NOTICE,
} from '../../language/analysis/referenceTrace';
import { PROJECT_EXCLUDE_GLOB, resolveProjectFileScope } from '../../project/sources/projectFileScope';
import { buildReceiverContext, buildReceiverContextFromText, ReceiverContext } from '../intellisense/receiverContext';

/**
 * Find References — 커서 아래 심볼의 대상 선언을 정하고(`language/analysis/referenceTarget`), 검색 계획을 세워
 * (`referenceScan.buildReferenceSearchPlan`) 현재 문서 → 워크스페이스 텍스트 검색 → 프로젝트 범위 폴백 → 캐시 폴백
 * 순으로 후보를 모은다. 출현 판정·중복 제거·로그 문구는 전부 vscode 없는 순수 모듈이 맡고,
 * 이 provider 는 문서/Uri/설정/검색 API 접착과 순서 조율만 한다.
 */
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
                        exclude: PROJECT_EXCLUDE_GLOB,
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
        const ident = getQualifiedWordAtPosition(document, position);
        if (!ident) {
            return [];
        }

        const word = ident.word;
        const wordRange = ident.range;

        // Detect qualified access like Module.Member where the cursor is on Member.
        const lineText = document.lineAt(position.line).text;
        const qualifier = qualifierBeforeWord(lineText, wordRange.start.character);

        let receiverCtx: ReceiverContext | undefined;
        const receiverContext = () => (receiverCtx ??= buildReceiverContext(
            document, position.line, n => this.symbolCache.findAllByName(n)));

        // 선언 위 → `New X` → 타입 사용부 → GPL 이름 해석 → 이름 기반 복원 순으로 대상 선언을 정한다.
        const { defSymbol, defPrecise } = resolveReferenceTargetSymbol(
            this.symbolCache,
            {
                word,
                qualifier,
                documentText: document.getText(),
                documentFsPath: document.uri.fsPath,
                line: position.line,
                lineText,
                wordStart: wordRange.start.character,
                wordEnd: wordRange.end.character,
            },
            receiverContext,
            m => this.log(m),
        );

        const plan = buildReferenceSearchPlan(this.symbolCache, {
            word, qualifier, defSymbol, defPrecise,
            documentText: document.getText(),
            documentFsPath: document.uri.fsPath,
        });
        const { targetFilePath, targetAccess, scopeTarget } = plan;

        this.log(formatTargetScopeLog({
            word,
            qualifier,
            targetModule: plan.targetModule,
            targetClass: plan.targetClass,
            targetAccess,
            targetFilePath,
            defSymbol,
            defPrecise,
        }));

        const MAX_SEARCH_RESULTS = 5000; // 워크스페이스 텍스트 검색 결과 상한
        const MAX_SCOPE_FALLBACK_FILES = 1000; // 프로젝트 범위 폴백에서 스캔할 최대 파일 수

        const session = new ReferenceScanSession(plan, {
            symbols: this.symbolCache,
            includeDeclaration: context.includeDeclaration,
            documentFsPath: document.uri.fsPath,
            receiverLookupFromText: (lines, fsPath, line, findAllByName, docSymbols) =>
                buildReceiverContextFromText(lines, fsPath, line, findAllByName, docSymbols).lookup,
            log: m => this.log(m),
            isCancelled: () => token.isCancellationRequested,
        });

        // 순수 모듈은 Uri 를 모른다 — 장부 키(`uri.toString()`)로 오가고, 마지막에 이 표로 Location 을 만든다.
        const uris = new Map<string, vscode.Uri>();
        const scanFileOf = (uri: vscode.Uri, text: string): ScanFile => {
            const uriKey = uri.toString();
            if (!uris.has(uriKey)) {
                uris.set(uriKey, uri);
            }
            return { fsPath: uri.fsPath, uriKey, text };
        };
        const addSite = (uri: vscode.Uri, line: number, start: number, end: number): boolean => {
            const file = scanFileOf(uri, '');
            return session.addSite({
                uriKey: file.uriKey, fsPath: file.fsPath,
                startLine: line, startCharacter: start, endLine: line, endCharacter: end,
            });
        };

        let localHits = 0;
        let workspaceHits = 0;
        let scopeFallbackHits = 0;
        let scopeFallbackRan = false;

        const ctorDecl = session.constructorDeclarationRange();
        if (ctorDecl) {
            const uri = ctorDecl.fsPath === document.uri.fsPath
                ? document.uri
                : vscode.Uri.file(ctorDecl.fsPath);
            addSite(uri, ctorDecl.line, ctorDecl.start, ctorDecl.end);
        }

        // Always scan the current document directly (covers files outside the workspace).
        // We keep the old local scan semantics but limit it to the most relevant patterns.
        try {
            const isTargetFile = document.uri.fsPath === targetFilePath;
            for (const step of planFileScan(plan, 'local', isTargetFile)) {
                localHits += session.scanSourceText(
                    scanFileOf(document.uri, document.getText()),
                    new RegExp(step.pattern, 'gi'),
                    { unqualifiedOnly: step.unqualifiedOnly });
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

                if (!session.inCompileUnit(uri.fsPath)) {
                    return; // 다른 프로젝트의 동명 심볼
                }

                // Private/module-local rules: avoid scanning other files for unqualified matches.
                const isDefFile = targetFilePath && uri.fsPath === targetFilePath;
                if (
                    targetAccess === 'private' &&
                    plan.shouldRestrictUnqualifiedToDefFile &&
                    !isDefFile &&
                    opts.unqualifiedOnly
                ) {
                    return;
                }

                const doc = await getDoc(uri);
                const text = doc.getText();
                const range = r.ranges[0];
                const startOffset = doc.offsetAt(range.start);

                const matchedText = doc.getText(range);
                const memberStartOffset = startOffset + memberOffsetInMatch(matchedText, word);
                const memberEndOffset = memberStartOffset + word.length;
                const normalizedRange = new vscode.Range(
                    doc.positionAt(memberStartOffset),
                    doc.positionAt(memberEndOffset)
                );

                const lineText = doc.lineAt(normalizedRange.start.line).text;
                if (session.addIfAccepted(
                    scanFileOf(uri, text),
                    normalizedRange.start.line,
                    normalizedRange.start.character,
                    memberStartOffset,
                    lineText,
                    opts.unqualifiedOnly,
                )) {
                    workspaceHits += 1;
                }
            };

            // Collect results synchronously-ish by awaiting the overall search promise.
            const pending: Promise<void>[] = [];
            const enqueue = (p: Promise<void>) => {
                pending.push(p.catch(() => undefined));
            };

            const runQuery = async (pattern: string, opts: { unqualifiedOnly?: boolean }) => {
                if (targetAccess === 'private') {
                    return false;
                }
                const ok = await this.findTextInWorkspace(
                    { pattern, isRegExp: true, isCaseSensitive: false },
                    token,
                    (r) => enqueue(handleMatch(r, opts)),
                    { maxResults: MAX_SEARCH_RESULTS }
                );
                return ok;
            };

            // If the API isn't available, we'll skip this whole fast-path and rely on cache fallback.
            // (Local scan above still helps for out-of-workspace files.)
            let anySearchRan = false;
            for (const query of planWorkspaceQueries(plan)) {
                anySearchRan = (await runQuery(query.pattern, { unqualifiedOnly: query.unqualifiedOnly })) || anySearchRan;
            }

            if (anySearchRan) {
                await Promise.all(pending);
            }
        } catch {
            // Ignore and fall back to cache-based approach.
        }

        // 프로젝트 범위 폴백: 워크스페이스 텍스트 검색이 현재 문서 밖의 결과를 못 냈으면
        // (`workspace.findTextInFiles`는 제안 API라 정식 VS Code에서는 아예 실행되지 않는다)
        // 소유 프로젝트(.gpr)의 소스 파일을 직접 스캔한다.
        //
        // 종전에는 "정의 파일과 같은 폴더의 형제 파일"만 훑어서, `ProjectSource="T1\T2\T2.gpl"`처럼
        // 하위 폴더에 있는 소스의 참조를 통째로 놓쳤다(2026-08-28 TEST_GPL 확인).
        try {
            const targetUri = targetFilePath ? vscode.Uri.file(targetFilePath) : document.uri;
            const targetInWorkspace = this.isInWorkspace(targetUri);
            const docInWorkspace = this.isInWorkspace(document.uri);

            const hasNonDocumentLocations = session.hasNonDocumentSites();
            this.log(formatWorkspaceCheckLog({
                targetInWorkspace,
                docInWorkspace,
                hasNonDocumentLocations,
                targetPath: targetUri.fsPath,
                docPath: document.uri.fsPath,
            }));

            // Private 심볼은 정의 파일(현재 문서) 스캔으로 충분하다. 파일 밖 검색은 결과도 없고 비용만 든다.
            if (!token.isCancellationRequested && !hasNonDocumentLocations && targetAccess !== 'private') {
                scopeFallbackRan = true;
                // 현재 추가 범위 검색은 .gpl만 지원한다. 전역 모듈(.gpo)로의 확대는 별도 검증이 필요하다.
                const scope = await resolveProjectFileScope(targetUri.fsPath, {
                    extensions: ['.gpl'],
                    maxFiles: MAX_SCOPE_FALLBACK_FILES,
                });
                const gplFiles = scope.files;
                const fallbackStartedAt = Date.now();
                let scannedFiles = 0;
                let unreadableFiles = 0;
                const openDocuments = new Map(
                    vscode.workspace.textDocuments
                        .filter(d => d.uri.scheme === 'file')
                        .map(d => [d.uri.fsPath.toLowerCase(), d] as const)
                );

                // 현재 문서는 이미 스캔했다. Windows 경로는 대소문자가 다를 수 있어(.gpr에서 해석한 경로 vs
                // 편집기 경로) 무시 비교한다 — 다르게 보면 같은 참조가 두 번 나온다.
                const currentPathLower = document.uri.fsPath.toLowerCase();
                for (const uri of gplFiles) {
                    if (token.isCancellationRequested) {
                        break;
                    }
                    if (uri.fsPath.toLowerCase() === currentPathLower) {
                        continue;
                    }

                    let sourceText: string;
                    try {
                        // 열린 문서는 저장 전 편집분을 존중하고, 나머지는 디스크에서 직접 읽는다.
                        // openTextDocument를 쓰면 onDidOpenTextDocument → SymbolCache.updateDocument가 파일마다
                        // 실행되어 이름 인덱스 재구축과 verbose 로그가 폭주한다.
                        sourceText = openDocuments.get(uri.fsPath.toLowerCase())?.getText()
                            ?? await this.symbolCache.readSourceText(uri);
                    } catch {
                        unreadableFiles++;
                        continue;
                    }
                    scannedFiles++;

                    const file = scanFileOf(uri, sourceText);
                    for (const step of planFileScan(plan, 'fallback', uri.fsPath === targetFilePath)) {
                        scopeFallbackHits += session.scanSourceText(
                            file, new RegExp(step.pattern, 'gi'), { unqualifiedOnly: step.unqualifiedOnly });
                    }
                }
                this.log(formatFallbackLog({
                    origin: scope.origin,
                    projectDir: scope.projectDir,
                    scannedFiles,
                    totalFiles: gplFiles.length,
                    hits: scopeFallbackHits,
                    unreadableFiles,
                    elapsedMs: Date.now() - fallbackStartedAt,
                    truncated: scope.truncated,
                }));
            }
        } catch {
            // ignore folder fallback errors
        }

        const excludedTotal = session.trace.excludedTotal;
        this.log(formatResultsLog({
            localHits,
            workspaceHits,
            scopeFallbackHits,
            scopeFallbackRan,
            total: session.sites.length,
            scoped: !!scopeTarget,
            excludedTotal,
            exclusionCounts: session.trace.exclusionCounts,
            loggedOccurrenceCount: session.trace.loggedCount,
        }));

        // Fallback: if workspace scan yields nothing (or was cancelled), use the existing cache-based approach.
        // Note: cache-based approach is less accurate because it is name-only and may include duplicates.
        // 출현 판정이 후보를 보고 모두 뺐다면(대상 스코프가 확정된 상태) 이름만 같은 캐시 결과로 되살리지 않는다.
        if (!token.isCancellationRequested && session.sites.length === 0 && !plan.isConstructorTarget
            && !(scopeTarget && excludedTotal > 0)) {
            this.log(WORKSPACE_FALLBACK_NOTICE);
            const refs = await this.symbolCache.findReferences(word, token);
            for (const ref of refs) {
                if (!session.inCompileUnit(ref.filePath)) {
                    continue; // 이름만 같은 다른 프로젝트의 심볼 — 캐시는 인덱싱된 전체 파일을 훑는다
                }
                const uri = vscode.Uri.file(ref.filePath);

                for (const usage of ref.usages) {
                    addSite(uri, usage.line, usage.character, usage.character + word.length);
                }
            }
        }

        return session.sites.map((site: ReferenceSite) => new vscode.Location(
            uris.get(site.uriKey)!,
            new vscode.Range(
                new vscode.Position(site.startLine, site.startCharacter),
                new vscode.Position(site.endLine, site.endCharacter),
            ),
        ));
    }
}
