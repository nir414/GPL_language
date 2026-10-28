/**
 * `gpl.compileStale.pick` — "컴파일 검증 필요" 프로젝트가 여럿일 때 상태바 배지가 여는 선택 창(§1-GN).
 *
 * 현재 제어기의 미검증 목록(host.listCompileStale, 최근 표시 순)을 다중 선택 QuickPick 으로 보이고(전부 미리 체크),
 * 고른 순서대로 `gpl.quickCompile` 을 **하나씩 await** 로 돌린다 — 같은 제어기 작업은 deploy 큐로 직렬이고, 한 프로젝트가
 * 실패·취소되면 남은 것은 돌리지 않는다(Upload Only 묶음과 같은 규칙, §1-GM). 폴더를 아는 항목은 Uri 인자로 선택 창 없이
 * 그 프로젝트로, 모르는 항목은 인자 없이(종전 경로 — 단일 프로젝트면 즉시, 여럿이면 QuickPick).
 */

import * as vscode from 'vscode';
import type { CompileStaleInfo } from '../../controller/deployment/compileStale';
import type { DeployResult } from '../../controller/deployment/deployService';
import { COMPILE_STALE_BADGE_COMMAND, COMPILE_STALE_PICK_COMMAND, compileStaleLatestFirst } from '../../views/statusbar/compileStaleBadge';
import type { DeployContext } from './deployContext';

type PickItem = vscode.QuickPickItem & { info: CompileStaleInfo };

export function registerCompileStalePickCommand(ctx: DeployContext): void {
	const { host } = ctx;
	host.context.subscriptions.push(
		vscode.commands.registerCommand(COMPILE_STALE_PICK_COMMAND, async (): Promise<unknown> => {
			const items = compileStaleLatestFirst(host.listCompileStale());
			if (items.length === 0) {
				void vscode.window.showInformationMessage('컴파일 검증이 필요한 프로젝트가 없습니다.');
				return undefined;
			}
			const pickItems: PickItem[] = items.map(info => ({
				label: info.projectName,
				description: info.reason,
				detail: info.projectDir,
				picked: true,
				info,
			}));
			const picked = await vscode.window.showQuickPick(pickItems, {
				canPickMany: true,
				placeHolder: `Quick Compile 할 프로젝트 (컴파일 검증 필요 ${items.length}개 — 고른 순서대로 하나씩, 실패하면 중단)`,
				matchOnDescription: true,
				ignoreFocusOut: true,
			});
			if (!picked || picked.length === 0) { return undefined; }
			const results: (DeployResult | undefined)[] = [];
			for (const { info } of picked) {
				host.log(`[QuickCompile] 컴파일 검증 필요 선택 창 → ${info.projectName}${info.projectDir ? ` (${info.projectDir})` : ' (폴더 미상 — 선택 창)'}`);
				const result = await vscode.commands.executeCommand<DeployResult | undefined>(
					COMPILE_STALE_BADGE_COMMAND,
					...(info.projectDir ? [vscode.Uri.file(info.projectDir)] : []),
				);
				results.push(result);
				if (!result?.success) {
					if (picked.length > 1) {
						host.log(`[QuickCompile] ${info.projectName} 에서 중단 — 남은 ${picked.length - results.length}개는 돌리지 않았습니다`);
					}
					break;
				}
			}
			return results;
		}),
	);
}
