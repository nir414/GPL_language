/**
 * Project.gpr 소스 목록 동기화 — VS Code 명령·자동 반영·배포 전 대조 (판단은 project/gprFolderSync.ts, 편집은 project/gprSync.ts).
 *
 * - 명령 `gpl.project.syncSources`: 탐색기에서 .gpr 우클릭(Uri) 또는 팔레트(프로젝트 선택) →
 *   폴더의 소스 파일과 ProjectSource 목록을 대조해 추가/제거 항목을 QuickPick(다중 선택)으로 확인 후 반영.
 *   .gpr가 없는 폴더면 새로 만들지 물어본다.
 * - 자동 반영(`gpl.project.autoSyncSources`): 소스 파일(.gpl)이 생기거나 지워지면 — VS Code 안의 생성·이름 변경·삭제뿐
 *   아니라 **외부 변경(SVN 갱신·GDE·탐색기)도 파일 시스템 워처로** — 해당 프로젝트의 Project.gpr에 반영할지 묻거나(prompt,
 *   기본) 바로 반영(auto)한다(2026-10-27 "Project.gpr 자동 동기화" 요청으로 외부 변경까지 넓힘). 대량 변경도 프로젝트당
 *   한 번만 묻고, `auto` 가 아니면 조용히 쓰지 않는다. 내용 변경(저장)에는 반응하지 않는다 — 목록은 파일의 유무만 본다.
 * - 배포 전 대조(`reconcileProjectGprBeforeDeploy`): 사람 경로의 배포·Quick Compile 은 업로드 전에 목록이 폴더와 다르면
 *   「반영 후 배포 / 그대로 배포 / 취소」를 묻고(auto 면 바로 반영), 비대화형 경로는 반영(auto)하거나 그대로 둔다
 *   (deployService 가 `precheckWarnings` 로 알린다).
 * - 편집은 WorkspaceEdit로 적용해 열려 있는(더티 포함) 문서와 충돌하지 않고 Undo가 된다.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { findProjectDirs } from '../deployment/deployService';
import { pickProjectDir } from './projectPicker';
import { isPathUnder, normalizeDirKey } from '../../util/pathKey';
import { GPR_PATH_SEPARATOR, listSourceFilesRecursive } from '../../project/projectSources';
import {
    GprFolderSyncCheck,
    checkGprFolderSync,
    describeGprSyncPlan,
    findGprFile,
    sourceExtensionsFrom,
} from '../../project/gprFolderSync';
import { applyGprSync, createGprText } from '../../project/gprSync';

export const GPR_SYNC_COMMAND = 'gpl.project.syncSources';

type AutoSyncMode = 'prompt' | 'auto' | 'off';

export interface GprSyncDeps {
    log: (line: string) => void;
    /** .gpr 변경 후 심볼 인덱스를 다시 만들 콜백(Project.gpr 기반 인덱싱이라 목록이 바뀌면 필요). */
    refreshSymbols?: () => Promise<void> | void;
}

function sourceExtensions(): string[] {
    return sourceExtensionsFrom(vscode.workspace.getConfiguration('gpl').get<unknown>('project.sourceExtensions'));
}

function autoSyncMode(): AutoSyncMode {
    const raw = vscode.workspace.getConfiguration('gpl').get<unknown>('project.autoSyncSources');
    return raw === 'auto' || raw === 'off' ? raw : 'prompt';
}

/**
 * 프로젝트 폴더 아래 소스 파일 목록 — **하위 폴더 포함(재귀)**, 폴더 기준 상대 경로. 새 .gpr 를 만들 때 쓴다.
 * 대조(추가/제거 계획)는 `checkProject` 가 같은 규칙으로 한다.
 *
 * `.gpr`의 `ProjectSource`는 상대 경로여서 `T1\T2\T2.gpl`처럼 임의 깊이로 중첩될 수 있다
 * (2026-08-28 실제 파일 확인). 구분자는 GDE가 쓰는 `\`로 맞춘다(기존 항목과 형식이 어긋나지 않게).
 * 단, **자기 `.gpr`를 가진 하위 폴더는 다른 프로젝트**이므로 목록에 넣지 않는다
 * (`projects/MyProject/MyLibrary/`, 2026-08-31 실측) — 그 파일들은 `ProjectLibrary` 참조로 이미 함께 컴파일된다.
 */
function listSourceFiles(projectDir: string, log?: (line: string) => void): string[] {
    const listed = listSourceFilesRecursive(projectDir, {
        extensions: sourceExtensions(),
        separator: GPR_PATH_SEPARATOR,
    });
    noteListingLimits(projectDir, listed.truncated, listed.nestedProjects, log);
    return listed.files;
}

function noteListingLimits(projectDir: string, truncated: boolean, nestedProjects: readonly string[], log?: (line: string) => void): void {
    if (truncated) {
        log?.(`[GprSync] ⚠ ${projectDir}: 소스 탐색 상한(파일 수·깊이)에 걸려 일부 파일은 목록에서 빠졌습니다(제거 제안은 내지 않습니다).`);
    }
    if (nestedProjects.length > 0) {
        const names = nestedProjects.map(d => path.relative(projectDir, d) || path.basename(d));
        log?.(`[GprSync] 중첩 프로젝트는 동기화 대상에서 제외: ${names.join(', ')} `
            + '(별개 .gpr — 라이브러리라면 ProjectLibrary 참조로 함께 컴파일됩니다)');
    }
}

interface SyncTarget { projectDir: string; gprPath: string }

/** 대조 한 번 — 열려 있는 문서의 본문(더티 포함)으로 계산해 적용 시 같은 본문을 편집한다. */
async function checkProject(target: SyncTarget, log?: (line: string) => void): Promise<{ doc: vscode.TextDocument; check: GprFolderSyncCheck }> {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(target.gprPath));
    const check = checkGprFolderSync(target.projectDir, target.gprPath, { extensions: sourceExtensions(), gprText: doc.getText() });
    noteListingLimits(target.projectDir, check.truncated, check.nestedProjects, log);
    return { doc, check };
}

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
    const { doc, check } = await checkProject(target, deps.log);
    const { text, plan } = check;

    if (check.inSync) {
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

export type GprReconcileOutcome =
    /** 목록이 이미 폴더와 같다(또는 .gpr 없음 — 배포 서비스가 따로 알린다). */
    | 'unchanged'
    /** 반영했다 — 업로드가 갱신된 .gpr 를 올린다. */
    | 'synced'
    /** 차이가 있지만 그대로 둔다(사람이 「그대로 배포」, 또는 비대화형·off). */
    | 'kept'
    /** 사람이 배포를 취소했다. */
    | 'cancelled';

/**
 * 배포 직전 Project.gpr ↔ 폴더 대조(2026-10-27). 사람 경로(`interactive`)는 차이가 있으면 모달로 「반영 후 배포 / 그대로 배포 /
 * 취소」를 묻고, `autoSyncSources: auto` 면 묻지 않고 반영한다. 비대화형(AI·autoOnSave)은 auto 일 때만 반영하고 아니면 그대로 둔다 —
 * 모달은 브리지를 막고, 저장 트리거에 모달은 과하다(차이는 deployService 가 `precheckWarnings` 로 알린다).
 */
export async function reconcileProjectGprBeforeDeploy(
    projectDir: string,
    deps: GprSyncDeps,
    opts: { interactive: boolean; action?: string },
): Promise<GprReconcileOutcome> {
    const mode = autoSyncMode();
    if (mode === 'off') { return 'kept'; }
    const gprPath = findGprFile(projectDir);
    if (!gprPath) { return 'unchanged'; }
    const target: SyncTarget = { projectDir, gprPath };
    let check: GprFolderSyncCheck;
    try {
        check = (await checkProject(target, deps.log)).check;
    } catch (err: any) {
        deps.log(`[GprSync] 배포 전 대조 실패(${gprPath}): ${err?.message ?? err} — 그대로 진행`);
        return 'kept';
    }
    if (check.inSync) { return 'unchanged'; }
    const summary = describeGprSyncPlan(check.plan);
    if (mode === 'auto') {
        const outcome = await syncGpr(target, deps, { interactive: false, confirmAll: true });
        deps.log(`[GprSync] 배포 전 자동 반영(${path.basename(gprPath)}): ${summary}`);
        return outcome ? 'synced' : 'kept';
    }
    if (!opts.interactive) {
        deps.log(`[GprSync] 배포 전 대조: ${path.basename(gprPath)} 소스 목록이 폴더와 다름 — ${summary} (비대화형 경로라 그대로 진행)`);
        return 'kept';
    }
    const action = opts.action ?? '배포';
    const apply: vscode.MessageItem = { title: `반영 후 ${action}` };
    const keep: vscode.MessageItem = { title: `그대로 ${action}` };
    const cancel: vscode.MessageItem = { title: '취소', isCloseAffordance: true };
    const pick = await vscode.window.showWarningMessage(
        `${path.basename(projectDir)}/${path.basename(gprPath)} 소스 목록이 폴더와 다릅니다 — ${summary}`,
        {
            modal: true,
            detail: [
                ...check.plan.toAdd.map(f => `+ ${f}  (폴더에 있지만 목록에 없음 → 컴파일되지 않음)`),
                ...check.plan.toRemove.map(e => `− ${e.path}  (목록에 있지만 파일 없음 → Compile 실패)`),
                '',
                '제어기는 Project.gpr 목록만 컴파일합니다. 「반영 후」를 고르면 목록을 고친 뒤 올립니다.',
            ].join('\n'),
        },
        apply, keep, cancel,
    );
    if (pick === apply) {
        const outcome = await syncGpr(target, deps, { interactive: true, confirmAll: true });
        return outcome ? 'synced' : 'kept';
    }
    if (pick === keep) {
        deps.log(`[GprSync] 배포 전 대조: 사용자가 그대로 ${action} 선택 — ${summary}`);
        return 'kept';
    }
    return 'cancelled';
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

    // ── 자동 반영: 소스 파일의 생성/삭제(VS Code 안팎) — 프로젝트별 디바운스로 대량 변경도 한 번만 다룬다 ──
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
        let check: GprFolderSyncCheck;
        try { check = (await checkProject(target, deps.log)).check; } catch { return; }
        if (check.inSync) { return; }
        const plan = check.plan;

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

    // 외부 변경(SVN 갱신·GDE·탐색기)까지 잡는 워처 — 내용 변경은 무시(목록은 유무만 본다). VS Code 안의 조작은 아래 이벤트와
    // 겹쳐 두 번 들어오지만 프로젝트별 디바운스가 한 번으로 합친다. 확장자 설정을 바꾸면 워처를 다시 만든다.
    let watcher: vscode.FileSystemWatcher | undefined;
    const startWatcher = (): void => {
        watcher?.dispose();
        const exts = [...new Set(sourceExtensions().map(e => e.replace(/^\./, '').toLowerCase()).filter(e => /^[a-z0-9_]+$/i.test(e)))];
        if (exts.length === 0) { watcher = undefined; return; }
        watcher = vscode.workspace.createFileSystemWatcher(`**/*.{${exts.join(',')}}`, false, true, false);
        watcher.onDidCreate(uri => scheduleForFiles([uri]));
        watcher.onDidDelete(uri => scheduleForFiles([uri]));
    };
    startWatcher();

    context.subscriptions.push(
        vscode.workspace.onDidCreateFiles(e => scheduleForFiles(e.files)),
        vscode.workspace.onDidDeleteFiles(e => scheduleForFiles(e.files)),
        vscode.workspace.onDidRenameFiles(e => scheduleForFiles([...e.files.map(f => f.oldUri), ...e.files.map(f => f.newUri)])),
        vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('gpl.project.sourceExtensions')) { startWatcher(); } }),
        { dispose: () => { watcher?.dispose(); for (const t of pending.values()) { clearTimeout(t); } pending.clear(); } },
    );
}
