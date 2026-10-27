/**
 * 컴파일러가 보고한 파일명 → 로컬 절대경로 해석과, 그 줄의 소스를 읽는 리더(순수, fs 만 사용).
 * 2026-10-27 `deployService.ts` 에서 분리 — 단계 모듈(컴파일 에러 트레이스)과 Problems 진단(`applyCompileDiagnostics`)이
 * 오케스트레이터를 import 하지 않고 같은 해석을 쓰게 한다. `deployService` 가 `resolveErrorFilePath` 를 re-export 한다.
 */

import * as path from 'path';
import * as fs from 'fs';
import { ancestorRelativePathCandidates } from '../../project/sources/projectSources';

/**
 * 컴파일러가 보고한 파일명을 로컬 절대경로로 해석한다.
 * 1) 절대경로면 그대로, 2) projectDir 바로 아래에 있으면 그 경로,
 * 3) 못 찾으면 projectDir 하위에서 동일 파일명을 한 번 탐색(최선 노력),
 * 4) 그래도 없으면 projectDir 기준 경로를 반환(진단은 Problems 패널에 표시됨).
 */
export function resolveErrorFilePath(file: string, projectDir: string): string {
    if (path.isAbsolute(file)) {
        return file;
    }
    const candidates = ancestorRelativePathCandidates(projectDir, file);
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) { return candidate; }
    }
    const direct = candidates[0] ?? path.join(projectDir, file);
    try {
        const base = path.basename(file);
        const stack = [projectDir];
        while (stack.length > 0) {
            const dir = stack.pop()!;
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                if (entry.isDirectory()) {
                    if (entry.name === 'node_modules' || entry.name === '.git') { continue; }
                    stack.push(path.join(dir, entry.name));
                } else if (entry.name.toLowerCase() === base.toLowerCase()) {
                    return path.join(dir, entry.name);
                }
            }
        }
    } catch {
        // 탐색 실패는 무시하고 기본 경로 사용
    }
    return direct;
}

/**
 * 컴파일 에러가 가리키는 로컬 소스 줄(1-기준)을 읽는 함수 — 파일마다 한 번만 읽는다. 못 읽으면 undefined.
 * 컴파일은 업로드한(저장된) 파일을 대상으로 하므로 디스크 내용을 본다. 판정에 쓰는 것은 ASCII 패턴뿐이라 latin1 로 읽는다.
 */
export function createCompileSourceLineReader(projectDir: string): (file: string, line: number) => string | undefined {
    const cache = new Map<string, string[] | undefined>();
    return (file, line) => {
        const filePath = resolveErrorFilePath(file, projectDir);
        if (!cache.has(filePath)) {
            try {
                cache.set(filePath, fs.readFileSync(filePath, 'latin1').split('\n'));
            } catch {
                cache.set(filePath, undefined);
            }
        }
        return cache.get(filePath)?.[line - 1];
    };
}
