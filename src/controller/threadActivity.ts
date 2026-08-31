/**
 * 쓰레드 활성 판정 — 순수 로직(vscode 무의존).
 *
 * 왜: 제어기의 "동작 중" 판정은 상태 문자열이 아니라 **쓰레드의 존재**로 해야 안전하다
 * (사용자 규약, 2026-08-28). 근거 두 가지:
 *
 * 1. `Execute <문장>, <project>` 는 문서상 `_Cmd_<project>` 라는 **별도 쓰레드**에서 실행된다.
 *    이름이 프로젝트명과 다르므로 이름만 비교하면 그 프로젝트가 동작 중인 것을 놓친다.
 * 2. `Idle`/`Stopped`/`Error` 로 보이는 쓰레드도 제어기 쪽 자원을 아직 들고 있을 수 있고,
 *    Stop 의 STATUS 0 은 "정지 요청 접수"일 뿐이다(§0.6). 즉 목록에 남아 있으면 아직 끝난 게 아니다.
 *
 * 그래서 이 모듈의 기본 판정은 **`Show Thread -web` 목록에 항목이 있으면 동작 중**이다.
 * 상태 문자열은 사용자에게 이유를 설명할 때만 쓴다(`describeThreadActivity`).
 *
 * 프로젝트 단위 판정은 ① `project` 컬럼 일치 ② 쓰레드 이름 == 프로젝트명(기본 이름 규칙)
 * ③ 쓰레드 이름 == `_Cmd_<프로젝트명>`(Execute 쓰레드) 중 하나라도 맞으면 그 프로젝트가 동작 중이다.
 * `Start -name` 으로 이름을 바꾼 쓰레드는 ①로 잡힌다.
 *
 * 단위 테스트: src/test/threadActivity.test.ts
 */

/** 판정에 필요한 최소 형태 — responseParser.ThreadInfo 가 그대로 들어맞는다. */
export interface ThreadLike {
    name: string;
    state?: string;
    project?: string;
}

/** `Execute` 가 만드는 쓰레드 이름 접두(문서: `_Cmd_<project_name>`). */
export const EXECUTE_THREAD_PREFIX = '_Cmd_';

/** 정지 계열 상태(표시·설명용). 존재 자체가 활성이라는 판정을 대체하지 않는다. */
const SETTLED_STATE = /^(idle|stopped|error)$/i;

/** 상태 문자열이 정지 계열인지 — 설명 문구를 만들 때만 쓴다. */
export function isSettledState(state: string | undefined): boolean {
    return SETTLED_STATE.test((state ?? '').trim());
}

/** 쓰레드 이름을 정규화(대소문자 무시 — GPL/VB.NET 계열은 대소문자를 구분하지 않는다). */
function norm(s: string | undefined): string {
    return (s ?? '').trim().toLowerCase();
}

/**
 * `Execute` 쓰레드 이름에서 프로젝트명을 뽑는다. `_Cmd_My_project` → `My_project`.
 * 접두가 없으면 undefined.
 */
export function executeThreadProject(threadName: string): string | undefined {
    const name = (threadName ?? '').trim();
    if (name.length <= EXECUTE_THREAD_PREFIX.length) { return undefined; }
    if (name.slice(0, EXECUTE_THREAD_PREFIX.length).toLowerCase() !== EXECUTE_THREAD_PREFIX.toLowerCase()) {
        return undefined;
    }
    return name.slice(EXECUTE_THREAD_PREFIX.length);
}

/** 이 쓰레드가 지정 프로젝트에 속하는가(project 컬럼 / 기본 이름 / `_Cmd_` 쓰레드). */
export function threadBelongsToProject(thread: ThreadLike, projectName: string): boolean {
    const proj = norm(projectName);
    if (!proj) { return false; }
    if (norm(thread.project) === proj) { return true; }
    if (norm(thread.name) === proj) { return true; }
    return norm(executeThreadProject(thread.name)) === proj;
}

/**
 * 제어기가 "완전 정지"인가 — 쓰레드 목록이 비어 있을 때만 true.
 * 목록을 확인할 수 없으면(무응답) 호출측이 이 함수를 쓰지 말고 "확인 불가"로 처리해야 한다(하드 규칙 2).
 */
export function isControllerIdle(threads: readonly ThreadLike[]): boolean {
    return threads.length === 0;
}

/** 이 프로젝트가 동작 중인가 — 소속 쓰레드가 하나라도 존재하면 true. */
export function isProjectRunning(threads: readonly ThreadLike[], projectName: string): boolean {
    return threads.some(t => threadBelongsToProject(t, projectName));
}

/** 이 프로젝트에 속한 쓰레드만 추린다. */
export function projectThreads(threads: readonly ThreadLike[], projectName: string): ThreadLike[] {
    return threads.filter(t => threadBelongsToProject(t, projectName));
}

/**
 * 사용자·로그용 설명. 존재만으로 활성이므로 "활성/정지 상태" 구분은 이유 설명에만 쓴다.
 * 빈 목록이면 빈 문자열.
 */
export function describeThreadActivity(threads: readonly ThreadLike[]): string {
    if (threads.length === 0) { return ''; }
    const parts = threads.map(t => {
        const exec = executeThreadProject(t.name);
        const tag = exec ? ` — Execute 쓰레드(${exec})` : '';
        return `${t.name}(${(t.state ?? '?').trim()})${tag}`;
    });
    const settledOnly = threads.every(t => isSettledState(t.state));
    const suffix = settledOnly ? ' — 정지 계열 상태지만 목록에 남아 있어 동작 중으로 판정' : '';
    return `쓰레드 ${threads.length}개: ${parts.join(', ')}${suffix}`;
}
