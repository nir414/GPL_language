import * as vscode from 'vscode';
import { GPLParser, GPLSymbol, GPLSymbolKind } from '../gplParser';
import { getDocCommentConfig } from '../config';
import {
    buildDocCommentBlock,
    DocTarget,
    findCodeLineBelow,
    isCommentLine,
    isDocumentableKind,
    locateDocCommentBlock,
    mergeDocComment,
    parseDocComment,
} from '../language/docComment';

/** 문서화 주석을 붙일 선언과, 그 위에 이미 있는 주석 블록의 위치. */
export interface DocCommentTarget {
    symbol: GPLSymbol;
    /** 선언이 시작하는 문서 줄(0-based). */
    declLine: number;
    /** 선언 줄의 들여쓰기 문자열 — 생성한 주석에 그대로 쓴다. */
    indent: string;
    /** 선언 바로 위에 붙어 있는 `'` 주석 블록의 첫 줄(없으면 undefined). */
    docStartLine?: number;
    /** 그 주석 블록의 본문(줄 앞 `'`와 공백 하나를 제거한 것) — parseDocComment 입력. */
    docRaw?: string;
}

/**
 * `fromLine`에 대응하는 선언을 찾는다.
 *  - 커서 줄이 선언이면 그 선언.
 *  - 커서가 주석/빈 줄이면 **아래로** 훑어 처음 만나는 선언(주석 블록 위에서 `'''`를 친 경우).
 *  - strict가 아니면, 위 둘이 모두 실패했을 때 커서를 감싸는 가장 가까운 선언(Sub/Function/Property/Class).
 */
export function findDocCommentTarget(
    document: vscode.TextDocument,
    fromLine: number,
    options: { strict?: boolean } = {}
): DocCommentTarget | undefined {
    let symbols: GPLSymbol[];
    try {
        symbols = GPLParser.parseDocument(document.getText(), document.uri.fsPath);
    } catch {
        return undefined;
    }

    const getLine = (i: number) => document.lineAt(i).text;
    const codeLine = findCodeLineBelow(getLine, document.lineCount, fromLine, { stopAtBlank: options.strict });

    let symbol = codeLine === undefined
        ? undefined
        : symbols.find(s => s.line === codeLine && isDocumentableKind(s.kind));

    if (!symbol && !options.strict) {
        // 프로시저 본문 안에서 호출한 경우 — 커서를 감싸는 가장 가까운 선언으로 올라간다.
        const enclosing = symbols
            .filter(s => s.line <= fromLine && (
                s.kind === GPLSymbolKind.Function ||
                s.kind === GPLSymbolKind.Sub ||
                s.kind === GPLSymbolKind.Property ||
                s.kind === GPLSymbolKind.Class ||
                s.kind === GPLSymbolKind.Module))
            .sort((a, b) => b.line - a.line)[0];
        symbol = enclosing;
    }

    if (!symbol) {
        return undefined;
    }

    const declLine = symbol.line;
    const declText = document.lineAt(declLine).text;
    const indent = declText.match(/^[ \t]*/)?.[0] ?? '';

    // 선언 바로 위의 연속 주석 블록(빈 줄이 끼면 끊긴다) — 파서의 docComment 수집 규칙과 동일.
    const block = locateDocCommentBlock(getLine, declLine);

    return {
        symbol,
        declLine,
        indent,
        docStartLine: block?.startLine,
        docRaw: block ? block.lines.join('\n') : undefined,
    };
}

function toDocTarget(symbol: GPLSymbol): DocTarget {
    return {
        kind: symbol.kind,
        name: symbol.name,
        parameters: symbol.parameters,
        returnType: symbol.returnType,
    };
}

/** 선언에 맞는 골격을 스니펫 문자열로 만든다(들여쓰기 없음 — 삽입 위치의 들여쓰기를 VS Code가 이어 붙인다). */
export function buildDocCommentSnippet(symbol: GPLSymbol, includeExamples: boolean): vscode.SnippetString {
    const lines = buildDocCommentBlock(toDocTarget(symbol), { snippet: true, includeExamples });
    return new vscode.SnippetString(lines.join('\n') + '\n');
}

/**
 * `gpl.insertDocComment` 인자.
 * MCP(`extension_command`)·URI 경로에서는 JSON으로 오므로 `uri`가 문자열일 수 있다.
 */
export interface DocCommentCommandArgs {
    /** 대상 파일. vscode.Uri, URI 문자열(`file:///…`), 또는 로컬 경로. 생략하면 활성 편집기. */
    uri?: vscode.Uri | string;
    /** 대상 줄(0-based). 생략하면 커서 위치. */
    line?: number;
}

export interface DocCommentCommandResult {
    ok: boolean;
    /** inserted = 골격 삽입 / merged = 빠진 항목 보완 / up-to-date = 더할 것 없음 / no-* = 실패 사유 */
    action: 'inserted' | 'merged' | 'up-to-date' | 'no-editor' | 'no-declaration';
    file?: string;
    line?: number;
    symbol?: string;
    /** merged일 때 무엇을 덧붙였는지. */
    added?: string[];
}

/** vscode.Uri | URI 문자열 | 경로 문자열 → vscode.Uri. */
function toUri(value: vscode.Uri | string | undefined): vscode.Uri | undefined {
    if (!value) { return undefined; }
    if (typeof value !== 'string') { return value; }
    return /^[a-z][a-z0-9+.-]*:/i.test(value) ? vscode.Uri.parse(value) : vscode.Uri.file(value);
}

/**
 * `GPL: 문서화 주석 생성` 명령 본체.
 * 주석이 없으면 골격을 스니펫으로 삽입하고, 이미 있으면 빠진 항목(매개변수·Returns)만 덧붙인다.
 */
export async function insertDocComment(args?: DocCommentCommandArgs): Promise<DocCommentCommandResult> {
    const uri = toUri(args?.uri);
    let editor = vscode.window.activeTextEditor;
    if (uri && editor?.document.uri.toString() !== uri.toString()) {
        const doc = await vscode.workspace.openTextDocument(uri);
        editor = await vscode.window.showTextDocument(doc);
    }
    if (!editor) {
        vscode.window.showWarningMessage('GPL: 문서화 주석을 넣을 편집기가 없습니다.');
        return { ok: false, action: 'no-editor' };
    }

    const document = editor.document;
    const line = args?.line ?? editor.selection.active.line;
    const target = findDocCommentTarget(document, line);
    if (!target) {
        vscode.window.showWarningMessage('GPL: 커서 위치에서 문서화할 선언(Sub/Function/Property 등)을 찾지 못했습니다.');
        return { ok: false, action: 'no-declaration', file: document.uri.fsPath, line };
    }

    const { includeExamples } = getDocCommentConfig(vscode.workspace);
    const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';

    const where = { file: document.uri.fsPath, line: target.declLine, symbol: target.symbol.name };

    // 기존 주석 없음 → 골격 삽입.
    if (target.docStartLine === undefined || !target.docRaw?.trim()) {
        const snippet = buildDocCommentSnippet(target.symbol, includeExamples);
        await editor.insertSnippet(snippet, new vscode.Position(target.declLine, target.indent.length));
        return { ok: true, action: 'inserted', ...where };
    }

    // 기존 주석 있음 → 빠진 항목만 보완(기존 서술은 건드리지 않는다).
    const parsed = parseDocComment(target.docRaw);
    const { insertions, added } = mergeDocComment(parsed, toDocTarget(target.symbol));
    if (!insertions.length) {
        vscode.window.showInformationMessage(`GPL: \`${target.symbol.name}\` 문서화 주석에 추가할 항목이 없습니다.`);
        return { ok: true, action: 'up-to-date', ...where };
    }

    const edit = new vscode.WorkspaceEdit();
    for (const insertion of insertions) {
        const at = new vscode.Position(target.docStartLine + insertion.atIndex, 0);
        const text = insertion.lines
            .map(l => (l ? `${target.indent}' ${l}` : `${target.indent}'`))
            .join(eol) + eol;
        edit.insert(document.uri, at, text);
    }
    await vscode.workspace.applyEdit(edit);
    vscode.window.showInformationMessage(`GPL: 문서화 주석 보완 — ${added.join(', ')}`);
    return { ok: true, action: 'merged', added, ...where };
}

/**
 * `'''`를 입력하면 문서화 주석 골격을 제안하는 자동완성 제공자
 * (JSDoc의 `/**` 확장과 같은 흐름). 트리거 문자는 `'`.
 */
export class GPLDocCommentCompletionProvider implements vscode.CompletionItemProvider {

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.CompletionItem[] | undefined {
        if (!getDocCommentConfig(vscode.workspace).generateOnTripleQuote) {
            return undefined;
        }

        const lineText = document.lineAt(position.line).text;
        const prefix = lineText.slice(0, position.character);
        const indentMatch = prefix.match(/^([ \t]*)'''$/);
        // 커서 앞은 들여쓰기 + `'''`뿐이고, 뒤에는 아무것도 없어야 한다(기존 주석 훼손 방지).
        if (!indentMatch || lineText.slice(position.character).trim() !== '') {
            return undefined;
        }

        const target = findDocCommentTarget(document, position.line + 1, { strict: true });
        if (!target) {
            return undefined;
        }
        // `'''`와 선언 사이에 이미 주석이 있으면 중복 생성이 되므로 제안하지 않는다.
        for (let i = position.line + 1; i < target.declLine; i++) {
            if (isCommentLine(document.lineAt(i).text)) {
                return undefined;
            }
        }

        const { includeExamples } = getDocCommentConfig(vscode.workspace);
        const docTarget = toDocTarget(target.symbol);
        const lines = buildDocCommentBlock(docTarget, { snippet: true, includeExamples });
        const preview = buildDocCommentBlock(docTarget, { includeExamples });

        const item = new vscode.CompletionItem("'''", vscode.CompletionItemKind.Snippet);
        item.detail = `GPL 문서화 주석 (${target.symbol.name})`;
        item.documentation = new vscode.MarkdownString(
            `설명 · \`# Parameters\` · \`# Returns\` 골격을 만듭니다.\n\n\`\`\`gpl\n${preview.join('\n')}\n\`\`\``
        );
        // 들여쓰기 다음(첫 `'` 위치)부터 교체해야 스니펫 2번째 줄부터의 자동 들여쓰기가 어긋나지 않는다.
        item.range = new vscode.Range(position.line, indentMatch[1].length, position.line, position.character);
        item.insertText = new vscode.SnippetString(lines.join('\n'));
        item.preselect = true;
        item.sortText = ' docComment';
        return [item];
    }
}

/**
 * 선언 위에서 "문서화 주석 생성/보완" 코드 액션을 제공한다(전구 메뉴).
 * 선언 줄 또는 선언 바로 위 주석 줄에서만 뜬다(본문 안에서는 소음이므로 제외 — strict).
 */
export function provideDocCommentCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection
): vscode.CodeAction[] {
    const target = findDocCommentTarget(document, range.start.line, { strict: true });
    if (!target) {
        return [];
    }

    const hasDoc = target.docStartLine !== undefined && !!target.docRaw?.trim();
    const action = new vscode.CodeAction(
        hasDoc
            ? `문서화 주석 보완: ${target.symbol.name}`
            : `문서화 주석 생성: ${target.symbol.name}`,
        vscode.CodeActionKind.RefactorRewrite
    );
    action.command = {
        command: 'gpl.insertDocComment',
        title: action.title,
        arguments: [{ uri: document.uri, line: target.declLine }]
    };
    return [action];
}
