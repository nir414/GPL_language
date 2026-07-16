/**
 * FTP 클라이언트 — basic-ftp 패키지 기반.
 * Brooks 제어기 FTP 서버는 anonymous 접속만 지원한다.
 * (지정 파일만 업로드: uploadProject options.onlyFiles 참고)
 */

import * as fs from 'fs';
import * as path from 'path';
import { Client as FtpClient, FileInfo } from 'basic-ftp';

const TIMEOUT_MS = 10_000;

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

/**
 * anonymous 접속된 basic-ftp Client를 생성한다.
 * 호출자가 반드시 client.close()를 호출해야 한다.
 */
async function createClient(host: string): Promise<FtpClient> {
	const client = new FtpClient(TIMEOUT_MS);
	await client.access({ host, user: 'anonymous', password: 'anonymous' });
	return client;
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

/**
 * 프로젝트 폴더 전체를 제어기에 업로드.
 * 반환: { uploaded, skipped, totalBytes }
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
		onProgress?: (current: number, total: number, file: string) => void;
	},
): Promise<{ uploaded: number; skipped: number; totalBytes: number }> {
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
		let uploaded = 0;
		let skipped = 0;
		let totalBytes = 0;

		for (let i = 0; i < files.length; i++) {
			const file = files[i];
			const relative = path.relative(localDir, file).replace(/\\/g, '/');
			const remotePath = `${remoteDir}/${relative}`;
			const stat = fs.statSync(file);
			totalBytes += stat.size;

			let skip = false;
			// onlyFiles 경로에서는 변경을 확신하므로 크기 비교를 건너뛰고 항상 업로드한다.
			if (!restrictToOnly && options?.skipUnchanged) {
				try {
					const remoteSize = await client.size(remotePath);
					if (remoteSize === stat.size) { skip = true; }
				} catch {
					// 원격 파일 없음 → 업로드 필요
				}
			}

			if (skip) {
				skipped++;
			} else {
				await uploadVerified(client, file, remotePath, stat.size);
				uploaded++;
			}

			options?.onProgress?.(i + 1, files.length, relative);
		}

		return { uploaded, skipped, totalBytes };
	} finally {
		client.close();
	}
}

/**
 * 로컬 프로젝트 폴더를 원격 폴더와 미러 동기화한다 (direct /GPL 경로용).
 * - 로컬에 없거나 크기가 다른 파일만 업로드하고, 같은 크기는 스킵한다.
 * - 원격에만 있는 파일은 삭제한다 — 로컬에서 지운/이름 바꾼 파일이 원격에 남아
 *   Compile 대상이 되는 것(낡은 소스 오컴파일)을 막기 위한 정확성 조치이기도 하다.
 * - Unload/Load 없이 로드본(/GPL/<name>)을 로컬과 일치시키는 것이 목적.
 * 한계: 크기 비교라서 내용이 달라도 크기가 같으면 놓친다(skipUnchanged와 동일).
 */
export async function mirrorProject(
	host: string,
	localDir: string,
	remoteDir: string,
	options?: {
		onProgress?: (current: number, total: number, file: string) => void;
		onDelete?: (file: string) => void;
	},
): Promise<{ uploaded: number; skipped: number; deleted: number; totalBytes: number }> {
	const client = await createClient(host);
	try {
		// 1) 원격 파일 목록(재귀). 원격 폴더가 없거나 조회 실패면 빈 목록으로 취급 → 전체 업로드.
		const remoteFiles: { remotePath: string; relativePath: string; size: number }[] = [];
		try {
			await collectRemoteFiles(client, remoteDir, '', remoteFiles);
		} catch {
			// ignore: 원격 폴더 없음 등 — 아래에서 전부 업로드된다.
		}
		// 로컬(Windows)은 대소문자 무시 파일시스템이므로 소문자 키로 매칭한다.
		const remoteByRel = new Map<string, { remotePath: string; size: number }>();
		for (const rf of remoteFiles) {
			remoteByRel.set(rf.relativePath.toLowerCase(), { remotePath: rf.remotePath, size: rf.size });
		}

		const localFiles = getAllFiles(localDir);
		const localRelSet = new Set<string>();
		let uploaded = 0;
		let skipped = 0;
		let deleted = 0;
		let totalBytes = 0;

		// 2) 로컬 기준 업로드/스킵
		for (let i = 0; i < localFiles.length; i++) {
			const file = localFiles[i];
			const relative = path.relative(localDir, file).replace(/\\/g, '/');
			localRelSet.add(relative.toLowerCase());
			const stat = fs.statSync(file);
			totalBytes += stat.size;

			const remote = remoteByRel.get(relative.toLowerCase());
			if (remote && remote.size === stat.size) {
				skipped++;
			} else {
				const remotePath = `${remoteDir}/${relative}`;
				await uploadVerified(client, file, remotePath, stat.size);
				uploaded++;
			}
			options?.onProgress?.(i + 1, localFiles.length, relative);
		}

		// 3) 원격에만 있는 파일 삭제 (낡은 소스 제거)
		for (const rf of remoteFiles) {
			if (localRelSet.has(rf.relativePath.toLowerCase())) { continue; }
			try {
				await client.remove(rf.remotePath);
				deleted++;
				options?.onDelete?.(rf.relativePath);
			} catch {
				// 삭제 실패는 non-fatal — 남은 파일은 Compile 결과로 드러난다.
			}
		}

		return { uploaded, skipped, deleted, totalBytes };
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
		const remoteFiles: { remotePath: string; relativePath: string; size: number }[] = [];
		await collectRemoteFiles(client, remoteDir, '', remoteFiles);

		let downloaded = 0;
		let totalBytes = 0;

		// 2) 각 파일 다운로드
		for (let i = 0; i < remoteFiles.length; i++) {
			const rf = remoteFiles[i];
			const localPath = path.join(localDir, rf.relativePath);
			// 원격 엔트리 이름 검증: localDir 밖으로 나가는 경로(../ 류)는 저장하지 않는다.
			const relCheck = path.relative(localDir, localPath);
			if (!relCheck || relCheck.startsWith('..') || path.isAbsolute(relCheck)) { continue; }

			// 로컬 디렉터리 생성
			const dir = path.dirname(localPath);
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}

			await client.downloadTo(localPath, rf.remotePath);
			const stat = fs.statSync(localPath);
			totalBytes += stat.size;
			downloaded++;

			onProgress?.(i + 1, remoteFiles.length, rf.relativePath);
		}

		return { downloaded, totalBytes };
	} finally {
		client.close();
	}
}

/**
 * 원격 디렉터리를 재귀 탐색하여 파일 목록을 수집.
 */
async function collectRemoteFiles(
	client: FtpClient,
	baseDir: string,
	relative: string,
	results: { remotePath: string; relativePath: string; size: number }[],
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
			results.push({ remotePath: full, relativePath: rel, size: entry.size });
		}
	}
}
