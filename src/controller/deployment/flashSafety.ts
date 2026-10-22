/**
 * Flash 쓰기 완료 확인 절차.
 *
 * Brooks 공식 Console Command 문서에서 `Sync`는 보류 중인 모든 flash 쓰기가 끝나고
 * DataID 910(Disk Busy)이 0이 될 때까지 기다린다. 일부 하드웨어 문서는 Flash Busy 표시가
 * 사라진 뒤에도 10초를 더 기다린 다음 전원을 끄라고 요구하므로, 성공 STATUS 뒤 안정화 시간을 둔다.
 *
 * vscode 무의존 순수 절차로 두어 Save to Flash UI와 테스트가 같은 안전 규칙을 공유한다.
 */

import { parseStatus } from '../protocol/responseParser';
import { isCleanlyTerminated } from '../connection/consoleSocket';

export const FLASH_SETTLE_MS = 10_000;
export const FLASH_SYNC_TIMEOUT_MS = 120_000;

export type FlashSafetyState =
	| { phase: 'writing' }
	| { phase: 'syncing' }
	| { phase: 'settling'; remainingSeconds: number }
	| { phase: 'unknown'; detail: string };

export interface FlashSafetyResult {
	ok: boolean;
	statusCode?: number;
	detail?: string;
}

export interface WaitForFlashSafeOptions {
	/** `Sync`를 보내고 종결 STATUS까지 받은 원문을 반환한다. */
	sendSync: () => Promise<string>;
	/** 상태바 등 사용자 표시 갱신. */
	onState?: (state: FlashSafetyState) => void;
	/** 테스트에서 실제 대기를 없애기 위한 주입점. */
	sleep?: (ms: number) => Promise<void>;
	settleMs?: number;
	tickMs?: number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * `Sync` STATUS 0을 확인한 뒤 안정화 시간을 끝까지 기다린다.
 *
 * 전송 실패·STATUS 누락·STATUS 오류는 안전을 증명하지 못하므로 `unknown`으로 남긴다. 호출자는 이때
 * 경고 표시를 자동으로 지우면 안 된다.
 */
export async function waitForFlashSafe(options: WaitForFlashSafeOptions): Promise<FlashSafetyResult> {
	options.onState?.({ phase: 'syncing' });

	let raw: string;
	try {
		raw = await options.sendSync();
	} catch (error: any) {
		const detail = error?.message ?? String(error);
		options.onState?.({ phase: 'unknown', detail });
		return { ok: false, detail };
	}

	const status = parseStatus(raw);
	const complete = isCleanlyTerminated(raw);
	if (!complete || status.code !== 0) {
		const detail = !complete ? 'Sync 응답의 종결 STATUS 미수신'
			: `Sync STATUS ${status.code}: ${status.message || 'Unknown error'}`;
		options.onState?.({ phase: 'unknown', detail });
		return { ok: false, statusCode: status.code, detail };
	}

	const sleep = options.sleep ?? defaultSleep;
	const settleMs = Math.max(0, options.settleMs ?? FLASH_SETTLE_MS);
	const tickMs = Math.max(1, options.tickMs ?? 1_000);
	let remainingMs = settleMs;
	while (remainingMs > 0) {
		options.onState?.({ phase: 'settling', remainingSeconds: Math.ceil(remainingMs / 1_000) });
		const stepMs = Math.min(tickMs, remainingMs);
		await sleep(stepMs);
		remainingMs -= stepMs;
	}

	return { ok: true, statusCode: 0 };
}
