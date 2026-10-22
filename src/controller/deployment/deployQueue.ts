/**
 * 제어기별 배포 직렬 큐. vscode 무의존이라 배포 진입점과 단위 테스트가 같은 규칙을 쓴다.
 *
 * 같은 제어기에 대한 Upload/Deploy 요청은 들어온 순서대로 실행하고, 서로 다른 제어기는 병행한다.
 * 실제 제어기 상호 배제는 프로세스 간 파일 잠금(deployLock.ts)이 담당하며, 이 큐는 한 Extension Host
 * 안에서 먼저 들어온 요청이 뒤 요청에 추월당하지 않게 하는 대기열이다.
 */

export interface SerialQueueTicket<T> {
	/** 현재 실행 중인 항목을 포함해 이 요청보다 앞에 있는 작업 수. */
	ahead: number;
	result: Promise<T>;
}

interface QueueState {
	tail: Promise<void>;
	depth: number;
}

export class KeyedSerialQueue {
	private readonly states = new Map<string, QueueState>();

	enqueue<T>(key: string, task: () => Promise<T>): SerialQueueTicket<T> {
		const normalized = key.trim().toLowerCase();
		const state = this.states.get(normalized) ?? { tail: Promise.resolve(), depth: 0 };
		const ahead = state.depth;
		state.depth++;

		const result = state.tail.then(task);
		state.tail = result.then(
			() => undefined,
			() => undefined,
		).finally(() => {
			state.depth--;
			if (state.depth === 0 && this.states.get(normalized) === state) {
				this.states.delete(normalized);
			}
		});
		this.states.set(normalized, state);
		return { ahead, result };
	}

	depth(key: string): number {
		return this.states.get(key.trim().toLowerCase())?.depth ?? 0;
	}
}

