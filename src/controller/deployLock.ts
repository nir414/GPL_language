/**
 * 배포 잠금(Deploy Lock) — 업로드/배포 크리티컬 섹션의 상호 배제.
 *
 * 왜 파일인가: 구 `deployInFlight` boolean은 한 VS Code 창의 확장 인스턴스 안에서만 유효했다.
 * "FTP 업로드 도중 Compile/Start가 겹치면 제어기가 죽는다"(2026-08-20 사용자 관찰, 이슈 #17)는
 * 다른 VS Code 창·controller-mcp(별도 node 프로세스) 어디서든 일으킬 수 있으므로, 같은 PC의 모든
 * 프로세스가 볼 수 있는 잠금 파일 `%TEMP%/gpl-controller/<ip>.lock.json`로 조정한다.
 * ※ 이 파일은 로그가 아니라 조정 프리미티브다 — 제어기 상태 판단에는 쓰지 않는다(하드 규칙 1과 무관).
 *
 * 레코드에 owner/stage/since를 담아 "왜 잡혀 있는지"를 경고에 보여 주고(이슈 #15),
 * pid/heartbeat로 죽은 보유자는 자동 만료시킨다(강제 해제 버튼을 두지 않는 근거).
 *
 * 파일 계약 — controller-mcp/src/deployLock.js(읽기 전용 구현)와 반드시 동일하게 유지:
 *   { "version": 1, "owner": string, "stage": string, "since": ms, "heartbeat": ms, "pid": number, "host": string }
 *   stale = (pid > 0 && 프로세스 없음) || now - heartbeat > DEPLOY_LOCK_STALE_MS
 *   획득 = O_EXCL 생성('wx'); 갱신 = 임시 파일 + rename(원자적); 해제 = 자기 레코드(pid·since 일치)일 때만 삭제.
 *
 * vscode에 의존하지 않는다(단위 테스트 가능: src/test/deployLock.test.ts).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const DEPLOY_LOCK_VERSION = 1;
/** heartbeat가 이 시간 이상 갱신되지 않으면 보유자가 죽은 것으로 본다. */
export const DEPLOY_LOCK_STALE_MS = 30_000;
/** 보유 중 heartbeat 갱신 주기. STALE_MS보다 충분히 짧아야 한다. */
export const DEPLOY_LOCK_HEARTBEAT_MS = 5_000;
export const DEPLOY_LOCK_DIR_NAME = 'gpl-controller';

export interface DeployLockRecord {
	version: number;
	/** 누가: 'Deploy' | 'Quick Compile' | 'autoOnSave Quick Compile' | 'Save to Flash' | 'F5 Deploy' 등 */
	owner: string;
	/** 어느 단계: deploy() 단계 배너와 같은 라벨(UPLOAD/STOP/THREAD_CHECK/COMPILE/…) 또는 FTP_MIRROR/PREPARE */
	stage: string;
	/** 획득 시각(ms) */
	since: number;
	/** 마지막 생존 신호(ms) */
	heartbeat: number;
	pid: number;
	host: string;
}

export interface DeployLockHandle {
	/** 현재 레코드(단계 갱신이 반영되는 참조) */
	readonly record: Readonly<DeployLockRecord>;
	readonly released: boolean;
	/** 단계 라벨 갱신(+heartbeat). 파일에도 즉시 반영된다. */
	setStage(stage: string): void;
	/** 생존 신호 갱신. 긴 업로드의 진행 콜백에서 호출하면 타이머와 무관하게 신선도가 유지된다. */
	heartbeat(): void;
	/** 해제(멱등). 자기 레코드일 때만 파일을 지운다 — 뒤늦은 finally가 새 보유자를 지우지 않도록. */
	release(): void;
}

export type DeployLockAcquireResult =
	| { ok: true; handle: DeployLockHandle }
	| { ok: false; holder: DeployLockRecord; local: boolean };

/** 테스트/특수 환경용 주입점. 운영 코드는 기본값을 쓴다. */
export interface DeployLockEnv {
	dir?: string;
	now?: () => number;
	pid?: number;
	host?: string;
	pidAlive?: (pid: number) => boolean;
	/** 0이면 heartbeat 타이머를 돌리지 않는다(테스트). */
	heartbeatIntervalMs?: number;
	staleMs?: number;
}

export function defaultDeployLockDir(): string {
	return path.join(os.tmpdir(), DEPLOY_LOCK_DIR_NAME);
}

/** 제어기 IP를 파일명으로 쓸 수 있게 정규화한다(IPv6 콜론 등 → `_`). */
export function deployLockFileName(ip: string): string {
	const safe = (ip || 'default').trim().replace(/[^A-Za-z0-9._-]/g, '_');
	return `${safe || 'default'}.lock.json`;
}

/** 프로세스 생존 확인. Windows/POSIX 공통 — 존재하지만 권한이 없으면(EPERM) 살아 있는 것으로 본다. */
export function isPidAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) { return false; }
	try {
		process.kill(pid, 0);
		return true;
	} catch (err: any) {
		return err?.code === 'EPERM';
	}
}

/** 경고 문구용: `autoOnSave Quick Compile — UPLOAD, 37초 경과` */
export function describeDeployLock(rec: DeployLockRecord, now: number = Date.now()): string {
	const sec = Math.max(0, Math.round((now - rec.since) / 1000));
	const elapsed = sec >= 60 ? `${Math.floor(sec / 60)}분 ${sec % 60}초` : `${sec}초`;
	return `${rec.owner} — ${rec.stage}, ${elapsed} 경과`;
}

type ReadOutcome = { kind: 'none' } | { kind: 'record'; record: DeployLockRecord } | { kind: 'corrupt'; mtimeMs: number };

export class DeployLock {
	private local: { record: DeployLockRecord; generation: number; timer?: ReturnType<typeof setInterval>; released: boolean } | undefined;
	private generationSeq = 0;
	private readonly dir: string;
	private readonly now: () => number;
	private readonly pid: number;
	private readonly host: string;
	private readonly pidAlive: (pid: number) => boolean;
	private readonly heartbeatIntervalMs: number;
	private readonly staleMs: number;

	constructor(readonly ip: string, env: DeployLockEnv = {}) {
		this.dir = env.dir ?? defaultDeployLockDir();
		this.now = env.now ?? (() => Date.now());
		this.pid = env.pid ?? process.pid;
		this.host = env.host ?? os.hostname();
		this.pidAlive = env.pidAlive ?? isPidAlive;
		this.heartbeatIntervalMs = env.heartbeatIntervalMs ?? DEPLOY_LOCK_HEARTBEAT_MS;
		this.staleMs = env.staleMs ?? DEPLOY_LOCK_STALE_MS;
	}

	get filePath(): string {
		return path.join(this.dir, deployLockFileName(this.ip));
	}

	/** 현재 보유자. 이 프로세스가 잡고 있으면 local=true, 다른 창/프로세스면 false, 없거나 stale이면 undefined. */
	current(): { record: DeployLockRecord; local: boolean } | undefined {
		if (this.local && !this.local.released) {
			return { record: this.local.record, local: true };
		}
		const read = this.readFile();
		if (read.kind === 'record') {
			return this.isStale(read.record) ? undefined : { record: read.record, local: false };
		}
		if (read.kind === 'corrupt') {
			// 부분 기록/손상 — 최근 것이면 "알 수 없는 보유자"로 보수적으로 취급, 오래됐으면 없는 것으로.
			return this.now() - read.mtimeMs > this.staleMs ? undefined : { record: this.unknownRecord(read.mtimeMs), local: false };
		}
		return undefined;
	}

	/**
	 * 잠금 획득. 이미 보유 중(이 프로세스/다른 프로세스)이면 보유자 정보를 돌려준다.
	 * stale(죽은 pid·heartbeat 만료·이 프로세스의 잔재)이면 지우고 1회 재시도한다.
	 */
	acquire(owner: string, stage: string): DeployLockAcquireResult {
		if (this.local && !this.local.released) {
			return { ok: false, holder: this.local.record, local: true };
		}
		fs.mkdirSync(this.dir, { recursive: true });
		const file = this.filePath;
		for (let attempt = 0; attempt < 2; attempt++) {
			const record: DeployLockRecord = {
				version: DEPLOY_LOCK_VERSION,
				owner,
				stage,
				since: this.now(),
				heartbeat: this.now(),
				pid: this.pid,
				host: this.host,
			};
			let fd: number | undefined;
			try {
				fd = fs.openSync(file, 'wx');
				fs.writeSync(fd, JSON.stringify(record));
				fs.closeSync(fd);
				fd = undefined;
				return { ok: true, handle: this.makeHandle(record) };
			} catch (err: any) {
				if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* noop */ } }
				if (err?.code !== 'EEXIST') { throw err; }
				const existing = this.readFile();
				if (existing.kind === 'none') { continue; } // 사이에 사라짐 → 재시도
				if (existing.kind === 'corrupt') {
					if (this.now() - existing.mtimeMs > this.staleMs) { this.tryUnlink(); continue; }
					return { ok: false, holder: this.unknownRecord(existing.mtimeMs), local: false };
				}
				if (this.isStale(existing.record)) { this.tryUnlink(); continue; }
				return { ok: false, holder: existing.record, local: existing.record.pid === this.pid };
			}
		}
		// 두 번 모두 실패(경쟁 상대가 계속 새로 잡는 중) — 마지막으로 읽힌 것을 보유자로 보고한다.
		const last = this.readFile();
		const holder = last.kind === 'record' ? last.record : this.unknownRecord(last.kind === 'corrupt' ? last.mtimeMs : this.now());
		return { ok: false, holder, local: false };
	}

	// ── 내부 ──────────────────────────────────────────────

	private makeHandle(record: DeployLockRecord): DeployLockHandle {
		const generation = ++this.generationSeq;
		const state = { record, generation, released: false as boolean, timer: undefined as ReturnType<typeof setInterval> | undefined };
		this.local = state;
		if (this.heartbeatIntervalMs > 0) {
			state.timer = setInterval(() => { try { this.heartbeat(state); } catch { /* 파일 갱신 실패는 다음 주기에 재시도 */ } }, this.heartbeatIntervalMs);
			state.timer.unref?.();
		}
		const lock = this;
		return {
			get record() { return state.record; },
			get released() { return state.released; },
			setStage(stage: string) {
				if (state.released) { return; }
				state.record.stage = stage;
				lock.heartbeat(state);
			},
			heartbeat() { if (!state.released) { lock.heartbeat(state); } },
			release() { lock.release(state); },
		};
	}

	private heartbeat(state: { record: DeployLockRecord; released: boolean }): void {
		if (state.released) { return; }
		state.record.heartbeat = this.now();
		this.writeAtomic(state.record);
	}

	private release(state: { record: DeployLockRecord; generation: number; released: boolean; timer?: ReturnType<typeof setInterval> }): void {
		if (state.released) { return; }
		state.released = true;
		if (state.timer) { clearInterval(state.timer); state.timer = undefined; }
		if (this.local && this.local.generation === state.generation) {
			this.local = undefined;
		}
		// 파일이 여전히 내 레코드일 때만 지운다(다른 보유자가 stale 정리 후 새로 잡았을 수 있음).
		const read = this.readFile();
		if (read.kind === 'record' && read.record.pid === state.record.pid && read.record.since === state.record.since) {
			this.tryUnlink();
		}
	}

	private isStale(rec: DeployLockRecord): boolean {
		if (rec.pid === this.pid) {
			// 이 프로세스의 것인데 메모리에 보유 기록이 없다 → 이전 세션/예외로 남은 잔재.
			return !this.local || this.local.released;
		}
		if (Number.isInteger(rec.pid) && rec.pid > 0 && !this.pidAlive(rec.pid)) { return true; }
		return this.now() - (rec.heartbeat || rec.since || 0) > this.staleMs;
	}

	private readFile(): ReadOutcome {
		let text: string;
		let mtimeMs = this.now();
		try {
			text = fs.readFileSync(this.filePath, 'utf8');
			try { mtimeMs = fs.statSync(this.filePath).mtimeMs; } catch { /* noop */ }
		} catch (err: any) {
			if (err?.code === 'ENOENT') { return { kind: 'none' }; }
			// EBUSY/EPERM(rename 경쟁 순간) 등 — 한 번 더 시도
			try {
				text = fs.readFileSync(this.filePath, 'utf8');
			} catch (err2: any) {
				return err2?.code === 'ENOENT' ? { kind: 'none' } : { kind: 'corrupt', mtimeMs };
			}
		}
		try {
			const parsed = JSON.parse(text);
			if (parsed && typeof parsed === 'object' && typeof parsed.owner === 'string' && typeof parsed.since === 'number') {
				return {
					kind: 'record',
					record: {
						version: typeof parsed.version === 'number' ? parsed.version : DEPLOY_LOCK_VERSION,
						owner: parsed.owner,
						stage: typeof parsed.stage === 'string' ? parsed.stage : '(단계 미상)',
						since: parsed.since,
						heartbeat: typeof parsed.heartbeat === 'number' ? parsed.heartbeat : parsed.since,
						pid: typeof parsed.pid === 'number' ? parsed.pid : -1,
						host: typeof parsed.host === 'string' ? parsed.host : '',
					},
				};
			}
			return { kind: 'corrupt', mtimeMs };
		} catch {
			return { kind: 'corrupt', mtimeMs };
		}
	}

	private writeAtomic(record: DeployLockRecord): void {
		const file = this.filePath;
		const tmp = `${file}.${this.pid}.tmp`;
		fs.writeFileSync(tmp, JSON.stringify(record));
		try {
			fs.renameSync(tmp, file);
		} catch (err) {
			try { fs.unlinkSync(tmp); } catch { /* noop */ }
			throw err;
		}
	}

	private tryUnlink(): void {
		try { fs.unlinkSync(this.filePath); } catch { /* 이미 없음 */ }
	}

	private unknownRecord(mtimeMs: number): DeployLockRecord {
		return { version: DEPLOY_LOCK_VERSION, owner: '(알 수 없는 프로세스)', stage: '(단계 미상)', since: mtimeMs, heartbeat: mtimeMs, pid: -1, host: '' };
	}
}

// ── 프로세스 내 레지스트리 ─────────────────────────────
// 같은 IP의 잠금은 한 인스턴스가 관리해야 "이 프로세스가 보유 중" 판정이 일관된다.
const registry = new Map<string, DeployLock>();

/** 제어기 IP별 DeployLock 싱글톤. env는 최초 생성 시에만 적용된다(테스트는 `new DeployLock` 직접 사용). */
export function getDeployLock(ip: string, env?: DeployLockEnv): DeployLock {
	const key = (ip || 'default').trim();
	let lock = registry.get(key);
	if (!lock) {
		lock = new DeployLock(key, env);
		registry.set(key, lock);
	}
	return lock;
}
