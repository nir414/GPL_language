import { extractDataPayload } from './resourceProbes';

// ── 로봇 축 위치·소프트 리밋·전원 상태를 파라미터 DB(`pd`)로 읽는다 ─────────────────
//
// 대시보드는 예전에 `Execute Robot.WhereAngles` 같은 Execute 를 썼다. 실측(2026-11-04, GPL 4.2K5)에서
// Execute 는 식의 값을 돌려주지 않고(STATUS 0 · DATA 없음) `Execute Controller.PowerEnabled` 는 -712 였다.
// 게다가 Execute 는 `_Cmd_<project>` 쓰레드를 만들어 Unload 를 막은 보고가 있다(ai-handoff §3).
// 그래서 읽기 전용(RO) DataID 로 바꾼다 — 로드된 프로젝트도, 쓰레드도 필요 없다.
//
// 문서상 근거(Brooks PDB):
//   116   Robot types (MAX_ROBOT, 0 = 목록 끝, 1 = 조인트만·Cartesian 불가, 7 = 엔코더 전용)
//         https://www2.brooksautomation.com/Controller_Software/Software_Reference/PDB/Controller_Settings/system%20identification.htm
//   230   Power state (RO, 0~7 꺼짐 계열, 8~12 켜짐 계열)
//         https://www2.brooksautomation.com/Controller_Software/Software_Reference/PDB/Controller_Settings/operationmodes.htm
//   2002  Robot name
//         https://www2.brooksautomation.com/Controller_Software/Software_Reference/PDB/Robot_Cfg/Joint_Cartesian_Control/basic_parameters.htm
//   3504  Actual joint angles in deg or mm (RO, MAX_AXIS) · 3506 Actual Cartesian position (RO, X Y Z Yaw Pitch Roll)
//         https://www2.brooksautomation.com/Controller_Software/Software_Reference/PDB/Robot_Cfg/Joint_Cartesian_Control/datalogging.htm
//   16077 Joint max soft stop limit · 16078 Joint min soft stop limit (NP, MAX_AXIS)
//         https://www2.brooksautomation.com/Controller_Software/Software_Reference/PDB/Robot_Cfg/Robot_Calibration/stop_limits.htm
// 실측 응답 형식: `3504, 5, 1, 0, "Actual joint angles in deg or mm" = 7.5` (두 번째 값이 unit = 로봇 번호).
// 없는 로봇은 `-1001 *Undefined robot*`, 없는 unit 의 리밋은 `-1509 *Invalid data index*`.

export const DATAID_ROBOT_TYPES = 116;
export const DATAID_POWER_STATE = 230;
export const DATAID_ROBOT_NAME = 2002;
export const DATAID_JOINT_ACTUAL = 3504;
export const DATAID_CARTESIAN_ACTUAL = 3506;
export const DATAID_JOINT_MAX_SOFT = 16077;
export const DATAID_JOINT_MIN_SOFT = 16078;

/** 컨트롤러 전역 DataID 는 unit 없이, 로봇별 DataID 는 `pd <id>, <robot>` 으로 읽는다. */
export function pdCommand(id: number, robot?: number): string {
	return robot === undefined ? `pd ${id}` : `pd ${id}, ${robot}`;
}

export const PROBE_ROBOT_TYPES_CMD = pdCommand(DATAID_ROBOT_TYPES);
export const PROBE_POWER_STATE_CMD = pdCommand(DATAID_POWER_STATE);
export const probeJointAnglesCmd = (robot: number): string => pdCommand(DATAID_JOINT_ACTUAL, robot);
export const probeCartesianCmd = (robot: number): string => pdCommand(DATAID_CARTESIAN_ACTUAL, robot);

/** 소프트 리밋 값이 이보다 크면 '사실상 무제한'(연속 회전축 등)으로 보고 게이지 기준에서 뺀다. */
export const UNBOUNDED_LIMIT = 1e6;

/**
 * `pd` 응답 본문에서 `=` 뒤 값 토큰을 돌려준다(따옴표 안의 콤마·`=` 는 무시, 줄바꿈 wrap 허용).
 * 형식이 아니면 null.
 */
export function parseDataIdValues(raw: string | null): string[] | null {
	if (!raw) { return null; }
	const body = extractDataPayload(raw).replace(/\r?\n\s*/g, ' ').trim();
	let inQuote = false;
	let eq = -1;
	for (let i = 0; i < body.length; i++) {
		const ch = body[i];
		if (ch === '"') { inQuote = !inQuote; } else if (ch === '=' && !inQuote) { eq = i; break; }
	}
	if (eq < 0 || !/^\s*-?\d+\s*,/.test(body.slice(0, eq))) { return null; }
	const values: string[] = [];
	let cur = '';
	inQuote = false;
	for (const ch of body.slice(eq + 1)) {
		if (ch === '"') { inQuote = !inQuote; cur += ch; continue; }
		if (ch === ',' && !inQuote) { values.push(cur.trim()); cur = ''; continue; }
		cur += ch;
	}
	if (cur.trim() !== '' || values.length > 0) { values.push(cur.trim()); }
	while (values.length && values[values.length - 1] === '') { values.pop(); }
	return values;
}

/** 숫자 값 목록. 숫자가 아닌 토큰은 null 로 남겨 축 번호(인덱스)가 밀리지 않게 한다. */
export function parseDataIdNumbers(raw: string | null): Array<number | null> | null {
	const values = parseDataIdValues(raw);
	if (!values) { return null; }
	return values.map(v => {
		const n = Number(v);
		return v !== '' && Number.isFinite(n) ? n : null;
	});
}

/** 따옴표로 감싼 문자열 값 하나(로봇 이름 등). */
export function parseDataIdString(raw: string | null): string | null {
	const first = parseDataIdValues(raw)?.[0];
	if (first === undefined) { return null; }
	const m = /^"([\s\S]*)"$/.exec(first);
	const text = (m ? m[1].replace(/""/g, '"') : first).trim();
	return text === '' ? null : text;
}

/** 116 Robot types → 연속된 로봇 목록(0 이 끝). */
export function robotsFromTypes(types: Array<number | null>): Array<{ robot: number; type: number }> {
	const robots: Array<{ robot: number; type: number }> = [];
	for (let i = 0; i < types.length; i++) {
		const type = types[i];
		if (type === null || type === 0) { break; }
		robots.push({ robot: i + 1, type });
	}
	return robots;
}

/** 문서상 type 1(조인트만)·7(엔코더 전용)은 Cartesian 좌표가 없다. 모르면(null) 있다고 보고 읽어 본다. */
export function robotHasCartesian(type: number | null): boolean {
	return type !== 1 && type !== 7 && type !== 0;
}

export interface JointLimit {
	min: number | null;
	max: number | null;
}

/** 축별 소프트 리밋. 둘 다 유한하고 max > min 이며 '무제한' 크기가 아닐 때만 쓴다. */
export function normalizeLimits(max: Array<number | null> | null, min: Array<number | null> | null): JointLimit[] {
	const count = Math.max(max?.length ?? 0, min?.length ?? 0);
	const out: JointLimit[] = [];
	for (let i = 0; i < count; i++) {
		const hi = max?.[i] ?? null;
		const lo = min?.[i] ?? null;
		const usable = hi !== null && lo !== null && hi > lo && Math.abs(hi) < UNBOUNDED_LIMIT && Math.abs(lo) < UNBOUNDED_LIMIT;
		out.push(usable ? { min: lo, max: hi } : { min: null, max: null });
	}
	return out;
}

const POWER_STATE_TEXT: Record<number, string> = {
	0: '꺼짐 · 시작 초기화',
	1: '꺼짐 · 치명 오류',
	2: '꺼짐 · 오류 후 재시작',
	3: '끄는 중',
	4: '끄는 중 · 오류',
	5: '꺼짐 · 오류 발생',
	6: '꺼짐 · CANopen 전원 요청 해제 대기',
	7: '꺼짐 · 전원 요청 대기',
	8: '켜는 중 · 앰프 활성화',
	9: '켜는 중 · 커뮤테이션',
	10: '켜는 중 · 서보 활성화·브레이크 해제',
	11: '켜짐 · 자동 모드 대기',
	12: '켜짐 · 자동 모드 실행',
};

export interface PowerStateReading {
	/** 230 Power state 원값. */
	state: number | null;
	/** 켜짐 계열(8~12)이면 true, 꺼짐 계열(0~7)이면 false, 모르면 null. */
	enabled: boolean | null;
	text: string;
}

export function readPowerState(raw: string | null): PowerStateReading {
	const n = parseDataIdNumbers(raw)?.[0] ?? null;
	if (n === null || !Number.isInteger(n)) { return { state: null, enabled: null, text: '조회 실패' }; }
	return { state: n, enabled: n >= 8 ? true : n >= 0 ? false : null, text: POWER_STATE_TEXT[n] ?? `상태 ${n}` };
}

/** 저빈도로 읽어 캐시하는 로봇 구성(이름·종류·리밋). */
export interface RobotAxisConfig {
	robot: number;
	/** 116 의 kinematics 종류. 116 을 못 읽어 로봇 1 을 가정한 경우 null. */
	type: number | null;
	name: string | null;
	limits: JointLimit[];
}

export interface RobotAxesConfig {
	sampledAt: number;
	robots: RobotAxisConfig[];
	/** 구성 조회가 일부라도 실패했으면 그 내용. 있으면 다음 진단 주기에 다시 읽는다. */
	note?: string;
}

/** 폴링마다 보내는 로봇 축 상태. */
export interface RobotAxesReading {
	robot: number;
	name: string | null;
	type: number | null;
	/** 3504 실측 조인트 위치(deg/mm). 조회 실패면 빈 배열. */
	angles: number[];
	limits: JointLimit[];
	note?: string;
}

export interface RobotConfigIO {
	send(command: string): Promise<string | null>;
	succeeded(raw: string | null): raw is string;
}

/** 116 → 로봇별 2002·16077·16078. 116 을 못 읽으면 로봇 1 하나만 가정한다. */
export async function readRobotAxesConfig(io: RobotConfigIO, now: number): Promise<RobotAxesConfig> {
	const notes: string[] = [];
	const typesRaw = await io.send(PROBE_ROBOT_TYPES_CMD);
	const types = io.succeeded(typesRaw) ? parseDataIdNumbers(typesRaw) : null;
	let robots: Array<{ robot: number; type: number | null }> = types ? robotsFromTypes(types) : [];
	if (!types) { notes.push('로봇 구성(116) 조회 실패 — 로봇 1 가정'); }
	if (robots.length === 0) { robots = [{ robot: 1, type: null }]; }
	const out: RobotAxisConfig[] = [];
	for (const { robot, type } of robots) {
		const nameRaw = await io.send(pdCommand(DATAID_ROBOT_NAME, robot));
		const maxRaw = await io.send(pdCommand(DATAID_JOINT_MAX_SOFT, robot));
		const minRaw = await io.send(pdCommand(DATAID_JOINT_MIN_SOFT, robot));
		const max = io.succeeded(maxRaw) ? parseDataIdNumbers(maxRaw) : null;
		const min = io.succeeded(minRaw) ? parseDataIdNumbers(minRaw) : null;
		if (!max || !min) { notes.push(`로봇 ${robot} 소프트 리밋 조회 실패`); }
		out.push({ robot, type, name: io.succeeded(nameRaw) ? parseDataIdString(nameRaw) : null, limits: normalizeLimits(max, min) });
	}
	return { sampledAt: now, robots: out, ...(notes.length ? { note: notes.join(' · ') } : {}) };
}

/** Cartesian 좌표를 읽을 로봇: kinematics 가 있는 첫 로봇. 없으면 null. */
export function cartesianRobotOf(config: RobotAxesConfig | undefined): number | null {
	const robots: Array<{ robot: number; type: number | null }> = config?.robots ?? [{ robot: 1, type: null }];
	return robots.find(r => robotHasCartesian(r.type))?.robot ?? null;
}
