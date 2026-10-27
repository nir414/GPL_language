/**
 * 제어기 트리의 노드 모델(SectionNode·ThreadNode·InfoNode) — vscode 무의존.
 * controllerTreeProvider.ts 에서 분리했다(2026-10-27, 동작 동일). 노드 → `vscode.TreeItem` 변환은 treeItems.ts 가 맡는다.
 */
import type { ThreadInfo } from '../../controller/protocol/responseParser';

/** `vscode.Command` 와 구조가 같은, vscode 무의존 명령 서술(statusbar/compileStaleBadge 의 `BadgeCommand` 와 같은 취지). */
export interface NodeCommand {
	command: string;
	title: string;
	arguments?: any[];
}

export type ControllerNode = SectionNode | ThreadNode | InfoNode;

export class SectionNode {
	readonly type = 'section' as const;
	children: ControllerNode[] = [];
	collapsed = false;
	/** 섹션이 대표하는 원격 경로(FTP 섹션만). 섹션 헤더 명령이 대상 경로를 화면과 동일하게 받도록 노출한다. */
	remotePath?: string;
	constructor(
		public readonly id: string,
		public label: string,
		public iconId: string,
		public description?: string,
		public tooltip?: string,
	) {}
}

export class ThreadNode {
	readonly type = 'thread' as const;
	constructor(public readonly thread: ThreadInfo) {}
}

export class InfoNode {
	readonly type = 'info' as const;
	constructor(
		public readonly label: string,
		public readonly iconId: string,
		public readonly description?: string,
		public readonly command?: NodeCommand,
		public readonly contextValue?: string,
		public readonly tooltip?: string,
		public readonly remotePath?: string,
		public readonly projectName?: string,
		public readonly controllerHost?: string,
	) {}
}
