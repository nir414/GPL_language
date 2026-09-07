/**
 * 워크스페이스 프로젝트 컨텍스트 — 기대 프로젝트 이름/폴더 감지, launch.json 읽기·생성,
 * GPL 파일명 → 워크스페이스 경로 해석(동명 경합 시 기대 프로젝트 우선).
 *
 * 여러 명령 그룹(연결·배포·중단점·디버그 이벤트)이 같은 규칙을 쓰므로 `host.project` 로 노출한다.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getControllerConfig } from '../controller/controllerConnection';
import { findProjectDirs } from '../controller/deployService';
import { checkProjectName, describeProjectNameProblem } from '../controller/projectNameGuard';
import { parseGpr, pickSourceCandidate } from '../controller/responseParser';
import { parseJsonc, upsertLaunchConfiguration } from '../launchJsonc';
import { walkTree } from '../project/projectSources';
import type { ExtensionHost } from './host';

export interface ProjectContextApi {
	detectWorkspaceProjectContext(): Promise<{ projectName: string; folderName: string }>;
	detectWorkspaceProjectName(): Promise<string>;
	scheduleExpectedProjectSync(reason: string): void;
	readLaunchControllerInfo(): { ip?: string; port?: number; projectName?: string } | undefined;
	resolveExpectedProjectName(): Promise<string>;
	createOrUpdateLaunchJson(): Promise<string | undefined>;
	findWorkspaceFilesByName(target: string): string[];
	findExpectedProjectDirs(): string[];
	resolveGplFilePath(filename: string): string | undefined;
}

export function activateProjectContext(host: ExtensionHost): ProjectContextApi {
	const { context } = host;

	/** 워크스페이스 프로젝트 컨텍스트 감지 시 이름 문제를 세션당 한 번 경고한다(명령을 보내기 전에 미리 알리는 경보). */
	const warnedUnsafeProjectNames = new Set<string>();
	function warnUnsafeProjectContextOnce(projectName: string, folderName: string): void {
		const gprNamed = projectName !== folderName;
		const check = checkProjectName(projectName);
		if (check.ok || warnedUnsafeProjectNames.has(projectName)) { return; }
		warnedUnsafeProjectNames.add(projectName);
		const reason = describeProjectNameProblem(projectName, gprNamed ? 'project' : 'folder', check);
		host.log(`[ProjectContext] ⚠ ${reason}`);
		void vscode.window.showWarningMessage(`GPL 프로젝트명 경고 — ${reason}`);
	}
	async function detectWorkspaceProjectContext(): Promise<{ projectName: string; folderName: string }> {
		const dirs = await findProjectDirs();
		if (dirs.length === 0) {
			return { projectName: '', folderName: '' };
		}

		const activePath = vscode.window.activeTextEditor?.document?.uri.scheme === 'file'
			? vscode.window.activeTextEditor.document.uri.fsPath
			: '';

		const sortedDirs = [...dirs].sort((a, b) => b.length - a.length);
		let preferred = sortedDirs[0];
		if (activePath) {
			const matched = sortedDirs.find(d => {
				try {
					const rel = path.relative(path.resolve(d), path.resolve(activePath));
					return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
				} catch {
					return false;
				}
			});
			if (matched) { preferred = matched; }
		}

		const folderName = path.basename(preferred).trim();
		try {
			const gprPath = path.join(preferred, 'Project.gpr');
			const text = fs.readFileSync(gprPath, 'utf-8');
			const info = parseGpr(text);
			return {
				projectName: (info.projectName || folderName).trim(),
				folderName,
			};
		} catch {
			return { projectName: folderName, folderName };
		}
	}

	async function detectWorkspaceProjectName(): Promise<string> {
		const context = await detectWorkspaceProjectContext();
		return context.projectName;
	}

	let expectedProjectSyncTimer: ReturnType<typeof setTimeout> | undefined;
	function scheduleExpectedProjectSync(reason: string): void {
		if (host.isDebugSessionActive) {
			return;
		}
		if (expectedProjectSyncTimer) {
			clearTimeout(expectedProjectSyncTimer);
		}
		expectedProjectSyncTimer = setTimeout(() => {
			void detectWorkspaceProjectContext().then(projectContext => {
				host.controllerTree?.setExpectedProjectContext(projectContext.projectName, projectContext.folderName);
				if (projectContext.projectName) {
					host.log(`[ProjectContext] expected project (${reason}): ${projectContext.projectName} / ftp folder: ${projectContext.folderName}`);
					warnUnsafeProjectContextOnce(projectContext.projectName, projectContext.folderName);
				}
			});
		}, 150);
	}

	scheduleExpectedProjectSync('startup');
	// deactivate 시 디바운스 타이머 해제 (좀비 콜백 방지)
	context.subscriptions.push({ dispose: () => { if (expectedProjectSyncTimer) { clearTimeout(expectedProjectSyncTimer); expectedProjectSyncTimer = undefined; } } });

	function getPreferredWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders || folders.length === 0) { return undefined; }

		const activeUri = vscode.window.activeTextEditor?.document?.uri;
		if (activeUri && activeUri.scheme === 'file') {
			const fromActive = vscode.workspace.getWorkspaceFolder(activeUri);
			if (fromActive) { return fromActive; }
		}

		return folders[0];
	}

	/**
	 * .vscode/launch.json에서 첫 brooks-gpl 구성을 읽어 controller 정보를 추출.
	 * launch.json이 없거나 파싱 실패하면 undefined.
	 */
	function readLaunchControllerInfo(): { ip?: string; port?: number; projectName?: string } | undefined {
		const folder = getPreferredWorkspaceFolder();
		if (!folder) { return undefined; }
		const launchPath = path.join(folder.uri.fsPath, '.vscode', 'launch.json');
		if (!fs.existsSync(launchPath)) { return undefined; }
		try {
			const text = fs.readFileSync(launchPath, 'utf8');
			// launch.json은 JSONC(주석·trailing comma 허용). VS Code와 같은 jsonc-parser로 읽는다(GitHub #30 —
			// 종전 정규식 주석 제거는 줄 끝 주석·문자열 안 '/*'·trailing comma에 취약했다).
			const { value: parsed, errors } = parseJsonc<{ configurations?: unknown }>(text);
			if (errors.length > 0) { return undefined; }
			const configs: any[] = Array.isArray(parsed?.configurations) ? (parsed!.configurations as any[]) : [];
			const gplCfg = configs.find(c => c?.type === 'brooks-gpl');
			if (!gplCfg) { return undefined; }
			const rawIp = typeof gplCfg.controllerIp === 'string' ? gplCfg.controllerIp.trim() : '';
			const rawPort = gplCfg.controllerPort;
			const rawProject = typeof gplCfg.projectName === 'string' ? gplCfg.projectName.trim() : '';

			const ip = resolveLaunchVariables(rawIp, folder);
			const projectName = resolveLaunchVariables(rawProject, folder);
			let port: number | undefined;
			if (typeof rawPort === 'number') {
				port = rawPort;
			} else if (typeof rawPort === 'string') {
				const resolvedPort = resolveLaunchVariables(rawPort.trim(), folder);
				const n = Number(resolvedPort);
				if (Number.isFinite(n) && n > 0) { port = n; }
			}
			return {
				ip: ip || undefined,
				port,
				projectName: projectName || undefined,
			};
		} catch {
			return undefined;
		}
	}

	/**
	 * launch.json 값에 포함된 VS Code 변수 placeholder를 해석한다.
	 * 지원: ${config:NAMESPACE.KEY}, ${env:VAR}, ${workspaceFolder}, ${workspaceFolderBasename}.
	 * 해석 실패 또는 빈 결과면 빈 문자열 반환 (자기참조 ${config:gpl.controller.ip} 같은 케이스 안전 처리).
	 */
	function resolveLaunchVariables(value: string, folder: vscode.WorkspaceFolder): string {
		if (!value) { return ''; }
		// placeholder가 없으면 그대로 반환
		if (!value.includes('${')) { return value; }

		const replaced = value.replace(/\$\{([^}]+)\}/g, (_match, expr: string) => {
			const trimmed = expr.trim();
			if (trimmed === 'workspaceFolder') {
				return folder.uri.fsPath;
			}
			if (trimmed === 'workspaceFolderBasename') {
				return path.basename(folder.uri.fsPath);
			}
			if (trimmed.startsWith('config:')) {
				const key = trimmed.slice('config:'.length).trim();
				const v = vscode.workspace.getConfiguration().get<unknown>(key);
				return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
			}
			if (trimmed.startsWith('env:')) {
				const name = trimmed.slice('env:'.length).trim();
				return process.env[name] ?? '';
			}
			// 미지원 placeholder는 빈 문자열 (사이드바에 ${...} 리터럴이 노출되는 것 방지)
			return '';
		});

		// 해석 후에도 ${ 가 남아있으면 부분 실패로 간주 — 호출자가 폴백하도록 빈 문자열
		if (replaced.includes('${')) { return ''; }
		return replaced.trim();
	}

	/**
	 * expected project 이름 결정: launch.json 우선 → Project.gpr 기반 폴백.
	 */
	async function resolveExpectedProjectName(): Promise<string> {
		const fromLaunch = readLaunchControllerInfo()?.projectName;
		if (fromLaunch) { return fromLaunch; }
		return await detectWorkspaceProjectName();
	}

	async function createOrUpdateLaunchJson(): Promise<string | undefined> {
		const folder = getPreferredWorkspaceFolder();
		if (!folder) {
			vscode.window.showWarningMessage('워크스페이스 폴더가 없어 launch.json을 만들 수 없습니다.');
			return undefined;
		}

		const cfg = getControllerConfig();
		const detectedProjectName = await detectWorkspaceProjectName();
		const projectName = detectedProjectName || path.basename(folder.uri.fsPath);
		const vscodeDir = path.join(folder.uri.fsPath, '.vscode');
		const launchPath = path.join(vscodeDir, 'launch.json');

		const attachConfig = {
			name: `GPL: Attach (${projectName})`,
			type: 'brooks-gpl',
			request: 'attach',
			controllerIp: cfg.ip,
			controllerPort: cfg.port,
			projectName,
			deployBeforeAttach: true,
			stopOnEntry: false,
		};

		const stopOnEntryConfig = {
			name: `GPL: Attach (${projectName}) — Stop on Entry`,
			type: 'brooks-gpl',
			request: 'attach',
			controllerIp: cfg.ip,
			controllerPort: cfg.port,
			projectName,
			deployBeforeAttach: true,
			stopOnEntry: true,
		};

		// GitHub #30: launch.json 은 JSONC 다. 종전에는 엄격한 JSON.parse 로 읽어 주석 한 줄에도 "파싱 실패"로 중단했고,
		// 갱신은 JSON.stringify 로 파일 전체를 다시 써 사용자의 주석·${config:…} 참조·들여쓰기를 지웠다.
		// 이제 jsonc-parser 로 읽고, 같은 name 의 GPL 구성 항목만 modify/applyEdits 로 부분 갱신해 나머지를 보존한다.
		let currentText = '';
		if (fs.existsSync(launchPath)) {
			currentText = fs.readFileSync(launchPath, 'utf8');
		}
		let nextText: string;
		const actions: string[] = [];
		try {
			const first = upsertLaunchConfiguration(currentText, attachConfig);
			const second = upsertLaunchConfiguration(first.text, stopOnEntryConfig);
			nextText = second.text;
			actions.push(`${attachConfig.name}: ${first.action}`, `${stopOnEntryConfig.name}: ${second.action}`);
		} catch (err: any) {
			// 메시지에 줄/열이 들어 있다(launchJsonc.describeJsoncErrors). 파일은 건드리지 않는다.
			vscode.window.showErrorMessage(`${err?.message ?? err} — ${launchPath}`);
			host.log(`[launch.json] ${err?.message ?? err}`);
			return undefined;
		}

		fs.mkdirSync(vscodeDir, { recursive: true });
		if (nextText !== currentText) {
			fs.writeFileSync(launchPath, nextText, 'utf8');
		}
		host.log(`[launch.json] ${actions.join(' / ')} (${nextText === currentText ? '변경 없음' : '주석·다른 구성 보존, GPL 항목만 갱신'})`);
		return launchPath;
	}
	/**
	 * 워크스페이스에서 이름이 target(대소문자 무시)인 파일 전부를 수집한다.
	 *
	 * 제외 규칙과 깊이/개수 상한은 `projectSources.walkTree`(단일 출처, 디버그 소스맵과 동일)가 맡는다.
	 * 종전에는 상한 없는 동기 재귀라, 저장소 상위 폴더를 워크스페이스로 열면 확장 호스트가 멈췄다.
	 */
	function findWorkspaceFilesByName(target: string): string[] {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders) { return []; }
		const lower = target.toLowerCase();
		const results: string[] = [];
		let truncated = false;
		for (const folder of folders) {
			const r = walkTree(folder.uri.fsPath, (full, name) => {
				if (name.toLowerCase() === lower) { results.push(full); }
			});
			truncated = truncated || r.truncated;
		}
		if (truncated) {
			host.log(
				`⚠ "${target}" 탐색이 깊이/개수 상한에 걸렸습니다 — 워크스페이스가 너무 큽니다. `
				+ '프로젝트(또는 projects) 폴더를 워크스페이스로 열면 정확해집니다.',
			);
		}
		return results;
	}

	/**
	 * 제어기 트리의 기대 프로젝트와 이름이 일치하는 Project.gpr 폴더들을 수집한다.
	 * 동명 소스 경합 시 우선 선택 기준 (gplDebugSession._updateProjectDirs와 같은 역할).
	 */
	function findExpectedProjectDirs(): string[] {
		const expected = host.controllerTree?.getExpectedProjectName?.()?.trim();
		if (!expected) { return []; }
		const want = expected.toLowerCase();
		const dirs: string[] = [];
		for (const gprPath of findWorkspaceFilesByName('Project.gpr')) {
			try {
				const info = parseGpr(fs.readFileSync(gprPath, 'utf-8'));
				if (info.projectName && info.projectName.toLowerCase() === want) {
					dirs.push(path.dirname(gprPath));
				}
			} catch { /* skip */ }
		}
		return dirs;
	}

	/**
	 * Resolve a GPL filename (basename) to a workspace file path.
	 *
	 * 디버그 어댑터(gplDebugSession._resolveSourcePath/_pickSourcePath)와 같은 규칙:
	 * .history 등 dot 폴더 제외 + 동명 경합 시 기대 프로젝트 폴더 우선. 예전에는
	 * 첫 매치를 그대로 반환해 .history의 stale 사본이 열렸다 (디버그 패널과 트리
	 * 명령의 동작 불일치 원인).
	 */
	function resolveGplFilePath(filename: string): string | undefined {
		// 제어기가 전체 경로를 줄 수 있으므로 베이스네임만 비교 대상으로 삼는다.
		const target = filename.replace(/^.*[\\/]/, '');
		const candidates = findWorkspaceFilesByName(target);
		if (candidates.length === 0) { return undefined; }

		const pick = pickSourceCandidate(candidates, findExpectedProjectDirs())!;
		if (pick.ambiguous.length > 0) {
			host.log(
				`⚠ 동명 소스 ${candidates.length}개 경합: "${target}" → ${pick.path} 선택 ` +
				`(제외: ${pick.ambiguous.join(' | ')}). 엉뚱한 파일이 열리면 워크스페이스에서 ` +
				`사본/백업 폴더를 정리하세요.`,
			);
		}
		return pick.path;
	}

	return {
		detectWorkspaceProjectContext,
		detectWorkspaceProjectName,
		scheduleExpectedProjectSync,
		readLaunchControllerInfo,
		resolveExpectedProjectName,
		createOrUpdateLaunchJson,
		findWorkspaceFilesByName,
		findExpectedProjectDirs,
		resolveGplFilePath,
	};
}
