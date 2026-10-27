/**
 * autoOnSave — .gpl 저장 시 자동 빠른 컴파일(설정 `gpl.quickCompile.autoOnSave`, 기본 "auto"). 600ms 디바운스 +
 * 동시실행 방지, 저장 파일만 업로드 후 Compile. 저장 경로에서는 절대 UI(QuickPick/모달)를 띄우지 않는다.
 * 디바운스 타이머·진행 중 플래그는 이 모듈만 쓰므로 여기 두고, pending 파일 집합은 다른 경로가 지우므로
 * `DeployContext.quickCompilePendingFiles` 에 있다. 설정 해석은 `autoOnSaveRules.ts`(순수). `deploy.ts` 에서 분할(2026-10-27).
 */

import * as vscode from 'vscode';
import { getControllerConfig } from '../../controller/connection/controllerConnection';
import { findProjectDirs } from '../../controller/deployment/deployService';
import { getControllerProjectWriteBlock } from '../../project/remote/controllerProjectWorkspace';
import { parseAutoOnSaveMode } from './autoOnSaveRules';
import type { AutoOnSaveMode } from './autoOnSaveRules';
import type { DeployContext } from './deployContext';
import { pickDeepestProjectDir } from './deployTargetRules';
import { runDeploy } from './runDeploy';

// .gpl 저장 시 자동 빠른 컴파일 (설정 gpl.quickCompile.autoOnSave, 기본 "auto"). 600ms 디바운스 + 동시실행 방지.
// 저장된 파일만 업로드 후 Compile하여, 매 저장마다 프로젝트 전체를 스캔/조회하는 비효율을 제거한다.
// "auto"(기본): 제어기가 완전 STOP(쓰레드 없음)이고 /GPL/<project>가 존재할 때만 조용히 실행(AUTO_GATE).
// "on"(구 true): 게이트 없이 항상 시도(활성 쓰레드 시 조용히 중단, /GPL 없으면 classic 폴백) / "off"(구 false): 사용 안 함.
function getAutoOnSaveMode(): AutoOnSaveMode {
	// 구버전 boolean 설정값 호환: true → "on", false → "off". 미설정 시 스키마 기본값 "auto".
	return parseAutoOnSaveMode(vscode.workspace.getConfiguration('gpl').get<unknown>('quickCompile.autoOnSave'));
}

/** 저장된 파일이 속한 프로젝트 폴더(.gpr 보유)를 찾는다. 여러 후보 중 가장 깊은(구체적인) 경로를 선택. */
async function resolveProjectDirForFile(fsPath: string): Promise<string | undefined> {
	const projectDirs = await findProjectDirs();
	return pickDeepestProjectDir(fsPath, projectDirs);
}

export function activateAutoOnSave(ctx: DeployContext): void {
	const { host, quickCompilePendingFiles } = ctx;
	const { context } = host;

	let quickCompileTimer: ReturnType<typeof setTimeout> | undefined;
	let quickCompileInFlight = false;
	// deactivate 시 디바운스 타이머 해제 (좀비 콜백 방지)
	context.subscriptions.push({ dispose: () => { if (quickCompileTimer) { clearTimeout(quickCompileTimer); quickCompileTimer = undefined; } } });

	/** autoOnSave 디바운스 타이머 (재)예약. */
	function scheduleQuickCompileFlush(delayMs: number): void {
		if (quickCompileTimer) { clearTimeout(quickCompileTimer); }
		quickCompileTimer = setTimeout(() => {
			quickCompileTimer = undefined;
			void flushQuickCompilePending();
		}, delayMs);
	}

	/**
	 * pending 저장 파일 처리. 저장 경로에서는 절대 UI(QuickPick/모달)를 띄우지 않는다.
	 * - 컴파일/배포가 진행 중이면 pending을 버리지 않고 재예약해 이후에 처리한다.
	 * - 프로젝트 폴더별로 그룹화해 첫 그룹만 이번에 처리하고, 다른 프로젝트 파일은
	 *   pending에 남겨 재예약한다 (업로드 필터에서 조용히 탈락하던 문제 방지).
	 * - 프로젝트(.gpr)를 못 찾는 파일은 로그만 남기고 조용히 건너뛴다.
	 */
	async function flushQuickCompilePending(): Promise<void> {
		if (quickCompilePendingFiles.size === 0) { return; }
		const mode = getAutoOnSaveMode();
		if (mode === 'off') {
			// 저장~flush 사이에 설정이 꺼졌으면 pending을 버린다.
			quickCompilePendingFiles.clear();
			return;
		}
		if (mode === 'auto' && vscode.debug.activeDebugSession?.type === 'brooks-gpl') {
			// 디버그 세션 중 자동 업로드 금지 — 정지 중 쓰레드와의 충돌 방지(프로브 왕복도 생략).
			quickCompilePendingFiles.clear();
			host.log('[QuickCompile] autoOnSave 건너뜀: brooks-gpl 디버그 세션 진행 중');
			return;
		}
		if (quickCompileInFlight || host.currentDeployLockHolder()) {
			// 다른 배포(이 창/다른 창/Save to Flash)가 진행 중 — pending을 버리지 않고 재예약.
			scheduleQuickCompileFlush(1000);
			return;
		}
		quickCompileInFlight = true;
		try {
			const groups = new Map<string, string[]>();
			for (const file of [...quickCompilePendingFiles]) {
				const dir = await resolveProjectDirForFile(file);
				if (!dir) {
					quickCompilePendingFiles.delete(file);
					host.log(`[QuickCompile] autoOnSave: 프로젝트(.gpr) 미해석 — 건너뜀: ${file}`);
					continue;
				}
				const list = groups.get(dir);
				if (list) { list.push(file); } else { groups.set(dir, [file]); }
			}

			const firstGroup = groups.entries().next();
			if (firstGroup.done) { return; }
			const [projectDir, changedFiles] = firstGroup.value;
			for (const file of changedFiles) { quickCompilePendingFiles.delete(file); }

			const r = await runDeploy(ctx, true, {
				skipStop: true,
				skipUnchanged: true,
				quick: true,
				changedFiles,
				overrideProjectDir: projectDir,
				// 저장마다 모달이 뜨면 방해되므로 autoOnSave는 활성 쓰레드 시 조용히 중단.
				noStopPrompt: true,
				// "auto" 모드: /GPL/<project>가 있으면 업로드, Compile은 쓰레드가 하나도 없을 때만(없으면 COMPILE_DEFERRED → 컴파일 필요 표시).
				autoGate: mode === 'auto',
			});
			if (r?.failedPhase === 'LOCKED') {
				// 다른 배포가 잠금을 잡고 있었다 — 저장분을 버리지 않고 pending에 되돌려 finally에서 재예약한다.
				for (const file of changedFiles) { quickCompilePendingFiles.add(file); }
			}
		} finally {
			quickCompileInFlight = false;
			if (quickCompilePendingFiles.size > 0) {
				// 남은 프로젝트 그룹/처리 중 새로 저장된 파일을 이어서 처리
				scheduleQuickCompileFlush(1000);
			}
		}
	}

	context.subscriptions.push(
		vscode.workspace.onDidSaveTextDocument((doc) => {
			if (doc.languageId !== 'gpl') { return; }
			if (getAutoOnSaveMode() === 'off') { return; }
			if (!host.isControllerConnected) { return; }
			const manifestBlock = getControllerProjectWriteBlock(doc.uri.fsPath, getControllerConfig().ip);
			if (manifestBlock) {
				host.log(`[QuickCompile] ${manifestBlock.message} 저장 파일: ${doc.uri.fsPath}`);
				return;
			}
			quickCompilePendingFiles.add(doc.uri.fsPath);
			scheduleQuickCompileFlush(600);
		})
	);
}
