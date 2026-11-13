/**
 * 커서 위치에서 "보이는 선언"을 고르는 스코프 판정 정본 — vscode 비의존 순수 모듈.
 *
 * 종전에는 정의 이동(definitionProvider)과 이름 바꾸기(renameProvider)가 각자
 * "커서가 속한 프로시저 안의 후보가 있으면 그것, 없으면 전체 후보 중 커서 위쪽에서
 * 가장 가까운 것"을 골랐다. 이 규칙은 **다른 프로시저의 동명 로컬**을 골라 버린다:
 *
 *     Public count As Integer      ' ← 실제 대상(모듈 레벨)
 *     Public Sub A()
 *         Dim count As Integer     ' ← 무관한 로컬인데 "커서 위쪽에서 가장 가까움"
 *     End Sub
 *     Public Sub B()
 *         count = count + 1        ' ← 커서. Sub B에는 동명 로컬이 없다
 *     End Sub
 *
 * 그 결과 F12는 엉뚱한 프로시저로 점프하고, F2는 그 잘못된 판정 때문에
 * "커서가 있는 프로시저 안에서만" 이름을 바꿔 선언·다른 파일을 옛 이름으로 남겼다.
 *
 * GPL(VB 계열) 가시성 규칙은 단순하다:
 *   - 프로시저 안의 로컬/파라미터는 **그 프로시저 안에서만** 보인다.
 *   - 모듈/클래스 레벨 선언은 파일 전체에서 보이고, 같은 이름의 로컬에 가려진다(섀도잉).
 */

/** 스코프 판정에 필요한 최소 정보 — GPLSymbol이 그대로 만족한다. */
export interface ScopedDeclaration {
    /** 선언 줄 (0-based) */
    line: number;
    /** 프로시저 본문 안에서 선언됐는지(로컬·파라미터) */
    isLocal?: boolean;
}

/** 프로시저의 [헤더..End] 줄 범위. */
export interface ProcedureRange {
    startLine: number;
    endLine: number;
}

/**
 * 선언이 커서 위치에서 보이는지 판정.
 *
 * @param proc 커서를 감싸는 프로시저 범위 (프로시저 밖이면 undefined)
 */
export function isVisibleFrom(decl: ScopedDeclaration, proc: ProcedureRange | undefined): boolean {
    if (!decl.isLocal) {
        return true; // 모듈/클래스 레벨 — 파일 전체에서 보인다
    }
    return !!proc && decl.line >= proc.startLine && decl.line <= proc.endLine;
}

/**
 * 동명 후보들 중 커서 위치에서 실제로 참조되는 선언 하나를 고른다.
 *
 * 규칙: 보이는 후보만 남기고 → 같은 프로시저의 로컬이 모듈 레벨을 가리며(섀도잉,
 * 선언이 커서보다 아래여도 프로시저 전체가 스코프다) → 그 안에서 커서 위쪽으로
 * 가장 가까운 선언, 없으면 아래쪽으로 가장 가까운 선언.
 *
 * @param proc 커서를 감싸는 프로시저 범위 (프로시저 밖이면 undefined)
 * @param atLine 커서 줄 (0-based)
 */
export function pickVisibleDeclaration<T extends ScopedDeclaration>(
    candidates: readonly T[],
    proc: ProcedureRange | undefined,
    atLine: number
): T | undefined {
    const visible = candidates.filter(c => isVisibleFrom(c, proc));
    if (visible.length === 0) {
        return undefined;
    }
    const locals = visible.filter(c => c.isLocal);
    const pool = locals.length > 0 ? locals : visible;

    const above = pool.filter(c => c.line <= atLine).sort((a, b) => b.line - a.line);
    if (above.length > 0) {
        return above[0];
    }
    return [...pool].sort((a, b) => a.line - b.line)[0];
}
