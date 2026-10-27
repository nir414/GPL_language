/**
 * 배포 단계 3(업로드와 병행) — 정지 게이트(§0.6): Compile 전에 반드시 통과해야 한다.
 * - 전체 Deploy(!skipStop): `Stop -all` + 정지 완료 확인(재시도 포함, threadStop.ts 가 정본).
 * - 빠른 컴파일(skipStop): `Show Thread` 프로브 → autoGate 면 쓰레드 0개일 때만 통과(아니면 COMPILE_DEFERRED),
 *   수동 경로는 활성 쓰레드 시 사용자에게 Stop 여부 확인(거부 → THREAD_CHECK).
 * - Upload Only: 생략.
 * 정지 실패 시 "왜 안 멈추는지" 읽기 전용 진단(threadStuckDiagnosis.ts)을 트레이스에 남긴다.
 * 2026-10-27 `deployService.ts` 의 `deployLocked` 에서 분리. 전송·로그·대기는 `ctx.threadStopIo` 로 주입된다.
 */

import type { ThreadInfo } from '../protocol/responseParser';
import { describeThreadActivity, isSettledState } from '../threads/threadActivity';
import { createFileSourceLookup, diagnoseStuckThread } from '../threads/threadStuckDiagnosis';
import { STOP_ALL_CMD, probeThreads, stopAllAndSettle as runStopAllAndSettle } from '../threads/threadStop';
import type { ThreadProbe } from '../threads/threadStop';
import type { DeployContext } from './deployContext';

/** autoOnSave 게이트 ② 보류 사유 — 활성 쓰레드가 있으면 이름(상태) 나열, 정지 상태만 있으면 개수. 비어 있으면 undefined(통과). */
export function describeAutoGateDeferral(probe: ThreadProbe): string | undefined {
    if (probe.total <= 0) { return undefined; }
    return probe.active.length > 0
        ? `활성 쓰레드 ${probe.active.map(t => `${t.name}(${t.state})`).join(', ')}`
        : `정지 상태 쓰레드 ${probe.total}개 존재`;
}

/**
 * 현재 쓰레드 목록(read-only). null 은 "확인 불가"이며 빈 목록과 구분해야 한다.
 * 활성 판정 자체는 **쓰레드의 존재**로 하는 곳(autoOnSave 게이트)이 있어 total 까지 그대로 쓴다
 * (사용자 규약 2026-08-28: `Execute` 는 `_Cmd_<project>` 라는 별도 쓰레드를 만든다 — threadActivity.ts).
 */
export function probeActiveThreads(ctx: DeployContext): Promise<ThreadProbe | null> {
    return probeThreads(ctx.threadStopIo);
}

/**
 * 정지 게이트가 실패했을 때 "왜 안 멈추는지"를 읽기 전용으로 캐서 트레이스에 남긴다(§3, 2026-09-10).
 * 실패 한 줄만 남기면 사용자가 매번 손으로 `Show Thread` → 소스 열기 → 호출 대상 찾기를 반복해야 한다.
 * 복구 명령은 **만들어 보여 주기만** 하고 보내지 않는다 — 대상 식별이 정적 분석이라 확인이 필요하다.
 */
export async function traceStuckDiagnosis(ctx: DeployContext, threads: ThreadInfo[] | undefined): Promise<void> {
    const active = (threads ?? []).filter(t => !isSettledState(t.state));
    if (active.length === 0) { return; }
    const lookup = createFileSourceLookup([ctx.options.projectDir]);
    // 여러 개가 걸려 있어도 두 개까지만 — 진단마다 샘플링 시간이 든다.
    for (const t of active.slice(0, 2)) {
        try {
            await diagnoseStuckThread(ctx.threadStopIo, t.name, lookup, { logPrefix: '│ ', sampleCount: 3 });
        } catch (e: any) {
            ctx.pushTrace(`│ ⚠ 정지 불가 진단 실패(무시): ${e?.message ?? e}`);
        }
    }
}

/** Stop -all → 정지 완료 게이트(재시도 포함). 실패 사유는 result 에 옮겨 적는다. true 면 계속 진행 가능. */
export async function stopAllAndSettle(ctx: DeployContext): Promise<boolean> {
    const { result, pushTrace } = ctx;
    const outcome = await runStopAllAndSettle(ctx.threadStopIo, ctx.threadStopOpts);
    if (outcome.ok) { return true; }
    if (outcome.cancelled) { return false; }
    if (outcome.settle && !outcome.settle.settled) {
        pushTrace('│   → 정지 미완료 상태에서 Compile/Start를 보내지 않고 중단합니다.');
        await traceStuckDiagnosis(ctx, outcome.settle.threads);
    }
    result.failedPhase = 'STOP';
    result.failedCommand = outcome.failure?.command ?? STOP_ALL_CMD;
    result.failedStatusCode = outcome.failure?.statusCode;
    result.failedStatusMessage = outcome.failure?.message ?? '정지를 확인하지 못했습니다';
    return false;
}

/**
 * 정지 게이트(§0.6) — Compile 전에 반드시 통과해야 한다. 'proceed'가 아니면 result.failedPhase가 기록된 상태.
 * - !skipStop(전체 Deploy): Stop -all + settle(재시도 포함).
 * - skipStop(빠른 컴파일): Show Thread 프로브 → autoGate면 쓰레드 0개일 때만 통과(아니면 COMPILE_DEFERRED),
 *   수동 경로는 활성 쓰레드 시 사용자에게 Stop 여부 확인(거부 → THREAD_CHECK). 업로드는 병행 중이라 그대로 완료된다.
 */
export async function runStopGate(ctx: DeployContext): Promise<'proceed' | 'abort'> {
    const { options, result, pushTrace } = ctx;
	if (options.uploadOnly) {
		pushTrace('│ ⏭ Stop·Show Thread 생략 — FTP 업로드만 수행');
		return 'proceed';
	}
    if (!options.skipStop) {
        return (await stopAllAndSettle(ctx)) ? 'proceed' : 'abort';
    }
    pushTrace('│ ⏸ STOP 생략(빠른 컴파일) — Show Thread로 쓰레드 상태 확인');
    const probe = await probeActiveThreads(ctx);
    // autoGate 조건 2: Compile은 쓰레드 목록이 완전히 비어 있을 때만(정지 상태 쓰레드도 불허). 확인 불가(무응답)도 미충족.
    if (options.autoGate) {
        if (probe === null) {
            pushTrace('│ [autoOnSave] Compile 보류: Show Thread 무응답(정지 상태 확인 불가)');
            result.failedPhase = 'COMPILE_DEFERRED';
            result.failedCommand = 'AutoGate Show Thread';
            result.failedStatusMessage = '업로드 완료, Compile 보류 — Show Thread 무응답으로 제어기 정지 상태를 확인할 수 없음';
            return 'abort';
        }
        const desc = describeAutoGateDeferral(probe);
        if (desc !== undefined) {
            pushTrace(`│ [autoOnSave] Compile 보류: ${desc} — 쓰레드가 없는 완전 STOP 상태에서 Compile`);
            result.failedPhase = 'COMPILE_DEFERRED';
            result.failedCommand = 'AutoGate Show Thread';
            result.failedStatusMessage = `업로드 완료, Compile 보류 — ${desc}`;
            return 'abort';
        }
        pushTrace('│ ✔ [autoOnSave] 게이트 통과: 쓰레드 없음(완전 STOP 상태)');
        return 'proceed';
    }
    if (probe === null) {
        pushTrace('│ ⚠ Show Thread 무응답 — 쓰레드 상태 확인 불가(계속 진행)');
        return 'proceed';
    }
    if (probe.total === 0) {
        pushTrace('│ ✔ 쓰레드 없음(완전 STOP 상태)');
        return 'proceed';
    }
    // 쓰레드가 남아 있으면 정지 계열 상태여도 동작 중으로 본다(위 주석 — 존재 = 활성).
    const desc = describeThreadActivity(probe.threads);
    pushTrace(`│ ⚠ ${desc}`);
    let stopApproved = false;
    if (options.confirmStopOnActive) {
        pushTrace('│ … 사용자에게 Stop -all 실행 여부 확인 중 (업로드는 병행 진행)');
        try {
            stopApproved = await options.confirmStopOnActive(desc);
        } catch {
            stopApproved = false;
        }
    }
    if (!stopApproved) {
        pushTrace('│ ✘ 중단: 활성 쓰레드 존재 (사용자 미승인 또는 확인 경로 없음) — Compile 미수행');
        pushTrace('│   → 프로그램 STOP 후 Quick Compile을 다시 실행하거나, STOP이 포함된 전체 배포를 사용하세요.');
        result.failedPhase = 'THREAD_CHECK';
        result.failedCommand = 'Show Thread';
        result.failedStatusMessage = `활성 쓰레드 존재: ${desc} — 업로드는 완료됨, Compile은 STOP 후 다시 실행하세요.`;
        return 'abort';
    }
    pushTrace('│ ✔ 사용자 승인 — Stop -all 실행 후 정지 확인');
    return (await stopAllAndSettle(ctx)) ? 'proceed' : 'abort';
}
