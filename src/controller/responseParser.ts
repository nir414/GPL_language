/**
 * Brooks Controller 콘솔 응답 파서.
 * 모든 파싱 로직을 중앙 관리하여 펌웨어 변동에 단일 지점에서 대응한다.
 */

// ─── STATUS ───────────────────────────────────────────────

export interface StatusResult {
    code: number;
    message: string;
    raw: string;
}

/**
 * 응답에서 `<STATUS>code,"message"</STATUS>` 추출.
 * STATUS가 없으면 code = -9999.
 */
export function parseStatus(response: string): StatusResult {
    const m = response.match(/<STATUS>\s*(-?\d+)(?:,\s*"([^"]*)")?/);
    if (m) {
        return { code: parseInt(m[1], 10), message: m[2] || '', raw: response };
    }
    return { code: -9999, message: 'No STATUS found', raw: response };
}

export function isSuccess(response: string): boolean {
    return parseStatus(response).code === 0;
}

// ─── Compile Errors ───────────────────────────────────────

export interface CompileError {
    file: string;
    line: number;
    code: number;
    message: string;
}

/**
 * 컴파일 응답에서 에러 목록 추출.
 * 형식: `[CONSOLE] filename.gpl:42:(-100): message`
 */
export function parseCompileErrors(text: string): CompileError[] {
    const errors: CompileError[] = [];
    const regex = /(?:\[CONSOLE\] )?([^\s:]+\.(?:gpl|gpr)):(\d+):\((-?\d+)\):\s*(.+)/gi;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
        errors.push({
            file: m[1],
            line: parseInt(m[2], 10),
            code: parseInt(m[3], 10),
            message: m[4].trim(),
        });
    }
    return errors;
}

// ─── Threads ──────────────────────────────────────────────

export type ThreadState = 'Running' | 'Idle' | 'Error' | 'Stopping' | 'Stopped' | 'Break' | 'Paused' | string;

export interface ThreadInfo {
    name: string;
    state: ThreadState;
    lastStatus: string;
    project: string;
    file: string;
}

export interface ThreadDetailInfo {
    name: string;
    state: ThreadState;
    statusCode: number;
    statusMessage: string;
    project: string;
    process: string;
    procLine: number;
    file: string;
    fileLine: number;
}

/**
 * `Show Thread` 응답 파싱.
 * 펌웨어마다 컬럼 구분자/갯수가 다를 수 있으므로 유연하게 처리한다.
 * 지원 형식:
 *   - 탭/2+공백 구분: `ThreadName    Running    0    proj    file`
 *   - 쉼표 구분:      `ThreadName, Running`
 */
export function parseThreadList(text: string): ThreadInfo[] {
    const threads: ThreadInfo[] = [];
    // XML 태그를 먼저 제거하여 <DATA>content</DATA> 같은 인라인 형식도 처리
    const cleaned = text.replace(/<\/?[A-Za-z][^>]*>/g, '');
    const lines = cleaned.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed
            || /^[-=]+$/.test(trimmed)
            || /Thread\s*Name/i.test(trimmed)
            || /^-?\d+\s*,\s*"[^"]*"\s*$/.test(trimmed)) {
            continue;
        }
        // 1차: 2 이상 공백 또는 탭으로 구분 (테이블 형식)
        let parts = trimmed.split(/\s{2,}|\t+/);
        // 2차: 쉼표 구분 형식 (ThreadName, Running)
        if (parts.length < 2 && trimmed.includes(',')) {
            parts = trimmed.split(/,\s*/);
        }
        if (parts.length >= 2) {
            threads.push({
                name: parts[0].trim(),
                state: normalizeThreadState(parts[1]?.trim() || ''),
                lastStatus: parts[2]?.trim() || '',
                project: parts[3]?.trim() || '',
                file: parts[4]?.trim() || '',
            });
        }
    }
    return threads;
}

/**
 * `Show Thread <threadname>` 상세 응답 파싱.
 * 예시:
 *   GPL_Code, Paused
 *   0, ""
 *   GPL_Code, MAIN, 2, Entry_Main.gpl, 6
 */
export function parseThreadDetail(text: string): ThreadDetailInfo | null {
    const dataMatch = text.match(/<DATA>([\s\S]*?)<\/DATA>/i);
    const payload = (dataMatch ? dataMatch[1] : text)
        .replace(/<STATUS>[\s\S]*?<\/STATUS>/gi, '')
        .trim();

    const lines = payload.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) {
        return null;
    }

    const headerParts = lines[0].split(/,\s*/);
    if (headerParts.length < 2) {
        return null;
    }

    let statusCode = 0;
    let statusMessage = '';
    if (lines.length >= 2) {
        const statusMatch = lines[1].match(/^(-?\d+)\s*,\s*"?(.*?)"?$/);
        if (statusMatch) {
            statusCode = parseInt(statusMatch[1], 10) || 0;
            statusMessage = statusMatch[2] || '';
        }
    }

    let project = '';
    let process = '';
    let procLine = 0;
    let file = '';
    let fileLine = 0;
    if (lines.length >= 3) {
        const locParts = lines[2].split(/,\s*/);
        if (locParts.length >= 5) {
            project = locParts[0]?.trim() || '';
            process = locParts[1]?.trim() || '';
            procLine = parseInt(locParts[2], 10) || 0;
            file = locParts[3]?.trim() || '';
            fileLine = parseInt(locParts[4], 10) || 0;
        }
    }

    return {
        name: headerParts[0].trim(),
        state: normalizeThreadState(headerParts[1]?.trim() || ''),
        statusCode,
        statusMessage,
        project,
        process,
        procLine,
        file,
        fileLine,
    };
}

function normalizeThreadState(raw: string): ThreadState {
    const s = raw.toLowerCase();
    if (s.includes('run')) { return 'Running'; }
    if (s.includes('idle')) { return 'Idle'; }
    if (s.includes('error') || s.includes('err')) { return 'Error'; }
    if (s.includes('stopp') || s.includes('stoping')) { return 'Stopping'; }
    if (s.includes('stop')) { return 'Stopped'; }
    if (s.includes('paus')) { return 'Paused'; }
    if (s.includes('break')) { return 'Break'; }
    return raw;
}

// ─── Error Log ────────────────────────────────────────────

/**
 * `ErrorLog` 응답에서 에러 메시지 목록 추출.
 * 활성 에러가 없으면 빈 배열 반환.
 */
export function parseErrorLog(text: string): string[] {
    const clean = text
        .replace(/\0/g, '')           // NUL 바이트 제거
        .replace(/<\/?DATA>/g, '')
        .replace(/<STATUS>[^<]*<\/STATUS>/g, '')
        .trim();

    if (/no\s+(active\s+)?error/i.test(clean)) {
        return [];
    }

    return clean.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
}

// ─── Project.gpr ─────────────────────────────────────────

export interface GprInfo {
    projectName: string;
    projectStart: string;
    sources: string[];
}

/**
 * Project.gpr 텍스트에서 메타 정보 추출.
 */
export function parseGpr(text: string): GprInfo {
    let projectName = '';
    let projectStart = '';
    const sources: string[] = [];

    const nameMatch = text.match(/ProjectName\s*=\s*"([^"]+)"/i);
    if (nameMatch) { projectName = nameMatch[1]; }

    const startMatch = text.match(/ProjectStart\s*=\s*"([^"]+)"/i);
    if (startMatch) { projectStart = startMatch[1]; }

    const srcRe = /ProjectSource\s*=\s*"([^"]+)"/gi;
    let m: RegExpExecArray | null;
    while ((m = srcRe.exec(text)) !== null) {
        sources.push(m[1].trim());
    }

    return { projectName, projectStart, sources };
}

// ─── Stack ────────────────────────────────────────────────

export interface StackFrameInfo {
    frameIndex: number;
    project: string;
    process: string;
    procLine: number;
    file: string;
    fileLine: number;
    size: number;
}

/**
 * `Show Stack <threadname>` 응답 파싱.
 *
 * 두 가지 형식 지원:
 * 1) 텍스트 형식: `Frame 0: Module.Method, Line 25, /flash/project/file.gpl`
 * 2) 테이블 형식: `0  Project  Process  ProcLine  File  Line  Size`
 */
export function parseStack(text: string): StackFrameInfo[] {
    const frames: StackFrameInfo[] = [];
    const cleaned = text.replace(/<\/?[A-Za-z][^>]*>/g, '');
    const lines = cleaned.split(/\r?\n/);

    // Regex for text format: Frame N: Module.Method, Line L, filepath
    const textRe = /^Frame\s+(\d+):\s*(\S+?)(?:\.(\S+))?,\s*Line\s+(\d+),?\s*(.*)$/i;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed
            || /^[-=]+$/.test(trimmed)
            || /^-?\d+\s*,\s*"[^"]*"\s*$/.test(trimmed)
            || (/Frame/i.test(trimmed) && /Project/i.test(trimmed) && /Process/i.test(trimmed))) {
            continue;
        }

        // Try text format first
        const textMatch = trimmed.match(textRe);
        if (textMatch) {
            const frameIndex = parseInt(textMatch[1], 10);
            const moduleName = textMatch[2] || '';
            const methodName = textMatch[3] || '';
            const fileLine = parseInt(textMatch[4], 10) || 0;
            const filePath = textMatch[5]?.trim() || '';
            const fileName = filePath ? filePath.replace(/^.*[\\/]/, '') : '';

            frames.push({
                frameIndex,
                project: '',
                process: methodName ? `${moduleName}.${methodName}` : moduleName,
                procLine: 0,
                file: fileName,
                fileLine,
                size: 0,
            });
            continue;
        }

        // Controller CSV format: 0, Project, Proc, ProcLine, File, Line, Size
        // or table format separated by 2+ spaces / tabs.
        let parts = trimmed.split(/\s{2,}|\t+/);
        if (parts.length < 6 && trimmed.includes(',')) {
            parts = trimmed.split(/,\s*/);
        }
        if (parts.length >= 6) {
            const frameIndex = parseInt(parts[0], 10);
            if (isNaN(frameIndex)) { continue; }

            frames.push({
                frameIndex,
                project: parts[1]?.trim() || '',
                process: parts[2]?.trim() || '',
                procLine: parseInt(parts[3], 10) || 0,
                file: parts[4]?.trim() || '',
                fileLine: parseInt(parts[5], 10) || 0,
                size: parseInt(parts[6], 10) || 0,
            });
        }
    }

    return frames;
}

// ─── Breakpoint List ─────────────────────────────────────

export interface BreakpointInfo {
    number: number;
    project: string;
    proc: string;
    procLine: number;
    file: string;
    fileLine: number;
    hitCount: number;
}

/**
 * `Show Break` 응답에서 브레이크포인트 목록 추출.
 * Brooks 형식: `number, project, proc, procLine, file, fileLine, hitCount`
 * 예: `1, My_project, Sub_test, 6, Testfile.gpl, 30, 5`
 */
export function parseBreakList(text: string): BreakpointInfo[] {
    const breakpoints: BreakpointInfo[] = [];
    const cleaned = text.replace(/<\/?[A-Za-z][^>]*>/g, '');
    const lines = cleaned.split(/\r?\n/);

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed
            || /^[-=]+$/.test(trimmed)
            || /^-?\d+\s*,\s*"[^"]*"\s*$/.test(trimmed)) {
            continue;
        }

        // 쉼표 구분 형식: number, project, proc, procLine, file, fileLine, hitCount
        const parts = trimmed.split(/,\s*/);
        if (parts.length >= 6) {
            const num = parseInt(parts[0], 10);
            if (isNaN(num)) { continue; }
            breakpoints.push({
                number: num,
                project: parts[1]?.trim() || '',
                proc: parts[2]?.trim() || '',
                procLine: parseInt(parts[3], 10) || 0,
                file: parts[4]?.trim() || '',
                fileLine: parseInt(parts[5], 10) || 0,
                hitCount: parseInt(parts[6], 10) || 0,
            });
            continue;
        }

        // 대체 형식: file.gpl:42 (레거시 호환)
        const m = trimmed.match(/([^\s:]+\.(?:gpl|gpo))\s*:\s*(\d+)/i);
        if (m) {
            breakpoints.push({
                number: 0,
                project: '',
                proc: '',
                procLine: 0,
                file: m[1],
                fileLine: parseInt(m[2], 10),
                hitCount: 0,
            });
        }
    }

    return breakpoints;
}

// ─── Variables ────────────────────────────────────────────

export interface VariableInfo {
    name: string;
    value: string;
}

/**
 * `Show Variable` / `Show Global` 응답에서 변수 목록 추출.
 * 형식: `varname = value` 또는 테이블 형식.
 */
export function parseVariable(text: string): VariableInfo[] {
    const variables: VariableInfo[] = [];
    const cleaned = text.replace(/<\/?[A-Za-z][^>]*>/g, '');
    const lines = cleaned.split(/\r?\n/);

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed
            || /^[-=]+$/.test(trimmed)
            || /^-?\d+\s*,\s*"[^"]*"\s*$/.test(trimmed)
            || /Variable\s+Name/i.test(trimmed)
            || /Global\s+Name/i.test(trimmed)) {
            continue;
        }

        // "varname = value" 형식
        const eqMatch = trimmed.match(/^(\S+)\s*=\s*(.+)$/);
        if (eqMatch) {
            variables.push({
                name: eqMatch[1].trim(),
                value: eqMatch[2].trim(),
            });
            continue;
        }

        // 테이블 형식: "varname  type  value"
        const parts = trimmed.split(/\s{2,}|\t+/);
        if (parts.length >= 2) {
            variables.push({
                name: parts[0].trim(),
                value: parts[parts.length - 1].trim(),
            });
        }
    }

    return variables;
}

// ─── Runtime Console ─────────────────────────────────────

/**
 * 포트 1403에서 수신되는 런타임 콘솔 라인 정규화.
 * `<E>ts,source<L>level</L>message</E>` → `[source] message`
 */
export function normalizeConsoleLine(line: string): string {
    const s = line.replace(/\0/g, '').replace(/\r/g, '').trim();
    if (!s || s === '</E>' || /^<E>\d+,\d+<\/E>$/.test(s)) {
        return '';
    }

    let project = '';
    const projMatch = s.match(/<E>\d+,([^<]+)<L>\d+<\/L>/);
    if (projMatch) {
        project = projMatch[1].trim();
    }

    let msg = s.replace(/^.*<L>\d+<\/L>/, '').replace(/<\/E>$/, '').trim();

    if (msg && project) {
        return `[${project}] ${msg}`;
    }
    if (msg) {
        return msg;
    }

    // Fallback: <E>ts,content</E>
    const fallback = s.match(/^<E>\d+,(.*)<\/E>$/);
    if (fallback) {
        return fallback[1].trim();
    }

    return s;
}
