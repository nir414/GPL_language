/**
 * FTP 노드 명령 — 다운로드·삭제·폴더 비우기·컴파일 & 실행(ftpRun)·중지·Unload.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { EXTENSION_VERSION } from '../../config';
import { UNLOAD_PROJECT_COMMAND, checkMemoryBeforeOperation, getControllerConfig, sendCommandDetailed } from '../../controller/connection/controllerConnection';
import { isControllerSessionConnected } from '../../controller/connection/connectionSession';
import { parseStatus } from '../../controller/protocol/responseParser';
import { isBusyStatus, isProjectAlreadyLoaded, isProjectNotLoaded } from '../../controller/protocol/controllerStatusCodes';
import { applyCompileDiagnostics, findProjectDirs, jumpToFirstCompileError } from '../../controller/deployment/deployService';
import { compileProject, loadProject, startProject, unloadProject, unloadTimeoutMs } from '../../controller/commands/projectCommands';
import type { ProjectCommandIo } from '../../controller/commands/projectCommands';
import {
	FtpEntry,
	downloadProject,
	listRemoteDir,
	normalizeAbsoluteRemoteDir,
	removeRemoteDir,
	removeRemoteFile,
} from '../../controller/files/ftpClient';
import { NO_STATUS_CODE, SHOW_THREAD_LIST_CMD, parseThreadList } from '../../controller/protocol/responseParser';
import {
	RemoteDeleteGate,
	classifyRemoteClearRoot,
	clearRemoteFolderEntries,
	remoteDeleteGateAfterStop,
	remoteDeleteGateForThreads,
	selectRemoteClearTargets,
} from '../../controller/files/remoteFolderClear';
import { verifyControllerForFtpWrite } from '../../controller/connection/controllerIdentityIo';
import { checkFtpNodeTarget, isFtpFolderContext } from '../../controller/files/ftpNodeTarget';
import { describeRemotePathCandidates, resolveRemoteProjectPath } from '../../controller/projects/remoteProjectPath';
import { forgetSyncManifest } from '../../controller/files/syncManifest';
import { describeThreadActivity } from '../../controller/threads/threadActivity';
import {
	ControllerProjectMode,
	chooseAvailableDownloadDir,
	ensureControllerWorkspaceFile,
	makeDownloadStagingDir,
	removeDownloadStagingDir,
	writeControllerProjectManifest,
} from '../../project/remote/controllerProjectWorkspace';
import { confirmMemoryCriticalInteractive, confirmUnloadRiskInteractive, isMemoryConfirmOnCritical, stopAllThreads, stopThreadWithRecovery } from '../controller/controllerOps';
import { lookupProjectKind, runnableProjectNames } from '../../controller/commands/unloadRiskGuard';
import { notRunnableStartDetail } from '../../controller/commands/unloadRisk';
import type { ExtensionHost } from '../host';

export function activateFtpCommands(host: ExtensionHost): void {
	const { context, outputChannel, consoleChannel, deployDiagnostics } = host;

	/**
	 * 원격 프로젝트 이름과 같은 로컬 폴더를 찾는다(컴파일 에러를 Problems 진단으로 표시할 기준 경로).
	 * FTP Run 은 제어기의 사본을 컴파일하므로 로컬에 대응 폴더가 없을 수도 있다 — 그 경우 undefined.
	 */
	const findLocalProjectDir = async (projectName: string): Promise<string | undefined> => {
		try {
			const dirs = await findProjectDirs();
			const target = projectName.trim().toLowerCase();
			return dirs.find(d => path.basename(d).trim().toLowerCase() === target);
		} catch {
			return undefined;
		}
	};

	/**
	 * 트리 노드가 지금 조작해도 되는 대상인지 — 노드를 만든 제어기가 현재 제어기인지, 프로젝트 명령이면
	 * 저장 영역 바로 아래 폴더인지(controller/files/ftpNodeTarget.ts). 확인 창 뒤에도 다시 부른다.
	 * 거부하면 사유를 알리고 undefined — 제어기에는 아무것도 보내지 않는다.
	 */
	const checkNodeTarget = (node: any, action: string, requireProjectFolder: boolean) => {
		const check = checkFtpNodeTarget(node, getControllerConfig(), { action, requireProjectFolder });
		if (!check.ok) {
			host.log(`[FTP] ${check.message}`);
			void vscode.window.showErrorMessage(check.message);
			return undefined;
		}
		return check;
	};

	// FTP 프로젝트 다운로드
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.ftpDownload', async (node: any) => {
			const target = checkNodeTarget(node, '다운로드', true);
			if (!target) { return; }
			const name = target.projectName!;
			const remotePath = target.remotePath;

			// 저장 위치 선택
			const targetUri = await vscode.window.showOpenDialog({
				canSelectFolders: true,
				canSelectFiles: false,
				canSelectMany: false,
				openLabel: '여기에 다운로드',
				title: `"${name}" 프로젝트 다운로드 위치 선택`,
			});
			if (!targetUri?.[0]) { return; }

			const cfg = getControllerConfig();
			const parentDir = targetUri[0].fsPath;
			const modeChoice = await vscode.window.showQuickPick([
				{
					label: 'Live Working Copy',
					description: '권장 · 저장 시 /GPL 업로드 허용 (Save to Flash는 별도)',
					mode: 'live' as ControllerProjectMode,
				},
				{
					label: 'Read-only Snapshot',
					description: '검토용 · Deploy, Quick Compile, Save to Flash 차단',
					mode: 'snapshot' as ControllerProjectMode,
				},
			], {
				title: `"${name}" 다운로드 모드`,
				placeHolder: '로컬 사본의 제어기 쓰기 정책을 선택하세요',
			});
			if (!modeChoice) { return; }
			// 대화상자를 기다리는 동안 제어기가 바뀌었으면 다른 제어기의 같은 경로를 받지 않는다.
			if (!checkNodeTarget(node, '다운로드', true)) { return; }

			const localDir = chooseAvailableDownloadDir(parentDir, name);
			let stagingDir: string | undefined;
			let result: { downloaded: number; totalBytes: number };
			try {
				result = await vscode.window.withProgress(
					{ location: vscode.ProgressLocation.Notification, title: `${name} 다운로드 중...`, cancellable: false },
					async (progress) => {
						stagingDir = makeDownloadStagingDir(parentDir, name);
						let lastPercent = 0;
						const downloaded = await downloadProject(cfg.ip, remotePath, stagingDir, (current, total, file) => {
							const percent = total > 0 ? (current / total) * 100 : 100;
							progress.report({ increment: percent - lastPercent, message: file });
							lastPercent = percent;
						});
						writeControllerProjectManifest(stagingDir, {
							mode: modeChoice.mode,
							controllerHost: cfg.ip,
							sourceRemotePath: remotePath,
							projectName: name,
							downloadedAt: new Date().toISOString(),
						});
						fs.renameSync(stagingDir, localDir);
						stagingDir = undefined;
						return downloaded;
					},
				);
			} catch (err: any) {
				if (stagingDir) {
					try { removeDownloadStagingDir(stagingDir, parentDir); } catch (cleanupErr: any) {
						host.log(`[FTP Download] 임시 폴더 정리 실패: ${cleanupErr?.message ?? cleanupErr}`);
					}
				}
				void vscode.window.showErrorMessage(`다운로드 실패: ${err.message ?? err}`);
				return;
			}

			let workspaceFile: string;
			try {
				workspaceFile = ensureControllerWorkspaceFile(parentDir, cfg.ip);
			} catch (err: any) {
				void vscode.window.showWarningMessage(
					`"${name}" 다운로드는 완료했지만 작업 영역 파일을 만들지 못했습니다: ${err.message ?? err}`,
				);
				return;
			}

			const modeLabel = modeChoice.mode === 'live' ? 'Live Working Copy' : 'Read-only Snapshot';
			const currentWorkspace = vscode.workspace.workspaceFile?.fsPath;
			if (currentWorkspace && path.resolve(currentWorkspace).toLowerCase() === path.resolve(workspaceFile).toLowerCase()) {
				void vscode.window.showInformationMessage(
					`"${name}" 다운로드 완료 (${result.downloaded}개 파일, ${modeLabel})`,
				);
				return;
			}

			const openWorkspace = 'Controller 작업공간 열기';
			const addCurrent = '현재 작업공간에 추가';
			const openChoice = await vscode.window.showInformationMessage(
				`"${name}" 다운로드 완료 (${result.downloaded}개 파일, ${modeLabel}). `
				+ '처음 열 때는 Extension Host가 다시 시작되어 연결이 한 번 해제될 수 있습니다. '
				+ '이후 다운로드에서는 창 전환과 신뢰 확인을 반복하지 않습니다.',
				openWorkspace, addCurrent,
			);
			if (openChoice === openWorkspace) {
				// 첫 전환 때만 Extension Host가 다시 시작될 수 있다. 이후 같은 상위 폴더의 다운로드는 자동으로 보인다.
				await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(workspaceFile), false);
			} else if (openChoice === addCurrent) {
				vscode.workspace.updateWorkspaceFolders(
					vscode.workspace.workspaceFolders?.length ?? 0, 0,
					{ uri: vscode.Uri.file(localDir), name },
				);
			}
		})
	);

	// FTP 항목 삭제
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.ftpDelete', async (node: any) => {
			const name: string | undefined = node?.projectName || node?.label;
			const ctx: string | undefined = node?.contextValue;
			if (!name || !ctx) { return; }
			// 노드를 만든 제어기가 현재 제어기일 때만 — 확인 창·정지 게이트 뒤에도 다시 본다(그 사이 전환될 수 있다).
			const target = checkNodeTarget(node, `"${name}" 삭제`, false);
			if (!target) { return; }
			const remotePath = target.remotePath;

			const isDir = isFtpFolderContext(ctx);
			const confirm = await vscode.window.showWarningMessage(
				`${isDir ? '폴더' : '파일'} "${name}"을(를) 제어기 ${target.host}에서 삭제하시겠습니까?`,
				{ modal: true }, '삭제'
			);
			if (confirm !== '삭제') { return; }
			if (!checkNodeTarget(node, `"${name}" 삭제`, false)) { return; }

			// 폴더 비우기와 같은 정지 게이트 — 정지가 확인되지 않으면 지우지 않는다(사유는 게이트가 보여 준다).
			const gate = await ensureIdleBeforeRemoteDelete(remotePath, () => !!checkNodeTarget(node, `"${name}" 삭제`, false));
			if (!gate.proceed) { return; }
			if (!checkNodeTarget(node, `"${name}" 삭제`, false)) { return; }

			const cfg = getControllerConfig();
			try {
				if (isDir) {
					await removeRemoteDir(cfg.ip, remotePath);
				} else {
					await removeRemoteFile(cfg.ip, remotePath);
				}
				// 원격을 지웠으니 그 경로의 업로드 지문도 버린다(다음 동기화는 목록 조회로 다시 판정).
				forgetSyncManifest(cfg.ip, isDir ? remotePath : remotePath.replace(/\/[^/]*$/, ''));
				vscode.window.showInformationMessage(`"${name}" 삭제 완료`);
				host.controllerTree?.refreshFtp();
			} catch (err: any) {
				vscode.window.showErrorMessage(`삭제 실패: ${err.message ?? err}`);
			}
		})
	);

	/**
	 * 원격 파일 삭제 전 쓰레드 게이트 — 업로드 게이트(하드 규칙 §0.6)와 같은 규약이다.
	 * `Show Thread -web` 목록에 쓰레드가 하나라도 있으면 동작 중으로 보고(controller/threads/threadActivity.ts),
	 * 사용자가 승인할 때만 Stop -all + 정지 확인까지 마친 뒤 진행한다.
	 * **정지가 확인되지 않으면 지우지 않는다** — 상태를 모르는 경우(명령 콘솔 무응답)도, `Stop -all` 전송이 실패한 경우도
	 * 그렇다(2026-10-23: 채널이 거부 상태인데 Stop -all 실패 뒤에도 삭제로 넘어가 `550 DELE failed.`). 판정은
	 * controller/files/remoteFolderClear.ts 의 remoteDeleteGate* 가 정본이고, 사유는 여기서 사용자에게 보여 준다.
	 */
	async function ensureIdleBeforeRemoteDelete(target: string, stillTarget?: () => boolean): Promise<RemoteDeleteGate> {
		let threads: ReturnType<typeof parseThreadList> | null = null;
		try {
			const resp = await sendCommandDetailed(SHOW_THREAD_LIST_CMD);
			threads = resp.meta.statusTagReceived ? parseThreadList(resp.raw) : null;
		} catch {
			threads = null;
		}
		const first = remoteDeleteGateForThreads(threads === null ? null : threads.length);
		if (first !== 'needs-stop') {
			if (!first.proceed) {
				host.log(`[FTP] ${target} 삭제 중단 — ${first.detail}`);
				vscode.window.showWarningMessage(`${target} 삭제 중단 — ${first.detail}`);
			}
			return first;
		}
		const pick = await vscode.window.showWarningMessage(
			`${target} 삭제 전에 쓰레드를 정지해야 합니다 — ${describeThreadActivity(threads ?? [])}`,
			{ modal: true, detail: '실행 중인 상태에서 원격 파일을 지우면 파일 충돌·자원 누수가 생길 수 있습니다. Stop -all로 모두 정지한 뒤 진행할까요?' },
			'모두 정지 후 계속',
		);
		if (pick !== '모두 정지 후 계속') {
			return { proceed: false, reason: 'user-cancelled', detail: '정지 확인에서 취소했습니다.' };
		}
		// 확인 창을 기다리는 동안 제어기가 바뀌었으면 다른 제어기에 Stop -all 을 보내지 않는다(사유는 호출부 검사가 알린다).
		if (stillTarget && !stillTarget()) {
			return { proceed: false, reason: 'user-cancelled', detail: '대상 제어기가 바뀌어 정지하지 않았습니다.' };
		}
		// 전송·STATUS 판정(-752 = 정지 진행 중)·정지 확인 폴링·재시도는 controller/threads/threadStop.ts 가 한다(§1-DD).
		const outcome = await stopAllThreads(host, { logTo: (line: string) => host.log(`[Stop] ${line}`) });
		const gate = remoteDeleteGateAfterStop({
			sendFailed: outcome.send.kind === 'failed',
			statusCode: outcome.send.kind === 'failed' ? outcome.send.statusCode : undefined,
			message: outcome.send.kind === 'failed' ? outcome.send.message : undefined,
			ok: outcome.ok,
			unconfirmed: outcome.settle?.unconfirmed === true,
		});
		if (!gate.proceed) {
			host.log(`[FTP] ${target} 삭제 중단 — ${gate.detail}`);
			if (gate.reason === 'stop-failed') { vscode.window.showErrorMessage(gate.detail); } else { vscode.window.showWarningMessage(gate.detail); }
			return gate;
		}
		void host.controllerTree?.refresh();
		return gate;
	}

	// FTP 폴더 통째로 비우기 — 트리 섹션(/GPL·Flash Projects) 헤더에서 실행한다.
	// 파일 하나씩 지우는 ftpDelete와 달리 "폴더 안을 전부" 지우므로 게이트를 더 두껍게 건다:
	// 배포 잠금 → 지울 목록 확인 → 쓰레드 정지 게이트 → 목록을 보여주는 모달 확인 → 삭제.
	// 반환값은 자동화 호출자(extension_command)가 "모달 취소"와 "삭제 완료"를 가릴 수 있게 구조로 준다(2026-10-21).
	// AI 가 모달 없이 비우는 경로는 `gpl.ai.debug.clearRemoteFolder`(/GPL 만, 동의는 AI 가 받는다)이고 절차는 controller/files/remoteFolderClear.ts 를 같이 쓴다.
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.ftpClearFolder', async (node: any) => {
			const cfg = getControllerConfig();
			const isFlash = String(node?.contextValue ?? '') === 'section-ftpFlash';
			// 섹션 노드가 실제 표시 중인 경로를 최우선으로 쓰고(설정 변경 직후에도 화면과 일치), 없으면 설정값.
			const rawPath: string = node?.remotePath || (isFlash ? cfg.ftpFlashProjectsPath : cfg.ftpBasePath);
			return clearRemoteFolderInteractive({ rawPath, isFlash });
		})
	);

	/** 비우기 결과 — 자동화 호출자(extension_command)와 `Unload -all` 전 정리가 "모달 취소"와 "삭제 완료"를 가린다. */
	interface ClearFolderOutcome {
		root: string;
		ok: boolean;
		cancelled: boolean;
		reason?: string;
		detail?: string;
		targets: string[];
		deleted: string[];
		failed: { name: string; error: string }[];
	}

	/**
	 * 원격 폴더 비우기 절차(사람 경로) — 트리 섹션 헤더의 「폴더 비우기」와 `Unload -all` 전 /GPL 정리(§1-GN)가 같이 쓴다.
	 * 배포 잠금 → 지울 목록 확인 → 쓰레드 정지 게이트 → 제어기 정체 확인 → 목록을 보여주는 모달 확인 → 삭제.
	 * `purpose` 를 주면 확인 모달이 "비운 뒤 무엇을 하는지"(예: `Unload -all`)를 함께 말한다.
	 */
	async function clearRemoteFolderInteractive(opts: { rawPath: string; isFlash: boolean; purpose?: string }): Promise<ClearFolderOutcome> {
			const clearStartedAt = Date.now();
			const cfg = getControllerConfig();
			const { rawPath, isFlash } = opts;
			const basePath = normalizeAbsoluteRemoteDir(rawPath);
			const outcome = (fields: { ok: boolean; cancelled?: boolean; reason?: string; detail?: string; targets?: FtpEntry[]; deleted?: string[]; failed?: { name: string; error: string }[] }): ClearFolderOutcome => ({
				root: basePath,
				ok: fields.ok,
				cancelled: fields.cancelled ?? false,
				reason: fields.reason,
				detail: fields.detail,
				targets: (fields.targets ?? []).map(e => (e.isDirectory ? `${e.name}/` : e.name)),
				deleted: fields.deleted ?? [],
				failed: fields.failed ?? [],
			});
			if (basePath === '/') {
				vscode.window.showErrorMessage(`폴더 비우기 중단 — 대상 경로가 비어 있거나 루트입니다 (설정값: "${rawPath ?? ''}")`);
				return outcome({ ok: false, reason: 'unsafe-root' });
			}

			// 업로드/컴파일 도중 원격 파일이 사라지면 반쯤 지워진 소스가 컴파일된다 — 배포 잠금으로 차단.
			const busy = host.currentDeployLockHolder();
			if (busy) {
				host.warnDeployBusy(`${basePath} 비우기`, busy, '완료 후 다시 실행하세요');
				return outcome({ ok: false, reason: 'deploy-busy' });
			}

			// 1) 지울 목록을 먼저 확인한다 — 사용자에게 그대로 보여주기 위함.
			let entries: FtpEntry[];
			try {
				entries = await listRemoteDir(cfg.ip, basePath);
			} catch (err: any) {
				vscode.window.showErrorMessage(`${basePath} 조회 실패: ${err.message ?? err}`);
				return outcome({ ok: false, reason: `ftp-failed: ${err?.message ?? err}` });
			}
			const { targets } = selectRemoteClearTargets(entries);
			if (targets.length === 0) {
				vscode.window.showInformationMessage(`${basePath}은(는) 이미 비어 있습니다.`);
				return outcome({ ok: true, reason: 'already-empty' });
			}

			// 2) 쓰레드 정지 게이트 — 정지가 확인되지 않으면 지우지 않고 사유를 돌려준다.
			const gate = await ensureIdleBeforeRemoteDelete(basePath);
			if (!gate.proceed) {
				return outcome({ ok: false, cancelled: gate.reason === 'user-cancelled', reason: `thread-gate: ${gate.reason}`, targets, detail: gate.detail });
			}

			// 2-1) 제어기 정체 확인 — 위 목록 조회(FTP 배너)·쓰레드 게이트(명령 콘솔 STATUS)를 재사용한다. 실패하면 「그래도 진행」을 묻는다.
			const controllerCheck = await verifyControllerForFtpWrite(cfg, clearStartedAt,
				vscode.workspace.getConfiguration('gpl').get<boolean>('controller.verifyControllerIdentity', true) !== false);
			if (!controllerCheck.verified) {
				host.log(`[FTP] ${basePath} 비우기 — 제어기 미확인: ${controllerCheck.reasons.join(' / ')}`);
				const go = await vscode.window.showWarningMessage(
					`${cfg.ip} 이 제어기인지 확인하지 못했습니다 — ${basePath} 비우기를 시작하지 않았습니다.`,
					{ modal: true, detail: `${controllerCheck.reasons.join('\n')}\n\n다른 장치의 파일을 지울 수 있습니다. 제어기임을 알고 있을 때만 진행하세요.` },
					'그래도 진행',
				);
				if (go !== '그래도 진행') {
					return outcome({ ok: false, cancelled: true, reason: 'controller-unverified', targets });
				}
				host.log(`[FTP] ${basePath} 비우기 — 사용자가 제어기 미확인 상태로 진행 선택`);
			}

			// 3) 삭제 확인 — 무엇이 지워지는지 목록으로 보여준다.
			const PREVIEW_MAX = 15;
			const preview = targets.slice(0, PREVIEW_MAX)
				.map(e => (e.isDirectory ? `[폴더] ${e.name}` : e.name))
				.join('\n');
			const more = targets.length > PREVIEW_MAX ? `\n… 외 ${targets.length - PREVIEW_MAX}개` : '';
			const note = isFlash
				? '⚠ 플래시에 저장된 프로젝트가 지워집니다. 제어기 재부팅으로도 복구되지 않습니다.'
				: opts.purpose
					? `로드본 소스가 지워집니다. 비운 뒤 ${opts.purpose} 을(를) 보냅니다 — 취소하면 ${opts.purpose} 도 보내지 않습니다.`
					: '로드본 소스가 지워집니다. 다시 쓰려면 Deploy로 업로드하거나 flash에서 Load 하세요. 제어기에 로드된 프로젝트 상태는 별개이므로 필요하면 Unload도 함께 하세요.';
			const confirm = await vscode.window.showWarningMessage(
				`${basePath}의 항목 ${targets.length}개를 제어기에서 모두 삭제할까요?`,
				{ modal: true, detail: `${preview}${more}\n\n${note}` },
				'모두 삭제',
			);
			if (confirm !== '모두 삭제') {
				return outcome({ ok: false, cancelled: true, reason: 'user-cancelled', targets });
			}

			// 4) 삭제 — 개별 실패는 모아서 "부분 완료"로 알린다. 확인받은 목록만 지운다(확인 뒤 새로 생긴 항목은 남긴다).
			host.log(`[FTP] ${basePath} 비우기 시작 — 대상 ${targets.length}개`);
			return vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: `${basePath} 비우는 중...`, cancellable: false },
				async (progress) => {
					try {
						let done = 0;
						const result = await clearRemoteFolderEntries(cfg.ip, basePath, targets, (name, isDirectory) => {
							done++;
							host.log(`[FTP] − del ${basePath}/${name}${isDirectory ? '/' : ''}`);
							progress.report({ increment: (1 / targets.length) * 100, message: `${done}/${targets.length} ${name}` });
						});
						if (result.failed.length > 0) {
							for (const f of result.failed) {
								host.log(`[FTP] ✘ ${basePath}/${f.name} 삭제 실패: ${f.error}`);
							}
							void vscode.window.showWarningMessage(
								`${basePath} 비우기 부분 완료 — 삭제 ${result.deleted.length}개, 실패 ${result.failed.length}개 (자세한 내용은 GPL 출력 창)`,
								'출력 보기',
							).then(pick => { if (pick === '출력 보기') { outputChannel.show(true); } });
						} else {
							vscode.window.showInformationMessage(`${basePath} 비우기 완료 — ${result.deleted.length}개 삭제`);
						}
						return outcome({ ok: result.failed.length === 0, reason: result.failed.length > 0 ? 'partial' : undefined, targets, ...result });
					} catch (err: any) {
						host.log(`[FTP] ${basePath} 비우기 실패: ${err.message ?? err}`);
						vscode.window.showErrorMessage(`${basePath} 비우기 실패: ${err.message ?? err}`);
						return outcome({ ok: false, reason: `ftp-failed: ${err?.message ?? err}`, targets });
					} finally {
						void host.controllerTree?.refreshFtp();
					}
				},
			);
	}

	// FTP 폴더 컴파일 & 실행 (Load 에러 핸들링 포함)
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.ftpRun', async (node: any) => {
			// 프로젝트 폴더(저장 영역 바로 아래)만, 노드를 만든 제어기가 현재 제어기일 때만 — 이름은 폴더 이름이다.
			const target = checkNodeTarget(node, '컴파일 & 실행', true);
			if (!target) { return; }
			const name = target.projectName!;
			const loadPath = target.remotePath;
			// `Load <path>` / `Compile <name>` / `Start <name>`은 공백 구분 명령 — 원격 폴더명·경로에 공백이 있으면 보내지 않는다.
			if (!host.ensureProjectNameSafe(name, 'remote', '컴파일 & 실행') || !host.ensureProjectNameSafe(loadPath, 'remote', '컴파일 & 실행')) { return; }
			// 업로드 도중 Compile/Start가 겹치면 제어기 이상을 유발할 수 있다 — 배포 잠금(다른 창/프로세스 포함)으로 차단.
			const busy = host.currentDeployLockHolder();
			if (busy) {
				host.warnDeployBusy('컴파일 & 실행', busy, '완료 후 컴파일 & 실행을 사용하세요');
				return;
			}

			// ProjectStart 없는 그룹(라이브러리)은 Start 가 -744 로 끝나고 그 전에 그룹 Compile 이 일어난다 — 정지·컴파일 전에 멈춘다.
			const kind = await lookupProjectKind(name);
			if (kind?.runnable === false) {
				const detail = notRunnableStartDetail(name, await runnableProjectNames());
				host.log(`[FTP Run] ${detail}`);
				vscode.window.showErrorMessage(detail);
				return;
			}

			const cfg = getControllerConfig();
			const loadBeforeCompile = vscode.workspace
				.getConfiguration('gpl.controller')
				.get<boolean>('ftpRunLoadBeforeCompile', false);

			outputChannel.show(true);

			// 어느 원격 사본을 실행할지 — 규칙은 controller/projects/remoteProjectPath.ts 가 정본이다(§1-DE).
			// 종전에는 이 파일과 배포 경로가 각자 점수식을 갖고 있어 같은 프로젝트에 다른 폴더를 고를 수 있었다.
			const resolveFtpRunPath = () => resolveRemoteProjectPath({
				projectFolderName: name,
				flashBasePath: cfg.ftpFlashProjectsPath,
				gplBasePath: cfg.ftpBasePath,
				// 사용자가 트리에서 고른 노드의 상위 폴더도 후보에 넣는다(설정 밖 경로일 수 있다).
				extraBasePaths: [path.posix.dirname(loadPath)],
				selectedPath: loadPath,
				listDir: base => listRemoteDir(cfg.ip, base),
			});

			const resolvedPath = await resolveFtpRunPath();
			const effectiveLoadPath = resolvedPath.projectPath;

			host.log('');
			host.log(`━━ [FTP Run v${EXTENSION_VERSION}] ${name} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
			host.log(`│ Note: FTP Run uses the uploaded controller copy at ${effectiveLoadPath}`);
			host.log(`│       Local edits are NOT uploaded here. Use GPL: Deploy (Build Only) to verify latest local code.`);
			host.log(`│ Path candidates: ${describeRemotePathCandidates(resolvedPath.candidates).join(' | ') || effectiveLoadPath}`);
			if (!resolvedPath.confirmed) {
				const message = `원격 프로젝트 경로를 확인할 수 없어 컴파일 & 실행을 중단했습니다: ${describeRemotePathCandidates(resolvedPath.candidates).join(' | ')}`;
				host.log(`│ ✘ ${message}`);
				vscode.window.showErrorMessage(message);
				return;
			}
			if (resolvedPath.switched) {
				host.log(`│ Path selected: ${loadPath} → ${effectiveLoadPath}`);
			}
			host.log(`│ Load before Compile: ${loadBeforeCompile ? 'enabled' : 'skipped'}`);

			// Compile/Load/Unload/Start 절차는 controller/commands/projectCommands.ts 가 정본이다(§1-DE).
			// 여기서는 전송(1402)과 로그 목적지만 물린다 — 종전에는 이 파일이 같은 절차를 따로 구현하면서
			// `-event` 누락 · 상태 코드 하드코딩 · 재시도 범위 축소 같은 차이를 만들었다.
			const projectIo: ProjectCommandIo = {
				send: async (command, sendOpts) => {
					// 로드 상태 복구용 Unload 도 그룹 Compile 뒤면 사람에게 묻는다(controller/commands/unloadRisk.ts).
					const unloadCheck = await confirmUnloadRiskInteractive(command);
					if (!unloadCheck.proceed) {
						throw Object.assign(new Error(`${command} 취소 — 그룹 Compile 뒤 Unload 확인에서 취소했습니다(보내지 않음).`), { sent: false });
					}
					// 실행 도중(확인 창 포함) 제어기가 바뀌었으면 남은 단계를 새 제어기에 보내지 않는다.
					if (!checkNodeTarget(node, '컴파일 & 실행', true)) {
						throw Object.assign(new Error(`${command} 중단 — 대상 제어기가 바뀌었습니다(보내지 않음).`), { sent: false });
					}
					const detailed = await sendCommandDetailed(command, cfg, {
						// 컴파일은 pass 사이에 수 초간 침묵한다 — 종결자까지 기다리지 않으면 응답이 잘려 거짓 성공이 난다(§0.2).
						...(sendOpts?.forCompile ? { waitForStatusClose: true, timeoutMs: Math.max(cfg.timeoutMs, 60000) } : {}),
						confirmUnloadRisk: unloadCheck.confirmUnloadRisk,
					});
					return { raw: detailed.raw, meta: detailed.meta };
				},
				log: line => host.log(`│ ${line}`),
			};

			const ensureStoppedBeforeCompile = async (): Promise<boolean> => {
				host.log('│ Phase: Stop before Compile');
				// 정지 절차는 controller/threads/threadStop.ts 가 정본 — 진행 로그만 이 실행 로그(`│ `)에 합류시킨다(§1-DD).
				const outcome = await stopAllThreads(host, { logPrefix: '│ ', logTo: host.log });
				if (outcome.send.kind === 'failed') {
					const code = outcome.send.statusCode;
					throw new Error(`Stop -all failed: ${code === undefined ? '' : `STATUS ${code} `}${outcome.send.message}`.trimEnd());
				}
				// 확인 불가(무응답)를 정지로 보지 않는다 — 이 뒤에 Load/Compile/Start 가 이어진다(§0.6).
				if (outcome.ok && outcome.settle?.unconfirmed !== true) {
					host.log('│ ✔ Stop complete');
					return true;
				}

				host.log('│ ⚠ Stop sent, but thread stop confirmation is delayed');
				return false;
			};

			try {
				// §0.6: Stop -all의 STATUS 0은 "정지 요청 수리"일 뿐 정지 완료가 아니다.
				// 전체 정지가 확인되지 않으면 Load/Compile/Start를 진행하지 않고 중단한다.
				if (!checkNodeTarget(node, '컴파일 & 실행', true)) { return; }
				const stoppedBeforeRun = await ensureStoppedBeforeCompile();
				if (!stoppedBeforeRun) {
					throw new Error('Stop -all 후 전체 정지가 확인되지 않았습니다. 스레드 상태를 확인한 뒤 다시 시도하세요 (Load/Compile/Start 중단).');
				}

				/** Load 한 번 — HTTP 응답(제어기 이상)은 재시도로 자극하지 않고 즉시 중단한다. */
				const ensureLoadedFromFtp = async (): Promise<void> => {
					const loaded = await loadProject(projectIo, effectiveLoadPath);
					if (!loaded.ok) {
						throw new Error(loaded.httpResponse
							? `Load 중단: ${loaded.failure?.message} — 제어기 웹 UI/GDE 접속 여부를 확인하세요.`
							: `Load failed: ${effectiveLoadPath} (STATUS ${loaded.failure?.code} ${loaded.failure?.message ?? ''})`.trimEnd());
					}
				};

				if (loadBeforeCompile) {
					await ensureLoadedFromFtp();
				}

				// 여유 메모리 심각이면 Compile 전에 계속/취소를 묻는다(2026-10-27) — 배포·Start 와 같은 사람 경로 규칙.
				if (isMemoryConfirmOnCritical()) {
					const memory = await checkMemoryBeforeOperation();
					if (memory.level === 'critical' && !(await confirmMemoryCriticalInteractive(memory, 'Compile'))) {
						host.log(`│ ✘ 사용자가 여유 메모리 심각 경고에서 취소 (Free ${memory.freeMb ?? '?'} MB) — Compile/Start 미전송`);
						vscode.window.showWarningMessage(`${name} 컴파일 & 실행 중단: 여유 메모리 심각 경고에서 취소했습니다.`);
						return;
					}
				}

				// 1) Compile — 일시적 STATUS(-742/-746/-752) 1회 재시도는 모듈이 한다.
				host.log('│ Phase: Compile uploaded controller copy');
				let compile = await compileProject(projectIo, { candidates: [name] });
				if (!compile.ok) {
					const statusCode = compile.failure?.code ?? NO_STATUS_CODE;
					// 로드 상태 이상은 복구 후 한 번 더 — 어떤 코드가 어떤 상태인지는 controllerStatusCodes 가 정본이다.
					if (isProjectAlreadyLoaded(statusCode)) {
						host.log('│ ⚠ Already loaded → Unload → Load → Compile');
						const unloaded = await unloadProject(projectIo, name);
						if (!unloaded.ok) {
							throw new Error(unloaded.blockedByActiveThread
								? `Unload 불가: 쓰레드가 실행 중입니다(STATUS ${unloaded.failure?.code}). 정지 후 다시 시도하세요.`
								: `Unload failed: STATUS ${unloaded.failure?.code} ${unloaded.failure?.message ?? ''}`.trimEnd());
						}
						await ensureLoadedFromFtp();
						compile = await compileProject(projectIo, { candidates: [name] });
					} else if (isProjectNotLoaded(statusCode)) {
						host.log('│ ⚠ Not loaded → Load → Compile');
						await ensureLoadedFromFtp();
						compile = await compileProject(projectIo, { candidates: [name] });
					}
				}

				if (!compile.ok) {
					// 컴파일 에러는 배포 경로와 **같은 방식으로** 보여준다 — Problems 진단 + 첫 에러로 점프(§1-DE).
					// 로컬에 같은 이름의 프로젝트가 있으면 그 폴더 기준으로 파일을 해석한다(FTP Run 은 원격 사본을 컴파일한다).
					const localDir = await findLocalProjectDir(name);
					if (compile.errors.length > 0 && localDir) {
						applyCompileDiagnostics(compile.errors, localDir, deployDiagnostics);
						await jumpToFirstCompileError(compile.errors, localDir, (msg: string) => host.log(`│ ${msg}`));
					}
					for (const e of compile.errors) {
						host.log(`│ ✘ ${e.file}:${e.line} (${e.code}) ${e.message}${e.hint ? ` — 힌트: ${e.hint}` : ''}`);
					}
					const first = compile.errors[0];
					throw new Error(first
						? `Compile failed: ${first.file}:${first.line} (${first.code}) ${first.message}${compile.errors.length > 1 ? ` 외 ${compile.errors.length - 1}건` : ''}`
						: `Compile failed: STATUS ${compile.failure?.code} ${compile.failure?.message ?? ''}`.trimEnd());
				}

				// Compile이 성공했으니 "컴파일 필요" 상태가 있었다면 해제하고, 이전 진단도 지운다.
				host.clearCompileStale(name);
				deployDiagnostics.clear();

				// 2) 콘솔 자동 시작/재연결 (Start 직전 블라인드 구간 완화) — 배포 경로와 같은 절차(§1-DE).
				await host.primeRuntimeConsoleForStart('FTP Run');
				consoleChannel.show(true);

				// 3) Start — 명령 조립은 buildStartCommand 하나만 쓴다(종전에는 여기만 `-event` 가 빠져 있었다).
				const start = await startProject(projectIo, {
					projectName: name,
					eventMode: vscode.workspace.getConfiguration('gpl').get<boolean>('controller.startEventMode', true),
				});
				if (!start.ok) {
					throw new Error(`Start failed: STATUS ${start.statusCode} ${start.message}`.trimEnd());
				}
				vscode.window.showInformationMessage(`${name} 업로드된 제어기 복사본 기준 컴파일 & 실행 완료`);
				host.controllerTree?.refresh();
			} catch (err: any) {
				host.log(`│ ✘ 실패: ${err.message ?? err}`);
				vscode.window.showErrorMessage(`${name} 실행 실패: ${err.message ?? err}`);
			}
		})
	);

	// FTP 폴더 중지
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.ftpStop', async (node: any) => {
			// 하위 폴더 이름으로 `Stop <이름>` 을 보내지 않는다 — 프로젝트 폴더·현재 제어기의 노드만.
			const target = checkNodeTarget(node, '중지', true);
			if (!target) { return; }
			const name = target.projectName!;

			try {
				// 트리의 「쓰레드 정지」와 같은 절차다(controllerOps.stopThreadWithRecovery, §1-DD).
				await stopThreadWithRecovery(host, name);
			} catch (err: any) {
				vscode.window.showErrorMessage(`${name} 중지 실패: ${err.message ?? err}`);
			}
		})
	);

	// FTP 폴더 Unload (메모리 해제) — 사람이 누르는 Unload 는 기본 `Unload -all`(2026-11-03 사용자 결정). 한 프로젝트만
	// 내리는 길은 「Unload Project」 목록에 남긴다. 비우는 폴더는 /GPL 뿐이다 — 플래시 폴더 노드에서 눌러도 플래시는 건드리지 않는다.
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.ftpUnload', async (node: any) => {
			// 이름은 쓰지 않지만, 다른 제어기·하위 폴더 노드에서 실행되지 않게 대상 검사는 그대로 둔다.
			if (!checkNodeTarget(node, 'Unload', true)) { return; }
			await runUnloadAllInteractive(() => !!checkNodeTarget(node, 'Unload', true));
		}),

		// ── Unload Project — 팔레트·트리 제목·메모리 알림의 「Unload…」(2026-10-27 사용자 요청: "Unload 할 수 있는 버튼 필요") ──
		// 메모리 폭주가 Unload 로 상당 부분 회복됨을 사용자가 확인했다. 콘솔에는 로드된 프로젝트를 보는 명령이 없으므로
		// (`Show Project` 는 -714) /GPL 폴더 목록에서 고른다(읽기 전용 FTP LIST). 위험 판정(그룹 Compile 뒤·대상이 그룹)은
		// 다른 경로와 같은 모달(confirmUnloadRiskInteractive)과 전송 가드가 맡는다.
		vscode.commands.registerCommand(UNLOAD_PROJECT_COMMAND, async () => {
			if (!isControllerSessionConnected()) {
				vscode.window.showWarningMessage('Unload: 제어기에 연결돼 있지 않습니다 — 먼저 「GPL: Connect」를 실행하세요.');
				return;
			}
			const busy = host.currentDeployLockHolder();
			if (busy) {
				host.warnDeployBusy('Unload', busy, '완료 후 다시 시도하세요');
				return;
			}
			const cfg = getControllerConfig();
			const root = normalizeAbsoluteRemoteDir(cfg.ftpBasePath);
			let names: string[] = [];
			let listError: string | undefined;
			try {
				names = (await listRemoteDir(cfg.ip, root)).filter(e => e.isDirectory).map(e => e.name)
					.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
			} catch (err: any) {
				listError = err?.message ?? String(err);
				host.log(`[Unload] ${root} 목록 조회 실패: ${listError} — 이름 입력으로 대신합니다`);
			}
			type Item = vscode.QuickPickItem & { name?: string; all?: boolean; manual?: boolean };
			// 기본값은 `Unload -all`(2026-11-03 사용자 결정) — 맨 위 항목이라 Enter 만 누르면 전체를 내린다.
			const items: Item[] = [
				{ label: '$(close-all) 모두 내리기 (Unload -all)', description: `기본 — ${root} 을 비운 뒤 전부 내립니다. 쓰레드가 실행 중이면 -750 으로 거부됩니다`, all: true },
				{ label: '이 프로젝트만', kind: vscode.QuickPickItemKind.Separator } as Item,
				...names.map<Item>(n => ({ label: `$(folder) ${n}`, description: `${root}/${n}`, name: n })),
				{ label: '$(edit) 이름 직접 입력…', description: '목록에 없는(또는 조회 실패한) 프로젝트', manual: true },
			];
			const pick = await vscode.window.showQuickPick(items, {
				placeHolder: listError
					? `${root} 목록을 읽지 못했습니다 — 전체 Unload 또는 이름 직접 입력`
					: `Enter = 모두 내리기(Unload -all) · 한 프로젝트만 내리려면 아래에서 선택 (${root} 폴더 ${names.length}개)`,
				matchOnDescription: true,
			});
			if (!pick) { return; }
			let name: string | undefined = pick.name;
			if (pick.manual) {
				name = (await vscode.window.showInputBox({ prompt: 'Unload 할 프로젝트 이름', placeHolder: '예: BinderR3', ignoreFocusOut: true }))?.trim();
				if (!name) { return; }
			}
			if (pick.all) {
				await runUnloadAllInteractive();
				return;
			}
			await runUnloadInteractive(name!);
		})
	);

	/**
	 * `Unload <name>` 사람 경로 — 트리 우클릭과 「Unload Project」가 같은 절차를 쓴다.
	 * 하드 규칙 2: 성공/실패는 그 명령의 STATUS 로 판정한다. 종전에는 응답을 보지 않고 무조건 "Unload 완료"를 띄워,
	 * 쓰레드가 살아 있어 거부된(-750) 경우에도 성공으로 보고했다(§1-DD). 판정 자체는
	 * controller/commands/projectCommands.unloadProject 가 한다(FTP Run 과 같은 절차, §1-DE).
	 * 그룹 Compile 뒤·대상이 그룹이면 모달로 확인한다(위험 근거가 없으면 묻지 않는다).
	 * @param recheck 모달 대기 뒤 대상이 여전히 유효한지(트리 노드의 제어기가 바뀌었을 수 있다).
	 */
	async function runUnloadInteractive(name: string, recheck?: () => boolean): Promise<void> {
		if (!host.ensureProjectNameSafe(name, 'remote', 'Unload')) { return; }
		try {
			const unloadCheck = await confirmUnloadRiskInteractive(`Unload ${name}`);
			if (!unloadCheck.proceed) { return; }
			if (recheck && !recheck()) { return; }
			const outcome = await unloadProject(
				{
					// 실행 뒤 앱 Unload 는 수십 초 걸릴 수 있다 — 짧은 타임아웃으로 소켓을 닫으면 1402 가 거부 상태로 남는다(UNLOAD_TIMEOUT_MIN_MS).
					send: async command => ({
						raw: (await sendCommandDetailed(command, undefined, {
							confirmUnloadRisk: unloadCheck.confirmUnloadRisk,
							timeoutMs: unloadTimeoutMs(getControllerConfig().timeoutMs),
							waitForStatusClose: true,
						})).raw,
					}),
					log: line => host.log(`[Unload] ${line}`),
				},
				name,
			);
			if (outcome.notLoaded) {
				vscode.window.showInformationMessage(`${name} 은(는) 로드돼 있지 않습니다 (Unload 불필요)`);
			} else if (outcome.ok) {
				vscode.window.showInformationMessage(`${name} Unload 완료`);
			} else {
				vscode.window.showErrorMessage(
					`${name} Unload 실패: STATUS ${outcome.failure?.code} ${outcome.failure?.message ?? ''}`.trimEnd()
					+ (outcome.blockedByActiveThread || isBusyStatus(outcome.failure?.code ?? 0)
						? ' — 쓰레드를 먼저 정지하세요.' : ''));
			}
			host.controllerTree?.refresh();
		} catch (err: any) {
			vscode.window.showErrorMessage(`Unload 실패: ${err.message ?? err}`);
		}
	}

	/**
	 * `Unload -all` 사람 경로 — 위험 모달·전송 가드는 이름 지정과 같고, 판정은 STATUS 로 한다.
	 * **보내기 전에 /GPL 을 비운다**(2026-10-28 사용자 요청, §1-GN): 비우기 절차(배포 잠금·쓰레드 정지 게이트·정체 확인·목록 모달)를
	 * 그대로 거치고, 취소·실패면 Unload 도 보내지 않는다. 이미 비어 있으면 바로 Unload 로 간다.
	 * 트리 우클릭과 「Unload Project」의 기본 항목이 이 절차를 쓴다(2026-11-03).
	 * @param recheck 모달 대기 뒤 대상이 여전히 유효한지(트리 노드의 제어기가 바뀌었을 수 있다).
	 */
	async function runUnloadAllInteractive(recheck?: () => boolean): Promise<void> {
		const command = 'Unload -all';
		try {
			const unloadCheck = await confirmUnloadRiskInteractive(command);
			if (!unloadCheck.proceed) { return; }
			if (recheck && !recheck()) { return; }
			const cfg = getControllerConfig();
			const gplRoot = cfg.ftpBasePath;
			// 비우는 폴더는 로드 폴더(/GPL) 하나뿐이다. 설정이 /flash 쪽을 가리키면 플래시 저장본을 지우게 되므로 비우지도 보내지도 않는다.
			const rootKind = classifyRemoteClearRoot(gplRoot, { gplBasePath: cfg.ftpBasePath, flashBasePath: cfg.ftpFlashProjectsPath });
			if (rootKind === 'flash' || rootKind === 'unsafe') {
				host.log(`[Unload] gpl.controller.ftpBasePath(${gplRoot}) 가 ${rootKind === 'flash' ? '플래시 경로' : '루트/빈 경로'}라 비우지 않았습니다 — ${command} 미전송`);
				vscode.window.showErrorMessage(`${command} 중단: gpl.controller.ftpBasePath(${gplRoot}) 가 /GPL 이 아닙니다 — 플래시·루트는 비우지 않습니다. 설정을 확인하세요.`);
				return;
			}
			host.log(`[Unload] ${command} 전에 ${normalizeAbsoluteRemoteDir(gplRoot)} 을 비웁니다`);
			const cleared = await clearRemoteFolderInteractive({ rawPath: gplRoot, isFlash: false, purpose: command });
			if (!cleared.ok) {
				const why = cleared.cancelled ? '취소' : `실패(${cleared.reason ?? 'unknown'})`;
				host.log(`[Unload] ${cleared.root} 비우기 ${why} — ${command} 을 보내지 않았습니다`);
				if (!cleared.cancelled) {
					vscode.window.showWarningMessage(`${cleared.root} 비우기 ${why} — ${command} 을 보내지 않았습니다.`);
				}
				return;
			}
			host.log(`[Unload] ${cleared.root} ${cleared.reason === 'already-empty' ? '이미 비어 있음' : `비움(${cleared.deleted.length}개)`} → ${command}`);
			host.log(`[Unload] CMD ${command}`);
			const resp = await sendCommandDetailed(command, undefined, {
				confirmUnloadRisk: unloadCheck.confirmUnloadRisk,
				timeoutMs: unloadTimeoutMs(getControllerConfig().timeoutMs),
				waitForStatusClose: true,
			});
			const status = parseStatus(resp.raw);
			if (!resp.meta.statusTagReceived) {
				vscode.window.showWarningMessage(`${command}: STATUS 종결을 받지 못했습니다 — 결과 미확정(명령 콘솔이 잠시 응답하지 않을 수 있습니다).`);
			} else if (status.code === 0) {
				vscode.window.showInformationMessage('모든 프로젝트 Unload 완료');
			} else {
				vscode.window.showErrorMessage(
					`${command} 실패: STATUS ${status.code} ${status.message ?? ''}`.trimEnd()
					+ (isBusyStatus(status.code) || status.code === -750 ? ' — 쓰레드를 먼저 정지하세요.' : ''));
			}
			host.controllerTree?.refresh();
		} catch (err: any) {
			vscode.window.showErrorMessage(`${command} 실패: ${err.message ?? err}`);
		}
	}
}
