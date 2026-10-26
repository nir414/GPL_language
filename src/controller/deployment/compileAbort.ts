/**
 * Compile 이 소켓 리셋으로 끊긴 경우의 분류 — vscode 무의존 순수 모듈.
 *
 * 배경(2026-10-22 22:01 KST 「Compile 중 ECONNRESET → 제어기 명령 콘솔 사망」):
 *  - `deploy_project(build)` 가 Compile 단계에서 22 s 뒤 ECONNRESET 으로 끝났고 pass 줄이 한 줄도 오지 않았다.
 *    결과는 `FAILED · compileErrors 0 · inSync` 라 성공·일반 컴파일 실패와 구분이 어려웠고, 그 뒤 명령 콘솔이 영구히
 *    응답하지 않았는데 "제어기 죽었어?" 는 사용자가 물어야 알 수 있었다.
 *  - 작업 기록·MCP 세션 로그에는 Compile 이 언제 나가서 몇 ms 뒤 끊겼는지가 없었다(`1402 0회`).
 *
 * 그래서 컴파일 에러(STATUS 와 에러 라인이 있는 확정 실패)와 **연결이 끊겨 결과를 모르는 Compile** 을 가른다.
 * 후자는 `compileAborted` 로 따로 싣고, 호출부가 짧은 생존 확인(`Show Thread -web`) 한 번으로 `controllerHealth` 를 채운다.
 * 판정은 관측만 한다 — "컴파일러가 제어기를 죽였다" 는 인과는 확정하지 않는다.
 */

import { classifyCommandFailure } from '../connection/connectionHealth';
import type { ProbeOutcome } from '../connection/connectionHealth';
import type { CompileAttempt } from '../commands/projectCommands';
import { NO_STATUS_CODE } from '../protocol/responseParser';

/** 사람이 읽는 안내(결과·트레이스·MCP 응답 공용). */
export const COMPILE_ABORT_HINT = '제어기가 컴파일 중 연결을 끊음 — 명령 콘솔 생존 확인 필요';

/** 생존 확인 명령의 짧은 타임아웃(ms). */
export const COMPILE_ABORT_PROBE_TIMEOUT_MS = 5000;

export interface CompileAborted {
    /** 끊긴 방식(`ECONNRESET` / `EPIPE` / `ECONNABORTED` / `ECONNCLOSED`). */
    reason: string;
    /** 보낸 Compile 명령 원문. */
    command: string;
    /** 전송부터 끊김까지(ms). 측정하지 못했으면 0. */
    elapsedMs: number;
    /** 끊기기 전까지 받은 제어기 출력 줄 수 — 0 이면 컴파일 출력이 하나도 오지 않은 것이다. */
    outputLines: number;
    hint: string;
}

export interface ControllerLiveness {
    state: 'responsive' | 'unresponsive';
    /** 보낸 확인 명령. */
    probe: string;
    detail: string;
    checkedAt: string;
}

const RESET_TOKEN_RE = /\b(ECONNRESET|EPIPE|ECONNABORTED|ECONNCLOSED)\b/;

function countLines(raw: string): number {
    return String(raw ?? '').split(/\r?\n/).filter(l => l.trim().length > 0).length;
}

/**
 * Compile 시도 → 소켓 리셋/종료로 끊긴 것이면 CompileAborted, 아니면 undefined.
 * - 응답 없이 전송이 실패(transportError)했고 그 종류가 reset/closed(또는 ECONNABORTED)면 끊김 — 출력 0줄.
 * - 응답 일부를 받았지만 `</STATUS>` 없이 소켓이 닫혔고(meta.responseComplete=false) 에러 라인도 없으면 끊김.
 * 타임아웃(우리 타이머)·연결 거부(보내지도 못함)·STATUS 가 있는 실패는 끊김이 아니다.
 */
export function classifyCompileAbort(attempt: Pick<CompileAttempt, 'command' | 'ok' | 'raw' | 'errors' | 'meta' | 'elapsedMs' | 'transportError'>): CompileAborted | undefined {
    if (attempt.ok || attempt.errors.length > 0) { return undefined; }
    const elapsedMs = Math.max(0, attempt.elapsedMs ?? attempt.meta?.durationMs ?? 0);
    if (attempt.transportError) {
        const { kind } = classifyCommandFailure(attempt.transportError);
        const token = RESET_TOKEN_RE.exec(`${attempt.transportError.code ?? ''} ${attempt.transportError.message}`)?.[1];
        if (kind !== 'reset' && kind !== 'closed' && !token) { return undefined; }
        return { reason: token ?? (kind === 'closed' ? 'ECONNCLOSED' : 'ECONNRESET'), command: attempt.command, elapsedMs, outputLines: 0, hint: COMPILE_ABORT_HINT };
    }
    const meta = attempt.meta;
    if (meta && meta.responseComplete === false && !meta.statusTagReceived && !/<\/STATUS>/i.test(attempt.raw)) {
        return { reason: 'ECONNCLOSED', command: attempt.command, elapsedMs, outputLines: countLines(attempt.raw), hint: COMPILE_ABORT_HINT };
    }
    return undefined;
}

/** 생존 확인 결과 → controllerHealth. STATUS 가 왔으면 응답함(코드와 무관), 아니면 무응답. */
export function livenessFromProbe(outcome: ProbeOutcome, probe: string, at: number): ControllerLiveness {
    return outcome.ok
        ? { state: 'responsive', probe, detail: '명령 콘솔이 STATUS 로 응답함', checkedAt: new Date(at).toISOString() }
        : { state: 'unresponsive', probe, detail: `${outcome.kind}${outcome.detail ? ` — ${outcome.detail}` : ''}`, checkedAt: new Date(at).toISOString() };
}

/** 작업 기록·세션 로그용 Compile 한 줄 요약. */
export interface CompileCommandSummary {
    command: string;
    statusCode: number;
    elapsedMs?: number;
    /** `STATUS 0` / `STATUS -742` / `ABORTED ECONNRESET` / `NO STATUS`. */
    outcome: string;
}

/** CompileAttempt(또는 그 기록) → 요약. `aborted` 를 주면 그 시도는 ABORTED 로 적는다. */
export function summarizeCompileCommand(
    a: { command: string; statusCode: number; elapsedMs?: number },
    aborted?: CompileAborted,
): CompileCommandSummary {
    const outcome = aborted && aborted.command === a.command && a.statusCode === NO_STATUS_CODE
        ? `ABORTED ${aborted.reason}`
        : a.statusCode === NO_STATUS_CODE ? 'NO STATUS' : `STATUS ${a.statusCode}`;
    return { command: a.command, statusCode: a.statusCode, ...(a.elapsedMs !== undefined ? { elapsedMs: a.elapsedMs } : {}), outcome };
}
