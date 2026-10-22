import { GPLParser } from './gplParser';
import { matchProcedureHeaderKind } from './cursorExpression';

/** GPL 4.2K5 사용자 실기 관측에 따른 호환성 안내. 컴파일러 원인은 미확정이다. */
export const TRY_CATCH_COMPATIBILITY_NOTE =
    'GPL 4.2K5 실측: 잡히지 않은 예외로 스레드가 Error 상태에 멈춘 뒤 Continue하면 Finally가 다시 실행될 수 있습니다. Catch에서 재던져도 같습니다. 스레드 진입점에서 예외를 처리하고, 종료가 목적이면 Stop을 사용하세요.';

export interface TryCatchFinding {
    /** Try 키워드의 물리 줄·열(0 기준). */
    line: number;
    start: number;
    end: number;
    code: 'try-without-catch';
    message: string;
}

interface TryBlock {
    line: number;
    start: number;
    hasCatch: boolean;
    reported: boolean;
}

/**
 * Catch가 없는 Try를 찾는다. 입력 중인 Try는 Finally 또는 End Try를 만날 때 경고한다.
 * 주석·문자열·줄 연속 판정은 기존 파서를 사용하고, 중첩 Try는 각자 Catch를 추적한다.
 */
export function findTryCatchFindings(content: string): TryCatchFinding[] {
    const findings: TryCatchFinding[] = [];
    const stack: TryBlock[] = [];
    // 병합 전에 주석을 제거해야 `_ ' 주석` 뒤의 다음 줄도 코드로 읽힌다.
    const lines = content.split('\n').map(line => GPLParser.stripToCode(line));

    const report = (block: TryBlock): void => {
        if (block.hasCatch || block.reported) { return; }
        block.reported = true;
        findings.push({
            line: block.line,
            start: block.start,
            end: block.start + 3,
            code: 'try-without-catch',
            message: TRY_CATCH_COMPATIBILITY_NOTE,
        });
    };

    for (const { text, line } of GPLParser.buildLogicalLines(lines)) {
        const code = text.trim();
        // 미완성 Try가 다음 프로시저의 Catch/End Try에 연결되지 않게 한다.
        if (matchProcedureHeaderKind(code)
            || /^End\s+(?:Sub|Function|Property|Get|Set|Module|Class)\b/i.test(code)) {
            stack.length = 0;
        } else if (/^Try\s*$/i.test(code)) {
            stack.push({ line, start: text.search(/\S/), hasCatch: false, reported: false });
        } else if (/^End\s+Try\s*$/i.test(code)) {
            const block = stack.pop();
            if (block) { report(block); }
        } else if (/^Catch\b/i.test(code)) {
            const block = stack[stack.length - 1];
            if (block) { block.hasCatch = true; }
        } else if (/^Finally\s*$/i.test(code)) {
            const block = stack[stack.length - 1];
            if (block) { report(block); }
        }
    }

    return findings.sort((a, b) => a.line - b.line);
}
