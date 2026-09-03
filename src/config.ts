import * as vscode from 'vscode';
import { extractBaseObjectName } from './language/cursorExpression';

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

export type HoverDocCommentMode = 'summary' | 'full' | 'off';
export type HoverDuringDebugMode = 'compact' | 'off' | 'normal';

export interface HoverConfig {
    enabled: boolean;
    docComment: HoverDocCommentMode;
    /** 0 = 제한 없음 */
    docCommentMaxLines: number;
    duringDebug: HoverDuringDebugMode;
    /** GPL Dictionary 내장 항목 호버에 값 표·매개변수 범위 등 상세 설명을 함께 보일지. */
    builtinDetails: boolean;
}

// getHoverConfig 기본값/허용값 — get() 폴백과 정규화 폴백에 동일하게 사용.
// 허용값을 목록 하나로 두면 기본값만 바꿔도 정규화가 따라오므로, 분기를 함께 고치는 걸
// 잊어 새 기본값이 곧바로 폴백돼 버리는 사고가 구조적으로 생기지 않는다.
const HOVER_DOC_COMMENT_MODES = ['summary', 'full', 'off'] as const;
const HOVER_DOC_COMMENT_DEFAULT: HoverDocCommentMode = 'summary';
const HOVER_DOC_COMMENT_MAX_LINES_DEFAULT = 6;
const HOVER_DURING_DEBUG_MODES = ['normal', 'compact', 'off'] as const;
// 기본 normal (2026-09-02, 종전 compact): compact가 문서를 지우는 자리 — Function/Sub 이름과
// 내장 항목 — 는 evaluatableExpressionProvider의 안전 규칙 0·1이 `-eval`을 원천 차단하는 자리라
// 애초에 가릴 변수 값 호버가 없다. 팝업 크기는 docComment(summary·6줄) 축이 이미 맡고 있다.
const HOVER_DURING_DEBUG_DEFAULT: HoverDuringDebugMode = 'normal';

/** 설정 문자열을 허용 목록으로 정규화 — 목록 밖 값·비문자열은 기본값. */
function pickOption<T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T {
    return typeof raw === 'string' && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

/**
 * 호버 표시량 설정 (package.json: gpl.hover.*).
 * 잘못된 값은 기본값으로 정규화해 provider 쪽에서 방어 코드가 필요 없게 한다.
 */
export function getHoverConfig(workspace: WorkspaceConfigHost): HoverConfig {
    const cfg = workspace.getConfiguration('gpl');

    // 명시적 false만 비활성으로 취급 (비-boolean 설정값은 기본 활성).
    const enabled = cfg.get<boolean>('hover.enabled', true) !== false;

    const docComment = pickOption(
        cfg.get<string>('hover.docComment', HOVER_DOC_COMMENT_DEFAULT),
        HOVER_DOC_COMMENT_MODES,
        HOVER_DOC_COMMENT_DEFAULT);

    const maxRaw = cfg.get<number>('hover.docCommentMaxLines', HOVER_DOC_COMMENT_MAX_LINES_DEFAULT);
    const docCommentMaxLines =
        typeof maxRaw === 'number' && Number.isFinite(maxRaw) && maxRaw >= 0
            ? Math.floor(maxRaw)
            : HOVER_DOC_COMMENT_MAX_LINES_DEFAULT;

    const duringDebug = pickOption(
        cfg.get<string>('hover.duringDebug', HOVER_DURING_DEBUG_DEFAULT),
        HOVER_DURING_DEBUG_MODES,
        HOVER_DURING_DEBUG_DEFAULT);

    // 명시적 false만 비활성으로 취급 (비-boolean 설정값은 기본 활성).
    const builtinDetails = cfg.get<boolean>('hover.builtinDetails', true) !== false;

    return { enabled, docComment, docCommentMaxLines, duringDebug, builtinDetails };
}

export interface DocCommentConfig {
    /** `'''` 입력 시 문서화 주석 골격을 자동완성으로 제안할지. */
    generateOnTripleQuote: boolean;
    /** 골격 생성 시 `# Examples` 섹션을 함께 넣을지. */
    includeExamples: boolean;
}

/**
 * 문서화 주석 생성 설정 (package.json: gpl.docComment.*).
 * 잘못된 값은 기본값으로 정규화한다(호출부 방어 코드 불필요).
 */
export function getDocCommentConfig(workspace: WorkspaceConfigHost): DocCommentConfig {
    const cfg = workspace.getConfiguration('gpl');
    // 명시적 false만 비활성으로 취급 (비-boolean 설정값은 기본값 유지).
    const generateOnTripleQuote = cfg.get<boolean>('docComment.generateOnTripleQuote', true) !== false;
    const includeExamples = cfg.get<boolean>('docComment.includeExamples', false) === true;
    return { generateOnTripleQuote, includeExamples };
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

    // qualifier: chosen segment 앞에 `.`이 있으면 그 앞쪽 base 객체 이름을 추출.
    // 인덱서/체이닝(`steps(i).X`, `arr(0)(1).X`)에서도 인덱스 변수가 아니라 기준 객체(`steps`, `arr`)를
    // 얻도록 extractBaseObjectName을 사용한다(정의/참조 Provider의 base 추출과 동일 정본).
    const before = fullText.substring(0, chosen.idx).trimEnd();
    let qualifier: string | undefined;
    if (before.endsWith('.')) {
        const beforeDot = before.slice(0, -1).trim();
        qualifier = extractBaseObjectName(beforeDot);
    }

    return { range: segRange, word: chosen.text, qualifier };
}

// isInCommentOrString의 정본은 language/cursorExpression.ts로 이동했다
// (vscode 비의존 모듈에서도 쓰기 위함). 기존 import 경로 호환을 위해 re-export.
export { isInCommentOrString } from './language/cursorExpression';

/**
 * 심볼 해석 대상이 될 수 없는 GPL(VB계열) 예약어(제어문/연산자/리터럴) — 정의 요청에서
 * 조기 반환해 멤버 해석/캐시 미스/텍스트 스캔 낭비를 없앤다.
 * 정본은 language/gplReservedWords.ts (예약어를 보는 모든 곳이 한 목록을 쓰게 통합) —
 * 기존 import 경로 호환을 위해 여기서 재노출한다.
 */
export { GPL_CONTROL_KEYWORDS } from './language/gplReservedWords';
