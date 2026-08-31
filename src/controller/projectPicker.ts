/**
 * 프로젝트 폴더 선택 — 모든 진입점(명령 팔레트·탐색기 우클릭·F5 launch 구성·트리뷰) 공용.
 *
 * 규칙(순수 로직은 projectPickerCore.ts):
 * - 명시 리소스(우클릭한 폴더/.gpr/소스 파일)가 있으면 QuickPick 없이 그 프로젝트로 확정한다.
 * - 후보가 1개면 즉시, 2개 이상이면 QuickPick(최근 선택이 맨 위). 선택은 workspaceState에 기억한다.
 * - 저장 트리거(autoOnSave)처럼 UI를 띄우면 안 되는 경로는 이 모듈을 쓰지 않는다
 *   (저장 파일 위치로 결정 — extension.ts resolveProjectDirForFile).
 * - 탐색기 메뉴 표시 조건용으로 감지된 프로젝트 폴더 목록을 context key `gpl.projectDirs`에 올린다.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { findProjectDirs } from './deployService';
import { parseGpr } from './responseParser';
import { gprPathInDir, resolveProjectLibraryDirs } from '../project/projectSources';
import {
    filterDirsByProjectName,
    normalizeDirKey,
    orderProjectDirs,
    projectDirFromResource,
} from './projectPickerCore';

const LAST_PICK_KEY = 'gpl.projectPicker.lastDir';
/** when-clause: `explorerResourceIsFolder && resourcePath in gpl.projectDirs` */
export const PROJECT_DIRS_CONTEXT_KEY = 'gpl.projectDirs';

let workspaceState: vscode.Memento | undefined;

/** 프로젝트 폴더의 .gpr에서 ProjectName을 읽는다 (없거나 실패 시 undefined). */
export function readGprProjectName(projectDir: string): string | undefined {
    try {
        const gprFile = fs.readdirSync(projectDir).find(f => f.toLowerCase().endsWith('.gpr'));
        if (!gprFile) { return undefined; }
        return parseGpr(fs.readFileSync(path.join(projectDir, gprFile), 'utf8')).projectName || undefined;
    } catch {
        return undefined;
    }
}

/** 제어기 쪽 프로젝트명: .gpr ProjectName, 없으면 폴더명 (deployService.deploy와 같은 규칙). */
export function projectNameOf(projectDir: string): string {
    return readGprProjectName(projectDir) ?? path.basename(projectDir);
}

/**
 * 후보 중 다른 프로젝트가 `ProjectLibrary`로 참조하는 폴더 → 참조하는 프로젝트명.
 *
 * 중첩 프로젝트(`MyProject/MyLibrary`)는 목록에서 폴더명만 보면 최상위 프로젝트와 구분되지 않아
 * 라이브러리만 배포·실행하는 실수를 부른다. 목록에서 빼지는 않는다 — 라이브러리도 열어 편집하고
 * 따로 배포할 수 있어야 한다. 어느 쪽인지 **보이게** 하는 것이 목적이다.
 */
export function mapLibraryDirs(dirs: readonly string[]): Map<string, string> {
    const gprPaths = dirs.map(d => gprPathInDir(d)).filter((g): g is string => !!g);
    const byLibrary = new Map<string, string>();
    for (const gprPath of gprPaths) {
        let text: string;
        try {
            text = fs.readFileSync(gprPath, 'utf8');
        } catch {
            continue;
        }
        if (!/ProjectLibrary/i.test(text)) { continue; }
        const owner = path.dirname(gprPath);
        for (const libDir of resolveProjectLibraryDirs(gprPath, text, { knownGprPaths: gprPaths }).dirs) {
            const key = normalizeDirKey(libDir);
            if (!byLibrary.has(key)) { byLibrary.set(key, projectNameOf(owner)); }
        }
    }
    return byLibrary;
}

export interface PickProjectDirOptions {
    placeHolder: string;
    /** 명시 리소스(탐색기 우클릭 등). 주면 QuickPick 없이 그 리소스가 속한 프로젝트로 확정한다. */
    resource?: vscode.Uri | string;
    /** launch.json projectName 등 이름 필터. 일치하는 후보가 있으면 그 안에서만 고른다. */
    projectName?: string;
    /** true면 경고 메시지를 띄우지 않는다(호출측이 폴백을 가진 경우). */
    silent?: boolean;
}

export type PickProjectDirResult =
    | { kind: 'picked'; dir: string; prompted: boolean }
    | { kind: 'none' }        // 워크스페이스에 .gpr 프로젝트가 없음
    | { kind: 'not-found' }   // 명시 리소스가 어느 프로젝트에도 속하지 않음
    | { kind: 'cancelled' };  // 사용자가 QuickPick을 취소

/** 결과 종류까지 필요한 호출측(F5 구성 해석 등)용. */
export async function pickProjectDirDetailed(opts: PickProjectDirOptions): Promise<PickProjectDirResult> {
    const dirs = await findProjectDirs();

    if (opts.resource) {
        const fsPath = typeof opts.resource === 'string' ? opts.resource : opts.resource.fsPath;
        let isDirectory = false;
        try { isDirectory = fs.statSync(fsPath).isDirectory(); } catch { /* 없는 경로 → 파일 취급 */ }
        const hit = projectDirFromResource(fsPath, dirs, isDirectory);
        if (hit) { return { kind: 'picked', dir: hit, prompted: false }; }
        // 명시 리소스인데 못 찾으면 QuickPick으로 넘어가지 않는다 — 의도와 다른 대상에 업로드하는 일 방지.
        if (!opts.silent) {
            vscode.window.showWarningMessage(`'${path.basename(fsPath)}'에서 GPL 프로젝트(.gpr) 폴더를 찾을 수 없습니다.`);
        }
        return { kind: 'not-found' };
    }

    if (dirs.length === 0) {
        if (!opts.silent) {
            vscode.window.showWarningMessage('워크스페이스에서 .gpr 프로젝트 파일을 찾을 수 없습니다.');
        }
        return { kind: 'none' };
    }

    let candidates = dirs;
    if (opts.projectName) {
        const filtered = filterDirsByProjectName(dirs, opts.projectName, readGprProjectName);
        if (filtered.length > 0) { candidates = filtered; }
    }
    if (candidates.length === 1) {
        return { kind: 'picked', dir: candidates[0], prompted: false };
    }

    const last = workspaceState?.get<string>(LAST_PICK_KEY);
    const lastKey = last ? normalizeDirKey(last) : '';
    const libraryOwners = mapLibraryDirs(candidates);
    const items = orderProjectDirs(candidates, last).map(dir => {
        const folderName = path.basename(dir);
        const name = projectNameOf(dir);
        const owner = libraryOwners.get(normalizeDirKey(dir));
        const notes = [
            name.toLowerCase() !== folderName.toLowerCase() ? `ProjectName=${name}` : undefined,
            owner ? `라이브러리 · ${owner}에서 참조` : undefined,
            lastKey && normalizeDirKey(dir) === lastKey ? '최근 선택' : undefined,
        ].filter(Boolean);
        return {
            label: `$(${owner ? 'library' : 'folder'}) ${folderName}`,
            description: notes.join(' · '),
            detail: dir,
            dir,
        };
    });
    const pick = await vscode.window.showQuickPick(items, {
        placeHolder: opts.placeHolder,
        matchOnDescription: true,
        matchOnDetail: true,
    });
    if (!pick) { return { kind: 'cancelled' }; }
    await workspaceState?.update(LAST_PICK_KEY, pick.dir);
    return { kind: 'picked', dir: pick.dir, prompted: true };
}

/** 폴더 경로만 필요한 호출측용(명령 등). 실패/취소는 undefined. */
export async function pickProjectDir(opts: PickProjectDirOptions): Promise<string | undefined> {
    const r = await pickProjectDirDetailed(opts);
    return r.kind === 'picked' ? r.dir : undefined;
}

/** 감지된 프로젝트 폴더 목록을 context key에 올린다(탐색기 우클릭 메뉴 표시 조건). */
export async function updateProjectDirsContext(): Promise<string[]> {
    const dirs = await findProjectDirs();
    await vscode.commands.executeCommand('setContext', PROJECT_DIRS_CONTEXT_KEY, dirs);
    return dirs;
}

/** 활성화 시 1회 호출 — 최근 선택 저장소 연결 + .gpr 생성/삭제·워크스페이스 변경에 따라 context key 갱신. */
export function activateProjectPicker(context: vscode.ExtensionContext): void {
    workspaceState = context.workspaceState;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = (): void => {
        if (timer) { clearTimeout(timer); }
        timer = setTimeout(() => { timer = undefined; void updateProjectDirsContext(); }, 300);
    };
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.gpr');
    context.subscriptions.push(
        watcher,
        watcher.onDidCreate(refresh),
        watcher.onDidDelete(refresh),
        vscode.workspace.onDidChangeWorkspaceFolders(refresh),
        { dispose: () => { if (timer) { clearTimeout(timer); timer = undefined; } } },
    );
    void updateProjectDirsContext();
}
