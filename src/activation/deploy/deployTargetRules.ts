/**
 * 대상 폴더의 순수 경로 판정 — 파일이 프로젝트 폴더 아래인지, 여러 후보 중 어느 프로젝트 폴더에 속하는지.
 * 미저장 문서 수집(`deployTargets`)과 autoOnSave 의 저장 파일 → 프로젝트 해석(`autoOnSave`)이 같은 규칙을 쓴다.
 * `deploy.ts` 에서 분할(2026-10-27). vscode 를 import 하지 않는다(Node 단독 테스트: test/activation/deploy/deployTargetRules.test.ts).
 */

import * as path from 'path';

/** `file` 이 `root` 폴더의 **안**(같은 경로 제외)에 있는지 — 경로는 `path.resolve` 로 정규화해 비교한다. */
export function isPathInsideDir(root: string, file: string): boolean {
	const rel = path.relative(path.resolve(root), path.resolve(file));
	return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** `fsPath` 를 품는 프로젝트 폴더 중 가장 깊은(경로가 긴, 구체적인) 것. 없으면 undefined. */
export function pickDeepestProjectDir(fsPath: string, projectDirs: readonly string[]): string | undefined {
	const matches = projectDirs.filter(dir => isPathInsideDir(dir, fsPath));
	if (matches.length === 0) { return undefined; }
	// 가장 깊은(경로가 긴) 프로젝트 폴더를 우선.
	return [...matches].sort((a, b) => b.length - a.length)[0];
}
