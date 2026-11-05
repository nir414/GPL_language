/**
 * 런타임 콘솔(1403) 파서 정체 감지 — 순수 모듈(vscode·소켓 무의존, Node 단독 테스트).
 *
 * 왜(2026-11-02 SamplePrep 보고): 상태는 `connected` 이고 `lastPayloadAt` 이 계속 오르는데 링버퍼·캡처 파일에 줄이 더는
 * 쌓이지 않았다. payload 도착(소켓)과 줄 적재(파서)는 별개의 단계이므로, 둘의 간극을 상태에 드러내야 "연결은 됐는데 못 읽는
 * 중" 과 "정말 출력이 없음" 을 가를 수 있다.
 *
 * 판정: 파서가 **아직 줄로 내보내지 못한 바이트**(미완 프레임 carry · 재조립 중인 type-3 청크)를 쥐고 있고, 그 상태에서
 * 줄 적재 같은 진전 없이 오래 지났으며, payload 는 여전히 오고 있다 → 정체. 하트비트(`<E>1,N</E>`)만 오는 평시는 파서가 쥔 바이트가
 * 0 이라 정체로 보지 않는다.
 *
 * 단위 테스트: src/test/controller/runtime/parserStall.test.ts
 */

/** 이 시간 안에 payload 가 왔으면 "아직 듣고 있다". */
export const STALL_PAYLOAD_FRESH_MS = 15_000;
/** 파서가 바이트를 쥔 채 진전이 없던 시간이 이 이상이면 정체. */
export const STALL_NO_PROGRESS_MS = 30_000;

export interface ParserStallVerdict {
    stalled: boolean;
    /** 파서가 지금 쥐고 있는 바이트 수(carry + 재조립 버퍼). */
    pendingBytes: number;
    /** 쥔 바이트에 진전이 없던 시간(ms). 쥔 바이트가 없으면 0. */
    noProgressMs: number;
}

export class ParserStallTracker {
    private lastPayloadAt = 0;
    private lastLineAt = 0;
    private pendingBytes = 0;
    /** 쥔 바이트가 생겼거나 줄 적재가 있던 마지막 시각 — "진전" 의 기준. */
    private progressAt = 0;

    onPayload(now: number): void { this.lastPayloadAt = now; }

    /** 링버퍼에 줄이 하나 들어갔다 — 파서가 진전했다는 뜻이다. */
    onLine(now: number): void {
        this.lastLineAt = now;
        this.progressAt = now;
    }

    /** payload 처리 뒤 파서가 쥔 바이트 수를 알린다. 0 → 양수로 바뀌는 순간이 진전 기준점이 된다. */
    onPending(bytes: number, now: number): void {
        if (bytes > 0 && this.pendingBytes === 0) { this.progressAt = now; }
        this.pendingBytes = Math.max(0, bytes);
    }

    get lastLine(): number { return this.lastLineAt; }

    evaluate(now: number): ParserStallVerdict {
        if (this.pendingBytes <= 0) { return { stalled: false, pendingBytes: 0, noProgressMs: 0 }; }
        const noProgressMs = Math.max(0, now - this.progressAt);
        const listening = this.lastPayloadAt > 0 && now - this.lastPayloadAt <= STALL_PAYLOAD_FRESH_MS;
        return { stalled: listening && noProgressMs >= STALL_NO_PROGRESS_MS, pendingBytes: this.pendingBytes, noProgressMs };
    }

    /** 새 세션(재연결)이나 강제 복구 뒤 — 쥔 바이트 상태를 비운다. lastLineAt 은 보존(마지막 줄 시각은 사실이다). */
    resetPending(): void {
        this.pendingBytes = 0;
        this.progressAt = 0;
    }
}
