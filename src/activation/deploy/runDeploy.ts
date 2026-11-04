/**
 * 배포 진입점 `runDeploy` — 대상 폴더 확정 → 실행 불가 거부 → 미저장 확인 → Project.gpr 대조 → 1403 콘솔 준비 →
 * `deploy()`(controller/deployment/deployService) 호출 → 결과 보고(`deployReport`). 모든 경로(명령·탐색기·F5·
 * autoOnSave·MCP 자동화)가 이 한 함수로 들어온다. `deploy.ts` 에서 분할(2026-10-27).
 */

import * as vscode from 'vscode';
import { getControllerConfig } from '../../controller/connection/controllerConnection';
import { DeployResult, deploy } from '../../controller/deployment/deployService';
import { reconcileProjectGprBeforeDeploy } from '../../controller/projects/gprSyncCommand';
import { RuntimeConsole } from '../../controller/runtime/runtimeConsole';
import { confirmMemoryCriticalInteractive, isMemoryAutoUnload, isMemoryConfirmOnCritical } from '../controller/controllerOps';
import type { DeployContext, QuickDeployOpts } from './deployContext';
import { deployLockOwner, deployModeLabel, deployModeName, gprReconcileAction } from './deployModes';
import { reportDeployFailure, reportDeployInterruption, reportDeploySuccess } from './deployReport';
import { confirmSaveDirtyProjectDocs, describeNotRunnable, pickWorkspaceProjectDir } from './deployTargets';

/**
 * 배포 진입점. 큐 등록과 잠금은 deploy() 안에서 — 프로젝트 선택/미저장 확인 UI가 끝난 뒤 — 수행한다
 * (UI 대기 중 대기열 점유 금지, 이슈 #15). 같은 제어기의 기존 작업이 있으면 거부하지 않고 순서대로 기다린다.
 */
export async function runDeploy(ctx: DeployContext, skipStart: boolean, quickOpts?: QuickDeployOpts): Promise<DeployResult | undefined> {
	const { host, quickCompilePendingFiles } = ctx;
	const { outputChannel, deployDiagnostics } = host;
	const modeLabel = deployModeLabel(skipStart, quickOpts);
	const cfg = getControllerConfig();

	let projectDir: string;
	if (quickOpts?.overrideProjectDir) {
		// 저장 파일이 속한 프로젝트가 이미 결정된 경우(autoOnSave 등) QuickPick 없이 그대로 사용.
		projectDir = quickOpts.overrideProjectDir;
	} else {
		const picked = await pickWorkspaceProjectDir(ctx, '배포할 프로젝트를 선택하세요');
		if (!picked) { return; }
		projectDir = picked;
	}

	// Start 를 보내는 경로(Deploy & Run·업로드 스타트)는 실행 불가(ProjectStart 없는) 프로젝트를 정지·업로드·컴파일 **전에** 거부한다 —
	// 그대로 가면 Stop -all + 그룹 Compile 뒤 -744 로 끝나고, 그 Compile 이 이 부팅을 Unload 위험 상태로 만든다(2026-10-23).
	if (!skipStart && !quickOpts?.uploadOnly) {
		const notRunnable = await describeNotRunnable(projectDir);
		if (notRunnable) {
			host.log(`[Deploy] ${notRunnable}`);
			if (!quickOpts?.nonInteractive) { vscode.window.showErrorMessage(notRunnable); }
			return;
		}
	}

	// 업로드 전 미저장 파일 확인 — 수동 경로(Deploy/Quick Compile)만.
	// autoOnSave(changedFiles) 경로는 저장이 트리거라 대상 파일이 방금 저장됐고, 저장 경로에서는 UI를 띄우지 않는다.
	// 자동화 경로(nonInteractive)는 호출측 래퍼가 이미 처리했다(handleDirtyForAutomation) — 여기서 모달을 띄우면
	// MCP 호출이 응답 없이 멈춘다(개선안 §17·§25).
	if (!quickOpts?.changedFiles?.length && !quickOpts?.nonInteractive) {
		const dirty = await confirmSaveDirtyProjectDocs(projectDir);
		if (!dirty.ok) {
			host.log('[Deploy] 미저장 파일 확인에서 취소됨 — 업로드를 시작하지 않음');
			return;
		}
		// 방금 저장한 파일이 autoOnSave pending에 들어갔다면 이번 업로드가 함께 처리하므로 제거(중복 컴파일 방지).
		for (const f of dirty.savedFiles) { quickCompilePendingFiles.delete(f); }
	}

	// Project.gpr 소스 목록 ↔ 폴더 대조(2026-10-27) — 제어기는 목록만 컴파일하므로 올리기 전에 맞춘다. 사람 경로는 모달(반영/그대로/취소),
	// autoOnSave(changedFiles)·비대화형은 `autoSyncSources: auto` 일 때만 반영하고 아니면 그대로(차이는 배포 경고에 남는다).
	{
		const gprOutcome = await reconcileProjectGprBeforeDeploy(projectDir, { log: host.log, refreshSymbols: () => host.symbolCache.refresh() }, {
			interactive: !quickOpts?.nonInteractive && !quickOpts?.changedFiles?.length,
			action: gprReconcileAction(quickOpts),
		});
		if (gprOutcome === 'cancelled') {
			host.log('[Deploy] Project.gpr 대조에서 취소됨 — 업로드를 시작하지 않음');
			return;
		}
	}

	const mode = deployModeName(skipStart, quickOpts);
	host.log(`[Deploy] Starting ${mode}: ${projectDir} → ${cfg.ip}`);
	outputChannel.show(true);

	let deployRuntimeConsole: RuntimeConsole | undefined;
	if (!skipStart) {
		try {
			deployRuntimeConsole = host.ensureRuntimeConsole();
			await deployRuntimeConsole.waitUntilReady(800);
			host.log('[Deploy] Runtime console primed before Start');
		} catch (err: any) {
			host.log(`[Console] pre-start failed: ${err?.message ?? err}`);
		}
	}

	try {
		const result = await deploy({
			projectDir,
			skipStart,
			uploadOnly: quickOpts?.uploadOnly,
			skipStop: quickOpts?.skipStop,
			// 업로드 스타트: Compile을 보내지 않는다 — Start 의 `-compile` 이 컴파일하므로(§0.7) 중복이다.
			skipCompile: quickOpts?.skipCompile,
			// ProjectLibrary 중 컴파일 루트 밖·같은 projects 폴더의 라이브러리를 /GPL/<값> 으로 함께(libraryUploadPlan.ts).
			uploadLibraries: vscode.workspace.getConfiguration('gpl').get<boolean>('deploy.uploadLibraries', true) !== false,
			skipUnchanged: quickOpts?.skipUnchanged,
			changedFiles: quickOpts?.changedFiles,
			autoGate: quickOpts?.autoGate,
			// 작업 기록(operationStore.ts) — 어느 창의 무슨 작업인지 남겨 타임아웃 뒤에도 결과를 조회할 수 있게(§8·§23).
			idempotencyKey: quickOpts?.idempotencyKey,
			extensionInstanceId: host.extensionInstanceId,
			// 배포 잠금 레코드의 owner — 다른 창/MCP가 "누가 잡고 있는지" 볼 수 있게 경로별로 구분.
			lockOwner: deployLockOwner(quickOpts),
			// 모든 배포는 /GPL 직접 업로드가 기본 (테스트는 /GPL, flash 저장은 gpl.saveToFlash 담당).
			// /GPL/<name>이 없으면 FTP로 생성 — 단 changedFiles(autoOnSave) 경로는 클래식 폴백.
			directGpl: true,
			// Start 스위치: 기본 `-event`(GDE 동일 — 상태 변경을 1403 이벤트로 받는다)
			startEventMode: vscode.workspace.getConfiguration('gpl').get<boolean>('controller.startEventMode', true),
			startConfirmed: quickOpts?.startConfirmed === true,
			// Start 뒤 메인 쓰레드 감시 창(§1-EU) — Error 로 멈추면 runtimeError 로 돌아온다(0 이면 감시 안 함).
			postStartWatchMs: vscode.workspace.getConfiguration('gpl').get<number>('controller.postStartWatchMs', 5000),
			// 활성 쓰레드 감지 시 사용자에게 Stop -all 여부를 모달로 확인.
			// autoOnSave 경로(noStopPrompt)는 저장마다 팝업이 뜨면 방해되므로 조용히 중단 유지.
			confirmStopOnActive: quickOpts?.quick && !quickOpts?.noStopPrompt && !quickOpts?.nonInteractive
				? async (activeDesc: string) => {
					const pick = await vscode.window.showWarningMessage(
						'실행 중인 쓰레드가 있습니다. Stop -all로 정지한 후 Quick Compile을 계속할까요?',
						{ modal: true, detail: `활성 쓰레드: ${activeDesc}` },
						'Stop 후 계속'
					);
					return pick === 'Stop 후 계속';
				}
				: undefined,
			beforeStart: skipStart ? undefined : () => host.primeRuntimeConsoleForStart('Deploy'),
			// FTP 쓰기 전 제어기 정체 확인(controller/connection/controllerIdentity.ts). 사람이 누른 경로만 「그래도 진행」을 묻는다 —
			// AI·자동화(nonInteractive)와 autoOnSave(changedFiles)는 모달 없이 CONTROLLER_UNVERIFIED 로 멈춘다.
			verifyControllerIdentity: vscode.workspace.getConfiguration('gpl').get<boolean>('controller.verifyControllerIdentity', true) !== false,
			// 여유 메모리가 경고 미만이면 업로드 전에 정지 → Unload 로 회수하고 진행(2026-11-04 §1-GZ, 사람·AI 공통 — 확인 없이).
			autoUnloadOnLowMemory: isMemoryAutoUnload(),
			// 정지 뒤 Compile/Start 직전 여유 메모리 심각 → 사람에게 계속/취소(2026-10-27). AI·자동화·autoOnSave 는 경고만.
			confirmMemoryCritical: !quickOpts?.nonInteractive && !quickOpts?.changedFiles?.length && !quickOpts?.uploadOnly
				&& isMemoryConfirmOnCritical()
				? (check, phase) => confirmMemoryCriticalInteractive(check, phase === 'start' ? 'Start' : 'Compile')
				: undefined,
			confirmUnverifiedController: !quickOpts?.nonInteractive && !quickOpts?.changedFiles?.length
				? async check => {
					const pick = await vscode.window.showWarningMessage(
						`${cfg.ip} 이 제어기인지 확인하지 못했습니다 — ${mode} 업로드를 시작하지 않았습니다.`,
						{ modal: true, detail: `${check.reasons.join('\n')}\n\n명령 콘솔: ${check.commandConsoleDetail}\nFTP 배너: ${check.ftpBanner ?? '(읽지 못함)'}\n\n다른 장치에 파일을 올릴 수 있습니다. 제어기임을 알고 있을 때만 진행하세요.` },
						'그래도 진행',
					);
					return pick === '그래도 진행';
				}
				: undefined,
		}, outputChannel, deployDiagnostics);

		const report = { result, projectDir, skipStart, quickOpts, mode, modeLabel, controllerIp: cfg.ip };
		if (reportDeployInterruption(ctx, report)) { return result; }
		if (result.success) {
			await reportDeploySuccess(ctx, report, deployRuntimeConsole);
		} else {
			await reportDeployFailure(ctx, report);
		}
		return result;
	} catch (err: any) {
		host.lastDeploySnapshot = {
			mode: modeLabel,
			success: false,
			lastStage: 'COMPILE',
			compileErrorCodes: [],
			controllerSystemCodes: [],
			updatedAt: Date.now(),
			summary: `배포 예외: ${err?.message ?? err}`,
		};
		vscode.window.showErrorMessage(`배포 오류: ${err.message ?? err}`);
		outputChannel.appendLine(`[Deploy] Error: ${err.stack ?? err}`);
	}
	return undefined;
}
