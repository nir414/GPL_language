/**
 * 자동화 조회·고정 명령 — `gpl.automation.target`(세션 대상 조회/고정/해제)·`gpl.automation.operations`(장시간 작업
 * 진행/결과 조회). 둘 다 비대화형이며 제어기를 건드리지 않는다. 응답 조립은 `automationResult.ts`(순수).
 * `deploy.ts` 에서 분할(2026-10-27).
 */

import * as vscode from 'vscode';
import { getControllerConfig } from '../../controller/connection/controllerConnection';
import { recoveryFor } from '../../controller/automation/automationRecovery';
import { activeOperations, listOperations, readOperation } from '../../controller/automation/operationStore';
import { buildTargetCandidates } from '../../controller/projects/projectPicker';
import { isProjectTargetRequest } from '../../controller/projects/projectTarget';
import type { ProjectTargetRequest } from '../../controller/projects/projectTarget';
import { clampOperationListLimit, describeSessionTargetStatus, isAutomationFailure } from './automationResult';
import { resolveAutomationTarget } from './deployAutomation';
import type { DeployContext } from './deployContext';

export function registerAutomationCommands(ctx: DeployContext): void {
	const { host } = ctx;
	const { context } = host;

	/**
	 * `gpl.automation.target` — 세션 자동화 대상 조회/고정/해제 (개선안 §19·§27).
	 *
	 * 대상 없이 부르면 현재 상태(고정된 대상·후보 목록)를 돌려준다 — "왜 이 프로젝트가 올라갔지?"를
	 * 사후 추론하지 않고 바로 확인하기 위한 것이다. 대상을 주면 해석해 세션에 고정하고, 이후 `gpl.deploy` 등을
	 * 인자 없이(또는 대상 없는 객체로) 불러도 같은 프로젝트가 쓰인다. `clear: true` 면 고정을 푼다.
	 */
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.automation.target', async (args?: unknown) => {
			const a = (typeof args === 'object' && args !== null ? args : {}) as ProjectTargetRequest & { clear?: boolean };
			if (a.clear === true) {
				host.sessionTargetDir = undefined;
				host.log('[Automation] 세션 대상 해제');
			} else if (isProjectTargetRequest(a)) {
				const target = await resolveAutomationTarget(ctx, a, 'gpl.automation.target', { pin: true });
				if (isAutomationFailure(target)) { return target; }
			}
			const candidates = await buildTargetCandidates();
			return describeSessionTargetStatus(candidates, host.sessionTargetDir);
		})
	);

	/**
	 * `gpl.automation.operations` — 장시간 작업(배포·컴파일)의 진행/결과 조회 (개선안 §8·§11·§21).
	 *
	 * 브리지 응답 대기가 끊겨도 작업 자체는 계속 진행되고 결과는 파일에 남는다. 호출자는 같은 작업을
	 * 다시 실행하는 대신 여기서 상태를 확인한다 — `UNKNOWN` 은 실패가 아니라 **결과 미확정**이다.
	 * 읽기 전용이며 제어기를 건드리지 않는다.
	 */
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.automation.operations', async (args?: unknown) => {
			const a = (typeof args === 'object' && args !== null ? args : {}) as { operationId?: string; activeOnly?: boolean; limit?: number };
			const controllerId = getControllerConfig().ip;
			if (a.operationId) {
				const rec = readOperation(a.operationId);
				return rec
					? { ok: true, operation: rec }
					: {
						ok: false,
						error: 'OPERATION_UNKNOWN',
						detail: `작업 '${a.operationId}' 기록이 없습니다(오래돼 정리됐거나 id 가 다릅니다). `
							+ '기록이 없다는 것은 실패했다는 뜻이 아닙니다 — 제어기 상태를 관측해 판단하세요.',
						recovery: recoveryFor('OPERATION_UNKNOWN'),
					};
			}
			const all = a.activeOnly === true ? activeOperations({ controllerId }) : listOperations({ controllerId });
			return {
				ok: true,
				controllerId,
				extensionInstanceId: host.extensionInstanceId,
				count: all.length,
				operations: all.slice(0, clampOperationListLimit(a.limit)),
				deployLock: host.currentDeployLockOwnership() ?? null,
			};
		})
	);
}
