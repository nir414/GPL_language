import { parseStatus, NO_STATUS_CODE } from '../protocol/responseParser';
import { extractDataPayload, RAW_KEEP_MAX_CHARS } from './resourceProbes';

/** Brooks System Console Panel이 사용하는 읽기 전용 명령. */
export const PROBE_TEMPERATURE_CMD = 'Show Temperature';

export interface TemperatureReading {
	key: string;
	kind: 'cpu' | 'amplifier';
	label: string;
	/** 해석 가능한 섭씨값. 앰프의 0은 센서 지원을 확인할 수 없어 null로 둔다. */
	celsius: number | null;
	reportedCelsius: number;
	note?: string;
}

export interface TemperatureSnapshot {
	sampledAt: number;
	statusCode: number | null;
	complete: boolean;
	readings: TemperatureReading[];
	raw: string;
	note?: string;
}

/** CPU/Robot/Amp 번호를 온도로 섞지 않고, 단위가 명시된 행만 읽는다. */
export function parseTemperatureResponse(raw: string | null, sampledAt = Date.now()): TemperatureSnapshot {
	const code = raw ? parseStatus(raw).code : NO_STATUS_CODE;
	const complete = !!raw && /<\/STATUS>\s*$/i.test(raw) && code !== NO_STATUS_CODE;
	const snapshot: TemperatureSnapshot = {
		sampledAt, statusCode: code === NO_STATUS_CODE ? null : code, complete,
		readings: [], raw: (raw ?? '').slice(0, RAW_KEEP_MAX_CHARS),
	};
	if (!complete || code !== 0) {
		snapshot.note = !raw ? '응답 없음' : !complete ? '종결 STATUS 미수신' : `조회 실패 STATUS ${code}`;
		return snapshot;
	}
	let robot: string | undefined;
	for (const line of extractDataPayload(raw!).split(/\r?\n/)) {
		const robotMatch = /^\s*Robot\s+(\d+)\s*:?[ \t]*$/i.exec(line);
		if (robotMatch) { robot = robotMatch[1]; continue; }
		const match = /^\s*(CPU|Amp(?:lifier)?)\s+(\d+)\s*:\s*([+-]?\d+(?:\.\d+)?)\s*°?\s*C\s*$/i.exec(line);
		if (!match) { continue; }
		const kind = /^cpu$/i.test(match[1]) ? 'cpu' : 'amplifier';
		const value = Number(match[3]);
		if (!Number.isFinite(value)) { continue; }
		const uncertain = kind === 'amplifier' && value === 0;
		snapshot.readings.push({
			key: kind === 'cpu' ? `cpu-${match[2]}` : `robot-${robot ?? 'unknown'}-amp-${match[2]}`,
			kind,
			label: kind === 'cpu' ? `CPU ${match[2]}` : `${robot ? `Robot ${robot} · ` : ''}Amp ${match[2]}`,
			celsius: uncertain ? null : value, reportedCelsius: value,
			...(uncertain ? { note: '0°C 반환 — 센서 지원 확인 필요' } : {}),
		});
	}
	if (!snapshot.readings.length) { snapshot.note = '응답 형식 미확정 — 원문 확인'; }
	return snapshot;
}

export interface TemperatureHistoryPoint {
	t: number;
	cpuMaxC: number | null;
	amplifierMaxC: number | null;
}

/** 탭 수명 동안 최신 360개 실측만 보관한다. 실패는 그래프의 빈 구간으로 남긴다. */
export class TemperatureHistory {
	private points: TemperatureHistoryPoint[] = [];
	record(snapshot: TemperatureSnapshot): TemperatureHistoryPoint[] {
		if (this.points[this.points.length - 1]?.t !== snapshot.sampledAt) {
			const max = (kind: TemperatureReading['kind']): number | null => {
				const values = snapshot.readings.filter(r => r.kind === kind && r.celsius !== null).map(r => r.celsius!);
				return values.length ? Math.max(...values) : null;
			};
			this.points.push({ t: snapshot.sampledAt, cpuMaxC: max('cpu'), amplifierMaxC: max('amplifier') });
			if (this.points.length > 360) { this.points.shift(); }
		}
		return this.points.slice();
	}
	clear(): void { this.points = []; }
}
