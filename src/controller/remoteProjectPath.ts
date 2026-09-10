/**
 * 원격 프로젝트 폴더 선택 — 어느 경로의 사본을 대상으로 삼을지 정하는 단일 정본 (vscode 무의존).
 *
 * 제어기에는 같은 이름의 프로젝트가 여러 위치에 있을 수 있다(`/flash/projects/<name>` 영구 사본과
 * `/GPL/<name>` 작업 사본). 어느 쪽을 Load/Compile 대상으로 삼느냐로 **결과가 달라지므로** 선택 규칙은
 * 한 곳에만 있어야 한다. 종전에는 배포(`deployService.chooseRemoteProjectPath`)와 FTP Run
 * (`ftpCommands.resolveFtpRunPath`)이 각자 점수식을 갖고 있어, 같은 프로젝트에 서로 다른 폴더를
 * 고를 수 있었다(2026-09-10, §1-DE).
 *
 * 점수 규칙(높을수록 우선):
 *   - 실제로 존재하는 폴더  +200  ← 가장 중요하다. 없는 경로로 Load 하면 그대로 실패한다.
 *   - flash 영구 사본       +80   ← 존재 여부가 같다면 영구 사본을 기준으로 본다.
 *   - 사용자가 고른 경로    +20   ← 트리에서 그 노드를 눌렀다면 그 뜻을 존중한다.
 *
 * 가점 크기 때문에 **고른 경로가 항상 이기지는 않는다**(flash 에 실제로 있으면 그쪽이 뽑힌다).
 * 옛 두 구현도 같았고, 그 경우를 `switched` 로 알려 로그에 남기는 것이 규약이다.
 *
 * 두 옛 구현의 순서는 이 식으로 모두 재현된다(배포의 300/200/120/100 계단은 exists·flash 조합과 같은 순서다).
 *
 * 단위 테스트: `src/test/remoteProjectPath.test.ts`
 */

/** 존재 확인에 필요한 최소 형태 — `ftpClient.FtpEntry` 가 그대로 들어맞는다. */
export interface RemoteDirEntry {
    name: string;
    isDirectory: boolean;
}

export interface ResolveRemoteProjectPathOptions {
    /** 찾을 프로젝트 폴더 이름. */
    projectFolderName: string;
    /** flash 영구 사본 기준 경로(설정 `ftpFlashProjectsPath`). */
    flashBasePath: string;
    /** 작업 사본 기준 경로(설정 `ftpBasePath`, 보통 `/GPL`). */
    gplBasePath: string;
    /** 그 밖에 후보로 넣을 기준 경로(예: 사용자가 고른 노드의 상위 폴더). */
    extraBasePaths?: string[];
    /** 사용자가 트리에서 고른 프로젝트 경로 — 동점일 때 이 경로를 우선한다. */
    selectedPath?: string;
    /** 기준 경로의 목록을 읽는다. 실패(예외)는 "존재 여부 미확인"으로 다룬다. */
    listDir(basePath: string): Promise<RemoteDirEntry[]>;
}

export interface RemoteProjectPathCandidate {
    basePath: string;
    projectPath: string;
    exists: boolean;
    rank: number;
}

export interface RemoteProjectPathChoice {
    basePath: string;
    projectPath: string;
    /** 점수순 후보 전부(로그용). */
    candidates: RemoteProjectPathCandidate[];
    /** 사용자가 고른 경로와 다른 곳을 골랐는가(로그로 알려야 한다). */
    switched: boolean;
}

const RANK_EXISTS = 200;
const RANK_FLASH = 80;
const RANK_SELECTED = 20;

/** 뒤쪽 슬래시를 떼고 비교·조합에 쓸 수 있는 형태로 만든다. */
function normalizeBase(p: string | undefined): string {
    return (p ?? '').trim().replace(/\/+$/, '');
}

function sameePath(a: string, b: string): boolean {
    return a.toLowerCase() === b.toLowerCase();
}

/** 후보 경로들을 점수순으로 정렬해 하나를 고른다. 후보가 하나도 없으면 작업 사본 기준 경로로 만든다. */
export async function resolveRemoteProjectPath(
    opts: ResolveRemoteProjectPathOptions,
): Promise<RemoteProjectPathChoice> {
    const name = opts.projectFolderName.trim();
    const flashBase = normalizeBase(opts.flashBasePath);
    const bases = [...new Set([
        flashBase,
        normalizeBase(opts.gplBasePath),
        ...(opts.extraBasePaths ?? []).map(normalizeBase),
    ].filter(Boolean))];
    const selected = normalizeBase(opts.selectedPath);

    const candidates: RemoteProjectPathCandidate[] = [];
    for (const basePath of bases) {
        const projectPath = `${basePath}/${name}`;
        let exists = false;
        try {
            const entries = await opts.listDir(basePath);
            exists = entries.some(e => e.isDirectory && sameePath(e.name.trim(), name));
        } catch {
            // 조회 실패는 "없음"이 아니라 "확인 못 함"이다 — 후보에서 빼지 않고 점수만 주지 않는다.
        }
        const rank = (exists ? RANK_EXISTS : 0)
            + (flashBase && sameePath(basePath, flashBase) ? RANK_FLASH : 0)
            + (selected && sameePath(projectPath, selected) ? RANK_SELECTED : 0);
        candidates.push({ basePath, projectPath, exists, rank });
    }

    candidates.sort((a, b) => b.rank - a.rank);
    const chosen = candidates[0] ?? {
        basePath: normalizeBase(opts.gplBasePath),
        projectPath: `${normalizeBase(opts.gplBasePath)}/${name}`,
        exists: false,
        rank: 0,
    };

    return {
        basePath: chosen.basePath,
        projectPath: chosen.projectPath,
        candidates,
        switched: selected.length > 0 && !sameePath(chosen.projectPath, selected),
    };
}

/** 로그 한 줄용 — `경로 (exists)` 나열. */
export function describeRemotePathCandidates(candidates: readonly RemoteProjectPathCandidate[]): string[] {
    return candidates.map(c => `${c.projectPath}${c.exists ? ' (exists)' : ''}`);
}
