/**
 * Requires 헤더 동기화의 조립부 — 의존 계산(moduleDependencies) + 컴파일 순서(sourceOrder) + 블록 갱신 계획(requiresHeader).
 *
 * vscode 를 import 하지 않는다: 진단 provider(diagnosticProvider — 테스트가 vscode 를 가짜로 바꿔 끼워 싣는다)와
 * 명령·저장 훅(activation/language/requiresHeaderCommands)이 같은 계획을 쓰게 하는 접점이다.
 */
import { collectRequiredFiles, DependencyLookup, orderRequiredFiles, RequiredFile } from '../../language/analysis/moduleDependencies';
import { findRequiresBlock, LineEdit, planRequiresHeader, planRequiresInsertion, RequiresHeaderPlan } from '../../language/documentation/requiresHeader';
import { sourceOrderFor } from '../../project/sources/sourceOrder';
import { buildReceiverContextFromText } from '../intellisense/receiverContext';
import { GPLParser, GPLSymbol, GPLSymbolKind } from '../../language/syntax/gplParser';
import type { ReceiverLookup } from '../../language/analysis/receiverType';

/** 진단 source — 빠른 수정(codeActionProvider)이 이 값으로 고른다. */
export const REQUIRES_HEADER_SOURCE = 'GPL Requires';
export const REQUIRES_HEADER_CODE = 'requires-header-stale';

/** `gpl.requiresHeader.mode` — off: 끔 · check: 다르면 진단(기본) · onSave: 저장할 때 바로 고침. */
export type RequiresHeaderMode = 'off' | 'check' | 'onSave';
export const DEFAULT_REQUIRES_HEADER_MODE: RequiresHeaderMode = 'check';

/** 심볼 원천 — 보통 `SymbolCache`. 전체 인덱싱이 끝나기 전에 계산하면 의존이 통째로 "제거"로 보이므로 준비 여부를 본다. */
export interface RequiresSymbolSource extends DependencyLookup {
    readonly hasIndexed?: boolean;
    readonly isRefreshing?: boolean;
}

export function isRequiresSourceReady(source: RequiresSymbolSource | undefined): source is RequiresSymbolSource {
    return !!source && source.hasIndexed === true && source.isRefreshing !== true;
}

const splitLines = (text: string): string[] => text.split(/\r?\n/);

/**
 * 의존 파일 목록(컴파일 순서). 줄별 수신자 해석은 정의 이동·호버와 같은 조립(receiverContext)을 쓴다.
 *
 * 조립은 **프로시저마다 한 번**이고, 문서 심볼은 모듈 수준 + 그 프로시저의 로컬만 넘긴다. 줄마다 파일 전체 심볼로
 * 조립하면 큰 파일에서 계산이 초 단위가 된다(2026-10-27 BinderR4 드라이런: LeadshineRS.gpl 1.7 s).
 */
export function computeRequiredFiles(text: string, filePath: string, source: DependencyLookup): RequiredFile[] {
    const files = computeFileDependencies(text, filePath, source);
    return orderRequiredFiles(files, sourceOrderFor(filePath, files.map(f => f.filePath)));
}

/** 의존 파일 목록(순서 없음) — 패키지 의존 검사(project/gpr/dependencyCheck)도 같은 계산을 쓴다. */
export function computeFileDependencies(text: string, filePath: string, source: DependencyLookup): RequiredFile[] {
    const lines = splitLines(text);
    const docSymbols = GPLParser.parseDocument(text, filePath, { includeLocals: true, includeParameters: true });
    const moduleLevel = docSymbols.filter(s => !s.isLocal && !s.isParameter);
    const procOfLine: (GPLSymbol | undefined)[] = new Array(lines.length);
    for (const proc of moduleLevel.filter(isProcedure).sort((a, b) => a.line - b.line)) {
        const end = Math.min(proc.endLine ?? lines.length - 1, lines.length - 1);
        for (let i = proc.line; i <= end; i++) { procOfLine[i] = proc; }
    }
    const byProc = new Map<GPLSymbol | undefined, ReceiverLookup>();
    return collectRequiredFiles(text, filePath, source, (line, findAllByName) => {
        const proc = procOfLine[line];
        let lookup = byProc.get(proc);
        if (!lookup) {
            const locals = proc
                ? docSymbols.filter(s => (s.isLocal || s.isParameter) && s.line >= proc.line && s.line <= (proc.endLine ?? lines.length))
                : [];
            lookup = buildReceiverContextFromText(lines, filePath, proc?.line ?? line, findAllByName, [...moduleLevel, ...locals]).lookup;
            byProc.set(proc, lookup);
        }
        return lookup;
    });
}

const isProcedure = (s: GPLSymbol): boolean =>
    s.kind === GPLSymbolKind.Sub || s.kind === GPLSymbolKind.Function || s.kind === GPLSymbolKind.Property;

/** `'Requires:` 블록이 있는 파일의 갱신 계획. 블록이 없으면 undefined — 의존 계산도 하지 않는다. */
export function planRequiresForText(text: string, filePath: string, source: DependencyLookup): RequiresHeaderPlan | undefined {
    const lines = splitLines(text);
    if (!findRequiresBlock(lines)) { return undefined; }
    return planRequiresHeader(lines, computeRequiredFiles(text, filePath, source));
}

/** 블록이 없는 파일에 새로 넣는 편집. 이미 있거나 Module 선언이 없으면 undefined. */
export function planRequiresInsertionForText(text: string, filePath: string, source: DependencyLookup): LineEdit | undefined {
    const lines = splitLines(text);
    if (!planRequiresInsertion(lines, [])) { return undefined; } // 계산 전에 넣을 자리부터 확인한다
    return planRequiresInsertion(lines, computeRequiredFiles(text, filePath, source));
}
