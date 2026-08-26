/**
 * 온디맨드 캐시(FTP 목록·시스템 정보)의 자동 재조회 억제 판정 — 순수 함수 (vscode 의존 없음).
 *
 * 배경(GitHub #22 제안 7): 연결이 "유실(3회 연속 실패) → 재연결"로 플랩할 때마다 setConnected(true)가
 * FTP /GPL·Flash 목록과 시스템 정보를 전부 재조회해, 60초 동안 FTP passive 데이터 연결 66개가 관측됐다.
 * 연결 확립 시 자동 재조회는 "캐시가 없거나, 다른 제어기/경로의 것이거나, 마지막 성공 조회가
 * minIntervalMs보다 오래됐을 때"만 하고, 그 외에는 보존된 캐시를 그대로 보여 준다(설명에 마지막 조회
 * 시각을 표기해 낡을 수 있음을 드러낸다). 명시적 새로고침(refreshFtp/refreshSystemInfo/refreshAll)은
 * 이 판정을 거치지 않고 항상 조회한다.
 */

/** 연결 확립 시 자동 재조회 억제 간격 기본값(5분). */
export const AUTO_REFRESH_MIN_INTERVAL_MS = 5 * 60_000;

export interface OnDemandCacheState {
    /** 마지막 성공 조회 시각(epoch ms). 0 이하면 조회한 적 없음. */
    lastSuccessAt: number;
    /** 보여 줄 캐시가 있는지(성공한 목록 존재). false면 마지막 조회가 실패 상태라 재조회한다. */
    hasCache: boolean;
    /** 캐시가 어느 대상(제어기 IP·경로)의 것인지. currentKey가 주어지고 다르면 재조회한다. */
    cacheKey?: string;
}

export type AutoRefreshReason =
    /** 조회한 적 없음 */
    | 'never'
    /** 캐시 없음(마지막 조회 실패) */
    | 'no-cache'
    /** 제어기 IP/경로가 바뀜 */
    | 'key-changed'
    /** 마지막 성공 조회가 minIntervalMs 이상 지남(또는 시계 역행) */
    | 'stale'
    /** 억제 — 캐시 유지 */
    | 'fresh';

export interface AutoRefreshDecision {
    refresh: boolean;
    reason: AutoRefreshReason;
    /** 캐시 나이(ms). 조회 이력이 없으면 undefined. */
    ageMs?: number;
}

export interface AutoRefreshOptions {
    /** 억제 간격(ms). 기본 AUTO_REFRESH_MIN_INTERVAL_MS. */
    minIntervalMs?: number;
    /** 현재 대상 키(IP|경로…). 주면 cacheKey와 비교한다. */
    currentKey?: string;
}

/**
 * 연결 확립 시 온디맨드 캐시를 재조회해야 하는지 판정한다.
 * 판정 순서: never → no-cache → key-changed → stale/fresh.
 */
export function decideAutoRefresh(
    state: OnDemandCacheState,
    now: number,
    options?: AutoRefreshOptions,
): AutoRefreshDecision {
    const minIntervalMs = options?.minIntervalMs ?? AUTO_REFRESH_MIN_INTERVAL_MS;
    if (!(state.lastSuccessAt > 0)) {
        return { refresh: true, reason: 'never' };
    }
    const rawAge = now - state.lastSuccessAt;
    const ageMs = Math.max(0, rawAge);
    if (!state.hasCache) {
        return { refresh: true, reason: 'no-cache', ageMs };
    }
    if (options?.currentKey !== undefined && state.cacheKey !== options.currentKey) {
        return { refresh: true, reason: 'key-changed', ageMs };
    }
    // 시계가 뒤로 갔으면(now < lastSuccessAt) 기록 시각을 신뢰할 수 없다 → 안전한 쪽(재조회).
    if (rawAge < 0 || ageMs >= minIntervalMs) {
        return { refresh: true, reason: 'stale', ageMs };
    }
    return { refresh: false, reason: 'fresh', ageMs };
}

/**
 * 트리 설명용 마지막 조회 시각 — 오늘이면 `HH:mm`, 다른 날이면 `MM-DD HH:mm`(로컬 시간).
 * 며칠 전 캐시가 "14:05"로만 보여 오늘 것으로 오해되는 일을 막는다.
 */
export function formatLastRefreshTime(timestamp: number, now: number = Date.now()): string {
    const d = new Date(timestamp);
    const n = new Date(now);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const sameDay = d.getFullYear() === n.getFullYear()
        && d.getMonth() === n.getMonth()
        && d.getDate() === n.getDate();
    if (sameDay) {
        return `${hh}:${mm}`;
    }
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    return `${mo}-${da} ${hh}:${mm}`;
}
