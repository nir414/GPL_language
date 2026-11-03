/**
 * "컴파일 검증 필요" 배지 — 트리(프로젝트 상태 섹션)와 상태바가 공유하는 표시 규칙. vscode 무의존.
 *
 * 상태의 정본은 `controller/deployment/compileStale`(host 가 보유·갱신)이고, 여기는 그 상태가 **어떻게 보이고 클릭하면
 * 무엇을 하는가**만 정한다. 종전에는 두 뷰가 문구를 각자 조립하고 클릭 대상도 달랐다(트리는 인자 없음 → 선택 창,
 * 상태바는 폴더 Uri) — 같은 배지가 자리마다 다르게 동작하는 구현 편차(Implementation Drift). ai-handoff §1-DV.
 *
 * 2026-10-28(§1-GN): 뷰가 **목록**을 받는다. 트리는 프로젝트마다 한 줄(`compileStaleBadge*` — 단일 항목 규칙), 상태바는 한 항목에
 * 요약(`compileStaleSummary*` — 대표 = 가장 최근 표시, 나머지는 "외 n")을 보이고, 여럿이면 클릭이 선택 창(`gpl.compileStale.pick`)으로 간다.
 */

import { CompileStaleInfo, describeCompileStale } from '../../controller/deployment/compileStale';

/** 배지 클릭이 실행하는 명령 — 빠른 컴파일(변경분 업로드 + Compile, Stop/Start 없음). */
export const COMPILE_STALE_BADGE_COMMAND = 'gpl.quickCompile';

/** 미검증 프로젝트가 여럿일 때 상태바 배지 클릭이 여는 선택 창 명령(activation/deploy/compileStaleCommands.ts). */
export const COMPILE_STALE_PICK_COMMAND = 'gpl.compileStale.pick';

/** `vscode.Command` 와 구조가 같은, vscode 무의존 명령 서술. `T` 는 리소스 인자 타입(접착 계층에서는 `vscode.Uri`). */
export interface BadgeCommand<T> {
	command: string;
	title: string;
	arguments?: T[];
}

// ── 단일 항목(트리 한 줄) ──────────────────────────────────────────────────────

/** 배지 라벨(아이콘 제외). */
export function compileStaleBadgeLabel(info: CompileStaleInfo): string {
	return `컴파일 검증 필요: ${info.projectName}`;
}

/**
 * 툴팁 — 상태 설명(정본 문장) + 최근 표시 시각(최초와 다를 때만) + 클릭 안내.
 * `formatTime` 은 테스트용 주입(기본 `toLocaleString`).
 */
export function compileStaleBadgeTooltip(info: CompileStaleInfo, formatTime: (ms: number) => string = defaultFormatTime): string {
	const recent = info.markedAt > info.since ? `\n최근 표시: ${formatTime(info.markedAt)}` : '';
	const click = info.library
		? '클릭: 목록 창을 엽니다(라이브러리는 단독 Compile 하지 않습니다 — 필요 없으면 목록에서 지울 수 있습니다).'
		: `클릭: ${info.projectName} 을(를) Quick Compile 로 먼저 확인합니다. Compile 없이 목록에서만 지우려면 명령 「GPL: Quick Compile Unverified Projects」 에서 × 를 누릅니다.`;
	return `${describeCompileStale(info, formatTime)}${recent}\n\n${click}`;
}

/**
 * 클릭 명령. 프로젝트 폴더를 알면 리소스 인자로 넘겨 **선택 창 없이** 그 프로젝트로 확정한다
 * (`gpl.quickCompile` 은 Uri 인자를 그 프로젝트로 본다). 모르면 인자 없이 — 단일 프로젝트면 즉시, 여럿이면 QuickPick(종전 경로).
 *
 * ProjectStart 없는 라이브러리는 Quick Compile 로 이끌지 않고 선택 창을 연다 — 그룹 단독 Compile 은 같은 부팅의 Unload 에서
 * 명령 콘솔이 끊기는 상태를 만든다(`unloadRisk` unload-after-group-compile, 2026-11-03 inbox ②).
 */
export function compileStaleBadgeCommand<T>(info: CompileStaleInfo, toResource: (dir: string) => T): BadgeCommand<T> {
	if (info.library) { return { command: COMPILE_STALE_PICK_COMMAND, title: '컴파일 검증 필요 목록' }; }
	const base: BadgeCommand<T> = { command: COMPILE_STALE_BADGE_COMMAND, title: 'Quick Compile' };
	return info.projectDir ? { ...base, arguments: [toResource(info.projectDir)] } : base;
}

// ── 목록 요약(상태바 한 항목) ───────────────────────────────────────────────────

/** 목록을 최근 표시 순(대표가 맨 앞)으로. 입력은 `CompileStaleTracker.list()` 순서(오래된 → 최근). */
export function compileStaleLatestFirst(items: readonly CompileStaleInfo[]): CompileStaleInfo[] {
	return [...items].reverse();
}

/** 상태바 라벨 — 대표 1건 + "외 n". 빈 목록이면 빈 문자열(호출부가 숨긴다). */
export function compileStaleSummaryLabel(items: readonly CompileStaleInfo[]): string {
	const latest = compileStaleLatestFirst(items);
	if (latest.length === 0) { return ''; }
	const rest = latest.length - 1;
	return `${compileStaleBadgeLabel(latest[0])}${rest > 0 ? ` 외 ${rest}` : ''}`;
}

/** 상태바 툴팁 — 1건이면 단일 항목 툴팁 그대로, 여럿이면 목록(최근 표시 순) + 선택 창 안내. */
export function compileStaleSummaryTooltip(items: readonly CompileStaleInfo[], formatTime: (ms: number) => string = defaultFormatTime): string {
	const latest = compileStaleLatestFirst(items);
	if (latest.length === 0) { return ''; }
	if (latest.length === 1) { return compileStaleBadgeTooltip(latest[0], formatTime); }
	const lines = latest.map(i => `- ${i.projectName}${i.library ? ' (라이브러리)' : ''} — ${i.reason} (${formatTime(i.since)} 이후)`);
	return `컴파일 검증 필요 ${latest.length}개 (최근 표시 순)\n${lines.join('\n')}\n\n`
		+ 'Start 는 `-compile` 로 컴파일까지 하므로 소스에 에러가 있으면 실행되지 않습니다. 라이브러리는 그것을 쓰는 실행 프로젝트의 Compile 로 함께 해제됩니다. '
		+ '클릭: Quick Compile 할 프로젝트를 고릅니다(× 는 Compile 없이 목록에서 지우기).';
}

/** 상태바 클릭 명령 — 1건이면 그 프로젝트로 바로 Quick Compile, 여럿이면 선택 창. */
export function compileStaleSummaryCommand<T>(items: readonly CompileStaleInfo[], toResource: (dir: string) => T): BadgeCommand<T> | undefined {
	const latest = compileStaleLatestFirst(items);
	if (latest.length === 0) { return undefined; }
	if (latest.length === 1) { return compileStaleBadgeCommand(latest[0], toResource); }
	return { command: COMPILE_STALE_PICK_COMMAND, title: 'Quick Compile…' };
}

function defaultFormatTime(ms: number): string {
	return new Date(ms).toLocaleString();
}
