/**
 * 트리 노드(treeNodes) → `vscode.TreeItem` 변환 — 이 폴더에서 vscode 를 아는 얇은 어댑터.
 * controllerTreeProvider.ts 의 toSectionItem/toThreadItem/toInfoItem 을 그대로 옮겼다(2026-10-27, 동작 동일).
 * 표시 규칙(문구·아이콘 id·contextValue·명령)은 threadRowPresentation/treeSections 에 있고 여기서는 조립만 한다.
 */
import * as vscode from 'vscode';
import { isFtpFolderContext } from '../../controller/files/ftpNodeTarget';
import {
	formatThreadRowDescription,
	formatThreadRowTooltip,
	threadIconSpec,
	threadRowCommand,
	threadRowContextValue,
} from './threadRowPresentation';
import type { InfoNode, SectionNode, ThreadNode } from './treeNodes';

/**
 * 섹션 헤더. `layoutKey` 는 `${SECTION_LAYOUT_EPOCH}.${salt}` — provider 가 준다.
 * id 를 주지 않으면 VS Code 가 라벨로 핸들을 만들어 사용자의 접기 상태를 저장하고, 그 뒤로는
 * collapsibleState 를 무시한다(라벨이 IP·개수를 품고 있어 상태가 흩어지기도 한다).
 * 안정적인 id 에 세대·초기화 salt 를 붙여, 평소에는 사용자의 선택을 기억하되 기본값을 바꾸거나
 * 초기화 명령을 실행했을 때만 새 기본 상태로 한 번 되돌아가게 한다.
 */
export function toSectionItem(node: SectionNode, layoutKey: string): vscode.TreeItem {
	const state = node.collapsed
		? vscode.TreeItemCollapsibleState.Collapsed
		: vscode.TreeItemCollapsibleState.Expanded;
	const item = new vscode.TreeItem(node.label, state);
	item.id = `section-${node.id}@${layoutKey}`;
	item.iconPath = new vscode.ThemeIcon(node.iconId);
	item.description = node.description;
	if (node.tooltip) { item.tooltip = node.tooltip; }
	item.contextValue = `section-${node.id}`;
	// 섹션 헤더 명령(예: FTP 폴더 비우기)이 대상 경로를 인자로 받도록 노드의 원격 경로를 붙여 준다.
	(item as any).remotePath = node.remotePath;
	return item;
}

export function toThreadItem(node: ThreadNode): vscode.TreeItem {
	const t = node.thread;
	const item = new vscode.TreeItem(t.name, vscode.TreeItemCollapsibleState.None);
	item.description = formatThreadRowDescription(t);
	item.tooltip = formatThreadRowTooltip(t);
	const icon = threadIconSpec(t.state);
	item.iconPath = icon.color ? new vscode.ThemeIcon(icon.id, new vscode.ThemeColor(icon.color)) : new vscode.ThemeIcon(icon.id);
	// Granular contextValue for different thread states
	item.contextValue = threadRowContextValue(t.state);
	// 정지/에러 쓰레드는 클릭 시 바로 정지/에러 위치로 이동, 그 외는 액션 QuickPick(threadRowCommand).
	item.command = { ...threadRowCommand(t.state), arguments: [node] };
	return item;
}

export function toInfoItem(node: InfoNode): vscode.TreeItem {
	const directory = isFtpFolderContext(node.contextValue);
	const item = new vscode.TreeItem(node.label, directory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
	if (node.remotePath && node.controllerHost) { item.id = `ftp:${node.controllerHost}:${node.remotePath}`; }
	item.iconPath = new vscode.ThemeIcon(node.iconId);
	item.description = node.description;
	if (node.tooltip) {
		item.tooltip = node.tooltip;
	}
	if (node.command) {
		item.command = node.command;
	}
	if (node.contextValue) {
		item.contextValue = node.contextValue;
	}
	(item as any).remotePath = node.remotePath;
	(item as any).projectName = node.projectName;
	(item as any).controllerHost = node.controllerHost;
	return item;
}
