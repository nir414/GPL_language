/**
 * Project.gpr 소스 목록 동기화 — VS Code 명령·자동 반영 (순수 로직은 gprSync.ts).
 *
 * - 명령 `gpl.project.syncSources`: 탐색기에서 .gpr 우클릭(Uri) 또는 팔레트(프로젝트 선택) →
 *   폴더의 소스 파일과 ProjectSource 목록을 대조해 추가/제거 항목을 QuickPick(다중 선택)으로 확인 후 반영.
 *   .gpr가 없는 폴더면 새로 만들지 물어본다.
 * - 자동 반영(`gpl.project.autoSyncSources`): VS Code 안에서 .gpl을 새로 만들거나 이름 변경·삭제하면
 *   해당 프로젝트의 Project.gpr에 반영할지 묻거나(prompt, 기본) 바로 반영(auto)한다. 에디터 밖 변경
 *   (git checkout 등)에는 반응하지 않는다 — 대량 변경을 조용히 .gpr에 쓰지 않기 위해.
 * - 편집은 WorkspaceEdit로 적용해 열려 있는(더티 포함) 문서와 충돌하지 않고 Undo가 된다.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { findProjectDirs } from './deployService';
import { pickProjectDir } from './projectPicker';
import { isPathUnder, normalizeDirKey } from './projectPickerCore';
import { GPR_PATH_SEPARATOR, listSourceFilesRecursive } from '../project/projectSources';
import {
    applyGprSync,
    createGprText,
    parseGprText,
    planGprSync,
    GprSyncPlan,
} from './gprSync';

export const GPR_SYNC_COMMAND = 'gpl.project.syncSources';

type AutoSyncMode = 'prompt' | 'auto' | 'off';

export interface GprSyncDeps {
    log: (line: string) => void;
    /** .gpr 변경 후 심볼 인덱스를 다시 만들 콜백(Project.gpr 기반 인덱싱이라 목록이 바뀌면 필요). */
    refreshSymbols?: () => Promise<void> | void;
}

function sourceExtensions(): string[] {
    const raw = vscode.workspace.getConfiguration('gpl').get<unknown>('project.sourceExtensions');
    const list = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];
    return list.length > 0 ? list : ['.gpl'];
}

function autoSyncMode(): AutoSyncMode {
    const raw = vscode.workspace.getConfiguration('gpl').get<unknown>('project.autoSyncSources');
    return raw === 'auto' || raw === 'off' ? raw : 'prompt';
}

function findGprFile(projectDir: string): string | undefined {
    try {
        const names = fs.readdirSync(projectDir).filter(f => f.toLowerCase().endsWith('.gpr'));
        // Project.gpr 우선, 없으면 첫 .gpr
        const preferred = names.find(f => f.toLowerCase() === 'project.gpr') ?? names[0];
        return preferred ? path.join(projectDir, preferred) : undefined;
    } catch {
        return undefined;
    }
}

/**
 * 프로젝트 폴더 아래 소스 파일 목록 — **하위 폴더 포함(재귀)**, 폴더 기준 상대 경로.
 *
 * `.gpr`의 `ProjectSource`는 상대 경로여서 `T1\T2\T2.gpl`처럼 임의 깊이로 중첩될 수 있다
 * (2026-08-28 실제 파일 확인). 종전에는 폴더 직속 파일만 훑어 하위 폴더 소스를 추가하지 못했고,
 * 이미 목록에 있던 하위 폴더 항목을 "파일 없음"으로 보고 제거를 제안했다.
 * 구분자는 GDE가 쓰는 `\`로 맞춘다(기존 항목과 형식이 어긋나지 않게).
 *
 * 단, **자기 `.gpr`를 가진 하위 폴더는 다른 프로젝트**이므로 목록에 넣지 않는다
 * (`projects/MyProject/MyLibrary/`, 2026-08-31 실측). 그 파일들은 `ProjectLibrary` 참조로 이미
 * 함께 컴파일되므로, 상위 프로젝트의 `ProjectSource`에 또 넣으면 이중 등록이 된다.
 */
function listSourceFiles(projectDir: string, log?: (line: string) => void): string[] {
    const listed = listSourceFilesRecursive(projectDir, {
        extensions: sourceExtensions(),
        separator: GPR_PATH_SEPARATOR,
    });
    if (listed.truncated) {
        log?.(`[GprSync] ⚠ ${projectDir}: 소스 탐색 상한(파일 수·깊이)에 걸려 일부 파일은 목록에서 빠졌습니다.`);
    }
    if (listed.nestedProjects.length > 0) {
        const names = listed.nestedProjects.map(d => path.relative(projectDir, d) || path.basename(d));
        log?.(`[GprSync] 중첩 프로젝트는 동기화 대상에서 제외: ${names.join(', ')} `
            + '(별개 .gpr — 라이브러리라면 ProjectLibrary 참조로 함께 컴파일됩니다)');
    }
    return listed.files;
}

/** `.gpr` 항목(상대 경로)이 실제 디스크에 있는지 — 제거 제안은 이 확인을 통과해야 한다. */
function makeExistsOnDisk(projectDir: string): (relPath: string) => boolean {
    return (relPath: string): boolean => {
        const native = relPath.trim().replace(/[\\/]+/g, path.sep);
        if (!native) { return false; }
        const full = path.isAbsolute(native) ? native : path.join(projectDir, native);
        try {
            return fs.statSync(full).isFile();
        } catch {
            return false;
        }
    };
}

interface SyncTarget { projectDir: string; gprPath: string }

/** 명령 인자(Uri/문자열/없음)에서 대상 .gpr를 정한다. 없으면 만들지 물어본다. */
async function resolveTarget(resource: unknown, interactive: boolean): Promise<SyncTarget | undefined> {
    let hint: string | undefined;
    if (resource instanceof vscode.Uri) { hint = resource.fsPath; }
    else if (typeof resource === 'string') { hint = resource; }

    if (hint && hint.toLowerCase().endsWith('.gpr') && fs.existsSync(hint)) {
        return { projectDir: path.dirname(hint), gprPath: hint };
    }

    let projectDir: string | undefined;
    if (hint) {
        // 폴더(또는 폴더 안 파일)가 넘어온 경우: .gpr가 있으면 그 프로젝트, 없으면 그 폴더에 새로 만들 후보
        const dirs = await findProjectDirs();
        let isDir = false;
        try { isDir = fs.statSync(hint).isDirectory(); } catch { /* 파일 취급 */ }
        const base = isDir ? hint : path.dirname(hint);
        projectDir = dirs.find(d => normalizeDirKey(d) === normalizeDirKey(base))
            ?? dirs.filter(d => isPathUnder(hint!, d)).sort((a, b) => b.length - a.length)[0]
            ?? base;
    } else {
        projectDir = await pickProjectDir({ placeHolder: 'Project.gpr를 동기화할 프로젝트를 선택하세요' });
        if (!projectDir) { return undefined; }
    }

    const existing = findGprFile(projectDir);
    if (existing) { return { projectDir, gprPath: existing }; }

    if (!interactive) { return undefined; }
    const files = listSourceFiles(projectDir);
    const choice = await vscode.window.showInformationMessage(
        `'${path.basename(projectDir)}'에 Project.gpr가 없습니다. 소스 ${files.length}개로 새로 만들까요?`,
        { modal: true, detail: `ProjectName="${path.basename(projectDir)}", ProjectStart="Main" 으로 생성합니다. 이름/시작 프로시저는 생성 후 파일에서 고치세요.` },
        '만들기',
    );
    if (choice !== '만들기') { return undefined; }
    const gprPath = path.join(projectDir, 'Project.gpr');
    const text = createGprText({ projectName: path.basename(projectDir), sources: files });
    await vscode.workspace.fs.writeFile(vscode.Uri.file(gprPath), Buffer.from(text, 'utf8'));
    return { projectDir, gprPath };
}

interface SyncOutcome { added: string[]; removed: string[] }

/**
 * 대조 → (interactive면 QuickPick 확인) → 반영. 변경이 없으면 undefined.
 * confirmAll=true면 QuickPick 없이 계획 전체를 반영한다(자동 모드).
 */
async function syncGpr(target: SyncTarget, deps: GprSyncDeps, opts: { interactive: boolean; confirmAll?: boolean }): Promise<SyncOutcome | undefined> {
    const uri = vscode.Uri.file(target.gprPath);
    const doc = await vscode.workspace.openTextDocument(uri);
    const text = doc.getText();
    const parsed = parseGprText(text);
    const files = listSourceFiles(target.projectDir, deps.log);
    const plan: GprSyncPlan = planGprSync(parsed, files, { existsOnDisk: makeExistsOnDisk(target.projectDir) });

    if (plan.toAdd.length === 0 && plan.toRemove.length === 0) {
        if (opts.interactive) {
            vscode.window.setStatusBarMessage(`$(check) Project.gpr 이미 동기화됨 — 소스 ${plan.kept}개`, 4000);
        }
        return undefined;
    }

    let add = plan.toAdd;
    let remove = plan.toRemove;
    if (opts.interactive && !opts.confirmAll) {
        // QuickPickItem에는 이미 `kind`(구분선용)가 있어 다른 이름(op)을 쓴다.
        type Item = vscode.QuickPickItem & { op: 'add' | 'remove'; value: string; line?: number };
        const items: Item[] = [
            ...plan.toAdd.map<Item>(f => ({ label: `$(diff-added) ${f}`, description: '추가 — 폴더에 있지만 목록에 없음', picked: true, op: 'add', value: f })),
            ...plan.toRemove.map<Item>(e => ({ label: `$(diff-removed) ${e.path}`, description: '제거 — 목록에 있지만 파일이 없음', picked: true, op: 'remove', value: e.path, line: e.line })),
        ];
        const picked = await vscode.window.showQuickPick(items, {
            canPickMany: true,
            placeHolder: `${path.basename(target.gprPath)} 에 반영할 항목을 고르세요 (기존 ${plan.kept}개 유지)`,
            matchOnDescription: true,
        });
        if (!picked) { return undefined; }
        add = picked.filter(i => i.op === 'add').map(i => i.value);
        const removeLines = new Set(picked.filter(i => i.op === 'remove').map(i => i.line));
        remove = plan.toRemove.filter(e => removeLines.has(e.line));
        if (add.length === 0 && remove.length === 0) { return undefined; }
    }

    const next = applyGprSync(text, { add, removeLines: remove.map(e => e.line), now: new Date() });
    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(text.length));
    edit.replace(uri, fullRange, next);
    const ok = await vscode.workspace.applyEdit(edit);
    if (!ok) {
        vscode.window.showErrorMessage(`Project.gpr 편집을 적용하지 못했습니다: ${target.gprPath}`);
        return undefined;
    }
    await doc.save();

    const outcome: SyncOutcome = { added: add, removed: remove.map(e => e.path) };
    deps.log(`[GprSync] ${target.gprPath}: +${outcome.added.length} -${outcome.removed.length}`
        + (outcome.added.length ? ` | 추가: ${outcome.added.join(', ')}` : '')
        + (outcome.removed.length ? ` | 제거: ${outcome.removed.join(', ')}` : ''));
    try { await deps.refreshSymbols?.(); } catch (e) { deps.log(`[GprSync] 심볼 재인덱싱 실패: ${e}`); }
    return outcome;
}

function summarize(o: SyncOutcome): string {
    const parts: string[] = [];
    if (o.added.length) { parts.push(`추가 ${o.added.length}`); }
    if (o.removed.length) { parts.push(`제거 ${o.removed.length}`); }
    return parts.join(', ');
}

export function activateGprSync(context: vscode.ExtensionContext, deps: GprSyncDeps): void {
    context.subscriptions.push(
        vscode.commands.registerCommand(GPR_SYNC_COMMAND, async (resource?: unknown) => {
            const target = await resolveTarget(resource, true);
            if (!target) { return; }
            const outcome = await syncGpr(target, deps, { interactive: true });
            if (!outcome) { return; }
            const open = await vscode.window.showInformationMessage(
                `${path.basename(target.gprPath)} 갱신: ${summarize(outcome)}`,
                '파일 열기',
            );
            if (open === '파일 열기') {
                await vscode.window.showTextDocument(vscode.Uri.file(target.gprPath), { preview: false });
            }
        }),
    );

    // ── 자동 반영: VS Code 안에서의 생성/이름 변경/삭제만 ──
    const pending = new Map<string, ReturnType<typeof setTimeout>>();
    const scheduleForFiles = (uris: readonly vscode.Uri[]): void => {
        if (autoSyncMode() === 'off') { return; }
        const exts = new Set(sourceExtensions().map(e => (e.startsWith('.') ? e : `.${e}`).toLowerCase()));
        void (async () => {
            const dirs = await findProjectDirs();
            for (const uri of uris) {
                if (uri.scheme !== 'file' || !exts.has(path.extname(uri.fsPath).toLowerCase())) { continue; }
                // 이 파일을 포함하는 프로젝트 폴더 — 하위 폴더에 만든 파일도 대상이다(재귀 목록과 일치).
                // 중첩 프로젝트면 가장 가까운(가장 깊은) 프로젝트를 고른다.
                const dir = dirs
                    .filter(d => isPathUnder(uri.fsPath, d))
                    .sort((a, b) => normalizeDirKey(b).length - normalizeDirKey(a).length)[0];
                if (!dir) { continue; }
                const key = normalizeDirKey(dir);
                const prev = pending.get(key);
                if (prev) { clearTimeout(prev); }
                pending.set(key, setTimeout(() => { pending.delete(key); void autoSyncProject(dir); }, 600));
            }
        })();
    };
    const autoSyncProject = async (projectDir: string): Promise<void> => {
        const gprPath = findGprFile(projectDir);
        if (!gprPath) { return; }
        const target: SyncTarget = { projectDir, gprPath };
        const mode = autoSyncMode();
        if (mode === 'off') { return; }

        // 반영할 것이 있는지 먼저 계산(없으면 조용히 끝)
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(gprPath));
        const plan = planGprSync(
            parseGprText(doc.getText()),
            listSourceFiles(projectDir, deps.log),
            { existsOnDisk: makeExistsOnDisk(projectDir) },
        );
        if (plan.toAdd.length === 0 && plan.toRemove.length === 0) { return; }

        if (mode === 'auto') {
            const outcome = await syncGpr(target, deps, { interactive: false, confirmAll: true });
            if (outcome) { vscode.window.setStatusBarMessage(`$(check) ${path.basename(gprPath)} 자동 갱신: ${summarize(outcome)}`, 5000); }
            return;
        }
        const detail = [
            ...plan.toAdd.map(f => `+ ${f}`),
            ...plan.toRemove.map(e => `− ${e.path} (파일 없음)`),
        ].join('\n');
        const choice = await vscode.window.showInformationMessage(
            `${path.basename(projectDir)}/${path.basename(gprPath)} 소스 목록을 갱신할까요? (${plan.toAdd.length ? `추가 ${plan.toAdd.length}` : ''}${plan.toAdd.length && plan.toRemove.length ? ', ' : ''}${plan.toRemove.length ? `제거 ${plan.toRemove.length}` : ''})`,
            { detail },
            '반영',
            '항목 선택…',
        );
        if (choice === '반영') {
            const outcome = await syncGpr(target, deps, { interactive: true, confirmAll: true });
            if (outcome) { vscode.window.setStatusBarMessage(`$(check) ${path.basename(gprPath)} 갱신: ${summarize(outcome)}`, 5000); }
        } else if (choice === '항목 선택…') {
            await vscode.commands.executeCommand(GPR_SYNC_COMMAND, vscode.Uri.file(gprPath));
        }
    };

    context.subscriptions.push(
        vscode.workspace.onDidCreateFiles(e => scheduleForFiles(e.files)),
        vscode.workspace.onDidDeleteFiles(e => scheduleForFiles(e.files)),
        vscode.workspace.onDidRenameFiles(e => scheduleForFiles([...e.files.map(f => f.oldUri), ...e.files.map(f => f.newUri)])),
        { dispose: () => { for (const t of pending.values()) { clearTimeout(t); } pending.clear(); } },
    );
}
