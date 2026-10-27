/**
 * `gpl.start` — 배포 없이 Start 만 전송("이미 올라간 것을 다시 돌리기"). 배포 잠금·실행 불가·프로젝트명·
 * "컴파일 검증 필요"·여유 메모리·모션 확인 게이트를 차례로 지나 `Start <name> -compile -event` 를 보내고
 * `<STATUS>` 로 판정한다. Start 전 컴파일 검증 확인 모달(`confirmStartWhenCompileStale`)은 연결·트리 그룹도 쓰므로
 * `host.deploy` 로 노출된다. `deploy.ts` 에서 분할(2026-10-27).
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { checkMemoryBeforeOperation, getControllerConfig, sendCommandDetailed } from '../../controller/connection/controllerConnection';
import { buildStartCommand, commandRunsCompiler } from '../../controller/commands/startCommand';
import { describeCompileStale } from '../../controller/deployment/compileStale';
import { readGprProjectName } from '../../controller/projects/projectPicker';
import { checkProjectName, describeProjectNameProblem } from '../../controller/projects/projectNameGuard';
import { isAutomationInvocation } from '../../controller/projects/projectTarget';
import { isControllerNonBlockingStatus, parseStatus } from '../../controller/protocol/responseParser';
import { confirmMemoryCriticalInteractive, isMemoryConfirmOnCritical } from '../controller/controllerOps';
import { automationFailure, isAutomationFailure } from './automationResult';
import type { AutomationTargetArgs } from './automationResult';
import { compileStaleGate, resolveAutomationTarget, startMotionGate } from './deployAutomation';
import type { DeployContext } from './deployContext';
import { describeNotRunnable, pickWorkspaceProjectDir } from './deployTargets';
import { runDeploy } from './runDeploy';

/**
 * Start 전 "컴파일 검증 필요" 상태 확인. 확장의 Start는 `-compile` 로 컴파일까지 함께 수행하므로(§0.7) 소스에 에러가
 * 있으면 Start가 실패해 실행되지 않는다 — 먼저 Compile로 검증할지 묻는다. 실패 위치는 Problems에 연동한다(§1-EW).
 * 단 Compile 직후 Start를 연속으로
 * 보내지 않으므로(한 번에 하나만, 컴파일 중복 회피) "Compile만 실행"을 고르면 Start는 하지 않는다. true면 Start 진행.
 */
export async function confirmStartWhenCompileStale(ctx: DeployContext, projectName: string, projectDir?: string): Promise<boolean> {
	const stale = ctx.host.findCompileStale(projectName);
	if (!stale) { return true; }
	const dir = projectDir ?? stale.projectDir;
	const choices = dir ? ['Compile만 실행', '그대로 Start'] : ['그대로 Start'];
	const pick = await vscode.window.showWarningMessage(
		describeCompileStale(stale),
		{
			modal: true,
			detail: '"Compile만 실행"은 에러를 확인만 하고 Start하지 않습니다(Compile 직후 Start 연속 실행은 피함 — 한 번에 하나만).',
		},
		...choices,
	);
	if (pick === 'Compile만 실행') {
		await runDeploy(ctx, true, { skipStop: true, skipUnchanged: true, quick: true, overrideProjectDir: dir });
		return false;
	}
	return pick === '그대로 Start';
}

// gpl.start — 배포 없이 Start만 전송. (구 gpl.deployRun의 START 단계를 분리한 것 — 확인 모달은 §0.6대로 적용.)
// ※ 2026-07-24의 "Deploy와 Start를 합치지 않는다"는 결정은 2026-08-31 사용자 결정으로 갱신됐다:
//   업로드+실행을 한 번에 하는 경로는 gpl.uploadStart가 담당하되 Compile은 보내지 않는다(§0.7, §1-CD).
//   이 명령은 "이미 올라간 것을 다시 돌리기"용으로 그대로 남는다.
export function registerStartCommand(ctx: DeployContext): void {
	const { host } = ctx;
	const { context, consoleChannel } = host;

	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.start', async (resource?: unknown) => {
			// 업로드/컴파일 도중 Start가 겹치면 제어기 이상(사망)을 유발할 수 있다 — 배포 잠금(다른 창/프로세스 포함)으로 차단.
			const busy = host.currentDeployLockHolder();
			if (busy) {
				host.warnDeployBusy('Start', busy, '완료 후 Start를 실행하세요 (업로드 중 Start는 제어기 이상을 유발할 수 있음)');
				return undefined;
			}
			// 대상 지정 객체로 불렸으면 비대화형 — QuickPick·모달을 띄우지 않고 구조화된 결과를 돌려준다(개선안 §17·§25).
			const auto = isAutomationInvocation(resource) ? resource as AutomationTargetArgs : undefined;
			let projectDir: string | undefined;
			if (auto) {
				const target = await resolveAutomationTarget(ctx, auto, 'gpl.start', { requireRunnable: true });
				if (isAutomationFailure(target)) { return target; }
				projectDir = target.dir;
			} else {
				projectDir = await pickWorkspaceProjectDir(ctx, '시작할 프로젝트를 선택하세요', resource);
			}
			if (!projectDir) { return undefined; }
			// 실행 불가(ProjectStart 없는 그룹)면 보내지 않는다 — Start -compile 이 그룹을 컴파일한 뒤 -744 로 끝난다.
			const notRunnable = auto ? undefined : await describeNotRunnable(projectDir);
			if (notRunnable) {
				host.log(`[Start] ${notRunnable}`);
				vscode.window.showErrorMessage(notRunnable);
				return undefined;
			}
			const gprName = readGprProjectName(projectDir);
			const projectName = gprName ?? path.basename(projectDir);
			// `Start <name>`은 공백 구분 명령 — 이름에 공백이 있으면 보내지 않고 이유를 알린다.
			if (auto) {
				const nameCheck = checkProjectName(projectName);
				if (!nameCheck.ok) {
					const reason = describeProjectNameProblem(projectName, gprName ? 'project' : 'folder', nameCheck);
					host.log(`[Automation] gpl.start 중단: ${reason}`);
					return automationFailure('PROJECT_NOT_FOUND', reason);
				}
			} else if (!host.ensureProjectNameSafe(projectName, gprName ? 'project' : 'folder', 'Start')) {
				return undefined;
			}
			// /GPL 소스가 Compile로 검증되지 않았으면 안내(Start 는 `-compile` 로 컴파일 — 소스 에러 시 Start 실패, §0.7).
			if (auto) {
				const stale = compileStaleGate(ctx, 'gpl.start', projectName, auto);
				if (stale) { return stale; }
			} else if (!(await confirmStartWhenCompileStale(ctx, projectName, projectDir))) {
				return undefined;
			}
			// 모달 대기 동안 다른 배포가 시작됐을 수 있으므로 잠금을 다시 확인한다.
			const busyAfter = host.currentDeployLockHolder();
			if (busyAfter) { host.warnDeployBusy('Start', busyAfter); return undefined; }

			if (auto) {
				const gate = startMotionGate(ctx, 'gpl.start', auto);
				if (gate) { return gate; }
			} else {
				// 여유 메모리 심각이면 Start 전에 계속/취소를 묻는다(2026-10-27). Start 는 `-compile` 이라 제어기에서 컴파일까지 돈다.
				if (isMemoryConfirmOnCritical()) {
					const memory = await checkMemoryBeforeOperation();
					if (memory.level === 'critical' && !(await confirmMemoryCriticalInteractive(memory, 'Start'))) {
						host.log(`[Start] 사용자가 여유 메모리 심각 경고에서 취소 (Free ${memory.freeMb ?? '?'} MB) — Start 미전송`);
						return undefined;
					}
				}
				const requireStartConfirm = vscode.workspace.getConfiguration('gpl')
					.get<boolean>('controller.requireStartConfirmation', true);
				if (requireStartConfirm) {
					const pick = await vscode.window.showWarningMessage(
						`'${projectName}' 프로그램을 시작합니다. 로봇이 움직일 수 있습니다.`,
						{ modal: true },
						'Start'
					);
					if (pick !== 'Start') { return undefined; }
				}
			}

			// Start 전 런타임 콘솔 준비 — 배포·FTP Run 과 같은 절차(host.primeRuntimeConsoleForStart, §1-DE).
			await host.primeRuntimeConsoleForStart('Start');

			try {
				// 문서 구문으로 조립(startCommand.ts) — 기본 `-compile`(§1-DN) + `-event`(GDE 동일)
				const startCmd = buildStartCommand({
					projectName,
					eventMode: vscode.workspace.getConfiguration('gpl').get<boolean>('controller.startEventMode', true),
				});
				host.log(`[Start] CMD ${startCmd}`);
				// `-compile` 이 붙은 Start 는 제어기에서 컴파일까지 돌리므로 응답이 Compile 과 똑같다 —
				// pass 사이 수 초 침묵 + 긴 출력. 짧은 idle 완료로 받으면 `begin compiler pass 2` 에서 잘려
				// `-9999 No STATUS found` 가 된다(2026-09-10 실기 관측, §1-DN).
				const startCfg = getControllerConfig();
				const startResp = await sendCommandDetailed(startCmd, startCfg, commandRunsCompiler(startCmd)
					? { waitForStatusClose: true, timeoutMs: Math.max(startCfg.timeoutMs, 60000) }
					: undefined);
				const raw = startResp.raw;
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
			return undefined;
		})
	);
}
