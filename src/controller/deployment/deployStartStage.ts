/**
 * 배포 단계 5 — Phase START(skipStart 가 아닐 때만): Start 직전 정지 재확인(§0.6, 읽기 전용 `Show Thread`), 런타임 콘솔 준비 훅,
 * 모션 확인 모달(B2 §3-B — 사람 경로), `Start <project> -compile …`(startCommand 가 조립, §1-DN) 전송과 `-compile` 응답의
 * 컴파일 에러 보고, skipCompile 경로의 컴파일 스냅샷 기록. 2026-10-27 `deployService.ts` 의 `deployLocked` 에서 분리.
 * Deploy 는 Compile 에서 끝나고 실행은 별도 명령이 담당한다(CLAUDE.md 하드 규칙 7) — 이 단계는 호출측이 명시적으로
 * Start 를 요청한 경로(Deploy & Run·Upload & Start·F5)에서만 돈다.
 */

import { startProject } from '../commands/projectCommands';
import { shouldPromptForStartConfirmation } from '../commands/startCommand';
import { waitThreadsSettle } from '../threads/threadStop';
import type { SettleOutcome } from '../threads/threadStop';
import type { DeployContext } from './deployContext';
import { recordCompileSnapshot, reportCompileErrors } from './deployCompileStage';

/**
 * Phase START 전체. true 면 ERROR CHECK 로, false 면 `ctx.result` 가 확정된 상태. skipStart 면 아무것도 하지 않고 true.
 */
export async function runStartPhase(ctx: DeployContext): Promise<boolean> {
    const { options, lock, result, pushTrace, isCancelled, cancelResult, host, projectIo } = ctx;
    if (options.skipStart) { return true; }

    pushTrace('');
    ctx.phase++;
    pushTrace(`━━ [${ctx.phase}/${ctx.totalPhases}] START ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    lock.setStage('START');

    if (isCancelled()) { cancelResult('START 시작 전'); return false; }

    // Start 직전 정지 재확인(§0.6) — 정지 게이트를 통과한 뒤에도 업로드·원격 파일 삭제·Compile로
    // 수십 초가 지났고, -752(정지 진행 중) 뒤 제어기 내부 정리가 남아 있을 수 있다. 활성 쓰레드가
    // 남은 채 Start(=`-compile` 컴파일 포함)를 보내지 않기 위한 게이트다. 비용은 읽기 전용
    // `Show Thread` 한 번(정지돼 있으면 즉시 통과)이라 §1-DL에서 병행 복귀 후에도 남겨 두었다.
    // 무응답은 확인 불가로 보고 통과시킨다(waitThreadsSettle 규약과 동일).
    const preStartSettle: SettleOutcome = await waitThreadsSettle(ctx.threadStopIo, ctx.threadStopOpts);
    if (preStartSettle.cancelled || isCancelled()) { cancelResult('Start 직전 정지 확인'); return false; }
    if (!preStartSettle.settled) {
        pushTrace(`│ ✘ Start 직전 확인에서 활성 쓰레드 발견: ${preStartSettle.activeDesc}`);
        pushTrace('│   → 정지되지 않은 상태로 Start를 보내지 않고 중단합니다. 프로그램을 STOP한 뒤 다시 실행하세요.');
        result.failedPhase = 'START';
        result.failedCommand = 'Show Thread (pre-Start settle gate)';
        result.failedStatusMessage = `Start 직전에도 활성 쓰레드 존재: ${preStartSettle.activeDesc}`;
        return false;
    }

    if (options.beforeStart) {
        pushTrace('│ Preparing runtime console before Start');
        try {
            await options.beforeStart();
            pushTrace('│ ✔ Runtime console ready for Start');
        } catch (err: any) {
            pushTrace(`│ ⚠ Runtime console pre-start failed: ${err?.message ?? err}`);
        }
    }
    if (isCancelled()) { cancelResult('Start 준비 후'); return false; }

    // B2(§3-B): 자동 Start 확인 게이트 — Start는 로봇 모션을 유발할 수 있다(§0.6).
    const requireStartConfirm = host.readRequireStartConfirmation();
    if (shouldPromptForStartConfirmation(requireStartConfirm, options.startConfirmed === true)) {
        const picked = await host.confirmStart(result.projectName);
        if (isCancelled()) { cancelResult('Start 확인 대기 중'); return false; }
        if (!picked) {
            pushTrace('│ ✘ 사용자가 Start를 취소했습니다 (gpl.controller.requireStartConfirmation)');
            result.failedPhase = 'START';
            // 아직 보내지 않았으므로 조립된 명령이 없다 — 무엇을 취소했는지만 남긴다.
            result.failedCommand = `Start ${result.projectName}`;
            result.failedStatusMessage = '사용자가 Start 실행을 취소했습니다';
            return false;
        }
    }
    // 명령 조립(문서 구문·`-event`)과 STATUS 판정은 projectCommands.startProject 가 한다(§1-DE).
    // `-compile` 은 startCommand 기본값으로 항상 붙는다(§1-DN — 없으면 옛 바이너리가 실행된다).
    const start = await startProject(projectIo, {
        projectName: result.projectName,
        eventMode: options.startEventMode,
    });
    if (isCancelled()) { cancelResult(`Start ${result.projectName} 응답 후`); return false; }
    if (start.errors.length > 0) {
        // Upload & Start는 별도 Compile을 생략한다. `Start -compile` 응답이 컴파일 결과의 유일한
        // 출처이므로 Compile 경로와 같은 진단·원문·클릭 가능한 위치를 남긴다.
        result.compileErrors = start.errors;
        result.compileAttemptLogs.push({
            command: start.command,
            statusCode: start.statusCode,
            raw: start.raw,
            errors: start.errors,
            responseMeta: start.responseMeta,
            note: 'Start -compile 응답에서 파싱한 컴파일 결과',
        });
        reportCompileErrors(ctx, start.errors);
    }
    if (start.ok) {
        // 성공한 Start -compile은 현재 소스의 컴파일 성공 근거다. 이전 gpl-deploy 진단을 지운다.
        host.clearDiagnostics();
        if (options.skipCompile) {
            // Start가 STATUS 0으로 끝났다 = 제어기가 방금 올린 소스를 `-compile` 로 컴파일해 실행 중이다(§0.7).
            // 그때서야 "이 소스가 제어기에서 돌고 있다"가 사실이 되므로 여기서 스냅샷을 기록한다.
            recordCompileSnapshot(ctx);
        }
    } else {
        result.failedPhase = 'START';
        result.failedCommand = start.command;
        result.failedStatusCode = start.statusCode;
        result.failedStatusMessage = start.message || 'Unknown error';
        return false;
    }
    return true;
}
