/**
 * FTP 노드 명령 — 다운로드·삭제·폴더 비우기·컴파일 & 실행(ftpRun)·중지·Unload.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { EXTENSION_VERSION } from '../config';
import { getControllerConfig, sendCommand, sendCommandDetailed } from '../controller/controllerConnection';
import { isBusyStatus } from '../controller/controllerStatusCodes';
import {
	FtpEntry,
	clearRemoteDir,
	downloadProject,
	listRemoteDir,
	normalizeAbsoluteRemoteDir,
	removeRemoteDir,
	removeRemoteFile,
} from '../controller/ftpClient';
import { SHOW_THREAD_LIST_CMD, isControllerNonBlockingStatus, parseCompileErrors, parseStatus, parseThreadList } from '../controller/responseParser';
import { forgetSyncManifest } from '../controller/syncManifest';
import { describeThreadActivity } from '../controller/threadActivity';
import { sendCommandWithBusyRetry, sleep, trySoftEStopRecovery, verifyAllStopped, verifyThreadStopped } from './controllerOps';
import type { ExtensionHost } from './host';

export function activateFtpCommands(host: ExtensionHost): void {
	const { context, outputChannel, consoleChannel } = host;

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
						const result = await downloadProject(host, remotePath, localDir, (cur, total, file) => {
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
		try {
			const stopResp = await sendCommandWithBusyRetry(host, 'Stop -all', { maxAttempts: 5, baseDelayMs: 500 });
			const status = parseStatus(stopResp);
			// STATUS -752(Timeout stopping thread)는 "정지 진행 중"이라 실패가 아니다 — 최종 판정은 아래 settle 게이트로.
			if (status.code !== 0 && !isBusyStatus(status.code)) {
				vscode.window.showErrorMessage(`정지 실패: STATUS ${status.code} ${status.message} — 삭제를 중단합니다.`);
				return false;
			}
		} catch (err: any) {
			vscode.window.showErrorMessage(`정지 실패: ${err.message ?? err} — 삭제를 중단합니다.`);
			return false;
		}
		if (!(await verifyAllStopped(host, 8))) {
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

			const resolveFtpRunPath = async (): Promise<{
				loadPath: string;
				basePath: string;
				candidates: string[];
				switched: boolean;
			}> => {
				const configuredBases = [
					cfg.ftpFlashProjectsPath,
					cfg.ftpBasePath,
					path.posix.dirname(loadPath),
				];
				const uniqueBases = [...new Set(configuredBases
					.map(p => (p || '').replace(/\/+$/, ''))
					.filter(Boolean))];

				const scored: Array<{ basePath: string; projectPath: string; exists: boolean; rank: number }> = [];
				for (const basePath of uniqueBases) {
					const projectPath = `${basePath}/${name}`;
					let exists = false;
					try {
						const entries = await listRemoteDir(cfg.ip, basePath);
						exists = entries.some(e => e.isDirectory && e.name.toLowerCase() === name.toLowerCase());
					} catch {
						// Probe failure leaves the path as a candidate, but not a confirmed one.
					}

					const isSelected = projectPath.toLowerCase() === loadPath.toLowerCase();
					const isFlash = basePath.toLowerCase() === cfg.ftpFlashProjectsPath.toLowerCase();
					const rank = (exists ? 200 : 0) + (isFlash ? 80 : 0) + (isSelected ? 20 : 0);
					scored.push({ basePath, projectPath, exists, rank });
				}

				scored.sort((a, b) => b.rank - a.rank);
				const chosen = scored[0] ?? {
					basePath: path.posix.dirname(loadPath),
					projectPath: loadPath,
					exists: false,
					rank: 0,
				};
				return {
					loadPath: chosen.projectPath,
					basePath: chosen.basePath,
					candidates: scored.map(s => `${s.projectPath}${s.exists ? ' (exists)' : ''}`),
					switched: chosen.projectPath.toLowerCase() !== loadPath.toLowerCase(),
				};
			};

			const resolvedPath = await resolveFtpRunPath();
			const effectiveLoadPath = resolvedPath.loadPath;

			host.log('');
			host.log(`━━ [FTP Run v${EXTENSION_VERSION}] ${name} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
			host.log(`│ Note: FTP Run uses the uploaded controller copy at ${effectiveLoadPath}`);
			host.log(`│       Local edits are NOT uploaded here. Use GPL: Deploy (Build Only) to verify latest local code.`);
			host.log(`│ Path candidates: ${resolvedPath.candidates.join(' | ') || effectiveLoadPath}`);
			if (resolvedPath.switched) {
				host.log(`│ Path selected: ${loadPath} → ${effectiveLoadPath}`);
			}
			host.log(`│ Load before Compile: ${loadBeforeCompile ? 'enabled' : 'skipped'}`);

			type FtpCompileAttempt = {
				raw: string;
				status: ReturnType<typeof parseStatus>;
				errors: ReturnType<typeof parseCompileErrors>;
				ok: boolean;
				note?: string;
				responseMeta?: {
					responseComplete: boolean;
					bytesReceived: number;
					lastChunkAt: string;
					idleTimeoutMs: number;
				};
			};

			const rawPreview = (raw: string): string => {
				const compact = raw.replace(/\r/g, '').replace(/\n+/g, ' | ').trim();
				return compact.length > 260 ? `${compact.slice(0, 260)}...` : compact;
			};

			const runStatusCommand = async (command: string) => {
				const raw = await sendCommand(command);
				const status = parseStatus(raw);
				return {
					raw,
					status,
					ok: status.code === 0 || isControllerNonBlockingStatus(status.code),
				};
			};

			const logCompileAttempt = (compile: FtpCompileAttempt): void => {
				host.log(`│ RAW ${rawPreview(compile.raw) || '(empty)'}`);
				if (compile.note) {
					host.log(`│ NOTE ${compile.note}`);
				}
				if (compile.responseMeta && !compile.responseMeta.responseComplete) {
					host.log(`│ META responseComplete=false bytesReceived=${compile.responseMeta.bytesReceived} lastChunkAt=${compile.responseMeta.lastChunkAt} idleTimeoutMs=${compile.responseMeta.idleTimeoutMs}`);
				}
			};

			const tryCompile = async (): Promise<FtpCompileAttempt> => {
				// 컴파일은 pass 사이에 수 초간 침묵할 수 있어 idle 기반 조기 완료는 응답이 잘려
				// STATUS/에러 라인을 놓친다. deployService.tryCompile과 동일하게 종결자
				// </STATUS>까지 대기하고 대형 프로젝트 대비 충분한 상한을 둔다 (§0.2).
				const detailed = await sendCommandDetailed(`Compile ${name}`, cfg, {
					waitForStatusClose: true,
					timeoutMs: Math.max(cfg.timeoutMs, 60000),
				});
				const raw = detailed.raw;
				const status = parseStatus(raw);
				const errors = parseCompileErrors(raw);

				if ((status.code === 0 || isControllerNonBlockingStatus(status.code)) && errors.length === 0) {
					return {
						raw,
						status,
						errors,
						ok: true,
						responseMeta: detailed.meta,
					};
				}

				// STATUS가 없으면(-9999) 컴파일 결과를 확인하지 못한 것이다. 'compile successful'
				// 텍스트 마커나 Show Thread 응답으로 성공을 추정하지 않는다 — 실제 컴파일 에러를
				// 가리는 오판의 직접 원인이었다. 성공 판정은 STATUS 0 + 에러 없음뿐이다 (§0.2/§0.3).
				return {
					raw,
					status,
					errors,
					ok: false,
					note: status.code === -9999 ? 'STATUS 누락 — 컴파일 결과 미확인(성공 추정 금지)' : undefined,
					responseMeta: detailed.meta,
				};
			};

			const ensureStoppedBeforeCompile = async (): Promise<boolean> => {
				host.log('│ Phase: Stop before Compile');
				host.log('│ Stop -all');
				const stopResp = await sendCommandWithBusyRetry(host, 'Stop -all', { maxAttempts: 5, baseDelayMs: 500 });
				const stopStatus = parseStatus(stopResp);
				if (stopStatus.code !== 0 && !isBusyStatus(stopStatus.code)) {
					throw new Error(`Stop -all failed: STATUS ${stopStatus.code} ${stopStatus.message || ''}`.trimEnd());
				}

				const stopped = await verifyAllStopped(host, 8);
				if (stopped) {
					host.log('│ ✔ Stop complete');
					return true;
				}

				host.log('│ ⚠ Stop sent, but thread stop confirmation is delayed');
				return false;
			};

			const ensureLoadedFromFtp = async (): Promise<boolean> => {
				host.log(`│ Load ${effectiveLoadPath}`);
				const { status } = await runStatusCommand(`Load ${effectiveLoadPath}`);
				if (status.code === 0) {
					host.log(`│ ✔ Load success`);
					return true;
				}
				if (status.code === -745) {
					host.log(`│ ✔ Load skipped (already loaded)`);
					return true;
				}
				host.log(`│ ✘ Load failed: STATUS ${status.code} ${status.message || ''}`.trimEnd());
				return false;
			};

			try {
				// §0.6: Stop -all의 STATUS 0은 "정지 요청 수리"일 뿐 정지 완료가 아니다.
				// 전체 정지가 확인되지 않으면 Load/Compile/Start를 진행하지 않고 중단한다.
				const stoppedBeforeRun = await ensureStoppedBeforeCompile();
				if (!stoppedBeforeRun) {
					throw new Error('Stop -all 후 전체 정지가 확인되지 않았습니다. 스레드 상태를 확인한 뒤 다시 시도하세요 (Load/Compile/Start 중단).');
				}
				if (loadBeforeCompile) {
					const loadedBeforeCompile = await ensureLoadedFromFtp();
					if (!loadedBeforeCompile) {
						throw new Error(`Load failed: ${effectiveLoadPath}`);
					}
				}

				// 1) Compile 시도
				host.log('│ Phase: Compile uploaded controller copy');
				host.log(`│ Compile ${name}`);
				let compile = await tryCompile();
				logCompileAttempt(compile);
				if (!compile.ok) {
					const statusCode = compile.status.code;
					if (statusCode === -746) {
						host.log('│ ⚠ STATUS -746 Interlocked for read');
						host.log('│ ⚠ Retry path: Stop → wait → Compile');
						const stoppedForRetry = await ensureStoppedBeforeCompile();
						if (!stoppedForRetry) {
							throw new Error('Stop -all 후 전체 정지가 확인되지 않아 Compile 재시도를 중단했습니다 (§0.6).');
						}
						await sleep(500);
						compile = await tryCompile();
						logCompileAttempt(compile);
						if (!compile.ok) {
							throw new Error(`Compile failed after retry: STATUS ${compile.status.code} ${compile.status.message || ''}${compile.note ? ` — ${compile.note}` : ''}`.trimEnd());
						}
						host.log('│ ✔ Compile success (after interlock retry)');
					} else if (statusCode === -745) {
						host.log(`│ ⚠ Already loaded → Unload → Load → Compile`);
						const { status: unloadStatus } = await runStatusCommand(`Unload ${name}`);
						if (unloadStatus.code === 0) {
							host.log(`│ ✔ Unload success`);
						} else if (unloadStatus.code === -508 || unloadStatus.code === -743) {
							host.log(`│ ✔ Unload skipped (project not loaded)`);
						} else {
							throw new Error(`Unload failed: STATUS ${unloadStatus.code} ${unloadStatus.message || ''}`.trimEnd());
						}
						const loaded = await ensureLoadedFromFtp();
						if (!loaded) {
							throw new Error(`Load failed: ${effectiveLoadPath}`);
						}
						compile = await tryCompile();
						logCompileAttempt(compile);
						if (!compile.ok) {
							throw new Error(`Compile failed: STATUS ${compile.status.code} ${compile.status.message || ''}${compile.note ? ` — ${compile.note}` : ''}`.trimEnd());
						}
						host.log(`│ ✔ Compile success (after reload)`);
					} else if (statusCode === -508 || statusCode === -743) {
						host.log(`│ ⚠ Not loaded → Load → Compile`);
						const loaded = await ensureLoadedFromFtp();
						if (!loaded) {
							throw new Error(`Load failed: ${effectiveLoadPath}`);
						}
						compile = await tryCompile();
						logCompileAttempt(compile);
						if (!compile.ok) {
							throw new Error(`Compile failed: STATUS ${compile.status.code} ${compile.status.message || ''}${compile.note ? ` — ${compile.note}` : ''}`.trimEnd());
						}
						host.log(`│ ✔ Compile success (after load)`);
					} else {
						const compileError = compile.errors[0];
						if (compileError) {
							throw new Error(`Compile failed: ${compileError.file}:${compileError.line} (${compileError.code}) ${compileError.message}`);
						}
						throw new Error(`Compile failed: STATUS ${compile.status.code} ${compile.status.message || ''}${compile.note ? ` — ${compile.note}` : ''}`.trimEnd());
					}
				} else {
					host.log(`│ ✔ Compile success`);
				}

				// Compile이 성공했으니 "컴파일 필요" 상태가 있었다면 해제.
				host.clearCompileStale(name);

				// 2) 콘솔 자동 시작/재연결 (Start 직전 블라인드 구간 완화)
				const console = host.ensureRuntimeConsole();
				console.primeForRuntimeStart();
				await console.waitUntilReady(1200);
				consoleChannel.show(true);

				// 3) Start
				host.log(`│ Start ${name}`);
				const { status: startStatus } = await runStatusCommand(`Start ${name}`);
				if (startStatus.code !== 0) {
					throw new Error(`Start failed: STATUS ${startStatus.code} ${startStatus.message || ''}`.trimEnd());
				}
				host.log(`│ ✔ Start success`);
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
				const stopResp = await sendCommandWithBusyRetry(host, `Stop ${name}`, { maxAttempts: 5, baseDelayMs: 400 });
				const status = parseStatus(stopResp);
				if (status.code !== 0 && !isBusyStatus(status.code)) {
					vscode.window.showErrorMessage(`${name} 중지 실패: STATUS ${status.code} ${status.message}`);
					return;
				}

				const stopped = await verifyThreadStopped(host, name, 7);
				if (!stopped) {
					const recovered = await trySoftEStopRecovery(host, name);
					if (!recovered) {
						vscode.window.showWarningMessage(`${name} 정지 명령은 전송됐지만 아직 실행 중일 수 있습니다. 잠시 후 다시 확인해줘.`);
					}
				} else {
					vscode.window.showInformationMessage(`${name} 중지 완료`);
				}
				host.controllerTree?.refresh();
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
				await sendCommand(`Unload ${name}`);
				vscode.window.showInformationMessage(`${name} Unload 완료`);
				host.controllerTree?.refresh();
			} catch (err: any) {
				vscode.window.showErrorMessage(`Unload 실패: ${err.message ?? err}`);
			}
		})
	);
}
