/**
 * Project.gpr 소스 목록 ↔ 프로젝트 폴더 대조 — fs 만 쓰는 순수 모듈(vscode 무의존).
 *
 * 제어기는 `.gpr` 의 `ProjectSource` 목록만 컴파일한다. 폴더에 있어도 목록에 없는 `.gpl` 은 조용히 빠지고, 목록에 있는데
 * 파일이 없으면 Compile 이 실패한다. 그래서 "목록이 폴더와 맞는가" 는 ① 편집기에서 파일이 생기고 지워질 때(자동 반영,
 * `controller/projects/gprSyncCommand.ts`) ② 배포 직전(`deployService` 경고 + 사람 경로의 반영 선택) 두 군데서 같은 계산으로
 * 묻는다(2026-10-27 사용자 요청 "Project.gpr 자동 동기화"). 계산은 여기 한 곳이다.
 *
 * - 폴더 목록은 `listSourceFilesRecursive`(하위 폴더 포함, 자기 `.gpr` 를 가진 중첩 프로젝트는 제외).
 * - 제거 제안은 디스크에 정말 없을 때만(`existsOnDisk`).
 * - 쓰기(`applyGprSync`)는 호출측이 한다 — 여기서는 판단만.
 */

import * as fs from 'fs';
import * as path from 'path';
import { GPR_PATH_SEPARATOR, DEFAULT_SOURCE_EXTENSIONS, listSourceFilesRecursive } from '../sources/projectSources';
import { GprSyncPlan, ParsedGpr, parseGprText, planGprSync } from './gprSync';

export interface GprFolderSyncOptions {
    /** 소스로 볼 확장자(기본 `.gpl`). 설정 `gpl.project.sourceExtensions` 를 호출측이 읽어 넘긴다. */
    extensions?: readonly string[];
    /** 이미 읽어 둔 `.gpr` 본문(없으면 파일에서 읽는다). */
    gprText?: string;
}

export interface GprFolderSyncCheck {
    projectDir: string;
    gprPath: string;
    /** 대조에 쓴 `.gpr` 본문(적용할 때 같은 본문에 편집한다). */
    text: string;
    parsed: ParsedGpr;
    plan: GprSyncPlan;
    /** 폴더에서 찾은 소스(상대 경로, `.gpr` 구분자). */
    files: string[];
    /** 탐색 상한에 걸려 일부가 빠졌는가 — 그러면 "제거" 제안을 믿지 않는다. */
    truncated: boolean;
    /** 경계에서 멈춘 중첩 프로젝트 폴더(절대 경로). */
    nestedProjects: string[];
    /** 추가·제거할 것이 없다. */
    inSync: boolean;
}

/** 설정 값(`gpl.project.sourceExtensions`)을 확장자 목록으로 — 비어 있거나 모양이 다르면 기본값. */
export function sourceExtensionsFrom(raw: unknown): string[] {
    const list = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];
    return list.length > 0 ? list : [...DEFAULT_SOURCE_EXTENSIONS];
}

/** 폴더의 `.gpr` — `Project.gpr` 우선, 없으면 첫 `.gpr`, 없으면 undefined. */
export function findGprFile(projectDir: string): string | undefined {
    try {
        const names = fs.readdirSync(projectDir).filter(f => f.toLowerCase().endsWith('.gpr'));
        const preferred = names.find(f => f.toLowerCase() === 'project.gpr') ?? names[0];
        return preferred ? path.join(projectDir, preferred) : undefined;
    } catch {
        return undefined;
    }
}

/** `.gpr` 항목(상대 경로)이 실제 디스크에 있는지 — 제거 제안은 이 확인을 통과해야 한다. */
export function makeExistsOnDisk(projectDir: string): (relPath: string) => boolean {
    return (relPath: string): boolean => {
        const native = relPath.trim().replace(/[\\/]+/g, path.sep);
        if (!native) { return false; }
        const full = path.isAbsolute(native) ? native : path.join(projectDir, native);
        try {
            return fs.statSync(full).isFile();
        } catch {
            return false;
        }
    };
}

/**
 * 폴더와 `.gpr` 를 대조한다. 탐색이 잘렸으면(`truncated`) 제거 제안을 비운다 — 못 본 파일을 "없다"고 하지 않기 위해.
 */
export function checkGprFolderSync(projectDir: string, gprPath: string, opts: GprFolderSyncOptions = {}): GprFolderSyncCheck {
    const text = opts.gprText ?? fs.readFileSync(gprPath, 'utf8');
    const parsed = parseGprText(text);
    const listed = listSourceFilesRecursive(projectDir, {
        extensions: opts.extensions ?? DEFAULT_SOURCE_EXTENSIONS,
        separator: GPR_PATH_SEPARATOR,
    });
    const raw = planGprSync(parsed, listed.files, { existsOnDisk: makeExistsOnDisk(projectDir) });
    const plan: GprSyncPlan = listed.truncated ? { ...raw, toRemove: [] } : raw;
    return {
        projectDir,
        gprPath,
        text,
        parsed,
        plan,
        files: listed.files,
        truncated: listed.truncated,
        nestedProjects: listed.nestedProjects,
        inSync: plan.toAdd.length === 0 && plan.toRemove.length === 0,
    };
}

/** 사람·AI 문구용 요약 — `추가 2 (A.gpl, Sub\B.gpl) · 제거 1 (Old.gpl)`. 항목은 `maxNames` 개까지 적고 나머지는 수로. */
export function describeGprSyncPlan(plan: GprSyncPlan, maxNames = 5): string {
    const names = (list: readonly string[]): string => {
        const shown = list.slice(0, maxNames).join(', ');
        return list.length > maxNames ? `${shown} 외 ${list.length - maxNames}개` : shown;
    };
    const parts: string[] = [];
    if (plan.toAdd.length > 0) { parts.push(`추가 ${plan.toAdd.length} (${names(plan.toAdd)})`); }
    if (plan.toRemove.length > 0) { parts.push(`제거 ${plan.toRemove.length} (${names(plan.toRemove.map(e => e.path))})`); }
    return parts.length > 0 ? parts.join(' · ') : '변경 없음';
}
