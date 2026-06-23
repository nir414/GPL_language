/**
 * 커서 위치의 식별자/멤버 접근 표현식을 다루는 순수 헬퍼.
 *
 * definitionProvider / referenceProvider / gplParser가 각자 복제하던 로직을
 * 단일 정본으로 모은 것이다. vscode API에 의존하지 않으므로 Node 단독으로
 * 단위 테스트가 가능하다.
 */

/**
 * 정규식 메타문자를 이스케이프한다 (MDN 표준 구현).
 *
 * 동적으로 만든 식별자/한정자를 `new RegExp(...)`에 넣을 때 사용한다.
 */
export function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 멤버 접근 표현식에서 점(.) 바로 앞의 "기준 객체 이름"을 추출한다.
 *
 * 표현식의 끝에서부터 스캔하여, "returnError = armList(0).member"처럼
 * 첫 식별자(returnError)가 기준 객체가 아닌 경우에도 올바르게 armList를 얻는다.
 * 예:
 *   "returnError = armList(0)" → "armList"
 *   "myRobot(index)"          → "myRobot"
 *   "obj"                     → "obj"
 *   "arr(0)(1)"               → "arr"
 */
export function extractBaseObjectName(expression: string): string | undefined {
    let pos = expression.length - 1;

    // 끝쪽 공백 스킵
    while (pos >= 0 && /\s/.test(expression[pos])) {
        pos--;
    }

    // 오른쪽에서 왼쪽으로 균형 잡힌 괄호 그룹 스킵
    while (pos >= 0 && expression[pos] === ')') {
        let depth = 0;
        while (pos >= 0) {
            if (expression[pos] === ')') { depth++; }
            else if (expression[pos] === '(') { depth--; }
            if (depth === 0) { pos--; break; }
            pos--;
        }
        // 연속된 괄호 그룹 사이 공백 스킵
        while (pos >= 0 && /\s/.test(expression[pos])) {
            pos--;
        }
    }

    // 현재 위치에서 끝나는 식별자 추출
    const endPos = pos + 1;
    while (pos >= 0 && /[a-zA-Z0-9_]/.test(expression[pos])) {
        pos--;
    }

    const name = expression.substring(pos + 1, endPos);
    return name.length > 0 && /^[a-zA-Z_]/.test(name) ? name : undefined;
}
