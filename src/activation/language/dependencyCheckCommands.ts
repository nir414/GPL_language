/**
 * 패키지 의존 검사 배선 — 명령 `gpl.project.checkDependencies`, 진단(.gpr·.gpl), `.gpr` 빠른 수정, 자동 재검사.
 *
 * 판정은 `project/gpr/dependencyCheck`(순수), 입력은 `project/gpr/dependencyModel`(디스크 .gpr 해석), 파일별 의존은
 * Requires 헤더와 같은 계산(`requiresHeaderPlan.computeFileDependencies`)이다. 여기서는 파일 본문을 모으고(열린 문서 우선)
 * 결과를 VS Code 진단·편집으로 옮긴다.
 *
 * 자동(`gpl.project.dependencyCheck: auto`, 기본): `.gpr` 를 열면 그 컴파일 루트를 한 번 검사하고, 검사한 루트 안의
 * `.gpl`·`.gpr` 를 저장하면 다시 검사한다(저장한 파일의 의존만 다시 계산 — 나머지는 본문이 같으면 캐시).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { isPathUnder, normalizeDirKey, normalizePathKey } from '../../util/pathKey';
import type { RequiredFile } from '../../language/analysis/moduleDependencies';
import { checkPackageDependencies, GprFinding, GprFix } from '../../project/gpr/dependencyCheck';
import { buildPackageInputs, findCompileRootGpr } from '../../project/gpr/dependencyModel';
import { FileDepsCache } from '../../project/gpr/fileDepsCache';
import { findWorkspaceGprPaths } from '../../project/sources/projectFileScope';
import { computeFileDependencies, isRequiresSourceReady } from '../../providers/diagnostics/requiresHeaderPlan';
import type { ExtensionHost } from '../host';

export const DEPENDENCY_CHECK_SOURCE = 'GPL Dependencies';

type CheckMode = 'auto' | 'manual';
const modeOf = (): CheckMode => vscode.workspace.getConfiguration('gpl.project').get<CheckMode>('dependencyCheck', 'auto');

interface StoredFix { line: number; message: string; fix: GprFix }

export function registerDependencyCheck(host: ExtensionHost, ensureIndexed: (reason: string) => Promise<void>): void {
    const { context, symbolCache, outputChannel } = host;
    const collection = vscode.languages.createDiagnosticCollection('gpl-dependencies');
    context.subscriptions.push(collection);

    const fixes = new Map<string, StoredFix[]>();          // .gpr 경로 키 → 빠른 수정
    const rootsChecked = new Map<string, { rootGpr: string; uris: vscode.Uri[]; dirs: string[] }>(); // 루트 폴더 키 → 마지막 결과가 쓴 URI·검사 범위 폴더
    // 키: 본문 + 심볼 인덱스 세대 — 본문이 같아도 모듈이 다른 파일로 옮겨지면 의존이 달라진다(fileDepsCache 머리말)
    const depsCache = new FileDepsCache<RequiredFile[]>();
    const MAX_SETTLE_RETRIES = 5;
    const running = new Map<string, Promise<void>>();

    const openText = (filePath: string): string | undefined =>
        vscode.workspace.textDocuments.find(d => normalizePathKey(d.uri.fsPath) === normalizePathKey(filePath))?.getText();
    const readGpr = (p: string): string => {
        const open = openText(p);
        if (open !== undefined) { return open; }
        try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
    };

    async function check(rootGpr: string, reveal: boolean, attempt = 0): Promise<void> {
        const key = normalizeDirKey(path.dirname(rootGpr));
        const prev = running.get(key);
        if (prev) {
            // 실행 중에 들어온 자동 재검사 요청은 버리지 않는다 — 이미 읽은 낡은 입력으로 끝날 수 있으므로 끝난 뒤 한 번 더
            if (!reveal && attempt < MAX_SETTLE_RETRIES) { void prev.finally(() => schedule(rootGpr, 500, attempt + 1)); }
            return prev;
        }
        const task = (async () => {
            await ensureIndexed('dependency check');
            if (!isRequiresSourceReady(symbolCache)) {
                if (reveal) { void vscode.window.showWarningMessage('GPL 심볼 인덱스를 다시 만드는 중입니다 — 잠시 후 다시 실행해 주세요.'); }
                else if (attempt < MAX_SETTLE_RETRIES) { schedule(rootGpr, 1500, attempt + 1); } // 재인덱싱이 끝나면 다시 — 건너뛰면 진단이 낡은 채 남는다
                return;
            }
            const generationAtStart = symbolCache.indexGeneration;
            const started = Date.now();
            const packages = buildPackageInputs(rootGpr, { readText: readGpr, knownGprPaths: await findWorkspaceGprPaths() });
            const unitDirs = [path.dirname(rootGpr), ...packages.map(p => path.dirname(p.gprPath))];
            // 후보는 이 루트의 컴파일 범위로 좁힌다 — 복제된 다른 프로젝트의 Lib 사본을 의존으로 세지 않게
            const lookup = {
                findAllByName: (n: string) => symbolCache.findAllByName(n),
                isSameCompileUnit: (c: string) => unitDirs.some(d => isPathUnder(c, d)),
            };
            const texts = new Map<string, string>();
            for (const p of packages) {
                for (const s of p.sources) {
                    const k = normalizePathKey(s);
                    if (texts.has(k)) { continue; }
                    const open = openText(s);
                    if (open !== undefined) { texts.set(k, open); continue; }
                    try { texts.set(k, await symbolCache.readSourceText(vscode.Uri.file(s))); } catch { /* 없는 파일 — 의존 없음 */ }
                }
            }
            const result = checkPackageDependencies({
                rootGprPath: rootGpr,
                packages,
                depsOf: f => {
                    const k = normalizePathKey(f);
                    const text = texts.get(k);
                    if (text === undefined) { return []; }
                    return depsCache.getOrCompute(k, text, generationAtStart, () => computeFileDependencies(text, f, lookup));
                },
            });
            publish(key, rootGpr, unitDirs, result.gprFindings, result.layerFindings);
            const ms = Date.now() - started;
            const counts = countBy(result.gprFindings.map(f => f.code));
            const summary = `${path.basename(path.dirname(rootGpr))}: 패키지 ${packages.length} · 파일 ${result.fileCount} — `
                + (result.gprFindings.length + result.layerFindings.length === 0 ? '문제 없음'
                    : [...Object.entries(counts).map(([c, n]) => `${c} ${n}`), result.layerFindings.length ? `layer-violation ${result.layerFindings.length}` : '']
                        .filter(Boolean).join(' · '))
                + (result.rules ? '' : ' (계층 규칙 없음)');
            outputChannel.appendLine(`[Dependencies] ${summary} (${ms} ms)`);
            for (const f of result.gprFindings) { outputChannel.appendLine(`  ${path.relative(path.dirname(rootGpr), f.gprPath)}:${f.line + 1} ${f.code} — ${f.message}`); }
            for (const f of result.layerFindings) { outputChannel.appendLine(`  ${path.relative(path.dirname(rootGpr), f.filePath)}:${f.line + 1} layer-violation — ${f.message}`); }
            if (reveal) { void vscode.window.showInformationMessage(`의존 검사 ${summary} — 자세한 목록은 Problems·Output`); }
            // 검사 도중 인덱스가 또 바뀌었으면(외부 변경의 워처 갱신이 뒤늦게 도착) 낡은 대응으로 만든 결과이므로 한 번 더 돈다
            if (!reveal && symbolCache.indexGeneration !== generationAtStart && attempt < MAX_SETTLE_RETRIES) { schedule(rootGpr, 1000, attempt + 1); }
        })().finally(() => running.delete(key));
        running.set(key, task);
        return task;
    }

    function publish(rootKey: string, rootGpr: string, dirs: string[], gprFindings: readonly GprFinding[], layer: ReturnType<typeof checkPackageDependencies>['layerFindings']): void {
        for (const uri of rootsChecked.get(rootKey)?.uris ?? []) { collection.delete(uri); fixes.delete(normalizePathKey(uri.fsPath)); }
        const byUri = new Map<string, { uri: vscode.Uri; diags: vscode.Diagnostic[] }>();
        const add = (filePath: string, d: vscode.Diagnostic): void => {
            const k = normalizePathKey(filePath);
            let e = byUri.get(k);
            if (!e) { e = { uri: vscode.Uri.file(filePath), diags: [] }; byUri.set(k, e); }
            e.diags.push(d);
        };
        for (const f of gprFindings) {
            const d = new vscode.Diagnostic(new vscode.Range(f.line, 0, f.line, Number.MAX_SAFE_INTEGER), f.message,
                f.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information);
            d.source = DEPENDENCY_CHECK_SOURCE;
            d.code = f.code;
            add(f.gprPath, d);
            if (f.fix) {
                const k = normalizePathKey(f.gprPath);
                fixes.set(k, [...(fixes.get(k) ?? []), { line: f.line, message: f.message, fix: f.fix }]);
            }
        }
        for (const f of layer) {
            const d = new vscode.Diagnostic(new vscode.Range(f.line, f.character, f.line, f.character + 1), f.message, vscode.DiagnosticSeverity.Warning);
            d.source = DEPENDENCY_CHECK_SOURCE;
            d.code = f.code;
            add(f.filePath, d);
        }
        for (const e of byUri.values()) { collection.set(e.uri, e.diags); }
        rootsChecked.set(rootKey, { rootGpr, uris: Array.from(byUri.values()).map(e => e.uri), dirs });
    }

    context.subscriptions.push(vscode.commands.registerCommand('gpl.project.checkDependencies', async (uri?: vscode.Uri) => {
        const target = uri instanceof vscode.Uri ? uri : vscode.window.activeTextEditor?.document.uri;
        const rootGpr = target ? findCompileRootGpr(target.fsPath, readGpr) : undefined;
        if (!rootGpr) { void vscode.window.showWarningMessage('Project.gpr 를 찾지 못했습니다 — 프로젝트의 .gpl/.gpr 파일을 열고 실행해 주세요.'); return; }
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'GPL 의존 검사' }, () => check(rootGpr, true));
    }));

    // 자동 — .gpr 를 열면 그 루트를 한 번, 검사한 루트 안의 파일을 저장하면 다시
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    function schedule(rootGpr: string, delayMs: number, attempt = 0): void {
        const key = normalizeDirKey(path.dirname(rootGpr));
        const prev = timers.get(key);
        if (prev) { clearTimeout(prev); }
        timers.set(key, setTimeout(() => { timers.delete(key); void check(rootGpr, false, attempt); }, delayMs));
    }
    /** 검사한 루트 중 이 파일을 범위(루트 폴더·ProjectLibrary 가 가리키는 패키지 폴더)에 둔 것을 다시 검사한다. */
    const recheckRootsCovering = (filePath: string, delayMs: number): void => {
        if (modeOf() !== 'auto') { return; }
        for (const { rootGpr, dirs } of rootsChecked.values()) {
            if (dirs.some(d => isPathUnder(filePath, d))) { schedule(rootGpr, delayMs); }
        }
    };
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(doc => {
            if (modeOf() !== 'auto' || doc.uri.scheme !== 'file' || !/\.gpr$/i.test(doc.uri.fsPath)) { return; }
            const rootGpr = findCompileRootGpr(doc.uri.fsPath, readGpr);
            if (rootGpr && !rootsChecked.has(normalizeDirKey(path.dirname(rootGpr)))) { schedule(rootGpr, 1000); }
        }),
        vscode.workspace.onDidSaveTextDocument(doc => {
            if (doc.uri.scheme !== 'file' || !/\.(gpl|gpr)$/i.test(doc.uri.fsPath)) { return; }
            recheckRootsCovering(doc.uri.fsPath, 1500);
        }),
        { dispose: () => { for (const t of timers.values()) { clearTimeout(t); } timers.clear(); } },
    );

    // 에디터 밖(스크립트·git·SVN)에서 .gpl/.gpr 가 만들어지거나 바뀌거나 지워진 경우 — 저장 이벤트가 오지 않으므로 워처로 다시 검사한다.
    // 심볼 인덱스 갱신(languageFeatures 의 워처, 300~800 ms 디바운스)보다 늦게 돌도록 지연을 두고, 그래도 앞서면
    // check 가 검사 도중 세대 변화를 보고 한 번 더 돈다.
    const externalWatcher = vscode.workspace.createFileSystemWatcher('**/*.{gpl,gpr}');
    const onExternalChange = (uri: vscode.Uri): void => recheckRootsCovering(uri.fsPath, 2000);
    context.subscriptions.push(
        externalWatcher,
        externalWatcher.onDidCreate(onExternalChange),
        externalWatcher.onDidChange(onExternalChange),
        externalWatcher.onDidDelete(onExternalChange),
    );

    // .gpr 빠른 수정 — 진단 하나씩, 그리고 그 파일 전체
    context.subscriptions.push(vscode.languages.registerCodeActionsProvider({ scheme: 'file', pattern: '**/*.gpr' }, {
        provideCodeActions(document, _range, ctx) {
            const stored = fixes.get(normalizePathKey(document.uri.fsPath)) ?? [];
            const actions: vscode.CodeAction[] = [];
            for (const d of ctx.diagnostics) {
                if (d.source !== DEPENDENCY_CHECK_SOURCE) { continue; }
                const s = stored.find(x => x.line === d.range.start.line && x.message === d.message);
                if (!s) { continue; }
                const action = new vscode.CodeAction(s.fix.title, vscode.CodeActionKind.QuickFix);
                action.diagnostics = [d];
                action.edit = toEdit(document, [s.fix]);
                actions.push(action);
            }
            if (stored.length > 1) {
                const all = new vscode.CodeAction(`이 .gpr 의 의존 문제 모두 고치기 (${stored.length})`, vscode.CodeActionKind.QuickFix);
                all.edit = toEdit(document, stored.map(s => s.fix));
                actions.push(all);
            }
            return actions;
        },
    }, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }));
}

/** 같은 줄 삽입은 순서대로, 같은 줄 중복(같은 값 두 번)은 하나로. */
function toEdit(document: vscode.TextDocument, list: readonly GprFix[]): vscode.WorkspaceEdit {
    const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    const edit = new vscode.WorkspaceEdit();
    const seen = new Set<string>();
    for (const f of list) {
        const key = f.kind === 'insert' ? `i:${f.text.toLowerCase()}` : f.kind === 'remove' ? `r:${f.removeLine}` : `c:${f.replaceLine}`;
        if (seen.has(key)) { continue; }
        seen.add(key);
        if (f.kind === 'insert') {
            edit.insert(document.uri, new vscode.Position(Math.min(f.insertLine, document.lineCount), 0), f.text + eol);
        } else if (f.kind === 'remove') {
            edit.delete(document.uri, new vscode.Range(f.removeLine, 0, f.removeLine + 1, 0));
        } else {
            edit.replace(document.uri, document.lineAt(f.replaceLine).range, f.text);
        }
    }
    return edit;
}

function countBy(xs: readonly string[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const x of xs) { out[x] = (out[x] ?? 0) + 1; }
    return out;
}
