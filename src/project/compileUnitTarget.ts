/**
 * 컴파일 단위(.gpr) 선택 — 제어기가 준 **파일명만**으로 로컬 소스를 역추적할 때 "어느 프로젝트 폴더가
 * 정답인가"를 결정하는 정본. 디버그 어댑터(`gplDebugSession._updateProjectDirs`)와 트리·이벤트 명령
 * (`projectContext.findExpectedProjectDirs`)이 같은 규칙을 쓴다.
 *
 * # 배경 (2026-09-18 실측)
 *
 * 과제별로 같은 이름의 프로젝트(`MergeCode`)를 복제해 두는 작업 배치에서는 **프로젝트명 일치**만으로는
 * `.gpr` 이 3개 이상 잡히고, 그 안의 동명 소스는 경로 깊이·사전순 같은 임의 기준으로 갈린다. 그래서
 * 배포한 것은 `Dilution\…\MergeCode` 인데 SymbolCache 경고는 `Antibody\…`, 디버거 예외 표시는
 * `projects(제거예정)\…` 를 열었다 — `_robot_Robot.gpl` 은 사본마다 줄 수도 내용도 달라 **같은 1260번
 * 줄이 전혀 다른 코드**였다.
 *
 * # 규칙
 *
 * 1. **세션 대상 폴더**(`project_target` 로 고정한 자동화 대상, 사람이 QuickPick 으로 고른 폴더,
 *    F5 launch 의 `projectDir`)에 `.gpr` 이 있고 그 `ProjectName` 이 찾는 프로젝트명과 같으면(또는
 *    프로젝트명을 아직 모르면) **그 하나**로 확정한다. 워크스페이스 스캔은 하지 않는다.
 * 2. 대상 폴더가 없거나 이름이 어긋나면 종전대로 **프로젝트명이 일치하는 `.gpr` 전부**.
 *    (이름이 어긋나는 경우는 `via: 'target-dir-mismatch'` 로 알려 호출자가 경고를 남긴다 —
 *    트리의 기대 프로젝트를 사람이 바꾼 뒤 옛 대상이 남아 있는 상황.)
 * 3. 둘 다 없으면 빈 목록(호출자가 워크스페이스 전체로 떨어진다 — 모를 때 좁히면 소스 이동이
 *    아예 안 되는 퇴보이므로 누락 방지를 우선).
 */

import * as fs from 'fs';
import * as path from 'path';
import { ciEq } from '../language/identifiers';
import { parseGprText } from './gprSync';
import { gprPathInDir } from './projectSources';

/** `.gpr` 하나의 신원 — 경로와 `ProjectName`(없으면 폴더명). */
export interface GprIdentity {
    gprPath: string;
    projectName: string;
}

export type CompileUnitVia =
    /** 세션 대상 폴더의 .gpr 하나로 확정 */
    | 'target-dir'
    /** 프로젝트명 일치 .gpr 전부(대상 폴더 없음) */
    | 'name'
    /** 대상 폴더는 있었지만 프로젝트명이 달라 무시하고 이름 일치로 감 */
    | 'target-dir-mismatch'
    /** 판정 근거 없음 */
    | 'none';

export interface CompileUnitChoice {
    gprPaths: string[];
    via: CompileUnitVia;
}

/**
 * 컴파일 단위의 `.gpr` 목록을 결정한다(순수 함수).
 *
 * @param projectName 찾는 프로젝트명(제어기 쪽 이름). 빈 문자열이면 "아직 모름".
 * @param target 세션 대상 폴더의 `.gpr` 신원(없으면 undefined).
 * @param listKnown 워크스페이스의 `.gpr` 신원 목록 — **대상 폴더로 확정되지 않을 때만** 호출된다
 *   (스캔 비용이 큰 워크스페이스에서 대상이 정해져 있으면 스캔 자체를 건너뛴다).
 */
export function chooseCompileUnitGprs(
    projectName: string,
    target: GprIdentity | undefined,
    listKnown: () => readonly GprIdentity[],
): CompileUnitChoice {
    const want = projectName.trim();
    let via: CompileUnitVia = 'name';

    if (target) {
        if (!want || ciEq(target.projectName, want)) {
            return { gprPaths: [target.gprPath], via: 'target-dir' };
        }
        via = 'target-dir-mismatch';
    }

    if (!want) {
        return { gprPaths: [], via: 'none' };
    }

    const seen = new Set<string>();
    const gprPaths: string[] = [];
    for (const g of listKnown()) {
        if (!ciEq(g.projectName, want)) { continue; }
        const key = path.resolve(g.gprPath).toLowerCase();
        if (seen.has(key)) { continue; }
        seen.add(key);
        gprPaths.push(g.gprPath);
    }
    if (via === 'target-dir-mismatch') { return { gprPaths, via }; }
    return { gprPaths, via: gprPaths.length > 0 ? 'name' : 'none' };
}

/** `.gpr` 파일을 읽어 신원을 만든다. 읽기 실패는 undefined(호출자가 건너뛴다). */
export function readGprIdentity(gprPath: string): GprIdentity | undefined {
    try {
        const text = fs.readFileSync(gprPath, 'utf-8');
        const name = parseGprText(text).projectName?.trim();
        return { gprPath, projectName: name || path.basename(path.dirname(gprPath)) };
    } catch {
        return undefined;
    }
}

/** 프로젝트 **폴더**의 `.gpr` 신원 — 폴더에 `.gpr` 이 없으면 undefined. */
export function readGprIdentityInDir(dir: string | undefined): GprIdentity | undefined {
    if (!dir) { return undefined; }
    const gprPath = gprPathInDir(dir);
    return gprPath ? readGprIdentity(gprPath) : undefined;
}
