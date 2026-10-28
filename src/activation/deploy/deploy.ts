/**
 * 배포 계열 명령 — Deploy(Build Only)·업로드 스타트·Start·Save to Flash·Quick Compile·autoOnSave,
 * 그리고 자동화(비대화형) 경로의 대상 해석·게이트(개선안 §15~§27, controller/projects/projectTarget.ts).
 *
 * 이 파일은 **등록 허브**다(2026-10-27 분할 — 종전에는 한 함수 1,488줄). 명령·절차는 형제 모듈에 있고,
 * 여기서는 공유 컨텍스트(`deployContext.ts`)를 만들어 종전 순서대로 등록한 뒤 `DeployApi` 를 돌려준다:
 *
 * - `runDeploy.ts` — 배포 진입점(대상 확정 → 전제 확인 → deploy() → 보고)
 * - `deployReport.ts`·`errorLogNotice.ts` — 결과 보고(중단/성공/실패)·ErrorLog 알림 선별
 * - `deployTargets.ts`·`deployTargetRules.ts` — 프로젝트 선택·미저장 확인·실행 불가 판정(+순수 경로 규칙)
 * - `deployAutomation.ts`·`automationResult.ts` — 자동화 대상 해석·게이트·구조화 결과
 * - `automationCommands.ts`·`deployCommands.ts`·`startProjectCommand.ts`·`saveToFlashCommand.ts` — 명령 등록
 * - `autoOnSave.ts`·`autoOnSaveRules.ts` — 저장 시 자동 빠른 컴파일
 * - `deployModes.ts` — 모드 라벨·대화형 여부·요약 문구(순수)
 *
 * `runDeploy`/`confirmStartWhenCompileStale`/`pickWorkspaceProjectDir` 는 다른 명령 그룹(연결·트리)도
 * 쓰므로 `host.deploy` 로 노출한다.
 */

import { onDidUploadProgress } from '../../controller/deployment/deployService';
import type { DeployResult } from '../../controller/deployment/deployService';
import type { ExtensionHost } from '../host';
import { registerAutomationCommands } from './automationCommands';
import { activateAutoOnSave } from './autoOnSave';
import { registerCompileStalePickCommand } from './compileStaleCommands';
import { registerDeployCommand, registerQuickCompileCommand, registerUploadOnlyCommand, registerUploadStartCommand } from './deployCommands';
import { createDeployContext } from './deployContext';
import type { QuickDeployOpts } from './deployContext';
import { pickWorkspaceProjectDir } from './deployTargets';
import { runDeploy } from './runDeploy';
import { registerSaveToFlashCommand } from './saveToFlashCommand';
import { confirmStartWhenCompileStale, registerStartCommand } from './startProjectCommand';

export type { QuickDeployOpts } from './deployContext';

export interface DeployApi {
	runDeploy(skipStart: boolean, quickOpts?: QuickDeployOpts): Promise<DeployResult | undefined>;
	confirmStartWhenCompileStale(projectName: string, projectDir?: string): Promise<boolean>;
	pickWorkspaceProjectDir(placeHolder: string, resource?: unknown): Promise<string | undefined>;
}

export function activateDeployCommands(host: ExtensionHost): DeployApi {
	const ctx = createDeployContext(host);
	const { context } = host;

	// 업로드 진행 바(상태바) — 배포가 어느 경로(명령·F5·autoOnSave·MCP)로 시작됐든 deployService 가 같은 이벤트를 내므로
	// 여기서 한 번만 구독한다. 출력 패널의 파일별 로그는 그대로(이력), 움직이는 바는 상태바(§1-EE).
	context.subscriptions.push(onDidUploadProgress(e => {
		if (e.kind === 'progress') {
			host.statusBar?.setUploadProgress(e.progress, e.projectName);
		} else {
			host.statusBar?.endUpload(e.ok ? { ok: true, summary: e.summary } : { ok: false, message: e.message });
		}
	}));

	// 등록 순서는 분할 전과 같다(구독 해제 순서 보존).
	registerAutomationCommands(ctx);
	registerDeployCommand(ctx);
	registerUploadOnlyCommand(ctx);
	registerUploadStartCommand(ctx);
	registerStartCommand(ctx);
	registerSaveToFlashCommand(ctx);
	registerQuickCompileCommand(ctx);
	registerCompileStalePickCommand(ctx);
	activateAutoOnSave(ctx);

	return {
		runDeploy: (skipStart, quickOpts) => runDeploy(ctx, skipStart, quickOpts),
		confirmStartWhenCompileStale: (projectName, projectDir) => confirmStartWhenCompileStale(ctx, projectName, projectDir),
		pickWorkspaceProjectDir: (placeHolder, resource) => pickWorkspaceProjectDir(ctx, placeHolder, resource),
	};
}
