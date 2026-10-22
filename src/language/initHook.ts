/**
 * `Init` 이름 규칙 — GPL 모듈 초기화 훅과 부딪히는 선언을 찾는다. vscode 무의존 순수 모듈.
 *
 * 공식 문서 GPL/modules.htm:
 *   "If a user Sub procedure named Init is defined within a module, it is executed as part of the module
 *    initialization, before the startup procedure begins."
 *   "An internal Sub procedure named _Init is automatically generated … Do not attempt to create a procedure with this name."
 *
 * 2026-09-21 실기 재현(samples/init-probe Stage B, ai-handoff §1-EA): 이 이름 조회는 **모듈 안 클래스의 Private 메서드**까지
 * 잡아채 인스턴스 없이 부른다 → 첫 필드 접근에서 `-757 *Object not instantiated*`, 시작 프로시저는 한 줄도 돌지 않는다.
 * GenAdp 의 `LineBuffer.Init` 이 그렇게 죽었다.
 *
 * 심각도 설계 — 소음을 내지 않는다:
 *   - 클래스 멤버 `Init`   → warning. 거의 확실한 사고 경로다(Sub 로 재현, Function 은 같은 이름 조회라 함께 경고).
 *   - `_Init`              → error. 문서가 금지한 컴파일러 내부 이름.
 *   - 모듈 수준 `Sub Init` → hint. 문서화된 합법 훅이고 레거시 프로젝트가 의도적으로 비워 두므로 Problems 에 올리지 않되,
 *                            "Start 때 자동 실행된다" 는 사실은 호버로 알 수 있게 한다.
 */

import { GPLSymbol, GPLSymbolKind } from './gplParser';

export type InitHookSeverity = 'error' | 'warning' | 'hint';

export interface InitHookFinding {
    symbol: GPLSymbol;
    severity: InitHookSeverity;
    /** 진단 코드 — 설정/억제·테스트에서 종류를 가르는 안정된 식별자. */
    code: 'init-hook-internal-name' | 'init-hook-class-member' | 'init-hook-module';
    message: string;
}

const DOC_URL = 'https://www2.brooksautomation.com/Controller_Software/Introduction_To_The_Software/Guidance_Programming_Language/modules.htm';

function isProcedure(s: GPLSymbol): boolean {
    return s.kind === GPLSymbolKind.Sub || s.kind === GPLSymbolKind.Function;
}

/** 파싱된 심볼에서 `Init`/`_Init` 선언을 골라 규칙별 진단을 만든다. 순서는 입력 순서 그대로. */
export function findInitHookFindings(symbols: readonly GPLSymbol[]): InitHookFinding[] {
    const out: InitHookFinding[] = [];
    for (const s of symbols) {
        if (!isProcedure(s)) { continue; }
        const name = s.name.trim().toLowerCase();
        if (name === '_init') {
            out.push({
                symbol: s,
                severity: 'error',
                code: 'init-hook-internal-name',
                message: '`_Init` 은 GPL 컴파일러가 모듈 초기화용으로 자동 생성하는 내부 이름입니다 — 문서가 이 이름의 프로시저 작성을 금지합니다. '
                    + `(${DOC_URL})`,
            });
            continue;
        }
        if (name !== 'init') { continue; }
        if (s.className) {
            out.push({
                symbol: s,
                severity: 'warning',
                code: 'init-hook-class-member',
                message: `클래스 '${s.className}' 의 메서드 이름이 \`Init\` 입니다. GPL 은 모듈 초기화 때 \`Init\` 을 이름으로 찾아 시작 프로시저보다 먼저 `
                    + '자동 호출하는데, 클래스 멤버도 잡아채 **인스턴스 없이** 부릅니다 → 첫 필드 접근에서 `-757 Object not instantiated`, '
                    + '시작 프로시저는 실행되지 않습니다(2026-09-21 실기 재현). `InitDefaults`·`Reset` 등 다른 이름을 쓰세요. '
                    + `(${DOC_URL})`,
            });
            continue;
        }
        if (s.kind === GPLSymbolKind.Sub) {
            out.push({
                symbol: s,
                severity: 'hint',
                code: 'init-hook-module',
                message: '모듈 수준 `Sub Init` 은 GPL 이 모듈 초기화 때 시작 프로시저보다 먼저 **자동 호출**하는 훅입니다(문서화됨). '
                    + '의도한 초기화라면 그대로 두되, 왜 있는지 주석을 남기세요. '
                    + `(${DOC_URL})`,
            });
        }
    }
    return out;
}
