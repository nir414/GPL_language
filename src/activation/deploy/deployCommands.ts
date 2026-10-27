/**
 * 배포 변형 명령 4개 — `gpl.deploy`·`gpl.uploadOnly`·`gpl.uploadStart`·`gpl.quickCompile`. 넷은 `runDeploy` 의
 * 옵션만 다르고 진입 규칙이 같다: ① 대상 지정 객체({project|projectDir|projectFile}) → **비대화형**(UI 없음, 구조화 결과)
 * ② Uri(탐색기 우클릭) → 그 프로젝트로 확정 ③ 인자 없음(팔레트·트리) → 종전 대화형 QuickPick.
 * `deploy.ts` 에서 분할(2026-10-27). 등록 순서는 허브(`deploy.ts`)가 정한다.
 * 명령 id 는 상수로 두고 `registerCommand(상수, …)` 로 넘긴다 — 구조 테스트 R5 가 package.json 선언과 대조한다.
 */

import * as vscode from 'vscode';
import { isAutomationInvocation } from '../../controller/projects/projectTarget';
import type { AutomationTargetArgs } from './automationResult';
import { runDeployForAutomation } from './deployAutomation';
import type { DeployContext, QuickDeployOpts } from './deployContext';
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
	/** Start 를 보내는 변형 — 자동화 경로에 모션 확인 게이트를 건다(하드 규칙 6). */
	motionGate?: boolean;
}

function deployVariantHandler(ctx: DeployContext, v: DeployVariant): (resource?: unknown) => Promise<unknown> {
	return async (resource?: unknown) => {
		if (isAutomationInvocation(resource)) {
			return runDeployForAutomation(ctx, v.id, resource as AutomationTargetArgs, v.skipStart, { ...v.opts }, v.motionGate ? { motion: true } : {});
		}
		if (resource instanceof vscode.Uri) {
			const dir = await pickWorkspaceProjectDir(ctx, v.placeHolder, resource);
			if (!dir) { return undefined; }
			return runDeploy(ctx, v.skipStart, { ...v.opts, overrideProjectDir: dir });
		}
		return runDeploy(ctx, v.skipStart, { ...v.opts });
	};
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
export function registerUploadOnlyCommand(ctx: DeployContext): void {
	ctx.host.context.subscriptions.push(
		vscode.commands.registerCommand(UPLOAD_ONLY_COMMAND, deployVariantHandler(ctx, {
			id: UPLOAD_ONLY_COMMAND, placeHolder: '업로드할 프로젝트를 선택하세요', skipStart: true, opts: { uploadOnly: true },
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
// 자동화 경로는 Start 를 보내므로 모션 확인 없이 자동으로 실행하지 않는다(하드 규칙 6).
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
