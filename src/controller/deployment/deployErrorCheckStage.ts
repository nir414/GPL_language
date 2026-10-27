/**
 * 배포 단계 6 — Phase ERROR CHECK: Start 뒤 메인 쓰레드 감시(§1-EU, postStartWatch.ts), `ErrorLog` 스냅샷, 성공 판정
 * (`result.success = compiled`)과 마지막 요약 줄. 2026-10-27 `deployService.ts` 의 `deployLocked` 에서 분리.
 */

import { parseErrorLog } from '../protocol/responseParser';
import { watchMainThreadAfterStart } from '../threads/postStartWatch';
import type { DeployContext } from './deployContext';
import { doneLabelFor } from './deployModes';

/** Start 뒤 감시 창(ms) — skipStart 면 0, 아니면 옵션(음수는 0). */
export function postStartWatchWindowMs(options: { skipStart?: boolean; postStartWatchMs?: number }): number {
    return options.skipStart ? 0 : Math.max(0, options.postStartWatchMs ?? 0);
}

/** 마지막 요약 줄(`✔ Deploy complete: …`) — runtimeError 가 있으면 단서를 덧붙인다. */
export function finalSummaryLine(input: { success: boolean; doneLabel: string; projectName: string; runtimeError: boolean }): string {
    return `${input.success ? '✔' : '✘'} ${input.doneLabel} ${input.success ? 'complete' : 'failed'}: ${input.projectName}`
        + (input.runtimeError ? ' — 단, Start 뒤 메인 쓰레드가 Error 로 멈춤(runtimeError)' : '');
}

/** Phase ERROR CHECK 전체. 끝나면 `ctx.result` 가 최종 상태다(취소도 포함). */
export async function runErrorCheckPhase(ctx: DeployContext): Promise<void> {
    const { options, cfg, lock, result, pushTrace, isCancelled, cancelResult, io } = ctx;

    pushTrace('');
    ctx.phase++;
    pushTrace(`━━ [${ctx.phase}/${ctx.totalPhases}] ERROR CHECK ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    lock.setStage('ERROR_CHECK');

    // Start 뒤 메인 쓰레드 감시(§1-EU) — 종전에는 아래 ErrorLog 스냅샷만 봐서, 기동 수 초 뒤 -1509 로 멈춘 프로그램이
    // success:true 로 기록됐다(2026-10-19 Sample Prep). 읽기 전용 Show Thread 폴링이라 모션에 영향 없음.
    const watchMs = postStartWatchWindowMs(options);
    if (watchMs > 0) {
        pushTrace(`│ Start 뒤 메인 쓰레드 감시 ${watchMs}ms (읽기 전용 Show Thread)`);
        const watch = await watchMainThreadAfterStart(ctx.threadStopIo, result.projectName, { windowMs: watchMs, logPrefix: '│ ' });
        if (watch.kind === 'cancelled' || isCancelled()) { cancelResult('Start 뒤 감시 중'); return; }
        result.postStartWatch = { outcome: watch.kind, elapsedMs: watch.elapsedMs };
        if (watch.kind === 'error') {
            result.runtimeError = watch.error;
            if (watch.error.hint) { pushTrace(`│   힌트: ${watch.error.hint}`); }
        }
    }

    if (isCancelled()) { cancelResult('ErrorLog 확인 전'); return; }
    const errorLogResp = await io.trySendCommand('ErrorLog', cfg);
    if (isCancelled()) { cancelResult('ErrorLog 확인 후'); return; }
    if (errorLogResp) {
        pushTrace(`│ RAW ${ctx.rawPreview(errorLogResp) || '(empty)'}`);
        result.errorLog = parseErrorLog(errorLogResp);
        if (result.errorLog.length === 0) {
            // Start 직후의 스냅숏이다 — 기동 수 초 뒤에 나는 런타임 에러(예: -200 No memory available, 2026-09-18 실측
            // Start 후 5초)는 여기 잡히지 않고 1403 런타임 콘솔/디버그 이벤트([Debug Error])가 알린다.
            // "에러 없음"으로 읽히지 않게 시점을 문장에 넣는다.
            pushTrace('│ ✔ ErrorLog empty (snapshot right after Start — later runtime errors arrive via GPL Console / debug events)');
        } else {
            // 과거 누적 항목이 섞일 수 있으므로 "에러 N개" 단정 대신 ErrorLog 항목 수로 표기.
            pushTrace(`│ ⚠ ErrorLog ${result.errorLog.length}건:`);
            for (const el of result.errorLog) {
                pushTrace(`│   ${el}`);
            }
        }
    } else {
        pushTrace('│ ⚠ ErrorLog read failed (non-fatal)');
    }

    result.success = ctx.compiled;

    const doneLabel = doneLabelFor(options);
    pushTrace('');
    pushTrace('══════════════════════════════════════════════════════');
    pushTrace(finalSummaryLine({ success: result.success, doneLabel, projectName: result.projectName, runtimeError: !!result.runtimeError }));
    pushTrace('══════════════════════════════════════════════════════');
}
