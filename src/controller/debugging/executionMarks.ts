/**
 * 실행 위치 강조(정지 줄·에러 줄)의 유효성 판정 — 순수 로직(vscode 무의존).
 *
 * 왜: 에디터의 붉은 에러 줄·노란 정지 줄은 "지금 제어기의 어떤 쓰레드가 그 상태에 있다"는 표시인데,
 * 종전에는 칠한 문서를 편집하거나 다른 위치를 칠할 때만 지워졌다. 그래서 에러 난 쓰레드를 재시작해
 * 에러가 사라진 뒤에도(트리는 「코드 오류 (0)」) 붉은 줄이 그대로 남았다(2026-10-14 사용자 관측, §1-EP).
 *
 * 규칙: 강조에는 **주인 쓰레드**(칠할 때 알고 있던 이름)를 붙이고, 쓰레드 목록이 갱신될 때마다
 * 그 쓰레드가 아직 같은 상태인지로 유지/해제를 정한다. 주인을 모르는 강조(ErrorLog 항목에서 연 보고서 등)는
 * 같은 종류의 상태가 제어기 어디에도 없을 때 지운다.
 *
 * 상태 문자열의 출처는 `Show Thread -web`(폴링)과 디버그 어댑터의 같은 목록(debugBridge)이라 두 경로가 같은 판정을 받는다.
 *
 * 단위 테스트: src/test/executionMarks.test.ts
 */
import { isPausedState, ThreadLike } from '../threads/threadActivity';

/** 강조를 칠할 때 알고 있던 주인 — 모르면 빈 객체. */
export interface ExecutionMarkOwner {
    /** 그 상태에 있던 쓰레드 이름(대소문자 무시). */
    threadName?: string;
}

/** 쓰레드 목록 갱신 한 번의 요약 — 트리가 폴링/디버그 브리지에서 받은 그대로. */
export interface RuntimeStateSnapshot {
    threads: readonly ThreadLike[];
    /** ErrorLog 항목 수(마지막으로 조회한 값). 디버그 세션 중에는 갱신되지 않을 수 있다. */
    errorCount: number;
}

function norm(s: string | undefined): string {
    return (s ?? '').trim().toLowerCase();
}

function findThread(threads: readonly ThreadLike[], name: string): ThreadLike | undefined {
    const key = norm(name);
    return threads.find(t => norm(t.name) === key);
}

function isErrorState(state: string | undefined): boolean {
    return (state ?? '').trim() === 'Error';
}

/**
 * 에러 줄 강조가 낡았는가(지워야 하는가).
 *
 * - 주인 쓰레드를 알면: 그 쓰레드가 목록에 **없거나** 상태가 `Error` 가 아니면 낡은 것이다
 *   (재시작·Stop·Continue 어느 쪽이든 "그 에러 위치에 서 있는" 상태가 끝났다).
 * - 주인을 모르면: `Error` 상태 쓰레드도 없고 ErrorLog 도 비어 있을 때만 낡은 것으로 본다
 *   (ErrorLog 항목에서 연 위치는 로그가 남아 있는 동안 유효하다).
 */
export function isErrorMarkStale(owner: ExecutionMarkOwner, snapshot: RuntimeStateSnapshot): boolean {
    const name = owner.threadName?.trim();
    if (name) {
        const thread = findThread(snapshot.threads, name);
        return !thread || !isErrorState(thread.state);
    }
    const anyErrorThread = snapshot.threads.some(t => isErrorState(t.state));
    return !anyErrorThread && snapshot.errorCount === 0;
}

/**
 * 정지 줄 강조가 낡았는가(지워야 하는가).
 *
 * - 주인 쓰레드를 알면: 목록에 없거나 검사 가능한 정지 상태(Paused/Break/Error)가 아니면 낡은 것이다
 *   (Continue·Step·재시작으로 그 위치를 떠났다).
 * - 주인을 모르면: 정지 상태 쓰레드가 하나도 없을 때 낡은 것으로 본다.
 */
export function isStoppedMarkStale(owner: ExecutionMarkOwner, snapshot: RuntimeStateSnapshot): boolean {
    const name = owner.threadName?.trim();
    if (name) {
        const thread = findThread(snapshot.threads, name);
        return !thread || !isPausedState(thread.state);
    }
    return !snapshot.threads.some(t => isPausedState(t.state));
}
