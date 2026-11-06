/**
 * Delegate(`AddressOf`)·`Mid` 관련 실기 컴파일러 사실 검사. vscode 무의존 순수 모듈.
 * 진입점은 `compilerChecks.findCompilerCheckFindings` 가 부른다(코드·심각도 표는 그쪽 머리 주석).
 *
 * 근거 — Sample Prep 보고(GPL 4.2K5 실측, 2026-11-04~05, Downloads/GPL_language_inbox):
 *   - `gpl-language-facts-delegates_v1` §1·§2(`AddressOf` 를 delegate 로 감싸지 않으면 -205/-712, `Mid(...)` 바로 뒤 멤버 접근 -712)
 *   - `gpl-language-facts-instance-delegates_v1` §1·§2·§3(`AddressOf Me.X` -741, 시그니처 불일치 -741, 거짓 경고 방지표)
 *   - `debug-day-feedback_v1` §5(a)(delegate 매개변수를 이름으로 바로 호출하면 -729)
 *   - `mid-temp-leak-and-memory-costs_v1` §1(`Mid(<임시 문자열 식>, …)` 이 120자를 넘으면 호출마다 메모리가 돌아오지 않음, 2026-11-06 시뮬 제어기)
 *
 * 거짓 경고를 피하려고 확신할 수 없으면 조용히 넘어간다 — 호출 대상을 못 찾거나, `New <사용자 클래스>(…)` 생성자 인자이거나,
 * 시그니처 비교의 한쪽을 풀지 못하면 판정하지 않는다.
 */

import { GPLParser, GPLSymbol, GPLSymbolKind } from '../syntax/gplParser';
import { elementTypeOf } from '../analysis/receiverType';
import { normalizePathKey } from '../../util/pathKey';
import type { CompilerCheckFinding, CompilerSymbolLookup } from './compilerChecks';
import { buildMappedLines, MappedLine, splitCallArgs, toPhysical } from './logicalLines';

const IDENT = '[A-Za-z_]\\w*';
const QUALIFIED = `${IDENT}(?:\\s*\\.\\s*${IDENT})*`;

const DOC_DELEGATES = 'https://www2.brooksautomation.com/Controller_Software/Introduction_To_The_Software/Guidance_Programming_Language/delegates.htm';

function ciEq(a: string | undefined, b: string | undefined): boolean {
    return (a ?? '').toLowerCase() === (b ?? '').toLowerCase();
}

/** 변수 선언 형의 요소 형 — 배열(`T[]`)이면 `T`, 아니면 그대로. */
function elementOf(type: string | undefined): string | undefined {
    return type ? elementTypeOf(type, true) : undefined;
}

function lastSegment(qualified: string): string {
    return qualified.split('.').pop()!.trim();
}

function isCallable(s: GPLSymbol): boolean {
    return s.kind === GPLSymbolKind.Sub || s.kind === GPLSymbolKind.Function;
}

// ─── 문맥 ────────────────────────────────────────────────────────────────────

class DelegateContext {
    readonly mapped: MappedLine[];
    readonly symbols: GPLSymbol[];
    readonly members: GPLSymbol[];
    private readonly fileKey: string;
    private readonly cache = new Map<string, GPLSymbol[]>();

    constructor(content: string, readonly filePath: string, private readonly lookup?: CompilerSymbolLookup) {
        this.mapped = buildMappedLines(content.split('\n'));
        this.symbols = GPLParser.parseDocument(content, filePath, { includeLocals: true, includeParameters: true });
        this.members = this.symbols.filter(s => !s.isLocal && !s.isParameter);
        this.fileKey = normalizePathKey(filePath);
    }

    /** 현재 파일 + 같은 컴파일 단위 다른 파일에서 이름이 같은 비지역 심볼. */
    visible(name: string): GPLSymbol[] {
        const key = name.toLowerCase();
        const hit = this.cache.get(key);
        if (hit) { return hit; }
        const own = this.members.filter(s => s.name.toLowerCase() === key);
        const external = this.lookup
            ? this.lookup.findAllByName(name).filter(s => !s.isLocal && !s.isParameter
                && normalizePathKey(s.filePath) !== this.fileKey && this.lookup!.isSameCompileUnit(s.filePath, this.filePath))
            : [];
        const all = [...own, ...external];
        this.cache.set(key, all);
        return all;
    }

    delegateType(typeName: string | undefined): GPLSymbol | undefined {
        if (!typeName) { return undefined; }
        const found = this.visible(lastSegment(typeName)).filter(s => s.kind === GPLSymbolKind.Delegate);
        return found.length === 1 ? found[0] : undefined;
    }

    enclosingProcedure(line: number): GPLSymbol | undefined {
        let best: GPLSymbol | undefined;
        for (const s of this.members) {
            if ((s.kind === GPLSymbolKind.Sub || s.kind === GPLSymbolKind.Function || s.kind === GPLSymbolKind.Property)
                && s.line <= line && (s.endLine ?? -1) >= line && (!best || s.line > best.line)) {
                best = s;
            }
        }
        return best;
    }

    /** 이름의 변수 선언 형 — 프로시저 지역·매개변수 → 같은 클래스 멤버 → 모듈 변수 순. 배열 접미사는 벗긴다. */
    variableType(name: string, line: number): string | undefined {
        const proc = this.enclosingProcedure(line);
        if (proc) {
            const local = this.symbols.filter(s => (s.isLocal || s.isParameter) && ciEq(s.name, name)
                && s.line >= proc.line && s.line <= (proc.endLine ?? s.line));
            if (local.length > 0) { return elementOf(local[local.length - 1].returnType); }
        }
        const vars = this.visible(name).filter(s => s.kind === GPLSymbolKind.Variable);
        const mine = vars.filter(s => !!proc?.className && ciEq(s.className, proc.className));
        const pool = mine.length > 0 ? mine : vars;
        const types = new Set(pool.map(s => (elementOf(s.returnType) ?? '').toLowerCase()));
        return pool.length > 0 && types.size === 1 ? elementOf(pool[0].returnType) : undefined;
    }

    /** 클래스 필드(변수) 이름의 형 — 접두 객체를 모르므로 같은 이름의 필드가 모두 같은 형일 때만. */
    fieldType(name: string): string | undefined {
        const fields = this.visible(name).filter(s => s.kind === GPLSymbolKind.Variable && s.className);
        const types = new Set(fields.map(s => (elementOf(s.returnType) ?? '').toLowerCase()));
        return fields.length > 0 && types.size === 1 ? elementOf(fields[0].returnType) : undefined;
    }
}

// ─── 시그니처 ────────────────────────────────────────────────────────────────

interface ParamSig {
    byRef: boolean;
    optional: boolean;
    /** 소문자 형 이름(마지막 구간). 형이 없으면 undefined. */
    type?: string;
    isArray: boolean;
    text: string;
}

function parseParam(decl: string): ParamSig {
    const text = decl.trim().replace(/\s+/g, ' ');
    const asMatch = decl.match(/\bAs\s+([A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)*)\s*(\(\s*,*\s*\))?/i);
    const before = decl.split(/\bAs\b/i)[0];
    return {
        byRef: /\bByRef\b/i.test(decl),
        optional: /\bOptional\b/i.test(decl),
        type: asMatch ? lastSegment(asMatch[1].replace(/\s+/g, '')).toLowerCase() : undefined,
        isArray: !!(asMatch && asMatch[2]) || /\w\s*\(\s*,*\s*\)\s*$/.test(before),
        text,
    };
}

const NUMERIC_TYPES = new Set(['integer', 'double', 'single', 'long', 'short', 'byte', 'number']);

/** 비교용 형 분류 — 숫자 형끼리의 차이는 컴파일러 판정을 확인하지 못해 같은 것으로 본다. */
function typeClass(type: string | undefined): string | undefined {
    if (!type) { return undefined; }
    if (NUMERIC_TYPES.has(type)) { return 'numeric'; }
    return type;
}

/** 두 시그니처가 다른 이유(처음 하나). 같거나 판정할 수 없으면 undefined. */
function signatureDifference(delegate: GPLSymbol, target: GPLSymbol): string | undefined {
    const delegateIsFunction = delegate.returnType !== undefined;
    const targetIsFunction = target.kind === GPLSymbolKind.Function;
    if (delegateIsFunction !== targetIsFunction) {
        return `${delegateIsFunction ? 'Function' : 'Sub'} 템플릿에 ${targetIsFunction ? 'Function' : 'Sub'} 를 묶음`;
    }
    const dp = (delegate.parameters ?? []).map(parseParam);
    const tp = (target.parameters ?? []).map(parseParam);
    if (dp.length !== tp.length) {
        return `매개변수 개수가 ${dp.length}개 ↔ ${tp.length}개`;
    }
    for (let i = 0; i < dp.length; i++) {
        if (dp[i].byRef !== tp[i].byRef) {
            return `${i + 1}번째 매개변수의 ByVal/ByRef 가 다름`;
        }
        const dc = typeClass(dp[i].type);
        const tc = typeClass(tp[i].type);
        if (dc !== undefined && tc !== undefined && dc !== tc) {
            return `${i + 1}번째 매개변수의 형이 다름(${dp[i].type} ↔ ${tp[i].type})`;
        }
        if (dp[i].isArray !== tp[i].isArray) {
            return `${i + 1}번째 매개변수의 배열 여부가 다름`;
        }
    }
    return undefined;
}

function describeSignature(s: GPLSymbol): string {
    const kind = s.kind === GPLSymbolKind.Function || (s.kind === GPLSymbolKind.Delegate && s.returnType !== undefined) ? 'Function' : 'Sub';
    return `${kind} ${s.name}(${(s.parameters ?? []).map(p => p.trim().replace(/\s+/g, ' ')).join(', ')})`;
}

// ─── AddressOf ───────────────────────────────────────────────────────────────

/** 논리 줄 [from, to) 가 한 물리 줄 안에 있으면 true — 빠른 수정(범위 치환)을 안전하게 붙일 수 있다. */
function inOneSegment(ml: MappedLine, from: number, to: number): boolean {
    const seg = [...ml.segments].reverse().find(s => s.offset <= from);
    return !!seg && to <= seg.offset + seg.length;
}

/** `(` 바로 앞의 호출 이름(없으면 undefined). */
function calleeBefore(code: string, open: number): string | undefined {
    const m = code.slice(0, open).match(new RegExp(`(${QUALIFIED})\\s*$`));
    return m ? m[1].replace(/\s+/g, '') : undefined;
}

/** 위치 바로 앞의 열린 `(` 와 그 앞까지의 최상위 콤마 수. 최상위 문장이면 open = -1. */
function enclosingCall(code: string, index: number): { open: number; argIndex: number } {
    let depth = 0;
    let argIndex = 0;
    for (let i = index - 1; i >= 0; i--) {
        const ch = code[i];
        if (ch === ')') { depth++; }
        else if (ch === '(') {
            if (depth === 0) { return { open: i, argIndex }; }
            depth--;
        } else if (ch === ',' && depth === 0) { argIndex++; }
    }
    return { open: -1, argIndex };
}

/** 호출 인자 자리(`callee(…, AddressOf X, …)`)가 요구하는 delegate 형 — 모든 후보가 같은 delegate 형일 때만. */
function delegateTypeForArgument(ctx: DelegateContext, callee: string, argCount: number, argIndex: number): GPLSymbol | undefined {
    const candidates = ctx.visible(lastSegment(callee)).filter(s => isCallable(s) || s.kind === GPLSymbolKind.Property).filter(s => {
        const params = (s.parameters ?? []).map(parseParam);
        const required = params.filter(p => !p.optional).length;
        return argCount >= required && argCount <= params.length;
    });
    if (candidates.length === 0) { return undefined; }
    const types = new Set<string>();
    for (const c of candidates) {
        const param = (c.parameters ?? [])[argIndex];
        const t = param ? parseParam(param).type : undefined;
        if (!t) { return undefined; }
        types.add(t);
    }
    if (types.size !== 1) { return undefined; }
    const typeName = [...types][0];
    const found = ctx.visible(typeName).filter(s => s.kind === GPLSymbolKind.Delegate);
    return found.length === 1 ? found[0] : undefined;
}

/** `lhs = AddressOf X`, `Dim d As T = AddressOf X` 의 왼쪽이 가리키는 delegate 형. */
function delegateTypeForAssignment(ctx: DelegateContext, before: string, line: number): GPLSymbol | undefined {
    const dim = before.match(new RegExp(`^\\s*(?:(?:Public|Private|Dim|Static|Shared)\\s+)+${IDENT}\\s+As\\s+(${QUALIFIED})\\s*=\\s*$`, 'i'));
    if (dim) { return ctx.delegateType(dim[1]); }
    const assign = before.match(new RegExp(`^\\s*(?:Set\\s+)?(${QUALIFIED})(?:\\s*\\([^()]*\\))?\\s*=\\s*$`, 'i'));
    if (!assign) { return undefined; }
    const target = assign[1].replace(/\s+/g, '');
    const parts = target.split('.');
    const typeName = parts.length === 1 ? ctx.variableType(parts[0], line) : ctx.fieldType(parts[parts.length - 1]);
    return ctx.delegateType(typeName);
}

/** `AddressOf <target>` 의 대상 후보(Sub/Function 오버로드 전부). 풀 수 없으면 빈 배열. */
function resolveTargets(ctx: DelegateContext, target: string, line: number): GPLSymbol[] {
    const parts = target.split('.');
    const proc = ctx.enclosingProcedure(line);
    if (parts.length === 1) {
        const name = parts[0];
        const all = ctx.visible(name).filter(isCallable);
        if (proc?.className) {
            return all.filter(s => ciEq(s.className, proc.className));
        }
        return all.filter(s => !s.className && ciEq(s.module, proc?.module));
    }
    if (parts.length === 2) {
        const [owner, member] = parts;
        const callables = ctx.visible(member).filter(isCallable);
        if (ctx.visible(owner).some(s => s.kind === GPLSymbolKind.Module)) {
            return callables.filter(s => !s.className && ciEq(s.module, owner));
        }
        const type = ctx.variableType(owner, line);
        if (type) {
            return callables.filter(s => ciEq(s.className, type));
        }
    }
    return [];
}

function checkAddressOf(ctx: DelegateContext, out: CompilerCheckFinding[]): void {
    const re = new RegExp(`\\bAddressOf\\s+((?:Me\\s*\\.\\s*)?)(${QUALIFIED})`, 'gi');
    for (const ml of ctx.mapped) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(ml.code)) !== null) {
            const idx = m.index;
            const end = idx + m[0].length;
            const mePart = m[1];
            const targetText = m[2].replace(/\s+/g, '');
            const before = ml.code.slice(0, idx);
            const after = ml.code.slice(end);
            const line = ml.segments[0].line;

            // ② AddressOf Me.X → -741 (감싸든 아니든 같다)
            if (mePart) {
                const meStart = end - m[2].length - mePart.length;
                out.push({
                    ...toPhysical(ml, meStart, meStart + mePart.length),
                    code: 'addressof-me-prefix',
                    severity: 'error',
                    message: '`AddressOf Me.X` 는 컴파일러가 -741 *Argument mismatch* 로 거부합니다(2026-11-05 실기 컴파일). 클래스 안에서는 `Me.` 없이 `AddressOf X` 라고 쓰면 '
                        + '이 객체의 메서드에 묶입니다(클래스 밖에서는 `AddressOf 변수.메서드` 도 됩니다). '
                        + `(${DOC_DELEGATES})`,
                    ...(inOneSegment(ml, meStart, meStart + mePart.length) ? { fix: { title: '`Me.` 제거 — 클래스 안에서는 `AddressOf X` 가 이 객체에 묶입니다', newText: '' } } : {}),
                });
            }

            const sole = before.match(new RegExp(`\\bNew\\s+(${QUALIFIED})\\s*\\(\\s*$`, 'i'));
            if (sole && /^\s*\)/.test(after)) {
                checkSignature(ctx, ml, idx, end, sole[1].replace(/\s+/g, ''), targetText, line, out);
                continue;
            }

            // ① 감싸지 않은 AddressOf
            const call = enclosingCall(ml.code, idx);
            let delegate: GPLSymbol | undefined;
            if (call.open >= 0) {
                const callee = calleeBefore(ml.code, call.open);
                if (callee === undefined) { continue; }
                // `New X(a, AddressOf Y)` 의 생성자 인자 — 사용자 클래스 생성자 쪽은 실측하지 않았다.
                if (new RegExp(`\\bNew\\s+${QUALIFIED}\\s*$`, 'i').test(ml.code.slice(0, call.open))) { continue; }
                if (/^(?:If|ElseIf|While|Until|Case|Not|And|Or|Return)$/i.test(callee)) { continue; }
                const argCount = splitCallArgs(ml.code, call.open).length;
                delegate = delegateTypeForArgument(ctx, callee, argCount, call.argIndex);
            } else {
                delegate = delegateTypeForAssignment(ctx, before, line);
            }
            const wrap = delegate && inOneSegment(ml, idx, end)
                ? { title: `\`New ${delegate.name}(AddressOf ${targetText})\` 로 감싸기`, newText: `New ${delegate.name}(AddressOf ${targetText})` }
                : undefined;
            out.push({
                ...toPhysical(ml, idx, end),
                code: 'addressof-without-delegate',
                severity: 'error',
                message: 'GPL 은 `AddressOf` 를 delegate 로 암묵 변환하지 않습니다(VB.NET 과 다름) — 호출 인자나 대입 오른쪽에 그대로 쓰면 컴파일러가 '
                    + '`-205 *Missing argument*`/`-712 *Invalid syntax*` 를 내며 원인을 알려 주지 않습니다. '
                    + `\`New <Delegate 형>(AddressOf ${targetText})\` 로 감싸세요(2026-11-05 실기 컴파일). (${DOC_DELEGATES})`,
                ...(wrap ? { fix: wrap } : {}),
            });
        }
    }
}

/** ⑤ `New D(AddressOf X)` — X 의 어떤 오버로드도 D 와 같은 시그니처가 아니면 -741. */
function checkSignature(ctx: DelegateContext, ml: MappedLine, idx: number, end: number, delegateName: string,
    targetText: string, line: number, out: CompilerCheckFinding[]): void {
    const delegate = ctx.delegateType(delegateName);
    if (!delegate) { return; }
    const targets = resolveTargets(ctx, targetText, line);
    if (targets.length === 0) { return; }
    const differences = targets.map(t => signatureDifference(delegate, t));
    if (differences.some(d => d === undefined)) { return; }
    out.push({
        ...toPhysical(ml, idx, end),
        code: 'delegate-signature-mismatch',
        severity: 'error',
        message: `delegate \`${describeSignature(delegate)}\` 과 대상 \`${describeSignature(targets[0])}\` 의 시그니처가 다릅니다(${differences[0]}). `
            + 'GPL 컴파일러는 이 `New <Delegate>(AddressOf …)` 를 -741 *Argument mismatch* 로 거부합니다. 오버로드는 하나라도 맞으면 통과하는데 '
            + `${targets.length > 1 ? `찾은 ${targets.length}개 모두 다릅니다` : '맞는 오버로드가 없습니다'}(2026-11-05 실기 컴파일). (${DOC_DELEGATES})`,
    });
}

// ─── ③ Delegate 매개변수를 이름으로 직접 호출 ────────────────────────────────

function checkDelegateParameterCalls(ctx: DelegateContext, out: CompilerCheckFinding[]): void {
    for (const proc of ctx.members) {
        if (!(isCallable(proc) || proc.kind === GPLSymbolKind.Property) || proc.endLine === undefined || !proc.parameters?.length) { continue; }
        for (const decl of proc.parameters) {
            const m = decl.match(new RegExp(`^\\s*(?:(?:Optional|ByVal|ByRef)\\s+)*(${IDENT})\\s+As\\s+(${QUALIFIED})\\s*$`, 'i'));
            if (!m) { continue; } // `h() As T`·`As T()` 배열은 원소 접근이라 대상이 아니다.
            const delegate = ctx.delegateType(m[2].replace(/\s+/g, ''));
            if (!delegate) { continue; }
            const name = m[1];
            const call = new RegExp(`(?<![\\w.])${name}(?=\\s*\\()`, 'gi');
            for (const ml of ctx.mapped) {
                const first = ml.segments[0].line;
                if (first <= proc.line || first >= proc.endLine) { continue; }
                call.lastIndex = 0;
                let c: RegExpExecArray | null;
                while ((c = call.exec(ml.code)) !== null) {
                    out.push({
                        ...toPhysical(ml, c.index, c.index + name.length),
                        code: 'delegate-parameter-direct-call',
                        severity: 'error',
                        message: `\`${name}\` 은 delegate(\`${delegate.name}\`) 형 **매개변수**입니다. 매개변수를 이름으로 바로 부르면 컴파일러가 `
                            + '`-729 *Undefined symbol*` 을 냅니다 — 지역 변수에 복사한 뒤 그 변수로 호출하세요 '
                            + `(\`Dim fn As ${delegate.name} : fn = ${name} : fn(…)\`, 2026-11-04 실기 컴파일). (${DOC_DELEGATES})`,
                    });
                }
            }
        }
    }
}

// ─── ④ Mid(...) 결과에 바로 멤버 접근 ────────────────────────────────────────

function checkMidMemberAccess(ctx: DelegateContext, out: CompilerCheckFinding[]): void {
    const re = /(?<![\w.])Mid\s*\(/gi;
    for (const ml of ctx.mapped) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(ml.code)) !== null) {
            const open = m.index + m[0].length - 1;
            const args = splitCallArgs(ml.code, open);
            const last = args[args.length - 1];
            // 짝 `)` 가 줄 끝까지 없으면(입력 중) 판정하지 않는다.
            if (ml.code[last.end] !== ')') { continue; }
            if (!new RegExp(`^\\s*\\.\\s*${IDENT}`).test(ml.code.slice(last.end + 1))) { continue; }
            out.push({
                ...toPhysical(ml, m.index, last.end + 1),
                code: 'mid-member-access',
                severity: 'warning',
                message: '`Mid(...)` 의 결과에 바로 `.메서드` 를 붙이면 컴파일러가 `-712 *Invalid syntax*` 를 냈습니다(2026-11-04 실측, `Mid(s, p).Split("+")`). '
                    + '`UCase(x).Split(...)` 는 통과해 `Mid` 만 그런 것으로 보입니다(`Left`·`Right` 등 다른 내장 함수는 미확인). '
                    + '임시 String 변수에 받은 뒤 그 변수로 호출하세요.',
            });
        }
    }
}

// ─── ⑤ Mid(<임시 문자열 식>, …) — 메모리 누수 ─────────────────────────────────

/** String 을 돌려주는 내장 함수(이 결과는 임시 문자열이다). GPL 에 없는 이름은 맞을 일이 없을 뿐이다. */
const STRING_BUILTINS = new Set(['cstr', 'left', 'right', 'mid', 'ucase', 'lcase', 'trim', 'ltrim', 'rtrim', 'format', 'space', 'replace']);

function checkMidTemporaryArgument(ctx: DelegateContext, out: CompilerCheckFinding[]): void {
    const re = /(?<![\w.])Mid\s*\(/gi;
    const call = new RegExp(`(?<![\\w.])(${IDENT})\\s*\\(`, 'g');
    for (const ml of ctx.mapped) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(ml.code)) !== null) {
            const open = m.index + m[0].length - 1;
            const args = splitCallArgs(ml.code, open);
            const first = args[0];
            const last = args[args.length - 1];
            if (args.length < 2 || ml.code[last.end] !== ')') { continue; }
            const expr = ml.code.slice(first.start, first.end);
            let temporary = expr.includes('&');
            if (!temporary) {
                call.lastIndex = 0;
                let c: RegExpExecArray | null;
                while (!temporary && (c = call.exec(expr)) !== null) {
                    const name = c[1];
                    temporary = STRING_BUILTINS.has(name.toLowerCase())
                        || ctx.visible(name).some(s => s.kind === GPLSymbolKind.Function && /^String\b/i.test(s.returnType ?? ''));
                }
            }
            if (!temporary) { continue; }
            const lead = expr.length - expr.trimStart().length;
            const trail = expr.length - expr.trimEnd().length;
            out.push({
                ...toPhysical(ml, first.start + lead, first.end - trail),
                code: 'mid-temporary-argument',
                severity: 'information',
                message: '`Mid` 의 첫 인자가 임시 문자열(`&` 연결·문자열 함수 결과)입니다. 그 문자열이 120자를 넘으면 호출마다 메모리가 돌아오지 않았습니다 '
                    + '(GPL 4.2K5 시뮬 제어기 실측 2026-11-06: 300자 연결에 1회당 320 B, Unload 뒤에도 회복 안 됨). '
                    + '변수에 먼저 받은 뒤 `Mid(변수, …)` 로 부르면 새지 않았습니다.',
            });
        }
    }
}

// ─── 진입점 ──────────────────────────────────────────────────────────────────

/** Delegate·`Mid` 검사. 결과는 compilerChecks 가 다른 규칙과 합쳐 정렬한다. */
export function findDelegateCheckFindings(content: string, filePath: string, lookup?: CompilerSymbolLookup): CompilerCheckFinding[] {
    const ctx = new DelegateContext(content, filePath, lookup);
    const out: CompilerCheckFinding[] = [];
    checkAddressOf(ctx, out);
    checkDelegateParameterCalls(ctx, out);
    checkMidMemberAccess(ctx, out);
    checkMidTemporaryArgument(ctx, out);
    return out;
}
