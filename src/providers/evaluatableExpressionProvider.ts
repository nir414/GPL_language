/**
 * 디버그 hover 평가 대상 식 결정 (EvaluatableExpressionProvider).
 *
 * 배경: 이 provider가 없으면 VS Code는 커서 밑 "단어"만 디버그 어댑터에 보낸다 —
 * `armList(i)` 위에 올려도 `armList`만 평가되어 요소 값을 볼 수 없다.
 *
 * 안전 규칙 (중요 — 제어기 콘솔의 `Show Variable -eval`은 Sub/Function도 "실행"한다):
 * 0. 커서 이름이 예약어면 차단 — 제어기가 -712(*Invalid syntax*)로 거부해 오류 팝업만 남는다.
 *    0-b. 타입 자리(`New X(...)`/`As X`/`Inherits X`/`Class X`)의 이름은 값이 아니므로 차단(구문 판정, §1-DS).
 *    0-c. 수신자 없는 단독 이름이 사용자 Class/Module 또는 (동명 변수 없는) 내장 클래스로만 해석되면 차단.
 * 1. 커서 이름이 Sub/Function이면 디버그 hover 자체를 차단(undefined) —
 *    기본 동작(단어 전송)이 오히려 파라미터 없는 Sub를 실행할 수 있던 위험도 함께 제거.
 * 2. 괄호 그룹(`name(...)`)은 그 이름이 로컬/파라미터/모듈 변수로 **확인될 때만** 포함 —
 *    호출식(`SetGripTypeIndex(...)`)이 hover로 실행되는 사고 방지. 미확인이면 단어만.
 *    인자 있는 Property 는 커서(마지막) 세그먼트일 때만 프로시저로 본다 — 어댑터가 치환하지 못해 -780 팝업만
 *    남기 때문. 체인 중간이면 제어기가 getter 를 실행해 주므로 종전대로 허용(#26 실측, §1-DS).
 *
 * 수신자 타입(GitHub #32): 멤버 접근(`obj.member`)의 `member`는 `.` 앞 체인의 클래스를 정적으로 해석해
 * **그 클래스의 멤버만**으로 판정한다(다른 클래스의 동명 Function 때문에 해석 가능한 Property hover가
 * 차단되던 문제). 수신자 해석에 실패하면 종전처럼 이름 전체로 보수 판정한다(규칙 1·2 유지).
 *
 * 내장 클래스 수신자(2026-08-31): 체인이 GPL Dictionary 클래스로 해석되면(`Thread.CurrentThread` → Thread)
 * 판정도 사전으로 한다 — Property는 허용, 메서드는 `sideEffectFree` 표시가 있을 때만 허용. 워크스페이스의
 * 동명 Sub/Function으로 보수 판정하면 `Thread.CurrentThread.Name`처럼 실제로 값이 나오는 hover가 막힌다.
 */
import * as vscode from 'vscode';
import { SymbolCache } from '../language/vscode/symbolCache';
import { GPLSymbolKind, GPLSymbol } from '../language/gplParser';
import {
    extractDebugExpressionAt,
    buildDebugExpression,
    isTypeNamePosition,
    DebugExpressionSegment,
} from '../language/cursorExpression';
import { isGplReservedWord } from '../language/gplReservedWords';
import { getterBranchIdentifiers } from '../language/getterBranch';
import {
    membersNamed,
    resolveReceiverHolder,
    resolveReceiverTypeName,
    ReceiverHolder,
    ReceiverLookup,
} from '../language/receiverType';
import {
    findGplBuiltinMember,
    isGplBuiltinClassName,
} from '../language/gplBuiltins';
import { buildReceiverContext } from './receiverContext';

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

        // 규칙 0: 예약어(`If`/`Then`/`As`/`Me`/타입명 …) 위에서는 디버그 hover를 띄우지 않는다.
        // 제어기 -eval은 이런 토큰을 -712(*Invalid syntax*)로 거부하고, 그 오류 팝업이 코드를
        // 읽는 내내 따라붙었다(사용자 보고 2026-08-31). 문서 파싱보다 앞에 둬서 비용도 없앤다.
        if (isGplReservedWord(cand.segments[cand.cursorSegment].name)) { return undefined; }

        // 규칙 0-b: 타입 자리(`New X(...)`, `As X`, `Inherits X`, `Class X`)의 이름은 값이 아니다 — 구문만으로
        // 판정하므로 심볼 조회 없이 먼저 거른다. `theSystem = New System(...)` 의 `System` 위 hover 가 클래스
        // 이름을 -eval 로 보내 -729 팝업을 띄웠다(사용자 스크린샷 2026-09-17, §1-DS).
        if (isTypeNamePosition(lineText, cand.startColumn)) { return undefined; }

        // 현재 문서를 로컬/파라미터 포함으로 파싱 (parseDocument는 내용 기준 메모이즈 —
        // 반복 hover 비용 낮음). 워크스페이스 캐시는 로컬을 인덱싱하지 않아 별도 필요.
        const { lookup, docSymbols } = buildReceiverContext(
            document, position.line, name => this.symbolCache.findAllByName(name));

        // 규칙 0-c: 수신자 없는 단독 이름이 **타입으로만** 해석되면(사용자 Class/Module, 또는 동명 변수 없는 GPL 내장
        // 클래스) 차단 — `Thread.Sleep(100)` 의 `Thread`, `DataFile.Count` 의 `DataFile` 처럼 Shared 멤버 접근의
        // 수신자 위 hover 가 클래스 이름 단독 평가로 흘러가던 것을 막는다. 체인이 있으면 홀더 해석이 맡는다.
        if (cand.segments.length === 1 && this._isTypeOnlyName(cand.segments[0].name, docSymbols)) { return undefined; }

        // 세그먼트 i의 수신자 홀더(i=0은 수신자 없음). 해석 실패 → undefined(이름 기반 폴백).
        const holderOf = (index: number): ReceiverHolder | undefined =>
            index > 0 ? resolveReceiverHolder(cand.segments.slice(0, index), lookup) : undefined;

        /** 세그먼트 i의 수신자 체인이 **내장 클래스**로 해석되면 그 클래스 이름. */
        const builtinReceiverOf = (index: number): string | undefined => {
            if (index === 0) { return undefined; }
            const t = resolveReceiverTypeName(cand.segments.slice(0, index), lookup);
            return t && isGplBuiltinClassName(t) ? t : undefined;
        };

        const kindOf = (name: string, index: number): SymbolKindJudgement => {
            const holder = holderOf(index);
            const lower = name.toLowerCase();
            const named = docSymbols.filter(s => s.name.toLowerCase() === lower);
            // 수신자 없는 이름: 로컬/파라미터가 있으면 변수 확정(로컬이 동명 프로시저를 가린다)
            if (!holder && named.some(s => this._isVariable(s) && s.isLocal)) { return 'variable'; }

            // 수신자가 내장 클래스로 해석되면 **사전만으로** 판정한다(2026-08-31).
            // 이 식의 멤버는 제어기가 그 내장 클래스에서 찾으므로 워크스페이스의 동명
            // Sub/Function은 등장할 수 없다 — 이름 기반 보수 판정을 적용하면 값이 보이는
            // hover까지 막힌다(`Thread.CurrentThread.Name`이 남의 `Function Name()`에 막혔다).
            if (!holder) {
                const builtinClass = builtinReceiverOf(index);
                if (builtinClass) {
                    const entry = findGplBuiltinMember(builtinClass, name);
                    if (!entry) { return 'unknown'; }
                    // Property는 조회 전용, 메서드는 sideEffectFree 표시가 있을 때만 식에 포함한다
                    // (`Thread.CurrentThread()` 허용 / `t.Abort()`·`Thread.Sleep()` 차단).
                    return entry.kind === 'property' || entry.sideEffectFree ? 'variable' : 'callable';
                }
            }
            let all: GPLSymbol[] = holder
                ? membersNamed(lookup, holder, name)
                : [...named, ...this.symbolCache.findAllByName(name)];
            if (holder && all.length === 0) {
                // 수신자 클래스에 그 이름의 멤버가 없다(상속·미색인) → 종전 이름 전체로 보수 판정
                all = [...named.filter(s => !s.isLocal), ...this.symbolCache.findAllByName(name)];
            }
            // 인자 있는 Property(`arm(a-1)`)가 **커서(마지막) 세그먼트**면 어댑터가 백킹 필드로 치환하지 못해(-780 그대로 —
            // `_propertyBackingCandidates` 는 인자 있는 프로퍼티를 제외) 오류 팝업만 남는다 → 프로시저로 취급해 hover 를
            // 막는다(사용자 스크린샷 2026-09-17, §1-DS). 체인 **중간**의 Property 는 제어기가 getter 를 실행해 주므로
            // (`myRobot(r-1).arm(a-1).isUseCrashDetectSensor` 는 평가됨 — #26 실측 "체인 중간은 실행") 종전대로 둔다.
            const indexedAtCursor = index === cand.cursorSegment && cand.segments[index].args !== undefined;
            if (all.some(s => this._isCallable(s, docSymbols, indexedAtCursor))) { return 'callable'; }
            if (all.some(s => this._isVariable(s))) { return 'variable'; }
            // 백킹 필드로 해석 가능한 Property는 변수처럼 평가를 허용한다(디버그 어댑터가 -780을 치환해 값을 얻는다)
            if (!indexedAtCursor
                && all.some(s => s.kind === GPLSymbolKind.Property && this._isResolvableProperty(s, docSymbols))) { return 'variable'; }
            return 'unknown';
        };

        const cursorSeg = cand.segments[cand.cursorSegment];

        // 규칙 1: 커서 이름이 프로시저면 디버그 hover 차단
        if (kindOf(cursorSeg.name, cand.cursorSegment) === 'callable') { return undefined; }

        // 규칙 2: 괄호 세그먼트는 변수 확인된 것만 유지. 하나라도 확인 실패면
        // 체인/괄호 없이 커서 단어만 평가(기존 기본 동작과 동일).
        const allParensSafe = cand.segments.every((s, i) =>
            s.args === undefined || kindOf(s.name, i) === 'variable');

        const segments: DebugExpressionSegment[] = allParensSafe
            ? cand.segments
            : [{ name: cursorSeg.name }];
        const range = allParensSafe
            ? new vscode.Range(position.line, cand.startColumn, position.line, cand.endColumn)
            : (document.getWordRangeAtPosition(position, /[A-Za-z_]\w*/)
                ?? new vscode.Range(position, position));

        return new vscode.EvaluatableExpression(range, buildDebugExpression(segments));
    }

    /**
     * @param indexedAtCursor 커서 세그먼트가 인자 있는 Property 접근(`arm(a-1)`)인가 — 어댑터의 백킹 필드 치환은
     *   인자 없는 프로퍼티만 다루므로, 이 경우 해석 가능 여부와 무관하게 프로시저로 본다(§1-DS).
     */
    private _isCallable(s: GPLSymbol, docSymbols: GPLSymbol[], indexedAtCursor = false): boolean {
        // Property 포함 이유(실기기 2026-07-22): 이 제어기의 -eval은 프로퍼티를 인자 유무와
        // 무관하게 평가하지 못한다(-780/-205). 프로퍼티 이름 위 hover가 단어 평가로 폴백되면
        // 엉뚱한 -729("ints" 단독 평가)가 떠서, 디버그 팝업을 차단하는 쪽이 정확하다.
        // 예외(GitHub #26): 백킹 필드로 해석 가능한 Property는 디버그 어댑터가 -780을 치환해 값을 보여주므로 허용.
        return s.kind === GPLSymbolKind.Sub
            || s.kind === GPLSymbolKind.Function
            || (s.kind === GPLSymbolKind.Property && (indexedAtCursor || !this._isResolvableProperty(s, docSymbols)));
    }

    /**
     * Property가 백킹 필드로 해석 가능한가 — ① 파서가 기록한 Get 반환식(`getterReturnExpr`)이 있거나
     * ② 같은 클래스에 관례 이름 `m_<프로퍼티>` 필드가 있거나(문서 또는 워크스페이스 캐시)
     * ③ 분기형 getter(`getterBranch`)의 피연산자가 모두 같은 클래스의 필드이면. WriteOnly는 불가.
     */
    private _isResolvableProperty(s: GPLSymbol, docSymbols: GPLSymbol[]): boolean {
        if (s.hasGetter === false) { return false; }
        if (s.getterReturnExpr) { return true; }
        if (!s.className) { return false; }
        const cls = s.className.toLowerCase();
        const isClassField = (m: GPLSymbol, fieldName: string) => m.kind === GPLSymbolKind.Variable && !m.isLocal
            && m.name.toLowerCase() === fieldName && (m.className ?? '').toLowerCase() === cls;
        const classMembers = [...docSymbols, ...this.symbolCache.getClassMembers(s.className)];
        // ③ 분기형 getter(§1-DS): 조건·분기에 쓰인 이름이 모두 같은 클래스의 필드면 어댑터가 부모 덤프 값으로 계산한다.
        if (s.getterBranch) {
            const idents = getterBranchIdentifiers(s.getterBranch);
            if (idents && idents.every(id => classMembers.some(m => isClassField(m, id.toLowerCase())))) { return true; }
        }
        const backing = `m_${s.name}`.toLowerCase();
        return classMembers.some(m => isClassField(m, backing));
    }

    private _isVariable(s: GPLSymbol): boolean {
        return s.kind === GPLSymbolKind.Variable || s.kind === GPLSymbolKind.Constant;
    }

    /**
     * 수신자 없는 단독 이름이 **타입 이름으로만** 해석되는가(규칙 0-c) — 현재 문서·워크스페이스의 동명 심볼이 전부
     * Class/Module 이거나, 동명 심볼이 하나도 없는데 GPL 내장 클래스 이름과 같으면 참. 동명 변수/상수/프로시저가
     * 하나라도 있으면 거짓(그 판정은 기존 규칙 1·2가 맡는다 — 로컬 `File` 이 내장 `File` 클래스를 가리는 경우 등).
     */
    private _isTypeOnlyName(name: string, docSymbols: GPLSymbol[]): boolean {
        const lower = name.toLowerCase();
        const all = [
            ...docSymbols.filter(s => s.name.toLowerCase() === lower),
            ...this.symbolCache.findAllByName(name),
        ];
        if (all.length > 0) {
            return all.every(s => s.kind === GPLSymbolKind.Class || s.kind === GPLSymbolKind.Module || s.kind === GPLSymbolKind.Delegate);
        }
        return isGplBuiltinClassName(name);
    }
}

// ReceiverLookup 타입은 테스트·다른 provider가 같은 계약을 쓰도록 재노출한다.
export type { ReceiverLookup };
