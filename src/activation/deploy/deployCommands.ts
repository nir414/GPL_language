/**
 * 배포 변형 명령 4개 — `gpl.deploy`·`gpl.uploadOnly`·`gpl.uploadStart`·`gpl.quickCompile`. 넷은 `runDeploy` 의
 * 옵션만 다르고 진입 규칙이 같다: ① 대상 지정 객체({project|projectDir|projectFile}) → **비대화형**(UI 없음, 구조화 결과)
 * ② Uri(탐색기 우클릭) → 그 프로젝트로 확정 ③ 인자 없음(팔레트·트리) → 종전 대화형 QuickPick.
 * Upload Only 만 여러 프로젝트를 받는다(탐색기 다중 선택·다중 선택 QuickPick → 고른 순서대로 차례로, `runMultiProject`).
 * `deploy.ts` 에서 분할(2026-10-27). 등록 순서는 허브(`deploy.ts`)가 정한다.
 * 명령 id 는 상수로 두고 `registerCommand(상수, …)` 로 넘긴다 — 구조 테스트 R5 가 package.json 선언과 대조한다.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import type { DeployResult } from '../../controller/deployment/deployService';
import { pickProjectDirs } from '../../controller/projects/projectPicker';
import { isAutomationInvocation } from '../../controller/projects/projectTarget';
import type { AutomationTargetArgs } from './automationResult';
import { runDeployForAutomation } from './deployAutomation';
import type { DeployContext, QuickDeployOpts } from './deployContext';
import { UploadBatchOutcome, uploadBatchSummary } from './deployModes';
import { pickWorkspaceProjectDir } from './deployTargets';
import { runDeploy } from './runDeploy';

const DEPLOY_COMMAND = 'gpl.deploy';
const UPLOAD_ONLY_COMMAND = 'gpl.uploadOnly';
const UPLOAD_START_COMMAND = 'gpl.uploadStart';
const QUICK_COMPILE_COMMAND = 'gpl.quickCompile';

interface DeployVariant {
	/** 명령 id — 자동화 로그 라벨·idempotencyKey 접두사로도 쓰인다. */
	id: string;
	/** 탐색기 우클릭(Uri) 경로의 QuickPick placeholder. */
	placeHolder: string;
	skipStart: boolean;
	opts: Omit<QuickDeployOpts, 'overrideProjectDir' | 'nonInteractive'>;
	/** Start 를 보내는 변형 — 자동화 경로에 모션 확인 게이트를 건다(하드 규칙 9). */
	motionGate?: boolean;
	/**
	 * 여러 프로젝트를 차례로 처리할 수 있는 변형(Upload Only) — 탐색기 다중 선택과 다중 선택 QuickPick 을 받는다.
	 * Stop/Compile 을 보내는 변형은 프로젝트마다 제어기 상태를 바꾸므로 한 번에 하나만 받는다.
	 */
	multiProject?: boolean;
	/** 다중 선택 QuickPick 의 placeholder(multiProject 일 때). */
	multiPlaceHolder?: string;
}

function deployVariantHandler(ctx: DeployContext, v: DeployVariant): (resource?: unknown, selected?: unknown) => Promise<unknown> {
	return async (resource?: unknown, selected?: unknown) => {
		if (isAutomationInvocation(resource)) {
			return runDeployForAutomation(ctx, v.id, resource as AutomationTargetArgs, v.skipStart, { ...v.opts }, v.motionGate ? { motion: true } : {});
		}
		if (v.multiProject) {
			// 탐색기 메뉴는 (우클릭한 Uri, 선택된 Uri[]) 를 넘긴다 — 둘 이상 선택했을 때만 묶음, 하나면 종전 단일 경로.
			const uris = Array.isArray(selected) ? selected.filter((u): u is vscode.Uri => u instanceof vscode.Uri) : [];
			if (uris.length > 1) { return runMultiProject(ctx, v, uris); }
			if (!(resource instanceof vscode.Uri)) { return runMultiProject(ctx, v, undefined); }
		}
		if (resource instanceof vscode.Uri) {
			const dir = await pickWorkspaceProjectDir(ctx, v.placeHolder, resource);
			if (!dir) { return undefined; }
			return runDeploy(ctx, v.skipStart, { ...v.opts, overrideProjectDir: dir });
		}
		return runDeploy(ctx, v.skipStart, { ...v.opts });
	};
}

/**
 * 여러 프로젝트를 고른 순서대로 하나씩 `runDeploy` 한다 — 같은 제어기 작업은 어차피 직렬이고(deploy 큐),
 * 끝난 뒤 한 번 요약한다. 한 프로젝트가 실패·취소되면 그 뒤는 올리지 않는다(같은 원인이 반복될 가능성이 크다).
 * 프로젝트가 하나로 정해지면 단일 경로와 같다(세션 대상 기억 포함).
 */
async function runMultiProject(ctx: DeployContext, v: DeployVariant, resources: vscode.Uri[] | undefined): Promise<unknown> {
	const picked = await pickProjectDirs({ placeHolder: v.multiPlaceHolder ?? v.placeHolder, resources });
	if (picked.kind !== 'picked') { return undefined; }
	const dirs = picked.dirs;
	if (picked.unresolved.length > 0) {
		const go = `${dirs.length}개만 업로드`;
		const answer = await vscode.window.showWarningMessage(
			`선택한 항목 중 ${picked.unresolved.length}개는 GPL 프로젝트(.gpr) 폴더가 아닙니다.`,
			{ modal: true, detail: `${picked.unresolved.map(p => path.basename(p)).join('\n')}\n\n나머지 프로젝트: ${dirs.map(d => path.basename(d)).join(', ')}` },
			go,
		);
		if (answer !== go) { return undefined; }
	}
	if (dirs.length === 1) {
		ctx.host.sessionTargetDir = dirs[0];
		return runDeploy(ctx, v.skipStart, { ...v.opts, overrideProjectDir: dirs[0] });
	}

	ctx.host.log(`[Deploy] ${v.id} 묶음 ${dirs.length}개: ${dirs.join(' → ')}`);
	const entries: { name: string; outcome: UploadBatchOutcome }[] = dirs.map(d => ({ name: path.basename(d), outcome: 'notRun' }));
	const results: (DeployResult | undefined)[] = [];
	for (let i = 0; i < dirs.length; i++) {
		ctx.host.log(`[Deploy] (${i + 1}/${dirs.length}) ${dirs[i]}`);
		const result = await runDeploy(ctx, v.skipStart, { ...v.opts, overrideProjectDir: dirs[i], inBatch: true });
		results.push(result);
		if (result?.projectName) { entries[i].name = result.projectName; }
		entries[i].outcome = result?.success ? 'uploaded' : result && !result.cancelled ? 'failed' : 'cancelled';
		if (!result?.success) { break; }
	}
	const summary = uploadBatchSummary(entries);
	ctx.host.log(`[Deploy] ${summary.success ? '✔' : '✖'} ${summary.message}`);
	if (summary.success) {
		void vscode.window.showInformationMessage(summary.message);
	} else {
		void vscode.window.showWarningMessage(summary.message);
	}
	return results;
}

// gpl.deploy — Stop + /GPL 직접 업로드 + Compile (Start 안 함, 디버그 친화)
export function registerDeployCommand(ctx: DeployContext): void {
	ctx.host.context.subscriptions.push(
		vscode.commands.registerCommand(DEPLOY_COMMAND, deployVariantHandler(ctx, {
			id: DEPLOY_COMMAND, placeHolder: '배포할 프로젝트를 선택하세요', skipStart: true, opts: {},
		}))
	);
}

// gpl.uploadOnly — /GPL 소스 업로드만. 실행 중 프로그램을 멈추거나 Compile/Start하지 않는다.
// 같은 제어기의 다른 업로드/배포가 진행 중이면 공통 큐에서 순서를 기다린다.
// 탐색기에서 프로젝트 폴더를 여러 개 고르거나 팔레트 QuickPick 에서 여러 개 체크하면 차례로 올린다(runMultiProject).
export function registerUploadOnlyCommand(ctx: DeployContext): void {
	ctx.host.context.subscriptions.push(
		vscode.commands.registerCommand(UPLOAD_ONLY_COMMAND, deployVariantHandler(ctx, {
			id: UPLOAD_ONLY_COMMAND, placeHolder: '업로드할 프로젝트를 선택하세요', skipStart: true, opts: { uploadOnly: true },
				multiProject: true, multiPlaceHolder: '업로드할 프로젝트를 선택하세요 (Space로 여러 개 선택, Enter로 시작)',
		}))
	);
}

// gpl.uploadStart — Stop + /GPL 직접 업로드 + Start. Compile은 보내지 않는다.
// 확장의 Start 는 `-compile` 로 컴파일까지 수행하므로(ai-handoff §0.7)
// 확장이 Compile을 먼저 보내면 같은 컴파일이 두 번 돈다. Start 컴파일 에러도 §1-EW부터 Problems에 연동한다.
// '빠른 컴파일'(gpl.quickCompile)은 Start 없이 먼저 검증하고 싶을 때 쓴다.
// Start 확인 모달·배포 잠금·프로젝트명 가드는 모두 기존 배포 경로와 동일하게 적용된다.
// 업로드는 정지 게이트와 **병행**한다(UPLOAD ∥ STOP) — 속도가 목적이고, 2026-09-10 실기기
// 재현 시도에서 "Stop 처리 중 FTP 덮어쓰기"가 제어기 이상을 유발하지 않음이 확인됐다(§1-DL).
// 자동화 경로는 Start 를 보내므로 모션 확인 없이 자동으로 실행하지 않는다(하드 규칙 9).
export function registerUploadStartCommand(ctx: DeployContext): void {
	ctx.host.context.subscriptions.push(
		vscode.commands.registerCommand(UPLOAD_START_COMMAND, deployVariantHandler(ctx, {
			id: UPLOAD_START_COMMAND, placeHolder: '업로드 후 시작할 프로젝트를 선택하세요', skipStart: false, opts: { skipCompile: true }, motionGate: true,
		}))
	);
}

// gpl.quickCompile — 변경분만 업로드 + Compile (STOP/START 생략), 빠른 에러 확인
export function registerQuickCompileCommand(ctx: DeployContext): void {
	ctx.host.context.subscriptions.push(
		vscode.commands.registerCommand(QUICK_COMPILE_COMMAND, deployVariantHandler(ctx, {
			id: QUICK_COMPILE_COMMAND, placeHolder: '빠른 컴파일할 프로젝트를 선택하세요', skipStart: true, opts: { skipStop: true, skipUnchanged: true, quick: true },
		}))
	);
}
