/**
 * 배포 계열 명령 — Deploy(Build Only)·업로드 스타트·Start·Save to Flash·Quick Compile·autoOnSave,
 * 그리고 자동화(비대화형) 경로의 대상 해석·게이트(개선안 §15~§27, controller/projectTarget.ts).
 *
 * `runDeploy`/`confirmStartWhenCompileStale`/`pickWorkspaceProjectDir` 는 다른 명령 그룹(연결·트리)도
 * 쓰므로 `host.deploy` 로 노출한다.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { isRuntimeConsoleAutoStartOnDeploy } from '../config';
import { getControllerConfig, sendCommand } from '../controller/controllerConnection';
import { describeDeployLock, getDeployLock } from '../controller/deployLock';
import { DeployResult, deploy, findProjectDirs, jumpToFirstCompileError, makeLockedResult } from '../controller/deployService';
import { mirrorProject } from '../controller/ftpClient';
import { checkProjectName, describeProjectNameProblem } from '../controller/projectNameGuard';
import { buildTargetCandidates, pickProjectDir, readGprProjectName } from '../controller/projectPicker';
import { normalizeDirKey } from '../controller/projectPickerCore';
import {
	describeCandidates,
	describeResolution,
	isAutomationInvocation,
	isProjectTargetRequest,
	resolveProjectTarget,
} from '../controller/projectTarget';
import type { ProjectTargetRequest, TargetCandidateSummary } from '../controller/projectTarget';
import {
	classifyErrorEntry,
	extractErrorCodeFromEntry,
	getErrorCodeHint,
	isControllerNonBlockingStatus,
	parseStatus,
} from '../controller/responseParser';
import { RuntimeConsole } from '../controller/runtimeConsole';
import { buildStartCommand } from '../controller/startCommand';
import { getSyncManifest, recordSyncManifest } from '../controller/syncManifest';
import { SituationDeploySnapshot } from '../views/controllerTreeProvider';
import type { ExtensionHost } from './host';

export interface DeployApi {
	runDeploy(skipStart: boolean, quickOpts?: QuickDeployOpts): Promise<DeployResult | undefined>;
	confirmStartWhenCompileStale(projectName: string, projectDir?: string): Promise<boolean>;
	pickWorkspaceProjectDir(placeHolder: string, resource?: unknown): Promise<string | undefined>;
}

export type QuickDeployOpts = {
	skipStop?: boolean; skipUnchanged?: boolean; quick?: boolean; changedFiles?: string[];
	overrideProjectDir?: string; noStopPrompt?: boolean; autoGate?: boolean; skipCompile?: boolean; nonInteractive?: boolean;
};

export function activateDeployCommands(host: ExtensionHost): DeployApi {
	const { context, outputChannel, consoleChannel, deployDiagnostics } = host;

	// 현재는 signature만 중복 알림 억제에 사용된다. mode/timestamp/summary는 향후 진단용 기록.
	const deployOutcomeHistory: Array<{ mode: SituationDeploySnapshot['mode']; signature: string; timestamp: number; summary: string }> = [];
	// 히스토리 상한 — 장시간 세션에서 무한 증가 방지 (초과 시 오래된 항목부터 제거)
	const DEPLOY_OUTCOME_HISTORY_MAX = 50;
	function pushDeployOutcome(entry: (typeof deployOutcomeHistory)[number]): void {
		deployOutcomeHistory.push(entry);
		while (deployOutcomeHistory.length > DEPLOY_OUTCOME_HISTORY_MAX) {
			deployOutcomeHistory.shift();
		}
	}

	/**
	 * 배포 진입점. 잠금은 deploy() 안에서 — 프로젝트 선택/미저장 확인 UI가 끝난 뒤 — 획득한다(UI 대기 중 잠금 금지, 이슈 #15).
	 * 여기서는 이미 잡혀 있으면 컨텍스트와 함께 경고하고 바로 끝낸다. 결과는 호출측(autoOnSave 재예약, Start 전 Compile)이 쓴다.
	 */
	async function runDeploy(skipStart: boolean, quickOpts?: QuickDeployOpts): Promise<DeployResult | undefined> {
		const holder = host.currentDeployLockHolder();
		if (holder) {
			if (quickOpts?.changedFiles?.length) {
				host.log(`[QuickCompile] autoOnSave 대기 — 배포 잠금 보유 중 (${describeDeployLock(holder)})`);
			} else {
				host.warnDeployBusy(
					quickOpts?.quick ? 'Quick Compile' : quickOpts?.skipCompile ? '업로드 스타트' : 'Deploy',
					holder,
					'완료 후 다시 시도하세요',
				);
			}
			return makeLockedResult(holder);
		}
		return runDeployCore(skipStart, quickOpts);
	}

	/**
	 * Start 전 "컴파일 검증 필요" 상태 확인. PA 제어기의 Start는 자체적으로 Compile을 수행하므로(§0.7) 소스에 에러가
	 * 있으면 Start가 실패하고 Problems 연동도 없다 — 먼저 Compile로 검증할지 묻는다. 단 Compile 직후 Start를 연속으로
	 * 보내지 않으므로(한 번에 하나만, 컴파일 중복 회피) "Compile만 실행"을 고르면 Start는 하지 않는다. true면 Start 진행.
	 */
	async function confirmStartWhenCompileStale(projectName: string, projectDir?: string): Promise<boolean> {
		const stale = host.findCompileStale(projectName);
		if (!stale) { return true; }
		const dir = projectDir ?? stale.projectDir;
		const choices = dir ? ['Compile만 실행', '그대로 Start'] : ['그대로 Start'];
		const pick = await vscode.window.showWarningMessage(
			`'${projectName}'의 /GPL 소스가 아직 Compile로 검증되지 않았습니다. Start는 제어기가 자체 컴파일하므로 소스에 에러가 있으면 Start가 실패합니다(Problems 연동 없음).`,
			{
				modal: true,
				detail: `사유: ${stale.reason}\n발생: ${new Date(stale.since).toLocaleString()}\n\n` +
					'"Compile만 실행"은 에러를 확인만 하고 Start하지 않습니다(Compile 직후 Start 연속 실행은 피함 — 한 번에 하나만).',
			},
			...choices,
		);
		if (pick === 'Compile만 실행') {
			await runDeploy(true, { skipStop: true, skipUnchanged: true, quick: true, overrideProjectDir: dir });
			return false;
		}
		return pick === '그대로 Start';
	}

	/**
	 * projectDir 하위의 저장되지 않은(dirty) 파일이 있으면 저장 여부를 모달로 확인하고 저장한다.
	 * 업로드는 디스크 내용을 올리므로, 미저장 편집분이 있으면 이전 내용이 올라가 혼동을 유발한다
	 * (Start 확인 모달과 같은 패턴 — '저장 후 계속' + 취소).
	 * 반환: ok=false면 사용자가 취소했거나 저장 실패 — 호출측은 업로드를 시작하지 말 것.
	 * ※ autoOnSave 같은 저장-트리거 경로에서는 호출 금지(저장 경로에서는 UI를 띄우지 않는다).
	 */
	/** projectDir 하위의 저장되지 않은 편집기 문서 — 대화형/자동화 경로 공용. */
	function dirtyDocsUnder(projectDir: string): vscode.TextDocument[] {
		const root = path.resolve(projectDir);
		return vscode.workspace.textDocuments.filter(doc => {
			if (doc.uri.scheme !== 'file' || !doc.isDirty) { return false; }
			const rel = path.relative(root, path.resolve(doc.uri.fsPath));
			return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
		});
	}

	async function confirmSaveDirtyProjectDocs(projectDir: string): Promise<{ ok: boolean; savedFiles: string[] }> {
		const dirtyDocs = dirtyDocsUnder(projectDir);
		if (dirtyDocs.length === 0) { return { ok: true, savedFiles: [] }; }

		const names = dirtyDocs.map(d => path.basename(d.uri.fsPath)).join('\n');
		const pick = await vscode.window.showWarningMessage(
			`저장되지 않은 파일 ${dirtyDocs.length}개가 있습니다. 저장 후 업로드할까요?`,
			{ modal: true, detail: `저장하지 않으면 디스크의 이전 내용이 업로드됩니다.\n\n${names}` },
			'저장 후 계속'
		);
		if (pick !== '저장 후 계속') { return { ok: false, savedFiles: [] }; }

		const savedFiles: string[] = [];
		for (const doc of dirtyDocs) {
			if (await doc.save()) {
				savedFiles.push(doc.uri.fsPath);
			} else {
				vscode.window.showErrorMessage(`파일 저장 실패: ${path.basename(doc.uri.fsPath)} — 업로드를 중단합니다.`);
				return { ok: false, savedFiles };
			}
		}
		return { ok: true, savedFiles };
	}

	async function runDeployCore(skipStart: boolean, quickOpts?: QuickDeployOpts): Promise<DeployResult | undefined> {
		const modeLabel: SituationDeploySnapshot['mode'] = skipStart
			? 'Build'
			: quickOpts?.skipCompile ? 'Upload & Start' : 'Deploy & Run';
		const uniqueCodes = (values: number[]): number[] => [...new Set(values)];
		const buildOutcomeSignature = (result: Awaited<ReturnType<typeof deploy>>, controllerSystemCodes: number[]): string => {
			const compileCodes = uniqueCodes(result.compileErrors.map(e => e.code)).sort((a, b) => a - b);
			const systemCodes = uniqueCodes(controllerSystemCodes).sort((a, b) => a - b);
			const status = typeof result.failedStatusCode === 'number' ? result.failedStatusCode : 'none';
			return [
				result.success ? 'success' : 'fail',
				result.failedPhase ?? 'SUCCESS',
				result.failedCommand ?? '-',
				`status:${status}`,
				`compile:${compileCodes.join(',') || 'none'}`,
				`system:${systemCodes.join(',') || 'none'}`,
			].join('|');
		};
		const makeRawCompileSummary = (result: Awaited<ReturnType<typeof deploy>>): string[] => {
			return result.compileAttemptLogs.map(attempt => {
				const firstLine = attempt.raw.replace(/\r/g, '').split('\n').map(l => l.trim()).find(Boolean) || '(empty)';
				const incompleteMeta = attempt.responseMeta && !attempt.responseMeta.responseComplete
					? ` / responseComplete=false bytes=${attempt.responseMeta.bytesReceived} idle=${attempt.responseMeta.idleTimeoutMs}ms`
					: '';
				const note = attempt.note ? ` / note=${attempt.note}` : '';
				return `${attempt.command} / STATUS ${attempt.statusCode}${incompleteMeta}${note} / ${firstLine}`;
			});
		};
		const makeDeploySnapshot = (
			success: boolean,
			lastStage: SituationDeploySnapshot['lastStage'],
			summary: string,
			compileErrorCodes: number[],
			controllerSystemCodes: number[],
			comparisonNote?: string,
			unverifiableReason?: string,
			compileRawSummary?: string[],
		): SituationDeploySnapshot => ({
			mode: modeLabel,
			success,
			lastStage,
			compileErrorCodes: uniqueCodes(compileErrorCodes),
			controllerSystemCodes: uniqueCodes(controllerSystemCodes),
			updatedAt: Date.now(),
			summary,
			comparisonNote,
			unverifiableReason,
			compileRawSummary,
		});

		const cfg = getControllerConfig();

		let projectDir: string;
		if (quickOpts?.overrideProjectDir) {
			// 저장 파일이 속한 프로젝트가 이미 결정된 경우(autoOnSave 등) QuickPick 없이 그대로 사용.
			projectDir = quickOpts.overrideProjectDir;
		} else {
			const picked = await pickWorkspaceProjectDir('배포할 프로젝트를 선택하세요');
			if (!picked) { return; }
			projectDir = picked;
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

		const mode = quickOpts?.quick
			? 'Quick Compile'
			: skipStart ? 'Build' : quickOpts?.skipCompile ? '업로드 스타트' : 'Deploy & Run';
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
				skipStop: quickOpts?.skipStop,
				// 업로드 스타트: Compile을 보내지 않는다 — 제어기의 Start가 자체 컴파일하므로(§0.7) 중복이다.
				skipCompile: quickOpts?.skipCompile,
				skipUnchanged: quickOpts?.skipUnchanged,
				changedFiles: quickOpts?.changedFiles,
				autoGate: quickOpts?.autoGate,
				// 배포 잠금 레코드의 owner — 다른 창/MCP가 "누가 잡고 있는지" 볼 수 있게 경로별로 구분.
				lockOwner: quickOpts?.changedFiles?.length
					? 'autoOnSave Quick Compile'
					: quickOpts?.quick ? 'Quick Compile' : quickOpts?.skipCompile ? 'Upload & Start' : 'Deploy',
				// 모든 배포는 /GPL 직접 업로드가 기본 (테스트는 /GPL, flash 저장은 gpl.saveToFlash 담당).
				// /GPL/<name>이 없으면 FTP로 생성 — 단 changedFiles(autoOnSave) 경로는 클래식 폴백.
				directGpl: true,
				// Start 스위치: 기본 `-event`(GDE 동일 — 상태 변경을 1403 이벤트로 받는다)
				startEventMode: vscode.workspace.getConfiguration('gpl').get<boolean>('controller.startEventMode', true),
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
				beforeStart: skipStart ? undefined : async () => {
					const console = host.ensureRuntimeConsole();
					console.primeForRuntimeStart();
					await console.waitUntilReady(1200);
					host.controllerTree?.setRuntimeConsoleStatus(console.getStatusSnapshot());
				},
			}, outputChannel, deployDiagnostics);

			// 배포 잠금 보유 중(UI 확인이 끝난 사이 다른 창/autoOnSave가 먼저 잡은 경우) — 컨텍스트와 함께 안내.
			if (result.failedPhase === 'LOCKED') {
				if (quickOpts?.changedFiles?.length) {
					host.log(`[QuickCompile] autoOnSave 대기 — ${result.failedStatusMessage ?? '배포 잠금 보유 중'}`);
				} else if (result.lockHolder) {
					host.warnDeployBusy(mode, result.lockHolder, '완료 후 다시 시도하세요');
				}
				return result;
			}

			// autoOnSave 자동 게이트 미충족 — 실패가 아니라 "스킵"이다.
			// 저장마다 팝업/패널 포커스/스냅샷 기록이 생기면 방해되므로 로그 한 줄만 남긴다.
			if (!result.success && result.failedPhase === 'AUTO_GATE') {
				host.log(`[QuickCompile] autoOnSave 건너뜀: ${result.failedStatusMessage ?? '게이트 미충족'}`);
				return result;
			}

			// 업로드는 됐지만 Compile은 보류(autoOnSave: 쓰레드 존재) — 팝업 없이 "컴파일 필요" 상태로만 표시(이슈 #17).
			if (!result.success && result.failedPhase === 'COMPILE_DEFERRED') {
				host.markCompileStale(result.projectName, 'autoOnSave 업로드 후 Compile 보류(쓰레드 존재)', projectDir);
				host.log(`[QuickCompile] autoOnSave: ${result.failedStatusMessage ?? '업로드 완료, Compile 보류'}`);
				return result;
			}

			// 활성 쓰레드 + Stop 미승인(또는 자동 경로) — 업로드는 완료, Compile 미수행. 실패가 아닌 "중단"으로 다룬다.
			if (!result.success && result.failedPhase === 'THREAD_CHECK') {
				host.markCompileStale(result.projectName, `${mode} 업로드 후 Compile 미수행(활성 쓰레드)`, projectDir);
				const msg = `${mode} 중단: ${result.failedStatusMessage ?? '활성 쓰레드 존재'}`;
				host.log(`[Deploy] ${msg}`);
				host.lastDeploySnapshot = makeDeploySnapshot(false, 'THREAD_CHECK', msg, [], []);
				if (!quickOpts?.changedFiles?.length) { vscode.window.showWarningMessage(msg); }
				return result;
			}

			// errorLog를 제어기 시스템 에러 / GPL 배포 에러로 분류해 출력 채널에 기록한다.
			// 이 함수는 성공·실패 경로 공통으로 호출된다.
			function logErrorLogSections(): { sysCount: number; deployErrCount: number } {
				let sysCount = 0;
				let deployErrCount = 0;
				if (result.errorLog.length === 0) { return { sysCount, deployErrCount }; }

				host.log('');
				host.log('── [ErrorLog 분류] ──────────────────────────────────────');
				// 같은 코드가 연달아 나오면(예: Trj/AutoEx 동시 -1600) 동일한 설명이 항목마다
				// 반복돼 로그가 부푼다 — 부가 설명(detail/해석/권장)은 코드당 한 번만 출력한다.
				const printedNotes = new Set<string>();
				for (const entry of result.errorLog) {
					const c = classifyErrorEntry(entry);
					const code = extractErrorCodeFromEntry(entry) ?? c.parsedCode;
					const hint = typeof code === 'number' ? getErrorCodeHint(code) : undefined;
					const noteKey = typeof code === 'number' ? `code:${code}` : `text:${c.summary}`;
					const firstOfCode = !printedNotes.has(noteKey);
					printedNotes.add(noteKey);
					if (c.isControllerSystem) {
						sysCount++;
						host.log(`[⚠ 환경 경고] ${typeof code === 'number' ? `[${code}] ` : ''}${c.summary}`);
						if (firstOfCode) {
							if (c.detail) { host.log(`          ${c.detail}`); }
							if (hint) {
								host.log(`          해석: ${hint.meaning}`);
								host.log(`          권장: ${hint.action}`);
							}
						}
					} else {
						deployErrCount++;
						host.log(`[✘ 코드/배포 에러] ${typeof code === 'number' ? `[${code}] ` : ''}${c.summary}`);
						if (firstOfCode && hint) {
							host.log(`          해석: ${hint.meaning}`);
							host.log(`          권장: ${hint.action}`);
						}
					}
				}
				host.log('─────────────────────────────────────────────────────────');
				return { sysCount, deployErrCount };
			}

			function logCompileRawSection(): void {
				if (result.compileAttemptLogs.length === 0) { return; }
				host.log('');
				host.log('── [COMPILE 원문 로그] ──────────────────────────────────');
				for (const attempt of result.compileAttemptLogs) {
					host.log(`[${attempt.command}] STATUS ${attempt.statusCode}`);
					if (attempt.note) {
						host.log(`  note: ${attempt.note}`);
					}
					if (attempt.responseMeta && (!attempt.responseMeta.responseComplete || !attempt.responseMeta.statusTagReceived || !attempt.responseMeta.dataTagClosed)) {
						host.log(`  responseComplete=${attempt.responseMeta.responseComplete}`);
						host.log(`  bytesReceived=${attempt.responseMeta.bytesReceived}`);
						host.log(`  lastChunkAt=${attempt.responseMeta.lastChunkAt}`);
						host.log(`  idleTimeoutMs=${attempt.responseMeta.idleTimeoutMs}`);
					}
					host.log(attempt.raw || '(empty)');
					if (attempt.errors.length > 0) {
						for (const ce of attempt.errors) {
							host.log(`  -> ${ce.file}:${ce.line} (${ce.code}) ${ce.message}`);
						}
					}
				}
				if (result.precheckWarnings.length > 0) {
					host.log('  precheckWarnings:');
					for (const w of result.precheckWarnings) {
						host.log(`  - ${w}`);
					}
				}
				host.log('─────────────────────────────────────────────────────────');
			}

			if (result.success) {
				host.clearCompileStale(result.projectName);
				const controllerSystemCodes = result.errorLog
					.map(e => classifyErrorEntry(e).parsedCode)
					.filter((code): code is number => typeof code === 'number');
				const signature = buildOutcomeSignature(result, controllerSystemCodes);
				const samePattern = deployOutcomeHistory.filter(h => h.signature === signature);
				const comparisonNote = samePattern.length > 0
					? `회귀 아님: 동일 결과 패턴 ${samePattern.length + 1}회 관측`
					: undefined;
				pushDeployOutcome({ mode: modeLabel, signature, timestamp: Date.now(), summary: result.success ? '성공' : '실패' });
				const deployedFolderName = path.basename(projectDir).trim();
				const remotePathInfo = result.selectedRemoteProjectPath
					? ` / 경로: ${result.selectedRemoteProjectPath}`
					: '';
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
					const { sysCount } = logErrorLogSections();
					if (sysCount > 0) {
						// Build Only이므로 START는 미실행. 제어기 시스템 에러는 배포와 무관하므로 경고만 표시.
						outputChannel.show(true);
						await vscode.window.showWarningMessage(
							`빌드 완료: ${result.projectName}. 제어기 시스템 경고 ${sysCount}건 (배포/GPL 오류 아님) → 출력 채널 확인`,
							'출력 보기',
						);
					} else {
						vscode.window.showInformationMessage(`빌드 완료: ${result.projectName}${remotePathInfo} (FTP/컨텍스트 갱신 완료, Start 미실행)`);
						consoleChannel.show(true);
					}
					host.lastDeploySnapshot = makeDeploySnapshot(
						true,
						'SUCCESS',
						sysCount > 0
							? `빌드 성공 / 제어기 시스템 경고 ${sysCount}건${remotePathInfo}`
							: `빌드 성공${remotePathInfo}`,
						[],
						controllerSystemCodes,
						comparisonNote,
					);
				} else {
					const { sysCount, deployErrCount } = logErrorLogSections();
					if (sysCount > 0 || deployErrCount > 0) {
						outputChannel.show(true);
						const parts: string[] = [];
						if (deployErrCount > 0) { parts.push(`배포 에러 ${deployErrCount}건`); }
						if (sysCount > 0) { parts.push(`제어기 시스템 경고 ${sysCount}건 (배포 원인 아님)`); }
						const action = await vscode.window.showWarningMessage(
							`배포 완료: ${result.projectName} — ${parts.join(' / ')}`,
							'출력 보기',
							'콘솔 보기',
						);
						if (action === '콘솔 보기') {
							if (!deployRuntimeConsole) {
								deployRuntimeConsole = host.ensureRuntimeConsole();
								await deployRuntimeConsole.waitUntilReady(800);
							}
							consoleChannel.show(true);
						} else {
							outputChannel.show(true);
						}
					} else {
						vscode.window.showInformationMessage(`배포 완료: ${result.projectName}${remotePathInfo}`);
						if (!deployRuntimeConsole && isRuntimeConsoleAutoStartOnDeploy(vscode.workspace)) {
							deployRuntimeConsole = host.ensureRuntimeConsole();
							await deployRuntimeConsole.waitUntilReady(800);
						}
						consoleChannel.show(true);
					}
					host.lastDeploySnapshot = makeDeploySnapshot(
						true,
						'SUCCESS',
						sysCount > 0 || deployErrCount > 0
							? `배포 성공 / 배포 에러 ${deployErrCount}건 / 시스템 경고 ${sysCount}건${remotePathInfo}`
							: `배포 성공${remotePathInfo}`,
						[],
						controllerSystemCodes,
						comparisonNote,
					);
				}
			} else {
				logErrorLogSections();
				logCompileRawSection();
				outputChannel.show(true);
				if (result.uploadStats) {
					// 업로드는 됐고 Compile이 실패 — 컴파일본은 이전 상태이므로 Start 전 확인 대상.
					host.markCompileStale(
						result.projectName,
						quickOpts?.skipCompile && result.failedPhase === 'START'
							// 업로드 스타트는 Compile을 보내지 않는다 — Start 실패는 제어기 자체 컴파일 실패일 수 있고
							// 그 경우 에러 위치가 Problems에 오지 않으므로 빠른 컴파일로 확인하도록 남긴다(§0.7).
							? '업로드 스타트: Start 실패 — 소스 에러 여부는 빠른 컴파일로 확인 필요'
							: `${mode} 업로드 후 Compile 실패(${result.failedPhase ?? 'FAIL'})`,
						projectDir,
					);
				}
				const phaseLabel = result.failedPhase ? ` (${result.failedPhase} 단계)` : '';
				const sysErrors = result.errorLog.filter(e => classifyErrorEntry(e).isControllerSystem);
				const sysCodes = sysErrors
					.map(e => classifyErrorEntry(e).parsedCode)
					.filter((code): code is number => typeof code === 'number');
				const signature = buildOutcomeSignature(result, sysCodes);
				const samePattern = deployOutcomeHistory.filter(h => h.signature === signature);
				const comparisonNote = samePattern.length > 0
					? `회귀 아님: 동일 실패 패턴 ${samePattern.length + 1}회 관측`
					: undefined;
				pushDeployOutcome({ mode: modeLabel, signature, timestamp: Date.now(), summary: result.failedPhase ?? 'FAIL' });
				const sysLabel = sysErrors.length > 0
					? ` / 제어기 시스템 경고 ${sysErrors.length}건 (배포 원인 아님)`
					: '';
				const envBlocking = (result.failedPhase === 'COMPILE') && sysErrors.length > 0;
				const unverifiableReason = envBlocking ? '제어기 환경 오류가 COMPILE 단계에 존재' : undefined;
				const commandLabel = result.failedCommand ? ` / ${result.failedCommand}` : '';
				const statusLabel = typeof result.failedStatusCode === 'number'
					? ` / STATUS ${result.failedStatusCode}${result.failedStatusMessage ? ` (${result.failedStatusMessage})` : ''}`
					: '';

				let errMsg: string;
				if (envBlocking) {
					errMsg = `코드 수정 효과 검증 불가: COMPILE 환경 블로커 감지${phaseLabel}${commandLabel}${statusLabel}${sysLabel} — COMPILE 원문 로그 확인`;
				} else if (result.compileErrors.length > 0) {
					errMsg = `${result.compileErrors.length}개 컴파일 에러${phaseLabel}${commandLabel}${statusLabel}${sysLabel} — COMPILE 원문 로그 확인`;
					await jumpToFirstCompileError(result.compileErrors, projectDir,
						msg => outputChannel.appendLine(`[Deploy] ${msg}`));
				} else if (sysErrors.length > 0 && result.errorLog.length === sysErrors.length) {
					// 에러 로그 전체가 제어기 시스템 에러인 경우 — GPL 코드 원인 없음을 명시
					const firstSys = classifyErrorEntry(sysErrors[0]);
					errMsg = `${result.failedPhase ?? '단계 미상'} 단계 실패${commandLabel}${statusLabel} — GPL 코드 오류 없음, 제어기 시스템 경고 ${sysErrors.length}건: ${firstSys.summary}`;
				} else {
					errMsg = `알 수 없는 오류${phaseLabel}${commandLabel}${statusLabel}${sysLabel} — COMPILE 원문 로그 확인`;
				}
				if (comparisonNote) {
					errMsg = `${errMsg} / ${comparisonNote}`;
				}
				if (result.selectedRemoteProjectPath) {
					errMsg = `${errMsg} / 경로: ${result.selectedRemoteProjectPath}`;
				}

				vscode.window.showErrorMessage(`배포 실패: ${errMsg}`);
				host.lastDeploySnapshot = makeDeploySnapshot(
					false,
					(result.failedPhase ?? 'COMPILE') as SituationDeploySnapshot['lastStage'],
					errMsg,
					result.compileErrors.map(e => e.code),
					sysCodes,
					comparisonNote,
					unverifiableReason,
					makeRawCompileSummary(result),
				);
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
	}

	/**
	 * 워크스페이스에서 .gpr 프로젝트 폴더를 선택한다 (공용 규칙: controller/projectPicker.ts).
	 * resource(탐색기 우클릭한 폴더/.gpr/소스 파일)가 있으면 QuickPick 없이 그 프로젝트로 확정,
	 * 없으면 1개는 즉시·여러 개는 QuickPick(최근 선택 우선). 명령 인자의 첫 값은 VS Code가
	 * 메뉴에서 넘기는 Uri이고 팔레트/트리에서는 undefined 또는 비-Uri일 수 있어 Uri만 인정한다.
	 */
	async function pickWorkspaceProjectDir(placeHolder: string, resource?: unknown): Promise<string | undefined> {
		const dir = await pickProjectDir({ placeHolder, resource: resource instanceof vscode.Uri ? resource : undefined });
		// 사람이 고른 대상을 세션 대상으로도 기억한다 — 뒤이은 자동화 호출이 같은 프로젝트를 다시 묻지 않게(개선안 §19·§26).
		if (dir) { automationTargetDir = dir; }
		return dir;
	}

	// ── 자동화(비대화형) 경로 — 개선안 §15~§27 (규칙: controller/projectTarget.ts) ────────────────
	// 사람용 명령(팔레트·탐색기 우클릭·트리)은 종전대로 QuickPick/모달을 쓰고, **인자로 대상을 받은 호출**
	// (MCP 브리지·URI·다른 확장)은 UI 를 절대 띄우지 않고 구조화된 결과를 돌려준다. 두 경로를 섞지 않는다.
	// active editor 는 자동화 대상 결정에 쓰지 않는다 — 어느 탭을 열어 뒀는지는 사람의 UI 상태다(§22).

	/** 세션 한정 자동화 대상(메모리 전용, 디스크 미저장). 명시 지정·사람의 QuickPick 선택으로 갱신된다. */
	let automationTargetDir: string | undefined;

	interface AutomationTargetArgs extends ProjectTargetRequest {
		/** true면 대상 폴더의 미저장 편집분을 저장하고 계속한다. 기본은 UNSAVED_FILES 오류(사람 편집분을 몰래 저장하지 않는다). */
		saveDirty?: boolean;
		/** Start 계열 — 모션 확인을 사용자에게 이미 받았음을 호출자가 단언한다(확인 모달을 대신한다, 하드 규칙 6). */
		confirmStart?: boolean;
		/** Start 계열 — "컴파일 검증 필요" 상태여도 그대로 Start 한다. */
		ignoreCompileStale?: boolean;
	}

	type AutomationErrorCode =
		| 'NO_GPL_PROJECT' | 'PROJECT_NOT_FOUND' | 'PROJECT_AMBIGUOUS'
		| 'UNSAVED_FILES' | 'INTERACTIVE_UI_REQUIRED' | 'COMPILE_UNVERIFIED';

	interface AutomationFailure {
		ok: false;
		error: AutomationErrorCode;
		detail: string;
		candidates?: TargetCandidateSummary[];
		files?: string[];
	}

	function isAutomationFailure(v: unknown): v is AutomationFailure {
		return typeof v === 'object' && v !== null && (v as AutomationFailure).ok === false && typeof (v as AutomationFailure).error === 'string';
	}

	/** 설정 `gpl.controller.defaultProject` — 프로젝트명 또는 폴더명. 빈 문자열이면 없음. */
	function getConfiguredDefaultProject(): string | undefined {
		const v = vscode.workspace.getConfiguration('gpl.controller').get<string>('defaultProject', '');
		return typeof v === 'string' && v.trim() ? v.trim() : undefined;
	}

	/**
	 * 자동화 대상 해석. **UI 를 띄우지 않고 active editor 를 보지 않는다.** 성공하면 세션 대상을 갱신한다.
	 * 실패는 예외가 아니라 구조화된 결과 — 호출자(AI)가 그대로 읽고 다음에 무엇을 지정할지 알 수 있게.
	 */
	async function resolveAutomationTarget(
		request: ProjectTargetRequest | undefined,
		label: string,
	): Promise<{ ok: true; dir: string; projectName: string } | AutomationFailure> {
		const candidates = await buildTargetCandidates();
		const r = resolveProjectTarget(request, candidates, {
			sessionTargetDir: automationTargetDir,
			configuredDefault: getConfiguredDefaultProject(),
		});
		if (!r.ok) {
			host.log(`[Automation] ${label}: ${describeResolution(r)} · 후보: ${describeCandidates(r.candidates)}`);
			return { ok: false, error: r.error, detail: r.detail, candidates: r.candidates };
		}
		automationTargetDir = r.dir;
		host.log(`[Automation] ${label}: 대상 ${describeResolution(r)}`);
		return { ok: true, dir: r.dir, projectName: r.projectName };
	}

	/**
	 * 자동화 경로의 미저장 파일 처리. 기본은 오류로 알린다 — 업로드는 디스크 내용을 올리므로 사람의 미저장
	 * 편집분이 있으면 이전 내용이 올라간다. `saveDirty: true`로 호출자가 저장을 승인하면 저장하고 계속한다.
	 */
	async function handleDirtyForAutomation(projectDir: string, args: AutomationTargetArgs, label: string): Promise<AutomationFailure | undefined> {
		const dirty = dirtyDocsUnder(projectDir);
		if (dirty.length === 0) { return undefined; }
		const files = dirty.map(d => d.uri.fsPath);
		if (!args.saveDirty) {
			host.log(`[Automation] ${label}: 미저장 파일 ${files.length}개 — 업로드하지 않음 (saveDirty:true 로 저장 승인 가능)`);
			return {
				ok: false,
				error: 'UNSAVED_FILES',
				detail: `대상 프로젝트에 저장되지 않은 편집기 문서가 ${files.length}개 있습니다. 업로드는 디스크 내용을 올리므로 이전 내용이 올라갑니다. `
					+ '사용자에게 저장을 요청하거나, 저장해도 된다면 `saveDirty: true` 로 다시 호출하세요.',
				files,
			};
		}
		for (const doc of dirty) {
			if (!(await doc.save())) {
				return { ok: false, error: 'UNSAVED_FILES', detail: `파일 저장 실패: ${path.basename(doc.uri.fsPath)} — 업로드를 중단했습니다.`, files };
			}
			quickCompilePendingFiles.delete(doc.uri.fsPath);
		}
		host.log(`[Automation] ${label}: 미저장 파일 ${files.length}개 저장 후 계속 (saveDirty)`);
		return undefined;
	}

	/**
	 * Start 를 보내는 자동화 경로의 모션 확인 게이트(하드 규칙 6). **모달을 띄우지 않는다** — 비대화형 호출에서
	 * 모달을 열면 호출자가 응답 없이 멈추고 사용자가 대신 눌러야 한다(개선안 §17·§25).
	 *
	 * 통과 조건은 둘 중 하나다: ① 사용자가 확인 모달을 스스로 껐다
	 * (`gpl.controller.requireStartConfirmation: false`) ② 호출자가 `confirmStart: true` 로 **사용자 확인을
	 * 이미 받았음을 단언**한다. 그 밖에는 INTERACTIVE_UI_REQUIRED 를 돌려주고, 대안(1402 `Start` 직접 전송)을 알린다.
	 * 접근을 막는 것이 아니라 "무엇을 하면 통과되는지"를 응답에 싣는 방식이다.
	 */
	function startMotionGate(label: string, args: AutomationTargetArgs): AutomationFailure | undefined {
		const required = vscode.workspace.getConfiguration('gpl').get<boolean>('controller.requireStartConfirmation', true);
		if (required === false) { return undefined; }
		if (args.confirmStart === true) {
			host.log(`[Automation] ${label}: confirmStart:true — 호출자가 사용자 모션 확인을 단언함(확인 모달 생략)`);
			return undefined;
		}
		host.log(`[Automation] ${label}: 모션 확인 미충족 — INTERACTIVE_UI_REQUIRED (모달을 띄우지 않음)`);
		return {
			ok: false,
			error: 'INTERACTIVE_UI_REQUIRED',
			detail: '이 명령은 로봇을 움직일 수 있는 Start 를 보내므로 사용자 확인이 필요합니다(설정 '
				+ '`gpl.controller.requireStartConfirmation`, 기본 켜짐). 비대화형 호출에서는 확인 모달을 띄우지 않습니다 — '
				+ '사용자에게 실행 여부를 물어 확인을 받은 뒤 `confirmStart: true` 로 다시 호출하거나, 사용자가 VS Code 에서 '
				+ '직접 실행하게 하세요. 이미 올라간 프로젝트를 그냥 돌리는 것이면 1402 `Start <project>`(MCP `start_project`)를 '
				+ '쓰는 편이 낫습니다 — 확장 UI 경로를 거치지 않습니다.',
		};
	}

	/**
	 * "컴파일 검증 필요"(업로드했지만 Compile 로 검증되지 않음) 상태의 자동화 게이트. Start 는 제어기가 자체
	 * 컴파일하므로 소스 에러가 있으면 Start 가 실패하고 Problems 연동도 없다(§0.7) — 그 사실을 오류로 알린다.
	 */
	function compileStaleGate(label: string, projectName: string, args: AutomationTargetArgs): AutomationFailure | undefined {
		const stale = host.findCompileStale(projectName);
		if (!stale || args.ignoreCompileStale === true) { return undefined; }
		host.log(`[Automation] ${label}: 컴파일 미검증 — COMPILE_UNVERIFIED (${stale.reason})`);
		return {
			ok: false,
			error: 'COMPILE_UNVERIFIED',
			detail: `'${projectName}' 의 /GPL 소스가 아직 Compile 로 검증되지 않았습니다(사유: ${stale.reason}). `
				+ 'Start 는 제어기가 자체 컴파일하므로 소스에 에러가 있으면 Start 가 실패하고 에러 위치가 Problems 에 오지 않습니다. '
				+ '먼저 `gpl.quickCompile` 로 에러를 확인하거나, 그대로 진행하려면 `ignoreCompileStale: true` 로 다시 호출하세요.',
		};
	}

	/** 배포 계열 자동화 진입 공통: 대상 해석 → 미저장 처리 → runDeploy. */
	async function runDeployForAutomation(
		label: string,
		args: AutomationTargetArgs,
		skipStart: boolean,
		opts: Omit<QuickDeployOpts, 'overrideProjectDir' | 'nonInteractive'>,
	): Promise<DeployResult | AutomationFailure | undefined> {
		const target = await resolveAutomationTarget(args, label);
		if (isAutomationFailure(target)) { return target; }
		const dirty = await handleDirtyForAutomation(target.dir, args, label);
		if (dirty) { return dirty; }
		return runDeploy(skipStart, { ...opts, overrideProjectDir: target.dir, nonInteractive: true });
	}

	/**
	 * `gpl.automation.target` — 세션 자동화 대상 조회/고정/해제 (개선안 §19·§27).
	 *
	 * 대상 없이 부르면 현재 상태(고정된 대상·후보 목록·설정 기본값)를 돌려준다 — "왜 이 프로젝트가 올라갔지?"를
	 * 사후 추론하지 않고 바로 확인하기 위한 것이다. 대상을 주면 해석해 세션에 고정하고, 이후 `gpl.deploy` 등을
	 * 인자 없이(또는 대상 없는 객체로) 불러도 같은 프로젝트가 쓰인다. `clear: true` 면 고정을 푼다.
	 */
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.automation.target', async (args?: unknown) => {
			const a = (typeof args === 'object' && args !== null ? args : {}) as ProjectTargetRequest & { clear?: boolean };
			if (a.clear === true) {
				automationTargetDir = undefined;
				host.log('[Automation] 세션 대상 해제');
			} else if (isProjectTargetRequest(a)) {
				const target = await resolveAutomationTarget(a, 'gpl.automation.target');
				if (isAutomationFailure(target)) { return target; }
			}
			const candidates = await buildTargetCandidates();
			const current = automationTargetDir
				? candidates.find(c => normalizeDirKey(c.dir) === normalizeDirKey(automationTargetDir!))
				: undefined;
			return {
				ok: true,
				target: current ? { project: current.projectName, dir: current.dir, runnable: current.runnable } : null,
				configuredDefault: getConfiguredDefaultProject() ?? null,
				candidates: candidates.map(c => ({
					project: c.projectName,
					dir: c.dir,
					runnable: c.runnable,
					...(c.referencedAsLibraryBy ? { referencedAsLibraryBy: c.referencedAsLibraryBy } : {}),
				})),
				hint: current
					? '이 대상이 인자 없는 자동화 호출에 쓰입니다. 다른 프로젝트를 쓰려면 그 호출에 project/projectDir 를 직접 주세요.'
					: '고정된 대상이 없습니다 — 자동화 호출은 실행 가능 프로젝트가 유일하거나 설정 기본값이 있을 때만 자동 결정되고, 그 밖에는 PROJECT_AMBIGUOUS 를 돌려줍니다.',
			};
		})
	);

	// gpl.deploy — Stop + /GPL 직접 업로드 + Compile (Start 안 함, 디버그 친화)
	// 인자에 따라 세 경로: ① 대상 지정 객체({project|projectDir|projectFile}) → **비대화형**(UI 없음, 구조화 결과)
	// ② Uri(탐색기 우클릭) → 그 프로젝트로 확정 ③ 인자 없음(팔레트·트리) → 종전 대화형 QuickPick.
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.deploy', async (resource?: unknown) => {
			if (isAutomationInvocation(resource)) {
				return runDeployForAutomation('gpl.deploy', resource as AutomationTargetArgs, true, {});
			}
			if (resource instanceof vscode.Uri) {
				const dir = await pickWorkspaceProjectDir('배포할 프로젝트를 선택하세요', resource);
				if (!dir) { return undefined; }
				return runDeploy(true, { overrideProjectDir: dir });
			}
			return runDeploy(true);
		})
	);

	// gpl.uploadStart — Stop + /GPL 직접 업로드 + Start. Compile은 보내지 않는다.
	// PA 제어기의 Start가 자체적으로 Compile을 수행하므로(사용자 실사용 사실, ai-handoff §0.7)
	// 확장이 Compile을 먼저 보내면 같은 컴파일이 두 번 돈다. 대신 소스 에러는 Problems 대신
	// Start의 STATUS 실패로만 드러나므로, 에러 위치가 필요하면 '빠른 컴파일'(gpl.quickCompile)을 쓴다.
	// Start 확인 모달·배포 잠금·프로젝트명 가드는 모두 기존 배포 경로와 동일하게 적용된다.
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.uploadStart', async (resource?: unknown) => {
			const uploadStart = { skipCompile: true } as const;
			if (isAutomationInvocation(resource)) {
				// Start 를 보내는 경로 — 모션 확인 없이 자동으로 실행하지 않는다(하드 규칙 6).
				const args = resource as AutomationTargetArgs;
				const gate = startMotionGate('gpl.uploadStart', args);
				if (gate) { return gate; }
				return runDeployForAutomation('gpl.uploadStart', args, false, { ...uploadStart });
			}
			if (resource instanceof vscode.Uri) {
				const dir = await pickWorkspaceProjectDir('업로드 후 시작할 프로젝트를 선택하세요', resource);
				if (!dir) { return undefined; }
				return runDeploy(false, { ...uploadStart, overrideProjectDir: dir });
			}
			return runDeploy(false, { ...uploadStart });
		})
	);

	// gpl.start — 배포 없이 Start만 전송. (구 gpl.deployRun의 START 단계를 분리한 것 — 확인 모달은 §0.6대로 적용.)
	// ※ 2026-07-24의 "Deploy와 Start를 합치지 않는다"는 결정은 2026-08-31 사용자 결정으로 갱신됐다:
	//   업로드+실행을 한 번에 하는 경로는 gpl.uploadStart가 담당하되 Compile은 보내지 않는다(§0.7, §1-CD).
	//   이 명령은 "이미 올라간 것을 다시 돌리기"용으로 그대로 남는다.
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.start', async (resource?: unknown) => {
			// 업로드/컴파일 도중 Start가 겹치면 제어기 이상(사망)을 유발할 수 있다 — 배포 잠금(다른 창/프로세스 포함)으로 차단.
			const busy = host.currentDeployLockHolder();
			if (busy) {
				host.warnDeployBusy('Start', busy, '완료 후 Start를 실행하세요 (업로드 중 Start는 제어기 이상을 유발할 수 있음)');
				return;
			}
			// 대상 지정 객체로 불렸으면 비대화형 — QuickPick·모달을 띄우지 않고 구조화된 결과를 돌려준다(개선안 §17·§25).
			const auto = isAutomationInvocation(resource) ? resource as AutomationTargetArgs : undefined;
			let projectDir: string | undefined;
			if (auto) {
				const target = await resolveAutomationTarget(auto, 'gpl.start');
				if (isAutomationFailure(target)) { return target; }
				projectDir = target.dir;
			} else {
				projectDir = await pickWorkspaceProjectDir('시작할 프로젝트를 선택하세요', resource);
			}
			if (!projectDir) { return; }
			const gprName = readGprProjectName(projectDir);
			const projectName = gprName ?? path.basename(projectDir);
			// `Start <name>`은 공백 구분 명령 — 이름에 공백이 있으면 보내지 않고 이유를 알린다.
			if (auto) {
				const nameCheck = checkProjectName(projectName);
				if (!nameCheck.ok) {
					const reason = describeProjectNameProblem(projectName, gprName ? 'project' : 'folder', nameCheck);
					host.log(`[Automation] gpl.start 중단: ${reason}`);
					return { ok: false, error: 'PROJECT_NOT_FOUND', detail: reason } as AutomationFailure;
				}
			} else if (!host.ensureProjectNameSafe(projectName, gprName ? 'project' : 'folder', 'Start')) {
				return;
			}
			// /GPL 소스가 Compile로 검증되지 않았으면 안내(Start는 제어기가 자체 컴파일 — 소스 에러 시 Start 실패, §0.7).
			if (auto) {
				const stale = compileStaleGate('gpl.start', projectName, auto);
				if (stale) { return stale; }
			} else if (!(await confirmStartWhenCompileStale(projectName, projectDir))) {
				return;
			}
			// 모달 대기 동안 다른 배포가 시작됐을 수 있으므로 잠금을 다시 확인한다.
			const busyAfter = host.currentDeployLockHolder();
			if (busyAfter) { host.warnDeployBusy('Start', busyAfter); return; }

			if (auto) {
				const gate = startMotionGate('gpl.start', auto);
				if (gate) { return gate; }
			} else {
				const requireStartConfirm = vscode.workspace.getConfiguration('gpl')
					.get<boolean>('controller.requireStartConfirmation', true);
				if (requireStartConfirm) {
					const pick = await vscode.window.showWarningMessage(
						`'${projectName}' 프로그램을 시작합니다. 로봇이 움직일 수 있습니다.`,
						{ modal: true },
						'Start'
					);
					if (pick !== 'Start') { return; }
				}
			}

			// Start 전 런타임 콘솔 준비 (구 Deploy & Run의 beforeStart와 동일 처리)
			try {
				const console = host.ensureRuntimeConsole();
				console.primeForRuntimeStart();
				await console.waitUntilReady(1200);
				host.controllerTree?.setRuntimeConsoleStatus(console.getStatusSnapshot());
			} catch (err: any) {
				host.log(`[Start] runtime console pre-start failed: ${err?.message ?? err}`);
			}

			try {
				// 문서 구문으로 조립(startCommand.ts) — 기본 `-event`(GDE 동일), `-compile` 없음(하드 규칙 7)
				const startCmd = buildStartCommand({
					projectName,
					eventMode: vscode.workspace.getConfiguration('gpl').get<boolean>('controller.startEventMode', true),
				});
				host.log(`[Start] CMD ${startCmd}`);
				const raw = await sendCommand(startCmd);
				const status = parseStatus(raw);
				if (status.code === 0 || isControllerNonBlockingStatus(status.code)) {
					if (status.code !== 0) {
						host.log(`[Start] STATUS ${status.code} non-blocking (controller environment warning)`);
					}
					vscode.window.showInformationMessage(`Start 완료: ${projectName}`);
					consoleChannel.show(true);
				} else {
					vscode.window.showErrorMessage(`Start 실패: STATUS ${status.code}: ${status.message || 'Unknown error'}`);
				}
				host.controllerTree?.refresh();
			} catch (err: any) {
				vscode.window.showErrorMessage(`Start 실패: ${err.message ?? err}`);
			}
		})
	);

	// gpl.saveToFlash — 로컬 프로젝트를 /flash/projects/<projectName>에 FTP 저장만 수행.
	// 제어기 상태는 건드리지 않는다 (Stop/Unload/Load/Compile 없음 — 2026-07-24 결정).
	// 미러 동기화: 크기 다른 파일만 업로드 + 원격 전용 파일 삭제(낡은 소스가 이후 Load에 섞이는 것 방지).
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.saveToFlash', async (resource?: unknown) => {
			const busy = host.currentDeployLockHolder();
			if (busy) {
				host.warnDeployBusy('Save to Flash', busy, '완료 후 flash 저장을 실행하세요');
				return;
			}
			const auto = isAutomationInvocation(resource) ? resource as AutomationTargetArgs : undefined;
			let projectDir: string | undefined;
			if (auto) {
				const target = await resolveAutomationTarget(auto, 'gpl.saveToFlash');
				if (isAutomationFailure(target)) { return target; }
				const dirty = await handleDirtyForAutomation(target.dir, auto, 'gpl.saveToFlash');
				if (dirty) { return dirty; }
				projectDir = target.dir;
			} else {
				projectDir = await pickWorkspaceProjectDir('flash에 저장할 프로젝트를 선택하세요', resource);
				if (!projectDir) { return; }
				// 업로드 전 미저장 파일 확인. savedFiles는 pending에서 지우지 않는다 —
				// flash 업로드는 /GPL을 갱신하지 않으므로 /GPL 동기화는 이후 autoOnSave가 자체 게이트로 처리.
				if (!(await confirmSaveDirtyProjectDocs(projectDir)).ok) {
					host.log('[SaveToFlash] 미저장 파일 확인에서 취소됨 — 업로드를 시작하지 않음');
					return;
				}
			}
			const cfg = getControllerConfig();
			const projectName = readGprProjectName(projectDir) ?? path.basename(projectDir);
			const remoteDir = `${cfg.ftpFlashProjectsPath}/${projectName}`;
			outputChannel.show(true);
			host.log(`[SaveToFlash] ${projectDir} → ftp://${cfg.ip}${remoteDir} (미러 동기화, Load/Compile 없음)`);
			// FTP 미러(원격 파일 삭제 포함) 중 autoOnSave/배포/MCP의 Compile·Start가 겹치지 않도록 배포 잠금에 포함.
			// 프로젝트 선택·미저장 확인 UI가 끝난 뒤에 잡는다(UI 대기 중 잠금 금지, 이슈 #15).
			const acquired = getDeployLock(cfg.ip).acquire('Save to Flash', 'FTP_MIRROR');
			if (!acquired.ok) {
				host.warnDeployBusy('Save to Flash', acquired.holder, '완료 후 flash 저장을 실행하세요');
				return;
			}
			try {
				const stats = await mirrorProject(cfg.ip, projectDir, remoteDir, {
					// 크기만 같고 내용이 바뀐 파일을 스킵하지 않도록 직전 업로드 지문(SHA-1)을 함께 본다.
					manifest: getSyncManifest(cfg.ip, remoteDir),
					onProgress: (current, total, file) => {
						acquired.handle.heartbeat();
						host.log(`[SaveToFlash] [${current}/${total}] ${file}`);
					},
					onDelete: (file) => host.log(`[SaveToFlash] del ${file} (원격 전용 — 로컬에 없어 삭제)`),
				});
				recordSyncManifest(cfg.ip, remoteDir, stats.manifest);
				host.log(`[SaveToFlash] 완료: ${stats.uploaded} sent, ${stats.skipped} skipped, ${stats.deleted} deleted`);
				vscode.window.showInformationMessage(
					`flash 저장 완료: ${remoteDir} (${stats.uploaded} 업로드, ${stats.skipped} 스킵${stats.deleted ? `, ${stats.deleted} 삭제` : ''})`
				);
				await host.controllerTree?.refreshAll();
			} catch (err: any) {
				vscode.window.showErrorMessage(`flash 저장 실패: ${err.message ?? err}`);
			} finally {
				acquired.handle.release();
			}
		})
	);

	// gpl.quickCompile — 변경분만 업로드 + Compile (STOP/START 생략), 빠른 에러 확인
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.quickCompile', async (resource?: unknown) => {
			const quick = { skipStop: true, skipUnchanged: true, quick: true } as const;
			if (isAutomationInvocation(resource)) {
				return runDeployForAutomation('gpl.quickCompile', resource as AutomationTargetArgs, true, { ...quick });
			}
			if (resource instanceof vscode.Uri) {
				const dir = await pickWorkspaceProjectDir('빠른 컴파일할 프로젝트를 선택하세요', resource);
				if (!dir) { return undefined; }
				return runDeploy(true, { ...quick, overrideProjectDir: dir });
			}
			return runDeploy(true, { ...quick });
		})
	);

	// .gpl 저장 시 자동 빠른 컴파일 (설정 gpl.quickCompile.autoOnSave, 기본 "auto"). 600ms 디바운스 + 동시실행 방지.
	// 저장된 파일만 업로드 후 Compile하여, 매 저장마다 프로젝트 전체를 스캔/조회하는 비효율을 제거한다.
	// "auto"(기본): 제어기가 완전 STOP(쓰레드 없음)이고 /GPL/<project>가 존재할 때만 조용히 실행(AUTO_GATE).
	// "on"(구 true): 게이트 없이 항상 시도(활성 쓰레드 시 조용히 중단, /GPL 없으면 classic 폴백) / "off"(구 false): 사용 안 함.
	type AutoOnSaveMode = 'off' | 'on' | 'auto';
	function getAutoOnSaveMode(): AutoOnSaveMode {
		// 구버전 boolean 설정값 호환: true → "on", false → "off". 미설정 시 스키마 기본값 "auto".
		const raw = vscode.workspace.getConfiguration('gpl').get<unknown>('quickCompile.autoOnSave');
		if (raw === true || raw === 'on') { return 'on'; }
		if (raw === false || raw === 'off') { return 'off'; }
		return 'auto';
	}

	let quickCompileTimer: ReturnType<typeof setTimeout> | undefined;
	let quickCompileInFlight = false;
	const quickCompilePendingFiles = new Set<string>();
	// deactivate 시 디바운스 타이머 해제 (좀비 콜백 방지)
	context.subscriptions.push({ dispose: () => { if (quickCompileTimer) { clearTimeout(quickCompileTimer); quickCompileTimer = undefined; } } });

	/** 저장된 파일이 속한 프로젝트 폴더(.gpr 보유)를 찾는다. 여러 후보 중 가장 깊은(구체적인) 경로를 선택. */
	async function resolveProjectDirForFile(fsPath: string): Promise<string | undefined> {
		const projectDirs = await findProjectDirs();
		const normalized = path.resolve(fsPath);
		const matches = projectDirs.filter(dir => {
			const rel = path.relative(path.resolve(dir), normalized);
			return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
		});
		if (matches.length === 0) { return undefined; }
		// 가장 깊은(경로가 긴) 프로젝트 폴더를 우선.
		return matches.sort((a, b) => b.length - a.length)[0];
	}

	/** autoOnSave 디바운스 타이머 (재)예약. */
	function scheduleQuickCompileFlush(delayMs: number): void {
		if (quickCompileTimer) { clearTimeout(quickCompileTimer); }
		quickCompileTimer = setTimeout(() => {
			quickCompileTimer = undefined;
			void flushQuickCompilePending();
		}, delayMs);
	}

	/**
	 * pending 저장 파일 처리. 저장 경로에서는 절대 UI(QuickPick/모달)를 띄우지 않는다.
	 * - 컴파일/배포가 진행 중이면 pending을 버리지 않고 재예약해 이후에 처리한다.
	 * - 프로젝트 폴더별로 그룹화해 첫 그룹만 이번에 처리하고, 다른 프로젝트 파일은
	 *   pending에 남겨 재예약한다 (업로드 필터에서 조용히 탈락하던 문제 방지).
	 * - 프로젝트(.gpr)를 못 찾는 파일은 로그만 남기고 조용히 건너뛴다.
	 */
	async function flushQuickCompilePending(): Promise<void> {
		if (quickCompilePendingFiles.size === 0) { return; }
		const mode = getAutoOnSaveMode();
		if (mode === 'off') {
			// 저장~flush 사이에 설정이 꺼졌으면 pending을 버린다.
			quickCompilePendingFiles.clear();
			return;
		}
		if (mode === 'auto' && vscode.debug.activeDebugSession?.type === 'brooks-gpl') {
			// 디버그 세션 중 자동 업로드 금지 — 정지 중 쓰레드와의 충돌 방지(프로브 왕복도 생략).
			quickCompilePendingFiles.clear();
			host.log('[QuickCompile] autoOnSave 건너뜀: brooks-gpl 디버그 세션 진행 중');
			return;
		}
		if (quickCompileInFlight || host.currentDeployLockHolder()) {
			// 다른 배포(이 창/다른 창/Save to Flash)가 진행 중 — pending을 버리지 않고 재예약.
			scheduleQuickCompileFlush(1000);
			return;
		}
		quickCompileInFlight = true;
		try {
			const groups = new Map<string, string[]>();
			for (const file of [...quickCompilePendingFiles]) {
				const dir = await resolveProjectDirForFile(file);
				if (!dir) {
					quickCompilePendingFiles.delete(file);
					host.log(`[QuickCompile] autoOnSave: 프로젝트(.gpr) 미해석 — 건너뜀: ${file}`);
					continue;
				}
				const list = groups.get(dir);
				if (list) { list.push(file); } else { groups.set(dir, [file]); }
			}

			const firstGroup = groups.entries().next();
			if (firstGroup.done) { return; }
			const [projectDir, changedFiles] = firstGroup.value;
			for (const file of changedFiles) { quickCompilePendingFiles.delete(file); }

			const r = await runDeploy(true, {
				skipStop: true,
				skipUnchanged: true,
				quick: true,
				changedFiles,
				overrideProjectDir: projectDir,
				// 저장마다 모달이 뜨면 방해되므로 autoOnSave는 활성 쓰레드 시 조용히 중단.
				noStopPrompt: true,
				// "auto" 모드: /GPL/<project>가 있으면 업로드, Compile은 쓰레드가 하나도 없을 때만(없으면 COMPILE_DEFERRED → 컴파일 필요 표시).
				autoGate: mode === 'auto',
			});
			if (r?.failedPhase === 'LOCKED') {
				// 다른 배포가 잠금을 잡고 있었다 — 저장분을 버리지 않고 pending에 되돌려 finally에서 재예약한다.
				for (const file of changedFiles) { quickCompilePendingFiles.add(file); }
			}
		} finally {
			quickCompileInFlight = false;
			if (quickCompilePendingFiles.size > 0) {
				// 남은 프로젝트 그룹/처리 중 새로 저장된 파일을 이어서 처리
				scheduleQuickCompileFlush(1000);
			}
		}
	}

	context.subscriptions.push(
		vscode.workspace.onDidSaveTextDocument((doc) => {
			if (doc.languageId !== 'gpl') { return; }
			if (getAutoOnSaveMode() === 'off') { return; }
			if (!host.controllerTree?.isConnected) { return; }
			quickCompilePendingFiles.add(doc.uri.fsPath);
			scheduleQuickCompileFlush(600);
		})
	);

	return { runDeploy, confirmStartWhenCompileStale, pickWorkspaceProjectDir };
}
