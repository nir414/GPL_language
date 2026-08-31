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
 *
 * 수신자 타입(GitHub #32): 멤버 접근(`obj.member`)의 `member`는 `.` 앞 체인의 클래스를 정적으로 해석해
 * **그 클래스의 멤버만**으로 판정한다(다른 클래스의 동명 Function 때문에 해석 가능한 Property hover가
 * 차단되던 문제). 수신자 해석에 실패하면 종전처럼 이름 전체로 보수 판정한다(규칙 1·2 유지).
 */
import * as vscode from 'vscode';
import { SymbolCache } from '../symbolCache';
import { GPLParser, GPLSymbolKind, GPLSymbol } from '../gplParser';
import {
    extractDebugExpressionAt,
    buildDebugExpression,
    findEnclosingProcedureRange,
    DebugExpressionSegment,
} from '../language/cursorExpression';
import {
    buildDocumentReceiverLookup,
    membersNamed,
    resolveReceiverHolder,
    ReceiverHolder,
    ReceiverLookup,
} from '../language/receiverType';

type SymbolKindJudgement = 'variable' | 'callable' | 'unknown';

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
        const procRange = findEnclosingProcedureRange(
            i => document.lineAt(i).text, document.lineCount, position.line);
        const lookup = buildDocumentReceiverLookup(
            docSymbols, procRange, position.line, name => this.symbolCache.findAllByName(name));

        // 세그먼트 i의 수신자 홀더(i=0은 수신자 없음). 해석 실패 → undefined(이름 기반 폴백).
        const holderOf = (index: number): ReceiverHolder | undefined =>
            index > 0 ? resolveReceiverHolder(cand.segments.slice(0, index), lookup) : undefined;

        const kindOf = (name: string, holder: ReceiverHolder | undefined): SymbolKindJudgement => {
            const lower = name.toLowerCase();
            const named = docSymbols.filter(s => s.name.toLowerCase() === lower);
            // 수신자 없는 이름: 로컬/파라미터가 있으면 변수 확정(로컬이 동명 프로시저를 가린다)
            if (!holder && named.some(s => this._isVariable(s) && s.isLocal)) { return 'variable'; }
            let all: GPLSymbol[] = holder
                ? membersNamed(lookup, holder, name)
                : [...named, ...this.symbolCache.findAllByName(name)];
            if (holder && all.length === 0) {
                // 수신자 클래스에 그 이름의 멤버가 없다(상속·미색인) → 종전 이름 전체로 보수 판정
                all = [...named.filter(s => !s.isLocal), ...this.symbolCache.findAllByName(name)];
            }
            if (all.some(s => this._isCallable(s, docSymbols))) { return 'callable'; }
            if (all.some(s => this._isVariable(s))) { return 'variable'; }
            // 백킹 필드로 해석 가능한 Property는 변수처럼 평가를 허용한다(디버그 어댑터가 -780을 치환해 값을 얻는다)
            if (all.some(s => s.kind === GPLSymbolKind.Property && this._isResolvableProperty(s, docSymbols))) { return 'variable'; }
            return 'unknown';
        };

        const cursorSeg = cand.segments[cand.cursorSegment];

        // 규칙 1: 커서 이름이 프로시저면 디버그 hover 차단
        if (kindOf(cursorSeg.name, holderOf(cand.cursorSegment)) === 'callable') { return undefined; }

        // 규칙 2: 괄호 세그먼트는 변수 확인된 것만 유지. 하나라도 확인 실패면
        // 체인/괄호 없이 커서 단어만 평가(기존 기본 동작과 동일).
        const allParensSafe = cand.segments.every((s, i) =>
            s.args === undefined || kindOf(s.name, holderOf(i)) === 'variable');

        const segments: DebugExpressionSegment[] = allParensSafe
            ? cand.segments
            : [{ name: cursorSeg.name }];
        const range = allParensSafe
            ? new vscode.Range(position.line, cand.startColumn, position.line, cand.endColumn)
            : (document.getWordRangeAtPosition(position, /[A-Za-z_]\w*/)
                ?? new vscode.Range(position, position));

        return new vscode.EvaluatableExpression(range, buildDebugExpression(segments));
    }

    private _isCallable(s: GPLSymbol, docSymbols: GPLSymbol[]): boolean {
        // Property 포함 이유(실기기 2026-07-22): 이 제어기의 -eval은 프로퍼티를 인자 유무와
        // 무관하게 평가하지 못한다(-780/-205). 프로퍼티 이름 위 hover가 단어 평가로 폴백되면
        // 엉뚱한 -729("ints" 단독 평가)가 떠서, 디버그 팝업을 차단하는 쪽이 정확하다.
        // 예외(GitHub #26): 백킹 필드로 해석 가능한 Property는 디버그 어댑터가 -780을 치환해 값을 보여주므로 허용.
        return s.kind === GPLSymbolKind.Sub
            || s.kind === GPLSymbolKind.Function
            || (s.kind === GPLSymbolKind.Property && !this._isResolvableProperty(s, docSymbols));
    }

    /**
     * Property가 백킹 필드로 해석 가능한가 — ① 파서가 기록한 Get 반환식(`getterReturnExpr`)이 있거나
     * ② 같은 클래스에 관례 이름 `m_<프로퍼티>` 필드가 있으면(문서 또는 워크스페이스 캐시). WriteOnly는 불가.
     */
    private _isResolvableProperty(s: GPLSymbol, docSymbols: GPLSymbol[]): boolean {
        if (s.hasGetter === false) { return false; }
        if (s.getterReturnExpr) { return true; }
        if (!s.className) { return false; }
        const backing = `m_${s.name}`.toLowerCase();
        const cls = s.className.toLowerCase();
        const isBacking = (m: GPLSymbol) => m.kind === GPLSymbolKind.Variable && !m.isLocal
            && m.name.toLowerCase() === backing && (m.className ?? '').toLowerCase() === cls;
        return docSymbols.some(isBacking) || this.symbolCache.getClassMembers(s.className).some(isBacking);
    }

    private _isVariable(s: GPLSymbol): boolean {
        return s.kind === GPLSymbolKind.Variable || s.kind === GPLSymbolKind.Constant;
    }
}

// ReceiverLookup 타입은 테스트·다른 provider가 같은 계약을 쓰도록 재노출한다.
export type { ReceiverLookup };
