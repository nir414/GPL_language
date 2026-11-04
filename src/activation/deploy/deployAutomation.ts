/**
 * 자동화(비대화형) 경로 — 개선안 §15~§27 (규칙: controller/projects/projectTarget.ts). `deploy.ts` 에서 분할(2026-10-27).
 *
 * 사람용 명령(팔레트·탐색기 우클릭·트리)은 종전대로 QuickPick/모달을 쓰고, **인자로 대상을 받은 호출**
 * (MCP 브리지·URI·다른 확장)은 UI 를 절대 띄우지 않고 구조화된 결과를 돌려준다. 두 경로를 섞지 않는다.
 * active editor 는 자동화 대상 결정에 쓰지 않는다 — 어느 탭을 열어 뒀는지는 사람의 UI 상태다(§22).
 *
 * 세션 한정 대상 폴더는 `host.sessionTargetDir`(단일 출처) — 명시 지정·사람의 QuickPick 선택·디버그 세션의
 * projectDir 로 갱신되고, 동명 소스 해석(project/sources/compileUnitTarget.ts)도 같은 값을 1순위 기준으로 쓴다.
 *
 * 대상 해석 → 미저장 처리 → 모션/컴파일 검증 게이트 → `runDeploy` 의 순서이며, 실패는 예외가 아니라
 * `AutomationFailure`(automationResult.ts) 로 돌려준다.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { getControllerConfig } from '../../controller/connection/controllerConnection';
import { describeCompileStale } from '../../controller/deployment/compileStale';
import type { DeployResult } from '../../controller/deployment/deployService';
import { PROJECT_NOT_RUNNABLE, notRunnableStartDetail } from '../../controller/commands/unloadRisk';
import { buildTargetCandidates } from '../../controller/projects/projectPicker';
import {
	describeCandidates,
	describeResolution,
	resolveProjectTarget,
	sessionTargetAfterImplicitUse,
	summarizeCandidates,
} from '../../controller/projects/projectTarget';
import type { ProjectTargetRequest, SessionTargetUpdate } from '../../controller/projects/projectTarget';
import { normalizeDirKey } from '../../util/pathKey';
import { automationFailure, isAutomationFailure } from './automationResult';
import type { AutomationFailure, AutomationTargetArgs } from './automationResult';
import type { DeployContext, QuickDeployOpts } from './deployContext';
import { dirtyDocsUnder } from './deployTargets';
import { runDeploy } from './runDeploy';

/**
 * 자동화 대상 해석. **UI 를 띄우지 않고 active editor 를 보지 않는다.** 성공하면 세션 대상을 갱신한다.
 * 실패는 예외가 아니라 구조화된 결과 — 호출자(AI)가 그대로 읽고 다음에 무엇을 지정할지 알 수 있게.
 */
export async function resolveAutomationTarget(
	ctx: DeployContext,
	request: ProjectTargetRequest | undefined,
	label: string,
	opts: { pin?: boolean; requireRunnable?: boolean } = {},
): Promise<{ ok: true; dir: string; projectName: string; runnable: boolean; sessionTargetUpdate: SessionTargetUpdate } | AutomationFailure> {
	const { host } = ctx;
	const candidates = await buildTargetCandidates();
	const r = resolveProjectTarget(request, candidates, {
		sessionTargetDir: host.sessionTargetDir,
	});
	if (!r.ok) {
		host.log(`[Automation] ${label}: ${describeResolution(r)} · 후보: ${describeCandidates(r.candidates)}`);
		return automationFailure(r.error, r.detail, { candidateCount: r.candidates.length });
	}
	const runnable = candidates.find(c => normalizeDirKey(c.dir) === normalizeDirKey(r.dir))?.runnable ?? false;
	// Start 경로는 실행 불가 그룹을 정지·업로드·컴파일 전에 거부한다(그대로 가면 그룹 Compile 뒤 -744).
	if (opts.requireRunnable && !runnable) {
		const runnables = candidates.filter(c => c.runnable);
		host.log(`[Automation] ${label}: ${r.projectName} 는 ProjectStart 없는 그룹 — ${PROJECT_NOT_RUNNABLE} (보내지 않음)`);
		return automationFailure(PROJECT_NOT_RUNNABLE, notRunnableStartDetail(r.projectName, runnables.map(c => c.projectName)), {
			candidates: summarizeCandidates(runnables),
		});
	}
	// 명시 고정(gpl.automation.target)만 세션 대상을 마음대로 바꾼다. 배포·실행 호출의 부수 효과는
	// sessionTargetAfterImplicitUse 규칙(실행 불가 대상은 세션 대상이 되지 않고, 이미 있는 대상은 바꾸지 않는다)을 따른다.
	const sessionTargetUpdate: SessionTargetUpdate = opts.pin
		? { nextDir: r.dir, changed: !host.sessionTargetDir || normalizeDirKey(host.sessionTargetDir) !== normalizeDirKey(r.dir), reason: 'adopted' }
		: sessionTargetAfterImplicitUse(host.sessionTargetDir, { dir: r.dir, runnable });
	host.sessionTargetDir = sessionTargetUpdate.nextDir;
	host.log(`[Automation] ${label}: 대상 ${describeResolution(r)} · 세션 대상 ${sessionTargetUpdate.reason}`);
	return { ok: true, dir: r.dir, projectName: r.projectName, runnable, sessionTargetUpdate };
}

/**
 * 자동화 경로의 미저장 파일 처리. 기본은 오류로 알린다 — 업로드는 디스크 내용을 올리므로 사람의 미저장
 * 편집분이 있으면 이전 내용이 올라간다. `saveDirty: true`로 호출자가 저장을 승인하면 저장하고 계속한다.
 */
export async function handleDirtyForAutomation(ctx: DeployContext, projectDir: string, args: AutomationTargetArgs, label: string): Promise<AutomationFailure | undefined> {
	const { host, quickCompilePendingFiles } = ctx;
	const dirty = dirtyDocsUnder(projectDir);
	if (dirty.length === 0) { return undefined; }
	const files = dirty.map(d => d.uri.fsPath);
	if (!args.saveDirty) {
		host.log(`[Automation] ${label}: 미저장 파일 ${files.length}개 — 업로드하지 않음 (saveDirty:true 로 저장 승인 가능)`);
		return automationFailure(
			'UNSAVED_FILES',
			`대상 프로젝트에 저장되지 않은 편집기 문서가 ${files.length}개 있습니다. 업로드는 디스크 내용을 올리므로 이전 내용이 올라갑니다. `
				+ '사용자에게 저장을 요청하거나, 저장해도 된다면 `saveDirty: true` 로 다시 호출하세요.',
			{ files },
		);
	}
	for (const doc of dirty) {
		if (!(await doc.save())) {
			return automationFailure('UNSAVED_FILES', `파일 저장 실패: ${path.basename(doc.uri.fsPath)} — 업로드를 중단했습니다.`, { files });
		}
		quickCompilePendingFiles.delete(doc.uri.fsPath);
	}
	host.log(`[Automation] ${label}: 미저장 파일 ${files.length}개 저장 후 계속 (saveDirty)`);
	return undefined;
}

/**
 * Start 를 보내는 자동화 경로의 모션 확인 게이트(하드 규칙 9). **모달을 띄우지 않는다** — 비대화형 호출에서
 * 모달을 열면 호출자가 응답 없이 멈추고 사용자가 대신 눌러야 한다(개선안 §17·§25).
 *
 * 통과 조건은 둘 중 하나다: ① 사용자가 확인 모달을 스스로 껐다
 * (`gpl.controller.requireStartConfirmation: false`) ② 호출자가 `confirmStart: true` 로 **사용자 확인을
 * 이미 받았음을 단언**한다. 그 밖에는 INTERACTIVE_UI_REQUIRED 를 돌려주고, 대안(1402 `Start` 직접 전송)을 알린다.
 * 접근을 막는 것이 아니라 "무엇을 하면 통과되는지"를 응답에 싣는 방식이다.
 */
export function startMotionGate(ctx: DeployContext, label: string, args: AutomationTargetArgs): AutomationFailure | undefined {
	const { host } = ctx;
	const required = vscode.workspace.getConfiguration('gpl').get<boolean>('controller.requireStartConfirmation', true);
	if (required === false) { return undefined; }
	if (args.confirmStart === true) {
		host.log(`[Automation] ${label}: confirmStart:true — 호출자가 사용자 모션 확인을 단언함(확인 모달 생략)`);
		return undefined;
	}
	host.log(`[Automation] ${label}: 모션 확인 미충족 — INTERACTIVE_UI_REQUIRED (모달을 띄우지 않음)`);
	return automationFailure(
		'INTERACTIVE_UI_REQUIRED',
		'이 명령은 로봇을 움직일 수 있는 Start 를 보내므로 사용자 확인이 필요합니다(설정 '
			+ '`gpl.controller.requireStartConfirmation`, 기본 켜짐). 비대화형 호출에서는 확인 모달을 띄우지 않습니다 — '
			+ '사용자에게 실행 여부를 물어 확인을 받은 뒤 `confirmStart: true` 로 다시 호출하거나, 사용자가 VS Code 에서 '
			+ '직접 실행하게 하세요. 이미 올라간 프로젝트를 그냥 돌리는 것이면 명령 콘솔 `Start <project>`(MCP `start_project`)를 '
			+ '쓰는 편이 낫습니다 — 확장 UI 경로를 거치지 않습니다.',
	);
}

/**
 * "컴파일 검증 필요"(업로드했지만 Compile 로 검증되지 않음) 상태의 자동화 게이트. Start 는 제어기가 자체
 * 컴파일하므로 소스 에러가 있으면 Start 가 실패해 실행되지 않는다(§0.7). 자동화는 확인 모달을 띄울 수 없으므로 오류로 알린다.
 */
export function compileStaleGate(ctx: DeployContext, label: string, projectName: string, args: AutomationTargetArgs): AutomationFailure | undefined {
	const { host } = ctx;
	const stale = host.findCompileStale(projectName);
	if (!stale || args.ignoreCompileStale === true) { return undefined; }
	host.log(`[Automation] ${label}: 컴파일 미검증 — COMPILE_UNVERIFIED (${stale.reason})`);
	return automationFailure(
		'COMPILE_UNVERIFIED',
		`${describeCompileStale(stale)} `
			+ '먼저 `gpl.quickCompile` 로 에러를 확인하거나, 그대로 진행하려면 `ignoreCompileStale: true` 로 다시 호출하세요.',
	);
}

/** 배포 계열 자동화 진입 공통: 대상 해석 → 미저장 처리 → runDeploy. */
export async function runDeployForAutomation(
	ctx: DeployContext,
	label: string,
	args: AutomationTargetArgs,
	skipStart: boolean,
	opts: Omit<QuickDeployOpts, 'overrideProjectDir' | 'nonInteractive'>,
	gates: { motion?: boolean } = {},
): Promise<DeployResult | AutomationFailure | undefined> {
	// Start 를 보내는 모드는 실행 가능 여부를 모션 확인보다 먼저 본다 — 확인을 받아 와도 어차피 -744 로 끝날 요청이다.
	const target = await resolveAutomationTarget(ctx, args, label, { requireRunnable: !skipStart && !opts.uploadOnly });
	if (isAutomationFailure(target)) { return target; }
	if (gates.motion) {
		const gate = startMotionGate(ctx, label, args);
		if (gate) { return gate; }
	}
	const dirty = await handleDirtyForAutomation(ctx, target.dir, args, label);
	if (dirty) { return dirty; }
	const result = await runDeploy(ctx, skipStart, {
		...opts,
		overrideProjectDir: target.dir,
		nonInteractive: true,
		startConfirmed: args.confirmStart === true,
		// 호출자가 키를 주지 않으면 (명령 + 대상 폴더)로 만든다 — 같은 대상에 같은 종류의 배포가
		// 겹쳐 들어오는 것이 막으려는 상황이므로, 키가 없다고 중복 방지가 꺼지면 안 된다(§10).
		idempotencyKey: args.idempotencyKey ?? `${label}:${normalizeDirKey(target.dir)}`,
	});
	// 제어기 정체 확인 실패는 구조화 거부로 — 모달을 띄우지 않고(브리지 정지 방지) sent:false 와 이유를 싣는다.
	if (result && !result.success && result.failedPhase === 'CONTROLLER_CHECK') {
		const reasons = result.controllerCheck?.reasons ?? [];
		return automationFailure(
			'CONTROLLER_UNVERIFIED',
			`${getControllerConfig().ip} 이 PA 제어기인지 확인하지 못해 업로드하지 않았습니다: ${reasons.join(' ') || (result.failedStatusMessage ?? '')}`,
			{
				sent: false,
				reasons,
				...(result.controllerCheck ? { controllerCheck: result.controllerCheck } : {}),
				...(result.operationId ? { operationId: result.operationId } : {}),
			},
		);
	}
	// 세션 대상이 이 호출로 바뀌었는지(또는 왜 그대로인지)를 결과에 싣는다 — 호출자가 추론하지 않게.
	return result ? Object.assign(result, { sessionTargetUpdate: target.sessionTargetUpdate }) : result;
}
