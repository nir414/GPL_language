/** FTP 소스를 작업공간 밖에서 보여 주는 세션. 메타데이터만 먼저 읽고 소스는 요청할 때 가져온다. */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildLibraryGraph, DEFAULT_SOURCE_EXTENSIONS, isSkippedScanDir } from '../../project/projectSources';
import { controllerLibraryCandidates } from '../../project/controllerProjectDebug';
import { parseGprText } from '../../project/gprSync';
import { CONTROLLER_PROJECT_MANIFEST_FILE, writeControllerProjectManifest } from '../../project/controllerProjectWorkspace';
import { FtpEntry, listRemoteDir, readRemoteFile } from './ftpClient';

export const REMOTE_SOURCE_SCHEME = 'gpl-ftp';
const MAX_DIRS = 2000;
const MAX_DEPTH = 24;
const MAX_PROJECTS = 500;
const MAX_SOURCES = 20000;
const sessions = new Map<string, RemoteSourceSession>();

export interface RemoteSourceIo {
	list(host: string, remotePath: string): Promise<FtpEntry[]>;
	read(host: string, remotePath: string): Promise<Uint8Array>;
}
const FTP_IO: RemoteSourceIo = { list: listRemoteDir, read: readRemoteFile };

export interface RemoteSourceFile { remotePath: string; localPath: string; uri: string }
export interface RemoteDebugProject {
	projectName: string;
	projectDir: string;
	remotePath: string;
	gprPath: string;
	sourcePaths: string[];
	unresolvedLibraries: string[];
}
interface Metadata {
	remotePath: string;
	gprPath: string;
	dir: string;
	text: string;
	sources: string[];
	libraries: Map<string, string | undefined>;
}
interface PendingRequest<T> { promise: Promise<T>; refresh: boolean }

export function getRemoteSourceSession(id: string): RemoteSourceSession | undefined { return sessions.get(id); }
function key(value: string): string { return value.replace(/\\/g, '/').toLowerCase(); }

/** URI 이중 인코딩과 Windows 파일 별칭도 캐시 경계를 넘는 경로로 해석하지 않는다. */
function assertSegment(segment: string): void {
	let decoded = segment;
	for (let i = 0; i < 6; i++) {
		if (!decoded || decoded === '.' || decoded === '..' || /[\\/:<>"|?*\x00-\x1f]/.test(decoded)
			|| /[. ]$/.test(decoded) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(decoded)) {
			throw new Error(`안전하지 않은 원격 경로입니다: ${segment}`);
		}
		let next: string;
		try { next = decodeURIComponent(decoded); } catch { return; }
		if (next === decoded) { return; }
		decoded = next;
	}
	throw new Error(`지나치게 인코딩된 원격 경로입니다: ${segment}`);
}

/** FTP 트리도 세션과 같은 이름 검증을 사용해 경로 조각을 폴더명으로 오인하지 않는다. */
export function isSafeRemoteEntryName(name: string): boolean {
	try { assertSegment(name); return true; } catch { return false; }
}

function absoluteRemote(value: string): string {
	if (!value.startsWith('/') || value.includes('\\')) { throw new Error(`원격 절대 경로가 필요합니다: ${value}`); }
	const segments = value.split('/').filter(Boolean);
	segments.forEach(assertSegment);
	return `/${segments.join('/')}`;
}

function preferredGpr(entries: FtpEntry[]): FtpEntry | undefined {
	const candidates = entries.filter(e => !e.isDirectory && /\.gpr$/i.test(e.name))
		.sort((a, b) => key(a.name).localeCompare(key(b.name)));
	return candidates.find(e => key(e.name) === 'project.gpr') ?? candidates[0];
}

export class RemoteSourceSession {
	readonly id = crypto.randomUUID();
	readonly host: string;
	readonly root: string;
	readonly cacheRoot: string;
	private readonly cacheParent: string;
	private disposed = false;
	private readonly listings = new Map<string, FtpEntry[]>();
	private readonly listingRequests = new Map<string, PendingRequest<FtpEntry[]>>();
	private readonly reads = new Set<string>();
	private readonly readRequests = new Map<string, PendingRequest<Uint8Array>>();
	private readonly known = new Map<string, string>();
	private activeSources = new Map<string, RemoteSourceFile>();
	private activeProjectDir: string | undefined;
	private prepareRequest: Promise<RemoteDebugProject> | undefined;

	constructor(host: string, remoteRoot: string, private readonly io: RemoteSourceIo = FTP_IO, cacheBase = os.tmpdir()) {
		if (!host.trim() || host !== host.trim() || /[\x00-\x20/\\]/.test(host)) { throw new Error('제어기 호스트를 명시해야 합니다.'); }
		this.host = host;
		this.root = absoluteRemote(remoteRoot);
		if (this.root === '/') { throw new Error('원격 소스 루트를 명시해야 합니다.'); }
		fs.mkdirSync(cacheBase, { recursive: true });
		this.cacheParent = fs.realpathSync(cacheBase);
		this.cacheRoot = fs.mkdtempSync(path.join(this.cacheParent, 'gpl-remote-'));
		try {
			writeControllerProjectManifest(this.cacheRoot, {
				mode: 'snapshot', controllerHost: host, sourceRemotePath: this.root,
				projectName: path.posix.basename(this.root), downloadedAt: new Date().toISOString(),
			});
		} catch (error) {
			fs.rmSync(this.cacheRoot, { recursive: true, force: true });
			throw error;
		}
		this.known.set(key(this.root), this.root);
		sessions.set(this.id, this);
	}

	private check(): void { if (this.disposed) { throw new Error('원격 소스 세션이 닫혔습니다.'); } }
	private remote(value: string): string {
		const normalized = absoluteRemote(value);
		if (key(normalized) !== key(this.root) && !key(normalized).startsWith(`${key(this.root)}/`)) {
			throw new Error(`원격 소스 루트 밖의 경로를 거부했습니다: ${value}`);
		}
		if (normalized.split('/').some(segment => key(segment) === CONTROLLER_PROJECT_MANIFEST_FILE)) {
			throw new Error('임시 소스 캐시의 보호 메타데이터와 충돌하는 원격 파일입니다.');
		}
		return this.known.get(key(normalized)) ?? `${this.root}${normalized.slice(this.root.length)}`;
	}

	uri(remotePath: string): string {
		this.check();
		return `${REMOTE_SOURCE_SCHEME}://${this.id}${this.remote(remotePath).split('/').map(encodeURIComponent).join('/')}`;
	}

	remotePathFromUri(uri: string): string | undefined {
		this.check();
		// URL은 dot segment를 정규화하므로 파싱 전 원래 경로부터 검사한다.
		const match = /^gpl-ftp:\/\/([^/?#]+)(\/[^?#]*)(?:$)/i.exec(uri);
		if (!match || match[1] !== this.id) { return undefined; }
		try {
			const remote = match[2].split('/').map(segment => decodeURIComponent(segment)).join('/');
			return this.remote(remote);
		} catch { return undefined; }
	}

	localPath(remotePath: string): string {
		this.check();
		const remote = this.remote(remotePath);
		return path.join(this.cacheRoot, ...remote.slice(this.root.length).split('/').filter(Boolean));
	}

	remotePathForLocal(localPath: string): string | undefined {
		this.check();
		const relative = path.relative(this.cacheRoot, path.resolve(localPath));
		if (relative === '') { return this.root; }
		if (relative.startsWith('..') || path.isAbsolute(relative)) { return undefined; }
		try { return this.remote(`${this.root}/${relative.split(path.sep).join('/')}`); } catch { return undefined; }
	}

	private async rawList(remote: string, refresh = false): Promise<FtpEntry[]> {
		this.check();
		const lookup = key(remote);
		const pending = this.listingRequests.get(lookup);
		if (pending && (!refresh || pending.refresh)) { return pending.promise; }
		if (!refresh && this.listings.has(lookup)) { return this.listings.get(lookup)!; }
		const request = (async () => {
			// 일반 조회 도중 누른 새로고침은 그 응답 뒤에 새 조회를 한 번 실행한다.
			// 앞선 실패는 원래 호출자에게 전달하고, 명시한 새로고침은 계속한다.
			if (pending) { await pending.promise.catch(() => undefined); }
			this.check();
			const entries = (await this.io.list(this.host, remote)).filter(e => e.name !== '.' && e.name !== '..');
			this.check();
			const names = new Set<string>();
			for (const entry of entries) {
				assertSegment(entry.name);
				if (names.has(key(entry.name))) { throw new Error(`대소문자가 모호한 원격 항목입니다: ${remote}/${entry.name}`); }
				names.add(key(entry.name));
				const full = `${remote}/${entry.name}`;
				this.known.set(key(full), full);
			}
			this.listings.set(lookup, entries);
			return entries;
		})();
		this.listingRequests.set(lookup, { promise: request, refresh });
		try { return await request; } finally {
			if (this.listingRequests.get(lookup)?.promise === request) { this.listingRequests.delete(lookup); }
		}
	}

	/** 없는 경로에 LIST를 보내지 않고 확인한 부모 목록에서 한 단계씩 내려간다. */
	private async find(remotePath: string, directory: boolean): Promise<string | undefined> {
		const target = this.remote(remotePath);
		if (key(target) === key(this.root)) { return directory ? this.root : undefined; }
		const segments = target.slice(this.root.length).split('/').filter(Boolean);
		let current = this.root;
		for (let index = 0; index < segments.length; index++) {
			const entry = (await this.rawList(current)).find(e => key(e.name) === key(segments[index]));
			if (!entry || entry.isDirectory !== (index < segments.length - 1 || directory)) { return undefined; }
			current = `${current}/${entry.name}`;
		}
		return current;
	}

	async list(remotePath: string, refresh = false): Promise<FtpEntry[]> {
		this.check();
		const remote = await this.find(remotePath, true);
		if (!remote) { throw new Error(`원격 폴더를 찾을 수 없습니다: ${remotePath}`); }
		return (await this.rawList(remote, refresh)).map(entry => ({ ...entry }));
	}

	async read(remotePath: string, refresh = false): Promise<Uint8Array> {
		this.check();
		const remote = await this.find(remotePath, false);
		if (!remote) { throw new Error(`원격 파일을 찾을 수 없습니다: ${remotePath}`); }
		const lookup = key(remote);
		const pending = this.readRequests.get(lookup);
		if (pending && (!refresh || pending.refresh)) { return new Uint8Array(await pending.promise); }
		const local = this.localPath(remote);
		this.ensureCacheDirectory(path.dirname(local));
		this.checkCacheFile(local);
		if (!refresh && this.reads.has(lookup) && fs.existsSync(local)) { return fs.readFileSync(local); }
		const request = (async () => {
			// 이전 읽기가 늦게 끝나 최신 캐시를 덮어쓰지 않도록 순서를 유지한다.
			if (pending) { await pending.promise.catch(() => undefined); }
			this.check();
			const bytes = await this.io.read(this.host, remote);
			this.check();
			this.ensureCacheDirectory(path.dirname(local));
			this.checkCacheFile(local);
			fs.writeFileSync(local, bytes);
			this.reads.add(lookup);
			return new Uint8Array(bytes);
		})();
		this.readRequests.set(lookup, { promise: request, refresh });
		try { return new Uint8Array(await request); } finally {
			if (this.readRequests.get(lookup)?.promise === request) { this.readRequests.delete(lookup); }
		}
	}

	private checkCacheFile(file: string): void {
		if (fs.existsSync(file) && (fs.lstatSync(file).isSymbolicLink() || !fs.statSync(file).isFile())) {
			throw new Error('임시 소스 캐시의 외부 파일 링크를 거부했습니다.');
		}
	}

	private ensureCacheDirectory(directory: string): void {
		const relative = path.relative(this.cacheRoot, directory);
		if (relative.startsWith('..') || path.isAbsolute(relative) || fs.lstatSync(this.cacheRoot).isSymbolicLink()) {
			throw new Error('임시 소스 캐시 경계가 바뀌었습니다.');
		}
		let current = this.cacheRoot;
		for (const part of relative.split(path.sep).filter(Boolean)) {
			current = path.join(current, part);
			if (!fs.existsSync(current)) { fs.mkdirSync(current); }
			if (fs.lstatSync(current).isSymbolicLink() || !fs.statSync(current).isDirectory()) {
				throw new Error('임시 소스 캐시의 외부 링크를 거부했습니다.');
			}
		}
	}

	async findProjects(remoteDir: string): Promise<Array<{ remotePath: string; gprPath: string; projectName: string }>> {
		const found: Array<{ remotePath: string; gprPath: string; projectName: string }> = [];
		let visited = 0;
		const walk = async (directory: string, depth: number): Promise<void> => {
			if (++visited > MAX_DIRS || depth > MAX_DEPTH) { throw new Error('원격 프로젝트 탐색 상한을 넘었습니다. 더 가까운 폴더를 선택하세요.'); }
			const entries = await this.list(directory);
			const gpr = preferredGpr(entries);
			if (gpr) {
				if (found.length >= MAX_PROJECTS) { throw new Error('원격 프로젝트 개수 상한을 넘었습니다. 더 가까운 폴더를 선택하세요.'); }
				const gprPath = `${directory}/${gpr.name}`;
				const parsed = parseGprText(Buffer.from(await this.read(gprPath)).toString('utf8'));
				found.push({ remotePath: directory, gprPath, projectName: parsed.projectName?.trim() || path.posix.basename(directory) });
			}
			for (const entry of entries) {
				if (entry.isDirectory && !isSkippedScanDir(entry.name)) { await walk(`${directory}/${entry.name}`, depth + 1); }
			}
		};
		const directory = await this.find(remoteDir, true);
		if (!directory) { throw new Error(`원격 폴더를 찾을 수 없습니다: ${remoteDir}`); }
		await walk(directory, 1);
		return found;
	}

	/** ProjectSource 상대 경로는 허용하되 해석한 결과는 반드시 연결한 루트 안이어야 한다. */
	private metadataRemote(base: string, raw: string): string {
		const value = raw.replace(/\\/g, '/').trim();
		if (!value || /^[a-z]:/i.test(value) || value.startsWith('//')) { throw new Error(`안전하지 않은 프로젝트 경로입니다: ${raw}`); }
		for (const segment of value.split('/').filter(p => p && p !== '.' && p !== '..')) { assertSegment(segment); }
		return this.remote(path.posix.resolve(base, value));
	}

	private async ownedSources(remoteDir: string): Promise<string[]> {
		const sources: string[] = [];
		let visited = 0;
		const walk = async (directory: string, depth: number): Promise<void> => {
			if (++visited > MAX_DIRS || depth > MAX_DEPTH) { throw new Error('원격 소스 목록 탐색 상한을 넘었습니다.'); }
			const entries = await this.list(directory);
			if (depth > 1 && preferredGpr(entries)) { return; }
			for (const entry of entries) {
				if (entry.name.startsWith('.')) { continue; }
				if (entry.isDirectory) {
					if (!isSkippedScanDir(entry.name)) { await walk(`${directory}/${entry.name}`, depth + 1); }
				} else if (DEFAULT_SOURCE_EXTENSIONS.includes(path.posix.extname(entry.name).toLowerCase())) {
					if (sources.length >= MAX_SOURCES) { throw new Error('원격 소스 파일 개수 상한을 넘었습니다.'); }
					sources.push(`${directory}/${entry.name}`);
				}
			}
		};
		await walk(remoteDir, 1);
		return sources;
	}

	prepareProject(gprRemotePath: string): Promise<RemoteDebugProject> {
		this.check();
		if (this.prepareRequest) { return Promise.reject(new Error('다른 원격 프로젝트의 메타데이터를 준비 중입니다.')); }
		const request = this.prepare(gprRemotePath);
		this.prepareRequest = request;
		void request.finally(() => { this.prepareRequest = undefined; }).catch(() => undefined);
		return request;
	}

	private async prepare(gprRemotePath: string): Promise<RemoteDebugProject> {
		const remoteGpr = await this.find(gprRemotePath, false);
		if (!remoteGpr || !/\.gpr$/i.test(remoteGpr)) { throw new Error(`원격 프로젝트 파일을 찾을 수 없습니다: ${gprRemotePath}`); }
		const records = new Map<string, Metadata>();
		const load = async (remote: string, syntheticSources?: string[]): Promise<Metadata> => {
			const directory = path.posix.dirname(remote);
			const text = syntheticSources
				? `ProjectName="${path.posix.basename(directory)}"\n${syntheticSources.map(source => `ProjectSource="${path.posix.relative(directory, source)}"`).join('\n')}\n`
				: Buffer.from(await this.read(remote)).toString('utf8');
			const parsed = parseGprText(text);
			if (parsed.sources.length > MAX_SOURCES) { throw new Error('프로젝트 소스 선언 개수 상한을 넘었습니다.'); }
			const sources = [...new Set([...parsed.sources.map(source => this.metadataRemote(directory, source.path)), ...await this.ownedSources(directory)])];
			const record: Metadata = { remotePath: remote, gprPath: this.localPath(remote), dir: this.localPath(directory), text, sources, libraries: new Map(parsed.libraries.map(ref => [ref.path, undefined])) };
			if (syntheticSources) {
				// 기존 그래프와 DAP의 디스크 탐색에도 같은 라이브러리 관계가 보여야 한다. 소스 내용은 만들지 않는다.
				this.ensureCacheDirectory(record.dir);
				this.checkCacheFile(record.gprPath);
				fs.writeFileSync(record.gprPath, text, 'utf8');
			}
			records.set(key(record.dir), record);
			return record;
		};
		const root = await load(remoteGpr);
		const queue: Array<{ record: Metadata; depth: number }> = [{ record: root, depth: 1 }];
		for (let index = 0; index < queue.length; index++) {
			if (queue.length > MAX_PROJECTS) { throw new Error('참조 라이브러리 개수 상한을 넘었습니다.'); }
			const { record, depth } = queue[index];
			for (const raw of record.libraries.keys()) {
				// 원격 절대 경로와 조상 기준 후보는 기존 제어기 프로젝트 해석을 그대로 사용한다.
				const libraryRemote = this.metadataRemote(path.posix.dirname(record.remotePath), raw);
				const reference = /^[\\/]/.test(raw) ? libraryRemote : raw;
				for (const candidate of controllerLibraryCandidates(this.cacheRoot, this.root, record.dir, reference)) {
					const candidateRemote = this.remotePathForLocal(candidate);
					if (!candidateRemote) { continue; }
					const directory = await this.find(candidateRemote, true);
					if (!directory) { continue; }
					let library = records.get(key(this.localPath(directory)));
					if (!library) {
						const entries = await this.list(directory);
						const gpr = preferredGpr(entries);
						const looseSources = gpr ? undefined : await this.ownedSources(directory);
						if (!gpr && !looseSources?.length) { continue; }
						if (depth >= 8) { throw new Error('참조 라이브러리 깊이 상한을 넘었습니다.'); }
						library = await load(`${directory}/${gpr?.name ?? '.gpl-remote-library.gpr'}`, looseSources);
						queue.push({ record: library, depth: depth + 1 });
					}
					record.libraries.set(raw, library.dir);
					break;
				}
			}
		}
		const graphText = (record: Metadata): string => {
			const parsed = parseGprText(record.text);
			const lines = [...parsed.lines];
			for (const source of parsed.sources) { lines[source.line] = `ProjectSource="${this.localPath(this.metadataRemote(path.posix.dirname(record.remotePath), source.path))}"`; }
			for (const ref of parsed.libraries) {
				const resolved = record.libraries.get(ref.path);
				if (resolved) { lines[ref.line] = `ProjectLibrary="${resolved}"`; }
			}
			return lines.join('\n');
		};
		const graph = buildLibraryGraph(root.gprPath, graphText(root), {
			findGprInDir: directory => records.get(key(directory))?.gprPath,
			readText: file => {
				const record = records.get(key(path.dirname(file)));
				if (!record) { throw new Error(`메타데이터가 없는 라이브러리입니다: ${file}`); }
				return graphText(record);
			},
		});
		const active = new Map<string, RemoteSourceFile>();
		for (const node of graph.nodes.values()) {
			const record = records.get(key(node.dir))!;
			for (const declared of record.sources) {
				const actual = await this.find(declared, false);
				if (!actual) { throw new Error(`프로젝트에 선언된 원격 소스를 찾을 수 없습니다: ${declared}`); }
				if (!active.has(key(actual)) && active.size >= MAX_SOURCES) { throw new Error('디버깅 소스 파일 개수 상한을 넘었습니다.'); }
				active.set(key(actual), { remotePath: actual, localPath: this.localPath(actual), uri: this.uri(actual) });
			}
		}
		this.check();
		this.activeSources = active;
		this.activeProjectDir = path.posix.dirname(remoteGpr);
		return {
			projectName: parseGprText(root.text).projectName?.trim() || path.posix.basename(this.activeProjectDir),
			projectDir: root.dir, remotePath: this.activeProjectDir, gprPath: root.gprPath,
			sourcePaths: [...active.values()].map(source => source.localPath), unresolvedLibraries: graph.unresolved,
		};
	}

	resolveSource(file: string): RemoteSourceFile | undefined {
		this.check();
		if (!this.activeProjectDir || !file) { return undefined; }
		const exact = (remote: string | undefined): RemoteSourceFile | undefined => remote ? this.activeSources.get(key(remote)) : undefined;
		if (/^[a-z][a-z\d+.-]*:\/\//i.test(file)) { return exact(this.remotePathFromUri(file)); }
		const local = this.remotePathForLocal(file);
		if (local) { return exact(local); }
		const value = file.replace(/\\/g, '/');
		try {
			if (value.startsWith('/')) { return exact(this.remote(value)); }
			if (/^[a-z]:/i.test(value)) { return undefined; }
			value.split('/').forEach(assertSegment);
			if (!value.includes('/')) {
				const byName = [...this.activeSources.values()].filter(source => key(path.posix.basename(source.remotePath)) === key(value));
				return byName.length === 1 ? byName[0] : undefined;
			}
			const matches = [...new Set([
				exact(this.remote(`${this.activeProjectDir}/${value}`)), exact(this.remote(`${this.root}/${value}`)),
			].filter((source): source is RemoteSourceFile => !!source))];
			if (matches.length === 1) { return matches[0]; }
			if (matches.length > 1) { return undefined; }
			const suffix = `/${key(value)}`;
			const candidates = [...this.activeSources.values()].filter(source => key(source.remotePath).endsWith(suffix));
			return candidates.length === 1 ? candidates[0] : undefined;
		} catch { return undefined; }
	}

	async ensureSource(file: string): Promise<RemoteSourceFile | undefined> {
		const source = this.resolveSource(file);
		if (source) { await this.read(source.remotePath); }
		return source;
	}

	dispose(): void {
		if (this.disposed) { return; }
		this.disposed = true;
		sessions.delete(this.id);
		this.activeSources.clear();
		this.listings.clear();
		this.known.clear();
		this.reads.clear();
		if (!fs.existsSync(this.cacheRoot)) { return; }
		if (path.dirname(this.cacheRoot) !== this.cacheParent || !path.basename(this.cacheRoot).startsWith('gpl-remote-')
			|| fs.lstatSync(this.cacheRoot).isSymbolicLink() || fs.realpathSync(this.cacheRoot) !== this.cacheRoot) {
			throw new Error('임시 소스 캐시 경계가 바뀌어 자동 정리를 중단했습니다.');
		}
		fs.rmSync(this.cacheRoot, { recursive: true, force: true });
	}
}
