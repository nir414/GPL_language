/**
 * 배포 단계 2.5 — 여유 메모리가 모자라면 Unload 로 회수한 뒤 진행한다(2026-11-04 §1-GZ, 사용자 요청).
 *
 * 배경: AI 가 컴파일을 반복하면 제어기 여유 메모리가 줄어든다. 메모리 측정은 경고 전용이라(2026-10-26 결정) 지금까지는
 * 사람에게 Unload 를 물어야 했다. 사용자 결정(2026-11-04): **AI 도 Unload 할 수 있어야 하고, 메모리가 모자라면 확인 없이
 * 자동으로 Unload 한 뒤 진행**한다. 대상은 배포 대상과 그 밖에 로드된 프로젝트 전부(`/GPL` 은 비우지 않는다).
 *
 * 순서(업로드 전에 해야 한다 — `Unload <앱>` 은 `/GPL/<앱>` 폴더를 지운다, 2026-10 실측):
 *   업로드 전 측정(실행 중 앱 메모리 포함)이 경고 이하 → Stop(정지 게이트) → 다시 측정 → 여전히 경고 이하면
 *   `/GPL` 폴더 목록에서 Unload 할 것을 골라 하나씩 `Unload <이름>`(대상은 맨 끝) → 다시 측정 → 업로드·Compile 계속.
 *
 * 하지 않는 것(안전):
 *  - 같은 부팅에서 그룹 Compile 표시가 있으면 자동 Unload 를 통째로 건너뛴다 — 그 상태의 Unload 뒤 6/6 명령 콘솔이 끊겼고
 *    재부팅이 필요했다(unloadRisk.ts). 사용자 결정(2026-11-04): 건너뛰고 경고만 남긴 채 Compile 은 진행한다.
 *  - 그룹(ProjectStart 없는 .gpr, 라이브러리)과 워크스페이스에 없어 성격을 모르는 프로젝트는 Unload 하지 않는다 —
 *    그룹 자체를 Unload 하면 제어기가 멈춘 관측이 있다(2026-10-27 Lib_Net).
 *  - Upload Only·정지 없는 빠른 컴파일(skipStop)·autoOnSave 게이트에서는 하지 않는다(정지 없이 Unload 는 -750).
 *  - Unload 응답이 미확정(타임아웃·STATUS 없음)이면 더 보내지 않고 배포를 멈춘다 — 명령 콘솔이 수 분간 응답하지 않을 수 있다.
 *
 * vscode 무의존. 판정(`planMemoryRecovery`·`pickUnloadCandidates`·`classifyUnloadReply`)은 순수 함수 — 단위 테스트:
 * src/test/controller/deployment/deployMemoryRecovery.test.ts.
 */

import { listRemoteDir } from '../files/ftpClient';
import { forgetSyncManifest } from '../files/syncManifest';
import { unloadTimeoutMs, UNLOAD_BLOCKED_BY_THREAD } from '../commands/projectCommands';
import { unloadRiskWarning } from '../commands/unloadRisk';
import { currentUnloadRisk, isUnloadRiskError, lookupProjectKind } from '../commands/unloadRiskGuard';
import { isProjectNotLoaded } from '../protocol/controllerStatusCodes';
import { parseStatus } from '../protocol/responseParser';
import type { MemoryPrecheck } from '../diagnostics/memoryGuard';
import { runStopGate } from './deployStopStage';
import type { DeployContext } from './deployContext';
import type { DeployTarget } from './deployTargetStage';

// ── 순수 판정 ──────────────────────────────────────────────────────────────

export interface MemoryRecoveryPlanInput {
    /** 설정 `gpl.controller.memoryGuard.autoUnload`(기본 켬). */
    enabled: boolean;
    uploadOnly: boolean;
    skipStop: boolean;
    autoGate: boolean;
    /** 업로드 전 측정. */
    preUpload: MemoryPrecheck | undefined;
}

export type MemoryRecoveryPlan = { attempt: true } | { attempt: false; reason: string };

/** 이 배포에서 메모리 회수를 시도할지 — 업로드 전 측정이 경고 이하일 때만(정지 뒤 다시 재서 최종 판단한다). */
export function planMemoryRecovery(input: MemoryRecoveryPlanInput): MemoryRecoveryPlan {
    if (!input.enabled) { return { attempt: false, reason: '설정으로 꺼짐' }; }
    if (input.uploadOnly) { return { attempt: false, reason: 'Upload Only' }; }
    if (input.autoGate) { return { attempt: false, reason: 'autoOnSave' }; }
    if (input.skipStop) { return { attempt: false, reason: '정지 없는 빠른 컴파일' }; }
    const level = input.preUpload?.level;
    if (level !== 'warning' && level !== 'critical') { return { attempt: false, reason: level === 'unknown' ? '측정 실패' : '여유 충분' }; }
    return { attempt: true };
}

/** 정지 뒤 다시 잰 값으로 실제로 Unload 할지. */
export function needsUnloadAfterStop(check: MemoryPrecheck): boolean {
    return check.level === 'warning' || check.level === 'critical';
}

export interface UnloadCandidate { name: string; isTarget: boolean }
export interface SkippedUnload { name: string; reason: string }

/**
 * `/GPL` 폴더 이름들 → Unload 순서. 배포 대상 외 실행 프로젝트를 먼저, 대상은 맨 끝(대상이 실행 불가 그룹이면 제외).
 * @param kindOf 워크스페이스 `.gpr` 기준 성격 — runnable:false = 그룹, undefined = 모름.
 */
export function pickUnloadCandidates(input: {
    gplFolders: readonly string[];
    targetName: string | undefined;
    kindOf: (name: string) => { runnable: boolean } | undefined;
}): { unload: UnloadCandidate[]; skipped: SkippedUnload[] } {
    const targetKey = input.targetName?.toLowerCase();
    const unload: UnloadCandidate[] = [];
    const skipped: SkippedUnload[] = [];
    let target: UnloadCandidate | undefined;
    const seen = new Set<string>();
    for (const name of input.gplFolders) {
        const key = name.toLowerCase();
        if (!name || seen.has(key)) { continue; }
        seen.add(key);
        const kind = input.kindOf(name);
        if (kind?.runnable === false) { skipped.push({ name, reason: '그룹(라이브러리) — 그룹 Unload 는 제어기 정지 관측(2026-10-27)' }); continue; }
        if (key === targetKey) { target = { name, isTarget: true }; continue; }
        if (!kind) { skipped.push({ name, reason: '워크스페이스에 없어 성격을 모름' }); continue; }
        unload.push({ name, isTarget: false });
    }
    if (target) { unload.push(target); }
    return { unload, skipped };
}

export type UnloadReply =
    | { kind: 'unloaded' }
    | { kind: 'not-loaded' }
    | { kind: 'thread-active' }
    | { kind: 'failed'; code: number; message: string }
    /** STATUS 를 끝까지 받지 못했다 — 실행 여부를 모른다. 더 보내지 않는다. */
    | { kind: 'unknown'; detail: string };

export function classifyUnloadReply(raw: string, statusComplete: boolean): UnloadReply {
    if (!statusComplete) { return { kind: 'unknown', detail: '응답에 </STATUS> 없음' }; }
    const st = parseStatus(raw);
    if (st.code === 0) { return { kind: 'unloaded' }; }
    if (isProjectNotLoaded(st.code)) { return { kind: 'not-loaded' }; }
    if (st.code === UNLOAD_BLOCKED_BY_THREAD) { return { kind: 'thread-active' }; }
    return { kind: 'failed', code: st.code, message: st.message };
}

// ── 단계 ──────────────────────────────────────────────────────────────────

export interface MemoryRecoveryOutcome {
    /** false 면 `ctx.result` 가 실패로 확정됐다(업로드 전 — /GPL 은 건드리지 않음). */
    proceed: boolean;
    /** 회수 중 정지 게이트를 이미 돌렸으면 그 결과 — 업로드 단계가 다시 돌리지 않는다. */
    gate?: 'proceed' | 'abort';
    /** 배포 대상을 Unload 했다 — `/GPL/<대상>` 이 지워졌을 수 있으므로 변경 파일만이 아니라 전체를 올려야 한다. */
    targetUnloaded: boolean;
}

/** 업로드 전에 부른다. 회수할 일이 없으면 아무것도 보내지 않고 `{ proceed: true }`. */
export async function recoverMemoryBeforeUpload(ctx: DeployContext, target: DeployTarget): Promise<MemoryRecoveryOutcome> {
    const { options, cfg, result, pushTrace, isCancelled, cancelResult, io, lock } = ctx;
    const plan = planMemoryRecovery({
        enabled: options.autoUnloadOnLowMemory === true,
        uploadOnly: options.uploadOnly === true,
        skipStop: options.skipStop === true,
        autoGate: options.autoGate === true,
        preUpload: result.memoryPrecheck,
    });
    if (!plan.attempt) { return { proceed: true, targetUnloaded: false }; }

    const before = result.memoryPrecheck;
    pushTrace(`│ ♻ 여유 메모리 ${before?.freeMb ?? '?'} MB(경고 ${before?.warnMb ?? '?'} MB 미만) — 정지 뒤 다시 재고 모자라면 Unload 로 회수합니다(gpl.controller.memoryGuard.autoUnload)`);
    const recovery: NonNullable<typeof result.memoryRecovery> = { beforeMb: before?.freeMb ?? null, unloaded: [], skipped: [] };
    result.memoryRecovery = recovery;

    // 그룹 Compile 표시가 있으면(근거·문구는 unloadRisk 정본) 자동 Unload 를 건너뛰고 진행한다 — 사용자 결정 2026-11-04.
    // 판정 정본은 unloadRisk.assessUnloadRisk(전송 가드와 같은 판단) — 범위 무관 표시만 보므로 `Unload -all` 로 묻는다.
    const risk = currentUnloadRisk('Unload -all', cfg.ip);
    if (risk?.risky) {
        recovery.skippedAll = unloadRiskWarning(risk).message;
        const note = `메모리 자동 회수 건너뜀 — ${recovery.skippedAll}. 재부팅하면 표시가 풀린다. Compile 은 그대로 진행합니다.`;
        result.precheckWarnings.push(note);
        pushTrace(`│ ⚠ ${note}`);
        return { proceed: true, targetUnloaded: false };
    }

    // 1) 정지 — Unload 는 쓰레드가 돌면 -750 이다. 업로드 단계의 정지 게이트를 여기서 먼저 돌리고 결과를 넘긴다.
    lock.setStage('MEMORY_RECOVERY');
    const gate = await runStopGate(ctx);
    if (isCancelled()) { cancelResult('메모리 회수(정지) 뒤'); return { proceed: false, gate, targetUnloaded: false }; }
    if (gate === 'abort') { return { proceed: true, gate, targetUnloaded: false }; }

    // 2) 정지 뒤 다시 잰다 — 실행 중 앱의 런타임 메모리(~3 MB)가 빠지면 충분할 수 있다.
    const afterStop = await io.checkMemoryBeforeOperation(cfg);
    recovery.afterStopMb = afterStop.freeMb;
    if (!needsUnloadAfterStop(afterStop)) {
        pushTrace(`│ ✔ 정지 뒤 여유 메모리 ${afterStop.freeMb ?? '?'} MB — Unload 없이 진행`);
        return { proceed: true, gate, targetUnloaded: false };
    }

    // 3) Unload 할 것 고르기 — `/GPL` 폴더 = 로드된 프로젝트(콘솔에 목록 명령이 없다 — `Show Project` 는 -714).
    let folders: string[];
    try {
        folders = (await listRemoteDir(cfg.ip, '/GPL')).filter(e => e.isDirectory).map(e => e.name);
    } catch (e: any) {
        const note = `메모리 자동 회수 건너뜀 — /GPL 목록을 읽지 못함: ${e?.message ?? e}`;
        result.precheckWarnings.push(note);
        pushTrace(`│ ⚠ ${note}`);
        return { proceed: true, gate, targetUnloaded: false };
    }
    const kinds = new Map<string, { runnable: boolean } | undefined>();
    for (const name of folders) { kinds.set(name.toLowerCase(), await lookupProjectKind(name)); }
    const targetName = target.directActive ? target.directGplName : undefined;
    const picked = pickUnloadCandidates({ gplFolders: folders, targetName, kindOf: n => kinds.get(n.toLowerCase()) });
    recovery.skipped = picked.skipped;
    for (const s of picked.skipped) { pushTrace(`│   − Unload 안 함: ${s.name} (${s.reason})`); }

    // 4) 하나씩 Unload — 대상은 맨 끝.
    let targetUnloaded = false;
    for (const c of picked.unload) {
        if (isCancelled()) { cancelResult(`메모리 회수(Unload ${c.name}) 전`); return { proceed: false, gate, targetUnloaded }; }
        const command = `Unload ${c.name}`;
        pushTrace(`│ CMD ${command}${c.isTarget ? ' (배포 대상 — 이어서 전체를 다시 올린다)' : ''}`);
        let reply: UnloadReply;
        try {
            const resp = await io.sendCommandDetailed(command, cfg, { waitForStatusClose: true, timeoutMs: unloadTimeoutMs(cfg.timeoutMs) });
            reply = classifyUnloadReply(resp.raw, resp.meta.statusTagReceived);
        } catch (e: any) {
            if (isUnloadRiskError(e)) {
                recovery.skipped.push({ name: c.name, reason: '전송 가드가 위험으로 거부' });
                pushTrace(`│   − 전송 가드가 거부(그룹 Compile 뒤·그룹 대상) — 보내지 않음`);
                continue;
            }
            reply = { kind: 'unknown', detail: e?.message ?? String(e) };
        }
        switch (reply.kind) {
            case 'unloaded':
            case 'not-loaded':
                // Unload 하면 `/GPL/<앱>` 폴더가 지워진다 — 업로드 지문을 버려 다음 업로드가 "같음"으로 건너뛰지 않게.
                forgetSyncManifest(cfg.ip, `/GPL/${c.name}`);
                if (reply.kind === 'unloaded') { recovery.unloaded.push(c.name); }
                if (c.isTarget) { targetUnloaded = true; }
                pushTrace(`│   ✔ ${reply.kind === 'unloaded' ? 'Unload 완료' : '로드돼 있지 않음'}: ${c.name}`);
                break;
            case 'thread-active':
                recovery.skipped.push({ name: c.name, reason: '-750 쓰레드 실행 중' });
                pushTrace(`│   ⚠ -750 쓰레드 실행 중 — 건너뜀: ${c.name}`);
                break;
            case 'failed':
                recovery.skipped.push({ name: c.name, reason: `STATUS ${reply.code} ${reply.message}` });
                pushTrace(`│   ⚠ STATUS ${reply.code} ${reply.message} — 건너뜀: ${c.name}`);
                break;
            case 'unknown':
                // 실행됐는지 모른다 — 명령 콘솔이 수 분간 응답하지 않는 사례가 있어 더 보내지 않고 멈춘다(재전송 금지).
                pushTrace(`│   ✘ Unload ${c.name} 결과 미확정(${reply.detail}) — 더 보내지 않고 배포를 멈춥니다(업로드 전, /GPL 그대로)`);
                result.failedPhase = 'MEMORY_CHECK';
                result.failedCommand = command;
                result.failedStatusMessage = `메모리 자동 회수 중 ${command} 결과 미확정(${reply.detail}) — 명령 콘솔 응답을 확인한 뒤 다시 배포하세요. 업로드·Compile 은 하지 않았습니다.`;
                return { proceed: false, gate, targetUnloaded };
        }
    }

    // 5) 결과 측정 — 보고용(측정 실패는 무시).
    try {
        const after = await io.checkMemoryBeforeOperation(cfg);
        recovery.afterMb = after.freeMb;
        result.memoryPrecheck = after;
        pushTrace(`│ ♻ 메모리 회수: ${recovery.afterStopMb ?? '?'} MB → ${after.freeMb ?? '?'} MB (Unload ${recovery.unloaded.length}개${recovery.unloaded.length ? `: ${recovery.unloaded.join(', ')}` : ''})`);
    } catch { /* 보고용 */ }
    return { proceed: true, gate, targetUnloaded };
}
