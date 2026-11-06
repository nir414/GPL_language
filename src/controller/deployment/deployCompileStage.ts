/**
 * 배포 단계 4 — Phase COMPILE: 후보 이름 결정, 클래식 경로의 Unload/Load 동기화, 정지 뒤 메모리 심각 확인(사람 경로만),
 * `Compile <후보>` 루프(로드 상태 복구 -745/-508/-743, 소켓 리셋 중단 감지), 컴파일 에러의 Problems/Output 보고,
 * 컴파일 스냅샷 기록(GitHub #21). skipCompile(업로드 스타트)에서도 이 단계는 남는다 — 클래식 경로의 Unload/Load 동기화가
 * 여기서 일어나고(Start 하려면 프로젝트가 로드돼 있어야 한다), direct /GPL 모드에서는 안내 한 줄만 남는다.
 * 2026-10-27 `deployService.ts` 의 `deployLocked` 에서 분리. 절차 정본은 `commands/projectCommands.ts`(§1-DE).
 */

import { compileProject, loadProject, unloadProject } from '../commands/projectCommands';
import type { CompileAttempt } from '../commands/projectCommands';
import { isProjectAlreadyLoaded, isProjectNotLoaded } from '../protocol/controllerStatusCodes';
import { parseStatus, isControllerNonBlockingStatus, SHOW_THREAD_LIST_CMD } from '../protocol/responseParser';
import type { CompileError } from '../protocol/responseParser';
import type { MemoryPrecheck } from '../diagnostics/memoryGuard';
import { COMPILE_ABORT_PROBE_TIMEOUT_MS, classifyCompileAbort, livenessFromProbe } from './compileAbort';
import type { CompileAborted } from './compileAbort';
import { snapshotProjectFiles } from './deployRecordCore';
import { resolveErrorFilePath } from './compileErrorPath';
import type { DeployContext } from './deployContext';
import type { DeployProjectInfo } from './deployPrecheck';
import type { DeployTarget } from './deployTargetStage';
import { describePreprocessOptions } from './deployPreprocess';

/** Compile 에 시도할 이름 후보. Direct 모드에서는 /GPL의 실제 폴더명(=로드된 프로젝트명)을 최우선 후보로 사용한다. */
export function compileCandidatesFor(project: DeployProjectInfo, target: DeployTarget): string[] {
    return target.directActive
        ? [...new Set([target.directGplName!, project.projectName].filter(Boolean))]
        : [...new Set([project.projectName, project.gprInfo.projectName, project.folderName].filter(Boolean))];
}

/** raw 텍스트에서 상태 코드 존재를 확인할 때 부분 문자열 오탐(-745가 -7450에 걸림 등)을 막는다. */
export function hasCode(text: string, code: number): boolean {
    return new RegExp(`(^|\\D)${code}\\b`).test(text);
}

/**
 * Compile 실패 한 건의 복구 분기.
 * - `direct-load-state`: Direct 모드에서 로드 상태 이상(-745/-508/-743) — 복구용 Unload/Load 는 목적(락 회피)에 반하므로 하지 않는다.
 * - `reload`: 클래식, -745 already loaded → Unload + Load + Compile.
 * - `load`: 클래식, -508/-743 not loaded → Load + Compile.
 * - `none`: 그 밖(컴파일 에러 등).
 */
export type CompileFailureRecovery = 'direct-load-state' | 'reload' | 'load' | 'none';

export function classifyCompileFailure(cr: { statusCode: number; raw: string }, directActive: boolean): CompileFailureRecovery {
    const errText = cr.raw;
    if (directActive && (isProjectAlreadyLoaded(cr.statusCode) || isProjectNotLoaded(cr.statusCode)
        || hasCode(errText, -745) || hasCode(errText, -508) || hasCode(errText, -743))) {
        return 'direct-load-state';
    }
    if (!directActive && (isProjectAlreadyLoaded(cr.statusCode) || hasCode(errText, -745))) {
        return 'reload';
    }
    if (!directActive && (isProjectNotLoaded(cr.statusCode) || hasCode(errText, -508) || hasCode(errText, -743))) {
        return 'load';
    }
    return 'none';
}

/** 정지 뒤 메모리 심각 경고에서 사용자가 취소했을 때의 결과 문구. */
export function memoryCriticalCancelMessage(check: MemoryPrecheck, label: string): string {
    return `여유 메모리 ${check.freeMb ?? '?'} MB (심각 ${check.criticalMb} MB 미만) — 사용자가 취소했습니다. `
        + `업로드는 완료, ${label} 미전송.`;
}

/** 컴파일 에러를 Problems와 클릭 가능한 Output 줄에 함께 올린다(Compile/Start -compile 공용). */
export function reportCompileErrors(ctx: DeployContext, errors: CompileError[]): void {
    if (errors.length === 0) { return; }
    ctx.host.applyCompileDiagnostics(errors);
    for (const err of errors) {
        // 절대경로 `파일:줄:열` 형식으로 출력하면 출력 패널에서 클릭 시 해당 위치로 이동된다.
        const abs = resolveErrorFilePath(err.file, ctx.options.projectDir);
        ctx.pushTrace(`│   ${abs}:${err.line}:1 (${err.code}) ${err.message}`);
        if (err.hint) { ctx.pushTrace(`│     ↳ 힌트: ${err.hint}`); }
    }
}

/**
 * 컴파일 스냅샷 기록 (GitHub #21) — Attach only 디버깅에서 "제어기 실행 코드보다 로컬 소스가 새로움"을 판정하는 데이터 기반이며,
 * 기록 실패는 배포 결과(success/failedPhase)에 영향을 주지 않는다. 업로드 직전 스냅샷(`ctx.preUploadSnapshot`)이 없으면 지금 찍는다.
 */
export function recordCompileSnapshot(ctx: DeployContext): void {
    const { options, cfg, result, pushTrace } = ctx;
    try {
        const files = ctx.preUploadSnapshot ?? snapshotProjectFiles(options.projectDir);
        ctx.io.recordCompiled({
            ip: cfg.ip,
            projectName: result.projectName,
            projectDir: options.projectDir,
            compiledAt: Date.now(),
            files,
            ...(ctx.preprocess ? {
                preprocess: {
                    options: describePreprocessOptions(ctx.preprocess.options),
                    excludedFiles: ctx.preprocess.summary.excluded.map(e => e.remotePath),
                },
            } : {}),
        });
        result.compiledSnapshotFiles = Object.keys(files).length;
        pushTrace(`│ ✔ 컴파일 스냅샷 기록 ${result.compiledSnapshotFiles} files (Attach only BP 신뢰성 판정용, GitHub #21)`);
    } catch (e: any) {
        pushTrace(`│ ⚠ 컴파일 스냅샷 기록 실패(무시): ${e?.message ?? e}`);
    }
}

/**
 * Phase COMPILE 전체. true 면 다음(START 또는 ERROR CHECK)으로, false 면 `ctx.result` 가 확정된 상태.
 * 성공 분기(최초 성공 / after reload / after load / skipCompile 통과)는 모두 `ctx.compiled = true` 로 합류한다.
 */
export async function runCompilePhase(ctx: DeployContext, project: DeployProjectInfo, target: DeployTarget): Promise<boolean> {
    const { options, cfg, lock, result, pushTrace, isCancelled, cancelResult, host, sleep, projectIo, io } = ctx;
    const { directActive, directGplName, ftpProjectDir, loadPath } = target;

    pushTrace('');
    ctx.phase++;
    // skipCompile 경로에서도 이 단계는 남는다 — 클래식 경로의 Unload/Load 동기화가 여기서 일어나고
    // (Start 하려면 프로젝트가 로드돼 있어야 한다), direct /GPL 모드에서는 안내 한 줄만 남는다.
    pushTrace(options.skipCompile
        ? `━━ [${ctx.phase}/${ctx.totalPhases}] PREPARE (Compile 생략 — Start -compile 이 컴파일, §0.7) ━━━━━`
        : `━━ [${ctx.phase}/${ctx.totalPhases}] COMPILE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    lock.setStage('COMPILE');

    if (isCancelled()) { cancelResult('COMPILE 시작 전'); return false; }

    if (options.autoGate) {
        // 게이트 통과 → 실제 컴파일 진행이 확정된 시점에 이전 진단을 비운다
        // (게이트 스킵/보류 시 기존 빨간 줄을 지우지 않기 위해 entry가 아닌 여기서 clear).
        host.clearDiagnostics();
    }

    // Direct 모드에서는 /GPL의 실제 폴더명(=로드된 프로젝트명)을 최우선 후보로 사용한다.
    const compileCandidates = compileCandidatesFor(project, target);
    const transientCompileRetryDelayMs = Math.max(250, Math.floor(cfg.timeoutMs / 20));
    result.attemptedProjectNames = compileCandidates;
    pushTrace(`│ Candidates: ${compileCandidates.join(' -> ')}`);
    if (options.skipCompile && directActive && directGplName) {
        // Compile 루프가 result.projectName을 확정해 주던 것을 대신한다 — Start 인자로 쓰인다.
        result.projectName = directGplName;
    }
    // skipCompile 경로에서는 컴파일 단계를 "통과"로 본다(제어기가 Start에서 컴파일한다).
    ctx.compiled = options.skipCompile === true;
    let lastCompileFailure: { command: string; code: number; message: string; raw: string } | undefined;

    /** Compile 한 후보 — 일시적 STATUS(-742/-746/-752) 1회 재시도는 모듈이 한다. 시도 기록은 결과에 싣는다. */
    async function compileCandidate(candidate: string): Promise<CompileAttempt> {
        const outcome = await compileProject(projectIo, {
            candidates: [candidate],
            retryDelayMs: transientCompileRetryDelayMs,
            sleep,
        });
        for (const a of outcome.attempts) {
            result.compileAttemptLogs.push({
                command: a.command,
                statusCode: a.statusCode,
                raw: a.raw,
                errors: a.errors,
                responseMeta: a.meta,
                note: a.note,
                ...(a.elapsedMs !== undefined ? { elapsedMs: a.elapsedMs } : {}),
            });
            // 소켓 리셋으로 끊긴 Compile 은 컴파일 에러와 다르다 — 첫 끊김을 기록해 두고 호출부가 생존 확인 후 멈춘다.
            if (!result.compileAborted) {
                const aborted = classifyCompileAbort(a);
                if (aborted) { result.compileAborted = aborted; }
            }
        }
        // compileProject 는 후보마다 최소 한 번 시도하므로 attempts 는 비지 않는다 — 방어적 폴백만 둔다.
        return outcome.attempts[outcome.attempts.length - 1] ?? {
            command: `Compile ${candidate}`,
            ok: false,
            statusCode: outcome.failure?.code ?? -9999,
            message: outcome.failure?.message ?? '시도 기록 없음',
            errors: outcome.errors,
            raw: outcome.failure?.raw ?? '',
        };
    }

    /** 업로드된 사본을 실제 로드본으로 만든다. HTTP 응답(제어기 이상)은 재시도로 자극하지 않고 중단한다. */
    async function ensureLoadedFromFtpPath(): Promise<boolean> {
        const outcome = await loadProject(projectIo, loadPath);
        if (outcome.ok) { return true; }
        lastCompileFailure = outcome.failure && {
            command: outcome.failure.command,
            code: outcome.failure.code,
            message: outcome.failure.message,
            raw: outcome.failure.raw,
        };
        return false;
    }

    /** 로드본을 내린다. `-750`(쓰레드 실행 중)은 호출측이 동기화 중단으로 다룬다. */
    async function tryUnload(candidate: string): Promise<boolean> {
        const outcome = await unloadProject(projectIo, candidate);
        if (outcome.ok) { return true; }
        lastCompileFailure = outcome.failure && {
            command: outcome.failure.command,
            code: outcome.failure.code,
            message: outcome.failure.message,
            raw: outcome.failure.raw,
        };
        return false;
    }

    if (directActive) {
        // Direct /GPL 모드: 컴파일 대상(/GPL 로드본)에 이미 직접 업로드했으므로
        // Unload/Load 동기화가 불필요하다. (Unload -750 락, Load "폴더 존재 불가" 제약 회피)
        pushTrace(`│ Direct /GPL 모드: Unload/Load 생략 — ${ftpProjectDir}의 소스를 그대로 컴파일`);
    } else {
        // 업로드된 /flash 프로젝트 복사본을 실제 컴파일 대상으로 강제 동기화한다.
        // 이유: 이미 로드된 /GPL 프로젝트가 남아 있으면, Compile <name>이 로컬 최신 업로드가 아닌
        //      이전 로드본을 대상으로 실행될 수 있어 오판정(예: 과거 컴파일 에러 재발견)이 발생한다.
        const reloadTargets = [...new Set(compileCandidates)];
        pushTrace(`│ Sync loaded project with uploaded copy`);
        let unloadBlockedByActiveThread = false;
        for (const target of reloadTargets) {
            const unloaded = await tryUnload(target);
            if (isCancelled()) { cancelResult(`Unload ${target} 응답 후`); return false; }
            if (!unloaded) {
                // -750(*Invalid when thread active*): 쓰레드 실행 중에는 Unload/Load 동기화가
                // 원천적으로 불가하다. 이 상태로 Load를 강행하면 이전 로드본을 컴파일하거나
                // (2026-07-03 §1-F) 제어기 이상 상황을 더 자극할 수 있어 여기서 명확히 중단한다.
                if (lastCompileFailure?.code === -750) {
                    unloadBlockedByActiveThread = true;
                    break;
                }
                pushTrace(`│ ⚠ Unload failed but continue: ${target}`);
            }
        }
        if (unloadBlockedByActiveThread) {
            pushTrace('│ ✘ 쓰레드 실행 중(-750) — Unload/Load 동기화 불가. Load를 생략하고 중단합니다.');
            pushTrace('│   → 프로그램 STOP 후 다시 시도하거나, STOP이 포함된 전체 배포를 사용하세요.');
            result.failedPhase = 'COMPILE';
            result.failedCommand = 'Unload (threads active)';
            result.failedStatusCode = -750;
            result.failedStatusMessage = '*Invalid when thread active* — 실행 중에는 Quick Compile 동기화가 불가합니다. STOP 후 재시도하세요.';
            return false;
        }
        const synced = await ensureLoadedFromFtpPath();
        if (isCancelled()) { cancelResult(`Load ${loadPath} 응답 후`); return false; }
        if (!synced) {
            pushTrace('│ ✘ Failed to load uploaded project copy before compile');
            result.failedPhase = 'COMPILE';
            result.failedCommand = `Load ${loadPath}`;
            result.failedStatusCode = lastCompileFailure?.code;
            result.failedStatusMessage = lastCompileFailure?.message || 'Failed to sync uploaded copy before compile';
            return false;
        }
    }

    /**
     * Compile 이 소켓 리셋으로 끊긴 경우(2026-10-22 사고) — 다른 후보로 Compile 을 더 보내지 않고, 짧은 생존 확인 한 번으로
     * controllerHealth 를 채운 뒤 멈춘다. 같은 Compile 을 되풀이하면 끊긴 제어기를 더 자극할 수 있다.
     */
    async function stopOnCompileAbort(aborted: CompileAborted): Promise<void> {
        pushTrace(`│ ✘ ${aborted.hint} — ${aborted.command} 이 ${aborted.elapsedMs} ms 만에 ${aborted.reason} 로 끊김 (받은 출력 ${aborted.outputLines}줄)`);
        const probe = await io.probeControllerCommand(SHOW_THREAD_LIST_CMD, cfg, COMPILE_ABORT_PROBE_TIMEOUT_MS);
        result.controllerHealth = livenessFromProbe(probe, SHOW_THREAD_LIST_CMD.replace(/\s+/g, ' '), Date.now());
        pushTrace(`│   생존 확인(${result.controllerHealth.probe}): ${result.controllerHealth.state === 'responsive' ? '응답함' : '응답 없음'} — ${result.controllerHealth.detail}`);
        result.failedPhase = 'COMPILE';
        result.failedCommand = aborted.command;
        result.failedStatusMessage = `COMPILE_ABORTED: ${aborted.hint} (${aborted.reason}, ${aborted.elapsedMs} ms, 출력 ${aborted.outputLines}줄) · `
            + `명령 콘솔 ${result.controllerHealth.state === 'responsive' ? '응답함' : '응답 없음'}`;
    }

    // 정지 뒤 Compile/Start 직전 — 심각 구간이면 사람에게 계속/취소를 묻는다(2026-10-27 사용자 요청). 측정은 어느 수준에서도
    // 전송을 막지 않고(2026-10-26), 선택은 사람 경로의 모달이 한다. AI·자동화·autoOnSave 는 hook 이 없어 경고만 남기고 계속한다.
    // (Compile/Start 큐 슬롯의 검사가 대표 측정이다. 이 측정 뒤 상태 변경이 없으면 큐 슬롯은 같은 값을 재사용하고
    //  `Show Memory` 를 다시 보내지 않는다 — controller/diagnostics/memoryReadings, 2026-11-03.)
    if (options.confirmMemoryCritical) {
        const phase: 'compile' | 'start' = options.skipCompile ? 'start' : 'compile';
        const label = phase === 'start' ? 'Start' : 'Compile';
        const check = await io.checkMemoryBeforeOperation(cfg);
        if (isCancelled()) { cancelResult('Show Memory 응답 후'); return false; }
        result.memoryPrecheck = check;
        if (check.level === 'critical') {
            pushTrace(`│ ⚠ 정지 뒤 ${label} 직전 측정 — ${check.message}`);
            pushTrace(`│ … 사용자에게 ${label} 계속 여부 확인 중`);
            let proceed = false;
            try { proceed = await options.confirmMemoryCritical(check, phase); } catch { proceed = false; }
            if (!proceed) {
                pushTrace(`│ ✘ 사용자가 여유 메모리 심각 경고에서 취소 — ${label} 미전송 (업로드는 완료)`);
                result.failedPhase = 'MEMORY_CHECK';
                result.failedCommand = 'Show Memory';
                result.failedStatusMessage = memoryCriticalCancelMessage(check, label);
                return false;
            }
            pushTrace(`│ ✔ 사용자 승인 — ${label} 계속 진행`);
        }
    }

    for (const candidate of options.skipCompile ? [] : compileCandidates) {
        let recoveryFailureRecorded = false; // 복구 분기(cr2)가 실패를 기록했는지 (§1-L cr 덮어쓰기 방지)
        // 전송·판정·일시적 STATUS 재시도·로그는 projectCommands 가 한다(§1-DE). 로드 상태 복구만 아래에 남는다.
        const compileStartedAt = Date.now();
        let cr = await compileCandidate(candidate);
        if (isCancelled()) { cancelResult(`Compile ${candidate} 응답 후`); return false; }
        if (result.compileAborted) { await stopOnCompileAbort(result.compileAborted); return false; }
        // 정지 뒤 Compile 직전 큐 슬롯에서 잰 여유 메모리 — 실행 중 메모리가 빠진 값이라 이것이 배포의 대표 측정이다.
        // 경고만 남기고 계속한다(2026-10-26 사용자 결정). 측정이 없으면(검사 생략·실패) 업로드 전 값을 그대로 둔다.
        const slotCheck = io.getLastMemoryCheck();
        if (slotCheck && slotCheck.ip === cfg.ip && slotCheck.at >= compileStartedAt) {
            result.memoryPrecheck = slotCheck.check;
            if (slotCheck.check.level === 'warning' || slotCheck.check.level === 'critical') {
                const note = `정지 뒤 Compile 직전 측정 — ${slotCheck.check.message}`;
                result.precheckWarnings.push(note);
                pushTrace(`│ ⚠ ${note}`);
            }
        }

        if (cr.ok) {
            if (isControllerNonBlockingStatus(cr.statusCode)) {
                pushTrace(`│ ⚠ Compile STATUS ${cr.statusCode} non-blocking (controller environment warning)`);
            }
            result.projectName = candidate;
            result.compileErrors = []; // 이전 후보의 컴파일 에러가 성공 결과에 남지 않도록 초기화
            ctx.compiled = true;
            break;
        }

        // NOTE: 과거 여기서 STATUS 누락 시 `Show Thread` 응답을 성공으로 간주했으나,
        // 그것은 "제어기가 다시 응답하는가"만 확인할 뿐 컴파일 성공과 무관하여
        // 실제 컴파일 에러(-742 등)를 가렸다. 이제 컴파일 응답은 waitForStatusClose로
        // 종결자 </STATUS>까지 수신하므로, 성공/실패는 오직 STATUS와 파싱된 에러로 판정한다.

        result.compileErrors = cr.errors;
        const recovery = classifyCompileFailure(cr, directActive);

        // Direct 모드: 복구용 Unload/Load는 목적(락 회피)에 반하므로 시도하지 않는다.
        // -508/-743(not loaded)이 나온다면 /GPL 폴더는 있으나 로드본이 인식되지 않는 상태 —
        // Save to Flash로 /flash/projects에 저장 후 콘솔에서 Unload <name> → Load로 복구한다.
        if (recovery === 'direct-load-state') {
            pushTrace('│ ✘ Direct /GPL 모드에서 로드 상태 이상 — Save to Flash 후 콘솔에서 Unload/Load로 복구하세요.');
            lastCompileFailure = {
                command: `Compile ${candidate}`,
                code: cr.statusCode,
                message: `${parseStatus(cr.raw).message || 'Load-state error in direct /GPL mode'} — Save to Flash + Load로 복구 필요`,
                raw: cr.raw,
            };
            recoveryFailureRecorded = true;
        }
        // -745: project already loaded → Unload + Load + Compile
        else if (recovery === 'reload') {
            pushTrace(`│ ⚠ Already loaded. Unload → Load → Compile`);
            const unloaded = await tryUnload(candidate);
            if (isCancelled()) { cancelResult(`Unload ${candidate} 응답 후`); return false; }
            if (!unloaded) {
                continue;
            }
            const loaded = await ensureLoadedFromFtpPath();
            if (isCancelled()) { cancelResult(`Load ${loadPath} 응답 후`); return false; }
            if (!loaded) {
                continue;
            }
            const cr2 = await compileCandidate(candidate);
            if (isCancelled()) { cancelResult(`Compile ${candidate} 재시도 응답 후`); return false; }
            if (result.compileAborted) { await stopOnCompileAbort(result.compileAborted); return false; }
            if (cr2.ok) {
                result.projectName = candidate;
                result.compileErrors = [];
                ctx.compiled = true;
                pushTrace(`│ ✔ Compile success (after reload): ${candidate}`);
                break;
            }
            result.compileErrors = cr2.errors;
            lastCompileFailure = {
                command: `Compile ${candidate}`,
                code: cr2.statusCode,
                message: parseStatus(cr2.raw).message || 'Compile failed after reload',
                raw: cr2.raw,
            };
            recoveryFailureRecorded = true;
        }
        // -508/-743: missing/invalid → Load + Compile
        else if (recovery === 'load') {
            pushTrace(`│ ⚠ Not loaded. Load → Compile`);
            const loaded = await ensureLoadedFromFtpPath();
            if (isCancelled()) { cancelResult(`Load ${loadPath} 응답 후`); return false; }
            if (!loaded) {
                continue;
            }
            const cr2 = await compileCandidate(candidate);
            if (isCancelled()) { cancelResult(`Compile ${candidate} 재시도 응답 후`); return false; }
            if (result.compileAborted) { await stopOnCompileAbort(result.compileAborted); return false; }
            if (cr2.ok) {
                const warning = `Pre-check warning: Compile by name returned ${cr.statusCode}, but Load ${loadPath} + Compile succeeded`;
                result.precheckWarnings.push(warning);
                pushTrace(`│ ⚠ ${warning}`);
                result.projectName = candidate;
                result.compileErrors = [];
                ctx.compiled = true;
                pushTrace(`│ ✔ Compile success (after load): ${candidate}`);
                break;
            }
            result.compileErrors = cr2.errors;
            lastCompileFailure = {
                command: `Compile ${candidate}`,
                code: cr2.statusCode,
                message: parseStatus(cr2.raw).message || 'Compile failed after load',
                raw: cr2.raw,
            };
            recoveryFailureRecorded = true;
        }

        pushTrace(`│ ✘ Compile failed: ${candidate}`);
        // 복구 분기(-745/-508 등)가 이미 cr2 기준 실패를 기록했다면 원본 cr로 덮어쓰지 않는다(§1-L 해소).
        if (!recoveryFailureRecorded && cr.statusCode !== 0) {
            const status = parseStatus(cr.raw);
            pushTrace(`│   STATUS ${status.code}: ${status.message}`);
            lastCompileFailure = {
                command: `Compile ${candidate}`,
                code: status.code,
                message: status.message,
                raw: cr.raw,
            };
        }
    }

    // 컴파일 에러 → vscode.Diagnostic 주입
    reportCompileErrors(ctx, result.compileErrors);

    if (!ctx.compiled) {
        pushTrace('│ ✘ All compile attempts failed');
        result.failedPhase = 'COMPILE';
        result.failedCommand = lastCompileFailure?.command || 'Compile <candidate>';
        result.failedStatusCode = lastCompileFailure?.code;
        result.failedStatusMessage = lastCompileFailure?.message || 'All compile attempts failed';
        if (lastCompileFailure?.raw) {
            pushTrace(`│ LAST RAW ${ctx.rawPreview(lastCompileFailure.raw)}`);
        }
        return false;
    }

    // Compile을 실제로 보낸 경로: compiled=true가 되는 모든 분기(최초 성공 / after reload / after load)가
    // 여기로 합류한다. skipCompile 경로는 아직 컴파일된 것이 아니므로 Start 성공을 확인한 뒤에 기록한다.
    if (!options.skipCompile) {
        recordCompileSnapshot(ctx);
    }
    return true;
}
