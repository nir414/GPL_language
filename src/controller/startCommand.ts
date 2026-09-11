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
 * 1. **`-compile` 은 기본으로 항상 붙인다** (2026-09-10 사용자 실기 관측·결정, §1-DN).
 *    이전에는 "PA 제어기의 Start 는 스위치 없이도 자체 컴파일한다"는 전제로 `-compile` 을
 *    금지했으나(옛 하드 규칙 7), 실제로는 **컴파일하지 않고 직전에 컴파일돼 있던 바이너리를
 *    그대로 실행**한다. 그래서 FTP 로 `/GPL` 에 새 소스를 올려도 옛 코드가 돌아갔다.
 *    캡처(`captures/gde_1402.pcapng`)의 GDE 도 `Load … → COMPILE <proj> → Start <proj> -event`
 *    순서로 **Start 앞에 명시적 `COMPILE` 을 따로 보냈다** — `-event` 만 보고 "자체 컴파일"로
 *    읽었던 것이 오해의 출처다. 확장은 Compile 을 따로 보내지 않는 경로가 있으므로
 *    (`gpl.start`·`gpl.uploadStart`·디버거 F5) 스위치 쪽으로 보장한다.
 *    끄려면 `compile: false` 를 명시해야 한다 — 기본값에 기대지 말 것.
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
    /**
     * `-compile` — 시작 전에 컴파일/재컴파일. **기본 true**(위 주석 1번).
     * `false` 를 명시하면 뺀다: 직전에 `Compile` 명령으로 이미 컴파일한 경로가 이중 컴파일을
     * 피하고 싶을 때만 쓴다. 빼면 그 시점의 옛 바이너리가 실행될 수 있다.
     */
    compile?: boolean;
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

/**
 * 이 명령이 제어기에서 **컴파일을 수행하는가** — 응답 대기 규칙을 고르는 데 쓴다.
 *
 * `-compile` 이 붙은 `Start` 는 `Compile` 과 똑같이 pass 사이에 수 초간 침묵하고 응답이 길다.
 * 짧은 idle 조기 완료로 받으면 `<DATA>… begin compiler pass 2` 에서 잘려 `</STATUS>` 를 놓치고
 * `-9999 No STATUS found` 로 실패 판정된다(2026-09-10 실기 관측 — `-compile` 도입 직후의 첫 증상).
 * 그래서 이런 명령은 `waitForStatusClose` + 긴 타임아웃으로 보내야 한다.
 */
export function commandRunsCompiler(command: string): boolean {
    const c = (command ?? '').trim();
    if (/^compile\b/i.test(c)) { return true; }
    return /^start\b/i.test(c) && /(^|\s)-compile(\s|$)/i.test(c);
}

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
    // `-compile` 기본 on — 빼려면 `compile: false` 를 명시해야 한다(위 주석 1번).
    if (options.compile !== false) { parts.push('-compile'); }
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
