/**
 * 원격 폴더 비우기(/GPL 정리) 절차 — 트리의 「/GPL 비우기」(사람)와 `gpl.ai.debug.clearRemoteFolder`(AI) 가 같이 쓴다.
 *
 * 무엇을 지울지(대상 선택)·어디까지 허용할지(루트 분류)·지운 뒤 정리(업로드 지문 폐기)를 한곳에 둔다.
 * 확인 UI·쓰레드 게이트처럼 호출 경로마다 다른 부분은 호출측(activation)이 맡는다.
 */

import { ClearRemoteDirResult, FtpEntry, clearRemoteDir, normalizeAbsoluteRemoteDir } from './ftpClient';
import { forgetSyncManifest } from './syncManifest';
import { isSettledState } from '../threads/threadActivity';

/**
 * 비우기 대상 루트의 종류.
 * - `gpl`: 설정된 로드 폴더(/GPL) — AI 도 사용자 동의 후 비울 수 있다(2026-10-21 사용자 결정).
 * - `flash`: flash 영구 사본 — 되돌릴 수 없으므로 AI 경로에서는 막는다(사람의 트리 명령만).
 * - `other`: 그 밖의 경로 — AI 경로에서는 허용하지 않는다.
 * - `unsafe`: 빈 경로·루트('/') — 어느 경로에서도 허용하지 않는다.
 */
export type RemoteClearRootKind = 'gpl' | 'flash' | 'other' | 'unsafe';

/** 경로 비교는 대소문자를 무시한다(제어기 FTP 가 대소문자를 구분하지 않는다 — /GPL 과 /gpl 은 같은 폴더). */
function samePath(a: string, b: string): boolean {
	return a.toLowerCase() === b.toLowerCase();
}

function isUnder(path: string, base: string): boolean {
	return base !== '/' && path.toLowerCase().startsWith(`${base.toLowerCase()}/`);
}

/** `root` 가 어떤 종류의 폴더인지 판정한다. flash 는 설정 경로와 그 하위, 그리고 `/flash` 아래 전부로 본다. */
export function classifyRemoteClearRoot(
	root: string,
	config: { gplBasePath: string; flashBasePath: string },
): RemoteClearRootKind {
	const target = normalizeAbsoluteRemoteDir(root);
	if (target === '/') { return 'unsafe'; }
	const flash = normalizeAbsoluteRemoteDir(config.flashBasePath);
	if (samePath(target, '/flash') || isUnder(target, '/flash') || samePath(target, flash) || isUnder(target, flash)) {
		return 'flash';
	}
	const gpl = normalizeAbsoluteRemoteDir(config.gplBasePath);
	return gpl !== '/' && samePath(target, gpl) ? 'gpl' : 'other';
}

/** 비우기 대상 선택 결과 — `missing` 은 이름을 지정했는데 목록에 없던 항목이다(이미 지워졌거나 오타). */
export interface RemoteClearSelection {
	targets: FtpEntry[];
	missing: string[];
}

/**
 * 원격 목록에서 지울 항목을 고른다. `names` 가 없으면 전부, 있으면 그 이름만(대소문자 무시).
 * AI 경로는 사용자에게 보여 주고 동의받은 이름을 그대로 넘겨, 미리보기와 실제 삭제 사이에 생긴 항목을 지우지 않는다.
 */
export function selectRemoteClearTargets(entries: readonly FtpEntry[], names?: readonly string[]): RemoteClearSelection {
	const all = entries.filter(e => e.name !== '.' && e.name !== '..');
	if (names === undefined || names === null) {
		return { targets: all, missing: [] };
	}
	const wanted = names.map(n => String(n ?? '').trim()).filter(n => n.length > 0);
	const keys = new Set(wanted.map(n => n.toLowerCase()));
	const targets = all.filter(e => keys.has(e.name.toLowerCase()));
	const found = new Set(targets.map(e => e.name.toLowerCase()));
	const missing = wanted.filter(n => !found.has(n.toLowerCase()));
	return { targets, missing };
}

/**
 * 고른 항목만 지우고, 지운 경로의 업로드 지문을 버린다(다음 동기화는 목록 조회로 다시 판정).
 * 개별 실패는 결과의 `failed` 로 모아 돌려준다 — 호출측이 "부분 완료"를 그대로 알린다.
 */
export async function clearRemoteFolderEntries(
	host: string,
	basePath: string,
	targets: readonly FtpEntry[],
	onDelete?: (name: string, isDirectory: boolean) => void,
): Promise<ClearRemoteDirResult> {
	const base = normalizeAbsoluteRemoteDir(basePath);
	const names = new Set(targets.map(e => e.name));
	const result = await clearRemoteDir(host, base, onDelete, entry => names.has(entry.name));
	forgetSyncManifest(host, base);
	for (const name of result.deleted) {
		forgetSyncManifest(host, `${base}/${name}`);
	}
	if (result.deleted.length > 0) {
		const event: RemoteFolderCleared = { host, base, deleted: [...result.deleted] };
		for (const listener of [...clearedListeners]) {
			try { listener(event); } catch { /* 구독자 실패가 비우기 결과를 바꾸지 않는다 */ }
		}
	}
	return result;
}

/** 원격 폴더에서 항목을 지운 뒤의 알림 — 사람·AI 어느 경로로 비웠든 한 번. */
export interface RemoteFolderCleared {
	host: string;
	/** 정규화한 절대 경로(`/GPL`). */
	base: string;
	/** 실제로 지운 최상위 항목 이름. */
	deleted: string[];
}

const clearedListeners = new Set<(e: RemoteFolderCleared) => void>();

/**
 * 비우기 결과 구독 — "컴파일 검증 필요" 목록이 /GPL 에서 사라진 프로젝트를 해제하는 데 쓴다(2026-11-03 inbox ④:
 * 제어기에 소스가 없으면 "미검증 소스"도 없다). 호출 경로(트리·Unload -all 전 비우기·AI)마다 꿰지 않으려고 절차 쪽에서 알린다.
 */
export function onRemoteFolderCleared(listener: (e: RemoteFolderCleared) => void): { dispose(): void } {
	clearedListeners.add(listener);
	return { dispose: () => { clearedListeners.delete(listener); } };
}

// ── 삭제 전 정지 게이트 판정 (2026-10-23 inbox unload-guard-request ③) ─────────────────────
// 명령 콘솔이 이미 거부(refused) 상태인데 `Stop -all` 실패 뒤에도 FTP 삭제가 이어진 사례가 있었다(`550 DELE failed.`).
// 원격 파일 삭제는 되돌릴 수 없으므로 **정지가 확인되지 않으면 지우지 않는다** — 상태를 모르는 것도 "확인 안 됨"이다.
// 사람 경로(트리 「/GPL 비우기」·항목 삭제)가 이 판정을 쓰고, AI 경로(`gpl.ai.debug.clearRemoteFolder`)는 쓰레드가 있으면
// 정지 없이 거절하는 더 엄격한 규칙을 쓴다.

/** 삭제 진행 여부와, 진행하지 않을 때 사람이 읽을 사유. */
export type RemoteDeleteGate =
	| { proceed: true }
	| { proceed: false; reason: 'thread-state-unknown' | 'user-cancelled' | 'stop-failed' | 'stop-unconfirmed'; detail: string };

/** 쓰레드 목록 조회 결과로 판정 — 목록을 못 받았으면(null) 지우지 않는다. 빈 목록이면 정지 단계 없이 진행. */
export function remoteDeleteGateForThreads(threadCount: number | null): RemoteDeleteGate | 'needs-stop' {
	if (threadCount === null) {
		return {
			proceed: false,
			reason: 'thread-state-unknown',
			detail: '쓰레드 상태를 확인하지 못했습니다(명령 콘솔 응답 없음) — 실행 중인지 모르는 상태에서는 원격 파일을 지우지 않습니다. 연결을 확인한 뒤 다시 실행하세요.',
		};
	}
	return threadCount === 0 ? { proceed: true } : 'needs-stop';
}

/** `Stop -all` 절차(threadStop.stopAllAndSettle) 결과로 판정 — 전송 실패·정지 미확인이면 지우지 않는다. */
export function remoteDeleteGateAfterStop(outcome: {
	sendFailed: boolean;
	statusCode?: number;
	message?: string;
	ok: boolean;
	unconfirmed: boolean;
}): RemoteDeleteGate {
	if (outcome.sendFailed) {
		const status = outcome.statusCode === undefined ? '' : `STATUS ${outcome.statusCode} `;
		return {
			proceed: false,
			reason: 'stop-failed',
			detail: `정지 실패: ${`${status}${outcome.message ?? ''}`.trim() || '응답 없음'} — 정지를 확인하지 못해 삭제를 중단합니다(원격 파일은 그대로입니다).`,
		};
	}
	if (!outcome.ok || outcome.unconfirmed) {
		return {
			proceed: false,
			reason: 'stop-unconfirmed',
			detail: '정지 완료를 확인하지 못해 삭제를 중단합니다(원격 파일은 그대로입니다). 상태를 확인한 뒤 다시 실행하세요.',
		};
	}
	return { proceed: true };
}

// ── AI 비우기의 쓰레드 게이트 (2026-11-05 inbox cmd-thread-blocks-clear-gpl v2) ─────────────────
// 종전에는 목록에 쓰레드가 하나라도 있으면(Idle `_Cmd_App`·`TCPCLI_0` 포함) 거절해, `stop_threads` 가 정착(settled)을
// 보고한 직후에도 비울 수 없었다. 이제 `stop_threads` 와 같은 정착 판정(threadActivity.isSettledState: Idle/Stopped/Error)만
// 쓴다 — Running·Paused·Break·Stopping 처럼 정착하지 않은 쓰레드만 막는다. 정지 계열로 남은 쓰레드는 `unload_project` 로 걷어 낸다.
// 사람 경로(트리 명령 `remoteDeleteGateForThreads`)는 그대로다(존재 자체를 동작 중으로 보는 보수 규약 유지).

/** 거절 때 응답에 싣는 쓰레드 한 줄. */
export interface ClearGateThread {
	name: string;
	state: string;
	project?: string;
}

/** AI 비우기 쓰레드 게이트 판정. 진행하더라도 정착 상태로 남은 쓰레드는 알려 준다. */
export type AiClearThreadGate =
	| { proceed: true; settledRemaining: ClearGateThread[] }
	| {
		proceed: false;
		/** 정착하지 않아 막는 쓰레드. */
		active: ClearGateThread[];
		/** 정착했지만 목록에 남은 쓰레드(참고용). */
		settledRemaining: ClearGateThread[];
		/** 전체 목록(막는 것 + 남은 것) — 걸러서 숨기지 않는다. */
		threads: ClearGateThread[];
		detail: string;
		recommendedAction: string;
	};

/** `Show Thread` 목록으로 AI 비우기 진행 여부를 판정한다 — 목록을 못 받은 경우(null)는 호출측이 따로 거절한다. */
export function judgeAiClearThreadGate(threads: readonly { name: string; state?: string; project?: string }[]): AiClearThreadGate {
	const all: ClearGateThread[] = threads.map(t => ({
		name: t.name,
		state: (t.state ?? '?').trim() || '?',
		...(t.project ? { project: t.project } : {}),
	}));
	const active = all.filter(t => !isSettledState(t.state));
	const settledRemaining = all.filter(t => isSettledState(t.state));
	if (active.length === 0) { return { proceed: true, settledRemaining }; }
	const projects = [...new Set(active.map(t => t.project).filter((p): p is string => !!p))];
	const stopArg = projects.length === 1 ? `stop_threads({ project: "${projects[0]}" })` : 'stop_threads(사용자 동의 범위)';
	const unloadArg = projects.length === 1 ? `unload_project({ project: "${projects[0]}" })` : 'unload_project(프로젝트별)';
	return {
		proceed: false,
		active,
		settledRemaining,
		threads: all,
		detail: `정착하지 않은 쓰레드 ${active.length}개(${active.map(t => `${t.name}(${t.state})`).join(', ')}) — 실행 중에 원격 파일을 지우면 파일 충돌·자원 누수가 생길 수 있습니다.`
			+ (settledRemaining.length > 0 ? ` 정지 계열로 남은 쓰레드: ${settledRemaining.map(t => `${t.name}(${t.state})`).join(', ')}.` : ''),
		recommendedAction: `사용자 동의를 받아 ${stopArg} 로 정지시키고 정착을 확인한 뒤 다시 호출할 것. `
			+ `Idle/Stopped 로 남은 쓰레드(_Cmd_<project>·TCPCLI_n 등)는 비우기를 막지 않는다 — 비운 뒤 ${unloadArg} 로 걷어 낼 수 있다.`,
	};
}
