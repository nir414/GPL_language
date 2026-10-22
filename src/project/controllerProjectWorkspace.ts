/**
 * FTP에서 내려받은 제어기 프로젝트의 로컬 작업공간 메타데이터.
 *
 * 숨김 manifest가 다운로드 루트·원격 출처·쓰기 모드의 SSOT다. 제어기에는 dot 파일을
 * 업로드하지 않으므로 이 파일은 로컬에만 남는다(ftpClient.getAllFiles의 제외 규칙).
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export const CONTROLLER_PROJECT_MANIFEST_FILE = '.gpl-controller-project.json';
export const CONTROLLER_PROJECT_MANIFEST_KIND = 'gpl-controller-project';
export const CONTROLLER_PROJECT_MANIFEST_VERSION = 1;

export type ControllerProjectMode = 'live' | 'snapshot';

export interface ControllerProjectFileStamp {
    path: string;
    size: number;
    sha256: string;
}

export interface ControllerProjectManifest {
    kind: typeof CONTROLLER_PROJECT_MANIFEST_KIND;
    version: typeof CONTROLLER_PROJECT_MANIFEST_VERSION;
    mode: ControllerProjectMode;
    controllerHost: string;
    sourceRemotePath: string;
    projectName: string;
    downloadedAt: string;
    files: ControllerProjectFileStamp[];
}

export interface ControllerProjectContext {
    root: string;
    manifest: ControllerProjectManifest;
}

export interface ControllerProjectWriteBlock {
    kind: 'read-only' | 'controller-mismatch';
    message: string;
    context: ControllerProjectContext;
}

function normalizeRelativePath(value: string): string {
    return value.split(path.sep).join('/');
}

function hashFile(filePath: string): string {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function collectFiles(root: string, current: string, out: ControllerProjectFileStamp[]): void {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) { continue; }
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
            collectFiles(root, full, out);
            continue;
        }
        if (!entry.isFile()) { continue; }
        const stat = fs.statSync(full);
        out.push({
            path: normalizeRelativePath(path.relative(root, full)),
            size: stat.size,
            sha256: hashFile(full),
        });
    }
}

export function snapshotControllerProjectFiles(root: string): ControllerProjectFileStamp[] {
    const files: ControllerProjectFileStamp[] = [];
    collectFiles(path.resolve(root), path.resolve(root), files);
    return files.sort((a, b) => a.path.localeCompare(b.path));
}

export function writeControllerProjectManifest(
    root: string,
    input: Omit<ControllerProjectManifest, 'kind' | 'version' | 'files'>,
): ControllerProjectManifest {
    const manifest: ControllerProjectManifest = {
        kind: CONTROLLER_PROJECT_MANIFEST_KIND,
        version: CONTROLLER_PROJECT_MANIFEST_VERSION,
        ...input,
        files: snapshotControllerProjectFiles(root),
    };
    const manifestPath = path.join(root, CONTROLLER_PROJECT_MANIFEST_FILE);
    // manifest는 아직 공개되지 않은 staging 폴더 안에서 쓴다. 프로젝트 폴더 전체를 마지막에 rename하므로
    // 여기서 다시 temp+rename을 겹치지 않는다(Windows AppContainer가 파일 rename을 막는 환경도 있음).
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    return manifest;
}

function isControllerProjectManifest(value: unknown): value is ControllerProjectManifest {
    if (!value || typeof value !== 'object') { return false; }
    const v = value as Partial<ControllerProjectManifest>;
    return v.kind === CONTROLLER_PROJECT_MANIFEST_KIND
        && v.version === CONTROLLER_PROJECT_MANIFEST_VERSION
        && (v.mode === 'live' || v.mode === 'snapshot')
        && typeof v.controllerHost === 'string'
        && typeof v.sourceRemotePath === 'string'
        && typeof v.projectName === 'string'
        && typeof v.downloadedAt === 'string'
        && Array.isArray(v.files);
}

export function readControllerProjectManifest(root: string): ControllerProjectManifest | undefined {
    try {
        const parsed: unknown = JSON.parse(fs.readFileSync(
            path.join(root, CONTROLLER_PROJECT_MANIFEST_FILE),
            'utf8',
        ));
        return isControllerProjectManifest(parsed) ? parsed : undefined;
    } catch {
        return undefined;
    }
}

/** 파일/폴더에서 위로 올라가 가장 가까운 다운로드 manifest를 찾는다. */
export function findControllerProjectContext(inputPath: string): ControllerProjectContext | undefined {
    let current = path.resolve(inputPath);
    try {
        if (fs.statSync(current).isFile()) { current = path.dirname(current); }
    } catch {
        current = path.dirname(current);
    }

    while (true) {
        const manifest = readControllerProjectManifest(current);
        if (manifest) { return { root: current, manifest }; }
        const parent = path.dirname(current);
        if (parent === current) { return undefined; }
        current = parent;
    }
}

/** Deploy/F5/autoOnSave/Save to Flash가 공유하는 다운로드 사본 쓰기 게이트. */
export function getControllerProjectWriteBlock(
    inputPath: string,
    currentControllerHost: string,
): ControllerProjectWriteBlock | undefined {
    const context = findControllerProjectContext(inputPath);
    if (!context) { return undefined; }
    if (context.manifest.mode === 'snapshot') {
        return {
            kind: 'read-only',
            message: 'Read-only Snapshot은 제어기 쓰기 작업을 실행할 수 없습니다. Live Working Copy로 다시 다운로드하세요.',
            context,
        };
    }
    if (context.manifest.controllerHost.trim().toLowerCase() !== currentControllerHost.trim().toLowerCase()) {
        return {
            kind: 'controller-mismatch',
            message: `다운로드 원본 제어기(${context.manifest.controllerHost})와 현재 대상(${currentControllerHost})이 달라 쓰기 작업을 차단했습니다.`,
            context,
        };
    }
    return undefined;
}

/** 다운로드 루트 아래의 중첩 .gpr 폴더들을 원격 FTP 프로젝트 루트 하나로 접는다. */
export function collapseControllerProjectDirs(projectDirs: readonly string[]): string[] {
    const collapsed = projectDirs.map(dir => findControllerProjectContext(dir)?.root ?? path.resolve(dir));
    return [...new Set(collapsed.map(dir => path.resolve(dir)))];
}

/** 기존 로컬 사본을 덮어쓰지 않는 다운로드 대상 경로를 고른다. */
export function chooseAvailableDownloadDir(parentDir: string, projectName: string): string {
    const base = path.join(parentDir, projectName);
    if (!fs.existsSync(base)) { return base; }
    for (let i = 2; i < 10_000; i++) {
        const candidate = `${base}-${i}`;
        if (!fs.existsSync(candidate)) { return candidate; }
    }
    throw new Error(`다운로드 대상 폴더 이름을 만들 수 없습니다: ${base}`);
}

export function makeDownloadStagingDir(parentDir: string, projectName: string): string {
    const safeName = projectName.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60) || 'project';
    return fs.mkdtempSync(path.join(parentDir, `.gpl-download-${safeName}-`));
}

/** 이 기능이 만든 직계 staging 폴더만 삭제할 수 있게 경계를 고정한다. */
export function removeDownloadStagingDir(stagingDir: string, parentDir: string): void {
    const resolvedParent = path.resolve(parentDir);
    const resolvedStaging = path.resolve(stagingDir);
    const rel = path.relative(resolvedParent, resolvedStaging);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || path.dirname(rel) !== '.') {
        throw new Error(`임시 다운로드 폴더 경계가 올바르지 않습니다: ${resolvedStaging}`);
    }
    if (!path.basename(resolvedStaging).startsWith('.gpl-download-')) {
        throw new Error(`관리 대상이 아닌 폴더는 정리하지 않습니다: ${resolvedStaging}`);
    }
    fs.rmSync(resolvedStaging, { recursive: true, force: true });
}

export function controllerWorkspacePath(parentDir: string, controllerHost: string): string {
    const safeHost = controllerHost.replace(/[^A-Za-z0-9._-]+/g, '-');
    return path.join(parentDir, `gpl-controller-${safeHost}.code-workspace`);
}

/**
 * 선택한 상위 폴더 하나를 루트로 쓰는 저장된 workspace를 만든다.
 * 이후 프로젝트가 같은 폴더에 추가되어도 workspace folder 변경이 없어 Host 재시작과 신뢰 확인이 반복되지 않는다.
 */
export function ensureControllerWorkspaceFile(parentDir: string, controllerHost: string): string {
    const workspacePath = controllerWorkspacePath(parentDir, controllerHost);
    let existing: Record<string, unknown> = {};
    if (fs.existsSync(workspacePath)) {
        try {
            const parsed: unknown = JSON.parse(fs.readFileSync(workspacePath, 'utf8'));
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                existing = parsed as Record<string, unknown>;
            }
        } catch {
            throw new Error(`작업 영역 파일을 읽을 수 없습니다: ${workspacePath}`);
        }
    }
    const next = {
        ...existing,
        folders: [{ path: '.', name: `GPL Controller ${controllerHost}` }],
    };
    fs.writeFileSync(workspacePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    return workspacePath;
}
