/**
 * 파일·제어기 실기 사실 검사 — 파일 끝 줄바꿈, 장치 루트 `File.CreateDirectory`, 스레드 진입점의 Catch 부재.
 * vscode 무의존 순수 모듈. 진입점은 `compilerChecks.findAllCompilerCheckFindings` 가 부른다(코드·심각도 표는 그쪽 머리 주석).
 *
 * 근거(Sample Prep 보고, GPL 4.2K5):
 *   - `missing-final-newline`: 마지막 줄 뒤에 LF 가 없으면 Compile `-505 Unexpected end of file`, LF 하나를 더하자 에러 0(2026-11-05 실측).
 *   - `create-directory-device-root`: `File.CreateDirectory("/ROMDISK")` 가 `-300`(Invalid device 계열)이었다(2026-11-05 실측).
 *     문서상 경로는 "장치 이름으로 시작해 새 디렉터리 이름으로 끝남"이다(GPL_Dictionary File/createdirectory).
 *   - `thread-entry-without-catch`: 잡히지 않은 예외는 스레드를 Error 로 멈춘다. Catch+재던짐을 곳곳에 덧붙여도 막지 못하고(2026-11-06 실측),
 *     막아야 할 곳은 진입점 최상위다. 같은 파일 안에서 문자열 대상이 풀리는 경우만 본다(다른 파일은 본문을 알 수 없다).
 */

import { GPLParser, GPLSymbol, GPLSymbolKind } from '../syntax/gplParser';
import { findStringLiterals, buildMappedLines, splitCallArgs, stripComment, toPhysical, trimSpan } from './logicalLines';
import type { CompilerCheckFinding } from './compilerChecks';

export interface FileCheckOptions {
    /** `thread-entry-without-catch` 를 낼지(기본 true). */
    threadEntryWithoutCatch?: boolean;
}

/** `File.CreateDirectory` 가 만들 수 없는 장치 루트 — 보고에서 확인한 이름만(대소문자 무시). */
const DEVICE_ROOTS = new Set(['romdisk', 'flash', 'gpl']);

function checkFinalNewline(content: string, out: CompilerCheckFinding[]): void {
    if (content.length === 0 || content.endsWith('\n')) { return; }
    const lines = content.split('\n');
    const lastIdx = lines.length - 1;
    const last = lines[lastIdx].replace(/\r$/, '');
    if (last.trim().length === 0) { return; }
    const start = last.search(/\S/);
    const hasCode = stripComment(last).trim().length > 0;
    const eol = content.includes('\r\n') ? '\r\n' : '\n';
    out.push({
        line: lastIdx,
        start,
        end: last.length,
        code: 'missing-final-newline',
        severity: hasCode ? 'warning' : 'information',
        message: '파일이 줄바꿈으로 끝나지 않습니다. 제어기 Compile 이 `-505 Unexpected end of file` 로 실패합니다'
            + '(마지막 줄 뒤에 LF 가 없던 파일에 LF 하나를 더하자 에러 0, 2026-11-05 Sample Prep 실측).',
        fix: { title: '파일 끝에 줄바꿈 추가', newText: last.slice(start) + eol },
    });
}

function checkCreateDirectoryDeviceRoot(content: string, out: CompilerCheckFinding[]): void {
    const re = /(?<![\w.])File\s*\.\s*CreateDirectory\s*\(/gi;
    for (const ml of buildMappedLines(content.split('\n'))) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(ml.code)) !== null) {
            const arg = splitCallArgs(ml.code, m.index + m[0].length - 1)[0];
            const span = arg && trimSpan(ml.text, arg);
            if (!span) { continue; }
            const lits = findStringLiterals(ml.text, span.start, span.end);
            if (lits.length !== 1 || lits[0].start !== span.start || lits[0].end !== span.end) { continue; }
            const dev = /^\/([A-Za-z0-9_]+)\/?$/.exec(lits[0].value);
            if (!dev || !DEVICE_ROOTS.has(dev[1].toLowerCase())) { continue; }
            out.push({
                ...toPhysical(ml, span.start, span.end),
                code: 'create-directory-device-root',
                severity: 'warning',
                message: `\`File.CreateDirectory("${lits[0].value}")\` 는 장치 루트 자체를 만들려는 호출입니다 — 제어기가 \`-300\`(Invalid device 계열)으로 거부했습니다`
                    + '(2026-11-05 Sample Prep 실측, 장치는 정상). 문서상 경로는 "장치 이름으로 시작해 새 디렉터리 이름으로 끝남"이므로 '
                    + '부모가 장치 루트면 건너뛰고 그 아래 폴더만 만드세요.',
            });
        }
    }
}

function isEntryCandidate(s: GPLSymbol, moduleOrClass: string | undefined, procName: string): boolean {
    if (s.kind !== GPLSymbolKind.Sub || s.isLocal || s.name.toLowerCase() !== procName.toLowerCase()) { return false; }
    if (moduleOrClass === undefined) { return !s.className; }
    const q = moduleOrClass.toLowerCase();
    return (s.className ?? s.module ?? '').toLowerCase() === q;
}

/** 본문(선언 다음 줄 ~ End 앞 줄)에 Catch 가 하나라도 있는가 — 중첩·루프 안의 Catch 도 인정해 소음을 줄인다. */
function bodyHasCatch(codeLines: readonly string[], from: number, to: number): boolean {
    for (let i = from; i < to; i++) {
        if (/^\s*Catch\b/i.test(codeLines[i] ?? '')) { return true; }
    }
    return false;
}

function checkThreadEntryWithoutCatch(content: string, filePath: string, out: CompilerCheckFinding[]): void {
    if (!/\bNew\s+Thread\s*\(/i.test(content)) { return; }
    const rawLines = content.split('\n');
    const codeLines = rawLines.map(l => GPLParser.stripToCode(l.replace(/\r$/, '')));
    const symbols = GPLParser.parseDocument(content, filePath);
    const re = /\bNew\s+Thread\s*\(/gi;
    for (const ml of buildMappedLines(rawLines)) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(ml.code)) !== null) {
            const arg = splitCallArgs(ml.code, m.index + m[0].length - 1)[0];
            const span = arg && trimSpan(ml.text, arg);
            if (!span) { continue; }
            const lits = findStringLiterals(ml.text, span.start, span.end);
            if (lits.length !== 1 || lits[0].start !== span.start || lits[0].end !== span.end) { continue; }
            const parts = lits[0].value.trim().split('.');
            if (parts.length > 2 || parts.some(p => !/^[A-Za-z_]\w*$/.test(p))) { continue; }
            const procName = parts[parts.length - 1];
            const owner = parts.length === 2 ? parts[0] : undefined;
            const found = symbols.filter(s => isEntryCandidate(s, owner, procName));
            if (found.length !== 1 || found[0].endLine === undefined) { continue; }
            if (bodyHasCatch(codeLines, found[0].line + 1, found[0].endLine)) { continue; }
            out.push({
                ...toPhysical(ml, span.start, span.end),
                code: 'thread-entry-without-catch',
                severity: 'information',
                message: `스레드 진입점 \`${lits[0].value}\` 의 본문에 Try … Catch 가 없습니다. 진입점에서 예외를 잡아 기록하지 않으면 스레드가 Error 로 멈춥니다. `
                    + '(Catch+재던짐을 안쪽 Try 마다 덧붙여도 막지 못합니다 — 진입점 최상위 한 곳이면 충분합니다, 2026-11-06 Sample Prep 실측)',
            });
        }
    }
}

/**
 * `Exit Property` — 문서상 Exit.htm 구문 목록에 있지만 4.2K5 는 Property 의 Get·Set·ReadOnly Get 어디서든
 * Compile `-719 *Illegal use of keyword*` 로 거부했다(2026-11-13 실측, G2400C 192.168.0.1, captures/probe-exitprop).
 */
function checkExitProperty(content: string, out: CompilerCheckFinding[]): void {
    if (!/\bExit\s+Property\b/i.test(content)) { return; }
    for (const ml of buildMappedLines(content.split('\n'))) {
        // 문장 머리(줄 처음·`:` 뒤·한 줄 If 의 Then/Else 뒤)에 올 때만 — 문자열은 ml.code 에서 이미 지워져 있다.
        const m = /(?:^|:|\bThen\b|\bElse\b)\s*(Exit\s+Property)\b/i.exec(ml.code);
        if (!m) { continue; }
        const start = m.index + m[0].length - m[1].length;
        out.push({
            ...toPhysical(ml, start, start + m[1].length),
            code: 'exit-property-rejected',
            severity: 'error',
            message: '`Exit Property` 는 문서상 구문이지만 제어기(GPL 4.2K5)가 Compile `-719 *Illegal use of keyword*` 로 거부합니다'
                + '(Get·Set 모두, 2026-11-13 실측). Get 에서는 `Return 값`, Set 에서는 If … Else 분기로 바꾸세요.',
        });
    }
}

/**
 * 한 줄에 `:` 로 문장 여럿 — VB 식 `Callee(4) : i = 4` 는 4.2K5 Compile `-722 *Unexpected text at end of line*` 였다
 * (2026-11-13 실측, captures/probe-callerline). 줄 맨 앞 라벨(`Retry:`)은 문법이므로 건너뛰고, 그 뒤의 `:` 만 본다.
 */
function checkColonSeparator(content: string, out: CompilerCheckFinding[]): void {
    if (!content.includes(':')) { return; }
    for (const ml of buildMappedLines(content.split('\n'))) {
        const label = /^\s*[A-Za-z_]\w*\s*:(?!=)/.exec(ml.code);
        const from = label ? label[0].length : 0;
        const idx = ml.code.slice(from).search(/:(?!=)/);
        if (idx < 0) { continue; }
        const at = from + idx;
        if (ml.code.slice(at + 1).trim() === '' && !ml.code.slice(0, at).trim()) { continue; }
        out.push({
            ...toPhysical(ml, at, at + 1),
            code: 'statement-separator-colon',
            severity: 'error',
            message: '`:` 로 한 줄에 문장을 여럿 쓸 수 없습니다 — 제어기(GPL 4.2K5)가 Compile `-722 *Unexpected text at end of line*` 로 거부합니다'
                + '(2026-11-13 실측). 문장마다 줄을 나누세요.',
        });
    }
}

/** 파일·제어기 실기 사실 검사 결과. 정렬은 호출자가 한다. */
export function findFileCheckFindings(content: string, filePath: string, options: FileCheckOptions = {}): CompilerCheckFinding[] {
    const out: CompilerCheckFinding[] = [];
    checkFinalNewline(content, out);
    checkCreateDirectoryDeviceRoot(content, out);
    checkExitProperty(content, out);
    checkColonSeparator(content, out);
    if (options.threadEntryWithoutCatch !== false) { checkThreadEntryWithoutCatch(content, filePath, out); }
    return out;
}
