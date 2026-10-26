/**
 * FTP 클라이언트 — basic-ftp 패키지 기반.
 * Brooks 제어기 FTP 서버는 anonymous 접속만 지원한다.
 * (지정 파일만 업로드: uploadProject options.onlyFiles 참고)
 */

import * as fs from 'fs';
import * as path from 'path';
import { Writable } from 'stream';
import { Client as FtpClient, FileInfo } from 'basic-ftp';
import {
	SyncManifestFiles,
	hashFileSync,
	isUnchanged,
	manifestFileKey,
	nextStamp,
} from './syncManifest';
import { UploadProgressTracker } from '../deployment/uploadProgress';
import type { UploadProgressEvent } from '../deployment/uploadProgress';

const TIMEOUT_MS = 10_000;

/** 파일 경계에서 협력적으로 중단된 업로드. 네트워크 장애와 구분해 사용자에게 실패가 아닌 취소로 보고한다. */
export class UploadCancelledError extends Error {
	constructor(message = '업로드가 취소되었습니다') {
		super(message);
		this.name = 'UploadCancelledError';
	}
}

export function isUploadCancelledError(error: unknown): error is UploadCancelledError {
	return error instanceof UploadCancelledError || (error as { name?: unknown })?.name === 'UploadCancelledError';
}

function throwIfCancelled(isCancelled?: () => boolean): void {
	if (isCancelled?.()) { throw new UploadCancelledError(); }
}

export interface FtpEntry {
	name: string;
	isDirectory: boolean;
	size: number;
	modifiedAt?: Date;
}

function toFtpEntry(fi: FileInfo): FtpEntry {
	return {
		name: fi.name,
		isDirectory: fi.isDirectory,
		size: fi.size,
		modifiedAt: fi.modifiedAt ?? (fi.rawModifiedAt ? new Date(fi.rawModifiedAt) : undefined),
	};
}

/** 호스트별 마지막 FTP 220 배너 — 정체 확인(controllerIdentity)이 같은 작업 안의 FTP 세션 배너를 재사용한다(추가 접속 없음). */
const lastBannerByHost = new Map<string, { banner: string; at: number }>();

/** `host` 의 FTP 세션에서 마지막으로 받은 220 배너(없으면 undefined). */
export function getLastFtpBanner(host: string): { banner: string; at: number } | undefined {
	return lastBannerByHost.get(host);
}

/**
 * anonymous 접속된 basic-ftp Client를 생성한다.
 * 호출자가 반드시 client.close()를 호출해야 한다.
 * 접속 응답(220 배너)은 호스트별로 기억한다 — 업로드 전 정체 확인이 새 접속 없이 쓴다.
 */
async function createClient(host: string): Promise<FtpClient> {
	const client = new FtpClient(TIMEOUT_MS);
	const welcome = await client.access({ host, user: 'anonymous', password: 'anonymous' });
	if (welcome && typeof welcome.message === 'string') {
		lastBannerByHost.set(host, { banner: welcome.message, at: Date.now() });
	}
	return client;
}

/**
 * 업로드 대상 한 건 — 목록·크기를 루프 전에 한 번 읽어 총량(진행 바의 분모)을 먼저 안다.
 * `size` 는 그 **진행 집계 전용 스냅샷**이다. 해시·업로드 검증·지문은 파일 차례가 왔을 때 다시 stat 한 값을 쓴다 —
 * 앞 파일들을 올리는 동안(수 초) 사용자가 저장하면 크기가 바뀌는데, 스냅샷 크기로 원격 SIZE 를 대조하면 멀쩡한
 * 업로드를 "크기 불일치"로 실패시킨다.
 */
interface LocalUploadEntry {
	file: string;
	/** 프로젝트 기준 상대 경로(`/` 구분) — 원격 경로·지문 키·로그에 그대로 쓴다. */
	relative: string;
	/** 루프 전 크기 — 진행 바 분모/누적에만 쓴다(위 설명). */
	size: number;
}

function toUploadEntries(localDir: string, files: readonly string[]): LocalUploadEntry[] {
	return files.map(file => ({
		file,
		relative: path.relative(localDir, file).replace(/\\/g, '/'),
		size: fs.statSync(file).size,
	}));
}

/**
 * 전송 중 바이트를 진행 집계에 잇는다. basic-ftp 는 목록 조회(`list`) 전송에도 같은 핸들러를 부르므로 업로드만 고른다.
 * 호출자는 끝나면 `client.trackProgress()` 로 핸들러를 떼어 닫히는 소켓의 마지막 보고가 집계로 새지 않게 한다.
 */
function trackUploadBytes(client: FtpClient, tracker: UploadProgressTracker): void {
	client.trackProgress(info => {
		if (info.type === 'upload') { tracker.transferred(info.bytes); }
	});
}

// ── Public API (기존 시그니처 유지) ─────────────────────

/**
 * 제어기 원격 디렉터리 내용 조회.
 */
export async function listRemoteDir(host: string, remotePath: string): Promise<FtpEntry[]> {
	const client = await createClient(host);
	try {
		const list = await client.list(remotePath);
		return list.map(toFtpEntry);
	} finally {
		client.close();
	}
}

/** 원격 파일 한 개를 읽는다. 폴더 다운로드·원격 쓰기 없이 필요한 문서만 가져온다. */
export async function readRemoteFile(host: string, remotePath: string): Promise<Uint8Array> {
	const client = await createClient(host);
	const chunks: Buffer[] = [];
	const maxBytes = 64 * 1024 * 1024;
	let bytes = 0;
	const destination = new Writable({
		write(chunk: Buffer, _encoding, callback) {
			bytes += chunk.length;
			if (bytes > maxBytes) {
				callback(new Error(`원격 파일 읽기 상한(64 MiB)을 넘었습니다: ${remotePath}`));
				return;
			}
			chunks.push(Buffer.from(chunk));
			callback();
		},
	});
	try {
		await client.downloadTo(destination, remotePath);
		return Buffer.concat(chunks);
	} finally {
		client.close();
	}
}

/** listRemoteDirs 항목 — 경로별 결과. 성공이면 entries, 실패면 error(둘 중 하나만 채워진다). */
export interface RemoteDirListing {
	path: string;
	entries?: FtpEntry[];
	error?: string;
}

/**
 * 여러 원격 디렉터리를 **한 FTP 세션**으로 순차 조회한다 (GitHub #22 제안 7).
 * - listRemoteDir를 경로마다 부르면 경로 수만큼 제어 연결(로그인 포함)이 열린다. 트리뷰의 /GPL·Flash처럼
 *   같은 시점에 함께 보는 목록은 세션 1개 + 경로당 데이터 연결 1개로 끝내는 것이 제어기 부하가 적다.
 * - 경로 하나가 실패(550 등)해도 나머지는 계속 조회하고 항목별 `error`로 돌려준다. 단, 실패로 클라이언트가
 *   닫혔으면(타임아웃/소켓 오류 — basic-ftp는 이때 스스로 close) 남은 경로는 시도 없이 같은 오류로 채운다.
 * - 세션 자체를 열지 못하면(접속/로그인 실패) 예외를 던진다 — 호출자가 "제어기 FTP 불가"로 일괄 처리한다.
 * 반환 배열은 remotePaths와 같은 순서·길이다.
 */
export async function listRemoteDirs(host: string, remotePaths: string[]): Promise<RemoteDirListing[]> {
	if (remotePaths.length === 0) { return []; }
	const client = await createClient(host);
	try {
		const results: RemoteDirListing[] = [];
		let sessionError: string | undefined;
		for (const remotePath of remotePaths) {
			if (sessionError !== undefined) {
				results.push({ path: remotePath, error: sessionError });
				continue;
			}
			try {
				const list = await client.list(remotePath);
				results.push({ path: remotePath, entries: list.map(toFtpEntry) });
			} catch (err: any) {
				const message = err?.message ?? String(err);
				results.push({ path: remotePath, error: message });
				if (client.closed) { sessionError = message; }
			}
		}
		return results;
	} finally {
		client.close();
	}
}

/**
 * 제어기 원격 디렉터리 재귀 삭제.
 */
export async function removeRemoteDir(host: string, remotePath: string): Promise<void> {
	const client = await createClient(host);
	try {
		await client.removeDir(remotePath);
	} finally {
		client.close();
	}
}

/**
 * 제어기 원격 파일 삭제.
 */
export async function removeRemoteFile(host: string, remotePath: string): Promise<void> {
	const client = await createClient(host);
	try {
		await client.remove(remotePath);
	} finally {
		client.close();
	}
}

/** `clearRemoteDir` 결과 — 지운 항목 이름과 실패 항목(이름·사유). */
export interface ClearRemoteDirResult {
	deleted: string[];
	failed: { name: string; error: string }[];
}

/**
 * 원격 디렉터리의 **내용만** 비운다(폴더 자체는 남긴다).
 *
 * - /GPL·/flash/projects처럼 제어기가 고정으로 들고 있는 폴더는 지우지 않고 한 단계 아래 항목
 *   (파일·하위 폴더)만 지운다 — 폴더 자체가 사라지면 이후 업로드/Load 경로가 달라진다.
 * - 한 FTP 세션으로 처리하고, 개별 실패는 모아서 돌려준다(하나가 걸려도 나머지는 계속 지운다).
 *   호출측이 "부분 완료"를 사용자에게 그대로 알릴 수 있도록 성공/실패 목록을 함께 준다.
 * - 안전장치: 빈 경로·루트('/')는 대상이 될 수 없다(설정 오입력으로 파일시스템 전체를 지우는 사고 방지).
 * - `include` 를 주면 그 조건에 맞는 항목만 지운다(확인받은 목록만 지우기 — 확인 뒤 새로 생긴 항목은 남는다).
 */
export async function clearRemoteDir(
	host: string,
	remotePath: string,
	onDelete?: (name: string, isDirectory: boolean) => void,
	include?: (entry: FtpEntry) => boolean,
): Promise<ClearRemoteDirResult> {
	const base = normalizeAbsoluteRemoteDir(remotePath);
	if (base === '/') {
		throw new Error(`원격 폴더 비우기 대상이 안전하지 않습니다: "${remotePath}" (빈 경로·루트는 허용하지 않음)`);
	}
	const client = await createClient(host);
	try {
		const result: ClearRemoteDirResult = { deleted: [], failed: [] };
		const entries = await client.list(base);
		for (const entry of entries) {
			if (entry.name === '.' || entry.name === '..') { continue; }
			if (include && !include(toFtpEntry(entry))) { continue; }
			const full = `${base}/${entry.name}`;
			try {
				if (entry.isDirectory) {
					await client.removeDir(full);
				} else {
					await client.remove(full);
				}
				result.deleted.push(entry.name);
				onDelete?.(entry.name, entry.isDirectory);
			} catch (err: any) {
				result.failed.push({ name: entry.name, error: err?.message ?? String(err) });
			}
		}
		return result;
	} finally {
		client.close();
	}
}

/**
 * 원격 경로를 선행 슬래시 1개 + 빈 구간 제거 형태로 정규화한다(`/GPL/`, `//GPL` → `/GPL`).
 * 빈 문자열·루트는 '/'가 되므로 호출측이 안전장치로 걸러낼 수 있다.
 */
export function normalizeAbsoluteRemoteDir(remotePath: string): string {
	const parts = (remotePath ?? '').split('/').filter(p => p.length > 0 && p !== '.');
	return `/${parts.join('/')}`;
}

/**
 * 프로젝트 폴더 전체를 제어기에 업로드.
 * 반환: { uploaded, skipped, totalBytes, manifest }
 *
 * `manifest`는 이번에 올리거나 "원격과 같음"으로 확인한 파일들의 지문이다(`syncManifest` 참고).
 * 호출측이 성공 후 `mergeSyncManifest`로 남겨 두면 다음 동기화의 스킵 판정이 크기뿐 아니라
 * 내용(SHA-1) 기준으로 이뤄진다. 이번 호출에서 다룬 파일만 담기므로 **병합**해야 한다.
 */
export async function uploadProject(
	host: string,
	localDir: string,
	remoteDir: string,
	options?: {
		skipUnchanged?: boolean;
		/**
		 * 지정 시 이 파일들만 업로드한다(로컬 절대경로). localDir 하위 + 실제 존재하는 파일만 대상.
		 * onlyFiles에 포함된 파일은 호출자가 변경을 확신하는 것으로 보고 크기 비교(skipUnchanged) 없이
		 * 항상 업로드한다. → 저장 파일만 올리는 빠른 컴파일 경로에서 사용.
		 */
		onlyFiles?: string[];
		/**
		 * 직전 동기화에서 남긴 파일별 지문(`getSyncManifest`). `skipUnchanged` 스킵 조건이
		 * "원격 크기 == 로컬 크기 **그리고** 로컬 SHA-1 == 마지막 업로드 SHA-1"이 된다.
		 * 지문이 없는 파일(첫 동기화 등)은 스킵하지 않고 올린다 — 판정 불가는 항상 업로드 쪽으로 넘어뜨린다.
		 */
		manifest?: Readonly<SyncManifestFiles>;
		/**
		 * 진행 알림 — 파일 하나가 끝날 때(`type: 'file'`, 로그 한 줄의 단위)와 전송 중 바이트 갱신(`type: 'bytes'`,
		 * 상태바용). 집계 규칙은 `uploadProgress.UploadProgressTracker`.
		 */
		onProgress?: (event: UploadProgressEvent) => void;
		/** true면 새 파일 전송을 시작하지 않고 현재 파일 경계에서 취소한다. */
		isCancelled?: () => boolean;
	},
): Promise<{ uploaded: number; skipped: number; totalBytes: number; manifest: SyncManifestFiles }> {
	throwIfCancelled(options?.isCancelled);
	const client = await createClient(host);

	try {
		// onlyFiles가 주어지면 그 목록만(localDir 하위 + 존재하는 파일) 업로드 대상으로 한다.
		const onlySet = options?.onlyFiles && options.onlyFiles.length > 0
			? new Set(options.onlyFiles.map(f => path.resolve(f)))
			: undefined;
		const restrictToOnly = onlySet !== undefined;
		const files = (restrictToOnly
			? [...onlySet!].filter(f => {
				const rel = path.relative(localDir, f);
				const insideLocalDir = !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
				return insideLocalDir && fs.existsSync(f) && fs.statSync(f).isFile();
			})
			: getAllFiles(localDir));
		const entries = toUploadEntries(localDir, files);
		const tracker = new UploadProgressTracker(entries, event => options?.onProgress?.(event));
		trackUploadBytes(client, tracker);
		let uploaded = 0;
		let skipped = 0;
		const manifest: SyncManifestFiles = {};

		for (const entry of entries) {
			throwIfCancelled(options?.isCancelled);
			const { file, relative } = entry;
			// 해시·검증·지문은 지금 이 순간의 파일 기준(LocalUploadEntry 주석) — entry.size 는 진행 집계 전용.
			const size = fs.statSync(file).size;
			const remotePath = `${remoteDir}/${relative}`;

			const key = manifestFileKey(relative);
			const previous = options?.manifest?.[key];
			// 크기가 같아도 내용이 다를 수 있으므로 로컬 해시로 판정한다(해시 실패 시 크기 비교로 폴백).
			const local = { size, sha1: hashFileSync(file, size) };
			let remote: { size: number } | undefined;

			let skip = false;
			// onlyFiles 경로에서는 변경을 확신하므로 비교를 건너뛰고 항상 업로드한다.
			if (!restrictToOnly && options?.skipUnchanged) {
				try {
					remote = { size: await client.size(remotePath) };
				} catch {
					// 원격 파일 없음 → 업로드 필요
				}
				// SIZE만으로는 원격 mtime을 알 수 없다 → mtime 조건은 자동으로 생략된다.
				skip = isUnchanged(previous, local, remote);
			}

			if (skip) {
				skipped++;
			} else {
				tracker.begin(relative, entry.size);
				await uploadVerified(client, file, remotePath, size);
				uploaded++;
			}
			manifest[key] = nextStamp(local, remote, previous, skip ? 'skipped' : 'uploaded');
			tracker.end(relative, entry.size, skip ? 'skipped' : 'uploaded');
			// 파일 전송 도중 들어온 취소는 이 지점에서 반영한다. 중간 소켓 절단으로 부분 파일을 의도적으로 만들지 않는다.
			throwIfCancelled(options?.isCancelled);
		}

		return { uploaded, skipped, totalBytes: tracker.totalBytes, manifest };
	} finally {
		client.trackProgress();
		client.close();
	}
}

/**
 * 로컬 프로젝트 폴더를 원격 폴더와 미러 동기화한다 (direct /GPL 경로용).
 * - 원격에 없거나, 크기가 다르거나, **내용(SHA-1)이 마지막으로 올린 것과 다른** 파일만 업로드한다.
 * - 원격에만 있는 파일은 삭제한다 — 로컬에서 지운/이름 바꾼 파일이 원격에 남아
 *   Compile 대상이 되는 것(낡은 소스 오컴파일)을 막기 위한 정확성 조치이기도 하다.
 * - Unload/Load 없이 로드본(/GPL/<name>)을 로컬과 일치시키는 것이 목적.
 *
 * 스킵 판정: `options.manifest`(직전 동기화 지문, `getSyncManifest`)를 주면 크기가 같아도
 * 내용이 바뀐 파일을 잡아낸다. 지문이 없으면(첫 동기화) 스킵하지 않고 올린다 — 판정 불가는 항상
 * 업로드 쪽으로 넘어뜨린다. 반환 `manifest`를 성공 후 `recordSyncManifest`로 남기면 다음 회차에 쓰인다.
 * 한계: 우리 밖에서 원격 파일이 같은 크기로 바뀌고 목록에 mtime도 없으면 여전히 놓칠 수 있다.
 */
export interface RemoteFileRef {
	remotePath: string;
	relativePath: string;
}

export async function mirrorProject(
	host: string,
	localDir: string,
	remoteDir: string,
	options?: {
		/** 진행 알림 — `uploadProject` 와 같은 이벤트(파일 완료 + 전송 중 바이트). */
		onProgress?: (event: UploadProgressEvent) => void;
		onDelete?: (file: string) => void;
		/**
		 * true면 원격 전용 파일을 지우지 않고 `pendingDeletes`로 돌려준다. 호출측이 안전한 시점
		 * (배포에서는 Stop settle 게이트 통과 뒤)에 `removeRemoteFiles`로 처리한다 — 쓰레드 실행 중
		 * 원격 파일 삭제가 무해한지는 미검증이라 업로드와 분리한다(2026-08-25, 이슈 #17).
		 */
		deferDelete?: boolean;
		/**
		 * 직전 동기화에서 남긴 파일별 지문(`getSyncManifest`). 스킵 판정에 내용(SHA-1) 비교를 더한다.
		 * 지문이 없는 파일(첫 동기화 등)은 스킵하지 않고 올린다 — 판정 불가는 항상 업로드 쪽으로 넘어뜨린다.
		 */
		manifest?: Readonly<SyncManifestFiles>;
		/** true면 새 파일/삭제를 시작하지 않고 현재 파일 경계에서 취소한다. */
		isCancelled?: () => boolean;
	},
): Promise<{
	uploaded: number;
	skipped: number;
	deleted: number;
	totalBytes: number;
	pendingDeletes: RemoteFileRef[];
	/** 이번 동기화 뒤의 파일별 지문. 성공 시 `recordSyncManifest`로 저장한다(전체 목록 기준 → 대체). */
	manifest: SyncManifestFiles;
}> {
	throwIfCancelled(options?.isCancelled);
	const client = await createClient(host);
	try {
		// 1) 원격 파일 목록(재귀). 원격 폴더가 없거나 조회 실패면 빈 목록으로 취급 → 전체 업로드.
		const remoteFiles: RemoteFileEntry[] = [];
		try {
			await collectRemoteFiles(client, remoteDir, '', remoteFiles);
		} catch {
			// ignore: 원격 폴더 없음 등 — 아래에서 전부 업로드된다.
		}
		throwIfCancelled(options?.isCancelled);
		// 로컬(Windows)은 대소문자 무시 파일시스템이므로 소문자 키로 매칭한다.
		const remoteByRel = new Map<string, { remotePath: string; size: number; modifiedAtMs?: number }>();
		for (const rf of remoteFiles) {
			remoteByRel.set(rf.relativePath.toLowerCase(), {
				remotePath: rf.remotePath,
				size: rf.size,
				modifiedAtMs: rf.modifiedAtMs,
			});
		}

		const entries = toUploadEntries(localDir, getAllFiles(localDir));
		const tracker = new UploadProgressTracker(entries, event => options?.onProgress?.(event));
		trackUploadBytes(client, tracker);
		const localRelSet = new Set<string>();
		let uploaded = 0;
		let skipped = 0;
		let deleted = 0;
		const manifest: SyncManifestFiles = {};

		// 2) 로컬 기준 업로드/스킵
		for (const entry of entries) {
			throwIfCancelled(options?.isCancelled);
			const { file, relative } = entry;
			localRelSet.add(relative.toLowerCase());
			// 해시·검증·지문은 지금 이 순간의 파일 기준(LocalUploadEntry 주석) — entry.size 는 진행 집계 전용.
			const size = fs.statSync(file).size;

			const remote = remoteByRel.get(relative.toLowerCase());
			const key = manifestFileKey(relative);
			const previous = options?.manifest?.[key];
			// 크기가 같아도 내용이 다를 수 있으므로 로컬 해시를 함께 본다(해시 실패 시 크기 비교로 폴백).
			const local = { size, sha1: hashFileSync(file, size) };
			const skip = isUnchanged(previous, local, remote);
			if (skip) {
				skipped++;
			} else {
				const remotePath = `${remoteDir}/${relative}`;
				tracker.begin(relative, entry.size);
				await uploadVerified(client, file, remotePath, size);
				uploaded++;
			}
			manifest[key] = nextStamp(local, remote, previous, skip ? 'skipped' : 'uploaded');
			tracker.end(relative, entry.size, skip ? 'skipped' : 'uploaded');
			throwIfCancelled(options?.isCancelled);
		}

		// 3) 원격에만 있는 파일 삭제 (낡은 소스 제거) — deferDelete면 목록만 돌려준다.
		const pendingDeletes: RemoteFileRef[] = [];
		for (const rf of remoteFiles) {
			throwIfCancelled(options?.isCancelled);
			if (localRelSet.has(rf.relativePath.toLowerCase())) { continue; }
			if (options?.deferDelete) {
				pendingDeletes.push({ remotePath: rf.remotePath, relativePath: rf.relativePath });
				continue;
			}
			try {
				await client.remove(rf.remotePath);
				deleted++;
				options?.onDelete?.(rf.relativePath);
			} catch {
				// 삭제 실패는 non-fatal — 남은 파일은 Compile 결과로 드러난다.
			}
			throwIfCancelled(options?.isCancelled);
		}

		return { uploaded, skipped, deleted, totalBytes: tracker.totalBytes, pendingDeletes, manifest };
	} finally {
		client.trackProgress();
		client.close();
	}
}

/**
 * 원격 파일 목록을 한 연결로 삭제한다(mirrorProject deferDelete의 후처리).
 * 개별 실패는 non-fatal — 남은 파일은 Compile 결과로 드러난다. 삭제 성공 수를 돌려준다.
 */
export async function removeRemoteFiles(
	host: string,
	files: RemoteFileRef[],
	onDelete?: (file: string) => void,
): Promise<number> {
	if (files.length === 0) { return 0; }
	const client = await createClient(host);
	let deleted = 0;
	try {
		for (const rf of files) {
			try {
				await client.remove(rf.remotePath);
				deleted++;
				onDelete?.(rf.relativePath);
			} catch {
				// non-fatal
			}
		}
		return deleted;
	} finally {
		client.close();
	}
}

/**
 * 업로드 직후 SIZE로 원격 크기를 재확인한다 (부분 업로드 감지, §3-B B6).
 * - 크기 불일치가 "확인"되면 → 1회 재업로드 후 재확인, 그래도 불일치면 예외(UPLOAD 실패 처리).
 * - SIZE 조회 자체가 불가하면 검증 불가로 보고 업로드는 인정한다
 *   (SIZE 미지원/일시 오류로 정상 업로드를 실패로 만들지 않기 위함).
 */
async function uploadVerified(client: FtpClient, localFile: string, remotePath: string, localSize: number): Promise<void> {
	const dir = path.posix.dirname(remotePath);
	await client.ensureDir(dir);
	await client.cd('/');
	await client.uploadFrom(localFile, remotePath);
	for (let attempt = 0; ; attempt++) {
		let remoteSize: number | null = null;
		try { remoteSize = await client.size(remotePath); } catch { remoteSize = null; }
		if (remoteSize === null || remoteSize === localSize) { return; }
		if (attempt >= 1) {
			throw new Error(`업로드 검증 실패: ${remotePath} 크기 불일치 (local ${localSize} / remote ${remoteSize}) — 원격 사본이 불완전할 수 있습니다. 다시 배포하세요.`);
		}
		await client.uploadFrom(localFile, remotePath);
	}
}

function getAllFiles(dir: string): string[] {
	const results: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		// dot 항목(.git/.history/.vscode/.DS_Store 등)은 제어기로 올릴 대상이 아니다.
		// (findProjectDirs의 탐색 제외와 대칭 — flash 소모/업로드 시간 낭비 방지)
		if (entry.name.startsWith('.')) { continue; }
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...getAllFiles(full));
		} else {
			results.push(full);
		}
	}
	return results;
}

/**
 * 제어기 FTP 프로젝트를 로컬로 다운로드.
 * 원격 폴더를 재귀 탐색하여 localDir에 동일 구조로 저장한다.
 */
export async function downloadProject(
	host: string,
	remoteDir: string,
	localDir: string,
	onProgress?: (current: number, total: number, file: string) => void,
): Promise<{ downloaded: number; totalBytes: number }> {
	const client = await createClient(host);

	try {
		// 1) 재귀적으로 원격 파일 목록 수집
		const remoteFiles: RemoteFileEntry[] = [];
		await collectRemoteFiles(client, remoteDir, '', remoteFiles);

		let downloaded = 0;
		let totalBytes = 0;

		// 2) 각 파일 다운로드
		for (let i = 0; i < remoteFiles.length; i++) {
			const rf = remoteFiles[i];
			const localPath = path.join(localDir, rf.relativePath);
			// 원격 엔트리 이름 검증: localDir 밖으로 나가는 경로(../ 류)는 저장하지 않는다.
			const relCheck = path.relative(localDir, localPath);
			if (!relCheck || relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
				throw new Error(`안전하지 않은 FTP 파일 경로를 거부했습니다: ${rf.relativePath}`);
			}

			// 로컬 디렉터리 생성
			const dir = path.dirname(localPath);
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}

			await client.downloadTo(localPath, rf.remotePath);
			let stat = fs.statSync(localPath);
			if (Number.isFinite(rf.size) && rf.size >= 0 && stat.size !== rf.size) {
				// 전송 종료만으로 완전성을 추정하지 않는다. 목록의 크기와 다르면 한 번만 다시 받고 재검증한다.
				await client.downloadTo(localPath, rf.remotePath);
				stat = fs.statSync(localPath);
				if (stat.size !== rf.size) {
					throw new Error(
						`다운로드 검증 실패: ${rf.relativePath} 크기 불일치 (remote ${rf.size} / local ${stat.size})`,
					);
				}
			}
			totalBytes += stat.size;
			downloaded++;

			onProgress?.(i + 1, remoteFiles.length, rf.relativePath);
		}

		if (downloaded !== remoteFiles.length) {
			throw new Error(`다운로드 검증 실패: 파일 수 불일치 (remote ${remoteFiles.length} / local ${downloaded})`);
		}

		return { downloaded, totalBytes };
	} finally {
		client.close();
	}
}

/** 재귀 목록 조회로 수집한 원격 파일 하나. `modifiedAtMs`는 서버가 목록에 시각을 주는 경우에만 채워진다. */
interface RemoteFileEntry {
	remotePath: string;
	relativePath: string;
	size: number;
	modifiedAtMs?: number;
}

/**
 * 원격 디렉터리를 재귀 탐색하여 파일 목록을 수집.
 */
async function collectRemoteFiles(
	client: FtpClient,
	baseDir: string,
	relative: string,
	results: RemoteFileEntry[],
): Promise<void> {
	const currentDir = relative ? `${baseDir}/${relative}` : baseDir;
	const entries = await client.list(currentDir);

	for (const entry of entries) {
		// 서버가 '.'/'..'를 목록에 포함하는 경우 무한 재귀/경로 오염 방지.
		if (entry.name === '.' || entry.name === '..') { continue; }
		const rel = relative ? `${relative}/${entry.name}` : entry.name;
		const full = `${currentDir}/${entry.name}`;

		if (entry.isDirectory) {
			await collectRemoteFiles(client, baseDir, rel, results);
		} else {
			const modifiedAt = toFtpEntry(entry).modifiedAt;
			const modifiedAtMs = modifiedAt && !Number.isNaN(modifiedAt.getTime()) ? modifiedAt.getTime() : undefined;
			results.push({ remotePath: full, relativePath: rel, size: entry.size, modifiedAtMs });
		}
	}
}
