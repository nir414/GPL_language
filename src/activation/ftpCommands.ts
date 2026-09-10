/**
 * FTP 노드 명령 — 다운로드·삭제·폴더 비우기·컴파일 & 실행(ftpRun)·중지·Unload.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { EXTENSION_VERSION } from '../config';
import { getControllerConfig, sendCommand, sendCommandDetailed } from '../controller/controllerConnection';
import { isBusyStatus, isProjectAlreadyLoaded, isProjectNotLoaded } from '../controller/controllerStatusCodes';
import { applyCompileDiagnostics, findProjectDirs, jumpToFirstCompileError } from '../controller/deployService';
import { compileProject, loadProject, startProject, unloadProject } from '../controller/projectCommands';
import type { ProjectCommandIo } from '../controller/projectCommands';
import {
	FtpEntry,
	clearRemoteDir,
	downloadProject,
	listRemoteDir,
	normalizeAbsoluteRemoteDir,
	removeRemoteDir,
	removeRemoteFile,
} from '../controller/ftpClient';
import { NO_STATUS_CODE, SHOW_THREAD_LIST_CMD, parseThreadList } from '../controller/responseParser';
import { describeRemotePathCandidates, resolveRemoteProjectPath } from '../controller/remoteProjectPath';
import { forgetSyncManifest } from '../controller/syncManifest';
import { describeThreadActivity } from '../controller/threadActivity';
import { stopAllThreads, stopThreadWithRecovery } from './controllerOps';
import type { ExtensionHost } from './host';

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

	// FTP 프로젝트 다운로드
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.ftpDownload', async (node: any) => {
			const name: string | undefined = node?.projectName || node?.label;
			const remotePath: string | undefined = node?.remotePath;
			if (!name || !remotePath) { return; }

			// 저장 위치 선택
			const targetUri = await vscode.window.showOpenDialog({
				canSelectFolders: true,
				canSelectFiles: false,
				canSelectMany: false,
				openLabel: '여기에 다운로드',
				title: `"${name}" 프로젝트 다운로드 위치 선택`,
			});
			if (!targetUri?.[0]) { return; }

			const localDir = path.join(targetUri[0].fsPath, name);
			const cfg = getControllerConfig();
			const host = cfg.ip;

			await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: `${name} 다운로드 중...`, cancellable: false },
				async (progress) => {
					try {
						const result = await downloadProject(host, remotePath, localDir, (_cur, total, file) => {
							progress.report({ increment: (1 / total) * 100, message: file });
						});
						const openChoice = await vscode.window.showInformationMessage(
							`"${name}" 다운로드 완료 (${result.downloaded}개 파일)`,
							'폴더 열기', '워크스페이스에 추가',
						);
						if (openChoice === '폴더 열기') {
							await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(localDir));
						} else if (openChoice === '워크스페이스에 추가') {
							vscode.workspace.updateWorkspaceFolders(
								vscode.workspace.workspaceFolders?.length ?? 0, 0,
								{ uri: vscode.Uri.file(localDir), name },
							);
						}
					} catch (err: any) {
						vscode.window.showErrorMessage(`다운로드 실패: ${err.message ?? err}`);
					}
				},
			);
		})
	);

	// FTP 항목 삭제
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.ftpDelete', async (node: any) => {
			const name: string | undefined = node?.projectName || node?.label;
			const ctx: string | undefined = node?.contextValue;
			const remotePath: string | undefined = node?.remotePath;
			if (!name || !ctx || !remotePath) { return; }

			const isDir = ctx === 'ftpFolder' || ctx === 'ftpFlashFolder';
			const confirm = await vscode.window.showWarningMessage(
				`${isDir ? '폴더' : '파일'} "${name}"을(를) 제어기에서 삭제하시겠습니까?`,
				{ modal: true }, '삭제'
			);
			if (confirm !== '삭제') { return; }

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
	 * `Show Thread -web` 목록에 쓰레드가 하나라도 있으면 동작 중으로 보고(controller/threadActivity.ts),
	 * 사용자가 승인할 때만 Stop -all + 정지 확인까지 마친 뒤 true를 돌려준다.
	 * 상태를 확인할 수 없으면(STATUS 미수신) 정지 상태로 추정하지 않고 사용자에게 판단을 넘긴다(하드 규칙 2).
	 */
	async function ensureIdleBeforeRemoteDelete(target: string): Promise<boolean> {
		let threads: ReturnType<typeof parseThreadList> | null = null;
		try {
			const resp = await sendCommandDetailed(SHOW_THREAD_LIST_CMD);
			threads = resp.meta.statusTagReceived ? parseThreadList(resp.raw) : null;
		} catch {
			threads = null;
		}
		if (threads === null) {
			const pick = await vscode.window.showWarningMessage(
				`${target} 삭제 전 쓰레드 상태를 확인하지 못했습니다 (Show Thread 무응답).`,
				{ modal: true, detail: '제어기가 실행 중인지 모르는 상태에서 원격 파일을 지우면 파일 충돌·자원 누수가 생길 수 있습니다.' },
				'확인 없이 계속',
			);
			return pick === '확인 없이 계속';
		}
		if (threads.length === 0) { return true; }
		const pick = await vscode.window.showWarningMessage(
			`${target} 삭제 전에 쓰레드를 정지해야 합니다 — ${describeThreadActivity(threads)}`,
			{ modal: true, detail: '실행 중인 상태에서 원격 파일을 지우면 파일 충돌·자원 누수가 생길 수 있습니다. Stop -all로 모두 정지한 뒤 진행할까요?' },
			'모두 정지 후 계속',
		);
		if (pick !== '모두 정지 후 계속') { return false; }
		// 전송·STATUS 판정(-752 = 정지 진행 중)·정지 확인 폴링·재시도는 controller/threadStop.ts 가 한다(§1-DD).
		const outcome = await stopAllThreads(host, { logTo: (line: string) => host.log(`[Stop] ${line}`) });
		if (outcome.send.kind === 'failed') {
			const code = outcome.send.statusCode;
			vscode.window.showErrorMessage(`정지 실패: ${code === undefined ? '' : `STATUS ${code} `}${outcome.send.message} — 삭제를 중단합니다.`);
			return false;
		}
		// 확인 불가(Show Thread 무응답)도 진행하지 않는다 — 원격 파일 삭제는 되돌릴 수 없다.
		if (!outcome.ok || outcome.settle?.unconfirmed === true) {
			vscode.window.showWarningMessage('정지 완료를 확인하지 못해 삭제를 중단합니다. 상태를 확인한 뒤 다시 실행해주세요.');
			return false;
		}
		void host.controllerTree?.refresh();
		return true;
	}

	// FTP 폴더 통째로 비우기 — 트리 섹션(/GPL·Flash Projects) 헤더에서 실행한다.
	// 파일 하나씩 지우는 ftpDelete와 달리 "폴더 안을 전부" 지우므로 게이트를 더 두껍게 건다:
	// 배포 잠금 → 지울 목록 확인 → 쓰레드 정지 게이트 → 목록을 보여주는 모달 확인 → 삭제.
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.ftpClearFolder', async (node: any) => {
			const cfg = getControllerConfig();
			const isFlash = String(node?.contextValue ?? '') === 'section-ftpFlash';
			// 섹션 노드가 실제 표시 중인 경로를 최우선으로 쓰고(설정 변경 직후에도 화면과 일치), 없으면 설정값.
			const rawPath: string = node?.remotePath || (isFlash ? cfg.ftpFlashProjectsPath : cfg.ftpBasePath);
			const basePath = normalizeAbsoluteRemoteDir(rawPath);
			if (basePath === '/') {
				vscode.window.showErrorMessage(`폴더 비우기 중단 — 대상 경로가 비어 있거나 루트입니다 (설정값: "${rawPath ?? ''}")`);
				return;
			}

			// 업로드/컴파일 도중 원격 파일이 사라지면 반쯤 지워진 소스가 컴파일된다 — 배포 잠금으로 차단.
			const busy = host.currentDeployLockHolder();
			if (busy) {
				host.warnDeployBusy(`${basePath} 비우기`, busy, '완료 후 다시 실행하세요');
				return;
			}

			// 1) 지울 목록을 먼저 확인한다 — 사용자에게 그대로 보여주기 위함.
			let entries: FtpEntry[];
			try {
				entries = await listRemoteDir(cfg.ip, basePath);
			} catch (err: any) {
				vscode.window.showErrorMessage(`${basePath} 조회 실패: ${err.message ?? err}`);
				return;
			}
			const targets = entries.filter(e => e.name !== '.' && e.name !== '..');
			if (targets.length === 0) {
				vscode.window.showInformationMessage(`${basePath}은(는) 이미 비어 있습니다.`);
				return;
			}

			// 2) 쓰레드 정지 게이트
			if (!(await ensureIdleBeforeRemoteDelete(basePath))) { return; }

			// 3) 삭제 확인 — 무엇이 지워지는지 목록으로 보여준다.
			const PREVIEW_MAX = 15;
			const preview = targets.slice(0, PREVIEW_MAX)
				.map(e => (e.isDirectory ? `[폴더] ${e.name}` : e.name))
				.join('\n');
			const more = targets.length > PREVIEW_MAX ? `\n… 외 ${targets.length - PREVIEW_MAX}개` : '';
			const note = isFlash
				? '⚠ 플래시에 저장된 프로젝트가 지워집니다. 제어기 재부팅으로도 복구되지 않습니다.'
				: '로드본 소스가 지워집니다. 다시 쓰려면 Deploy로 업로드하거나 flash에서 Load 하세요. 제어기에 로드된 프로젝트 상태는 별개이므로 필요하면 Unload도 함께 하세요.';
			const confirm = await vscode.window.showWarningMessage(
				`${basePath}의 항목 ${targets.length}개를 제어기에서 모두 삭제할까요?`,
				{ modal: true, detail: `${preview}${more}\n\n${note}` },
				'모두 삭제',
			);
			if (confirm !== '모두 삭제') { return; }

			// 4) 삭제 — 개별 실패는 모아서 "부분 완료"로 알린다.
			host.log(`[FTP] ${basePath} 비우기 시작 — 대상 ${targets.length}개`);
			await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: `${basePath} 비우는 중...`, cancellable: false },
				async (progress) => {
					try {
						let done = 0;
						const result = await clearRemoteDir(cfg.ip, basePath, (name, isDirectory) => {
							done++;
							host.log(`[FTP] − del ${basePath}/${name}${isDirectory ? '/' : ''}`);
							progress.report({ increment: (1 / targets.length) * 100, message: `${done}/${targets.length} ${name}` });
						});
						// 원격을 지웠으니 그 경로들의 업로드 지문도 버린다(다음 동기화는 목록 조회로 다시 판정).
						forgetSyncManifest(cfg.ip, basePath);
						for (const name of result.deleted) {
							forgetSyncManifest(cfg.ip, `${basePath}/${name}`);
						}
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
					} catch (err: any) {
						host.log(`[FTP] ${basePath} 비우기 실패: ${err.message ?? err}`);
						vscode.window.showErrorMessage(`${basePath} 비우기 실패: ${err.message ?? err}`);
					} finally {
						void host.controllerTree?.refreshFtp();
					}
				},
			);
		})
	);

	// FTP 폴더 컴파일 & 실행 (Load 에러 핸들링 포함)
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.ftpRun', async (node: any) => {
			const name: string | undefined = node?.projectName || node?.label;
			const loadPath: string | undefined = node?.remotePath;
			if (!name || !loadPath) { return; }
			// `Load <path>` / `Compile <name>` / `Start <name>`은 공백 구분 명령 — 원격 폴더명·경로에 공백이 있으면 보내지 않는다.
			if (!host.ensureProjectNameSafe(name, 'remote', '컴파일 & 실행') || !host.ensureProjectNameSafe(loadPath, 'remote', '컴파일 & 실행')) { return; }
			// 업로드 도중 Compile/Start가 겹치면 제어기 이상을 유발할 수 있다 — 배포 잠금(다른 창/프로세스 포함)으로 차단.
			const busy = host.currentDeployLockHolder();
			if (busy) {
				host.warnDeployBusy('컴파일 & 실행', busy, '완료 후 컴파일 & 실행을 사용하세요');
				return;
			}

			const cfg = getControllerConfig();
			const loadBeforeCompile = vscode.workspace
				.getConfiguration('gpl.controller')
				.get<boolean>('ftpRunLoadBeforeCompile', false);

			outputChannel.show(true);

			// 어느 원격 사본을 실행할지 — 규칙은 controller/remoteProjectPath.ts 가 정본이다(§1-DE).
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
			if (resolvedPath.switched) {
				host.log(`│ Path selected: ${loadPath} → ${effectiveLoadPath}`);
			}
			host.log(`│ Load before Compile: ${loadBeforeCompile ? 'enabled' : 'skipped'}`);

			// Compile/Load/Unload/Start 절차는 controller/projectCommands.ts 가 정본이다(§1-DE).
			// 여기서는 전송(1402)과 로그 목적지만 물린다 — 종전에는 이 파일이 같은 절차를 따로 구현하면서
			// `-event` 누락 · 상태 코드 하드코딩 · 재시도 범위 축소 같은 차이를 만들었다.
			const projectIo: ProjectCommandIo = {
				send: async (command, sendOpts) => {
					const detailed = await sendCommandDetailed(command, cfg, sendOpts?.forCompile
						// 컴파일은 pass 사이에 수 초간 침묵한다 — 종결자까지 기다리지 않으면 응답이 잘려 거짓 성공이 난다(§0.2).
						? { waitForStatusClose: true, timeoutMs: Math.max(cfg.timeoutMs, 60000) }
						: undefined);
					return { raw: detailed.raw, meta: detailed.meta };
				},
				log: line => host.log(`│ ${line}`),
			};

			const ensureStoppedBeforeCompile = async (): Promise<boolean> => {
				host.log('│ Phase: Stop before Compile');
				// 정지 절차는 controller/threadStop.ts 가 정본 — 진행 로그만 이 실행 로그(`│ `)에 합류시킨다(§1-DD).
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
						host.log(`│ ✘ ${e.file}:${e.line} (${e.code}) ${e.message}`);
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
			const name: string | undefined = node?.projectName || node?.label;
			if (!name) { return; }

			try {
				// 트리의 「쓰레드 정지」와 같은 절차다(controllerOps.stopThreadWithRecovery, §1-DD).
				await stopThreadWithRecovery(host, name);
			} catch (err: any) {
				vscode.window.showErrorMessage(`${name} 중지 실패: ${err.message ?? err}`);
			}
		})
	);

	// FTP 폴더 Unload (메모리 해제)
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.ftpUnload', async (node: any) => {
			const name: string | undefined = node?.projectName || node?.label;
			if (!name) { return; }
			if (!host.ensureProjectNameSafe(name, 'remote', 'Unload')) { return; }

			try {
				// 하드 규칙 2: 성공/실패는 그 명령의 STATUS 로 판정한다. 종전에는 응답을 보지 않고 무조건
				// "Unload 완료"를 띄워, 쓰레드가 살아 있어 거부된(-750) 경우에도 성공으로 보고했다(§1-DD).
				// 판정 자체는 controller/projectCommands.unloadProject 가 한다(FTP Run 과 같은 절차, §1-DE).
				const outcome = await unloadProject(
					{ send: async command => ({ raw: await sendCommand(command) }), log: line => host.log(`[Unload] ${line}`) },
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
		})
	);
}
