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

export type ThreadState = 'Running' | 'Idle' | 'Error' | 'Stopped' | 'Break' | string;

export interface ThreadInfo {
    name: string;
    state: ThreadState;
    lastStatus: string;
    project: string;
    file: string;
}

/**
 * `Show Thread` 응답 파싱.
 * 펌웨어마다 컬럼 구분자/갯수가 다를 수 있으므로 유연하게 처리한다.
 */
export function parseThreadList(text: string): ThreadInfo[] {
    const threads: ThreadInfo[] = [];
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed
            || trimmed.includes('<STATUS>') || trimmed.includes('</STATUS>')
            || trimmed.includes('<DATA>') || trimmed.includes('</DATA>')
            || /^[-=]+$/.test(trimmed)
            || /Thread\s*Name/i.test(trimmed)) {
            continue;
        }
        // 2 이상 공백 또는 탭으로 구분
        const parts = trimmed.split(/\s{2,}|\t+/);
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

function normalizeThreadState(raw: string): ThreadState {
    const s = raw.toLowerCase();
    if (s.includes('run')) { return 'Running'; }
    if (s.includes('idle')) { return 'Idle'; }
    if (s.includes('error') || s.includes('err')) { return 'Error'; }
    if (s.includes('stop')) { return 'Stopped'; }
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
