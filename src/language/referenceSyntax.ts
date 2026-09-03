import { escapeRegExp, getStringLiteralContentAt } from './cursorExpression';

/**
 * GPL 소스에서 이름만으로 찾을 수 없는 참조 표기의 정본.
 *
 * 일반 식별자는 referenceProvider의 word 검색으로 충분하지만 다음 두 표기는
 * 선언 이름과 사용부 모양이 다르거나 문자열 안에 있어 별도 문법 판정이 필요하다.
 *
 * - 생성자 선언 `Sub New` -> 사용 `New ClassName(...)`
 * - 프로시저 선언 `Sub Run` -> symbol-valued string `"ClassName.Run"`
 *
 * vscode API에 의존하지 않아 검색 경로(local/workspace/project fallback)와 테스트가
 * 같은 규칙을 공유할 수 있다.
 */

/** `New ClassName` 사용부를 찾는 정규식 source를 만든다. */
export function buildConstructorUsagePattern(className: string): string {
    return `\\bNew\\s+${escapeRegExp(className)}\\b`;
}

export interface SymbolicStringReferenceTarget {
    /** 선언된 프로시저 이름. */
    name: string;
    /** `"Container.Name"`에서 허용할 Class/Module 이름. */
    containerNames?: readonly string[];
    /** `"Name"` 단독 표기도 참조로 인정할지 여부. */
    allowUnqualified?: boolean;
}

/**
 * character가 가리키는 문자열이 GPL의 프로시저 참조 표기와 정확히 일치하는지 판정한다.
 *
 * 일반 메시지·경로 문자열의 우연한 부분 일치는 제외하기 위해 문자열 전체가
 * `Name` 또는 `Container.Name`인 경우만 허용한다. 이는 definitionProvider가
 * 문자열 안 F12를 허용하는 범위와 같다.
 */
export function isSymbolicStringReferenceAt(
    lineText: string,
    character: number,
    target: SymbolicStringReferenceTarget,
): boolean {
    const literal = getStringLiteralContentAt(lineText, character);
    if (!literal) {
        return false;
    }

    const text = literal.text.trim();
    if (!/^[A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)?$/.test(text)) {
        return false;
    }

    const parts = text.split(/\s*\.\s*/);
    const referencedName = parts[parts.length - 1];
    if (referencedName.toLowerCase() !== target.name.toLowerCase()) {
        return false;
    }

    if (parts.length === 1) {
        return target.allowUnqualified === true;
    }

    const container = parts[0];
    return (target.containerNames ?? []).some(name => name.toLowerCase() === container.toLowerCase());
}
