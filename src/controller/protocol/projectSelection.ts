/**
 * 디버그 대상 프로젝트 후보 선택.
 *
 * 책임: 여러 Project.gpr 후보 중 활성 파일 신호로 projectName 결정(순수 함수).
 * `responseParser.ts` 에서 응답 종류별로 분리했다(2026-10-27) — 함수 본문은 그대로 옮겼고,
 * 기존 import 경로는 `responseParser.ts` 배럴이 유지한다.
 */

import * as path from 'path';
import { isPathUnder } from './protocolText';

/** 워크스페이스에서 수집한 Project.gpr 후보 하나. */
export interface ProjectCandidate {
    /** .gpr의 ProjectName */
    projectName: string;
    /** Project.gpr 절대 경로 */
    gprPath: string;
    /** ProjectSource 파일들의 소문자 basename 집합 */
    sourceNames: Set<string>;
}

/** selectProjectFromCandidates 결과. */
export interface ProjectSelection {
    projectName: string;
    /** 로그용 선택 근거 */
    reason: string;
    /**
     * true면 결정적이지만 임의적인 tie-break로 골랐다는 뜻(활성 파일 신호 없음 등).
     * 이 경우 launch.json에 projectName을 명시하도록 사용자에게 안내한다.
     */
    ambiguous: boolean;
}


/**
 * 여러 Project.gpr 후보 중 디버그 대상 프로젝트를 결정한다(순수 함수, 단위 테스트 대상).
 *
 * 배경: 기존 로직은 활성 파일의 **basename이 어느 프로젝트의 소스 목록에 있는지**(약한 신호)를
 * **파일이 실제로 어느 프로젝트 폴더 안에 있는지**(강한 신호)보다 우선했다. 서로 다른 프로젝트가
 * `Main.gpl` 같은 흔한 파일명을 공유하면, 실제로 열려 있는 프로젝트가 아니라 이름만 겹치는
 * 다른 프로젝트가 선택되어 `<projectName>`이 오인식되었다. 여기서는 우선순위를 다음으로 바로잡는다.
 *
 *   1) 활성 파일이 어떤 프로젝트 폴더 하위이면서 그 프로젝트 소스이기도 함 (가장 강함)
 *   2) 활성 파일이 물리적으로 포함된 프로젝트 폴더 (가장 깊은/구체적인 것 우선)
 *   3) 폴더 밖에서 연 파일이 정확히 한 프로젝트의 소스명과만 일치
 *   4) 위로 판별 불가 → 결정적 fallback(경로 정렬 첫 후보)이되 ambiguous=true로 표시
 *
 * 또한 stale 사본/중첩 루트로 인한 중복 .gpr는 경로 기준으로 제거하고, 남은 후보가 모두 같은
 * projectName이면 다중이 아니라 단일로 취급한다.
 */
export function selectProjectFromCandidates(
    candidates: ProjectCandidate[],
    activePath: string,
): ProjectSelection | undefined {
    // 동일 .gpr 경로 중복 제거(대소문자 무시). stale 사본·중첩 워크스페이스 대응.
    const seen = new Set<string>();
    const unique: ProjectCandidate[] = [];
    for (const c of candidates) {
        if (!c.projectName) { continue; }
        const key = path.resolve(c.gprPath).toLowerCase();
        if (seen.has(key)) { continue; }
        seen.add(key);
        unique.push(c);
    }

    if (unique.length === 0) { return undefined; }

    // 남은 후보가 모두 같은 프로젝트명이면 .gpr가 여러 개라도 단일 프로젝트로 확정.
    const distinctNames = new Set(unique.map(c => c.projectName.toLowerCase()));
    if (distinctNames.size === 1) {
        return {
            projectName: unique[0].projectName,
            reason: unique.length === 1
                ? `단일 프로젝트 (${unique[0].gprPath})`
                : `단일 프로젝트명 (.gpr ${unique.length}개, 동일 이름)`,
            ambiguous: false,
        };
    }

    // 서로 다른 다중 프로젝트 — 활성 편집 파일로 판별.
    const activeBase = activePath ? path.basename(activePath).toLowerCase() : '';

    const dirMatches = activePath
        ? unique
            .filter(c => isPathUnder(activePath, path.dirname(c.gprPath)))
            .sort((a, b) => path.dirname(b.gprPath).length - path.dirname(a.gprPath).length)
        : [];
    const sourceMatches = activeBase
        ? unique.filter(c => c.sourceNames.has(activeBase))
        : [];

    // 1) 가장 강함: 활성 파일이 프로젝트 폴더 하위이면서 그 프로젝트의 소스이기도 함.
    const bothMatch = dirMatches.find(d => sourceMatches.some(s => s.gprPath === d.gprPath));
    if (bothMatch) {
        return {
            projectName: bothMatch.projectName,
            reason: `활성 파일 위치+소스 일치 (${activeBase})`,
            ambiguous: false,
        };
    }

    // 2) 파일이 물리적으로 들어 있는 폴더가 진실. 중첩 시 가장 깊은(구체적인) 것 우선.
    if (dirMatches.length > 0) {
        return {
            projectName: dirMatches[0].projectName,
            reason: `활성 파일 디렉터리 포함 (${path.basename(path.dirname(dirMatches[0].gprPath))})`,
            ambiguous: false,
        };
    }

    // 3) 어느 프로젝트 폴더 밖에서 연 파일 → 소스명이 정확히 하나와만 일치하면 그것.
    if (sourceMatches.length === 1) {
        return {
            projectName: sourceMatches[0].projectName,
            reason: `활성 파일명 소스 매칭 (${activeBase})`,
            ambiguous: false,
        };
    }
    if (sourceMatches.length > 1) {
        const pick = [...sourceMatches].sort((a, b) => a.gprPath.localeCompare(b.gprPath))[0];
        return {
            projectName: pick.projectName,
            reason: `활성 파일명이 ${sourceMatches.length}개 프로젝트에 존재 — 모호, 기본값 ${pick.projectName}`,
            ambiguous: true,
        };
    }

    // 4) 판별 신호 없음: 결정적 fallback(경로 정렬 첫 후보), ambiguous 표시.
    const pick = [...unique].sort((a, b) => a.gprPath.localeCompare(b.gprPath))[0];
    return {
        projectName: pick.projectName,
        reason: `다중 프로젝트(${unique.length}개), 활성 파일 신호 없음 — 기본값 ${pick.projectName}`,
        ambiguous: true,
    };
}
