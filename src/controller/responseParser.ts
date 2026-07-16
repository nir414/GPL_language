/**
 * Brooks Controller 콘솔 응답 파서.
 * 모든 파싱 로직을 중앙 관리하여 펌웨어 변동에 단일 지점에서 대응한다.
 */

import * as path from 'path';

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
    // DATA 본문에 STATUS 텍스트가 포함될 수 있으므로(파일/로그 덤프 응답),
    // 실제 종결 STATUS인 "마지막" 블록을 채택한다.
    const re = /<STATUS>\s*(-?\d+)(?:,\s*"([^"]*)")?/g;
    let m: RegExpExecArray | null;
    let last: RegExpExecArray | null = null;
    while ((m = re.exec(response)) !== null) { last = m; }
    if (last) {
        return { code: parseInt(last[1], 10), message: last[2] || '', raw: response };
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
    // 제어기 응답은 줄바꿈(`\n`) 또는 ` | ` 로 항목이 구분될 수 있으므로,
    // 메시지는 다음 구분자(파이프/줄바꿈/문자열 끝) 직전까지만 비탐욕적으로 캡처한다.
    // (이전 정규식의 탐욕적 `(.+)`는 한 줄로 합쳐진 응답에서 첫 에러가 나머지를 모두 삼켰다.)
    const regex = /(?:\[CONSOLE\]\s*)?([^\s:|]+\.(?:gpl|gpr|gpo)):(\d+):\((-?\d+)\):\s*(.+?)(?=\s*\||[\r\n]|$)/gi;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
        const code = parseInt(m[3], 10);
        const message = m[4].trim();
        // 컴파일러가 마지막에 남기는 집계 줄(`*Compilation errors*: N`)은
        // 실제 에러 위치가 아니라 총계이므로 진단에서 제외한다.
        if (code === -742 && /Compilation errors/i.test(message)) {
            continue;
        }
        errors.push({
            file: m[1],
            line: parseInt(m[2], 10),
            code,
            message,
        });
    }
    return errors;
}

// ─── Threads ──────────────────────────────────────────────

/**
 * 스레드 "목록" 열거용 콘솔 명령.
 *
 * GDE/PEdit 패킷 캡처(1402) 기준으로, 인자 없는 `Show Thread`는 스레드가
 * 실행 중이어도 `<DATA></DATA>` 빈 응답을 돌려준다. 전체 스레드를 열거하려면
 * GDE처럼 `-web` 플래그를 써야 하며, 응답은 파이프(`|`) 구분 9컬럼 형식이다.
 *
 * 두 칸 공백은 의도된 것: `Show Thread [name] [-stack] [-web]` 문법에서 name 슬롯을
 * 비우고 플래그만 전달하는, GDE가 실제로 전송한 형태를 그대로 따른다.
 *
 * 고빈도 폴(디버그 세션·상태 프로브)은 이 경량형을 쓴다. timing이 필요한 저빈도/
 * 상세 경로는 아래 SHOW_THREAD_LIST_STACK_CMD를 사용한다(폴 페이로드 경량 유지).
 */
export const SHOW_THREAD_LIST_CMD = 'Show Thread  -web';

/**
 * 상세형: `Show Thread` 목록 + thread별 trailing 수치(`-stack`, index 9+).
 * parseThreadList가 stackTiming으로 보존한다. 페이로드가 커지므로 고빈도 폴에는 쓰지
 * 말고, 사이드바 수동 새로고침 등 on-demand 상세 조회에만 사용한다. read-only 진단.
 */
export const SHOW_THREAD_LIST_STACK_CMD = 'Show Thread  -stack -web';

export type ThreadState = 'Running' | 'Idle' | 'Error' | 'Stopping' | 'Stopped' | 'Break' | 'Paused' | string;

export interface ThreadInfo {
    name: string;
    state: ThreadState;
    lastStatus: string;
    project: string;
    file: string;
    // `Show Thread -web`(파이프 형식)에서만 채워지는 정밀 위치 정보.
    // 공백/콤마 형식에서는 undefined.
    func?: string;
    procLine?: number;
    fileLine?: number;
    // `-stack`을 동반한 `-web` 응답에서만 채워지는 trailing 수치 컬럼(index 9+).
    // 컬럼 의미는 Brooks 도움말에서 확인되지 않아 단정하지 않고 raw 숫자로 보존한다.
    stackTiming?: number[];
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
 *   - 파이프 구분(`Show Thread -web`, GDE 폴링 형식, 9컬럼):
 *       `name| state| code| "msg"| project| func| procLine| file| fileLine`
 *       예) `Test_robot| Paused| 0| ""| Test_robot| MAIN| 2| Entry_Main.gpl| 22`
 *   - 탭/2+공백 구분: `ThreadName    Running    0    proj    file`
 *   - 쉼표 구분:      `ThreadName, Running`
 */
/**
 * 파이프 행 끝의 trailing 수치 컬럼(`-stack` 동반 시 index 9+)을 raw 숫자로 수집.
 * 숫자가 아니면 무시하고, 하나도 없으면 undefined.
 */
function parseTrailingNumbers(parts: string[], from: number): number[] | undefined {
    const out: number[] = [];
    for (let i = from; i < parts.length; i++) {
        const cell = (parts[i] ?? '').trim();
        const n = Number.parseFloat(cell);
        if (!Number.isNaN(n) && /^-?\d*\.?\d+$/.test(cell)) {
            out.push(n);
        }
    }
    return out.length ? out : undefined;
}

/**
 * 모든 셀이 순수 숫자인 행 판별. `Show Thread -stack`(비-web)의 timing 줄
 * (예: `0.172, 4.000, 0.172`)이 스레드로 오인식되어 phantom 항목을 만드는 것을 막는다.
 */
function isPureNumericRow(line: string): boolean {
    const cells = line.split(/[,|]|\s{2,}|\t+/).map(s => s.trim()).filter(Boolean);
    return cells.length >= 2 && cells.every(c => /^-?\d*\.?\d+$/.test(c));
}

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
        // 0차: 파이프(`|`) 구분 — `Show Thread -web` 형식. 컬럼 매핑이 다르므로 우선 처리.
        if (trimmed.includes('|')) {
            const p = trimmed.split('|').map(s => s.trim());
            if (p.length >= 2) {
                const procLine = Number.parseInt(p[6] ?? '', 10);
                const fileLine = Number.parseInt(p[8] ?? '', 10);
                threads.push({
                    name: p[0],
                    state: normalizeThreadState(p[1] || ''),
                    lastStatus: p[2] || '',
                    project: p[4] || '',
                    file: p[7] || '',
                    func: p[5] || undefined,
                    procLine: Number.isNaN(procLine) ? undefined : procLine,
                    fileLine: Number.isNaN(fileLine) ? undefined : fileLine,
                    stackTiming: parseTrailingNumbers(p, 9),
                });
            }
            continue;
        }
        // (-stack 비-web 응답의) 순수 수치 타이밍 행은 스레드가 아니므로 스킵.
        // 예: `0.172, 4.000, 0.172` → name="0.172" 오인식 방지.
        if (isPureNumericRow(trimmed)) {
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
    // 'stopped'를 'stopp' 포함 검사보다 먼저 확인한다 — 종전에는 "Stopped"가 'Stopping'으로
    // 정규화되어 정지 완료 스레드가 "아직 정지 중"으로 오판됐다(정지 검증/게이트 오동작 원인).
    if (s.includes('stopped')) { return 'Stopped'; }
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

// ─── Error Log Classification ──────────────────────────────

export interface ControllerErrorEntry {
    timestamp: string;
    source: string;
    code: number;
    message: string;
}

/**
 * ErrorLog 한 줄을 구조 파싱한다.
 * 형식: `MM-DD-YYYY HH:MM:SS.mmm, Source, code, "message"`
 */
export function parseControllerErrorEntry(entry: string): ControllerErrorEntry | null {
    const m = entry.match(/^(\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}:\d{2}\.\d{3}),\s*([^,]+),\s*(-?\d+),\s*"?([^"]*)"?$/);
    if (!m) { return null; }
    return {
        timestamp: m[1],
        source: m[2].trim(),
        code: Number(m[3]),
        message: m[4].trim(),
    };
}

/**
 * 알려진 제어기 시스템 에러 코드.
 * 이 코드들은 GPL 코드 동작과 무관하며 /flash/config 또는 하드웨어 환경 문제다.
 * 출처: Brooks Automation GDE ErrorCode 문서.
 */
const CONTROLLER_SYSTEM_ERROR_CODES: Record<number, string> = {
    [-1521]: 'controller /flash/config *.pac 파일 형식/로드 문제',
    [-1520]: 'controller /flash/config parameter DB 파일 누락 또는 열기 실패',
    [-1519]: 'parameter DB 초기화 실패',
    [-1518]: 'parameter DB 버전 불일치',
};

const CONTROLLER_NON_BLOCKING_STATUS_CODES = new Set<number>([-1521, -1520, -1519, -1518]);

export type ErrorCodeCategory = 'environment' | 'code' | 'unknown';

export interface ErrorCodeHint {
    code: number;
    title: string;
    meaning: string;
    action: string;
    category: ErrorCodeCategory;
}

const ERROR_CODE_HINTS: Record<number, Omit<ErrorCodeHint, 'code'>> = {
    [-1521]: {
        title: 'Controller 환경 이슈',
        meaning: 'Invalid parameter DB file not loaded (/flash/config *.pac 로드/형식 문제)',
        action: 'GPL 코드 수정보다 제어기 환경(파라미터 DB/펌웨어/파일) 진단을 먼저 수행',
        category: 'environment',
    },
    [-1520]: {
        title: 'Controller 환경 이슈',
        meaning: 'Parameter DB 파일 누락 또는 열기 실패',
        action: '/flash/config DB 파일 존재·권한·무결성 확인 후 재시도',
        category: 'environment',
    },
    [-1519]: {
        title: 'Controller 환경 이슈',
        meaning: 'Parameter DB 초기화 실패',
        action: '제어기 초기화 상태/버전 정합성/스토리지 상태를 점검',
        category: 'environment',
    },
    [-1518]: {
        title: 'Controller 환경 이슈',
        meaning: 'Parameter DB 버전 불일치',
        action: '컨트롤러/DB 버전 매칭 및 배포 환경 정합성 확인',
        category: 'environment',
    },
    [-782]: {
        title: 'Object value is Nothing',
        meaning: '객체/참조값 초기화 누락 가능성이 큼',
        action: '사용 전 객체 생성/할당 여부, null 경로, 조건 분기 초기화 점검',
        category: 'code',
    },
    [-508]: {
        title: 'File not found',
        meaning: '파일/프로젝트 경로를 찾지 못함',
        action: '경로, FTP 디렉터리 존재, 파일명 대소문자/오탈자, 권한을 확인',
        category: 'code',
    },
    [-2]: {
        title: 'Command/Runtime failure',
        meaning: '선행 실패의 연쇄로 발생할 수 있는 일반 실패 코드',
        action: '직전 에러(예: -782, -508)부터 역추적해 원인 제거',
        category: 'code',
    },
};

const KNOWN_ERROR_CHAINS: number[][] = [
    [-782, -508, -2],
    [-782, -2],
    [-508, -2],
];

export function isControllerNonBlockingStatus(code: number): boolean {
    return CONTROLLER_NON_BLOCKING_STATUS_CODES.has(code);
}

export function getErrorCodeHint(code: number): ErrorCodeHint | undefined {
    const hint = ERROR_CODE_HINTS[code];
    if (!hint) { return undefined; }
    return { code, ...hint };
}

export function extractErrorCodeFromEntry(entry: string): number | undefined {
    const parsed = parseControllerErrorEntry(entry);
    if (parsed) {
        return parsed.code;
    }

    const statusMatch = entry.match(/STATUS\s*(-?\d+)/i);
    if (statusMatch) {
        return Number(statusMatch[1]);
    }

    const parenMatch = entry.match(/\((-?\d+)\)/);
    if (parenMatch) {
        return Number(parenMatch[1]);
    }

    const rawCode = entry.match(/(^|[^\d-])(-\d{1,5})(?=[^\d]|$)/);
    if (rawCode) {
        return Number(rawCode[2]);
    }

    return undefined;
}

export function findKnownErrorChains(codes: number[]): string[] {
    if (codes.length < 2) { return []; }

    const found: string[] = [];
    for (const chain of KNOWN_ERROR_CHAINS) {
        let idx = 0;
        for (const code of codes) {
            if (code === chain[idx]) {
                idx++;
                if (idx === chain.length) {
                    found.push(chain.join(' → '));
                    break;
                }
            }
        }
    }
    return found;
}

export interface ErrorEntryClassification {
    /** true = 제어기 환경·시스템 문제 (GPL 코드와 무관) */
    isControllerSystem: boolean;
    summary: string;
    detail?: string;
    parsedCode?: number;
}

/**
 * ErrorLog 항목을 제어기 시스템 에러 / 기타로 분류한다.
 *
 * - 알려진 시스템 코드(-1521 등): isControllerSystem = true, detail 포함
 * - timestamp+source+code 형식 전반: isControllerSystem = true (제어기 누적 로그)
 * - 구조 없는 raw 텍스트: isControllerSystem = false (코드 관련 가능성)
 */
export function classifyErrorEntry(entry: string): ErrorEntryClassification {
    const parsed = parseControllerErrorEntry(entry);
    if (!parsed) {
        const normalized = entry.replace(/\s+/g, ' ').trim();
        return {
            isControllerSystem: false,
            summary: normalized.length > 140 ? `${normalized.slice(0, 137)}...` : normalized,
        };
    }

    const knownDetail = CONTROLLER_SYSTEM_ERROR_CODES[parsed.code];
    if (knownDetail) {
        return {
            isControllerSystem: true,
            summary: `${parsed.source} (${parsed.code}): ${parsed.message}`,
            detail: `${knownDetail} — GPL 코드 오류로 분류하지 않음`,
            parsedCode: parsed.code,
        };
    }

    const hint = getErrorCodeHint(parsed.code);
    if (hint && hint.category === 'code') {
        return {
            isControllerSystem: false,
            summary: `${parsed.source} (${parsed.code}): ${parsed.message}`,
            detail: `${hint.title} — ${hint.meaning}. 권장: ${hint.action}`,
            parsedCode: parsed.code,
        };
    }

    return {
        isControllerSystem: true,
        summary: `${parsed.source} (${parsed.code}): ${parsed.message}`,
        detail: '제어기 ErrorLog 항목. 현재 실행 결과와 과거 누적 항목을 분리 확인 필요.',
        parsedCode: parsed.code,
    };
}


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

// ─── Project 선택 (디버그 대상 projectName 결정) ─────────────

/** 워크스페이스에서 수집한 Project.gpr 후보 하나. */
export interface ProjectCandidate {
    /** .gpr의 ProjectName */
    projectName: string;
    /** Project.gpr 절대 경로 */
    gprPath: string;
    /** ProjectSource 파일들의 소문자 basename 집합 */
    sourceNames: Set<string>;
}

/** selectProjectFromCandidates 결과. */
export interface ProjectSelection {
    projectName: string;
    /** 로그용 선택 근거 */
    reason: string;
    /**
     * true면 결정적이지만 임의적인 tie-break로 골랐다는 뜻(활성 파일 신호 없음 등).
     * 이 경우 launch.json에 projectName을 명시하도록 사용자에게 안내한다.
     */
    ambiguous: boolean;
}

/** filePath가 dirPath 하위(또는 동일)인지 판정. 순수 path 연산. */
function isPathUnder(filePath: string, dirPath: string): boolean {
    try {
        const rel = path.relative(path.resolve(dirPath), path.resolve(filePath));
        return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    } catch {
        return false;
    }
}

/**
 * 여러 Project.gpr 후보 중 디버그 대상 프로젝트를 결정한다(순수 함수, 단위 테스트 대상).
 *
 * 배경: 기존 로직은 활성 파일의 **basename이 어느 프로젝트의 소스 목록에 있는지**(약한 신호)를
 * **파일이 실제로 어느 프로젝트 폴더 안에 있는지**(강한 신호)보다 우선했다. 서로 다른 프로젝트가
 * `Main.gpl` 같은 흔한 파일명을 공유하면, 실제로 열려 있는 프로젝트가 아니라 이름만 겹치는
 * 다른 프로젝트가 선택되어 `<projectName>`이 오인식되었다. 여기서는 우선순위를 다음으로 바로잡는다.
 *
 *   1) 활성 파일이 어떤 프로젝트 폴더 하위이면서 그 프로젝트 소스이기도 함 (가장 강함)
 *   2) 활성 파일이 물리적으로 포함된 프로젝트 폴더 (가장 깊은/구체적인 것 우선)
 *   3) 폴더 밖에서 연 파일이 정확히 한 프로젝트의 소스명과만 일치
 *   4) 위로 판별 불가 → 결정적 fallback(경로 정렬 첫 후보)이되 ambiguous=true로 표시
 *
 * 또한 stale 사본/중첩 루트로 인한 중복 .gpr는 경로 기준으로 제거하고, 남은 후보가 모두 같은
 * projectName이면 다중이 아니라 단일로 취급한다.
 */
export function selectProjectFromCandidates(
    candidates: ProjectCandidate[],
    activePath: string,
): ProjectSelection | undefined {
    // 동일 .gpr 경로 중복 제거(대소문자 무시). stale 사본·중첩 워크스페이스 대응.
    const seen = new Set<string>();
    const unique: ProjectCandidate[] = [];
    for (const c of candidates) {
        if (!c.projectName) { continue; }
        const key = path.resolve(c.gprPath).toLowerCase();
        if (seen.has(key)) { continue; }
        seen.add(key);
        unique.push(c);
    }

    if (unique.length === 0) { return undefined; }

    // 남은 후보가 모두 같은 프로젝트명이면 .gpr가 여러 개라도 단일 프로젝트로 확정.
    const distinctNames = new Set(unique.map(c => c.projectName.toLowerCase()));
    if (distinctNames.size === 1) {
        return {
            projectName: unique[0].projectName,
            reason: unique.length === 1
                ? `단일 프로젝트 (${unique[0].gprPath})`
                : `단일 프로젝트명 (.gpr ${unique.length}개, 동일 이름)`,
            ambiguous: false,
        };
    }

    // 서로 다른 다중 프로젝트 — 활성 편집 파일로 판별.
    const activeBase = activePath ? path.basename(activePath).toLowerCase() : '';

    const dirMatches = activePath
        ? unique
            .filter(c => isPathUnder(activePath, path.dirname(c.gprPath)))
            .sort((a, b) => path.dirname(b.gprPath).length - path.dirname(a.gprPath).length)
        : [];
    const sourceMatches = activeBase
        ? unique.filter(c => c.sourceNames.has(activeBase))
        : [];

    // 1) 가장 강함: 활성 파일이 프로젝트 폴더 하위이면서 그 프로젝트의 소스이기도 함.
    const bothMatch = dirMatches.find(d => sourceMatches.some(s => s.gprPath === d.gprPath));
    if (bothMatch) {
        return {
            projectName: bothMatch.projectName,
            reason: `활성 파일 위치+소스 일치 (${activeBase})`,
            ambiguous: false,
        };
    }

    // 2) 파일이 물리적으로 들어 있는 폴더가 진실. 중첩 시 가장 깊은(구체적인) 것 우선.
    if (dirMatches.length > 0) {
        return {
            projectName: dirMatches[0].projectName,
            reason: `활성 파일 디렉터리 포함 (${path.basename(path.dirname(dirMatches[0].gprPath))})`,
            ambiguous: false,
        };
    }

    // 3) 어느 프로젝트 폴더 밖에서 연 파일 → 소스명이 정확히 하나와만 일치하면 그것.
    if (sourceMatches.length === 1) {
        return {
            projectName: sourceMatches[0].projectName,
            reason: `활성 파일명 소스 매칭 (${activeBase})`,
            ambiguous: false,
        };
    }
    if (sourceMatches.length > 1) {
        const pick = [...sourceMatches].sort((a, b) => a.gprPath.localeCompare(b.gprPath))[0];
        return {
            projectName: pick.projectName,
            reason: `활성 파일명이 ${sourceMatches.length}개 프로젝트에 존재 — 모호, 기본값 ${pick.projectName}`,
            ambiguous: true,
        };
    }

    // 4) 판별 신호 없음: 결정적 fallback(경로 정렬 첫 후보), ambiguous 표시.
    const pick = [...unique].sort((a, b) => a.gprPath.localeCompare(b.gprPath))[0];
    return {
        projectName: pick.projectName,
        reason: `다중 프로젝트(${unique.length}개), 활성 파일 신호 없음 — 기본값 ${pick.projectName}`,
        ambiguous: true,
    };
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

            // File 컬럼이 전체 경로로 올 수 있으므로 베이스네임으로 정규화한다.
            // (텍스트 형식 분기와 동일하게 처리하여 소스 위치 해석 실패를 방지)
            const rawFile = parts[4]?.trim() || '';
            const fileName = rawFile ? rawFile.replace(/^.*[\\/]/, '') : '';

            frames.push({
                frameIndex,
                project: parts[1]?.trim() || '',
                process: parts[2]?.trim() || '',
                procLine: parseInt(parts[3], 10) || 0,
                file: fileName,
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
 * `<E>type,source<L>len</L>message</E>` → `[source] message`
 *
 * 실측(1403 캡처) 메모:
 *  - 프레임 구분자는 `</E>` + `\n` + NUL(`\x00`).
 *  - `<L>N</L>`의 N은 로그 레벨이 아니라 **메시지 청크의 바이트 길이**다.
 *  - 긴 줄은 128바이트 단위로 여러 프레임에 쪼개져 오며, 마지막 청크만 `\n`으로 끝난다.
 *    (청크 재조립은 RuntimeConsole.emitConsoleFrame에서 수행하고, 여기서는 단일 프레임만 정규화한다.)
 *  - `<E>1,N</E>`(숫자 상태 이벤트)는 로그가 아니므로 빈 문자열로 억제한다.
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
