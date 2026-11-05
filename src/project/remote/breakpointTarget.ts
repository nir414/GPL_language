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
 */

import * as path from 'path';
import { buildLibraryGraph, ResolveLibraryOptions } from '../sources/projectSources';
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
        const libraryName = node.projectName || path.basename(node.dir);
        return {
            kind: 'library-source',
            projectName,
            controllerProject: libraryName,
            file: normalizeBreakpointFile(path.relative(node.dir, path.resolve(localPath))),
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

/** 컴파일 단위가 `ProjectLibrary`로 끌어오는 프로젝트들의 `ProjectName`(루트 제외, 선언 순서). */
export function listLibraryProjectNames(
    gprPath: string,
    gprText: string,
    opts: ResolveLibraryOptions = {},
): string[] {
    const graph = buildLibraryGraph(gprPath, gprText, opts);
    const rootKey = pathKey(graph.rootDir);
    const names: string[] = [];
    for (const node of graph.nodes.values()) {
        if (pathKey(node.dir) === rootKey) { continue; }
        const name = node.projectName || path.basename(node.dir);
        if (!names.some(n => n.toLowerCase() === name.toLowerCase())) { names.push(name); }
    }
    return names;
}
