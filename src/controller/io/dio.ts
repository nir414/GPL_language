/**
 * Brooks 명령 콘솔 DIO 응답과 Set DIO 명령의 순수 규칙.
 *
 * 공식 형식:
 *   signal_number: 0|1 [*]
 * `*`는 신호가 특정 상태로 강제(force)됐다는 뜻이다.
 */

export interface DioSignalState {
	signal: number;
	on: boolean;
	forced: boolean;
}

export type DioForceValue = -1 | 0 | 1;

/** `Show DIO` 응답에서 유효한 신호 행을 번호순으로 추출한다. */
export function parseDioSignals(response: string): DioSignalState[] {
	const bySignal = new Map<number, DioSignalState>();
	const payload = response
		.replace(/<STATUS>[\s\S]*?<\/STATUS>/gi, '')
		.replace(/<\/?DATA>/gi, '');
	const row = /(?:^|[\r\n|])\s*(\d+)\s*:\s*([01])(?:\s*(\*))?(?=\s*(?:[\r\n|]|$))/g;
	let match: RegExpExecArray | null;
	while ((match = row.exec(payload)) !== null) {
		const signal = Number(match[1]);
		if (!Number.isSafeInteger(signal)) {
			continue;
		}
		bySignal.set(signal, {
			signal,
			on: match[2] === '1',
			forced: match[3] === '*',
		});
	}
	return [...bySignal.values()].sort((a, b) => a.signal - b.signal);
}

/** Webview·명령 인자를 엄격히 검사한 뒤 제어기 명령을 만든다. */
export function buildSetDioCommand(signal: unknown, value: unknown): string | undefined {
	if (typeof signal !== 'number' || !Number.isSafeInteger(signal) || signal < 0) {
		return undefined;
	}
	if (value !== -1 && value !== 0 && value !== 1) {
		return undefined;
	}
	return `Set DIO ${signal} ${value}`;
}

export function describeDioForce(value: DioForceValue): { label: string; detail: string } {
	switch (value) {
		case 1:
			return { label: '강제 ON', detail: '신호를 ON 상태로 강제합니다.' };
		case -1:
			return { label: '강제 OFF', detail: '신호를 OFF 상태로 강제합니다.' };
		case 0:
			return { label: '강제 해제', detail: '현재 ON/OFF 값은 그대로 두고 강제 상태만 해제합니다.' };
	}
}
