/**
 * 참조 찾기 순수 모듈 테스트의 공용 표본·조립기.
 *
 * 표본 파일 묶음(모듈 한정 참조·수신자 경유 클래스 멤버·로컬에 가려진 이름·주석/문자열 출현)과, vscode 없이
 * `GPLReferenceProvider.provideReferences` 의 순서(대상 복원 → 계획 → 현재 문서 스캔 → 프로젝트 폴백)를 그대로
 * 재현하는 `findReferencesPure` 를 둔다. 기대값은 리팩터링 전 provider(HEAD a4aa1c6 의 referenceProvider.ts)를 providerHarness 로
 * 돌려 얻은 것이다(`referenceScan.test` 에 고정).
 */
import { SymbolIndex } from '../../../language/symbols/symbolIndex';
import { GPL_BUILTIN_RECEIVERS } from '../../../language/dictionary/gplBuiltins';
import { findEnclosingProcedureRange } from '../../../language/syntax/cursorExpression';
import { GPLParser, GPLSymbol } from '../../../language/syntax/gplParser';
import { buildDocumentReceiverLookup } from '../../../language/analysis/receiverType';
import { qualifierBeforeWord } from '../../../language/analysis/referenceCandidates';
import {
    buildReferenceSearchPlan,
    planFileScan,
    ReferenceScanSession,
    ScanFile,
} from '../../../language/analysis/referenceScan';
import { resolveReferenceTargetSymbol } from '../../../language/analysis/referenceTarget';
import {
    formatFallbackLog,
    formatResultsLog,
    formatTargetScopeLog,
    formatWorkspaceCheckLog,
} from '../../../language/analysis/referenceTrace';

/** 표본 파일 묶음 — fsPath → 줄 목록. 모두 한 컴파일 단위. */
export const SAMPLE_LINES: Record<string, string[]> = {
    'C:\\proj\\Util.gpl': [
        'Module Util',
        'Public Function Scale(v As Double) As Double',
        'Scale = v * 2',
        'End Function',
        'Public Sub Run()',
        'Dim r As Double = Scale(2.0)',
        '\' Scale in a comment',
        'LOG.Write("Scale text")',
        'LOG.Invoke("Util.Scale")',
        'End Sub',
        'End Module',
    ],
    'C:\\proj\\Pump.gpl': [
        'Module PumpMod',
        'Public Class Pump',
        'Public Sub Start()',
        'End Sub',
        'Public Sub Cycle()',
        'Start()',
        'Me.Start()',
        'End Sub',
        'End Class',
        'Public Sub Scale()',
        'End Sub',
        'End Module',
    ],
    'C:\\proj\\Main.gpl': [
        'Module App',
        'Public Sub Main()',
        'Dim p As New Pump()',
        'Dim q As Pump',
        'p.Start()',
        'q.Start()',
        'Util.Scale(1.0)',
        'Dim text As String = "p.Start"',
        '\' p.Start commented',
        'End Sub',
        'Public Sub Other()',
        'Dim Scale As Integer',
        'Scale = Scale + 1',
        'End Sub',
        'End Module',
    ],
};

export const SAMPLE_FILES: Record<string, string> = Object.fromEntries(
    Object.entries(SAMPLE_LINES).map(([p, lines]) => [p, lines.join('\n')]));

/** 한 컴파일 단위로 보는 SymbolIndex(`createProviderWorld` 의 심볼 캐시와 같은 구성). */
export function makeSymbolIndex(files: Record<string, string>): SymbolIndex {
    const index = new SymbolIndex({
        narrowCandidates: candidates => candidates,
        scoreFilePath: (candidate, reference) => (candidate === reference ? 100 : 0),
        isSameCompileUnit: () => true,
    });
    for (const [fsPath, text] of Object.entries(files)) {
        index.updateFileText(fsPath, text);
    }
    index.rebuildNameIndex();
    return index;
}

/** `providers/intellisense/receiverContext` 의 조립을 줄 배열로 재현한다(language 계층에서 provider 를 import 할 수 없다). */
export function receiverLookupFromText(
    lines: readonly string[], fsPath: string, line: number,
    findAllByName: (name: string) => GPLSymbol[], docSymbols?: GPLSymbol[],
) {
    const symbols = docSymbols
        ?? GPLParser.parseDocument(lines.join('\n'), fsPath, { includeLocals: true, includeParameters: true });
    const procRange = findEnclosingProcedureRange(i => lines[i] ?? '', lines.length, line);
    return buildDocumentReceiverLookup(symbols, procRange, line, findAllByName, GPL_BUILTIN_RECEIVERS);
}

export interface PureReferenceResult {
    /** `파일명:줄:시작-끝` — 결과 순서 그대로. */
    locations: string[];
    /** provider 가 verbose 채널에 남기는 `[References]` 줄(폴백 소요 시간은 `Xms` 로 고정). */
    logs: string[];
}

const uriKeyOf = (fsPath: string): string => `file:///${fsPath.replace(/\\/g, '/')}`;

/**
 * `provideReferences` 의 vscode 없는 재현 — 워크스페이스 텍스트 검색(제안 API)은 건너뛰고
 * 현재 문서 스캔 뒤 프로젝트 폴백(파일 묶음 순서)을 돈다. 캐시 폴백은 `findReferences` 가 비어 있어 생략.
 */
export function findReferencesPure(
    files: Record<string, string>,
    docPath: string,
    line: number,
    character: number,
    includeDeclaration: boolean,
): PureReferenceResult {
    const symbols = makeSymbolIndex(files);
    const docText = files[docPath];
    const lineText = docText.split('\n')[line];
    const wordMatch = [...lineText.matchAll(/[A-Za-z_]\w*/g)]
        .find(m => character >= m.index! && character <= m.index! + m[0].length)!;
    const word = wordMatch[0];
    const wordStart = wordMatch.index!;
    const wordEnd = wordStart + word.length;
    const logs: string[] = [];
    const log = (m: string) => logs.push(m.replace(/elapsed=\d+ms/, 'elapsed=Xms'));

    const qualifier = qualifierBeforeWord(lineText, wordStart);
    const receiverContext = () => {
        const docSymbols = GPLParser.parseDocument(docText, docPath, { includeLocals: true, includeParameters: true });
        const lines = docText.split('\n');
        return {
            docSymbols,
            lookup: receiverLookupFromText(lines, docPath, line, n => symbols.findAllByName(n), docSymbols),
        };
    };
    const { defSymbol, defPrecise } = resolveReferenceTargetSymbol(symbols, {
        word, qualifier, documentText: docText, documentFsPath: docPath, line, lineText, wordStart, wordEnd,
    }, receiverContext, log);
    const plan = buildReferenceSearchPlan(symbols, { word, qualifier, defSymbol, defPrecise, documentText: docText, documentFsPath: docPath });
    log(formatTargetScopeLog({
        word, qualifier, targetModule: plan.targetModule, targetClass: plan.targetClass,
        targetAccess: plan.targetAccess, targetFilePath: plan.targetFilePath, defSymbol, defPrecise,
    }));

    const session = new ReferenceScanSession(plan, {
        symbols, includeDeclaration, documentFsPath: docPath,
        receiverLookupFromText: (lines, fsPath, ln, findAllByName, docSymbols) =>
            receiverLookupFromText(lines, fsPath, ln, findAllByName, docSymbols),
        log, isCancelled: () => false,
    });
    const scanFile = (fsPath: string, text: string): ScanFile => ({ fsPath, uriKey: uriKeyOf(fsPath), text });

    let localHits = 0;
    let scopeFallbackHits = 0;
    const ctor = session.constructorDeclarationRange();
    if (ctor) {
        session.addSite({
            uriKey: uriKeyOf(ctor.fsPath), fsPath: ctor.fsPath,
            startLine: ctor.line, startCharacter: ctor.start, endLine: ctor.line, endCharacter: ctor.end,
        });
    }
    for (const step of planFileScan(plan, 'local', docPath === plan.targetFilePath)) {
        localHits += session.scanSourceText(scanFile(docPath, docText), new RegExp(step.pattern, 'gi'), { unqualifiedOnly: step.unqualifiedOnly });
    }

    const targetPath = plan.targetFilePath ?? docPath;
    const hasNonDocumentLocations = session.hasNonDocumentSites();
    log(formatWorkspaceCheckLog({
        targetInWorkspace: false, docInWorkspace: false, hasNonDocumentLocations, targetPath, docPath,
    }));
    let scopeFallbackRan = false;
    if (!hasNonDocumentLocations && plan.targetAccess !== 'private') {
        scopeFallbackRan = true;
        let scannedFiles = 0;
        for (const [fsPath, text] of Object.entries(files)) {
            if (fsPath.toLowerCase() === docPath.toLowerCase()) {
                continue;
            }
            scannedFiles++;
            for (const step of planFileScan(plan, 'fallback', fsPath === plan.targetFilePath)) {
                scopeFallbackHits += session.scanSourceText(
                    scanFile(fsPath, text), new RegExp(step.pattern, 'gi'), { unqualifiedOnly: step.unqualifiedOnly });
            }
        }
        log(formatFallbackLog({
            origin: 'project', projectDir: 'C:\\proj', scannedFiles, totalFiles: Object.keys(files).length,
            hits: scopeFallbackHits, unreadableFiles: 0, elapsedMs: 0, truncated: false,
        }));
    }
    log(formatResultsLog({
        localHits, workspaceHits: 0, scopeFallbackHits, scopeFallbackRan, total: session.sites.length,
        scoped: !!plan.scopeTarget, excludedTotal: session.trace.excludedTotal,
        exclusionCounts: session.trace.exclusionCounts, loggedOccurrenceCount: session.trace.loggedCount,
    }));

    return {
        locations: session.sites.map(s =>
            `${s.fsPath.split('\\').pop()}:${s.startLine}:${s.startCharacter}-${s.endCharacter}`),
        logs,
    };
}
