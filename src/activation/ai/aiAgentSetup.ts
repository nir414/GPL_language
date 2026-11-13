/**
 * AI 에이전트 MCP 등록(사용자 범위)·점검·워크스페이스 정리 + MCP 사본 자동 갱신(2026-11-04, ai-handoff §1-GV).
 *
 * 종전에는 워크스페이스마다 `.mcp.json`·CLAUDE.md 를 만들고 제어기 IP 를 적어, IP 가 바뀌면 낡았다. 이제 등록은
 * Claude Code/Codex 의 사용자 설정에 한 번만 하고(서버 경로는 globalStorage 안정 사본), 주소는 MCP 서버가 확장 창을 따른다.
 */
import * as vscode from 'vscode';
import {
	registerUserScopeMcp, inspectAiAgentSetup, syncStableBundleIfStale, cleanLegacyWorkspaceFiles,
	AiAgentSetupReport, RegisterResult, ClientRegisterResult, LegacyWorkspaceFile, CleanResult,
} from '../../controller/automation/exportAgentSetup';
import type { ExtensionHost } from '../host';

type SetupRequest = { nonInteractive?: boolean; replaceForeign?: boolean };
type RegistrationMode = 'prompt' | 'auto' | 'off';

const PROMPT_DECLINED_KEY = 'gpl.ai.mcpRegistration.declined';
const LEGACY_PROMPTED_KEY = 'gpl.ai.legacyWorkspaceFiles.prompted';
const RECONNECT_HINT = ' 실행 중인 Claude Code 는 /mcp 로 재연결하세요.';

function describeClient(name: string, r: ClientRegisterResult | undefined): string | undefined {
	if (!r) { return undefined; }
	switch (r.action) {
		case 'registered': return `${name}: 등록함`;
		case 'updated': return `${name}: 새 형식으로 갱신함`;
		case 'unchanged': return `${name}: 이미 등록됨`;
		case 'kept-foreign': return `${name}: 직접 등록한 항목 유지`;
		case 'skipped-not-installed': return undefined;
		case 'cli-missing': return `${name}: claude CLI 없음 — 명령을 직접 실행해 주세요`;
		case 'failed': return `${name}: 실패(${r.detail ?? '원인 미상'})`;
	}
}

function summarizeRegister(result: RegisterResult): string {
	if (!result.ok && result.error) { return `AI 에이전트 MCP 등록 실패: ${result.detail ?? result.error}`; }
	const parts = [describeClient('Claude Code', result.claude), describeClient('Codex', result.codex)].filter(Boolean);
	return `AI 에이전트 MCP — ${parts.join(' · ')}.${wroteSomething(result) ? RECONNECT_HINT : ''}`;
}

function wroteSomething(result: RegisterResult): boolean {
	return [result.claude, result.codex].some(r => r?.action === 'registered' || r?.action === 'updated');
}

function reportSummary(report: AiAgentSetupReport): string {
	const head = report.ok ? 'GPL AI 에이전트 설정 정상' : `GPL AI 에이전트 설정 문제 ${report.problems.length}건`;
	const detail = [...report.problems, ...report.warnings].slice(0, 2).join(' / ');
	return `${head}${report.warnings.length ? ` · 안내 ${report.warnings.length}건` : ''}${detail ? ` — ${detail}` : ''}`;
}

function hasCleanableFiles(report: AiAgentSetupReport): boolean {
	return report.legacyWorkspaceFiles.some(f => !f.error);
}

/** claude CLI 가 없으면 사용자가 직접 실행할 명령을 복사할 수 있게 한다. */
async function offerManualCommand(host: ExtensionHost, result: RegisterResult): Promise<void> {
	const manual = result.claude?.action === 'cli-missing' ? result.claude.manualCommand : undefined;
	if (!manual) { return; }
	host.log(`[AI Setup] claude CLI 를 찾지 못함 — 직접 실행할 명령: ${manual}`);
	const pick = await vscode.window.showWarningMessage(
		'claude CLI 를 PATH 에서 찾지 못해 Claude Code 에 등록하지 못했습니다. 터미널에서 등록 명령을 한 번 실행해 주세요.',
		'명령 복사',
	);
	if (pick === '명령 복사') { await vscode.env.clipboard.writeText(manual); }
}

/** 직접 등록한 항목이 있으면(대화형일 때) 바꿀지 묻는다. 취소하면 undefined. */
async function askReplaceForeign(host: ExtensionHost): Promise<boolean | undefined> {
	const before = inspectAiAgentSetup(host.context);
	const foreign = [
		...(before.claude.state === 'foreign' ? [`Claude Code(${before.claude.script ?? '?'})`] : []),
		...(before.codex.installed && before.codex.state === 'foreign' ? [`Codex(${before.codex.script ?? '?'})`] : []),
	];
	if (foreign.length === 0) { return false; }
	const pick = await vscode.window.showWarningMessage(
		`gpl-controller 가 이미 다른 서버 파일로 등록돼 있습니다: ${foreign.join(', ')}. 확장에 들어 있는 서버로 바꿀까요?`,
		{ modal: true, detail: '직접 개발 중인 소스를 가리키게 해 두었다면 「유지」를 고르세요.' },
		'바꾸기', '유지',
	);
	return pick === undefined ? undefined : pick === '바꾸기';
}

async function register(host: ExtensionHost, request: SetupRequest): Promise<RegisterResult> {
	let replaceForeign = request.replaceForeign === true;
	if (!request.nonInteractive && !replaceForeign) {
		const answer = await askReplaceForeign(host);
		if (answer === undefined) { return { ok: false, error: 'cancelled' }; }
		replaceForeign = answer;
	}
	const result = await registerUserScopeMcp(host.context, { replaceForeign });
	host.log(`[AI Setup] MCP 등록 => ${JSON.stringify(result)}`);
	return result;
}

/** 예전 Export 가 남긴 항목만 정리한다 — 대화형이면 목록을 보여 주고 확인을 받는다. */
async function cleanWorkspace(host: ExtensionHost, request: SetupRequest, files?: LegacyWorkspaceFile[]): Promise<{ ok: boolean; cleaned: CleanResult[]; skipped?: string }> {
	const targets = (files ?? inspectAiAgentSetup(host.context).legacyWorkspaceFiles).filter(f => !f.error);
	if (targets.length === 0) {
		if (!request.nonInteractive) { void vscode.window.showInformationMessage('정리할 예전 AI 설정 파일이 없습니다.'); }
		return { ok: true, cleaned: [] };
	}
	if (!request.nonInteractive) {
		const list = targets.map(f => `• ${f.file} — ${f.deletes ? '파일 삭제(확장이 만든 내용뿐)' : f.kind === 'mcp-json' ? 'gpl-controller 항목만 제거' : '자동 안내 블록만 제거'}`).join('\n');
		const pick = await vscode.window.showWarningMessage(
			'예전 「Export AI Agent Setup」이 만든 항목을 정리할까요? 직접 쓴 내용과 다른 MCP 서버는 그대로 둡니다.',
			{ modal: true, detail: list },
			'정리',
		);
		if (pick !== '정리') { return { ok: false, cleaned: [], skipped: 'cancelled' }; }
	}
	const cleaned = cleanLegacyWorkspaceFiles(targets);
	host.log(`[AI Setup] 워크스페이스 정리 => ${JSON.stringify(cleaned)}`);
	const failed = cleaned.filter(c => c.action === 'failed');
	if (!request.nonInteractive) {
		void (failed.length > 0
			? vscode.window.showWarningMessage(`AI 설정 파일 정리 중 ${failed.length}건 실패 — 출력 창을 확인하세요.`)
			: vscode.window.showInformationMessage(`AI 설정 파일 ${cleaned.length}건을 정리했습니다. SVN/Git 작업본이면 변경을 확인해 주세요.`));
	}
	return { ok: failed.length === 0, cleaned };
}

/**
 * 활성화 시 자동 동기화: 확장 사본을 가리키는 옛 형식 항목은 묻지 않고 고치고, 미등록이면 설정(`gpl.ai.mcpRegistration`)에
 * 따라 등록하거나 한 번 묻는다. 사용자 범위 등록이 있으면 예전 워크스페이스 파일 정리를 작업 공간마다 한 번 제안한다.
 */
async function autoSync(host: ExtensionHost, mode: RegistrationMode): Promise<void> {
	const { context } = host;
	const report = inspectAiAgentSetup(context);
	const clients = [report.claude, ...(report.codex.installed ? [report.codex] : [])];
	let shouldRegister = clients.some(c => c.state === 'outdated');
	if (!shouldRegister && clients.some(c => c.installed && c.state === 'absent')) {
		if (mode === 'auto') {
			shouldRegister = true;
		} else if (!context.globalState.get<boolean>(PROMPT_DECLINED_KEY, false)) {
			const pick = await vscode.window.showInformationMessage(
				'Claude Code/Codex 에서 제어기를 다룰 수 있게 gpl-controller MCP 서버를 사용자 설정에 한 번 등록할까요? '
					+ '프로젝트 폴더에는 파일을 만들지 않고, 제어기 IP 가 바뀌어도 다시 등록할 필요가 없습니다.',
				'등록', '나중에', '다시 묻지 않기',
			);
			shouldRegister = pick === '등록';
			if (pick === '다시 묻지 않기') { await context.globalState.update(PROMPT_DECLINED_KEY, true); }
		}
	}
	if (shouldRegister) {
		const result = await registerUserScopeMcp(context, { replaceForeign: false });
		host.log(`[AI Setup] 자동 MCP 등록 => ${JSON.stringify(result)}`);
		if (wroteSomething(result) || !result.ok) { void vscode.window.showInformationMessage(summarizeRegister(result)); }
		await offerManualCommand(host, result);
	}

	const after = shouldRegister ? inspectAiAgentSetup(context) : report;
	const registered = [after.claude, after.codex].some(c => c.state === 'current' || c.state === 'outdated' || c.state === 'foreign');
	const legacy = after.legacyWorkspaceFiles.filter(f => !f.error);
	if (!registered || legacy.length === 0 || context.workspaceState.get<boolean>(LEGACY_PROMPTED_KEY, false)) { return; }
	await context.workspaceState.update(LEGACY_PROMPTED_KEY, true);
	const pick = await vscode.window.showInformationMessage(
		`이 작업 공간에 예전 「Export AI Agent Setup」이 만든 파일이 ${legacy.length}개 있습니다(.mcp.json·CLAUDE.md 안내 블록 등). `
			+ '이제 사용자 설정 등록으로 대신하므로 필요 없습니다. 정리할까요?',
		'정리…', '그대로 두기',
	);
	if (pick === '정리…') { await cleanWorkspace(host, {}, legacy); }
}

/** 확장 업데이트 뒤 globalStorage 의 MCP 서버 사본을 동봉 번들로 맞춘다(GitHub #23). */
function refreshBundle(host: ExtensionHost): void {
	const sync = syncStableBundleIfStale(host.context);
	if (sync.action !== 'absent' && sync.action !== 'up-to-date') { host.log(`[AI Setup] MCP 사본 동기화: ${JSON.stringify(sync)}`); }
	if (sync.action === 'updated') {
		const from = sync.previous?.version ? `v${sync.previous.version}` : '구버전(스탬프 없음)';
		const to = sync.current?.version ? `v${sync.current.version}` : '현재 번들';
		void vscode.window.showInformationMessage(`gpl-controller MCP 서버를 ${from} → ${to}로 갱신했습니다.${RECONNECT_HINT}`);
	}
}

export function activateAiAgentSetup(host: ExtensionHost): void {
	const { context, outputChannel } = host;

	context.subscriptions.push(vscode.commands.registerCommand('gpl.ai.exportAgentSetup', async (args?: SetupRequest) => {
		const request = args ?? {};
		const result = await register(host, request);
		if (result.error === 'cancelled') { return result; }
		const report = inspectAiAgentSetup(context);
		host.log(`[AI Setup] 등록 후 점검 => ${JSON.stringify(report, null, 2)}`);
		if (!request.nonInteractive) {
			await offerManualCommand(host, result);
			const actions = [...(hasCleanableFiles(report) ? ['예전 파일 정리'] : []), '출력 보기'];
			const pick = result.ok
				? await vscode.window.showInformationMessage(summarizeRegister(result), ...actions)
				: await vscode.window.showWarningMessage(summarizeRegister(result), ...actions);
			if (pick === '예전 파일 정리') { await cleanWorkspace(host, {}, report.legacyWorkspaceFiles); }
			else if (pick === '출력 보기') { outputChannel.show(true); }
		}
		return { ...result, report };
	}));

	context.subscriptions.push(vscode.commands.registerCommand('gpl.ai.checkAgentSetup', async (args?: SetupRequest) => {
		const request = args ?? {};
		const report = inspectAiAgentSetup(context);
		host.log(`[AI Setup] gpl.ai.checkAgentSetup => ${JSON.stringify(report, null, 2)}`);
		if (!request.nonInteractive) {
			const actions = [...(report.ok ? [] : ['등록']), ...(hasCleanableFiles(report) ? ['예전 파일 정리'] : []), '출력 보기'];
			const pick = report.ok && report.warnings.length === 0
				? await vscode.window.showInformationMessage(reportSummary(report), ...actions)
				: await vscode.window.showWarningMessage(reportSummary(report), ...actions);
			if (pick === '등록') { await vscode.commands.executeCommand('gpl.ai.exportAgentSetup'); }
			else if (pick === '예전 파일 정리') { await cleanWorkspace(host, {}, report.legacyWorkspaceFiles); }
			else if (pick === '출력 보기') { outputChannel.show(true); }
		}
		return report;
	}));

	context.subscriptions.push(vscode.commands.registerCommand('gpl.ai.cleanWorkspaceAgentSetup', (args?: SetupRequest) => cleanWorkspace(host, args ?? {})));

	const config = vscode.workspace.getConfiguration('gpl.ai');
	if (config.get<boolean>('autoRefreshMcpBundle', true)) { refreshBundle(host); }
	// F5 개발 호스트는 globalStorage 가 별도 프로필이라 사용자 설정을 그 경로로 바꿔 쓰면 안 된다 — 명령으로만 등록한다.
	if (context.extensionMode === vscode.ExtensionMode.Development) { return; }
	const mode = config.get<RegistrationMode>('mcpRegistration', 'prompt');
	if (mode === 'off') { return; }
	void autoSync(host, mode).catch(err => host.log(`[AI Setup] 자동 동기화 실패: ${String(err)}`));
}
