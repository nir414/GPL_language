/**
 * 제어기 트리 FTP 노드의 대상 판정 — vscode 무의존 순수 모듈.
 *
 * 배경(PR #38 리뷰, 2026-10-26):
 *  - 펼친 하위 폴더도 최상위 프로젝트 폴더와 같은 contextValue(`ftpFolder`)를 받아, 프로젝트 명령(Run·Stop·Unload)이
 *    `/GPL/App/Utils` 같은 일반 폴더에도 보였다. 명령은 노드 이름(basename)을 프로젝트 이름으로 쓰므로
 *    `Unload Utils` 처럼 무관한 프로젝트를 내릴 수 있었다 → 하위 폴더는 별도 context, 프로젝트 명령은
 *    설정된 저장 영역(`/GPL`·flash) **바로 아래** 폴더에만.
 *  - 노드는 목록을 만든 제어기(`controllerHost`)를 들고 있지만 명령은 현재 설정의 제어기로 나간다. 제어기 A→B
 *    전환 뒤 A 의 노드로 B 를 조작할 수 있었다 → 변경 명령 전(그리고 확인 창 뒤)마다 노드의 제어기가 현재 제어기인지 본다.
 *
 * 이 모듈은 판정만 한다. 알림·로그는 호출부(activation/ftpCommands)가 맡는다.
 */

import { normalizeAbsoluteRemoteDir } from './ftpClient';

/** 제어기 트리 FTP 노드의 contextValue — package.json 메뉴 `when` 절과 같은 문자열이다. */
export const FTP_NODE_CONTEXT = {
	/** 저장 영역(/GPL) 바로 아래 폴더 = 프로젝트 폴더. 프로젝트 명령 대상. */
	projectFolder: 'ftpFolder',
	/** flash 저장 영역 바로 아래 폴더. */
	flashProjectFolder: 'ftpFlashFolder',
	/** 프로젝트 폴더 안의 하위 폴더 — 탐색·삭제만. */
	subFolder: 'ftpSubFolder',
	flashSubFolder: 'ftpFlashSubFolder',
	file: 'ftpFile',
	flashFile: 'ftpFlashFile',
} as const;

/** 목록 항목의 contextValue. `nested` 는 저장 영역 바로 아래가 아닌(펼친 폴더 안의) 항목이다. */
export function ftpEntryContext(isDirectory: boolean, flash: boolean, nested: boolean): string {
	if (!isDirectory) { return flash ? FTP_NODE_CONTEXT.flashFile : FTP_NODE_CONTEXT.file; }
	if (nested) { return flash ? FTP_NODE_CONTEXT.flashSubFolder : FTP_NODE_CONTEXT.subFolder; }
	return flash ? FTP_NODE_CONTEXT.flashProjectFolder : FTP_NODE_CONTEXT.projectFolder;
}

/** 펼칠 수 있는 폴더 노드인가(프로젝트 폴더·하위 폴더 모두). */
export function isFtpFolderContext(context: string | undefined): boolean {
	return context === FTP_NODE_CONTEXT.projectFolder || context === FTP_NODE_CONTEXT.flashProjectFolder
		|| context === FTP_NODE_CONTEXT.subFolder || context === FTP_NODE_CONTEXT.flashSubFolder;
}

/** flash 영역 노드인가. */
export function isFlashFtpContext(context: string | undefined): boolean {
	return context === FTP_NODE_CONTEXT.flashProjectFolder || context === FTP_NODE_CONTEXT.flashSubFolder
		|| context === FTP_NODE_CONTEXT.flashFile;
}

/** 트리 노드에서 명령이 받는 필드(TreeItem 에 실려 온다). */
export interface FtpNodeRef {
	remotePath?: unknown;
	controllerHost?: unknown;
}

/** 현재 제어기 설정 중 판정에 쓰는 부분. */
export interface FtpNodeTargetConfig {
	ip: string;
	ftpBasePath: string;
	ftpFlashProjectsPath: string;
}

export type FtpNodeTargetCheck =
	| { ok: true; host: string; remotePath: string; /** 프로젝트 폴더면 그 폴더 이름(= 프로젝트 명령의 이름). */ projectName?: string }
	| { ok: false; reason: 'missing-target' | 'controller-changed' | 'not-project-folder'; message: string };

const sameHost = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * `remotePath` 가 설정된 저장 영역(/GPL·flash) **바로 아래** 폴더면 그 폴더 이름, 아니면 undefined.
 * 저장 영역 자체·루트·더 깊은 하위 폴더는 프로젝트 폴더가 아니다.
 */
export function projectFolderNameOf(remotePath: string, basePaths: readonly string[]): string | undefined {
	const target = normalizeAbsoluteRemoteDir(remotePath);
	if (target.split('/').includes('..')) { return undefined; }
	for (const raw of basePaths) {
		const base = normalizeAbsoluteRemoteDir(raw);
		if (base === '/') { continue; }
		if (!target.toLowerCase().startsWith(`${base.toLowerCase()}/`)) { continue; }
		const rest = target.slice(base.length + 1);
		if (rest.length > 0 && !rest.includes('/')) { return rest; }
	}
	return undefined;
}

/**
 * FTP 노드로 제어기를 조작해도 되는지 판정한다.
 *  - 노드에 원격 경로·제어기가 없으면 거부(어느 제어기의 무엇인지 모른다).
 *  - 노드의 제어기가 현재 설정의 제어기와 다르면 거부(목록을 만든 뒤 제어기가 바뀌었다).
 *  - `requireProjectFolder` 면 저장 영역 바로 아래 폴더만 허용하고, 그 폴더 이름을 프로젝트 이름으로 돌려준다.
 * 확인 창처럼 사용자를 기다린 뒤에는 다시 불러 그 사이의 제어기 전환도 잡는다.
 */
export function checkFtpNodeTarget(
	node: FtpNodeRef | undefined,
	current: FtpNodeTargetConfig,
	options: { action: string; requireProjectFolder: boolean },
): FtpNodeTargetCheck {
	const remotePath = typeof node?.remotePath === 'string' ? node.remotePath : '';
	const host = typeof node?.controllerHost === 'string' ? node.controllerHost.trim() : '';
	if (!remotePath || !host) {
		return {
			ok: false, reason: 'missing-target',
			message: `${options.action} 중단 — 대상 제어기·경로를 알 수 없습니다. 제어기 트리의 FTP 항목에서 실행하세요.`,
		};
	}
	if (!sameHost(host, current.ip)) {
		return {
			ok: false, reason: 'controller-changed',
			message: `${options.action} 중단 — 이 항목은 제어기 ${host}의 목록인데 현재 제어기는 ${current.ip}입니다. FTP 목록을 새로고침한 뒤 다시 실행하세요.`,
		};
	}
	const projectName = projectFolderNameOf(remotePath, [current.ftpBasePath, current.ftpFlashProjectsPath]);
	if (options.requireProjectFolder && !projectName) {
		return {
			ok: false, reason: 'not-project-folder',
			message: `${options.action} 중단 — ${remotePath}은(는) 프로젝트 폴더(${current.ftpBasePath}·${current.ftpFlashProjectsPath} 바로 아래)가 아닙니다. 하위 폴더 이름으로 프로젝트 명령을 보내지 않습니다.`,
		};
	}
	return { ok: true, host, remotePath, projectName };
}
