/**
 * 배포 옵션 조합 → 모드 라벨(잠금 owner·작업 종류·단계 수·헤더/완료 문구)의 순수 판정.
 * 2026-10-27 `deployService.ts` 에서 분리 — 같은 옵션 조합을 여러 곳(잠금 레코드·작업 기록·트레이스 헤더·완료 줄)이
 * 각자 해석하던 것을 한 모듈에 모아 Node 단독 테스트로 고정한다. vscode·제어기 IO 없음.
 */

import type { DeployOptions } from './deployTypes';

/** 배포 잠금 레코드의 owner 라벨 — `options.lockOwner` 가 없을 때 옵션에서 유추한다. */
export function defaultLockOwner(options: DeployOptions): string {
    if (options.uploadOnly) { return 'Upload Only'; }
    if ((options.changedFiles ?? []).length > 0) { return 'autoOnSave Quick Compile'; }
    if (options.skipStop) { return 'Quick Compile'; }
    if (options.skipCompile && !options.skipStart) { return 'Upload & Start'; }
    return options.skipStart ? 'Deploy' : 'Deploy & Run';
}

/** 작업 기록(operationStore)의 종류 라벨 — `options.operationType` 이 우선. */
export function defaultOperationType(options: DeployOptions): string {
    if (options.operationType) { return options.operationType; }
    if (options.uploadOnly) { return 'UPLOAD_ONLY'; }
    if ((options.changedFiles ?? []).length > 0) { return 'AUTO_QUICK_COMPILE'; }
    if (options.skipStop) { return 'QUICK_COMPILE'; }
    if (options.skipCompile && !options.skipStart) { return 'UPLOAD_START'; }
    return 'DEPLOY';
}

/** 트레이스 헤더 `[n/N]` 의 N — Upload Only는 FTP 한 단계뿐. 일반 경로는 (UPLOAD ∥ STOP/게이트) + COMPILE + ERROR CHECK, START는 옵션. */
export function totalPhasesFor(options: DeployOptions): number {
    return options.uploadOnly ? 1 : 3 + (options.skipStart ? 0 : 1);
}

/** 트레이스 헤더 첫 줄(`◆ <프로젝트>`)에 붙는 모드 설명. 전체 배포(Deploy & Run)는 빈 문자열. */
export function modeSuffixFor(options: DeployOptions): string {
    return options.uploadOnly
        ? ' (Upload Only — Stop/Compile/Start 없음)'
        : options.skipStop
        ? ' (Quick Compile)'
        : options.skipCompile && !options.skipStart
            ? ' (Upload & Start — Compile 생략, Start -compile 이 컴파일)'
            : options.skipStart ? ' (Build Only)' : '';
}

/** Phase 1 헤더에서 업로드와 나란히 도는 게이트의 이름. */
export function stopGateLabelFor(options: DeployOptions): string {
    return options.skipStop ? '쓰레드 상태 확인' : 'STOP';
}

/** Phase 1 의 배포 잠금 단계 라벨(잠금 레코드·작업 기록 phase 에 그대로 실린다). */
export function uploadLockStageFor(options: DeployOptions): string {
    return options.uploadOnly ? 'UPLOAD' : options.skipStop ? 'UPLOAD+THREAD_CHECK' : 'UPLOAD+STOP';
}

/** 마지막 요약 줄(`✔ Deploy complete: …`)의 작업 이름. */
export function doneLabelFor(options: DeployOptions): string {
    return options.skipStart ? 'Build' : options.skipCompile ? 'Upload & Start' : 'Deploy';
}
