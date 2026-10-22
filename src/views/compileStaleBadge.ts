/**
 * "컴파일 검증 필요" 배지 — 트리(프로젝트 상태 섹션)와 상태바가 공유하는 표시 규칙. vscode 무의존.
 *
 * 상태의 정본은 `controller/deployment/compileStale`(host 가 보유·갱신)이고, 여기는 그 상태가 **어떻게 보이고 클릭하면
 * 무엇을 하는가**만 정한다. 종전에는 두 뷰가 문구를 각자 조립하고 클릭 대상도 달랐다(트리는 인자 없음 → 선택 창,
 * 상태바는 폴더 Uri) — 같은 배지가 자리마다 다르게 동작하는 구현 편차(Implementation Drift). ai-handoff §1-DV.
 */

import { CompileStaleInfo, describeCompileStale } from '../controller/deployment/compileStale';

/** 배지 클릭이 실행하는 명령 — 빠른 컴파일(변경분 업로드 + Compile, Stop/Start 없음). */
export const COMPILE_STALE_BADGE_COMMAND = 'gpl.quickCompile';

/** `vscode.Command` 와 구조가 같은, vscode 무의존 명령 서술. `T` 는 리소스 인자 타입(접착 계층에서는 `vscode.Uri`). */
export interface BadgeCommand<T> {
	command: string;
	title: string;
	arguments?: T[];
}

/** 배지 라벨(아이콘 제외). */
export function compileStaleBadgeLabel(info: CompileStaleInfo): string {
	return `컴파일 검증 필요: ${info.projectName}`;
}

/** 툴팁 — 상태 설명(정본 문장) + 클릭 안내. `formatTime` 은 테스트용 주입(기본 `toLocaleString`). */
export function compileStaleBadgeTooltip(info: CompileStaleInfo, formatTime?: (ms: number) => string): string {
	return `${describeCompileStale(info, formatTime)}\n\n클릭: ${info.projectName} 을(를) Quick Compile 로 먼저 확인합니다.`;
}

/**
 * 클릭 명령. 프로젝트 폴더를 알면 리소스 인자로 넘겨 **선택 창 없이** 그 프로젝트로 확정한다
 * (`gpl.quickCompile` 은 Uri 인자를 그 프로젝트로 본다). 모르면 인자 없이 — 단일 프로젝트면 즉시, 여럿이면 QuickPick(종전 경로).
 */
export function compileStaleBadgeCommand<T>(info: CompileStaleInfo, toResource: (dir: string) => T): BadgeCommand<T> {
	const base: BadgeCommand<T> = { command: COMPILE_STALE_BADGE_COMMAND, title: 'Quick Compile' };
	return info.projectDir ? { ...base, arguments: [toResource(info.projectDir)] } : base;
}
