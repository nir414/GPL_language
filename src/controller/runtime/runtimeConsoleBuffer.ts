/**
 * 런타임 콘솔(1403) 수신 줄의 링버퍼 + 커서 읽기 + 조건 대기 — 순수 모듈(vscode·소켓 무의존, Node 단독 테스트).
 *
 * 왜(2026-10-14 §1-EP): AI(MCP)가 "프로그램이 X 를 출력했는지" 를 보려면 Output 채널을 읽을 수 없어 1402 조회를
 * 반복하거나 사용자에게 물어야 했다. 이 버퍼는 `RuntimeConsole.outputLine` 이 내보내는 **정규화된 줄**을 seq 와 함께
 * 보관하고, `read(cursor)` 로 "지난번 이후의 새 줄" 만, `waitFor` 로 "패턴이 올 때까지" 를 한 번의 호출로 끝내게 한다.
 * 판단 근거는 이 버퍼(라이브 스트림의 사본)이고, 파일 캡처는 사람이 나중에 보는 용도다(§0 하드 규칙 1 의 취지).
 *
 * 커서 규약: `seq` 는 0 부터 단조 증가하는 줄 번호, `cursor` 는 **다음에 읽을 seq**. 버퍼가 꽉 차 오래된 줄이 밀리면
 * `dropped` 에 "커서 이후인데 못 본 줄 수" 를 세어 알린다(조용히 빠지지 않는다).
 */

export interface BufferedConsoleLine {
	/** 0 부터 단조 증가. 재시작 전까지 재사용되지 않는다. */
	seq: number;
	/** 수신 시각(epoch ms). */
	at: number;
	/** 정규화된 줄(접두사 없음). */
	text: string;
	/** 프레임이 알려 준 프로젝트명(있을 때만). */
	project?: string;
}

export interface ConsoleReadResult {
	lines: BufferedConsoleLine[];
	/** 다음 호출에 그대로 넘길 커서. 줄이 없으면 요청 커서(또는 버퍼의 다음 seq). */
	nextCursor: number;
	/** 요청 커서 이후인데 링버퍼에서 밀려 돌려주지 못한 줄 수. */
	dropped: number;
	/** 버퍼에 지금 있는 줄 수. */
	buffered: number;
}

export interface ConsoleWaitResult extends ConsoleReadResult {
	/** `untilPattern` 이 맞는 줄을 받았는가(패턴이 없으면 새 줄이 하나라도 왔는가). */
	matched: boolean;
	/** 시간 안에 조건을 못 채웠는가. */
	timedOut: boolean;
	waitedMs: number;
}

export interface ConsoleWaitOptions {
	/**
	 * 읽기 시작 커서. 생략하면 — 기다리지 않을 때(timeoutMs 0)는 **최근 maxLines 줄**(처음 보는 호출자용, `read()` 와 같다),
	 * 기다릴 때는 "지금부터 오는 줄" (버퍼의 다음 seq).
	 */
	cursor?: number;
	/** 최대 줄 수(기본 200). 패턴 대기 중에는 이 수를 채우면 매치 없이도 끝낸다. */
	maxLines?: number;
	/** 이 패턴의 줄이 오면 즉시 끝낸다. 없으면 새 줄 1개 이상이면 끝. */
	untilPattern?: RegExp;
	/** 최대 대기(ms). 0 이면 기다리지 않고 지금 있는 것만. */
	timeoutMs: number;
	/** 테스트용 시계. */
	now?: () => number;
}

const DEFAULT_CAPACITY = 2000;
const DEFAULT_MAX_LINES = 200;

export class RuntimeConsoleBuffer {
	private readonly lines: BufferedConsoleLine[] = [];
	private nextSeq = 0;
	private readonly listeners = new Set<(line: BufferedConsoleLine) => void>();

	constructor(private readonly capacity: number = DEFAULT_CAPACITY) {
		if (!Number.isInteger(capacity) || capacity < 1) {
			throw new Error(`RuntimeConsoleBuffer capacity must be a positive integer (got ${capacity})`);
		}
	}

	/** 다음에 부여될 seq — "지금부터" 를 뜻하는 커서로 쓴다. */
	get cursorNow(): number { return this.nextSeq; }

	/** 버퍼에 남아 있는 줄 수. */
	get size(): number { return this.lines.length; }

	/** 가장 오래된 줄의 seq(비어 있으면 nextSeq). */
	get oldestSeq(): number { return this.lines.length > 0 ? this.lines[0].seq : this.nextSeq; }

	push(text: string, project?: string, at: number = Date.now()): BufferedConsoleLine {
		const line: BufferedConsoleLine = project ? { seq: this.nextSeq++, at, text, project } : { seq: this.nextSeq++, at, text };
		this.lines.push(line);
		if (this.lines.length > this.capacity) {
			this.lines.splice(0, this.lines.length - this.capacity);
		}
		for (const listener of Array.from(this.listeners)) {
			try { listener(line); } catch { /* 리스너 오류가 수신 경로를 막지 않게 */ }
		}
		return line;
	}

	/**
	 * `cursor` 이후의 줄을 최대 `maxLines` 개. 커서를 생략하면 **최근** `maxLines` 개(처음 보는 호출자용).
	 */
	read(cursor?: number, maxLines: number = DEFAULT_MAX_LINES): ConsoleReadResult {
		const limit = Math.max(1, Math.floor(maxLines));
		if (cursor === undefined || cursor === null) {
			const tail = this.lines.slice(-limit);
			return {
				lines: tail,
				nextCursor: tail.length > 0 ? tail[tail.length - 1].seq + 1 : this.nextSeq,
				dropped: 0,
				buffered: this.lines.length,
			};
		}
		const from = Math.max(0, Math.floor(cursor));
		const dropped = this.lines.length > 0 ? Math.max(0, this.lines[0].seq - from) : Math.max(0, this.nextSeq - from);
		const startIdx = this.lines.findIndex(l => l.seq >= from);
		const slice = startIdx < 0 ? [] : this.lines.slice(startIdx, startIdx + limit);
		return {
			lines: slice,
			nextCursor: slice.length > 0 ? slice[slice.length - 1].seq + 1 : Math.max(from, this.nextSeq),
			dropped,
			buffered: this.lines.length,
		};
	}

	/**
	 * 조건이 찰 때까지 기다렸다가 누적 줄을 한 번에 돌려준다.
	 * - 패턴이 있으면: 커서 이후 줄 중 패턴 매치가 나오면 그 줄까지 포함해 끝낸다. 없으면 timeoutMs 까지 기다린다.
	 * - 패턴이 없으면: 커서 이후 줄이 1개 이상이면 즉시, 아니면 첫 새 줄이 올 때까지.
	 * - maxLines 를 채우면 매치 없이도 끝낸다(다음 호출이 nextCursor 로 이어 읽는다).
	 */
	waitFor(options: ConsoleWaitOptions): Promise<ConsoleWaitResult> {
		const now = options.now ?? (() => Date.now());
		const started = now();
		const maxLines = Math.max(1, Math.floor(options.maxLines ?? DEFAULT_MAX_LINES));
		const pattern = options.untilPattern;
		const timeoutMs = Math.max(0, options.timeoutMs);
		const noCursor = options.cursor === undefined || options.cursor === null;
		// 커서 없이 기다리지도 않으면 "최근 줄" 을 돌려준다 — 종전에는 "지금부터" 로 해석해 항상 빈 결과(lines:[])였고,
		// 처음 부른 AI 가 "출력 기록이 없다" 고 잘못 결론 냈다(2026-10-22 Sample Prep, buffered 1393 인데 lines:[]).
		if (noCursor && timeoutMs === 0) {
			const r = this.read(undefined, maxLines);
			const matched = pattern ? r.lines.some(l => pattern.test(l.text)) : r.lines.length > 0;
			return Promise.resolve({ ...r, matched, timedOut: false, waitedMs: now() - started });
		}
		const cursor = noCursor ? this.nextSeq : Math.max(0, Math.floor(options.cursor as number));

		const finish = (matched: boolean, timedOut: boolean): ConsoleWaitResult => {
			const r = this.read(cursor, maxLines);
			return { ...r, matched, timedOut, waitedMs: now() - started };
		};
		const evaluate = (): { done: boolean; matched: boolean } => {
			const r = this.read(cursor, maxLines);
			if (pattern) {
				const hit = r.lines.findIndex(l => pattern.test(l.text));
				if (hit >= 0) { return { done: true, matched: true }; }
				return { done: r.lines.length >= maxLines, matched: false };
			}
			return { done: r.lines.length > 0, matched: r.lines.length > 0 };
		};

		const first = evaluate();
		if (first.done || timeoutMs === 0) {
			if (first.matched && pattern) { return Promise.resolve(this.readUntilMatch(cursor, maxLines, pattern, now() - started)); }
			return Promise.resolve(finish(first.matched, !first.done));
		}

		return new Promise<ConsoleWaitResult>(resolve => {
			let settled = false;
			const timer = setTimeout(() => settle(false, true), timeoutMs);
			const listener = (): void => {
				const e = evaluate();
				if (e.done) { settle(e.matched, false); }
			};
			const settle = (matched: boolean, timedOut: boolean): void => {
				if (settled) { return; }
				settled = true;
				clearTimeout(timer);
				this.listeners.delete(listener);
				if (matched && pattern) {
					resolve(this.readUntilMatch(cursor, maxLines, pattern, now() - started));
				} else {
					resolve(finish(matched, timedOut));
				}
			};
			this.listeners.add(listener);
		});
	}

	/** 패턴 매치 줄까지만 잘라 돌려준다 — 매치 뒤에 더 온 줄은 다음 커서로 넘긴다(호출자가 "그 시점" 을 정확히 본다). */
	private readUntilMatch(cursor: number, maxLines: number, pattern: RegExp, waitedMs: number): ConsoleWaitResult {
		const r = this.read(cursor, maxLines);
		const hit = r.lines.findIndex(l => pattern.test(l.text));
		const lines = hit >= 0 ? r.lines.slice(0, hit + 1) : r.lines;
		return {
			lines,
			nextCursor: lines.length > 0 ? lines[lines.length - 1].seq + 1 : r.nextCursor,
			dropped: r.dropped,
			buffered: r.buffered,
			matched: hit >= 0,
			timedOut: false,
			waitedMs,
		};
	}
}

/**
 * 사용자 입력 정규식을 안전하게 만든다 — 잘못된 패턴은 null(호출자가 bad-pattern 으로 돌려준다). 항상 대소문자 무시.
 */
export function compileUntilPattern(source: string | undefined): RegExp | null | undefined {
	if (source === undefined || source === null || source === '') { return undefined; }
	try {
		return new RegExp(source, 'i');
	} catch {
		return null;
	}
}
