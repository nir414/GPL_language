import * as assert from 'assert';
import { test } from '../../harness';
import type { GPLSymbol } from '../../../language/syntax/gplParser';
import {
    formatFallbackLog,
    formatOccurrenceLog,
    formatResultsLog,
    formatTargetScopeLog,
    formatUsageTargetLog,
    formatWorkspaceCheckLog,
    MAX_OCCURRENCE_LOG_LINES,
    OccurrenceTrace,
    WORKSPACE_FALLBACK_NOTICE,
} from '../../../language/analysis/referenceTrace';

const fn = { kind: 'function', name: 'Scale', line: 1, filePath: 'C:\\proj\\Util.gpl' } as GPLSymbol;

test('참조 트레이스: 사용부·대상 스코프 줄은 기존 문구 그대로(1-기준 줄, 파일명만)', () => {
    assert.strictEqual(formatUsageTargetLog(fn, true), '[References] usage → function Scale @Util.gpl:2 precise=true');
    assert.strictEqual(
        formatTargetScopeLog({
            word: 'Scale', qualifier: 'Util', targetModule: 'Util', targetClass: undefined, targetAccess: 'public',
            targetFilePath: 'C:\\proj\\Util.gpl', defSymbol: fn, defPrecise: true,
        }),
        '[References] word="Scale" qualifier=Util defScope=Util access=public file=Util.gpl kind=function line=2 precise=true');
    assert.strictEqual(
        formatTargetScopeLog({
            word: 'Start', qualifier: undefined, targetModule: 'PumpMod', targetClass: 'Pump', targetAccess: undefined,
            targetFilePath: undefined, defSymbol: undefined, defPrecise: false,
        }),
        '[References] word="Start" qualifier=N/A defScope=PumpMod.Pump access=N/A file=N/A');
    assert.strictEqual(
        formatTargetScopeLog({
            word: 'x', qualifier: undefined, targetModule: undefined, targetClass: undefined, targetAccess: undefined,
            targetFilePath: undefined, defSymbol: undefined, defPrecise: false,
        }),
        '[References] word="x" qualifier=N/A defScope=N/A access=N/A file=N/A');
});

test('참조 트레이스: workspaceCheck·fallback·notice 문구', () => {
    assert.strictEqual(
        formatWorkspaceCheckLog({
            targetInWorkspace: false, docInWorkspace: true, hasNonDocumentLocations: false,
            targetPath: 'C:\\a.gpl', docPath: 'C:\\b.gpl',
        }),
        '[References] workspaceCheck: targetInWorkspace=false, docInWorkspace=true, hasNonDocumentLocations=false, target=C:\\a.gpl, doc=C:\\b.gpl');
    assert.strictEqual(
        formatFallbackLog({
            origin: 'project', projectDir: 'C:\\proj', scannedFiles: 2, totalFiles: 3, hits: 1, unreadableFiles: 0,
            elapsedMs: 12, truncated: false,
        }),
        '[References] fallback origin=project dir=C:\\proj scanned=2/3 hits=1 unreadable=0 elapsed=12ms truncated=false');
    assert.strictEqual(
        formatFallbackLog({
            origin: 'folder', scannedFiles: 0, totalFiles: 0, hits: 0, unreadableFiles: 1, elapsedMs: 0, truncated: true,
        }),
        '[References] fallback origin=folder scanned=0/0 hits=0 unreadable=1 elapsed=0ms truncated=true');
    assert.strictEqual(WORKSPACE_FALLBACK_NOTICE, '[References] Workspace scan returned 0. Falling back to cache-based search.');
});

test('참조 트레이스: 출현 판정 줄', () => {
    assert.strictEqual(formatOccurrenceLog('Main.gpl:7', undefined), '[References]   hit Main.gpl:7');
    assert.strictEqual(formatOccurrenceLog('Main.gpl:13', 'shadowed-by-local'), '[References]   exclude Main.gpl:13 reason=shadowed-by-local');
});

test('참조 트레이스: 결과 요약 — 출현 판정이 없으면 excluded 를 붙이지 않는다', () => {
    const base = {
        localHits: 2, workspaceHits: 0, scopeFallbackHits: 1, scopeFallbackRan: true, total: 3,
        excludedTotal: 0, exclusionCounts: new Map(), loggedOccurrenceCount: 0,
    };
    assert.strictEqual(
        formatResultsLog({ ...base, scoped: false }),
        '[References] results: local=2, workspace=0, scopeFallback=1, scopeFallbackRan=true, total=3');
    assert.strictEqual(
        formatResultsLog({ ...base, scoped: true }),
        '[References] results: local=2, workspace=0, scopeFallback=1, scopeFallbackRan=true, total=3, excluded=0');
    assert.strictEqual(
        formatResultsLog({
            ...base, scoped: true, excludedTotal: 4,
            exclusionCounts: new Map([['shadowed-by-local', 3], ['other-module-decl', 1]] as const),
        }),
        '[References] results: local=2, workspace=0, scopeFallback=1, scopeFallbackRan=true, total=3, excluded=4 (shadowed-by-local=3, other-module-decl=1)');
});

test('참조 트레이스: 결과 요약 — 출현 로그 상한을 넘기면 생략 안내(한국어 문구 고정)', () => {
    const line = formatResultsLog({
        localHits: 0, workspaceHits: 0, scopeFallbackHits: 0, scopeFallbackRan: false, total: 0, scoped: true,
        excludedTotal: 0, exclusionCounts: new Map(), loggedOccurrenceCount: MAX_OCCURRENCE_LOG_LINES + 5,
    });
    assert.strictEqual(
        line,
        `[References] results: local=0, workspace=0, scopeFallback=0, scopeFallbackRan=false, total=0, excluded=0 — 출현 로그 200줄 이후 생략(205건)`);
    assert.strictEqual(MAX_OCCURRENCE_LOG_LINES, 200);
});

test('참조 트레이스: 장부는 같은 출현을 한 번만 남기고 제외 사유를 처음 본 출현만 센다', () => {
    const out: string[] = [];
    const trace = new OccurrenceTrace(m => out.push(m));
    trace.record('k1', 'A.gpl:1', undefined);
    trace.record('k1', 'A.gpl:1', undefined);
    trace.record('k2', 'A.gpl:2', 'shadowed-by-local');
    trace.record('k2', 'A.gpl:2', 'shadowed-by-local');
    trace.record('k3', 'A.gpl:3', 'other-module-decl');
    assert.deepStrictEqual(out, [
        '[References]   hit A.gpl:1',
        '[References]   exclude A.gpl:2 reason=shadowed-by-local',
        '[References]   exclude A.gpl:3 reason=other-module-decl',
    ]);
    assert.strictEqual(trace.excludedTotal, 2);
    assert.deepStrictEqual([...trace.exclusionCounts], [['shadowed-by-local', 1], ['other-module-decl', 1]]);
    assert.strictEqual(trace.loggedCount, 3);
});

test('참조 트레이스: 장부는 상한 이후 줄을 쓰지 않지만 제외 집계와 개수는 계속 센다', () => {
    const out: string[] = [];
    const trace = new OccurrenceTrace(m => out.push(m));
    for (let i = 0; i < MAX_OCCURRENCE_LOG_LINES + 10; i++) {
        trace.record(`k${i}`, `A.gpl:${i}`, i % 2 ? 'ambiguous-unqualified' : undefined);
    }
    assert.strictEqual(out.length, MAX_OCCURRENCE_LOG_LINES);
    assert.strictEqual(trace.loggedCount, MAX_OCCURRENCE_LOG_LINES + 10);
    assert.strictEqual(trace.excludedTotal, (MAX_OCCURRENCE_LOG_LINES + 10) / 2);
});
