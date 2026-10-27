/**
 * 의존 목록을 늘어놓을 **컴파일 순서** — Project.gpr 의 ProjectSource 순서(아래 계층이 먼저).
 *
 * 파일을 소유한 가장 가까운 `.gpr` 이 순서를 다 갖고 있지는 않다. 리프 패키지 `.gpr`(Lib\Motion\System)은 자기 소스
 * 둘만 나열하고 의존은 ProjectLibrary 로 적으며, 실제 컴파일 목록은 위쪽 루트 `.gpr`(BinderR4)이 평탄하게 갖는다.
 * 그래서 파일에서 위로 올라가며 만나는 `.gpr` 중 **찾는 파일을 가장 많이 나열한 것**을 쓴다(같으면 바깥쪽).
 *
 * 단위 테스트: src/test/project/sources/sourceOrder.test.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { normalizePathKey } from '../../util/pathKey';
import { gprPathInDir, resolveGprSourcePaths } from './projectSources';

export interface SourceOrderOptions {
    /** 위로 올라갈 최대 단계(기본 16) */
    maxLevels?: number;
    readText?: (gprPath: string) => string;
}

/**
 * `filePath` 위쪽 `.gpr` 들 중 `targets` 를 가장 많이 나열한 것의 순서. 어느 `.gpr` 도 나열하지 않으면 늘 undefined.
 */
export function sourceOrderFor(
    filePath: string,
    targets: readonly string[],
    opts: SourceOrderOptions = {},
): (filePath: string) => number | undefined {
    const readText = opts.readText ?? ((p: string) => fs.readFileSync(p, 'utf8'));
    const wanted = new Set(targets.map(normalizePathKey));
    let best: Map<string, number> | undefined;
    let bestHits = 0;
    let dir = path.dirname(path.resolve(filePath));
    for (let level = 0; level < (opts.maxLevels ?? 16); level++) {
        const gpr = gprPathInDir(dir);
        if (gpr) {
            let sources: string[] = [];
            try { sources = resolveGprSourcePaths(gpr, readText(gpr)); } catch { /* 읽을 수 없는 .gpr 은 건너뛴다 */ }
            const order = new Map(sources.map((p, i) => [normalizePathKey(p), i]));
            let hits = 0;
            for (const key of wanted) { if (order.has(key)) { hits++; } }
            if (hits > 0 && hits >= bestHits) { best = order; bestHits = hits; }
        }
        const parent = path.dirname(dir);
        if (parent === dir) { break; }
        dir = parent;
    }
    return p => best?.get(normalizePathKey(p));
}
