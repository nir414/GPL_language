import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import {
	MCP_SERVER_NAME, RegistrationReport, desiredMcpEntry, classifyClaudeUserConfig, classifyCodexConfig,
	upsertCodexServer, stripMcpJsonEntry, stripGuideBlock, StripResult,
} from './agentSetupChecks';

/**
 * AI 에이전트(Claude Code·Codex)에 gpl-controller MCP 서버를 **사용자 범위로 한 번** 등록하고, 종전 Export 가
 * 워크스페이스에 남긴 파일을 정리한다(2026-11-04, ai-handoff §1-GV). 판정 규칙은 `agentSetupChecks`(순수).
 *
 * - 서버 파일: VSIX 동봉 번들(out/mcp/gpl-controller-mcp.cjs)을 globalStorage(버전 무관 안정 경로)로 복사한 사본.
 *   확장 업데이트 뒤 활성화 때 sha256 이 다르면 자동 갱신한다(GitHub #23). 등록은 이 경로를 가리키므로 다시 쓸 일이 없다.
 * - Claude Code: `claude mcp add-json … -s user` CLI 로 등록한다. `~/.claude.json` 은 Claude Code 가 수시로 통째로 다시
 *   쓰는 파일이라 직접 고치면 경합으로 변경이 사라질 수 있다 — 읽기(판정)만 직접 한다.
 * - Codex: `~/.codex/config.toml`(또는 `$CODEX_HOME`)의 우리 테이블만 교체한다. Codex 가 설치돼 있을 때만.
 * - 제어기 주소는 적지 않는다 — MCP 서버가 확장 창의 presence 에서 따른다(controller-mcp `resolveControllerAddress`).
 */

const BUNDLE_RELATIVE_PATH = path.join('out', 'mcp', 'gpl-controller-mcp.cjs');
const BUILD_INFO_RELATIVE_PATH = path.join('out', 'mcp', 'gpl-controller-mcp.build.json');

/** 번들 사이드카(scripts/bundle-mcp.js가 기록)의 내용. */
export interface BundleBuildInfo {
	version?: string;
	builtAt?: string;
	gitSha?: string | null;
	bundled?: boolean;
}

function bundledPaths(context: vscode.ExtensionContext): { bundle: string; buildInfo: string } {
	return {
		bundle: context.asAbsolutePath(BUNDLE_RELATIVE_PATH),
		buildInfo: context.asAbsolutePath(BUILD_INFO_RELATIVE_PATH),
	};
}

function stablePaths(context: vscode.ExtensionContext): { dir: string; bundle: string; buildInfo: string } {
	const dir = path.join(context.globalStorageUri.fsPath, 'mcp');
	return {
		dir,
		bundle: path.join(dir, 'gpl-controller-mcp.cjs'),
		buildInfo: path.join(dir, 'gpl-controller-mcp.build.json'),
	};
}

/** 확장이 등록하는 서버 파일(안정 사본) 경로. */
export function stableServerScript(context: vscode.ExtensionContext): string {
	return stablePaths(context).bundle;
}

function sha256Of(file: string): string | undefined {
	try {
		return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
	} catch {
		return undefined;
	}
}

function readBuildInfo(file: string): BundleBuildInfo | undefined {
	try {
		const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as BundleBuildInfo;
		return parsed && typeof parsed === 'object' ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function readTextIfExists(file: string): string | undefined {
	try {
		return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') as string : undefined;
	} catch {
		return undefined;
	}
}

function extensionVersionOf(context: vscode.ExtensionContext): string {
	const pkg = context.extension?.packageJSON as { version?: string } | undefined;
	return String(pkg?.version ?? 'unknown');
}

/** 동봉 번들(+사이드카)을 globalStorage로 복사하고 안정 경로를 돌려준다. */
function copyBundleToStablePath(context: vscode.ExtensionContext): string {
	const src = bundledPaths(context);
	if (!fs.existsSync(src.bundle)) {
		throw new Error(
			`동봉된 MCP 서버 번들이 없습니다: ${src.bundle}` +
			(context.extensionMode === vscode.ExtensionMode.Development
				? ' — 개발 환경이면 먼저 `npm run bundle:mcp`를 실행하세요.'
				: ' — VSIX가 손상되었을 수 있습니다. 확장을 재설치하세요.')
		);
	}
	const dst = stablePaths(context);
	fs.mkdirSync(dst.dir, { recursive: true });
	fs.copyFileSync(src.bundle, dst.bundle);
	if (fs.existsSync(src.buildInfo)) {
		fs.copyFileSync(src.buildInfo, dst.buildInfo);
	} else {
		try { fs.unlinkSync(dst.buildInfo); } catch { /* 없으면 무시 */ }
	}
	return dst.bundle;
}

/** 안정 사본이 없거나 동봉 번들과 다르면 복사한다. */
function ensureStableBundle(context: vscode.ExtensionContext): string {
	const dst = stablePaths(context);
	const src = bundledPaths(context);
	const a = sha256Of(src.bundle);
	if (a && a === sha256Of(dst.bundle)) { return dst.bundle; }
	return copyBundleToStablePath(context);
}

export type StableBundleSyncResult =
	| { action: 'absent' }
	| { action: 'bundle-missing'; detail: string }
	| { action: 'up-to-date'; stablePath: string }
	| { action: 'updated'; stablePath: string; previous?: BundleBuildInfo; current?: BundleBuildInfo }
	| { action: 'error'; detail: string };

/**
 * 활성화 시 호출: globalStorage 사본이 **있고** 동봉 번들과 내용(sha256)이 다르면 조용히 덮어쓴다(GitHub #23).
 * 사본이 없으면(등록한 적 없는 PC) 아무것도 하지 않는다. 실행 중인 MCP 프로세스는 파일을 이미 읽었으므로
 * 호출측이 "Claude Code에서 /mcp 재연결" 안내를 띄워야 한다.
 */
export function syncStableBundleIfStale(context: vscode.ExtensionContext): StableBundleSyncResult {
	const dst = stablePaths(context);
	if (!fs.existsSync(dst.bundle)) {
		return { action: 'absent' };
	}
	const src = bundledPaths(context);
	if (!fs.existsSync(src.bundle)) {
		return { action: 'bundle-missing', detail: src.bundle };
	}
	const a = sha256Of(src.bundle);
	const b = sha256Of(dst.bundle);
	if (a && b && a === b) {
		return { action: 'up-to-date', stablePath: dst.bundle };
	}
	try {
		const previous = readBuildInfo(dst.buildInfo);
		copyBundleToStablePath(context);
		return { action: 'updated', stablePath: dst.bundle, previous, current: readBuildInfo(src.buildInfo) };
	} catch (err) {
		return { action: 'error', detail: err instanceof Error ? err.message : String(err) };
	}
}

// ── 사용자 범위 설정 파일 위치 ───────────────────────────────────────────────

/** Claude Code 전역 설정 — `CLAUDE_CONFIG_DIR` 가 있으면 그 안, 없으면 홈의 `.claude.json`. */
export function claudeUserConfigPath(env: NodeJS.ProcessEnv = process.env): string {
	return env.CLAUDE_CONFIG_DIR ? path.join(env.CLAUDE_CONFIG_DIR, '.claude.json') : path.join(os.homedir(), '.claude.json');
}

/** Codex 전역 설정 — `CODEX_HOME`(기본 `~/.codex`)의 `config.toml`. */
export function codexConfigPath(env: NodeJS.ProcessEnv = process.env): string {
	return path.join(env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml');
}

// ── 점검 ────────────────────────────────────────────────────────────────────

export interface ClientRegistration extends RegistrationReport {
	configPath: string;
	/** 그 AI 도구를 이 PC 에서 쓰는 흔적(설정 파일·폴더)이 있는가 — 없으면 자동 등록을 제안하지 않는다. */
	installed: boolean;
}

export interface LegacyWorkspaceFile {
	file: string;
	kind: 'mcp-json' | 'guide-block';
	/** 정리하면 파일째 지워지는가 */
	deletes: boolean;
	error?: string;
}

export interface AiAgentSetupReport {
	extensionVersion: string;
	bundled: { path: string; exists: boolean; sha256?: string; build?: BundleBuildInfo };
	stableCopy: { path: string; exists: boolean; sha256?: string; build?: BundleBuildInfo; upToDate: boolean | null };
	claude: ClientRegistration;
	codex: ClientRegistration;
	/** 종전 Export 가 워크스페이스에 남긴 파일(정리 대상) */
	legacyWorkspaceFiles: LegacyWorkspaceFile[];
	problems: string[];
	warnings: string[];
	/** 어느 AI 도구에든 gpl-controller 를 쓸 수 있게 등록돼 있고 설정 문제가 없다. 제어기 연결 상태를 뜻하지 않는다. */
	ok: boolean;
}

/** 워크스페이스 폴더들에서 종전 Export 가 남긴 파일을 찾는다(읽기만). */
export function findLegacyWorkspaceFiles(roots: string[]): LegacyWorkspaceFile[] {
	const found: LegacyWorkspaceFile[] = [];
	for (const root of roots) {
		const checks: Array<{ file: string; kind: LegacyWorkspaceFile['kind']; strip: (t: string) => StripResult }> = [
			{ file: path.join(root, '.mcp.json'), kind: 'mcp-json', strip: stripMcpJsonEntry },
			{ file: path.join(root, 'CLAUDE.md'), kind: 'guide-block', strip: stripGuideBlock },
			{ file: path.join(root, 'AGENTS.md'), kind: 'guide-block', strip: stripGuideBlock },
		];
		for (const check of checks) {
			const text = readTextIfExists(check.file);
			if (text === undefined) { continue; }
			const result = check.strip(text);
			if (result.error) { found.push({ file: check.file, kind: check.kind, deletes: false, error: result.error }); }
			else if (result.changed) { found.push({ file: check.file, kind: check.kind, deletes: result.text === null }); }
		}
	}
	return found;
}

function workspaceRoots(): string[] {
	return (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
}

export function inspectAiAgentSetup(context: vscode.ExtensionContext, opts: { roots?: string[] } = {}): AiAgentSetupReport {
	const extensionVersion = extensionVersionOf(context);
	const src = bundledPaths(context);
	const dst = stablePaths(context);
	const bundled = { path: src.bundle, exists: fs.existsSync(src.bundle), sha256: sha256Of(src.bundle), build: readBuildInfo(src.buildInfo) };
	const stableExists = fs.existsSync(dst.bundle);
	const stableSha = stableExists ? sha256Of(dst.bundle) : undefined;
	const stableCopy = {
		path: dst.bundle, exists: stableExists, sha256: stableSha,
		build: stableExists ? readBuildInfo(dst.buildInfo) : undefined,
		upToDate: stableExists && bundled.sha256 && stableSha ? bundled.sha256 === stableSha : null,
	};
	const claudePath = claudeUserConfigPath();
	const claudeText = readTextIfExists(claudePath);
	const claude: ClientRegistration = { ...classifyClaudeUserConfig(claudeText, dst.bundle), configPath: claudePath, installed: claudeText !== undefined };
	const codexPath = codexConfigPath();
	const codex: ClientRegistration = {
		...classifyCodexConfig(readTextIfExists(codexPath), dst.bundle),
		configPath: codexPath, installed: fs.existsSync(path.dirname(codexPath)),
	};
	const legacyWorkspaceFiles = findLegacyWorkspaceFiles(opts.roots ?? workspaceRoots());

	const problems: string[] = [];
	const warnings: string[] = [];
	if (!bundled.exists || !bundled.sha256) { problems.push('동봉 MCP 번들이 없거나 읽을 수 없음 — 확장 재설치 또는 npm run bundle:mcp'); }
	const clients = [{ name: 'Claude Code', reg: claude }, ...(codex.installed ? [{ name: 'Codex', reg: codex }] : [])];
	for (const { name, reg } of clients) {
		if (reg.state === 'unreadable') { problems.push(`${name} 설정을 읽을 수 없음(${reg.configPath}): ${reg.detail}`); }
		if (reg.state === 'outdated') { warnings.push(`${name} 등록이 옛 형식(${reg.detail}) — 등록 명령이 고쳐 씀`); }
		if (reg.state === 'foreign') { warnings.push(`${name} 등록이 확장 번들이 아닌 파일을 가리킴(${reg.script ?? '?'}) — 직접 등록한 것으로 보고 그대로 둠`); }
	}
	const usable = clients.some(({ reg }) => reg.state === 'current' || reg.state === 'outdated' || reg.state === 'foreign');
	if (!usable) { problems.push('어느 AI 도구에도 gpl-controller MCP 가 등록돼 있지 않음 — 「GPL: Register AI Agent MCP」 실행'); }
	if ((claude.state === 'current' || codex.state === 'current') && stableCopy.upToDate === false) {
		problems.push('globalStorage MCP 사본이 동봉 번들과 다름 — 등록 명령 재실행');
	}
	for (const legacy of legacyWorkspaceFiles) {
		warnings.push(legacy.error
			? `${legacy.file}: ${legacy.error}`
			: `${legacy.file} — 예전 Export 가 만든 ${legacy.kind === 'mcp-json' ? 'MCP 항목' : '안내 블록'}(이제 필요 없음, 「GPL: Remove AI Agent Files from Workspace」로 정리)`);
	}
	return { extensionVersion, bundled, stableCopy, claude, codex, legacyWorkspaceFiles, problems, warnings, ok: problems.length === 0 };
}

// ── 등록 ────────────────────────────────────────────────────────────────────

export interface CliResult { ok: boolean; missing?: boolean; code?: number | string; stdout: string; stderr: string }
export type CliRunner = (args: string[]) => Promise<CliResult>;

/** `claude` CLI 실행. 설치돼 있지 않으면 `missing:true`. */
export const runClaudeCli: CliRunner = args => new Promise(resolve => {
	execFile('claude', args, { timeout: 60_000, windowsHide: true }, (err, stdout, stderr) => {
		const code = (err as NodeJS.ErrnoException | null)?.code;
		resolve({
			ok: !err,
			missing: code === 'ENOENT',
			code: code ?? (err ? 'error' : 0),
			stdout: String(stdout ?? ''),
			stderr: String(stderr ?? err?.message ?? ''),
		});
	});
});

export type ClientRegisterAction = 'registered' | 'updated' | 'unchanged' | 'kept-foreign' | 'skipped-not-installed' | 'cli-missing' | 'failed';

export interface ClientRegisterResult {
	action: ClientRegisterAction;
	before: RegistrationReport['state'];
	detail?: string;
	/** CLI 가 없을 때 사용자가 직접 실행할 명령 */
	manualCommand?: string;
}

export interface RegisterOptions {
	/** 사용자가 직접 등록한(foreign) 항목도 확장 번들로 바꾼다 — 사용자에게 물은 뒤에만 true. */
	replaceForeign?: boolean;
	/** 설치 흔적이 없어도 등록한다(명령으로 명시 실행한 경우). */
	includeNotInstalled?: boolean;
	cli?: CliRunner;
}

export interface RegisterResult {
	ok: boolean;
	serverScript?: string;
	claude?: ClientRegisterResult;
	codex?: ClientRegisterResult;
	error?: string;
	detail?: string;
}

function needsWrite(state: RegistrationReport['state'], replaceForeign: boolean): boolean {
	return state === 'absent' || state === 'outdated' || (state === 'foreign' && replaceForeign);
}

function manualClaudeCommand(json: string): string {
	return `claude mcp add-json ${MCP_SERVER_NAME} '${json.replace(/'/g, "''")}' --scope user`;
}

async function registerClaude(serverScript: string, opts: RegisterOptions): Promise<ClientRegisterResult> {
	const configPath = claudeUserConfigPath();
	const before = classifyClaudeUserConfig(readTextIfExists(configPath), serverScript);
	if (before.state === 'unreadable') { return { action: 'failed', before: before.state, detail: `${configPath} 를 해석할 수 없어 건드리지 않음: ${before.detail}` }; }
	if (before.state === 'current') { return { action: 'unchanged', before: before.state }; }
	if (before.state === 'foreign' && !opts.replaceForeign) { return { action: 'kept-foreign', before: before.state, detail: before.detail }; }
	if (!needsWrite(before.state, !!opts.replaceForeign)) { return { action: 'unchanged', before: before.state }; }
	const json = JSON.stringify(desiredMcpEntry(serverScript));
	const cli = opts.cli ?? runClaudeCli;
	if (before.state !== 'absent') {
		const removed = await cli(['mcp', 'remove', MCP_SERVER_NAME, '--scope', 'user']);
		if (removed.missing) { return { action: 'cli-missing', before: before.state, manualCommand: manualClaudeCommand(json) }; }
	}
	const added = await cli(['mcp', 'add-json', MCP_SERVER_NAME, json, '--scope', 'user']);
	if (added.missing) { return { action: 'cli-missing', before: before.state, manualCommand: manualClaudeCommand(json) }; }
	// 결과는 CLI 종료 코드가 아니라 설정 파일을 다시 읽어 판정한다.
	const after = classifyClaudeUserConfig(readTextIfExists(configPath), serverScript);
	if (after.state !== 'current') {
		return { action: 'failed', before: before.state, detail: `등록 뒤 상태 ${after.state}${after.detail ? ` (${after.detail})` : ''} — ${(added.stderr || added.stdout).trim().slice(0, 300)}` };
	}
	return { action: before.state === 'absent' ? 'registered' : 'updated', before: before.state };
}

function registerCodex(serverScript: string, opts: RegisterOptions): ClientRegisterResult {
	const configPath = codexConfigPath();
	if (!opts.includeNotInstalled && !fs.existsSync(path.dirname(configPath))) {
		return { action: 'skipped-not-installed', before: 'absent' };
	}
	const text = readTextIfExists(configPath);
	const before = classifyCodexConfig(text, serverScript);
	if (before.state === 'current') { return { action: 'unchanged', before: before.state }; }
	if (before.state === 'foreign' && !opts.replaceForeign) { return { action: 'kept-foreign', before: before.state, detail: before.detail }; }
	if (!needsWrite(before.state, !!opts.replaceForeign)) { return { action: 'unchanged', before: before.state }; }
	try {
		fs.mkdirSync(path.dirname(configPath), { recursive: true });
		fs.writeFileSync(configPath, upsertCodexServer(text ?? '', desiredMcpEntry(serverScript)));
	} catch (err) {
		return { action: 'failed', before: before.state, detail: err instanceof Error ? err.message : String(err) };
	}
	const after = classifyCodexConfig(readTextIfExists(configPath), serverScript);
	if (after.state !== 'current') { return { action: 'failed', before: before.state, detail: `기록 뒤 상태 ${after.state}${after.detail ? ` (${after.detail})` : ''}` }; }
	return { action: before.state === 'absent' ? 'registered' : 'updated', before: before.state };
}

/** 안정 사본을 맞춘 뒤 Claude Code(사용자 범위)와 Codex 에 등록한다. 이미 맞으면 아무것도 쓰지 않는다. */
export async function registerUserScopeMcp(context: vscode.ExtensionContext, opts: RegisterOptions = {}): Promise<RegisterResult> {
	let serverScript: string;
	try {
		serverScript = ensureStableBundle(context);
	} catch (err) {
		return { ok: false, error: 'bundle-failed', detail: err instanceof Error ? err.message : String(err) };
	}
	const claude = await registerClaude(serverScript, opts);
	const codex = registerCodex(serverScript, opts);
	const failed = [claude, codex].some(r => r.action === 'failed');
	return { ok: !failed, serverScript, claude, codex };
}

// ── 워크스페이스 정리 ───────────────────────────────────────────────────────

export interface CleanResult { file: string; action: 'edited' | 'deleted' | 'failed'; detail?: string }

/** 종전 Export 가 남긴 항목만 지운다(사용자 본문·다른 MCP 서버는 보존). 호출측이 먼저 사용자 확인을 받는다. */
export function cleanLegacyWorkspaceFiles(files: LegacyWorkspaceFile[]): CleanResult[] {
	const results: CleanResult[] = [];
	for (const legacy of files) {
		if (legacy.error) { results.push({ file: legacy.file, action: 'failed', detail: legacy.error }); continue; }
		try {
			const text = fs.readFileSync(legacy.file, 'utf8') as string;
			const result = legacy.kind === 'mcp-json' ? stripMcpJsonEntry(text) : stripGuideBlock(text);
			if (result.error) { results.push({ file: legacy.file, action: 'failed', detail: result.error }); continue; }
			if (!result.changed) { continue; }
			if (result.text === null) {
				fs.unlinkSync(legacy.file);
				results.push({ file: legacy.file, action: 'deleted' });
			} else {
				fs.writeFileSync(legacy.file, result.text);
				results.push({ file: legacy.file, action: 'edited' });
			}
		} catch (err) {
			results.push({ file: legacy.file, action: 'failed', detail: err instanceof Error ? err.message : String(err) });
		}
	}
	return results;
}
