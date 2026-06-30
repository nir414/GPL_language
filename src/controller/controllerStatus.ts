/**
 * 대시보드용 제어기 실시간 상태 수집기.
 *
 * 한 번의 폴링에서 아래 정보를 모아 하나의 스냅샷으로 반환한다.
 *   - 통신 가능 여부(연결 상태)
 *   - 고전원(High Power / 서보) ON/OFF
 *   - 각 축 위치(조인트 각도 + 직교 좌표)
 *   - 스레드 요약 / 에러 로그(기존 파서 재사용)
 *
 * 설계 메모:
 *   위치/전원 값은 콘솔 `Execute <expression>` 응답의 <DATA>에서 숫자를 관대하게
 *   추출한다. 정확한 echo 형식은 실제 제어기에서 확인이 필요하므로(아래 PROBE_CMD
 *   상수만 고치면 됨), 파싱은 실패해도 null을 돌려 UI가 "—"로 표시하도록 했다.
 */

import {
	ControllerConfig,
	getControllerConfig,
	trySendCommand,
} from './controllerConnection';
import {
	parseThreadList,
	parseErrorLog,
	parseStatus,
	SHOW_THREAD_LIST_CMD,
	ThreadInfo,
} from './responseParser';

// ── 프로브 명령 (실제 제어기에서 echo 형식 확인 후 필요 시 조정) ──────────
//
// Controller.PowerEnabled: 고전원(모터 전원) 상태. read 시 ON/OFF 반환.
//   공식 문서: GPL Dictionary > Controller.PowerEnabled Property
// Robot.WhereAngles: 각 모터 인코더 순간값 → 축 각도(Angles Location).
// Robot.Where: 베이스/툴 보정 반영한 현재 직교 좌표 위치.
export const PROBE_POWER_CMD = 'Execute Controller.PowerEnabled';
export const PROBE_ANGLES_CMD = 'Execute Robot.WhereAngles';
export const PROBE_CART_CMD = 'Execute Robot.Where';
export const PROBE_ERRORLOG_CMD = 'ErrorLog -web ,10';

const PROBE_TIMEOUT_MS = 4000;

export interface CartesianPose {
	x: number | null;
	y: number | null;
	z: number | null;
	yaw: number | null;
	pitch: number | null;
	roll: number | null;
}

export interface ControllerStatusSnapshot {
	/** 이번 폴링에서 제어기와 통신이 성립했는지. */
	connected: boolean;
	/** 스냅샷 생성 시각(ms epoch). */
	timestamp: number;
	/** 연결 대상. */
	target: { ip: string; port: number };
	/** 고전원(서보) 상태. null = 확인 불가. */
	powerEnabled: boolean | null;
	/** 축 각도(deg/mm). 빈 배열 = 확인 불가. */
	jointAngles: number[];
	/** 직교 좌표 위치. */
	cartesian: CartesianPose;
	/** 스레드 목록. */
	threads: ThreadInfo[];
	/** 스레드 상태 요약. */
	threadSummary: { running: number; paused: number; idle: number; error: number; total: number };
	/** 에러 로그(최신 우선, 원문). */
	errors: string[];
	/** 사람이 읽을 수 있는 마지막 메모(디버그용). */
	note?: string;
}

/** <DATA>...</DATA> 본문을 추출. 없으면 STATUS 태그만 제거한 원문 반환. */
function extractDataPayload(raw: string): string {
	const m = raw.match(/<DATA>([\s\S]*?)<\/DATA>/i);
	if (m) {
		return m[1];
	}
	return raw.replace(/<STATUS>[\s\S]*?<\/STATUS>/gi, '');
}

/** 부호 있는 십진수(소수/지수 포함)를 모두 추출. */
function extractNumbers(text: string): number[] {
	const matches = text.match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g);
	if (!matches) {
		return [];
	}
	return matches.map(s => parseFloat(s)).filter(n => Number.isFinite(n));
}

/** 전원 응답을 boolean으로 해석. 해석 불가면 null. */
function parsePowerEnabled(raw: string | null): boolean | null {
	if (!raw) {
		return null;
	}
	const payload = extractDataPayload(raw).trim();
	if (/\b(true|on|enabled)\b/i.test(payload)) {
		return true;
	}
	if (/\b(false|off|disabled)\b/i.test(payload)) {
		return false;
	}
	// GPL Boolean은 -1(True) / 0(False)로 표현되는 경우가 있다.
	const nums = extractNumbers(payload);
	if (nums.length > 0) {
		return nums[0] !== 0;
	}
	return null;
}

const EMPTY_CART: CartesianPose = {
	x: null, y: null, z: null, yaw: null, pitch: null, roll: null,
};

/** 한 번의 폴링으로 전체 상태 스냅샷을 수집한다. */
export async function fetchControllerStatus(
	config?: Partial<ControllerConfig>,
): Promise<ControllerStatusSnapshot> {
	const cfg = { ...getControllerConfig(), ...(config ?? {}) };
	const snapshot: ControllerStatusSnapshot = {
		connected: false,
		timestamp: Date.now(),
		target: { ip: cfg.ip, port: cfg.port },
		powerEnabled: null,
		jointAngles: [],
		cartesian: { ...EMPTY_CART },
		threads: [],
		threadSummary: { running: 0, paused: 0, idle: 0, error: 0, total: 0 },
		errors: [],
	};

	// 1) 스레드 목록 — 통신 성립 여부의 기준으로도 사용.
	const threadResp = await trySendCommand(SHOW_THREAD_LIST_CMD, cfg, PROBE_TIMEOUT_MS);
	if (threadResp && threadResp.includes('<STATUS>')) {
		snapshot.connected = true;
		try {
			snapshot.threads = parseThreadList(threadResp);
		} catch {
			snapshot.threads = [];
		}
	}

	if (!snapshot.connected) {
		snapshot.note = '제어기 응답 없음';
		return snapshot;
	}

	// 스레드 요약
	const t = snapshot.threads;
	snapshot.threadSummary = {
		running: t.filter(x => x.state === 'Running').length,
		paused: t.filter(x => x.state === 'Paused' || x.state === 'Break').length,
		idle: t.filter(x => x.state === 'Idle').length,
		error: t.filter(x => x.state === 'Error').length,
		total: t.length,
	};

	// 2) 전원 / 각도 / 직교 좌표 / 에러 로그 — 병렬 수집(명령 큐가 직렬화함).
	const [powerResp, anglesResp, cartResp, errorResp] = await Promise.all([
		trySendCommand(PROBE_POWER_CMD, cfg, PROBE_TIMEOUT_MS),
		trySendCommand(PROBE_ANGLES_CMD, cfg, PROBE_TIMEOUT_MS),
		trySendCommand(PROBE_CART_CMD, cfg, PROBE_TIMEOUT_MS),
		trySendCommand(PROBE_ERRORLOG_CMD, cfg, PROBE_TIMEOUT_MS),
	]);

	// 전원
	if (powerResp && parseStatus(powerResp).code === 0) {
		snapshot.powerEnabled = parsePowerEnabled(powerResp);
	}

	// 축 각도
	if (anglesResp && parseStatus(anglesResp).code === 0) {
		const nums = extractNumbers(extractDataPayload(anglesResp));
		// 직교 표현이 섞여 나올 수 있으므로 과도하게 많으면 앞쪽만 사용.
		snapshot.jointAngles = nums.slice(0, 12);
	}

	// 직교 좌표 (X, Y, Z, Yaw, Pitch, Roll 순서 가정)
	if (cartResp && parseStatus(cartResp).code === 0) {
		const nums = extractNumbers(extractDataPayload(cartResp));
		if (nums.length >= 1) {
			snapshot.cartesian = {
				x: nums[0] ?? null,
				y: nums[1] ?? null,
				z: nums[2] ?? null,
				yaw: nums[3] ?? null,
				pitch: nums[4] ?? null,
				roll: nums[5] ?? null,
			};
		}
	}

	// 에러 로그
	if (errorResp) {
		try {
			snapshot.errors = parseErrorLog(errorResp).slice(0, 20);
		} catch {
			snapshot.errors = [];
		}
	}

	return snapshot;
}
