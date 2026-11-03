/**
 * 시스템 정보 섹션의 행 만들기 — `Show Memory`/`Show Flash Free`/`Show CPU Profile`/`Show Temperature` 응답을
 * 핵심 지표 한 줄(값)과 원문(툴팁)으로 다듬는다. vscode 무의존.
 * controllerTreeProvider.ts 의 refreshSystemInfo 본문과 extractRaw/formatFlash/formatCpu 를
 * 그대로 옮겼다(2026-10-27, 동작 동일). 전송(trySendCommand)은 provider 에 남아 있다.
 * 메모리 행은 응답을 따로 해석하지 않고 측정값 정본(controller/diagnostics/memoryReadings)을 그린다(2026-11-03) —
 * 상태 표시줄·Compile/Start 검사와 같은 값이 보이게.
 */
import { PROBE_TEMPERATURE_CMD } from '../../controller/diagnostics/temperature';
import type { TemperatureSnapshot } from '../../controller/diagnostics/temperature';
import { formatMemoryReadingValue } from '../../controller/diagnostics/memoryReadings';
import type { MemoryReading } from '../../controller/diagnostics/memoryReadings';
import type { SystemInfoItem } from './treeSnapshot';

/** 시스템 정보 명령의 응답(null = 응답 없음)·이 제어기의 최신 메모리 측정·파싱된 온도 스냅샷. */
export interface SystemInfoResponses {
	/** 측정값 정본의 최신 값(누가 쟀든). 없으면 메모리 행을 만들지 않는다. */
	memory: MemoryReading | undefined;
	flashResp: string | null;
	cpuResp: string | null;
	temperature: TemperatureSnapshot;
}

/** 응답에서 <DATA> 또는 본문 추출 (원시 텍스트) */
export function extractRaw(resp: string): string {
	const dataMatch = resp.match(/<DATA>([\s\S]*?)<\/DATA>/);
	if (dataMatch) {
		return dataMatch[1].trim();
	}
	return resp.replace(/<\/?STATUS[^>]*>.*?<\/STATUS>/gs, '').trim();
}

/** 플래시: "타입, 크기 · Free: X" */
export function formatFlash(raw: string): string {
	const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
	const typeLine = lines[0] || '';
	const freeMatch = raw.match(/Free[:\s]+(\d[\d.]*\s*\w+)/i);
	if (freeMatch && typeLine) {
		// 타입라인이 Free 정보를 이미 포함하면 그대로
		if (/free/i.test(typeLine)) { return typeLine; }
		return `${typeLine} · Free: ${freeMatch[1]}`;
	}
	return typeLine || raw;
}

/** CPU: 퍼센트 또는 첫 줄 */
export function formatCpu(raw: string): string {
	const pctMatch = raw.match(/(\d[\d.]*)\s*%/);
	if (pctMatch) { return `${pctMatch[1]}%`; }
	return raw.split(/\r?\n/)[0]?.trim() || raw;
}

/**
 * 시스템 정보 행 목록. 메모리·플래시는 응답이 있을 때만, CPU 는 항상(없으면 '데이터 없음'),
 * 온도는 읽기마다 한 행(읽기가 없으면 '온도' 한 행에 사유).
 */
export function buildSystemInfoItems(input: SystemInfoResponses): SystemInfoItem[] {
	const items: SystemInfoItem[] = [];
	const { temperature } = input;

	const flashRaw = input.flashResp ? extractRaw(input.flashResp) : '';
	const cpuRaw = input.cpuResp ? extractRaw(input.cpuResp) : '';

	if (input.memory) {
		const m = input.memory;
		const at = new Date(m.at).toLocaleTimeString('ko-KR', { hour12: false });
		items.push({ label: '메모리', value: formatMemoryReadingValue(m), tooltip: `${m.command} · ${at} 측정\n${extractRaw(m.raw)}`, iconId: 'database' });
	}
	if (flashRaw) {
		items.push({ label: '플래시', value: formatFlash(flashRaw), tooltip: flashRaw, iconId: 'save-all' });
	}
	items.push({
		label: 'CPU',
		value: cpuRaw ? formatCpu(cpuRaw) : '데이터 없음',
		tooltip: cpuRaw || 'Show CPU Profile 응답 없음',
		iconId: 'pulse',
	});
	for (const reading of temperature.readings) {
		items.push({
			label: `${reading.label} 온도`,
			value: reading.celsius === null ? `${reading.reportedCelsius.toFixed(1)}°C 반환 · 센서 지원 미확인` : `${reading.celsius.toFixed(1)}°C`,
			tooltip: `${PROBE_TEMPERATURE_CMD} · ${new Date(temperature.sampledAt).toLocaleTimeString()}\n${reading.note ?? '과열 여부는 모델별 허용 온도와 함께 확인하세요.'}\n${temperature.raw}`,
			iconId: 'dashboard',
		});
	}
	if (!temperature.readings.length) {
		items.push({ label: '온도', value: temperature.note ?? '미확인', tooltip: temperature.raw, iconId: 'dashboard' });
	}
	return items;
}
