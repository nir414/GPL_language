/**
 * 쓰레드 대상 명령(`gpl.controller.thread*`)의 인자 정규화 — vscode 무의존(순수).
 *
 * 트리 노드(`{ thread: { name, project } }`) 외에 URI/AI/스크립트 호출이 쓰기 쉬운
 * `{ threadName, project? }`·`{ name }`·문자열도 받아 노드 형태로 돌려준다(2026-08-28 URI 전체 개방).
 * 이름이 없으면 undefined — 호출측은 종전처럼 조용히 반환한다.
 */
export interface ThreadNodeArg {
    thread: { name: string; project?: string };
}

export function asThreadNode(arg: unknown): ThreadNodeArg | undefined {
    if (typeof arg === 'string') {
        return arg.trim() ? { thread: { name: arg.trim() } } : undefined;
    }
    if (!arg || typeof arg !== 'object') { return undefined; }
    const a = arg as { thread?: { name?: unknown; project?: unknown }; threadName?: unknown; name?: unknown; project?: unknown };
    if (a.thread && typeof a.thread.name === 'string' && a.thread.name) {
        return arg as ThreadNodeArg;
    }
    const name = typeof a.threadName === 'string' ? a.threadName : typeof a.name === 'string' ? a.name : '';
    if (!name.trim()) { return undefined; }
    const project = typeof a.project === 'string' ? a.project : undefined;
    return { thread: { name: name.trim(), project } };
}
