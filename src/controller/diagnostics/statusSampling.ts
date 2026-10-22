import { parseTemperatureResponse, TemperatureSnapshot } from './temperature';
import { PROBE_TEMPERATURE_CMD } from './temperature';
import {
	parseThreadList,
	parseErrorLog,
	parseStatus,
	NO_STATUS_CODE,
	SHOW_THREAD_LIST_CMD,
	ThreadInfo,
} from '../protocol/responseParser';
import { countThreadStates } from '../threads/threadReport';
import {
	buildResourceSnapshot,
	extractDataPayload,
	ResourceSnapshot,
	PROBE_MEMORY_CMD,
	PROBE_NET_TCP_CMD,
	PROBE_NET_MBUF_CMD,
} from './resourceProbes';

// 자원 프로브 명령/타입은 resourceProbes.ts 가 단일 출처. 기존 호출자 편의로 여기서도 재노출한다.
export { PROBE_MEMORY_CMD, PROBE_NET_TCP_CMD, PROBE_NET_MBUF_CMD } from './resourceProbes';
export type { ResourceSnapshot } from './resourceProbes';

// ── 상태 조회 명령 ───────────────────────────────────────────────
//
// Controller.PowerEnabled: 고전원(모터 전원) 상태. read 시 ON/OFF 반환.
//   공식 문서: GPL Dictionary > Controller.PowerEnabled Property
// Robot.WhereAngles: 각 모터 인코더 순간값 → 축 각도(Angles Location).
// Robot.Where: 베이스/툴 보정 반영한 현재 직교 좌표 위치.
export const PROBE_POWER_CMD = 'Execute Controller.PowerEnabled';
export const PROBE_ANGLES_CMD = 'Execute Robot.WhereAngles';
export const PROBE_CART_CMD = 'Execute Robot.Where';
export const PROBE_ERRORLOG_CMD = 'ErrorLog -web ,10';


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
	threadsAvailable?: boolean;
	/** 스레드 상태 요약. */
	threadSummary: { running: number; paused: number; idle: number; error: number; total: number };
	/** 에러 로그(최신 우선, 원문). */
	errors: string[];
	/** 사람이 읽을 수 있는 마지막 메모(디버그용). */
	note?: string;
	/**
	 * 제어기 자원 지표(Show Memory / Show Network -tcp / -mbuf). `includeResources` 옵션으로 요청했을
	 * 때만 채워진다(GitHub #22 — TCP 자원 고갈 가설 검증용 시계열 재료). 파싱 실패 항목은 null + raw.
	 */
	resources?: ResourceSnapshot;
	temperature?: TemperatureSnapshot;
	errorsSampledAt?: number;
	errorsNote?: string;
}

export interface FetchStatusOptions {
	/**
	 * true면 자원 프로브 3명령을 저빈도 조회에 포함한다. 기본 false.
	 */
	includeResources?: boolean;
	includeTemperature?: boolean;
	/** 과거 에러·자원·온도의 조회 간격. 수동 갱신은 간격을 무시한다. */
	diagnosticIntervalMs?: number;
	forceDiagnostics?: boolean;
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

/** 통신이 성립하지 않은 상태의 빈 스냅샷 — 폴링 실패와 "연결 해제라 조회하지 않음"(대시보드)이 같은 모양을 쓴다. */
export function emptyControllerStatusSnapshot(target: { ip: string; port: number }, note?: string): ControllerStatusSnapshot {
	return {
		connected: false,
		timestamp: Date.now(),
		target: { ip: target.ip, port: target.port },
		powerEnabled: null,
		jointAngles: [],
		cartesian: { ...EMPTY_CART },
		threads: [],
		threadsAvailable: false,
		threadSummary: { running: 0, paused: 0, idle: 0, error: 0, total: 0 },
		errors: [],
		...(note !== undefined ? { note } : {}),
	};
}

export interface StatusSamplerIO {
	send(command: string): Promise<string | null>;
	now(): number;
	/** 해제·대상 전환·탭 숨김 뒤에는 다음 명령을 보내지 않는다. */
	isActive?(): boolean;
}

export const DEFAULT_DIAGNOSTIC_INTERVAL_MS = 10000;

function succeeded(raw: string | null): raw is string {
	return !!raw && /<\/STATUS>\s*$/i.test(raw) && parseStatus(raw).code === 0;
}

/** 대시보드별 캐시 소유자. 빠른 상태와 저빈도 진단을 분리하고 대상 전환 시 캐시를 폐기한다. */
export class ControllerStatusSampler {
	private targetKey = '';
	private resources?: ResourceSnapshot;
	private temperature?: TemperatureSnapshot;
	private errorCache?: { values: string[]; sampledAt: number; note?: string };

	clear(): void {
		this.targetKey = '';
		this.resources = undefined;
		this.temperature = undefined;
		this.errorCache = undefined;
	}

	async sample(
		cfg: { ip: string; port: number }, io: StatusSamplerIO, options: FetchStatusOptions = {},
	): Promise<ControllerStatusSnapshot> {
		const key = `${cfg.ip}:${cfg.port}`;
		if (key !== this.targetKey) { this.clear(); this.targetKey = key; }
		const snapshot = emptyControllerStatusSnapshot(cfg);
		snapshot.timestamp = io.now();
		const interval = Math.max(0, options.diagnosticIntervalMs ?? DEFAULT_DIAGNOSTIC_INTERVAL_MS);
		const due = (at: number | undefined): boolean => options.forceDiagnostics === true || at === undefined || io.now() - at >= interval;
		const send = async (command: string): Promise<string | null> => {
			if (io.isActive?.() === false) { throw new Error('상태 조회 취소됨'); }
			const raw = await io.send(command);
			if (io.isActive?.() === false) { throw new Error('상태 조회 취소됨'); }
			return raw;
		};

		// 1) 스레드 목록 — 통신 성립 여부의 기준으로도 사용.
		const threadResp = await send(SHOW_THREAD_LIST_CMD);
		if (threadResp && /<\/STATUS>\s*$/i.test(threadResp) && parseStatus(threadResp).code !== NO_STATUS_CODE) {
			snapshot.connected = true;
			if (succeeded(threadResp)) {
				snapshot.threads = parseThreadList(threadResp);
				snapshot.threadsAvailable = true;
			} else {
				snapshot.note = `쓰레드 조회 실패 STATUS ${parseStatus(threadResp).code}`;
			}
		}

		if (!snapshot.connected) {
			snapshot.note = '제어기 응답 없음';
			return snapshot;
		}

		// 스레드 요약 — 상태 집계는 공용 정본(threadReport.countThreadStates)이 한다.
		// 패널 요약·상황 스냅샷·MCP `controller_status` 가 같은 기준으로 세야 `Break` 같은
		// 상태 하나가 한쪽에서만 정지로 잡히는 일이 없다.
		const t = snapshot.threads;
		const counts = countThreadStates(t);
		snapshot.threadSummary = {
			running: counts.running,
			paused: counts.paused,
			idle: counts.idle,
			error: counts.errCount,
			total: t.length,
		};

		// 명령마다 기다려 다른 UI·디버그 명령이 큐에 들어올 여지를 둔다.
		const powerResp = await send(PROBE_POWER_CMD);
		const anglesResp = await send(PROBE_ANGLES_CMD);
		const cartResp = await send(PROBE_CART_CMD);

		// 전원
		if (succeeded(powerResp)) {
			snapshot.powerEnabled = parsePowerEnabled(powerResp);
		}

		// 축 각도
		if (succeeded(anglesResp)) {
			const nums = extractNumbers(extractDataPayload(anglesResp));
			// 직교 표현이 섞여 나올 수 있으므로 과도하게 많으면 앞쪽만 사용.
			snapshot.jointAngles = nums.slice(0, 12);
		}

		// 직교 좌표 (X, Y, Z, Yaw, Pitch, Roll 순서 가정)
		if (succeeded(cartResp)) {
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

		// 실패한 최신 조회도 시각과 빈 값을 기록해 이전 성공을 현재값처럼 보여 주지 않는다.
		if (due(this.errorCache?.sampledAt)) {
			const raw = await send(PROBE_ERRORLOG_CMD);
			this.errorCache = {
				values: succeeded(raw) ? parseErrorLog(raw).slice(0, 20) : [], sampledAt: io.now(),
				...(!succeeded(raw) ? { note: '에러 로그 조회 실패 — 현재 오류 유무 미확인' } : {}),
			};
		}
		snapshot.errors = this.errorCache?.values.slice() ?? [];
		snapshot.errorsSampledAt = this.errorCache?.sampledAt;
		snapshot.errorsNote = this.errorCache?.note;

		// 온도는 자원 지표 설정과 독립적으로 조회한다.
		if (options.includeTemperature && due(this.temperature?.sampledAt)) {
			this.temperature = parseTemperatureResponse(await send(PROBE_TEMPERATURE_CMD), io.now());
		}
		if (options.includeTemperature) { snapshot.temperature = this.temperature; }

		if (options.includeResources && due(this.resources?.sampledAt)) {
			const memory = await send(PROBE_MEMORY_CMD);
			const tcp = await send(PROBE_NET_TCP_CMD);
			const mbuf = await send(PROBE_NET_MBUF_CMD);
			this.resources = buildResourceSnapshot({ memory, tcp, mbuf }, io.now());
			// 기존 자원 파서의 부분 응답 허용을 실시간 화면에서는 사용하지 않는다.
			if (!succeeded(memory)) { this.resources.memory = null; }
			if (!succeeded(tcp)) { this.resources.tcp = null; }
			if (!succeeded(mbuf)) { this.resources.mbuf = null; }
		}
		if (options.includeResources) { snapshot.resources = this.resources; }
		snapshot.timestamp = io.now();
		return snapshot;
	}
}
