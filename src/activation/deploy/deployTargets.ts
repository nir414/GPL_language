/**
 * 배포 대상과 그 전제 조건의 대화형 확인 — 워크스페이스 프로젝트 폴더 선택(QuickPick, 세션 대상 기억),
 * 미저장 문서 수집·저장 확인 모달, 실행 불가(ProjectStart 없는 그룹) 판정. 수동 배포(`runDeploy`)·Start·
 * Save to Flash·자동화 경로가 함께 쓴다. `deploy.ts` 에서 분할(2026-10-27).
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { notRunnableStartDetail } from '../../controller/commands/unloadRisk';
import { buildTargetCandidates, pickProjectDir, readGprTargetInfo } from '../../controller/projects/projectPicker';
import { gprPathInDir } from '../../project/sources/projectSources';
import type { DeployContext } from './deployContext';
import { isPathInsideDir } from './deployTargetRules';

/**
 * 워크스페이스에서 .gpr 프로젝트 폴더를 선택한다 (공용 규칙: controller/projects/projectPicker.ts).
 * resource(탐색기 우클릭한 폴더/.gpr/소스 파일)가 있으면 QuickPick 없이 그 프로젝트로 확정,
 * 없으면 1개는 즉시·여러 개는 QuickPick(최근 선택 우선). 명령 인자의 첫 값은 VS Code가
 * 메뉴에서 넘기는 Uri이고 팔레트/트리에서는 undefined 또는 비-Uri일 수 있어 Uri만 인정한다.
 */
export async function pickWorkspaceProjectDir(ctx: DeployContext, placeHolder: string, resource?: unknown): Promise<string | undefined> {
	const dir = await pickProjectDir({ placeHolder, resource: resource instanceof vscode.Uri ? resource : undefined });
	// 사람이 고른 대상을 세션 대상으로도 기억한다 — 뒤이은 자동화 호출이 같은 프로젝트를 다시 묻지 않게(개선안 §19·§26).
	if (dir) { ctx.host.sessionTargetDir = dir; }
	return dir;
}

/** projectDir 하위의 저장되지 않은 편집기 문서 — 대화형/자동화 경로 공용. */
export function dirtyDocsUnder(projectDir: string): vscode.TextDocument[] {
	return vscode.workspace.textDocuments.filter(doc => {
		if (doc.uri.scheme !== 'file' || !doc.isDirty) { return false; }
		return isPathInsideDir(projectDir, doc.uri.fsPath);
	});
}

/**
 * projectDir 하위의 저장되지 않은(dirty) 파일이 있으면 저장 여부를 모달로 확인하고 저장한다.
 * 업로드는 디스크 내용을 올리므로, 미저장 편집분이 있으면 이전 내용이 올라가 혼동을 유발한다
 * (Start 확인 모달과 같은 패턴 — '저장 후 계속' + 취소).
 * 반환: ok=false면 사용자가 취소했거나 저장 실패 — 호출측은 업로드를 시작하지 말 것.
 * ※ autoOnSave 같은 저장-트리거 경로에서는 호출 금지(저장 경로에서는 UI를 띄우지 않는다).
 */
export async function confirmSaveDirtyProjectDocs(projectDir: string): Promise<{ ok: boolean; savedFiles: string[] }> {
	const dirtyDocs = dirtyDocsUnder(projectDir);
	if (dirtyDocs.length === 0) { return { ok: true, savedFiles: [] }; }

	const names = dirtyDocs.map(d => path.basename(d.uri.fsPath)).join('\n');
	const pick = await vscode.window.showWarningMessage(
		`저장되지 않은 파일 ${dirtyDocs.length}개가 있습니다. 저장 후 업로드할까요?`,
		{ modal: true, detail: `저장하지 않으면 디스크의 이전 내용이 업로드됩니다.\n\n${names}` },
		'저장 후 계속'
	);
	if (pick !== '저장 후 계속') { return { ok: false, savedFiles: [] }; }

	const savedFiles: string[] = [];
	for (const doc of dirtyDocs) {
		if (await doc.save()) {
			savedFiles.push(doc.uri.fsPath);
		} else {
			vscode.window.showErrorMessage(`파일 저장 실패: ${path.basename(doc.uri.fsPath)} — 업로드를 중단합니다.`);
			return { ok: false, savedFiles };
		}
	}
	return { ok: true, savedFiles };
}

/**
 * `.gpr` 가 있는데 ProjectStart 가 없으면(그룹·라이브러리) Start 거부 사유를, 아니면 undefined.
 * `.gpr` 를 못 찾은 폴더는 판단하지 않는다(종전 동작 — 제어기가 STATUS 로 판정).
 */
export async function describeNotRunnable(projectDir: string): Promise<string | undefined> {
	if (!gprPathInDir(projectDir)) { return undefined; }
	const info = readGprTargetInfo(projectDir);
	if (info.runnable) { return undefined; }
	const runnable = (await buildTargetCandidates()).filter(c => c.runnable).map(c => c.projectName);
	return notRunnableStartDetail(info.projectName, runnable);
}
