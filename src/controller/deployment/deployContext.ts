/**
 * 배포 파이프라인의 단계들이 공유하는 컨텍스트 — 결과 객체·트레이스·취소 판정·제어기 IO 어댑터를 한 객체로 묶는다.
 * 2026-10-27 `deployService.ts` 의 `deployLocked`(단일 1,260줄 함수)를 단계 모듈로 나누면서, 클로저 변수로 공유하던 상태를
 * 여기 명시적 필드로 옮겼다. vscode 는 import 하지 않는다 — Output·Problems·설정·모달 같은 VS Code 쪽 호출은
 * 오케스트레이터(`deployService`)가 `DeployHostIo` 로 넘긴다.
 *
 * 단계 순서(오케스트레이터가 부른다): `deployPrecheck` → `deployTargetStage` → `deployUploadStage`(∥ `deployStopStage`)
 * → `deployCompileStage` → `deployStartStage` → `deployErrorCheckStage`. 각 단계는 실패·취소 시 `ctx.result` 를 채우고
 * 「계속할 수 없음」을 돌려준다 — 결과 객체는 하나뿐이고 모든 반환이 같은 참조다.
 */

import type * as controllerConnection from '../connection/controllerConnection';
import type { ControllerConfig } from '../connection/controllerConnection';
import type * as controllerIdentityIo from '../connection/controllerIdentityIo';
import { STOP_ALL_CMD } from '../threads/threadStop';
import type { ThreadStopIo, ThreadStopOptions } from '../threads/threadStop';
import type { ProjectCommandIo } from '../commands/projectCommands';
import type { CompileError } from '../protocol/responseParser';
import { readDeployCancellation } from './deployCancellation';
import type { DeployLockHandle } from './deployLock';
import type { CompiledRecord, FileStamp } from './deployRecordCore';
import { emptyDeployResult } from './deployTypes';
import type { DeployOptions, DeployResult, DeployUploadEvent } from './deployTypes';
import { totalPhasesFor } from './deployModes';

/** `vscode.CancellationToken` 의 구조적 부분집합 — 순수 모듈이 vscode 타입에 묶이지 않게. */
export interface DeployCancellationSignal {
    readonly isCancellationRequested: boolean;
}

/**
 * 제어기 쪽 IO — `controllerConnection`(명령 콘솔 직렬 큐·메모리 검사·채널 유실 기록)과 `deployRecord`(컴파일 스냅샷 Memento)는
 * vscode 에 묶여 있어 단계 모듈이 직접 import 하면 Node 단독 테스트가 불가능해진다. 오케스트레이터가 실물을 꽂는다.
 * (FTP 는 `ftpClient` 가 순수 Node 라 단계가 직접 부른다.)
 */
export interface DeployControllerIo {
    sendCommandDetailed: typeof controllerConnection.sendCommandDetailed;
    trySendCommand: typeof controllerConnection.trySendCommand;
    probeControllerCommand: typeof controllerConnection.probeControllerCommand;
    checkMemoryBeforeOperation: typeof controllerConnection.checkMemoryBeforeOperation;
    getLastMemoryCheck: typeof controllerConnection.getLastMemoryCheck;
    getLastCommandChannelLoss: typeof controllerConnection.getLastCommandChannelLoss;
    /** 이 확장이 `/GPL` 을 일부러 비운 마지막 시각(재부팅 정황 오탐 방지). */
    getLastGplClear: typeof controllerConnection.getLastGplClear;
    createIdentityIo: typeof controllerIdentityIo.createControllerIdentityIo;
    recentReachabilityEvidence: typeof controllerIdentityIo.recentReachabilityEvidence;
    /** 컴파일 스냅샷 기록(deployRecord.recordCompiled, GitHub #21). */
    recordCompiled: (rec: CompiledRecord) => void;
}

/**
 * VS Code 쪽 호출을 오케스트레이터가 주입한다. 단계 모듈은 이 인터페이스만 본다.
 * (Output 패널 `show` 와 진입 시 진단 clear 는 단계 전에 오케스트레이터가 직접 한다.)
 */
export interface DeployHostIo {
    /** Output 채널 한 줄(트레이스는 `pushTrace` 가 결과 trace 와 함께 여기로 보낸다). */
    appendLine(line: string): void;
    /** gpl-deploy 진단 전체 삭제(`DiagnosticCollection.clear`). */
    clearDiagnostics(): void;
    /** 컴파일 에러를 Problems 진단으로 표시(`applyCompileDiagnostics`). */
    applyCompileDiagnostics(errors: CompileError[]): void;
    /** 설정 `gpl.project.sourceExtensions` 원값(Project.gpr ↔ 폴더 대조용). */
    readSourceExtensionsSetting(): unknown;
    /** 설정 `gpl.controller.requireStartConfirmation`(기본 true). */
    readRequireStartConfirmation(): boolean;
    /** Start 모션 확인 모달 — 사용자가 'Start' 를 골랐으면 true. */
    confirmStart(projectName: string): Promise<boolean>;
    /** 업로드 진행/종료 이벤트(`onDidUploadProgress` 구독자에게). */
    emitUploadEvent(event: DeployUploadEvent): void;
}

export interface DeployContext {
    readonly options: DeployOptions;
    readonly cfg: ControllerConfig;
    /** 배포 잠금 핸들(작업 기록 phase 가 함께 움직이는 래퍼). 단계 라벨 갱신·heartbeat 에 쓴다. */
    readonly lock: DeployLockHandle;
    readonly operationId: string;
    /** 이 작업의 시작 — 이후에 받은 STATUS·FTP 배너만 "같은 작업 안의 확인" 으로 재사용한다. */
    readonly operationStartedAt: number;
    readonly host: DeployHostIo;
    readonly io: DeployControllerIo;
    /** 유일한 결과 객체 — 모든 단계가 이 참조를 채우고, 모든 반환이 이것이다. */
    readonly result: DeployResult;
    /** 트레이스 헤더 `[n/N]` 의 N(옵션에서 확정). */
    readonly totalPhases: number;
    /** 트레이스 헤더 `[n/N]` 의 n — 단계가 헤더를 찍기 직전에 올린다. */
    phase: number;

    /** 결과 trace 와 Output 채널에 같은 줄을 남긴다. */
    pushTrace(line: string): void;
    /** VS Code 토큰 또는 프로세스 간 취소 파일(deployCancellation.ts)의 상태. */
    cancellationStatus(): { requested: boolean; reason?: string };
    isCancelled(): boolean;
    /** 취소 결과로 확정(멱등) — failedPhase 'CANCELLED', 잠금 단계 CANCELLED, 트레이스 한 줄. 반환은 `result` 그 참조. */
    cancelResult(where: string): DeployResult;
    sleep(ms: number): Promise<void>;
    /** 응답 원문 한 줄 미리보기(260자, `…`) — projectCommands.rawPreview 와는 말줄임 문자가 다르다(트레이스 호환 유지). */
    rawPreview(raw: string): string;

    /** 쓰레드 정지 절차(threadStop.ts)에 주입하는 전송·로그·대기. Stop·settle·pre-Start 게이트·Start 뒤 감시가 공유. */
    readonly threadStopIo: ThreadStopIo;
    /** 배포 트레이스는 모든 줄이 `│ ` 로 시작한다. */
    readonly threadStopOpts: ThreadStopOptions;
    /** Compile/Load/Unload/Start 절차(projectCommands.ts)에 주입하는 전송·로그. */
    readonly projectIo: ProjectCommandIo;

    /** 업로드 *직전*의 로컬 스냅샷(GitHub #21) — 컴파일 성공 뒤 기록에 쓴다. 업로드 단계가 채운다. */
    preUploadSnapshot?: Record<string, FileStamp>;
    /** Compile 이 성공했는가(skipCompile 경로는 "통과"로 본다). 컴파일 단계가 정하고 ERROR CHECK 가 `success` 로 옮긴다. */
    compiled: boolean;
}

export interface DeployContextInput {
    options: DeployOptions;
    cfg: ControllerConfig;
    lock: DeployLockHandle;
    operationId: string;
    token: DeployCancellationSignal | undefined;
    host: DeployHostIo;
    io: DeployControllerIo;
}

export function createDeployContext(input: DeployContextInput): DeployContext {
    const { options, cfg, lock, operationId, token, host, io } = input;
    const result: DeployResult = emptyDeployResult();
    /** 이 작업의 시작 — 이후에 받은 STATUS·FTP 배너만 "같은 작업 안의 확인" 으로 재사용한다. */
    const operationStartedAt = Date.now();

    const pushTrace = (line: string) => {
        result.trace.push(line);
        host.appendLine(line);
    };

    const cancellationStatus = (): { requested: boolean; reason?: string } => {
        if (token?.isCancellationRequested) {
            return { requested: true, reason: 'VS Code에서 배포 취소 요청' };
        }
        const status = readDeployCancellation(operationId);
        if (!status.requested) { return { requested: false }; }
        return {
            requested: true,
            reason: status.request?.reason ?? '배포 취소 요청 파일이 확인됐습니다(내용 손상)',
        };
    };
    const isCancelled = (): boolean => cancellationStatus().requested;
    const cancelResult = (where: string): DeployResult => {
        if (!result.cancelled) {
            const status = cancellationStatus();
            result.cancelled = true;
            result.cancellationReason = status.reason ?? '배포 취소 요청';
            result.failedPhase = 'CANCELLED';
            result.failedCommand = where;
            result.failedStatusMessage = `${result.cancellationReason} — 이후 Compile/Start 미수행`;
            lock.setStage('CANCELLED');
            pushTrace(`│ ■ 배포 취소: ${result.cancellationReason} (${where}) — 이후 Compile/Start를 보내지 않습니다.`);
        }
        return result;
    };

    const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

    const rawPreview = (raw: string): string => {
        const compact = raw.replace(/\r/g, '').replace(/\n+/g, ' | ').trim();
        return compact.length > 260 ? `${compact.slice(0, 260)}…` : compact;
    };

    // ── 쓰레드 정지 절차 (controller/threads/threadStop.ts 가 정본) ─────────────
    // Stop -all 의 STATUS 0 은 "정지 요청 접수"이지 완전 정지 보장이 아니다(§0.6). 정지 완료 전에
    // Compile/Start 를 보내면 제어기 이상 현상(메모리 누수 의심, 2026-07-08 사용자 관찰)이 생길 수 있어
    // Show Thread 로 실제 상태를 확인한다. 전송+판정+폴링+재시도로 이뤄진 그 절차는 배포·패널·FTP·디버그가
    // 모두 같은 기준을 쓰도록 threadStop.ts 하나에 모아 뒀다(§1-DD) — 여기서는 전송·로그·대기만 주입한다.
    const threadStopIo: ThreadStopIo = {
        send: async (command) => {
            try {
                const resp = await io.sendCommandDetailed(command, cfg);
                // RAW 는 Stop 에만 남긴다 — 정지 확인 폴링까지 찍으면 트레이스가 같은 줄로 뒤덮인다.
                if (command === STOP_ALL_CMD) {
                    pushTrace(`│ RAW ${rawPreview(resp.raw) || '(empty)'}`);
                }
                // idle/close 로 잘린(STATUS 미수신) 응답은 "확인 불가"로 처리한다(하드 규칙 2).
                return { raw: resp.raw, statusComplete: resp.meta.statusTagReceived };
            } catch {
                return null;
            }
        },
        log: line => pushTrace(line),
        sleep,
        isCancelled,
    };
    // 배포 트레이스는 모든 줄이 `│ ` 로 시작한다.
    const threadStopOpts: ThreadStopOptions = { logPrefix: '│ ' };

    // Compile/Load/Unload/Start 절차는 controller/commands/projectCommands.ts 가 정본이다(§1-DE).
    // 여기서는 전송(1402)과 트레이스 목적지만 물린다 — 판정 규칙(성공 조건·일시적 STATUS 재시도·
    // 로드 상태 구분·HTTP 응답 감지)을 이 파일과 FTP 경로가 따로 갖고 있던 것이 차이의 원인이었다.
    const projectIo: ProjectCommandIo = {
        send: async (command, sendOpts) => {
            // 단계 검사와 실제 전송 사이에 Stop -all이 들어온 경우까지 닫는다.
            if (isCancelled()) { throw new Error('DEPLOY_CANCELLED_BEFORE_CONTROLLER_COMMAND'); }
            const detailed = await io.sendCommandDetailed(command, cfg, sendOpts?.forCompile
                // 컴파일은 pass 사이에 수 초간 침묵한다. idle 로 조기 완료하면 응답이 잘려 STATUS/에러
                // 라인을 놓치고 거짓 성공이 난다(GDE 는 종결자까지 받는다) — 반드시 </STATUS> 까지 대기.
                ? { waitForStatusClose: true, timeoutMs: Math.max(cfg.timeoutMs, 60000) }
                : undefined);
            return { raw: detailed.raw, meta: detailed.meta };
        },
        log: line => pushTrace(`│ ${line}`),
    };

    return {
        options,
        cfg,
        lock,
        operationId,
        operationStartedAt,
        host,
        io,
        result,
        totalPhases: totalPhasesFor(options),
        phase: 0,
        pushTrace,
        cancellationStatus,
        isCancelled,
        cancelResult,
        sleep,
        rawPreview,
        threadStopIo,
        threadStopOpts,
        projectIo,
        preUploadSnapshot: undefined,
        compiled: false,
    };
}
