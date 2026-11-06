/**
 * 소스 최적화용 **엄격한** 선언 구조 스캐너 — 파일을 Module·Class·Sub·Function·Property·Delegate·Const·변수 선언 단위로 나누고,
 * 선언마다 물리 줄 범위와 그 안의 참조 낱말을 모은다. vscode·fs 무의존 순수 모듈.
 *
 * 왜 `GPLParser` 를 쓰지 않나: 그쪽은 편집 중인 불완전한 소스도 견디도록 관대하게 만든 IDE 용이다. 최적화는 줄을 **지우므로**
 * 모르는 문장을 만나면 추측하지 않고 그 파일을 통째로 "불규칙"으로 돌려 아무것도 지우지 않게 해야 한다.
 *
 * 문법 근거(문서상): Module·Class·Sub·Function·Property 는 `End …` 로 닫히고, 클래스는 파일 최상위·모듈 안·클래스 안에 올 수 있다
 * (User-Defined Classes https://www2.brooksautomation.com/Controller_Software/Introduction_To_The_Software/Guidance_Programming_Language/user_classes.htm),
 * 한 줄에 한 문장, ` _` 로 이어 쓰기, `'` 주석, `#` 줄 무시(statementstructure.htm). 프로시저는 괄호 없이도 부를 수 있다(`aa.Increment`) —
 * 그래서 참조는 "호출 모양"이 아니라 **낱말**로 센다.
 */

import { stripComment } from '../../language/checks/logicalLines';

export type MemberKind = 'class' | 'sub' | 'function' | 'property' | 'delegate' | 'const' | 'variable';

/** 참조 낱말(소문자). `dotted` 는 점 뒤 낱말과 바로 앞 낱말(`A.b` → prefix `a`, 앞이 낱말이 아니면 빈 문자열). */
export interface MemberRefs {
    undotted: string[];
    dotted: { prefix: string; name: string }[];
}

export interface SourceMember {
    kind: MemberKind;
    /** 선언 이름(소문자) — `Dim a, b` 는 둘. */
    names: string[];
    /** 첫 이름(원래 대소문자) — 보고용. */
    displayName: string;
    /** 둘러싼 Module 이름(소문자). 파일 최상위 클래스·그 멤버는 undefined. */
    module?: string;
    /** 둘러싼 클래스의 이 파일 안 인덱스. 모듈 직속·최상위면 undefined. */
    parent?: number;
    /** 물리 줄(0 기준, 끝 포함). */
    startLine: number;
    endLine: number;
    /** 지워도 되는가 — 부작용 있는 초기화(`New`·호출)가 붙은 변수는 false. */
    removable: boolean;
    /** `Shared` 수식어가 있는가(클래스 공유 변수의 초기화는 객체 없이도 돈다). */
    shared?: boolean;
    /** 이 선언 범위 안의 참조(자식 선언의 범위는 빼고). */
    refs: MemberRefs;
}

export interface ScannedSource {
    members: SourceMember[];
    /** 이 파일의 Module 이름(소문자). */
    modules: string[];
    /** 모르는 문장·짝 없는 블록을 만나면 그 이유 — 이 파일에서는 아무것도 지우지 않는다. */
    irregular?: string;
    /** 파일 전체의 참조(불규칙 파일을 통째로 출발점으로 삼을 때 쓴다). */
    allRefs: MemberRefs;
}

interface LogicalLine {
    first: number;
    last: number;
    /** 주석을 뺀 원문(문자열 보존). */
    text: string;
    /** 문자열 내용을 공백으로 지운 판정용 텍스트(앞뒤 공백 제거). */
    key: string;
}

const IDENT = '[A-Za-z_]\\w*';
const MODS = '(?:(?:Public|Private|Protected|Friend|Shared|Overloads|Overrides|Overridable|Shadows|ReadOnly|WriteOnly|Static|Default)\\s+)*';
const RE_MODULE = new RegExp(`^Module\\s+(${IDENT})$`, 'i');
const RE_END_MODULE = /^End\s+Module$/i;
const RE_CLASS = new RegExp(`^${MODS}Class\\s+(${IDENT})$`, 'i');
const RE_END_CLASS = /^End\s+Class$/i;
const RE_PROC = new RegExp(`^${MODS}(Sub|Function|Property)\\s+(${IDENT})\\b`, 'i');
const RE_DELEGATE = new RegExp(`^${MODS}Delegate\\s+(?:Sub|Function)\\s+(${IDENT})\\b`, 'i');
const RE_CONST = new RegExp(`^${MODS}Const\\s+(.+)$`, 'i');
const RE_DIM = new RegExp(`^${MODS}Dim\\s+(.+)$`, 'i');
const RE_MODIFIED_VAR = /^((?:(?:Public|Private|Protected|Friend|Shared|ReadOnly|Static)\s+)+)(.+)$/i;
const RESERVED_AFTER_MODS = /^(?:Sub|Function|Property|Class|Module|Delegate|Const|Dim|Event|Enum|Structure|Interface|Declare|Operator)\b/i;

function blankStrings(text: string): string {
    let out = '';
    let inString = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '"') {
            if (inString && text[i + 1] === '"') { out += '  '; i++; continue; }
            inString = !inString;
            out += ch;
        } else {
            out += inString ? ' ' : ch;
        }
    }
    return out;
}

/** 물리 줄 → 논리 줄(` _` 이어 쓰기 결합, 주석 제거). 빈 줄은 빼지 않는다(인덱스 계산을 단순히). */
function buildLogicalLines(text: string): LogicalLine[] {
    const raw = text.split(/\r\n|\n|\r/);
    const out: LogicalLine[] = [];
    let i = 0;
    while (i < raw.length) {
        const first = i;
        let joined = '';
        for (;;) {
            const code = stripComment(raw[i]).replace(/\s+$/, '');
            if (/(^|\s)_$/.test(code) && i + 1 < raw.length) {
                joined += code.slice(0, -1) + ' ';
                i++;
                continue;
            }
            joined += code;
            break;
        }
        out.push({ first, last: i, text: joined, key: blankStrings(joined).trim() });
        i++;
    }
    return out;
}

/** 낱말 하나를 refs 에 넣는다 — 점 뒤면 바로 앞 낱말을 prefix 로. */
function collectWords(code: string, refs: MemberRefs): void {
    const re = new RegExp(IDENT, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
        const name = m[0].toLowerCase();
        // 숫자 바로 뒤 낱말은 숫자 표기의 일부다(`1E5` 의 `E5`).
        if (/[0-9]/.test(code[m.index - 1] ?? '')) { continue; }
        let j = m.index - 1;
        while (j >= 0 && (code[j] === ' ' || code[j] === '\t')) { j--; }
        if (j < 0 || code[j] !== '.') { refs.undotted.push(name); continue; }
        let k = j - 1;
        while (k >= 0 && (code[k] === ' ' || code[k] === '\t')) { k--; }
        let s = k;
        while (s >= 0 && /\w/.test(code[s])) { s--; }
        const prefix = k >= 0 && /\w/.test(code[k]) && /[A-Za-z_]/.test(code[s + 1]) ? code.slice(s + 1, k + 1).toLowerCase() : '';
        refs.dotted.push({ prefix, name });
    }
}

/** 논리 줄의 참조 — 코드 부분과 문자열 안(스레드 진입점 `"FLR.Loop"` 등)을 같은 규칙으로. */
function collectLineRefs(line: LogicalLine, refs: MemberRefs): void {
    const blanked = blankStrings(line.text);
    collectWords(blanked, refs);
    const strings = line.text.match(/"(?:[^"]|"")*"/g) ?? [];
    for (const s of strings) { collectWords(s.slice(1, -1).replace(/""/g, '"'), refs); }
}

function emptyRefs(): MemberRefs {
    return { undotted: [], dotted: [] };
}

/** `Dim`·`Const`·수식어 변수 선언의 이름들과 부작용 있는 초기화 여부. 이름을 못 읽으면 undefined. */
function parseDeclaration(rest: string): { names: string[]; display: string; sideEffect: boolean } | undefined {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < rest.length; i++) {
        const ch = rest[i];
        if (ch === '(') { depth++; } else if (ch === ')') { depth--; } else if (ch === ',' && depth === 0) {
            parts.push(rest.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(rest.slice(start));
    const names: string[] = [];
    let display = '';
    let sideEffect = false;
    for (const part of parts) {
        const m = new RegExp(`^\\s*(${IDENT})`).exec(part);
        if (!m) { continue; }
        names.push(m[1].toLowerCase());
        display = display || m[1];
        const eq = part.indexOf('=');
        const init = eq >= 0 ? part.slice(eq + 1) : '';
        if (/\bNew\b/i.test(part) || init.includes('(')) { sideEffect = true; }
    }
    return names.length > 0 ? { names, display, sideEffect } : undefined;
}

interface Frame { kind: 'file' | 'module' | 'class'; module?: string; classIndex?: number }

/** 선언 구조를 읽는다. 모르는 문장을 만나면 `irregular` 를 채우고 그때까지의 멤버는 버린다. */
export function scanSourceMembers(text: string): ScannedSource {
    const lines = buildLogicalLines(text);
    const allRefs = emptyRefs();
    for (const l of lines) { collectLineRefs(l, allRefs); }
    const members: SourceMember[] = [];
    const modules: string[] = [];
    const stack: Frame[] = [{ kind: 'file' }];
    const fail = (why: string, line: number): ScannedSource => ({ members: [], modules, irregular: `${line + 1}행: ${why}`, allRefs });

    for (let li = 0; li < lines.length; li++) {
        const line = lines[li];
        const key = line.key;
        const top = stack[stack.length - 1];
        if (key === '' || key.startsWith('#')) { continue; }
        let m: RegExpExecArray | null;
        if ((m = RE_MODULE.exec(key))) {
            if (top.kind !== 'file') { return fail('Module 이 최상위가 아님', line.first); }
            modules.push(m[1].toLowerCase());
            stack.push({ kind: 'module', module: m[1].toLowerCase() });
            continue;
        }
        if (RE_END_MODULE.test(key)) {
            if (top.kind !== 'module') { return fail('짝 없는 End Module', line.first); }
            stack.pop();
            continue;
        }
        if (RE_END_CLASS.test(key)) {
            if (top.kind !== 'class') { return fail('짝 없는 End Class', line.first); }
            const cls = members[top.classIndex!];
            cls.endLine = line.last;
            collectLineRefs(line, cls.refs);
            stack.pop();
            continue;
        }
        const base = { module: top.module, parent: top.classIndex };
        if ((m = RE_CLASS.exec(key))) {
            const refs = emptyRefs();
            collectLineRefs(line, refs);
            members.push({ kind: 'class', names: [m[1].toLowerCase()], displayName: m[1], ...base, startLine: line.first, endLine: -1, removable: true, refs });
            stack.push({ kind: 'class', module: top.module, classIndex: members.length - 1 });
            continue;
        }
        if (top.kind === 'file') { return fail('Module·Class 밖의 문장', line.first); }
        if ((m = RE_PROC.exec(key))) {
            const kind = m[1].toLowerCase() as 'sub' | 'function' | 'property';
            const endRe = new RegExp(`^End\\s+${m[1]}$`, 'i');
            let end = li + 1;
            while (end < lines.length && !endRe.test(lines[end].key)) { end++; }
            if (end >= lines.length) { return fail(`짝 없는 ${m[1]} ${m[2]}`, line.first); }
            const refs = emptyRefs();
            for (let k = li; k <= end; k++) { collectLineRefs(lines[k], refs); }
            members.push({ kind, names: [m[2].toLowerCase()], displayName: m[2], ...base, startLine: line.first, endLine: lines[end].last, removable: true, refs });
            li = end;
            continue;
        }
        const single = classifySingleLine(key);
        if (!single) { return fail(`모르는 선언문(${key.slice(0, 40)})`, line.first); }
        const refs = emptyRefs();
        collectLineRefs(line, refs);
        members.push({ ...single, ...base, startLine: line.first, endLine: line.last, refs });
    }
    if (stack.length !== 1) { return fail('닫히지 않은 블록', lines.length - 1); }
    if (members.some(mm => mm.kind === 'class' && mm.endLine < 0)) { return fail('닫히지 않은 Class', lines.length - 1); }
    return { members, modules, allRefs };
}

/** 한 줄 선언(Delegate·Const·변수). 아니면 undefined. */
function classifySingleLine(key: string): Pick<SourceMember, 'kind' | 'names' | 'displayName' | 'removable' | 'shared'> | undefined {
    let m: RegExpExecArray | null;
    if ((m = RE_DELEGATE.exec(key))) {
        return { kind: 'delegate', names: [m[1].toLowerCase()], displayName: m[1], removable: true };
    }
    if ((m = RE_CONST.exec(key))) {
        const d = parseDeclaration(m[1]);
        return d ? { kind: 'const', names: d.names, displayName: d.display, removable: true } : undefined;
    }
    let rest: string | undefined;
    if ((m = RE_DIM.exec(key))) {
        rest = m[1];
    } else if ((m = RE_MODIFIED_VAR.exec(key)) && !RESERVED_AFTER_MODS.test(m[2])) {
        rest = m[2];
    }
    if (rest === undefined) { return undefined; }
    const d = parseDeclaration(rest);
    const shared = /\bShared\b/i.test(key.slice(0, key.length - rest.length));
    return d ? { kind: 'variable', names: d.names, displayName: d.display, removable: !d.sideEffect, shared } : undefined;
}
