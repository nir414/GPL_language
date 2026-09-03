/**
 * 프로젝트 폴더 선택의 순수 로직 (vscode 의존 없음 — 단위 테스트 대상).
 *
 * 확장 안에서 ".gpr가 있는 폴더 중 어느 것을 대상으로 하는가"는 여러 진입점(명령 팔레트,
 * 탐색기 우클릭, F5 launch 구성, 트리뷰)이 공유하는 결정이다. 진입점마다 규칙이 갈라져
 * 서로 다른 프로젝트를 고르는 일을 막기 위해 규칙을 여기 한 곳에 둔다.
 * (2026-08-28: 종전에는 extension.ts QuickPick / gplDebugSession 정렬-첫-번째 폴백이 따로 있었다.)
 */

import * as path from 'path';

/**
 * 경로 동일성 키 — 대소문자·구분자·`.`/`..`·끝 슬래시 차이를 무시한다(Windows).
 *
 * **파일·폴더 공용**이다. 같은 파일을 가리키는 표기가 여러 개일 수 있어서
 * (`.gpr`의 `ProjectSource=` 표기 ↔ 디스크 표기, 워크스페이스 검색 ↔ 열린 문서의 URI 등),
 * 경로를 Map/Set 키로 쓸 때는 반드시 이 키를 거친다. 원문 문자열을 그대로 키로 쓰면
 * 같은 파일이 캐시에 여러 항목으로 들어가 정의 이동이 같은 선언을 여러 번 띄운다
 * (2026-09-02 `docs/ai-handoff.md` §1-CQ).
 */
export function normalizePathKey(p: string): string {
    return path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();
}

/** `normalizePathKey`와 같은 규칙 — 폴더 문맥의 기존 호출부가 쓰는 이름. */
export function normalizeDirKey(p: string): string {
    return normalizePathKey(p);
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
 * 후보 폴더들 중 **폴더명이 겹치는 것들**에 붙일 위치 표기를 계산한다 — QuickPick 라벨이
 * `$(folder) GPL_Code` 로 똑같이 보이는 문제(§1-CN 남은 일)를 위한 것이다.
 *
 * 이 사용자의 실작업 구조에서는 과제 폴더마다 같은 이름의 프로젝트를 복제해 두므로
 * (`…/과제A/시뮬레이션/projects/GPL_Code`, `…/과제B/시뮬레이션/projects/GPL_Code`)
 * 후보 목록에 동명 항목이 실제로 여러 개 뜬다.
 *
 * 규칙: 폴더명이 유일한 후보에는 아무것도 붙이지 않고(잡음 방지), 겹치는 후보에는
 * **그 그룹 안에서 서로 달라지는 데 필요한 최소 상위 폴더**만 붙인다. 위 예에서는
 * `projects` 도 `시뮬레이션` 도 같으므로 `과제A` 까지 올라가야 구분되고, 표기는
 * `과제A/시뮬레이션/projects` 가 된다(그 그룹의 모든 항목에 같은 깊이를 쓴다 — 같은 깊이라야
 * 목록에서 눈으로 비교된다).
 *
 * 반환: `normalizeDirKey(dir)` → 위치 표기. 표기가 필요 없는 폴더는 항목이 없다.
 */
export function disambiguateDirLabels(dirs: string[]): Map<string, string> {
    const hints = new Map<string, string>();
    const segmentsOf = (dir: string): string[] =>
        path.resolve(dir).split(/[\\/]+/).filter(seg => seg.length > 0);

    const groups = new Map<string, string[]>();
    for (const dir of dirs) {
        const key = path.basename(path.resolve(dir)).toLowerCase();
        const group = groups.get(key);
        if (group) { group.push(dir); } else { groups.set(key, [dir]); }
    }

    for (const group of groups.values()) {
        if (group.length < 2) { continue; }
        const segs = new Map(group.map(d => [d, segmentsOf(d)] as const));
        const maxDepth = Math.max(...[...segs.values()].map(v => v.length));
        for (let ancestors = 1; ancestors < maxDepth; ancestors++) {
            // 뒤에서 (상위 ancestors개 + 폴더명) 만큼 잘라 비교 — 모두 달라지면 그 깊이를 쓴다.
            const suffixes = group.map(d => {
                const v = segs.get(d)!;
                return v.slice(Math.max(0, v.length - (ancestors + 1))).join('/').toLowerCase();
            });
            if (new Set(suffixes).size !== group.length) { continue; }
            for (const d of group) {
                const v = segs.get(d)!;
                const parents = v.slice(Math.max(0, v.length - (ancestors + 1)), v.length - 1);
                if (parents.length > 0) { hints.set(normalizeDirKey(d), parents.join(path.sep)); }
            }
            break;
        }
    }
    return hints;
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
