/**
 * `gpl.compileStale.pick` — "컴파일 검증 필요" 프로젝트가 여럿일 때 상태바 배지가 여는 선택 창(§1-GN).
 *
 * 현재 제어기의 미검증 목록(host.listCompileStale, 최근 표시 순)을 다중 선택 QuickPick 으로 보이고(실행 프로젝트는 미리 체크),
 * 고른 순서대로 `gpl.quickCompile` 을 **하나씩 await** 로 돌린다 — 같은 제어기 작업은 deploy 큐로 직렬이고, 한 프로젝트가
 * 실패·취소되면 남은 것은 돌리지 않는다(Upload Only 묶음과 같은 규칙, §1-GM). 폴더를 아는 항목은 Uri 인자로 선택 창 없이
 * 그 프로젝트로, 모르는 항목은 인자 없이(종전 경로 — 단일 프로젝트면 즉시, 여럿이면 QuickPick).
 *
 * 2026-11-03(inbox ②④): ProjectStart 없는 라이브러리는 체크하지 않고, 골라도 단독 Compile 하지 않는다(그룹 Compile 뒤 Unload 위험) —
 * 그것을 쓰는 실행 프로젝트의 Compile 이 함께 해제한다. 항목마다 「목록에서 지우기」 버튼이 있다(한 번 돌리고 끝난 프로브 등).
 */

import * as vscode from 'vscode';
import type { CompileStaleInfo } from '../../controller/deployment/compileStale';
import type { DeployResult } from '../../controller/deployment/deployService';
import { COMPILE_STALE_BADGE_COMMAND, COMPILE_STALE_PICK_COMMAND, compileStaleLatestFirst } from '../../views/statusbar/compileStaleBadge';
import type { DeployContext } from './deployContext';

type PickItem = vscode.QuickPickItem & { info: CompileStaleInfo };

const DISMISS_BUTTON: vscode.QuickInputButton = {
	iconPath: new vscode.ThemeIcon('close'),
	tooltip: '목록에서 지우기 (Compile 하지 않고 이 항목만 해제)',
};

export function registerCompileStalePickCommand(ctx: DeployContext): void {
	const { host } = ctx;
	host.context.subscriptions.push(
		vscode.commands.registerCommand(COMPILE_STALE_PICK_COMMAND, async (): Promise<unknown> => {
			const toItem = (info: CompileStaleInfo): PickItem => ({
				label: info.library ? `$(library) ${info.projectName}` : info.projectName,
				description: info.library ? `라이브러리 — 쓰는 실행 프로젝트의 Compile 로 해제 · ${info.reason}` : info.reason,
				detail: info.projectDir,
				picked: !info.library,
				buttons: [DISMISS_BUTTON],
				info,
			});
			if (host.listCompileStale().length === 0) {
				void vscode.window.showInformationMessage('컴파일 검증이 필요한 프로젝트가 없습니다.');
				return undefined;
			}
			const picked = await new Promise<readonly PickItem[] | undefined>(resolve => {
				const qp = vscode.window.createQuickPick<PickItem>();
				const refresh = (keepSelection = false): boolean => {
					// 지우기 뒤 다시 그릴 때는 사용자가 바꿔 둔 체크를 잇는다.
					const kept = new Set(qp.selectedItems.map(i => i.info.projectName.toLowerCase()));
					const items = compileStaleLatestFirst(host.listCompileStale()).map(toItem);
					qp.items = items;
					qp.selectedItems = items.filter(i => keepSelection ? kept.has(i.info.projectName.toLowerCase()) : i.picked);
					qp.placeholder = `Quick Compile 할 프로젝트 (컴파일 검증 필요 ${items.length}개 — 고른 순서대로 하나씩, 실패하면 중단 · × 는 목록에서 지우기)`;
					return items.length > 0;
				};
				qp.canSelectMany = true;
				qp.matchOnDescription = true;
				qp.ignoreFocusOut = true;
				refresh();
				let done = false;
				const finish = (value: readonly PickItem[] | undefined): void => {
					if (done) { return; }
					done = true;
					resolve(value);
					qp.dispose();
				};
				qp.onDidTriggerItemButton(e => {
					host.releaseCompileStale([e.item.info.projectName], '사용자가 목록에서 지움', e.item.info.ip);
					if (!refresh(true)) { finish(undefined); }
				});
				qp.onDidAccept(() => finish(qp.selectedItems));
				qp.onDidHide(() => finish(undefined));
				qp.show();
			});
			if (!picked || picked.length === 0) { return undefined; }
			const libraries = picked.filter(p => p.info.library).map(p => p.info.projectName);
			if (libraries.length > 0) {
				host.log(`[QuickCompile] 라이브러리 ${libraries.join(', ')} 은(는) 단독 Compile 하지 않습니다 — 이를 ProjectLibrary 로 쓰는 실행 프로젝트를 Compile/Start 하면 함께 해제됩니다`);
			}
			const targets = picked.filter(p => !p.info.library);
			const results: (DeployResult | undefined)[] = [];
			for (const { info } of targets) {
				host.log(`[QuickCompile] 컴파일 검증 필요 선택 창 → ${info.projectName}${info.projectDir ? ` (${info.projectDir})` : ' (폴더 미상 — 선택 창)'}`);
				const result = await vscode.commands.executeCommand<DeployResult | undefined>(
					COMPILE_STALE_BADGE_COMMAND,
					...(info.projectDir ? [vscode.Uri.file(info.projectDir)] : []),
				);
				results.push(result);
				if (!result?.success) {
					if (targets.length > 1) {
						host.log(`[QuickCompile] ${info.projectName} 에서 중단 — 남은 ${targets.length - results.length}개는 돌리지 않았습니다`);
					}
					break;
				}
			}
			return results;
		}),
	);
}
