import * as vscode from 'vscode';
import { SymbolCache } from '../symbolCache';
import { GPLParser, GPLSymbol, GPLSymbolKind } from '../gplParser';
import { isTraceVerbose, EXTENSION_VERSION, ciEq, isInCommentOrString, getHoverConfig, HoverConfig } from '../config';
import { findEnclosingProcedureRange } from '../language/cursorExpression';
import { findGplBuiltin, getGplBuiltinReferenceUrl } from '../gplBuiltins';

export class GPLHoverProvider implements vscode.HoverProvider {

    constructor(
        private symbolCache: SymbolCache,
        private outputChannel?: vscode.OutputChannel
    ) {}

    private log(message: string) {
        if (!isTraceVerbose(vscode.workspace)) {
            return;
        }
        this.outputChannel?.appendLine(message);
    }

    private stripComment(line: string): string {
        const idx = line.indexOf("'");
        return idx >= 0 ? line.slice(0, idx) : line;
    }

    /**
     * Render a captured `'` doc-comment block as markdown, preserving line breaks.
     * 표시량은 gpl.hover.docComment(summary|full|off) + docCommentMaxLines로 조절한다:
     *  - summary(기본): 첫 문단(빈 줄 전까지)만, maxLines 초과분은 잘라내고 '…' 표시.
     *  - full: 전체를 표시하되 maxLines(0=무제한)까지만.
     *  - off: 호출부에서 표시 자체를 생략.
     */
    private formatDocComment(doc: string, config: HoverConfig): string | undefined {
        if (config.docComment === 'off') {
            return undefined;
        }

        let lines = doc.split('\n').map(l => l.trimEnd());

        if (config.docComment === 'summary') {
            const blank = lines.findIndex(l => l.trim() === '');
            if (blank > 0) {
                lines = lines.slice(0, blank);
            }
        }

        let truncated = false;
        const max = config.docCommentMaxLines;
        if (max > 0 && lines.length > max) {
            lines = lines.slice(0, max);
            truncated = true;
        }

        if (lines.length === 0) {
            return undefined;
        }

        let text = lines.join('  \n');
        if (truncated || (config.docComment === 'summary' && doc.split('\n').length > lines.length)) {
            text += '  \n… *(전체 주석: 정의로 이동 F12)*';
        }
        return text;
    }

    /** brooks-gpl 디버그 세션이 활성인지 (duringDebug 모드 적용 대상 판별). */
    private isGplDebugActive(): boolean {
        return vscode.debug.activeDebugSession?.type === 'brooks-gpl';
    }

    private getSymbolKindTitle(kind: GPLSymbolKind): string {
        switch (kind) {
            case GPLSymbolKind.Module:
                return 'Module';
            case GPLSymbolKind.Class:
                return 'Class';
            case GPLSymbolKind.Function:
                return 'Function';
            case GPLSymbolKind.Sub:
                return 'Sub';
            case GPLSymbolKind.Property:
                return 'Property';
            case GPLSymbolKind.Constant:
                return 'Const';
            case GPLSymbolKind.Variable:
            default:
                return 'Variable';
        }
    }

    /**
     * 커서를 감싸는 프로시저 스코프의 로컬 변수/파라미터를 찾는다.
     *
     * 캐시(모듈 레벨 심볼)를 먼저 조회하면 동명의 로컬/파라미터가 모듈 레벨 심볼에
     * 가려지므로, definitionProvider와 동일하게 로컬을 먼저 해석한다
     * (같은 스코프 안에서는 사용 위치보다 위의 가장 가까운 선언 우선).
     */
    private findEnclosingLocalSymbol(
        document: vscode.TextDocument,
        name: string,
        atLine: number
    ): GPLSymbol | undefined {
        try {
            const localSymbols = GPLParser.parseDocument(document.getText(), document.uri.fsPath, {
                includeLocals: true,
                includeParameters: true
            });
            const locals = localSymbols.filter(s => ciEq(s.name, name) && s.isLocal);
            if (locals.length === 0) {
                return undefined;
            }

            const proc = findEnclosingProcedureRange(
                i => document.lineAt(i).text,
                document.lineCount,
                atLine
            );
            if (!proc) {
                return undefined;
            }

            const inScope = locals.filter(s => s.line >= proc.startLine && s.line <= proc.endLine);
            if (inScope.length === 0) {
                return undefined;
            }

            const above = inScope.filter(s => s.line <= atLine).sort((a, b) => b.line - a.line);
            return above[0] ?? inScope.sort((a, b) => a.line - b.line)[0];
        } catch {
            return undefined;
        }
    }

    private getIdentifierAtPosition(document: vscode.TextDocument, position: vscode.Position): { text: string; range: vscode.Range } | undefined {
        const line = document.lineAt(position.line).text;
        if (!line) {
            return undefined;
        }

        const isIdentChar = (ch: string) => /[A-Za-z0-9_.]/.test(ch);
        let start = position.character;
        let end = position.character;

        while (start > 0 && isIdentChar(line[start - 1])) {
            start--;
        }
        while (end < line.length && isIdentChar(line[end])) {
            end++;
        }

        if (start === end) {
            return undefined;
        }

        const raw = line.slice(start, end);
        const trimmed = raw.replace(/^\.+|\.+$/g, '');
        if (!trimmed || !/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(trimmed)) {
            return undefined;
        }

        const leftTrim = raw.indexOf(trimmed);
        const range = new vscode.Range(position.line, start + leftTrim, position.line, start + leftTrim + trimmed.length);
        return { text: trimmed, range };
    }

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | undefined> {
        if (token.isCancellationRequested) {
            return undefined;
        }

        // 표시량 설정 (gpl.hover.*) — 스팸성 대형 팝업 방지 (2026-07-14).
        const config = getHoverConfig(vscode.workspace);
        if (!config.enabled) {
            return undefined;
        }
        // 디버깅 중에는 변수 값 호버가 주인공이므로 언어 호버를 간소화/억제한다.
        const debugActive = this.isGplDebugActive();
        if (debugActive && config.duringDebug === 'off') {
            return undefined;
        }
        const compact = debugActive && config.duringDebug === 'compact';

        const ident = this.getIdentifierAtPosition(document, position);
        if (!ident) {
            return undefined;
        }

        const word = ident.text;
        const wordRange = ident.range;

        const line = document.lineAt(position.line).text;

        // 주석(')·문자열("...") 내부에서는 호버를 띄우지 않는다 (2026-07-03).
        if (isInCommentOrString(line, wordRange.start.character)) {
            return undefined;
        }

        this.log(`\n[Hover Request] v${EXTENSION_VERSION} | Word: "${word}" | Line: "${line.trim()}"`);

        // 1) Built-in hover (문서 기반)
        const builtin = findGplBuiltin(word);
        if (builtin) {
            const md = new vscode.MarkdownString();
            if (compact) {
                // 디버깅 중: 시그니처 한 줄만.
                md.appendCodeblock(builtin.signature, 'gpl');
            } else {
                md.appendMarkdown(`**GPL Built-in** · ${builtin.category}\n\n`);
                md.appendCodeblock(builtin.signature, 'gpl');
                md.appendMarkdown(`\n${builtin.summary}`);
                const refUrl = getGplBuiltinReferenceUrl(builtin);
                const refLabel = builtin.sourceUrl ? 'Reference' : 'GPL Dictionary';
                md.appendMarkdown(`\n\n[${refLabel}](${refUrl})`);
            }
            md.isTrusted = false;
            return new vscode.Hover(md, wordRange);
        }

        const lookupName = word.includes('.') ? word.split('.').pop()! : word;

        // 로컬 변수/파라미터가 동명의 모듈 레벨 캐시 심볼에 가려지지 않도록, 감싸는
        // 프로시저 스코프의 로컬을 먼저 해석한다(definitionProvider와 동일 규칙).
        // 멤버 접근(`obj.Member`)은 로컬 스코프 대상이 아니므로 제외.
        let sym = !word.includes('.')
            ? this.findEnclosingLocalSymbol(document, lookupName, position.line)
            : undefined;

        // Prefer cache definition
        if (!sym) {
            sym = this.symbolCache.findDefinition(lookupName, document.uri.fsPath);
        }

        // Fallback: parse current document (works even outside workspace indexing)
        if (!sym && !token.isCancellationRequested) {
            try {
                const localSymbols = GPLParser.parseDocument(document.getText(), document.uri.fsPath);
                sym = localSymbols.find(s => ciEq(s.name, lookupName));
            } catch (e) {
                this.log(`[Hover Local Parse Error] ${e}`);
            }
        }

        if (!sym) {
            return undefined;
        }

        const kindTitle = this.getSymbolKindTitle(sym.kind);
        const md = new vscode.MarkdownString();

        const isCallable = sym.kind === GPLSymbolKind.Function || sym.kind === GPLSymbolKind.Sub;

        if (compact && isCallable) {
            // 디버깅 중: 시그니처 한 줄만 (변수 값 호버를 가리지 않게).
            const params = sym.parameters?.join(', ') ?? '';
            const signature = sym.kind === GPLSymbolKind.Function
                ? `Function ${sym.name}(${params})${sym.returnType ? ` As ${sym.returnType}` : ''}`
                : `Sub ${sym.name}(${params})`;
            md.appendCodeblock(signature, 'gpl');
            md.isTrusted = false;
            return new vscode.Hover(md, wordRange);
        }

        md.appendMarkdown(`**${kindTitle}** \`${sym.name}\``);

        if (isCallable) {
            const params = sym.parameters?.join(', ') ?? '';
            const signature = sym.kind === GPLSymbolKind.Function
                ? `Function ${sym.name}(${params})${sym.returnType ? ` As ${sym.returnType}` : ''}`
                : `Sub ${sym.name}(${params})`;
            md.appendMarkdown('\n\n');
            md.appendCodeblock(signature, 'gpl');
        } else {
            const typeText = sym.returnType ? `: \`${sym.returnType}\`` : '';
            md.appendMarkdown(typeText);
        }

        if (sym.kind === GPLSymbolKind.Constant) {
            const valueText = sym.value ? this.stripComment(sym.value) : '(초기값 없음)';
            md.appendMarkdown(`\n\n값: \`${valueText}\``);
        }

        if (!compact && (sym.module || sym.className)) {
            const scopes: string[] = [];
            if (sym.module) {
                scopes.push(`Module: \`${sym.module}\``);
            }
            if (sym.className) {
                scopes.push(`Class: \`${sym.className}\``);
            }
            md.appendMarkdown(`\n\n${scopes.join(' · ')}`);
        }

        if (!compact && sym.docComment) {
            const docMd = this.formatDocComment(sym.docComment, config);
            if (docMd) {
                md.appendMarkdown(`\n\n---\n\n${docMd}`);
            }
        }

        md.isTrusted = false;

        return new vscode.Hover(md, wordRange);
    }
}
