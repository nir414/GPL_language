/**
 * Compile 응답의 에러 목록 파서.
 *
 * 책임: `[CONSOLE] file.gpl:42:(-100): message` 형식에서 `CompileError[]` 추출.
 * `responseParser.ts` 에서 응답 종류별로 분리했다(2026-10-27) — 함수 본문은 그대로 옮겼고,
 * 기존 import 경로는 `responseParser.ts` 배럴이 유지한다.
 */

export interface CompileError {
    file: string;
    line: number;
    code: number;
    message: string;
    /**
     * 그 줄의 소스를 보고 붙인 원인 안내(있을 때만) — `controller/deployment/compileErrorHints`.
     * Problems 진단 문구와 자동화 결과(compileErrors)가 같은 값을 쓴다.
     */
    hint?: string;
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
    // `<DATA>`가 첫 에러와 같은 줄에 붙어도 태그를 파일명의 일부로 삼지 않는다.
    const regex = /(?:\[CONSOLE\]\s*)?([^\s:|<>]+\.(?:gpl|gpr|gpo)):(\d+):\((-?\d+)\):\s*(.+?)(?=\s*\||[\r\n]|<\/?DATA>|<STATUS>|$)/gi;
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
