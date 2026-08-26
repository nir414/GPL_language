import * as assert from 'assert';
import { test } from './harness';
import {
    AUTO_REFRESH_MIN_INTERVAL_MS,
    decideAutoRefresh,
    formatLastRefreshTime,
} from '../views/refreshThrottle';

/** 기준 시각: 2026-08-26 14:05:00 (로컬) — 트리 설명 포맷 검증에도 같은 값을 쓴다. */
const T0 = new Date(2026, 7, 26, 14, 5, 0).getTime();
const MIN = 60_000;
const KEY = '192.168.0.1|/GPL|/flash/projects';

function cached(overrides: Partial<{ lastSuccessAt: number; hasCache: boolean; cacheKey: string }> = {}) {
    return { lastSuccessAt: T0, hasCache: true, cacheKey: KEY, ...overrides };
}

test('refreshThrottle: 기본 억제 간격은 5분', () => {
    assert.strictEqual(AUTO_REFRESH_MIN_INTERVAL_MS, 5 * MIN);
});

test('refreshThrottle: 조회 이력이 없으면(lastSuccessAt=0) 캐시 여부와 무관하게 재조회(never)', () => {
    const d = decideAutoRefresh({ lastSuccessAt: 0, hasCache: false }, T0, { currentKey: KEY });
    assert.deepStrictEqual(d, { refresh: true, reason: 'never' });
    // 초기 상태는 ftpError===null(캐시 있음처럼 보임)이지만 시각이 0이므로 반드시 조회한다.
    const d2 = decideAutoRefresh({ lastSuccessAt: 0, hasCache: true, cacheKey: '' }, T0, { currentKey: KEY });
    assert.strictEqual(d2.reason, 'never');
    assert.strictEqual(d2.ageMs, undefined);
});

test('refreshThrottle: 5분 이내 + 캐시 있음 + 같은 키 → 재조회 건너뜀(fresh), ageMs 보고', () => {
    const d = decideAutoRefresh(cached(), T0 + 30_000, { currentKey: KEY });
    assert.deepStrictEqual(d, { refresh: false, reason: 'fresh', ageMs: 30_000 });
    const edge = decideAutoRefresh(cached(), T0 + 5 * MIN - 1, { currentKey: KEY });
    assert.strictEqual(edge.refresh, false, '4분 59.999초는 아직 신선');
});

test('refreshThrottle: 정확히 5분 경과 시점부터 stale → 재조회', () => {
    const d = decideAutoRefresh(cached(), T0 + 5 * MIN, { currentKey: KEY });
    assert.deepStrictEqual(d, { refresh: true, reason: 'stale', ageMs: 5 * MIN });
    const later = decideAutoRefresh(cached(), T0 + 60 * MIN, { currentKey: KEY });
    assert.strictEqual(later.reason, 'stale');
});

test('refreshThrottle: 캐시가 없으면(마지막 조회 실패) 신선해도 재조회(no-cache)', () => {
    // refreshFtp 강제 조회가 세션 실패로 끝나면 entries는 비고 error가 채워진다 → hasCache=false.
    const d = decideAutoRefresh(cached({ hasCache: false }), T0 + 10_000, { currentKey: KEY });
    assert.deepStrictEqual(d, { refresh: true, reason: 'no-cache', ageMs: 10_000 });
});

test('refreshThrottle: 제어기 IP/경로 키가 바뀌면 신선해도 재조회(key-changed)', () => {
    const d = decideAutoRefresh(cached(), T0 + 10_000, { currentKey: '192.168.0.2|/GPL|/flash/projects' });
    assert.strictEqual(d.refresh, true);
    assert.strictEqual(d.reason, 'key-changed');
    // 명시적 disconnect 뒤 캐시가 비워지면 cacheKey도 ''이 되지만 lastSuccessAt=0이라 never가 먼저 잡힌다.
    const cleared = decideAutoRefresh({ lastSuccessAt: 0, hasCache: false, cacheKey: '' }, T0, { currentKey: KEY });
    assert.strictEqual(cleared.reason, 'never');
});

test('refreshThrottle: currentKey를 주지 않으면 키 비교를 생략한다', () => {
    const d = decideAutoRefresh(cached({ cacheKey: 'anything' }), T0 + 10_000);
    assert.strictEqual(d.refresh, false);
    assert.strictEqual(d.reason, 'fresh');
});

test('refreshThrottle: minIntervalMs를 주면 그 값으로 판정한다', () => {
    const shortFresh = decideAutoRefresh(cached(), T0 + 5_000, { minIntervalMs: 10_000 });
    assert.strictEqual(shortFresh.refresh, false);
    const shortStale = decideAutoRefresh(cached(), T0 + 10_000, { minIntervalMs: 10_000 });
    assert.strictEqual(shortStale.reason, 'stale');
});

test('refreshThrottle: 시계가 뒤로 가면(now < lastSuccessAt) 기록을 신뢰하지 않고 재조회', () => {
    const d = decideAutoRefresh(cached(), T0 - 1_000, { currentKey: KEY });
    assert.strictEqual(d.refresh, true);
    assert.strictEqual(d.reason, 'stale');
    assert.strictEqual(d.ageMs, 0, '음수 나이는 0으로 보고');
});

test('refreshThrottle: 연결 플랩 시나리오 — 연결→성공→30초 뒤 플랩(억제)→6분 뒤 플랩(재조회)', () => {
    // 1) 첫 연결: 조회 이력 없음 → 조회
    let state = { lastSuccessAt: 0, hasCache: false, cacheKey: '' };
    assert.strictEqual(decideAutoRefresh(state, T0, { currentKey: KEY }).refresh, true);
    // 2) 조회 성공 기록
    state = { lastSuccessAt: T0, hasCache: true, cacheKey: KEY };
    // 3) 30초 뒤 "유실 → 재연결" 플랩: 캐시 보존됐으므로 억제
    const flap1 = decideAutoRefresh(state, T0 + 30_000, { currentKey: KEY });
    assert.strictEqual(flap1.refresh, false);
    // 4) 같은 5분 창 안에서 플랩이 반복돼도 계속 억제(66개 데이터 연결 폭주가 사라지는 지점)
    for (let s = 60; s < 300; s += 60) {
        assert.strictEqual(decideAutoRefresh(state, T0 + s * 1_000, { currentKey: KEY }).refresh, false, `${s}s`);
    }
    // 5) 6분 뒤 플랩: stale → 재조회
    const flap2 = decideAutoRefresh(state, T0 + 6 * MIN, { currentKey: KEY });
    assert.strictEqual(flap2.refresh, true);
    assert.strictEqual(flap2.reason, 'stale');
});

test('formatLastRefreshTime: 같은 날이면 HH:mm, 다른 날이면 MM-DD HH:mm', () => {
    assert.strictEqual(formatLastRefreshTime(T0, T0 + 3 * MIN), '14:05');
    assert.strictEqual(formatLastRefreshTime(new Date(2026, 7, 26, 9, 7).getTime(), T0), '09:07', '0 채움');
    const yesterday = new Date(2026, 7, 25, 23, 58).getTime();
    assert.strictEqual(formatLastRefreshTime(yesterday, T0), '08-25 23:58');
    // 자정을 넘긴 직후: 어제 23:59 캐시는 날짜가 붙어 "오늘 것"으로 오해되지 않는다
    const justAfterMidnight = new Date(2026, 7, 27, 0, 1).getTime();
    assert.strictEqual(formatLastRefreshTime(new Date(2026, 7, 26, 23, 59).getTime(), justAfterMidnight), '08-26 23:59');
});
