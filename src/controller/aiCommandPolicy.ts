/**
 * AI/자동화 경로에서 실행할 수 없는 확장 명령 목록 (vscode 무의존 — 단위 테스트: src/test/aiCommandPolicy.test.ts).
 *
 * 배경 — 이것은 `commandPolicy.ts` 와 성격이 다르다:
 *  - `commandPolicy.ts`(2026-08-28): 제어기 사고를 막는 **타이밍 조건**을 확장이 대신 기다려서 충족시킨다. 접근을 막지 않는다.
 *  - 이 파일(2026-09-07 사용자 결정): 되돌릴 수 없는 **파괴적 부작용**이 있어 사람의 의사 결정이 필요한 명령만
 *    AI 경로에서 거부한다. 기다린다고 안전해지는 종류가 아니라 "해도 되는가"의 판단이 필요한 종류다.
 *
 * 범위 — AI/자동화 진입점에서만 막고, 사람의 UI 경로(명령 팔레트·트리/탐색기 컨텍스트 메뉴)는 그대로 둔다:
 *  1. Agent Bridge(`agentBridge.ts`)      — MCP `extension_command` 를 포함한 모든 브리지 클라이언트
 *  2. URI 핸들러(`activation/uriHandler.ts`) — `vscode://…/<command id>` (터미널/에이전트 진입점)
 *  3. 명령 자체의 자동화 분기            — `isAutomationInvocation(args)` 로 들어온 직접 호출
 *  4. MCP 서버(`controller-mcp/src/aiPolicy.js`) — 왕복 없이 먼저 거부(같은 목록을 미러링)
 *
 * 목록에 항목을 추가하면 위 네 곳이 모두 자동으로 따른다. MCP 서버 쪽 미러 목록도 함께 갱신할 것.
 */

/** AI 경로에서 거부되는 명령 1건. */
export interface AiBlockedCommand {
    /** 확장 명령 ID (`gpl.*`). */
    command: string;
    /** 사람이 보는 명령 제목(package.json 의 title). */
    title: string;
    /** 왜 AI 가 실행하면 안 되는가 — 응답에 그대로 실려 호출자가 이유를 알 수 있게 한다. */
    reason: string;
    /** 사람이 실행하려면 어디서 하는가. */
    humanPath: string;
}

/**
 * AI 가 실행할 수 없는 확장 명령.
 *
 * `gpl.saveToFlash` — 제어기 flash 의 영구 사본(`/flash/projects/<project>`)을 **미러 동기화**로 덮어쓴다.
 * 로컬에 없는 원격 파일을 지우므로 되돌릴 수 없고, flash 는 쓰기 수명이 유한하다. 테스트용 배포는 `/GPL`
 * 직접 업로드(`gpl.deploy`·`gpl.quickCompile`)로 충분하므로 AI 가 flash 를 건드릴 이유가 없다.
 */
export const AI_BLOCKED_COMMANDS: readonly AiBlockedCommand[] = Object.freeze([
    Object.freeze({
        command: 'gpl.saveToFlash',
        title: 'GPL: Save to Flash (/flash/projects 에 영구 저장)',
        reason: '제어기 flash 의 영구 사본(/flash/projects/<project>)을 미러 동기화로 덮어쓰고 로컬에 없는 원격 파일을 삭제한다 — '
            + '되돌릴 수 없고 flash 쓰기 수명을 소모하므로 사람이 판단해 실행할 명령이다.',
        humanPath: '사용자가 명령 팔레트의 "GPL: Save to Flash" 또는 탐색기/제어기 트리 컨텍스트 메뉴에서 직접 실행합니다.',
    }),
]);

/** 자동화 결과·브리지 응답에 쓰는 오류 코드. */
export const AI_BLOCKED_ERROR = 'AI_BLOCKED';

/** 명령 ID 가 AI 차단 목록에 있으면 그 항목을 돌려준다(대소문자 무시 — 명령 ID 는 대소문자를 구분하지만 오탈자 우회를 막는다). */
export function findAiBlockedCommand(command: string): AiBlockedCommand | undefined {
    const key = String(command ?? '').trim().toLowerCase();
    if (!key) { return undefined; }
    return AI_BLOCKED_COMMANDS.find(c => c.command.toLowerCase() === key);
}

/** 호출자(AI)에게 돌려줄 거부 사유 한 문단 — 왜 막혔는지와 사람이 할 방법을 함께 준다. */
export function aiBlockedDetail(entry: AiBlockedCommand): string {
    return `'${entry.command}'(${entry.title})는 AI/자동화 경로에서 실행할 수 없습니다. ${entry.reason} `
        + `${entry.humanPath} 대신 필요하면 사용자에게 실행을 요청하세요.`;
}

/** 명령이 차단 대상이면 사유 문자열을, 아니면 undefined 를 돌려주는 단축 함수. */
export function aiBlockReasonFor(command: string): string | undefined {
    const entry = findAiBlockedCommand(command);
    return entry ? aiBlockedDetail(entry) : undefined;
}
