/**
 * 멤버 접근 체인(`a(0).b.c`)의 수신자(receiver) 타입 정적 해석 — vscode 무의존 순수 모듈.
 *
 * 배경(GitHub #32): 디버그 hover 게이트(evaluatableExpressionProvider)·정적 hover(hoverProvider)·디버그 어댑터의
 * 백킹 필드 후보가 모두 `.` 앞 수신자를 버리고 **마지막 이름만으로** 심볼을 찾아, 다른 클래스의 동명 Sub/Function
 * 때문에 해석 가능한 Property의 디버그 hover가 차단되고 정적 hover는 엉뚱한 클래스의 시그니처를 보였다.
 * completionProvider/definitionProvider에 각자 있던 `returnType` 체이닝 규칙을 여기로 모아 공유한다
 * (completionProvider는 2026-09-10에 이관 완료 — resolveReceiverTarget. definitionProvider는 남은 이관 대상).
 * 자체 구현이 남아 있으면 이런 차이가 생긴다: 완성 provider는 내장 멤버의 반환 타입을 몰라
 * `Thread.CurrentThread().` 뒤를 미해석으로 떨어뜨렸고, 그 폴백이 `Thread.Abort`를 통째로 삽입했다.
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
import { GPLSymbol, GPLSymbolKind } from './gplParser';

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
 * 멤버 조회 대상 — 홀더(사용자 클래스/모듈)에 내장 클래스와 "멤버 없는 원시 타입"을 더한 것.
 * 완성 목록처럼 **어느 사전에서 멤버를 꺼낼지**까지 알아야 하는 호출부가 쓴다(resolveReceiverTarget).
 */
export type ReceiverTarget =
    | ReceiverHolder
    | { kind: 'builtinClass'; name: string }
    | { kind: 'primitive'; name: string };

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
    /** 커서를 감싸는 모듈 이름 — 한정자 없는 이름의 렉시컬 해석(감싸는 클래스 → 감싸는 모듈)에 쓴다. 모르면 undefined. */
    enclosingModuleName?: string;
    /** 내장 클래스 사전 훅(선택). */
    builtins?: ReceiverBuiltins;
}

/** 배열 타입 표기(`Foo[]`·`Foo()`·`Foo(,)`) — 파서가 `[]`로 정규화하지만 손으로 쓴 표기도 받는다. */
const ARRAY_TYPE_SUFFIX = /^(.*?)\s*(?:\[\]|\(\s*,*\s*\))$/;

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
    const arr = t.match(ARRAY_TYPE_SUFFIX);
    if (arr) {
        return indexed ? (arr[1].trim() || undefined) : undefined;
    }
    return t || undefined;
}

/**
 * 타입 표기가 배열인지 — `Foo[]` · `Foo()` · `Foo(,)`.
 * 요소 타입이 필요하면 `elementTypeOf`. 배열 표기 규칙은 이 파일 하나가 정본이다(SSOT).
 */
export function isArrayTypeName(typeName: string): boolean {
    return ARRAY_TYPE_SUFFIX.test(typeName.trim());
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
 * 한 단계 해석 결과 — 타입 이름과 "멤버가 없는 원시 타입" 표시.
 *
 * 타입 이름만 돌려주면 `미해석`과 `원시 타입(Integer 등)`이 같은 undefined가 되어,
 * 호출부가 둘을 구분할 수 없다(완성 목록에서 `i.` 뒤는 **빈 목록**이어야 하고,
 * 미해석은 폴백이어야 한다). 그래서 내부 하강은 이 구조로 하고,
 * 이름만 필요한 기존 API는 원시 타입을 undefined로 접어 종전 동작을 유지한다.
 */
interface TypeResolution {
    name: string;
    /** 멤버가 없는 원시 타입(Integer/Boolean/…) — 더 하강할 수 없다. */
    primitive: boolean;
}

/** 선언 타입 문자열의 해석. 인덱싱 없는 배열(내장 Array)·빈 이름은 undefined. */
function typeResolutionOfType(typeName: string | undefined, indexed: boolean): TypeResolution | undefined {
    if (!typeName) { return undefined; }
    const t = elementTypeOf(typeName, indexed);
    if (!t) { return undefined; }
    return { name: t, primitive: PRIMITIVE_TYPES.has(t.toLowerCase()) };
}

/** 원시 타입을 접어 이름만 돌려주는 형태(종전 API 호환). */
function nameOf(res: TypeResolution | undefined): string | undefined {
    return res && !res.primitive ? res.name : undefined;
}

/**
 * 타입 이름 `typeName`에서 세그먼트 `seg`로 한 단계 하강해 **타입 이름**을 얻는다.
 * 사용자 클래스/모듈이면 멤버의 returnType(또는 중첩 타입 선언), 내장 클래스면 사전의 반환 타입.
 */
function descendType(lookup: ReceiverLookup, typeName: string, seg: ReceiverSegment): TypeResolution | undefined {
    const holder = holderNamed(typeName, lookup);
    if (holder) {
        const typed = membersNamed(lookup, holder, seg.name).find(m => m.returnType);
        if (typed?.returnType) {
            return typeResolutionOfType(typed.returnType, seg.args !== undefined);
        }
        if (seg.args === undefined) {
            // 중첩 클래스 하강: Outer.Inner → Inner / Module.Class → Class
            const nested = nestedTypesIn(lookup, holder, seg.name)[0];
            if (nested) { return { name: nested.name, primitive: false }; }
        }
        return undefined;
    }
    // 내장 클래스 멤버 하강(`Thread.CurrentThread` → Thread). 훅이 없으면 종전처럼 미해석.
    return typeResolutionOfType(
        lookup.builtins?.memberReturnType(typeName, seg.name), seg.args !== undefined);
}

/** descendType의 이름 전용 형태(원시 타입은 undefined). */
function descendTypeName(lookup: ReceiverLookup, typeName: string, seg: ReceiverSegment): string | undefined {
    return nameOf(descendType(lookup, typeName, seg));
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
 * 한정자 없는 이름이 가리키는 타입 있는 비-로컬 심볼 — 그 자리에서 **보이는** 것만, 렉시컬 순서로 찾는다.
 *   감싸는 클래스의 멤버 → 감싸는 모듈 직속 멤버 → 다른 모듈의 직속 Public 멤버(프로젝트 수준).
 * 다른 클래스의 필드는 수신자 없이 보이지 않으므로 후보가 아니다 — 종전에는 이름만 맞으면 다른 클래스의
 * `value As Integer` 가 감싸는 모듈의 `value As String` 을 이겨 오버로드를 잘못 골랐다(PR #38 리뷰).
 * 한 단계 안에서 후보의 타입이 갈리면(같은 이름이 여러 모듈에) 모른다(undefined) — 오판 대신 판단 보류.
 */
function typedNonLocal(lookup: ReceiverLookup, name: string): GPLSymbol | undefined {
    const named = lookup.findAllByName(name).filter(s => !s.isLocal && !s.isParameter && s.returnType);
    if (named.length === 0) { return undefined; }
    const unique = (list: GPLSymbol[]): GPLSymbol | undefined =>
        list.every(s => ci(s.returnType!, list[0].returnType!)) ? list[0] : undefined;
    const scopes: ReceiverHolder[] = [];
    if (lookup.enclosingClassName) { scopes.push({ kind: 'class', name: lookup.enclosingClassName }); }
    if (lookup.enclosingModuleName) { scopes.push({ kind: 'module', name: lookup.enclosingModuleName }); }
    for (const holder of scopes) {
        const inScope = named.filter(s => isDeclaredIn(s, holder));
        if (inScope.length > 0) { return unique(inScope); }
    }
    // 프로젝트 수준 — 클래스 밖(모듈 직속)이고 Private 이 아닌 것. 감싸는 모듈을 알면 그 모듈의 것은 위에서 이미 봤다.
    const outer = named.filter(s => enclosingClassName(s) === undefined && s.accessModifier !== 'private');
    return outer.length > 0 ? unique(outer) : undefined;
}

/**
 * 체인 첫 세그먼트의 타입을 해석한다.
 * `Me` → 감싸는 클래스 / 로컬·파라미터의 타입 / 클래스·모듈 이름(정적 접근) / 타입 있는 비-로컬 심볼 순.
 */
function firstSegmentType(first: ReceiverSegment, lookup: ReceiverLookup): TypeResolution | undefined {
    const indexed = first.args !== undefined;

    if (!indexed && /^me$/i.test(first.name)) {
        return lookup.enclosingClassName ? { name: lookup.enclosingClassName, primitive: false } : undefined;
    }

    const local = lookup.findLocal(first.name);
    if (local) {
        // 로컬/파라미터가 있으면 그것이 정답(동명 모듈 심볼을 가린다) — 타입을 모르면 실패
        return typeResolutionOfType(local.returnType, indexed);
    }

    // 클래스/모듈 정적 접근
    const staticHolder = !indexed ? holderNamed(first.name, lookup) : undefined;
    if (staticHolder) {
        return { name: staticHolder.name, primitive: false };
    }

    const typed = typedNonLocal(lookup, first.name);
    const userType = typeResolutionOfType(typed?.returnType, indexed);
    if (userType && !userType.primitive) { return userType; }

    // 내장 클래스의 정적 접근(`Thread.CurrentThread`, `Robot.Where`) — 동명 사용자 심볼이
    // 전혀 없을 때만(사용자 심볼 우선 규칙은 hoverProvider와 동일).
    if (!indexed && lookup.builtins?.isClassName(first.name)) { return { name: first.name, primitive: false }; }
    return userType; // 원시 타입이면 그대로(멤버 없음), 아니면 undefined
}

/** 체인 첫 세그먼트의 타입 **이름**(원시 타입은 undefined) — 종전 API 호환. */
function firstSegmentTypeName(first: ReceiverSegment, lookup: ReceiverLookup): string | undefined {
    return nameOf(firstSegmentType(first, lookup));
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
    const resolved = resolveReceiverChain(receiver, lookup);
    return nameOf(resolved);
}

/**
 * 체인을 타입 단위로 끝까지 하강한다 — 사용자 클래스/모듈과 내장 클래스(사전 반환 타입)를 섞어 통과한다.
 * 중간에 원시 타입이 나오면 더 하강할 곳이 없으므로 미해석(undefined)이다.
 */
function resolveReceiverChain(receiver: ReceiverSegment[], lookup: ReceiverLookup): TypeResolution | undefined {
    if (receiver.length === 0) { return undefined; }
    let current = firstSegmentType(receiver[0], lookup);
    for (let i = 1; current && i < receiver.length; i++) {
        if (current.primitive) { return undefined; }
        current = descendType(lookup, current.name, receiver[i]);
    }
    return current;
}

/**
 * 식(체인) 전체의 **선언 타입 표기** — 오버로드 선택의 인자 타입 추론용.
 *
 * `resolveReceiverTypeName` 은 "멤버를 찾을 홀더"가 목적이라 인덱싱 없는 배열(내장 Array)과 원시 타입을
 * undefined 로 접는다. 인자 대조에는 바로 그 둘이 필요하다 — 배열 인자 `x` ↔ 파라미터 `x()`,
 * `Integer` ↔ `Integer`. 그래서 마지막 세그먼트의 선언 타입을 표기 그대로(`RobotArm[]`, `Integer`) 돌려준다.
 *   - `x` → 로컬/파라미터 → 감싸는 클래스의 필드 → 그 밖의 타입 있는 심볼
 *   - `x(i)` → 배열 변수면 요소 타입, 함수/프로퍼티면 반환 타입
 *   - `Me` → 감싸는 클래스, `a.b.c` → `a.b` 를 홀더로 해석한 뒤 `c` 멤버의 선언 타입
 * 모르면 undefined(중립) — 오판 대신 판단 보류.
 */
export function resolveExpressionType(segments: ReceiverSegment[], lookup: ReceiverLookup): string | undefined {
    if (segments.length === 0) { return undefined; }
    const last = segments[segments.length - 1];
    const indexed = last.args !== undefined;

    let decl: GPLSymbol | undefined;
    if (segments.length === 1) {
        if (!indexed && /^me$/i.test(last.name)) { return lookup.enclosingClassName; }
        decl = lookup.findLocal(last.name) ?? typedNonLocal(lookup, last.name);
    } else {
        const owner = resolveReceiverChain(segments.slice(0, -1), lookup);
        if (!owner || owner.primitive) { return undefined; }
        const holder = holderNamed(owner.name, lookup);
        if (!holder) {
            // 내장 클래스 멤버 — 사전의 반환 타입(인덱싱 의미는 알 수 없어 그대로)
            return lookup.builtins?.memberReturnType(owner.name, last.name);
        }
        decl = membersNamed(lookup, holder, last.name).find(m => m.returnType);
    }

    const type = decl?.returnType;
    if (!decl || !type) { return undefined; }
    if (!indexed || isProcedureKind(decl.kind)) { return type; }
    return elementTypeOf(type, true) ?? type;
}

/**
 * `X.member` 의 한정자 `X` 가 대소문자 무시로 **감싸는 클래스의 멤버**와 Module/Class 이름에 동시에 맞는 경우.
 *
 * GPL 식별자는 대소문자를 가리지 않고, 컴파일러는 가까운 범위(클래스 멤버)를 먼저 잡는다 — `Class RobotUnit` 의
 * `Num()` 멤버가 있으면 그 클래스 안의 `NUM.FixedText(...)` 는 Module `NUM` 이 아니라 멤버로 해석돼
 * -781 이 난다(2026-10-23 SamplePrep 실기). 사용자는 Module 을 의도했으므로 정의 이동은 둘 다(Module 먼저)
 * 보여 주고 호버는 가림 사실을 알린다. 로컬/파라미터가 같은 이름이면 그것이 진짜 수신자라 가림이 아니다(undefined).
 */
export function findQualifierShadowing(
    name: string, lookup: ReceiverLookup,
): { holders: GPLSymbol[]; members: GPLSymbol[] } | undefined {
    if (!lookup.enclosingClassName || lookup.findLocal(name)) { return undefined; }
    const all = lookup.findAllByName(name);
    const holders = all.filter(s => !s.isLocal && !s.isParameter
        && (s.kind === GPLSymbolKind.Module || s.kind === GPLSymbolKind.Class));
    if (holders.length === 0) { return undefined; }
    const members = membersNamed(lookup, { kind: 'class', name: lookup.enclosingClassName }, name);
    if (members.length === 0) { return undefined; }
    const modulesFirst = [...holders].sort((a, b) =>
        (a.kind === GPLSymbolKind.Module ? 0 : 1) - (b.kind === GPLSymbolKind.Module ? 0 : 1));
    return { holders: modulesFirst, members };
}

/**
 * 멤버 목록을 제공할 **대상**으로 체인을 해석한다 (완성 목록용).
 *
 * `resolveReceiverTypeName`과 달리 (1) 내장 클래스인지 사용자 클래스/모듈인지 구분해 주고,
 * (2) 멤버가 없는 원시 타입(`i.`)을 미해석과 구분해 준다 — 호출부가 원시 타입에는 **빈 목록**을,
 * 미해석에는 폴백을 줄 수 있어야 하기 때문이다.
 */
export function resolveReceiverTarget(
    receiver: ReceiverSegment[], lookup: ReceiverLookup
): ReceiverTarget | undefined {
    const resolved = resolveReceiverChain(receiver, lookup);
    if (!resolved) { return undefined; }
    if (resolved.primitive) { return { kind: 'primitive', name: resolved.name }; }
    const holder = holderNamed(resolved.name, lookup);
    if (holder) { return holder; }
    if (lookup.builtins?.isClassName(resolved.name)) {
        return { kind: 'builtinClass', name: resolved.name };
    }
    return undefined;
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
        enclosingModuleName: enclosingProc ? enclosingModuleName(enclosingProc) : undefined,
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
