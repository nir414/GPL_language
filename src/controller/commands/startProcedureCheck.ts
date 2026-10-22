/**
 * "스레드가 정말 project-start 프로시저에서 시작했는가" 대조 — vscode 무의존 순수 모듈.
 *
 * `Start <project>` 는 문서상 **"the project-start procedure from a compiled project"** 를 실행한다
 * (Console Commands / start.htm). 그 프로시저는 `.gpr` 의 `ProjectStart="<Module>.<Proc>"` 이 정한다.
 * 따라서 스택 **최하단(가장 바깥) 프레임**은 그 프로시저여야 한다.
 *
 * 2026-09-21 GenAdp 실측: `ProjectStart="ORCH_Main.MAIN"` 인데 스레드가 `LineBuffer.Init` **한 프레임만**
 * 가진 채 `-757 *Object not instantiated*` 로 죽었다. 즉 MAIN 은 한 줄도 돌지 않았다.
 *
 * 원인은 같은 날 문서·실기로 **확정**됐다(samples/init-probe Stage B, ai-handoff §1-EA): GPL 문서 modules.htm —
 * "a user Sub procedure named Init … is executed as part of the module initialization, before the startup
 * procedure begins." 이 이름 조회가 모듈 안 **클래스의 Private 메서드**까지 잡아채 인스턴스 없이 부르므로 -757 이 난다.
 * 그래서 진입점이 `Init` 이면 원인까지 말하고, 다른 이름이면 불일치 사실만 말한다(하드 규칙 3).
 */

/** `ProjectStart="ORCH_Main.MAIN"` → `MAIN`. 한정자가 없으면 그대로. 빈 값이면 undefined. */
export function startProcedureName(projectStart: string | undefined): string | undefined {
    const raw = (projectStart ?? '').trim();
    if (!raw) { return undefined; }
    const tail = raw.split('.').pop();
    return tail ? tail.trim() : undefined;
}

/**
 * 스택 줄(`"Init @ LineBuffer.gpl:69"` 형식, 안쪽 → 바깥쪽 순)에서 가장 바깥 프레임의 프로시저 이름.
 * `Show Stack` 은 프레임 0 이 가장 안쪽이므로 마지막 줄이 진입점이다.
 */
export function outermostProcedure(stackLines: readonly string[]): string | undefined {
    for (let i = stackLines.length - 1; i >= 0; i--) {
        const name = stackLines[i].split('@')[0].trim();
        if (name) { return name; }
    }
    return undefined;
}

/**
 * 진입점이 `ProjectStart` 와 다르면 보고할 한 줄. 같거나 판단 재료가 없으면 undefined
 * (모르는 것을 경고로 바꾸지 않는다 — 스택을 못 읽었을 때 매번 경고가 뜨면 신호가 죽는다).
 * GPL 식별자는 대소문자를 구분하지 않으므로 비교도 대소문자 무시다.
 */
export function describeStartProcedureMismatch(
    projectStart: string | undefined,
    stackLines: readonly string[],
): string | undefined {
    const expected = startProcedureName(projectStart);
    const actual = outermostProcedure(stackLines);
    if (!expected || !actual) { return undefined; }
    if (expected.toLowerCase() === actual.toLowerCase()) { return undefined; }
    const head = `⚠ 진입점 불일치: 스레드가 project-start 프로시저 '${expected}'(.gpr ProjectStart="${projectStart}") 가 아니라 `
        + `'${actual}' 에서 시작했습니다 — 시작 프로시저가 한 줄도 실행되지 않았을 수 있습니다. `;
    if (actual.toLowerCase() === 'init') {
        return head + '원인: GPL 은 `Init` 이라는 이름의 Sub 를 모듈 초기화 때 시작 프로시저보다 먼저 자동 호출합니다'
            + '(문서 modules.htm). 클래스 메서드 `Init` 도 이름으로 잡혀 인스턴스 없이 불리므로 -757 이 납니다 — '
            + '프로젝트(라이브러리 포함)의 `Init` 을 다른 이름으로 바꾸세요(2026-09-21 실기 재현).';
    }
    return head + '같은 이름의 프로시저가 프로젝트(라이브러리 포함) 어딘가에 또 있는지 확인하세요.';
}
