/**
 * 브레이크포인트 목록(`Show Break`류) 응답 파서.
 *
 * 책임: 제어기 브레이크포인트 목록 파싱.
 * `responseParser.ts` 에서 응답 종류별로 분리했다(2026-10-27) — 함수 본문은 그대로 옮겼고,
 * 기존 import 경로는 `responseParser.ts` 배럴이 유지한다.
 */

import { stripXmlTags } from './protocolText';

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
    const cleaned = stripXmlTags(text);
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
