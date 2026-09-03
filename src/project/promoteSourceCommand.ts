/**
 * `gpl.project.promoteSourceForBreakpoint` — 라이브러리 소스에 브레이크포인트를 걸 수 있게
 * 메인 `Project.gpr` 을 고치는 명령. 계산은 `sourcePromotion.ts`(순수), 여기는 UI 만 담당한다.
 *
 * 왜 필요한가: 제어기의 `Set Break <project> "<file>" <line>` 은 파일을 그 프로젝트가 직접 선언한
 * `ProjectSource` 안에서만 찾는다(실측 §1-CK·§1-CT). 중첩 라이브러리 구조에서는 메인의 `ProjectSource` 가
 * `Main.gpl` 하나뿐인 경우가 흔해, 나머지 소스 전부에 BP 를 걸 수 없다. 손으로 고치려면 대상 파일을
 * 끌어오는 그룹 참조를 빼고 그 그룹이 제공하던 하위 라이브러리를 개별로 다시 적어야 하는데,
 * 하나라도 놓치면 컴파일에서 파일이 빠지거나 모듈이 중복 정의된다.
 *
 * 흐름: 대상 파일 → 이 파일을 컴파일하는 메인 `.gpr`(여러 개면 QuickPick) → 편집 계획 계산 →
 * **좌우 diff 미리보기** → 모달 승인 → `WorkspaceEdit` 로 적용(Undo 가능) → 저장.
 * 어떤 경우에도 승인 없이 파일을 쓰지 않는다.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { walkTree } from './projectSources';
import {
    PromotionPlan,
    findPromotionHosts,
    planSourcePromotion,
} from './sourcePromotion';

export const PROMOTE_SOURCE_COMMAND = 'gpl.project.promoteSourceForBreakpoint';

/** diff 오른쪽(편집안)을 보여 줄 가상 문서 스킴. */
const PREVIEW_SCHEME = 'gpl-gpr-preview';

export interface PromoteSourceDeps {
    log: (line: string) => void;
    /** `.gpr` 변경 후 심볼 인덱스를 다시 만들 콜백(프로젝트 구성이 바뀌므로). */
    refreshSymbols?: () => Promise<void> | void;
}

/** 워크스페이스의 모든 `Project.gpr`(하위 폴더 포함, dot·빌드 폴더 제외). */
function collectWorkspaceGprPaths(): string[] {
    const out: string[] = [];
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
        walkTree(folder.uri.fsPath, (full, name) => {
            if (name.toLowerCase().endsWith('.gpr')) { out.push(full); }
        });
    }
    return out;
}

/** 명령 인자(Uri)나 활성 에디터에서 대상 `.gpl` 을 정한다. */
function resolveTargetFile(resource: unknown): string | undefined {
    if (resource instanceof vscode.Uri && resource.scheme === 'file') { return resource.fsPath; }
    if (typeof resource === 'string' && resource.trim()) { return resource; }
    const doc = vscode.window.activeTextEditor?.document;
    if (doc && doc.uri.scheme === 'file' && /\.(gpl|gpo)$/i.test(doc.fileName)) { return doc.fileName; }
    return undefined;
}

/** 계획을 사람이 읽는 요약으로 — 모달 detail·출력 채널 공통. */
function describePlan(plan: PromotionPlan, mainGprPath: string): string {
    const lines: string[] = [`대상 표기: ProjectSource="${plan.targetRel}"`];
    if (plan.owningLibraryName) {
        lines.push(`현재 소유 라이브러리: ${plan.owningLibraryName}`);
    }
    lines.push(`편집 파일: ${mainGprPath}`, '');
    if (plan.removeLibraries.length > 0) {
        lines.push(...plan.removeLibraries.map(r => `− ProjectLibrary="${r}"`));
    }
    if (plan.addLibraries.length > 0) {
        lines.push(...plan.addLibraries.map(a => `+ ProjectLibrary="${a}"`));
    }
    if (plan.addSources.length > 0) {
        lines.push(...plan.addSources.map(a => `+ ProjectSource="${a}"`));
    }
    if (plan.warnings.length > 0) {
        lines.push('', ...plan.warnings.map(w => `⚠ ${w}`));
    }
    return lines.join('\n');
}

/** 메인 프로젝트 후보 선택 — 하나면 그대로, 여러 개면 QuickPick. */
async function pickHost(targetFile: string, gprPaths: readonly string[]): Promise<string | undefined> {
    const hosts = findPromotionHosts(targetFile, gprPaths);
    if (hosts.length === 0) { return undefined; }
    if (hosts.length === 1) { return hosts[0].gprPath; }

    const picked = await vscode.window.showQuickPick(
        hosts.map(h => ({
            label: h.projectName,
            description: h.alreadySource ? '이미 ProjectSource' : h.referencedAsLibrary ? '다른 프로젝트의 라이브러리' : '메인 프로젝트',
            detail: h.gprPath,
            gprPath: h.gprPath,
        })),
        {
            placeHolder: `${path.basename(targetFile)} 을 컴파일하는 프로젝트가 여러 개입니다 — 제어기에 로드된 프로젝트를 고르세요`,
            matchOnDetail: true,
        },
    );
    return picked?.gprPath;
}

export function activatePromoteSource(context: vscode.ExtensionContext, deps: PromoteSourceDeps): void {
    // diff 오른쪽에 띄울 편집안을 담아 두는 최소 저장소(명령 실행 중에만 유효).
    const previews = new Map<string, string>();
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(PREVIEW_SCHEME, {
            provideTextDocumentContent: uri => previews.get(uri.path) ?? '',
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(PROMOTE_SOURCE_COMMAND, async (resource?: unknown) => {
            const targetFile = resolveTargetFile(resource);
            if (!targetFile) {
                vscode.window.showWarningMessage(
                    'BP 대상 소스를 알 수 없습니다 — .gpl 파일을 열거나 탐색기에서 파일을 우클릭해 실행하세요.',
                );
                return;
            }

            const gprPaths = collectWorkspaceGprPaths();
            if (gprPaths.length === 0) {
                vscode.window.showWarningMessage('워크스페이스에서 Project.gpr 를 찾지 못했습니다.');
                return;
            }

            const mainGprPath = await pickHost(targetFile, gprPaths);
            if (!mainGprPath) {
                vscode.window.showWarningMessage(
                    `${path.basename(targetFile)} 을 컴파일하는 프로젝트를 찾지 못했습니다 — `
                    + '이 파일이 어떤 .gpr 의 ProjectSource 에도 없거나, 그 프로젝트가 워크스페이스 밖에 있습니다.',
                );
                return;
            }

            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(mainGprPath));
            const text = doc.getText();
            const plan = planSourcePromotion({
                mainGprPath, mainGprText: text, targetFile, knownGprPaths: gprPaths,
            });

            deps.log(`[Promote] ${targetFile} → ${mainGprPath}: ${plan.status}`);
            deps.log(describePlan(plan, mainGprPath).split('\n').map(l => `[Promote]   ${l}`).join('\n'));

            if (plan.status === 'already-source') {
                vscode.window.showInformationMessage(
                    `${path.basename(targetFile)} 은 이미 ProjectSource 입니다 — BP 가 걸려야 정상입니다. `
                    + `-508 이면 프로젝트 로드 상태와 표기(ProjectSource="${plan.targetRel}")를 확인하세요.`,
                );
                return;
            }
            if (plan.status !== 'ready') {
                vscode.window.showErrorMessage(`승격할 수 없습니다 — ${plan.reason ?? plan.status}`);
                return;
            }

            // ── 좌우 diff 미리보기 ─────────────────
            const previewKey = `/${path.basename(mainGprPath)} (편집안)`;
            previews.set(previewKey, plan.newText!);
            const previewUri = vscode.Uri.from({ scheme: PREVIEW_SCHEME, path: previewKey });
            await vscode.commands.executeCommand(
                'vscode.diff',
                vscode.Uri.file(mainGprPath),
                previewUri,
                `${path.basename(mainGprPath)}: ${path.basename(targetFile)} BP 승격안`,
                { preview: true },
            );

            const choice = await vscode.window.showWarningMessage(
                `${path.basename(targetFile)} 에 BP 를 걸 수 있게 ${path.basename(mainGprPath)} 을 고칠까요?`,
                {
                    modal: true,
                    detail: `${describePlan(plan, mainGprPath)}\n\n`
                        + '컴파일 집합은 그대로 유지되도록 계산했습니다(빠지는 파일·중복 컴파일 없음 검증 완료). '
                        + '적용 후에는 재배포/컴파일이 필요합니다.',
                },
                '적용',
            );
            previews.delete(previewKey);
            if (choice !== '적용') {
                deps.log('[Promote] 사용자가 적용을 취소했습니다.');
                return;
            }

            const edit = new vscode.WorkspaceEdit();
            edit.replace(
                vscode.Uri.file(mainGprPath),
                new vscode.Range(doc.positionAt(0), doc.positionAt(text.length)),
                plan.newText!,
            );
            if (!await vscode.workspace.applyEdit(edit)) {
                vscode.window.showErrorMessage(`Project.gpr 편집을 적용하지 못했습니다: ${mainGprPath}`);
                return;
            }
            await doc.save();
            deps.log(`[Promote] 적용 완료: ${mainGprPath}`);
            try { await deps.refreshSymbols?.(); } catch (e) { deps.log(`[Promote] 심볼 재인덱싱 실패: ${e}`); }

            const next = await vscode.window.showInformationMessage(
                `${path.basename(mainGprPath)} 갱신 완료 — ${path.basename(targetFile)} 에 BP 를 걸 수 있습니다. `
                + '제어기에 반영하려면 재배포/컴파일이 필요합니다.',
                '빠른 컴파일',
            );
            if (next === '빠른 컴파일') {
                await vscode.commands.executeCommand('gpl.quickCompile', vscode.Uri.file(path.dirname(mainGprPath)));
            }
        }),
    );
}
