/**
 * `Show Stack` 응답 파서.
 *
 * 책임: 텍스트/테이블 두 형식의 스택 프레임 파싱.
 * `responseParser.ts` 에서 응답 종류별로 분리했다(2026-10-27) — 함수 본문은 그대로 옮겼고,
 * 기존 import 경로는 `responseParser.ts` 배럴이 유지한다.
 */

import { stripXmlTags } from './protocolText';

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
    const cleaned = stripXmlTags(text);
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
