/**
 * 배포에 함께 올릴 라이브러리 계획(순수) — `.gpr` 의 `ProjectLibrary` 가 가리키는 폴더 중 **컴파일 루트 밖이지만 같은
 * projects 폴더(컴파일 루트의 부모) 안**에 있는 것을, 제어기가 찾을 원격 위치(`/GPL/<ProjectLibrary 값>`)로 올린다.
 *
 * ```
 * 독립형                                     내장형(BinderR4)
 * projects/Main/Project.gpr                 projects/BinderR4/Project.gpr      ProjectStart 있음 = 컴파일 루트
 *   ProjectLibrary="Libraries"              projects/BinderR4/Gantry/Data/Project.gpr
 * projects/Libraries/Project.gpr              ProjectLibrary="Lib\Core\Text"   (값이 BinderR4 기준)
 *   → /GPL/Libraries 로 함께 업로드          projects/BinderR4/Lib/Core/Text  → BinderR4 업로드에 포함, 따로 안 올림
 * ```
 *
 * 근거: 문서상(GDS "GPL Project Libraries") 컴파일 때 참조 라이브러리 파일이 메인 프로젝트에 함께 포함되고, 값은 실측
 * 표본 1건(`ProjectLibrary="MyProject\MyLibrary"`, docs/reference/project-file-gpr.md §4)에서 **projects 폴더 기준 상대
 * 경로**였다. 그래서 값을 projects 폴더에 붙여 그 폴더가 나올 때만 올린다 — 다른 방법(조상 폴더·알려진 .gpr 폴백)으로
 * 찾은 폴더는 제어기가 같은 자리에서 찾는다고 말할 수 없으므로 올리지 않고 알린다. 형제 배치는 실기 미검증이다.
 *
 * 분류(라이브러리 하나당 하나):
 * - `covered`: 프로젝트 폴더 안, 또는 함께 올릴 다른 라이브러리 폴더 안 — 그 재귀 업로드에 이미 포함된다.
 * - `embedded`: 배포 대상이 **내장형 패키지**(컴파일 루트가 자기보다 위)일 때 컴파일 루트 안에 있는 라이브러리 —
 *   컴파일 단위는 루트이므로 루트를 올릴 때 함께 간다. 패키지 하나를 올리면서 형제 패키지를 따로 올리지 않는다.
 * - `uploads`: 컴파일 루트 밖 · projects 폴더 안 · 값이 projects 기준 경로와 일치.
 * - `skipped`: 그 밖(projects 폴더 밖, 값과 위치 불일치) — 사유와 함께.
 *
 * vscode·fs 를 쓰지 않는다(Node 단독 테스트: test/controller/deployment/libraryUploadPlan.test.ts).
 */

import * as path from 'path';
import { isPathUnder, normalizeDirKey } from '../../util/pathKey';

/** `ProjectLibrary` 한 줄 — 원문 값과 해석된 폴더(해석 실패면 `dir` 없음). `projectSources.LibraryRef` 와 같은 모양. */
export interface LibraryRefInput {
    raw: string;
    dir?: string;
}

export interface LibraryUpload {
    /** `.gpr` 에 적힌 값 그대로(로그용). */
    raw: string;
    localDir: string;
    /** `<remoteRoot>/<값, \ → />` — 값의 대소문자를 그대로 쓴다(제어기는 이 값으로 찾는다). */
    remoteDir: string;
}

export interface LibraryUploadPlan {
    /** 배포 대상이 내장형 패키지면 그 컴파일 루트 폴더(아니면 undefined). */
    embeddedIn?: string;
    uploads: LibraryUpload[];
    /** 프로젝트 폴더·함께 올릴 라이브러리 폴더의 재귀 업로드에 이미 포함 — projects 폴더 기준 상대 경로. */
    covered: string[];
    /** 내장형 패키지의 컴파일 루트 안 라이브러리 — projects 폴더 기준 상대 경로. */
    embedded: string[];
    /** 올리지 않는 라이브러리 — 위치와 사유. */
    skipped: { raw: string; dir: string; reason: string }[];
    /** 로컬에서 폴더를 찾지 못한 값. */
    unresolved: string[];
}

/** 원격 경로 조각 — `\`·`/` 를 `/` 로, 앞뒤 구분자와 `.` 조각을 없앤다. `..` 이 있으면 undefined(루트 밖). */
function remoteRelative(raw: string): string | undefined {
    const parts = raw.trim().split(/[\\/]+/).filter(p => p.length > 0 && p !== '.');
    if (parts.length === 0 || parts.includes('..')) { return undefined; }
    return parts.join('/');
}

export function planLibraryUploads(input: {
    /** 배포하는 프로젝트 폴더. */
    projectDir: string;
    /** 그 프로젝트의 컴파일 루트 폴더(`dependencyModel.findCompileRootGpr`). 없거나 같으면 독립형. */
    compileRootDir?: string;
    /** 라이브러리 그래프 전체의 참조(메인과 라이브러리의 `ProjectLibrary` 줄 모두). */
    refs: readonly LibraryRefInput[];
    /** 원격 projects 폴더(direct 모드의 `/GPL`). */
    remoteRoot: string;
}): LibraryUploadPlan {
    const projectDir = path.resolve(input.projectDir);
    const rootDir = input.compileRootDir && isPathUnder(projectDir, input.compileRootDir)
        ? path.resolve(input.compileRootDir)
        : projectDir;
    const embeddedIn = normalizeDirKey(rootDir) !== normalizeDirKey(projectDir) ? rootDir : undefined;
    const projectsDir = path.dirname(rootDir);
    const remoteRoot = input.remoteRoot.replace(/\/+$/, '');
    const plan: LibraryUploadPlan = { embeddedIn, uploads: [], covered: [], embedded: [], skipped: [], unresolved: [] };
    const seen = new Set<string>();
    const relOf = (dir: string): string => path.relative(projectsDir, dir) || dir;

    const candidates: LibraryUpload[] = [];
    for (const ref of input.refs) {
        if (!ref.dir) {
            if (!plan.unresolved.includes(ref.raw)) { plan.unresolved.push(ref.raw); }
            continue;
        }
        const dir = path.resolve(ref.dir);
        const key = normalizeDirKey(dir);
        if (seen.has(key) || key === normalizeDirKey(projectDir)) { continue; }
        seen.add(key);

        if (isPathUnder(dir, projectDir)) { plan.covered.push(relOf(dir)); continue; }
        if (isPathUnder(dir, rootDir)) { plan.embedded.push(relOf(dir)); continue; }
        if (!isPathUnder(dir, projectsDir) || key === normalizeDirKey(projectsDir) || isPathUnder(rootDir, dir)) {
            plan.skipped.push({ raw: ref.raw, dir, reason: 'projects 폴더 밖' });
            continue;
        }
        const rel = remoteRelative(ref.raw);
        if (!rel || normalizeDirKey(path.resolve(projectsDir, rel)) !== key) {
            plan.skipped.push({ raw: ref.raw, dir, reason: '값이 projects 기준 경로와 다름 — 제어기가 찾을 위치 불확실' });
            continue;
        }
        candidates.push({ raw: ref.raw, localDir: dir, remoteDir: `${remoteRoot}/${rel}` });
    }

    // 다른 후보 폴더 안에 든 후보는 그 재귀 업로드에 포함된다 — 같은 파일을 두 번 올리지 않는다.
    for (const c of candidates) {
        const outer = candidates.some(o => o !== c && isPathUnder(c.localDir, o.localDir));
        if (outer) { plan.covered.push(relOf(c.localDir)); } else { plan.uploads.push(c); }
    }
    return plan;
}
