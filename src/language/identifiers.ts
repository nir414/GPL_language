/**
 * GPL 식별자 비교 규칙(vscode 무의존).
 *
 * 종전에는 config.ts(vscode 의존)에 있어 language/gplBuiltins 가 그 하나 때문에 vscode 계층을 끌어들였다
 * (Node 단독 테스트 불가). 2026-09-07 §1-DB 로 분리.
 */

/**
 * GPL/VB 식별자 대소문자 무시 비교.
 * GPL은 VB.NET 기반이므로 식별자(함수명, 변수명 등)가 대소문자를 구분하지 않는다.
 */
export function ciEq(a: string, b: string): boolean {
    return a.toLowerCase() === b.toLowerCase();
}
