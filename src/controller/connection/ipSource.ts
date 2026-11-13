/**
 * 제어기 IP 의 출처 판정 — vscode·파일 I/O 없는 순수 규칙(2026-11-13, inbox 11-05 #2).
 *
 * 왜: `gpl.controller.ip` 가 User(전역) 설정 하나라 장비를 바꾸면 모든 워크스페이스가 따라 바뀌었다. 워크스페이스 파일을
 * 자동으로 만들지 않고(제품 규칙) 워크스페이스별로 기억하려고, **연결에 성공한 IP 를 확장의 workspaceState 에 둔다**.
 *
 * 해석 순서: 세션 오버라이드 > 워크스페이스 설정(명시값) > 이 워크스페이스에서 마지막으로 연결한 IP > User 설정 > 기본값.
 * 저장 위치: 지금 유효한 값이 있는 범위(워크스페이스 값이 이미 있으면 거기, 아니면 User) — 새 워크스페이스 파일을 만들지 않는다.
 */

/** `WorkspaceConfiguration.inspect()` 중 이 규칙이 보는 부분. */
export interface IpSettingInspect {
	/** `.vscode/settings.json`·`.code-workspace` 에 이미 있는 값 */
	workspaceValue?: unknown;
	workspaceFolderValue?: unknown;
	globalValue?: unknown;
	defaultValue?: unknown;
}

export type ControllerIpSource = 'session' | 'workspace' | 'last-connected' | 'user' | 'default';

export interface ResolvedControllerIp {
	ip: string;
	source: ControllerIpSource;
	/** 마지막 연결 IP 가 User 값을 가리고 있으면 가려진 User 값(상태바 툴팁에서 "설정은 X" 로 알린다). */
	shadowedUser?: string;
}

function asIp(v: unknown): string | undefined {
	return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

export function resolveControllerIp(input: {
	sessionOverride?: string;
	inspect: IpSettingInspect | undefined;
	lastConnected?: string;
	fallback?: string;
}): ResolvedControllerIp {
	const session = asIp(input.sessionOverride);
	if (session) { return { ip: session, source: 'session' }; }
	const insp = input.inspect ?? {};
	const workspace = asIp(insp.workspaceFolderValue) ?? asIp(insp.workspaceValue);
	if (workspace) { return { ip: workspace, source: 'workspace' }; }
	const user = asIp(insp.globalValue);
	const last = asIp(input.lastConnected);
	if (last) {
		return { ip: last, source: 'last-connected', ...(user && user !== last ? { shadowedUser: user } : {}) };
	}
	if (user) { return { ip: user, source: 'user' }; }
	return { ip: asIp(insp.defaultValue) ?? input.fallback ?? '192.168.0.1', source: 'default' };
}

/** 연결 UI 가 IP 를 저장할 범위 — 워크스페이스 값이 이미 있으면 거기(User 에 쓰면 그 값에 가려진다), 아니면 User. */
export function pickIpSaveScope(inspect: IpSettingInspect | undefined): 'workspace' | 'global' {
	return asIp(inspect?.workspaceValue) !== undefined ? 'workspace' : 'global';
}

/** 상태바 문구용 출처 이름. */
export function describeIpSource(r: ResolvedControllerIp): string {
	switch (r.source) {
		case 'session': return '이번 세션 한정';
		case 'workspace': return '워크스페이스 설정';
		case 'last-connected': return '이 워크스페이스의 마지막 연결';
		case 'user': return 'User 설정';
		default: return '기본값';
	}
}

/** 상태바 툴팁에 덧붙일 한 줄 — 대상 IP 와 출처, User 설정이 가려졌으면 그 사실. */
export function describeIpSourceLine(r: ResolvedControllerIp): string {
	const shadow = r.shadowedUser ? ` (User 설정은 ${r.shadowedUser} — 이 워크스페이스에서 마지막으로 연결한 IP 가 우선합니다)` : '';
	return `대상 IP ${r.ip} — 출처: ${describeIpSource(r)}${shadow}`;
}
