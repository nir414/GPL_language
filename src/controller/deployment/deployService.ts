/**
 * 배포 서비스: UPLOAD ∥ STOP(+정지 완료 게이트) 동시 진행 → COMPILE (→ START) 워크플로.
 * skipStart 옵션으로 Start 단계를 생략하여 디버그 준비용으로 사용 가능.
 * skipCompile 옵션으로 Compile 단계를 생략하고 곧바로 Start 할 수 있다('업로드 스타트', §1-CD).
 * controller-f5.ps1의 핵심 로직을 TypeScript로 포팅.
 *
 * 2026-08-25(이슈 #17 + 보충 코멘트) 재구성 — 목적은 속도: 사용자 관찰상 "쓰레드 실행 중 FTP 업로드"는 무해하고,
 * 업로드(FTP 21)와 Stop -all/정지 확인(1402)은 별 채널이라 **동시에** 진행해도 문제가 없다. Stop은 한 번에 안 멈추면
 * settle 폴링·재시도를 반복하느라 오래 걸리므로 업로드와 겹쳐 총 소요를 max(업로드, 정지)로 줄인다.
 * 진짜 위험은 ① 업로드 도중 Compile/Start(제어기 사망) ② 정지 미완료 상태의 Compile/Start(§0.6)다. 두 작업이
 * *모두* 끝난 뒤에만 COMPILE로 가고(②), ①은 deploy() 전체를 감싸는 배포 잠금(deployLock.ts, 프로세스 간 파일)으로 막는다.
 * COMPILE과 START는 한 번에 하나만 보낸다 — 확장이 보내는 Start 에는 `-compile` 이 붙어 컴파일까지 수행하므로
 * (§1-DN, ai-handoff §0.7) Compile 직후 Start는 컴파일 중복이다. 그래서 업로드 후 실행이 필요한 경로(gpl.uploadStart)는
 * skipCompile 로 Compile 을 건너뛰고 Start 만 보내고, 배포 없이 실행만 하는 경로는 gpl.start 가 따로 담당한다.
 *
 * 2026-10-27 구조: 이 파일은 **오케스트레이터**다 — 대기열·배포 잠금·작업 기록(`deploy`/`finishOperation`), VS Code 접착
 * (Output·Problems·설정·모달 → `DeployHostIo`), 제어기 IO 주입(`DeployControllerIo`)만 갖고, 파이프라인 본문은
 * 단계 모듈이 `DeployContext`(deployContext.ts) 하나를 공유하며 순서대로 돈다:
 * `deployPrecheck` → `deployTargetStage` → `deployUploadStage`(∥ `deployStopStage`) → `deployCompileStage`
 * → `deployStartStage` → `deployErrorCheckStage`. 타입은 `deployTypes`, 모드 라벨은 `deployModes`(모두 여기서 re-export).
 */

import * as vscode from 'vscode';
import * as path from 'path';
import {
    sendCommandDetailed,
    trySendCommand,
    getControllerConfig,
    ControllerConfig,
    beginMemoryNoticeScope,
    checkMemoryBeforeOperation,
    getLastCommandChannelLoss,
    getLastMemoryCheck,
    probeControllerCommand,
} from '../connection/controllerConnection';
import { createControllerIdentityIo, recentReachabilityEvidence } from '../connection/controllerIdentityIo';
import type { CompileError } from '../protocol/responseParser';
import { isNotRunnableStartFailure } from '../commands/unloadRisk';
import { attachCompileErrorHints } from './compileErrorHints';
import { getDeployLock, describeDeployLock, DeployLockHandle, DeployLockRecord } from './deployLock';
import { KeyedSerialQueue } from './deployQueue';
import { beginOperation, findActiveByIdempotencyKey, sweepOperations, OperationHandle, OperationRecord } from '../automation/operationStore';
import { clearDeployCancellation, readDeployCancellation } from './deployCancellation';
import { recordCompiled } from './deployRecord';
import { PROJECT_EXCLUDE_GLOB } from '../../project/sources/projectFileScope';
import { collapseControllerProjectDirs, getControllerProjectWriteBlock } from '../../project/remote/controllerProjectWorkspace';
import { summarizeCompileCommand } from './compileAbort';
import { emptyDeployResult } from './deployTypes';
import type { DeployOptions, DeployResult, DeployUploadEvent } from './deployTypes';
import { defaultLockOwner, defaultOperationType } from './deployModes';
import { createDeployContext } from './deployContext';
import type { DeployControllerIo, DeployHostIo } from './deployContext';
import { checkMemoryBeforeUpload, readProjectForDeploy } from './deployPrecheck';
import { resolveDeployTarget, traceDeployHeader } from './deployTargetStage';
import { runUploadAndStopPhase } from './deployUploadStage';
import { runCompilePhase } from './deployCompileStage';
import { runStartPhase } from './deployStartStage';
import { runErrorCheckPhase } from './deployErrorCheckStage';
import { createCompileSourceLineReader, resolveErrorFilePath } from './compileErrorPath';

// 공개 API — 타입과 경로 해석은 분리 모듈이 정본이지만 호출측은 종전대로 이 모듈에서 가져간다.
export type { DeployUploadEvent, DeployOptions, DeployPhase, CompileAttemptLog, DeployResult } from './deployTypes';
export { resolveErrorFilePath } from './compileErrorPath';

const _onDidUploadProgress = new vscode.EventEmitter<DeployUploadEvent>();
export const onDidUploadProgress: vscode.Event<DeployUploadEvent> = _onDidUploadProgress.event;

/** 배포 잠금 보유 중이라 시작하지 못했을 때의 결과(호출측 사전 검사에서도 재사용). */
export function makeLockedResult(holder: DeployLockRecord, isLocal?: boolean): DeployResult {
    return {
        ...emptyDeployResult(),
        failedPhase: 'LOCKED',
        failedCommand: 'DeployLock acquire',
        failedStatusMessage: `배포가 이미 진행 중입니다 (${describeDeployLock(holder)})`,
        lockHolder: holder,
        ...(isLocal === undefined ? {} : { lockHolderIsLocal: isLocal }),
        // 보유자가 작업 기록을 남겼으면 그 id 를 함께 준다 — 막힌 쪽이 진행 상황을 조회할 수 있게(§7.2).
        ...(holder.operationId ? { operationId: holder.operationId } : {}),
    };
}

/** 같은 키의 배포가 이미 돌고 있어 새로 시작하지 않았을 때의 결과(§10). */
function makeInProgressResult(existing: OperationRecord): DeployResult {
    return {
        ...emptyDeployResult(),
        failedPhase: 'IN_PROGRESS',
        failedCommand: 'Operation idempotency check',
        failedStatusMessage: `같은 요청의 배포가 이미 진행 중입니다 (${existing.operationId}, ${existing.phase})`,
        operationId: existing.operationId,
        existingOperation: existing,
    };
}

const deployQueue = new KeyedSerialQueue();
const DEPLOY_LOCK_RETRY_MS = 250;

/** 단계 모듈에 꽂는 제어기 IO 실물 — 명령 콘솔 직렬 큐·메모리 검사·정체 확인·컴파일 스냅샷 Memento(모두 vscode 에 묶인 모듈). */
const controllerIo: DeployControllerIo = {
    sendCommandDetailed,
    trySendCommand,
    probeControllerCommand,
    checkMemoryBeforeOperation,
    getLastMemoryCheck,
    getLastCommandChannelLoss,
    createIdentityIo: createControllerIdentityIo,
    recentReachabilityEvidence,
    recordCompiled,
};

/**
 * 배포 잠금 핸들에 작업 기록을 얹는다 — `lock.setStage()` 한 번으로 잠금 단계와 작업 phase 가 함께 움직인다.
 * (단계 갱신 지점이 배포 본문 곳곳에 있으므로, 각 지점을 고치는 대신 핸들을 감싸 한 곳에서 연결한다.)
 */
function withOperationPhase(lock: DeployLockHandle, op: OperationHandle | undefined): DeployLockHandle {
    if (!op) { return lock; }
    return {
        get record() { return lock.record; },
        get released() { return lock.released; },
        setStage(stage: string) { lock.setStage(stage); op.setPhase(stage); },
        heartbeat() { lock.heartbeat(); op.heartbeat(); },
        release() { lock.release(); },
    };
}

/**
 * 프로젝트를 제어기에 배포한다.
 * Output channel에 단계별 진행 상태를 출력한다.
 *
 * 진입 시 제어기별 직렬 큐에 등록한 뒤 배포 잠금(deployLock.ts)을 획득하고 종료 시 해제한다. 호출측은 프로젝트
 * 선택·미저장 확인 같은 UI를 *먼저* 끝내고 이 함수를 불러야 UI 대기 중 대기열을 차지하지 않는다(이슈 #15).
 * 같은 제어기의 뒤 요청은 거부하지 않고 QUEUED 상태로 기다리며, 다른 창/프로세스의 잠금도 해제될 때까지 기다린다.
 * 디버그 F5 경로도 같은 함수를 쓰므로 자동 참여한다.
 */
export async function deploy(
    options: DeployOptions,
    output: vscode.OutputChannel,
    diagnosticCollection: vscode.DiagnosticCollection,
    token?: vscode.CancellationToken,
    controllerOverride?: Partial<ControllerConfig>
): Promise<DeployResult> {
    const cfg: ControllerConfig = { ...getControllerConfig(), ...controllerOverride };
    const owner = options.lockOwner ?? defaultLockOwner(options);

    // FTP 다운로드 manifest는 로컬 사본의 쓰기 정책과 원본 제어기를 고정한다. 이 검사는 잠금·FTP·1402보다
    // 먼저 수행해 snapshot이나 다른 제어기에서 받은 사본이 어떤 원격 상태도 바꾸지 않게 한다(F5 포함).
    const manifestBlock = getControllerProjectWriteBlock(options.projectDir, cfg.ip);
    if (manifestBlock) {
        output.appendLine(`[Manifest] ${manifestBlock.message} (${manifestBlock.context.root})`);
        return {
            ...emptyDeployResult(),
            projectName: manifestBlock.context.manifest.projectName,
            failedPhase: 'AUTO_GATE',
            failedCommand: 'Controller project manifest gate',
            failedStatusMessage: manifestBlock.message,
        };
    }

    // ① 멱등 검사 — 같은 키의 배포가 이미 돌고 있으면 두 번째를 만들지 않는다(§10).
    //    브리지 타임아웃 뒤의 재시도가 중복 배포가 되던 경로를 여기서 끊는다.
    if (options.idempotencyKey) {
        const existing = findActiveByIdempotencyKey(options.idempotencyKey);
        if (existing) {
            output.appendLine(`[Op] 같은 요청이 진행 중이라 새 배포를 시작하지 않습니다 — ${existing.operationId} (${existing.phase})`);
            return makeInProgressResult(existing);
        }
    }

    // ② 대기열 + 잠금. 작업 기록을 먼저 만들어 두어야 QUEUED 상태와 잠금 레코드의 operationId를 남길 수 있다.
    const operation = beginOperation({
        type: defaultOperationType(options),
        controllerId: cfg.ip,
        extensionInstanceId: options.extensionInstanceId,
        projectDir: options.projectDir,
        idempotencyKey: options.idempotencyKey,
        requestId: options.requestId,
		phase: 'QUEUE_WAIT',
		queued: true,
    });
    // operationId는 매 작업마다 유일하지만 외부 주입/비정상 종료 잔재까지 방어한다.
    // 잠금에 id를 공개하기 전에만 지운다 — 이후 생긴 파일은 실제 사용자 취소다.
    clearDeployCancellation(operation.operationId);
    const quiet = !!options.autoGate;
    const ticket = deployQueue.enqueue(cfg.ip, async () => {
        let lastHolderKey = '';
        let acquired: ReturnType<ReturnType<typeof getDeployLock>['acquire']>;
        while (true) {
            const queuedCancellation = readDeployCancellation(operation.operationId);
            if (token?.isCancellationRequested || queuedCancellation.requested) {
                const cancelled = emptyDeployResult();
                cancelled.operationId = operation.operationId;
                cancelled.cancelled = true;
                cancelled.failedPhase = 'CANCELLED';
                cancelled.cancellationReason = queuedCancellation.request?.reason ?? '배포 대기 중 사용자가 취소했습니다.';
                cancelled.failedStatusMessage = cancelled.cancellationReason;
                operation.cancel(cancelled.failedStatusMessage);
                return cancelled;
            }
            acquired = getDeployLock(cfg.ip).acquire(owner, 'PREPARE', {
                operationId: operation.operationId,
                extensionInstanceId: options.extensionInstanceId,
                projectDir: options.projectDir,
            });
            if (acquired.ok) { break; }
            operation.heartbeat();
            const holder = describeDeployLock(acquired.holder);
            const holderKey = [
                acquired.holder.operationId ?? '',
                acquired.holder.pid,
                acquired.holder.since,
                acquired.holder.stage,
            ].join('|');
            if (!quiet && holderKey !== lastHolderKey) {
                output.appendLine(`[Queue] 앞 작업 완료 대기 — ${holder}${acquired.local ? ' (이 창)' : ' (다른 창/프로세스)'}`);
                lastHolderKey = holderKey;
            }
            await new Promise(resolve => setTimeout(resolve, DEPLOY_LOCK_RETRY_MS));
        }

		operation.start('PREPARE');
		const startedAt = Date.now();
		if (!quiet) { output.appendLine(`[Lock] 배포 잠금 획득: ${owner} (pid ${process.pid}, ${operation.operationId})`); }
		let result: DeployResult | undefined;
		// 한 배포 = 메모리 경고 알림 최대 1회(업로드 전 검사 + Start -compile 큐 검사가 둘 다 띄우지 않게).
		const closeMemoryNoticeScope = beginMemoryNoticeScope(cfg.ip);
		try {
			result = await deployLocked(options, output, diagnosticCollection, token, cfg,
				withOperationPhase(acquired.handle, operation), operation.operationId);
			result.operationId = operation.operationId;
			return result;
		} finally {
			closeMemoryNoticeScope();
			acquired.handle.release();
			// ③ 결과를 남긴다 — 잠금은 사라져도 기록은 남아야 타임아웃 뒤에 결과를 되찾을 수 있다(§18 "Result Persist").
			finishOperation(operation, result);
			sweepOperations();
			if (!quiet) { output.appendLine(`[Lock] 배포 잠금 해제: ${owner} (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`); }
		}
	});
	if (!quiet && ticket.ahead > 0) {
		output.appendLine(`[Queue] 대기 작업 등록: ${owner} — 앞에 ${ticket.ahead}건 (${operation.operationId})`);
	}
	try {
		return await ticket.result;
	} finally {
		clearDeployCancellation(operation.operationId);
	}
}

/** 배포 결과를 작업 기록에 확정한다. 예외로 빠져나간 경우(result 없음)도 FAILED 로 닫는다. */
function finishOperation(operation: OperationHandle, result: DeployResult | undefined): void {
    if (operation.finished) { return; }
    if (!result) {
        operation.fail({
            code: 'OPERATION_FAILED',
            message: '배포가 예외로 중단됐습니다(결과 없음).',
            retryable: true,
            retryMode: 'CHECK_OPERATION',
            safeToRepeat: false,
        });
        return;
    }
    const summary: Record<string, unknown> = {
        success: result.success,
        projectName: result.projectName,
        compileErrorCount: result.compileErrors.length,
        ...(result.memoryPrecheck ? { memoryPrecheck: result.memoryPrecheck } : {}),
        ...(result.memoryRecovery ? { memoryRecovery: result.memoryRecovery } : {}),
        ...(result.uploadStats ? { uploadStats: result.uploadStats } : {}),
        ...(result.selectedRemoteProjectPath ? { remoteProjectPath: result.selectedRemoteProjectPath } : {}),
        ...(result.compiledSnapshotFiles === undefined ? {} : { compiledSnapshotFiles: result.compiledSnapshotFiles }),
        // 어느 장치에 올렸는지의 근거 — operation 파일만으로 "그때 진짜 제어기였나" 를 판정할 수 있게.
        ...(result.controllerCheck ? { controllerCheck: result.controllerCheck } : {}),
        ...(result.rebootHint ? { rebootHint: result.rebootHint } : {}),
        // 확장이 보낸 Compile 명령과 결과 — MCP 세션 로그의 "1402 0회" 로 사라지던 것(사고 조사용).
        ...(result.compileAttemptLogs.length > 0
            ? { compileCommands: result.compileAttemptLogs.map(a => summarizeCompileCommand(a, result.compileAborted)) }
            : {}),
        ...(result.compileAborted ? { compileAborted: result.compileAborted } : {}),
        ...(result.controllerHealth ? { controllerHealth: result.controllerHealth } : {}),
        // 증적을 기록에 함께 남긴다 — 타임아웃 뒤 결과 조회에서도 "올린 것이 내 소스인가"를 알 수 있게(§12).
        ...(result.provenance ? {
            provenance: {
                inSync: result.provenance.inSync,
                localRevision: result.provenance.localRevision,
                uploadedRevision: result.provenance.uploadedRevision,
                changedSinceUpload: result.provenance.changedSinceUpload,
                notUploaded: result.provenance.notUploaded,
                fileCount: result.provenance.fileCount,
                verifiedBy: result.provenance.verifiedBy,
            },
        } : {}),
    };
    if (result.projectName) { operation.describeTarget({ projectName: result.projectName }); }
    if (result.cancelled) {
        operation.cancel(result.cancellationReason ?? result.failedStatusMessage ?? '배포 취소', summary);
        return;
    }
    if (result.success) {
        operation.complete(summary);
        return;
    }
    // -744(*Invalid start procedure*) = ProjectStart 없는 그룹을 Start 했다. 되풀이하면 그룹 Compile 만 또 일어난다(2026-10-23).
    if (isNotRunnableStartFailure(result.failedPhase, result.failedStatusCode)) {
        operation.fail({
            code: 'DEPLOY_START',
            message: `${result.failedStatusMessage ?? 'Start 실패'} — 실행 가능한 프로젝트(.gpr 에 ProjectStart)를 지정하세요. 같은 요청을 되풀이하지 마세요.`,
            retryable: false,
            retryMode: 'RESOLVE_PROJECT',
            safeToRepeat: false,
        }, summary);
        return;
    }
    if (result.failedPhase === 'CONTROLLER_CHECK') {
        // 정체 확인 실패 — 아무것도 올리지 않았다(sent:false). 같은 요청을 되풀이해도 원인이 풀리기 전에는 같은 결과다.
        operation.fail({
            code: 'CONTROLLER_UNVERIFIED',
            message: result.failedStatusMessage ?? '제어기 정체를 확인하지 못해 업로드하지 않았습니다.',
            retryable: false,
            retryMode: 'NONE',
            safeToRepeat: true,
        }, { ...summary, sent: false, reasons: result.controllerCheck?.reasons ?? [] });
        return;
    }
    if (result.compileAborted) {
        // 컴파일 에러가 아니라 연결 끊김 — 같은 Compile 을 되풀이하지 말고 제어기 생존부터 확인한다.
        operation.fail({
            code: 'COMPILE_ABORTED',
            message: result.failedStatusMessage ?? `${result.compileAborted.command} 가 ${result.compileAborted.reason} 로 끊겼습니다.`,
            retryable: false,
            retryMode: 'CHECK_OPERATION',
            safeToRepeat: false,
        }, summary);
        return;
    }
    operation.fail({
        code: result.failedPhase ? `DEPLOY_${result.failedPhase}` : 'OPERATION_FAILED',
        message: result.failedStatusMessage ?? `배포가 ${result.failedPhase ?? '알 수 없는 단계'} 에서 중단됐습니다.`,
        retryable: result.failedPhase !== 'COMPILE',
        retryMode: result.failedPhase === 'COMPILE' ? 'NONE' : 'RETRY_SAME_REQUEST',
        // 업로드/Compile 은 제어기 상태를 바꾼다 — 같은 요청을 그대로 되풀이해도 되는지는 단계에 달렸다.
        safeToRepeat: result.failedPhase === 'LOCKED' || result.failedPhase === 'AUTO_GATE' || result.failedPhase === 'IN_PROGRESS',
    }, summary);
}

/**
 * 잠금 안의 배포 본문 — 단계 모듈을 순서대로 부른다. 각 단계는 실패·취소·보류 시 `ctx.result` 를 채우고 "계속 불가"를
 * 돌려주므로 여기서는 같은 결과 참조를 그대로 반환한다(`deploy` 가 `operationId` 를 덧붙인다).
 */
async function deployLocked(
    options: DeployOptions,
    output: vscode.OutputChannel,
    diagnosticCollection: vscode.DiagnosticCollection,
    token: vscode.CancellationToken | undefined,
    cfg: ControllerConfig,
    lock: DeployLockHandle,
    operationId: string,
): Promise<DeployResult> {
    const host: DeployHostIo = {
        appendLine: line => output.appendLine(line),
        clearDiagnostics: () => diagnosticCollection.clear(),
        applyCompileDiagnostics: errors => applyCompileDiagnostics(errors, options.projectDir, diagnosticCollection),
        readSourceExtensionsSetting: () => vscode.workspace.getConfiguration('gpl').get<unknown>('project.sourceExtensions'),
        readRequireStartConfirmation: () => vscode.workspace.getConfiguration('gpl').get<boolean>('controller.requireStartConfirmation', true),
        confirmStart: async projectName => {
            const pick = await vscode.window.showWarningMessage(
                `'${projectName}' 프로그램을 시작합니다. 로봇이 움직일 수 있습니다.`,
                { modal: true },
                'Start'
            );
            return pick === 'Start';
        },
        emitUploadEvent: event => _onDidUploadProgress.fire(event),
    };
    const ctx = createDeployContext({ options, cfg, lock, operationId, token, host, io: controllerIo });
    const { result } = ctx;

    if (ctx.isCancelled()) { return ctx.cancelResult('PREPARE'); }

    if (!options.autoGate) {
        // autoOnSave 게이트 경로는 저장마다 실행된다 — 출력 패널 포커스 강탈 금지,
        // 게이트 미충족 스킵 시 기존 컴파일 진단(빨간 줄)도 지우지 않는다(UPLOAD 진입 시 clear).
        output.show(true);
        diagnosticCollection.clear();
    }

    // ── 사전 검사(로컬) ── .gpr · Project.gpr 대조 · 프로젝트명
    const project = readProjectForDeploy(ctx);
    if (!project) { return result; }

    // ── 업로드 전 메모리 측정(경고만) — Upload Only 는 생략 ──
    if (!options.uploadOnly) {
        await checkMemoryBeforeUpload(ctx);
    }

    // ── 제어기 정체 확인 · /GPL 프로브 · 원격 경로 확정 · 헤더 ──
    const target = await resolveDeployTarget(ctx, project);
    if (!target) { return result; }
    traceDeployHeader(ctx, project, target);

    // ── Phase 1: UPLOAD ∥ STOP(정지 게이트) → 원격 전용 파일 삭제 → 증적 (Upload Only 는 여기서 끝) ──
    if (!(await runUploadAndStopPhase(ctx, project, target))) { return result; }

    // ── Phase 3: COMPILE (skipCompile 은 Unload/Load 동기화만) ──
    if (!(await runCompilePhase(ctx, project, target))) { return result; }

    // ── Phase 4: START (skipStart 면 생략) ──
    if (!(await runStartPhase(ctx))) { return result; }

    // ── Phase: ERROR CHECK + 요약 ──
    await runErrorCheckPhase(ctx);
    return result;
}

/**
 * 컴파일 에러를 VS Code Diagnostic으로 변환.
 */
/**
 * 컴파일 에러를 Problems 패널 진단으로 표시한다.
 *
 * 종전에는 배포 경로만 이것을 불렀고 FTP Run 은 토스트 한 줄로 끝나서, **같은 컴파일 에러가 어느 버튼으로
 * 했느냐에 따라 다르게 보였다**(§1-DE). 이제 두 경로가 함께 쓴다 — 그래서 export 한다.
 */
export function applyCompileDiagnostics(
    errors: CompileError[],
    projectDir: string,
    collection: vscode.DiagnosticCollection
): void {
    // 그 줄의 소스를 보고 원인 안내를 붙인다(-741 선언 줄·-722 `New X()`·-737 등). 자동화 결과의 compileErrors 도 같은 값을 쓴다.
    attachCompileErrorHints(errors, createCompileSourceLineReader(projectDir));

    // fsPath 문자열을 키로 사용해 동일 파일의 진단을 묶는다.
    // (Uri.toString() ↔ Uri.parse() 왕복 인코딩으로 인한 경로 불일치를 피하기 위해 Uri를 직접 보관한다.)
    const byFile = new Map<string, { uri: vscode.Uri; diags: vscode.Diagnostic[] }>();

    for (const err of errors) {
        const filePath = resolveErrorFilePath(err.file, projectDir);
        const uri = vscode.Uri.file(filePath);
        const key = uri.fsPath;
        if (!byFile.has(key)) {
            byFile.set(key, { uri, diags: [] });
        }

        const line = Math.max(0, err.line - 1);
        const range = new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER);
        const message = err.hint ? `${err.message}\n힌트: ${err.hint}` : err.message;
        const diag = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
        diag.source = 'GPL Compiler';
        diag.code = err.code;
        byFile.get(key)!.diags.push(diag);
    }

    for (const { uri, diags } of byFile.values()) {
        collection.set(uri, diags);
    }
}

/**
 * 첫 번째 컴파일 에러 위치로 포커스·커서를 이동하고 Problems 패널을 표시한다.
 * (수동 Deploy/Quick Compile과 디버그 F5 배포 경로 공통 UX.
 *  설정 gpl.deploy.jumpToFirstError로 토글, 기본 켜짐.)
 *
 * 반환값은 **패널을 Problems 로 전환했는지**다. 호출측은 이 값이 true 면 출력 채널을
 * `show()` 하지 않아야 한다 — 그러지 않으면 나중에 도착한 출력 패널 표시가 Problems 를
 * 덮어써서, 에러 줄로 점프해 놓고도 패널은 출력으로 되돌아간다(§1-DH).
 *
 * `preserveFocus` 면 키보드 포커스를 옮기지 않는다 — 에러 줄을 편집기에 보여 주기만 하고 Problems 패널 전환도
 * 하지 않는다(그 명령이 포커스를 가져가므로). AI(자동화) 배포가 쓴다: 사용자가 채팅에 입력하는 중에 포커스를
 * 편집기로 가져가 입력이 소스에 섞인 사례가 있었다(2026-10-21 Sample Prep, `Addre축 ssOf`).
 */
export async function jumpToFirstCompileError(
    errors: CompileError[],
    projectDir: string,
    logError: (message: string) => void,
    options?: { preserveFocus?: boolean },
): Promise<boolean> {
    if (errors.length === 0) { return false; }
    const jumpEnabled = vscode.workspace
        .getConfiguration('gpl')
        .get<boolean>('deploy.jumpToFirstError', true);
    if (!jumpEnabled) { return false; }

    const first = errors[0];
    const preserveFocus = options?.preserveFocus === true;
    // Problems 패널 명령은 키보드 포커스를 패널로 가져가므로 편집기 점프보다
    // 먼저 실행해야 최종 포커스·커서가 에러 줄의 편집기에 남는다.
    if (!preserveFocus) {
        await vscode.commands.executeCommand('workbench.actions.view.problems');
    }
    try {
        const filePath = resolveErrorFilePath(first.file, projectDir);
        const doc = await vscode.workspace.openTextDocument(filePath);
        const editor = await vscode.window.showTextDocument(doc, { preview: false, preserveFocus });
        const lineIdx = Math.min(Math.max(0, first.line - 1), doc.lineCount - 1);
        const lineInfo = doc.lineAt(lineIdx);
        // 컴파일러는 파일:줄만 보고하므로(컬럼 없음) 들여쓰기 뒤 첫 문자에 커서를 둔다.
        const cursor = new vscode.Position(lineIdx, lineInfo.firstNonWhitespaceCharacterIndex);
        editor.selection = new vscode.Selection(cursor, cursor);
        editor.revealRange(lineInfo.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    } catch (jumpErr: any) {
        logError(`첫 에러 파일 열기 실패: ${jumpErr?.message ?? jumpErr}`);
    }
    // 편집기 점프가 실패해도 Problems 패널 전환은 이미 일어났으므로 true 다(preserveFocus 면 전환하지 않았다).
    return !preserveFocus;
}

/**
 * 워크스페이스에서 프로젝트 폴더 자동 감지.
 * .gpr 파일이 있는 폴더를 찾아 반환한다.
 */
export async function findProjectDirs(): Promise<string[]> {
    // 제외 목록은 심볼 인덱싱·참조 검색과 같은 단일 출처를 쓴다(PROJECT_EXCLUDE_GLOB) —
    // 여기만 따로 두면 어떤 기능은 보고 어떤 기능은 못 보는 프로젝트가 생긴다.
    const gprFiles = await vscode.workspace.findFiles('**/*.gpr', PROJECT_EXCLUDE_GLOB);

    // 동일 폴더 내 여러 .gpr가 있어도 폴더는 중복 없이 반환한다. FTP로 내려받은 프로젝트는 manifest 루트가
    // 배포 단위이므로, Lib/Lib_Core/Log/Project.gpr 같은 내부 컴파일 단위를 별도 /GPL/Lib_Log로 오해하지 않는다.
    return collapseControllerProjectDirs(gprFiles.map(uri => path.dirname(uri.fsPath)));
}
