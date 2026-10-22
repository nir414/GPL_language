/**
 * Debug Console 입력을 한 줄씩 실행할 수 있는 단위로 나눈다.
 *
 * 판단과 표시를 DAP/vscode 접착 코드에서 떼어 두어, 여러 줄 붙여넣기 동작을
 * 제어기 없이 회귀 테스트할 수 있게 한다.
 */

import { classifyConsoleCommand } from '../controller/consoleCommandClassifier';

export interface ReplInputEntry {
    /** 사용자가 입력한 한 줄(앞뒤 공백 제거). */
    source: string;
    /** `>` 강제 전송 접두사를 제거한 평가식 또는 제어기 명령. */
    expression: string;
    forceRaw: boolean;
}

export interface ReplBatchResult {
    entry: ReplInputEntry;
    result: string;
}

/** 빈 줄을 제외하고 CRLF/LF 입력을 원래 순서대로 분리한다. */
export function parseReplInput(input: string): ReplInputEntry[] {
    return input
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(source => {
            const forceRaw = source.startsWith('>');
            return {
                source,
                expression: forceRaw ? source.slice(1).trim() : source,
                forceRaw,
            };
        });
}

/**
 * 비접두사 입력을 안전 정책으로 막았음을 먼저 밝힌다.
 * 알려진 상태 변경 명령은 변수 실패처럼 보이지 않게 명령 종류도 함께 알린다.
 */
export function formatBlockedReplInput(command: string, evaluationFailure?: string): string {
    const classification = classifyConsoleCommand(command);
    if (classification.impact === 'state-changing' || classification.impact === 'destructive') {
        const impact = classification.impact === 'destructive' ? '파괴적' : '상태 변경';
        const commandName = command.match(/^[A-Za-z]+/)?.[0] ?? classification.commandName;
        return [
            `이 입력을 제어기 명령으로 보내지 않았습니다 — '${commandName}'는 ${impact} 명령으로 인식했습니다.`,
            `전송하려면 '>${command}'처럼 '>' 접두사를 사용하세요.`,
        ].join('\n');
    }

    return [
        evaluationFailure || '변수 평가 실패.',
        "이 입력을 제어기 명령으로 보내지 않았습니다. 임의 명령으로 전송하려면 '>' 접두사를 사용하세요.",
    ].join('\n');
}

/** 여러 줄 실행 결과를 입력별 블록으로 구분해 Debug Console에 돌려준다. */
export function formatReplBatchResults(results: ReplBatchResult[]): string {
    return results.map(({ entry, result }) => {
        const label = entry.forceRaw ? `> ${entry.expression}` : entry.expression;
        const body = (result || '(평가 불가)')
            .split(/\r?\n/)
            .map(line => `  ${line}`)
            .join('\n');
        return `${label}\n${body}`;
    }).join('\n\n');
}
