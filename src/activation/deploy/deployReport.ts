/**
 * 배포 결과 보고 — `deploy()` 가 돌려준 `DeployResult` 를 로그·알림·Problems 점프·상황 스냅샷·컴파일 검증 상태로
 * 반영한다. 세 갈래다: 중단(잠금·게이트·취소·메모리·쓰레드 등 "실패가 아닌 멈춤")·성공(Upload Only/Build/Deploy & Run)·
 * 실패. 문구 규칙은 controller/deployment/deployOutcome.ts(순수)와 `deployModes.ts`(순수)가 정하고 여기서는 줄만 찍는다.
 * `deploy.ts` 에서 분할(2026-10-27).
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { isRuntimeConsoleAutoStartOnDeploy } from '../../config';
import { SHOW_MEMORY_STATUS_COMMAND, UNLOAD_PROJECT_COMMAND } from '../../controller/connection/controllerConnection';
import {
	buildCompileRawSectionLines,
	buildDeployOutcomeSignature,
	classifyDeployErrorLog,
	comparisonNoteFor,
	controllerSystemErrorEntries,
	describeDeployFailure,
	makeDeploySnapshot,
	parsedErrorCodes,
	summarizeCompileAttempts,
} from '../../controller/deployment/deployOutcome';
import type { SituationDeploySnapshot } from '../../controller/deployment/deployOutcome';
import { DeployResult, jumpToFirstCompileError } from '../../controller/deployment/deployService';
import { RuntimeConsole } from '../../controller/runtime/runtimeConsole';
import { formatRuntimeError } from '../../controller/threads/postStartWatch';
import type { ExtensionHost } from '../host';
import type { DeployContext, QuickDeployOpts } from './deployContext';
import {
	buildOnlySuccessSummary,
	compileStaleReasonAfterFailure,
	deployRunSuccessSummary,
	newErrorLogNoticeParts,
	libraryUploadNote,
	remotePathSuffix,
} from './deployModes';
import { CLEAR_ERROR_LOG, clearControllerErrorLog, takeErrorLogNotice } from './errorLogNotice';

/** 한 번의 배포 결과를 보고하는 데 필요한 것 — `runDeploy` 가 채운다. */
export interface DeployReportInput {
	result: DeployResult;
	projectDir: string;
	skipStart: boolean;
	quickOpts: QuickDeployOpts | undefined;
	/** 로그·알림 문구의 모드 이름(`deployModeName`). */
	mode: string;
	/** 상황 스냅샷의 모드 라벨(`deployModeLabel`). */
	modeLabel: SituationDeploySnapshot['mode'];
	/** ErrorLog "이미 본 항목" 의 키(제어기 IP). */
	controllerIp: string;
}

// ErrorLog 분류·COMPILE 원문 섹션의 문구는 controller/deployment/deployOutcome.ts 가 만든다(테스트 대상) — 여기서는 줄만 찍는다.
function logErrorLogSections(host: ExtensionHost, result: DeployResult): { sysCount: number; deployErrCount: number } {
	const classified = classifyDeployErrorLog(result.errorLog);
	for (const line of classified.lines) { host.log(line); }
	return classified;
}
function logCompileRawSection(host: ExtensionHost, result: DeployResult): void {
	for (const line of buildCompileRawSectionLines(result)) { host.log(line); }
}

/**
 * 성공도 실패도 아닌 "중단" 결과(제어기 미확인·취소·잠금·manifest 게이트·autoOnSave 게이트·Compile 보류·
 * 메모리/쓰레드 확인)를 보고한다. 처리했으면 true — 호출측은 result 를 그대로 돌려준다.
 */
export function reportDeployInterruption(ctx: DeployContext, p: DeployReportInput): boolean {
	const { host } = ctx;
	const { result, projectDir, quickOpts, mode, modeLabel } = p;

	// 제어기 정체 확인 실패 — 아무것도 올리지 않았다. 사람 경로는 이미 모달로 알렸고(취소 선택), 자동 경로는 로그만.
	if (!result.success && result.failedPhase === 'CONTROLLER_CHECK') {
		const reasons = result.controllerCheck?.reasons.join(' / ') ?? result.failedStatusMessage ?? '제어기 확인 실패';
		host.log(`[Deploy] ${mode} 중단(제어기 미확인, 업로드 안 함): ${reasons}`);
		host.lastDeploySnapshot = makeDeploySnapshot({
			mode: modeLabel, success: false, lastStage: 'UPLOAD', summary: `제어기 미확인(업로드 안 함) — ${reasons}`,
			compileErrorCodes: [], controllerSystemCodes: [],
		});
		return true;
	}

	if (result.cancelled) {
		const reason = result.cancellationReason ?? result.failedStatusMessage ?? '작업자 전체 정지 요청';
		if (result.uploadStats) {
			host.markCompileStale(
				result.projectName,
				`${mode} 취소 — 부분 업로드 가능, Compile/Start 미수행`,
				projectDir,
			);
		}
		const message = `${mode} 취소: ${reason} — 이후 Compile/Start는 실행하지 않았습니다.`;
		host.log(`[Deploy] ${message}`);
		host.lastDeploySnapshot = makeDeploySnapshot({
			mode: modeLabel, success: false, lastStage: 'CANCELLED', summary: message,
			compileErrorCodes: [], controllerSystemCodes: [],
		});
		if (!quickOpts?.changedFiles?.length) { void vscode.window.showWarningMessage(message); }
		return true;
	}

	// 배포 잠금 보유 중(UI 확인이 끝난 사이 다른 창/autoOnSave가 먼저 잡은 경우) — 컨텍스트와 함께 안내.
	if (result.failedPhase === 'LOCKED') {
		if (quickOpts?.changedFiles?.length) {
			host.log(`[QuickCompile] autoOnSave 대기 — ${result.failedStatusMessage ?? '배포 잠금 보유 중'}`);
		} else if (result.lockHolder) {
			host.warnDeployBusy(mode, result.lockHolder, '완료 후 다시 시도하세요');
		}
		return true;
	}

	// Controller Snapshot manifest 게이트는 제어기를 건드리기 전의 의도적 차단이다.
	// deployService 내부 단계는 AUTO_GATE를 재사용하지만, 사람이 누른 Quick Compile/Deploy까지
	// "autoOnSave 건너뜀"으로 조용히 처리하면 명령이 사라진 것처럼 보인다. 대화형 경로에는
	// manifest의 정확한 이유를 보여 주고, 자동화 경로는 구조화 결과를 그대로 호출자에게 돌려준다.
	if (!result.success && result.failedCommand === 'Controller project manifest gate') {
		const message = result.failedStatusMessage ?? 'Controller 프로젝트 manifest 정책으로 쓰기 작업이 차단됐습니다.';
		host.log(`[Deploy] ${mode} 차단: ${message}`);
		if (!quickOpts?.nonInteractive && !quickOpts?.changedFiles?.length) {
			void vscode.window.showWarningMessage(message);
		}
		return true;
	}

	// autoOnSave 자동 게이트 미충족 — 실패가 아니라 "스킵"이다.
	// 저장마다 팝업/패널 포커스/스냅샷 기록이 생기면 방해되므로 로그 한 줄만 남긴다.
	if (!result.success && result.failedPhase === 'AUTO_GATE') {
		host.log(`[QuickCompile] autoOnSave 건너뜀: ${result.failedStatusMessage ?? '게이트 미충족'}`);
		return true;
	}

	// 업로드는 됐지만 Compile은 보류(autoOnSave: 쓰레드 존재) — 팝업 없이 "컴파일 필요" 상태로만 표시(이슈 #17).
	if (!result.success && result.failedPhase === 'COMPILE_DEFERRED') {
		host.markCompileStale(result.projectName, 'autoOnSave 업로드 후 Compile 보류(쓰레드 존재)', projectDir);
		host.log(`[QuickCompile] autoOnSave: ${result.failedStatusMessage ?? '업로드 완료, Compile 보류'}`);
		return true;
	}

	// 정지 뒤 여유 메모리 심각 + 사용자 취소 — 업로드는 완료, Compile/Start 미전송. 실패가 아닌 "중단"으로 다룬다(사람 경로만).
	if (!result.success && result.failedPhase === 'MEMORY_CHECK') {
		host.markCompileStale(result.projectName, `${mode} 업로드 후 Compile 미수행(여유 메모리 심각 — 사용자 취소)`, projectDir);
		const msg = `${mode} 중단: ${result.failedStatusMessage ?? '여유 메모리 심각 경고에서 취소'}`;
		host.log(`[Deploy] ${msg}`);
		host.lastDeploySnapshot = makeDeploySnapshot({ mode: modeLabel, success: false, lastStage: 'MEMORY_CHECK', summary: msg, compileErrorCodes: [], controllerSystemCodes: [] });
		void vscode.window.showWarningMessage(msg, 'Unload…', '메모리 상세').then(pick => {
			if (pick === 'Unload…') { void vscode.commands.executeCommand(UNLOAD_PROJECT_COMMAND); }
			else if (pick === '메모리 상세') { void vscode.commands.executeCommand(SHOW_MEMORY_STATUS_COMMAND); }
		});
		return true;
	}

	// 활성 쓰레드 + Stop 미승인(또는 자동 경로) — 업로드는 완료, Compile 미수행. 실패가 아닌 "중단"으로 다룬다.
	if (!result.success && result.failedPhase === 'THREAD_CHECK') {
		host.markCompileStale(result.projectName, `${mode} 업로드 후 Compile 미수행(활성 쓰레드)`, projectDir);
		const msg = `${mode} 중단: ${result.failedStatusMessage ?? '활성 쓰레드 존재'}`;
		host.log(`[Deploy] ${msg}`);
		host.lastDeploySnapshot = makeDeploySnapshot({ mode: modeLabel, success: false, lastStage: 'THREAD_CHECK', summary: msg, compileErrorCodes: [], controllerSystemCodes: [] });
		if (!quickOpts?.changedFiles?.length) { vscode.window.showWarningMessage(msg); }
		return true;
	}

	if (!result.success && (result.cancelled || result.failedPhase === 'CANCELLED')) {
		if (result.uploadStats) {
			host.markCompileStale(result.projectName, `${mode} 취소 — 업로드가 일부 진행됐을 수 있음`, projectDir);
		}
		const msg = `${mode} 취소: ${result.cancellationReason ?? result.failedStatusMessage ?? '사용자 요청'}`;
		host.log(`[Deploy] ${msg}`);
		host.lastDeploySnapshot = makeDeploySnapshot({
			mode: modeLabel,
			success: false,
			lastStage: 'CANCELLED',
			summary: msg,
			compileErrorCodes: [],
			controllerSystemCodes: [],
		});
		if (!quickOpts?.changedFiles?.length) { void vscode.window.showInformationMessage(msg); }
		return true;
	}

	return false;
}

/**
 * 성공 결과 보고 — Upload Only(Compile 미수행 표시)·Build Only(1403 유지 연결, 새 시스템 경고만 알림)·
 * Deploy & Run(Start 뒤 런타임 Error 표시, 새 ErrorLog 항목 알림, 콘솔 포커스).
 * `deployRuntimeConsole` 은 `runDeploy` 가 Start 전에 미리 연결해 둔 1403 콘솔(없으면 undefined) — 여기서 이어 쓴다.
 */
export async function reportDeploySuccess(ctx: DeployContext, p: DeployReportInput, deployRuntimeConsole: RuntimeConsole | undefined): Promise<void> {
	const { host, deployOutcomeHistory } = ctx;
	const { outputChannel, consoleChannel } = host;
	const { result, projectDir, skipStart, quickOpts, modeLabel, controllerIp } = p;

	if (quickOpts?.uploadOnly) {
		host.markCompileStale(result.projectName, 'Upload Only 완료 — Compile 미수행', projectDir);
		const deployedFolderName = path.basename(projectDir).trim();
		const remotePathInfo = remotePathSuffix(result.selectedRemoteProjectPath);
		host.controllerTree?.setExpectedProjectContext(result.projectName, deployedFolderName);
		await host.controllerTree?.refreshFtp();
		const signature = buildDeployOutcomeSignature(result, []);
		const comparisonNote = comparisonNoteFor(deployOutcomeHistory.countSame(signature), 'result');
		deployOutcomeHistory.push({ mode: modeLabel, signature, timestamp: Date.now(), summary: '업로드 성공' });
		const libraryNote = libraryUploadNote(result.libraryUploads);
		const summary = `업로드 완료: ${result.projectName}${remotePathInfo}${libraryNote} (Stop/Compile/Start 미실행)`;
		host.log(`[Deploy] ✔ ${summary}`);
		if (!quickOpts.inBatch) { void vscode.window.showInformationMessage(summary); }
		outputChannel.show(true);
		host.lastDeploySnapshot = makeDeploySnapshot({
			mode: modeLabel,
			success: true,
			lastStage: 'SUCCESS',
			summary: `업로드 성공 / Compile 미수행${remotePathInfo}`,
			compileErrorCodes: [],
			controllerSystemCodes: [],
			comparisonNote,
		});
		return;
	}
	host.clearCompileStale(result.projectName);
	const controllerSystemCodes = parsedErrorCodes(result.errorLog);
	const signature = buildDeployOutcomeSignature(result, controllerSystemCodes);
	const comparisonNote = comparisonNoteFor(deployOutcomeHistory.countSame(signature), 'result');
	deployOutcomeHistory.push({ mode: modeLabel, signature, timestamp: Date.now(), summary: result.success ? '성공' : '실패' });
	const deployedFolderName = path.basename(projectDir).trim();
	const remotePathInfo = remotePathSuffix(result.selectedRemoteProjectPath);
	host.controllerTree?.setExpectedProjectContext(result.projectName, deployedFolderName);
	await host.controllerTree?.refreshAll();

	if (skipStart) {
		// Build Only 성공 후에도 1403 콘솔을 즉시 유지 연결한다.
		try {
			deployRuntimeConsole = host.ensureRuntimeConsole();
			await deployRuntimeConsole.waitUntilReady(800);
			host.log('[Deploy] Runtime console auto-start after Build Only');
		} catch (err: any) {
			host.log(`[Console] build-only auto-start failed: ${err?.message ?? err}`);
		}
		const { sysCount } = logErrorLogSections(host, result);
		// 알림은 직전 배포 이후 새로 생긴 항목만(이미 본 경고를 배포마다 반복하지 않는다). 스냅샷 summary 는 전체 건수.
		const notice = takeErrorLogNotice(ctx, controllerIp, controllerSystemErrorEntries(result.errorLog));
		if (notice.newSys.length > 0) {
			// Build Only이므로 START는 미실행. 제어기 시스템 에러는 배포와 무관하므로 경고만 표시.
			outputChannel.show(true);
			// 토스트를 await 하지 않는다 — 비모달 알림의 Promise 는 사용자가 닫아야 끝나서, 브리지(MCP `deploy_project`)로
			// 들어온 호출이 작업은 11초에 끝나고도 응답을 못 받아 300초 타임아웃이 났다(2026-10-14 실측, §1-EO).
			void vscode.window.showWarningMessage(
				`빌드 완료: ${result.projectName}. 새 제어기 시스템 경고 ${notice.newSys.length}건 (배포/GPL 오류 아님) → 출력 채널 확인`,
				'출력 보기',
				CLEAR_ERROR_LOG,
			).then(pick => {
				if (pick === '출력 보기') { outputChannel.show(true); }
				else if (pick === CLEAR_ERROR_LOG) { void clearControllerErrorLog(ctx, controllerIp); }
			});
		} else {
			// 완료 문구는 진행 로그와 같은 자리(GPL Language Support)에 남긴다 — 실행하지 않은 경로에서
			// GPL Console(1403 런타임 출력)로 포커스를 뺏으면 방금 본 업로드/컴파일 로그가 사라진다
			// (2026-09-10 사용자 지적). 1403 연결 자체는 위에서 이미 해 뒀다.
			host.log(`[Deploy] ✔ 빌드 완료: ${result.projectName}${remotePathInfo} (FTP/컨텍스트 갱신 완료, Start 미실행)`);
			vscode.window.showInformationMessage(`빌드 완료: ${result.projectName}${remotePathInfo} (FTP/컨텍스트 갱신 완료, Start 미실행)`);
			outputChannel.show(true);
		}
		host.lastDeploySnapshot = makeDeploySnapshot({
			mode: modeLabel,
			success: true,
			lastStage: 'SUCCESS',
			summary: buildOnlySuccessSummary(sysCount, remotePathInfo),
			compileErrorCodes: [],
			controllerSystemCodes,
			comparisonNote,
		});
	} else {
		const { sysCount, deployErrCount } = logErrorLogSections(host, result);
		// 알림은 직전 배포 이후 새로 생긴 항목만 — 스냅샷 summary·출력 분류 섹션은 전체 건수 그대로.
		const notice = takeErrorLogNotice(ctx, controllerIp, result.errorLog);
		const runtimeError = result.runtimeError;
		if (runtimeError) {
			// Start 뒤 메인 쓰레드가 Error 로 멈췄다(§1-EU) — 업로드·컴파일·Start 는 성공이지만 "배포 완료" 로만 보고하면
			// 사용자는 런타임 콘솔을 들여다보고서야 알아챈다(2026-10-19 Sample Prep). 디버그 이벤트와 같은 자리에 남긴다:
			// 오류 컨텍스트(트리·오류 상세) + 에러 줄 강조(주인 쓰레드 붙임, 재시작하면 자동 해제 §1-EP) + 에러 토스트.
			const text = formatRuntimeError(runtimeError);
			host.log(`[Deploy] ✘ Start 뒤 메인 쓰레드 Error: ${text}${runtimeError.hint ? ` — ${runtimeError.hint}` : ''}`);
			host.lastRuntimeErrorContext = { threadName: runtimeError.threadName, statusText: text, firstSeenAt: new Date().toISOString() };
			host.controllerTree?.setRuntimeErrorContext(host.lastRuntimeErrorContext);
			if (runtimeError.file && runtimeError.line) {
				const target = host.project.resolveGplFilePath(path.basename(runtimeError.file));
				if (target) {
					try {
						const doc = await vscode.workspace.openTextDocument(target);
						const editor = await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });
						const range = doc.lineAt(Math.min(Math.max(0, runtimeError.line - 1), Math.max(0, doc.lineCount - 1))).range;
						host.decorations.showError(editor, range, { threadName: runtimeError.threadName });
						editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
					} catch (err: any) {
						host.log(`[Deploy] 오류 줄 표시 실패: ${err?.message ?? err}`);
					}
				}
			}
			outputChannel.show(true);
			// 토스트를 await 하지 않는다(브리지 호출의 300초 타임아웃 원인, §1-EO).
			void vscode.window.showErrorMessage(
				`배포는 끝났지만 Start 뒤 메인 쓰레드가 Error 로 멈췄습니다: ${text}${runtimeError.hint ? ` — ${runtimeError.hint}` : ''}`,
				'오류 상세',
				'출력 보기',
			).then(pick => {
				if (pick === '오류 상세') { void vscode.commands.executeCommand('gpl.controller.showErrorDetail', { threadName: runtimeError.threadName }); }
				else if (pick === '출력 보기') { outputChannel.show(true); }
			});
		} else if (notice.newSys.length > 0 || notice.newDeployErr.length > 0) {
			outputChannel.show(true);
			const parts = newErrorLogNoticeParts(notice);
			// 같은 이유로 await 하지 않는다(위 Build Only 분기 참조) — 선택은 then 에서 처리한다.
			void vscode.window.showWarningMessage(
				`배포 완료: ${result.projectName} — ${parts.join(' / ')}`,
				'출력 보기',
				'콘솔 보기',
				CLEAR_ERROR_LOG,
			).then(async action => {
				if (action === CLEAR_ERROR_LOG) {
					void clearControllerErrorLog(ctx, controllerIp);
				} else if (action === '콘솔 보기') {
					if (!deployRuntimeConsole) {
						deployRuntimeConsole = host.ensureRuntimeConsole();
						await deployRuntimeConsole.waitUntilReady(800);
					}
					consoleChannel.show(true);
				} else if (action === '출력 보기') {
					outputChannel.show(true);
				}
			});
		} else {
			vscode.window.showInformationMessage(`배포 완료: ${result.projectName}${remotePathInfo}`);
			if (!deployRuntimeConsole && isRuntimeConsoleAutoStartOnDeploy(vscode.workspace)) {
				deployRuntimeConsole = host.ensureRuntimeConsole();
				await deployRuntimeConsole.waitUntilReady(800);
			}
			consoleChannel.show(true);
		}
		host.lastDeploySnapshot = makeDeploySnapshot({
			mode: modeLabel,
			success: true,
			lastStage: 'SUCCESS',
			summary: deployRunSuccessSummary({ runtimeError, sysCount, deployErrCount, remotePathInfo }),
			compileErrorCodes: [],
			controllerSystemCodes,
			comparisonNote,
		});
	}
}

/**
 * 실패 결과 보고 — ErrorLog 분류·COMPILE 원문 섹션을 출력에 남기고, 업로드가 됐으면 "컴파일 검증 필요" 로 표시하며,
 * 소스 줄에 붙는 컴파일 에러면 Problems 로 점프한다(그 밖에만 출력 패널을 띄운다, §1-DH).
 */
export async function reportDeployFailure(ctx: DeployContext, p: DeployReportInput): Promise<void> {
	const { host, deployOutcomeHistory } = ctx;
	const { outputChannel } = host;
	const { result, projectDir, quickOpts, mode, modeLabel } = p;

	logErrorLogSections(host, result);
	logCompileRawSection(host, result);
	// 출력 패널 표시는 아래에서 결정한다 — 컴파일 에러로 Problems 패널로 점프하는 경우엔
	// 출력을 함께 띄우면 패널이 다시 출력으로 되돌아간다(§1-DH).
	if (result.uploadStats) {
		// 업로드는 됐고 Compile이 실패 — 컴파일본은 이전 상태이므로 Start 전 확인 대상.
		host.markCompileStale(
			result.projectName,
			compileStaleReasonAfterFailure(mode, quickOpts, result),
			projectDir,
		);
	}
	const sysErrors = controllerSystemErrorEntries(result.errorLog);
	const sysCodes = parsedErrorCodes(sysErrors);
	const signature = buildDeployOutcomeSignature(result, sysCodes);
	const comparisonNote = comparisonNoteFor(deployOutcomeHistory.countSame(signature), 'failure');
	deployOutcomeHistory.push({ mode: modeLabel, signature, timestamp: Date.now(), summary: result.failedPhase ?? 'FAIL' });
	// 실패 문구·검증 불가 사유·마지막 단계는 controller/deployment/deployOutcome.ts 의 순수 규칙이 정한다(테스트 대상).
	const failure = describeDeployFailure(result, sysErrors, comparisonNote);
	// 소스 줄에 붙는 컴파일 에러면 Problems 패널 + 에러 줄로 보내고, 그 외(제어기 시스템 에러 등
	// 코드 위치가 없는 실패)에만 출력 패널을 띄운다.
	// 자동화(AI) 배포는 에러 줄을 보여 주기만 하고 포커스는 옮기지 않는다 — 사용자가 채팅에 입력 중일 수 있다.
	const jumpedToError = failure.jumpToCompileErrors
		&& await jumpToFirstCompileError(result.compileErrors, projectDir,
			msg => outputChannel.appendLine(`[Deploy] ${msg}`),
			{ preserveFocus: quickOpts?.nonInteractive === true });
	if (!jumpedToError) {
		outputChannel.show(true);
	}

	vscode.window.showErrorMessage(`배포 실패: ${failure.message}`);
	host.lastDeploySnapshot = makeDeploySnapshot({
		mode: modeLabel,
		success: false,
		lastStage: failure.lastStage,
		summary: failure.message,
		compileErrorCodes: result.compileErrors.map(e => e.code),
		controllerSystemCodes: sysCodes,
		comparisonNote,
		unverifiableReason: failure.unverifiableReason,
		compileRawSummary: summarizeCompileAttempts(result),
	});
}
