/**
 * 변수 조회 응답 파서.
 *
 * 책임: 변수 이름/값 목록 파싱.
 * `responseParser.ts` 에서 응답 종류별로 분리했다(2026-10-27) — 함수 본문은 그대로 옮겼고,
 * 기존 import 경로는 `responseParser.ts` 배럴이 유지한다.
 */

import { stripXmlTags } from './protocolText';

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
    const cleaned = stripXmlTags(text);
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
