/**
 * 배포 파이프라인의 공개 타입 — 옵션(`DeployOptions`)·결과(`DeployResult`)·단계 분류(`DeployPhase`)·업로드 이벤트.
 * 2026-10-27 `deployService.ts` 에서 분리(단계 모듈들이 오케스트레이터를 import 하지 않고 타입만 공유하도록).
 * 호출측은 종전대로 `deployService` 에서 re-export 된 이름을 쓴다.
 */

import type { CommandResponseMeta } from '../connection/controllerConnection';
import type { PostStartRuntimeError, PostStartWatchOutcome } from '../threads/postStartWatch';
import type { CompileError } from '../protocol/responseParser';
import type { DeployLockRecord } from './deployLock';
import type { OperationRecord } from '../automation/operationStore';
import type { ProvenanceReport } from './deployProvenance';
import type { UploadProgressEvent, UploadSummary } from './uploadProgress';
import type { MemoryPrecheck } from '../diagnostics/memoryGuard';
import type { ControllerCheckRecord } from '../connection/controllerIdentity';
import type { CompileAborted, ControllerLiveness } from './compileAbort';

/**
 * 배포 파이프라인의 업로드 진행 알림(§1-EE). 배포가 어느 경로(명령·F5·autoOnSave·MCP)로 시작됐든 같은 이벤트가 나가므로
 * 표시(상태바 진행 바)는 접착 계층이 한 번만 구독한다 — 호출부마다 콜백을 꿰지 않는다(`deployRecord.onDidRecordCompiled` 와
 * 같은 꼴). `end` 는 업로드 단계의 성패만 말한다(이후 Compile/Start 는 별개).
 */
export type DeployUploadEvent =
    | { kind: 'progress'; projectName: string; remoteDir: string; progress: UploadProgressEvent }
    | { kind: 'end'; projectName: string; remoteDir: string; ok: true; summary: UploadSummary }
    | { kind: 'end'; projectName: string; remoteDir: string; ok: false; message: string };

export interface DeployOptions {
    projectDir: string;
    skipUnchanged?: boolean;
    skipStart?: boolean;
    skipStop?: boolean;
	/**
	 * `/GPL`에 소스만 업로드하고 Stop/Show Thread/Compile/Start를 모두 생략한다.
	 * 실행 중 FTP 업로드는 허용하되 원격 전용 파일 삭제는 안전성이 확인되지 않아 보류한다.
	 * 업로드 동안에는 배포 잠금을 유지하므로 다른 Compile/Start가 겹치지 않는다.
	 */
	uploadOnly?: boolean;
    /**
     * COMPILE 단계(Compile 명령)를 생략한다 — '업로드 스타트'(gpl.uploadStart) 경로.
     * 확장이 보내는 `Start`에는 `-compile`이 붙어 컴파일까지 수행하므로(§1-DN, ai-handoff §0.7)
     * 확장이 `Compile`을 먼저 보내면 같은 컴파일을 두 번 하게 된다. 업로드 직후 곧바로 Start를 보내
     * 컴파일은 Start의 `-compile`에 맡긴다. 클래식(비 direct) 경로의 Unload/Load 동기화는 그대로 수행한다 —
     * Start 하려면 제어기에 프로젝트가 로드돼 있어야 하기 때문이다.
     * Start의 `-compile` 응답도 파싱해 소스 에러를 Problems(진단)에 표시한다(§1-EW).
     * 에러 위치를 보려면 `gpl.quickCompile`(빠른 컴파일)로 따로 확인한다.
     * 소스만 올리는 경로에는 skipStart 조합 대신 의미가 분명한 uploadOnly를 사용한다.
     */
    skipCompile?: boolean;
    /**
     * `ProjectLibrary` 가 가리키는 라이브러리 중 컴파일 루트 밖·같은 projects 폴더 안의 것을 `/GPL/<값>` 으로 함께 올린다
     * (규칙: libraryUploadPlan.ts). direct `/GPL` 모드·전체 업로드에서만 — autoOnSave(changedFiles)는 제외.
     * 설정 `gpl.deploy.uploadLibraries` 를 호출측(runDeploy)이 넘긴다. 생략하면 끔(종전 동작).
     */
    uploadLibraries?: boolean;
    /**
     * 지정 시 이 파일들(로컬 절대경로)만 업로드한다. 저장 파일만 올리는 빠른 컴파일 경로에서 사용.
     * projectDir 하위 파일만 대상이 되며, 변경을 확신하는 것으로 보고 크기 비교 없이 업로드한다.
     * 업로드 후 Compile은 평소대로 프로젝트 전체를 대상으로 수행된다.
     */
    changedFiles?: string[];
    /**
     * 직접 /GPL 업로드 모드 (Deploy/Quick Compile/디버그 F5 공통 기본 경로).
     * Load 문서 Remarks("an external file-copy utility such as FTP can be used to create
     * the folder and copy the files")에 따라 /GPL/<projectName>에 FTP로 직접 파일을 써서
     * Unload(-750 쓰레드 락)와 Load("대상 폴더가 이미 존재하면 안 됨") 제약을 모두 우회한다.
     * /GPL/<projectName> 폴더가 원격에 없으면 FTP로 생성해 직접 업로드한다(최초 배포).
     * 단, changedFiles 지정 경로(autoOnSave)에서는 불완전한 폴더 생성을 막기 위해
     * 기존(flash 업로드 + Unload/Load) 경로로 폴백한다. flash 저장은 Save to Flash가 담당.
     */
    directGpl?: boolean;
    /**
     * 빠른 컴파일(skipStop)에서 활성 쓰레드 감지 시 호출된다.
     * true를 반환하면 Stop -all + 정지 완료 확인을 거쳐 계속 진행하고,
     * false 반환 또는 미지정이면 THREAD_CHECK로 중단한다.
     * (autoOnSave처럼 사용자 개입이 부적절한 경로에서는 지정하지 않는다.)
     */
    confirmStopOnActive?: (activeThreadsDesc: string) => Promise<boolean> | boolean;
    /**
     * FTP 쓰기 전 제어기 정체 확인(controller/connection/controllerIdentity.ts)이 실패했을 때 사람에게 묻는다.
     * true 를 돌려주면 「그래도 진행」 — 확인 결과에 overridden 을 남기고 업로드한다. 미지정(AI·자동화·autoOnSave)이면
     * 묻지 않고 failedPhase 'CONTROLLER_CHECK'(작업 기록 error.code CONTROLLER_UNVERIFIED)로 멈춘다 — 모달은 브리지를 막는다.
     */
    confirmUnverifiedController?: (check: ControllerCheckRecord) => Promise<boolean> | boolean;
    /**
     * 정지 뒤 Compile/Start 직전 여유 메모리가 **심각**(criticalMb 미만)일 때 사람에게 계속/취소를 묻는다(2026-10-27 사용자 요청).
     * true 면 계속, false 면 failedPhase 'MEMORY_CHECK'(업로드는 완료, Compile/Start 미전송). 미지정(AI·자동화·autoOnSave)이면
     * 묻지 않고 경고만 남기고 계속한다 — 모달은 브리지를 막는다. 업로드 전 측정(실행 중 앱 메모리 포함)으로는 묻지 않는다.
     */
    confirmMemoryCritical?: (check: MemoryPrecheck, phase: 'compile' | 'start') => Promise<boolean> | boolean;
    /** 정체 확인을 할지(기본 true). 호출측이 설정 `gpl.controller.verifyControllerIdentity` 를 읽어 넘긴다. */
    verifyControllerIdentity?: boolean;
    /**
     * `Start` 에 `-event` 를 붙일지(기본 true — GDE 캡처와 동일하게 쓰레드 상태 변경을 1403 이벤트로 받는다).
     * false 면 `-noevent`. 호출측이 설정(`gpl.controller.startEventMode`)을 읽어 넘긴다.
     */
    startEventMode?: boolean;
    /** 자동화 호출자가 `confirmStart:true`로 사용자 확인을 이미 받았음. true면 배포 서비스의 중복 모달을 생략한다. */
    startConfirmed?: boolean;
    beforeStart?: () => Promise<void> | void;
    /**
     * Start 뒤 메인 쓰레드를 이 시간(ms) 동안 감시해 Error 로 멈추면 `runtimeError` 에 싣는다(§1-EU, postStartWatch.ts).
     * 0/미지정이면 감시하지 않는다. 호출측이 설정 `gpl.controller.postStartWatchMs` 를 읽어 넘긴다.
     */
    postStartWatchMs?: number;
    /**
     * autoOnSave 자동 게이트 (gpl.quickCompile.autoOnSave = "auto").
     * 1. /GPL/<projectName> 폴더가 원격에 이미 존재해야 업로드한다 (없어도 생성하지 않고 classic 폴백도 없음
     *    → failedPhase 'AUTO_GATE', 제어기를 건드리지 않음).
     * 2. Compile은 Show Thread 목록이 완전히 비어 있을 때만 — 정지 상태(Idle/Stopped/Error) 쓰레드도 없어야 한다.
     *    쓰레드가 있으면 업로드는 그대로 두고 Compile만 보류한다(failedPhase 'COMPILE_DEFERRED', 2026-08-25 재배치).
     *    호출측은 "컴파일 필요" 상태로 표시하고 팝업 없이 로그만 남긴다.
     * 확인 불가(프로브 무응답)도 미충족으로 취급한다 — 판단은 live 데이터로만(§0 하드 규칙).
     */
    autoGate?: boolean;
    /**
     * 배포 잠금 레코드의 owner 라벨(경고·MCP 거부 문구에 표시). 미지정 시 옵션에서 유추
     * ('autoOnSave Quick Compile' / 'Quick Compile' / 'Deploy').
     */
    lockOwner?: string;
    // ── 작업 기록(operationStore.ts, 개선안 §8~§11) ──────────────────────────
    /**
     * 이 배포에 붙일 작업 종류 라벨('DEPLOY'/'QUICK_COMPILE'/'UPLOAD_START'). 생략하면 옵션에서 유추한다.
     * 기록 자체는 항상 남긴다 — 사람이 UI 로 시작한 배포도 MCP 가 진행 상황을 읽을 수 있어야 하기 때문이다.
     */
    operationType?: string;
    /**
     * 같은 키로 들어온 요청은 **새 배포를 시작하지 않는다**(§10). 브리지 타임아웃 뒤의 재시도가 두 번째
     * 배포를 일으키는 것을 막는다. 진행 중인 같은 키의 작업이 있으면 failedPhase 'IN_PROGRESS' 로 돌아온다.
     */
    idempotencyKey?: string;
    /** 이 배포를 수행하는 확장 인스턴스(§4) — 기록·잠금 레코드에 남는다. */
    extensionInstanceId?: string;
    /** 이 배포를 일으킨 브리지 요청 id — 로그 상관용(§23). */
    requestId?: string;
}

/** 배포 단계/결과 분류. 실패 단계뿐 아니라 LOCKED·AUTO_GATE·COMPILE_DEFERRED 같은 "중단" 결과도 담는다. */
export type DeployPhase =
    | 'LOCKED'            // 배포 잠금을 다른 배포/창/프로세스가 보유 중 — 제어기를 건드리지 않음
    | 'IN_PROGRESS'       // 같은 idempotencyKey 의 배포가 이미 진행 중 — 새로 시작하지 않음(§10)
    | 'CANCELLED'         // 작업자 Stop -all/VS Code 취소 — 이후 Compile/Start 미전송
    | 'AUTO_GATE'         // autoOnSave: /GPL 폴더 없음 등으로 업로드 전 스킵
    | 'CONTROLLER_CHECK'  // FTP 쓰기 전 제어기 정체 확인 실패 — 업로드하지 않음(작업 기록 CONTROLLER_UNVERIFIED)
    | 'UPLOAD'
    | 'STOP'
    | 'THREAD_CHECK'      // 활성 쓰레드 + 사용자 미승인 → 업로드는 완료, Compile 미수행
    | 'MEMORY_CHECK'      // 정지 뒤 여유 메모리 심각 + 사용자 취소 → 업로드는 완료, Compile/Start 미전송(사람 경로만)
    | 'COMPILE_DEFERRED'  // autoOnSave: 업로드 완료, 쓰레드 존재로 Compile 보류
    | 'COMPILE'
    | 'START'
    | 'ERROR_CHECK';

export interface CompileAttemptLog {
    command: string;
    statusCode: number;
    raw: string;
    errors: CompileError[];
    responseMeta?: CommandResponseMeta;
    note?: string;
    /** 전송부터 응답(또는 끊김)까지(ms). */
    elapsedMs?: number;
}

export interface DeployResult {
    success: boolean;
    /** 작업자 전체 정지 또는 CancellationToken으로 중단됨. 일반 배포 실패와 구분한다. */
    cancelled?: boolean;
    cancellationReason?: string;
    projectName: string;
    compileErrors: CompileError[];
    compileAttemptLogs: CompileAttemptLog[];
    precheckWarnings: string[];
    /** Project.gpr 소스 목록이 폴더와 달랐다(2026-10-27) — 업로드한 목록 기준. 없으면 일치. */
    gprSyncMismatch?: { toAdd: string[]; toRemove: string[] };
    memoryPrecheck?: MemoryPrecheck;
    errorLog: string[];
    selectedRemoteBasePath?: string;
    selectedRemoteProjectPath?: string;
    candidateRemoteProjectPaths?: string[];
    uploadStats?: { uploaded: number; skipped: number; totalBytes: number; deleted?: number };
    /** 함께 올린 라이브러리(`uploadLibraries`) — 올린 순서. 실패하면 거기까지(실패한 것 제외). */
    libraryUploads?: { raw: string; localDir: string; remoteDir: string; uploaded: number; skipped: number }[];
    failedPhase?: DeployPhase;
    failedCommand?: string;
    failedStatusCode?: number;
    failedStatusMessage?: string;
    attemptedProjectNames?: string[];
    /** failedPhase === 'LOCKED'일 때 잠금 보유자(경고 문구용) */
    lockHolder?: DeployLockRecord;
    /**
     * 잠금 보유자가 **이 프로세스**인가(§7.3). 같은 창의 다른 배포와 다른 창/프로세스의 배포는 대응이 다르다 —
     * 전자는 내 코드가 겹쳐 부른 것이고 후자는 기다리면 풀린다.
     */
    lockHolderIsLocal?: boolean;
    /** 이 배포의 작업 기록 id(operationStore.ts). 타임아웃 뒤 결과 조회의 열쇠다(§8·§11). */
    operationId?: string;
    /**
     * 배포 증적(§12·§13) — "올린 것 == 지금 로컬 소스"인지의 대조 결과. 업로드까지 간 경로에서만 채워진다.
     * Compile 성공과는 **다른 질문**에 답한다: 방금 고친 파일이 실제로 올라갔는가.
     */
    provenance?: ProvenanceReport;
    /** failedPhase === 'IN_PROGRESS' 일 때 이미 진행 중인 작업(§10). */
    existingOperation?: OperationRecord;
    /**
     * Compile 성공 시 기록한 컴파일 스냅샷의 파일 수(GitHub #21, deployRecord.recordCompiled).
     * 기록에 실패했거나 컴파일까지 가지 못했으면 undefined. 배포 성공/실패 판정과는 무관한 보조 정보.
     */
    compiledSnapshotFiles?: number;
    /**
     * Start 뒤 감시 창 안에 메인 쓰레드가 Error 로 멈춘 사실(§1-EU). 업로드·컴파일·Start 자체는 성공했으므로
     * `success` 는 그대로 true 다 — 호출측이 경고로 보고하고 작업 기록에도 그대로 실린다.
     */
    runtimeError?: PostStartRuntimeError;
    /** Start 뒤 감시의 결과 종류와 소요(§1-EU). 감시하지 않았으면 undefined. */
    postStartWatch?: { outcome: PostStartWatchOutcome['kind']; elapsedMs: number };
    /**
     * FTP 쓰기 전 제어기 정체 확인 결과(controllerIdentity.ts) — 어느 장치에 올렸는지의 근거.
     * 작업 기록 `result.controllerCheck` 에도 그대로 남는다.
     */
    controllerCheck?: ControllerCheckRecord;
    /** `/GPL/<프로젝트>` 가 없고 직전에 채널 유실이 있었을 때의 재부팅 정황 안내(있을 때만). */
    rebootHint?: string;
    /** Compile 이 소켓 리셋으로 끊김(컴파일 에러와 구분) — compileAbort.ts. */
    compileAborted?: CompileAborted;
    /** compileAborted 뒤 짧은 생존 확인(`Show Thread -web`) 결과. */
    controllerHealth?: ControllerLiveness;
    trace: string[];
}

/** 아무 단계도 거치지 않은 빈 결과 — 잠금/멱등 거부·파이프라인 시작값의 공통 골격. */
export function emptyDeployResult(): DeployResult {
    return {
        success: false,
        projectName: '',
        compileErrors: [],
        compileAttemptLogs: [],
        precheckWarnings: [],
        errorLog: [],
        trace: [],
    };
}
