/**
 * 로컬 GPL 소스를 제어기 `Set Break`의 파일 identity로 바꾼다.
 *
 * 제어기는 메인 프로젝트가 직접 선언한 `ProjectSource`만 breakpoint lookup 대상으로 삼는다.
 * 따라서 basename이나 디스크 상대 경로를 추측하지 않고 `.gpr` 원문을 기준으로 판정한다.
 */

import * as path from 'path';
import { buildLibraryGraph, ResolveLibraryOptions } from './projectSources';
import { parseGprText } from './gprSync';

export type BreakpointTargetKind = 'direct-source' | 'library-source' | 'outside-project';

export interface ResolvedBreakpointTarget {
    kind: BreakpointTargetKind;
    projectName: string;
    /** direct-source일 때 제어기에 보낼 `ProjectSource` 표기. */
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
 * direct-source만 `file`을 가지므로 호출측은 그 경우에만 명령을 만들면 된다.
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
            line: opts.line,
            localPath,
            libraryName,
            message: `${path.basename(localPath)}은 ProjectLibrary 소스라 제어기가 breakpoint 대상으로 찾지 못합니다(-508). `
                + '"GPL: Promote Source for Breakpoint"를 실행한 뒤 재컴파일하세요.',
        };
    }

    return {
        kind: 'outside-project',
        projectName,
        line: opts.line,
        localPath,
        message: `${path.basename(localPath)}은 ${projectName}의 직접 ProjectSource가 아닙니다.`,
    };
}
