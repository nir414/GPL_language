/**
 * 변수 평가 — `Show Variable -eval` 사다리(원식 → 인덱스 치환 → Property 백킹 필드 → 부모 덤프), DAP Variable 조립, 배열 펼치기, 전역 읽기, hover/watch 캐시, REPL 입력 평가.
 *
 * 실기기(GPL 4.2K5)의 -eval 한계를 우회하는 규칙이 전부 여기 있다. 실행이 재개되면(`FrameCache.frameCacheGen` 변경·pending 액션)
 * 남은 사다리 단계를 보내지 않는다 — 값이 버려질 뿐 아니라 다음 Step 이 그 뒤에 줄을 서기 때문이다.
 *
 * `gplDebugSession.ts`(5,700줄) 에서 2026-10-27 에 분리했다. 세션 상태는 `DebugSessionIo` getter 로만 읽는다.
 * vscode 에는 의존하지 않는다 — 설정·모달은 `VariableEvaluatorIo` 가 준다.
 */

import { Handles } from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import { parseVariable, isSuccess, parseStatus } from '../../controller/protocol/responseParser';
import { isReadOnlyConsoleCommand } from '../../controller/commands/consoleCommandClassifier';
import { formatEvalError, describeNestedExpandFailure, UNDEFINED_SYMBOL_STATUS } from './evalMessages';
import { formatBlockedReplInput } from './replInput';
import type { ReplInputEntry } from './replInput';
import { evaluateGetterBranch, getterBranchIdentifiers } from '../../language/analysis/getterBranch';
import { ParsedVarEntry, parseShowVariableMulti, classifyVarEntry, arrayRank, isLocationType, summarizeLocation, annotateLocationMember, dapColorizeType } from './showVariableParser';
import { extractIndexIdentifierTokens, replaceIndexIdentifierTokens } from '../../language/syntax/cursorExpression';
import type { DebugSessionIo } from '../session/sessionIo';
import type { SourceSymbolIndex, GlobalVariableDescriptor } from './sourceSymbolIndex';
import type { FrameCache } from '../session/frameCache';

/**
 * Variables 패널 핸들 페이로드.
 * - locals/globals: 최상위 스코프
 * - members: 객체 조회 응답에 이미 포함된 멤버 줄들(공식 Show Variable 문서: 객체는
 *   `variable, Object` + 멤버별 `variable.field, type, value` 줄로 응답) — 재조회 없이 표시
 * - expand: 배열 또는 중첩 객체 노드 — 펼칠 때 Show Variable -eval로 지연 조회
 */
export type ScopeRef =
    | { type: 'locals'; threadName: string; frameIndex: number }
    | { type: 'globals'; threadName: string; frameIndex: number }
    | {
        type: 'members';
        threadName: string;
        frameIndex: number;
        /** 멤버 경로 조합용 부모 식 (setVariable/Watch 추가에 사용) */
        parentExpression: string;
        entries: ParsedVarEntry[];
        /** 헤더 타입(`Object RNDRobot`) — 클래스 Property 가상 자식 생성용(GitHub #26) */
        classType?: string;
    }
    | {
        type: 'expand';
        threadName: string;
        frameIndex: number;
        /** 제어기에 보낼 전체 식 (예: `loc.Pos`, `myArr`) */
        expression: string;
        /** Show Variable이 보고한 타입 문자열 (예: `Object`, `Double(,)`) */
        varType: string;
    };

export interface VariableEvaluatorIo extends DebugSessionIo {
    /** `gpl.debug.integerHex`: 정수 값에 16진수 표기를 병기할지. */
    integerHexEnabled(): boolean;
    /** 상태를 바꾸는 REPL 명령 전송 전 확인(`gpl.debug.confirmDestructiveRepl` 이 꺼져 있으면 묻지 않고 true). */
    confirmStateChangingCommand(expression: string): Promise<boolean>;
}

export class VariableEvaluator {
    constructor(
        private readonly io: VariableEvaluatorIo,
        private readonly symbols: SourceSymbolIndex,
        private readonly frames: FrameCache,
    ) {}

    // Variable handle management
    variableHandles = new Handles<ScopeRef>();

    // 전역 조회 방식 메모(세션 유지, 소스맵 재구축 시 리셋): 정지마다 전역당 최대 3회이던
    // 직렬 왕복을 성공 방식 기억으로 1회로 줄인다. 'none' = 전부 실패(폴백 생략 대상).
    globalQueryMemo = new Map<
        string,
        { method: 'eval' } | { method: 'global'; name: string } | 'none'
    >();

    // ref: 배열/객체 결과의 variablesReference — 핸들은 _clearStaleState에서 캐시와 함께
    // 리셋되므로 수명이 일치한다(캐시가 무효 핸들을 돌려줄 일 없음).
    private evaluateCache = new Map<string, { value: string; ref: number; type?: string; timestamp: number }>();

    /**
     * 변수 조회 응답에서 첫 항목만 취하는 래퍼 — 항목이 없으면 value '(undefined)'.
     * (형식 해석과 STATUS 블록 제거는 parseShowVariableMulti가 담당한다.)
     */
    private parseShowVariableEval(raw: string): { name: string; type: string; value: string } {
        const entries = parseShowVariableMulti(raw);
        if (entries.length === 0) {
            return { name: '', type: '', value: VariableEvaluator.UNDEFINED_VALUE };
        }
        return entries[0];
    }

    /**
     * `Show Global` 응답을 표시용 텍스트 라인으로 정리한다.
     * STATUS 블록을 먼저 통째로 제거 — 태그만 벗기면 `0, "Success"`가 값처럼 남는다.
     */
    showGlobalResponseLines(raw: string): string[] {
        const cleaned = raw
            .replace(/<STATUS>[\s\S]*?<\/STATUS>/gi, '')
            .replace(/<[^>]+>/g, '')
            .trim();
        return cleaned.split(/\r?\n/).filter(l => l.trim().length > 0);
    }

    /**
     * 파싱된 항목을 DAP Variable로 변환한다. 배열/객체는 variablesReference를 부여해
     * Variables/Watch 패널에서 트리로 펼칠 수 있게 한다.
     * @param memberEntries 객체 조회 응답에 동봉된 멤버 줄들(있으면 재조회 없이 사용)
     */
    makeVariable(
        displayName: string,
        entry: ParsedVarEntry,
        threadName: string,
        frameIndex: number,
        expression: string,
        memberEntries?: ParsedVarEntry[],
    ): DebugProtocol.Variable {
        const kind = classifyVarEntry(entry, (memberEntries?.length ?? 0) > 0);
        if (kind === 'object') {
            const ref = memberEntries && memberEntries.length > 0
                ? this.variableHandles.create({
                    type: 'members',
                    threadName,
                    frameIndex,
                    parentExpression: expression,
                    entries: memberEntries,
                    classType: entry.type,
                })
                : this.variableHandles.create({
                    type: 'expand', threadName, frameIndex, expression, varType: entry.type,
                });
            // 시스템 Location은 펼치지 않아도 읽히게 한 줄 요약을 값에 넣는다(GitHub #27):
            // Cartesian `(X, Y, Z | Yaw, Pitch, Roll) cfg=N`, Angles `Angles(a1, …)`.
            const locSummary = isLocationType(entry.type) && memberEntries?.length ? summarizeLocation(memberEntries) : undefined;
            return {
                name: displayName,
                // 실기기는 타입에 클래스명을 포함해 보고한다(`Object Command`) — 그대로 노출.
                value: locSummary ? `${locSummary}  (${entry.type})` : (entry.type || 'Object'),
                type: entry.type,
                evaluateName: expression,
                variablesReference: ref,
            };
        }
        if (kind === 'array') {
            const ref = this.variableHandles.create({
                type: 'expand', threadName, frameIndex, expression, varType: entry.type,
            });
            return {
                name: displayName,
                // 객체 배열 헤더의 런타임 클래스 자리 `null`은 표시에서 뺀다 (`Object() null` → `Object()`)
                value: `${entry.type.replace(/\s+null\s*$/i, '')} 배열`,
                type: entry.type,
                evaluateName: expression,
                variablesReference: ref,
            };
        }
        // null 객체 참조(`Object() null`, 값 없음)는 빈 값 대신 'null'로 표시.
        // Location 멤버의 ZClearance 1E+32는 "(미설정)" 주석을 붙인다(GitHub #27).
        const displayValue = this.withHexHint(
            annotateLocationMember(entry.name, entry.value)
            || (/\bnull\s*$/i.test(entry.type) ? 'null' : ''),
        );
        return {
            name: displayName,
            value: entry.type ? `${displayValue}  (${entry.type})` : displayValue,
            // 원시 타입은 DAP 표준 이름으로 알려 값이 전용색(불투명)으로 칠해지게 한다 —
            // 정확한 GPL 타입은 값 접미 `(Integer)`로 계속 보인다(dapColorizeType 주석).
            type: dapColorizeType(entry.type, entry.value) ?? (entry.type || undefined),
            evaluateName: expression,
            variablesReference: 0,
        };
    }

    /**
     * Show Variable -eval 1회로 변수/식을 구조적으로 조회한다.
     * @returns null = 응답 없음(미연결 등). 파싱 실패 시 value '(undefined)'인 단순 항목
     *          + STATUS가 실패면 error(코드/메시지) 동봉 — hover/watch가 원인을 표시한다.
     */
    async queryVariableStructured(
        threadName: string,
        frameIndex: number,
        expression: string,
    ): Promise<{ entry: ParsedVarEntry; members: ParsedVarEntry[]; error?: { code: number; message: string } } | null> {
        const resp = await this.io.sendCmd(
            `Show Variable -eval ${threadName} ${frameIndex} ${expression}`,
            'data',
        );
        if (!resp) { return null; }
        const entries = parseShowVariableMulti(resp);
        if (entries.length === 0) {
            const st = parseStatus(resp);
            return {
                entry: { name: expression, type: '', value: VariableEvaluator.UNDEFINED_VALUE },
                members: [],
                error: st.code !== 0 ? { code: st.code, message: st.message } : undefined,
            };
        }
        return { entry: entries[0], members: entries.slice(1) };
    }

    /**
     * -eval의 제어기 측 한계를 우회하는 조회 (실기기 확인 2026-07-22, GPL 4.2K5):
     * ① 원식 조회 → ② 실패 시 괄호 안 식별자를 정수 값으로 치환해 재시도(`armList(i)`→`armList(3)`)
     * → ③ 그래도 실패하고 점 표기 식이면 **부모 객체를 덤프해 멤버 줄에서 값 추출**
     *   (`readyLoc.extraZ2` — 이 펌웨어는 점 표기 멤버 식을 -729/-780으로 거부하고,
     *    멤버 값은 부모 덤프에만 실려 온다).
     * @returns resolvedExpression — 실제로 평가에 성공한 식(트리 확장/Watch 추가용)
     */
    async queryVariableStructuredSmart(
        threadName: string,
        frameIndex: number,
        expression: string,
        depth: number = 0,
    ): Promise<{
        entry: ParsedVarEntry;
        members: ParsedVarEntry[];
        error?: { code: number; message: string };
        resolvedExpression: string;
        /** 프로퍼티를 백킹 필드로 치환해 얻은 값이면 그 출처 설명(표시용, GitHub #26) */
        via?: string;
    } | null> {
        const miss = (r: { entry: ParsedVarEntry; members: ParsedVarEntry[] } | null) =>
            !r || (r.members.length === 0 && (!r.entry.value || r.entry.value === VariableEvaluator.UNDEFINED_VALUE));

        // `Me.x`는 이 제어기 콘솔에서 -712 Invalid syntax(실측 2026-08-25, GitHub #26) — 접두를 벗기고 평가한다.
        expression = expression.replace(/^Me\.(?=[A-Za-z_])/i, '');

        // 실행이 재개되면(정지 컨텍스트 세대 변경) 남은 사다리 단계를 보내지 않는다 — data 차선은 첫 단계만 걸러 주고,
        // 그 뒤 새로 등록되는 단계는 새 세대라 실제로 나가기 때문이다(2026-10-26).
        const stopGen = this.frames.frameCacheGen;
        const resumed = () => this.io.pendingAction !== null || stopGen !== this.frames.frameCacheGen;

        // ① 원식 그대로
        const first = await this.queryVariableStructured(threadName, frameIndex, expression);
        const firstResult = first ? { ...first, resolvedExpression: expression } : null;
        if (!miss(first)) { return firstResult; }
        if (resumed()) { return firstResult; }

        // ② 변수 인덱스 치환
        const tokens = extractIndexIdentifierTokens(expression);
        if (tokens && tokens.length > 0) {
            const values = new Map<string, string>();
            let allResolved = true;
            for (const t of tokens) {
                const r = await this.queryVariableStructured(threadName, frameIndex, t);
                const v = r?.entry.value?.trim();
                // 정수로 조회된 식별자만 치환 대상
                if (!v || !/^-?\d+$/.test(v)) { allResolved = false; break; }
                values.set(t, v);
            }
            if (allResolved) {
                const rewritten = replaceIndexIdentifierTokens(expression, values);
                if (rewritten !== expression) {
                    const second = await this.queryVariableStructured(threadName, frameIndex, rewritten);
                    if (!miss(second)) {
                        this.io.log(`인덱스 치환 평가: ${expression} → ${rewritten}`);
                        return { ...second!, resolvedExpression: rewritten };
                    }
                }
            }
        }

        // ②-b 프로퍼티 → 백킹 필드 치환 (GitHub #26). -780은 "식의 마지막 요소가 사용자 프로시저"일 때 난다(실측 2026-08-25).
        //     같은 클래스 프레임이면 점 표기 치환식이 바로 읽히고, 다른 클래스 프레임에서는 Private 필드 점 표기가
        //     -729라 부모 객체 덤프(프레임 무관, Private 포함 전체 필드)에서 멤버 줄을 추출한다.
        if (resumed()) { return firstResult; }
        if (depth === 0 && first?.error?.code === -780) {
            let candidates = this.symbols.propertyBackingCandidates(expression);
            // 부모 객체 덤프는 한 번만 받아 후보 클래스 판별(GitHub #32)과 -729 폴백(#26)에 함께 쓴다.
            const parentExprOfLeaf = candidates[0]?.parentExpr;
            let parentDump: Awaited<ReturnType<VariableEvaluator['queryVariableStructuredSmart']>> | undefined;
            const getParentDump = async () => {
                if (parentDump === undefined) {
                    parentDump = parentExprOfLeaf
                        ? await this.queryVariableStructuredSmart(threadName, frameIndex, parentExprOfLeaf, depth + 1)
                        : null;
                }
                return parentDump;
            };
            // GitHub #32: 동명 Property가 여러 클래스에 있으면 부모 객체의 **런타임 클래스**(덤프 헤더 `Object RobotArm`)로
            //     후보를 좁힌다 — 남의 클래스 백킹 필드를 먼저 시도하거나 `.Pos` 우회를 잘못 적용하지 않도록.
            const candidateClasses = new Set(candidates.flatMap(c => c.symbols.map(s => (s.className ?? '').toLowerCase())));
            if (parentExprOfLeaf && candidateClasses.size > 1) {
                const parent = await getParentDump();
                const runtimeClass = this.symbols.classNameOfType(parent?.entry.type);
                const narrowed = runtimeClass ? this.symbols.propertyBackingCandidates(expression, runtimeClass) : [];
                if (narrowed.length > 0) {
                    this.io.log(`프로퍼티 후보 클래스 한정(#32): ${expression} → ${runtimeClass} (${candidateClasses.size}개 클래스 중)`);
                    candidates = narrowed;
                }
            }
            for (const cand of candidates) {
                const r = await this.queryVariableStructured(threadName, frameIndex, cand.expr);
                if (!miss(r)) {
                    this.io.log(`프로퍼티 치환 평가: ${expression} → ${cand.expr}`);
                    return { ...r!, resolvedExpression: cand.expr, via: cand.via };
                }
                if (cand.parentExpr && r?.error?.code === UNDEFINED_SYMBOL_STATUS) {
                    const parent = await getParentDump();
                    const wanted = `.${cand.backingLeaf.toLowerCase()}`;
                    const m = parent?.members.find(e => e.name.toLowerCase().endsWith(wanted));
                    if (parent && m) {
                        this.io.log(`프로퍼티 치환(부모 덤프) 평가: ${expression} → ${parent.resolvedExpression} 덤프의 ${m.name}`);
                        return {
                            entry: m,
                            members: [],
                            resolvedExpression: `${parent.resolvedExpression}.${cand.backingLeaf}`,
                            via: cand.via,
                        };
                    }
                }
            }
            // ②-c 분기형 getter(§1-DS): `If m_x <> 0 Then Return True Else Return False` 처럼 필드 비교로 리터럴을 고르는
            //     getter 는 제어기가 평가하지 못하지만(-780), 조건의 필드 값은 부모 덤프에 실려 온다(Private 포함, 프레임 무관)
            //     → 확장이 분기를 계산하고 출처(`← 조건 (필드 = 값 → True)`)를 함께 보인다. 수신자 없는 bare 이름(클래스 안
            //     프레임)이면 필드도 bare 이름으로 직접 평가된다.
            const branchSym = candidates[0]?.symbols.find(s => s.getterBranch);
            const branchIdents = branchSym?.getterBranch ? getterBranchIdentifiers(branchSym.getterBranch) : undefined;
            if (branchSym?.getterBranch && branchIdents) {
                const values = new Map<string, string>();
                if (parentExprOfLeaf) {
                    const parent = await getParentDump();
                    for (const id of branchIdents) {
                        const m = parent?.members.find(e => e.name.toLowerCase().endsWith(`.${id.toLowerCase()}`));
                        if (m) { values.set(id.toLowerCase(), m.value); }
                    }
                } else {
                    for (const id of branchIdents) {
                        const r = await this.queryVariableStructured(threadName, frameIndex, id);
                        if (r && !miss(r)) { values.set(id.toLowerCase(), r.entry.value); }
                    }
                }
                const res = evaluateGetterBranch(branchSym.getterBranch, id => values.get(id.toLowerCase()), branchSym.returnType);
                if (res) {
                    this.io.log(`프로퍼티 분기 계산: ${expression} → ${res.via}`);
                    return {
                        entry: { name: expression, type: res.type, value: res.value },
                        members: [],
                        resolvedExpression: expression,
                        via: `${res.via} (getter 분기 계산)`,
                    };
                }
            }
            // 반환형이 Location인 프로퍼티는 시스템 멤버 `.Pos`를 붙이면 체인 중간 실행이 허용돼 덤프를 받을 수 있다(실측 2026-08-25).
            if (candidates.some(c => c.symbols.some(s => /^Location$/i.test(s.returnType ?? '')))) {
                const posExpr = `${expression}.Pos`;
                const r = await this.queryVariableStructured(threadName, frameIndex, posExpr);
                if (!miss(r)) {
                    this.io.log(`Location 프로퍼티 우회 평가: ${expression} → ${posExpr}`);
                    return { ...r!, resolvedExpression: posExpr, via: `${posExpr} (Location 프로퍼티 우회)` };
                }
            }
        }

        // ③ 점 표기 식 → 부모 덤프에서 멤버 값 추출 (1단계만 — 중첩 객체의 멤버는
        //    부모 덤프에도 "존재"만 실려 와 더 내려갈 수 없다)
        if (resumed()) { return firstResult; }
        const lastDot = expression.lastIndexOf('.');
        if (depth === 0 && lastDot > 0) {
            const parentExpr = expression.slice(0, lastDot);
            const leaf = expression.slice(lastDot + 1);
            // 멤버 이름만 허용 (인덱스 접미사 등 복합 leaf는 덤프에 없음)
            if (/^[A-Za-z_]\w*$/.test(leaf)) {
                const parent = await this.queryVariableStructuredSmart(
                    threadName, frameIndex, parentExpr, depth + 1,
                );
                if (parent && parent.members.length > 0) {
                    const wanted = `.${leaf.toLowerCase()}`;
                    const m = parent.members.find(e => e.name.toLowerCase().endsWith(wanted));
                    if (m) {
                        this.io.log(`부모 덤프 폴백: ${expression} → ${parent.resolvedExpression} 덤프의 ${m.name}`);
                        // 멤버가 값 없는 객체(`Object DataFile`)면 폴백이 더한 것은 "존재"뿐이다 — 직접 평가의 실패
                        // 원인을 남겨 펼치기/REPL 이 이유(-729 등)를 보일 수 있게 한다(§1-DS). 값을 얻었으면 붙이지 않는다.
                        const hasValue = !!m.value && m.value !== VariableEvaluator.UNDEFINED_VALUE;
                        return {
                            entry: m,
                            members: [],
                            resolvedExpression: `${parent.resolvedExpression}.${leaf}`,
                            error: hasValue ? undefined : first?.error,
                        };
                    }
                }
            }
        }

        return firstResult;
    }

    /**
     * 클래스 객체 노드의 가상 Property 자식(GitHub #26 제안 4). 덤프에 이미 실려 온 멤버 줄에서 백킹 필드 값을 찾으므로
     * 제어기 왕복이 없다. 해석 불가(복잡한 getter·백킹 필드 없음)면 `(프로시저 — 평가 불가)`, WriteOnly는 제외.
     */
    propertyChildren(
        classType: string | undefined,
        members: ParsedVarEntry[],
        parentExpression: string,
        threadName: string,
        frameIndex: number,
    ): DebugProtocol.Variable[] {
        const className = this.symbols.classNameOfType(classType);
        if (!className || members.length === 0) { return []; }
        const props = this.symbols.getPropertyIndex().byClass.get(className.toLowerCase());
        if (!props || props.length === 0) { return []; }
        const bareOf = (e: ParsedVarEntry) => this.memberBareName(e.name, parentExpression);
        const memberNames = new Set(members.map(e => bareOf(e).toLowerCase()));
        const out: DebugProtocol.Variable[] = [];
        const seen = new Set<string>();
        for (const p of props) {
            const key = p.name.toLowerCase();
            if (seen.has(key) || p.hasGetter === false || memberNames.has(key)) { continue; }
            seen.add(key);
            const backing = [p.getterReturnExpr, `m_${p.name}`]
                .filter((b): b is string => !!b && /^[A-Za-z_]\w*$/.test(b))
                .map(b => b.toLowerCase());
            const m = members.find(e => backing.includes(bareOf(e).toLowerCase()));
            const hint: DebugProtocol.VariablePresentationHint = { kind: 'property', attributes: ['readOnly'] };
            if (!m) {
                // 분기형 getter(§1-DS)는 덤프에 실려 온 필드 값으로 계산해 보인다(왕복 없음).
                const branch = p.getterBranch
                    ? evaluateGetterBranch(
                        p.getterBranch,
                        id => members.find(e => bareOf(e).toLowerCase() === id.toLowerCase())?.value,
                        p.returnType,
                    )
                    : undefined;
                if (branch) {
                    const full = `${parentExpression}.${p.name}`;
                    const v = this.makeVariable(p.name, { name: full, type: branch.type, value: branch.value }, threadName, frameIndex, full);
                    out.push({ ...v, value: `${v.value}  ← ${branch.via}`, presentationHint: hint });
                    continue;
                }
                out.push({ name: p.name, value: '(프로시저 — 평가 불가)', variablesReference: 0, presentationHint: hint });
                continue;
            }
            const bare = bareOf(m);
            const v = this.makeVariable(p.name, m, threadName, frameIndex, `${parentExpression}.${bare}`);
            out.push({ ...v, value: `${v.value}  ← ${bare}`, presentationHint: hint });
        }
        return out;
    }

    /** 멤버 전체 경로(`Loc.Pos.X`)에서 부모 식을 제외한 표시용 이름을 얻는다. */
    memberBareName(fullName: string, parentExpression: string): string {
        const prefix = `${parentExpression}.`;
        if (fullName.toLowerCase().startsWith(prefix.toLowerCase())) {
            return fullName.slice(prefix.length);
        }
        const lastDot = fullName.lastIndexOf('.');
        return lastDot >= 0 ? fullName.slice(lastDot + 1) : fullName;
    }

    /**
     * 배열 노드 확장: 선언 크기를 조회할 방법이 없으므로(공식 문서 — 전체 배열 값은
     * 표시되지 않고 요소 단위 조회만 가능) 인덱스 0부터 순차 조회하고 범위 밖(STATUS
     * 오류)에서 멈춘다. 다차원 배열은 첫 인덱스만 순회하고 나머지는 0으로 고정한다.
     */
    async expandArrayElements(
        scope: { threadName: string; frameIndex: number; expression: string; varType: string },
    ): Promise<DebugProtocol.Variable[]> {
        const out: DebugProtocol.Variable[] = [];
        const rank = arrayRank(scope.varType);
        const suffix = rank > 1 ? ',0'.repeat(rank - 1) : '';

        const gen = this.frames.frameCacheGen;
        let i = 0;
        for (; i < VariableEvaluator.ARRAY_EXPAND_MAX; i++) {
            // 확장 도중 새 step/continue가 시작되면(pending 액션/캐시 세대 변경) 즉시
            // 중단해 직렬 명령 큐를 사용자 액션에 양보한다.
            if (this.io.pendingAction || gen !== this.frames.frameCacheGen) {
                out.push({ name: '…', value: '(실행 재개로 조회 중단)', variablesReference: 0 });
                break;
            }
            const elemExpr = `${scope.expression}(${i}${suffix})`;
            const resp = await this.io.sendCmd(
                `Show Variable -eval ${scope.threadName} ${scope.frameIndex} ${elemExpr}`,
                'data',
            );
            if (!resp) {
                // 응답 없음(타임아웃/연결 끊김)은 배열 끝이 아니다 — 실패 표식 후 중단.
                out.push({ name: `(${i}${suffix})`, value: '(조회 실패)', variablesReference: 0 });
                break;
            }
            if (!isSuccess(resp)) { break; } // 범위 밖(STATUS 오류) = 배열 끝
            const entries = parseShowVariableMulti(resp);
            const first = entries[0];
            if (!first) { break; }
            // STATUS 성공이면 값이 빈 문자열이어도 유효한 요소다(빈 String 등) — 계속 진행.
            out.push(this.makeVariable(
                `(${i}${suffix})`,
                first,
                scope.threadName,
                scope.frameIndex,
                elemExpr,
                entries.slice(1),
            ));
        }

        if (i >= VariableEvaluator.ARRAY_EXPAND_MAX) {
            out.push({
                name: '…',
                value: `(${VariableEvaluator.ARRAY_EXPAND_MAX}개까지만 표시 — 이후 요소는 Watch에 ${scope.expression}(${VariableEvaluator.ARRAY_EXPAND_MAX}${suffix}) 형식으로 입력)`,
                variablesReference: 0,
            });
        }
        if (rank > 1) {
            // 이름에 `ℹ` 같은 기호를 쓰지 않는다 — 디버그 hover 글꼴에서 `i` 로 보여 오타처럼 읽힌다(§1-DS).
            out.push({
                name: '(안내)',
                value: `${rank}차원 배열 — 첫 인덱스만 순회(나머지 0 고정). 개별 요소는 Watch에 ${scope.expression}(i${',j'.repeat(rank - 1)}) 형식으로 입력`,
                variablesReference: 0,
                presentationHint: { kind: 'virtual', attributes: ['readOnly'] },
            });
        }
        if (out.length === 0) {
            out.push({
                name: '(요소 없음)',
                value: `요소 조회 실패 — Watch에 ${scope.expression}(0${suffix}) 형식으로 확인 가능`,
                variablesReference: 0,
            });
        }
        return out;
    }

    /** `Show Global <name>` 1회 조회 — 성공 시 표시용 값, 실패 시 ''. */
    async readGlobalValueSingle(name: string): Promise<string> {
        const resp = await this.io.sendCmd(
            this.io.projectName
                ? `Show Global ${name}, ${this.io.projectName}`
                : `Show Global ${name}`,
            'data',
        );
        if (!resp || !isSuccess(resp)) {
            return '';
        }

        const parsedEval = this.parseShowVariableEval(resp);
        if (parsedEval.value && parsedEval.value !== VariableEvaluator.UNDEFINED_VALUE) {
            return parsedEval.type
                ? `${parsedEval.value}  (${parsedEval.type})`
                : parsedEval.value;
        }

        const parsedVars = parseVariable(resp);
        if (parsedVars.length > 0) {
            return parsedVars.map(v => `${v.name} = ${v.value}`).join(', ');
        }

        const cleaned = resp
            .replace(/<STATUS>[\s\S]*?<\/STATUS>/gi, '')
            .replace(/<[^>]+>/g, '')
            .trim();
        const lines = cleaned.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        return lines.length > 0 ? lines.join(', ') : '';
    }

    /**
     * `gpl.debug.integerHex` 가 켜져 있으면 정수 값에 16진수 표기를 병기한다
     * (`&H` 는 GPL 의 16진수 리터럴 표기 — DataID 마스크·비트 플래그를 읽을 때 유용).
     * 값이 정수가 아니면 그대로 돌려준다. VS Code 는 DAP `supportsValueFormattingOptions` 를
     * 소비하지 않으므로(1.135 번들 확인) 표준 hex 토글 대신 이 설정으로 제공한다.
     */
    private withHexHint(value: string): string {
        if (!this.integerHexEnabled()) { return value; }
        const text = value.trim();
        if (!/^-?\d+$/.test(text)) { return value; }
        const n = Number(text);
        if (!Number.isSafeInteger(n) || (n > -16 && n < 16)) { return value; }
        const hex = n < 0
            ? `-&H${Math.abs(n).toString(16).toUpperCase()}`
            : `&H${n.toString(16).toUpperCase()}`;
        return `${value} (${hex})`;
    }

    /** `gpl.debug.integerHex`(기본 false): 정수 값에 16진수 표기를 병기. */
    private integerHexEnabled(): boolean {
        return this.io.integerHexEnabled();
    }

    /**
     * 전역 행에 "쓰기 가능한가"를 표시한다.
     * `Private` 모듈 전역은 표기와 무관하게 쓸 수 없다(실기기 확인 2026-08-31) — 값 편집은
     * `Execute`로 하는데 그것은 별도 쓰레드 `_Cmd_<project>`의 전역 스코프에서 실행되어
     * 모듈 밖에서는 이름이 보이지 않기 때문이다. 반면 읽기는 정지한 프레임 컨텍스트라 된다.
     * 그래서 읽기는 종전대로 보여 주고(디버깅에 필요한 상태는 대개 Private `m_*`에 있다),
     * 성공할 수 없는 편집 제스처만 DAP `readOnly` 힌트로 막는다.
     */
    markGlobalWritability(
        variable: DebugProtocol.Variable,
        descriptor: GlobalVariableDescriptor,
    ): DebugProtocol.Variable {
        if (!descriptor.isPrivate) { return variable; }
        variable.presentationHint = {
            ...variable.presentationHint,
            visibility: 'private',
            attributes: [...(variable.presentationHint?.attributes ?? []), 'readOnly'],
        };
        return variable;
    }

    /**
     * 전역 값 쓰기에 시도할 이름 표기 순서.
     * 조회는 `Mod.Name` → `Name` 사다리를 타고 성공한 표기를 _globalQueryMemo에 남기므로,
     * 쓰기도 같은 표기를 먼저 쓴다(그 다음 남은 표기를 -729 시 재시도).
     */
    globalWriteCandidates(displayName: string): string[] {
        const names: string[] = [];
        const add = (n: string | undefined) => {
            if (n && !names.some(x => x.toLowerCase() === n.toLowerCase())) { names.push(n); }
        };
        const memo = this.globalQueryMemo.get(displayName.toLowerCase());
        if (memo && memo !== 'none' && memo.method === 'global') { add(memo.name); }
        add(displayName);
        const dot = displayName.lastIndexOf('.');
        if (dot > 0) { add(displayName.slice(dot + 1)); }
        return names;
    }

    /**
     * 변수 쓰기 실패 STATUS를 사용자 안내 문구로 바꾼다.
     * 실기기 확인(2026-08-31, GPL 4.2K5 시뮬레이터): `Private` 모듈 전역은 표기(`Mod.Name`·`Name`)와
     * 무관하게 -729다. 값 읽기는 정지한 쓰레드의 프레임 컨텍스트(모듈 안)에서 하지만,
     * 쓰기에 쓰는 `Execute`는 별도 쓰레드 `_Cmd_<project>`의 전역 스코프에서 실행돼
     * 모듈 밖에서는 이름이 보이지 않기 때문이다 — 즉 이 조합은 원리상 읽기만 된다.
     */
    formatSetVariableError(
        status: { code: number; message: string },
        scopeType: string,
        targetName: string,
    ): string {
        const base = `변수 설정 실패 (STATUS ${status.code}${status.message ? `: ${status.message}` : ''})`;
        if (status.code !== UNDEFINED_SYMBOL_STATUS) { return base; }
        if (scopeType === 'globals'
            && this.symbols.getGlobalVariableDescriptors().some(
                g => g.displayName.toLowerCase() === targetName.toLowerCase() && g.isPrivate,
            )) {
            return `${base} — \`${targetName}\`은 Private 모듈 전역이라 값을 쓸 수 없습니다.`
                + ' 쓰기에 쓰는 Execute는 별도 쓰레드(_Cmd_<프로젝트>)의 전역 스코프에서 실행돼'
                + ' 모듈 밖에서는 이 이름이 보이지 않습니다(읽기는 정지한 프레임 컨텍스트라 가능).'
                + ' 값을 바꾸려면 선언을 Public으로 바꾸거나, 같은 모듈의 Public Sub/Property를 통해 설정하세요';
        }
        return `${base} — 이 실행 컨텍스트에서 \`${targetName}\` 이름을 찾지 못했습니다`
            + ' (Execute는 별도 쓰레드의 전역 스코프에서 실행되므로 프레임 로컬·Private 모듈 변수는 보이지 않습니다)';
    }

    getCachedEvaluate(key: string): { value: string; ref: number; type?: string } | undefined {
        const entry = this.evaluateCache.get(key);
        if (!entry) { return undefined; }
        if (Date.now() - entry.timestamp > VariableEvaluator.EVALUATE_CACHE_TTL_MS) {
            this.evaluateCache.delete(key);
            return undefined;
        }
        return { value: entry.value, ref: entry.ref, type: entry.type };
    }

    setCachedEvaluate(key: string, value: string, ref = 0, type?: string): void {
        this.evaluateCache.set(key, { value, ref, type, timestamp: Date.now() });
        if (this.evaluateCache.size > 200) {
            const oldestKey = this.evaluateCache.keys().next().value;
            if (oldestKey !== undefined) {
                this.evaluateCache.delete(oldestKey);
            }
        }
    }

    clearEvaluateCache(): void {
        this.evaluateCache.clear();
    }

    /** 배열 확장 시 순차 조회 상한 — 선언 크기를 알 수 없어(공식 문서: 배열 전체 값은
     *  표시되지 않음) 인덱스 0부터 실패할 때까지 조회하며, 직렬 명령 큐 보호를 위해 제한한다. */
    private static readonly ARRAY_EXPAND_MAX = 30;

    /** 변수 조회 실패/값 없음을 나타내는 표시용 센티널 값. */
    static readonly UNDEFINED_VALUE = '(undefined)';

    // Evaluate cache — hover/watch 반복 조회가 1402 명령 큐를 막지 않게 한다.
    // 정지 중 값은 불변에 가깝고(step/continue 시 _clearStaleState, setVariable/REPL 명령 시
    // _clearEvaluateCache가 무효화) TTL을 늘려 같은 변수 재호버를 즉시 응답한다 (750→3000ms).
    private static readonly EVALUATE_CACHE_TTL_MS = 3000;

    /** 단일 Debug Console 입력을 기존 안전 정책에 따라 평가하거나 제어기로 보낸다. */
    async evaluateReplEntry(
        entry: ReplInputEntry,
        threadName: string | undefined,
        frameIndex: number,
        skipStateChangeConfirmation: boolean,
    ): Promise<{ result: string; type?: string }> {
        const expression = entry.expression;
        let result = '';
        let evalType: string | undefined;
        let evalError: { code: number; message: string } | undefined;

        if (!entry.forceRaw && threadName) {
            const structured = await this.queryVariableStructuredSmart(
                threadName, frameIndex, expression,
            );
            if (structured) {
                evalError = structured.error;
                const kind = classifyVarEntry(structured.entry, structured.members.length > 0);
                if (kind === 'object' && structured.members.length > 0) {
                    // 객체는 응답의 멤버 줄 전체를 보여준다 (기존: 첫 줄만 파싱해 "Object"만 표시).
                    // Location은 한 줄 요약을 헤더에 덧붙이고, 2열 멤버(타입 없음)는 빈 칸 없이 잇는다(GitHub #27).
                    const locSummary = isLocationType(structured.entry.type)
                        ? summarizeLocation(structured.members)
                        : undefined;
                    result = [
                        `${structured.entry.name || expression}, ${structured.entry.type || 'Object'}${locSummary ? `  ${locSummary}` : ''}`,
                        ...structured.members.map(m => `  ${[m.name, m.type, m.value].filter(Boolean).join(', ')}`),
                    ].join('\n');
                } else if (kind === 'object') {
                    // 멤버 줄이 없는 객체(중첩 객체 멤버 등, §1-DS) — 타입은 알려 주고 멤버를 못 받은 이유를 붙인다.
                    const row = describeNestedExpandFailure({
                        expression, varType: structured.entry.type, error: structured.error,
                    });
                    result = `${structured.entry.name || expression}, ${structured.entry.type || 'Object'}\n  ${row.value}`;
                } else if (kind === 'array') {
                    result = `${structured.entry.type} 배열 — 요소는 ${expression}(i) 형식으로 조회`;
                } else if (structured.entry.value && structured.entry.value !== VariableEvaluator.UNDEFINED_VALUE) {
                    result = structured.entry.type
                        ? `${structured.entry.value}  (${structured.entry.type})`
                        : structured.entry.value;
                    evalType = dapColorizeType(structured.entry.type, structured.entry.value);
                } else if (/\bnull\s*$/i.test(structured.entry.type)) {
                    result = `null  (${structured.entry.type})`;
                }
                if (result && structured.via) { result += `\n  ← ${structured.via}`; }
            }
            if (!result && this.io.projectName) {
                const gResp = await this.io.sendCmd(
                    `Show Global ${expression}, ${this.io.projectName}`,
                    'data',
                );
                if (gResp) {
                    const lines = this.showGlobalResponseLines(gResp);
                    if (lines.length > 0) { result = lines.join('\n'); }
                }
            }
        }

        // 변수 평가가 불가하거나 멈춘 쓰레드가 없으면 임의 제어기 명령 경로를 검토한다.
        if (!result && expression) {
            const readOnly = isReadOnlyConsoleCommand(expression);
            if (!entry.forceRaw && !readOnly) {
                // 비접두사 폴백은 읽기 전용만 허용한다. 알려진 상태 변경 명령이면
                // "평가 실패"보다 미전송 사실과 `>` 사용법을 먼저 보여 준다.
                const evaluationFailure = evalError
                    ? formatEvalError(expression, evalError)
                    : undefined;
                result = formatBlockedReplInput(expression, evaluationFailure);
            } else {
                let approved = true;
                if (!readOnly && !skipStateChangeConfirmation) {
                    approved = await this.io.confirmStateChangingCommand(expression);
                }
                if (!approved) {
                    result = '(취소됨)';
                } else {
                    const raw = await this.io.sendCmd(expression);
                    if (raw === null) {
                        result = '(제어기 미연결 — 디버그 세션/연결 상태를 확인하세요)';
                    } else {
                        const cleaned = raw.replace(/<[^>]+>/g, '').trim();
                        result = cleaned.length > 0 ? cleaned : '(ok)';
                    }
                    // 임의 명령은 제어기 상태를 바꿀 수 있으므로 hover/watch 캐시와
                    // 프레임 캐시 신선도를 함께 무효화한다 (예: >Step 뒤 옛 스택 방지).
                    this.clearEvaluateCache();
                    this.frames.invalidateFreshness();
                }
            }
        }

        return { result: result || '(평가 불가)', type: evalType };
    }

    /** 로그포인트 메시지의 `{식}` 을 정지 프레임에서 평가해 치환한다. 평가 실패는 `<?>`로 남긴다. */
    async interpolateLogMessage(message: string, threadName: string): Promise<string> {
        const parts = message.split(/(\{[^}]*\})/);
        let out = '';
        for (const part of parts) {
            const m = part.match(/^\{([^}]*)\}$/);
            if (!m) { out += part; continue; }
            const expr = m[1].trim();
            if (!expr) { out += part; continue; }
            const value = await this.queryVariableStructuredSmart(threadName, 0, expr);
            out += value?.entry?.value ?? '<?>';
        }
        return out;
    }

    /** 조건식을 정지 프레임에서 평가해 참/거짓으로 해석한다. 판정 불가는 undefined. */
    async evaluateBooleanCondition(condition: string, threadName: string): Promise<boolean | undefined> {
        const res = await this.queryVariableStructuredSmart(threadName, 0, condition);
        const raw = (res?.entry?.value ?? '').trim();
        if (!raw) { return undefined; }
        if (/^(true|-1)$/i.test(raw)) { return true; }
        if (/^(false|0)$/i.test(raw)) { return false; }
        const num = Number(raw);
        if (!Number.isNaN(num)) { return num !== 0; }
        return undefined;
    }
}
