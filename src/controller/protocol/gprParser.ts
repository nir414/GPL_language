/**
 * Project.gpr 텍스트 파서.
 *
 * 책임: ProjectName/ProjectStart/ProjectSource/ProjectLibrary 추출.
 * `responseParser.ts` 에서 응답 종류별로 분리했다(2026-10-27) — 함수 본문은 그대로 옮겼고,
 * 기존 import 경로는 `responseParser.ts` 배럴이 유지한다.
 */

export interface GprInfo {
    projectName: string;
    projectStart: string;
    sources: string[];
    /** `ProjectLibrary="…"` 값(원문 그대로, 0..N). 경로 해석은 `project/sources/projectSources.ts`. */
    libraries: string[];
}

/**
 * Project.gpr 텍스트에서 메타 정보 추출.
 */
export function parseGpr(text: string): GprInfo {
    let projectName = '';
    let projectStart = '';
    const sources: string[] = [];
    const libraries: string[] = [];

    const nameMatch = text.match(/ProjectName\s*=\s*"([^"]+)"/i);
    if (nameMatch) { projectName = nameMatch[1]; }

    const startMatch = text.match(/ProjectStart\s*=\s*"([^"]+)"/i);
    if (startMatch) { projectStart = startMatch[1]; }

    const srcRe = /ProjectSource\s*=\s*"([^"]+)"/gi;
    let m: RegExpExecArray | null;
    while ((m = srcRe.exec(text)) !== null) {
        sources.push(m[1].trim());
    }

    // ProjectLibrary="MyProject\MyLibrary" — 다른 GPL 프로젝트를 라이브러리로 참조하는 줄(2026-08-31 실측).
    const libRe = /ProjectLibrary\s*=\s*"([^"]+)"/gi;
    while ((m = libRe.exec(text)) !== null) {
        libraries.push(m[1].trim());
    }

    return { projectName, projectStart, sources, libraries };
}
