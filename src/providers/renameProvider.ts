import * as vscode from 'vscode';
import { SymbolCache } from '../symbolCache';
import { GPLParser, GPLSymbol, GPLSymbolKind } from '../gplParser';
import { GPLReferenceProvider } from './referenceProvider';
import { ciEq, getQualifiedWordAtPosition, isInCommentOrString, isTraceVerbose } from '../config';
import {
    findEnclosingProcedureRange,
    getStringLiteralContentAt
} from '../language/cursorExpression';
import {
    findRenameOccurrencesInLine,
    findReturnAssignmentColumn,
    findStringLiteralRenameOccurrences,
    isDotQualifiedAt,
    isRenameReservedWord,
    isValidGplIdentifier,
    StringLiteralRenameTarget
} from '../language/renameCore';
import { findGplBuiltin } from '../gplBuiltins';

/** 문자열 리터럴 스캔 파일 수 상한 — referenceProvider 폴더 폴백(200)과 같은 취지의 안전판. */
const MAX_STRING_SCAN_FILES = 300;

/** Rename 대상 해석 결과. */
type RenameTarget =
    | {
        /** 로컬 변수/파라미터 — 감싸는 프로시저 범위 안에서만 바꾼다. */
        scope: 'local';
        symbol: GPLSymbol;
        procRange: { startLine: number; endLine: number };
    }
    | {
        /** 모듈/클래스 레벨 심볼 — 참조 검색 재사용으로 워크스페이스 전체를 바꾼다. */
        scope: 'global';
        symbol: GPLSymbol;
    };

/**
 * GPL Rename(F2) Provider.
 *
 * 설계 원칙:
 *   - 대상 판별은 정의 이동(definitionProvider)과 같은 해석 순서를 따른다
 *     (로컬 → 멤버 접근 → 워크스페이스 캐시 → 온디맨드 파싱). F12로 정의에
 *     도달할 수 없는 식별자는 F2도 거부한다 — 이름만 같은 무관한 코드를
 *     텍스트 치환으로 망가뜨리지 않기 위한 안전선.
 *   - 전역 rename의 발생 위치 수집은 참조 검색(GPLReferenceProvider)을
 *     재사용하되, rename 특성에 맞게 세 가지를 보정한다:
 *       1. 함수 반환값 대입(`FunctionName = ...`)은 참조에서 제외되지만
 *          rename에는 반드시 포함 (renameCore.findReturnAssignmentColumn)
 *       2. 스레드 관용구의 문자열 프로시저 참조("Mod.Proc")도 함께 변경
 *          (F12가 점프하는 문자열만 — renameCore.findStringLiteralRenameOccurrences)
 *       3. 동명 로컬이 있는 프로시저 안의 비한정 매치는 제외(섀도잉 필터) —
 *          참조 검색의 과탐(무관한 로컬)이 코드를 깨뜨리지 않게 한다
 */
export class GPLRenameProvider implements vscode.RenameProvider {
    constructor(
        private symbolCache: SymbolCache,
        private referenceProvider: GPLReferenceProvider,
        private outputChannel?: vscode.OutputChannel
    ) {}

    private log(message: string) {
        if (!isTraceVerbose(vscode.workspace)) {
            return;
        }
        this.outputChannel?.appendLine(message);
    }

    async prepareRename(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): Promise<{ range: vscode.Range; placeholder: string }> {
        const { ident } = this.resolveTarget(document, position);
        return { range: ident.range, placeholder: ident.word };
    }

    async provideRenameEdits(
        document: vscode.TextDocument,
        position: vscode.Position,
        newName: string,
        token: vscode.CancellationToken
    ): Promise<vscode.WorkspaceEdit | undefined> {
        const { target, ident } = this.resolveTarget(document, position);
        const word = ident.word;

        const trimmed = newName.trim();
        if (!isValidGplIdentifier(trimmed)) {
            throw new Error(`"${trimmed}"은(는) 올바른 GPL 식별자가 아닙니다 (영문/밑줄로 시작, 영숫자/밑줄만).`);
        }
        if (isRenameReservedWord(trimmed)) {
            throw new Error(`"${trimmed}"은(는) GPL 예약어라 사용할 수 없습니다.`);
        }
        if (findGplBuiltin(trimmed)) {
            throw new Error(`"${trimmed}"은(는) GPL 내장 심볼과 충돌합니다.`);
        }
        if (trimmed === word) {
            return undefined; // 변경 없음 (대소문자만 다른 경우는 진행)
        }
        this.checkCollision(target, trimmed, document);

        if (target.scope === 'local') {
            return this.buildLocalEdits(document, target, word, trimmed);
        }
        return await this.buildGlobalEdits(document, target.symbol, word, trimmed, token);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 대상 해석
    // ─────────────────────────────────────────────────────────────────────

    /**
     * 커서 위치의 식별자를 rename 대상 심볼로 해석한다. 실패 시 사용자에게
     * 보여줄 메시지로 throw — VS Code가 F2 입력창 대신 메시지를 표시한다.
     */
    private resolveTarget(
        document: vscode.TextDocument,
        position: vscode.Position
    ): { target: RenameTarget; ident: { range: vscode.Range; word: string; qualifier?: string } } {
        const ident = getQualifiedWordAtPosition(document, position);
        if (!ident) {
            throw new Error('이름을 바꿀 식별자가 없습니다.');
        }
        const word = ident.word;
        const line = document.lineAt(position.line).text;

        // 주석/문자열 내부: 문자열 프로시저 참조("Mod.Proc")만 예외 허용 (정의 이동과 동일 기준)
        if (isInCommentOrString(line, ident.range.start.character)) {
            const fromString = this.resolveFromStringLiteral(document, ident, line);
            if (fromString) {
                return { target: { scope: 'global', symbol: fromString }, ident };
            }
            throw new Error('주석/문자열 안에서는 이름을 바꿀 수 없습니다.');
        }

        if (isRenameReservedWord(word)) {
            throw new Error(`"${word}"은(는) GPL 예약어라 이름을 바꿀 수 없습니다.`);
        }

        // 1) 로컬 변수/파라미터 (한정자 없는 경우만 — `obj.name`의 name은 로컬일 수 없다)
        if (!ident.qualifier) {
            const local = this.findLocalSymbol(document, word, position.line);
            if (local?.isLocal) {
                const procRange = findEnclosingProcedureRange(
                    (i) => document.lineAt(i).text,
                    document.lineCount,
                    position.line
                ) ?? findEnclosingProcedureRange(
                    (i) => document.lineAt(i).text,
                    document.lineCount,
                    local.line
                );
                if (procRange) {
                    return { target: { scope: 'local', symbol: local, procRange }, ident };
                }
                // 프로시저 범위를 못 찾으면 로컬 확신이 없으므로 아래 전역 해석으로 계속
            }
        }

        // 2) 멤버 접근 (Module.Member / Class.Member / instance.Member)
        if (ident.qualifier) {
            const member = this.resolveMemberSymbol(document, position.line, word, ident.qualifier);
            if (member) {
                return { target: { scope: 'global', symbol: member }, ident };
            }
        }

        // 3) 워크스페이스 캐시 / 온디맨드 파싱
        const cached = this.symbolCache.findDefinition(word, document.uri.fsPath);
        if (cached) {
            return { target: { scope: 'global', symbol: cached }, ident };
        }
        try {
            const localSymbols = GPLParser.parseDocument(document.getText(), document.uri.fsPath);
            const match = localSymbols.find(s => ciEq(s.name, word));
            if (match) {
                return { target: { scope: 'global', symbol: match }, ident };
            }
        } catch {
            // 파싱 실패는 아래 공통 거부로
        }

        // 4) 내장 심볼이면 전용 메시지 (사용자 심볼이 없을 때만 — 위에서 먼저 해석했다)
        const builtinQuery = ident.qualifier ? `${ident.qualifier}.${word}` : word;
        if (findGplBuiltin(builtinQuery) || findGplBuiltin(word)) {
            throw new Error(`"${word}"은(는) GPL 내장 심볼이라 이름을 바꿀 수 없습니다.`);
        }
        throw new Error(`"${word}"의 정의를 찾을 수 없어 이름을 바꿀 수 없습니다.`);
    }

    /** 정의 이동과 같은 기준의 문자열 프로시저 참조 해석 (식별자 형태 리터럴만). */
    private resolveFromStringLiteral(
        document: vscode.TextDocument,
        ident: { range: vscode.Range; word: string; qualifier?: string },
        line: string
    ): GPLSymbol | undefined {
        const literal = getStringLiteralContentAt(line, ident.range.start.character);
        if (!literal || !/^[A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)*$/.test(literal.text.trim())) {
            return undefined;
        }
        const isCallable = (s: GPLSymbol) => s.kind === GPLSymbolKind.Sub || s.kind === GPLSymbolKind.Function;
        if (ident.qualifier) {
            const inClass = this.symbolCache
                .findMemberInClassMatches(ident.word, ident.qualifier, document.uri.fsPath)
                .filter(isCallable);
            if (inClass.length > 0) {
                return inClass[0];
            }
            const inModule = this.symbolCache
                .findMemberInModuleMatches(ident.word, ident.qualifier, document.uri.fsPath)
                .filter(isCallable);
            return inModule[0];
        }
        return this.symbolCache
            .findDefinitionMatches(ident.word, document.uri.fsPath)
            .filter(isCallable)[0];
    }

    /** definitionProvider.findLocalSymbol과 동일 취지의 축약판 — 커서 스코프의 로컬/파라미터 해석. */
    private findLocalSymbol(
        document: vscode.TextDocument,
        symbolName: string,
        atLine: number
    ): GPLSymbol | undefined {
        try {
            const symbols = GPLParser.parseDocument(document.getText(), document.uri.fsPath, {
                includeLocals: true,
                includeParameters: true
            });
            const candidates = symbols.filter(s => ciEq(s.name, symbolName));
            if (candidates.length === 0) {
                return undefined;
            }
            const proc = findEnclosingProcedureRange(
                (i) => document.lineAt(i).text,
                document.lineCount,
                atLine
            );
            let scoped = candidates;
            if (proc) {
                const inProc = candidates.filter(c => c.line >= proc.startLine && c.line <= proc.endLine);
                if (inProc.length > 0) {
                    scoped = inProc;
                }
            }
            const above = scoped.filter(c => c.line <= atLine).sort((a, b) => b.line - a.line);
            return above[0] ?? scoped.sort((a, b) => a.line - b.line)[0];
        } catch {
            return undefined;
        }
    }

    /** 멤버 접근 대상 해석 — 한정자가 모듈/클래스/인스턴스 타입으로 풀릴 때만. */
    private resolveMemberSymbol(
        document: vscode.TextDocument,
        atLine: number,
        memberName: string,
        qualifier: string
    ): GPLSymbol | undefined {
        const baseSym = this.findLocalSymbol(document, qualifier, atLine)
            ?? this.symbolCache.findDefinition(qualifier, document.uri.fsPath);
        if (!baseSym) {
            return undefined;
        }
        if (baseSym.kind === GPLSymbolKind.Module) {
            return this.symbolCache.findMemberInModuleMatches(memberName, baseSym.name, document.uri.fsPath)[0];
        }
        if (baseSym.kind === GPLSymbolKind.Class) {
            return this.symbolCache.findMemberInClassMatches(memberName, baseSym.name, document.uri.fsPath)[0];
        }
        if (baseSym.returnType) {
            const resolvedType = baseSym.returnType.replace(/\[\]$/, '');
            return this.symbolCache.findMemberInClassMatches(memberName, resolvedType, document.uri.fsPath)[0];
        }
        return undefined;
    }

    // ─────────────────────────────────────────────────────────────────────
    // 충돌 검사
    // ─────────────────────────────────────────────────────────────────────

    /** 같은 스코프에 새 이름과 동명 심볼이 이미 있으면 거부한다. */
    private checkCollision(target: RenameTarget, newName: string, document: vscode.TextDocument): void {
        if (target.scope === 'local') {
            try {
                const symbols = GPLParser.parseDocument(document.getText(), document.uri.fsPath, {
                    includeLocals: true,
                    includeParameters: true
                });
                const clash = symbols.find(s =>
                    ciEq(s.name, newName) &&
                    s.line >= target.procRange.startLine &&
                    s.line <= target.procRange.endLine
                );
                if (clash) {
                    throw new Error(`같은 프로시저에 이미 "${newName}"이(가) 있습니다 (line ${clash.line + 1}).`);
                }
            } catch (err) {
                if (err instanceof Error && err.message.includes(newName)) {
                    throw err;
                }
                // 파싱 실패는 충돌 검사 생략 (rename 자체는 진행)
            }
            return;
        }

        const sym = target.symbol;
        const clash = this.symbolCache.findAllByName(newName).find(s =>
            ciEq(s.module ?? '', sym.module ?? '') &&
            ciEq(s.className ?? '', sym.className ?? '')
        );
        if (clash) {
            throw new Error(
                `같은 범위(${sym.module ?? '전역'}${sym.className ? '.' + sym.className : ''})에 이미 "${newName}"이(가) 있습니다.`
            );
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // 편집 생성
    // ─────────────────────────────────────────────────────────────────────

    /** 로컬 변수/파라미터: 감싸는 프로시저 범위 안의 비한정 매치만 바꾼다. */
    private buildLocalEdits(
        document: vscode.TextDocument,
        target: Extract<RenameTarget, { scope: 'local' }>,
        word: string,
        newName: string
    ): vscode.WorkspaceEdit {
        const edit = new vscode.WorkspaceEdit();
        let count = 0;
        for (let lineNo = target.procRange.startLine; lineNo <= target.procRange.endLine; lineNo++) {
            const lineText = document.lineAt(lineNo).text;
            for (const occ of findRenameOccurrencesInLine(lineText, word, { skipQualified: true })) {
                edit.replace(
                    document.uri,
                    new vscode.Range(lineNo, occ.character, lineNo, occ.character + word.length),
                    newName
                );
                count++;
            }
        }
        this.log(`[Rename] local "${word}" → "${newName}": ${count} edits in proc lines ` +
            `${target.procRange.startLine + 1}..${target.procRange.endLine + 1}`);
        return edit;
    }

    /** 전역 심볼: 참조 검색 재사용 + 반환값 대입 + 문자열 참조 + 섀도잉 필터. */
    private async buildGlobalEdits(
        invokingDocument: vscode.TextDocument,
        defSymbol: GPLSymbol,
        word: string,
        newName: string,
        token: vscode.CancellationToken
    ): Promise<vscode.WorkspaceEdit | undefined> {
        const defUri = vscode.Uri.file(defSymbol.filePath);
        const defDoc = await vscode.workspace.openTextDocument(defUri);
        const defPos = new vscode.Position(defSymbol.line, Math.max(0, defSymbol.range?.start ?? 0));

        // 참조 수집은 항상 "정의 위치"에서 실행한다 — 호출부/정의부 어느 쪽에서
        // F2를 눌러도 결과가 같고, referenceProvider의 스코프 인식 경로를 태운다.
        const locations = (await this.referenceProvider.provideReferences(
            defDoc,
            defPos,
            { includeDeclaration: true },
            token
        )) ?? [];

        // 선언부 이름 범위는 무조건 포함 (참조 검색 경로/패턴과 무관하게 보장)
        const declStart = Math.max(0, defSymbol.range?.start ?? 0);
        locations.push(new vscode.Location(
            defUri,
            new vscode.Range(defSymbol.line, declStart, defSymbol.line, declStart + word.length)
        ));

        // 함수 반환값 대입(`FunctionName = ...`)은 참조에서 제외되므로 여기서 추가
        if (defSymbol.kind === GPLSymbolKind.Function) {
            const body = findEnclosingProcedureRange(
                (i) => defDoc.lineAt(i).text,
                defDoc.lineCount,
                defSymbol.line
            );
            if (body) {
                for (let lineNo = body.startLine + 1; lineNo <= body.endLine; lineNo++) {
                    const col = findReturnAssignmentColumn(defDoc.lineAt(lineNo).text, word);
                    if (col >= 0) {
                        locations.push(new vscode.Location(
                            defUri,
                            new vscode.Range(lineNo, col, lineNo, col + word.length)
                        ));
                    }
                }
            }
        }

        if (token.isCancellationRequested) {
            return undefined;
        }

        // 파일별로 묶어 섀도잉 필터 적용 후 편집 생성
        const edit = new vscode.WorkspaceEdit();
        const seen = new Set<string>();
        const byFile = new Map<string, vscode.Location[]>();
        for (const loc of locations) {
            const key = loc.uri.toString();
            const list = byFile.get(key) ?? [];
            list.push(loc);
            byFile.set(key, list);
        }

        let kept = 0;
        let shadowSkipped = 0;
        for (const [, locs] of byFile) {
            if (token.isCancellationRequested) {
                return undefined;
            }
            const doc = await vscode.workspace.openTextDocument(locs[0].uri);
            const shadowRanges = this.collectShadowingProcRanges(doc, word, defSymbol);

            for (const loc of locs) {
                const { line, character } = loc.range.start;
                const dedupeKey = `${loc.uri.toString()}:${line}:${character}`;
                if (seen.has(dedupeKey)) {
                    continue;
                }
                seen.add(dedupeKey);

                // 섀도잉 필터: 동명 로컬이 선언된 프로시저 안의 "비한정" 매치는
                // 그 로컬을 가리키므로 전역 심볼 rename에서 제외한다.
                // (단, 대상 자신의 선언 라인은 예외 — 전역 심볼의 선언은 프로시저 밖이다)
                const isDeclSite = loc.uri.fsPath === defSymbol.filePath && line === defSymbol.line;
                if (!isDeclSite && shadowRanges.some(r => line >= r.startLine && line <= r.endLine)) {
                    const lineText = doc.lineAt(line).text;
                    if (!isDotQualifiedAt(lineText, character)) {
                        shadowSkipped++;
                        continue;
                    }
                }

                edit.replace(
                    loc.uri,
                    new vscode.Range(line, character, line, character + word.length),
                    newName
                );
                kept++;
            }
        }

        // 문자열 프로시저 참조("Mod.Proc") — Sub/Function/Module/Class 대상만
        const stringEdits = await this.addStringLiteralEdits(
            edit, seen, invokingDocument, defDoc, defSymbol, word, newName, token
        );

        this.log(`[Rename] global "${word}" → "${newName}": ${kept} refs (+${stringEdits} string refs, ` +
            `${shadowSkipped} shadowed skipped) across ${byFile.size} file(s)`);
        return edit;
    }

    /** 파일 내 동명 로컬 선언들의 프로시저 범위 목록 (섀도잉 필터용). */
    private collectShadowingProcRanges(
        doc: vscode.TextDocument,
        word: string,
        defSymbol: GPLSymbol
    ): Array<{ startLine: number; endLine: number }> {
        try {
            const locals = GPLParser.parseDocument(doc.getText(), doc.uri.fsPath, {
                includeLocals: true,
                includeParameters: true
            }).filter(s => s.isLocal && ciEq(s.name, word));

            const ranges: Array<{ startLine: number; endLine: number }> = [];
            for (const local of locals) {
                // 대상이 그 로컬 자신인 경우는 없음(전역 rename 경로) — 모두 무관한 동명 로컬
                const proc = findEnclosingProcedureRange(
                    (i) => doc.lineAt(i).text,
                    doc.lineCount,
                    local.line
                );
                if (proc && !(doc.uri.fsPath === defSymbol.filePath &&
                    defSymbol.line >= proc.startLine && defSymbol.line <= proc.endLine)) {
                    ranges.push(proc);
                }
            }
            return ranges;
        } catch {
            return [];
        }
    }

    /** 문자열 리터럴 프로시저 참조 편집 추가. 추가한 편집 수를 돌려준다. */
    private async addStringLiteralEdits(
        edit: vscode.WorkspaceEdit,
        seen: Set<string>,
        invokingDocument: vscode.TextDocument,
        defDoc: vscode.TextDocument,
        defSymbol: GPLSymbol,
        word: string,
        newName: string,
        token: vscode.CancellationToken
    ): Promise<number> {
        let target: StringLiteralRenameTarget;
        if (defSymbol.kind === GPLSymbolKind.Sub || defSymbol.kind === GPLSymbolKind.Function) {
            target = { kind: 'proc', containerName: defSymbol.className ?? defSymbol.module };
        } else if (defSymbol.kind === GPLSymbolKind.Module || defSymbol.kind === GPLSymbolKind.Class) {
            target = { kind: 'container' };
        } else {
            return 0; // 변수/상수/프로퍼티는 문자열 참조 관용구가 없다
        }

        // 스캔 대상: 워크스페이스 .gpl + (워크스페이스 밖일 수 있는) 현재/정의 문서
        const uris = new Map<string, vscode.Uri>();
        try {
            const found = await vscode.workspace.findFiles(
                '**/*.gpl',
                '{**/bin/**,**/node_modules/**,**/.git/**}',
                MAX_STRING_SCAN_FILES
            );
            for (const uri of found) {
                uris.set(uri.toString(), uri);
            }
        } catch {
            // findFiles 실패 시에도 아래 열린 문서는 스캔한다
        }
        uris.set(invokingDocument.uri.toString(), invokingDocument.uri);
        uris.set(defDoc.uri.toString(), defDoc.uri);

        let added = 0;
        for (const uri of uris.values()) {
            if (token.isCancellationRequested) {
                break;
            }
            let doc: vscode.TextDocument;
            try {
                doc = await vscode.workspace.openTextDocument(uri);
            } catch {
                continue;
            }
            for (let lineNo = 0; lineNo < doc.lineCount; lineNo++) {
                const lineText = doc.lineAt(lineNo).text;
                if (lineText.indexOf('"') === -1) {
                    continue;
                }
                for (const occ of findStringLiteralRenameOccurrences(lineText, word, target)) {
                    const dedupeKey = `${uri.toString()}:${lineNo}:${occ.character}`;
                    if (seen.has(dedupeKey)) {
                        continue;
                    }
                    seen.add(dedupeKey);
                    edit.replace(
                        uri,
                        new vscode.Range(lineNo, occ.character, lineNo, occ.character + word.length),
                        newName
                    );
                    added++;
                }
            }
        }
        return added;
    }
}
