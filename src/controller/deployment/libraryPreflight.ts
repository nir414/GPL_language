/**
 * 배포 전 라이브러리 검사(preflight) 판정 — 순수 모듈. 라이브러리마다 폴더·`Project.gpr` 존재, SVN externals 와 작업 사본의 어긋남(고정 드리프트),
 * 커밋하지 않은 로컬 변경, 이전 업로드 출처와 이번 로컬 출처의 일치 여부를 가른다. 수집(svn·fs)은 호출측(`libraryPreflightStage.ts`).
 *
 * 왜(2026-11-12 Sample Prep 수신함 v2 §3): 공용 테스트 제어기에서 `/GPL/PaL` 이름은 하나뿐이라 장비마다 라이브러리 버전이 다르면 나중에 배포한 쪽만 남고,
 * `Start -compile` 은 다시 배포하지 않고도 다른 버전 라이브러리로 컴파일한다. SVN 실측의 함정(S2·S4·S6·S9)은 로컬 상태만 보고 배포 시점에 잡을 수 있다.
 *
 * 방침: **기본은 경고만** 하고 막지 않는다(메모리 사전 검사와 같다, 2026-10-26). 막을 항목은 설정 `gpl.deploy.libraryPreflight.blockOn` 으로 프로젝트가 정한다.
 * **확인 불가(`unknown`)는 일치로 다루지 않는다** — 기록 없음·다른 도구로 올림·로컬 변경이 있어 같은 revision 이어도 내용을 보증할 수 없는 경우다.
 */

import type { LibraryProvenance } from './libraryProvenance';
import type { LibraryVcsInfo } from './libraryVcs';

export type LibraryIssue = 'missing' | 'pinnedDrift' | 'modified' | 'uploadMismatch';
export const LIBRARY_ISSUES: readonly LibraryIssue[] = ['missing', 'pinnedDrift', 'modified', 'uploadMismatch'];
export type PreviousUploadState = 'match' | 'mismatch' | 'unknown';
export type LibraryPreflightStatus = 'ok' | 'warn' | 'mismatch' | 'fail';

export interface LibraryPreflightInput {
    name: string;
    localPath: string;
    folderExists: boolean;
    /** 폴더 안에 `.gpr` 이 있는가. */
    gprExists: boolean;
    vcs: LibraryVcsInfo | null;
    /** 원격 폴더에 마지막으로 올린 출처(이 확장의 기록). 없으면 undefined. */
    previous?: LibraryProvenance;
}

export interface LibraryPreflightEntry {
    name: string;
    localPath: string;
    status: LibraryPreflightStatus;
    issues: LibraryIssue[];
    previousUpload: PreviousUploadState;
    /** 사람이 읽는 사유 문장들(경고·막힘 안내에 그대로 쓴다). */
    notes: string[];
    /** 고정 드리프트의 기대·실제(있을 때). */
    drift?: { expected: string; actual: string };
    /** 커밋하지 않은 변경(있을 때) — 파일 목록은 앞쪽 일부. */
    modified?: { count: number; files: string[] };
}

function sameOrigin(a: { url: string; revision: number }, b: { url: string; revision: number }): boolean {
    return a.url === b.url && a.revision === b.revision;
}

export function judgeLibrary(input: LibraryPreflightInput): LibraryPreflightEntry {
    const issues: LibraryIssue[] = [];
    const notes: string[] = [];
    const entry: LibraryPreflightEntry = {
        name: input.name, localPath: input.localPath, status: 'ok', issues, previousUpload: 'unknown', notes,
    };
    if (!input.folderExists || !input.gprExists) {
        issues.push('missing');
        notes.push(!input.folderExists
            ? `라이브러리 폴더가 없습니다(${input.localPath}) — svn:externals 가 받아지지 않았을 수 있습니다(update 경고만 나고 진행됨).`
            : `라이브러리 폴더에 Project.gpr 이 없습니다(${input.localPath}).`);
        entry.status = 'fail';
        return entry;
    }

    const vcs = input.vcs;
    if (!vcs) {
        notes.push('SVN 출처를 확인하지 못했습니다(svn 없음·작업 사본 아님·실행 실패) — 출처 대조 없이 진행합니다.');
    } else {
        const urlDrift = vcs.expectedUrl !== undefined && vcs.expectedUrl !== vcs.url;
        const revDrift = vcs.mode === 'pinned' && vcs.peg !== undefined && vcs.peg !== vcs.revision;
        if (urlDrift || revDrift) {
            issues.push('pinnedDrift');
            entry.drift = {
                expected: `${vcs.expectedUrl ?? vcs.url}${vcs.peg !== undefined ? `@${vcs.peg}` : ''}`,
                actual: `${vcs.url}@${vcs.revision}`,
            };
            notes.push(`externals 가 ${entry.drift.expected} 를 가리키는데 작업 사본은 ${entry.drift.actual} 입니다`
                + `${revDrift ? ' — 고정 폴더 안의 svn update 는 HEAD 로 올립니다(상위 폴더에서 update 하면 고정 revision 으로 돌아옵니다)' : ''}.`);
        }
        if (vcs.modifiedFiles > 0) {
            issues.push('modified');
            entry.modified = { count: vcs.modifiedFiles, files: vcs.modified ?? [] };
            notes.push(`커밋하지 않은 로컬 변경 ${vcs.modifiedFiles}개${entry.modified.files.length > 0 ? `: ${entry.modified.files.slice(0, 5).join(', ')}${vcs.modifiedFiles > 5 ? ' …' : ''}` : ''}`
                + `${vcs.mode === 'pinned' ? ' — 고정 external 의 변경은 svn commit --include-externals 에서도 조용히 빠집니다' : ''}.`);
        } else if (vcs.statusUnknown) {
            // 실패·시간 초과를 "변경 없음"으로 읽지 않는다 — 막지는 않되(모르는 것을 문제로 단정하지 않음) 확인하지 못했다고 남긴다.
            notes.push('커밋하지 않은 로컬 변경이 있는지 확인하지 못했습니다(svn status 실패 또는 시간 초과).');
        }
    }

    const prev = input.previous?.vcs;
    if (!input.previous || !prev || !vcs) {
        entry.previousUpload = 'unknown';
    } else if (!sameOrigin(prev, vcs)) {
        entry.previousUpload = 'mismatch';
        issues.push('uploadMismatch');
        notes.push(`원격에 마지막으로 올린 출처(${prev.url}@${prev.revision})와 이번 로컬(${vcs.url}@${vcs.revision})이 다릅니다.`);
    } else if (prev.modifiedFiles > 0 || vcs.modifiedFiles > 0 || vcs.statusUnknown) {
        entry.previousUpload = 'unknown';
    } else {
        entry.previousUpload = 'match';
    }

    entry.status = issues.includes('pinnedDrift') || issues.includes('uploadMismatch') ? 'mismatch' : issues.includes('modified') ? 'warn' : 'ok';
    return entry;
}

export interface LibraryPreflightSetting { blockOn: LibraryIssue[] }

/** 설정 `gpl.deploy.libraryPreflight` 해석 — `{ blockOn: [...] }`. 모르는 값은 무시한다(막지 않는 쪽). */
export function resolveLibraryPreflightSetting(raw: unknown): LibraryPreflightSetting {
    const blockOn: LibraryIssue[] = [];
    const list = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>).blockOn : undefined;
    if (Array.isArray(list)) {
        for (const v of list) {
            const hit = typeof v === 'string' ? LIBRARY_ISSUES.find(i => i.toLowerCase() === v.trim().toLowerCase()) : undefined;
            if (hit && !blockOn.includes(hit)) { blockOn.push(hit); }
        }
    }
    return { blockOn };
}

export interface LibraryPreflightResult {
    libraries: LibraryPreflightEntry[];
    /** 설정이 막은 항목이 있으면 그 사유. 없으면 undefined(경고만). */
    blocked?: { on: LibraryIssue[]; reasons: string[] };
}

export function evaluatePreflight(entries: LibraryPreflightEntry[], setting: LibraryPreflightSetting): LibraryPreflightResult {
    const on = new Set<LibraryIssue>();
    const reasons: string[] = [];
    for (const e of entries) {
        for (const issue of e.issues) {
            if (!setting.blockOn.includes(issue)) { continue; }
            on.add(issue);
        }
        if (e.issues.some(i => setting.blockOn.includes(i))) { reasons.push(`${e.name}: ${e.notes.join(' ')}`); }
    }
    return { libraries: entries, ...(on.size > 0 ? { blocked: { on: [...on], reasons } } : {}) };
}

/** 경고 문장(결과 `precheckWarnings`·트레이스) — 문제 없고 이전 업로드가 일치하면 undefined. */
export function preflightWarning(e: LibraryPreflightEntry): string | undefined {
    if (e.issues.length === 0) { return undefined; }
    return `라이브러리 ${e.name}: ${e.notes.join(' ')}`;
}
