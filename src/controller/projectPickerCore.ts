/**
 * 프로젝트 폴더 선택의 순수 로직 (vscode 의존 없음 — 단위 테스트 대상).
 *
 * 확장 안에서 ".gpr가 있는 폴더 중 어느 것을 대상으로 하는가"는 여러 진입점(명령 팔레트,
 * 탐색기 우클릭, F5 launch 구성, 트리뷰)이 공유하는 결정이다. 진입점마다 규칙이 갈라져
 * 서로 다른 프로젝트를 고르는 일을 막기 위해 규칙을 여기 한 곳에 둔다.
 * (2026-08-28: 종전에는 extension.ts QuickPick / gplDebugSession 정렬-첫-번째 폴백이 따로 있었다.)
 */

import * as path from 'path';

/** 경로 비교 키 — 대소문자·구분자·끝 슬래시 차이를 무시한다(Windows). */
export function normalizeDirKey(p: string): string {
    return path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();
}

/** filePath가 dirPath 하위(또는 동일)인지 판정. 접두어 비교가 아니라 경로 세그먼트 기준. */
export function isPathUnder(filePath: string, dirPath: string): boolean {
    try {
        const rel = path.relative(path.resolve(dirPath), path.resolve(filePath));
        return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    } catch {
        return false;
    }
}

/**
 * QuickPick 표시 순서: 최근 선택을 맨 위로, 나머지는 경로 정렬. 중복 경로는 제거한다.
 */
export function orderProjectDirs(dirs: string[], lastPicked?: string): string[] {
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const d of dirs) {
        const key = normalizeDirKey(d);
        if (seen.has(key)) { continue; }
        seen.add(key);
        unique.push(d);
    }
    unique.sort((a, b) => a.localeCompare(b));
    if (lastPicked) {
        const lastKey = normalizeDirKey(lastPicked);
        const idx = unique.findIndex(d => normalizeDirKey(d) === lastKey);
        if (idx > 0) {
            const [hit] = unique.splice(idx, 1);
            unique.unshift(hit);
        }
    }
    return unique;
}

/**
 * 명시 리소스(탐색기 우클릭 등)에서 프로젝트 폴더를 결정한다.
 * - 폴더: 그 폴더 자체가 프로젝트 폴더일 때만 인정한다(상위 폴더를 우클릭해 하위 프로젝트를
 *   임의로 고르지 않는다 — 의도와 다른 대상에 업로드하는 일을 막기 위해).
 * - .gpr 파일: 그 파일이 있는 폴더.
 * - 그 외 파일: 파일을 물리적으로 포함하는 가장 깊은 프로젝트 폴더.
 */
export function projectDirFromResource(resourcePath: string, dirs: string[], isDirectory: boolean): string | undefined {
    const resolved = path.resolve(resourcePath);
    const byKey = new Map(dirs.map(d => [normalizeDirKey(d), d] as const));
    if (isDirectory) {
        return byKey.get(normalizeDirKey(resolved));
    }
    if (resolved.toLowerCase().endsWith('.gpr')) {
        return byKey.get(normalizeDirKey(path.dirname(resolved)));
    }
    return dirs
        .filter(d => isPathUnder(resolved, d))
        .sort((a, b) => b.length - a.length)[0];
}

/**
 * launch.json `projectName` 등 이름으로 폴더 후보를 좁힌다 — 폴더명 또는 .gpr ProjectName이
 * 일치(대소문자 무시)하는 폴더만. 일치가 없으면 빈 배열(호출측이 전체 후보로 폴백할지 결정).
 */
export function filterDirsByProjectName(
    dirs: string[],
    projectName: string,
    gprNameOf: (dir: string) => string | undefined,
): string[] {
    const target = projectName.trim().toLowerCase();
    if (!target) { return []; }
    return dirs.filter(d =>
        path.basename(d).toLowerCase() === target
        || (gprNameOf(d) || '').toLowerCase() === target,
    );
}
