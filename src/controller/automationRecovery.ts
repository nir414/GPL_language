/**
 * 자동화 오류의 **복구 지시** — 호출자(AI/MCP)가 오류 문장을 해석해 다음 행동을 지어내지 않게 한다.
 * vscode 무의존 — 단위 테스트: `src/test/automationRecovery.test.ts`.
 *
 * 왜(2026-09-10 사용자 개선안 §15~§17): 지금까지 자동화 실패는 `error` 코드 + 사람이 읽는 `detail`
 * 이었다. 코드 자체는 구조화돼 있었지만 **"그래서 무엇을 하면 되는가"는 문장 안에만** 있었다. 그러다 보니
 * 잠금에 막히면 다른 명령으로 우회하거나(Quick Compile 로 바꿔 보기), 타임아웃을 실패로 읽고 되풀이하는
 * 일이 생겼다. 여기서는 코드마다 ① 되풀이해도 되는지 ② 무엇을 먼저 해결해야 하는지를 **필드로** 준다.
 *
 * 설계 규칙:
 *  - `retryCurrentCommand` 는 "같은 인자로 이 명령을 그대로 다시 보내도 되는가"만 뜻한다. 조건을 해결하면
 *    되는 경우(미저장 파일 등)는 false 다 — 그 조건을 먼저 처리해야 결과가 달라지기 때문이다.
 *  - 표에 없는 코드는 보수적인 기본값(재시도 금지 + 상태 확인)으로 떨어진다. 새 오류 코드가 생겨도
 *    "모르면 되풀이한다"가 되지 않게 하는 쪽이 안전하다.
 */

/** 다음에 무엇을 할지 — MCP 응답의 `recovery.action` 으로 그대로 나간다. */
export type RecoveryAction =
    | 'NONE'                  // 되풀이해도 결과가 같다(사람의 판단·소스 수정이 필요)
    | 'CHECK_OPERATION'       // 진행 중인 작업의 결과를 먼저 확인한다
    | 'RETRY_SAME_REQUEST'    // 같은 요청을 그대로 다시 보내도 안전하다
    | 'RESOLVE_PROJECT'       // 대상 프로젝트를 특정한다(projectDir)
    | 'RESOLVE_EXTENSION'     // 명령을 수행할 VS Code 창을 특정한다
    | 'SAVE_OR_ALLOW_SAVE'    // 미저장 편집분을 저장하거나 저장을 승인한다
    | 'ASK_USER';             // 사용자 확인·실행이 필요하다(자동으로 통과시키지 않는다)

export interface RecoveryHint {
    action: RecoveryAction;
    /** 같은 인자로 이 명령을 그대로 다시 보내도 되는가. */
    retryCurrentCommand: boolean;
    /** 제어기 상태를 바꾸지 않았으므로 되풀이가 무해한가(§15 safeToRepeat). */
    safeToRepeat: boolean;
    detail: string;
}

const TABLE: Record<string, RecoveryHint> = {
    // ── 대상 해석 ────────────────────────────────────────────────────────────
    PROJECT_AMBIGUOUS: {
        action: 'RESOLVE_PROJECT', retryCurrentCommand: false, safeToRepeat: true,
        detail: '대상이 확정되지 않았으므로 배포/컴파일을 실행하지 말 것. 후보를 사용자에게 보여 주고 어느 것인지 물은 뒤 projectDir 로 다시 호출한다.',
    },
    PROJECT_NOT_FOUND: {
        action: 'RESOLVE_PROJECT', retryCurrentCommand: false, safeToRepeat: true,
        detail: '요청한 이름/경로가 이 워크스페이스의 GPL 프로젝트가 아니다. candidates 에서 고르거나 사용자에게 확인할 것.',
    },
    NO_GPL_PROJECT: {
        action: 'ASK_USER', retryCurrentCommand: false, safeToRepeat: true,
        detail: '워크스페이스에 .gpr 프로젝트가 없다. 사용자에게 GPL 프로젝트가 포함된 폴더를 열어 달라고 요청할 것.',
    },
    EXTENSION_AMBIGUOUS: {
        action: 'RESOLVE_EXTENSION', retryCurrentCommand: false, safeToRepeat: true,
        detail: '같은 제어기에 붙은 VS Code 창이 여럿이다. projectDir 로 특정하거나 extensionInstanceId 를 지정할 것 — 창을 하나만 남기라고 요구하는 것은 임시 회피다.',
    },
    EXTENSION_NOT_FOUND: {
        action: 'ASK_USER', retryCurrentCommand: false, safeToRepeat: true,
        detail: '살아 있는 확장 인스턴스가 없다. VS Code 에서 확장이 활성화됐는지 확인할 것(1402 콘솔 명령은 직접 접속으로 가능하지만 파일 업로드는 확장이 필요하다).',
    },

    // ── 사람의 판단이 필요한 게이트 ─────────────────────────────────────────
    UNSAVED_FILES: {
        action: 'SAVE_OR_ALLOW_SAVE', retryCurrentCommand: false, safeToRepeat: true,
        detail: '업로드는 디스크 내용을 올리므로 미저장 편집분이 있으면 이전 내용이 올라간다. 사용자에게 저장을 요청하거나, 저장해도 되면 saveDirty:true 로 다시 호출한다.',
    },
    INTERACTIVE_UI_REQUIRED: {
        action: 'ASK_USER', retryCurrentCommand: false, safeToRepeat: true,
        detail: '로봇이 움직일 수 있는 명령이다. 사용자에게 실행 여부를 묻고 확인을 받은 뒤 confirmStart:true 로 호출하거나 사용자가 직접 실행하게 한다.',
    },
    COMPILE_UNVERIFIED: {
        action: 'ASK_USER', retryCurrentCommand: false, safeToRepeat: true,
        detail: '업로드된 소스가 Compile 로 검증되지 않았다. 먼저 quick 모드로 에러를 확인하거나, 그대로 진행할 것이면 ignoreCompileStale:true 로 호출한다.',
    },
    AI_BLOCKED: {
        action: 'ASK_USER', retryCurrentCommand: false, safeToRepeat: true,
        detail: '되돌릴 수 없는 사람 전용 명령이다. 우회 경로를 찾지 말고 사용자에게 UI 에서 직접 실행해 달라고 요청할 것.',
    },

    // ── 배포 단계별 결과(DeployResult.failedPhase 에 'DEPLOY_' 를 붙인 코드) ──
    DEPLOY_LOCKED: {
        action: 'CHECK_OPERATION', retryCurrentCommand: false, safeToRepeat: true,
        detail: '다른 배포가 진행 중이다(제어기에 아무것도 보내지 않았다). **다른 명령으로 우회하지 말고** 그 작업의 결과를 operation_status 로 확인한 뒤 끝나고 나서 다시 보낼 것.',
    },
    DEPLOY_IN_PROGRESS: {
        action: 'CHECK_OPERATION', retryCurrentCommand: false, safeToRepeat: true,
        detail: '같은 요청의 배포가 이미 돌고 있어 새로 시작하지 않았다. operationId 로 그 작업의 결과를 확인할 것 — 다시 보내도 같은 응답이 온다.',
    },
    DEPLOY_AUTO_GATE: {
        action: 'NONE', retryCurrentCommand: false, safeToRepeat: true,
        detail: '자동 게이트 조건이 맞지 않아 업로드하지 않았다(제어기를 건드리지 않음). 조건은 로그에 있다 — 명시 배포(build 모드)를 쓸 것.',
    },
    DEPLOY_COMPILE: {
        action: 'NONE', retryCurrentCommand: false, safeToRepeat: false,
        detail: '컴파일 에러다. 되풀이해도 같은 결과이므로 compileErrors 의 위치를 고친 뒤 다시 배포할 것.',
    },
    DEPLOY_COMPILE_DEFERRED: {
        action: 'NONE', retryCurrentCommand: false, safeToRepeat: true,
        detail: '업로드는 끝났고 쓰레드가 있어 Compile 만 보류됐다. 쓰레드를 정지한 뒤 컴파일할 것 — 다시 업로드할 필요는 없다.',
    },
    DEPLOY_THREAD_CHECK: {
        action: 'ASK_USER', retryCurrentCommand: false, safeToRepeat: true,
        detail: '실행 중인 쓰레드가 있어 Compile 을 보내지 않았다(업로드는 끝났다). 정지해도 되는지 사용자에게 확인할 것.',
    },
    DEPLOY_UPLOAD: {
        action: 'RETRY_SAME_REQUEST', retryCurrentCommand: true, safeToRepeat: true,
        detail: '업로드 단계에서 중단됐다. 원인(FTP 연결·경로)을 확인한 뒤 같은 요청을 다시 보내도 된다.',
    },
    DEPLOY_STOP: {
        action: 'CHECK_OPERATION', retryCurrentCommand: false, safeToRepeat: false,
        detail: '정지 단계에서 중단됐다. 쓰레드 상태를 관측한 뒤 판단할 것 — 정지 명령은 진행 중일 수 있다(-752 는 비치명).',
    },
    DEPLOY_START: {
        action: 'CHECK_OPERATION', retryCurrentCommand: false, safeToRepeat: false,
        detail: 'Start 단계에서 중단됐다. **다시 Start 하지 말고** 쓰레드 상태를 먼저 관측할 것(이미 실행됐을 수 있다).',
    },
    DEPLOY_ERROR_CHECK: {
        action: 'CHECK_OPERATION', retryCurrentCommand: false, safeToRepeat: true,
        detail: '배포는 진행됐고 에러 로그 확인 단계에서 중단됐다. ErrorLog 를 직접 조회해 판단할 것.',
    },

    // ── 브리지/작업 ─────────────────────────────────────────────────────────
    BRIDGE_REQUEST_TIMEOUT: {
        action: 'CHECK_OPERATION', retryCurrentCommand: false, safeToRepeat: false,
        detail: '응답 대기가 끊겼을 뿐이고 작업은 진행 중일 수 있다. **같은 배포를 다시 보내지 말고** operation_status 로 결과를 확인할 것.',
    },
    OPERATION_UNKNOWN: {
        action: 'CHECK_OPERATION', retryCurrentCommand: false, safeToRepeat: false,
        detail: '결과 미확정이다(실패가 아니다). 제어기 상태를 관측하고 사용자에게 창 상태를 확인할 것 — 자동 재실행 금지.',
    },
};

const DEFAULT_HINT: RecoveryHint = {
    action: 'CHECK_OPERATION',
    retryCurrentCommand: false,
    safeToRepeat: false,
    detail: '분류되지 않은 오류다. 되풀이하기 전에 제어기·작업 상태를 관측하고, 필요하면 사용자에게 확인할 것.',
};

/** 코드에 대응하는 복구 지시. 모르는 코드는 보수적인 기본값(재시도 금지). */
export function recoveryFor(code: string | undefined): RecoveryHint {
    if (!code) { return DEFAULT_HINT; }
    return TABLE[code] ?? DEFAULT_HINT;
}

/** 배포 단계 → 오류 코드. `failedPhase` 를 그대로 코드 이름으로 쓴다(표를 두 벌 유지하지 않기 위해). */
export function deployPhaseCode(failedPhase: string | undefined): string | undefined {
    return failedPhase ? `DEPLOY_${failedPhase}` : undefined;
}

/** 이 코드가 표에 등록돼 있는가(테스트·문서화용). */
export function hasRecovery(code: string): boolean {
    return Object.prototype.hasOwnProperty.call(TABLE, code);
}

/** 등록된 코드 전체(문서·테스트에서 누락을 잡기 위해). */
export function recoveryCodes(): string[] {
    return Object.keys(TABLE).sort();
}
