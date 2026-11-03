/**
 * 컴파일 범위의 라이브러리 읽기 — "컴파일 검증 필요" 해제(`compileStale.clearCompiled`)와 라이브러리 표시가 쓴다. vscode 무의존, fs 만.
 *
 * Compile 성공 기록(`CompiledRecord`)에는 프로젝트 폴더만 있다. 그 폴더의 `.gpr` 에서 `ProjectLibrary` 값을 **전이로**
 * (App → Gantry → PaL) 모은다 — 해석 규칙의 정본은 `projectSources.buildLibraryGraph`. 로컬에서 폴더를 찾지 못한 값도
 * 원문 그대로 돌려준다: 제어기는 `/GPL/<값>` 을 컴파일했고, 로컬 해석 실패(형제 배치가 아닌 tools\ 프로브 등)는 그 사실을 바꾸지 않는다.
 */

import * as fs from 'fs';
import { buildLibraryGraph, gprPathInDir } from '../../project/sources/projectSources';
import { parseGpr } from '../protocol/gprParser';

/** 프로젝트 폴더의 `.gpr` 이 함께 컴파일하는 `ProjectLibrary` 값(원문, 전이 포함, 중복 없음). `.gpr` 이 없거나 못 읽으면 []. */
export function readCompiledLibraryValues(projectDir: string): string[] {
    try {
        const gpr = gprPathInDir(projectDir);
        if (!gpr) { return []; }
        const graph = buildLibraryGraph(gpr, fs.readFileSync(gpr, 'utf8'));
        const out: string[] = [];
        const seen = new Set<string>();
        for (const node of graph.nodes.values()) {
            for (const ref of node.refs) {
                const key = ref.raw.toLowerCase();
                if (seen.has(key)) { continue; }
                seen.add(key);
                out.push(ref.raw);
            }
        }
        // 해석 실패한 값은 그래프 노드의 refs 에도 남지만, 루트에서 바로 실패한 값까지 빠짐없이.
        for (const raw of graph.unresolved) {
            if (!seen.has(raw.toLowerCase())) { seen.add(raw.toLowerCase()); out.push(raw); }
        }
        return out;
    } catch {
        return [];
    }
}

/**
 * ProjectStart 없는 라이브러리(그룹) 프로젝트인가 — `.gpr` 이 있고 `ProjectStart` 가 비었으면 true, 있으면 false,
 * `.gpr` 이 없거나 못 읽으면 undefined(모름). runnable 판정 규칙은 `projectTarget`(§21)과 같다.
 */
export function isLibraryProjectDir(projectDir: string): boolean | undefined {
    try {
        const gpr = gprPathInDir(projectDir);
        if (!gpr) { return undefined; }
        return !parseGpr(fs.readFileSync(gpr, 'utf8')).projectStart.trim();
    } catch {
        return undefined;
    }
}
