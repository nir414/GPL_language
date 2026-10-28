/**
 * 배포 모드의 순수 판정 — `runDeploy` 의 호출 인자(`skipStart`·`QuickDeployOpts`)에서 모드 이름·스냅샷 라벨·
 * 잠금 owner·대화형 여부·결과 요약 문구를 정한다. `deploy.ts` 에서 분할(2026-10-27). vscode 를 import 하지 않는다
 * (Node 단독 테스트: test/activation/deploy/deployModes.test.ts).
 */

import type { SituationDeploySnapshot } from '../../controller/deployment/deployOutcome';
import type { QuickDeployOpts } from './deployContext';

/** 상황 스냅샷(`SituationDeploySnapshot.mode`)에 남기는 모드 라벨 — Quick Compile 은 Build 로 분류된다. */
export function deployModeLabel(skipStart: boolean, quickOpts?: QuickDeployOpts): SituationDeploySnapshot['mode'] {
	return quickOpts?.uploadOnly
		? 'Upload Only'
		: skipStart
		? 'Build'
		: quickOpts?.skipCompile ? 'Upload & Start' : 'Deploy & Run';
}

/** 로그·알림 문구에 쓰는 모드 이름(`[Deploy] Starting <mode>: …`·`<mode> 취소: …`). */
export function deployModeName(skipStart: boolean, quickOpts?: QuickDeployOpts): string {
	return quickOpts?.uploadOnly
		? 'Upload Only'
		: quickOpts?.quick
		? 'Quick Compile'
		: skipStart ? 'Build' : quickOpts?.skipCompile ? '업로드 스타트' : 'Deploy & Run';
}

/** 배포 잠금 레코드의 owner — 다른 창/MCP가 "누가 잡고 있는지" 볼 수 있게 경로별로 구분. */
export function deployLockOwner(quickOpts?: QuickDeployOpts): string {
	return quickOpts?.changedFiles?.length
		? 'autoOnSave Quick Compile'
		: quickOpts?.uploadOnly ? 'Upload Only' : quickOpts?.quick ? 'Quick Compile' : quickOpts?.skipCompile ? 'Upload & Start' : 'Deploy';
}

/** Project.gpr 대조 모달의 동작 이름(`reconcileProjectGprBeforeDeploy` 의 `action`). */
export function gprReconcileAction(quickOpts?: QuickDeployOpts): '업로드' | 'Quick Compile' | '배포' {
	return quickOpts?.uploadOnly ? '업로드' : quickOpts?.quick ? 'Quick Compile' : '배포';
}

/** 저장이 트리거인 autoOnSave 경로(`changedFiles`) — 저장 경로에서는 UI 를 띄우지 않는다. */
export function isAutoOnSaveDeploy(quickOpts?: QuickDeployOpts): boolean {
	return !!quickOpts?.changedFiles?.length;
}

/** 사람이 누른 경로 — 자동화(`nonInteractive`)도 autoOnSave(`changedFiles`)도 아닐 때만 모달을 띄운다. */
export function isInteractiveDeploy(quickOpts?: QuickDeployOpts): boolean {
	return !quickOpts?.nonInteractive && !quickOpts?.changedFiles?.length;
}

/** 결과 문구 뒤에 붙는 원격 경로 조각(` / 경로: /GPL/<name>`), 없으면 빈 문자열. */
export function remotePathSuffix(selectedRemoteProjectPath: string | undefined): string {
	return selectedRemoteProjectPath ? ` / 경로: ${selectedRemoteProjectPath}` : '';
}

/** 함께 올린 라이브러리 조각(` + 라이브러리 Libraries, Common`), 없으면 빈 문자열. */
export function libraryUploadNote(libraryUploads: readonly { raw: string }[] | undefined): string {
	return libraryUploads && libraryUploads.length > 0
		? ` + 라이브러리 ${libraryUploads.map(l => l.raw).join(', ')}`
		: '';
}

/**
 * 업로드는 됐고 Compile(또는 업로드 스타트의 Start -compile)이 실패했을 때 "컴파일 검증 필요" 상태에 남기는 사유.
 * 컴파일본은 이전 상태이므로 Start 전 확인 대상이다.
 */
export function compileStaleReasonAfterFailure(
	mode: string,
	quickOpts: QuickDeployOpts | undefined,
	result: { failedPhase?: string; compileErrors: readonly unknown[] },
): string {
	return quickOpts?.skipCompile && result.failedPhase === 'START'
		? result.compileErrors.length > 0
			? `업로드 스타트: Start -compile 컴파일 에러 ${result.compileErrors.length}건`
			: '업로드 스타트: Start 실패 — 컴파일 에러 위치는 응답에서 확인되지 않음'
		: `${mode} 업로드 후 Compile 실패(${result.failedPhase ?? 'FAIL'})`;
}

/** Build Only 성공 스냅샷의 summary — 제어기 시스템 경고는 전체 건수로 남긴다. */
export function buildOnlySuccessSummary(sysCount: number, remotePathInfo: string): string {
	return sysCount > 0
		? `빌드 성공 / 제어기 시스템 경고 ${sysCount}건${remotePathInfo}`
		: `빌드 성공${remotePathInfo}`;
}

/** Deploy & Run 성공 스냅샷의 summary — Start 뒤 런타임 Error 가 있으면 그 위치가 우선이다. */
export function deployRunSuccessSummary(args: {
	runtimeError: { statusCode?: number | string; file?: string; line?: number } | undefined;
	sysCount: number;
	deployErrCount: number;
	remotePathInfo: string;
}): string {
	const { runtimeError, sysCount, deployErrCount, remotePathInfo } = args;
	return runtimeError
		? `배포 성공 / Start 뒤 메인 쓰레드 Error(${runtimeError.statusCode ?? '?'})${runtimeError.file ? ` ${runtimeError.file}:${runtimeError.line ?? '?'}` : ''}${remotePathInfo}`
		: sysCount > 0 || deployErrCount > 0
			? `배포 성공 / 배포 에러 ${deployErrCount}건 / 시스템 경고 ${sysCount}건${remotePathInfo}`
			: `배포 성공${remotePathInfo}`;
}

/** 여러 프로젝트 Upload Only 의 프로젝트별 결과 — 실패·취소가 나오면 그 뒤 프로젝트는 `notRun` 으로 남는다. */
export type UploadBatchOutcome = 'uploaded' | 'failed' | 'cancelled' | 'notRun';

/** 여러 프로젝트 Upload Only 를 마친 뒤 한 번 띄우는 요약 — 성공 여부와 프로젝트별 결과 한 줄. */
export function uploadBatchSummary(entries: readonly { name: string; outcome: UploadBatchOutcome }[]): { success: boolean; message: string } {
	const uploaded = entries.filter(e => e.outcome === 'uploaded').map(e => e.name);
	const stopped = entries.find(e => e.outcome === 'failed' || e.outcome === 'cancelled');
	const notRun = entries.filter(e => e.outcome === 'notRun').map(e => e.name);
	if (!stopped) {
		return { success: true, message: `Upload Only 완료 ${uploaded.length}/${entries.length}: ${uploaded.join(', ')} (Stop/Compile/Start 미실행)` };
	}
	const parts = [
		`Upload Only 중단: ${stopped.name} ${stopped.outcome === 'failed' ? '실패' : '취소'}`,
		`완료 ${uploaded.length}/${entries.length}${uploaded.length > 0 ? `: ${uploaded.join(', ')}` : ''}`,
		notRun.length > 0 ? `미실행: ${notRun.join(', ')}` : undefined,
	];
	return { success: false, message: parts.filter(Boolean).join(' / ') };
}

/** 배포 완료 경고 토스트의 본문 조각 — 새 배포 에러가 먼저, 새 시스템 경고가 뒤. */
export function newErrorLogNoticeParts(notice: { newDeployErr: readonly unknown[]; newSys: readonly unknown[] }): string[] {
	const parts: string[] = [];
	if (notice.newDeployErr.length > 0) { parts.push(`새 배포 에러 ${notice.newDeployErr.length}건`); }
	if (notice.newSys.length > 0) { parts.push(`새 제어기 시스템 경고 ${notice.newSys.length}건 (배포 원인 아님)`); }
	return parts;
}
