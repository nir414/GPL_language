/**
 * 쓰레드 행(ThreadNode)의 표시 규칙 — description·툴팁·contextValue·클릭 명령·아이콘·정렬 순위. vscode 무의존.
 * controllerTreeProvider.ts 의 toThreadItem/threadStateRank/threadIcon 에서 판단 부분만 옮겼다(2026-10-27, 동작 동일).
 * `vscode.TreeItem`/`ThemeIcon` 생성은 treeItems.ts 가 이 결과로 한다.
 */
import type { ThreadInfo } from '../../controller/protocol/responseParser';

/**
 * 쓰레드 목록 정렬용 상태 우선순위(작을수록 위).
 * Error → Paused/Break → Stopping/Stopped → Running → Idle → 기타.
 */
export function threadStateRank(state: string): number {
	switch (state) {
		case 'Error': return 0;
		case 'Paused':
		case 'Break': return 1;
		case 'Stopping':
		case 'Stopped': return 2;
		case 'Running': return 3;
		case 'Idle': return 4;
		default: return 5;
	}
}

/** description: 상태 + 파일 + 상태 메시지 */
export function formatThreadRowDescription(t: ThreadInfo): string {
	const descParts: string[] = [t.state];
	if (t.file) { descParts.push(t.fileLine ? `${t.file}:${t.fileLine}` : t.file); }
	if (t.lastStatus && t.lastStatus !== '0') { descParts.push(t.lastStatus); }
	if (t.stackTiming && t.stackTiming.length) { descParts.push(t.stackTiming.join('/')); }
	return descParts.join(' · ');
}

export function formatThreadRowTooltip(t: ThreadInfo): string {
	return [
		t.name,
		`State: ${t.state}`,
		t.lastStatus ? `Status: ${t.lastStatus}` : '',
		t.project ? `Project: ${t.project}` : '',
		t.file ? (t.fileLine ? `File: ${t.file}:${t.fileLine}` : `File: ${t.file}`) : '',
		// `Show Thread -stack` trailing 수치. 컬럼 의미는 도움말 미확인(raw 표기).
		t.stackTiming && t.stackTiming.length ? `Timing(-stack): ${t.stackTiming.join(' / ')}` : '',
	].filter(Boolean).join('\n');
}

/** 상태별 contextValue — package.json 의 view/item/context `when` 절이 참조한다. */
export function threadRowContextValue(state: string): string {
	switch (state) {
		case 'Running': return 'gplThread-running';
		case 'Paused':
		case 'Break': return 'gplThread-paused';
		case 'Error': return 'gplThread-error';
		default: return 'gplThread-stopped';
	}
}

/**
 * 클릭 명령(인자 ThreadNode 는 호출부가 붙인다). 정지/에러 쓰레드는 클릭 시 바로 정지/에러 위치로 이동한다
 * (디버거 호출 스택처럼). Continue/Step 등 제어 동작은 컨텍스트 메뉴와 인라인 버튼으로 제공한다.
 * 그 외 상태(실행/정지됨 등)는 클릭 시 액션 QuickPick 을 띄운다.
 */
export function threadRowCommand(state: string): { command: string; title: string } {
	switch (state) {
		case 'Paused':
		case 'Break':
			return { command: 'gpl.controller.threadShowLocation', title: '정지 위치 보기' };
		case 'Error':
			return { command: 'gpl.controller.threadShowLocation', title: '에러 위치 보기' };
		default:
			return { command: 'gpl.controller.threadActions', title: '쓰레드 동작' };
	}
}

/** 아이콘 서술 — codicon id 와 테마 색 id(없으면 기본색). */
export interface ThreadIconSpec {
	id: string;
	color?: string;
}

export function threadIconSpec(state: string): ThreadIconSpec {
	switch (state) {
		case 'Running': return { id: 'run-all', color: 'testing.runAction' };
		case 'Idle': return { id: 'clock', color: 'charts.yellow' };
		case 'Error': return { id: 'bug', color: 'errorForeground' };
		case 'Stopped': return { id: 'stop-circle', color: 'charts.orange' };
		case 'Paused': return { id: 'debug-pause', color: 'debugIcon.pauseForeground' };
		case 'Break': return { id: 'debug-breakpoint-data', color: 'debugIcon.breakpointForeground' };
		default: return { id: 'circle-outline' };
	}
}
