/**
 * GPL 소스 줄 전처리 — 주석 제거·줄 연속 결합·문자열 무력화·호출 인자 분리. vscode 무의존 순수 모듈.
 * `compilerChecks`·`delegateChecks` 가 함께 쓴다(compilerChecks 에서 옮김, 동작 불변).
 */

import { GPLParser } from '../syntax/gplParser';

// ─── 줄 전처리 ───────────────────────────────────────────────────────────────

/** 문자열은 그대로 두고 문자열 밖 `'` 이후(주석)만 잘라낸다. */
export function stripComment(line: string): string {
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
export interface MappedLine {
    /** 주석만 지운 원문(문자열 보존). */
    text: string;
    /** 문자열 내부를 공백으로 바꾼 코드(위치 동일). */
    code: string;
    segments: { line: number; offset: number; length: number }[];
}

export function buildMappedLines(rawLines: readonly string[]): MappedLine[] {
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
export function toPhysical(ml: MappedLine, from: number, to: number): { line: number; start: number; end: number } {
    let seg = ml.segments[0];
    for (const s of ml.segments) {
        if (s.offset <= from) { seg = s; }
    }
    const start = Math.max(0, from - seg.offset);
    const end = Math.min(seg.length, Math.max(start + 1, to - seg.offset));
    return { line: seg.line, start, end: Math.max(end, start + 1) };
}

/** 문자열 리터럴 위치(따옴표 포함)와 내용. `""` 는 따옴표 하나로 푼다. */
export function findStringLiterals(text: string, from = 0, to = text.length): { start: number; end: number; value: string }[] {
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
export function splitCallArgs(code: string, openParen: number): { start: number; end: number }[] {
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
export function trimSpan(text: string, span: { start: number; end: number }): { start: number; end: number } | undefined {
    let s = span.start;
    let e = span.end;
    while (s < e && /\s/.test(text[s])) { s++; }
    while (e > s && /\s/.test(text[e - 1])) { e--; }
    return s < e ? { start: s, end: e } : undefined;
}
