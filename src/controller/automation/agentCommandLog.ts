/**
 * AI(Agent Bridge·MCP·URI) 경유 제어기 명령을 **사용자가 Output 에서 보게 하는 표현 규칙** — 순수 모듈(vscode 무의존).
 *
 * 왜(2026-10-14, 사용자 지적): 사용자가 손으로 보낸 명령·배포는 Output 「GPL Language Support」에 명령과 응답이
 * 찍히고 패널이 열렸지만, AI 가 브리지로 보낸 1402 명령은 `[Command] >>> … (agent)` 한 줄만 남고 응답은
 * GPL Traffic 채널에만 있었다. 그래서 "AI 가 제어기에 무엇을 했는지" 가 보이지 않았다.
 *
 * 규칙 두 가지:
 *  1. `formatAgentCommandLines` — 명령 한 줄(요약: STATUS·소요 시간)과 응답 본문(상한 초과분은 생략 요약 한 줄).
 *     본문 상한은 GPL Traffic 과 같은 설정(`gpl.controller.trafficLogMaxResponseChars`)을 쓴다 — 상한을 두 군데서 따로 정하지 않는다.
 *  2. `createRevealGate` — AI 요청이 **조용한 뒤 처음** 올 때만 패널을 열자는 판단. 요청마다 열면 사용자가 다른 채널
 *     (GPL Console 등)로 옮겨 가 있어도 AI 의 폴링마다 되돌려 놓아 방해가 된다.
 */

/** 이 시간 이상 AI 요청이 없다가 다시 오면 "새 작업 시작"으로 보고 Output 을 연다. */
export const AGENT_OUTPUT_REVEAL_QUIET_MS = 30_000;

export interface AgentCommandOutcome {
    command: string;
    /** 제어기 원문 응답(STATUS 블록 포함). */
    raw: string;
    statusCode: number;
    durationMs?: number;
}

export interface AgentCommandLogOptions {
    /** 응답 본문 상한(문자 수). 0 이면 무제한. */
    maxChars: number;
}

/** 명령 요약 한 줄 — Output 의 `[Command]` 줄 형식을 사람 경로(`[Command] >>> cmd`)와 맞추되 AI 경로임을 표시한다. */
export function formatAgentCommandSummary(o: Pick<AgentCommandOutcome, 'command' | 'statusCode' | 'durationMs'>): string {
    const ms = typeof o.durationMs === 'number' && Number.isFinite(o.durationMs) ? ` · ${Math.round(o.durationMs)} ms` : '';
    return `[Command] >>> ${o.command} (agent) → STATUS ${o.statusCode}${ms}`;
}

/**
 * Output 에 찍을 줄 전체: 요약 한 줄 + 응답 본문. 본문은 빈 줄을 빼고 상한까지만 싣고, 넘치면
 * `… (N자 생략 — 전체는 GPL Traffic)` 한 줄로 알린다. 빈 응답이면 요약 한 줄뿐이다.
 */
export function formatAgentCommandLines(o: AgentCommandOutcome, opts: AgentCommandLogOptions): string[] {
    const out = [formatAgentCommandSummary(o)];
    const body = String(o.raw ?? '').split(/\r?\n/).map(l => l.replace(/\s+$/, '')).filter(l => l.length > 0);
    if (body.length === 0) { return out; }
    const limit = opts.maxChars > 0 ? opts.maxChars : Infinity;
    let used = 0;
    let shown = 0;
    for (const line of body) {
        if (used + line.length > limit) { break; }
        out.push(`    ${line}`);
        used += line.length;
        shown++;
    }
    if (shown < body.length) {
        const omitted = body.slice(shown).reduce((n, l) => n + l.length, 0);
        out.push(`    … (${body.length - shown}줄 ${omitted}자 생략 — 전체는 GPL Traffic)`);
    }
    return out;
}

/** 실패(정책 보류·전송 실패)도 같은 자리에 남긴다 — 사용자가 "AI 가 보냈는데 왜 아무 일도 없지" 를 Output 에서 알 수 있게. */
export function formatAgentCommandFailure(command: string, kind: 'policy-hold' | 'command-failed', detail: string): string {
    const label = kind === 'policy-hold' ? '정책 보류(제어기에 보내지 않음)' : '전송 실패';
    return `[Command] >>> ${command} (agent) → ${label}: ${detail}`;
}

/**
 * "지금 Output 을 열어야 하는가" — 직전 AI 요청으로부터 `quietMs` 이상 지났으면 true.
 * 상태는 클로저에 두고 호출할 때마다 마지막 요청 시각을 갱신한다.
 */
export function createRevealGate(quietMs: number = AGENT_OUTPUT_REVEAL_QUIET_MS): (now: number) => boolean {
    let lastAt = Number.NEGATIVE_INFINITY;
    return (now: number) => {
        const due = now - lastAt >= quietMs;
        lastAt = now;
        return due;
    };
}
