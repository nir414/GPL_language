/**
 * Requires 헤더 동기화 배선 — 명령 2개(현재 파일 · 프로젝트 전체)와 저장 훅(`gpl.requiresHeader.mode: onSave`).
 *
 * 계산은 전부 `providers/diagnostics/requiresHeaderPlan`(순수 조립)이고, 여기서는 줄 편집을 VS Code 편집으로 옮기기만 한다.
 * 진단과 빠른 수정은 diagnosticProvider·codeActionProvider 가 같은 계획으로 낸다.
 */
import * as path from 'path';
import * as vscode from 'vscode';
import { isGplDocument } from '../../config';
import { normalizePathKey } from '../../util/pathKey';
import { describeRequiresPlan, LineEdit } from '../../language/documentation/requiresHeader';
import { findNearestGprOnDisk } from '../../project/sources/projectSources';
import {
    DEFAULT_REQUIRES_HEADER_MODE, isRequiresSourceReady, planRequiresForText, planRequiresInsertionForText,
    RequiresHeaderMode,
} from '../../providers/diagnostics/requiresHeaderPlan';
import type { ExtensionHost } from '../host';

/** 줄 편집 → 문서 범위·본문. 블록이 파일 끝까지 이어지는 경우(마지막 줄에 줄바꿈 없음)도 다룬다. */
function toTextEdit(document: vscode.TextDocument, e: LineEdit): vscode.TextEdit {
    const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    if (e.endLine < document.lineCount) {
        return vscode.TextEdit.replace(new vscode.Range(e.startLine, 0, e.endLine, 0), e.lines.map(l => l + eol).join(''));
    }
    const lastEnd = document.lineAt(document.lineCount - 1).range.end;
    const start = e.startLine < document.lineCount ? new vscode.Position(e.startLine, 0) : lastEnd;
    const lead = e.startLine < document.lineCount ? '' : eol;
    return vscode.TextEdit.replace(new vscode.Range(start, lastEnd), lead + e.lines.join(eol));
}

const modeFor = (uri: vscode.Uri): RequiresHeaderMode =>
    vscode.workspace.getConfiguration('gpl', uri).get<RequiresHeaderMode>('requiresHeader.mode', DEFAULT_REQUIRES_HEADER_MODE);

export function registerRequiresHeaderFeatures(host: ExtensionHost, ensureIndexed: (reason: string) => Promise<void>): void {
    const { context, symbolCache, outputChannel } = host;

    /** 인덱스가 준비되지 않았으면 안내하고 false — 덜 찬 인덱스로 계산하면 의존이 통째로 빠진다. */
    async function ready(): Promise<boolean> {
        await ensureIndexed('Requires header');
        if (isRequiresSourceReady(symbolCache)) { return true; }
        void vscode.window.showWarningMessage('GPL 심볼 인덱스를 다시 만드는 중입니다 — 잠시 후 다시 실행해 주세요.');
        return false;
    }

    const targetUri = (uri?: vscode.Uri): vscode.Uri | undefined =>
        uri instanceof vscode.Uri ? uri : vscode.window.activeTextEditor?.document.uri;

    // 현재 파일 — 블록이 있으면 갱신, 없으면 첫 Module 위에 새로 넣는다(파일별 옵트인).
    context.subscriptions.push(vscode.commands.registerCommand('gpl.requiresHeader.update', async (uri?: vscode.Uri) => {
        const target = targetUri(uri);
        if (!target) { return; }
        const document = await vscode.workspace.openTextDocument(target);
        if (!isGplDocument(document) || !(await ready())) { return; }
        const name = path.basename(document.uri.fsPath);
        const plan = planRequiresForText(document.getText(), document.uri.fsPath, symbolCache);
        let edits: LineEdit[];
        let message: string;
        if (plan) {
            if (!plan.changed) { void vscode.window.showInformationMessage(`${name}: Requires 헤더가 최신입니다.`); return; }
            edits = plan.edits;
            message = `${name}: Requires 헤더 갱신 — ${describeRequiresPlan(plan)}`;
        } else {
            const insertion = planRequiresInsertionForText(document.getText(), document.uri.fsPath, symbolCache);
            if (!insertion) { void vscode.window.showWarningMessage(`${name}: Module 선언이 없어 Requires 헤더를 넣을 자리가 없습니다.`); return; }
            edits = [insertion];
            message = `${name}: Requires 헤더를 Module 선언 위에 추가했습니다(의존 ${insertion.lines.length - 1}줄).`;
        }
        const edit = new vscode.WorkspaceEdit();
        edit.set(document.uri, edits.map(e => toTextEdit(document, e)));
        if (await vscode.workspace.applyEdit(edit)) { void vscode.window.showInformationMessage(message); }
    }));

    // 프로젝트 전체 — 활성 파일과 같은 컴파일 단위 중 `'Requires:` 블록이 있는 파일만. 미리보기(Refactor Preview)에서 확인 후 적용.
    context.subscriptions.push(vscode.commands.registerCommand('gpl.requiresHeader.updateProject', async (uri?: vscode.Uri) => {
        const target = targetUri(uri);
        if (!target) { void vscode.window.showWarningMessage('기준이 될 GPL 파일을 열고 실행해 주세요.'); return; }
        if (!findNearestGprOnDisk(target.fsPath)) {
            void vscode.window.showWarningMessage(`${path.basename(target.fsPath)}: 소속 Project.gpr 를 찾지 못해 프로젝트 범위를 정할 수 없습니다. 현재 파일 명령을 써 주세요.`);
            return;
        }
        if (!(await ready())) { return; }
        const seen = new Set<string>();
        const files = symbolCache.listIndexedFiles().filter(f => {
            const key = normalizePathKey(f);
            if (seen.has(key) || !/\.gpl$/i.test(f) || !symbolCache.isSameCompileUnit(f, target.fsPath)) { return false; }
            seen.add(key);
            return true;
        });

        const edit = new vscode.WorkspaceEdit();
        const changed: string[] = [];
        let withHeader = 0;
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'Requires 헤더 대조 중…', cancellable: false },
            async () => {
                for (const file of files) {
                    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
                    const plan = planRequiresForText(document.getText(), file, symbolCache);
                    if (!plan) { continue; }
                    withHeader++;
                    if (!plan.changed) { continue; }
                    const label = `${path.basename(file)} — ${describeRequiresPlan(plan)}`;
                    for (const e of plan.edits) {
                        const t = toTextEdit(document, e);
                        edit.replace(document.uri, t.range, t.newText, { label, needsConfirmation: true });
                    }
                    changed.push(label);
                }
            },
        );
        outputChannel.appendLine(`[Requires] 대상 ${files.length}개 중 헤더 있음 ${withHeader}개, 갱신 ${changed.length}개`);
        for (const c of changed) { outputChannel.appendLine(`  - ${c}`); }
        if (changed.length === 0) {
            void vscode.window.showInformationMessage(`Requires 헤더가 모두 최신입니다(헤더가 있는 파일 ${withHeader}개).`);
            return;
        }
        if (await vscode.workspace.applyEdit(edit)) {
            void vscode.window.showInformationMessage(`Requires 헤더 ${changed.length}개 파일을 갱신했습니다 — 저장은 직접 해 주세요(목록은 Output).`);
        }
    }));

    // 저장 훅 — onSave 모드에서만, 블록이 있는 파일만. 인덱스가 덜 찼으면 손대지 않는다.
    context.subscriptions.push(vscode.workspace.onWillSaveTextDocument(event => {
        const document = event.document;
        if (!isGplDocument(document) || modeFor(document.uri) !== 'onSave' || !isRequiresSourceReady(symbolCache)) { return; }
        const plan = planRequiresForText(document.getText(), document.uri.fsPath, symbolCache);
        if (!plan?.changed) { return; }
        event.waitUntil(Promise.resolve(plan.edits.map(e => toTextEdit(document, e))));
    }));
}
