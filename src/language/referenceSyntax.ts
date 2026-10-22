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
 * 문자열을 **프로시저 이름으로 소비하는** GPL API 표.
 *
 * `"Mod.Proc"` 모양이라는 것만으로는 참조가 아니다 — 로그 메시지·태그가 같은 모양을 자주 쓴다
 * (`LOG.WriteEx(ex, "STA.ClearError")`). 실제 참조는 런타임이 그 문자열로 프로시저를 찾는
 * **호출 위치**에서만 생긴다. 여기 있는 항목만 참조로 인정한다.
 *
 * 항목을 늘릴 때는 근거(공식 문서의 매개변수 설명)를 `reference` 에 적는다. 프로젝트마다 다른
 * 자체 래퍼(`Lib.Spawn("Mod.Proc")`)는 알 수 없으므로 표에 없고, 필요해지면 설정으로 확장한다.
 */
export interface SymbolStringConsumer {
    /** 사람이 읽는 표기. */
    label: string;
    /** 여는 괄호까지 포함한 호출 머리 — 리터럴 앞 텍스트의 **끝**에 맞춘다. */
    head: RegExp;
    /** 프로시저 이름이 오는 인자 위치(0-based). */
    argIndex: number;
    /** 근거. */
    reference: string;
}

export const SYMBOL_STRING_CONSUMERS: readonly SymbolStringConsumer[] = Object.freeze([
    Object.freeze({
        label: 'New Thread(procedure_name, …)',
        head: /\bNew\s+Thread\s*\($/i,
        argIndex: 0,
        reference: 'GPL Dictionary — Thread 생성자의 procedure_name (String, Public 이어야 하고 클래스 안이면 `클래스명.프로시저명`)',
    }),
]);

/**
 * 여는 따옴표 위치가 "프로시저 이름을 소비하는 인자 자리"인지 찾는다.
 *
 * 리터럴 앞을 거꾸로 훑어 같은 깊이의 콤마를 세며 감싸는 호출의 `(` 를 찾고, 그 앞 머리가
 * 표의 항목과 맞고 인자 번호까지 같을 때만 그 항목을 돌려준다. 따라서
 * `New Thread("NPU.WorkerLoop",,"TCPCMD")` 에서 첫 인자만 참조가 되고(세 번째는 스레드 이름),
 * `LOG.WriteEx(ex, "STA.ClearError")` 는 어느 인자도 참조가 아니다.
 *
 * GPL 문자열 리터럴은 줄을 넘지 않으므로 한 줄 안에서만 본다. 줄 이음(`_`)으로 호출 머리가
 * 윗줄에 있으면 찾지 못하고 참조로 세지 않는다(오탐보다 누락을 택한다).
 */
export function findSymbolStringConsumerAt(lineText: string, quoteIndex: number): SymbolStringConsumer | undefined {
    let depth = 0;
    let argIndex = 0;
    let openIndex = -1;

    for (let i = quoteIndex - 1; i >= 0; i--) {
        const ch = lineText[i];
        if (ch === '"') {
            // 앞선 문자열 리터럴 — 그 안의 콤마·괄호는 세지 않는다.
            const opening = lineText.lastIndexOf('"', i - 1);
            if (opening < 0) { return undefined; }
            i = opening;
            continue;
        }
        if (ch === ')' || ch === ']') {
            depth++;
        } else if (ch === '(' || ch === '[') {
            if (depth === 0) {
                if (ch === '[') { return undefined; } // 배열 첨자 안 — 호출 인자가 아니다
                openIndex = i;
                break;
            }
            depth--;
        } else if (ch === ',' && depth === 0) {
            argIndex++;
        }
    }

    if (openIndex < 0) { return undefined; }

    const head = lineText.slice(0, openIndex + 1);
    return SYMBOL_STRING_CONSUMERS.find(c => c.argIndex === argIndex && c.head.test(head));
}

/**
 * character가 가리키는 문자열이 GPL의 프로시저 참조 표기와 정확히 일치하는지 판정한다.
 *
 * 두 조건을 **모두** 만족해야 참조다.
 *   ① 문자열 전체가 `Name` 또는 `Container.Name` 모양일 것(부분 일치 제외).
 *   ② 그 자리가 문자열을 프로시저 이름으로 소비하는 호출 인자일 것(`SYMBOL_STRING_CONSUMERS`).
 *
 * ②가 없던 동안에는 `LOG.WriteEx(ex, "STA.ClearError")` 같은 **로그 문자열이 참조 목록에 섞였다**
 * (2026-09-22 사용자 보고). 정의 이동(F12)은 사용자가 그 자리를 콕 집어 누르는 읽기 전용 동작이라
 * ①만으로 계속 허용한다 — 목록에 싣거나 이름을 바꾸는 쪽만 ②까지 요구한다.
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

    // `literal.start` 는 여는 따옴표 **다음** 이다.
    if (!findSymbolStringConsumerAt(lineText, literal.start - 1)) {
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

/**
 * 식별자 위치가 **타입 이름 사용부**인지 판정한다 — `As X` / `New X` / `As New X`.
 *
 * GPL에서 클래스 이름은 선언(`Class X`)과 사용부의 모양이 다르지 않아 이름 검색만으로도
 * 찾히지만, 사용부에서 참조 찾기를 실행했을 때 그 이름이 **타입**을 가리킨다는 사실은
 * 앞 토큰(`As`/`New`)으로만 알 수 있다. 참조 검색은 이 판정으로 타입 선언을 복원해
 * 선언에서 실행했을 때와 같은 스코프를 쓴다.
 *
 * 한정 표기(`As ROB.MachineRobot`)의 마지막 이름도 타입 사용부지만, 그 경우는 한정자
 * 해석이 따로 있으므로 여기서는 점 바로 뒤를 인정하지 않는다.
 */
export function isTypeUsageAt(lineText: string, character: number): boolean {
    const before = lineText.slice(0, Math.max(0, character));
    return /\b(?:As|New)\s+(?:New\s+)?$/i.test(before);
}
