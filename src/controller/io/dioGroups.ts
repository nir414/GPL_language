/**
 * DIO 신호 번호 → 제어기 웹 Operator 의 I/O 패널 분류(Local I/O · Remote I/O)를 정하는 순수 규칙.
 *
 * 문서상 신호 번호 체계 (Digital Inputs and Outputs,
 * https://www2.brooksautomation.com/Controller_Software/Introduction_To_The_Software/Communications/com_dio.htm):
 *   - 96점 단위 bank, 번호 = base + 100*bank
 *   - General outputs 1 / inputs 10001 — bank 0 = 로컬, 1~15 = RIO·MODBUS/TCP 모듈
 *   - Dedicated outputs 8001 / inputs 18001 — bank 0 = 제어기, 1~15 = 축(axis)
 *   - Software I/O 20001~20064 (웹 패널 "Soft Internal DIO")
 *   - 서보 네트워크 node n(2~): 위 번호 + 100000*n
 * RIO 유닛 번호와 bank 의 대응(유닛 n = 출력 n01~n96 / 입력 10n01~10n96)은
 * https://www2.brooksautomation.com/Controller_Software/Introduction_To_The_Software/Communications/com_rdio.htm
 *
 * 실측(2026-10-27, G2400C GPL 4.2K5): 인자 없는 `Show DIO` 는 Software I/O(20001~)를 내주지 않는다 —
 * 그래서 대시보드는 Soft 신호를 번호를 지정해 따로 조회한다(`buildShowDioCommands`).
 *
 * Soft 범위는 64개가 실제 상한이다(2026-11-04 실측, 같은 장비): `Signal.DIO(20064)` 는 값을 돌려주고
 * `Signal.DIO(20065)`·`(21000)` 은 `-1517 *Invalid signal number*`, `Show DIO 20065` 는 빈 응답.
 * PDB DataID 505(https://www2.brooksautomation.com/Controller_Software/Software_Reference/PDB/Controller_Settings/io.htm)
 * 는 "20001 ~ 21000" 이라 쓰고 `pd 505, 2..16` 도 64개씩 "configured"(&H02) 를 돌려주지만(17 부터 -1509),
 * 그 번호로는 신호에 접근할 수 없다 — 문서의 표(com_dio.htm, 20001~20064)와 실측을 따른다.
 */

import { DioSignalState } from './dio';

export type DioSection = 'local' | 'remote';
export type DioDirection = 'input' | 'output';

export interface DioGroupInfo {
	id: string;
	section: DioSection;
	title: string;
	/** 번호 범위·출처 설명(툴팁). */
	detail: string;
	/** 같은 section 안의 표시 순서. */
	order: number;
}

export interface DioSignalClass {
	group: DioGroupInfo;
	direction: DioDirection;
}

export interface DioViewSignal extends DioSignalState {
	direction: DioDirection;
}

export interface DioGroupView extends DioGroupInfo {
	signals: DioViewSignal[];
	on: number;
	forced: number;
}

const BANK_SIZE = 96;
const MAX_BANK = 15;

export const SOFT_DIO_FIRST = 20001;
export const SOFT_DIO_LAST = 20064;
export const SOFT_DIO_SIGNALS: readonly number[] = Array.from({ length: SOFT_DIO_LAST - SOFT_DIO_FIRST + 1 }, (_, i) => SOFT_DIO_FIRST + i);

/**
 * 웹 Operator 의 Remote I/O 메뉴가 늘 나열하는 그룹(RIO 1~4, Network Node 2~8).
 * 신호가 없으면 대시보드가 "미검출"로 보여 준다 — 없는 이유를 화면에서 바로 알 수 있게.
 */
export const STANDARD_REMOTE_GROUPS: readonly DioGroupInfo[] = [
	...[1, 2, 3, 4].map(rioGroup),
	...[2, 3, 4, 5, 6, 7, 8].map(nodeGroup),
];

/**
 * 한 줄 명령 길이 상한. 실측(2026-10-27): 24개(152자)는 성공, 64개(392자)는 `-506 *Input too long*`.
 * 경계를 모르므로 성공이 확인된 길이 근처로 둔다.
 */
export const SHOW_DIO_MAX_COMMAND_LENGTH = 160;

const LOCAL_GROUP: DioGroupInfo = {
	id: 'local', section: 'local', title: 'Digital I/O', order: 10,
	detail: '로컬 general I/O — 출력 1~96 · 입력 10001~10096 (bank 0)',
};
const SOFT_GROUP: DioGroupInfo = {
	id: 'soft', section: 'local', title: 'Soft Internal DIO', order: 20,
	detail: 'Software I/O 20001~20064 — 하드웨어와 무관한 내부 레지스터(스레드 간 세마포어 등)',
};
const DEDICATED_GROUP: DioGroupInfo = {
	id: 'dedicated', section: 'local', title: 'Dedicated I/O — Controller', order: 30,
	detail: '제어기 전용(dedicated) I/O — 출력 8001~8096 · 입력 18001~18096 (bank 0)',
};
const OTHER_GROUP: DioGroupInfo = {
	id: 'other', section: 'local', title: '기타 신호', order: 900,
	detail: '문서의 신호 번호 범위에 들지 않는 번호',
};

function axisGroup(axis: number): DioGroupInfo {
	return {
		id: `axis-${axis}`, section: 'local', title: `Dedicated I/O — Axis ${axis}`, order: 40 + axis,
		detail: `축 ${axis} 전용 I/O — 출력 ${8001 + 100 * axis}~${8096 + 100 * axis} · 입력 ${18001 + 100 * axis}~${18096 + 100 * axis}`,
	};
}

function rioGroup(unit: number): DioGroupInfo {
	return {
		id: `rio-${unit}`, section: 'remote', title: `RIO ${unit}`, order: 100 + unit,
		detail: `RIO·MODBUS/TCP 유닛 ${unit} — 출력 ${100 * unit + 1}~${100 * unit + BANK_SIZE} · 입력 ${10001 + 100 * unit}~${10000 + 100 * unit + BANK_SIZE}`,
	};
}

function nodeGroup(node: number): DioGroupInfo {
	return {
		id: `node-${node}`, section: 'remote', title: `Network Node ${node} I/O`, order: 200 + node,
		detail: `서보 네트워크 slave node ${node} — 신호 번호 + ${100000 * node} (dedicated I/O 는 master 에서 접근 불가)`,
	};
}

/** base 기준 bank 번호(0~15)를 구한다. bank 안의 97~100번째 자리면 undefined. */
function bankOf(value: number, base: number): number | undefined {
	const offset = value - base;
	if (offset < 0) { return undefined; }
	const bank = Math.floor(offset / 100);
	return bank <= MAX_BANK && offset % 100 < BANK_SIZE ? bank : undefined;
}

export function classifyDioSignal(signal: number): DioSignalClass {
	const node = Math.floor(signal / 100000);
	const rest = signal % 100000;
	if (node >= 2) {
		return { group: nodeGroup(node), direction: rest >= 10001 ? 'input' : 'output' };
	}
	if (node === 0) {
		if (rest >= SOFT_DIO_FIRST && rest <= SOFT_DIO_LAST) {
			// 문서는 Software I/O 의 입출력 구분을 두지 않는다 — 웹 패널처럼 한 줄로 보이도록 output 으로 묶는다.
			return { group: SOFT_GROUP, direction: 'output' };
		}
		const ranges: Array<{ base: number; direction: DioDirection; dedicated: boolean }> = [
			{ base: 18001, direction: 'input', dedicated: true },
			{ base: 10001, direction: 'input', dedicated: false },
			{ base: 8001, direction: 'output', dedicated: true },
			{ base: 1, direction: 'output', dedicated: false },
		];
		for (const range of ranges) {
			if (rest < range.base) { continue; }
			const bank = bankOf(rest, range.base);
			if (bank === undefined) { break; }
			const group = range.dedicated
				? (bank === 0 ? DEDICATED_GROUP : axisGroup(bank))
				: (bank === 0 ? LOCAL_GROUP : rioGroup(bank));
			return { group, direction: range.direction };
		}
	}
	return { group: OTHER_GROUP, direction: signal % 100000 >= 10001 ? 'input' : 'output' };
}

/** 신호 목록을 section·그룹 순서로 묶는다. 그룹 안은 입력 → 출력, 번호순. */
export function groupDioSignals(signals: readonly DioSignalState[]): DioGroupView[] {
	const groups = new Map<string, DioGroupView>();
	for (const item of signals) {
		const { group, direction } = classifyDioSignal(item.signal);
		let view = groups.get(group.id);
		if (!view) {
			view = { ...group, signals: [], on: 0, forced: 0 };
			groups.set(group.id, view);
		}
		view.signals.push({ ...item, direction });
		if (item.on) { view.on++; }
		if (item.forced) { view.forced++; }
	}
	const sectionRank = (s: DioSection) => (s === 'local' ? 0 : 1);
	const dirRank = (d: DioDirection) => (d === 'input' ? 0 : 1);
	return [...groups.values()]
		.map(view => ({ ...view, signals: view.signals.sort((a, b) => dirRank(a.direction) - dirRank(b.direction) || a.signal - b.signal) }))
		.sort((a, b) => sectionRank(a.section) - sectionRank(b.section) || a.order - b.order);
}

/** 신호 목록을 명령 길이 상한 안에서 `Show DIO a,b,...` 여러 줄로 나눈다. */
export function buildShowDioCommands(signals: readonly number[], maxLength = SHOW_DIO_MAX_COMMAND_LENGTH): string[] {
	const commands: string[] = [];
	let current: number[] = [];
	const render = (list: number[]) => `Show DIO ${list.join(',')}`;
	for (const signal of signals) {
		if (!Number.isSafeInteger(signal) || signal <= 0) { continue; }
		if (current.length > 0 && render([...current, signal]).length > maxLength) {
			commands.push(render(current));
			current = [];
		}
		current.push(signal);
	}
	if (current.length > 0) { commands.push(render(current)); }
	return commands;
}

/** 칩 클릭 토글: 지금 값의 반대로 강제한다(ON → 강제 OFF, OFF → 강제 ON). */
export function toggleForceValue(state: Pick<DioSignalState, 'on'>): 1 | -1 {
	return state.on ? -1 : 1;
}

/** 강제 해제 대상: 강제된 신호 번호(그룹 id 를 주면 그 그룹만). */
export function forcedSignalsFor(signals: readonly DioSignalState[], groupId?: string): number[] {
	return signals
		.filter(item => item.forced && (groupId === undefined || classifyDioSignal(item.signal).group.id === groupId))
		.map(item => item.signal)
		.sort((a, b) => a - b);
}
