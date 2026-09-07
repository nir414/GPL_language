/**
 * `Step` 명령 조립 — vscode 무의존(순수). startCommand.ts 와 같은 역할(문서 구문 단일 출처).
 *
 * GDE 캡처 실측: step over = `Step <thread> -over -noerror`, step into = `Step <thread> -noerror`(-into 플래그 없음).
 * step out = `Step <thread> -out -noerror` 는 Brooks 문서상 스위치 — 실기기 미검증.
 * 트리 인라인 스텝·AI API(`gpl.ai.debug.stepThread`/`loop`)가 같은 문자열을 쓴다.
 */
export type StepMode = 'into' | 'over' | 'out';

export function buildStepCommand(threadName: string, mode: StepMode): string {
    if (mode === 'over') { return `Step ${threadName} -over -noerror`; }
    if (mode === 'out') { return `Step ${threadName} -out -noerror`; }
    return `Step ${threadName} -noerror`;
}
