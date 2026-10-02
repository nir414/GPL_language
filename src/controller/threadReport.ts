/**
 * 쓰레드 목록 보고서 렌더링 — vscode 무의존 순수 모듈.
 *
 * 패널의 「전체 쓰레드 복사」와 상황 스냅샷(`## 쓰레드`)이 **같은 표**를 쓴다. 오류 보고서에서 겪은 것과
 * 같은 취지다(§1-EA) — 보이는 것과 복사되는 것이 갈라지면 붙여넣은 쪽에서 재료가 조용히 사라진다.
 *
 * 재료 수집(1402 `Show Thread -web -stack`)은 접착 계층이 하고, 여기는 **모은 사실을 옮겨 그리기만** 한다.
 * 없는 값은 `-` 로 적고 지어내지 않는다(하드 규칙 3).
 */

import type { ThreadInfo } from './responseParser';

/** 상태별 쓰레드 수 — 트리 루트 설명·상황 스냅샷·복사 보고서가 공유한다. */
export interface ThreadStateCounts {
    running: number;
    /** `Paused` 와 `Break` 를 함께 센다(둘 다 정지 상태다). */
    paused: number;
    idle: number;
    errCount: number;
}

export interface ThreadReportInput {
    threads: readonly ThreadInfo[];
    connected: boolean;
    /** `192.168.0.1:1402` 표기(없으면 줄을 생략한다). */
    endpoint?: string;
    /** 확장이 기대하는 프로젝트 이름(없으면 `(미설정)`). */
    expectedProject?: string;
    extensionVersion?: string;
    /** 보고서 생성 시각(ms). 테스트용 주입. */
    now?: number;
    /** 테스트용 시각 포맷터. */
    formatTime?: (ms: number) => string;
}

const EMPTY = '-';

export function countThreadStates(threads: readonly ThreadInfo[]): ThreadStateCounts {
    return {
        running: threads.filter(t => t.state === 'Running').length,
        paused: threads.filter(t => t.state === 'Paused' || t.state === 'Break').length,
        idle: threads.filter(t => t.state === 'Idle').length,
        errCount: threads.filter(t => t.state === 'Error').length,
    };
}

/** `전체 5: Running 1, Paused 0, Idle 3, Error 1` — 표 위에 붙는 한 줄 요약. */
export function summarizeThreadStates(threads: readonly ThreadInfo[]): string {
    const { running, paused, idle, errCount } = countThreadStates(threads);
    return `전체 ${threads.length}: Running ${running}, Paused ${paused}, Idle ${idle}, Error ${errCount}`;
}

/** `file:line` — 줄 번호가 없으면 파일 이름만, 파일도 없으면 `-`. */
function formatLocation(t: ThreadInfo): string {
    if (!t.file) { return EMPTY; }
    return typeof t.fileLine === 'number' ? `${t.file}:${t.fileLine}` : t.file;
}

/** `Proc:12` — `-web` 응답에서만 채워지는 값이라 없을 수 있다. */
function formatProcedure(t: ThreadInfo): string {
    if (!t.func) { return EMPTY; }
    return typeof t.procLine === 'number' ? `${t.func}:${t.procLine}` : t.func;
}

/** 마크다운 셀 안에서 표를 깨뜨리는 `|` 만 막는다(값 자체는 원문 유지). */
function cell(value: string | undefined): string {
    const text = (value ?? '').trim();
    return text.length === 0 ? EMPTY : text.replace(/\|/g, '\\|');
}

/**
 * 쓰레드 표(헤더 + 행). 쓰레드가 없으면 빈 배열을 돌려주므로 호출부가 "없음" 문구를 고를 수 있다.
 * Timing 컬럼은 `Show Thread -stack` 의 trailing 수치로, 컬럼 의미가 Brooks 도움말에서 확인되지
 * 않아 raw 표기 그대로 싣는다(하드 규칙 3 — 모르는 것을 해석해 적지 않는다).
 */
export function renderThreadTable(threads: readonly ThreadInfo[]): string[] {
    if (threads.length === 0) { return []; }
    const lines = [
        '| 이름 | 상태 | STATUS | 프로젝트 | 위치 | 프로시저 | Timing(-stack) |',
        '|------|------|--------|----------|------|----------|----------------|',
    ];
    for (const t of threads) {
        lines.push([
            '',
            cell(t.name),
            cell(t.state),
            cell(t.lastStatus),
            cell(t.project),
            cell(formatLocation(t)),
            cell(formatProcedure(t)),
            cell(t.stackTiming?.join(' / ')),
            '',
        ].join(' | ').trim());
    }
    return lines;
}

function defaultStamp(ms: number): string {
    return new Date(ms).toLocaleString('ko-KR');
}

/** 「전체 쓰레드 복사」가 클립보드에 넣는 보고서 전문. */
export function renderThreadListReport(input: ThreadReportInput): string {
    const stamp = (input.formatTime ?? defaultStamp)(input.now ?? Date.now());
    const lines: string[] = [];

    lines.push('# GPL 쓰레드 목록');
    lines.push('');
    lines.push(`- 시각: ${stamp}`);
    lines.push(`- 연결: ${input.connected ? 'Connected' : 'Disconnected'}${input.endpoint ? ` (${input.endpoint})` : ''}`);
    lines.push(`- 기대 프로젝트: ${input.expectedProject?.trim() || '(미설정)'}`);
    if (input.extensionVersion) {
        lines.push(`- 확장 버전: ${input.extensionVersion}`);
    }
    lines.push(`- ${summarizeThreadStates(input.threads)}`);
    lines.push('');

    const table = renderThreadTable(input.threads);
    if (table.length === 0) {
        lines.push(input.connected
            ? '쓰레드 없음 — 제어기에 로드된 실행 쓰레드가 없습니다.'
            : '쓰레드 없음 — 제어기에 연결돼 있지 않아 목록이 비어 있습니다.');
    } else {
        lines.push(...table);
    }
    lines.push('');

    return lines.join('\n');
}
