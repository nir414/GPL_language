/**
 * 1402 응답 본문을 GPL Traffic 채널에 "줄 단위·실시간"으로 흘려보내기 위한 순수 헬퍼 (vscode 의존 없음).
 *
 * - 소켓 chunk 경계는 줄 경계와 무관하므로 line-buffering 한다: 완성된 줄은 chunk 도착 즉시 emit,
 *   줄바꿈이 아직 오지 않은 마지막 조각은 다음 chunk 또는 flush()까지 보류한다.
 *   (Compile처럼 pass 사이에 수 초간 침묵하는 명령도 도착한 부분까지는 바로 보인다.)
 * - 공백만 있는 줄은 건너뛴다(채널 공간 절약; `<<<` 요약의 줄 수 계산과 동일 기준).
 * - maxChars 예산(0 이하 = 무제한)을 넘으면 이후 줄은 생략하고, flush() 시 생략 요약 한 줄을 emit 한다.
 *   줄 하나가 남은 예산보다 길면 예산만큼만 보여 주고 `…`를 붙인다(값은 중간에서 잘릴 수 있음을 표시).
 */

export interface ResponseBodyStreamOptions {
    /** 본문 표시 상한(문자 수). 0 이하면 무제한. */
    maxChars: number;
}

export interface ResponseBodyStreamStats {
    emittedLines: number;
    emittedChars: number;
    omittedLines: number;
    omittedChars: number;
    truncated: boolean;
}

export type LineSink = (line: string) => void;

export class ResponseBodyStreamer {
    private pending = '';
    private flushed = false;
    private readonly stats: ResponseBodyStreamStats = {
        emittedLines: 0,
        emittedChars: 0,
        omittedLines: 0,
        omittedChars: 0,
        truncated: false,
    };

    constructor(
        private readonly emit: LineSink,
        private readonly options: ResponseBodyStreamOptions = { maxChars: 0 },
    ) {}

    /** 소켓 chunk(문자열) 추가 — 완성된 줄만 즉시 emit 한다. */
    push(chunk: string): void {
        if (!chunk || this.flushed) { return; }
        this.pending += chunk;
        const parts = this.pending.split(/\r?\n/);
        // 마지막 조각은 줄바꿈이 아직 오지 않았을 수 있으므로 보류
        this.pending = parts.pop() ?? '';
        for (const line of parts) {
            this.emitLine(line);
        }
    }

    /**
     * 응답 종료(정상/에러/타임아웃/소켓 종료) 시 한 번 호출 — 보류 조각과 생략 요약을 emit 한다.
     * 두 번째 호출부터는 아무 것도 하지 않는다(종료 경로가 겹쳐도 중복 출력 방지).
     */
    flush(): ResponseBodyStreamStats {
        if (!this.flushed) {
            this.flushed = true;
            if (this.pending) {
                this.emitLine(this.pending);
                this.pending = '';
            }
            if (this.stats.truncated) {
                this.emit(formatOmissionNotice(this.stats, this.options.maxChars));
            }
        }
        return { ...this.stats };
    }

    private emitLine(raw: string): void {
        const line = raw.replace(/\r$/, '');
        if (!line.trim()) { return; }

        const max = this.options.maxChars;
        if (max > 0) {
            if (this.stats.truncated) {
                this.stats.omittedLines++;
                this.stats.omittedChars += line.length;
                return;
            }
            const remaining = max - this.stats.emittedChars;
            if (line.length > remaining) {
                this.stats.truncated = true;
                if (remaining > 0) {
                    this.emit(line.slice(0, remaining) + '…');
                    this.stats.emittedLines++;
                    this.stats.emittedChars += remaining;
                    this.stats.omittedChars += line.length - remaining;
                } else {
                    this.stats.omittedLines++;
                    this.stats.omittedChars += line.length;
                }
                return;
            }
        }

        this.emit(line);
        this.stats.emittedLines++;
        this.stats.emittedChars += line.length;
    }
}

/** 생략 요약 줄 — 상한 설정 키를 함께 알려 사용자가 바로 조정할 수 있게 한다. */
export function formatOmissionNotice(stats: ResponseBodyStreamStats, maxChars: number): string {
    return `... 본문 ${stats.omittedLines}줄/${stats.omittedChars}자 생략 ` +
        `(표시 상한 ${maxChars}자 — gpl.controller.trafficLogMaxResponseChars)`;
}
