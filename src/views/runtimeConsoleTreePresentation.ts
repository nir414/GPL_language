/**
 * 1403 런타임 콘솔 상태의 **트리 행** 표시 규칙(라벨·description·아이콘·툴팁·불안정 판정·가설) — vscode 무의존.
 * controllerTreeProvider.ts 하단에 있던 함수를 그대로 옮겼다(2026-09-07 §1-DB, 동작 동일).
 *
 * 같은 상태 enum 의 다른 표현이 `controller/runtimeConsolePresentation.ts` 에도 있다 — 그쪽은 알림 메시지용
 * (영문 라벨 `formatRuntimeConsoleStateLabel` + `buildRuntimeConsoleUserMessage`), 여기는 트리용 한국어 문구다.
 * 두 곳의 "폴링 상태" 판정 정규식은 서로 다르다(`isRuntimeConsolePollingState` vs 메시지 쪽 인라인 정규식).
 * 옮기면서 통일하지 않았다 — 통일은 실기기 관측 문구를 대조한 뒤 결정할 일이라 동작을 바꾸지 않았다(ai-handoff §3).
 */
import type { RuntimeConsoleStatusSnapshot } from '../controller/runtimeConsole';
import { formatDateTimeFromTs } from './treeFormat';

export function formatRuntimeConsoleStatusDetail(status: RuntimeConsoleStatusSnapshot): string {
	const parts: string[] = [];
	if (status.reason) {
		parts.push(status.reason);
	}
	if (status.detail) {
		parts.push(status.detail);
	}
	if (status.noPayloadStreak > 0) {
		parts.push(`noPayloadStreak=${status.noPayloadStreak}`);
	}
	if (status.immediateEofStreak > 0) {
		parts.push(`pollEmptyStreak=${status.immediateEofStreak}`);
	}
	if (status.reconnectDelayMs) {
		parts.push(`reconnect=${status.reconnectDelayMs}ms`);
	}
	if (parts.length === 0) {
		return status.connected ? '정상 연결' : '상세 없음';
	}
	return parts.join(' / ');
}

export function formatRuntimeConsoleTreeState(status: RuntimeConsoleStatusSnapshot): string {
	switch (status.state) {
		case 'connected':
			return '연결됨';
		case 'connected-no-payload':
			return '연결됨 · payload 대기';
		case 'connecting':
			return '연결 중';
		case 'reconnecting':
			if (isRuntimeConsolePollingState(status)) {
				return '이벤트 대기 폴링';
			}
			return '재연결 대기';
		case 'connect-failed':
			return '연결 실패';
		case 'no-payload':
			return 'payload 없음';
		case 'polling':
			return '연결 유지 · 이벤트 대기';
		case 'stopped':
			return '중지됨';
		case 'batch-complete':
			return '연결 유지 · 배치 완료';
		case 'socket-error':
			return '소켓 오류';
		default:
			return status.connected ? '연결됨' : '미연결';
	}
}

export function buildRuntimeConsoleTreeDescription(status: RuntimeConsoleStatusSnapshot): string {
	const parts: string[] = [formatRuntimeConsoleTreeState(status)];
	if (status.reconnectDelayMs) {
		parts.push(isRuntimeConsolePollingState(status)
			? `${status.reconnectDelayMs}ms 뒤 폴링`
			: `${status.reconnectDelayMs}ms 뒤 재연결`);
	} else if (status.lastPayloadAt) {
		const payloadSummary = status.lastPayloadBytes
			? `${formatDateTimeFromTs(status.lastPayloadAt)} · ${status.lastPayloadBytes}B`
			: formatDateTimeFromTs(status.lastPayloadAt);
		parts.push(`마지막 payload ${payloadSummary}`);
	} else if (status.noPayloadStreak > 0) {
		parts.push(`payload 없음 x${status.noPayloadStreak}`);
	} else if (status.reason && status.reason !== '미연결') {
		parts.push(status.reason);
	}
	return parts.join(' · ');
}

export function getRuntimeConsoleTreeIcon(status: RuntimeConsoleStatusSnapshot): string {
	if (status.connected
		|| status.state === 'connected-no-payload'
		|| status.state === 'batch-complete'
		|| status.state === 'polling') {
		return 'pass';
	}
	if (status.state === 'connecting' || status.state === 'reconnecting') {
		return 'refresh';
	}
	return 'warning';
}

export function buildRuntimeConsoleTreeTooltip(
	status: RuntimeConsoleStatusSnapshot,
	ip: string,
	port: number,
): string {
	const lines = [
		`1403 콘솔: ${formatRuntimeConsoleTreeState(status)} (${ip}:${port})`,
		`상세: ${formatRuntimeConsoleStatusDetail(status)}`,
	];
	if (status.lastConnectAt) {
		lines.push(`마지막 연결 시도: ${formatDateTimeFromTs(status.lastConnectAt)}`);
	}
	if (status.lastPayloadAt) {
		lines.push(`마지막 payload: ${formatDateTimeFromTs(status.lastPayloadAt)}${status.lastPayloadBytes ? ` (${status.lastPayloadBytes}B)` : ''}`);
	}
	if (status.lastErrorCode) {
		lines.push(`마지막 오류 코드: ${status.lastErrorCode}`);
	}
	if (status.reconnectDelayMs) {
		lines.push(`${isRuntimeConsolePollingState(status) ? '폴링 대기' : '재연결 대기'}: ${status.reconnectDelayMs}ms${status.reconnectAttempt ? ` (attempt ${status.reconnectAttempt})` : ''}`);
	}
	lines.push('클릭: 연결/재연결 후 로그 보기');
	lines.push('버튼: 트래픽 보기');
	return lines.join('\n');
}

export function isRuntimeConsoleUnstable(status: RuntimeConsoleStatusSnapshot): boolean {
	if (status.connected) { return false; }
	if (status.state === 'stopped'
		|| status.state === 'idle'
		|| status.state === 'polling'
		|| status.state === 'batch-complete'
		|| status.state === 'connected-no-payload'
		|| isRuntimeConsolePollingState(status)) {
		return false;
	}
	if (status.immediateEofStreak > 0 && status.noPayloadStreak === 0 && status.lastErrorCode === undefined) { return false; }
	if (status.noPayloadStreak >= 5) { return true; }
	return /refused|socket error|connect failed|ECONN/i.test(`${status.reason} ${status.detail ?? ''}`);
}

export function getRuntimeConsoleHypothesis(status: RuntimeConsoleStatusSnapshot): string | undefined {
	if (status.lastErrorCode === 'ECONNREFUSED' || /ECONNREFUSED/i.test(status.detail ?? '')) {
		return '다른 1403 소비자가 포트를 점유했거나, 제어기 쪽 콘솔 서비스가 비활성일 가능성이 있습니다.';
	}
	if (status.state === 'polling') {
		return '1403 이벤트 큐가 비어 있어 payload 없는 짧은 세션을 반복하는 정상 폴링 상태입니다.';
	}
	if (status.state === 'no-payload' || status.state === 'connected-no-payload') {
		return '실제 런타임이 Idle 상태이거나, 1403이 빈 배치 세션만 반환하는 상태일 수 있습니다.';
	}
	return undefined;
}

export function isRuntimeConsolePollingState(status: RuntimeConsoleStatusSnapshot): boolean {
	const text = `${status.reason} ${status.detail ?? ''}`;
	return status.state === 'polling'
		|| status.immediateEofStreak > 0
		|| /이벤트 대기 폴링|이벤트 큐|빈 이벤트|Idle timeout|Empty batch/i.test(text);
}
