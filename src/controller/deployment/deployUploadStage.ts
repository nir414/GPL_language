/**
 * 배포 단계 3 — Phase 1: UPLOAD ∥ STOP(정지 게이트) 동시 진행, 그 뒤 지연된 원격 전용 파일 삭제·배포 증적 대조·Upload Only 완료.
 * 2026-10-27 `deployService.ts` 의 `deployLocked` 에서 분리. 정지 게이트 자체는 `deployStopStage.runStopGate`.
 *
 * 2026-08-25(이슈 #17 + 보충 코멘트): 목적은 속도. "쓰레드 실행 중 FTP 업로드"는 무해(사용자 관찰)하고, 업로드(FTP 21)와
 * Stop -all/정지 확인(1402)은 별 채널이라 동시에 진행해도 문제가 없다. Stop은 한 번에 안 멈추면 settle 폴링·재시도를
 * 반복하느라 오래 걸리므로 업로드와 겹쳐 총 소요를 max(업로드, 정지)로 줄인다.
 * 두 작업이 *모두* 끝난 뒤에만 다음(원격 전용 파일 삭제 → COMPILE)으로 간다 — "정지 확인 전 Compile/Start 금지"(§0.6)와
 * "업로드 도중 Compile/Start 금지"(배포 잠금)는 그대로다. 원격 전용 파일 삭제는 실행 중 무해가 미검증이라 정지 확인 뒤로 지연.
 *
 * 2026-09-10(§1-DL): 업로드 스타트 경로만 순차(STOP → UPLOAD)로 돌려 본 적이 있다 — "Stop 처리 중 FTP
 * 덮어쓰기"가 제어기 이상의 원인이라는 가설 때문이었는데, 실기기에서 그 순서로도(안전장치를 끈 조합
 * 포함) 재현되지 않아 가설을 기각하고 병행으로 되돌렸다. 순차는 총 소요를 늘리기만 했다.
 */

import * as path from 'path';
import { uploadProject, mirrorProject, removeRemoteFiles, isUploadCancelledError } from '../files/ftpClient';
import type { RemoteFileRef } from '../files/ftpClient';
import { getSyncManifest, mergeSyncManifest, recordSyncManifest } from '../files/syncManifest';
import { snapshotProjectFiles } from './deployRecordCore';
import { compareProvenance, describeProvenance } from './deployProvenance';
import type { UploadProgressEvent, UploadSummary } from './uploadProgress';
import type { DeployContext } from './deployContext';
import type { DeployProjectInfo } from './deployPrecheck';
import type { DeployTarget } from './deployTargetStage';
import { stopGateLabelFor, uploadLockStageFor } from './deployModes';
import { runStopGate } from './deployStopStage';

/** 업로드 작업의 결과 — 예외를 던지지 않고 돌려준다(Promise.all에서 다른 쪽을 끝까지 기다리기 위해). */
export type UploadOutcome = { ok: true; pendingDeletes: RemoteFileRef[] } | { ok: false; message: string };

/**
 * Direct /GPL 모드에서 changedFiles 제약이 없는 경우(수동 Quick Compile, 디버그 F5)는 미러 동기화한다:
 * 크기가 다르거나 새로 생긴 파일만 올리고, 로컬에 없는 원격 파일은 (정지 확인 뒤) 삭제한다.
 * Unload로 /GPL 폴더를 통째로 비우는 대신 파일 단위로 맞춰 왕복을 줄이고(속도),
 * 로컬에서 지운/이름 바꾼 파일이 원격에 남아 오컴파일되는 것도 막는다(정확성).
 * autoOnSave(useChangedOnly)는 저장 파일만 올리는 초경량 경로라 전체 목록 조회/삭제가 있는 미러를 쓰지 않는다.
 */
export function shouldMirrorUpload(directActive: boolean, useChangedOnly: boolean): boolean {
    return directActive && !useChangedOnly;
}

/** 미러 완료 줄의 원격 전용 파일 덧붙임(`, N remote-only (…)`). 없으면 빈 문자열. */
export function pendingDeleteNote(pendingCount: number, uploadOnly: boolean): string {
    return pendingCount > 0
        ? `, ${pendingCount} remote-only (${uploadOnly ? '삭제 보류' : '정지 확인 뒤 삭제'})`
        : '';
}

/** 게이트 중단·완료 줄에 붙는 "삭제 보류" 덧붙임. 없으면 빈 문자열. */
export function deferredDeleteNote(pendingCount: number): string {
    return pendingCount > 0 ? ` (원격 전용 파일 ${pendingCount}개 삭제는 보류)` : '';
}

/**
 * Phase 1 전체. true 면 Compile 로 계속, false 면 `ctx.result` 가 확정된 상태(실패·취소·보류 또는 Upload Only 성공).
 */
export async function runUploadAndStopPhase(ctx: DeployContext, project: DeployProjectInfo, target: DeployTarget): Promise<boolean> {
    const { options, cfg, lock, result, pushTrace, isCancelled, cancelResult, cancellationStatus, host } = ctx;
    const { projectName } = project;
    const { directActive, ftpProjectDir } = target;

    pushTrace('');
    ctx.phase++;
    const gateLabel = stopGateLabelFor(options);
	pushTrace(options.uploadOnly
		? `━━ [${ctx.phase}/${ctx.totalPhases}] UPLOAD (Stop/Compile/Start 생략) ━━━━━━━━━━━━━━━━━━━━━━━`
		: `━━ [${ctx.phase}/${ctx.totalPhases}] UPLOAD ∥ ${gateLabel} (동시 진행) ━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    lock.setStage(uploadLockStageFor(options));

    if (isCancelled()) { cancelResult('UPLOAD 시작 전'); return false; }

    // 컴파일 스냅샷(GitHub #21)은 업로드 *직전*의 로컬 상태를 찍어 둔다 — 실제로 제어기에 올라가는 소스에 가장 가깝다.
    // 컴파일 성공 시점에 찍으면 업로드~컴파일 사이(수 초)에 편집한 파일이 "컴파일본과 동일"로 오판되어
    // Attach only BP 신뢰성 판정이 놓친다. 기록 자체는 Compile 성공이 확정된 뒤(컴파일 단계 끝)에 한다.
    // 실패해도 배포에는 영향 없음(그 경우 성공 시점에 다시 찍어 폴백).
	if (!options.uploadOnly) {
		try {
			ctx.preUploadSnapshot = snapshotProjectFiles(options.projectDir);
		} catch (e: any) {
			pushTrace(`│ ⚠ 컴파일 스냅샷 수집 실패(무시, 성공 시점에 재시도): ${e?.message ?? e}`);
		}
    }

    const changedFiles = (options.changedFiles ?? []).filter(Boolean);
    const useChangedOnly = changedFiles.length > 0;
    if (useChangedOnly) {
        pushTrace(`│ 변경 파일만 업로드(${changedFiles.length}개): ${changedFiles.map(f => path.basename(f)).join(', ')}`);
    }

    const useMirror = shouldMirrorUpload(directActive, useChangedOnly);

    /**
     * 진행 알림 — 파일 완료마다 잠금 생존 신호 + 실제 전송분만 로그 한 줄(스킵까지 나열하면 파일 수만큼 쏟아진다).
     * 바이트 갱신은 로그에 찍지 않고 상태바 구독자에게만 간다(출력 패널은 줄을 제자리에서 못 고친다, §1-EE).
     */
    const onUploadProgress = (progress: UploadProgressEvent): void => {
        if (!result.uploadStats) {
            result.uploadStats = { uploaded: 0, skipped: 0, totalBytes: progress.totalBytes, ...(useMirror ? { deleted: 0 } : {}) };
        } else {
            result.uploadStats.totalBytes = progress.totalBytes;
        }
        if (progress.type === 'file') {
            lock.heartbeat();
            if (progress.action === 'uploaded') { result.uploadStats.uploaded++; }
            else { result.uploadStats.skipped++; }
            if (progress.action === 'uploaded') {
                pushTrace(`│ ↑ [${progress.doneFiles}/${progress.totalFiles}] ${progress.file}`);
            }
        }
        host.emitUploadEvent({ kind: 'progress', projectName, remoteDir: ftpProjectDir, progress });
    };
    const fireUploadEnd = (summary: UploadSummary): void => {
        host.emitUploadEvent({ kind: 'end', projectName, remoteDir: ftpProjectDir, ok: true, summary });
    };
    /** 업로드 작업. 예외를 던지지 않고 결과로 돌려준다(Promise.all에서 다른 쪽을 끝까지 기다리기 위해). */
    async function runUpload(): Promise<UploadOutcome> {
        try {
            if (useMirror) {
                const remoteOnlyPolicy = options.uploadOnly
                    ? '원격 전용 파일 삭제 보류'
                    : '원격 전용 파일 삭제는 정지 확인 뒤';
                pushTrace(`│ ↑ Mode: mirror sync (변경분만 업로드, ${remoteOnlyPolicy}, Unload 생략)`);
                const previousManifest = getSyncManifest(cfg.ip, ftpProjectDir);
                const stats = await mirrorProject(cfg.ip, options.projectDir, ftpProjectDir, {
                    deferDelete: true,
                    // 크기만 같고 내용이 바뀐 파일을 스킵하지 않도록 직전 업로드 지문(SHA-1)을 함께 본다.
                    manifest: previousManifest,
                    onProgress: onUploadProgress,
                    isCancelled,
                });
                result.uploadStats = {
                    uploaded: stats.uploaded,
                    skipped: stats.skipped,
                    totalBytes: stats.totalBytes,
                    deleted: 0,
                };
                // 전체 목록 기준이므로 대체 저장(로컬에서 사라진 파일의 지문도 함께 정리된다).
                recordSyncManifest(cfg.ip, ftpProjectDir, stats.manifest);
                const noManifest = Object.keys(previousManifest).length === 0;
                pushTrace(`│ ✔ Mirror done: ${stats.uploaded} sent, ${stats.skipped} skipped${pendingDeleteNote(stats.pendingDeletes.length, !!options.uploadOnly)}${noManifest ? ' (첫 동기화 — 지문 기록 없음, 전체 업로드)' : ''}`);
                fireUploadEnd(stats);
                return { ok: true, pendingDeletes: stats.pendingDeletes };
            }
            const stats = await uploadProject(cfg.ip, options.projectDir, ftpProjectDir, {
                skipUnchanged: options.skipUnchanged,
                onlyFiles: useChangedOnly ? changedFiles : undefined,
                manifest: getSyncManifest(cfg.ip, ftpProjectDir),
                onProgress: onUploadProgress,
                isCancelled,
            });
            // 이번에 다룬 파일만 담겨 있으므로 병합(autoOnSave는 저장 파일만 올린다).
            mergeSyncManifest(cfg.ip, ftpProjectDir, stats.manifest);
            result.uploadStats = {
                uploaded: stats.uploaded,
                skipped: stats.skipped,
                totalBytes: stats.totalBytes,
            };
            pushTrace(`│ ✔ Upload done: ${stats.uploaded} sent, ${stats.skipped} skipped`);
            fireUploadEnd(stats);
            return { ok: true, pendingDeletes: [] };
        } catch (e: any) {
            const cancelled = isUploadCancelledError(e) || isCancelled();
            const message = cancelled ? (cancellationStatus().reason ?? '업로드 취소') : (e?.message || 'Upload failed');
            pushTrace(cancelled ? `│ ■ Upload cancelled: ${message}` : `│ ✘ Upload failed: ${message}`);
            host.emitUploadEvent({ kind: 'end', projectName, remoteDir: ftpProjectDir, ok: false, message });
            return { ok: false, message };
        }
    }

    // 두 작업을 동시에 시작하고 둘 다 끝날 때까지 기다린다. 한쪽이 먼저 실패해도 다른 쪽을 끝까지 기다려야 한다 —
    // 특히 업로드가 진행 중인데 돌아가 배포 잠금을 풀면 "업로드 도중 Compile/Start" 창이 열린다.
    const [upload, gate] = await Promise.all([runUpload(), runStopGate(ctx)]);

    // 일반 업로드/정지 실패보다 명시적 취소가 우선이다. 병행 작업 둘을 정리한 뒤 잠금을 유지한 채 여기서 끊는다.
    if (isCancelled()) { cancelResult('UPLOAD/STOP 완료 대기'); return false; }

    const pendingDeletes: RemoteFileRef[] = upload.ok ? upload.pendingDeletes : [];
    const deferNote = deferredDeleteNote(pendingDeletes.length);

    if (!upload.ok) {
        // 게이트 결과와 무관하게 업로드 실패가 우선 — 컴파일 대상(/GPL 사본)이 불완전하다.
        if (gate === 'proceed' && !options.skipStop) {
            pushTrace('│ ⚠ 쓰레드는 정지됨(Stop 완료) — 업로드 실패로 Compile은 하지 않습니다.');
        }
        result.failedPhase = 'UPLOAD';
        result.failedCommand = `Upload ${ftpProjectDir}`;
        result.failedStatusMessage = upload.message;
        return false;
    }
    if (gate === 'abort') {
        // failedPhase(STOP/THREAD_CHECK/COMPILE_DEFERRED)는 게이트가 기록했다. 업로드는 완료 —
        // "/GPL 소스는 최신, 컴파일본은 이전" 상태이므로 호출측이 '컴파일 필요'로 표시한다.
        pushTrace(`│   업로드는 완료됨 — /GPL 소스는 최신, 컴파일본은 이전 상태(컴파일 필요)${deferNote}`);
        return false;
    }
    pushTrace(options.uploadOnly
		? `│ ✔ 업로드 완료 — Compile/Start 미수행 (uploaded copy: ${ftpProjectDir})${deferNote}`
		: `│ ✔ 업로드·정지 확인 모두 완료 → Compile 진행 (mirrored/uploaded copy: ${ftpProjectDir})`);

    // ── 지연된 원격 전용 파일 삭제 (정지 확인 뒤) ──
    if (pendingDeletes.length > 0 && !options.uploadOnly) {
        if (isCancelled()) { cancelResult('원격 파일 삭제 전'); return false; }
        lock.setStage('UPLOAD');
        pushTrace(`│ 원격 전용 파일 ${pendingDeletes.length}개 삭제 (정지 확인 후)`);
        // ✘는 실패 기호로 오독된다 — 미러 삭제는 정상 동작이므로 −로 표기.
        const deleted = await removeRemoteFiles(cfg.ip, pendingDeletes, file => pushTrace(`│ − del ${file} (원격 전용 — 로컬에 없어 삭제)`));
        if (isCancelled()) { cancelResult('원격 파일 삭제 후'); return false; }
        if (result.uploadStats) { result.uploadStats.deleted = deleted; }
        if (deleted < pendingDeletes.length) {
            pushTrace(`│ ⚠ 삭제 실패 ${pendingDeletes.length - deleted}개 (non-fatal — 남은 파일은 Compile 결과로 드러남)`);
        }
    }

    // ── 배포 증적 대조 (개선안 §12·§13) ──
    // 업로드가 끝난 시점에 "지금 로컬 소스"와 "우리가 이 원격 경로에 올린 내용"의 지문을 맞춰 본다.
    // Compile 성공만으로는 **방금 고친 파일이 올라갔는지**를 알 수 없다 — 그 답을 결과에 싣는다.
    // 대조 실패는 배포를 막지 않는다(보조 정보) — 판정은 여전히 각 명령의 STATUS 다(§0 하드 규칙 2).
    if (ftpProjectDir) {
        try {
            result.provenance = compareProvenance({
                local: snapshotProjectFiles(options.projectDir),
                uploaded: getSyncManifest(cfg.ip, ftpProjectDir),
            });
            pushTrace(`│ 증적: ${describeProvenance(result.provenance)}`);
            for (const rel of result.provenance.changedSinceUpload.slice(0, 5)) {
                pushTrace(`│ ⚠ 올린 뒤 변경됨(업로드 안 된 편집분일 수 있음): ${rel}`);
            }
        } catch (err: any) {
            pushTrace(`│ 증적 대조 생략 — ${err?.message ?? err}`);
        }
    }

	if (options.uploadOnly) {
		if (isCancelled()) { cancelResult('Upload Only 완료 전'); return false; }
		result.success = true;
		pushTrace('│ ✔ Upload Only 완료 — 실행 중인 프로그램과 컴파일본은 변경하지 않았습니다.');
		return false;
	}

    return true;
}
