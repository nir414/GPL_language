/**
 * 수신자(receiver) 해석 컨텍스트 — provider 들이 공유하는 **조립부 정본**.
 *
 * 판정 규칙 자체는 vscode 를 모르는 순수 정본 `language/receiverType.ts` 에 있다(SSOT).
 * 하지만 그 입력을 만드는 조립 — 현재 문서를 로컬/파라미터까지 파싱하고, 커서를 감싸는 프로시저
 * 범위를 구하고, 워크스페이스 심볼 조회와 내장 사전 훅을 물리는 네 줄 — 은 hover(2곳)·디버그
 * hover·완성 provider 에 **복제**돼 있었다. 같은 조립이 여러 벌이면 한쪽만 고쳐지는 구현 편차
 * (Implementation Drift)가 생기고, 실제로 완성 provider 는 아예 자체 해석기를 들고 있다가
 * `Thread.CurrentThread().` 뒤를 해석하지 못했다(§1-DO). 그래서 조립도 한 곳으로 모은다.
 *
 * 의존성 주입(DI): 이 모듈은 `SymbolCache` 를 import 하지 않고 이름 조회 함수만 받는다 —
 * 조회 출처(캐시·테스트 대역)를 호출부가 고른다. `controller/` 의 주입형 IO 와 같은 규약이다.
 */
import * as vscode from 'vscode';
import { GPLParser, GPLSymbol } from '../language/gplParser';
import { findEnclosingProcedureRange } from '../language/cursorExpression';
import { GPL_BUILTIN_RECEIVERS } from '../language/gplBuiltins';
import { buildDocumentReceiverLookup, ReceiverLookup } from '../language/receiverType';

/** 커서를 감싸는 프로시저 범위(없으면 모듈 레벨). */
export interface ProcedureRange {
    startLine: number;
    endLine: number;
}

export interface ReceiverContext {
    /** receiverType 해석기에 넘길 조회 컨텍스트. */
    lookup: ReceiverLookup;
    /** 로컬/파라미터까지 포함해 파싱한 현재 문서의 심볼(호출부가 재사용한다). */
    docSymbols: GPLSymbol[];
    /** 커서를 감싸는 프로시저 범위. 프로시저 밖이면 undefined. */
    procRange: ProcedureRange | undefined;
}

/** 문서 심볼 파싱 옵션 — 수신자 해석에는 로컬/파라미터가 반드시 필요하다(캐시는 로컬을 인덱싱하지 않는다). */
const PARSE_OPTIONS = { includeLocals: true, includeParameters: true } as const;

/**
 * 현재 문서·줄에서 수신자 해석 컨텍스트를 만든다.
 *
 * `docSymbols` 를 이미 갖고 있으면(자체 메모이즈를 둔 provider) 넘겨서 재파싱을 피한다.
 * 넘기지 않으면 여기서 파싱한다 — `GPLParser.parseDocument` 는 내용 기준 메모이즈라 반복 호출이 싸다.
 */
export function buildReceiverContext(
    document: vscode.TextDocument,
    atLine: number,
    findAllByName: (name: string) => GPLSymbol[],
    docSymbols?: GPLSymbol[],
): ReceiverContext {
    const symbols = docSymbols
        ?? GPLParser.parseDocument(document.getText(), document.uri.fsPath, PARSE_OPTIONS);
    const procRange = findEnclosingProcedureRange(
        i => document.lineAt(i).text, document.lineCount, atLine);
    const lookup = buildDocumentReceiverLookup(
        symbols, procRange, atLine, findAllByName, GPL_BUILTIN_RECEIVERS);
    return { lookup, docSymbols: symbols, procRange };
}
