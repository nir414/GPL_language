/**
 * 디버깅 대상 줄·호출 지점 분석 — 순수 로직(vscode 무의존).
 *
 * 세 기능이 이 모듈을 공유한다.
 *
 * 1. **BP 유효 줄 힌트**(`breakpointLocations`): 공식 문서(Set Break)가 "지정한 명령은 프로시저 안에
 *    있어야 하고, 빈 줄이나 주석을 지정하면 그 다음 실행 가능한 명령에 BP가 설정된다"고 규정한다.
 *    즉 제어기는 조용히 줄을 옮긴다 — 어느 줄로 옮겨지는지 미리 보여 주는 것이 이 함수들의 목적이다.
 * 2. **Jump to Cursor**(`Set Thread <thread> -line <n>`): 문서상 새 줄은 **현재 줄과 같은 프로시저 안**이어야
 *    하고 실행 가능한 문장이 있어야 한다. `enclosingProcedure`로 같은 프로시저인지 확인한다.
 * 3. **Step Into Target**: 현재 줄에 호출이 여러 개면 어느 호출로 들어갈지 고를 수 있어야 한다.
 *    `parseCallTargets`가 줄에서 호출 후보를 뽑고, 어댑터가 정의 위치에 임시 BP를 걸어 진입한다.
 *
 * 줄 번호는 모두 **1-based**(제어기 `Set Break`/`Show Thread`와 같은 기준)다.
 *
 * 단위 테스트: src/test/sourceTargets.test.ts
 */

/** 프로시저(Sub/Function) 한 개의 줄 범위. start/end 모두 포함(1-based). */
export interface ProcedureRange {
    name: string;
    /** 헤더 줄(`Sub Foo(...)`)의 1-based 줄 번호 */
    start: number;
    /** 이 프로시저의 마지막 줄(`End Sub`/`End Function`, 못 찾으면 다음 헤더 직전 또는 파일 끝) */
    end: number;
}

/** 현재 줄에서 발견한 호출 후보. */
export interface CallTarget {
    /** 호출 이름(마지막 세그먼트 — `robot.Move` 의 `Move`) */
    name: string;
    /** 점 표기의 수신자(`robot.Move` → `robot`). 없으면 undefined */
    receiver?: string;
    /** 표시용 전체 표기(`robot.Move`) */
    label: string;
    /** 0-based 열 위치(줄 안에서 이름이 시작하는 곳) */
    column: number;
}

/** 문자열 리터럴을 공백으로, 인라인 주석 이후를 제거한 "코드만" 남긴 문자열. */
export function stripToCode(line: string): string {
    let out = '';
    let inString = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inString) {
            if (ch === '"') {
                if (line[i + 1] === '"') { out += '  '; i++; continue; }
                inString = false;
            }
            out += ' ';
            continue;
        }
        if (ch === '"') { inString = true; out += ' '; continue; }
        if (ch === "'") { break; }
        out += ch;
    }
    return out;
}

/** 빈 줄이거나 주석만 있는 줄인가 — 문서가 말하는 "BP가 다음 줄로 옮겨지는" 조건. */
export function isBlankOrComment(line: string | undefined): boolean {
    const code = stripToCode(line ?? '').trim();
    if (code.length === 0) { return true; }
    // VB/GPL 의 `Rem` 주석. `Remove(...)` 같은 식별자와 구분하려고 단어 경계를 본다.
    return /^rem(\s|$)/i.test(code);
}

/** `End Sub` / `End Function` 줄인가(프로시저 끝 판정용). */
export function isProcedureEnd(line: string | undefined): boolean {
    return /^\s*end\s+(sub|function)\s*$/i.test(stripToCode(line ?? ''));
}

/**
 * 제어기가 실제로 BP를 걸 줄 — 지정 줄이 빈 줄/주석이면 다음 실행 가능한 줄로 내린다.
 * 프로시저 범위를 주면 그 범위 안에서만 찾는다(범위 안에 실행 줄이 없으면 undefined).
 */
export function resolveBreakpointLine(
    lines: readonly string[],
    line: number,
    range?: ProcedureRange,
): number | undefined {
    const limit = range ? Math.min(range.end, lines.length) : lines.length;
    if (line < 1 || line > limit) { return undefined; }
    for (let l = line; l <= limit; l++) {
        if (!isBlankOrComment(lines[l - 1])) { return l; }
    }
    return undefined;
}

/**
 * 파서가 준 프로시저 심볼(이름 + 1-based 헤더 줄)로 범위를 만든다.
 * 심볼은 줄 순서로 정렬되어 있지 않아도 된다.
 *
 * `lines`를 주면 `End Sub`/`End Function`을 실제 끝으로 잡는다 — 그러지 않으면 마지막 프로시저
 * 범위에 `End Module` 같은 프로시저 밖 줄이 딸려 들어간다.
 */
export function buildProcedureRanges(
    procs: readonly { name: string; line: number }[],
    totalLines: number,
    lines?: readonly string[],
): ProcedureRange[] {
    const sorted = [...procs].filter(p => p.line >= 1).sort((a, b) => a.line - b.line);
    const ranges: ProcedureRange[] = [];
    for (let i = 0; i < sorted.length; i++) {
        const p = sorted[i];
        const hardEnd = i + 1 < sorted.length ? Math.max(p.line, sorted[i + 1].line - 1) : totalLines;
        let end = hardEnd;
        if (lines) {
            const scanTo = Math.min(hardEnd, lines.length);
            for (let l = p.line; l <= scanTo; l++) {
                if (isProcedureEnd(lines[l - 1])) { end = l; break; }
            }
        }
        ranges.push({ name: p.name, start: p.line, end });
    }
    return ranges;
}

/** 이 줄을 포함하는 프로시저. 프로시저 밖(모듈 선언부 등)이면 undefined. */
export function enclosingProcedure(ranges: readonly ProcedureRange[], line: number): ProcedureRange | undefined {
    return ranges.find(r => line >= r.start && line <= r.end);
}

/**
 * BP를 걸 수 있는 줄 목록 — 프로시저 안의, 빈 줄·주석이 아닌 줄(헤더 줄 제외).
 * `from`/`to`(1-based, 포함)로 구간을 제한한다.
 */
export function breakpointCandidateLines(
    lines: readonly string[],
    ranges: readonly ProcedureRange[],
    from = 1,
    to = lines.length,
): number[] {
    const out: number[] = [];
    const lo = Math.max(1, from);
    const hi = Math.min(lines.length, to);
    for (let l = lo; l <= hi; l++) {
        if (isBlankOrComment(lines[l - 1])) { continue; }
        const proc = enclosingProcedure(ranges, l);
        if (!proc) { continue; }
        // 프로시저 헤더(`Sub Foo(...)`)는 실행 명령이 아니다 — 문서: "지정한 명령은 프로시저 안에 있어야 한다".
        if (l === proc.start) { continue; }
        out.push(l);
    }
    return out;
}

/** 호출 후보로 볼 수 없는 키워드(제어 구문·선언). 대소문자 무시. */
const NOT_A_CALL = new Set([
    'if', 'elseif', 'else', 'end', 'for', 'next', 'while', 'do', 'loop', 'until', 'select', 'case',
    'sub', 'function', 'return', 'dim', 'as', 'new', 'and', 'or', 'not', 'xor', 'mod', 'to', 'step',
    'then', 'exit', 'goto', 'try', 'catch', 'finally', 'throw', 'with', 'byval', 'byref', 'optional',
    'public', 'private', 'shared', 'const', 'readonly', 'module', 'class', 'property', 'get', 'set',
]);

/** 이 위치 앞이 `New` 인가 — 생성자는 호출 후보가 아니다. */
function precededByNew(code: string, index: number): boolean {
    return /(^|[^A-Za-z0-9_])new\s*$/i.test(code.slice(0, index));
}

/**
 * 한 줄에서 호출 후보를 뽑는다 — `Foo(...)`, `obj.Method(...)`, `Call Foo`.
 * 문자열·주석은 제외하고, 제어 구문 키워드와 `New` 생성자는 후보에서 뺀다.
 * 같은 표기가 여러 번 나오면 첫 등장만 남긴다.
 */
export function parseCallTargets(line: string): CallTarget[] {
    const code = stripToCode(line ?? '');
    const out: CallTarget[] = [];
    const seen = new Set<string>();

    const push = (dotted: string, column: number): void => {
        const parts = dotted.split('.').filter(Boolean);
        const name = parts[parts.length - 1];
        if (!name || NOT_A_CALL.has(name.toLowerCase())) { return; }
        const label = parts.join('.');
        const key = label.toLowerCase();
        if (seen.has(key)) { return; }
        seen.add(key);
        out.push({
            name,
            receiver: parts.length > 1 ? parts.slice(0, -1).join('.') : undefined,
            label,
            column,
        });
    };

    // `Call Foo` / `Call obj.Foo` — 괄호가 없어도 호출이다.
    const callKeyword = /(^|[^A-Za-z0-9_.])call\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/gi;
    let m: RegExpExecArray | null;
    while ((m = callKeyword.exec(code)) !== null) {
        push(m[2], m.index + m[0].indexOf(m[2]));
    }

    // `Name(` 또는 `a.b.Name(` — `New Thread(` 같은 생성자는 건너뛴다
    // (문서상 `New Thread` 는 이름만 기록하고 실제 실행은 Start 가 한다).
    const withParens = /([A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)*)\s*\(/g;
    while ((m = withParens.exec(code)) !== null) {
        if (precededByNew(code, m.index)) { continue; }
        push(m[1].replace(/\s+/g, ''), m.index);
    }

    return out;
}
