/**
 * "이 파일과 같은 프로젝트에 속한 소스 파일들" — vscode 진입점 (순수 로직은 projectSources.ts).
 *
 * 참조 검색·심볼 인덱싱이 공유한다. 종전에는 각자 판단해서
 *   - 심볼 인덱싱: 워크스페이스 Project.gpr 의 `ProjectSource`(하위 폴더 OK)
 *   - 참조 검색 폴백: 현재 파일과 **같은 폴더의 형제 파일만**(하위 폴더 누락)
 * 로 갈라져 있었다. 여기서 한 가지 규칙으로 모은다.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
    DEFAULT_SOURCE_EXTENSIONS,
    collectProjectSourcePaths,
    collectRelatedGprPaths,
    findNearestGprOnDisk,
    pickOwningGprPath,
} from './projectSources';

/**
 * `.gpr`/소스 탐색에서 제외할 경로 — `.history`(Local History 확장)의 stale 사본이
 * 프로젝트·소스 오인식을 유발하므로 `findProjectDirs`와 같은 목록을 쓴다.
 */
export const PROJECT_EXCLUDE_GLOB =
    '{**/node_modules/**,**/bin/**,**/.git/**,**/.history/**,**/dist/**,**/out/**}';

/** 워크스페이스의 모든 `.gpr` 경로(제외 규칙 적용). */
export async function findWorkspaceGprPaths(): Promise<string[]> {
    try {
        const uris = await vscode.workspace.findFiles('**/*.gpr', PROJECT_EXCLUDE_GLOB);
        return uris.map(u => u.fsPath);
    } catch {
        return [];
    }
}

export interface ProjectFileScope {
    /**
     * `project`: 소유 프로젝트(.gpr)를 찾아 그 폴더로 범위를 정했다.
     * `workspace`: .gpr를 못 찾아 워크스페이스 전체 glob으로 범위를 정했다.
     */
    origin: 'project' | 'workspace';
    /** origin='project'일 때 프로젝트 폴더 */
    projectDir?: string;
    /** origin='project'일 때 기준 .gpr */
    gprPath?: string;
    /**
     * 범위에 함께 들어간 `.gpr` 전체 — `[기준 .gpr, 참조 라이브러리…, 이 프로젝트를 참조하는 프로젝트…]`.
     * 길이가 1보다 크면 라이브러리 관계 때문에 범위가 넓어졌다는 뜻이다(호출측 로그용).
     */
    relatedGprPaths?: string[];
    /** 스캔 대상 파일(중복 없음, 존재하는 파일만) */
    files: vscode.Uri[];
    /** 상한에 걸려 일부를 제외했는가 — 호출측이 로그로 알려야 한다(조용한 절단 금지) */
    truncated: boolean;
}

export interface ProjectFileScopeOptions {
    extensions?: readonly string[];
    /** 안전 상한. 기본 1000. */
    maxFiles?: number;
}

/**
 * `seedPath`(현재 문서 또는 정의 파일)와 같은 프로젝트의 소스 파일 집합을 만든다.
 *
 * ① 워크스페이스 `.gpr` 중 이 파일을 포함하는 가장 가까운 것 → ② 워크스페이스 밖이면 디스크에서
 * 위로 올라가며 `.gpr` 탐색 → ③ 그래도 없으면 워크스페이스 전체 재귀 glob.
 * ①·②는 프로젝트 폴더 **재귀** 스캔 ∪ `.gpr` 목록이라 하위 폴더가 임의 깊이로 중첩돼도 포함된다.
 *
 * ①·②에서는 `ProjectLibrary` 관계도 펼친다(`collectRelatedGprPaths`) — 라이브러리 프로젝트는
 * 폴더가 분리돼 있어도 함께 컴파일되므로, 정의와 호출부가 서로 다른 `.gpr` 폴더에 있을 수 있다.
 * 중첩 프로젝트(`MyProject/MyLibrary/Project.gpr`)의 파일은 **가장 가까운** `.gpr`에 귀속되고,
 * 상위 프로젝트는 라이브러리 참조를 통해 범위에 들어온다.
 */
export async function resolveProjectFileScope(
    seedPath: string,
    opts: ProjectFileScopeOptions = {},
): Promise<ProjectFileScope> {
    const extensions = opts.extensions ?? DEFAULT_SOURCE_EXTENSIONS;
    const maxFiles = opts.maxFiles ?? 1000;

    const gprPaths = await findWorkspaceGprPaths();
    const gprPath = pickOwningGprPath(seedPath, gprPaths) ?? findNearestGprOnDisk(seedPath);

    if (gprPath) {
        try {
            const text = fs.readFileSync(gprPath, 'utf8');
            // 라이브러리 관계까지 펼친다 — 참조된 라이브러리의 파일은 함께 컴파일되고(정의가 거기 있고),
            // 반대로 라이브러리 안의 Public 루틴을 부르는 호출부는 참조하는 프로젝트 쪽에 있다.
            const relatedGprPaths = collectRelatedGprPaths(gprPath, text, { knownGprPaths: gprPaths });

            const files: vscode.Uri[] = [];
            const seen = new Set<string>();
            let truncated = false;
            for (const related of relatedGprPaths) {
                if (files.length >= maxFiles) { truncated = true; break; }
                let relatedText: string;
                try {
                    relatedText = related === gprPath ? text : fs.readFileSync(related, 'utf8');
                } catch {
                    continue; // 읽을 수 없는 .gpr는 건너뛰고 나머지 범위는 유지한다
                }
                const collected = collectProjectSourcePaths(related, relatedText, { extensions, maxFiles });
                truncated = truncated || collected.truncated;
                for (const full of collected.files) {
                    if (files.length >= maxFiles) { truncated = true; break; }
                    const key = full.toLowerCase();
                    if (seen.has(key)) { continue; }
                    try {
                        if (!fs.statSync(full).isFile()) { continue; }
                    } catch {
                        continue; // .gpr에는 있지만 디스크에 없는 항목
                    }
                    seen.add(key);
                    files.push(vscode.Uri.file(full));
                }
            }
            return {
                origin: 'project',
                projectDir: path.dirname(gprPath),
                gprPath,
                relatedGprPaths,
                files,
                truncated,
            };
        } catch {
            // .gpr를 읽을 수 없으면 워크스페이스 폴백으로 내려간다
        }
    }

    const glob = `**/*.{${extensions.map(e => e.replace(/^\./, '')).join(',')}}`;
    try {
        const found = await vscode.workspace.findFiles(glob, PROJECT_EXCLUDE_GLOB, maxFiles + 1);
        return {
            origin: 'workspace',
            files: found.slice(0, maxFiles),
            truncated: found.length > maxFiles,
        };
    } catch {
        return { origin: 'workspace', files: [], truncated: false };
    }
}
