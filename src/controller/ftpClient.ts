/**
 * FTP 클라이언트 — basic-ftp 패키지 기반.
 * Brooks 제어기 FTP 서버는 anonymous 접속만 지원한다.
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
	options?: { skipUnchanged?: boolean; onProgress?: (current: number, total: number, file: string) => void },
): Promise<{ uploaded: number; skipped: number; totalBytes: number }> {
	const client = await createClient(host);

	try {
		const files = getAllFiles(localDir);
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
			if (options?.skipUnchanged) {
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
				const dir = path.posix.dirname(remotePath);
				await client.ensureDir(dir);
				await client.cd('/');
				await client.uploadFrom(file, remotePath);
				uploaded++;
			}

			options?.onProgress?.(i + 1, files.length, relative);
		}

		return { uploaded, skipped, totalBytes };
	} finally {
		client.close();
	}
}

function getAllFiles(dir: string): string[] {
	const results: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
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
		const rel = relative ? `${relative}/${entry.name}` : entry.name;
		const full = `${currentDir}/${entry.name}`;

		if (entry.isDirectory) {
			await collectRemoteFiles(client, baseDir, rel, results);
		} else {
			results.push({ remotePath: full, relativePath: rel, size: entry.size });
		}
	}
}
