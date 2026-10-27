/**
 * 같은 베이스네임 소스 파일 후보 선택.
 *
 * 책임: 제어기가 준 파일명과 충돌하는 로컬 파일 중 디버그 소스 매핑 대상 결정(순수 함수).
 * `responseParser.ts` 에서 응답 종류별로 분리했다(2026-10-27) — 함수 본문은 그대로 옮겼고,
 * 기존 import 경로는 `responseParser.ts` 배럴이 유지한다.
 */

import * as path from 'path';
import { isPathUnder } from './protocolText';

/** pickSourceCandidate 결과. */
export interface SourceCandidatePick {
    /** 선택된 경로 */
    path: string;
    /**
     * 선택 근거가 약한(임의 tie-break) 경합 후보들 — 비어 있지 않으면 호출자가 경고 로그로
     * 후보 목록을 노출해 사용자가 워크스페이스/launch.json을 정리하게 안내한다.
     */
    ambiguous: string[];
}

/**
 * 같은 베이스네임의 소스 파일 후보 중 디버그 소스 매핑 대상을 결정한다(순수 함수).
 *
 * 배경: 워크스페이스에 프로젝트 폴더가 여러 개(사본/백업 포함)면 제어기가 주는
 * 파일명(베이스네임)이 여러 로컬 파일과 충돌한다. 기존에는 스캔 순서상 마지막 파일이
 * 조용히 이겨 정지 시 엉뚱한 폴더의 파일이 열렸다.
 *
 * 우선순위: ① 대상 프로젝트 `.gpr`의 `ProjectSource` 목록에 실제로 들어 있는 파일 →
 * ② 대상 프로젝트 폴더(.gpr 위치) 하위 → ③ 더 얕은 경로(사본은 대개 하위/별도 폴더에 있음) →
 * ④ 경로 사전순(결정적).
 *
 * ①이 필요한 이유: 제어기는 파일명(basename)만 준다. 프로젝트가 하위 폴더로 나뉜 구조
 * (`ProjectSource="T1\T2\T2.gpl"`)에서 같은 이름의 파일이 여러 폴더에 있으면 "얕은 경로 우선"만으로는
 * 얕은 쪽의 무관한 파일이 이길 수 있다 — 컴파일 집합(.gpr 목록)이 진짜 기준이다.
 */
export function pickSourceCandidate(
    candidates: string[],
    projectDirs: string[],
    projectSourcePaths: readonly string[] = [],
): SourceCandidatePick | undefined {
    if (candidates.length === 0) { return undefined; }
    if (candidates.length === 1) { return { path: candidates[0], ambiguous: [] }; }

    const listed = new Set(projectSourcePaths.map(p => path.resolve(p).toLowerCase()));
    const inGpr = listed.size > 0
        ? candidates.filter(p => listed.has(path.resolve(p).toLowerCase()))
        : [];
    const inProject = candidates.filter(p => projectDirs.some(d => isPathUnder(p, d)));
    const pool = inGpr.length > 0 ? inGpr : (inProject.length > 0 ? inProject : candidates);

    const depth = (p: string) => path.resolve(p).split(/[\\/]/).length;
    const sorted = [...pool].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
    return {
        path: sorted[0],
        // 하나로 좁혀졌으면 확정적 — 후보가 2개 이상 남으면 모호해서 호출자가 경고를 남긴다.
        ambiguous: pool.length > 1 ? sorted.slice(1) : [],
    };
}
