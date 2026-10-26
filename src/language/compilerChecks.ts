/**
 * 실기 컴파일러·제어기로 확인한 GPL 사실을 정적 검사로 옮긴다. vscode 무의존 순수 모듈.
 *
 * 각 규칙은 "제어기에서 실제로 무엇이 났는가"가 근거다(Downloads/GPL_language_inbox 보고, 2026-10-22~25 GPL 4.2K5).
 * 심각도 설계 — 컴파일/정지가 **확실히 실패**하는 것은 warning, 한도가 정확하지 않거나 의도를 추정하는 것은 information.
 *
 * | 코드 | 근거 | 심각도 |
 * | --- | --- | --- |
 * | `overload-return-type-mismatch` | 반환형이 다른 오버로드 → 뒤 선언에서 -741, 본문이 -733/-773 | warning |
 * | `new-parens-without-constructor` | `Sub New` 없는 사용자 클래스의 `New X()` → -722 | warning |
 * | `member-shadows-module` | 클래스 멤버 `Num` 이 Module `NUM` 을 가려 `NUM.x` 가 -781/-729 | warning |
 * | `string-literal-too-long` | 100바이트 통과, 118바이트 -506 (한도 미확정) | information |
 * | `thread-name-unstoppable` | `Stop <이름>` 이 `[` `]` `:` 를 -712 로 거부 | warning |
 * | `private-shared-outside-class` | 클래스 안 `Private Shared` 를 다른 클래스에서 부름 → -729 | warning |
 * | `byval-string-nothing-check` | Nothing String 을 ByVal 로 넘기면 호출 자리에서 -782(또는 값 깨짐) | information |
 * | `jog-tick-mode-speed` | 조그 속도 5% 이하는 tick 모드 | information |
 *
 * 다른 파일의 심볼(라이브러리 프로젝트 포함)은 `CompilerSymbolLookup` 으로 받는다 — `SymbolCache` 가 구조적으로 맞는다.
 * 조회가 없으면(심볼 캐시 초기화 전·단위 테스트) 현재 파일만으로 판정하고, 확신할 수 없는 경우는 조용히 넘어간다.
 */

import { GPLParser, GPLSymbol, GPLSymbolKind } from './gplParser';
import { findGplBuiltinMember, isGplBuiltinClassName } from './gplBuiltins';
import { elementTypeOf } from './receiverType';
import { normalizePathKey } from '../util/pathKey';

export type CompilerCheckSeverity = 'warning' | 'information';

export type CompilerCheckCode =
    | 'overload-return-type-mismatch'
    | 'new-parens-without-constructor'
    | 'member-shadows-module'
    | 'string-literal-too-long'
    | 'thread-name-unstoppable'
    | 'private-shared-outside-class'
    | 'byval-string-nothing-check'
    | 'jog-tick-mode-speed';

export interface CompilerCheckFinding {
    /** 물리 줄·열(0 기준). end 는 같은 줄의 끝 열(배타). */
    line: number;
    start: number;
    end: number;
    code: CompilerCheckCode;
    severity: CompilerCheckSeverity;
    message: string;
}

/** 다른 파일의 심볼 조회 — `SymbolCache`/`SymbolIndex` 가 그대로 만족한다. */
export interface CompilerSymbolLookup {
    findAllByName(name: string): readonly GPLSymbol[];
    isSameCompileUnit(candidateFilePath: string, referenceFilePath: string): boolean;
}

/**
 * 관측한 리터럴 길이 한도 — 100바이트는 컴파일됐고 118바이트는 -506 이었다(2026-10-23). 정확한 값은 그 사이 어딘가다.
 * 넘으면 information 으로 알린다.
 */
export const STRING_LITERAL_OBSERVED_OK_BYTES = 100;
const STRING_LITERAL_OBSERVED_FAIL_BYTES = 118;

/** 조그 속도(%) 가 이 값 이하이면 tick 모드 — Brooks 문서 DataID 2825, GPL SetJogCommand 에도 적용(2026-10-23 실기). */
export const JOG_TICK_MODE_MAX_PERCENT = 5;

const IDENT = '[A-Za-z_]\\w*';

function ciEq(a: string | undefined, b: string | undefined): boolean {
    return (a ?? '').toLowerCase() === (b ?? '').toLowerCase();
}

function isProcedure(s: GPLSymbol): boolean {
    return s.kind === GPLSymbolKind.Sub || s.kind === GPLSymbolKind.Function || s.kind === GPLSymbolKind.Property;
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── 줄 전처리 ───────────────────────────────────────────────────────────────

/** 문자열은 그대로 두고 문자열 밖 `'` 이후(주석)만 잘라낸다. */
function stripComment(line: string): string {
    let inString = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inString && line[i + 1] === '"') { i++; continue; }
            inString = !inString;
        } else if (ch === "'" && !inString) {
            return line.slice(0, i);
        }
    }
    return line;
}

/** 줄 연속(` _`)을 이은 논리 줄 — 위치를 물리 줄·열로 되돌릴 수 있게 조각 시작 오프셋을 기억한다. */
interface MappedLine {
    /** 주석만 지운 원문(문자열 보존). */
    text: string;
    /** 문자열 내부를 공백으로 바꾼 코드(위치 동일). */
    code: string;
    segments: { line: number; offset: number; length: number }[];
}

function buildMappedLines(rawLines: readonly string[]): MappedLine[] {
    const out: MappedLine[] = [];
    let i = 0;
    while (i < rawLines.length) {
        const first = stripComment(rawLines[i]).replace(/\r$/, '');
        let text = first;
        const segments = [{ line: i, offset: 0, length: first.length }];
        while (GPLParser.endsWithLineContinuation(text) && i + 1 < rawLines.length) {
            text = GPLParser.stripTrailingContinuation(text) + ' ';
            i++;
            const next = stripComment(rawLines[i]).replace(/\r$/, '');
            segments.push({ line: i, offset: text.length, length: next.length });
            text += next;
        }
        out.push({ text, code: GPLParser.stripToCode(text), segments });
        i++;
    }
    return out;
}

/** 논리 줄의 [from, to) 를 물리 줄 범위로 — 여러 줄에 걸치면 시작 줄의 끝까지로 자른다. */
function toPhysical(ml: MappedLine, from: number, to: number): { line: number; start: number; end: number } {
    let seg = ml.segments[0];
    for (const s of ml.segments) {
        if (s.offset <= from) { seg = s; }
    }
    const start = Math.max(0, from - seg.offset);
    const end = Math.min(seg.length, Math.max(start + 1, to - seg.offset));
    return { line: seg.line, start, end: Math.max(end, start + 1) };
}

/** 문자열 리터럴 위치(따옴표 포함)와 내용. `""` 는 따옴표 하나로 푼다. */
function findStringLiterals(text: string, from = 0, to = text.length): { start: number; end: number; value: string }[] {
    const out: { start: number; end: number; value: string }[] = [];
    let i = from;
    while (i < to) {
        if (text[i] !== '"') { i++; continue; }
        const start = i;
        let value = '';
        i++;
        while (i < text.length) {
            if (text[i] === '"') {
                if (text[i + 1] === '"') { value += '"'; i += 2; continue; }
                break;
            }
            value += text[i];
            i++;
        }
        out.push({ start, end: Math.min(i + 1, text.length), value });
        i++;
    }
    return out;
}

/**
 * `(` 바로 뒤부터 짝 `)` 까지의 최상위 인자 구간. 문자열·중첩 괄호를 건너뛴다.
 * 짝을 못 찾으면(입력 중) 줄 끝까지를 마지막 인자로 본다.
 */
function splitCallArgs(code: string, openParen: number): { start: number; end: number }[] {
    const args: { start: number; end: number }[] = [];
    let depth = 0;
    let argStart = openParen + 1;
    for (let i = openParen + 1; i < code.length; i++) {
        const ch = code[i];
        if (ch === '(') { depth++; continue; }
        if (ch === ')') {
            if (depth === 0) {
                args.push({ start: argStart, end: i });
                return args;
            }
            depth--;
            continue;
        }
        if (ch === ',' && depth === 0) {
            args.push({ start: argStart, end: i });
            argStart = i + 1;
        }
    }
    args.push({ start: argStart, end: code.length });
    return args;
}

/** 구간의 앞뒤 공백을 벗긴 위치. 빈 인자면 undefined. */
function trimSpan(text: string, span: { start: number; end: number }): { start: number; end: number } | undefined {
    let s = span.start;
    let e = span.end;
    while (s < e && /\s/.test(text[s])) { s++; }
    while (e > s && /\s/.test(text[e - 1])) { e--; }
    return s < e ? { start: s, end: e } : undefined;
}

// ─── 심볼 문맥 ───────────────────────────────────────────────────────────────

class CheckContext {
    readonly rawLines: string[];
    readonly codeLines: string[];
    readonly mapped: MappedLine[];
    readonly symbols: GPLSymbol[];
    readonly members: GPLSymbol[];
    readonly classes: GPLSymbol[];
    private readonly memberByName = new Map<string, GPLSymbol[]>();
    private readonly fileKey: string;
    private readonly lookupCache = new Map<string, readonly GPLSymbol[]>();

    constructor(content: string, readonly filePath: string, private readonly lookup?: CompilerSymbolLookup) {
        this.rawLines = content.split('\n');
        this.codeLines = this.rawLines.map(l => GPLParser.stripToCode(l.replace(/\r$/, '')));
        this.mapped = buildMappedLines(this.rawLines);
        this.symbols = GPLParser.parseDocument(content, filePath, { includeLocals: true, includeParameters: true });
        this.members = this.symbols.filter(s => !s.isLocal && !s.isParameter);
        this.classes = this.members.filter(s => s.kind === GPLSymbolKind.Class);
        for (const s of this.members) {
            const key = s.name.toLowerCase();
            const list = this.memberByName.get(key);
            if (list) { list.push(s); } else { this.memberByName.set(key, [s]); }
        }
        this.fileKey = normalizePathKey(filePath);
    }

    /** 다른 파일(같은 컴파일 단위·참조 라이브러리)에서 보이는 같은 이름의 심볼. 현재 파일의 캐시 사본은 뺀다(옛 내용일 수 있음). */
    external(name: string): readonly GPLSymbol[] {
        if (!this.lookup) { return []; }
        const key = name.toLowerCase();
        const cached = this.lookupCache.get(key);
        if (cached) { return cached; }
        const found = this.lookup.findAllByName(name).filter(s =>
            normalizePathKey(s.filePath) !== this.fileKey && this.lookup!.isSameCompileUnit(s.filePath, this.filePath));
        this.lookupCache.set(key, found);
        return found;
    }

    /** 현재 파일 + 다른 파일에서 이름이 같은 비지역 심볼. */
    visible(name: string): GPLSymbol[] {
        return [...(this.memberByName.get(name.toLowerCase()) ?? []), ...this.external(name)];
    }

    /** 줄을 감싸는 가장 안쪽 클래스. */
    enclosingClass(line: number): GPLSymbol | undefined {
        let best: GPLSymbol | undefined;
        for (const c of this.classes) {
            if (c.line <= line && (c.endLine ?? Number.MAX_SAFE_INTEGER) >= line && (!best || c.line > best.line)) {
                best = c;
            }
        }
        return best;
    }

    /** 줄을 감싸는 프로시저(Sub/Function/Property). */
    enclosingProcedure(line: number): GPLSymbol | undefined {
        let best: GPLSymbol | undefined;
        for (const s of this.members) {
            if (isProcedure(s) && s.line <= line && (s.endLine ?? -1) >= line && (!best || s.line > best.line)) {
                best = s;
            }
        }
        return best;
    }

    /** 클래스와 그 바깥 클래스 이름들(중첩 클래스는 바깥 클래스의 Private 에 접근할 수 있을지 몰라 판정에서 뺀다). */
    classChain(cls: GPLSymbol | undefined): string[] {
        const out: string[] = [];
        let cur = cls;
        while (cur) {
            out.push(cur.name.toLowerCase());
            const parent = cur.parentClassName;
            cur = parent ? this.classes.find(c => ciEq(c.name, parent) && c.line < cur!.line) : undefined;
        }
        return out;
    }
}

function lineNo(s: GPLSymbol): number {
    return s.line + 1;
}

function baseName(filePath: string): string {
    return filePath.split(/[\\/]/).pop() ?? filePath;
}

function where(ctx: CheckContext, s: GPLSymbol): string {
    return normalizePathKey(s.filePath) === normalizePathKey(ctx.filePath)
        ? `${lineNo(s)}행`
        : `${baseName(s.filePath)}:${lineNo(s)}`;
}

// ─── ① 반환형이 다른 오버로드 ──────────────────────────────────────────────────

function checkOverloadReturnTypes(ctx: CheckContext, out: CompilerCheckFinding[]): void {
    const groups = new Map<string, GPLSymbol[]>();
    for (const s of ctx.members) {
        if (s.kind !== GPLSymbolKind.Function || !s.returnType) { continue; }
        const key = `${(s.module ?? '').toLowerCase()}|${(s.className ?? '').toLowerCase()}|${s.name.toLowerCase()}`;
        const list = groups.get(key) ?? [];
        list.push(s);
        groups.set(key, list);
    }
    for (const list of groups.values()) {
        if (list.length < 2) { continue; }
        list.sort((a, b) => a.line - b.line);
        const first = list[0];
        for (const later of list.slice(1)) {
            if (ciEq(later.returnType, first.returnType)) { continue; }
            out.push({
                line: later.line,
                start: later.range.start,
                end: Math.max(later.range.start + 1, later.range.end),
                code: 'overload-return-type-mismatch',
                severity: 'warning',
                message: `같은 이름의 오버로드 \`${first.name}\`(${lineNo(first)}행)과 반환형이 다릅니다(\`${first.returnType}\` ↔ \`${later.returnType}\`). `
                    + 'GPL 은 반환형이 다른 오버로드를 받지 않아 이 선언에서 -741 *Argument mismatch* 가 나고, 함수 본문이 -733/-773 으로 이어집니다. '
                    + '인자 수만 다르고 반환형이 같은 오버로드는 됩니다 — 이름을 나누세요(2026-10-25 실기 컴파일).',
            });
        }
    }
}

// ─── ② Sub New 없는 클래스의 New X() ────────────────────────────────────────

function hasConstructor(ctx: CheckContext, cls: GPLSymbol): boolean {
    const key = normalizePathKey(cls.filePath);
    const pool = normalizePathKey(ctx.filePath) === key ? ctx.members : ctx.external('New');
    return pool.some(s => s.kind === GPLSymbolKind.Sub && ciEq(s.name, 'New') && ciEq(s.className, cls.name)
        && normalizePathKey(s.filePath) === key);
}

function checkNewParens(ctx: CheckContext, out: CompilerCheckFinding[]): void {
    const re = new RegExp(`\\bNew\\s+(${IDENT}(?:\\s*\\.\\s*${IDENT})*)\\s*(\\(\\s*\\))`, 'gi');
    for (const ml of ctx.mapped) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(ml.code)) !== null) {
            const className = m[1].split('.').pop()!.trim();
            if (isGplBuiltinClassName(className)) { continue; }
            const classes = ctx.visible(className).filter(s => s.kind === GPLSymbolKind.Class);
            if (classes.length === 0 || classes.some(c => hasConstructor(ctx, c))) { continue; }
            const parenStart = m.index + m[0].length - m[2].length;
            const pos = toPhysical(ml, parenStart, parenStart + m[2].length);
            out.push({
                ...pos,
                code: 'new-parens-without-constructor',
                severity: 'warning',
                message: `클래스 \`${classes[0].name}\`(${where(ctx, classes[0])})에 \`Sub New\` 가 없어 \`New ${className}()\` 의 괄호에서 -722 *Unexpected text at end of line* 가 납니다. `
                    + `\`New ${className}\` 로 쓰거나 \`Public Sub New()\` 를 선언하세요. 내장 클래스(\`New Mutex()\` 등)는 괄호를 써도 됩니다(2026-10-25 실기 컴파일).`,
            });
        }
    }
}

// ─── ③ 멤버 이름이 Module 이름을 가림 ────────────────────────────────────────

function isModuleMember(ctx: CheckContext, moduleName: string, memberName: string): boolean {
    return ctx.visible(memberName).some(s => s.kind !== GPLSymbolKind.Module && s.kind !== GPLSymbolKind.Class
        && !s.className && ciEq(s.module, moduleName));
}

/** 변수·속성 멤버의 타입이 그 멤버를 실제로 가지면 의도한 멤버 접근이다(예: 필드 `log As Logger` 의 `log.Write`). */
function typeHasMember(ctx: CheckContext, member: GPLSymbol, memberName: string): boolean {
    // 배열 필드(`log() As Logger`)는 첨자 없이 멤버 접근할 수 없으므로 요소 타입을 보지 않는다.
    const type = member.returnType ? elementTypeOf(member.returnType, false) : undefined;
    if (!type || (member.kind !== GPLSymbolKind.Variable && member.kind !== GPLSymbolKind.Property && member.kind !== GPLSymbolKind.Function)) {
        return false;
    }
    if (findGplBuiltinMember(type, memberName)) { return true; }
    return ctx.visible(memberName).some(s => ciEq(s.className, type));
}

function checkMemberShadowsModule(ctx: CheckContext, out: CompilerCheckFinding[]): void {
    const reported = new Set<string>();
    for (const member of ctx.members) {
        if (member.kind === GPLSymbolKind.Module || member.kind === GPLSymbolKind.Class || ciEq(member.name, 'New')) { continue; }
        if (!member.className && !member.module) { continue; }
        const modules = ctx.visible(member.name).filter(s => s.kind === GPLSymbolKind.Module && !ciEq(s.name, member.module));
        if (modules.length === 0) { continue; }
        const container = member.className
            ? ctx.classes.find(c => ciEq(c.name, member.className) && c.line <= member.line && (c.endLine ?? Number.MAX_SAFE_INTEGER) >= member.line)
            : ctx.members.find(s => s.kind === GPLSymbolKind.Module && ciEq(s.name, member.module) && s.line <= member.line);
        if (!container) { continue; }
        const from = container.line;
        const to = Math.min(ctx.codeLines.length - 1, container.endLine ?? ctx.codeLines.length - 1);
        const re = new RegExp(`(?<![\\w.])(${escapeRegExp(member.name)})\\s*\\.\\s*(${IDENT})`, 'gi');
        const mod = modules[0];
        const owner = member.className ? `클래스 \`${member.className}\`` : `Module \`${member.module}\``;
        for (let line = from; line <= to; line++) {
            if (line === member.line) { continue; }
            re.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = re.exec(ctx.codeLines[line])) !== null) {
                const memberName = m[2];
                if (!isModuleMember(ctx, mod.name, memberName) || typeHasMember(ctx, member, memberName)) { continue; }
                const key = `${line}:${m.index}`;
                if (reported.has(key)) { continue; }
                reported.add(key);
                out.push({
                    line,
                    start: m.index,
                    end: m.index + m[1].length,
                    code: 'member-shadows-module',
                    severity: 'warning',
                    message: `${owner} 의 멤버 \`${member.name}\`(${lineNo(member)}행)이 Module \`${mod.name}\`(${where(ctx, mod)})을 가립니다. `
                        + `GPL 은 이름의 대소문자를 가리지 않고 가까운 범위(멤버)를 먼저 잡아서, 이 \`${m[1]}.${memberName}\` 은 모듈이 아니라 멤버로 해석돼 -781/-729 가 납니다(2026-10-23 실기 컴파일). `
                        + '멤버 이름을 바꾸세요.',
                });
            }
        }
    }
}

// ─── ④ 긴 문자열 리터럴 ─────────────────────────────────────────────────────

function utf8Length(text: string): number {
    return Buffer.byteLength(text, 'utf8');
}

function checkLongStringLiterals(ctx: CheckContext, out: CompilerCheckFinding[]): void {
    for (let line = 0; line < ctx.rawLines.length; line++) {
        const text = stripComment(ctx.rawLines[line].replace(/\r$/, ''));
        for (const lit of findStringLiterals(text)) {
            const bytes = utf8Length(lit.value);
            if (bytes <= STRING_LITERAL_OBSERVED_OK_BYTES) { continue; }
            out.push({
                line,
                start: lit.start,
                end: lit.end,
                code: 'string-literal-too-long',
                severity: 'information',
                message: `문자열 리터럴이 ${bytes}바이트(UTF-8 기준)입니다. GPL 4.2K5 실기에서 ${STRING_LITERAL_OBSERVED_OK_BYTES}바이트 리터럴은 컴파일됐고 `
                    + `${STRING_LITERAL_OBSERVED_FAIL_BYTES}바이트는 -506 *Input too long* 이었습니다 — 정확한 한도는 그 사이로 아직 확인되지 않았습니다. `
                    + '짧은 리터럴 여러 개를 `&` 로 이으면 통과합니다(2026-10-23).',
            });
        }
    }
}

// ─── ⑤ Stop 으로 멈출 수 없는 쓰레드 이름 ────────────────────────────────────

function checkThreadNames(ctx: CheckContext, out: CompilerCheckFinding[]): void {
    const re = /\bNew\s+Thread\s*\(/gi;
    for (const ml of ctx.mapped) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(ml.code)) !== null) {
            const args = splitCallArgs(ml.code, m.index + m[0].length - 1);
            const nameArg = args[2] && trimSpan(ml.text, args[2]);
            if (!nameArg) { continue; }
            const bad = new Set<string>();
            for (const lit of findStringLiterals(ml.text, nameArg.start, nameArg.end)) {
                for (const ch of lit.value) {
                    if (!/[A-Za-z0-9_]/.test(ch)) { bad.add(ch); }
                }
            }
            if (bad.size === 0) { continue; }
            const shown = [...bad].map(ch => ch === ' ' ? '공백' : `\`${ch}\``).join(' ');
            out.push({
                ...toPhysical(ml, nameArg.start, nameArg.end),
                code: 'thread-name-unstoppable',
                severity: 'warning',
                message: `쓰레드 이름에 ${shown} 이(가) 들어 있습니다. 명령 콘솔의 \`Stop <이름>\` 은 \`[\` \`]\` \`:\` 를 -712 *Invalid syntax* 로 거부하고(따옴표 인용도 안 됨) `
                    + '영문·숫자·`_` 밖의 다른 문자도 같은 이유로 막힐 수 있어, 이 쓰레드는 이름으로 정지할 수 없습니다 — 프로젝트 범위 정지가 못 세워 Unload 가 -750 으로 남습니다. '
                    + '`RWK_0` 처럼 영문·숫자·`_` 만 쓰세요(2026-10-23 실측).',
            });
        }
    }
}

// ─── ⑥ 다른 클래스의 Private Shared ─────────────────────────────────────────

function isPrivateShared(ctx: CheckContext, s: GPLSymbol): boolean {
    if (!s.className || s.kind === GPLSymbolKind.Class || ciEq(s.name, 'New')) { return false; }
    if (normalizePathKey(s.filePath) !== normalizePathKey(ctx.filePath)) {
        return s.accessModifier === 'private' && s.isShared === true;
    }
    // 현재 파일은 선언 줄의 이름 앞 수식어로 직접 판정한다(파서의 isShared 는 줄 전체에서 SHARED 를 찾아 이름에 걸린다).
    const prefix = ctx.codeLines[s.line]?.slice(0, s.range.start) ?? '';
    return /\bPrivate\b/i.test(prefix) && /\bShared\b/i.test(prefix);
}

function privateSharedMessage(target: GPLSymbol, ctx: CheckContext): string {
    return `\`${target.className}.${target.name}\`(${where(ctx, target)})는 클래스 \`${target.className}\` 안의 \`Private Shared\` 라 그 클래스 밖에서는 보이지 않습니다 `
        + '— 같은 모듈의 다른 클래스에서도 -729 *Undefined symbol* 이 납니다(2026-10-22 실기). '
        + '여러 클래스가 함께 쓰는 도우미라면 모듈 수준 `Private Function` 으로 옮기세요(`Public Shared` 는 외부 API 가 됩니다).';
}

function checkPrivateSharedAccess(ctx: CheckContext, out: CompilerCheckFinding[]): void {
    const localPrivate = ctx.members.filter(s => isPrivateShared(ctx, s));
    const qualified = new RegExp(`(?<![\\w.])(${IDENT})\\s*\\.\\s*(${IDENT})`, 'g');
    const classNames = new Map<string, boolean>();
    const isClassName = (name: string): boolean => {
        const key = name.toLowerCase();
        let v = classNames.get(key);
        if (v === undefined) {
            v = ctx.visible(name).some(s => s.kind === GPLSymbolKind.Class);
            classNames.set(key, v);
        }
        return v;
    };
    const reported = new Set<string>();
    const report = (line: number, start: number, end: number, target: GPLSymbol): void => {
        const key = `${line}:${start}`;
        if (reported.has(key)) { return; }
        reported.add(key);
        out.push({ line, start, end, code: 'private-shared-outside-class', severity: 'warning', message: privateSharedMessage(target, ctx) });
    };

    for (let line = 0; line < ctx.codeLines.length; line++) {
        const code = ctx.codeLines[line];
        if (!code.includes('.') && localPrivate.length === 0) { continue; }
        const chain = ctx.classChain(ctx.enclosingClass(line));
        const outside = (className: string | undefined): boolean => !chain.includes((className ?? '').toLowerCase());

        // `A.Helper` — 클래스 이름으로 한정한 접근.
        qualified.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = qualified.exec(code)) !== null) {
            const [, owner, memberName] = m;
            if (!outside(owner) || !isClassName(owner)) { continue; }
            const target = ctx.visible(memberName).find(s => ciEq(s.className, owner) && isPrivateShared(ctx, s));
            if (target && target.line !== line) {
                report(line, m.index, m.index + m[0].length, target);
            }
        }

        // `Helper(...)` — 같은 파일 다른 클래스에서 한정 없이 부른 경우. 같은 이름이 달리 보이면(지역·모듈·이 클래스 멤버) 넘어간다.
        if (chain.length === 0) { continue; }
        for (const target of localPrivate) {
            if (!outside(target.className)) { continue; }
            const re = new RegExp(`(?<![\\w.])${escapeRegExp(target.name)}\\b(?!\\s*\\.)`, 'gi');
            re.lastIndex = 0;
            let u: RegExpExecArray | null;
            while ((u = re.exec(code)) !== null) {
                if (line === target.line || !uniquelyPrivateShared(ctx, target, line)) { continue; }
                report(line, u.index, u.index + target.name.length, target);
            }
        }
    }
}

/** 이 줄에서 이름이 가리킬 수 있는 선언이 모두 다른 클래스의 Private Shared 뿐인가. */
function uniquelyPrivateShared(ctx: CheckContext, target: GPLSymbol, line: number): boolean {
    const proc = ctx.enclosingProcedure(line);
    const locals = ctx.symbols.filter(s => (s.isLocal || s.isParameter) && ciEq(s.name, target.name)
        && proc && s.line >= proc.line && s.line <= (proc.endLine ?? proc.line));
    if (locals.length > 0) { return false; }
    const chain = ctx.classChain(ctx.enclosingClass(line));
    return ctx.visible(target.name).every(s => s.className && !chain.includes(s.className.toLowerCase()) && isPrivateShared(ctx, s));
}

// ─── ⑦ ByVal String 매개변수의 Is Nothing 검사 ───────────────────────────────

function byValStringParamName(decl: string): string | undefined {
    if (/\bByRef\b/i.test(decl)) { return undefined; }
    // `s() As String` 배열·`As String()` 는 참조라 대상이 아니다. 키워드를 생략하면 ByVal 이다(gplStatements ByVal 항목).
    const m = decl.match(/^\s*(?:(?:Optional|ByVal)\s+)*(\w+)\s+As\s+String\b(?!\s*\()/i);
    return m ? m[1] : undefined;
}

function checkByValStringNothing(ctx: CheckContext, out: CompilerCheckFinding[]): void {
    for (const proc of ctx.members) {
        if (!isProcedure(proc) || proc.endLine === undefined || !proc.parameters?.length) { continue; }
        for (const decl of proc.parameters) {
            const name = byValStringParamName(decl);
            if (!name) { continue; }
            const n = escapeRegExp(name);
            const check = new RegExp(`(?<![\\w.])${n}\\s+(?:Is|IsNot)\\s+Nothing\\b`, 'gi');
            const assign = new RegExp(`^\\s*${n}\\s*=`, 'i');
            for (let line = proc.line + 1; line < proc.endLine; line++) {
                const code = ctx.codeLines[line];
                // 본문에서 매개변수를 다시 대입하면(런타임 호출 결과 등) 그 뒤의 검사는 의미가 있다.
                if (assign.test(code)) { break; }
                check.lastIndex = 0;
                let m: RegExpExecArray | null;
                while ((m = check.exec(code)) !== null) {
                    out.push({
                        line,
                        start: m.index,
                        end: m.index + m[0].length,
                        code: 'byval-string-nothing-check',
                        severity: 'information',
                        message: `\`${name}\` 은 ByVal String 매개변수라 이 \`Is Nothing\` 검사는 도움이 되지 않습니다. Nothing 인 String 을 ByVal 로 넘기면 `
                            + '호출 자리에서 -782 가 나거나, String 을 돌려주는 함수는 예외 없이 결과가 깨집니다(`"A" & F(Nothing) & "B"` → `"B"`, 2026-10-22 실기). '
                            + `Nothing 을 받아야 하면 \`ByRef ${name} As String\` 으로 바꾸세요 — ByRef 에는 변수·필드·배열 원소만 넘길 수 있습니다. (ByVal/ByRef 를 생략하면 ByVal 입니다.)`,
                    });
                }
            }
        }
    }
}

// ─── ⑧ tick 모드 조그 속도 ──────────────────────────────────────────────────

function checkJogSpeed(ctx: CheckContext, out: CompilerCheckFinding[]): void {
    const re = /(?<![\w.])Move\s*\.\s*SetJogCommand\s*\(/gi;
    for (const ml of ctx.mapped) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(ml.code)) !== null) {
            const args = splitCallArgs(ml.code, m.index + m[0].length - 1);
            const speedArg = args[2] && trimSpan(ml.text, args[2]);
            if (!speedArg) { continue; }
            const literal = ml.text.slice(speedArg.start, speedArg.end).replace(/\s+/g, '');
            if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(literal)) { continue; }
            const speed = Math.abs(Number(literal));
            if (!(speed > 0 && speed <= JOG_TICK_MODE_MAX_PERCENT)) { continue; }
            out.push({
                ...toPhysical(ml, speedArg.start, speedArg.end),
                code: 'jog-tick-mode-speed',
                severity: 'information',
                message: `조그 속도 ${speed}% 는 ${JOG_TICK_MODE_MAX_PERCENT}% 이하라 tick 모드(한 걸음씩)로 동작합니다 — 연속 조그가 필요하면 ${JOG_TICK_MODE_MAX_PERCENT}% 를 넘기세요. `
                    + '(Brooks 문서 DataID 2825 "Tick mode is invoked whenever the jog speed is 5% or less", GPL `Move.SetJogCommand` 에도 적용됨을 2026-10-23 실기로 확인: -1.43% 로 2분 동안 0.003 mm 이동)',
            });
        }
    }
}

// ─── 진입점 ──────────────────────────────────────────────────────────────────

/**
 * 문서 하나의 실기 확인 컴파일러·제어기 사실 검사. 결과는 줄·열 순.
 * `lookup` 이 있으면 같은 컴파일 단위(참조 라이브러리 포함)의 다른 파일 심볼도 본다.
 */
export function findCompilerCheckFindings(content: string, filePath: string, lookup?: CompilerSymbolLookup): CompilerCheckFinding[] {
    const ctx = new CheckContext(content, filePath, lookup);
    const out: CompilerCheckFinding[] = [];
    checkOverloadReturnTypes(ctx, out);
    checkNewParens(ctx, out);
    checkMemberShadowsModule(ctx, out);
    checkLongStringLiterals(ctx, out);
    checkThreadNames(ctx, out);
    checkPrivateSharedAccess(ctx, out);
    checkByValStringNothing(ctx, out);
    checkJogSpeed(ctx, out);
    return out.sort((a, b) => a.line - b.line || a.start - b.start);
}
