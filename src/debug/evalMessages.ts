/**
 * 변수 평가 실패를 사용자 문구로 바꾸는 순수 헬퍼(vscode 무의존) — hover·Watch·REPL·Variables 트리가 공유한다.
 *
 * 실기기 확인(GPL 4.2K5, 2026-07-22 · 2026-08-25): `Show Variable -eval`은 프레임의 로컬/파라미터·모듈 전역·
 * 객체 덤프(1단계 멤버 줄)만 준다. 자주 만나는 실패 STATUS:
 * - -780 "*Unsupported procedure reference*": 식의 마지막 요소가 사용자 Property/Function(인자 유무 무관).
 * - -729 "*Undefined symbol*": 그 프레임 스코프에 없는 이름 — 다른 프레임의 로컬, 객체의 배열 필드,
 *   **클래스 밖 프레임에서의 Private 필드 점 표기**(`rt1.rt1Datafile`, ai-handoff §1-DS).
 * - -762/-763: Location 타입 불일치. -712: 콘솔 평가기가 받지 않는 구문.
 *
 * 문구 원칙: 좁은 디버그 hover 에서는 값의 앞 60자 정도만 보이므로 **STATUS 코드와 원인을 앞에**, 대처는 뒤에 둔다.
 * 긴 설명은 Debug Console 용 `detail` 로 분리한다.
 *
 * 단위 테스트: src/test/evalMessages.test.ts
 */

/** `Show Variable -eval` 이 돌려준 실패 STATUS. */
export interface EvalError { code: number; message: string }

/** GPL 콘솔 STATUS -729 "*Undefined symbol*" — 그 실행 컨텍스트에서 이름이 보이지 않음. */
export const UNDEFINED_SYMBOL_STATUS = -729;

/** GPL 콘솔 STATUS -780 "*Unsupported procedure reference*" — 식의 마지막 요소가 사용자 프로시저. */
export const UNSUPPORTED_PROCEDURE_STATUS = -780;

/**
 * Show Variable 실패 STATUS를 사용자 안내 문구로 변환한다(hover·Watch·REPL 공용).
 * - -780: 이름이 프로퍼티/메서드로 해석됨 — 인자 유무와 무관하게 프로퍼티도 평가 불가(`cmd.ints(0)`, 클래스 프로퍼티 `robotIndex`).
 * - -729: 해당 프레임 스코프에 없는 이름(다른 프레임 로컬 등), 또는 객체의 배열 필드 접근(`cmd.m_rawArgs(0)`).
 */
export function formatEvalError(expression: string, error: EvalError): string {
    const base = `(평가 실패 ${error.code}: ${error.message || '원인 미상'})`;
    if (error.code === UNSUPPORTED_PROCEDURE_STATUS) {
        return `${base} — 프로퍼티/메서드 참조는 제어기 콘솔이 평가하지 못합니다(필드/로컬만 가능). 소스에서 Property로 확인되면 백킹 필드(Get 반환식·m_이름)로 자동 치환하지만 이 식은 치환할 수 없었습니다. 백킹 필드를 직접 확인하세요 (예: ${expression.split('.')[0] || expression} 객체를 펼쳐 m_* 필드 조회)`;
    }
    if (error.code === UNDEFINED_SYMBOL_STATUS) {
        return `${base} — 현재 프레임 스코프에 없는 이름이거나, 점 표기 멤버 접근입니다 (이 제어기의 콘솔 평가는 프레임의 로컬/파라미터 이름만 지원 — 멤버 값은 부모 객체를 조회하세요)`;
    }
    if (error.code === -762 || error.code === -763) {
        // 실측(2026-08-25, GitHub #27): -762 "*Location not a Cartesian type*"(Angles에 X 접근), -763 "*Location not an angles type*"(Cartesian에 Angle(i) 접근)
        const guide = error.code === -763
            ? 'Cartesian(Type 0)이라 Angle(i)가 없습니다 — X/Y/Z/Yaw/Pitch/Roll을'
            : 'Angles(Type 1)라 X/Y/Z/Yaw/Pitch/Roll이 없습니다 — Angle(1..n)을';
        return `${base} — Location 타입 불일치: 이 Location은 ${guide} 조회하세요`;
    }
    if (error.code === -712) {
        return `${base} — 콘솔 평가기가 받지 않는 구문입니다(\`Me.\` 접두, CStr/CInt 같은 시스템 함수 감싸기, 산술식). 변수/필드 식만 입력하세요`;
    }
    return base;
}

/** 중첩 객체 노드를 펼쳤는데 멤버 줄을 얻지 못했을 때 Variables 트리에 넣는 안내 행. */
export interface NestedExpandFailureRow {
    /** 행 이름 — 값 행이 아님을 이름에서 알 수 있게 한다 */
    name: string;
    /** 행 값 — STATUS 코드·원인이 앞, 대처가 뒤 */
    value: string;
    /** Debug Console 에 남길 한 줄(식·타입·대처 포함) */
    detail: string;
}

/**
 * 부모 덤프에 `Object X` 로만 실려 온 멤버(`rt1.rt1Datafile`)를 펼쳤을 때, 직접 평가가 실패해 멤버 줄이 없는 경우의 안내.
 * 종전 `(값) = ℹ 이 제어기는 중첩 객체 멤버의 개별 조회를 지원하지 않습니다 …` 는 ① 실패 코드를 버려 원인이 틀릴 수
 * 있었고(-729 는 "지원 안 함"이 아니라 "이 프레임에서 안 보임"), ② `ℹ` 가 hover 글꼴에서 `i` 로 보였고, ③ 앞부분만
 * 보이는 hover 에서 원인이 뒤에 있어 읽히지 않았다(사용자 스크린샷 2026-09-17).
 *
 * @param error 직접 평가(`Show Variable -eval … obj.field`)의 실패 STATUS. 없으면 "응답은 왔지만 멤버 줄이 없음".
 * @param frameDescription 정지 프레임 설명(`GPL.MAIN` 등) — 있으면 detail 에 넣어 어느 프레임에서 안 보였는지 남긴다.
 */
export function describeNestedExpandFailure(input: {
    expression: string;
    varType: string;
    error?: EvalError;
    frameDescription?: string;
}): NestedExpandFailureRow {
    const { expression, error } = input;
    const type = input.varType.trim() || 'Object';
    const leaf = expression.slice(expression.lastIndexOf('.') + 1);
    const frame = input.frameDescription ? ` (프레임 ${input.frameDescription})` : '';
    const name = '(펼칠 수 없음)';

    if (!error) {
        return {
            name,
            value: `${type} — 제어기가 멤버 줄을 돌려주지 않았습니다 (필드가 없는 객체이거나, 이 펌웨어는 중첩 객체의 내용을 부모 덤프에 싣지 않음)`,
            detail: `${expression} 펼치기${frame}: 응답에 멤버 줄이 없음 (타입 ${type}). 부모 덤프에는 중첩 객체의 존재만 실려 옵니다.`,
        };
    }

    const status = `${error.code}${error.message ? ` ${error.message}` : ''}`;
    if (error.code === UNDEFINED_SYMBOL_STATUS) {
        return {
            name,
            value: `${status} — 현재 프레임에서 해석되지 않는 이름입니다(클래스 밖 프레임의 Private 필드 등). 그 클래스 안의 프레임에서 정지하면 펼칠 수 있습니다`,
            detail: `${expression} 펼치기 실패 ${status}${frame}: 이 프레임에서는 점 표기 ${leaf} 를 제어기가 해석하지 못하고, 부모 덤프에는 ${type} 존재만 실려 옵니다. `
                + `그 클래스의 프로시저 안에서 정지한 뒤 조회하면 같은 이름으로 읽힙니다(실측 2026-08-25).`,
        };
    }
    if (error.code === UNSUPPORTED_PROCEDURE_STATUS) {
        return {
            name,
            value: `${status} — ${leaf} 이(가) 프로시저(Property/Function)로 해석되어 제어기 콘솔이 평가하지 못합니다. 백킹 필드(m_*)를 조회하세요`,
            detail: `${expression} 펼치기 실패 ${status}${frame}: 마지막 요소가 사용자 프로시저라 -eval 이 평가하지 않습니다(백킹 필드 자동 치환도 실패). 부모 객체의 m_* 필드에서 값을 확인하세요.`,
        };
    }
    return {
        name,
        value: `${status} — 제어기가 ${expression} 평가를 거부했습니다`,
        detail: `${expression} 펼치기 실패 ${status}${frame} (타입 ${type}).`,
    };
}
