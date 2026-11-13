import type { GPLSymbol } from '../syntax/gplParser';
import type { ReferenceExclusionReason } from './referenceScope';

/**
 * 참조 찾기 verbose 트레이스의 문구 정본 — 줄 서식과 출현별 판정 로그 장부.
 *
 * provider 는 `isTraceVerbose` 로 켜진 채널에만 쓴다. 문구는 사용자·AI 가 로그를 grep 하므로 바이트 단위로 고정한다
 * (한국어 포함 — `referenceTrace.test` 가 고정).
 */

/** verbose 로그에 출현별 판정을 몇 줄까지 남길지 — 넘치면 사유별 집계만 남긴다(로그 폭주 방지, 2026-10-19 보고). */
export const MAX_OCCURRENCE_LOG_LINES = 200;

/** 사용부에서 대상 선언을 복원했을 때의 한 줄. */
export function formatUsageTargetLog(defSymbol: GPLSymbol, defPrecise: boolean): string {
    return `[References] usage → ${defSymbol.kind} ${defSymbol.name} @${defSymbol.filePath.split('\\').pop()}:${defSymbol.line + 1}` +
        ` precise=${defPrecise}`;
}

export interface TargetScopeLogInput {
    word: string;
    qualifier: string | undefined;
    targetModule: string | undefined;
    targetClass: string | undefined;
    targetAccess: string | undefined;
    targetFilePath: string | undefined;
    defSymbol: GPLSymbol | undefined;
    defPrecise: boolean;
}

/** 검색 시작 직전, 확정한 대상 스코프의 한 줄. */
export function formatTargetScopeLog(input: TargetScopeLogInput): string {
    const { word, qualifier, targetModule, targetClass, targetAccess, targetFilePath, defSymbol, defPrecise } = input;
    return `[References] word="${word}" qualifier=${qualifier || 'N/A'} defScope=` +
        `${targetModule || 'N/A'}${targetClass ? '.' + targetClass : ''}` +
        ` access=${targetAccess || 'N/A'} file=${targetFilePath ? targetFilePath.split('\\').pop() : 'N/A'}` +
        (defSymbol ? ` kind=${defSymbol.kind} line=${defSymbol.line + 1} precise=${defPrecise}` : '');
}

export interface WorkspaceCheckLogInput {
    targetInWorkspace: boolean;
    docInWorkspace: boolean;
    hasNonDocumentLocations: boolean;
    targetPath: string;
    docPath: string;
}

export function formatWorkspaceCheckLog(input: WorkspaceCheckLogInput): string {
    return `[References] workspaceCheck: targetInWorkspace=${input.targetInWorkspace}, docInWorkspace=${input.docInWorkspace}, ` +
        `hasNonDocumentLocations=${input.hasNonDocumentLocations}, target=${input.targetPath}, doc=${input.docPath}`;
}

export interface FallbackLogInput {
    origin: string;
    projectDir?: string;
    scannedFiles: number;
    totalFiles: number;
    hits: number;
    unreadableFiles: number;
    elapsedMs: number;
    truncated: boolean;
}

export function formatFallbackLog(input: FallbackLogInput): string {
    return `[References] fallback origin=${input.origin}${input.projectDir ? ` dir=${input.projectDir}` : ''} ` +
        `scanned=${input.scannedFiles}/${input.totalFiles} hits=${input.hits} unreadable=${input.unreadableFiles} ` +
        `elapsed=${input.elapsedMs}ms truncated=${input.truncated}`;
}

export const WORKSPACE_FALLBACK_NOTICE = '[References] Workspace scan returned 0. Falling back to cache-based search.';

/** 출현 하나의 판정 줄 — `where` 는 `파일명:1-기준 줄`. */
export function formatOccurrenceLog(where: string, reason: ReferenceExclusionReason | undefined): string {
    return reason
        ? `[References]   exclude ${where} reason=${reason}`
        : `[References]   hit ${where}`;
}

export interface ResultsLogInput {
    localHits: number;
    workspaceHits: number;
    scopeFallbackHits: number;
    scopeFallbackRan: boolean;
    total: number;
    /** 출현 판정을 적용했는지(`scopeTarget` 이 있는지). */
    scoped: boolean;
    excludedTotal: number;
    exclusionCounts: ReadonlyMap<ReferenceExclusionReason, number>;
    loggedOccurrenceCount: number;
}

export function formatResultsLog(input: ResultsLogInput): string {
    const { excludedTotal, exclusionCounts } = input;
    return `[References] results: local=${input.localHits}, workspace=${input.workspaceHits}, scopeFallback=${input.scopeFallbackHits}, ` +
        `scopeFallbackRan=${input.scopeFallbackRan}, total=${input.total}` +
        (input.scoped
            ? `, excluded=${excludedTotal}` +
                (excludedTotal ? ` (${[...exclusionCounts].map(([r, n]) => `${r}=${n}`).join(', ')})` : '') +
                (input.loggedOccurrenceCount > MAX_OCCURRENCE_LOG_LINES
                    ? ` — 출현 로그 ${MAX_OCCURRENCE_LOG_LINES}줄 이후 생략(${input.loggedOccurrenceCount}건)` : '')
            : '');
}

/**
 * 출현별 판정 로그 장부 — 같은 출현을 두 번 남기지 않고(여러 검색 패턴이 같은 자리를 칠 수 있다),
 * 줄 수 상한을 넘기면 사유별 집계만 센다.
 */
export class OccurrenceTrace {
    readonly exclusionCounts = new Map<ReferenceExclusionReason, number>();
    private readonly loggedOccurrences = new Set<string>();

    constructor(private readonly log: (message: string) => void) {}

    get loggedCount(): number {
        return this.loggedOccurrences.size;
    }

    get excludedTotal(): number {
        return [...this.exclusionCounts.values()].reduce((a, b) => a + b, 0);
    }

    /** 판정 하나를 장부에 남긴다. `reason` 이 있으면 제외 집계에도 센다(처음 본 출현만). */
    record(key: string, where: string, reason: ReferenceExclusionReason | undefined): void {
        if (reason) {
            if (!this.loggedOccurrences.has(key)) {
                this.exclusionCounts.set(reason, (this.exclusionCounts.get(reason) ?? 0) + 1);
            }
        }
        this.logOccurrence(key, formatOccurrenceLog(where, reason));
    }

    private logOccurrence(key: string, message: string): void {
        if (this.loggedOccurrences.has(key)) {
            return;
        }
        this.loggedOccurrences.add(key);
        if (this.loggedOccurrences.size <= MAX_OCCURRENCE_LOG_LINES) {
            this.log(message);
        }
    }
}
