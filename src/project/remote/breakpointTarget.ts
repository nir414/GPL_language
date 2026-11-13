/**
 * 로컬 GPL 소스를 제어기 `Set Break`의 파일 identity로 바꾼다.
 *
 * 제어기는 `Set Break <프로젝트> "<파일>"<줄>`의 파일을 **그 프로젝트가 직접 선언한** `ProjectSource`에서 찾는다.
 * 따라서 basename이나 디스크 상대 경로를 추측하지 않고 `.gpr` 원문을 기준으로 판정한다.
 *
 * `ProjectLibrary`로 참조된 형제 프로젝트의 소스는 메인 프로젝트 이름으로는 -508 이지만, **그 라이브러리 프로젝트
 * 이름 + 라이브러리 안의 파일 표기**로 보내면 걸린다(2026-11-05 실기 실측: `Set Break Gantry "Gantry_Station.gpl"310` → 0
 * Success, `Set Break App "Gantry/Gantry_Station.gpl"310` → -508). 전송 대상(`controllerProject`·`file`)은 이 모듈이
 * 한 곳에서 정하고 디버그 어댑터·AI 경로·에디터 동기화가 모두 이것을 쓴다(SSOT).
 *
 * "라이브러리 프로젝트 이름"의 정체(2026-11-13 실측, G2400C 4.2K5, captures/nesttest):
 * - `.gpr` 의 `ProjectName` 이 아니라 **`ProjectLibrary` 값 = `/GPL` 바로 아래 폴더 이름**이다 — 폴더 `FDir`·`ProjectName="FName"` 에서
 *   `Set Break FDir "F.gpl"4` → 0, `Set Break FName …` → -508.
 * - 파일은 그 라이브러리 `.gpr` 의 `ProjectSource` 표기 그대로(역슬래시)다 — `Set Break TLib "Core\Log\Logger.gpl"4` → 0, `/` 로 쓰면 -508.
 * - **중첩 라이브러리(`ProjectLibrary="Lib\Core\Log"`)는 지정할 방법이 없다.** 폴더명·ProjectName·경로(역슬래시·슬래시·따옴표) 24종이
 *   모두 -508/-205 였다(프로젝트 인자는 구분자 없는 낱말 하나만 받는다). 실행·Step·Show Stack(`Lib\Core\Log/Logger.gpl`)은 된다.
 *   → 이런 소스는 `library-source` 이지만 `file` 없이 돌려주고(`nestedLibraryRef`), 호출자는 보내지 않고 사유를 알린다.
 *   해법: 라이브러리 맨 위 `.gpr` 하나에 `ProjectSource="Core\Log\Logger.gpl"` 처럼 하위 폴더 소스를 직접 등재한다(폴더 구조는 그대로,
 *   실제 Sample Prep Lib/v1 83파일로 Compile·중단점 히트 확인).
 */

import * as fs from 'fs';
import * as path from 'path';
import { buildLibraryGraph, ResolveLibraryOptions } from '../sources/projectSources';
import type { LibraryGraph, LibraryGraphNode } from '../sources/projectSources';
import { parseGprText } from '../gpr/gprSync';

export type BreakpointTargetKind = 'direct-source' | 'library-source' | 'outside-project';

export interface ResolvedBreakpointTarget {
    kind: BreakpointTargetKind;
    /** 메인(컴파일 단위) 프로젝트 이름. */
    projectName: string;
    /**
     * `Set Break`에 쓸 프로젝트 이름 — direct-source면 `projectName`, library-source면 그 라이브러리의 `ProjectName`.
     * outside-project에서는 의미가 없다(`projectName`과 같게 채운다).
     */
    controllerProject: string;
    /** direct/library-source일 때 제어기에 보낼 `ProjectSource` 표기(library-source는 라이브러리 폴더 기준 상대 경로). */
    file?: string;
    /** 1-based */
    line: number;
    localPath: string;
    libraryName?: string;
    /** 중첩 라이브러리라 제어기가 중단점 대상으로 지정할 수 없을 때 그 `ProjectLibrary` 값(`Lib\Core\Log`). 이때 `file` 은 없다. */
    nestedLibraryRef?: string;
    message?: string;
}

export interface ResolveBreakpointTargetOptions extends ResolveLibraryOptions {
    gprPath: string;
    gprText: string;
    localPath: string;
    line: number;
}

/** Windows/제어기 경로 표기 차이를 흡수한 절대경로 비교 키. */
function pathKey(value: string): string {
    return path.resolve(value).replace(/[\\/]+/g, path.sep).toLowerCase();
}

/** `ProjectSource` 원문을 제어기 표기(`\`)로만 정규화한다. */
export function normalizeBreakpointFile(value: string): string {
    return value.trim().replace(/[\\/]+/g, '\\');
}

function sourceAbsolutePath(gprPath: string, raw: string): string {
    const native = raw.replace(/[\\/]+/g, path.sep);
    return path.isAbsolute(native)
        ? path.resolve(native)
        : path.resolve(path.dirname(path.resolve(gprPath)), native);
}

/** 그래프에서 이 노드를 가리키는 `ProjectLibrary` 원문 값(선언 순서로 처음 나온 것). 없으면 undefined. */
function libraryRefOf(graph: LibraryGraph, node: LibraryGraphNode): string | undefined {
    const key = pathKey(node.dir);
    for (const from of graph.nodes.values()) {
        for (const ref of from.refs) {
            if (ref.dir && pathKey(ref.dir) === key) { return ref.raw.trim(); }
        }
    }
    return undefined;
}

/** `ProjectLibrary` 값의 경로 조각(`Lib\Core\Log` → `['Lib','Core','Log']`). */
export function libraryRefSegments(raw: string): string[] {
    return raw.trim().split(/[\\/]+/).filter(part => part.length > 0 && part !== '.');
}

/** 중첩 라이브러리 소스에 중단점을 걸 수 없는 이유와 해법(디버그 어댑터·AI 경로 공용 문구). */
export function nestedLibraryBreakpointMessage(ref: string, fileName: string): string {
    const top = libraryRefSegments(ref)[0] ?? ref;
    return `${fileName}은 중첩 라이브러리(ProjectLibrary="${ref}")의 소스라 제어기가 중단점 대상으로 지정하지 못합니다 — `
        + 'Set Break 의 프로젝트 인자는 /GPL 바로 아래 폴더 이름만 받습니다(2026-11-13 실측). '
        + `${top} 폴더 맨 위 Project.gpr 하나에 하위 폴더 소스를 ProjectSource 로 직접 등재하고 앱이 ProjectLibrary="${top}" 로 참조하면 `
        + '걸립니다(폴더 구조는 그대로 둘 수 있습니다). 이 파일 하나만 급히 걸려면 명령 「GPL: Promote Source for Breakpoint (중단점용 소스 승격)」을 쓰십시오.';
}

/** 라이브러리 `.gpr` 에 적힌 `ProjectSource` 표기(못 찾으면 폴더 기준 상대 경로). */
function declaredSourceNotation(node: LibraryGraphNode, localPath: string, readText: (file: string) => string): string {
    try {
        const wanted = pathKey(localPath);
        for (const source of parseGprText(readText(node.gprPath)).sources) {
            if (pathKey(sourceAbsolutePath(node.gprPath, source.path)) === wanted) { return normalizeBreakpointFile(source.path); }
        }
    } catch { /* 아래 상대 경로로 */ }
    return normalizeBreakpointFile(path.relative(node.dir, localPath));
}

/**
 * 메인 `.gpr`의 직접 source / library graph source / compile unit 밖 파일을 구분한다.
 * direct-source·library-source는 `controllerProject`·`file`을 가지므로 `breakpointSendTarget`으로 명령 대상을 얻는다.
 */
export function resolveBreakpointTarget(opts: ResolveBreakpointTargetOptions): ResolvedBreakpointTarget {
    const localPath = path.resolve(opts.localPath);
    const wanted = pathKey(localPath);
    const parsed = parseGprText(opts.gprText);
    const projectName = parsed.projectName?.trim() || path.basename(path.dirname(opts.gprPath));

    for (const source of parsed.sources) {
        if (pathKey(sourceAbsolutePath(opts.gprPath, source.path)) !== wanted) { continue; }
        return {
            kind: 'direct-source',
            projectName,
            controllerProject: projectName,
            file: normalizeBreakpointFile(source.path),
            line: opts.line,
            localPath,
        };
    }

    const graph = buildLibraryGraph(opts.gprPath, opts.gprText, opts);
    const rootKey = pathKey(graph.rootDir);
    for (const node of graph.nodes.values()) {
        if (pathKey(node.dir) === rootKey) { continue; }
        if (!node.sources.some(source => pathKey(source) === wanted)) { continue; }
        // 제어기가 아는 이름은 ProjectName 이 아니라 ProjectLibrary 값(= /GPL 바로 아래 폴더 이름)이다(머리 주석 실측).
        const ref = libraryRefOf(graph, node) ?? path.basename(node.dir);
        const segments = libraryRefSegments(ref);
        if (segments.length > 1) {
            return {
                kind: 'library-source',
                projectName,
                controllerProject: ref,
                line: opts.line,
                localPath,
                libraryName: ref,
                nestedLibraryRef: ref,
                message: nestedLibraryBreakpointMessage(ref, path.basename(localPath)),
            };
        }
        const libraryName = segments[0] ?? path.basename(node.dir);
        return {
            kind: 'library-source',
            projectName,
            controllerProject: libraryName,
            file: declaredSourceNotation(node, localPath, opts.readText ?? (file => fs.readFileSync(file, 'utf8'))),
            line: opts.line,
            localPath,
            libraryName,
        };
    }

    return {
        kind: 'outside-project',
        projectName,
        controllerProject: projectName,
        line: opts.line,
        localPath,
        message: `${path.basename(localPath)}은 ${projectName}의 ProjectSource도, ProjectLibrary로 참조된 프로젝트의 소스도 아니라 제어기 중단점 대상이 아닙니다.`,
    };
}

/** `Set Break`/`Set Nobreak`에 실을 프로젝트·파일 — 보낼 수 없는 위치(`outside-project`)면 `undefined`. */
export function breakpointSendTarget(
    target: ResolvedBreakpointTarget | undefined,
): { project: string; file: string } | undefined {
    if (!target || target.kind === 'outside-project' || !target.file) { return undefined; }
    return { project: target.controllerProject, file: target.file };
}

/**
 * 컴파일 단위가 `ProjectLibrary`로 끌어오는 프로젝트들의 **제어기 이름**(루트 제외, 선언 순서) — `ProjectLibrary` 값이 낱말 하나인 것만.
 * `ProjectName` 이 아니다(머리 주석 실측). 중첩 값은 `listNestedLibraryRefs` 가 따로 준다.
 */
export function listLibraryProjectNames(
    gprPath: string,
    gprText: string,
    opts: ResolveLibraryOptions = {},
): string[] {
    return libraryRefs(gprPath, gprText, opts).filter(ref => libraryRefSegments(ref).length === 1);
}

/** 중첩 라이브러리의 `ProjectLibrary` 값(구분자를 `/` 로 통일) — 이 접두어로 시작하는 위치에는 중단점을 걸 수 없다. */
export function listNestedLibraryRefs(
    gprPath: string,
    gprText: string,
    opts: ResolveLibraryOptions = {},
): string[] {
    return libraryRefs(gprPath, gprText, opts)
        .map(ref => libraryRefSegments(ref))
        .filter(segments => segments.length > 1)
        .map(segments => segments.join('/'));
}

function libraryRefs(gprPath: string, gprText: string, opts: ResolveLibraryOptions): string[] {
    const graph = buildLibraryGraph(gprPath, gprText, opts);
    const rootKey = pathKey(graph.rootDir);
    const refs: string[] = [];
    for (const node of graph.nodes.values()) {
        if (pathKey(node.dir) === rootKey) { continue; }
        const ref = libraryRefOf(graph, node) ?? path.basename(node.dir);
        if (!refs.some(r => r.toLowerCase() === ref.toLowerCase())) { refs.push(ref); }
    }
    return refs;
}
