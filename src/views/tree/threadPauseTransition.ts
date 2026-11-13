/**
 * 폴링 사이의 쓰레드 목록 비교 — 외부(MCP AI/GDE)가 세운 정지를 에디터가 따라가기 위한 정지 전이 감지. vscode 무의존.
 * controllerTreeProvider.ts 의 firePauseTransitions 에서 판정 부분을 옮겼다(2026-10-27, 동작 동일) — 이벤트 발화는 provider 가 한다.
 */
import type { ThreadInfo } from '../../controller/protocol/responseParser';
import { isPausedState } from '../../controller/threads/threadActivity';

export interface PauseTransition {
	name: string;
	state: string;
}

/**
 * 이전/새 스레드 목록을 비교해 정지 전이를 감지한다.
 * - 기존 스레드의 비정지→정지 전이, 또는 정지 상태로 새로 나타난 스레드(stopOnEntry —
 *   스레드 0개 상태에서 시작해도 잡히도록 빈 previous도 비교 대상이며, 첫 수신 여부는
 *   호출부의 hasReceivedThreadList가 거른다)에 해당.
 * - 한 폴 주기에 최대 1건만 돌려줘(목록 순서상 첫 번째) 다중 파일 점프를 막는다.
 */
export function detectPauseTransition(previous: readonly ThreadInfo[], next: readonly ThreadInfo[]): PauseTransition | undefined {
	const prevStates = new Map(previous.map(t => [t.name, t.state]));
	for (const t of next) {
		if (!isPausedState(t.state)) { continue; }
		const prevState = prevStates.get(t.name);
		if (prevState === undefined || !isPausedState(prevState)) {
			return { name: t.name, state: t.state };
		}
	}
	return undefined;
}
