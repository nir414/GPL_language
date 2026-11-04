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
	ResourceSnapshot,
	PROBE_MEMORY_CMD,
	PROBE_NET_TCP_CMD,
	PROBE_NET_MBUF_CMD,
} from './resourceProbes';
import {
	PROBE_POWER_STATE_CMD,
	RobotAxesConfig,
	RobotAxesReading,
	cartesianRobotOf,
	parseDataIdNumbers,
	probeCartesianCmd,
	probeJointAnglesCmd,
	readPowerState,
	readRobotAxesConfig,
} from './robotAxes';

// 자원 프로브 명령/타입은 resourceProbes.ts 가 단일 출처. 기존 호출자 편의로 여기서도 재노출한다.
export { PROBE_MEMORY_CMD, PROBE_NET_TCP_CMD, PROBE_NET_MBUF_CMD } from './resourceProbes';
export type { ResourceSnapshot } from './resourceProbes';

// ── 상태 조회 명령 ───────────────────────────────────────────────
//
// 전원·축 위치·직교 좌표는 읽기 전용 DataID(`pd`)로 읽는다 — 근거와 실측은 robotAxes.ts 머리말.
// (예전 `Execute Controller.PowerEnabled`·`Robot.WhereAngles`·`Robot.Where` 는 4.2K5 실측에서 값을 돌려주지 않았다.)
export { PROBE_POWER_STATE_CMD as PROBE_POWER_CMD, PROBE_ROBOT_TYPES_CMD, probeJointAnglesCmd, probeCartesianCmd } from './robotAxes';
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
	/** 230 Power state 원값과 사람이 읽을 설명(전원 배지 부제). */
	powerState?: { state: number | null; text: string };
	/** 첫 로봇의 축 각도(deg/mm). 빈 배열 = 확인 불가. 로봇 전체는 `robots`. */
	jointAngles: number[];
	/** 로봇별 축 위치·소프트 리밋(3504·16077·16078). */
	robots?: RobotAxesReading[];
	/** 로봇 구성 조회 메모(실패 시). */
	robotsNote?: string;
	/** 직교 좌표 위치. */
	cartesian: CartesianPose;
	/** 직교 좌표를 읽은 로봇 번호. null = kinematics 있는 로봇 없음(조인트 전용 구성). */
	cartesianRobot?: number | null;
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
	/** 로봇 구성(이름·종류·소프트 리밋). 리밋은 NP(전원 Off 에서만 바뀜)라 수동 갱신·재연결·실패 때만 다시 읽는다. */
	private axesConfig?: RobotAxesConfig;

	clear(): void {
		this.targetKey = '';
		this.resources = undefined;
		this.temperature = undefined;
		this.errorCache = undefined;
		this.axesConfig = undefined;
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
			// 재연결 뒤에는 구성을 다시 읽는다(그 사이 재부팅·구성 변경이 있었을 수 있다).
			this.axesConfig = undefined;
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

		// 로봇 구성(저빈도). 실패한 구성은 진단 주기마다 다시 시도한다.
		if (!this.axesConfig || options.forceDiagnostics === true || (this.axesConfig.note !== undefined && due(this.axesConfig.sampledAt))) {
			this.axesConfig = await readRobotAxesConfig({ send, succeeded }, io.now());
		}
		const config = this.axesConfig;

		// 명령마다 기다려 다른 UI·디버그 명령이 큐에 들어올 여지를 둔다.
		const powerRaw = await send(PROBE_POWER_STATE_CMD);
		const power = readPowerState(succeeded(powerRaw) ? powerRaw : null);
		snapshot.powerEnabled = power.enabled;
		snapshot.powerState = { state: power.state, text: power.text };

		// 로봇별 실측 조인트 위치(3504)
		const robots: RobotAxesReading[] = [];
		for (const r of config.robots) {
			const raw = await send(probeJointAnglesCmd(r.robot));
			const nums = succeeded(raw) ? parseDataIdNumbers(raw) : null;
			robots.push({
				robot: r.robot, name: r.name, type: r.type, limits: r.limits,
				angles: nums ? nums.filter((n): n is number => n !== null) : [],
				...(!nums ? { note: raw ? `조회 실패 STATUS ${parseStatus(raw).code}` : '응답 없음' } : {}),
			});
		}
		snapshot.robots = robots;
		snapshot.jointAngles = robots[0]?.angles.slice() ?? [];
		if (config.note) { snapshot.robotsNote = config.note; }

		// 직교 좌표(3506: X, Y, Z, Yaw, Pitch, Roll) — kinematics 가 있는 첫 로봇
		const cartRobot = cartesianRobotOf(config);
		snapshot.cartesianRobot = cartRobot;
		if (cartRobot !== null) {
			const cartResp = await send(probeCartesianCmd(cartRobot));
			const nums = succeeded(cartResp) ? parseDataIdNumbers(cartResp) : null;
			if (nums && nums.length >= 1) {
				snapshot.cartesian = {
					x: nums[0] ?? null, y: nums[1] ?? null, z: nums[2] ?? null,
					yaw: nums[3] ?? null, pitch: nums[4] ?? null, roll: nums[5] ?? null,
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
