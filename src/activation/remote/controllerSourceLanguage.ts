import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { REMOTE_SOURCE_SCHEME, getRemoteSourceSession } from '../../controller/files/remoteSourceSession';
import { getCompiledRecord } from '../../controller/deployment/deployRecord';
import { findWorkspaceGprPaths } from '../../project/sources/projectFileScope';
import {
	describeGprCandidates, localCompileUnitSources, localFileFor, pickLocalProject, remoteProjectLocation, sameSourceText,
} from '../../project/remote/remoteSourceMapping';
import type { LocalProjectMatch } from '../../project/remote/remoteSourceMapping';
import { SymbolCache } from '../../language/vscode/symbolCache';
import { resolveSymbolCompletionItem } from '../../language/vscode/symbolPresentation';
import { GPLCompletionProvider } from '../../providers/intellisense/completionProvider';
import { GPLDefinitionProvider } from '../../providers/navigation/definitionProvider';
import { GPLDocumentSymbolProvider } from '../../providers/structure/documentSymbolProvider';
import { GPLEvaluatableExpressionProvider } from '../../providers/intellisense/evaluatableExpressionProvider';
import { GPLFoldingRangeProvider } from '../../providers/structure/foldingRangeProvider';
import { GPLHoverProvider } from '../../providers/intellisense/hoverProvider';
import { GPLSignatureHelpProvider } from '../../providers/intellisense/signatureHelpProvider';
import type { ExtensionHost } from '../host';

type SourceSession = NonNullable<ReturnType<typeof getRemoteSourceSession>>;

/** 파서의 로컬 경로 계약만 바꾼다. 텍스트·위치 계산은 편집기에 열린 문서가 정본이다. */
function backingDocument(document: vscode.TextDocument, localPath: string): vscode.TextDocument {
	const uri = vscode.Uri.file(localPath);
	return new Proxy(document, {
		get(target, key) {
			if (key === 'uri') { return uri; }
			if (key === 'fileName') { return localPath; }
			const value = Reflect.get(target, key, target);
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});
}

/** 로컬 작업공간과 섞지 않고, 이 연결에서 열어 본 소스만 인덱싱한다. */
class SourceLanguageServices {
	readonly cache: SymbolCache;
	readonly completion: GPLCompletionProvider;
	readonly definition: GPLDefinitionProvider;
	readonly hover: GPLHoverProvider;
	readonly signature: GPLSignatureHelpProvider;
	readonly evaluatable: GPLEvaluatableExpressionProvider;
	private readonly versions = new Map<string, { document: vscode.TextDocument; version: number; localPath: string }>();
	/** 로컬 프로젝트 씨앗 — 서비스(연결·탐색 범위)마다 한 번. undefined 면 아직 시도 전. */
	private seedTask: Promise<LocalProjectMatch | undefined> | undefined;

	constructor(readonly session: SourceSession, output: vscode.OutputChannel) {
		// 경로 근접도의 최상위 폴더 기준을 TMP 캐시 루트로 — 열어 본 원격 사본(같은 프로젝트 폴더)이 매핑된 로컬 사본보다 앞선다.
		this.cache = new SymbolCache(output, filePath =>
			session.remotePathForLocal(filePath) !== undefined ? session.cacheRoot : vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath))?.uri.fsPath);
		this.completion = new GPLCompletionProvider(this.cache);
		this.definition = new GPLDefinitionProvider(this.cache, output);
		this.hover = new GPLHoverProvider(this.cache, output);
		this.signature = new GPLSignatureHelpProvider(this.cache);
		this.evaluatable = new GPLEvaluatableExpressionProvider(this.cache);
	}

	document(document: vscode.TextDocument): vscode.TextDocument | undefined {
		const remotePath = this.session.remotePathFromUri(document.uri.toString());
		if (!remotePath) { return undefined; }
		const adapted = backingDocument(document, this.session.localPath(remotePath));
		const indexed = this.versions.get(remotePath);
		if (indexed?.document !== document || indexed.version !== document.version) {
			// refresh()는 로컬 작업공간 전체를 읽으므로 이 독립 캐시에서는 호출하지 않는다.
			this.cache.updateDocument(adapted);
			this.versions.set(remotePath, { document, version: document.version, localPath: adapted.uri.fsPath });
		}
		return adapted;
	}

	close(document: vscode.TextDocument): void {
		// 세션이 먼저 정리됐어도 저장해 둔 로컬 경로로 문서 참조·인덱스를 해제할 수 있다.
		for (const [remotePath, indexed] of this.versions) {
			if (indexed.document !== document) { continue; }
			this.cache.removeFile(indexed.localPath);
			this.versions.delete(remotePath);
		}
	}

	get isEmpty(): boolean { return this.versions.size === 0; }

	/**
	 * 원격 프로젝트에 대응하는 로컬 프로젝트의 컴파일 단위를 이 캐시에 넣는다(2026-10-26 Sample Prep 보고 — 종전엔 열어 본
	 * 원격 파일만 알아 다른 파일의 모듈로 이동하지 못했다). 매핑 규칙은 project/remote/remoteSourceMapping.ts. 한 번만 시도하고,
	 * 대응이 없으면 종전처럼 열어 본 파일만으로 동작한다.
	 */
	seedFromLocal(projectName: string, log: (message: string) => void): Promise<LocalProjectMatch | undefined> {
		if (!this.seedTask) {
			this.seedTask = (async () => {
				const record = getCompiledRecord(this.session.host, projectName);
				const candidates = describeGprCandidates(await findWorkspaceGprPaths());
				const match = pickLocalProject(projectName, candidates, record?.projectDir);
				if (!match) {
					log(`[Remote Source] ${this.session.host} /${projectName}: 대응하는 로컬 프로젝트 없음 — 열어 본 원격 파일만 조회`);
					return undefined;
				}
				const sources = localCompileUnitSources(match.gprPath);
				if (sources.length > 0) {
					await this.cache.updateFilesFromDisk(sources.map(file => vscode.Uri.file(file)));
				}
				log(`[Remote Source] ${this.session.host} /${projectName} → ${match.projectDir} (${match.via}, 소스 ${sources.length}개) — 정의·호버·완성에 로컬 컴파일 단위를 사용`);
				return match;
			})().catch(error => {
				try { log(`[Remote Source] 로컬 프로젝트 매핑 실패: ${error instanceof Error ? error.message : String(error)}`); } catch { /* 로거 실패는 무시 */ }
				return undefined;
			});
		}
		return this.seedTask;
	}

	/** 이미 끝난 매핑 결과(없거나 아직이면 undefined) — 열 때 로컬과의 차이 안내에 쓴다. */
	localMatch(): Promise<LocalProjectMatch | undefined> | undefined { return this.seedTask; }

	location(location: vscode.Location): vscode.Location | undefined {
		if (location.uri.scheme !== 'file') { return undefined; }
		const remotePath = this.session.remotePathForLocal(location.uri.fsPath);
		// TMP 캐시 밖의 file: 위치는 매핑된 로컬 프로젝트의 파일이다 — 편집은 로컬이 정본이므로 그대로 연다.
		return remotePath ? new vscode.Location(vscode.Uri.parse(this.session.uri(remotePath)), location.range) : location;
	}
}

/** 원격 읽기 전용 소스에 기존 언어 해석을 재사용한다. 파일 변경 기능은 등록하지 않는다. */
export function activateControllerSourceLanguage(host: ExtensionHost): void {
	const services = new Map<string, SourceLanguageServices>();
	const log = (message: string): void => {
		try { host.log(message); } catch { host.outputChannel.appendLine(message); }
	};
	const selectors: vscode.DocumentSelector = [
		{ scheme: REMOTE_SOURCE_SCHEME, pattern: '**/*.gpl' },
		{ scheme: REMOTE_SOURCE_SCHEME, pattern: '**/*.gpo' },
	];
	const symbols = new GPLDocumentSymbolProvider();
	const folding = new GPLFoldingRangeProvider();
	function pruneServices(): void {
		for (const [key, service] of services) {
			if (getRemoteSourceSession(service.session.id) !== service.session) { services.delete(key); }
		}
	}

	function prepare(document: vscode.TextDocument): { service: SourceLanguageServices; document: vscode.TextDocument } | undefined {
		pruneServices();
		if (document.uri.scheme !== REMOTE_SOURCE_SCHEME || !/\.gp[lo]$/i.test(document.uri.path)) {
			return undefined;
		}
		const session = getRemoteSourceSession(document.uri.authority);
		if (!session) { return undefined; }
		const remotePath = session.remotePathFromUri(document.uri.toString());
		if (!remotePath) { return undefined; }
		const localPath = session.localPath(remotePath);
		const relative = remotePath.slice(session.root.length).split('/').filter(Boolean);
		// Attach는 준비한 컴파일 단위(라이브러리 포함)를 공유한다. 일반 탐색은 다른 프로젝트의
		// 동명 심볼이 섞이지 않도록 /GPL 바로 아래 폴더별로 나눈다.
		const scope = session.resolveSource(localPath) ? 'debug'
			: `browse:${relative.length > 1 ? relative[0].toLowerCase() : ''}`;
		const key = JSON.stringify([session.id, scope]);
		let service = services.get(key);
		if (!service || service.session !== session) {
			service = new SourceLanguageServices(session, host.outputChannel);
			services.set(key, service);
		}
		const adapted = service.document(document);
		if (!adapted) { return undefined; }
		// 탐색 범위(= /GPL 바로 아래 프로젝트)에 대응하는 로컬 프로젝트를 씨앗으로 넣는다(비동기, 1회). Attach 범위는
		// 준비한 컴파일 단위를 이미 공유하므로 제외한다.
		const where = remoteProjectLocation(session.root, remotePath);
		if (scope !== 'debug' && where) { void service.seedFromLocal(where.projectName, log); }
		return { service, document: adapted };
	}

	/** 원격 사본을 열었을 때 대응 로컬 파일과 내용이 다르면 한 번 알린다(편집은 로컬이 정본). URI 마다 한 번. */
	const differenceNotified = new Set<string>();
	async function notifyIfDiffersFromLocal(document: vscode.TextDocument): Promise<void> {
		const session = getRemoteSourceSession(document.uri.authority);
		const remotePath = session?.remotePathFromUri(document.uri.toString());
		if (!session || !remotePath) { return; }
		const where = remoteProjectLocation(session.root, remotePath);
		const service = services.get(JSON.stringify([session.id, `browse:${where ? where.projectName.toLowerCase() : ''}`]));
		const match = await service?.localMatch();
		if (!match || !where?.relative) { return; }
		const localFile = localFileFor(match.projectDir, where.relative);
		const key = document.uri.toString();
		if (differenceNotified.has(key) || !fs.existsSync(localFile)) { return; }
		let localText: string;
		try { localText = fs.readFileSync(localFile, 'utf8'); } catch { return; }
		if (sameSourceText(localText, document.getText())) { return; }
		differenceNotified.add(key);
		const open = '로컬 열기';
		const pick = await vscode.window.showInformationMessage(
			`제어기 사본 ${path.posix.basename(remotePath)} 이 로컬 ${path.relative(match.projectDir, localFile)} 과 다릅니다 — 로컬이 바뀌었거나 업로드 전입니다.`,
			open,
		);
		if (pick === open) { await vscode.window.showTextDocument(vscode.Uri.file(localFile), { preview: false }); }
	}

	host.context.subscriptions.push(
		vscode.languages.registerDocumentSymbolProvider(selectors, {
			provideDocumentSymbols(document, token) {
				const source = prepare(document);
				return source ? symbols.provideDocumentSymbols(source.document, token) : undefined;
			},
		}),
		vscode.languages.registerFoldingRangeProvider(selectors, {
			provideFoldingRanges(document, context, token) {
				const source = prepare(document);
				return source ? folding.provideFoldingRanges(source.document, context, token) : undefined;
			},
		}),
		vscode.languages.registerCompletionItemProvider(selectors, {
			provideCompletionItems(document, position, token, context) {
				const source = prepare(document);
				return source?.service.completion.provideCompletionItems(source.document, position, token, context);
			},
			// 워크스페이스 심볼 항목의 문서는 선택될 때 채운다 — 항목이 자기 출처(심볼·인덱스)를 기억하므로 어느 소스의 것이든 같은 함수로 된다.
			resolveCompletionItem(item) {
				resolveSymbolCompletionItem(item);
				return item;
			},
		}, '.', '&'),
		vscode.languages.registerHoverProvider(selectors, {
			provideHover(document, position, token) {
				const source = prepare(document);
				return source?.service.hover.provideHover(source.document, position, token);
			},
		}),
		vscode.languages.registerDefinitionProvider(selectors, {
			async provideDefinition(document, position, token) {
				const source = prepare(document);
				if (!source) { return undefined; }
				const result = await source.service.definition.provideDefinition(source.document, position, token);
				if (!result || getRemoteSourceSession(document.uri.authority) !== source.service.session) { return undefined; }
				if (Array.isArray(result)) {
					return result.map(location => source.service.location(location)).filter((location): location is vscode.Location => !!location);
				}
				return source.service.location(result);
			},
		}),
		vscode.languages.registerSignatureHelpProvider(selectors, {
			provideSignatureHelp(document, position, token, context) {
				const source = prepare(document);
				return source?.service.signature.provideSignatureHelp(source.document, position, token, context);
			},
		}, { triggerCharacters: ['(', ','], retriggerCharacters: [','] }),
		vscode.languages.registerEvaluatableExpressionProvider(selectors, {
			provideEvaluatableExpression(document, position) {
				const source = prepare(document);
				return source?.service.evaluatable.provideEvaluatableExpression(source.document, position);
			},
		}),
		vscode.workspace.onDidOpenTextDocument(document => {
			if (prepare(document)) { void notifyIfDiffersFromLocal(document).catch(() => undefined); }
		}),
		vscode.workspace.onDidChangeTextDocument(event => { prepare(event.document); }),
		vscode.workspace.onDidCloseTextDocument(document => {
			for (const [key, service] of services) {
				service.close(document);
				if (service.isEmpty) { services.delete(key); }
			}
			pruneServices();
		}),
		{ dispose: () => { services.clear(); } },
	);
	for (const document of vscode.workspace.textDocuments) { prepare(document); }
}
