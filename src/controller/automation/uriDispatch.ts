/**
 * 외부 진입점 URI(`vscode://nir414.gpl-language-support/...`) 해석 — 순수 로직(vscode 무의존). GitHub #25 B → 2026-08-28 전체 명령 개방.
 *
 * 형식:
 *  - `/<gpl.command.id>?args=<JSON>`                 — 인자 1개를 JSON 으로(객체·배열·원시값 모두 가능)
 *  - `/<gpl.command.id>?key=value&key2=value2`       — 평면 인자 → 객체 1개(숫자/불리언/JSON 리터럴 자동 변환)
 *  - `/command?id=<gpl.command.id>&args=<JSON>`      — 명령 id 를 쿼리로 주는 형태(경로에 점을 쓰기 어려운 호출자용)
 *  - 별칭(종전 호환): `/connect?ip&port[&save=settings]`, `/disconnect`, `/getState`(=`/getConnectionState`), `/dashboard`
 *
 * 왜 `gpl.*` 만인가: 접근 제한이 아니라 범위 한정이다 — 이 확장의 진입점이 임의 VS Code 명령(`workbench.action.terminal.sendSequence` 등)의
 * 프록시가 되면 안 된다. 제어기 안전 조건은 명령 계층의 정책(commandPolicy.ts)이 경로와 무관하게 충족시키므로 여기에 허용 목록을 두지 않는다.
 *
 * 토큰(2026-11-04 §1-GZ): URI 는 웹 페이지·문서의 링크로도 열린다. VS Code 의 "이 URI 열기 허용"에서 다시 묻지 않음을 고르면 링크
 * 클릭만으로 1402 명령(모션 포함)이 나갈 수 있었다. 그래서 조회 전용 몇 개(`URI_TOKENLESS_COMMANDS`·별칭)를 뺀 명령은 쿼리
 * `token=<값>` 이 `%TEMP%\gpl-controller\uri-token` 과 같아야 실행한다 — 같은 PC 의 터미널·에이전트는 파일을 읽어 그대로 쓸 수
 * 있으므로 AI 접근을 막는 것이 아니고, 파일을 읽을 수 없는 웹 페이지만 막힌다.
 *
 * 단위 테스트: src/test/controller/automation/uriDispatch.test.ts
 */

export type UriAliasAction = 'connect' | 'disconnect' | 'getState' | 'dashboard';

export type UriResolution =
    | { kind: 'alias'; action: UriAliasAction; query: URLSearchParams }
    | { kind: 'command'; commandId: string; args: unknown; token?: string }
    | { kind: 'invalid'; reason: string };

/**
 * 토큰 없이 URI 로 실행해도 되는 명령 — 상태를 읽어 Output 에 남기거나 화면만 여는 것. MCP 가 확장을 깨울 때 쓰는
 * `gpl.ai.debug.getConnectionState`(controller-mcp extensionBridge.wakeExtension)가 여기 있어야 한다.
 */
export const URI_TOKENLESS_COMMANDS: ReadonlySet<string> = new Set([
    'gpl.ai.debug.getConnectionState',
    'gpl.ai.debug.getState',
    'gpl.controller.showDashboard',
]);

/** 이 명령을 URI 로 실행하려면 토큰이 필요한가. */
export function uriCommandNeedsToken(commandId: string): boolean {
    return !URI_TOKENLESS_COMMANDS.has(commandId);
}

/** 토큰 비교(길이가 같을 때 상수 시간). 기대값이 없으면(파일을 만들지 못함) 항상 거짓 — 닫힌 쪽으로 실패한다. */
export function uriTokenMatches(expected: string | undefined, given: string | undefined): boolean {
    if (!expected || !given || expected.length !== given.length) { return false; }
    let diff = 0;
    for (let i = 0; i < expected.length; i++) { diff |= expected.charCodeAt(i) ^ given.charCodeAt(i); }
    return diff === 0;
}

const ALIASES: ReadonlyMap<string, UriAliasAction> = new Map([
    ['connect', 'connect'],
    ['disconnect', 'disconnect'],
    ['getstate', 'getState'],
    ['getconnectionstate', 'getState'],
    ['dashboard', 'dashboard'],
]);

/** 이 확장의 명령 id 형식. (package.json `contributes.commands` 는 모두 `gpl.` 접두어) */
export const GPL_COMMAND_ID_PATTERN = /^gpl\.[A-Za-z0-9_.]+$/;

export function resolveUriRequest(path: string, query: string | undefined): UriResolution {
    const action = (path ?? '').replace(/^\/+|\/+$/g, '');
    const q = new URLSearchParams(query ?? '');
    if (!action) {
        return { kind: 'invalid', reason: '동작이 비어 있음 — /<gpl.command.id> 또는 /command?id=… 형식' };
    }

    const alias = ALIASES.get(action.toLowerCase());
    if (alias) {
        return { kind: 'alias', action: alias, query: q };
    }

    let commandId = action;
    if (action.toLowerCase() === 'command') {
        const id = q.get('id');
        if (!id) {
            return { kind: 'invalid', reason: '/command 에는 id 쿼리가 필요함 (예: /command?id=gpl.ai.debug.getState)' };
        }
        commandId = id;
        q.delete('id');
    }

    if (!GPL_COMMAND_ID_PATTERN.test(commandId)) {
        return { kind: 'invalid', reason: `'${commandId}' — 이 확장의 명령(gpl.*)만 URI로 실행할 수 있음` };
    }

    // 토큰은 인자가 아니다 — 명령에 넘기기 전에 뺀다.
    const token = q.get('token') ?? undefined;
    q.delete('token');
    try {
        return { kind: 'command', commandId, args: parseUriArgs(q), ...(token !== undefined ? { token } : {}) };
    } catch (err) {
        return { kind: 'invalid', reason: (err as Error).message };
    }
}

/**
 * 쿼리 → 명령 인자. `args` 가 있으면 그것을 JSON 으로 해석한 값 하나(다른 키는 무시), 없으면 남은 키들을 객체 하나로 묶는다.
 * 키가 하나도 없으면 undefined(인자 없이 호출).
 */
export function parseUriArgs(q: URLSearchParams): unknown {
    const rawJson = q.get('args');
    if (rawJson !== null) {
        try {
            return JSON.parse(rawJson);
        } catch (err) {
            throw new Error(`args JSON 파싱 실패: ${(err as Error).message}`);
        }
    }
    const obj: Record<string, unknown> = {};
    let any = false;
    for (const [key, value] of q) {
        any = true;
        obj[key] = coerceUriValue(value);
    }
    return any ? obj : undefined;
}

/** 평면 쿼리 값의 자동 변환: true/false → boolean, 숫자 형태 → number, `{…}`/`[…]` → JSON(실패 시 문자열 유지), 그 외 문자열. */
export function coerceUriValue(value: string): unknown {
    if (value === 'true') { return true; }
    if (value === 'false') { return false; }
    if (/^-?\d+(\.\d+)?$/.test(value)) { return Number(value); }
    if ((value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']'))) {
        try { return JSON.parse(value); } catch { /* 문자열 유지 */ }
    }
    return value;
}

/** Output 로그용 결과 요약(긴 JSON 은 잘라 낸다). */
export function summarizeUriResult(result: unknown, maxChars = 800): string {
    if (result === undefined) { return '(반환값 없음)'; }
    let text: string;
    try {
        text = typeof result === 'string' ? result : JSON.stringify(result);
    } catch {
        text = String(result);
    }
    if (text === undefined) { return '(직렬화 불가)'; }
    return text.length > maxChars ? `${text.slice(0, maxChars)}… (+${text.length - maxChars}자)` : text;
}
