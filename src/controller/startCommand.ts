/**
 * `Start` 콘솔 명령 조립 — 순수 로직(vscode 무의존).
 *
 * 공식 문서(Console Commands / Start) 구문:
 *
 * ```
 * Start project_name [-name thread_name] [-bex] [-break] [-compile] [-event] [-init] [-noevent] [-stack stack_size] [-trace]
 * ```
 *
 * 스위치 의미(문서 원문 요약):
 * - `-name`   새 쓰레드 이름 지정(기본값은 프로젝트명)
 * - `-bex`    예외가 나면 Try/Catch 를 건너뛰고 즉시 정지
 * - `-break`  첫 명령 실행 직전에 정지
 * - `-compile` 시작 전에 컴파일/재컴파일(프로젝트가 이미 load 되어 있어야 함)
 * - `-event`  쓰레드 상태 변경을 **콘솔 메시지가 아니라 이벤트로** 보낸다 → 1403 `<E>…</E>`
 * - `-noevent` 앞선 `-event` 를 되돌린다(GDE 콘솔에서 쓰는 용도)
 * - `-init`   trace/단일 스텝 중 초기화 문장도 표시(보통 `-break`/`-trace` 와 함께)
 * - `-stack`  프로시저 스택 크기(KB, 문서 기본값 4)
 * - `-trace`  실행 문장을 콘솔에 표시 — **성능이 크게 떨어진다**
 *
 * 이 저장소의 규칙 두 가지를 여기서 강제한다.
 *
 * 1. **`-compile` 은 절대 붙이지 않는다.** PA 제어기의 Start 는 스위치 없이도 자체 컴파일하며
 *    (사용자 실사용 사실, CLAUDE.md 하드 규칙 7 — 문서와 다름), 컴파일은 `Compile` 명령으로
 *    따로 수행한다. Compile 직후 Start 연속 전송도 금지다(§0.7).
 * 2. **GDE 와 같은 기본값**: 캡처 2회 모두 GDE 는 `Start <project> -event` 를 보냈다(2026-06-23).
 *    상태 변경을 1403 이벤트로 받는 쪽이 폴링 의존을 줄이므로 기본값을 `-event` 로 둔다.
 *
 * 단위 테스트: src/test/startCommand.test.ts
 */

export interface StartCommandOptions {
    /** 제어기 쪽 프로젝트 이름(공백 검사는 projectNameGuard 가 담당). */
    projectName: string;
    /** `-event` (기본 true — GDE 동일). false 면 `-noevent` 를 붙인다. */
    eventMode?: boolean;
    /** `-break` — 첫 명령 전에 정지(디버거 stopOnEntry). */
    breakOnEntry?: boolean;
    /** `-bex` — 예외 발생 시 Try/Catch 를 건너뛰고 즉시 정지. */
    breakOnException?: boolean;
    /** `-init` — 초기화 문장도 표시(문서: -break/-trace 와 함께 쓴다). */
    showInitStatements?: boolean;
    /** `-stack <KB>` — 문서 기본값 4. 1~1024 범위를 벗어나면 무시한다. */
    stackSizeKb?: number;
    /** `-name <thread>` — 쓰레드 이름 지정. 공백이 있으면 무시한다(1402 인자는 공백 구분). */
    threadName?: string;
    /** `-trace` — 실행 문장 콘솔 표시. 성능 저하가 크므로 명시적으로 켤 때만. */
    trace?: boolean;
}

/** `-stack` 허용 범위(KB). 문서에 상한 표기는 없으나 오타로 큰 값이 가는 것을 막는다. */
const MIN_STACK_KB = 1;
const MAX_STACK_KB = 1024;

/** 프로젝트/쓰레드 이름에 1402 인자를 깨뜨리는 공백류가 있는가. */
function hasWhitespace(value: string): boolean {
    return /[\s 　]/.test(value);
}

/**
 * `Start` 명령 문자열을 만든다. 스위치 순서는 공식 문서 구문 순서를 따른다.
 * 프로젝트명이 비어 있거나 공백을 포함하면 예외를 던진다(호출측이 사전에 막아야 한다).
 */
export function buildStartCommand(options: StartCommandOptions): string {
    const project = (options.projectName ?? '').trim();
    if (!project) {
        throw new Error('Start: 프로젝트 이름이 비어 있습니다.');
    }
    if (hasWhitespace(project)) {
        throw new Error(`Start: 프로젝트 이름에 공백이 있어 명령이 끊깁니다 — "${project}"`);
    }

    const parts = [`Start ${project}`];

    const threadName = (options.threadName ?? '').trim();
    if (threadName && !hasWhitespace(threadName)) {
        parts.push(`-name ${threadName}`);
    }
    if (options.breakOnException) { parts.push('-bex'); }
    if (options.breakOnEntry) { parts.push('-break'); }
    // `-compile` 은 의도적으로 없다(위 주석 1번).
    if (options.eventMode === false) {
        parts.push('-noevent');
    } else {
        parts.push('-event');
    }
    if (options.showInitStatements) { parts.push('-init'); }

    const stack = options.stackSizeKb;
    if (typeof stack === 'number' && Number.isInteger(stack) && stack >= MIN_STACK_KB && stack <= MAX_STACK_KB) {
        parts.push(`-stack ${stack}`);
    }
    if (options.trace) { parts.push('-trace'); }

    return parts.join(' ');
}
