/**
 * `gpl.saveToFlash` — 로컬 프로젝트를 /flash/projects/<projectName>에 FTP 미러 저장만 수행하고(Stop/Unload/Load/Compile
 * 없음), `Sync` + 안정화로 전원 차단 안전 상태를 확인한다(controller/deployment/flashSafety.ts). 배포 잠금·작업 기록·
 * 취소 파일 계약을 deployService 를 거치지 않고 직접 잇는다. **사람 전용**(AI/자동화 거부). `deploy.ts` 에서 분할(2026-10-27).
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { AI_BLOCKED_ERROR, aiBlockedDetail, findAiBlockedCommand } from '../../controller/automation/aiCommandPolicy';
import { beginOperation, sweepOperations } from '../../controller/automation/operationStore';
import { getControllerConfig, sendCommandDetailed } from '../../controller/connection/controllerConnection';
import { clearDeployCancellation, readDeployCancellation } from '../../controller/deployment/deployCancellation';
import { describeDeployLock, getDeployLock } from '../../controller/deployment/deployLock';
import { FLASH_SYNC_TIMEOUT_MS, waitForFlashSafe } from '../../controller/deployment/flashSafety';
import { isUploadCancelledError, mirrorProject } from '../../controller/files/ftpClient';
import { getSyncManifest, recordSyncManifest } from '../../controller/files/syncManifest';
import { readGprProjectName } from '../../controller/projects/projectPicker';
import { isAutomationInvocation } from '../../controller/projects/projectTarget';
import { getControllerProjectWriteBlock } from '../../project/remote/controllerProjectWorkspace';
import { automationFailure } from './automationResult';
import type { AutomationTargetArgs } from './automationResult';
import type { DeployContext } from './deployContext';
import { confirmSaveDirtyProjectDocs, pickWorkspaceProjectDir } from './deployTargets';

// gpl.saveToFlash — 로컬 프로젝트를 /flash/projects/<projectName>에 FTP 저장만 수행.
// 제어기 상태는 건드리지 않는다 (Stop/Unload/Load/Compile 없음 — 2026-07-24 결정).
// 미러 동기화: 크기 다른 파일만 업로드 + 원격 전용 파일 삭제(낡은 소스가 이후 Load에 섞이는 것 방지).
// **사람 전용 명령** (2026-09-07 사용자 결정): flash 영구 사본을 되돌릴 수 없게 덮어쓰므로 AI/자동화 경로에서는
// 실행하지 않는다. 브리지·URI 는 앞단에서 이미 거부하고(controller/automation/aiCommandPolicy.ts), 여기서는 그 두 곳을
// 거치지 않는 직접 호출까지 막는 마지막 관문이다.
export function registerSaveToFlashCommand(ctx: DeployContext): void {
	const { host } = ctx;
	const { context, outputChannel } = host;

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.saveToFlash', async (resource?: unknown) => {
			const auto = isAutomationInvocation(resource) ? resource as AutomationTargetArgs : undefined;
			if (auto) {
				const blocked = findAiBlockedCommand('gpl.saveToFlash')!;
				const detail = aiBlockedDetail(blocked);
				host.log(`[SaveToFlash] 자동화 호출 거부 — ${detail}`);
				return automationFailure(AI_BLOCKED_ERROR, detail);
			}
			const busy = host.currentDeployLockHolder();
			if (busy) {
				host.warnDeployBusy('Save to Flash', busy, '완료 후 flash 저장을 실행하세요');
				return undefined;
			}
			const projectDir = await pickWorkspaceProjectDir(ctx, 'flash에 저장할 프로젝트를 선택하세요', resource);
			if (!projectDir) { return undefined; }
			const currentHost = getControllerConfig().ip;
			const manifestBlock = getControllerProjectWriteBlock(projectDir, currentHost);
			if (manifestBlock) {
				void vscode.window.showWarningMessage(manifestBlock.message);
				return undefined;
			}
			// 업로드 전 미저장 파일 확인. savedFiles는 pending에서 지우지 않는다 —
			// flash 업로드는 /GPL을 갱신하지 않으므로 /GPL 동기화는 이후 autoOnSave가 자체 게이트로 처리.
			if (!(await confirmSaveDirtyProjectDocs(projectDir)).ok) {
				host.log('[SaveToFlash] 미저장 파일 확인에서 취소됨 — 업로드를 시작하지 않음');
				return undefined;
			}
			const cfg = getControllerConfig();
			const projectName = readGprProjectName(projectDir) ?? path.basename(projectDir);
			const remoteDir = `${cfg.ftpFlashProjectsPath}/${projectName}`;
			outputChannel.show(true);
			host.log(`[SaveToFlash] ${projectDir} → ftp://${cfg.ip}${remoteDir} (미러 동기화, Load/Compile 없음)`);
			// FTP 미러(원격 파일 삭제 포함) 중 autoOnSave/배포/MCP의 Compile·Start가 겹치지 않도록 배포 잠금에 포함.
			// 프로젝트 선택·미저장 확인 UI가 끝난 뒤에 잡는다(UI 대기 중 잠금 금지, 이슈 #15).
			const operation = beginOperation({
				type: 'SAVE_TO_FLASH', controllerId: cfg.ip, extensionInstanceId: host.extensionInstanceId,
				projectDir, projectName, phase: 'FTP_MIRROR',
			});
			clearDeployCancellation(operation.operationId);
			const acquired = getDeployLock(cfg.ip).acquire('Save to Flash', 'FTP_MIRROR', {
				operationId: operation.operationId,
				extensionInstanceId: host.extensionInstanceId,
				projectDir,
			});
			if (!acquired.ok) {
				operation.fail({
					code: 'LOCK_HELD_BY_OTHER_OPERATION', message: `배포 잠금 보유 중: ${describeDeployLock(acquired.holder)}`,
					retryable: true, retryMode: 'CHECK_OPERATION', safeToRepeat: true,
				});
				clearDeployCancellation(operation.operationId);
				host.warnDeployBusy('Save to Flash', acquired.holder, '완료 후 flash 저장을 실행하세요');
				return undefined;
			}
			host.statusBar?.setFlashSafety({ phase: 'writing' }, projectName);
			void vscode.window.showWarningMessage(
				'Flash 저장을 시작했습니다. 안전 확인이 끝나 상태바 경고가 사라질 때까지 제어기 전원을 끄지 마세요.'
			);
			let flashSafetyStage = '';
			const isCancelled = (): boolean => readDeployCancellation(operation.operationId).requested;
			const confirmFlashSafe = async () => waitForFlashSafe({
				sendSync: async () => {
					host.log('[SaveToFlash] Sync — Disk Busy 해제 대기');
					const response = await sendCommandDetailed('Sync', cfg, {
						waitForStatusClose: true,
						timeoutMs: Math.max(cfg.timeoutMs, FLASH_SYNC_TIMEOUT_MS),
					});
					return response.raw;
				},
				onState: state => {
					const stage = state.phase === 'syncing' ? 'FLASH_SYNC'
						: state.phase === 'settling' ? 'FLASH_SETTLE'
							: state.phase === 'unknown' ? 'FLASH_SAFETY_UNKNOWN'
								: 'FTP_MIRROR';
					try {
						if (stage !== flashSafetyStage) {
							flashSafetyStage = stage;
							acquired.handle.setStage(stage);
							operation.setPhase(stage);
						} else {
							acquired.handle.heartbeat();
						}
					} catch { /* 자동 heartbeat가 다음 주기에 다시 기록한다 — 안전 확인 자체는 계속 */ }
					host.statusBar?.setFlashSafety(state, projectName);
				},
			});
			try {
				const stats = await mirrorProject(cfg.ip, projectDir, remoteDir, {
					// 크기만 같고 내용이 바뀐 파일을 스킵하지 않도록 직전 업로드 지문(SHA-1)을 함께 본다.
					manifest: getSyncManifest(cfg.ip, remoteDir),
					// deployService 를 거치지 않는 경로라 상태바 진행 바는 여기서 직접 잇는다(같은 표시 API).
					onProgress: (event) => {
						if (event.type === 'file') {
							acquired.handle.heartbeat();
							host.log(`[SaveToFlash] [${event.doneFiles}/${event.totalFiles}] ${event.file}`);
						}
						host.statusBar?.setUploadProgress(event, projectName);
					},
					onDelete: (file) => {
						host.log(`[SaveToFlash] del ${file} (원격 전용 — 로컬에 없어 삭제)`);
					},
					isCancelled,
				});
				host.statusBar?.endUpload({ ok: true, summary: stats });
				recordSyncManifest(cfg.ip, remoteDir, stats.manifest);

				// 변경 파일이 0개여도 Sync를 보낸다. 직전 시도의 안전 상태 미확인 경고가 남아 있을 수 있으므로,
				// 실제 Disk Busy=0을 확인하지 않고 새 no-op 저장이 경고를 지우게 하지 않는다.
				const safety = await confirmFlashSafe();
				if (!safety.ok) {
					const detail = safety.detail ?? 'Sync 결과를 확인하지 못했습니다.';
					host.log(`[SaveToFlash] Flash 안전 상태 미확인 — ${detail}`);
					void vscode.window.showWarningMessage(
						`flash 파일 저장은 끝났지만 전원 차단 안전 상태를 확인하지 못했습니다: ${detail} ` +
						'제어기의 Flash Busy 표시가 사라진 뒤 10초 이상 기다리세요.',
						'출력 보기',
					).then(pick => { if (pick === '출력 보기') { outputChannel.show(true); } });
					if (isCancelled()) { operation.cancel(readDeployCancellation(operation.operationId).request?.reason ?? '작업자 전체 정지 요청'); }
					else { operation.fail({ code: 'FLASH_SAFETY_UNKNOWN', message: detail, retryable: false, retryMode: 'NONE', safeToRepeat: false }); }
					return undefined;
				}
				if (isCancelled()) {
					const reason = readDeployCancellation(operation.operationId).request?.reason ?? '작업자 전체 정지 요청';
					host.statusBar?.setFlashSafety(undefined);
					host.log(`[SaveToFlash] 취소: ${reason} — Flash Sync 안전 확인은 완료`);
					void vscode.window.showWarningMessage(`flash 저장 취소: ${reason} (Flash 안전 확인 완료)`);
					operation.cancel(reason);
					return undefined;
				}
				host.statusBar?.setFlashSafety(undefined);
				host.log(`[SaveToFlash] 완료(Sync + 안전 대기 확인): ${stats.uploaded} sent, ${stats.skipped} skipped, ${stats.deleted} deleted`);
				vscode.window.showInformationMessage(
					`flash 저장·안전 확인 완료: ${remoteDir} (${stats.uploaded} 업로드, ${stats.skipped} 스킵${stats.deleted ? `, ${stats.deleted} 삭제` : ''})`
				);
				await host.controllerTree?.refreshAll();
				operation.complete({ success: true, projectName, remoteProjectPath: remoteDir, uploadStats: stats });
			} catch (err: any) {
				host.statusBar?.endUpload({ ok: false, message: err?.message ?? String(err) });
				// FTP 실패도 파일 일부가 이미 쓰였을 수 있고, 이전 시도의 안전 미확인 경고가 남아 있을 수도 있다.
				// 실패 알림 전에 항상 Sync + 안정화를 시도해 전원 차단 경고를 근거 없이 지우지 않는다.
				const safety = await confirmFlashSafe();
				if (safety.ok) {
					host.statusBar?.setFlashSafety(undefined);
				}
				const cancellation = readDeployCancellation(operation.operationId);
				if (isUploadCancelledError(err) || cancellation.requested) {
					const reason = cancellation.request?.reason ?? '작업자 전체 정지 요청';
					host.log(`[SaveToFlash] 취소: ${reason} — Flash Sync 안전 확인 ${safety.ok ? '완료' : '미확인'}`);
					void vscode.window.showWarningMessage(`flash 저장 취소: ${reason}${safety.ok ? ' (Flash 안전 확인 완료)' : ' — Flash 안전 상태는 확인하지 못함'}`);
					operation.cancel(reason);
				} else {
					vscode.window.showErrorMessage(`flash 저장 실패: ${err.message ?? err}`);
					operation.fail({ code: 'SAVE_TO_FLASH_FAILED', message: err?.message ?? String(err), retryable: true, retryMode: 'RETRY_SAME_REQUEST', safeToRepeat: false });
				}
			} finally {
				acquired.handle.release();
				clearDeployCancellation(operation.operationId);
				sweepOperations();
			}
			return undefined;
		})
	);
}
