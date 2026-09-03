/**
 * 자발적 Paused 판별 — 순수 로직(vscode 무의존).
 *
 * 왜: GPL 의 `Paused` 는 "디버거가 멈춰 세웠다"가 아니라 "지금 이 쓰레드가 실행 중이 아니다"에
 * 가깝다. `Thread.Sleep` 으로 자고 있는 쓰레드도 `Show Thread` 에서 Paused 로 보고된다.
 *
 * 실측(2026-08-31, 시뮬레이터 192.168.0.1): BP 가 하나도 없는 파일에서 같은 폴 루프를 도는
 * 리스너 쓰레드 4개가 샘플마다 Running↔Paused 를 오갔고, 한 쓰레드는 Paused 인 채로 줄 번호가
 * 818 → 819 로 전진했다(정지한 쓰레드라면 줄이 움직이지 않는다). 어댑터가 Running→Paused 전이만
 * 보고 StoppedEvent 를 보내던 탓에, BP 를 걸지도 않은 파일에서 가짜 브레이크가 떴다.
 *
 * 규칙:
 * 1. 정지 위치가 우리가 설정한 BP 줄과 일치하면 즉시 정지로 인정한다(`'breakpoint'`).
 * 2. BP 와 무관해도 **같은 위치에서** `confirmPolls` 회 연속, 그리고 `confirmMs` 이상 머무르면
 *    외부 정지로 인정한다(`'external'` — GDE·REPL·MCP 등이 건 `Break`). 스케줄러 대기는 폴 간격마다
 *    위치가 바뀌거나 Running 이 섞이므로 이 문턱을 넘지 않는다. 횟수와 시간을 **모두** 요구하는 이유는
 *    1403 스트림 트리거로 폴이 최소 250ms 간격까지 빨라질 수 있어(`POLL_MIN_GAP_MS`) 횟수만으로는
 *    1초도 안 되는 창에서 확정될 수 있기 때문이다.
 * 3. 그 외에는 알리지 않는다(`'scheduler'`).
 * 4. 이미 인정해 알린 정지가 같은 위치에서 이어지는 동안은 `'announced'` — 중복 StoppedEvent 금지.
 *
 * 쓰레드가 정지 계열을 벗어나면(실행 재개·종료) 호출측이 `reset()` 을 불러 추적을 버린다.
 * 그래야 같은 BP 줄에 다시 도달했을 때 새 정지로 인정된다.
 *
 * 단위 테스트: src/test/spontaneousPause.test.ts
 */

import * as path from 'path';

/** 자발적 Paused 관측의 판정 결과. */
export type SpontaneousPauseVerdict = 'breakpoint' | 'external' | 'scheduler' | 'announced';

/** 쓰레드 하나의 관측 상태. */
export interface SpontaneousPauseWatch {
    /** 관측된 위치의 파일 basename 소문자(위치 불명이면 '') */
    file: string;
    /** 관측된 줄(위치 불명이면 0) */
    line: number;
    /** 같은 위치에서 연속 관측된 횟수 */
    count: number;
    /** 이 위치를 처음 관측한 시각(ms) */
    firstSeenAt: number;
    /** 이 정지를 이미 알렸는가 */
    announced: boolean;
}

/** 이 위치에 우리가 설정한 BP 가 있는지 판정하는 콜백(파일은 basename 소문자, 줄은 1-based). */
export type BreakpointLookup = (file: string, line: number) => boolean;

export class SpontaneousPauseTracker {
    private readonly _watches = new Map<string, SpontaneousPauseWatch>();

    /**
     * @param confirmPolls 등록 BP 와 무관한 위치를 외부 정지로 인정하기까지 필요한 연속 관측 횟수.
     *                     1 이하는 1 로 취급한다.
     * @param confirmMs    같은 위치에 머문 최소 시간(ms). 0 이하 = 시간 조건 없음.
     */
    constructor(private readonly _confirmPolls: number, private readonly _confirmMs = 0) {}

    get confirmPolls(): number {
        return Math.max(1, this._confirmPolls);
    }

    get confirmMs(): number {
        return Math.max(0, this._confirmMs);
    }

    /**
     * 사용자 액션 없이 관측된 Paused/Break 하나를 기록하고 성격을 판정한다.
     * 폴이 이미 받아 온 위치만 쓰므로 추가 제어기 왕복이 없다.
     */
    observe(
        threadName: string,
        file: string | undefined,
        line: number | undefined,
        hasBreakpointAt: BreakpointLookup,
        now: number = Date.now(),
    ): SpontaneousPauseVerdict {
        const base = file ? path.basename(file).toLowerCase() : '';
        const at = line ?? 0;

        let watch = this._watches.get(threadName);
        if (watch && watch.file === base && watch.line === at) {
            if (watch.announced) { return 'announced'; }
            watch.count++;
        } else {
            watch = { file: base, line: at, count: 1, firstSeenAt: now, announced: false };
            this._watches.set(threadName, watch);
        }

        if (base !== '' && at > 0 && hasBreakpointAt(base, at)) {
            watch.announced = true;
            return 'breakpoint';
        }
        if (watch.count >= this.confirmPolls && now - watch.firstSeenAt >= this.confirmMs) {
            watch.announced = true;
            return 'external';
        }
        return 'scheduler';
    }

    /** 쓰레드가 정지 계열을 벗어났거나 종료됐을 때 — 다음 정지를 새 정지로 보게 한다. */
    reset(threadName: string): void {
        this._watches.delete(threadName);
    }

    /** 사용자 액션(step/continue/pause)·세션 종료 시 전체 초기화. */
    clear(): void {
        this._watches.clear();
    }
}
