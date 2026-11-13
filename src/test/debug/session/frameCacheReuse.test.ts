import * as assert from 'assert';
import { test } from '../../harness';
import { isFrameCacheReusable } from '../../../debug/session/frameCache';

const frames = [{ frameIndex: 0, project: 'App', process: 'Main', procLine: 3, file: 'App_Control.gpl', fileLine: 1948, size: 0 }];
const polled = (over: Record<string, unknown> = {}) => ({ name: 'RWK_3', state: 'Paused', lastStatus: '', project: 'App', file: 'C:\\x\\app_control.GPL', fileLine: 1948, ...over });
const base = { frames, cachedAt: 1000, ttlMs: 1500, pending: false };

test('frameCache: TTL 안이면 폴 정보 없이도 재사용', () => {
    assert.ok(isFrameCacheReusable({ ...base, now: 2400, polled: undefined }));
});

test('frameCache: TTL 이 지나도 폴이 같은 파일·줄 정지를 보고하면 재사용', () => {
    assert.ok(isFrameCacheReusable({ ...base, now: 60_000, polled: polled() }));
    assert.ok(isFrameCacheReusable({ ...base, now: 60_000, polled: polled({ state: 'Break' }) }));
});

test('frameCache: 위치가 다르거나 실행 중·pending·위치 없음이면 다시 조회', () => {
    assert.ok(!isFrameCacheReusable({ ...base, now: 60_000, polled: polled({ fileLine: 1949 }) }));
    assert.ok(!isFrameCacheReusable({ ...base, now: 60_000, polled: polled({ file: 'Other.gpl' }) }));
    assert.ok(!isFrameCacheReusable({ ...base, now: 60_000, polled: polled({ state: 'Running' }) }));
    assert.ok(!isFrameCacheReusable({ ...base, now: 60_000, polled: polled({ fileLine: undefined }) }));
    assert.ok(!isFrameCacheReusable({ ...base, now: 60_000, polled: polled(), pending: true }));
    assert.ok(!isFrameCacheReusable({ ...base, now: 60_000, polled: undefined }));
    assert.ok(!isFrameCacheReusable({ ...base, frames: [], now: 1001, polled: polled() }));
});
