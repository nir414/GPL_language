import * as vscode from 'vscode';

/** package.json의 version을 단일 소스로 사용 */
export const EXTENSION_VERSION: string = require('../package.json').version;

export type TraceServerLevel = 'off' | 'messages' | 'verbose';

type WorkspaceConfigHost = Pick<typeof vscode.workspace, 'getConfiguration'>;

/**
 * GPL 파일 여부 판별 (확장자 기반).
 * languageId는 'vb'로 열릴 수 있으므로 사용하지 않는다.
 */
export function isGplFile(document: vscode.TextDocument): boolean {
    const fsPath = document.uri.fsPath.toLowerCase();
    return document.uri.scheme === 'file' && (fsPath.endsWith('.gpl') || fsPath.endsWith('.gpo'));
}

/**
 * GPL 파일 여부 판별 (타입 가드 버전, nullable 허용).
 */
export function isGplDocument(document: vscode.TextDocument | undefined): document is vscode.TextDocument {
    if (!document) return false;
    return isGplFile(document);
}

export function getTraceServerLevel(workspace: WorkspaceConfigHost): TraceServerLevel {
    // Configuration key is declared in package.json as: gpl.trace.server
    const raw: unknown = workspace.getConfiguration('gpl').get('trace.server', 'off');
    const rawString = typeof raw === 'string' ? raw : 'off';

    if (rawString === 'messages' || rawString === 'verbose' || rawString === 'off') {
        return rawString;
    }

    return 'off';
}

export function isTraceOn(workspace: WorkspaceConfigHost): boolean {
    return getTraceServerLevel(workspace) !== 'off';
}

export function isTraceVerbose(workspace: WorkspaceConfigHost): boolean {
    return getTraceServerLevel(workspace) === 'verbose';
}

/**
 * GPL/VB 식별자 대소문자 무시 비교.
 * GPL은 VB.NET 기반이므로 식별자(함수명, 변수명 등)가 대소문자를 구분하지 않는다.
 */
export function ciEq(a: string, b: string): boolean {
    return a.toLowerCase() === b.toLowerCase();
}

/**
 * 식별자 단어 범위를 가져오되, qualified 토큰(`Module.Member`)인 경우
 * 커서 위치의 segment만 반환한다.
 *
 * VS Code가 `*.gpl`을 `vb` languageId로 여는 환경에서는 VB의 기본 wordPattern이
 * `.`을 포함해서 `FND.CRLF` 전체가 단일 토큰으로 잡힌다. 그러면 Member Access
 * 해석이 깨지므로 모든 Provider는 이 헬퍼로 정규화된 word를 사용해야 한다.
 *
 * 반환값:
 *   - `range`: 커서 아래 식별자 segment의 정확한 범위
 *   - `word`: 그 segment의 텍스트
 *   - `qualifier`: segment 직전에 `.`으로 연결된 base 표현식(있으면). 예) `FND.CRLF`에서 커서가 `CRLF`면 `"FND"`
 */
export function getQualifiedWordAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position
): { range: vscode.Range; word: string; qualifier?: string } | undefined {
    // 점도 식별자 일부로 잡는 패턴(VB 기본 동작과 일치)으로 풀 토큰을 가져온 뒤 직접 segment 분리
    const fullPattern = /[A-Za-z_][A-Za-z0-9_]*(?:\s*\.\s*[A-Za-z_][A-Za-z0-9_]*)*/;
    const fullRange = document.getWordRangeAtPosition(position, fullPattern);
    if (!fullRange) {
        // 폴백: 단일 식별자
        const single = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
        if (!single) return undefined;
        return { range: single, word: document.getText(single) };
    }

    const fullText = document.getText(fullRange);
    if (!fullText.includes('.')) {
        return { range: fullRange, word: fullText };
    }

    // segment 분리: 토큰 내에서 커서 위치의 식별자 조각만 골라낸다
    const startCol = fullRange.start.character;
    const cursorOffset = position.character - startCol;

    const re = /[A-Za-z_][A-Za-z0-9_]*/g;
    let match: RegExpExecArray | null;
    let chosen: { idx: number; len: number; text: string } | undefined;
    while ((match = re.exec(fullText)) !== null) {
        const s = match.index;
        const e = s + match[0].length;
        if (cursorOffset >= s && cursorOffset <= e) {
            chosen = { idx: s, len: match[0].length, text: match[0] };
            break;
        }
        // 커서가 점/공백 위에 있을 수도 있으므로 마지막으로 본 segment를 임시 저장
        if (s <= cursorOffset) {
            chosen = { idx: s, len: match[0].length, text: match[0] };
        }
    }

    if (!chosen) {
        return { range: fullRange, word: fullText };
    }

    const line = position.line;
    const segRange = new vscode.Range(line, startCol + chosen.idx, line, startCol + chosen.idx + chosen.len);

    // qualifier: chosen segment 앞에 `.`이 있으면 그 앞쪽 base 표현식 추출
    const before = fullText.substring(0, chosen.idx).trimEnd();
    let qualifier: string | undefined;
    if (before.endsWith('.')) {
        const beforeDot = before.slice(0, -1).trim();
        const m = beforeDot.match(/[A-Za-z_][A-Za-z0-9_]*$/);
        if (m) qualifier = m[0];
    }

    return { range: segRange, word: chosen.text, qualifier };
}

/**
 * position(라인 내 문자 위치)이 GPL 주석(`'` 이후) 또는 문자열 리터럴("...") 내부인지 판별.
 * 정의/호버/참조 Provider가 주석·문자열 속 단어를 심볼로 오해석하지 않도록 조기 차단용.
 * VB식 이스케이프("")는 토글 2회로 자연 처리된다.
 */
export function isInCommentOrString(lineText: string, character: number): boolean {
    let inString = false;
    const end = Math.min(character, lineText.length);
    for (let i = 0; i < end; i++) {
        const ch = lineText[i];
        if (ch === '"') {
            inString = !inString;
        } else if (ch === "'" && !inString) {
            return true; // 이후 전부 주석
        }
    }
    return inString;
}

/**
 * 심볼이 될 수 없는 GPL(VB계열) 제어 키워드.
 * 정의 요청에서 조기 반환해 멤버 해석/캐시 미스/텍스트 스캔 낭비를 없앤다.
 * 주의: `New`(생성자 점프), `Me`/`MyBase`, 타입명(String 등)은 의도적으로 제외.
 */
export const GPL_CONTROL_KEYWORDS: ReadonlySet<string> = new Set([
    'if', 'then', 'else', 'elseif', 'end', 'endif',
    'for', 'next', 'to', 'step', 'each', 'in',
    'while', 'wend', 'do', 'loop', 'until',
    'select', 'case', 'return', 'exit', 'continue', 'goto',
    'dim', 'as', 'byref', 'byval', 'redim',
    'and', 'or', 'not', 'xor', 'mod',
    'true', 'false', 'nothing',
    'try', 'catch', 'finally', 'throw', 'with',
]);
