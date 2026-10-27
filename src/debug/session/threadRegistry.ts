/**
 * 쓰레드 이름 ↔ DAP 정수 ID 대응표와 CALL STACK 표시(라벨·정렬 순위).
 *
 * DAP 는 정수 threadId 를 요구하고 제어기는 이름으로 쓰레드를 부른다. ID 는 세션 동안 한 번 주면 바뀌지 않는다.
 *
 * `gplDebugSession.ts`(5,700줄) 에서 2026-10-27 에 분리했다. 세션 상태는 `DebugSessionIo` getter 로만 읽는다.
 * 순수 모듈 — 단위 테스트 대상.
 */

export class ThreadRegistry {
    // Thread name ↔ integer ID (DAP requires integer thread IDs)
    threadNameToId = new Map<string, number>();

    threadIdToName = new Map<number, string>();

    private nextThreadId = 1;

    // Known thread names — for detecting new/exited threads (ThreadEvent)
    knownThreadNames = new Set<string>();

    getOrCreateThreadId(name: string): number {
        let id = this.threadNameToId.get(name);
        if (id === undefined) {
            id = this.nextThreadId++;
            this.threadNameToId.set(name, id);
            this.threadIdToName.set(id, name);
        }
        return id;
    }

    /** Format thread label shown in VS Code CALL STACK panel: "ThreadName  [▶ Running]" */
    formatThreadLabel(name: string, state: string, lockedThreadName: string | undefined): string {
        const icons: Record<string, string> = {
            Running:  '▶',
            Idle:     '○',
            Break:    '⏸',
            Paused:   '⏸',
            Error:    '⚠',
            Stopping: '■',
            Stopped:  '■',
        };
        const icon = icons[state] ?? '?';
        // 주의가 필요한 상태(정지/에러)는 선두 마커(●)와 대문자 상태로 강조해
        // 실행 중인 다른 쓰레드 사이에서 한눈에 구분되게 한다.
        const attention = state === 'Paused' || state === 'Break' || state === 'Error';
        // 실행 잠금이 걸린 스레드는 자물쇠를 앞에 붙인다 — Continue/Step 이 포커스와 무관하게
        // 이 스레드로 간다는 표시(라벨은 표시 전용이며 스레드 식별은 name↔id 맵으로만 한다).
        const lock = lockedThreadName === name ? '🔒 ' : '';
        if (attention) {
            return `${lock}● ${name}  [${icon} ${state.toUpperCase()}]`;
        }
        return `${lock}${name}  [${icon} ${state}]`;
    }

    /**
     * 호출 스택/쓰레드 목록 정렬용 상태 우선순위.
     * 값이 작을수록 위에 표시된다: Error → Paused/Break → Stopping/Stopped → Running → Idle → 기타.
     */
    threadStateRank(state: string): number {
        switch (state) {
            case 'Error':    return 0;
            case 'Paused':
            case 'Break':    return 1;
            case 'Stopping':
            case 'Stopped':  return 2;
            case 'Running':  return 3;
            case 'Idle':     return 4;
            default:         return 5;
        }
    }
}
