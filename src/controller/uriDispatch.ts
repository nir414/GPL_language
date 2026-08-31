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
 * 단위 테스트: src/test/uriDispatch.test.ts
 */

export type UriAliasAction = 'connect' | 'disconnect' | 'getState' | 'dashboard';

export type UriResolution =
    | { kind: 'alias'; action: UriAliasAction; query: URLSearchParams }
    | { kind: 'command'; commandId: string; args: unknown }
    | { kind: 'invalid'; reason: string };

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

    try {
        return { kind: 'command', commandId, args: parseUriArgs(q) };
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
