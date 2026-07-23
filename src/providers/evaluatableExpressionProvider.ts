/**
 * 디버그 hover 평가 대상 식 결정 (EvaluatableExpressionProvider).
 *
 * 배경: 이 provider가 없으면 VS Code는 커서 밑 "단어"만 디버그 어댑터에 보낸다 —
 * `armList(i)` 위에 올려도 `armList`만 평가되어 요소 값을 볼 수 없다.
 *
 * 안전 규칙 (중요 — 제어기 콘솔의 `Show Variable -eval`은 Sub/Function도 "실행"한다):
 * 1. 커서 이름이 Sub/Function이면 디버그 hover 자체를 차단(undefined) —
 *    기본 동작(단어 전송)이 오히려 파라미터 없는 Sub를 실행할 수 있던 위험도 함께 제거.
 * 2. 괄호 그룹(`name(...)`)은 그 이름이 로컬/파라미터/모듈 변수로 **확인될 때만** 포함 —
 *    호출식(`SetGripTypeIndex(...)`)이 hover로 실행되는 사고 방지. 미확인이면 단어만.
 */
import * as vscode from 'vscode';
import { SymbolCache } from '../symbolCache';
import { GPLParser, GPLSymbolKind, GPLSymbol } from '../gplParser';
import {
    extractDebugExpressionAt,
    buildDebugExpression,
    DebugExpressionSegment,
} from '../language/cursorExpression';

export class GPLEvaluatableExpressionProvider implements vscode.EvaluatableExpressionProvider {
    constructor(private readonly symbolCache: SymbolCache) {}

    provideEvaluatableExpression(
        document: vscode.TextDocument,
        position: vscode.Position,
    ): vscode.ProviderResult<vscode.EvaluatableExpression> {
        const lineText = document.lineAt(position.line).text;
        const cand = extractDebugExpressionAt(lineText, position.character);
        if (!cand) { return undefined; }

        // 현재 문서를 로컬/파라미터 포함으로 파싱 (parseDocument는 내용 기준 메모이즈 —
        // 반복 hover 비용 낮음). 워크스페이스 캐시는 로컬을 인덱싱하지 않아 별도 필요.
        const docSymbols = GPLParser.parseDocument(document.getText(), document.uri.fsPath, {
            includeLocals: true,
            includeParameters: true,
        });
        const kindOf = (name: string): 'variable' | 'callable' | 'unknown' => {
            const lower = name.toLowerCase();
            const named = docSymbols.filter(s => s.name.toLowerCase() === lower);
            // 로컬/파라미터가 있으면 변수 확정(로컬이 동명 프로시저를 가린다)
            if (named.some(s => this._isVariable(s) && s.isLocal)) { return 'variable'; }
            const cacheNamed = this.symbolCache.findAllByName(name);
            if ([...named, ...cacheNamed].some(s => this._isCallable(s))) { return 'callable'; }
            if ([...named, ...cacheNamed].some(s => this._isVariable(s))) { return 'variable'; }
            return 'unknown';
        };

        const cursorSeg = cand.segments[cand.cursorSegment];

        // 규칙 1: 커서 이름이 프로시저면 디버그 hover 차단
        if (kindOf(cursorSeg.name) === 'callable') { return undefined; }

        // 규칙 2: 괄호 세그먼트는 변수 확인된 것만 유지. 하나라도 확인 실패면
        // 체인/괄호 없이 커서 단어만 평가(기존 기본 동작과 동일).
        const parenSegs = cand.segments.filter(s => s.args !== undefined);
        const allParensSafe = parenSegs.every(s => kindOf(s.name) === 'variable');

        const segments: DebugExpressionSegment[] = allParensSafe
            ? cand.segments
            : [{ name: cursorSeg.name }];
        const range = allParensSafe
            ? new vscode.Range(position.line, cand.startColumn, position.line, cand.endColumn)
            : (document.getWordRangeAtPosition(position, /[A-Za-z_]\w*/)
                ?? new vscode.Range(position, position));

        return new vscode.EvaluatableExpression(range, buildDebugExpression(segments));
    }

    private _isCallable(s: GPLSymbol): boolean {
        // Property 포함 이유(실기기 2026-07-22): 이 제어기의 -eval은 프로퍼티를 인자 유무와
        // 무관하게 평가하지 못한다(-780/-205). 프로퍼티 이름 위 hover가 단어 평가로 폴백되면
        // 엉뚱한 -729("ints" 단독 평가)가 떠서, 디버그 팝업을 차단하는 쪽이 정확하다.
        return s.kind === GPLSymbolKind.Sub
            || s.kind === GPLSymbolKind.Function
            || s.kind === GPLSymbolKind.Property;
    }

    private _isVariable(s: GPLSymbol): boolean {
        return s.kind === GPLSymbolKind.Variable || s.kind === GPLSymbolKind.Constant;
    }
}
