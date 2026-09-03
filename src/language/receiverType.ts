/**
 * 멤버 접근 체인(`a(0).b.c`)의 수신자(receiver) 타입 정적 해석 — vscode 무의존 순수 모듈.
 *
 * 배경(GitHub #32): 디버그 hover 게이트(evaluatableExpressionProvider)·정적 hover(hoverProvider)·디버그 어댑터의
 * 백킹 필드 후보가 모두 `.` 앞 수신자를 버리고 **마지막 이름만으로** 심볼을 찾아, 다른 클래스의 동명 Sub/Function
 * 때문에 해석 가능한 Property의 디버그 hover가 차단되고 정적 hover는 엉뚱한 클래스의 시그니처를 보였다.
 * completionProvider/definitionProvider에 각자 있던 `returnType` 체이닝 규칙을 여기로 모아 공유한다
 * (그 두 provider의 자체 구현은 그대로 두었다 — 점진 이관 대상).
 *
 * 해석 규칙
 * - 첫 세그먼트: `Me` → 감싸는 클래스 / 로컬·파라미터의 타입 / 클래스·모듈 이름(정적 접근) /
 *   타입 있는 비-로컬 심볼(감싸는 클래스의 필드 우선).
 * - 이후 세그먼트: 홀더(클래스/모듈)의 멤버 `returnType`으로 하강. 멤버가 없으면 중첩 클래스(`Outer.Inner`,
 *   `Module.Class`)로 하강.
 * - 인덱싱(`x(0)`)이 붙은 배열 타입 `T[]`/`T()`는 요소 타입 `T`. 인덱싱 없는 배열은 내장 Array라 실패.
 * - 원시 타입·내장 클래스·미해석은 undefined — 호출자는 종전 이름 기반 보수 판정으로 폴백한다(안전 규칙 유지).
 *   내장 클래스 타입(`Dim t As Thread`, 정적 접근 `Thread.…`)이 필요하면 홀더 대신 resolveReceiverTypeName으로
 *   타입 이름을 얻는다. 내장 멤버의 반환 타입(`Thread.CurrentThread` → Thread)도 ReceiverBuiltins 훅이
 *   있으면 체인 하강에 쓰인다 — `Thread.CurrentThread.Name`의 `Name`을 Thread 멤버로 판정하기 위한 전제다.
 */
import { GPLSymbol, GPLSymbolKind } from '../gplParser';

/** 체인 세그먼트 — cursorExpression.DebugExpressionSegment와 같은 모양(`args`가 있으면 괄호 그룹 동반). */
export interface ReceiverSegment {
    name: string;
    args?: string;
}

/** 멤버를 가진 홀더 — 사용자 클래스 또는 모듈(정적 접근). */
export type ReceiverHolder =
    | { kind: 'class'; name: string }
    | { kind: 'module'; name: string };

/**
 * 내장(GPL Dictionary) 클래스 정보 훅. 이 모듈은 vscode 무의존을 유지해야 하므로 사전을
 * 직접 import하지 않고 호출부(providers)가 gplBuiltins 어댑터를 넣어 준다.
 * 없으면 내장 타입 해석만 빠지고 사용자 심볼 해석은 종전과 같다.
 */
export interface ReceiverBuiltins {
    /** 이름이 내장 클래스인지(대소문자 무시) — 정적 접근 `Thread.…`의 첫 세그먼트 해석용. */
    isClassName(name: string): boolean;
    /** 내장 멤버의 반환 타입 이름(`Thread`,`CurrentThread` → `'Thread'`). 사전에 없으면 undefined. */
    memberReturnType(typeName: string, memberName: string): string | undefined;
}

export interface ReceiverLookup {
    /** 커서를 감싸는 프로시저 스코프의 로컬/파라미터. 없으면 undefined. */
    findLocal(name: string): GPLSymbol | undefined;
    /** 비-로컬 심볼 이름 조회(워크스페이스 캐시 + 현재 문서 모듈 레벨). */
    findAllByName(name: string): GPLSymbol[];
    /** 커서를 감싸는 클래스 이름(`Me.` 해석용). */
    enclosingClassName?: string;
    /** 내장 클래스 사전 훅(선택). */
    builtins?: ReceiverBuiltins;
}

/** 멤버 하강 대상이 아닌 원시 타입(completionProvider와 동일 집합 — String은 내장 클래스이므로 제외). */
const PRIMITIVE_TYPES = new Set(['integer', 'double', 'single', 'boolean', 'byte', 'short', 'long', 'object']);

const ci = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

const isProcedureKind = (k: GPLSymbolKind): boolean =>
    k === GPLSymbolKind.Sub || k === GPLSymbolKind.Function || k === GPLSymbolKind.Property;

/**
 * 타입 이름에서 멤버 하강에 쓸 이름을 얻는다.
 * `T[]`/`T()`/`T(,)` 배열은 인덱싱이 있을 때만 요소 타입 `T`로 벗기고, 인덱싱 없는 배열은 undefined(내장 Array).
 */
export function elementTypeOf(typeName: string, indexed: boolean): string | undefined {
    const t = typeName.trim();
    const arr = t.match(/^(.*?)\s*(?:\[\]|\(\s*,*\s*\))$/);
    if (arr) {
        return indexed ? (arr[1].trim() || undefined) : undefined;
    }
    return t || undefined;
}

function holderNamed(name: string, lookup: ReceiverLookup): ReceiverHolder | undefined {
    const syms = lookup.findAllByName(name);
    const cls = syms.find(s => s.kind === GPLSymbolKind.Class);
    if (cls) { return { kind: 'class', name: cls.name }; }
    const mod = syms.find(s => s.kind === GPLSymbolKind.Module);
    if (mod) { return { kind: 'module', name: mod.name }; }
    return undefined;
}

/**
 * 선언 타입 문자열에서 멤버 하강에 쓸 **타입 이름**을 얻는다(사용자/내장 구분 없이).
 * 원시 타입과 인덱싱 없는 배열은 undefined.
 */
function typeNameOfType(typeName: string | undefined, indexed: boolean): string | undefined {
    if (!typeName) { return undefined; }
    const t = elementTypeOf(typeName, indexed);
    if (!t || PRIMITIVE_TYPES.has(t.toLowerCase())) { return undefined; }
    return t;
}

/**
 * 타입 이름 `typeName`에서 세그먼트 `seg`로 한 단계 하강해 **타입 이름**을 얻는다.
 * 사용자 클래스/모듈이면 멤버의 returnType(또는 중첩 타입 선언), 내장 클래스면 사전의 반환 타입.
 */
function descendTypeName(lookup: ReceiverLookup, typeName: string, seg: ReceiverSegment): string | undefined {
    const holder = holderNamed(typeName, lookup);
    if (holder) {
        const typed = membersNamed(lookup, holder, seg.name).find(m => m.returnType);
        if (typed?.returnType) {
            return typeNameOfType(typed.returnType, seg.args !== undefined);
        }
        if (seg.args === undefined) {
            // 중첩 클래스 하강: Outer.Inner → Inner / Module.Class → Class
            const nested = nestedTypesIn(lookup, holder, seg.name)[0];
            if (nested) { return nested.name; }
        }
        return undefined;
    }
    // 내장 클래스 멤버 하강(`Thread.CurrentThread` → Thread). 훅이 없으면 종전처럼 미해석.
    return typeNameOfType(lookup.builtins?.memberReturnType(typeName, seg.name), seg.args !== undefined);
}

// ─── 소속(스코프) 판정 ──────────────────────────────────────────────────────────────────
// 파서의 표기 규칙 하나만 알면 되는 순수 판정이라 여기 모아 둔다 — 이 비대칭을 모르고
// `className`/`module` 유무로 소속을 판정하면 클래스·모듈 심볼이 **자기 자신에 속한 것**이 된다.

/**
 * 감싸는 클래스 이름. **Class 심볼의 `className`은 자기 이름**이므로(파서: `className: currentClass`)
 * 그대로 쓰면 자기를 가리킨다 — 중첩 클래스를 감싸는 클래스는 `parentClassName`이고,
 * 모듈 최상위 클래스는 감싸는 클래스가 없다(undefined).
 */
export function enclosingClassName(sym: GPLSymbol): string | undefined {
    return sym.kind === GPLSymbolKind.Class ? sym.parentClassName : sym.className;
}

/** 감싸는 모듈 이름. **Module 심볼의 `module`도 자기 이름**이라 모듈 자신은 undefined다. */
export function enclosingModuleName(sym: GPLSymbol): string | undefined {
    return sym.kind === GPLSymbolKind.Module ? undefined : sym.module;
}

/**
 * 심볼이 홀더(클래스/모듈)에 **직접** 선언돼 있는지 — 멤버와 중첩 타입 선언을 함께 만족한다.
 * `membersNamed`(멤버만)·`nestedTypesIn`(클래스 선언만)은 여기에 종류 조건만 덧붙인 것이고,
 * 둘을 합친 것이 `ownedByHolder`다.
 */
export function isDeclaredIn(sym: GPLSymbol, holder: ReceiverHolder): boolean {
    const cls = enclosingClassName(sym);
    if (holder.kind === 'class') {
        return cls !== undefined && ci(cls, holder.name);
    }
    const mod = enclosingModuleName(sym);
    return cls === undefined && mod !== undefined && ci(mod, holder.name);
}

/** 홀더의 멤버 중 이름이 `name`인 것 전부(오버로드 포함, 로컬/파라미터 제외). 클래스 선언은 `nestedTypesIn`이 맡는다. */
export function membersNamed(lookup: ReceiverLookup, holder: ReceiverHolder, name: string): GPLSymbol[] {
    return lookup.findAllByName(name)
        .filter(s => !s.isLocal && !s.isParameter && s.kind !== GPLSymbolKind.Class && isDeclaredIn(s, holder));
}

/** 홀더 안에 **직접 선언된** 중첩 타입 중 이름이 일치하는 것 (`Outer.Inner`, `Module.Class`). */
export function nestedTypesIn(lookup: ReceiverLookup, holder: ReceiverHolder, name: string): GPLSymbol[] {
    return lookup.findAllByName(name)
        .filter(s => s.kind === GPLSymbolKind.Class && isDeclaredIn(s, holder));
}

/**
 * 홀더에 **속한** 심볼 전부 — 멤버(membersNamed) + 중첩 타입 선언(nestedTypesIn).
 *
 * "한정자를 버린 전역 이름 검색"의 안전한 대체품이다. `Module.Member` / `Class.Member`를
 * 해석할 때 종류별 좁은 조회가 모두 실패해도, 이름만으로 워크스페이스를 뒤져 남의 심볼로
 * 점프하는 대신 이 함수로 소속을 확인한 후보만 쓴다.
 */
export function ownedByHolder(lookup: ReceiverLookup, holder: ReceiverHolder, name: string): GPLSymbol[] {
    const members = membersNamed(lookup, holder, name);
    const nested = nestedTypesIn(lookup, holder, name).filter(n => !members.includes(n));
    return nested.length === 0 ? members : [...members, ...nested];
}

function descend(lookup: ReceiverLookup, holder: ReceiverHolder, seg: ReceiverSegment): ReceiverHolder | undefined {
    const t = descendTypeName(lookup, holder.name, seg);
    return t ? holderNamed(t, lookup) : undefined;
}

/**
 * 체인 첫 세그먼트의 타입 이름을 해석한다.
 * `Me` → 감싸는 클래스 / 로컬·파라미터의 타입 / 클래스·모듈 이름(정적 접근) / 타입 있는 비-로컬 심볼 순.
 */
function firstSegmentTypeName(first: ReceiverSegment, lookup: ReceiverLookup): string | undefined {
    const indexed = first.args !== undefined;

    if (!indexed && /^me$/i.test(first.name)) {
        return lookup.enclosingClassName;
    }

    const local = lookup.findLocal(first.name);
    if (local) {
        // 로컬/파라미터가 있으면 그것이 정답(동명 모듈 심볼을 가린다) — 타입을 모르면 실패
        return typeNameOfType(local.returnType, indexed);
    }

    // 클래스/모듈 정적 접근
    const staticHolder = !indexed ? holderNamed(first.name, lookup) : undefined;
    if (staticHolder) {
        return staticHolder.name;
    }

    const named = lookup.findAllByName(first.name).filter(s => !s.isLocal && !s.isParameter && s.returnType);
    const score = (s: GPLSymbol): number =>
        (s.className && lookup.enclosingClassName && ci(s.className, lookup.enclosingClassName)) ? 1 : 0;
    const typed = [...named].sort((a, b) => score(b) - score(a))[0];
    const userType = typeNameOfType(typed?.returnType, indexed);
    if (userType) { return userType; }

    // 내장 클래스의 정적 접근(`Thread.CurrentThread`, `Robot.Where`) — 동명 사용자 심볼이
    // 전혀 없을 때만(사용자 심볼 우선 규칙은 hoverProvider와 동일).
    if (!indexed && lookup.builtins?.isClassName(first.name)) { return first.name; }
    return undefined;
}

/**
 * 수신자 체인(커서 세그먼트 **앞**의 세그먼트들)의 최종 홀더를 해석한다. 실패하면 undefined.
 * 예) `robotArmList(0).controlAxis`의 controlAxis → receiver=[{robotArmList, args:'0'}] → 로컬 `RobotArm[]` → class RobotArm
 */
export function resolveReceiverHolder(receiver: ReceiverSegment[], lookup: ReceiverLookup): ReceiverHolder | undefined {
    if (receiver.length === 0) { return undefined; }
    const firstName = firstSegmentTypeName(receiver[0], lookup);
    let current: ReceiverHolder | undefined = firstName ? holderNamed(firstName, lookup) : undefined;

    for (let i = 1; current && i < receiver.length; i++) {
        current = descend(lookup, current, receiver[i]);
    }
    return current;
}

/**
 * 수신자 체인의 최종 **타입 이름**을 해석한다. 사용자 클래스/모듈뿐 아니라 내장 클래스
 * (`Dim t As Thread` → `'Thread'`)도 그대로 돌려주므로, 호출부가 내장 사전에서 멤버를 찾을 수 있다.
 * resolveReceiverHolder는 사용자 심볼로 해석되는 것만 반환하므로 내장 타입에는 쓸 수 없다.
 */
export function resolveReceiverTypeName(receiver: ReceiverSegment[], lookup: ReceiverLookup): string | undefined {
    if (receiver.length === 0) { return undefined; }
    // 타입 이름 단위로 하강한다 — 사용자 클래스/모듈과 내장 클래스(사전 반환 타입)를 섞어 통과할 수 있다.
    let typeName = firstSegmentTypeName(receiver[0], lookup);
    for (let i = 1; typeName && i < receiver.length; i++) {
        typeName = descendTypeName(lookup, typeName, receiver[i]);
    }
    return typeName;
}

/**
 * 문서 심볼(includeLocals·includeParameters 파싱 결과) + 워크스페이스 캐시로 ReceiverLookup을 만든다.
 * 로컬/파라미터는 `procRange`(커서를 감싸는 프로시저 범위) 안의 것만 보고, 같은 이름이 여럿이면
 * 사용 위치보다 위의 가장 가까운 선언을 고른다(hoverProvider.findEnclosingLocalSymbol과 같은 규칙).
 */
export function buildDocumentReceiverLookup(
    docSymbols: GPLSymbol[],
    procRange: { startLine: number; endLine: number } | undefined,
    atLine: number,
    cacheFindAllByName: (name: string) => GPLSymbol[],
    builtins?: ReceiverBuiltins,
): ReceiverLookup {
    const inScope = (s: GPLSymbol): boolean =>
        !!procRange && s.line >= procRange.startLine && s.line <= procRange.endLine;
    const procedures = docSymbols.filter(s => !s.isLocal && !s.isParameter && isProcedureKind(s.kind));
    // 헤더 라인의 프로시저 심볼. 파서 라인이 어긋나면 범위 안(헤더~커서)에서 가장 가까운 것으로 폴백한다.
    const enclosingProc = procRange
        ? (procedures.find(s => s.line === procRange.startLine)
            ?? [...procedures]
                .filter(s => s.line >= procRange.startLine && s.line <= atLine)
                .sort((a, b) => b.line - a.line)[0])
        : undefined;

    return {
        enclosingClassName: enclosingProc?.className,
        builtins,
        findLocal(name: string): GPLSymbol | undefined {
            const locals = docSymbols.filter(s => (s.isLocal || s.isParameter) && ci(s.name, name) && inScope(s));
            if (locals.length === 0) { return undefined; }
            const above = locals.filter(s => s.line <= atLine).sort((a, b) => b.line - a.line);
            return above[0] ?? [...locals].sort((a, b) => a.line - b.line)[0];
        },
        findAllByName(name: string): GPLSymbol[] {
            const seen = new Set<string>();
            const out: GPLSymbol[] = [];
            const fromDoc = docSymbols.filter(s => !s.isLocal && !s.isParameter && ci(s.name, name));
            for (const s of [...fromDoc, ...cacheFindAllByName(name)]) {
                const key = `${s.filePath}:${s.line}:${s.kind}:${s.name}`.toLowerCase();
                if (seen.has(key)) { continue; }
                seen.add(key);
                out.push(s);
            }
            return out;
        },
    };
}
