/** 디버깅용 소스 다운로드. FTP 읽기만 하며 ProjectLibrary의 기존 경로 해석 규칙을 재사용한다. */
import * as fs from 'fs';
import * as path from 'path';
import { buildLibraryGraph, gprPathInDir } from '../../project/projectSources';
import { controllerLibraryCandidates } from '../../project/controllerProjectDebug';
import { writeControllerProjectManifest } from '../../project/controllerProjectWorkspace';
import { normalizePathKey } from '../../util/pathKey';
import { downloadProject, listRemoteDir, FtpEntry } from './ftpClient';

export interface ControllerDownloadIo {
    list: typeof listRemoteDir;
    download: typeof downloadProject;
}
const FTP_IO: ControllerDownloadIo = { list: listRemoteDir, download: downloadProject };
export type DownloadProgress = (message: string) => void;

export async function downloadControllerProjectCopy(
    host: string, remotePath: string, localDir: string, progress: DownloadProgress,
    io: ControllerDownloadIo = FTP_IO,
): Promise<void> {
    // 새 세션 안의 비어 있는 폴더에만 받는다. 기존 사본과 부분 전송 파일을 섞지 않는다.
    if (fs.existsSync(localDir) && fs.readdirSync(localDir).length > 0) {
        throw new Error(`다운로드 대상이 비어 있지 않습니다: ${localDir}`);
    }
    fs.mkdirSync(localDir, { recursive: true });
    await io.download(host, remotePath, localDir, (current, total, file) => progress(`${remotePath}: ${current}/${total} ${file}`));
    writeControllerProjectManifest(localDir, {
        mode: 'snapshot', controllerHost: host, sourceRemotePath: remotePath,
        projectName: path.posix.basename(remotePath), downloadedAt: new Date().toISOString(),
    });
}

export async function downloadControllerLibraries(
    host: string, remoteRoot: string, sourceRoot: string, gprPath: string, progress: DownloadProgress,
    io: ControllerDownloadIo = FTP_IO,
): Promise<string[]> {
    const checked = new Set<string>();
    const listings = new Map<string, FtpEntry[]>();
    const list = async (remote: string): Promise<FtpEntry[]> => {
        const cached = listings.get(remote);
        if (cached) { return cached; }
        const entries = await io.list(host, remote);
        listings.set(remote, entries);
        return entries;
    };
    const findDirectory = async (relative: string): Promise<{ branch: string; entries: FtpEntry[] } | undefined> => {
        let current = remoteRoot;
        let branch = '';
        for (const segment of relative.split('/')) {
            // 없는 경로의 LIST 응답이 표준 FTP 오류가 아닌 서버도 있다. 확인한 부모 목록에서만 내려간다.
            const entry = (await list(current)).find(e => e.isDirectory && e.name.toLowerCase() === segment.toLowerCase());
            if (!entry) { return undefined; }
            if (!branch) { branch = entry.name; }
            current = path.posix.join(current, entry.name);
        }
        return { branch, entries: await list(current) };
    };
    while (true) {
        const graph = buildLibraryGraph(gprPath, fs.readFileSync(gprPath, 'utf8'));
        let downloaded = false;
        for (const node of graph.nodes.values()) {
            for (const ref of node.refs.filter(r => !r.dir)) {
                for (const candidate of controllerLibraryCandidates(sourceRoot, remoteRoot, node.dir, ref.raw)) {
                    const key = normalizePathKey(candidate);
                    if (checked.has(key) || gprPathInDir(candidate)) { continue; }
                    checked.add(key);
                    const relative = path.relative(sourceRoot, candidate).split(path.sep).join('/');
                    const remote = path.posix.join(remoteRoot, relative);
                    let directory;
                    try {
                        directory = await findDirectory(relative);
                    } catch (err) {
                        // 후보 폴더 없음은 다음 기준점을 시도한다. 통신 실패는 누락으로 숨기지 않는다.
                        if ((err as { code?: number }).code === 550) { continue; }
                        throw new Error(`라이브러리 FTP 경로 확인 실패 (${remote}): ${err instanceof Error ? err.message : String(err)}`);
                    }
                    if (!directory?.entries.some(e => !e.isDirectory && /\.gpr$/i.test(e.name))) { continue; }
                    // 최상위 폴더를 한 번 받아 형제·중첩 라이브러리의 상대 배치를 보존한다.
                    const branch = directory.branch;
                    const branchDir = path.join(sourceRoot, branch);
                    if (fs.existsSync(branchDir)) { continue; }
                    await downloadControllerProjectCopy(host, path.posix.join(remoteRoot, branch), branchDir, progress, io);
                    downloaded = true;
                    break;
                }
            }
        }
        if (!downloaded) { return graph.unresolved; }
    }
}
