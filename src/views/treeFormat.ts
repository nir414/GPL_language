/**
 * 제어기 트리(GPL Controller 뷰)의 표시용 포맷 함수 — vscode 무의존.
 * controllerTreeProvider.ts 하단에 있던 함수를 그대로 옮겼다(2026-09-07 §1-DB, 동작 동일) — 테스트 가능하게 하는 것이 목적.
 */
import type { ConnectionStats } from '../controller/consoleSocket';

/**
 * 1402 keep-alive 연결 통계 한 줄(GitHub #22): `keep-alive 유지 중 · 연결 3회 · 재사용 412회`.
 * 정상 폴링 중에는 연결 수가 늘지 않고 재사용만 늘어야 한다 — 늘어나면 제어기가 응답 뒤 끊거나 stale 재시도가 잦다는 뜻.
 */
export function formatConnectionStats(s: ConnectionStats | undefined): string {
	if (!s) { return ''; }
	const parts = [s.keepAliveActive ? 'keep-alive 유지 중' : 'keep-alive 대기', `연결 ${s.connects}회`, `재사용 ${s.reuses}회`];
	if (s.retries > 0) { parts.push(`재시도 ${s.retries}회`); }
	return parts.join(' · ');
}

export function formatSize(bytes: number): string {
	if (bytes < 1024) { return `${bytes} B`; }
	if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(1)} KB`; }
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(date: Date): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	const h = String(date.getHours()).padStart(2, '0');
	const min = String(date.getMinutes()).padStart(2, '0');
	return `${y}-${m}-${d} ${h}:${min}`;
}

export function formatDateTimeFromTs(timestamp?: number): string {
	if (!timestamp) { return '(없음)'; }
	return new Date(timestamp).toLocaleString('ko-KR');
}
