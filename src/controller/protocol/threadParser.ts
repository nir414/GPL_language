/**
 * `Show Thread` 응답 파서와 명령 상수.
 *
 * 책임: 스레드 목록/상세 파싱, 상태 정규화, `SHOW_THREAD_LIST_CMD`·`SHOW_THREAD_LIST_STACK_CMD`.
 * `responseParser.ts` 에서 응답 종류별로 분리했다(2026-10-27) — 함수 본문은 그대로 옮겼고,
 * 기존 import 경로는 `responseParser.ts` 배럴이 유지한다.
 */

import { stripXmlTags } from './protocolText';

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
export function parseThreadList(text: string): ThreadInfo[] {
    const threads: ThreadInfo[] = [];
    // XML 태그를 먼저 제거하여 <DATA>content</DATA> 같은 인라인 형식도 처리
    const cleaned = stripXmlTags(text);
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
