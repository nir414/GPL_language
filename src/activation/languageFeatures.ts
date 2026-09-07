/**
 * 언어 기능 배선 — provider 등록·문서 이벤트·파일 워처·심볼 캐시 초기화·심볼 진단 명령.
 *
 * `extension.ts`의 activate() 에서 분리(2026-09-07). 본문은 옮기기 전과 같고, activate 클로저가
 * 공유하던 상태는 `ExtensionHost` 를 통해 읽는다.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { isGplDocument, isGplFile, isTraceOn, isTraceVerbose } from '../config';
import { normalizePathKey } from '../controller/projectPickerCore';
import { fileExists } from '../language/symbolLocations';
import { GPLCodeActionProvider } from '../providers/codeActionProvider';
import { GPLCompletionProvider } from '../providers/completionProvider';
import { GPLDefinitionProvider } from '../providers/definitionProvider';
import { GPLDocCommentCompletionProvider, insertDocComment } from '../providers/docCommentProvider';
import { GPLDocumentSymbolProvider } from '../providers/documentSymbolProvider';
import { GPLEvaluatableExpressionProvider } from '../providers/evaluatableExpressionProvider';
import { GPLFoldingRangeProvider } from '../providers/foldingRangeProvider';
import { GPLHoverProvider } from '../providers/hoverProvider';
import { GPLReferenceProvider } from '../providers/referenceProvider';
import { GPLRenameProvider } from '../providers/renameProvider';
import { GPLSignatureHelpProvider } from '../providers/signatureHelpProvider';
import { GPLWorkspaceSymbolProvider } from '../providers/workspaceSymbolProvider';
import { SymbolCache } from '../symbolCache';
import { hasOpenGplDocument } from '../config';
import type { ExtensionHost } from './host';

export function activateLanguageFeatures(host: ExtensionHost): () => void {
	const { context, outputChannel, consoleChannel, symbolCache, diagnosticProvider } = host;

	async function normalizeGplDocumentLanguage(document: vscode.TextDocument, reason: string): Promise<vscode.TextDocument> {
		if (!isGplFile(document) || document.languageId === 'gpl') {
			return document;
		}

		try {
			const normalized = await vscode.languages.setTextDocumentLanguage(document, 'gpl');
			if (isTraceVerbose(vscode.workspace)) {
				host.log(`[Language] Normalized ${path.basename(document.uri.fsPath)}: ${document.languageId} -> gpl (${reason})`);
			}
			return normalized;
		} catch (err: any) {
			host.log(`[Language] Failed to normalize ${path.basename(document.uri.fsPath)} (${reason}): ${err?.message ?? err}`);
			return document;
		}
	}

	async function normalizeOpenGplDocuments(reason: string): Promise<void> {
		for (const document of vscode.workspace.textDocuments) {
			// 대상 여부 판정은 normalizeGplDocumentLanguage 진입부에서 수행한다.
			await normalizeGplDocumentLanguage(document, reason);
		}
	}

	void normalizeOpenGplDocuments('activation');

	let symbolCacheInitPromise: Promise<void> | null = null;

	function ensureSymbolCacheInitialized(reason: string): Promise<void> {
		if (symbolCacheInitPromise) { return symbolCacheInitPromise; }
		outputChannel.appendLine(`Initializing symbol cache... (${reason})`);
		symbolCacheInitPromise = symbolCache.refresh()
			.then(() => {
				outputChannel.appendLine('Symbol cache initialized!');
				if (isTraceOn(vscode.workspace)) {
					outputChannel.show(true);
				}
			})
			.catch((err) => {
				outputChannel.appendLine(`[SymbolCache] Initialization failed: ${err}`);
				symbolCacheInitPromise = null;
			});
		return symbolCacheInitPromise;
	}
	// Register language providers
	// .gpl 파일은 (권장) gpl 언어로 열고, 호환을 위해 vb로 열린 경우도 지원한다.
	const gplSelectors: vscode.DocumentSelector = [
		{ language: 'gpl', scheme: 'file', pattern: '**/*.gpl' },
		{ language: 'vb', scheme: 'file', pattern: '**/*.gpl' },
		{ scheme: 'file', pattern: '**/*.gpl' },
		{ language: 'gpl', scheme: 'file', pattern: '**/*.gpo' },
		{ language: 'vb', scheme: 'file', pattern: '**/*.gpo' },
		{ scheme: 'file', pattern: '**/*.gpo' }
	];

	// Definition provider (Go to Definition)
	context.subscriptions.push(
		vscode.languages.registerDefinitionProvider(
			gplSelectors,
			new GPLDefinitionProvider(symbolCache, outputChannel)
		)
	);

	// Reference provider (Find All References) — Rename provider가 재사용하므로 인스턴스 공유
	const referenceProvider = new GPLReferenceProvider(symbolCache, outputChannel);
	context.subscriptions.push(
		vscode.languages.registerReferenceProvider(
			gplSelectors,
			referenceProvider
		)
	);

	// Rename provider (F2) — 참조 검색 재사용 + 반환값 대입/문자열 프로시저 참조/섀도잉 보정
	context.subscriptions.push(
		vscode.languages.registerRenameProvider(
			gplSelectors,
			new GPLRenameProvider(symbolCache, referenceProvider, outputChannel)
		)
	);

	// Completion provider (IntelliSense)
	context.subscriptions.push(
		vscode.languages.registerCompletionItemProvider(
			gplSelectors,
			new GPLCompletionProvider(symbolCache),
			// 멤버 접근('.')과 XML 엔티티('&')에서만 자동완성을 트리거한다.
			// 공백(' ') 트리거는 일반 입력마다 팝업을 띄워 소음/지연을 유발하므로 제외.
			// (식별자 입력 시의 기본 IntelliSense는 그대로 동작한다.)
			'.', '&'
		)
	);

	// 문서화 주석 골격: `'''` 입력 시 설명/Parameters/Returns 골격을 제안한다(JSDoc의 `/**`와 같은 흐름).
	context.subscriptions.push(
		vscode.languages.registerCompletionItemProvider(
			gplSelectors,
			new GPLDocCommentCompletionProvider(),
			"'"
		)
	);

	// 문서화 주석 생성/보완 명령 (코드 액션·명령 팔레트 공용)
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.insertDocComment', insertDocComment)
	);

	// Document symbol provider (Outline view)
	context.subscriptions.push(
		vscode.languages.registerDocumentSymbolProvider(
			gplSelectors,
			new GPLDocumentSymbolProvider()
		)
	);

	// Workspace symbol provider (Go to Symbol in Workspace)
	context.subscriptions.push(
		vscode.languages.registerWorkspaceSymbolProvider(
			new GPLWorkspaceSymbolProvider(symbolCache)
		)
	);

	// Folding provider (fix odd folding behavior on *.gpl)
	context.subscriptions.push(
		vscode.languages.registerFoldingRangeProvider(
			gplSelectors,
			new GPLFoldingRangeProvider()
		)
	);

	// Hover provider (Const value display)
	context.subscriptions.push(
		vscode.languages.registerHoverProvider(
			gplSelectors,
			new GPLHoverProvider(symbolCache, outputChannel)
		)
	);

	// 디버그 hover 식 결정: `armList(i)`처럼 인덱스 포함 식을 통째로 평가하고,
	// Sub/Function 이름 위 hover는 차단(-eval이 프로시저를 실행해 버리는 사고 방지).
	context.subscriptions.push(
		vscode.languages.registerEvaluatableExpressionProvider(
			gplSelectors,
			new GPLEvaluatableExpressionProvider(symbolCache)
		)
	);

	// Signature Help provider (parameter hints for built-ins + user Sub/Function)
	// Triggered on '(' and ',' so the active-parameter highlight advances as the user types.
	context.subscriptions.push(
		vscode.languages.registerSignatureHelpProvider(
			gplSelectors,
			new GPLSignatureHelpProvider(symbolCache),
			{ triggerCharacters: ['(', ','], retriggerCharacters: [','] }
		)
	);

	// Code Action provider (Quick fixes and refactoring)
	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider(
			gplSelectors,
			new GPLCodeActionProvider(),
			{
				providedCodeActionKinds: [
					vscode.CodeActionKind.QuickFix,
					vscode.CodeActionKind.Refactor,
					vscode.CodeActionKind.RefactorRewrite,
					vscode.CodeActionKind.Source
				]
			}
		)
	);

	// Diagnostic provider registration
	context.subscriptions.push(diagnosticProvider);

	// Refresh symbols command
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.refreshSymbols', async () => {
			await ensureSymbolCacheInitialized('manual refresh');
			await symbolCache.refresh();
			outputChannel.appendLine('GPL symbols cache refreshed!');
			outputChannel.show();
			vscode.window.showInformationMessage('GPL symbols refreshed!');
		})
	);
	
	// Debug command to check symbol cache
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.debugSymbolCache', () => {
			const allSymbols = symbolCache.getAllSymbols();
			const indexedFiles = symbolCache.listIndexedFiles();

			// 종전에는 basename으로 묶어 출력했다. 그래서 같은 파일이 여러 경로로 중복 인덱싱돼도
			// 한 덩어리로 보여 §1-CQ(정의가 3개로 뜨던 문제)를 이 명령으로 진단할 수 없었다.
			// 이제 **전체 경로** 단위로 묶고, 동명 파일·사라진 파일을 먼저 요약한다.
			const byPath = new Map<string, { filePath: string; symbols: typeof allSymbols }>();
			for (const filePath of indexedFiles) {
				byPath.set(normalizePathKey(filePath), { filePath, symbols: [] });
			}
			for (const sym of allSymbols) {
				const entry = byPath.get(normalizePathKey(sym.filePath));
				if (entry) { entry.symbols.push(sym); }
			}

			const entries = Array.from(byPath.values())
				.sort((a, b) => a.filePath.localeCompare(b.filePath));

			const byBasename = new Map<string, string[]>();
			for (const { filePath } of entries) {
				const key = path.basename(filePath).toLowerCase();
				const bucket = byBasename.get(key);
				if (bucket) { bucket.push(filePath); } else { byBasename.set(key, [filePath]); }
			}
			const duplicated = Array.from(byBasename.entries()).filter(([, paths]) => paths.length > 1);
			const missing = entries.filter(e => !fileExists(e.filePath)).map(e => e.filePath);

			outputChannel.appendLine('=== GPL Symbol Cache Debug ===');
			outputChannel.appendLine(`Files: ${entries.length} | Symbols: ${allSymbols.length}`);

			if (duplicated.length > 0) {
				outputChannel.appendLine(`\n⚠ 같은 이름의 파일이 여러 경로에 인덱싱돼 있다 (${duplicated.length}건)`);
				outputChannel.appendLine('  — 다른 프로젝트의 동명 파일이면 정상이다. 경로가 사실상 같은데 표기만 다르면 중복 인덱싱이다.');
				for (const [name, paths] of duplicated) {
					outputChannel.appendLine(`  ${name} (${paths.length}곳)`);
					for (const p of paths) { outputChannel.appendLine(`    - ${p}`); }
				}
			}
			if (missing.length > 0) {
				outputChannel.appendLine(`\n⚠ 디스크에 없는 파일이 인덱스에 남아 있다 (${missing.length}건) — 정의 이동에서 "열리지 않는 후보"로 나타난다`);
				for (const p of missing) { outputChannel.appendLine(`    - ${p}`); }
				outputChannel.appendLine('  → `GPL: Refresh Symbols`로 정리된다(정의 이동·참조 검색이 만나면 자동으로도 지운다).');
			}

			for (const { filePath, symbols } of entries) {
				outputChannel.appendLine(`\n${filePath}: (${symbols.length})`);
				for (const sym of symbols) {
					const classInfo = sym.className ? ` (in class ${sym.className})` : '';
					const typeInfo = sym.returnType ? ` : ${sym.returnType}` : '';
					outputChannel.appendLine(`  [${sym.kind}] ${sym.name}${typeInfo}${classInfo} @line ${sym.line + 1}`);
				}
			}

			outputChannel.show();
			const warn = duplicated.length + missing.length;
			vscode.window.showInformationMessage(
				warn > 0
					? `심볼 캐시 진단을 출력 채널에 기록했습니다 — 확인할 항목 ${warn}건`
					: '심볼 캐시 진단을 출력 채널에 기록했습니다'
			);
		})
	);
	// Auto-refresh symbols and diagnostics when GPL files change
	// 심볼 재파싱은 키 입력마다가 아니라 타이핑이 멈춘 뒤 1회만 수행한다 (400ms 디바운스).
	// (기존: 매 키 입력마다 전체 재파싱 + "[SymbolCache] Updated" 로그 폭주)
	const symbolUpdateTimers = new Map<string, ReturnType<typeof setTimeout>>();
	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument((event) => {
			if (isGplDocument(event.document)) {
				const key = event.document.uri.fsPath;
				const prev = symbolUpdateTimers.get(key);
				if (prev) { clearTimeout(prev); }
				symbolUpdateTimers.set(key, setTimeout(() => {
					symbolUpdateTimers.delete(key);
					if (!event.document.isClosed) {
						symbolCache.updateDocument(event.document);
					}
				}, 400));
				diagnosticProvider.scheduleDiagnostics(event.document, 500);
			}
		}),
		{ dispose: () => { for (const t of symbolUpdateTimers.values()) { clearTimeout(t); } symbolUpdateTimers.clear(); } }
	);

	// Keep caches clean on delete/rename to avoid stale symbols/diagnostics.
	context.subscriptions.push(
		vscode.workspace.onDidDeleteFiles((event) => {
			for (const uri of event.files) {
				symbolCache.removeFile(uri.fsPath);
				// 폴더 삭제는 폴더 경로 1건만 온다 — 하위 파일 심볼도 prefix로 제거해 stale 정의 방지.
				symbolCache.deleteByFsPathPrefix(uri.fsPath);
				diagnosticProvider.clearDiagnostics(uri);
			}
		})
	);

	context.subscriptions.push(
		vscode.workspace.onDidRenameFiles(async (event) => {
			for (const f of event.files) {
				// Remove old cache/diagnostics
				symbolCache.removeFile(f.oldUri.fsPath);
				// 폴더 rename 시 옛 경로 하위 파일 심볼도 prefix로 제거 (stale 정의 방지)
				symbolCache.deleteByFsPathPrefix(f.oldUri.fsPath);
				diagnosticProvider.clearDiagnostics(f.oldUri);

				// Re-index the new file path so symbol filePath stays correct
				try {
					const document = await vscode.workspace.openTextDocument(f.newUri);
					if (isGplDocument(document)) {
						symbolCache.updateDocument(document);
						diagnosticProvider.scheduleDiagnostics(document, 0);
					}
				} catch (e) {
					outputChannel.appendLine(`[Rename] Failed to re-index ${f.newUri.fsPath}: ${e}`);
				}
			}
		})
	);

	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument((document) => {
			if (isGplDocument(document)) {
				if (document.languageId !== 'gpl') {
					void normalizeGplDocumentLanguage(document, 'document opened');
					return;
				}
				void ensureSymbolCacheInitialized('GPL document opened');
				// Skip during refresh — indexWorkspace already calls updateDocument
				if (!symbolCache.isRefreshing) {
					symbolCache.updateDocument(document);
				}
				diagnosticProvider.scheduleDiagnostics(document, 0);
			}
		})
	);

	// 문서 저장 시 진단 업데이트
	context.subscriptions.push(
		vscode.workspace.onDidSaveTextDocument((document) => {
			if (isGplDocument(document)) {
				diagnosticProvider.scheduleDiagnostics(document, 0);
			}
		})
	);

	// 파일시스템 워처: 에디터 밖에서 바뀐 .gpl/.gpo(예: git pull, 외부 도구, 빌드 산출물)도
	// 심볼 캐시에 반영해 "정의를 찾을 수 없음"이 수동 새로고침 전까지 발생하지 않도록 한다.
	const gplFileWatcher = vscode.workspace.createFileSystemWatcher('**/*.{gpl,gpo}');
	const reindexFromWatcher = async (uri: vscode.Uri) => {
		try {
			const document = await vscode.workspace.openTextDocument(uri);
			if (isGplDocument(document) && !symbolCache.isRefreshing) {
				symbolCache.updateDocument(document);
			}
		} catch (e) {
			outputChannel.appendLine(`[Watcher] Failed to index ${uri.fsPath}: ${e}`);
		}
	};
	gplFileWatcher.onDidCreate(reindexFromWatcher);
	gplFileWatcher.onDidChange(reindexFromWatcher);
	gplFileWatcher.onDidDelete((uri) => {
		symbolCache.removeFile(uri.fsPath);
		diagnosticProvider.clearDiagnostics(uri);
	});
	context.subscriptions.push(gplFileWatcher);

	// .gpr 워처: `.gpr`는 "어떤 파일이 같은 컴파일 단위인가"(ProjectSource·ProjectLibrary)를 정의한다.
	// 이게 바뀌면 정의 이동·참조 검색의 프로젝트 경계 캐시가 낡은 관계를 계속 쓰게 되므로 버린다.
	// 소스 목록 자체가 바뀌었을 수 있어 인덱스도 다시 만든다(짧게 디바운스 — 저장·SVN update 연타 대비).
	const gprWatcher = vscode.workspace.createFileSystemWatcher('**/*.gpr');
	let gprReindexTimer: ReturnType<typeof setTimeout> | undefined;
	const onGprChanged = (uri: vscode.Uri): void => {
		symbolCache.invalidateProjectRelations();
		if (gprReindexTimer) { clearTimeout(gprReindexTimer); }
		gprReindexTimer = setTimeout(() => {
			gprReindexTimer = undefined;
			outputChannel.appendLine(`[Watcher] .gpr 변경 감지(${path.basename(uri.fsPath)}) — 심볼 인덱스를 다시 만듭니다.`);
			void symbolCache.refresh().catch((e) => {
				outputChannel.appendLine(`[Watcher] .gpr 변경 후 재인덱싱 실패: ${e}`);
			});
		}, 800);
	};
	gprWatcher.onDidCreate(onGprChanged);
	gprWatcher.onDidChange(onGprChanged);
	gprWatcher.onDidDelete(onGprChanged);
	context.subscriptions.push(
		gprWatcher,
		{ dispose: () => { if (gprReindexTimer) { clearTimeout(gprReindexTimer); gprReindexTimer = undefined; } } },
	);

	// ── 클릭 후 마우스 정지 시 언어 호버 재표시 (GitHub #19, 옵트인 gpl.hover.showAfterClick) ──
	// VS Code 코어는 클릭으로 닫힌 호버를 마우스가 움직이기 전까지 다시 열지 않는다. 클릭 직후에는
	// 커서 위치 = 마우스 위치이므로 editor.action.showHover 를 커서에 띄우면 같은 지점에 호버가 열린다.
	// 디버그 세션 중에는 아래 debug hover 경로(gpl.debug.showValueOnCursorClick)가 담당하므로 제외.
	let hoverAfterClickTimer: ReturnType<typeof setTimeout> | undefined;
	context.subscriptions.push(
		vscode.window.onDidChangeTextEditorSelection(e => {
			if (hoverAfterClickTimer) { clearTimeout(hoverAfterClickTimer); hoverAfterClickTimer = undefined; }
			if (host.isDebugSessionActive) { return; }
			if (e.kind !== vscode.TextEditorSelectionChangeKind.Mouse) { return; }
			const editor = e.textEditor;
			if (editor.document.languageId !== 'gpl') { return; }
			if (!vscode.workspace.getConfiguration('gpl.hover').get<boolean>('showAfterClick', false)) { return; }
			const sel = e.selections[0];
			// 단일 클릭(빈 선택)만 — 드래그/더블클릭 선택은 제외
			if (!sel || !sel.isEmpty) { return; }
			if (!editor.document.getWordRangeAtPosition(sel.active)) { return; }
			const delay = Math.max(0, vscode.workspace.getConfiguration('editor').get<number>('hover.delay', 300));
			hoverAfterClickTimer = setTimeout(() => {
				hoverAfterClickTimer = undefined;
				if (vscode.window.activeTextEditor !== editor) { return; }
				if (!editor.selection.active.isEqual(sel.active)) { return; }
				// focus 인자는 VS Code 1.8x+ 에서 인식(구버전은 무시) — 포커스를 호버 위젯으로 빼앗지 않게 한다.
				void vscode.commands.executeCommand('editor.action.showHover', { focus: 'noAutoFocus' })
					.then(undefined, () => undefined);
			}, delay);
		}),
		{ dispose: () => { if (hoverAfterClickTimer) { clearTimeout(hoverAfterClickTimer); hoverAfterClickTimer = undefined; } } },
	);

	// 활성화 마무리 — 종전 activate() 맨 끝에서 하던 일. extension.ts 가 모든 배선을 끝낸 뒤 호출한다.
	return () => {
		// Initialize symbol cache lazily only when GPL context exists.
		if (hasOpenGplDocument(vscode.workspace)) {
			setTimeout(() => {
				void ensureSymbolCacheInitialized('open GPL documents detected');
			}, 300);
		}
	
		// 열려있는 GPL 문서들에 대해 진단 실행
		vscode.workspace.textDocuments.forEach(document => {
			if (isGplDocument(document)) {
				diagnosticProvider.scheduleDiagnostics(document, 0);
			}
		});
	};
}
