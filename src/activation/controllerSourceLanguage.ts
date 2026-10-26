import * as vscode from 'vscode';
import { REMOTE_SOURCE_SCHEME, getRemoteSourceSession } from '../controller/files/remoteSourceSession';
import { SymbolCache } from '../language/vscode/symbolCache';
import { GPLCompletionProvider } from '../providers/completionProvider';
import { GPLDefinitionProvider } from '../providers/definitionProvider';
import { GPLDocumentSymbolProvider } from '../providers/documentSymbolProvider';
import { GPLEvaluatableExpressionProvider } from '../providers/evaluatableExpressionProvider';
import { GPLFoldingRangeProvider } from '../providers/foldingRangeProvider';
import { GPLHoverProvider } from '../providers/hoverProvider';
import { GPLSignatureHelpProvider } from '../providers/signatureHelpProvider';
import type { ExtensionHost } from './host';

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

	constructor(readonly session: SourceSession, output: vscode.OutputChannel) {
		this.cache = new SymbolCache(output);
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

	location(location: vscode.Location): vscode.Location | undefined {
		if (location.uri.scheme !== 'file') { return undefined; }
		const remotePath = this.session.remotePathForLocal(location.uri.fsPath);
		return remotePath ? new vscode.Location(vscode.Uri.parse(this.session.uri(remotePath)), location.range) : undefined;
	}
}

/** 원격 읽기 전용 소스에 기존 언어 해석을 재사용한다. 파일 변경 기능은 등록하지 않는다. */
export function activateControllerSourceLanguage(host: ExtensionHost): void {
	const services = new Map<string, SourceLanguageServices>();
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
		return adapted ? { service, document: adapted } : undefined;
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
		vscode.workspace.onDidOpenTextDocument(document => { prepare(document); }),
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
