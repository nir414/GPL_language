import { ciEq } from '../syntax/identifiers';
import { extractBaseObjectName } from '../syntax/cursorExpression';
import type { GPLSymbol } from '../syntax/gplParser';
import { elementTypeOf } from './receiverType';

/**
 * 참조 찾기의 "후보 출현" 텍스트 규칙 — 패턴 조립, 줄 분할, 한정자/좌변 대입 판별, 멤버 스코프 필터.
 *
 * 전부 문자열·심볼 조회만 쓰는 순수 모듈이다(vscode 없음). `referenceProvider`는 이 규칙을 문서/Uri 어댑터로
 * 감싸 호출하고, 테스트는 문자열 입력으로 직접 검증한다. 함수 본문은 provider 시절 그대로다.
 */

export function buildQualifiedMemberPattern(escapedQualifier: string, escapedWord: string): string {
    return `\\b${escapedQualifier}\\s*\\.\\s*${escapedWord}\\b`;
}

export function buildAnyQualifierPattern(escapedWord: string): string {
    // Match member access ending in ".Member" while allowing GPL array/index suffixes
    // in qualifier segments, e.g.:
    // - obj.Member
    // - steps(i).RunZeroStep
    // - arr(0)(1).Member
    // - foo.bar(i).Member
    const qualifierSegment = `\\b\\w+(?:\\s*\\([^\\r\\n()]*\\))*`;
    return `${qualifierSegment}(?:\\s*\\.\\s*${qualifierSegment})*\\s*\\.\\s*${escapedWord}\\b`;
}

/**
 * 식별자가 "문장 맨 앞의 좌변 대입"인지 판별한다.
 * 즉 같은 줄에서 식별자 앞에는 공백뿐이고, 식별자 뒤에는 (공백 후) 단일 `=`가 오는 형태.
 *
 * GPL/VB에서 함수 본문의 `FunctionName = value`는 반환값 대입문이며,
 * 이는 함수 호출/사용 참조가 아니라 반환값 설정이므로 참조 결과에서 제외한다.
 * `result = FunctionName(...)`처럼 우변 호출은 식별자 앞에 다른 토큰이 있으므로 제외되지 않는다.
 * `If FunctionName = 0 Then`처럼 비교문도 앞에 `If`가 있어 제외되지 않는다.
 */
export function isStatementLeadingAssignmentLHS(text: string, identifierStart: number, identifierLen: number): boolean {
    // 식별자 앞이 줄 시작까지 공백뿐인지 확인.
    let i = identifierStart - 1;
    while (i >= 0 && text[i] !== '\n') {
        const ch = text[i];
        if (ch !== ' ' && ch !== '\t' && ch !== '\r') {
            return false;
        }
        i--;
    }

    // 식별자 뒤: 공백을 건너뛴 다음 문자가 단일 `=`여야 한다.
    let j = identifierStart + identifierLen;
    while (j < text.length && (text[j] === ' ' || text[j] === '\t')) {
        j++;
    }
    if (text[j] !== '=') {
        return false;
    }
    // `==`, `=<` 등 합성 연산자는 제외(VB는 단일 `=`만 쓰지만 방어적으로 처리).
    if (text[j + 1] === '=') {
        return false;
    }
    return true;
}

export function isQualifiedAt(text: string, matchIndex: number): boolean {
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

export function getQualifierBefore(text: string, identifierIndex: number): string | undefined {
    // 점(.)이 식별자 "바로 앞"(사이에 공백만 허용)에 있을 때만 한정자로 인정한다
    // — isQualifiedAt와 동일 기준. 종전에는 앞쪽 전체 텍스트의 lastIndexOf('.')를 써서
    // 몇 줄 위의 무관한 `foo.bar`가 한정자로 잡혔고, shouldAcceptByMemberScope가
    // 유효한 비한정 참조를 조용히 걸러내는 원인이 됐다.
    let i = identifierIndex - 1;
    while (i >= 0 && (text[i] === ' ' || text[i] === '\t')) {
        i--;
    }
    if (i < 0 || text[i] !== '.') {
        return undefined;
    }

    // Extract everything before the dot
    const objectExpression = text.substring(0, i).trim();

    // Get the base object name from the expression (handles array indexing, etc.)
    return extractBaseObjectName(objectExpression);
}

/** 한정자 이름의 정의 조회 — 호출부가 심볼 캐시를 넣어 준다. */
export type FindDefinition = (name: string, fromFilePath: string) => GPLSymbol | undefined;

export function shouldAcceptByMemberScope(
    findDefinition: FindDefinition,
    filePath: string,
    text: string,
    identifierIndex: number,
    targetClass?: string
): boolean {
    // Only apply strict qualification filtering for class-member reference search.
    if (!targetClass) {
        return true;
    }

    const qualifier = getQualifierBefore(text, identifierIndex);
    if (!qualifier) {
        // Unqualified member usage in same class/method body.
        return true;
    }

    const qSym = findDefinition(qualifier, filePath);
    if (!qSym) {
        // Local variables may not be indexed in cache; keep to avoid false negatives.
        return true;
    }

    // Module.Member (e.g., CSL.Acquire) should not be counted as class member reference.
    if (qSym.kind === 'module') {
        return false;
    }

    // Static class usage: keep only same class.
    if (qSym.kind === 'class') {
        return ciEq(qSym.name, targetClass);
    }

    // Instance usage: keep only matching returnType.
    // 배열 타입(`Foo[]`·`Foo()`)의 요소 타입 규칙은 공용 정본(receiverType.elementTypeOf)을 쓴다
    // — 사본을 두면 표기 하나가 늘 때 한쪽만 고쳐진다(2026-07-13 표기 일관화의 연장).
    if (qSym.returnType) {
        return ciEq(elementTypeOf(qSym.returnType, true) ?? qSym.returnType, targetClass);
    }

    return true;
}

/**
 * 한정자 후보 — 커서 단어 앞 텍스트에서 마지막 `.` 앞의 기반 객체 이름.
 * (`Module.Member` 의 `Member` 위에서 실행했을 때의 `Module`.)
 */
export function qualifierBeforeWord(lineText: string, wordStart: number): string | undefined {
    const beforeWord = lineText.substring(0, wordStart).trimEnd();
    const lastDotIndex = beforeWord.lastIndexOf('.');
    return lastDotIndex !== -1
        ? extractBaseObjectName(beforeWord.substring(0, lastDotIndex).trim())
        : undefined;
}

/**
 * 텍스트의 물리 줄 시작 오프셋(CRLF/LF/CR 혼합 허용). 문서를 열지 않고도 절대 오프셋을 보존한다.
 * 폴백 스캔에서 openTextDocument를 반복하면 문서 열림 이벤트 → 심볼 캐시 재구축이 파일마다 발생한다.
 */
export function computeLineStarts(text: string): number[] {
    const lineStarts = [0];
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '\n') {
            lineStarts.push(i + 1);
        } else if (text[i] === '\r' && text[i + 1] !== '\n') {
            lineStarts.push(i + 1);
        }
    }
    return lineStarts;
}

/** `computeLineStarts` 의 `lineIdx` 번째 줄 본문(줄 끝 제거). */
export function physicalLineText(text: string, lineStarts: readonly number[], lineIdx: number): string {
    const lineStart = lineStarts[lineIdx];
    const nextStart = lineStarts[lineIdx + 1] ?? text.length;
    return text.slice(lineStart, nextStart).replace(/[\r\n]+$/, '');
}

/** 매치 전체 텍스트 안에서 멤버(커서 단어)가 시작하는 오프셋 — 한정자 접두어를 건너뛴다. */
export function memberOffsetInMatch(matchedText: string, word: string): number {
    const memberOffset = matchedText.toLowerCase().lastIndexOf(word.toLowerCase());
    return memberOffset >= 0 ? memberOffset : 0;
}
